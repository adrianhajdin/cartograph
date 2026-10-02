// Submits a repository for an organization and runs the pipeline in this
// process, the same code the app runs, then reads back what was stored.
//
//   pnpm analyze <github url> --org <clerk org id>           submit; run only if new
//   pnpm analyze <github url> --org <clerk org id> --rerun   run it again either way

import "../lib/load-env.ts";
import { runAnalysis } from "../lib/pipeline/run.ts";
import { submitRepository } from "../lib/pipeline/submit.ts";
import { createAdminSupabase } from "../lib/supabase/admin.ts";

async function main(argv: string[]): Promise<void> {
  const org = valueOf(argv, "--org");
  const [url] = argv.filter((arg, i) => !arg.startsWith("--") && argv[i - 1] !== "--org");
  if (!url || !org) {
    console.error("usage: pnpm analyze <github url> --org <clerk org id> [--rerun]");
    process.exit(1);
  }

  const db = createAdminSupabase();
  const { analysisId, created } = await submitRepository(db, org, url);
  console.log(`${created ? "Created" : "Existing"} analysis ${analysisId}`);

  if (created || argv.includes("--rerun")) {
    const started = performance.now();
    try {
      await runAnalysis(db, analysisId);
    } catch (error) {
      console.error(`Run threw: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log(`Run took ${((performance.now() - started) / 1000).toFixed(1)}s`);
  }

  const { data, error } = await db
    .from("analyses")
    .select("status, stage, stage_message, commit_sha, error, started_at, finished_at, projects(repo_owner, repo_name)")
    .eq("id", analysisId)
    .single();
  if (error) throw new Error(error.message);
  console.log(data);

  const parsed = await db.from("files").select("id", { count: "exact", head: true }).eq("analysis_id", analysisId).is("skip_reason", null);
  const skipped = await db.from("files").select("id", { count: "exact", head: true }).eq("analysis_id", analysisId).not("skip_reason", "is", null);
  const edges = await db.from("edges").select("id", { count: "exact", head: true }).eq("analysis_id", analysisId);
  console.log(`Stored: ${parsed.count} parsed files, ${skipped.count} skipped, ${edges.count} edges`);
}

function valueOf(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

await main(process.argv.slice(2));
