-- Jobs: tick de minuto com pg_cron + pg_net chamando POST /api/jobs/tick.
--
-- O agendamento `bunker707-jobs-tick` roda `public.enqueue_jobs_tick()` a cada minuto.
-- A funcao le dois segredos do Vault e, se ambos existirem, envia um POST assinado com
-- `Authorization: Bearer <token>` para a rota. Sem os segredos, nao faz nada (estado
-- seguro para ambientes locais e branches de preview).
--
-- Passos manuais, uma vez por ambiente (os valores nunca entram no repositorio):
--   1. Gerar o token:  openssl rand -hex 32
--   2. Definir JOBS_TICK_TOKEN com esse valor nas variaveis de ambiente do servidor
--      (Vercel > Settings > Environment Variables) e publicar de novo.
--   3. No SQL Editor do Supabase, criar os dois segredos:
--        select vault.create_secret(
--          'https://<dominio-da-aplicacao>/api/jobs/tick',
--          'jobs_tick_url',
--          'URL da rota de tick dos jobs Bunker707'
--        );
--        select vault.create_secret(
--          '<mesmo valor de JOBS_TICK_TOKEN>',
--          'jobs_tick_token',
--          'Token Bearer da rota de tick dos jobs Bunker707'
--        );
--      Para trocar um valor depois:
--        select vault.update_secret(
--          (select id from vault.secrets where name = 'jobs_tick_token'),
--          '<novo valor>'
--        );
--   4. Conferir:
--        select jobname, schedule, active from cron.job where jobname like 'bunker707-%';
--        select * from cron.job_run_details order by start_time desc limit 5;
--        select status_code, error_msg, created from net._http_response order by created desc limit 5;
--        select job, status, started_at, finished_at, error from public.job_runs order by started_at desc limit 10;
--   Para pausar o tick: select cron.unschedule('bunker707-jobs-tick');
--   (rodar esta migracao de novo, ou `select cron.schedule('bunker707-jobs-tick', '* * * * *',
--   'select public.enqueue_jobs_tick();')`, agenda outra vez).
--
-- Idempotente: pode ser executada mais de uma vez sem efeito colateral.

create extension if not exists "pg_cron" with schema pg_catalog;
create extension if not exists "pg_net" with schema extensions;
create extension if not exists "supabase_vault" with schema vault;

create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null check (char_length(job) between 1 and 120),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  attempts integer not null default 1 check (attempts >= 1),
  error text check (error is null or char_length(error) <= 4000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  check ((status = 'running') = (finished_at is null))
);

comment on table public.job_runs is
  'Registro de execucoes de jobs (tick de minuto e jobs do registro). Escrita somente pelo servidor.';

create index if not exists job_runs_job_started_at_idx
  on public.job_runs (job, started_at desc);

create index if not exists job_runs_running_started_at_idx
  on public.job_runs (started_at)
  where status = 'running';

alter table public.job_runs enable row level security;

revoke all on public.job_runs from anon, authenticated;

create or replace function public.enqueue_jobs_tick()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  tick_url text;
  tick_token text;
begin
  select btrim(decrypted.decrypted_secret)
  into tick_url
  from vault.decrypted_secrets decrypted
  where decrypted.name = 'jobs_tick_url'
  limit 1;

  select btrim(decrypted.decrypted_secret)
  into tick_token
  from vault.decrypted_secrets decrypted
  where decrypted.name = 'jobs_tick_token'
  limit 1;

  if coalesce(tick_url, '') = '' or coalesce(tick_token, '') = '' then
    return null;
  end if;

  if tick_url !~* '^https?://' then
    raise warning 'jobs_tick_url no Vault nao e uma URL http(s); tick ignorado.';
    return null;
  end if;

  return net.http_post(
    url := tick_url,
    body := jsonb_build_object('source', 'pg_cron', 'scheduled_at', now()),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || tick_token
    ),
    timeout_milliseconds := 55000
  );
end;
$$;

-- Executada apenas pelo pg_cron, como o dono do agendamento (postgres).
revoke all on function public.enqueue_jobs_tick()
  from public, anon, authenticated, service_role;

-- Retencao: o tick grava ~1.440 linhas por dia em job_runs e em cron.job_run_details.
create or replace function public.prune_job_history()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.job_runs
  where (status = 'succeeded' and started_at < now() - interval '30 days')
     or (status = 'failed' and started_at < now() - interval '90 days');

  delete from cron.job_run_details
  where end_time < now() - interval '7 days';
end;
$$;

revoke all on function public.prune_job_history()
  from public, anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'bunker707-jobs-tick') then
    perform cron.schedule(
      'bunker707-jobs-tick',
      '* * * * *',
      'select public.enqueue_jobs_tick();'
    );
  end if;

  -- 06:17 UTC (03:17 em Brasilia), fora do horario de estudo.
  if not exists (select 1 from cron.job where jobname = 'bunker707-jobs-history-prune') then
    perform cron.schedule(
      'bunker707-jobs-history-prune',
      '17 6 * * *',
      'select public.prune_job_history();'
    );
  end if;
end;
$$;
