-- Webinarios v4f, a traducao do chat e do roteiro em PT, EN e ES (docs/30 §1.6 "Traducao automatica" e "Detalhes que
-- mudam a experiencia", §11, fase 4f). A 202610290008 nao muda (nenhuma migracao da fase 4 foi
-- aplicada ainda; docs/21 §9.10); este arquivo so acrescenta.
--
-- Regras:
-- - webinar_viewer_prefs: o idioma do chat das lives escolhido pelo aluno (uma linha por aluno, como o aceite do chat
--   em webinar_chat_consents, D29: fora de profiles, so do service_role); sem linha, o chat fica como foi escrito;
-- - webinar_text_translations: a traducao feita uma vez por texto e idioma e guardada (nunca na hora, para cada aluno);
--   a chave e o sha256 do texto normalizado, entao a mesma mensagem do roteiro repetida em cada sessao, a linha mestre
--   e as mensagens iguais traduzem uma vez so; guarda o idioma de origem detectado e o provedor; nenhum dado do aluno
--   (so o texto, que ja esta no chat);
-- - webinar_chat_messages.language: o idioma em que a mensagem foi escrita, quando se sabe (o idioma do aluno ao
--   escrever); a original nunca muda;
-- - legendas do video ficam de fora (docs/30 §1.6); a interface da sala segue em portugues;
-- - tabelas novas so do service_role; nada de create policy, alter policy, drop, delete nem truncate. Tres secoes,
--   cada uma pelo MCP do Supabase (execute_sql, uma por chamada, na ordem), ou apply_migration com o arquivo inteiro.
--
-- Verificacao manual depois de aplicar:
--   select table_name from information_schema.tables where table_schema = 'public'
--     and table_name in ('webinar_viewer_prefs', 'webinar_text_translations') order by 1; -- 2 linhas
--   select column_name from information_schema.columns where table_name = 'webinar_chat_messages' and column_name = 'language'; -- 1 linha
--   select has_table_privilege('authenticated', 'public.webinar_text_translations', 'select'); -- false
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. webinar_viewer_prefs: o idioma do chat das lives de cada aluno. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_viewer_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_language text check (chat_language is null or chat_language in ('pt', 'en', 'es')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.webinar_viewer_prefs is 'O idioma do chat das lives escolhido pelo aluno (docs/30 §1.6); nulo = como foi escrito.';

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_webinar_viewer_prefs_updated_at' and tgrelid = 'public.webinar_viewer_prefs'::regclass
  ) then
    create trigger set_webinar_viewer_prefs_updated_at
      before update on public.webinar_viewer_prefs
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.webinar_viewer_prefs enable row level security;
revoke all on public.webinar_viewer_prefs from anon, authenticated;
grant select, insert, update, delete on public.webinar_viewer_prefs to service_role;

/* ------------------------------------------------------------------------------------------------
 * 2. webinar_text_translations: uma traducao por texto e idioma, feita uma vez e guardada. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_text_translations (
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  language text not null check (language in ('pt', 'en', 'es')),
  source_language text check (source_language is null or source_language in ('pt', 'en', 'es', 'other')),
  body text not null check (char_length(body) between 1 and 2000),
  provider text not null check (char_length(provider) between 1 and 40),
  created_at timestamptz not null default now(),
  primary key (source_hash, language)
);

comment on table public.webinar_text_translations is 'O chat e o roteiro traduzidos (docs/30 §1.6): a chave e o sha256 do texto normalizado; uma vez por texto e idioma.';

alter table public.webinar_text_translations enable row level security;
revoke all on public.webinar_text_translations from anon, authenticated;
grant select, insert, update, delete on public.webinar_text_translations to service_role;

/* ------------------------------------------------------------------------------------------------
 * 3. webinar_chat_messages.language: o idioma em que a mensagem foi escrita. MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.webinar_chat_messages add column if not exists language text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webinar_chat_messages_language_v4') then
    alter table public.webinar_chat_messages add constraint webinar_chat_messages_language_v4
      check (language is null or language in ('pt', 'en', 'es'));
  end if;
end;
$$;

comment on column public.webinar_chat_messages.language is
  'O idioma em que a mensagem foi escrita (o do aluno ao escrever), quando se sabe; a traducao fica em webinar_text_translations.';
