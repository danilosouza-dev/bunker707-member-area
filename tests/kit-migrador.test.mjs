import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

// O migrador do kit (infra/kit/migrar.sh; docs/32 §11.6) com um psql e um docker de mentira: o roteiro que ele manda ao
// psql (trava, plano, conferencia, a tabela do historico como a da CLI e um bloco por arquivo), como le o que o psql
// conta e como traduz cada saida em mensagem e codigo; no container, a copia do pacote e a limpeza. O que o SQL faz de
// verdade (o divisor, o plano, a trava, as transacoes) roda contra um Postgres em tests/integration/kit-migrador.test.mjs.

const script = fileURLToPath(new URL("../infra/kit/migrar.sh", import.meta.url));
const ferramentas = readFileSync(new URL("../infra/kit/migrador.sql", import.meta.url), "utf8");
const SEP = "\x1f";
const linha = (...campos) => `BKMIGRAR${SEP}${campos.join(SEP)}\n`;
const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

// O psql de mentira: guarda o roteiro e os argumentos, escreve a saida e os erros pedidos e sai com o codigo pedido.
// {DIR} nos erros vira a pasta de onde o roteiro le os arquivos (a pasta temporaria, no container).
const PSQL = String.raw`
import fs from "node:fs";
export function psql(args, extra = {}) {
  const env = process.env;
  const roteiro = fs.readFileSync(0, "utf8");
  fs.writeFileSync(env.SHIM_ROTEIRO, roteiro);
  fs.appendFileSync(env.SHIM_LOG, JSON.stringify({ tool: "psql", args, app: env.PGAPPNAME, encoding: env.PGCLIENTENCODING, options: env.PGOPTIONS, ...extra }) + "\n");
  const dir = (/^\\i '(.*)\/[^\/]+\.sql'$/m.exec(roteiro) ?? [])[1] ?? "";
  if (env.SHIM_SAIDA) process.stdout.write(fs.readFileSync(env.SHIM_SAIDA, "utf8"));
  if (env.SHIM_ERROS) process.stderr.write(fs.readFileSync(env.SHIM_ERROS, "utf8").replaceAll("{DIR}", dir));
  process.exit(Number(env.SHIM_CODIGO ?? 0));
}
if (process.argv[1].endsWith("psql.mjs")) psql(process.argv.slice(2));
`;

const DOCKER = String.raw`
import fs from "node:fs";
import { psql } from "./psql.mjs";
const args = process.argv.slice(2);
const env = process.env;
const log = () => fs.appendFileSync(env.SHIM_LOG, JSON.stringify({ tool: "docker", args }) + "\n");
if (args[0] === "compose") {
  log();
  if (args.includes("ps") && (env.SHIM_CID ?? "cid-do-compose")) console.log(env.SHIM_CID ?? "cid-do-compose");
  process.exit(0);
}
if (args[0] === "inspect") { log(); console.log(env.SHIM_RODANDO ?? "true"); process.exit(0); }
if (args[0] === "cp") { log(); process.exit(env.SHIM_CP_FALHA ? 1 : 0); }
if (args[0] === "exec" && args.includes("psql")) { log(); psql(args.slice(args.indexOf("psql") + 1), { via: "docker" }); }
log();
process.exit(0);
`;

