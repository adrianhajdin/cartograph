# Phase 11 — Private repository access via GitHub OAuth

**Date**: 2026-10-04
**Status**: Proposed

## Summary

This decision extends Cartograph from public-only repositories to support private repositories. Users connect their GitHub account using Clerk OAuth to grant repository access. GitHub's `repo` scope grants full read and write access to private repositories the user can access, while `read:org` grants read only organization membership access; Cartograph uses this access purely for read operations. The backend fetches private archives using authenticated GitHub API calls without storing permanent access tokens in custom database tables.

## Context

Cartograph was originally designed for public GitHub repositories only. In version 1, token storage was deliberately excluded to avoid security complexity and custom credential management.

As teams adopt Cartograph for internal architectures, analyzing private repositories has become essential. The architecture needs to securely authorize repository access, retrieve private code archives during pipeline runs, and present accessible repositories without compromising tenant isolation.

Key constraints:
- Must preserve the standalone nature of the parser (path in, data out).
- Must avoid storing raw GitHub personal access tokens or custom encrypted tokens in Postgres if a managed identity provider can handle them.
- Row level security (RLS) policies must continue to isolate organization data cleanly.

## Requirements

**User stories**:
- As a developer, I want to authenticate with GitHub and grant repository read permissions so that Cartograph can map my private codebases.
- As an organization member, I want to select from my accessible GitHub repositories directly in the workspace so that I do not need to paste raw URLs manually.
- As a team member, I want to trigger a re-analysis of a private repository using my own GitHub credentials so that our team map stays updated.

**Acceptance criteria**:
- **AC-1**: Users can connect their GitHub account with repository permissions (`repo` for private repositories granting full read and write access, and `read:org` for read only organization membership access) through Clerk OAuth.
- **AC-2**: The repository submission interface displays a searchable list of the user's public and private repositories alongside the direct URL input.
- **AC-3**: The pipeline fetches private repository tarballs and commit metadata using an authenticated Bearer token via the GitHub REST API.
- **AC-4**: If a user lacks private repository access or their token is revoked, the UI displays a clear inline error and re-authentication action.
- **AC-5**: Parsed graph data and explanations for private repositories are stored with standard organization-level isolation and RLS policies.
- **AC-6**: Organization SAML restrictions or missing third-party application approvals return actionable error messages guiding the user to fix permissions in GitHub settings.

## Options considered

### Option 1: Custom database token store with AES-GCM encryption

Store OAuth access and refresh tokens directly in a `github_tokens` table in Supabase, encrypted using Web Crypto (AES-256-GCM) with an encryption secret in environment variables.

**Pros**:
- Full decoupling from the authentication provider's token caching behavior.
- Allows headless background jobs to access tokens without user interaction.

**Cons**:
- Requires key management, token rotation logic, and custom cryptographic operations.
- Storing high-privilege credentials in the database increases blast radius on data breaches.

### Option 2: Clerk managed OAuth token retrieval on demand (Chosen)

Leverage Clerk's native OAuth provider token management. When an authenticated request needs a GitHub token, the server calls `clerkClient.users.getUserOauthAccessToken(userId, 'oauth_github')`.

**Pros**:
- Zero custom credential storage in the database.
- Clerk handles token lifecycles, refresh cycles, and secure storage automatically.
- Aligns with the boring technology and minimal code principle.

**Cons**:
- Requires the user to have signed in or linked their GitHub account through Clerk.

## Decision

**Chosen option**: Option 2: Clerk managed OAuth token retrieval on demand.

Cartograph will retrieve GitHub OAuth tokens on demand via Clerk's server SDK during pipeline execution and repository discovery. No GitHub tokens will be written to Postgres tables.

## Feature design

**Data model modifications**:
- `analyses` table: Add `user_id text` (nullable) to record which Clerk user initiated the pipeline run.

**API surface**:
| Endpoint / Server Action | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `listUserRepositories` | Server Action | search: string, page: number | repos: Array<{owner, name, private, defaultBranch}> | Clerk Session | 401 (Not signed in), 403 (No GitHub token) |
| `submitAnalysis` | Server Action | url: string, isPrivate: boolean | analysisId: string | Clerk Org Session | 403 (Token missing / invalid scope), 404 (Repo not found) |
| `rerunAnalysis` | Server Action | analysisId: string | success: boolean | Clerk Org Session | 403 (Token expired / unauthorized) |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| List repositories | Repo names and privacy badges | GitHub REST API `/user/repos` via Clerk OAuth token |
| Pipeline commit lookup | Commit SHA | GitHub REST API `/repos/{owner}/{repo}/commits/HEAD` with Bearer auth |
| Pipeline archive fetch | Repository tarball stream | GitHub REST API `/repos/{owner}/{repo}/tarball/{sha}` with Bearer auth |
| Re-run analysis | Latest commit and new analysis run | Current clicking user's Clerk GitHub token |

**Key invariants**:
- The parser remains completely unaware of authentication or GitHub tokens. It operates on a local directory unpacked from the tarball.
- GitHub access tokens are ephemeral in memory during request execution and never logged or serialized to client state.

**Security model**:
- All analyses belong to an organization, governed by Supabase RLS.
- Only members of the organization can view analysis results.
- Token retrieval requires an active authenticated Clerk session matching the caller.

**Configuration required**:
- Clerk Dashboard: Enable GitHub Social Connection with requested scopes (`repo` granting private repository access and `read:org` for organization membership).

**Critical test scenarios**:
- Happy path: User connects GitHub, picks a private repo from the dropdown, and successfully renders the dependency map. Verifies **AC-1**, **AC-2**, **AC-3**, **AC-5**.
- Token missing: User without connected GitHub pastes a private repo URL. Inline prompt shows "Connect GitHub to access private repositories". Verifies **AC-4**.
- SAML/Org block: User attempts import on an enterprise repo without third-party app grant. Error displays actionable SAML approval guidance. Verifies **AC-6**.

## Build plan

1. Configure Clerk GitHub OAuth provider settings with requested scopes (`repo`, `read:org`), satisfies **AC-1**.
2. Add `user_id` column to `analyses` table in Supabase migration, satisfies **AC-5**.
3. Create server helper `getGitHubToken(userId)` using Clerk server SDK, satisfies **AC-1**, **AC-4**.
4. Update `lib/pipeline/github.ts` to accept an optional auth token for commit resolution and tarball streaming, satisfies **AC-3**, **AC-6**.
5. Implement `listUserRepositories` server action to fetch accessible repos for the picker UI, satisfies **AC-2**.
6. Update workspace dashboard submission form with repository selector and connect GitHub prompt, satisfies **AC-2**, **AC-4**.
7. Update `rerunAnalysis` action to pass the executing user's token to the claim pipeline, satisfies **AC-3**.

## Consequences

**Positive**:
- Teams can analyze proprietary codebases without changing their workflow.
- No cryptographic key management or token databases to operate and secure.

**Negative / tradeoffs**:
- Users must authenticate or link their GitHub account with appropriate scopes.
- Token retrieval adds a low-latency network call to Clerk's API during repo fetch initialization.

## Follow-up

- [ ] Update `docs/project-doc.md` to document the v2 private repository support decision and remove the v1 restriction note.
