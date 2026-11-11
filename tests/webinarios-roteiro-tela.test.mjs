import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";

// Os cards da fase 2b do editor desenhados (docs/30 §2.2; docs/18 §1.1): Roteiro de chat (as linhas com minuto,
// nome, papel, Solta em, a situacao, Importar/Exportar CSV, a transcricao e Resolver frases, o chat de uma sessao
// encerrada em CSV), Simulação (o aviso do CDC, uma linha por sessao gravada com o selo e quem decidiu, so para quem
// publica), Enquetes (os modelos) e Sessões (Entrada atrasada por sessao, o link do console e o Replay livre; o
// "Comeca quando voce entra" da fase 4e tem o teste dele, tests/webinarios-jit-tela.test.mjs).
//
// Os .tsx do app sao transpilados aqui pelo TypeScript (so JSX -> JS). next/link, next/image e next/navigation viram
// stubs; o Dialog vira uma versao sem portal; as Server Actions viram funcoes falsas.

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
  // As pessoas que comentam (11/11/2026, D75): a lista do Roteiro grava pela propria Server Action.
  "@/server/webinars/persona-actions": `${fail}
export const savePersona = fail; export const deletePersona = fail;`,
  "@/server/webinars/script-actions": `${fail}
export const saveScriptItems = fail; export const importScriptCsv = fail; export const exportScriptCsv = fail; export const exportSessionChatCsv = fail; export const saveTranscript = fail; export const resolveScriptPhrases = fail; export const fireScriptItem = fail; export const sendScriptedComment = fail; export const saveScriptComment = fail; export const uploadPersonaPhoto = fail;`,
  "@/server/webinars/simulation-actions": `${fail}
export const loadSessionSimulations = fail; export const saveSessionSimulation = fail;`,
  "@/server/webinars/jit-actions": `${fail}
export const saveJitSettings = fail; export const loadJitSettings = fail;`,
  "@/server/webinars/room-actions": `${fail}
export const openSessionNow = fail; export const endSessionNow = fail; export const sendTeamMessage = fail; export const moderateMessage = fail; export const setSessionChatMode = fail; export const savePolls = fail; export const launchPoll = fail; export const closePoll = fail; export const answerQuestion = fail; export const replyToQuestion = fail; export const deleteQuestionReply = fail; export const setQuestionStatus = fail; export const saveSimulation = fail; export const createReplaySession = fail; export const cancelReplaySession = fail; export const removeStudentMessages = fail;`
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
const { ScriptCard } = await import("../src/components/admin/v2/communication/webinars/script-card.tsx");
const { SimulationCard } = await import("../src/components/admin/v2/communication/webinars/simulation-card.tsx");
const { PollsCard } = await import("../src/components/admin/v2/communication/webinars/polls-card.tsx");
const { SessionsCard } = await import("../src/components/admin/v2/communication/webinars/webinar-editor-cards.tsx");
const model = await import("../src/server/webinars/model.ts");
const consoleModel = await import("../src/server/webinars/console-model.ts");

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

const NOW = Date.parse("2026-11-05T23:05:00.000Z"); // 20:05 de 5/11 em Sao Paulo
const WEBINAR = "aaaaaaaa-1111-4111-8111-111111111111";
const S_PAST = "bbbbbbbb-2222-4222-8222-333333333333";
const S_NEXT = "bbbbbbbb-2222-4222-8222-222222222222";

function session(extra = {}) {
  return {
    chatMode: "open",
    chatSlowModeSeconds: null,
    createdAt: "2026-10-28T12:00:00.000Z",
    endedAt: null,
    id: S_NEXT,
    kind: "simulated",
    lateJoinMinutes: null,
    pinnedMessageId: null,
    presenceCurve: null,
    recordingAnchorAt: null,
    recordingId: null,
    scheduledAt: "2026-11-06T23:00:00.000Z",
    scriptFiredAt: null,
    showLiveBadge: false,
    simulationAckText: null,
    simulationDecidedAt: null,
    simulationDecidedBy: null,
    sourceSessionId: null,
    startedAt: null,
    status: "scheduled",
    updatedAt: "2026-10-28T12:00:00.000Z",
    webinarId: WEBINAR,
    ...extra
  };
}

