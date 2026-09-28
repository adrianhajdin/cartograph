-- Live progress. Each analysis has a private broadcast channel,
-- "analysis:<id>", and the database publishes to it when a run moves.

-- The channel pattern is declared here, before anything publishes to it: a
-- private channel with no select policy on realtime.messages accepts the
-- broadcast and delivers it to nobody, silently. This is also who may
-- subscribe. The subquery on analyses runs under that table's own policy, so
-- the topic of another organization's analysis matches no row and the join
-- is refused, exactly as its rows aren't selectable. Topics are compared as
-- text so a malformed topic is refused rather than failing a uuid cast.
create policy "members receive their organization's analysis progress" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1 from public.analyses a
      where 'analysis:' || a.id::text = (select realtime.topic())
    )
  );

-- No insert policy: browsers listen on these channels and never send. Only
-- the trigger below publishes.

-- The stage and its message, not the row. On failure the message is the
-- reason, so a subscriber shows what arrives without interpreting it.
-- Security definer because it runs inside the pipeline's writes, and
-- publishing is the database's act, not the writer's.
create function public.publish_analysis_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'status', new.status,
      'stage', new.stage,
      'message', case when new.status = 'failed' then new.error else new.stage_message end
    ),
    'progress',
    'analysis:' || new.id::text,
    true
  );
  return null;
end;
$$;

revoke execute on function public.publish_analysis_progress() from public, anon, authenticated;

-- On our own table, never on the realtime machinery.
create trigger publish_progress
  after update of status, stage, stage_message, error on public.analyses
  for each row
  when (
    old.status is distinct from new.status
    or old.stage is distinct from new.stage
    or old.stage_message is distinct from new.stage_message
  )
  execute function public.publish_analysis_progress();
