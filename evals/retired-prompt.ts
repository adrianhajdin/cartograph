// Version 0 of the explain-file prompt, kept only so the current one has
// something to be measured against. It lives here, not in lib/ai: shipping a
// dead prompt so a test can reach it would be the test shaping the product.
//
// A reconstruction, not recovered text: no earlier wording was ever committed.
// It's the approach Phase 10 rejected, written out: formatting forbidden
// outright, no instruction to name neighbours by path, and no paragraph
// telling the model the connections it's given are the only ones there are.
// The user message is unchanged, so the prompt is the only difference.

export const RETIRED_VERSION = 0;

export const RETIRED_EXPLAIN_FILE_SYSTEM = `You explain one file of a TypeScript or JavaScript repository to a developer reading the repository for the first time.

You're given the file's source, and the files it imports and the files that import it. Say what this file does and how it fits into the repository. Two or three short paragraphs.

Write plain text only. Do not use markdown of any kind: no backticks, no bullet points, no bold, no headings.`;
