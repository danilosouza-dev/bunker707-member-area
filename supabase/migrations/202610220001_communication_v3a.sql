-- Comunicacao v3a "Sino e avisos" (2026-10-22): editar e excluir avisos em qualquer situacao, o aluno
-- excluir uma notificacao do proprio sino, cartao clicavel, mudar a resposta, reacoes, enquetes nas
-- notificacoes, "mostrar de novo" no pop-up e a leitura do sino numa consulta so. Decisoes em docs/24 (e
-- docs/22, docs/23). As 202610200001, 202610200002 e 202610210001 (ja aplicadas) nao mudam.
--
-- Regras:
-- - campaigns ganha cta_display (como o aluno chega ao destino: pelo botao, pelo botao ou tocando no
--   cartao, so tocando no cartao), allow_reactions, poll (a enquete, jsonb) e edited_at/edited_by (ultima
--   edicao depois do envio ou de um pop-up no ar);
-- - notifications ganha hidden_at (o aluno excluiu do proprio sino: some de tudo, continua "recebeu"),
--   reaction/reacted_at (uma por aluno), response_changed_at/response_changes (mudou a resposta) e
--   poll_choice/poll_voted_at/poll_changes (o voto, ids das opcoes);
-- - notifications ganha tambem interaction_writes (quantas escritas do aluno na linha: reagir, votar,
--   excluir/desfazer, responder; os eventos param depois de 20) e o indice parcial da contagem da enquete;
-- - campaign_deliveries ganha reshown_at, impressions_before_reshow e snoozes_before_reshow ("mostrar de
--   novo para quem ja viu", so no pop-up "Uma vez": o que veio antes nao conta para a regra);
-- - a regra de "aparece no sino" fica num lugar so: communication_visible_notifications (lista, numeros,
--   "Marcar todas", "abriu o sino" e as conferencias de uma linha);
-- - nada aqui e lido pelo navegador: RLS ja ligado nas tres tabelas; cada RPC nova so para service_role;
-- - nada de drop e nada de delete: tudo aplicavel pelo MCP, secao por secao;
-- - aplicar antes do deploy que usa estas colunas; o app da v2 continua funcionando com ela aplicada.
--
-- Verificacao manual depois de aplicar:
--   select cta_display, allow_reactions, (poll is not null) as enquete, count(*) from public.campaigns group by 1, 2, 3;
--   select count(*) filter (where hidden_at is not null) as excluidas, count(*) filter (where reaction is not null) as reacoes,
--     count(*) filter (where poll_choice is not null) as votos from public.notifications;
--   select proname from pg_proc where proname in ('communication_visible_notifications', 'communication_inbox_page',
--     'communication_inbox_counts', 'communication_respond_notification', 'communication_vote_notification_poll',
--     'communication_message_interactions', 'communication_reshow_popup', 'communication_poll_tally',
--     'communication_notice_citations') order by 1;
--   select indexname from pg_indexes where indexname = 'notifications_poll_tally_idx';
--
-- Idempotente: pode ser executada mais de uma vez sem efeito colateral.

/* ------------------------------------------------------------------------------------------------
 * 1. Avisos: como o aluno chega ao destino, reacoes, enquete e edicao depois do envio
 * ---------------------------------------------------------------------------------------------- */

alter table public.campaigns
  add column if not exists cta_display text not null default 'button',
  -- Padrao false: tudo o que ja existe continua sem reacoes. O app manda true nas notificacoes novas.
  add column if not exists allow_reactions boolean not null default false,
  add column if not exists poll jsonb,
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references auth.users(id) on delete set null;

comment on column public.campaigns.cta_display is
  'Como o aluno chega ao destino (cta_href): button = pelo botao; button_and_card = pelo botao ou tocando no cartao; card = so tocando no cartao (sem botao; cta_label vira o texto ao lado da seta). So notificacao.';
comment on column public.campaigns.allow_reactions is
  'O aluno pode reagir (6 emojis fixos do app, uma reacao por aluno). So notificacao.';
comment on column public.campaigns.poll is
  'Enquete: {question, options:[{id,label}], multiple, showResults, closesAt (ISO UTC com milissegundos, ou null)}. O app valida o conteudo (interactions-model.ts); o banco, o formato. Nao convive com Aceitar/Recusar.';
comment on column public.campaigns.edited_at is
  'Ultima edicao de uma notificacao enviada ou de um pop-up no ar ou pausado (o relatorio mostra "Editado").';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_cta_display_v3') then
    alter table public.campaigns add constraint campaigns_cta_display_v3 check (
      cta_display in ('button', 'button_and_card', 'card')
      and (cta_display = 'button' or (kind = 'inbox' and cta_href is not null))
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'campaigns_reactions_v3') then
    alter table public.campaigns add constraint campaigns_reactions_v3 check (kind = 'inbox' or not allow_reactions);
  end if;

  -- Sem trava de tipo: a v3b poe enquete no pop-up sem precisar tirar este check.
  if not exists (select 1 from pg_constraint where conname = 'campaigns_poll_v3') then
    alter table public.campaigns add constraint campaigns_poll_v3 check (
      poll is null or (
        jsonb_typeof(poll) = 'object'
        and pg_column_size(poll) <= 4096
        and jsonb_typeof(poll->'question') = 'string'
        and jsonb_typeof(poll->'options') = 'array'
        and jsonb_array_length(poll->'options') between 2 and 6
        and jsonb_typeof(poll->'multiple') = 'boolean'
        and jsonb_typeof(poll->'showResults') = 'boolean'
        and coalesce(jsonb_typeof(poll->'closesAt'), 'null') in ('string', 'null')
        -- ISO canonico em UTC (toISOString): o sino compara como texto, sem cast que possa falhar.
        and (poll->>'closesAt' is null or poll->>'closesAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$')
        and response_mode = 'none'
      )
    );
  end if;
end;
$$;

/* ------------------------------------------------------------------------------------------------
 * 2. Sino: excluida pelo aluno, reacao, mudou a resposta e voto
 * ---------------------------------------------------------------------------------------------- */

alter table public.notifications
  add column if not exists hidden_at timestamptz,
  add column if not exists reaction text,
  add column if not exists reacted_at timestamptz,
  add column if not exists response_changed_at timestamptz,
  add column if not exists response_changes smallint not null default 0,
  add column if not exists poll_choice text[],
  add column if not exists poll_voted_at timestamptz,
  add column if not exists poll_changes smallint not null default 0,
  add column if not exists interaction_writes smallint not null default 0;

comment on column public.notifications.hidden_at is
  'O aluno excluiu do proprio sino: fora da lista, dos numeros e das marcacoes. Continua "recebeu" nos relatorios e nas regras.';
comment on column public.notifications.reaction is 'Reacao do aluno (id do catalogo do app: like, love, fire, clap, laugh, wow). Nula = sem reacao.';
comment on column public.notifications.response_changes is 'Quantas vezes o aluno mudou a resposta (Aceitar/Recusar). responded_at continua sendo a primeira.';
comment on column public.notifications.poll_choice is 'Voto na enquete do aviso: ids das opcoes, em ordem. Nulo = nao votou (ou tirou o voto).';
comment on column public.notifications.interaction_writes is
  'Escritas do aluno nesta linha que mudaram algo (reagir, votar, excluir/desfazer, mudar a resposta), ate 1000. Os eventos dessas escritas param em 20 por linha.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_reaction_v3') then
    alter table public.notifications add constraint notifications_reaction_v3 check (
      (reaction is null) = (reacted_at is null)
      and (reaction is null or (kind = 'notice' and reaction ~ '^[a-z][a-z_]{1,15}$'))
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'notifications_response_change_v3') then
    alter table public.notifications add constraint notifications_response_change_v3 check (
      response_changes between 0 and 1000
      and (response_changed_at is null or response is not null)
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'notifications_poll_v3') then
    alter table public.notifications add constraint notifications_poll_v3 check (
      (poll_choice is null) = (poll_voted_at is null)
      and (poll_choice is null or (kind = 'notice' and cardinality(poll_choice) between 1 and 6))
      and poll_changes between 0 and 1000
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'notifications_interaction_writes_v3') then
    alter table public.notifications add constraint notifications_interaction_writes_v3 check (interaction_writes between 0 and 1000);
  end if;
