-- Dados do teste de carga (infra/cloud/carga.sh): um curso ficticio com 2 modulos e 6 aulas e o acesso do
-- aluno de teste (:uid, criado pela API do Auth). Mesmos campos da escola de teste (tests/fixtures). Tudo
-- tem id carga-* e e apagado no fim do teste (modulos e aulas caem junto com o curso).
insert into public.profiles (id, email, full_name)
values (:'uid', 'carga@bunker707.test', 'Aluno do Teste de Carga')
on conflict (id) do update set full_name = excluded.full_name;

insert into public.content_items (
  id, title, kind, bucket, eyebrow, description, image, access_model, commerce_scope, listing,
  publication_status, status, lessons_label, purchase_label, purchase_url, sort_order, progress, is_locked
) values (
  'carga-curso', 'Carga: Curso de teste', 'Curso', 'courses', 'Curso',
  'Curso ficticio do teste de carga; apagado no fim do teste.', '/hero/bunker-ai-hero.png', 'closed',
  'sellable_product', 'listed', 'published', 'Bloqueado', '6 aulas', 'Comprar', 'https://exemplo.test/comprar/carga',
  1, 0, false
) on conflict (id) do nothing;

insert into public.course_modules (id, owner_id, owner_kind, title, eyebrow, description, image, meta, sort_order, status, progress)
values
  ('carga-modulo-1', 'carga-curso', 'Curso', 'Módulo 1: Fundamentos', 'Módulo 1', 'Primeiro modulo do teste de carga.', '/hero/bunker-707-neon-hero.png', '3 aulas', 1, 'published', 0),
  ('carga-modulo-2', 'carga-curso', 'Curso', 'Módulo 2: Na prática', 'Módulo 2', 'Segundo modulo do teste de carga.', '/hero/bunker-707-red-neon-hero.png', '3 aulas', 2, 'published', 0)
on conflict (id) do nothing;

insert into public.lessons (id, module_id, title, description, duration, sort_order, status, completed, video_config)
select 'carga-aula-' || n, 'carga-modulo-' || (case when n <= 3 then 1 else 2 end),
       'Aula ' || n || ': conteúdo de teste', 'Aula ficticia do teste de carga.', '10 min',
       case when n <= 3 then n else n - 3 end, 'published', false,
       '{"provider": "youtube", "url": "https://www.youtube.com/watch?v=aqz-KE-bpKQ"}'::jsonb
from generate_series(1, 6) as n
on conflict (id) do nothing;

insert into public.entitlements (user_id, target_type, target_id, status, starts_at, ends_at, source_provider, source_event_id)
values (:'uid', 'standalone_course', 'carga-curso', 'active', now() - interval '1 day', null, 'manual', 'carga:curso')
on conflict (user_id, source_event_id) do nothing;
