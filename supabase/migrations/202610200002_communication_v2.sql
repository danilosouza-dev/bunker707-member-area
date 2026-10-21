-- Comunicacao v2 (2026-10-21): quem envia e icone de cada notificacao, quanto tempo ela fica no sino,
-- audio ouvido (48 trechos), "abriu" de verdade, notificacoes seguintes e fluxos com regras (um motor so,
-- fase 2 do job "comunicacao" no tick de minuto) e visitas das paginas da area do aluno (so as que um
-- fluxo no ar usa). Decisoes em docs/23 e docs/22. A 202610200001 (ja aplicada) nao muda.
--
-- Regras:
-- - campaigns ganha quem envia (sender_user_id; nulo = a escola), o icone ao lado do titulo (icon +
--   icon_color, ids do catalogo do app), quanto tempo fica no sino (validity_minutes ou valid_until; os
--   dois nulos = 90 dias) e o passo do fluxo (flow_id + flow_node_id: conteudo de um passo, fora da
--   lista de avisos; situacao draft, sent ou canceled);
-- - notifications ganha expires_at (sempre preenchido: o gatilho poe created_at + 90 dias quando o app
--   nao manda; depois disso some do sino, dos numeros e do "Marcar todas"), opened_at (interacao de
--   verdade; "Marcar todas" nao conta), o audio ouvido (audio_heard: 48 trechos "0"/"1", OU acumulado) e
--   o passo do fluxo que a gerou (dedupe_key "flow:<passo>": uma vez por aluno);
-- - communication_flows / _flow_nodes / _flow_runs / _flow_tasks: o fluxo, a arvore de passos, a passagem
--   de cada aluno (uma vez por fluxo) e o trabalho por (passo, aluno) (nunca roda duas vezes);
-- - member_page_visits: a ultima visita de cada aluno a cada pagina (chave normalizada, sem query),
--   gravada so para as chaves que um fluxo no ar usa;
-- - nada aqui e lido pelo navegador: RLS ligado, nada para anon/authenticated, so service_role;
-- - secoes 1 a 8 aplicaveis pelo MCP; 9 (retencao, delete dentro de funcao) pelo SQL Editor ou psql se
--   o MCP travar;
-- - aplicar antes do deploy que usa estas colunas (o app nao tem caminho de volta para as colunas da v1).
--
-- Verificacao manual depois de aplicar:
--   select status, origin, count(*) from public.communication_flows group by 1, 2;
--   select status, result, count(*) from public.communication_flow_tasks group by 1, 2;
--   select count(*) filter (where expires_at is null) as sem_fim, count(*) from public.notifications;
--   select page_key, count(*) from public.member_page_visits group by 1 order by 2 desc limit 20;
--   select conname from pg_constraint where conrelid = 'public.notifications'::regclass order by 1;
--
-- Idempotente: pode ser executada mais de uma vez sem efeito colateral.

/* ------------------------------------------------------------------------------------------------
 * 1. Fluxos
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.communication_flows (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- builder = criado em Comunicacao > Fluxos; notice = as notificacoes seguintes de um aviso.
  origin text not null default 'builder' check (origin in ('builder', 'notice')),
  source_campaign_id uuid references public.campaigns(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'active', 'paused', 'ended')),
  -- Quem entra (mesmo formato de campaigns.audience). Ignorado no "notice".
  entry_audience jsonb not null default '{"kind":"everyone"}'::jsonb
    check (jsonb_typeof(entry_audience) = 'object' and pg_column_size(entry_audience) <= 16384),
  -- current = quem esta no segmento ao ativar; current_and_new = e quem entrar depois;
  -- new_only = so quem passar a combinar depois de ativar (quem ja combinava vira "baseline").
  entry_mode text not null default 'current' check (entry_mode in ('current', 'current_and_new', 'new_only')),
  -- Objetivo: o aluno sai do fluxo quando combinar (nulo = sem objetivo).
  goal jsonb check (goal is null or (jsonb_typeof(goal) = 'object' and pg_column_size(goal) <= 16384)),
  -- Paginas cujas visitas este fluxo usa (regras + pagina do botao), calculadas pelo app ao salvar.
  watched_page_keys text[] not null default '{}' check (cardinality(watched_page_keys) <= 50),
  -- Muda a cada gravacao da tela: duas telas salvando so passos tambem dao 409.
  revision integer not null default 0 check (revision >= 0),
  entry_count integer check (entry_count is null or entry_count >= 0),
  entry_counted_at timestamptz,
  -- Ultima faixa de 15 minutos em que o job conferiu quem entra (nulo = entrada inicial pendente).
  entry_refreshed_at timestamptz,
  -- "notice": todos os que receberam a notificacao de origem ja entraram.
  entry_completed_at timestamptz,
  goal_swept_at timestamptz,
  activated_at timestamptz,
  paused_at timestamptz,
  ended_at timestamptz,
  ended_reason text check (ended_reason is null or ended_reason in ('team', 'finished', 'source_withdrawn', 'source_deleted')),
  last_error text check (last_error is null or char_length(last_error) <= 2000),
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
  constraint communication_flows_origin check ((origin = 'notice') = (source_campaign_id is not null)),
  constraint communication_flows_ended check ((status = 'ended') = (ended_at is not null))
);

create unique index if not exists communication_flows_source_idx
  on public.communication_flows (source_campaign_id) where source_campaign_id is not null and deleted_at is null;
create index if not exists communication_flows_live_idx
  on public.communication_flows (entry_refreshed_at nulls first) where status = 'active' and deleted_at is null;
create index if not exists communication_flows_list_idx
  on public.communication_flows (created_at desc) where deleted_at is null and origin = 'builder';

-- updated_at e a versao do editor (409). O que o job grava nao conta como edicao (licao do
-- touch_campaign_version da v1): contagem, faixas conferidas, varredura do objetivo e erro.
create or replace function public.touch_flow_version()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (to_jsonb(new) - array['entry_count', 'entry_counted_at', 'entry_refreshed_at', 'entry_completed_at', 'goal_swept_at', 'last_error', 'updated_at'])
    is distinct from (to_jsonb(old) - array['entry_count', 'entry_counted_at', 'entry_refreshed_at', 'entry_completed_at', 'goal_swept_at', 'last_error', 'updated_at']) then
    new.updated_at = now();
  else
    new.updated_at = old.updated_at;
  end if;

  return new;
end;
$$;

revoke all on function public.touch_flow_version() from public, anon, authenticated, service_role;

comment on function public.touch_flow_version() is
  'Trigger de communication_flows: muda updated_at (versao do editor) so quando a equipe muda algo; o que o job grava nao conta.';

create or replace trigger set_communication_flows_version
  before update on public.communication_flows
  for each row execute function public.touch_flow_version();

alter table public.communication_flows enable row level security;
revoke all on public.communication_flows from anon, authenticated;
grant select, insert, update, delete on public.communication_flows to service_role;

comment on table public.communication_flows is
  'Fluxos da Comunicacao: quem entra (regras), objetivo e situacao; origin=notice sao as notificacoes seguintes de um aviso. Escrita somente pelo servidor.';

/* ------------------------------------------------------------------------------------------------
 * 2. Passos (arvore: entrada -> notificacao | condicao Sim/Nao)
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.communication_flow_nodes (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.communication_flows(id) on delete cascade,
  parent_id uuid references public.communication_flow_nodes(id) on delete cascade,
  -- Lado da condicao-pai ('yes' | 'no'); nulo quando o pai e a entrada ou uma notificacao.
  branch text check (branch is null or branch in ('yes', 'no')),
  kind text not null check (kind in ('entry', 'message', 'condition')),
  position smallint not null default 0 check (position between 0 and 100),
  -- Quando: depois do passo anterior, depois do envio de uma notificacao do caminho ou antes de ela vencer.
  anchor text not null default 'previous' check (anchor in ('previous', 'sent', 'expires')),
  anchor_node_id uuid references public.communication_flow_nodes(id),
  offset_minutes integer not null default 0 check (offset_minutes between 0 and 86400 and offset_minutes % 5 = 0),
  -- Notificacao: o conteudo (versao atual) e o filtro "So para quem..." (nulo = todos que chegam).
  campaign_id uuid references public.campaigns(id),
  filter jsonb check (filter is null or (jsonb_typeof(filter) = 'object' and pg_column_size(filter) <= 16384)),
  -- "Ate a notificacao principal sumir": fica no sino ate a notificacao de referencia (anchor_node_id)
  -- sumir para cada aluno (expires_at dela), nunca mais que a validade do conteudo.
  expire_with_anchor boolean not null default false,
  -- Condicao: as regras e o "esperar ate ser Sim".
  condition jsonb check (condition is null or (jsonb_typeof(condition) = 'object' and pg_column_size(condition) <= 16384)),
  wait_until_true boolean not null default false,
  max_wait_minutes integer check (max_wait_minutes is null or max_wait_minutes between 15 and 43200),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint communication_flow_nodes_entry check ((kind = 'entry') = (parent_id is null)),
  constraint communication_flow_nodes_message check ((kind = 'message') = (campaign_id is not null)),
  constraint communication_flow_nodes_condition check ((kind = 'condition') = (condition is not null)),
  constraint communication_flow_nodes_wait check (
    (wait_until_true = (max_wait_minutes is not null)) and (not wait_until_true or kind = 'condition')
  ),
  constraint communication_flow_nodes_anchor check (
    ((anchor = 'previous') = (anchor_node_id is null))
    and (kind <> 'entry' or (anchor = 'previous' and offset_minutes = 0 and filter is null))
    and (kind <> 'condition' or filter is null)
    and (anchor <> 'expires' or offset_minutes >= 15)
    and (not expire_with_anchor or (kind = 'message' and anchor in ('sent', 'expires')))
  )
);

create unique index if not exists communication_flow_nodes_one_entry_idx
  on public.communication_flow_nodes (flow_id) where kind = 'entry' and removed_at is null;
create index if not exists communication_flow_nodes_flow_idx
  on public.communication_flow_nodes (flow_id, parent_id) where removed_at is null;

create or replace trigger set_communication_flow_nodes_updated_at
  before update on public.communication_flow_nodes
  for each row execute function public.set_updated_at();

alter table public.communication_flow_nodes enable row level security;
revoke all on public.communication_flow_nodes from anon, authenticated;
grant select, insert, update, delete on public.communication_flow_nodes to service_role;

comment on table public.communication_flow_nodes is
  'Passos de um fluxo em arvore (entrada, notificacao, condicao Sim/Nao) com o "quando" de cada um. Removido = removed_at (os numeros ficam). Escrita somente pelo servidor.';

/* ------------------------------------------------------------------------------------------------
 * 3. Avisos: quem envia, icone, quanto tempo fica no sino, passo do fluxo
 * ---------------------------------------------------------------------------------------------- */

