"use client";

import { useCallback, useEffect, useState } from "react";
import { progressTopic, type Progress, type Stage, type Status } from "@/lib/pipeline/stages";
import { useBrowserSupabase } from "@/lib/supabase/browser";

const STATUSES: readonly Status[] = ["queued", "running", "complete", "failed"];
const STAGE_NAMES: readonly Stage[] = ["fetch", "select", "parse", "store"];

// Follows one analysis's channel while it's unfinished. Starts from what the
// server rendered; after joining, reads the row once, because a stage that
// moved between the render and the join was published to nobody. After that,
// only the channel, never a poll.
export function useProgress(analysisId: string, initial: Progress) {
  const supabase = useBrowserSupabase();
  const [progress, setProgress] = useState(initial);
  const [lost, setLost] = useState<string | null>(null);
  const following = progress.status === "queued" || progress.status === "running";

  useEffect(() => {
    if (!supabase || !following) return;
    let cancelled = false;
    const channel = supabase
      .channel(progressTopic(analysisId), { config: { private: true } })
      .on("broadcast", { event: "progress" }, ({ payload }) => {
        const next = parseProgress(payload);
        if (next && !cancelled) setProgress(next);
      })
      .subscribe(async (state, error) => {
        if (cancelled) return;
        if (state === "SUBSCRIBED") {
          setLost(null);
          const { data } = await supabase
            .from("analyses")
            .select("status, stage, stage_message, error")
            .eq("id", analysisId)
            .maybeSingle();
          if (!data || cancelled) return;
          const read: Progress = {
            status: data.status,
            stage: data.stage,
            message: data.status === "failed" ? data.error : data.stage_message,
          };
          // Same content keeps the same object, so "unchanged since render" stays true.
          setProgress((current) => (sameProgress(current, read) ? current : read));
        } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
          // Said out loud: a page that silently stops updating looks like a stuck run.
          setLost(error?.message ?? state.toLowerCase());
        }
      });
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [supabase, analysisId, following]);

  // A re-run was just claimed: follow again from its first stage.
  const restarted = useCallback(() => setProgress({ status: "running", stage: "fetch", message: "Starting" }), []);

  return { progress, lost, restarted };
}

export function sameProgress(a: Progress, b: Progress): boolean {
  return a.status === b.status && a.stage === b.stage && a.message === b.message;
}

// The payload crosses a network boundary, so it's checked, not asserted.
function parseProgress(value: unknown): Progress | null {
  if (typeof value !== "object" || value === null) return null;
  const status = STATUSES.find((s) => s === Reflect.get(value, "status"));
  const rawStage = Reflect.get(value, "stage");
  const stage = rawStage === null ? null : STAGE_NAMES.find((s) => s === rawStage);
  const message = Reflect.get(value, "message");
  if (!status || stage === undefined || (message !== null && typeof message !== "string")) return null;
  return { status, stage, message };
}
