-- Student-facing content is resolved by authenticated Next.js server routes.
-- Direct PostgREST access would expose video_config and locked/unpublished structure.
drop policy if exists "Students can read published content" on public.content_items;
drop policy if exists "Students can read modules" on public.course_modules;
drop policy if exists "Students can read lessons" on public.lessons;
drop policy if exists "Students can read cohorts" on public.cohorts;

revoke all on public.content_items from anon, authenticated;
revoke all on public.content_page_settings from anon, authenticated;
revoke all on public.course_modules from anon, authenticated;
revoke all on public.lessons from anon, authenticated;
revoke all on public.cohorts from anon, authenticated;
revoke all on public.students from anon, authenticated;
revoke all on public.student_courses from anon, authenticated;
revoke all on public.student_access_logs from anon, authenticated;
revoke all on public.platform_settings from anon, authenticated;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'content-assets',
  'content-assets',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create index if not exists students_email_lower_idx on public.students (lower(email));
create index if not exists student_courses_student_id_idx on public.student_courses (student_id);
create index if not exists course_modules_owner_sort_idx on public.course_modules (owner_id, sort_order);
create index if not exists lessons_module_sort_idx on public.lessons (module_id, sort_order);

