alter table public.ai_provider_configs
  add column if not exists enabled boolean not null default true,
  add column if not exists priority integer not null default 0
    check (priority between -1000 and 1000);

alter table public.ai_provider_configs
  alter column vault_secret_id drop not null,
  alter column key_last_four drop not null;

create table if not exists public.ai_provider_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('gemini', 'openai', 'anthropic')),
  auth_mode text not null check (auth_mode in ('api_key', 'account_gateway')),
  label text not null check (char_length(trim(label)) between 1 and 120),
  vault_secret_id uuid unique,
  credential_hint text not null default '' check (char_length(credential_hint) <= 160),
  gateway_auth_id text,
  gateway_auth_index text,
  gateway_auth_name text,
  status text not null default 'active'
    check (status in ('active', 'paused', 'needs_attention', 'connecting')),
  priority integer not null default 0 check (priority between -1000 and 1000),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  health_tier text not null default 'healthy'
    check (health_tier in ('healthy', 'draining', 'probing')),
  probe_success_streak integer not null default 0 check (probe_success_streak >= 0),
  cooldown_until timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  last_error_message text check (last_error_message is null or char_length(last_error_message) <= 2000),
  last_tested_at timestamptz,
  last_used_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (
      auth_mode = 'api_key'
      and gateway_auth_id is null
      and (vault_secret_id is not null or deleted_at is not null)
    )
    or
    (auth_mode = 'account_gateway' and vault_secret_id is null and gateway_auth_id is not null)
  )
);

drop index if exists public.ai_provider_connections_gateway_auth_idx;
create unique index ai_provider_connections_gateway_auth_idx
  on public.ai_provider_connections (gateway_auth_id);

create index if not exists ai_provider_connections_runtime_idx
  on public.ai_provider_connections (
    provider,
    status,
    deleted_at,
    health_tier,
    priority desc,
    last_used_at asc nulls first
  );

insert into public.ai_provider_connections (
  provider,
  auth_mode,
  label,
  vault_secret_id,
  credential_hint,
  status,
  priority,
  created_by,
  updated_by,
  created_at,
  updated_at
)
select
  config.provider,
  'api_key',
  case config.provider
    when 'gemini' then 'API Gemini'
    when 'openai' then 'API OpenAI'
    else 'API Anthropic'
  end,
  config.vault_secret_id,
  case
    when coalesce(config.key_last_four, '') = '' then ''
    else '•••• ' || config.key_last_four
  end,
  case when config.status = 'configured' then 'active' else 'needs_attention' end,
  0,
  config.created_by,
  config.updated_by,
  config.created_at,
  config.updated_at
from public.ai_provider_configs config
where config.vault_secret_id is not null
  and not exists (
    select 1
    from public.ai_provider_connections connection
    where connection.vault_secret_id = config.vault_secret_id
  );

create table if not exists public.ai_provider_connection_events (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references public.ai_provider_connections(id) on delete set null,
  provider text not null check (provider in ('gemini', 'openai', 'anthropic')),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in (
    'created',
    'updated',
    'tested',
    'paused',
    'resumed',
    'removed',
    'oauth_started',
    'oauth_completed',
    'oauth_failed',
    'runtime_succeeded',
    'runtime_failed'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_provider_connection_events_connection_created_idx
  on public.ai_provider_connection_events (connection_id, created_at desc);

create table if not exists public.ai_account_link_sessions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  provider text not null check (provider in ('gemini', 'openai', 'anthropic')),
  label text not null check (char_length(trim(label)) between 1 and 120),
  gateway_state text not null unique check (char_length(gateway_state) between 8 and 500),
  gateway_auth_ids_before jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'cancelled')),
  error_message text check (error_message is null or char_length(error_message) <= 2000),
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ai_account_link_sessions_actor_created_idx
  on public.ai_account_link_sessions (actor_id, created_at desc);

create unique index if not exists ai_account_link_sessions_one_pending_provider_idx
  on public.ai_account_link_sessions (provider)
  where status = 'pending';

alter table public.ai_messages
  add column if not exists connection_id uuid
    references public.ai_provider_connections(id) on delete set null,
  add column if not exists provider_attempts jsonb not null default '[]'::jsonb,
  add column if not exists gateway_request_id text;

alter table public.ai_conversations
  add column if not exists agent_type text not null default 'lesson_tutor'
    check (agent_type in ('lesson_tutor', 'platform_guide'));

