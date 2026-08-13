create table if not exists public.lesson_comments (
  id uuid primary key default gen_random_uuid(),
  content_id text not null references public.content_items(id) on delete cascade,
  lesson_id text not null references public.lessons(id) on delete cascade,
  parent_comment_id uuid references public.lesson_comments(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null,
  author_username text not null,
  author_avatar_url text,
  author_role text not null default 'student' check (author_role in ('student', 'producer', 'moderator')),
  body text not null check (char_length(body) between 1 and 2000),
  status text not null default 'approved' check (status in ('pending', 'approved', 'hidden', 'spam')),
  moderation_note text,
  moderated_by uuid references auth.users(id) on delete set null,
  moderated_at timestamptz,
  analysis_status text not null default 'pending' check (analysis_status in ('pending', 'processing', 'completed', 'failed')),
  analysis_result jsonb not null default '{}'::jsonb,
  analyzed_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_comment_id is null or parent_comment_id <> id)
);

create table if not exists public.lesson_comment_reactions (
  comment_id uuid not null references public.lesson_comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (reaction in ('like', 'fire', 'insight', 'love', 'clap', 'laugh', 'wow', 'rocket', 'eyes', 'check')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create table if not exists public.lesson_comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.lesson_comments(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  unique (comment_id, reporter_id)
);

create table if not exists public.lesson_comment_blocked_words (
  id uuid primary key default gen_random_uuid(),
  word text not null,
  normalized_word text not null unique,
  message text not null default 'Alguma palavra usada esta contra as regras da comunidade.',
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(word)) between 1 and 120),
  check (char_length(trim(normalized_word)) between 1 and 120),
  check (char_length(trim(message)) between 1 and 500)
);

create table if not exists public.lesson_comment_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.lesson_comments(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('approved', 'hidden', 'restored', 'marked_spam')),
  previous_status text not null check (previous_status in ('pending', 'approved', 'hidden', 'spam')),
  next_status text not null check (next_status in ('pending', 'approved', 'hidden', 'spam')),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists lesson_comments_lesson_status_created_idx
  on public.lesson_comments (lesson_id, status, created_at desc)
  where deleted_at is null;

create index if not exists lesson_comments_content_created_idx
  on public.lesson_comments (content_id, created_at desc)
  where deleted_at is null;

create index if not exists lesson_comments_parent_idx
  on public.lesson_comments (parent_comment_id, created_at asc)
  where deleted_at is null;

create index if not exists lesson_comments_author_created_idx
  on public.lesson_comments (author_id, created_at desc)
  where deleted_at is null;

create index if not exists lesson_comment_reactions_comment_idx
  on public.lesson_comment_reactions (comment_id);

create index if not exists lesson_comment_reports_comment_idx
  on public.lesson_comment_reports (comment_id, created_at desc);

create index if not exists lesson_comment_actions_comment_idx
  on public.lesson_comment_moderation_actions (comment_id, created_at desc);

alter table public.lesson_comments enable row level security;
alter table public.lesson_comment_reactions enable row level security;
alter table public.lesson_comment_reports enable row level security;
alter table public.lesson_comment_blocked_words enable row level security;
alter table public.lesson_comment_moderation_actions enable row level security;

-- Comments are intentionally exposed only through authenticated Next.js APIs.
-- The service role bypasses RLS; anon/authenticated clients receive no table policy.
revoke all on public.lesson_comments from anon, authenticated;
revoke all on public.lesson_comment_reactions from anon, authenticated;
revoke all on public.lesson_comment_reports from anon, authenticated;
revoke all on public.lesson_comment_blocked_words from anon, authenticated;
revoke all on public.lesson_comment_moderation_actions from anon, authenticated;

drop trigger if exists set_lesson_comments_updated_at on public.lesson_comments;
create trigger set_lesson_comments_updated_at
  before update on public.lesson_comments
  for each row execute function public.set_updated_at();

drop trigger if exists set_lesson_comment_reactions_updated_at on public.lesson_comment_reactions;
create trigger set_lesson_comment_reactions_updated_at
  before update on public.lesson_comment_reactions
  for each row execute function public.set_updated_at();

drop trigger if exists set_lesson_comment_blocked_words_updated_at on public.lesson_comment_blocked_words;
create trigger set_lesson_comment_blocked_words_updated_at
  before update on public.lesson_comment_blocked_words
  for each row execute function public.set_updated_at();

