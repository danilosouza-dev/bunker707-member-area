-- Vendas pelas plataformas, ajuste pos-revisao (2026-10-17): duas colunas em webhook_events.
-- A 202610170003 esta congelada (aplicada em producao); este arquivo so acrescenta.
--
-- - transaction_id: id da compra na plataforma (Hotmart: purchase.transaction), estavel entre os eventos
--   da mesma venda. Serve para a regra "compra que ja tem reembolso ou chargeback registrado nao libera
--   acesso" (reprocesso ou reenvio fora de ordem) sem depender do formato do payload;
-- - processing_started_at: quando o processamento comecou. Um evento preso em `received` (a funcao
--   estourou o tempo depois de gravar) pode ser reivindicado pelo reenvio da plataforma ou pelo botao
--   Reprocessar; o update condicional nessa coluna impede dois processamentos ao mesmo tempo.
--
-- Verificacao manual depois de aplicar:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'webhook_events'
--      and column_name in ('transaction_id', 'processing_started_at');

alter table public.webhook_events
  add column if not exists transaction_id text
    check (transaction_id is null or char_length(transaction_id) <= 200);

alter table public.webhook_events
  add column if not exists processing_started_at timestamptz;

create index if not exists webhook_events_transaction_idx
  on public.webhook_events (provider, transaction_id)
  where transaction_id is not null;

-- Eventos gravados antes desta coluna (se houver): a compra fica no payload guardado.
update public.webhook_events
   set transaction_id = left(btrim(payload #>> '{data,purchase,transaction}'), 200)
 where provider = 'hotmart'
   and transaction_id is null
   and nullif(btrim(payload #>> '{data,purchase,transaction}'), '') is not null;

comment on column public.webhook_events.transaction_id is
  'Id da compra na plataforma (Hotmart: purchase.transaction), igual em todos os eventos da mesma venda.';
comment on column public.webhook_events.processing_started_at is
  'Inicio do processamento (ou do reprocesso). Evento em received com esta data antiga pode ser reivindicado de novo.';
