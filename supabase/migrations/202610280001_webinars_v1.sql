-- Webinarios v1 "Base: agenda, vaga garantida e lembretes" (docs/30 §4.1, fase 1). As migracoes ate a
-- 202610260001 (ja aplicadas) nao mudam.
--
-- Regras:
-- - webinars e a peca editada no admin (Live ao vivo ou Live gravada): titulo, capa, apresentador, quem pode
--   (Todos / Segmento / Quem tem o produto X, com o mesmo jsonb de segmento das campanhas), Garantir vaga,
--   lembretes, o que avisar na pagina inicial, os padroes da sala, a qualidade (D26) e a gravacao. Nada de
--   chat, presenca ou relatorio aqui: isso e a fase 2;
-- - webinar_sessions e cada hora marcada: a Live ao vivo tem uma sessao `live`; a Live gravada tem uma
--   sessao `simulated` por horario; o `replay` (um por webinario) nasce na fase 2/3. A sessao e a unidade
--   da vaga, do lembrete e, depois, do relatorio;
-- - webinar_presenters sao os co-apresentadores e a Equipe da sala (so contas da area; `can_moderate_room`
--   so para a Equipe);
-- - webinar_registrations e a vaga garantida: uma por aluno e sessao (ou por webinario, quando a sessao e
--   nula), com as marcas de cada lembrete enviado (idempotencia do tick) e o token do calendario;
-- - webinar_recordings e o video da Bunny de uma sessao (enviado pela Equipe na fase 1; pelo Jibri na 3);
-- - notifications ganha o kind 'webinar' (lembretes e avisos de live no sino, sem campanha) e a funcao
--   communication_visible_notifications passa a mostrar esse kind como mostra os comentarios;
-- - a politica "Students can create own events" (202606150003, alterada na 202610260001) passa a recusar
--   tambem as linhas dos webinarios (entity_type = 'webinar'): elas so saem pelo servidor. alter policy, sem
--   drop; indice parcial para o relatorio da fase 2;
-- - webinar_report(p_session_id) nasce aqui devolvendo so as vagas (registration/registered|cancelled); a
--   fase 2 a substitui com presenca, chat, perguntas e enquetes. security invoker, so service_role;
-- - nada de drop de tabela, delete nem create policy; os unicos gatilhos sao os set_updated_at das tabelas
--   novas (criados so se nao existem, como na 202610250001): oito secoes, cada uma pelo MCP do Supabase
--   (apply_migration com o arquivo inteiro, ou execute_sql por secao, na ordem). A secao 6 troca o check
--   do kind de notifications (drop constraint do check antigo + add do novo: a unica remocao do arquivo).
--
-- Verificacao manual depois de aplicar:
--   select count(*) from pg_tables where schemaname = 'public' and tablename like 'webinar%'; -- 5
--   select conname from pg_constraint where conname = 'notifications_kind_v4'; -- 1 linha
--   select proname from pg_proc where proname = 'webinar_report'; -- 1 linha
--   select pg_get_expr(polwithcheck, polrelid) from pg_policy where polname = 'Students can create own events';
--     -- contem 'campaign' e 'webinar'
--   select indexname from pg_indexes where schemaname = 'public' and indexname = 'student_events_webinar_idx';
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. webinars. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinars (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  kind text not null check (kind in ('live', 'simulated')),
  title text not null check (char_length(title) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  cover_url text check (cover_url is null or char_length(cover_url) <= 2048),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  host_user_id uuid references auth.users(id) on delete set null,
  -- Acesso: 'everyone' (Todos), 'product' (Quem tem o produto X), 'audience' (Segmento) ou 'either'
  -- (produto ou segmento). product_id e o id de content_items (texto, como em entitlements.product_id).
  access_mode text not null default 'everyone' check (access_mode in ('everyone', 'product', 'audience', 'either')),
  product_id text check (product_id is null or product_id ~ '^[A-Za-z0-9_-]{1,240}$'),
  audience jsonb not null default '{"kind":"everyone"}'::jsonb
    check (jsonb_typeof(audience) = 'object' and pg_column_size(audience) <= 16384),
  registration_required boolean not null default true,
  capacity integer check (capacity is null or capacity between 1 and 100000),
  show_registered_count boolean not null default false,
  -- {"h24": bool, "h1": bool, "email": bool}
  reminders jsonb not null default '{"h24":true,"h1":true,"email":true}'::jsonb
    check (jsonb_typeof(reminders) = 'object' and pg_column_size(reminders) <= 1024),
  -- Textos escolhidos pela equipe (vazio = padrao do app): confirmation, h24, h1, started, after_attended,
  -- after_absent. Nunca mais que 600 caracteres cada (zod no salvar).
  reminder_texts jsonb not null default '{}'::jsonb
    check (jsonb_typeof(reminder_texts) = 'object' and pg_column_size(reminder_texts) <= 8192),
  show_on_home boolean not null default true,
  replay_days_on_home integer not null default 7 check (replay_days_on_home between 0 and 60),
  show_banner boolean not null default true,
  -- Live ao vivo: a hora marcada (a sessao `live` nasce dela ao publicar). Live gravada: nulo (as sessoes
  -- carregam as horas).
  scheduled_at timestamptz,
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 480),
  allow_student_camera boolean not null default true,
  -- {"stage": 720 | 1080, "screenFps": 30 | 15} (D26; miniaturas, camera de aluno e gravacao sao fixas)
  quality jsonb not null default '{"stage":720,"screenFps":30}'::jsonb
    check (jsonb_typeof(quality) = 'object' and pg_column_size(quality) <= 1024),
  -- Padroes da sala copiados para a sessao ao abrir (fase 2/3): chatMode, slowModeSeconds, questions,
  -- anonymousQuestions, polls, reactions, displayName, waitingRoom, practiceSession, newCommentsVisible.
  room_settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(room_settings) = 'object' and pg_column_size(room_settings) <= 4096),
  auto_record boolean not null default true,
  -- {"productId", "moduleId", "title", "autoPublish"}: o replay vira aula em [produto > modulo] (fase 3).
  replay_lesson_target jsonb
    check (replay_lesson_target is null or (jsonb_typeof(replay_lesson_target) = 'object' and pg_column_size(replay_lesson_target) <= 2048)),
  chat_retention_days integer not null default 730 check (chat_retention_days between 30 and 3650),
  recording_retention_days integer not null default 730 check (recording_retention_days between 30 and 3650),
  published_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.webinars is 'Webinarios (docs/30): Live ao vivo ou Live gravada, editados em /admin/comunicacao/webinarios.';

