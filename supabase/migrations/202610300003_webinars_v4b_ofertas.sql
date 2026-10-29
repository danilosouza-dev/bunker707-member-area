-- Webinarios v4b, a Oferta A/B/C/D com a conversao e a receita, o follow-up e a Simulacao completa (docs/30 §1.6, §2.2,
-- §2.4, §3.3 a §3.6, §4.2, §4.3, §5.1, §6.6, §8.6 e §11, fase 4b). A 202610300002 nao muda (nenhuma migracao da fase 4
-- foi aplicada ainda; docs/21 §9.10); este arquivo so acrescenta.
--
-- Regras:
-- - webhook_events ganha amount_cents e currency (M8): o adaptador de cada plataforma le o valor da venda do payload e
--   o webhook grava junto do evento; a regra de acesso (process-sale.ts) nao muda nem le estas colunas;
-- - webinar_offers (uma Oferta ativa por webinario, com o produto da escola que a venda libera, "Quando aparece" num
--   minuto do video / pelo botao / nunca, "Some em" em minutos ou ate o fim, o prazo real em minutos depois de aparecer
--   e a atribuicao em dias, padrao 7, M7) e webinar_offer_variants (A, B, C e D: titulo, selo, preco de/por em texto,
--   cupom, link de checkout https, imagem https, peso; "Divisao" igual = pesos iguais);
-- - webinar_offer_displays: o que cada sessao mostrou de verdade (a janela em ms do video, o prazo, quem mostrou ou
--   escondeu e a foto das variantes no momento, docs/30 §8.6: "o relatorio guarda o que foi mostrado"); uma linha por
--   sessao e oferta;
-- - webinar_offer_clicks: um clique do aluno (a variante dele, o offset, o click_token unico que vai no link do
--   checkout como ?b7=) e a conversao ligada ao sale_grants da mesma conta e do mesmo produto criado entre o clique e
--   clique + attribution_days (M7), pela funcao webinar_offer_conversions (o job do tick), nunca pelo clique;
-- - webinar_offer_variant(user, oferta): a variante deterministica do aluno (M7), md5(user_id || offer_id), os 8
--   primeiros digitos hexadecimais como inteiro, modulo a soma dos pesos das variantes ligadas, na ordem A, B, C, D.
--   O app repete a mesma conta (offer-model.ts, offerVariantFor) e "viram", "clicaram" e "compraram" caem sempre na
--   mesma variante;
-- - webinar_follow_up_facts(webinarios): por aluno e webinario, vaga, compareceu, viu o replay, viu a oferta, saiu antes
--   da oferta, clicou e comprou (as regras de follow-up da Comunicacao, docs/30 §1.6); nunca le a Simulacao;
-- - webinar_sessions ganha simulated_count_rule, simulated_joins, simulated_sale_notices, simulation_summary (§4.3) e
--   simulation_seed (a semente do contador e das entradas, D6: todos veem o mesmo numero, so o servidor a conhece); a
--   sessao `live` nunca tem regra simulada (check webinar_sessions_simulation_not_live_v4);
-- - webinar_report e webinar_panel ganham as linhas `offer*` (reais) e o bloco `sim_*` separado (o contador, as
--   entradas e os avisos de venda so de simulation_summary, congelado no fim), mesmas assinaturas, corpo completo;
-- - tabelas novas so do service_role (RLS, revoke de anon e authenticated, grant); nada de create policy, alter
--   policy, drop, delete nem truncate. Nove secoes, cada uma pelo MCP do Supabase (execute_sql, uma por chamada, na
--   ordem), ou apply_migration com o arquivo inteiro.
--
-- Verificacao manual depois de aplicar:
--   select column_name from information_schema.columns where table_name = 'webhook_events' and column_name in ('amount_cents', 'currency'); -- 2 linhas
--   select table_name from information_schema.tables where table_schema = 'public' and table_name like 'webinar_offer%' order by 1; -- 4 linhas
--   select column_name from information_schema.columns where table_name = 'webinar_sessions' and (column_name like 'simulat%' or column_name = 'simulation_seed') order by 1; -- 8 linhas (3 da fase 2 + 5)
--   select proname from pg_proc where proname in ('webinar_offer_variant', 'webinar_offer_conversions', 'webinar_follow_up_facts') order by 1; -- 3 linhas
--   select has_function_privilege('authenticated', 'public.webinar_offer_conversions(timestamptz, integer)', 'execute'); -- false
--   select count(*) from public.webinar_panel('simulated', now() - interval '30 days', now()); -- roda sem erro
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. webhook_events: o valor da venda (M8), lido pelo adaptador da plataforma e gravado pelo webhook. MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webhook_events add column if not exists amount_cents bigint;
alter table public.webhook_events add column if not exists currency text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webhook_events_amount_cents_v4') then
    alter table public.webhook_events add constraint webhook_events_amount_cents_v4
      check (amount_cents is null or amount_cents between 0 and 100000000000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'webhook_events_currency_v4') then
    alter table public.webhook_events add constraint webhook_events_currency_v4
      check (currency is null or currency ~ '^[A-Z]{3}$');
  end if;
