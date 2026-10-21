import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

// Guarda da Comunicacao v3a (docs/24; docs/18 §1.2): regras de seguranca e de aplicacao que se leem no
// codigo. O comportamento (sino, reacoes, enquetes, excluir, mostrar de novo) esta nos testes de integracao.
// - as 202610200001, 202610200002 e 202610210001 ja estao aplicadas na nuvem e nunca mudam (hash);
// - a 202610220001 passa inteira pelo MCP: nada de drop, nada de delete, nenhum gatilho, toda constraint
//   dentro de "if not exists" e a funcao chamada antes de quem a chama (o corpo SQL e conferido ao criar);
// - nada para anon/authenticated: cada RPC nova so para service_role, com a assinatura exata;
// - as rotas do sino leem a sessao pelas claims do JWT e as quatro escritas do aluno tem o limite por minuto.

const migrations = new URL("../supabase/migrations/", import.meta.url);
const read = (name) => readFile(new URL(name, migrations));
const v3a = await readFile(new URL("202610220001_communication_v3a.sql", migrations), "utf8");
const v2 = await readFile(new URL("202610200002_communication_v2.sql", migrations), "utf8");

const APPLIED = {
  "202610200001_communication_v1.sql": "d4c0c3e33c1a4312a9001581148c2811eeaa2dd1bac1893ae9a58d17d8e60a23",
  "202610200002_communication_v2.sql": "8731688444b80cba7d94849908cf460496cb9975d28a8e2e73b89280b7d1c496",
  "202610210001_communication_v2_fixes.sql": "c4ac3b9a8f1a7aa5a1638b7017453a7bd30fdd135b01c287f1b5ff33011477f7"
};

const NEW_FUNCTIONS = [
  "communication_visible_notifications",
  "communication_poll_tally",
  "communication_inbox_page",
  "communication_inbox_counts",
  "communication_respond_notification",
  "communication_vote_notification_poll",
  "communication_reshow_popup",
  "communication_message_interactions",
  "communication_flow_batch_facts",
  "communication_notice_citations"
];

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
      position: match.index,
      signature: `${match[1]}(${types.join(", ")})`
    });
  }

  return found;
}

const functions = functionsOf(v3a);

test("guarda: as tres migracoes ja aplicadas na nuvem (v1, v2 e as correcoes da v2) nao mudam", async () => {
  for (const [name, hash] of Object.entries(APPLIED)) {
    assert.equal(createHash("sha256").update(await read(name)).digest("hex"), hash, name);
  }

  const names = (await readdir(migrations)).filter((name) => name.startsWith("2026102200"));
  assert.ok(names.includes("202610220001_communication_v3a.sql"), "a v3a e um arquivo novo");
});

test("guarda: 202610220001 passa inteira pelo MCP (sem drop, sem delete, sem gatilho, constraints dentro de if not exists)", () => {
  const code = codeOf(v3a);

  assert.doesNotMatch(code, /\bdrop\b/i, "nada de drop");
  assert.doesNotMatch(code, /\bdelete\s+from\b/i, "nada de delete from");
  assert.doesNotMatch(code, /\bdelete\b(?!\s+set\s+null)/i, "delete so no on delete set null da FK");
  assert.doesNotMatch(code, /\bcreate\s+(or\s+replace\s+)?trigger\b/i, "nenhum gatilho");
  assert.doesNotMatch(code, /\btruncate\b/i);
  assert.match(code, /edited_by uuid references auth\.users\(id\) on delete set null/, "a FK de quem editou");

  const constraints = [...v3a.matchAll(/add constraint (\w+)/g)].map((match) => match[1]);
  assert.deepEqual(constraints.sort(), [
    "campaign_deliveries_reshow_v3",
    "campaigns_cta_display_v3",
    "campaigns_poll_v3",
    "campaigns_reactions_v3",
    "notifications_interaction_writes_v3",
    "notifications_poll_v3",
    "notifications_reaction_v3",
    "notifications_response_change_v3"
  ]);

  for (const name of constraints) {
    assert.match(
      v3a,
      new RegExp(`if not exists \\(select 1 from pg_constraint where conname = '${name}'\\) then\\s+alter table public\\.\\w+ add constraint ${name} check`),
      name
    );
  }

  for (const column of v3a.match(/^\s+add column [^\n]+$/gm) ?? []) {
    assert.match(column, /add column if not exists/, column.trim());
  }

  assert.match(v3a, /create index if not exists notifications_poll_tally_idx\s+on public\.notifications \(campaign_id\) where poll_choice is not null and not is_test;/);
  assert.doesNotMatch(code, /create (unique )?index (?!if not exists)/i, "todo indice com if not exists");
});

