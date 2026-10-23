-- Comunicacao, limpeza automatica dos arquivos sem uso (docs/22 §4.6; docs/26 e docs/27): video, imagem, audio
-- e fonte que nenhum aviso, pop-up, passo de fluxo, notificacao, fonte da biblioteca ou modelo usa mais saem do
-- Storage 30 dias depois de ficarem sem uso (da para desfazer uma exclusao ou duplicar um aviso excluido nesse
-- tempo). Decidido com o produtor em 23/10/2026. As 202610200001 a 202610230001 (ja aplicadas) nao mudam.
--
-- Regras:
-- - communication_media_orphans guarda so o arquivo (bucket e caminho) e desde quando ele esta sem uso. Quem
--   decide e o job comunicacao-limpeza-de-arquivos do tick de minuto (src/server/jobs/communication-media-job.ts),
--   uma vez por dia: marca o que ficou sem uso, desmarca o que voltou a ser usado e apaga do Storage (pela API do
--   Storage, nunca por SQL) o que esta marcado ha 30 dias ou mais, ate 500 por rodada. Arquivo enviado ha menos de
--   24 h nunca e julgado;
-- - claimed_at e a reserva da rodada que esta apagando: grava so na marca vencida e livre, apaga do Storage e so
--   entao tira a linha (falha solta a reserva). Quem envia de novo o mesmo arquivo (nome pelo conteudo) confere a
--   marca ANTES de enviar: livre, apaga; reservada, espera a linha sair. Reserva com 15 min ou mais esta esquecida
--   (rodada que caiu) e e solta (docs/22 §4.6);
-- - so os lugares da Comunicacao: communication-popup-video, communication-fonts, communication-audio e, no
--   content-assets (bucket das capas, que a limpeza nunca toca fora daqui), so a pasta communications/;
-- - RLS ligado e sem politica: so service_role le e grava; nada para anon/authenticated;
-- - nada de drop, delete ou funcao: uma secao so, que passa pelo MCP do Supabase (execute_sql) numa
--   chamada (ou apply_migration com o arquivo inteiro). Nao ha secao para o SQL Editor;
-- - aplicar antes do deploy que traz o job (sem a tabela, o job registra "migracao pendente" e termina sem erro,
--   e o tick continua verde).
--
-- Verificacao manual depois de aplicar:
--   select relrowsecurity from pg_class where oid = 'public.communication_media_orphans'::regclass; -- true
--   select count(*) from pg_policies where schemaname = 'public' and tablename = 'communication_media_orphans'; -- 0
--   select has_table_privilege('anon', 'public.communication_media_orphans', 'select'),
--     has_table_privilege('authenticated', 'public.communication_media_orphans', 'select'); -- false, false
--   select conname from pg_constraint where conrelid = 'public.communication_media_orphans'::regclass
--     and contype in ('c', 'p') order by 1; -- 4 linhas (bucket, content_assets, path, pkey)
--   select string_agg(column_name, ', ' order by column_name) from information_schema.columns
--     where table_schema = 'public' and table_name = 'communication_media_orphans'; -- bucket, claimed_at, first_orphan_at, path
--   select count(*) from public.communication_media_orphans; -- 0 logo depois
--   Depois da primeira rodada (06:53 UTC):
--   select bucket, count(*), min(first_orphan_at) from public.communication_media_orphans group by 1 order by 1;
--   select started_at, status, metadata->'media_cleanup' from public.job_runs
--     where job = 'comunicacao-limpeza-de-arquivos' and metadata ? 'media_cleanup' order by started_at desc limit 5;
--
-- Idempotente: pode ser executada mais de uma vez sem efeito colateral.

/* ------------------------------------------------------------------------------------------------
 * 1. Arquivos sem uso (so o servidor le e grava). MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.communication_media_orphans (
  bucket text not null
    check (bucket in ('communication-popup-video', 'communication-fonts', 'communication-audio', 'content-assets')),
  path text not null check (char_length(path) between 1 and 512 and path !~ '(^/|\.\.)'),
  first_orphan_at timestamptz not null default now(),
  claimed_at timestamptz,
  primary key (bucket, path),
  -- No bucket das capas, so a pasta da Comunicacao.
  constraint communication_media_orphans_content_assets check (bucket <> 'content-assets' or path like 'communications/%')
);

-- A reserva da remocao, tambem nos bancos que aplicaram a primeira versao deste arquivo (so os locais).
alter table public.communication_media_orphans add column if not exists claimed_at timestamptz;

-- Os vencidos (sem uso ha 30 dias) saem pelos mais antigos.
create index if not exists communication_media_orphans_first_orphan_idx
  on public.communication_media_orphans (first_orphan_at);

comment on table public.communication_media_orphans is
  'Arquivos da Comunicacao sem uso (video, imagem, audio, fonte) e desde quando. O job comunicacao-limpeza-de-arquivos marca, desmarca e apaga do Storage depois de 30 dias. Escrita somente pelo servidor.';
comment on column public.communication_media_orphans.bucket is
  'Bucket do Storage: communication-popup-video, communication-fonts, communication-audio ou content-assets (so communications/).';
comment on column public.communication_media_orphans.path is
  'Caminho do objeto no bucket (videos/<uuid>.mp4, fonts/<hex>.woff2, campaigns/<hex>.mp3, communications/images|free/<hex>.webp).';
comment on column public.communication_media_orphans.first_orphan_at is
  'Primeira rodada em que o arquivo foi visto sem uso. Volta a ser usado ou e enviado de novo: a linha sai e o prazo recomeca.';
comment on column public.communication_media_orphans.claimed_at is
  'Reserva da rodada que esta apagando o arquivo do Storage (null = livre). A linha so sai depois da remocao; o envio do mesmo arquivo espera. Com 15 min ou mais, esquecida: e solta.';

alter table public.communication_media_orphans enable row level security;
revoke all on public.communication_media_orphans from anon, authenticated;
grant select, insert, update, delete on public.communication_media_orphans to service_role;
