import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

// O migrador do kit (infra/kit/migrar.sh; docs/32 §11.6) contra um Postgres de verdade, em bancos de rascunho criados e
// apagados aqui (o banco da escola de teste nao e tocado):
// - aplica cada arquivo numa transacao, com RESET ALL entre eles, e grava o historico como a CLI 2.121.0: a tabela com as
//   mesmas colunas e, em statements, os comandos cortados pelo divisor dela (os esperados abaixo sairam do sql-split.ts da
//   CLI: o comentario depois do ultimo ";" vira mais um comando, o E'' continua na linha de baixo, o BEGIN ATOMIC fica
//   inteiro); a segunda rodada nao aplica nada;
// - o arquivo com a primeira linha "-- pg-delta: transaction=false" roda comando por comando (CREATE INDEX CONCURRENTLY e
//   VACUUM passam); --listar nao cria nem o esquema do historico;
// - a migracao que falha e desfeita inteira, as anteriores ficam e a seguinte nao roda; corrigida, o migrador continua;
// - recusa sem aplicar nada: versao no banco sem arquivo, arquivo fora de ordem, arquivo aplicado que mudou (espaco entre
//   comandos e o mesmo texto cortado por outra CLI so avisam), comando fora de transacao sem a diretiva, BEGIN/COMMIT,
//   DISCARD, barra invertida, UTF-8 invalido e versao repetida;
// - a trava: com outra sessao segurando, a segunda execucao para com 4 e o --listar avisa;
// - com a CLI do Supabase no PATH (o CI), ela aplica os mesmos arquivos noutro banco e o historico sai igual byte a byte e
//   o esquema tambem.
// Onde roda: no CI, no Postgres do Supabase local, pelo container supabase_db_<project_id> (o migrador roda o psql dentro
// dele, como no servidor). Fora do CI, MIGRAR_TESTE_PSQL com um psql e a conexao, sem o -d (ex.: um Postgres 16 de
// rascunho); sem nenhum dos dois, o arquivo e pulado fora do CI e falha no CI.

const root = fileURLToPath(new URL("../../", import.meta.url));
const migrar = join(root, "infra/kit/migrar.sh");
const config = readFileSync(join(root, "supabase/config.toml"), "utf8");
const CONTAINER = `supabase_db_${/^project_id\s*=\s*"([^"]+)"/m.exec(config)[1]}`;
const PORTA = /^\[db\][\s\S]*?^port\s*=\s*(\d+)/m.exec(config)[1];
const psqlLocal = process.env.MIGRAR_TESTE_PSQL;
const temContainer =
  !psqlLocal && spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", CONTAINER], { encoding: "utf8" }).stdout?.trim() === "true";
const skip = psqlLocal || temContainer || process.env.CI ? false : "sem Postgres: suba o Supabase local (npm run db:start) ou defina MIGRAR_TESTE_PSQL";
const temCli = !skip && !psqlLocal && spawnSync("supabase", ["--version"], { encoding: "utf8" }).status === 0;

const pastas = [];
const bancos = [];
after(() => {
  for (const banco of bancos) sql("postgres", `drop database if exists ${banco} with (force)`);
  for (const pasta of pastas) rmSync(pasta, { recursive: true, force: true });
});

/** Um comando no banco, pelo mesmo caminho que o migrador usa; devolve a saida sem alinhamento. */
function sql(banco, comando) {
  const r = psqlLocal
    ? spawnSync("bash", ["-c", `${psqlLocal} -X -q -v ON_ERROR_STOP=1 -At -d "$1" -c "$2"`, "_", banco, comando], { encoding: "utf8" })
    : spawnSync("docker", ["exec", "-i", CONTAINER, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-U", "postgres", "-d", banco, "-c", comando], {
        encoding: "utf8"
      });
  assert.equal(r.status, 0, `psql em ${banco}: ${r.stderr}`);
  return r.stdout.trim();
}

