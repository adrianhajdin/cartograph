-- "projects" was also the name of the table analyses belong to, so a select
-- of projects(...) and the column read the same. The column is what the
-- parser's adapters detected.
alter table public.analyses rename column projects to detected_projects;
