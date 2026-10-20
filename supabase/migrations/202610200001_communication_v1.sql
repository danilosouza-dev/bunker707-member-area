-- Comunicacao v1 (2026-10-20): notificacoes no sino do aluno e pop-ups na home, criados pela equipe em
-- Comunicacao > Avisos e pop-ups, e notificacoes automaticas de resposta e mencao nos comentarios.
-- Decisoes em docs/22 (e docs/17 §1.8, §2.4 e D4); fluxo do envio agendado em docs/04, secao Jobs.
--
-- Regras:
-- - `campaigns` guarda cada aviso (tipo `inbox` = notificacao no sino, `popup` = pop-up na home), com o
--   conteudo (titulo, texto, imagem, audio, botao), o segmento (`audience`, regras E/OU avaliadas no
--   servidor por src/server/communications/audience-model.ts) e a situacao;
-- - `notifications` e a caixa do sino: uma linha por aluno. Notificacao de aviso (`notice`) nao copia o
--   conteudo, aponta para o aviso; as automaticas (`comment_reply`, `comment_mention`) guardam o trecho e o
--   link da aula. `dedupe_key` unico por aluno torna o envio idempotente (o mesmo aviso nunca chega duas
--   vezes, mesmo com o tick repetido ou cortado no meio);
-- - `campaign_deliveries` e o estado do pop-up por aluno (elegivel, visto, clicado, "Nao mostrar de novo",
--   "Lembrar depois"); a escolha do pop-up e os limites fixos (1 por sessao, 1 a cada 24 h) ficam no servidor;
-- - o bucket publico `communication-audio` guarda os audios dos avisos (ate 10 MB); as imagens usam o
--   `content-assets` que ja existe;
-- - a equipe nunca entra nas contagens (admin_roles);
-- - nada aqui e lido pelo navegador: RLS ligado, nada para anon/authenticated e so o servidor
--   (service_role) le e grava, depois de conferir sessao e permissao no TypeScript;
-- - retencao: o sino mostra 90 dias; `prune_communication_history()` apaga, todo dia, notificacoes e
--   estados de pop-up com mais de 24 meses (docs/17 D8). Conta excluida leva as linhas junto (cascade).
--
-- Verificacao manual depois de aplicar:
--   select kind, status, count(*) from public.campaigns group by kind, status order by kind, status;
--   select kind, count(*), count(*) filter (where seen_at is null) as nao_vistas from public.notifications group by kind;
--   select * from public.communication_overview(now() - interval '30 days', now());
--   select id, public, file_size_limit from storage.buckets where id = 'communication-audio';
--   select jobname, schedule, active from cron.job where jobname = 'bunker707-communication-prune';
--
-- Idempotente: pode ser executada mais de uma vez sem efeito colateral.

