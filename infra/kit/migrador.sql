-- Ferramentas do migrador do kit (infra/kit/migrar.sh; docs/32 §11.6 e docs/20 §9A), carregadas pelo migrar.sh no
-- comeco da sessao do psql. Tudo aqui e criado em pg_temp: existe so nesta sessao, some quando o psql sai e nunca entra
-- no esquema da escola (a guarda tests/kit-migrador.guard.test.mjs confere).
--
-- O que guarda o contrato com a CLI do Supabase 2.121.0 (a versao pinada em infra/scripts/lib.sh e no CI), lido no
-- codigo dela (github.com/supabase/cli, tag v2.121.0, commit 8a549dff, apps/cli/src/command-internal/):
-- - o historico e supabase_migrations.schema_migrations (version text primary key, statements text[], name text),
--   criado como em migration-history.ts (createMigrationTable) e gravado com INSERT (version, name, statements);
-- - name e version saem do nome do arquivo (^([0-9]+)_(.*)\.sql$) e statements sao os comandos do arquivo como o
--   divisor dela os corta (sql-split.ts, splitAndTrim): bk_dividir abaixo e uma copia fiel dele, byte a byte;
-- - um arquivo cuja primeira linha e exatamente "-- pg-delta: transaction=false" roda sem transacao, comando por
--   comando (migration-file.ts e migration-apply.ts); os outros, numa transacao so.
--
-- Arquivo so de leitura para o banco: o migrar.sh decide quando aplicar; aqui so ha calculo e conferencia.

-- O pacote: um arquivo por linha, com os bytes exatos (o migrar.sh manda em base64).
create temp table bk_pacote (versao text not null, nome text not null, arquivo text not null, bytes bytea not null);

-- O plano: o que o historico diz e o que o pacote traz, por versao.
create temp table bk_plano (
  versao text primary key,
  nome text not null,
  arquivo text not null,
  comandos text[] not null,
  modo text not null,
  aplicar boolean not null default false
);

-- O que o banco ja tem no historico (a CLI, outro migrador ou este).
create temp table bk_historico (versao text primary key, nome text, comandos text[]);

-- Problemas que impedem aplicar (tipo: historico, alterada ou recusada) e avisos que nao impedem.
create temp table bk_problemas (ordem serial, tipo text not null, versao text, texto text not null);
create temp table bk_avisos (ordem serial, versao text, texto text not null);

-- Os espacos que o trim() do JavaScript tira das pontas de cada comando (WhiteSpace e LineTerminator do ECMAScript).
-- Pelo codigo do caractere: o E'' do Postgres nao conhece a tabulacao vertical (seria a letra v).
create function pg_temp.bk_espacos() returns text language sql immutable as $bk$
  select chr(32) || chr(9) || chr(10) || chr(13) || chr(12) || chr(11)
    || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
$bk$;

-- Letra, digito, _ ou $ (ou qualquer byte >= 0x80: o divisor da CLI trata todo caractere fora do ASCII como letra).
create function pg_temp.bk_ident(b int) returns boolean language sql immutable as
$bk$ select b >= 128 or b between 48 and 57 or b between 65 and 90 or b between 97 and 122 or b = 95 or b = 36 $bk$;

-- Os bytes c[ini..fim] sao a palavra-chave (maiuscula, ASCII), sem diferenciar maiuscula de minuscula.
create function pg_temp.bk_palavra(c bytea, ini int, kw text) returns boolean language plpgsql immutable as $bk$
declare
  i int;
begin
  if ini < 0 or ini + length(kw) > length(c) then
    return false;
  end if;
  for i in 0 .. length(kw) - 1 loop
    -- b & 0xDF = letra maiuscula so para a propria letra e a minuscula dela (as palavras-chave sao so letras).
    if (get_byte(c, ini + i) & 223) <> ascii(substr(kw, i + 1, 1)) then
      return false;
    end if;
  end loop;
  return true;
end $bk$;

