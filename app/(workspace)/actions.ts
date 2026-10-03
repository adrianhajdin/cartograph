"use server";

import { auth } from "@clerk/nextjs/server";
import { getGitHubToken } from "@/lib/github-token";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { PipelineError, resolveHeadCommit } from "@/lib/pipeline/github";
import { AlreadyRunningError, claimAnalysis, continueRun, type ClaimedRun } from "@/lib/pipeline/run";
import { submitRepository } from "@/lib/pipeline/submit";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export type FormState = { error: string | null };

// Pasting a URL creates the analysis and starts it, or, if this organization
// already has one for the repository, goes to it without running anything.
// The organization comes off the session token, never from the form.
export async function submitAnalysis(_previous: FormState, form: FormData): Promise<FormState> {
  const { orgId, userId } = await auth();
  if (!orgId) return { error: "No active organization" };
  const url = form.get("url");
  if (typeof url !== "string" || !url.trim()) return { error: "Paste a GitHub repository URL" };

  const admin = createAdminSupabase();
  let analysisId: string;
  try {
    const submission = await submitRepository(admin, orgId, url, userId);
    analysisId = submission.analysisId;
    if (submission.created) {
      const tokenResult = await getGitHubToken(userId);
      if (!tokenResult.ok) {
        return { error: `Authentication provider error: ${tokenResult.error}` };
      }
      const token = tokenResult.token ?? undefined;
      const claimed = await claimAnalysis(admin, analysisId);
      claimed.token = token;
      start(claimed);
    }
  } catch (error) {
    if (error instanceof PipelineError) return { error: error.message };
    throw error;
  }
  redirect(`/analyses/${analysisId}`);
}

// Re-running is only ever this: a deliberate act from the analysis itself.
export async function rerunAnalysis(analysisId: string): Promise<FormState> {
  // Visibility is the policy's call: another organization's analysis isn't
  // there to re-run. The writer below bypasses policies, so this read comes first.
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("analyses")
    .select("id, projects(repo_owner, repo_name)")
    .eq("id", analysisId)
    .maybeSingle();
  if (error) throw new Error(`Couldn't read analysis: ${error.message}`);
  if (!data || !data.projects) return { error: "Analysis not found" };

  try {
    const userId = (await auth()).userId;
    const tokenResult = await getGitHubToken(userId);
    if (!tokenResult.ok) {
      return { error: `Authentication provider error: ${tokenResult.error}` };
    }
    const token = tokenResult.token ?? undefined;

    // Verify repository access and resolve HEAD before claiming the analysis row
    await resolveHeadCommit({ owner: data.projects.repo_owner, name: data.projects.repo_name }, token);

    const claimed = await claimAnalysis(createAdminSupabase(), analysisId);
    claimed.token = token;
    start(claimed);
  } catch (error) {
    if (error instanceof PipelineError) return { error: error.message };
    if (error instanceof AlreadyRunningError) return { error: "It's already running" };
    throw error;
  }
  return { error: null };
}

// The run outlives the response. It records its own failure on the row; this
// only makes sure nothing is lost if even that fails.
function start(claimed: ClaimedRun): void {
  after(async () => {
    try {
      await continueRun(createAdminSupabase(), claimed);
    } catch (error) {
      console.error(`Analysis ${claimed.analysisId} failed:`, error);
    }
  });
}
