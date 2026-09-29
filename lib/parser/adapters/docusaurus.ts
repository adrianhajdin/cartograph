import type { Role } from "../../roles.ts";
import { toolConventions, toolRole } from "./conventions.ts";
import { reactRole } from "./react.ts";
import { NO_ROUTES, type FrameworkAdapter } from "./types.ts";

// Docusaurus routes every file under src/pages, and swaps in any component
// under src/theme for the theme's own of the same name. It's React underneath,
// so everything else is read the way the React adapter reads it.
const CODE = /\.(js|jsx|ts|tsx)$/;

function docusaurusConvention(path: string): { role: Role; reachedBy: string } | null {
  if (!CODE.test(path)) return null;
  if (path.startsWith("src/pages/")) return { role: "page-route", reachedBy: "Docusaurus page" };
  if (path.startsWith("src/theme/")) return { role: "theme-override", reachedBy: "Docusaurus theme override" };
  if (/^(docusaurus\.config|sidebars)\.[cm]?[jt]s$/.test(path)) return { role: "config", reachedBy: "Docusaurus config" };
  return null;
}

export const docusaurusAdapter: FrameworkAdapter = {
  name: "Docusaurus",
  detect: (project) => project.dependencies.has("@docusaurus/core"),
  excludeDirectory: () => null,
  reachedBy: (path) => docusaurusConvention(path)?.reachedBy ?? toolConventions(path),
  roleOf: (file) => docusaurusConvention(file.path)?.role ?? toolRole(file.path) ?? reactRole(file),
  // A page answers whatever the static host serves; no method is written anywhere.
  routes: () => NO_ROUTES,
};
