"use client";

import Link from "next/link";
import { StateMark } from "@/components/state-mark";
import { STALE_AFTER_MS, type Progress } from "@/lib/pipeline/stages";
import { sameProgress, useProgress } from "./use-progress";

export type RowData = {
  id: string;
  repository: { owner: string; name: string } | null;
  commitSha: string | null;
  progress: Progress;
  staleAtRender: boolean;
  // Formatted by the server, so the browser renders the same text it was sent.
  created: { iso: string; ago: string };
  finished: { iso: string; ago: string } | null;
};

// One dashboard row. An unfinished one follows its own channel, so a run
// started in another tab moves here too.
export function AnalysisRow({ row }: { row: RowData }) {
  const { progress } = useProgress(row.id, row.progress);
  const stale = row.staleAtRender && sameProgress(progress, row.progress);
  const finishedNow = !row.finished && (progress.status === "complete" || progress.status === "failed");
  const note = progress.status === "complete" ? null : progress.message;

  return (
    <tr className="border-b border-line align-top hover:bg-raised">
      <td className="truncate px-3 py-1.5 font-mono">
        <Link href={`/analyses/${row.id}`} className="block">
          {row.repository ? (
            <>
              <span className="text-fg-muted">{row.repository.owner}/</span>
              {row.repository.name}
            </>
          ) : (
            <span className="text-fg-muted">—</span>
          )}
          {note && (
            <span className="mt-0.5 block truncate font-sans text-fg-muted" title={note}>
              {stale ? `No progress for over ${STALE_AFTER_MS / 60000} minutes — ${note}` : note}
            </span>
          )}
        </Link>
      </td>
      <td className="px-3 py-1.5">
        <span className={`flex items-center gap-1.5 ${progress.status === "queued" ? "text-fg-muted" : "text-fg"}`}>
          <StateMark status={progress.status} stale={stale} />
          {stale ? "stale" : progress.status}
          {progress.status === "running" && !stale && progress.stage && (
            <span className="text-fg-muted">· {progress.stage}</span>
          )}
        </span>
      </td>
      <td className="hidden px-3 py-1.5 font-mono text-fg-muted sm:table-cell">
        {row.commitSha ? <span title={row.commitSha}>{row.commitSha.slice(0, 7)}</span> : "—"}
      </td>
      <td className="px-3 py-1.5 text-right text-fg-muted tabular-nums">
        <time dateTime={row.created.iso} title={row.created.iso}>
          {row.created.ago}
        </time>
      </td>
      <td className="hidden px-3 py-1.5 text-right text-fg-muted tabular-nums sm:table-cell">
        {row.finished ? (
          <time dateTime={row.finished.iso} title={row.finished.iso}>
            {row.finished.ago}
          </time>
        ) : finishedNow ? (
          "just now"
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}