test("guarda: toda funcao da 202610220001 so para service_role, com a assinatura exata, security invoker", () => {
  assert.deepEqual(functions.map((fn) => fn.name).sort(), [...NEW_FUNCTIONS].sort(), "todas as funcoes foram lidas");

  for (const fn of functions) {
    assert.ok(v3a.includes(`revoke all on function public.${fn.signature} from public, anon, authenticated;`), `revoke ${fn.signature}`);
    assert.ok(v3a.includes(`grant execute on function public.${fn.signature} to service_role;`), `grant ${fn.signature}`);
    assert.match(fn.header, /security invoker/, fn.name);
    assert.match(fn.header, /set search_path = (pg_catalog, )?public/, fn.name);
    assert.doesNotMatch(fn.body, /\bdelete\s+from\b/i, fn.name);
    assert.match(fn.body, /\S/, fn.name);
  }

  const code = codeOf(v3a);
  assert.doesNotMatch(code, /security definer/i);
  assert.doesNotMatch(code, /\bgrant\b[^;]*\bto\s+(public|anon|authenticated)\b/i, "nada para o navegador");
  assert.doesNotMatch(code, /create policy/i);
  assert.doesNotMatch(code, /disable row level security/i);
});

test("guarda: a 7.9 mantem a assinatura da 0002; a contagem da enquete vem antes de quem a chama", () => {
  const before = functionsOf(v2).find((fn) => fn.name === "communication_flow_batch_facts");
  const after = functions.find((fn) => fn.name === "communication_flow_batch_facts");

  assert.ok(before && after);
  assert.equal(after.signature, before.signature);
  assert.equal(after.signature, "communication_flow_batch_facts(uuid[], text[], text[], uuid[])");
  assert.match(after.header, /returns jsonb/);
  assert.match(after.body, /'reaction', n\.reaction, 'poll_choice', to_jsonb\(n\.poll_choice\), 'hidden_at', n\.hidden_at/);

  const position = (name) => functions.find((fn) => fn.name === name).position;
  assert.ok(position("communication_poll_tally") < position("communication_inbox_page"));
  assert.ok(position("communication_poll_tally") < position("communication_vote_notification_poll"));
  assert.ok(position("communication_visible_notifications") < position("communication_inbox_page"));
  assert.ok(position("communication_visible_notifications") < position("communication_inbox_counts"));
});

test("guarda: a regra do que aparece no sino fica num lugar so (a pagina e os numeros usam a funcao 4.1)", () => {
  const body = (name) => functions.find((fn) => fn.name === name).body;

  assert.match(body("communication_inbox_page"), /from public\.communication_visible_notifications\(p_user_id, p_now, null\)/);
  assert.match(body("communication_inbox_counts"), /from public\.communication_visible_notifications\(p_user_id, p_now, null\)/);
  assert.match(body("communication_visible_notifications"), /and n\.hidden_at is null/);
  assert.match(body("communication_inbox_page"), /least\(greatest\(coalesce\(p_limit, 20\), 1\), 50\) \+ 1/, "ate p_limit + 1 itens");
  // closesAt canonico (o check) e comparado como texto: sem cast que possa quebrar a pagina do sino.
  assert.doesNotMatch(body("communication_inbox_page"), /closesAt'\)::timestamptz/);
  assert.match(v3a, /poll->>'closesAt' ~ '\^\[0-9\]\{4\}-/);
});

// Rotas e cartao dos pacotes A e B (docs/24): enquanto o pacote nao chegou, o teste fica como "todo".
const routesReady = existsSync(new URL("../src/server/communications/student-write-limit.ts", import.meta.url));
const cardReady = existsSync(new URL("../src/components/member/notifications/notice-reactions.tsx", import.meta.url));

async function routeFiles(directory) {
  const files = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);

    if (entry.isDirectory()) {
      files.push(...(await routeFiles(url)));
    } else if (entry.name === "route.ts") {
      files.push(url);
    }
  }

  return files;
}

test(
  "guarda: toda rota do sino e o beacon do pop-up leem a sessao pelas claims; as quatro escritas do aluno tem limite",
  { todo: routesReady ? false : "chega com o pacote A (student-write-limit.ts e as rotas novas)" },
  async () => {
    const files = [...(await routeFiles(new URL("../src/app/api/notifications/", import.meta.url))), new URL("../src/app/api/popups/[id]/events/route.ts", import.meta.url)];
    const relative = (url) => decodeURIComponent(url.pathname).replace(/^.*\/src\/app\//, "");

    for (const name of ["notifications/[id]/reaction/route.ts", "notifications/[id]/poll/route.ts", "notifications/[id]/hide/route.ts"]) {
      assert.ok(files.some((url) => relative(url) === `api/${name}`), name);
    }

    for (const url of files) {
      const source = await readFile(url, "utf8");

      assert.match(source, /\brequireApiSessionUser\b/, relative(url));
      assert.doesNotMatch(source, /\brequireApiUser\b/, relative(url));

      if (/\[id\]\/(reaction|poll|hide|response)\/route\.ts$/.test(relative(url))) {
        assert.match(source, /\btakeStudentWrite\b/, relative(url));
      }
    }
  }
);

test(
  "guarda: o link decorativo do cartao clicavel fica fora do leitor de tela e do Tab",
  { todo: cardReady ? false : "chega com o pacote B (notice-reactions.tsx e o cartao novo)" },
  async () => {
    const card = await readFile(new URL("../src/components/member/notifications/notification-card.tsx", import.meta.url), "utf8");
    const decorative = /<a\s[^>]*aria-hidden="true"[^>]*>/.exec(card)?.[0] ?? "";

    assert.ok(decorative, "existe um link com aria-hidden");
    assert.match(decorative, /tabIndex=\{-1\}/);
  }
);
