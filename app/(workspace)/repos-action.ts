"use server";
import { getGitHubToken } from "@/lib/github-token";
import { auth } from "@clerk/nextjs/server";

export type UserRepo = {
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  pushedAt: string | null;
};

type GitHubApiRepo = {
  owner: { login: string };
  name: string;
  private: boolean;
  default_branch: string;
  description: string | null;
  pushed_at: string | null;
};

export async function listUserRepositories(search?: string): Promise<{
  repos: UserRepo[];
  hasGitHubToken: boolean;
  error?: string;
}> {
  const { userId } = await auth();
  const tokenResult = await getGitHubToken(userId);
  if (!tokenResult.ok) {
    return { repos: [], hasGitHubToken: false, error: `Failed to load GitHub credentials: ${tokenResult.error}` };
  }
  const token = tokenResult.token;
  if (!token) return { repos: [], hasGitHubToken: false };

  try {
    const url = "https://api.github.com/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&sort=updated&per_page=100";
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "cartograph",
      },
      cache: "no-store",
    });

    if (res.status === 401) {
      return { repos: [], hasGitHubToken: false, error: "GitHub session expired. Reconnect GitHub." };
    }

    if (res.status === 403 && res.headers.get("x-github-sso")) {
      return {
        repos: [],
        hasGitHubToken: true,
        error: "Your organization requires SAML SSO authorization for GitHub apps.",
      };
    }

    if (!res.ok) {
      return {
        repos: [],
        hasGitHubToken: true,
        error: `GitHub returned status ${res.status}`,
      };
    }

    const items: GitHubApiRepo[] = await res.json();
    let repos: UserRepo[] = items.map((r) => ({
      owner: r.owner.login,
      name: r.name,
      private: r.private,
      defaultBranch: r.default_branch || "main",
      description: r.description,
      pushedAt: r.pushed_at,
    }));

    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      repos = repos.filter(
        (r) =>
          r.name.toLowerCase().includes(term) ||
          r.owner.toLowerCase().includes(term) ||
          `${r.owner}/${r.name}`.toLowerCase().includes(term)
      );
    }

    return { repos, hasGitHubToken: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { repos: [], hasGitHubToken: true, error: message };
  }
}

