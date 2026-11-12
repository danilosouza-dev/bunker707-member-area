import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// "Marcar como vista" nas Perguntas do console (rodada v10, teste do produtor de 12/11/2026, a tarde; docs/30 D94;
// docs/18 §2.2), sem banco e sem navegador. Quando o aluno escreve no fio de uma pergunta ja respondida, o console
// mostra o selo "Nova resposta do aluno", sobe a pergunta e soma no numero da aba. Antes, o selo so saia com a equipe
// respondendo: "deveria ter alguma opção ali para eu tirar aquela notificação, para não ficar ali para sempre".
// - o modelo: com o fio marcado como visto depois da ultima fala do aluno, a pergunta deixa de pedir a equipe (o selo,
//   o lugar no quadro e o numero da aba); o aluno escrevendo de novo traz tudo de volta sozinho;
// - a linha do banco: a coluna nova e opcional (o banco sem a 202611160001 nao a tem) e o aluno nunca a recebe;
// - o pedido: so o id da pergunta;
// - a tela: o botao "Marcar como vista" so na pergunta com o selo e so para quem pode agir.
// A acao no banco em memoria fica em tests/webinarios-roteiro-acoes.test.mjs; no banco de verdade, em
// tests/integration/webinarios-v10.test.mjs.

const console_ = await import("../src/server/webinars/console-model.ts");
const consoleV2 = await import("../src/server/webinars/console-v2-model.ts");
const rows = await import("../src/server/webinars/chat-rows.ts");
const rules = await import("../src/server/webinars/room-rules.ts");
const schemas = await import("../src/server/webinars/chat-schemas.ts");
const consoleQuestions = await import("../src/components/admin/v2/communication/webinars/session-console/console-questions.tsx");
const { WEBINAR_ADMIN_COPY } = await import("../src/server/webinars/editor-model.ts");

const COPY = WEBINAR_ADMIN_COPY.console.questions;
const render = (component, props) => renderToStaticMarkup(createElement(component, props)).replace(/<link rel="preload" as="image"[^>]*\/>/g, "");
const textOf = (markup) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const ALUNA = "00000000-0000-4000-8000-0000000000a1";
const EQUIPE = "00000000-0000-4000-8000-0000000000e1";
const QUESTION = "11111111-1111-4111-8111-111111111111";
const T0 = Date.parse("2026-11-12T20:00:00.000Z");
const em = (minute) => new Date(T0 + minute * 60_000).toISOString();
const doAluno = (minute, id = `a${minute}`) => ({ anonymous: false, authorAs: null, body: "E no app?", createdAt: em(minute), displayName: "Ana M.", id, questionId: QUESTION, role: "student", sessionId: "s", userId: ALUNA });
const daEquipe = (minute, id = `e${minute}`) => ({ anonymous: false, authorAs: null, body: "Tambem.", createdAt: em(minute), displayName: "Danilo S.", id, questionId: QUESTION, role: "host", sessionId: "s", userId: EQUIPE });
const pergunta = (extra = {}) => ({
  anonymous: false,
  answerAuthor: null,
  answerText: "Pode",
  answeredAt: em(1),
  answeredBy: EQUIPE,
  answeredLive: false,
  body: "Posso fazer?",
  createdAt: em(0),
  displayName: "Ana M.",
  id: QUESTION,
  messageId: null,
  offsetMs: 0,
  replies: [],
  sessionId: "s",
  simulated: false,
  status: "answered",
  threadSeenAt: null,
  upvotes: 0,
  userId: ALUNA,
  ...extra
});

