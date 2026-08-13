create extension if not exists "supabase_vault" with schema vault;

create table if not exists public.ai_provider_configs (
  provider text primary key check (provider in ('gemini', 'openai', 'anthropic')),
  vault_secret_id uuid not null unique,
  default_model text not null check (char_length(trim(default_model)) between 1 and 160),
  is_default boolean not null default false,
  status text not null default 'configured' check (status in ('configured', 'needs_attention')),
  key_last_four text not null check (char_length(key_last_four) between 2 and 8),
  daily_question_limit integer not null default 20 check (daily_question_limit between 1 and 10000),
  monthly_question_limit integer not null default 10000 check (monthly_question_limit between 1 and 10000000),
  max_output_tokens integer not null default 900 check (max_output_tokens between 64 and 8192),
  context_max_characters integer not null default 60000 check (context_max_characters between 5000 and 500000),
  temperature numeric(3,2) not null default 0.20 check (temperature between 0 and 1),
  last_tested_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ai_provider_configs_one_default_idx
  on public.ai_provider_configs (is_default)
  where is_default;

create table if not exists public.ai_provider_config_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('gemini', 'openai', 'anthropic')),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('saved', 'tested', 'removed', 'set_default')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_provider_config_events_provider_created_idx
  on public.ai_provider_config_events (provider, created_at desc);

create table if not exists public.lesson_transcripts (
  id uuid primary key default gen_random_uuid(),
  lesson_id text not null references public.lessons(id) on delete cascade,
  version integer not null check (version > 0),
  source text not null check (source in ('youtube', 'upload', 'paste')),
  source_format text not null check (source_format in ('json3', 'srt', 'vtt', 'txt')),
  source_video_id text,
  language text not null default 'pt-BR' check (char_length(language) between 2 and 35),
  full_text text not null check (char_length(full_text) between 1 and 2000000),
  cues jsonb not null default '[]'::jsonb,
  checksum text not null check (char_length(checksum) between 32 and 128),
  status text not null default 'processing' check (status in ('processing', 'ready', 'error')),
  error_message text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, version)
);

create unique index if not exists lesson_transcripts_one_active_idx
  on public.lesson_transcripts (lesson_id)
  where is_active;

create index if not exists lesson_transcripts_lesson_created_idx
  on public.lesson_transcripts (lesson_id, created_at desc);

create table if not exists public.content_chunks (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references public.lesson_transcripts(id) on delete cascade,
  lesson_id text not null references public.lessons(id) on delete cascade,
  order_index integer not null check (order_index >= 0),
  start_seconds numeric(12,3) not null default 0 check (start_seconds >= 0),
  end_seconds numeric(12,3) not null default 0 check (end_seconds >= start_seconds),
  text text not null check (char_length(text) between 1 and 20000),
  search_document tsvector generated always as (to_tsvector('simple', text)) stored,
  created_at timestamptz not null default now(),
  unique (transcript_id, order_index)
);

create index if not exists content_chunks_lesson_order_idx
  on public.content_chunks (lesson_id, order_index);

create index if not exists content_chunks_search_idx
  on public.content_chunks using gin (search_document);

