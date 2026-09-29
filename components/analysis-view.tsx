"use client";

import { useCallback, useMemo, useState } from "react";
import { foldDirectories } from "@/lib/graph/fold";
import type { Selection } from "@/lib/graph/highlight";
import type { Direction } from "@/lib/graph/reach";
import { clampOffset, groupId, MAX_ROWS, rankGroupFiles } from "@/lib/graph/view";
import type { Coverage, Edge, ParsedFile, Route } from "@/lib/parser/types";
import { CategoryRail } from "./category-rail";
import { DetailPane, type RepositoryFacts, type Tab } from "./detail-pane";
import { DependencyMap } from "./map/dependency-map";
import { RouteTable } from "./route-table";
import { Shell } from "./shell";

// Owns what the map, the rail and the pane share: which folders are open,
// what's selected, what's hovered, which category is picked, and what the pane
// has open. Everything either side
// shows is derived from the parse output already in the browser, so nothing
// here ever makes a request.
export function AnalysisView({
  files,
  edges,
  routes,
  routeCoverage,
  repository,
}: {
  files: ParsedFile[];
  edges: Edge[];
  routes: Route[];
  routeCoverage: Coverage["routes"];
  repository: Omit<RepositoryFacts, "routes">;
}) {
  const folding = useMemo(() => foldDirectories(files), [files]);
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const [open, setOpen] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [refit, setRefit] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [hover, setHover] = useState<Selection>(null);
  // Held here rather than in the pane so it outlives every change of selection.
  const [tab, setTab] = useState<Tab>("structure");
  // Likewise, so the same walk shows for each file while comparing them.
  const [walk, setWalk] = useState<Direction | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  // The centre column shows the map or the route table; the rail and the pane
  // keep working on either.
  const [centre, setCentre] = useState<"map" | "routes">("map");
  const toggleCategory = useCallback((c: string) => setCategory((prev) => (prev === c ? null : c)), []);

  // Clicking a folded node is the one click it has, so opening it also selects
  // the panel it becomes.
  const openGroup = useCallback((id: string) => {
    setOpen((prev) => new Map(prev).set(id, 0));
    setRefit((n) => n + 1);
    setSelection({ kind: "group", id });
  }, []);

  const closeGroup = useCallback(
    (id: string) => {
      setOpen((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      // A selection inside a folded-away panel has nothing left to point at.
      setSelection((prev) => {
        if (prev?.kind === "group") return prev.id === id ? null : prev;
        if (prev?.kind === "file") {
          const dir = folding.groupOf.get(prev.path);
          return dir !== undefined && groupId(dir) === id ? null : prev;
        }
        return prev;
      });
    },
    [folding],
  );

  const toggleFile = useCallback((path: string) => {
    setSelection((prev) => (prev?.kind === "file" && prev.path === path ? null : { kind: "file", path }));
  }, []);

  const scroll = useCallback((id: string, offset: number) => {
    setOpen((prev) => (prev.has(id) ? new Map(prev).set(id, Math.max(0, offset)) : prev));
  }, []);

  // A path clicked in the pane becomes the selection on the map, and the map
  // shows it: its folder opens if it's folded, and scrolls if the row is
  // outside the window. A folder that's already showing the row stays put.
  const reveal = useCallback(
    (path: string) => {
      const dir = folding.groupOf.get(path);
      const group = folding.groups.find((g) => g.dir === dir);
      if (dir === undefined || !group) return;
      const id = groupId(dir);
      const ranked = rankGroupFiles(group, byPath);
      const index = ranked.indexOf(path);
      const current = open.get(id);
      const first = current === undefined ? null : clampOffset(current, ranked.length);
      if (first === null || index < first || index >= first + MAX_ROWS) {
        setOpen(new Map(open).set(id, index - Math.floor(MAX_ROWS / 2)));
        if (current === undefined) setRefit((n) => n + 1);
      }
      setSelection({ kind: "file", path });
      // The row under the pointer is about to be replaced, and a removed
      // element never reports the pointer leaving it.
      setHover(null);
    },
    [folding, byPath, open],
  );

  const deselect = useCallback(() => setSelection(null), []);

  return (
    <Shell
      rail={
        <CategoryRail files={files} frameworks={repository.projects.map((p) => p.adapter)} active={category} onToggle={toggleCategory} />
      }
      map={
        <div className="absolute inset-0 flex flex-col">
          <div role="tablist" className="flex h-7 shrink-0 items-end gap-3 border-b border-line bg-surface px-3 text-[11px]">
            <CentreTab label="Map" on={centre === "map"} onClick={() => setCentre("map")} />
            <CentreTab label="Routes" count={routes.length} on={centre === "routes"} onClick={() => setCentre("routes")} />
          </div>
          <div className="relative min-h-0 flex-1">
            {/* The map stays mounted under the table, so switching back keeps its viewport. */}
            <div className={`absolute inset-0 ${centre === "map" ? "" : "invisible"}`}>
              <DependencyMap
                files={files}
                edges={edges}
                folding={folding}
                open={open}
                selection={selection}
                hover={hover}
                refit={refit}
                category={category}
                onOpen={openGroup}
                onClose={closeGroup}
                onSelectFile={toggleFile}
                onScroll={scroll}
                onHover={setHover}
                onDeselect={deselect}
              />
            </div>
            {centre === "routes" && (
              <RouteTable
                routes={routes}
                coverage={routeCoverage}
                selection={selection}
                hover={hover}
                onReveal={reveal}
                onHover={setHover}
              />
            )}
          </div>
        </div>
      }
      detail={
        <DetailPane
          files={files}
          byPath={byPath}
          edges={edges}
          folding={folding}
          repository={{ ...repository, routes: routes.length }}
          selection={selection}
          hover={hover}
          tab={tab}
          onTab={setTab}
          walk={walk}
          onWalk={setWalk}
          insightsOpen={insightsOpen}
          onInsightsOpen={setInsightsOpen}
          onReveal={reveal}
          onHover={setHover}
        />
      }
    />
  );
}

function CentreTab({ label, count, on, onClick }: { label: string; count?: number; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={`-mb-px border-b pb-1.5 ${on ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg"}`}
    >
      {label}
      {count !== undefined && <span className="ml-1 text-fg-muted tabular-nums">{count}</span>}
    </button>
  );
}
