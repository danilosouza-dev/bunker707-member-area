-- Produtos v2, fase 1 (docs/17 §1.3, §1.6 e §2.4).
--
-- 1. "Quem pode ver" = access_model + listing. "Oculto por enquanto" e regra de listagem filtrada em
--    consulta (vitrine, Minhas compras, lista do admin), por isso vira coluna com check, e nao chave de
--    content_page_settings.settings (que guarda so apresentacao). O admin legado nunca escreve listing.
-- 2. Excluir modulo ou aula com "Desfazer": status 'deleted' + deleted_at/deleted_by. Nada e apagado de
--    verdade nesta fase, entao progresso, comentarios e avaliacoes da aula sobrevivem a um desfazer.
-- 3. import_youtube_course deixa de escrever 'archived' (valor que o check novo recusa) e passa a
--    marcar como 'deleted' o que saiu da playlist.

alter table public.content_items
  add column if not exists listing text not null default 'listed';

alter table public.content_items
  drop constraint if exists content_items_listing_check;

alter table public.content_items
  add constraint content_items_listing_check check (listing in ('listed', 'hidden'));

create index if not exists content_items_hidden_listing_idx
  on public.content_items (id)
  where listing = 'hidden';

comment on column public.content_items.listing is
  'listed = aparece na vitrine; hidden = "Oculto por enquanto": so quem tem acesso ve (Minhas compras e a pagina do produto).';

alter table public.course_modules
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

alter table public.lessons
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

-- 'archived' so era escrito por import_youtube_course para o que saiu da playlist: ja estava fora da
-- area do aluno e equivale a excluido. Qualquer outro valor desconhecido vira rascunho, o que nunca
-- torna visivel algo que nao era (o aluno so le status = 'published').
update public.lessons
set status = 'deleted', deleted_at = coalesce(deleted_at, updated_at)
where status = 'archived';

update public.course_modules
set status = 'deleted', deleted_at = coalesce(deleted_at, updated_at)
where status = 'archived';

update public.lessons
set status = 'draft'
where status not in ('published', 'draft', 'deleted');

update public.course_modules
set status = 'draft'
where status not in ('published', 'draft', 'deleted');

alter table public.lessons
  drop constraint if exists lessons_status_check;

alter table public.lessons
  add constraint lessons_status_check check (status in ('published', 'draft', 'deleted'));

alter table public.course_modules
  drop constraint if exists course_modules_status_check;

alter table public.course_modules
  add constraint course_modules_status_check check (status in ('published', 'draft', 'deleted'));

create index if not exists lessons_module_status_sort_idx
  on public.lessons (module_id, status, sort_order);

create index if not exists course_modules_owner_status_sort_idx
  on public.course_modules (owner_id, status, sort_order);

comment on column public.lessons.status is
  'published = aluno ve; draft = rascunho; deleted = excluida com Desfazer (deleted_at/deleted_by).';
comment on column public.course_modules.status is
  'published = aluno ve; draft = rascunho (sem uso na interface nova); deleted = excluido com Desfazer.';

-- Mesmo corpo de 202608130002_youtube_course_imports.sql, trocando 'archived' por 'deleted' (com
-- deleted_at) e limpando deleted_at/deleted_by quando a reimportacao publica de novo.
create or replace function public.import_youtube_course(course_import jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  access_model_value text := coalesce(course_import->>'accessModel', 'closed');
  course_description text := left(trim(coalesce(course_import->>'description', '')), 10000);
  course_id_value text;
  course_image text := trim(coalesce(course_import->>'image', ''));
  course_title text := left(trim(coalesce(course_import->>'title', '')), 180);
  lesson_count integer := 0;
  lesson_record jsonb;
  module_count integer := 0;
  module_id_value text;
  module_record jsonb;
  playlist_id_value text := trim(coalesce(course_import->>'playlistId', ''));
  playlist_url_value text := trim(coalesce(course_import->>'playlistUrl', ''));
  presentation_mode text := coalesce(course_import->>'coursePresentationMode', 'lesson_playlist');
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

  select course_id into course_id_value
  from public.youtube_course_imports
  where playlist_id = playlist_id_value;

  if course_id_value is null and exists (
    select 1 from public.content_items where id = 'yt-course-' || playlist_id_value
  ) then
    raise exception 'O identificador desta playlist ja pertence a outro curso.';
  end if;

  course_id_value := coalesce(course_id_value, 'yt-course-' || playlist_id_value);

  insert into public.content_items (
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
    image = excluded.image,
    purchase_label = excluded.purchase_label,
    status = excluded.status,
    is_locked = excluded.is_locked,
    publication_status = 'draft',
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

  update public.lessons
  set status = 'deleted', deleted_at = now(), deleted_by = null, updated_at = now()
  where status <> 'deleted'
    and module_id in (
      select id from public.course_modules
      where owner_id = course_id_value
        and left(id, length('yt-module-' || playlist_id_value || '-')) = 'yt-module-' || playlist_id_value || '-'
    );

  update public.course_modules
  set status = 'deleted', deleted_at = now(), deleted_by = null, updated_at = now()
  where owner_id = course_id_value
    and status <> 'deleted'
    and left(id, length('yt-module-' || playlist_id_value || '-')) = 'yt-module-' || playlist_id_value || '-';

  for module_record in
    select value from jsonb_array_elements(course_import->'modules')
  loop
    module_count := module_count + 1;

    if jsonb_typeof(module_record->'lessons') is distinct from 'array'
      or jsonb_array_length(module_record->'lessons') = 0
      or jsonb_array_length(module_record->'lessons') > 500 then
      raise exception 'Estrutura de aulas invalida.';
    end if;

    module_id_value := 'yt-module-' || playlist_id_value || '-' || lpad(module_count::text, 3, '0');

    insert into public.course_modules (
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
      meta = excluded.meta,
      owner_id = excluded.owner_id,
      owner_kind = excluded.owner_kind,
      sort_order = excluded.sort_order,
      status = 'published',
      deleted_at = null,
      deleted_by = null,
      updated_at = now();

    for lesson_record in
      select value from jsonb_array_elements(module_record->'lessons')
    loop
      lesson_count := lesson_count + 1;

      if coalesce(lesson_record->>'videoId', '') !~ '^[A-Za-z0-9_-]{11}$' then
        raise exception 'A playlist contem uma aula invalida.';
      end if;

      insert into public.lessons (
        id, module_id, title, description, duration, image, completed,
        video_config, sort_order, status
      ) values (
        'yt-lesson-' || playlist_id_value || '-' || (lesson_record->>'videoId'),
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
        status = 'published',
        deleted_at = null,
        deleted_by = null,
        updated_at = now();
    end loop;
  end loop;

  update public.content_items
  set lessons_label = lesson_count::text || case when lesson_count = 1 then ' aula' else ' aulas' end,
      publication_status = 'draft',
      updated_at = now()
  where id = course_id_value;

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
    'lessonCount', lesson_count,
    'moduleCount', module_count,
    'publicationStatus', 'draft'
  );
end;
$$;

revoke all on function public.import_youtube_course(jsonb) from public, anon, authenticated;
grant execute on function public.import_youtube_course(jsonb) to service_role;
