import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";

// A lista de Webinários desenhada (docs/30 §2.1; docs/18 §1.1): cabecalho com "Novo webinário" so para quem cria,
// os cinco numeros do periodo ("—" e "Sem dados no período" sem dado; Compareceram e Assistiram o replay pela RPC
// webinar_panel, fase 4a), as abas da pagina por ?aba= (Lives ao vivo e Lives gravadas mostram o painel que a pagina
// monta, sem a tabela da lista), os estados vazios ("Nenhum webinário ainda"), a tabela com capa, tipo,
// data, situacao e vagas, o menu "…" por situacao (Excluir so no rascunho; o que chega depois com "em breve"),
// e a previa do card do aluno. Tambem as paginas: permissao, migracao pendente, loading e not-found.
//
// Os .tsx do app sao transpilados aqui pelo TypeScript (so JSX -> JS). next/image, next/link e next/navigation
// viram stubs; o Dialog e o DropdownMenu viram versoes sem portal; as Server Actions viram funcoes falsas.

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto.supabase.co";

const root = new URL("../", import.meta.url);
const srcUrl = new URL("src/", root).href;
const require = createRequire(new URL("package.json", root));
const ts = require("typescript");

const pass = `function pass(props) { const out = {}; for (const [key, value] of Object.entries(props)) { if (key.startsWith("data-") || key.startsWith("aria-") || key === "id" || key === "role") out[key] = value; } return out; }`;

const STUBS = {
  "next/image": `import { createElement } from "react";
export default function Image({ fill, priority, sizes, unoptimized, style, ...props }) { return createElement("img", { ...props, "data-next-image": "", style }); }`,
  "next/link": `import { createElement } from "react";
export default function Link({ prefetch, scroll, ...props }) { return createElement("a", props); }`,
  "next/navigation": `export function useRouter() { return { back() {}, push() {}, refresh() {}, replace() {} }; }
export function usePathname() { return "/admin/comunicacao/webinarios"; }
export function useSearchParams() { return new URLSearchParams(); }
export function redirect(href) { throw new Error("redirect " + href); }
export function notFound() { throw new Error("notFound"); }`,
  "@/components/ui/dialog": `import { createElement } from "react";
${pass}
export function Dialog({ children, open }) { return open ? createElement("div", { "data-stub-dialog": "" }, children) : null; }
export function DialogContent({ children, ...props }) { return createElement("div", { role: "dialog", ...pass(props) }, children); }
export function DialogHeader({ children }) { return createElement("div", null, children); }
export function DialogFooter({ children }) { return createElement("div", { "data-dialog-footer": "" }, children); }
export function DialogTitle({ children }) { return createElement("h2", null, children); }
export function DialogDescription({ children }) { return createElement("p", { "data-dialog-description": "" }, children); }
export function DialogTrigger({ children }) { return children; }
export function DialogClose({ children }) { return children; }`,
  "@/components/ui/dropdown-menu": `import { cloneElement, createElement } from "react";
${pass}
export function DropdownMenu({ children }) { return createElement("div", { "data-stub-menu": "" }, children); }
export function DropdownMenuTrigger({ children, className, onClick, ...props }) { return createElement("button", { "aria-haspopup": "menu", type: "button", ...pass(props) }, children); }
export function DropdownMenuContent({ children }) { return createElement("div", { role: "menu" }, children); }
export function DropdownMenuGroup({ children }) { return createElement("div", { role: "group" }, children); }
export function DropdownMenuLabel({ children }) { return createElement("div", { "data-menu-label": "" }, children); }
export function DropdownMenuSeparator() { return createElement("hr", { "data-menu-separator": "" }); }
export function DropdownMenuItem({ children, disabled, render }) {
  return render ? cloneElement(render, { "data-menu-item": "", role: "menuitem" }, children) : createElement("div", { "aria-disabled": disabled || undefined, "data-menu-item": "", role: "menuitem" }, children);
}`,
  "@/server/webinars/actions": `const fail = async () => ({ error: "Falhou.", ok: false, status: 500 });
export const saveWebinarDraft = fail;
export const publishWebinar = fail;
export const cancelWebinar = fail;
export const duplicateWebinar = fail;
export const deleteWebinar = fail;
export const rescheduleSession = fail;
export const uploadWebinarCover = fail;`,
  "@/server/webinars/script-actions": `const fail = async () => ({ error: "Falhou.", ok: false, status: 500 });
export const saveScriptItems = fail;
export const importScriptCsv = fail;
export const exportScriptCsv = fail;
export const exportSessionChatCsv = fail;
export const saveTranscript = fail;
export const resolveScriptPhrases = fail;
export const fireScriptItem = fail;`,
  "@/server/webinars/room-actions": `const fail = async () => ({ error: "Falhou.", ok: false, status: 500 });
export const openSessionNow = fail;
export const endSessionNow = fail;
export const sendTeamMessage = fail;
export const moderateMessage = fail;
export const setSessionChatMode = fail;
export const savePolls = fail;
export const launchPoll = fail;
export const closePoll = fail;
export const answerQuestion = fail;
export const setQuestionStatus = fail;
export const saveSimulation = fail;
export const createReplaySession = fail;
export const cancelReplaySession = fail;
export const removeStudentMessages = fail;`
};

