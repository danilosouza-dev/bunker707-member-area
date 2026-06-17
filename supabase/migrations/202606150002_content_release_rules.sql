alter table public.content_items
  add column if not exists release_rule jsonb;

alter table public.course_modules
  add column if not exists release_rule jsonb;

alter table public.lessons
  add column if not exists release_rule jsonb;
