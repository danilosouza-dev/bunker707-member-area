-- Webinarios "Quem pode por regras" (docs/30 §1.1 e §1.6; docs/22 §3). As migracoes ate a 202610290003 (ja
-- aplicadas) nao mudam.
--
-- Regras:
-- - "Quem tem o produto e está no segmento" (o segmento so restringe, o produto vem sempre dos acessos) NAO e um valor
--   novo de webinars.access_mode: grava access_mode 'product' e a coluna nova audience_restricts = true. O check da
--   202610280001 continua com os quatro modos dela. O app de antes le um access_mode que nao conhece como 'everyone'
--   (rows.ts) e abriria a live para todos; com 'product' + a coluna, num rollback do app com esta migracao aplicada ele
--   continua exigindo o produto (o segmento deixa de restringir ate o app novo voltar, mas a live nunca abre para quem
--   nao tem o produto). Nenhum passo manual antes de voltar o app;
-- - communication_webinar_facts(p_user_ids, p_after, p_limit) devolve uma linha por aluno com as lives em que ele garantiu vaga
--   (webinar_registrations 'registered') e as lives em que entrou na sala por qualquer tempo, igual ao "Compareceram"
--   do relatorio: o resumo das sessoes ao vivo e gravadas ja encerradas (webinar_attendance) mais as amostras depois do
--   inicio (balde >= 0) das sessoes em 'waiting'/'live', ainda sem o resumo da webinar_close_session. O replay nao
--   conta, a sala de espera nao conta, a equipe (admin_roles) fica de fora e a live excluida (deleted_at) tambem. Nulo =
--   todos os alunos, por chave: os proximos p_limit (ate 1000, o teto do PostgREST) depois de p_after, na ordem do id,
--   cada fonte pelo seu indice por user_id com o proprio limite (nunca OFFSET: com ORDER BY + OFFSET o PostgREST roda a
--   funcao inteira de novo a cada pagina); com ids (pedacos de 150), so eles. As amostras sao lidas so das sessoes em
--   andamento (resolvidas antes numa variavel), pela chave (session_id, user_id, bucket), nunca a tabela inteira com os
--   90 dias de historico. Nenhum caminho usa `p_user_ids is null or ...` (sem indice): a escolha dos ids e a leitura
--   por `user_id = any (...)` (webinar_registrations_user_idx, webinar_attendance_user_idx e a chave das amostras).
--   Medido num Postgres 16 com 60 mil alunos com vaga ou presenca, 180 mil vagas, 94 mil presencas e 3,9 M de amostras:
--   a leitura de todos caiu de 26 s (60 paginas por OFFSET) para 2,3 s (60 paginas por chave, a pior com 74 ms), e um
--   pedaco de 150 alunos, de 35 ms para 8 ms;
--   Base das regras "Participação em lives" do segmento e dos fluxos e da ancora do "Quem pode" (quem garantiu vaga ou
--   ja entrou continua vendo a live; o produto e sempre conferido de novo);
-- - security invoker, so service_role (revoke de public, anon e authenticated); nada de tabela nova, politica, delete
--   nem truncate. O unico drop e o das versoes anteriores desta mesma funcao (a assinatura so com p_user_ids), so se
--   existirem (create or replace nao troca a assinatura, e as duas juntas deixariam a chamada com p_user_ids ambigua no
--   PostgREST). Duas secoes, cada uma pelo MCP do Supabase
--   (execute_sql, uma por chamada, na ordem), ou apply_migration com o arquivo inteiro;
-- - aplicar ANTES de publicar o app novo (R1 do docs/29): ele le a coluna audience_restricts junto das outras do
--   webinario. O app de antes ignora a coluna e avalia um tipo de regra que nao conhece como false (fecha).
--
-- Verificacao manual depois de aplicar:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'webinars_access_mode_check';
--     -- CHECK (access_mode = ANY (ARRAY['everyone', 'product', 'audience', 'either'])) (1 linha, sem mudanca)
--   select column_name, data_type, is_nullable, column_default from information_schema.columns
--     where table_schema = 'public' and table_name = 'webinars' and column_name = 'audience_restricts';
--     -- audience_restricts | boolean | NO | false
--   select p.oid::regprocedure, p.prosecdef, l.lanname, pg_get_function_result(p.oid) from pg_proc p
--     join pg_language l on l.oid = p.prolang where p.proname = 'communication_webinar_facts';
--     -- 1 linha: communication_webinar_facts(uuid[],uuid,integer), prosecdef false, plpgsql,
--     -- TABLE(user_id uuid, registered uuid[], attended uuid[])
--   select has_function_privilege('authenticated', 'public.communication_webinar_facts(uuid[], uuid, integer)', 'execute'); -- false
--   select has_function_privilege('service_role', 'public.communication_webinar_facts(uuid[], uuid, integer)', 'execute'); -- true
--   select count(*) from public.communication_webinar_facts(); -- roda (ate 1000 alunos com vaga ou presenca)
--   explain (analyze, buffers) select * from public.communication_webinar_facts(
--     array[(select user_id from public.webinar_registrations limit 1)]::uuid[]);
--     -- poucos ms e poucos buffers para 1 aluno, sem crescer com o historico (o filtro usa os indices por user_id)
--   explain (analyze, buffers) select * from public.communication_webinar_facts(null,
--     (select user_id from public.webinar_registrations order by user_id offset 500 limit 1), 1000);
--     -- uma pagina do meio no mesmo tempo que a primeira (por chave)
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. webinars.audience_restricts: "Quem tem o produto e está no segmento" (access_mode 'product' + true). MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinars
  add column if not exists audience_restricts boolean not null default false;