/** Uma pasta com shims (docker e psql), um pacote de migracoes e o .env do compose; `rodar` chama o migrar.sh. */
function ambiente(arquivos = { "202601010001_um.sql": "create table a (id int);\n", "202601010002_dois.sql": "-- ação\nselect 'ç';\n" }) {
  const dir = mkdtempSync(join(tmpdir(), "kit-migrador-"));
  dirs.push(dir);
  const shims = join(dir, "shims");
  mkdirSync(shims);
  writeFileSync(join(dir, "psql.mjs"), PSQL);
  writeFileSync(join(dir, "docker.mjs"), DOCKER);
  writeFileSync(join(shims, "docker"), `#!/bin/sh\nexec "${process.execPath}" "${join(dir, "docker.mjs")}" "$@"\n`);
  chmodSync(join(shims, "docker"), 0o755);
  const pasta = join(dir, "migracoes");
  mkdirSync(pasta);
  for (const [nome, conteudo] of Object.entries(arquivos)) writeFileSync(join(pasta, nome), conteudo);
  const envFile = join(dir, "compose.env");
  writeFileSync(envFile, "POSTGRES_DB=escola\nPOSTGRES_PASSWORD=senha-do-banco-que-nao-pode-sair\n");
  const log = join(dir, "chamadas.log");
  const roteiroFile = join(dir, "roteiro.sql");
  const psqlLocal = `${process.execPath} ${join(dir, "psql.mjs")}`;
  const rodar = (args = [], { saida = "", erros = "", codigo = 0, ...extra } = {}) => {
    writeFileSync(join(dir, "saida.txt"), saida);
    writeFileSync(join(dir, "erros.txt"), erros);
    const env = {
      ...process.env,
      PATH: `${shims}:${process.env.PATH}`,
      BUNKER707_ENV_FILE: envFile,
      SHIM_LOG: log,
      SHIM_ROTEIRO: roteiroFile,
      SHIM_SAIDA: join(dir, "saida.txt"),
      SHIM_ERROS: join(dir, "erros.txt"),
      SHIM_CODIGO: String(codigo),
      ...extra
    };
    for (const nome of ["MIGRAR_PSQL", "MIGRAR_CONTAINER", "BUNKER707_COMPOSE_FILE"]) if (!(nome in extra)) delete env[nome];
    const r = spawnSync("bash", [script, "--pasta", pasta, ...args], { encoding: "utf8", env });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  const chamadas = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const roteiro = () => readFileSync(roteiroFile, "utf8");
  return { dir, pasta, psqlLocal, rodar, chamadas, roteiro };
}

/** O que o psql conta numa rodada que aplica tudo: resumo, pendentes, cada arquivo e o fim. */
function saidaAplicando(arquivos, { historico = 0, modo = {} } = {}) {
  let s = linha("R", String(arquivos.length + historico), String(historico), String(arquivos.length));
  for (const nome of arquivos) s += linha("P", nome.slice(0, 12), nome, modo[nome] ?? "transacao");
  for (const nome of arquivos) s += linha("aplicando", nome.slice(0, 12), nome) + linha("aplicada", nome.slice(0, 12));
  return s + linha("fim");
}

test("aplicar: trava, plano e conferencia antes de tudo; cada arquivo numa transacao com a linha do historico; o pacote vai inteiro", () => {
  const amb = ambiente();
  const r = amb.rodar([], { MIGRAR_PSQL: amb.psqlLocal, saida: saidaAplicando(["202601010001_um.sql", "202601010002_dois.sql"]) });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Pacote: 2 migracoes\. No historico do banco: 0\. Faltam: 2\./);
  assert.match(r.stdout, /==> Aplicando 202601010001_um\.sql\n==> Aplicando 202601010002_dois\.sql\n/);
  assert.match(r.stdout, /Pronto: 2 migracoes aplicadas em \d+s; o banco esta em dia com o pacote\./);

  const [chamada] = amb.chamadas().filter((c) => c.tool === "psql");
  assert.deepEqual(chamada.args, ["-X", "-q", "-v", "ON_ERROR_STOP=1"]);
  assert.equal(chamada.app, "bunker-migrar");
  assert.equal(chamada.encoding, "UTF8");
  assert.equal(chamada.options, "-c client_min_messages=warning");

  const roteiro = amb.roteiro();
  assert.ok(roteiro.startsWith("\\set QUIET on\n\\set ON_ERROR_STOP on\n"), "para no primeiro erro");
  assert.ok(roteiro.includes(ferramentas), "as ferramentas de SQL entram inteiras");
  // Os bytes de cada arquivo, em base64, voltam iguais (acento incluido).
  for (const [nome, versao, rotulo] of [["202601010001_um.sql", "202601010001", "um"], ["202601010002_dois.sql", "202601010002", "dois"]]) {
    const m = new RegExp(`values \\('${versao}', '${rotulo}', '${nome.replace(".", "\\.")}', decode\\('\\n([A-Za-z0-9+/=\\n]+)', 'base64'\\)\\);`).exec(roteiro);
    assert.ok(m, `${nome} no pacote`);
    assert.deepEqual(Buffer.from(m[1].replace(/\n/g, ""), "base64"), readFileSync(join(amb.pasta, nome)));
  }
  const ordem = ["select pg_temp.bk_travar();", "select * from pg_temp.bk_planejar();", "select pg_temp.bk_conferir();", "CREATE SCHEMA IF NOT EXISTS supabase_migrations;", "\\echo 'BKMIGRAR\\x1faplicando\\x1f202601010001"].map((t) => roteiro.indexOf(t));
  assert.ok(ordem.every((i, n) => i > 0 && (n === 0 || i > ordem[n - 1])), `ordem: ${ordem}`);
  // A tabela do historico como o createMigrationTable da CLI 2.121.0, numa transacao, so sem as tres colunas.
  assert.ok(
    roteiro.includes(
      [
        "\\if :bk_tem_pendentes",
        "\\if :bk_historico_pronto",
        "\\else",
        "BEGIN;",
        "SET LOCAL lock_timeout = '4s';",
        "CREATE SCHEMA IF NOT EXISTS supabase_migrations;",
        "CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text NOT NULL PRIMARY KEY);",
        "ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS statements text[];",
        "ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS name text;",
        "COMMIT;",
        "\\endif",
        "\\endif"
      ].join("\n")
    )
  );
  // Cada arquivo: so se o plano mandar; RESET ALL; o arquivo e a linha do historico na mesma transacao (ou, com a
  // diretiva, sem transacao); a saida do arquivo vai para /dev/null.
  const bloco = (versao, nome) =>
    [
      `\\if :bk_aplicar`,
      `\\echo 'BKMIGRAR\\x1faplicando\\x1f${versao}\\x1f${nome}'`,
      "RESET ALL;",
      "\\if :bk_sem_transacao",
      "\\o /dev/null",
      `\\i '${amb.pasta}/${nome}'`,
      "\\o",
      `INSERT INTO supabase_migrations.schema_migrations (version, name, statements) SELECT versao, nome, comandos FROM pg_temp.bk_plano WHERE versao = '${versao}';`,
      "\\else",
      "BEGIN;",
      "\\o /dev/null",
      `\\i '${amb.pasta}/${nome}'`,
      "\\o",
      `INSERT INTO supabase_migrations.schema_migrations (version, name, statements) SELECT versao, nome, comandos FROM pg_temp.bk_plano WHERE versao = '${versao}';`,
      "COMMIT;",
      "\\endif",
      `\\echo 'BKMIGRAR\\x1faplicada\\x1f${versao}'`,
      "\\endif"
    ].join("\n");
  const um = roteiro.indexOf(bloco("202601010001", "202601010001_um.sql"));
  const dois = roteiro.indexOf(bloco("202601010002", "202601010002_dois.sql"));
  assert.ok(um > 0 && dois > um, "um bloco por arquivo, na ordem das versoes");
  assert.match(roteiro.slice(0, um), /select coalesce\(\(select aplicar from pg_temp\.bk_plano where versao = '202601010001'\), false\) as bk_aplicar, coalesce\(\(select modo = 'sem_transacao' from pg_temp\.bk_plano where versao = '202601010001'\), false\) as bk_sem_transacao \\gset\n$/);
  assert.ok(roteiro.trimEnd().endsWith("\\echo 'BKMIGRAR\\x1ffim'"));
});

