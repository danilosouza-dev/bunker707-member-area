-- Webinarios v4a, os paineis "Lives ao vivo" e "Lives gravadas" (docs/30 §3.1 a §3.3, §3.6, §4.6 e §11, fase 4a). As
-- migracoes ate a 202610300001 (a do "Quem pode" por regras, ja aplicada na nuvem de teste) nao mudam; a fase 4 vem
-- depois dela, de 202610300002 a 202610300007, e nenhuma foi aplicada ainda (docs/21 §9.10); este arquivo so acrescenta.
--
-- Regras:
-- - webinar_panel(p_kind, p_start, p_end, p_session_ids): o mesmo desenho de webinar_report (uma linha por metrica e
--   item, so alunos, so service_role), mas para todas as sessoes do periodo de uma vez. `p_kind` = 'live', 'simulated'
--   ou 'all' (a lista do admin soma as duas); entram as sessoes com scheduled_at em [p_start, p_end) (docs/30 §3.1);
--   `p_session_ids` (opcional) restringe as sessoes depois dos filtros da aba (produto, apresentador, situacao,
--   webinario, horario), para os unicos do topo seguirem os mesmos filtros. As linhas com session_id preenchido sao da
--   sessao; as com session_id nulo sao os unicos do periodo (o mesmo aluno em duas sessoes conta uma vez);
-- - so numeros reais (D6, D10, M6): presenca, vagas, chat `audience`, perguntas, reacoes, enquetes, replay e as
--   visitas (`webinar_joined`); nunca `scripted`, `ai` nem as colunas de simulacao (a 202610300003 acrescenta a oferta
--   e o bloco Simulacao separado, com os nomes `offer_*` e `sim_*`);
-- - a presenca le webinar_attendance (sessao encerrada) e as amostras so da sessao em andamento (presence_curve nulo),
--   como webinar_report; o pico vem da curva congelada; a retencao sai em 21 pontos (0 a 100 % da duracao, de 5 em
--   5): total = presentes no balde daquele ponto, students = unicos da sessao (a tela faz a conta, docs/30 §3.6);
-- - quem tem linha em admin_roles nunca conta (docs/30 §3.1);
-- - o indice (kind, scheduled_at) para o periodo dos paineis;
-- - nada de create policy, alter policy, drop, delete nem truncate. Tres secoes, cada uma pelo MCP do Supabase
--   (execute_sql, uma por chamada, na ordem), ou apply_migration com o arquivo inteiro.
--
-- Verificacao manual depois de aplicar:
--   select indexname from pg_indexes where schemaname = 'public' and indexname = 'webinar_sessions_kind_scheduled_idx'; -- 1 linha
--   select pg_get_function_identity_arguments('public.webinar_panel'::regproc); -- p_kind text, p_start timestamp with time zone, p_end timestamp with time zone, p_session_ids uuid[]
--   select has_function_privilege('authenticated', 'public.webinar_panel(text, timestamptz, timestamptz, uuid[])', 'execute'); -- false
--   select count(*) from public.webinar_panel('all', now() - interval '30 days', now()); -- roda sem erro
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. webinar_sessions: o indice do periodo dos paineis. MCP.
 * ---------------------------------------------------------------------------------------------- */

create index if not exists webinar_sessions_kind_scheduled_idx on public.webinar_sessions (kind, scheduled_at);

/* ------------------------------------------------------------------------------------------------
 * 2. webinar_panel: os numeros reais de todas as sessoes do periodo (os dois paineis e a lista). MCP.
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.webinar_panel(p_kind text, p_start timestamptz, p_end timestamptz, p_session_ids uuid[] default null)
returns table (session_id uuid, metric text, item text, total bigint, students bigint)
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
  )
  select pn.session_id, pn.metric, pn.item, pn.total, pn.students from panel pn where pn.total is not null;
$$;

comment on function public.webinar_panel(text, timestamptz, timestamptz, uuid[]) is
  'Os paineis Lives ao vivo e Lives gravadas (docs/30 §3.2, §3.3 e §4.6): numeros reais por sessao e os unicos do periodo, so alunos.';

/* ------------------------------------------------------------------------------------------------
 * 3. Permissoes: webinar_panel so do service_role. MCP.
 * ---------------------------------------------------------------------------------------------- */

revoke all on function public.webinar_panel(text, timestamptz, timestamptz, uuid[]) from public, anon, authenticated;
grant execute on function public.webinar_panel(text, timestamptz, timestamptz, uuid[]) to service_role;
