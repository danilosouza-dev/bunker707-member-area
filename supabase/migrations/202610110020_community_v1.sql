-- Comunidade v1 (docs/17 §1.9 e §1.11; fase 1, frente D).
--
-- O que muda:
-- 1. lesson_comments ganha "resolvido" (resolved_at/resolved_by): o professor tira a pergunta da fila
--    sem responder. Nada e apagado; a area do aluno nao le estas colunas.
-- 2. community_quick_replies: respostas rapidas com {nome} e {aula} (so o admin le e escreve).
-- 3. Duas views internas (pergunta aberta e estado da denuncia) para que todas as contagens usem a
--    mesma definicao, e as RPCs de leitura do admin (fila, numeros do topo, comentarios, denuncias,
--    top alunos, aulas, filtros e contador do menu).
--
-- Definicoes (iguais em toda a Comunidade):
-- - Pergunta sem resposta = comentario raiz de aluno, visivel (approved), nao excluido, nao resolvido,
--   sem resposta visivel de professor/moderador.
-- - Denuncia aberta = comentario visivel com denuncia mais nova que a ultima acao de moderacao.
-- - Toda contagem ignora aula ou modulo excluido (status = 'deleted') e comentario com deleted_at.
-- - Filtro de produto: aulas dos modulos do produto e, para uma formacao, dos cursos incluidos nela
--   (content_page_settings.settings.parentFormationId).
--
-- Seguranca: tabelas e views sem acesso para anon/authenticated; RPCs security invoker, search_path
-- fixo e execucao so para service_role (o admin le pelo servidor, depois de checar o papel).

/* ------------------------------------------------------------------------------------------------
 * 1. Resolver pergunta
 * ---------------------------------------------------------------------------------------------- */

alter table public.lesson_comments
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references auth.users(id) on delete set null;

-- Fila "Precisam de resposta": mais antigas primeiro.
create index if not exists lesson_comments_queue_idx
  on public.lesson_comments (created_at)
  where parent_comment_id is null
    and deleted_at is null
    and author_role = 'student'
    and status = 'approved'
    and resolved_at is null;

-- "Ja tem resposta do professor?" por pergunta.
create index if not exists lesson_comments_staff_replies_idx
  on public.lesson_comments (parent_comment_id, created_at)
  where parent_comment_id is not null
    and deleted_at is null
    and author_role in ('producer', 'moderator');

-- Aba Comentarios filtrada por situacao.
create index if not exists lesson_comments_status_created_idx
  on public.lesson_comments (status, created_at desc)
  where deleted_at is null;

-- Perguntas ao Tutor IA por aula.
create index if not exists ai_conversations_lesson_idx
  on public.ai_conversations (lesson_id)
  where lesson_id is not null;

/* ------------------------------------------------------------------------------------------------
 * 2. Respostas rapidas
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.community_quick_replies (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 60),
  body text not null check (char_length(trim(body)) between 1 and 2000),
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists community_quick_replies_order_idx
  on public.community_quick_replies (sort_order, created_at);

alter table public.community_quick_replies enable row level security;
revoke all on public.community_quick_replies from anon, authenticated;

drop trigger if exists set_community_quick_replies_updated_at on public.community_quick_replies;
create trigger set_community_quick_replies_updated_at
  before update on public.community_quick_replies
  for each row execute function public.set_updated_at();

/* ------------------------------------------------------------------------------------------------
 * 3. Definicoes compartilhadas
 * ---------------------------------------------------------------------------------------------- */

-- Aulas visiveis no admin (aula e modulo nao excluidos), opcionalmente de um produto.
create or replace function public.community_lesson_scope(p_content_id text default null)
returns table (lesson_id text, module_id text, owner_id text)
language sql
stable
security invoker
set search_path = public
as $$
  select l.id, m.id, m.owner_id
  from public.lessons l
  join public.course_modules m on m.id = l.module_id
  where l.status is distinct from 'deleted'
    and m.status is distinct from 'deleted'
    and (
      p_content_id is null
      or m.owner_id = p_content_id
      or exists (
        select 1
        from public.content_page_settings s
        where s.content_id = m.owner_id
          and s.settings ->> 'parentFormationId' = p_content_id
      )
    );
$$;

