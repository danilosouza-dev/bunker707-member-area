import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// Guardas do migrador do kit (docs/32 §11.6; docs/18 §1.2), conferidas no texto:
// - as ferramentas de SQL (infra/kit/migrador.sql) so criam objetos temporarios: nada delas entra no esquema da escola;
// - as migracoes do repositorio passam pelo migrador e pela CLI do mesmo jeito: nome <12 digitos>_<nome>.sql, versao
//   unica e nada que nao rode numa transacao (CONCURRENTLY, VACUUM, ALTER SYSTEM, CLUSTER, REINDEX, BEGIN/COMMIT soltos)
//   sem a primeira linha "-- pg-delta: transaction=false", e nunca DISCARD nem barra invertida fora de texto (o psql leria
//   como comando dele). A conferencia exata e a do proprio migrador, que o CI roda em todas;
// - a CLI pinada e a mesma em lib.sh, bootstrap.sh, no CI e na que o migrador copia: o divisor de comandos e a tabela do
//   historico sao os dela, entao trocar a versao pede conferir os dois de novo (o passo do CI compara);
// - o job de integracao compara o migrador com a CLI antes dos testes de integracao.

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const DIRETIVA = "-- pg-delta: transaction=false";

/**
 * O SQL sem comentarios, textos entre aspas, identificadores entre aspas e (com corpos = false) corpos $tag$...$tag$: o que o
 * Postgres le como codigo, numa passada so da esquerda para a direita.
 */
function codigoDe(sql, { corpos = false } = {}) {
  let saida = "";
  let i = 0;
  while (i < sql.length) {
    const resto = sql.slice(i);
    if (resto.startsWith("--")) {
      const fim = resto.search(/[\n\r]/);
      i += fim < 0 ? resto.length : fim;
    } else if (resto.startsWith("/*")) {
      let prof = 0;
      let j = 0;
      do {
        if (resto.startsWith("/*", j)) { prof++; j += 2; }
        else if (resto.startsWith("*/", j)) { prof--; j += 2; }
        else j++;
      } while (prof > 0 && j < resto.length);
      i += j;
      saida += " ";
    } else if (/^[eE]'/.test(resto) || resto[0] === "'") {
      const barras = resto[0] !== "'";
      let j = barras ? 2 : 1;
      while (j < resto.length) {
        if (barras && resto[j] === "\\") j += 2;
        else if (resto[j] === "'" && resto[j + 1] === "'") j += 2;
        else if (resto[j] === "'") break;
        else j++;
      }
      i += j + 1;
      saida += "''";
    } else if (resto[0] === '"') {
      i += resto.indexOf('"', 1) + 1;
      saida += '""';
    } else if (!corpos && /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.test(resto) && !/[A-Za-z0-9_$]/.test(sql[i - 1] ?? "")) {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(resto)[0];
      const fim = resto.indexOf(tag, tag.length);
      i += fim < 0 ? resto.length : fim + tag.length;
      saida += "$$";
    } else {
      saida += sql[i];
      i++;
    }
  }
  return saida;
}

