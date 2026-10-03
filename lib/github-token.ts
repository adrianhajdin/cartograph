import { clerkClient } from "@clerk/nextjs/server";

export async function getGitHubToken(userId: string | null): Promise<string | undefined> {
  if (!userId) return undefined;
  try {
    const clerk = await clerkClient();
    const response = await clerk.users.getUserOauthAccessToken(userId, "oauth_github");
    const list = Array.isArray(response) ? response : (response?.data || []);
    const tokenObj = list.find((t: { token?: string }) => t.token);
    return tokenObj?.token;
  } catch (err) {
    console.error("Failed to fetch GitHub token for user:", err);
    return undefined;
  }
}

