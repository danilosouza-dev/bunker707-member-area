-- Garante idempotencia da sincronizacao CRM -> entitlements no banco:
-- remove duplicatas existentes (mantem a linha mais recente) e cria indice unico
-- em (user_id, source_event_id), permitindo upsert on conflict no lugar de
-- select-then-insert sujeito a corrida. Linhas com source_event_id nulo nao
-- conflitam entre si (NULLS DISTINCT, padrao do Postgres).

delete from public.entitlements older
using public.entitlements newer
where older.user_id = newer.user_id
  and older.source_event_id is not null
  and older.source_event_id = newer.source_event_id
  and older.ctid < newer.ctid;

create unique index if not exists entitlements_user_source_event_key
  on public.entitlements (user_id, source_event_id);
