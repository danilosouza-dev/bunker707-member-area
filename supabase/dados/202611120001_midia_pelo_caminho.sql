-- Midia do Storage pelo caminho: a conversao dos enderecos que ja estao no banco (docs/32 §11.5). NAO e migracao: nada
-- aplica este arquivo sozinho (nem a CLI, nem o migrate.sh, nem o migrador do kit) e ele nao entra na imagem. Roda a
-- mao, numa sessao so do psql (ou numa chamada so do execute_sql do MCP), como postgres.
--
-- Quando: depois da migracao 202611120001 e com o app que grava o caminho no ar (ele le as duas formas: o endereco
-- inteiro antigo continua valendo antes, durante e depois desta conversao), e depois que a volta para a versao anterior
-- do app ficou para tras. O app de antes nao entende o caminho: para voltar a ele, rode antes o modo 'reverter' (abaixo).
-- O app novo ja grava o caminho desde o deploy, entao a volta pede o 'reverter' mesmo sem esta conversao.
--
-- O que muda: nas colunas de bk_midia_alvos (secao 1), o texto que e o endereco inteiro de um arquivo do Storage desta
-- instalacao vira o caminho publico ("https://api.exemplo.com.br/storage/v1/object/public/content-assets/x.webp" vira
-- "/storage/v1/object/public/content-assets/x.webp"; a query da imagem transformada fica), tambem dentro dos JSON (o
-- design do pop-up, os modelos, a marca, o destaque, a pagina do produto), so quando o texto inteiro e o endereco: o
-- mesmo que o app faz ao gravar (src/server/db/storage-paths.ts). E desta instalacao quando a origem esta em
-- bunker.midia_origens E o arquivo existe aqui (storage.objects).
-- Fica como esta:
-- - endereco de outra origem (YouTube, Vimeo, imagem externa, outro projeto do Supabase), mesmo que um arquivo com o
--   mesmo nome exista aqui; endereco da nossa origem cujo arquivo nao existe aqui (ja esta quebrado: fica para alguem ver);
-- - endereco assinado (/object/sign/) ou autenticado, com %, espaco, aspas ou fragmento; texto que so cita um endereco;
-- - o que ja esta pelo caminho: rodar de novo nunca converte duas vezes;
-- - os registros (admin_audit_log, student_events, webhook_events, email_outbox), as notificacoes (nunca guardam arquivo:
--   NOTIFICATION_KINDS_WITH_MEDIA) e as variantes da Oferta (links colados, com check https://).
-- updated_at nao muda: os gatilhos de data (os que chamam set_updated_at e touch_campaign_version) ficam desligados so
-- durante o update de cada tabela, na mesma transacao. A ordem das listas, a versao do editor e o "atualizado em" ficam.
--
-- Como rodar: o arquivo inteiro numa sessao so (as ferramentas ficam em pg_temp e somem quando ela acaba), com os
-- parametros em `set` antes dele:
--   bunker.midia_modo     'previa' (o padrao: so le), 'converter' ou 'reverter';
--   bunker.midia_origens  a origem do Storage desta instalacao como o app a ve (o NEXT_PUBLIC_SUPABASE_URL, sem barra no
--                         fim); mais de uma, separadas por virgula (a Instalacao que mudou de endereco antes desta
--                         conversao poe a antiga tambem: o arquivo restaurado aqui volta a valer). A previa sem ela lista
--                         as origens que existem;
--   bunker.midia_base     so no 'reverter': o NEXT_PUBLIC_SUPABASE_URL que volta na frente do caminho;
--   bunker.midia_lote     linhas por coluna em cada rodada (padrao 5000). Cada rodada e uma transacao: rode de novo ate o
--                         resultado dar 0 em a_converter (no 'reverter', 0 em caminhos).
-- Producao (etapa exec-membros, em /opt/bunker707; a origem e o SUPABASE_PUBLIC_URL do .env):
--   docker compose -f infra/compose/docker-compose.yml exec -T db psql -U postgres -X -v ON_ERROR_STOP=1
--     -c "set bunker.midia_origens = 'https://api.bunker707.com.br'" -c "set bunker.midia_modo = 'previa'"
--     -f - < supabase/dados/202611120001_midia_pelo_caminho.sql
-- Nuvem de teste (MCP, execute_sql): numa chamada so, `set bunker.midia_origens = '<endereco do projeto>';`,
-- `set bunker.midia_modo = 'previa';` e o arquivo inteiro.
-- O resultado tem uma linha por coluna: linhas_mudadas (nesta rodada), a_converter (enderecos desta instalacao que ainda
-- vao para o caminho), sem_arquivo (da nossa origem, sem o arquivo aqui), outras_origens (cada origem com a contagem) e
-- caminhos (o que ja esta pelo caminho).
--
-- Previa rapida, so leitura e sem as ferramentas (linhas com algum endereco inteiro do Storage, de qualquer origem):
--   select c.coluna, count(*) from (
--     select 'campaigns.audio_url' as coluna, audio_url as v from public.campaigns
--     union all select 'campaigns.cta_href', cta_href from public.campaigns
--     union all select 'campaigns.image_url', image_url from public.campaigns
--     union all select 'campaigns.popup_design', popup_design::text from public.campaigns
--     union all select 'communication_templates.payload', payload::text from public.communication_templates
--     union all select 'content_items.image', image from public.content_items
--     union all select 'content_items.instructor', instructor::text from public.content_items
--     union all select 'content_page_settings.settings', settings::text from public.content_page_settings
--     union all select 'course_modules.image', image from public.course_modules
--     union all select 'lesson_comments.author_avatar_url', author_avatar_url from public.lesson_comments
--     union all select 'lesson_materials.file_url', file_url from public.lesson_materials
--     union all select 'lessons.image', image from public.lessons
--     union all select 'lessons.video_config', video_config::text from public.lessons
--     union all select 'platform_settings.value', value::text from public.platform_settings
--     union all select 'profiles.avatar_url', avatar_url from public.profiles
--     union all select 'webinars.cover_url', cover_url from public.webinars
--     union all select 'youtube_course_imports.last_manifest', last_manifest::text from public.youtube_course_imports
--   ) c where c.v ~ 'https?://[^"[:space:]]+/storage/v1/(object|render/image)/public/' group by 1 order by 1;
--
-- Verificacao manual depois de converter: a previa (bunker.midia_modo = 'previa') da 0 em a_converter em todas as linhas,
-- e as telas mostram as mesmas imagens (o app monta o endereco com o NEXT_PUBLIC_SUPABASE_URL).
--
-- Idempotente: pode ser executada mais de uma vez sem efeito colateral.

/* ------------------------------------------------------------------------------------------------
 * 1. As ferramentas (em pg_temp) e as colunas que guardam endereco de arquivo.
 * ---------------------------------------------------------------------------------------------- */

-- As colunas que guardam o endereco de um arquivo (texto) ou JSON com enderecos dentro. A guarda
-- tests/midia-caminho.guard.test.mjs confere a lista com as migracoes.
create or replace function pg_temp.bk_midia_alvos()
returns table (tabela text, coluna text, tipo text)
language sql
immutable
as $$
  values
    ('campaigns', 'audio_url', 'text'),
    ('campaigns', 'cta_href', 'text'),
    ('campaigns', 'image_url', 'text'),
    ('campaigns', 'popup_design', 'jsonb'),
    ('communication_templates', 'payload', 'jsonb'),
    ('content_items', 'image', 'text'),
    ('content_items', 'instructor', 'jsonb'),
    ('content_page_settings', 'settings', 'jsonb'),
    ('course_modules', 'image', 'text'),
    ('lesson_comments', 'author_avatar_url', 'text'),
    ('lesson_materials', 'file_url', 'text'),
    ('lessons', 'image', 'text'),
    ('lessons', 'video_config', 'jsonb'),
    ('platform_settings', 'value', 'jsonb'),
    ('profiles', 'avatar_url', 'text'),
    ('webinars', 'cover_url', 'text'),
    ('youtube_course_imports', 'last_manifest', 'jsonb')
$$;

-- Uma origem como o app a monta (storageBaseOf): http(s), maquina [a-z0-9.-] ou IPv6, porta e caminho opcionais, sem
-- barra no fim. null = nao serve.
create or replace function pg_temp.bk_midia_base_valida(p_valor text)
returns text
language sql
immutable
as $$
  select case
    when p_valor ~ '^https?://([a-z0-9]([a-z0-9-]*[a-z0-9])?[.])*[a-z0-9]([a-z0-9-]*[a-z0-9])?(:[0-9]{1,5})?(/[A-Za-z0-9._~-]+)*$' then p_valor
    when p_valor ~ '^https?://[[][0-9a-f:.]+[]](:[0-9]{1,5})?(/[A-Za-z0-9._~-]+)*$' then p_valor
  end
$$;

-- As partes de um endereco inteiro do Storage: {base, (caminho da base), rota, (tipo), bucket, nome, query}. null = nao
-- e um, ou tem %, espaco, aspas ou fragmento. Sem barra invertida no padrao: vale com qualquer standard_conforming_strings.
create or replace function pg_temp.bk_midia_partes(p_valor text)
returns text[]
language sql
immutable
as $$
  select regexp_match(
    p_valor,
    '^(https?://[^/?#[:space:]"]+(/[^?#[:space:]"]*?)?)(/storage/v1/(object|render/image)/public/)([^/?#[:space:]"%]+)/([^?#[:space:]"%]+)([?][^#[:space:]"]*)?$'
  )
$$;

create or replace function pg_temp.bk_midia_existe(p_bucket text, p_nome text)
returns boolean
language sql
stable
as $$
  select exists (select 1 from storage.objects o where o.bucket_id = p_bucket and o.name = p_nome)
$$;

-- Um texto. 'converter': o endereco inteiro desta instalacao (origem na lista e arquivo aqui) vira o caminho.
-- 'reverter': o caminho ganha a base na frente. O resto volta igual.
create or replace function pg_temp.bk_midia_texto(p_valor text, p_modo text, p_origens text[], p_base text)
returns text
language plpgsql
stable
as $$
declare
  v_partes text[];
begin
  if p_valor is null then
    return null;
  end if;

  if p_modo = 'reverter' then
    return case when p_valor ~ '^/storage/v1/(object|render/image)/public/' then p_base || p_valor else p_valor end;
  end if;

  v_partes := pg_temp.bk_midia_partes(p_valor);

  if v_partes is null or not (v_partes[1] = any (p_origens)) or not pg_temp.bk_midia_existe(v_partes[5], v_partes[6]) then
    return p_valor;
  end if;

  return v_partes[3] || v_partes[5] || '/' || v_partes[6] || coalesce(v_partes[7], '');
end;
$$;

-- Um JSON: cada texto, em qualquer profundidade, passa por bk_midia_texto; o resto (chaves, numeros, ordem) fica.
create or replace function pg_temp.bk_midia_json(p_valor jsonb, p_modo text, p_origens text[], p_base text)
returns jsonb
language plpgsql
stable
as $$
begin
  return case jsonb_typeof(p_valor)
    when 'string' then to_jsonb(pg_temp.bk_midia_texto(p_valor #>> '{}', p_modo, p_origens, p_base))
    when 'array' then coalesce(
      (select jsonb_agg(pg_temp.bk_midia_json(e.valor, p_modo, p_origens, p_base) order by e.ordem)
       from jsonb_array_elements(p_valor) with ordinality as e(valor, ordem)),
      '[]'::jsonb
    )
    when 'object' then coalesce(
      (select jsonb_object_agg(o.chave, pg_temp.bk_midia_json(o.valor, p_modo, p_origens, p_base))
       from jsonb_each(p_valor) as o(chave, valor)),
      '{}'::jsonb
    )
    else p_valor
  end;
end;
$$;

create or replace function pg_temp.bk_midia_origens()
returns text[]
language plpgsql
stable
as $$
declare
  v_lista text[] := '{}';
  v_item text;
begin
  foreach v_item in array string_to_array(coalesce(current_setting('bunker.midia_origens', true), ''), ',') loop
    v_item := rtrim(btrim(v_item), '/');
    continue when v_item = '';

    if pg_temp.bk_midia_base_valida(v_item) is null then
      raise exception 'bunker.midia_origens: "%" nao e uma origem (http(s)://maquina[:porta][/caminho], sem barra no fim)', v_item;
    end if;

    v_lista := array_append(v_lista, v_item);
  end loop;

  return v_lista;
end;
$$;

-- Os parametros da rodada, conferidos antes de qualquer leitura.
create or replace function pg_temp.bk_midia_parametros()
returns table (modo text, origens text[], base text, lote integer)
language plpgsql
stable
as $$
declare
  v_modo text := coalesce(nullif(btrim(current_setting('bunker.midia_modo', true)), ''), 'previa');
  v_base text := nullif(rtrim(btrim(coalesce(current_setting('bunker.midia_base', true), '')), '/'), '');
  v_lote text := nullif(btrim(coalesce(current_setting('bunker.midia_lote', true), '')), '');
  v_origens text[] := pg_temp.bk_midia_origens();
begin
  if v_modo not in ('previa', 'converter', 'reverter') then
    raise exception 'bunker.midia_modo: use previa, converter ou reverter (veio "%")', v_modo;
  end if;

  if v_modo = 'converter' and cardinality(v_origens) = 0 then
    raise exception 'converter pede bunker.midia_origens: a origem do Storage desta instalacao (o NEXT_PUBLIC_SUPABASE_URL)';
  end if;

  if v_modo = 'reverter' and pg_temp.bk_midia_base_valida(v_base) is null then
    raise exception 'reverter pede bunker.midia_base: o NEXT_PUBLIC_SUPABASE_URL do app, sem barra no fim';
  end if;

  if v_lote is not null and (v_lote !~ '^[0-9]{1,6}$' or v_lote::integer not between 1 and 100000) then
    raise exception 'bunker.midia_lote: um numero de 1 a 100000 (veio "%")', v_lote;
  end if;

  if to_regclass('storage.objects') is null then
    raise exception 'sem storage.objects: rode no banco do Supabase desta instalacao';
  end if;

  -- O arquivo existe? So vale lendo storage.objects inteiro (sem a RLS do Storage): postgres no Supabase.
  if not exists (select 1 from pg_roles r where r.rolname = current_user and (r.rolsuper or r.rolbypassrls))
    and exists (select 1 from pg_class c where c.oid = 'storage.objects'::regclass and c.relrowsecurity and c.relowner <> (select oid from pg_roles where rolname = current_user))
  then
    raise exception 'rode como postgres: storage.objects tem RLS e % nao a atravessa', current_user;
  end if;

  return query select v_modo, v_origens, v_base, coalesce(v_lote::integer, 5000);
end;
$$;

-- Uma rodada numa coluna: ate p_lote linhas que mudam, com os gatilhos de data da tabela desligados so durante o update
-- (na mesma transacao: se algo falha, tudo volta, os gatilhos inclusive). Devolve as linhas mudadas.
create or replace function pg_temp.bk_midia_rodar_coluna(p_tabela text, p_coluna text, p_tipo text, p_modo text, p_origens text[], p_base text, p_lote integer)
returns bigint
language plpgsql
as $$
declare
  v_troca text := format(case p_tipo when 'jsonb' then 'pg_temp.bk_midia_json(%I, $1, $2, $3)' else 'pg_temp.bk_midia_texto(%I, $1, $2, $3)' end, p_coluna);
  v_filtro text;
  v_tem boolean;
  v_gatilhos text[];
  v_gatilho text;
  v_linhas bigint;
begin
  v_filtro := format('%I::text like %L and %s is distinct from %I', p_coluna, '%/storage/v1/%', v_troca, p_coluna);
  execute format('select exists (select 1 from public.%I where %s)', p_tabela, v_filtro) into v_tem using p_modo, p_origens, p_base;

  if not v_tem then
    return 0;
  end if;

  select coalesce(array_agg(t.tgname::text order by t.tgname), '{}') into v_gatilhos
  from pg_trigger t
  where t.tgrelid = format('public.%I', p_tabela)::regclass
    and not t.tgisinternal
    and t.tgenabled = 'O'
    and t.tgfoid = any (array_remove(array[to_regproc('public.set_updated_at'), to_regproc('public.touch_campaign_version')]::oid[], null));

  foreach v_gatilho in array v_gatilhos loop
    execute format('alter table public.%I disable trigger %I', p_tabela, v_gatilho);
  end loop;

  execute format(
    'update public.%1$I set %2$I = %3$s where ctid = any (array(select ctid from public.%1$I where %4$s limit $4))',
    p_tabela, p_coluna, v_troca, v_filtro
  ) using p_modo, p_origens, p_base, p_lote;
  get diagnostics v_linhas = row_count;

  foreach v_gatilho in array v_gatilhos loop
    execute format('alter table public.%I enable trigger %I', p_tabela, v_gatilho);
  end loop;

  return v_linhas;
end;
$$;

-- O retrato de cada coluna: o que ainda converte, o da nossa origem sem o arquivo aqui, as outras origens (com a
-- contagem) e o que ja esta pelo caminho. Conta textos (um JSON pode ter varios).
create or replace function pg_temp.bk_midia_retrato(p_origens text[])
returns table (tabela text, coluna text, a_converter bigint, sem_arquivo bigint, outras_origens text, caminhos bigint)
language plpgsql
stable
as $$
declare
  v_alvo record;
  v_textos text;
begin
  for v_alvo in select * from pg_temp.bk_midia_alvos() loop
    v_textos := case v_alvo.tipo
      when 'jsonb' then format(
        'select s.v #>> ''{}'' as valor from public.%1$I t cross join lateral jsonb_path_query(t.%2$I, ''strict $.** ? (@.type() == "string")'') as s(v) where t.%2$I::text like ''%%/storage/v1/%%''',
        v_alvo.tabela, v_alvo.coluna
      )
      else format('select %2$I as valor from public.%1$I where %2$I like ''%%/storage/v1/%%''', v_alvo.tabela, v_alvo.coluna)
    end;

    return query execute format(
      $sql$
        with v as (
          select x.valor, pg_temp.bk_midia_partes(x.valor) as partes from (%s) x
        ), c as (
          select
            v.valor,
            v.partes[1] as origem,
            coalesce(v.partes[1] = any ($1), false) as nossa,
            v.partes is not null and pg_temp.bk_midia_existe(v.partes[5], v.partes[6]) as existe
          from v
        )
        select
          %L::text,
          %L::text,
          count(*) filter (where c.nossa and c.existe),
          count(*) filter (where c.nossa and not c.existe),
          (select string_agg(o.origem || ' (' || o.n || ')', ', ' order by o.origem)
           from (select c2.origem, count(*) as n from c c2 where c2.origem is not null and not c2.nossa group by 1) o),
          count(*) filter (where c.valor ~ '^/storage/v1/(object|render/image)/public/')
        from c
      $sql$,
      v_textos, v_alvo.tabela, v_alvo.coluna
    ) using p_origens;
  end loop;
end;
$$;

/* ------------------------------------------------------------------------------------------------
 * 2. A rodada (o modo de bunker.midia_modo) e o retrato do que ficou.
 * ---------------------------------------------------------------------------------------------- */

create temp table if not exists bk_midia_mudadas (tabela text, coluna text, linhas bigint);
truncate bk_midia_mudadas;

insert into bk_midia_mudadas (tabela, coluna, linhas)
select a.tabela, a.coluna, pg_temp.bk_midia_rodar_coluna(a.tabela, a.coluna, a.tipo, p.modo, p.origens, p.base, p.lote)
from pg_temp.bk_midia_parametros() p
cross join pg_temp.bk_midia_alvos() a
where p.modo <> 'previa';

select r.tabela, r.coluna, coalesce(m.linhas, 0) as linhas_mudadas, r.a_converter, r.sem_arquivo, r.outras_origens, r.caminhos
from pg_temp.bk_midia_retrato((select p.origens from pg_temp.bk_midia_parametros() p)) r
left join bk_midia_mudadas m on m.tabela = r.tabela and m.coluna = r.coluna
order by r.tabela, r.coluna;
