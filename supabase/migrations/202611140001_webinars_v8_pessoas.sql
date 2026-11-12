-- Webinarios v8, as pessoas que comentam e a pergunta simulada (docs/30 §2.2, §2.4, §2.7, §3.6, §4.2 e D75 a D78;
-- docs/31 §13.1; pedido do produtor de 11/11/2026): a lista de pessoas que comentam de cada webinario (o editor e o
-- console leem e gravam a mesma lista), o item do roteiro ligado a uma pessoa e a pergunta da aba Perguntas feita por
-- uma pessoa da lista, que nunca conta como pergunta real. As migracoes de antes nao mudam; este arquivo so acrescenta.
--
-- Regras:
-- - webinar_persona_name_key: o nome comparavel, igual ao do app (persona-model.personaNameKey): NFC, os espacos
--   repetidos viram um, sem espacos nas pontas e sem diferenca de caixa;
-- - webinar_personas: as pessoas que comentam de um webinario (Nome de 1 a 60, Aparece como Aluno ou Equipe, a Foto
--   opcional so pelo caminho webinars/personas/<24 hex>.webp do content-assets, como a da 202611100002); o nome e unico
--   no webinario pelo name_key (coluna gerada pela funcao acima, indice unico com o webinario). Some com o webinario
--   (cascade); so do service_role;
-- - webinar_chat_script_items.persona_id: o item ligado a uma pessoa (on delete set null). O item continua guardando a
--   copia do nome, do papel e da foto (persona_name, persona_role e persona_avatar_path): o roteiro, o CSV e o
--   webinar_open_session continuam lendo as copias; a pessoa e a fonte (o app atualiza as copias quando a pessoa muda,
--   e remover a pessoa deixa o item com a copia e sem a ligacao);
-- - webinar_questions: `source` ('audience' por padrao, a pergunta de um aluno; 'scripted', a pergunta simulada de uma
--   pessoa da lista), `persona_id`, `persona_role` e `persona_avatar_path` (as copias da pessoa, so na scripted). O
--   user_id passa a aceitar nulo, e so na scripted: nenhum aluno e dono dela (o check pede user_id na audience e nulo
--   na scripted). Um indice unico parcial segura uma pergunta simulada por mensagem do roteiro;
-- - o preenchimento (secao 5): uma pessoa por nome distinto (pelo name_key) dos itens do roteiro de cada webinario e das
--   mensagens scripted sem item (o "Enviar agora" do console), com o nome e o papel do mais recente e a foto mais recente
--   que existe (a linha mais nova sem foto nunca apaga a foto do nome; revisao v8 de 11/11/2026); e cada item ligado
--   a pessoa do nome dele, com a copia dela (as mensagens ja enviadas nao mudam). So roda com a lista ainda vazia (a primeira vez): rodar de novo nunca traz de volta uma pessoa
--   que a equipe tirou da lista;
-- - webinar_open_session (o corpo inteiro da 202611100002, mesma assinatura): na Live gravada, o item Pergunta solto na
--   abertura (a mensagem `scripted` de kind 'question', como antes) abre tambem a pergunta simulada ligada a mensagem
--   (message_id), com o minuto e a hora (created_at) da mensagem: a sala so mostra a pergunta simulada quando a hora
--   dela chega, como o chat (docs/30 D77);
-- - webinar_report e webinar_panel (os corpos inteiros da 202610300007, mesmas assinaturas): as perguntas contam so as
--   da turma (source = 'audience'); a simulada fica fora de todo numero (as perguntas por situacao, as mais votadas, os
--   alunos mais quentes e os pedidos da equipe). webinar_attendees (202610290001) nao muda: conta as perguntas pelo
--   user_id do aluno, e a simulada nao tem aluno. As listas que o app sempre le (QUESTION_COLUMNS, SCRIPT_ITEM_COLUMNS)
--   nao ganham coluna nova: o app de antes continua de pe com esta migracao, e o app novo le as colunas novas a parte;
-- - os checks novos das tabelas que ja existem entram `not valid` (secoes 3 e 4, sem ler as linhas) e sao validados na
--   secao 9. O unico `drop` e o `drop not null` de webinar_questions.user_id (afrouxa, nunca apaga dado). Tabela nova so
--   do service_role; nada de create policy, alter policy, delete nem truncate. Nove secoes, cada uma pelo MCP do Supabase
--   (execute_sql, uma por chamada, na ordem; as secoes 3, 4 e 9 comecando com `set lock_timeout = '5s';`), ou
--   apply_migration com o arquivo inteiro.
--
-- Verificacao manual depois de aplicar (uma linha so; docs/21 §9.14):
--   select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'webinar_personas')
--     + (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'webinar_chat_script_items' and column_name = 'persona_id')
--     + (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'webinar_questions'
--         and column_name in ('source', 'persona_id', 'persona_role', 'persona_avatar_path'))
--     + (select count(*) from pg_constraint where conname like 'webinar_questions_%_v8' and convalidated)
--     + (select count(*) from pg_proc where proname = 'webinar_persona_name_key')
--     + (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'webinar_questions'
--         and column_name = 'user_id' and is_nullable = 'YES') as total; -- 12
--   select public.webinar_persona_name_key('  Adriano   SOUZA '); -- adriano souza
--   select count(*) from public.webinar_report(gen_random_uuid()); -- 0
--   select count(*) from public.webinar_panel('all', now() - interval '30 days', now()); -- roda sem erro
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. webinar_persona_name_key: o nome comparavel de uma pessoa que comenta (o mesmo do app). MCP.
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.webinar_persona_name_key(p_name text)
returns text
language sql
immutable
security invoker
set search_path = pg_catalog, public
as $$
  select lower(btrim(regexp_replace(normalize(coalesce(p_name, ''), NFC), '\s+', ' ', 'g')))
