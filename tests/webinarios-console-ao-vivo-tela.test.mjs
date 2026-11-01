import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";

// O console da equipe na Live ao vivo desenhado (docs/30 §1.4, §2.4, §2.9, §6.3, §6.4 e §6.7; docs/18 §1.1): o topo
// com Abrir a sala / Comecar para todos / Encerrar live (desligados com a explicacao sem messaging.publish), o palco
// com a sala no meio (o iframe pelo useJitsiMeet, o token pelo join-token, o nonce da pagina) ou "A sala ao vivo ainda
// nao esta configurada", os botoes nossos ao redor (Silenciar todos, Fechar todas as cameras, Permitir cameras, Trancar,
// Sala de espera, o microfone do aluno desligado e fixo), Mao levantada, Participantes com os barrados e Desfazer, o
// cartao Gravacao (Preparar, a reserva, a fila, Gravando, a ancora), Alinhar chat com a previa, Enviar gravacao e o ⋯
// do autor no chat. Nas fontes: os comandos do IFrame API ligados aos botoes (muteEveryone, toggleLobby, kickParticipant,
// askToUnmute, startRecording...), a ancora no recordingStatusChanged, as frases so de WEBINAR_COPY (ou das provisorias
// de live-console-model.ts) e nenhum "Jitsi" em texto de tela. O palco do console V2 (docs/31 V2-4 e V2-13): o
// "Ao vivo", o Gravando e os presentes com o pico dentro do palco, o topo da live sem eles. A barra de quem apresenta
// (docs/31 V2-14): a Sala de espera, Microfone, Câmera, Compartilhar tela e Gravar com o estado em aria-pressed, o
// "Palco para todos ▾", Configurações e o balao do painel; as Configurações (o painel da sala) so para o Apresentador e
// o co-apresentador, logo depois do botao, com Microfone, Alto-falante e Câmera, Reduzir ruído, Espelhar, Desfocar o
// fundo e Mais opções de fundo, sem Qualidade do vídeo nem volume, e nas fontes a troca so com a secao pronta e o
// dialogo de fundo pelo toggleVirtualBackgroundDialog.

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto.supabase.co";

const root = new URL("../", import.meta.url);
const srcUrl = new URL("src/", root).href;
const require = createRequire(new URL("package.json", root));
const ts = require("typescript");

const pass = `function pass(props) { const out = {}; for (const [key, value] of Object.entries(props)) { if (key.startsWith("data-") || key.startsWith("aria-") || key === "id" || key === "role") out[key] = value; } return out; }`;
const fail = `const fail = async () => ({ error: "Falhou.", ok: false, status: 500 });`;

