-- The legacy content_items.status column describes the student's pedagogical
-- state (Novo, Em andamento, etc.). Publication is an independent concern and
-- must never be inferred from that legacy value.
alter table public.content_items
  add column if not exists publication_status text not null default 'published'
    check (publication_status in ('draft', 'published', 'archived'));

-- The add-column default safely backfills the already visible catalog. New
-- content must receive an explicit publication decision from the CMS.
alter table public.content_items
  alter column publication_status set default 'draft';

create index if not exists content_items_publication_status_sort_idx
  on public.content_items (publication_status, sort_order, id);

-- Completion can unlock sequential lessons, so it is authorization input and
-- cannot remain directly writable through PostgREST. The authenticated API
-- persists progress with the service role only after validating the lesson.
drop policy if exists "Students manage own lesson progress" on public.lesson_progress;
revoke all on public.lesson_progress from anon, authenticated;

-- lesson_title_snapshot/content_id_snapshot remain mandatory for Tutor
-- conversations, but a platform-wide guide has no lesson or content owner.
alter table public.ai_conversations
  add column if not exists agent_type text not null default 'lesson_tutor',
  add column if not exists student_deleted_at timestamptz,
  alter column agent_type set default 'lesson_tutor',
  alter column agent_type set not null,
  alter column lesson_title_snapshot drop not null,
  alter column content_id_snapshot drop not null;

-- platform_guide was reserved by the previous migration but was not yet used
-- by the product. Normalize any pre-release row to its global, lessonless
-- scope before validating the invariant.
update public.ai_conversations
set lesson_id = null
where agent_type = 'platform_guide'
  and lesson_id is not null;

alter table public.ai_conversations
  drop constraint if exists ai_conversations_agent_type_check,
  drop constraint if exists ai_conversations_agent_scope_check;

alter table public.ai_conversations
  add constraint ai_conversations_agent_type_check
    check (agent_type in ('lesson_tutor', 'platform_guide')) not valid,
  add constraint ai_conversations_agent_scope_check
    check (
      (
        -- lesson_id intentionally remains nullable here because its foreign
        -- key uses ON DELETE SET NULL while the Tutor snapshots are retained.
        agent_type = 'lesson_tutor'
        and lesson_title_snapshot is not null
        and content_id_snapshot is not null
      )
      or
      (
        agent_type = 'platform_guide'
        and lesson_id is null
      )
    ) not valid;

alter table public.ai_conversations
  validate constraint ai_conversations_agent_type_check;
alter table public.ai_conversations
  validate constraint ai_conversations_agent_scope_check;

create index if not exists ai_conversations_active_user_agent_activity_idx
  on public.ai_conversations (user_id, agent_type, last_message_at desc)
  where student_deleted_at is null;

comment on column public.content_items.publication_status is
  'Publication lifecycle independent from the legacy pedagogical status shown to students.';
comment on column public.ai_conversations.agent_type is
  'Isolates lesson_tutor conversations from the platform-wide platform_guide.';
comment on column public.ai_conversations.lesson_title_snapshot is
  'Required for lesson_tutor; nullable for platform_guide.';
comment on column public.ai_conversations.content_id_snapshot is
  'Required for lesson_tutor; nullable for platform_guide.';

create or replace function public.start_platform_guide_question_atomic(
  p_client_request_id uuid,
  p_conversation_id uuid,
  p_daily_question_limit integer,
  p_question text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  assistant_message_id uuid;
  daily_question_count integer;
  duplicate_message_id uuid;
  pending_message_id uuid;
begin
  if p_client_request_id is null
    or p_conversation_id is null
    or p_user_id is null then
    raise exception 'Identificadores da pergunta invalidos.';
  end if;

  perform 1
  from public.ai_conversations conversation
  where conversation.id = p_conversation_id
    and conversation.user_id = p_user_id
    and conversation.agent_type = 'platform_guide'
    and conversation.lesson_id is null
    and conversation.student_deleted_at is null
  for update;

  if not found then
    raise exception 'Conversa nao encontrada.';
  end if;

  update public.ai_messages
  set
    body = 'Nao consegui concluir esta resposta. Tente novamente em alguns instantes.',
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

  if p_daily_question_limit is null
    or p_daily_question_limit < 1
    or p_daily_question_limit > 1000000 then
    raise exception 'Limite diario de IA invalido.';
  end if;

  if p_question is null
    or char_length(trim(p_question)) < 1
    or char_length(trim(p_question)) > 20000 then
    raise exception 'Pergunta invalida.';
  end if;

  -- Serializes starts across all conversations owned by this student. Counting
  -- and inserting under the same transaction prevents parallel chats from
  -- exceeding the rolling 24-hour allowance.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('platform-guide-user:' || p_user_id::text, 0)
  );

  select count(*)::integer
  into daily_question_count
  from public.ai_messages message
  where message.user_id = p_user_id
    and message.role = 'user'
    and message.created_at >= clock_timestamp() - interval '24 hours';

  if daily_question_count >= p_daily_question_limit then
    raise exception 'Limite diario de IA atingido.';
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
    citations
  ) values (
    p_conversation_id,
    p_user_id,
    'assistant',
    'Gerando resposta...',
    'pending',
    '[]'::jsonb
  )
  returning id into assistant_message_id;

  update public.ai_conversations
  set last_message_at = clock_timestamp()
  where id = p_conversation_id
    and user_id = p_user_id;

  return jsonb_build_object(
    'state', 'created',
    'assistantMessageId', assistant_message_id
  );
