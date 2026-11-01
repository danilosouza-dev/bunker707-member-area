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
// "Ao vivo", o Gravando e os presentes com o pico dentro do palco, o topo da live sem eles. O card Configurações de quem
// apresenta (docs/30 §1.4): o botao embaixo do palco (provisorio ate a barra) so para o Apresentador e o
// co-apresentador, o card com Microfone, Alto-falante e Câmera,
// Reduzir ruído, Espelhar, Desfocar o fundo e Mais opções de fundo, sem Qualidade do vídeo nem volume, e nas fontes a
// troca so com a secao pronta e o dialogo de fundo pelo toggleVirtualBackgroundDialog.

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
const { LIVE_SETTINGS_CARD_ID, LiveSettingsCard } = await import("../src/components/admin/v2/communication/webinars/session-console/live-settings-card.tsx");
const { deviceOptions, deviceSettingsFor } = await import("../src/lib/jitsi-device-settings.ts");

const copy = WEBINAR_COPY.consoleAoVivo;
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

test("console V2 em tela cheia (docs/31 V2-13): a raiz com o tema, o topo com Trancar a sala (aria-pressed) ao lado de Encerrar live, e o palco na coluna do palco, com os controles embaixo e os cards no painel", () => {
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

  // O iframe no palco, dentro da coluna do palco; os controles no lugar da barra, embaixo; os cards no painel.
  const coluna = markup.indexOf('data-console-slot="stage-column"');
  const palco = markup.indexOf('data-console-slot="stage"');
  const iframe = markup.indexOf('data-live-stage=""');
  const barra = markup.indexOf('data-console-slot="bar"');
  const controles = markup.indexOf("data-live-controls");
  const painel = markup.indexOf('data-console-slot="panel"');
  assert.ok(coluna >= 0 && coluna < palco && palco < iframe && iframe < barra && barra < controles && controles < painel, "coluna > palco > iframe, depois a barra e o painel");
  assert.equal(count(markup, /data-live-stage=""/g), 1, "um palco so");
  assert.match(markup, /<div[^>]*data-console-slot="panel"[^>]*id="console-panel"/);
  for (const marca of ["data-console-chat", "data-live-hands", "data-live-recorder"]) {
    assert.ok(markup.indexOf(marca) > painel, `${marca} no painel`);
  }
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

test("palco: a sala abrindo no meio com os controles do Apresentador ao redor; sem a sala no ambiente, a frase e o resto do console funciona", () => {
  const markup = render(snapshot());
  const text = textOf(markup);
  assert.match(markup, /data-live-stage=""/);
  assert.match(text, /Abrindo a sala…/);
  for (const label of [copy.silenciarTodos, copy.fecharCameras, copy.permitirCameras, copy.trancar, copy.salaDeEspera, copy.ninguemEsperando, LIVE_CONSOLE_COPY.microfoneSozinho]) {
    assert.match(text, new RegExp(escape(label)), label);
  }
  assert.match(markup, /<input(?=[^>]*type="checkbox")(?=[^>]*disabled="")(?![^>]*checked="")[^>]*>/, "o microfone do aluno fica desligado e fixo");
  assert.match(markup, /aria-pressed="false"[^>]*>(?:(?!<\/button>).)*Permitir câmeras dos alunos/s, "o webinário sem câmera de aluno começa com as câmeras bloqueadas");

  const semSala = textOf(render(snapshot({ live: liveBlock({ meetConfigured: false }) })));
  assert.match(semSala, new RegExp(escape(copy.salaEmBreve)));
  assert.match(semSala, /Chat/, "o chat continua");
  assert.match(semSala, /Boa noite!/);

  const trancada = textOf(render(snapshot({ live: liveBlock({ roomLocked: true }) })));
  assert.match(trancada, new RegExp(escape(copy.destrancar)));
  assert.match(trancada, new RegExp(escape(copy.salaTrancada)));
});

test("Mão levantada e Participantes: vazios, os barrados com Desfazer e Desfazer banimento; o ⋯ do autor no chat com Silenciar 5/15/60/até o fim, Remover da sala e Banir", () => {
  const markup = render(snapshot());
  const text = textOf(markup);
  assert.match(text, /Mão levantada \(0\)/);
  assert.match(text, new RegExp(escape(copy.nenhumaMao)));
  assert.match(text, new RegExp(escape(copy.semParticipantes)));
  assert.match(text, new RegExp(escape(LIVE_CONSOLE_COPY.removidosESilenciados)));
  const barred = markup.slice(markup.indexOf(`data-live-barred-user="${BIA}"`));
  assert.match(textOf(barred), /Desfazer: Sem escrever até 20:20/);
  assert.match(textOf(barred), /Desfazer: Removido da sala/);
  assert.match(textOf(barred), new RegExp(escape(copy.desfazerBanimento)));

  const chat = markup.slice(markup.indexOf('data-console-message="m-ana"'), markup.indexOf("</li>", markup.indexOf('data-console-message="m-ana"')));
  assert.match(chat, /aria-label="Mais ações para Ana M\."/);
  for (const label of ["Silenciar 5 min", "Silenciar 15 min", "Silenciar 60 min", "Silenciar até o fim", copy.removerDaSala, copy.banir]) {
    assert.match(textOf(chat), new RegExp(escape(label)), label);
  }
  const equipe = markup.slice(markup.indexOf('data-console-message="m-equipe"'), markup.indexOf("</li>", markup.indexOf('data-console-message="m-equipe"')));
  assert.doesNotMatch(equipe, /Mais ações/, "a equipe nao tem o ⋯ de moderacao");

  const semPublicar = render(snapshot(), { permissions: { canPublish: false, canWrite: true } });
  const banir = semPublicar.slice(semPublicar.indexOf('data-console-message="m-ana"'));
  assert.match(banir, /<div aria-disabled="true" data-menu-item="" role="menuitem">Banir<\/div>/, "Banir so com messaging.publish");
});

test("cartão Gravação: Preparar e a reserva sem o pedido automático; a fila com a estimativa; Gravando com Parar; a âncora com os segundos e a diferença do arquivo; só o Apresentador grava", () => {
  const reserva = textOf(render(snapshot({ live: liveBlock({ recorder: recorder({ dispatchConfigured: false }) }) })));
  assert.match(reserva, new RegExp(escape(LIVE_CONSOLE_COPY.gravacao)));
  assert.match(reserva, new RegExp(escape(copy.prepararGravacao)));
  assert.match(reserva, new RegExp(escape(copy.disparoAusente)));
  assert.match(reserva, new RegExp(escape(copy.gravarNoNavegador)));
  assert.match(reserva, new RegExp(escape(copy.enviarGravacao)));

  const fila = textOf(render(snapshot({ live: liveBlock({ recorder: recorder({ estimateMinutes: 4, recordingRequestedAt: new Date(NOW).toISOString(), requestedAt: new Date(NOW - 3 * MIN).toISOString(), status: "preparing" }) }) })));
  assert.match(fila, /Preparando a gravação, 4 min/);
  assert.match(fila, new RegExp(escape(copy.gravarNaFila)));
  assert.match(fila, /Máquina ligada há 3 min/);

  const gravando = render(snapshot({ live: liveBlock({ recorder: recorder({ anchorAt: "2026-11-05T23:03:15.000Z", driftMs: 4_000, requestedAt: new Date(NOW - 40 * MIN).toISOString(), status: "recording" }) }) }));
  assert.match(textOf(gravando), new RegExp(escape(copy.pararGravacao)));
  assert.match(textOf(gravando), /A gravação começou às 20:03:15/);
  assert.match(textOf(gravando), /O arquivo começou 4 s depois do clique/);
  assert.ok(count(textOf(gravando), /Gravando/g) >= 2, "o selo no palco e no cartao");

  const pronta = render(snapshot({ live: liveBlock({ recorder: recorder({ status: "ready" }) }) }));
  assert.match(textOf(pronta), new RegExp(escape(copy.gravacaoPronta)));
  const gravar = pronta.slice(pronta.lastIndexOf("<button", pronta.indexOf(`${copy.gravar}</button>`)), pronta.indexOf(`${copy.gravar}</button>`));
  assert.match(gravar, /disabled=""/, "Gravar so liga com o console dentro da sala");

  const equipe = textOf(render(snapshot({ live: liveBlock({ recorder: recorder({ status: "ready" }) }) }), { currentUserId: "u-equipe" }));
  assert.doesNotMatch(equipe, new RegExp(`${escape(copy.gravar)} `), "a Equipe nao grava");
  assert.match(equipe, new RegExp(escape(LIVE_CONSOLE_COPY.soOApresentador)));
  assert.doesNotMatch(equipe, new RegExp(escape(copy.fecharCameras)), "a Equipe nao fecha cameras");
});

test("Alinhar chat com prévia (± segundos, a mensagem e o player no ponto) e Enviar gravação depois do fim", () => {
  const recording = { anchorOffsetMs: 2_000, bunnyLibraryId: "42", bunnyVideoId: "abc12345", durationSeconds: 3600, embedUrl: "https://iframe.mediadelivery.net/embed/42/abc12345", errorMessage: null, id: "r-1", previewUrl: "https://iframe.mediadelivery.net/embed/42/abc12345?token=t&expires=9", source: "jibri", status: "ready" };
  const markup = render(snapshot({ live: liveBlock({ recording }), session: session({ endedAt: new Date(NOW).toISOString(), status: "ended" }) }));
  const text = textOf(markup);
  assert.match(text, new RegExp(escape(copy.alinharChat)));
  assert.match(text, new RegExp(escape(copy.alinharPrevia)));
  for (const label of ["−5 s", "−1 s", "+1 s", "+5 s"]) {
    assert.match(text, new RegExp(escape(label)), label);
  }
  assert.match(markup, /data-live-align-seconds="2"/);
  assert.match(text, /No vídeo: 0:58/, "60 s da mensagem − 2 s do ajuste");
  assert.match(markup, /<iframe[^>]*src="https:\/\/iframe\.mediadelivery\.net\/embed\/42\/abc12345\?token=t&amp;expires=9&amp;autoplay=false&amp;t=58"/);
  assert.match(text, new RegExp(escape(copy.gravacaoPronta)));
  assert.match(text, new RegExp(escape(copy.enviarGravacao)));
  assert.match(text, new RegExp(escape(WEBINAR_COPY.sala.encerrada)), "a sala nao abre depois do fim");
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
  assert.match(panel, /liveConfigOverwrite\(token\.reply\.role, token\.reply\.settings, look\)/);
  assert.match(panel, /nonce: input\.nonce/);
  assert.match(panel, /tokenRefreshDelayMs\(/, "o token novo antes do exp");
  assert.match(panel, /name === "recordingStatusChanged" && shouldMarkAnchor\(/, "a ancora sai do recordingStatusChanged");
  assert.match(panel, /shouldAutoStartRecording\([\s\S]*?command\("startRecording", \{ mode: "file" \}\)/, "o Gravar da fila dispara sozinho");
  // A moderacao de audio e a de video (sem camera de aluno) e o seguir a visao saem de presenterSetupCommands
  // (live-console-model), mandados um a um ao virar moderador; a de tela nao liga pelo IFrame API (docs/31 §5.4).
  assert.match(panel, /presenterSetupCommands\(\{ allowStudentCamera: webinar\.allowStudentCamera !== false, role \}\)\)\s*\{\s*command\(name, \.\.\.args\);/, "os comandos do apresentador ao virar moderador");
  assert.match(panel, /command\("toggleLobby", value\)/);

  const controls = stripComments(read(consoleFile("live-controls.tsx")));
  assert.match(controls, /command\("muteEveryone", "audio"\)[\s\S]*?copy\.silenciarTodos/);
  assert.match(controls, /command\("muteEveryone", "video"\)[\s\S]*?copy\.fecharCameras/);
  assert.match(controls, /command\("answerKnockingParticipant", id, true\)/);
  assert.match(panel, /command\("toggleModeration", !allowed, "video"\)/, "Permitir câmeras dos alunos");

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
 * O card Configurações de quem apresenta (docs/30 §1.4 e §5.4)
 * ---------------------------------------------------------------------------------------------- */

const config = WEBINAR_COPY.aoVivo.config;
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
const card = (sections, extra = {}) => html(createElement(LiveSettingsCard, { cameraOn: true, devices: aparelhos(), onChoose: noop, onClose: noop, sections, ...extra }));
const openTag = (markup, pattern) => markup.match(new RegExp(`<button(?=[^>]*${pattern})[^>]*>`))?.[0] ?? "";

test("Configurações no console: o botão embaixo do palco, ao lado dos controles (provisório até a barra), só para o Apresentador e o co-apresentador (aria-expanded, aria-controls); a Equipe e a sala sem configuração ficam sem", () => {
  const host = render(snapshot());
  const botao = openTag(host, `aria-controls="${LIVE_SETTINGS_CARD_ID}"`);
  assert.ok(botao, "o botao Configurações do Apresentador");
  assert.match(botao, /aria-expanded="false"/);
  assert.match(textOf(host.slice(host.indexOf(botao), host.indexOf("</button>", host.indexOf(botao)))), new RegExp(`^${escape(copy.configuracoes)}$`));
  assert.ok(host.indexOf(botao) > host.indexOf('data-console-slot="bar"') && host.indexOf(botao) > host.indexOf("data-live-controls"), "embaixo do palco, com os controles");
  assert.ok(host.indexOf(botao) < host.indexOf('data-console-slot="panel"'), "antes do painel");
  assert.doesNotMatch(host, /data-live-settings=""/, "o card so abre no clique");

  assert.doesNotMatch(render(snapshot(), { currentUserId: "u-equipe" }), new RegExp(`aria-controls="${LIVE_SETTINGS_CARD_ID}"`), "a Equipe nao tem barra de midia no console (pendencia)");
  assert.doesNotMatch(render(snapshot({ live: liveBlock({ meetConfigured: false }) })), new RegExp(`aria-controls="${LIVE_SETTINGS_CARD_ID}"`), "sem a sala no ambiente, nada a configurar");
});

test("o card de quem apresenta: Microfone, Alto-falante e Câmera com o aparelho em uso; ruido, fundo e espelho como acoes sem estado (a barra do iframe tambem os muda); Mais opções de fundo; nunca Qualidade do vídeo nem volume", () => {
  for (const role of ["host", "co_host"]) {
    const markup = card(secoes(role));
    const text = textOf(markup);
    assert.match(markup, new RegExp(`<section(?=[^>]*id="${LIVE_SETTINGS_CARD_ID}")(?=[^>]*aria-labelledby="console-live-settings-title")`), role);
    assert.match(markup, /<select aria-labelledby="console-live-settings-microfone"[^>]*data-live-device="audioInput"/, `${role}: microfone`);
    assert.match(markup, /<select aria-labelledby="console-live-settings-alto-falante"[^>]*data-live-device="audioOutput"/, `${role}: alto-falante`);
    assert.match(markup, /<select aria-labelledby="console-live-settings-camera"[^>]*data-live-device="videoInput"/, `${role}: camera`);
    assert.match(markup, /id="console-live-settings-microfone">Microfone</);
    assert.match(markup, /<option(?=[^>]*selected="")(?=[^>]*value="mic-interno")[^>]*>Microfone interno<\/option>/, "o aparelho em uso marcado");
    assert.match(markup, /<option(?=[^>]*selected="")(?=[^>]*value="som-interno")[^>]*>Alto-falantes internos<\/option>/);
    assert.match(markup, /<option value="som-usb">Fone USB<\/option>/);
    assert.match(markup, /<option value="cam-usb">Webcam USB<\/option>/);
    assert.doesNotMatch(markup, /value="default"/, "o 'Padrão' do Chrome junta com o aparelho que repete");
    for (const label of [
      copy.configuracoes,
      copy.configuracoesTexto,
      config.altoFalante,
      config.ruidoLigar,
      config.ruidoDesligar,
      config.inverterImagem,
      config.desfocar,
      config.fundoTirar,
      config.maisFundos
    ]) {
      assert.ok(text.includes(label), `${role}: ${label}`);
    }
    // Sem estado: nenhuma caixa marcada que a setinha do microfone, o fundo ou a engrenagem do iframe deixariam errada,
    // e nada de "Espelhar" com estado suposto (o iframe guarda o espelho de uma live para outra).
    assert.doesNotMatch(markup, /type="checkbox"/);
    assert.ok(!text.includes(config.reduzirRuido) && !text.includes(config.espelhar), `${role}: sem as caixas do aluno`);
    for (const label of [config.ruidoLigar, config.inverterImagem, config.desfocar, config.fundoTirar]) {
      assert.match(markup, new RegExp(`<button[^>]*type="button"[^>]*>${escape(label)}</button>`), `${role}: ${label} e um botao`);
    }
    for (const label of [config.qualidade, config.qualidadeAutomatica, config.qualidadeEconomizar, config.volume, WEBINAR_COPY.aoVivo.som, WEBINAR_COPY.aoVivo.atalhos]) {
      assert.ok(!text.includes(label), `${role}: sem "${label}" (setVideoQuality mudaria o envio do palco)`);
    }
    assert.doesNotMatch(markup, /type="range"|type="radio"/);
  }

  // A camera fechada (ja liberada antes: a lista com nomes): sem Desfocar, com a frase de onde liga-la; no celular, nem
  // desfoque nem o dialogo de fundo.
  const semCamera = textOf(card(secoes("host", { videoOn: false }), { cameraOn: false }));
  assert.ok(!semCamera.includes(config.desfocar) && !semCamera.includes(config.fundoTirar));
  assert.ok(semCamera.includes(copy.configuracoesDesfocar));
  assert.ok(semCamera.includes(config.maisFundos));
  assert.ok(semCamera.includes(config.inverterImagem), "inverter nao depende da camera no ar");
  const celular = textOf(card(secoes("host", { isMobile: true })));
  assert.ok(!celular.includes(config.desfocar) && !celular.includes(config.maisFundos) && !celular.includes(copy.configuracoesDesfocar));
  assert.ok(celular.includes(config.ruidoLigar), "o resto continua no celular");

  // A camera nunca ligada neste navegador (quem apresenta entra so com o microfone: a lista de cameras vem sem id): no
  // lugar da lista, a frase de liga-la na barra do video (uma frase so, sem a do desfoque); ligada, a lista volta.
  const nuncaLigada = card(secoes("host", { videoOn: false }), { cameraOn: false, devices: aparelhos({ lists: { ...LISTAS, videoInput: [] } }) });
  assert.ok(textOf(nuncaLigada).includes(config.cameraNaBarraDoVideo));
  assert.doesNotMatch(nuncaLigada, /data-live-device="videoInput"/);
  assert.ok(!textOf(nuncaLigada).includes(copy.configuracoesDesfocar) && !textOf(nuncaLigada).includes(config.semAparelho));
  assert.ok(!textOf(card(secoes("host"))).includes(config.cameraNaBarraDoVideo), "com a lista, sem a frase");

  // O navegador que nao troca a saida (Safari): sem a secao Alto-falante, o resto pronto.
  const safari = card(secoes("host", { outputChangeAvailable: false }));
  assert.doesNotMatch(safari, /data-live-device="audioOutput"/);
  assert.match(safari, /data-live-device="audioInput"/);

  // Fora da sala: so a frase de que as escolhas aparecem ao entrar, nenhuma lista.
  const fora = card(secoes("host", { joined: false }));
  assert.ok(textOf(fora).includes(config.foraDaSala));
  assert.doesNotMatch(fora, /<select/);

  // Sem nenhum aparelho listado (o navegador recusou): a frase no lugar da lista.
  assert.ok(textOf(card(secoes("host"), { devices: aparelhos({ lists: { audioInput: [], audioOutput: LISTAS.audioOutput, videoInput: [] } }) })).includes(config.semAparelho));

  // As frases do card pela lista proibida dos Webinarios, sem citar o motor da sala.
  for (const markup of [card(secoes("host")), card(secoes("co_host", { videoOn: false })), card(secoes("host", { joined: false }))]) {
    const lower = textOf(markup).toLocaleLowerCase("pt-BR");
    for (const palavra of PROIBIDAS_WEBINARIO) {
      assert.ok(!lower.includes(palavra), `"${palavra}" no card`);
    }
  }
});

test("fontes do card: os aparelhos pelo useJitsiDevices do console, a troca só com a secao pronta e só de quem apresenta, a engrenagem só de aparelhos pelo papel, o dialogo de fundo pelo toggleVirtualBackgroundDialog e nada de setVideoQuality", () => {
  const panel = stripComments(read(consoleFile("live-room-panel.tsx")));
  assert.match(panel, /useJitsiDevices\(\{[\s\S]*?podeTrocar: \(kind\) => deviceSettingsRef\.current !== null && deviceSectionReady\(deviceSettingsRef\.current, kind\)/);
  assert.match(panel, /deviceSettingsRef\.current = presenter \? deviceSettings : null;/, "so quem apresenta troca");
  assert.match(panel, /chooseDevice = \(kind: DeviceKind, option: DeviceOption\) => presenter && deviceSectionReady\(deviceSettings, kind\) && escolher\(kind, option\)/);
  assert.match(panel, /deviceSettingsFor\(\{[\s\S]*?role,[\s\S]*?videoOn: joined && videoOn/);
  assert.match(panel, /devicesSignalRef\.current\(name, payload\)/, "deviceListChanged e o ruido de volta numa entrada nova");
  assert.match(panel, /useMemo\(\(\) => liveInterfaceConfigOverwrite\(tokenRole, look\), \[tokenRole, look\]\)/, "a engrenagem so de aparelhos depende do papel (e o visual do tema, na montagem)");
  assert.match(panel, /<LiveSettingsCard[\s\S]*?cameraOn=\{handle\.videoOn\}[\s\S]*?onChoose=\{handle\.chooseDevice\}/);
  // Ruido, fundo e espelho sem estado nem reaplicacao: a barra do iframe de quem apresenta tambem os muda.
  assert.match(panel, /useJitsiDevices\(\{[\s\S]*?efeitosNoIframe: true,/);

  const cardSource = stripComments(read(consoleFile("live-settings-card.tsx")));
  assert.match(cardSource, /onClick=\{devices\.maisFundos\}/);
  assert.match(cardSource, /event\.key === "Escape"/);
  for (const source of [panel, cardSource]) {
    assert.doesNotMatch(source, /setVideoQuality|qualidade\(|volume\(|toggleNoiseSuppression/, "quem apresenta nao baixa o proprio palco");
  }
  const hook = stripComments(read("src/components/webinars/use-jitsi-devices.ts"));
  assert.match(hook, /const maisFundos = useCallback\(\(\) => \{\s*executeCommand\("toggleVirtualBackgroundDialog"\);/);
});
