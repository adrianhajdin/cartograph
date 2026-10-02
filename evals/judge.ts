import { ai, MODELS } from "../lib/ai/client.ts";
import { explainFileMessage, type FileInput } from "../lib/ai/prompts.ts";
import { capped } from "../lib/ai/tasks.ts";

// A model grading a model, and there's no way around it: "is this specific
// enough to be useful" has no exact answer. So the verdict is a judgement,
// reported as one. Pass or fail rather than a 1–10 scale, because a model's
// "7 versus 8" isn't stable enough to compare two prompts by.
//
// The judge is the explaining model's own snapshot. It may favour its own
// style, but both prompt versions are written by that same model, so the
// bias falls on both sides of the comparison equally.
export const JUDGE_MODEL = MODELS.explain;
export const JUDGE_KEY = "specific_enough";

const SYSTEM = `You judge one explanation of a file, written for a developer reading an unfamiliar repository for the first time. You're given exactly what the writer was given, then the explanation.

Decide one thing: is it specific enough to be useful?

- Specific: a reader comes away knowing what this particular file does and what part it plays between the files named as its neighbours, stated concretely enough that they could now find their way around this part of the code. It says things they couldn't have guessed from the file's name alone.
- Generic: it would fit many files, restates the file name or the list of imports without saying what they're for, or fills space with vague claims. A claim the input doesn't support counts against it.

Ignore formatting and length. Answer only with the JSON the schema asks for.`;

export async function judgeSpecificity(question: FileInput, source: string, explanation: string): Promise<{ specific: boolean; reasoning: string }> {
  const response = await ai().chat.completions.create({
    model: JUDGE_MODEL,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `What the writer was given:\n\n${explainFileMessage(question, capped(source))}\n\nThe explanation:\n<<<\n${explanation}\n>>>`,
      },
    ],
    reasoning_effort: "low",
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "verdict",
        strict: true,
        schema: {
          type: "object",
          properties: { reasoning: { type: "string" }, verdict: { type: "string", enum: ["specific", "generic"] } },
          required: ["reasoning", "verdict"],
          additionalProperties: false,
        },
      },
    },
  });
  const content = response.choices[0]?.message.content;
  if (!content) throw new Error("The judge returned nothing");
  const parsed: unknown = JSON.parse(content);
  const verdict: unknown = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "verdict") : undefined;
  const reasoning: unknown = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "reasoning") : undefined;
  if ((verdict !== "specific" && verdict !== "generic") || typeof reasoning !== "string") throw new Error(`The judge's answer wasn't a verdict: ${content}`);
  return { specific: verdict === "specific", reasoning };
}
