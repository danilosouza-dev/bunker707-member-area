import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";

// O console da sessao desenhado (docs/30 §2.4; docs/18 §1.1): o cabecalho com a fase pelo relogio, os presentes e
// Abrir/Encerrar so para quem publica; o seletor de sessoes; o chat com os pendentes (Liberar), Fixar/Desafixar,
// "Aprovar para as próximas turmas" so com o aceite (sem ele, a tela diz por que) e Apagar; o roteiro com o que ja
// entrou e "Soltar agora"; as enquetes com as contagens, Abrir, Encerrar e Compartilhar; as perguntas por voto; a
// sessao encerrada so leitura; sem sessao, o estado vazio. Tambem a pagina e a rota (guardas e migracao pendente).
//
// Os .tsx do app sao transpilados aqui pelo TypeScript (so JSX -> JS). next/image, next/link e next/navigation viram
// stubs; o Dialog e o DropdownMenu viram versoes sem portal; as Server Actions viram funcoes falsas.

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto.supabase.co";

const root = new URL("../", import.meta.url);
const srcUrl = new URL("src/", root).href;
const require = createRequire(new URL("package.json", root));
const ts = require("typescript");

const pass = `function pass(props) { const out = {}; for (const [key, value] of Object.entries(props)) { if (key.startsWith("data-") || key.startsWith("aria-") || key === "id" || key === "role") out[key] = value; } return out; }`;
const fail = `const fail = async () => ({ error: "Falhou.", ok: false, status: 500 });`;

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
export function DropdownMenuRadioGroup({ children, value, ...props }) { return createElement("div", { "data-menu-value": value, role: "group", ...pass(props) }, children); }
export function DropdownMenuRadioItem({ children, closeOnClick, value, ...props }) { return createElement("div", { "data-menu-item": "", "data-value": value, role: "menuitemradio", ...pass(props) }, children); }
export function DropdownMenuItem({ children, disabled, render }) {
  return render ? cloneElement(render, { "data-menu-item": "", role: "menuitem" }, children) : createElement("div", { "aria-disabled": disabled || undefined, "data-menu-item": "", role: "menuitem" }, children);
}`,
  // O replay que vira aula (13/11/2026, docs/30 §6.8): o Publicar replay do menu, os modulos do produto e o cartao do console.
  "@/server/webinars/replay-lesson-actions": `const fail = async () => ({ error: "Falhou.", ok: false, status: 500 });
export const publishWebinarReplay = fail; export const listReplayLessonModules = async () => ({ data: { modules: [] }, ok: true }); export const getReplayLessonSetup = fail; export const saveReplayLessonTarget = fail;`,
  "@/server/webinars/actions": `${fail}
export const saveWebinarDraft = fail; export const publishWebinar = fail; export const cancelWebinar = fail; export const duplicateWebinar = fail; export const deleteWebinar = fail; export const archiveWebinar = fail; export const unarchiveWebinar = fail; export const rescheduleSession = fail; export const uploadWebinarCover = fail;`,
  // As pessoas que comentam (11/11/2026, D75): a lista do Roteiro grava pela propria Server Action.
  "@/server/webinars/persona-actions": `${fail}
export const savePersona = fail; export const deletePersona = fail;`,
  "@/server/webinars/simulation-actions": `${fail}
export const loadSessionSimulations = fail; export const saveSessionSimulation = fail; export const saveSimulatedAudience = fail;`,
  "@/server/webinars/script-actions": `${fail}
export const saveScriptItems = fail; export const importScriptCsv = fail; export const exportScriptCsv = fail; export const exportSessionChatCsv = fail; export const saveTranscript = fail; export const resolveScriptPhrases = fail; export const fireScriptItem = fail; export const sendScriptedComment = fail; export const saveScriptComment = fail; export const uploadPersonaPhoto = fail;`,
  "@/server/webinars/live-actions": `${fail}
export const openLiveRoom = fail; export const startLiveSession = fail; export const endLiveSession = fail; export const setRoomLock = fail; export const prepareRecorder = fail; export const releaseRecorder = fail; export const requestRecording = fail; export const markRecordingAnchor = fail; export const muteInChat = fail; export const kickFromSession = fail; export const undoSessionBan = fail; export const banStudent = fail; export const unbanStudent = fail; export const attachRecording = fail; export const alignChat = fail; export const setBrowserRecording = fail; export const setSelfUnmute = fail;`,
  // Fase 4: os paineis Oferta (4b) e Atendimento (4c) leem pela propria Server Action; aqui viram falhas (o painel
  // fica no "carregando" do desenho do servidor).
  "@/server/webinars/offer-actions": `${fail}
export const loadOfferEditor = fail; export const saveOffer = fail; export const archiveOffer = fail; export const loadOfferConsole = fail; export const showOfferNow = fail; export const hideOffer = fail;`,
  "@/server/webinars/assistant-actions": `${fail}
export const loadAssistantEditor = fail; export const saveAssistant = fail; export const loadAttendanceSnapshot = fail; export const setReplyAll = fail; export const pingAttendant = fail; export const assign = fail; export const editAssistantAnswer = fail;`,
  // Fase 4f: "Refazer tradução" no chat do console.
  "@/server/webinars/translation-actions": `${fail}
export const clearMessageTranslations = fail;`,
  "@/server/webinars/screen-actions": `${fail}
export const saveScreenItem = fail; export const archiveScreenItem = fail; export const uploadScreenImage = fail; export const showScreenItem = fail; export const hideScreenItem = fail; export const showScreenComment = fail; export const hideScreenComment = fail;`,
  "@/server/webinars/room-actions": `${fail}
