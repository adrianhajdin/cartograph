import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import type { Role } from "../../roles.ts";
import { toolConventions, toolRole } from "./conventions.ts";
import { reactRole } from "./react.ts";
import type { FrameworkAdapter, ProjectFiles, RouteReport } from "./types.ts";

// Next.js reaches files by where they sit: app/ and pages/ routing, and a few
// files at the project root. Either may live under src/.

const CODE = /\.(js|jsx|ts|tsx)$/;
type Convention = { role: Role; reachedBy: string };

// The file names the app router treats specially. Anything else under app/ is
// an ordinary module that something has to import.
const APP_FILES: Record<string, Convention> = {
  page: { role: "page-route", reachedBy: "Next.js page" },
  route: { role: "api-endpoint", reachedBy: "Next.js route handler" },
  layout: { role: "layout", reachedBy: "Next.js layout" },
  template: { role: "layout", reachedBy: "Next.js template" },
  default: { role: "layout", reachedBy: "Next.js parallel route default" },
  loading: { role: "route-ui", reachedBy: "Next.js loading UI" },
  error: { role: "route-ui", reachedBy: "Next.js error boundary" },
  "global-error": { role: "route-ui", reachedBy: "Next.js error boundary" },
  "not-found": { role: "route-ui", reachedBy: "Next.js not-found page" },
  forbidden: { role: "route-ui", reachedBy: "Next.js forbidden page" },
  unauthorized: { role: "route-ui", reachedBy: "Next.js unauthorized page" },
  sitemap: { role: "metadata", reachedBy: "Next.js metadata file" },
  robots: { role: "metadata", reachedBy: "Next.js metadata file" },
  manifest: { role: "metadata", reachedBy: "Next.js metadata file" },
  icon: { role: "metadata", reachedBy: "Next.js metadata file" },
  "apple-icon": { role: "metadata", reachedBy: "Next.js metadata file" },
  "opengraph-image": { role: "metadata", reachedBy: "Next.js metadata file" },
  "twitter-image": { role: "metadata", reachedBy: "Next.js metadata file" },
};
// The pages router's own files at the top of pages/. Every other file there is a page.
const PAGES_FILES: Record<string, Convention> = {
  _app: { role: "layout", reachedBy: "Next.js custom App" },
  _document: { role: "layout", reachedBy: "Next.js custom Document" },
  _error: { role: "route-ui", reachedBy: "Next.js error page" },
  "404": { role: "route-ui", reachedBy: "Next.js not-found page" },
  "500": { role: "route-ui", reachedBy: "Next.js error page" },
};
const ROOT_FILES: Record<string, Convention> = {
  middleware: { role: "middleware", reachedBy: "Next.js middleware" },
  proxy: { role: "middleware", reachedBy: "Next.js proxy" },
  instrumentation: { role: "instrumentation", reachedBy: "Next.js instrumentation" },
  "instrumentation-client": { role: "instrumentation", reachedBy: "Next.js instrumentation" },
};

// The methods a route handler can export, by name.
const HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]);
const CONFIG = /^next\.config\.[cm]?[jt]s$/;

export const nextjsAdapter: FrameworkAdapter = {
  name: "Next.js",
  detect: (project) => project.dependencies.has("next"),
  // Build output is dot-prefixed, so the generic rule already skips it.
  excludeDirectory: () => null,
  reachedBy: (path) => nextConvention(path)?.reachedBy ?? toolConventions(path),
  roleOf(file) {
    return nextConvention(file.path)?.role ?? toolRole(file.path) ?? (usesServer(file.source) ? "server-action" : reactRole(file));
  },
  routes: nextRoutes,
};

function withoutSrc(path: string): string {
  return path.startsWith("src/") ? path.slice(4) : path;
}

function nextConvention(path: string): Convention | null {
  if (!CODE.test(path)) return null;
  const p = withoutSrc(path);
  const name = p.slice(p.lastIndexOf("/") + 1).replace(CODE, "");

  if (p.startsWith("app/")) {
    // A folder starting with "_" is private: nothing inside it is routed.
    if (appSegments(p).some((s) => s.startsWith("_"))) return null;
    return APP_FILES[name] ?? null;
  }
  if (p.startsWith("pages/api/")) return { role: "api-endpoint", reachedBy: "Next.js API route" };
  if (p.startsWith("pages/")) {
    const top = p.slice("pages/".length).includes("/") ? undefined : PAGES_FILES[name];
    return top ?? { role: "page-route", reachedBy: "Next.js page" };
  }
  if (!p.includes("/")) return ROOT_FILES[name] ?? null;
  return null;
}

/** The folders between app/ and the file. */
function appSegments(p: string): string[] {
  return p.split("/").slice(1, -1);
}

// A module whose directive prologue says "use server": every export is a
// server action. An inline directive inside one function doesn't make the
// file one.
function usesServer(source: SourceFile): boolean {
  for (const statement of source.getStatements()) {
    if (!Node.isExpressionStatement(statement)) return false;
    const expression = statement.getExpression();
    if (!Node.isStringLiteral(expression)) return false;
    if (expression.getLiteralValue() === "use server") return true;
  }
  return false;
}