let numero = 0;
function bancoNovo() {
  const banco = `kit_migrador_${process.pid}_${++numero}`;
  sql("postgres", `create database ${banco}`);
  bancos.push(banco);
  return banco;
}

/** Uma pasta de migracoes com os arquivos dados (nome -> texto ou Buffer). */
function pacote(arquivos) {
  const pasta = mkdtempSync(join(tmpdir(), "kit-migrador-"));
  pastas.push(pasta);
  for (const [nome, conteudo] of Object.entries(arquivos)) writeFileSync(join(pasta, nome), conteudo);
  return pasta;
}

function migrador(banco, pasta, args = []) {
  const env = { ...process.env };
  delete env.MIGRAR_PSQL;
  delete env.MIGRAR_CONTAINER;
  if (psqlLocal) env.MIGRAR_PSQL = `${psqlLocal} -d ${banco}`;
  else env.MIGRAR_CONTAINER = CONTAINER;
  const r = spawnSync("bash", [migrar, "--pasta", pasta, "--banco", banco, ...args], { encoding: "utf8", env });
  return { status: r.status, saida: `${r.stdout}${r.stderr}` };
}

/** O historico como texto do COPY (version, name, statements), para comparar byte a byte. */
const historico = (banco) => sql(banco, "copy (select version, name, statements from supabase_migrations.schema_migrations order by version) to stdout");
const versoes = (banco) => sql(banco, "select coalesce(string_agg(version, ',' order by version), '') from supabase_migrations.schema_migrations");
const existe = (banco, nome) => sql(banco, `select to_regclass('${nome}') is not null`) === "t";

const CASOS = {
  "202601010001_casos_do_divisor.sql": [
    "-- Ensaio do migrador: o que o divisor da CLI precisa cortar certo.",
    "/* bloco; com ponto e virgula /* aninhado; */ ainda comentario */",
    "create table public.casos (",
    "  id int primary key,",
    "  texto text not null default 'um;dois', -- ponto e virgula dentro de texto",
    '  "coluna;estranha" text',
    ");",
    "insert into public.casos (id, texto) values (1, 'it''s; ok'), (2, E'barra \\' e ponto e virgula ;'), (3, 'ação; com acento');",
    "insert into public.casos (id, texto) values (4, E'continua'",
    "  'na linha de baixo;');",
    "create function public.casos_dolar() returns text language plpgsql as $corpo$",
    "begin",
    "  return $$um; dois$$ || ';';",
    "end;",
    "$corpo$;",
    "create function public.casos_atomico(x int) returns int language sql",
    "begin atomic",
    "  select x + 1;",
    "end;",
    "comment on table public.casos is 'tabela; de ensaio';",
    "select 1;",
    "-- fim do arquivo: depois do ultimo ponto e virgula, a CLI guarda este comentario como mais um comando",
    ""
  ].join("\n"),
  "202601010002_sessao.sql":
    "-- Muda o search_path da sessao (sem LOCAL): sem o RESET ALL antes do proximo arquivo, o seguinte quebraria.\nset search_path = esquema_que_nao_existe;\ncreate table public.sessao (id int);\n",
  "202601010003_sem_ponto_e_virgula.sql": "create table depois_do_reset (id int)",
  "202601010004_sem_transacao.sql":
    "-- pg-delta: transaction=false\ncreate table if not exists public.grande (id int);\ncreate index concurrently if not exists grande_id on public.grande (id);\nvacuum public.grande;\n",
  "202601010005_valor_novo.sql": "create type public.cor as enum ('azul');\nalter type public.cor add value 'verde';\n"
};

