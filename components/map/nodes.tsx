"use client";

import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/react";
import { createContext, useContext, useEffect, useRef, type WheelEvent } from "react";
import { categoryOf } from "@/lib/graph/categories";
import { endpointKey, type CategoryFocus, type Highlight, type Selection } from "@/lib/graph/highlight";
import { ABOVE_HANDLE, BELOW_HANDLE, MAX_ROWS, type FoldedObject, type PanelObject } from "@/lib/graph/view";
import { PANEL_HEADER_HEIGHT, PAD_X, ROW_HEIGHT } from "./layout";
import { CategorySwatch } from "./swatch";

export type FoldedNode = Node<FoldedObject, "folded">;
export type PanelNode = Node<PanelObject, "panel">;

// Actions and selection come through context rather than node data, so node
// data stays the plain view object and React Flow never diffs a fresh closure.
// Opening a folded node isn't here: it goes through React Flow's onNodeClick
// (see the map), because a node that's neither draggable nor selectable only
// receives pointer events when that handler exists.
export const MapActions = createContext<{
  close: (id: string) => void;
  selectFile: (path: string) => void;
  /** Move a panel's window by this many rows; the view clamps it. */
  scroll: (id: string, offset: number) => void;
  /** Reports what the pointer is over, so the detail pane can mark it too. */
  hover: (hover: Selection) => void;
}>({ close: () => {}, selectFile: () => {}, scroll: () => {}, hover: () => {} });

export const MapSelection = createContext<{
  selection: Selection;
  highlight: Highlight | null;
  /** Endpoint key of what's hovered, here or in the pane. */
  hovered: string | null;
  /** What the rail's category leaves bright, and how many files matched in each object. */
  focus: CategoryFocus | null;
  category: string | null;
}>({ selection: null, highlight: null, hovered: null, focus: null, category: null });

const DIM = "opacity-25";
// Hover is marked with an outline rather than a fill, so it reads the same on
// a selected row, a dimmed one and a plain one.
const HOVER_RING = "shadow-[inset_0_0_0_1px_var(--accent)]";

// Everything inside a node is sized in px, never rem. The layout boxes are px
// and the app's root font size grows on large screens, so rem spacing in here
// would overflow the box it was laid out for.

// Handles are invisible anchors: an edge ends at the box or row, not at a dot.
const anchor = "!size-px !min-h-0 !min-w-0 !border-0 !bg-transparent";

export function FoldedNodeView({ id, data }: NodeProps<FoldedNode>) {
  const { hover } = useContext(MapActions);
  const { highlight, hovered, focus, category } = useContext(MapSelection);
  const key = endpointKey(id, null);
  const isHovered = hovered === key;
  const dim =
    !isHovered && ((highlight !== null && !highlight.endpoints.has(key)) || (focus !== null && !focus.endpoints.has(key)));
  return (
    <div
      title={data.dir}
      onMouseEnter={() => hover({ kind: "group", id })}
      onMouseLeave={() => hover(null)}
      className={`flex size-full cursor-pointer flex-col justify-center gap-[2px] rounded-[4px] border bg-surface ${
        isHovered ? "border-accent" : "border-line"
      } ${dim ? DIM : ""}`}
      style={{ paddingInline: PAD_X }}
    >
      <Handle type="target" position={Position.Left} className={anchor} isConnectable={false} />
      <span className="truncate font-mono text-[11px] leading-[16px] text-fg">{data.label}</span>
      <Meta
        fileCount={data.fileCount}
        fanIn={data.fanIn}
        fanOut={data.fanOut}
        match={category === null ? null : { category, count: focus?.counts.get(id) ?? 0 }}
      />
      <Handle type="source" position={Position.Right} className={anchor} isConnectable={false} />
    </div>
  );
}

