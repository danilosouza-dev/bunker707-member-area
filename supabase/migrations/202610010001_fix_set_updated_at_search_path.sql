-- Pin the search_path of the shared updated_at trigger function so it
-- cannot be hijacked by objects in a caller-controlled schema.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
