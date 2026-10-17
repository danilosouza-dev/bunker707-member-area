-- E-mail transacional (2026-10-17): fila `email_outbox` e registro bruto dos webhooks do provedor.
-- Decisao em docs/19 §2 (Resend agora, Amazon SES na segunda rodada); fluxo em docs/04, secao E-mail.
--
-- Regras:
-- - quem dispara (venda por webhook, Adicionar aluno, importacao) so enfileira; o job `email-outbox`
--   do tick de minuto (src/server/jobs) envia respeitando o limite diario (EMAIL_DAILY_LIMIT, padrao
--   90, abaixo dos 100/dia do Resend Free), com retentativa e chave de idempotencia por linha;
-- - nada aqui e lido pelo navegador: RLS ligado, nada para anon/authenticated e so o servidor
--   (service_role) le e grava;
-- - `email_webhook_events` guarda o payload bruto de cada evento recebido (auditoria e reprocesso),
--   unico por (provider, event_id): o mesmo evento entregue duas vezes nao e aplicado duas vezes.
--
-- Verificacao manual depois de aplicar:
--   select status, count(*) from public.email_outbox group by status;
--   select event_type, received_at from public.email_webhook_events order by received_at desc limit 10;

/* ------------------------------------------------------------------------------------------------
 * 1. Fila de saida
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (char_length(kind) between 2 and 40),
  user_id uuid references auth.users(id) on delete set null,
  to_email text not null check (char_length(to_email) between 3 and 320),
  subject text not null check (char_length(subject) between 1 and 300),
  html text not null check (char_length(html) <= 200000),
  text text check (text is null or char_length(text) <= 100000),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 256),
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'bounced', 'complained')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text check (last_error is null or char_length(last_error) <= 2000),
  provider text check (provider is null or char_length(provider) <= 40),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 120),
  sent_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists email_outbox_idempotency_key_idx on public.email_outbox (idempotency_key);

-- O job busca o que esta vencido na fila; o restante das linhas (enviadas, falhas) fica fora do indice.
create index if not exists email_outbox_due_idx
  on public.email_outbox (next_attempt_at)
  where status in ('queued', 'sending');

-- Contagem do dia (limite diario) e procura pelo id do provedor (webhooks).
create index if not exists email_outbox_sent_at_idx on public.email_outbox (sent_at) where sent_at is not null;
create index if not exists email_outbox_provider_message_idx
  on public.email_outbox (provider_message_id)
  where provider_message_id is not null;
create index if not exists email_outbox_user_idx on public.email_outbox (user_id, created_at desc);

drop trigger if exists set_email_outbox_updated_at on public.email_outbox;
create trigger set_email_outbox_updated_at
  before update on public.email_outbox
  for each row execute function public.set_updated_at();

alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;
grant select, insert, update, delete on public.email_outbox to service_role;

comment on table public.email_outbox is
  'Fila de e-mails transacionais (boas-vindas, compra). Quem dispara enfileira; o job email-outbox do tick envia pelo provedor (Resend). Escrita somente pelo servidor.';

/* ------------------------------------------------------------------------------------------------
 * 2. Eventos recebidos do provedor (webhook assinado): payload bruto para auditoria e reprocesso.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.email_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'resend' check (char_length(provider) between 2 and 40),
  event_id text not null check (char_length(event_id) between 1 and 200),
  event_type text not null check (char_length(event_type) between 1 and 60),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 120),
  payload jsonb not null check (pg_column_size(payload) <= 65536),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  outbox_id uuid references public.email_outbox(id) on delete set null,
  error text check (error is null or char_length(error) <= 2000)
);

create unique index if not exists email_webhook_events_provider_event_idx
  on public.email_webhook_events (provider, event_id);
create index if not exists email_webhook_events_received_idx on public.email_webhook_events (received_at desc);

alter table public.email_webhook_events enable row level security;
revoke all on public.email_webhook_events from anon, authenticated;
grant select, insert, update on public.email_webhook_events to service_role;

comment on table public.email_webhook_events is
  'Eventos brutos do provedor de e-mail (entregue, bounce, reclamacao, falha), unicos por provider + event_id. Escrita somente pelo servidor.';
