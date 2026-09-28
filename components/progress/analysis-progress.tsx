"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { StateMark } from "@/components/state-mark";
import { STAGES, STALE_AFTER_MS, type Progress } from "@/lib/pipeline/stages";
import { RerunButton } from "./rerun-button";
import { sameProgress, useProgress } from "./use-progress";

type Props = {
  analysisId: string;
  repository: { owner: string; name: string };
  commitSha: string | null;
  initial: Progress;
  /** Worked out by the server at render; only true while nothing has moved since. */
  staleAtRender: boolean;
  /** Formatted by the server, so the browser renders the text it was sent. */
  started: { iso: string; ago: string } | null;
};

type Step = "done" | "current" | "failed" | "stale" | "pending";

export function AnalysisProgress({ analysisId, repository, commitSha, initial, staleAtRender, started }: Props) {
  const { progress, lost, restarted } = useProgress(analysisId, initial);
  const router = useRouter();

  // Stored is the last stage; once it lands the server has a map to render at
  // this same address, so the page is re-rendered into it.
  const complete = progress.status === "complete";
  useEffect(() => {
    if (complete) router.refresh();
  }, [complete, router]);
  const stale = staleAtRender && sameProgress(progress, initial);
  const current = STAGES.findIndex((s) => s.stage === progress.stage);
  const canRerun = stale || progress.status === "complete" || progress.status === "failed";

  const step = (i: number): Step => {
    if (progress.status === "complete") return "done";
    if (progress.status === "queued" || current === -1 || i > current) return "pending";
    if (i < current) return "done";
    if (progress.status === "failed") return "failed";
    return stale ? "stale" : "current";
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line px-3 text-xs">
        <h1 className="font-mono text-[13px]">
          <span className="text-fg-muted">{repository.owner}/</span>
          {repository.name}
        </h1>
        {commitSha && (
          <span className="font-mono text-fg-muted" title={commitSha}>
            {commitSha.slice(0, 7)}
          </span>
        )}
        <span className="flex items-center gap-1.5 text-fg-muted">
          <StateMark status={progress.status} stale={stale} />
          {stale ? "stale" : progress.status}
        </span>
        <span className="ml-auto">{canRerun && <RerunButton analysisId={analysisId} onStarted={restarted} />}</span>
      </div>

      <div className="px-3 py-4">
        <ol className="max-w-2xl text-xs">
          {STAGES.map(({ stage, label }, i) => {
            const state = step(i);
            const detail = state === "current" || state === "failed" || state === "stale" ? progress.message : null;
            return (
              <li key={stage} className="grid grid-cols-[1rem_7rem_minmax(0,1fr)] items-baseline gap-x-2 py-1">
                <span className={state === "pending" ? "text-line" : "text-fg"}>
                  <StepMark state={state} />
                </span>
                <span className={state === "pending" ? "text-fg-muted" : "text-fg"}>{label}</span>
                <span className={state === "failed" ? "text-fg" : "text-fg-muted"}>{detail}</span>
              </li>
            );
          })}
        </ol>

        {stale && (
          <p className="mt-3 max-w-2xl text-xs text-fg-muted">
            No progress for over {STALE_AFTER_MS / 60000} minutes
            {started && (
              <>
                {" "}
                since it started{" "}
                <time dateTime={started.iso} title={started.iso}>
                  {started.ago}
                </time>
              </>
            )}
            . The process running it has most likely stopped; re-run to start again.
          </p>
        )}
        {complete && progress.message && <p className="mt-3 text-xs text-fg">{progress.message} — opening the map…</p>}
        {lost && (
          <p className="mt-3 max-w-2xl text-xs text-fg">
            Live updates stopped ({lost}). Reload to see where the run is.
          </p>
        )}
      </div>
    </div>
  );
}

function StepMark({ state }: { state: Step }) {
  switch (state) {
    case "done":
      return <StateMark status="complete" />;
    case "current":
      return <StateMark status="running" />;
    case "stale":
      return <StateMark status="running" stale />;
    case "failed":
      return <StateMark status="failed" />;
    case "pending":
      return <StateMark status="queued" />;
  }
}
