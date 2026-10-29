-- Webinarios v4, os ajustes da revisao da fase 4 (docs/30 §3.3, §3.4, §3.6, §4.2, §4.5, §6.6, §8.6 e §11). As
-- migracoes 202610290004 a 202610290009 nao mudam (nenhuma migracao da fase 4 foi aplicada ainda, em lugar nenhum;
-- docs/21 §9.10); este arquivo so acrescenta.
--
-- Regras:
-- - webinar_offer_seen: quem viu a oferta em cada sessao, congelado no fim junto da curva (webinar_close_session); as
--   amostras de presenca somem 90 dias depois do fim (prune_webinar_history) e "Viram a oferta" (painel, relatorio e
--   follow-up) passa a ler o congelado quando a sessao tem presence_curve, e as amostras so na sessao em andamento. As
--   sessoes ja encerradas ganham o congelado pelas amostras que ainda existem (insert ... on conflict do nothing);
-- - webinar_close_session: o corpo da 202610290001 inteiro mais o congelado acima (pode rodar de novo);
-- - webinar_offer_conversions: o ultimo clique antes da venda e escolhido entre todos os cliques da janela, convertidos
--   ou nao (a segunda venda nao desce para um clique mais antigo); a venda reembolsada ou com chargeback nao converte;
-- - webinar_follow_up_facts, webinar_report e webinar_panel: "Viram a oferta" pelo congelado; Compras, compradores e
--   receita sem as vendas reembolsadas ou com chargeback (closed_by 'refund' / 'chargeback'; a assinatura cancelada e
--   o fechamento pela equipe continuam contando, foram vendas); no relatorio, "ai / handoffs" conta uma vez o pedido
--   numa pergunta que veio do chat (a mensagem e a pergunta ligada ganham a marca juntas). Mesmas assinaturas, corpo
--   completo;
-- - a tabela nova so do service_role (RLS, revoke de anon e authenticated, grant); nada de create policy, alter
--   policy, drop, delete nem truncate. Seis secoes, cada uma pelo MCP do Supabase (execute_sql, uma por chamada, na
--   ordem), ou apply_migration com o arquivo inteiro.
--
-- Verificacao manual depois de aplicar:
--   select table_name from information_schema.tables where table_schema = 'public' and table_name = 'webinar_offer_seen'; -- 1 linha
--   select relrowsecurity from pg_class where relname = 'webinar_offer_seen'; -- true
--   select has_table_privilege('authenticated', 'public.webinar_offer_seen', 'select'); -- false
--   select pg_get_function_identity_arguments('public.webinar_close_session'::regproc); -- p_session_id uuid, p_now timestamp with time zone
--   select count(*) from public.webinar_report(gen_random_uuid()); -- 0
--   select count(*) from public.webinar_panel('all', now() - interval '30 days', now()); -- roda sem erro
--   select public.webinar_offer_conversions(now(), 1); -- roda sem erro (0 sem venda nova)
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. webinar_offer_seen: quem viu a oferta, congelado no fim da sessao (as amostras somem em 90 dias). MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_offer_seen (
  session_id uuid not null references public.webinar_sessions(id) on delete cascade,
  offer_id uuid not null references public.webinar_offers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- A variante do aluno no momento (webinar_offer_variant); nula quando nenhuma variante estava ligada.
  variant_label text check (variant_label is null or variant_label in ('A', 'B', 'C', 'D')),
  created_at timestamptz not null default now(),
  primary key (session_id, offer_id, user_id)
);

comment on table public.webinar_offer_seen is
  'Quem esteve na janela da oferta em cada sessao, congelado no fim (webinar_close_session): "Viram a oferta" depois que as amostras somem.';

create index if not exists webinar_offer_seen_offer_idx on public.webinar_offer_seen (offer_id, user_id);

alter table public.webinar_offer_seen enable row level security;
revoke all on public.webinar_offer_seen from anon, authenticated;
grant select, insert, update, delete on public.webinar_offer_seen to service_role;

