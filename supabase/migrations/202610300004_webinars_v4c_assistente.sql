-- Webinarios v4c, o Assistente de IA no chat, os atendentes humanos com distribuicao e o modo hibrido (docs/30 §1.6,
-- §2.4, §3.4, §6.6, D24 e §11, fase 4c). A 202610300003 nao muda (nenhuma migracao da fase 4 foi
-- aplicada ainda; docs/21 §9.10); este arquivo so acrescenta.
--
-- Regras:
-- - webinars.assistant_settings (jsonb, zod no salvar e no ler: o Assistente ligado no webinario e o "Responder tudo"
--   padrao das sessoes) e webinar_sessions.assistant_reply_all (o "Responder tudo" da sessao, ligado pelo console);
-- - webinar_assistant_knowledge: as perguntas e respostas cadastradas no webinario (o contexto do Assistente junto das
--   cues da transcricao em volta do offset, docs/30 §6.6);
-- - webinar_attendants: quem da equipe esta atendendo na sessao (online / ausente, a ultima batida), base da
--   distribuicao das perguntas novas entre os atendentes;
-- - webinar_questions ganha assigned_to / assigned_at (o atendente que assumiu: o Assistente cala nessa pergunta),
--   answer_source ('team' / 'ai') e handoff_requested_at ("Falar com a equipe"); webinar_chat_messages ganha os
--   mesmos assigned_to / assigned_at / handoff_requested_at (perguntas e "@assistente" no chat) e edited_at /
--   edited_by (a equipe corrigiu a resposta do Assistente);
-- - webinar_ai_requests: um pedido ao Assistente por mensagem ou pergunta (unico: nunca responde duas vezes), com a
--   situacao, o motivo de nao responder, a resposta gravada, a hora do pedido e da resposta (o tempo medio do
--   relatorio) e o provedor; sem texto (so ids e codigos, docs/05); base do limite por aluno e por minuto;
-- - webinar_report ganha o bloco "Respostas do Assistente" (ai / replies, avg_seconds, edited, deleted, handoffs),
--   mesma assinatura, corpo completo (o da 202610300003 mais estas linhas); fora da Simulacao e das mensagens de
--   aluno e equipe (D24, M6);
-- - tabelas novas so do service_role; nada de create policy, alter policy, drop, delete nem truncate. Sete secoes,
--   cada uma pelo MCP do Supabase (execute_sql, uma por chamada, na ordem), ou apply_migration com o arquivo inteiro.
--
-- Verificacao manual depois de aplicar:
--   select column_name from information_schema.columns where table_name = 'webinars' and column_name = 'assistant_settings'; -- 1 linha
--   select column_name from information_schema.columns where table_name = 'webinar_sessions' and column_name = 'assistant_reply_all'; -- 1 linha
--   select table_name from information_schema.tables where table_schema = 'public'
--     and table_name in ('webinar_assistant_knowledge', 'webinar_attendants', 'webinar_ai_requests') order by 1; -- 3 linhas
--   select column_name from information_schema.columns where table_name = 'webinar_questions'
--     and column_name in ('assigned_to', 'assigned_at', 'answer_source', 'handoff_requested_at'); -- 4 linhas
--   select column_name from information_schema.columns where table_name = 'webinar_chat_messages'
--     and column_name in ('assigned_to', 'assigned_at', 'handoff_requested_at', 'edited_at', 'edited_by'); -- 5 linhas
--   select count(*) from public.webinar_report(gen_random_uuid()); -- 0
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. webinars.assistant_settings e webinar_sessions.assistant_reply_all ("Responder tudo"). MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinars add column if not exists assistant_settings jsonb not null default '{}'::jsonb;
alter table public.webinar_sessions add column if not exists assistant_reply_all boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webinars_assistant_settings_v4') then
    alter table public.webinars add constraint webinars_assistant_settings_v4
      check (jsonb_typeof(assistant_settings) = 'object' and pg_column_size(assistant_settings) <= 4096);
  end if;
end;
$$;

comment on column public.webinars.assistant_settings is
  'O Assistente de IA do webinario ({enabled, replyAllDefault}), zod no salvar e no ler (docs/30 §6.6, D24).';
comment on column public.webinar_sessions.assistant_reply_all is
  '"Responder tudo" ligado no console: o Assistente responde as perguntas da turma sem ser chamado (nunca as assumidas).';