create index if not exists ai_conversations_user_agent_activity_idx
  on public.ai_conversations (user_id, agent_type, last_message_at desc);

alter table public.lesson_ai_profiles
  add column if not exists connection_id uuid
    references public.ai_provider_connections(id) on delete set null;

create index if not exists ai_messages_connection_created_idx
  on public.ai_messages (connection_id, created_at desc)
  where connection_id is not null;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.lesson_transcripts'::regclass
      and conname = 'lesson_transcripts_id_lesson_unique'
  ) then
    alter table public.lesson_transcripts
      add constraint lesson_transcripts_id_lesson_unique unique (id, lesson_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.content_chunks'::regclass
      and conname = 'content_chunks_transcript_lesson_fk'
  ) then
    alter table public.content_chunks
      add constraint content_chunks_transcript_lesson_fk
      foreign key (transcript_id, lesson_id)
      references public.lesson_transcripts (id, lesson_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.lesson_ai_profiles'::regclass
      and conname = 'lesson_ai_profiles_transcript_lesson_fk'
  ) then
    alter table public.lesson_ai_profiles
      add constraint lesson_ai_profiles_transcript_lesson_fk
      foreign key (transcript_id, lesson_id)
      references public.lesson_transcripts (id, lesson_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ai_conversations'::regclass
      and conname = 'ai_conversations_id_user_unique'
  ) then
    alter table public.ai_conversations
      add constraint ai_conversations_id_user_unique unique (id, user_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ai_messages'::regclass
      and conname = 'ai_messages_conversation_user_fk'
  ) then
    alter table public.ai_messages
      add constraint ai_messages_conversation_user_fk
      foreign key (conversation_id, user_id)
      references public.ai_conversations (id, user_id)
      on delete cascade
      not valid;
  end if;
end;
$migration$;

alter table public.content_chunks
  validate constraint content_chunks_transcript_lesson_fk;
alter table public.lesson_ai_profiles
  validate constraint lesson_ai_profiles_transcript_lesson_fk;
alter table public.ai_messages
  validate constraint ai_messages_conversation_user_fk;