test("as ferramentas do migrador so criam objetos temporarios: funcoes em pg_temp e tabelas temp, nada mais", () => {
  // Sem os comentarios e sem os textos entre aspas (os padroes de VACUUM, ALTER SYSTEM... da classificacao), mas com os
  // corpos das funcoes, que e onde ficam as escritas.
  const ferramentas = read("infra/kit/migrador.sql");
  const codigo = codigoDe(ferramentas, { corpos: true }).toLowerCase();
  const funcoes = codigo.match(/\bcreate\s+(?:or\s+replace\s+)?function\s+[\w.]+/g) ?? [];
  assert.ok(funcoes.length >= 10, "as funcoes das ferramentas");
  for (const f of funcoes) assert.match(f, /function\s+pg_temp\.bk_\w+$/, f);
  const tabelas = codigo.match(/\bcreate\s+(?:\w+\s+)*table\s+[\w.]+/g) ?? [];
  assert.ok(tabelas.length >= 4);
  for (const t of tabelas) assert.match(t, /^create\s+temp\s+table\s+bk_\w+$/, t);
  // So o que fica dentro de pg_temp e muda: nada de esquema, papel, permissao, extensao, gatilho ou apagar.
  assert.doesNotMatch(codigo, /\b(?:create\s+(?:schema|role|extension|trigger|view|index|type|policy|sequence)|alter\s+(?:table|role|schema|database|system|default)|drop|grant|revoke|truncate|vacuum|copy)\b/);
  for (const escrita of codigo.match(/\b(?:insert\s+into|update|delete\s+from)\s+[\w.]+/g) ?? []) {
    assert.match(escrita, /\s+pg_temp\.bk_\w+$/, escrita);
  }
  // O unico SQL montado na hora: copiar o historico para a tabela temporaria.
  const dinamicos = ferramentas.match(/\bexecute\s+format\('[^']*'/g) ?? [];
  assert.equal(dinamicos.length, 1);
  assert.match(dinamicos[0], /^execute format\('insert into pg_temp\.bk_historico \(versao, nome, comandos\) select version, %s, %s from supabase_migrations\.schema_migrations'$/);
});

test("as migracoes do repositorio cabem no migrador: nome com versao de 12 digitos e unica, e nada fora de transacao sem a diretiva", () => {
  const pasta = new URL("supabase/migrations/", root);
  const nomes = readdirSync(pasta).sort();
  assert.ok(nomes.length >= 65);
  const versoes = new Set();
  for (const nome of nomes) {
    assert.match(nome, /^\d{12}_[a-z0-9_]+\.sql$/, `${nome}: nome fora do padrao <versao de 12 digitos>_<nome>.sql`);
    const versao = nome.slice(0, 12);
    assert.ok(!versoes.has(versao), `${nome}: versao repetida`);
    versoes.add(versao);

    const bruto = readFileSync(new URL(nome, pasta));
    assert.doesNotThrow(() => new TextDecoder("utf-8", { fatal: true }).decode(bruto), `${nome}: UTF-8 invalido`);
    assert.notEqual(bruto[0], 0xef, `${nome}: sem BOM`);
    const sql = bruto.toString("utf8");
    const codigo = codigoDe(sql);
    assert.doesNotMatch(codigo, /\\/, `${nome}: barra invertida fora de texto (o psql leria como comando dele)`);
    const comandos = codigo.split(";").map((c) => c.trim().toLowerCase());
    assert.equal(comandos.some((c) => /^discard\b/.test(c)), false, `${nome}: DISCARD apagaria as tabelas temporarias do migrador`);
    if (sql.split("\n")[0] === DIRETIVA) continue;
    for (const c of comandos) {
      assert.doesNotMatch(c, /\bconcurrently\b|^(?:vacuum|cluster|reindex|alter\s+system)\b/, `${nome}: "${c.slice(0, 60)}" nao roda dentro de transacao; va para um arquivo proprio com a primeira linha "${DIRETIVA}"`);
      assert.doesNotMatch(c, /^(?:begin|commit|rollback|abort|start\s+transaction|prepare\s+transaction)\b/, `${nome}: o migrador e a CLI ja abrem a transacao do arquivo`);
    }
  }
});

test("a CLI pinada e a mesma no servidor, no CI e no migrador (o divisor e o historico copiados sao os dela)", () => {
  const lib = /SUPABASE_CLI_VERSION="\$\{SUPABASE_CLI_VERSION:-([\d.]+)\}"/.exec(read("infra/scripts/lib.sh"))?.[1];
  const bootstrap = /SUPABASE_CLI_VERSION="\$\{SUPABASE_CLI_VERSION:-([\d.]+)\}"/.exec(read("infra/scripts/bootstrap.sh"))?.[1];
  const ci = /uses: supabase\/setup-cli@v\d+\n\s+with:\n\s+version: ([\d.]+)/.exec(read(".github/workflows/ci.yml"))?.[1];
  const ferramentas = /CLI do Supabase ([\d.]+) \(a versao pinada/.exec(read("infra/kit/migrador.sql"))?.[1];
  const migrar = /como a CLI ([\d.]+)\n/.exec(read("infra/kit/migrar.sh"))?.[1];
  assert.ok(lib, "versao em lib.sh");
  assert.deepEqual(
    { bootstrap, ci, ferramentas, migrar },
    { bootstrap: lib, ci: lib, ferramentas: lib, migrar: lib },
    "trocou a versao da CLI? confira o divisor (sql-split.ts) e o createMigrationTable dela contra infra/kit/migrador.sql, e atualize as tres"
  );
});

test("o job de integracao compara o migrador com a CLI depois de subir o Supabase local e antes dos testes de integracao", () => {
  const ci = read(".github/workflows/ci.yml");
  const supabase = ci.indexOf("run: node tests/support/db.mjs start --ci");
  const migrador = ci.indexOf("run: bash tests/support/kit-migrador-contra-cli.sh");
  const integracao = ci.indexOf("run: npm run test:integration");
  assert.ok(supabase > 0 && migrador > supabase && integracao > migrador, `${supabase} < ${migrador} < ${integracao}`);
});
