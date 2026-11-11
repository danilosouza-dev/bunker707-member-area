-- Produto licenciado, o Verificador ligado ao app (docs/32 §11.3 e §16): a tabela license_state guarda o que a
-- Instalacao sabe sobre a propria licenca, numa linha so. As migracoes ate a 202611010001 (ja aplicadas) nao mudam.
--
-- Regras:
-- - uma linha so (id = 1, check license_state_single_row). Quem le e grava e o servidor, com a service role: a
--   tarefa do tick `licenca-conferencia` (src/server/jobs/license-check-in-job.ts) grava; a situacao de cada pedido
--   (src/server/licensing/current-state.ts) so le. As regras de gravacao ficam em src/server/licensing/store.ts e o
--   adaptador em store-db.ts;
-- - no modo "off" (a nossa escola hoje, a dev, a Vercel e os testes) o app nunca le nem grava esta tabela: a
--   migracao sozinha nao muda nada no app de antes, e o app novo sem ela tambem nao;
-- - o retrato que a avaliacao usa: a licenca assinada (token, o texto BKL1), se ja foi ativada, desde quando a
--   licenca guardada esta ilegivel, a ultima hora vista (so avanca, um minuto por rodada do tick), a ultima
--   conferencia boa (a hora assinada pelo Emissor e a hora local daquele momento, as duas ou nenhuma), desde quando
--   o endereco diverge e a data da licenca mais nova ja aceita (so sobe);
-- - o que a conversa com o Emissor precisa: o identificador e o segredo da Instalacao (o segredo so o servidor le;
--   nunca vai para log, tela ou resposta), a sequencia da ultima conferencia, quando a ultima tentativa comecou e
--   como terminou (ok, em_andamento ou o codigo da falha) e o pedido de conferencia na hora;
-- - version e a versao da linha: toda gravacao confere a lida e soma 1 (duas rodadas do tick nunca gravam por cima
--   uma da outra); updated_at pelo gatilho com a funcao que ja existe public.set_updated_at() (202606150001;
--   search_path fixado em 202610010001);
-- - nenhum check proibe data invalida (o infinity do Postgres): o app a trata como invalida e nunca libera nada com
--   ela (docs/32 §11.3, Relogio). Os dados moram num banco que o comprador controla; as regras estao no app;
-- - RLS ligado e sem politica: so service_role le e grava; nada para anon/authenticated;
-- - nada de drop, delete, politica ou funcao nova: uma secao so, que passa pelo MCP do Supabase (execute_sql) numa
--   chamada (ou apply_migration com o arquivo inteiro). Nao ha secao para o SQL Editor.
--
-- Verificacao manual depois de aplicar:
--   select relrowsecurity from pg_class where oid = 'public.license_state'::regclass; -- true
--   select count(*) from pg_policies where schemaname = 'public' and tablename = 'license_state'; -- 0
--   select has_table_privilege('anon', 'public.license_state', 'select'),
--     has_table_privilege('authenticated', 'public.license_state', 'select'); -- false, false
--   select conname from pg_constraint where conrelid = 'public.license_state'::regclass
--     and contype in ('c', 'p') order by 1; -- 9 linhas
--   select tgname from pg_trigger where tgrelid = 'public.license_state'::regclass and not tgisinternal;
--     -- set_license_state_updated_at
--   select count(*) from public.license_state; -- 0 (o modo "off" nunca cria a linha)
--
-- Idempotente: pode ser executada mais de uma vez sem efeito colateral.