function withExtension(base) {
  for (const candidate of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (existsSync(fileURLToPath(candidate))) {
      return candidate;
    }
  }

  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBS[specifier]) {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}` };
    }

    const parent = context.parentURL ?? "";

    if (specifier.startsWith("@/")) {
      const found = withExtension(new URL(specifier.slice(2), srcUrl).href);

      if (found) {
        return { shortCircuit: true, url: found };
      }
    }

    if (parent.startsWith(srcUrl) && /^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const found = withExtension(new URL(specifier, parent).href);

      if (found) {
        return { shortCircuit: true, url: found };
      }
    }

    if (parent.startsWith("data:")) {
      return nextResolve(specifier, { ...context, parentURL: new URL("package.json", root).href });
    }

    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(srcUrl) && url.endsWith(".tsx")) {
      const fileName = fileURLToPath(url);
      const { outputText } = ts.transpileModule(readFileSync(fileName, "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        fileName
      });

      return { format: "module", shortCircuit: true, source: outputText };
    }

    return nextLoad(url, context);
  }
});

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const period = await import("../src/components/admin/v2/period.ts");
const vm = await import("../src/server/webinars/editor-model.ts");
const model = await import("../src/server/webinars/model.ts");
const { WebinarsListView } = await import("../src/components/admin/v2/communication/webinars/webinars-list-view.tsx");
const { WebinarsTable } = await import("../src/components/admin/v2/communication/webinars/webinars-table.tsx");
const { WebinarListTabs } = await import("../src/components/admin/v2/communication/webinars/webinar-list-tabs.tsx");
const { WebinarPreview } = await import("../src/components/admin/v2/communication/webinars/webinar-preview.tsx");

const html = (element) => renderToStaticMarkup(element);
const textOf = (markup) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const read = (path) => readFileSync(new URL(path, root), "utf8");
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const now = new Date("2026-10-28T15:00:00Z");
const resolvedPeriod = period.resolveAdminPeriod(period.parseAdminPeriodParam("30d", now), now);
const both = { canPublish: true, canWrite: true };

function item(extra = {}) {
  return {
    coverUrl: null,
    createdAt: "2026-10-20T12:00:00.000Z",
    createdByName: "Equipe de teste",
    id: "0b7f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b",
    kind: "live",
    kindLabel: "Live ao vivo",
    peakPresent: null,
    registeredCount: 12,
    runningSessionId: null,
    sessionsCount: 1,
    situation: "scheduled",
    situationLabel: "Agendado",
    situationTone: "success",
    slug: "aula-de-ia",
    status: "published",
    title: "Aula de IA",
    updatedAt: "2026-10-27T12:00:00.000Z",
    whenIso: "2026-11-05T23:00:00.000Z",
    whenLabel: "05/11/2026 às 20:00",
    ...extra
  };
}

function page(items, extra = {}) {
  return {
    items,
    numbers: { attended: null, liveNow: 0, registered: 12, replayViewers: null, webinars: 1 },
    page: 1,
    pageSize: 20,
    total: items.length,
    totalAll: items.length,
    ...extra
  };
}

const emptyState = { kind: null, page: 1, search: "", situation: null, tab: "webinarios" };

test("lista: cabecalho, abas de Comunicacao, cinco numeros ('—' sem dado), abas da pagina, filtros e a tabela", () => {
  const markup = html(createElement(WebinarsListView, { page: page([item()]), period: resolvedPeriod, permissions: both, searchParams: { periodo: "30d" }, state: emptyState }));
  const text = textOf(markup);

  assert.match(text, /Comunicação/);
  assert.match(markup, /href="\/admin\/comunicacao\/webinarios\/novo"/, "Novo webinário no cabecalho");
  assert.match(text, /Novo webinário/);
  for (const label of ["Webinários", "Vagas garantidas", "Compareceram", "Assistiram o replay", "Ao vivo agora"]) {
    assert.match(text, new RegExp(label), label);
  }
  assert.match(text, /Sem dados no período/, "Compareceram e Assistiram o replay sem dado");
  assert.match(markup, /aria-current="page"[^>]*href="\/admin\/comunicacao\/webinarios\?periodo=30d"/, "a aba Webinários ativa leva o periodo");
  assert.match(markup, /href="\/admin\/comunicacao\/webinarios\?aba=ao-vivo&amp;periodo=30d"/);
  assert.match(markup, /href="\/admin\/comunicacao\/webinarios\?aba=gravadas&amp;periodo=30d"/);
  for (const filter of ["Todos", "Rascunho", "Agendado", "Em andamento", "Encerrado", "Cancelado", "Ao vivo", "Gravada"]) {
    assert.match(text, new RegExp(filter), filter);
  }
  assert.match(markup, /placeholder="Buscar pelo título"/);
  assert.match(text, /Aula de IA/);
  assert.match(text, /05\/11\/2026 às 20:00/);
  assert.match(text, /Equipe de teste/);
  assert.match(markup, /href="\/admin\/comunicacao\/webinarios\/0b7f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b"/, "a linha abre o editor");
  assert.doesNotMatch(text, /Inscritos/);
  assert.doesNotMatch(text, /em construção/i);
});

test("lista: Compareceram e Assistiram o replay vem da RPC do painel; sem ela (migracao 202610300002), '—'", () => {
  const numbersOf = (markup) =>
    Object.fromEntries(
      Array.from(markup.matchAll(/aria-label="([^",]+), ([^,"]+)[^"]*"[^>]*role="group"/g)).map((match) => [match[1], match[2]])
    );
  const filled = html(
    createElement(WebinarsListView, {
      listNumbers: { attended: 37, replayViewers: 12 },
      page: page([item()]),
      period: resolvedPeriod,
      permissions: both,
      searchParams: {},
      state: emptyState
    })
  );
  const values = numbersOf(filled);
  assert.equal(values.Compareceram, "37");
  assert.equal(values["Assistiram o replay"], "12");
  assert.equal(values["Vagas garantidas"], "12");

  const pending = numbersOf(
    html(createElement(WebinarsListView, { listNumbers: { attended: null, replayViewers: null }, page: page([item()]), period: resolvedPeriod, permissions: both, searchParams: {}, state: emptyState }))
  );
  assert.equal(pending.Compareceram, "Sem dados no período");
  assert.equal(pending["Assistiram o replay"], "Sem dados no período");
});

test("lista: sem permissao de criar nao ha 'Novo webinário'; estados vazios de cada aba e do filtro", () => {
  const readOnly = html(createElement(WebinarsListView, { page: page([]), period: resolvedPeriod, permissions: { canPublish: false, canWrite: false }, searchParams: {}, state: emptyState }));
  assert.doesNotMatch(readOnly, /href="\/admin\/comunicacao\/webinarios\/novo"/);
  assert.match(textOf(readOnly), /Nenhum webinário ainda/);

  const empty = textOf(html(createElement(WebinarsListView, { page: page([]), period: resolvedPeriod, permissions: both, searchParams: {}, state: emptyState })));
  assert.match(empty, /Nenhum webinário ainda Crie uma Live ao vivo ou uma Live gravada para os alunos\. Novo webinário/);

  const filtered = html(createElement(WebinarsListView, { page: page([], { totalAll: 3 }), period: resolvedPeriod, permissions: both, searchParams: { situacao: "cancelado" }, state: { ...emptyState, situation: "cancelled" } }));
  assert.match(textOf(filtered), /Nenhum webinário encontrado/);
  assert.match(filtered, /href="\/admin\/comunicacao\/webinarios"[^>]*>Limpar filtros|Limpar filtros/);

  const panelNode = (label) => createElement("div", { "data-test-panel": label }, `Painel ${label}`);
  const liveMarkup = html(
    createElement(WebinarsListView, { page: page([item()]), panel: panelNode("ao-vivo"), period: resolvedPeriod, permissions: both, searchParams: { aba: "ao-vivo" }, state: { ...emptyState, tab: "ao-vivo" } })
  );
  const live = textOf(liveMarkup);
  assert.match(liveMarkup, /data-test-panel="ao-vivo"/, "a aba Lives ao vivo mostra o painel da pagina");
  assert.doesNotMatch(live, /Buscar pelo título|Aula de IA|Sem lives ao vivo ainda/, "nem a tabela da lista nem o estado vazio antigo");
  assert.match(liveMarkup, /aria-current="page"[^>]*href="\/admin\/comunicacao\/webinarios\?aba=ao-vivo"/);

  const recordedMarkup = html(
    createElement(WebinarsListView, { page: page([item()]), panel: panelNode("gravadas"), period: resolvedPeriod, permissions: both, searchParams: { aba: "gravadas" }, state: { ...emptyState, tab: "gravadas" } })
  );
  assert.match(recordedMarkup, /data-test-panel="gravadas"/);
  assert.doesNotMatch(textOf(recordedMarkup), /Buscar pelo título|Aula de IA/);

  const listTab = html(createElement(WebinarsListView, { page: page([item()]), panel: panelNode("ignorado"), period: resolvedPeriod, permissions: both, searchParams: {}, state: emptyState }));
  assert.doesNotMatch(listTab, /data-test-panel/, "a aba Webinarios ignora o painel");
});

test("abas da pagina: a ativa pelo ?aba= (nao pelo endereco) e o periodo junto", () => {
  const markup = html(createElement(WebinarListTabs, { active: "gravadas", searchParams: { periodo: "7d" } }));

  assert.match(markup, /aria-current="page"[^>]*href="\/admin\/comunicacao\/webinarios\?aba=gravadas&amp;periodo=7d"/);
  assert.equal((markup.match(/aria-current="page"/g) ?? []).length, 1);
  assert.equal(textOf(markup), "Webinários Lives ao vivo Lives gravadas");
});

test("tabela: capa, tipo e sessoes, situacao, vagas, presentes '—'; o menu por situacao (Excluir so no rascunho; Abrir a sala vale na fase 3)", () => {
  const rows = [
    item(),
    item({ id: "1c8f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b", kind: "simulated", kindLabel: "Live gravada", registeredCount: 0, sessionsCount: 3, situation: "draft", situationLabel: "Rascunho", situationTone: "neutral", status: "draft", title: "Gravada", whenIso: null, whenLabel: "—" }),
    item({ coverUrl: "https://cdn.exemplo.com/capa.webp", id: "2d9f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b", situation: "cancelled", situationLabel: "Cancelado", situationTone: "error", title: "Cancelada" })
  ];
  const markup = html(createElement(WebinarsTable, { items: rows, permissions: both }));
  const text = textOf(markup);

  assert.match(text, /Aula de IA Live ao vivo/);
  assert.match(text, /Gravada Live gravada · 3 sessões/);
  assert.match(markup, /src="https:\/\/cdn\.exemplo\.com\/capa\.webp"/, "capa pequena");
  assert.match(text, /Agendado/);
  assert.match(text, /Rascunho/);
  assert.match(text, /Cancelado/);
  assert.match(text, /\b12\b/);

  const menus = markup.split('role="menu"').slice(1);
  assert.equal(menus.length, 3, "um menu por linha");
  const labels = (menu) => Array.from(menu.matchAll(/role="menuitem"[^>]*>(.*?)<\/div>/g)).map((match) => textOf(match[1]));
  assert.deepEqual(labels(menus[0]), ["Abrir", "Abrir a sala", "Duplicar", "Cancelar"]);
  assert.doesNotMatch(markup, /em breve/, "a sala ao vivo chegou: nada de 'em breve' na lista");
  assert.match(markup, /data-row-shortcut="open_room" href="\/admin\/comunicacao\/webinarios\/0b7f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b\/sala"/, "a Live ao vivo agendada leva a sala pela linha");
  assert.deepEqual(labels(menus[1]), ["Abrir", "Duplicar", "Excluir"]);
  assert.deepEqual(labels(menus[2]), ["Abrir", "Duplicar"]);

  const writeOnly = html(createElement(WebinarsTable, { items: [rows[1]], permissions: { canPublish: false, canWrite: true } }));
  assert.deepEqual(labels(writeOnly.split('role="menu"')[1]), ["Abrir", "Duplicar"], "sem messaging.publish nao exclui");
});

test("previa do card do aluno: capa 2:3, titulo, tipo, data e o botao; sem dados, os '—' e o titulo de exemplo", () => {
  const draft = model.emptyWebinarDraft("live");
  const empty = textOf(html(createElement(WebinarPreview, { device: "mobile", draft, now: now.getTime() })));
  assert.match(empty, /Card na página inicial/);
  assert.match(empty, /Página do webinário/);
  assert.match(empty, /Seu título aparece aqui/);
  assert.match(empty, /Garantir vaga/);
  assert.match(empty, /Celular · 375 px/);

  const filled = html(createElement(WebinarPreview, { coverUrl: "data:image/webp;base64,AAAA", device: "desktop", draft: { ...draft, registrationRequired: false, scheduledAt: "2026-11-05T23:00:00.000Z", title: "Aula de IA" }, now: now.getTime() }));
  assert.match(filled, /src="data:image\/webp;base64,AAAA"/, "a capa que ainda esta subindo ja aparece");
  assert.match(textOf(filled), /Quinta, 5\/11 às 20:00/);
  assert.match(textOf(filled), /Começa em 8 d/);
  assert.match(textOf(filled), /Entrar/);
  assert.match(filled, /inert=""/, "nada da previa recebe foco");
});

test("paginas: permissao, migracao pendente com o numero certo, loading e not-found, e a lista sem a moldura", () => {
  const list = stripComments(read("src/app/admin/(v2)/comunicacao/webinarios/page.tsx"));
  const create = stripComments(read("src/app/admin/(v2)/comunicacao/webinarios/novo/page.tsx"));
  const detail = stripComments(read("src/app/admin/(v2)/comunicacao/webinarios/[id]/page.tsx"));

  assert.doesNotMatch(list, /CommunicationFrame|data-phase/);
  assert.match(list, /readAdminPeriod\(params, new Date\(now\)\)/);
  assert.match(list, /listWebinarsForAdmin\(/);
  assert.match(list, /webinarsPageFallbackHref\(/, "?pagina= depois do fim volta para a ultima");
  assert.match(list, /getWebinarListNumbers\(period, \{ now \}\)/, "Compareceram e Assistiram o replay pela RPC do painel");
  assert.match(list, /<WebinarPanelTab kind=\{state\.tab === "ao-vivo" \? "live" : "simulated"\} now=\{now\} period=\{period\} searchParams=\{params\} \/>/);
  for (const source of [list, create, detail]) {
    assert.match(source, /requirePageArea\("comunicacao"\)/);
    assert.match(source, /loadUnlessPendingMigration\(/);
    assert.match(source, /<PendingMigrationNotice migration=\{WEBINARS_MIGRATION\} \/>/);
  }
  assert.match(create, /redirect\(WEBINARS_HREF\)/, "quem nao cria avisos volta para a lista");
  assert.match(detail, /notFound\(\)/);
  assert.equal(vm.WEBINARS_HREF, "/admin/comunicacao/webinarios");

  for (const route of ["webinarios", "webinarios/novo", "webinarios/[id]"]) {
    assert.ok(existsSync(new URL(`src/app/admin/(v2)/comunicacao/${route}/page.tsx`, root)), `${route}/page.tsx`);
  }
  assert.ok(existsSync(new URL("src/app/admin/(v2)/comunicacao/webinarios/loading.tsx", root)));
  assert.ok(existsSync(new URL("src/app/admin/(v2)/comunicacao/webinarios/[id]/loading.tsx", root)));
  assert.ok(existsSync(new URL("src/app/admin/(v2)/comunicacao/webinarios/[id]/not-found.tsx", root)));

  // Toda escrita passa pela service role e pela permissao certa.
  const actions = stripComments(read("src/server/webinars/actions.ts"));
  assert.match(actions, /^"use server";/);
  assert.match(actions, /runAdminAction\("messaging\.write", saveWebinarSchema/);
  assert.match(actions, /runAdminAction\("messaging\.publish", webinarIdSchema, input, async[\s\S]*?status: "published"/, "publicar pede messaging.publish");
  assert.match(actions, /runAdminAction\("messaging\.publish", cancelWebinarSchema/);
  assert.match(actions, /queueWebinarCancelledNotices\(db, row\.id, now\)/);
  assert.match(actions, /queueWebinarRescheduledNotices\(db, (live|session)\.id, now\)/);
  assert.match(actions, /persistImageAsset\(data\.image, "webinars\/covers"\)/);
  assert.doesNotMatch(actions, /full_name|email:/, "nada de nome ou e-mail na auditoria");
  for (const action of ["webinar.saved", "webinar.published", "webinar.cancelled", "webinar.duplicated", "webinar.deleted", "webinar.rescheduled"]) {
    assert.match(actions, new RegExp(`action: "${action.replace(".", "\\.")}"`), action);
  }
});
