import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import "./support/transpile-tsx.mjs";

// O admin do webinario leva a equipe ao console da Live ao vivo (docs/30 §2.1, §2.2, §2.3, §2.6, §6.4 passo 3, §6.7 e
// §8.1; fase 3, frente F5). Aqui, sem banco e sem navegador:
// - os caminhos para o console /[id]/sala por situacao, tipo e permissao: Abrir a sala (agendado), Abrir o console (em
//   andamento) e o Encerrar live da Live ao vivo, no topo do editor, no menu "…" e na linha da lista; quem so escreve
//   na Comunicacao ve Abrir a sala e Encerrar live desligados com a explicacao; a Live gravada segue com o Encerrar
//   por confirmacao;
// - o card Gravacao: o rotulo de cada recorder_status (§2.2), Gravar automaticamente com o custo e os 30 min,
//   Preparar gravação e Enviar gravação como links para o console, e o aviso discreto sem a sala no ambiente;
// - as Server Actions de actions.ts num banco em memoria: publicar gera o nome da sala; duplicar nao copia sessao,
//   room_name nem recorder_*; cancelar uma live com a maquina do gravador ligada nao chama o GitHub (o job
//   webinar-recordings devolve a maquina); mudar a hora mantem o nome da sala;
// - o nome da sala nunca vai para a tela nem para as props dos componentes cliente (getWebinarEditorData,
//   listWebinarsForAdmin e o editor desenhado).
// Os .tsx sao transpilados por tests/support/transpile-tsx.mjs; o Dialog e o DropdownMenu viram versoes sem portal
// (como em tests/webinarios-admin-tela.test.mjs) para os itens do menu aparecerem no HTML.

process.env.NEXT_PUBLIC_SITE_URL = "https://membros.exemplo.test";
// Com o token do GitHub no ambiente, um disparo do gravador iria para a rede: o teste confere que nada sai.
process.env.GITHUB_INFRA_TOKEN = "ghp_teste_nunca_usado";

const estado = (globalThis.__adminAoVivo ??= { negar: false, revalidados: [] });
const HOST = "00000000-0000-4000-8000-000000000001";

const pass = `function pass(props) { const out = {}; for (const [key, value] of Object.entries(props)) { if (key.startsWith("data-") || key.startsWith("aria-") || key === "id" || key === "role") out[key] = value; } return out; }`;

const STUBS = {
  "@/components/ui/dialog": `import { createElement } from "react";
${pass}
export function Dialog({ children, open }) { return open ? createElement("div", { "data-stub-dialog": "" }, children) : null; }
export function DialogContent({ children, ...props }) { return createElement("div", { role: "dialog", ...pass(props) }, children); }
export function DialogHeader({ children }) { return createElement("div", null, children); }
export function DialogFooter({ children }) { return createElement("div", null, children); }
export function DialogTitle({ children }) { return createElement("h2", null, children); }
export function DialogDescription({ children }) { return createElement("p", null, children); }
export function DialogTrigger({ children }) { return children; }
export function DialogClose({ children }) { return children; }`,
  "@/components/ui/dropdown-menu": `import { cloneElement, createElement } from "react";
${pass}
export function DropdownMenu({ children }) { return createElement("div", { "data-stub-menu": "" }, children); }
export function DropdownMenuTrigger({ children, className, onClick, ...props }) { return createElement("button", { "aria-haspopup": "menu", type: "button", ...pass(props) }, children); }
export function DropdownMenuContent({ children }) { return createElement("div", { role: "menu" }, children); }
export function DropdownMenuGroup({ children }) { return createElement("div", { role: "group" }, children); }
export function DropdownMenuLabel({ children }) { return createElement("div", null, children); }
export function DropdownMenuSeparator() { return createElement("hr", { "data-menu-separator": "" }); }
export function DropdownMenuItem({ children, disabled, render }) {
  return render ? cloneElement(render, { "data-menu-item": "", role: "menuitem" }, children) : createElement("div", { "aria-disabled": disabled || undefined, "data-menu-item": "", role: "menuitem" }, children);
}`,
  "@/server/auth/permissions": `
export async function requireRole(action) {
  const estado = globalThis.__adminAoVivo;
  if (estado.negar === true || (Array.isArray(estado.negar) && estado.negar.includes(action))) {
    const error = new Error("Sem permissão para Comunicação.");
    error.status = 403;
    throw error;
  }
  return globalThis.__adminActionStubs.role;
}
export async function requireScope() {}`,
  "@/server/auth/session": `
export async function getAuthenticatedUser() { return globalThis.__adminActionStubs.role.user; }
export async function getAdminAccessForUser() { return null; }
export function getUserDisplayName(user) {
  const fullName = (user.user_metadata?.full_name ?? "").trim() || "Equipe";
  return { fullName, name: fullName.split(/\\s+/)[0] };
}`,
  "next/cache": `
export function revalidatePath(path) { globalThis.__adminAoVivo.revalidados.push(path); }
export function revalidateTag(tag) { globalThis.__adminAoVivo.revalidados.push(tag); }
export function updateTag(tag) { globalThis.__adminAoVivo.revalidados.push(tag); }
export function unstable_cache(fn) { return fn; }`
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const source = STUBS[specifier] ?? (specifier.endsWith("/db/supabase/client") ? `export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; } export function hasSupabaseConfig() { return true; }` : null);

    if (source !== null) {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }

    return nextResolve(specifier, context);
  }
});

actionStubs.role = { role: "owner", user: { email: "produtor.teste@bunker707.test", id: HOST, user_metadata: { full_name: "Produtor de Teste" } } };

