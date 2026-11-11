-- Webinarios v7, "Na tela" (docs/30 §1.3, §1.4, §2.4, §3.4 e §4.2; docs/31 §12; pedido do produtor de 10/11/2026):
-- o banner e o QR Code que a equipe poe na frente da turma numa sessao, a enquete fixada e os numeros de cada exibicao.
-- Na mesma migracao, o adendo do mesmo dia: a Simulacao e o roteiro na Live ao vivo (R7 e R8) e a foto dos personagens
-- do roteiro (R9). As migracoes de antes nao mudam; este arquivo so acrescenta.
--
-- Regras:
-- - webinar_screen_items: os banners e QR Codes prontos de um webinario (reusados em todas as sessoes). So o caminho
--   da imagem no bucket content-assets (webinars/screen/<24 hex>.webp), nunca um endereco; link so https. O QR Code
--   tem link de ate 240 caracteres; o banner tem imagem ou titulo, e botao so com link; "no meio" sem poder fechar
--   nunca e Grande. As listas e os limites sao os do app (screen-model.ts);
-- - webinar_screen_displays: cada exibicao numa sessao (banner, qr ou a enquete fixada), com a copia congelada do item
--   (snapshot), quando entrou e quando saiu. No maximo uma exibicao de cada tipo na tela por sessao (indice unico
--   parcial). A mensagem fixada continua em webinar_sessions.pinned_message_id;
-- - webinar_screen_report: por exibicao, quantos alunos viram, clicaram e fecharam (student_events, entity_type
--   'webinar', entity_id = a sessao), sem quem tem linha em admin_roles;
-- - R7: o check webinar_sessions_simulation_not_live_v4 (202610300003: a sessao `live` sem nenhuma regra simulada) sai,
--   e entra o webinar_sessions_simulation_live_v7: a sessao `live` pode ter o contador, as entradas e os avisos de venda
--   simulados e o resumo congelado no fim, como a gravada, mas nunca o selo "Ao vivo" da gravada (show_live_badge e a
--   decisao da sessao gravada; a live e ao vivo de verdade). O check novo aceita tudo que o app de antes grava, entao a
--   migracao sozinha nao atrapalha o app no ar; o unico drop e o do check antigo, dentro do bloco que so roda sem o
--   check novo;
-- - R9: webinar_chat_script_items.persona_avatar_path (a foto do personagem, so o caminho webinars/personas/<24
--   hex>.webp no content-assets, nunca um endereco) e webinar_chat_messages.persona_avatar_path (a copia na mensagem
--   `scripted`, nula em tudo que nao e scripted). A mensagem guarda a foto como ja guarda o nome, o papel e o texto do
--   item: o que a turma viu nao muda quando a equipe troca a foto do item depois, nem quando o item sai do roteiro (o
--   script_item_id da mensagem vira nulo), e o "Enviar agora" do console pode soltar um comentario sem item;
-- - webinar_open_session (mesma assinatura, o corpo completo da 202610290001): a mensagem `scripted` leva a foto do
--   item, e a sessao `live` nao solta o roteiro ao abrir (R8: os itens da live entram pelo tick, contados do
--   started_at, nunca antes do "Comecar para todos"). Ate o adendo a live nao tinha roteiro (o editor e as acoes so o
--   aceitam na gravada), entao o app de antes nao percebe a troca. Ao contrario, o app novo num banco sem esta migracao
--   recusa (409, antes de gravar) toda escrita do roteiro da Live ao vivo: a funcao de antes soltaria no "Comecar para
--   todos" todo o roteiro com minuto da live de uma vez (docs/21 §9.13); a gravada segue como antes;
-- - as colunas novas nao entram nas listas que o app sempre le (SESSION_COLUMNS, CHAT_MESSAGE_COLUMNS,
--   SCRIPT_ITEM_COLUMNS): o app publicado antes da migracao continua funcionando; tabelas novas so do service_role (o
--   aluno nunca le nem grava direto); nada de create policy, alter policy, delete nem truncate;
-- - os checks novos das tabelas que ja existem entram `not valid` (secoes 4 e 5, sem ler as linhas) e sao validados na
--   secao 7 (que le cada tabela com um bloqueio que deixa ler e gravar). Sete secoes, cada uma pelo MCP do Supabase
--   (execute_sql, uma por chamada, na ordem; as secoes 4, 5 e 7 comecando com `set lock_timeout = '5s';`), ou
--   apply_migration com o arquivo inteiro.
--
-- Verificacao manual depois de aplicar:
--   select table_name from information_schema.tables where table_schema = 'public'
--     and table_name in ('webinar_screen_items', 'webinar_screen_displays'); -- 2 linhas
--   select has_table_privilege('authenticated', 'public.webinar_screen_items', 'select'),
--          has_table_privilege('authenticated', 'public.webinar_screen_displays', 'select'); -- false, false
--   select relrowsecurity from pg_class where oid in ('public.webinar_screen_items'::regclass,
--     'public.webinar_screen_displays'::regclass); -- true, true
--   select indexname from pg_indexes where schemaname = 'public' and indexname like 'webinar_screen_%'; -- 3 + 2 pkey
--   select * from public.webinar_screen_report(gen_random_uuid()); -- 0 linhas
--   select conname, convalidated from pg_constraint where conname in ('webinar_sessions_simulation_not_live_v4',
--     'webinar_sessions_simulation_live_v7', 'webinar_chat_script_items_persona_avatar_v7',
--     'webinar_chat_messages_persona_avatar_v7') order by 1; -- 3 linhas (sem a _v4), convalidated = true
--   select table_name from information_schema.columns where table_schema = 'public'
--     and column_name = 'persona_avatar_path' order by 1; -- webinar_chat_messages, webinar_chat_script_items
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. webinar_screen_items: os banners e QR Codes prontos de um webinario. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_screen_items (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  kind text not null check (kind in ('banner', 'qr')),
  name text not null check (char_length(name) between 1 and 60),
  title text check (title is null or char_length(title) between 1 and 80),
  body text check (body is null or char_length(body) between 1 and 200),
  button_label text check (button_label is null or char_length(button_label) between 1 and 30),
  link_url text check (link_url is null or (char_length(link_url) <= 500 and link_url ~ '^https://[^[:space:]]+$')),
  image_path text check (image_path is null or image_path ~ '^webinars/screen/[a-f0-9]{24}[.]webp$'),
  image_width integer check (image_width is null or image_width between 16 and 1280),
  image_height integer check (image_height is null or image_height between 16 and 1280),
  image_alt text check (image_alt is null or char_length(image_alt) between 1 and 120),
  place text not null default 'bottom_right' check (place in ('top_left', 'top_center', 'top_right', 'middle_left', 'center', 'middle_right', 'bottom_left', 'bottom_center', 'bottom_right')),
  size text not null default 'm' check (size in ('s', 'm', 'l')),
  closable boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint webinar_screen_items_content_v7 check (
    (kind = 'qr' and link_url is not null and char_length(link_url) <= 240 and body is null and button_label is null and image_path is null)
    or (kind = 'banner' and (image_path is not null or title is not null) and (button_label is null or link_url is not null))
  ),
  constraint webinar_screen_items_image_v7 check (
    (image_path is null and image_width is null and image_height is null and image_alt is null)
    or (image_path is not null and image_width is not null and image_height is not null and (title is not null or image_alt is not null))
  ),
  constraint webinar_screen_items_center_v7 check (not (place = 'center' and closable = false and size = 'l'))
);

