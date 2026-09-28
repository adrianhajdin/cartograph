import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { x as extract } from "tar";

export type Repository = { owner: string; name: string };

// Past this the archive isn't downloaded at all. There's no queue or worker to
// hand a huge repository to, so the limit is stated rather than engineered round.
export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

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
export async function resolveHeadCommit({ owner, name }: Repository): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${name}/commits/HEAD`, {
    headers: { Accept: "application/vnd.github.sha", "User-Agent": "cartograph" },
  });
  if (response.ok) {
    const sha = (await response.text()).trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new PipelineError(`GitHub returned an unexpected commit for ${owner}/${name}`);
    return sha;
  }
  if (response.status === 404) {
    throw new PipelineError(`${owner}/${name} doesn't exist on GitHub, or it isn't public`);
  }
  if (response.status === 409 || response.status === 422) {
    throw new PipelineError(`${owner}/${name} has no commits to analyse`);
  }
  if ((response.status === 403 || response.status === 429) && response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const when = Number.isFinite(reset) ? ` until ${new Date(reset * 1000).toISOString()}` : "";
    throw new PipelineError(`GitHub's unauthenticated rate limit is used up${when}`);
  }
  throw new PipelineError(`GitHub answered ${response.status} when asked for ${owner}/${name}'s latest commit`);
}

// Streams the archive straight into the directory, dropping GitHub's
// "<owner>-<name>-<sha>/" wrapper folder. tar refuses absolute paths and "..",
// so nothing lands outside it.
export async function downloadArchive({ owner, name }: Repository, sha: string, directory: string): Promise<number> {
  const response = await fetch(`https://codeload.github.com/${owner}/${name}/tar.gz/${sha}`, {
    headers: { "User-Agent": "cartograph" },
  });
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
  await pipeline(Readable.from(chunks(response.body)), limit, extract({ cwd: directory, strip: 1 }));
  return received;
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
