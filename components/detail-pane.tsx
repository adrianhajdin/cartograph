"use client";

import { useMemo, useState, type ReactNode } from "react";
import { categoryLabel, categoryOf, countByCategory } from "@/lib/graph/categories";
import { neighboursOf, rankRepository, SUMMARY_LIMIT, type Neighbour, type Ranked } from "@/lib/graph/detail";
import type { Folding } from "@/lib/graph/fold";
import type { Selection } from "@/lib/graph/highlight";
import { findInsights, INSIGHT_SENTENCES, type Cycle } from "@/lib/graph/insights";
import { adjacency, DEFAULT_DEPTH, reach, type Adjacency, type Direction } from "@/lib/graph/reach";
import { groupFan, groupId } from "@/lib/graph/view";
import type { Edge, ParsedFile, Project } from "@/lib/parser/types";
import { railLabel, UNCLASSIFIED } from "@/lib/roles";
import { CategorySwatch } from "./map/swatch";

export type Tab = "structure" | "explanation";

/** What the pane says about the repository that isn't in the file and edge lists. */
export type RepositoryFacts = {
  name: string;
  /** The root first, then every package.json folder, each with the adapter that detected it. */
  projects: Project[];
  skipped: number;
  unresolved: number;
  /** Routes the adapters recovered exactly. */
  routes: number;
};

type Props = {
  files: ParsedFile[];
  byPath: ReadonlyMap<string, ParsedFile>;
  edges: Edge[];
  folding: Folding;
  repository: RepositoryFacts;
  selection: Selection;
  hover: Selection;
  tab: Tab;
  onTab: (tab: Tab) => void;
  walk: Direction | null;
  onWalk: (walk: Direction | null) => void;
  insightsOpen: boolean;
  onInsightsOpen: (open: boolean) => void;
  onReveal: (path: string) => void;
  onHover: (hover: Selection) => void;
};

export function DetailPane(props: Props) {
  const { selection, folding, byPath } = props;
  const graph = useMemo(() => adjacency(props.edges), [props.edges]);
  // Whether a path is what the pointer is over, on the map or in here. A
  // hovered folder marks every file inside it.
  const isHovered = (path: string) => {
    const h = props.hover;
    if (!h) return false;
    if (h.kind === "file") return h.path === path;
    const dir = folding.groupOf.get(path);
    return dir !== undefined && groupId(dir) === h.id;
  };
  const paths: PathActions = { isHovered, onReveal: props.onReveal, onHover: props.onHover };

  if (!selection) return <RepositorySummary {...props} paths={paths} />;

  if (selection.kind === "file") {
    const file = byPath.get(selection.path);
    if (!file) return null;
    return (
      <Selected title={<PathTitle path={file.path} paths={paths} />} caption="file" tab={props.tab} onTab={props.onTab}>
        <FileStructure file={file} edges={props.edges} graph={graph} walk={props.walk} onWalk={props.onWalk} paths={paths} />
      </Selected>
    );
  }

  const group = folding.groups.find((g) => groupId(g.dir) === selection.id);
  if (!group) return null;
  return (
    <Selected
      title={<span className="font-mono text-[12px] break-all">{group.dir === "." ? "(root)" : `${group.dir}/`}</span>}
      caption="folder"
      tab={props.tab}
      onTab={props.onTab}
    >
      <GroupStructure files={group.files} fan={groupFanOf(folding, props.edges, group.dir)} />
    </Selected>
  );
}

function groupFanOf(folding: Folding, edges: readonly Edge[], dir: string) {
  return groupFan(folding, edges).get(dir) ?? { fanIn: 0, fanOut: 0 };
}

type PathActions = {
  isHovered: (path: string) => boolean;
  onReveal: (path: string) => void;
  onHover: (hover: Selection) => void;
};

// ── Nothing selected ─────────────────────────────────────────────────────────