// Nenhuma chamada de rede: o GitHub (jibri-up/jibri-down) nunca e chamado pelas acoes do editor.
const fetches = [];
globalThis.fetch = async (url) => {
  fetches.push(String(url));
  throw new Error(`rede bloqueada no teste: ${url}`);
};

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const vm = await import("../src/server/webinars/editor-model.ts");
const model = await import("../src/server/webinars/model.ts");
const rows = await import("../src/server/webinars/rows.ts");
const { RECORDER_STATUSES } = await import("../src/server/webinars/recorder-model.ts");
const { isRoomName } = await import("../src/server/webinars/jitsi-token.ts");
const { liveRoomConfigured } = await import("../src/server/webinars/live-model.ts");
const { PROIBIDAS_WEBINARIO, WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const actions = await import("../src/server/webinars/actions.ts");
const queries = await import("../src/server/webinars/queries.ts");
const { RecordingCard } = await import("../src/components/admin/v2/communication/webinars/webinar-editor-cards.tsx");
const { WebinarEditor } = await import("../src/components/admin/v2/communication/webinars/webinar-editor.tsx");
const { WebinarsTable } = await import("../src/components/admin/v2/communication/webinars/webinars-table.tsx");

const html = (element) => renderToStaticMarkup(element);
const textOf = (markup) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
/** As tags de abertura com o atributo dado (a ordem dos atributos nao importa). */
const tagsWith = (markup, attribute) => Array.from(markup.matchAll(/<(?:a|button|span)\b[^>]*>/g), (match) => match[0]).filter((tag) => tag.includes(attribute));
/** Ha um link (<a>) com o atributo e o endereco dados. */
const linkTo = (markup, attribute, href) => tagsWith(markup, attribute).some((tag) => tag.startsWith("<a") && tag.includes(`href="${href}"`));
/** O atributo aparece, mas nunca num link. */
const notLink = (markup, attribute) => tagsWith(markup, attribute).length > 0 && tagsWith(markup, attribute).every((tag) => !tag.startsWith("<a") && !/\shref=/.test(tag));
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const both = { canPublish: true, canWrite: true };
const writeOnly = { canPublish: false, canWrite: true };
const ID = "0b7f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b";
const CONSOLE = `/admin/comunicacao/webinarios/${ID}/sala`;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/* ------------------------------------------------------------------------------------------------
 * Modelo: os caminhos para o console
 * ---------------------------------------------------------------------------------------------- */

test("caminhos para o console: Abrir a sala e Abrir o console levam a /[id]/sala; o Encerrar live da Live ao vivo tambem (sem confirmacao); o da Live gravada segue a confirmacao", () => {
  assert.equal(vm.webinarActionHref("open_room", ID, "live"), CONSOLE);
  assert.equal(vm.webinarActionHref("open_room", ID, "simulated"), CONSOLE, "na Live gravada, o console da fase 2");
  assert.equal(vm.webinarActionHref("open_console", ID, "live"), CONSOLE);
  assert.equal(vm.webinarActionHref("end", ID, "live"), CONSOLE, "a acao de encerrar mora no console");
  assert.equal(vm.webinarActionHref("end", ID, "simulated"), null);
  assert.equal(vm.webinarActionHref("end", ID), null, "sem o tipo, o Encerrar nao navega");
  assert.equal(vm.isWebinarLinkAction("end", "live"), true);
  assert.equal(vm.isWebinarLinkAction("end", "simulated"), false);
  assert.equal(vm.isWebinarLinkAction("open_room"), true);
  assert.equal(vm.webinarActionNeedsConfirm("end", "live"), false);
  assert.equal(vm.webinarActionNeedsConfirm("end", "simulated"), true);
  assert.equal(vm.webinarActionNeedsConfirm("cancel", "live"), true);

  const header = (situation, kind, permissions = both) =>
    vm.webinarHeaderButtons({ id: ID, kind, permissions, situation }).map((button) => [button.action, button.label, button.href, button.blocked, button.soon]);

  assert.deepEqual(header("scheduled", "live"), [["open_room", "Abrir a sala", CONSOLE, null, false]]);
  assert.deepEqual(header("in_progress", "live"), [
    ["open_console", "Abrir o console", CONSOLE, null, false],
    ["end", "Encerrar live", CONSOLE, null, false]
  ]);
  assert.deepEqual(header("in_progress", "simulated"), [["open_console", "Abrir o console", CONSOLE, null, false]], "na Live gravada o Encerrar fica no menu, com confirmacao");
  assert.deepEqual(header("ended", "live"), [
    ["view_report", "Ver relatório", `/admin/comunicacao/webinarios/${ID}/relatorio`, null, false],
    ["publish_replay", "Publicar replay", null, null, true]
  ]);
  assert.deepEqual(header("draft", "live"), [], "Salvar e Publicar ficam na Revisao");
  assert.deepEqual(header("cancelled", "live"), []);
  assert.deepEqual(header("in_progress", "live", { canPublish: false, canWrite: false }), [], "sem messaging.write, nada");

  const menu = (situation, kind, permissions = both, exclude = []) => vm.webinarMenuEntries(situation, permissions, exclude, kind).map((entry) => [entry.action, entry.display, entry.destructive]);

  assert.deepEqual(menu("in_progress", "live"), [
    ["open", "Abrir", false],
    ["open_console", "Abrir o console", false],
    ["duplicate", "Duplicar", false],
    ["end", "Encerrar live", true]
  ]);
  assert.deepEqual(menu("scheduled", "live"), [
    ["open", "Abrir", false],
    ["open_room", "Abrir a sala", false],
    ["duplicate", "Duplicar", false],
    ["cancel", "Cancelar", true]
  ]);
  assert.ok(
    vm.webinarMenuEntries("scheduled", both, [], "live").every((entry) => !entry.soon && entry.blocked === null),
    "nada de 'em breve' na Live ao vivo agendada"
  );
});

test("permissao (§2.6): quem so escreve ve Abrir a sala e o Encerrar live da Live ao vivo desligados com a explicacao; Cancelar e Excluir seguem fora", () => {
  const scheduled = vm.webinarHeaderButtons({ id: ID, kind: "live", permissions: writeOnly, situation: "scheduled" });
  assert.deepEqual(scheduled, [{ action: "open_room", blocked: "Só quem publica na Comunicação abre a sala.", href: null, label: "Abrir a sala", soon: false }]);

  const running = vm.webinarHeaderButtons({ id: ID, kind: "live", permissions: writeOnly, situation: "in_progress" });
  assert.deepEqual(
    running.map((button) => [button.action, button.href, button.blocked]),
    [
      ["open_console", CONSOLE, null],
      ["end", null, "Só quem publica na Comunicação encerra a live."]
    ],
    "o console vale para a Equipe; encerrar, nao"
  );
  assert.deepEqual(
    vm.webinarHeaderButtons({ id: ID, kind: "simulated", permissions: writeOnly, situation: "in_progress" }).map((button) => button.action),
    ["open_console"],
    "na Live gravada, como antes"
  );

  const entries = (situation, kind) => vm.webinarMenuEntries(situation, writeOnly, [], kind).map((entry) => [entry.action, entry.display, entry.blocked !== null]);
  assert.deepEqual(entries("scheduled", "live"), [
    ["open", "Abrir", false],
    ["open_room", "Abrir a sala · só quem publica", true],
    ["duplicate", "Duplicar", false]
  ]);
  assert.deepEqual(entries("in_progress", "live"), [
    ["open", "Abrir", false],
    ["open_console", "Abrir o console", false],
    ["duplicate", "Duplicar", false],
    ["end", "Encerrar live · só quem publica", true]
  ]);
  assert.deepEqual(entries("in_progress", "simulated"), [
    ["open", "Abrir", false],
    ["open_console", "Abrir o console", false],
    ["duplicate", "Duplicar", false]
  ]);
  assert.equal(vm.webinarActionBlockedReason("cancel", writeOnly, "live"), null, "Cancelar sem permissao nao aparece");
  assert.deepEqual(vm.webinarActionsFor("draft", writeOnly, "live"), ["open", "save", "duplicate"]);

  // O atalho na linha da lista.
  const shortcut = (situation, kind, permissions = both) => vm.webinarRowShortcut({ id: ID, kind, situation }, permissions);
  assert.deepEqual(shortcut("scheduled", "live"), { action: "open_room", href: CONSOLE, label: "Abrir a sala" });
  assert.equal(shortcut("scheduled", "live", writeOnly), null, "quem nao publica acha o item desligado no menu");
  assert.deepEqual(shortcut("in_progress", "live", writeOnly), { action: "open_console", href: CONSOLE, label: "Abrir o console" });
  assert.equal(shortcut("in_progress", "simulated"), null, "a Live gravada fica com o menu");
  assert.equal(shortcut("ended", "live"), null);
  assert.equal(shortcut("draft", "live"), null);
  assert.equal(shortcut("in_progress", "live", { canPublish: false, canWrite: false }), null);
});

/* ------------------------------------------------------------------------------------------------
 * Card Gravacao
 * ---------------------------------------------------------------------------------------------- */

const RECORDER_NAMES = {
  gone: "Apagado",
  none: "Não preparado",
  preparing: "Preparando",
  ready: "Pronto",
  recording: "Gravando",
  unavailable: "Sem gravador hoje",
  upload_failed: "Falhou no envio",
  uploaded: "Pronto na Bunny",
  uploading: "Enviando para a Bunny"
};

test("card Gravacao: o rotulo de cada recorder_status (§2.2); Preparar gravação so com a maquina por pedir e a sessao por acontecer; Enviar gravação para o console", () => {
  assert.deepEqual([...RECORDER_STATUSES].sort(), Object.keys(RECORDER_NAMES).sort());
  const card = (recorderStatus, extra = {}) =>
    vm.webinarRecordingCard({ autoRecord: true, liveRoomReady: true, liveSession: { recorderStatus, status: "scheduled" }, permissions: both, webinarId: ID, ...extra });

  for (const status of RECORDER_STATUSES) {
    const view = card(status);
    assert.equal(view.status.label, RECORDER_NAMES[status], status);
    assert.equal(view.status.value, status);
    assert.equal(view.status.tone, vm.RECORDER_TONES[status]);
    assert.equal(view.pendingNote, null);
    assert.deepEqual(view.upload, { blocked: null, href: CONSOLE, label: "Enviar gravação" }, `Enviar gravação em ${status}`);
    assert.equal(view.prepare !== null, ["none", "unavailable", "gone"].includes(status), `Preparar gravação em ${status}`);
  }

  assert.deepEqual(card("none").prepare, { blocked: null, href: CONSOLE, label: "Preparar gravação" });
  assert.deepEqual(card("unavailable", { liveSession: { recorderStatus: "unavailable", status: "live" } }).prepare?.href, CONSOLE, "no ar, sem maquina, ainda da para pedir");
  assert.equal(card("none", { liveSession: { recorderStatus: "none", status: "ended" } }).prepare, null, "depois do fim, nada a preparar");
  assert.equal(card("none", { liveSession: { recorderStatus: "none", status: "cancelled" } }).upload, null, "sessao cancelada: nada a enviar");
  assert.deepEqual(card("none", { permissions: writeOnly }).prepare, { blocked: "Só quem publica na Comunicação prepara a gravação.", href: null, label: "Preparar gravação" });
  assert.equal(card("none", { permissions: writeOnly }).upload?.href, CONSOLE, "Enviar gravação vale para quem escreve (attachRecording)");

  // Antes de publicar: sem a sessao live, "Não preparado" e a frase de que a sala nasce ao publicar.
  const draft = vm.webinarRecordingCard({ autoRecord: true, liveRoomReady: true, liveSession: null, permissions: both, webinarId: null });
  assert.equal(draft.status.label, "Não preparado");
  assert.match(draft.pendingNote ?? "", /nascem ao publicar/);
  assert.equal(draft.prepare, null);
  assert.equal(draft.upload, null);

  // Gravar automaticamente: o servidor criado 30 min antes (RECORDER_RULES.prepareLeadMinutes) com o custo; desligado, a outra frase.
  assert.match(card("none").autoRecordHint, /criado 30 min antes da live e apagado no fim, cobrado por hora \(uma live de 2 h gravada em 1080p custa cerca de EUR 0,30\)/);
  assert.match(card("none", { autoRecord: false }).autoRecordHint, /Preparar gravação/);

  // Sem a sala no ambiente: o aviso discreto de consoleAoVivo.salaEmBreve.
  assert.equal(card("none").roomMissingNote, null);
  assert.equal(card("none", { liveRoomReady: false }).roomMissingNote, WEBINAR_COPY.consoleAoVivo.salaEmBreve);
  assert.equal(liveRoomConfigured({}), false, "sem WEBINAR_MEET_DOMAIN nem o segredo, a sala nao existe");
  assert.equal(liveRoomConfigured({ WEBINAR_JWT_SECRET: "s".repeat(40), WEBINAR_MEET_DOMAIN: "meet.exemplo.test" }), true);
});

test("card Gravacao na tela: a situacao do gravador, os links para o console, a frase de quem nao publica e o aviso sem a sala", () => {
  const draft = { ...model.emptyWebinarDraft("live"), autoRecord: true };
  const props = { disabled: false, draft, errorFor: () => undefined, now: Date.now(), onBlur() {}, onChange() {} };

  const ready = html(createElement(RecordingCard, { ...props, liveRoomReady: false, liveSession: { recorderStatus: "unavailable", status: "scheduled" }, permissions: both, webinarId: ID }));
  const text = textOf(ready);
  assert.match(text, /Situação do servidor de gravação: Sem gravador hoje/);
  assert.match(ready, /data-recorder-status="unavailable"/);
  assert.ok(linkTo(ready, 'data-card-link="prepare"', `${CONSOLE}`), "Preparar gravação leva ao console");
  assert.ok(linkTo(ready, 'data-card-link="upload"', `${CONSOLE}`), "Enviar gravação leva ao console");
  assert.match(text, /Preparar gravação/);
  assert.match(text, /Enviar gravação/);
  assert.match(text, /criado 30 min antes da live/);
  assert.match(text, /A sala ao vivo ainda não está configurada neste ambiente\./);
  assert.doesNotMatch(text, /em breve/, "nada de 'em breve' no card Gravacao");
  assert.doesNotMatch(text, /Enviar arquivo · em breve/);

  const configured = textOf(html(createElement(RecordingCard, { ...props, liveRoomReady: true, liveSession: { recorderStatus: "recording", status: "live" }, permissions: both, webinarId: ID })));
  assert.match(configured, /Gravando/);
  assert.doesNotMatch(configured, /ainda não está configurada/);
  assert.doesNotMatch(configured, /Preparar gravação/, "gravando: nada a preparar");

  const analyst = html(createElement(RecordingCard, { ...props, liveRoomReady: true, liveSession: { recorderStatus: "none", status: "scheduled" }, permissions: writeOnly, webinarId: ID }));
  assert.ok(notLink(analyst, 'data-card-link="prepare"'), "sem messaging.publish, Preparar gravação nao e link");
  assert.match(textOf(analyst), /Só quem publica na Comunicação prepara a gravação\./);
  assert.ok(linkTo(analyst, 'data-card-link="upload"', `${CONSOLE}`));

  const unpublished = textOf(html(createElement(RecordingCard, { ...props, liveRoomReady: true, liveSession: null, permissions: both, webinarId: null })));
  assert.match(unpublished, /Não preparado/);
  assert.match(unpublished, /nascem ao publicar/);
  assert.doesNotMatch(unpublished, /Preparar gravação|Enviar gravação/);
});

/* ------------------------------------------------------------------------------------------------
 * Banco em memoria (o desenho de tests/webinarios-roteiro-acoes.test.mjs, com as colunas da 202610290002)
 * ---------------------------------------------------------------------------------------------- */

let relogio = Date.now() - 3_600_000;
const agora = () => new Date((relogio += 1_000)).toISOString();

const DEFAULTS = {
  webinar_sessions: {
    chat_mode: "open",
    chat_slow_mode_seconds: null,
    ended_at: null,
    late_join_minutes: null,
    pinned_message_id: null,
    presence_curve: null,
    recorder_alerted_at: null,
    recorder_release_requested_at: null,
    recorder_requested_at: null,
    recorder_status: "none",
    recording_anchor_at: null,
    recording_id: null,
    recording_requested_at: null,
    room_locked: false,
    room_name: null,
    script_fired_at: null,
    show_live_badge: false,
    simulation_ack_text: null,
    simulation_decided_at: null,
    simulation_decided_by: null,
    source_session_id: null,
    started_at: null,
    status: "scheduled"
  },
  webinars: { cancel_reason: null, cancelled_at: null, deleted_at: null, published_at: null }
};

function parseOr(expression) {
  return String(expression)
    .split(",")
    .map((part) => {
      const [column, op, ...rest] = part.split(".");
      const raw = rest.join(".");
      return { column, op, value: raw === "null" ? null : raw };
    });
}

function matches(row, filters) {
  return filters.every(([method, column, value]) => {
    switch (method) {
      case "eq":
        return row[column] === value;
      case "neq":
        return row[column] !== value;
      case "in":
        return value.includes(row[column]);
      case "is":
        return value === null ? row[column] == null : row[column] === value;
      case "gt":
        return row[column] > value;
      case "gte":
        return row[column] >= value;
      case "lt":
        return row[column] < value;
      case "lte":
        return row[column] <= value;
      case "like":
        return String(row[column] ?? "").startsWith(String(value).replace(/%$/, ""));
      case "or":
        return parseOr(column).some(({ column: col, op, value: val }) => (op === "eq" ? row[col] === val : op === "is" ? (val === null ? row[col] == null : row[col] === val) : true));
      default:
        return true;
    }
  });
}

function bancoEmMemoria(seed = {}) {
  const tables = {
    admin_audit_log: [],
    admin_roles: [{ permissions: null, role: "owner", user_id: HOST }],
    email_outbox: [],
    notifications: [],
    profiles: [{ full_name: "Produtor de Teste", id: HOST }],
    webinar_poll_options: [],
    webinar_polls: [],
    webinar_presenters: [],
    webinar_recordings: [],
    webinar_registrations: [],
    webinar_sessions: [],
    webinars: [],
    ...structuredClone(seed)
  };
  const rpcs = [];

  function run(query) {
    const rows = (tables[query.table] ??= []);

    if (query.op === "insert") {
      const inserted = (Array.isArray(query.payload) ? query.payload : [query.payload]).map((item) => ({
        created_at: agora(),
        id: randomUUID(),
        ...(DEFAULTS[query.table] ?? {}),
        ...structuredClone(item),
        updated_at: agora()
      }));
      rows.push(...inserted);
      return { data: query.single ? structuredClone(inserted[0]) : structuredClone(inserted), error: null };
    }

    const found = rows.filter((row) => matches(row, query.filters));

    if (query.op === "update") {
      found.forEach((row) => Object.assign(row, structuredClone(query.payload), { updated_at: agora() }));
      return { data: query.single ? (structuredClone(found[0]) ?? null) : structuredClone(found), error: null };
    }

    if (query.op === "delete") {
      tables[query.table] = rows.filter((row) => !found.includes(row));
      return { data: structuredClone(found), error: null };
    }

    let result = [...found];
    for (const [column, ascending] of [...query.order].reverse()) {
      result.sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (ascending ? 1 : -1));
    }
    if (query.range) {
      result = result.slice(query.range[0], query.range[1] + 1);
    } else if (query.limit !== null) {
      result = result.slice(0, query.limit);
    }
    if (query.head) {
      return { count: found.length, data: null, error: null };
    }
    return { count: found.length, data: query.single ? (structuredClone(result[0]) ?? null) : structuredClone(result), error: null };
  }

  function chain(query) {
    const self = {
      delete: () => ((query.op = "delete"), self),
      eq: (column, value) => (query.filters.push(["eq", column, value]), self),
      gt: (column, value) => (query.filters.push(["gt", column, value]), self),
      gte: (column, value) => (query.filters.push(["gte", column, value]), self),
      in: (column, value) => (query.filters.push(["in", column, value]), self),
      insert: (payload) => ((query.op = "insert"), (query.payload = payload), self),
      is: (column, value) => (query.filters.push(["is", column, value]), self),
      like: (column, value) => (query.filters.push(["like", column, value]), self),
      limit: (value) => ((query.limit = value), self),
      lt: (column, value) => (query.filters.push(["lt", column, value]), self),
      lte: (column, value) => (query.filters.push(["lte", column, value]), self),
      maybeSingle: () => ((query.single = true), self),
      neq: (column, value) => (query.filters.push(["neq", column, value]), self),
      not: () => self,
      or: (expression) => (query.filters.push(["or", expression]), self),
      order: (column, options = {}) => (query.order.push([column, options.ascending !== false]), self),
      range: (from, to) => ((query.range = [from, to]), self),
      select: (_columns, options = {}) => ((query.head = Boolean(options.head)), self),
      single: () => ((query.single = true), self),
      then: (resolve, reject) => Promise.resolve(run(query)).then(resolve, reject),
      update: (payload) => ((query.op = "update"), (query.payload = payload), self),
      upsert: (payload) => ((query.op = "insert"), (query.payload = payload), self)
    };
    return self;
  }

  return {
    from: (table) => chain({ filters: [], head: false, limit: null, op: "select", order: [], payload: undefined, range: null, single: false, table }),
    async rpc(name, args) {
      rpcs.push({ args, name });
      return { data: null, error: null };
    },
    rpcs,
    tables
  };
}

