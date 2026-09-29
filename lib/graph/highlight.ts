import type { Edge } from "../parser/types.ts";
import type { MapView } from "./view.ts";

// What stays at full strength for a selection: the selected thing, its edges,
// and whatever those edges end on. Pure arithmetic over the view and the edge
// list, so it's instant.

export type Selection = { kind: "group"; id: string } | { kind: "file"; path: string } | null;

export type Highlight = {
  /** Endpoint keys (see endpointKey) that stay bright. */
  endpoints: ReadonlySet<string>;
  /** Objects shown bright in full, every row included. */
  objects: ReadonlySet<string>;
  /** Drawn edges into the selection. */
  incoming: ReadonlySet<string>;
  /** Drawn edges out of the selection. */
  outgoing: ReadonlySet<string>;
};

/** A folded node has one endpoint (handle ""); a panel has one per row, plus above and below. */
export function endpointKey(object: string, handle: string | null): string {
  return `${object}|${handle ?? ""}`;
}

export function highlight(view: MapView, edges: readonly Edge[], selection: Selection): Highlight | null {
  if (!selection) return null;
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  const endpoints = new Set<string>();

  if (selection.kind === "group") {
    for (const e of view.edges) {
      if (e.target === selection.id) {
        incoming.add(e.id);
        endpoints.add(endpointKey(e.source, e.sourceHandle));
      }
      if (e.source === selection.id) {
        outgoing.add(e.id);
        endpoints.add(endpointKey(e.target, e.targetHandle));
      }
    }
    return { endpoints, objects: new Set([selection.id]), incoming, outgoing };
  }

  const key = (path: string) => {
    const at = view.endpointOf.get(path);
    return at ? endpointKey(at.object, at.handle) : undefined;
  };
  const self = key(selection.path);
  if (!self) return null;
  endpoints.add(self);
  // Neighbours come from the file edges rather than the drawn ones, so a
  // connection to a row in the same panel, which isn't drawn, still lights up.
  for (const e of edges) {
    const other = e.source === selection.path ? e.target : e.target === selection.path ? e.source : null;
    const at = other === null ? undefined : key(other);
    if (at) endpoints.add(at);
  }
  for (const e of view.edges) {
    if (endpointKey(e.target, e.targetHandle) === self) incoming.add(e.id);
    if (endpointKey(e.source, e.sourceHandle) === self) outgoing.add(e.id);
  }
  return { endpoints, objects: new Set(), incoming, outgoing };
}

/**
 * The one endpoint on the canvas that stands for a hovered file or group: its
 * row, the above/below row it's scrolled into, or the folded node holding it.
 */
export function hoverEndpoint(view: MapView, hover: Selection): string | null {
  if (!hover) return null;
  if (hover.kind === "group") return endpointKey(hover.id, null);
  const at = view.endpointOf.get(hover.path);
  return at ? endpointKey(at.object, at.handle) : null;
}

export type CategoryFocus = {
  /** Endpoint keys standing for at least one file in the category. */
  endpoints: ReadonlySet<string>;
  /** Per canvas object, how many of its files are in the category. */
  counts: ReadonlyMap<string, number>;
};

// What a rail category leaves bright. Every file is counted once, against
// whatever stands for it on the canvas, so the objects' counts always add up
// to the rail's.
export function categoryFocus(
  view: MapView,
  category: string | null,
  /** Each file's rail category. */
  categoryOf: ReadonlyMap<string, string>,
): CategoryFocus | null {
  if (category === null) return null;
  const endpoints = new Set<string>();
  const counts = new Map<string, number>();
  for (const [path, at] of view.endpointOf) {
    if (categoryOf.get(path) !== category) continue;
    endpoints.add(endpointKey(at.object, at.handle));
    counts.set(at.object, (counts.get(at.object) ?? 0) + 1);
  }
  return { endpoints, counts };
}