create or replace function public.save_lesson_transcript_atomic(
  p_created_by uuid,
  p_lesson_id text,
  p_checksum text,
  p_cues jsonb,
  p_full_text text,
  p_language text,
  p_source text,
  p_source_format text,
  p_source_video_id text,
  p_chunks jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  active_checksum text;
  active_chunks jsonb;
  active_cues jsonb;
  active_full_text text;
  active_transcript_id uuid;
  chunk_count integer;
  context_changed boolean := false;
  distinct_order_count integer;
  maximum_order integer;
  minimum_order integer;
  next_version integer;
  normalized_chunks jsonb;
  saved_transcript_id uuid;
begin
  if p_created_by is null then
    raise exception 'Responsavel pela transcricao invalido.';
  end if;

  if p_lesson_id is null or trim(p_lesson_id) = '' then
    raise exception 'Aula da transcricao invalida.';
  end if;

  if p_checksum is null or char_length(p_checksum) < 32 or char_length(p_checksum) > 128 then
    raise exception 'Checksum da transcricao invalido.';
  end if;

  if p_cues is null or jsonb_typeof(p_cues) <> 'array' or jsonb_array_length(p_cues) = 0 then
    raise exception 'Cues da transcricao invalidos.';
  end if;

  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array' then
    raise exception 'Trechos da transcricao invalidos.';
  end if;

  chunk_count := jsonb_array_length(p_chunks);

  if chunk_count < 1 or chunk_count > 10000 then
    raise exception 'Quantidade de trechos da transcricao invalida.';
  end if;

  select
    count(*)::integer,
    count(distinct chunk.order_index)::integer,
    min(chunk.order_index),
    max(chunk.order_index)
  into chunk_count, distinct_order_count, minimum_order, maximum_order
  from jsonb_to_recordset(p_chunks) as chunk(
    order_index integer,
    start_seconds numeric,
    end_seconds numeric,
    text text
  );

  if exists (
    select 1
    from jsonb_to_recordset(p_chunks) as chunk(
      order_index integer,
      start_seconds numeric,
      end_seconds numeric,
      text text
    )
    where chunk.order_index is null
      or chunk.order_index < 0
      or chunk.start_seconds is null
      or chunk.start_seconds < 0
      or chunk.end_seconds is null
      or chunk.end_seconds < chunk.start_seconds
      or chunk.text is null
      or char_length(trim(chunk.text)) < 1
      or char_length(chunk.text) > 20000
  ) then
    raise exception 'Um ou mais trechos da transcricao sao invalidos.';
  end if;

  if distinct_order_count <> chunk_count
    or minimum_order <> 0
    or maximum_order <> chunk_count - 1 then
    raise exception 'A ordem dos trechos da transcricao deve ser continua e iniciar em zero.';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'order_index', chunk.order_index,
      'start_seconds', chunk.start_seconds::numeric(12,3),
      'end_seconds', chunk.end_seconds::numeric(12,3),
      'text', trim(chunk.text)
    )
    order by chunk.order_index
  )
  into normalized_chunks
  from jsonb_to_recordset(p_chunks) as chunk(
    order_index integer,
    start_seconds numeric,
    end_seconds numeric,
    text text
  );

  perform 1
  from public.lessons lesson
  where lesson.id = p_lesson_id
  for update;

  if not found then
    raise exception 'Aula nao encontrada.';
  end if;

  select active.id, active.checksum, active.cues, active.full_text
  into active_transcript_id, active_checksum, active_cues, active_full_text
  from public.lesson_transcripts active
  where active.lesson_id = p_lesson_id
    and active.is_active
  order by active.version desc
  limit 1
  for update;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'order_index', chunk.order_index,
      'start_seconds', chunk.start_seconds,
      'end_seconds', chunk.end_seconds,
      'text', chunk.text
    )
    order by chunk.order_index
  ), '[]'::jsonb)
  into active_chunks
  from public.content_chunks chunk
  where chunk.transcript_id = active_transcript_id;

  if active_transcript_id is not null
    and active_checksum = p_checksum
    and active_cues is not distinct from p_cues
    and active_full_text is not distinct from p_full_text
    and active_chunks = normalized_chunks then
    saved_transcript_id := active_transcript_id;

    update public.lesson_transcripts
    set source = p_source,
        source_format = p_source_format,
        source_video_id = p_source_video_id,
        language = p_language,
        full_text = p_full_text,
        cues = p_cues,
        status = 'ready',
        error_message = null
    where id = saved_transcript_id;
  else
    select coalesce(max(transcript.version), 0) + 1
    into next_version
    from public.lesson_transcripts transcript
    where transcript.lesson_id = p_lesson_id;

    update public.lesson_transcripts
    set is_active = false
    where lesson_id = p_lesson_id
      and is_active;

    insert into public.lesson_transcripts (
      lesson_id,
      version,
      source,
      source_format,
      source_video_id,
      language,
      full_text,
      cues,
      checksum,
      status,
      error_message,
      is_active,
      created_by
    ) values (
      p_lesson_id,
      next_version,
      p_source,
      p_source_format,
      p_source_video_id,
      p_language,
      p_full_text,
      p_cues,
      p_checksum,
      'ready',
      null,
      true,
      p_created_by
    )
    returning id into saved_transcript_id;

    context_changed := true;
  end if;

  delete from public.content_chunks
  where transcript_id = saved_transcript_id;

  insert into public.content_chunks (
    transcript_id,
    lesson_id,
    order_index,
    start_seconds,
    end_seconds,
    text
  )
  select
    saved_transcript_id,
    p_lesson_id,
    chunk.order_index,
    chunk.start_seconds,
    chunk.end_seconds,
    trim(chunk.text)
  from jsonb_to_recordset(p_chunks) as chunk(
    order_index integer,
    start_seconds numeric,
    end_seconds numeric,
    text text
  )
  order by chunk.order_index;

  insert into public.lesson_ai_profiles (
    lesson_id,
    transcript_id,
    status,
    summary,
    chapters,
    topics,
    faq,
    provider,
    model,
    error_message,
    processed_at,
    connection_id
  ) values (
    p_lesson_id,
    saved_transcript_id,
    'waiting_provider',
    '',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    null,
    null,
    null,
    null,
    null
  )
  on conflict (lesson_id) do update set
    transcript_id = excluded.transcript_id,
    status = 'waiting_provider',
    summary = '',
    chapters = '[]'::jsonb,
    topics = '[]'::jsonb,
    faq = '[]'::jsonb,
    provider = null,
    model = null,
    error_message = null,
    processed_at = null,
    connection_id = null
  where public.lesson_ai_profiles.transcript_id is distinct from excluded.transcript_id
    or context_changed;

  return saved_transcript_id;
end;
$$;

