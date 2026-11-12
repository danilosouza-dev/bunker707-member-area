-- Webinarios v11 (docs/30 D101, §4.2; docs/31 §16; docs/21 §9.18; terceiro teste do produtor de 12/11/2026): curtir a
-- resposta de uma pergunta e cada resposta do fio, pelos alunos e pela equipe. As migracoes de antes nao mudam; este
-- arquivo so acrescenta.
--
-- Regras:
-- - webinar_question_likes: uma linha por curtida. `reply_id` nulo: a curtida e da resposta escrita da pergunta
--   (webinar_questions.answer_text); com `reply_id`: da resposta do fio. Uma curtida por pessoa em cada alvo (dois
--   indices unicos parciais). A curtida da propria pergunta continua em webinar_question_votes, como sempre;
-- - a linha some com a sessao, com a pergunta, com a resposta do fio e com a conta (on delete cascade): a retencao e o
--   "Remover minhas mensagens" levam as curtidas junto;
-- - `session_id` vai na linha para o relatorio da sessao e para a sala ler as curtidas de uma sessao numa consulta so;
-- - so do service_role (o aluno nunca le nem grava direto: passa pela rota da sala);
-- - nenhum drop, delete, truncate, create policy nem alter policy. Uma secao, pelo MCP do Supabase (execute_sql), ou
--   apply_migration com o arquivo inteiro.
--
-- Verificacao manual depois de aplicar (uma linha so; docs/21 §9.18):
--   select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'webinar_question_likes') + (select count(*) from pg_indexes where schemaname = 'public' and indexname in ('webinar_question_likes_answer_idx', 'webinar_question_likes_reply_idx', 'webinar_question_likes_session_idx')) as total; -- 4
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. webinar_question_likes: as curtidas da resposta e do fio de uma pergunta. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_question_likes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.webinar_sessions(id) on delete cascade,
  question_id uuid not null references public.webinar_questions(id) on delete cascade,
  reply_id uuid references public.webinar_question_replies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.webinar_question_likes is 'As curtidas da resposta escrita de uma pergunta (reply_id nulo) e de cada resposta do fio (docs/30 D101). Uma por pessoa em cada alvo. A curtida da propria pergunta fica em webinar_question_votes.';

create unique index if not exists webinar_question_likes_answer_idx on public.webinar_question_likes (question_id, user_id) where reply_id is null;
create unique index if not exists webinar_question_likes_reply_idx on public.webinar_question_likes (reply_id, user_id) where reply_id is not null;
create index if not exists webinar_question_likes_session_idx on public.webinar_question_likes (session_id);

alter table public.webinar_question_likes enable row level security;
revoke all on public.webinar_question_likes from anon, authenticated;
grant select, insert, update, delete on public.webinar_question_likes to service_role;
