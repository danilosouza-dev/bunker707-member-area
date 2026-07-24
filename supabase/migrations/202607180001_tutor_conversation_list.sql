-- List Tutor conversations in one database call. The previous runtime issued
-- one messages query per conversation only to compute count and preview.
create or replace function public.list_tutor_conversations(
  p_lesson_id text,
  p_user_id uuid
)
returns table (
  id uuid,
  title text,
  created_at timestamptz,
  last_message_at timestamptz,
  message_count bigint,
  preview_body text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_lesson_id is null or char_length(trim(p_lesson_id)) = 0 then
    raise exception 'Aula obrigatoria.';
  end if;

  if p_user_id is null then
    raise exception 'Usuario obrigatorio.';
  end if;

  return query
  select
    conversation.id,
    conversation.title,
    conversation.created_at,
    conversation.last_message_at,
    coalesce(message_totals.message_count, 0),
    latest_message.body
  from public.ai_conversations conversation
  left join lateral (
    select count(*) as message_count
    from public.ai_messages message
    where message.conversation_id = conversation.id
      and message.user_id = p_user_id
      and message.status = 'completed'
  ) message_totals on true
  left join lateral (
    select message.body
    from public.ai_messages message
    where message.conversation_id = conversation.id
      and message.user_id = p_user_id
      and message.status = 'completed'
    order by message.message_sequence desc
    limit 1
  ) latest_message on true
  where conversation.user_id = p_user_id
    and conversation.lesson_id = p_lesson_id
    and conversation.agent_type = 'lesson_tutor'
    and conversation.student_deleted_at is null
  order by conversation.last_message_at desc, conversation.id desc;
end;
$$;

revoke all on function public.list_tutor_conversations(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_tutor_conversations(text, uuid)
  to service_role;