const STUBS = {
  // O palco do console usa os selos da sala (room-stage-badges.tsx), que importam o cabecalho da sala (com a capa).
  "next/image": `import { createElement } from "react";
export default function Image({ fill, priority, sizes, unoptimized, style, ...props }) { return createElement("img", { ...props, "data-next-image": "", style }); }`,
  "next/navigation": `export function useRouter() { return { back() {}, push() {}, refresh() {}, replace() {} }; }
export function usePathname() { return "/admin/comunicacao/webinarios"; }
export function useSearchParams() { return new URLSearchParams(); }
export function redirect(href) { throw new Error("redirect " + href); }
export function notFound() { throw new Error("notFound"); }`,
  "next/link": `import { createElement } from "react";
export default function Link({ prefetch, scroll, ...props }) { return createElement("a", props); }`,
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
export function DropdownMenuTrigger({ children, className, onClick, render, ...props }) { return createElement("button", { "aria-haspopup": "menu", type: "button", ...pass(props) }, children); }
export function DropdownMenuContent({ children }) { return createElement("div", { role: "menu" }, children); }
export function DropdownMenuGroup({ children }) { return createElement("div", { role: "group" }, children); }
export function DropdownMenuLabel({ children }) { return createElement("div", { "data-menu-label": "" }, children); }
export function DropdownMenuSeparator() { return createElement("hr", { "data-menu-separator": "" }); }
export function DropdownMenuRadioGroup({ children, value, ...props }) { return createElement("div", { "data-menu-value": value, role: "group", ...pass(props) }, children); }
export function DropdownMenuRadioItem({ children, closeOnClick, value, ...props }) { return createElement("div", { "data-menu-item": "", "data-value": value, role: "menuitemradio", ...pass(props) }, children); }
export function DropdownMenuItem({ children, disabled }) { return createElement("div", { "aria-disabled": disabled || undefined, "data-menu-item": "", role: "menuitem" }, children); }`,
  "@/server/webinars/live-actions": `${fail}
export const openLiveRoom = fail; export const startLiveSession = fail; export const endLiveSession = fail; export const setRoomLock = fail; export const prepareRecorder = fail; export const releaseRecorder = fail; export const requestRecording = fail; export const markRecordingAnchor = fail; export const muteInChat = fail; export const kickFromSession = fail; export const undoSessionBan = fail; export const banStudent = fail; export const unbanStudent = fail; export const attachRecording = fail; export const alignChat = fail; export const setBrowserRecording = fail;`,
  "@/server/webinars/script-actions": `${fail}
export const saveScriptItems = fail; export const importScriptCsv = fail; export const exportScriptCsv = fail; export const exportSessionChatCsv = fail; export const saveTranscript = fail; export const resolveScriptPhrases = fail; export const fireScriptItem = fail;`,
  // Fase 4: os paineis Oferta (4b) e Atendimento (4c) leem pela propria Server Action; aqui viram falhas.
  "@/server/webinars/offer-actions": `${fail}
export const loadOfferEditor = fail; export const saveOffer = fail; export const archiveOffer = fail; export const loadOfferConsole = fail; export const showOfferNow = fail; export const hideOffer = fail;`,
  "@/server/webinars/assistant-actions": `${fail}
export const loadAssistantEditor = fail; export const saveAssistant = fail; export const loadAttendanceSnapshot = fail; export const setReplyAll = fail; export const pingAttendant = fail; export const assign = fail; export const editAssistantAnswer = fail;`,
  // Fase 4f: "Refazer tradução" no chat do console.
  "@/server/webinars/translation-actions": `${fail}
export const clearMessageTranslations = fail;`,
  "@/server/webinars/room-actions": `${fail}
export const openSessionNow = fail; export const endSessionNow = fail; export const sendTeamMessage = fail; export const moderateMessage = fail; export const setSessionChatMode = fail; export const savePolls = fail; export const launchPoll = fail; export const closePoll = fail; export const answerQuestion = fail; export const setQuestionStatus = fail; export const saveSimulation = fail; export const createReplaySession = fail; export const cancelReplaySession = fail; export const removeStudentMessages = fail;`
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
const { SessionConsole } = await import("../src/components/admin/v2/communication/webinars/session-console/session-console.tsx");
const { PROIBIDAS_WEBINARIO, WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const { LIVE_CONSOLE_COPY } = await import("../src/server/webinars/live-console-model.ts");
const { ConsoleBar } = await import("../src/components/admin/v2/communication/webinars/session-console/console-bar.tsx");
const { ConsolePanel } = await import("../src/components/admin/v2/communication/webinars/session-console/console-panel.tsx");
const { ConsolePeopleTab } = await import("../src/components/admin/v2/communication/webinars/session-console/console-people-tab.tsx");
const { CONSOLE_PANEL_ID, CONSOLE_SETTINGS_ID } = await import("../src/components/admin/v2/communication/webinars/session-console/console-layout-model.ts");
const liveModel = await import("../src/server/webinars/live-console-model.ts");
const { deviceOptions, deviceSettingsFor } = await import("../src/lib/jitsi-device-settings.ts");

const copy = WEBINAR_COPY.consoleAoVivo;
const consoleV2Copy = WEBINAR_COPY.consoleV2;
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
const count = (markup, pattern) => (markup.match(pattern) ?? []).length;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** O pedaco do painel de uma aba (`tab`) ou de uma entrada do ⋯ (`more`): da tag dela ate a seguinte. */
const pane = (markup, kind, name) => {
  const at = markup.indexOf(`data-console-${kind}="${name}"`);
  assert.ok(at >= 0, `o painel tem ${kind} ${name}`);
  const next = markup.slice(at + 1).search(/data-console-(?:tab|more)="/);
  const end = next < 0 ? markup.indexOf("</aside>", at) : markup.lastIndexOf("<", at + 1 + next);
  return markup.slice(markup.lastIndexOf("<", at), end);
};
const hiddenPane = (block) => /^<[^>]*\shidden=""/.test(block);

const NOW = Date.parse("2026-11-05T23:05:00.000Z");
const MIN = 60_000;
const HOST = "u-host";
const WEBINAR = "aaaaaaaa-1111-4111-8111-111111111111";
const S_LIVE = "bbbbbbbb-2222-4222-8222-111111111111";
const ANA = "cccccccc-3333-4333-8333-333333333333";
const BIA = "dddddddd-4444-4444-8444-444444444444";
const NO_BAN = { banned: false, kicked: false, muted: false, mutedUntil: null };

function session(extra = {}) {
  return {
    chatMode: "open",
    chatSlowModeSeconds: null,
    createdAt: "2026-10-28T12:00:00.000Z",
    endedAt: null,
    id: S_LIVE,
    kind: "live",
    lateJoinMinutes: null,
    pinnedMessageId: null,
    presenceCurve: null,
    recorderAlertedAt: null,
    recorderReleaseRequestedAt: null,
    recorderRequestedAt: null,
    recorderStatus: "none",
    recordingAnchorAt: null,
    recordingId: null,
    recordingRequestedAt: null,
    roomLocked: false,
    roomName: null,
    scheduledAt: new Date(NOW - 5 * MIN).toISOString(),
    scriptFiredAt: null,
    showLiveBadge: false,
    simulationAckText: null,
    simulationDecidedAt: null,
    simulationDecidedBy: null,
    sourceSessionId: null,
    startedAt: new Date(NOW - 5 * MIN).toISOString(),
    status: "live",
    updatedAt: "2026-10-28T12:00:00.000Z",
    webinarId: WEBINAR,
    ...extra
  };
}

function recorder(extra = {}) {
  return { anchorAt: null, dispatchConfigured: true, driftMs: null, estimateMinutes: null, fileStartedAt: null, recordingRequestedAt: null, releaseRequestedAt: null, requestedAt: null, status: "none", ...extra };
}

function liveBlock(extra = {}) {
  return {
    meetConfigured: true,
    people: [
      { ban: { banned: true, kicked: true, muted: true, mutedUntil: "2026-11-05T23:20:00.000Z" }, displayName: "Bia R.", joinedAt: null, participantId: null, staff: false, userId: BIA },
      { ban: NO_BAN, displayName: "Ana M.", joinedAt: new Date(NOW - MIN).toISOString(), participantId: "p-ana", staff: false, userId: ANA }
    ],
    recorder: recorder(),
    recording: null,
    roomLocked: false,
    ...extra
  };
}

const message = (extra = {}) => ({ approved: true, authorUserId: ANA, body: "Boa noite!", createdAt: new Date(NOW - 4 * MIN).toISOString(), displayName: "Ana M.", id: "m-ana", kind: "message", master: false, offsetMs: 60_000, pinnedAt: null, promotable: true, replyToId: null, role: "student", scriptItemId: null, sessionId: S_LIVE, source: "audience", webinarId: WEBINAR, ...extra });

function snapshot(extra = {}) {
  return {
    askedMessageIds: [],
    live: liveBlock(),
    messages: [message(), message({ authorUserId: HOST, body: "Bem-vindos", displayName: "Produtor T.", id: "m-equipe", role: "host", source: "team" })],
    pinnedMessageId: null,
    polls: { launched: [], templates: [] },
    presentNow: 3,
    questions: [],
    scriptFired: {},
    scriptItems: [],
    serverTime: new Date(NOW).toISOString(),
    session: session(),
    ...extra
  };
}

const webinar = { allowStudentCamera: false, durationMinutes: 60, hostUserId: HOST, id: WEBINAR, kind: "live", practiceSession: true, recordingDurationSeconds: null, slug: "aula-ao-vivo", title: "Aula ao vivo", waitingRoom: false };
const both = { canPublish: true, canWrite: true };

function render(snap, { currentUserId = HOST, permissions = both } = {}) {
  return html(createElement(SessionConsole, { currentUserId, data: { sessions: [snap.session], snapshot: snap, webinar }, nonce: "nonce-de-teste", permissions, serverNow: NOW }));
}

/** Os .tsx do console, achados pela pasta (uma peca nova entra sozinha, uma apagada sai sozinha). */
const CONSOLE_DIR = "src/components/admin/v2/communication/webinars/session-console";
const CONSOLE_FILES = readdirSync(new URL(`${CONSOLE_DIR}/`, root))
  .filter((name) => name.endsWith(".tsx"))
  .sort()
  .map((name) => `${CONSOLE_DIR}/${name}`);
const consoleFile = (name) => {
  const path = `${CONSOLE_DIR}/${name}`;
  assert.ok(CONSOLE_FILES.includes(path), `arquivo esperado: ${path}`);
  return path;
};
/** As pecas da sala ao vivo no console (live-*.tsx): as frases delas sao de WEBINAR_COPY. */
const LIVE_FILES = CONSOLE_FILES.filter((path) => /\/live-[^/]+\.tsx$/.test(path));

test("topo da Live ao vivo: Começar para todos e Encerrar live na espera, Abrir a sala na agendada, Encerrar live no ar; sem messaging.publish desligados com a explicacao", () => {
  const espera = textOf(render(snapshot({ session: session({ startedAt: null, status: "waiting" }) })));
  assert.match(espera, new RegExp(escape(copy.comecarParaTodos)));
  assert.match(espera, new RegExp(escape(copy.encerrarLive)));
  assert.doesNotMatch(espera, /Abrir sessão|Encerrar sessão/, "os botoes da gravada nao aparecem na live");

  const agendada = textOf(render(snapshot({ session: session({ startedAt: null, status: "scheduled" }) })));
  assert.match(agendada, new RegExp(escape(copy.abrirSala)));
  assert.match(agendada, new RegExp(escape(copy.comecarParaTodos)));
  assert.doesNotMatch(agendada, new RegExp(escape(copy.encerrarLive)));
  assert.match(agendada, new RegExp(escape(copy.testarSala)), "a Sessão de prática pode ser testada antes");
  assert.match(agendada, new RegExp(escape(copy.abrirSalaTexto)));

  const noAr = render(snapshot());
  assert.match(textOf(noAr), new RegExp(escape(copy.encerrarLive)));
  assert.doesNotMatch(textOf(noAr), new RegExp(escape(copy.comecarParaTodos)));

  const semPublicar = render(snapshot(), { permissions: { canPublish: false, canWrite: true } });
  assert.match(textOf(semPublicar), new RegExp(escape(LIVE_CONSOLE_COPY.soQuemPublica)));
  const encerrar = semPublicar.slice(semPublicar.lastIndexOf("<button", semPublicar.indexOf(copy.encerrarLive)), semPublicar.indexOf(copy.encerrarLive));
  assert.match(encerrar, /disabled=""/, "Encerrar live desligado sem messaging.publish");
});

test("console V2 em tela cheia (docs/31 V2-13): a raiz com o tema, o topo com Trancar a sala (aria-pressed) ao lado de Encerrar live, e o palco na coluna do palco, com a barra de quem apresenta embaixo e os controles e os cards no painel", () => {
  const markup = render(snapshot());
  assert.match(markup, /^<div(?=[^>]*data-console-root="")(?=[^>]*data-room-theme="dark")[^>]*>/);
  const top = markup.slice(markup.indexOf('data-console-slot="top"'), markup.indexOf("</header>"));
  assert.ok(top.length > 0, "o topo");
  // Os botoes de situacao no topo, na ordem: no ar, Trancar a sala e Encerrar live; o Trancar diz o estado.
  const nomes = Array.from(top.matchAll(/<button[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]+)<\/button>/g)).map((match) => match[1]);
  assert.deepEqual(nomes, [copy.trancar, copy.encerrarLive]);
  assert.match(top, new RegExp(`<button(?=[^>]*aria-pressed="false")[^>]*>(?:<svg[\\s\\S]*?</svg>)?${escape(copy.trancar)}</button>`));
  const trancada = render(snapshot({ live: liveBlock({ roomLocked: true }) }));
  const topoTrancado = trancada.slice(trancada.indexOf('data-console-slot="top"'), trancada.indexOf("</header>"));
  assert.match(topoTrancado, new RegExp(`<button(?=[^>]*aria-pressed="true")[^>]*>(?:<svg[\\s\\S]*?</svg>)?${escape(copy.destrancar)}</button>`));
  // A Equipe nao tranca a sala (so quem apresenta).
  assert.doesNotMatch(textOf(render(snapshot(), { currentUserId: "u-equipe" })), new RegExp(escape(copy.trancar)));
  // A agendada mostra Abrir a sala, Começar para todos e Trancar (a Sessão de prática tranca antes de abrir).
  const agendada = render(snapshot({ session: session({ startedAt: null, status: "scheduled" }) }));
  const topoAgendado = agendada.slice(agendada.indexOf('data-console-slot="top"'), agendada.indexOf("</header>"));
  assert.deepEqual(Array.from(topoAgendado.matchAll(/<button[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]+)<\/button>/g)).map((match) => match[1]), [copy.abrirSala, copy.comecarParaTodos, copy.trancar]);

  // O iframe no palco, dentro da coluna do palco; a barra de quem apresenta embaixo (o <nav> com o nome dela); os
  // controles de todos (na aba Pessoas) e os cards no painel com abas.
  const coluna = markup.indexOf('data-console-slot="stage-column"');
  const palco = markup.indexOf('data-console-slot="stage"');
  const iframe = markup.indexOf('data-live-stage=""');
  const barra = markup.indexOf('data-console-slot="bar"');
  const nav = markup.indexOf(`<nav aria-label="${WEBINAR_COPY.consoleV2.barra.rotulo}"`);
  const painel = markup.indexOf('data-console-slot="panel"');
  const controles = markup.indexOf("data-live-controls");
  assert.ok(coluna >= 0 && coluna < palco && palco < iframe && iframe < barra && barra < nav && nav < painel && painel < controles, "coluna > palco > iframe, a barra, depois o painel com os controles");
  assert.equal(count(markup, /data-live-stage=""/g), 1, "um palco so");
  assert.equal(count(markup, /<nav aria-label="Controles de quem apresenta"/g), 1, "uma barra so");
  assert.match(markup, /<aside[^>]*data-console-slot="panel"[^>]*id="console-panel"/);
  for (const marca of ["data-console-chat", "data-live-hands", "data-live-recorder"]) {
    assert.ok(markup.indexOf(marca) > painel, `${marca} no painel`);
  }
  // Sem palco (a gravada), sem barra.
  const gravada = html(createElement(SessionConsole, { currentUserId: HOST, data: { sessions: [session({ kind: "simulated" })], snapshot: snapshot({ live: null, session: session({ kind: "simulated" }) }), webinar: { ...webinar, kind: "simulated" } }, permissions: both, serverNow: NOW }));
  assert.doesNotMatch(gravada, /data-console-bar|<nav aria-label="Controles de quem apresenta"/);
});

test("palco do console (docs/31 V2-4 e V2-13): Ao vivo e Gravando em cima a esquerda e os presentes com o pico em cima a direita, dentro do palco e na linha dos da esquerda; o topo da live sem o momento e com os presentes so abaixo de sm; os chips do card de antes saem", async () => {
  const { consolePresenceOf } = await import("../src/server/webinars/console-presence-model.ts");
  const view = {
    chat: { hot: [], perMinute: [], students: 0, top: [], total: 0 },
    presence: { avgPresent: 2, curve: [{ b: 1, n: 2 }, { b: 3, n: 5 }], drops: [], peak: { b: 3, n: 5 }, reachedEnd: 0, unique: 5, watchAvgSeconds: 0, watchMaxSeconds: 0 }
  };
  const presence = consolePresenceOf(view, 4 * MIN);
  const markup = render(snapshot({ live: liveBlock({ recorder: recorder({ status: "recording" }) }), presence }));
  const stage = markup.slice(markup.indexOf('data-console-slot="stage"'), markup.indexOf('data-console-slot="bar"'));
  // "Ao vivo · 00:05:00": o inicio de verdade 5 min antes, pelo relogio do servidor.
  assert.match(stage, /data-testid="room-on-air"[^>]*title="Ao vivo · 00:05:00"/);
  assert.match(stage, /data-testid="live-recording"/, "o gravador gravando: o selo no palco");
  // Os presentes do retrato de 5 s (3) e o pico do relatorio em cache (5), em cima a direita, antes da coluna de
  // miniaturas, a partir de sm, na mesma linha e na mesma distancia da borda dos selos da esquerda.
  const classesOf = (marca) => (stage.match(new RegExp(`<div class="([^"]*)" ${marca}>`)) ?? [])[1]?.split(" ") ?? [];
  const direita = classesOf('data-room-badges="top-right"');
  const esquerda = classesOf('data-room-badges="top"');
  assert.ok(direita.includes("hidden") && direita.includes("sm:flex"), "a partir de sm");
  for (const [lado, base] of [["right-[calc(var(--room-video-right)+8px)]", "left-2"], ["lg:right-[calc(var(--room-video-right)+16px)]", "lg:left-4"]]) {
    assert.ok(direita.includes(lado) && esquerda.includes(base), `${lado} como ${base}`);
  }
  for (const topo of ["top-2", "lg:top-4"]) {
    assert.ok(direita.includes(topo) && esquerda.includes(topo), `os dois cantos com ${topo}`);
  }
  const presentes = (palco) => textOf(palco.slice(palco.indexOf(">", palco.indexOf('data-room-badge="present"')) + 1, palco.indexOf("</span>", palco.indexOf('data-room-badge="present"'))));
  assert.match(stage, /data-room-badges="top-right"><span[^>]*data-room-badge="present"/);
  assert.equal(presentes(stage), "3 presentes · pico 5");
  // Antes de entrar no iframe nenhuma coluna na tela: os selos vao ate a borda.
  assert.match(markup, /data-console-slot="stage"[^>]*style="--room-video-right:0px"/);
  // Sem o motor dizendo quem esta no video grande, nenhum selo de baixo (nunca um nome por palpite).
  assert.doesNotMatch(stage, /data-room-badge="presenter"/);

  // O topo da live fica sem o momento (esta no palco) e com os presentes so abaixo de sm, onde o palco nao mostra o selo
  // deles (no celular ele cairia sobre o selo do momento).
  const top = markup.slice(markup.indexOf('data-console-slot="top"'), markup.indexOf("</header>"));
  assert.doesNotMatch(top, /data-console-clock/);
  assert.match(top, /<span class="[^"]*\bsm:hidden\b[^"]*" data-console-status=""><span class="[^"]*\bsm:hidden\b[^"]*"><span class="truncate"><span class="tabular-nums" data-console-present="">3 presentes · pico 5<\/span>/);
  // Os chips do card de antes (Gravando, Sala trancada, "{n} pessoas na sala") saem; o "Gravando" e so o do palco.
  assert.doesNotMatch(markup, /data-live-room-status/);
  assert.equal(count(markup, /data-testid="live-recording"/g), 1);
  for (const pessoas of [1, 2, 3]) {
    assert.ok(!textOf(markup).includes(LIVE_CONSOLE_COPY.naSala(pessoas)), `sem "${LIVE_CONSOLE_COPY.naSala(pessoas)}"`);
  }

  // Sem o pico (antes da leitura da presenca), so os presentes; fora do ar, a frase do momento no lugar do "Ao vivo".
  const agendada = render(snapshot({ session: session({ scheduledAt: new Date(NOW + 10 * MIN).toISOString(), startedAt: null, status: "scheduled" }) }));
  const palcoAgendado = agendada.slice(agendada.indexOf('data-console-slot="stage"'), agendada.indexOf('data-console-slot="bar"'));
  assert.doesNotMatch(palcoAgendado, /room-on-air|live-recording/);
  assert.match(palcoAgendado, /data-room-badge="moment">Começa em 10:00</);
  // As capas nos botoes da sala (nos tokens do tema), com o anel de foco branco sobre o palco preto nos dois temas: a
  // regra de foco do admin le --focus-ring, e o anel do tema claro (quase preto) sumiria sobre o video.
  assert.match(palcoAgendado, /<div class="[^"]*\[--focus-ring:white\][^"]*" data-live-stage-message="">/);
  const testar = palcoAgendado.slice(palcoAgendado.lastIndexOf("<button", palcoAgendado.indexOf(copy.testarSala)), palcoAgendado.indexOf(copy.testarSala));
  assert.match(testar, /bg-room-control/, "Testar sala no botao da sala");
  assert.doesNotMatch(testar, /data-slot="button"/, "nao o botao do admin");
  assert.equal(presentes(palcoAgendado), "3 presentes");
});

