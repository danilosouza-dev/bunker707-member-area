import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";

// A "Na tela" no console da sessao desenhado (docs/30 §2.4 e §8.3; especificacao de 10/11/2026, R1, R2, §6.2, §6.3 e §9;
// docs/18 §1.1), pelo renderToStaticMarkup:
// - R1, a aba Chat: a pilula "Fixar ao enviar" no campo aberto (aria-pressed, desligada por padrao; so quando a sessao
//   aceita a equipe); o bloco "Fixada agora" acima da lista e fora da rolagem, com o autor, o texto em 2 linhas, o "há
//   3 min" e o Desafixar, tambem para uma mensagem que nao esta entre as da lista (o retrato a le pela chave); sem poder
//   agir, o bloco sem o Desafixar; os enderecos `https://` das mensagens da equipe viram link (outra aba, rel noopener
//   noreferrer nofollow, a pontuacao do fim de fora, o texto visivel igual ao href), a mensagem de aluno e o Assistente
//   continuam texto, e nenhum href que nao seja https;
// - R2, a entrada Enquetes: em "Nesta sessão", o Fixar na aberta e na encerrada com o resultado compartilhado (nunca na
//   encerrada sem compartilhar), o selo Fixada e o Desafixar na fixada (o pinnedPollId do retrato); em "Prontas", o
//   "Abrir e fixar" ao lado do Abrir; sem poder agir, nenhum botao de fixar; e, desde 11/11/2026 (D83), a "Nova
//   enquete" no cabecalho (desligada no teto de 20 prontas, com a frase), o formulario no lugar da lista (Pergunta, Tipo,
//   Opções com adicionar e remover, Abrir agora, Abrir e fixar, Guardar nas prontas e Cancelar; sem poder agir, so
//   Guardar), os erros pelo mesmo zod do servidor so depois da primeira tentativa, e a nova na lista das prontas;
// - R3 e R4, a entrada Na tela: "Na tela agora" com a mensagem e a enquete fixadas, o banner e o QR Code com ha quanto
//   tempo, os numeros e o Tirar da tela; os Prontos com o resumo, a Previa e o botao de cada estado (Mostrar, Mostrar no
//   lugar do atual, Na tela, Mostrar de novo) e o ⋯ com Editar e Excluir; o aviso da migracao; os dois formularios com
//   todos os rotulos (os nove pontos como radios, o Grande desligado no meio sem fechar, os avisos fixos, o codigo do QR
//   Code com o dominio e o aviso de codigo denso, os links prontos); o estado puro do formulario; a Previa no
//   Computador e no Celular, desenhada pelos componentes do aluno (a camada do palco e a faixa) dentro da moldura inert,
//   sem handlers; o contador da entrada no trilho; a entrada no console da gravada (nunca no Replay) e a
//   pilula "Na tela: Banner · QR Code" no palco da Live ao vivo, sem os cartoes;
// - R5, a moderacao por pessoa na Live gravada: o ⋯ da mensagem de aluno com os itens da live sem os do video (Banir
//   desligado com a frase sem messaging.publish), os Desfazer e os rotulos da barrada, o bloco "Removidos, silenciados e
//   banidos" embaixo dos seletores do Chat, a equipe sem itens e o Replay sem nada.
//
// Os .tsx do app sao transpilados aqui pelo TypeScript (so JSX -> JS). next/navigation vira stub; o Dialog e o
// DropdownMenu viram versoes sem portal; as Server Actions viram funcoes falsas (como tests/webinarios-console-tela).

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
  "@/server/webinars/offer-actions": `${fail}
export const loadOfferEditor = fail; export const saveOffer = fail; export const archiveOffer = fail; export const loadOfferConsole = fail; export const showOfferNow = fail; export const hideOffer = fail;`,
  "@/server/webinars/assistant-actions": `${fail}
export const loadAssistantEditor = fail; export const saveAssistant = fail; export const loadAttendanceSnapshot = fail; export const setReplyAll = fail; export const pingAttendant = fail; export const assign = fail; export const editAssistantAnswer = fail;`,
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
const { ConsoleTeamText, pinnedMinutes } = await import("../src/components/admin/v2/communication/webinars/session-console/console-pinned.tsx");
const { ConsolePolls } = await import("../src/components/admin/v2/communication/webinars/session-console/console-polls.tsx");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const naTela = WEBINAR_COPY.naTela;
const html = (element) => renderToStaticMarkup(element);
const textOf = (markup) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const count = (markup, pattern) => (markup.match(pattern) ?? []).length;
/** Um pedaco do html: da tag com o marcador ate o fechamento dela (contando as tags iguais dentro dela). */
function block(markup, marker, tag) {
  const at = markup.indexOf(marker);
  assert.ok(at >= 0, `tem ${marker}`);
  const start = markup.lastIndexOf(`<${tag}`, at);
  const pattern = new RegExp(`<${tag}[\\s>]|</${tag}>`, "g");
  pattern.lastIndex = start;
  let depth = 0;
  for (let match = pattern.exec(markup); match; match = pattern.exec(markup)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) {
      return markup.slice(start, match.index + match[0].length);
    }
  }
  return markup.slice(start);
}

/* ------------------------------------------------------------------------------------------------
 * O cenario (o mesmo desenho de tests/webinarios-console-tela.test.mjs)
 * ---------------------------------------------------------------------------------------------- */

const NOW = Date.parse("2026-11-05T23:05:00.000Z");
const MIN = 60_000;
const WEBINAR = "aaaaaaaa-1111-4111-8111-111111111111";
const S_LIVE = "bbbbbbbb-2222-4222-8222-111111111111";

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

function message(extra = {}) {
  return { approved: true, authorUserId: "u-ana", body: "Boa noite!", createdAt: new Date(NOW - 4 * MIN).toISOString(), displayName: "Ana M.", id: "m-ana", kind: "message", master: false, offsetMs: 60_000, pinnedAt: null, promotable: true, replyToId: null, role: "student", scriptItemId: null, sessionId: S_LIVE, source: "audience", webinarId: WEBINAR, ...extra };
}

/** A fixada mais velha que as 200 da lista: so o retrato a traz (pela chave), nunca a lista. */
const antiga = message({
  authorUserId: "u-bia",
  body: "Material: https://exemplo.com/material. Bom proveito!",
  createdAt: new Date(NOW - 90 * MIN).toISOString(),
  displayName: "Bia C.",
  id: "m-antiga",
  pinnedAt: new Date(NOW - 3 * MIN - 20_000).toISOString(),
  role: "team",
  source: "team"
});

const messages = [
  message({ body: "Olha https://golpe.exemplo.com/premio aqui", id: "m-aluna" }),
  message({ authorUserId: "u-host", body: "Link da aula: https://exemplo.com/aula.", displayName: "Produtor T.", id: "m-equipe", role: "host", source: "team" }),
  message({ authorUserId: null, body: "Inscreva-se: https://exemplo.com/inscricao", displayName: "Duda", id: "m-roteiro-equipe", role: "team", scriptItemId: "i-a", source: "scripted" }),
  message({ authorUserId: null, body: "Persona aluna: https://exemplo.com/x", displayName: "Rafa", id: "m-roteiro-aluno", role: "student", scriptItemId: "i-b", source: "scripted" }),
  message({ authorUserId: null, body: "Veja https://exemplo.com/ia", displayName: "Assistente", id: "m-ia", role: "ai", source: "ai" }),
  message({ authorUserId: "u-host", body: "Nada disso: javascript:alert(1) e http://exemplo.com", displayName: "Produtor T.", id: "m-sem-link", role: "host", source: "team" })
];

function chatProps(extra = {}) {
  return {
    askedMessageIds: [],
    busyKey: null,
    canAct: true,
    currentUserId: "u-host",
    hostUserId: "u-host",
    messages,
    nowMs: NOW,
    onChatMode() {},
    onModerate() {},
    onSend: async () => true,
    pinned: null,
    pinnedMessageId: null,
    session: session(),
    ...extra
  };
}

/** O item de uma mensagem na lista do chat (do <li> ao </li>). */
const chatItem = (markup, id) => block(markup, `data-room-message="${id}"`, "li");

/* ------------------------------------------------------------------------------------------------
 * R1: o Fixar ao enviar
 * ---------------------------------------------------------------------------------------------- */

test("Fixar ao enviar: com o campo aberto, a pilula com aria-pressed desligado (um botao, nunca o envio do formulario), antes do Cancelar e do Enviar; fechado, so o campo; sem poder agir, nunca", () => {
  const aberto = html(createElement(ConsoleChat, chatProps({ initialComposerOpen: true })));
  const pilula = block(aberto, "data-console-pin-on-send", "div");
  const botao = pilula.match(/<button[^>]*>/)?.[0] ?? "";
  assert.match(botao, /aria-pressed="false"/, "desligada por padrao");
  assert.match(botao, /type="button"/, "a pilula nao envia o formulario");
  assert.equal(textOf(pilula), naTela.chat.fixarAoEnviar);
  assert.equal(naTela.chat.fixarAoEnviar, "Fixar ao enviar");
  assert.ok(aberto.indexOf("data-console-pin-on-send") > aberto.indexOf('id="console-composer"'), "embaixo do texto");
  assert.ok(aberto.indexOf("data-console-pin-on-send") < aberto.indexOf(">Enviar</button>"), "antes do rodape com o Enviar");
  assert.equal(count(aberto, /aria-pressed=/g), 1, "uma pilula so");

  const fechado = html(createElement(ConsoleChat, chatProps()));
  assert.doesNotMatch(fechado, /data-console-pin-on-send/, "fechado, o campo nao mostra o rodape nem a pilula");

  const semAcao = html(createElement(ConsoleChat, chatProps({ canAct: false, initialComposerOpen: true })));
  assert.doesNotMatch(semAcao, /data-console-pin-on-send/, "a sessao que nao aceita a equipe nao fixa");
});

/* ------------------------------------------------------------------------------------------------
 * R1: o bloco Fixada agora
 * ---------------------------------------------------------------------------------------------- */