comment on table public.webinar_screen_items is 'Na tela (docs/30 §2.4): os banners e QR Codes prontos de um webinario, que a equipe mostra no console da sessao.';

create index if not exists webinar_screen_items_webinar_idx on public.webinar_screen_items (webinar_id, created_at) where archived_at is null;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_webinar_screen_items_updated_at' and tgrelid = 'public.webinar_screen_items'::regclass
  ) then
    create trigger set_webinar_screen_items_updated_at
      before update on public.webinar_screen_items
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.webinar_screen_items enable row level security;
revoke all on public.webinar_screen_items from anon, authenticated;
grant select, insert, update, delete on public.webinar_screen_items to service_role;

/* ------------------------------------------------------------------------------------------------
 * 2. webinar_screen_displays: cada exibicao numa sessao (banner, qr ou a enquete fixada). MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_screen_displays (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.webinar_sessions(id) on delete cascade,
  kind text not null check (kind in ('banner', 'qr', 'poll')),
  item_id uuid references public.webinar_screen_items(id) on delete set null,
  poll_id uuid references public.webinar_polls(id) on delete cascade,
  snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(snapshot) = 'object' and pg_column_size(snapshot) <= 4096),
  shown_at timestamptz not null default now(),
  shown_offset_ms integer,
  shown_by uuid references auth.users(id) on delete set null,
  hidden_at timestamptz,
  hidden_offset_ms integer,
  hidden_by uuid references auth.users(id) on delete set null,
  hidden_reason text check (hidden_reason is null or hidden_reason in ('team', 'replaced', 'poll_closed')),
  created_at timestamptz not null default now(),
  constraint webinar_screen_displays_target_v7 check ((kind = 'poll') = (poll_id is not null)),
  constraint webinar_screen_displays_window_v7 check (
    (hidden_at is null and hidden_reason is null)
    or (hidden_at is not null and hidden_at >= shown_at and hidden_reason is not null)
  )
);

comment on table public.webinar_screen_displays is 'Na tela (docs/30 §4.2): cada vez que a equipe mostrou um banner, um QR Code ou fixou uma enquete numa sessao, com a copia do que foi mostrado.';

create unique index if not exists webinar_screen_displays_active_idx on public.webinar_screen_displays (session_id, kind) where hidden_at is null;
create index if not exists webinar_screen_displays_session_idx on public.webinar_screen_displays (session_id, shown_at);

alter table public.webinar_screen_displays enable row level security;
revoke all on public.webinar_screen_displays from anon, authenticated;
grant select, insert, update, delete on public.webinar_screen_displays to service_role;

/* ------------------------------------------------------------------------------------------------
 * 3. webinar_screen_report: os numeros de cada exibicao de uma sessao. MCP.
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.webinar_screen_report(p_session_id uuid)
returns table (display_id text, shown bigint, clickers bigint, clicks bigint, closed bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    e.metadata->>'display_id' as display_id,
    count(distinct e.user_id) filter (where e.event_type = 'webinar_screen_shown') as shown,
    count(distinct e.user_id) filter (where e.event_type = 'webinar_screen_clicked') as clickers,
    count(*) filter (where e.event_type = 'webinar_screen_clicked') as clicks,
    count(distinct e.user_id) filter (where e.event_type = 'webinar_screen_closed') as closed
  from public.student_events e
  where e.entity_type = 'webinar'
    and e.entity_id = p_session_id::text
    and e.event_type in ('webinar_screen_shown', 'webinar_screen_clicked', 'webinar_screen_closed')
    and e.metadata ? 'display_id'
    and not exists (select 1 from public.admin_roles a where a.user_id = e.user_id)
  group by 1
$$;

revoke all on function public.webinar_screen_report(uuid) from public, anon, authenticated;
grant execute on function public.webinar_screen_report(uuid) to service_role;

/* ------------------------------------------------------------------------------------------------
 * 4. webinar_sessions: a Simulacao na Live ao vivo (R7), o check novo sem ler as linhas. MCP.
 * ---------------------------------------------------------------------------------------------- */

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webinar_sessions_simulation_live_v7') then
    alter table public.webinar_sessions drop constraint if exists webinar_sessions_simulation_not_live_v4;
    alter table public.webinar_sessions add constraint webinar_sessions_simulation_live_v7
      check (kind <> 'live' or show_live_badge = false) not valid;
  end if;
