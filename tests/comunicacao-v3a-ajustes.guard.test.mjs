import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Guarda dos ajustes da v3a (docs/24 §10; docs/18 §1.2): regras de seguranca e de aplicacao que se leem no
// codigo da 202610220002. O comportamento (lixeira por aviso, 5 minutos, contagem por passo) esta nos testes
// de integracao (comunicacao-ajustes-v3a e sino-lixeira-por-aviso).
// - a 202610220001 ja esta aplicada na nuvem e nunca muda (hash);
// - secoes 1 a 4 passam pelo MCP: nada de delete, nenhum gatilho, coluna e constraint com "if not exists";
// - a unica coisa que sai e o check antigo de 60 minutos, na secao 5, como ultima instrucao do arquivo;
// - as duas funcoes trocadas mantem a assinatura da 0001 e continuam so para service_role;
// - o minimo do banco (5 minutos) e o mesmo do app (VALIDITY_LIMITS.minMinutes e o schema).

const migrations = new URL("../supabase/migrations/", import.meta.url);
const ajustes = await readFile(new URL("202610220002_communication_v3a_ajustes.sql", migrations), "utf8");
const v3a = await readFile(new URL("202610220001_communication_v3a.sql", migrations), "utf8");

const APPLIED = {
  "202610220001_communication_v3a.sql": "2c6fc8a75dd84a777b414cbd35b491550e1c8e9bf1ba5c5b065e4f5840657c88"
};

