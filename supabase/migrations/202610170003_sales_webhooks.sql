-- Vendas pelas plataformas (2026-10-17): Hotmart agora; Ticto e Kiwify depois, pelo mesmo caminho.
-- Decisao em docs/17 §1.10 (Configuracoes > Vendas) e fase 6; fluxo em docs/04, secao Webhooks externos.
--
-- Regras:
-- - a plataforma de venda e ENTRADA, nunca autorizacao: o webhook grava o evento bruto, o servidor
--   resolve o produto ou pacote interno e so entao libera ou tira o acesso por `entitlements`
--   (src/server/students/access.ts, a mesma rotina do admin);
-- - `integration_settings` guarda, por plataforma, a situacao e o segredo (token) que a plataforma manda
--   em cada pedido. O segredo fica so aqui e so o servidor (service_role) le; a tela do produtor recebe
--   apenas `secret_status` e `secret_updated_at`;
-- - `webhook_events` guarda o payload bruto de cada evento aceito (token conferido), unico por
--   (provider, external_event_id): o mesmo evento entregue duas vezes nao e processado duas vezes;
--   falha fica registrada com o motivo e pode ser reprocessada pela tela;
-- - `sales_product_links` liga o codigo do produto na plataforma a um produto ou a um pacote da escola
--   (um codigo -> um alvo; um alvo -> um codigo por plataforma). Venda de pacote libera todos os produtos
--   dele; reembolso ou chargeback de pacote tira todos (docs/17 §1.6.8);
-- - nada aqui e lido pelo navegador: RLS ligado, nada para anon/authenticated, so service_role.
--
-- Verificacao manual depois de aplicar:
--   select provider, status, secret_status, last_sync_at from public.integration_settings order by provider;
--   select provider, event_type, processing_status, outcome, received_at from public.webhook_events order by received_at desc limit 20;
--   select provider, external_product_id, product_id, combo_id from public.sales_product_links;

