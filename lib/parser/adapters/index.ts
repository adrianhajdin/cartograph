import { docusaurusAdapter } from "./docusaurus.ts";
import { fallbackAdapter } from "./fallback.ts";
import { nestjsAdapter } from "./nestjs.ts";
import { nextjsAdapter } from "./nextjs.ts";
import { reactAdapter } from "./react.ts";
import type { FrameworkAdapter, ProjectInfo } from "./types.ts";

// Fixed order, first match wins. Frameworks built on React come before React
// itself, since they depend on it too, and the fallback stays last.
const ADAPTERS: readonly FrameworkAdapter[] = [nextjsAdapter, nestjsAdapter, docusaurusAdapter, reactAdapter, fallbackAdapter];

export function selectAdapter(project: ProjectInfo): FrameworkAdapter {
  return ADAPTERS.find((adapter) => adapter.detect(project)) ?? fallbackAdapter;
}

export type { FrameworkAdapter, ProjectInfo };
