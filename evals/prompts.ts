// Two versions of the explain-file prompt over the same files, as two
// separate experiments, scored the same two ways and printed side by side.
//
//   pnpm eval:prompts              build the dataset if it's missing, then run both
//   pnpm eval:prompts --rebuild    rebuild it from the stored analyses first
//
// Two scores, and they aren't equally hard:
// - no_invented_paths is set membership in code. It has an exact answer.
// - specific_enough is a model's judgement. It's the best measure available
//   of "useful", and still an opinion, one that's been written down.

import "../lib/load-env.ts";
import type { ExampleCreate } from "langsmith/schemas";
import { evaluate } from "langsmith/evaluation";
import { MODELS } from "../lib/ai/client.ts";
import { checkPaths, PATH_CHECK_KEY, shownForFile } from "../lib/ai/paths.ts";
import { explainFileMessage, PROMPT_VERSION, type FileInput } from "../lib/ai/prompts.ts";
import { capped, complete, explainFile } from "../lib/ai/tasks.ts";
import { loadFileInput } from "../lib/analysis/context.ts";
import { readAll } from "../lib/analysis/load.ts";
import { createAdminSupabase } from "../lib/supabase/admin.ts";
import { JUDGE_KEY, JUDGE_MODEL, judgeSpecificity } from "./judge.ts";
import { fileInput, string } from "./read.ts";
import { RETIRED_EXPLAIN_FILE_SYSTEM, RETIRED_VERSION } from "./retired-prompt.ts";
import { ensureDataset, flag, type EvaluatorArgs, noCache, percent, shuffleKey, sourceAt, storedAnalyses, type Db } from "./shared.ts";

const DATASET = "cartograph-explain-file";
const PER_REPOSITORY = 12;
const TOTAL = 24;
const MINIMUM = 10;

async function build(db: Db): Promise<ExampleCreate[]> {
  const perRepository: ExampleCreate[][] = [];
  const skipped: string[] = [];
  for (const analysis of await storedAnalyses(db)) {
    const rows = await readAll((from, to) =>
      db.from("files").select("path, hash, fan_in, fan_out").eq("analysis_id", analysis.id).is("skip_reason", null).order("id").range(from, to),
    );
    // A file with no neighbours has nothing to explain between, which is
    // the part of the answer worth measuring.
    const candidates = rows
      .filter((r) => r.hash !== null && (r.fan_in ?? 0) + (r.fan_out ?? 0) > 0)
      .sort((a, b) => shuffleKey(a.path).localeCompare(shuffleKey(b.path)));
    const picked: ExampleCreate[] = [];
    for (const f of candidates) {
      if (picked.length === PER_REPOSITORY) break;
      if (f.hash === null) continue;
      const where = `${analysis.repository.owner}/${analysis.repository.name}:${f.path}`;
      const loaded = await loadFileInput(db, analysis.id, f.path);
      if (!loaded) throw new Error(`${where} was listed but can't be loaded`);
      const got = await sourceAt(analysis, f.path, f.hash);
      if ("skipped" in got) {
        skipped.push(`${where}: ${got.skipped}`);
        continue;
      }
      picked.push({
        inputs: { question: loaded.input, source: got.source },
        metadata: { repository: `${analysis.repository.owner}/${analysis.repository.name}`, commit: analysis.commitSha, path: f.path },
      });
    }
    perRepository.push(picked);
  }
  // Taken in turns, so every repository is represented before any gives more.
  const examples: ExampleCreate[] = [];
  for (let i = 0; examples.length < TOTAL && perRepository.some((p) => i < p.length); i++) {
    for (const p of perRepository) if (i < p.length && examples.length < TOTAL) examples.push(p[i]);
  }
  for (const s of skipped) console.log(`skipped ${s}`);
  if (examples.length < MINIMUM) throw new Error(`Only ${examples.length} files could go in the dataset; it needs at least ${MINIMUM}.`);
  return examples;
}

type Variant = { label: string; version: number; answer: (question: FileInput, source: string) => Promise<string> };

const VARIANTS: Variant[] = [
  {
    label: "current",
    version: PROMPT_VERSION,
    // Exactly what the app runs, minus its cache.
    answer: async (question, source) => (await explainFile(question, { cache: noCache, source: async () => source })).body,
  },
  {
    label: "retired",
    version: RETIRED_VERSION,
    answer: (question, source) => complete(MODELS.explain, RETIRED_EXPLAIN_FILE_SYSTEM, explainFileMessage(question, capped(source))),
  },
];