const ended = session({ endedAt: "2026-11-04T00:00:00.000Z", id: S_PAST, scheduledAt: "2026-11-03T23:00:00.000Z", showLiveBadge: true, simulationAckText: "Decisão do produtor em 03/11/2026: …", simulationDecidedAt: "2026-11-03T12:00:00.000Z", simulationDecidedBy: "u-produtor", status: "ended" });

function scriptItem(id, extra = {}) {
  return { body: `Mensagem ${id}`, createdAt: "", generatedByAi: false, id, kind: "message", offsetMs: null, personaName: "Duda", personaRole: "student", phrase: null, phraseDelayMs: 0, position: 0, resolvedOffsetMs: null, resolvedTranscriptId: null, status: "ready", triggerKind: "at_offset", updatedAt: "", webinarId: WEBINAR, ...extra };
}

test("Roteiro de chat: as linhas com minuto, nome, papel, Solta em e situacao; o resumo; Importar/Exportar CSV; a transcricao com o resumo e Resolver frases; o chat da sessao encerrada", () => {
  const items = [
    scriptItem("a", { offsetMs: 90_000, position: 1 }),
    scriptItem("b", { offsetMs: 30_000, personaRole: "team", position: 0 }),
    scriptItem("p", { phrase: "vamos começar", phraseDelayMs: 2_000, position: 2, resolvedOffsetMs: 32_000, triggerKind: "on_phrase" }),
    scriptItem("u", { phrase: "ninguém disse", position: 3, status: "unresolved", triggerKind: "on_phrase" }),
    scriptItem("m", { position: 4, triggerKind: "manual" }),
    scriptItem("d", { offsetMs: 5_000, position: 5, status: "disabled" })
  ];
  const transcript = { cues: 312, format: "vtt", language: "pt-BR", updatedAt: "2026-11-01T15:00:00.000Z" };
  const markup = html(createElement(ScriptCard, { disabled: false, hasRecording: true, initialItems: items, initialTranscript: transcript, sessions: [session(), ended], webinarId: WEBINAR }));
  const text = textOf(markup);

  assert.equal(count(markup, /data-script-row=/g), 6);
  assert.match(text, /3 entram sozinhas · 1 pelo botão · 1 sem minuto · 1 desligada/);
  assert.match(markup, /value="00:30"/, "o minuto em mm:ss");
  assert.match(markup, /value="01:30"/);
  assert.match(text, /Pronta · 00:32/, "a frase achada mostra o minuto resolvido");
  assert.match(text, /Frase não achada/);
  assert.match(text, /Desligada/);
  assert.match(text, /Num minuto do vídeo/);
  assert.match(text, /Quando o apresentador diz/);
  assert.match(text, /Pelo botão da equipe/);
  assert.match(markup, /value="vamos começar"/);
  assert.equal(count(markup, />Equipe</g) >= 1, true);
  assert.match(text, /Importar CSV/);
  assert.match(text, /Exportar CSV/);
  assert.match(text, /Tempo;Nome;Papel;Mensagem/);
  assert.match(text, /Transcrição VTT com 312 trechos, enviada em 01\/11\/2026 às 12:00\./);
  assert.match(text, /Resolver frases/);
  assert.match(text, /Salvar transcrição/);
  assert.match(text, /Adicionar mensagem/);
  assert.match(text, /Salvar roteiro/);
  assert.match(text, /Baixar o chat de uma sessão como CSV/, "ha uma sessao encerrada");
  assert.match(text, /Sessão de 03\/11\/2026 às 20:00/);
  assert.match(markup, /data-script-csv-input=""/);
  assert.match(markup, /data-transcript-input=""/);

  const semVideo = textOf(html(createElement(ScriptCard, { disabled: false, hasRecording: false, initialItems: [], initialTranscript: null, sessions: [session()], webinarId: WEBINAR })));
  assert.match(semVideo, /Nenhuma mensagem no roteiro\./);
  assert.match(semVideo, /Transcreva o vídeo para soltar mensagens por frase dita\./);
  assert.match(semVideo, /Cole o endereço do vídeo da Bunny no card Dados/);
  assert.doesNotMatch(semVideo, /Baixar o chat de uma sessão/, "sem sessao encerrada nao ha chat para baixar");
  assert.match(semVideo, /0 entram sozinhas · 0 pelo botão · 0 sem minuto · 0 desligadas/);
});

