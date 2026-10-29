-- Webinarios v3, ajustes da revisao "Sala ao vivo" (docs/30 §4.1 e §6.5, fase 3). A 202610290002 ja foi aplicada na
-- nuvem de teste (o produtor rodou o SQL em 29/10/2026) e nao muda; o que a revisao pediu no banco entra aqui, so
-- acrescentando.
--
-- Regras:
-- - webinar_recording_events ganha machine_requested_at (a hora do pedido da maquina, recorder_requested_at da sessao
--   quando o `ready` / `unavailable` / `gone` chegou) e a chave unica passa a ser sessao + estado + arquivo + maquina:
--   o `ready` da segunda maquina da mesma sessao vira uma linha propria (com o corpo bruto e a hora dele, para auditoria
--   e para a estimativa "Preparando a gravação, {n} min"), e o "repetido" fica so para a repeticao da mesma maquina.
--   O indice novo nasce antes de o velho sair (nenhum instante sem a idempotencia do webhook);
-- - webinar_sessions ganha browser_recording_at: a reserva "Gravar no navegador" (docs/30 §6.7, D3) gravando agora (o
--   console marca e limpa); o selo "Gravando" do aluno vale tambem para ela (so na Live ao vivo, pelo check);
-- - o trigger webinar_live_offset_from_anchor (BEFORE INSERT em webinar_chat_messages, webinar_reactions,
--   webinar_questions e webinar_poll_answers): na sessao `live` com recording_anchor_at, o offset_ms gravado e
--   created_at − ancora (o mesmo intervalo e a mesma conta da webinar_mark_recording_anchor). A leitura da sessao e
--   FOR KEY SHARE (o mesmo lock que a chave estrangeira ja pega): uma escrita que comecou antes da ancora e grava depois
--   espera a RPC terminar e le a ancora nova; a RPC que chega depois espera a escrita e o recalculo dela pega a linha.
--   Nenhuma escrita em voo fica com o offset contado desde o inicio;
-- - tudo do service_role (a funcao do trigger e security invoker); nada de create policy, alter policy, delete nem
--   truncate; o unico drop e o do indice unico velho, depois do novo. Tres secoes, cada uma pelo MCP do Supabase
--   (execute_sql, uma por chamada, na ordem), ou apply_migration com o arquivo inteiro.
--
-- Verificacao manual depois de aplicar:
--   select column_name from information_schema.columns where table_name = 'webinar_recording_events'
--     and column_name = 'machine_requested_at'; -- 1 linha
--   select indexname from pg_indexes where schemaname = 'public' and indexname in ('webinar_recording_events_unique_idx',
--     'webinar_recording_events_machine_unique_idx'); -- so a machine_unique
--   select column_name from information_schema.columns where table_name = 'webinar_sessions'
--     and column_name = 'browser_recording_at'; -- 1 linha
--   select tgname from pg_trigger where tgname like 'webinar_%_offset_from_anchor' order by 1; -- 4 linhas
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. webinar_recording_events: a maquina na chave unica do webhook do gravador. MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinar_recording_events add column if not exists machine_requested_at timestamptz;

comment on column public.webinar_recording_events.machine_requested_at is
  'A hora do pedido da maquina (recorder_requested_at da sessao) no ready / unavailable / gone: cada maquina tem a sua linha.';

create unique index if not exists webinar_recording_events_machine_unique_idx
  on public.webinar_recording_events (session_id, state, coalesce(file_name, ''), coalesce(machine_requested_at, '1970-01-01 00:00:00+00'::timestamptz))
  where session_id is not null;

drop index if exists public.webinar_recording_events_unique_idx;

/* ------------------------------------------------------------------------------------------------
 * 2. webinar_sessions: a gravacao no navegador do Apresentador (o selo Gravando para todos). MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinar_sessions add column if not exists browser_recording_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webinar_sessions_browser_recording_live_v3') then
    alter table public.webinar_sessions add constraint webinar_sessions_browser_recording_live_v3
      check (kind = 'live' or browser_recording_at is null);
  end if;
end;
$$;

comment on column public.webinar_sessions.browser_recording_at is
  'A reserva Gravar no navegador ligada (docs/30 §6.7): o selo Gravando do aluno vale; nulo quando para.';

/* ------------------------------------------------------------------------------------------------
 * 3. webinar_live_offset_from_anchor: a escrita em voo durante a ancora fica no relogio da ancora. MCP.
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.webinar_live_offset_from_anchor()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_kind text;
  v_anchor timestamptz;
begin
  if new.session_id is null then
    return new;
  end if;

  -- FOR KEY SHARE: com a RPC da ancora no meio (FOR UPDATE na mesma linha), espera ela terminar e le a ancora nova.
  select s.kind, s.recording_anchor_at into v_kind, v_anchor
  from public.webinar_sessions s
  where s.id = new.session_id
  for key share;

  if v_kind = 'live' and v_anchor is not null then
    new.offset_ms := greatest(-86400000, least(172800000, round(extract(epoch from (coalesce(new.created_at, now()) - v_anchor)) * 1000)))::integer;
  end if;

  return new;
end;
$$;

comment on function public.webinar_live_offset_from_anchor() is
  'Na sessao live com ancora, o offset_ms da linha nova e created_at - ancora (a escrita em voo durante a ancora nao fica contada desde o inicio).';

revoke all on function public.webinar_live_offset_from_anchor() from public, anon, authenticated;

drop trigger if exists webinar_chat_messages_offset_from_anchor on public.webinar_chat_messages;
create trigger webinar_chat_messages_offset_from_anchor
  before insert on public.webinar_chat_messages
  for each row execute function public.webinar_live_offset_from_anchor();

drop trigger if exists webinar_reactions_offset_from_anchor on public.webinar_reactions;
create trigger webinar_reactions_offset_from_anchor
  before insert on public.webinar_reactions
  for each row execute function public.webinar_live_offset_from_anchor();

drop trigger if exists webinar_questions_offset_from_anchor on public.webinar_questions;
create trigger webinar_questions_offset_from_anchor
  before insert on public.webinar_questions
  for each row execute function public.webinar_live_offset_from_anchor();

drop trigger if exists webinar_poll_answers_offset_from_anchor on public.webinar_poll_answers;
create trigger webinar_poll_answers_offset_from_anchor
  before insert on public.webinar_poll_answers
  for each row execute function public.webinar_live_offset_from_anchor();