function RepositorySummary({
  files,
  edges,
  repository,
  insightsOpen,
  onInsightsOpen,
  paths,
}: Props & { paths: PathActions }) {
  const ranked = useMemo(() => rankRepository(files), [files]);
  const rootAdapter = repository.projects[0]?.adapter ?? "none";
  const nested = repository.projects.filter((p) => p.path !== "." && p.adapter !== "none");
  const byConvention = useMemo(() => files.filter((f) => f.reachedBy !== null).length, [files]);
  // Distinct file-to-file pairs, the unit every file's own counts use, so this
  // is the sum of what the pane says for each file.
  const imports = useMemo(() => files.reduce((n, f) => n + f.fanOut, 0), [files]);
  return (
    <div className="pb-3">
      <header className="border-b border-line px-3 py-2">
        <h2 className="font-mono text-[13px] font-semibold break-all">{repository.name}</h2>
        <p className="mt-0.5 text-[11px] text-fg-muted">
          Framework{" "}
          <span className="text-fg">{rootAdapter === "none" ? "none detected" : rootAdapter}</span>
          {nested.length > 0 && " at the root"}
        </p>
        {nested.map((p) => (
          <p key={p.path} className="text-[11px] text-fg-muted">
            <span className="text-fg">{p.adapter}</span> in <span className="font-mono">{p.path}/</span>
          </p>
        ))}
      </header>

      <dl className="grid grid-cols-3 border-b border-line">
        <Count label="Files" value={files.length} note={repository.skipped > 0 ? `${repository.skipped} skipped` : null} />
        <Count
          label="Imports"
          value={imports}
          note={repository.unresolved > 0 ? `${repository.unresolved} unresolved` : null}
          title="Distinct file-to-file imports resolved inside this repository"
        />
        <Count
          label="Routes"
          value={repository.routes}
          note={null}
          title="Routes whose method and full path are both written in the code"
        />
      </dl>

      <RankedList
        title="Most depended on"
        hint="by files importing it"
        ranked={ranked.mostDependedOn}
        figure={(f) => <span className="text-incoming">←{f.fanIn}</span>}
        paths={paths}
      />
      <RankedList
        title="Imported by nothing"
        hint="where reading starts"
        ranked={ranked.unimported}
        figure={(f) => <span className="text-outgoing">{f.fanOut}→</span>}
        paths={paths}
      />

      <section className="mt-3 px-3">
        <h3 className="flex items-baseline justify-between text-[11px] text-fg-muted">
          <span>Unidentified by convention</span>
          <span className="text-fg tabular-nums">{files.length - byConvention}</span>
        </h3>
        <p className="mt-0.5 text-[11px] text-fg-muted tabular-nums">
          {byConvention} matched a framework, tool or test convention; only imports reach the rest.
        </p>
      </section>

      {/* Last and closed: this pane explains the repository first, and the
          insights are there for whoever goes looking. */}
      <section className="mt-3 border-t border-line">
        <button
          type="button"
          aria-expanded={insightsOpen}
          onClick={() => onInsightsOpen(!insightsOpen)}
          className="flex w-full items-baseline gap-1.5 px-3 py-2 text-left text-[11px] hover:bg-raised"
        >
          <span className="w-2 text-fg-muted">{insightsOpen ? "▾" : "▸"}</span>
          <span className="text-fg">Insights</span>
          <span className="text-fg-muted">facts from the import graph</span>
        </button>
        {insightsOpen && <InsightList files={files} edges={edges} paths={paths} />}
      </section>
    </div>
  );
}

// ── Insights ─────────────────────────────────────────────────────────────────

function InsightList({ files, edges, paths }: { files: ParsedFile[]; edges: Edge[]; paths: PathActions }) {
  const insights = useMemo(() => findInsights(files, edges), [files, edges]);
  const { heavilyImported } = insights;
  // Files nothing imports leads: for someone new here that one explains the
  // most. Loops and long files read closer to a verdict, so they come last.
  return (
    <div className="pb-1">
      <InsightSection
        title="Nothing imports or reaches"
        sentence={INSIGHT_SENTENCES.unimported}
        count={insights.unimported.length}
        items={insights.unimported}
        render={(f) => <PathRow key={f.path} path={f.path} paths={paths} trailing={<span className="text-outgoing">{f.fanOut}→</span>} />}
      />
      <InsightSection
        title="Imported unusually often"
        hint={`by more than ${heavilyImported.threshold}`}
        sentence={INSIGHT_SENTENCES.heavilyImported}
        count={heavilyImported.files.length}
        items={heavilyImported.files}
        render={(f) => <PathRow key={f.path} path={f.path} paths={paths} trailing={<span className="text-incoming">←{f.fanIn}</span>} />}
      />
      <InsightSection
        title="Import loops"
        hint="type-only imports left out"
        sentence={INSIGHT_SENTENCES.cycles}
        count={insights.cycles.length}
        items={insights.cycles}
        render={(c) => <CycleRows key={c.files[0]} cycle={c} paths={paths} />}
      />
      <InsightSection
        title="Long files"
        sentence={INSIGHT_SENTENCES.long}
        count={insights.long.length}
        items={insights.long}
        render={(f) => (
          <PathRow key={f.path} path={f.path} paths={paths} trailing={<span className="text-fg-muted">{f.lines.toLocaleString("en")}</span>} />
        )}
      />
    </div>
  );
}