end;
$$;

/* ------------------------------------------------------------------------------------------------
 * 5. webinar_chat_script_items e webinar_chat_messages: a foto do personagem (R9), sem ler as linhas. MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinar_chat_script_items add column if not exists persona_avatar_path text;
alter table public.webinar_chat_messages add column if not exists persona_avatar_path text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webinar_chat_script_items_persona_avatar_v7') then
    alter table public.webinar_chat_script_items add constraint webinar_chat_script_items_persona_avatar_v7
      check (persona_avatar_path is null or persona_avatar_path ~ '^webinars/personas/[a-f0-9]{24}[.]webp$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'webinar_chat_messages_persona_avatar_v7') then
    alter table public.webinar_chat_messages add constraint webinar_chat_messages_persona_avatar_v7
      check (persona_avatar_path is null or (source = 'scripted' and persona_avatar_path ~ '^webinars/personas/[a-f0-9]{24}[.]webp$')) not valid;
  end if;
end;
$$;

comment on column public.webinar_chat_script_items.persona_avatar_path is
  'A foto do personagem (R9): so o caminho no content-assets (webinars/personas/<24 hex>.webp); o app monta o endereco pela origem do nosso Supabase.';
comment on column public.webinar_chat_messages.persona_avatar_path is
  'A copia da foto do personagem na mensagem scripted (R9), como o nome e o texto: o que a turma viu nao muda depois. Nula no resto.';

/* ------------------------------------------------------------------------------------------------
 * 6. webinar_open_session (corpo completo da 202610290001): a foto do personagem e a Live ao vivo sem roteiro ao abrir. MCP.
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.webinar_open_session(p_session_id uuid, p_now timestamptz default now())
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_session public.webinar_sessions%rowtype;
  v_fired integer := 0;
begin
  select * into v_session from public.webinar_sessions where id = p_session_id for update;
  if not found then
    raise exception 'webinar session % not found', p_session_id using errcode = 'P0002';
  end if;
  if v_session.status in ('ended', 'cancelled') then
    return jsonb_build_object('status', v_session.status, 'fired', 0, 'changed', false);
  end if;

  -- O roteiro entra uma vez por sessao (a chave unica session_id + script_item_id segura a repeticao).
  -- v7: a foto do personagem vai com o nome e o texto (R9); a Live ao vivo fica de fora (R8: o tick solta os itens
  -- dela contados do started_at, nunca antes do "Comecar para todos").
  if v_session.script_fired_at is null then
    insert into public.webinar_chat_messages
      (webinar_id, session_id, offset_ms, author_user_id, display_name, role, source, body, kind, script_item_id,
       persona_avatar_path,
       master, approved, created_at)
    select v_session.webinar_id, v_session.id,
      case i.trigger_kind when 'at_offset' then i.offset_ms else i.resolved_offset_ms end,
      null, i.persona_name, i.persona_role, 'scripted', i.body, i.kind, i.id,
      i.persona_avatar_path,
      false, true,
      v_session.scheduled_at + make_interval(secs => (case i.trigger_kind when 'at_offset' then i.offset_ms else i.resolved_offset_ms end) / 1000.0)
    from public.webinar_chat_script_items i
    where i.webinar_id = v_session.webinar_id
      and v_session.kind <> 'live'
      and i.status = 'ready'
      and i.trigger_kind in ('at_offset', 'on_phrase')
      and (case i.trigger_kind when 'at_offset' then i.offset_ms else i.resolved_offset_ms end) is not null
    on conflict (session_id, script_item_id) where script_item_id is not null do nothing;
    get diagnostics v_fired = row_count;
  end if;

  update public.webinar_sessions
  set status = 'live',
      started_at = coalesce(started_at, case when kind = 'simulated' then scheduled_at else p_now end),
      script_fired_at = coalesce(script_fired_at, p_now)
  where id = p_session_id;

  return jsonb_build_object('status', 'live', 'fired', v_fired, 'changed', v_session.status <> 'live');
end;
$$;

comment on function public.webinar_open_session(uuid, timestamptz) is
  'Poe a sessao em live (started_at = hora marcada na gravada) e solta o roteiro pronto como mensagens scripted, uma vez, com a foto do personagem; na live o roteiro entra pelo tick.';

/* ------------------------------------------------------------------------------------------------
 * 7. A conferencia das linhas que ja existem (os tres checks novos; de novo, nada muda). MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinar_sessions validate constraint webinar_sessions_simulation_live_v7;
alter table public.webinar_chat_script_items validate constraint webinar_chat_script_items_persona_avatar_v7;
alter table public.webinar_chat_messages validate constraint webinar_chat_messages_persona_avatar_v7;
