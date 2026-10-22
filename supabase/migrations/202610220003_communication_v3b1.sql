-- Comunicacao v3b, fatia 1 "Pop-ups: frequencia, paginas e como fechar" (docs/25). Em quais paginas cada
-- pop-up aparece e em quais nunca, em que momento (ao abrir a pagina, ao concluir uma aula), quantas vezes
-- para cada aluno (a equipe escolhe: uma vez, ou ate N por dia, um intervalo, um total e o que faz parar),
-- em quanto tempo o "Lembrar depois" traz o pop-up de volta e como fecha (no X ou fora, ou so no X). Sem
-- limite fixo entre pop-ups (decisao do produtor, docs/24 §10.8): o sistema so garante um de cada vez na tela.
-- As 202610200001, 202610200002, 202610210001, 202610220001 e 202610220002 (ja aplicadas) nao mudam.
--
-- Regras:
-- - campaigns ganha as colunas popup_*. Os padroes sao o comportamento de hoje (so no Inicio, 3 s depois de
--   abrir, fecha no X ou fora, Lembrar depois em 24 h). popup_frequency nulo = pop-up gravado antes desta
--   migracao (ou pelo app da v3a ate o deploy): "Quantas vezes" vem de popup_repeat (once = Uma vez;
--   until_action = de novo 1 dia depois de visto, ate clicar). Nenhuma linha e reescrita. Notificacao fica
--   sempre com os padroes (campaigns_popup_only_v3b). at_start, first_login e course_completed ja passam no
--   check para a v3b-2 nao precisar tirar constraint; o app desta fatia nao grava esses tres;
-- - campaign_deliveries ganha, na mesma linha por aluno, as vezes no dia de Sao Paulo de last_seen_at (o
--   "ate N vezes por dia"). O check entra not valid e e validado na secao 4, sozinha, para a leitura da
--   tabela nao segurar os pop-ups dos alunos durante o deploy;
-- - communication_record_popup_impression grava uma abertura so se a linha do aluno e a mesma que o app leu
--   (updated_at) e o pop-up esta no ar; communication_reshow_popup (v3a, mesma assinatura e retorno) passa
--   a valer em qualquer "Quantas vezes" e, nos pop-ups que so param quando terminam, zera tambem quem clicou;
-- - nada aqui e lido pelo navegador: RLS como estava; cada funcao nova so para service_role;
-- - nada de drop, delete ou gatilho: as seis secoes passam pelo MCP do Supabase (execute_sql), na ordem do
--   arquivo, uma por chamada (ou apply_migration com o arquivo inteiro). Nao ha secao para o SQL Editor.
--
-- Verificacao manual depois de aplicar:
--   select popup_trigger, popup_frequency, popup_close, popup_snooze_minutes, count(*) from public.campaigns
--     where kind = 'popup' group by 1, 2, 3, 4; -- os pop-ups de antes: page_load, null, any, 1440
--   select conname, convalidated from pg_constraint where conname like 'campaign%v3b' order by 1;
--     -- 7 linhas, todas true
--   select proname from pg_proc where proname in ('communication_popup_pages_ok',
--     'communication_record_popup_impression') order by 1; -- 2 linhas
--   select position('popup_repeat' in pg_get_functiondef(
--     'public.communication_reshow_popup(uuid, timestamptz, integer, boolean)'::regprocedure)) = 0; -- true
--
-- Idempotente: pode ser executada mais de uma vez sem efeito colateral.

/* ------------------------------------------------------------------------------------------------
 * 1. Formato das paginas de um pop-up (os checks de campaigns usam esta funcao). MCP.
 * ---------------------------------------------------------------------------------------------- */

-- Ate 20 paginas, cada uma no formato de popup-display-model.ts (POPUP_PAGE_PATTERN, mesmo texto).
-- p_lesson_only: so paginas de aula (o momento "ao concluir uma aula").
create or replace function public.communication_popup_pages_ok(p_pages text[], p_lesson_only boolean)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(cardinality(p_pages), 0) <= 20
    and not exists (
      select 1
      from unnest(coalesce(p_pages, array[]::text[])) as p(page)
      where p.page is null
        or p.page !~ '^(any|home|purchases|saved|materials|journey|continue|profile|support|(?:content|lesson):(?:\*|[A-Za-z0-9_-]{1,240}))$'
        or (coalesce(p_lesson_only, false) and p.page !~ '^lesson:')
    );
$$;