test("Simulação: o aviso do CDC, uma linha por sessao gravada com o selo, quem decidiu e quando; a frase de hoje com o nome; so quem publica decide", () => {
  const markup = html(createElement(SimulationCard, { canPublish: true, currentUserName: "Produtor de Teste", deciderNames: { "u-produtor": "Produtor de Teste" }, disabled: false, now: NOW, sessions: [session(), ended, session({ id: "cancelada", status: "cancelled" })] }));
  const text = textOf(markup);

  assert.match(text, /Pela lei \(CDC, art\. 37\), nunca anuncie uma sessão gravada como ao vivo fora da área de membros\./);
  assert.match(text, /Números de plateia: reais/);
  assert.equal(count(markup, /data-simulation-session=/g), 2, "a cancelada fica de fora");
  assert.match(text, /Sessão de 06\/11\/2026 às 20:00/);
  assert.match(text, /Sem decisão registrada: o selo fica desligado\./);
  assert.match(text, /Decisão de Produtor de Teste em 03\/11\/2026 às 09:00\./);
  assert.match(text, /Decisão do produtor em 03\/11\/2026: …/, "a frase gravada aparece");
  assert.equal(count(markup, /role="switch"/g), 2);
  assert.match(markup, /aria-checked="true"/, "a sessao encerrada com o selo ligado");
  assert.doesNotMatch(text, /Confirmar decisão/, "a frase so aparece ao mexer na chave");

  const sentence = consoleModel.consoleAckSentence({ badgeOn: true, nowMs: NOW, responsible: "Produtor de Teste" });
  assert.match(sentence, /^Decisão do produtor em 05\/11\/2026: nesta sessão gravada, dentro da área de membros, o selo "Ao vivo" fica ligado e os números de plateia são reais\./);

  const soEscreve = textOf(html(createElement(SimulationCard, { canPublish: false, currentUserName: null, deciderNames: {}, disabled: false, now: NOW, sessions: [session()] })));
  assert.match(soEscreve, /Só quem publica na Comunicação decide o selo\./);
  const semSessao = textOf(html(createElement(SimulationCard, { canPublish: true, currentUserName: "X", deciderNames: {}, disabled: false, now: NOW, sessions: [] })));
  assert.match(semSessao, /Marque as sessões no card Sessões e salve/);
});

test("Enquetes: os modelos com pergunta, tipo e opcoes, sem o interruptor Respostas anônimas (D64); Salvar desligado sem mudanca; o estado vazio", () => {
  const polls = [
    { anonymous: false, closedAt: null, id: "p-1", kind: "single", openOffsetMs: null, openedAt: null, options: [{ id: "o-1", label: "Sim", position: 0 }, { id: "o-2", label: "Não", position: 1 }], position: 0, question: "Vem na próxima?", resultsSharedAt: null, sessionId: null, status: "draft", templatePollId: null, webinarId: WEBINAR },
    // Legado: um modelo de antes de 10/11/2026 ainda marcado como anonimo; o card nao mostra nem oferece a marca.
    { anonymous: true, closedAt: null, id: "p-2", kind: "multiple", openOffsetMs: null, openedAt: null, options: [{ id: "o-3", label: "A", position: 0 }, { id: "o-4", label: "B", position: 1 }, { id: "o-5", label: "C", position: 2 }], position: 1, question: "Quais temas?", resultsSharedAt: null, sessionId: null, status: "draft", templatePollId: null, webinarId: WEBINAR }
  ];
  const markup = html(createElement(PollsCard, { disabled: false, initial: polls, webinarId: WEBINAR }));
  const text = textOf(markup);

  assert.equal(count(markup, /data-poll-row=/g), 2);
  assert.match(markup, /value="Vem na próxima\?"/);
  assert.match(markup, /value="Quais temas\?"/);
  assert.equal(count(markup, /placeholder="Opção \d"/g), 5);
  for (const label of ["Uma opção", "Várias opções", "Pesquisa", "Adicionar opção", "Adicionar enquete", "Salvar enquetes", "Até 20 enquetes por webinário."]) {
    assert.match(text, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), label);
  }
  // D64 (10/11/2026): toda enquete guarda quem respondeu; o interruptor "Respostas anônimas" saiu do card.
  assert.doesNotMatch(text, /an[oô]nim/i, "nenhuma frase de anonimo no card");
  assert.doesNotMatch(markup, /role="switch"|-anonymous"/, "sem o interruptor");
  assert.match(markup, /<button[^>]*disabled=""[^>]*>Salvar enquetes/, "sem mudanca nao salva");
  assert.doesNotMatch(text, /ainda não salvas/);

  const empty = textOf(html(createElement(PollsCard, { disabled: false, initial: [], webinarId: WEBINAR })));
  assert.match(empty, /Nenhuma enquete pronta\./);
});

