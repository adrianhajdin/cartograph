import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env.ts";
import type { Database } from "./database.types.ts";

// The pipeline's writer, and nothing else. A run outlives the request and the
// 60-second session token that started it, so it writes with the secret key,
// which bypasses row policies. That makes every write here responsible for
// its own organization_id; reads anywhere a person is looking still go
// through createServerSupabase and the policies. Plain module, no Next
// imports, so a script can drive the pipeline. The key has no NEXT_PUBLIC_
// prefix, so it can't be bundled into the browser.
export function createAdminSupabase(): SupabaseClient<Database> {
  return createClient<Database>(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
