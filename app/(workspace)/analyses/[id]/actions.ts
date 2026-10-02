"use server";

import { createHash } from "node:crypto";
import { after } from "next/server";
import { tracingStatus, type TracingStatus } from "@/lib/ai/client";
import { classifyFile, explainFile, explainFolder, type Cache } from "@/lib/ai/tasks";
import { loadFileInput, loadFolderInput } from "@/lib/analysis/context";
import { fetchFileAt, resolveHeadCommit } from "@/lib/pipeline/github";
import type { ModelRole } from "@/lib/roles";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export type ExplainResult =
  | {
      ok: true;
      body: string;
      model: string;
      cached: boolean;
      tracing: TracingStatus;
      /** Set when this call labelled a file no convention identified. */
      labelled: { role: ModelRole | null } | null;
      /** Why labelling failed, when it did; the explanation still stands. */
      labelError: string | null;
    }
  | { ok: false; error: string };

export type HeadResult = { ok: true; head: string; analysed: string } | { ok: false; error: string };
export type FileAtHead = { ok: true; state: "unchanged" | "changed" | "deleted" } | { ok: false; error: string };

type Db = Awaited<ReturnType<typeof createServerSupabase>>;
type Analysis = { id: string; organizationId: string; commitSha: string; repository: { owner: string; name: string } };

export async function explainFileAction(analysisId: string, path: string): Promise<ExplainResult> {
  try {
    const db = await createServerSupabase();
    const analysis = await readAnalysis(db, analysisId);
    const loaded = await loadFileInput(db, analysis.id, path);
    if (!loaded) return { ok: false, error: `${path} isn't a file in this analysis` };
    const cache = cacheFor(db, analysis.organizationId);
    const source = sourceAtAnalysedCommit(analysis, path, loaded.file.hash);

    // Labelling comes first so the explanation's question includes the role,
    // and asks the same question next time, when the role is read back stored.
    let labelled: { role: ModelRole | null } | null = null;
    let labelError: string | null = null;
    const input = loaded.input;
    if (input.role === null) {
      try {
        const { role } = await classifyFile(loaded.classify, { cache, source });
        labelled = { role };
        if (role !== null) {
          await storeModelRole(analysis.organizationId, loaded.file.id, role);
          input.role = role;
        }
      } catch (error) {
        labelError = messageOf(error);
      }
    }

    const { body, model, cached, recordPaths } = await explainFile(input, { cache, source });
    after(() => recordPaths().catch((error) => console.error(`Recording the path check for ${path} failed:`, error)));
    return { ok: true, body, model, cached, tracing: tracingStatus(), labelled, labelError };
  } catch (error) {
    console.error(`Explaining ${path} failed:`, error);
    return { ok: false, error: messageOf(error) };
  }
}

export async function explainFolderAction(analysisId: string, dir: string): Promise<ExplainResult> {
  try {
    const db = await createServerSupabase();
    const analysis = await readAnalysis(db, analysisId);
    const input = await loadFolderInput(db, analysis.id, dir);
    if (!input) return { ok: false, error: `${dir} isn't a folder on this map` };
    const { body, model, cached, recordPaths } = await explainFolder(input, { cache: cacheFor(db, analysis.organizationId) });
    after(() => recordPaths().catch((error) => console.error(`Recording the path check for folder ${dir} failed:`, error)));
    return { ok: true, body, model, cached, tracing: tracingStatus(), labelled: null, labelError: null };
  } catch (error) {
    console.error(`Explaining folder ${dir} failed:`, error);
    return { ok: false, error: messageOf(error) };
  }
}

