-- Webinarios v3 "Sala ao vivo: nome da sala, gravador por hora, ancora e banimentos" (docs/30 §4.1, fase 3). As
-- migracoes ate a 202610290001 (ja aplicadas) nao mudam.
--
-- Regras:
-- - webinar_sessions ganha o nome da sala do Jitsi proprio (room_name, `w-<webinario>-<16 letras>`: gerado ao publicar
--   ou ao abrir a sala, vai so dentro do token, nunca na URL do aluno, docs/30 §8.1), a situacao da maquina do gravador
--   por hora (recorder_status: none / preparing / ready / recording / uploading / uploaded / upload_failed /
--   unavailable / gone, docs/30 §2.2 e §6.7), as horas do pedido da maquina (recorder_requested_at), do pedido de
--   devolucao (recorder_release_requested_at) e do aviso de maquina esquecida (recorder_alerted_at, 6 h), o "Gravar" na
--   fila enquanto a maquina prepara (recording_requested_at, docs/30 §6.7) e a sala trancada (room_locked, docs/30 §1.4);
-- - webinar_recordings ganha a ultima consulta a Bunny (checked_at: o job webinar-recordings consulta a codificacao ate
--   `ready`) e a hora em que o video foi apagado na Bunny pela retencao (purged_at, D10 e §4.5);
-- - webinar_session_bans: remover da sala (kicked, ate o fim) e silenciar no chat (muted, 5 / 15 / 60 min ou ate o fim),
--   por sessao, com prazo, quem e motivo; webinar_user_bans: banir (vale para qualquer webinario ate a equipe desfazer,
--   docs/30 §1.4), uma linha por aluno;
-- - webinar_recording_events: cada chamada do webhook do gravador, bruta e idempotente por sessao + estado + arquivo, com
--   a assinatura conferida e o resultado do processamento, para auditoria e reprocessamento (como webhook_events);
-- - webinar_mark_recording_anchor grava a ancora uma vez (hora do servidor, docs/30 §6.5), poe a maquina em `recording`,
--   tira o "Gravar" da fila e recalcula pela ancora o offset das escritas da sessao feitas antes dela (chat, reacoes,
--   perguntas, respostas e abertura de enquetes): o replay toca o chat da live pela posicao do video. A presenca nao muda
--   (ela conta desde o inicio da live, como webinar_close_session);
-- - tudo so do service_role (RLS ligada, revoke de anon e authenticated); nenhuma politica para authenticated;
-- - compativel com o rascunho desta migracao ja aplicado num banco de ensaio (as mesmas tabelas e checks; o que e novo
--   entra por if not exists e por constraint com nome);
-- - nada de drop, delete, create policy nem alter policy. Seis secoes, cada uma pelo MCP do Supabase (execute_sql, uma
--   por chamada, na ordem), ou apply_migration com o arquivo inteiro.
--
-- Verificacao manual depois de aplicar:
--   select column_name from information_schema.columns where table_name = 'webinar_sessions'
--     and column_name in ('room_name', 'recorder_status', 'recorder_requested_at', 'recorder_release_requested_at',
--       'recorder_alerted_at', 'recording_requested_at', 'room_locked'); -- 7 linhas
--   select column_name from information_schema.columns where table_name = 'webinar_recordings'
--     and column_name in ('checked_at', 'purged_at'); -- 2 linhas
--   select count(*) from pg_tables where schemaname = 'public'
--     and tablename in ('webinar_session_bans', 'webinar_user_bans', 'webinar_recording_events'); -- 3
--   select indexname from pg_indexes where schemaname = 'public' and indexname in ('webinar_sessions_room_name_idx',
--     'webinar_recording_events_unique_idx', 'webinar_session_bans_session_idx', 'webinar_sessions_recorder_idx'); -- 4 linhas
--   select proname from pg_proc where proname = 'webinar_mark_recording_anchor'; -- 1 linha
--   select public.webinar_mark_recording_anchor(gen_random_uuid()); -- erro P0002 (sessao inexistente)
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. webinar_sessions: a sala, o gravador por hora, o "Gravar" na fila e a tranca. MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinar_sessions add column if not exists room_name text;
alter table public.webinar_sessions add column if not exists recorder_status text not null default 'none';
alter table public.webinar_sessions add column if not exists recorder_requested_at timestamptz;
alter table public.webinar_sessions add column if not exists recorder_release_requested_at timestamptz;
alter table public.webinar_sessions add column if not exists recorder_alerted_at timestamptz;
alter table public.webinar_sessions add column if not exists recording_requested_at timestamptz;
alter table public.webinar_sessions add column if not exists room_locked boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webinar_sessions_room_name_v3') then
    alter table public.webinar_sessions add constraint webinar_sessions_room_name_v3
      check (room_name is null or room_name ~ '^w-[0-9a-f-]{36}-[a-z2-9]{16}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'webinar_sessions_recorder_status_v3') then
    alter table public.webinar_sessions add constraint webinar_sessions_recorder_status_v3
      check (recorder_status in ('none', 'preparing', 'ready', 'recording', 'uploading', 'uploaded', 'upload_failed', 'unavailable', 'gone'));
  end if;
  -- Sala, gravador e tranca so existem na Live ao vivo (a gravada e o replay ficam com os padroes).
  if not exists (select 1 from pg_constraint where conname = 'webinar_sessions_live_only_v3') then
    alter table public.webinar_sessions add constraint webinar_sessions_live_only_v3
      check (kind = 'live' or (room_name is null and recorder_status = 'none' and recording_requested_at is null and not room_locked));
  end if;
end;
$$;

create unique index if not exists webinar_sessions_room_name_idx on public.webinar_sessions (room_name) where room_name is not null;

comment on column public.webinar_sessions.room_name is 'A sala do Jitsi proprio (docs/30 §8.1): gerada ao publicar ou ao abrir a sala; vai so dentro do token.';
comment on column public.webinar_sessions.recorder_status is 'A maquina do gravador por hora (docs/30 §6.7): none, preparing, ready, recording, uploading, uploaded, upload_failed, unavailable, gone.';
comment on column public.webinar_sessions.recorder_requested_at is 'Quando o app pediu a maquina do gravador (jibri-up); base do aviso de 6 h e da estimativa do preparo.';
comment on column public.webinar_sessions.recorder_release_requested_at is 'Quando o app pediu a devolucao da maquina (jibri-down); o job repete se ela nao sumir.';
comment on column public.webinar_sessions.recorder_alerted_at is 'Quando a equipe foi avisada no sino de que a maquina passou de 6 h ligada.';
comment on column public.webinar_sessions.recording_requested_at is 'O "Gravar" clicado antes de a maquina ficar pronta (docs/30 §6.7): a gravacao comeca sozinha no ready.';
comment on column public.webinar_sessions.room_locked is 'Sala trancada pelo apresentador (docs/30 §1.4): quem chega espera.';

/* ------------------------------------------------------------------------------------------------
 * 2. webinar_recordings: a consulta da codificacao na Bunny e o apagamento pela retencao. MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinar_recordings add column if not exists checked_at timestamptz;
alter table public.webinar_recordings add column if not exists purged_at timestamptz;

comment on column public.webinar_recordings.checked_at is 'A ultima consulta do job webinar-recordings a Bunny (codificacao ate ready).';
comment on column public.webinar_recordings.purged_at is 'Quando o video foi apagado na Bunny pela retencao (purge_due_at vencido, D10).';

create index if not exists webinar_recordings_processing_idx on public.webinar_recordings (checked_at nulls first) where status = 'processing';
create index if not exists webinar_recordings_purge_idx on public.webinar_recordings (purge_due_at) where purge_due_at is not null and purged_at is null;

/* ------------------------------------------------------------------------------------------------
 * 3. webinar_session_bans (remover da sala e silenciar no chat) e webinar_user_bans (banir). MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_session_bans (
  session_id uuid not null references public.webinar_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('kicked', 'muted')),
  -- Nulo = ate o fim da sessao; o silencio de 5 / 15 / 60 min leva a hora.
  until_at timestamptz,
  by_user_id uuid references auth.users(id) on delete set null,
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  primary key (session_id, user_id, kind)
);

comment on table public.webinar_session_bans is 'Quem foi removido da sala (kicked) ou silenciado no chat (muted) numa sessao, ate quando e por quem.';

-- Remover vale ate o fim da sessao: so o silencio tem hora.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webinar_session_bans_until_v3') then
    alter table public.webinar_session_bans add constraint webinar_session_bans_until_v3
      check (kind = 'muted' or until_at is null);
  end if;
end;
$$;

create index if not exists webinar_session_bans_user_idx on public.webinar_session_bans (user_id);

alter table public.webinar_session_bans enable row level security;
revoke all on public.webinar_session_bans from anon, authenticated;
grant select, insert, update, delete on public.webinar_session_bans to service_role;

-- Banir: o aluno nao entra em nenhum webinario ate a equipe desfazer (docs/30 §1.4); uma linha por aluno, com a sessao
-- em que aconteceu. Desfazer apaga a linha (Server Action unbanStudent).
create table if not exists public.webinar_user_bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_id uuid references public.webinar_sessions(id) on delete set null,
  by_user_id uuid references auth.users(id) on delete set null,
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now()
);

comment on table public.webinar_user_bans is 'Alunos banidos de todos os webinarios ate a equipe desfazer, com a sessao em que aconteceu, quem e o motivo.';

alter table public.webinar_user_bans enable row level security;
revoke all on public.webinar_user_bans from anon, authenticated;
grant select, insert, update, delete on public.webinar_user_bans to service_role;

/* ------------------------------------------------------------------------------------------------
 * 4. webinar_recording_events: o webhook do gravador, bruto e idempotente. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_recording_events (
  id uuid primary key default gen_random_uuid(),
  -- Nula quando a sessao nao existe (o webhook responde 202 ignored e guarda o pedido para conferencia).
  session_id uuid references public.webinar_sessions(id) on delete set null,
  state text not null check (state in ('ready', 'recording', 'uploaded', 'upload_failed', 'unavailable', 'gone')),
  room text check (room is null or char_length(room) <= 120),
  file_name text check (file_name is null or char_length(file_name) <= 255),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 65536),
  signature_valid boolean not null default false,
  processing_status text not null default 'pending' check (processing_status in ('pending', 'processed', 'ignored', 'failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text check (error_message is null or char_length(error_message) <= 2000)
);

comment on table public.webinar_recording_events is 'Cada chamada do webhook do gravador (docs/30 §5.3), guardada inteira para auditoria e reprocessamento.';

create unique index if not exists webinar_recording_events_unique_idx
  on public.webinar_recording_events (session_id, state, coalesce(file_name, ''))
  where session_id is not null;
create index if not exists webinar_recording_events_session_idx on public.webinar_recording_events (session_id, received_at desc);
create index if not exists webinar_recording_events_pending_idx on public.webinar_recording_events (received_at) where processing_status = 'pending';

alter table public.webinar_recording_events enable row level security;
revoke all on public.webinar_recording_events from anon, authenticated;
grant select, insert, update, delete on public.webinar_recording_events to service_role;

/* ------------------------------------------------------------------------------------------------
 * 5. webinar_mark_recording_anchor: a ancora uma vez, pela hora do servidor. MCP.
 * ---------------------------------------------------------------------------------------------- */

-- Devolve { changed, anchor, rebased, recorderStatus, reason }: reason = 'already' (a ancora ja existia: nada muda) ou
-- 'not_live' (sessao que nao e Live ao vivo ou que nao esta na espera nem no ar). Sessao inexistente: erro P0002.
create or replace function public.webinar_mark_recording_anchor(p_session_id uuid, p_now timestamptz default now())
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_session public.webinar_sessions%rowtype;
  v_status text;
  v_rows integer := 0;
  v_rebased integer := 0;
begin
  select * into v_session from public.webinar_sessions where id = p_session_id for update;
  if not found then
    raise exception 'webinar session % not found', p_session_id using errcode = 'P0002';
  end if;
  if v_session.recording_anchor_at is not null then
    return jsonb_build_object('changed', false, 'anchor', v_session.recording_anchor_at, 'rebased', 0,
      'recorderStatus', v_session.recorder_status, 'reason', 'already');
  end if;
  if v_session.kind <> 'live' or v_session.status not in ('waiting', 'live') then
    return jsonb_build_object('changed', false, 'anchor', null, 'rebased', 0,
      'recorderStatus', v_session.recorder_status, 'reason', 'not_live');
  end if;

  v_status := case when v_session.recorder_status in ('preparing', 'ready') then 'recording' else v_session.recorder_status end;

  update public.webinar_sessions
  set recording_anchor_at = p_now,
      recorder_status = v_status,
      recording_requested_at = null
  where id = p_session_id;

  -- O que foi escrito antes da ancora passa a contar dela (negativo = antes de a gravacao comecar).
  update public.webinar_chat_messages m
  set offset_ms = greatest(-86400000, least(172800000, round(extract(epoch from (m.created_at - p_now)) * 1000)))::integer
  where m.session_id = p_session_id;
  get diagnostics v_rows = row_count;
  v_rebased := v_rebased + v_rows;

  update public.webinar_reactions r
  set offset_ms = greatest(-86400000, least(172800000, round(extract(epoch from (r.created_at - p_now)) * 1000)))::integer
  where r.session_id = p_session_id;
  get diagnostics v_rows = row_count;
  v_rebased := v_rebased + v_rows;

  update public.webinar_questions q
  set offset_ms = greatest(-86400000, least(172800000, round(extract(epoch from (q.created_at - p_now)) * 1000)))::integer
  where q.session_id = p_session_id;
  get diagnostics v_rows = row_count;
  v_rebased := v_rebased + v_rows;

  update public.webinar_poll_answers a
  set offset_ms = greatest(-86400000, least(172800000, round(extract(epoch from (a.created_at - p_now)) * 1000)))::integer
  where a.session_id = p_session_id;
  get diagnostics v_rows = row_count;
  v_rebased := v_rebased + v_rows;

  update public.webinar_polls p
  set open_offset_ms = greatest(-86400000, least(172800000, round(extract(epoch from (p.opened_at - p_now)) * 1000)))::integer
  where p.session_id = p_session_id and p.opened_at is not null;
  get diagnostics v_rows = row_count;
  v_rebased := v_rebased + v_rows;

  return jsonb_build_object('changed', true, 'anchor', p_now, 'rebased', v_rebased, 'recorderStatus', v_status, 'reason', null);
end;
$$;

comment on function public.webinar_mark_recording_anchor(uuid, timestamptz) is
  'Grava recording_anchor_at uma vez (hora do servidor), poe o gravador em recording e recalcula pela ancora o offset do que a sessao ja tinha.';

revoke all on function public.webinar_mark_recording_anchor(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.webinar_mark_recording_anchor(uuid, timestamptz) to service_role;

/* ------------------------------------------------------------------------------------------------
 * 6. Indices da sala ao vivo. MCP.
 * ---------------------------------------------------------------------------------------------- */

-- O tick das lives: as sessoes `live` por situacao do gravador (quem pediu maquina, quem esta gravando, quem ficou em
-- uploading, quem ainda nao devolveu a maquina).
create index if not exists webinar_sessions_recorder_idx on public.webinar_sessions (recorder_status, scheduled_at) where kind = 'live';

-- O console lista quem esta removido ou silenciado agora na sessao (o silencio vencido sai pela hora).
create index if not exists webinar_session_bans_session_idx on public.webinar_session_bans (session_id, kind);