function usar(db) {
  actionStubs.db = db;
  estado.negar = false;
  estado.revalidados.length = 0;
  fetches.length = 0;
  return db;
}

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

const WEBINAR = "aaaaaaaa-1111-4111-8111-111111111111";
const SESSAO = "bbbbbbbb-2222-4222-8222-111111111111";
const SALA = `w-${WEBINAR}-abcdefghijkmnpqr`;
const ALUNO = "cccccccc-3333-4333-8333-333333333333";

function liveDraft(extra = {}) {
  return { ...model.emptyWebinarDraft("live"), autoRecord: true, hostUserId: HOST, scheduledAt: new Date(Date.now() + 2 * DAY).toISOString(), title: "Live de teste", ...extra };
}

/** Um webinario Live ao vivo publicado com a sessao live (nome da sala e a maquina do gravador na situacao dada). */
function cenario({ recorderStatus = "ready", sessionStatus = "scheduled", situation = {} } = {}) {
  const draft = liveDraft();
  const webinar = {
    ...rows.webinarRowPatch(draft),
    cancel_reason: null,
    cancelled_at: null,
    created_at: agora(),
    created_by: HOST,
    deleted_at: null,
    id: WEBINAR,
    published_at: agora(),
    slug: "live-de-teste",
    status: "published",
    updated_at: agora()
  };
  const session = {
    ...DEFAULTS.webinar_sessions,
    created_at: agora(),
    id: SESSAO,
    kind: "live",
    recorder_requested_at: recorderStatus === "none" ? null : new Date(Date.now() - 20 * MIN).toISOString(),
    recorder_status: recorderStatus,
    room_name: SALA,
    scheduled_at: draft.scheduledAt,
    status: sessionStatus,
    updated_at: agora(),
    webinar_id: WEBINAR,
    ...situation
  };
  return {
    webinar_presenters: [{ can_moderate_room: false, created_at: agora(), role: "co_host", user_id: "dddddddd-4444-4444-8444-444444444444", valid_until: null, webinar_id: WEBINAR }],
    webinar_registrations: [
      { calendar_token: "t".repeat(32), cancelled_at: null, created_at: agora(), id: randomUUID(), registered_at: agora(), session_id: SESSAO, status: "registered", updated_at: agora(), user_id: ALUNO, webinar_id: WEBINAR }
    ],
    webinar_sessions: [session],
    webinars: [webinar]
  };
}