test("--listar so le: sem trava, sem historico e sem nenhum arquivo; mostra o que falta e quem roda sem transacao", () => {
  const amb = ambiente();
  const saida =
    linha("R", "2", "0", "2") +
    linha("A", "", "outra execucao do migrador esta aplicando agora; a lista pode mudar em instantes.") +
    linha("P", "202601010001", "202601010001_um.sql", "transacao") +
    linha("P", "202601010002", "202601010002_dois.sql", "sem_transacao") +
    linha("fim");
  const r = amb.rodar(["--listar"], { MIGRAR_PSQL: amb.psqlLocal, saida });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Faltam: 2\.\n {4}202601010001_um\.sql\n {4}202601010002_dois\.sql \(sem transacao\)\n==> Nada foi aplicado \(--listar\)\./);
  assert.match(r.stderr, /AVISO: outra execucao do migrador esta aplicando agora/);
  // Depois das ferramentas (que so criam funcoes e tabelas temporarias), nada que grave ou pegue a trava.
  const roteiro = amb.roteiro().split(ferramentas)[1];
  assert.ok(roteiro.indexOf("set session characteristics as transaction read only;") < roteiro.indexOf("select * from pg_temp.bk_planejar();"));
  for (const proibido of ["bk_travar()", "\\i ", "INSERT INTO supabase_migrations", "CREATE SCHEMA", "BEGIN;", "RESET ALL"]) {
    assert.equal(roteiro.includes(proibido), false, `--listar sem ${proibido}`);
  }
});

