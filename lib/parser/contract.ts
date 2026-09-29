import { ROLE_IDS } from "../roles.ts";
import {
  EDGE_KINDS,
  SCHEMA_VERSION,
  type ConfigReport,
  type Coverage,
  type Edge,
  type EdgeKind,
  type ExcludedDirectory,
  type ExcludedReason,
  type OmittedRoute,
  type ParseResult,
  type ParsedFile,
  type Project,
  type Route,
  type SkippedFile,
  type SkipReason,
  type StatusCounts,
  type UnresolvedImport,
  type UnresolvedReason,
  type WithheldRoutes,
} from "./types.ts";

// Reading the output file back goes through here, so a file written by an older
// parser or edited by hand fails loudly with the field that's wrong, instead of
// becoming a ParseResult by assertion.

const SKIP_REASONS: readonly SkipReason[] = ["declaration-file", "too-large", "binary", "symlink", "syntax-error", "unreadable"];
const EXCLUDED_REASONS: readonly ExcludedReason[] = ["non-code-file", "declaration-file", "target-skipped", "in-excluded-directory"];
const UNRESOLVED_REASONS: readonly UnresolvedReason[] = [
  "non-literal-dynamic-import",
  "file-not-found",
  "directory-without-index",
  "alias-target-not-found",
  "workspace-package-not-linked",
  "subpath-import-not-found",
];