/* ------------------------------------------------------------------------------------------------
 * Server Actions (actions.ts)
 * ---------------------------------------------------------------------------------------------- */

test("publicar a Live ao vivo gera o nome da sala (so na sessao live); duplicar nao copia sessao, room_name nem recorder_*", async () => {
  const db = usar(bancoEmMemoria({ admin_roles: [{ permissions: null, role: "owner", user_id: HOST }] }));
  const saved = ok(await actions.saveWebinarDraft({ draft: liveDraft() }));
  ok(await actions.publishWebinar({ expectedUpdatedAt: saved.updatedAt, id: saved.id }));

  const [session] = db.tables.webinar_sessions.filter((row) => row.webinar_id === saved.id);
  assert.equal(session.kind, "live");
  assert.ok(isRoomName(session.room_name), `nome da sala: ${session.room_name}`);
  assert.ok(session.room_name.startsWith(`w-${saved.id}-`));

  // A maquina foi pedida e esta pronta (como o job deixaria): a copia nao leva nada disso.
  Object.assign(session, { recorder_requested_at: agora(), recorder_status: "ready", recording_requested_at: agora(), room_locked: true });
  const sessionsBefore = db.tables.webinar_sessions.length;
  const copy = ok(await actions.duplicateWebinar({ id: saved.id }));

  const created = db.tables.webinars.find((row) => row.id === copy.id);
  assert.equal(created.status, "draft");
  assert.equal(created.scheduled_at, null, "a copia nao leva a data");
  assert.equal(created.auto_record, true, "o resto do card Gravacao vai junto");
  assert.equal(created.title, "Cópia de Live de teste");
  assert.equal(db.tables.webinar_sessions.length, sessionsBefore, "nenhuma sessao nova");
  assert.equal(db.tables.webinar_sessions.filter((row) => row.webinar_id === copy.id).length, 0);
  const serialized = JSON.stringify(created);
  assert.doesNotMatch(serialized, /room_name|recorder_|recording_requested_at|room_locked/);
  assert.ok(!serialized.includes(session.room_name), "o nome da sala nao vai para a copia");
  assert.equal(session.room_name.length > 0 && session.recorder_status, "ready", "a sessao original fica como estava");
  assert.deepEqual(fetches, [], "nada vai para a rede");
  // Fase 4: a Live ao vivo nao tem o "Comeca quando voce entra"; a auditoria diz o que a copia levou.
  const audit = db.tables.admin_audit_log.find((row) => row.action === "webinar.duplicated" && row.entity_id === copy.id);
  assert.deepEqual([audit.metadata.jit_copied, audit.metadata.offer_copied, audit.metadata.assistant_items], [false, false, 0]);
});