test("D83 Enquetes do editor: o Salvar manda os ids que o card carregou (o servidor so apaga desses, entao a enquete criada no console com a pagina aberta fica); o teto do card e o do servidor", async () => {
  const { pollsSaveInput } = await import("../src/components/admin/v2/communication/webinars/polls-card.tsx");
  const { CHAT_LIMITS } = await import("../src/server/webinars/model.ts");
  const linhas = [{ id: "p-1", key: "p-1", kind: "single", options: [{ id: "o-1", key: "o-1", label: " Sim " }, { id: null, key: "k-2", label: "Não" }], question: " Vem? " }];
  assert.deepEqual(pollsSaveInput(linhas, [{ id: "p-1" }, { id: "p-2" }], WEBINAR), {
    loadedIds: ["p-1", "p-2"],
    polls: [{ id: "p-1", kind: "single", options: [{ id: "o-1", label: "Sim" }, { id: null, label: "Não" }], question: "Vem?" }],
    webinarId: WEBINAR
  });
  assert.equal(CHAT_LIMITS.pollTemplatesMax, 20);
  const fonte = readFileSync(new URL("../src/components/admin/v2/communication/webinars/polls-card.tsx", import.meta.url), "utf8");
  assert.match(fonte, /savePolls\(pollsSaveInput\(rows, saved, webinarId\)\)/, "o Salvar manda os ids do que esta salvo no card");
  assert.match(fonte, /const MAX_POLLS = CHAT_LIMITS\.pollTemplatesMax;/);
});

