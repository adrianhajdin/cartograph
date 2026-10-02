import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClassifyInput, FileInput, FolderFile, FolderInput, NeighbourFacts } from "../ai/prompts.ts";
import { foldDirectories } from "../graph/fold.ts";
import { EDGE_KINDS, type EdgeKind } from "../parser/types.ts";
import type { Database } from "../supabase/database.types.ts";
import { readAll } from "./load.ts";

type Db = SupabaseClient<Database>;

// What the model is handed, read from the stored analysis and nowhere else.
// The browser names a file or folder; which files are its neighbours is read
// here from the edges the parser stored, never taken from the request. Reads
// go through the caller's client, so the policies decide what comes back.

export type StoredFile = { id: string; path: string; hash: string; conventionRole: boolean };

export async function loadFileInput(
  db: Db,
  analysisId: string,
  path: string,
): Promise<{ file: StoredFile; input: FileInput; classify: ClassifyInput } | null> {
  const { data: file, error } = await db
    .from("files")
    .select("id, path, hash, exports, reached_by, skip_reason, file_roles(role, source)")
    .eq("analysis_id", analysisId)
    .eq("path", path)
    .maybeSingle();
  if (error) throw new Error(`Reading ${path} failed: ${error.message}`);
  if (!file) return null;
  if (file.skip_reason !== null || file.hash === null) {
    throw new Error(`${path} was skipped by the parser, so there's nothing parsed to explain`);
  }
  if (file.exports === null) {
    throw new Error(`${path} was stored by an older parser that didn't record exports; re-run the analysis to explain it`);
  }

  const edges = await readAll((from, to) =>
    db
      .from("edges")
      .select(
        "id, kind, type_only, source_file_id, target_file_id, source:files!edges_source_file_id_organization_id_fkey(path, exports, file_roles(role, source)), target:files!edges_target_file_id_organization_id_fkey(path, exports, file_roles(role, source))",
      )
      .eq("analysis_id", analysisId)
      .or(`source_file_id.eq.${file.id},target_file_id.eq.${file.id}`)
      .order("id")
      .range(from, to),
  );

  const imports = new Map<string, NeighbourFacts>();
  const importedBy = new Map<string, NeighbourFacts>();
  for (const e of edges) {
    const outgoing = e.source_file_id === file.id;
    const other = outgoing ? e.target : e.source;
    if (!other) throw new Error(`An edge of ${path} points at a file that isn't stored`);
    // A file importing itself would sit in both lists; the parser's own
    // counts include it that way too.
    if (outgoing) add(imports, other, e.kind, e.type_only);
    if (e.target_file_id === file.id) add(importedBy, other, e.kind, e.type_only);
  }

  const role = file.file_roles[0] ?? null;
  const input: FileInput = {
    path: file.path,
    hash: file.hash,
    role: role?.role ?? null,
    reachedBy: file.reached_by,
    exports: file.exports,
    imports: sorted(imports),
    importedBy: sorted(importedBy),
  };
  const classify: ClassifyInput = {
    path: file.path,
    hash: file.hash,
    exports: file.exports,
    imports: input.imports.map((n) => ({ path: n.path, role: n.role })),
    importedBy: input.importedBy.map((n) => ({ path: n.path, role: n.role })),
  };
  return { file: { id: file.id, path: file.path, hash: file.hash, conventionRole: role?.source === "convention" }, input, classify };
}

// The folder is a group of the same folding the map draws, worked out from the
// same parsed file list, so the question is about the box that was clicked.
export async function loadFolderInput(db: Db, analysisId: string, dir: string): Promise<FolderInput | null> {
  const rows = await readAll((from, to) =>
    db
      .from("files")
      .select("id, path, module, hash, exports, fan_in, fan_out, file_roles(role, source)")
      .eq("analysis_id", analysisId)
      .is("skip_reason", null)
      .order("id")
      .range(from, to),
  );
  const files = rows.map((r) => {
    if (r.module === null || r.hash === null || r.exports === null || r.fan_in === null || r.fan_out === null) {
      throw new Error(`Stored parsed file ${r.path} is missing its measurements`);
    }
    return { ...r, module: r.module, hash: r.hash, exports: r.exports, fan_in: r.fan_in, fan_out: r.fan_out };
  });
  const group = foldDirectories(files).groups.find((g) => g.dir === dir);
  if (!group) return null;

  const inside = new Set(group.files);
  const pathOf = new Map(files.map((f) => [f.id, f.path]));
  const edges = await readAll((from, to) =>
    db.from("edges").select("id, source_file_id, target_file_id").eq("analysis_id", analysisId).order("id").range(from, to),
  );
  const incoming = new Map<string, { from: string; to: string }>();
  const outgoing = new Map<string, { from: string; to: string }>();
  for (const e of edges) {
    const source = pathOf.get(e.source_file_id);
    const target = pathOf.get(e.target_file_id);
    if (source === undefined || target === undefined) throw new Error("A stored edge points at a file that isn't a stored parsed file");
    if (!inside.has(source) && inside.has(target)) incoming.set(`${source}\0${target}`, { from: source, to: target });
    if (inside.has(source) && !inside.has(target)) outgoing.set(`${source}\0${target}`, { from: source, to: target });
  }

  const byPath = new Map(files.map((f) => [f.path, f]));
  const members: FolderFile[] = group.files.map((p) => {
    const f = byPath.get(p);
    if (!f) throw new Error(`Folded file ${p} isn't in the file list it was folded from`);
    return { path: f.path, hash: f.hash, role: conventionRole(f.file_roles), exports: f.exports, fanIn: f.fan_in, fanOut: f.fan_out };
  });
  const order = (a: { from: string; to: string }, b: { from: string; to: string }) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to);
  return { dir, files: members, incoming: [...incoming.values()].sort(order), outgoing: [...outgoing.values()].sort(order) };
}

type RoleRow = { role: string; source: string };
type Other = { path: string; exports: string[] | null; file_roles: RoleRow[] };

// Other files' roles go to the model only when convention gave them. A label
// the model gave one file later would otherwise change every neighbour's and
// folder's question, and throw away their cached answers for nothing the
// parser found.
function conventionRole(rows: RoleRow[]): string | null {
  const row = rows[0];
  return row?.source === "convention" ? row.role : null;
}

function add(into: Map<string, NeighbourFacts>, other: Other, kind: string, typeOnly: boolean): void {
  if (!isEdgeKind(kind)) throw new Error(`Stored edge kind "${kind}" isn't one the parser produces`);
  const existing = into.get(other.path);
  if (!existing) {
    into.set(other.path, { path: other.path, role: conventionRole(other.file_roles), exports: other.exports ?? [], kinds: [kind], typeOnly });
    return;
  }
  if (!existing.kinds.includes(kind)) existing.kinds.push(kind);
  existing.typeOnly &&= typeOnly;
}

function sorted(map: Map<string, NeighbourFacts>): NeighbourFacts[] {
  return [...map.values()]
    .map((n) => ({ ...n, kinds: EDGE_KINDS.filter((k) => n.kinds.includes(k)) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function isEdgeKind(kind: string): kind is EdgeKind {
  return (EDGE_KINDS as readonly string[]).includes(kind);
}