test("cancelar uma Live ao vivo com a maquina do gravador ligada: a sessao vira cancelada, o nome da sala e o gravador ficam, e nada chama o GitHub", async () => {
  for (const recorderStatus of ["preparing", "ready"]) {
    const db = usar(bancoEmMemoria(cenario({ recorderStatus })));
    const result = ok(await actions.cancelWebinar({ id: WEBINAR, reason: "Imprevisto" }));

    assert.equal(result.situation, "cancelled");
    const [session] = db.tables.webinar_sessions;
    assert.equal(session.status, "cancelled");
    assert.equal(session.room_name, SALA, "o nome da sala nao muda");
    assert.equal(session.recorder_status, recorderStatus, "quem devolve a maquina e o job webinar-recordings");
    assert.equal(session.recorder_release_requested_at, null, "nenhum pedido de devolucao daqui");
    assert.deepEqual(fetches, [], `nenhuma chamada de rede (${recorderStatus})`);
    assert.ok(!db.rpcs.some((call) => /recorder|jibri|dispatch/i.test(call.name)));
    const audit = db.tables.admin_audit_log.find((row) => row.action === "webinar.cancelled");
    assert.ok(audit, "auditado");
    assert.ok(!JSON.stringify(audit).includes(SALA), "a auditoria nao leva o nome da sala");
  }

  // O editor do webinario cancelado mostra a situacao do gravador da sessao cancelada, sem caminhos para o console.
  const cancelled = await queries.getWebinarEditorData(WEBINAR);
  assert.equal(cancelled.situation, "cancelled");
  assert.equal(cancelled.liveSession?.status, "cancelled");
  const view = vm.webinarRecordingCard({ autoRecord: true, liveRoomReady: true, liveSession: cancelled.liveSession, permissions: both, webinarId: WEBINAR });
  assert.equal(view.status.label, "Pronto");
  assert.equal(view.pendingNote, null, "nada de 'nascem ao publicar' num cancelado");
  assert.equal(view.prepare, null);
  assert.equal(view.upload, null);

  // Por construcao: actions.ts nao importa o adaptador do gravador nem as acoes do console, e nao fala com a API do GitHub.
  const source = stripComments(read("src/server/webinars/actions.ts"));
  assert.doesNotMatch(source, /recorder-dispatch|live-actions|api\.github\.com|GITHUB_INFRA_TOKEN|releaseRecorder|prepareRecorder/);
});