test("Sessões: Entrada atrasada por sessao (Até o fim / Até um minuto com os minutos), a situacao e o link do console das gravadas, o Replay livre", () => {
  const draft = { ...model.emptyWebinarDraft("simulated"), sessions: [{ lateJoinMinutes: null, scheduledAt: "2026-11-06T23:00:00.000Z" }, { lateJoinMinutes: 15, scheduledAt: "2026-11-07T23:00:00.000Z" }] };
  const props = { disabled: false, draft, errorFor: () => undefined, now: NOW, onBlur: () => undefined, onChange: () => undefined };
  const replay = { busy: false, firstEnded: true, onCancel: () => undefined, onCreate: () => undefined, session: null };
  const markup = html(createElement(SessionsCard, { ...props, replay, savedSessions: [session(), ended], webinarId: WEBINAR }));
  const text = textOf(markup);

  assert.equal(count(markup, /data-session-row=/g), 2);
  assert.equal(count(text, /Até o fim(?! ou)/g), 2, "a opcao Até o fim em cada sessao (a dica nao conta)");
  assert.equal(count(text, /Até um minuto/g), 2);
  assert.equal(count(markup, /id="webinar-sessions-\d-lateJoinMinutes"/g), 1, "so a sessao com minuto mostra o numero");
  assert.match(markup, /id="webinar-sessions-1-lateJoinMinutes"[^>]*value="15"|value="15"[^>]*id="webinar-sessions-1-lateJoinMinutes"/);
  assert.match(markup, new RegExp(`href="/admin/comunicacao/webinarios/${WEBINAR}/sala\\?sessao=${S_NEXT}"`), "o console da sessao gravada");
  assert.match(text, /Agendada/);
  assert.match(text, /Replay livre/);
  assert.match(text, /Depois da primeira sessão encerrar, o aluno assiste com a barra/);
  assert.doesNotMatch(text, /Começa quando você entra · em breve/, "o just-in-time saiu do em breve (fase 4e)");
  assert.doesNotMatch(text, /em breve/);
  assert.doesNotMatch(text, /Entrada atrasada · em breve/, "a Entrada atrasada saiu do em breve");

  const semEncerrada = html(createElement(SessionsCard, { ...props, replay: { ...replay, firstEnded: false }, savedSessions: [session()], webinarId: WEBINAR }));
  assert.match(textOf(semEncerrada), /Abre depois da primeira sessão encerrar\./);
  assert.match(semEncerrada, /id="webinar-replay"[^>]*disabled=""|disabled=""[^>]*id="webinar-replay"/, "sem sessao encerrada o replay nao liga");

  const comReplay = html(createElement(SessionsCard, { ...props, replay: { ...replay, session: session({ id: "replay-1", kind: "replay", scheduledAt: "2026-11-04T01:00:00.000Z", status: "live" }) }, savedSessions: [session(), ended], webinarId: WEBINAR }));
  assert.match(textOf(comReplay), /Replay disponível desde 03\/11\/2026 às 22:00\./);
  assert.match(comReplay, /href="\/admin\/comunicacao\/webinarios\/aaaaaaaa-1111-4111-8111-111111111111\/sala\?sessao=replay-1"/);

  const novo = textOf(html(createElement(SessionsCard, { ...props, replay: null, savedSessions: [], webinarId: null })));
  assert.doesNotMatch(novo, /Replay livre|Abrir o console/, "antes do primeiro salvar nao ha replay nem console");
});

/* ------------------------------------------------------------------------------------------------
 * O roteiro na Live ao vivo e a foto de quem comenta (adendo de 10/11/2026, R8 e R9)
 * ---------------------------------------------------------------------------------------------- */

const FOTO = "webinars/personas/0123456789abcdef01234567.webp";
const FOTO_URL = `https://projeto.supabase.co/storage/v1/object/public/content-assets/${FOTO}`;

