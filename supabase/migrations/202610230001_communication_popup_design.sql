-- Comunicacao, "Design do pop-up" (docs/26): o pop-up "Personalizado" que a equipe monta no editor (midia com
-- video ou imagem que some num degrade, selo, titulo de 1 a 4 linhas, texto, botoes com estilo livre e fontes
-- enviadas). "Padrão" = popup_design nulo: todo pop-up que ja existe continua exatamente igual. A notificacao
-- do sino nunca tem design. As 202610200001, 202610200002, 202610210001, 202610220001, 202610220002 e
-- 202610220003 (ja aplicadas) nao mudam.
--
-- Regras:
-- - campaigns ganha popup_design (jsonb, versao 1, formato em src/server/communications/popup-design-schema.ts,
--   conferido pelo app ao salvar e ao ler; invalido = Padrão). O banco so garante: nulo ou objeto com
--   "version" numerica, so em pop-up, ate 32 KB. Nenhuma linha e reescrita;
-- - communication_fonts e a biblioteca de fontes enviadas (woff2, woff, ttf, otf; ate 2 MB; o app confere os
--   primeiros bytes). O aluno nunca le a tabela: o servidor resolve as fontes do pop-up (familia, endereco,
--   peso, estilo) e manda junto. Excluir e so marcar deleted_at (o arquivo fica: pop-up gravado nunca perde
--   a fonte). RLS ligado e sem politica: so service_role;
-- - dois buckets publicos: communication-fonts (so fontes, 2 MB) e communication-popup-video (so mp4 e webm,
--   15 MB). Video e fonte ficam no Storage, nunca no servidor do app;
-- - nada de drop, delete, gatilho ou funcao: as tres secoes passam pelo MCP do Supabase (execute_sql), na
--   ordem do arquivo, uma por chamada (ou apply_migration com o arquivo inteiro). Nao ha secao para o SQL
--   Editor.
--
-- Verificacao manual depois de aplicar:
--   select count(*) filter (where popup_design is not null) from public.campaigns; -- 0 logo depois
--   select conname, convalidated from pg_constraint where conname = 'campaigns_popup_design_v1'; -- 1 linha, true
--   select relrowsecurity from pg_class where oid = 'public.communication_fonts'::regclass; -- true
--   select count(*) from pg_policies where schemaname = 'public' and tablename = 'communication_fonts'; -- 0
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets
--     where id in ('communication-fonts', 'communication-popup-video') order by id; -- 2 linhas, public true
--
-- Idempotente: pode ser executada mais de uma vez sem efeito colateral.

/* ------------------------------------------------------------------------------------------------
 * 1. campaigns: o design do pop-up (nulo = Padrão). MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.campaigns
  add column if not exists popup_design jsonb;

comment on column public.campaigns.popup_design is
  'Design Personalizado do pop-up (versao 1; formato e limites em popup-design-schema.ts, conferidos pelo app ao salvar e ao ler). Nulo = Padrão (o visual de antes). So pop-up; ate 32 KB.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_popup_design_v1') then
    alter table public.campaigns add constraint campaigns_popup_design_v1 check (
      popup_design is null
      or (
        kind = 'popup'
        and jsonb_typeof(popup_design) = 'object'
        -- coalesce: sem "version", jsonb_typeof daria nulo e o check passaria.
        and coalesce(jsonb_typeof(popup_design -> 'version'), 'null') = 'number'
        and pg_column_size(popup_design) <= 32768
      )
    );
  end if;
end;
$$;

/* ------------------------------------------------------------------------------------------------
 * 2. Biblioteca de fontes enviadas (so o servidor le e grava). MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.communication_fonts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  family_key text not null check (family_key ~ '^bf_[a-f0-9]{12}$'),
  file_path text not null check (file_path ~ '^fonts/[a-f0-9]{24}\.(woff2|woff|ttf|otf)$'),
  format text not null check (format in ('woff2', 'woff', 'truetype', 'opentype')),
  weight smallint not null default 400 check (weight between 100 and 900 and weight % 100 = 0),
  style text not null default 'normal' check (style in ('normal', 'italic')),
  size_bytes integer not null check (size_bytes between 1 and 2097152),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists communication_fonts_family_key_idx on public.communication_fonts (family_key);
create unique index if not exists communication_fonts_file_idx on public.communication_fonts (file_path) where deleted_at is null;
create index if not exists communication_fonts_list_idx on public.communication_fonts (name) where deleted_at is null;

comment on table public.communication_fonts is
  'Fontes enviadas pela equipe para o design dos pop-ups (bucket communication-fonts). O aluno nunca le: o servidor resolve as fontes de cada pop-up. Excluir = deleted_at (o arquivo fica para os pop-ups ja gravados).';
comment on column public.communication_fonts.name is 'Nome que a equipe ve no seletor (1 a 60 caracteres).';
comment on column public.communication_fonts.family_key is 'Nome da familia no CSS do aluno (bf_ + 12 hex), nunca o nome do produtor.';
comment on column public.communication_fonts.file_path is 'Objeto no bucket communication-fonts: fonts/<24 hex do sha256>.<extensao> (o mesmo arquivo nao duplica).';
comment on column public.communication_fonts.format is 'format() do CSS: woff2, woff, truetype ou opentype (conferido pelos primeiros bytes).';
comment on column public.communication_fonts.weight is 'Peso informado pela equipe (100 a 900), so para o seletor; o arquivo vale para qualquer peso pedido.';
comment on column public.communication_fonts.style is 'normal ou italic.';

alter table public.communication_fonts enable row level security;
revoke all on public.communication_fonts from anon, authenticated;
grant select, insert, update, delete on public.communication_fonts to service_role;

/* ------------------------------------------------------------------------------------------------
 * 3. Buckets publicos das fontes (2 MB) e dos videos dos pop-ups (15 MB). MCP.
 * ---------------------------------------------------------------------------------------------- */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'communication-fonts',
  'communication-fonts',
  true,
  2097152,
  array['font/woff2', 'font/woff', 'font/ttf', 'font/otf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'communication-popup-video',
  'communication-popup-video',
  true,
  15728640,
  array['video/mp4', 'video/webm']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
