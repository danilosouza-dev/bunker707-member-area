import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
// de live-console-model.ts) e nenhum "Jitsi" em texto de tela.

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto.supabase.co";

const root = new URL("../", import.meta.url);
const srcUrl = new URL("src/", root).href;
const require = createRequire(new URL("package.json", root));
const ts = require("typescript");

const pass = `function pass(props) { const out = {}; for (const [key, value] of Object.entries(props)) { if (key.startsWith("data-") || key.startsWith("aria-") || key === "id" || key === "role") out[key] = value; } return out; }`;
const fail = `const fail = async () => ({ error: "Falhou.", ok: false, status: 500 });`;

const STUBS = {
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

const LIVE_FILES = [
  "session-console.tsx",
  "live-room-panel.tsx",
  "live-controls.tsx",
  "live-hands.tsx",
  "live-participants.tsx",
  "live-recorder.tsx",
  "live-align-chat.tsx",
  "live-attach-recording.tsx"
].map((name) => `src/components/admin/v2/communication/webinars/session-console/${name}`);

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
  const panel = stripComments(read(LIVE_FILES[1]));
  assert.match(panel, /useJitsiMeet\(\{/);
  assert.match(panel, /\/api\/webinars\/\$\{encodeURIComponent\(webinarId\)\}\/join-token/);
  assert.match(panel, /liveConfigOverwrite\(token\.reply\.role, token\.reply\.settings\)/);
  assert.match(panel, /nonce: input\.nonce/);
  assert.match(panel, /tokenRefreshDelayMs\(/, "o token novo antes do exp");
  assert.match(panel, /name === "recordingStatusChanged" && shouldMarkAnchor\(/, "a ancora sai do recordingStatusChanged");
  assert.match(panel, /shouldAutoStartRecording\([\s\S]*?command\("startRecording", \{ mode: "file" \}\)/, "o Gravar da fila dispara sozinho");
  // A moderacao de audio, de tela compartilhada e de video (sem camera de aluno) e o seguir a visao saem de
  // presenterSetupCommands (live-console-model), mandados um a um ao virar moderador.
  assert.match(panel, /presenterSetupCommands\(\{ allowStudentCamera: webinar\.allowStudentCamera !== false, role \}\)\)\s*\{\s*command\(name, \.\.\.args\);/, "os comandos do apresentador ao virar moderador");
  assert.match(panel, /command\("toggleLobby", value\)/);

  const controls = stripComments(read(LIVE_FILES[2]));
  assert.match(controls, /command\("muteEveryone", "audio"\)[\s\S]*?copy\.silenciarTodos/);
  assert.match(controls, /command\("muteEveryone", "video"\)[\s\S]*?copy\.fecharCameras/);
  assert.match(controls, /command\("answerKnockingParticipant", id, true\)/);
  assert.match(controls, /onLock\(!roomLocked\)/);
  assert.match(panel, /command\("toggleModeration", !allowed, "video"\)/, "Permitir câmeras dos alunos");

  const hands = stripComments(read(LIVE_FILES[3]));
  assert.match(hands, /command\("askToUnmute", id\)/);
  assert.match(hands, /command\("muteRemoteParticipant", id, "audio"\)/);
  assert.match(hands, /command\("rejectParticipant", id, "audio"\)/);
  assert.match(hands, /command\("sendEndpointTextMessage", id, lowerHandMessage\(\)\)/);

  const main = stripComments(read(LIVE_FILES[0]));
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

test("frases: os .tsx da live só desenham textos de WEBINAR_COPY ou das provisórias; nenhum texto de tela cita o motor da sala nem as palavras proibidas", () => {
  for (const path of LIVE_FILES.slice(1)) {
    assert.deepEqual(literalTexts(path), [], `${path}: texto solto no JSX`);
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