test("R8 e R9 Roteiro na Live ao vivo: 'Num minuto da live' e 'Pelo botão da equipe' (sem 'Quando o apresentador diz', com o porquê), o minuto da live, sem a transcricao; a Foto (opcional) de quem comenta em cada linha", () => {
  const items = [scriptItem("a", { offsetMs: 12 * 60_000, personaAvatarPath: FOTO, personaName: "Bia C.", position: 0 }), scriptItem("m", { personaName: "Caio D.", position: 1, triggerKind: "manual" })];
  const markup = html(createElement(ScriptCard, { disabled: false, hasRecording: false, initialItems: items, initialTranscript: null, sessions: [session({ kind: "live" })], webinarId: WEBINAR, webinarKind: "live" }));
  const text = textOf(markup);
  assert.match(text, /Num minuto da live/);
  assert.match(text, /Pelo botão da equipe/);
  assert.doesNotMatch(text, /Quando o apresentador diz”? Solta|Num minuto do vídeo/);
  assert.equal(count(markup, /type="radio"[^>]*value="on_phrase"/g), 0, "a opcao nao existe na live");
  assert.equal(count(markup, /type="radio"[^>]*value="at_offset"/g), 2);
  assert.match(markup, /data-script-live-hint=""/);
  assert.match(text, /Na live ao vivo não há transcrição durante a transmissão, então “Quando o apresentador diz” não existe aqui\./);
  assert.match(text, /Minuto da live/);
  assert.match(text, /Contado do Começar para todos: minuto ou minuto:segundo, como 12 ou 12:30\./);
  // Achado 1 (revisao de 11/11/2026): o minuto da live como no card Simulação: o item dos 12 min mostra "12".
  assert.match(markup, /<input[^>]*placeholder="12:30"[^>]*value="12"\/>/);
  assert.match(markup.match(/<span[^>]*data-script-csv-hint=""[^>]*>([^<]*)<\/span>/)?.[1] ?? "", /Tempo é o minuto da live, como 12 ou 12:30/);
  assert.doesNotMatch(text, /Transcrição do vídeo|Resolver frases|Salvar transcrição/, "sem transcricao na live");
  assert.doesNotMatch(markup, /data-transcript-input/);
  // A foto de quem comenta em cada linha: a previa, Trocar e Remover, a dica, a linha do consentimento e a caixa.
  assert.equal(count(markup, /data-persona-photo=""/g), 2);
  assert.match(markup, new RegExp(`<img alt="Foto de Bia C\\." [^>]*data-persona-photo-preview=""[^>]*src="${FOTO_URL.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"`));
  assert.match(text, /Foto \(opcional\)/);
  assert.match(text, /Trocar Remover/);
  assert.match(text, /Enviar foto/, "a linha sem foto");
  assert.match(text, /JPG, PNG ou WebP\. Fica com até 512 px\./);
  assert.equal(count(markup, /data-persona-photo-consent=""/g), 2);
  assert.match(text, /Use imagem gerada ou com autorização\. Nunca a foto de uma pessoa real sem o consentimento dela\./);
  // A caixa "Usar esta foto em todos os comentários de {nome}" saiu em 11/11/2026 (D75): a foto e da pessoa da lista.
  assert.doesNotMatch(markup, /data-persona-photo-all|Usar esta foto em todos/);
  assert.doesNotMatch(text, /personagem/i);

  // A gravada continua com as tres opcoes e a transcricao; a foto tambem.
  const gravada = html(createElement(ScriptCard, { disabled: false, hasRecording: true, initialItems: items, initialTranscript: null, sessions: [session()], webinarId: WEBINAR }));
  assert.match(gravada, /<input[^>]*placeholder="mm:ss"[^>]*value="12:00"\/>/, "a gravada continua no minuto do video");
  assert.match(textOf(gravada), /Tempo como 1:02:03, 02:03 ou 63 \(segundos\)/);
  assert.match(textOf(gravada), /Num minuto do vídeo.*Quando o apresentador diz.*Pelo botão da equipe/);
  assert.match(textOf(gravada), /Transcrição do vídeo/);
  assert.doesNotMatch(gravada, /data-script-live-hint/);
  assert.equal(count(gravada, /data-persona-photo=""/g), 2);
  assert.equal(count(gravada, /type="radio"[^>]*value="on_phrase"/g), 2, "na gravada, a frase continua");
});

