// Role accuracy. Convention already gives some files a role it's certain of,
// and those files never reach the classifier in normal operation, so they're
// a held-out set with real ground truth: hide the role, ask, compare.
//
//   pnpm eval:roles              build the dataset if it's missing, then run
//   pnpm eval:roles --rebuild    rebuild it from the stored analyses first

import "../lib/load-env.ts";
import type { ExampleCreate } from "langsmith/schemas";
import { evaluate } from "langsmith/evaluation";
import { MODELS } from "../lib/ai/client.ts";
import { PROMPT_VERSION } from "../lib/ai/prompts.ts";
import { classifyFile } from "../lib/ai/tasks.ts";
import { loadFileInput } from "../lib/analysis/context.ts";
import { readAll } from "../lib/analysis/load.ts";
import { MODEL_ROLES, type ModelRole } from "../lib/roles.ts";
import { createAdminSupabase } from "../lib/supabase/admin.ts";
import { classifyInput, object, string } from "./read.ts";
import { ensureDataset, flag, type EvaluatorArgs, noCache, percent, shuffleKey, sourceAt, storedAnalyses, type Db } from "./shared.ts";

const DATASET = "cartograph-roles";
const MINIMUM = 30;
// Per role per repository, so one repository's hundred components can't
// make the score a measure of components alone.
const PER_ROLE = 8;
const NONE = "none";

async function build(db: Db): Promise<ExampleCreate[]> {
  const examples: ExampleCreate[] = [];
  const skipped: string[] = [];
  for (const analysis of await storedAnalyses(db)) {
    // Only roles the classifier may answer. Scoring it on a page route it's
    // forbidden to give would measure nothing.
    const rows = await readAll((from, to) =>
      db
        .from("files")
        .select("path, hash, file_roles!inner(role, source)")
        .eq("analysis_id", analysis.id)
        .is("skip_reason", null)
        .eq("file_roles.source", "convention")
        .in("file_roles.role", [...MODEL_ROLES])
        .order("id")
        .range(from, to),
    );
    const byRole = new Map<string, { path: string; hash: string }[]>();
    for (const r of rows) {
      const role = r.file_roles[0]?.role;
      if (!role || r.hash === null) continue;
      byRole.set(role, [...(byRole.get(role) ?? []), { path: r.path, hash: r.hash }]);
    }
    for (const [role, files] of byRole) {
      for (const f of files.sort((a, b) => shuffleKey(a.path).localeCompare(shuffleKey(b.path))).slice(0, PER_ROLE)) {
        const where = `${analysis.repository.owner}/${analysis.repository.name}:${f.path}`;
        const loaded = await loadFileInput(db, analysis.id, f.path);
        if (!loaded) throw new Error(`${where} was listed but can't be loaded`);
        const got = await sourceAt(analysis, f.path, f.hash);
        if ("skipped" in got) {
          skipped.push(`${where}: ${got.skipped}`);
          continue;
        }
        // The question is exactly the one the app would ask, which never
        // includes the file's own role. A file importing itself is its own
        // neighbour, so its role is hidden there too, as it would be unlabelled.
        const hide = (n: { path: string; role: string | null }) => (n.path === f.path ? { ...n, role: null } : n);
        const question = { ...loaded.classify, imports: loaded.classify.imports.map(hide), importedBy: loaded.classify.importedBy.map(hide) };
        examples.push({
          inputs: { question, source: got.source },
          outputs: { role },
          metadata: { repository: `${analysis.repository.owner}/${analysis.repository.name}`, commit: analysis.commitSha, path: f.path },
        });
      }
    }
  }
  for (const s of skipped) console.log(`skipped ${s}`);
  if (skipped.length) console.log(`${skipped.length} skipped, not counted`);
  if (examples.length < MINIMUM) {
    throw new Error(`Only ${examples.length} files have a convention role the classifier may give; the dataset needs at least ${MINIMUM}. Analyse more repositories first.`);
  }
  return examples;
}

async function main(argv: string[]): Promise<void> {
  const db = createAdminSupabase();
  const dataset = await ensureDataset(
    DATASET,
    `Files whose role convention decided, limited to the roles the classifier may answer (${MODEL_ROLES.join(", ")}). The reference output is convention's role.`,
    flag(argv, "--rebuild"),
    () => build(db),
  );
  console.log(`${dataset.built ? "Built" : "Using"} dataset ${dataset.name}: ${dataset.url}`);

  const results = await evaluate(
    async (inputs: Record<string, unknown>) => {
      const source = string(inputs.source, "source");
      const { role } = await classifyFile(classifyInput(inputs.question, "question"), { cache: noCache, source: async () => source });
      return { role: role ?? NONE };
    },
    {
      data: DATASET,
      experimentPrefix: `roles-${MODELS.classify}`,
      description: "Convention's role hidden, the classifier asked, answers compared exactly.",
      metadata: { model: MODELS.classify, promptVersion: PROMPT_VERSION },
      maxConcurrency: 4,
      evaluators: [
        ({ outputs, referenceOutputs }: EvaluatorArgs) => ({
          key: "role_correct",
          score: outputs.role === referenceOutputs?.role ? 1 : 0,
          comment: `answered ${String(outputs.role)}, convention says ${String(referenceOutputs?.role)}`,
        }),
      ],
    },
  );

  const rows = results.results.map((r) => ({
    expected: string(object(r.example.outputs, "outputs").role, "outputs.role"),
    answered: r.run.outputs ? string(r.run.outputs.role, "role") : `error: ${r.run.error ?? "no output"}`,
    path: String(r.example.metadata?.path ?? r.example.id),
  }));
  const right = rows.filter((r) => r.answered === r.expected).length;
  console.log(`\nRole accuracy: ${right}/${rows.length} = ${percent(right, rows.length)}  (${results.experimentName})`);
  for (const role of MODEL_ROLES satisfies readonly ModelRole[]) {
    const of = rows.filter((r) => r.expected === role);
    if (of.length) console.log(`  ${role.padEnd(11)} ${of.filter((r) => r.answered === role).length}/${of.length}`);
  }
  const nones = rows.filter((r) => r.answered === NONE).length;
  if (nones) console.log(`  answered "none" for ${nones}`);
  const wrong = rows.filter((r) => r.answered !== r.expected);
  if (wrong.length) console.log("\nWrong:");
  for (const r of wrong) console.log(`  ${r.path}: answered ${r.answered}, convention says ${r.expected}`);
  // These are files convention recognised, mostly by name or folder, so the
  // path is a strong hint here that files reaching the classifier don't have.
  console.log("\nConvention recognised these files, usually by name, so treat this as an upper bound for the files it didn't.");
}

await main(process.argv.slice(2));
