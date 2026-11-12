-- Produto licenciado, a venda guardada (docs/32 §2.2 e §11.3, "Onde o congelamento barra" e "Venda guardada"). As
-- migracoes ate a 202611110001 (ja aplicadas) nao mudam.
--
-- Por que: na Escola congelada, na copia nunca ativada, no Aviso de endereco diferente ou de licenca ilegivel e quando a
-- licenca nao pode ser lida, ninguem ganha acesso novo. A matricula pelo admin ja parava pela classe de acao; a venda que
-- chegava pelo webhook (ou pelo Reprocessar) ainda dava acesso novo. Agora ela fica guardada:
-- - held_sales: uma linha por venda guardada (o evento de compra em webhook_events, unico), com os produtos que ficaram
--   sem acesso (os que a pessoa ja tinha renovam na hora e nao entram aqui), o motivo (o codigo da situacao da licenca na
--   hora) e a situacao: guardada (held), liberada (granted) ou descartada (discarded: reembolso, chargeback ou assinatura
--   cancelada antes da liberacao, ou o que a liberacao nao pode fazer). Nenhum dado pessoal: o comprador fica no evento
--   (webhook_events), que a retencao de 12 meses e a exclusao do aluno ja anonimizam;
-- - a tarefa do tick `vendas-guardadas` (src/server/jobs/held-sales-job.ts) libera as guardadas, em ordem (held_at, id),
--   quando a licenca volta a permitir a matricula: reivindica a linha (claimed_at, update condicional), roda a regra de
--   acesso de sempre (src/server/payments/process-sale.ts) e grava o resultado so com a reivindicacao dela. Duas rodadas
--   ao mesmo tempo nunca liberam a mesma venda duas vezes;
-- - webhook_events.outcome ganha 'held' (a lista Vendas recebidas mostra "Venda guardada"); o check e trocado pelo mesmo
--   com o valor novo, como na 202610170008. A versao anterior do app nunca grava 'held' e le o valor desconhecido como
--   sem resultado;
-- - no modo "off" (a nossa escola hoje, a dev, a Vercel e os testes) o app nunca le nem grava held_sales.
-- RLS ligado e sem politica: so service_role le e grava; nada para anon/authenticated. Nada de delete, politica,
-- funcao nova ou Storage; o gatilho usa a funcao que ja existe public.set_updated_at() (202606150001).
--
-- Verificacao manual depois de aplicar:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'webhook_events_outcome_check'; -- com 'held'
--   select relrowsecurity from pg_class where oid = 'public.held_sales'::regclass; -- true
--   select count(*) from pg_policies where schemaname = 'public' and tablename = 'held_sales'; -- 0
--   select has_table_privilege('anon', 'public.held_sales', 'select'),
--     has_table_privilege('authenticated', 'public.held_sales', 'select'); -- false, false
--   select indexname from pg_indexes where tablename = 'held_sales' order by 1; -- 5 linhas, com a chave primaria
--   select status, count(*) from public.held_sales group by status; -- nenhuma linha no modo "off"
--
-- Idempotente: pode ser executada mais de uma vez sem efeito colateral.

/* ------------------------------------------------------------------------------------------------
 * 1. O resultado "venda guardada" na lista de vendas. MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webhook_events drop constraint if exists webhook_events_outcome_check;
alter table public.webhook_events
  add constraint webhook_events_outcome_check
  check (outcome is null or outcome in ('access_granted', 'access_revoked', 'access_suspended', 'access_restored', 'held', 'ignored', 'failed'));

/* ------------------------------------------------------------------------------------------------
 * 2. As vendas guardadas (so o servidor le e grava). MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.held_sales (
  id uuid primary key default gen_random_uuid(),
  webhook_event_id uuid not null references public.webhook_events(id) on delete cascade,
  provider text not null,
  transaction_id text not null,
  subscription_code text,
  product_ids text[] not null,
  reason text not null,
  status text not null default 'held',
  held_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint held_sales_provider_known check (provider in ('hotmart', 'ticto', 'kiwify')),
  -- O mesmo limite de webhook_events.transaction_id e de sale_grants.transaction_id.
  constraint held_sales_transaction_size check (char_length(transaction_id) between 1 and 200),
  constraint held_sales_subscription_size check (subscription_code is null or char_length(subscription_code) between 1 and 120),
  -- Os produtos que ficaram sem acesso: ao menos um, sem nulo, e o teto de um pedido com pacote e vendidos junto.
  constraint held_sales_products_size check (cardinality(product_ids) between 1 and 64 and array_position(product_ids, null) is null),
  -- O codigo do motivo (escola_congelada, nao_ativada, endereco_diferente...): o app traduz; codigo novo nao pede migracao.
  constraint held_sales_reason_format check (reason ~ '^[a-z_]{1,40}$'),
  constraint held_sales_status_known check (status in ('held', 'granted', 'discarded')),
  -- Guardada nao tem resolucao; liberada ou descartada tem a data.
  constraint held_sales_resolved_pair check ((status = 'held') = (resolved_at is null)),
  constraint held_sales_attempts_positive check (attempts >= 0),
  constraint held_sales_last_error_size check (last_error is null or char_length(last_error) <= 2000),
  constraint held_sales_resolution_size check (resolution is null or char_length(resolution) <= 500)
);

-- Uma venda guardada por evento de compra: o reenvio e o reprocesso do mesmo evento nunca guardam duas vezes.
create unique index if not exists held_sales_webhook_event_idx on public.held_sales (webhook_event_id);
-- A tarefa do tick e a faixa so olham as guardadas, na ordem em que chegaram.
create index if not exists held_sales_pending_idx on public.held_sales (held_at, id) where status = 'held';
-- O reembolso, o chargeback e o cancelamento acham a venda guardada pela compra ou pela assinatura.
create index if not exists held_sales_transaction_idx on public.held_sales (provider, transaction_id);
create index if not exists held_sales_subscription_idx
  on public.held_sales (provider, subscription_code)
  where subscription_code is not null;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_held_sales_updated_at' and tgrelid = 'public.held_sales'::regclass
  ) then
    create trigger set_held_sales_updated_at
      before update on public.held_sales
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

comment on table public.held_sales is
  'Vendas guardadas (produto licenciado, docs/32 §2.2): a compra que chegou quando a licenca nao permitia acesso novo. Liberada pela tarefa vendas-guardadas do tick, em ordem, quando a licenca volta a permitir. Escrita somente pelo servidor; no modo off o app nunca a toca.';
comment on column public.held_sales.webhook_event_id is 'O evento de compra guardado (webhook_events): o comprador e o payload ficam la.';
comment on column public.held_sales.product_ids is 'Os produtos da escola que ficaram sem acesso (os que a pessoa ja tinha foram renovados na hora).';
comment on column public.held_sales.reason is 'O codigo da situacao da licenca na hora: escola_congelada, nao_ativada, endereco_diferente, licenca_ilegivel ou leitura_falhou.';
comment on column public.held_sales.claimed_at is 'A reivindicacao da rodada do tick que esta liberando a venda (update condicional); mais velha que alguns minutos, outra rodada a retoma.';
comment on column public.held_sales.resolution is 'O que aconteceu na liberacao ou no descarte, em portugues, para a lista do admin.';

alter table public.held_sales enable row level security;
revoke all on public.held_sales from anon, authenticated;
grant select, insert, update, delete on public.held_sales to service_role;