test("R8 e R9 console: o Roteiro da live com 'Aos 12 minutos da live', a foto de quem comenta e o 'Novo comentário' com Quem comenta, Aparece como, Enviar agora e Guardar na lista", async () => {
  const { ConsoleScript } = await import("../src/components/admin/v2/communication/webinars/session-console/console-script.tsx");
  const { scriptCommentErrors, scriptCommentInput } = await import("../src/components/admin/v2/communication/webinars/session-console/console-script-comment.tsx");
  const items = [scriptItem("a", { offsetMs: 12 * 60_000, personaAvatarPath: FOTO, personaName: "Bia C.", position: 0 }), scriptItem("b", { offsetMs: 30_000, personaName: "Caio D.", personaRole: "team", position: 1 }), scriptItem("m", { personaName: "Duda", position: 2, triggerKind: "manual" })];
  const queue = consoleModel.scriptQueue(items, { b: "2026-11-10T23:01:00.000Z" }, 60_000);
  const props = { busyKey: null, canAct: true, live: true, onComment: async () => null, onFire: () => undefined, onUpload: async () => ({ error: "x", ok: false, status: 500 }), origin: "https://projeto.supabase.co", queue };
  const lista = html(createElement(ConsoleScript, props));
  const text = textOf(lista);
  assert.match(text, /Aos 12 minutos da live/);
  assert.match(text, /Pelo botão/);
  assert.match(lista, new RegExp(`src="${FOTO_URL.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"`), "a foto de quem comenta no item");
  assert.match(lista, /data-console-script-new=""/);
  assert.match(text, /Novo comentário/);
  assert.equal(count(lista, /Soltar agora/g), 2, "o que ja entrou nao solta de novo");
  const vazia = html(createElement(ConsoleScript, { ...props, queue: [] }));
  assert.match(vazia, /Sem roteiro nesta live\. Crie no editor do webinário ou use o Novo comentário\./);
  assert.doesNotMatch(vazia, /<ol/, "sem item, so a frase: nenhuma lista vazia para o leitor de tela");
  assert.match(vazia, /data-console-script-new=""/, "o Novo comentário continua com o roteiro vazio");
  assert.match(lista, /<ol[^>]*data-console-script=""/, "com item, a lista");
  assert.doesNotMatch(html(createElement(ConsoleScript, { ...props, onComment: undefined })), /data-console-script-new/, "sem a acao, sem o botao");

  // Sem a lista no retrato (o banco sem a 202611110001), o Nome digitado como antes.
  const form = html(createElement(ConsoleScript, { ...props, initialComment: { body: "Que aula!", kind: "message", personaAvatarPath: FOTO, personaId: null, personaName: "Bia C.", personaRole: "team" } }));
  const formText = textOf(form);
  assert.match(form, /data-console-script-comment=""/);
  assert.doesNotMatch(form, /data-console-script=""/, "o formulario no lugar da lista");
  for (const rotulo of ["Novo comentário", "Voltar", "Quem comenta", "Nome", "Foto (opcional)", "Aparece como", "Aluno", "Equipe", "Comentário", "Enviar agora", "Guardar na lista", "Cancelar"]) {
    assert.ok(formText.includes(rotulo), rotulo);
  }
  assert.match(form, /<legend[^>]*>Quem comenta<\/legend>/);
  assert.match(form, /value="Bia C\."/);
  assert.match(formText, /Use imagem gerada ou com autorização\. Nunca a foto de uma pessoa real sem o consentimento dela\./);
  // A caixa "Usar esta foto em todos" saiu em 11/11/2026 (D75); o Tipo (Comentário ou Pergunta) entrou (D77).
  assert.doesNotMatch(form, /data-persona-photo-all|Usar esta foto em todos/);
  assert.match(form, /<input[^>]*type="radio"[^>]*checked=""[^>]*value="team"\/>/, "Aparece como Equipe");
  assert.match(form, /<input[^>]*type="radio"[^>]*checked=""[^>]*value="message"\/>/, "Tipo Comentário");
  assert.doesNotMatch(formText, /personagem/i);
  const semSessao = html(createElement(ConsoleScript, { ...props, canAct: false, initialComment: { body: "", kind: "message", personaAvatarPath: null, personaId: null, personaName: "", personaRole: "student" } }));
  assert.doesNotMatch(semSessao, /data-console-script-send/, "sessao encerrada: so Guardar na lista");
  assert.match(semSessao, /data-console-script-save=""/);

  assert.deepEqual(scriptCommentErrors({ body: " ", kind: "message", personaAvatarPath: null, personaId: null, personaName: "", personaRole: "student" }), { body: "Escreva o comentário (até 1.000 caracteres).", personaName: "Dê um nome a quem comenta (até 60 caracteres)." });
  assert.deepEqual(scriptCommentInput({ body: "  Oi  ", kind: "question", personaAvatarPath: FOTO, personaId: null, personaName: " Bia C. ", personaRole: "team" }), { body: "Oi", kind: "question", personaAvatarPath: FOTO, personaId: null, personaName: "Bia C.", personaRole: "team" });
});