$$;

comment on function public.webinar_persona_name_key(text) is
  'O nome comparavel de uma pessoa que comenta (docs/30 D75): NFC, espacos repetidos viram um, sem espacos nas pontas, sem caixa; o mesmo de persona-model.personaNameKey.';

revoke all on function public.webinar_persona_name_key(text) from public, anon, authenticated;
grant execute on function public.webinar_persona_name_key(text) to service_role;

/* ------------------------------------------------------------------------------------------------
 * 2. webinar_personas: as pessoas que comentam de um webinario. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_personas (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  name_key text generated always as (public.webinar_persona_name_key(name)) stored,
  role text not null default 'student' check (role in ('student', 'team')),
  avatar_path text check (avatar_path is null or avatar_path ~ '^webinars/personas/[a-f0-9]{24}[.]webp$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webinar_personas_name_key_v8 check (name_key <> '')
);

comment on table public.webinar_personas is 'As pessoas que comentam de um webinario (docs/30 D75): o editor e o console escolhem quem comenta nesta lista.';

create unique index if not exists webinar_personas_name_idx on public.webinar_personas (webinar_id, name_key);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_webinar_personas_updated_at' and tgrelid = 'public.webinar_personas'::regclass
  ) then
    create trigger set_webinar_personas_updated_at
      before update on public.webinar_personas
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.webinar_personas enable row level security;
revoke all on public.webinar_personas from anon, authenticated;
grant select, insert, update, delete on public.webinar_personas to service_role;

/* ------------------------------------------------------------------------------------------------
 * 3. webinar_chat_script_items.persona_id: o item ligado a uma pessoa da lista, sem ler as linhas. MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinar_chat_script_items add column if not exists persona_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webinar_chat_script_items_persona_v8') then
    alter table public.webinar_chat_script_items add constraint webinar_chat_script_items_persona_v8
      foreign key (persona_id) references public.webinar_personas(id) on delete set null not valid;
  end if;
end;
$$;

create index if not exists webinar_chat_script_items_persona_idx on public.webinar_chat_script_items (persona_id) where persona_id is not null;

comment on column public.webinar_chat_script_items.persona_id is
  'A pessoa que comenta (docs/30 D75); o item guarda a copia do nome, do papel e da foto dela. Nula sem pessoa (a pessoa saiu da lista).';

/* ------------------------------------------------------------------------------------------------
 * 4. webinar_questions: a pergunta simulada de uma pessoa da lista, sem ler as linhas. MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinar_questions add column if not exists source text not null default 'audience';
alter table public.webinar_questions add column if not exists persona_id uuid;
alter table public.webinar_questions add column if not exists persona_role text;
alter table public.webinar_questions add column if not exists persona_avatar_path text;
alter table public.webinar_questions alter column user_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webinar_questions_source_v8') then
    alter table public.webinar_questions add constraint webinar_questions_source_v8
      check (source in ('audience', 'scripted')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'webinar_questions_author_v8') then
    alter table public.webinar_questions add constraint webinar_questions_author_v8
      check ((source = 'audience') = (user_id is not null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'webinar_questions_persona_v8') then
    alter table public.webinar_questions add constraint webinar_questions_persona_v8
      check (
        (source = 'audience' and persona_id is null and persona_role is null and persona_avatar_path is null)
        or (source = 'scripted' and persona_role in ('student', 'team')
          and (persona_avatar_path is null or persona_avatar_path ~ '^webinars/personas/[a-f0-9]{24}[.]webp$'))
      ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'webinar_questions_persona_fk_v8') then
    alter table public.webinar_questions add constraint webinar_questions_persona_fk_v8
      foreign key (persona_id) references public.webinar_personas(id) on delete set null not valid;
  end if;
end;
$$;

create unique index if not exists webinar_questions_scripted_message_idx on public.webinar_questions (message_id) where source = 'scripted' and message_id is not null;
create index if not exists webinar_questions_persona_idx on public.webinar_questions (persona_id) where persona_id is not null;

comment on column public.webinar_questions.source is
  'audience: a pergunta de um aluno (conta nos numeros); scripted: a pergunta simulada de uma pessoa da lista, sem aluno, fora de todo numero (docs/30 D77).';
comment on column public.webinar_questions.persona_avatar_path is
  'A copia da foto da pessoa na pergunta simulada (o caminho no content-assets), como o nome em display_name. Nula no resto.';

/* ------------------------------------------------------------------------------------------------
 * 5. O preenchimento: as pessoas do roteiro e do "Enviar agora", uma vez, e os itens ligados a elas. MCP.
 * ---------------------------------------------------------------------------------------------- */