test("cada saida do psql vira mensagem e codigo: trava 4, historico 5, alterada 6, recusada 7, conexao 2 e migracao que falha 3", () => {
  const casos = [
    {
      nome: "trava",
      erros: "psql:<stdin>:900: ERROR:  bkmigrar:trava\nDETAIL:  A trava esta com o processo 4242 do Postgres.\nCONTEXT:  PL/pgSQL function pg_temp_3.bk_travar() line 7 at RAISE\n",
      codigo: 3,
      status: 4,
      mensagem: /ERRO: Outra execucao do migrador esta aplicando migracoes neste banco agora\. A trava esta com o processo 4242 do Postgres\. Espere ela terminar e rode de novo\./
    },
    {
      nome: "historico",
      saida: linha("R", "1", "2", "0") + linha("X", "historico", "202512310001", "a versao 202512310001 esta no historico do banco e nao existe no pacote."),
      erros: "psql:<stdin>:901: ERROR:  bkmigrar:historico\nDETAIL:  Nada foi aplicado.\n",
      codigo: 3,
      status: 5,
      mensagem: /ERRO: a versao 202512310001 esta no historico[\s\S]*ERRO: O historico do banco nao bate com o pacote/
    },
    {
      nome: "alterada",
      saida: linha("X", "alterada", "202601010001", "202601010001_um.sql ja foi aplicada e o arquivo do pacote nao e mais o mesmo que rodou."),
      erros: "ERROR:  bkmigrar:alterada\n",
      codigo: 3,
      status: 6,
      mensagem: /ERRO: 202601010001_um\.sql ja foi aplicada[\s\S]*ERRO: Uma migracao que o banco ja aplicou mudou no pacote/
    },
    { nome: "recusada", saida: linha("X", "recusada", "202601010002", "202601010002_dois.sql tem DISCARD."), erros: "ERROR:  bkmigrar:recusada\n", codigo: 3, status: 7, mensagem: /Arquivo do pacote recusado/ },
    {
      nome: "conexao",
      erros: 'psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory\n',
      codigo: 2,
      status: 2,
      mensagem: /connection to server on socket[\s\S]*ERRO: Nao consegui conectar no banco/
    },
    {
      nome: "falha no meio",
      saida: linha("R", "2", "0", "2") + linha("P", "202601010001", "202601010001_um.sql", "transacao") + linha("P", "202601010002", "202601010002_dois.sql", "transacao") + linha("aplicando", "202601010001", "202601010001_um.sql") + linha("aplicada", "202601010001") + linha("aplicando", "202601010002", "202601010002_dois.sql"),
      erros: "psql:/pasta/202601010002_dois.sql:2: ERROR:  division by zero\n",
      codigo: 3,
      status: 3,
      mensagem: /division by zero[\s\S]*ERRO: A migracao 202601010002_dois\.sql falhou e foi desfeita inteira: nada dela ficou no banco\. Aplicadas antes dela nesta execucao: 1\./
    },
    {
      nome: "falha sem transacao",
      saida: linha("P", "202601010001", "202601010001_um.sql", "sem_transacao") + linha("aplicando", "202601010001", "202601010001_um.sql"),
      erros: "ERROR:  relation \"x\" does not exist\n",
      codigo: 3,
      status: 3,
      mensagem: /ERRO: A migracao 202601010001_um\.sql falhou\. Ela roda sem transacao: os comandos dela que vieram antes do erro ficaram no banco/
    }
  ];
  for (const caso of casos) {
    const amb = ambiente();
    const r = amb.rodar([], { MIGRAR_PSQL: amb.psqlLocal, saida: caso.saida ?? "", erros: caso.erros, codigo: caso.codigo });
    assert.equal(r.status, caso.status, `${caso.nome}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, caso.mensagem, caso.nome);
    assert.doesNotMatch(r.stderr, /bkmigrar:/, `${caso.nome}: o codigo interno nao aparece`);
  }
});

test("nomes: pula o que nao e <versao>_<nome>.sql (como a CLI), recusa nome fora do padrao e para sem migracao nenhuma, sem chamar o psql", () => {
  const pula = ambiente({ "202601010001_um.sql": "select 1;\n", "LEIAME.md": "x", "rascunho.sql": "select 2;\n" });
  mkdirSync(join(pula.pasta, "202601010003_pasta.sql"));
  const r = pula.rodar([], { MIGRAR_PSQL: pula.psqlLocal, saida: saidaAplicando(["202601010001_um.sql"]) });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /AVISO: pulei LEIAME\.md: o nome precisa ser <versao>_<nome>\.sql/);
  assert.match(r.stderr, /AVISO: pulei rascunho\.sql/);
  assert.match(r.stdout, /\(1 arquivo\)/);
  assert.doesNotMatch(pula.roteiro(), /rascunho|LEIAME|202601010003_pasta/);

  const recusa = ambiente({ "202601010001_com espaco.sql": "select 1;\n" });
  const r2 = recusa.rodar([], { MIGRAR_PSQL: recusa.psqlLocal });
  assert.equal(r2.status, 7);
  assert.match(r2.stderr, /202601010001_com espaco\.sql: o nome so pode ter letras sem acento, numeros, ponto, hifen e sublinhado/);
  assert.equal(recusa.chamadas().length, 0);

  const vazia = ambiente({ "LEIAME.md": "x" });
  const r3 = vazia.rodar([], { MIGRAR_PSQL: vazia.psqlLocal });
  assert.equal(r3.status, 1);
  assert.match(r3.stderr, /Nenhuma migracao em /);
  assert.equal(vazia.chamadas().length, 0);

  const opcao = vazia.rodar(["--apagar-tudo"]);
  assert.equal(opcao.status, 1);
  assert.match(opcao.stderr, /opcao desconhecida: --apagar-tudo/);
  const ajuda = vazia.rodar(["--help"]);
  assert.equal(ajuda.status, 0);
  assert.match(ajuda.stdout, /bash infra\/kit\/migrar\.sh --listar/);
});

test("no container: o pacote vai para uma pasta so desta execucao, o psql roda como postgres pelo socket e a pasta e apagada no fim", () => {
  const amb = ambiente();
  const saida =
    linha("R", "2", "0", "2") +
    linha("P", "202601010001", "202601010001_um.sql", "transacao") +
    linha("P", "202601010002", "202601010002_dois.sql", "transacao") +
    linha("aplicando", "202601010001", "202601010001_um.sql") +
    linha("aplicada", "202601010001") +
    linha("aplicando", "202601010002", "202601010002_dois.sql");
  const r = amb.rodar(["--banco", "outro_banco"], {
    MIGRAR_CONTAINER: "supabase_db_teste",
    saida,
    erros: "psql:{DIR}/202601010002_dois.sql:2: ERROR:  syntax error at or near \"x\"\n",
    codigo: 3
  });
  assert.equal(r.status, 3, r.stderr);
  const docker = amb.chamadas().filter((c) => c.tool === "docker").map((c) => c.args);
  assert.deepEqual(docker[0], ["inspect", "-f", "{{.State.Running}}", "supabase_db_teste"]);
  assert.equal(docker[1][0], "cp");
  assert.ok(docker[1][1].endsWith("/migracoes/."));
  const destino = /^supabase_db_teste:(\/tmp\/bkmigrar\.\d+\.\d+)$/.exec(docker[1][2]);
  assert.ok(destino, docker[1][2]);
  assert.deepEqual(docker[2], [
    "exec", "-i", "-e", "PGAPPNAME=bunker-migrar", "-e", "PGCLIENTENCODING=UTF8", "-e", "PGOPTIONS=-c client_min_messages=warning",
    "supabase_db_teste", "psql", "-U", "postgres", "-d", "outro_banco", "-X", "-q", "-v", "ON_ERROR_STOP=1"
  ]);
  assert.deepEqual(docker.at(-1), ["exec", "supabase_db_teste", "rm", "-rf", "--", destino[1]]);
  assert.ok(amb.roteiro().includes(`\\i '${destino[1]}/202601010001_um.sql'`), "o psql le a copia de dentro do container");
  // A mensagem aponta o arquivo do pacote, nao a copia temporaria.
  assert.match(r.stderr, new RegExp(`psql:${amb.pasta}/202601010002_dois\\.sql:2: ERROR:  syntax error`));
  assert.doesNotMatch(r.stderr, /bkmigrar\.\d/);
});

test("compose: le o banco do .env, para com 2 sem o servico db no ar e com 2 se a copia para o container falhar", () => {
  const amb = ambiente();
  const r = amb.rodar([], { saida: saidaAplicando(["202601010001_um.sql", "202601010002_dois.sql"]) });
  assert.equal(r.status, 0, r.stderr);
  const docker = amb.chamadas().filter((c) => c.tool === "docker").map((c) => c.args.join(" "));
  assert.ok(docker[0].startsWith("compose -f ") && docker[0].endsWith(" ps -q --status running db"), docker[0]);
  assert.ok(docker.some((c) => c.includes("cid-do-compose psql -U postgres -d escola -X")), "POSTGRES_DB do .env");

  const fora = ambiente();
  const r2 = fora.rodar([], { SHIM_CID: "" });
  assert.equal(r2.status, 2);
  assert.match(r2.stderr, /O banco \(servico db de .*docker-compose\.yml\) nao esta no ar/);
  assert.equal(fora.chamadas().some((c) => c.tool === "psql"), false);

  const semCopia = ambiente();
  const r3 = semCopia.rodar([], { SHIM_CP_FALHA: "1" });
  assert.equal(r3.status, 2);
  assert.match(r3.stderr, /Nao consegui copiar as migracoes para o container do banco/);
  assert.equal(semCopia.chamadas().some((c) => c.tool === "psql"), false);

  const parado = ambiente();
  const r4 = parado.rodar([], { MIGRAR_CONTAINER: "supabase_db_teste", SHIM_RODANDO: "false" });
  assert.equal(r4.status, 2);
  assert.match(r4.stderr, /O container supabase_db_teste nao esta no ar/);
});

test("nada do ambiente nem da conexao do psql aparece na saida, nem quando o banco recusa", () => {
  const segredo = "segredo-que-nunca-sai-1234";
  for (const caso of [{ saida: saidaAplicando(["202601010001_um.sql", "202601010002_dois.sql"]) }, { erros: "psql: error: connection to server failed: FATAL:  password authentication failed for user \"postgres\"\n", codigo: 2 }]) {
    const amb = ambiente();
    const r = amb.rodar([], { MIGRAR_PSQL: `${amb.psqlLocal} password=${segredo}`, PGPASSWORD: segredo, ...caso });
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, new RegExp(segredo));
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /senha-do-banco-que-nao-pode-sair/);
  }
});
