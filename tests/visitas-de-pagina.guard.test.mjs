import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Guarda das visitas de pagina (Comunicacao v2, docs/23 §5.2; docs/18 §1.2). O comportamento (so pagina
// acompanhada, nunca equipe, "ver como" nem prefetch, 10 s, a rota do beacon) esta em
// tests/integration/visitas-de-pagina.test.mjs, que chama trackMemberPageVisit direto: as paginas .tsx
// nao carregam no Node, entao aqui se confere que cada uma chama o registro no lugar certo.
// - as 10 paginas da area do aluno chamam trackMemberPageVisit uma vez, depois do notFound() e antes de
//   qualquer redirect(), com o "ver como" (accessPreviewMode) e a chave da propria rota;
// - o proxy nunca registra visita (roda antes da autorizacao, em todo prefetch e 404);
// - a gravacao em member_page_visits so existe dentro da tarefa agendada com after() (com a reserva
//   fora de um pedido);
// - todo componente que abre um purchaseUrl chama trackCheckoutClick, senao "não clicaram em Comprar"
//   fica errado sem ninguem perceber.

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const source = (path) => readFile(join(repoRoot, path), "utf8");
const model = await import("../src/server/member-area/page-visit-model.ts");

const MEMBER_PAGES = {
  "src/app/page.tsx": "home",
  "src/app/conteudo/[id]/page.tsx": "content",
  "src/app/conteudo/[id]/aulas/[moduleId]/page.tsx": "content",
  "src/app/minhas-compras/page.tsx": "purchases",
  "src/app/favoritos/page.tsx": "saved",
  "src/app/materiais/page.tsx": "materials",
  "src/app/minha-jornada/page.tsx": "journey",
  "src/app/continue-assistindo/page.tsx": "continue",
  "src/app/perfil/page.tsx": "profile",
  "src/app/suporte/page.tsx": "support"
};

/** Rota de um arquivo page.tsx de src/app ("src/app/minhas-compras/page.tsx" -> "/minhas-compras"). */
function routeOf(file) {
  const path = file.replace(/^src\/app/, "").replace(/\/page\.tsx$/, "");

  return path === "" ? "/" : path;
}

async function filesUnder(dir) {
  const found = [];

  for (const entry of await readdir(join(repoRoot, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;

    if (entry.isDirectory()) {
      found.push(...(await filesUnder(path)));
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      found.push(path);
    }
  }

  return found;
}

/** Corpo de `function nome(...) { ... }` (chaves balanceadas a partir da primeira "{" depois do nome). */
function functionBody(text, name) {
  const start = text.search(new RegExp(`function ${name}\\(`));

  assert.ok(start >= 0, `funcao ${name} nao encontrada`);

  const open = text.indexOf("{", text.indexOf(")", start));
  let depth = 0;

  for (let index = open; index < text.length; index += 1) {
    depth += text[index] === "{" ? 1 : text[index] === "}" ? -1 : 0;

    if (depth === 0) {
      return { body: text.slice(open, index + 1), end: index + 1, start };
    }
  }

  throw new Error(`funcao ${name} sem fim`);
}

/** Linhas que abrem o purchaseUrl: window.open, location.href/assign/replace, href={...} e variaveis. */
function purchaseUrlOpeners(text) {
  const lines = text.split("\n");
  const openers = [];
  const aliases = [...text.matchAll(/const (\w+) = [^;]*\bpurchaseUrl\b[^;]*;/g)].map((match) => match[1]);
  const value = `(?:[^;\\n]*\\bpurchaseUrl\\b${aliases.map((alias) => `|\\s*${alias}\\b`).join("")})`;
  const patterns = [
    new RegExp(`window\\.open\\(${value}`),
    new RegExp(`location\\.(?:href\\s*=|assign\\(|replace\\()${value}`),
    new RegExp(`\\bhref=\\{${value}`)
  ];

  lines.forEach((line, index) => {
    if (patterns.some((pattern) => pattern.test(line))) {
      openers.push(index);
    }
  });

  return { lines, openers };
}

test("guarda: as 10 paginas da area do aluno registram a visita uma vez, depois do notFound e antes de qualquer redirect", async () => {
  for (const [file, expected] of Object.entries(MEMBER_PAGES)) {
    const text = await source(file);
    const body = text.slice(text.indexOf("export default async function"));
    const calls = [...body.matchAll(/trackMemberPageVisit\(/g)];

    assert.equal(calls.length, 1, `${file}: trackMemberPageVisit deve aparecer uma vez`);
    assert.match(text, /import \{ trackMemberPageVisit \} from "@\/server\/member-area\/page-visits";/, `${file}: import`);

    const callAt = calls[0].index;
    const call = body.slice(callAt, body.indexOf(");", callAt));

    assert.match(body.slice(callAt - 6, callAt), /await $/, `${file}: a chamada e esperada (await)`);
    assert.match(call, /\baccessPreviewMode\b/, `${file}: sem o "ver como"`);
    assert.match(call, /userId: user\.id/, `${file}: sem o aluno`);

    const firstRedirect = body.search(/\bredirect\(/);
    const lastNotFound = body.lastIndexOf("notFound(");

    if (firstRedirect >= 0) {
      assert.ok(callAt < firstRedirect, `${file}: a visita tem de ser registrada antes do redirect()`);
    }

    if (lastNotFound >= 0) {
      assert.ok(callAt > lastNotFound, `${file}: um notFound() nao registra visita`);
    }

    if (expected === "content") {
      assert.match(call, /pageKey: contentPageKey\([\w.]*item\.id\)/, `${file}: chave do produto`);
    } else {
      const route = /pageKey: pageKeyOfRoute\("([^"]+)"\)/.exec(call)?.[1];

      assert.equal(route, routeOf(file), `${file}: a chave tem de ser a da propria rota`);
      assert.equal(model.pageKeyOfRoute(route), expected, `${file}: chave ${expected}`);
    }
  }
});

test("guarda: o proxy nunca registra visita de pagina", async () => {
  const proxy = await source("src/proxy.ts");

  assert.doesNotMatch(proxy, /trackMemberPageVisit|page-visits|member_page_visits/);
});

test("guarda: member_page_visits so e gravada dentro da tarefa agendada com after() (e a reserva fora de um pedido)", async () => {
  const text = await source("src/server/member-area/page-visits.ts");
  const write = functionBody(text, "writePageVisit");
  const scheduler = functionBody(text, "schedulePageVisitWrite");
  const tables = [...text.matchAll(/\.from\("member_page_visits"\)/g)];

  assert.ok(tables.length > 0, "a gravacao sumiu de page-visits.ts");

  for (const table of tables) {
    assert.ok(table.index > write.start && table.index < write.end, "member_page_visits fora de writePageVisit");
  }

  // writePageVisit so roda pelo agendador, e o agendador usa after() com a reserva guardada em pending.
  const writes = [...text.matchAll(/writePageVisit\(/g)].map((match) => match.index);
  assert.equal(writes.length, 2, "writePageVisit: a definicao e uma chamada so");
  assert.match(text, /schedulePageVisitWrite\(\(\) => writePageVisit\(/);
  assert.match(scheduler.body, /after\(task\)/);
  assert.match(scheduler.body, /pending\.add\(running\)/);
  assert.match(text, /export async function settlePageVisits\(\)/);

  // Nenhum outro arquivo do app grava a tabela.
  for (const file of await filesUnder("src")) {
    if (file === "src/server/member-area/page-visits.ts") {
      continue;
    }

    const other = await source(file);

    for (const match of other.matchAll(/\.from\("member_page_visits"\)([\s\S]{0,400}?);/g)) {
      assert.doesNotMatch(match[1], /\.(insert|upsert|update|delete)\(/, `${file} grava member_page_visits`);
    }
  }
});

test("guarda: a rota do beacon usa a sessao pelas claims, so aceita content: e checkout: e registra pelo mesmo caminho das paginas", async () => {
  const route = await source("src/app/api/page-visits/route.ts");

  assert.match(route, /requireApiSessionUser\(\)/);
  assert.match(route, /BEACON_PAGE_KEY_PATTERN\.test\(key\)/);
  assert.match(route, /trackMemberPageVisit\(\{ pageKey: key, userId: auth\.user\.id \}\)/);
  assert.match(route, /readBoundedJson/);
  assert.match(route, /noStore\(/);
  assert.doesNotMatch(route, /member_page_visits/, "a rota nao grava direto");
});

test("guarda: todo componente que abre um purchaseUrl chama trackCheckoutClick antes de abrir", async () => {
  const files = [...(await filesUnder("src/components")), ...(await filesUnder("src/app"))];
  const openersByFile = new Map();

  for (const file of files) {
    const text = await source(file);

    if (!/\bpurchaseUrl\b/.test(text)) {
      continue;
    }

    const { lines, openers } = purchaseUrlOpeners(text);

    if (openers.length > 0) {
      openersByFile.set(file, { lines, openers, text });
    }
  }

  // Os pontos de entrada de hoje tem de ser achados (senao a guarda nao estaria olhando nada).
  for (const known of ["src/components/content-details-modal.tsx", "src/components/content-row.tsx", "src/components/featured-structure-home-section.tsx"]) {
    assert.ok(openersByFile.has(known), `${known} deveria abrir o purchaseUrl`);
  }

  for (const [file, { lines, openers, text }] of openersByFile) {
    assert.match(text, /import \{[^}]*\btrackCheckoutClick\b[^}]*\} from "@\/components\/member\/page-visit-beacon";/, `${relative(repoRoot, join(repoRoot, file))}: sem trackCheckoutClick`);

    for (const index of openers) {
      const line = lines[index];

      if (/\bhref=\{/.test(line)) {
        // Link para o purchaseUrl: o onClick do mesmo elemento registra e deixa a navegacao seguir.
        const element = lines.slice(Math.max(0, index - 8), index + 8).join("\n");
        const handler = /onClick=\{([^}]*)\}/.exec(element)?.[1]?.trim() ?? "";
        const callsTracker = /\btrackCheckoutClick\(/.test(handler) ||
          (/^\w+$/.test(handler) &&
            new RegExp(`(?:const ${handler} = [^;]*|function ${handler}\\([^)]*\\)\\s*\\{[^}]*)\\btrackCheckoutClick\\(`).test(text));

        assert.ok(callsTracker, `${file}:${index + 1}: link de compra sem trackCheckoutClick no onClick`);
        continue;
      }

      const before = lines.slice(Math.max(0, index - 12), index).join("\n");
      assert.match(before, /\btrackCheckoutClick\(/, `${file}:${index + 1}: abre o purchaseUrl sem chamar trackCheckoutClick antes`);
    }
  }
});

test("guarda: abrir os detalhes do produto manda o beacon content: do produto", async () => {
  const modal = await source("src/components/content-details-modal.tsx");
  const beacon = await source("src/components/member/page-visit-beacon.ts");
  const client = await source("src/components/member/notifications/notifications-client.ts");

  assert.match(modal, /trackProductDetails\(detailsItemId\)/);
  assert.match(beacon, /^"use client";/);
  // O mesmo sendBeaconPost do sino (navigator.sendBeacon com text/plain, fetch keepalive de reserva).
  assert.match(beacon, /import \{ sendBeaconPost \} from "@\/components\/member\/notifications\/notifications-client";/);
  assert.match(client, /export function sendBeaconPost\([\s\S]*?navigator\.sendBeacon/);
  assert.match(beacon, /"\/api\/page-visits"/);
});
