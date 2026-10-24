-- Comunicacao v3b-2 "Pop-ups: hora marcada ao vivo, primeiro acesso, curso concluido, relatorio e players de
-- fora" (docs/29). As migracoes ate a 202610250001 (ja aplicadas) nao mudam.
--
-- Regras:
-- - campaigns ganha popup_access_products: no momento "No primeiro acesso" (popup_trigger = 'first_login'),
--   os produtos cujo acesso ganho depois do comeco do pop-up conta como primeiro acesso; vazio = a primeira
--   vez na area. Fora desse momento e nas notificacoes, sempre vazio (campaigns_popup_access_v3b2, que confere
--   id por id com communication_popup_products_ok). Quem e "aluno novo" e decidido pelo app no recalculo do
--   segmento (dispatch.ts), nunca aqui. first_login e course_completed ja passam no check da 202610220003
--   (course_completed so com paginas de aula); at_start continua sem uso (a hora marcada ao vivo e o "Comeca"
--   de sempre);
-- - campaign_deliveries ganha first_access_at: o recalculo do "No primeiro acesso" marca a linha que ele
--   habilitou por o aluno ser candidato. So a linha marcada continua elegivel depois de o aluno entrar na
--   area; uma linha habilitada por um app sem esta regra (que le first_login como page_load) sai no recalculo
--   seguinte. Nulo nos outros momentos;
-- - student_events ganha um indice parcial so das linhas dos avisos (entity_type = 'campaign'): o relatorio
--   do pop-up le por (entity_id, event_type). O supabase db push roda cada arquivo numa transacao, entao o
--   indice nao e concurrently: enquanto ele e montado, as escritas em student_events esperam (2,3 s para
--   3,3 milhoes de linhas no teste local). Conte as linhas antes (consulta abaixo);
-- - communication_popup_report devolve os numeros do relatorio de um pop-up: das linhas por aluno
--   (campaign_deliveries, exatas) e do historico (student_events, cada abertura ate 100 por aluno e dia).
--   Conta so aluno com linha vista no pop-up, nunca mais vezes do que a linha diz, nunca a equipe; pagina,
--   momento e jeito de fechar conferidos com as mesmas listas do app (o resto vira other ou closed_unknown).
--   security invoker, so service_role;
-- - a politica "Students can create own events" (202606150003) passa a recusar as linhas dos avisos
--   (entity_type = 'campaign'): elas so saem pelo servidor (service role). alter policy, sem drop;
-- - nada de drop, delete, gatilho ou create policy: cinco secoes, cada uma pelo MCP do Supabase (execute_sql),
--   na ordem do arquivo, uma por chamada (ou apply_migration com o arquivo inteiro). A 5 vai sozinha; se o MCP
--   travar nela, pelo SQL Editor.
--
-- Antes de aplicar (nuvem de teste e Hetzner):
--   select count(*) from public.student_events; -- ate uns 10 milhoes, o indice leva segundos
--
-- Verificacao manual depois de aplicar:
--   select conname, convalidated from pg_constraint where conname = 'campaigns_popup_access_v3b2';
--     -- 1 linha, true
--   select proname from pg_proc where proname = 'communication_popup_products_ok'; -- 1 linha
--   select count(*) from public.campaigns where cardinality(popup_access_products) > 0; -- 0 logo depois
--   select count(*) from public.campaign_deliveries where first_access_at is not null; -- 0 logo depois
--   select indexname from pg_indexes where schemaname = 'public' and indexname = 'student_events_campaign_idx';
--     -- 1 linha
--   select has_function_privilege('authenticated', 'public.communication_popup_report(uuid)', 'execute'),
--     has_function_privilege('service_role', 'public.communication_popup_report(uuid)', 'execute');
--     -- false, true
--   select metric, total, students from public.communication_popup_report(gen_random_uuid()) order by 1;
--     -- 3 linhas: max 0 0, median 0 0, viewers 0 0
--   select position('campaign' in with_check) > 0 from pg_policies
--     where schemaname = 'public' and tablename = 'student_events' and policyname = 'Students can create own events';
--     -- true
--
-- Idempotente: pode ser executada mais de uma vez sem efeito colateral.

/* ------------------------------------------------------------------------------------------------
 * 1. campaigns: os produtos do "No primeiro acesso" (e a funcao que confere cada id). MCP.
 * ---------------------------------------------------------------------------------------------- */