-- endsWithKeyword(data, kw) do sql-split.ts: o comando c[ini..fim] termina com kw e o caractere antes dela nao e letra.
create function pg_temp.bk_termina_com(c bytea, ini int, fim int, kw text) returns boolean language plpgsql immutable as $bk$
declare
  o int := fim - length(kw) + 1;
begin
  if o < ini then
    return false;
  end if;
  if not pg_temp.bk_palavra(c, o, kw) then
    return false;
  end if;
  return o = ini or not pg_temp.bk_ident(get_byte(c, o - 1));
end $bk$;

-- isCommentsAndWhitespace(texto) do sql-split.ts, sobre os bytes c[ini..fim) (fim exclusivo).
create function pg_temp.bk_so_comentarios(c bytea, ini int, fim int) returns boolean language plpgsql immutable as $bk$
declare
  i int := ini;
  b int;
  prof int;
begin
  while i < fim loop
    b := get_byte(c, i);
    if b in (32, 9, 10, 13, 12, 11) then
      i := i + 1;
    elsif b = 45 and i + 1 < fim and get_byte(c, i + 1) = 45 then
      i := i + 2;
      while i < fim and get_byte(c, i) not in (10, 13) loop
        i := i + 1;
      end loop;
      if i >= fim then
        return true;
      end if;
      i := i + 1;
    elsif b = 47 and i + 1 < fim and get_byte(c, i + 1) = 42 then
      prof := 1;
      i := i + 2;
      while i < fim and prof > 0 loop
        if get_byte(c, i - 1) = 47 and get_byte(c, i) = 42 then
          prof := prof + 1;
        elsif get_byte(c, i - 1) = 42 and get_byte(c, i) = 47 then
          prof := prof - 1;
        end if;
        i := i + 1;
      end loop;
      if prof > 0 then
        return true;
      end if;
    else
      return false;
    end if;
  end loop;
  return true;
end $bk$;

-- O divisor de comandos da CLI 2.121.0 (sql-split.ts: splitRaw + splitAndTrim), sobre os bytes UTF-8 do arquivo.
-- A maquina de estados da CLI anda por caractere e so decide por caracteres ASCII; todo caractere fora do ASCII conta
-- como letra. Em UTF-8 cada byte de um caractere desses e >= 0x80, entao andar byte a byte da os mesmos cortes.
-- Estados da folha (k): 0 pronto, 1 depois de um '-', 2 comentario de linha, 3 bloco /* */, 4 aspas, 5 continuacao de
-- E'' depois da aspa, 6 corpo $tag$, 7 lendo a $tag$, 8 depois de uma barra invertida. Por cima da folha, uma pilha de
-- embrulhos (1 parenteses, 2 BEGIN ATOMIC), como o prev do ParenState e do AtomicState. A volta de cada next(): 0 =
-- fim de comando (null no TypeScript), 1 = um ReadyState, 2 = outro estado.
-- barra_fora: alguma barra invertida fora de texto e de comentario (no psql, isso seria um comando do proprio psql).
create function pg_temp.bk_dividir(conteudo bytea, out comandos text[], out barra_fora boolean)
language plpgsql immutable as $bk$
declare
  c bytea := conteudo || ''::bytea;  -- copia em memoria: get_byte sem descompactar a cada byte
  n int := length(conteudo);
  p int := 0;
  ini int := 0;
  b int;
  q int;
  r int;
  k int := 0;
  prof int := 0;
  delim int := 0;
  barras boolean := false;
  fechou boolean := false;
  apos_barra boolean := false;
  nova_linha boolean := false;
  tracos int := 0;
  dolar bytea;
  dl int := 0;
  tag_ini int := 0;
  wt int[] := '{}';
  wp boolean[] := '{}';
  ws int[] := '{}';
  wc boolean[] := '{}';
  nw int := 0;
  base int;
  corte int;
  i int;
  e int;
  pe boolean;
  t text;
  espacos text := pg_temp.bk_espacos();
