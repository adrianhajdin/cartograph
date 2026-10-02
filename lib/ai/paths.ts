import { posix } from "node:path";
import type { FileInput, FolderInput } from "./prompts.ts";

// The invented-path check. Every path-shaped token in an answer is tested
// against the exact set of paths the model was handed; anything outside it
// was invented. Plain set membership in code, never a model grading a model:
// a hallucination detector that can itself hallucinate is worth nothing.

/** The feedback key the check is stored under, on real runs and in experiments alike. 1: nothing invented. */
export const PATH_CHECK_KEY = "no_invented_paths";

export type PathCheck = {
  /** Paths the model was shown. */
  shown: number;
  /** Distinct path-shaped tokens found in the answer, as written. */
  mentioned: string[];
  /** The ones that aren't a shown path, or a folder above one. */
  invented: string[];
};

/** The paths an explain-file question names: the file and every neighbour. */
export function shownForFile(input: FileInput): { paths: string[]; base: string } {
  return {
    paths: [input.path, ...input.imports.map((n) => n.path), ...input.importedBy.map((n) => n.path)],
    base: posix.dirname(input.path),
  };
}

/** The paths an explain-folder question names: its files and both ends of every crossing import. */
export function shownForFolder(input: FolderInput): { paths: string[]; base: string } {
  const crossing = [...input.incoming, ...input.outgoing].flatMap((e) => [e.from, e.to]);
  return { paths: [...input.files.map((f) => f.path), ...crossing], base: input.dir };
}

// What counts as a file name when it has no folder in front of it. A fixed
// list, so "e.g." or "v1.2" is never read as a file.
const EXTENSIONS = new Set(
  "ts tsx mts cts js jsx mjs cjs json md mdx css scss sass less html yml yaml toml sql graphql gql prisma vue svelte astro svg".split(" "),
);

// Framework names that happen to end in ".js" and read as prose, not files.
const NAMES = new Set(["next.js", "node.js", "nuxt.js", "vue.js", "express.js", "nest.js", "react.js", "three.js", "d3.js", "chart.js", "deno.js"]);

/**
 * What decides "path-shaped", in order:
 * - URLs, and scoped packages like `@supabase/supabase-js`, aren't paths.
 * - `./x` and `../x` are resolved against the explained file's folder and
 *   must then match exactly.
 * - A leading `/` with no extension is a URL route, not a file.
 * - With a `/`: a path when it starts with a top-level folder of a shown path
 *   (then it must match exactly), or its last part has a file extension.
 *   Otherwise it's a package like `next/server`, or prose like "and/or".
 * - Without a `/`: only inside backticks, and only with a file extension.
 * A path that doesn't start at the root (a bare `client.ts`, `ai/client.ts`,
 * an alias like `@/lib/x`) matches when it's the tail of a shown path.
 */
