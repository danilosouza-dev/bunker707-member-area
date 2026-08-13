-- These SECURITY DEFINER functions are invoked only by database triggers.
-- No API role needs permission to execute them directly.
revoke all on function public.record_lesson_comment_created_event()
  from public, anon, authenticated, service_role;
revoke all on function public.record_lesson_comment_reaction_event()
  from public, anon, authenticated, service_role;
revoke all on function public.record_lesson_comment_report_event()
  from public, anon, authenticated, service_role;
revoke all on function public.record_ai_message_event()
  from public, anon, authenticated, service_role;
revoke all on function public.record_ai_conversation_student_deleted_event()
  from public, anon, authenticated, service_role;
revoke all on function public.record_tv_session_event()
  from public, anon, authenticated, service_role;