-- As sessoes ja encerradas: o congelado pelas amostras que ainda existem (as podadas ja davam zero antes).
insert into public.webinar_offer_seen (session_id, offer_id, user_id, variant_label)
select distinct d.session_id, d.offer_id, ps.user_id, public.webinar_offer_variant(ps.user_id, d.offer_id)
from public.webinar_offer_displays d
join public.webinar_sessions s on s.id = d.session_id and s.presence_curve is not null
join public.webinars w on w.id = s.webinar_id
join public.webinar_presence_samples ps on ps.session_id = d.session_id
  and ps.bucket between floor(d.show_offset_ms / 30000.0)::integer
    and ceil(coalesce(d.hide_offset_ms, greatest(coalesce(
      (select r.duration_seconds::bigint * 1000 from public.webinar_recordings r where r.id = s.recording_id and r.duration_seconds > 0),
      case when s.started_at is not null and s.ended_at is not null then (extract(epoch from (s.ended_at - s.started_at)) * 1000)::bigint end,
      w.duration_minutes::bigint * 60000), 30000)) / 30000.0)::integer
on conflict (session_id, offer_id, user_id) do nothing;

/* ------------------------------------------------------------------------------------------------
 * 2. webinar_close_session (o corpo completo da 202610290001, mesma assinatura, com o congelado da oferta). MCP.
 * ---------------------------------------------------------------------------------------------- */

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

  -- Quem viu a oferta, congelado junto da curva (as amostras somem 90 dias depois do fim, prune_webinar_history; os
  -- paineis, o relatorio e o follow-up leem daqui quando a sessao tem curva). A variante do momento fica gravada.
  insert into public.webinar_offer_seen (session_id, offer_id, user_id, variant_label)
  select distinct d.session_id, d.offer_id, ps.user_id, public.webinar_offer_variant(ps.user_id, d.offer_id)
  from public.webinar_offer_displays d
  join public.webinar_presence_samples ps on ps.session_id = d.session_id
    and ps.bucket between floor(d.show_offset_ms / 30000.0)::integer and ceil(coalesce(d.hide_offset_ms, v_duration_ms) / 30000.0)::integer
  where d.session_id = p_session_id
  on conflict (session_id, offer_id, user_id) do nothing;

  update public.webinar_sessions
  set presence_curve = v_summary,
      status = case when status = 'cancelled' then status else 'ended' end,
      ended_at = coalesce(ended_at, p_now)
  where id = p_session_id;

  return v_summary;
end;
$$;

comment on function public.webinar_close_session(uuid, timestamptz) is
  'Encerra a sessao: resume as amostras em webinar_attendance, congela presence_curve e quem viu a oferta (webinar_offer_seen) (docs/30 §4.5). Pode rodar de novo.';

