alter table public.lesson_progress
  add column if not exists lesson_reactions jsonb not null default '{}'::jsonb;