alter table public.campaigns
  add column if not exists sender_user_id uuid references auth.users(id) on delete set null,
  add column if not exists icon text,
  add column if not exists icon_color text,
  add column if not exists validity_minutes integer,
  add column if not exists valid_until timestamptz,
  add column if not exists flow_id uuid references public.communication_flows(id) on delete cascade,
  -- Sem FK de proposito: o passo aponta para a versao atual (nodes.campaign_id) e a versao nasce antes
  -- do passo. A integridade vem do flow_id (cascade) e do RPC que grava os passos (confere os dois).
  add column if not exists flow_node_id uuid;

comment on column public.campaigns.sender_user_id is
  'Quem envia (pessoa da equipe, admin_roles). Nulo = a escola. Fora da equipe na hora de mostrar = a escola.';
comment on column public.campaigns.icon is 'Icone ao lado do titulo (id do catalogo em message-meta.ts). Nulo = sem icone. Id desconhecido nao desenha nada.';
comment on column public.campaigns.validity_minutes is 'Quanto tempo a notificacao fica no sino depois de chegar (60 a 129600 = 90 dias). Nulo com valid_until nulo = 90 dias.';
comment on column public.campaigns.valid_until is 'Ate quando a notificacao fica no sino (data fixa). Exclui validity_minutes.';
comment on column public.campaigns.flow_id is 'Conteudo de um passo de fluxo (fora da lista de avisos). Situacao: draft ate ativar, sent depois, canceled se retirada.';

do $$
begin
  -- Formato, nao lista: o catalogo de icones e cores muda no app sem migracao (o servidor confere a lista).
  if not exists (select 1 from pg_constraint where conname = 'campaigns_icon_v2') then
    alter table public.campaigns add constraint campaigns_icon_v2 check (
      (icon is null) = (icon_color is null)
      and (icon is null or icon ~ '^[a-z][a-z0-9_]{1,23}$')
      and (icon_color is null or icon_color ~ '^[a-z]{3,12}$')
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'campaigns_validity_v2') then
    alter table public.campaigns add constraint campaigns_validity_v2 check (
      (validity_minutes is null or validity_minutes between 60 and 129600)
      and not (validity_minutes is not null and valid_until is not null)
    );
  end if;

  -- Quem envia, o tempo no sino e o passo de fluxo sao da notificacao; o pop-up so ganha o icone.
  if not exists (select 1 from pg_constraint where conname = 'campaigns_inbox_only_v2') then
    alter table public.campaigns add constraint campaigns_inbox_only_v2 check (
      kind = 'inbox' or (sender_user_id is null and validity_minutes is null and valid_until is null and flow_id is null)
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'campaigns_flow_message_v2') then
    alter table public.campaigns add constraint campaigns_flow_message_v2 check (
      (flow_id is null) = (flow_node_id is null)
      and (flow_id is null or status in ('draft', 'sent', 'canceled'))
    );
  end if;
end;
$$;

create index if not exists campaigns_flow_node_idx on public.campaigns (flow_node_id) where flow_node_id is not null;
-- A lista de avisos passa a filtrar flow_id is null.
create index if not exists campaigns_notice_list_idx on public.campaigns (created_at desc) where deleted_at is null and flow_id is null;

/* ------------------------------------------------------------------------------------------------
 * 4. Sino: fim, abriu de verdade, audio ouvido e passo do fluxo
 * ---------------------------------------------------------------------------------------------- */

alter table public.notifications
  add column if not exists expires_at timestamptz,
  add column if not exists opened_at timestamptz,
  add column if not exists audio_started_at timestamptz,
  add column if not exists audio_heard text,
  add column if not exists audio_heard_percent smallint,
  add column if not exists audio_completed_at timestamptz,
  -- Cascade (e nao set null): fluxo apagado de verdade (cascata do aviso de origem, limpeza dos testes) leva
  -- as linhas junto, como o conteudo do passo (campaigns.flow_id) ja levaria. Com set null, o flow_id ficaria
  -- nulo antes de o passo sumir (flow_node_id ainda preenchido) e o check notifications_flow_v2 recusaria.
  -- O app nunca apaga fluxo: exclui com deleted_at.
  add column if not exists flow_id uuid references public.communication_flows(id) on delete cascade,
  add column if not exists flow_node_id uuid references public.communication_flow_nodes(id) on delete set null;

comment on column public.notifications.expires_at is
  'Some do sino depois disto. O app calcula pela validade do aviso; sem valor, o gatilho poe created_at + 90 dias (comentarios e v1).';
comment on column public.notifications.opened_at is
  'Interacao de verdade (cartao, Ver mais, audio, botao, resposta, leitura por id). "Marcar todas" e abrir o sino nao contam.';
comment on column public.notifications.audio_heard is
  '48 trechos do audio ("1" = ouvido pelos trechos tocados de verdade), acumulados por OU. Ouvido = 44 ou mais.';

-- O app sempre manda expires_at nas notificacoes de aviso; o resto (comentarios, v1) ganha 90 dias.
create or replace function public.set_notification_expiry()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.expires_at is null then
    new.expires_at = new.created_at + interval '90 days';
  end if;

  return new;
end;
$$;

revoke all on function public.set_notification_expiry() from public, anon, authenticated, service_role;

comment on function public.set_notification_expiry() is
  'Trigger de notifications: sem expires_at (comentarios, v1), a linha fica no sino por 90 dias a partir de created_at.';

create or replace trigger set_notifications_expiry
  before insert on public.notifications
  for each row execute function public.set_notification_expiry();

update public.notifications set expires_at = created_at + interval '90 days' where expires_at is null;
alter table public.notifications alter column expires_at set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_expires_v2') then
    alter table public.notifications add constraint notifications_expires_v2 check (expires_at > created_at);
  end if;

  -- Sem "aberta implica lida": o app sempre grava read_at junto com opened_at (coalesce), e a linha aberta pode
  -- voltar a "nao lida" sem perder o "abriu" (os testes da v1 fazem isso direto na tabela).
  if not exists (select 1 from pg_constraint where conname = 'notifications_engagement_v2') then
    alter table public.notifications add constraint notifications_engagement_v2 check (
      (audio_started_at is null or opened_at is not null)
      and (audio_completed_at is null or audio_started_at is not null)
      and (audio_heard is null or audio_heard ~ '^[01]{48}$')
      and (audio_heard_percent is null or audio_heard_percent between 0 and 100)
      and ((audio_heard is null) = (audio_heard_percent is null))
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'notifications_flow_v2') then
    alter table public.notifications add constraint notifications_flow_v2 check (
      flow_node_id is null or (flow_id is not null and kind = 'notice')
    );
  end if;
end;
$$;

-- Limite diario (3 por dia, 1 h entre elas): as automaticas do aluno no dia.
create index if not exists notifications_user_auto_idx
  on public.notifications (user_id, created_at desc) where flow_node_id is not null and not is_test;