test("mudar a hora da Live ao vivo agendada (rescheduleSession e salvar o publicado) mantem o nome da sala e o gravador", async () => {
  const db = usar(bancoEmMemoria(cenario({ recorderStatus: "none" })));
  const nova = new Date(Date.now() + 3 * DAY).toISOString();
  const moved = ok(await actions.rescheduleSession({ scheduledAt: nova, sessionId: SESSAO, webinarId: WEBINAR }));

  assert.equal(moved.scheduledAt, nova);
  const [session] = db.tables.webinar_sessions;
  assert.equal(session.scheduled_at, nova);
  assert.equal(session.room_name, SALA, "o nome da sala continua o mesmo");
  assert.equal(session.recorder_status, "none");
  assert.equal(db.tables.webinars[0].scheduled_at, nova, "webinars.scheduled_at acompanha a sessao live");

  // Salvar o publicado com outra hora marcada: o mesmo (so a hora da sessao muda).
  const data = await queries.getWebinarEditorData(WEBINAR);
  const outra = new Date(Date.now() + 4 * DAY).toISOString();
  ok(await actions.saveWebinarDraft({ draft: { ...data.draft, scheduledAt: outra }, expectedUpdatedAt: data.updatedAt, id: WEBINAR }));
  assert.equal(db.tables.webinar_sessions[0].scheduled_at, outra);
  assert.equal(db.tables.webinar_sessions[0].room_name, SALA);
  assert.equal(db.tables.webinar_sessions.length, 1, "nenhuma sessao nova");
  assert.deepEqual(fetches, []);
});

/* ------------------------------------------------------------------------------------------------
 * O nome da sala nunca vai para a tela
 * ---------------------------------------------------------------------------------------------- */

const OPTIONS = {
  cohorts: [],
  currentUserId: HOST,
  currentUserName: "Produtor de Teste",
  names: { cohorts: {}, notices: {}, products: {}, segments: {} },
  notices: [],
  people: [{ avatarUrl: null, canPublish: true, canWrite: true, id: HOST, isMe: true, name: "Produtor de Teste", roleLabel: "Dono" }],
  peopleLoaded: true,
  products: [],
  productsLoaded: true,
  segments: []
};

function renderEditor(initial, extra = {}) {
  return html(createElement(WebinarEditor, { defaultKind: initial.draft.kind, initial, liveRoomReady: true, now: Date.now(), options: OPTIONS, permissions: both, ...extra }));
}

