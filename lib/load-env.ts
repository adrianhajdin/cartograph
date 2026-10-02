import { existsSync } from "node:fs";
import { join } from "node:path";
import { assertEnv } from "./env.ts";

// Imported first by every script that runs outside the web app, so it sees
// the environment `next dev` sees: the same files, in Next's order of
// precedence (a variable already set wins, as it does there), then the same
// check the server makes at boot.

const root = join(import.meta.dirname, "..");
const mode = process.env.NODE_ENV ?? "development";
for (const file of [`.env.${mode}.local`, ".env.local", `.env.${mode}`, ".env"]) {
  const path = join(root, file);
  if (existsSync(path)) process.loadEnvFile(path);
}

assertEnv();