test("o modelo: marcada como vista depois da ultima fala do aluno, a pergunta deixa de pedir a equipe; o aluno escrevendo de novo traz o aviso de volta", () => {
  const espera = pergunta({ replies: [doAluno(2)] });
  assert.equal(console_.questionAwaitsTeam(espera), true, "o aluno escreveu por ultimo");
  assert.equal(console_.questionAwaitsTeam({ ...espera, threadSeenAt: em(3) }), false, "a equipe marcou como vista depois");
  assert.equal(console_.questionAwaitsTeam({ ...espera, threadSeenAt: em(2) }), false, "no mesmo instante da resposta tambem vale");
  assert.equal(console_.questionAwaitsTeam({ ...espera, threadSeenAt: em(1) }), true, "a marca de antes da ultima fala nao vale");
  assert.equal(console_.questionAwaitsTeam({ ...espera, replies: [doAluno(2), doAluno(5)], threadSeenAt: em(3) }), true, "o aluno escreveu de novo: o aviso volta sozinho");
  assert.equal(console_.questionAwaitsTeam({ ...espera, replies: [doAluno(2), doAluno(5)], threadSeenAt: em(6) }), false, "e sai de novo com outra marca");
  // Sem a coluna (o banco sem a migracao, ou uma pergunta nunca marcada), como sempre.
  assert.equal(console_.questionAwaitsTeam({ ...espera, threadSeenAt: undefined }), true);
  assert.equal(console_.questionAwaitsTeam({ ...espera, threadSeenAt: null }), true);
  assert.equal(console_.questionAwaitsTeam({ ...espera, threadSeenAt: "nao e data" }), true, "uma hora que nao se le nunca tira o aviso");
  // A marca nao mexe no que ja nao pedia a equipe.
  assert.equal(console_.questionAwaitsTeam({ ...espera, replies: [doAluno(2), daEquipe(3)], threadSeenAt: em(1) }), false);
  assert.equal(console_.questionAwaitsTeam({ ...espera, status: "open", threadSeenAt: em(9) }), false);
  // A hora do app (milissegundos) contra a do banco (microssegundos, +00:00): compara o instante, nunca o texto.
  assert.equal(console_.questionAwaitsTeam({ ...espera, replies: [{ ...doAluno(2), createdAt: "2026-11-12T20:02:00.000123+00:00" }], threadSeenAt: "2026-11-12T20:02:00.001Z" }), false);
});

test("o quadro e o numero da aba: a marcada como vista desce para junto das respondidas e sai da conta; a que o aluno respondeu de novo volta ao topo e a conta", () => {
  const question = (id, extra = {}) => pergunta({ id, ...extra });
  const lista = [
    question("respondida", { createdAt: em(1), upvotes: 9 }),
    question("vista", { createdAt: em(2), replies: [doAluno(4)], threadSeenAt: em(5), upvotes: 5 }),
    question("esperando", { createdAt: em(3), replies: [doAluno(4)], upvotes: 1 }),
    question("de-novo", { createdAt: em(4), replies: [doAluno(4), doAluno(8)], threadSeenAt: em(5), upvotes: 0 }),
    question("aberta", { answerText: null, answeredAt: null, createdAt: em(5), status: "open", upvotes: 2 })
  ];
  assert.deepEqual(
    console_.sortQuestionsForBoard(lista).map((entry) => entry.id),
    ["aberta", "esperando", "de-novo", "respondida", "vista"],
    "o que pede a equipe primeiro (por votos); a vista entre as respondidas"
  );
  assert.deepEqual(consoleV2.consoleTabCounts({ hands: 0, questions: lista }), { maos: 0, perguntas: 3 }, "a aberta e as duas que esperam; a vista nao conta");
  assert.equal(consoleV2.consoleTabCounts({ hands: 0, questions: lista.map((entry) => ({ ...entry, threadSeenAt: null })) }).perguntas, 4, "sem a marca, a vista contaria");
});