const inventedPaths = ({ inputs, outputs }: EvaluatorArgs) => {
  const check = checkPaths(string(outputs.body, "body"), shownForFile(fileInput(inputs.question, "question")));
  return {
    key: PATH_CHECK_KEY,
    score: check.invented.length === 0 ? 1 : 0,
    comment: check.invented.length ? `Not shown to the model: ${check.invented.join(", ")}` : `${check.mentioned.length} paths named, all shown`,
  };
};

const specificity = async ({ inputs, outputs }: EvaluatorArgs) => {
  const verdict = await judgeSpecificity(fileInput(inputs.question, "question"), string(inputs.source, "source"), string(outputs.body, "body"));
  return { key: JUDGE_KEY, score: verdict.specific ? 1 : 0, comment: verdict.reasoning };
};

type Scored = { path: string; paths: number | null; specific: number | null };

async function main(argv: string[]): Promise<void> {
  const db = createAdminSupabase();
  const dataset = await ensureDataset(
    DATASET,
    "Parsed files with at least one neighbour, each with the exact question the app asks and the source the parser read.",
    flag(argv, "--rebuild"),
    () => build(db),
  );
  console.log(`${dataset.built ? "Built" : "Using"} dataset ${dataset.name}: ${dataset.url}`);

  const scored = new Map<string, { experiment: string; rows: Map<string, Scored> }>();
  for (const v of VARIANTS) {
    const results = await evaluate(
      async (inputs: Record<string, unknown>) => ({ body: await v.answer(fileInput(inputs.question, "question"), string(inputs.source, "source")) }),
      {
        data: DATASET,
        experimentPrefix: `explain-v${v.version}-${v.label}`,
        description: `explain-file prompt v${v.version} (${v.label}). ${JUDGE_KEY} is judged by ${JUDGE_MODEL}, not measured.`,
        metadata: { prompt: v.label, promptVersion: v.version, model: MODELS.explain, judge: JUDGE_MODEL },
        maxConcurrency: 4,
        evaluators: [inventedPaths, specificity],
      },
    );
    const rows = new Map<string, Scored>();
    for (const r of results.results) {
      const score = (key: string) => {
        const s = r.evaluationResults.results.find((e) => e.key === key)?.score;
        return typeof s === "number" ? s : typeof s === "boolean" ? Number(s) : null;
      };
      rows.set(r.example.id, { path: String(r.example.metadata?.path ?? r.example.id), paths: score(PATH_CHECK_KEY), specific: score(JUDGE_KEY) });
    }
    scored.set(v.label, { experiment: results.experimentName, rows });
  }

  const [a, b] = VARIANTS.map((v) => scored.get(v.label));
  if (!a || !b) throw new Error("An experiment produced no results");
  const line = (label: string, s: { experiment: string; rows: Map<string, Scored> }) => {
    const rows = [...s.rows.values()];
    const clean = rows.filter((r) => r.paths === 1).length;
    const specific = rows.filter((r) => r.specific === 1).length;
    const failed = rows.filter((r) => r.paths === null || r.specific === null).length;
    return `${label.padEnd(8)} ${`${clean}/${rows.length} ${percent(clean, rows.length)}`.padEnd(18)} ${`${specific}/${rows.length} ${percent(specific, rows.length)}`.padEnd(18)} ${failed ? `${failed} errored  ` : ""}${s.experiment}`;
  };
  console.log(`\n${"".padEnd(8)} ${PATH_CHECK_KEY.padEnd(18)} ${`${JUDGE_KEY}*`.padEnd(18)}`);
  console.log(line("current", a));
  console.log(line("retired", b));

  // Paired, because both ran over the same files: how many files one version
  // got right and the other didn't is the honest size of the difference.
  for (const key of ["paths", "specific"] as const) {
    let better = 0;
    let worse = 0;
    for (const [id, x] of a.rows) {
      const y = b.rows.get(id);
      if (!y || x[key] === null || y[key] === null) continue;
      if (x[key] > y[key]) better++;
      if (x[key] < y[key]) worse++;
    }
    const name = key === "paths" ? PATH_CHECK_KEY : JUDGE_KEY;
    console.log(`${name}: current passes where retired fails on ${better} files, the reverse on ${worse}; net ${better - worse} of ${a.rows.size}.`);
  }
  console.log(`\n* ${JUDGE_KEY} is ${JUDGE_MODEL} judging each answer pass or fail. It's a judgement, not a measurement. ${PATH_CHECK_KEY} is exact.`);
  console.log(`Side by side: open ${dataset.url} and compare the two experiments above.`);
}

await main(process.argv.slice(2));