// O que o splitAndTrim da CLI 2.121.0 devolve para cada arquivo acima.
const COMANDOS_DA_CLI = {
  "202601010001": [
    "-- Ensaio do migrador: o que o divisor da CLI precisa cortar certo.\n/* bloco; com ponto e virgula /* aninhado; */ ainda comentario */\ncreate table public.casos (\n  id int primary key,\n  texto text not null default 'um;dois', -- ponto e virgula dentro de texto\n  \"coluna;estranha\" text\n)",
    "insert into public.casos (id, texto) values (1, 'it''s; ok'), (2, E'barra \\' e ponto e virgula ;'), (3, 'ação; com acento')",
    "insert into public.casos (id, texto) values (4, E'continua'\n  'na linha de baixo;')",
    "create function public.casos_dolar() returns text language plpgsql as $corpo$\nbegin\n  return $$um; dois$$ || ';';\nend;\n$corpo$",
    "create function public.casos_atomico(x int) returns int language sql\nbegin atomic\n  select x + 1;\nend",
    "comment on table public.casos is 'tabela; de ensaio'",
    "select 1",
    "-- fim do arquivo: depois do ultimo ponto e virgula, a CLI guarda este comentario como mais um comando"
  ],
  "202601010002": [
    "-- Muda o search_path da sessao (sem LOCAL): sem o RESET ALL antes do proximo arquivo, o seguinte quebraria.\nset search_path = esquema_que_nao_existe",
    "create table public.sessao (id int)"
  ],
  "202601010003": ["create table depois_do_reset (id int)"],
  "202601010004": [
    "-- pg-delta: transaction=false\ncreate table if not exists public.grande (id int)",
    "create index concurrently if not exists grande_id on public.grande (id)",
    "vacuum public.grande"
  ],
  "202601010005": ["create type public.cor as enum ('azul')", "alter type public.cor add value 'verde'"]
};

test("aplica cada arquivo numa transacao, grava o historico como a CLI e a segunda rodada nao aplica nada", { skip }, () => {
  const banco = bancoNovo();
  const pasta = pacote(CASOS);

  const primeira = migrador(banco, pasta);
  assert.equal(primeira.status, 0, primeira.saida);
  assert.match(primeira.saida, /Aplicando 202601010004_sem_transacao\.sql \(sem transacao, comando por comando\)/);
  assert.match(primeira.saida, /202601010005_valor_novo\.sql tem ALTER TYPE \.\.\. ADD VALUE/);
  assert.match(primeira.saida, /Pronto: 5 migracoes aplicadas/);

  // A tabela do historico e a da CLI: version, statements e name, nessa ordem, com a chave em version.
  assert.equal(
    sql(banco, "select string_agg(column_name || ' ' || data_type || ' ' || is_nullable, ', ' order by ordinal_position) from information_schema.columns where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'"),
    "version text NO, statements ARRAY YES, name text YES"
  );
  assert.equal(sql(banco, "select conname from pg_constraint where conrelid = 'supabase_migrations.schema_migrations'::regclass and contype = 'p'"), "schema_migrations_pkey");
  const linhas = JSON.parse(sql(banco, "select json_agg(json_build_object('v', version, 'n', name, 's', statements) order by version) from supabase_migrations.schema_migrations"));
  assert.deepEqual(
    linhas.map((l) => l.v),
    Object.keys(COMANDOS_DA_CLI)
  );
  for (const linha of linhas) {
    assert.equal(linha.n, Object.keys(CASOS).find((nome) => nome.startsWith(linha.v)).slice(13, -4), `nome de ${linha.v}`);
    assert.deepEqual(linha.s, COMANDOS_DA_CLI[linha.v], `comandos de ${linha.v}`);
  }

  // O que os arquivos fizeram: os textos com ";" inteiros, o RESET ALL (a tabela sem esquema caiu em public), o indice
  // CONCURRENTLY valido e o valor novo do enum.
  assert.equal(sql(banco, "select string_agg(texto, '|' order by id) from public.casos"), "it's; ok|barra ' e ponto e virgula ;|ação; com acento|continuana linha de baixo;");
  assert.equal(sql(banco, "select public.casos_dolar() || public.casos_atomico(1)"), "um; dois;2");
  assert.ok(existe(banco, "public.depois_do_reset"), "o RESET ALL devolveu o search_path entre os arquivos");
  assert.equal(sql(banco, "select indisvalid from pg_index where indexrelid = 'public.grande_id'::regclass"), "t");
  assert.equal(sql(banco, "select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum where enumtypid = 'public.cor'::regtype"), "azul,verde");

  const antes = historico(banco);
  const segunda = migrador(banco, pasta);
  assert.equal(segunda.status, 0, segunda.saida);
  assert.match(segunda.saida, /Nada a aplicar: o banco ja esta em dia com o pacote \(5 migracoes\)/);
  assert.equal(historico(banco), antes);
  const lista = migrador(banco, pasta, ["--listar"]);
  assert.equal(lista.status, 0, lista.saida);
  assert.match(lista.saida, /O banco esta em dia com o pacote: nada a aplicar/);
});

