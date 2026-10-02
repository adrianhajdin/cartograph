import type { ClassifyInput, FileInput, FolderFile, FolderInput, NeighbourFacts } from "../lib/ai/prompts.ts";
import { EDGE_KINDS } from "../lib/parser/types.ts";

// Dataset examples and traced runs come back from LangSmith as plain JSON.
// They're read through here, so a question stored by an older shape fails
// with the field that's wrong instead of becoming a typed input by assertion.

export function fileInput(value: unknown, at = "input"): FileInput {
  const o = object(value, at);
  return {
    path: string(o.path, `${at}.path`),
    hash: string(o.hash, `${at}.hash`),
    role: nullable(o.role, `${at}.role`, string),
    reachedBy: nullable(o.reachedBy, `${at}.reachedBy`, string),
    exports: array(o.exports, `${at}.exports`, string),
    imports: array(o.imports, `${at}.imports`, neighbour),
    importedBy: array(o.importedBy, `${at}.importedBy`, neighbour),
  };
}

export function folderInput(value: unknown, at = "input"): FolderInput {
  const o = object(value, at);
  const crossing = (v: unknown, a: string) => {
    const e = object(v, a);
    return { from: string(e.from, `${a}.from`), to: string(e.to, `${a}.to`) };
  };
  return {
    dir: string(o.dir, `${at}.dir`),
    files: array(o.files, `${at}.files`, folderFile),
    incoming: array(o.incoming, `${at}.incoming`, crossing),
    outgoing: array(o.outgoing, `${at}.outgoing`, crossing),
  };
}

export function classifyInput(value: unknown, at = "input"): ClassifyInput {
  const o = object(value, at);
  const near = (v: unknown, a: string) => {
    const n = object(v, a);
    return { path: string(n.path, `${a}.path`), role: nullable(n.role, `${a}.role`, string) };
  };
  return {
    path: string(o.path, `${at}.path`),
    hash: string(o.hash, `${at}.hash`),
    exports: array(o.exports, `${at}.exports`, string),
    imports: array(o.imports, `${at}.imports`, near),
    importedBy: array(o.importedBy, `${at}.importedBy`, near),
  };
}

function neighbour(value: unknown, at: string): NeighbourFacts {
  const o = object(value, at);
  return {
    path: string(o.path, `${at}.path`),
    role: nullable(o.role, `${at}.role`, string),
    exports: array(o.exports, `${at}.exports`, string),
    kinds: array(o.kinds, `${at}.kinds`, (v, a) => oneOf(v, a, EDGE_KINDS)),
    typeOnly: boolean(o.typeOnly, `${at}.typeOnly`),
  };
}

function folderFile(value: unknown, at: string): FolderFile {
  const o = object(value, at);
  return {
    path: string(o.path, `${at}.path`),
    hash: string(o.hash, `${at}.hash`),
    role: nullable(o.role, `${at}.role`, string),
    exports: array(o.exports, `${at}.exports`, string),
    fanIn: number(o.fanIn, `${at}.fanIn`),
    fanOut: number(o.fanOut, `${at}.fanOut`),
  };
}

export function object(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${at} isn't an object`);
  return Object.fromEntries(Object.entries(value));
}

export function string(value: unknown, at: string): string {
  if (typeof value !== "string") throw new Error(`${at} isn't a string`);
  return value;
}

function number(value: unknown, at: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${at} isn't a number`);
  return value;
}

function boolean(value: unknown, at: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${at} isn't a boolean`);
  return value;
}

function nullable<T>(value: unknown, at: string, read: (value: unknown, at: string) => T): T | null {
  return value === null ? null : read(value, at);
}

function array<T>(value: unknown, at: string, item: (value: unknown, at: string) => T): T[] {
  if (!Array.isArray(value)) throw new Error(`${at} isn't an array`);
  return value.map((v, i) => item(v, `${at}[${i}]`));
}

function oneOf<T extends string>(value: unknown, at: string, allowed: readonly T[]): T {
  const found = allowed.find((a) => a === value);
  if (found === undefined) throw new Error(`${at} isn't one of ${allowed.join(", ")}`);
  return found;
}