comment on column public.webinars.audience_restricts is
  'Com access_mode product: o segmento (audience) tambem e exigido ("Quem tem o produto e está no segmento"). O app de antes ignora e exige so o produto.';

/* ------------------------------------------------------------------------------------------------
 * 2. communication_webinar_facts: as lives de cada aluno (vaga e presenca) para as regras. MCP.
 * ---------------------------------------------------------------------------------------------- */

do $$
begin
  -- As versoes anteriores desta funcao (so p_user_ids: uma linha por aluno e live, e a que paginava por OFFSET). Com
  -- elas no ar, a chamada com p_user_ids daria "Could not choose the best candidate function" no PostgREST.
  if to_regprocedure('public.communication_webinar_facts(uuid[])') is not null then
    drop function public.communication_webinar_facts(uuid[]);
  end if;
end;
$$;

create or replace function public.communication_webinar_facts(p_user_ids uuid[] default null, p_after uuid default null, p_limit integer default 1000)
returns table (user_id uuid, registered uuid[], attended uuid[])
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  -- As sessoes em andamento (poucas): as amostras so delas, pela chave (session_id, user_id, bucket).
  v_open uuid[];
  v_ids uuid[];
  v_after uuid := coalesce(p_after, '00000000-0000-0000-0000-000000000000'::uuid);
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 1000);
begin
  select coalesce(array_agg(s.id), '{}') into v_open
  from public.webinar_sessions s
  where s.kind in ('live', 'simulated')
    and s.status in ('waiting', 'live');

  if p_user_ids is null then
    -- Todos os alunos, por chave (nunca OFFSET: cada pagina custa o mesmo e ninguem pula de pagina se uma vaga mudar no
    -- meio da leitura): os proximos v_limit alunos depois de p_after, na ordem do id, que tem alguma linha que conta.
    -- Cada fonte le pelo indice por user_id com o proprio limite e os mesmos filtros de baixo (por isso todo aluno
    -- escolhido volta com uma linha, e uma pagina menor que v_limit e a ultima).
    select coalesce(array_agg(c.uid order by c.uid), '{}') into v_ids
    from (
      select u.uid
      from (
        (
          select distinct r.user_id as uid
          from public.webinar_registrations r
          join public.webinars w on w.id = r.webinar_id and w.deleted_at is null
          where r.user_id > v_after
            and r.status = 'registered'
            and not exists (select 1 from public.admin_roles x where x.user_id = r.user_id)
          order by 1
          limit v_limit
        )
        union
        (
          select distinct a.user_id
          from public.webinar_attendance a
          join public.webinar_sessions s on s.id = a.session_id
          join public.webinars w on w.id = s.webinar_id and w.deleted_at is null
          where a.user_id > v_after
            and s.kind in ('live', 'simulated')
            and not exists (select 1 from public.admin_roles x where x.user_id = a.user_id)
          order by 1
          limit v_limit
        )
        union
        (
          select distinct ps.user_id
          from public.webinar_presence_samples ps
          join public.webinar_sessions s on s.id = ps.session_id
          join public.webinars w on w.id = s.webinar_id and w.deleted_at is null
          where ps.session_id = any (v_open)
            and ps.user_id > v_after
            and ps.bucket >= 0
            and not exists (select 1 from public.admin_roles x where x.user_id = ps.user_id)
          order by 1
          limit v_limit
        )
      ) u
      order by u.uid
      limit v_limit
    ) c;
  else
    -- So destes alunos (pedacos de 150).
    v_ids := p_user_ids;
  end if;

  -- As lives destes alunos: cada parte filtra por user_id = any (v_ids) (indices por user_id; as amostras, so as das
  -- sessoes em andamento, pela chave).
  return query
  with facts as (
    -- Vaga garantida (a cancelada nao conta).
    select r.user_id as uid, r.webinar_id as wid, true as is_registered, false as is_attended
    from public.webinar_registrations r
    where r.user_id = any (v_ids)
      and r.status = 'registered'
    union all
    -- Entrou na sala de uma sessao ao vivo ou gravada ja encerrada (o resumo da webinar_close_session).
    select a.user_id, s.webinar_id, false, true
    from public.webinar_attendance a
    join public.webinar_sessions s on s.id = a.session_id
    where a.user_id = any (v_ids)
      and s.kind in ('live', 'simulated')
    union all
    -- A sessao em andamento, ainda sem o resumo: as amostras depois do inicio (a sala de espera tem balde < 0).
    select distinct ps.user_id, s.webinar_id, false, true
    from public.webinar_presence_samples ps
    join public.webinar_sessions s on s.id = ps.session_id
    where ps.session_id = any (v_open)
      and ps.user_id = any (v_ids)
      and ps.bucket >= 0
  )
  select f.uid,
    array_agg(distinct f.wid) filter (where f.is_registered),
    array_agg(distinct f.wid) filter (where f.is_attended)
  from facts f
  join public.webinars w on w.id = f.wid and w.deleted_at is null
  where not exists (select 1 from public.admin_roles x where x.user_id = f.uid)
  group by f.uid
  order by f.uid;
end;
$$;

comment on function public.communication_webinar_facts(uuid[], uuid, integer) is
  'Por aluno: as lives em que garantiu vaga e as em que entrou na sala (ao vivo ou na Live gravada, por qualquer tempo; o replay nao conta), sem a equipe. Nulo = todos (docs/30 §1.6).';

revoke all on function public.communication_webinar_facts(uuid[], uuid, integer) from public, anon, authenticated;
grant execute on function public.communication_webinar_facts(uuid[], uuid, integer) to service_role;