-- Relatorio por passo e por fluxo.
create index if not exists notifications_flow_node_idx on public.notifications (flow_node_id) where flow_node_id is not null;
create index if not exists notifications_flow_idx on public.notifications (flow_id) where flow_id is not null;

/* ------------------------------------------------------------------------------------------------
 * 5. Passagem de cada aluno e trabalho por (passo, aluno)
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.communication_flow_runs (
  flow_id uuid not null references public.communication_flows(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- active = no fluxo; done = terminou o caminho; goal = saiu pelo objetivo; ended = fluxo encerrado;
  -- baseline = ja combinava ao ativar um fluxo "so quem entrar depois" (nunca entra).
  status text not null default 'active' check (status in ('active', 'done', 'goal', 'ended', 'baseline')),
  entered_at timestamptz not null,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (flow_id, user_id),
  constraint communication_flow_runs_finished check ((status in ('active', 'baseline')) = (finished_at is null))
);

create index if not exists communication_flow_runs_status_idx on public.communication_flow_runs (flow_id, status);
create index if not exists communication_flow_runs_user_idx on public.communication_flow_runs (user_id);

create or replace trigger set_communication_flow_runs_updated_at
  before update on public.communication_flow_runs
  for each row execute function public.set_updated_at();

create table if not exists public.communication_flow_tasks (
  node_id uuid not null references public.communication_flow_nodes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  flow_id uuid not null references public.communication_flows(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'skipped', 'canceled')),
  result text check (result is null or result in (
    'sent', 'yes', 'no', 'filtered', 'goal', 'expired', 'cap', 'failed', 'removed', 'withdrawn', 'flow_ended', 'source_withdrawn'
  )),
  -- Base do "quando" para este aluno (fim do passo anterior, envio ou fim da notificacao de referencia).
  -- O motor recalcula o horario a partir daqui; due_at e so o proximo horario de conferencia.
  anchor_at timestamptz not null,
  due_at timestamptz not null,
  deadline_at timestamptz,
  -- Para onde o limite diario ou o intervalo de 1 h empurrou o envio: o motor nunca envia antes disto,
  -- mesmo acordado cedo (varredura do objetivo, espera editada); so o RPC de aplicacao grava.
  not_before timestamptz,
  deferrals smallint not null default 0 check (deferrals between 0 and 100),
  -- Copia de "o fluxo esta no ar" (status = 'active'), mantida pelo RPC de situacao (7.13) na mesma
  -- transacao: as sondagens e a reserva leem so o indice parcial, sem as tarefas de fluxo pausado.
  flow_active boolean not null default true,
  attempts smallint not null default 0 check (attempts between 0 and 20),
  claimed_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 2000),
  notification_id uuid references public.notifications(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (node_id, user_id),
  constraint communication_flow_tasks_finished check ((status in ('done', 'skipped', 'canceled')) = (finished_at is not null)),
  constraint communication_flow_tasks_claim check ((status = 'running') = (claimed_at is not null))
);

create index if not exists communication_flow_tasks_due_idx
  on public.communication_flow_tasks (due_at) where status = 'pending' and flow_active;
create index if not exists communication_flow_tasks_running_idx
  on public.communication_flow_tasks (claimed_at) where status = 'running' and flow_active;
create index if not exists communication_flow_tasks_flow_idx on public.communication_flow_tasks (flow_id, status);
create index if not exists communication_flow_tasks_open_idx
  on public.communication_flow_tasks (flow_id, user_id) where status in ('pending', 'running');
-- Varredura do objetivo: quem esta esperando ha mais tempo sem ser conferido.
create index if not exists communication_flow_tasks_sweep_idx
  on public.communication_flow_tasks (flow_id, updated_at) where status = 'pending';
-- Tarefa presa (o tick caiu com ela varias vezes): sai como falha.
create index if not exists communication_flow_tasks_stuck_idx
  on public.communication_flow_tasks (attempts) where status in ('pending', 'running') and flow_active;

create or replace trigger set_communication_flow_tasks_updated_at
  before update on public.communication_flow_tasks
  for each row execute function public.set_updated_at();

alter table public.communication_flow_runs enable row level security;
alter table public.communication_flow_tasks enable row level security;
revoke all on public.communication_flow_runs from anon, authenticated;
revoke all on public.communication_flow_tasks from anon, authenticated;
grant select, insert, update, delete on public.communication_flow_runs to service_role;
grant select, insert, update, delete on public.communication_flow_tasks to service_role;

comment on table public.communication_flow_runs is 'Passagem de cada aluno por um fluxo (uma vez por fluxo). Escrita somente pelo servidor.';
comment on table public.communication_flow_tasks is
  'Trabalho do motor por (passo, aluno): quando confere, o que deu (enviou, Sim, Nao, pulou e por que). Escrita somente pelo servidor.';

/* ------------------------------------------------------------------------------------------------
 * 6. Visitas das paginas da area do aluno (ultima visita por pagina)
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.member_page_visits (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Chave normalizada (page-visit-model.ts). Nunca o endereco com query.
  page_key text not null check (
    page_key ~ '^(home|purchases|saved|materials|journey|continue|profile|support|content:[A-Za-z0-9_-]{1,240}|checkout:[A-Za-z0-9_-]{1,240})$'
  ),
  first_visited_at timestamptz not null default now(),
  last_visited_at timestamptz not null default now(),
  primary key (user_id, page_key),
  constraint member_page_visits_order check (last_visited_at >= first_visited_at)
);

create index if not exists member_page_visits_key_idx on public.member_page_visits (page_key, last_visited_at desc);

alter table public.member_page_visits enable row level security;
revoke all on public.member_page_visits from anon, authenticated;
grant select, insert, update, delete on public.member_page_visits to service_role;

comment on table public.member_page_visits is
  'Ultima visita de cada aluno a cada pagina da area (e clique em Comprar), gravada pelo servidor so para as paginas que um fluxo no ar usa. Retencao 24 meses.';

/* ------------------------------------------------------------------------------------------------
 * 7. RPCs do motor, dos numeros e do sino (so service_role; security invoker)
 *
 * Todas com search_path fixo. Erros proprios: BK404 (nao existe), BK409 (mudou em outra tela) e BK422
 * (mudanca recusada); o TypeScript le error.code. Nenhuma apaga linha: retirar um passo cancela aqui e
 * o TypeScript apaga as linhas do sino depois (como o withdrawNotice da v1).
 * ---------------------------------------------------------------------------------------------- */

-- 7.1 Reserva atomica de tarefas vencidas, so de fluxos no ar (flow_active). Dois ticks nunca pegam a
--     mesma (skip locked); a de um tick que caiu volta depois de 2 minutos. So a queda conta como
--     tentativa: o lote solto por erro passageiro devolve a tentativa (secao 4.3, passo 4e). A que ja caiu
--     p_max_attempts vezes sai como falha, sem tocar em linha que outro tick acabou de reservar.
create or replace function public.communication_claim_flow_tasks(
  p_now timestamptz, p_limit integer, p_stale_before timestamptz, p_max_attempts integer
)
returns setof public.communication_flow_tasks
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  with stuck as (
    select t.node_id, t.user_id
    from public.communication_flow_tasks t
    where t.flow_active and t.attempts >= p_max_attempts
      and (t.status = 'pending' or (t.status = 'running' and t.claimed_at < p_stale_before))
    limit 500
    for update skip locked
  )
  update public.communication_flow_tasks t
  set status = 'skipped', result = 'failed', finished_at = p_now, claimed_at = null,
      last_error = coalesce(t.last_error, 'Muitas tentativas sem terminar.')
  from stuck s
  where t.node_id = s.node_id and t.user_id = s.user_id;

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

-- 7.2 Entrada de alunos num fluxo do construtor: passagem + tarefas dos primeiros passos (tempos do TS).
--     p_entries: [{ user_id, entered_at, baseline, tasks: [{ node_id, anchor_at, due_at, deadline_at }] }]
--     O fluxo e conferido e travado (for share) aqui: encerrado ou excluido entre a avaliacao no TS e agora,
--     ninguem entra (nada de passagem ativa nem tarefa pendente num fluxo que nunca mais roda).
create or replace function public.communication_enroll_flow(p_flow_id uuid, p_entries jsonb)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  perform 1 from public.communication_flows f
  where f.id = p_flow_id and f.origin = 'builder' and f.status = 'active' and f.deleted_at is null
  for share;

  if not found then
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