test("palco: a sala abrindo no meio, o Trancar no topo e as acoes de todos na aba Pessoas (Câmeras livres em aria-pressed); sem a sala no ambiente, a frase e o resto do console funciona", () => {
  const markup = render(snapshot());
  const text = textOf(markup);
  assert.match(markup, /data-live-stage=""/);
  assert.match(text, /Abrindo a sala…/);
  assert.match(text, new RegExp(escape(copy.trancar)), "o Trancar no topo");
  // As acoes de todos e a Sala de espera ficam na aba Pessoas (docs/31 V2-14), montada e escondida ate a pessoa abri-la.
  const pessoas = pane(markup, "tab", "pessoas");
  assert.ok(hiddenPane(pessoas), "a aba Pessoas escondida, com o Chat na tela");
  for (const label of [copy.silenciarTodos, copy.fecharCameras, consoleV2Copy.pessoas.cameras, copy.salaDeEspera, copy.ninguemEsperando, LIVE_CONSOLE_COPY.microfoneSozinho]) {
    assert.match(textOf(pessoas), new RegExp(escape(label)), label);
  }
  // O nome de antes (a frase saiu de WEBINAR_COPY.consoleAoVivo), escrito aqui para conferir que nao volta.
  assert.ok(!text.includes("Permitir câmeras dos alunos"), "o nome de antes saiu: Câmeras livres (V2-14)");
  assert.match(pessoas, /<input(?=[^>]*type="checkbox")(?=[^>]*disabled="")(?![^>]*checked="")[^>]*>/, "o microfone do aluno fica desligado e fixo");
  assert.match(pessoas, /aria-pressed="false"[^>]*>(?:(?!<\/button>).)*Câmeras livres/s, "o webinário sem câmera de aluno começa com as câmeras bloqueadas");

  const semSala = textOf(render(snapshot({ live: liveBlock({ meetConfigured: false }) })));
  assert.match(semSala, new RegExp(escape(copy.salaEmBreve)));
  assert.match(semSala, /Chat/, "o chat continua");
  assert.match(semSala, /Boa noite!/);

  const trancada = textOf(render(snapshot({ live: liveBlock({ roomLocked: true }) })));
  assert.match(trancada, new RegExp(escape(copy.destrancar)));
  assert.match(trancada, new RegExp(escape(copy.salaTrancada)));
});

test("Mãos e Pessoas (docs/31 V2-15): as abas com o numero (Mãos 0), vazias, os barrados com Desfazer e Desfazer banimento, o rodape; o ⋯ do autor no chat com Silenciar 5/15/60/até o fim, Remover da sala e Banir", () => {
  const markup = render(snapshot());
  const tabs = Array.from(markup.matchAll(/role="tab"[^>]*>([^<]+)</g)).map((match) => match[1]);
  assert.deepEqual(tabs, ["Chat", "Perguntas 0", "Mãos 0", "Pessoas"], "as abas da live, com as perguntas abertas e as maos no nome");
  // O titulo de antes (a frase saiu de WEBINAR_COPY.consoleAoVivo), escrito aqui para conferir que nao volta.
  assert.ok(!textOf(markup).includes("Mão levantada (0)"), "o titulo de antes saiu: o numero fica na aba");
  const maos = pane(markup, "tab", "maos");
  assert.ok(hiddenPane(maos), "a aba Mãos escondida");
  assert.match(textOf(maos), new RegExp(escape(copy.nenhumaMao)));
  assert.match(maos, /data-live-hands=""/);
  const pessoas = pane(markup, "tab", "pessoas");
  assert.match(textOf(pessoas), new RegExp(escape(consoleV2Copy.pessoas.naSala(0))));
  assert.match(textOf(pessoas), new RegExp(escape(copy.semParticipantes)));
  assert.match(textOf(pessoas), new RegExp(escape(LIVE_CONSOLE_COPY.removidosESilenciados)));
  assert.match(textOf(pessoas), new RegExp(`${escape(consoleV2Copy.pessoas.rodape(0, 0))}$`), "o rodape no fim da aba");
  const barred = markup.slice(markup.indexOf(`data-live-barred-user="${BIA}"`));
  assert.match(textOf(barred), /Desfazer: Sem escrever até 20:20/);
  assert.match(textOf(barred), /Desfazer: Removido da sala/);
  assert.match(textOf(barred), new RegExp(escape(copy.desfazerBanimento)));

  // O ⋯ de cada mensagem da turma (docs/31 V2-15) traz os itens da pessoa, sem os da sala (a mensagem nao diz o participante).
  const chatItem = (html, id) => html.slice(html.lastIndexOf("<li", html.indexOf(`data-room-message="${id}"`)), html.indexOf("</li>", html.indexOf(`data-room-message="${id}"`)));
  const chat = chatItem(markup, "m-ana");
  assert.match(chat, new RegExp(`aria-label="${escape(consoleV2Copy.chat.maisAcoes("Ana M."))}"`));
  for (const label of ["Silenciar 5 min", "Silenciar 15 min", "Silenciar 60 min", "Silenciar até o fim", copy.removerDaSala, copy.banir]) {
    assert.match(textOf(chat), new RegExp(escape(label)), label);
  }
  assert.doesNotMatch(textOf(chat), new RegExp(`${escape(copy.destacar)}|${escape(copy.convidarPalco)}|${escape(copy.fecharCamera)}`), "sem os itens da sala");
  const equipe = chatItem(markup, "m-equipe");
  assert.doesNotMatch(equipe, /Mais ações/, "a equipe nao tem o ⋯ de moderacao");

  const semPublicar = render(snapshot(), { permissions: { canPublish: false, canWrite: true } });
  const banir = chatItem(semPublicar, "m-ana");
  assert.match(banir, /<div aria-disabled="true" data-menu-item="" role="menuitem">Banir<\/div>/, "Banir so com messaging.publish");
});

