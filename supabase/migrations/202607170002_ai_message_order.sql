-- Keep the persisted order of AI messages independent from transaction
-- timestamps. PostgreSQL now() is stable for the whole transaction, so the
-- user question and the pending assistant answer can legitimately share the
-- same created_at value.
alter table public.ai_messages
  add column if not exists message_sequence bigint;

with ranked_messages as (
  select
    message.id,
    row_number() over (
      partition by message.conversation_id
      order by message.created_at asc,
        case message.role
          when 'system' then 0
          when 'user' then 1
          when 'assistant' then 2
          else 3
        end asc,
        message.id asc
    )::bigint as message_sequence
  from public.ai_messages message
)
update public.ai_messages message
set message_sequence = ranked.message_sequence
from ranked_messages ranked
where ranked.id = message.id
  and message.message_sequence is null;

alter table public.ai_messages
  alter column message_sequence set not null;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.ai_messages'::regclass
      and constraint_row.conname = 'ai_messages_message_sequence_positive'
  ) then
    alter table public.ai_messages
      add constraint ai_messages_message_sequence_positive
      check (message_sequence > 0);
  end if;
end;
$$;

create unique index if not exists ai_messages_conversation_sequence_idx
  on public.ai_messages (conversation_id, message_sequence);

comment on column public.ai_messages.message_sequence is
  'Stable, strictly increasing message order within one AI conversation.';

create or replace function public.assign_ai_message_sequence()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- The conversation-scoped lock protects every insertion path, including
  -- future agents that do not use the current Tutor or Director RPCs.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ai-message-sequence:' || new.conversation_id::text,
      0
    )
  );

  select coalesce(max(message.message_sequence), 0) + 1
  into new.message_sequence
  from public.ai_messages message
  where message.conversation_id = new.conversation_id;

  return new;
end;
$$;

revoke all on function public.assign_ai_message_sequence()
  from public, anon, authenticated, service_role;

drop trigger if exists assign_ai_message_sequence_before_insert
  on public.ai_messages;
create trigger assign_ai_message_sequence_before_insert
  before insert on public.ai_messages
  for each row execute function public.assign_ai_message_sequence();

-- The Director list is aggregated in SQL; its preview must use the same
-- canonical order as the conversation screen and model history.
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
    order by message.message_sequence desc
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