/* ------------------------------------------------------------------------------------------------
 * 2. campaigns: onde, quando, quantas vezes, lembrar depois e como fecha. MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.campaigns
  add column if not exists popup_pages text[] not null default array['home']::text[],
  add column if not exists popup_exclude_pages text[] not null default array[]::text[],
  add column if not exists popup_trigger text not null default 'page_load',
  add column if not exists popup_delay_seconds smallint not null default 3,
  add column if not exists popup_frequency text,
  add column if not exists popup_every_minutes integer,
  add column if not exists popup_max_per_day smallint,
  add column if not exists popup_max_total smallint,
  add column if not exists popup_stop_on text,
  add column if not exists popup_close text not null default 'any',
  add column if not exists popup_snooze_minutes integer not null default 1440;

comment on column public.campaigns.popup_pages is
  'Onde o pop-up aparece: any, home, purchases, saved, materials, journey, continue, profile, support, content:* / content:<id> (pagina do produto), lesson:* / lesson:<id> (pagina da aula). Uma formacao vale tambem para os cursos dela (o app expande). Padrao {home} = antes da v3b.';
comment on column public.campaigns.popup_exclude_pages is
  'Nunca nestas paginas: o mesmo formato, sem any. A excecao vence.';
comment on column public.campaigns.popup_trigger is
  'Quando aparece: page_load (ao abrir a pagina, depois de popup_delay_seconds) ou lesson_completed (ao concluir uma aula; paginas so lesson:*). at_start, first_login e course_completed ficam para a v3b-2.';
comment on column public.campaigns.popup_delay_seconds is 'Segundos depois de abrir a pagina (ou de concluir a aula) ate abrir: 0 a 600.';
comment on column public.campaigns.popup_frequency is
  'Quantas vezes: once (Uma vez: para quando o aluno fecha, clica ou escolhe Nao mostrar de novo) ou repeat (Mais de uma vez, com popup_max_per_day, popup_every_minutes, popup_max_total e popup_stop_on). Nulo = pop-up de antes da v3b: lido de popup_repeat.';
comment on column public.campaigns.popup_every_minutes is 'Mais de uma vez: pelo menos este tempo entre uma vez e outra (1 minuto a 90 dias). Nulo = sem intervalo.';
comment on column public.campaigns.popup_max_per_day is 'Mais de uma vez: ate N vezes por dia de Sao Paulo (1 a 100). Nulo = sem limite por dia.';
comment on column public.campaigns.popup_max_total is 'Mais de uma vez: no maximo N vezes no total desde o ultimo "mostrar de novo" (2 a 1000; Lembrar depois nao gasta vez). Nulo = sem total.';
comment on column public.campaigns.popup_stop_on is 'Mais de uma vez: para quando o aluno clica no botao (click) ou so quando o pop-up termina (never). "Nao mostrar de novo" sempre vale.';
comment on column public.campaigns.popup_close is 'Como fechar: any (X, Esc ou clicando fora) ou x_only (X e Esc; clicar fora nao fecha).';
comment on column public.campaigns.popup_snooze_minutes is 'Lembrar depois: em quantos minutos o pop-up volta (5 a 10080, padrao 1440 = 24 h); continua no maximo 2 vezes.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_popup_pages_v3b') then
    alter table public.campaigns add constraint campaigns_popup_pages_v3b check (
      cardinality(popup_pages) between 1 and 20
      and cardinality(popup_exclude_pages) <= 20
      and not ('any' = any(popup_exclude_pages))
      and public.communication_popup_pages_ok(popup_pages, popup_trigger in ('lesson_completed', 'course_completed'))
      and public.communication_popup_pages_ok(popup_exclude_pages, false)
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'campaigns_popup_trigger_v3b') then
    alter table public.campaigns add constraint campaigns_popup_trigger_v3b check (
      popup_trigger in ('page_load', 'lesson_completed', 'at_start', 'first_login', 'course_completed')
      and popup_delay_seconds between 0 and 600
      and (popup_trigger <> 'at_start' or starts_at is not null)
    );
  end if;

  -- popup_repeat (v1) fica coerente: once so com Uma vez; repeat com until_action (a v3a e as abas abertas
  -- antes do deploy leem esta coluna).
  if not exists (select 1 from pg_constraint where conname = 'campaigns_popup_frequency_v3b') then
    alter table public.campaigns add constraint campaigns_popup_frequency_v3b check (
      (
        popup_frequency is null and popup_every_minutes is null and popup_max_per_day is null
        and popup_max_total is null and popup_stop_on is null
      )
      or (
        popup_frequency = 'once' and popup_repeat = 'once' and popup_every_minutes is null
        and popup_max_per_day is null and popup_max_total is null and popup_stop_on is null
      )
      or (
        popup_frequency = 'repeat' and popup_repeat = 'until_action'
        and (popup_every_minutes is null or popup_every_minutes between 1 and 129600)
        and (popup_max_per_day is null or popup_max_per_day between 1 and 100)
        and (popup_max_total is null or popup_max_total between 2 and 1000)
        and popup_stop_on is not null and popup_stop_on in ('click', 'never')
      )
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'campaigns_popup_close_v3b') then
    alter table public.campaigns add constraint campaigns_popup_close_v3b check (popup_close in ('any', 'x_only'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'campaigns_popup_snooze_v3b') then
    alter table public.campaigns add constraint campaigns_popup_snooze_v3b check (popup_snooze_minutes between 5 and 10080);
  end if;

  -- Notificacao (e passo de fluxo) fica sempre com os padroes: nada de pop-up vaza para o sino.
  if not exists (select 1 from pg_constraint where conname = 'campaigns_popup_only_v3b') then
    alter table public.campaigns add constraint campaigns_popup_only_v3b check (
      kind = 'popup' or (
        popup_pages = array['home']::text[] and popup_exclude_pages = array[]::text[]
        and popup_trigger = 'page_load' and popup_delay_seconds = 3
        and popup_frequency is null and popup_every_minutes is null and popup_max_per_day is null
        and popup_max_total is null and popup_stop_on is null and popup_close = 'any'
        and popup_snooze_minutes = 1440
      )
    );
  end if;
end;
$$;

/* ------------------------------------------------------------------------------------------------
 * 3. campaign_deliveries: vezes no dia de Sao Paulo. MCP. O check entra not valid (sem ler a tabela).
 * ---------------------------------------------------------------------------------------------- */

