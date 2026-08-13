alter table public.ai_conversations
  add column if not exists student_deleted_at timestamptz;

create index if not exists ai_conversations_active_user_lesson_activity_idx
  on public.ai_conversations (user_id, lesson_id, last_message_at desc)
  where student_deleted_at is null;

comment on column public.ai_conversations.student_deleted_at is
  'When set, the conversation is permanently hidden from the student Tutor history but retained server-side under the platform retention and privacy policy.';

create or replace function public.record_ai_conversation_student_deleted_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.student_deleted_at is null and new.student_deleted_at is not null then
    insert into public.student_events (
      user_id,
      event_type,
      entity_type,
      entity_id,
      metadata
    ) values (
      new.user_id,
      'lesson_tutor_conversation_deleted_by_student',
      'ai_conversation',
      new.id::text,
      jsonb_build_object(
        'lesson_id', new.lesson_id,
        'deleted_at', new.student_deleted_at
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists record_ai_conversation_student_deleted_event on public.ai_conversations;
create trigger record_ai_conversation_student_deleted_event
  after update of student_deleted_at on public.ai_conversations
  for each row execute function public.record_ai_conversation_student_deleted_event();
