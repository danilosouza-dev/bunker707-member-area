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
//   "Abrir e fixar" ao lado do Abrir; sem poder agir, nenhum botao de fixar.
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
  "@/server/webinars/script-actions": `${fail}
export const saveScriptItems = fail; export const importScriptCsv = fail; export const exportScriptCsv = fail; export const exportSessionChatCsv = fail; export const saveTranscript = fail; export const resolveScriptPhrases = fail; export const fireScriptItem = fail;`,
  "@/server/webinars/live-actions": `${fail}
export const openLiveRoom = fail; export const startLiveSession = fail; export const endLiveSession = fail; export const setRoomLock = fail; export const prepareRecorder = fail; export const releaseRecorder = fail; export const requestRecording = fail; export const markRecordingAnchor = fail; export const muteInChat = fail; export const kickFromSession = fail; export const undoSessionBan = fail; export const banStudent = fail; export const unbanStudent = fail; export const attachRecording = fail; export const alignChat = fail; export const setBrowserRecording = fail; export const setSelfUnmute = fail;`,
  "@/server/webinars/offer-actions": `${fail}
export const loadOfferEditor = fail; export const saveOffer = fail; export const archiveOffer = fail; export const loadOfferConsole = fail; export const showOfferNow = fail; export const hideOffer = fail;`,
  "@/server/webinars/assistant-actions": `${fail}
export const loadAssistantEditor = fail; export const saveAssistant = fail; export const loadAttendanceSnapshot = fail; export const setReplyAll = fail; export const pingAttendant = fail; export const assign = fail; export const editAssistantAnswer = fail;`,
  "@/server/webinars/translation-actions": `${fail}
export const clearMessageTranslations = fail;`,
  "@/server/webinars/room-actions": `${fail}
export const openSessionNow = fail; export const endSessionNow = fail; export const sendTeamMessage = fail; export const moderateMessage = fail; export const setSessionChatMode = fail; export const savePolls = fail; export const launchPoll = fail; export const closePoll = fail; export const pinPoll = fail; export const unpinPoll = fail; export const answerQuestion = fail; export const replyToQuestion = fail; export const deleteQuestionReply = fail; export const setQuestionStatus = fail; export const saveSimulation = fail; export const createReplaySession = fail; export const cancelReplaySession = fail; export const removeStudentMessages = fail;`
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
