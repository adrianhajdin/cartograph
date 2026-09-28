import type { Enums } from "../supabase/database.types.ts";

// Shared by the pipeline and the pages that show it, so there's one list of
// stages and one definition of stale. No Node imports: the browser loads this.

export type Status = Enums<"analysis_status">;
export type Stage = Enums<"analysis_stage">;

// What the database publishes on "analysis:<id>" when a run moves. On failure
// the message is the reason.
export type Progress = { status: Status; stage: Stage | null; message: string | null };

export const STAGES: readonly { stage: Stage; label: string }[] = [
  { stage: "fetch", label: "Fetch archive" },
  { stage: "select", label: "Select files" },
  { stage: "parse", label: "Parse imports" },
  { stage: "store", label: "Store map" },
];

// Nothing here has a queue or a timeout, so a process that dies mid-run leaves
// a row that says "running" forever. Past this it's shown as stale, and can
// be started again. Parsing a large repository takes well under this.
export const STALE_AFTER_MS = 5 * 60 * 1000;

export function progressTopic(analysisId: string): string {
  return `analysis:${analysisId}`;
}

// A queued row is measured from when it was created (its run never claimed
// it); a running one from when its run began.
export function isStale(
  row: { status: Status; created_at: string; started_at: string | null },
  now: number,
): boolean {
  if (row.status === "queued") return now - Date.parse(row.created_at) > STALE_AFTER_MS;
  if (row.status === "running") return row.started_at !== null && now - Date.parse(row.started_at) > STALE_AFTER_MS;
  return false;
}
