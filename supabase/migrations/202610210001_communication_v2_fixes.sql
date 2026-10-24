-- Comunicacao v2, correcoes da revisao (2026-10-21). A 202610200002 (ja aplicada na nuvem de teste) nao muda:
-- o que muda no banco vem aqui, por create or replace com as mesmas assinaturas (as permissoes ficam).
--
-- Regras:
-- - 1. passo que nasceu de primeiro nivel (filho da entrada) fica marcado (born_first_level, gatilho no
--   insert): o complemento das notificacoes seguintes (7.3) so completa esses; o passo que subiu de nivel
--   porque a condicao-pai saiu nunca vai para quem foi pelo outro caminho (docs/23 §2.7);
-- - 2. (7.1) tarefa presa que sai como falha fecha a passagem que ficou sem nada pendente;
-- - 3. (7.2) e 5. (7.4) a entrada e as decisoes de um lote levam a revision do fluxo lida junto com a
--   arvore: o fluxo mudou no meio (7.5 e 7.14 sobem a revision) = ninguem entra / a tarefa volta para a fila
--   (stale_version) e o motor decide de novo com a arvore atual. Sem revision (app antigo), nao confere;
-- - 4. (7.3) o complemento so vale para passo de primeiro nivel criado depois que o aluno entrou;
-- - tudo aplicavel pelo MCP, secao por secao: nada de drop, nada de delete.
--
-- Verificacao manual depois de aplicar:
--   select born_first_level, count(*) from public.communication_flow_nodes group by 1;
--   select tgname from pg_trigger where tgrelid = 'public.communication_flow_nodes'::regclass order by 1;
--
-- Idempotente: pode ser executada mais de uma vez sem efeito colateral.

/* ------------------------------------------------------------------------------------------------
 * 1. Passo que nasceu de primeiro nivel
 * ---------------------------------------------------------------------------------------------- */

alter table public.communication_flow_nodes add column if not exists born_first_level boolean not null default false;

comment on column public.communication_flow_nodes.born_first_level is
  'O passo foi criado como filho da entrada (primeiro nivel). Subir de nivel depois (condicao-pai removida) nao muda.';

create or replace function public.mark_flow_node_first_level()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  -- So no insert: o passo que sobe de nivel (7.5, condicao-pai removida) continua como nasceu.
  new.born_first_level = new.parent_id is not null and exists (
    select 1 from public.communication_flow_nodes e where e.id = new.parent_id and e.kind = 'entry'
  );

  return new;
end;
$$;

revoke all on function public.mark_flow_node_first_level() from public, anon, authenticated, service_role;

comment on function public.mark_flow_node_first_level() is
  'Trigger de communication_flow_nodes: marca o passo criado como filho da entrada (o complemento das seguintes so vale para ele).';

create or replace trigger set_communication_flow_nodes_first_level
  before insert on public.communication_flow_nodes
  for each row execute function public.mark_flow_node_first_level();

