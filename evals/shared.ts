import { createHash } from "node:crypto";
import { Client } from "langsmith";
import type { ExampleCreate } from "langsmith/schemas";
import type { Cache } from "../lib/ai/tasks.ts";
import { SCHEMA_VERSION } from "../lib/parser/types.ts";
import { fetchFileAt, type Repository } from "../lib/pipeline/github.ts";
import { createAdminSupabase } from "../lib/supabase/admin.ts";

// What every eval shares: the stored analyses questions are built from, the
// source the parser read, and datasets that stay put between runs so two
// experiments are always scored on the same examples.

export type Db = ReturnType<typeof createAdminSupabase>;
export type StoredAnalysis = { id: string; commitSha: string; repository: Repository };

export const langsmith = new Client();

// An eval never reads an answer stored by the app, or stores one: a cached
// answer would score whatever prompt wrote it, not the one under test.
export const noCache: Cache = { read: async () => null, write: async () => {} };

/**
 * The latest complete analysis of each repository, newest first. One stored
 * by an older parser lacks facts the questions are built from, so it's left
 * out and named, never filled in. Re-running it brings it back.
 */
export async function storedAnalyses(db: Db): Promise<StoredAnalysis[]> {
  const { data, error } = await db
    .from("analyses")
    .select("id, project_id, commit_sha, schema_version, finished_at, project:projects(repo_owner, repo_name)")
    .eq("status", "complete")
    .order("finished_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Reading analyses failed: ${error.message}`);
  const seen = new Set<string>();
  const out: StoredAnalysis[] = [];
  const outdated: string[] = [];
  for (const a of data) {
    if (seen.has(a.project_id) || !a.commit_sha || !a.project) continue;
    seen.add(a.project_id);
    const repository = { owner: a.project.repo_owner, name: a.project.repo_name };
    if (a.schema_version !== SCHEMA_VERSION) outdated.push(`${repository.owner}/${repository.name}`);
    else out.push({ id: a.id, commitSha: a.commit_sha, repository });
  }
  if (outdated.length) console.log(`Left out ${outdated.length} analysed by an older parser, re-run to include: ${outdated.join(", ")}`);
  return out;
}

/** The bytes the parser read, or why they can't be had. Never a near copy. */
export async function sourceAt(analysis: StoredAnalysis, path: string, hash: string): Promise<{ source: string } | { skipped: string }> {
  const bytes = await fetchFileAt(analysis.repository, analysis.commitSha, path);
  if (bytes === null) return { skipped: "GitHub no longer has it at the analysed commit" };
  if (createHash("sha256").update(bytes).digest("hex") !== hash) return { skipped: "GitHub's copy isn't what was parsed" };
  return { source: bytes.toString("utf8") };
}

/** A stable order that isn't alphabetical, so a sample isn't one folder's worth. */
export function shuffleKey(path: string): string {
  return createHash("sha256").update(path).digest("hex");
}

/**
 * The dataset by name, built only if it doesn't exist. Rebuilding replaces
 * it, and the experiments already run against it go with it: a comparison
 * only means something over the same examples.
 */
export async function ensureDataset(
  name: string,
  description: string,
  rebuild: boolean,
  build: () => Promise<ExampleCreate[]>,
): Promise<{ name: string; url: string; built: boolean }> {
  const exists = await langsmith.hasDataset({ datasetName: name });
  if (exists && !rebuild) return { name, url: await langsmith.getDatasetUrl({ datasetName: name }), built: false };
  // Built before the old one goes, so a build that fails leaves it in place.
  const examples = await build();
  if (exists) await langsmith.deleteDataset({ datasetName: name });
  const dataset = await langsmith.createDataset(name, { description });
  try {
    await langsmith.createExamples(examples.map((e) => ({ ...e, dataset_id: dataset.id })));
  } catch (error) {
    // A half-uploaded dataset would be used as-is next time; gone, it's rebuilt.
    await langsmith.deleteDataset({ datasetId: dataset.id });
    throw error;
  }
  return { name, url: await langsmith.getDatasetUrl({ datasetId: dataset.id }), built: true };
}

/** What an evaluator is handed: one example's inputs, the target's outputs, the reference. */
export type EvaluatorArgs = { inputs: Record<string, unknown>; outputs: Record<string, unknown>; referenceOutputs?: Record<string, unknown> };

export function flag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

export function percent(n: number, of: number): string {
  return of === 0 ? "n/a" : `${((100 * n) / of).toFixed(1)}%`;
}