create table if not exists public.lesson_ai_profiles (
  lesson_id text primary key references public.lessons(id) on delete cascade,
  transcript_id uuid not null references public.lesson_transcripts(id) on delete cascade,
  status text not null default 'processing' check (status in ('processing', 'ready', 'waiting_provider', 'error')),
  summary text not null default '',
  chapters jsonb not null default '[]'::jsonb,
  topics jsonb not null default '[]'::jsonb,
  faq jsonb not null default '[]'::jsonb,
  provider text check (provider is null or provider in ('gemini', 'openai', 'anthropic')),
  model text,
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id text references public.lessons(id) on delete set null,
  lesson_title_snapshot text not null check (char_length(trim(lesson_title_snapshot)) between 1 and 500),
  content_id_snapshot text not null check (char_length(trim(content_id_snapshot)) between 1 and 500),
  title text not null check (char_length(trim(title)) between 1 and 160),
  summary text not null default '',
  summarized_message_count integer not null default 0 check (summarized_message_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists ai_conversations_user_lesson_activity_idx
  on public.ai_conversations (user_id, lesson_id, last_message_at desc);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  body text not null check (char_length(body) between 1 and 20000),
  status text not null default 'completed' check (status in ('pending', 'completed', 'failed')),
  citations jsonb not null default '[]'::jsonb,
  provider text check (provider is null or provider in ('gemini', 'openai', 'anthropic')),
  model text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  error_code text,
  client_request_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists ai_messages_conversation_created_idx
  on public.ai_messages (conversation_id, created_at asc);

create index if not exists ai_messages_user_created_idx
  on public.ai_messages (user_id, created_at desc);

create unique index if not exists ai_messages_conversation_request_idx
  on public.ai_messages (conversation_id, client_request_id)
  where client_request_id is not null;

create unique index if not exists ai_messages_one_pending_assistant_idx
  on public.ai_messages (conversation_id)
  where role = 'assistant' and status = 'pending';

alter table public.ai_provider_configs enable row level security;
alter table public.ai_provider_config_events enable row level security;
alter table public.lesson_transcripts enable row level security;
alter table public.content_chunks enable row level security;
alter table public.lesson_ai_profiles enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

-- Tutor data is exposed only through authenticated Next.js APIs. The service
-- role bypasses RLS; browser clients receive no direct table privileges.
revoke all on public.ai_provider_configs from anon, authenticated;
revoke all on public.ai_provider_config_events from anon, authenticated;
revoke all on public.lesson_transcripts from anon, authenticated;
revoke all on public.content_chunks from anon, authenticated;
revoke all on public.lesson_ai_profiles from anon, authenticated;
revoke all on public.ai_conversations from anon, authenticated;
revoke all on public.ai_messages from anon, authenticated;

drop trigger if exists set_ai_provider_configs_updated_at on public.ai_provider_configs;
create trigger set_ai_provider_configs_updated_at
  before update on public.ai_provider_configs
  for each row execute function public.set_updated_at();

drop trigger if exists set_lesson_transcripts_updated_at on public.lesson_transcripts;
create trigger set_lesson_transcripts_updated_at
  before update on public.lesson_transcripts
  for each row execute function public.set_updated_at();

drop trigger if exists set_lesson_ai_profiles_updated_at on public.lesson_ai_profiles;
create trigger set_lesson_ai_profiles_updated_at
  before update on public.lesson_ai_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_ai_conversations_updated_at on public.ai_conversations;
create trigger set_ai_conversations_updated_at
  before update on public.ai_conversations
  for each row execute function public.set_updated_at();

create or replace function public.record_ai_message_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation_lesson_id text;
begin
  select lesson_id
  into conversation_lesson_id
  from public.ai_conversations
  where id = new.conversation_id;

  if tg_op = 'INSERT' and new.role = 'user' then
    insert into public.student_events (
      user_id,
      event_type,
      entity_type,
      entity_id,
      metadata
    ) values (
      new.user_id,
      'lesson_tutor_question_created',
      'ai_conversation',
      new.conversation_id::text,
      jsonb_build_object(
        'lesson_id', conversation_lesson_id,
        'message_id', new.id,
        'body_length', char_length(new.body)
      )
    );
  elsif tg_op = 'UPDATE'
    and new.role = 'assistant'
    and old.status is distinct from 'completed'
    and new.status = 'completed' then
    insert into public.student_events (
      user_id,
      event_type,
      entity_type,
      entity_id,
      metadata
    ) values (
      new.user_id,
      'lesson_tutor_answer_completed',
      'ai_conversation',
      new.conversation_id::text,
      jsonb_build_object(
        'lesson_id', conversation_lesson_id,
        'message_id', new.id,
        'provider', new.provider,
        'model', new.model,
        'input_tokens', new.input_tokens,
        'output_tokens', new.output_tokens,
        'body_length', char_length(new.body)
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists record_ai_message_event_insert on public.ai_messages;
create trigger record_ai_message_event_insert
  after insert on public.ai_messages
  for each row execute function public.record_ai_message_event();

drop trigger if exists record_ai_message_event_update on public.ai_messages;
create trigger record_ai_message_event_update
  after update on public.ai_messages
  for each row execute function public.record_ai_message_event();

create or replace function public.save_ai_provider_secret(
  p_provider text,
  p_secret text
)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  secret_id uuid;
begin
  if p_provider not in ('gemini', 'openai', 'anthropic') then
    raise exception 'Provedor de IA invalido.';
  end if;

  if char_length(trim(p_secret)) < 8 or char_length(p_secret) > 10000 then
    raise exception 'Chave de IA invalida.';
  end if;

  select vault_secret_id
  into secret_id
  from public.ai_provider_configs
  where provider = p_provider;

  if secret_id is null then
    secret_id := vault.create_secret(
      p_secret,
      'bunker707_ai_' || p_provider || '_' || gen_random_uuid()::text,
      'Chave BYOK do provedor ' || p_provider || ' para o Tutor IA Bunker707'
    );
  else
    perform vault.update_secret(
      secret_id,
      p_secret,
      null,
      'Chave BYOK do provedor ' || p_provider || ' para o Tutor IA Bunker707'
    );
  end if;

  return secret_id;
end;
$$;

create or replace function public.read_ai_provider_secret(p_provider text)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted.decrypted_secret
  from public.ai_provider_configs config
  join vault.decrypted_secrets decrypted on decrypted.id = config.vault_secret_id
  where config.provider = p_provider
  limit 1;
$$;

create or replace function public.delete_ai_provider_secret(p_provider text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  secret_id uuid;
begin
  select vault_secret_id
  into secret_id
  from public.ai_provider_configs
  where provider = p_provider;

  delete from public.ai_provider_configs where provider = p_provider;

  if secret_id is not null then
    delete from vault.secrets where id = secret_id;
  end if;
end;
$$;

revoke all on function public.save_ai_provider_secret(text, text)
  from public, anon, authenticated;
revoke all on function public.read_ai_provider_secret(text)
  from public, anon, authenticated;
revoke all on function public.delete_ai_provider_secret(text)
  from public, anon, authenticated;

grant execute on function public.save_ai_provider_secret(text, text) to service_role;
grant execute on function public.read_ai_provider_secret(text) to service_role;
grant execute on function public.delete_ai_provider_secret(text) to service_role;
