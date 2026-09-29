import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSelection, selectFiles } from "../parser/index.ts";
import { SCHEMA_VERSION } from "../parser/types.ts";
import type { Database, Enums } from "../supabase/database.types.ts";
import { downloadArchive, resolveHeadCommit, type Repository } from "./github.ts";
import { STALE_AFTER_MS } from "./stages.ts";
import { storeResult, storedCoverage } from "./store.ts";

type Db = SupabaseClient<Database>;
type Stage = Enums<"analysis_stage">;

export class AlreadyRunningError extends Error {
  override name = "AlreadyRunningError";
}

export type ClaimedRun = { analysisId: string; organizationId: string; repository: Repository };

export async function runAnalysis(db: Db, analysisId: string): Promise<void> {
  await continueRun(db, await claimAnalysis(db, analysisId));
}

// Everything after the claim. Any failure, in any stage, ends with the row
// marked failed with its reason, in the stage it happened in.
export async function continueRun(db: Db, { analysisId, organizationId, repository }: ClaimedRun): Promise<void> {
  let workdir: string | null = null;
  try {
    workdir = await mkdtemp(path.join(tmpdir(), "cartograph-"));
    await enter(db, analysisId, "fetch", `Resolving the latest commit of ${repository.owner}/${repository.name}`);
    const sha = await resolveHeadCommit(repository);
    await update(db, analysisId, {
      commit_sha: sha,
      stage_message: `Downloading ${repository.owner}/${repository.name} at ${sha.slice(0, 7)}`,
    });
    await downloadArchive(repository, sha, workdir);

    await enter(db, analysisId, "select", "Walking the repository for TypeScript and JavaScript files");
    const selection = selectFiles(workdir);

    const { candidates, skipped } = selection.walk;
    await enter(db, analysisId, "parse", `Parsing ${count(candidates.length, "file")}${skipped.length ? `, ${skipped.length} skipped` : ""}`);
    const result = parseSelection(selection);

    await enter(
      db,
      analysisId,
      "store",
      `Storing ${count(result.coverage.files.found, "file")}, ${count(result.edges.length, "edge")} and ${count(result.routes.length, "route")}`,
    );
    await storeResult(db, { id: analysisId, organizationId }, result);

    await update(db, analysisId, {
      status: "complete",
      finished_at: new Date().toISOString(),
      coverage: storedCoverage(result.coverage),
      detected_projects: result.projects,
      schema_version: SCHEMA_VERSION,
      stage_message: `Mapped ${count(result.files.length, "file")} and ${count(result.edges.length, "edge")}`,
    });
  } catch (error) {
    // The stage stays where it was, so the row says where the run stopped.
    const message = error instanceof Error ? error.message : String(error);
    const failed = await db
      .from("analyses")
      .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
      .eq("id", analysisId);
    if (failed.error) {
      throw new Error(`Run failed (${message}), and recording the failure failed too: ${failed.error.message}`, { cause: error });
    }
    throw error;
  } finally {
    if (workdir) await rm(workdir, { recursive: true, force: true });
  }
}

// Moves the row to running and clears the last run's outcome in one update, so
// two runs of the same analysis can't overlap. A stale run can be taken over.
// Separate from the rest so a request can claim before it responds, and the
// page it lands on already says the run has started.
export async function claimAnalysis(db: Db, analysisId: string): Promise<ClaimedRun> {
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const { data, error } = await db
    .from("analyses")
    .update({
      status: "running",
      stage: "fetch",
      stage_message: "Starting",
      started_at: new Date().toISOString(),
      finished_at: null,
      error: null,
      coverage: null,
      detected_projects: null,
      schema_version: null,
    })
    .eq("id", analysisId)
    .or(`status.neq.running,started_at.lt.${staleBefore}`)
    .select("organization_id, projects!inner(repo_owner, repo_name)")
    .maybeSingle();
  if (error) throw new Error(`Starting analysis ${analysisId} failed: ${error.message}`);
  if (!data) throw new AlreadyRunningError(`Analysis ${analysisId} is already running, or doesn't exist`);
  return {
    analysisId,
    organizationId: data.organization_id,
    repository: { owner: data.projects.repo_owner, name: data.projects.repo_name },
  };
}

async function enter(db: Db, analysisId: string, stage: Stage, message: string): Promise<void> {
  await update(db, analysisId, { stage, stage_message: message });
}

async function update(db: Db, analysisId: string, values: Database["public"]["Tables"]["analyses"]["Update"]): Promise<void> {
  const { error } = await db.from("analyses").update(values).eq("id", analysisId);
  if (error) throw new Error(`Updating analysis ${analysisId} failed: ${error.message}`);
}

function count(n: number, noun: string): string {
  return `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;
}
