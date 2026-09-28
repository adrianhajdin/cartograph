import { auth } from "@clerk/nextjs/server";
import { connection } from "next/server";
import { AnalysisRow, type RowData } from "@/components/progress/analysis-row";
import { StateMark } from "@/components/state-mark";
import { SubmitForm } from "@/components/submit-form";
import { isStale, type Status } from "@/lib/pipeline/stages";
import { createServerSupabase } from "@/lib/supabase/server";
import { ago } from "@/lib/time";

const LIST_LIMIT = 100;
type Tally = Status | "stale";
const TALLY_ORDER: Tally[] = ["running", "queued", "stale", "complete", "failed"];

export default async function DashboardPage() {
  const { sessionClaims } = await auth();

  // Read off the token, never fetched from Clerk. If the claim is missing the
  // session token hasn't been customised yet, and that should be obvious.
  const orgName = sessionClaims?.org_name;
  if (!orgName) {
    throw new Error(
      'Session token has no org_name claim. Add "org_name": "{{org.name}}" in Clerk → Sessions → Customize session token.',
    );
  }

  const rows = await loadRows();

  const counts = new Map<Tally, number>();
  for (const r of rows) {
    const tally: Tally = r.staleAtRender ? "stale" : r.progress.status;
    counts.set(tally, (counts.get(tally) ?? 0) + 1);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-4 border-b border-line px-3">
        <h1 className="text-[13px] font-semibold">{orgName}</h1>
        <span className="text-xs text-fg-muted tabular-nums">
          {rows.length === LIST_LIMIT
            ? `Latest ${LIST_LIMIT} analyses`
            : `${rows.length} ${rows.length === 1 ? "analysis" : "analyses"}`}
        </span>
        <SubmitForm />
        {rows.length > 0 && (
          <ul className="ml-auto flex items-center gap-3 text-xs text-fg-muted tabular-nums">
            {TALLY_ORDER.filter((s) => counts.has(s)).map((s) => (
              <li key={s} className="flex items-center gap-1.5">
                <StateMark status={s === "stale" ? "running" : s} stale={s === "stale"} />
                {counts.get(s)} {s}
              </li>
            ))}
          </ul>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="px-3 py-10 text-xs text-fg-muted">
          <p className="text-fg">No analyses yet.</p>
          <p className="mt-1">Paste a public GitHub repository above to map it.</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed border-collapse text-xs">
            <colgroup>
              <col />
              <col className="w-28" />
              <col className="hidden w-20 sm:table-column" />
              <col className="w-20" />
              <col className="hidden w-20 sm:table-column" />
            </colgroup>
            <thead className="sticky top-0 bg-canvas text-left text-fg-muted">
              <tr className="h-7 border-b border-line">
                <th className="px-3 font-normal">Repository</th>
                <th className="px-3 font-normal">State</th>
                <th className="hidden px-3 font-normal sm:table-cell">Commit</th>
                <th className="px-3 text-right font-normal">Started</th>
                <th className="hidden px-3 text-right font-normal sm:table-cell">Finished</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <AnalysisRow key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Loaded before rendering, and the clock read here: stale and "3m ago" are
// facts about the moment of the request, worked out once. Nothing ticks in
// the browser.
async function loadRows(): Promise<RowData[]> {
  // No organization filter: the row policy scopes this to the organization on
  // the token. Switching organization changes the token, not this query.
  const supabase = await createServerSupabase();
  const { data: analyses, error } = await supabase
    .from("analyses")
    .select("id, status, stage, stage_message, commit_sha, error, created_at, started_at, finished_at, projects(repo_owner, repo_name)")
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) throw new Error(`Couldn't load analyses: ${error.message}`);

  await connection();
  const now = Date.now();
  return analyses.map((a) => ({
    id: a.id,
    repository: a.projects ? { owner: a.projects.repo_owner, name: a.projects.repo_name } : null,
    commitSha: a.commit_sha,
    progress: { status: a.status, stage: a.stage, message: a.status === "failed" ? a.error : a.stage_message },
    staleAtRender: isStale(a, now),
    created: { iso: a.created_at, ago: ago(a.created_at, now) },
    finished: a.finished_at ? { iso: a.finished_at, ago: ago(a.finished_at, now) } : null,
  }));
}
