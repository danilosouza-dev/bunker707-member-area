-- Vendas pelas plataformas, vinculo venda -> acesso (2026-10-17, conferencia da revisao da PR #85).
-- A 202610170003 e a 202610170005 nao mudam; este arquivo so acrescenta.
--
-- Por que: um acesso (entitlements, um por aluno e produto) pode ser sustentado por mais de uma venda
-- (produto comprado sozinho e depois num pacote; cada cobranca de uma assinatura chega como compra
-- nova) ou ter nascido da equipe e so ganhado prazo numa venda. `source_event_id` guarda uma origem
-- so; sem o vinculo, o reembolso de uma venda ou tirava acesso que outra compra paga sustenta, ou nao
-- tirava o acesso de uma renovacao, ou deixava um prazo da equipe virar vitalicio para sempre.
--
-- `sale_grants`: uma linha por (venda, acesso). `opened` diz se a venda abriu o acesso (nao existia ou
-- estava fechado) ou so estendeu um acesso aberto; `previous_ends_at` guarda o prazo que o acesso tinha
-- antes, para o reembolso devolver; `subscription_code` liga as cobrancas de uma mesma assinatura
-- (Hotmart: subscriber.code), que nao se sustentam entre si. Reembolso, chargeback e assinatura
-- cancelada fecham o vinculo (`closed_at`, `closed_by`) e so entao decidem o acesso
-- (src/server/payments/process-sale.ts). Nenhum dado pessoal: so ids.
--
-- Verificacao manual depois de aplicar:
--   select provider, transaction_id, opened, closed_by from public.sale_grants order by created_at desc limit 20;

create table if not exists public.sale_grants (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('hotmart', 'ticto', 'kiwify')),
  transaction_id text not null check (char_length(transaction_id) between 1 and 200),
  subscription_code text check (subscription_code is null or char_length(subscription_code) <= 120),
  user_id uuid not null references auth.users(id) on delete cascade,
  entitlement_id uuid not null references public.entitlements(id) on delete cascade,
  product_id text not null check (char_length(product_id) <= 240),
  -- true: a venda abriu o acesso (nao existia ou estava fechado); false: so estendeu um acesso aberto.
  opened boolean not null,
  -- Prazo que o acesso tinha antes desta venda (so quando estendeu): o reembolso devolve.
  previous_ends_at timestamptz,
  webhook_event_id uuid references public.webhook_events(id) on delete set null,
  closed_at timestamptz,
  -- admin: a equipe revogou, suspendeu, reativou ou reabriu o acesso; as vendas de antes (abertas ou ja
  -- fechadas por reembolso) deixam de mandar nele.
  closed_by text check (closed_by is null or closed_by in ('refund', 'chargeback', 'subscription_canceled', 'admin')),
  created_at timestamptz not null default now()
);

create unique index if not exists sale_grants_sale_entitlement_idx
  on public.sale_grants (provider, transaction_id, entitlement_id);
create index if not exists sale_grants_entitlement_idx on public.sale_grants (entitlement_id);
create index if not exists sale_grants_subscription_idx
  on public.sale_grants (provider, subscription_code)
  where subscription_code is not null;

alter table public.sale_grants enable row level security;
revoke all on public.sale_grants from anon, authenticated;
grant select, insert, update, delete on public.sale_grants to service_role;

-- Resultado novo em webhook_events: o reembolso de uma venda que so tinha estendido um acesso de outra
-- origem devolve o prazo anterior em vez de revogar.
alter table public.webhook_events drop constraint if exists webhook_events_outcome_check;
alter table public.webhook_events
  add constraint webhook_events_outcome_check
  check (outcome is null or outcome in ('access_granted', 'access_revoked', 'access_suspended', 'access_restored', 'ignored', 'failed'));

-- Acessos abertos por venda antes desta tabela (se houver): um vinculo por (compra aprovada, acesso),
-- com o codigo da assinatura lido do payload guardado. Precisa de webhook_events.transaction_id (0005).
insert into public.sale_grants (provider, transaction_id, subscription_code, user_id, entitlement_id, product_id, opened, webhook_event_id)
select distinct on (w.provider, w.transaction_id, e.id)
       w.provider,
       w.transaction_id,
       left(nullif(btrim(w.payload #>> '{data,subscription,subscriber,code}'), ''), 120),
       e.user_id,
       e.id,
       e.target_id,
       true,
       w.id
  from public.webhook_events w
  join public.entitlements e
    on e.user_id = w.user_id
   and e.source_provider = w.provider
   and (e.source_event_id = w.transaction_id or starts_with(e.source_event_id, w.transaction_id || ':'))
 where w.normalized_type = 'purchase_approved'
   and w.outcome = 'access_granted'
   and w.transaction_id is not null
   and e.status = 'active'
 order by w.provider, w.transaction_id, e.id, w.received_at
on conflict (provider, transaction_id, entitlement_id) do nothing;

comment on table public.sale_grants is
  'Vinculo venda -> acesso: que compra (ou cobranca de assinatura) abriu ou estendeu cada entitlement. Reembolso, chargeback e cancelamento fecham o vinculo antes de mexer no acesso. Escrita somente pelo servidor.';