/* ------------------------------------------------------------------------------------------------
 * 2. webinar_assistant_knowledge: as perguntas e respostas cadastradas no webinario. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_assistant_knowledge (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  question text not null check (char_length(question) between 2 and 300),
  answer text not null check (char_length(answer) between 1 and 2000),
  position integer not null default 0 check (position between 0 and 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.webinar_assistant_knowledge is 'O que o Assistente sabe do webinario e do produto alem da transcricao (docs/30 §6.6).';

create index if not exists webinar_assistant_knowledge_webinar_idx on public.webinar_assistant_knowledge (webinar_id, position);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_webinar_assistant_knowledge_updated_at' and tgrelid = 'public.webinar_assistant_knowledge'::regclass
  ) then
    create trigger set_webinar_assistant_knowledge_updated_at
      before update on public.webinar_assistant_knowledge
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.webinar_assistant_knowledge enable row level security;
revoke all on public.webinar_assistant_knowledge from anon, authenticated;
grant select, insert, update, delete on public.webinar_assistant_knowledge to service_role;

/* ------------------------------------------------------------------------------------------------
 * 3. webinar_attendants: quem da equipe esta atendendo na sessao. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_attendants (
  session_id uuid not null references public.webinar_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'online' check (status in ('online', 'away')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

comment on table public.webinar_attendants is 'Os atendentes da sessao (docs/30 §2.4, Atendimento): a distribuicao das perguntas novas le os online.';

alter table public.webinar_attendants enable row level security;
revoke all on public.webinar_attendants from anon, authenticated;
grant select, insert, update, delete on public.webinar_attendants to service_role;

/* ------------------------------------------------------------------------------------------------
 * 4. webinar_questions e webinar_chat_messages: quem assumiu, de quem e a resposta, "Falar com a equipe". MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinar_questions add column if not exists assigned_to uuid references auth.users(id) on delete set null;
alter table public.webinar_questions add column if not exists assigned_at timestamptz;
alter table public.webinar_questions add column if not exists answer_source text;
alter table public.webinar_questions add column if not exists handoff_requested_at timestamptz;

alter table public.webinar_chat_messages add column if not exists assigned_to uuid references auth.users(id) on delete set null;
alter table public.webinar_chat_messages add column if not exists assigned_at timestamptz;
alter table public.webinar_chat_messages add column if not exists handoff_requested_at timestamptz;
alter table public.webinar_chat_messages add column if not exists edited_at timestamptz;
alter table public.webinar_chat_messages add column if not exists edited_by uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webinar_questions_answer_source_v4') then
    alter table public.webinar_questions add constraint webinar_questions_answer_source_v4
      check (answer_source is null or answer_source in ('team', 'ai'));
  end if;
end;
$$;

create index if not exists webinar_questions_queue_idx on public.webinar_questions (session_id, assigned_to)
  where status = 'open' and deleted_at is null;
create index if not exists webinar_chat_messages_questions_idx on public.webinar_chat_messages (session_id, created_at)
  where kind = 'question' and deleted_at is null;

/* ------------------------------------------------------------------------------------------------
 * 5. webinar_ai_requests: um pedido ao Assistente por mensagem ou pergunta, sem texto. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_ai_requests (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  session_id uuid not null references public.webinar_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  target_kind text not null check (target_kind in ('chat', 'question')),
  target_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'answered', 'skipped', 'failed')),
  skip_reason text check (skip_reason is null or skip_reason in ('disabled', 'not_called', 'claimed', 'handoff', 'rate_limited', 'unconfigured', 'timeout', 'empty')),
  reply_message_id uuid references public.webinar_chat_messages(id) on delete set null,
  requested_at timestamptz not null default now(),
  answered_at timestamptz,
  provider text check (provider is null or char_length(provider) <= 40),
  model text check (model is null or char_length(model) <= 120),
  error_code text check (error_code is null or char_length(error_code) <= 80),
  created_at timestamptz not null default now()
);

comment on table public.webinar_ai_requests is 'Os pedidos ao Assistente (D24): um por mensagem ou pergunta, a situacao, o tempo de resposta; so ids e codigos.';

create unique index if not exists webinar_ai_requests_target_idx on public.webinar_ai_requests (target_kind, target_id);
create index if not exists webinar_ai_requests_user_idx on public.webinar_ai_requests (user_id, requested_at desc);
create index if not exists webinar_ai_requests_session_idx on public.webinar_ai_requests (session_id, requested_at desc);

alter table public.webinar_ai_requests enable row level security;
revoke all on public.webinar_ai_requests from anon, authenticated;
grant select, insert, update, delete on public.webinar_ai_requests to service_role;

/* ------------------------------------------------------------------------------------------------
 * 6. webinar_report (o corpo completo da 202610300003, mesma assinatura, com as Respostas do Assistente). MCP.
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
    select distinct w.offer_id, ps.user_id, public.webinar_offer_variant(ps.user_id, w.offer_id) as label
    from win w
    cross join s
    join public.webinar_presence_samples ps on ps.session_id = s.id and ps.bucket between w.b0 and w.b1
    where not exists (select 1 from staff where staff.user_id = ps.user_id)
  ),
  clicks as (
    select c.offer_id, c.user_id, c.variant_label as label, c.converted_sale_grant_id
    from public.webinar_offer_clicks c, s
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
    select q.id from public.webinar_questions q, s where q.session_id = s.id and q.handoff_requested_at is not null
    union all
    select m.id from public.webinar_chat_messages m, s where m.session_id = s.id and m.handoff_requested_at is not null
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
  'O relatorio de uma sessao (docs/30 §3.4 e §4.6): uma linha por metrica e item, so alunos, so chat audience/original; a Oferta (offer*), as Respostas do Assistente (ai) e o bloco Simulacao (sim_*) separados.';

/* ------------------------------------------------------------------------------------------------
 * 7. Permissoes: webinar_report so do service_role (o create or replace mantem; aqui de novo, idempotente). MCP.
 * ---------------------------------------------------------------------------------------------- */

revoke all on function public.webinar_report(uuid) from public, anon, authenticated;
grant execute on function public.webinar_report(uuid) to service_role;