test("nenhum room_name nas leituras do admin nem na tela: getWebinarEditorData, listWebinarsForAdmin e o editor desenhado", async () => {
  usar(bancoEmMemoria(cenario({ recorderStatus: "preparing" })));
  const data = await queries.getWebinarEditorData(WEBINAR);

  assert.ok(data);
  assert.ok(!JSON.stringify(data).includes(SALA), "o nome da sala nao sai do servidor");
  assert.ok(data.sessions.length > 0 && data.sessions.every((session) => session.roomName === null), "as sessoes chegam sem o nome da sala");
  assert.deepEqual(Object.keys(data.liveSession).sort(), ["endedAt", "id", "recorderRequestedAt", "recorderStatus", "recordingAnchorAt", "recordingRequestedAt", "scheduledAt", "startedAt", "status"]);
  const sessao = (id, status, scheduledAt) => ({ ...data.sessions[0], id, scheduledAt, status });
  assert.equal(vm.webinarLiveSessionOf([sessao("velha", "cancelled", "2026-11-01T23:00:00.000Z"), sessao("nova", "scheduled", "2026-10-30T23:00:00.000Z")])?.id, "nova", "a que ainda vale vem antes da cancelada");
  assert.equal(vm.webinarLiveSessionOf([{ ...data.sessions[0], kind: "simulated" }]), null, "so a sessao live");
  assert.equal(data.liveSession.recorderStatus, "preparing");
  assert.equal(data.liveSession.id, SESSAO);
  assert.deepEqual([data.jit.enabled, data.jitSessionsToday], [false, []], "a Live ao vivo nao tem o Comeca quando voce entra");

  const now = Date.now();
  const list = await queries.listWebinarsForAdmin({ now, period: { end: new Date(now + 10 * DAY), start: new Date(now - DAY) } });
  assert.equal(list.items.length, 1);
  assert.ok(!JSON.stringify(list).includes(SALA));

  const markup = renderEditor(data);
  assert.ok(!markup.includes(SALA), "o editor desenhado nao mostra o nome da sala");
  assert.match(textOf(markup), /Situação do servidor de gravação: Preparando/, "o card Gravacao com o gravador da sessao");

  // Nenhum componente cliente do admin nem as paginas falam do nome da sala.
  for (const path of [
    "src/components/admin/v2/communication/webinars/webinar-editor.tsx",
    "src/components/admin/v2/communication/webinars/webinar-editor-cards.tsx",
    "src/components/admin/v2/communication/webinars/webinar-row-menu.tsx",
    "src/components/admin/v2/communication/webinars/webinars-table.tsx",
    "src/components/admin/v2/communication/webinars/webinars-list-view.tsx",
    "src/components/admin/v2/communication/webinars/webinar-preview.tsx",
    "src/components/admin/v2/communication/webinars/webinar-list-tabs.tsx",
    "src/app/admin/(v2)/comunicacao/webinarios/page.tsx",
    "src/app/admin/(v2)/comunicacao/webinarios/[id]/page.tsx",
    "src/app/admin/(v2)/comunicacao/webinarios/novo/page.tsx"
  ]) {
    assert.doesNotMatch(stripComments(read(path)), /roomName|room_name/, path);
  }

  // As paginas leem o ambiente no servidor e passam so o booleano.
  for (const path of ["src/app/admin/(v2)/comunicacao/webinarios/[id]/page.tsx", "src/app/admin/(v2)/comunicacao/webinarios/novo/page.tsx"]) {
    const source = stripComments(read(path));
    assert.match(source, /liveRoomReady=\{liveRoomConfigured\(process\.env\)\}/, path);
    assert.doesNotMatch(source, /WEBINAR_JWT_SECRET|WEBINAR_MEET_DOMAIN/, `${path}: nenhum segredo nem hostname nas props`);
  }
});

/* ------------------------------------------------------------------------------------------------
 * O editor e a lista desenhados
 * ---------------------------------------------------------------------------------------------- */

function editorData(extra = {}) {
  const draft = liveDraft();
  return {
    cancelReason: null,
    cancelledAt: null,
    createdAt: "2026-10-20T12:00:00.000Z",
    deciderNames: {},
    draft,
    id: ID,
    jit: model.defaultJitSettings(),
    jitSessionsToday: [],
    liveSession: { endedAt: null, id: SESSAO, recorderRequestedAt: null, recorderStatus: "ready", recordingAnchorAt: null, recordingRequestedAt: null, scheduledAt: draft.scheduledAt, startedAt: null, status: "scheduled" },
    polls: [],
    publishedAt: "2026-10-21T12:00:00.000Z",
    recordingId: null,
    registeredCount: 3,
    replaySession: null,
    runningSessionId: null,
    scriptItems: [],
    sessions: [],
    situation: "scheduled",
    slug: "live-de-teste",
    status: "published",
    title: "Live de teste",
    transcript: null,
    updatedAt: "2026-10-27T12:00:00.000Z",
    ...extra
  };
}

const headerOf = (markup) => markup.slice(0, markup.indexOf("</header>"));
const menuLabels = (markup) => Array.from(markup.matchAll(/role="menuitem"[^>]*>(.*?)<\/div>/g)).map((match) => textOf(match[1]));

test("editor (topo): a Live ao vivo agendada tem Abrir a sala para o console; em andamento, Abrir o console e Encerrar live para o console; sem messaging.publish, desligados com a explicacao", () => {
  const scheduled = renderEditor(editorData());
  const header = headerOf(scheduled);
  assert.ok(linkTo(header, 'data-header-action="open_room"', `${CONSOLE}`), "Abrir a sala e um link para o console");
  assert.doesNotMatch(textOf(header), /em breve/);
  assert.deepEqual(menuLabels(scheduled), ["Duplicar", "Cancelar"], "o menu ao lado sem Abrir a sala (ja e botao)");
  assert.match(textOf(scheduled), /Situação do servidor de gravação: Pronto/);
  assert.ok(linkTo(scheduled, 'data-card-link="upload"', `${CONSOLE}`));
  assert.doesNotMatch(textOf(scheduled), /ainda não está configurada/);

  const running = editorData({ liveSession: { ...editorData().liveSession, recorderStatus: "recording", startedAt: "2026-10-28T23:00:00.000Z", status: "live" }, runningSessionId: SESSAO, situation: "in_progress" });
  const live = renderEditor(running);
  const liveHeader = headerOf(live);
  assert.ok(linkTo(liveHeader, 'data-header-action="open_console"', `${CONSOLE}`));
  assert.ok(linkTo(liveHeader, 'data-header-action="end"', `${CONSOLE}`), "Encerrar live leva ao console (a acao mora la)");
  assert.deepEqual(menuLabels(live), ["Duplicar"], "o Encerrar nao se repete no menu");
  assert.doesNotMatch(live, /data-stub-dialog/, "nenhuma confirmacao aberta");

  const analyst = renderEditor(running, { permissions: writeOnly });
  const analystHeader = headerOf(analyst);
  assert.ok(linkTo(analystHeader, 'data-header-action="open_console"', `${CONSOLE}`), "a Equipe chega ao console");
  assert.ok(notLink(analystHeader, 'data-header-action="end"'), "Encerrar live nao e link para quem nao publica");
  assert.ok(
    tagsWith(analystHeader, 'data-header-action="end"').every((tag) => tag.startsWith("<button") && tag.includes('disabled=""') && tag.includes('aria-describedby="webinar-header-blocked"')),
    "Encerrar live desligado, apontando para a explicacao"
  );
  assert.match(analyst, /id="webinar-header-blocked"[^>]*>Só quem publica na Comunicação encerra a live\.</, "a explicacao embaixo do cabecalho");

  const analystScheduled = renderEditor(editorData(), { permissions: writeOnly });
  assert.ok(notLink(headerOf(analystScheduled), 'data-header-action="open_room"'));
  assert.ok(tagsWith(headerOf(analystScheduled), 'data-header-action="open_room"').every((tag) => tag.includes('disabled=""')), "Abrir a sala desligado");
  assert.match(textOf(analystScheduled), /Só quem publica na Comunicação abre a sala\./);

  const noRoom = textOf(renderEditor(editorData(), { liveRoomReady: false }));
  assert.match(noRoom, /A sala ao vivo ainda não está configurada neste ambiente\./, "o aviso discreto no card Gravacao");
});