-- 7.3 Entrada das notificacoes seguintes: quem recebeu o aviso de origem, so depois que ele esta "sent".
--     A base do tempo e quando a linha passou a aparecer no sino: greatest(created_at, sent_at). O due_at
--     daqui e so o primeiro horario de conferencia (mesma conta de dueFromAnchor; o motor recalcula).
--     Tambem completa uma notificacao seguinte de primeiro nivel criada depois do envio (a gravacao zera
--     entry_completed_at, 7.5): quem ja tem passagem (active ou done) e nao tem a tarefa de um filho vivo da
--     entrada ganha a tarefa, contada do proprio recebimento. Em lotes de p_limit, retomavel.
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

  -- 1. Quem recebeu e ainda nao entrou.
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

  -- 2. Notificacao seguinte nova num aviso ja enviado: quem ja entrou e nao tem a tarefa dela.
  with missing as (
    select r.user_id, greatest(r.created_at, v_source.sent_at) as visible_at, r.expires_at
    from public.notifications r
    join public.communication_flow_runs fr
      on fr.flow_id = p_flow_id and fr.user_id = r.user_id and fr.status in ('active', 'done')
    where r.campaign_id = v_source.id and not r.is_test
      and exists (
        select 1 from public.communication_flow_nodes c
        where c.flow_id = p_flow_id and c.parent_id = v_entry and c.removed_at is null
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
    join public.communication_flow_nodes c on c.flow_id = p_flow_id and c.parent_id = v_entry and c.removed_at is null
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

-- 7.4 Aplica as decisoes de um lote numa transacao (secao 4.3). O TS devolve o claimed_at exatamente
--     como veio da reserva (texto com microssegundos).
--     p_results: [{ node_id, user_id, claimed_at, action, result, due_at, deadline_at, error, campaign_id,
--                   expires_at, children: [{ node_id, anchor_at, due_at, deadline_at }] }]
--     action: send | finish | defer | retry | exit_goal. Toda conta de tempo usa p_now (o relogio do tick;
--     os testes simulam o tempo por ele); so o created_at da notificacao usa o mais tarde entre p_now e a
--     hora real da gravacao.
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
      node_id uuid, user_id uuid, claimed_at timestamptz, action text, result text, due_at timestamptz,
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

-- 7.5 Grava a arvore do fluxo numa transacao, com a versao conferida. Sem delete: passo que sai ganha
--     removed_at e quem esperava por ele para ali. Nao recalcula horario: passo cujo tempo mudou tem as
--     tarefas pendentes acordadas (due_at = agora) e o motor recalcula a partir do anchor_at de cada uma.
--     Quem entra mudou num fluxo no ar: "so quem esta agora" recusa; os outros dois zeram
--     entry_refreshed_at (a proxima faixa refaz a entrada: "e quem entrar depois" faz entrar quem combina
--     com as regras novas; "so quem entrar a partir de agora" grava baseline para eles). Notificacao seguinte
--     nova de primeiro nivel num fluxo de aviso no ar zera entry_completed_at (7.3 completa as tarefas).
--     p_flow: { name, entry_audience, entry_mode, goal, watched_page_keys }; p_nodes: todos os passos vivos,
--     em pre-ordem (pai antes do filho).
create or replace function public.communication_save_flow(
  p_flow_id uuid,
  p_expected_updated_at timestamptz,
  p_flow jsonb,
  p_nodes jsonb,
  p_actor uuid,
  p_now timestamptz
)
returns public.communication_flows
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_flow public.communication_flows%rowtype;
  v_live boolean;
  v_entry_changed boolean;
  v_new_entry_child boolean := false;
  v_entry_id uuid;
  v_old public.communication_flow_nodes%rowtype;
  v_old_parent public.communication_flow_nodes%rowtype;
  n record;
  v_ids uuid[];
  v_removed uuid[];
  v_id uuid;
  v_open boolean;
begin
  select * into v_flow from public.communication_flows f where f.id = p_flow_id for update;

  if not found or v_flow.deleted_at is not null then
    raise exception 'Este fluxo nao existe mais.' using errcode = 'BK404';
  end if;

  if v_flow.updated_at is distinct from p_expected_updated_at then
    raise exception 'Este fluxo mudou em outra tela.' using errcode = 'BK409';
  end if;

  if v_flow.status = 'ended' then
    raise exception 'Este fluxo foi encerrado.' using errcode = 'BK409';
  end if;

  v_live := v_flow.status in ('active', 'paused');
  -- O fluxo de um aviso nao tem "quem entra" proprio: o valor gravado fica.
  v_entry_changed := v_flow.origin = 'builder' and (p_flow ? 'entry_audience')
    and (p_flow->'entry_audience') is distinct from v_flow.entry_audience;

  if jsonb_typeof(p_nodes) <> 'array' or jsonb_array_length(p_nodes) > 21 then
    raise exception 'Use no maximo 20 passos.' using errcode = 'BK422';
  end if;

  if v_live and (p_flow ? 'entry_mode') and (p_flow->>'entry_mode') is distinct from v_flow.entry_mode then
    raise exception 'O jeito de entrar nao muda depois de ativar.' using errcode = 'BK422';
  end if;

  if v_live and v_entry_changed and v_flow.entry_mode = 'current' then
    raise exception 'Neste fluxo, quem entra foi decidido ao ativar.' using errcode = 'BK422';
  end if;

  select n2.id into v_entry_id from public.communication_flow_nodes n2
  where n2.flow_id = p_flow_id and n2.kind = 'entry' and n2.removed_at is null;

  select coalesce(array_agg(x.id), array[]::uuid[]) into v_ids from jsonb_to_recordset(p_nodes) as x(id uuid);

  select coalesce(array_agg(o.id), array[]::uuid[]) into v_removed
  from public.communication_flow_nodes o
  where o.flow_id = p_flow_id and o.removed_at is null and o.id <> all(v_ids);

  -- 1. Conferencias antes de gravar.
  for n in
    select * from jsonb_to_recordset(p_nodes) as x(
      id uuid, parent_id uuid, branch text, kind text, position smallint, anchor text, anchor_node_id uuid,
      offset_minutes integer, campaign_id uuid, filter jsonb, condition jsonb, wait_until_true boolean, max_wait_minutes integer,
      expire_with_anchor boolean
    )
  loop
    -- Pai e referencia de tempo sempre dentro da arvore gravada: nunca um passo de outro fluxo.
    if (n.parent_id is not null and n.parent_id <> all(v_ids)) or (n.anchor_node_id is not null and n.anchor_node_id <> all(v_ids)) then
      raise exception 'Passo invalido.' using errcode = 'BK422';
    end if;

    select * into v_old from public.communication_flow_nodes o where o.id = n.id;

    if v_old.id is not null then
      if v_old.flow_id <> p_flow_id or v_old.removed_at is not null or v_old.kind <> n.kind then
        raise exception 'Passo invalido.' using errcode = 'BK422';
      end if;

      if v_live and (n.parent_id is distinct from v_old.parent_id or n.branch is distinct from v_old.branch) then
        select * into v_old_parent from public.communication_flow_nodes p where p.id = v_old.parent_id;

        -- Num fluxo no ar, subir de nivel so vale ao remover a condicao-pai mantendo um caminho.
        if not coalesce(
          v_old_parent.kind = 'condition' and v_old_parent.id = any(v_removed)
          and n.parent_id is not distinct from v_old_parent.parent_id
          and n.branch is not distinct from v_old_parent.branch,
          false
        ) then
          raise exception 'Para mudar a ordem, remova e crie de novo.' using errcode = 'BK422';
        end if;
      end if;

      select exists (
        select 1 from public.communication_flow_tasks t where t.node_id = v_old.id and t.status in ('pending', 'running')
      ) into v_open;

      if v_open and (coalesce(n.anchor, 'previous') <> v_old.anchor or n.anchor_node_id is distinct from v_old.anchor_node_id) then
        raise exception 'Para mudar a referencia de tempo, remova este passo e crie outro.' using errcode = 'BK422';
      end if;
    elsif v_live and v_flow.origin = 'notice' and n.parent_id = v_entry_id then
      v_new_entry_child := true;
    end if;

    if n.kind = 'message' and not exists (
      select 1 from public.campaigns c
      where c.id = n.campaign_id and c.flow_id = p_flow_id and c.flow_node_id = n.id and c.deleted_at is null
    ) then
      raise exception 'Conteudo do passo invalido.' using errcode = 'BK422';
    end if;
  end loop;

  -- 2. Grava os passos.
  for n in
    select * from jsonb_to_recordset(p_nodes) as x(
      id uuid, parent_id uuid, branch text, kind text, position smallint, anchor text, anchor_node_id uuid,
      offset_minutes integer, campaign_id uuid, filter jsonb, condition jsonb, wait_until_true boolean, max_wait_minutes integer,
      expire_with_anchor boolean
    )
  loop
    select * into v_old from public.communication_flow_nodes o where o.id = n.id;
    v_id := null;

    insert into public.communication_flow_nodes as t (
      id, flow_id, parent_id, branch, kind, position, anchor, anchor_node_id, offset_minutes,
      campaign_id, filter, expire_with_anchor, condition, wait_until_true, max_wait_minutes
    )
    values (
      n.id, p_flow_id, n.parent_id, n.branch, n.kind, coalesce(n.position, 0), coalesce(n.anchor, 'previous'), n.anchor_node_id,
      coalesce(n.offset_minutes, 0), n.campaign_id, n.filter, coalesce(n.expire_with_anchor, false), n.condition,
      coalesce(n.wait_until_true, false), n.max_wait_minutes
    )
    on conflict (id) do update set
      parent_id = excluded.parent_id, branch = excluded.branch, position = excluded.position, anchor = excluded.anchor,
      anchor_node_id = excluded.anchor_node_id, offset_minutes = excluded.offset_minutes, campaign_id = excluded.campaign_id,
      filter = excluded.filter, expire_with_anchor = excluded.expire_with_anchor, condition = excluded.condition,
      wait_until_true = excluded.wait_until_true, max_wait_minutes = excluded.max_wait_minutes
      where t.flow_id = p_flow_id and t.removed_at is null
    returning t.id into v_id;

    if v_id is null then
      raise exception 'Passo invalido.' using errcode = 'BK422';
    end if;

    -- O tempo deste passo mudou: quem espera e conferido no proximo tick (o motor recalcula; o not_before
    -- de quem foi adiado pelo limite diario continua valendo).
    if v_old.id is not null and (
      v_old.offset_minutes <> coalesce(n.offset_minutes, 0)
      or v_old.max_wait_minutes is distinct from n.max_wait_minutes
      or v_old.wait_until_true <> coalesce(n.wait_until_true, false)
      or v_old.parent_id is distinct from n.parent_id
    ) then
      update public.communication_flow_tasks t set due_at = p_now
      where t.node_id = n.id and t.status = 'pending' and t.due_at > p_now;
    end if;
  end loop;

  -- 3. Passos que sairam: marcados (os numeros ficam) e quem esperava por eles para ali.
  if cardinality(v_removed) > 0 then
    update public.communication_flow_nodes o set removed_at = p_now where o.id = any(v_removed);
    update public.communication_flow_tasks t
    set status = 'canceled', result = 'removed', finished_at = p_now, claimed_at = null
    where t.node_id = any(v_removed) and t.status in ('pending', 'running');
  end if;

  if (select count(*) from public.communication_flow_nodes e where e.flow_id = p_flow_id and e.kind = 'entry' and e.removed_at is null) <> 1
     or exists (
       select 1 from public.communication_flow_nodes c
       join public.communication_flow_nodes p on p.id = c.parent_id
       where c.flow_id = p_flow_id and c.removed_at is null and p.removed_at is not null
     ) then
    raise exception 'Arvore do fluxo invalida.' using errcode = 'BK422';
  end if;

  -- 4. Fluxo. A revisao sempre muda, entao a versao do editor tambem.
  update public.communication_flows f set
    name = coalesce(nullif(btrim(p_flow->>'name'), ''), f.name),
    entry_audience = case when v_flow.origin = 'builder' then coalesce(p_flow->'entry_audience', f.entry_audience) else f.entry_audience end,
    entry_mode = coalesce(p_flow->>'entry_mode', f.entry_mode),
    goal = case when p_flow ? 'goal' then nullif(p_flow->'goal', 'null'::jsonb) else f.goal end,
    watched_page_keys = case when p_flow ? 'watched_page_keys'
      then array(select jsonb_array_elements_text(p_flow->'watched_page_keys')) else f.watched_page_keys end,
    entry_refreshed_at = case when v_live and v_entry_changed then null else f.entry_refreshed_at end,
    entry_completed_at = case when v_new_entry_child then null else f.entry_completed_at end,
    revision = f.revision + 1,
    updated_by = p_actor
  where f.id = p_flow_id
  returning f.* into v_flow;

  -- 5. Passagens sem nada pendente terminam.
  update public.communication_flow_runs fr set status = 'done', finished_at = p_now
  where fr.flow_id = p_flow_id and fr.status = 'active'
    and not exists (
      select 1 from public.communication_flow_tasks t
      where t.flow_id = fr.flow_id and t.user_id = fr.user_id and t.status in ('pending', 'running')
    );

  return v_flow;
end;
$$;

-- 7.6 Acorda tarefas pendentes de um fluxo para conferencia no proximo tick (varredura do objetivo):
--     as que esperam ha mais tempo sem ser conferidas primeiro. Pula as adiadas pelo limite diario
--     (not_before no futuro): o objetivo e conferido de novo antes do envio delas. Retorna quantas.
create or replace function public.communication_wake_flow_tasks(p_flow_id uuid, p_now timestamptz, p_limit integer)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  with picked as (
    select t.node_id, t.user_id
    from public.communication_flow_tasks t
    where t.flow_id = p_flow_id and t.status = 'pending' and t.flow_active
      and t.due_at > p_now + interval '15 minutes'
      and (t.not_before is null or t.not_before <= p_now)
    order by t.updated_at
    limit greatest(0, least(p_limit, 5000))
    for update skip locked
  )
  update public.communication_flow_tasks t set due_at = p_now
  from picked p
  where t.node_id = p.node_id and t.user_id = p.user_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 7.7 Numeros por fluxo (lista e topo).
create or replace function public.communication_flow_stats(p_flow_ids uuid[], p_since timestamptz)
returns table (
  flow_id uuid, entered bigint, entered_since bigint, active bigint, goal bigint, done bigint, ended bigint,
  sent bigint, sent_since bigint, goal_since bigint, overdue bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select f.id,
    (select count(*) from public.communication_flow_runs r where r.flow_id = f.id and r.status <> 'baseline'),
    (select count(*) from public.communication_flow_runs r where r.flow_id = f.id and r.status <> 'baseline' and r.entered_at >= p_since),
    (select count(*) from public.communication_flow_runs r where r.flow_id = f.id and r.status = 'active'),
    (select count(*) from public.communication_flow_runs r where r.flow_id = f.id and r.status = 'goal'),
    (select count(*) from public.communication_flow_runs r where r.flow_id = f.id and r.status = 'done'),
    (select count(*) from public.communication_flow_runs r where r.flow_id = f.id and r.status = 'ended'),
    (select count(*) from public.communication_flow_tasks t where t.flow_id = f.id and t.result = 'sent'),
    (select count(*) from public.communication_flow_tasks t where t.flow_id = f.id and t.result = 'sent' and t.finished_at >= p_since),
    (select count(*) from public.communication_flow_runs r where r.flow_id = f.id and r.status = 'goal' and r.finished_at >= p_since),
    (select count(*) from public.communication_flow_tasks t
      where t.flow_id = f.id and t.status = 'pending' and t.flow_active and t.due_at < now() - interval '10 minutes')
  from public.communication_flows f
  where f.id = any(coalesce(p_flow_ids, array[]::uuid[]));
$$;

-- 7.8 Numeros por passo (relatorio): tarefas por resultado, funil das notificacoes do passo (todas as
--     versoes) e quem visitou a pagina do botao depois de receber (p_cta_keys: [{ node_id, page_key }]).
create or replace function public.communication_flow_node_stats(p_flow_id uuid, p_cta_keys jsonb)
returns table (
  node_id uuid, reached bigint, waiting bigint, deferred_now bigint, sent bigint, yes_count bigint, no_count bigint,
  filtered bigint, goal bigint, expired bigint, cap bigint, failed bigint, removed bigint,
  received bigint, seen bigint, opened bigint, audio_started bigint, audio_completed bigint, clicked bigint,
  accepted bigint, declined bigint, studied_7d bigint, visited_cta bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with flow_nodes as (
    select n.id from public.communication_flow_nodes n where n.flow_id = p_flow_id
  ),
  task_totals as (
    select t.node_id,
      count(*) as reached,
      count(*) filter (where t.status in ('pending', 'running')) as waiting,
      count(*) filter (where t.status = 'pending' and t.deferrals > 0) as deferred_now,
      count(*) filter (where t.result = 'sent') as sent,
      count(*) filter (where t.result = 'yes') as yes_count,
      count(*) filter (where t.result = 'no') as no_count,
      count(*) filter (where t.result = 'filtered') as filtered,
      count(*) filter (where t.result = 'goal') as goal,
      count(*) filter (where t.result = 'expired') as expired,
      count(*) filter (where t.result = 'cap') as cap,
      count(*) filter (where t.result = 'failed') as failed,
      count(*) filter (where t.result in ('removed', 'withdrawn', 'flow_ended', 'source_withdrawn')) as removed
    from public.communication_flow_tasks t
    where t.flow_id = p_flow_id
    group by t.node_id
  ),
  delivered as (
    select n.flow_node_id as node_id, n.user_id, n.created_at, n.seen_at, n.opened_at, n.audio_started_at,
      n.audio_completed_at, n.clicked_at, n.response
    from public.notifications n
    where n.flow_id = p_flow_id and n.flow_node_id is not null and not n.is_test
  ),
  delivered_totals as (
    select d.node_id, count(*) as received, count(d.seen_at) as seen, count(d.opened_at) as opened,
      count(d.audio_started_at) as audio_started, count(d.audio_completed_at) as audio_completed,
      count(d.clicked_at) as clicked,
      count(*) filter (where d.response = 'accepted') as accepted,
      count(*) filter (where d.response = 'declined') as declined
    from delivered d
    group by d.node_id
  ),
  studied as (
    select d.node_id, count(distinct d.user_id) as studied_7d
    from delivered d
    where d.seen_at is not null and exists (
      select 1
      from public.student_daily_activity a
      where a.user_id = d.user_id
        and a.day between (d.seen_at at time zone 'America/Sao_Paulo')::date and (d.seen_at at time zone 'America/Sao_Paulo')::date + 7
      having sum(a.seconds_watched) >= 600 or sum(a.lessons_completed) >= 1
    )
    group by d.node_id
  ),
  cta as (
    select (e->>'node_id')::uuid as node_id, e->>'page_key' as page_key
    from jsonb_array_elements(coalesce(p_cta_keys, '[]'::jsonb)) e
  ),
  visited as (
    select d.node_id, count(distinct d.user_id) as visited_cta
    from delivered d
    join cta c on c.node_id = d.node_id
    join public.member_page_visits v on v.user_id = d.user_id and v.page_key = c.page_key and v.last_visited_at >= d.created_at
    group by d.node_id
  )
  select fn.id,
    coalesce(t.reached, 0), coalesce(t.waiting, 0), coalesce(t.deferred_now, 0), coalesce(t.sent, 0),
    coalesce(t.yes_count, 0), coalesce(t.no_count, 0), coalesce(t.filtered, 0), coalesce(t.goal, 0),
    coalesce(t.expired, 0), coalesce(t.cap, 0), coalesce(t.failed, 0), coalesce(t.removed, 0),
    coalesce(dt.received, 0), coalesce(dt.seen, 0), coalesce(dt.opened, 0), coalesce(dt.audio_started, 0),
    coalesce(dt.audio_completed, 0), coalesce(dt.clicked, 0), coalesce(dt.accepted, 0), coalesce(dt.declined, 0),
    coalesce(s.studied_7d, 0), coalesce(v.visited_cta, 0)
  from flow_nodes fn
  left join task_totals t on t.node_id = fn.id
  left join delivered_totals dt on dt.node_id = fn.id
  left join studied s on s.node_id = fn.id
  left join visited v on v.node_id = fn.id;
$$;

-- 7.9 Fatos de um lote do motor num jsonb so (sem o corte de 1.000 linhas do PostgREST e sem in() na URL):
--     notificacoes pelas chaves (indice unico user_id + dedupe_key: "flow:<passo>", "campaign:<aviso de
--     origem>" e "campaign:<aviso>" de toda regra de mensagem com aviso), visitas, acessos, a passagem de
--     cada aluno nos fluxos do lote (entered_at, pela chave primaria) e quem e da equipe. O limite diario
--     nao vem daqui: so o RPC de aplicacao decide (7.4).
create or replace function public.communication_flow_batch_facts(
  p_user_ids uuid[], p_dedupe_keys text[], p_page_keys text[], p_flow_ids uuid[]
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'u', n.user_id, 'k', n.dedupe_key, 'campaign_id', n.campaign_id,
        'visible_at', greatest(n.created_at, coalesce(c.sent_at, n.created_at)), 'expires_at', n.expires_at,
        'seen_at', n.seen_at, 'opened_at', n.opened_at, 'clicked_at', n.clicked_at, 'response', n.response,
        'audio_started_at', n.audio_started_at, 'audio_completed_at', n.audio_completed_at,
        'live', (c.status = 'sent' and c.deleted_at is null)))
      from public.notifications n
      left join public.campaigns c on c.id = n.campaign_id
      where n.user_id = any(p_user_ids) and n.dedupe_key = any(p_dedupe_keys) and not n.is_test
    ), '[]'::jsonb),
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object('u', v.user_id, 'k', v.page_key, 'at', v.last_visited_at))
      from public.member_page_visits v
      where v.user_id = any(p_user_ids) and v.page_key = any(coalesce(p_page_keys, array[]::text[]))
    ), '[]'::jsonb),
    'accesses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'u', e.user_id, 'target_type', e.target_type, 'target_id', e.target_id, 'status', e.status,
        'starts_at', e.starts_at, 'ends_at', e.ends_at, 'created_at', e.created_at))
      from public.entitlements e
      where e.user_id = any(p_user_ids)
    ), '[]'::jsonb),
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object('u', r.user_id, 'f', r.flow_id, 'entered_at', r.entered_at))
      from public.communication_flow_runs r
      where r.flow_id = any(coalesce(p_flow_ids, array[]::uuid[])) and r.user_id = any(p_user_ids)
    ), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(a.user_id) from public.admin_roles a where a.user_id = any(p_user_ids)), '[]'::jsonb)
  );
