-- Webinarios, redesign V2 fase 2: o Co-apresentador no chat (docs/31 V2-9 e V2-A12). A mensagem que o co-apresentador
-- escreve no console passa a gravar role = 'co_host' (antes ia como 'team') e aparece como "Co-apresentador" na sala, na
-- gaveta do vertical e no console. As migracoes de antes nao mudam (a 202610290001 continua com o check antigo, sem
-- nome); este arquivo so troca o check.
--
-- Regras:
-- - o check sem nome de webinar_chat_messages.role (202610290001; o Postgres o chama webinar_chat_messages_role_check,
--   conferido na nuvem de teste antes de escrever este arquivo) sai, e entra o check nomeado
--   webinar_chat_messages_role_v5 com a mesma lista mais 'co_host' (a lista de src/server/webinars/model.ts,
--   CHAT_ROLES). O check novo aceita tudo que o app de antes grava, entao a migracao sozinha nao atrapalha o app no ar;
-- - o check novo entra `not valid` (secao 1, sem ler as linhas) e e validado depois (secao 2, que le a tabela com um
--   bloqueio que deixa ler e gravar). Pelo MCP do Supabase (execute_sql, uma secao por chamada, na ordem, cada uma
--   comecando com `set lock_timeout = '5s';`), o bloqueio forte do `add constraint` fica so na secao 1. Pelo
--   apply_migration ou pelo migrate.sh da producao, o arquivo roda numa transacao so e o bloqueio forte dura ate o fim
--   do validate; a tabela e pequena, entao o custo e baixo;
-- - o unico drop e o do check antigo, dentro do bloco que so roda sem o check novo; nada de create table, create
--   policy, alter policy, delete nem truncate. Duas secoes, cada uma pelo MCP do Supabase, ou apply_migration com o
--   arquivo inteiro.
--
-- Verificacao manual depois de aplicar:
--   select conname, convalidated, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.webinar_chat_messages'::regclass and contype = 'c'
--     and pg_get_constraintdef(oid) like '%role%'; -- 1 linha: webinar_chat_messages_role_v5, com co_host, convalidated = true
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. webinar_chat_messages: o check do papel com co_host, sem ler as linhas. MCP.
 * ---------------------------------------------------------------------------------------------- */

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webinar_chat_messages_role_v5') then
    alter table public.webinar_chat_messages drop constraint if exists webinar_chat_messages_role_check;
    alter table public.webinar_chat_messages add constraint webinar_chat_messages_role_v5
      check (role in ('host', 'co_host', 'team', 'student', 'guest', 'ai')) not valid;
  end if;
end;
$$;

/* ------------------------------------------------------------------------------------------------
 * 2. webinar_chat_messages: a conferencia das linhas que ja existem (de novo, nada muda). MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinar_chat_messages validate constraint webinar_chat_messages_role_v5;
