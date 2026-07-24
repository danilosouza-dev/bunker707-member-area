create table if not exists public.tv_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_id text not null references public.content_items(id) on delete cascade,
  lesson_id text not null references public.lessons(id) on delete cascade,
  pairing_code text not null unique check (pairing_code ~ '^[A-Z0-9]{6}$'),
  pairing_expires_at timestamptz not null,
  receiver_token_hash text check (
    receiver_token_hash is null or receiver_token_hash ~ '^[a-f0-9]{64}$'
  ),
  status text not null default 'pending' check (status in ('pending', 'connected', 'ended')),
  current_time_seconds numeric(12,3) not null default 0 check (current_time_seconds >= 0),
  duration_seconds numeric(12,3) not null default 0 check (duration_seconds >= 0),
  playback_state text not null default 'paused' check (
    playback_state in ('buffering', 'ended', 'paused', 'playing', 'unstarted')
  ),
  last_command jsonb,
  command_revision bigint not null default 0 check (command_revision >= 0),
  receiver_command_revision bigint not null default 0 check (receiver_command_revision >= 0),
  connected_at timestamptz,
  receiver_last_seen_at timestamptz,
  expires_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pairing_expires_at <= expires_at),
  check (receiver_command_revision <= command_revision)
);

create index if not exists tv_sessions_user_status_created_idx
  on public.tv_sessions (user_id, status, created_at desc);

create index if not exists tv_sessions_expires_idx
  on public.tv_sessions (expires_at)
  where status <> 'ended';

create index if not exists tv_sessions_receiver_token_idx
  on public.tv_sessions (receiver_token_hash)
  where receiver_token_hash is not null and status = 'connected';

alter table public.tv_sessions enable row level security;

-- TV sessions are available exclusively through the Next.js server APIs.
-- Both the pairing code and receiver token would be security-sensitive if the
-- table were queried directly by browser clients.
revoke all on public.tv_sessions from anon, authenticated;

drop trigger if exists set_tv_sessions_updated_at on public.tv_sessions;
create trigger set_tv_sessions_updated_at
  before update on public.tv_sessions
  for each row execute function public.set_updated_at();

create or replace function public.connect_tv_session(
  p_pairing_code text,
  p_receiver_token_hash text
)
returns setof public.tv_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_session_id uuid;
begin
  select id
  into selected_session_id
  from public.tv_sessions
  where pairing_code = upper(trim(p_pairing_code))
    and status = 'pending'
    and receiver_token_hash is null
    and pairing_expires_at > now()
    and expires_at > now()
  for update skip locked
  limit 1;

  if selected_session_id is null then
    return;
  end if;

  return query
  update public.tv_sessions
  set
    receiver_token_hash = p_receiver_token_hash,
    status = 'connected',
    connected_at = now(),
    receiver_last_seen_at = now()
  where id = selected_session_id
  returning *;
end;
$$;

revoke all on function public.connect_tv_session(text, text) from public, anon, authenticated;
grant execute on function public.connect_tv_session(text, text) to service_role;

create or replace function public.send_tv_session_command(
  p_session_id uuid,
  p_user_id uuid,
  p_command jsonb
)
returns setof public.tv_sessions
language sql
security definer
set search_path = public
as $$
  update public.tv_sessions
  set
    last_command = p_command,
    command_revision = command_revision + 1
  where id = p_session_id
    and user_id = p_user_id
    and status = 'connected'
    and expires_at > now()
  returning *;
$$;

revoke all on function public.send_tv_session_command(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.send_tv_session_command(uuid, uuid, jsonb) to service_role;

create or replace function public.record_tv_session_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.student_events (
      user_id,
      event_type,
      entity_type,
      entity_id,
      metadata
    ) values (
      new.user_id,
      'lesson_tv_session_created',
      'tv_session',
      new.id::text,
      jsonb_build_object('content_id', new.content_id, 'lesson_id', new.lesson_id)
    );
  elsif old.status = 'pending' and new.status = 'connected' then
    insert into public.student_events (
      user_id,
      event_type,
      entity_type,
      entity_id,
      metadata
    ) values (
      new.user_id,
      'lesson_tv_connected',
      'tv_session',
      new.id::text,
      jsonb_build_object('content_id', new.content_id, 'lesson_id', new.lesson_id)
    );
  elsif old.status is distinct from 'ended' and new.status = 'ended' then
    insert into public.student_events (
      user_id,
      event_type,
      entity_type,
      entity_id,
      metadata
    ) values (
      new.user_id,
      'lesson_tv_session_ended',
      'tv_session',
      new.id::text,
      jsonb_build_object(
        'content_id', new.content_id,
        'lesson_id', new.lesson_id,
        'current_time_seconds', new.current_time_seconds
      )
    );
  elsif new.command_revision > old.command_revision then
    insert into public.student_events (
      user_id,
      event_type,
      entity_type,
      entity_id,
      metadata
    ) values (
      new.user_id,
      'lesson_tv_command_sent',
      'tv_session',
      new.id::text,
      jsonb_build_object(
        'content_id', new.content_id,
        'lesson_id', new.lesson_id,
        'command_revision', new.command_revision,
        'command_type', new.last_command ->> 'type'
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists record_tv_session_event on public.tv_sessions;
create trigger record_tv_session_event
  after insert or update on public.tv_sessions
  for each row execute function public.record_tv_session_event();
