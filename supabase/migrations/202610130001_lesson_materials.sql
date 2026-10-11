-- Materiais de apoio das aulas (area do aluno, rodada "aluno v2").
--
-- Antes desta migracao a aba Materiais da aula mostrava uma lista fixa de exemplo, igual em toda aula.
-- Agora cada aula tem os proprios materiais (arquivo ou link https) e, opcionalmente, uma regra extra
-- para liberar (avaliar a aula ou assistir uma porcentagem), como em docs/05 (lesson_materials).
--
-- Seguranca:
-- - RLS ligada e nenhum acesso para anon/authenticated: o aluno nunca le a tabela direto. O servidor
--   le com a chave de servico depois de validar sessao, acesso ao conteudo e liberacao da aula, e so
--   devolve o endereco do arquivo quando a regra extra do material foi cumprida.
-- - file_url aceita apenas https (o arquivo fica no Storage ou em servico externo; nunca no servidor do app).
--
-- Idempotente: pode rodar de novo sem erro. Sem dados de exemplo.

create table if not exists public.lesson_materials (
  id uuid primary key default gen_random_uuid(),
  lesson_id text not null references public.lessons(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text check (description is null or char_length(description) <= 600),
  file_url text not null check (file_url ~ '^https://[^[:space:]]+$'),
  file_type text not null default 'link' check (
    file_type in ('pdf', 'spreadsheet', 'document', 'presentation', 'image', 'archive', 'audio', 'video', 'link', 'other')
  ),
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  unlock_rule text not null default 'none' check (unlock_rule in ('none', 'lesson_rated', 'lesson_progress')),
  unlock_threshold integer check (unlock_threshold is null or unlock_threshold between 1 and 100),
  generated_by_ai boolean not null default false,
  status text not null default 'published' check (status in ('draft', 'published', 'deleted')),
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Leitura do aluno: materiais publicados de um conjunto de aulas, na ordem do produtor.
create index if not exists lesson_materials_lesson_order_idx
  on public.lesson_materials (lesson_id, sort_order, created_at)
  where status = 'published';

alter table public.lesson_materials enable row level security;
revoke all on public.lesson_materials from anon, authenticated;
grant select, insert, update, delete on public.lesson_materials to service_role;

drop trigger if exists set_lesson_materials_updated_at on public.lesson_materials;
create trigger set_lesson_materials_updated_at
  before update on public.lesson_materials
  for each row execute function public.set_updated_at();

comment on table public.lesson_materials is
  'Materiais de apoio por aula. Leitura so pelo servidor (service_role) depois de validar o acesso do aluno.';
comment on column public.lesson_materials.unlock_rule is
  'none = liberado com a aula; lesson_rated = depois de reagir a aula; lesson_progress = depois de assistir unlock_threshold %.';
