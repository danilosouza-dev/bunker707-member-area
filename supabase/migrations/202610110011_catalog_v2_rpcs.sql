-- Produtos v2, fase 1: leituras agregadas e reordenacao atomica (docs/17 §2.3, "Metricas sempre de
-- RPCs SQL, nunca agregadas em JavaScript"). Todas security invoker, chamadas so pelo servidor com a
-- chave de servico (src/server/catalog/**); nenhum papel do navegador executa.

-- Lista de Produtos (/admin/produtos): uma pagina ja filtrada, com contagens so das linhas da pagina.
-- Universo: produtos vendaveis e itens antigos sem escopo; cursos incluidos em formacao aparecem dentro
-- da formacao, nunca soltos; "Aula" e os buckets de demonstracao nao sao produtos.
-- Aulas = nao excluidas, em modulos nao excluidos do produto (Formacao soma os cursos incluidos).
-- Publicadas = o que o aluno ve (aula e modulo publicados). Acessos = entitlements ativos agora.
create or replace function public.admin_product_list(
  p_kinds text[] default null,
  p_status text default null,
  p_search text default null,
  p_offset integer default 0,
  p_limit integer default 25
)
returns table (
  id text,
  title text,
  kind text,
  publication_status text,
  access_model text,
  listing text,
  purchase_url text,
  image text,
  accent text,
  updated_at timestamptz,
  lessons_total integer,
  lessons_published integer,
  students_with_access integer,
  total_count integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select
      c.id,
      c.title,
      c.kind,
      c.publication_status,
      c.access_model,
      c.listing,
      c.purchase_url,
      c.image,
      c.updated_at,
      count(*) over () as total_count
    from public.content_items c
    where c.commerce_scope is distinct from 'included_content'
      and c.kind <> 'Aula'
      and c.bucket not in ('continue_watching', 'recent_lessons')
      and (p_kinds is null or cardinality(p_kinds) = 0 or c.kind = any (p_kinds))
      and (p_status is null or c.publication_status = p_status)
      and (
        nullif(btrim(coalesce(p_search, '')), '') is null
        or c.title ilike '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
      )
    order by c.updated_at desc, c.id
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
  ),
  owners as (
    select f.id as product_id, f.id as owner_id
    from filtered f
    union all
    select f.id as product_id, s.content_id as owner_id
    from filtered f
    join public.content_page_settings s on s.settings->>'parentFormationId' = f.id
    join public.content_items ic on ic.id = s.content_id and ic.commerce_scope = 'included_content'
    where f.kind = 'Formacao'
  ),
  lesson_counts as (
    select
      o.product_id,
      count(l.id) as lessons_total,
      count(l.id) filter (where l.status = 'published' and m.status = 'published') as lessons_published
    from owners o
    join public.course_modules m on m.owner_id = o.owner_id and m.status <> 'deleted'
    join public.lessons l on l.module_id = m.id and l.status <> 'deleted'
    group by o.product_id
  ),
  access_counts as (
    select e.target_id as product_id, count(distinct e.user_id) as students_with_access
    from public.entitlements e
    where e.target_id in (select f.id from filtered f)
      and e.status = 'active'
      and e.starts_at <= now()
      and (e.ends_at is null or e.ends_at > now())
    group by e.target_id
  )
  select
    f.id,
    f.title,
    f.kind,
    f.publication_status,
    f.access_model,
    f.listing,
    f.purchase_url,
    f.image,
    s.settings->>'accent' as accent,
    f.updated_at,
    coalesce(lc.lessons_total, 0)::integer as lessons_total,
    coalesce(lc.lessons_published, 0)::integer as lessons_published,
    coalesce(ac.students_with_access, 0)::integer as students_with_access,
    f.total_count::integer as total_count
  from filtered f
  left join public.content_page_settings s on s.content_id = f.id
  left join lesson_counts lc on lc.product_id = f.id
  left join access_counts ac on ac.product_id = f.id
  order by f.updated_at desc, f.id;
$$;

-- Reordenar a aba Conteudo de uma vez (arrastar, Alt+setas, "Mover para"). p_modules =
-- [{ "id": "<modulo>", "lessonIds": ["<aula>", ...] }, ...] com a ordem completa dos modulos nao
-- excluidos do produto e de todas as aulas nao excluidas deles. Conjunto diferente do banco (outra aba
-- mexeu antes) = 'stale_structure', que a Server Action traduz para 409. So grava o que mudou, para nao
-- invalidar o updated_at de aulas que ficaram no mesmo lugar.
create or replace function public.admin_reorder_product_content(p_content_id text, p_modules jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_lesson_ids text[];
  current_module_ids text[];
  wanted_lesson_ids text[];
  wanted_module_ids text[];
begin
  if jsonb_typeof(p_modules) is distinct from 'array' then
    raise exception 'stale_structure';
  end if;

  -- Serializa reordenacoes concorrentes do mesmo produto.
  perform 1
  from public.course_modules
  where owner_id = p_content_id and status <> 'deleted'
  order by id
  for update;

  select coalesce(array_agg(id order by id), '{}')
  into current_module_ids
  from public.course_modules
  where owner_id = p_content_id and status <> 'deleted';

  select coalesce(array_agg(l.id order by l.id), '{}')
  into current_lesson_ids
  from public.lessons l
  join public.course_modules m on m.id = l.module_id
  where m.owner_id = p_content_id and m.status <> 'deleted' and l.status <> 'deleted';

  select coalesce(array_agg(entry->>'id' order by entry->>'id'), '{}')
  into wanted_module_ids
  from jsonb_array_elements(p_modules) as entry;

  select coalesce(array_agg(lesson_id order by lesson_id), '{}')
  into wanted_lesson_ids
  from jsonb_array_elements(p_modules) as entry,
    jsonb_array_elements_text(coalesce(entry->'lessonIds', '[]'::jsonb)) as lesson_id;

  if wanted_module_ids is distinct from current_module_ids
    or wanted_lesson_ids is distinct from current_lesson_ids then
    raise exception 'stale_structure';
  end if;

  with wanted as (
    select entry->>'id' as module_id, (position - 1)::integer as sort_order
    from jsonb_array_elements(p_modules) with ordinality as module_entry(entry, position)
  )
  update public.course_modules m
  set sort_order = wanted.sort_order
  from wanted
  where m.id = wanted.module_id
    and m.sort_order is distinct from wanted.sort_order;

  with wanted as (
    select
      module_entry.entry->>'id' as module_id,
      lesson_entry.lesson_id,
      (lesson_entry.position - 1)::integer as sort_order
    from jsonb_array_elements(p_modules) as module_entry(entry),
      jsonb_array_elements_text(coalesce(module_entry.entry->'lessonIds', '[]'::jsonb))
        with ordinality as lesson_entry(lesson_id, position)
  )
  update public.lessons l
  set module_id = wanted.module_id, sort_order = wanted.sort_order
  from wanted
  where l.id = wanted.lesson_id
    and (l.module_id is distinct from wanted.module_id or l.sort_order is distinct from wanted.sort_order);

  with counts as (
    select m.id, count(l.id) as total
    from public.course_modules m
    left join public.lessons l on l.module_id = m.id and l.status <> 'deleted'
    where m.owner_id = p_content_id and m.status <> 'deleted'
    group by m.id
  )
  update public.course_modules m
  set meta = counts.total::text || case when counts.total = 1 then ' aula' else ' aulas' end
  from counts
  where m.id = counts.id
    and m.meta is distinct from counts.total::text || case when counts.total = 1 then ' aula' else ' aulas' end;
end;
$$;

-- Turmas do produto (aba Acesso e venda, so leitura): nome + alunos com matricula ativa nela.
create or replace function public.admin_product_cohorts(p_content_id text)
returns table (name text, students_count integer)
language sql
stable
security invoker
set search_path = public
as $$
  select btrim(sc.cohort) as name, count(distinct sc.student_id)::integer as students_count
  from public.student_courses sc
  where sc.target_id = p_content_id
    and sc.status = 'active'
    and nullif(btrim(coalesce(sc.cohort, '')), '') is not null
  group by btrim(sc.cohort)
  order by btrim(sc.cohort);
$$;

-- Alunos com acesso ativo agora a um produto (mesma regra da coluna "Com acesso" da lista): usado na aba
-- Acesso e venda e nas regras que dependem de "ja tem alunos" (trocar formato, entrar numa formacao).
create or replace function public.admin_product_students_with_access(p_content_id text)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(distinct e.user_id)::integer
  from public.entitlements e
  where e.target_id = p_content_id
    and e.status = 'active'
    and e.starts_at <= now()
    and (e.ends_at is null or e.ends_at > now());
$$;

revoke all on function public.admin_product_list(text[], text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_reorder_product_content(text, jsonb) from public, anon, authenticated;
revoke all on function public.admin_product_cohorts(text) from public, anon, authenticated;
revoke all on function public.admin_product_students_with_access(text) from public, anon, authenticated;

grant execute on function public.admin_product_list(text[], text, text, integer, integer) to service_role;
grant execute on function public.admin_reorder_product_content(text, jsonb) to service_role;
grant execute on function public.admin_product_cohorts(text) to service_role;
grant execute on function public.admin_product_students_with_access(text) to service_role;

comment on function public.admin_product_list(text[], text, text, integer, integer) is
  'Lista paginada de Produtos do admin v2 com aulas (total/publicadas) e acessos ativos por linha.';
comment on function public.admin_reorder_product_content(text, jsonb) is
  'Reordena modulos e aulas de um produto numa transacao; conjunto divergente levanta stale_structure.';
comment on function public.admin_product_cohorts(text) is
  'Turmas com matriculas ativas do produto (nome e quantidade de alunos).';
comment on function public.admin_product_students_with_access(text) is
  'Alunos distintos com acesso ativo agora ao produto.';