// Tira comentarios (de linha e de bloco) e textos entre aspas simples: sobra so o que o banco executa.
function codeOf(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

/** Cada `create or replace function public.x(...)`: nome, tipos dos parametros, cabecalho e corpo. */
function functionsOf(source) {
  const found = [];
  const header = /create or replace function public\.(\w+)\(/g;
  let match;

  while ((match = header.exec(source))) {
    let depth = 1;
    let index = header.lastIndex;

    while (depth > 0 && index < source.length) {
      depth += source[index] === "(" ? 1 : source[index] === ")" ? -1 : 0;
      index += 1;
    }

    const types = source
      .slice(header.lastIndex, index - 1)
      .replace(/--[^\n]*/g, "")
      .split(",")
      .map((param) => param.trim())
      .filter(Boolean)
      .map((param) => param.replace(/\s+default\s+.*$/i, "").split(/\s+/).slice(1).join(" "));
    const bodyStart = source.indexOf("$$", index);
    const bodyEnd = source.indexOf("$$", bodyStart + 2);

    found.push({
      body: source.slice(bodyStart + 2, bodyEnd),
      header: source.slice(match.index, bodyStart),
      name: match[1],
      signature: `${match[1]}(${types.join(", ")})`
    });
  }

  return found;
}

/** As instrucoes executaveis, na ordem (sem comentarios; corpos $$...$$ inteiros numa instrucao so). */
function statementsOf(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  const statements = [];
  let current = "";
  let inBody = false;

  for (let index = 0; index < code.length; index += 1) {
    if (code.startsWith("$$", index)) {
      inBody = !inBody;
      current += "$$";
      index += 1;
      continue;
    }

    if (code[index] === ";" && !inBody) {
      statements.push(current.replace(/\s+/g, " ").trim());
      current = "";
      continue;
    }

    current += code[index];
  }

  if (current.trim()) {
    statements.push(current.replace(/\s+/g, " ").trim());
  }

  return statements.filter(Boolean);
}

const functions = functionsOf(ajustes);

test("guarda: a 202610220001 ja aplicada na nuvem nao muda; os ajustes sao um arquivo novo", async () => {
  for (const [name, hash] of Object.entries(APPLIED)) {
    assert.equal(createHash("sha256").update(await readFile(new URL(name, migrations))).digest("hex"), hash, name);
  }

  const names = (await readdir(migrations)).filter((name) => name.startsWith("2026102200"));
  assert.deepEqual(names.sort(), ["202610220001_communication_v3a.sql", "202610220002_communication_v3a_ajustes.sql"]);
});

test("guarda: 202610220002 sem delete, sem gatilho; coluna e constraint dentro de if not exists", () => {
  const code = codeOf(ajustes);

  assert.doesNotMatch(code, /\bdelete\b/i, "nada de delete");
  assert.doesNotMatch(code, /\bcreate\s+(or\s+replace\s+)?trigger\b/i, "nenhum gatilho");
  assert.doesNotMatch(code, /\btruncate\b/i);
  assert.doesNotMatch(code, /\bupdate\s+public\./i, "nada de update em dado");

  assert.match(ajustes, /alter table public\.campaigns\s+add column if not exists allow_hide boolean not null default true;/);
  for (const column of ajustes.match(/^\s*(alter table [^\n]*\s+)?add column [^\n]+$/gm) ?? []) {
    assert.match(column, /add column if not exists/, column.trim());
  }

  const constraints = [...ajustes.matchAll(/add constraint (\w+)/g)].map((match) => match[1]);
  assert.deepEqual(constraints, ["campaigns_validity_v3"]);
  assert.match(
    ajustes,
    /if not exists \(select 1 from pg_constraint where conname = 'campaigns_validity_v3'\) then\s+alter table public\.campaigns add constraint campaigns_validity_v3 check \(\s+\(validity_minutes is null or validity_minutes between 5 and 129600\)\s+and not \(validity_minutes is not null and valid_until is not null\)\s+\);/
  );
  assert.doesNotMatch(code, /create (unique )?index (?!if not exists)/i, "todo indice com if not exists");
});

test("guarda: o unico drop e o check antigo de 60 minutos, a ultima instrucao, sozinho na secao 5", () => {
  const drops = codeOf(ajustes).match(/\bdrop\b[^;]*;/gi) ?? [];
  assert.deepEqual(drops, ["drop constraint if exists campaigns_validity_v2;"]);

  const statements = statementsOf(ajustes);
  assert.equal(statements.at(-1), "alter table public.campaigns drop constraint if exists campaigns_validity_v2");
  assert.ok(statements.slice(0, -1).every((statement) => !/\bdrop\b/i.test(codeOf(statement))), "nada sai antes da secao 5");

  const section5 = ajustes.indexOf(" * 5. ");
  assert.ok(section5 > 0, "a secao 5 existe");
  assert.ok(ajustes.indexOf("alter table public.campaigns drop constraint if exists campaigns_validity_v2;") > section5, "o drop fica na secao 5");
  // Depois do cabecalho da secao 5 (o bloco de comentario), so o drop.
  const afterSection5Header = ajustes.indexOf("*/", section5) + 2;
  assert.deepEqual(statementsOf(ajustes.slice(afterSection5Header)), ["alter table public.campaigns drop constraint if exists campaigns_validity_v2"], "a secao 5 so tem o drop");
  // O check novo entra antes de o antigo sair: em nenhum momento a coluna fica sem limite.
  assert.ok(ajustes.indexOf("add constraint campaigns_validity_v3") < ajustes.indexOf("drop constraint if exists campaigns_validity_v2"));
});

test("guarda: as duas funcoes mantem a assinatura da 0001, security invoker, so para service_role", () => {
  const before = functionsOf(v3a);

  assert.deepEqual(functions.map((fn) => fn.name).sort(), ["communication_inbox_page", "communication_poll_tally"]);

  for (const fn of functions) {
    const original = before.find((candidate) => candidate.name === fn.name);
    assert.ok(original, fn.name);
    assert.equal(fn.signature, original.signature, fn.name);
    assert.match(fn.header, /returns jsonb/, fn.name);
    assert.match(fn.header, /security invoker/, fn.name);
    assert.match(fn.header, /set search_path = (pg_catalog, )?public/, fn.name);
    assert.match(fn.header, /\bstable\b/, fn.name);
    assert.ok(ajustes.includes(`revoke all on function public.${fn.signature} from public, anon, authenticated;`), `revoke ${fn.signature}`);
    assert.ok(ajustes.includes(`grant execute on function public.${fn.signature} to service_role;`), `grant ${fn.signature}`);
  }

  const code = codeOf(ajustes);
  assert.doesNotMatch(code, /security definer/i);
  assert.doesNotMatch(code, /\bgrant\b[^;]*\bto\s+(public|anon|authenticated)\b/i, "nada para o navegador");
  assert.doesNotMatch(code, /create policy/i);
  assert.doesNotMatch(code, /disable row level security/i);
});

test("guarda: a pagina do sino leva allow_hide e a contagem soma as versoes do passo, sem testes", () => {
  const body = (name) => functions.find((fn) => fn.name === name).body;

  assert.match(body("communication_inbox_page"), /'allow_reactions', c\.allow_reactions, 'poll', c\.poll, 'allow_hide', c\.allow_hide/);
  assert.match(body("communication_inbox_page"), /from public\.communication_visible_notifications\(p_user_id, p_now, null\)/, "a regra do que aparece continua num lugar so");
  assert.match(body("communication_inbox_page"), /least\(greatest\(coalesce\(p_limit, 20\), 1\), 50\) \+ 1/);
  assert.match(body("communication_inbox_page"), /then public\.communication_poll_tally\(n\.campaign_id\)/);

  assert.match(body("communication_poll_tally"), /join public\.campaigns other on other\.flow_node_id = this\.flow_node_id/);
  assert.match(body("communication_poll_tally"), /this\.flow_node_id is not null/, "fora de fluxo, so o proprio aviso");
  assert.match(body("communication_poll_tally"), /and not t\.is_test/, "sem os testes da equipe");
  // A contagem e chamada pela pagina do sino: vem antes dela no arquivo (o corpo SQL e conferido ao criar).
  assert.ok(ajustes.indexOf("function public.communication_poll_tally") < ajustes.indexOf("function public.communication_inbox_page"));
});

test("guarda: o minimo do banco (5 minutos) e o mesmo do app", async () => {
  const meta = await import("../src/server/communications/message-meta.ts");
  const schemas = await import("../src/server/communications/schemas.ts");
  const [, min, max] = /validity_minutes between (\d+) and (\d+)/.exec(ajustes) ?? [];

  assert.equal(Number(min), 5);
  assert.equal(meta.VALIDITY_LIMITS.minMinutes, Number(min));
  assert.equal(schemas.VALIDITY_MIN_MINUTES, Number(min));
  assert.equal(meta.VALIDITY_LIMITS.maxMinutes, Number(max));
});
