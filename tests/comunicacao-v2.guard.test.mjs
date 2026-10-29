import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Guarda da Comunicacao v2 (docs/23; docs/18 §1.2): regras de seguranca e de aplicacao que se leem na
// migracao. O comportamento (fluxos, seguintes, sino, visitas) esta nos testes de integracao.
// - a 202610200001 ja esta aplicada na nuvem e nunca muda (hash);
// - a 202610200002 e aplicavel pelo MCP em partes: nada de "drop ... if exists", nem "drop constraint",
//   gatilhos com "create or replace trigger" e "delete" so dentro da retencao (secao 9);
// - nada para anon/authenticated: RLS em toda tabela nova e cada RPC so para service_role.

const v1 = await readFile(new URL("../supabase/migrations/202610200001_communication_v1.sql", import.meta.url));
const v2 = await readFile(new URL("../supabase/migrations/202610200002_communication_v2.sql", import.meta.url), "utf8");
const registrySource = await readFile(new URL("../src/server/jobs/registry.ts", import.meta.url), "utf8");

const V1_SHA256 = "d4c0c3e33c1a4312a9001581148c2811eeaa2dd1bac1893ae9a58d17d8e60a23";
const NEW_TABLES = ["communication_flows", "communication_flow_nodes", "communication_flow_runs", "communication_flow_tasks", "member_page_visits"];

/** Cada `create or replace function public.x(...)`: nome, tipos dos parametros, retorno e corpo. */
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

    const params = source.slice(header.lastIndex, index - 1);
    const types = params
      .replace(/--[^\n]*/g, "")
      .split(",")
      .map((param) => param.trim())
      .filter(Boolean)
      .map((param) => param.split(/\s+/).slice(1).join(" "));
    const bodyStart = source.indexOf("$$", index);
    const bodyEnd = source.indexOf("$$", bodyStart + 2);

    found.push({
      body: source.slice(bodyStart + 2, bodyEnd),
      name: match[1],
      returns: /returns\s+trigger/.test(source.slice(index, bodyStart)) ? "trigger" : "other",
      signature: `${match[1]}(${types.join(", ")})`
    });
  }

  return found;
}

const functions = functionsOf(v2);

test("guarda: a migracao da v1 (ja aplicada na nuvem) nao muda", () => {
  assert.equal(createHash("sha256").update(v1).digest("hex"), V1_SHA256);
});

test("guarda: 0002 aplicavel em partes pelo MCP (sem drop, gatilho com create or replace, retencao marcada)", () => {
  assert.doesNotMatch(v2, /\bdrop\s+\w+(\s+\w+)?\s+if\s+exists\b/i, "nada de drop ... if exists");
  assert.doesNotMatch(v2, /\bdrop\s+constraint\b/i, "nada de drop constraint");
  assert.doesNotMatch(v2, /\bcreate\s+trigger\b/i, "gatilho so com create or replace trigger");
  assert.match(v2, /create or replace trigger set_notifications_expiry/);
  assert.match(v2, /secoes 1 a 8 aplicaveis pelo MCP; 9 \(retencao, delete dentro de funcao\) pelo SQL Editor/);
  assert.match(v2, /\* 9\. Retencao/);
  assert.ok(v2.indexOf("* 9. Retencao") < v2.indexOf("create or replace function public.prune_communication_history()"));

  for (const constraint of ["campaigns_icon_v2", "campaigns_validity_v2", "campaigns_inbox_only_v2", "campaigns_flow_message_v2", "notifications_expires_v2", "notifications_engagement_v2", "notifications_flow_v2"]) {
    assert.match(v2, new RegExp(`if not exists \\(select 1 from pg_constraint where conname = '${constraint}'\\)`), constraint);
  }
});

test("guarda: nenhuma funcao da 0002 apaga linha, menos a retencao", () => {
  assert.ok(functions.length >= 17, "todas as funcoes foram lidas");

  for (const fn of functions) {
    if (fn.name === "prune_communication_history") {
      assert.match(fn.body, /delete from public\.communication_flow_tasks/);
      assert.match(fn.body, /delete from public\.member_page_visits/);
      continue;
    }

    assert.doesNotMatch(fn.body, /\bdelete\s+from\b/i, fn.name);
  }
});

