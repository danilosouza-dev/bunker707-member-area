-- Prazo de acesso por curso e "todas as formacoes" (2026-11-28; docs/05, secao "Prazo de acesso por
-- curso e todas as formacoes"; docs/17 §1.6.10). As migracoes anteriores nao mudam; este arquivo so
-- acrescenta colunas, uma tabela e uma funcao nova.
--
-- Por que: as plataformas de venda (Hotmart, Ticto, Kiwify) nao avisam por webhook quando o prazo de
-- acesso de uma compra unica acaba; o prazo delas vale so na area de membros delas. O prazo e contado
-- aqui, em entitlements.ends_at.
--
-- 1. O prazo: um par (unidade, quantidade). Os dois nulos = para sempre (o padrao, igual a hoje).
--    Os checks pedem os dois preenchidos juntos, com `is not null` escrito: um check com resultado nulo passa.
--    O mesmo par aparece no item do pacote, no codigo de venda de um produto sozinho, no item especial
--    "todas as formacoes" do pacote e no vinculo da venda com o acesso (o prazo que aquela venda somou).
-- 2. `sale_grants` guarda o prazo e a data da compra de cada venda: o reembolso de uma compra que
--    somou prazo refaz a conta so com as compras que sobraram.
-- 3. `all_formations_grants`: a venda de "acesso a todas as formacoes". Os acessos continuam em
--    entitlements (a unica verdade); esta tabela diz quem tem direito as formacoes que forem publicadas
--    depois, ate quando, de que venda veio e com que turma. O app transforma em entitlements na venda,
--    ao publicar uma formacao e, como rede de seguranca, na tarefa do tick.
-- 4. `admin_save_combo_v2`: grava o pacote, o item "todas as formacoes" e os itens com o prazo de cada
--    um, na mesma transacao. A funcao antiga (202610110012) continua existindo.
--
-- Nada aqui e lido pelo navegador: RLS ligado, nada para anon/authenticated, so service_role.
--
-- Verificacao manual depois de aplicar:
--   select combo_id, product_id, access_unit, access_amount from public.product_combo_items limit 20;
--   select id, name, all_formations, all_formations_unit, all_formations_amount from public.product_combos;
--   select provider, transaction_id, user_id, ends_at, status, cohort_name from public.all_formations_grants order by created_at desc limit 20;

/* ------------------------------------------------------------------------------------------------
 * 1. Prazo no item do pacote, no codigo de venda e no pacote ("todas as formacoes")
 * ---------------------------------------------------------------------------------------------- */

alter table public.product_combo_items
  add column if not exists access_unit text,
  add column if not exists access_amount integer;

alter table public.product_combo_items drop constraint if exists product_combo_items_access_term_check;
alter table public.product_combo_items
  add constraint product_combo_items_access_term_check check (
    (access_unit is null and access_amount is null)
    or (access_unit is not null and access_amount is not null and access_unit in ('days', 'months', 'years') and access_amount between 1 and 3650)
  );

comment on column public.product_combo_items.access_unit is
  'Prazo de acesso deste produto dentro do pacote: days, months ou years. Nulo (com access_amount nulo) = para sempre.';
comment on column public.product_combo_items.access_amount is
  'Quantidade do prazo (1 a 3650) na unidade de access_unit. O termino = data da compra aprovada + prazo.';

alter table public.sales_product_links
  add column if not exists access_unit text,
  add column if not exists access_amount integer;

alter table public.sales_product_links drop constraint if exists sales_product_links_access_term_check;
alter table public.sales_product_links
  add constraint sales_product_links_access_term_check check (
    (access_unit is null and access_amount is null)
    or (access_unit is not null and access_amount is not null and access_unit in ('days', 'months', 'years') and access_amount between 1 and 3650)
  );

comment on column public.sales_product_links.access_unit is
  'Prazo de acesso de quem compra o produto sozinho por este codigo: days, months ou years. Nulo = para sempre. Em codigo de pacote nao e usado (o prazo fica em cada item do pacote).';

alter table public.product_combos
  add column if not exists all_formations boolean not null default false,
  add column if not exists all_formations_unit text,
  add column if not exists all_formations_amount integer;

alter table public.product_combos drop constraint if exists product_combos_all_formations_term_check;
alter table public.product_combos
  add constraint product_combos_all_formations_term_check check (
    (all_formations_unit is null and all_formations_amount is null)
    or (
      all_formations
      and all_formations_unit is not null
      and all_formations_amount is not null
      and all_formations_unit in ('days', 'months', 'years')
      and all_formations_amount between 1 and 3650
    )
  );

comment on column public.product_combos.all_formations is
  'O pacote inclui o item especial "Todas as formacoes (as de hoje e as que vierem)". So produtos do tipo Formacao; mentorias e outros tipos nunca entram.';
comment on column public.product_combos.all_formations_unit is
  'Prazo do item "todas as formacoes": days, months ou years. Nulo (com all_formations_amount nulo) = para sempre.';

/* ------------------------------------------------------------------------------------------------
 * 2. O prazo que cada venda somou em cada acesso
 * ---------------------------------------------------------------------------------------------- */

alter table public.sale_grants
  add column if not exists term_unit text,
  add column if not exists term_amount integer,
  add column if not exists purchased_at timestamptz;

alter table public.sale_grants drop constraint if exists sale_grants_term_check;
alter table public.sale_grants
  add constraint sale_grants_term_check check (
    (term_unit is null and term_amount is null)
    or (term_unit is not null and term_amount is not null and term_unit in ('days', 'months', 'years') and term_amount between 1 and 3650)
  );

comment on column public.sale_grants.term_unit is
  'Prazo que esta venda deu neste acesso: days, months ou years. Nulo = para sempre (e o caso de toda venda anterior a 2026-11-28).';
comment on column public.sale_grants.purchased_at is
  'Data da compra aprovada, de onde o prazo conta. Nulo nas vendas anteriores a 2026-11-28 (vale created_at).';

/* ------------------------------------------------------------------------------------------------
 * 3. "Todas as formacoes": quem tem, ate quando, de que venda e com que turma
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.all_formations_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  transaction_id text not null,
  subscription_code text,
  webhook_event_id uuid references public.webhook_events(id) on delete set null,
  combo_id text references public.product_combos(id) on delete set null,
  cohort_name text,
  term_unit text,
  term_amount integer,
  purchased_at timestamptz not null,
  -- Ate quando o aluno recebe as formacoes novas (e o termino de cada formacao aberta por esta venda). Nulo = para sempre.
  ends_at timestamptz,
  status text not null default 'active',
  closed_at timestamptz,
  closed_by text,
  -- Formacoes que esta concessao ja transformou em acesso (entitlements + sale_grants).
  formation_ids text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint all_formations_grants_provider_known check (provider in ('hotmart', 'ticto', 'kiwify')),
  -- O mesmo limite de webhook_events.transaction_id e de sale_grants.transaction_id.
  constraint all_formations_grants_transaction_size check (char_length(transaction_id) between 1 and 200),
  constraint all_formations_grants_subscription_size check (subscription_code is null or char_length(subscription_code) between 1 and 120),
  constraint all_formations_grants_cohort_size check (cohort_name is null or char_length(cohort_name) between 1 and 80),
  constraint all_formations_grants_term_check check (
    (term_unit is null and term_amount is null)
    or (term_unit is not null and term_amount is not null and term_unit in ('days', 'months', 'years') and term_amount between 1 and 3650)
  ),
  constraint all_formations_grants_status_known check (status in ('active', 'closed')),
  constraint all_formations_grants_closed_pair check ((status = 'closed') = (closed_at is not null)),
  constraint all_formations_grants_closed_by_known check (
    closed_by is null or closed_by in ('refund', 'chargeback', 'subscription_canceled', 'admin')
  ),
  constraint all_formations_grants_formations_size check (
    cardinality(formation_ids) <= 500 and array_position(formation_ids, null) is null
  )
);

-- Uma concessao por (venda, aluno): o reenvio e o reprocesso da mesma compra nunca criam duas.
create unique index if not exists all_formations_grants_sale_idx
  on public.all_formations_grants (provider, transaction_id, user_id);
-- A publicacao de uma formacao e a tarefa do tick so olham as concessoes abertas.
create index if not exists all_formations_grants_active_idx
  on public.all_formations_grants (ends_at)
  where status = 'active';
create index if not exists all_formations_grants_user_idx on public.all_formations_grants (user_id);
create index if not exists all_formations_grants_subscription_idx
  on public.all_formations_grants (provider, subscription_code)
  where subscription_code is not null;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_all_formations_grants_updated_at' and tgrelid = 'public.all_formations_grants'::regclass
  ) then
    create trigger set_all_formations_grants_updated_at
      before update on public.all_formations_grants
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

comment on table public.all_formations_grants is
  'Venda de "acesso a todas as formacoes" (as de hoje e as que vierem), por aluno. Os acessos continuam em entitlements; esta tabela diz quem recebe as formacoes publicadas depois, ate quando, de que venda e com que turma. Escrita somente pelo servidor.';
comment on column public.all_formations_grants.transaction_id is
  'A compra na plataforma (a mesma de sale_grants.transaction_id): o reembolso e o chargeback dela fecham a concessao e os acessos que ela abriu.';
comment on column public.all_formations_grants.cohort_name is
  'A turma do pacote na hora da compra (ex.: Black 2026).';

alter table public.all_formations_grants enable row level security;
revoke all on public.all_formations_grants from anon, authenticated;
grant select, insert, update, delete on public.all_formations_grants to service_role;

/* ------------------------------------------------------------------------------------------------
 * 4. Salvar o pacote com o prazo de cada item e o item "todas as formacoes", numa transacao
 * ---------------------------------------------------------------------------------------------- */

-- p_items: [{ "productId": "curso-a", "unit": "years" | "months" | "days" | null, "amount": 1 | null }, ...]
create or replace function public.admin_save_combo_v2(
  p_combo_id text,
  p_create boolean,
  p_name text,
  p_description text,
  p_cohort_name text,
  p_status text,
  p_items jsonb,
  p_all_formations boolean default false,
  p_all_formations_unit text default null,
  p_all_formations_amount integer default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  items jsonb := coalesce(p_items, '[]'::jsonb);
  all_formations_value boolean := coalesce(p_all_formations, false);
begin
  if jsonb_typeof(items) is distinct from 'array' then
    raise exception 'combo_items_invalid';
  end if;

  if jsonb_array_length(items) = 0 and not all_formations_value then
    raise exception 'combo_items_invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(items) as wanted(item)
    left join public.content_items c on c.id = wanted.item->>'productId'
    where c.id is null or c.commerce_scope is distinct from 'sellable_product'
  ) then
    raise exception 'combo_product_unavailable';
  end if;

  if p_create then
    insert into public.product_combos (id, name, description, cohort_name, status, all_formations, all_formations_unit, all_formations_amount)
    values (
      p_combo_id,
      p_name,
      coalesce(p_description, ''),
      p_cohort_name,
      p_status,
      all_formations_value,
      case when all_formations_value then p_all_formations_unit end,
      case when all_formations_value then p_all_formations_amount end
    );
  else
    update public.product_combos
    set name = p_name,
        description = coalesce(p_description, ''),
        cohort_name = p_cohort_name,
        status = p_status,
        all_formations = all_formations_value,
        all_formations_unit = case when all_formations_value then p_all_formations_unit end,
        all_formations_amount = case when all_formations_value then p_all_formations_amount end
    where id = p_combo_id;

    if not found then
      raise exception 'combo_not_found';
    end if;
  end if;

  delete from public.product_combo_items where combo_id = p_combo_id;

  insert into public.product_combo_items (combo_id, product_id, sort_order, access_unit, access_amount)
  select
    p_combo_id,
    wanted.item->>'productId',
    (wanted.position - 1)::integer,
    nullif(wanted.item->>'unit', ''),
    nullif(wanted.item->>'amount', '')::integer
  from jsonb_array_elements(items) with ordinality as wanted(item, position);
end;
$$;

revoke all on function public.admin_save_combo_v2(text, boolean, text, text, text, text, jsonb, boolean, text, integer) from public, anon, authenticated;
grant execute on function public.admin_save_combo_v2(text, boolean, text, text, text, text, jsonb, boolean, text, integer) to service_role;
