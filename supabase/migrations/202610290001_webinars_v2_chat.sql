-- Webinarios v2 "Live gravada: chat por offset, roteiro, presenca, enquetes, perguntas e relatorio" (docs/30 §4.1,
-- fase 2). As migracoes ate a 202610280001 (ja aplicadas) nao mudam.
--
-- Regras:
-- - webinar_sessions ganha a decisao do selo "Ao vivo" (show_live_badge + simulation_decided_by/at + simulation_ack_text,
--   D10), a curva de presenca congelada no fim (presence_curve), a hora em que o roteiro entrou (script_fired_at) e a
--   mensagem fixada (pinned_message_id);
-- - webinar_chat_consents e o aceite do chat, uma linha por aluno (versao do texto, como o nome aparece, apelido, a hora
--   do aceite e a da retirada);
-- - webinar_recording_transcripts e a transcricao da gravacao (VTT/SRT/TXT colados ou enviados; as cues no mesmo formato
--   de lesson_transcripts) para o "Quando o apresentador diz" do roteiro;
-- - webinar_chat_script_items e o roteiro do webinario (num minuto, numa frase ou pelo botao); ao abrir a sessao gravada
--   cada item pronto vira uma mensagem `scripted` daquela sessao (webinar_open_session), nunca da linha mestre;
-- - webinar_chat_messages e o chat: offset_ms em relacao ao zero do video (negativo = sala de espera), source (de onde
--   veio), role (como aparece), master (entra na linha mestre que as sessoes seguintes repetem), approved (moderacao),
--   e a exclusao com motivo (student / team / consent_revoked). webinar_chat_window monta a janela de uma sessao: as
--   linhas dela + a linha mestre da sessao de origem (a live real, deslocada pela ancora da gravacao) e as promovidas em
--   outras sessoes do mesmo webinario;
-- - webinar_reactions, webinar_polls (+ options, answers), webinar_questions (+ votes): as interacoes, so pelo servidor;
-- - webinar_presence_samples (uma linha por aluno, sessao e balde de 30 s; sem id) e webinar_attendance (o resumo por
--   aluno, feito no fim pela webinar_close_session, que tambem congela presence_curve);
-- - webinar_report ganha o corpo completo (mesma assinatura da 202610280001) e webinar_attendees nasce (a lista por
--   aluno, base do CSV); prune_webinar_history apaga as amostras 90 dias depois do fim, o chat (menos a linha mestre de
--   webinario que ainda nao foi arquivado) depois de chat_retention_days e marca a gravacao (purge_due_at) depois de
--   recording_retention_days; agendada no pg_cron as 06:47 UTC;
-- - tudo so do service_role (RLS ligada, revoke de anon e authenticated); nenhuma politica para authenticated;
-- - nada de drop, delete solto, create policy nem alter policy; os deletes ficam dentro de prune_webinar_history (a secao
--   13 vai sozinha: se o MCP recusar, pelo SQL Editor). Catorze secoes, cada uma pelo MCP do Supabase (execute_sql, uma por
--   chamada, na ordem), ou apply_migration com o arquivo inteiro.
--
-- Verificacao manual depois de aplicar:
--   select count(*) from pg_tables where schemaname = 'public' and tablename like 'webinar%'; -- 17
--   select proname from pg_proc where proname in ('webinar_chat_window', 'webinar_open_session', 'webinar_close_session',
--     'webinar_report', 'webinar_attendees', 'prune_webinar_history') order by 1; -- 6 linhas
--   select column_name from information_schema.columns where table_name = 'webinar_sessions'
--     and column_name in ('show_live_badge', 'presence_curve', 'script_fired_at', 'pinned_message_id'); -- 4 linhas
--   select jobname from cron.job where jobname = 'bunker707-webinar-prune'; -- 1 linha
--   select metric, item, total from public.webinar_report(gen_random_uuid()); -- 0 linhas
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. webinar_sessions: a decisao do selo (D10), a curva congelada, o roteiro e a mensagem fixada. MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinar_sessions add column if not exists show_live_badge boolean not null default false;
alter table public.webinar_sessions add column if not exists simulation_decided_by uuid references auth.users(id) on delete set null;
alter table public.webinar_sessions add column if not exists simulation_decided_at timestamptz;
alter table public.webinar_sessions add column if not exists simulation_ack_text text;
alter table public.webinar_sessions add column if not exists presence_curve jsonb;
alter table public.webinar_sessions add column if not exists script_fired_at timestamptz;
alter table public.webinar_sessions add column if not exists pinned_message_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webinar_sessions_simulation_ack_v2') then
    alter table public.webinar_sessions add constraint webinar_sessions_simulation_ack_v2
      check (simulation_ack_text is null or char_length(simulation_ack_text) <= 600);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'webinar_sessions_presence_curve_v2') then
    alter table public.webinar_sessions add constraint webinar_sessions_presence_curve_v2
      check (presence_curve is null or (jsonb_typeof(presence_curve) = 'object' and pg_column_size(presence_curve) <= 262144));
  end if;
end;
$$;

comment on column public.webinar_sessions.show_live_badge is 'O selo "Ao vivo" na sessao gravada; false mostra "Sessao". Decisao registrada em simulation_decided_by/at e simulation_ack_text (docs/30 D10).';
comment on column public.webinar_sessions.presence_curve is 'Congelada no fim pela webinar_close_session: {buckets:[{b,n}], bucketSeconds, durationMs, unique, peak, avgPresent, watchAvg, watchMax, reachedEnd, frozenAt}.';

