-- Webinarios v4e, "Comeca quando voce entra" (just-in-time; docs/30 §1.2, §1.6, §2.2, A14, D25 e §11, fase 4e). A
-- 202610290006 nao muda (nenhuma migracao da fase 4 foi aplicada ainda; docs/21 §9.10); este arquivo so acrescenta
-- (a 4d, Sala Live vertical, nao precisa de dado novo e nao tem migracao: a 202610290007 nao existe de proposito).
--
-- Regras:
-- - webinars.jit_settings (jsonb, zod no salvar e no ler): a Live gravada abre uma sessao "a cada 15 / 30 / 60 min"
--   dentro da janela de horas de Sao Paulo, so quando alguem chega (a turma e quem entrou na mesma janela, A14), a
--   espera, a entrada atrasada e a Simulacao que cada sessao copia ao nascer;
-- - webinar_sessions.jit marca a sessao nascida assim (sempre `simulated`, check webinar_sessions_jit_simulated_v4) e
--   o indice unico (webinar_id, scheduled_at) where jit garante uma sessao por horario, mesmo com dois alunos chegando
--   juntos (o app insere e, no 23505, le a que ja existe);
-- - webinar_chat_window (mesma assinatura, corpo completo da 202610290001) ganha os comentarios novos da turma do dia:
--   as linhas `audience` aprovadas das outras sessoes `jit` do mesmo webinario no mesmo dia de Sao Paulo, pelo offset em
--   que foram escritas (cada aluno tem a propria linha do tempo, docs/30 §1.6); fora das sessoes `jit` nada muda;
-- - nada de create policy, alter policy, drop, delete nem truncate. Quatro secoes, cada uma pelo MCP do Supabase
--   (execute_sql, uma por chamada, na ordem), ou apply_migration com o arquivo inteiro.
--
-- Verificacao manual depois de aplicar:
--   select column_name from information_schema.columns where table_name = 'webinars' and column_name = 'jit_settings'; -- 1 linha
--   select column_name from information_schema.columns where table_name = 'webinar_sessions' and column_name = 'jit'; -- 1 linha
--   select indexname from pg_indexes where schemaname = 'public' and indexname = 'webinar_sessions_jit_slot_idx'; -- 1 linha
--   select count(*) from public.webinar_chat_window(gen_random_uuid(), 0, 120000, null); -- 0
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. webinars.jit_settings: o "Comeca quando voce entra" da Live gravada. MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinars add column if not exists jit_settings jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webinars_jit_settings_v4') then
    alter table public.webinars add constraint webinars_jit_settings_v4
      check (jsonb_typeof(jit_settings) = 'object' and pg_column_size(jit_settings) <= 65536);
  end if;
end;
$$;

comment on column public.webinars.jit_settings is
  'Comeca quando voce entra ({enabled, everyMinutes, startHour, endHour, lateJoinMinutes, simulation}), zod no salvar e no ler (docs/30 §2.2).';

/* ------------------------------------------------------------------------------------------------
 * 2. webinar_sessions.jit: a sessao que nasceu quando alguem chegou, uma por horario. MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinar_sessions add column if not exists jit boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webinar_sessions_jit_simulated_v4') then
    alter table public.webinar_sessions add constraint webinar_sessions_jit_simulated_v4
      check (not jit or kind = 'simulated');
  end if;
end;
$$;

create unique index if not exists webinar_sessions_jit_slot_idx on public.webinar_sessions (webinar_id, scheduled_at) where jit;

comment on column public.webinar_sessions.jit is
  'Comeca quando voce entra (fase 4e): a sessao gravada que nasceu no horario em que o primeiro aluno chegou.';

/* ------------------------------------------------------------------------------------------------
 * 3. webinar_chat_window (o corpo completo da 202610290001, mesma assinatura, com a turma do dia nas sessoes jit). MCP.
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.webinar_chat_window(p_session_id uuid, p_from_ms integer, p_to_ms integer, p_user_id uuid default null)
returns table (
  id uuid,
  offset_ms integer,
  display_name text,
  role text,
  source text,
  body text,
  kind text,
  reply_to_id uuid,
  author_user_id uuid,
  approved boolean,
  master boolean,
  pinned_at timestamptz,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with s as (
    select s.id, s.webinar_id, s.source_session_id, coalesce(r.anchor_offset_ms, 0) as anchor_ms, s.jit, s.scheduled_at
    from public.webinar_sessions s
    left join public.webinar_recordings r on r.id = s.recording_id
    where s.id = p_session_id
  )
  -- As linhas da propria sessao (as aprovadas, e as do proprio aluno ainda na moderacao).
  select m.id, m.offset_ms, m.display_name, m.role, m.source, m.body, m.kind, m.reply_to_id, m.author_user_id,
    m.approved, m.master, m.pinned_at, m.created_at
  from public.webinar_chat_messages m
  join s on s.id = m.session_id
  where m.deleted_at is null
    and m.offset_ms between p_from_ms and p_to_ms
    and (m.approved or (p_user_id is not null and m.author_user_id = p_user_id))
  union all
  -- A linha mestre: a sessao de origem (a live real, deslocada pela ancora da gravacao) e as promovidas em outras
  -- sessoes do mesmo webinario (ja na posicao do video).
  select m.id,
    case when ms.kind = 'live' then m.offset_ms - s.anchor_ms else m.offset_ms end,
    m.display_name, m.role, m.source, m.body, m.kind, m.reply_to_id, m.author_user_id,
    m.approved, m.master, m.pinned_at, m.created_at
  from public.webinar_chat_messages m
  join public.webinar_sessions ms on ms.id = m.session_id
  cross join s
  where m.master
    and m.approved
    and m.deleted_at is null
    and m.session_id <> s.id
    and (m.session_id = s.source_session_id or m.webinar_id = s.webinar_id)
    and (case when ms.kind = 'live' then m.offset_ms - s.anchor_ms else m.offset_ms end) between p_from_ms and p_to_ms
  union all
  -- Comeca quando voce entra (fase 4e, docs/30 §1.6): os comentarios novos da turma do dia, isto e, das outras sessoes
  -- `jit` do mesmo webinario no mesmo dia de Sao Paulo, pelo segundo em que foram escritos. So os aprovados da turma
  -- (`audience`), nunca a linha mestre (ja acima) nem os pendentes da moderacao.
  select m.id, m.offset_ms, m.display_name, m.role, m.source, m.body, m.kind, m.reply_to_id, m.author_user_id,
    m.approved, m.master, m.pinned_at, m.created_at
  from public.webinar_chat_messages m
  join public.webinar_sessions js on js.id = m.session_id
  cross join s
  where s.jit
    and js.jit
    and js.webinar_id = s.webinar_id
    and js.id <> s.id
    and (js.scheduled_at at time zone 'America/Sao_Paulo')::date = (s.scheduled_at at time zone 'America/Sao_Paulo')::date
    and m.source = 'audience'
    and m.approved
    and not m.master
    and m.deleted_at is null
    and m.offset_ms between p_from_ms and p_to_ms
  order by 2, 13;
$$;
comment on function public.webinar_chat_window(uuid, integer, integer, uuid) is
  'A janela [from, to] em ms do chat de uma sessao: as linhas dela, a linha mestre repetida (docs/30 §6.6) e, na sessao jit, a turma do dia (§1.6).';

/* ------------------------------------------------------------------------------------------------
 * 4. Permissoes: webinar_chat_window so do service_role (de novo, idempotente). MCP.
 * ---------------------------------------------------------------------------------------------- */

revoke all on function public.webinar_chat_window(uuid, integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.webinar_chat_window(uuid, integer, integer, uuid) to service_role;
