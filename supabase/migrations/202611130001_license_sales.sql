-- Bunker Members, a venda que vira Licenca (docs/32 §2.4, §11.2 "API interna" e §11.10). As migracoes ate a
-- 202611120001 (ja aplicadas) nao mudam.
--
-- Por que: a nossa escola vende o Bunker Members pela Hotmart e pela Ticto como qualquer curso, e o acesso continua
-- nascendo pela regra de sempre (src/server/payments/process-sale.ts). Agora, alem do acesso, a venda paga de um produto
-- marcado como Bunker Members vira um pedido ao Emissor (POST /interno/v1/vendas), e o reembolso, o chargeback e o
-- cancelamento viram o desfazer (POST /interno/v1/vendas/desfazer). Com o Emissor fora do ar, nada se perde: o pedido
-- fica numa fila daqui, reenviado pela tarefa do tick `licencas-vendas`, na ordem em que chegou.
-- - license_products: os produtos do catalogo marcados como Bunker Members (Produtos > Acesso e venda, so o dono). So o
--   id do produto: o que cada codigo da plataforma e (Licenca anual, vitalicia, Ano adicional, modulo) fica no Emissor
--   (docs/32 §11.10), nunca aqui;
-- - license_requests: a fila dos pedidos ao Emissor, uma linha por pedido (request_key unico: a mesma venda nunca entra
--   duas vezes, nem o mesmo desfazer). Nenhum dado pessoal: o comprador e a conta (user_id), lida na hora de enviar; a
--   venda fica em webhook_events, que a retencao de 12 meses e a exclusao do aluno ja anonimizam. A Chave de ativacao
--   nunca passa por aqui nem por tabela nenhuma: ela vai do Emissor a tela do comprador, uma vez;
-- - no produto vendido (a copia do comprador) as duas ficam vazias para sempre: sem o endereco e a credencial da API
--   interna do Emissor (so a nossa escola tem), o app nunca le nem grava nelas.
-- RLS ligado e sem politica: so service_role le e grava; nada para anon/authenticated. Nada de drop, delete, politica,
-- funcao nova ou Storage; o gatilho usa a funcao que ja existe public.set_updated_at() (202606150001).
--
-- Verificacao manual depois de aplicar:
--   select relrowsecurity from pg_class where oid in ('public.license_products'::regclass, 'public.license_requests'::regclass); -- true, true
--   select count(*) from pg_policies where schemaname = 'public' and tablename in ('license_products', 'license_requests'); -- 0
--   select has_table_privilege('authenticated', 'public.license_requests', 'select'),
--     has_table_privilege('anon', 'public.license_products', 'select'); -- false, false
--   select indexname from pg_indexes where tablename = 'license_requests' order by 1; -- 5 linhas, com a chave primaria
--   select status, count(*) from public.license_requests group by status; -- vazia ate a primeira venda marcada
--
-- Idempotente: pode ser executada mais de uma vez sem efeito colateral.

