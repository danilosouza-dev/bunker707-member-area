-- Midia do Storage pelo caminho (docs/32 §11.5): os checks que exigiam um endereco http(s) passam a aceitar tambem o
-- caminho publico do Storage ("/storage/v1/object/public/<bucket>/<caminho>" e "/storage/v1/render/image/public/..."),
-- que o app grava no lugar do endereco inteiro (src/server/db/storage-paths.ts; a leitura devolve o endereco inteiro,
-- montado com o endereco do Supabase configurado). As migracoes de antes nao mudam.
--
-- Por que antes do app novo: o app novo grava o caminho em campaigns.image_url e campaigns.audio_url (a imagem e o
-- audio do aviso), e os checks da 202610200001 recusariam (23514). lesson_materials.file_url (da 202610130001; nenhuma
-- tela grava hoje) entra junto, para o material que esta no nosso Storage poder ir pelo caminho tambem.
-- webinar_offer_variants (checkout_url e image_url, 202610300003) fica como esta: sao links colados pela equipe, que o
-- app grava como vieram (STORAGE_PATHS_SKIPPED_TABLES).
--
-- Regras:
-- - os checks sem nome campaigns_image_url_check, campaigns_audio_url_check e lesson_materials_file_url_check saem, e
--   entram os nomeados campaigns_image_url_v2, campaigns_audio_url_v2 e lesson_materials_file_url_v2, com a mesma regra
--   de antes mais o caminho. O check antigo e achado pela definicao (a coluna com o padrao https), nao so pelo nome, e
--   so sai dentro do bloco que roda quando o check novo ainda nao existe;
-- - os checks novos entram `not valid` (secao 1, sem ler as linhas) e sao validados na secao 2 (le a tabela com um
--   bloqueio que deixa ler e gravar). Pelo MCP do Supabase, uma secao por chamada, na ordem, cada uma comecando com
--   `set lock_timeout = '5s';`; pelo apply_migration ou pelo migrate.sh, o arquivo inteiro numa transacao (as duas
--   tabelas sao pequenas);
-- - nenhum dado muda aqui: os enderecos inteiros que ja existem continuam valendo na leitura. A conversao deles e um
--   passo a parte, depois do app novo no ar (supabase/dados/202611120001_midia_pelo_caminho.sql);
-- - o app de antes continua funcionando neste banco: os checks novos aceitam tudo que ele grava. Nada de create
--   table, create policy, alter policy, delete nem truncate.
--
-- Verificacao manual depois de aplicar:
--   select conrelid::regclass, conname, convalidated from pg_constraint
--     where conname in ('campaigns_image_url_v2', 'campaigns_audio_url_v2', 'lesson_materials_file_url_v2') order by 2; -- 3 linhas, true
--   select count(*) from pg_constraint
--     where conname in ('campaigns_image_url_check', 'campaigns_audio_url_check', 'lesson_materials_file_url_check'); -- 0
--
-- Idempotente: pode ser executada mais de uma vez sem efeito colateral.

/* ------------------------------------------------------------------------------------------------
 * 1. Os checks de endereco aceitam o caminho do Storage, sem ler as linhas. MCP.
 * ---------------------------------------------------------------------------------------------- */

do $$
declare
  v_old record;
begin
  if not exists (
    select 1 from pg_constraint where conname = 'campaigns_image_url_v2' and conrelid = 'public.campaigns'::regclass
  ) then
    for v_old in
      select conname from pg_constraint
      where conrelid = 'public.campaigns'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) like '%(image_url ~ ''^https?://%'
    loop
      execute format('alter table public.campaigns drop constraint %I', v_old.conname);
    end loop;

    alter table public.campaigns add constraint campaigns_image_url_v2 check (
      image_url is null
      or (
        char_length(image_url) <= 2048
        and (image_url ~ '^https?://[^[:space:]]+$' or image_url ~ '^/storage/v1/(object|render/image)/public/[^[:space:]]+$')
      )
    ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'campaigns_audio_url_v2' and conrelid = 'public.campaigns'::regclass
  ) then
    for v_old in
      select conname from pg_constraint
      where conrelid = 'public.campaigns'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) like '%(audio_url ~ ''^https?://%'
    loop
      execute format('alter table public.campaigns drop constraint %I', v_old.conname);
    end loop;

    alter table public.campaigns add constraint campaigns_audio_url_v2 check (
      audio_url is null
      or (
        char_length(audio_url) <= 2048
        and (audio_url ~ '^https?://[^[:space:]]+$' or audio_url ~ '^/storage/v1/(object|render/image)/public/[^[:space:]]+$')
      )
    ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'lesson_materials_file_url_v2' and conrelid = 'public.lesson_materials'::regclass
  ) then
    for v_old in
      select conname from pg_constraint
      where conrelid = 'public.lesson_materials'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) like '%(file_url ~ ''^https://%'
    loop
      execute format('alter table public.lesson_materials drop constraint %I', v_old.conname);
    end loop;

    alter table public.lesson_materials add constraint lesson_materials_file_url_v2 check (
      file_url ~ '^https://[^[:space:]]+$' or file_url ~ '^/storage/v1/(object|render/image)/public/[^[:space:]]+$'
    ) not valid;
  end if;
end;
$$;

/* ------------------------------------------------------------------------------------------------
 * 2. A conferencia das linhas que ja existem (de novo, nada muda). MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.campaigns validate constraint campaigns_image_url_v2;
alter table public.campaigns validate constraint campaigns_audio_url_v2;
alter table public.lesson_materials validate constraint lesson_materials_file_url_v2;
