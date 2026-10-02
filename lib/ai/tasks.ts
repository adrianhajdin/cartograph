import { createHash } from "node:crypto";
import { isModelRole, MODEL_ROLES, type ModelRole } from "../roles.ts";
import type { RunTree } from "langsmith";
import { getCurrentRunTree, traceable } from "langsmith/traceable";
import { ai, MODELS, traceConfig, tracingStatus } from "./client.ts";
import { checkPaths, PATH_CHECK_KEY, shownForFile, shownForFolder, type PathCheck } from "./paths.ts";
import {
  CLASSIFY_SYSTEM,
  classifyMessage,
  EXPLAIN_FILE_SYSTEM,
  EXPLAIN_FOLDER_SYSTEM,
  explainFileMessage,
  explainFolderMessage,
  PROMPT_VERSION,
  type ClassifyInput,
  type FileInput,
  type FolderInput,
} from "./prompts.ts";

// The model calls, each behind its cache. The cache read is the first thing
// inside the traced function, so a hit is still a recorded run, one with no
// model call in it, and a broken cache is visible as a trace full of calls.

export type Task = "explain-file" | "explain-folder" | "classify-file";

export type Cache = {
  read: (key: string) => Promise<string | null>;
  write: (entry: { key: string; task: Task; model: string; body: string }) => Promise<void>;
};

export type Explanation = {
  body: string;
  model: string;
  cached: boolean;
  /** The invented-path check, run on every answer, cached ones included. */
  paths: PathCheck;
  /**
   * Stores the check as feedback on this answer's run, so real traffic is
   * scored in the dashboard. Separate so the caller can run it after the
   * response; a no-op when tracing is off.
   */
  recordPaths: () => Promise<void>;
};

type Answered = Omit<Explanation, "recordPaths">;

// The source is only fetched on a miss: a hit answers from the stored hash alone.
export type SourceOf = () => Promise<string>;

// The largest file the parser reads is well under this; it's a backstop
// against an unexpectedly huge prompt, and the model is told when it applies.
const MAX_SOURCE_CHARS = 120_000;
const EXCERPT_LINES = 60;

export function cacheKey(task: Task, model: string, input: unknown): string {
  return createHash("sha256").update(JSON.stringify({ task, version: PROMPT_VERSION, model, input })).digest("hex");
}

export async function explainFile(input: FileInput, deps: { cache: Cache; source: SourceOf }): Promise<Explanation> {
  const model = MODELS.explain;
  let tree: RunTree | undefined;
  const run = traceable(async (question: FileInput): Promise<Answered> => {
    tree = getCurrentRunTree(true);
    const key = cacheKey("explain-file", model, question);
    const hit = await deps.cache.read(key);
    const body = hit ?? (await complete(model, EXPLAIN_FILE_SYSTEM, explainFileMessage(question, capped(await deps.source()))));
    if (hit === null) await deps.cache.write({ key, task: "explain-file", model, body });
    return { body, model, cached: hit !== null, paths: checkPaths(body, shownForFile(question)) };
  }, traceConfig("explain-file"));
  const answer = await run(input);
  return { ...answer, recordPaths: () => recordPathCheck(tree, answer.paths) };
}

export async function explainFolder(input: FolderInput, deps: { cache: Cache }): Promise<Explanation> {
  const model = MODELS.explain;
  let tree: RunTree | undefined;
  const run = traceable(async (question: FolderInput): Promise<Answered> => {
    tree = getCurrentRunTree(true);
    const key = cacheKey("explain-folder", model, question);
    const hit = await deps.cache.read(key);
    const body = hit ?? (await complete(model, EXPLAIN_FOLDER_SYSTEM, explainFolderMessage(question)));
    if (hit === null) await deps.cache.write({ key, task: "explain-folder", model, body });
    return { body, model, cached: hit !== null, paths: checkPaths(body, shownForFolder(question)) };
  }, traceConfig("explain-folder"));
  const answer = await run(input);
  return { ...answer, recordPaths: () => recordPathCheck(tree, answer.paths) };
}

const projectIds = new Map<string, Promise<string>>();