/* ------------------------------------------------------------------------------------------------
 * 1. A licenca desta Instalacao (uma linha; so o servidor le e grava). MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.license_state (
  id smallint primary key default 1,
  token text,
  ever_activated boolean not null default false,
  unreadable_since timestamptz,
  last_seen_at timestamptz,
  last_check_in_emissor_at timestamptz,
  last_check_in_local_at timestamptz,
  host_mismatch_since timestamptz,
  newest_issued_at timestamptz,
  installation_id text,
  installation_secret text,
  check_in_sequence text,
  check_in_attempted_at timestamptz,
  check_in_result text,
  check_in_requested_at timestamptz,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint license_state_single_row check (id = 1),
  -- O mesmo teto do Verificador (MAX_LICENSE_TOKEN_LENGTH em artifact.ts).
  constraint license_state_token_size check (token is null or char_length(token) between 1 and 16384),
  -- O mesmo limite do identificador dentro da licenca (installation.id em model.ts).
  constraint license_state_installation_id_size check (installation_id is null or char_length(installation_id) between 1 and 64),
  constraint license_state_installation_secret_size check (installation_secret is null or char_length(installation_secret) between 1 and 512),
  constraint license_state_check_in_sequence_size check (check_in_sequence is null or char_length(check_in_sequence) between 1 and 128),
  constraint license_state_check_in_result_format check (check_in_result is null or check_in_result ~ '^[a-z_]{1,40}$'),
  -- A ultima conferencia boa e um par: a hora assinada pelo Emissor e a hora local daquele momento.
  constraint license_state_last_check_in_pair check ((last_check_in_emissor_at is null) = (last_check_in_local_at is null)),
  constraint license_state_version_positive check (version >= 0)
);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_license_state_updated_at' and tgrelid = 'public.license_state'::regclass
  ) then
    create trigger set_license_state_updated_at
      before update on public.license_state
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

comment on table public.license_state is
  'A licenca desta Instalacao (produto licenciado, docs/32 §11.3): uma linha, lida e gravada so pelo servidor. No modo off o app nunca a toca.';
comment on column public.license_state.token is 'A licenca assinada mais recente aceita (texto BKL1). Conferida a cada leitura; nunca confiada pelo banco.';
comment on column public.license_state.ever_activated is 'A Instalacao ja teve uma licenca valida: sem licenca legivel depois disso, conta como licenca ilegivel, nunca como nao ativada.';
comment on column public.license_state.unreadable_since is 'Primeira rodada do tick em que a licenca guardada nao conferiu; apagada quando volta a conferir.';
comment on column public.license_state.last_seen_at is 'A ultima hora vista: so avanca, um minuto por rodada do tick, e e realinhada com a hora do Emissor a cada conferencia boa. Nunca copiada do relogio do servidor.';
comment on column public.license_state.last_check_in_emissor_at is 'A hora assinada pelo Emissor na ultima conferencia boa (a emissao da licenca devolvida).';
comment on column public.license_state.last_check_in_local_at is 'O relogio do servidor quando a ultima conferencia boa chegou.';
comment on column public.license_state.host_mismatch_since is 'Primeira rodada do tick em que o endereco configurado divergiu do da licenca; apagada quando volta a bater.';
comment on column public.license_state.newest_issued_at is 'A emissao da licenca mais nova ja aceita: so sobe. Licenca mais antiga que ela nao vale.';
comment on column public.license_state.installation_id is 'O identificador desta Instalacao no Emissor (chega na ativacao).';
comment on column public.license_state.installation_secret is 'O segredo desta Instalacao, apresentado ao Emissor em cada conferencia. So o servidor le; nunca vai para log, tela ou resposta.';
comment on column public.license_state.check_in_sequence is 'O numero devolvido pela ultima conferencia, apresentado na seguinte (duas copias da mesma Instalacao aparecem para o Emissor).';
comment on column public.license_state.check_in_attempted_at is 'O relogio do servidor quando a ultima tentativa de conferencia comecou.';
comment on column public.license_state.check_in_result is 'Como a ultima tentativa terminou: ok, em_andamento (reservada por uma rodada do tick) ou o codigo da falha.';
comment on column public.license_state.check_in_requested_at is 'Conferencia pedida para ja (licenca guardada que nao confere; depois, o Verificar agora). Apagada pela tentativa que a atende.';
comment on column public.license_state.version is 'Versao da linha: toda gravacao do app confere a lida e soma 1.';

alter table public.license_state enable row level security;
revoke all on public.license_state from anon, authenticated;
grant select, insert, update, delete on public.license_state to service_role;