test("cartão Gravação no ⋯ › Gravação (docs/31 V2-15): Preparar e a reserva sem o pedido automático; a fila com a estimativa; Gravando, com o Parar no circulo da barra; a âncora com os segundos e a diferença do arquivo; só o Apresentador grava; Gravar e Parar so na barra", () => {
  const gravacao = (markup) => pane(markup, "more", "gravacao");
  const reservaHtml = render(snapshot({ live: liveBlock({ recorder: recorder({ dispatchConfigured: false }) }) }));
  const reservaCard = gravacao(reservaHtml);
  assert.match(reservaCard, /^<section aria-label="Gravação"[^>]*hidden=""/, "a entrada Gravação montada e escondida, com o nome dela");
  const reserva = textOf(reservaCard);
  assert.match(reserva, new RegExp(escape(LIVE_CONSOLE_COPY.gravacao)));
  assert.match(reserva, new RegExp(escape(copy.prepararGravacao)));
  assert.match(reserva, new RegExp(escape(copy.disparoAusente)));
  assert.match(reserva, new RegExp(escape(copy.gravarNoNavegador)));
  assert.match(reserva, new RegExp(escape(copy.enviarGravacao)));
  // O circulo Gravar da barra, com o gravador por preparar, abre o ⋯ › Gravação (o painel), com o porque no title.
  const circulo = (markup) => markup.match(/<button(?=[^>]*data-room-bar-item="record")[^>]*>/)?.[0] ?? "";
  assert.match(circulo(reservaHtml), /aria-controls="console-panel"/);
  // Ele abre um painel, nao liga nem desliga nada: sem aria-pressed (como Mãos e Lançar enquete).
  assert.doesNotMatch(circulo(reservaHtml), /aria-pressed/);
  assert.match(circulo(reservaHtml), new RegExp(`title="${escape(copy.disparoAusente)}"`));
  assert.doesNotMatch(circulo(reservaHtml), /disabled=""/);

  const fila = textOf(gravacao(render(snapshot({ live: liveBlock({ recorder: recorder({ estimateMinutes: 4, recordingRequestedAt: new Date(NOW).toISOString(), requestedAt: new Date(NOW - 3 * MIN).toISOString(), status: "preparing" }) }) }))));
  assert.match(fila, /Preparando a gravação, 4 min/);
  assert.match(fila, new RegExp(escape(copy.gravarNaFila)));
  assert.match(fila, /Máquina ligada há 3 min/);

  const gravando = render(snapshot({ live: liveBlock({ recorder: recorder({ anchorAt: "2026-11-05T23:03:15.000Z", driftMs: 4_000, requestedAt: new Date(NOW - 40 * MIN).toISOString(), status: "recording" }) }) }));
  const cardGravando = gravacao(gravando);
  assert.match(textOf(cardGravando), /A gravação começou às 20:03:15/);
  assert.match(textOf(cardGravando), /O arquivo começou 4 s depois do clique/);
  // O Parar e o do circulo da barra (ligado, com o title); o cartao nao tem Gravar nem Parar.
  assert.match(circulo(gravando), /aria-pressed="true"/);
  assert.match(circulo(gravando), new RegExp(`title="${escape(copy.pararGravacao)}"`));
  for (const label of [copy.gravar, copy.pararGravacao]) {
    assert.doesNotMatch(cardGravando, new RegExp(`>${escape(label)}</button>`), `sem ${label} no cartao`);
  }
  // O "Gravando" do selo do palco, fora do cartao (o cartao tambem diz).
  const foraDoCard = gravando.replace(cardGravando, "");
  assert.ok(count(textOf(foraDoCard), /Gravando/g) >= 1, "o selo no palco");
  assert.ok(count(textOf(cardGravando), /Gravando/g) >= 1, "e a situacao no cartao");

  const pronta = render(snapshot({ live: liveBlock({ recorder: recorder({ status: "ready" }) }) }));
  assert.match(textOf(gravacao(pronta)), new RegExp(escape(copy.gravacaoPronta)));
  assert.match(circulo(pronta), /disabled=""/, "Gravar so liga com o console dentro da sala");
  assert.doesNotMatch(circulo(pronta), /aria-controls/, "com o gravador pronto, o circulo grava (nao abre o painel)");
  assert.match(circulo(pronta), /aria-pressed="false"/, "e diz que nao esta gravando");

  const equipeHtml = render(snapshot({ live: liveBlock({ recorder: recorder({ status: "ready" }) }) }), { currentUserId: "u-equipe" });
  const equipe = textOf(equipeHtml);
  assert.equal(circulo(equipeHtml), "", "a Equipe nao grava");
  assert.match(textOf(gravacao(equipeHtml)), new RegExp(escape(LIVE_CONSOLE_COPY.soOApresentador)));
  assert.doesNotMatch(equipe, new RegExp(escape(copy.fecharCameras)), "a Equipe nao fecha cameras");
});

test("Alinhar chat com prévia (± segundos, a mensagem e o player no ponto) e Enviar gravação depois do fim, dentro do ⋯ › Gravação (docs/31 V2-15)", () => {
  const recording = { anchorOffsetMs: 2_000, bunnyLibraryId: "42", bunnyVideoId: "abc12345", durationSeconds: 3600, embedUrl: "https://iframe.mediadelivery.net/embed/42/abc12345", errorMessage: null, id: "r-1", previewUrl: "https://iframe.mediadelivery.net/embed/42/abc12345?token=t&expires=9", source: "jibri", status: "ready" };
  const markup = render(snapshot({ live: liveBlock({ recording }), session: session({ endedAt: new Date(NOW).toISOString(), status: "ended" }) }));
  // Tudo no ⋯ › Gravação do painel: a entrada montada e escondida (o Chat na tela), com o nome dela.
  const gravacao = pane(markup, "more", "gravacao");
  assert.match(gravacao, /^<section aria-label="Gravação"[^>]*data-console-more="gravacao"/);
  assert.ok(hiddenPane(gravacao), "o ⋯ › Gravação escondido ate a pessoa escolher");
  assert.ok(markup.slice(markup.indexOf('data-console-slot="panel"')).includes(gravacao), "dentro do painel");
  const text = textOf(gravacao);
  assert.match(text, new RegExp(escape(copy.alinharChat)));
  assert.match(text, new RegExp(escape(copy.alinharPrevia)));
  for (const label of ["−5 s", "−1 s", "+1 s", "+5 s"]) {
    assert.match(gravacao, new RegExp(`<button[^>]*>${escape(label)}</button>`), label);
  }
  assert.match(gravacao, /data-live-align-seconds="2"/);
  assert.match(text, /No vídeo: 0:58/, "60 s da mensagem − 2 s do ajuste");
  assert.match(gravacao, /<iframe[^>]*src="https:\/\/iframe\.mediadelivery\.net\/embed\/42\/abc12345\?token=t&amp;expires=9&amp;autoplay=false&amp;t=58"/);
  assert.match(text, new RegExp(escape(copy.gravacaoPronta)));
  assert.match(text, new RegExp(escape(copy.enviarGravacao)));
  // Fora do ⋯ › Gravação, nada disso.
  const fora = markup.replace(gravacao, "");
  for (const label of [copy.alinharChat, copy.alinharPrevia, copy.enviarGravacao, "−5 s", "+5 s"]) {
    assert.ok(!textOf(fora).includes(label), `${label} so no ⋯ › Gravação`);
  }
  assert.doesNotMatch(fora, /data-live-align-seconds|<iframe/);
  assert.match(textOf(markup), new RegExp(escape(WEBINAR_COPY.sala.encerrada)), "a sala nao abre depois do fim");
});

test("a Live gravada não ganha a sala: nada de palco, gravador ou participantes", () => {
  const markup = html(
    createElement(SessionConsole, {
      currentUserId: HOST,
      data: { sessions: [session({ kind: "simulated" })], snapshot: snapshot({ live: null, session: session({ kind: "simulated" }) }), webinar: { ...webinar, kind: "simulated" } },
      permissions: both,
      serverNow: NOW
    })
  );
  assert.doesNotMatch(markup, /data-live-console|data-live-stage/);
  assert.doesNotMatch(textOf(markup), new RegExp(escape(copy.encerrarLive)));
});