/* ------------------------------------------------------------------------------------------------
 * 1. Avisos
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('inbox', 'popup')),
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'scheduled', 'sending', 'sent', 'canceled', 'active', 'paused', 'ended')),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  body text not null default '' check (char_length(body) <= 600),
  image_url text check (image_url is null or (char_length(image_url) <= 2048 and image_url ~ '^https?://[^[:space:]]+$')),
  image_alt text check (image_alt is null or char_length(image_alt) <= 160),
  audio_url text check (audio_url is null or (char_length(audio_url) <= 2048 and audio_url ~ '^https?://[^[:space:]]+$')),
  audio_mime text check (audio_mime is null or char_length(audio_mime) <= 80),
  audio_duration_seconds integer check (audio_duration_seconds is null or audio_duration_seconds between 1 and 600),
  audio_peaks jsonb check (audio_peaks is null or (jsonb_typeof(audio_peaks) = 'array' and jsonb_array_length(audio_peaks) <= 96)),
  cta_label text check (cta_label is null or char_length(btrim(cta_label)) between 1 and 30),
  cta_href text check (cta_href is null or char_length(cta_href) between 1 and 2048),
  cta_target text check (cta_target is null or cta_target in ('same_tab', 'new_tab')),
  response_mode text not null default 'none' check (response_mode in ('none', 'accept_decline')),
  accept_label text check (accept_label is null or char_length(btrim(accept_label)) between 1 and 24),
  decline_label text check (decline_label is null or char_length(btrim(decline_label)) between 1 and 24),
  audience jsonb not null default '{"kind":"everyone"}'::jsonb
    check (jsonb_typeof(audience) = 'object' and pg_column_size(audience) <= 16384),
  audience_count integer check (audience_count is null or audience_count >= 0),
  audience_counted_at timestamptz,
  -- Notificacao: quando sai (agendada) ou saiu. Pop-up: janela em que aparece (nula = desde a publicacao / sem fim).
  send_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  popup_repeat text not null default 'once' check (popup_repeat in ('once', 'until_action')),
  allow_snooze boolean not null default true,
  dispatch_started_at timestamptz,
  dispatch_attempts integer not null default 0 check (dispatch_attempts >= 0),
  last_error text check (last_error is null or char_length(last_error) <= 2000),
  sent_at timestamptz,
  recipients_count integer check (recipients_count is null or recipients_count >= 0),
  audience_refreshed_at timestamptz,
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  constraint campaigns_status_by_kind check (
    (kind = 'inbox' and status in ('draft', 'pending_approval', 'scheduled', 'sending', 'sent', 'canceled'))
    or (kind = 'popup' and status in ('draft', 'pending_approval', 'active', 'paused', 'ended'))
  ),
  constraint campaigns_audio_complete check ((audio_url is null) = (audio_duration_seconds is null)),
  constraint campaigns_cta_complete check (
    (cta_label is null) = (cta_href is null) and (cta_href is null) = (cta_target is null)
  ),
  constraint campaigns_response_inbox_only check (kind = 'inbox' or response_mode = 'none'),
  constraint campaigns_window check (ends_at is null or starts_at is null or ends_at > starts_at)
);

-- Notificacoes vencidas para o job do tick (agendadas e em envio).
create index if not exists campaigns_due_idx
  on public.campaigns (send_at)
  where kind = 'inbox' and status in ('scheduled', 'sending') and deleted_at is null;

-- Pop-ups publicados (a escolha por aluno parte desta lista curta).
create index if not exists campaigns_live_popups_idx
  on public.campaigns (starts_at)
  where kind = 'popup' and status = 'active' and deleted_at is null;

create index if not exists campaigns_list_idx on public.campaigns (created_at desc) where deleted_at is null;

-- updated_at e a versao do aviso para a checagem de conflito do editor (409 "mudou em outra tela"). O
-- recalculo periodico de quem ve o pop-up (job do tick, a cada 15 minutos) so mexe na contagem e na hora
-- do recalculo: isso nao conta como edicao, senao quem esta com o editor aberto perderia a versao.
create or replace function public.touch_campaign_version()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (to_jsonb(new) - array['audience_count', 'audience_counted_at', 'audience_refreshed_at', 'updated_at'])
    is distinct from (to_jsonb(old) - array['audience_count', 'audience_counted_at', 'audience_refreshed_at', 'updated_at']) then
    new.updated_at = now();
  else
    new.updated_at = old.updated_at;
  end if;

  return new;
end;
$$;

revoke all on function public.touch_campaign_version() from public, anon, authenticated, service_role;

comment on function public.touch_campaign_version() is
  'Trigger de campaigns: muda updated_at (versao do editor) so quando algo alem da contagem do segmento muda.';

drop trigger if exists set_campaigns_updated_at on public.campaigns;
create trigger set_campaigns_updated_at
  before update on public.campaigns
  for each row execute function public.touch_campaign_version();

alter table public.campaigns enable row level security;
revoke all on public.campaigns from anon, authenticated;
grant select, insert, update, delete on public.campaigns to service_role;

comment on table public.campaigns is
  'Avisos da equipe (notificacao no sino ou pop-up na home): conteudo, segmento (regras E/OU), agenda e situacao. Escrita somente pelo servidor.';

/* ------------------------------------------------------------------------------------------------
 * 2. Caixa do sino (uma linha por aluno)
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('notice', 'comment_reply', 'comment_mention')),
  campaign_id uuid references public.campaigns(id) on delete cascade,
  is_test boolean not null default false,
  actor_id uuid references auth.users(id) on delete set null,
  title text check (title is null or char_length(title) <= 200),
  body text check (body is null or char_length(body) <= 600),
  href text check (href is null or char_length(href) <= 2048),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 4096),
  -- campaign:<id> | campaign-test:<id> | comment-reply:<comentario> | comment-mention:<comentario>
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  -- seen_at: o aluno abriu o sino com a notificacao na lista (o contador zera); read_at: abriu ou marcou
  -- como lida; clicked_at: seguiu o link.
  seen_at timestamptz,
  read_at timestamptz,
  clicked_at timestamptz,
  response text check (response is null or response in ('accepted', 'declined')),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_notice_has_campaign check ((kind = 'notice') = (campaign_id is not null)),
  constraint notifications_response_complete check ((response is null) = (responded_at is null)),
  constraint notifications_read_implies_seen check (read_at is null or seen_at is not null),
  constraint notifications_click_implies_read check (clicked_at is null or read_at is not null),
  constraint notifications_response_implies_seen check (responded_at is null or seen_at is not null)
);

-- Sem filtro parcial: o envio usa upsert(..., onConflict: "user_id,dedupe_key", ignoreDuplicates).
create unique index if not exists notifications_user_dedupe_idx on public.notifications (user_id, dedupe_key);
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc, id desc);
create index if not exists notifications_user_unseen_idx on public.notifications (user_id) where seen_at is null;
create index if not exists notifications_campaign_idx on public.notifications (campaign_id) where campaign_id is not null;
create index if not exists notifications_notice_seen_idx
  on public.notifications (seen_at)
  where kind = 'notice' and not is_test and seen_at is not null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select, insert, update, delete on public.notifications to service_role;

comment on table public.notifications is
  'Caixa do sino do aluno: notificacoes de avisos (apontam para campaigns) e automaticas (resposta e mencao em comentario). Escrita somente pelo servidor.';

/* ------------------------------------------------------------------------------------------------
 * 3. Estado do pop-up por aluno
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.campaign_deliveries (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- O aluno esta no segmento agora (recalculado pelo job enquanto o pop-up esta no ar).
  eligible boolean not null default true,
  impressions integer not null default 0 check (impressions >= 0),
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  clicked_at timestamptz,
  -- "Nao mostrar de novo".
  dismissed_at timestamptz,
  -- "Lembrar depois" (24 h, no maximo 2 vezes; o limite fica no servidor).
  snoozed_until timestamptz,
  snooze_count integer not null default 0 check (snooze_count between 0 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, user_id),
  constraint campaign_deliveries_seen_order check (first_seen_at is null or last_seen_at is not null)
);

create index if not exists campaign_deliveries_user_seen_idx
  on public.campaign_deliveries (user_id, last_seen_at desc);
create index if not exists campaign_deliveries_first_seen_idx
  on public.campaign_deliveries (first_seen_at)
  where first_seen_at is not null;

drop trigger if exists set_campaign_deliveries_updated_at on public.campaign_deliveries;
create trigger set_campaign_deliveries_updated_at
  before update on public.campaign_deliveries
  for each row execute function public.set_updated_at();

alter table public.campaign_deliveries enable row level security;
revoke all on public.campaign_deliveries from anon, authenticated;
grant select, insert, update, delete on public.campaign_deliveries to service_role;

comment on table public.campaign_deliveries is
  'Pop-up por aluno: elegivel, impressoes, visto, clicado, "Nao mostrar de novo" e "Lembrar depois". Escrita somente pelo servidor.';

/* ------------------------------------------------------------------------------------------------
 * 4. Audio dos avisos (bucket publico, so audio, ate 10 MB)
 * ---------------------------------------------------------------------------------------------- */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'communication-audio',
  'communication-audio',
  true,
  10485760,
  array['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/x-wav']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