create index if not exists webinars_status_idx on public.webinars (status, deleted_at);
create index if not exists webinars_scheduled_idx on public.webinars (scheduled_at) where deleted_at is null;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_webinars_updated_at' and tgrelid = 'public.webinars'::regclass
  ) then
    create trigger set_webinars_updated_at
      before update on public.webinars
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.webinars enable row level security;
revoke all on public.webinars from anon, authenticated;
grant select, insert, update, delete on public.webinars to service_role;

/* ------------------------------------------------------------------------------------------------
 * 2. webinar_sessions. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_sessions (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  kind text not null check (kind in ('live', 'simulated', 'replay')),
  scheduled_at timestamptz not null,
  started_at timestamptz,
  ended_at timestamptz,
  -- A ancora: a hora em que a gravacao comecou de verdade (fase 3); o offset de tudo e contado dela.
  recording_anchor_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'waiting', 'live', 'ended', 'cancelled')),
  -- recording_id ganha a chave estrangeira na secao 4 (webinar_recordings nasce depois desta tabela).
  recording_id uuid,
  -- A live cujo chat a sessao gravada repete (fase 2).
  source_session_id uuid references public.webinar_sessions(id) on delete set null,
  late_join_minutes integer check (late_join_minutes is null or late_join_minutes between 0 and 600),
  chat_mode text not null default 'open' check (chat_mode in ('open', 'moderated', 'team_only', 'off')),
  chat_slow_mode_seconds integer check (chat_slow_mode_seconds is null or chat_slow_mode_seconds in (10, 20, 30, 60)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.webinar_sessions is 'Cada hora marcada de um webinario: live (uma), simulated (uma por horario) ou replay (um por webinario).';

create index if not exists webinar_sessions_webinar_idx on public.webinar_sessions (webinar_id, scheduled_at);
create index if not exists webinar_sessions_status_idx on public.webinar_sessions (status, scheduled_at);
create index if not exists webinar_sessions_kind_idx on public.webinar_sessions (kind, ended_at);
create unique index if not exists webinar_sessions_one_replay_idx on public.webinar_sessions (webinar_id) where kind = 'replay';

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_webinar_sessions_updated_at' and tgrelid = 'public.webinar_sessions'::regclass
  ) then
    create trigger set_webinar_sessions_updated_at
      before update on public.webinar_sessions
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.webinar_sessions enable row level security;
revoke all on public.webinar_sessions from anon, authenticated;
grant select, insert, update, delete on public.webinar_sessions to service_role;

/* ------------------------------------------------------------------------------------------------
 * 3. webinar_presenters. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_presenters (
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('co_host', 'team')),
  can_moderate_room boolean not null default false,
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  primary key (webinar_id, user_id)
);

comment on table public.webinar_presenters is 'Co-apresentadores (co_host) e Equipe da sala (team) de um webinario; so contas da area.';

alter table public.webinar_presenters enable row level security;
revoke all on public.webinar_presenters from anon, authenticated;
grant select, insert, update, delete on public.webinar_presenters to service_role;

/* ------------------------------------------------------------------------------------------------
 * 4. webinar_recordings e a chave de webinar_sessions.recording_id. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_recordings (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  session_id uuid references public.webinar_sessions(id) on delete set null,
  provider text not null default 'bunny' check (provider in ('bunny')),
  bunny_library_id text check (bunny_library_id is null or char_length(bunny_library_id) <= 40),
  bunny_video_id text check (bunny_video_id is null or char_length(bunny_video_id) <= 80),
  -- O endereco do player como a equipe colou (embed da Bunny), para a pagina do aluno.
  embed_url text check (embed_url is null or char_length(embed_url) <= 2048),
  duration_seconds integer check (duration_seconds is null or duration_seconds between 0 and 86400),
  status text not null default 'ready' check (status in ('pending_upload', 'uploading', 'processing', 'ready', 'failed')),
  source text not null default 'upload' check (source in ('jibri', 'upload', 'obs', 'bunny')),
  file_name text check (file_name is null or char_length(file_name) <= 255),
  -- O ajuste fino do "Alinhar chat" (fase 2): posicao no video = offset da mensagem - anchor_offset_ms.
  anchor_offset_ms integer not null default 0 check (anchor_offset_ms between -3600000 and 3600000),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  error_message text check (error_message is null or char_length(error_message) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.webinar_recordings is 'O video (Bunny Stream) de uma sessao: enviado pela equipe ou gravado pelo Jibri.';

create index if not exists webinar_recordings_session_idx on public.webinar_recordings (session_id);
create index if not exists webinar_recordings_webinar_idx on public.webinar_recordings (webinar_id);
create unique index if not exists webinar_recordings_bunny_idx
  on public.webinar_recordings (provider, bunny_video_id)
  where bunny_video_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_webinar_recordings_updated_at' and tgrelid = 'public.webinar_recordings'::regclass
  ) then
    create trigger set_webinar_recordings_updated_at
      before update on public.webinar_recordings
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.webinar_recordings enable row level security;
revoke all on public.webinar_recordings from anon, authenticated;
grant select, insert, update, delete on public.webinar_recordings to service_role;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webinar_sessions_recording_fk') then
    alter table public.webinar_sessions
      add constraint webinar_sessions_recording_fk
      foreign key (recording_id) references public.webinar_recordings(id) on delete set null;
  end if;
end;
$$;

/* ------------------------------------------------------------------------------------------------
 * 5. webinar_registrations. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_registrations (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  -- Nula = vale para a sessao unica da Live ao vivo (ou qualquer sessao); a Live gravada grava a sessao.
  session_id uuid references public.webinar_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'registered' check (status in ('registered', 'cancelled')),
  -- Link de origem (?origem=) e o aviso que trouxe o aluno (relatorio e CSV Registration).
  source text check (source is null or char_length(source) <= 80),
  source_campaign_id uuid references public.campaigns(id) on delete set null,
  reminder_24h_sent_at timestamptz,
  reminder_1h_sent_at timestamptz,
  started_notice_sent_at timestamptz,
  cancelled_notice_sent_at timestamptz,
  calendar_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  registered_at timestamptz not null default now(),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.webinar_registrations is 'Vaga garantida de um aluno numa sessao (ou no webinario), com as marcas dos lembretes enviados.';

create unique index if not exists webinar_registrations_unique_idx
  on public.webinar_registrations (webinar_id, user_id, coalesce(session_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists webinar_registrations_session_idx on public.webinar_registrations (session_id, status);
create index if not exists webinar_registrations_user_idx on public.webinar_registrations (user_id);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_webinar_registrations_updated_at' and tgrelid = 'public.webinar_registrations'::regclass
  ) then
    create trigger set_webinar_registrations_updated_at
      before update on public.webinar_registrations
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.webinar_registrations enable row level security;
revoke all on public.webinar_registrations from anon, authenticated;
grant select, insert, update, delete on public.webinar_registrations to service_role;

/* ------------------------------------------------------------------------------------------------
 * 6. notifications: o kind 'webinar' (lembretes e avisos de live no sino, sem campanha). MCP.
 *    O check do kind e o que a 202610200001 criou em linha (nome dado pelo Postgres); a troca e a unica
 *    remocao deste arquivo. notifications_notice_has_campaign nao muda: so 'notice' exige campanha.
 * ---------------------------------------------------------------------------------------------- */