/* ------------------------------------------------------------------------------------------------
 * 3. webinar_offer_conversions (o ultimo clique entre todos da janela; sem venda reembolsada). MCP.
 * ---------------------------------------------------------------------------------------------- */

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
  -- attribution_days, escolhido entre TODOS os cliques da janela (convertidos ou nao). Se esse ultimo clique ja tem
  -- venda, a venda nova nao desce para um clique mais antigo (o segundo pedido nao infla Compras). A venda reembolsada
  -- ou com chargeback nao converte. A venda vem so do webhook (process-sale.ts), nunca do clique.
  with ranked as (
    select distinct on (g.id, c.offer_id) c.id as click_id, c.offer_id, c.converted_sale_grant_id as click_grant,
      g.id as grant_id, g.created_at as converted_at
    from public.webinar_offer_clicks c
    join public.webinar_offers o on o.id = c.offer_id
    join public.sale_grants g on g.user_id = c.user_id and g.product_id = o.product_id
      and g.created_at >= c.clicked_at
      and g.created_at <= c.clicked_at + make_interval(days => o.attribution_days)
      and (g.closed_by is null or g.closed_by not in ('refund', 'chargeback'))
    where c.clicked_at >= p_now - interval '31 days'
      and c.clicked_at <= p_now
    order by g.id, c.offer_id, c.clicked_at desc, c.id desc
  ),
  candidates as (
    select r.click_id, r.grant_id, r.converted_at
    from ranked r
    where r.click_grant is null
      and not exists (
        select 1 from public.webinar_offer_clicks x
        where x.offer_id = r.offer_id and x.converted_sale_grant_id = r.grant_id
      )
    order by r.converted_at, r.grant_id
    limit greatest(1, least(coalesce(p_limit, 500), 5000))
  ),
  picked as (
    select distinct on (k.click_id) k.click_id, k.grant_id, k.converted_at
    from candidates k
    order by k.click_id, k.converted_at, k.grant_id
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
  'O job webinar-offer-conversions do tick (docs/30 §4.2, M7): liga o ultimo clique antes da venda (entre todos os da janela) ao sale_grants da mesma conta e produto em ate attribution_days; sem venda reembolsada.';

/* ------------------------------------------------------------------------------------------------
 * 4. webinar_follow_up_facts (o corpo completo da 202610290005: o congelado da oferta e a compra de pe). MCP.
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
    select s.id, s.webinar_id, s.kind, s.presence_curve,
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
    -- Viu a oferta: pelas amostras so com a sessao em andamento; encerrada, pelo que o fim congelou (as amostras somem).
    select ss.webinar_id, ps.user_id, 'offer_seen'
    from win w
    join ss on ss.id = w.session_id
    join public.webinar_presence_samples ps on ps.session_id = w.session_id and ps.bucket between w.b0 and w.b1
    where ss.presence_curve is null
    union
    select ss.webinar_id, f.user_id, 'offer_seen'
    from public.webinar_offer_seen f
    join ss on ss.id = f.session_id
    where ss.presence_curve is not null
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
    join public.sale_grants g on g.id = c.converted_sale_grant_id
    where o.webinar_id = any(p_webinar_ids)
      and (g.closed_by is null or g.closed_by not in ('refund', 'chargeback'))
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
  'As regras de follow-up do segmento (docs/30 §1.6): vaga, compareceu, replay, viu a oferta (congelado no fim), saiu antes, clicou e comprou (sem reembolso); so alunos, nunca a Simulacao.';

/* ------------------------------------------------------------------------------------------------
 * 5. webinar_report e webinar_panel (os corpos completos da 202610290006 e da 202610290005, mesmas assinaturas). MCP.
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
    -- Pelas amostras so com a sessao em andamento; encerrada, pelo que o fim congelou (webinar_offer_seen).
    select distinct w.offer_id, ps.user_id, public.webinar_offer_variant(ps.user_id, w.offer_id) as label
    from win w
    cross join s
    join public.webinar_presence_samples ps on ps.session_id = s.id and ps.bucket between w.b0 and w.b1
    where s.presence_curve is null and not exists (select 1 from staff where staff.user_id = ps.user_id)
    union
    select f.offer_id, f.user_id, coalesce(f.variant_label, public.webinar_offer_variant(f.user_id, f.offer_id))
    from public.webinar_offer_seen f, s
    where f.session_id = s.id and s.presence_curve is not null
      and not exists (select 1 from staff where staff.user_id = f.user_id)
  ),
  clicks as (
    -- A compra so vale com a venda de pe: o reembolso e o chargeback desfazem (a assinatura cancelada foi venda).
    select c.offer_id, c.user_id, c.variant_label as label,
      case when g.id is not null and (g.closed_by is null or g.closed_by not in ('refund', 'chargeback')) then c.converted_sale_grant_id end as converted_sale_grant_id
    from public.webinar_offer_clicks c
    cross join s
    left join public.sale_grants g on g.id = c.converted_sale_grant_id
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
  ai_msgs as (
    -- As respostas do Assistente (source = 'ai', D24): reais, a alunos reais; fora da Simulacao e do chat dos alunos.
    select m.id, m.edited_at, m.deleted_at
    from public.webinar_chat_messages m, s
    where m.session_id = s.id and m.source = 'ai'
  ),
  ai_reqs as (
    select q.requested_at, q.answered_at
    from public.webinar_ai_requests q, s
    where q.session_id = s.id and q.status = 'answered' and q.answered_at is not null
  ),
  handoffs as (
    -- Um pedido do aluno conta uma vez: a mensagem do chat que tem a pergunta ligada (as duas ganham a marca) fica so
    -- pela pergunta.
    select q.id from public.webinar_questions q, s where q.session_id = s.id and q.handoff_requested_at is not null
    union all
    select m.id from public.webinar_chat_messages m, s where m.session_id = s.id and m.handoff_requested_at is not null
      and not exists (
        select 1 from public.webinar_questions q2
        where q2.message_id = m.id and q2.session_id = s.id and q2.handoff_requested_at is not null
      )
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
  union all
  select 'ai', 'replies', count(*) filter (where am.deleted_at is null)::bigint, 0::bigint from ai_msgs am
    where exists (select 1 from ai_msgs)
  union all
  select 'ai', 'avg_seconds', coalesce(round(avg(extract(epoch from (ar.answered_at - ar.requested_at)))), 0)::bigint, count(*)::bigint
    from ai_reqs ar where exists (select 1 from ai_msgs)
  union all
  select 'ai', 'edited', count(*) filter (where am.edited_at is not null and am.deleted_at is null)::bigint, 0::bigint from ai_msgs am
    where exists (select 1 from ai_msgs)
  union all
  select 'ai', 'deleted', count(*) filter (where am.deleted_at is not null)::bigint, 0::bigint from ai_msgs am
    where exists (select 1 from ai_msgs)
  union all
  select 'ai', 'handoffs', count(*)::bigint, 0::bigint from handoffs h where exists (select 1 from handoffs)
  )
  -- Sessao que nao existe: nenhuma linha (os agregados sem grupo dariam uma linha de zeros).
  select r.metric, r.item, r.total, r.students from report r where exists (select 1 from s);
$$;
comment on function public.webinar_report(uuid) is
  'O relatorio de uma sessao (docs/30 §3.4 e §4.6): uma linha por metrica e item, so alunos, so chat audience/original; a Oferta (offer*: viram pelo congelado, compras sem reembolso), as Respostas do Assistente (ai) e o bloco Simulacao (sim_*) separados.';

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
    -- Pelas amostras so com a sessao em andamento; encerrada, pelo que o fim congelou (webinar_offer_seen): as
    -- amostras somem 90 dias depois do fim e o periodo vai ate 366 dias.
    select distinct w.session_id, w.offer_id, ps.user_id, public.webinar_offer_variant(ps.user_id, w.offer_id) as label
    from win w
    join ss on ss.id = w.session_id
    join public.webinar_presence_samples ps on ps.session_id = w.session_id and ps.bucket between w.b0 and w.b1
    where ss.presence_curve is null and not exists (select 1 from staff where staff.user_id = ps.user_id)
    union
    select f.session_id, f.offer_id, f.user_id, coalesce(f.variant_label, public.webinar_offer_variant(f.user_id, f.offer_id))
    from public.webinar_offer_seen f
    join ss on ss.id = f.session_id
    where ss.presence_curve is not null and not exists (select 1 from staff where staff.user_id = f.user_id)
  ),
  clicks as (
    -- A compra so vale com a venda de pe: o reembolso e o chargeback desfazem (a assinatura cancelada foi venda).
    select c.session_id, c.offer_id, c.user_id, c.variant_label as label,
      case when g.id is not null and (g.closed_by is null or g.closed_by not in ('refund', 'chargeback')) then c.converted_sale_grant_id end as converted_sale_grant_id
    from public.webinar_offer_clicks c
    join ss on ss.id = c.session_id
    left join public.sale_grants g on g.id = c.converted_sale_grant_id
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
  'Os paineis Lives ao vivo e Lives gravadas (docs/30 §3.2, §3.3 e §4.6): numeros reais por sessao e os unicos do periodo, a Oferta (offer*: viram pelo congelado, compras e receita sem reembolso) e o bloco Simulacao (sim_*) separados.';

/* ------------------------------------------------------------------------------------------------
 * 6. Permissoes das funcoes recriadas (so service_role; o create or replace mantem, aqui de novo). MCP.
 * ---------------------------------------------------------------------------------------------- */

revoke all on function public.webinar_close_session(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.webinar_close_session(uuid, timestamptz) to service_role;
revoke all on function public.webinar_offer_conversions(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.webinar_offer_conversions(timestamptz, integer) to service_role;
revoke all on function public.webinar_follow_up_facts(uuid[]) from public, anon, authenticated;
grant execute on function public.webinar_follow_up_facts(uuid[]) to service_role;
revoke all on function public.webinar_report(uuid) from public, anon, authenticated;
grant execute on function public.webinar_report(uuid) to service_role;
revoke all on function public.webinar_panel(text, timestamptz, timestamptz, uuid[]) from public, anon, authenticated;
grant execute on function public.webinar_panel(text, timestamptz, timestamptz, uuid[]) to service_role;