begin
  comandos := '{}';
  barra_fora := false;
  -- O readFileString da CLI (TextDecoder) tira o BOM do comeco do arquivo antes de cortar.
  if substring(c from 1 for 3) = '\xefbbbf'::bytea then
    c := substring(c from 4);
    n := length(c);
  end if;
  while p < n loop
    b := get_byte(c, p);

    -- Descida pelos embrulhos: o AtomicState com o END pendente e um caractere que nao e letra fecha o bloco e
    -- devolve new ReadyState().next(rune) (troca ele e o que esta dentro por um estado pronto).
    corte := 0;
    i := 1;
    while i <= nw loop
      if wt[i] = 2 then
        pe := wp[i];
        wp[i] := false;
        if pe and not pg_temp.bk_ident(b) then
          corte := i;
          exit;
        end if;
      end if;
      i := i + 1;
    end loop;
    if corte > 0 then
      nw := corte - 1;
      wt := wt[1:nw]; wp := wp[1:nw]; ws := ws[1:nw]; wc := wc[1:nw];
      k := 0;
    end if;
    base := nw;

    -- O next() da folha; "continue" repassa o mesmo byte ao estado novo (new XState().next(rune, data)).
    loop
      if k = 0 then
        -- ReadyState
        if b = 36 then
          if p > ini and pg_temp.bk_ident(get_byte(c, p - 1)) then
            r := 1;
          else
            k := 7; tag_ini := p - ini; r := 2;
          end if;
        elsif b = 39 then
          k := 4; delim := 39; fechou := false; apos_barra := false;
          -- E'...': o E comeca uma palavra (endsWithKeyword(data sem a aspa, "E")).
          barras := pg_temp.bk_termina_com(c, ini, p - 1, 'E');
          r := 2;
        elsif b = 34 then
          k := 4; delim := 34; fechou := false; apos_barra := false; barras := false; r := 2;
        elsif b = 45 then
          k := 1; r := 2;
        elsif b = 47 then
          k := 3; prof := 0; r := 2;
        elsif b = 92 then
          k := 8; barra_fora := true; r := 2;
        elsif b = 59 then
          r := 0;
        elsif b = 40 then
          nw := nw + 1; wt[nw] := 1; wp[nw] := false; ws[nw] := 0; wc[nw] := false;
          k := 0; r := 2;
        elsif b in (99, 67) then
          -- isBeginAtomic: termina com ATOMIC e, antes dos espacos, com BEGIN.
          r := 1;
          if pg_temp.bk_termina_com(c, ini, p, 'ATOMIC') then
            e := p - 6;
            while e >= ini and get_byte(c, e) in (32, 9, 10, 13, 12, 11) loop
              e := e - 1;
            end loop;
            if pg_temp.bk_termina_com(c, ini, e, 'BEGIN') then
              nw := nw + 1; wt[nw] := 2; wp[nw] := false; ws[nw] := p - ini + 1; wc[nw] := false;
              k := 0; r := 2;
            end if;
          end if;
        else
          r := 1;
        end if;
        exit;
      elsif k = 1 then
        -- CommentState (um '-')
        if b = 45 then
          k := 2; r := 2; exit;
        end if;
        k := 0;
        continue;
      elsif k = 2 then
        -- LineCommentState
        if b in (10, 13) then
          k := 0; r := 1;
        else
          r := 2;
        end if;
        exit;
      elsif k = 3 then
        -- BlockState: janela dos dois ultimos caracteres do comando
        if p > ini then q := get_byte(c, p - 1); else q := -1; end if;
        if q = 47 and b = 42 then
          prof := prof + 1; r := 2; exit;
        elsif prof = 0 then
          k := 0;
          continue;
        elsif q = 42 and b = 47 then
          prof := prof - 1;
          if prof = 0 then k := 0; r := 1; else r := 2; end if;
          exit;
        end if;
        r := 2;
        exit;
      elsif k = 4 then
        -- QuoteState
        if fechou then
          if b = delim then
            fechou := false; r := 2; exit;
          elsif barras then
            k := 5; nova_linha := false; tracos := 0;
            continue;
          end if;
          k := 0;
          continue;
        elsif apos_barra then
          apos_barra := false;
        elsif barras and b = 92 then
          apos_barra := true;
        elsif b = delim then
          fechou := true;
        end if;
        r := 2;
        exit;
      elsif k = 5 then
        -- QuoteContinueState
        if tracos = 2 then
          if b in (10, 13) then tracos := 0; nova_linha := true; end if;
          r := 2; exit;
        elsif b = 45 then
          tracos := tracos + 1; r := 2; exit;
        elsif tracos = 0 and b in (32, 9, 10, 13, 12, 11) then
          nova_linha := nova_linha or b in (10, 13); r := 2; exit;
        elsif tracos = 0 and nova_linha and b = 39 then
          k := 4; delim := 39; barras := true; fechou := false; apos_barra := false; r := 2; exit;
        end if;
        k := 0;
        continue;
      elsif k = 6 then
        -- DollarState: o comando termina com o delimitador
        if b = 36 and p - dl + 1 >= ini and substring(c from p - dl + 2 for dl) = dolar then
          k := 0; r := 1;
        else
          r := 2;
        end if;
        exit;
      elsif k = 7 then
        -- TagState
        if b = 36 then
          dolar := substring(c from ini + tag_ini + 1 for p - ini - tag_ini + 1);
          dl := length(dolar);
          k := 6; r := 2; exit;
        elsif pg_temp.bk_ident(b) then
          r := 2; exit;
        end if;
        k := 0;
        continue;
      else
        -- EscapeState: engole o caractere
        k := 0; r := 1;
        exit;
      end if;
    end loop;

    -- Subida pelos embrulhos que ja existiam (do mais de dentro para o de fora).
    i := base;
    while i >= 1 loop
      if wt[i] = 1 then
        -- ParenState
        if r = 0 then
          nw := i; wt := wt[1:nw]; wp := wp[1:nw]; ws := ws[1:nw]; wc := wc[1:nw];
          k := 0; r := 2;
        elsif r = 1 then
          if b = 41 then
            nw := i - 1; wt := wt[1:nw]; wp := wp[1:nw]; ws := ws[1:nw]; wc := wc[1:nw];
            k := 0; r := 1;
          else
            r := 2;
          end if;
        else
          r := 2;
        end if;
      else
        -- AtomicState
        if r = 0 then
          nw := i; wt := wt[1:nw]; wp := wp[1:nw]; ws := ws[1:nw]; wc := wc[1:nw];
          k := 0; ws[i] := p - ini + 1; wc[i] := false; r := 2;
        elsif r = 1 then
          if not wc[i] and b in (68, 100) and pg_temp.bk_termina_com(c, ini, p, 'END') then
            if pg_temp.bk_so_comentarios(c, ini + ws[i], p - 2) then
              wp[i] := true;
            else
              wc[i] := true;
            end if;
          end if;
          r := 2;
        else
          r := 2;
        end if;
      end if;
      i := i - 1;
    end loop;

    if r = 0 then
      -- Fim de comando: tira os ';' do fim e os espacos das pontas (trimStatement) e guarda se sobrou algo.
      e := p;
      while e >= ini and get_byte(c, e) = 59 loop
        e := e - 1;
      end loop;
      t := btrim(convert_from(substring(c from ini + 1 for e - ini + 1), 'UTF8'), espacos);
      if t <> '' then
        comandos := comandos || t;
      end if;
      ini := p + 1;
      k := 0; nw := 0; wt := '{}'; wp := '{}'; ws := '{}'; wc := '{}';
    end if;
    p := p + 1;
  end loop;

  -- O que sobrou depois do ultimo ';' (inclusive um comentario sozinho) tambem vira comando.
  if n > ini then
    e := n - 1;
    while e >= ini and get_byte(c, e) = 59 loop
      e := e - 1;
    end loop;
    t := btrim(convert_from(substring(c from ini + 1 for e - ini + 1), 'UTF8'), espacos);
    if t <> '' then
      comandos := comandos || t;
    end if;
  end if;
