create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'editor', 'support', 'analyst')),
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_provider text not null,
  source_event_id text,
  product_id text,
  target_type text not null check (
    target_type in ('platform', 'formation', 'standalone_course', 'mentorship', 'webinar', 'product', 'bootcamp')
  ),
  target_id text not null,
  status text not null check (status in ('active', 'suspended', 'revoked', 'expired')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.student_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  session_id text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (lower(email));
create index if not exists admin_roles_user_id_idx on public.admin_roles (user_id);
create index if not exists entitlements_user_status_idx on public.entitlements (user_id, status);
create index if not exists entitlements_target_idx on public.entitlements (target_type, target_id);
create index if not exists student_events_user_occurred_idx on public.student_events (user_id, occurred_at desc);

alter table public.profiles enable row level security;
alter table public.admin_roles enable row level security;
alter table public.entitlements enable row level security;
alter table public.student_events enable row level security;

drop policy if exists "Students can read own profile" on public.profiles;
create policy "Students can read own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "Students can insert own profile" on public.profiles;
create policy "Students can insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "Students can update own profile" on public.profiles;
create policy "Students can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Admins can read own role" on public.admin_roles;
create policy "Admins can read own role"
  on public.admin_roles for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Students can read own entitlements" on public.entitlements;
create policy "Students can read own entitlements"
  on public.entitlements for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Students can read own events" on public.student_events;
create policy "Students can read own events"
  on public.student_events for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Students can create own events" on public.student_events;
create policy "Students can create own events"
  on public.student_events for insert
  to authenticated
  with check (auth.uid() = user_id);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_admin_roles_updated_at on public.admin_roles;
create trigger set_admin_roles_updated_at
  before update on public.admin_roles
  for each row execute function public.set_updated_at();

drop trigger if exists set_entitlements_updated_at on public.entitlements;
create trigger set_entitlements_updated_at
  before update on public.entitlements
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update
    set
      email = excluded.email,
      full_name = coalesce(public.profiles.full_name, excluded.full_name),
      avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
      updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
