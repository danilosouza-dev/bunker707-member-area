-- Webinarios v9 (docs/30 D87 a D89, §4.2; docs/31 §14; docs/21 §9.16; teste do produtor de 12/11/2026): o que abre o
-- link do banner, quem assina a resposta de uma pergunta e o comentario ou a pergunta que a equipe traz para a tela. As
-- migracoes de antes nao mudam; este arquivo so acrescenta.
--
-- Regras:
-- - webinar_screen_items.link_target (P3, D87): o que abre o link do banner, 'both' (a imagem e o botao; o padrao, tambem
--   dos itens que ja existem), 'button' (so o botao) ou 'image' (so a imagem). No QR Code nao vale nada (fica 'both').
--   A lista e a de screen-model.SCREEN_LINK_TARGETS. A coluna nao entra na lista que o app sempre le
--   (SCREEN_ITEM_COLUMNS): o app de antes continua de pe com esta migracao, e o app novo le a coluna a parte;
-- - webinar_questions.answer_author (P8, D88): quem assina a resposta escrita, `{ v: 1, as: 'self' | 'team' | 'custom',
--   name, role }` (o nome com que a pessoa escreve para a turma, ou o nome personalizado; nulo em 'team'). Nula na
--   resposta de antes e na do Assistente: a sala mostra "Equipe" (ou "Assistente"), como sempre;
-- - webinar_question_replies.author_as (P8, D88): como a resposta da equipe no fio aparece, 'self' (o nome e a foto de
--   quem escreveu), 'team' (so "Equipe") ou 'custom' (o nome personalizado, gravado em display_name). Nula na resposta de
--   antes e na do aluno: vale o nome gravado, como sempre. Nenhuma das duas colunas entra nas listas que o app sempre le
--   (QUESTION_COLUMNS, QUESTION_REPLY_COLUMNS);
-- - webinar_screen_comments (P11, D89): cada vez que a equipe mostrou na tela uma mensagem do chat ou uma pergunta
--   numa sessao. So a referencia (message_id ou question_id), nunca a copia do texto nem do nome: a sala le o comentario
--   da origem a cada leitura, entao a mensagem que o aluno removeu ou que a equipe apagou sai da tela na hora, e a
--   retencao que apaga a origem apaga a linha (on delete cascade). No maximo um comentario na tela por sessao (indice
--   unico parcial). So do service_role (o aluno nunca le nem grava direto);
-- - os checks novos das tabelas que ja existem entram `not valid` (secoes 1 e 2, sem ler as linhas) e sao validados na
--   secao 4. Nenhum drop, delete, truncate, create policy nem alter policy. Quatro secoes, cada uma pelo MCP do Supabase
--   (execute_sql, uma por chamada, na ordem; as secoes 1, 2 e 4 comecando com `set lock_timeout = '5s';`), ou
--   apply_migration com o arquivo inteiro.
--
-- Verificacao manual depois de aplicar (uma linha so; docs/21 §9.16):
--   select (select count(*) from information_schema.columns where table_schema = 'public' and (table_name, column_name) in (('webinar_screen_items', 'link_target'), ('webinar_questions', 'answer_author'), ('webinar_question_replies', 'author_as'))) + (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'webinar_screen_comments') + (select count(*) from pg_constraint where conname in ('webinar_screen_items_link_target_v9', 'webinar_questions_answer_author_v9', 'webinar_question_replies_author_as_v9') and convalidated) + (select count(*) from pg_indexes where schemaname = 'public' and indexname in ('webinar_screen_comments_active_idx', 'webinar_screen_comments_session_idx')) as total; -- 9
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. webinar_screen_items: o que abre o link do banner (P3). MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinar_screen_items add column if not exists link_target text not null default 'both';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webinar_screen_items_link_target_v9') then
    alter table public.webinar_screen_items add constraint webinar_screen_items_link_target_v9
      check (link_target in ('both', 'button', 'image')) not valid;
  end if;
end;
$$;

comment on column public.webinar_screen_items.link_target is
  'O que abre o link do banner (docs/30 D87): both (a imagem e o botao, o padrao), button (so o botao) ou image (so a imagem). No QR Code nao vale nada.';

/* ------------------------------------------------------------------------------------------------
 * 2. webinar_questions e webinar_question_replies: quem assina a resposta (P8). MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinar_questions add column if not exists answer_author jsonb;
alter table public.webinar_question_replies add column if not exists author_as text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webinar_questions_answer_author_v9') then
    alter table public.webinar_questions add constraint webinar_questions_answer_author_v9
      check (answer_author is null or (jsonb_typeof(answer_author) = 'object' and pg_column_size(answer_author) <= 512)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'webinar_question_replies_author_as_v9') then
    alter table public.webinar_question_replies add constraint webinar_question_replies_author_as_v9
      check (author_as is null or author_as in ('self', 'team', 'custom')) not valid;
  end if;
end;
$$;

comment on column public.webinar_questions.answer_author is
  'Quem assina a resposta escrita (docs/30 D88): { v: 1, as: self | team | custom, name, role }. Nula: "Equipe" (ou o Assistente), como antes.';
comment on column public.webinar_question_replies.author_as is
  'Como a resposta da equipe no fio aparece (docs/30 D88): self (o nome e a foto de quem escreveu), team (so "Equipe") ou custom (o nome personalizado em display_name). Nula: o nome gravado, como antes.';

/* ------------------------------------------------------------------------------------------------
 * 3. webinar_screen_comments: o comentario ou a pergunta que a equipe mostra na tela (P11). MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_screen_comments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.webinar_sessions(id) on delete cascade,
  source text not null check (source in ('chat', 'question')),
  message_id uuid references public.webinar_chat_messages(id) on delete cascade,
  question_id uuid references public.webinar_questions(id) on delete cascade,
  shown_at timestamptz not null default now(),
  shown_offset_ms integer,
  shown_by uuid references auth.users(id) on delete set null,
  hidden_at timestamptz,
  hidden_offset_ms integer,
  hidden_by uuid references auth.users(id) on delete set null,
  hidden_reason text check (hidden_reason is null or hidden_reason in ('team', 'replaced', 'removed')),
  created_at timestamptz not null default now(),
  constraint webinar_screen_comments_target_v9 check (
    (source = 'chat' and message_id is not null and question_id is null)
    or (source = 'question' and question_id is not null and message_id is null)
  ),
  constraint webinar_screen_comments_window_v9 check (
    (hidden_at is null and hidden_reason is null)
    or (hidden_at is not null and hidden_at >= shown_at and hidden_reason is not null)
  )
);

comment on table public.webinar_screen_comments is 'Na tela (docs/30 D89): cada vez que a equipe mostrou na tela uma mensagem do chat ou uma pergunta numa sessao. So a referencia: o texto e o nome sao lidos da origem.';

create unique index if not exists webinar_screen_comments_active_idx on public.webinar_screen_comments (session_id) where hidden_at is null;
create index if not exists webinar_screen_comments_session_idx on public.webinar_screen_comments (session_id, shown_at);

alter table public.webinar_screen_comments enable row level security;
revoke all on public.webinar_screen_comments from anon, authenticated;
grant select, insert, update, delete on public.webinar_screen_comments to service_role;

/* ------------------------------------------------------------------------------------------------
 * 4. Os checks novos das tabelas que ja existem, validados. MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinar_screen_items validate constraint webinar_screen_items_link_target_v9;
alter table public.webinar_questions validate constraint webinar_questions_answer_author_v9;
alter table public.webinar_question_replies validate constraint webinar_question_replies_author_as_v9;