/* ------------------------------------------------------------------------------------------------
 * 1. Situacao e segredo de cada plataforma
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.integration_settings (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique check (provider in ('hotmart', 'ticto', 'kiwify')),
  status text not null default 'not_configured'
    check (status in ('not_configured', 'configured', 'needs_attention')),
  webhook_url text check (webhook_url is null or char_length(webhook_url) <= 2048),
  -- Token que a plataforma manda em cada pedido (Hotmart: hottok). So o servidor le.
  secret text check (secret is null or char_length(secret) between 16 and 200),
  secret_status text not null default 'missing' check (secret_status in ('missing', 'set')),
  secret_updated_at timestamptz,
  -- Eventos da plataforma que mudam acesso (lista de texto), para a tela mostrar o que marcar la.
  events jsonb not null default '[]'::jsonb
    check (jsonb_typeof(events) = 'array' and pg_column_size(events) <= 4096),
  last_sync_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_settings_secret_consistent check ((secret is null) = (secret_status = 'missing'))
);

drop trigger if exists set_integration_settings_updated_at on public.integration_settings;
create trigger set_integration_settings_updated_at
  before update on public.integration_settings
  for each row execute function public.set_updated_at();

alter table public.integration_settings enable row level security;
revoke all on public.integration_settings from anon, authenticated;
grant select, insert, update, delete on public.integration_settings to service_role;

comment on table public.integration_settings is
  'Plataformas de venda (Hotmart, Ticto, Kiwify): situacao, token do webhook (so o servidor le) e ultimo evento. Escrita somente pelo servidor.';
comment on column public.integration_settings.secret is
  'Token que a plataforma envia em cada webhook. Nunca devolvido para a tela: so secret_status e secret_updated_at.';

-- Uma linha por plataforma desde o inicio: a tela mostra as tres, e "Em configuracao" e regra da tela.
insert into public.integration_settings (provider)
values ('hotmart'), ('ticto'), ('kiwify')
on conflict (provider) do nothing;

/* ------------------------------------------------------------------------------------------------
 * 2. Eventos recebidos (payload bruto, idempotencia e resultado)
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('hotmart', 'ticto', 'kiwify')),
  external_event_id text not null check (char_length(external_event_id) between 1 and 200),
  event_type text not null check (char_length(event_type) between 1 and 80),
  normalized_type text
    check (normalized_type is null or normalized_type in ('purchase_approved', 'refund', 'chargeback', 'subscription_canceled', 'other')),
  payload jsonb not null check (pg_column_size(payload) <= 524288),
  signature_valid boolean not null default false,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processed', 'failed', 'ignored')),
  outcome text
    check (outcome is null or outcome in ('access_granted', 'access_revoked', 'access_suspended', 'ignored', 'failed')),
  outcome_detail text check (outcome_detail is null or char_length(outcome_detail) <= 500),
  buyer_email text check (buyer_email is null or char_length(buyer_email) <= 320),
  external_product_id text check (external_product_id is null or char_length(external_product_id) <= 120),
  external_product_name text check (external_product_name is null or char_length(external_product_name) <= 200),
  -- Alvo resolvido na hora do processamento (sem chave estrangeira: o historico fica mesmo se o produto sair).
  product_id text check (product_id is null or char_length(product_id) <= 240),
  combo_id text check (combo_id is null or char_length(combo_id) <= 240),
  user_id uuid references auth.users(id) on delete set null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text check (error_message is null or char_length(error_message) <= 2000)
);

create unique index if not exists webhook_events_provider_event_idx
  on public.webhook_events (provider, external_event_id);
create index if not exists webhook_events_received_idx on public.webhook_events (provider, received_at desc);
create index if not exists webhook_events_user_idx on public.webhook_events (user_id) where user_id is not null;

alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from anon, authenticated;
grant select, insert, update on public.webhook_events to service_role;

comment on table public.webhook_events is
  'Eventos brutos das plataformas de venda, unicos por provider + external_event_id, com o resultado do processamento. Escrita somente pelo servidor.';

/* ------------------------------------------------------------------------------------------------
 * 3. Codigo do produto na plataforma -> produto ou pacote da escola
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.sales_product_links (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('hotmart', 'ticto', 'kiwify')),
  external_product_id text not null check (char_length(external_product_id) between 1 and 120),
  product_id text references public.content_items(id) on delete cascade,
  combo_id text references public.product_combos(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_product_links_one_target check ((product_id is null) <> (combo_id is null))
);

-- Um codigo da plataforma aponta para um alvo so; cada alvo tem um codigo por plataforma. Os indices de
-- alvo nao sao parciais de proposito: nulos nao conflitam entre si, e o upsert do servidor
-- (on conflict (provider, product_id) / (provider, combo_id)) precisa de um indice inteiro.
create unique index if not exists sales_product_links_external_idx
  on public.sales_product_links (provider, external_product_id);
create unique index if not exists sales_product_links_product_idx
  on public.sales_product_links (provider, product_id);
create unique index if not exists sales_product_links_combo_idx
  on public.sales_product_links (provider, combo_id);

drop trigger if exists set_sales_product_links_updated_at on public.sales_product_links;
create trigger set_sales_product_links_updated_at
  before update on public.sales_product_links
  for each row execute function public.set_updated_at();

alter table public.sales_product_links enable row level security;
revoke all on public.sales_product_links from anon, authenticated;
grant select, insert, update, delete on public.sales_product_links to service_role;

comment on table public.sales_product_links is
  'Codigo do produto na plataforma de venda ligado a um produto (content_items) ou a um pacote (product_combos). Escrita somente pelo servidor.';

/* ------------------------------------------------------------------------------------------------
 * 4. Hoje > Novos acessos: de onde vieram os acessos do periodo (Hotmart, equipe...)
 *    Mesmas regras de admin_access_buckets (202610120001): janela [p_start, p_end), sem a equipe,
 *    com produto escolhido so os acessos daquele produto.
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.admin_access_origins(
  p_start timestamptz,
  p_end timestamptz,
  p_content_id text default null
)
returns table (source_provider text, total bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'invalid_window' using errcode = '22023';
  end if;

  if p_end - p_start > interval '370 days' then
    raise exception 'window_too_long' using errcode = '22023';
  end if;

  return query
  select
    coalesce(e.source_provider, 'manual') as source_provider,
    count(*)::bigint as total
  from public.entitlements e
  where e.created_at >= p_start
    and e.created_at < p_end
    and (p_content_id is null or e.target_id = p_content_id)
    and not exists (select 1 from public.admin_roles staff where staff.user_id = e.user_id)
  group by 1
  order by 2 desc, 1;
end;
$$;

comment on function public.admin_access_origins(timestamptz, timestamptz, text) is
  'Hoje do admin: acessos criados em [p_start, p_end) por origem (hotmart, manual...), sem a equipe.';

revoke all on function public.admin_access_origins(timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.admin_access_origins(timestamptz, timestamptz, text) to service_role;
