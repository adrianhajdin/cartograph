"use client";

import {
  ReactFlow,
  ReactFlowProvider,
  getViewportForBounds,
  useReactFlow,
  useStore,
  type Edge as FlowEdge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { useEffect, useMemo, useRef } from "react";
import type { Folding } from "@/lib/graph/fold";
import {
  categoryFocus,
  endpointKey,
  highlight as highlightFor,
  hoverEndpoint,
  type Selection,
} from "@/lib/graph/highlight";
import { buildView } from "@/lib/graph/view";
import { UNCLASSIFIED } from "@/lib/roles";
import type { Edge, ParsedFile } from "@/lib/parser/types";
import { layout, type Box } from "./layout";
import {
  FoldedNodeView,
  MapActions,
  MapSelection,
  PanelNodeView,
  type FoldedNode,
  type PanelNode,
} from "./nodes";

const nodeTypes: NodeTypes = { folded: FoldedNodeView, panel: PanelNodeView };
const FIT_PADDING = 0.06;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;
/** Initial fit may enlarge a small graph a little, never to poster size. */
const INITIAL_MAX_ZOOM = 1.25;

/** What the map draws and what it reports back. State lives with the caller, so the detail pane can drive the same selection. */
export type MapControl = {
  files: ParsedFile[];
  edges: Edge[];
  folding: Folding;
  /** Open groups and how far each has been scrolled. */
  open: ReadonlyMap<string, number>;
  selection: Selection;
  /** Whatever the pointer is over, here or in the pane. */
  hover: Selection;
  /** Changes whenever an open should refit the view to the new layout. */
  refit: number;
  /** The rail category (a role, or unclassified) left bright, or null for all of them. */
  category: string | null;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  onSelectFile: (path: string) => void;
  onScroll: (id: string, offset: number) => void;
  onHover: (hover: Selection) => void;
  onDeselect: () => void;
};

export function DependencyMap(props: MapControl) {
  return (
    <ReactFlowProvider>
      <MapCanvas {...props} />
    </ReactFlowProvider>
  );
}

function MapCanvas({
  files,
  edges,
  folding,
  open,
  selection,
  hover,
  refit,
  category,
  onOpen,
  onClose,
  onSelectFile,
  onScroll,
  onHover,
  onDeselect,
}: MapControl) {
  const view = useMemo(() => buildView(files, edges, folding, open), [files, edges, folding, open]);
  const boxes = useMemo(() => layout(view.objects, view.edges), [view]);
  const lit = useMemo(() => highlightFor(view, edges, selection), [view, edges, selection]);
  const hovered = useMemo(() => hoverEndpoint(view, hover), [view, hover]);
  const railKeys = useMemo(() => new Map(files.map((f) => [f.path, f.role ?? UNCLASSIFIED])), [files]);
  const focus = useMemo(() => categoryFocus(view, category, railKeys), [view, category, railKeys]);

  const nodes = useMemo(
    () =>
      view.objects.map((o): FoldedNode | PanelNode => {
        const box = boxes.get(o.id);
        if (!box) throw new Error(`No layout box for ${o.id}`);
        const base = { id: o.id, position: { x: box.x, y: box.y }, width: box.width, height: box.height };
        return o.kind === "folded" ? { ...base, type: "folded", data: o } : { ...base, type: "panel", data: o };
      }),
    [view, boxes],
  );

  const flowEdges = useMemo(
    () => {
      const dim: FlowEdge[] = [];
      const bright: FlowEdge[] = [];
      for (const e of view.edges) {
        // Direction only gets colour once there's a selection for it to be
        // relative to: green flows into it, amber flows out of it.
        const stroke = lit?.incoming.has(e.id) ? "var(--incoming)" : lit?.outgoing.has(e.id) ? "var(--outgoing)" : undefined;
        // Under a category, a line stays bright only when both of its ends do.
        const outOfFocus =
          focus !== null &&
          !(focus.endpoints.has(endpointKey(e.source, e.sourceHandle)) && focus.endpoints.has(endpointKey(e.target, e.targetHandle)));
        (stroke ? bright : dim).push({
          id: e.id,
          source: e.source,
          sourceHandle: e.sourceHandle,
          target: e.target,
          targetHandle: e.targetHandle,
          style: {
            // Thickness says how many imports one line stands for, gently.
            strokeWidth: Math.min(2.5, 0.75 + Math.log2(e.count) / 3),
            stroke,
            opacity: (lit && !stroke) || outOfFocus ? 0.15 : 1,
          },
        });
      }
      // Bright edges are drawn last so they cross over the dim ones. Order,
      // not zIndex: a raised edge would also draw over the nodes.
      return [...dim, ...bright];
    },
    [view, lit, focus],
  );

  // Refit after an open, against the layout that open produced. The caller
  // changes `refit` in the same update as `open`, so by the time this sees a
  // new value the boxes are already the new ones, never the state before.
  const refitted = useRef(refit);
  const { getZoom, setViewport } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  useEffect(() => {
    if (refitted.current === refit) return;
    refitted.current = refit;
    // Capping at the current zoom means this can only ever zoom out: fitting
    // everything including the new panel, never zooming into the panel.
    setViewport(getViewportForBounds(boundsOf(boxes), width, height, MIN_ZOOM, getZoom(), FIT_PADDING));
  }, [refit, boxes, width, height, getZoom, setViewport]);

  const actions = useMemo(
    () => ({ close: onClose, selectFile: onSelectFile, scroll: onScroll, hover: onHover }),
    [onClose, onSelectFile, onScroll, onHover],
  );
  const selectionValue = useMemo(
    () => ({ selection, highlight: lit, hovered, focus, category }),
    [selection, lit, hovered, focus, category],
  );

  return (
    <MapActions.Provider value={actions}>
      <MapSelection.Provider value={selectionValue}>
        <ReactFlow
          nodes={nodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          fitView
          fitViewOptions={{ padding: FIT_PADDING, maxZoom: INITIAL_MAX_ZOOM }}
          // Folded nodes open here. Panels handle their own header and row
          // clicks, which bubble up to this too and are ignored.
          onNodeClick={(_, node) => {
            if (node.type === "folded") onOpen(node.id);
          }}
          onPaneClick={onDeselect}
        />
      </MapSelection.Provider>
    </MapActions.Provider>
  );
}

function boundsOf(boxes: ReadonlyMap<string, Box>): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes.values()) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