export function checkPaths(answer: string, shown: { paths: readonly string[]; base: string }): PathCheck {
  const files = new Set(shown.paths);
  const dirs = new Set<string>([shown.base]);
  for (const p of files) for (let d = posix.dirname(p); d !== "."; d = posix.dirname(d)) dirs.add(d);
  const tops = new Set([...files].map((p) => p.split("/")[0]));
  const modules = new Set([...files].map(moduleName));

  const mentioned = new Set<string>();
  const invented = new Set<string>();
  for (const { token, quoted } of tokens(answer)) {
    const verdict = judge(token, quoted);
    if (verdict === null) continue;
    mentioned.add(token);
    if (!verdict) invented.add(token);
  }
  return { shown: files.size, mentioned: [...mentioned], invented: [...invented] };

  // null: not path-shaped. true: shown. false: invented.
  function judge(raw: string, quoted: boolean): boolean | null {
    let t = raw.replace(/'s$/, "").replace(/(?::\d+(?:-\d+)?|#L\d+(?:-L?\d+)?)$/, "");
    if (!t || /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || t.startsWith("www.")) return null;
    if (NAMES.has(t.toLowerCase())) return null;

    // A relative path, once resolved, names one exact place: it's never
    // matched as a tail of something else.
    if (t.startsWith("./") || t.startsWith("../")) {
      const resolved = posix.normalize(posix.join(shown.base, t)).replace(/\/+$/, "");
      if (resolved === ".." || resolved.startsWith("../")) return false;
      return files.has(resolved) || dirs.has(resolved) || modules.has(resolved);
    }

    let rooted = true;
    if (t.startsWith("@/") || t.startsWith("~/")) {
      t = t.slice(2);
      rooted = false;
    } else if (t.startsWith("@")) {
      return null;
    } else if (t.startsWith("/")) {
      if (!hasExtension(t)) return null;
      t = t.replace(/^\/+/, "");
    }
    t = t.replace(/\/+$/, "");
    if (!t || t === ".") return null;

    if (t.includes("/")) {
      if (rooted && tops.has(t.split("/")[0])) return files.has(t) || dirs.has(t) || modules.has(t);
      if (!hasExtension(t) && rooted) return null;
      return isTail(t);
    }
    if (!quoted || !hasExtension(t)) return null;
    return isTail(t);
  }

  function isTail(t: string): boolean {
    const ends = (p: string) => p === t || p.endsWith(`/${t}`);
    for (const f of files) if (ends(f)) return true;
    if (!hasExtension(t)) for (const m of modules) if (ends(m)) return true;
    return false;
  }
}

function hasExtension(t: string): boolean {
  const last = t.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  return dot > 0 && EXTENSIONS.has(last.slice(dot + 1).toLowerCase());
}

// How an import specifier names a file: no extension, and a folder for its index.
function moduleName(path: string): string {
  return path.replace(/\.[^/.]+$/, "").replace(/\/index$/, "");
}

// Every backticked span whole, or word by word when it holds several, then the
// prose between spans word by word, with the punctuation around a word dropped.
function tokens(answer: string): { token: string; quoted: boolean }[] {
  const out: { token: string; quoted: boolean }[] = [];
  const prose: string[] = [];
  let last = 0;
  for (const m of answer.matchAll(/`([^`\n]+)`/g)) {
    prose.push(answer.slice(last, m.index));
    const inner = m[1].trim();
    if (!/\s/.test(inner)) {
      if (inner) out.push({ token: inner, quoted: true });
    } else {
      for (const word of inner.split(/\s+/)) {
        const core = trimmed(word);
        if (core) out.push({ token: core, quoted: true });
      }
    }
    last = m.index + m[0].length;
  }
  prose.push(answer.slice(last));
  for (const text of prose) {
    for (const word of text.replace(/\*\*/g, " ").split(/\s+/)) {
      const core = trimmed(word);
      if (core.includes("/")) out.push({ token: core, quoted: false });
    }
  }
  return out;
}

// A bracket is only punctuation when it's unmatched: `[id]` and `(workspace)`
// are parts of Next.js paths, the ")" closing "(see lib/x.ts)" isn't.
const PAIRS: Record<string, string> = { ")": "(", "]": "[", "}": "{", ">": "<" };

function trimmed(word: string): string {
  let w = word;
  for (;;) {
    const last = w.at(-1);
    if (last === undefined) return w;
    if (/["'.,;:!?*_]/.test(last)) w = w.slice(0, -1);
    else if (last in PAIRS && count(w, last) > count(w, PAIRS[last])) w = w.slice(0, -1);
    else break;
  }
  for (;;) {
    const first = w[0];
    if (first === undefined) return w;
    const closer = Object.keys(PAIRS).find((k) => PAIRS[k] === first);
    if (/["'*_]/.test(first)) w = w.slice(1);
    else if (closer && count(w, first) > count(w, closer)) w = w.slice(1);
    else break;
  }
  return w;
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}