/* ------------------------------------------------------------------------------------------------
 * 2. webinar_chat_consents: o aceite do chat, uma linha por aluno (D10). MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_chat_consents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  consent_version smallint not null check (consent_version between 1 and 100),
  display_mode text not null default 'first_name_initial' check (display_mode in ('first_name_initial', 'nickname', 'anonymous')),
  nickname text check (nickname is null or char_length(nickname) between 2 and 40),
  consented_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.webinar_chat_consents is 'O aceite do chat dos webinarios (versao do texto, como o nome aparece); "Remover minhas mensagens" grava revoked_at.';

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_webinar_chat_consents_updated_at' and tgrelid = 'public.webinar_chat_consents'::regclass
  ) then
    create trigger set_webinar_chat_consents_updated_at
      before update on public.webinar_chat_consents
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.webinar_chat_consents enable row level security;
revoke all on public.webinar_chat_consents from anon, authenticated;
grant select, insert, update, delete on public.webinar_chat_consents to service_role;

/* ------------------------------------------------------------------------------------------------
 * 3. webinar_recording_transcripts (as cues do "Quando o apresentador diz") e webinar_recordings.purge_due_at. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_recording_transcripts (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null unique references public.webinar_recordings(id) on delete cascade,
  language text not null default 'pt-BR' check (char_length(language) between 2 and 35),
  source_format text not null check (source_format in ('json3', 'srt', 'vtt', 'txt')),
  full_text text not null check (char_length(full_text) between 1 and 2000000),
  cues jsonb not null default '[]'::jsonb check (jsonb_typeof(cues) = 'array'),
  checksum text not null check (char_length(checksum) between 32 and 128),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.webinar_recording_transcripts is 'A transcricao da gravacao de um webinario (cues como em lesson_transcripts), para resolver as frases do roteiro.';

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_webinar_recording_transcripts_updated_at' and tgrelid = 'public.webinar_recording_transcripts'::regclass
  ) then
    create trigger set_webinar_recording_transcripts_updated_at
      before update on public.webinar_recording_transcripts
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.webinar_recording_transcripts enable row level security;
revoke all on public.webinar_recording_transcripts from anon, authenticated;
grant select, insert, update, delete on public.webinar_recording_transcripts to service_role;

-- Marcada pela prune_webinar_history quando passou recording_retention_days; quem apaga na Bunny e o job da fase 3.
alter table public.webinar_recordings add column if not exists purge_due_at timestamptz;

/* ------------------------------------------------------------------------------------------------
 * 4. webinar_chat_script_items: o roteiro do webinario. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_chat_script_items (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  trigger_kind text not null check (trigger_kind in ('at_offset', 'on_phrase', 'manual')),
  -- at_offset: o minuto do video (pode ser negativo: sala de espera). on_phrase: a frase e o atraso; o servidor grava
  -- resolved_offset_ms (ja com o atraso) quando acha a frase nas cues da transcricao.
  offset_ms integer check (offset_ms is null or offset_ms between -86400000 and 172800000),
  phrase text check (phrase is null or char_length(phrase) between 2 and 300),
  phrase_delay_ms integer not null default 0 check (phrase_delay_ms between -60000 and 600000),
  resolved_offset_ms integer check (resolved_offset_ms is null or resolved_offset_ms between -86400000 and 172800000),
  resolved_transcript_id uuid references public.webinar_recording_transcripts(id) on delete set null,
  persona_name text not null check (char_length(persona_name) between 1 and 60),
  persona_role text not null default 'student' check (persona_role in ('student', 'team')),
  body text not null check (char_length(body) between 1 and 1000),
  kind text not null default 'message' check (kind in ('message', 'question')),
  status text not null default 'draft' check (status in ('draft', 'ready', 'unresolved', 'disabled')),
  position integer not null default 0 check (position between 0 and 100000),
  generated_by_ai boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webinar_chat_script_items_trigger_v2 check (
    (trigger_kind = 'at_offset' and offset_ms is not null)
    or (trigger_kind = 'on_phrase' and phrase is not null)
    or trigger_kind = 'manual'
  )
);

comment on table public.webinar_chat_script_items is 'O roteiro de chat de um webinario: cada item vira uma mensagem scripted da sessao quando ela abre (ou pelo botao Soltar agora).';

create index if not exists webinar_chat_script_items_position_idx on public.webinar_chat_script_items (webinar_id, position);
create index if not exists webinar_chat_script_items_status_idx on public.webinar_chat_script_items (webinar_id, status);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_webinar_chat_script_items_updated_at' and tgrelid = 'public.webinar_chat_script_items'::regclass
  ) then
    create trigger set_webinar_chat_script_items_updated_at
      before update on public.webinar_chat_script_items
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.webinar_chat_script_items enable row level security;
revoke all on public.webinar_chat_script_items from anon, authenticated;
grant select, insert, update, delete on public.webinar_chat_script_items to service_role;

/* ------------------------------------------------------------------------------------------------
 * 5. webinar_chat_messages e a mensagem fixada da sessao. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_chat_messages (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  session_id uuid not null references public.webinar_sessions(id) on delete cascade,
  -- Em relacao ao zero do video da sessao: a hora marcada (gravada) ou a ancora da gravacao (live). Negativo antes.
  offset_ms integer not null check (offset_ms between -86400000 and 172800000),
  author_user_id uuid references auth.users(id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 80),
  role text not null check (role in ('host', 'team', 'student', 'guest', 'ai')),
  source text not null check (source in ('original', 'audience', 'team', 'scripted', 'ai')),
  body text not null check (char_length(body) between 1 and 1000),
  kind text not null default 'message' check (kind in ('message', 'question', 'answer', 'system')),
  reply_to_id uuid references public.webinar_chat_messages(id) on delete set null,
  script_item_id uuid references public.webinar_chat_script_items(id) on delete set null,
  -- Linha mestre: as mensagens da live real (e as promovidas) que as sessoes seguintes repetem pelo offset.
  master boolean not null default false,
  approved boolean not null default true,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  pinned_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  deleted_reason text check (deleted_reason is null or deleted_reason in ('student', 'team', 'consent_revoked')),
  created_at timestamptz not null default now()
);

comment on table public.webinar_chat_messages is 'O chat dos webinarios por offset do video: linhas da sessao e a linha mestre (master) repetida pelas sessoes gravadas.';

create index if not exists webinar_chat_messages_window_idx on public.webinar_chat_messages (session_id, offset_ms) where deleted_at is null;
create index if not exists webinar_chat_messages_recent_idx on public.webinar_chat_messages (session_id, created_at desc);
create index if not exists webinar_chat_messages_author_idx on public.webinar_chat_messages (author_user_id) where author_user_id is not null;
create index if not exists webinar_chat_messages_master_idx on public.webinar_chat_messages (webinar_id, offset_ms) where master and deleted_at is null;
create unique index if not exists webinar_chat_messages_script_idx on public.webinar_chat_messages (session_id, script_item_id) where script_item_id is not null;

alter table public.webinar_chat_messages enable row level security;
revoke all on public.webinar_chat_messages from anon, authenticated;
grant select, insert, update, delete on public.webinar_chat_messages to service_role;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webinar_sessions_pinned_message_fk') then
    alter table public.webinar_sessions
      add constraint webinar_sessions_pinned_message_fk
      foreign key (pinned_message_id) references public.webinar_chat_messages(id) on delete set null;
  end if;
end;
$$;

/* ------------------------------------------------------------------------------------------------
 * 6. webinar_reactions. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_reactions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.webinar_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  offset_ms integer not null check (offset_ms between -86400000 and 172800000),
  reaction text not null check (reaction in ('like', 'love', 'clap', 'fire', 'laugh', 'wow')),
  created_at timestamptz not null default now()
);

comment on table public.webinar_reactions is 'As reacoes da barra do aluno numa sessao, por offset do video.';

create index if not exists webinar_reactions_offset_idx on public.webinar_reactions (session_id, offset_ms);
create index if not exists webinar_reactions_user_idx on public.webinar_reactions (session_id, user_id);
create index if not exists webinar_reactions_recent_idx on public.webinar_reactions (session_id, created_at desc);

alter table public.webinar_reactions enable row level security;
revoke all on public.webinar_reactions from anon, authenticated;
grant select, insert, update, delete on public.webinar_reactions to service_role;

/* ------------------------------------------------------------------------------------------------
 * 7. webinar_polls, webinar_poll_options e webinar_poll_answers. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_polls (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  -- Nula = o modelo da enquete (editor); a copia lancada numa sessao tem session_id e aponta para o modelo.
  session_id uuid references public.webinar_sessions(id) on delete cascade,
  template_poll_id uuid references public.webinar_polls(id) on delete set null,
  question text not null check (char_length(question) between 1 and 300),
  kind text not null default 'single' check (kind in ('single', 'multiple', 'survey')),
  anonymous boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  open_offset_ms integer check (open_offset_ms is null or open_offset_ms between -86400000 and 172800000),
  opened_at timestamptz,
  closed_at timestamptz,
  results_shared_at timestamptz,
  position integer not null default 0 check (position between 0 and 10000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.webinar_polls is 'Enquetes de um webinario: o modelo (sem sessao) e a copia lancada em cada sessao.';

create index if not exists webinar_polls_session_idx on public.webinar_polls (session_id, status);
create index if not exists webinar_polls_template_idx on public.webinar_polls (webinar_id, position) where session_id is null;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_webinar_polls_updated_at' and tgrelid = 'public.webinar_polls'::regclass
  ) then
    create trigger set_webinar_polls_updated_at
      before update on public.webinar_polls
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.webinar_polls enable row level security;
revoke all on public.webinar_polls from anon, authenticated;
grant select, insert, update, delete on public.webinar_polls to service_role;

create table if not exists public.webinar_poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.webinar_polls(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 120),
  position integer not null default 0 check (position between 0 and 100),
  created_at timestamptz not null default now()
);

create index if not exists webinar_poll_options_poll_idx on public.webinar_poll_options (poll_id, position);

alter table public.webinar_poll_options enable row level security;
revoke all on public.webinar_poll_options from anon, authenticated;
grant select, insert, update, delete on public.webinar_poll_options to service_role;

create table if not exists public.webinar_poll_answers (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.webinar_polls(id) on delete cascade,
  session_id uuid not null references public.webinar_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  option_ids uuid[] not null check (cardinality(option_ids) between 1 and 20),
  offset_ms integer not null check (offset_ms between -86400000 and 172800000),
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists webinar_poll_answers_unique_idx on public.webinar_poll_answers (poll_id, user_id);
create index if not exists webinar_poll_answers_session_idx on public.webinar_poll_answers (session_id, user_id);
create index if not exists webinar_poll_answers_user_idx on public.webinar_poll_answers (user_id);

alter table public.webinar_poll_answers enable row level security;
revoke all on public.webinar_poll_answers from anon, authenticated;
grant select, insert, update, delete on public.webinar_poll_answers to service_role;

/* ------------------------------------------------------------------------------------------------
 * 8. webinar_questions e webinar_question_votes. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.webinar_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  anonymous boolean not null default false,
  body text not null check (char_length(body) between 1 and 500),
  message_id uuid references public.webinar_chat_messages(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'answered', 'dismissed')),
  upvotes integer not null default 0 check (upvotes >= 0),
  answered_by uuid references auth.users(id) on delete set null,
  answer_text text check (answer_text is null or char_length(answer_text) <= 1000),
  answered_live boolean not null default false,
  answered_at timestamptz,
  offset_ms integer not null check (offset_ms between -86400000 and 172800000),
  deleted_at timestamptz,
  deleted_reason text check (deleted_reason is null or deleted_reason in ('student', 'team', 'consent_revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.webinar_questions is 'A aba Perguntas de uma sessao: votos, resposta por texto ou ao vivo.';

create index if not exists webinar_questions_board_idx on public.webinar_questions (session_id, status, upvotes desc);
create index if not exists webinar_questions_user_idx on public.webinar_questions (user_id);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_webinar_questions_updated_at' and tgrelid = 'public.webinar_questions'::regclass
  ) then
    create trigger set_webinar_questions_updated_at
      before update on public.webinar_questions
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.webinar_questions enable row level security;
revoke all on public.webinar_questions from anon, authenticated;
grant select, insert, update, delete on public.webinar_questions to service_role;

create table if not exists public.webinar_question_votes (
  question_id uuid not null references public.webinar_questions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (question_id, user_id)
);

alter table public.webinar_question_votes enable row level security;
revoke all on public.webinar_question_votes from anon, authenticated;
grant select, insert, update, delete on public.webinar_question_votes to service_role;

/* ------------------------------------------------------------------------------------------------
 * 9. webinar_presence_samples (balde de 30 s, linha enxuta) e webinar_attendance (resumo por aluno). MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_presence_samples (
  session_id uuid not null references public.webinar_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket integer not null check (bucket between -2880 and 5760),
  state text not null check (state in ('playing', 'paused', 'buffering', 'hidden')),
  offset_seconds integer not null default 0 check (offset_seconds between -86400 and 172800),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  samples smallint not null default 1 check (samples between 1 and 32767),
  primary key (session_id, user_id, bucket)
);

comment on table public.webinar_presence_samples is 'Presenca por aluno, sessao e balde de 30 s (sinal a cada 15 s); apagada 90 dias depois do fim (prune_webinar_history).';

create index if not exists webinar_presence_samples_bucket_idx on public.webinar_presence_samples (session_id, bucket);

alter table public.webinar_presence_samples enable row level security;
revoke all on public.webinar_presence_samples from anon, authenticated;
grant select, insert, update, delete on public.webinar_presence_samples to service_role;

create table if not exists public.webinar_attendance (
  session_id uuid not null references public.webinar_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  first_at timestamptz not null,
  last_at timestamptz not null,
  entries integer not null default 1 check (entries >= 1),
  seconds integer not null default 0 check (seconds >= 0),
  max_bucket integer not null default 0,
  reached_end boolean not null default false,
  primary key (session_id, user_id)
);

comment on table public.webinar_attendance is 'O resumo de presenca por aluno e sessao, feito no fim (webinar_close_session); os paineis leem daqui, nunca das amostras.';

create index if not exists webinar_attendance_user_idx on public.webinar_attendance (user_id);

alter table public.webinar_attendance enable row level security;
revoke all on public.webinar_attendance from anon, authenticated;
grant select, insert, update, delete on public.webinar_attendance to service_role;

/* ------------------------------------------------------------------------------------------------
 * 10. webinar_chat_window: a janela do chat de uma sessao (as linhas dela + a linha mestre). MCP.
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.webinar_chat_window(p_session_id uuid, p_from_ms integer, p_to_ms integer, p_user_id uuid default null)
returns table (
  id uuid,
  offset_ms integer,
  display_name text,
  role text,
  source text,
  body text,
  kind text,
  reply_to_id uuid,
  author_user_id uuid,
  approved boolean,
  master boolean,
  pinned_at timestamptz,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with s as (
    select s.id, s.webinar_id, s.source_session_id, coalesce(r.anchor_offset_ms, 0) as anchor_ms
    from public.webinar_sessions s
    left join public.webinar_recordings r on r.id = s.recording_id
    where s.id = p_session_id
  )
  -- As linhas da propria sessao (as aprovadas, e as do proprio aluno ainda na moderacao).
  select m.id, m.offset_ms, m.display_name, m.role, m.source, m.body, m.kind, m.reply_to_id, m.author_user_id,
    m.approved, m.master, m.pinned_at, m.created_at
  from public.webinar_chat_messages m
  join s on s.id = m.session_id
  where m.deleted_at is null
    and m.offset_ms between p_from_ms and p_to_ms
    and (m.approved or (p_user_id is not null and m.author_user_id = p_user_id))
  union all
  -- A linha mestre: a sessao de origem (a live real, deslocada pela ancora da gravacao) e as promovidas em outras
  -- sessoes do mesmo webinario (ja na posicao do video).
  select m.id,
    case when ms.kind = 'live' then m.offset_ms - s.anchor_ms else m.offset_ms end,
    m.display_name, m.role, m.source, m.body, m.kind, m.reply_to_id, m.author_user_id,
    m.approved, m.master, m.pinned_at, m.created_at
  from public.webinar_chat_messages m
  join public.webinar_sessions ms on ms.id = m.session_id
  cross join s
  where m.master
    and m.approved
    and m.deleted_at is null
    and m.session_id <> s.id
    and (m.session_id = s.source_session_id or m.webinar_id = s.webinar_id)
    and (case when ms.kind = 'live' then m.offset_ms - s.anchor_ms else m.offset_ms end) between p_from_ms and p_to_ms
  order by 2, 13;
$$;

comment on function public.webinar_chat_window(uuid, integer, integer, uuid) is
  'A janela [from, to] em ms do chat de uma sessao: as linhas dela e a linha mestre repetida (docs/30 §6.6).';

/* ------------------------------------------------------------------------------------------------
 * 11. webinar_open_session (abre e solta o roteiro) e webinar_close_session (encerra e congela). MCP.
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.webinar_open_session(p_session_id uuid, p_now timestamptz default now())
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_session public.webinar_sessions%rowtype;
  v_fired integer := 0;
begin
  select * into v_session from public.webinar_sessions where id = p_session_id for update;
  if not found then
    raise exception 'webinar session % not found', p_session_id using errcode = 'P0002';
  end if;
  if v_session.status in ('ended', 'cancelled') then
    return jsonb_build_object('status', v_session.status, 'fired', 0, 'changed', false);
  end if;

  -- O roteiro entra uma vez por sessao (a chave unica session_id + script_item_id segura a repeticao).
  if v_session.script_fired_at is null then
    insert into public.webinar_chat_messages
      (webinar_id, session_id, offset_ms, author_user_id, display_name, role, source, body, kind, script_item_id,
       master, approved, created_at)
    select v_session.webinar_id, v_session.id,
      case i.trigger_kind when 'at_offset' then i.offset_ms else i.resolved_offset_ms end,
      null, i.persona_name, i.persona_role, 'scripted', i.body, i.kind, i.id,
      false, true,
      v_session.scheduled_at + make_interval(secs => (case i.trigger_kind when 'at_offset' then i.offset_ms else i.resolved_offset_ms end) / 1000.0)
    from public.webinar_chat_script_items i
    where i.webinar_id = v_session.webinar_id
      and i.status = 'ready'
      and i.trigger_kind in ('at_offset', 'on_phrase')
      and (case i.trigger_kind when 'at_offset' then i.offset_ms else i.resolved_offset_ms end) is not null
    on conflict (session_id, script_item_id) where script_item_id is not null do nothing;
    get diagnostics v_fired = row_count;
  end if;

  update public.webinar_sessions
  set status = 'live',
      started_at = coalesce(started_at, case when kind = 'simulated' then scheduled_at else p_now end),
      script_fired_at = coalesce(script_fired_at, p_now)
  where id = p_session_id;

  return jsonb_build_object('status', 'live', 'fired', v_fired, 'changed', v_session.status <> 'live');
end;
$$;

comment on function public.webinar_open_session(uuid, timestamptz) is
  'Poe a sessao em live (started_at = hora marcada na gravada) e solta o roteiro pronto como mensagens scripted, uma vez.';

create or replace function public.webinar_close_session(p_session_id uuid, p_now timestamptz default now())
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_session public.webinar_sessions%rowtype;
  v_duration_ms bigint;
  v_buckets integer;
  v_curve jsonb;
  v_summary jsonb;
begin
  select * into v_session from public.webinar_sessions where id = p_session_id for update;
  if not found then
    raise exception 'webinar session % not found', p_session_id using errcode = 'P0002';
  end if;

  -- A duracao do video (gravacao), ou o tempo real da live, ou a duracao prevista do webinario.
  select coalesce(
      (select r.duration_seconds::bigint * 1000 from public.webinar_recordings r
        where r.id = v_session.recording_id and r.duration_seconds > 0),
      case when v_session.started_at is not null and v_session.ended_at is not null
        then (extract(epoch from (v_session.ended_at - v_session.started_at)) * 1000)::bigint end,
      case when v_session.started_at is not null
        then (extract(epoch from (p_now - v_session.started_at)) * 1000)::bigint end,
      (select w.duration_minutes::bigint * 60000 from public.webinars w where w.id = v_session.webinar_id))
    into v_duration_ms;
  v_duration_ms := greatest(coalesce(v_duration_ms, 0), 30000);
  v_buckets := greatest(1, ceil(v_duration_ms / 30000.0))::integer;

  -- O resumo por aluno (todo mundo que mandou sinal; a equipe sai nas leituras). Trecho novo = buraco > 3 baldes.
  insert into public.webinar_attendance (session_id, user_id, first_at, last_at, entries, seconds, max_bucket, reached_end)
  select p.session_id, p.user_id, min(p.first_at), max(p.last_at),
    1 + count(*) filter (where p.prev_bucket is not null and p.bucket - p.prev_bucket > 3),
    (sum(least(p.samples, 2)) * 15)::integer,
    max(p.bucket),
    max(p.bucket) + 1 >= ceil(v_buckets * 0.95)
  from (
    select ps.*, lag(ps.bucket) over (partition by ps.user_id order by ps.bucket) as prev_bucket
    from public.webinar_presence_samples ps
    where ps.session_id = p_session_id and ps.bucket >= 0
  ) p
  group by p.session_id, p.user_id
  on conflict (session_id, user_id) do update
    set first_at = excluded.first_at, last_at = excluded.last_at, entries = excluded.entries,
      seconds = excluded.seconds, max_bucket = excluded.max_bucket, reached_end = excluded.reached_end;

  -- A curva por balde (so alunos), congelada na sessao.
  select coalesce(jsonb_agg(jsonb_build_object('b', c.b, 'n', c.n) order by c.b), '[]'::jsonb)
    into v_curve
  from (
    select ps.bucket as b, count(distinct ps.user_id) as n
    from public.webinar_presence_samples ps
    where ps.session_id = p_session_id and ps.bucket >= 0
      and not exists (select 1 from public.admin_roles a where a.user_id = ps.user_id)
    group by ps.bucket
  ) c;

  select jsonb_build_object(
      'buckets', v_curve,
      'bucketSeconds', 30,
      'durationMs', v_duration_ms,
      'unique', (select count(*) from public.webinar_attendance a
                  where a.session_id = p_session_id
                    and not exists (select 1 from public.admin_roles x where x.user_id = a.user_id)),
      'peak', (select jsonb_build_object('b', x.b, 'n', x.n)
               from (select (e->>'b')::integer as b, (e->>'n')::integer as n from jsonb_array_elements(v_curve) e
                     order by (e->>'n')::integer desc, (e->>'b')::integer asc limit 1) x),
      'avgPresent', (select coalesce(round(avg((e->>'n')::numeric), 1), 0) from jsonb_array_elements(v_curve) e),
      'watchAvg', (select coalesce(round(avg(a.seconds)), 0) from public.webinar_attendance a
                   where a.session_id = p_session_id
                     and not exists (select 1 from public.admin_roles x where x.user_id = a.user_id)),
      'watchMax', (select coalesce(max(a.seconds), 0) from public.webinar_attendance a
                   where a.session_id = p_session_id
                     and not exists (select 1 from public.admin_roles x where x.user_id = a.user_id)),
      'reachedEnd', (select count(*) filter (where a.reached_end) from public.webinar_attendance a
                     where a.session_id = p_session_id
                       and not exists (select 1 from public.admin_roles x where x.user_id = a.user_id)),
      'frozenAt', p_now)
    into v_summary;

  update public.webinar_sessions
  set presence_curve = v_summary,
      status = case when status = 'cancelled' then status else 'ended' end,
      ended_at = coalesce(ended_at, p_now)
  where id = p_session_id;

  return v_summary;
end;
$$;

comment on function public.webinar_close_session(uuid, timestamptz) is
  'Encerra a sessao: resume as amostras em webinar_attendance e congela presence_curve (docs/30 §4.5). Pode rodar de novo.';

/* ------------------------------------------------------------------------------------------------
 * 12. webinar_report (o corpo completo, mesma assinatura da 202610280001) e webinar_attendees. MCP.
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.webinar_report(p_session_id uuid)
returns table (metric text, item text, total bigint, students bigint)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with s as (
    select s.id, s.webinar_id, s.kind, s.presence_curve,
      greatest(coalesce(
        (select r.duration_seconds::bigint * 1000 from public.webinar_recordings r
          where r.id = s.recording_id and r.duration_seconds > 0),
        case when s.started_at is not null and s.ended_at is not null
          then (extract(epoch from (s.ended_at - s.started_at)) * 1000)::bigint end,
        w.duration_minutes::bigint * 60000), 30000) as duration_ms
    from public.webinar_sessions s
    join public.webinars w on w.id = s.webinar_id
    where s.id = p_session_id
  ),
  staff as (select a.user_id from public.admin_roles a),
  reg as (
    select r.user_id, r.status, r.source
    from public.webinar_registrations r, s
    where r.webinar_id = s.webinar_id and (r.session_id = s.id or r.session_id is null)
      and not exists (select 1 from staff where staff.user_id = r.user_id)
  ),
  att as (
    select a.user_id, a.seconds, a.reached_end
    from public.webinar_attendance a, s
    where a.session_id = s.id and not exists (select 1 from staff where staff.user_id = a.user_id)
  ),
  live_samples as (
    -- So com a sessao em andamento (sem curva congelada): o relatorio ao vivo da equipe.
    select ps.user_id, ps.bucket, ps.samples
    from public.webinar_presence_samples ps, s
    where ps.session_id = s.id and s.presence_curve is null and ps.bucket >= 0
      and not exists (select 1 from staff where staff.user_id = ps.user_id)
  ),
  present as (
    select att.user_id, att.seconds, att.reached_end from att
    union all
    select ls.user_id, (sum(least(ls.samples, 2)) * 15)::integer,
      max(ls.bucket) + 1 >= ceil((select duration_ms from s) / 30000.0 * 0.95)
    from live_samples ls
    where not exists (select 1 from att where att.user_id = ls.user_id)
    group by ls.user_id
  ),
  curve as (
    select (e->>'b')::integer as b, (e->>'n')::bigint as n
    from s, jsonb_array_elements(coalesce(s.presence_curve->'buckets', '[]'::jsonb)) e
    where s.presence_curve is not null
    union all
    select ls.bucket, count(distinct ls.user_id) from live_samples ls group by ls.bucket
  ),
  drops as (
    select c.b, c.n - lag(c.n) over (order by c.b) as delta from curve c
  ),
  msgs as (
    select m.author_user_id as user_id, m.offset_ms
    from public.webinar_chat_messages m, s
    where m.session_id = s.id and m.deleted_at is null and m.source in ('audience', 'original')
      and m.author_user_id is not null
      and not exists (select 1 from staff where staff.user_id = m.author_user_id)
  ),
  reacts as (
    select r.user_id, r.offset_ms, r.reaction
    from public.webinar_reactions r, s
    where r.session_id = s.id and not exists (select 1 from staff where staff.user_id = r.user_id)
  ),
  qs as (
    select q.id, q.user_id, q.status, q.upvotes
    from public.webinar_questions q, s
    where q.session_id = s.id and q.deleted_at is null
      and not exists (select 1 from staff where staff.user_id = q.user_id)
  ),
  pa as (
    select a.poll_id, a.user_id, o.option_id
    from public.webinar_poll_answers a
    cross join lateral unnest(a.option_ids) as o(option_id), s
    where a.session_id = s.id and a.deleted_at is null
      and not exists (select 1 from staff where staff.user_id = a.user_id)
  ),
  people as (
    select m.user_id from msgs m union select q.user_id from qs q union select r.user_id from reacts r
    union select p.user_id from pa p union select pr.user_id from present pr
  ),
  hot as (
    -- M3: mensagem 1 (teto 50), pergunta 2, reacao 0,5, enquete 1, cada 10 min 1; 0-100 pelo maior da sessao.
    select u.user_id,
      least((select count(*) from msgs m where m.user_id = u.user_id), 50) * 1.0
      + (select count(*) from qs q where q.user_id = u.user_id) * 2.0
      + (select count(*) from reacts r where r.user_id = u.user_id) * 0.5
      + (select count(distinct p.poll_id) from pa p where p.user_id = u.user_id) * 1.0
      + coalesce((select floor(max(pr.seconds) / 600.0) from present pr where pr.user_id = u.user_id), 0) as score
    from people u
  ),
  hot_max as (select greatest(max(h.score), 0.0001) as m from hot h),
  replay_att as (
    select a.user_id, a.seconds
    from public.webinar_attendance a
    join public.webinar_sessions rs on rs.id = a.session_id, s
    where rs.webinar_id = s.webinar_id and rs.kind = 'replay'
      and not exists (select 1 from staff where staff.user_id = a.user_id)
  ),
  script_ready as (
    select count(*)::bigint as n
    from public.webinar_chat_script_items i, s
    where i.webinar_id = s.webinar_id and i.status = 'ready' and i.trigger_kind <> 'manual'
  ),
  script_fired as (
    select count(*)::bigint as n
    from public.webinar_chat_messages m, s
    where m.session_id = s.id and m.source = 'scripted' and m.script_item_id is not null
  ),
  report as (
  select 'registration'::text as metric, r.status as item, count(*)::bigint as total, count(distinct r.user_id)::bigint as students from reg r group by r.status
  union all
  select 'registration', 'attended', count(*)::bigint, count(*)::bigint from reg r
    where r.status = 'registered' and exists (select 1 from present p where p.user_id = r.user_id)
  union all
  select 'registration', 'absent', count(*)::bigint, count(*)::bigint from reg r
    where r.status = 'registered' and not exists (select 1 from present p where p.user_id = r.user_id)
  union all
  select 'registration_source', coalesce(r.source, ''), count(*)::bigint, count(distinct r.user_id)::bigint
    from reg r where r.status = 'registered' group by r.source
  union all
  select 'presence', c.b::text, c.n, c.n from curve c
  union all
  select 'unique', '', count(*)::bigint, count(*)::bigint from present p
  union all
  (select 'peak', c.b::text, c.n, c.n from curve c order by c.n desc, c.b asc limit 1)
  union all
  select 'avg_present', '', coalesce(round(avg(c.n)), 0)::bigint, coalesce(round(avg(c.n)), 0)::bigint from curve c
  union all
  (select 'drop', d.b::text, -d.delta, -d.delta
   from (select distinct on (x.b / 2) x.b, x.delta from drops x where x.delta < 0 order by x.b / 2, x.delta asc) d
   order by d.delta asc, d.b asc limit 5)
  union all
  select 'watch_avg', '', coalesce(round(avg(p.seconds)), 0)::bigint, count(*)::bigint from present p
  union all
  select 'watch_max', '', coalesce(max(p.seconds), 0)::bigint, count(*)::bigint from present p
  union all
  select 'reached_end', '', count(*) filter (where p.reached_end)::bigint, count(*) filter (where p.reached_end)::bigint from present p
  union all
  select 'chat_total', '', count(*)::bigint, count(distinct m.user_id)::bigint from msgs m
  union all
  select 'chat_minute', (greatest(m.offset_ms, 0) / 60000)::text, count(*)::bigint, count(distinct m.user_id)::bigint
    from msgs m group by greatest(m.offset_ms, 0) / 60000
  union all
  (select 'top_chat', m.user_id::text, count(*)::bigint, count(*)::bigint from msgs m group by m.user_id
   order by count(*) desc, m.user_id limit 10)
  union all
  (select 'hot', h.user_id::text, round(h.score / hm.m * 100)::bigint, 1::bigint from hot h, hot_max hm
   where h.score > 0 order by h.score desc, h.user_id limit 10)
  union all
  select 'reaction', r.reaction, count(*)::bigint, count(distinct r.user_id)::bigint from reacts r group by r.reaction
  union all
  select 'reaction_minute', r.reaction || ':' || (greatest(r.offset_ms, 0) / 60000)::text, count(*)::bigint, count(distinct r.user_id)::bigint
    from reacts r group by r.reaction, greatest(r.offset_ms, 0) / 60000
  union all
  select 'question', q.status, count(*)::bigint, count(distinct q.user_id)::bigint from qs q group by q.status
  union all
  (select 'top_question', q.id::text, q.upvotes::bigint, 1::bigint from qs q order by q.upvotes desc, q.id limit 10)
  union all
  select 'poll', p.poll_id::text || ':' || p.option_id::text, count(*)::bigint, count(distinct p.user_id)::bigint
    from pa p group by p.poll_id, p.option_id
  union all
  select 'replay', 'viewers', count(*)::bigint, count(*)::bigint from replay_att ra
  union all
  select 'replay', 'watched_pct',
    coalesce(round(avg(ra.seconds) / nullif((select duration_ms from s) / 1000.0, 0) * 100), 0)::bigint, count(*)::bigint
    from replay_att ra
  union all
  select 'sim_script', 'ready', sr.n, 0::bigint from script_ready sr
  union all
  select 'sim_script', 'fired', sf.n, 0::bigint from script_fired sf
  union all
  select 'sim_script', 'missed', greatest(sr.n - sf.n, 0), 0::bigint from script_ready sr, script_fired sf
    where exists (select 1 from public.webinar_sessions x, s where x.id = s.id and x.script_fired_at is not null)
  )
  -- Sessao que nao existe: nenhuma linha (os agregados sem grupo dariam uma linha de zeros).
  select r.metric, r.item, r.total, r.students from report r where exists (select 1 from s);
$$;

comment on function public.webinar_report(uuid) is
  'O relatorio de uma sessao (docs/30 §3.4 e §4.6): uma linha por metrica e item, so alunos, so chat audience/original; le presence_curve quando a sessao encerrou.';

create or replace function public.webinar_attendees(p_session_id uuid)
returns table (
  user_id uuid,
  registered boolean,
  source text,
  first_at timestamptz,
  last_at timestamptz,
  entries integer,
  seconds integer,
  reached_end boolean,
  messages bigint,
  questions bigint,
  reactions bigint,
  polls bigint
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with s as (select s.id, s.webinar_id from public.webinar_sessions s where s.id = p_session_id),
  regs as (
    select r.user_id, r.status, r.source, r.registered_at
    from public.webinar_registrations r, s
    where r.webinar_id = s.webinar_id and (r.session_id = s.id or r.session_id is null)
  ),
  people as (
    select a.user_id from public.webinar_attendance a, s where a.session_id = s.id
    union
    select r.user_id from regs r where r.status = 'registered'
  )
  select p.user_id,
    exists (select 1 from regs r where r.user_id = p.user_id and r.status = 'registered'),
    (select r.source from regs r where r.user_id = p.user_id order by r.registered_at desc limit 1),
    a.first_at, a.last_at, a.entries, a.seconds, coalesce(a.reached_end, false),
    (select count(*) from public.webinar_chat_messages m, s
      where m.session_id = s.id and m.author_user_id = p.user_id and m.deleted_at is null and m.source in ('audience', 'original')),
    (select count(*) from public.webinar_questions q, s where q.session_id = s.id and q.user_id = p.user_id and q.deleted_at is null),
    (select count(*) from public.webinar_reactions r, s where r.session_id = s.id and r.user_id = p.user_id),
    (select count(*) from public.webinar_poll_answers pa, s where pa.session_id = s.id and pa.user_id = p.user_id and pa.deleted_at is null)
  from people p
  left join public.webinar_attendance a on a.session_id = p_session_id and a.user_id = p.user_id
  where not exists (select 1 from public.admin_roles ar where ar.user_id = p.user_id)
  order by a.seconds desc nulls last, p.user_id;
$$;

comment on function public.webinar_attendees(uuid) is
  'A lista por aluno de uma sessao (quem garantiu vaga e quem esteve), base do CSV; so alunos, sem cache.';

/* ------------------------------------------------------------------------------------------------
 * 13. prune_webinar_history (os unicos deletes do arquivo) e o agendamento. MCP, sozinha (ou SQL Editor).
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.prune_webinar_history()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  sample_rows bigint; chat_rows bigint; master_rows bigint; reaction_rows bigint; question_rows bigint;
  answer_rows bigint; recording_rows bigint;
begin
  -- Amostras: 90 dias depois do fim (a curva congelada e webinar_attendance ficam).
  delete from public.webinar_presence_samples ps using public.webinar_sessions s
  where s.id = ps.session_id and s.ended_at is not null and s.ended_at < now() - interval '90 days';
  get diagnostics sample_rows = row_count;

  -- Chat da sessao (menos a linha mestre) depois de chat_retention_days do fim.
  delete from public.webinar_chat_messages m using public.webinar_sessions s, public.webinars w
  where s.id = m.session_id and w.id = s.webinar_id and not m.master
    and s.ended_at is not null and s.ended_at < now() - make_interval(days => w.chat_retention_days);
  get diagnostics chat_rows = row_count;

  -- A linha mestre so sai de webinario arquivado ou excluido, passada a retencao dele.
  delete from public.webinar_chat_messages m using public.webinars w
  where w.id = m.webinar_id and m.master
    and (w.status = 'archived' or w.deleted_at is not null)
    and coalesce(w.deleted_at, w.updated_at) < now() - make_interval(days => w.chat_retention_days);
  get diagnostics master_rows = row_count;

  delete from public.webinar_reactions r using public.webinar_sessions s, public.webinars w
  where s.id = r.session_id and w.id = s.webinar_id
    and s.ended_at is not null and s.ended_at < now() - make_interval(days => w.chat_retention_days);
  get diagnostics reaction_rows = row_count;

  delete from public.webinar_questions q using public.webinar_sessions s, public.webinars w
  where s.id = q.session_id and w.id = s.webinar_id
    and s.ended_at is not null and s.ended_at < now() - make_interval(days => w.chat_retention_days);
  get diagnostics question_rows = row_count;

  delete from public.webinar_poll_answers a using public.webinar_sessions s, public.webinars w
  where s.id = a.session_id and w.id = s.webinar_id
    and s.ended_at is not null and s.ended_at < now() - make_interval(days => w.chat_retention_days);
  get diagnostics answer_rows = row_count;

  -- A gravacao e marcada; quem apaga na Bunny e o job webinar-recordings (fase 3), que le purge_due_at.
  update public.webinar_recordings r
  set purge_due_at = now()
  from public.webinar_sessions s, public.webinars w
  where s.id = r.session_id and w.id = r.webinar_id and r.purge_due_at is null and r.status = 'ready'
    and s.ended_at is not null and s.ended_at < now() - make_interval(days => w.recording_retention_days);
  get diagnostics recording_rows = row_count;

  return jsonb_build_object(
    'samples', sample_rows, 'chat', chat_rows, 'master', master_rows, 'reactions', reaction_rows,
    'questions', question_rows, 'pollAnswers', answer_rows, 'recordingsMarked', recording_rows);
end;
$$;

comment on function public.prune_webinar_history() is
  'Retencao dos webinarios (docs/30 §4.5 e D10): amostras em 90 dias, chat e interacoes por chat_retention_days, gravacao marcada por recording_retention_days.';

revoke all on function public.prune_webinar_history() from public, anon, authenticated;
grant execute on function public.prune_webinar_history() to service_role;

do $$
begin
  -- 06:47 UTC (03:47 em Brasilia), depois da limpeza da Comunicacao (06:41).
  if not exists (select 1 from cron.job where jobname = 'bunker707-webinar-prune') then
    perform cron.schedule(
      'bunker707-webinar-prune',
      '47 6 * * *',
      'select public.prune_webinar_history();'
    );
  end if;
end;
$$;

/* ------------------------------------------------------------------------------------------------
 * 14. Permissoes das funcoes de leitura e de sessao (so service_role). MCP.
 * ---------------------------------------------------------------------------------------------- */

revoke all on function public.webinar_chat_window(uuid, integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.webinar_chat_window(uuid, integer, integer, uuid) to service_role;
revoke all on function public.webinar_open_session(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.webinar_open_session(uuid, timestamptz) to service_role;
revoke all on function public.webinar_close_session(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.webinar_close_session(uuid, timestamptz) to service_role;
revoke all on function public.webinar_report(uuid) from public, anon, authenticated;
grant execute on function public.webinar_report(uuid) to service_role;
revoke all on function public.webinar_attendees(uuid) from public, anon, authenticated;
grant execute on function public.webinar_attendees(uuid) to service_role;