alter table public.campaign_deliveries
  add column if not exists day_impressions smallint not null default 0;

comment on column public.campaign_deliveries.day_impressions is
  'Vezes que o pop-up abriu no dia de Sao Paulo de last_seen_at (so vale quando last_seen_at e de hoje e depois do ultimo "mostrar de novo"; linha vista hoje antes da v3b conta 1).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_deliveries_popup_v3b') then
    alter table public.campaign_deliveries add constraint campaign_deliveries_popup_v3b check (
      day_impressions between 0 and 1000
    ) not valid;
  end if;
end;
$$;

/* ------------------------------------------------------------------------------------------------
 * 4. Valida o check da secao 3 (le a tabela sem bloquear leituras e escritas; numa constraint ja valida
 *    nao faz nada). MCP, numa chamada so dela.
 * ---------------------------------------------------------------------------------------------- */

alter table public.campaign_deliveries validate constraint campaign_deliveries_popup_v3b;

/* ------------------------------------------------------------------------------------------------
 * 5. Funcoes (so service_role; security invoker). MCP.
 * ---------------------------------------------------------------------------------------------- */

-- 5.1 Uma abertura do pop-up. O app (popup-display-model.ts decideShow) ja conferiu pagina, momento e
--     quantas vezes sobre a linha que leu; aqui: a linha ainda e a mesma (updated_at igual ao lido, entao
--     nenhum clique, "Nao mostrar de novo", "Lembrar depois", recalculo, "mostrar de novo" ou outra abertura
--     passou no meio), elegivel, e o pop-up ainda no ar. O dia vem do app (p_day_start, UTC-3 fixo como o
--     resto do sistema). Devolve {"impressions", "day_impressions"} novos, ou null quando recusa (nada gravado).
create or replace function public.communication_record_popup_impression(
  p_user_id uuid,
  p_campaign_id uuid,
  p_expected_updated_at timestamptz,
  p_now timestamptz,
  p_day_start timestamptz
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_impressions integer := null;
  v_day integer := null;
begin
  update public.campaign_deliveries d set
    impressions = d.impressions + 1,
    day_impressions = case
      when d.last_seen_at is not null and d.last_seen_at >= p_day_start
        and (d.reshown_at is null or d.last_seen_at > d.reshown_at)
        then least(greatest(d.day_impressions, 1) + 1, 1000)
      else 1
    end,
    first_seen_at = coalesce(d.first_seen_at, p_now),
    last_seen_at = p_now
  where d.campaign_id = p_campaign_id
    and d.user_id = p_user_id
    and d.updated_at = p_expected_updated_at
    and d.eligible
    and d.dismissed_at is null
    and exists (
      select 1
      from public.campaigns c
      where c.id = p_campaign_id
        and c.kind = 'popup'
        and c.status = 'active'
        and c.deleted_at is null
        and (c.starts_at is null or c.starts_at <= p_now)
        and (c.ends_at is null or c.ends_at > p_now)
    )
  returning d.impressions, d.day_impressions into v_impressions, v_day;

  if v_impressions is null then
    return null;
  end if;

  return jsonb_build_object('impressions', v_impressions, 'day_impressions', v_day);
end;
$$;

-- 5.2 (v3a, mesma assinatura e mesmo retorno) "Mostrar de novo para quem ja viu", agora em qualquer
--     "Quantas vezes": sai a trava popup_repeat = 'once' da v3a. O resto e o corpo final da 202610220001:
--     quem ainda esta no segmento, viu mais vezes do que adiou desde o ultimo "mostrar de novo" e nao
--     escolheu "Nao mostrar de novo" volta a contar como novo (vezes, vezes no dia e intervalo contam so o
--     que vier depois de reshown_at); Lembrar depois volta a valer 2 vezes. Quem clicou fica de fora, menos
--     quando o pop-up so para quando termina (popup_stop_on = 'never'): ali o clique nunca parou ninguem.
--     p_apply false = so conta; p_max = teto sem publish_large (500).
create or replace function public.communication_reshow_popup(
  p_campaign_id uuid, p_now timestamptz, p_max integer, p_apply boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
  v_stop text;
begin
  if p_apply then
    select c.popup_stop_on into v_stop
    from public.campaigns c
    where c.id = p_campaign_id and c.kind = 'popup' and c.status in ('active', 'paused') and c.deleted_at is null
    for update;
  else
    select c.popup_stop_on into v_stop
    from public.campaigns c
    where c.id = p_campaign_id and c.kind = 'popup' and c.status in ('active', 'paused') and c.deleted_at is null;
  end if;

  if not found then
    return null;
  end if;

  select count(*) into v_count
  from public.campaign_deliveries d
  where d.campaign_id = p_campaign_id
    and d.eligible
    and (d.clicked_at is null or coalesce(v_stop, 'click') = 'never')
    and d.dismissed_at is null
    and d.impressions - d.impressions_before_reshow > d.snooze_count - d.snoozes_before_reshow;

  if not p_apply then
    return jsonb_build_object('count', v_count, 'reshown', 0, 'refused', false);
  end if;

  if p_max is not null and v_count > p_max then
    return jsonb_build_object('count', v_count, 'reshown', 0, 'refused', true);
  end if;

  update public.campaign_deliveries d set
    reshown_at = p_now,
    impressions_before_reshow = d.impressions,
    snooze_count = least(d.snooze_count, 1),
    snoozes_before_reshow = least(d.snooze_count, 1),
    snoozed_until = null
  where d.campaign_id = p_campaign_id
    and d.eligible
    and (d.clicked_at is null or coalesce(v_stop, 'click') = 'never')
    and d.dismissed_at is null
    and d.impressions - d.impressions_before_reshow > d.snooze_count - d.snoozes_before_reshow;
  get diagnostics v_count = row_count;

  return jsonb_build_object('count', v_count, 'reshown', v_count, 'refused', false);
end;
$$;

/* ------------------------------------------------------------------------------------------------
 * 6. Permissoes das funcoes (assinatura exata) e descricoes. MCP. A 5.2 ja tinha as suas (create or
 *    replace mantem); repetidas para nenhuma funcao ficar aberta se esta secao rodar num banco novo.
 * ---------------------------------------------------------------------------------------------- */

revoke all on function public.communication_popup_pages_ok(text[], boolean) from public, anon, authenticated;
grant execute on function public.communication_popup_pages_ok(text[], boolean) to service_role;
comment on function public.communication_popup_pages_ok(text[], boolean) is
  'Formato das paginas de um pop-up (checks de campaigns): ate 20, cada uma do catalogo; p_lesson_only so paginas de aula.';

revoke all on function public.communication_record_popup_impression(uuid, uuid, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.communication_record_popup_impression(uuid, uuid, timestamptz, timestamptz, timestamptz)
  to service_role;
comment on function public.communication_record_popup_impression(uuid, uuid, timestamptz, timestamptz, timestamptz) is
  'Uma abertura do pop-up: grava so se a linha do aluno e a lida (updated_at), elegivel, sem "Nao mostrar de novo" e com o pop-up no ar; devolve {impressions, day_impressions} ou null.';

revoke all on function public.communication_reshow_popup(uuid, timestamptz, integer, boolean) from public, anon, authenticated;
grant execute on function public.communication_reshow_popup(uuid, timestamptz, integer, boolean) to service_role;
comment on function public.communication_reshow_popup(uuid, timestamptz, integer, boolean) is
  'Mostrar de novo para quem ja viu (qualquer Quantas vezes): quem esta no segmento, viu mais vezes do que adiou e nao escolheu Nao mostrar de novo volta a contar como novo; quem clicou so quando o pop-up para so ao terminar (p_apply false so conta; acima de p_max, recusa).';