test("guarda: tabelas novas com RLS e nada para anon/authenticated", () => {
  for (const table of NEW_TABLES) {
    assert.match(v2, new RegExp(`alter table public\\.${table} enable row level security;`), table);
    assert.match(v2, new RegExp(`revoke all on public\\.${table} from anon, authenticated;`), table);
    assert.match(v2, new RegExp(`grant select, insert, update, delete on public\\.${table} to service_role;`), table);
  }

  assert.doesNotMatch(v2, /\bgrant\b[^;]*\bto\s+(public|anon|authenticated)\b/i);
  assert.doesNotMatch(v2, /create policy/i, "nenhuma policy: o navegador nao le nada daqui");
});

test("guarda: toda RPC da 0002 so para service_role, com a assinatura exata; gatilhos nem para ele", () => {
  const rpcs = functions.filter((fn) => fn.returns !== "trigger");
  const triggers = functions.filter((fn) => fn.returns === "trigger");

  assert.deepEqual(triggers.map((fn) => fn.name).sort(), ["set_notification_expiry", "touch_flow_version"]);

  for (const fn of triggers) {
    assert.ok(v2.includes(`revoke all on function public.${fn.name}() from public, anon, authenticated, service_role;`), fn.name);
  }

  for (const fn of rpcs) {
    assert.ok(v2.includes(`revoke all on function public.${fn.signature} from public, anon, authenticated;`), `revoke ${fn.signature}`);
    assert.ok(v2.includes(`grant execute on function public.${fn.signature} to service_role;`), `grant ${fn.signature}`);
    assert.match(fn.body, /\S/, fn.name);
  }

  for (const name of [
    "communication_claim_flow_tasks",
    "communication_enroll_flow",
    "communication_enroll_notice_recipients",
    "communication_apply_flow_results",
    "communication_save_flow",
    "communication_wake_flow_tasks",
    "communication_flow_stats",
    "communication_flow_node_stats",
    "communication_flow_batch_facts",
    "communication_campaign_engagement",
    "communication_record_notification_audio",
    "communication_overview",
    "communication_change_flow_state",
    "communication_withdraw_flow_step",
    "prune_communication_history"
  ]) {
    assert.ok(
      rpcs.some((fn) => fn.name === name),
      name
    );
  }

  // As RPCs que escrevem sao security invoker (a retencao e a unica definer, como na v1).
  for (const fn of rpcs.filter((item) => item.name !== "prune_communication_history")) {
    const start = v2.indexOf(`create or replace function public.${fn.name}(`);
    const header = v2.slice(start, v2.indexOf("$$", start));

    assert.match(header, /security invoker/, fn.name);
    assert.match(header, /set search_path = (pg_catalog, )?public/, fn.name);
  }
});

test("guarda: o sino da v1 continua igual (fim sempre preenchido, numeros da v1 sem mudar de colunas)", () => {
  assert.match(v2, /alter table public\.notifications alter column expires_at set not null;/);
  assert.match(v2, /new\.expires_at = new\.created_at \+ interval '90 days'/);
  assert.doesNotMatch(v2, /function public\.communication_campaign_stats\(/, "create or replace nao muda as colunas de saida");
  assert.match(v2, /create or replace function public\.communication_overview\(p_start timestamptz, p_end timestamptz\)\nreturns table \(active_now bigint, seen bigint, clicked bigint, studied_7d bigint\)/);
});

test("guarda: o motor dos fluxos nao muda o contrato dos jobs (tipo Job e ordem do registro)", () => {
  const jobTypeBody = registrySource.match(/export type Job = \{([^}]*)\}/)?.[1] ?? "";

  assert.match(jobTypeBody, /\bname: string;/);
  assert.match(jobTypeBody, /\brun\(ctx: JobContext\): Promise<void>;/);
  // A limpeza diaria dos arquivos sem uso (docs/22 §4.6) entrou por ultimo; o tipo Job nao mudou.
  assert.match(registrySource, /export const jobRegistry: readonly Job\[\] = \[emailOutboxJob, communicationsJob, webinarRemindersJob, communicationMediaJob\];/);
});