-- Perguntas sem resposta (definicao unica da fila, do numero do topo e do contador do menu).
create or replace view public.community_open_questions
with (security_invoker = true) as
select c.id, c.content_id, c.lesson_id, c.created_at
from public.lesson_comments c
where c.parent_comment_id is null
  and c.deleted_at is null
  and c.author_role = 'student'
  and c.status = 'approved'
  and c.resolved_at is null
  and not exists (
    select 1
    from public.lesson_comments r
    where r.parent_comment_id = c.id
      and r.deleted_at is null
      and r.status = 'approved'
      and r.author_role in ('producer', 'moderator')
  );

-- Estado da denuncia por comentario denunciado.
create or replace view public.community_report_state
with (security_invoker = true) as
select
  c.id as comment_id,
  c.lesson_id,
  c.status,
  count(rep.id) as report_count,
  max(rep.created_at) as last_reported_at,
  last_action.last_action_at,
  (c.status = 'approved' and max(rep.created_at) > coalesce(last_action.last_action_at, '-infinity'::timestamptz)) as is_open
from public.lesson_comments c
join public.lesson_comment_reports rep on rep.comment_id = c.id
left join lateral (
  select max(a.created_at) as last_action_at
  from public.lesson_comment_moderation_actions a
  where a.comment_id = c.id
) last_action on true
where c.deleted_at is null
group by c.id, c.lesson_id, c.status, last_action.last_action_at;

revoke all on public.community_open_questions from anon, authenticated;
revoke all on public.community_report_state from anon, authenticated;
grant select on public.community_open_questions to service_role;
grant select on public.community_report_state to service_role;

/* ------------------------------------------------------------------------------------------------
 * 4. RPCs de leitura do admin
 * ---------------------------------------------------------------------------------------------- */

