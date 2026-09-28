import type { SupabaseClient } from "@supabase/supabase-js";
import { validateParseResult } from "../parser/contract.ts";
import { SCHEMA_VERSION, type ParseResult } from "../parser/types.ts";
import type { Database } from "../supabase/database.types.ts";

type Db = SupabaseClient<Database>;

// PostgREST returns at most this many rows per request, so larger analyses
// are read in pages. Bounded by the analysis itself, never open-ended.
const PAGE = 1000;

// Rebuilds a complete analysis from its rows and puts it back through the
// parser's contract, so what the map draws is checked the same way a parser
// output file was: an edge to a file that isn't there, or counts that don't
// add up, fail by field instead of drawing. Reads with the caller's client,
// so the policies decide whether any of it comes back.
export async function loadStoredAnalysis(db: Db, analysis: { id: string; label: string; coverage: unknown; projects: unknown }): Promise<ParseResult> {
  const files = await readAll((from, to) =>
    db
      .from("files")
      .select("id, path, module, lines, bytes, hash, fan_in, fan_out, reached_by, skip_reason, skip_detail")
      .eq("analysis_id", analysis.id)
      .order("id")
      .range(from, to),
  );
  const edges = await readAll((from, to) =>
    db
      .from("edges")
      .select("source_file_id, target_file_id, kind, type_only, specifier, line")
      .eq("analysis_id", analysis.id)
      .order("id")
      .range(from, to),
  );

  const pathOf = new Map(files.map((f) => [f.id, f.path]));
  const parsed = files.filter((f) => f.skip_reason === null);
  const skipped = files.filter((f) => f.skip_reason !== null);
  const coverage = typeof analysis.coverage === "object" && analysis.coverage !== null ? analysis.coverage : {};
  const coverageFiles: unknown = Reflect.get(coverage, "files");

  return validateParseResult({
    schemaVersion: SCHEMA_VERSION,
    root: analysis.label,
    projects: analysis.projects,
    files: parsed
      .map((f) => ({
        path: f.path,
        module: f.module,
        lines: f.lines,
        bytes: f.bytes,
        hash: f.hash,
        fanIn: f.fan_in,
        fanOut: f.fan_out,
        reachedBy: f.reached_by,
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    edges: edges.map((e) => ({
      source: pathOf.get(e.source_file_id),
      target: pathOf.get(e.target_file_id),
      kind: e.kind,
      typeOnly: e.type_only,
      specifier: e.specifier,
      line: e.line,
    })),
    coverage: {
      ...coverage,
      files: {
        ...(typeof coverageFiles === "object" && coverageFiles !== null ? coverageFiles : {}),
        skippedFiles: skipped
          .map((f) => ({ path: f.path, reason: f.skip_reason, detail: f.skip_detail }))
          .sort((a, b) => a.path.localeCompare(b.path)),
      },
    },
    // Config problems aren't stored; nothing on the map reads them.
    configs: [],
  });
}

async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`Reading the stored analysis failed: ${error.message}`);
    if (!data) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}