test("a linha do banco: a coluna e opcional (o banco sem a 202611160001 nao a tem) e so entra na lista nova; o aluno nunca recebe a marca", () => {
  const linha = { anonymous: false, answer_text: "Pode", answered_at: em(1), answered_by: EQUIPE, answered_live: false, body: "Posso?", created_at: em(0), display_name: "Ana M.", id: QUESTION, message_id: null, offset_ms: 0, session_id: "s", status: "answered", upvotes: 0, user_id: ALUNA };
  assert.equal(rows.questionFromRow(linha).threadSeenAt, null, "sem a coluna: nunca marcada");
  assert.equal(rows.questionFromRow({ ...linha, thread_seen_at: null }).threadSeenAt, null);
  assert.equal(rows.questionFromRow({ ...linha, thread_seen_at: em(3) }).threadSeenAt, em(3));
  assert.equal(rows.QUESTION_COLUMNS_V10, `${rows.QUESTION_COLUMNS_V9}, thread_seen_at`);
  assert.ok(!rows.QUESTION_COLUMNS.includes("thread_seen") && !rows.QUESTION_COLUMNS_V9.includes("thread_seen"), "as listas de antes nao mudam");
  assert.ok(!rows.QUESTION_COLUMNS_V10.includes("thread_seen_by"), "quem marcou so e gravado");
  // O que a sala entrega ao aluno nao leva a marca da equipe (nem para quem perguntou).
  const paraAluno = rules.toStudentQuestion(rows.questionFromRow({ ...linha, thread_seen_at: em(3) }), ALUNA, false, null, []);
  assert.ok(!Object.keys(paraAluno).some((key) => /seen/i.test(key)), Object.keys(paraAluno).join(", "));
});

test("o pedido do console: so o id da pergunta, um uuid", () => {
  assert.deepEqual(schemas.markQuestionSeenSchema.parse({ questionId: QUESTION }), { questionId: QUESTION });
  assert.equal(schemas.markQuestionSeenSchema.safeParse({ questionId: "abc" }).success, false);
  assert.equal(schemas.markQuestionSeenSchema.safeParse({}).success, false);
  assert.deepEqual(Object.keys(schemas.markQuestionSeenSchema.parse({ questionId: QUESTION, seenAt: em(9), seenBy: ALUNA })), ["questionId"], "a hora e quem marcou sao do servidor");
});

const painel = (extra = {}) =>
  render(consoleQuestions.ConsoleQuestions, {
    author: { as: "self", name: null },
    busyKey: null,
    canAct: true,
    currentUserName: "Danilo S.",
    onAnswer: async () => true,
    onAuthor: () => undefined,
    onReply: async () => true,
    onSeen: () => undefined,
    onStatus: () => undefined,
    questions: [pergunta({ replies: [doAluno(2)] })],
    ...extra
  });
const cartao = (html, id = QUESTION) => {
  const from = html.indexOf(`data-console-question="${id}"`);
  const next = html.indexOf("data-console-question=\"", from + 1);
  return html.slice(from, next === -1 ? undefined : next);
};