test("--listar so le: lista o que falta e, num banco novo, nao cria nem o esquema do historico", { skip }, () => {
  const banco = bancoNovo();
  const r = migrador(banco, pacote(CASOS), ["--listar"]);
  assert.equal(r.status, 0, r.saida);
  assert.match(r.saida, /Faltam: 5\./);
  assert.match(r.saida, / {4}202601010004_sem_transacao\.sql \(sem transacao\)\n/);
  assert.match(r.saida, /Nada foi aplicado \(--listar\)/);
  assert.equal(sql(banco, "select to_regnamespace('supabase_migrations') is null"), "t");
  assert.equal(existe(banco, "public.casos"), false);
});

test("a migracao que falha e desfeita inteira; as anteriores ficam, a seguinte nao roda e, corrigida, o migrador continua dela", { skip }, () => {
  const banco = bancoNovo();
  const arquivos = {
    "202602010001_um.sql": "create table public.um (id int);\n",
    "202602010002_dois.sql": "create table public.dois (id int);\ninsert into public.dois values (1);\nselect 1 / 0;\n",
    "202602010003_tres.sql": "create table public.tres (id int);\n"
  };
  const r = migrador(banco, pacote(arquivos));
  assert.equal(r.status, 3, r.saida);
  assert.match(r.saida, /A migracao 202602010002_dois\.sql falhou e foi desfeita inteira: nada dela ficou no banco\. Aplicadas antes dela nesta execucao: 1\./);
  assert.match(r.saida, /202602010002_dois\.sql:3: ERROR: {2}division by zero/, "o arquivo e a linha, do proprio pacote");
  assert.doesNotMatch(r.saida, /\/tmp\/bkmigrar\./, "o caminho temporario do container nao aparece");
  assert.equal(versoes(banco), "202602010001");
  assert.equal(existe(banco, "public.um"), true);
  assert.equal(existe(banco, "public.dois"), false, "nada do arquivo que falhou ficou");
  assert.equal(existe(banco, "public.tres"), false, "o seguinte nao rodou");

  const corrigido = migrador(banco, pacote({ ...arquivos, "202602010002_dois.sql": "create table public.dois (id int);\ninsert into public.dois values (1);\n" }));
  assert.equal(corrigido.status, 0, corrigido.saida);
  assert.match(corrigido.saida, /Faltam: 2\./);
  assert.equal(versoes(banco), "202602010001,202602010002,202602010003");
});

