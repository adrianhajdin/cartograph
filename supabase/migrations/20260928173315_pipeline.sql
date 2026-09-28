-- The pipeline: analyses become real runs with named stages, and files and
-- edges carry everything the parser reports about them.

-- The seed rows were stand-ins with no files behind them, and two of their
-- repositories had more than one analysis. Real submissions replace them.
delete from public.organizations
where id in ('org_3JwtW0HcpRZgNX7GbutuxdXoVJS', 'org_3JwxWAXSGXdXZzBg3adiwuaibgC');

-- "parsing" was the name for any unfinished run. Which step it's on is the
-- stage's job now, so the status just says it's running.
alter type public.analysis_status rename value 'parsing' to 'running';

create type public.analysis_stage as enum ('fetch', 'select', 'parse', 'store');

alter table public.analyses
  -- Last stage entered. On a failed run, the stage it failed in.
  add column stage public.analysis_stage,
  add column stage_message text,
  -- Set when a run (or re-run) begins; staleness is measured from here.
  add column started_at timestamptz,
  -- The parser's coverage report, minus the skipped-file list (that's the
  -- files table), and the projects its adapters detected.
  add column coverage jsonb,
  add column projects jsonb,
  add constraint analyses_project_id_key unique (project_id),
  add constraint analyses_stage_check check ((status = 'queued') = (stage is null)),
  add constraint analyses_started_check check ((status = 'queued') = (started_at is null)),
  add constraint analyses_complete_check check (
    (status = 'complete') = (coverage is not null and projects is not null and commit_sha is not null)
  );

-- The unique constraint's index serves lookups by project; this one is redundant.
drop index public.analyses_project_id_organization_id_idx;

-- A parsed file has its measurements; a skipped one has a reason and detail
-- and nothing else, so it can never be mistaken for a file with no imports.
alter table public.files
  add column skip_detail text,
  add column module text,
  add column lines integer,
  add column bytes integer,
  add column hash text,
  add column fan_in integer,
  add column fan_out integer,
  add column reached_by text,
  add constraint files_parsed_or_skipped_check check (
    case when skip_reason is null
      then skip_detail is null and module is not null and lines is not null and bytes is not null
        and hash is not null and fan_in is not null and fan_out is not null
      else skip_detail is not null and module is null and lines is null and bytes is null
        and hash is null and fan_in is null and fan_out is null and reached_by is null
    end
  );

alter table public.edges
  add column type_only boolean not null,
  add column line integer not null,
  add constraint edges_unique_key unique (analysis_id, source_file_id, target_file_id, kind);

-- Edges arrive keyed by path; this resolves both ends against the files
-- already stored for the analysis. An edge whose end isn't a stored file is
-- a bug upstream, so it aborts the call rather than being dropped.
create function public.insert_edges(p_analysis_id uuid, p_edges jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  expected integer := jsonb_array_length(p_edges);
  inserted integer;
begin
  insert into public.edges
    (organization_id, analysis_id, source_file_id, target_file_id, kind, specifier, type_only, line)
  select s.organization_id, p_analysis_id, s.id, t.id, e.kind, e.specifier, e.type_only, e.line
  from jsonb_to_recordset(p_edges)
    as e (source text, target text, kind text, specifier text, type_only boolean, line integer)
  join public.files s on s.analysis_id = p_analysis_id and s.path = e.source and s.skip_reason is null
  join public.files t on t.analysis_id = p_analysis_id and t.path = e.target and t.skip_reason is null;
  get diagnostics inserted = row_count;
  if inserted <> expected then
    raise exception 'insert_edges: % of % edges matched stored files for analysis %', inserted, expected, p_analysis_id;
  end if;
  return inserted;
end;
$$;

-- Only the pipeline's writer calls this.
revoke execute on function public.insert_edges(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.insert_edges(uuid, jsonb) to service_role;
