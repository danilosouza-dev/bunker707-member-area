-- Equipe, parte 2 (2026-10-15): funcoes personalizadas. Decisao em docs/17 §2.3.
--
-- Regras:
-- - o dono monta funcoes com nome (pacotes de permissoes), e cada pessoa da equipe pode ter uma ou
--   mais funcoes, prontas ou personalizadas, mais permissoes extras so dela (admin_roles.permissions:
--   { functions, actions, scopedActions, productIds });
-- - mudar uma funcao muda todo mundo que a tem: a pessoa guarda so o id, e o servidor le a funcao a
--   cada requisicao;
-- - so o servidor (service_role) le e grava, depois de requireRole("settings.team"); nada para
--   anon/authenticated. Permissao desconhecida gravada aqui e ignorada na leitura;
-- - curso novo de quem cria so nos proprios cursos entra na lista da pessoa num UPDATE so (secao 2);
-- - importar playlist so cria curso novo, com trava por playlist (secao 3).
--
-- Verificacao manual depois de aplicar:
--   select id, name, cardinality(actions) from public.admin_functions order by name;
--   select proname from pg_proc where proname in ('admin_add_course_to_member_scope', 'admin_import_new_youtube_course');

/* ------------------------------------------------------------------------------------------------
 * 1. Funcoes personalizadas
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.admin_functions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  description text not null default '' check (char_length(description) <= 240),
  actions text[] not null default '{}' check (cardinality(actions) between 1 and 40),
  scoped_actions text[] not null default '{}' check (cardinality(scoped_actions) <= 40 and scoped_actions <@ actions),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists admin_functions_name_key on public.admin_functions (lower(btrim(name)));

alter table public.admin_functions enable row level security;
revoke all on public.admin_functions from anon, authenticated;
grant select, insert, update, delete on public.admin_functions to service_role;

drop trigger if exists set_admin_functions_updated_at on public.admin_functions;
create trigger set_admin_functions_updated_at
  before update on public.admin_functions
  for each row execute function public.set_updated_at();

/* ------------------------------------------------------------------------------------------------
 * 2. Curso novo entra na lista de quem o criou
 *    So mexe em permissions.productIds, com a linha travada: nao regrava funcoes e extras que o dono
 *    mudou ao mesmo tempo, nao perde curso criado em paralelo e respeita o teto de 100 cursos
 *    (MAX_SCOPED_PRODUCTS em src/server/auth/roles.ts). Devolve true quando o curso esta na lista.
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.admin_add_course_to_member_scope(p_user_id uuid, p_product_id text)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_ids jsonb;
begin
  select permissions -> 'productIds' into current_ids
  from public.admin_roles
  where user_id = p_user_id
  for update;

  if not found then
    return false;
  end if;

  if current_ids is null or jsonb_typeof(current_ids) is distinct from 'array' then
    current_ids := '[]'::jsonb;
  end if;

  if current_ids ? p_product_id then
    return true;
  end if;

  if jsonb_array_length(current_ids) >= 100 then
    return false;
  end if;

  update public.admin_roles
  set permissions = jsonb_set(permissions, '{productIds}', current_ids || to_jsonb(p_product_id))
  where user_id = p_user_id;

  return true;
end;
$$;

revoke all on function public.admin_add_course_to_member_scope(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_add_course_to_member_scope(uuid, text) to service_role;

/* ------------------------------------------------------------------------------------------------
 * 3. Importar playlist so cria curso novo
 *    A tela recusa playlist que ja virou curso, mas ler o YouTube leva segundos: duas importacoes da
 *    mesma playlist ao mesmo tempo nao podem regravar o curso da outra (nem dar a quem cria so nos
 *    proprios cursos um curso que nao e dele). Trava por playlist, confere de novo e chama a RPC de
 *    sempre (import_youtube_course, migracao 202610110012).
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.admin_import_new_youtube_course(course_import jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  playlist_id_value text := trim(coalesce(course_import->>'playlistId', ''));
begin
  perform pg_advisory_xact_lock(hashtext('public.youtube_course_imports:' || playlist_id_value));

  if exists (select 1 from public.youtube_course_imports where playlist_id = playlist_id_value) then
    raise exception 'playlist_already_imported';
  end if;

  return public.import_youtube_course(course_import);
end;
$$;

revoke all on function public.admin_import_new_youtube_course(jsonb) from public, anon, authenticated;
grant execute on function public.admin_import_new_youtube_course(jsonb) to service_role;
