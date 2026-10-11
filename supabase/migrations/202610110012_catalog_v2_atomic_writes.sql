-- Produtos v2, fase 1: escritas de varias etapas viram uma transacao so (docs/17 §2.3).
--
-- 1. admin_patch_product_settings: muda so as chaves pedidas de content_page_settings.settings num
--    UPDATE atomico. Antes o servidor lia o JSON inteiro, mudava e regravava tudo: duas escritas ao
--    mesmo tempo (cor em Detalhes + upload do hero, ou o admin legado) apagavam a chave da outra.
-- 2. admin_add_course_to_formation / admin_remove_course_from_formation: commerce_scope e
--    settings.parentFormationId mudam juntos. Antes, uma falha entre as duas escritas deixava o curso
--    como incluido e sem formacao, invisivel em todas as listas do admin.
-- 3. admin_reorder_formation_courses: trava os cursos da formacao e confere o conjunto, como
--    admin_reorder_product_content ('stale_structure' vira 409 na Server Action).
-- 4. admin_save_combo: dados do pacote e troca dos produtos dele na mesma transacao. Antes, falhar
--    entre apagar e inserir os itens deixava o pacote sem produtos.
-- 5. import_youtube_course reimportando uma playlist ja importada nao desfaz o trabalho do produtor:
--    mantem situacao (Publicado/Rascunho) e capa quando nenhuma capa nova vem, so exclui aulas da
--    propria playlist (yt-lesson-<playlist>-*), nao publica de novo aulas em Rascunho nem as que o
--    produtor excluiu (deleted_by preenchido) e nao esconde modulos que ainda tem aulas do produtor.
--
-- Todas as funcoes admin_* sao security invoker e so a chave de servico executa
-- (src/server/catalog/**); nenhum papel do navegador chama.

create or replace function public.admin_patch_product_settings(
  p_content_id text,
  p_set jsonb default '{}'::jsonb,
  p_unset text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  patch jsonb := coalesce(p_set, '{}'::jsonb);
  removed text[] := coalesce(p_unset, '{}'::text[]);
  next_settings jsonb;
begin
  if jsonb_typeof(patch) is distinct from 'object' then
    raise exception 'invalid_settings_patch';
  end if;

  insert into public.content_page_settings as s (content_id, settings, updated_at)
  values (p_content_id, patch, now())
  on conflict (content_id) do update set
    settings = (s.settings - removed) || patch,
    updated_at = now()
  returning s.settings into next_settings;

  -- Sem nenhuma chave, a linha sai (mesmo comportamento da escrita antiga).
  if next_settings = '{}'::jsonb then
    delete from public.content_page_settings
    where content_id = p_content_id and settings = '{}'::jsonb;
  end if;

  return next_settings;
end;
$$;

create or replace function public.admin_add_course_to_formation(
  p_formation_id text,
  p_course_id text,
  p_bucket text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_parent text;
  current_scope text;
  next_sort integer;
begin
  -- Serializa mudancas na lista desta formacao.
  perform 1 from public.content_items where id = p_formation_id for update;

  if not found then
    raise exception 'stale_structure';
  end if;

  select c.commerce_scope, s.settings->>'parentFormationId'
  into current_scope, current_parent
  from public.content_items c
  left join public.content_page_settings s on s.content_id = c.id
  where c.id = p_course_id
  for update of c;

  if not found then
    raise exception 'stale_structure';
  end if;

  if current_scope = 'included_content' and current_parent = p_formation_id then
    return;
  end if;

  -- Entrou em outra formacao depois que a tela leu: recusa (409) em vez de trocar de dono.
  if current_scope = 'included_content' and nullif(current_parent, '') is not null then
    raise exception 'stale_structure';
  end if;

  select coalesce(max(c.sort_order) + 1, 0)
  into next_sort
  from public.content_items c
  join public.content_page_settings s on s.content_id = c.id
  where s.settings->>'parentFormationId' = p_formation_id
    and c.commerce_scope = 'included_content'
    and c.id <> p_course_id;

  update public.content_items
  set bucket = p_bucket, commerce_scope = 'included_content', sort_order = next_sort
  where id = p_course_id;

  insert into public.content_page_settings as s (content_id, settings, updated_at)
  values (p_course_id, jsonb_build_object('parentFormationId', p_formation_id), now())
  on conflict (content_id) do update set
    settings = s.settings || jsonb_build_object('parentFormationId', p_formation_id),
    updated_at = now();
end;
$$;

create or replace function public.admin_remove_course_from_formation(
  p_formation_id text,
  p_course_id text,
  p_bucket text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_parent text;
  current_scope text;
  top_sort integer;
begin
  perform 1 from public.content_items where id = p_formation_id for update;

  select c.commerce_scope, s.settings->>'parentFormationId'
  into current_scope, current_parent
  from public.content_items c
  left join public.content_page_settings s on s.content_id = c.id
  where c.id = p_course_id
  for update of c;

  if not found or current_scope is distinct from 'included_content' or current_parent is distinct from p_formation_id then
    raise exception 'stale_structure';
  end if;

  -- Volta como curso avulso em Rascunho, no topo do grupo (mesmo comportamento do legado).
  select coalesce(min(sort_order) - 1, 0) into top_sort
  from public.content_items
  where bucket = p_bucket;

  update public.content_items
  set bucket = p_bucket,
      commerce_scope = 'sellable_product',
      publication_status = 'draft',
      sort_order = top_sort
  where id = p_course_id;

  update public.content_page_settings
  set settings = settings - 'parentFormationId', updated_at = now()
  where content_id = p_course_id;

  delete from public.content_page_settings
  where content_id = p_course_id and settings = '{}'::jsonb;
end;
$$;

create or replace function public.admin_reorder_formation_courses(p_formation_id text, p_course_ids text[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_ids text[];
  wanted_ids text[];
begin
  perform 1 from public.content_items where id = p_formation_id for update;

  if not found then
    raise exception 'stale_structure';
  end if;

  perform 1
  from public.content_items c
  join public.content_page_settings s on s.content_id = c.id
  where s.settings->>'parentFormationId' = p_formation_id
    and c.commerce_scope = 'included_content'
  order by c.id
  for update of c;

  select coalesce(array_agg(c.id order by c.id), '{}')
  into current_ids
  from public.content_items c
  join public.content_page_settings s on s.content_id = c.id
  where s.settings->>'parentFormationId' = p_formation_id
    and c.commerce_scope = 'included_content';

  select coalesce(array_agg(course_id order by course_id), '{}')
  into wanted_ids
  from unnest(coalesce(p_course_ids, '{}'::text[])) as course_id;

  if current_ids is distinct from wanted_ids then
    raise exception 'stale_structure';
  end if;

  update public.content_items c
  set sort_order = (wanted.position - 1)::integer
  from unnest(p_course_ids) with ordinality as wanted(course_id, position)
  where c.id = wanted.course_id
    and c.sort_order is distinct from (wanted.position - 1)::integer;
end;
$$;

create or replace function public.admin_save_combo(
  p_combo_id text,
  p_create boolean,
  p_name text,
  p_description text,
  p_cohort_name text,
  p_status text,
  p_product_ids text[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if exists (
    select 1
    from unnest(coalesce(p_product_ids, '{}'::text[])) as wanted(product_id)
    left join public.content_items c on c.id = wanted.product_id
    where c.id is null or c.commerce_scope is distinct from 'sellable_product'
  ) then
    raise exception 'combo_product_unavailable';
  end if;

  if p_create then
    insert into public.product_combos (id, name, description, cohort_name, status)
    values (p_combo_id, p_name, coalesce(p_description, ''), p_cohort_name, p_status);
  else
    update public.product_combos
    set name = p_name, description = coalesce(p_description, ''), cohort_name = p_cohort_name, status = p_status
    where id = p_combo_id;

    if not found then
      raise exception 'combo_not_found';
    end if;
  end if;

  delete from public.product_combo_items where combo_id = p_combo_id;

  insert into public.product_combo_items (combo_id, product_id, sort_order)
  select p_combo_id, item.product_id, (item.position - 1)::integer
  from unnest(coalesce(p_product_ids, '{}'::text[])) with ordinality as item(product_id, position);
end;
$$;

-- Mesmo contrato de 202610110010 (corpo e limites), com as protecoes do item 5 acima.
create or replace function public.import_youtube_course(course_import jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  access_model_value text := coalesce(course_import->>'accessModel', 'closed');
  course_description text := left(trim(coalesce(course_import->>'description', '')), 10000);
  course_existed boolean := false;
  course_id_value text;
  course_image text := trim(coalesce(course_import->>'image', ''));
  course_title text := left(trim(coalesce(course_import->>'title', '')), 180);
  imported_lesson_ids text[] := '{}';
  imported_module_ids text[] := '{}';
  lesson_count integer := 0;
  lesson_id_value text;
  lesson_prefix text;
  lesson_record jsonb;
  module_count integer := 0;
  module_id_value text;
  module_prefix text;
  module_record jsonb;
  playlist_id_value text := trim(coalesce(course_import->>'playlistId', ''));
  playlist_url_value text := trim(coalesce(course_import->>'playlistUrl', ''));
  presentation_mode text := coalesce(course_import->>'coursePresentationMode', 'lesson_playlist');
  publication_status_value text;
begin
  if playlist_id_value !~ '^[A-Za-z0-9_-]{10,80}$' then
    raise exception 'Playlist do YouTube invalida.';
  end if;

  if course_title = '' then
    raise exception 'O nome do curso e obrigatorio.';
  end if;

  if access_model_value not in ('closed', 'free') then
    raise exception 'Modelo de acesso invalido.';
  end if;

  if presentation_mode not in ('lesson_playlist', 'module_cards') then
    raise exception 'Modo de apresentacao invalido.';
  end if;

  if jsonb_typeof(course_import->'modules') is distinct from 'array'
    or jsonb_array_length(course_import->'modules') = 0
    or jsonb_array_length(course_import->'modules') > 100 then
    raise exception 'Estrutura de modulos invalida.';
  end if;

  module_prefix := 'yt-module-' || playlist_id_value || '-';
  lesson_prefix := 'yt-lesson-' || playlist_id_value || '-';

  select course_id into course_id_value
  from public.youtube_course_imports
  where playlist_id = playlist_id_value;

  if course_id_value is null and exists (
    select 1 from public.content_items where id = 'yt-course-' || playlist_id_value
  ) then
    raise exception 'O identificador desta playlist ja pertence a outro curso.';
  end if;

  course_id_value := coalesce(course_id_value, 'yt-course-' || playlist_id_value);
  course_existed := exists (select 1 from public.content_items where id = course_id_value);

  -- Reimportar nao tira do ar um curso publicado e nao apaga a capa quando nenhuma capa nova vem.
  insert into public.content_items as c (
    id, bucket, kind, commerce_scope, access_model, title, eyebrow, description,
    access_label, image, progress, lessons_label, purchase_label, purchase_target,
    status, is_locked, sort_order, publication_status
  ) values (
    course_id_value, 'courses', 'Curso', 'sellable_product', access_model_value,
    course_title, 'Curso', course_description, 'Curso', course_image, 0, '0 aulas',
    case when access_model_value = 'closed' then 'Comprar' else null end,
    'same_tab', case when access_model_value = 'free' then 'Liberado' else 'Bloqueado' end,
    access_model_value = 'closed', 0, 'draft'
  )
  on conflict (id) do update set
    access_model = excluded.access_model,
    title = excluded.title,
    description = excluded.description,
    image = case when excluded.image = '' then c.image else excluded.image end,
    purchase_label = excluded.purchase_label,
    status = excluded.status,
    is_locked = excluded.is_locked,
    updated_at = now();

  insert into public.content_page_settings (content_id, settings)
  values (
    course_id_value,
    jsonb_build_object('coursePresentationMode', presentation_mode)
  )
  on conflict (content_id) do update set
    settings = (public.content_page_settings.settings - 'homeModuleSection')
      || jsonb_build_object('coursePresentationMode', presentation_mode),
    updated_at = now();

  for module_record in
    select value from jsonb_array_elements(course_import->'modules')
  loop
    module_count := module_count + 1;

    if jsonb_typeof(module_record->'lessons') is distinct from 'array'
      or jsonb_array_length(module_record->'lessons') = 0
      or jsonb_array_length(module_record->'lessons') > 500 then
      raise exception 'Estrutura de aulas invalida.';
    end if;

    module_id_value := module_prefix || lpad(module_count::text, 3, '0');
    imported_module_ids := imported_module_ids || module_id_value;

    -- Modulo que o produtor excluiu (deleted_by preenchido) continua excluido; o que a importacao
    -- anterior tirou (deleted_by nulo) volta.
    insert into public.course_modules as m (
      id, title, eyebrow, description, image, meta, owner_id, owner_kind,
      progress, sort_order, status
    ) values (
      module_id_value,
      left(trim(coalesce(module_record->>'title', 'Modulo ' || module_count)), 180),
      'Modulo ' || lpad(module_count::text, 2, '0'),
      '', '',
      jsonb_array_length(module_record->'lessons')::text ||
        case when jsonb_array_length(module_record->'lessons') = 1 then ' aula' else ' aulas' end,
      course_id_value, 'Curso', 0, module_count - 1, 'published'
    )
    on conflict (id) do update set
      title = excluded.title,
      eyebrow = excluded.eyebrow,
      owner_id = excluded.owner_id,
      owner_kind = excluded.owner_kind,
      sort_order = excluded.sort_order,
      status = case
        when m.status = 'deleted' and m.deleted_by is not null then 'deleted'
        when m.status = 'draft' then 'draft'
        else 'published'
      end,
      deleted_at = case when m.status = 'deleted' and m.deleted_by is not null then m.deleted_at else null end,
      deleted_by = case when m.status = 'deleted' and m.deleted_by is not null then m.deleted_by else null end,
      updated_at = now();

    for lesson_record in
      select value from jsonb_array_elements(module_record->'lessons')
    loop
      lesson_count := lesson_count + 1;

      if coalesce(lesson_record->>'videoId', '') !~ '^[A-Za-z0-9_-]{11}$' then
        raise exception 'A playlist contem uma aula invalida.';
      end if;

      lesson_id_value := lesson_prefix || (lesson_record->>'videoId');
      imported_lesson_ids := imported_lesson_ids || lesson_id_value;

      -- Aula em Rascunho fica em Rascunho; aula excluida pelo produtor fica excluida.
      insert into public.lessons as l (
        id, module_id, title, description, duration, image, completed,
        video_config, sort_order, status
      ) values (
        lesson_id_value,
        module_id_value,
        left(trim(coalesce(lesson_record->>'title', 'Aula')), 180),
        '', left(coalesce(lesson_record->>'duration', 'Duracao nao informada'), 40),
        'https://i.ytimg.com/vi/' || (lesson_record->>'videoId') || '/hqdefault.jpg',
        false,
        jsonb_build_object('provider', 'youtube', 'assetId', lesson_record->>'videoId'),
        coalesce((lesson_record->>'order')::integer, lesson_count) - 1,
        'published'
      )
      on conflict (id) do update set
        module_id = excluded.module_id,
        title = excluded.title,
        duration = excluded.duration,
        image = excluded.image,
        video_config = excluded.video_config,
        sort_order = excluded.sort_order,
        status = case
          when l.status = 'deleted' and l.deleted_by is not null then 'deleted'
          when l.status = 'draft' then 'draft'
          else 'published'
        end,
        deleted_at = case when l.status = 'deleted' and l.deleted_by is not null then l.deleted_at else null end,
        deleted_by = case when l.status = 'deleted' and l.deleted_by is not null then l.deleted_by else null end,
        updated_at = now();
    end loop;
  end loop;

  -- Saiu da playlist: so aulas da propria playlist; aulas que o produtor criou ficam como estao.
  update public.lessons l
  set status = 'deleted', deleted_at = now(), deleted_by = null, updated_at = now()
  where l.status <> 'deleted'
    and left(l.id, length(lesson_prefix)) = lesson_prefix
    and l.id <> all (imported_lesson_ids)
    and l.module_id in (select id from public.course_modules where owner_id = course_id_value);

  -- Modulo da playlist que sobrou so sai se nao tiver mais nenhuma aula visivel do produtor.
  update public.course_modules m
  set status = 'deleted', deleted_at = now(), deleted_by = null, updated_at = now()
  where m.owner_id = course_id_value
    and m.status <> 'deleted'
    and left(m.id, length(module_prefix)) = module_prefix
    and m.id <> all (imported_module_ids)
    and not exists (
      select 1 from public.lessons l where l.module_id = m.id and l.status <> 'deleted'
    );

  with counts as (
    select m.id, count(l.id) as total
    from public.course_modules m
    left join public.lessons l on l.module_id = m.id and l.status <> 'deleted'
    where m.owner_id = course_id_value and m.status <> 'deleted'
    group by m.id
  )
  update public.course_modules m
  set meta = counts.total::text || case when counts.total = 1 then ' aula' else ' aulas' end
  from counts
  where m.id = counts.id
    and m.meta is distinct from counts.total::text || case when counts.total = 1 then ' aula' else ' aulas' end;

  update public.content_items
  set lessons_label = lesson_count::text || case when lesson_count = 1 then ' aula' else ' aulas' end,
      updated_at = now()
  where id = course_id_value
  returning publication_status into publication_status_value;

  insert into public.youtube_course_imports (
    playlist_id, playlist_url, course_id, last_manifest
  ) values (
    playlist_id_value, playlist_url_value, course_id_value, course_import
  )
  on conflict (playlist_id) do update set
    playlist_url = excluded.playlist_url,
    last_manifest = excluded.last_manifest,
    updated_at = now();

  return jsonb_build_object(
    'courseId', course_id_value,
    'courseExisted', course_existed,
    'lessonCount', lesson_count,
    'moduleCount', module_count,
    'publicationStatus', coalesce(publication_status_value, 'draft')
  );
end;
$$;

revoke all on function public.admin_patch_product_settings(text, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.admin_add_course_to_formation(text, text, text) from public, anon, authenticated;
revoke all on function public.admin_remove_course_from_formation(text, text, text) from public, anon, authenticated;
revoke all on function public.admin_reorder_formation_courses(text, text[]) from public, anon, authenticated;
revoke all on function public.admin_save_combo(text, boolean, text, text, text, text, text[]) from public, anon, authenticated;
revoke all on function public.import_youtube_course(jsonb) from public, anon, authenticated;

grant execute on function public.admin_patch_product_settings(text, jsonb, text[]) to service_role;
grant execute on function public.admin_add_course_to_formation(text, text, text) to service_role;
grant execute on function public.admin_remove_course_from_formation(text, text, text) to service_role;
grant execute on function public.admin_reorder_formation_courses(text, text[]) to service_role;
grant execute on function public.admin_save_combo(text, boolean, text, text, text, text, text[]) to service_role;
grant execute on function public.import_youtube_course(jsonb) to service_role;

comment on function public.admin_patch_product_settings(text, jsonb, text[]) is
  'Muda so as chaves pedidas de content_page_settings.settings (p_unset sai, p_set entra) num UPDATE atomico.';
comment on function public.admin_add_course_to_formation(text, text, text) is
  'Inclui um curso na formacao: commerce_scope, ordem e parentFormationId na mesma transacao.';
comment on function public.admin_remove_course_from_formation(text, text, text) is
  'Tira o curso da formacao (vira avulso em Rascunho) na mesma transacao; conjunto divergente levanta stale_structure.';
comment on function public.admin_reorder_formation_courses(text, text[]) is
  'Reordena os cursos da formacao numa transacao; conjunto divergente levanta stale_structure.';
comment on function public.admin_save_combo(text, boolean, text, text, text, text, text[]) is
  'Cria ou atualiza um pacote e troca os produtos dele na mesma transacao.';
