-- Webinarios v10 (docs/30 D94, §4.2; docs/31 §15; docs/21 §9.17; teste do produtor de 12/11/2026, a tarde): a equipe
-- marca como visto o fio de uma pergunta em que o aluno escreveu por ultimo, e o aviso "Nova resposta do aluno" sai
-- sem ela precisar responder. As migracoes de antes nao mudam; este arquivo so acrescenta.
--
-- Regras:
-- - webinar_questions.thread_seen_at: quando a equipe marcou o fio como visto. O aviso volta sozinho quando o aluno
--   escreve de novo no fio (a resposta dele fica mais nova que esta hora). Nula: nunca marcado, como sempre;
-- - webinar_questions.thread_seen_by: quem marcou (a conta que sai da escola fica nula, a marca continua);
-- - nenhuma das duas entra na lista que o app sempre le (QUESTION_COLUMNS): o app de antes continua de pe com esta
--   migracao, e o app novo le as colunas a parte;
-- - nenhum drop, delete, truncate, create policy nem alter policy. Uma secao, pelo MCP do Supabase (execute_sql,
--   comecando com `set lock_timeout = '5s';`), ou apply_migration com o arquivo inteiro.
--
-- Verificacao manual depois de aplicar (uma linha so; docs/21 §9.17):
--   select count(*) as total from information_schema.columns where table_schema = 'public' and table_name = 'webinar_questions' and column_name in ('thread_seen_at', 'thread_seen_by'); -- 2
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. webinar_questions: o fio visto pela equipe. MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinar_questions add column if not exists thread_seen_at timestamptz;
alter table public.webinar_questions add column if not exists thread_seen_by uuid references auth.users(id) on delete set null;

comment on column public.webinar_questions.thread_seen_at is
  'Quando a equipe marcou o fio como visto (docs/30 D94): o aviso "Nova resposta do aluno" sai ate o aluno escrever de novo. Nula: nunca marcado.';
comment on column public.webinar_questions.thread_seen_by is
  'Quem marcou o fio como visto (docs/30 D94).';