test("Fixada agora: o bloco acima da lista e fora da rolagem, para uma mensagem que nao esta na lista, com o autor, o texto em 2 linhas com o link, o há 3 min e o Desafixar", () => {
  assert.ok(!messages.some((entry) => entry.id === antiga.id), "a fixada nao esta entre as da lista");
  const markup = html(createElement(ConsoleChat, chatProps({ pinned: antiga, pinnedMessageId: antiga.id })));
  const fixada = block(markup, `data-console-pinned="${antiga.id}"`, "section");

  assert.ok(markup.indexOf("data-console-pinned=") < markup.indexOf('data-console-chat=""'), "acima da lista");
  const lista = block(markup, 'data-console-chat=""', "div");
  assert.doesNotMatch(lista, /data-console-pinned=/, "fora da rolagem da lista");
  assert.doesNotMatch(lista, /m-antiga/, "a lista continua so com as dela");

  const titulo = fixada.match(/<span[^>]*id="([^"]+)"[^>]*>([^<]+)<\/span>/);
  assert.equal(titulo?.[2], naTela.chat.fixadaAgora);
  assert.match(fixada, new RegExp(`^<section aria-labelledby="${titulo?.[1]}"`), "a secao com o nome do bloco");
  assert.match(fixada, /<time[^>]*data-console-pinned-age=""[^>]*>há 3 min<\/time>/, "há quanto tempo esta fixada");
  assert.match(fixada, /data-console-pinned-author="">Bia C\.</, "o autor");
  const corpo = block(fixada, "data-console-pinned-body", "p");
  assert.match(corpo, /\bline-clamp-2\b/, "o texto em ate 2 linhas");
  assert.match(corpo, /<a [^>]*href="https:\/\/exemplo\.com\/material"[^>]*>https:\/\/exemplo\.com\/material<\/a>\. Bom proveito!/, "o link clicavel, com o ponto de fora");
  const desafixar = fixada.match(/<button[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.equal(textOf(desafixar), naTela.chat.desafixar);
  assert.doesNotMatch(desafixar, /\sdisabled=""/);

  const ocupado = block(html(createElement(ConsoleChat, chatProps({ busyKey: `moderate:${antiga.id}`, pinned: antiga, pinnedMessageId: antiga.id }))), "data-console-pinned=", "section");
  assert.match(ocupado.match(/<button[^>]*>/)?.[0] ?? "", /\sdisabled=""/, "com a acao em andamento, desligado");

  const soLeitura = block(html(createElement(ConsoleChat, chatProps({ canAct: false, pinned: antiga, pinnedMessageId: antiga.id }))), "data-console-pinned=", "section");
  assert.doesNotMatch(soLeitura, /<button/, "sem poder agir, o bloco so mostra");

  assert.doesNotMatch(html(createElement(ConsoleChat, chatProps())), /data-console-pinned=/, "sem fixada, sem bloco");
});

test("Fixada agora: a minha aparece como Você, e a hora (agora, há 1 h 5 min) segue o relogio do console", () => {
  const minha = { ...antiga, authorUserId: "u-host" };
  const agora = block(html(createElement(ConsoleChat, chatProps({ nowMs: Date.parse(antiga.pinnedAt) + 20_000, pinned: minha, pinnedMessageId: minha.id }))), "data-console-pinned=", "section");
  assert.match(agora, /data-console-pinned-author="">Você</);
  assert.match(agora, />agora<\/time>/);
  const depois = block(html(createElement(ConsoleChat, chatProps({ nowMs: Date.parse(antiga.pinnedAt) + 65 * MIN, pinned: minha, pinnedMessageId: minha.id }))), "data-console-pinned=", "section");
  assert.match(depois, />há 1 h 5 min<\/time>/);
  assert.equal(pinnedMinutes(null, NOW), null, "sem a hora, sem o tempo");
  assert.equal(pinnedMinutes(antiga.pinnedAt, Number.NaN), null);
  assert.doesNotMatch(block(html(createElement(ConsoleChat, chatProps({ pinned: { ...antiga, pinnedAt: null }, pinnedMessageId: antiga.id }))), "data-console-pinned=", "section"), /<time/);
});

test("a fixada pelo retrato chega ao Chat do console: o SessionConsole passa snapshot.pinned e o relogio", () => {
  const snapshot = {
    askedMessageIds: [],
    barred: null,
    live: null,
    messages,
    pinned: antiga,
    pinnedMessageId: antiga.id,
    pinnedPollId: null,
    polls: { launched: [], templates: [] },
    presentNow: 3,
    questions: [],
    scriptFired: {},
    scriptItems: [],
    screen: { active: [], items: [], pending: false, stats: {} },
    serverTime: new Date(NOW).toISOString(),
    session: session({ pinnedMessageId: antiga.id })
  };
  const webinar = { durationMinutes: 60, hostUserId: "u-host", id: WEBINAR, kind: "simulated", recordingDurationSeconds: 3600, slug: "aula-de-ia", title: "Aula de IA" };
  const markup = html(createElement(SessionConsole, { currentUserId: "u-host", data: { sessions: [snapshot.session], snapshot, webinar }, permissions: { canPublish: true, canWrite: true }, serverNow: NOW }));
  const fixada = block(markup, `data-console-pinned="${antiga.id}"`, "section");
  assert.match(fixada, /data-console-pinned-author="">Bia C\.</);
  assert.match(fixada, /<time[^>]*>(?:agora|há \d+ min)<\/time>/, "o tempo pelo relogio do console");

  // O retrato de antes da Na tela (sem `pinned`): o Chat segue sem o bloco.
  const semFixada = { ...snapshot };
  delete semFixada.pinned;
  assert.doesNotMatch(html(createElement(SessionConsole, { currentUserId: "u-host", data: { sessions: [snapshot.session], snapshot: semFixada, webinar }, permissions: { canPublish: true, canWrite: true }, serverNow: NOW })), /data-console-pinned=/);
});

/* ------------------------------------------------------------------------------------------------
 * R1: os links das mensagens da equipe
 * ---------------------------------------------------------------------------------------------- */

test("links no chat do console: o https da equipe (do console e do roteiro como Equipe) vira link em outra aba, com o texto igual ao href e a pontuacao de fora; aluno, persona de aluno e o Assistente continuam texto; nada que nao seja https vira href", () => {
  const markup = html(createElement(ConsoleChat, chatProps()));
  const links = Array.from(markup.matchAll(/<a [^>]*>[^<]*<\/a>/g)).map((match) => match[0]);
  assert.equal(links.length, 2, `so os dois links da equipe: ${links.join(" | ")}`);
  for (const link of links) {
    assert.match(link, /\starget="_blank"/);
    assert.match(link, /\srel="noopener noreferrer nofollow"/);
    const href = link.match(/href="([^"]+)"/)?.[1];
    assert.equal(textOf(link), href, "o texto visivel e o proprio endereco");
    assert.match(href, /^https:\/\//);
  }

  assert.match(chatItem(markup, "m-equipe"), /<a [^>]*href="https:\/\/exemplo\.com\/aula"[^>]*>https:\/\/exemplo\.com\/aula<\/a>\.<\/p>/, "a mensagem do Apresentador, com o ponto do fim fora do link");
  assert.match(chatItem(markup, "m-roteiro-equipe"), /href="https:\/\/exemplo\.com\/inscricao"/, "a fala do roteiro como Equipe");
  for (const id of ["m-aluna", "m-roteiro-aluno", "m-ia", "m-sem-link"]) {
    assert.doesNotMatch(chatItem(markup, id), /<a\s/, `${id} continua texto`);
  }
  assert.match(chatItem(markup, "m-aluna"), /Olha https:\/\/golpe\.exemplo\.com\/premio aqui/, "o endereco do aluno aparece, mas como texto");
  assert.doesNotMatch(markup, /href="(?!https:\/\/)/, "nenhum href fora de https");
});

test("ConsoleTeamText: sem links (a mensagem de aluno), o texto inteiro; com links, no maximo 5 por mensagem", () => {
  const texto = "a https://um.exemplo.com b";
  assert.equal(html(createElement(ConsoleTeamText, { links: false, text: texto })), texto);
  const seis = Array.from({ length: 6 }, (_, index) => `https://site${index}.exemplo.com`).join(" ");
  assert.equal(count(html(createElement(ConsoleTeamText, { links: true, text: seis })), /<a /g), 5);
});

/* ------------------------------------------------------------------------------------------------
 * R2: a entrada Enquetes
 * ---------------------------------------------------------------------------------------------- */

const poll = (extra = {}) => ({
  anonymous: false,
  closedAt: null,
  counts: { answers: 2, byOption: { "o-1": 1, "o-2": 1 } },
  id: "p-1",
  kind: "single",
  openOffsetMs: null,
  openedAt: new Date(NOW - MIN).toISOString(),
  options: [
    { id: "o-1", label: "Sim", position: 0 },
    { id: "o-2", label: "Não", position: 1 }
  ],
  position: 0,
  question: "Vem na próxima?",
  resultsSharedAt: null,
  sessionId: S_LIVE,
  status: "open",
  templatePollId: "t-1",
  webinarId: WEBINAR,
  ...extra
});

const launched = [
  poll({ id: "p-fixada", question: "Gostou da aula?", templatePollId: "t-1" }),
  poll({ id: "p-aberta", question: "Quer o material?", templatePollId: "t-2" }),
  poll({ closedAt: new Date(NOW - MIN).toISOString(), id: "p-compartilhada", question: "Vem amanhã?", resultsSharedAt: new Date(NOW - MIN).toISOString(), status: "closed", templatePollId: "t-3" }),
  poll({ closedAt: new Date(NOW - MIN).toISOString(), id: "p-encerrada", question: "Qual horário?", status: "closed", templatePollId: "t-4" })
];
const templates = [
  { ...poll({ id: "t-1", question: "Gostou da aula?", sessionId: null, status: "draft", templatePollId: null }), counts: undefined },
  { ...poll({ id: "t-9", question: "Nova pergunta?", sessionId: null, status: "draft", templatePollId: null }), counts: undefined }
];

function pollsProps(extra = {}) {
  return { busyKey: null, canAct: true, launched, onClose() {}, onLaunch() {}, onPin() {}, onUnpin() {}, pinnedPollId: "p-fixada", templates, ...extra };
}

/** Os rotulos dos botoes de uma enquete de "Nesta sessão" (ou de uma pronta), na ordem. */
const botoes = (markup, marker) => Array.from(block(markup, marker, "li").matchAll(/<button[^>]*>([^<]*)<\/button>/g)).map((match) => match[1]);
const chips = (markup, marker) => textOf(block(markup, marker, "li").split("<ul")[0]);

test("Enquetes: Fixar na aberta e na compartilhada, nunca na encerrada sem compartilhar; a fixada com o selo Fixada e o Desafixar; Abrir e fixar ao lado do Abrir nas prontas", () => {
  const markup = html(createElement(ConsolePolls, pollsProps()));
  const enquetes = naTela.enquetes;
  assert.deepEqual([enquetes.fixar, enquetes.desafixar, enquetes.fixada, enquetes.abrirEFixar], ["Fixar", "Desafixar", "Fixada", "Abrir e fixar"]);

  assert.deepEqual(botoes(markup, 'data-console-poll="p-fixada"'), ["Encerrar", "Compartilhar resultado", "Desafixar"]);
  assert.match(chips(markup, 'data-console-poll="p-fixada"'), /Gostou da aula\? Aberta Fixada/, "o selo Fixada");
  assert.match(block(markup, 'data-console-poll="p-fixada"', "li"), /data-poll-pinned=""/);
  assert.deepEqual(botoes(markup, 'data-console-poll="p-aberta"'), ["Encerrar", "Compartilhar resultado", "Fixar"]);
  assert.doesNotMatch(chips(markup, 'data-console-poll="p-aberta"'), /Fixada/);
  assert.deepEqual(botoes(markup, 'data-console-poll="p-compartilhada"'), ["Fixar"], "encerrada com o resultado compartilhado: fixa");
  assert.deepEqual(botoes(markup, 'data-console-poll="p-encerrada"'), ["Compartilhar resultado"], "encerrada sem compartilhar: a turma nao ve, nao fixa");
  assert.equal(count(markup, /data-console-poll-pin="unpin"/g), 1, "um Desafixar so");

  // Prontas: a copia aberta do modelo t-1 mostra Aberta; o modelo sem copia aberta, Abrir e Abrir e fixar.
  assert.deepEqual(botoes(markup, 'data-console-poll-template="t-9"'), ["Abrir", "Abrir e fixar"]);
  assert.deepEqual(botoes(markup, 'data-console-poll-template="t-1"'), [], "a pronta ja aberta, sem os botoes");
});

test("Enquetes: sem enquete fixada, nenhum selo; ocupada, os botoes desligados; sem poder agir, nenhum Fixar e o Abrir e fixar desligado", () => {
  const semFixada = html(createElement(ConsolePolls, pollsProps({ pinnedPollId: null })));
  assert.doesNotMatch(semFixada, /data-poll-pinned|data-console-poll-pin="unpin"/);
  assert.deepEqual(botoes(semFixada, 'data-console-poll="p-fixada"'), ["Encerrar", "Compartilhar resultado", "Fixar"]);

  const ocupada = html(createElement(ConsolePolls, pollsProps({ busyKey: "poll:p-fixada" })));
  assert.match(block(ocupada, 'data-console-poll="p-fixada"', "li").match(/<button[^>]*data-console-poll-pin="unpin"[^>]*>/)?.[0] ?? "", /\sdisabled=""/);
  assert.doesNotMatch(block(ocupada, 'data-console-poll="p-aberta"', "li").match(/<button[^>]*data-console-poll-pin="pin"[^>]*>/)?.[0] ?? "", /\sdisabled=""/, "as outras livres");

  const soLeitura = html(createElement(ConsolePolls, pollsProps({ canAct: false })));
  assert.doesNotMatch(soLeitura, /data-console-poll-pin=/, "sem poder agir, nem Fixar nem Desafixar");
  assert.match(chips(soLeitura, 'data-console-poll="p-fixada"'), /Fixada/, "o selo continua");
  assert.match(soLeitura.match(/<button[^>]*data-console-poll-launch-pin=""[^>]*>/)?.[0] ?? "", /\sdisabled=""/);
});

test("a enquete fixada pelo retrato chega a entrada Enquetes: o SessionConsole passa snapshot.pinnedPollId", () => {
  const snapshot = {
    askedMessageIds: [],
    barred: null,
    live: null,
    messages: [],
    pinned: null,
    pinnedMessageId: null,
    pinnedPollId: "p-aberta",
    polls: { launched, templates },
    presentNow: 3,
    questions: [],
    scriptFired: {},
    scriptItems: [],
    screen: { active: [], items: [], pending: false, stats: {} },
    serverTime: new Date(NOW).toISOString(),
    session: session()
  };
  const webinar = { durationMinutes: 60, hostUserId: "u-host", id: WEBINAR, kind: "simulated", recordingDurationSeconds: 3600, slug: "aula-de-ia", title: "Aula de IA" };
  const markup = html(createElement(SessionConsole, { currentUserId: "u-host", data: { sessions: [snapshot.session], snapshot, webinar }, permissions: { canPublish: true, canWrite: true }, serverNow: NOW }));
  assert.match(block(markup, 'data-console-poll="p-aberta"', "li"), /data-poll-pinned=""/);
  assert.deepEqual(botoes(markup, 'data-console-poll="p-aberta"'), ["Encerrar", "Compartilhar resultado", "Desafixar"]);
  assert.deepEqual(botoes(markup, 'data-console-poll="p-fixada"'), ["Encerrar", "Compartilhar resultado", "Fixar"]);
});

/* ------------------------------------------------------------------------------------------------
 * D83 (11/11/2026): a "Nova enquete" do console
 * ---------------------------------------------------------------------------------------------- */

const pollForm = await import("../src/components/admin/v2/communication/webinars/session-console/console-poll-form.tsx");
const { ConsolePollForm, consolePollErrors, consolePollInput, emptyConsolePoll, withNewOption, withoutOption } = pollForm;
const { CHAT_MESSAGES } = await import("../src/server/webinars/chat-schemas.ts");
const { WEBINAR_ADMIN_COPY } = await import("../src/server/webinars/editor-model.ts");
const novaCopy = WEBINAR_ADMIN_COPY.console.polls.create;
const pollsCopy = WEBINAR_ADMIN_COPY.polls;
/** Os rotulos dos botoes do rodape do formulario, na ordem. */
const rodape = (markup) => Array.from(block(markup, "data-console-poll-form", "form").matchAll(/<button[^>]*data-console-poll-submit="[a-z]+"[^>]*>([^<]*)<\/button>|<button(?![^>]*data-console-poll)[^>]*>(Cancelar)<\/button>/g)).map((match) => match[1] ?? match[2]);
const pollFormState = (extra = {}) => ({ kind: "single", options: [{ key: "a", label: "" }, { key: "b", label: "" }], question: "", ...extra });
const pollFormProps = (extra = {}) => ({ busy: false, canOpen: true, onBack() {}, onSubmit: async () => null, ...extra });
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("D83 Enquetes: o Nova enquete no cabecalho so com o onCreate; no teto de 20 prontas, desligado com a frase do limite pelo aria-describedby", () => {
  assert.equal(novaCopy.novaEnquete, "Nova enquete");
  const semCriar = html(createElement(ConsolePolls, pollsProps()));
  assert.doesNotMatch(semCriar, /data-console-poll-new/);

  const comCriar = html(createElement(ConsolePolls, pollsProps({ onCreate: async () => null })));
  const botao = comCriar.match(/<button[^>]*data-console-poll-new=""[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.match(textOf(botao), /^Nova enquete$/);
  assert.doesNotMatch(botao, /\sdisabled=""/);
  assert.ok(comCriar.indexOf("data-console-poll-new") < comCriar.indexOf("data-console-polls-launched"), "no cabecalho, antes da lista");
  assert.doesNotMatch(comCriar, /id="console-polls-full"/);
  assert.match(textOf(comCriar), new RegExp(escapeRegExp(pollsCopy.kinds.single)), "a lista das prontas continua");

  const cheias = Array.from({ length: 20 }, (_, index) => ({ ...templates[1], id: `t-${index}`, question: `Pergunta ${index}?` }));
  const noTeto = html(createElement(ConsolePolls, pollsProps({ onCreate: async () => null, templates: cheias })));
  const desligado = noTeto.match(/<button[^>]*data-console-poll-new=""[^>]*>/)?.[0] ?? "";
  assert.match(desligado, /\sdisabled=""/);
  assert.match(desligado, /aria-describedby="console-polls-full"/);
  assert.match(noTeto, /<p[^>]*id="console-polls-full"[^>]*>Até 20 enquetes por webinário\.<\/p>/);
});

test("D83 Nova enquete: o formulario no lugar da lista, com Voltar, Pergunta, Tipo (Uma opção), Opções (duas, sem remover no minimo), Adicionar opção e os botoes Abrir agora, Abrir e fixar, Guardar nas prontas e Cancelar", () => {
  const markup = html(createElement(ConsolePolls, pollsProps({ initialCreate: pollFormState(), onCreate: async () => null })));
  assert.doesNotMatch(markup, /data-console-polls-launched|data-console-polls-templates|data-console-poll-new/, "a lista sai da tela");
  const form = block(markup, "data-console-poll-form", "form");
  assert.ok(textOf(markup).startsWith(`Nova enquete ${novaCopy.dica} Voltar`), "o titulo, a dica e o Voltar no cabecalho");
  assert.match(markup, /data-console-poll-back=""/);
  // Pergunta, Tipo e Opções, na ordem, com os rotulos do card do editor.
  const ordem = ["Pergunta", "Tipo", "Uma opção", "Várias opções", "Pesquisa", "Opções", "Adicionar opção"].map((rotulo) => textOf(form).indexOf(rotulo));
  assert.ok(ordem.every((at, index) => at >= 0 && (index === 0 || at > ordem[index - 1])), `os rotulos na ordem: ${ordem}`);
  assert.match(form, /<label[^>]*for="console-poll-form-[^"]*-pergunta"[^>]*>Pergunta<\/label>/);
  assert.match(form, /<input[^>]*value="single"[^>]*checked=""|<input[^>]*checked=""[^>]*value="single"/, "Uma opção marcada");
  assert.equal(count(form, /aria-label="Opção \d+"/g), 2, "duas opcoes (o minimo)");
  const remover = (markup) => (markup.match(/<button[^>]*>/g) ?? []).filter((tag) => /aria-label="Remover opção \d+"/.test(tag));
  assert.deepEqual(remover(form).map((tag) => /\sdisabled=""/.test(tag)), [true, true], "no minimo, o remover fica desligado");
  assert.doesNotMatch(form, /an[oô]nim/i, "nada de anonimato (D64)");
  assert.deepEqual(rodape(markup), [novaCopy.abrirAgora, naTela.enquetes.abrirEFixar, novaCopy.guardar, novaCopy.cancelar]);
  assert.deepEqual([novaCopy.abrirAgora, novaCopy.guardar, novaCopy.cancelar], ["Abrir agora", "Guardar nas prontas", "Cancelar"]);
  assert.doesNotMatch(textOf(markup), new RegExp(escapeRegExp(novaCopy.soGuardar)));
  // Nenhum erro antes da primeira tentativa.
  assert.doesNotMatch(form, /aria-invalid="/);
});

test("D83 Nova enquete sem poder agir (a sessao encerrada, o Replay): so Guardar nas prontas e Cancelar, com a frase; ocupada, os botoes do rodape desligados", () => {
  const soGuardar = html(createElement(ConsolePolls, pollsProps({ canAct: false, initialCreate: pollFormState(), onCreate: async () => null })));
  assert.deepEqual(rodape(soGuardar), [novaCopy.guardar, novaCopy.cancelar]);
  assert.match(textOf(soGuardar), new RegExp(escapeRegExp(novaCopy.soGuardar)));
  assert.equal(novaCopy.soGuardar, "Esta sessão não abre enquetes agora. A nova fica nas prontas.");

  const ocupada = html(createElement(ConsolePollForm, pollFormProps({ busy: true })));
  for (const tag of ocupada.match(/<button[^>]*data-console-poll-submit="[a-z]+"[^>]*>/g) ?? []) {
    assert.match(tag, /\sdisabled=""/);
  }
  assert.equal(count(ocupada, /data-console-poll-submit=/g), 3);
});

test("D83 Nova enquete: os erros so depois da primeira tentativa, cada um no seu campo (a pergunta, a opcao vazia), pelo mesmo zod do servidor, com aria-invalid e o aria-describedby do erro", () => {
  const tentado = html(createElement(ConsolePollForm, pollFormProps({ initialState: pollFormState({ options: [{ key: "a", label: "Sim" }, { key: "b", label: "  " }] }), initialTried: true })));
  const pergunta = tentado.match(/<input[^>]*id="console-poll-form-[^"]*-pergunta"[^>]*>/)?.[0] ?? "";
  assert.match(pergunta, /aria-invalid="true"/);
  assert.match(pergunta, /aria-describedby="console-poll-form-[^"]*-pergunta-error"/);
  assert.match(textOf(tentado), new RegExp(escapeRegExp(CHAT_MESSAGES.pollQuestion)));
  const primeira = tentado.match(/<input[^>]*aria-label="Opção 1"[^>]*>/)?.[0] ?? "";
  const segunda = tentado.match(/<input[^>]*aria-label="Opção 2"[^>]*>/)?.[0] ?? "";
  assert.doesNotMatch(primeira, /aria-invalid="/, "a opcao escrita fica sem erro");
  assert.match(segunda, /aria-invalid="true"/);
  assert.match(segunda, /aria-describedby="console-poll-form-[^"]*-opcao-2-error"/);
  assert.match(tentado, /<p[^>]*id="console-poll-form-[^"]*-opcao-2-error"[^>]*>Escreva cada opção \(até 120 caracteres\)\.<\/p>/);

  // O estado puro: os erros pelo pollDraftSchema, no caminho do campo; o que vai para a acao, sem espacos nas pontas.
  assert.deepEqual(consolePollErrors(pollFormState()), { "options.0.label": CHAT_MESSAGES.option, "options.1.label": CHAT_MESSAGES.option, question: CHAT_MESSAGES.pollQuestion });
  assert.deepEqual(consolePollErrors(pollFormState({ options: [{ key: "a", label: "Sim" }, { key: "b", label: "Não" }], question: " Vem? " })), {});
  assert.deepEqual(consolePollInput(pollFormState({ kind: "survey", options: [{ key: "a", label: " Sim " }, { key: "b", label: "Não" }], question: " Vem? " })), {
    kind: "survey",
    options: [{ label: "Sim" }, { label: "Não" }],
    question: "Vem?"
  });
  assert.equal(consolePollErrors(pollFormState({ options: [{ key: "a", label: "x".repeat(121) }, { key: "b", label: "Não" }], question: "Vem?" }))["options.0.label"], CHAT_MESSAGES.option);
});

test("D83 Nova enquete: adicionar ate 20 opcoes e remover ate 2 (as escritas ficam no lugar); o formulario novo com duas vazias e Uma opção", () => {
  const inicio = emptyConsolePoll();
  assert.deepEqual([inicio.kind, inicio.question, inicio.options.map((option) => option.label)], ["single", "", ["", ""]]);
  assert.notEqual(inicio.options[0].key, inicio.options[1].key);
  let state = { ...inicio, options: [{ key: "a", label: "Sim" }, { key: "b", label: "Não" }] };
  state = withNewOption(state);
  assert.deepEqual(state.options.map((option) => option.label), ["Sim", "Não", ""]);
  assert.deepEqual(withoutOption(state, "a").options.map((option) => option.label), ["Não", ""], "remove a escolhida, as outras ficam");
  assert.equal(withoutOption({ ...state, options: state.options.slice(0, 2) }, "a").options.length, 2, "no minimo, nada sai");
  let cheio = state;
  for (let index = 0; index < 30; index += 1) {
    cheio = withNewOption(cheio);
  }
  assert.equal(cheio.options.length, 20, "no maximo 20");
  const markup = html(createElement(ConsolePollForm, pollFormProps({ initialState: { ...cheio, question: "Vem?" } })));
  assert.match(markup.match(/<button[^>]*data-console-poll-add-option=""[^>]*>/)?.[0] ?? "", /\sdisabled=""/, "no maximo, Adicionar opção desligado");
  const remover = (tags) => (tags.match(/<button[^>]*>/g) ?? []).filter((tag) => /aria-label="Remover opção \d+"/.test(tag));
  assert.equal(remover(markup).length, 20);
  assert.ok(remover(markup).every((tag) => !/\sdisabled=""/.test(tag)), "acima do minimo, todo remover ligado");
});

test("D83 a lista das prontas com a nova: o SessionConsole passa as prontas do retrato (a criada no console com Abrir e Abrir e fixar) e o Nova enquete", () => {
  const criada = { ...templates[1], id: "t-nova", position: 2, question: "Qual tema na próxima?" };
  const snapshot = {
    askedMessageIds: [],
    barred: null,
    live: null,
    messages: [],
    pinned: null,
    pinnedMessageId: null,
    pinnedPollId: null,
    polls: { launched, templates: [...templates, criada] },
    presentNow: 3,
    questions: [],
    scriptFired: {},
    scriptItems: [],
    screen: { active: [], items: [], pending: false, stats: {} },
    serverTime: new Date(NOW).toISOString(),
    session: session()
  };
  const webinar = { durationMinutes: 60, hostUserId: "u-host", id: WEBINAR, kind: "simulated", recordingDurationSeconds: 3600, slug: "aula-de-ia", title: "Aula de IA" };
  const markup = html(createElement(SessionConsole, { currentUserId: "u-host", data: { sessions: [snapshot.session], snapshot, webinar }, permissions: { canPublish: true, canWrite: true }, serverNow: NOW }));
  assert.deepEqual(botoes(markup, 'data-console-poll-template="t-nova"'), ["Abrir", "Abrir e fixar"]);
  assert.match(textOf(block(markup, 'data-console-poll-template="t-nova"', "li")), /^Qual tema na próxima\?/);
  assert.equal(count(markup, /data-console-poll-new=""/g), 1, "o Nova enquete na entrada Enquetes");
  const fonte = readFileSync(new URL("../src/components/admin/v2/communication/webinars/session-console/session-console.tsx", import.meta.url), "utf8");
  assert.match(fonte, /onCreate=\{submitPoll\}/);
  assert.match(fonte, /createConsolePoll\(\{ \.\.\.input, launch, sessionId \}\)/, "a sessao do console e o que fazer vao com o formulario");
  assert.match(fonte, /setFailure\(result\.data\.launchError\)/, "abrir que falha depois de guardar vai para o banner do console");
});

/* ------------------------------------------------------------------------------------------------
 * R3 e R4: a entrada Na tela, os prontos e os dois formularios
 * ---------------------------------------------------------------------------------------------- */

const { ConsoleScreen, consoleScreenCount } = await import("../src/components/admin/v2/communication/webinars/session-console/console-screen.tsx");
const screenForm = await import("../src/components/admin/v2/communication/webinars/session-console/console-screen-form.tsx");
const { ConsoleRail } = await import("../src/components/admin/v2/communication/webinars/session-console/console-rail.tsx");
const { SCREEN_MIGRATION, SCREEN_PLACES, screenStageKinds } = await import("../src/server/webinars/screen-model.ts");
const { ConsoleScreenForm, ScreenPreview } = screenForm;

const consoleCopy = naTela.console;
const formCopy = naTela.formulario;
const LIVE_CONSOLE_COPY_DESFAZER = WEBINAR_COPY.consoleAoVivo.desfazer;
const ORIGEM = "https://projeto.supabase.co";
const IMAGEM = "webinars/screen/0123456789abcdef01234567.webp";

function itemPronto(extra = {}) {
  return {
    archivedAt: null,
    body: "Só até o fim da aula.",
    buttonLabel: "Quero",
    closable: true,
    createdAt: new Date(NOW - 60 * MIN).toISOString(),
    id: "i-banner",
    image: null,
    kind: "banner",
    linkUrl: "https://exemplo.com/vaga",
    name: "Banner da vaga",
    place: "bottom_right",
    size: "m",
    title: "Garanta sua vaga",
    updatedAt: new Date(NOW - 60 * MIN).toISOString(),
    webinarId: WEBINAR,
    ...extra
  };
}

/** A copia que o Mostrar congela de um item (o snapshot v1). */
const copiaDe = (item) => ({ body: item.body, buttonLabel: item.buttonLabel, closable: item.closable, image: item.image, linkUrl: item.linkUrl, name: item.name, place: item.place, size: item.size, title: item.title, v: 1 });

function exibicaoDe(item, extra = {}) {
  return {
    createdAt: new Date(NOW - 3 * MIN).toISOString(),
    hiddenAt: null,
    hiddenBy: null,
    hiddenOffsetMs: null,
    hiddenReason: null,
    id: `d-${item.id}`,
    itemId: item.id,
    kind: item.kind,
    pollId: null,
    sessionId: S_LIVE,
    shownAt: new Date(NOW - 3 * MIN - 10_000).toISOString(),
    shownBy: "u-host",
    shownOffsetMs: 120_000,
    snapshot: copiaDe(item),
    ...extra
  };
}

const banner = itemPronto();
const outroBanner = itemPronto({ body: null, buttonLabel: null, id: "i-aviso", linkUrl: null, name: "Aviso do intervalo", place: "top_left", title: "Intervalo de 5 min" });
const qrPronto = itemPronto({ body: null, buttonLabel: null, id: "i-qr", kind: "qr", linkUrl: "https://exemplo.com/material", name: "Material", place: "top_right", title: "Baixe o material" });
const editado = itemPronto({ id: "i-editado", name: "Editado depois", title: "Título novo" });
const enqueteFixada = { createdAt: new Date(NOW - MIN).toISOString(), hiddenAt: null, hiddenBy: null, hiddenOffsetMs: null, hiddenReason: null, id: "d-poll", itemId: null, kind: "poll", pollId: "p-fixada", sessionId: S_LIVE, shownAt: new Date(NOW - MIN).toISOString(), shownBy: "u-host", shownOffsetMs: 0, snapshot: { name: "Gostou da aula?", v: 1 } };

function screenProps(extra = {}) {
  return {
    busyKey: null,
    canAct: true,
    nowMs: NOW,
    onArchive: async () => true,
    onHide() {},
    onSave: async () => null,
    onShow() {},
    onUnpinMessage() {},
    onUnpinPoll() {},
    onUpload: async () => ({ error: "x", ok: false, status: 500 }),
    pinned: null,
    polls: [],
    screen: { active: [], items: [], pending: false, stats: {} },
    webinarId: WEBINAR,
    webinarSlug: "aula-de-ia",
    ...extra
  };
}

function formProps(extra = {}) {
  return { busy: false, canShow: true, item: null, items: [], kind: "banner", onBack() {}, onSave: async () => null, onUpload: async () => ({ error: "x", ok: false, status: 500 }), webinarId: WEBINAR, webinarSlug: "aula-de-ia", ...extra };
}

/** Os rotulos dos <label> e das <legend> de um pedaco do html, na ordem. */
const rotulos = (markup) => Array.from(markup.matchAll(/<(?:label|legend)[^>]*>([^<]+)/g)).map((match) => match[1].replace(/&#x27;/g, "'").trim());

test("Na tela agora: a mensagem e a enquete fixadas com o Desafixar, o banner e o QR Code com ha quanto tempo, os numeros da exibicao e o Tirar da tela; vazio, a frase; sem poder agir, nenhum botao", () => {
  const props = screenProps({
    pinned: antiga,
    screen: {
      active: [exibicaoDe(banner), exibicaoDe(qrPronto, { shownAt: new Date(NOW - 65 * MIN).toISOString() }), enqueteFixada],
      items: [banner, qrPronto],
      pending: false,
      stats: { [`d-${banner.id}`]: { clickers: 41, clicks: 57, closed: 9, shown: 312 } }
    }
  });
  const markup = html(createElement(ConsoleScreen, props));
  const agora = block(markup, 'data-console-screen-now=""', "ul");
  const linhas = Array.from(agora.matchAll(/data-console-screen-now-item="([^"]+)"/g)).map((match) => match[1]);
  assert.deepEqual(linhas, ["message", "poll", "banner", "qr"], "a mensagem, a enquete e depois os cartoes");

  assert.equal(textOf(block(agora, 'data-console-screen-now-item="message"', "li")), `Mensagem fixada · Bia C.: ${antiga.body} ${consoleCopy.desafixar}`);
  assert.equal(textOf(block(agora, 'data-console-screen-now-item="poll"', "li")), `Enquete fixada · Gostou da aula? ${consoleCopy.desafixar}`);
  const linhaBanner = block(agora, 'data-console-screen-now-item="banner"', "li");
  assert.equal(textOf(linhaBanner), "Banner · Banner da vaga há 3 min · 312 viram · 41 clicaram · 9 fecharam Tirar da tela");
  assert.match(linhaBanner, /<time[^>]*>há 3 min<\/time>/);
  assert.match(linhaBanner, new RegExp(`data-console-screen-hide="d-${banner.id}"`));
  assert.equal(textOf(block(agora, 'data-console-screen-now-item="qr"', "li")), "QR Code · Material há 1 h 5 min · 0 viram · 0 clicaram · 0 fecharam Tirar da tela", "sem numeros ainda, zero");
  assert.equal(consoleScreenCount({ active: props.screen.active, pinnedMessageId: antiga.id }), 4);
  assert.equal(consoleScreenCount({ active: [], pinnedMessageId: null }), 0);

  const vazio = html(createElement(ConsoleScreen, screenProps()));
  assert.match(textOf(vazio), new RegExp(`${consoleCopy.agora} ${consoleCopy.agoraVazio}`));
  assert.doesNotMatch(vazio, /data-console-screen-now=/);

  const soLeitura = block(html(createElement(ConsoleScreen, { ...props, canAct: false })), 'data-console-screen-now=""', "ul");
  assert.doesNotMatch(soLeitura, /<button/, "sem poder agir, so a lista");
});

test("Prontos: cada item com o nome, o selo do tipo, o resumo, a Previa e o botao do estado (Mostrar, Mostrar no lugar do atual, Na tela com Tirar da tela, Mostrar de novo) e o ⋯ com Editar e Excluir", () => {
  const editadoMostrado = exibicaoDe({ ...editado, title: "Título de antes" });
  const props = screenProps({
    screen: { active: [exibicaoDe(outroBanner), editadoMostrado], items: [banner, outroBanner, qrPronto, editado], pending: false, stats: {} }
  });
  // O editado e o outro banner nao podem estar na tela juntos: cada linha olha so a exibicao do seu tipo.
  const soOutro = html(createElement(ConsoleScreen, { ...props, screen: { ...props.screen, active: [exibicaoDe(outroBanner)] } }));
  const linha = (markup, id) => block(markup, `data-console-screen-item="${id}"`, "li");

  assert.match(linha(soOutro, banner.id), /data-screen-state="replace"/);
  // (O ⋯ do teste desenha os itens do menu no lugar: Editar e Excluir no fim de cada linha.)
  const menu = `${consoleCopy.editar} ${consoleCopy.excluir}`;
  assert.equal(textOf(linha(soOutro, banner.id)), `Banner da vaga Banner Embaixo, à direita · Médio · o aluno pode fechar ${consoleCopy.previa} ${consoleCopy.mostrarNoLugar} ${menu}`);
  assert.match(linha(soOutro, outroBanner.id), /data-screen-state="on"/);
  // Na tela, o Excluir fica desligado com o motivo (achado 5 da revisao de 11/11/2026).
  assert.equal(textOf(linha(soOutro, outroBanner.id)), `Aviso do intervalo Banner ${consoleCopy.seloNaTela} Em cima, à esquerda · Médio · o aluno pode fechar ${consoleCopy.previa} ${consoleCopy.tirarDaTela} ${menu} ${naTela.erros.tireDaTela}`);
  assert.match(linha(soOutro, qrPronto.id), /data-screen-state="show"/);
  assert.equal(textOf(linha(soOutro, qrPronto.id)), `Material QR Code Em cima, à direita · Médio · o aluno pode fechar ${consoleCopy.previa} ${consoleCopy.mostrar} ${menu}`);

  const comEditado = html(createElement(ConsoleScreen, { ...props, screen: { ...props.screen, active: [editadoMostrado] } }));
  assert.match(linha(comEditado, editado.id), /data-screen-state="again"/);
  assert.match(textOf(linha(comEditado, editado.id)), new RegExp(`${consoleCopy.mostrarDeNovo} ${consoleCopy.editar} ${consoleCopy.excluir} ${naTela.erros.tireDaTela}$`), "editado, mas ainda na tela: o Excluir espera");

  // A Previa fechada (aria-expanded), o ⋯ com o nome do item, Editar e Excluir.
  const previa = linha(soOutro, banner.id).match(/<button[^>]*data-console-screen-preview="i-banner"[^>]*>/)?.[0] ?? "";
  assert.match(previa, /aria-expanded="false"/);
  assert.match(previa, /aria-controls="console-screen-preview-i-banner"/);
  assert.match(linha(soOutro, banner.id), /<div hidden="" id="console-screen-preview-i-banner"><\/div>/);
  assert.match(linha(soOutro, banner.id), new RegExp(`aria-label="${consoleCopy.maisAcoes("Banner da vaga")}"`));
  assert.deepEqual(
    Array.from(block(linha(soOutro, banner.id), 'role="menu"', "div").matchAll(/role="menuitem"[^>]*>([\s\S]*?)<\/div>/g)).map((match) => textOf(match[1])),
    [consoleCopy.editar, consoleCopy.excluir]
  );

  // Novo banner e Novo QR Code no cabecalho dos Prontos.
  assert.deepEqual(
    Array.from(soOutro.matchAll(/data-console-screen-new="([^"]+)"[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]+)</g)).map((match) => [match[1], match[2]]),
    [["banner", consoleCopy.novoBanner], ["qr", consoleCopy.novoQr]]
  );

  // Vazio; sem poder agir, nem os botoes nem o ⋯; ocupado, desligados.
  assert.match(textOf(html(createElement(ConsoleScreen, screenProps()))), new RegExp(consoleCopy.prontosVazio));
  const soLeitura = html(createElement(ConsoleScreen, { ...props, canAct: false }));
  assert.doesNotMatch(soLeitura, /data-console-screen-new|data-console-screen-show|data-console-screen-menu/);
  assert.match(soLeitura, /data-console-screen-preview="i-banner"/, "a Previa continua");
  const ocupado = html(createElement(ConsoleScreen, { ...props, busyKey: "screen:i-banner" }));
  assert.match(linha(ocupado, banner.id).match(/<button[^>]*data-console-screen-show=[^>]*>/)?.[0] ?? "", /\sdisabled=""/);
});

test("achado 5 (revisao de 11/11/2026): o Excluir do item na tela fica desligado com o motivo; a falha da confirmacao aparece dentro dela", () => {
  const props = screenProps({ screen: { active: [exibicaoDe(outroBanner)], items: [banner, outroBanner], pending: false, stats: {} } });
  const markup = html(createElement(ConsoleScreen, props));
  const linha = (id) => block(markup, `data-console-screen-item="${id}"`, "li");
  const excluirDe = (id) => Array.from(block(linha(id), 'role="menu"', "div").matchAll(/<div([^>]*)role="menuitem"[^>]*>([\s\S]*?)<\/div>/g)).map((match) => [match[1].includes('aria-disabled="true"'), textOf(match[2])]);
  assert.deepEqual(excluirDe(outroBanner.id), [[false, consoleCopy.editar], [true, `${consoleCopy.excluir} ${naTela.erros.tireDaTela}`]], "na tela: desligado, com o motivo");
  assert.deepEqual(excluirDe(banner.id), [[false, consoleCopy.editar], [false, consoleCopy.excluir]], "fora da tela: liga");
  assert.match(linha(outroBanner.id), /data-console-screen-delete-reason=""/);

  // A confirmacao aberta com a falha do servidor (o item na tela de outra sessao): o aviso dentro dela, nunca so no banner do console.
  const comFalha = html(createElement(ConsoleScreen, { ...props, initialArchive: { error: naTela.erros.tireDaTela, itemId: banner.id } }));
  const dialogo = block(comFalha, 'role="dialog"', "div");
  assert.match(textOf(dialogo), new RegExp(consoleCopy.excluirConfirmar(banner.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(dialogo, new RegExp(`<p[^>]*data-console-screen-archive-error=""[^>]*role="alert"[^>]*>${naTela.erros.tireDaTela}</p>`));
  const semFalha = block(html(createElement(ConsoleScreen, { ...props, initialArchive: { error: null, itemId: banner.id } })), 'role="dialog"', "div");
  assert.doesNotMatch(semFalha, /data-console-screen-archive-error/);
});

test("achado 6 (revisao de 11/11/2026): o foco do teclado: o titulo do formulario e os das secoes recebem o foco (tabIndex -1); ao fechar, o botao que abriu, ou o titulo quando ele saiu com o item", async () => {
  const { consoleFocusIsLoose, consoleFocusTarget } = await import("../src/components/admin/v2/communication/webinars/session-console/console-focus.ts");
  // Os titulos focaveis: Na tela agora e Prontos; os formularios do banner, do QR Code e do Novo comentário; o Roteiro.
  const lista = html(createElement(ConsoleScreen, screenProps({ screen: { active: [exibicaoDe(banner)], items: [banner], pending: false, stats: {} } })));
  assert.match(lista, /<h2[^>]*id="console-screen-now-title"[^>]*tabindex="-1"|<h2[^>]*tabindex="-1"[^>]*id="console-screen-now-title"/);
  assert.match(lista, /<h2(?=[^>]*id="console-screen-ready-title")(?=[^>]*tabindex="-1")/);
  for (const kind of ["banner", "qr"]) {
    const form = html(createElement(ConsoleScreenForm, formProps({ kind })));
    assert.match(form, /<h2(?=[^>]*id="console-screen-[a-z]+-[^"]*-titulo")(?=[^>]*tabindex="-1")/, kind);
  }
  const { ConsoleScript } = await import("../src/components/admin/v2/communication/webinars/session-console/console-script.tsx");
  const roteiro = { busyKey: null, canAct: true, live: true, onComment: async () => null, onFire() {}, onUpload: async () => ({ error: "x", ok: false, status: 500 }), origin: ORIGEM, queue: [] };
  assert.match(html(createElement(ConsoleScript, roteiro)), /<h2(?=[^>]*id="console-script-title")(?=[^>]*tabindex="-1")/);
  const comentario = html(createElement(ConsoleScript, { ...roteiro, initialComment: { applyToName: true, body: "", personaAvatarPath: null, personaName: "", personaRole: "student" } }));
  assert.match(comentario, /<h2(?=[^>]*id="console-script-comment-[^"]*-titulo")(?=[^>]*tabindex="-1")/);
  // D83 (11/11/2026): as Enquetes ganharam a "Nova enquete" no lugar da lista, no mesmo padrao do Roteiro: o titulo das
  // Enquetes e o do formulario tambem recebem o foco.
  assert.match(html(createElement(ConsolePolls, pollsProps())), /<h2(?=[^>]*id="console-polls-title")(?=[^>]*tabindex="-1")/);
  const novaEnquete = html(createElement(ConsolePolls, pollsProps({ initialCreate: { kind: "single", options: [{ key: "a", label: "" }, { key: "b", label: "" }], question: "" }, onCreate: async () => null })));
  assert.match(novaEnquete, /<h2(?=[^>]*id="console-poll-form-[^"]*-titulo")(?=[^>]*tabindex="-1")/);
  // Os outros SectionCard do admin continuam sem tabIndex no titulo.
  const { ConsolePresencePanel } = await import("../src/components/admin/v2/communication/webinars/session-console/console-presence.tsx");
  const presenca = html(createElement(ConsolePresencePanel, { presence: { curve: [], messagesLastMinute: 0, messagesPerMinuteAvg: 0, minute: 0, peak: null }, presentNow: 0 }));
  assert.match(presenca, /<h2[^>]*id="console-presence-title"/);
  assert.doesNotMatch(presenca.match(/<h2[^>]*>/)?.[0] ?? "", /tabindex/);

  // Para onde o foco volta: o botao que abriu, se ainda esta na pagina e ligado; senao o titulo da secao.
  const el = (name, extra = {}) => ({ disabled: false, focus() {}, isConnected: true, name, ...extra });
  const titulo = el("titulo");
  const raiz = (achados) => ({ getElementById: (id) => (id === "console-screen-ready-title" ? titulo : null), querySelector: (selector) => achados[selector] ?? null });
  const novo = el("novo");
  const ask = { heading: "console-screen-ready-title", opener: '[data-console-screen-new="banner"]' };
  assert.equal(consoleFocusTarget(raiz({ [ask.opener]: novo }), ask), novo, "Voltar: o Novo banner");
  assert.equal(consoleFocusTarget(raiz({}), ask), titulo, "o botao saiu com o item (Excluir): o titulo dos Prontos");
  assert.equal(consoleFocusTarget(raiz({ [ask.opener]: el("novo", { disabled: true }) }), ask), titulo, "desligado nao recebe o foco");
  assert.equal(consoleFocusTarget(raiz({}), { heading: "console-screen-ready-title", opener: null }), titulo, "Tirar da tela e Desafixar: o titulo da secao");
  assert.equal(consoleFocusTarget(null, ask), null);
  // O foco so e movido quando esta solto (no body ou num elemento que saiu da pagina).
  const body = {};
  assert.equal(consoleFocusIsLoose(null, body), true);
  assert.equal(consoleFocusIsLoose(body, body), true);
  assert.equal(consoleFocusIsLoose({ isConnected: false }, body), true, "o botao que sumiu com o item");
  assert.equal(consoleFocusIsLoose({ isConnected: true }, body), false, "quem levou o foco para outro lugar fica onde esta");

  // As acoes que tiram o botao da tela devolvem a promessa (o foco segue depois do retrato novo) e a confirmacao do
  // Excluir manda o foco para o ⋯ do item ou para o titulo dos Prontos.
  const fonte = readFileSync(new URL("../src/components/admin/v2/communication/webinars/session-console/console-screen.tsx", import.meta.url), "utf8");
  assert.match(fonte, /finalFocus=\{\(\) => consoleFocusTarget<HTMLElement>\(document, \{ heading: READY_TITLE, opener: archiveOpener\.current \? `\[data-console-screen-menu="\$\{archiveOpener\.current\}"\]` : null \}\)\}/);
  assert.match(fonte, /archiveOpener\.current = item\.id;/, "o ⋯ de onde a confirmacao abriu fica guardado (ela fecha ja sem o item no estado)");
  assert.equal(count(fonte, /afterAction\(on(?:Hide|UnpinMessage|UnpinPoll)\(/g), 4, "Tirar da tela (na lista e nos Prontos) e os dois Desafixar");
  const consoleFonte = readFileSync(new URL("../src/components/admin/v2/communication/webinars/session-console/session-console.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(consoleFonte, /onHide=\{\(displayId: string\) => void run|onUnpinMessage=\{\(messageId: string\) => void run|onUnpinPoll=\{\(pollId: string\) =>\s+void run/, "as acoes devolvem a promessa");
});

test("Prontos sem a 202611100002: o aviso da migracao no lugar da lista e nada para criar", () => {
  assert.equal(SCREEN_MIGRATION, "202611100002");
  assert.match(readFileSync(new URL("src/server/webinars/db.ts", root), "utf8"), new RegExp(`export const WEBINARS_SCREEN_MIGRATION = "${SCREEN_MIGRATION}";`), "a mesma migracao do servidor");
  const markup = html(createElement(ConsoleScreen, screenProps({ screen: { active: [], items: [], pending: true, stats: {} } })));
  assert.match(textOf(markup), /migração 202611100002/);
  assert.doesNotMatch(markup, /data-console-screen-new/);
  assert.doesNotMatch(textOf(markup), new RegExp(consoleCopy.prontosVazio));
});

test("formulario do banner: todos os rotulos na ordem, os nove pontos de Onde aparece como radios (Embaixo, à direita marcado), Médio, o aluno pode fechar ligado, os avisos fixos, a Previa e os botoes", () => {
  const markup = html(createElement(ConsoleScreenForm, formProps()));
  const formulario = block(markup, 'data-console-screen-form="banner"', "form");
  assert.match(textOf(markup), new RegExp(`^${consoleCopy.novoBanner} ${consoleCopy.voltar}`), "o titulo e o Voltar");
  assert.deepEqual(rotulos(formulario).filter((rotulo) => !Object.values(naTela.lugares).includes(rotulo) && !Object.values(naTela.tamanhos).includes(rotulo) && rotulo !== formCopy.previaComputador && rotulo !== formCopy.previaCelular), [
    formCopy.nome,
    formCopy.titulo,
    formCopy.texto,
    formCopy.textoDoBotao,
    formCopy.link,
    formCopy.ondeAparece
  ]);
  assert.equal(formCopy.nome, "Nome (só a equipe vê)");
  assert.match(formulario, new RegExp(`${formCopy.imagem}<`), "Imagem");
  assert.match(textOf(formulario), new RegExp(`${formCopy.enviarImagem} ${formCopy.imagemDica.replace(/\./g, "\\.")}`));
  assert.doesNotMatch(formulario, new RegExp(formCopy.descricao.replace(/[()]/g, "\\$&")), "sem imagem, sem a descricao");
  assert.match(textOf(formulario), new RegExp(formCopy.textoDoBotaoDica));

  // Onde aparece: nove radios com o nome de cada posicao, o padrao do banner marcado.
  const pontos = block(formulario, 'data-console-screen-place=""', "fieldset");
  const radios = Array.from(pontos.matchAll(/<input([^>]*)type="radio"[^>]*>/g)).map((match) => match[0]);
  assert.equal(radios.length, 9);
  assert.deepEqual(Array.from(pontos.matchAll(/<span class="sr-only">([^<]+)<\/span>/g)).map((match) => match[1]), SCREEN_PLACES.map((place) => naTela.lugares[place]));
  assert.match(radios[8], /checked=""/);
  assert.match(radios[8], /value="bottom_right"/);
  assert.equal(radios.filter((radio) => /checked=""/.test(radio)).length, 1);

  // Tamanho: Pequeno, Médio (marcado) e Grande; o aluno pode fechar ligado.
  const tamanho = block(formulario, 'data-console-screen-size=""', "div");
  assert.match(textOf(tamanho), /Tamanho Pequeno Médio Grande/);
  assert.match(tamanho, /<input[^>]*checked=""[^>]*value="m"/);
  assert.match(formulario, new RegExp(`role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"`));
  assert.match(textOf(formulario), new RegExp(formCopy.podeFechar));

  // Os avisos fixos; sem "No meio e sem fechar".
  const avisos = textOf(block(formulario, 'data-console-screen-notices=""', "ul"));
  assert.equal(avisos, `${formCopy.avisoCelular} ${formCopy.avisoPrazo} ${formCopy.avisoOferta}`);

  // A Previa com Computador e Celular, e os botoes na ordem.
  const previa = block(formulario, 'data-console-screen-preview-block=""', "section");
  assert.match(textOf(previa), new RegExp(`^${formCopy.previa} ${formCopy.previaComputador} ${formCopy.previaCelular}`));
  assert.match(previa, /data-screen-preview="desktop"/);
  assert.match(previa, /data-room-screen-layer=""/, "desenhada pela camada do palco do aluno");
  assert.deepEqual(
    Array.from(block(formulario, 'data-console-screen-form-actions=""', "div").matchAll(/<button[^>]*>([^<]+)<\/button>/g)).map((match) => match[1]),
    [formCopy.mostrarAgora, formCopy.salvarParaDepois, formCopy.cancelar]
  );
  assert.doesNotMatch(html(createElement(ConsoleScreenForm, formProps({ canShow: false }))), new RegExp(`>${formCopy.mostrarAgora}<`), "sem a sessao aceitando a equipe, so salvar");
});

test("formulario do banner com imagem, no meio e sem fechar: a imagem da nossa origem com Trocar e Remover, a descricao, o aviso do meio, a dica do sem fechar e o Grande desligado", () => {
  const item = itemPronto({ closable: false, image: { alt: "Turma reunida", height: 360, path: IMAGEM, width: 640 }, place: "center", size: "m" });
  const formulario = block(html(createElement(ConsoleScreenForm, formProps({ item }))), 'data-console-screen-form="banner"', "form");
  assert.match(textOf(html(createElement(ConsoleScreenForm, formProps({ item })))), new RegExp(`^${consoleCopy.editarBanner}`));
  assert.match(formulario, new RegExp(`<img[^>]*src="${ORIGEM}/storage/v1/object/public/content-assets/${IMAGEM}"`));
  assert.doesNotMatch(formulario, /src="(?!https:\/\/projeto\.supabase\.co\/)/, "nenhuma imagem de fora");
  assert.match(textOf(block(formulario, 'data-console-screen-image=""', "div")), new RegExp(`${formCopy.trocarImagem} ${formCopy.removerImagem}`));
  assert.ok(rotulos(formulario).includes(formCopy.descricao), "a descricao da imagem");
  assert.match(formulario, /value="Turma reunida"/);
  assert.match(textOf(formulario), new RegExp(formCopy.semFecharDica));
  assert.match(formulario, /data-console-screen-center-warning=""/);
  assert.match(textOf(block(formulario, 'data-console-screen-notices=""', "ul")), new RegExp(`${formCopy.avisoMeio.replace(/\./g, "\\.")}$`));
  const grande = block(formulario, 'data-console-screen-size=""', "div").match(/<label[^>]*>(?:(?!<\/label>)[\s\S])*value="l"[\s\S]*?<\/label>/)?.[0] ?? "";
  assert.match(grande, /<input[^>]*disabled=""/, "Grande fica de fora no meio sem fechar");
  assert.match(block(formulario, 'data-console-screen-place=""', "fieldset"), /<input[^>]*checked=""[^>]*value="center"/);
});

test("formulario do QR Code: Link com a dica dos 240, Usar um link pronto (a pagina deste webinario e os links dos banners salvos), o codigo desenhado ao lado (role img com o dominio), Legenda, Onde aparece em cima a direita, Tamanho, O aluno pode fechar e Nome", () => {
  const markup = html(createElement(ConsoleScreenForm, formProps({ item: qrPronto, items: [banner, outroBanner, qrPronto], kind: "qr" })));
  const formulario = block(markup, 'data-console-screen-form="qr"', "form");
  assert.match(textOf(markup), new RegExp(`^${consoleCopy.editarQr}`));
  assert.deepEqual(rotulos(formulario).filter((rotulo) => !Object.values(naTela.lugares).includes(rotulo) && !Object.values(naTela.tamanhos).includes(rotulo) && rotulo !== formCopy.previaComputador && rotulo !== formCopy.previaCelular), [
    formCopy.link,
    formCopy.legenda,
    formCopy.ondeAparece,
    formCopy.nome
  ]);
  assert.match(textOf(formulario), new RegExp(formCopy.qrLinkDica));
  assert.match(formulario, /maxLength="240"|maxlength="240"/i);

  // Usar um link pronto: a pagina deste webinario e o link do banner salvo (o aviso sem link e o proprio QR Code ficam de fora).
  const menu = block(formulario, 'role="menu"', "div");
  assert.match(textOf(formulario), new RegExp(formCopy.linkPronto));
  assert.equal(textOf(menu), `${formCopy.linkPaginaDoWebinario} Banner da vaga https://exemplo.com/vaga`);

  // O codigo ao lado: o svg com role img e o nome pelo dominio, preto no branco; a dica de onde ele nasce.
  const codigo = block(formulario, 'data-console-screen-qr=""', "div");
  assert.match(codigo, /<svg[^>]*role="img"/);
  assert.match(codigo, /aria-label="QR Code do link exemplo\.com"/);
  assert.match(textOf(codigo), new RegExp(formCopy.qrGerado));
  assert.doesNotMatch(codigo, /data-console-screen-qr-dense/, "o link curto nao e denso");
  assert.match(block(formulario, 'data-console-screen-place=""', "fieldset"), /<input[^>]*checked=""[^>]*value="top_right"/);
  assert.doesNotMatch(formulario, new RegExp(formCopy.avisoOferta), "os avisos do banner nao entram no QR Code");
  assert.doesNotMatch(formulario, /data-console-screen-image/);

  // O novo QR Code nasce em cima a direita, sem codigo ate o link valer; o link comprido no Pequeno fica denso.
  const novo = html(createElement(ConsoleScreenForm, formProps({ kind: "qr" })));
  assert.match(block(novo, 'data-console-screen-place=""', "fieldset"), /<input[^>]*checked=""[^>]*value="top_right"/);
  assert.doesNotMatch(block(novo, 'data-console-screen-qr=""', "div"), /<svg[^>]*role="img"/);
  const longo = itemPronto({ body: null, buttonLabel: null, id: "i-longo", kind: "qr", linkUrl: `https://exemplo.com/${"a".repeat(180)}`, size: "s", title: null });
  assert.match(html(createElement(ConsoleScreenForm, formProps({ item: longo, kind: "qr" }))), new RegExp(`data-console-screen-qr-dense="">${formCopy.qrDenso}`));
  assert.doesNotMatch(html(createElement(ConsoleScreenForm, formProps({ item: { ...longo, size: "l" }, kind: "qr" }))), /data-console-screen-qr-dense/, "no Grande cabe");
});

test("o estado do formulario: o Grande sai no meio sem fechar, os textos sem espacos, o QR Code sem texto nem imagem, os erros pelo mesmo zod do servidor e os links prontos", () => {
  const { screenFormErrors, screenFormInput, screenFormStart, screenFormWith, screenPageLink, screenReadyLinks } = screenForm;
  const novo = screenFormStart("banner");
  assert.deepEqual([novo.place, novo.size, novo.closable], ["bottom_right", "m", true]);
  assert.equal(screenFormStart("qr").place, "top_right");
  const grande = screenFormWith(novo, { size: "l" });
  assert.equal(screenFormWith(screenFormWith(grande, { place: "center" }), { closable: false }).size, "m", "no meio sem fechar, o Grande vira Medio");
  assert.equal(screenFormWith(grande, { closable: false }).size, "l", "sem fechar fora do meio, o Grande fica");

  const entrada = screenFormInput({ ...novo, body: "  oi  ", buttonLabel: " ", image: { height: 10, path: IMAGEM, width: 10 }, imageAlt: " Foto ", linkUrl: " https://exemplo.com ", title: "" }, WEBINAR);
  assert.deepEqual([entrada.body, entrada.buttonLabel, entrada.imageAlt, entrada.imagePath, entrada.linkUrl, entrada.title, entrada.name], ["oi", null, "Foto", IMAGEM, "https://exemplo.com", null, null]);
  assert.ok(!("width" in entrada) && !("height" in entrada), "as medidas nunca vao do navegador");
  const qr = screenFormInput({ ...screenFormStart("qr"), body: "x", buttonLabel: "y", image: { height: 10, path: IMAGEM, width: 10 }, linkUrl: "https://exemplo.com" }, WEBINAR);
  assert.deepEqual([qr.body, qr.buttonLabel, qr.imagePath, qr.imageAlt], [null, null, null, null]);

  assert.deepEqual(screenFormErrors(novo, WEBINAR), { title: naTela.erros.imagemOuTitulo });
  assert.deepEqual(screenFormErrors({ ...screenFormStart("qr"), linkUrl: "http://exemplo.com" }, WEBINAR), { linkUrl: naTela.erros.link });
  assert.deepEqual(screenFormErrors({ ...novo, title: "Oi" }, WEBINAR), {});

  assert.equal(screenPageLink("aula-de-ia", "https://membros.exemplo.com/qualquer"), "https://membros.exemplo.com/webinarios/aula-de-ia");
  assert.equal(screenPageLink("aula-de-ia", "http://localhost:3000"), null, "so https");
  assert.equal(screenPageLink("aula-de-ia", "nada"), null);
  assert.equal(screenPageLink("aula-de-ia", null), null);
  const longo = itemPronto({ id: "i-longo", linkUrl: `https://exemplo.com/${"a".repeat(240)}`, name: "Longo" });
  assert.deepEqual(screenReadyLinks([banner, outroBanner, qrPronto, longo, { ...banner, id: "i-repetido", name: "Repetido" }], "https://membros.exemplo.com/webinarios/aula-de-ia"), [
    { label: formCopy.linkPaginaDoWebinario, url: "https://membros.exemplo.com/webinarios/aula-de-ia" },
    { label: "Banner da vaga", url: "https://exemplo.com/vaga" }
  ]);
});

test("a Previa pelo componente do aluno: no Computador, a camada do palco (@container/tela) num palco 16:9 de 1280 x 720 com o cartao na posicao e na largura do tamanho; no Celular, a 390 px, a linha da faixa abaixo do video com o X so quando pode fechar; tudo dentro da moldura inert, sem handlers", () => {
  const { screenFormPreview, screenFormStart, screenItemPreview, screenPreviewStudentItem, SCREEN_PREVIEW_DISPLAY_ID } = screenForm;
  const desktop = html(createElement(ScreenPreview, { device: "desktop", item: screenItemPreview(banner, ORIGEM) }));
  assert.match(desktop, /data-screen-preview="desktop"/);
  assert.match(desktop, /data-screen-preview-place="bottom_right"/);
  // A moldura de previa da Area de membros: o rotulo, a "tela" de 1280 x 720 reduzida e o conteudo inert (nenhum link
  // abre, nenhum X fecha, nada recebe o Tab); a legenda da moldura fica escondida (Computador / Celular ja dizem).
  assert.match(desktop, /^<figure aria-label="Prévia: Computador" class="[^"]*\[&amp;_figcaption\]:hidden"/);
  const tela = desktop.match(/<div class="@container absolute[^"]*" inert="" style="([^"]*)">/);
  assert.ok(tela, "o conteudo inert");
  assert.match(tela[1], /height:720px;/);
  assert.match(tela[1], /width:1280px/);
  assert.ok(desktop.indexOf(" inert=") < desktop.indexOf('data-screen-preview="desktop"'), "o palco inteiro dentro da moldura inert");
  // O componente do aluno: a camada e o recipiente @container/tela; a area segura; o cartao na celula de baixo a direita
  // (screenPlacement), com a largura do Medio (30 % do palco) e o X do aluno.
  const camada = block(desktop, "data-room-screen-layer", "div");
  assert.match(camada, /^<div class="@container\/tela pointer-events-none absolute inset-0 z-20" data-room-screen-layer="">/);
  assert.match(camada, /<div class="absolute left-3 right-\[calc\(var\(--room-video-right,0px\)\+12px\)\] top-14 lg:left-4 bottom-\[calc\(3\.5rem\+var\(--room-video-bottom,0px\)\)\]" data-room-screen-area="">/, "a margem segura da sala");
  const celula = block(camada, 'data-room-screen-cell="bottom_right"', "div");
  const cartao = block(celula, 'data-room-screen-card="banner"', "section");
  assert.match(cartao, /^<section aria-label="Banner da equipe: Garanta sua vaga" class="[^"]*\bw-\[clamp\(240px,30cqw,380px\)\][^"]*@min-\[640px\]\/tela:flex"/, "Medio: 30 % do palco, so no palco de 640 px ou mais (o da Previa tem 1280)");
  assert.match(cartao, new RegExp(`data-room-screen-display="${SCREEN_PREVIEW_DISPLAY_ID}"`));
  assert.match(textOf(cartao), /Garanta sua vaga Só até o fim da aula\. Quero/);
  assert.match(cartao, /<button aria-label="Fechar o banner"[^>]*data-room-screen-close=""/);
  assert.deepEqual([...desktop.matchAll(/href="([^"]*)"/g)].map(([, href]) => href), ["https://exemplo.com/vaga"], "so o link https da equipe, como o aluno ve");
  assert.match(cartao, /<a [^>]*rel="noopener noreferrer nofollow" target="_blank"><span class="truncate">Quero<\/span><\/a>/);
  assert.doesNotMatch(desktop, /data-room-screen-(?:strip|row|compact)/, "no Computador, so o cartao");
  // O item como a sala recebe, sem exibicao de verdade.
  assert.deepEqual(screenPreviewStudentItem(screenItemPreview(banner, ORIGEM)), { ...screenItemPreview(banner, ORIGEM), displayId: SCREEN_PREVIEW_DISPLAY_ID, shownAt: "" });

  // A posicao e o tamanho escolhidos: "No meio" e Pequeno; Grande em cima a esquerda.
  const meio = html(createElement(ScreenPreview, { device: "desktop", item: screenItemPreview(itemPronto({ place: "center", size: "s" }), ORIGEM) }));
  assert.match(block(meio, 'data-room-screen-cell="center"', "div"), /data-room-screen-card="banner"/, "No meio: a celula do centro");
  assert.match(meio, /<section aria-label="Banner da equipe: Garanta sua vaga" class="[^"]*\bw-\[clamp\(200px,22cqw,280px\)\]/, "Pequeno: 22 %");
  const grande = html(createElement(ScreenPreview, { device: "desktop", item: screenItemPreview(itemPronto({ place: "top_left", size: "l" }), ORIGEM) }));
  assert.match(block(grande, 'data-room-screen-cell="top_left"', "div"), /class="[^"]*\bw-\[clamp\(280px,40cqw,520px\)\]/, "Grande: 40 %");

  const celular = html(createElement(ScreenPreview, { device: "mobile", item: screenItemPreview({ ...banner, closable: false }, ORIGEM) }));
  assert.match(celular, /^<figure aria-label="Prévia: Celular"/);
  assert.match(celular.match(/<div class="@container absolute[^"]*" inert="" style="([^"]*)">/)?.[1] ?? "", /width:390px/, "o celular de 390 px");
  const faixa = block(celular, "data-room-screen-strip", "div");
  assert.ok(celular.indexOf('aria-hidden="true" class="aspect-video') < celular.indexOf("data-room-screen-strip"), "a faixa abaixo do video");
  const linha = block(faixa, 'data-room-screen-row="banner"', "section");
  assert.match(linha, /<div class="flex min-h-14 items-center/, "a linha de 56 px");
  assert.doesNotMatch(linha, /Fechar o banner|data-room-screen-close/, "sem poder fechar, sem X");
  assert.match(linha, /<p class="sr-only">Este banner sai quando a equipe tirar\.<\/p>/);
  assert.doesNotMatch(celular, /data-screen-preview-place|data-room-screen-cell|data-room-screen-card/, "no celular a posicao nao vale");
  assert.match(block(html(createElement(ScreenPreview, { device: "mobile", item: screenItemPreview(banner, ORIGEM) })), 'data-room-screen-row="banner"', "section"), /aria-label="Fechar o banner"/, "podendo fechar, o X");

  const qr = html(createElement(ScreenPreview, { device: "desktop", item: screenItemPreview(qrPronto, ORIGEM) }));
  assert.match(qr, /<svg[^>]*role="img"[^>]*aria-label="QR Code do link exemplo\.com"|aria-label="QR Code do link exemplo\.com"[^>]*role="img"/);
  assert.match(block(qr, 'data-room-screen-cell="top_right"', "div"), /data-room-screen-card="qr"/);
  assert.match(qr, /<svg height="176" width="176"[^>]*data-room-screen-qr=""/, "o lado do Medio");
  assert.match(textOf(qr), new RegExp(`Baixe o material ${naTela.aluno.abrirOLink}`));
  const qrCelular = html(createElement(ScreenPreview, { device: "mobile", item: screenItemPreview(qrPronto, ORIGEM) }));
  assert.match(textOf(block(qrCelular, 'data-room-screen-row="qr"', "section")), new RegExp(naTela.aluno.abrirOLink), "no celular, a acao e Abrir o link");

  // O link que nao e https nunca vira o botao; a imagem so da nossa origem.
  const ruim = screenFormPreview({ ...screenFormStart("banner"), buttonLabel: "Quero", image: { height: 10, path: IMAGEM, width: 10 }, linkUrl: "javascript:alert(1)", title: "Oi" }, "https://outro.site/x");
  assert.deepEqual([ruim.linkUrl, ruim.buttonLabel, ruim.image], [null, null, null]);
  const ruimHtml = html(createElement(ScreenPreview, { device: "desktop", item: ruim }));
  assert.doesNotMatch(ruimHtml, /href=|<img/, "sem link e sem imagem de fora");
  // A imagem da nossa origem chega ao cartao como o aluno a ve (inteira, com width e height).
  const comImagem = html(createElement(ScreenPreview, { device: "desktop", item: screenItemPreview(itemPronto({ image: { alt: "Turma reunida", height: 360, path: IMAGEM, width: 640 } }), ORIGEM) }));
  assert.match(comImagem, new RegExp(`<img alt="Turma reunida" class="[^"]*object-contain[^"]*" data-room-screen-image="" decoding="async" height="360" src="${ORIGEM}/storage/v1/object/public/content-assets/${IMAGEM.replace(/\./g, "\\.")}" width="640"/>`));

  // Sem handlers: o componente do aluno, nada da sala que mede, guarda ou envia.
  const fonte = readFileSync(new URL("../src/components/admin/v2/communication/webinars/session-console/console-screen-form.tsx", import.meta.url), "utf8");
  assert.match(fonte, /<RoomScreenLayer forced=\{false\} fullscreen=\{false\} items=\{\[student\]\} pinned=\{null\} placement=\{screenPlacement\(/);
  assert.match(fonte, /<RoomScreenStrip forced=\{false\} items=\{\[student\]\} pinned=\{null\} \/>/);
  assert.doesNotMatch(fonte, /handlers=|useRoomScreenEvents|sendBeacon|screen-events/, "nada e enviado da Previa");
});

test("o contador da entrada Na tela no trilho: o numero e o nome que comeca pelo rotulo; sem nada na tela, so o rotulo", () => {
  const props = { className: "", counts: { maos: 0, perguntas: 0, tela: 3 }, entries: ["tela", "enquetes"], initialAvailable: null, onItem() {}, panelShown: true, tabs: ["chat"], view: { tab: "chat" } };
  const trilho = html(createElement(ConsoleRail, props));
  const item = trilho.match(/<button[^>]*data-console-rail="tela"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.match(item, /aria-label="Na tela, 3 coisas na tela"/);
  assert.match(item, /data-room-unread="">3</);
  assert.ok(trilho.indexOf('data-console-rail="tela"') < trilho.indexOf('data-console-rail="enquetes"'), "a primeira entrada");
  const vazio = html(createElement(ConsoleRail, { ...props, counts: { maos: 0, perguntas: 0, tela: 0 } }));
  assert.doesNotMatch(vazio.match(/<button[^>]*data-console-rail="tela"[^>]*>/)?.[0] ?? "", /aria-label=/);
  assert.equal(naTela.console.contador(1), "1 coisa na tela");
});

test("a entrada Na tela no console da Live gravada: a primeira do ⋯, com o que esta na tela e os prontos do retrato; o Replay nao tem a entrada", () => {
  const snapshot = {
    askedMessageIds: [],
    barred: [],
    live: null,
    messages,
    pinned: antiga,
    pinnedMessageId: antiga.id,
    pinnedPollId: null,
    polls: { launched: [], templates: [] },
    presentNow: 3,
    questions: [],
    scriptFired: {},
    scriptItems: [],
    screen: { active: [exibicaoDe(banner)], items: [banner, qrPronto], pending: false, stats: { [`d-${banner.id}`]: { clickers: 1, clicks: 1, closed: 0, shown: 2 } } },
    serverTime: new Date(NOW).toISOString(),
    session: session({ pinnedMessageId: antiga.id })
  };
  const webinar = { durationMinutes: 60, hostUserId: "u-host", id: WEBINAR, kind: "simulated", recordingDurationSeconds: 3600, slug: "aula-de-ia", title: "Aula de IA" };
  const markup = html(createElement(SessionConsole, { currentUserId: "u-host", data: { sessions: [snapshot.session], snapshot, webinar }, permissions: { canPublish: true, canWrite: true }, serverNow: NOW }));
  const itens = Array.from(markup.matchAll(/data-console-more-item="([^"]+)"/g)).map((match) => match[1]);
  assert.equal(itens[0], "tela", "a primeira entrada do ⋯");
  const entrada = block(markup, 'data-console-more="tela"', "section");
  assert.match(entrada, /aria-label="Na tela"/);
  assert.match(textOf(entrada), /Mensagem fixada · Bia C\./);
  assert.match(textOf(entrada), /Banner · Banner da vaga há 3 min · 2 viram · 1 clicou · 0 fecharam/);
  assert.match(block(entrada, `data-console-screen-item="${banner.id}"`, "li"), /data-screen-state="on"/);
  assert.match(block(entrada, `data-console-screen-item="${qrPronto.id}"`, "li"), /data-screen-state="show"/);

  const replay = html(createElement(SessionConsole, { currentUserId: "u-host", data: { sessions: [], snapshot: { ...snapshot, session: session({ kind: "replay", status: "live" }) }, webinar }, permissions: { canPublish: true, canWrite: true }, serverNow: NOW }));
  assert.doesNotMatch(replay, /data-console-more="tela"|data-console-more-item="tela"/);
});

test("o palco do console da Live ao vivo nao desenha os cartoes: so a pilula neutra \"Na tela: Banner · QR Code\" em cima a direita", () => {
  assert.deepEqual(screenStageKinds([exibicaoDe(qrPronto), enqueteFixada, exibicaoDe(banner)]), ["banner", "qr"], "o banner antes do QR Code, sem a enquete");
  assert.deepEqual(screenStageKinds([enqueteFixada, exibicaoDe(banner, { hiddenAt: new Date(NOW).toISOString() })]), []);

  const live = {
    meetConfigured: true,
    people: [],
    recorder: { anchorAt: null, dispatchConfigured: true, driftMs: null, estimateMinutes: null, fileStartedAt: null, recordingRequestedAt: null, releaseRequestedAt: null, requestedAt: null, status: "none" },
    recording: null,
    roomLocked: false,
    selfUnmute: false
  };
  const liveSession = session({ kind: "live", recorderStatus: "none", roomLocked: false, roomName: null, scriptFiredAt: null });
  const snapshot = (active) => ({
    askedMessageIds: [],
    barred: null,
    live,
    messages: [],
    pinned: null,
    pinnedMessageId: null,
    pinnedPollId: null,
    polls: { launched: [], templates: [] },
    presentNow: 3,
    questions: [],
    scriptFired: {},
    scriptItems: [],
    screen: { active, items: [banner, qrPronto], pending: false, stats: {} },
    serverTime: new Date(NOW).toISOString(),
    session: liveSession
  });
  const webinar = { allowStudentCamera: false, durationMinutes: 60, hostUserId: "u-host", id: WEBINAR, kind: "live", practiceSession: true, recordingDurationSeconds: null, slug: "aula-ao-vivo", title: "Aula ao vivo", waitingRoom: false };
  const render = (active) => html(createElement(SessionConsole, { currentUserId: "u-host", data: { sessions: [liveSession], snapshot: snapshot(active) , webinar }, nonce: "n", permissions: { canPublish: true, canWrite: true }, serverNow: NOW }));

  const markup = render([exibicaoDe(banner), exibicaoDe(qrPronto)]);
  const palco = block(markup, 'data-console-slot="stage"', "div");
  const pilula = block(palco, 'data-room-badge="screen"', "span");
  assert.equal(textOf(pilula), "Na tela: Banner · QR Code");
  assert.ok(palco.indexOf('data-room-badge="screen"') > palco.indexOf('data-room-badges="top-right"'), "em cima a direita");
  assert.doesNotMatch(palco, /data-screen-preview|Garanta sua vaga/, "os cartoes nao sao desenhados no palco do console");
  assert.equal(textOf(block(block(render([exibicaoDe(qrPronto), enqueteFixada]), 'data-console-slot="stage"', "div"), 'data-room-badge="screen"', "span")), "Na tela: QR Code");
  assert.doesNotMatch(render([enqueteFixada]), /data-room-badge="screen"/, "a enquete fixada nao e cartao");
});

/* ------------------------------------------------------------------------------------------------
 * R5: a moderacao por pessoa no console da Live gravada
 * ---------------------------------------------------------------------------------------------- */

test("Live gravada: o ⋯ da mensagem de aluno com Silenciar 5/15/60 min, até o fim, Remover da sala e Banir (sem os itens do video); a barrada com os Desfazer e os rotulos; o bloco Removidos, silenciados e banidos embaixo dos seletores; a equipe sem itens; o Replay sem nada", async () => {
  // 23:15 UTC: 20:15 em Sao Paulo, a hora que a mesa mostra.
  const ateHora = new Date(NOW + 10 * MIN).toISOString();
  const barrada = { ban: { banned: false, kicked: true, muted: true, mutedUntil: ateHora }, displayName: "Bia C.", joinedAt: null, participantId: null, staff: false, userId: "u-bia" };
  const mensagens = [
    message({ authorUserId: "u-ana", body: "Oi, tudo bem?", displayName: "Ana M.", id: "m-ana" }),
    message({ authorUserId: "u-bia", body: "Comprei!", displayName: "Bia C.", id: "m-bia" }),
    message({ authorUserId: "u-host", body: "Bem-vindos", displayName: "Produtor T.", id: "m-equipe", role: "host", source: "team" })
  ];
  const snapshotDa = (extra = {}) => ({
    askedMessageIds: [],
    barred: [barrada],
    live: null,
    messages: mensagens,
    pinned: null,
    pinnedMessageId: null,
    pinnedPollId: null,
    polls: { launched: [], templates: [] },
    presentNow: 3,
    questions: [],
    scriptFired: {},
    scriptItems: [],
    screen: { active: [], items: [], pending: false, stats: {} },
    serverTime: new Date(NOW).toISOString(),
    session: session(),
    ...extra
  });
  const webinar = { durationMinutes: 60, hostUserId: "u-host", id: WEBINAR, kind: "simulated", recordingDurationSeconds: 3600, slug: "aula-de-ia", title: "Aula de IA" };
  const render = (snapshot, permissions = { canPublish: true, canWrite: true }) =>
    html(createElement(SessionConsole, { currentUserId: "u-host", data: { sessions: [snapshot.session], snapshot, webinar }, permissions, serverNow: NOW }));
  const { WEBINAR_ADMIN_COPY } = await import("../src/server/webinars/editor-model.ts");
  // Os itens do ⋯ que sao da pessoa (o "Aprovar para as próximas turmas" e da mensagem e vem antes, separado).
  const itensDo = (markup, id) => {
    const item = block(markup, `data-room-message="${id}"`, "li");
    return item.includes('role="menu"')
      ? Array.from(block(item, 'role="menu"', "div").matchAll(/role="menuitem"[^>]*>([^<]+)</g))
          .map((match) => match[1])
          .filter((label) => label !== WEBINAR_ADMIN_COPY.console.chat.promote)
      : [];
  };
  const vivo = WEBINAR_COPY.consoleAoVivo;
  const silenciar = [vivo.silenciarNoChat[5], vivo.silenciarNoChat[15], vivo.silenciarNoChat[60], vivo.silenciarNoChat.fim];

  const markup = render(snapshotDa());
  // O "Mostrar na tela" (rodada v9, docs/30 D89) e o primeiro do ⋯ de toda mensagem liberada; depois, os da pessoa.
  assert.deepEqual(itensDo(markup, "m-ana"), [naTela.console.mostrarNaTela, ...silenciar, vivo.removerDaSala, vivo.banir], "os mesmos itens da live, sem Destacar, palco nem camera");
  assert.doesNotMatch(block(markup, 'data-room-message="m-ana"', "li"), new RegExp(`${vivo.destacar}|${vivo.convidarPalco}|${vivo.fecharCamera}`));
  const daBarrada = itensDo(markup, "m-bia");
  assert.deepEqual(daBarrada.slice(0, 2), [naTela.console.mostrarNaTela, `${LIVE_CONSOLE_COPY_DESFAZER}: Sem escrever até 20:15`], "depois do Mostrar na tela (rodada v9), o silencio da barrada vira Desfazer");
  assert.ok(daBarrada.includes(`${LIVE_CONSOLE_COPY_DESFAZER}: ${vivo.removido}`), "o remover tambem");
  assert.deepEqual(itensDo(markup, "m-equipe").filter((item) => silenciar.includes(item) || item === vivo.banir), [], "a equipe nunca e alvo");
  assert.match(block(block(markup, 'data-room-message="m-ana"', "li"), "data-stub-menu", "div"), new RegExp(`aria-label="${WEBINAR_COPY.consoleV2.chat.maisAcoes("Ana M.")}"`));

  // Os rotulos da barrada na linha de cima da mensagem dela; a outra sem rotulo.
  assert.deepEqual(
    Array.from(block(markup, 'data-room-message="m-bia"', "li").matchAll(/data-console-person-badge="">([^<]+)</g)).map((match) => match[1]),
    [vivo.removido, "Sem escrever até 20:15"]
  );
  assert.doesNotMatch(block(markup, 'data-room-message="m-ana"', "li"), /data-console-person-badge/);

  // O bloco embaixo dos seletores e antes da lista, com os Desfazer que ja existem.
  const bloco = block(markup, 'data-console-chat-barred=""', "div");
  assert.ok(markup.indexOf('data-console-chat-header=""') < markup.indexOf('data-console-chat-barred=""'), "embaixo dos seletores");
  assert.ok(markup.indexOf('data-console-chat-barred=""') < markup.indexOf('data-console-chat=""'), "antes da lista");
  assert.match(textOf(bloco), new RegExp(`^${vivo.removidosESilenciados} Bia C\\. ${LIVE_CONSOLE_COPY_DESFAZER}: Sem escrever até 20:15 ${LIVE_CONSOLE_COPY_DESFAZER}: ${vivo.removido}$`));
  assert.match(bloco, /aria-label="Desfazer: Removido da sala \(Bia C\.\)"/);

  // Sem ninguem barrado, sem o bloco; o ⋯ continua.
  const semBarrados = render(snapshotDa({ barred: [] }));
  assert.doesNotMatch(semBarrados, /data-console-chat-barred|data-live-barred/);
  assert.deepEqual(itensDo(semBarrados, "m-bia"), [naTela.console.mostrarNaTela, ...silenciar, vivo.removerDaSala, vivo.banir]);

  // Sem messaging.publish: Banir desligado, com a frase.
  const semPublicar = render(snapshotDa({ barred: [] }), { canPublish: false, canWrite: true });
  const menuAna = block(block(semPublicar, 'data-room-message="m-ana"', "li"), 'role="menu"', "div");
  assert.match(menuAna, new RegExp(`aria-disabled="true"[^>]*>${vivo.banir}<`));
  assert.match(textOf(menuAna), new RegExp(`${vivo.banir} ${vivo.soQuemPublica.replace(/\./g, "\\.")}$`));
  assert.equal(vivo.soQuemPublica, "Só quem publica webinários pode fazer isso.");

  // No Replay nada muda: nenhum item da pessoa, nenhum bloco, nenhum rotulo.
  const replay = render(snapshotDa({ session: session({ kind: "replay", status: "live" }) }));
  assert.ok(!itensDo(replay, "m-ana").some((item) => silenciar.includes(item) || item === vivo.banir || item === vivo.removerDaSala));
  assert.doesNotMatch(replay, /data-console-chat-barred|data-console-person-badge/);
});

test("rodada v9 (P3, docs/30 D87): o formulario do banner oferece 'O que abre o link' so com o link e o texto do botao escritos; o padrao e Imagem e botão; a Previa segue a escolha", () => {
  const { screenFormInput, screenFormPreview, screenFormStart, screenFormErrors } = screenForm;
  // O banner novo: sem link nem texto do botao, a escolha nao aparece (nao faria diferenca).
  assert.doesNotMatch(html(createElement(ConsoleScreenForm, formProps())), /data-console-screen-link-target/);
  const novo = screenFormStart("banner");
  assert.equal(novo.linkTarget, "both", "o padrao do pedido do produtor");
  assert.equal(screenFormInput(novo, WEBINAR).linkTarget, "both");
  assert.equal(screenFormInput(screenFormStart("qr"), WEBINAR).linkTarget, null, "o QR Code nao tem a escolha");

  // Editando um banner com link e botao: as tres opcoes como radios, a escolhida marcada e a frase dela embaixo.
  const item = itemPronto({ linkTarget: "button" });
  const formulario = block(html(createElement(ConsoleScreenForm, formProps({ item }))), 'data-console-screen-form="banner"', "form");
  const grupo = block(formulario, 'data-console-screen-link-target=""', "div");
  assert.match(textOf(grupo), new RegExp(`^${formCopy.oQueAbreOLink} Imagem e botão Só o botão Só a imagem ${formCopy.alvoDoLinkDica.button.replace(/[.]/g, "\\.")}$`));
  assert.equal(count(grupo, /type="radio"/g), 3);
  assert.match(grupo, /<input[^>]*checked=""[^>]*value="button"|<input[^>]*value="button"[^>]*checked=""/, "Só o botão marcado");
  assert.ok(formulario.indexOf("data-console-screen-link-target") > formulario.indexOf(formCopy.link), "logo depois do Link");
  // O item de antes da escolha (sem o campo) abre como "Só o botão": e assim que ele ja aparece para a turma.
  assert.equal(screenFormStart("banner", itemPronto()).linkTarget, "button");

  // A Previa e o que o Salvar manda seguem a escolha.
  const estado = screenFormStart("banner", itemPronto({ linkTarget: "both" }));
  assert.deepEqual([screenFormPreview(estado, ORIGEM).linkTarget, screenFormPreview(estado, ORIGEM).buttonLabel], ["both", "Quero"]);
  const soImagem = { ...estado, linkTarget: "image" };
  assert.deepEqual([screenFormPreview(soImagem, ORIGEM).linkTarget, screenFormPreview(soImagem, ORIGEM).buttonLabel], ["image", null], "Só a imagem: a Previa sem o botao");
  assert.equal(screenFormInput(soImagem, WEBINAR).linkTarget, "image");
  // (O id do item de teste nao e um uuid: os erros sao conferidos como num banner novo.)
  assert.deepEqual(screenFormErrors({ ...estado, buttonLabel: "", id: null, linkTarget: "button" }, WEBINAR), { buttonLabel: naTela.erros.soBotaoSemTexto });
  assert.deepEqual(screenFormErrors({ ...soImagem, id: null }, WEBINAR), {});
});

test("rodada v9 (P11, docs/30 D89): 'Mostrar na tela' no ⋯ de cada mensagem liberada do chat; na que ja esta na tela, 'Tirar da tela'; a que espera a equipe e a sessao que nao aceita a equipe ficam sem o item", () => {
  const itensDe = (markup, id) => {
    const item = block(markup, `data-room-message="${id}"`, "li");
    return item.includes('role="menu"') ? Array.from(block(item, 'role="menu"', "div").matchAll(/role="menuitem"[^>]*>([^<]+)</g)).map((match) => match[1]) : [];
  };
  const pendente = message({ approved: false, body: "Esperando", displayName: "Leo P.", id: "m-pendente" });
  const com = html(createElement(ConsoleChat, chatProps({ messages: [...messages, pendente], onScreenComment() {}, screenCommentMessageId: "m-equipe" })));
  assert.equal(naTela.console.mostrarNaTela, "Mostrar na tela");
  for (const id of ["m-aluna", "m-roteiro-equipe", "m-roteiro-aluno", "m-ia", "m-sem-link"]) {
    assert.equal(itensDe(com, id)[0], naTela.console.mostrarNaTela, `${id}: o primeiro item do ⋯`);
  }
  assert.equal(itensDe(com, "m-equipe")[0], naTela.console.tirarDaTela, "a que esta na tela: Tirar da tela");
  assert.equal(count(com, />Tirar da tela</g), 1, "so uma esta na tela");
  assert.ok(!itensDe(com, "m-pendente").includes(naTela.console.mostrarNaTela), "a que espera a equipe a turma ainda nao viu");
  // Sem a acao (o Replay, a sessao encerrada, quem so le): nenhum item.
  const sem = html(createElement(ConsoleChat, chatProps()));
  assert.doesNotMatch(sem, /Mostrar na tela|Tirar da tela/);
});

test("rodada v9 (P11): em Na tela agora, o comentario ou a pergunta com quem escreveu, o texto, ha quanto tempo e o Tirar da tela; conta no numero da entrada e na pilula do palco; sem poder agir, sem o botao", () => {
  const comentario = { avatar: "person", avatarUrl: null, body: "Como faz isso?", displayId: "d-comentario", name: "Ana M.", role: null, shownAt: new Date(NOW - 2 * MIN - 5_000).toISOString(), source: "chat", sourceId: "m-aluna" };
  const tela = (extra = {}) => html(createElement(ConsoleScreen, screenProps({ onHideComment() {}, screen: { active: [], comment: comentario, items: [], pending: false, stats: {} }, ...extra })));
  const markup = tela();
  const linha = block(markup, 'data-console-screen-now-item="comment"', "li");
  assert.equal(textOf(linha), `Comentário · Ana M.: Como faz isso? há 2 min ${consoleCopy.tirarDaTela}`);
  assert.match(linha, /data-display-id="d-comentario"/);
  assert.match(linha, /<button[^>]*data-console-screen-hide-comment=""/);
  assert.doesNotMatch(textOf(markup), new RegExp(consoleCopy.agoraVazio), "com o comentario, a tela dos alunos nao esta vazia");
  const daPergunta = tela({ screen: { active: [], comment: { ...comentario, body: "Posso fazer?", source: "question" }, items: [], pending: false, stats: {} } });
  assert.match(textOf(block(daPergunta, 'data-console-screen-now-item="comment"', "li")), /^Pergunta · Ana M\.: Posso fazer\?/);
  assert.doesNotMatch(block(tela({ canAct: false }), 'data-console-screen-now-item="comment"', "li"), /<button/, "sem poder agir, sem o Tirar");
  assert.doesNotMatch(html(createElement(ConsoleScreen, screenProps())), /data-console-screen-now-item="comment"/, "sem comentario, a lista de antes");

  // O contador da entrada e a pilula do palco.
  assert.equal(consoleScreenCount({ active: [], comment: comentario, pinnedMessageId: null }), 1);
  assert.equal(consoleScreenCount({ active: [exibicaoDe(banner)], comment: comentario, pinnedMessageId: "mensagem-1" }), 3);
  assert.equal(consoleScreenCount({ active: [], pinnedMessageId: null }), 0);
  assert.equal(naTela.console.pilulaPalco([naTela.tipos.banner, naTela.tipoComentario.chat]), "Na tela: Banner · Comentário");
  assert.equal(naTela.tipoComentario.question, "Pergunta");
  const fonte = readFileSync(new URL("../src/components/admin/v2/communication/webinars/session-console/session-console.tsx", import.meta.url), "utf8");
  assert.match(fonte, /showScreenComment\(source === "chat" \? \{ messageId: id, sessionId \} : \{ questionId: id, sessionId \}\)/, "o console manda a origem certa");
  assert.match(fonte, /hideScreenComment\(\{ sessionId \}\)/);
});

test("rodada v9 (P11): cada pergunta que a turma ve tem 'Mostrar na tela'; a que esta na tela leva o selo Na tela e o 'Tirar da tela'; a dispensada nao vai para a tela", async () => {
  const { ConsoleQuestions } = await import("../src/components/admin/v2/communication/webinars/session-console/console-questions.tsx");
  const pergunta = (extra = {}) => ({ anonymous: false, answerText: null, answeredAt: null, answeredBy: null, answeredLive: false, body: "Posso fazer?", createdAt: new Date(NOW - MIN).toISOString(), displayName: "Ana M.", id: "q-aberta", messageId: null, offsetMs: 0, sessionId: "s-1", simulated: false, status: "open", upvotes: 0, userId: "u-ana", ...extra });
  const perguntas = [pergunta(), pergunta({ answerText: "Pode", id: "q-respondida", status: "answered" }), pergunta({ id: "q-dispensada", status: "dismissed" })];
  const painel = (extra = {}) => html(createElement(ConsoleQuestions, { busyKey: null, canAct: true, onAnswer: async () => true, onScreenComment() {}, onStatus() {}, questions: perguntas, ...extra }));
  const de = (markup, id) => block(markup, `data-console-question="${id}"`, "li");
  const markup = painel({ screenCommentQuestionId: "q-respondida" });
  assert.match(de(markup, "q-aberta"), /<button[^>]*data-console-screen-comment="show"[^>]*>Mostrar na tela<\/button>/);
  assert.doesNotMatch(de(markup, "q-aberta"), /data-console-question-on-screen/);
  assert.match(de(markup, "q-respondida"), /<button[^>]*data-console-screen-comment="hide"[^>]*>Tirar da tela<\/button>/);
  assert.match(textOf(block(de(markup, "q-respondida"), 'data-console-question-on-screen=""', "span")), /^Na tela$/, "o selo da que esta na tela");
  assert.doesNotMatch(de(markup, "q-dispensada"), /data-console-screen-comment/, "a dispensada some para a turma: nao vai para a tela");
  assert.doesNotMatch(painel({ onScreenComment: null }), /data-console-screen-comment/, "sem a acao (o Replay, a sessao encerrada)");
  assert.doesNotMatch(painel({ canAct: false }), /data-console-screen-comment/);
});
