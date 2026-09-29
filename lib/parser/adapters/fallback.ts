import { toolConventions, toolRole } from "./conventions.ts";
import { NO_ROUTES, type FrameworkAdapter } from "./types.ts";

// Assumes no framework: applies to anything and excludes nothing beyond the
// generic rules, so every source file outside them becomes a node, and only
// the tool conventions give any of them a role.
export const fallbackAdapter: FrameworkAdapter = {
  name: "none",
  detect: () => true,
  excludeDirectory: () => null,
  reachedBy: toolConventions,
  roleOf: (file) => toolRole(file.path),
  routes: () => NO_ROUTES,
};