revoke all on function public.save_lesson_transcript_atomic(
  uuid, text, text, jsonb, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.save_lesson_transcript_atomic(
  uuid, text, text, jsonb, text, text, text, text, text, jsonb
) to service_role;

create or replace function public.start_tutor_question_atomic(
  p_client_request_id uuid,
  p_connection_id uuid,
  p_conversation_id uuid,
  p_model text,
  p_provider text,
  p_question text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  assistant_message_id uuid;
  conversation_lesson_id text;
  duplicate_message_id uuid;
  pending_message_id uuid;
begin
  if p_client_request_id is null
    or p_conversation_id is null
    or p_user_id is null then
    raise exception 'Identificadores da pergunta invalidos.';
  end if;

  select conversation.lesson_id
  into conversation_lesson_id
  from public.ai_conversations conversation
  where conversation.id = p_conversation_id
    and conversation.user_id = p_user_id
    and conversation.agent_type = 'lesson_tutor'
    and conversation.student_deleted_at is null
  for update;

  if not found then
    raise exception 'Conversa nao encontrada.';
  end if;

  if conversation_lesson_id is null then
    raise exception 'Esta aula nao esta mais disponivel para novas perguntas.';
  end if;

  update public.ai_messages
  set body = 'Nao consegui concluir esta resposta. Tente novamente em alguns instantes.',
      status = 'failed',
      error_code = 'generation_timeout'
  where conversation_id = p_conversation_id
    and user_id = p_user_id
    and role = 'assistant'
    and status = 'pending'
    and created_at <= clock_timestamp() - interval '90 seconds';

  select message.id
  into duplicate_message_id
  from public.ai_messages message
  where message.conversation_id = p_conversation_id
    and message.user_id = p_user_id
    and message.role = 'user'
    and message.client_request_id = p_client_request_id
  limit 1;

  if duplicate_message_id is not null then
    return jsonb_build_object('state', 'duplicate');
  end if;

  select message.id
  into pending_message_id
  from public.ai_messages message
  where message.conversation_id = p_conversation_id
    and message.user_id = p_user_id
    and message.role = 'assistant'
    and message.status = 'pending'
  order by message.created_at asc, message.id asc
  limit 1
  for update;

  if pending_message_id is not null then
    return jsonb_build_object(
      'state', 'pending',
      'assistantMessageId', pending_message_id
    );
  end if;

  if p_connection_id is null then
    raise exception 'Conexao de IA invalida.';
  end if;

  if p_provider is null or p_provider not in ('gemini', 'openai', 'anthropic') then
    raise exception 'Provedor de IA invalido.';
  end if;

  if p_model is null
    or char_length(trim(p_model)) < 1
    or char_length(trim(p_model)) > 160 then
    raise exception 'Modelo de IA invalido.';
  end if;

  if p_question is null
    or char_length(trim(p_question)) < 1
    or char_length(trim(p_question)) > 20000 then
    raise exception 'Pergunta invalida.';
  end if;

  perform 1
  from public.ai_provider_connections connection
  where connection.id = p_connection_id
    and connection.provider = p_provider
    and connection.deleted_at is null
    and connection.status = 'active'
    and (
      connection.cooldown_until is null
      or connection.cooldown_until <= clock_timestamp()
    );

  if not found then
    raise exception 'Conexao de IA nao encontrada.';
  end if;

  insert into public.ai_messages (
    conversation_id,
    user_id,
    role,
    body,
    status,
    citations,
    client_request_id
  ) values (
    p_conversation_id,
    p_user_id,
    'user',
    trim(p_question),
    'completed',
    '[]'::jsonb,
    p_client_request_id
  );

  insert into public.ai_messages (
    conversation_id,
    user_id,
    role,
    body,
    status,
    citations,
    provider,
    model,
    connection_id
  ) values (
    p_conversation_id,
    p_user_id,
    'assistant',
    'Gerando resposta...',
    'pending',
    '[]'::jsonb,
    p_provider,
    trim(p_model),
    p_connection_id
  )
  returning id into assistant_message_id;

  return jsonb_build_object(
    'state', 'created',
    'assistantMessageId', assistant_message_id
  );
end;
$$;

revoke all on function public.start_tutor_question_atomic(
  uuid, uuid, uuid, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.start_tutor_question_atomic(
  uuid, uuid, uuid, text, text, text, uuid
) to service_role;

alter table public.ai_provider_connections enable row level security;
alter table public.ai_provider_connection_events enable row level security;
alter table public.ai_account_link_sessions enable row level security;

revoke all on public.ai_provider_connections from anon, authenticated;
revoke all on public.ai_provider_connection_events from anon, authenticated;
revoke all on public.ai_account_link_sessions from anon, authenticated;

drop trigger if exists set_ai_provider_connections_updated_at on public.ai_provider_connections;
create trigger set_ai_provider_connections_updated_at
  before update on public.ai_provider_connections
  for each row execute function public.set_updated_at();

create or replace function public.upsert_ai_provider_api_connection(
  p_connection_id uuid,
  p_provider text,
  p_label text,
  p_secret text,
  p_priority integer,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  connection_id uuid := coalesce(p_connection_id, gen_random_uuid());
  existing_provider text;
  existing_auth_mode text;
  existing_deleted_at timestamptz;
  secret_id uuid;
  normalized_label text := trim(p_label);
  normalized_secret text := trim(coalesce(p_secret, ''));
begin
  if p_provider is null or p_provider not in ('gemini', 'openai', 'anthropic') then
    raise exception 'Provedor de IA invalido.';
  end if;

  if normalized_label is null
    or char_length(normalized_label) < 1
    or char_length(normalized_label) > 120 then
    raise exception 'Nome da conexao invalido.';
  end if;

  if p_priority is null or p_priority < -1000 or p_priority > 1000 then
    raise exception 'Prioridade invalida.';
  end if;

  select provider, auth_mode, vault_secret_id, deleted_at
  into existing_provider, existing_auth_mode, secret_id, existing_deleted_at
  from public.ai_provider_connections
  where id = connection_id
  for update;

  if existing_provider is not null
    and (existing_provider <> p_provider or existing_auth_mode <> 'api_key') then
    raise exception 'A conexao nao pode mudar de provedor ou tipo.';
  end if;

  if existing_deleted_at is not null then
    raise exception 'Conexao de IA nao encontrada.';
  end if;

  if normalized_secret <> '' then
    if char_length(normalized_secret) < 8 or char_length(normalized_secret) > 10000 then
      raise exception 'Chave de IA invalida.';
    end if;

    if secret_id is null then
      secret_id := vault.create_secret(
        normalized_secret,
        'bunker707_ai_connection_' || connection_id::text,
        'Conexao BYOK ' || p_provider || ' do Tutor IA Bunker707'
      );
    else
      perform vault.update_secret(
        secret_id,
        normalized_secret,
        null,
        'Conexao BYOK ' || p_provider || ' do Tutor IA Bunker707'
      );
    end if;
  end if;

  if secret_id is null then
    raise exception 'Informe a chave de API para criar esta conexao.';
  end if;

  insert into public.ai_provider_connections (
    id,
    provider,
    auth_mode,
    label,
    vault_secret_id,
    credential_hint,
    status,
    priority,
    consecutive_failures,
    health_tier,
    probe_success_streak,
    cooldown_until,
    last_error_at,
    last_error_code,
    last_error_message,
    created_by,
    updated_by
  ) values (
    connection_id,
    p_provider,
    'api_key',
    normalized_label,
    secret_id,
    case
      when normalized_secret = '' then coalesce((
        select credential_hint
        from public.ai_provider_connections
        where id = connection_id
      ), '')
      else '•••• ' || right(normalized_secret, 4)
    end,
    'active',
    p_priority,
    0,
    'healthy',
    0,
    null,
    null,
    null,
    null,
    p_actor_id,
    p_actor_id
  )
  on conflict (id) do update set
    label = excluded.label,
    vault_secret_id = excluded.vault_secret_id,
    credential_hint = case
      when normalized_secret = '' then public.ai_provider_connections.credential_hint
      else excluded.credential_hint
    end,
    priority = excluded.priority,
    status = case
      when normalized_secret = '' then public.ai_provider_connections.status
      else 'active'
    end,
    consecutive_failures = case
      when normalized_secret = '' then public.ai_provider_connections.consecutive_failures
      else 0
    end,
    health_tier = case
      when normalized_secret = '' then public.ai_provider_connections.health_tier
      else 'healthy'
    end,
    probe_success_streak = case
      when normalized_secret = '' then public.ai_provider_connections.probe_success_streak
      else 0
    end,
    cooldown_until = case
      when normalized_secret = '' then public.ai_provider_connections.cooldown_until
      else null
    end,
    last_error_at = case
      when normalized_secret = '' then public.ai_provider_connections.last_error_at
      else null
    end,
    last_error_code = case
      when normalized_secret = '' then public.ai_provider_connections.last_error_code
      else null
    end,
    last_error_message = case
      when normalized_secret = '' then public.ai_provider_connections.last_error_message
      else null
    end,
    updated_by = p_actor_id;

  return connection_id;
end;
$$;

create or replace function public.read_ai_provider_connection_secret(p_connection_id uuid)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted.decrypted_secret
  from public.ai_provider_connections connection
  join vault.decrypted_secrets decrypted on decrypted.id = connection.vault_secret_id
  where connection.id = p_connection_id
    and connection.auth_mode = 'api_key'
    and connection.deleted_at is null
  limit 1;
$$;

drop function if exists public.delete_ai_provider_connection(uuid);

create or replace function public.delete_ai_provider_connection(
  p_connection_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  secret_id uuid;
  connection_found boolean := false;
begin
  select vault_secret_id, true
  into secret_id, connection_found
  from public.ai_provider_connections
  where id = p_connection_id
    and deleted_at is null
  for update;

  if connection_found is not true then
    raise exception 'Conexao de IA nao encontrada.';
  end if;

  update public.ai_provider_connections
  set status = 'paused',
      vault_secret_id = null,
      cooldown_until = null,
      deleted_at = now(),
      deleted_by = p_actor_id,
      updated_by = p_actor_id
  where id = p_connection_id;

  if secret_id is not null then
    update public.ai_provider_configs
    set vault_secret_id = null,
        key_last_four = null
    where vault_secret_id = secret_id;

    delete from vault.secrets where id = secret_id;
  end if;
end;
$$;

revoke all on function public.upsert_ai_provider_api_connection(uuid, text, text, text, integer, uuid)
  from public, anon, authenticated;
revoke all on function public.read_ai_provider_connection_secret(uuid)
  from public, anon, authenticated;
revoke all on function public.delete_ai_provider_connection(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.upsert_ai_provider_api_connection(uuid, text, text, text, integer, uuid)
  to service_role;
grant execute on function public.read_ai_provider_connection_secret(uuid)
  to service_role;
grant execute on function public.delete_ai_provider_connection(uuid, uuid)
  to service_role;

create or replace function public.claim_ai_provider_connection(
  p_connection_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  if coalesce(cardinality(p_connection_ids), 0) = 0 then
    return null;
  end if;

  select connection.id
  into claimed_id
  from public.ai_provider_connections connection
  where connection.id = any(p_connection_ids)
    and connection.deleted_at is null
    and connection.status = 'active'
    and (
      connection.cooldown_until is null
      or connection.cooldown_until <= clock_timestamp()
    )
  order by
    case connection.health_tier
      when 'healthy' then 0
      when 'probing' then 1
      else 2
    end,
    connection.priority desc,
    connection.last_used_at asc nulls first,
    connection.created_at asc,
    connection.id asc
  limit 1
  for update skip locked;

  if claimed_id is not null then
    update public.ai_provider_connections
    set last_used_at = clock_timestamp()
    where id = claimed_id;
  end if;

  return claimed_id;
end;
$$;

revoke all on function public.claim_ai_provider_connection(uuid[])
  from public, anon, authenticated;
grant execute on function public.claim_ai_provider_connection(uuid[])
  to service_role;

create or replace function public.record_ai_message_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation_agent_type text;
  conversation_lesson_id text;
begin
  select agent_type, lesson_id
  into conversation_agent_type, conversation_lesson_id
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
      case conversation_agent_type
        when 'platform_guide' then 'platform_guide_question_created'
        else 'lesson_tutor_question_created'
      end,
      'ai_conversation',
      new.conversation_id::text,
      jsonb_build_object(
        'lesson_id', conversation_lesson_id,
        'agent_type', conversation_agent_type,
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
      case conversation_agent_type
        when 'platform_guide' then 'platform_guide_answer_completed'
        else 'lesson_tutor_answer_completed'
      end,
      'ai_conversation',
      new.conversation_id::text,
      jsonb_build_object(
        'lesson_id', conversation_lesson_id,
        'agent_type', conversation_agent_type,
        'message_id', new.id,
        'provider', new.provider,
        'model', new.model,
        'connection_id', new.connection_id,
        'gateway_request_id', new.gateway_request_id,
        'input_tokens', new.input_tokens,
        'output_tokens', new.output_tokens,
        'body_length', char_length(new.body)
      )
    );
  end if;

  return new;
end;
$$;

revoke all on function public.record_ai_message_event()
  from public, anon, authenticated;

create or replace function public.get_ai_usage_summary(
  p_days integer default 30,
  p_agent_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  range_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  range_start timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  result jsonb;
begin
  if p_agent_type is not null and p_agent_type not in ('lesson_tutor', 'platform_guide') then
    raise exception 'Tipo de agente invalido.';
  end if;

  with assistant_messages as (
    select
      message.id,
      message.user_id,
      message.conversation_id,
      message.provider,
      message.model,
      message.connection_id,
      message.input_tokens,
      message.output_tokens,
      message.status,
      message.created_at,
      conversation.agent_type,
      conversation.lesson_id,
      conversation.lesson_title_snapshot,
      connection.label as connection_label,
      connection.auth_mode
    from public.ai_messages message
    join public.ai_conversations conversation on conversation.id = message.conversation_id
    left join public.ai_provider_connections connection on connection.id = message.connection_id
    where message.role = 'assistant'
      and message.created_at >= range_start
      and (p_agent_type is null or conversation.agent_type = p_agent_type)
  ),
  completed as (
    select * from assistant_messages where status = 'completed'
  ),
  totals as (
    select jsonb_build_object(
      'answers', count(*)::integer,
      'inputTokens', coalesce(sum(input_tokens), 0)::bigint,
      'outputTokens', coalesce(sum(output_tokens), 0)::bigint,
      'totalTokens', coalesce(sum(input_tokens + output_tokens), 0)::bigint,
      'activeStudents', count(distinct user_id)::integer,
      'conversations', count(distinct conversation_id)::integer,
      'lessons', (count(distinct lesson_id) filter (where agent_type = 'lesson_tutor'))::integer,
      'failures', (select count(*)::integer from assistant_messages where status = 'failed')
    ) as value
    from completed
  ),
  by_provider as (
    select coalesce(jsonb_agg(item order by total_tokens desc), '[]'::jsonb) as value
    from (
      select
        jsonb_build_object(
          'provider', coalesce(provider, 'unknown'),
          'model', coalesce(model, 'unknown'),
          'answers', count(*)::integer,
          'activeStudents', count(distinct user_id)::integer,
          'inputTokens', coalesce(sum(input_tokens), 0)::bigint,
          'outputTokens', coalesce(sum(output_tokens), 0)::bigint,
          'totalTokens', coalesce(sum(input_tokens + output_tokens), 0)::bigint
        ) as item,
        coalesce(sum(input_tokens + output_tokens), 0) as total_tokens
      from completed
      group by provider, model
    ) grouped
  ),
  by_agent as (
    select coalesce(jsonb_agg(item order by total_tokens desc), '[]'::jsonb) as value
    from (
      select
        jsonb_build_object(
          'agentType', agent_type,
          'answers', count(*)::integer,
          'activeStudents', count(distinct user_id)::integer,
          'conversations', count(distinct conversation_id)::integer,
          'lessons', count(distinct lesson_id)::integer,
          'inputTokens', coalesce(sum(input_tokens), 0)::bigint,
          'outputTokens', coalesce(sum(output_tokens), 0)::bigint,
          'totalTokens', coalesce(sum(input_tokens + output_tokens), 0)::bigint
        ) as item,
        coalesce(sum(input_tokens + output_tokens), 0) as total_tokens
      from completed
      group by agent_type
    ) grouped
  ),
  by_connection as (
    select coalesce(jsonb_agg(item order by total_tokens desc), '[]'::jsonb) as value
    from (
      select
        jsonb_build_object(
          'connectionId', connection_id,
          'label', coalesce(connection_label, 'Conexao removida'),
          'authMode', auth_mode,
          'provider', coalesce(provider, 'unknown'),
          'answers', count(*)::integer,
          'inputTokens', coalesce(sum(input_tokens), 0)::bigint,
          'outputTokens', coalesce(sum(output_tokens), 0)::bigint,
          'totalTokens', coalesce(sum(input_tokens + output_tokens), 0)::bigint
        ) as item,
        coalesce(sum(input_tokens + output_tokens), 0) as total_tokens
      from completed
      group by connection_id, connection_label, auth_mode, provider
    ) grouped
  ),
  by_lesson as (
    select coalesce(jsonb_agg(item order by total_tokens desc), '[]'::jsonb) as value
    from (
      select
        jsonb_build_object(
          'lessonId', lesson_id,
          'lessonTitle', coalesce(
            nullif(trim((array_agg(lesson_title_snapshot order by created_at desc, id desc))[1]), ''),
            'Aula removida'
          ),
          'answers', count(*)::integer,
          'activeStudents', count(distinct user_id)::integer,
          'conversations', count(distinct conversation_id)::integer,
          'inputTokens', coalesce(sum(input_tokens), 0)::bigint,
          'outputTokens', coalesce(sum(output_tokens), 0)::bigint,
          'totalTokens', coalesce(sum(input_tokens + output_tokens), 0)::bigint
        ) as item,
        coalesce(sum(input_tokens + output_tokens), 0) as total_tokens
      from completed
      where agent_type = 'lesson_tutor'
        and lesson_id is not null
      group by lesson_id
      order by total_tokens desc
      limit 100
    ) grouped
  ),
  by_day as (
    select coalesce(jsonb_agg(item order by day asc), '[]'::jsonb) as value
    from (
      select
        created_at::date as day,
        jsonb_build_object(
          'date', created_at::date,
          'answers', count(*)::integer,
          'activeStudents', count(distinct user_id)::integer,
          'inputTokens', coalesce(sum(input_tokens), 0)::bigint,
          'outputTokens', coalesce(sum(output_tokens), 0)::bigint,
          'totalTokens', coalesce(sum(input_tokens + output_tokens), 0)::bigint
        ) as item
      from completed
      group by created_at::date
    ) grouped
  ),
  by_student as (
    select coalesce(jsonb_agg(item order by total_tokens desc, answers desc, full_name asc), '[]'::jsonb) as value
    from (
      select
        jsonb_build_object(
          'userId', usage.user_id,
          'fullName', coalesce(
            nullif(trim(profile.full_name), ''),
            nullif(split_part(coalesce(profile.email, ''), '@', 1), ''),
            'Aluno ' || left(usage.user_id::text, 8)
          ),
          'email', nullif(trim(profile.email), ''),
          'avatarUrl', nullif(trim(profile.avatar_url), ''),
          'answers', usage.answers,
          'conversations', usage.conversations,
          'lessons', usage.lessons,
          'activeDays', usage.active_days,
          'lessonTutorAnswers', usage.lesson_tutor_answers,
          'platformGuideAnswers', usage.platform_guide_answers,
          'inputTokens', usage.input_tokens,
          'outputTokens', usage.output_tokens,
          'totalTokens', usage.total_tokens,
          'lastActivityAt', usage.last_activity_at
        ) as item,
        usage.answers,
        usage.total_tokens,
        coalesce(
          nullif(trim(profile.full_name), ''),
          nullif(split_part(coalesce(profile.email, ''), '@', 1), ''),
          'Aluno ' || left(usage.user_id::text, 8)
        ) as full_name
      from (
        select
          user_id,
          count(*)::integer as answers,
          count(distinct conversation_id)::integer as conversations,
          (count(distinct lesson_id) filter (where agent_type = 'lesson_tutor'))::integer as lessons,
          count(distinct created_at::date)::integer as active_days,
          (count(*) filter (where agent_type = 'lesson_tutor'))::integer as lesson_tutor_answers,
          (count(*) filter (where agent_type = 'platform_guide'))::integer as platform_guide_answers,
          coalesce(sum(input_tokens), 0)::bigint as input_tokens,
          coalesce(sum(output_tokens), 0)::bigint as output_tokens,
          coalesce(sum(input_tokens + output_tokens), 0)::bigint as total_tokens,
          max(created_at) as last_activity_at
        from completed
        group by user_id
      ) usage
      left join public.profiles profile on profile.id = usage.user_id
    ) grouped
  )
  select jsonb_build_object(
    'days', range_days,
    'from', range_start,
    'generatedAt', now(),
    'totals', totals.value,
    'byAgent', by_agent.value,
    'byProvider', by_provider.value,
    'byConnection', by_connection.value,
    'byLesson', by_lesson.value,
    'byDay', by_day.value,
    'byStudent', by_student.value
  )
  into result
  from totals, by_agent, by_provider, by_connection, by_lesson, by_day, by_student;

  return result;
end;
$$;

revoke all on function public.get_ai_usage_summary(integer, text)
  from public, anon, authenticated;
grant execute on function public.get_ai_usage_summary(integer, text)
  to service_role;
