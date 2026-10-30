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
  "@/server/webinars/script-actions": `${fail}
export const saveScriptItems = fail; export const importScriptCsv = fail; export const exportScriptCsv = fail; export const exportSessionChatCsv = fail; export const saveTranscript = fail; export const resolveScriptPhrases = fail; export const fireScriptItem = fail;`,
  "@/server/webinars/simulation-actions": `${fail}
export const loadSessionSimulations = fail; export const saveSessionSimulation = fail;`,
  "@/server/webinars/jit-actions": `${fail}
export const saveJitSettings = fail; export const loadJitSettings = fail;`,
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

test("Enquetes: os modelos com pergunta, tipo, respostas anonimas e opcoes; Salvar desligado sem mudanca; o estado vazio", () => {
  const polls = [
    { anonymous: false, closedAt: null, id: "p-1", kind: "single", openOffsetMs: null, openedAt: null, options: [{ id: "o-1", label: "Sim", position: 0 }, { id: "o-2", label: "Não", position: 1 }], position: 0, question: "Vem na próxima?", resultsSharedAt: null, sessionId: null, status: "draft", templatePollId: null, webinarId: WEBINAR },
    { anonymous: true, closedAt: null, id: "p-2", kind: "multiple", openOffsetMs: null, openedAt: null, options: [{ id: "o-3", label: "A", position: 0 }, { id: "o-4", label: "B", position: 1 }, { id: "o-5", label: "C", position: 2 }], position: 1, question: "Quais temas?", resultsSharedAt: null, sessionId: null, status: "draft", templatePollId: null, webinarId: WEBINAR }
  ];
  const markup = html(createElement(PollsCard, { disabled: false, initial: polls, webinarId: WEBINAR }));
  const text = textOf(markup);

  assert.equal(count(markup, /data-poll-row=/g), 2);
  assert.match(markup, /value="Vem na próxima\?"/);
  assert.match(markup, /value="Quais temas\?"/);
  assert.equal(count(markup, /placeholder="Opção \d"/g), 5);
  for (const label of ["Uma opção", "Várias opções", "Pesquisa", "Respostas anônimas", "Adicionar opção", "Adicionar enquete", "Salvar enquetes", "Até 20 enquetes por webinário."]) {
    assert.match(text, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), label);
  }
  assert.match(markup, /aria-checked="true"/, "a segunda e anonima");
  assert.match(markup, /<button[^>]*disabled=""[^>]*>Salvar enquetes/, "sem mudanca nao salva");
  assert.doesNotMatch(text, /ainda não salvas/);

  const empty = textOf(html(createElement(PollsCard, { disabled: false, initial: [], webinarId: WEBINAR })));
  assert.match(empty, /Nenhuma enquete pronta\./);
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
