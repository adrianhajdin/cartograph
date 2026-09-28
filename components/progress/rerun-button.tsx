"use client";

import { useState, useTransition } from "react";
import { rerunAnalysis } from "@/app/(workspace)/actions";

export function RerunButton({ analysisId, onStarted }: { analysisId: string; onStarted: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-fg-muted">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await rerunAnalysis(analysisId);
            setError(result.error);
            if (!result.error) onStarted();
          })
        }
        className="h-6 rounded border border-line px-2 text-xs hover:bg-raised disabled:text-fg-muted"
      >
        {pending ? "Starting…" : "Re-run"}
      </button>
    </span>
  );
}
