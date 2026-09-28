import { statSync } from "node:fs";
import path from "node:path";
import { Project, ts } from "ts-morph";
import { extractImports } from "./extract.ts";
import { dedupeEdges, fanCounts } from "./graph.ts";
import { createResolver } from "./resolve.ts";
import {
  SCHEMA_VERSION,
  type Coverage,
  type Edge,
  type ImportStatus,
  type ParseResult,
  type ParsedFile,
  type SkippedFile,
  type StatusCounts,
} from "./types.ts";
import { walkRepository, type WalkResult } from "./walk.ts";

export type Selection = { root: string; walk: WalkResult };

export function parseRepository(directory: string): ParseResult {
  return parseSelection(selectFiles(directory));
}

// Selecting and parsing are separate calls so a caller can report which one
// it's in; together they are exactly parseRepository.
export function selectFiles(directory: string): Selection {
  const root = path.resolve(directory);
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }
  return { root, walk: walkRepository(root) };
}

export function parseSelection({ root, walk }: Selection): ParseResult {

  // Parsing only: no lib, no type resolution. Imports are resolved separately
  // so every outcome can be classified rather than left to the compiler.
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: true, noLib: true, noResolve: true, types: [] },
  });
  const sourceFiles = walk.candidates.map((candidate) => ({
    candidate,
    sourceFile: project.createSourceFile(candidate.absolutePath, candidate.content, { overwrite: true }),
  }));
  const program = project.getProgram();

  const skipped: SkippedFile[] = [...walk.skipped];
  const parsed: typeof sourceFiles = [];
  for (const entry of sourceFiles) {
    const [first, ...rest] = program.getSyntacticDiagnostics(entry.sourceFile);
    if (!first) {
      parsed.push(entry);
      continue;
    }
    // A file that doesn't parse cleanly would give a partial import list. Absent beats approximate.
    const message = ts.flattenDiagnosticMessageText(first.compilerObject.messageText, " ");
    skipped.push({
      path: entry.candidate.path,
      reason: "syntax-error",
      detail: `line ${first.getLineNumber() ?? "?"}: ${message}${rest.length ? ` (+${rest.length} more)` : ""}`,
    });
  }
  skipped.sort((a, b) => a.path.localeCompare(b.path));

  const resolver = createResolver({
    root,
    nodes: new Set(parsed.map((entry) => entry.candidate.path)),
    skipped: new Map(skipped.map((file) => [file.path, file])),
    excludedDirectories: walk.excludedDirectories,
    workspacePackages: walk.workspacePackages,
  });

  const coverage: Coverage["imports"] = {
    total: emptyCounts(),
    byKind: { import: emptyCounts(), "re-export": emptyCounts(), "dynamic-import": emptyCounts() },
    external: { package: 0, builtin: 0, "outside-root": 0 },
    excluded: {},
    unresolvedByReason: {},
    unresolved: [],
  };
  const rawEdges: Edge[] = [];

  for (const { candidate, sourceFile } of parsed) {
    for (const found of extractImports(sourceFile)) {
      const specifier = found.literal ? found.specifier : found.expression;
      const outcome: ImportStatus = found.literal
        ? resolver.resolve(candidate.absolutePath, found.specifier, found.kind)
        : { status: "unresolved", reason: "non-literal-dynamic-import", detail: "the path is computed at runtime" };

      coverage.total.seen++;
      coverage.byKind[found.kind].seen++;
      coverage.total[outcome.status]++;
      coverage.byKind[found.kind][outcome.status]++;

      switch (outcome.status) {
        case "internal":
          rawEdges.push({
            source: candidate.path,
            target: outcome.target,
            kind: found.kind,
            typeOnly: found.typeOnly,
            specifier,
            line: found.line,
          });
          break;
        case "external":
          coverage.external[outcome.external]++;
          break;
        case "excluded":
          coverage.excluded[outcome.reason] = (coverage.excluded[outcome.reason] ?? 0) + 1;
          break;
        case "unresolved":
          coverage.unresolvedByReason[outcome.reason] = (coverage.unresolvedByReason[outcome.reason] ?? 0) + 1;
          coverage.unresolved.push({
            from: candidate.path,
            specifier,
            kind: found.kind,
            line: found.line,
            reason: outcome.reason,
            detail: outcome.detail,
          });
          break;
      }
    }
  }

  const edges = dedupeEdges(rawEdges);
  const paths = parsed.map((entry) => entry.candidate.path);
  const fan = fanCounts(paths, edges);
  const files: ParsedFile[] = parsed
    .map(({ candidate }) => ({
      path: candidate.path,
      module: candidate.module,
      lines: candidate.lines,
      bytes: candidate.bytes,
      hash: candidate.hash,
      fanIn: fan.get(candidate.path)?.fanIn ?? 0,
      fanOut: fan.get(candidate.path)?.fanOut ?? 0,
      reachedBy: candidate.reachedBy,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  if (files.length + skipped.length !== walk.found) {
    throw new Error(`Coverage doesn't add up: found ${walk.found}, parsed ${files.length}, skipped ${skipped.length}`);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    root,
    projects: walk.projects,
    files,
    edges,
    coverage: {
      files: {
        found: walk.found,
        parsed: files.length,
        skipped: skipped.length,
        skippedFiles: skipped,
        excludedDirectories: walk.excludedDirectories,
      },
      imports: coverage,
    },
    configs: resolver.configs(),
  };
}

function emptyCounts(): StatusCounts {
  return { seen: 0, internal: 0, external: 0, excluded: 0, unresolved: 0 };
}

export type * from "./types.ts";
