"use client";

import { useState, useEffect, useActionState, useRef, useTransition } from "react";
import { submitAnalysis, type FormState } from "@/app/(workspace)/actions";
import { listUserRepositories, type UserRepo } from "@/app/(workspace)/repos-action";
import { useClerk, useUser } from "@clerk/nextjs";

const INITIAL: FormState = { error: null };

export function SubmitForm({ hasGitHubToken: initialHasGitHubToken }: { hasGitHubToken?: boolean } = {}) {
  const [state, action, pending] = useActionState(submitAnalysis, INITIAL);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "private" | "public">("all");
  const [allRepos, setAllRepos] = useState<UserRepo[]>([]);
  const [hasGitHubToken, setHasGitHubToken] = useState<boolean | null>(initialHasGitHubToken ?? null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isPendingAuth, startAuthTransition] = useTransition();

  const { openUserProfile } = useClerk();
  const { user } = useUser();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadRepositories = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await listUserRepositories();
      setHasGitHubToken(res.hasGitHubToken);
      if (res.error) {
        setFetchError(res.error);
      }
      setAllRepos(res.repos);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to load repositories");
    } finally {
      setLoading(false);
    }
  };

  const handleFocus = () => {
    setIsOpen(true);
    if (allRepos.length === 0 && !loading) {
      loadRepositories();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setIsOpen(true);
  };

  const handleSelectRepo = (repo: UserRepo) => {
    setQuery(`github.com/${repo.owner}/${repo.name}`);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleConnectGitHub = () => {
    startAuthTransition(async () => {
      if (user) {
        try {
          const res = await user.createExternalAccount({
            strategy: "oauth_github",
            redirectUrl: window.location.href,
          });
          if (res.verification?.externalVerificationRedirectURL) {
            window.location.href = res.verification.externalVerificationRedirectURL.href;
            return;
          }
        } catch {
          // Open profile modal if inline authorization is not supported
        }
      }
      openUserProfile();
    });
  };

  // Filter repositories based on search text and privacy tab
  const filteredRepos = allRepos.filter((r) => {
    if (filter === "private" && !r.private) return false;
    if (filter === "public" && r.private) return false;
    if (!query.trim()) return true;

    const term = query.trim().toLowerCase().replace(/^https?:\/\/github\.com\//, "");
    return (
      r.name.toLowerCase().includes(term) ||
      r.owner.toLowerCase().includes(term) ||
      `${r.owner}/${r.name}`.toLowerCase().includes(term)
    );
  });

  return (
    <div ref={containerRef} className="relative flex min-w-0 items-center gap-2">
      <form action={action} className="flex min-w-0 items-center gap-2">
        <div className="relative">
          <input
            ref={inputRef}
            name="url"
            required
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={handleInputChange}
            onFocus={handleFocus}
            onKeyDown={handleKeyDown}
            placeholder="github.com/owner/repo"
            aria-label="GitHub repository URL"
            aria-invalid={state.error ? true : undefined}
            className="h-6 w-72 min-w-0 rounded border border-line bg-canvas px-2 font-mono text-xs outline-none placeholder:text-fg-muted focus:border-accent"
          />

          {isOpen && (
            <div className="absolute left-0 top-7 z-50 w-96 max-h-80 overflow-hidden rounded border border-line bg-surface p-1 shadow-lg text-xs flex flex-col">
              {hasGitHubToken === false ? (
                <div className="p-3 text-center text-fg-muted flex flex-col items-center gap-2">
                  <p className="text-fg">Connect GitHub account</p>
                  <p className="text-[11px] leading-relaxed">
                    Link your GitHub account to automatically discover, list, and map your private repositories.
                  </p>
                  <button
                    type="button"
                    onClick={handleConnectGitHub}
                    disabled={isPendingAuth}
                    className="mt-1 rounded bg-accent px-3 py-1 text-xs text-accent-fg hover:opacity-90 disabled:opacity-60 cursor-pointer"
                  >
                    {isPendingAuth ? "Connecting…" : "Connect GitHub"}
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between border-b border-line px-2 py-1.5 bg-canvas/50">
                    <span className="text-[11px] font-medium text-fg-muted uppercase tracking-wider">
                      Your Repositories
                    </span>
                    <div className="flex items-center gap-1 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setFilter("all")}
                        className={`rounded px-1.5 py-0.5 ${filter === "all" ? "bg-raised font-medium text-fg" : "text-fg-muted hover:text-fg"}`}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => setFilter("private")}
                        className={`rounded px-1.5 py-0.5 ${filter === "private" ? "bg-raised font-medium text-fg" : "text-fg-muted hover:text-fg"}`}
                      >
                        Private
                      </button>
                      <button
                        type="button"
                        onClick={() => setFilter("public")}
                        className={`rounded px-1.5 py-0.5 ${filter === "public" ? "bg-raised font-medium text-fg" : "text-fg-muted hover:text-fg"}`}
                      >
                        Public
                      </button>
                    </div>
                  </div>

                  <div className="max-h-64 overflow-y-auto divide-y divide-line/40">
                    {loading && (
                      <div className="p-3 text-center text-fg-muted">Loading repositories from GitHub…</div>
                    )}
                    {fetchError && (
                      <div className="p-3 text-center text-fg">
                        <p className="text-xs">{fetchError}</p>
                        <button
                          type="button"
                          onClick={loadRepositories}
                          className="mt-2 text-[11px] text-accent underline"
                        >
                          Retry
                        </button>
                      </div>
                    )}
                    {!loading && !fetchError && filteredRepos.length === 0 && (
                      <div className="p-3 text-center text-fg-muted">
                        {query.trim() ? "No matching repositories found" : "No repositories found"}
                      </div>
                    )}
                    {!loading &&
                      !fetchError &&
                      filteredRepos.map((repo) => (
                        <button
                          key={`${repo.owner}/${repo.name}`}
                          type="button"
                          onClick={() => handleSelectRepo(repo)}
                          className="flex w-full items-start justify-between p-2 text-left hover:bg-raised transition-colors"
                        >
                          <div className="min-w-0 flex-1 pr-2">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs text-fg font-medium truncate">
                                {repo.owner}/{repo.name}
                              </span>
                            </div>
                            {repo.description && (
                              <p className="truncate text-[11px] text-fg-muted mt-0.5">
                                {repo.description}
                              </p>
                            )}
                          </div>
                          {repo.private ? (
                            <span className="shrink-0 rounded border border-line bg-raised px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">
                              Private
                            </span>
                          ) : (
                            <span className="shrink-0 rounded border border-line/40 px-1.5 py-0.5 text-[10px] text-fg-muted">
                              Public
                            </span>
                          )}
                        </button>
                      ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={pending}
          className="h-6 shrink-0 rounded bg-accent px-2 text-xs text-accent-fg disabled:opacity-60 cursor-pointer"
        >
          {pending ? "Starting…" : "Analyse"}
        </button>
      </form>

      {hasGitHubToken === false && (
        <button
          type="button"
          onClick={handleConnectGitHub}
          disabled={isPendingAuth}
          className="h-6 shrink-0 rounded border border-line bg-canvas px-2 text-xs text-fg-muted hover:text-fg hover:border-accent cursor-pointer"
          title="Connect GitHub for private repositories"
        >
          {isPendingAuth ? "Connecting…" : "Connect GitHub"}
        </button>
      )}

      {state.error && (
        <span role="alert" className="truncate text-xs text-fg">
          {state.error}
        </span>
      )}
    </div>
  );
}

