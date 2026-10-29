import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import "./support/transpile-tsx.mjs";

// O Assistente e o Atendimento desenhados (docs/30 §1.3, §1.6, §2.2, §2.4, §6.6, §9 e D24; docs/18 §2.2), no Node com
// react-dom/server e as Server Actions como dubles: no chat da sala, o selo Assistente (e o "Assistente:" do leitor de
// tela) e "Falar com a equipe" so na resposta do Assistente a uma mensagem do proprio aluno (nunca no "ver como"); a
// linha da dica (respondendo, limite, "@assistente", a equipe responde depois); o pronto do pedido; na aba Perguntas,
// o selo na resposta do Assistente; o painel Atendimento do console (Atender / Pausar, Responder tudo e os avisos de
// Assistente desligado, quem atende com as perguntas abertas, "Ninguem atendendo", a fila com origem, Pediu a equipe,
// com quem esta, o que o Assistente fez, Assumir, Devolver, Passar para e Responder; sem permissao, so leitura); o
// card Assistente do editor em cada estado (migracao pendente, ambiente desligado, sem IA, o formulario); as marcas
// no painel Perguntas; e as frases todas de WEBINAR_COPY (nenhum texto com acento nos arquivos novos).

const fail = `const fail = async () => ({ error: "Falhou.", ok: false, status: 500 });`;
const STUBS = {
  "@/server/webinars/assistant-actions": `${fail}
export const loadAssistantEditor = fail; export const saveAssistant = fail; export const loadAttendanceSnapshot = fail; export const setReplyAll = fail; export const pingAttendant = fail; export const assign = fail; export const editAssistantAnswer = fail;`,
  "@/server/webinars/room-actions": `${fail}
export const answerQuestion = fail; export const sendTeamMessage = fail; export const setQuestionStatus = fail;`
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBS[specifier]) {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}` };
    }
    return nextResolve(specifier, context);
  }
});

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { RoomChatPanel } = await import("../src/components/member/webinars/room/room-chat.tsx");
const { RoomQuestionItem } = await import("../src/components/member/webinars/room/room-questions.tsx");
const { AssistantHandoff } = await import("../src/components/member/webinars/room/assistant/assistant-handoff.tsx");
const { AssistantHint, assistantHintText } = await import("../src/components/member/webinars/room/assistant/assistant-hint.tsx");
const { AttendancePanel } = await import("../src/components/admin/v2/communication/webinars/assistant/attendance-panel.tsx");
const { AssistantCardBody } = await import("../src/components/admin/v2/communication/webinars/assistant-card.tsx");
const editorModel = await import("../src/components/admin/v2/communication/webinars/assistant/assistant-editor-model.ts");
const { ConsoleQuestions } = await import("../src/components/admin/v2/communication/webinars/session-console/console-questions.tsx");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const COPY = WEBINAR_COPY.assistente;
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const textOf = (markup) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const count = (markup, pattern) => (markup.match(pattern) ?? []).length;
const noop = () => undefined;
const NOW = Date.parse("2026-11-05T23:10:00.000Z");

/* ------------------------------------------------------------------------------------------------
 * A sala do aluno
 * ---------------------------------------------------------------------------------------------- */

const msg = (id, extra = {}) => ({ body: `texto ${id}`, displayName: "Ana S.", id, kind: "message", mine: false, offsetMs: 600_000, pending: false, pinned: false, replyToId: null, role: "student", ...extra });

function chat(props = {}) {
  return render(RoomChatPanel, {
    chatMode: "open",
    consented: true,
    defaultDisplayMode: "first_name_initial",
    displayName: "Ana S.",
    error: null,
    messages: [
      msg("m-minha", { body: "@assistente quanto custa?", mine: true }),
      msg("m-outro", { body: "@assistente e o bonus?", displayName: "Zé" }),
      msg("a-minha", { body: "Custa R$ 997.", displayName: "Assistente", kind: "answer", replyToId: "m-minha", role: "ai" }),
      msg("a-outro", { body: "Tem bonus.", displayName: "Assistente", kind: "answer", replyToId: "m-outro", role: "ai" }),
      msg("t-1", { body: "Oi, turma!", displayName: "Bia E.", role: "team" })
    ],
    nowMs: NOW,
    onRemoveMine: async () => 0,
    onSend: async () => ({ pending: false }),
    phase: "live",
    pinned: null,
    readOnly: false,
    sessionId: "s1",
    slowUntilMs: null,
    webinarId: "w1",
    ...props
  });
}

test("chat da sala: o selo Assistente (e 'Assistente:' para o leitor de tela) e 'Falar com a equipe' so na resposta do Assistente a mensagem do proprio aluno", () => {
  const markup = chat();
  const bloco = (id) => markup.slice(markup.indexOf(`data-room-message="${id}"`), markup.indexOf("</li>", markup.indexOf(`data-room-message="${id}"`)));
  assert.match(textOf(bloco("a-minha")), /Assistente: Assistente Assistente Custa R\$ 997\./, "o prefixo do leitor de tela, o nome e o selo");
  assert.match(bloco("a-minha"), /data-testid="assistant-handoff"/);
  assert.match(textOf(bloco("a-minha")), new RegExp(COPY.aluno.falarComAEquipe));
  assert.doesNotMatch(bloco("a-outro"), /assistant-handoff/, "a resposta a outro aluno nao tem o botao");
  assert.match(textOf(bloco("a-outro")), /Assistente/, "mas leva o selo");
  assert.doesNotMatch(bloco("t-1"), /assistant-handoff/);
  assert.equal(count(markup, /data-testid="assistant-handoff"/g), 1);

  const verComo = chat({ readOnly: true });
  assert.equal(count(verComo, /data-testid="assistant-handoff"/g), 0, "no 'ver como' nada de pedido");
  assert.match(textOf(verComo), new RegExp(WEBINAR_COPY.aluno.previaSemGravar));
  assert.doesNotMatch(verComo, /data-testid="assistant-hint"/);

  const semIds = chat({ sessionId: null, webinarId: null });
  assert.doesNotMatch(semIds, /data-testid="assistant-handoff"/, "sem o webinario e a sessao, nada de pedido (so o selo)");
  assert.match(textOf(semIds), /Assistente/);
});

test("a linha do Assistente: respondendo, limite, a dica @assistente e a equipe responde depois; nada sem o que dizer", () => {
  assert.equal(assistantHintText("waiting"), COPY.aluno.respondendo);
  assert.equal(assistantHintText("limit"), COPY.aluno.limite);
  assert.equal(assistantHintText("call"), COPY.aluno.chamarAssistente);
  assert.equal(assistantHintText("team_later"), COPY.aluno.equipeRespondeDepois);
  assert.equal(assistantHintText("none"), null);
  const dica = render(AssistantHint, { state: "call" });
  assert.match(dica, /aria-live="polite"/);
  assert.match(dica, /data-assistant-hint="call"/);
  assert.match(textOf(dica), /Escreva @assistente para perguntar ao Assistente\./);
  assert.equal(render(AssistantHint, { state: "none" }), "");
});

test("Falar com a equipe: o botao; depois, o pronto (e o sino quando ninguem esta atendendo)", () => {
  const botao = render(AssistantHandoff, { attendantsOnline: 0, onRequest: async () => true });
  assert.match(textOf(botao), /Falar com a equipe/);
  assert.doesNotMatch(botao, /disabled=""/);
  assert.match(render(AssistantHandoff, { attendantsOnline: 0, onRequest: async () => true, readOnly: true }), /disabled=""/);
  assert.equal(textOf(render(AssistantHandoff, { attendantsOnline: 0, done: true, onRequest: async () => true })), `${COPY.aluno.pedidoEnviado} ${COPY.aluno.equipeRespondeDepois}`);
  assert.equal(textOf(render(AssistantHandoff, { attendantsOnline: 2, done: true, onRequest: async () => true })), COPY.aluno.pedidoEnviado);
});

test("aba Perguntas: a resposta do Assistente leva o selo (e o 'Assistente:' do leitor de tela) e o pedido abaixo", () => {
  const pergunta = { anonymous: false, answerSource: "ai", answerText: "Sim, ha certificado.", answeredLive: false, body: "Tem certificado?", createdAt: new Date(NOW).toISOString(), displayName: "Ana S.", handoffRequested: false, id: "q1", mine: true, status: "answered", upvotes: 2, voted: false };
  const markup = render(RoomQuestionItem, { footer: createElement("span", { "data-rodape": "" }, "rodape"), onVote: noop, question: pergunta });
  assert.match(markup, /data-testid="question-answer-assistant"/);
  assert.match(textOf(markup), /Respondida por escrito Assistente Assistente: Sim, ha certificado\./);
  assert.match(markup, /data-rodape/);
  const daEquipe = render(RoomQuestionItem, { onVote: noop, question: { ...pergunta, answerSource: "team" } });
  assert.doesNotMatch(daEquipe, /question-answer-assistant/);
});

/* ------------------------------------------------------------------------------------------------
 * O console: Atendimento e Perguntas
 * ---------------------------------------------------------------------------------------------- */

const EU = "u-eu";
const BIA = "u-bia";

function retrato(extra = {}) {
  return {
    assistant: { aiAvailable: true, envEnabled: true, replyAll: false, settingsEnabled: true },
    attendants: [
      { lastSeenAt: new Date(NOW).toISOString(), name: "Bia A.", online: true, openCount: 2, status: "online", userId: BIA },
      { lastSeenAt: new Date(NOW).toISOString(), name: "Eu T.", online: true, openCount: 1, status: "online", userId: EU },
      { lastSeenAt: new Date(NOW - 600_000).toISOString(), name: "Caio F.", online: false, openCount: 0, status: "online", userId: "u-caio" }
    ],
    distributed: 0,
    me: { online: true, status: "online" },
    names: { [BIA]: "Bia A.", [EU]: "Eu T." },
    open: true,
    pendingMigration: false,
    queue: [
      { aiStatus: "answered", anonymous: false, answerSource: "ai", assignedTo: BIA, body: "@assistente nao entendi", createdAt: new Date(NOW - 60_000).toISOString(), displayName: "Ana S.", handoffRequested: true, id: "m1", target: "chat" },
      { aiStatus: "pending", anonymous: true, answerSource: null, assignedTo: null, body: "Tem certificado?", createdAt: new Date(NOW - 30_000).toISOString(), displayName: "Aluno 123", handoffRequested: false, id: "q1", target: "question" },
      { aiStatus: null, anonymous: false, answerSource: null, assignedTo: EU, body: "E o bonus?", createdAt: new Date(NOW - 20_000).toISOString(), displayName: "Zé", handoffRequested: false, id: "q2", target: "question" }
    ],
    questionMarks: {},
    serverTime: new Date(NOW).toISOString(),
    sessionId: "s1",
    sessionKind: "simulated",
    webinarId: "w1",
    ...extra
  };
}

function painel(snapshot = retrato(), extra = {}) {
  return render(AttendancePanel, { busyKey: null, canAct: true, currentUserId: EU, error: null, onAnswer: async () => true, onAssign: noop, onReplyAll: noop, onToggleAttending: noop, snapshot, ...extra });
}

test("painel Atendimento: Pausar de quem atende, Responder tudo, quem atende com as perguntas abertas, e a fila com origem, Pediu a equipe, com quem esta e o que o Assistente fez", () => {
  const markup = painel();
  const text = textOf(markup);
  assert.match(text, /Atendimento Atendendo agora/);
  assert.match(text, /Pausar/);
  assert.match(markup, /data-attendance-assistant="called"/);
  assert.match(text, /Responder tudo O Assistente responde só quando chamado\./);
  assert.match(text, /Quem está atendendo Bia A\. · 2 perguntas abertas Eu T\. · 1 pergunta aberta/);
  assert.doesNotMatch(text, /Caio F\./, "quem nao bate ha 10 min nao aparece");

  const item = (id) => textOf(markup.slice(markup.indexOf(`data-attendance-item="${id}"`), markup.indexOf("</li>", markup.indexOf(`data-attendance-item="${id}"`))));
  assert.match(item("m1"), /Ana S\. Do chat Pediu a equipe Com Bia A\. Respondida pelo Assistente @assistente nao entendi/);
  assert.match(item("m1"), /Assumir Devolver para a fila Passar para/);
  assert.match(item("q1"), /Anônima Da aba Perguntas O Assistente está respondendo Tem certificado\?/);
  assert.doesNotMatch(item("q1"), /Devolver/, "sem dono nao devolve");
  assert.match(item("q2"), /Com você/);
  assert.doesNotMatch(item("q2"), /Assumir/, "a minha nao tem Assumir");
  assert.equal(count(markup, />Responder</g), 3);
  assert.match(markup, /placeholder="Escreva a resposta"/);

  const ligado = textOf(painel(retrato({ assistant: { aiAvailable: true, envEnabled: true, replyAll: true, settingsEnabled: true } })));
  assert.match(ligado, /O Assistente responde as perguntas novas que ninguém assumiu\./);
  assert.match(textOf(painel(retrato({ me: { online: false, status: "away" } }))), /Atendimento Ausente Atender/);
});

test("painel Atendimento: os avisos de Assistente desligado (ambiente, sem IA, webinario), ninguem atendendo, fila vazia e so leitura", () => {
  assert.match(textOf(painel(retrato({ assistant: { aiAvailable: false, envEnabled: false, replyAll: false, settingsEnabled: true } }))), new RegExp(COPY.card.desligadoNoAmbiente));
  assert.match(textOf(painel(retrato({ assistant: { aiAvailable: false, envEnabled: true, replyAll: false, settingsEnabled: true } }))), /Nenhuma conexão de IA ativa/);
  const desligado = painel(retrato({ assistant: { aiAvailable: true, envEnabled: true, replyAll: false, settingsEnabled: false } }));
  assert.match(textOf(desligado), new RegExp(COPY.console.assistenteDesligado));
  assert.doesNotMatch(desligado, /role="switch"/, "sem Assistente, sem Responder tudo");

  const vazio = textOf(painel(retrato({ attendants: [], queue: [] })));
  assert.match(vazio, new RegExp(COPY.console.ninguemAtendendo));
  assert.match(vazio, new RegExp(COPY.console.semPerguntas));

  const leitura = painel(retrato(), { canAct: false });
  assert.doesNotMatch(textOf(leitura), /Assumir|Devolver|Passar para|Pausar/);
  assert.doesNotMatch(leitura, />Responder</, "sem a caixa de resposta");
  assert.match(leitura, /role="switch"[^>]*disabled=""|disabled=""[^>]*role="switch"/);

  const encerrada = textOf(painel(retrato({ open: false })));
  assert.doesNotMatch(encerrada, /Pausar/, "sessao encerrada: sem Atender / Pausar");
});

test("painel Perguntas do console com as marcas: Respondida pelo Assistente, Pediu a equipe (com a caixa de resposta de volta) e com quem esta", () => {
  const q = (id, extra = {}) => ({ anonymous: false, answerText: null, answeredAt: null, answeredBy: null, answeredLive: false, body: `pergunta ${id}`, createdAt: new Date(NOW).toISOString(), displayName: "Ana S.", id, messageId: null, offsetMs: 0, sessionId: "s1", status: "open", upvotes: 0, userId: "u", ...extra });
  const markup = render(ConsoleQuestions, {
    busyKey: null,
    canAct: true,
    marks: {
      "q-ia": { answerSource: "ai", assignedName: null, assignedTo: null, handoffRequested: true },
      "q-bia": { answerSource: null, assignedName: "Bia A.", assignedTo: BIA, handoffRequested: false }
    },
    onAnswer: async () => true,
    onStatus: noop,
    questions: [q("q-ia", { answerText: "da IA", status: "answered" }), q("q-bia"), q("q-equipe", { answerText: "da equipe", status: "answered" })]
  });
  const bloco = (id) => markup.slice(markup.indexOf(`data-console-question="${id}"`), markup.indexOf("</li>", markup.indexOf(`data-console-question="${id}"`)));
  assert.match(textOf(bloco("q-ia")), /Respondida pelo Assistente Pediu a equipe/);
  assert.match(textOf(bloco("q-ia")), /Responder por escrito/, "o aluno pediu a equipe: a caixa volta");
  assert.match(textOf(bloco("q-bia")), /Com Bia A\./);
  assert.doesNotMatch(textOf(bloco("q-equipe")), /Responder por escrito|Assistente/);
  assert.doesNotMatch(render(ConsoleQuestions, { busyKey: null, canAct: true, onAnswer: async () => true, onStatus: noop, questions: [q("x")] }), /Pediu a equipe/, "sem marcas, como antes");
});

/* ------------------------------------------------------------------------------------------------
 * O card Assistente do editor
 * ---------------------------------------------------------------------------------------------- */

test("card Assistente: migracao pendente, ambiente desligado, sem conexao de IA e o formulario com as perguntas cadastradas", () => {
  const base = { canWrite: true, disabled: false, webinarId: "w1" };
  assert.match(textOf(render(AssistantCardBody, { ...base, data: { migration: "202610290006", pendingMigration: true } })), /migração 202610290006/);
  assert.equal(textOf(render(AssistantCardBody, { ...base, data: { aiAvailable: true, envEnabled: false, items: [], pendingMigration: false, settings: { enabled: false, replyAllDefault: false } } })), COPY.card.desligadoNoAmbiente);
  assert.equal(textOf(render(AssistantCardBody, { ...base, data: { aiAvailable: false, envEnabled: true, items: [], pendingMigration: false, settings: { enabled: false, replyAllDefault: false } } })), COPY.card.semIa);

  const item = { answer: "R$ 997.", createdAt: "", id: "k1", position: 0, question: "Quanto custa?", updatedAt: "", webinarId: "w1" };
  const form = render(AssistantCardBody, { ...base, data: { aiAvailable: true, envEnabled: true, items: [item], pendingMigration: false, settings: { enabled: true, replyAllDefault: false } } });
  const text = textOf(form);
  for (const label of [COPY.card.ligar, COPY.card.responderTudoPadrao, COPY.card.responderTudoDica, COPY.card.perguntasERespostas, COPY.card.adicionar, COPY.card.salvar, "1 de 100", "Pergunta 1"]) {
    assert.ok(text.includes(label), label);
  }
  assert.match(form, /value="Quanto custa\?"/);
  assert.match(form, />R\$ 997\.<\/textarea>/);
  assert.match(form, /role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/);

  const leitura = render(AssistantCardBody, { ...base, canWrite: false, data: { aiAvailable: true, envEnabled: true, items: [item], pendingMigration: false, settings: { enabled: true, replyAllDefault: false } } });
  assert.match(textOf(leitura), new RegExp(COPY.card.somenteLeitura));
  assert.ok(count(leitura, /disabled=""/g) >= 5, "quem so le ve tudo desligado");
});

test("o formulario do card: acrescentar ate o limite, tirar, o que vai para o salvar (sem linhas vazias) e os erros do zod por linha", () => {
  let form = editorModel.assistantFormOf({ enabled: false, replyAllDefault: true }, []);
  form = editorModel.addKnowledge(form);
  form = editorModel.addKnowledge(form);
  const [primeira, segunda] = form.items;
  form = editorModel.updateKnowledge(form, segunda.key, { answer: " Sim. ", question: " Tem certificado? " });
  assert.deepEqual(editorModel.assistantSaveInput(form, "w1"), {
    items: [{ answer: "Sim.", id: null, question: "Tem certificado?" }],
    settings: { enabled: false, replyAllDefault: true },
    webinarId: "w1"
  });
  assert.deepEqual(editorModel.knowledgeErrorsOf(form, { "items.0.question": ["curta"], settings: ["x"] }), { [segunda.key]: { question: "curta" } });
  assert.equal(editorModel.removeKnowledge(form, primeira.key).items.length, 1);
  const cheio = { ...form, items: Array.from({ length: 100 }, (_, index) => ({ answer: "a", id: null, key: `k${index}`, question: "qq" })) };
  assert.equal(editorModel.canAddKnowledge(cheio), false);
  assert.equal(editorModel.addKnowledge(cheio), cheio);
  assert.equal(editorModel.assistantCardNotice({ aiAvailable: true, envEnabled: false }), "env");
  assert.equal(editorModel.assistantCardNotice({ aiAvailable: false, envEnabled: true }), "ai");
  assert.equal(editorModel.assistantCardNotice({ aiAvailable: true, envEnabled: true }), null);
});

test("as frases dos arquivos novos vem de WEBINAR_COPY: nenhum texto com acento no codigo (so nas frases)", () => {
  const arquivos = [
    "src/components/member/webinars/room/assistant/assistant-handoff.tsx",
    "src/components/member/webinars/room/assistant/assistant-hint.tsx",
    "src/components/member/webinars/room/assistant/use-room-assistant.ts",
    "src/components/member/webinars/room/assistant/assistant-api.ts",
    "src/components/admin/v2/communication/webinars/assistant/attendance-panel.tsx",
    "src/components/admin/v2/communication/webinars/assistant/assistant-editor-form.tsx",
    "src/components/admin/v2/communication/webinars/assistant/assistant-editor-model.ts",
    "src/components/admin/v2/communication/webinars/assistant-card.tsx",
    "src/components/admin/v2/communication/webinars/session-console/console-attendance.tsx",
    "src/server/webinars/assistant.ts",
    "src/server/webinars/assistant-model.ts",
    "src/server/webinars/assistant-queries.ts",
    "src/server/webinars/assistant-actions.ts",
    "src/server/webinars/assistant-provider.ts",
    "src/app/api/webinars/[id]/assistant/route.ts",
    "src/app/api/webinars/[id]/handoff/route.ts"
  ];
  for (const arquivo of arquivos) {
    const fonte = readFileSync(new URL(`../${arquivo}`, import.meta.url), "utf8");
    assert.doesNotMatch(fonte, /[áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]/, `${arquivo}: frase com acento fora de webinar-copy`);
  }
});