// One GitHub API call; the pane asks once per page load, not once per file.
export async function repositoryHeadAction(analysisId: string): Promise<HeadResult> {
  try {
    const analysis = await readAnalysis(await createServerSupabase(), analysisId);
    return { ok: true, head: await resolveHeadCommit(analysis.repository), analysed: analysis.commitSha };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

// Only asked once the repository has moved past the analysed commit: the
// file's bytes at the new head, against the hash the parser stored.
export async function fileAtHeadAction(analysisId: string, path: string, head: string): Promise<FileAtHead> {
  try {
    if (!/^[0-9a-f]{40}$/.test(head)) return { ok: false, error: "That isn't a commit" };
    const db = await createServerSupabase();
    const analysis = await readAnalysis(db, analysisId);
    const { data: file, error } = await db.from("files").select("hash").eq("analysis_id", analysis.id).eq("path", path).maybeSingle();
    if (error) throw new Error(`Reading ${path} failed: ${error.message}`);
    if (!file?.hash) return { ok: false, error: `${path} isn't a parsed file in this analysis` };
    const bytes = await fetchFileAt(analysis.repository, head, path);
    if (bytes === null) return { ok: true, state: "deleted" };
    return { ok: true, state: sha256(bytes) === file.hash ? "unchanged" : "changed" };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

// Read under the caller's policies: another organization's analysis isn't
// there, and nothing after this runs for it.
async function readAnalysis(db: Db, analysisId: string): Promise<Analysis> {
  const { data, error } = await db
    .from("analyses")
    .select("id, organization_id, status, commit_sha, project:projects(repo_owner, repo_name)")
    .eq("id", analysisId)
    .maybeSingle();
  if (error) throw new Error(`Reading the analysis failed: ${error.message}`);
  if (!data?.project) throw new Error("Analysis not found");
  if (data.status !== "complete" || !data.commit_sha) throw new Error("This analysis isn't complete");
  return {
    id: data.id,
    organizationId: data.organization_id,
    commitSha: data.commit_sha,
    repository: { owner: data.project.repo_owner, name: data.project.repo_name },
  };
}

// Reads go through the member's client and its policy. Members have no write
// grant, so answers are stored by the server's writer, stamped with the
// organization the policy just let the member read.
function cacheFor(db: Db, organizationId: string): Cache {
  return {
    async read(key) {
      const { data, error } = await db.from("ai_cache").select("body").eq("key", key).maybeSingle();
      if (error) throw new Error(`Reading the cache failed: ${error.message}`);
      return data?.body ?? null;
    },
    async write({ key, task, model, body }) {
      const { error } = await createAdminSupabase()
        .from("ai_cache")
        .upsert({ organization_id: organizationId, key, task, model, body }, { onConflict: "organization_id,key", ignoreDuplicates: true });
      if (error) throw new Error(`Storing the answer in the cache failed: ${error.message}`);
    },
  };
}

async function storeModelRole(organizationId: string, fileId: string, role: ModelRole): Promise<void> {
  // A convention role is never replaced: the file only reaches here without one.
  const { error } = await createAdminSupabase()
    .from("file_roles")
    .upsert({ organization_id: organizationId, file_id: fileId, role, source: "model" }, { onConflict: "file_id", ignoreDuplicates: true });
  if (error) throw new Error(`Storing the role failed: ${error.message}`);
}

// Fetched at most once per request, and only if a cache miss needs it. The
// bytes must be the ones the parser read; if GitHub's copy hashes differently,
// explaining it would describe code that isn't on the map.
function sourceAtAnalysedCommit(analysis: Analysis, path: string, hash: string): () => Promise<string> {
  let pending: Promise<string> | null = null;
  return () => {
    pending ??= (async () => {
      const bytes = await fetchFileAt(analysis.repository, analysis.commitSha, path);
      if (bytes === null) throw new Error(`GitHub has no ${path} at ${analysis.commitSha.slice(0, 7)}, the commit that was analysed`);
      if (sha256(bytes) !== hash) throw new Error(`GitHub's copy of ${path} at ${analysis.commitSha.slice(0, 7)} isn't what was parsed`);
      return bytes.toString("utf8");
    })();
    return pending;
  };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