end;
$$;

-- Contagem da enquete: so as linhas com voto, sem os testes da equipe (o sino e o voto leem por aqui, 4.2).
create index if not exists notifications_poll_tally_idx
  on public.notifications (campaign_id) where poll_choice is not null and not is_test;

/* ------------------------------------------------------------------------------------------------
 * 3. Pop-up por aluno: "mostrar de novo para quem ja viu"
 * ---------------------------------------------------------------------------------------------- */

alter table public.campaign_deliveries
  add column if not exists reshown_at timestamptz,
  add column if not exists impressions_before_reshow integer not null default 0,
  add column if not exists snoozes_before_reshow smallint not null default 0;

comment on column public.campaign_deliveries.reshown_at is
  'Ultimo "mostrar de novo" que valeu para este aluno: o visto antes disto nao conta para "ate o aluno clicar".';
comment on column public.campaign_deliveries.impressions_before_reshow is
  'Impressoes antes do ultimo "mostrar de novo" (a regra "Uma vez" conta so as de depois). Os numeros do relatorio usam as colunas da v1.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_deliveries_reshow_v3') then
    alter table public.campaign_deliveries add constraint campaign_deliveries_reshow_v3 check (
      impressions_before_reshow between 0 and impressions
      and snoozes_before_reshow between 0 and snooze_count
    );
  end if;
