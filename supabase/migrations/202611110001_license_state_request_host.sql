-- Produto licenciado, o endereco dos pedidos do dono e dos administradores (docs/32 §2.2 e §11.3, "O endereco"; revisao
-- de 11/11/2026). A 202611100001 (license_state) e as anteriores nao mudam.
--
-- Por que: o Verificador comparava o endereco da licenca so com a variavel NEXT_PUBLIC_SITE_URL, lida ao rodar. A copia
-- do servidor e do banco noutro dominio mantinha a variavel no endereco da licenca e ficava "em dia", com acesso novo.
-- Agora o layout do admin observa o endereco por onde o dono e os administradores abrem o admin e, quando nao e o da
-- licenca, grava a primeira vez (src/server/licensing/request-host.ts e planRequestHostObservation em store.ts):
-- - request_host: o endereco visto (o nome publico, com a porta quando nao e a 443);
-- - request_host_since: a primeira vez, com a hora confiavel. Os dois andam juntos (check license_state_request_host_pair);
-- - so grava quando muda (a primeira vez, outro endereco, ou a volta ao endereco da licenca, que apaga os dois): nenhuma
--   gravacao por pedido;
-- - no modo "off" (a nossa escola hoje, a dev, a Vercel e os testes) o app nunca le nem grava esta tabela.
-- As colunas herdam o RLS e os privilegios da tabela (so service_role). Nenhum check proibe data invalida, como na
-- 202611100001: o app a trata como invalida e nunca libera nada com ela.
--
-- Verificacao manual depois de aplicar:
--   select column_name from information_schema.columns where table_schema = 'public' and table_name = 'license_state'
--     and column_name like 'request_host%' order by 1; -- request_host, request_host_since
--   select conname from pg_constraint where conrelid = 'public.license_state'::regclass
--     and conname like 'license_state_request_host%' order by 1; -- 2 linhas
--
-- Idempotente: pode ser executada mais de uma vez sem efeito colateral.

/* ------------------------------------------------------------------------------------------------
 * 1. O endereco dos pedidos do dono e dos administradores, na linha da licenca. MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.license_state add column if not exists request_host text;
alter table public.license_state add column if not exists request_host_since timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'license_state_request_host_size' and conrelid = 'public.license_state'::regclass
  ) then
    -- O nome publico (ate 253) e a porta.
    alter table public.license_state
      add constraint license_state_request_host_size check (request_host is null or char_length(request_host) between 1 and 260);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'license_state_request_host_pair' and conrelid = 'public.license_state'::regclass
  ) then
    alter table public.license_state
      add constraint license_state_request_host_pair check ((request_host is null) = (request_host_since is null));
  end if;
end;
$$;

comment on column public.license_state.request_host is 'O endereco por onde chegaram pedidos do dono e dos administradores, quando nao e o da licenca. Apagado quando um pedido deles chega pelo endereco da licenca, ou quando a licenca passa a ser deste endereco.';
comment on column public.license_state.request_host_since is 'A primeira vez que um pedido do dono ou de um administrador chegou por request_host (hora confiavel). Conta como endereco diferente (docs/32 §2.2).';