create or replace function public.record_lesson_comment_created_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.author_id is not null then
    insert into public.student_events (
      user_id,
      event_type,
      entity_type,
      entity_id,
      metadata
    ) values (
      new.author_id,
      case when new.parent_comment_id is null then 'lesson_comment_created' else 'lesson_comment_reply_created' end,
      'lesson_comment',
      new.id::text,
      jsonb_build_object(
        'content_id', new.content_id,
        'lesson_id', new.lesson_id,
        'parent_comment_id', new.parent_comment_id,
        'kind', case when new.parent_comment_id is null then 'comment' else 'reply' end,
        'body_length', char_length(new.body),
        'status', new.status
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists record_lesson_comment_created_event on public.lesson_comments;
create trigger record_lesson_comment_created_event
  after insert on public.lesson_comments
  for each row execute function public.record_lesson_comment_created_event();

create or replace function public.record_lesson_comment_reaction_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.student_events (
      user_id,
      event_type,
      entity_type,
      entity_id,
      metadata
    ) values (
      old.user_id,
      'lesson_comment_reaction_removed',
      'lesson_comment',
      old.comment_id::text,
      jsonb_build_object('reaction', old.reaction)
    );

    return old;
  end if;

  insert into public.student_events (
    user_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    new.user_id,
    'lesson_comment_reacted',
    'lesson_comment',
    new.comment_id::text,
    jsonb_build_object('reaction', new.reaction)
  );

  return new;
end;
$$;

drop trigger if exists record_lesson_comment_reaction_event on public.lesson_comment_reactions;
create trigger record_lesson_comment_reaction_event
  after insert or update or delete on public.lesson_comment_reactions
  for each row execute function public.record_lesson_comment_reaction_event();

create or replace function public.record_lesson_comment_report_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.student_events (
    user_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    new.reporter_id,
    'lesson_comment_reported',
    'lesson_comment',
    new.comment_id::text,
    jsonb_build_object('reason_provided', new.reason is not null)
  );

  return new;
end;
$$;

drop trigger if exists record_lesson_comment_report_event on public.lesson_comment_reports;
create trigger record_lesson_comment_report_event
  after insert on public.lesson_comment_reports
  for each row execute function public.record_lesson_comment_report_event();

create or replace function public.moderate_lesson_comment(
  p_comment_id uuid,
  p_status text,
  p_actor_id uuid,
  p_note text default null
)
returns public.lesson_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_comment public.lesson_comments;
  updated_comment public.lesson_comments;
  action_name text;
begin
  if p_status not in ('approved', 'hidden', 'spam') then
    raise exception 'Status de moderacao invalido.';
  end if;

  if not exists (select 1 from public.admin_roles where user_id = p_actor_id) then
    raise exception 'Permissao administrativa obrigatoria.';
  end if;

  select * into previous_comment
  from public.lesson_comments
  where id = p_comment_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Comentario nao encontrado.';
  end if;

  action_name := case
    when p_status = 'approved' and previous_comment.status in ('hidden', 'spam') then 'restored'
    when p_status = 'approved' then 'approved'
    when p_status = 'hidden' then 'hidden'
    when p_status = 'spam' then 'marked_spam'
  end;

  update public.lesson_comments
  set
    status = p_status,
    moderation_note = nullif(trim(p_note), ''),
    moderated_by = p_actor_id,
    moderated_at = now()
  where id = p_comment_id
  returning * into updated_comment;

  insert into public.lesson_comment_moderation_actions (
    comment_id,
    actor_id,
    action,
    previous_status,
    next_status,
    note
  ) values (
    p_comment_id,
    p_actor_id,
    action_name,
    previous_comment.status,
    p_status,
    nullif(trim(p_note), '')
  );

  return updated_comment;
end;
$$;

revoke all on function public.moderate_lesson_comment(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.moderate_lesson_comment(uuid, text, uuid, text) to service_role;

insert into public.lesson_comment_blocked_words (id, word, normalized_word, message, active)
select
  case
    when (entry->>'id') ~* '^[0-9a-f-]{36}$' then (entry->>'id')::uuid
    else gen_random_uuid()
  end,
  trim(entry->>'word'),
  lower(trim(entry->>'word')),
  coalesce(nullif(trim(entry->>'message'), ''), 'Alguma palavra usada esta contra as regras da comunidade.'),
  coalesce((entry->>'active')::boolean, true)
from public.platform_settings settings
cross join lateral jsonb_array_elements(settings.value) entry
where settings.key = 'blockedWordRules'
  and jsonb_typeof(settings.value) = 'array'
  and nullif(trim(entry->>'word'), '') is not null
on conflict (normalized_word) do nothing;