-- Fila "Precisam de resposta": ids da pagina + total, mais antigas primeiro.
create or replace function public.community_unanswered(
  p_content_id text default null,
  p_lesson_id text default null,
  p_since timestamptz default null,
  p_offset integer default 0,
  p_limit integer default 20
)
returns table (comment_id uuid, total_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select q.id, count(*) over ()
  from public.community_open_questions q
  join public.community_lesson_scope(p_content_id) scope on scope.lesson_id = q.lesson_id
  where (p_lesson_id is null or q.lesson_id = p_lesson_id)
    and (p_since is null or q.created_at >= p_since)
  order by q.created_at asc, q.id asc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

-- Numeros do topo. "Sem resposta" e "Denuncias" contam tudo o que esta aberto (fila de trabalho);
-- tempo de resposta e comentarios usam a janela fixa (padrao 28 dias).
create or replace function public.community_stats(
  p_content_id text default null,
  p_window_days integer default 28
)
returns table (
  unanswered bigint,
  oldest_unanswered_at timestamptz,
  median_response_hours double precision,
  p90_response_hours double precision,
  comments_in_window bigint,
  open_reports bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with scope as (
    select s.lesson_id from public.community_lesson_scope(p_content_id) s
  ),
  window_start as (
    select now() - make_interval(days => least(greatest(coalesce(p_window_days, 28), 1), 365)) as since
  ),
  open_questions as (
    select q.created_at
    from public.community_open_questions q
    join scope on scope.lesson_id = q.lesson_id
  ),
  first_replies as (
    select (extract(epoch from (min(r.created_at) - c.created_at)) / 3600.0)::double precision as hours
    from public.lesson_comments c
    join scope on scope.lesson_id = c.lesson_id
    join public.lesson_comments r
      on r.parent_comment_id = c.id
     and r.deleted_at is null
     and r.author_role in ('producer', 'moderator')
    cross join window_start w
    where c.parent_comment_id is null
      and c.deleted_at is null
      and c.author_role = 'student'
      and c.created_at >= w.since
    group by c.id, c.created_at
  ),
  window_comments as (
    select count(*) as total
    from public.lesson_comments c
    join scope on scope.lesson_id = c.lesson_id
    cross join window_start w
    where c.deleted_at is null
      and c.author_role = 'student'
      and c.status <> 'spam'
      and c.created_at >= w.since
  ),
  reports as (
    select count(*) as total
    from public.community_report_state rs
    join scope on scope.lesson_id = rs.lesson_id
    where rs.is_open
  )
  select
    (select count(*) from open_questions),
    (select min(created_at) from open_questions),
    (select percentile_cont(0.5) within group (order by greatest(fr.hours, 0)) from first_replies fr),
    (select percentile_cont(0.9) within group (order by greatest(fr.hours, 0)) from first_replies fr),
    (select total from window_comments),
    (select total from reports);
$$;

-- Aba Comentarios: ids da pagina, "respondido" (so raiz) e total; mais novos primeiro.
create or replace function public.community_comment_list(
  p_content_id text default null,
  p_lesson_id text default null,
  p_since timestamptz default null,
  p_status text default null,
  p_answered boolean default null,
  p_search text default null,
  p_offset integer default 0,
  p_limit integer default 20
)
returns table (comment_id uuid, answered boolean, total_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with pattern as (
    select case
      when nullif(trim(coalesce(p_search, '')), '') is null then null
      else '%' || replace(replace(replace(trim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    end as value
  ),
  base as (
    select
      c.id,
      c.created_at,
      c.parent_comment_id,
      (
        c.parent_comment_id is null
        and exists (
          select 1
          from public.lesson_comments r
          where r.parent_comment_id = c.id
            and r.deleted_at is null
            and r.status = 'approved'
            and r.author_role in ('producer', 'moderator')
        )
      ) as answered
    from public.lesson_comments c
    join public.community_lesson_scope(p_content_id) scope on scope.lesson_id = c.lesson_id
    cross join pattern
    where c.deleted_at is null
      and (p_lesson_id is null or c.lesson_id = p_lesson_id)
      and (p_since is null or c.created_at >= p_since)
      and (p_status is null or c.status = p_status)
      and (
        pattern.value is null
        or c.body ilike pattern.value escape '\'
        or c.author_name ilike pattern.value escape '\'
      )
  )
  select b.id, b.answered, count(*) over ()
  from base b
  where p_answered is null or (b.parent_comment_id is null and b.answered = p_answered)
  order by b.created_at desc, b.id desc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

-- Aba Denuncias: abertas primeiro, depois as mais recentes.
create or replace function public.community_reported_comments(
  p_content_id text default null,
  p_lesson_id text default null,
  p_since timestamptz default null,
  p_offset integer default 0,
  p_limit integer default 20
)
returns table (
  comment_id uuid,
  report_count bigint,
  last_reported_at timestamptz,
  is_open boolean,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select rs.comment_id, rs.report_count, rs.last_reported_at, rs.is_open, count(*) over ()
  from public.community_report_state rs
  join public.community_lesson_scope(p_content_id) scope on scope.lesson_id = rs.lesson_id
  where (p_lesson_id is null or rs.lesson_id = p_lesson_id)
    and (p_since is null or rs.last_reported_at >= p_since)
  order by rs.is_open desc, rs.last_reported_at desc, rs.comment_id
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

-- Top alunos: comentarios aprovados + respostas a colegas + reacoes recebidas (sem a equipe).
create or replace function public.community_top_commenters(
  p_since timestamptz default null,
  p_content_id text default null,
  p_limit integer default 20
)
returns table (
  author_id uuid,
  author_name text,
  author_avatar_url text,
  comments bigint,
  replies_to_peers bigint,
  reactions_received bigint,
  score bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with scope as (
    select s.lesson_id from public.community_lesson_scope(p_content_id) s
  ),
  authored as (
    select c.id, c.author_id, c.parent_comment_id, c.created_at, c.status
    from public.lesson_comments c
    join scope on scope.lesson_id = c.lesson_id
    where c.deleted_at is null
      and c.author_id is not null
      and c.author_role = 'student'
      and not exists (select 1 from public.admin_roles ar where ar.user_id = c.author_id)
  ),
  comment_counts as (
    select
      a.author_id,
      count(*) as comments,
      count(*) filter (
        where a.parent_comment_id is not null
          and exists (
            select 1
            from public.lesson_comments parent
            where parent.id = a.parent_comment_id
              and parent.author_role = 'student'
              and parent.author_id is distinct from a.author_id
          )
      ) as replies_to_peers
    from authored a
    where a.status = 'approved'
      and (p_since is null or a.created_at >= p_since)
    group by a.author_id
  ),
  reaction_counts as (
    select a.author_id, count(*) as reactions
    from public.lesson_comment_reactions r
    join authored a on a.id = r.comment_id
    where r.user_id <> a.author_id
      and (p_since is null or r.created_at >= p_since)
    group by a.author_id
  ),
  scored as (
    select
      coalesce(cc.author_id, rc.author_id) as author_id,
      coalesce(cc.comments, 0) as comments,
      coalesce(cc.replies_to_peers, 0) as replies_to_peers,
      coalesce(rc.reactions, 0) as reactions_received
    from comment_counts cc
    full join reaction_counts rc on rc.author_id = cc.author_id
  ),
  latest as (
    select distinct on (c.author_id) c.author_id, c.author_name, c.author_avatar_url
    from public.lesson_comments c
    where c.author_id in (select scored.author_id from scored)
    order by c.author_id, c.created_at desc
  )
  select
    s.author_id,
    coalesce(nullif(trim(p.full_name), ''), latest.author_name, 'Aluno') as author_name,
    coalesce(p.avatar_url, latest.author_avatar_url) as author_avatar_url,
    s.comments,
    s.replies_to_peers,
    s.reactions_received,
    s.comments + s.replies_to_peers + s.reactions_received as score
  from scored s
  left join public.profiles p on p.id = s.author_id
  left join latest on latest.author_id = s.author_id
  where s.comments + s.replies_to_peers + s.reactions_received > 0
  order by score desc, s.comments desc, author_name asc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

-- Aba Aulas: duvidas (comentarios, sem resposta, perguntas ao Tutor no periodo) e avaliacao
-- (Nao gostei / Gostei / Amei desde sempre, uma por aluno e aula, sem a equipe).
-- p_sort: 'doubts' (padrao, mais duvidas), 'worst' (piores avaliacoes), 'best' (melhores).
-- Nas ordens por avaliacao, aulas com 20 respostas ou mais vem antes (regra de acao de docs/17 §1.11).
create or replace function public.community_lesson_rows(
  p_since timestamptz default null,
  p_content_id text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_sort text default 'doubts'
)
returns table (
  lesson_id text,
  comments bigint,
  unanswered bigint,
  tutor_questions bigint,
  not_for_me bigint,
  liked bigint,
  loved bigint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with scope as (
    select s.lesson_id from public.community_lesson_scope(p_content_id) s
  ),
  comment_stats as (
    select c.lesson_id, count(*) as comments
    from public.lesson_comments c
    join scope on scope.lesson_id = c.lesson_id
    where c.deleted_at is null
      and c.author_role = 'student'
      and c.status <> 'spam'
      and (p_since is null or c.created_at >= p_since)
    group by c.lesson_id
  ),
  open_stats as (
    select q.lesson_id, count(*) as unanswered
    from public.community_open_questions q
    join scope on scope.lesson_id = q.lesson_id
    group by q.lesson_id
  ),
  tutor_stats as (
    select conv.lesson_id, count(*) as tutor_questions
    from public.ai_messages msg
    join public.ai_conversations conv on conv.id = msg.conversation_id
    join scope on scope.lesson_id = conv.lesson_id
    where msg.role = 'user'
      and (p_since is null or msg.created_at >= p_since)
      and not exists (select 1 from public.admin_roles ar where ar.user_id = msg.user_id)
    group by conv.lesson_id
  ),
  raw_ratings as (
    select distinct on (lp.user_id, reaction.key)
      reaction.key as lesson_id,
      reaction.value
    from public.lesson_progress lp
    cross join lateral jsonb_each_text(
      case when jsonb_typeof(lp.lesson_reactions) = 'object' then lp.lesson_reactions else '{}'::jsonb end
    ) reaction
    where reaction.value in ('not-for-me', 'liked', 'loved')
      and not exists (select 1 from public.admin_roles ar where ar.user_id::text = lp.user_id)
    order by lp.user_id, reaction.key, lp.updated_at desc
  ),
  rating_stats as (
    select
      rr.lesson_id,
      count(*) filter (where rr.value = 'not-for-me') as not_for_me,
      count(*) filter (where rr.value = 'liked') as liked,
      count(*) filter (where rr.value = 'loved') as loved
    from raw_ratings rr
    join scope on scope.lesson_id = rr.lesson_id
    group by rr.lesson_id
  ),
  combined as (
    select
      scope.lesson_id,
      coalesce(cs.comments, 0) as comments,
      coalesce(os.unanswered, 0) as unanswered,
      coalesce(ts.tutor_questions, 0) as tutor_questions,
      coalesce(rs.not_for_me, 0) as not_for_me,
      coalesce(rs.liked, 0) as liked,
      coalesce(rs.loved, 0) as loved
    from scope
    left join comment_stats cs on cs.lesson_id = scope.lesson_id
    left join open_stats os on os.lesson_id = scope.lesson_id
    left join tutor_stats ts on ts.lesson_id = scope.lesson_id
    left join rating_stats rs on rs.lesson_id = scope.lesson_id
  ),
  ranked as (
    select
      combined.*,
      combined.not_for_me + combined.liked + combined.loved as ratings_total,
      case
        when combined.not_for_me + combined.liked + combined.loved > 0
          then (combined.loved - combined.not_for_me)::double precision
            / (combined.not_for_me + combined.liked + combined.loved)
      end as balance
    from combined
    where combined.comments + combined.unanswered + combined.tutor_questions
      + combined.not_for_me + combined.liked + combined.loved > 0
  )
  select
    r.lesson_id,
    r.comments,
    r.unanswered,
    r.tutor_questions,
    r.not_for_me,
    r.liked,
    r.loved,
    count(*) over ()
  from ranked r
  where coalesce(p_sort, 'doubts') not in ('worst', 'best') or r.ratings_total > 0
  order by
    case when p_sort in ('worst', 'best') then r.ratings_total >= 20 end desc nulls last,
    case when p_sort = 'worst' then r.balance end asc nulls last,
    case when p_sort = 'best' then r.balance end desc nulls last,
    case when p_sort in ('worst', 'best') then r.ratings_total end desc nulls last,
    r.comments + r.tutor_questions + r.unanswered desc,
    r.lesson_id asc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- Opcoes dos filtros Produto e Aula: so aulas com comentarios, com o produto dono e a formacao.
create or replace function public.community_filter_options()
returns table (
  lesson_id text,
  lesson_title text,
  product_id text,
  product_title text,
  formation_id text,
  formation_title text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    l.id,
    l.title,
    m.owner_id,
    product.title,
    nullif(settings.settings ->> 'parentFormationId', ''),
    formation.title
  from public.lessons l
  join public.course_modules m on m.id = l.module_id
  left join public.content_items product on product.id = m.owner_id
  left join public.content_page_settings settings on settings.content_id = m.owner_id
  left join public.content_items formation on formation.id = settings.settings ->> 'parentFormationId'
  where l.status is distinct from 'deleted'
    and m.status is distinct from 'deleted'
    and m.owner_id is not null
    and exists (
      select 1
      from public.lesson_comments c
      where c.lesson_id = l.id
        and c.deleted_at is null
    )
  order by product.title nulls last, l.title;
$$;

-- Contador do menu e alerta de Hoje: perguntas sem resposta ha mais de p_hours.
create or replace function public.community_overdue_count(p_hours integer default 24)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)
  from public.community_open_questions q
  join public.community_lesson_scope(null) scope on scope.lesson_id = q.lesson_id
  where q.created_at < now() - make_interval(hours => greatest(coalesce(p_hours, 24), 1));
$$;

revoke all on function public.community_lesson_scope(text) from public, anon, authenticated;
revoke all on function public.community_unanswered(text, text, timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.community_stats(text, integer) from public, anon, authenticated;
revoke all on function public.community_comment_list(text, text, timestamptz, text, boolean, text, integer, integer) from public, anon, authenticated;
revoke all on function public.community_reported_comments(text, text, timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.community_top_commenters(timestamptz, text, integer) from public, anon, authenticated;
revoke all on function public.community_lesson_rows(timestamptz, text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.community_filter_options() from public, anon, authenticated;
revoke all on function public.community_overdue_count(integer) from public, anon, authenticated;

grant execute on function public.community_lesson_scope(text) to service_role;
grant execute on function public.community_unanswered(text, text, timestamptz, integer, integer) to service_role;
grant execute on function public.community_stats(text, integer) to service_role;
grant execute on function public.community_comment_list(text, text, timestamptz, text, boolean, text, integer, integer) to service_role;
grant execute on function public.community_reported_comments(text, text, timestamptz, integer, integer) to service_role;
grant execute on function public.community_top_commenters(timestamptz, text, integer) to service_role;
grant execute on function public.community_lesson_rows(timestamptz, text, integer, integer, text) to service_role;
grant execute on function public.community_filter_options() to service_role;
grant execute on function public.community_overdue_count(integer) to service_role;
