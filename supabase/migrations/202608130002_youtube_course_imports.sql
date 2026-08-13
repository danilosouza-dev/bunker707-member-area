create table if not exists public.youtube_course_imports (
  playlist_id text primary key,
  playlist_url text not null,
  course_id text not null unique references public.content_items(id) on delete cascade,
  last_manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint youtube_course_imports_playlist_id_format
    check (playlist_id ~ '^[A-Za-z0-9_-]{10,80}$')
);

alter table public.youtube_course_imports enable row level security;

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
  set status = 'archived', updated_at = now()
  where module_id in (
    select id from public.course_modules
    where owner_id = course_id_value
      and left(id, length('yt-module-' || playlist_id_value || '-')) = 'yt-module-' || playlist_id_value || '-'
  );

  update public.course_modules
  set status = 'archived', updated_at = now()
  where owner_id = course_id_value
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
      owner_id = excluded.owner_id,
      owner_kind = excluded.owner_kind,
      sort_order = excluded.sort_order,
      status = 'published',
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

revoke all on table public.youtube_course_imports from public, anon, authenticated;
revoke all on function public.import_youtube_course(jsonb) from public, anon, authenticated;
grant execute on function public.import_youtube_course(jsonb) to service_role;

comment on table public.youtube_course_imports is
  'Registro interno e idempotente das playlists do YouTube importadas como cursos.';

comment on function public.import_youtube_course(jsonb) is
  'Sincroniza uma playlist validada no servidor e sempre devolve o curso ao estado de rascunho.';