export const openSessionNow = fail; export const endSessionNow = fail; export const sendTeamMessage = fail; export const moderateMessage = fail; export const setSessionChatMode = fail; export const savePolls = fail; export const launchPoll = fail; export const closePoll = fail; export const pinPoll = fail; export const unpinPoll = fail; export const answerQuestion = fail; export const replyToQuestion = fail; export const deleteQuestionReply = fail; export const setQuestionStatus = fail; export const saveSimulation = fail; export const createReplaySession = fail; export const cancelReplaySession = fail; export const removeStudentMessages = fail;
export const createConsolePoll = fail; export const markQuestionSeen = fail; export const likeQuestionItem = fail; export const setShowPresentCount = fail;`
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
const { ConsoleChat } = await import("../src/components/admin/v2/communication/webinars/session-console/console-chat.tsx");

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
const WEBINAR = "aaaaaaaa-1111-4111-8111-111111111111";
const S_LIVE = "bbbbbbbb-2222-4222-8222-111111111111";
const S_NEXT = "bbbbbbbb-2222-4222-8222-222222222222";
const S_ENDED = "bbbbbbbb-2222-4222-8222-333333333333";

function session(extra = {}) {
  return {
    chatMode: "open",
    chatSlowModeSeconds: null,
    createdAt: "2026-10-28T12:00:00.000Z",
    endedAt: null,
    id: S_LIVE,
    kind: "simulated",
    lateJoinMinutes: null,
    pinnedMessageId: null,
    presenceCurve: null,
    recordingAnchorAt: null,
    recordingId: null,
    scheduledAt: new Date(NOW - 5 * MIN).toISOString(),
    scriptFiredAt: new Date(NOW - 5 * MIN).toISOString(),
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

const sessions = [
  session(),
  session({ id: S_NEXT, scheduledAt: new Date(NOW + 24 * 60 * MIN).toISOString(), scriptFiredAt: null, startedAt: null, status: "scheduled" }),
  session({ endedAt: new Date(NOW - 60 * MIN).toISOString(), id: S_ENDED, scheduledAt: new Date(NOW - 120 * MIN).toISOString(), status: "ended" })
];

function message(extra = {}) {
  return { approved: true, authorUserId: "u-ana", body: "Boa noite!", createdAt: new Date(NOW - 4 * MIN).toISOString(), displayName: "Ana M.", id: "m-ana", kind: "message", master: false, offsetMs: 60_000, pinnedAt: null, promotable: true, replyToId: null, role: "student", scriptItemId: null, sessionId: S_LIVE, source: "audience", webinarId: WEBINAR, ...extra };
}

const messages = [
  message({ approved: false, body: "Posso perguntar?", id: "m-pendente" }),
  message({ authorUserId: "u-bia", body: "Sem aceite", displayName: "Aluno 231", id: "m-sem-aceite", promotable: false }),
  message({ authorUserId: "u-host", body: "Bem-vindos!", displayName: "Produtor T.", id: "m-equipe", pinnedAt: new Date(NOW - 3 * MIN).toISOString(), role: "host", source: "team" }),
  message({ authorUserId: null, body: "Do roteiro", displayName: "Duda", id: "m-roteiro", scriptItemId: "i-a", source: "scripted" })
];

function scriptItem(id, extra = {}) {
  return { body: `Mensagem ${id}`, createdAt: "", generatedByAi: false, id, kind: "message", offsetMs: null, personaName: "Duda", personaRole: "student", phrase: null, phraseDelayMs: 0, position: 0, resolvedOffsetMs: null, resolvedTranscriptId: null, status: "ready", triggerKind: "at_offset", updatedAt: "", webinarId: WEBINAR, ...extra };
}

const poll = (extra = {}) => ({ anonymous: false, closedAt: null, id: "p-1", kind: "single", openOffsetMs: null, openedAt: null, options: [{ id: "o-1", label: "Sim", position: 0 }, { id: "o-2", label: "Não", position: 1 }], position: 0, question: "Vem na próxima?", resultsSharedAt: null, sessionId: null, status: "draft", templatePollId: null, webinarId: WEBINAR, ...extra });

const question = (extra = {}) => ({ anonymous: false, answerText: null, answeredAt: null, answeredBy: null, answeredLive: false, body: "Vai ter replay?", createdAt: new Date(NOW - 2 * MIN).toISOString(), displayName: "Ana M.", id: "q-1", messageId: null, offsetMs: 120_000, sessionId: S_LIVE, status: "open", upvotes: 3, userId: "u-ana", ...extra });

function snapshot(extra = {}) {
  return {
    askedMessageIds: [],
    messages,
    pinnedMessageId: "m-equipe",
    polls: {
      launched: [poll({ counts: { answers: 3, byOption: { "o-1": 2, "o-2": 1 } }, id: "p-copia", openedAt: new Date(NOW - MIN).toISOString(), sessionId: S_LIVE, status: "open", templatePollId: "p-1" })],
      // Legado: um modelo de antes de 10/11/2026 ainda marcado como anonimo (D64): a lista nao anuncia mais a marca.
      templates: [poll(), poll({ anonymous: true, id: "p-2", kind: "multiple", question: "Quais temas?" })]
    },
    presentNow: 7,
    questions: [question({ id: "q-respondida", answerText: "Sim, 7 dias.", answeredAt: new Date(NOW - MIN).toISOString(), status: "answered", upvotes: 9 }), question(), question({ body: "Anônima aqui", anonymous: true, id: "q-dispensada", status: "dismissed", upvotes: 1 }), question({ body: "Mais votada", id: "q-top", upvotes: 5 })],
    scriptFired: { "i-a": new Date(NOW - 4 * MIN).toISOString() },
    scriptItems: [scriptItem("i-a", { offsetMs: 60_000 }), scriptItem("i-b", { offsetMs: 10 * MIN }), scriptItem("i-m", { personaRole: "team", triggerKind: "manual" }), scriptItem("i-off", { offsetMs: 1000, status: "disabled" })],
    serverTime: new Date(NOW).toISOString(),
    session: session(),
    ...extra
  };
}

const webinar = { durationMinutes: 60, hostUserId: "u-host", id: WEBINAR, kind: "simulated", recordingDurationSeconds: 3600, slug: "aula-de-ia", title: "Aula de IA" };
const both = { canPublish: true, canWrite: true };

function render(data, permissions = both) {
  return html(createElement(SessionConsole, { currentUserId: "u-host", data, permissions, serverNow: NOW }));
}

test("topo (docs/31 V2-13 e §10): a raiz com o tema escuro, a seta de voltar ao editor, o titulo com a linha de baixo, o momento e os presentes, Encerrar sessão (so para quem publica); o seletor lista as sessoes sem o ano e com a situacao em minuscula", () => {
  const markup = render({ sessions, snapshot: snapshot(), webinar });
  const text = textOf(markup);

  // A raiz do console: o tema (escuro antes de ler o navegador) e a ponte dos tokens do admin no mesmo elemento.
  assert.match(markup, /^<div(?=[^>]*data-console-root="")(?=[^>]*data-room-theme="dark")[^>]*>/, "a raiz com o tema e a ponte");
  assert.equal(count(markup, /data-room-theme=/g), 1, "um tema so, o da raiz");
  assert.match(markup, /<div data-console-portal=""><\/div>/, "o portal das confirmacoes e dos menus dentro da raiz");
  // O topo sem a trilha (o topo da sala no estilo do YouTube, docs/31 §10): a seta (o circulo sem fundo, so o icone, com
  // o nome e a dica) leva ao editor; o h1 e o nome do webinario e, embaixo, a linha "Console da sessão" com o momento e
  // os presentes da gravada.
  assert.doesNotMatch(text, /Webinários \/ Aula de IA \/ Console/, "a trilha saiu");
  assert.match(markup, /<a aria-label="Voltar ao editor" class="[^"]*\brounded-full\b[^"]*" href="\/admin\/comunicacao\/webinarios\/aaaaaaaa-1111-4111-8111-111111111111"/, "a seta de voltar ao editor");
  const h1 = markup.slice(markup.indexOf("<h1"), markup.indexOf("</h1>"));
  assert.equal(textOf(`${h1}</h1>`), "Console da sessão: Aula de IA", "o h1 com o console (so para o leitor de tela) e o titulo");
  assert.match(h1, /<span class="sr-only">Console da sessão: <\/span>Aula de IA$/, "na tela, so o nome do webinario");
  assert.match(h1, /\blg:text-xl\b/, "o titulo em 20/28 a partir de lg");
  const linhaDeBaixo = textOf(markup.slice(markup.indexOf(">", markup.indexOf("data-console-line")) + 1, markup.indexOf("</p>", markup.indexOf("data-console-line"))));
  assert.match(linhaDeBaixo, /^Console da sessão · No ar há \d+:\d\d · 7 presentes$/, `a linha de baixo: ${linhaDeBaixo}`);
  // Os presentes sao o botao que abre a Presença (a chave do numero de pessoas, rodada v12, docs/30 D107).
  assert.match(markup, /<button aria-label="7 presentes\. Abrir a Presença"[^>]*data-console-present=""[^>]*>7 presentes</, "os presentes na linha da gravada, sem o pico antes da leitura da presenca");
  assert.doesNotMatch(markup.slice(markup.lastIndexOf("<span", markup.indexOf("data-console-present")), markup.indexOf("data-console-present")), /sm:hidden/, "fora da live (sem palco) os presentes ficam no topo em toda largura");
  assert.match(text, /Encerrar sessão/);
  assert.doesNotMatch(text, /Abrir sessão/, "a sessao no ar nao abre de novo");
  assert.match(markup, /<button(?=[^>]*aria-label="Tema claro")[^>]*>/, "o Tema diz para qual vai");
  assert.match(markup, /<button(?=[^>]*aria-label="Atualizar")[^>]*>/);
  assert.match(markup, /<span aria-live="polite" class="sr-only" data-console-polling="idle"><\/span>/, "a leitura so para o leitor de tela");
  // A segunda linha do topo (o seletor e os botoes): abaixo de lg rola de lado sem barra; a partir de lg fica inteira
  // (sem rolagem, que cortaria as dicas dos botoes) e quem encolhe e o titulo, com reticencias.
  const linha = (markup.match(/data-console-slot="top"[\s\S]*?<\/p><\/div><\/div><div class="([^"]*)"/)?.[1] ?? "").split(" ");
  assert.ok(linha.includes("max-lg:overflow-x-auto"), "a linha rola de lado abaixo de lg");
  assert.ok(linha.includes("max-lg:[scrollbar-width:none]"), "sem barra abaixo de lg");
  assert.ok(linha.includes("lg:shrink-0"), "a partir de lg a linha fica inteira");
  assert.ok(!linha.includes("overflow-x-auto"), "a partir de lg nao rola");
  // O seletor de sessoes numa pilula tonal do YouTube; o Tema sempre o ultimo.
  // (a pilula e a caixa de fora, com o anel de foco so pelo teclado; o <select> nativo vai dentro, sem contorno proprio).
  // Com a sessao no ar, o ponto verde fica por cima do <select> (sem pegar o clique), e o <select> e a pilula inteira.
  const pilula = markup.match(/<div class="([^"]*)">(?:<span class="([^"]*)"><span aria-hidden="true" class="[^"]*\bbg-room-speaking\b[^"]*" data-console-on-air=""><\/span><\/span>)?<label class="sr-only" for="console-session">Sessão<\/label><select class="([^"]*)" data-own-focus="" id="console-session"/);
  assert.ok(pilula, "a pilula com o rotulo escondido e o select dentro");
  for (const classe of ["rounded-full", "bg-room-control", "h-10", "text-sm", "has-[select:focus-visible]:outline-room-focus", "max-w-72"]) {
    assert.ok(pilula[1].replace(/&amp;/g, "&").split(" ").includes(classe), `a pilula do seletor tem ${classe}`);
  }
  for (const classe of ["appearance-none", "bg-transparent", "outline-none"]) {
    assert.ok(pilula[3].split(" ").includes(classe), `o select tem ${classe}`);
  }
  assert.ok(!pilula[1].split(" ").some((classe) => /^pl-/.test(classe)), "com a sessao no ar a pilula nao tem recuo proprio: o select comeca na borda esquerda");
  for (const classe of ["pointer-events-none", "absolute"]) {
    assert.ok((pilula[2] ?? "").split(" ").includes(classe), `o ponto verde fica por cima, sem pegar o clique (${classe})`);
  }
  for (const classe of ["rounded-full", "pl-7"]) {
    assert.ok(pilula[3].split(" ").includes(classe), `o select e a pilula inteira, com o recuo que abre o lugar do ponto (${classe})`);
  }
  assert.ok(markup.indexOf('aria-label="Tema claro"') > markup.indexOf("Encerrar sessão"), "o Tema por ultimo");

  const select = markup.slice(markup.indexOf('id="console-session"'), markup.indexOf("</select>"));
  assert.match(markup, /<label class="sr-only" for="console-session">Sessão<\/label>/, "o nome do seletor so para o leitor de tela");
  assert.equal(count(select, /<option/g), 3, "as tres sessoes no seletor");
  assert.match(select, new RegExp(`<option value="${S_LIVE}" selected=""`), "a sessao pedida vem marcada");
  assert.deepEqual(
    Array.from(select.matchAll(/<option[^>]*>([^<]*)<\/option>/g)).map((match) => match[1]),
    ["Sessão de 5/11 às 20:00 · no ar", "Sessão de 6/11 às 20:05 · agendada", "Sessão de 5/11 às 18:05 · encerrada"],
    "sem o ano e com a situacao gravada em minuscula"
  );
  assert.match(markup, /data-console-on-air=""/, "o ponto verde com a sessao escolhida no ar");

  const soEscreve = textOf(render({ sessions, snapshot: snapshot(), webinar }, { canPublish: false, canWrite: true }));
  assert.doesNotMatch(soEscreve, /Encerrar sessão|Abrir sessão/, "sem messaging.publish nao abre nem encerra");

  const agendadaMarkup = render({ sessions, snapshot: snapshot({ session: sessions[1] }), webinar });
  const agendada = textOf(agendadaMarkup);
  assert.match(agendada, /Abrir sessão/);
  assert.match(agendada, /Começa em/);
  assert.doesNotMatch(agendada, /Encerrar sessão/);
  assert.doesNotMatch(agendadaMarkup, /data-console-on-air=""/, "sem o ponto com a sessao escolhida fora do ar");
  // Fora do ar, o mesmo: o select e a pilula inteira, com o recuo da pilula.
  const foraDoAr = agendadaMarkup.match(/<div class="([^"]*)"><label class="sr-only" for="console-session">Sessão<\/label><select class="([^"]*)"/);
  assert.ok(foraDoAr, "a pilula fora do ar");
  assert.ok(!foraDoAr[1].split(" ").some((classe) => /^pl-/.test(classe)));
  for (const classe of ["rounded-full", "pl-4"]) {
    assert.ok(foraDoAr[2].split(" ").includes(classe), `o select fora do ar tem ${classe}`);
  }
});

/** O item de uma mensagem no chat do console (o card da pendente ou o balao da lista), do <li> ao </li>. */
const chatItem = (markup, id) => {
  const at = markup.lastIndexOf("<li", markup.indexOf(`data-room-message="${id}"`));
  assert.ok(at >= 0, `a mensagem ${id} no chat`);
  return markup.slice(at, markup.indexOf("</li>", at) + 5);
};
/** A linha do autor do comentario (docs/31 §10): o nome, o selo e a hora, cada pedaco no seu elemento, juntos com " · ". */
const chatMeta = (item) => {
  const at = item.indexOf("data-room-message-meta");
  const block = item.slice(item.indexOf(">", at) + 1, item.indexOf("</p>", at));
  return Array.from(block.matchAll(/>([^<>]+)</g))
    .map((match) => match[1].trim())
    .filter(Boolean)
    .join(" · ");
};
/** A linha de cima do comentario (Fixada, Nas próximas turmas), so o texto; vazia sem ela. */
const chatHeadline = (item) => {
  const meta = item.indexOf("data-room-message-meta");
  const head = item.slice(0, item.lastIndexOf("<p", meta)).match(/<p class="flex items-center gap-1\.5[^"]*">([\s\S]*)<\/p>$/);
  return head ? textOf(head[1]) : "";
};
/** O <select> de um seletor compacto do cabecalho, da tag ao </select>. */
const selectOf = (markup, id) => markup.slice(markup.lastIndexOf("<select", markup.indexOf(`id="${id}"`)), markup.indexOf("</select>", markup.indexOf(`id="${id}"`)));

test("chat (docs/31 V2-15): Quem escreve e Modo lento em dois seletores compactos com o rotulo visivel (o modo lento desligado com o chat desligado) e '1 aguardando'; a pendente num card ambar com Liberar, Recusar e Virar pergunta; a lista em role=log so com as liberadas", () => {
  const markup = render({ sessions, snapshot: snapshot(), webinar });
  const chat = pane(markup, "tab", "chat");

  // Os seletores compactos: o rotulo visivel ligado ao <select> nativo, os mesmos valores de antes, sem as pilulas.
  assert.match(chat, /<label[^>]*for="console-chat-mode">Quem escreve:<\/label><select(?=[^>]*id="console-chat-mode")[^>]*>/);
  assert.match(chat, /<label[^>]*for="console-slow-mode">Modo lento:<\/label><select(?=[^>]*id="console-slow-mode")[^>]*>/);
  assert.deepEqual(Array.from(selectOf(chat, "console-chat-mode").matchAll(/<option value="([^"]+)"[^>]*>([^<]+)</g)).map((match) => `${match[1]}=${match[2]}`), ["open=Aberto", "moderated=Moderado", "team_only=Só a equipe", "off=Desligado"]);
  assert.match(selectOf(chat, "console-chat-mode"), /<option value="open" selected="">/);
  assert.deepEqual(Array.from(selectOf(chat, "console-slow-mode").matchAll(/<option value="([^"]+)"/g)).map((match) => match[1]), ["off", "10", "20", "30", "60"]);
  assert.doesNotMatch(selectOf(chat, "console-slow-mode"), /^<select[^>]*disabled=""/);
  assert.doesNotMatch(chat, /role="radiogroup"|Quem pode escrever/, "sem as pilulas nem o rotulo de antes");
  const desligado = pane(render({ sessions, snapshot: snapshot({ session: session({ chatMode: "off" }) }), webinar }), "tab", "chat");
  assert.match(selectOf(desligado, "console-chat-mode"), /<option value="off" selected="">/);
  assert.match(selectOf(desligado, "console-slow-mode"), /^<select[^>]*disabled=""/, "o modo lento desligado com o chat desligado");
  assert.match(chat, /data-console-chat-waiting="">1 aguardando</, "quantas esperam a equipe, no cabecalho");
  // O corpo do painel corta a partir de lg e o cabecalho do chat e o primeiro filho: o anel de foco das pilulas precisa de 4 px em cima.
  assert.ok((markup.match(/<div class="([^"]*)" data-console-panel-body="">/)?.[1] ?? "").split(" ").includes("lg:overflow-y-auto"), "o corpo corta a partir de lg");
  assert.ok((chat.match(/<div class="([^"]*)" data-console-chat-header="">/)?.[1] ?? "").split(" ").includes("lg:pt-1"), "4 px acima das pilulas a partir de lg: o anel de foco inteiro");
  // O rotulo visivel (Quem escreve, Modo lento): a pilula com o recuo dela, o rotulo na tela e o select ate a borda direita.
  const visivel = chat.match(/<div class="([^"]*)"><label class="[^"]*" for="console-chat-mode">Quem escreve:<\/label><select class="([^"]*)"/);
  assert.ok(visivel, "o seletor com o rotulo visivel");
  assert.ok(visivel[1].split(" ").includes("pl-3"));
  assert.ok(visivel[2].split(" ").includes("rounded-r-full"));

  // A pendente sai da lista e vira o card ambar no topo: "Na moderação · nome · hora", o texto e os tres botoes.
  const pendente = chatItem(chat, "m-pendente");
  assert.match(pendente, /^<li class="[^"]*\bbg-room-warn-bg\b[^"]*" data-console-pending=""/);
  assert.match(pendente, /<p class="[^"]*\btext-room-warn-fg\b[^"]*">Na moderação · Ana M\. · 20:01<\/p>/, "a hora da gravada: a hora marcada mais o offset");
  // E o ⋯ com os itens da pessoa (a moderacao por pessoa na Live gravada, a Na tela, R5).
  assert.deepEqual(Array.from(pendente.matchAll(/<button[^>]*aria-label="([^"]+)"/g)).map((match) => match[1]), ["Liberar: Ana M.", "Recusar: Ana M.", "Virar pergunta: Ana M.", "Mais ações da mensagem de Ana M."]);
  assert.ok(chat.indexOf("data-console-chat-queue") < chat.indexOf('role="log"'), "o card antes da lista");
  assert.ok(chat.indexOf('data-room-message="m-pendente"') < chat.indexOf('role="log"'), "a pendente fora da lista");

  // Mais velha primeiro; a pergunta que o aluno fez pelo chat moderado fica so com Liberar e Recusar (o Liberar ja a abre).
  const fila = pane(
    render({ sessions, snapshot: snapshot({ messages: [message({ approved: false, body: "Nova", createdAt: new Date(NOW - MIN).toISOString(), id: "m-nova" }), message({ approved: false, body: "Vai ter replay?", createdAt: new Date(NOW - 3 * MIN).toISOString(), id: "m-pergunta", kind: "question" })] }), webinar }),
    "tab",
    "chat"
  );
  assert.deepEqual(Array.from(fila.matchAll(/data-console-pending="" data-room-message="([^"]+)"/g)).map((match) => match[1]), ["m-pergunta", "m-nova"]);
  assert.match(fila, /data-console-chat-waiting="">2 aguardando</);
  assert.deepEqual(Array.from(chatItem(fila, "m-pergunta").matchAll(/<button[^>]*aria-label="([^"]+)"/g)).map((match) => match[1]), ["Liberar: Ana M.", "Recusar: Ana M.", "Mais ações da mensagem de Ana M."]);
  assert.match(fila, /<li[^>]*>Nenhuma mensagem ainda\.<\/li>/, "so pendentes: a lista vazia");

  // A lista: a caixa que rola e o role=log com o nome Chat; dentro dela a <ol> continua lista (o role=log na propria <ol>
  // tirava dela o papel de lista, e os itens ficavam sem lista), so com as liberadas, cada uma no balao.
  assert.match(chat, /<div aria-label="Chat"[^>]*data-console-chat=""[^>]*role="log"><ol class="[^"]*">/);
  assert.doesNotMatch(chat, /<ol[^>]*role="log"/, "a <ol> sem o papel de log");
  // Sem leitura automatica: quem modera le a lista, e cada mensagem nova chegaria lida junto com os botoes dela.
  assert.match(chat, /<div aria-label="Chat" aria-live="off"[^>]*role="log"/);
  const log = chat.slice(chat.indexOf('role="log"'));
  assert.deepEqual(Array.from(log.matchAll(/data-room-message="([^"]+)"/g)).map((match) => match[1]), ["m-sem-aceite", "m-equipe", "m-roteiro"]);
  const logClasses = chat.match(/<div aria-label="Chat" aria-live="off" class="([^"]*)"/)?.[1].split(" ") ?? [];
  assert.ok(logClasses.includes("lg:flex-1") && logClasses.includes("lg:min-h-0") && logClasses.includes("overflow-y-auto"), "a partir de lg a lista enche a aba e rola por dentro");
  assert.ok(logClasses.includes("max-lg:max-h-[60vh]") && !logClasses.includes("max-h-[60vh]"), "o teto de 60vh so abaixo de lg, com a pagina rolando");
  assert.match(pane(markup, "tab", "chat"), /^<div[^>]*class="[^"]*\blg:flex-1\b[^"]*"[^>]*data-console-tab="chat"/, "a aba do Chat enche o corpo do painel");

  // Sem nenhuma pendente, nem o card nem o "aguardando".
  const semPendente = pane(render({ sessions, snapshot: snapshot({ messages: messages.filter((item) => item.approved) }), webinar }), "tab", "chat");
  assert.doesNotMatch(semPendente, /data-console-chat-queue|data-console-chat-waiting/);
});

test("chat (docs/31 V2-9 e §10): o comentario do YouTube com o nome, o selo do papel ou da origem e a hora, a minha com Você, a origem so para a equipe, Fixada e Nas próximas turmas em cima (fora da live); na live a hora gravada e sem o selo das proximas turmas", () => {
  const mestre = message({ authorUserId: "u-bruna", body: "Da turma passada", displayName: "Bruna S.", id: "m-mestre", master: true, source: "original" });
  const personaHost = message({ authorUserId: null, body: "Sou do roteiro", displayName: "Rafa", id: "m-roteiro-host", role: "host", scriptItemId: "i-b", source: "scripted" });
  const markup = render({ sessions, snapshot: snapshot({ messages: [...messages, mestre, personaHost] }), webinar });
  const chat = pane(markup, "tab", "chat");

  assert.equal(chatMeta(chatItem(chat, "m-sem-aceite")), "Aluno 231 · 20:01", "o aluno sem papel; a hora marcada mais o offset");
  assert.equal(chatMeta(chatItem(chat, "m-roteiro")), "Duda · Roteiro · 20:01", "a origem do roteiro, so para a equipe");
  // Papel ou origem: a persona do roteiro com o papel de quem apresenta diz so Roteiro, na linha e no leitor de tela.
  assert.equal(chatMeta(chatItem(chat, "m-roteiro-host")), "Rafa · Roteiro · 20:01");
  assert.match(chatItem(chat, "m-roteiro-host"), /<span class="sr-only">Rafa, Roteiro, 20:01: <\/span>Sou do roteiro/);
  assert.equal(chatMeta(chatItem(chat, "m-mestre")), "Bruna S. · Chat original · 20:01");
  assert.equal(chatHeadline(chatItem(chat, "m-mestre")), "Nas próximas turmas", "o selo das proximas turmas na linha de cima");
  // A minha (o autor e quem esta no console): "Você" com o selo do papel e a hora, como as outras, a esquerda (o
  // comentario do YouTube nao vira de lado), e a fixada diz Fixada na linha de cima.
  const minha = chatItem(chat, "m-equipe");
  assert.match(minha, /^<li class="[^"]*" data-mine="" data-room-message="m-equipe">/);
  assert.doesNotMatch(minha, /flex-row-reverse/);
  assert.equal(chatMeta(minha), "Você · Apresentador · 20:01");
  assert.equal(chatHeadline(minha), "Fixada");
  assert.equal(chatHeadline(chatItem(chat, "m-sem-aceite")), "", "sem fixar nem passar para as proximas turmas, sem a linha de cima");
  assert.match(minha, /<span class="sr-only">Você, Apresentador, 20:01: <\/span>Bem-vindos!/, "o leitor de tela ouve o autor antes do texto");
  assert.equal(count(chat, /data-mine=""/g), 1, "so a minha");
  assert.doesNotMatch(chat, /data-room-message-meta="">[\s\S]{0,200}1:00</, "a hora, nunca o minuto do video");

  // Na live: a hora em que o servidor gravou (20:42), e toda mensagem nasce na linha mestre (D31): sem o selo.
  const ao = (extra) => message({ createdAt: "2026-11-05T23:42:00.000Z", ...extra });
  const live = session({ kind: "live" });
  const liveMarkup = render({
    sessions: [live],
    snapshot: snapshot({
      messages: [
        ao({ id: "m-live", master: true }),
        ao({ id: "m-live-equipe", master: true, role: "team", source: "team", authorUserId: "u-bia", displayName: "Bia E." }),
        ao({ id: "m-live-co", master: true, role: "co_host", source: "team", authorUserId: "u-rui", displayName: "Rui P." })
      ],
      session: live
    }),
    webinar: { ...webinar, kind: "live" }
  });
  const liveChat = pane(liveMarkup, "tab", "chat");
  assert.equal(chatMeta(chatItem(liveChat, "m-live")), "Ana M. · 20:42");
  assert.equal(chatMeta(chatItem(liveChat, "m-live-equipe")), "Bia E. · Equipe · 20:42");
  // O co-apresentador com o papel proprio (V2-A12), como na sala, na linha e no leitor de tela.
  assert.equal(chatMeta(chatItem(liveChat, "m-live-co")), "Rui P. · Co-apresentador · 20:42");
  assert.match(chatItem(liveChat, "m-live-co"), /<span class="sr-only">Rui P\., Co-apresentador, 20:42: <\/span>/);
  assert.doesNotMatch(textOf(liveChat), /Nas próximas turmas/, "na live o selo sairia em todas");

  // No Replay, nenhuma hora.
  const replay = session({ kind: "replay", status: "live" });
  const replayChat = pane(render({ sessions: [replay], snapshot: snapshot({ session: replay }), webinar }), "tab", "chat");
  assert.equal(chatMeta(chatItem(replayChat, "m-sem-aceite")), "Aluno 231");
});

test("chat (docs/31 V2-15 e §10): as acoes de cada mensagem (Fixar ou Desafixar, Virar pergunta, Apagar) em circulos de 32 px numa pilula por cima do item, que aparece com o mouse ou o foco e fica sempre no toque; o ⋮ com Aprovar para as próximas turmas (sem aceite, o porque); o campo Escreva para a turma", () => {
  const promovivel = message({ authorUserId: "u-caio", body: "Com aceite", displayName: "Caio R.", id: "m-com-aceite" });
  const virou = message({ authorUserId: "u-dani", body: "Ja perguntou", displayName: "Dani P.", id: "m-virou" });
  // A que ja virou pergunta vem no askedMessageIds do retrato (apagada ou nao, sem o teto da lista das perguntas).
  const markup = render({ sessions, snapshot: snapshot({ askedMessageIds: ["m-virou"], messages: [...messages, promovivel, virou], questions: [] }), webinar });
  const chat = pane(markup, "tab", "chat");
  const linha = (id) => {
    const item = chatItem(chat, id);
    return item.slice(item.indexOf("data-console-message-actions"));
  };
  const nomes = (block) => Array.from(block.matchAll(/<button[^>]*aria-label="([^"]+)"/g)).map((match) => match[1]);

  assert.deepEqual(nomes(linha("m-com-aceite")), ["Fixar: Caio R.", "Virar pergunta: Caio R.", "Apagar: Caio R.", "Mais ações da mensagem de Caio R."]);
  assert.match(textOf(linha("m-com-aceite")), /Aprovar para as próximas turmas/, "no ⋯");
  assert.deepEqual(nomes(linha("m-sem-aceite")), ["Fixar: Aluno 231", "Virar pergunta: Aluno 231", "Apagar: Aluno 231", "Mais ações da mensagem de Aluno 231"]);
  assert.match(textOf(linha("m-sem-aceite")), /Sem consentimento do aluno/, "sem o aceite, o ⋯ diz por que");
  assert.doesNotMatch(textOf(linha("m-sem-aceite")), /Aprovar para as próximas turmas/);
  assert.deepEqual(nomes(linha("m-virou")), ["Fixar: Dani P.", "Apagar: Dani P.", "Mais ações da mensagem de Dani P."], "a que ja virou pergunta fica sem o botao");
  // A equipe e o roteiro: sem Virar pergunta (a pergunta pede o aluno); o ⋯ so com o "Mostrar na tela" (rodada v9,
  // docs/30 D89: toda mensagem liberada pode ir para a tela).
  assert.deepEqual(nomes(linha("m-equipe")), ["Desafixar: Produtor T.", "Apagar: Produtor T.", "Mais ações da mensagem de Produtor T."]);
  assert.deepEqual(nomes(linha("m-roteiro")), ["Fixar: Duda", "Apagar: Duda", "Mais ações da mensagem de Duda"]);
  assert.match(textOf(linha("m-roteiro")), /Mostrar na tela/);
  assert.doesNotMatch(textOf(linha("m-roteiro")), /Aprovar para as próximas turmas|Sem consentimento/);
  assert.match(textOf(linha("m-com-aceite")), /Mostrar na tela Aprovar para as próximas turmas/, "o Mostrar na tela e o primeiro do ⋯");
  // Cada botao da linha e do card e um ponto de volta do foco (a posicao entre os do item): o ⋯ e o ultimo.
  const marcados = (block) => Array.from(block.matchAll(/<button(?=[^>]*data-console-action="")[^>]*aria-label="([^"]+)"/g)).map((match) => match[1]);
  assert.deepEqual(marcados(linha("m-com-aceite")), nomes(linha("m-com-aceite")));
  assert.deepEqual(marcados(chatItem(chat, "m-pendente")), ["Liberar: Ana M.", "Recusar: Ana M.", "Virar pergunta: Ana M.", "Mais ações da mensagem de Ana M."]);

  // Os botoes: circulos de 32 px (o toque ganha a area de 44, after:-inset-1.5). Com o mouse, as acoes ficam escondidas
  // (sem lugar na linha) e aparecem com o mouse, o foco ou o ⋮ aberto, numa pilula por cima do canto de cima a direita do
  // item (tambem na minha); na tela de toque, sempre na tela, no fim da linha.
  const acoesDe = (id) => chatItem(chat, id).match(/<span class="([^"]*)" data-console-message-actions="">/)?.[1].split(" ") ?? [];
  const acoes = acoesDe("m-com-aceite");
  for (const classe of ["pointer-fine:opacity-0", "pointer-fine:group-hover:opacity-100", "pointer-fine:group-focus-within:opacity-100", "pointer-fine:has-[[data-popup-open]]:opacity-100", "pointer-fine:absolute", "pointer-fine:right-0", "pointer-fine:bg-room-menu"]) {
    assert.ok(acoes.includes(classe), classe);
  }
  assert.ok(!acoes.includes("opacity-0"), "no toque, sempre a mostra");
  assert.ok(acoesDe("m-equipe").includes("pointer-fine:right-0"), "a minha: as acoes no mesmo canto");
  assert.match(chatItem(chat, "m-com-aceite"), /^<li class="[^"]*\bgroup\b[^"]*\brelative\b/, "o item e o grupo e a referencia das acoes");
  for (const [, classes] of linha("m-com-aceite").matchAll(/<button[^>]*class="([^"]*)"/g)) {
    assert.ok(classes.split(" ").includes("size-8") && classes.split(" ").includes("rounded-full"), `32 px e redondo: ${classes}`);
  }

  // O campo do YouTube: o textarea com o nome e o texto de exemplo, livre fora do envio; o Enviar so com o campo aberto.
  assert.match(chat, /<textarea(?=[^>]*aria-label="Escreva para a turma")(?=[^>]*id="console-composer")(?=[^>]*placeholder="Escreva para a turma")[^>]*>/);
  assert.doesNotMatch(chat, /<button[^>]*type="submit"[^>]*>Enviar<\/button>/, "fechado, sem o rodape com o Enviar");
  assert.doesNotMatch(chat.match(/<textarea[^>]*id="console-composer"[^>]*>/)?.[0] ?? "", /\s(?:readOnly|disabled)=""/i, "fora do envio, o campo livre");
});

test("caixa da equipe durante o envio (docs/31 V2-15 e §10, WCAG 2.4.3): o campo nunca fica desligado pelo envio (desligado, o foco do Enter cairia no comeco da pagina; o Enter de novo fica parado pelo composerKey); sem poder agir, desligado", () => {
  const props = {
    askedMessageIds: [],
    busyKey: "send",
    canAct: true,
    currentUserId: "u-host",
    hostUserId: "u-host",
    messages,
    onChatMode() {},
    onModerate() {},
    onSend: async () => true,
    pinnedMessageId: null,
    session: session()
  };
  const campo = (markup) => markup.match(/<textarea[^>]*id="console-composer"[^>]*>/)?.[0] ?? "";
  const enviando = html(createElement(ConsoleChat, props));
  assert.doesNotMatch(campo(enviando), /\sdisabled=""/, "nunca desligado so pelo envio: o foco continua no campo");
  // Outra acao da mesa em andamento nao mexe no campo.
  assert.doesNotMatch(campo(html(createElement(ConsoleChat, { ...props, busyKey: "moderate:m-ana" }))), /\s(?:readOnly|disabled)=""/i);
  const semAcao = campo(html(createElement(ConsoleChat, { ...props, busyKey: null, canAct: false })));
  assert.match(semAcao, /\sdisabled=""/, "a sessao que nao aceita a equipe desliga o campo");
});

test("D82: ao lado de Escreva para a turma, a foto do Perfil de quem esta no console ou as iniciais do nome dele (nunca so o icone); o icone da equipe so sem o nome", () => {
  const props = { askedMessageIds: [], busyKey: null, canAct: true, currentUserId: "u-host", hostUserId: "u-host", messages, onChatMode() {}, onModerate() {}, onSend: async () => true, pinnedMessageId: null, session: session() };
  /** O avatar da linha do campo: o primeiro filho da linha, antes da coluna do textarea. */
  const avatarDoCampo = (markup) => {
    const linha = markup.indexOf('<div class="mr-4 flex items-start">');
    assert.ok(linha >= 0 && markup.indexOf('id="console-composer"', linha) > linha, "a linha do campo da equipe");
    return markup.slice(linha, markup.indexOf('<div class="ml-3 min-w-0 flex-1">', linha));
  };
  const FOTO = "https://projeto.supabase.co/storage/v1/object/public/content-assets/avatars/u-host/danilo.webp";

  const iniciais = avatarDoCampo(html(createElement(ConsoleChat, { ...props, currentUserName: "Danilo S." })));
  assert.match(iniciais, /<span aria-hidden="true" class="[^"]*\bsize-6\b[^"]*"><span[^>]*>DS<\/span><\/span>/, "sem foto, as iniciais no avatar de 24");
  assert.doesNotMatch(iniciais, /lucide-users-round|<img/, "nem o icone da equipe, nem foto");

  const foto = avatarDoCampo(html(createElement(ConsoleChat, { ...props, currentUserAvatarUrl: FOTO, currentUserName: "Danilo S." })));
  assert.match(foto, new RegExp(`<img[^>]*src="${FOTO.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"`), "com foto, a foto");
  assert.doesNotMatch(foto, />DS</);

  // Sem o nome (quem chama sem o viewer), o icone da equipe, como antes.
  assert.match(avatarDoCampo(html(createElement(ConsoleChat, props))), /lucide-users-round/);
});

test("roteiro: a fila com o que entrou, Soltar agora so no que falta e no manual, a desligada sem botao, o resumo; enquetes e perguntas, cada um no painel dele (o Roteiro e as Enquetes no ⋯, as Perguntas na aba), montado e escondido", () => {
  const markup = render({ sessions, snapshot: snapshot(), webinar });
  const text = textOf(markup);
  // A gravada (docs/31 V2-15): as abas Chat e Perguntas; o ⋯ com Enquetes, Roteiro, Oferta, Atendimento e, desde a
  // rodada v12 (docs/30 D107), a Presença tambem sem a leitura dela (a chave do numero de pessoas); tudo montado, so o
  // Chat na tela, e sem o X (sem palco o painel nunca fecha).
  assert.deepEqual(Array.from(markup.matchAll(/role="tab"[^>]*>([^<]+)</g)).map((match) => match[1]), ["Chat", "Perguntas 2"]);
  assert.deepEqual(Array.from(markup.matchAll(/data-console-more="([a-z]+)"/g)).map((match) => match[1]), ["tela", "enquetes", "roteiro", "oferta", "atendimento", "presenca"]);
  assert.ok(!hiddenPane(pane(markup, "tab", "chat")), "o Chat na tela");
  for (const [kind, name] of [["tab", "perguntas"], ["more", "enquetes"], ["more", "roteiro"], ["more", "oferta"], ["more", "atendimento"]]) {
    assert.ok(hiddenPane(pane(markup, kind, name)), `${name} escondido`);
  }
  assert.doesNotMatch(markup, /Fechar o painel/);
  const roteiro = pane(markup, "more", "roteiro");
  assert.match(roteiro, /^<section aria-label="Roteiro"/);
  assert.equal(count(roteiro, /data-script-fired="true"/g), 1, "o roteiro na entrada Roteiro");
  assert.match(pane(markup, "more", "enquetes"), /data-console-polls-templates/, "as enquetes na entrada Enquetes");
  assert.match(pane(markup, "tab", "perguntas"), /data-console-questions/, "as perguntas na aba Perguntas");

  assert.match(text, /1 entrou · 1 a caminho · 1 pelo botão/);
  assert.equal(count(markup, /data-script-fired="true"/g), 1);
  assert.equal(count(markup, />Soltar agora</g), 2, "o item por minuto que falta e o manual");
  assert.match(text, /Entrou/);
  assert.match(text, /Pelo botão/);
  assert.match(text, /Desligada/);
  assert.match(text, /10:00/, "o minuto do item que falta");

  assert.match(text, /Nesta sessão/);
  assert.match(text, /Aberta/);
  assert.match(text, /3 respostas/);
  assert.match(text, /Sim 2 · 67%/);
  assert.match(text, /Não 1 · 33%/);
  assert.match(text, /Encerrar/);
  assert.match(text, /Compartilhar resultado/);
  const templates = markup.slice(markup.indexOf("data-console-polls-templates"));
  assert.equal(count(templates, />Abrir</g), 1, "o modelo ja aberto nesta sessao nao abre de novo");
  // D64: a copia lancada de agora em diante guarda quem respondeu, entao o modelo antigo nao diz mais "respostas anônimas".
  assert.match(textOf(templates), /Quais temas\? Várias opções · 2 opções/);
  assert.doesNotMatch(textOf(templates), /an[oô]nim/i);

  const questions = markup.slice(markup.indexOf("data-console-questions"));
  const order = Array.from(questions.matchAll(/data-console-question="([^"]+)"/g)).map((match) => match[1]);
  assert.deepEqual(order, ["q-top", "q-1", "q-respondida", "q-dispensada"], "abertas por voto, depois respondidas, dispensadas no fim");
  // Legado: a pergunta gravada como anonima antes de 10/11/2026 continua "Anônima" no console.
  assert.match(textOf(questions), /Anônima/);
  // Os votos da pergunta agora sao o polegar com o numero, que a equipe tambem curte (rodada v11, docs/30 D101); a
  // total vai no nome do botao.
  assert.match(questions, /<button aria-label="Curtir, 5 curtidas" aria-pressed="false"[^>]*data-console-like="question"[^>]*>/);
  assert.doesNotMatch(textOf(questions), /5 votos/);
  assert.match(textOf(questions), /Sim, 7 dias\./);
  assert.equal(count(questions, />Responder por escrito</g), 2);
  assert.equal(count(questions, />Respondida ao vivo</g), 2);
  assert.equal(count(questions, />Reabrir</g), 2);
});

test("sessao encerrada: so leitura (sem Soltar agora, Liberar nem Enviar habilitado) e o link do relatorio; sem sessao, o estado vazio", () => {
  const ended = snapshot({ session: sessions[2] });
  const markup = render({ sessions, snapshot: ended, webinar });
  const text = textOf(markup);

  assert.match(markup, /<option value="bbbbbbbb-2222-4222-8222-333333333333" selected="">Sessão de 5\/11 às 18:05 · encerrada<\/option>/);
  assert.match(markup, /data-console-clock="">Durou 1:00:00</, "o relogio parou no encerramento (1 h depois da hora marcada), nao conta ate agora (2 h)");
  assert.match(text, /Esta sessão não aceita mais ações da equipe\./);
  assert.match(markup, /href="\/admin\/comunicacao\/webinarios\/aaaaaaaa-1111-4111-8111-111111111111\/relatorio"/, "Ver relatório");
  assert.equal(count(markup, />Soltar agora</g), 0);
  assert.doesNotMatch(text, /Liberar|Apagar/);
  assert.match(markup, /id="console-composer"[^>]*disabled=""|disabled=""[^>]*id="console-composer"/, "a caixa da equipe fica desligada");

  const empty = textOf(render({ sessions: [], snapshot: null, webinar: { ...webinar, kind: "live" } }));
  assert.match(empty, /Marque pelo menos uma sessão\./);
  assert.doesNotMatch(empty, /Soltar agora|Enviar/);
});

test("fase 4c: o painel Atendimento entra no console (le pela propria acao) e a resposta do Assistente no chat tem o selo e Corrigir resposta", () => {
  const ai = message({ authorUserId: null, body: "Custa R$ 997.", displayName: "Assistente", id: "m-ia", kind: "answer", promotable: false, replyToId: "m-ana", role: "ai", source: "ai" });
  const markup = render({ sessions, snapshot: snapshot({ messages: [...messages, ai] }), webinar });
  const text = textOf(markup);
  assert.match(text, /Atendimento/);
  assert.match(text, /Carregando o atendimento…/);
  // O Atendimento fica no ⋯ (docs/31 V2-15), montado e escondido: a leitura e a batida de 30 s continuam com outra aba.
  const atendimento = pane(markup, "more", "atendimento");
  assert.ok(hiddenPane(atendimento));
  assert.match(textOf(atendimento), /Carregando o atendimento…/);
  const block = chatItem(markup, "m-ia");
  // O nome igual ao selo (o Assistente): so o selo, como na sala, e o avatar do Assistente.
  assert.equal(chatMeta(block), "Assistente · 20:01", "o selo Assistente na linha do autor, como na sala");
  assert.match(textOf(block.slice(block.indexOf('aria-label="Mais ações da mensagem de Assistente"'))), /Corrigir resposta/, "Corrigir resposta no ⋯ da resposta");
  assert.match(block, /aria-label="Apagar: Assistente"/, "apagar segue pela moderacao");
  assert.equal(count(markup, />Corrigir resposta</g), 1, "so na resposta do Assistente");

  const ended = textOf(render({ sessions, snapshot: snapshot({ messages: [ai], session: sessions[2] }), webinar }));
  assert.doesNotMatch(ended, /Corrigir resposta/, "sessao encerrada: so leitura");
});

test("Corrigir resposta aberto (docs/31 V2-15): as acoes da linha saem do item em edicao (presas ao fim dele, cobririam o Cancelar e o Salvar correção) e o campo recebe o foco; as outras mensagens continuam com as delas", () => {
  const ai = message({ authorUserId: null, body: "Custa R$ 997.", displayName: "Assistente", id: "m-ia", kind: "answer", promotable: false, replyToId: "m-ana", role: "ai", source: "ai" });
  const props = {
    askedMessageIds: [],
    busyKey: null,
    canAct: true,
    currentUserId: "u-host",
    hostUserId: "u-host",
    messages: [...messages, ai],
    onChatMode() {},
    onEditAssistant: async () => true,
    onModerate() {},
    onSend: async () => true,
    pinnedMessageId: null,
    session: session()
  };
  const fechado = html(createElement(ConsoleChat, props));
  assert.match(chatItem(fechado, "m-ia"), /data-console-message-actions=""/, "sem a correcao, as acoes na linha");
  assert.doesNotMatch(fechado, /data-console-edit=/);

  const aberto = html(createElement(ConsoleChat, { ...props, initialEditing: { body: "Custa R$ 997 à vista.", id: "m-ia" } }));
  const item = chatItem(aberto, "m-ia");
  assert.match(item, /data-console-edit="m-ia"/, "a correcao embaixo do balao");
  assert.match(item, /<textarea(?=[^>]*autofocus="")(?=[^>]*id="console-edit-m-ia")[^>]*>Custa R\$ 997 à vista\.<\/textarea>/, "o campo com o foco (o ⋯ de onde a correcao abriu sai da tela)");
  assert.deepEqual(Array.from(item.matchAll(/<button[^>]*>([^<]+)<\/button>/g)).map((match) => match[1]), ["Cancelar", "Salvar correção"], "so os botoes da correcao no item");
  assert.doesNotMatch(item, /data-console-message-actions|aria-label="(?:Fixar|Apagar|Mais ações da mensagem de Assistente)/, "sem as acoes da linha por cima do Salvar correção");
  assert.match(chatItem(aberto, "m-sem-aceite"), /data-console-message-actions=""/, "as outras mensagens com as acoes delas");
});

test("paginas e rota: a pagina do console com as guardas e a migracao pendente; a rota de 5 s so com messaging.write e sem cache; as acoes com a permissao de §2.6", () => {
  const page = stripComments(read("src/app/admin/(v2)/comunicacao/webinarios/[id]/sala/page.tsx"));
  assert.match(page, /requirePageArea\("comunicacao"\)/);
  assert.match(page, /redirect\(WEBINARS_HREF\)/);
  assert.match(page, /loadUnlessPendingMigration\(/);
  assert.match(page, /<PendingMigrationNotice migration=\{WEBINARS_MIGRATION\} \/>/);
  assert.match(page, /notFound\(\)/);
  assert.match(page, /can\(access, "messaging\.publish"\)/);
  assert.ok(existsSync(new URL("src/app/admin/(v2)/comunicacao/webinarios/[id]/sala/loading.tsx", root)));

  const route = stripComments(read("src/app/api/admin/webinars/[id]/console/route.ts"));
  assert.match(route, /requireApiRole\("messaging\.write"\)/);
  assert.match(route, /export const dynamic = "force-dynamic";/);
  assert.match(route, /noStore\(/);
  assert.match(route, /isUuid\(id\) \|\| !isUuid\(sessionId\)/);

  const room = stripComments(read("src/server/webinars/room-actions.ts"));
  assert.match(room, /^"use server";/);
  // Pelo esqueleto dos Webinarios (runWebinarAction), com a classe de cada acao (docs/32 §11.3).
  assert.match(room, /runWebinarAction\("messaging\.publish", "atendimento", sessionIdInputSchema, input, async[\s\S]*?openSession\(db, row\.id, now\)/, "abrir pede messaging.publish");
  assert.match(room, /runWebinarAction\("messaging\.publish", "atendimento", sessionIdInputSchema, input, async[\s\S]*?finishSession\(db, row\.id, now\)/, "encerrar pede messaging.publish");
  assert.match(room, /runWebinarAction\("messaging\.publish", "conteudo", saveSimulationSchema/);
  assert.match(room, /runWebinarAction\("messaging\.publish", "dever_legal", removeStudentMessagesSchema/);
  assert.match(room, /runWebinarAction\("messaging\.write", "atendimento", moderateMessageSchema/);
  assert.match(room, /runWebinarAction\("messaging\.write", "conteudo", createReplaySessionSchema/);
  for (const action of ["webinar.session_opened", "webinar.session_ended", "webinar.team_message", "webinar.moderated", "webinar.chat_mode", "webinar.polls_saved", "webinar.poll_launched", "webinar.poll_closed", "webinar.question_answered", "webinar.question_status", "webinar.simulation_saved", "webinar.replay_created", "webinar.replay_cancelled", "webinar.student_messages_removed"]) {
    assert.match(room, new RegExp(`action: "${action.replace(".", "\\.")}"`), action);
  }

  const script = stripComments(read("src/server/webinars/script-actions.ts"));
  assert.match(script, /^"use server";/);
  // Adendo de 10/11/2026 (R8 e R9): o "Novo comentário" (Enviar agora, Guardar na lista) e a foto de quem comenta pedem o
  // mesmo messaging.write do Soltar agora (o apresentador, o co-apresentador e a equipe).
  assert.equal(count(script, /runWebinarAction\("messaging\.write"/g), 10, "as dez acoes do roteiro pedem messaging.write");
  assert.doesNotMatch(script, /run(?:Admin|Webinar)Action\("messaging\.publish"/);
  for (const action of [
    "webinar.script_saved",
    "webinar.script_imported",
    "webinar.script_exported",
    "webinar.chat_exported",
    "webinar.transcript_saved",
    "webinar.script_resolved",
    "webinar.script_fired",
    "webinar.persona_photo_uploaded",
    "webinar.script_comment_sent",
    "webinar.script_item_added"
  ]) {
    assert.match(script, new RegExp(`action: "${action.replace(".", "\\.")}"`), action);
  }
  assert.doesNotMatch(`${room}${script}`, /full_name|email:/, "nada de nome ou e-mail na auditoria");
});

test("o painel Presenca (§2.4): presentes agora, pico, mensagens no ultimo minuto com a media e a curva dos ultimos 30 minutos; sem a leitura, a entrada fica so com a chave do numero de pessoas (D107)", async () => {
  const { consolePresenceOf } = await import("../src/server/webinars/console-presence-model.ts");
  const view = {
    chat: { hot: [], perMinute: [{ minute: 3, students: 2, total: 4 }, { minute: 4, students: 1, total: 2 }], students: 3, top: [], total: 6 },
    presence: { avgPresent: 5, curve: [{ b: 0, n: 2 }, { b: 6, n: 8 }, { b: 7, n: 9 }, { b: 9, n: 7 }], drops: [], peak: { b: 7, n: 9 }, reachedEnd: 0, unique: 9, watchAvgSeconds: 0, watchMaxSeconds: 0 }
  };
  const presence = consolePresenceOf(view, 4 * MIN + 30_000);
  const markup = render({ sessions, snapshot: snapshot({ presence }), webinar });
  // A Presença no ⋯ (docs/31 V2-15), montada e escondida.
  assert.deepEqual(Array.from(markup.matchAll(/data-console-more="([a-z]+)"/g)).map((match) => match[1]), ["tela", "enquetes", "roteiro", "oferta", "atendimento", "presenca"]);
  assert.ok(hiddenPane(pane(markup, "more", "presenca")));
  assert.match(pane(markup, "more", "presenca"), /id="console-presence-title"/);
  // O selo do topo da gravada (V2-13): os presentes do retrato de 5 s e o pico da presenca.
  assert.match(markup, /data-console-present=""[^>]*>7 presentes · pico 9</);
  const painel = markup.slice(markup.indexOf('id="console-presence-title"'));
  const text = textOf(painel);
  assert.match(text, />Presença Atualiza a cada minuto\. Só alunos; o roteiro e o Assistente não entram\. Presentes agora 7 Pico 9 em 03:00 Mensagens no último minuto 4 média de 1,2 por minuto nos últimos 30 min Últimos 30 minutos/);
  assert.match(painel, /<svg[^>]*aria-label="Presentes nos últimos 30 minutos: 7 agora, no máximo 9\."[^>]*role="img"/);
  assert.equal((painel.match(/<rect /g) ?? []).length, 5, "um minuto por barra, do 0 ao 4");
  assert.match(painel, /<title>03:00 · 9 presentes<\/title>/);

  const semPresenca = render({ sessions, snapshot: snapshot({ presence: null }), webinar });
  assert.doesNotMatch(textOf(semPresenca), /Mensagens no último minuto/);
  // Sem a leitura, a entrada continua (rodada v12, docs/30 D107): so a chave "Mostrar quantas pessoas estão na sala".
  const soChave = pane(semPresenca, "more", "presenca");
  assert.match(soChave, /id="console-present-count-title"/);
  assert.match(soChave, /<button[^>]*aria-checked="true"[^>]*id="console-present-count"[^>]*role="switch"|<button[^>]*id="console-present-count"[^>]*role="switch"/);
  assert.doesNotMatch(soChave, /id="console-presence-title"/, "sem o painel da leitura");
});

test("Refazer tradução: cada mensagem do chat ganha o item no ⋯ so com a traducao ligada no ambiente", () => {
  const desligada = render({ sessions, snapshot: snapshot(), webinar });
  assert.doesNotMatch(desligada, /Refazer tradução/);
  // Sem a traducao, o ⋯ da equipe e do roteiro so tem o "Mostrar na tela" (rodada v9); com ela, toda mensagem liberada
  // ganha tambem o item.
  assert.doesNotMatch(textOf(chatItem(desligada, "m-roteiro")), /Refazer tradução/);
  const ligada = html(createElement(SessionConsole, { currentUserId: "u-host", data: { sessions, snapshot: snapshot(), webinar }, permissions: both, serverNow: NOW, translationEnabled: true }));
  for (const [id, name] of [["m-sem-aceite", "Aluno 231"], ["m-equipe", "Produtor T."], ["m-roteiro", "Duda"]]) {
    const item = chatItem(ligada, id);
    assert.match(textOf(item.slice(item.indexOf(`aria-label="Mais ações da mensagem de ${name}"`))), /Refazer tradução/, id);
  }
  assert.equal(count(pane(ligada, "tab", "chat"), />Refazer tradução</g), 4, "tambem no card da pendente");
});
