import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// Guarda da midia pelo caminho (docs/32 §11.5; src/server/db/storage-paths.ts), conferida no texto: nenhum codigo novo
// grava o endereco inteiro do Storage.
// - todo cliente do Supabase em src/ e conhecido: os dois que leem e gravam dados (getSupabaseAdminClient e
//   createSupabaseServerClient) passam pelo fetch que guarda o caminho; o do proxy so confere a sessao e le admin_roles;
//   o do navegador so faz login e grava student_events. Cliente novo em src/ falha aqui ate passar pelo fetch;
// - os scripts que gravam no banco e o cliente da sessao dos testes de integracao usam o mesmo fetch;
// - o fetch guarda o caminho so no que vai ao PostgREST e nunca e trocado por outro no caminho.

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
/** Sem comentarios: o que sobra e o codigo. */
const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

function sourceFiles(directory) {
  return readdirSync(new URL(directory, root), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx|mts|js|mjs)$/.test(entry.name))
    .map((entry) => `${entry.parentPath.replace(new URL(root).pathname, "").replace(/\/?$/, "/")}${entry.name}`);
}

const CLIENT_CALL = /\b(createClient|createServerClient|createBrowserClient)\s*\(/g;

test("todo cliente do Supabase em src/ e conhecido; os dois que leem e gravam dados passam pelo fetch que guarda o caminho", () => {
  const calls = sourceFiles("src/").flatMap((file) => [...codeOf(read(file)).matchAll(CLIENT_CALL)].map((match) => `${file}: ${match[1]}`));

  assert.deepEqual(calls.sort(), [
    "src/lib/supabase/browser.ts: createBrowserClient",
    "src/proxy.ts: createServerClient",
    "src/server/auth/supabase.ts: createServerClient",
    "src/server/db/supabase/client.ts: createClient"
  ], "cliente novo do Supabase: passe global.fetch = createStoragePathsFetch(<endereco>) e ponha aqui");

  const admin = codeOf(read("src/server/db/supabase/client.ts"));
  assert.match(admin, /import \{ createStoragePathsFetch \} from "@\/server\/db\/storage-paths";/);
  assert.match(admin, /return createClient\(supabaseUrl, supabaseSecretKey, \{[\s\S]*global: \{ fetch: createStoragePathsFetch\(supabaseUrl\) \}\s*\}\);/);

  const session = codeOf(read("src/server/auth/supabase.ts"));
  assert.match(session, /import \{ createStoragePathsFetch \} from "@\/server\/db\/storage-paths";/);
  assert.match(session, /return createServerClient\(url, anonKey, \{[\s\S]*global: \{ fetch: createStoragePathsFetch\(url\) \}\s*\}\);/);
  assert.match(session, /const \{ anonKey, url \} = getSupabaseAuthConfig\(\);/, "o endereco do cliente e o do fetch sao o mesmo");
});

test("o cliente do proxy so le admin_roles e o do navegador so grava student_events: nenhum dos dois toca em arquivo", () => {
  const proxy = codeOf(read("src/proxy.ts"));
  assert.deepEqual([...proxy.matchAll(/\.from\(\s*"([^"]+)"/g)].map((match) => match[1]), ["admin_roles"]);
  assert.doesNotMatch(proxy, /\.rpc\(|\.storage\b/);

  const browserUsers = sourceFiles("src/").filter((file) => /createBrowserSupabaseClient\(/.test(codeOf(read(file))) && file !== "src/lib/supabase/browser.ts");
  assert.ok(browserUsers.length >= 2, browserUsers.join(", "));
  for (const file of browserUsers) {
    const code = codeOf(read(file));
    assert.deepEqual([...new Set([...code.matchAll(/\.from\(\s*"([^"]+)"/g)].map((match) => match[1]))], ["student_events"], file);
    assert.doesNotMatch(code, /\.rpc\(|\.storage\b/, file);
  }
});

test("os scripts que gravam no banco e o cliente da sessao dos testes de integracao usam o mesmo fetch", () => {
  for (const file of sourceFiles("scripts/")) {
    const code = codeOf(read(file));
    if (!CLIENT_CALL.test(code)) continue;
    CLIENT_CALL.lastIndex = 0;
    assert.match(code, /import \{ createStoragePathsFetch \} from "\.\.\/src\/server\/db\/storage-paths\.ts";/, file);
    assert.match(code, /global: \{ fetch: createStoragePathsFetch\(supabaseUrl\) \}/, file);
  }

  const stub = codeOf(read("tests/support/integration-session.mjs"));
  assert.match(stub, /global: \{ fetch: createStoragePathsFetch\(url\) \}/, "a sessao do aluno nos testes grava como a do app");
});

test("o fetch: so /rest/v1/ muda, a tabela fora da regra e a da Oferta, e o modulo fica puro", () => {
  const source = read("src/server/db/storage-paths.ts");
  const code = codeOf(source);

  assert.doesNotMatch(code, /^import\b/m, "puro: sem import (o servidor, os testes e os scripts carregam direto pelo Node)");
  assert.doesNotMatch(code, /server-only/);
  assert.match(code, /export const STORAGE_PUBLIC_ROUTES = \["\/storage\/v1\/object\/public\/", "\/storage\/v1\/render\/image\/public\/"\] as const;/);
  assert.match(code, /export const STORAGE_PATHS_SKIPPED_TABLES: readonly string\[\] = \["webinar_offer_variants"\];/);
  assert.match(code, /const index = pathname\.indexOf\("\/rest\/v1\/"\);/);
  // O fetch global e lido na hora do pedido (o Next e o Sentry poem o deles depois que o modulo carrega).
  assert.match(code, /\(baseFetch \?\? globalThis\.fetch\)\(input, init\)/);
});

const sqlCodeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");
const CHECKS_MIGRATION = "supabase/migrations/202611120001_storage_paths_checks.sql";
const STORED_FORM = "'^/storage/v1/(object|render/image)/public/[^[:space:]]+$'";

test("a 202611120001: duas secoes MCP, idempotente; so troca os checks de endereco (nenhum dado muda aqui)", () => {
  const migration = read(CHECKS_MIGRATION);
  const code = sqlCodeOf(migration);

  assert.deepEqual(migration.match(/^ \* \d\. .+$/gm), [
    " * 1. Os checks de endereco aceitam o caminho do Storage, sem ler as linhas. MCP.",
    " * 2. A conferencia das linhas que ja existem (de novo, nada muda). MCP."
  ]);
  assert.match(migration, /^-- Idempotente: pode ser executada mais de uma vez sem efeito colateral\.$/m);
  assert.doesNotMatch(migration, /popup_design/, "a guarda do Livre proibe migracao nova que cite a coluna do design");
  assert.doesNotMatch(code, /\bpublic\.webinars?\b|\bpublic\.webinar_\w+/, "nao mexe nas tabelas dos webinarios (o aviso de migracao pendente deles aponta a mais nova que mexe)");
  for (const proibido of [/\bupdate\s+public\./i, /\binsert\s+into\b/i, /\bdelete\s+from\b/i, /\btruncate\b/i, /\bcreate\s+(?:table|policy|index|trigger)\b/i, /\balter\s+policy\b/i, /\bgrant\b|\brevoke\b/i, /security\s+definer/i, /\bconcurrently\b/i]) {
    assert.doesNotMatch(code, proibido);
  }

  // O unico drop: o check antigo achado pela definicao, dentro do bloco que so roda sem o check novo.
  assert.deepEqual(
    [...code.matchAll(/\bdrop\b[^;]*/gi)].map((match) => match[0]),
    [
      "drop constraint %I', v_old.conname)",
      "drop constraint %I', v_old.conname)",
      "drop constraint %I', v_old.conname)"
    ]
  );
  for (const [table, column, name, pattern] of [
    ["campaigns", "image_url", "campaigns_image_url_v2", "^https?://"],
    ["campaigns", "audio_url", "campaigns_audio_url_v2", "^https?://"],
    ["lesson_materials", "file_url", "lesson_materials_file_url_v2", "^https://"]
  ]) {
    const block = code.slice(code.indexOf(`where conname = '${name}'`), code.indexOf(`) not valid;`, code.indexOf(`add constraint ${name}`)));
    assert.match(block, new RegExp(`and pg_get_constraintdef\\(oid\\) like '%\\(${column} ~ ''${pattern.replace(/[?^/]/g, "\\$&")}%'`), name);
    assert.match(block, new RegExp(`execute format\\('alter table public\\.${table} drop constraint %I', v_old\\.conname\\);`), name);
    assert.ok(block.includes(`${column} ~ ${STORED_FORM}`), `${name} aceita o caminho guardado`);
    assert.match(code, new RegExp(`alter table public\\.${table} validate constraint ${name};`), name);
  }
});

test("todo check de endereco https das migracoes aceita o caminho guardado ou e de uma tabela que o fetch deixa como esta", async () => {
  const { STORAGE_PATHS_SKIPPED_TABLES } = await import("../src/server/db/storage-paths.ts");
  const dir = new URL("supabase/migrations/", root);
  const found = [];

  for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
    const code = sqlCodeOf(readFileSync(new URL(name, dir), "utf8"));
    for (const match of code.matchAll(/\b(\w+)\s+~\*?\s+'\^https/g)) {
      found.push(`${name}: ${match[1]}`);
    }
  }

  // Coluna nova com check de endereco https: o fetch gravaria o caminho e o banco recusaria (23514). Ou o check novo
  // aceita tambem o caminho guardado (como na 202611120001), ou a tabela entra em STORAGE_PATHS_SKIPPED_TABLES.
  assert.deepEqual(found, [
    "202610130001_lesson_materials.sql: file_url",
    "202610200001_communication_v1.sql: image_url",
    "202610200001_communication_v1.sql: audio_url",
    "202610300003_webinars_v4b_ofertas.sql: checkout_url",
    "202610300003_webinars_v4b_ofertas.sql: image_url",
    "202611120001_storage_paths_checks.sql: image_url",
    "202611120001_storage_paths_checks.sql: audio_url",
    "202611120001_storage_paths_checks.sql: file_url"
  ]);
  assert.deepEqual([...STORAGE_PATHS_SKIPPED_TABLES], ["webinar_offer_variants"]);
  assert.match(sqlCodeOf(read("supabase/migrations/202610300003_webinars_v4b_ofertas.sql")), /create table if not exists public\.webinar_offer_variants \([^;]*checkout_url text not null check[^;]*image_url text check \(image_url is null or \(char_length\(image_url\) <= 2048 and image_url ~ '\^https:\/\/'\)\)/);
});

const DATA_SCRIPT = "supabase/dados/202611120001_midia_pelo_caminho.sql";

/** O SQL sem comentarios, textos entre aspas, identificadores entre aspas e corpos $tag$...$tag$ (o que o psql le). */
function sqlOutsideTexts(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith("--")) {
      const end = rest.search(/\n/);
      i += end < 0 ? rest.length : end;
    } else if (rest.startsWith("/*")) {
      i += rest.indexOf("*/") + 2;
      out += " ";
    } else if (rest[0] === "'") {
      let j = 1;
      while (j < rest.length && !(rest[j] === "'" && rest[j + 1] !== "'")) j += rest[j] === "'" ? 2 : 1;
      i += j + 1;
      out += "''";
    } else if (rest[0] === '"') {
      i += rest.indexOf('"', 1) + 1;
      out += '""';
    } else if (/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.test(rest) && !/[A-Za-z0-9_$]/.test(sql[i - 1] ?? "")) {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest)[0];
      const end = rest.indexOf(tag, tag.length);
      i += end < 0 ? rest.length : end + tag.length;
      out += "$$";
    } else {
      out += sql[i];
      i += 1;
    }
  }
  return out;
}

/** As colunas text/jsonb das migracoes (create table e add column), como "tabela.coluna". */
function migrationColumns() {
  const dir = new URL("supabase/migrations/", root);
  const columns = new Map();
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
    const code = sqlCodeOf(readFileSync(new URL(name, dir), "utf8"));
    for (const table of code.matchAll(/create table if not exists public\.(\w+) \(([\s\S]*?)\n\);/g)) {
      for (const column of table[2].matchAll(/^\s+(\w+)\s+(text|jsonb)\b/gm)) columns.set(`${table[1]}.${column[1]}`, column[2]);
    }
    for (const column of code.matchAll(/alter table (?:if exists )?public\.(\w+)\s+add column if not exists (\w+) (text|jsonb)\b/g)) {
      columns.set(`${column[1]}.${column[2]}`, column[3]);
    }
  }
  return columns;
}

/** As colunas que a conversao percorre (bk_midia_alvos), como "tabela.coluna" -> tipo. */
function dataScriptTargets() {
  const body = read(DATA_SCRIPT).match(/create or replace function pg_temp\.bk_midia_alvos\(\)[\s\S]*?as \$\$\s*values\s*([\s\S]*?)\$\$;/)[1];
  return new Map([...body.matchAll(/\('(\w+)', '(\w+)', '(text|jsonb)'\)/g)].map((match) => [`${match[1]}.${match[2]}`, match[3]]));
}

/**
 * Colunas com nome de arquivo ou endereco que a conversao deixa como estao, com o motivo. Coluna nova com nome assim
 * entra na lista da conversao (bk_midia_alvos) ou aqui.
 */
const NOT_CONVERTED = {
  "campaigns.image_alt": "texto alternativo da imagem, nao endereco",
  "content_items.purchase_url": "link de compra na plataforma de venda",
  "integration_settings.webhook_url": "endereco de webhook",
  "students.avatar_url": "tabela apagada na 202610140001",
  "webinar_offer_variants.checkout_url": "link colado, check https:// (STORAGE_PATHS_SKIPPED_TABLES)",
  "webinar_offer_variants.image_url": "link colado, check https:// (STORAGE_PATHS_SKIPPED_TABLES)",
  "webinar_recordings.embed_url": "video no provedor",
  "youtube_course_imports.playlist_url": "playlist do YouTube"
};

test("a conversao dos dados (supabase/dados) nunca e aplicada sozinha e so cria ferramentas em pg_temp", () => {
  const script = read(DATA_SCRIPT);
  const outside = sqlOutsideTexts(script);
  const code = sqlCodeOf(script).toLowerCase();

  assert.match(script, /^-- Midia do Storage pelo caminho: a conversao dos enderecos que ja estao no banco \(docs\/32 §11\.5\)\. NAO e migracao:/);
  assert.match(script, /^-- Idempotente: pode ser executada mais de uma vez sem efeito colateral\.$/m);
  assert.deepEqual(readdirSync(new URL("supabase/migrations/", root)).filter((name) => name.includes("midia")), [], "fora da pasta que a CLI, o migrate.sh e o migrador aplicam");
  assert.match(read(".dockerignore"), /^supabase$/m, "fora da imagem");

  // O psql le o arquivo inteiro: nada de transacao solta (cada comando e uma), DISCARD (apagaria pg_temp) nem barra
  // invertida em lugar nenhum (fora de texto, o psql leria como comando dele; dentro, depende de
  // standard_conforming_strings).
  assert.doesNotMatch(script, /\\/);
  for (const command of outside.split(";").map((part) => part.trim().toLowerCase())) {
    assert.doesNotMatch(command, /^(?:begin|commit|rollback|abort|start\s+transaction|discard)\b/, command.slice(0, 60));
  }

  // So objetos temporarios: as funcoes em pg_temp e a tabela temporaria do resultado.
  const functions = code.match(/\bcreate\s+(?:or\s+replace\s+)?function\s+[\w.]+/g) ?? [];
  assert.ok(functions.length >= 10);
  for (const name of functions) assert.match(name, /function pg_temp\.bk_midia_\w+$/, name);
  assert.deepEqual(code.match(/\bcreate\s+(?:\w+\s+)*table\s+(?:if not exists\s+)?[\w.]+/g), ["create temp table if not exists bk_midia_mudadas"]);
  assert.doesNotMatch(code, /\b(?:create\s+(?:schema|role|extension|trigger|view|index|type|policy|sequence)|drop|grant|revoke|vacuum|copy|delete\s+from)\b/);
  assert.doesNotMatch(code, /security\s+definer/);
  // O que escreve nas tabelas da escola: o update montado na rodada de cada coluna, com os gatilhos de data
  // desligados so durante ele (e religados), e nada mais.
  assert.deepEqual(code.match(/\b(?:insert\s+into|update|truncate)\s+[\w.%$]+/g), ["update public.%1$i", "truncate bk_midia_mudadas", "insert into bk_midia_mudadas"]);
  assert.deepEqual(code.match(/alter table public\.%i (?:disable|enable) trigger %i/g), ["alter table public.%i disable trigger %i", "alter table public.%i enable trigger %i"]);
  assert.match(code, /t\.tgfoid = any \(array_remove\(array\[to_regproc\('public\.set_updated_at'\), to_regproc\('public\.touch_campaign_version'\)\]::oid\[\], null\)\)/, "so os gatilhos de data");
  assert.match(code, /coalesce\(nullif\(btrim\(current_setting\('bunker\.midia_modo', true\)\), ''\), 'previa'\)/, "sem modo, so le");
});

test("a conversao percorre toda coluna com endereco de arquivo das migracoes, e o cabecalho conta as mesmas", () => {
  const columns = migrationColumns();
  const targets = dataScriptTargets();

  for (const [column, type] of targets) {
    assert.equal(columns.get(column), type, `${column}: existe nas migracoes com o tipo ${type}`);
  }
  assert.deepEqual([...targets.keys()], [...targets.keys()].sort(), "em ordem");
  assert.deepEqual(
    [...targets].filter(([, type]) => type === "jsonb").map(([column]) => column),
    ["campaigns.popup_design", "communication_templates.payload", "content_items.instructor", "content_page_settings.settings", "lessons.video_config", "platform_settings.value", "youtube_course_imports.last_manifest"],
    "os JSON que guardam enderecos (o design, os modelos, o instrutor, a pagina do produto, o video da aula, a marca e o destaque, o manifesto do YouTube)"
  );

  const named = [...columns.keys()].filter((column) => /(?:image|avatar|cover|logo|icon|thumbnail|poster|_url|media)/.test(column.split(".")[1])).sort();
  const covered = [...targets.keys(), ...Object.keys(NOT_CONVERTED)];
  assert.deepEqual(named.filter((column) => !covered.includes(column)), [], "coluna nova com nome de arquivo ou endereco: entra em bk_midia_alvos ou em NOT_CONVERTED, com o motivo");
  for (const column of Object.keys(NOT_CONVERTED)) assert.ok(named.includes(column), `${column} ainda existe`);

  // A previa rapida do cabecalho (so leitura, sem as ferramentas) conta as mesmas colunas.
  const header = read(DATA_SCRIPT).split("/* ----")[0];
  const counted = [...header.matchAll(/select '(\w+\.\w+)'/g)].map((match) => match[1]);
  assert.deepEqual(counted, [...targets.keys()]);
});