test("recusa sem aplicar nada quando o historico nao bate com o pacote ou uma migracao aplicada mudou", { skip }, () => {
  const banco = bancoNovo();
  const base = {
    "202603010001_um.sql": "-- um\ncreate table public.um (id int);\ninsert into public.um values (1);\n",
    "202603010002_dois.sql": "create table public.dois (id int);\n",
    "202603010003_tres.sql": "create table public.tres (id int);\n"
  };
  assert.equal(migrador(banco, pacote(base)).status, 0);
  const pendente = { "202603010004_quatro.sql": "create table public.quatro (id int);\n" };
  const nadaAplicado = () => {
    assert.equal(versoes(banco), "202603010001,202603010002,202603010003");
    assert.equal(existe(banco, "public.quatro"), false);
  };

  const semArquivo = migrador(banco, pacote({ "202603010001_um.sql": base["202603010001_um.sql"], "202603010002_dois.sql": base["202603010002_dois.sql"], ...pendente }));
  assert.equal(semArquivo.status, 5, semArquivo.saida);
  assert.match(semArquivo.saida, /a versao 202603010003 esta no historico do banco e nao existe no pacote/);
  nadaAplicado();

  const foraDeOrdem = migrador(banco, pacote({ ...base, "202603010000_antes.sql": "create table public.antes (id int);\n", ...pendente }));
  assert.equal(foraDeOrdem.status, 5, foraDeOrdem.saida);
  assert.match(foraDeOrdem.saida, /202603010000_antes\.sql nunca foi aplicada e e mais velha que a ultima aplicada \(202603010003\)/);
  nadaAplicado();

  const mudou = migrador(banco, pacote({ ...base, "202603010001_um.sql": base["202603010001_um.sql"].replace("values (1)", "values (2)"), ...pendente }));
  assert.equal(mudou.status, 6, mudou.saida);
  assert.match(mudou.saida, /202603010001_um\.sql ja foi aplicada e o arquivo do pacote nao e mais o mesmo que rodou/);
  nadaAplicado();

  // Linhas em branco entre os comandos nao mudam o que roda (nem o que a CLI grava): passa, e aplica o pendente.
  const espacos = migrador(banco, pacote({ ...base, "202603010001_um.sql": base["202603010001_um.sql"].replace("\ninsert", "\n\n\ninsert"), ...pendente }));
  assert.equal(espacos.status, 0, espacos.saida);
  assert.equal(existe(banco, "public.quatro"), true);

  // O mesmo texto cortado de outro jeito (outra versao da CLI) e uma linha antiga sem os comandos so avisam.
  sql(banco, "update supabase_migrations.schema_migrations set statements = array[array_to_string(statements, ';')] where version = '202603010001'");
  sql(banco, "update supabase_migrations.schema_migrations set statements = null where version = '202603010002'");
  const avisos = migrador(banco, pacote({ ...base, ...pendente }));
  assert.equal(avisos.status, 0, avisos.saida);
  assert.match(avisos.saida, /AVISO: 202603010001_um\.sql: o historico cortou os comandos em outros lugares/);
  assert.match(avisos.saida, /AVISO: 202603010002_dois\.sql: o historico nao guarda os comandos desta migracao/);
});

