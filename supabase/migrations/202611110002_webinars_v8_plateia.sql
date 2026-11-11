-- Webinarios v8, os participantes simulados mudados a qualquer momento (docs/30 D79 e D80, §1.6, §3.5, §4.3 e §8.6;
-- docs/31 §13.2; teste do produtor de 11/11/2026: "Não achei a opção de adicionar números de participantes fake").
-- A equipe muda o +N da plateia simulada antes, durante e depois do comeco, ate o Encerrar, pelo console da sessao e
-- pelo card Simulacao do editor; cada mudanca pede de novo a frase da decisao (com o numero novo) e vale a partir do
-- offset do relogio da Simulacao em que foi feita, subindo ou descendo em linha reta em 90 s (a conta e do app,
-- simulation-model.ts). As entradas e os avisos de venda continuam travados no ar. As migracoes de antes nao mudam; este
-- arquivo so acrescenta.
--
-- Regras:
-- - webinar_simulation_changes: uma linha por mudanca, so acrescentada (o app nunca atualiza nem apaga): a sessao, o
--   offset em que vale (nulo = antes do comeco, quando a mudanca troca a regra da sessao, simulated_count_rule, e a
--   linha fica so no registro), a regra no formato de simulated_count_rule (nula = "Só o real", o Tirar), a frase
--   confirmada exatamente como foi mostrada (ate 600 caracteres, como simulation_ack_text), quem mudou e de onde (o
--   console ou o editor). E a auditoria de cada mudanca, e o que o relatorio lista (D80); o resumo congelado no fim
--   (webinar_sessions.simulation_summary) junta os trechos de cada regra;
-- - por que uma tabela, e nao uma lista jsonb na sessao: cada mudanca e uma linha com a propria hora e a propria frase,
--   gravada sem ler e regravar a lista (duas pessoas mudando juntas nunca perdem uma mudanca), e o registro fica
--   facil de ler e conferir; a sessao continua so com a decisao vigente (simulation_ack_text e companhia);
-- - o offset vai de 0 a 172.800.000 ms (CHAT_LIMITS.offsetMaxMs, 48 h); a regra e um objeto de ate 4 KB (como o check
--   webinar_sessions_simulation_shape_v4); a origem e 'console' ou 'editor' (SIMULATION_CHANGE_SOURCES);
-- - a coluna nova nao entra em nenhuma lista que o app sempre le: sem a tabela, a Simulacao segue como antes (as
--   leituras das mudancas devolvem vazio) e so mudar o numero volta 409 com o aviso desta migracao
--   (WEBINARS_AUDIENCE_MIGRATION); o app de antes nunca le a tabela, entao a migracao sozinha nao muda nada para ele;
-- - tabela nova so do service_role (o aluno nunca le nem grava direto; a sala recebe so a janela calculada no
--   servidor); nada de create policy, alter policy, delete nem truncate. Duas secoes, cada uma pelo MCP do Supabase
--   (execute_sql, uma por chamada, na ordem), ou apply_migration com o arquivo inteiro.
--
-- Verificacao manual depois de aplicar:
--   select has_table_privilege('authenticated', 'public.webinar_simulation_changes', 'select'),
--          (select relrowsecurity from pg_class where oid = 'public.webinar_simulation_changes'::regclass),
--          (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'webinar_simulation_changes');
--     -- false, true, 2 (o indice da sessao e a pkey)
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. webinar_simulation_changes: cada mudanca dos participantes simulados. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_simulation_changes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.webinar_sessions(id) on delete cascade,
  at_offset_ms integer check (at_offset_ms is null or at_offset_ms between 0 and 172800000),
  count_rule jsonb check (count_rule is null or (jsonb_typeof(count_rule) = 'object' and pg_column_size(count_rule) <= 4096)),
  ack_text text not null check (char_length(ack_text) between 1 and 600),
  changed_by uuid references auth.users(id) on delete set null,
  source text not null default 'console' check (source in ('console', 'editor')),
  created_at timestamptz not null default now()
);

comment on table public.webinar_simulation_changes is 'Simulacao (docs/30 D79 e D80): cada mudanca dos participantes simulados de uma sessao, com o offset em que vale, a regra, a frase confirmada, quem e de onde. So acrescenta.';

/* ------------------------------------------------------------------------------------------------
 * 2. O indice da sessao e as permissoes (so o service_role). MCP.
 * ---------------------------------------------------------------------------------------------- */

create index if not exists webinar_simulation_changes_session_idx on public.webinar_simulation_changes (session_id, created_at);

alter table public.webinar_simulation_changes enable row level security;
revoke all on public.webinar_simulation_changes from anon, authenticated;
grant select, insert, update, delete on public.webinar_simulation_changes to service_role;
