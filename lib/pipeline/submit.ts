import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types.ts";
import { parseRepositoryUrl } from "./github.ts";

type Db = SupabaseClient<Database>;

export type Submission = { analysisId: string; created: boolean };

// One analysis per repository per organization, enforced by unique
// constraints rather than a check-then-insert, so two tabs submitting the same
// URL at once still end with one row. Nothing here contacts GitHub: a
// repository that doesn't exist gets a row, and that row fails in fetch.
export async function submitRepository(db: Db, organizationId: string, url: string): Promise<Submission> {
  const { owner, name } = parseRepositoryUrl(url);

  const org = await db.from("organizations").upsert({ id: organizationId }, { onConflict: "id", ignoreDuplicates: true });
  if (org.error) throw new Error(`Recording the organization failed: ${org.error.message}`);

  const project = await db
    .from("projects")
    .upsert(
      { organization_id: organizationId, repo_owner: owner, repo_name: name },
      { onConflict: "organization_id,repo_owner,repo_name", ignoreDuplicates: true },
    );
  if (project.error) throw new Error(`Recording the repository failed: ${project.error.message}`);
  const found = await db
    .from("projects")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("repo_owner", owner)
    .eq("repo_name", name)
    .single();
  if (found.error) throw new Error(`Reading the repository back failed: ${found.error.message}`);

  const inserted = await db
    .from("analyses")
    .upsert({ organization_id: organizationId, project_id: found.data.id }, { onConflict: "project_id", ignoreDuplicates: true })
    .select("id");
  if (inserted.error) throw new Error(`Creating the analysis failed: ${inserted.error.message}`);
  const [created] = inserted.data;
  if (created) return { analysisId: created.id, created: true };

  const existing = await db.from("analyses").select("id").eq("project_id", found.data.id).single();
  if (existing.error) throw new Error(`Reading the existing analysis failed: ${existing.error.message}`);
  return { analysisId: existing.data.id, created: false };
}
