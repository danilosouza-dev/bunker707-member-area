-- Retencao de dados pessoais por idade (2026-10-17): a fila de e-mails e os eventos brutos das plataformas
-- de venda perdem o dado pessoal depois do prazo; a linha fica, para historico e idempotencia.
-- Politica em docs/06 (secoes LGPD, E-mail transacional e Vendas pela Hotmart) e docs/05 (secoes Webhooks
-- e E-mail transacional); o prazo de 12 meses de webhook_events vem de docs/17 §2.4.
--
-- Regras (public.prune_personal_data(), agendada todo dia pelo pg_cron):
-- - webhook_events: 12 meses depois de received_at a linha perde payload (vira {}), buyer_email e
--   error_message e ganha anonymized_at. Ficam provider, external_event_id (idempotencia: o mesmo evento
--   entregue de novo continua respondendo "duplicado"), tipo, resultado, motivo, alvo, aluno e datas. A tela
--   de Vendas continua listando a linha, sem e-mail e sem Reprocessar (nao ha mais payload para reler);
-- - email_outbox: linha enviada (sent) 90 dias depois de created_at; com falha, bounce ou reclamacao, 180
--   dias (mais tempo para diagnostico); ainda na fila (queued/sending) depois de 180 dias vira failed e
--   segue a mesma regra. A linha perde to_email, html, text e last_error e ganha anonymized_at. Ficam kind,
--   user_id, subject (fixo ou com o nome do produto, nunca o do aluno), idempotency_key (um webhook
--   reprocessado nao manda o mesmo e-mail de novo), status, datas e metadata (so ids e rotulos curtos);
-- - email_webhook_events: apagada 90 dias depois de received_at (o payload do provedor traz o destinatario;
--   o que importava ja esta em email_outbox: delivered_at, bounced_at, status e last_error);
-- - idempotente: linha ja anonimizada nao e tocada de novo. So o pg_cron (como dono) e o servidor
--   (service_role) chamam a funcao; nada para anon/authenticated. Nenhuma tela chama por enquanto.
--
-- Verificacao manual depois de aplicar:
--   select public.prune_personal_data();  -- roda agora; devolve quantas linhas mudaram em cada tabela
--   select jobname, schedule, active from cron.job where jobname = 'bunker707-personal-data-prune';
--   select count(*) filter (where anonymized_at is not null) as anonimizadas, count(*) as total
--     from public.webhook_events;
--   select status, count(*) filter (where anonymized_at is not null) as anonimizadas, count(*) as total
--     from public.email_outbox group by status order by status;
--   Para pausar: select cron.unschedule('bunker707-personal-data-prune');
--   (rodar esta migracao de novo agenda outra vez).
--
-- Idempotente: pode ser executada mais de uma vez sem efeito colateral.

/* ------------------------------------------------------------------------------------------------
 * 1. Marca de anonimizacao e colunas que passam a aceitar nulo
 * ---------------------------------------------------------------------------------------------- */

alter table public.webhook_events add column if not exists anonymized_at timestamptz;

comment on column public.webhook_events.anonymized_at is
  'Quando a retencao apagou payload, buyer_email e error_message (12 meses depois de received_at). Nulo = linha inteira.';

-- Linha anonimizada nunca guarda o payload nem o e-mail do comprador.
alter table public.webhook_events drop constraint if exists webhook_events_anonymized_consistent;
alter table public.webhook_events add constraint webhook_events_anonymized_consistent
  check (anonymized_at is null or (payload = '{}'::jsonb and buyer_email is null and error_message is null));

alter table public.email_outbox add column if not exists anonymized_at timestamptz;
-- to_email e html so sao nulos em linha anonimizada (check abaixo); os checks de tamanho ja aceitam nulo.
alter table public.email_outbox alter column to_email drop not null;
alter table public.email_outbox alter column html drop not null;

comment on column public.email_outbox.anonymized_at is
  'Quando a retencao apagou to_email, html, text e last_error (90 dias depois de enviada; 180 dias nos demais casos). Nulo = linha inteira.';

alter table public.email_outbox drop constraint if exists email_outbox_anonymized_consistent;
alter table public.email_outbox add constraint email_outbox_anonymized_consistent
  check ((anonymized_at is null) = (to_email is not null and html is not null));

/* ------------------------------------------------------------------------------------------------
 * 2. A rotina
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.prune_personal_data()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  sales_events bigint;
  outbox_rows bigint;
  provider_events bigint;
begin
  update public.webhook_events
  set payload = '{}'::jsonb,
      buyer_email = null,
      error_message = null,
      anonymized_at = now()
  where anonymized_at is null
    and received_at < now() - interval '12 months';
  get diagnostics sales_events = row_count;

  -- Nas expressoes do SET, `status` e o valor antigo: a linha ainda na fila vira failed com o motivo.
  update public.email_outbox
  set to_email = null,
      html = null,
      text = null,
      last_error = case
        when status in ('queued', 'sending') then 'Expirado pela retenção: mais de 180 dias na fila sem sair.'
        else null
      end,
      status = case when status in ('queued', 'sending') then 'failed' else status end,
      anonymized_at = now()
  where anonymized_at is null
    and (
      (status = 'sent' and created_at < now() - interval '90 days')
      or created_at < now() - interval '180 days'
    );
  get diagnostics outbox_rows = row_count;

  delete from public.email_webhook_events
  where received_at < now() - interval '90 days';
  get diagnostics provider_events = row_count;

  return jsonb_build_object(
    'webhook_events', sales_events,
    'email_outbox', outbox_rows,
    'email_webhook_events', provider_events
  );
end;
$$;

comment on function public.prune_personal_data() is
  'Retencao por idade (docs/06, LGPD): anonimiza webhook_events (12 meses) e email_outbox (90/180 dias) e apaga email_webhook_events (90 dias). Idempotente; agendada todo dia pelo pg_cron.';

revoke all on function public.prune_personal_data() from public, anon, authenticated;
grant execute on function public.prune_personal_data() to service_role;

/* ------------------------------------------------------------------------------------------------
 * 3. Agendamento diario
 * ---------------------------------------------------------------------------------------------- */

do $$
begin
  -- 06:23 UTC (03:23 em Brasilia), logo depois da limpeza do historico de jobs (06:17).
  if not exists (select 1 from cron.job where jobname = 'bunker707-personal-data-prune') then
    perform cron.schedule(
      'bunker707-personal-data-prune',
      '23 6 * * *',
      'select public.prune_personal_data();'
    );
  end if;
end;
$$;
