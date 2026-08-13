create table if not exists public.home_sections (
  id text primary key,
  title text not null,
  subtitle text,
  order_index integer not null,
  section_type text not null check (section_type in ('continue_watching', 'content_carousel', 'content_structure')),
  content_source text not null check (content_source in ('recent_lessons', 'entitlement_products', 'sellable_products', 'upcoming_products', 'manual', 'selected_content_structure')),
  source_content_id text references public.content_items(id) on delete set null,
  layout text not null check (layout in ('continue', 'vertical', 'compact', 'immersive')),
  visibility text not null check (visibility in ('students', 'non_students', 'all')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.home_section_items (
  section_id text not null references public.home_sections(id) on delete cascade,
  content_id text not null references public.content_items(id) on delete cascade,
  order_index integer not null,
  primary key (section_id, content_id)
);

create unique index if not exists home_sections_order_index_key on public.home_sections(order_index);
create unique index if not exists home_section_items_order_key on public.home_section_items(section_id, order_index);

alter table public.home_sections enable row level security;
alter table public.home_section_items enable row level security;

revoke all on public.home_sections from anon, authenticated;
revoke all on public.home_section_items from anon, authenticated;