end;
$$;

/* ------------------------------------------------------------------------------------------------
 * 4. Leitura do sino (so service_role; security invoker)
 * ---------------------------------------------------------------------------------------------- */

-- 4.1 A regra de "aparece no sino", num lugar so: do aluno, dos ultimos 90 dias, antes do fim, nao excluida
--     por ele; aviso nao excluido e enviado (o teste da equipe aparece); comentario aprovado e nao apagado,
--     e o comentario respondido tambem (quando o payload cita um). p_id = uma linha (conferencia das rotas).
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

-- 4.2 Contagem de uma enquete numa passada so (quem votou e votos por opcao), sem os testes da equipe, pelo
--     indice notifications_poll_tally_idx: le so as linhas com voto. Antes das funcoes que a chamam.
create or replace function public.communication_poll_tally(p_campaign_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with votes as materialized (
    select t.id, x.option_id
    from public.notifications t
    cross join lateral unnest(t.poll_choice) as x(option_id)
    where t.campaign_id = p_campaign_id and t.poll_choice is not null and not t.is_test
  )
  select jsonb_build_object(
    'voters', (select count(distinct v.id) from votes v),
    'counts', coalesce((
      select jsonb_object_agg(g.option_id, g.votes)
      from (select v.option_id, count(*) as votes from votes v group by v.option_id) g
    ), '{}'::jsonb)
  );
$$;

-- 4.3 Uma pagina do sino numa ida ao banco: as linhas (com o aviso, quem envia ainda na equipe, quem
--     respondeu e a contagem da enquete) e os dois numeros. Devolve ate p_limit + 1 itens: o app corta e
--     sabe se ha proxima pagina. Cursor = (created_at, id) da ultima linha entregue.
create or replace function public.communication_inbox_page(
  p_user_id uuid,
  p_filter text,
  p_cursor_created_at timestamptz,
  p_cursor_id uuid,
  p_limit integer,
  p_now timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with visible as (
    select v.* from public.communication_visible_notifications(p_user_id, p_now, null) v
  ),
  page as (
    select v.id, v.created_at
    from visible v
    where (p_filter is distinct from 'unread' or v.read_at is null)
      and (p_cursor_created_at is null or (v.created_at, v.id) < (p_cursor_created_at, p_cursor_id))
    order by v.created_at desc, v.id desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50) + 1
  ),
  items as (
    select p.created_at as sort_at, p.id as sort_id, jsonb_build_object(
      'id', n.id, 'kind', n.kind, 'campaign_id', n.campaign_id, 'is_test', n.is_test, 'actor_id', n.actor_id,
      'title', n.title, 'body', n.body, 'href', n.href, 'payload', n.payload,
      'seen_at', n.seen_at, 'read_at', n.read_at, 'opened_at', n.opened_at, 'clicked_at', n.clicked_at,
      'response', n.response, 'responded_at', n.responded_at, 'created_at', n.created_at, 'expires_at', n.expires_at,
      'audio_started_at', n.audio_started_at, 'audio_heard', n.audio_heard, 'audio_heard_percent', n.audio_heard_percent,
      'audio_completed_at', n.audio_completed_at, 'reaction', n.reaction, 'poll_choice', to_jsonb(n.poll_choice),
      'campaign', case when c.id is null then null else jsonb_build_object(
        'id', c.id, 'status', c.status, 'title', c.title, 'body', c.body, 'image_url', c.image_url,
        'image_alt', c.image_alt, 'audio_url', c.audio_url, 'audio_mime', c.audio_mime,
        'audio_duration_seconds', c.audio_duration_seconds, 'audio_peaks', c.audio_peaks,
        'cta_label', c.cta_label, 'cta_href', c.cta_href, 'cta_target', c.cta_target, 'cta_display', c.cta_display,
        'response_mode', c.response_mode, 'accept_label', c.accept_label, 'decline_label', c.decline_label,
        'sender_user_id', c.sender_user_id, 'icon', c.icon, 'icon_color', c.icon_color,
        'allow_reactions', c.allow_reactions, 'poll', c.poll
      ) end,
      'sender_on_team', c.sender_user_id is not null and exists (select 1 from public.admin_roles a where a.user_id = c.sender_user_id),
      'sender_profile', (select jsonb_build_object('full_name', sp.full_name, 'avatar_url', sp.avatar_url) from public.profiles sp where sp.id = c.sender_user_id),
      'actor_profile', (select jsonb_build_object('full_name', ap.full_name, 'avatar_url', ap.avatar_url) from public.profiles ap where ap.id = n.actor_id),
      'reply', case when n.kind <> 'notice' then (
        select jsonb_build_object('author_name', r.author_name, 'author_avatar_url', r.author_avatar_url)
        from public.lesson_comments r
        where r.id = (
          case when n.payload->>'commentId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (n.payload->>'commentId')::uuid end
        )
      ) end,
      -- So quando o aluno ve o resultado: a equipe deixou mostrar e ele votou ou a enquete encerrou pela data
      -- (closesAt e ISO canonico pelo check: compara como texto). Fora disso o app jogaria a contagem fora.
      'poll_tally', case
        when c.poll is not null and (c.poll->'showResults') = 'true'::jsonb
          and (n.poll_choice is not null
            or (c.poll->>'closesAt') <= to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        then public.communication_poll_tally(n.campaign_id)
      end
    ) as item
    from page p
    join public.notifications n on n.id = p.id
    left join public.campaigns c on c.id = n.campaign_id
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(i.item order by i.sort_at desc, i.sort_id desc) from items i), '[]'::jsonb),
    'unseen', (select least(count(*), 100) from visible v where v.seen_at is null),
    'unread', (select least(count(*), 500) from visible v where v.read_at is null)
  );
