create extension if not exists "pgcrypto";

create table if not exists public.content_items (
  id text primary key,
  bucket text not null check (
    bucket in (
      'formations',
      'courses',
      'bootcamps',
      'formation_internal_courses',
      'continue_watching',
      'recent_lessons',
      'upcoming_products'
    )
  ),
  kind text not null,
  commerce_scope text,
  access_model text,
  title text not null,
  eyebrow text not null,
  description text,
  access_label text,
  image text not null,
  progress integer not null default 0,
  lessons_label text,
  max_students integer,
  purchase_label text,
  purchase_url text,
  purchase_target text,
  release_rule jsonb,
  status text not null,
  duration_label text,
  level_label text,
  is_locked boolean not null default false,
  instructor jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_page_settings (
  content_id text primary key references public.content_items(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.course_modules (
  id text primary key,
  title text not null,
  eyebrow text not null,
  description text not null,
  image text not null,
  meta text not null,
  owner_id text references public.content_items(id) on delete cascade,
  owner_kind text,
  progress integer not null default 0,
  release_rule jsonb,
  sort_order integer not null default 0,
  status text not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lessons (
  id text primary key,
  module_id text not null references public.course_modules(id) on delete cascade,
  title text not null,
  description text not null,
  duration text not null,
  image text,
  completed boolean not null default false,
  video_config jsonb,
  release_rule jsonb,
  sort_order integer not null default 0,
  status text not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cohorts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id text primary key,
  full_name text not null,
  email text not null,
  avatar_url text,
  phone text,
  document text,
  city text,
  state text,
  external_customer_id text,
  source_provider text not null,
  status text not null,
  joined_at text not null,
  first_access_at text,
  last_activity_at text not null,
  access_count integer not null default 0,
  notes text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.student_courses (
  id text primary key,
  student_id text not null references public.students(id) on delete cascade,
  target_id text not null,
  target_type text not null,
  product text not null,
  source_provider text not null,
  status text not null,
  starts_at text not null,
  ends_at text not null,
  external_order_id text not null,
  last_activity_at text not null,
  progress_percent integer not null default 0,
  cohort text,
  role text,
  category text,
  acquisition text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.student_access_logs (
  id text primary key,
  student_id text not null references public.students(id) on delete cascade,
  action text not null,
  device text not null,
  location text not null,
  occurred_at text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.lesson_progress (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  content_id text not null,
  completed_lesson_ids text[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (user_id, content_id)
);

create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.content_items enable row level security;
alter table public.content_page_settings enable row level security;
alter table public.course_modules enable row level security;
alter table public.lessons enable row level security;
alter table public.cohorts enable row level security;
alter table public.students enable row level security;
alter table public.student_courses enable row level security;
alter table public.student_access_logs enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.platform_settings enable row level security;

drop policy if exists "Students can read published content" on public.content_items;
create policy "Students can read published content"
  on public.content_items for select
  to authenticated
  using (true);

drop policy if exists "Students can read modules" on public.course_modules;
create policy "Students can read modules"
  on public.course_modules for select
  to authenticated
  using (true);

drop policy if exists "Students can read lessons" on public.lessons;
create policy "Students can read lessons"
  on public.lessons for select
  to authenticated
  using (true);

drop policy if exists "Students can read cohorts" on public.cohorts;
create policy "Students can read cohorts"
  on public.cohorts for select
  to authenticated
  using (true);

drop policy if exists "Students manage own lesson progress" on public.lesson_progress;
create policy "Students manage own lesson progress"
  on public.lesson_progress for all
  to authenticated
  using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_content_items_updated_at on public.content_items;
create trigger set_content_items_updated_at
  before update on public.content_items
  for each row execute function public.set_updated_at();

drop trigger if exists set_course_modules_updated_at on public.course_modules;
create trigger set_course_modules_updated_at
  before update on public.course_modules
  for each row execute function public.set_updated_at();

drop trigger if exists set_lessons_updated_at on public.lessons;
create trigger set_lessons_updated_at
  before update on public.lessons
  for each row execute function public.set_updated_at();

drop trigger if exists set_students_updated_at on public.students;
create trigger set_students_updated_at
  before update on public.students
  for each row execute function public.set_updated_at();

drop trigger if exists set_student_courses_updated_at on public.student_courses;
create trigger set_student_courses_updated_at
  before update on public.student_courses
  for each row execute function public.set_updated_at();
