create or replace function public.cleanup_deleted_lesson_references()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.saved_items
  where target_type = 'lesson'
    and target_id = old.id;

  update public.lesson_progress
  set
    completed_lesson_ids = array_remove(completed_lesson_ids, old.id),
    lesson_reactions = coalesce(lesson_reactions, '{}'::jsonb) - old.id,
    lesson_watch_states = coalesce(lesson_watch_states, '{}'::jsonb) - old.id,
    updated_at = now()
  where old.id = any(completed_lesson_ids)
    or coalesce(lesson_reactions, '{}'::jsonb) ? old.id
    or coalesce(lesson_watch_states, '{}'::jsonb) ? old.id;

  update public.course_modules
  set
    meta = (
      select count(*)::text || case when count(*) = 1 then ' aula' else ' aulas' end
      from public.lessons
      where module_id = old.module_id
    ),
    updated_at = now()
  where id = old.module_id;

  return old;
end;
$$;

drop trigger if exists cleanup_deleted_lesson_references on public.lessons;
create trigger cleanup_deleted_lesson_references
  after delete on public.lessons
  for each row execute function public.cleanup_deleted_lesson_references();

create or replace function public.cleanup_deleted_module_references()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.saved_items
  where target_type = 'module'
    and target_id = old.id;

  return old;
end;
$$;

drop trigger if exists cleanup_deleted_module_references on public.course_modules;
create trigger cleanup_deleted_module_references
  after delete on public.course_modules
  for each row execute function public.cleanup_deleted_module_references();

revoke all on function public.cleanup_deleted_lesson_references()
  from public, anon, authenticated, service_role;
revoke all on function public.cleanup_deleted_module_references()
  from public, anon, authenticated, service_role;
