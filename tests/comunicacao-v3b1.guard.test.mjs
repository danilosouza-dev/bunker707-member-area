import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Guarda da v3b-1 "Pop-ups: frequencia, paginas e como fechar" (docs/25; docs/18 §1.2): regras de seguranca
// e de aplicacao que se leem no codigo da 202610220003. O comportamento (frequencia, paginas, a abertura
// atomica) esta nos testes de integracao (pop-ups-paginas-e-frequencia e pop-ups-editor-v3b1).
// - as cinco migracoes de Comunicacao ja aplicadas na nuvem nunca mudam (hash);
// - as seis secoes passam pelo MCP: nada de drop, delete nem gatilho; toda constraint dentro de if not exists;
// - o check novo de campaign_deliveries entra not valid e a secao 4 so o valida (sozinha numa chamada);
// - as tres funcoes so para service_role, com a assinatura exata; o "mostrar de novo" perde a trava
//   popup_repeat e passa a zerar quem clicou quando o pop-up so para ao terminar;
// - os limites e o formato das paginas do banco sao os mesmos do app (popup-display-model.ts).

const migrations = new URL("../supabase/migrations/", import.meta.url);
const v3b1 = await readFile(new URL("202610220003_communication_v3b1.sql", migrations), "utf8");
const v3a = await readFile(new URL("202610220001_communication_v3a.sql", migrations), "utf8");
const model = await import("../src/server/communications/popup-display-model.ts");

