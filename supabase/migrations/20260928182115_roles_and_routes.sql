-- Framework adapters: each file's role from convention, and the routes whose
-- method and full pattern the syntax states.

-- Which parser output an analysis was stored from. Rows from an older parser
-- have no roles or routes stored, and must say so rather than show an empty
-- route table and every file unclassified as if that had been checked.
alter table public.analyses add column schema_version integer;
update public.analyses set schema_version = 2 where status = 'complete';
alter table public.analyses
  add constraint analyses_schema_version_check check ((status = 'complete') = (schema_version is not null));

-- Nothing has written a route yet, so the new columns need no backfill.
alter table public.routes
  add column line integer not null,
  add constraint routes_unique_key unique (analysis_id, file_id, method, path);

-- Both arrive keyed by path, like edges, and resolve against the parsed files
-- already stored for the analysis. One that doesn't match aborts the call.
create function public.insert_routes(p_analysis_id uuid, p_routes jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  expected integer := jsonb_array_length(p_routes);
  inserted integer;
begin
  insert into public.routes (organization_id, analysis_id, file_id, method, path, line)
  select f.organization_id, p_analysis_id, f.id, r.method, r.pattern, r.line
  from jsonb_to_recordset(p_routes) as r (file text, method text, pattern text, line integer)
  join public.files f on f.analysis_id = p_analysis_id and f.path = r.file and f.skip_reason is null;
  get diagnostics inserted = row_count;
  if inserted <> expected then
    raise exception 'insert_routes: % of % routes matched stored files for analysis %', inserted, expected, p_analysis_id;
  end if;
  return inserted;
end;
$$;

create function public.insert_file_roles(p_analysis_id uuid, p_roles jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  expected integer := jsonb_array_length(p_roles);
  inserted integer;
begin
  insert into public.file_roles (organization_id, file_id, role, source)
  select f.organization_id, f.id, r.role, 'convention'
  from jsonb_to_recordset(p_roles) as r (path text, role text)
  join public.files f on f.analysis_id = p_analysis_id and f.path = r.path and f.skip_reason is null;
  get diagnostics inserted = row_count;
  if inserted <> expected then
    raise exception 'insert_file_roles: % of % roles matched stored files for analysis %', inserted, expected, p_analysis_id;
  end if;
  return inserted;
end;
$$;

-- Only the pipeline's writer calls these.
revoke execute on function public.insert_routes(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.insert_routes(uuid, jsonb) to service_role;
revoke execute on function public.insert_file_roles(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.insert_file_roles(uuid, jsonb) to service_role;