end $bk$;

-- trimLeadingSqlComments do migration-apply.ts: tira BOM, espacos e comentarios do comeco do comando, para ler a
-- primeira palavra de verdade.
create function pg_temp.bk_sem_comentarios(s text) returns text language plpgsql immutable as $bk$
declare
  t text := ltrim(s, E' \t\n\r');
  i int;
begin
  while left(t, 1) = U&'\FEFF' loop
    t := ltrim(substr(t, 2), E' \t\n\r');
  end loop;
  loop
    if left(t, 2) = '--' then
      i := strpos(t, E'\n');
      if i = 0 then
        return '';
      end if;
      t := ltrim(substr(t, i + 1), E' \t\n\r');
    elsif left(t, 2) = '/*' then
      i := strpos(t, '*/');
      if i = 0 then
        return t;
      end if;
      t := ltrim(substr(t, i + 2), E' \t\n\r');
    else
      return btrim(t, pg_temp.bk_espacos());
    end if;
  end loop;
end $bk$;

-- O que o comando pede do migrador, pela primeira palavra (sem comentarios, em maiusculas):
--   sem_transacao: o Postgres nao roda dentro de uma transacao (a lista do isPipelineIncompatible da CLI 2.121.0 e
--                  mais CREATE/DROP DATABASE e TABLESPACE, DETACH PARTITION ... CONCURRENTLY e REINDEX SYSTEM/DATABASE);
--   controle:      abre ou fecha transacao (hasTransactionControl da CLI);
--   discard:       DISCARD apaga as tabelas temporarias desta sessao, que o migrador usa para gravar o historico;
--   add_value:     ALTER TYPE ... ADD VALUE (roda na transacao, mas o valor novo so pode ser usado depois do COMMIT);
--   null:          nada de especial.
create function pg_temp.bk_tipo_do_comando(s text) returns text language plpgsql immutable as $bk$
declare
  u text := upper(pg_temp.bk_sem_comentarios(s));
  palavras text[];
  j int;