end;
$$;

revoke all on function public.start_platform_guide_question_atomic(
  uuid, uuid, integer, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.start_platform_guide_question_atomic(
  uuid, uuid, integer, text, uuid
) to service_role;

create or replace function public.reserve_platform_guide_provider_attempt(
  p_assistant_message_id uuid,
  p_connection_id uuid,
  p_model text,
  p_monthly_question_limit integer,
  p_provider text,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  monthly_reservations integer;
begin
  if p_assistant_message_id is null
    or p_connection_id is null
    or p_user_id is null then
    raise exception 'Identificadores da reserva invalidos.';
  end if;

  if p_provider is null or p_provider not in ('gemini', 'openai', 'anthropic') then
    raise exception 'Provedor de IA invalido.';
  end if;

  if p_model is null
    or char_length(trim(p_model)) < 1
    or char_length(trim(p_model)) > 160 then
    raise exception 'Modelo de IA invalido.';
  end if;

  if p_monthly_question_limit is null
    or p_monthly_question_limit < 1
    or p_monthly_question_limit > 100000000 then
    raise exception 'Limite mensal de IA invalido.';
  end if;

  perform 1
  from public.ai_messages message
  join public.ai_conversations conversation
    on conversation.id = message.conversation_id
  where message.id = p_assistant_message_id
    and message.user_id = p_user_id
    and message.role = 'assistant'
    and message.status = 'pending'
    and conversation.user_id = p_user_id
    and conversation.agent_type = 'platform_guide'
    and conversation.student_deleted_at is null
  for update of message;

  if not found then
    raise exception 'Resposta pendente da IA Diretor nao encontrada.';
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'platform-guide-provider:' || p_provider || ':' ||
      pg_catalog.to_char(clock_timestamp(), 'YYYY-MM'),
      0
    )
  );

  select count(*)::integer
  into monthly_reservations
  from public.ai_messages message
  where message.id <> p_assistant_message_id
    and message.role = 'assistant'
    and message.provider = p_provider
    and message.status in ('pending', 'completed')
    and message.created_at >= pg_catalog.date_trunc('month', clock_timestamp());

  if monthly_reservations >= p_monthly_question_limit then
    raise exception 'Limite mensal de IA atingido para o provedor.';
  end if;

  update public.ai_messages
  set
    connection_id = p_connection_id,
    model = trim(p_model),
    provider = p_provider
  where id = p_assistant_message_id
    and user_id = p_user_id
    and role = 'assistant'
    and status = 'pending';

  return true;
end;
$$;