export function serializeParseResult(result: ParseResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function deserializeParseResult(text: string): ParseResult {
  return validateParseResult(JSON.parse(text));
}

export function validateParseResult(value: unknown): ParseResult {
  const o = object(value, "$");
  const schemaVersion = o.schemaVersion;
  if (schemaVersion !== SCHEMA_VERSION) {
    throw new ContractError("$.schemaVersion", `expected ${SCHEMA_VERSION}, got ${JSON.stringify(schemaVersion)}`);
  }
  const result: ParseResult = {
    schemaVersion,
    root: string(o.root, "$.root"),
    projects: array(o.projects, "$.projects", project),
    files: array(o.files, "$.files", parsedFile),
    edges: array(o.edges, "$.edges", edge),
    routes: array(o.routes, "$.routes", route),
    coverage: coverage(o.coverage, "$.coverage"),
    configs: array(o.configs, "$.configs", configReport),
  };

  // Structural guarantees the rest of the app relies on, checked rather than trusted.
  const paths = new Set(result.files.map((f) => f.path));
  result.edges.forEach((e, i) => {
    if (!paths.has(e.source)) throw new ContractError(`$.edges[${i}].source`, `${e.source} is not a file in the output`);
    if (!paths.has(e.target)) throw new ContractError(`$.edges[${i}].target`, `${e.target} is not a file in the output`);
  });
  result.routes.forEach((r, i) => {
    if (!paths.has(r.file)) throw new ContractError(`$.routes[${i}].file`, `${r.file} is not a file in the output`);
  });
  if (result.projects[0]?.path !== ".") throw new ContractError("$.projects[0].path", "the root must be the first project");
  const { found, parsed, skipped } = result.coverage.files;
  if (parsed !== result.files.length) throw new ContractError("$.coverage.files.parsed", `${parsed} but ${result.files.length} files listed`);
  if (found !== parsed + skipped) throw new ContractError("$.coverage.files.found", `${found} ≠ ${parsed} parsed + ${skipped} skipped`);
  return result;
}

export class ContractError extends Error {
  constructor(at: string, problem: string) {
    super(`Invalid parse output at ${at}: ${problem}`);
    this.name = "ContractError";
  }
}

function parsedFile(value: unknown, at: string): ParsedFile {
  const o = object(value, at);
  return {
    path: string(o.path, `${at}.path`),
    module: string(o.module, `${at}.module`),
    lines: count(o.lines, `${at}.lines`),
    bytes: count(o.bytes, `${at}.bytes`),
    hash: string(o.hash, `${at}.hash`),
    fanIn: count(o.fanIn, `${at}.fanIn`),
    fanOut: count(o.fanOut, `${at}.fanOut`),
    reachedBy: o.reachedBy === null ? null : string(o.reachedBy, `${at}.reachedBy`),
    role: o.role === null ? null : oneOf(o.role, `${at}.role`, ROLE_IDS),
  };
}

function route(value: unknown, at: string): Route {
  const o = object(value, at);
  const method = string(o.method, `${at}.method`);
  if (!/^[A-Z]+$/.test(method)) throw new ContractError(`${at}.method`, `expected an upper-case method, got ${JSON.stringify(method)}`);
  const pattern = string(o.pattern, `${at}.pattern`);
  if (!pattern.startsWith("/")) throw new ContractError(`${at}.pattern`, `expected a pattern starting with /, got ${JSON.stringify(pattern)}`);
  return { file: string(o.file, `${at}.file`), method, pattern, line: count(o.line, `${at}.line`) };
}

function omittedRoute(value: unknown, at: string): OmittedRoute {
  const o = object(value, at);
  return { file: string(o.file, `${at}.file`), line: count(o.line, `${at}.line`), reason: string(o.reason, `${at}.reason`) };
}

function withheldRoutes(value: unknown, at: string): WithheldRoutes {
  const o = object(value, at);
  return { project: string(o.project, `${at}.project`), reason: string(o.reason, `${at}.reason`) };
}

function project(value: unknown, at: string): Project {
  const o = object(value, at);
  return { path: string(o.path, `${at}.path`), adapter: string(o.adapter, `${at}.adapter`) };
}

function edge(value: unknown, at: string): Edge {
  const o = object(value, at);
  return {
    source: string(o.source, `${at}.source`),
    target: string(o.target, `${at}.target`),
    kind: oneOf(o.kind, `${at}.kind`, EDGE_KINDS),
    typeOnly: boolean(o.typeOnly, `${at}.typeOnly`),
    specifier: string(o.specifier, `${at}.specifier`),
    line: count(o.line, `${at}.line`),
  };
}

function coverage(value: unknown, at: string): Coverage {
  const o = object(value, at);
  const files = object(o.files, `${at}.files`);
  const imports = object(o.imports, `${at}.imports`);
  const byKind = object(imports.byKind, `${at}.imports.byKind`);
  const external = object(imports.external, `${at}.imports.external`);
  const routes = object(o.routes, `${at}.routes`);
  return {
    files: {
      found: count(files.found, `${at}.files.found`),
      parsed: count(files.parsed, `${at}.files.parsed`),
      skipped: count(files.skipped, `${at}.files.skipped`),
      skippedFiles: array(files.skippedFiles, `${at}.files.skippedFiles`, skippedFile),
      excludedDirectories: array(files.excludedDirectories, `${at}.files.excludedDirectories`, excludedDirectory),
    },
    imports: {
      total: statusCounts(imports.total, `${at}.imports.total`),
      byKind: {
        import: statusCounts(byKind.import, `${at}.imports.byKind.import`),
        "re-export": statusCounts(byKind["re-export"], `${at}.imports.byKind.re-export`),
        "dynamic-import": statusCounts(byKind["dynamic-import"], `${at}.imports.byKind.dynamic-import`),
      },
      external: {
        package: count(external.package, `${at}.imports.external.package`),
        builtin: count(external.builtin, `${at}.imports.external.builtin`),
        "outside-root": count(external["outside-root"], `${at}.imports.external.outside-root`),
      },
      excluded: countsKeyedBy(imports.excluded, `${at}.imports.excluded`, EXCLUDED_REASONS),
      unresolvedByReason: countsKeyedBy(imports.unresolvedByReason, `${at}.imports.unresolvedByReason`, UNRESOLVED_REASONS),
      unresolved: array(imports.unresolved, `${at}.imports.unresolved`, unresolvedImport),
    },
    routes: {
      omitted: array(routes.omitted, `${at}.routes.omitted`, omittedRoute),
      withheld: array(routes.withheld, `${at}.routes.withheld`, withheldRoutes),
    },
  };
}

function statusCounts(value: unknown, at: string): StatusCounts {
  const o = object(value, at);
  return {
    seen: count(o.seen, `${at}.seen`),
    internal: count(o.internal, `${at}.internal`),
    external: count(o.external, `${at}.external`),
    excluded: count(o.excluded, `${at}.excluded`),
    unresolved: count(o.unresolved, `${at}.unresolved`),
  };
}

function skippedFile(value: unknown, at: string): SkippedFile {
  const o = object(value, at);
  return {
    path: string(o.path, `${at}.path`),
    reason: oneOf(o.reason, `${at}.reason`, SKIP_REASONS),
    detail: string(o.detail, `${at}.detail`),
  };
}

function excludedDirectory(value: unknown, at: string): ExcludedDirectory {
  const o = object(value, at);
  return { path: string(o.path, `${at}.path`), reason: string(o.reason, `${at}.reason`) };
}

function unresolvedImport(value: unknown, at: string): UnresolvedImport {
  const o = object(value, at);
  return {
    from: string(o.from, `${at}.from`),
    specifier: string(o.specifier, `${at}.specifier`),
    kind: oneOf<EdgeKind>(o.kind, `${at}.kind`, EDGE_KINDS),
    line: count(o.line, `${at}.line`),
    reason: oneOf(o.reason, `${at}.reason`, UNRESOLVED_REASONS),
    detail: string(o.detail, `${at}.detail`),
  };
}

function configReport(value: unknown, at: string): ConfigReport {
  const o = object(value, at);
  return { path: string(o.path, `${at}.path`), errors: array(o.errors, `${at}.errors`, string) };
}

function countsKeyedBy<K extends string>(value: unknown, at: string, keys: readonly K[]): Partial<Record<K, number>> {
  const o = object(value, at);
  const out: Partial<Record<K, number>> = {};
  for (const [key, n] of Object.entries(o)) {
    out[oneOf(key, `${at} key`, keys)] = count(n, `${at}.${key}`);
  }
  return out;
}

function object(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ContractError(at, "expected an object");
  return Object.fromEntries(Object.entries(value));
}

function array<T>(value: unknown, at: string, item: (value: unknown, at: string) => T): T[] {
  if (!Array.isArray(value)) throw new ContractError(at, "expected an array");
  return value.map((v, i) => item(v, `${at}[${i}]`));
}

function string(value: unknown, at: string): string {
  if (typeof value !== "string") throw new ContractError(at, "expected a string");
  return value;
}

function boolean(value: unknown, at: string): boolean {
  if (typeof value !== "boolean") throw new ContractError(at, "expected a boolean");
  return value;
}

function count(value: unknown, at: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new ContractError(at, "expected a non-negative integer");
  return value;
}

function oneOf<T extends string>(value: unknown, at: string, allowed: readonly T[]): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw new ContractError(at, `expected one of ${allowed.join(", ")}, got ${JSON.stringify(value)}`);
  return match;
}
