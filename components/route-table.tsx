"use client";

import { useState } from "react";
import type { Selection } from "@/lib/graph/highlight";
import type { Coverage, Route } from "@/lib/parser/types";

// Every route the adapters recovered, one row per method and pattern. Clicking
// a row selects the file that declares it, so the pane shows that file while
// the table stays open. Nothing here is inferred: what the adapters couldn't
// read exactly is listed underneath with the reason, not guessed into a row.
export function RouteTable({
  routes,
  coverage,
  selection,
  hover,
  onReveal,
  onHover,
}: {
  routes: Route[];
  coverage: Coverage["routes"];
  selection: Selection;
  hover: Selection;
  onReveal: (path: string) => void;
  onHover: (hover: Selection) => void;
}) {
  const [omittedOpen, setOmittedOpen] = useState(false);
  const selectedFile = selection?.kind === "file" ? selection.path : null;
  const hoveredFile = hover?.kind === "file" ? hover.path : null;

  return (
    <div className="absolute inset-0 overflow-y-auto bg-surface text-[11px]">
      <p className="border-b border-line px-3 py-1.5 text-fg-muted">
        Listed only where the method and the full path are both written in the code.
      </p>
      {coverage.withheld.map((w) => (
        <p key={w.project} className="border-b border-line px-3 py-1.5">
          <span className="text-fg">No routes listed{w.project === "." ? "" : <> in <span className="font-mono">{w.project}/</span></>}:</span>{" "}
          <span className="text-fg-muted">{w.reason}.</span>
        </p>
      ))}

      {routes.length === 0 ? (
        <p className="px-3 py-2 text-fg-muted">No routes.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-surface">
            <tr className="h-[22px] border-b border-line text-left text-[10px] text-fg-muted">
              <th className="w-16 px-3 font-normal">Method</th>
              <th className="px-3 font-normal">Pattern</th>
              <th className="px-3 font-normal">Declared in</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r) => {
              const selected = r.file === selectedFile;
              const hovered = r.file === hoveredFile;
              return (
                <tr
                  key={`${r.method} ${r.pattern} ${r.file}`}
                  onClick={() => onReveal(r.file)}
                  onMouseEnter={() => onHover({ kind: "file", path: r.file })}
                  onMouseLeave={() => onHover(null)}
                  className={`h-[22px] cursor-pointer font-mono ${
                    selected ? "bg-accent/15 shadow-[inset_2px_0_0_var(--accent)]" : hovered ? "bg-raised" : "hover:bg-raised"
                  }`}
                >
                  <td className="px-3">{r.method}</td>
                  <td className="px-3 break-all">{r.pattern}</td>
                  <td className="px-3 text-fg-muted" title={r.file}>
                    {r.file}:{r.line}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {coverage.omitted.length > 0 && (
        <section className="border-t border-line">
          <button
            type="button"
            aria-expanded={omittedOpen}
            onClick={() => setOmittedOpen(!omittedOpen)}
            className="flex w-full items-baseline gap-1.5 px-3 py-1.5 text-left hover:bg-raised"
          >
            <span className="w-2 text-fg-muted">{omittedOpen ? "▾" : "▸"}</span>
            <span>Not listed</span>
            <span className="text-fg-muted">declared, but the method or full path isn&apos;t written out</span>
            <span className="ml-auto text-fg-muted tabular-nums">{coverage.omitted.length}</span>
          </button>
          {omittedOpen && (
            <ul className="pb-2">
              {coverage.omitted.map((o) => (
                <li key={`${o.file}:${o.line}:${o.reason}`}>
                  <button
                    type="button"
                    onClick={() => onReveal(o.file)}
                    onMouseEnter={() => onHover({ kind: "file", path: o.file })}
                    onMouseLeave={() => onHover(null)}
                    className="flex w-full gap-3 px-3 py-0.5 text-left hover:bg-raised"
                  >
                    <span className="shrink-0 font-mono text-fg-muted">
                      {o.file}:{o.line}
                    </span>
                    <span className="text-fg-muted">{o.reason}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
