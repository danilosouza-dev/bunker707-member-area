-- Comunicacao, "Modelos" (docs/28): configuracoes prontas de notificacao, de pop-up e de design (Personalizado ou
-- Livre) que a equipe guarda para comecar avisos novos. Decidido com o produtor em 23/10/2026. As 202610200001 a
-- 202610240001 (ja aplicadas) nao mudam. Os modelos dos Fluxos (flow-templates-model.ts) continuam no codigo.
--
-- Regras:
-- - communication_templates guarda o nome, o tipo (inbox, popup ou design), o modo do design (custom ou free) e o
--   payload (jsonb, versao 1, formato em src/server/communications/template-model.ts, conferido pelo app ao salvar e
--   ao ler; parte invalida e descartada na leitura com aviso no editor). O banco so garante: objeto com "version"
--   numerica, "kind" igual a coluna, ate 1 MB (o app para em 768 KB pela estimativa por cima, medida pelo maior
--   aviso que o banco aceita);
-- - nunca vao para o payload: data e hora de envio, janela do pop-up, "ate uma data", fim marcado da enquete,
--   situacao, aprovacao, "mostrar de novo", ids de aviso ou de fluxo, numeros e versao de linha;
-- - o modelo segura os arquivos que cita (video, imagens, audio, fontes): o job comunicacao-limpeza-de-arquivos le
--   os modelos nao excluidos. Excluir = deleted_at (o arquivo sem outro uso sai 30 dias depois);
-- - limite de 200 modelos nao excluidos, conferido pelo app antes de gravar (duas gravacoes ao mesmo tempo podem
--   passar de 200 por um; nada quebra);
-- - updated_at e a versao do editor (409 "mudou em outra tela"), pelo gatilho com a funcao que ja existe
--   public.set_updated_at() (202606150001; search_path fixado em 202610010001);
-- - RLS ligado e sem politica: so service_role le e grava; nada para anon/authenticated. O aluno nunca le;
-- - nada de drop, delete ou funcao nova: uma secao so, que passa pelo MCP do Supabase (execute_sql) numa chamada
--   (ou apply_migration com o arquivo inteiro). Nao ha secao para o SQL Editor;
-- - aplicar antes do deploy que traz a aba Modelos (sem a tabela, a aba mostra "migracao pendente" e a limpeza
--   segue sem modelos).
--
-- Verificacao manual depois de aplicar:
--   select relrowsecurity from pg_class where oid = 'public.communication_templates'::regclass; -- true
--   select count(*) from pg_policies where schemaname = 'public' and tablename = 'communication_templates'; -- 0
--   select has_table_privilege('anon', 'public.communication_templates', 'select'),
--     has_table_privilege('authenticated', 'public.communication_templates', 'select'); -- false, false
--   select conname from pg_constraint where conrelid = 'public.communication_templates'::regclass
--     and contype in ('c', 'p', 'f') order by 1; -- 9 linhas
--   select tgname from pg_trigger where tgrelid = 'public.communication_templates'::regclass and not tgisinternal;
--     -- set_communication_templates_updated_at
--   select count(*) from public.communication_templates; -- 0 logo depois
--
-- Idempotente: pode ser executada mais de uma vez sem efeito colateral.

/* ------------------------------------------------------------------------------------------------
 * 1. Modelos da Comunicacao (so o servidor le e grava). MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.communication_templates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('inbox', 'popup', 'design')),
  design_mode text check (design_mode in ('custom', 'free')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  payload jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  -- Notificacao nunca tem design; Design sempre tem o modo; Pop-up: o modo do design (nulo = Padrao).
  constraint communication_templates_design_mode check (
    (kind <> 'inbox' or design_mode is null) and (kind <> 'design' or design_mode is not null)
  ),
  constraint communication_templates_payload_v1 check (
    jsonb_typeof(payload) = 'object'
    -- coalesce: sem "version", jsonb_typeof daria nulo e o check passaria.
    and coalesce(jsonb_typeof(payload -> 'version'), 'null') = 'number'
    and coalesce(payload ->> 'kind', '') = kind
    and pg_column_size(payload) <= 1048576
  )
);

-- A lista (mais recentes primeiro) e os seletores "Meus modelos" (por tipo e modo).
create index if not exists communication_templates_list_idx
  on public.communication_templates (updated_at desc) where deleted_at is null;
create index if not exists communication_templates_kind_idx
  on public.communication_templates (kind, design_mode, updated_at desc) where deleted_at is null;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_communication_templates_updated_at' and tgrelid = 'public.communication_templates'::regclass
  ) then
    create trigger set_communication_templates_updated_at
      before update on public.communication_templates
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

comment on table public.communication_templates is
  'Modelos da Comunicacao: configuracao pronta de notificacao, de pop-up ou so do design (Personalizado ou Livre) para comecar avisos novos. Nunca chega ao aluno. Excluir = deleted_at. Escrita somente pelo servidor.';
comment on column public.communication_templates.kind is 'inbox (Notificacao), popup (Pop-up) ou design (so o design do pop-up). Nao muda depois de criado.';
comment on column public.communication_templates.design_mode is 'Modo do design: custom (Personalizado) ou free (Livre). Nulo na notificacao e no pop-up Padrao.';
comment on column public.communication_templates.name is 'Nome que a equipe ve (1 a 80 caracteres). Nunca vai para a auditoria.';
comment on column public.communication_templates.payload is
  'Configuracao do modelo (versao 1; formato e limites em template-model.ts, conferidos pelo app ao salvar e ao ler). Sem datas absolutas, situacao, ids de aviso ou numeros. Ate 1 MB.';
comment on column public.communication_templates.updated_at is 'Versao do modelo para a checagem de conflito do editor (409).';
comment on column public.communication_templates.deleted_at is 'Exclusao da equipe: some da lista e dos seletores; os arquivos sem outro uso saem 30 dias depois.';

alter table public.communication_templates enable row level security;
revoke all on public.communication_templates from anon, authenticated;
grant select, insert, update, delete on public.communication_templates to service_role;