test("editor (topo): a Live gravada em andamento segue como na fase 2: Abrir o console no topo e Encerrar live no menu com confirmacao", () => {
  const draft = { ...model.emptyWebinarDraft("simulated"), recordingVideoUrl: "https://iframe.mediadelivery.net/embed/1/abc", sessions: [{ lateJoinMinutes: null, scheduledAt: new Date(Date.now() + DAY).toISOString() }], title: "Gravada" };
  const markup = renderEditor(editorData({ draft, liveSession: null, runningSessionId: SESSAO, situation: "in_progress", title: "Gravada" }));
  const header = headerOf(markup);

  assert.ok(linkTo(header, 'data-header-action="open_console"', `${CONSOLE}`));
  assert.doesNotMatch(header, /data-header-action="end"/);
  assert.deepEqual(menuLabels(markup), ["Duplicar", "Encerrar live"]);
  assert.doesNotMatch(markup, /Situação do servidor de gravação/, "o card Gravacao e so da Live ao vivo");
});

function item(extra = {}) {
  return {
    coverUrl: null,
    createdAt: "2026-10-20T12:00:00.000Z",
    createdByName: "Equipe de teste",
    id: ID,
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

test("lista: a Live ao vivo em andamento mostra Abrir o console na linha; a agendada, Abrir a sala (so quem publica); o menu leva ao console; Presentes (pico) pela curva", () => {
  const RUNNING = "1c8f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b";
  const GRAVADA = "2d9f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b";
  const items = [
    item(),
    item({ id: RUNNING, peakPresent: 87, runningSessionId: SESSAO, situation: "in_progress", situationLabel: "Em andamento", situationTone: "warning", title: "No ar" }),
    item({ id: GRAVADA, kind: "simulated", kindLabel: "Live gravada", runningSessionId: SESSAO, situation: "in_progress", situationLabel: "Em andamento", situationTone: "warning", title: "Gravada" })
  ];
  const markup = html(createElement(WebinarsTable, { items, permissions: both }));

  assert.ok(linkTo(markup, 'data-row-shortcut="open_room"', `${CONSOLE}`));
  assert.ok(linkTo(markup, 'data-row-shortcut="open_console"', `/admin/comunicacao/webinarios/${RUNNING}/sala`));
  assert.ok(!tagsWith(markup, "data-row-shortcut=").some((tag) => tag.includes(GRAVADA)), "a Live gravada fica com o menu");
  assert.equal((markup.match(/data-row-shortcut=/g) ?? []).length, 2);
  assert.match(textOf(markup), /\b87\b/, "Presentes (pico)");

  const menus = markup.split('role="menu"').slice(1);
  assert.deepEqual(menuLabels(menus[0]), ["Abrir", "Abrir a sala", "Duplicar", "Cancelar"]);
  assert.deepEqual(menuLabels(menus[1]), ["Abrir", "Abrir o console", "Duplicar", "Encerrar live"]);
  assert.deepEqual(menuLabels(menus[2]), ["Abrir", "Abrir o console", "Duplicar", "Encerrar live"]);
  assert.doesNotMatch(markup, /em breve/);

  const analyst = html(createElement(WebinarsTable, { items, permissions: writeOnly }));
  assert.doesNotMatch(analyst, /data-row-shortcut="open_room"/, "quem nao publica nao tem o atalho da sala");
  assert.match(analyst, /data-row-shortcut="open_console"/);
  const analystMenus = analyst.split('role="menu"').slice(1);
  assert.deepEqual(menuLabels(analystMenus[0]), ["Abrir", "Abrir a sala · só quem publica", "Duplicar"]);
  assert.match(analystMenus[0], /aria-disabled="true"[^>]*>[\s\S]*?Abrir a sala · só quem publica/, "desligado, com o motivo");
  assert.deepEqual(menuLabels(analystMenus[1]), ["Abrir", "Abrir o console", "Duplicar", "Encerrar live · só quem publica"]);
  assert.deepEqual(menuLabels(analystMenus[2]), ["Abrir", "Abrir o console", "Duplicar"], "Live gravada como antes");

  // O pico: o maior das curvas congeladas, sem o replay; sem curva, "—".
  const curve = (n) => ({ avgPresent: 1, bucketSeconds: 60, buckets: [], durationMs: 1, frozenAt: null, peak: { b: 0, n }, reachedEnd: 0, unique: n, watchAvg: 0, watchMax: 0 });
  assert.equal(
    vm.webinarPeakPresent([
      { kind: "simulated", presenceCurve: curve(12) },
      { kind: "simulated", presenceCurve: curve(30) },
      { kind: "replay", presenceCurve: curve(99) },
      { kind: "simulated", presenceCurve: null }
    ]),
    30
  );
  assert.equal(vm.webinarPeakPresent([{ kind: "live", presenceCurve: null }]), null);
  assert.equal(vm.webinarPeakPresent([]), null);
});

test("frases novas do admin passam pela guarda do Webinario e nada diz 'em breve' sobre a sala ao vivo", () => {
  const texts = [
    ...Object.values(vm.WEBINAR_ADMIN_COPY.blocked),
    vm.WEBINAR_ADMIN_COPY.menu.onlyPublishers,
    vm.WEBINAR_ADMIN_COPY.fields.autoRecordHint,
    vm.WEBINAR_ADMIN_COPY.fields.autoRecordOffHint,
    vm.WEBINAR_ADMIN_COPY.fields.recordingAfterPublish,
    vm.WEBINAR_ADMIN_COPY.fields.recordingUploadHint,
    vm.WEBINAR_ADMIN_COPY.fields.qualityStageHint1080
  ];

  for (const text of texts) {
    for (const palavra of PROIBIDAS_WEBINARIO) {
      assert.ok(!text.toLocaleLowerCase("pt-BR").includes(palavra), `"${text}" usa "${palavra}"`);
    }
  }
  assert.ok(!("roomNameSoon" in vm.WEBINAR_ADMIN_COPY.fields), "a frase '(fase 3)' saiu");
  assert.ok(!("recordingSoon" in vm.WEBINAR_ADMIN_COPY.fields));
  assert.deepEqual([...vm.WEBINAR_SOON_ACTIONS], ["publish_replay"], "so o replay como aula segue 'em breve'");
});
