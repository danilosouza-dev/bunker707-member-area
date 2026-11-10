-- Webinarios v6, o fio das Perguntas (docs/30 §1.3 e §2.4; decisao do produtor de 10/11/2026): depois da resposta da
-- equipe, o aluno que perguntou comenta a resposta e a equipe responde de novo, na aba Perguntas, a vista de todos.
-- As migracoes de antes nao mudam; este arquivo so acrescenta.
--
-- Regras:
-- - webinar_question_replies: uma linha por resposta no fio de uma pergunta. A primeira resposta escrita da equipe
--   continua em webinar_questions.answer_text (as perguntas de antes nao mudam); o fio comeca depois dela;
-- - `role` e o papel de quem escreveu ('student' para o aluno; 'host', 'co_host' ou 'team' para a equipe, a mesma lista
--   do app em model.QUESTION_REPLY_ROLES); `anonymous` acompanha a pergunta Anonima (o aluno continua sem nome e sem
--   foto no fio dela);
-- - o texto tem ate 1000 caracteres (o app limita o do aluno em 500, como a pergunta);
-- - some com a pergunta e com a sessao (on delete cascade; a retencao prune_webinar_history apaga a pergunta depois de
--   chat_retention_days) e com a conta de quem escreveu (como a pergunta); "Remover minhas mensagens" marca
--   deleted_reason = 'consent_revoked', como nas outras tabelas do chat;
-- - tabela nova so do service_role (o aluno nunca le nem grava direto); nada de create policy, alter policy, drop,
--   delete nem truncate. Uma secao, pelo MCP do Supabase (execute_sql) ou apply_migration com o arquivo inteiro.
--
-- Verificacao manual depois de aplicar:
--   select table_name from information_schema.tables where table_schema = 'public'
--     and table_name = 'webinar_question_replies'; -- 1 linha
--   select has_table_privilege('authenticated', 'public.webinar_question_replies', 'select'); -- false
--   select relrowsecurity from pg_class where oid = 'public.webinar_question_replies'::regclass; -- true
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. webinar_question_replies: as respostas no fio de uma pergunta. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_question_replies (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.webinar_questions(id) on delete cascade,
  session_id uuid not null references public.webinar_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  role text not null check (role in ('host', 'co_host', 'team', 'student')),
  anonymous boolean not null default false,
  body text not null check (char_length(body) between 1 and 1000),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  deleted_reason text check (deleted_reason is null or deleted_reason in ('student', 'team', 'consent_revoked')),
  created_at timestamptz not null default now()
);

comment on table public.webinar_question_replies is 'O fio de uma pergunta da live (docs/30 §1.3): o aluno que perguntou comenta a resposta e a equipe responde de novo.';

create index if not exists webinar_question_replies_session_idx on public.webinar_question_replies (session_id, created_at);
create index if not exists webinar_question_replies_question_idx on public.webinar_question_replies (question_id);
create index if not exists webinar_question_replies_user_idx on public.webinar_question_replies (user_id);

alter table public.webinar_question_replies enable row level security;
revoke all on public.webinar_question_replies from anon, authenticated;
grant select, insert, update, delete on public.webinar_question_replies to service_role;