test("fontes: o iframe pelo useJitsiMeet com o token do join-token e o nonce da página; os comandos do IFrame API ligados aos botões; a âncora no recordingStatusChanged; o Gravar da fila uma vez", () => {
  const panel = stripComments(read(consoleFile("live-room-panel.tsx")));
  assert.match(panel, /useJitsiMeet\(\{/);
  assert.match(panel, /\/api\/webinars\/\$\{encodeURIComponent\(webinarId\)\}\/join-token/);
  // O tema do console vai ao iframe na montagem (docs/31 V2-12), pelo mesmo `look` da sala do aluno.
  // A superficie console (docs/31 V2-14): quem apresenta usa a nossa barra; o Compartilhar tela pelo navegador.
  assert.match(panel, /liveConfigOverwrite\(token\.reply\.role, token\.reply\.settings, look, "console", screenShare\)/);
  assert.match(panel, /nonce: input\.nonce/);
  assert.match(panel, /tokenRefreshDelayMs\(/, "o token novo antes do exp");
  assert.match(panel, /name === "recordingStatusChanged" && shouldMarkAnchor\(/, "a ancora sai do recordingStatusChanged");
  assert.match(panel, /shouldAutoStartRecording\([\s\S]*?command\("startRecording", \{ mode: "file" \}\)/, "o Gravar da fila dispara sozinho");
  // A moderacao de audio e a de video (sem camera de aluno) e o seguir a visao saem de presenterSetupCommands
  // (live-console-model), mandados um a um ao virar moderador; a de tela nao liga pelo IFrame API (docs/31 §5.4).
  assert.match(panel, /presenterSetupCommands\(\{ allowStudentCamera: webinar\.allowStudentCamera !== false, role \}\)\)\s*\{\s*command\(name, \.\.\.args\);/, "os comandos do apresentador ao virar moderador");
  assert.match(panel, /command\("toggleLobby", value\)/);

  // As acoes de todos e a Sala de espera foram para a aba Pessoas (docs/31 V2-14; o live-controls.tsx saiu).
  assert.ok(!CONSOLE_FILES.some((path) => path.endsWith("/live-controls.tsx")), "o live-controls.tsx saiu: as pecas estao na aba Pessoas");
  const controls = stripComments(read(consoleFile("console-people-tab.tsx")));
  assert.match(controls, /command\("muteEveryone", "audio"\)[\s\S]*?copy\.silenciarTodos/);
  assert.match(controls, /command\("muteEveryone", "video"\)[\s\S]*?copy\.fecharCameras/);
  assert.match(controls, /command\("answerKnockingParticipant", id, true\)/);
  assert.match(panel, /command\("toggleModeration", !allowed, "video"\)/, "Câmeras livres");

  const hands = stripComments(read(consoleFile("live-hands.tsx")));
  assert.match(hands, /command\("askToUnmute", id\)/);
  assert.match(hands, /command\("muteRemoteParticipant", id, "audio"\)/);
  assert.match(hands, /command\("rejectParticipant", id, "audio"\)/);
  assert.match(hands, /command\("sendEndpointTextMessage", id, lowerHandMessage\(\)\)/);

  const main = stripComments(read(consoleFile("session-console.tsx")));
  assert.match(main, /kickFromSession\(\{ sessionId, userId \}\), \(\) => \{[\s\S]*?room\.command\("kickParticipant", participantId\)/, "Remover: o servidor primeiro, depois o iframe");
  assert.match(main, /banStudent\([\s\S]*?room\.command\("kickParticipant", target\.participantId\)/);
  assert.match(main, /requestRecording\(\{ sessionId \}\)[\s\S]*?reply\.action === "start"[\s\S]*?room\.command\("startRecording", \{ mode: "file" \}\)/);
  assert.match(main, /room\.command\("stopRecording"/);
  assert.match(main, /endLiveSession\(\{ sessionId \}\), \(\) => \{\s*room\.command\("endConference"\);\s*room\.command\("hangup"\);/);
  assert.match(main, /startLiveSession\(\{ sessionId \}\), \(\) =>\s*room\.syncLobby\(desiredLobby\(/, "Começar para todos desliga a sala de espera");
  assert.match(main, /setRoomLock\(\{ locked, sessionId \}\), \(\) =>\s*room\.syncLobby\(/, "Trancar liga a sala de espera");
  assert.match(main, /room\.command\("askToUnmute", participantId\);\s*room\.command\("approveVideo", participantId\);/, "Convidar ao palco");
  assert.match(main, /room\.command\("setLargeVideoParticipant", participantId\);\s*room\.command\("pinParticipant", participantId\);/, "Destacar");
  assert.match(main, /markRecordingAnchor\(\{ sessionId \}\)/);

  const page = stripComments(read("src/app/admin/(v2)/comunicacao/webinarios/[id]/sala/page.tsx"));
  assert.match(page, /headers\(\)/);
  assert.match(page, /nonce=\{requestHeaders\.get\("x-nonce"\)\}/);
});

/** Os textos escritos direto no JSX (texto entre tags e rotulos em aspas), pela arvore do TypeScript. */
function literalTexts(path) {
  const file = ts.createSourceFile(path, read(path), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const found = [];
  const visit = (node) => {
    if (ts.isJsxText(node) && /[A-Za-zÀ-ú]{2,}/.test(node.getText())) {
      found.push(node.getText().trim());
    }
    if (ts.isJsxAttribute(node) && ["alt", "aria-label", "placeholder", "title"].includes(node.name.getText()) && node.initializer && ts.isStringLiteral(node.initializer) && !node.initializer.text.startsWith("https://")) {
      found.push(node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

test("frases: os .tsx do console só desenham textos dos arquivos de frases (as peças da live, de WEBINAR_COPY ou das provisórias); nenhum texto de tela cita o motor da sala nem as palavras proibidas", () => {
  assert.ok(CONSOLE_FILES.length >= 15, `os .tsx do console: ${CONSOLE_FILES.length}`);
  for (const path of CONSOLE_FILES) {
    assert.deepEqual(literalTexts(path), [], `${path}: texto solto no JSX`);
  }
  assert.ok(LIVE_FILES.includes(consoleFile("live-room-panel.tsx")));
  for (const path of LIVE_FILES) {
    const source = stripComments(read(path));
    assert.doesNotMatch(source, /WEBINAR_ADMIN_COPY/, `${path}: as frases da sala ao vivo sao de WEBINAR_COPY`);
  }

  for (const markup of [render(snapshot()), render(snapshot({ live: liveBlock({ meetConfigured: false, recorder: recorder({ dispatchConfigured: false }) }) }))]) {
    const lower = textOf(markup).toLocaleLowerCase("pt-BR");
    assert.ok(!lower.includes("jitsi"), "nenhum Jitsi em texto de tela");
    for (const palavra of ["host", "lobby", "stream", "webinar "]) {
      assert.ok(!lower.includes(palavra), `"${palavra}" na tela`);
    }
    assert.ok(PROIBIDAS_WEBINARIO.includes("jitsi"));
  }
});

/* ------------------------------------------------------------------------------------------------
 * A barra de quem apresenta (docs/31 V2-14) e as Configurações dela (docs/30 §1.4 e §5.4)
 * ---------------------------------------------------------------------------------------------- */

const config = WEBINAR_COPY.aoVivo.config;
const consoleV2 = WEBINAR_COPY.consoleV2;
const noop = () => undefined;
const RESERVA = { audioInput: config.reserva.microfone, audioOutput: config.reserva.altoFalante, videoInput: config.reserva.camera };
/** Como o Chrome lista com a permissao (quem apresenta entra com ela): o "default" repete o aparelho interno. */
const CRU = {
  audioInput: [
    { deviceId: "default", groupId: "g-interno", label: "Padrão - Microfone interno" },
    { deviceId: "mic-interno", groupId: "g-interno", label: "Microfone interno" },
    { deviceId: "mic-usb", groupId: "g-usb", label: "Fone USB" }
  ],
  audioOutput: [
    { deviceId: "default", groupId: "g-interno", label: "Padrão - Alto-falantes internos" },
    { deviceId: "som-interno", groupId: "g-interno", label: "Alto-falantes internos" },
    { deviceId: "som-usb", groupId: "g-usb", label: "Fone USB" }
  ],
  videoInput: [
    { deviceId: "cam-integrada", groupId: "g-cam", label: "Câmera integrada" },
    { deviceId: "cam-usb", groupId: "g-webcam", label: "Webcam USB" }
  ]
};
const LISTAS = Object.fromEntries(Object.entries(CRU).map(([kind, list]) => [kind, deviceOptions(list, RESERVA[kind])]));

/** As secoes como o console monta (live-room-panel.tsx): o papel da sala, sem o Falar nem o aviso do aluno. */
const secoes = (role, extra = {}) =>
  deviceSettingsFor({
    allowStudentCamera: false,
    cameraConsented: false,
    isIOS: false,
    isMobile: false,
    joined: true,
    micAllowed: false,
    outputChangeAvailable: true,
    outputs: LISTAS.audioOutput,
    role,
    videoOn: true,
    ...extra
  });

const aparelhos = (extra = {}) => ({
  current: { audioInput: "mic-interno", audioOutput: "som-interno", videoInput: "cam-integrada" },
  espelhar: noop,
  fundo: noop,
  lists: LISTAS,
  maisFundos: noop,
  ruido: noop,
  ...extra
});

/** O LiveRoomHandle feito a mao (o que a barra le do useLiveRoom), dentro da sala e moderador. */
function handleFor(role = "host", extra = {}) {
  return {
    audioOn: false,
    camerasAllowed: false,
    chooseDevice: noop,
    command: () => true,
    controls: liveModel.liveControlsFor({ canPublish: true, moderator: true, role }),
    deviceSettings: secoes(role),
    devices: aparelhos(),
    dispatch: noop,
    frameStatus: "joined",
    joined: true,
    lobby: false,
    meetConfigured: true,
    retry: noop,
    role,
    room: { ...liveModel.EMPTY_ROOM, selfId: "p-eu" },
    screenShare: "ours",
    setCamerasAllowed: noop,
    setSettingsOpen: noop,
    settingsOpen: false,
    sharing: false,
    startTesting: noop,
    syncFilmstrip: noop,
    syncLobby: noop,
    testing: false,
    tokenError: null,
    videoOn: true,
    ...extra
  };
}

const bar = (handle, extra = {}) =>
  html(
    createElement(ConsoleBar, {
      busyKey: null,
      canPublish: true,
      handle,
      handsCount: 0,
      live: { recorder: recorder({ status: "ready" }), roomLocked: false },
      nowMs: NOW,
      onOpenPanel: noop,
      onRecord: noop,
      onStopRecording: noop,
      onTogglePanel: noop,
      panelOpen: true,
      session: { status: "live" },
      ...extra
    })
  );
const settingsOf = (sections, handleExtra = {}) => {
  const markup = bar(handleFor("host", { deviceSettings: sections, settingsOpen: true, ...handleExtra }));
  return markup.slice(markup.indexOf(`id="${CONSOLE_SETTINGS_ID}"`) - 200);
};
const openTag = (markup, pattern) => markup.match(new RegExp(`<button(?=[^>]*${pattern})[^>]*>`))?.[0] ?? "";
const item = (markup, name) => openTag(markup, `data-room-bar-item="${name}"`);
/** O conteudo de uma zona da barra (do fim da tag dela ate a tag da zona seguinte). */
const zone = (markup, name) => {
  const at = markup.indexOf(`data-room-bar-zone="${name}"`);
  const next = markup.indexOf("data-room-bar-zone=", at + 1);
  return markup.slice(markup.indexOf(">", at) + 1, next < 0 ? undefined : markup.lastIndexOf("<", next));
};

test("barra de quem apresenta (V2-14): o <nav> com a Sala de espera, Microfone, Câmera, Compartilhar tela e Gravar com o estado em aria-pressed, Mãos e Lançar enquete que abrem o painel, o Palco para todos, Configurações e o balao do painel; nomes fixos; fora da sala, a midia desligada", () => {
  const markup = bar(handleFor("host", { audioOn: true, room: { ...liveModel.EMPTY_ROOM, knocking: [{ id: "k-1", name: "Caio" }, { id: "k-2", name: "Duda" }], selfId: "p-eu" }, sharing: false, videoOn: false }));
  assert.match(markup, new RegExp(`^<div class="relative min-w-0" data-console-bar=""><nav aria-label="${escape(consoleV2.barra.rotulo)}"`));
  assert.doesNotMatch(markup, /role="group"/, "a barra do console e navegacao, nao grupo");
  // A ordem das zonas e dos circulos.
  const itens = Array.from(markup.matchAll(/data-room-bar-item="([a-z]+)"/g)).map((match) => match[1]);
  assert.deepEqual(itens, ["mic", "camera", "share", "record", "hands", "poll", "view", "settings", "panel"]);
  assert.match(zone(markup, "left"), /data-console-lobby="knocking"/);
  assert.equal(textOf(zone(markup, "left")), `${consoleV2.barra.salaDeEspera(2)} ${copy.admitirTodos}`);
  // Com o painel aberto a 1024 px a coluna do palco tem 656 px: a zona da Sala de espera fica so com o que sobra (a
  // primeira coluna da grade comeca em zero, nao no tamanho da pilula), a pilula encolhe com o texto inteiro no title, e
  // o Lançar enquete sai de 1024 a 1279 px (o ⋯ › Enquetes do painel faz o mesmo). Painel fechado, ele fica.
  const nav = markup.match(/<nav[^>]*>/)?.[0] ?? "";
  assert.ok((nav.match(/class="([^"]*)"/)?.[1] ?? "").split(" ").includes("lg:grid-cols-[minmax(0,1fr)_auto_minmax(max-content,1fr)]"), "a zona da esquerda com o que sobra");
  assert.doesNotMatch(nav, /lg:grid-cols-\[minmax\(max-content,1fr\)/, "a grade da sala fica so na sala");
  const pilula = zone(markup, "left").match(/<div[^>]*data-console-lobby="knocking"[^>]*>/)?.[0] ?? "";
  assert.match(pilula, new RegExp(`title="${escape(consoleV2.barra.salaDeEspera(2))}"`));
  assert.ok((pilula.match(/class="([^"]*)"/)?.[1] ?? "").split(" ").includes("shrink"), "a pilula encolhe");
  assert.match(item(markup, "poll"), /class="[^"]*\blg:max-xl:hidden\b/);
  assert.doesNotMatch(item(bar(handleFor("host"), { panelOpen: false }), "poll"), /lg:max-xl:hidden/);
  // Os nomes sao fixos e o estado vai em aria-pressed (o motor diz, nunca o clique).
  assert.match(item(markup, "mic"), /aria-label="Microfone"/);
  assert.match(item(markup, "mic"), /aria-pressed="true"/);
  assert.match(item(markup, "camera"), /aria-label="Câmera"/);
  assert.match(item(markup, "camera"), /aria-pressed="false"/);
  assert.match(item(markup, "camera"), new RegExp(`title="${escape(WEBINAR_COPY.aoVivo.ligarCamera)}"`));
  assert.match(item(markup, "share"), new RegExp(`aria-label="${escape(consoleV2.barra.compartilharTela)}"`));
  assert.match(item(markup, "share"), /aria-pressed="false"/);
  assert.match(item(markup, "record"), new RegExp(`aria-label="${escape(copy.gravar)}"`));
  assert.match(item(markup, "record"), /aria-pressed="false"/);
  assert.doesNotMatch(item(markup, "record"), /disabled=""/, "o gravador pronto: Gravar liga");
  // Mãos e Lançar enquete abrem o painel (a aba Mãos e o ⋯ › Enquetes): o aria-controls dele, sem aria-pressed.
  assert.match(item(markup, "hands"), new RegExp(`aria-controls="${CONSOLE_PANEL_ID}"(?=[^>]*aria-label="${escape(consoleV2.barra.maos(0))}")`));
  assert.match(item(markup, "poll"), new RegExp(`aria-controls="${CONSOLE_PANEL_ID}"(?=[^>]*aria-label="${escape(consoleV2.barra.lancarEnquete)}")`));
  for (const name of ["hands", "poll"]) {
    assert.doesNotMatch(item(markup, name), /aria-pressed|aria-expanded/, `${name} so abre o painel`);
  }
  assert.doesNotMatch(markup, /data-console-hands-count/, "sem mao levantada, sem o numero");
  // Com maos levantadas, o numero no circulo e no nome (o do circulo e so para a vista).
  const comMaos = bar(handleFor("host"), { handsCount: 2 });
  assert.match(item(comMaos, "hands"), new RegExp(`aria-label="${escape(consoleV2.barra.maos(2))}"`));
  assert.equal(consoleV2.barra.maos(2), "Mãos levantadas, 2");
  assert.match(comMaos, /<span aria-hidden="true" class="[^"]*\bbg-room-accent\b[^"]*" data-console-hands-count="">2<\/span>/);
  // O Palco para todos (o seguir a visao leva a escolha a todos) e o balao do painel do console.
  assert.match(openTag(markup, 'data-room-bar-item="view"'), new RegExp(`aria-label="${escape(consoleV2.visao.palcoParaTodos)}"`));
  assert.match(item(markup, "settings"), new RegExp(`aria-controls="${CONSOLE_SETTINGS_ID}"`));
  assert.match(item(markup, "panel"), new RegExp(`aria-controls="${CONSOLE_PANEL_ID}"(?=[^>]*aria-expanded="true")(?=[^>]*aria-label="${escape(consoleV2.painel.esconder)}")`));
  assert.doesNotMatch(item(markup, "panel"), /aria-pressed/, "o balao diz o estado no aria-expanded");

  // Ligados pelo motor: a camera, a tela e a gravacao (com o vermelho do Encerrar); a Grade para todos.
  const ligada = bar(handleFor("host", { room: { ...liveModel.EMPTY_ROOM, recording: { mode: "file", on: true }, selfId: "p-eu", viewShown: "grid" }, sharing: true, videoOn: true }));
  assert.match(item(ligada, "camera"), /aria-pressed="true"/);
  assert.match(item(ligada, "camera"), new RegExp(`title="${escape(WEBINAR_COPY.aoVivo.desligarCamera)}"`));
  assert.match(item(ligada, "share"), /aria-pressed="true"/);
  assert.match(item(ligada, "record"), /aria-pressed="true"/);
  assert.match(item(ligada, "record"), new RegExp(`title="${escape(copy.pararGravacao)}"`));
  assert.match(item(ligada, "record"), /bg-room-danger-bg/);
  assert.match(openTag(ligada, 'data-room-bar-item="view"'), new RegExp(`aria-label="${escape(consoleV2.visao.gradeParaTodos)}"`));
  // O painel fechado: "Mostrar o painel".
  assert.match(item(bar(handleFor("host"), { panelOpen: false }), "panel"), new RegExp(`aria-expanded="false"(?=[^>]*aria-label="${escape(consoleV2.painel.mostrar)}")`));

  // Fora da sala, todo circulo de midia desligado; o balao, Mãos e Lançar enquete so abrem o painel e continuam.
  const fora = bar(handleFor("host", { joined: false }));
  for (const name of ["mic", "camera", "share", "record", "view"]) {
    assert.match(openTag(fora, `data-room-bar-item="${name}"`), /disabled=""/, `${name} desligado fora da sala`);
  }
  for (const name of ["panel", "hands", "poll"]) {
    assert.doesNotMatch(item(fora, name), /disabled=""/, `${name} continua fora da sala`);
  }
});

test("barra por papel: o co-apresentador sem Gravar e com a Visão do vídeo so para si; a Equipe sem midia nem Configurações, com Mãos e Lançar enquete; o Compartilhar tela fora dos navegadores sem Chromium (o botao do motor fica no video)", () => {
  const coHost = bar(handleFor("co_host"));
  assert.deepEqual(Array.from(coHost.matchAll(/data-room-bar-item="([a-z]+)"/g)).map((match) => match[1]), ["mic", "camera", "share", "hands", "poll", "view", "settings", "panel"]);
  assert.match(openTag(coHost, 'data-room-bar-item="view"'), new RegExp(`aria-label="${escape(WEBINAR_COPY.salaV2.visao.atual(WEBINAR_COPY.salaV2.visao.palco))}"`));
  const equipe = bar(handleFor("team", { controls: liveModel.liveControlsFor({ canPublish: true, moderator: false, role: "team" }) }));
  assert.deepEqual(Array.from(equipe.matchAll(/data-room-bar-item="([a-z]+)"/g)).map((match) => match[1]), ["hands", "poll", "view", "panel"]);
  const motor = bar(handleFor("host", { screenShare: "engine" }));
  assert.deepEqual(Array.from(motor.matchAll(/data-room-bar-item="([a-z]+)"/g)).map((match) => match[1]), ["mic", "camera", "record", "hands", "poll", "view", "settings", "panel"]);
  assert.ok(!textOf(motor).includes(consoleV2.barra.compartilharTela) && !motor.includes(consoleV2.barra.compartilharTela));
});

test("barra: a Sala de espera sem ninguem batendo mostra a frase da sala numa pilula quieta (a sala trancada, a Sessão de prática) ou fica vazia; o Gravar por preparar abre o ⋯ › Gravação e o desligado diz o porque no title", () => {
  const trancada = bar(handleFor("host"), { live: { recorder: recorder({ status: "ready" }), roomLocked: true } });
  assert.match(zone(trancada, "left"), new RegExp(`<span[^>]*data-console-lobby="notice"[^>]*title="${escape(copy.salaTrancada)}">${escape(copy.salaTrancada)}</span>`));
  const pratica = bar(handleFor("host", { lobby: true }), { session: { status: "waiting" } });
  assert.equal(textOf(zone(pratica, "left")), copy.sessaoDePratica);
  assert.equal(textOf(zone(bar(handleFor("host")), "left")), "", "no ar, sem sala de espera nem tranca: a zona vazia");

  // Sem o gravador preparado: o clique abre o ⋯ › Gravação do painel (o Preparar mora la), com a frase do cartao no
  // title; sem messaging.publish, o Gravar diz a frase de quem publica.
  const semGravador = bar(handleFor("host"), { live: { recorder: recorder(), roomLocked: false } });
  assert.doesNotMatch(item(semGravador, "record"), /disabled=""/);
  assert.match(item(semGravador, "record"), new RegExp(`aria-controls="${CONSOLE_PANEL_ID}"`));
  assert.match(item(semGravador, "record"), new RegExp(`title="${escape(copy.gravacaoNaoPreparada)}"`));
  assert.doesNotMatch(item(bar(handleFor("host", { joined: false }), { live: { recorder: recorder(), roomLocked: false } }), "record"), /disabled=""/, "abre o painel tambem fora da sala");
  // Enviando o arquivo (nada a fazer): desligado, com a situacao no title.
  const enviando = bar(handleFor("host"), { live: { recorder: recorder({ status: "uploading" }), roomLocked: false } });
  assert.match(item(enviando, "record"), /disabled=""/);
  assert.doesNotMatch(item(enviando, "record"), /aria-controls/);
  const semPublicar = bar(handleFor("host"), { canPublish: false });
  assert.match(item(semPublicar, "record"), new RegExp(`disabled=""(?=[^>]*title="${escape(LIVE_CONSOLE_COPY.soQuemPublica)}")|title="${escape(LIVE_CONSOLE_COPY.soQuemPublica)}"[^>]*disabled=""`));
  // Na fila: girando, com a frase da fila.
  const fila = bar(handleFor("host"), { live: { recorder: recorder({ recordingRequestedAt: new Date(NOW).toISOString(), requestedAt: new Date(NOW - MIN).toISOString(), status: "preparing" }), roomLocked: false } });
  assert.match(item(fila, "record"), /aria-busy="true"/);
  assert.match(item(fila, "record"), new RegExp(escape(copy.gravarNaFila)));
});

test("Configurações no console: o botão na barra de quem apresenta (aria-expanded, aria-controls), dentro da barra, so para o Apresentador e o co-apresentador; a Equipe e a sala sem configuração ficam sem", () => {
  const host = render(snapshot());
  const botao = openTag(host, `aria-controls="${CONSOLE_SETTINGS_ID}"`);
  assert.ok(botao, "o botao Configurações do Apresentador");
  assert.match(botao, /data-room-bar-item="settings"/);
  assert.match(botao, /aria-expanded="false"/);
  assert.match(botao, new RegExp(`aria-label="${escape(copy.configuracoes)}"`));
  assert.ok(host.indexOf(botao) > host.indexOf('data-console-slot="bar"') && host.indexOf(botao) < host.indexOf('data-console-slot="panel"'), "na barra, embaixo do palco");
  assert.doesNotMatch(host, /data-live-settings=""/, "as Configurações so abrem no clique");

  assert.doesNotMatch(render(snapshot(), { currentUserId: "u-equipe" }), new RegExp(`aria-controls="${CONSOLE_SETTINGS_ID}"`), "a Equipe nao tem barra de midia no console (pendencia)");
  assert.doesNotMatch(render(snapshot({ live: liveBlock({ meetConfigured: false }) })), new RegExp(`aria-controls="${CONSOLE_SETTINGS_ID}"`), "sem a sala no ambiente, nada a configurar");
});

test("as Configurações de quem apresenta: Microfone, Alto-falante e Câmera com o aparelho em uso; ruido, fundo e espelho como acoes sem estado; Mais opções de fundo; nunca Qualidade do vídeo, volume nem os atalhos da sala; a camera nunca ligada com a frase de liga-la pela barra", () => {
  for (const role of ["host", "co_host"]) {
    const markup = bar(handleFor(role, { settingsOpen: true }));
    const panel = markup.slice(markup.indexOf(`id="${CONSOLE_SETTINGS_ID}"`) - 200);
    const text = textOf(panel);
    assert.match(markup, new RegExp(`<div(?=[^>]*data-live-settings="")(?=[^>]*id="${CONSOLE_SETTINGS_ID}")`), role);
    assert.match(panel, /data-testid="live-settings"/, `${role}: o painel da sala`);
    assert.match(panel, /<select aria-labelledby="live-settings-microfone"[^>]*data-live-device="audioInput"/, `${role}: microfone`);
    assert.match(panel, /<select aria-labelledby="live-settings-alto-falante"[^>]*data-live-device="audioOutput"/, `${role}: alto-falante`);
    assert.match(panel, /<select aria-labelledby="live-settings-camera"[^>]*data-live-device="videoInput"/, `${role}: camera`);
    assert.match(panel, /<option(?=[^>]*selected="")(?=[^>]*value="mic-interno")[^>]*>Microfone interno<\/option>/, "o aparelho em uso marcado");
    assert.match(panel, /<option(?=[^>]*selected="")(?=[^>]*value="som-interno")[^>]*>Alto-falantes internos<\/option>/);
    assert.match(panel, /<option value="cam-usb">Webcam USB<\/option>/);
    assert.doesNotMatch(panel, /value="default"/, "o 'Padrão' do Chrome junta com o aparelho que repete");
    for (const label of [config.altoFalante, config.ruidoLigar, config.ruidoDesligar, config.inverterImagem, config.desfocar, config.fundoTirar, config.maisFundos, config.fechar]) {
      assert.ok(text.includes(label), `${role}: ${label}`);
    }
    // Sem estado: nenhuma caixa marcada que o menu da miniatura ou o dialogo de fundo do motor deixariam errada.
    assert.doesNotMatch(panel, /type="checkbox"/);
    assert.ok(!text.includes(config.reduzirRuido) && !text.includes(config.espelhar), `${role}: sem as caixas do aluno`);
    for (const label of [config.qualidade, config.qualidadeAutomatica, config.volume, WEBINAR_COPY.aoVivo.som, WEBINAR_COPY.aoVivo.atalhos, WEBINAR_COPY.aoVivo.atalhoReagir]) {
      assert.ok(!text.includes(label), `${role}: sem "${label}" (setVideoQuality mudaria o envio do palco; os atalhos sao da sala)`);
    }
    assert.doesNotMatch(panel, /type="range"|type="radio"/);
  }

  // A camera fechada (ja liberada antes: a lista com nomes): sem Desfocar; no celular, nem desfoque nem o dialogo de fundo.
  const semCamera = textOf(settingsOf(secoes("host", { videoOn: false }), { videoOn: false }));
  assert.ok(!semCamera.includes(config.desfocar) && !semCamera.includes(config.fundoTirar));
  assert.ok(semCamera.includes(config.maisFundos));
  assert.ok(semCamera.includes(config.inverterImagem), "inverter nao depende da camera no ar");
  const celular = textOf(settingsOf(secoes("host", { isMobile: true })));
  assert.ok(!celular.includes(config.desfocar) && !celular.includes(config.maisFundos));
  assert.ok(celular.includes(config.ruidoLigar), "o resto continua no celular");

  // A camera nunca ligada neste navegador (a lista de cameras sem id): no lugar da lista, a frase de liga-la pela barra
  // (a nossa: a barra do video nao existe mais no console); ligada, a lista volta.
  const nuncaLigada = settingsOf(secoes("host", { videoOn: false }), { devices: aparelhos({ lists: { ...LISTAS, videoInput: [] } }), videoOn: false });
  assert.ok(textOf(nuncaLigada).includes(config.cameraAguardando));
  assert.ok(!textOf(nuncaLigada).includes(config.cameraNaBarraDoVideo));
  assert.doesNotMatch(nuncaLigada, /data-live-device="videoInput"/);
  assert.ok(!textOf(nuncaLigada).includes(config.semAparelho));
  assert.ok(!textOf(settingsOf(secoes("host"))).includes(config.cameraAguardando), "com a lista, sem a frase");

  // O navegador que nao troca a saida (Safari): sem a secao Alto-falante, o resto pronto.
  const safari = settingsOf(secoes("host", { outputChangeAvailable: false }));
  assert.doesNotMatch(safari, /data-live-device="audioOutput"/);
  assert.match(safari, /data-live-device="audioInput"/);

  // Fora da sala: so a frase de que as escolhas aparecem ao entrar, nenhuma lista.
  const fora = settingsOf(secoes("host", { joined: false }));
  assert.ok(textOf(fora).includes(config.foraDaSala));
  assert.doesNotMatch(fora, /<select/);

  // As frases pela lista proibida dos Webinarios, sem citar o motor da sala.
  for (const markup of [bar(handleFor("host", { settingsOpen: true })), bar(handleFor("co_host", { settingsOpen: true, videoOn: false })), settingsOf(secoes("host", { joined: false }))]) {
    const lower = textOf(markup).toLocaleLowerCase("pt-BR");
    for (const palavra of PROIBIDAS_WEBINARIO) {
      assert.ok(!lower.includes(palavra), `"${palavra}" na barra`);
    }
  }
});

test("fontes da barra e das Configurações: os aparelhos pelo useJitsiDevices do console, a troca só com a secao pronta e só de quem apresenta, a engrenagem só de aparelhos pelo papel, o Esc que fecha e nada de setVideoQuality", () => {
  const panel = stripComments(read(consoleFile("live-room-panel.tsx")));
  assert.match(panel, /useJitsiDevices\(\{[\s\S]*?podeTrocar: \(kind\) => deviceSettingsRef\.current !== null && deviceSectionReady\(deviceSettingsRef\.current, kind\)/);
  assert.match(panel, /deviceSettingsRef\.current = presenter \? deviceSettings : null;/, "so quem apresenta troca");
  assert.match(panel, /chooseDevice = \(kind: DeviceKind, option: DeviceOption\) => presenter && deviceSectionReady\(deviceSettings, kind\) && escolher\(kind, option\)/);
  assert.match(panel, /deviceSettingsFor\(\{[\s\S]*?role,[\s\S]*?videoOn: joined && videoOn/);
  assert.match(panel, /devicesSignalRef\.current\(name, payload\)/, "deviceListChanged e o ruido de volta numa entrada nova");
  assert.match(panel, /useMemo\(\(\) => liveInterfaceConfigOverwrite\(tokenRole, look\), \[tokenRole, look\]\)/, "a engrenagem so de aparelhos depende do papel (e o visual do tema, na montagem)");
  // Ruido, fundo e espelho sem estado nem reaplicacao: o menu da miniatura e o dialogo de fundo do motor tambem os mudam.
  assert.match(panel, /useJitsiDevices\(\{[\s\S]*?efeitosNoIframe: true,/);

  const barSource = stripComments(read(consoleFile("console-bar.tsx")));
  assert.match(barSource, /<LiveSettings[\s\S]*?cameraOn=\{handle\.videoOn\}[\s\S]*?onChoose=\{handle\.chooseDevice\}[\s\S]*?presenterBar="ours"/);
  assert.match(barSource, /event\.key === "Escape"/);
  for (const source of [panel, barSource]) {
    assert.doesNotMatch(source, /setVideoQuality|qualidade\(|volume\(|toggleNoiseSuppression/, "quem apresenta nao baixa o proprio palco");
  }
  const hook = stripComments(read("src/components/webinars/use-jitsi-devices.ts"));
  assert.match(hook, /const maisFundos = useCallback\(\(\) => \{\s*executeCommand\("toggleVirtualBackgroundDialog"\);/);
});


/* ------------------------------------------------------------------------------------------------
 * O painel com abas (docs/31 V2-15) e a aba Pessoas (V2-14)
 * ---------------------------------------------------------------------------------------------- */

test("painel com abas (V2-15): na live, Chat, Perguntas, Mãos e Pessoas e o ⋯ Mais painéis fora da lista das abas, com Enquetes, Atendimento, Presença e Gravação; tudo montado, so o Chat na tela; o X a partir de lg", async () => {
  const { consolePresenceOf } = await import("../src/server/webinars/console-presence-model.ts");
  const view = { chat: { hot: [], perMinute: [], students: 0, top: [], total: 0 }, presence: { avgPresent: 2, curve: [{ b: 1, n: 2 }], drops: [], peak: { b: 1, n: 2 }, reachedEnd: 0, unique: 2, watchAvgSeconds: 0, watchMaxSeconds: 0 } };
  const question = (id, status) => ({ anonymous: false, answerText: null, answeredAt: null, answeredBy: null, answeredLive: false, body: `Pergunta ${id}`, createdAt: new Date(NOW - MIN).toISOString(), displayName: "Ana M.", id, messageId: null, offsetMs: 60_000, sessionId: S_LIVE, status, upvotes: 0, userId: ANA });
  const markup = render(snapshot({ presence: consolePresenceOf(view, 4 * MIN), questions: [question("q-1", "open"), question("q-2", "answered"), question("q-3", "open")] }));
  const panel = markup.slice(markup.indexOf('data-console-slot="panel"'));
  // A linha das abas da sala (o RoomTabList), com os ids do console e as perguntas abertas no nome.
  assert.match(panel, new RegExp(`role="tablist"`));
  assert.deepEqual(Array.from(panel.matchAll(/role="tab"[^>]*>([^<]+)</g)).map((match) => match[1]), ["Chat", "Perguntas 2", "Mãos 0", "Pessoas"]);
  assert.deepEqual(Array.from(panel.matchAll(/<button aria-controls="(console-tab-[a-z]+)" aria-selected="(true|false)"/g)).map((match) => [match[1], match[2]]), [
    ["console-tab-chat", "true"],
    ["console-tab-perguntas", "false"],
    ["console-tab-maos", "false"],
    ["console-tab-pessoas", "false"]
  ]);
  // Cada aba com o painel dela, montado; so o Chat na tela.
  for (const [aba, escondida] of [["chat", false], ["perguntas", true], ["maos", true], ["pessoas", true]]) {
    const bloco = pane(markup, "tab", aba);
    assert.match(bloco, new RegExp(`^<div aria-labelledby="console-tabbtn-${aba}"[^>]*id="console-tab-${aba}" role="tabpanel"`), aba);
    assert.equal(hiddenPane(bloco), escondida, `${aba} ${escondida ? "escondida" : "na tela"}`);
  }
  assert.match(pane(markup, "tab", "chat"), /data-console-chat=""/);
  assert.match(textOf(pane(markup, "tab", "perguntas")), /Pergunta q-1/);
  // O ⋯ fora da lista das abas: um botao de menu, com as entradas da live como radio, na ordem do V2-15.
  const tablistEnd = panel.indexOf("</div>", panel.indexOf('role="tablist"'));
  const trigger = panel.match(/<button(?=[^>]*data-console-more-trigger="")[^>]*>/)?.[0] ?? "";
  assert.match(trigger, /aria-haspopup="menu"/);
  assert.match(trigger, new RegExp(`aria-label="${escape(consoleV2Copy.mais)}"`));
  assert.ok(panel.indexOf("data-console-more-trigger") > tablistEnd, "o ⋯ depois da lista das abas, fora dela");
  assert.deepEqual(Array.from(panel.matchAll(/role="menuitemradio"[^>]*>([^<]+)</g)).map((match) => match[1]), ["Enquetes", "Atendimento", "Presença", "Gravação"]);
  // Cada entrada e uma <section> com o nome dela (nao um tabpanel), montada e escondida.
  for (const [entrada, nome] of [["enquetes", "Enquetes"], ["atendimento", "Atendimento"], ["presenca", "Presença"], ["gravacao", "Gravação"]]) {
    const bloco = pane(markup, "more", entrada);
    assert.match(bloco, new RegExp(`^<section aria-label="${nome}"[^>]*data-console-more="${entrada}" hidden="" role="group"`), entrada);
    // Um grupo, nao uma regiao: a regiao e o cartao de dentro, e o leitor de tela nao lista "Enquetes" dentro de "Enquetes".
    assert.doesNotMatch(bloco, /^<section(?![^>]*role=)/, `${entrada}: a entrada nao e uma regiao`);
  }
  assert.doesNotMatch(panel, /data-console-more="(?:roteiro|oferta)"/, "Roteiro e Oferta nao existem na live");
  // O X so a partir de lg, com o nome dele.
  assert.match(panel, new RegExp(`<button aria-label="${escape(consoleV2Copy.fecharPainel)}" class="[^"]*\\bhidden\\b[^"]*\\blg:grid\\b`));
  // A Equipe tem as mesmas abas e entradas.
  const equipe = render(snapshot(), { currentUserId: "u-equipe" });
  assert.deepEqual(Array.from(equipe.matchAll(/role="tab"[^>]*>([^<]+)</g)).map((match) => match[1]), ["Chat", "Perguntas 0", "Mãos 0", "Pessoas"]);
});

test("ConsolePanel: com uma entrada do ⋯ escolhida, ela fica na tela, nenhuma aba fica escolhida e o ⋯ diz o nome dela; fechado, o aside some montado; sem palco, sem o X", () => {
  const panelOf = (extra = {}) =>
    html(
      createElement(ConsolePanel, {
        className: "relative flex",
        closable: true,
        counts: { maos: 2, perguntas: 1 },
        entries: ["enquetes", "atendimento", "gravacao"],
        more: { atendimento: "A", enquetes: "E", gravacao: "G" },
        onClose: noop,
        onView: noop,
        open: true,
        panes: { chat: "C", maos: "M", perguntas: "P", pessoas: "S" },
        tabs: ["chat", "perguntas", "maos", "pessoas"],
        view: { more: "gravacao" },
        ...extra
      })
    );
  const markup = panelOf();
  assert.match(markup, /^<aside class="relative flex" data-console-slot="panel" id="console-panel">/);
  assert.doesNotMatch(markup, /aria-selected="true"/, "nenhuma aba escolhida");
  assert.deepEqual(Array.from(markup.matchAll(/role="tab"[^>]*>([^<]+)</g)).map((match) => match[1]), ["Chat", "Perguntas 1", "Mãos 2", "Pessoas"]);
  const trigger = markup.match(/<button(?=[^>]*data-console-more-trigger="gravacao")[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.match(trigger, new RegExp(`aria-label="${escape(consoleV2Copy.maisEscolhido("Gravação"))}"`));
  assert.match(trigger, />Gravação<svg/, "o nome da entrada e a seta");
  assert.match(markup, /data-menu-value="gravacao"/, "a opcao escolhida marcada no menu");
  assert.ok(!hiddenPane(pane(markup, "more", "gravacao")));
  for (const outra of ["enquetes", "atendimento"]) {
    assert.ok(hiddenPane(pane(markup, "more", outra)), outra);
  }
  for (const aba of ["chat", "perguntas", "maos", "pessoas"]) {
    assert.ok(hiddenPane(pane(markup, "tab", aba)), `${aba} escondida`);
  }
  // Fechado: o aside hidden, tudo montado.
  const fechado = panelOf({ open: false, view: { tab: "maos" } });
  assert.match(fechado, /^<aside[^>]*hidden=""/);
  assert.match(fechado, /aria-selected="true"[^>]*id="console-tabbtn-maos"/);
  assert.ok(!hiddenPane(pane(fechado, "tab", "maos")));
  assert.match(fechado.match(/<button(?=[^>]*data-console-more-trigger="")[^>]*>/)?.[0] ?? "", new RegExp(`aria-label="${escape(consoleV2Copy.mais)}"`), "sem entrada escolhida, o ⋯ e o circulo");
  // Sem palco (a gravada e o Replay), o painel nunca fecha: sem o X.
  assert.doesNotMatch(panelOf({ closable: false }), new RegExp(escape(consoleV2Copy.fecharPainel)));
});

test("aba Pessoas (V2-14): Silenciar todos, Fechar todas as câmeras e Câmeras livres (aria-pressed pelo motor) para quem apresenta; a Sala de espera com Admitir; as linhas com o microfone, a camera e o Compartilhando; o rodape com quem esta na sala e as maos; a Equipe sem as acoes de midia", () => {
  const room = {
    ...liveModel.EMPTY_ROOM,
    hands: [{ id: "p-ana", raisedAt: NOW }],
    knocking: [{ id: "k-1", name: "Caio" }],
    media: { "p-ana": { audio: true, video: false }, "p-co": { audio: true, video: true } },
    people: [
      { id: "p-ana", name: "Ana na sala" },
      { id: "p-co", name: "Co T." },
      { id: "p-sem", name: "Visitante" }
    ],
    roles: { "p-co": "moderator" },
    selfId: "p-eu",
    sharing: ["p-co"]
  };
  const people = liveBlock().people;
  const tab = (handle) => html(createElement(ConsolePeopleTab, { busyKey: null, canPublish: true, handle, onAction: noop, people }));
  const host = tab(handleFor("host", { camerasAllowed: true, room }));
  const text = textOf(host);
  assert.match(host, /^<div class="[^"]*\bbg-room-surface\b[^"]*" data-console-people="">/, "o cartao da aba pelo token do tema");
  for (const label of [copy.silenciarTodos, copy.fecharCameras]) {
    assert.match(text, new RegExp(escape(label)), label);
  }
  assert.match(host, /aria-pressed="true"[^>]*>(?:(?!<\/button>).)*Câmeras livres/s, "as cameras livres pelo que o motor disse");
  assert.match(tab(handleFor("host", { camerasAllowed: false, room })), /aria-pressed="false"[^>]*>(?:(?!<\/button>).)*Câmeras livres/s);
  // A Sala de espera: quem bate, com Admitir e Admitir todos.
  assert.match(text, new RegExp(escape(copy.esperando(1))));
  assert.match(host, /<li[^>]*data-live-knocking="k-1"[^>]*>[\s\S]*?aria-label="Admitir: Caio"/);
  assert.match(text, new RegExp(escape(copy.admitirTodos)));
  // Quem esta na sala: "Na sala · 3"; a Ana (aluna do retrato) com o microfone ligado e a camera desligada; o
  // co-apresentador (moderador) como Equipe, compartilhando a tela; sem sinal, desligados.
  assert.match(text, new RegExp(escape(consoleV2Copy.pessoas.naSala(3))));
  const linha = (id) => host.slice(host.indexOf(`data-live-participant="${id}"`), host.indexOf("</li>", host.indexOf(`data-live-participant="${id}"`)));
  assert.match(linha("p-ana"), /data-live-mic="on"/);
  assert.match(linha("p-ana"), /data-live-camera="off"/);
  assert.match(textOf(linha("p-ana")), new RegExp(`${escape(consoleV2Copy.pessoas.midia.microfoneLigado)} ${escape(consoleV2Copy.pessoas.midia.cameraDesligada)}`));
  assert.ok(textOf(linha("p-ana")).includes("Ana M.") && !textOf(linha("p-ana")).includes("Ana na sala"), "o nome do retrato");
  assert.match(textOf(linha("p-co")), new RegExp(`${escape(LIVE_CONSOLE_COPY.equipe)} ${escape(consoleV2Copy.pessoas.compartilhando)}`));
  assert.match(linha("p-co"), /data-live-camera="on"/);
  assert.match(linha("p-sem"), /data-live-mic="off"[\s\S]*data-live-camera="off"/, "sem sinal, desligados");
  assert.ok(!textOf(linha("p-ana")).includes(consoleV2Copy.pessoas.compartilhando), "so quem compartilha leva o selo");
  // O rodape: quem esta na sala e as maos levantadas.
  assert.match(text, new RegExp(`${escape(consoleV2Copy.pessoas.rodape(3, 1))}$`));
  assert.equal(consoleV2Copy.pessoas.rodape(3, 1), "3 na sala · 1 com a mão levantada");
  // A Equipe nao silencia todos nem mexe nas cameras, nem admite; ve quem esta e o rodape.
  const equipe = tab(handleFor("team", { controls: liveModel.liveControlsFor({ canPublish: true, moderator: false, role: "team" }), room }));
  for (const label of [copy.silenciarTodos, copy.fecharCameras, consoleV2Copy.pessoas.cameras, copy.salaDeEspera]) {
    assert.ok(!textOf(equipe).includes(label), `a Equipe sem ${label}`);
  }
  assert.doesNotMatch(equipe, /data-live-controls/);
  assert.match(textOf(equipe), new RegExp(escape(consoleV2Copy.pessoas.naSala(3))));
  // A Equipe moderadora silencia todos, sem mexer nas cameras.
  const moderadora = textOf(tab(handleFor("team", { controls: liveModel.liveControlsFor({ canPublish: true, moderator: true, role: "team" }), room })));
  assert.ok(moderadora.includes(copy.silenciarTodos) && !moderadora.includes(copy.fecharCameras));
  // Fora da sala, as acoes de todos ficam desligadas.
  const fora = tab(handleFor("host", { joined: false, room }));
  assert.match(fora, new RegExp(`<button[^>]*disabled=""[^>]*>(?:(?!</button>).)*${escape(copy.silenciarTodos)}`, "s"));
});