const APPLIED = {
  "202610200001_communication_v1.sql": "d4c0c3e33c1a4312a9001581148c2811eeaa2dd1bac1893ae9a58d17d8e60a23",
  "202610200002_communication_v2.sql": "8731688444b80cba7d94849908cf460496cb9975d28a8e2e73b89280b7d1c496",
  "202610210001_communication_v2_fixes.sql": "c4ac3b9a8f1a7aa5a1638b7017453a7bd30fdd135b01c287f1b5ff33011477f7",
  "202610220001_communication_v3a.sql": "2c6fc8a75dd84a777b414cbd35b491550e1c8e9bf1ba5c5b065e4f5840657c88",
  "202610220002_communication_v3a_ajustes.sql": "b7f3e3592ce6201a47613590f11db2ed36a9718860b86db73dc8dc3ee2f8cee2"
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

/** O texto de uma secao ("1." a "6."): do fim do cabecalho dela ate o cabecalho da proxima. */
function sectionOf(source, number) {
  const start = source.indexOf(` * ${number}. `);
  assert.ok(start > 0, `a secao ${number} existe`);
  const bodyStart = source.indexOf("*/", start) + 2;
  const next = source.indexOf("/* ----", bodyStart);

  return source.slice(bodyStart, next === -1 ? source.length : next);
}

const functions = functionsOf(v3b1);
const statements = statementsOf(v3b1);

test("guarda: as migracoes de Comunicacao ja aplicadas na nuvem nao mudam; a v3b-1 e um arquivo novo", async () => {
  for (const [name, hash] of Object.entries(APPLIED)) {
    assert.equal(createHash("sha256").update(await readFile(new URL(name, migrations))).digest("hex"), hash, name);
  }
});

test("guarda: 202610220003 inteira pelo MCP (sem drop, sem delete, sem gatilho, sem update de dado)", () => {
  const code = codeOf(v3b1);

  assert.doesNotMatch(code, /\bdrop\b/i, "nada de drop");
  assert.doesNotMatch(code, /\bdelete\b/i, "nada de delete (deleted_at e coluna)");
  assert.doesNotMatch(code, /\bcreate\s+(or\s+replace\s+)?trigger\b/i, "nenhum gatilho");
  assert.doesNotMatch(code, /\btruncate\b/i);
  assert.doesNotMatch(code, /\bupdate\s+public\.campaigns\b/i, "nenhuma linha de campaigns e reescrita");
  assert.doesNotMatch(code, /create (unique )?index/i, "nenhum indice novo");

  for (const column of v3b1.match(/^\s*(alter table [^\n]*\s+)?add column [^\n]+$/gm) ?? []) {
    assert.match(column, /add column if not exists/, column.trim());
  }

  // As seis secoes, na ordem do arquivo.
  for (const number of [1, 2, 3, 4, 5, 6]) {
    assert.ok(v3b1.indexOf(` * ${number}. `) > 0, `secao ${number}`);
  }
  assert.ok(v3b1.indexOf(" * 1. ") < v3b1.indexOf(" * 2. ") && v3b1.indexOf(" * 5. ") < v3b1.indexOf(" * 6. "));
});

test("guarda: toda constraint dentro de if not exists; o check de campaign_deliveries entra not valid e a secao 4 so o valida", () => {
  const constraints = [...v3b1.matchAll(/add constraint (\w+)/g)].map((match) => match[1]);

  assert.deepEqual(constraints, [
    "campaigns_popup_pages_v3b",
    "campaigns_popup_trigger_v3b",
    "campaigns_popup_frequency_v3b",
    "campaigns_popup_close_v3b",
    "campaigns_popup_snooze_v3b",
    "campaigns_popup_only_v3b",
    "campaign_deliveries_popup_v3b"
  ]);

  for (const name of constraints) {
    const guard = new RegExp(`if not exists \\(select 1 from pg_constraint where conname = '${name}'\\) then\\s+alter table public\\.\\w+ add constraint ${name} check \\(`);
    assert.match(v3b1, guard, name);
    const at = v3b1.indexOf(`add constraint ${name}`);
    assert.ok(v3b1.indexOf("end if;", at) > at, `${name} fecha o if`);
  }

  assert.match(v3b1, /add constraint campaign_deliveries_popup_v3b check \(\s+day_impressions between 0 and 1000\s+\) not valid;/);
  assert.deepEqual(statementsOf(sectionOf(v3b1, 4)), ["alter table public.campaign_deliveries validate constraint campaign_deliveries_popup_v3b"]);
  assert.ok(statements.includes("alter table public.campaign_deliveries validate constraint campaign_deliveries_popup_v3b"));
  assert.ok(v3b1.indexOf("validate constraint") > v3b1.indexOf(") not valid;"), "valida depois de criar");
});

test("guarda: as tres funcoes so para service_role, com a assinatura exata, security invoker; o mostrar de novo mantem a assinatura da v3a", () => {
  assert.deepEqual(functions.map((fn) => fn.signature), [
    "communication_popup_pages_ok(text[], boolean)",
    "communication_record_popup_impression(uuid, uuid, timestamptz, timestamptz, timestamptz)",
    "communication_reshow_popup(uuid, timestamptz, integer, boolean)"
  ]);

  for (const fn of functions) {
    assert.match(fn.header, /set search_path = pg_catalog(, public)?\n/, fn.name);
    assert.ok(statements.includes(`revoke all on function public.${fn.signature} from public, anon, authenticated`), `revoke ${fn.signature}`);
    assert.ok(statements.includes(`grant execute on function public.${fn.signature} to service_role`), `grant ${fn.signature}`);
    assert.ok(statements.some((statement) => statement.startsWith(`comment on function public.${fn.signature} is`)), `comment ${fn.signature}`);
  }

  for (const name of ["communication_record_popup_impression", "communication_reshow_popup"]) {
    const fn = functions.find((candidate) => candidate.name === name);
    assert.match(fn.header, /returns jsonb/, name);
    assert.match(fn.header, /security invoker/, name);
  }

  const original = functionsOf(v3a).find((fn) => fn.name === "communication_reshow_popup");
  assert.equal(functions.find((fn) => fn.name === "communication_reshow_popup").signature, original.signature);

  const code = codeOf(v3b1);
  assert.doesNotMatch(code, /security definer/i);
  assert.doesNotMatch(code, /\bgrant\b[^;]*\bto\s+(public|anon|authenticated)\b/i, "nada para o navegador");
  assert.doesNotMatch(code, /create policy/i);
  assert.doesNotMatch(code, /disable row level security/i);
});

test("guarda: a abertura grava so a linha que o app leu (updated_at), elegivel, sem 'Não mostrar de novo' e com o pop-up no ar", () => {
  const body = functions.find((fn) => fn.name === "communication_record_popup_impression").body;

  assert.match(body, /and d\.updated_at = p_expected_updated_at/);
  assert.match(body, /and d\.eligible\s+and d\.dismissed_at is null/);
  assert.match(body, /c\.kind = 'popup'\s+and c\.status = 'active'\s+and c\.deleted_at is null/);
  assert.match(body, /\(c\.starts_at is null or c\.starts_at <= p_now\)\s+and \(c\.ends_at is null or c\.ends_at > p_now\)/);
  assert.match(body, /least\(greatest\(d\.day_impressions, 1\) \+ 1, 1000\)/, "linha vista hoje antes da v3b-1 conta 1");
  assert.match(body, /\(d\.reshown_at is null or d\.last_seen_at > d\.reshown_at\)/, "depois do zerar, o dia recomeca");
  assert.match(body, /return jsonb_build_object\('impressions', v_impressions, 'day_impressions', v_day\);/);
});

test("guarda: o mostrar de novo vale em qualquer 'Quantas vezes' e zera quem clicou so quando o pop-up para ao terminar", () => {
  const body = functions.find((fn) => fn.name === "communication_reshow_popup").body;

  assert.doesNotMatch(body, /popup_repeat/, "sem a trava da v3a");
  assert.equal(body.match(/coalesce\(v_stop, 'click'\) = 'never'/g)?.length, 2, "na contagem e no zerar");
  assert.match(body, /for update;/, "aplicar trava a linha do pop-up");
  assert.match(body, /d\.impressions - d\.impressions_before_reshow > d\.snooze_count - d\.snoozes_before_reshow/);
});

test("guarda: os limites e o formato das paginas do banco sao os mesmos do app", () => {
  const rules = model.POPUP_V3B1_RULES;
  const between = (pattern) => {
    const match = pattern.exec(v3b1);
    assert.ok(match, String(pattern));
    return [Number(match[1]), Number(match[2])];
  };

  assert.deepEqual(between(/popup_delay_seconds between (\d+) and (\d+)/), [rules.delaySeconds.min, rules.delaySeconds.max]);
  assert.deepEqual(between(/popup_every_minutes between (\d+) and (\d+)/), [rules.everyMinutes.min, rules.everyMinutes.max]);
  assert.deepEqual(between(/popup_max_per_day between (\d+) and (\d+)/), [rules.maxPerDay.min, rules.maxPerDay.max]);
  assert.deepEqual(between(/popup_max_total between (\d+) and (\d+)/), [rules.maxTotal.min, rules.maxTotal.max]);
  assert.deepEqual(between(/popup_snooze_minutes between (\d+) and (\d+)/), [rules.snoozeMinutes.min, rules.snoozeMinutes.max]);
  assert.match(v3b1, /add column if not exists popup_snooze_minutes integer not null default 1440/);
  assert.equal(rules.snoozeMinutes.default, 1440);
  assert.match(v3b1, /add column if not exists popup_delay_seconds smallint not null default 3/);
  assert.equal(rules.defaultDelaySeconds, 3);
  assert.match(v3b1, /cardinality\(popup_pages\) between 1 and 20/);
  assert.match(v3b1, /coalesce\(cardinality\(p_pages\), 0\) <= 20/);
  assert.equal(rules.maxPages, 20);

  const [, stops] = /popup_stop_on in \(([^)]*)\)/.exec(v3b1) ?? [];
  assert.deepEqual(stops.split(",").map((value) => value.trim().replace(/'/g, "")), [...model.POPUP_STOP_ON]);
  const [, closes] = /popup_close in \(([^)]*)\)/.exec(v3b1) ?? [];
  assert.deepEqual(closes.split(",").map((value) => value.trim().replace(/'/g, "")), [...model.POPUP_CLOSE_MODES]);
  const [, triggers] = /popup_trigger in \('page_load'([^)]*)\)/.exec(v3b1) ?? [];
  for (const trigger of model.POPUP_TRIGGERS) {
    assert.ok(`'page_load'${triggers}`.includes(`'${trigger}'`), trigger);
  }

  // O mesmo texto da expressao nos dois lados (grupos sem captura no SQL).
  assert.ok(v3b1.includes(`'${model.POPUP_PAGE_PATTERN.source}'`), "POPUP_PAGE_PATTERN igual ao do banco");
  assert.match(v3b1, /p\.page !~ '\^lesson:'/, "ao concluir uma aula: so paginas de aula");
});

test("guarda: notificacao fica sempre com os padroes do pop-up (os mesmos de POPUP_COLUMNS_FOR_INBOX)", () => {
  const inbox = model.POPUP_COLUMNS_FOR_INBOX;
  const check = /campaigns_popup_only_v3b check \(([\s\S]*?)\n\s*\);/.exec(v3b1)?.[1] ?? "";

  assert.match(check, /kind = 'popup' or \(/);
  assert.deepEqual(inbox.popup_pages, ["home"]);
  assert.match(check, /popup_pages = array\['home'\]::text\[\]/);
  assert.deepEqual(inbox.popup_exclude_pages, []);
  assert.match(check, /popup_exclude_pages = array\[\]::text\[\]/);
  assert.match(check, new RegExp(`popup_trigger = '${inbox.popup_trigger}' and popup_delay_seconds = ${inbox.popup_delay_seconds}`));
  assert.match(check, new RegExp(`popup_close = '${inbox.popup_close}'`));
  assert.match(check, new RegExp(`popup_snooze_minutes = ${inbox.popup_snooze_minutes}`));
  for (const column of ["popup_frequency", "popup_every_minutes", "popup_max_per_day", "popup_max_total", "popup_stop_on"]) {
    assert.equal(inbox[column], null, column);
    assert.match(check, new RegExp(`${column} is null`), column);
  }
});