end;
$$;

comment on column public.webhook_events.amount_cents is
  'O valor da venda em centavos (docs/30 M8), lido pelo adaptador da plataforma; nunca decide acesso.';

/* ------------------------------------------------------------------------------------------------
 * 2. webinar_offers e webinar_offer_variants: a Oferta do webinario e as variantes A, B, C e D. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_offers (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  -- O produto da escola que a venda libera (entitlements.target_id / sale_grants.product_id).
  product_id text not null check (char_length(product_id) between 1 and 240),
  title text not null default '' check (char_length(title) <= 120),
  trigger_kind text not null default 'at_offset' check (trigger_kind in ('at_offset', 'manual', 'never')),
  show_at_offset_ms integer check (show_at_offset_ms is null or show_at_offset_ms between 0 and 172800000),
  -- "Some em": minutos depois de aparecer; nulo = ate o fim.
  visible_minutes integer check (visible_minutes is null or visible_minutes between 1 and 600),
  -- O prazo real: minutos depois de aparecer em cada sessao; nulo = sem prazo na tela (docs/30 §8.6).
  deadline_minutes integer check (deadline_minutes is null or deadline_minutes between 1 and 1440),
  attribution_days integer not null default 7 check (attribution_days between 1 and 30),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webinar_offers_show_at_v4 check (trigger_kind <> 'at_offset' or show_at_offset_ms is not null)
);

comment on table public.webinar_offers is 'A Oferta de um webinario (docs/30 §2.2): quando aparece, quanto tempo fica, o prazo e a atribuicao da compra.';

create unique index if not exists webinar_offers_one_active_idx on public.webinar_offers (webinar_id) where status <> 'archived';
create index if not exists webinar_offers_webinar_idx on public.webinar_offers (webinar_id);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_webinar_offers_updated_at' and tgrelid = 'public.webinar_offers'::regclass
  ) then
    create trigger set_webinar_offers_updated_at
      before update on public.webinar_offers
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.webinar_offers enable row level security;
revoke all on public.webinar_offers from anon, authenticated;
grant select, insert, update, delete on public.webinar_offers to service_role;

create table if not exists public.webinar_offer_variants (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.webinar_offers(id) on delete cascade,
  label text not null check (label in ('A', 'B', 'C', 'D')),
  enabled boolean not null default true,
  headline text not null check (char_length(headline) between 1 and 120),
  badge text check (badge is null or char_length(badge) <= 40),
  price_from_label text check (price_from_label is null or char_length(price_from_label) <= 40),
  price_label text check (price_label is null or char_length(price_label) <= 40),
  coupon text check (coupon is null or char_length(coupon) <= 40),
  checkout_url text not null check (char_length(checkout_url) between 12 and 2048 and checkout_url ~ '^https://'),
  image_url text check (image_url is null or (char_length(image_url) <= 2048 and image_url ~ '^https://')),
  weight integer not null default 1 check (weight between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.webinar_offer_variants is 'As variantes A, B, C e D da Oferta; o aluno ve sempre a mesma (webinar_offer_variant, M7).';

create unique index if not exists webinar_offer_variants_label_idx on public.webinar_offer_variants (offer_id, label);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_webinar_offer_variants_updated_at' and tgrelid = 'public.webinar_offer_variants'::regclass
  ) then
    create trigger set_webinar_offer_variants_updated_at
      before update on public.webinar_offer_variants
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.webinar_offer_variants enable row level security;
revoke all on public.webinar_offer_variants from anon, authenticated;
grant select, insert, update, delete on public.webinar_offer_variants to service_role;

/* ------------------------------------------------------------------------------------------------
 * 3. webinar_offer_displays (o que cada sessao mostrou) e webinar_offer_clicks (o clique e a conversao). MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_offer_displays (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.webinar_offers(id) on delete cascade,
  session_id uuid not null references public.webinar_sessions(id) on delete cascade,
  show_offset_ms integer not null check (show_offset_ms between -86400000 and 172800000),
  hide_offset_ms integer check (hide_offset_ms is null or hide_offset_ms between -86400000 and 172800000),
  shown_at timestamptz not null default now(),
  hidden_at timestamptz,
  deadline_at timestamptz,
  shown_by uuid references auth.users(id) on delete set null,
  hidden_by uuid references auth.users(id) on delete set null,
  -- A foto das variantes ligadas no momento (titulo, selo, precos, cupom, prazo): o registro do que foi mostrado.
  snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(snapshot) = 'object' and pg_column_size(snapshot) <= 16384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webinar_offer_displays_window_v4 check (hide_offset_ms is null or hide_offset_ms >= show_offset_ms)
);

comment on table public.webinar_offer_displays is 'A janela da Oferta em cada sessao (docs/30 §3.6 e §8.6): "viram a oferta" e quem esteve nela.';

create unique index if not exists webinar_offer_displays_session_idx on public.webinar_offer_displays (session_id, offer_id);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_webinar_offer_displays_updated_at' and tgrelid = 'public.webinar_offer_displays'::regclass
  ) then
    create trigger set_webinar_offer_displays_updated_at
      before update on public.webinar_offer_displays
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.webinar_offer_displays enable row level security;
revoke all on public.webinar_offer_displays from anon, authenticated;
grant select, insert, update, delete on public.webinar_offer_displays to service_role;

create table if not exists public.webinar_offer_clicks (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.webinar_offers(id) on delete cascade,
  variant_id uuid references public.webinar_offer_variants(id) on delete set null,
  variant_label text not null check (variant_label in ('A', 'B', 'C', 'D')),
  session_id uuid not null references public.webinar_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  offset_ms integer not null check (offset_ms between -86400000 and 172800000),
  click_token text not null check (click_token ~ '^[A-Za-z0-9_-]{16,64}$'),
  clicked_at timestamptz not null default now(),
  converted_sale_grant_id uuid references public.sale_grants(id) on delete set null,
  converted_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.webinar_offer_clicks is 'Os cliques em Quero participar e a compra ligada pelo sale_grants em ate attribution_days (M7).';

create unique index if not exists webinar_offer_clicks_token_idx on public.webinar_offer_clicks (click_token);
create index if not exists webinar_offer_clicks_offer_user_idx on public.webinar_offer_clicks (offer_id, user_id);
create index if not exists webinar_offer_clicks_session_idx on public.webinar_offer_clicks (session_id);
create index if not exists webinar_offer_clicks_pending_idx on public.webinar_offer_clicks (clicked_at) where converted_sale_grant_id is null;
create unique index if not exists webinar_offer_clicks_grant_idx
  on public.webinar_offer_clicks (offer_id, converted_sale_grant_id) where converted_sale_grant_id is not null;

alter table public.webinar_offer_clicks enable row level security;
revoke all on public.webinar_offer_clicks from anon, authenticated;
grant select, insert, update, delete on public.webinar_offer_clicks to service_role;

/* ------------------------------------------------------------------------------------------------
 * 4. webinar_sessions: a Simulacao completa (contador, entradas, avisos de venda, o resumo congelado e a semente). MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinar_sessions add column if not exists simulated_count_rule jsonb;
alter table public.webinar_sessions add column if not exists simulated_joins jsonb;
alter table public.webinar_sessions add column if not exists simulated_sale_notices jsonb;
alter table public.webinar_sessions add column if not exists simulation_summary jsonb;
alter table public.webinar_sessions add column if not exists simulation_seed integer not null default (floor(random() * 2147483647))::integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webinar_sessions_simulation_not_live_v4') then
    alter table public.webinar_sessions add constraint webinar_sessions_simulation_not_live_v4
      check (kind <> 'live' or (simulated_count_rule is null and simulated_joins is null and simulated_sale_notices is null and simulation_summary is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'webinar_sessions_simulation_shape_v4') then
    alter table public.webinar_sessions add constraint webinar_sessions_simulation_shape_v4
      check (
        (simulated_count_rule is null or (jsonb_typeof(simulated_count_rule) = 'object' and pg_column_size(simulated_count_rule) <= 4096))
        and (simulated_joins is null or (jsonb_typeof(simulated_joins) = 'object' and pg_column_size(simulated_joins) <= 4096))
        and (simulated_sale_notices is null or (jsonb_typeof(simulated_sale_notices) = 'object' and pg_column_size(simulated_sale_notices) <= 65536))
        and (simulation_summary is null or (jsonb_typeof(simulation_summary) = 'object' and pg_column_size(simulation_summary) <= 4096))
      );
  end if;
end;
$$;

comment on column public.webinar_sessions.simulation_seed is
  'A semente do contador e das entradas simuladas (docs/30 §6.6): todos veem o mesmo numero; nunca sai do servidor.';
comment on column public.webinar_sessions.simulation_summary is
  'Os totais da Simulacao congelados no fim ({counter_max, joins_shown, sale_notices_shown}); so o bloco Simulacao le.';

/* ------------------------------------------------------------------------------------------------
 * 5. webinar_offer_variant (a variante do aluno, M7) e webinar_offer_conversions (a compra pelo sale_grants). MCP.
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.webinar_offer_variant(p_user_id uuid, p_offer_id uuid)
returns text
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with v as (
    select o.label,
      sum(o.weight) over (order by o.label rows between unbounded preceding and current row) as upto,
      sum(o.weight) over () as total
    from public.webinar_offer_variants o
    where o.offer_id = p_offer_id and o.enabled
  )
  select v.label
  from v
  where (('x' || substr(md5(p_user_id::text || p_offer_id::text), 1, 8))::bit(32)::bigint % v.total) < v.upto
  order by v.label
  limit 1;
$$;

comment on function public.webinar_offer_variant(uuid, uuid) is
  'A variante deterministica do aluno (M7): md5(user_id || offer_id), 8 hex como inteiro, modulo a soma dos pesos (A, B, C, D ligadas).';

create or replace function public.webinar_offer_conversions(p_now timestamptz, p_limit integer default 500)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  -- Cada venda (sale_grants) liga no maximo um clique por oferta: o ultimo clique antes dela, dentro de
  -- attribution_days. A venda vem so do webhook (process-sale.ts), nunca do clique.
  with candidates as (
    select distinct on (g.id, c.offer_id) c.id as click_id, g.id as grant_id, g.created_at as converted_at
    from public.webinar_offer_clicks c
    join public.webinar_offers o on o.id = c.offer_id
    join public.sale_grants g on g.user_id = c.user_id and g.product_id = o.product_id
      and g.created_at >= c.clicked_at
      and g.created_at <= c.clicked_at + make_interval(days => o.attribution_days)
    where c.converted_sale_grant_id is null
      and c.clicked_at >= p_now - interval '31 days'
      and c.clicked_at <= p_now
      and not exists (
        select 1 from public.webinar_offer_clicks x
        where x.offer_id = c.offer_id and x.converted_sale_grant_id = g.id
      )
    order by g.id, c.offer_id, c.clicked_at desc
    limit greatest(1, least(coalesce(p_limit, 500), 5000))
  ),
  picked as (
    select distinct on (k.click_id) k.click_id, k.grant_id, k.converted_at
    from candidates k
    order by k.click_id, k.converted_at
  )
  update public.webinar_offer_clicks c
     set converted_sale_grant_id = p.grant_id,
         converted_at = p.converted_at
    from picked p
   where c.id = p.click_id
     and c.converted_sale_grant_id is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.webinar_offer_conversions(timestamptz, integer) is
  'O job webinar-offer-conversions do tick (docs/30 §4.2, M7): liga o clique ao sale_grants da mesma conta e produto em ate attribution_days.';

/* ------------------------------------------------------------------------------------------------
 * 6. webinar_follow_up_facts: o que cada aluno fez em cada webinario (as regras de follow-up da Comunicacao). MCP.
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.webinar_follow_up_facts(p_webinar_ids uuid[])
returns table (
  webinar_id uuid,
  user_id uuid,
  registered boolean,
  attended boolean,
  watched_replay boolean,
  offer_seen boolean,
  left_before_offer boolean,
  clicked boolean,
  purchased boolean
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with ss as (
    select s.id, s.webinar_id, s.kind,
      greatest(coalesce(
        (select r.duration_seconds::bigint * 1000 from public.webinar_recordings r
          where r.id = s.recording_id and r.duration_seconds > 0),
        case when s.started_at is not null and s.ended_at is not null
          then (extract(epoch from (s.ended_at - s.started_at)) * 1000)::bigint end,
        w.duration_minutes::bigint * 60000), 30000) as duration_ms
    from public.webinar_sessions s
    join public.webinars w on w.id = s.webinar_id
    where s.webinar_id = any(p_webinar_ids) and w.deleted_at is null and s.status <> 'cancelled'
  ),
  pres as (
    -- O ultimo balde de cada aluno em cada sessao (o resumo da sessao encerrada ou as amostras).
    select x.session_id, x.user_id, max(x.max_bucket) as max_bucket
    from (
      select a.session_id, a.user_id, a.max_bucket from public.webinar_attendance a join ss on ss.id = a.session_id
      union all
      select ps.session_id, ps.user_id, max(ps.bucket) from public.webinar_presence_samples ps
        join ss on ss.id = ps.session_id where ps.bucket >= 0 group by ps.session_id, ps.user_id
    ) x
    group by x.session_id, x.user_id
  ),
  win as (
    select d.session_id, min(floor(d.show_offset_ms / 30000.0))::integer as b0,
      max(ceil(coalesce(d.hide_offset_ms, ss.duration_ms) / 30000.0))::integer as b1
    from public.webinar_offer_displays d
    join ss on ss.id = d.session_id
    group by d.session_id
  ),
  facts as (
    select r.webinar_id, r.user_id, 'registered'::text as fact
    from public.webinar_registrations r
    where r.webinar_id = any(p_webinar_ids) and r.status = 'registered'
    union
    select ss.webinar_id, p.user_id, 'attended' from pres p join ss on ss.id = p.session_id where ss.kind <> 'replay'
    union
    select ss.webinar_id, p.user_id, 'watched_replay' from pres p join ss on ss.id = p.session_id where ss.kind = 'replay'
    union
    select ss.webinar_id, ps.user_id, 'offer_seen'
    from win w
    join ss on ss.id = w.session_id
    join public.webinar_presence_samples ps on ps.session_id = w.session_id and ps.bucket between w.b0 and w.b1
    union
    select ss.webinar_id, p.user_id, 'left_before_offer'
    from pres p join ss on ss.id = p.session_id join win w on w.session_id = p.session_id
    where p.max_bucket < w.b0
    union
    select o.webinar_id, c.user_id, 'clicked'
    from public.webinar_offer_clicks c join public.webinar_offers o on o.id = c.offer_id
    where o.webinar_id = any(p_webinar_ids)
    union
    select o.webinar_id, c.user_id, 'purchased'
    from public.webinar_offer_clicks c join public.webinar_offers o on o.id = c.offer_id
    where o.webinar_id = any(p_webinar_ids) and c.converted_sale_grant_id is not null
  )
  select f.webinar_id, f.user_id,
    bool_or(f.fact = 'registered'),
    bool_or(f.fact = 'attended'),
    bool_or(f.fact = 'watched_replay'),
    bool_or(f.fact = 'offer_seen'),
    bool_or(f.fact = 'left_before_offer') and not bool_or(f.fact = 'offer_seen'),
    bool_or(f.fact = 'clicked'),
    bool_or(f.fact = 'purchased')
  from facts f
  where not exists (select 1 from public.admin_roles a where a.user_id = f.user_id)
  group by f.webinar_id, f.user_id;
$$;

comment on function public.webinar_follow_up_facts(uuid[]) is
  'As regras de follow-up do segmento (docs/30 §1.6): vaga, compareceu, replay, viu a oferta, saiu antes, clicou e comprou; so alunos, nunca a Simulacao.';

/* ------------------------------------------------------------------------------------------------
 * 7. webinar_report (o corpo completo da 202610290001, mesma assinatura, com a Oferta e o bloco Simulacao). MCP.
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
  win as (
    -- A janela da oferta na sessao (docs/30 §3.6): o que webinar_offer_displays guardou do que foi mostrado.
    select d.offer_id, floor(d.show_offset_ms / 30000.0)::integer as b0,
      ceil(coalesce(d.hide_offset_ms, (select duration_ms from s)) / 30000.0)::integer as b1
    from public.webinar_offer_displays d, s
    where d.session_id = s.id
  ),
  offer_seen as (
    select distinct w.offer_id, ps.user_id, public.webinar_offer_variant(ps.user_id, w.offer_id) as label
    from win w
    cross join s
    join public.webinar_presence_samples ps on ps.session_id = s.id and ps.bucket between w.b0 and w.b1
    where not exists (select 1 from staff where staff.user_id = ps.user_id)
  ),
  clicks as (
    select c.offer_id, c.user_id, c.variant_label as label, c.converted_sale_grant_id
    from public.webinar_offer_clicks c, s
    where c.session_id = s.id and not exists (select 1 from staff where staff.user_id = c.user_id)
  ),
  revenue as (
    -- M8: o valor da venda vem de webhook_events (gravado pelo webhook); uma venda conta uma vez, mesmo num pacote.
    select e.id, e.currency, e.amount_cents
    from public.webhook_events e
    where e.amount_cents is not null and e.currency is not null
      and e.id in (select g.webhook_event_id from clicks c join public.sale_grants g on g.id = c.converted_sale_grant_id)
  ),
  sim as (
    select x.simulation_summary as summary from public.webinar_sessions x, s where x.id = s.id and x.simulation_summary is not null
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
  union all
  select 'offer', 'seen', count(*)::bigint, count(distinct os.user_id)::bigint from offer_seen os
    where exists (select 1 from win) or exists (select 1 from clicks)
  union all
  select 'offer', 'clicks', count(*)::bigint, count(distinct c.user_id)::bigint from clicks c
    where exists (select 1 from win) or exists (select 1 from clicks)
  union all
  select 'offer', 'purchases', count(*) filter (where c.converted_sale_grant_id is not null)::bigint,
    count(distinct c.user_id) filter (where c.converted_sale_grant_id is not null)::bigint from clicks c
    where exists (select 1 from win) or exists (select 1 from clicks)
  union all
  select 'offer', os.label || ':seen', count(*)::bigint, count(distinct os.user_id)::bigint
    from offer_seen os where os.label is not null group by os.label
  union all
  select 'offer', c.label || ':clicks', count(*)::bigint, count(distinct c.user_id)::bigint from clicks c group by c.label
  union all
  select 'offer', c.label || ':purchases', count(*)::bigint, count(distinct c.user_id)::bigint
    from clicks c where c.converted_sale_grant_id is not null group by c.label
  union all
  select 'offer_revenue', rv.currency, sum(rv.amount_cents)::bigint, count(*)::bigint from revenue rv group by rv.currency
  union all
  -- O bloco Simulacao (D6, D10, M6): so o que webinar_sessions.simulation_summary congelou no fim; nunca entra acima.
  select 'sim_counter', 'max', (sim.summary->>'counter_max')::bigint, 0::bigint
    from sim where jsonb_typeof(sim.summary->'counter_max') = 'number'
  union all
  select 'sim_joins', 'shown', (sim.summary->>'joins_shown')::bigint, 0::bigint
    from sim where jsonb_typeof(sim.summary->'joins_shown') = 'number'
  union all
  select 'sim_sales', 'shown', (sim.summary->>'sale_notices_shown')::bigint, 0::bigint
    from sim where jsonb_typeof(sim.summary->'sale_notices_shown') = 'number'
  )
  -- Sessao que nao existe: nenhuma linha (os agregados sem grupo dariam uma linha de zeros).
  select r.metric, r.item, r.total, r.students from report r where exists (select 1 from s);
$$;
comment on function public.webinar_report(uuid) is
  'O relatorio de uma sessao (docs/30 §3.4 e §4.6): uma linha por metrica e item, so alunos, so chat audience/original; a Oferta (offer*) e o bloco Simulacao (sim_*) separados.';

/* ------------------------------------------------------------------------------------------------
 * 8. webinar_panel (o corpo completo da 202610300002, mesma assinatura, com a Oferta e o bloco Simulacao). MCP.
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.webinar_panel(p_kind text, p_start timestamptz, p_end timestamptz, p_session_ids uuid[] default null)
returns table (session_id uuid, metric text, item text, total bigint, students bigint)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with ss as (
    select s.id, s.webinar_id, s.kind, s.presence_curve, s.simulation_summary,
      greatest(coalesce(
        (select r.duration_seconds::bigint * 1000 from public.webinar_recordings r
          where r.id = s.recording_id and r.duration_seconds > 0),
        case when s.started_at is not null and s.ended_at is not null
          then (extract(epoch from (s.ended_at - s.started_at)) * 1000)::bigint end,
        w.duration_minutes::bigint * 60000), 30000) as duration_ms
    from public.webinar_sessions s
    join public.webinars w on w.id = s.webinar_id
    where w.deleted_at is null
      and s.kind in ('live', 'simulated')
      and (p_kind = 'all' or s.kind = p_kind)
      and s.scheduled_at >= p_start and s.scheduled_at < p_end
      and (p_session_ids is null or s.id = any(p_session_ids))
  ),
  staff as (select a.user_id from public.admin_roles a),
  att as (
    select a.session_id, a.user_id, a.seconds, a.reached_end
    from public.webinar_attendance a
    join ss on ss.id = a.session_id
    where not exists (select 1 from staff where staff.user_id = a.user_id)
  ),
  live_samples as (
    -- So da sessao em andamento (sem curva congelada), como webinar_report.
    select ps.session_id, ps.user_id, ps.bucket, ps.samples
    from public.webinar_presence_samples ps
    join ss on ss.id = ps.session_id
    where ss.presence_curve is null and ps.bucket >= 0
      and not exists (select 1 from staff where staff.user_id = ps.user_id)
  ),
  present as (
    select att.session_id, att.user_id, att.seconds, att.reached_end from att
    union all
    select ls.session_id, ls.user_id, (sum(least(ls.samples, 2)) * 15)::integer,
      max(ls.bucket) + 1 >= ceil(max(ss.duration_ms) / 30000.0 * 0.95)
    from live_samples ls
    join ss on ss.id = ls.session_id
    where not exists (select 1 from att where att.session_id = ls.session_id and att.user_id = ls.user_id)
    group by ls.session_id, ls.user_id
  ),
  curve as (
    select ss.id as session_id, (e->>'b')::integer as b, (e->>'n')::bigint as n
    from ss
    cross join lateral jsonb_array_elements(coalesce(ss.presence_curve->'buckets', '[]'::jsonb)) e
    where ss.presence_curve is not null
    union all
    select ls.session_id, ls.bucket, count(distinct ls.user_id) from live_samples ls group by ls.session_id, ls.bucket
  ),
  reg as (
    select ss.id as session_id, r.user_id
    from ss
    join public.webinar_registrations r on r.webinar_id = ss.webinar_id and (r.session_id = ss.id or r.session_id is null)
    where r.status = 'registered'
      and not exists (select 1 from staff where staff.user_id = r.user_id)
  ),
  msgs as (
    select m.session_id, m.author_user_id as user_id
    from public.webinar_chat_messages m
    join ss on ss.id = m.session_id
    where m.deleted_at is null and m.source = 'audience' and m.author_user_id is not null
      and not exists (select 1 from staff where staff.user_id = m.author_user_id)
  ),
  qs as (
    select q.session_id, q.user_id, q.status
    from public.webinar_questions q
    join ss on ss.id = q.session_id
    where q.deleted_at is null
      and not exists (select 1 from staff where staff.user_id = q.user_id)
  ),
  reacts as (
    select r.session_id, r.user_id
    from public.webinar_reactions r
    join ss on ss.id = r.session_id
    where not exists (select 1 from staff where staff.user_id = r.user_id)
  ),
  answers as (
    select a.session_id, a.user_id
    from public.webinar_poll_answers a
    join ss on ss.id = a.session_id
    where a.deleted_at is null
      and not exists (select 1 from staff where staff.user_id = a.user_id)
  ),
  replay_users as (
    -- "Viram o replay": quem tem amostra (ou o resumo) na sessao replay do mesmo webinario, ate agora.
    select distinct ss.id as session_id, x.user_id
    from ss
    join public.webinar_sessions rs on rs.webinar_id = ss.webinar_id and rs.kind = 'replay'
    cross join lateral (
      select a.user_id from public.webinar_attendance a where a.session_id = rs.id
      union
      select ps.user_id from public.webinar_presence_samples ps where ps.session_id = rs.id and ps.bucket >= 0
    ) x
    where not exists (select 1 from staff where staff.user_id = x.user_id)
  ),
  visitors as (
    -- "Visitantes": abriram a Sala (webinar_joined, gravado so pelo servidor, docs/30 §4.7).
    select distinct ss.id as session_id, e.user_id
    from ss
    join public.student_events e on e.entity_type = 'webinar' and e.entity_id = ss.id::text and e.event_type = 'webinar_joined'
    where not exists (select 1 from staff where staff.user_id = e.user_id)
  ),
  retention as (
    select ss.id as session_id, p.pct, coalesce(c.n, 0) as n
    from ss
    cross join generate_series(0, 100, 5) as p(pct)
    left join curve c on c.session_id = ss.id
      and c.b = least(floor(p.pct / 100.0 * ceil(ss.duration_ms / 30000.0))::integer, ceil(ss.duration_ms / 30000.0)::integer - 1)
    where exists (select 1 from present pr where pr.session_id = ss.id)
  ),
  win as (
    select d.session_id, d.offer_id, floor(d.show_offset_ms / 30000.0)::integer as b0,
      ceil(coalesce(d.hide_offset_ms, ss.duration_ms) / 30000.0)::integer as b1
    from public.webinar_offer_displays d
    join ss on ss.id = d.session_id
  ),
  offer_seen as (
    select distinct w.session_id, w.offer_id, ps.user_id, public.webinar_offer_variant(ps.user_id, w.offer_id) as label
    from win w
    join public.webinar_presence_samples ps on ps.session_id = w.session_id and ps.bucket between w.b0 and w.b1
    where not exists (select 1 from staff where staff.user_id = ps.user_id)
  ),
  clicks as (
    select c.session_id, c.offer_id, c.user_id, c.variant_label as label, c.converted_sale_grant_id
    from public.webinar_offer_clicks c
    join ss on ss.id = c.session_id
    where not exists (select 1 from staff where staff.user_id = c.user_id)
  ),
  revenue as (
    select distinct on (e.id) c.session_id, e.id, e.currency, e.amount_cents
    from clicks c
    join public.sale_grants g on g.id = c.converted_sale_grant_id
    join public.webhook_events e on e.id = g.webhook_event_id
    where e.amount_cents is not null and e.currency is not null
    order by e.id, c.session_id
  ),
  scripted as (
    select m.session_id, count(*)::bigint as n
    from public.webinar_chat_messages m
    join ss on ss.id = m.session_id
    where m.source = 'scripted' and m.script_item_id is not null
    group by m.session_id
  ),
  panel as (
  select ss.id as session_id, 'duration'::text as metric, ''::text as item, ss.duration_ms as total, 0::bigint as students from ss
  union all
  select r.session_id, 'registered', '', count(*)::bigint, count(distinct r.user_id)::bigint from reg r group by r.session_id
  union all
  select p.session_id, 'present', '', count(distinct p.user_id)::bigint, count(distinct p.user_id)::bigint from present p group by p.session_id
  union all
  select p.session_id, 'attended_registered', '', count(distinct p.user_id)::bigint, count(distinct p.user_id)::bigint
    from present p where exists (select 1 from reg r where r.session_id = p.session_id and r.user_id = p.user_id)
    group by p.session_id
  union all
  select p.session_id, 'watch_sum', '', coalesce(sum(p.seconds), 0)::bigint, count(*)::bigint from present p group by p.session_id
  union all
  select p.session_id, 'watch_max', '', coalesce(max(p.seconds), 0)::bigint, count(*)::bigint from present p group by p.session_id
  union all
  select p.session_id, 'reached_end', '', count(*) filter (where p.reached_end)::bigint, count(*) filter (where p.reached_end)::bigint
    from present p group by p.session_id
  union all
  select x.session_id, 'peak', x.b::text, x.n, x.n
    from (select distinct on (c.session_id) c.session_id, c.b, c.n from curve c order by c.session_id, c.n desc, c.b asc) x
  union all
  select m.session_id, 'messages', '', count(*)::bigint, count(distinct m.user_id)::bigint from msgs m group by m.session_id
  union all
  select q.session_id, 'question', q.status, count(*)::bigint, count(distinct q.user_id)::bigint from qs q group by q.session_id, q.status
  union all
  select r.session_id, 'reactions', '', count(*)::bigint, count(distinct r.user_id)::bigint from reacts r group by r.session_id
  union all
  select a.session_id, 'poll_answers', '', count(*)::bigint, count(distinct a.user_id)::bigint from answers a group by a.session_id
  union all
  select ru.session_id, 'replay_viewers', '', count(*)::bigint, count(*)::bigint from replay_users ru group by ru.session_id
  union all
  select v.session_id, 'visitors', '', count(*)::bigint, count(*)::bigint from visitors v group by v.session_id
  union all
  select rt.session_id, 'retention', rt.pct::text, rt.n,
    (select count(distinct p.user_id) from present p where p.session_id = rt.session_id)::bigint
    from retention rt
  union all
  -- Os unicos do periodo (session_id nulo): o mesmo aluno em duas sessoes conta uma vez.
  select null::uuid, 'unique_present', '', count(distinct p.user_id)::bigint, count(distinct p.user_id)::bigint from present p
  union all
  select null::uuid, 'unique_registered', '', count(distinct r.user_id)::bigint, count(distinct r.user_id)::bigint from reg r
  union all
  select null::uuid, 'unique_attended_registered', '', count(distinct p.user_id)::bigint, count(distinct p.user_id)::bigint
    from present p where exists (select 1 from reg r where r.session_id = p.session_id and r.user_id = p.user_id)
  union all
  select null::uuid, 'unique_reached_end', '', count(distinct p.user_id) filter (where p.reached_end)::bigint,
    count(distinct p.user_id) filter (where p.reached_end)::bigint from present p
  union all
  select null::uuid, 'unique_replay_viewers', '', count(distinct ru.user_id)::bigint, count(distinct ru.user_id)::bigint from replay_users ru
  union all
  select null::uuid, 'unique_visitors', '', count(distinct v.user_id)::bigint, count(distinct v.user_id)::bigint from visitors v
  union all
  select null::uuid, 'unique_commenters', '', count(distinct m.user_id)::bigint, count(distinct m.user_id)::bigint from msgs m
  union all
  select os.session_id, 'offer_seen', '', count(distinct os.user_id)::bigint, count(distinct os.user_id)::bigint
    from offer_seen os group by os.session_id
  union all
  select c.session_id, 'offer_clicks', '', count(*)::bigint, count(distinct c.user_id)::bigint from clicks c group by c.session_id
  union all
  select c.session_id, 'offer_purchases', '', count(*)::bigint, count(distinct c.user_id)::bigint
    from clicks c where c.converted_sale_grant_id is not null group by c.session_id
  union all
  select os.session_id, 'offer_variant', os.label || ':seen', count(*)::bigint, count(distinct os.user_id)::bigint
    from offer_seen os where os.label is not null group by os.session_id, os.label
  union all
  select c.session_id, 'offer_variant', c.label || ':clicks', count(*)::bigint, count(distinct c.user_id)::bigint
    from clicks c group by c.session_id, c.label
  union all
  select c.session_id, 'offer_variant', c.label || ':purchases', count(*)::bigint, count(distinct c.user_id)::bigint
    from clicks c where c.converted_sale_grant_id is not null group by c.session_id, c.label
  union all
  select rv.session_id, 'offer_revenue', rv.currency, sum(rv.amount_cents)::bigint, count(*)::bigint
    from revenue rv group by rv.session_id, rv.currency
  union all
  select null::uuid, 'unique_offer_seen', '', count(distinct os.user_id)::bigint, count(distinct os.user_id)::bigint from offer_seen os
  union all
  select null::uuid, 'unique_clickers', '', count(distinct c.user_id)::bigint, count(distinct c.user_id)::bigint from clicks c
  union all
  select null::uuid, 'unique_buyers', '', count(distinct c.user_id) filter (where c.converted_sale_grant_id is not null)::bigint,
    count(distinct c.user_id) filter (where c.converted_sale_grant_id is not null)::bigint from clicks c
  union all
  -- O bloco Simulacao (D6, D10, M6): separado, com os nomes sim_*; nunca soma em nenhuma linha acima.
  select ss.id, 'sim_counter', 'max', (ss.simulation_summary->>'counter_max')::bigint, 0::bigint
    from ss where jsonb_typeof(ss.simulation_summary->'counter_max') = 'number'
  union all
  select ss.id, 'sim_joins', 'shown', (ss.simulation_summary->>'joins_shown')::bigint, 0::bigint
    from ss where jsonb_typeof(ss.simulation_summary->'joins_shown') = 'number'
  union all
  select ss.id, 'sim_sales', 'shown', (ss.simulation_summary->>'sale_notices_shown')::bigint, 0::bigint
    from ss where jsonb_typeof(ss.simulation_summary->'sale_notices_shown') = 'number'
  union all
  select sc.session_id, 'sim_script', 'fired', sc.n, 0::bigint from scripted sc
  )
  select pn.session_id, pn.metric, pn.item, pn.total, pn.students from panel pn where pn.total is not null;
$$;
comment on function public.webinar_panel(text, timestamptz, timestamptz, uuid[]) is
  'Os paineis Lives ao vivo e Lives gravadas (docs/30 §3.2, §3.3 e §4.6): numeros reais por sessao e os unicos do periodo, a Oferta (offer*) e o bloco Simulacao (sim_*) separados.';

/* ------------------------------------------------------------------------------------------------
 * 9. Permissoes das funcoes novas (so service_role). MCP.
 * ---------------------------------------------------------------------------------------------- */

revoke all on function public.webinar_offer_variant(uuid, uuid) from public, anon, authenticated;
grant execute on function public.webinar_offer_variant(uuid, uuid) to service_role;
revoke all on function public.webinar_offer_conversions(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.webinar_offer_conversions(timestamptz, integer) to service_role;
revoke all on function public.webinar_follow_up_facts(uuid[]) from public, anon, authenticated;
grant execute on function public.webinar_follow_up_facts(uuid[]) to service_role;
revoke all on function public.webinar_report(uuid) from public, anon, authenticated;
grant execute on function public.webinar_report(uuid) to service_role;
revoke all on function public.webinar_panel(text, timestamptz, timestamptz, uuid[]) from public, anon, authenticated;
grant execute on function public.webinar_panel(text, timestamptz, timestamptz, uuid[]) to service_role;
