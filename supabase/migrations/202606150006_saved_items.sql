create table if not exists public.saved_items (
  id text primary key,
  user_id text not null,
  target_type text not null check (
    target_type in (
      'formation',
      'standalone_course',
      'mentorship',
      'webinar',
      'product',
      'bootcamp',
      'module',
      'lesson',
      'material'
    )
  ),
  target_id text not null,
  collection_label text not null default 'favoritos',
  created_at timestamptz not null default now(),
  unique (user_id, target_type, target_id, collection_label)
);

create index if not exists saved_items_user_collection_idx
  on public.saved_items (user_id, collection_label, created_at desc);

create index if not exists saved_items_target_idx
  on public.saved_items (target_type, target_id);

alter table public.saved_items enable row level security;

drop policy if exists "Students can read own saved items" on public.saved_items;
create policy "Students can read own saved items"
  on public.saved_items for select
  to authenticated
  using (auth.uid()::text = user_id);

drop policy if exists "Students can create own saved items" on public.saved_items;
create policy "Students can create own saved items"
  on public.saved_items for insert
  to authenticated
  with check (auth.uid()::text = user_id);

drop policy if exists "Students can delete own saved items" on public.saved_items;
create policy "Students can delete own saved items"
  on public.saved_items for delete
  to authenticated
  using (auth.uid()::text = user_id);