do $$
declare
  v_name text;
begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_kind_v4') then
    select c.conname into v_name
    from pg_constraint c
    where c.conrelid = 'public.notifications'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%comment_mention%'
    limit 1;
    if v_name is not null then
      execute format('alter table public.notifications drop constraint %I', v_name);
    end if;
    alter table public.notifications add constraint notifications_kind_v4
      check (kind in ('notice', 'comment_reply', 'comment_mention', 'webinar'));
  end if;
end;
$$;

-- Mesma funcao da 202610220001; so ganha o ramo do kind 'webinar' (visivel enquanto nao vence nem e
-- escondida; o titulo, o texto e o link vem da propria linha, que o servidor escreve).
create or replace function public.communication_visible_notifications(p_user_id uuid, p_now timestamptz, p_id uuid default null)
returns table (
  id uuid,
  kind text,
  is_test boolean,
  campaign_id uuid,
  flow_node_id uuid,
  created_at timestamptz,
  expires_at timestamptz,
  seen_at timestamptz,
  read_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  response text,
  reaction text,
  poll_choice text[],
  interaction_writes smallint,
  sent_at timestamptz,
  response_mode text,
  has_audio boolean,
  allow_reactions boolean,
  poll jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select n.id, n.kind, n.is_test, n.campaign_id, n.flow_node_id, n.created_at, n.expires_at, n.seen_at, n.read_at,
    n.opened_at, n.clicked_at, n.response, n.reaction, n.poll_choice, n.interaction_writes, c.sent_at, c.response_mode,
    c.audio_url is not null, coalesce(c.allow_reactions, false), c.poll
  from public.notifications n
  left join public.campaigns c on c.id = n.campaign_id
  where n.user_id = p_user_id
    and (p_id is null or n.id = p_id)
    and n.created_at >= p_now - interval '90 days'
    and n.expires_at > p_now
    and n.hidden_at is null
    and case
      when n.kind = 'notice' then c.id is not null and c.deleted_at is null and (n.is_test or c.status = 'sent')
      when n.kind = 'webinar' then true
      else exists (
        select 1
        from public.lesson_comments r
        where r.id = (
            case when n.payload->>'commentId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (n.payload->>'commentId')::uuid end
          )
          and r.status = 'approved'
          and r.deleted_at is null
      ) and (
        coalesce(n.payload->>'parentCommentId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or exists (
          select 1
          from public.lesson_comments p
          where p.id = (
              case when n.payload->>'parentCommentId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then (n.payload->>'parentCommentId')::uuid end
            )
            and p.status = 'approved'
            and p.deleted_at is null
        )
      )
    end;
$$;

/* ------------------------------------------------------------------------------------------------
 * 7. student_events: o aluno nao grava linhas de webinario no proprio historico; indice parcial do
 *    relatorio (fase 2). MCP, sozinha (ou SQL Editor): o indice nao e concurrently.
 * ---------------------------------------------------------------------------------------------- */

-- Mesma politica, mesmo papel; so a condicao muda (o navegador grava apenas entity_type = 'auth').
alter policy "Students can create own events" on public.student_events
  with check (auth.uid() = user_id and coalesce(entity_type, '') not in ('campaign', 'webinar'));

create index if not exists student_events_webinar_idx
  on public.student_events (entity_id, event_type)
  where entity_type = 'webinar';

/* ------------------------------------------------------------------------------------------------
 * 8. webinar_report: so as vagas por enquanto (so service_role; security invoker). MCP.
 *    A fase 2 troca o corpo (presenca, chat, perguntas, enquetes) sem mudar a assinatura.
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.webinar_report(p_session_id uuid)
returns table (metric text, item text, total bigint, students bigint)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select 'registration'::text as metric,
    r.status as item,
    count(*)::bigint as total,
    count(distinct r.user_id)::bigint as students
  from public.webinar_sessions s
  join public.webinar_registrations r
    on r.webinar_id = s.webinar_id and (r.session_id = s.id or r.session_id is null)
  where s.id = p_session_id
    and not exists (select 1 from public.admin_roles a where a.user_id = r.user_id)
  group by r.status;
$$;

revoke all on function public.webinar_report(uuid) from public, anon, authenticated;
grant execute on function public.webinar_report(uuid) to service_role;