function InsightSection<T>(props: {
  title: string;
  hint?: string;
  sentence: string;
  count: number;
  items: T[];
  render: (item: T) => ReactNode;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? props.items : props.items.slice(0, SUMMARY_LIMIT);
  return (
    <section className="mt-2">
      <h3 className="flex items-baseline gap-1.5 px-3 text-[11px] text-fg-muted">
        <span className="text-fg">{props.title}</span>
        {props.hint && <span>{props.hint}</span>}
        <span className="ml-auto tabular-nums">{props.count}</span>
      </h3>
      <p className="px-3 pb-0.5 text-[11px] text-fg-muted">{props.sentence}</p>
      {props.items.length === 0 ? <p className="px-3 text-[11px] text-fg-muted">None.</p> : <ul>{shown.map(props.render)}</ul>}
      {props.items.length > SUMMARY_LIMIT && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="px-3 pt-0.5 text-[10px] text-fg-muted tabular-nums hover:text-fg hover:underline"
        >
          {all ? "Show fewer" : `Show all ${props.items.length}`}
        </button>
      )}
    </section>
  );
}

// One loop, in import order, so it can be walked by opening each file in turn.
function CycleRows({ cycle, paths }: { cycle: Cycle; paths: PathActions }) {
  return (
    <li className="mt-1">
      <p className="px-3 text-[10px] text-fg-muted tabular-nums">
        {cycle.files.length} {cycle.files.length === 1 ? "file" : "files"}
        {cycle.members > cycle.files.length && `, one loop among ${cycle.members} files that all reach each other`}
      </p>
      <ul>
        {cycle.files.map((f, i) => (
          <PathRow
            key={f}
            path={f}
            paths={paths}
            trailing={<span className="text-outgoing">{i === cycle.files.length - 1 ? "↩ first" : "↓"}</span>}
          />
        ))}
      </ul>
    </li>
  );
}

function Count({ label, value, note, title }: { label: string; value: number | null; note: string | null; title?: string }) {
  return (
    <div className="border-r border-line px-3 py-2 last:border-r-0" title={title}>
      <dt className="text-[11px] text-fg-muted">{label}</dt>
      <dd className="text-[15px] leading-5 tabular-nums">{value ?? <span className="text-fg-muted">—</span>}</dd>
      {note && <dd className="text-[10px] text-fg-muted tabular-nums">{note}</dd>}
    </div>
  );
}

function RankedList(props: {
  title: string;
  hint: string;
  ranked: Ranked;
  figure: (file: ParsedFile) => ReactNode;
  paths: PathActions;
}) {
  const { files, total } = props.ranked;
  return (
    <section className="mt-3">
      <h3 className="flex items-baseline gap-1.5 px-3 pb-0.5 text-[11px] text-fg-muted">
        <span className="text-fg">{props.title}</span>
        <span>{props.hint}</span>
        <span className="ml-auto tabular-nums">{total}</span>
      </h3>
      {files.length === 0 ? (
        <p className="px-3 text-[11px] text-fg-muted">None.</p>
      ) : (
        <ul>
          {files.map((f) => (
            <PathRow key={f.path} path={f.path} paths={props.paths} trailing={props.figure(f)} />
          ))}
        </ul>
      )}
      {total > files.length && (
        <p className="px-3 pt-0.5 text-[10px] text-fg-muted tabular-nums">{total - files.length} more not listed</p>
      )}
    </section>
  );
}

// ── Something selected ───────────────────────────────────────────────────────

function Selected(props: { title: ReactNode; caption: string; tab: Tab; onTab: (tab: Tab) => void; children: ReactNode }) {
  return (
    <div className="pb-3">
      <header className="border-b border-line px-3 pt-2">
        <p className="text-[10px] text-fg-muted">{props.caption}</p>
        <h2 className="leading-4">{props.title}</h2>
        <div role="tablist" className="mt-2 flex gap-3 text-[11px]">
          <TabButton tab="structure" label="Structure" current={props.tab} onTab={props.onTab} />
          <TabButton tab="explanation" label="Explanation" current={props.tab} onTab={props.onTab} />
        </div>
      </header>
      {props.tab === "structure" ? (
        props.children
      ) : (
        <div className="px-3 py-3 text-[11px] text-fg-muted">
          <p className="text-fg">No explanation yet.</p>
          <p className="mt-0.5">Explanations come from a model call, and nothing makes one yet.</p>
        </div>
      )}
    </div>
  );
}

