"use client";

import { useRouter } from "next/navigation";
import { RerunButton } from "./progress/rerun-button";

// Above the shell, not in it: the map's columns stay where they are. Re-running
// hands the page back to the progress view, which the server renders once the
// row says running.
export function AnalysisHeader({ analysisId, repository, commitSha }: { analysisId: string; repository: { owner: string; name: string }; commitSha: string }) {
  const router = useRouter();
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line px-3 text-xs">
      <h1 className="font-mono text-[13px]">
        <span className="text-fg-muted">{repository.owner}/</span>
        {repository.name}
      </h1>
      <span className="font-mono text-fg-muted" title={commitSha}>
        {commitSha.slice(0, 7)}
      </span>
      <span className="ml-auto">
        <RerunButton analysisId={analysisId} onStarted={() => router.refresh()} />
      </span>
    </div>
  );
}