/* ------------------------------------------------------------------------------------------------
 * 5. Leituras do servidor (RPCs so para service_role)
 * ---------------------------------------------------------------------------------------------- */

-- Comentarios aprovados de alunos por autor, em janelas de 7, 30 e 90 dias e no total (regras
-- "Comentarios" do segmento). Respostas contam como comentario. A equipe fica de fora.
create or replace function public.communication_comment_counts()
returns table (
  author_id uuid,
  comments_7d bigint,
  comments_30d bigint,
  comments_90d bigint,
  comments_total bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.author_id,
    count(*) filter (where c.created_at >= now() - interval '7 days') as comments_7d,
    count(*) filter (where c.created_at >= now() - interval '30 days') as comments_30d,
    count(*) filter (where c.created_at >= now() - interval '90 days') as comments_90d,
    count(*) as comments_total
  from public.lesson_comments c
  where c.author_id is not null
    and c.status = 'approved'
    and c.deleted_at is null
    and c.author_role = 'student'
    and not exists (select 1 from public.admin_roles staff where staff.user_id = c.author_id)
  group by c.author_id;
$$;

revoke all on function public.communication_comment_counts() from public, anon, authenticated;
grant execute on function public.communication_comment_counts() to service_role;

comment on function public.communication_comment_counts() is
  'Comentarios aprovados de alunos por autor (7, 30, 90 dias e total), sem a equipe. Usada pelo segmento dos avisos.';

-- Numeros de cada aviso. "Voltaram a estudar" = viu e estudou nos 7 dias seguintes (>= 10 min assistidos
-- ou >= 1 aula concluida somando os dias da janela, docs/17 §1.11), no fuso da escola.
create or replace function public.communication_campaign_stats(p_campaign_ids uuid[])
returns table (
  campaign_id uuid,
  recipients bigint,
  seen bigint,
  clicked bigint,
  closed_without_click bigint,
  dismissed bigint,
  snoozed bigint,
  accepted bigint,
  declined bigint,
  studied_7d bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with targets as (
    select c.id, c.kind
    from public.campaigns c
    where c.id = any(coalesce(p_campaign_ids, array[]::uuid[]))
  ),
  inbox as (
    select n.campaign_id, n.user_id, n.seen_at as seen_moment, n.clicked_at, n.response
    from public.notifications n
    join targets t on t.id = n.campaign_id and t.kind = 'inbox'
    where not n.is_test
  ),
  popup as (
    select d.campaign_id, d.user_id, d.first_seen_at as seen_moment, d.clicked_at, d.dismissed_at,
      d.snooze_count, d.eligible, d.impressions
    from public.campaign_deliveries d
    join targets t on t.id = d.campaign_id and t.kind = 'popup'
  ),
  seen_rows as (
    select campaign_id, user_id, seen_moment from inbox where seen_moment is not null
    union all
    select campaign_id, user_id, seen_moment from popup where seen_moment is not null
  ),
  studied as (
    select s.campaign_id, count(distinct s.user_id) as studied_7d
    from seen_rows s
    where exists (
      select 1
      from public.student_daily_activity a
      where a.user_id = s.user_id
        and a.day between (s.seen_moment at time zone 'America/Sao_Paulo')::date
          and (s.seen_moment at time zone 'America/Sao_Paulo')::date + 7
      having sum(a.seconds_watched) >= 600 or sum(a.lessons_completed) >= 1
    )
    group by s.campaign_id
  ),
  inbox_totals as (
    select
      campaign_id,
      count(*) as recipients,
      count(*) filter (where seen_moment is not null) as seen,
      count(*) filter (where clicked_at is not null) as clicked,
      count(*) filter (where response = 'accepted') as accepted,
      count(*) filter (where response = 'declined') as declined
    from inbox
    group by campaign_id
  ),
  popup_totals as (
    select
      campaign_id,
      count(*) filter (where eligible or impressions > 0) as recipients,
      count(*) filter (where seen_moment is not null) as seen,
      count(*) filter (where clicked_at is not null) as clicked,
      count(*) filter (where seen_moment is not null and clicked_at is null) as closed_without_click,
      count(*) filter (where dismissed_at is not null) as dismissed,
      count(*) filter (where snooze_count > 0) as snoozed
    from popup
    group by campaign_id
  )
  select
    t.id as campaign_id,
    coalesce(i.recipients, p.recipients, 0) as recipients,
    coalesce(i.seen, p.seen, 0) as seen,
    coalesce(i.clicked, p.clicked, 0) as clicked,
    coalesce(p.closed_without_click, 0) as closed_without_click,
    coalesce(p.dismissed, 0) as dismissed,
    coalesce(p.snoozed, 0) as snoozed,
    coalesce(i.accepted, 0) as accepted,
    coalesce(i.declined, 0) as declined,
    coalesce(s.studied_7d, 0) as studied_7d
  from targets t
  left join inbox_totals i on i.campaign_id = t.id
  left join popup_totals p on p.campaign_id = t.id
  left join studied s on s.campaign_id = t.id;
$$;

revoke all on function public.communication_campaign_stats(uuid[]) from public, anon, authenticated;
grant execute on function public.communication_campaign_stats(uuid[]) to service_role;

comment on function public.communication_campaign_stats(uuid[]) is
  'Numeros por aviso: para quem, viram, clicaram, fecharam sem clicar, nao mostrar de novo, lembrar depois, respostas e voltaram a estudar em 7 dias.';

-- Os quatro numeros do topo de Avisos e pop-ups no periodo [p_start, p_end).
create or replace function public.communication_overview(p_start timestamptz, p_end timestamptz)
returns table (
  active_now bigint,
  seen bigint,
  clicked bigint,
  studied_7d bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with seen_rows as (
    select n.user_id, n.seen_at as seen_moment, n.clicked_at
    from public.notifications n
    join public.campaigns c on c.id = n.campaign_id and c.deleted_at is null
    where n.kind = 'notice'
      and not n.is_test
      and n.seen_at >= p_start
      and n.seen_at < p_end
    union all
    select d.user_id, d.first_seen_at as seen_moment, d.clicked_at
    from public.campaign_deliveries d
    join public.campaigns c on c.id = d.campaign_id and c.deleted_at is null
    where d.first_seen_at >= p_start
      and d.first_seen_at < p_end
  )
  select
    (
      select count(*)
      from public.campaigns c
      where c.deleted_at is null
        and (
          (
            c.kind = 'popup'
            and c.status = 'active'
            and coalesce(c.starts_at, c.created_at) <= now()
            and (c.ends_at is null or c.ends_at > now())
          )
          or (c.kind = 'inbox' and c.status in ('scheduled', 'sending'))
        )
    ) as active_now,
    (select count(*) from seen_rows) as seen,
    (select count(*) from seen_rows where clicked_at is not null) as clicked,
    (
      select count(distinct s.user_id)
      from seen_rows s
      where exists (
        select 1
        from public.student_daily_activity a
        where a.user_id = s.user_id
          and a.day between (s.seen_moment at time zone 'America/Sao_Paulo')::date
            and (s.seen_moment at time zone 'America/Sao_Paulo')::date + 7
        having sum(a.seconds_watched) >= 600 or sum(a.lessons_completed) >= 1
      )
    ) as studied_7d;
$$;

revoke all on function public.communication_overview(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.communication_overview(timestamptz, timestamptz) to service_role;

comment on function public.communication_overview(timestamptz, timestamptz) is
  'Avisos ativos agora e, no periodo, avisos vistos, cliques e alunos que voltaram a estudar em 7 dias (sem a equipe e sem testes).';

/* ------------------------------------------------------------------------------------------------
 * 6. Retencao (docs/17 D8: 24 meses)
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.prune_communication_history()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  inbox_rows bigint;
  popup_rows bigint;
begin
  delete from public.notifications
  where created_at < now() - interval '24 months';
  get diagnostics inbox_rows = row_count;

  delete from public.campaign_deliveries
  where updated_at < now() - interval '24 months';
  get diagnostics popup_rows = row_count;

  return jsonb_build_object('notifications', inbox_rows, 'campaign_deliveries', popup_rows);
end;
$$;

comment on function public.prune_communication_history() is
  'Retencao da Comunicacao (docs/17 D8): apaga notificacoes e estados de pop-up com mais de 24 meses. Idempotente; agendada todo dia pelo pg_cron.';

revoke all on function public.prune_communication_history() from public, anon, authenticated;
grant execute on function public.prune_communication_history() to service_role;

do $$
begin
  -- 06:41 UTC (03:41 em Brasilia), depois das limpezas de jobs (06:17) e de dados pessoais (06:23).
  if not exists (select 1 from cron.job where jobname = 'bunker707-communication-prune') then
    perform cron.schedule(
      'bunker707-communication-prune',
      '41 6 * * *',
      'select public.prune_communication_history();'
    );
  end if;
end;
$$;
