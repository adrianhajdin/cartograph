import type { SupabaseClient } from "@supabase/supabase-js";
import type { Coverage, ParseResult } from "../parser/index.ts";
import type { Database, Json } from "../supabase/database.types.ts";

type Db = SupabaseClient<Database>;

// Each request stays well inside PostgREST's statement timeout. Chunks aren't
// one transaction, but nothing reads as complete until the final update, and a
// failure part-way marks the run failed.
const FILE_CHUNK = 1000;
const EDGE_CHUNK = 2000;
const ROLE_CHUNK = 2000;
const ROUTE_CHUNK = 2000;

// The skipped-file list lives in the files table; storing it twice would let
// the two disagree.
export type StoredCoverage = Omit<Coverage, "files"> & { files: Omit<Coverage["files"], "skippedFiles"> };

export async function storeResult(db: Db, analysis: { id: string; organizationId: string }, result: ParseResult): Promise<void> {
  // A re-run replaces what the last run stored; edges go with their files.
  const cleared = await db.from("files").delete().eq("analysis_id", analysis.id);
  if (cleared.error) throw new Error(`Clearing the previous run's files failed: ${cleared.error.message}`);

  const rows: Database["public"]["Tables"]["files"]["Insert"][] = [
    ...result.files.map((f) => ({
      organization_id: analysis.organizationId,
      analysis_id: analysis.id,
      path: f.path,
      module: f.module,
      lines: f.lines,
      bytes: f.bytes,
      hash: f.hash,
      fan_in: f.fanIn,
      fan_out: f.fanOut,
      reached_by: f.reachedBy,
    })),
    ...result.coverage.files.skippedFiles.map((f) => ({
      organization_id: analysis.organizationId,
      analysis_id: analysis.id,
      path: f.path,
      skip_reason: f.reason,
      skip_detail: f.detail,
    })),
  ];
  for (let i = 0; i < rows.length; i += FILE_CHUNK) {
    const { error } = await db.from("files").insert(rows.slice(i, i + FILE_CHUNK));
    if (error) throw new Error(`Storing files failed: ${error.message}`);
  }

  // Ends are matched to stored files by path in the database, which refuses
  // the whole chunk if any edge doesn't match.
  const edges = result.edges.map((e) => ({
    source: e.source,
    target: e.target,
    kind: e.kind,
    specifier: e.specifier,
    type_only: e.typeOnly,
    line: e.line,
  }));
  for (let i = 0; i < edges.length; i += EDGE_CHUNK) {
    const { error } = await db.rpc("insert_edges", { p_analysis_id: analysis.id, p_edges: edges.slice(i, i + EDGE_CHUNK) });
    if (error) throw new Error(`Storing edges failed: ${error.message}`);
  }

  // Roles and routes go with their files too, and are matched to them by path the same way.
  const roles = result.files.flatMap((f) => (f.role === null ? [] : [{ path: f.path, role: f.role }]));
  for (let i = 0; i < roles.length; i += ROLE_CHUNK) {
    const { error } = await db.rpc("insert_file_roles", { p_analysis_id: analysis.id, p_roles: roles.slice(i, i + ROLE_CHUNK) });
    if (error) throw new Error(`Storing roles failed: ${error.message}`);
  }
  for (let i = 0; i < result.routes.length; i += ROUTE_CHUNK) {
    const { error } = await db.rpc("insert_routes", { p_analysis_id: analysis.id, p_routes: result.routes.slice(i, i + ROUTE_CHUNK) });
    if (error) throw new Error(`Storing routes failed: ${error.message}`);
  }
}

export function storedCoverage(coverage: Coverage): Json {
  const { found, parsed, skipped, excludedDirectories } = coverage.files;
  const stored: StoredCoverage = { ...coverage, files: { found, parsed, skipped, excludedDirectories } };
  return stored;
}
