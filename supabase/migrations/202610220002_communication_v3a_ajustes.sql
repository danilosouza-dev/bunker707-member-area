-- Comunicacao v3a, ajustes depois do primeiro teste do produtor (docs/24 §10). Arquivo novo: a
-- 202610220001 ja esta aplicada na nuvem e nao muda.
--
-- 1. "Permitir que o aluno exclua do sino" por notificacao: campaigns.allow_hide, padrao true (tudo o que
--    ja existe continua com a lixeira). A rota de excluir confere; o "Desfazer" vale sempre.
-- 2. Tempo no sino em minutos: o minimo cai de 60 para 5 minutos (campaigns_validity_v3). O check antigo
--    (campaigns_validity_v2, minimo 60) sai na secao 5, a unica que tira alguma coisa.
-- 3. A contagem da enquete que o aluno ve soma todas as versoes de um passo de fluxo (como o relatorio,
--    5.4 da 0001); fora de fluxo continua a do aviso. Mesma assinatura: o sino e o voto nao mudam.
-- 4. A pagina do sino leva allow_hide no aviso (4.3 da 0001 com uma chave a mais).
--
-- Secoes 1 a 4 passam pelo MCP do Supabase (execute_sql); a 5 vai sozinha (MCP ou SQL Editor). Tudo
-- idempotente.

/* ------------------------------------------------------------------------------------------------
 * 1. Lixeira por notificacao
 * ---------------------------------------------------------------------------------------------- */

alter table public.campaigns
  add column if not exists allow_hide boolean not null default true;

comment on column public.campaigns.allow_hide is
  'O aluno pode excluir a notificacao do proprio sino (lixeira). So notificacao; no pop-up nao tem efeito.';

/* ------------------------------------------------------------------------------------------------
 * 2. Tempo no sino a partir de 5 minutos
 * ---------------------------------------------------------------------------------------------- */

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_validity_v3') then
    alter table public.campaigns add constraint campaigns_validity_v3 check (
      (validity_minutes is null or validity_minutes between 5 and 129600)
      and not (validity_minutes is not null and valid_until is not null)
    );
  end if;
end;
$$;

comment on column public.campaigns.validity_minutes is
  'Quanto tempo a notificacao fica no sino depois de chegar (5 a 129600 minutos = 90 dias). Nulo com valid_until nulo = 90 dias.';

/* ------------------------------------------------------------------------------------------------
 * 3. Contagem da enquete por passo de fluxo
 * ---------------------------------------------------------------------------------------------- */

-- 3.1 (4.2 da 0001, mesma assinatura) Quem votou e votos por opcao, sem os testes da equipe. Num passo de
--     fluxo conta todas as versoes do passo (a enquete de um passo que ja chegou a alguem nao muda, entao
--     as opcoes valem o mesmo em todas). Pelo indice notifications_poll_tally_idx (campaign_id).
create or replace function public.communication_poll_tally(p_campaign_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with versions as (
    select p_campaign_id as id
    union
    select other.id
    from public.campaigns this
    join public.campaigns other on other.flow_node_id = this.flow_node_id
    where this.id = p_campaign_id and this.flow_node_id is not null
  ),
  votes as materialized (
    select t.id, x.option_id
    from public.notifications t
    cross join lateral unnest(t.poll_choice) as x(option_id)
    where t.campaign_id in (select v.id from versions v) and t.poll_choice is not null and not t.is_test
  )
  select jsonb_build_object(
    'voters', (select count(distinct v.id) from votes v),
    'counts', coalesce((
      select jsonb_object_agg(g.option_id, g.votes)
      from (select v.option_id, count(*) as votes from votes v group by v.option_id) g
    ), '{}'::jsonb)
  );
$$;

/* ------------------------------------------------------------------------------------------------
 * 4. Pagina do sino com allow_hide
 * ---------------------------------------------------------------------------------------------- */

-- 4.1 (4.3 da 0001, mesma assinatura) A pagina do sino; o aviso leva allow_hide (a lixeira do cartao).
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
        'allow_reactions', c.allow_reactions, 'poll', c.poll, 'allow_hide', c.allow_hide
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

-- Permissoes repetidas (create or replace mantem as da 0001; aqui para a funcao nunca ficar aberta).
revoke all on function public.communication_poll_tally(uuid) from public, anon, authenticated;
grant execute on function public.communication_poll_tally(uuid) to service_role;
comment on function public.communication_poll_tally(uuid) is
  'Contagem de uma enquete (quem votou e votos por opcao), sem testes; num passo de fluxo, todas as versoes do passo.';

revoke all on function public.communication_inbox_page(uuid, text, timestamptz, uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.communication_inbox_page(uuid, text, timestamptz, uuid, integer, timestamptz) to service_role;

/* ------------------------------------------------------------------------------------------------
 * 5. Sai o check antigo de 60 minutos (sozinha: MCP ou SQL Editor)
 * ---------------------------------------------------------------------------------------------- */

alter table public.campaigns drop constraint if exists campaigns_validity_v2;