begin
  if u ~ '^CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY(\s|$)'
    or u ~ '^DROP\s+INDEX\s+CONCURRENTLY(\s|$)'
    or u ~ '^REINDEX(\s|\().*\sCONCURRENTLY(\s|$)'
    or u ~ '^REINDEX\s+(\([^)]*\)\s*)?(SYSTEM|DATABASE)(\s|$)'
    or u ~ '^VACUUM(\s|\(|$)'
    or u ~ '^ALTER\s+SYSTEM(\s|$)'
    or u ~ '^CLUSTER(\s|$)'
    or u ~ '^(CREATE|DROP)\s+(DATABASE|TABLESPACE)(\s|$)'
    or u ~ '^ALTER\s+TABLE\s.*\sDETACH\s+PARTITION\s.*\sCONCURRENTLY(\s|$)' then
    return 'sem_transacao';
  end if;
  palavras := regexp_split_to_array(u, '\s+');
  if palavras[1] = 'ROLLBACK' then
    j := case when palavras[2] in ('WORK', 'TRANSACTION') then 3 else 2 end;
    if palavras[j] is distinct from 'TO' then
      return 'controle';
    end if;
  elsif u ~ '^(BEGIN|START\s+TRANSACTION|COMMIT|END|ABORT|PREPARE\s+TRANSACTION)(\s|$)' then
    return 'controle';
  end if;
  if u ~ '^DISCARD(\s|$)' then
    return 'discard';
  end if;
  if u ~ '^ALTER\s+TYPE\s.*\sADD\s+VALUE(\s|$)' then
    return 'add_value';
  end if;
  return null;
end $bk$;

-- O conteudo sem nenhum espaco e sem ';': igual para dois historicos que cortaram o mesmo arquivo em lugares
-- diferentes (outra versao da CLI), diferente quando o texto mudou.
create function pg_temp.bk_impressao(s text) returns text language sql immutable as
$bk$ select translate(s, pg_temp.bk_espacos() || ';', '') $bk$;

-- A trava contra duas execucoes ao mesmo tempo: trava de sessao do Postgres (pg_advisory_lock) no par (70707, 1),
-- que nao colide com as travas de uma chave so que o app usa. Some sozinha se o psql cair.
create function pg_temp.bk_travar() returns void language plpgsql as $bk$
declare
  dono int;