-- Ate 20 ids, cada um no formato de POPUP_PRODUCT_ID (popup-display-model.ts, mesmo texto), sem nulo nem
-- vazio, conferidos um por um (um array_to_string aceitaria {''} e {'a,b'}).
create or replace function public.communication_popup_products_ok(p_products text[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(cardinality(p_products), 0) <= 20
    and not exists (
      select 1
      from unnest(coalesce(p_products, array[]::text[])) as p(id)
      where p.id is null
        or p.id !~ '^[A-Za-z0-9_-]{1,240}$'
    );
$$;

revoke all on function public.communication_popup_products_ok(text[]) from public, anon, authenticated;
grant execute on function public.communication_popup_products_ok(text[]) to service_role;
comment on function public.communication_popup_products_ok(text[]) is
  'Produtos do "No primeiro acesso" (check de campaigns): ate 20 ids de content_items, cada um conferido.';

alter table public.campaigns
  add column if not exists popup_access_products text[] not null default array[]::text[];

comment on column public.campaigns.popup_access_products is
  'No primeiro acesso (popup_trigger = first_login): os produtos (ids de content_items) cujo acesso ganho depois do comeco do pop-up conta como primeiro acesso; o acesso a plataforma inteira vale para todos. Vazio = a primeira vez na area. Fora desse momento, sempre vazio.';
comment on column public.campaigns.popup_trigger is
  'Quando aparece: page_load (ao abrir a pagina; com starts_at, tambem na hora marcada para quem ja esta numa das paginas), lesson_completed (ao concluir uma aula), first_login (no primeiro acesso) ou course_completed (ao concluir um curso). lesson_completed e course_completed so com paginas lesson:*. at_start nao e usado.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_popup_access_v3b2') then
    alter table public.campaigns add constraint campaigns_popup_access_v3b2 check (
      public.communication_popup_products_ok(popup_access_products)
      and (cardinality(popup_access_products) = 0 or (kind = 'popup' and popup_trigger = 'first_login'))
    );
  end if;
end;
$$;

/* ------------------------------------------------------------------------------------------------
 * 2. campaign_deliveries: a marca do "No primeiro acesso". MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.campaign_deliveries
  add column if not exists first_access_at timestamptz;

comment on column public.campaign_deliveries.first_access_at is
  'No primeiro acesso: quando o recalculo do pop-up (dispatch.ts) habilitou a linha por o aluno ser candidato. So a linha marcada continua elegivel depois de o aluno entrar na area. Nulo nos outros momentos e nas notificacoes.';

/* ------------------------------------------------------------------------------------------------
 * 3. student_events: indice so das linhas dos avisos (o relatorio do pop-up). MCP, numa chamada so dela.
 * ---------------------------------------------------------------------------------------------- */

create index if not exists student_events_campaign_idx
  on public.student_events (entity_id, event_type)
  where entity_type = 'campaign';

/* ------------------------------------------------------------------------------------------------
 * 4. Relatorio do pop-up (so service_role; security invoker). MCP.
 * ---------------------------------------------------------------------------------------------- */

-- Linhas (metric, item, total, students):
--   opened / ''                      aberturas do historico (total) e alunos (students)
--   opened_kind / home|content|...   aberturas por tipo de pagina (other = chave fora da lista)
--   opened_product / <id>            aberturas na pagina do produto ou nas aulas dele, por produto
--   opened_trigger / page_load|...   aberturas por momento (other = valor fora da lista; sem valor = page_load)
--   outcome / clicked|dismissed|snoozed|closed_x|closed_outside|closed_esc|closed_page|closed_unknown
--   outcomes / ''                    todos os resultados
--   times / 1|2|3-5|6-10|11+         alunos por faixa de vezes (linhas por aluno; total = vezes)
--   viewers / ''                     vezes (soma das linhas) e alunos que viram
--   max / '' e median / ''           o maior e a mediana das vezes por aluno
-- Do historico, cada total por aluno e item nunca passa das vezes da linha dele (um evento gravado antes
-- da secao 5 nao infla nada); sem linha vista, nao conta. Sem pagina = home; sem momento = page_load; sem
-- jeito de fechar (antes da v3b-1) = closed_unknown.
-- Como conta (medido no integrador, docs/29 §7): uma leitura do historico pelo indice parcial, cada chave do
-- jsonb lida uma vez por linha (offset 0) e uma passada por aluno, sem juntar tabelas grandes (a linha por aluno
-- entra no mesmo agrupamento por union all). A pagina confere com a mesma lista de POPUP_PAGE_KEY
-- (popup-display-model.ts) sem a repeticao {1,240} da expressao regular, que custava ~10 us por linha: as paginas
-- fixas por igualdade e o id do produto pelo mesmo conjunto de caracteres, com o teto de 240 pelo tamanho.
create or replace function public.communication_popup_report(p_campaign_id uuid)
returns table (metric text, item text, total bigint, students bigint)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with viewers as (
    select d.user_id, d.impressions::bigint as impressions
    from public.campaign_deliveries d
    where d.campaign_id = p_campaign_id
      and d.impressions > 0
      and not exists (select 1 from public.admin_roles a where a.user_id = d.user_id)
  ),
  events as materialized (
    select r.user_id,
      case when r.event_type = 'message_impressed' then
        case
          when r.page is null then 'home'
          when r.page in ('home', 'purchases', 'saved', 'materials', 'journey', 'continue', 'profile', 'support') then r.page
          when r.page ~ '^(?:content|lesson):[A-Za-z0-9_-]+$' and char_length(r.page) - position(':' in r.page) <= 240 then r.page
          else 'other'
        end
      end as page_key,
      case when r.event_type = 'message_impressed' then
        case
          when r.moment is null then 'page_load'
          when r.moment in ('page_load', 'lesson_completed', 'first_login', 'course_completed') then r.moment
          else 'other'
        end
      end as moment,
      case r.event_type
        when 'message_clicked' then 'clicked'
        when 'message_dismissed' then 'dismissed'
        when 'message_snoozed' then 'snoozed'
        when 'message_closed' then 'closed_' || case when r.via in ('x', 'outside', 'esc', 'page') then r.via else 'unknown' end
      end as outcome
    from (
      select e.user_id, e.event_type, e.metadata ->> 'page' as page, e.metadata ->> 'trigger' as moment, e.metadata ->> 'via' as via
      from public.student_events e
      where e.entity_type = 'campaign'
        and e.entity_id = p_campaign_id::text
        and e.event_type in ('message_impressed', 'message_clicked', 'message_closed', 'message_dismissed', 'message_snoozed')
      offset 0
    ) r
  ),
  per_user as (
    select x.user_id,
      max(x.impressions) as impressions,
      count(*) filter (where x.kind is not null) as opened,
      count(*) filter (where x.kind = 'home') as kind_home,
      count(*) filter (where x.kind = 'purchases') as kind_purchases,
      count(*) filter (where x.kind = 'saved') as kind_saved,
      count(*) filter (where x.kind = 'materials') as kind_materials,
      count(*) filter (where x.kind = 'journey') as kind_journey,
      count(*) filter (where x.kind = 'continue') as kind_continue,
      count(*) filter (where x.kind = 'profile') as kind_profile,
      count(*) filter (where x.kind = 'support') as kind_support,
      count(*) filter (where x.kind = 'content') as kind_content,
      count(*) filter (where x.kind = 'lesson') as kind_lesson,
      count(*) filter (where x.kind = 'other') as kind_other,
      count(*) filter (where x.moment = 'page_load') as moment_page_load,
      count(*) filter (where x.moment = 'lesson_completed') as moment_lesson_completed,
      count(*) filter (where x.moment = 'first_login') as moment_first_login,
      count(*) filter (where x.moment = 'course_completed') as moment_course_completed,
      count(*) filter (where x.moment = 'other') as moment_other,
      count(*) filter (where x.outcome = 'clicked') as outcome_clicked,
      count(*) filter (where x.outcome = 'dismissed') as outcome_dismissed,
      count(*) filter (where x.outcome = 'snoozed') as outcome_snoozed,
      count(*) filter (where x.outcome = 'closed_x') as outcome_closed_x,
      count(*) filter (where x.outcome = 'closed_outside') as outcome_closed_outside,
      count(*) filter (where x.outcome = 'closed_esc') as outcome_closed_esc,
      count(*) filter (where x.outcome = 'closed_page') as outcome_closed_page,
      count(*) filter (where x.outcome = 'closed_unknown') as outcome_closed_unknown,
      count(*) filter (where x.outcome is not null) as outcomes
    from (
      select v.user_id, v.impressions, null::text as kind, null::text as moment, null::text as outcome from viewers v
      union all
      select ev.user_id, null::bigint, split_part(ev.page_key, ':', 1), ev.moment, ev.outcome from events ev
    ) x
    group by x.user_id
  ),
  totals as (
    select
      sum(least(p.opened, p.impressions)) as opened_total, count(*) filter (where p.opened > 0) as opened_students,
      sum(least(p.kind_home, p.impressions)) as kind_home_total, count(*) filter (where p.kind_home > 0) as kind_home_students,
      sum(least(p.kind_purchases, p.impressions)) as kind_purchases_total, count(*) filter (where p.kind_purchases > 0) as kind_purchases_students,
      sum(least(p.kind_saved, p.impressions)) as kind_saved_total, count(*) filter (where p.kind_saved > 0) as kind_saved_students,
      sum(least(p.kind_materials, p.impressions)) as kind_materials_total, count(*) filter (where p.kind_materials > 0) as kind_materials_students,
      sum(least(p.kind_journey, p.impressions)) as kind_journey_total, count(*) filter (where p.kind_journey > 0) as kind_journey_students,
      sum(least(p.kind_continue, p.impressions)) as kind_continue_total, count(*) filter (where p.kind_continue > 0) as kind_continue_students,
      sum(least(p.kind_profile, p.impressions)) as kind_profile_total, count(*) filter (where p.kind_profile > 0) as kind_profile_students,
      sum(least(p.kind_support, p.impressions)) as kind_support_total, count(*) filter (where p.kind_support > 0) as kind_support_students,
      sum(least(p.kind_content, p.impressions)) as kind_content_total, count(*) filter (where p.kind_content > 0) as kind_content_students,
      sum(least(p.kind_lesson, p.impressions)) as kind_lesson_total, count(*) filter (where p.kind_lesson > 0) as kind_lesson_students,
      sum(least(p.kind_other, p.impressions)) as kind_other_total, count(*) filter (where p.kind_other > 0) as kind_other_students,
      sum(least(p.moment_page_load, p.impressions)) as moment_page_load_total, count(*) filter (where p.moment_page_load > 0) as moment_page_load_students,
      sum(least(p.moment_lesson_completed, p.impressions)) as moment_lesson_completed_total, count(*) filter (where p.moment_lesson_completed > 0) as moment_lesson_completed_students,
      sum(least(p.moment_first_login, p.impressions)) as moment_first_login_total, count(*) filter (where p.moment_first_login > 0) as moment_first_login_students,
      sum(least(p.moment_course_completed, p.impressions)) as moment_course_completed_total, count(*) filter (where p.moment_course_completed > 0) as moment_course_completed_students,
      sum(least(p.moment_other, p.impressions)) as moment_other_total, count(*) filter (where p.moment_other > 0) as moment_other_students,
      sum(least(p.outcome_clicked, p.impressions)) as outcome_clicked_total, count(*) filter (where p.outcome_clicked > 0) as outcome_clicked_students,
      sum(least(p.outcome_dismissed, p.impressions)) as outcome_dismissed_total, count(*) filter (where p.outcome_dismissed > 0) as outcome_dismissed_students,
      sum(least(p.outcome_snoozed, p.impressions)) as outcome_snoozed_total, count(*) filter (where p.outcome_snoozed > 0) as outcome_snoozed_students,
      sum(least(p.outcome_closed_x, p.impressions)) as outcome_closed_x_total, count(*) filter (where p.outcome_closed_x > 0) as outcome_closed_x_students,
      sum(least(p.outcome_closed_outside, p.impressions)) as outcome_closed_outside_total, count(*) filter (where p.outcome_closed_outside > 0) as outcome_closed_outside_students,
      sum(least(p.outcome_closed_esc, p.impressions)) as outcome_closed_esc_total, count(*) filter (where p.outcome_closed_esc > 0) as outcome_closed_esc_students,
      sum(least(p.outcome_closed_page, p.impressions)) as outcome_closed_page_total, count(*) filter (where p.outcome_closed_page > 0) as outcome_closed_page_students,
      sum(least(p.outcome_closed_unknown, p.impressions)) as outcome_closed_unknown_total, count(*) filter (where p.outcome_closed_unknown > 0) as outcome_closed_unknown_students,
      sum(least(p.outcomes, p.impressions)) as outcomes_total, count(*) filter (where p.outcomes > 0) as outcomes_students
    from per_user p
    where p.impressions is not null
  ),
  per_product as (
    select y.product, y.n, max(y.impressions) over (partition by y.user_id) as impressions
    from (
      select x.user_id, x.product, count(x.product) as n, max(x.impressions) as impressions
      from (
        select v.user_id, v.impressions, null::text as product from viewers v
        union all
        select ev.user_id, null::bigint, split_part(ev.page_key, ':', 2) from events ev where ev.page_key ~ '^(content|lesson):'
      ) x
      group by x.user_id, x.product
    ) y
  )
  select s.metric, s.item, s.total::bigint, s.students
  from totals t
  cross join lateral (
    values
      ('opened', '', t.opened_total, t.opened_students),
      ('opened_kind', 'home', t.kind_home_total, t.kind_home_students),
      ('opened_kind', 'purchases', t.kind_purchases_total, t.kind_purchases_students),
      ('opened_kind', 'saved', t.kind_saved_total, t.kind_saved_students),
      ('opened_kind', 'materials', t.kind_materials_total, t.kind_materials_students),
      ('opened_kind', 'journey', t.kind_journey_total, t.kind_journey_students),
      ('opened_kind', 'continue', t.kind_continue_total, t.kind_continue_students),
      ('opened_kind', 'profile', t.kind_profile_total, t.kind_profile_students),
      ('opened_kind', 'support', t.kind_support_total, t.kind_support_students),
      ('opened_kind', 'content', t.kind_content_total, t.kind_content_students),
      ('opened_kind', 'lesson', t.kind_lesson_total, t.kind_lesson_students),
      ('opened_kind', 'other', t.kind_other_total, t.kind_other_students),
      ('opened_trigger', 'page_load', t.moment_page_load_total, t.moment_page_load_students),
      ('opened_trigger', 'lesson_completed', t.moment_lesson_completed_total, t.moment_lesson_completed_students),
      ('opened_trigger', 'first_login', t.moment_first_login_total, t.moment_first_login_students),
      ('opened_trigger', 'course_completed', t.moment_course_completed_total, t.moment_course_completed_students),
      ('opened_trigger', 'other', t.moment_other_total, t.moment_other_students),
      ('outcome', 'clicked', t.outcome_clicked_total, t.outcome_clicked_students),
      ('outcome', 'dismissed', t.outcome_dismissed_total, t.outcome_dismissed_students),
      ('outcome', 'snoozed', t.outcome_snoozed_total, t.outcome_snoozed_students),
      ('outcome', 'closed_x', t.outcome_closed_x_total, t.outcome_closed_x_students),
      ('outcome', 'closed_outside', t.outcome_closed_outside_total, t.outcome_closed_outside_students),
      ('outcome', 'closed_esc', t.outcome_closed_esc_total, t.outcome_closed_esc_students),
      ('outcome', 'closed_page', t.outcome_closed_page_total, t.outcome_closed_page_students),
      ('outcome', 'closed_unknown', t.outcome_closed_unknown_total, t.outcome_closed_unknown_students),
      ('outcomes', '', t.outcomes_total, t.outcomes_students)
  ) as s(metric, item, total, students)
  where s.students > 0
  union all
  select 'opened_product'::text, q.product, sum(least(q.n, q.impressions))::bigint, count(*)::bigint
  from per_product q
  where q.product is not null and q.impressions is not null
  group by q.product
  union all
  select 'times'::text, b.bucket, sum(b.impressions)::bigint, count(*)::bigint
  from (
    select v.impressions,
      case
        when v.impressions = 1 then '1'
        when v.impressions = 2 then '2'
        when v.impressions <= 5 then '3-5'
        when v.impressions <= 10 then '6-10'
        else '11+'
      end as bucket
    from viewers v
  ) b
  group by b.bucket
  union all
  select 'viewers'::text, ''::text, coalesce(sum(v.impressions), 0)::bigint, count(*)::bigint from viewers v
  union all
  select 'max'::text, ''::text, coalesce(max(v.impressions), 0)::bigint, count(*)::bigint from viewers v
  union all
  select 'median'::text, ''::text, coalesce(percentile_disc(0.5) within group (order by v.impressions), 0)::bigint, count(*)::bigint
  from viewers v;
$$;

revoke all on function public.communication_popup_report(uuid) from public, anon, authenticated;
grant execute on function public.communication_popup_report(uuid) to service_role;

/* ------------------------------------------------------------------------------------------------
 * 5. student_events: o aluno nao grava linhas de avisos no proprio historico. MCP, sozinha (ou SQL Editor).
 * ---------------------------------------------------------------------------------------------- */

-- Mesma politica, mesmo papel; so a condicao muda (o navegador grava apenas entity_type = 'auth').
alter policy "Students can create own events" on public.student_events
  with check (auth.uid() = user_id and coalesce(entity_type, '') <> 'campaign');