revoke all on function public.reserve_platform_guide_provider_attempt(
  uuid, uuid, text, integer, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.reserve_platform_guide_provider_attempt(
  uuid, uuid, text, integer, text, uuid
) to service_role;

create or replace function public.create_platform_guide_conversation_atomic(
  p_user_id uuid,
  p_max_active integer default 100,
  p_max_created_per_day integer default 30
)
returns table (
  id uuid,
  title text,
  created_at timestamptz,
  last_message_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  active_count integer;
  created_today_count integer;
begin
  if p_user_id is null then
    raise exception 'Usuario obrigatorio.';
  end if;

  if p_max_active is null or p_max_active < 1 or p_max_active > 1000
    or p_max_created_per_day is null or p_max_created_per_day < 1 or p_max_created_per_day > 1000 then
    raise exception 'Limite de conversas invalido.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('platform-guide-conversations:' || p_user_id::text, 0)
  );

  select
    count(*) filter (where conversation.student_deleted_at is null)::integer,
    count(*) filter (
      where conversation.created_at >= clock_timestamp() - interval '24 hours'
    )::integer
  into active_count, created_today_count
  from public.ai_conversations conversation
  where conversation.user_id = p_user_id
    and conversation.agent_type = 'platform_guide';

  if active_count >= p_max_active then
    raise exception 'Limite de conversas ativas atingido.';
  end if;

  if created_today_count >= p_max_created_per_day then
    raise exception 'Limite diario de novas conversas atingido.';
  end if;

  return query
  insert into public.ai_conversations (
    agent_type,
    content_id_snapshot,
    lesson_id,
    lesson_title_snapshot,
    title,
    user_id
  ) values (
    'platform_guide',
    null,
    null,
    null,
    'Novo chat',
    p_user_id
  )
  returning
    ai_conversations.id,
    ai_conversations.title,
    ai_conversations.created_at,
    ai_conversations.last_message_at;
end;
$$;

revoke all on function public.create_platform_guide_conversation_atomic(uuid, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.create_platform_guide_conversation_atomic(uuid, integer, integer)
  to service_role;

create or replace function public.list_platform_guide_conversations(
  p_user_id uuid,
  p_limit integer default 100
)
returns table (
  id uuid,
  title text,
  created_at timestamptz,
  last_message_at timestamptz,
  message_count bigint,
  preview_message_id uuid,
  preview_body text,
  preview_role text,
  preview_status text,
  preview_citations jsonb,
  preview_created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_user_id is null then
    raise exception 'Usuario obrigatorio.';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Limite de conversas invalido.';
  end if;

  return query
  select
    conversation.id,
    conversation.title,
    conversation.created_at,
    conversation.last_message_at,
    coalesce(message_totals.message_count, 0),
    latest_message.id,
    latest_message.body,
    latest_message.role,
    latest_message.status,
    latest_message.citations,
    latest_message.created_at
  from public.ai_conversations conversation
  left join (
    select message.conversation_id, count(*) as message_count
    from public.ai_messages message
    where message.user_id = p_user_id
      and message.status = 'completed'
    group by message.conversation_id
  ) message_totals on message_totals.conversation_id = conversation.id
  left join lateral (
    select message.id, message.body, message.role, message.status, message.citations, message.created_at
    from public.ai_messages message
    where message.conversation_id = conversation.id
      and message.user_id = p_user_id
      and message.status = 'completed'
    order by message.created_at desc, message.id desc
    limit 1
  ) latest_message on true
  where conversation.user_id = p_user_id
    and conversation.agent_type = 'platform_guide'
    and conversation.student_deleted_at is null
  order by conversation.last_message_at desc, conversation.id desc
  limit p_limit;
end;
$$;

revoke all on function public.list_platform_guide_conversations(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_platform_guide_conversations(uuid, integer)
  to service_role;

-- The application must resolve entitlements and release rules first and pass
-- only authorized lesson IDs. This helper additionally enforces publication at
-- every structural level and searches only the active, ready transcript. It is
-- deliberately unavailable to browser roles.
create or replace function public.search_platform_guide_chunks(
  p_lesson_ids text[],
  p_query text,
  p_limit integer default 12
)
returns table (
  content_id text,
  module_id text,
  lesson_id text,
  transcript_id uuid,
  chunk_id uuid,
  order_index integer,
  start_seconds numeric,
  end_seconds numeric,
  chunk_text text,
  score real
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_query text;
  query_document tsquery;
  safe_limit integer;
begin
  if p_lesson_ids is null or coalesce(cardinality(p_lesson_ids), 0) = 0 then
    return;
  end if;

  if cardinality(p_lesson_ids) > 2000 then
    raise exception 'Quantidade de aulas da busca invalida.';
  end if;

  if exists (
    select 1
    from unnest(p_lesson_ids) as allowed_lesson(id)
    where allowed_lesson.id is null
      or char_length(trim(allowed_lesson.id)) < 1
      or char_length(allowed_lesson.id) > 500
  ) then
    raise exception 'Uma ou mais aulas da busca sao invalidas.';
  end if;

  normalized_query := trim(coalesce(p_query, ''));

  if char_length(normalized_query) < 2 or char_length(normalized_query) > 1000 then
    raise exception 'Texto da busca invalido.';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Limite da busca invalido.';
  end if;

  safe_limit := p_limit;
  query_document := websearch_to_tsquery('pg_catalog.simple'::regconfig, normalized_query);

  if numnode(query_document) = 0 then
    return;
  end if;

  return query
  select
    content.id,
    course_module.id,
    lesson.id,
    transcript.id,
    chunk.id,
    chunk.order_index,
    chunk.start_seconds,
    chunk.end_seconds,
    chunk.text,
    ts_rank_cd(chunk.search_document, query_document)
  from public.content_chunks chunk
  join public.lesson_transcripts transcript
    on transcript.id = chunk.transcript_id
    and transcript.lesson_id = chunk.lesson_id
    and transcript.is_active
    and transcript.status = 'ready'
  join public.lessons lesson
    on lesson.id = chunk.lesson_id
    and lesson.status = 'published'
  join public.course_modules course_module
    on course_module.id = lesson.module_id
    and course_module.status = 'published'
  join public.content_items content
    on content.id = course_module.owner_id
    and content.publication_status = 'published'
  where chunk.lesson_id = any(p_lesson_ids)
    and chunk.search_document @@ query_document
  order by
    ts_rank_cd(chunk.search_document, query_document) desc,
    content.sort_order asc,
    course_module.sort_order asc,
    lesson.sort_order asc,
    chunk.order_index asc,
    chunk.id asc
  limit safe_limit;
end;
$$;

comment on function public.search_platform_guide_chunks(text[], text, integer) is
  'Server-only lexical retrieval over active transcripts. p_lesson_ids must already be authorized for the authenticated student by the application access service.';

revoke all on function public.search_platform_guide_chunks(text[], text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_platform_guide_chunks(text[], text, integer)
  to service_role;

create or replace function public.record_ai_message_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  conversation_agent_type text;
  conversation_lesson_id text;
  selected_event_type text;
begin
  select conversation.agent_type, conversation.lesson_id
  into conversation_agent_type, conversation_lesson_id
  from public.ai_conversations conversation
  where conversation.id = new.conversation_id;

  if not found then
    raise exception 'Conversa da mensagem de IA nao encontrada.';
  end if;

  if tg_op = 'INSERT' and new.role = 'user' then
    selected_event_type := case conversation_agent_type
      when 'lesson_tutor' then 'lesson_tutor_question_created'
      when 'platform_guide' then 'platform_guide_question_created'
      else null
    end;

    if selected_event_type is null then
      raise exception 'Tipo de agente da conversa invalido.';
    end if;

    insert into public.student_events (
      user_id,
      event_type,
      entity_type,
      entity_id,
      metadata
    ) values (
      new.user_id,
      selected_event_type,
      'ai_conversation',
      new.conversation_id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'lesson_id', conversation_lesson_id,
        'agent_type', conversation_agent_type,
        'message_id', new.id,
        'body_length', char_length(new.body)
      ))
    );
  elsif tg_op = 'UPDATE'
    and new.role = 'assistant'
    and old.status is distinct from 'completed'
    and new.status = 'completed' then
    selected_event_type := case conversation_agent_type
      when 'lesson_tutor' then 'lesson_tutor_answer_completed'
      when 'platform_guide' then 'platform_guide_answer_completed'
      else null
    end;

    if selected_event_type is null then
      raise exception 'Tipo de agente da conversa invalido.';
    end if;

    insert into public.student_events (
      user_id,
      event_type,
      entity_type,
      entity_id,
      metadata
    ) values (
      new.user_id,
      selected_event_type,
      'ai_conversation',
      new.conversation_id::text,
      jsonb_strip_nulls(jsonb_build_object(
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
      ))
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

revoke all on function public.record_ai_message_event()
  from public, anon, authenticated, service_role;

create or replace function public.record_ai_conversation_student_deleted_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  selected_event_type text;
begin
  if old.student_deleted_at is null and new.student_deleted_at is not null then
    selected_event_type := case new.agent_type
      when 'lesson_tutor' then 'lesson_tutor_conversation_deleted_by_student'
      when 'platform_guide' then 'platform_guide_conversation_deleted_by_student'
      else null
    end;

    if selected_event_type is null then
      raise exception 'Tipo de agente da conversa invalido.';
    end if;

    insert into public.student_events (
      user_id,
      event_type,
      entity_type,
      entity_id,
      metadata
    ) values (
      new.user_id,
      selected_event_type,
      'ai_conversation',
      new.id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'lesson_id', new.lesson_id,
        'agent_type', new.agent_type,
        'deleted_at', new.student_deleted_at
      ))
    );
  end if;

  return new;
end;
$$;

drop trigger if exists record_ai_conversation_student_deleted_event on public.ai_conversations;
create trigger record_ai_conversation_student_deleted_event
  after update of student_deleted_at on public.ai_conversations
  for each row execute function public.record_ai_conversation_student_deleted_event();

revoke all on function public.record_ai_conversation_student_deleted_event()
  from public, anon, authenticated, service_role;