do $$
begin
  -- So a primeira vez (a lista vazia): rodar de novo nunca traz de volta uma pessoa que a equipe tirou da lista.
  if not exists (select 1 from public.webinar_personas) then
    -- O nome e o papel do mais recente; a foto, a mais recente que existe (uma linha mais nova sem foto nunca apaga a
    -- foto que o nome ja tinha: a copia da pessoa vai para todos os itens dela logo abaixo).
    with src as (
      select i.webinar_id,
        left(regexp_replace(btrim(i.persona_name), '\s+', ' ', 'g'), 60) as name,
        case when i.persona_role = 'team' then 'team' else 'student' end as role,
        i.persona_avatar_path as avatar_path,
        i.updated_at as at
      from public.webinar_chat_script_items i
      union all
      select m.webinar_id,
        left(regexp_replace(btrim(m.display_name), '\s+', ' ', 'g'), 60),
        case when m.role = 'team' then 'team' else 'student' end,
        m.persona_avatar_path,
        m.created_at
      from public.webinar_chat_messages m
      where m.source = 'scripted' and m.script_item_id is null
    ),
    photo as (
      select distinct on (src.webinar_id, public.webinar_persona_name_key(src.name))
        src.webinar_id, public.webinar_persona_name_key(src.name) as photo_key, src.avatar_path
      from src
      where src.avatar_path is not null
      order by src.webinar_id, public.webinar_persona_name_key(src.name), src.at desc
    )
    insert into public.webinar_personas (webinar_id, name, role, avatar_path, created_at)
    select distinct on (src.webinar_id, public.webinar_persona_name_key(src.name))
      src.webinar_id, src.name, src.role, photo.avatar_path, src.at
    from src
    left join photo on photo.webinar_id = src.webinar_id and photo.photo_key = public.webinar_persona_name_key(src.name)
    where public.webinar_persona_name_key(src.name) <> ''
    order by src.webinar_id, public.webinar_persona_name_key(src.name), src.at desc
    on conflict (webinar_id, name_key) do nothing;

    -- A pessoa e a fonte: o item ligado fica com a copia dela (o nome e o papel do mais recente, a foto mais recente).
    update public.webinar_chat_script_items i
    set persona_id = p.id, persona_name = p.name, persona_role = p.role, persona_avatar_path = p.avatar_path
    from public.webinar_personas p
    where i.persona_id is null
      and p.webinar_id = i.webinar_id
      and p.name_key = public.webinar_persona_name_key(i.persona_name);
  end if;
end;
$$;

