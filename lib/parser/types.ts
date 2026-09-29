// The shape the parser writes. Everything built after the parser reads this,
// so changing it means bumping SCHEMA_VERSION and updating the validator.

import type { Role } from "../roles.ts";

export const SCHEMA_VERSION = 3;

export type EdgeKind = "import" | "re-export" | "dynamic-import";

export const EDGE_KINDS: readonly EdgeKind[] = ["import", "re-export", "dynamic-import"];

export type ParsedFile = {
  /** Repository-relative, forward slashes. */
  path: string;
  /** The folder the file sits in, repository-relative. "." for the root. */
  module: string;
  lines: number;
  bytes: number;
  /** sha256 of the raw contents, hex. */
  hash: string;
  /** Distinct files that import this one. */
  fanIn: number;
  /** Distinct files this one imports. */
  fanOut: number;
  /**
   * How something other than an import reaches this file, from the adapter of
   * the project it sits in: "Next.js page", "test file, …". Null when only an
   * import would.
   */
  reachedBy: string | null;
  /** The role a convention of its project's adapter gives it. Null when none does. */
  role: Role | null;
};

/** The repository root, and every folder below it whose package.json a framework adapter detected. */
export type Project = {
  path: string;
  /** The adapter that detected it. "none" is the fallback. */
  adapter: string;
};

export type Edge = {
  source: string;
  target: string;
  kind: EdgeKind;
  /** True only when every occurrence of this source→target→kind is type-only. */
  typeOnly: boolean;
  /** The specifier and line of the first occurrence. */
  specifier: string;
  line: number;
};

/** One method on one pattern, both read from the syntax. */
export type Route = {
  /** The file that declares it. */
  file: string;
  /** Upper case, as the framework spells it: GET, POST, ALL. */
  method: string;
  /** The full path pattern in the framework's own syntax: /users/:id, /blog/[slug]. */
  pattern: string;
  /** Where it's declared: the export or the decorator. */
  line: number;
};

export type OmittedRoute = { file: string; line: number; reason: string };

export type WithheldRoutes = { project: string; reason: string };

export type SkipReason =
  | "declaration-file"
  | "too-large"
  | "binary"
  | "symlink"
  | "syntax-error"
  | "unreadable";

export type SkippedFile = {
  path: string;
  reason: SkipReason;
  detail: string;
};

export type ExcludedDirectory = {
  path: string;
  reason: string;
};

export type ExternalKind = "package" | "builtin" | "outside-root";

export type ExcludedReason =
  | "non-code-file"
  | "declaration-file"
  | "target-skipped"
  | "in-excluded-directory";

export type UnresolvedReason =
  | "non-literal-dynamic-import"
  | "file-not-found"
  | "directory-without-index"
  | "alias-target-not-found"
  | "workspace-package-not-linked"
  | "subpath-import-not-found";

export type ImportStatus =
  | { status: "internal"; target: string }
  | { status: "external"; external: ExternalKind }
  | { status: "excluded"; reason: ExcludedReason; detail: string }
  | { status: "unresolved"; reason: UnresolvedReason; detail: string };

export type UnresolvedImport = {
  from: string;
  /** The literal text; for a non-literal dynamic import, the expression source. */
  specifier: string;
  kind: EdgeKind;
  line: number;
  reason: UnresolvedReason;
  detail: string;
};

export type StatusCounts = {
  seen: number;
  internal: number;
  external: number;
  excluded: number;
  unresolved: number;
};

export type Coverage = {
  files: {
    found: number;
    parsed: number;
    skipped: number;
    skippedFiles: SkippedFile[];
    excludedDirectories: ExcludedDirectory[];
  };
  imports: {
    total: StatusCounts;
    byKind: Record<EdgeKind, StatusCounts>;
    external: Record<ExternalKind, number>;
    excluded: Partial<Record<ExcludedReason, number>>;
    unresolvedByReason: Partial<Record<UnresolvedReason, number>>;
    /** Every failure, not a sample. */
    unresolved: UnresolvedImport[];
  };
  routes: {
    /** Route declarations left out because the method or the full pattern isn't written in the syntax. */
    omitted: OmittedRoute[];
    /** Projects where something sets every pattern at runtime, so none of their routes is listed. */
    withheld: WithheldRoutes[];
  };
};

export type ConfigReport = {
  /** Repository-relative tsconfig/jsconfig path. */
  path: string;
  /** Problems TypeScript reported reading it. Resolution still used what it could read. */
  errors: string[];
};

export type ParseResult = {
  schemaVersion: typeof SCHEMA_VERSION;
  /** Absolute path the parser was pointed at. */
  root: string;
  /** Root first, then in walk order. */
  projects: Project[];
  files: ParsedFile[];
  edges: Edge[];
  /** Sorted by pattern, then method. */
  routes: Route[];
  coverage: Coverage;
  configs: ConfigReport[];
};