$$;

-- 7.10 Abriram, comecaram o audio e ouviram ate o fim, por aviso (o relatorio de toda notificacao).
--      communication_campaign_stats fica igual: create or replace nao muda as colunas de saida.
create or replace function public.communication_campaign_engagement(p_campaign_ids uuid[])
returns table (campaign_id uuid, opened bigint, audio_started bigint, audio_completed bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select n.campaign_id, count(n.opened_at), count(n.audio_started_at), count(n.audio_completed_at)
  from public.notifications n
  where n.campaign_id = any(coalesce(p_campaign_ids, array[]::uuid[])) and not n.is_test
  group by n.campaign_id;
$$;

-- 7.11 Audio do aviso no sino: "started" (abriu e comecou) ou "progress" (OU dos 48 trechos ouvidos).
--      So cresce. A rota ja conferiu que a linha e do aluno, aparece no sino, nao venceu e tem audio.
create or replace function public.communication_record_notification_audio(
  p_user_id uuid, p_notification_id uuid, p_event text, p_heard text, p_now timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v public.notifications%rowtype;
  v_heard text;
  v_count integer;
begin
  if p_event not in ('started', 'progress') or (p_heard is not null and p_heard !~ '^[01]{48}$') then
    raise exception 'Evento de audio invalido.' using errcode = '22023';
  end if;

  select * into v from public.notifications n
  where n.id = p_notification_id and n.user_id = p_user_id and n.kind = 'notice'
  for update;

  if not found then
    return null;
  end if;

  v_heard := case
    when p_heard is null then coalesce(v.audio_heard, repeat('0', 48))
    else (coalesce(v.audio_heard, repeat('0', 48))::bit(48) | p_heard::bit(48))::text
  end;
  v_count := length(replace(v_heard, '0', ''));

  update public.notifications n set
    seen_at = coalesce(n.seen_at, p_now),
    read_at = coalesce(n.read_at, p_now),
    opened_at = coalesce(n.opened_at, p_now),
    audio_started_at = coalesce(n.audio_started_at, p_now),
    audio_heard = v_heard,
    audio_heard_percent = (v_count * 100) / 48,
    audio_completed_at = case when v_count >= 44 then coalesce(n.audio_completed_at, p_now) else n.audio_completed_at end
  where n.id = v.id;

  return jsonb_build_object(
    'heard', v_heard,
    'percent', (v_count * 100) / 48,
    'completed', v_count >= 44,
    'startedNow', v.audio_started_at is null,
    'completedNow', v.audio_completed_at is null and v_count >= 44
  );
end;
$$;

-- 7.12 Os quatro numeros do topo de Avisos: "Avisos ativos" passa a contar os fluxos no ar (o de um
--      aviso so depois que o aviso saiu, para nao contar duas vezes). Mesma assinatura e colunas da v1.
create or replace function public.communication_overview(p_start timestamptz, p_end timestamptz)
returns table (active_now bigint, seen bigint, clicked bigint, studied_7d bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with seen_rows as (
    select n.user_id, n.seen_at as seen_moment, n.clicked_at
    from public.notifications n
    join public.campaigns c on c.id = n.campaign_id and c.deleted_at is null
    where n.kind = 'notice' and not n.is_test and n.seen_at >= p_start and n.seen_at < p_end
    union all
    select d.user_id, d.first_seen_at as seen_moment, d.clicked_at
    from public.campaign_deliveries d
    join public.campaigns c on c.id = d.campaign_id and c.deleted_at is null
    where d.first_seen_at >= p_start and d.first_seen_at < p_end
  )
  select
    (
      select count(*)
      from public.campaigns c
      where c.deleted_at is null and c.flow_id is null
        and (
          (c.kind = 'popup' and c.status = 'active' and coalesce(c.starts_at, c.created_at) <= now() and (c.ends_at is null or c.ends_at > now()))
          or (c.kind = 'inbox' and c.status in ('scheduled', 'sending'))
        )
    ) + (
      select count(*)
      from public.communication_flows f
      where f.deleted_at is null and f.status = 'active'
        and (f.origin = 'builder' or exists (
          select 1 from public.campaigns s where s.id = f.source_campaign_id and s.status = 'sent'
        ))
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

-- 7.13 Situacao do fluxo numa transacao, com a linha do fluxo travada (for update) antes de tudo: espera o
--      lote do motor que esta aplicando (7.4 trava o fluxo for share) e nenhum lote comeca no meio. Mantem
--      tasks.flow_active. p_to: active (ativar, aprovar, retomar; ou o fluxo do aviso quando o aviso sai)
--      | pending_approval | paused | ended | draft (aviso com agendamento cancelado ou pedido devolvido).
--      Permissao e contagem (500 alunos) ja foram conferidas no TS. p_expected_updated_at nulo = quem muda e o
--      aviso de origem (o fluxo segue o aviso) ou o proprio job (concluido).
create or replace function public.communication_change_flow_state(
  p_flow_id uuid,
  p_expected_updated_at timestamptz,
  p_to text,
  p_actor uuid,
  p_now timestamptz,
  p_reason text,                -- ended: team | source_withdrawn | finished; active: approved | null
  p_entry_count integer
)
returns public.communication_flows
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_flow public.communication_flows%rowtype;
begin
  select * into v_flow from public.communication_flows f where f.id = p_flow_id for update;

  if not found or v_flow.deleted_at is not null then
    raise exception 'Este fluxo nao existe mais.' using errcode = 'BK404';
  end if;

  if p_expected_updated_at is not null and v_flow.updated_at is distinct from p_expected_updated_at then
    raise exception 'Este fluxo mudou em outra tela.' using errcode = 'BK409';
  end if;

  if not (
    (p_to = 'active' and v_flow.status in ('draft', 'pending_approval', 'paused'))
    or (p_to = 'pending_approval' and v_flow.status = 'draft')
    or (p_to = 'paused' and v_flow.status = 'active')
    or (p_to = 'ended' and v_flow.status in ('active', 'paused'))
    -- Volta a rascunho so antes de qualquer entrada (o fluxo do aviso agendado ainda nao tem tarefa).
    or (p_to = 'draft' and v_flow.status in ('pending_approval', 'active')
        and not exists (select 1 from public.communication_flow_tasks t where t.flow_id = p_flow_id))
  ) then
    raise exception 'Este fluxo mudou em outra tela.' using errcode = 'BK409';
  end if;

  if p_to = 'active' and v_flow.status in ('draft', 'pending_approval') then
    -- Conteudo primeiro: um lote nunca encontra o fluxo no ar com a notificacao ainda em rascunho.
    update public.campaigns c set status = 'sent', sent_at = coalesce(c.sent_at, p_now)
    where c.flow_id = p_flow_id and c.status = 'draft' and c.deleted_at is null;
  elsif p_to = 'draft' then
    update public.campaigns c set status = 'draft', sent_at = null
    where c.flow_id = p_flow_id and c.status = 'sent' and c.deleted_at is null;
  end if;

  update public.communication_flows f set
    status = p_to,
    activated_at = case when p_to = 'active' then coalesce(f.activated_at, p_now) when p_to = 'draft' then null else f.activated_at end,
    paused_at = case when p_to = 'paused' then p_now when p_to = 'active' then null else f.paused_at end,
    ended_at = case when p_to = 'ended' then p_now else null end,
    ended_reason = case when p_to = 'ended' then coalesce(p_reason, 'team') else null end,
    requested_by = case when p_to = 'pending_approval' then p_actor when p_to = 'draft' then null else f.requested_by end,
    requested_at = case when p_to = 'pending_approval' then p_now when p_to = 'draft' then null else f.requested_at end,
    approved_by = case when p_to = 'active' and p_reason = 'approved' then p_actor else f.approved_by end,
    approved_at = case when p_to = 'active' and p_reason = 'approved' then p_now else f.approved_at end,
    entry_count = coalesce(p_entry_count, f.entry_count),
    entry_counted_at = case when p_entry_count is not null then p_now else f.entry_counted_at end,
    updated_by = coalesce(p_actor, f.updated_by)
  where f.id = p_flow_id
  returning f.* into v_flow;

  if p_to = 'paused' then
    update public.communication_flow_tasks t set flow_active = false
    where t.flow_id = p_flow_id and t.status in ('pending', 'running');
  elsif p_to = 'active' then
    update public.communication_flow_tasks t set flow_active = true
    where t.flow_id = p_flow_id and t.status in ('pending', 'running') and not t.flow_active;
  elsif p_to = 'ended' then
    -- Pendentes e reservadas: uma reservada agora so pode ser de um tick que caiu (o lote em andamento
    -- terminou antes, por causa da trava) ou de um lote que ainda nao aplicou (vai achar "stale").
    update public.communication_flow_tasks t
    set status = 'canceled', result = case when p_reason = 'source_withdrawn' then 'source_withdrawn' else 'flow_ended' end,
        finished_at = p_now, claimed_at = null, flow_active = false
    where t.flow_id = p_flow_id and t.status in ('pending', 'running');
    update public.communication_flow_runs fr set status = 'ended', finished_at = p_now
    where fr.flow_id = p_flow_id and fr.status = 'active';
  end if;

  return v_flow;
end;
$$;

-- 7.14 Retira um passo do sino (todas as versoes do conteudo) com o fluxo travado: as versoes ficam
--      canceladas e as tarefas pendentes do passo e de tudo abaixo dele terminam como "withdrawn". As linhas
--      do sino saem depois, pelo TS, como no withdrawNotice da v1 (sem delete aqui: aplicavel pelo MCP); elas
--      ja nao aparecem, porque o sino so mostra aviso "sent". Devolve quantas linhas o TS vai apagar.
create or replace function public.communication_withdraw_flow_step(
  p_flow_id uuid, p_expected_updated_at timestamptz, p_node_id uuid, p_actor uuid, p_now timestamptz
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_flow public.communication_flows%rowtype;
  v_nodes uuid[];
  v_count integer;
begin
  select * into v_flow from public.communication_flows f where f.id = p_flow_id for update;

  if not found or v_flow.deleted_at is not null then
    raise exception 'Este fluxo nao existe mais.' using errcode = 'BK404';
  end if;

  if v_flow.updated_at is distinct from p_expected_updated_at then
    raise exception 'Este fluxo mudou em outra tela.' using errcode = 'BK409';
  end if;

  with recursive subtree as (
    select n.id from public.communication_flow_nodes n
    where n.id = p_node_id and n.flow_id = p_flow_id and n.kind = 'message'
    union all
    select c.id from public.communication_flow_nodes c join subtree s on c.parent_id = s.id
  )
  select coalesce(array_agg(subtree.id), array[]::uuid[]) into v_nodes from subtree;

  if cardinality(v_nodes) = 0 then
    raise exception 'Passo nao encontrado.' using errcode = 'BK404';
  end if;

  update public.campaigns c set status = 'canceled'
  where c.flow_id = p_flow_id and c.flow_node_id = p_node_id and c.status in ('draft', 'sent');

  update public.communication_flow_tasks t
  set status = 'canceled', result = 'withdrawn', finished_at = p_now, claimed_at = null
  where t.node_id = any(v_nodes) and t.status in ('pending', 'running');

  update public.communication_flow_runs fr set status = 'done', finished_at = p_now
  where fr.flow_id = p_flow_id and fr.status = 'active'
    and not exists (
      select 1 from public.communication_flow_tasks t
      where t.flow_id = fr.flow_id and t.user_id = fr.user_id and t.status in ('pending', 'running')
    );

  -- Muda a versao do editor: outra tela aberta recebe 409 em vez de gravar sobre a retirada.
  update public.communication_flows f set revision = f.revision + 1, updated_by = p_actor where f.id = p_flow_id;

  select count(*) into v_count from public.notifications n where n.flow_node_id = p_node_id and not n.is_test;
  return v_count;
end;
$$;

-- 7.15 Devolve para a fila as tarefas de um lote que falhou antes de aplicar (fatos do lote fora do ar, erro
--      do motor): so as que continuam reservadas com aquele carimbo exato, devolvendo a tentativa (so a queda
--      de um tick conta como tentativa; secao 4.3, passo 4e). Trava os fluxos for share antes, na mesma
--      ordem de 7.4. p_claims: [{ node_id, user_id, claimed_at }]. Retorna quantas voltaram.
create or replace function public.communication_release_flow_tasks(p_claims jsonb)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  perform 1
  from public.communication_flows f
  where f.id in (
    select t.flow_id
    from jsonb_to_recordset(coalesce(p_claims, '[]'::jsonb)) as x(node_id uuid, user_id uuid)
    join public.communication_flow_tasks t on t.node_id = x.node_id and t.user_id = x.user_id
  )
  order by f.id
  for share of f;

  update public.communication_flow_tasks t
  set status = 'pending', claimed_at = null, attempts = greatest(0, t.attempts - 1)
  from jsonb_to_recordset(coalesce(p_claims, '[]'::jsonb)) as c(node_id uuid, user_id uuid, claimed_at timestamptz)
  where t.node_id = c.node_id and t.user_id = c.user_id and t.status = 'running' and t.claimed_at = c.claimed_at;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


/* ------------------------------------------------------------------------------------------------
 * 8. Permissoes das funcoes (assinatura exata) e descricoes
 * ---------------------------------------------------------------------------------------------- */

revoke all on function public.communication_claim_flow_tasks(timestamptz, integer, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.communication_claim_flow_tasks(timestamptz, integer, timestamptz, integer) to service_role;
comment on function public.communication_claim_flow_tasks(timestamptz, integer, timestamptz, integer) is
  'Reserva tarefas vencidas de fluxos no ar (skip locked, carimbo unico); a que caiu muitas vezes sai como falha.';

revoke all on function public.communication_enroll_flow(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.communication_enroll_flow(uuid, jsonb) to service_role;
comment on function public.communication_enroll_flow(uuid, jsonb) is
  'Entrada de alunos num fluxo do construtor no ar: passagem (uma vez por fluxo) e tarefas dos primeiros passos. Sem a equipe.';

revoke all on function public.communication_enroll_notice_recipients(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.communication_enroll_notice_recipients(uuid, timestamptz, integer) to service_role;
comment on function public.communication_enroll_notice_recipients(uuid, timestamptz, integer) is
  'Entrada das notificacoes seguintes de um aviso enviado (e o complemento de uma seguinte nova), em lotes, retomavel.';

revoke all on function public.communication_apply_flow_results(timestamptz, jsonb, integer, integer, integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.communication_apply_flow_results(timestamptz, jsonb, integer, integer, integer, timestamptz, timestamptz) to service_role;
comment on function public.communication_apply_flow_results(timestamptz, jsonb, integer, integer, integer, timestamptz, timestamptz) is
  'Aplica as decisoes de um lote do motor numa transacao: envio uma vez por aluno, limite diario e intervalo de 1 h, proximos passos.';

revoke all on function public.communication_save_flow(uuid, timestamptz, jsonb, jsonb, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.communication_save_flow(uuid, timestamptz, jsonb, jsonb, uuid, timestamptz) to service_role;
comment on function public.communication_save_flow(uuid, timestamptz, jsonb, jsonb, uuid, timestamptz) is
  'Grava a arvore do fluxo com a versao conferida (409) e as regras de edicao de fluxo no ar (422).';

revoke all on function public.communication_wake_flow_tasks(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.communication_wake_flow_tasks(uuid, timestamptz, integer) to service_role;
comment on function public.communication_wake_flow_tasks(uuid, timestamptz, integer) is
  'Varredura do objetivo: acorda as tarefas pendentes que esperam ha mais tempo (menos as adiadas pelo limite diario).';

revoke all on function public.communication_flow_stats(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.communication_flow_stats(uuid[], timestamptz) to service_role;
comment on function public.communication_flow_stats(uuid[], timestamptz) is
  'Numeros por fluxo: entraram, no fluxo agora, objetivo, terminaram, enviadas e fila atrasada.';

revoke all on function public.communication_flow_node_stats(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.communication_flow_node_stats(uuid, jsonb) to service_role;
comment on function public.communication_flow_node_stats(uuid, jsonb) is
  'Numeros por passo do fluxo: resultado das tarefas, funil das notificacoes e visitas a pagina do botao.';

revoke all on function public.communication_flow_batch_facts(uuid[], text[], text[], uuid[]) from public, anon, authenticated;
grant execute on function public.communication_flow_batch_facts(uuid[], text[], text[], uuid[]) to service_role;
comment on function public.communication_flow_batch_facts(uuid[], text[], text[], uuid[]) is
  'Fatos de um lote do motor num jsonb: notificacoes pelas chaves, visitas, acessos, passagens e equipe.';

revoke all on function public.communication_campaign_engagement(uuid[]) from public, anon, authenticated;
grant execute on function public.communication_campaign_engagement(uuid[]) to service_role;
comment on function public.communication_campaign_engagement(uuid[]) is
  'Por aviso: abriram, comecaram o audio e ouviram ate o fim (sem testes).';

revoke all on function public.communication_record_notification_audio(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.communication_record_notification_audio(uuid, uuid, text, text, timestamptz) to service_role;
comment on function public.communication_record_notification_audio(uuid, uuid, text, text, timestamptz) is
  'Audio do aviso no sino: comecou e trechos ouvidos (OU de 48 trechos, so cresce; ouvido = 44 ou mais).';

revoke all on function public.communication_overview(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.communication_overview(timestamptz, timestamptz) to service_role;
comment on function public.communication_overview(timestamptz, timestamptz) is
  'Avisos ativos agora (com os fluxos no ar) e, no periodo, avisos vistos, cliques e alunos que voltaram a estudar em 7 dias (sem a equipe e sem testes).';

revoke all on function public.communication_change_flow_state(uuid, timestamptz, text, uuid, timestamptz, text, integer) from public, anon, authenticated;
grant execute on function public.communication_change_flow_state(uuid, timestamptz, text, uuid, timestamptz, text, integer) to service_role;
comment on function public.communication_change_flow_state(uuid, timestamptz, text, uuid, timestamptz, text, integer) is
  'Situacao do fluxo (ativar, aprovar, pausar, retomar, encerrar, voltar a rascunho) com o fluxo travado; mantem tasks.flow_active.';

revoke all on function public.communication_withdraw_flow_step(uuid, timestamptz, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.communication_withdraw_flow_step(uuid, timestamptz, uuid, uuid, timestamptz) to service_role;
comment on function public.communication_withdraw_flow_step(uuid, timestamptz, uuid, uuid, timestamptz) is
  'Retira um passo do sino: versoes canceladas e tarefas do passo e de baixo dele como withdrawn; devolve quantas linhas apagar.';

revoke all on function public.communication_release_flow_tasks(jsonb) from public, anon, authenticated;
grant execute on function public.communication_release_flow_tasks(jsonb) to service_role;
comment on function public.communication_release_flow_tasks(jsonb) is
  'Devolve para a fila as tarefas reservadas de um lote que falhou antes de aplicar, devolvendo a tentativa.';

/* ------------------------------------------------------------------------------------------------
 * 9. Retencao (docs/17 D8: 24 meses). Tem delete dentro da funcao: pelo SQL Editor ou psql se o MCP
 *    travar. O mesmo agendamento bunker707-communication-prune (06:41 UTC) da 202610200001 chama esta
 *    funcao; nada novo no pg_cron.
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.prune_communication_history()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  inbox_rows bigint; popup_rows bigint; task_rows bigint; run_rows bigint; visit_rows bigint;
begin
  delete from public.notifications where created_at < now() - interval '24 months';                -- v1, igual
  get diagnostics inbox_rows = row_count;

  delete from public.campaign_deliveries d using public.campaigns c                                  -- v1, igual
  where c.id = d.campaign_id
    and (c.status not in ('active', 'paused') or c.deleted_at is not null or c.ends_at <= now())
    and d.updated_at < now() - interval '24 months';
  get diagnostics popup_rows = row_count;

  -- Tarefas terminadas ha mais de 24 meses (as pendentes ficam).
  delete from public.communication_flow_tasks where finished_at < now() - interval '24 months';
  get diagnostics task_rows = row_count;

  -- Passagem so sai de fluxo encerrado ou excluido: no fluxo no ar ela garante "uma vez por aluno".
  delete from public.communication_flow_runs r using public.communication_flows f
  where f.id = r.flow_id and (f.status = 'ended' or f.deleted_at is not null)
    and coalesce(r.finished_at, r.updated_at) < now() - interval '24 months';
  get diagnostics run_rows = row_count;

  delete from public.member_page_visits where last_visited_at < now() - interval '24 months';
  get diagnostics visit_rows = row_count;

  return jsonb_build_object('notifications', inbox_rows, 'campaign_deliveries', popup_rows,
    'flow_tasks', task_rows, 'flow_runs', run_rows, 'page_visits', visit_rows);
end;
$$;

comment on function public.prune_communication_history() is
  'Retencao da Comunicacao (docs/17 D8): apaga notificacoes, estados de pop-up, tarefas terminadas, passagens de fluxos encerrados ou excluidos e visitas com mais de 24 meses (menos o que um pop-up ou fluxo no ar ainda usa). Idempotente; agendada todo dia pelo pg_cron.';

revoke all on function public.prune_communication_history() from public, anon, authenticated;
grant execute on function public.prune_communication_history() to service_role;
