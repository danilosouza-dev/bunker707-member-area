alter table public.content_items
  add column if not exists access_model text,
  add column if not exists max_students integer,
  add column if not exists purchase_url text,
  add column if not exists purchase_target text;

alter table public.course_modules
  add column if not exists owner_id text references public.content_items(id) on delete cascade,
  add column if not exists owner_kind text;

create index if not exists course_modules_owner_id_idx
  on public.course_modules(owner_id);

alter table public.entitlements
  drop constraint if exists entitlements_target_type_check;

alter table public.entitlements
  add constraint entitlements_target_type_check
  check (
    target_type in ('platform', 'formation', 'standalone_course', 'mentorship', 'webinar', 'product', 'bootcamp')
  );