/* ------------------------------------------------------------------------------------------------
 * 2. (7.1) Reserva: tarefa presa que sai como falha fecha a passagem sem nada pendente
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.communication_claim_flow_tasks(
  p_now timestamptz, p_limit integer, p_stale_before timestamptz, p_max_attempts integer
)
returns setof public.communication_flow_tasks
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_flows uuid[];
  v_users uuid[];
begin
  with stuck as (
    select t.node_id, t.user_id
    from public.communication_flow_tasks t
    where t.flow_active and t.attempts >= p_max_attempts
      and (t.status = 'pending' or (t.status = 'running' and t.claimed_at < p_stale_before))
    limit 500
    for update skip locked
  ),
  failed as (
    update public.communication_flow_tasks t
    set status = 'skipped', result = 'failed', finished_at = p_now, claimed_at = null,
        last_error = coalesce(t.last_error, 'Muitas tentativas sem terminar.')
    from stuck s
    where t.node_id = s.node_id and t.user_id = s.user_id
    returning t.flow_id, t.user_id
  )
  select coalesce(array_agg(f.flow_id), array[]::uuid[]), coalesce(array_agg(f.user_id), array[]::uuid[])
  into v_flows, v_users
  from failed f;

  -- Passagens sem nada pendente terminam (como no fim de 7.4). Comando separado: dentro do mesmo WITH, o
  -- not exists ainda veria a tarefa presa como aberta.
  if cardinality(v_flows) > 0 then
    update public.communication_flow_runs fr
    set status = 'done', finished_at = p_now
    from unnest(v_flows, v_users) as stuck_run(flow_id, user_id)
    where fr.flow_id = stuck_run.flow_id and fr.user_id = stuck_run.user_id and fr.status = 'active'
      and not exists (
        select 1 from public.communication_flow_tasks t
        where t.flow_id = fr.flow_id and t.user_id = fr.user_id and t.status in ('pending', 'running')
      );
  end if;

  return query
  with candidates as (
    select t.node_id, t.user_id
    from public.communication_flow_tasks t
    join public.communication_flows f on f.id = t.flow_id
    where t.flow_active and f.status = 'active' and f.deleted_at is null and t.attempts < p_max_attempts
      and ((t.status = 'pending' and t.due_at <= p_now) or (t.status = 'running' and t.claimed_at < p_stale_before))
    order by t.due_at, t.node_id, t.user_id
    limit greatest(1, least(p_limit, 500))
    for update of t skip locked
  )
  update public.communication_flow_tasks t
  -- clock_timestamp: cada reserva tem um carimbo unico; a aplicacao confere esse carimbo exato. Nunca antes
  -- de p_now: a reserva velha (p_stale_before) e contada pelo mesmo relogio do tick (os testes simulam o
  -- tempo por p_now; em producao o relogio ja passou de p_now e o carimbo e o do relogio).
  set status = 'running', claimed_at = greatest(p_now, clock_timestamp()), attempts = t.attempts + 1
  from candidates c
  where t.node_id = c.node_id and t.user_id = c.user_id
  returning t.*;
end;
$$;

/* ------------------------------------------------------------------------------------------------
 * 3. (7.2) Entrada no fluxo do construtor com a revision lida pelo TS
 *    p_entries: [{ user_id, entered_at, baseline, revision, tasks: [{ node_id, anchor_at, due_at, deadline_at }] }]
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.communication_enroll_flow(p_flow_id uuid, p_entries jsonb)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
  v_revision integer;
begin
  select f.revision into v_revision from public.communication_flows f
  where f.id = p_flow_id and f.origin = 'builder' and f.status = 'active' and f.deleted_at is null
  for share;

  if not found then
    return 0;
  end if;

  -- Quem entra e os primeiros passos sairam de uma versao do fluxo que mudou no meio (regras ou passos):
  -- ninguem entra; o proximo tick refaz com a versao atual.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e
    where (e->>'revision') is not null and (e->>'revision')::integer is distinct from v_revision
  ) then
    return 0;
  end if;

  with entries as (
    select * from jsonb_to_recordset(p_entries) as e(user_id uuid, entered_at timestamptz, baseline boolean, tasks jsonb)
  ),
  inserted as (
    insert into public.communication_flow_runs (flow_id, user_id, status, entered_at, finished_at)
    select p_flow_id, e.user_id, case when e.baseline then 'baseline' else 'active' end, e.entered_at, null
    from entries e
    where not exists (select 1 from public.admin_roles a where a.user_id = e.user_id)
    on conflict (flow_id, user_id) do nothing
    returning user_id, status
  ),
  first_tasks as (
    insert into public.communication_flow_tasks (node_id, user_id, flow_id, anchor_at, due_at, deadline_at)
    select t.node_id, i.user_id, p_flow_id, t.anchor_at, t.due_at, t.deadline_at
    from inserted i
    join entries e on e.user_id = i.user_id
    cross join lateral jsonb_to_recordset(coalesce(e.tasks, '[]'::jsonb))
      as t(node_id uuid, anchor_at timestamptz, due_at timestamptz, deadline_at timestamptz)
    join public.communication_flow_nodes n
      on n.id = t.node_id and n.flow_id = p_flow_id and n.removed_at is null and n.parent_id is not null
      and n.parent_id = (select x.id from public.communication_flow_nodes x where x.flow_id = p_flow_id and x.kind = 'entry' and x.removed_at is null)
    where i.status = 'active'
    on conflict (node_id, user_id) do nothing
    returning 1
  )
  select count(*) into v_count from inserted where status = 'active';

  return v_count;
end;
$$;

/* ------------------------------------------------------------------------------------------------
 * 4. (7.3) Entrada das notificacoes seguintes: o complemento so vale para passo que nasceu de primeiro
 *    nivel depois que o aluno entrou
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.communication_enroll_notice_recipients(p_flow_id uuid, p_now timestamptz, p_limit integer)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_flow public.communication_flows%rowtype;
  v_source public.campaigns%rowtype;
  v_entry uuid;
  v_limit integer := greatest(1, least(p_limit, 5000));
  v_entered integer := 0;
  v_backfilled integer := 0;
  v_more boolean;
begin
  select * into v_flow from public.communication_flows f
  where f.id = p_flow_id and f.origin = 'notice' and f.status = 'active' and f.deleted_at is null and f.entry_completed_at is null
  for update;

  if not found then
    return jsonb_build_object('entered', 0, 'backfilled', 0, 'done', false, 'waiting', false);
  end if;

  select * into v_source from public.campaigns c where c.id = v_flow.source_campaign_id;

  if not found or v_source.status <> 'sent' or v_source.deleted_at is not null or v_source.sent_at is null then
    return jsonb_build_object('entered', 0, 'backfilled', 0, 'done', false, 'waiting', true);
  end if;

  select n.id into v_entry from public.communication_flow_nodes n
  where n.flow_id = p_flow_id and n.kind = 'entry' and n.removed_at is null;

  -- 1. Quem recebeu e ainda nao entrou: tarefas de todos os passos vivos de primeiro nivel.
  with picked as (
    select r.user_id, greatest(r.created_at, v_source.sent_at) as visible_at, r.expires_at
    from public.notifications r
    where r.campaign_id = v_source.id and not r.is_test
      and not exists (select 1 from public.communication_flow_runs fr where fr.flow_id = p_flow_id and fr.user_id = r.user_id)
      and not exists (select 1 from public.admin_roles a where a.user_id = r.user_id)
    order by r.id
    limit v_limit
  ),
  entered as (
    insert into public.communication_flow_runs (flow_id, user_id, status, entered_at)
    select p_flow_id, p.user_id, 'active', p.visible_at from picked p
    on conflict (flow_id, user_id) do nothing
    returning user_id
  ),
  first_tasks as (
    insert into public.communication_flow_tasks (node_id, user_id, flow_id, anchor_at, due_at, deadline_at)
    select c.id, p.user_id, p_flow_id,
      case when c.anchor = 'expires' then p.expires_at else p.visible_at end,
      case when c.anchor = 'expires' then p.expires_at - make_interval(mins => c.offset_minutes)
           else p.visible_at + make_interval(mins => c.offset_minutes) end,
      case when c.anchor = 'expires' then p.expires_at
           when c.wait_until_true then p.visible_at + make_interval(mins => c.offset_minutes + c.max_wait_minutes) end
    from picked p
    join entered e on e.user_id = p.user_id
    join public.communication_flow_nodes c on c.flow_id = p_flow_id and c.parent_id = v_entry and c.removed_at is null
    on conflict (node_id, user_id) do nothing
    returning 1
  )
  select count(*) into v_entered from entered;

  -- 2. Notificacao seguinte nova num aviso ja enviado: quem ja tinha entrado quando ela foi criada e nao tem
  --    a tarefa dela. So passo que nasceu de primeiro nivel: o que subiu de nivel porque a condicao-pai saiu
  --    nunca entra aqui (quem foi pelo outro caminho nao recebe; quem esperava na condicao para ali).
  with missing as (
    select r.user_id, greatest(r.created_at, v_source.sent_at) as visible_at, r.expires_at, fr.created_at as run_created_at
    from public.notifications r
    join public.communication_flow_runs fr
      on fr.flow_id = p_flow_id and fr.user_id = r.user_id and fr.status in ('active', 'done')
    where r.campaign_id = v_source.id and not r.is_test
      and exists (
        select 1 from public.communication_flow_nodes c
        where c.flow_id = p_flow_id and c.parent_id = v_entry and c.removed_at is null
          and c.born_first_level and c.created_at > fr.created_at
          and not exists (select 1 from public.communication_flow_tasks t where t.node_id = c.id and t.user_id = r.user_id)
      )
    order by r.id
    limit v_limit
  ),
  added as (
    insert into public.communication_flow_tasks (node_id, user_id, flow_id, anchor_at, due_at, deadline_at)
    select c.id, m.user_id, p_flow_id,
      case when c.anchor = 'expires' then m.expires_at else m.visible_at end,
      case when c.anchor = 'expires' then m.expires_at - make_interval(mins => c.offset_minutes)
           else m.visible_at + make_interval(mins => c.offset_minutes) end,
      case when c.anchor = 'expires' then m.expires_at
           when c.wait_until_true then m.visible_at + make_interval(mins => c.offset_minutes + c.max_wait_minutes) end
    from missing m
    join public.communication_flow_nodes c
      on c.flow_id = p_flow_id and c.parent_id = v_entry and c.removed_at is null
      and c.born_first_level and c.created_at > m.run_created_at
    on conflict (node_id, user_id) do nothing
    returning user_id
  ),
  reopened as (
    -- Executa mesmo sem ser lido (CTE que grava roda sempre ate o fim).
    update public.communication_flow_runs fr set status = 'active', finished_at = null
    where fr.flow_id = p_flow_id and fr.status = 'done' and fr.user_id in (select a.user_id from added a)
    returning 1
  )
  select count(distinct a.user_id) into v_backfilled from added a;

  -- Mesmo criterio do passo 2: quem nunca vai ganhar a tarefa nao segura o fluxo aberto.
  select
    exists (
      select 1 from public.notifications r
      where r.campaign_id = v_source.id and not r.is_test
        and not exists (select 1 from public.communication_flow_runs fr where fr.flow_id = p_flow_id and fr.user_id = r.user_id)
        and not exists (select 1 from public.admin_roles a where a.user_id = r.user_id)
    )
    or exists (
      select 1 from public.notifications r
      join public.communication_flow_runs fr
        on fr.flow_id = p_flow_id and fr.user_id = r.user_id and fr.status in ('active', 'done')
      where r.campaign_id = v_source.id and not r.is_test
        and exists (
          select 1 from public.communication_flow_nodes c
          where c.flow_id = p_flow_id and c.parent_id = v_entry and c.removed_at is null
            and c.born_first_level and c.created_at > fr.created_at
            and not exists (select 1 from public.communication_flow_tasks t where t.node_id = c.id and t.user_id = r.user_id)
        )
    )
  into v_more;

  if not v_more then
    update public.communication_flows f
    set entry_completed_at = p_now,
        entry_count = (select count(*) from public.communication_flow_runs fr where fr.flow_id = p_flow_id and fr.status <> 'baseline'),
        entry_counted_at = p_now
    where f.id = p_flow_id;
  end if;

  return jsonb_build_object('entered', v_entered, 'backfilled', v_backfilled, 'done', not v_more, 'waiting', false);
end;
$$;

/* ------------------------------------------------------------------------------------------------
 * 5. (7.4) Aplicacao das decisoes de um lote com a revision lida pelo TS
 *    p_results: [{ node_id, user_id, claimed_at, revision, action, result, due_at, deadline_at, error,
 *                  campaign_id, expires_at, children: [{ node_id, anchor_at, due_at, deadline_at }] }]
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.communication_apply_flow_results(
  p_now timestamptz,
  p_results jsonb,
  p_daily_cap integer,
  p_min_gap_minutes integer,
  p_max_deferrals integer,
  p_day_start timestamptz,
  p_next_day_start timestamptz
)
-- Colunas de saida com prefixo: nomes iguais aos das tabelas colidiriam dentro do plpgsql.
returns table (task_node_id uuid, task_user_id uuid, outcome text, sent_notification_id uuid)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  r record;
  v_task public.communication_flow_tasks%rowtype;
  v_flow public.communication_flows%rowtype;
  v_node public.communication_flow_nodes%rowtype;
  v_campaign public.campaigns%rowtype;
  v_sent integer;
  v_last timestamptz;
  v_due timestamptz;
  v_deadline timestamptz;
  v_notification uuid;
  v_dedupe text;
  v_touched_users uuid[] := array[]::uuid[];
  v_touched_flows uuid[] := array[]::uuid[];
begin
  -- Trava os fluxos do lote antes de qualquer tarefa (for share, em ordem de id). Pausar, retomar,
  -- encerrar, retirar um passo e salvar travam o fluxo for update antes de mexer em tarefas (7.5, 7.13,
  -- 7.14): esperam este lote terminar, e nada do que ele le muda no meio. Mesma ordem em todo lugar
  -- (fluxo, depois tarefas): sem deadlock.
  perform 1
  from public.communication_flows f
  where f.id in (
    select t.flow_id
    from jsonb_to_recordset(p_results) as x(node_id uuid, user_id uuid)
    join public.communication_flow_tasks t on t.node_id = x.node_id and t.user_id = x.user_id
  )
  order by f.id
  for share of f;

  for r in
    select * from jsonb_to_recordset(p_results) as x(
      node_id uuid, user_id uuid, claimed_at timestamptz, revision integer, action text, result text, due_at timestamptz,
      deadline_at timestamptz, error text, campaign_id uuid, expires_at timestamptz, children jsonb
    )
    order by x.user_id, x.node_id
  loop
    task_node_id := r.node_id; task_user_id := r.user_id; sent_notification_id := null;

    -- Teto de tempo do lote: o que sobrar depois de 10 s volta para a fila sem gastar tentativa. Assim
    -- uma notificacao gravada aqui fica visivel para os outros no maximo ~10 s depois do seu created_at
    -- (a folga de 15 s do "abriu o sino" em inbox.ts wasVisibleAt conta com isso).
    if clock_timestamp() > statement_timestamp() + interval '10 seconds' then
      update public.communication_flow_tasks t
      set status = 'pending', claimed_at = null, attempts = greatest(0, t.attempts - 1)
      where t.node_id = r.node_id and t.user_id = r.user_id and t.status = 'running' and t.claimed_at = r.claimed_at;
      outcome := 'released'; return next; continue;
    end if;

    select * into v_task from public.communication_flow_tasks t
    where t.node_id = r.node_id and t.user_id = r.user_id and t.status = 'running' and t.claimed_at = r.claimed_at
    for update;

    if not found then
      outcome := 'stale'; return next; continue;           -- cancelada, reservada de novo ou ja aplicada
    end if;

    -- O fluxo ja esta travado (for share) desde o comeco; o passo so muda dentro de 7.5, que espera.
    select * into v_flow from public.communication_flows f where f.id = v_task.flow_id;
    select * into v_node from public.communication_flow_nodes n where n.id = v_task.node_id;
    v_touched_users := v_touched_users || r.user_id;
    v_touched_flows := v_touched_flows || v_task.flow_id;

    if v_flow.deleted_at is not null or v_flow.status = 'ended' or v_node.removed_at is not null then
      update public.communication_flow_tasks t
      set status = 'canceled', result = case when v_node.removed_at is not null then 'removed' else 'flow_ended' end,
          finished_at = p_now, claimed_at = null
      where t.node_id = r.node_id and t.user_id = r.user_id;
      outcome := 'canceled'; return next; continue;
    end if;

    if v_flow.status <> 'active' then                     -- pausado entre a reserva e agora: volta para a fila
      update public.communication_flow_tasks t
      set status = 'pending', claimed_at = null, attempts = greatest(0, t.attempts - 1)
      where t.node_id = r.node_id and t.user_id = r.user_id;
      outcome := 'released'; return next; continue;
    end if;

    -- A decisao saiu de uma versao da arvore que mudou no meio (7.5 e 7.14 sobem a revision): filtros,
    -- condicoes, objetivo, referencia de tempo ou passos novos podem ser outros. Volta para a fila sem gastar
    -- tentativa e o motor decide de novo com a arvore atual (o TS tira o fluxo do cache do tick).
    if r.revision is not null and r.revision is distinct from v_flow.revision then
      update public.communication_flow_tasks t
      set status = 'pending', claimed_at = null, due_at = p_now, attempts = greatest(0, t.attempts - 1)
      where t.node_id = r.node_id and t.user_id = r.user_id;
      outcome := 'stale_version'; return next; continue;
    end if;

    if exists (select 1 from public.admin_roles a where a.user_id = r.user_id) then   -- virou equipe
      update public.communication_flow_tasks t
      set status = 'skipped', result = 'filtered', finished_at = p_now, claimed_at = null
      where t.node_id = r.node_id and t.user_id = r.user_id;
      outcome := 'filtered'; return next; continue;
    end if;

    if r.action = 'exit_goal' then
      update public.communication_flow_tasks t
      set status = 'canceled', result = 'goal', finished_at = p_now, claimed_at = null
      where t.flow_id = v_task.flow_id and t.user_id = r.user_id and t.status in ('pending', 'running');
      update public.communication_flow_runs fr set status = 'goal', finished_at = p_now
      where fr.flow_id = v_task.flow_id and fr.user_id = r.user_id and fr.status = 'active';
      outcome := 'goal'; return next; continue;
    end if;

    if r.action in ('defer', 'retry') then                -- ainda nao e a hora, proxima conferencia ou nova tentativa
      update public.communication_flow_tasks t
      set status = 'pending', claimed_at = null, due_at = r.due_at, deadline_at = coalesce(r.deadline_at, t.deadline_at),
          last_error = r.error, attempts = case when r.action = 'defer' then 0 else t.attempts end
      where t.node_id = r.node_id and t.user_id = r.user_id;
      outcome := r.action; return next; continue;
    end if;

    if r.action = 'send' then
      -- O conteudo ganhou versao nova entre a leitura e agora: decide de novo no proximo tick.
      if v_node.campaign_id is distinct from r.campaign_id then
        update public.communication_flow_tasks t
        set status = 'pending', claimed_at = null, due_at = p_now, attempts = greatest(0, t.attempts - 1)
        where t.node_id = r.node_id and t.user_id = r.user_id;
        outcome := 'stale_version'; return next; continue;
      end if;

      v_dedupe := 'flow:' || r.node_id::text;
      v_deadline := coalesce(r.deadline_at, v_task.deadline_at);
      perform pg_advisory_xact_lock(hashtextextended(r.user_id::text, 707));
      select n.id into v_notification from public.notifications n where n.user_id = r.user_id and n.dedupe_key = v_dedupe;

      if v_notification is null then
        -- Envios automaticos de hoje (dia de Sao Paulo) e o ultimo deles, olhando tambem antes da
        -- meia-noite: o intervalo de 1 h vale na virada do dia.
        select count(*) filter (where n.created_at >= p_day_start), max(n.created_at) into v_sent, v_last
        from public.notifications n
        where n.user_id = r.user_id and n.flow_node_id is not null and not n.is_test
          and n.created_at >= least(p_day_start, p_now - make_interval(mins => p_min_gap_minutes));

        if v_sent >= p_daily_cap or (v_last is not null and v_last > p_now - make_interval(mins => p_min_gap_minutes)) then
          v_due := case when v_sent >= p_daily_cap then p_next_day_start + interval '8 hours'
                        else v_last + make_interval(mins => p_min_gap_minutes) end;

          -- Um envio adiado nunca cai entre 00:00 e 08:00 de Sao Paulo.
          if v_due < p_day_start + interval '8 hours' then
            v_due := p_day_start + interval '8 hours';
          elsif v_due >= p_next_day_start and v_due < p_next_day_start + interval '8 hours' then
            v_due := p_next_day_start + interval '8 hours';
          end if;

          if (v_deadline is not null and v_due >= v_deadline - interval '15 minutes') or v_task.deferrals >= p_max_deferrals then
            update public.communication_flow_tasks t
            set status = 'skipped', result = 'cap', finished_at = p_now, claimed_at = null
            where t.node_id = r.node_id and t.user_id = r.user_id;
            outcome := 'cap_skipped'; return next; continue;
          end if;

          -- not_before: acordar esta tarefa antes disso (varredura do objetivo, espera editada) nunca a
          -- envia nem gasta outro adiamento (regra 3 de decideFlowTask).
          update public.communication_flow_tasks t
          set status = 'pending', claimed_at = null, due_at = v_due, not_before = v_due, deadline_at = v_deadline,
              deferrals = t.deferrals + 1, attempts = 0
          where t.node_id = r.node_id and t.user_id = r.user_id;
          outcome := 'deferred'; return next; continue;
        end if;

        select * into v_campaign from public.campaigns c
        where c.id = r.campaign_id and c.deleted_at is null and c.status = 'sent'
        for share;

        if not found then                                  -- passo retirado do sino
          update public.communication_flow_tasks t
          set status = 'skipped', result = 'withdrawn', finished_at = p_now, claimed_at = null
          where t.node_id = r.node_id and t.user_id = r.user_id;
          outcome := 'withdrawn'; return next; continue;
        end if;

        if r.expires_at <= p_now + interval '15 minutes'
           or (v_campaign.valid_until is not null and v_campaign.valid_until <= p_now + interval '15 minutes') then
          update public.communication_flow_tasks t
          set status = 'skipped', result = 'expired', finished_at = p_now, claimed_at = null
          where t.node_id = r.node_id and t.user_id = r.user_id;
          outcome := 'expired'; return next; continue;
        end if;

        -- created_at = a hora real da gravacao (nunca antes de p_now). A linha so fica visivel no commit,
        -- ate ~10 s depois (teto acima): o "abriu o sino" e o "Marcar todas" so contam uma linha de fluxo
        -- com created_at ate asOf - 15 s (inbox.ts wasVisibleAt), entao nunca marcam o que o painel nao mostrou.
        insert into public.notifications (user_id, kind, campaign_id, dedupe_key, flow_id, flow_node_id, expires_at, created_at)
        values (r.user_id, 'notice', v_campaign.id, v_dedupe, v_task.flow_id, r.node_id, r.expires_at, greatest(p_now, clock_timestamp()))
        on conflict (user_id, dedupe_key) do nothing
        returning id into v_notification;

        if v_notification is null then
          select n.id into v_notification from public.notifications n where n.user_id = r.user_id and n.dedupe_key = v_dedupe;
        end if;
      end if;

      update public.communication_flow_tasks t
      set status = 'done', result = 'sent', notification_id = v_notification, finished_at = p_now, claimed_at = null
      where t.node_id = r.node_id and t.user_id = r.user_id;
      sent_notification_id := v_notification;
    else                                                   -- finish: yes | no | filtered | expired | failed
      update public.communication_flow_tasks t
      set status = case when r.result in ('yes', 'no') then 'done' else 'skipped' end,
          result = r.result, last_error = r.error, finished_at = p_now, claimed_at = null
      where t.node_id = r.node_id and t.user_id = r.user_id;
    end if;

    -- Proximos passos: so filhos deste passo, so o lado escolhido da condicao, so depois de enviar ou decidir.
    if r.action = 'send' or r.result in ('yes', 'no') then
      insert into public.communication_flow_tasks (node_id, user_id, flow_id, anchor_at, due_at, deadline_at)
      select c.node_id, r.user_id, v_task.flow_id, c.anchor_at, c.due_at, c.deadline_at
      from jsonb_to_recordset(coalesce(r.children, '[]'::jsonb))
        as c(node_id uuid, anchor_at timestamptz, due_at timestamptz, deadline_at timestamptz)
      join public.communication_flow_nodes n
        on n.id = c.node_id and n.flow_id = v_task.flow_id and n.removed_at is null and n.parent_id = r.node_id
        and (v_node.kind <> 'condition' or n.branch = r.result)
      on conflict (node_id, user_id) do nothing;
    end if;

    outcome := coalesce(r.result, r.action); return next;
  end loop;

  -- Passagens sem nada pendente terminam.
  update public.communication_flow_runs fr
  set status = 'done', finished_at = p_now
  from unnest(v_touched_flows, v_touched_users) as touched(flow_id, user_id)
  where fr.flow_id = touched.flow_id and fr.user_id = touched.user_id and fr.status = 'active'
    and not exists (
      select 1 from public.communication_flow_tasks t
      where t.flow_id = fr.flow_id and t.user_id = fr.user_id and t.status in ('pending', 'running')
    );
end;
$$;

/* ------------------------------------------------------------------------------------------------
 * 6. Permissoes das funcoes (assinatura exata, as mesmas da 202610200002) e descricoes
 * ---------------------------------------------------------------------------------------------- */

