// The invented-path check over real traffic. The app already scores every
// answer as it's served and stores that on its run; this reads the recent
// runs back, checks each one again with the same code, and prints every
// failure with what it needs to be confirmed by hand.
//
//   pnpm eval:paths                      explanations from the last 7 days, newest 50
//   pnpm eval:paths --days 30 --limit 200
//   pnpm eval:paths --splice             also splice a made-up path into each one: every splice must be caught
//   pnpm eval:paths --splice lib/nope.ts  splice that path instead

import "../lib/load-env.ts";
import { posix } from "node:path";
import { tracingStatus } from "../lib/ai/client.ts";
import { checkPaths, shownForFile, shownForFolder } from "../lib/ai/paths.ts";
import { fileInput, folderInput, object, string } from "./read.ts";
import { langsmith, percent } from "./shared.ts";

type Checked = { id: string; traceId: string; name: string; subject: string; started: string; body: string; shown: { paths: string[]; base: string } };

async function recent(days: number, limit: number): Promise<{ projectId: string; runs: Checked[] }> {
  const tracing = tracingStatus();
  if (!tracing.on) throw new Error(`Tracing is off (${tracing.reason}), so there's no real traffic to check`);
  const project = await langsmith.readProject({ projectName: tracing.project });
  const runs: Checked[] = [];
  for await (const run of langsmith.runs.query({
    project_ids: [project.id],
    is_root: true,
    filter: `in(name, ["explain-file", "explain-folder"])`,
    min_start_time: new Date(Date.now() - days * 86_400_000).toISOString(),
    selects: ["ID", "NAME", "INPUTS", "OUTPUTS", "START_TIME", "TRACE_ID", "ERROR"],
  })) {
    // An errored run has no answer to check.
    if (run.error || !run.id || !run.outputs) continue;
    const at = `run ${run.id}`;
    const inputs = run.inputs ?? {};
    const body = string(object(run.outputs, `${at} outputs`).body, `${at} outputs.body`);
    if (run.name === "explain-file") {
      const input = fileInput(inputs, `${at} inputs`);
      runs.push({ id: run.id, traceId: run.trace_id ?? run.id, name: run.name, subject: input.path, started: run.start_time ?? "", body, shown: shownForFile(input) });
    } else {
      const input = folderInput(inputs, `${at} inputs`);
      runs.push({ id: run.id, traceId: run.trace_id ?? run.id, name: "explain-folder", subject: `${input.dir}/`, started: run.start_time ?? "", body, shown: shownForFolder(input) });
    }
  }
  runs.sort((a, b) => b.started.localeCompare(a.started));
  return { projectId: project.id, runs: runs.slice(0, limit) };
}

// A sibling of the explained file that doesn't exist, so it's the most
// plausible thing a model could invent, and still certainly not shown.
function madeUp(run: Checked, given: string | null): string {
  if (given) return given;
  const stem = posix.basename(run.subject.replace(/\/$/, "")).replace(/\.[^.]+$/, "");
  const dir = run.name === "explain-file" ? posix.dirname(run.subject) : run.subject.replace(/\/$/, "");
  for (let n = 0; ; n++) {
    const candidate = posix.join(dir, `${stem}-helpers${n || ""}.ts`);
    if (!run.shown.paths.includes(candidate)) return candidate;
  }
}

function sentenceAround(body: string, token: string): string {
  const at = body.indexOf(token);
  if (at === -1) return "";
  const start = Math.max(body.lastIndexOf(". ", at) + 2, body.lastIndexOf("\n", at) + 1, 0);
  const endDot = body.indexOf(". ", at);
  const endLine = body.indexOf("\n", at);
  const end = Math.min(...[endDot === -1 ? body.length : endDot + 1, endLine === -1 ? body.length : endLine]);
  return body.slice(start, end).trim();
}

async function main(argv: string[]): Promise<void> {
  const value = (name: string) => {
    const i = argv.indexOf(name);
    const v = i === -1 ? undefined : argv[i + 1];
    return v && !v.startsWith("--") ? v : null;
  };
  const days = Number(value("--days") ?? 7);
  const limit = Number(value("--limit") ?? 50);
  if (!Number.isFinite(days) || !Number.isFinite(limit) || days <= 0 || limit <= 0) throw new Error("--days and --limit take positive numbers");
  const splice = argv.includes("--splice");

  const { projectId, runs } = await recent(days, limit);
  if (runs.length === 0) throw new Error(`No explanations traced in the last ${days} days. Explain something in the app first.`);

  let clean = 0;
  for (const run of runs) {
    const check = checkPaths(run.body, run.shown);
    if (check.invented.length === 0) {
      clean++;
      continue;
    }
    const url = (await langsmith.runs.getURL(run.id, { project_id: projectId, trace_id: run.traceId })).url ?? `run ${run.id}`;
    console.log(`✗ ${run.name} ${run.subject}  ${run.started.slice(0, 16).replace("T", " ")}`);
    console.log(`    ${url}`);
    for (const p of check.invented) {
      console.log(`    invented: ${p}`);
      const said = sentenceAround(run.body, p);
      if (said) console.log(`      "${said}"`);
    }
    console.log(`    shown (${run.shown.paths.length}): ${[...new Set(run.shown.paths)].join(", ")}`);
  }
  console.log(`\nno_invented_paths: ${clean}/${runs.length} = ${percent(clean, runs.length)} of explanations from the last ${days} days name only paths they were shown.`);

  if (splice) {
    const given = value("--splice");
    let caught = 0;
    for (const run of runs) {
      const fake = madeUp(run, given);
      const spliced = `${run.body}\n\nIt also hands its results to \`${fake}\`, which formats them.`;
      if (checkPaths(spliced, run.shown).invented.includes(fake)) caught++;
      else console.log(`✗ missed ${fake} spliced into ${run.name} ${run.subject}`);
    }
    console.log(`Spliced a made-up path into ${runs.length} explanations${given ? ` (${given})` : ""}: caught ${caught}/${runs.length}.`);
    if (caught !== runs.length) process.exitCode = 1;
  }
}

await main(process.argv.slice(2));