test("recusa antes de aplicar: comando fora de transacao sem a diretiva, BEGIN e COMMIT, DISCARD, barra invertida, UTF-8 invalido e versao repetida", { skip }, () => {
  const banco = bancoNovo();
  const bom = { "202604010001_bom.sql": "create table public.bom (id int);\n" };
  const casos = [
    ["202604010002_indice.sql", "create table public.x (id int);\ncreate index concurrently x_id on public.x (id);\n", /nao roda dentro de transacao \(create index concurrently x_id on public\.x/],
    ["202604010002_transacao.sql", "begin;\ncreate table public.x (id int);\ncommit;\n", /abre ou fecha transacao por conta propria \(begin\)/],
    ["202604010002_discard.sql", "discard temp;\n", /tem DISCARD/],
    ["202604010002_barra.sql", "select 1;\n\\i /etc/passwd\n", /barra invertida fora de texto/],
    ["202604010002_latin1.sql", Buffer.from([0x73, 0x65, 0x6c, 0x65, 0x63, 0x74, 0x20, 0x27, 0xe7, 0x27, 0x3b, 0x0a]), /nao esta em UTF-8 valido/]
  ];
  for (const [nome, conteudo, motivo] of casos) {
    const r = migrador(banco, pacote({ ...bom, [nome]: conteudo }));
    assert.equal(r.status, 7, `${nome}: ${r.saida}`);
    assert.match(r.saida, motivo, nome);
    assert.match(r.saida, /Nada foi aplicado/);
  }
  const repetida = migrador(banco, pacote({ ...bom, "202604010002_a.sql": "select 1;\n", "202604010002_b.sql": "select 2;\n" }));
  assert.equal(repetida.status, 7, repetida.saida);
  assert.match(repetida.saida, /duas migracoes com a mesma versao no pacote: 202604010002_a\.sql, 202604010002_b\.sql/);
  assert.equal(sql(banco, "select to_regnamespace('supabase_migrations') is null"), "t", "nem o historico foi criado");
  assert.equal(existe(banco, "public.bom"), false);
});

test("com outra execucao segurando a trava, o migrador para com 4 e o --listar so avisa", { skip }, async () => {
  const banco = bancoNovo();
  const pasta = pacote({ "202605010001_um.sql": "create table public.um (id int);\n" });
  const segurar = "select pg_advisory_lock(70707, 1); select pg_sleep(6);";
  const outra = psqlLocal
    ? spawn("bash", ["-c", `${psqlLocal} -X -q -d "$1" -c "$2"`, "_", banco, segurar], { stdio: "ignore" })
    : spawn("docker", ["exec", "-i", CONTAINER, "psql", "-X", "-q", "-U", "postgres", "-d", banco, "-c", segurar], { stdio: "ignore" });
  const terminou = new Promise((resolve) => outra.on("exit", resolve));
  try {
    for (let i = 0; i < 50 && sql(banco, "select count(*) from pg_locks where locktype = 'advisory' and classid = 70707 and objid = 1 and granted") !== "1"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const ocupado = migrador(banco, pasta);
    assert.equal(ocupado.status, 4, ocupado.saida);
    assert.match(ocupado.saida, /Outra execucao do migrador esta aplicando migracoes neste banco agora\. A trava esta com o processo \d+ do Postgres\./);
    assert.equal(existe(banco, "public.um"), false);
    const lista = migrador(banco, pasta, ["--listar"]);
    assert.equal(lista.status, 0, lista.saida);
    assert.match(lista.saida, /AVISO: outra execucao do migrador esta aplicando agora/);
  } finally {
    await terminou;
  }
  const livre = migrador(banco, pasta);
  assert.equal(livre.status, 0, livre.saida);
  assert.equal(existe(banco, "public.um"), true);
});

test("a CLI do Supabase aplica os mesmos arquivos noutro banco: o historico sai igual byte a byte e o esquema tambem", { skip: skip || (!temCli && "sem a CLI do Supabase no PATH (so no CI)") }, () => {
  const daCli = bancoNovo();
  const doMigrador = bancoNovo();
  const projeto = mkdtempSync(join(tmpdir(), "kit-migrador-cli-"));
  pastas.push(projeto);
  mkdirSync(join(projeto, "supabase/migrations"), { recursive: true });
  writeFileSync(join(projeto, "supabase/config.toml"), config);
  for (const [nome, conteudo] of Object.entries(CASOS)) writeFileSync(join(projeto, "supabase/migrations", nome), conteudo);

  const cli = spawnSync("supabase", ["db", "push", "--db-url", `postgresql://postgres:postgres@127.0.0.1:${PORTA}/${daCli}`, "--workdir", projeto, "--yes"], { encoding: "utf8" });
  assert.equal(cli.status, 0, `${cli.stdout}${cli.stderr}`);
  const r = migrador(doMigrador, join(projeto, "supabase/migrations"));
  assert.equal(r.status, 0, r.saida);

  assert.equal(historico(doMigrador), historico(daCli));
  const esquema = (banco) => {
    const dump = spawnSync("docker", ["exec", CONTAINER, "pg_dump", "-U", "postgres", "-d", banco, "--schema-only"], { encoding: "utf8", maxBuffer: 1 << 26 });
    assert.equal(dump.status, 0, dump.stderr);
    return dump.stdout.replace(/^\\(un)?restrict .*$/gm, "");
  };
  assert.equal(esquema(doMigrador), esquema(daCli));
});