$$;

-- 4.4 Os dois numeros do sino (resumo de cada pagina e depois de cada escrita do aluno).
create or replace function public.communication_inbox_counts(p_user_id uuid, p_now timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'unseen', least(count(*) filter (where v.seen_at is null), 100),
    'unread', least(count(*) filter (where v.read_at is null), 500)
  )
  from public.communication_visible_notifications(p_user_id, p_now, null) v;
$$;

/* ------------------------------------------------------------------------------------------------
 * 5. Escritas do aluno e da equipe que precisam de contador ou de trava (so service_role)
 * ---------------------------------------------------------------------------------------------- */

-- 5.1 Aceitar/Recusar, tambem mudar a resposta. Mesma resposta = nada muda. responded_at fica o da primeira.
--     A rota ja conferiu que a linha e do aluno, aparece no sino e o aviso pede resposta.
create or replace function public.communication_respond_notification(
  p_user_id uuid, p_notification_id uuid, p_response text, p_now timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v public.notifications%rowtype;
begin
  if p_response is null or p_response not in ('accepted', 'declined') then
    raise exception 'Resposta invalida.' using errcode = '22023';
  end if;

  select * into v from public.notifications n
  where n.id = p_notification_id and n.user_id = p_user_id and n.kind = 'notice'
  for update;

  if not found then
    return null;
  end if;

  if v.response = p_response then
    return jsonb_build_object('response', v.response, 'changed', false, 'first', false, 'writes', v.interaction_writes);
  end if;

  update public.notifications n set
    response = p_response,
    responded_at = coalesce(n.responded_at, p_now),
    response_changed_at = case when n.response is null then n.response_changed_at else p_now end,
    response_changes = case when n.response is null then n.response_changes else least(n.response_changes + 1, 1000) end,
    interaction_writes = least(n.interaction_writes + 1, 1000),
    seen_at = coalesce(n.seen_at, p_now),
    read_at = coalesce(n.read_at, p_now),
    opened_at = coalesce(n.opened_at, p_now)
  where n.id = v.id;

  -- writes = escritas antes desta (o app so grava o evento abaixo de 20).
  return jsonb_build_object('response', p_response, 'changed', v.response is not null, 'first', v.response is null, 'writes', v.interaction_writes);
end;
$$;

-- 5.2 Voto na enquete (vazio = tirar o voto). Devolve o voto e, so quando o aluno vai ver o resultado (votou
--     e a equipe deixou mostrar), a contagem do aviso sem os testes (4.2). A rota ja conferiu a enquete
--     (aberta, opcoes que existem, uma ou varias).
create or replace function public.communication_vote_notification_poll(
  p_user_id uuid, p_notification_id uuid, p_option_ids text[], p_now timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v public.notifications%rowtype;
  v_choice text[];
  v_same boolean;
  v_show boolean;
begin
  v_choice := case
    when coalesce(cardinality(p_option_ids), 0) = 0 then null
    else (select array_agg(distinct o order by o) from unnest(p_option_ids) as o)
  end;

  if v_choice is not null and (cardinality(v_choice) > 6 or exists (select 1 from unnest(v_choice) as o where o !~ '^[a-z0-9]{1,12}$')) then
    raise exception 'Voto invalido.' using errcode = '22023';
  end if;

  select * into v from public.notifications n
  where n.id = p_notification_id and n.user_id = p_user_id and n.kind = 'notice'
  for update;

  if not found then
    return null;
  end if;

  v_same := v.poll_choice is not distinct from v_choice;

  if not v_same then
    update public.notifications n set
      poll_choice = v_choice,
      poll_voted_at = case when v_choice is null then null else coalesce(n.poll_voted_at, p_now) end,
      poll_changes = case when n.poll_choice is null then n.poll_changes else least(n.poll_changes + 1, 1000) end,
      interaction_writes = least(n.interaction_writes + 1, 1000),
      seen_at = coalesce(n.seen_at, p_now),
      read_at = coalesce(n.read_at, p_now),
      opened_at = coalesce(n.opened_at, p_now)
    where n.id = v.id;
  end if;

  select (c.poll->'showResults') = 'true'::jsonb into v_show from public.campaigns c where c.id = v.campaign_id;

  return jsonb_build_object(
    'choice', coalesce(to_jsonb(v_choice), '[]'::jsonb),
    'changed', not v_same and v.poll_choice is not null,
    'first', not v_same and v.poll_choice is null,
    'writes', v.interaction_writes,
    'tally', case when v_choice is not null and coalesce(v_show, false) then public.communication_poll_tally(v.campaign_id) end
  );
end;
$$;

-- 5.3 "Mostrar de novo para quem ja viu", so no pop-up "Uma vez": quem ainda esta no segmento, viu mais vezes
--     do que adiou desde o ultimo "mostrar de novo" (a regra "Uma vez" o pularia) e nao clicou nem escolheu
--     "Nao mostrar de novo" volta a contar como novo. Lembrar depois volta a valer 2 vezes (snooze_count cai
--     para 0 ou 1, para o numero "Lembrar depois" do relatorio, que conta snooze_count > 0, nao mudar).
--     p_apply false = so conta, pela regra "Uma vez" (o editor pode estar trocando para ela); p_apply true so
--     vale com popup_repeat = 'once' (senao null). p_max = teto sem publish_large (500); acima, nao muda nada
--     e devolve refused. Em "Ate o aluno clicar" nao ha o que zerar: o intervalo de 24 h de todos os pop-ups
--     ja conta a partir do ultimo visto, este incluido.
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
begin
  if p_apply then
    perform 1 from public.campaigns c
    where c.id = p_campaign_id and c.kind = 'popup' and c.status in ('active', 'paused') and c.deleted_at is null
      and c.popup_repeat = 'once'
    for update;
  else
    perform 1 from public.campaigns c
    where c.id = p_campaign_id and c.kind = 'popup' and c.status in ('active', 'paused') and c.deleted_at is null;
  end if;

  if not found then
    return null;
  end if;

  select count(*) into v_count
  from public.campaign_deliveries d
  where d.campaign_id = p_campaign_id
    and d.eligible
    and d.clicked_at is null
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
    and d.clicked_at is null
    and d.dismissed_at is null
    and d.impressions - d.impressions_before_reshow > d.snooze_count - d.snoozes_before_reshow;
  get diagnostics v_count = row_count;

  return jsonb_build_object('count', v_count, 'reshown', v_count, 'refused', false);
end;
$$;

-- 5.4 Numeros das interacoes por aviso (p_campaign_ids) ou por passo de um fluxo (p_flow_id), sem testes:
--     reacted, poll_voters, hidden, response_changed, poll_changed (item = '') e reaction / poll_option
--     (item = o id). communication_campaign_stats e communication_flow_node_stats nao mudam.
create or replace function public.communication_message_interactions(p_campaign_ids uuid[], p_flow_id uuid)
returns table (scope text, scope_id uuid, metric text, item text, total bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with source as (
    select 'campaign'::text as s_scope, n.campaign_id as s_id, n.reaction as s_reaction, n.poll_choice as s_choice,
      n.hidden_at as s_hidden, n.response_changes as s_response_changes, n.poll_changes as s_poll_changes
    from public.notifications n
    where n.campaign_id = any(coalesce(p_campaign_ids, array[]::uuid[])) and not n.is_test
    union all
    select 'node'::text, n.flow_node_id, n.reaction, n.poll_choice, n.hidden_at, n.response_changes, n.poll_changes
    from public.notifications n
    where p_flow_id is not null and n.flow_id = p_flow_id and n.flow_node_id is not null and not n.is_test
  ),
  totals as (
    select s.s_scope, s.s_id,
      count(*) filter (where s.s_reaction is not null) as reacted,
      count(*) filter (where s.s_choice is not null) as voters,
      count(*) filter (where s.s_hidden is not null) as hidden,
      count(*) filter (where s.s_response_changes > 0) as response_changed,
      count(*) filter (where s.s_poll_changes > 0) as poll_changed
    from source s
    group by s.s_scope, s.s_id
  )
  select t.s_scope, t.s_id, m.metric, ''::text, m.total
  from totals t
  cross join lateral (
    values ('reacted', t.reacted), ('poll_voters', t.voters), ('hidden', t.hidden),
      ('response_changed', t.response_changed), ('poll_changed', t.poll_changed)
  ) as m(metric, total)
  union all
  select s.s_scope, s.s_id, 'reaction'::text, s.s_reaction, count(*)
  from source s
  where s.s_reaction is not null
  group by s.s_scope, s.s_id, s.s_reaction
  union all
  select s.s_scope, s.s_id, 'poll_option'::text, o.option_id, count(*)
  from source s
  cross join lateral unnest(s.s_choice) as o(option_id)
  group by s.s_scope, s.s_id, o.option_id;
$$;

-- 5.5 (7.9 da 0002, mesma assinatura e mesmo retorno) Fatos de um lote do motor: as linhas do sino trazem
--     tambem a reacao, o voto e se o aluno excluiu do sino (regras "reagiu", "votou", "excluiu do sino").
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
        'reaction', n.reaction, 'poll_choice', to_jsonb(n.poll_choice), 'hidden_at', n.hidden_at,
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

-- 5.6 Quem cita estas notificacoes nas regras ("o que fez com a notificacao X", ref {"campaignId": ...}):
--     avisos que ainda vao contar o segmento (rascunho, aguardando, agendado, pop-up no ar ou pausado) e
--     fluxos que nao terminaram (Quem entra, Objetivo, filtros e condicoes dos passos), fora o proprio fluxo
--     das seguintes. Compara texto (sem cast): o dialogo de Excluir e de Retirar do sino avisa.
create or replace function public.communication_notice_citations(p_campaign_ids uuid[])
returns table (campaign_id uuid, notices bigint, flows bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with wanted as (
    select distinct w.id, w.id::text as key from unnest(coalesce(p_campaign_ids, array[]::uuid[])) as w(id)
  ),
  notice_refs as (
    select distinct c.id as source_id, m[1] as key
    from public.campaigns c
    cross join lateral regexp_matches(c.audience::text, '"campaignId": "([0-9a-f-]{36})"', 'g') as m
    where c.deleted_at is null and c.flow_id is null
      and c.status in ('draft', 'pending_approval', 'scheduled', 'active', 'paused')
  ),
  flow_refs as (
    select distinct f.id as source_id, f.source_campaign_id, m[1] as key
    from public.communication_flows f
    cross join lateral regexp_matches(
      concat_ws(' ', f.entry_audience::text, f.goal::text, (
        select string_agg(concat_ws(' ', fn.filter::text, fn.condition::text), ' ')
        from public.communication_flow_nodes fn
        where fn.flow_id = f.id and fn.removed_at is null
      )),
      '"campaignId": "([0-9a-f-]{36})"', 'g'
    ) as m
    where f.deleted_at is null and f.status in ('draft', 'pending_approval', 'active', 'paused')
  )
  select w.id,
    (select count(*) from notice_refs r where r.key = w.key and r.source_id <> w.id),
    (select count(*) from flow_refs r where r.key = w.key and r.source_campaign_id is distinct from w.id)
  from wanted w;
$$;

/* ------------------------------------------------------------------------------------------------
 * 6. Permissoes das funcoes (assinatura exata) e descricoes. A 7.9 ja tinha as suas (create or replace
 *    mantem); repetidas aqui para a funcao nunca ficar aberta se esta secao rodar sozinha num banco novo.
 * ---------------------------------------------------------------------------------------------- */

revoke all on function public.communication_flow_batch_facts(uuid[], text[], text[], uuid[]) from public, anon, authenticated;
grant execute on function public.communication_flow_batch_facts(uuid[], text[], text[], uuid[]) to service_role;

revoke all on function public.communication_visible_notifications(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.communication_visible_notifications(uuid, timestamptz, uuid) to service_role;
comment on function public.communication_visible_notifications(uuid, timestamptz, uuid) is
  'O que aparece no sino do aluno agora (a regra unica): 90 dias, antes do fim, nao excluida por ele, aviso enviado ou teste, comentario visivel.';

revoke all on function public.communication_poll_tally(uuid) from public, anon, authenticated;
grant execute on function public.communication_poll_tally(uuid) to service_role;
comment on function public.communication_poll_tally(uuid) is
  'Contagem de uma enquete (quem votou e votos por opcao), sem testes, numa passada pelo indice parcial.';

revoke all on function public.communication_inbox_page(uuid, text, timestamptz, uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.communication_inbox_page(uuid, text, timestamptz, uuid, integer, timestamptz) to service_role;
comment on function public.communication_inbox_page(uuid, text, timestamptz, uuid, integer, timestamptz) is
  'Uma pagina do sino numa ida ao banco: linhas com o aviso, quem envia, quem respondeu e a contagem da enquete, mais os dois numeros.';

revoke all on function public.communication_inbox_counts(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.communication_inbox_counts(uuid, timestamptz) to service_role;
comment on function public.communication_inbox_counts(uuid, timestamptz) is
  'Numero do sino (novas, ate 100) e nao lidas (ate 500) pela regra unica do que aparece.';

revoke all on function public.communication_respond_notification(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.communication_respond_notification(uuid, uuid, text, timestamptz) to service_role;
comment on function public.communication_respond_notification(uuid, uuid, text, timestamptz) is
  'Aceitar ou Recusar, tambem mudar a resposta (conta as mudancas; responded_at fica o da primeira).';

revoke all on function public.communication_vote_notification_poll(uuid, uuid, text[], timestamptz) from public, anon, authenticated;
grant execute on function public.communication_vote_notification_poll(uuid, uuid, text[], timestamptz) to service_role;
comment on function public.communication_vote_notification_poll(uuid, uuid, text[], timestamptz) is
  'Voto na enquete do aviso (vazio tira o voto), com a contagem do aviso sem os testes.';

revoke all on function public.communication_reshow_popup(uuid, timestamptz, integer, boolean) from public, anon, authenticated;
grant execute on function public.communication_reshow_popup(uuid, timestamptz, integer, boolean) to service_role;
comment on function public.communication_reshow_popup(uuid, timestamptz, integer, boolean) is
  'Mostrar de novo (pop-up Uma vez) para quem ainda esta no segmento, viu e nao clicou nem escolheu Nao mostrar de novo (p_apply false so conta; acima de p_max, recusa).';

revoke all on function public.communication_message_interactions(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.communication_message_interactions(uuid[], uuid) to service_role;
comment on function public.communication_message_interactions(uuid[], uuid) is
  'Reacoes, votos, excluidas do sino e mudancas de resposta por aviso ou por passo de fluxo (sem testes).';

revoke all on function public.communication_notice_citations(uuid[]) from public, anon, authenticated;
grant execute on function public.communication_notice_citations(uuid[]) to service_role;
comment on function public.communication_notice_citations(uuid[]) is
  'Quantos avisos (que ainda contam o segmento) e fluxos (nao encerrados) citam cada notificacao nas regras.';
