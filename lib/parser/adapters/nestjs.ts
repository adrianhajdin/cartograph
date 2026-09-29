import { Node, SyntaxKind, type Decorator, type Expression, type SourceFile } from "ts-morph";
import type { Role } from "../../roles.ts";
import { toolConventions, toolRole } from "./conventions.ts";
import type { FrameworkAdapter, ProjectFiles, RouteReport } from "./types.ts";

// NestJS names a file for what it holds — users.controller.ts,
// users.service.ts — which is the suffix its CLI generates. Routes are
// assembled from the controller's decorator and the method's together, plus a
// global prefix if the bootstrap sets one.

const SUFFIX_ROLES: Record<string, Role> = {
  controller: "controller",
  resolver: "resolver",
  gateway: "gateway",
  service: "service",
  module: "module",
  entity: "entity",
  dto: "dto",
  repository: "repository",
  middleware: "middleware",
  guard: "guard",
  interceptor: "interceptor",
  pipe: "pipe",
  filter: "filter",
};
const SUFFIX = new RegExp(`\\.(${Object.keys(SUFFIX_ROLES).join("|")})\\.[cm]?[jt]s$`);

// The route decorators @nestjs/common exports, and the method each one maps.
const METHOD_DECORATORS: Record<string, string> = {
  Get: "GET",
  Post: "POST",
  Put: "PUT",
  Delete: "DELETE",
  Patch: "PATCH",
  Options: "OPTIONS",
  Head: "HEAD",
  Search: "SEARCH",
  All: "ALL",
};

export const nestjsAdapter: FrameworkAdapter = {
  name: "NestJS",
  detect: (project) => project.dependencies.has("@nestjs/core"),
  // Where the Nest CLI compiles to. Some repositories commit it, and walking it
  // would count every controller twice.
  excludeDirectory: (dir) => (dir === "dist" ? "NestJS build output" : null),
  reachedBy: toolConventions,
  roleOf(file) {
    const suffix = SUFFIX.exec(file.path.slice(file.path.lastIndexOf("/") + 1));
    return (suffix?.[1] ? SUFFIX_ROLES[suffix[1]] : undefined) ?? toolRole(file.path);
  },
  routes: nestRoutes,
};

function nestRoutes({ files, unparsed }: ProjectFiles): RouteReport {
  const report: RouteReport = { routes: [], omitted: [], withheld: null };
  const withhold = (reason: string): RouteReport => ({ ...report, withheld: reason });

  // Anything that changes every pattern from outside the controllers has to be
  // known before any single pattern is.
  if (unparsed.length > 0) {
    return withhold(`${unparsed.length} file${unparsed.length === 1 ? " wasn't" : "s weren't"} parsed, and one could set a global prefix`);
  }
  let bootstraps = 0;
  const prefixes: { path: string; value: string | null; hasOptions: boolean }[] = [];
  for (const { path, source } of files) {
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      if (!Node.isPropertyAccessExpression(callee)) continue;
      const name = callee.getName();
      if (name === "enableVersioning") return withhold(`${path} enables versioning, which can add a version to any path`);
      if (name === "create" && callee.getExpression().getText() === "NestFactory") bootstraps++;
      if (name === "setGlobalPrefix") {
        const [first, ...rest] = call.getArguments();
        prefixes.push({ path, value: first ? literalString(first) : null, hasOptions: rest.length > 0 });
      }
    }
    if ([...importsFrom(source, "@nestjs/core").values()].includes("RouterModule")) {
      return withhold(`${path} uses RouterModule, which prefixes whole modules`);
    }
  }
  let prefix = "";
  if (prefixes.length > 0) {
    const [only, ...more] = prefixes;
    if (!only || more.length > 0) return withhold("setGlobalPrefix is called more than once");
    if (bootstraps !== 1) return withhold(`setGlobalPrefix is called, but there are ${bootstraps} bootstraps it could apply to`);
    if (only.value === null) return withhold(`${only.path} sets the global prefix to a computed value`);
    if (only.hasOptions) return withhold(`${only.path} excludes some routes from the global prefix`);
    prefix = only.value;
  }

  for (const { path, source } of files) {
    const common = importsFrom(source, "@nestjs/common");
    const decoratorName = (d: Decorator): string | undefined => {
      const call = d.getCallExpression();
      const callee = call?.getExpression();
      return callee && Node.isIdentifier(callee) ? common.get(callee.getText()) : undefined;
    };

    for (const cls of source.getClasses()) {
      const controller = cls.getDecorators().find((d) => decoratorName(d) === "Controller");
      if (!controller) continue;
      const bases = controllerPaths(controller);
      if (typeof bases === "string") {
        report.omitted.push({ path, line: controller.getStartLineNumber(), reason: bases });
        continue;
      }
      for (const method of cls.getMethods()) {
        for (const decorator of method.getDecorators()) {
          const name = decoratorName(decorator);
          const verb = name === undefined ? undefined : METHOD_DECORATORS[name];
          if (!verb) continue;
          const line = decorator.getStartLineNumber();
          const own = pathArgument(decorator.getArguments()[0]);
          if (own === null) {
            report.omitted.push({ path, line, reason: `@${name}() is given a path that isn't a string literal` });
            continue;
          }
          for (const base of bases) {
            for (const tail of own) report.routes.push({ path, method: verb, pattern: joinPath([prefix, base, tail]), line });
          }
        }
      }
    }
  }
  return report;
}

/** The paths @Controller() puts in front of its methods, or why they aren't known. */
function controllerPaths(decorator: Decorator): string[] | string {
  const [argument] = decorator.getArguments();
  if (argument && Node.isObjectLiteralExpression(argument)) {
    if (argument.getProperty("version")) return "@Controller() sets a version, which changes the path";
    const path = argument.getProperty("path");
    if (!path) return [""];
    if (!Node.isPropertyAssignment(path)) return "@Controller() is given a path that isn't a string literal";
    return pathArgument(path.getInitializer()) ?? "@Controller() is given a path that isn't a string literal";
  }
  return pathArgument(argument) ?? "@Controller() is given a path that isn't a string literal";
}

/** No argument is the empty path; a literal or an array of literals is those paths; anything else is unknown. */
function pathArgument(argument: Node | undefined): string[] | null {
  if (argument === undefined) return [""];
  if (Node.isArrayLiteralExpression(argument)) {
    const values = argument.getElements().map(literalString);
    return values.length > 0 && values.every((v) => v !== null) ? values.filter((v) => v !== null) : null;
  }
  const value = literalString(argument);
  return value === null ? null : [value];
}

function literalString(node: Node | Expression): string | null {
  return Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) ? node.getLiteralValue() : null;
}

// What Nest does joining the pieces: each gets one leading slash and loses
// its trailing ones, empty pieces drop out, and nothing at all is "/".
function joinPath(pieces: string[]): string {
  const joined = pieces
    .map((p) => p.replace(/\/+$/, ""))
    .filter((p) => p !== "")
    .map((p) => (p.startsWith("/") ? p : `/${p}`))
    .join("");
  return joined === "" ? "/" : joined;
}

/** Local name → exported name, for the named imports from one module. */
function importsFrom(source: SourceFile, module: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const declaration of source.getImportDeclarations()) {
    if (declaration.getModuleSpecifierValue() !== module) continue;
    for (const specifier of declaration.getNamedImports()) {
      names.set(specifier.getAliasNode()?.getText() ?? specifier.getName(), specifier.getName());
    }
  }
  return names;
}
