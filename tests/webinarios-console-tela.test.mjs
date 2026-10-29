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
export function DropdownMenuItem({ children, disabled, render }) {
  return render ? cloneElement(render, { "data-menu-item": "", role: "menuitem" }, children) : createElement("div", { "aria-disabled": disabled || undefined, "data-menu-item": "", role: "menuitem" }, children);
}`,
  "@/server/webinars/actions": `${fail}
export const saveWebinarDraft = fail; export const publishWebinar = fail; export const cancelWebinar = fail; export const duplicateWebinar = fail; export const deleteWebinar = fail; export const rescheduleSession = fail; export const uploadWebinarCover = fail;`,
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
    messages,
    pinnedMessageId: "m-equipe",
    polls: {
      launched: [poll({ counts: { answers: 3, byOption: { "o-1": 2, "o-2": 1 } }, id: "p-copia", openedAt: new Date(NOW - MIN).toISOString(), sessionId: S_LIVE, status: "open", templatePollId: "p-1" })],
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

test("cabecalho: trilha, fase No ar com o relogio, presentes agora, Voltar ao editor e Encerrar sessão (so para quem publica); o seletor lista as sessoes", () => {
  const markup = render({ sessions, snapshot: snapshot(), webinar });
  const text = textOf(markup);

  assert.match(text, /Webinários \/ Aula de IA \/ Console/);
  assert.match(text, /Console da sessão/);
  assert.match(text, /No ar/);
  assert.match(text, /No ar há \d+:\d\d/);
  assert.match(text, /7 presentes agora/);
  assert.match(markup, /href="\/admin\/comunicacao\/webinarios\/aaaaaaaa-1111-4111-8111-111111111111"/, "Voltar ao editor");
  assert.match(text, /Encerrar sessão/);
  assert.doesNotMatch(text, /Abrir sessão/, "a sessao no ar nao abre de novo");

  const select = markup.slice(markup.indexOf('id="console-session"'), markup.indexOf("</select>"));
  assert.equal(count(select, /<option/g), 3, "as tres sessoes no seletor");
  assert.match(select, new RegExp(`<option value="${S_LIVE}" selected=""`), "a sessao pedida vem marcada");
  assert.match(textOf(select), /No ar/);
  assert.match(textOf(select), /Agendada/);
  assert.match(textOf(select), /Encerrada/);

  const soEscreve = textOf(render({ sessions, snapshot: snapshot(), webinar }, { canPublish: false, canWrite: true }));
  assert.doesNotMatch(soEscreve, /Encerrar sessão|Abrir sessão/, "sem messaging.publish nao abre nem encerra");

  const agendada = textOf(render({ sessions, snapshot: snapshot({ session: sessions[1] }), webinar }));
  assert.match(agendada, /Abrir sessão/);
  assert.match(agendada, /Agendada/);
  assert.doesNotMatch(agendada, /Encerrar sessão/);
});

test("chat: pendente com Liberar, promover so com o aceite (sem ele, o motivo), a fixada com Desafixar, Apagar em todas, selos de origem, quem pode escrever e modo lento", () => {
  const markup = render({ sessions, snapshot: snapshot(), webinar });
  const text = textOf(markup);
  const messageBlock = (id) => markup.slice(markup.indexOf(`data-console-message="${id}"`), markup.indexOf("</li>", markup.indexOf(`data-console-message="${id}"`)));

  assert.equal(count(markup, /data-console-message=/g), 4);
  const pendente = textOf(messageBlock("m-pendente"));
  assert.match(pendente, /Na moderação/);
  assert.match(pendente, /Liberar/);
  assert.doesNotMatch(pendente, /Aprovar para as próximas turmas/, "promove depois de liberar");
  assert.doesNotMatch(pendente, /Fixar/, "fixa depois de liberar");

  const semAceite = textOf(messageBlock("m-sem-aceite"));
  assert.match(semAceite, /Sem consentimento do aluno/);
  assert.doesNotMatch(semAceite, /Aprovar para as próximas turmas/);
  assert.match(semAceite, /Fixar/);

  const equipe = textOf(messageBlock("m-equipe"));
  assert.match(equipe, /Apresentador/);
  assert.match(equipe, /Fixada/);
  assert.match(equipe, /Desafixar/);
  assert.doesNotMatch(equipe, /Aprovar para as próximas turmas/);

  const roteiro = textOf(messageBlock("m-roteiro"));
  assert.match(roteiro, /Roteiro/);
  assert.equal(count(markup, /Apagar: /g), 4, "Apagar em todas");
  assert.match(text, /Quem pode escrever/);
  assert.match(text, /Modo lento/);
  for (const label of ["Aberto", "Moderado", "Só a equipe", "Desligado", "10 s", "60 s"]) {
    assert.match(text, new RegExp(label), label);
  }
  assert.match(markup, /placeholder="Escreva para a turma"/);
  assert.match(text, /Enviar/);
  assert.match(text, /1:00/, "o minuto do video de cada mensagem");
});

test("roteiro: a fila com o que entrou, Soltar agora so no que falta e no manual, a desligada sem botao, o resumo; enquetes e perguntas", () => {
  const markup = render({ sessions, snapshot: snapshot(), webinar });
  const text = textOf(markup);

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
  assert.match(textOf(templates), /Quais temas\? Várias opções · 2 opções · respostas anônimas/);

  const questions = markup.slice(markup.indexOf("data-console-questions"));
  const order = Array.from(questions.matchAll(/data-console-question="([^"]+)"/g)).map((match) => match[1]);
  assert.deepEqual(order, ["q-top", "q-1", "q-respondida", "q-dispensada"], "abertas por voto, depois respondidas, dispensadas no fim");
  assert.match(textOf(questions), /Anônima/);
  assert.match(textOf(questions), /5 votos/);
  assert.match(textOf(questions), /Sim, 7 dias\./);
  assert.equal(count(questions, />Responder por escrito</g), 2);
  assert.equal(count(questions, />Respondida ao vivo</g), 2);
  assert.equal(count(questions, />Reabrir</g), 2);
});

test("sessao encerrada: so leitura (sem Soltar agora, Liberar nem Enviar habilitado) e o link do relatorio; sem sessao, o estado vazio", () => {
  const ended = snapshot({ session: sessions[2] });
  const markup = render({ sessions, snapshot: ended, webinar });
  const text = textOf(markup);

  assert.match(text, /Encerrada/);
  assert.match(text, /Esta sessão não aceita mais ações da equipe\./);
  assert.match(markup, /href="\/admin\/comunicacao\/webinarios\/aaaaaaaa-1111-4111-8111-111111111111\/relatorio"/, "Ver relatório");
  assert.equal(count(markup, />Soltar agora</g), 0);
  assert.doesNotMatch(text, /Liberar|Apagar/);
  assert.match(markup, /id="console-composer"[^>]*disabled=""|disabled=""[^>]*id="console-composer"/, "a caixa da equipe fica desligada");

  const empty = textOf(render({ sessions: [], snapshot: null, webinar: { ...webinar, kind: "live" } }));
  assert.match(empty, /Marque pelo menos uma sessão\./);
  assert.doesNotMatch(empty, /Soltar agora|Enviar/);
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
  assert.match(room, /runAdminAction\("messaging\.publish", sessionIdInputSchema, input, async[\s\S]*?openSession\(db, row\.id, now\)/, "abrir pede messaging.publish");
  assert.match(room, /runAdminAction\("messaging\.publish", sessionIdInputSchema, input, async[\s\S]*?finishSession\(db, row\.id, now\)/, "encerrar pede messaging.publish");
  assert.match(room, /runAdminAction\("messaging\.publish", saveSimulationSchema/);
  assert.match(room, /runAdminAction\("messaging\.publish", removeStudentMessagesSchema/);
  assert.match(room, /runAdminAction\("messaging\.write", moderateMessageSchema/);
  assert.match(room, /runAdminAction\("messaging\.write", createReplaySessionSchema/);
  for (const action of ["webinar.session_opened", "webinar.session_ended", "webinar.team_message", "webinar.moderated", "webinar.chat_mode", "webinar.polls_saved", "webinar.poll_launched", "webinar.poll_closed", "webinar.question_answered", "webinar.question_status", "webinar.simulation_saved", "webinar.replay_created", "webinar.replay_cancelled", "webinar.student_messages_removed"]) {
    assert.match(room, new RegExp(`action: "${action.replace(".", "\\.")}"`), action);
  }

  const script = stripComments(read("src/server/webinars/script-actions.ts"));
  assert.match(script, /^"use server";/);
  assert.equal(count(script, /runAdminAction\("messaging\.write"/g), 7, "as sete acoes do roteiro pedem messaging.write");
  assert.doesNotMatch(script, /runAdminAction\("messaging\.publish"/);
  for (const action of ["webinar.script_saved", "webinar.script_imported", "webinar.script_exported", "webinar.chat_exported", "webinar.transcript_saved", "webinar.script_resolved", "webinar.script_fired"]) {
    assert.match(script, new RegExp(`action: "${action.replace(".", "\\.")}"`), action);
  }
  assert.doesNotMatch(`${room}${script}`, /full_name|email:/, "nada de nome ou e-mail na auditoria");
});