function TabButton({ tab, label, current, onTab }: { tab: Tab; label: string; current: Tab; onTab: (tab: Tab) => void }) {
  const active = tab === current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onTab(tab)}
      className={`-mb-px border-b pb-1.5 ${active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg"}`}
    >
      {label}
    </button>
  );
}

// Clickable like every other path in the pane: it brings the file back into
// view on the map if its folder has been scrolled or closed since.
function PathTitle({ path, paths }: { path: string; paths: PathActions }) {
  const slash = path.lastIndexOf("/");
  return (
    <button
      type="button"
      onClick={() => paths.onReveal(path)}
      onMouseEnter={() => paths.onHover({ kind: "file", path })}
      onMouseLeave={() => paths.onHover(null)}
      className="text-left font-mono text-[12px] break-all hover:underline"
    >
      {slash >= 0 && <span className="text-fg-muted">{path.slice(0, slash + 1)}</span>}
      <span className="font-semibold">{path.slice(slash + 1)}</span>
    </button>
  );
}

function FileStructure(props: {
  file: ParsedFile;
  edges: Edge[];
  graph: Adjacency;
  walk: Direction | null;
  onWalk: (walk: Direction | null) => void;
  paths: PathActions;
}) {
  const { file, edges, graph, walk, onWalk, paths } = props;
  const { imports, importedBy } = useMemo(() => neighboursOf(edges, file.path), [edges, file.path]);
  const category = categoryOf(file.path);
  // Counts are the lengths of the lists below them, so they can't disagree.
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-b border-line px-3 py-2 text-[11px]">
        <Fact label="Kind">
          <span className="flex items-center gap-1.5 font-mono">
            <CategorySwatch category={category} />
            {categoryLabel(category)}
          </span>
        </Fact>
        <Fact label="Role">
          {file.role === null ? <span className="text-fg-muted">{railLabel(UNCLASSIFIED).toLowerCase()}</span> : railLabel(file.role)}
        </Fact>
        <Fact label="Folder">
          <span className="font-mono break-all">{file.module}</span>
        </Fact>
        <Fact label="Length">
          {file.lines} {file.lines === 1 ? "line" : "lines"}
        </Fact>
        <Fact label="Depends on">
          <span className="text-outgoing">{imports.length}</span> {imports.length === 1 ? "file" : "files"}
        </Fact>
        <Fact label="Depended on by">
          <span className="text-incoming">{importedBy.length}</span> {importedBy.length === 1 ? "file" : "files"}
        </Fact>
        <Fact label="Reached by">
          {file.reachedBy ?? <span className="text-fg-muted">imports only</span>}
        </Fact>
      </dl>
      <div className="flex gap-1.5 border-b border-line px-3 py-2">
        <WalkButton direction="dependents" label="Blast radius" walk={walk} onWalk={onWalk} />
        <WalkButton direction="dependencies" label="Dependency chain" walk={walk} onWalk={onWalk} />
      </div>
      {walk && <ReachList file={file.path} graph={graph} direction={walk} paths={paths} />}
      <NeighbourList title="Imports" count={<span className="text-outgoing">{imports.length}→</span>} rows={imports} paths={paths} />
      <NeighbourList
        title="Imported by"
        count={<span className="text-incoming">←{importedBy.length}</span>}
        rows={importedBy}
        paths={paths}
      />
    </>
  );
}

function WalkButton(props: {
  direction: Direction;
  label: string;
  walk: Direction | null;
  onWalk: (walk: Direction | null) => void;
}) {
  const on = props.walk === props.direction;
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => props.onWalk(on ? null : props.direction)}
      className={`rounded-[3px] border px-2 py-0.5 text-[11px] ${
        on ? "border-accent bg-accent/15 text-fg" : "border-line text-fg-muted hover:bg-raised hover:text-fg"
      }`}
    >
      {props.label}
    </button>
  );
}

