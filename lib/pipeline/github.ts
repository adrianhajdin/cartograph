import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { x as extract } from "tar";

export type Repository = { owner: string; name: string };

// Past this the archive isn't downloaded at all. There's no queue or worker to
// hand a huge repository to, so the limit is stated rather than engineered round.
export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

// A hung request would otherwise hold the run in its stage until it goes stale.
// The archive's limit covers streaming the whole body, so it's far longer.
const API_TIMEOUT_MS = 15_000;
const ARCHIVE_TIMEOUT_MS = 5 * 60_000;

// The message is written for the person who pasted the URL, and is what the
// failed row shows.
export class PipelineError extends Error {
  override name = "PipelineError";
}

const NAME = /^[A-Za-z0-9_.-]+$/;

// Accepts what people paste: a github.com URL (with or without scheme, .git,
// or a trailing /tree/...), or owner/name. Lowercased because GitHub names are
// case-insensitive, and one repository must be one row however it's typed.
export function parseRepositoryUrl(input: string): Repository {
  const trimmed = input.trim();
  const bare = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  let owner: string | undefined;
  let name: string | undefined;
  if (bare && !bare[1].includes(".")) {
    [, owner, name] = bare;
  } else {
    let url: URL;
    try {
      url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    } catch {
      throw new PipelineError(`"${trimmed}" isn't a GitHub repository URL`);
    }
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
      throw new PipelineError(`Only github.com repositories can be analysed, not ${url.hostname}`);
    }
    [owner, name] = url.pathname.split("/").filter(Boolean);
  }
  name = name?.replace(/\.git$/, "");
  if (!owner || !name || !NAME.test(owner) || !NAME.test(name)) {
    throw new PipelineError(`"${trimmed}" doesn't name a repository; expected github.com/owner/name`);
  }
  return { owner: owner.toLowerCase(), name: name.toLowerCase() };
}

// The commit is resolved first and the archive fetched at exactly that commit,
// so the recorded sha is the code that was parsed, not whatever HEAD became
// while the download ran. Unauthenticated: no token is asked for or stored.
export async function resolveHeadCommit({ owner, name }: Repository, token?: string): Promise<string> {
  const headers: Record<string, string> = { Accept: "application/vnd.github.sha", "User-Agent": "cartograph" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await withTimeout(`Asking GitHub for ${owner}/${name}'s latest commit`, API_TIMEOUT_MS, () =>
    fetch(`https://api.github.com/repos/${owner}/${name}/commits/HEAD`, {
      headers,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    }),
  );
  if (response.ok) {
    const sha = (await withTimeout(`Asking GitHub for ${owner}/${name}'s latest commit`, API_TIMEOUT_MS, () => response.text())).trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new PipelineError(`GitHub returned an unexpected commit for ${owner}/${name}`);
    return sha;
  }
  if (response.status === 404) {
    throw new PipelineError(`${owner}/${name} doesn't exist on GitHub, or you don't have access to it`);
  }
  if (response.status === 409 || response.status === 422) {
    throw new PipelineError(`${owner}/${name} has no commits to analyse`);
  }
  if (response.status === 403 && response.headers.get("x-github-sso")) {
    throw new PipelineError(`${owner}/${name} requires SAML single sign-on approval. Please authorize the Cartograph OAuth app in your GitHub organization settings.`);
  }
  if ((response.status === 403 || response.status === 429) && response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const when = Number.isFinite(reset) ? ` until ${new Date(reset * 1000).toISOString()}` : "";
    throw new PipelineError(`GitHub's unauthenticated rate limit is used up${when}`);
  }
  throw new PipelineError(`GitHub answered ${response.status} when asked for ${owner}/${name}'s latest commit`);
}

// One file's bytes at one commit, or null when the file isn't there at that
// commit. raw.githubusercontent.com serves the committed bytes, so their
// sha256 is comparable with the hash the parser stored.
export async function fetchFileAt({ owner, name }: Repository, sha: string, filePath: string, token?: string): Promise<Buffer | null> {
  const headers: Record<string, string> = { "User-Agent": "cartograph" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const what = `Fetching ${filePath} from ${owner}/${name} at ${sha.slice(0, 7)}`;
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  const response = await withTimeout(what, API_TIMEOUT_MS, () =>
    fetch(`https://raw.githubusercontent.com/${owner}/${name}/${sha}/${encoded}`, {
      headers,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    }),
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new PipelineError(`${what} failed: GitHub answered ${response.status}`);
  return Buffer.from(await withTimeout(what, API_TIMEOUT_MS, () => response.arrayBuffer()));
}

// Streams the archive straight into the directory, dropping GitHub's
// "<owner>-<name>-<sha>/" wrapper folder. tar refuses absolute paths and "..",
// so nothing lands outside it.
export async function downloadArchive({ owner, name }: Repository, sha: string, directory: string, token?: string): Promise<number> {
  const headers: Record<string, string> = { "User-Agent": "cartograph" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const what = `Downloading the archive for ${owner}/${name}`;
  // One signal for the request and the body, so the limit is on the whole download.
  const signal = AbortSignal.timeout(ARCHIVE_TIMEOUT_MS);
  const response = await withTimeout(what, ARCHIVE_TIMEOUT_MS, () =>
    fetch(`https://codeload.github.com/${owner}/${name}/tar.gz/${sha}`, { headers, signal }),
  );
  if (!response.ok || !response.body) {
    throw new PipelineError(`Downloading the archive for ${owner}/${name} failed: GitHub answered ${response.status}`);
  }
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_ARCHIVE_BYTES) throw tooLarge(owner, name);

  // content-length isn't always sent, so the limit is enforced on the bytes too.
  let received = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      received += chunk.byteLength;
      done(received > MAX_ARCHIVE_BYTES ? tooLarge(owner, name) : null, chunk);
    },
  });
  const body = response.body;
  await withTimeout(what, ARCHIVE_TIMEOUT_MS, () => pipeline(Readable.from(chunks(body)), limit, extract({ cwd: directory, strip: 1 })));
  return received;
}

// An aborted fetch throws a bare "TimeoutError"; the failed row should say what timed out.
async function withTimeout<T>(what: string, ms: number, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new PipelineError(`${what} took longer than ${ms / 1000} seconds, so it was stopped`, { cause: error });
    }
    throw error;
  }
}

// Read through the reader rather than Readable.fromWeb: the app's DOM types
// and Node's stream types disagree about the body, and this needs no cast.
async function* chunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function tooLarge(owner: string, name: string): PipelineError {
  return new PipelineError(`${owner}/${name}'s archive is over ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB, the most this can analyse`);
}
