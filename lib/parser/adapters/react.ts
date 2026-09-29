import { Node, type SourceFile } from "ts-morph";
import type { Role } from "../../roles.ts";
import { toolConventions, toolRole } from "./conventions.ts";
import { NO_ROUTES, type AdapterFile, type FrameworkAdapter } from "./types.ts";

// React has two conventions a file can be read by. A hook's name starts with
// "use" — React's own rule, which its lint enforces. A component renders JSX,
// which is in the syntax tree rather than in a naming habit, so a .tsx file of
// helpers isn't claimed as one.
const HOOK_NAME = /^use([A-Z0-9]|-[a-z0-9])/;

export function reactRole({ path, source }: AdapterFile): Role | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (HOOK_NAME.test(name)) return "hook";
  if (containsJsx(source)) return "component";
  return null;
}

function containsJsx(source: SourceFile): boolean {
  return (
    source.getFirstDescendant((n) => Node.isJsxElement(n) || Node.isJsxSelfClosingElement(n) || Node.isJsxFragment(n)) !==
    undefined
  );
}

export const reactAdapter: FrameworkAdapter = {
  name: "React",
  detect: (project) => project.dependencies.has("react"),
  excludeDirectory: () => null,
  reachedBy: toolConventions,
  // Tests render JSX too; the runner's pattern says what they are first.
  roleOf: (file) => toolRole(file.path) ?? reactRole(file),
  routes: () => NO_ROUTES,
};