test("a tela: 'Marcar como vista' so na pergunta com o selo 'Nova resposta do aluno', entre o Responder e o Reabrir; marcada, o selo e o botao saem; sem poder agir, nada", () => {
  assert.deepEqual([COPY.markSeen, COPY.newReply, COPY.markedSeen], ["Marcar como vista", "Nova resposta do aluno", "Marcada como vista."]);
  assert.equal(COPY.markSeenHint, "Tira o aviso de nova resposta desta pergunta. Ele volta se o aluno escrever de novo.");

  const espera = cartao(painel());
  assert.match(espera, /^data-console-question="[^"]+" data-question-awaits-team=""/);
  assert.ok(textOf(`<x ${espera}`).includes("Nova resposta do aluno"));
  const botao = espera.match(/<button class="[^"]*" data-console-question-seen="" title="([^"]*)" type="button">Marcar como vista<\/button>/);
  assert.ok(botao, "o botao com a dica");
  assert.equal(botao[1], COPY.markSeenHint);
  const ordem = ["data-console-reply-open", "data-console-question-seen", `>${COPY.reopen}<`].map((marca) => espera.indexOf(marca));
  assert.ok(ordem.every((lugar) => lugar > 0) && ordem[0] < ordem[1] && ordem[1] < ordem[2], `Responder, Marcar como vista, Reabrir: ${ordem.join(", ")}`);

  // Marcada como vista: o selo, o lugar no topo e o botao saem; o Responder e o Reabrir continuam.
  const vista = cartao(painel({ questions: [pergunta({ replies: [doAluno(2)], threadSeenAt: em(3) })] }));
  assert.doesNotMatch(vista, /data-question-awaits-team|data-console-question-seen/);
  assert.ok(!textOf(`<x ${vista}`).includes("Nova resposta do aluno"));
  assert.match(vista, /data-console-reply-open=""/);
  assert.ok(textOf(`<x ${vista}`).includes(COPY.reopen));

  // O aluno escreveu de novo depois da marca: o selo e o botao voltam.
  const deNovo = cartao(painel({ questions: [pergunta({ replies: [doAluno(2), doAluno(6)], threadSeenAt: em(3) })] }));
  assert.match(deNovo, /data-question-awaits-team=""/);
  assert.match(deNovo, /data-console-question-seen=""/);

  // So onde ha o que tirar: a respondida sem fala nova do aluno, a aberta e a dispensada nao tem o botao.
  for (const [nome, question] of [
    ["a equipe respondeu por ultimo", pergunta({ replies: [doAluno(2), daEquipe(3)] })],
    ["sem fio", pergunta()],
    ["aberta", pergunta({ answerText: null, answeredAt: null, status: "open" })],
    ["dispensada", pergunta({ answerText: null, answeredAt: null, replies: [doAluno(2)], status: "dismissed" })]
  ]) {
    assert.doesNotMatch(painel({ questions: [question] }), /data-console-question-seen/, nome);
  }
  // Sem poder agir (a Equipe sem a permissao, a sessao encerrada) ou sem a acao (uma tela de antes), sem o botao; o
  // selo continua, porque e informacao.
  for (const extra of [{ canAct: false }, { onSeen: null }, { onSeen: undefined }]) {
    const html = painel(extra);
    assert.doesNotMatch(html, /data-console-question-seen/, JSON.stringify(Object.keys(extra)));
    assert.ok(textOf(html).includes("Nova resposta do aluno"));
  }
  // Ocupada (a acao em curso nesta pergunta), o botao desliga.
  assert.match(cartao(painel({ busyKey: `question:${QUESTION}` })), /<button class="[^"]*" data-console-question-seen="" disabled=""/);
});

test("o console liga o botao a acao pelo run (a mesma chave ocupada das outras acoes da pergunta) e avisa 'Marcada como vista.'", async () => {
  const { readFileSync } = await import("node:fs");
  const tela = readFileSync(new URL("../src/components/admin/v2/communication/webinars/session-console/session-console.tsx", import.meta.url), "utf8");
  assert.match(
    tela,
    /onSeen=\{canAct \? \(questionId: string\) => void run\(`question:\$\{questionId\}`, \(\) => markQuestionSeen\(\{ questionId \}\), \(\) => adminToast\.success\(WEBINAR_ADMIN_COPY\.console\.questions\.markedSeen\)\) : null\}/
  );
  // O clique do botao manda o id da pergunta dele.
  const lista = readFileSync(new URL("../src/components/admin/v2/communication/webinars/session-console/console-questions.tsx", import.meta.url), "utf8");
  assert.match(lista, /data-console-question-seen=""\s*disabled=\{busy\}\s*onClick=\{\(\) => onSeen\(question\.id\)\}/);
  // A acao passa pelo runWebinarAction com a permissao de quem atende (nunca runAdminAction direto).
  const acoes = readFileSync(new URL("../src/server/webinars/room-actions.ts", import.meta.url), "utf8");
  const corpo = acoes.slice(acoes.indexOf("export async function markQuestionSeen("), acoes.indexOf("export async function markQuestionSeen(") + 1600);
  assert.match(corpo, /return runWebinarAction\("messaging\.write", "atendimento", markQuestionSeenSchema, input,/);
  assert.doesNotMatch(corpo, /runAdminAction/);
});