/* ------------------------------------------------------------------------------------------------
 * 202610210001 (correcoes da revisao): a 0002 ja esta aplicada na nuvem de teste e nunca muda; o que
 * muda no banco vem na 0003, aplicavel pelo MCP secao por secao.
 * ---------------------------------------------------------------------------------------------- */

const V2_SHA256 = "8731688444b80cba7d94849908cf460496cb9975d28a8e2e73b89280b7d1c496";
const fixes = await readFile(new URL("../supabase/migrations/202610210001_communication_v2_fixes.sql", import.meta.url), "utf8");
const fixFunctions = functionsOf(fixes);

test("guarda: a 0002 (ja aplicada na nuvem de teste) nao muda; as correcoes vem na 202610210001", () => {
  assert.equal(createHash("sha256").update(v2).digest("hex"), V2_SHA256);
});

test("guarda: 202610210001 aplicavel em partes pelo MCP (sem drop, sem delete, gatilho com create or replace)", () => {
  assert.doesNotMatch(fixes, /\bdrop\s+/i, "nada de drop");
  assert.doesNotMatch(fixes, /\bdelete\s+from\b/i, "nada de delete");
  assert.doesNotMatch(fixes, /\bcreate\s+trigger\b/i, "gatilho so com create or replace trigger");
  assert.match(fixes, /alter table public\.communication_flow_nodes add column if not exists born_first_level boolean not null default false;/);
  assert.match(fixes, /create or replace trigger set_communication_flow_nodes_first_level\s+before insert on public\.communication_flow_nodes/);
  assert.doesNotMatch(fixes, /\bgrant\b[^;]*\bto\s+(public|anon|authenticated)\b/i);
});

test("guarda: 202610210001 troca as RPCs com a mesma assinatura, so para service_role, security invoker", () => {
  const rpcs = fixFunctions.filter((fn) => fn.returns !== "trigger");
  const triggers = fixFunctions.filter((fn) => fn.returns === "trigger");

  assert.deepEqual(rpcs.map((fn) => fn.name).sort(), [
    "communication_apply_flow_results",
    "communication_claim_flow_tasks",
    "communication_enroll_flow",
    "communication_enroll_notice_recipients"
  ]);
  assert.deepEqual(triggers.map((fn) => fn.name), ["mark_flow_node_first_level"]);
  assert.ok(fixes.includes("revoke all on function public.mark_flow_node_first_level() from public, anon, authenticated, service_role;"));

  for (const fn of rpcs) {
    assert.ok(functions.some((old) => old.signature === fn.signature), `mesma assinatura da 0002: ${fn.signature}`);
    assert.ok(fixes.includes(`revoke all on function public.${fn.signature} from public, anon, authenticated;`), `revoke ${fn.signature}`);
    assert.ok(fixes.includes(`grant execute on function public.${fn.signature} to service_role;`), `grant ${fn.signature}`);

    const start = fixes.indexOf(`create or replace function public.${fn.name}(`);
    const header = fixes.slice(start, fixes.indexOf("$$", start));
    assert.match(header, /security invoker/, fn.name);
    assert.match(header, /set search_path = pg_catalog, public/, fn.name);
  }

  // O que cada correcao promete, na propria funcao.
  const body = (name) => fixFunctions.find((fn) => fn.name === name).body;
  assert.equal((body("communication_enroll_notice_recipients").match(/c\.born_first_level and c\.created_at > (fr\.created_at|m\.run_created_at)/g) ?? []).length, 3, "complemento: missing, added e v_more");
  assert.match(body("communication_apply_flow_results"), /r\.revision is not null and r\.revision is distinct from v_flow\.revision/);
  assert.match(body("communication_enroll_flow"), /\(e->>'revision'\)::integer is distinct from v_revision/);
  assert.match(body("communication_claim_flow_tasks"), /update public\.communication_flow_runs fr\s+set status = 'done'/);
});
