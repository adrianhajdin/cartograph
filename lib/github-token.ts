import { clerkClient } from "@clerk/nextjs/server";

export type GitHubTokenResult =
  | { ok: true; token: string | null }
  | { ok: false; error: string };

export async function getGitHubToken(userId: string | null): Promise<GitHubTokenResult> {
  if (!userId) return { ok: true, token: null };
  try {
    const clerk = await clerkClient();
    const response = await clerk.users.getUserOauthAccessToken(userId, "oauth_github");
    const list = Array.isArray(response) ? response : (response?.data || []);
    const tokenObj = list.find((t: { token?: string }) => t.token);
    return { ok: true, token: tokenObj?.token ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to fetch GitHub token for user:", err);
    return { ok: false, error: message };
  }
}


