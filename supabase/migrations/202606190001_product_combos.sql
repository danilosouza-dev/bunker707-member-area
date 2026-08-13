create table if not exists public.product_combos (
  id text primary key,
  name text not null,
  description text not null default '',
  cohort_name text not null default 'Turma A',
  status text not null default 'draft' check (status in ('active', 'draft', 'paused')),
  students_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_combo_items (
  combo_id text not null references public.product_combos(id) on delete cascade,
  product_id text not null references public.content_items(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (combo_id, product_id)
);

create index if not exists product_combo_items_product_id_idx
  on public.product_combo_items(product_id);

alter table public.product_combos enable row level security;
alter table public.product_combo_items enable row level security;

drop trigger if exists set_product_combos_updated_at on public.product_combos;
create trigger set_product_combos_updated_at
  before update on public.product_combos
  for each row execute function public.set_updated_at();