begin
  if not pg_try_advisory_lock(70707, 1) then
    select l.pid into dono from pg_locks l
     where l.locktype = 'advisory' and l.classid = 70707 and l.objid = 1 and l.objsubid = 2 and l.granted
     limit 1;
    raise exception 'bkmigrar:trava' using detail = 'A trava esta com o processo ' || coalesce(dono::text, '?') || ' do Postgres.';
  end if;
end $bk$;

-- Para o --listar: ninguem esta aplicando agora? (pega e solta a trava na hora).
create function pg_temp.bk_trava_livre() returns boolean language plpgsql as $bk$
begin
  if pg_try_advisory_lock(70707, 1) then
    perform pg_advisory_unlock(70707, 1);
    return true;
  end if;
  return false;
end $bk$;

-- A sondagem da CLI (provisionedProbe de migration-history.ts): a tabela do historico ja tem as tres colunas?
create function pg_temp.bk_historico_pronto() returns boolean language sql as $bk$
  select count(*) = 3
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
   where a.attrelid = pg_catalog.to_regclass('supabase_migrations.schema_migrations')
     and c.relkind in ('r', 'p') and not a.attisdropped and a.attname in ('version', 'name', 'statements')
$bk$;

-- Uma linha da conversa com o migrar.sh: BKMIGRAR, o tipo e os campos, separados pelo caractere 0x1F (que nao e
-- espaco para o read do bash, entao campo vazio continua campo). Separador e quebra de linha dentro de um campo viram
-- espaco: um nome estranho no historico nao quebra a conversa.
create function pg_temp.bk_linha(variadic campos text[]) returns text language sql immutable as $bk$
  select 'BKMIGRAR' || chr(31) || array_to_string(array(
    select regexp_replace(coalesce(x, ''), '[\x1f\t\n\r]', ' ', 'g') from unnest(campos) with ordinality as u(x, i) order by i
  ), chr(31))
$bk$;

-- O plano: le o pacote e o historico, confere um contra o outro e decide o que aplicar. Nunca muda nada fora de
-- pg_temp. Devolve as linhas para o migrar.sh (R resumo, A aviso, X problema, P pendente); os problemas ficam em
-- bk_problemas e o bk_conferir() para a execucao depois de as linhas sairem.
create function pg_temp.bk_planejar() returns setof text language plpgsql as $bk$
declare
  diretiva constant text := '-- pg-delta: transaction=false';
  f record;
  h record;
  bytes bytea;
  texto text;
  primeira text;
  partes record;
  modo text;
  tipo text;
  cmd text;
  vistos text[];
  tem_nome boolean;
  tem_comandos boolean;
  mais_nova text;
  n_pacote int;
  n_historico int;
  n_pendentes int;