export function PanelNodeView({ id, data }: NodeProps<PanelNode>) {
  const { close, selectFile, scroll, hover } = useContext(MapActions);
  const { selection, highlight, hovered, focus, category } = useContext(MapSelection);
  const selected = selection?.kind === "group" && selection.id === id;
  // Whole means every row stays bright: nothing is selected, or this panel is.
  const whole = highlight === null || highlight.objects.has(id);
  // A row is bright when the selection and the rail's category both leave it so.
  const lit = (handle: string) =>
    (whole || (highlight?.endpoints.has(endpointKey(id, handle)) ?? false)) &&
    (focus === null || focus.endpoints.has(endpointKey(id, handle)));
  const anyLit = data.rows.some((r) => lit(r.path)) || (data.scrolls && (lit(ABOVE_HANDLE) || lit(BELOW_HANDLE)));

  // Wheel deltas arrive in pixels from trackpads and in lines from some mice;
  // they add up until they make a whole row, so slow scrolling still moves.
  const pending = useRef(0);
  // React Flow measures handles when a node resizes. Scrolling swaps rows at a
  // fixed size, so the new rows' handles have to be measured explicitly or
  // their edges have nothing to attach to.
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => updateNodeInternals(id), [id, data.offset, updateNodeInternals]);
  function onWheel(event: WheelEvent) {
    if (!data.scrolls) return;
    pending.current += event.deltaMode === 1 ? event.deltaY * ROW_HEIGHT : event.deltaY;
    const rows = Math.trunc(pending.current / ROW_HEIGHT);
    if (rows === 0) return;
    pending.current -= rows * ROW_HEIGHT;
    scroll(id, data.offset + rows);
  }

  return (
    <div
      className={`flex size-full flex-col overflow-hidden rounded-[4px] border bg-surface ${
        selected ? "border-accent" : "border-fg-muted"
      } ${anyLit ? "" : DIM}`}
    >
      <button
        type="button"
        onClick={() => close(id)}
        onMouseEnter={() => hover({ kind: "group", id })}
        onMouseLeave={() => hover(null)}
        title={`${data.dir} — click to fold`}
        className={`flex shrink-0 flex-col justify-center gap-[2px] border-b border-line bg-raised text-left hover:bg-line ${
          whole || !anyLit ? "" : DIM
        }`}
        style={{ height: PANEL_HEADER_HEIGHT, paddingInline: PAD_X }}
      >
        <span className="truncate font-mono text-[11px] leading-[16px] font-semibold text-fg">{data.label}</span>
        <Meta
          fileCount={data.fileCount}
          fanIn={data.fanIn}
          fanOut={data.fanOut}
          match={category === null ? null : { category, count: focus?.counts.get(id) ?? 0 }}
        />
      </button>
      {/* nowheel: the wheel scrolls the rows here instead of zooming the map. */}
      <ul className={data.scrolls ? "nowheel" : undefined} onWheel={onWheel}>
        {data.scrolls && (
          <OffscreenRow
            handle={ABOVE_HANDLE}
            count={data.above}
            label="above"
            dim={anyLit && !lit(ABOVE_HANDLE)}
            hovered={hovered === endpointKey(id, ABOVE_HANDLE)}
            onClick={() => scroll(id, data.offset - MAX_ROWS)}
          />
        )}
        {data.rows.map((row) => {
          const rowSelected = selection?.kind === "file" && selection.path === row.path;
          const rowHovered = hovered === endpointKey(id, row.path);
          return (
            <li key={row.path} className="relative" style={{ height: ROW_HEIGHT }}>
              <Handle id={row.path} type="target" position={Position.Left} className={anchor} isConnectable={false} />
              <button
                type="button"
                onClick={() => selectFile(row.path)}
                onMouseEnter={() => hover({ kind: "file", path: row.path })}
                onMouseLeave={() => hover(null)}
                title={row.path}
                aria-pressed={rowSelected}
                className={`flex size-full items-center gap-[6px] text-left text-[11px] ${
                  rowSelected ? "bg-accent/15 shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-raised"
                } ${rowHovered ? HOVER_RING : anyLit && !lit(row.path) ? DIM : ""}`}
                style={{ paddingInline: PAD_X }}
              >
                <CategorySwatch category={categoryOf(row.path)} />
                <span className="min-w-0 flex-1 truncate font-mono text-fg">{row.label}</span>
                <Fan fanIn={row.fanIn} fanOut={row.fanOut} />
              </button>
              <Handle id={row.path} type="source" position={Position.Right} className={anchor} isConnectable={false} />
            </li>
          );
        })}
        {data.scrolls && (
          <OffscreenRow
            handle={BELOW_HANDLE}
            count={data.below}
            label="below"
            dim={anyLit && !lit(BELOW_HANDLE)}
            hovered={hovered === endpointKey(id, BELOW_HANDLE)}
            onClick={() => scroll(id, data.offset + MAX_ROWS)}
          />
        )}
      </ul>
    </div>
  );
}

// Stands for the files scrolled out of the window on one side. Edges to those
// files end here, so they stay attached to the panel rather than vanishing.
// Clicking pages the window that way.
function OffscreenRow(props: {
  handle: string;
  count: number;
  label: string;
  dim: boolean;
  hovered: boolean;
  onClick: () => void;
}) {
  return (
    <li className="relative" style={{ height: ROW_HEIGHT }}>
      <Handle id={props.handle} type="target" position={Position.Left} className={anchor} isConnectable={false} />
      <button
        type="button"
        onClick={props.onClick}
        disabled={props.count === 0}
        className={`flex size-full items-center text-left text-[10px] text-fg-muted tabular-nums enabled:hover:bg-raised enabled:hover:text-fg disabled:opacity-50 ${
          props.hovered ? HOVER_RING : props.dim ? DIM : ""
        }`}
        style={{ paddingInline: PAD_X }}
      >
        {props.count} {props.count === 1 ? "file" : "files"} {props.label}
      </button>
      <Handle id={props.handle} type="source" position={Position.Right} className={anchor} isConnectable={false} />
    </li>
  );
}

// Under a rail category the file count says how many of them matched, so each
// part of the repository shows how much of the category lives in it.
function Meta(props: {
  fileCount: number;
  fanIn: number;
  fanOut: number;
  match: { category: string; count: number } | null;
}) {
  const { fileCount, fanIn, fanOut, match } = props;
  return (
    <span className="flex items-center gap-[8px] text-[10px] leading-[12px] text-fg-muted tabular-nums">
      {match ? (
        <span className="flex items-center gap-[4px]" title={`${match.count} of ${fileCount} files match`}>
          <span>
            <span className="text-fg">{match.count}</span>/{fileCount} {fileCount === 1 ? "file" : "files"}
          </span>
        </span>
      ) : (
        <span>
          {fileCount} {fileCount === 1 ? "file" : "files"}
        </span>
      )}
      <Fan fanIn={fanIn} fanOut={fanOut} />
    </span>
  );
}

// Green for what flows in, amber for what flows out — the only two colours
// direction ever gets.
function Fan({ fanIn, fanOut }: { fanIn: number; fanOut: number }) {
  return (
    <span className="flex shrink-0 items-center gap-[6px] text-[10px] tabular-nums">
      <span className="text-incoming" title="Distinct files that import this">
        ←{fanIn}
      </span>
      <span className="text-outgoing" title="Distinct files this imports">
        {fanOut}→
      </span>
    </span>
  );
}
