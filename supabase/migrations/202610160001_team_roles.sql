-- Equipe (2026-10-16): papeis Professor (instructor) e Personalizado (custom), permissoes por pessoa
-- e dono protegido. Decisao e pesquisa de mercado em docs/17 §2.3.
--
-- Regras:
-- - admin_roles continua escrita so pelo servidor (service_role), sempre depois de requireRole("settings.team");
--   o navegador so le a propria linha (policy "Admins can read own role", 202606150003);
-- - permissions (jsonb) guarda o que cada papel precisa: { "actions": [...] } no Personalizado e
--   { "productIds": [...] } no Professor. O servidor le sem confiar (acao desconhecida e id invalido
--   sao descartados) e calcula as permissoes efetivas a cada requisicao;
-- - a escola nunca fica sem dono: remover, rebaixar ou apagar a conta do ultimo dono falha no banco.
--
-- Verificacao manual depois de aplicar:
--   select role, count(*) from public.admin_roles group by role;
--   -- com um dono so, isto tem que falhar com "last_owner":
--   -- update public.admin_roles set role = 'admin' where role = 'owner';

/* ------------------------------------------------------------------------------------------------
 * 1. Papeis aceitos e formato das permissoes
 * ---------------------------------------------------------------------------------------------- */

alter table public.admin_roles drop constraint if exists admin_roles_role_check;
alter table public.admin_roles
  add constraint admin_roles_role_check
  check (role in ('owner', 'admin', 'editor', 'instructor', 'support', 'analyst', 'custom'));

alter table public.admin_roles drop constraint if exists admin_roles_permissions_check;
alter table public.admin_roles
  add constraint admin_roles_permissions_check
  check (jsonb_typeof(permissions) = 'object' and pg_column_size(permissions) <= 16384);

-- Escrita so pelo servidor (RLS ja nega sem policy; isto deixa explicito).
revoke insert, update, delete on public.admin_roles from anon, authenticated;

/* ------------------------------------------------------------------------------------------------
 * 2. Dono protegido: sempre pelo menos um dono
 *    Uma trava da transacao (advisory lock) enfileira as mudancas de dono antes de contar: dois
 *    pedidos ao mesmo tempo nunca removem os dois ultimos donos, e sem o cruzamento de travas de
 *    linha que daria deadlock. Tambem barra apagar a conta (auth.users) do ultimo dono, pelo cascade.
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.guard_last_admin_owner()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role is distinct from 'owner') then
    perform pg_advisory_xact_lock(hashtext('public.admin_roles:last_owner'));

    if not exists (select 1 from public.admin_roles where role = 'owner' and id <> old.id) then
      raise exception 'last_owner' using hint = 'A escola precisa de pelo menos um dono.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_last_admin_owner() from public, anon, authenticated;

drop trigger if exists admin_roles_guard_last_owner on public.admin_roles;
create trigger admin_roles_guard_last_owner
  before update of role or delete on public.admin_roles
  for each row execute function public.guard_last_admin_owner();