begin
  -- 1. O pacote. Versao repetida para tudo (a CLI aplicaria as duas e quebraria na segunda).
  for f in
    select versao, string_agg(arquivo, ', ' order by arquivo) as arquivos
      from pg_temp.bk_pacote group by versao having count(*) > 1
  loop
    insert into pg_temp.bk_problemas (tipo, versao, texto)
    values ('recusada', f.versao, 'duas migracoes com a mesma versao no pacote: ' || f.arquivos);
  end loop;

  for f in
    select * from pg_temp.bk_pacote
     where versao not in (select versao from pg_temp.bk_pacote group by versao having count(*) > 1)
     order by versao collate "C"
  loop
    bytes := f.bytes;
    -- O readFileString da CLI (TextDecoder) tira o BOM do comeco do arquivo.
    if substring(bytes from 1 for 3) = '\xefbbbf'::bytea then
      bytes := substring(bytes from 4);
    end if;
    begin
      texto := convert_from(bytes, 'UTF8');
    exception when others then
      insert into pg_temp.bk_problemas (tipo, versao, texto)
      values ('recusada', f.versao, f.arquivo || ' nao esta em UTF-8 valido (ou tem um byte zero).');
      continue;
    end;
    select * into partes from pg_temp.bk_dividir(bytes);
    primeira := split_part(texto, E'\n', 1);
    if right(primeira, 1) = E'\r' then
      primeira := left(primeira, -1);
    end if;
    modo := case when primeira = diretiva then 'sem_transacao' else 'transacao' end;
    insert into pg_temp.bk_plano (versao, nome, arquivo, comandos, modo)
    values (f.versao, f.nome, f.arquivo, partes.comandos, modo);
    if partes.barra_fora then
      insert into pg_temp.bk_problemas (tipo, versao, texto)
      values ('recusada', f.versao, f.arquivo || ' tem uma barra invertida fora de texto e de comentario: o psql leria isso como comando dele, e o Postgres recusaria.');
    end if;
  end loop;

  -- 2. O historico (a tabela pode nao existir ainda, ou ser de uma CLI antiga, sem name ou statements).
  if pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null then
    select exists (select 1 from pg_catalog.pg_attribute where attrelid = 'supabase_migrations.schema_migrations'::regclass and attname = 'name' and not attisdropped),
           exists (select 1 from pg_catalog.pg_attribute where attrelid = 'supabase_migrations.schema_migrations'::regclass and attname = 'statements' and not attisdropped)
      into tem_nome, tem_comandos;
    execute format('insert into pg_temp.bk_historico (versao, nome, comandos) select version, %s, %s from supabase_migrations.schema_migrations',
      case when tem_nome then 'name' else 'null::text' end,
      case when tem_comandos then 'statements' else 'null::text[]' end);
  end if;

  -- 3. Historico contra pacote, como o findPendingMigrations da CLI: versao no banco sem arquivo no pacote, e arquivo
  --    do pacote mais velho que a ultima aplicada e que nunca rodou (a CLI pede --include-all; aqui, nunca).
  for h in
    select hh.versao from pg_temp.bk_historico hh
     where not exists (select 1 from pg_temp.bk_pacote p where p.versao = hh.versao)
     order by hh.versao collate "C"
  loop
    insert into pg_temp.bk_problemas (tipo, versao, texto)
    values ('historico', h.versao, 'a versao ' || h.versao || ' esta no historico do banco e nao existe no pacote.');
  end loop;
  select max(versao collate "C") into mais_nova from pg_temp.bk_historico;
  for f in
    select p.versao, p.arquivo from pg_temp.bk_plano p
     where not exists (select 1 from pg_temp.bk_historico hh where hh.versao = p.versao)
       and p.versao collate "C" < mais_nova
     order by p.versao collate "C"
  loop
    insert into pg_temp.bk_problemas (tipo, versao, texto)
    values ('historico', f.versao, f.arquivo || ' nunca foi aplicada e e mais velha que a ultima aplicada (' || mais_nova || ').');
  end loop;

  -- 4. Arquivo ja aplicado que mudou: os comandos gravados no historico contra os do arquivo de agora.
  for f in
    select p.versao, p.nome, p.arquivo, p.comandos, hh.nome as nome_h, hh.comandos as comandos_h
      from pg_temp.bk_plano p join pg_temp.bk_historico hh on hh.versao = p.versao
     order by p.versao collate "C"
  loop
    if f.comandos_h is null then
      insert into pg_temp.bk_avisos (versao, texto)
      values (f.versao, f.arquivo || ': o historico nao guarda os comandos desta migracao; nao da para conferir se o arquivo mudou.');
    elsif f.comandos_h is distinct from f.comandos then
      if pg_temp.bk_impressao(array_to_string(f.comandos_h, '')) = pg_temp.bk_impressao(array_to_string(f.comandos, '')) then
        insert into pg_temp.bk_avisos (versao, texto)
        values (f.versao, f.arquivo || ': o historico cortou os comandos em outros lugares (outra versao da CLI), mas o texto e o mesmo.');
      else
        insert into pg_temp.bk_problemas (tipo, versao, texto)
        values ('alterada', f.versao, f.arquivo || ' ja foi aplicada e o arquivo do pacote nao e mais o mesmo que rodou.');
      end if;
    end if;
    if f.nome_h is not null and f.nome_h <> f.nome then
      insert into pg_temp.bk_avisos (versao, texto)
      values (f.versao, f.arquivo || ': no historico o nome e "' || f.nome_h || '".');
    end if;
  end loop;

  -- 5. O que falta aplicar, e se cada arquivo pode rodar como esta.
  update pg_temp.bk_plano p set aplicar = true
   where not exists (select 1 from pg_temp.bk_historico hh where hh.versao = p.versao);
  for f in select * from pg_temp.bk_plano where aplicar order by versao collate "C" loop
    vistos := '{}';
    foreach cmd in array f.comandos loop
      tipo := pg_temp.bk_tipo_do_comando(cmd);
      if tipo is null or tipo = any (vistos) then
        continue;
      end if;
      vistos := vistos || tipo;
      if tipo = 'discard' then
        insert into pg_temp.bk_problemas (tipo, versao, texto)
        values ('recusada', f.versao, f.arquivo || ' tem DISCARD, que apagaria as tabelas temporarias que o migrador usa para gravar o historico.');
      elsif tipo = 'sem_transacao' and f.modo = 'transacao' then
        insert into pg_temp.bk_problemas (tipo, versao, texto)
        values ('recusada', f.versao, f.arquivo || ' tem um comando que o Postgres nao roda dentro de transacao (' || left(regexp_replace(pg_temp.bk_sem_comentarios(cmd), '\s+', ' ', 'g'), 60) || '). Ponha esse comando num arquivo so dele, com a primeira linha "' || diretiva || '".');
      elsif tipo = 'controle' and f.modo = 'transacao' then
        insert into pg_temp.bk_problemas (tipo, versao, texto)
        values ('recusada', f.versao, f.arquivo || ' abre ou fecha transacao por conta propria (' || left(regexp_replace(pg_temp.bk_sem_comentarios(cmd), '\s+', ' ', 'g'), 40) || '); o migrador aplica cada arquivo numa transacao so. Tire o comando, ou use a primeira linha "' || diretiva || '".');
      elsif tipo = 'add_value' and f.modo = 'transacao' then
        insert into pg_temp.bk_avisos (versao, texto)
        values (f.versao, f.arquivo || ' tem ALTER TYPE ... ADD VALUE: o valor novo so pode ser usado depois do COMMIT, num arquivo seguinte.');
      end if;
    end loop;
  end loop;

  select count(*) into n_pacote from pg_temp.bk_pacote;
  select count(*) into n_historico from pg_temp.bk_historico;
  select count(*) into n_pendentes from pg_temp.bk_plano where aplicar;
  return next pg_temp.bk_linha('R', n_pacote::text, n_historico::text, n_pendentes::text);
  for f in select * from pg_temp.bk_avisos order by ordem loop
    return next pg_temp.bk_linha('A', coalesce(f.versao, ''), f.texto);
  end loop;
  for f in select * from pg_temp.bk_problemas order by ordem loop
    return next pg_temp.bk_linha('X', f.tipo, coalesce(f.versao, ''), f.texto);
  end loop;
  for f in select * from pg_temp.bk_plano where aplicar order by versao collate "C" loop
    return next pg_temp.bk_linha('P', f.versao, f.arquivo, f.modo);
  end loop;
end $bk$;

-- Para a execucao se o plano achou problema, antes de qualquer mudanca. A mensagem leva o codigo que o migrar.sh
-- traduz (historico 5, alterada 6, recusada 7); os detalhes ja sairam nas linhas X do plano.
create function pg_temp.bk_conferir() returns void language plpgsql as $bk$
declare
  tipo text;
begin
  select p.tipo into tipo from pg_temp.bk_problemas p
   order by case p.tipo when 'historico' then 1 when 'alterada' then 2 else 3 end, p.ordem
   limit 1;
  if tipo is not null then
    raise exception 'bkmigrar:%', tipo using detail = 'Nada foi aplicado.';
  end if;
end $bk$;