revoke all on function public.communication_claim_flow_tasks(timestamptz, integer, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.communication_claim_flow_tasks(timestamptz, integer, timestamptz, integer) to service_role;
comment on function public.communication_claim_flow_tasks(timestamptz, integer, timestamptz, integer) is
  'Reserva tarefas vencidas de fluxos no ar (skip locked, carimbo unico); a que caiu muitas vezes sai como falha e fecha a passagem sem nada pendente.';

revoke all on function public.communication_enroll_flow(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.communication_enroll_flow(uuid, jsonb) to service_role;
comment on function public.communication_enroll_flow(uuid, jsonb) is
  'Entrada de alunos num fluxo do construtor no ar: passagem (uma vez por fluxo) e tarefas dos primeiros passos, na revision avaliada. Sem a equipe.';

revoke all on function public.communication_enroll_notice_recipients(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.communication_enroll_notice_recipients(uuid, timestamptz, integer) to service_role;
comment on function public.communication_enroll_notice_recipients(uuid, timestamptz, integer) is
  'Entrada das notificacoes seguintes de um aviso enviado (e o complemento de uma seguinte nova de primeiro nivel), em lotes, retomavel.';

revoke all on function public.communication_apply_flow_results(timestamptz, jsonb, integer, integer, integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.communication_apply_flow_results(timestamptz, jsonb, integer, integer, integer, timestamptz, timestamptz) to service_role;
comment on function public.communication_apply_flow_results(timestamptz, jsonb, integer, integer, integer, timestamptz, timestamptz) is
  'Aplica as decisoes de um lote do motor numa transacao (na revision decidida): envio uma vez por aluno, limite diario e intervalo de 1 h, proximos passos.';