/* ------------------------------------------------------------------------------------------------
 * 6. webinar_open_session (o corpo inteiro da 202611100002): o item Pergunta abre a pergunta simulada. MCP.
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

    -- v8: na Live gravada, o item Pergunta solto agora (a mensagem scripted de kind 'question') abre tambem a pergunta
    -- simulada da pessoa, ligada a mensagem, com o minuto e a hora dela (a sala so mostra quando a hora chega).
    insert into public.webinar_questions
      (session_id, user_id, display_name, anonymous, body, message_id, offset_ms, created_at,
       source, persona_id, persona_role, persona_avatar_path)
    select v_session.id, null, m.display_name, false, left(m.body, 500), m.id, m.offset_ms, m.created_at,
      'scripted', i.persona_id, case when m.role = 'team' then 'team' else 'student' end, m.persona_avatar_path
    from public.webinar_chat_messages m
    join public.webinar_chat_script_items i on i.id = m.script_item_id
    where m.session_id = v_session.id
      and v_session.kind <> 'live'
      and m.source = 'scripted'
      and m.kind = 'question'
      and m.deleted_at is null
      and not exists (select 1 from public.webinar_questions q where q.message_id = m.id)
    on conflict (message_id) where source = 'scripted' and message_id is not null do nothing;
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
  'Poe a sessao em live (started_at = hora marcada na gravada) e solta o roteiro pronto como mensagens scripted, uma vez, com a foto da pessoa; o item Pergunta abre a pergunta simulada; na live o roteiro entra pelo tick.';

/* ------------------------------------------------------------------------------------------------
 * 7. webinar_report (o corpo inteiro da 202610300007, mesma assinatura): as perguntas so da turma. MCP.
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
      and q.source = 'audience'
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
      and q.source = 'audience'
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
  -- `having`, nao `where`: um agregado sem grupo devolve uma linha (de zeros) mesmo com o filtro falso.
  select 'offer', 'seen', count(*)::bigint, count(distinct os.user_id)::bigint from offer_seen os
    having exists (select 1 from win) or exists (select 1 from clicks)
  union all
  select 'offer', 'clicks', count(*)::bigint, count(distinct c.user_id)::bigint from clicks c
    having exists (select 1 from win) or exists (select 1 from clicks)
  union all
  select 'offer', 'purchases', count(*) filter (where c.converted_sale_grant_id is not null)::bigint,
    count(distinct c.user_id) filter (where c.converted_sale_grant_id is not null)::bigint from clicks c
    having exists (select 1 from win) or exists (select 1 from clicks)
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
  -- Como na Oferta, `having`: sem resposta do Assistente, nenhuma linha `ai`.
  select 'ai', 'replies', count(*) filter (where am.deleted_at is null)::bigint, 0::bigint from ai_msgs am
    having exists (select 1 from ai_msgs)
  union all
  select 'ai', 'avg_seconds', coalesce(round(avg(extract(epoch from (ar.answered_at - ar.requested_at)))), 0)::bigint, count(*)::bigint
    from ai_reqs ar having exists (select 1 from ai_msgs)
  union all
  select 'ai', 'edited', count(*) filter (where am.edited_at is not null and am.deleted_at is null)::bigint, 0::bigint from ai_msgs am
    having exists (select 1 from ai_msgs)
  union all
  select 'ai', 'deleted', count(*) filter (where am.deleted_at is not null)::bigint, 0::bigint from ai_msgs am
    having exists (select 1 from ai_msgs)
  union all
  select 'ai', 'handoffs', count(*)::bigint, 0::bigint from handoffs h having exists (select 1 from handoffs)
  )
  -- Sessao que nao existe: nenhuma linha (os agregados sem grupo dariam uma linha de zeros).
  select r.metric, r.item, r.total, r.students from report r where exists (select 1 from s);
$$;
comment on function public.webinar_report(uuid) is
  'O relatorio de uma sessao (docs/30 §3.4 e §4.6): uma linha por metrica e item, so alunos, so chat audience/original; a Oferta (offer*: viram pelo congelado, compras sem reembolso), as Respostas do Assistente (ai) e o bloco Simulacao (sim_*) separados; as perguntas so da turma (a simulada fica fora).';

/* ------------------------------------------------------------------------------------------------
 * 8. webinar_panel (o corpo inteiro da 202610300007, mesma assinatura): as perguntas so da turma. MCP.
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
      and q.source = 'audience'
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
  'Os paineis Lives ao vivo e Lives gravadas (docs/30 §3.2, §3.3 e §4.6): numeros reais por sessao e os unicos do periodo, a Oferta (offer*: viram pelo congelado, compras e receita sem reembolso) e o bloco Simulacao (sim_*) separados; as perguntas so da turma (a simulada fica fora).';

/* ------------------------------------------------------------------------------------------------
 * 9. A conferencia das linhas que ja existem (os checks novos; de novo, nada muda). MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinar_chat_script_items validate constraint webinar_chat_script_items_persona_v8;
alter table public.webinar_questions validate constraint webinar_questions_source_v8;
alter table public.webinar_questions validate constraint webinar_questions_author_v8;
alter table public.webinar_questions validate constraint webinar_questions_persona_v8;
alter table public.webinar_questions validate constraint webinar_questions_persona_fk_v8;