// Feedback is attached to the run the answer was traced as, so it waits for
// that run to be sent first.
async function recordPathCheck(tree: RunTree | undefined, check: PathCheck): Promise<void> {
  if (!tree || !tracingStatus().on) return;
  const { client, project_name } = tree;
  let projectId = projectIds.get(project_name);
  if (!projectId) {
    // A failed lookup isn't kept, so the next answer's feedback tries again.
    projectId = client.readProject({ projectName: project_name }).then(
      (p) => p.id,
      (error: unknown) => {
        projectIds.delete(project_name);
        throw error;
      },
    );
    projectIds.set(project_name, projectId);
  }
  await client.awaitPendingTraceBatches();
  await client.createFeedback({
    runId: tree.id,
    sessionId: await projectId,
    ...(tree.trace_id !== tree.id ? { traceId: tree.trace_id } : {}),
    startTime: tree.start_time,
    key: PATH_CHECK_KEY,
    score: check.invented.length === 0 ? 1 : 0,
    value: check.invented.length,
    comment: check.invented.length ? `Not shown to the model: ${check.invented.join(", ")}` : `${check.mentioned.length} paths named, all shown`,
    feedbackSourceType: "app",
  });
}

// "none" is a real answer, and cached like any other: the model wasn't made
// to pick something when nothing fits, and the file stays unclassified.
const NONE = "none";

export async function classifyFile(input: ClassifyInput, deps: { cache: Cache; source: SourceOf }): Promise<{ role: ModelRole | null; cached: boolean }> {
  const model = MODELS.classify;
  const run = traceable(async (question: ClassifyInput): Promise<{ role: ModelRole | null; cached: boolean }> => {
    const key = cacheKey("classify-file", model, question);
    const hit = await deps.cache.read(key);
    if (hit !== null) return { role: parseRole(hit), cached: true };
    const excerpt = (await deps.source()).split("\n").slice(0, EXCERPT_LINES).join("\n");
    const response = await ai().chat.completions.create({
      model,
      messages: [
        { role: "system", content: CLASSIFY_SYSTEM },
        { role: "user", content: classifyMessage(question, excerpt) },
      ],
      reasoning_effort: "low",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "file_role",
          strict: true,
          schema: {
            type: "object",
            properties: { role: { type: "string", enum: [...MODEL_ROLES, NONE] } },
            required: ["role"],
            additionalProperties: false,
          },
        },
      },
    });
    const answer = readRole(response.choices[0]?.message.content ?? null);
    // Parsed before caching, so a refused answer is never stored and served.
    const role = parseRole(answer);
    await deps.cache.write({ key, task: "classify-file", model, body: answer });
    return { role, cached: false };
  }, traceConfig("classify-file"));
  return run(input);
}

function parseRole(answer: string): ModelRole | null {
  if (answer === NONE) return null;
  // Structural roles aren't in the schema, but the answer is checked rather
  // than trusted: convention alone decides what's routable.
  if (!isModelRole(answer)) throw new Error(`The model answered the role "${answer}", which it isn't allowed to give`);
  return answer;
}

function readRole(content: string | null): string {
  if (!content) throw new Error("The model returned no role");
  const parsed: unknown = JSON.parse(content);
  const role: unknown = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "role") : undefined;
  if (typeof role !== "string") throw new Error(`The model's answer had no role: ${content}`);
  return role;
}

// Exported so an eval can ask the same model in the same way under a retired
// prompt; the app only ever calls it with its own.
export async function complete(model: string, system: string, user: string): Promise<string> {
  const response = await ai().chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    reasoning_effort: "low",
    verbosity: "low",
  });
  const body = response.choices[0]?.message.content?.trim();
  if (!body) throw new Error(`${model} returned an empty answer (finish reason: ${response.choices[0]?.finish_reason ?? "none"})`);
  return body;
}

export function capped(source: string): string {
  if (source.length <= MAX_SOURCE_CHARS) return source;
  const kept = source.slice(0, MAX_SOURCE_CHARS);
  return `${kept}\n[… source truncated here: ${source.length - MAX_SOURCE_CHARS} more characters not shown]`;
}
