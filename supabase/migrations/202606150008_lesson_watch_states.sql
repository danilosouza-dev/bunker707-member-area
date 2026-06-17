alter table public.lesson_progress
  add column if not exists lesson_watch_states jsonb not null default '{}'::jsonb;
