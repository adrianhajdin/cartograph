import type { SourceFile } from "ts-morph";
import type { Framework, Role } from "../../roles.ts";

// Framework knowledge enters the parser only through this interface. The parser
// asks the adapter questions; it never checks which framework it is looking at.
//
// A project is the repository root or any folder holding a package.json, and
// each project gets its own adapter, so a Next.js example inside a repository
// that isn't Next.js still has its pages recognised. Every path an adapter is
// asked about is relative to its project, not the repository.

export type ProjectInfo = {
  /** Absolute path of the project folder. */
  dir: string;
  /** Every name in the project's dependencies and devDependencies. */
  dependencies: ReadonlySet<string>;
};

/** A file that parsed cleanly, with its syntax tree. */
export type AdapterFile = { path: string; source: SourceFile };

export type ProjectFiles = {
  files: readonly AdapterFile[];
  /** Code files in the project that were skipped, so their syntax is unknown. */
  unparsed: readonly string[];
};

export type AdapterRoute = { path: string; method: string; pattern: string; line: number };

export type RouteReport = {
  routes: AdapterRoute[];
  /** Something the syntax declares as a route, left out because its method or full pattern isn't written there. */
  omitted: { path: string; line: number; reason: string }[];
  /**
   * Set when something project-wide makes every pattern uncertain, such as a
   * prefix computed at runtime. Then no route is listed at all.
   */
  withheld: string | null;
};

export const NO_ROUTES: RouteReport = { routes: [], omitted: [], withheld: null };

export interface FrameworkAdapter {
  name: Framework;
  /** Whether this adapter applies to the project. */
  detect(project: ProjectInfo): boolean;
  /**
   * Called for each directory the walker is about to enter. Return a reason to
   * skip it, or null to walk it. Generic exclusions (node_modules,
   * dot-directories) are applied before this is asked.
   */
  excludeDirectory(projectRelativeDir: string): string | null;
  /**
   * How something other than an import reaches this file — the framework
   * routing to it, a tool loading it by name, a test runner collecting it — or
   * null when only imports would. Answered from the path alone, so it's a
   * convention the file sits in, never a guess about what it does.
   */
  reachedBy(projectRelativePath: string): string | null;
  /**
   * The file's role from a convention: where it sits, what it's named, or a
   * directive or syntax it contains. Null when none applies; the file stays
   * unclassified rather than getting the nearest fit.
   */
  roleOf(file: AdapterFile): Role | null;
  /** Routes whose method and full pattern are both written in the syntax. */
  routes(project: ProjectFiles): RouteReport;
}