// Route handlers only. The pattern is the folder path, which Next.js defines
// exactly; the method is the name of an export. A page has no method written
// anywhere, and a pages/api handler picks its method at runtime, so neither is
// listed.
function nextRoutes({ files, unparsed }: ProjectFiles): RouteReport {
  const report: RouteReport = { routes: [], omitted: [], withheld: null };

  // basePath prefixes every route, so the config has to be read before any
  // pattern is known.
  const configs = files.filter((f) => CONFIG.test(f.path));
  const unreadConfig = unparsed.find((p) => CONFIG.test(p));
  if (unreadConfig) return { ...report, withheld: `${unreadConfig} couldn't be parsed, so basePath is unknown` };
  let basePath = "";
  for (const config of configs) {
    const read = readConfig(config.source);
    if ("withheld" in read) return { ...report, withheld: `${config.path} ${read.withheld}` };
    if (read.basePath !== null) {
      if (basePath !== "" && basePath !== read.basePath) return { ...report, withheld: "more than one next.config sets basePath" };
      basePath = read.basePath;
    }
  }

  for (const file of files) {
    const p = withoutSrc(file.path);
    if (nextConvention(file.path)?.role !== "api-endpoint") continue;

    if (p.startsWith("pages/api/")) {
      report.omitted.push({ path: file.path, line: 1, reason: "a pages/api handler chooses its method at runtime" });
      continue;
    }

    const segments = appSegments(p);
    const intercepting = segments.find((s) => s.startsWith("(."));
    if (intercepting) {
      report.omitted.push({ path: file.path, line: 1, reason: `${intercepting} is an intercepting segment, which matches by navigation, not by path` });
      continue;
    }
    if (segments.some((s) => s.includes("%"))) {
      report.omitted.push({ path: file.path, line: 1, reason: "a folder name is URL-encoded" });
      continue;
    }
    // Route groups and parallel-route slots are left out of the URL by definition.
    const kept = segments.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@"));
    const pattern = `${basePath}/${kept.join("/")}`.replace(/\/$/, "") || "/";

    const { methods, starExport } = exportedMethods(file.source);
    for (const { method, line } of methods) report.routes.push({ path: file.path, method, pattern, line });
    if (starExport !== null) {
      report.omitted.push({ path: file.path, line: starExport, reason: "export * hides which methods come from the other module" });
    } else if (methods.length === 0) {
      report.omitted.push({ path: file.path, line: 1, reason: "no exported HTTP method was found" });
    }
  }
  return report;
}

type ConfigRead = { basePath: string | null } | { withheld: string };

// Any property called basePath or pageExtensions, wherever it sits: the config
// is usually an object literal, but it may be built by a function, and a
// property anywhere in the file could be the one Next.js reads.
function readConfig(source: SourceFile): ConfigRead {
  let basePath: string | null = null;
  for (const property of source.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    const name = property.getName().replace(/^["']|["']$/g, "");
    if (name === "pageExtensions") return { withheld: "sets pageExtensions, so which files are route handlers is uncertain" };
    if (name !== "basePath") continue;
    const value = property.getInitializer();
    if (!value || !(Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value))) {
      return { withheld: "sets basePath to a computed value" };
    }
    if (basePath !== null && basePath !== value.getLiteralValue()) return { withheld: "sets basePath more than once" };
    basePath = value.getLiteralValue();
  }
  for (const shorthand of source.getDescendantsOfKind(SyntaxKind.ShorthandPropertyAssignment)) {
    if (shorthand.getName() === "basePath") return { withheld: "sets basePath from a variable" };
    if (shorthand.getName() === "pageExtensions") return { withheld: "sets pageExtensions, so which files are route handlers is uncertain" };
  }
  return { basePath };
}

function exportedMethods(source: SourceFile): { methods: { method: string; line: number }[]; starExport: number | null } {
  const methods = new Map<string, number>();
  const add = (name: string, line: number) => {
    if (HTTP_METHODS.has(name) && !methods.has(name)) methods.set(name, line);
  };
  let starExport: number | null = null;

  for (const statement of source.getStatements()) {
    // A default export named GET is still the default export, not GET.
    const exported = Node.isExportable(statement) && statement.hasExportKeyword() && !statement.hasDefaultKeyword();
    if (Node.isFunctionDeclaration(statement) && exported) {
      const name = statement.getName();
      if (name) add(name, statement.getStartLineNumber());
    } else if (Node.isVariableStatement(statement) && exported) {
      // `export const GET = …` and `export const { GET, POST } = handlers`.
      for (const declaration of statement.getDeclarations()) {
        const binding = declaration.getNameNode();
        if (Node.isIdentifier(binding)) add(binding.getText(), declaration.getStartLineNumber());
        else if (Node.isObjectBindingPattern(binding)) {
          for (const element of binding.getElements()) add(element.getName(), element.getStartLineNumber());
        }
      }
    } else if (Node.isExportDeclaration(statement)) {
      // `export { handler as GET }`, with or without a module specifier.
      if (statement.isNamespaceExport() && !statement.getNamespaceExport()) {
        starExport ??= statement.getStartLineNumber();
        continue;
      }
      for (const specifier of statement.getNamedExports()) {
        add(specifier.getAliasNode()?.getText() ?? specifier.getName(), specifier.getStartLineNumber());
      }
    }
  }
  return { methods: [...methods].map(([method, line]) => ({ method, line })), starExport };
}