test("achados 1, 3 e 4 (revisao de 11/11/2026): o minuto da live digitado em minutos (como no card Simulação); o Salvar manda os ids carregados e so a foto que mudou; nada sai enquanto a foto sobe", async () => {
  const card = await import("../src/components/admin/v2/communication/webinars/script-card.tsx");
  const { ConsoleScriptComment } = await import("../src/components/admin/v2/communication/webinars/session-console/console-script-comment.tsx");
  const { liveScriptDueLabel } = await import("../src/server/webinars/persona-model.ts");

  // Achado 1: na live, "12" e 12 minutos e "12:30" e minuto e segundo; o console diz "Aos 12 minutos da live".
  assert.equal(card.scriptOffsetInput("12", true), 12 * 60_000);
  assert.equal(card.scriptOffsetInput("12:30", true), 12 * 60_000 + 30_000);
  assert.equal(liveScriptDueLabel(card.scriptOffsetInput("12", true)), "Aos 12 minutos da live");
  assert.equal(card.scriptOffsetInput("12.5", true), null);
  assert.equal(card.scriptOffsetInput("3000", true), null, "passa das 48 h do banco");
  assert.equal(card.scriptOffsetInput("12", false), 12_000, "na gravada, segundos do video");
  assert.equal(card.scriptOffsetInput("1:02:03", false), 3_723_000);

  // Achado 3: o Salvar manda os ids que o card carregou (o servidor so apaga desses) e a foto so quando mudou.
  const carregados = [
    { id: "a", personaAvatarPath: FOTO },
    { id: "b", personaAvatarPath: null },
    { id: "c", personaAvatarPath: FOTO }
  ];
  const draft = (id, personaAvatarPath) => ({ body: "x", id, kind: "message", offsetMs: 0, personaAvatarPath, personaName: "Bia C.", personaRole: "student", phrase: null, phraseDelayMs: 0, status: "draft", triggerKind: "at_offset" });
  const OUTRA = "webinars/personas/89abcdef0123456789abcdef.webp";
  const enviado = card.scriptSaveInput([draft("a", FOTO), draft("b", OUTRA), draft("c", null), draft(null, FOTO)], carregados, WEBINAR);
  assert.deepEqual(enviado.loadedIds, ["a", "b", "c"]);
  assert.equal(enviado.webinarId, WEBINAR);
  assert.ok(!("personaAvatarPath" in enviado.items[0]), "a foto que nao mudou nao vai (o banco fica com a dele)");
  assert.equal(enviado.items[1].personaAvatarPath, OUTRA, "trocada");
  assert.equal(enviado.items[2].personaAvatarPath, null, "removida");
  assert.equal(enviado.items[3].personaAvatarPath, FOTO, "a linha nova leva a foto");

  // Achado 4: com a foto subindo, o Salvar do card e o Enviar agora e o Guardar na lista do console esperam.
  assert.equal(card.scriptCanSave({ dirty: true, locked: false, uploading: 0 }), true);
  assert.equal(card.scriptCanSave({ dirty: true, locked: false, uploading: 1 }), false);
  assert.equal(card.scriptCanSave({ dirty: false, locked: false, uploading: 0 }), false);
  const items = [scriptItem("a", { offsetMs: 60_000, personaName: "Bia C.", position: 0 })];
  const subindo = html(createElement(ScriptCard, { disabled: false, hasRecording: true, initialItems: items, initialTranscript: null, initialUploading: ["a"], sessions: [session()], webinarId: WEBINAR }));
  assert.match(subindo, /<button(?=[^>]*data-persona-photo-send="")(?=[^>]*\sdisabled="")[^>]*>[\s\S]*?Enviando a foto…/, "a linha com a foto subindo");
  assert.match(subindo.match(/<button[^>]*data-script-save=""[^>]*>/)?.[0] ?? "", /\sdisabled=""/);
  const estado = { body: "Que aula!", kind: "message", personaAvatarPath: null, personaId: null, personaName: "Bia C.", personaRole: "student" };
  const props = { busy: false, canSend: true, initialState: estado, onBack() {}, onSubmit: async () => null, onUpload: async () => ({ error: "x", ok: false, status: 500 }) };
  const livre = html(createElement(ConsoleScriptComment, props));
  assert.doesNotMatch(livre.match(/<button[^>]*data-console-script-send=""[^>]*>/)?.[0] ?? "", /disabled=""/, "sem foto subindo, o Enviar agora vale");
  const comFoto = html(createElement(ConsoleScriptComment, { ...props, initialUploading: true }));
  assert.match(comFoto.match(/<button[^>]*data-console-script-send=""[^>]*>/)?.[0] ?? "", /disabled=""/, "Enviar agora espera a foto");
  assert.match(comFoto.match(/<button[^>]*data-console-script-save=""[^>]*>/)?.[0] ?? "", /disabled=""/, "Guardar na lista espera a foto");
  assert.match(comFoto, /Enviando a foto…/);
});