// Worked out on the spot from the edges already here: no request, no spinner.
function ReachList({ file, graph, direction, paths }: { file: string; graph: Adjacency; direction: Direction; paths: PathActions }) {
  const { steps, beyond } = useMemo(() => reach(graph, file, direction), [graph, file, direction]);
  const total = steps.reduce((n, s) => n + s.length, 0);
  const dependents = direction === "dependents";
  return (
    <section className="mt-3">
      <h3 className="flex items-baseline gap-1.5 px-3 pb-0.5 text-[11px] text-fg-muted">
        <span className="text-fg">{dependents ? "Blast radius" : "Dependency chain"}</span>
        <span>{dependents ? "what imports this, directly or through others" : "what this imports, directly or through others"}</span>
        <span className={`ml-auto tabular-nums ${dependents ? "text-incoming" : "text-outgoing"}`}>{total}</span>
      </h3>
      {steps.map((list, i) => (
        <div key={i}>
          <h4 className="px-3 pt-1 text-[10px] text-fg-muted tabular-nums">
            {i + 1} {i === 0 ? "step" : "steps"} away · {list.length}
          </h4>
          {list.length === 0 ? (
            <p className="px-3 text-[11px] text-fg-muted">None.</p>
          ) : (
            <ul>
              {list.map((p) => (
                <PathRow key={p} path={p} paths={paths} />
              ))}
            </ul>
          )}
        </div>
      ))}
      <p className="px-3 pt-1 text-[10px] text-fg-muted tabular-nums">
        {beyond > 0 ? `${beyond} more further than ${DEFAULT_DEPTH} steps, not listed.` : `Nothing further than ${DEFAULT_DEPTH} steps.`}
      </p>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 tabular-nums">{children}</dd>
    </>
  );
}

function NeighbourList(props: { title: string; count: ReactNode; rows: Neighbour[]; paths: PathActions }) {
  return (
    <section className="mt-3">
      <h3 className="flex items-baseline justify-between px-3 pb-0.5 text-[11px]">
        <span>{props.title}</span>
        <span className="tabular-nums">{props.count}</span>
      </h3>
      {props.rows.length === 0 ? (
        <p className="px-3 text-[11px] text-fg-muted">None.</p>
      ) : (
        <ul>
          {props.rows.map((n) => (
            <PathRow key={n.path} path={n.path} paths={props.paths} trailing={<EdgeMarks neighbour={n} />} />
          ))}
        </ul>
      )}
    </section>
  );
}

// Only what differs from a plain value import is marked, so most rows carry nothing.
function EdgeMarks({ neighbour }: { neighbour: Neighbour }) {
  const marks = [
    ...(neighbour.kinds.includes("re-export") ? ["re-export"] : []),
    ...(neighbour.kinds.includes("dynamic-import") ? ["dynamic"] : []),
    ...(neighbour.typeOnly ? ["type"] : []),
  ];
  if (marks.length === 0) return null;
  return <span className="text-fg-muted">{marks.join(" · ")}</span>;
}

function GroupStructure({ files, fan }: { files: string[]; fan: { fanIn: number; fanOut: number } }) {
  const kinds = useMemo(() => countByCategory(files), [files]);
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-b border-line px-3 py-2 text-[11px]">
        <Fact label="Files">{files.length}</Fact>
        <Fact label="Imported from outside by">
          <span className="text-incoming">{fan.fanIn}</span> {fan.fanIn === 1 ? "file" : "files"}
        </Fact>
        <Fact label="Imports from outside">
          <span className="text-outgoing">{fan.fanOut}</span> {fan.fanOut === 1 ? "file" : "files"}
        </Fact>
      </dl>
      <section className="mt-3">
        <h3 className="px-3 pb-0.5 text-[11px]">Kinds of file inside</h3>
        <ul>
          {kinds.map(({ category, count }) => (
            <li key={category} className="flex h-[22px] items-center gap-2 px-3 text-[11px]">
              <CategorySwatch category={category} />
              <span className="flex-1 font-mono">{categoryLabel(category)}</span>
              <span className="text-fg-muted tabular-nums">{count}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

// ── Shared ───────────────────────────────────────────────────────────────────

// Every path in the pane is one of these: clicking moves the map's selection
// to it, hovering marks it on the map, and it's marked here when the map
// reports the pointer over it.
function PathRow({ path, paths, trailing }: { path: string; paths: PathActions; trailing?: ReactNode }) {
  const slash = path.lastIndexOf("/");
  const hovered = paths.isHovered(path);
  return (
    <li>
      <button
        type="button"
        title={path}
        onClick={() => paths.onReveal(path)}
        onMouseEnter={() => paths.onHover({ kind: "file", path })}
        onMouseLeave={() => paths.onHover(null)}
        className={`flex h-[22px] w-full min-w-0 items-center gap-2 px-3 text-left text-[11px] ${
          hovered ? "bg-accent/15 shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-raised"
        }`}
      >
        <span className="flex min-w-0 flex-1 font-mono">
          {slash >= 0 && <span className="truncate text-fg-muted">{path.slice(0, slash + 1)}</span>}
          <span className="shrink-0">{path.slice(slash + 1)}</span>
        </span>
        {trailing && <span className="shrink-0 text-[10px] tabular-nums">{trailing}</span>}
      </button>
    </li>
  );
}