/* ------------------------------------------------------------------------------------------------
 * 1. Os produtos marcados como Bunker Members (so o servidor le e grava). MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.license_products (
  product_id text primary key references public.content_items(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.license_products is
  'Produtos marcados como Bunker Members (docs/32 §11.10): a venda paga de um deles vira um pedido de Licenca ao Emissor (license_requests). So a nossa escola grava; no produto vendido fica vazia.';

alter table public.license_products enable row level security;
revoke all on public.license_products from anon, authenticated;
grant select, insert, update, delete on public.license_products to service_role;

/* ------------------------------------------------------------------------------------------------
 * 2. A fila dos pedidos ao Emissor (so o servidor le e grava). MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.license_requests (
  id uuid primary key default gen_random_uuid(),
  request_key text not null,
  kind text not null,
  provider text not null,
  transaction_id text not null,
  external_product_id text not null,
  subscription_code text,
  reason text,
  user_id uuid references auth.users(id) on delete set null,
  webhook_event_id uuid references public.webhook_events(id) on delete set null,
  purchased_at timestamptz,
  warranty_ends_at timestamptz,
  occurred_at timestamptz,
  status text not null default 'pendente',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  maybe_delivered boolean not null default false,
  last_error_code text,
  last_error text,
  sent_at timestamptz,
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint license_requests_key_size check (char_length(request_key) between 1 and 400),
  constraint license_requests_kind_known check (kind in ('venda', 'desfazer')),
  constraint license_requests_provider_known check (provider in ('hotmart', 'ticto', 'kiwify')),
  -- Os mesmos limites de webhook_events.transaction_id e de sales_product_links.external_product_id.
  constraint license_requests_transaction_size check (char_length(transaction_id) between 1 and 200),
  constraint license_requests_product_size check (char_length(external_product_id) between 1 and 120),
  constraint license_requests_subscription_size check (subscription_code is null or char_length(subscription_code) between 1 and 120),
  -- A venda nao tem motivo; o desfazer tem um dos tres do contrato (o "is not null" fecha o desfazer sem motivo, que o
  -- "in" sozinho deixaria passar como nulo).
  constraint license_requests_reason_pair check (
    (kind = 'venda' and reason is null)
    or (kind = 'desfazer' and reason is not null and reason in ('reembolso', 'chargeback', 'cancelamento'))
  ),
  constraint license_requests_status_known check (status in ('pendente', 'enviando', 'enviado', 'dispensado')),
  -- Enviado tem a data; enviando tem a reivindicacao da rodada.
  constraint license_requests_sent_pair check ((status = 'enviado') = (sent_at is not null)),
  constraint license_requests_claim_pair check (status <> 'enviando' or claimed_at is not null),
  constraint license_requests_attempts_positive check (attempts >= 0),
  -- O codigo do erro do Emissor ou do cliente (produto_desconhecido, sem_resposta...): o app traduz.
  constraint license_requests_error_code_format check (last_error_code is null or last_error_code ~ '^[a-z_]{1,40}$'),
  constraint license_requests_error_size check (last_error is null or char_length(last_error) <= 500),
  constraint license_requests_resolution_size check (resolution is null or char_length(resolution) <= 500)
);

-- Um pedido por venda e um desfazer por motivo: o reenvio da plataforma e o Reprocessar nunca pedem duas vezes.
create unique index if not exists license_requests_key_idx on public.license_requests (request_key);
-- A tarefa do tick so olha o que falta enviar, na ordem da proxima tentativa.
create index if not exists license_requests_pending_idx
  on public.license_requests (next_attempt_at, created_at)
  where status in ('pendente', 'enviando');
-- O reembolso, o chargeback e o cancelamento acham a venda pela compra ou pela assinatura.
create index if not exists license_requests_transaction_idx on public.license_requests (provider, transaction_id);
create index if not exists license_requests_subscription_idx
  on public.license_requests (provider, subscription_code)
  where subscription_code is not null;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_license_requests_updated_at' and tgrelid = 'public.license_requests'::regclass
  ) then
    create trigger set_license_requests_updated_at
      before update on public.license_requests
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

comment on table public.license_requests is
  'Pedidos ao Emissor da venda e do desfazer do Bunker Members (docs/32 §11.10): enviados pela tarefa licencas-vendas do tick, em ordem, com novas tentativas. Sem dado pessoal; escrita somente pelo servidor.';
comment on column public.license_requests.request_key is 'venda:<plataforma>:<transacao>:<produto> ou desfazer:<motivo>:<plataforma>:<transacao>:<produto>.';
comment on column public.license_requests.user_id is 'A conta do comprador na nossa area (areaUserId no Emissor); o e-mail e o nome sao lidos na hora de enviar.';
comment on column public.license_requests.maybe_delivered is 'Alguma tentativa pode ter chegado ao Emissor (sem resposta, erro do lado dele): o desfazer espera a venda, nunca a dispensa.';
comment on column public.license_requests.resolution is 'O que aconteceu, em portugues, para a lista de Configuracoes > Vendas.';

alter table public.license_requests enable row level security;
revoke all on public.license_requests from anon, authenticated;
grant select, insert, update, delete on public.license_requests to service_role;
