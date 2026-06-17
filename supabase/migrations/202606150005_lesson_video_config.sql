alter table public.lessons
  add column if not exists video_config jsonb;
