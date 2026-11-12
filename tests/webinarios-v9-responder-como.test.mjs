import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// "Responder como" (rodada v9, P8; docs/30 D87; docs/18 §2.2), no Node e sem navegador. O produtor (12/11/2026):
// "Quando respondo uma pergunta so aparece que quem respondeu foi a equipe, mas nao tem como aparecer tambem o nome da
// pessoa que respondeu? ... seria bom ter a opcao de escolher se responde como a pessoa mesmo ou como equipe ou ate
// mesmo colocar um nome especifico como 'Equipe Bunker 707'". Aqui: a regra pura (as tres opcoes, o nome personalizado,
// o que e gravado e o que e lido), o que a turma recebe (o nome e a foto de quem escreveu nunca saem com Equipe nem com
// Outro nome), a aba Perguntas da sala desenhada em cada opcao, a escolha guardada no navegador e o painel do console
// (o seletor, o campo do nome e a resposta assinada). As acoes do servidor ficam em webinarios-roteiro-acoes e, com o
// banco de verdade, em tests/integration/webinarios-v9.

const author = await import("../src/server/webinars/answer-author-model.ts");
const rules = await import("../src/server/webinars/room-rules.ts");
const rows = await import("../src/server/webinars/chat-rows.ts");
const schemas = await import("../src/server/webinars/chat-schemas.ts");
const prefs = await import("../src/components/member/webinars/room/use-room-prefs.ts");
const questionsModule = await import("../src/components/member/webinars/room/room-questions.tsx");
const consoleQuestions = await import("../src/components/admin/v2/communication/webinars/session-console/console-questions.tsx");
const { WEBINAR_ADMIN_COPY } = await import("../src/server/webinars/editor-model.ts");

const COPY = WEBINAR_ADMIN_COPY.console.questions;
const render = (component, props) => renderToStaticMarkup(createElement(component, props)).replace(/<link rel="preload" as="image"[^>]*\/>/g, "");
const textOf = (markup) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const FOTO = "https://projeto.supabase.co/storage/v1/object/public/avatars/00000000-0000-4000-8000-0000000000aa/foto.webp";
const ALUNA = "00000000-0000-4000-8000-0000000000a1";
const EQUIPE = "00000000-0000-4000-8000-0000000000e1";
const QUESTION = "11111111-1111-4111-8111-111111111111";

test("as tres opcoes: Meu nome grava o nome de quem responde e o papel; Equipe, nenhum nome; Outro nome, o nome escrito e limpo (2 a 40 caracteres)", () => {
  assert.deepEqual([...author.ANSWER_AUTHOR_MODES], ["self", "team", "custom"]);
  assert.deepEqual(author.ANSWER_AUTHOR_DEFAULT, { as: "self", name: null }, "o padrao do seletor: o nome de quem responde");
  assert.deepEqual(author.ANSWER_AUTHOR_LIMITS, { nameMax: 40, nameMin: 2 });
  const de = (choice, role = "host") => author.answerAuthorOf({ choice, displayName: "Danilo S.", role });
  assert.deepEqual(de({ as: "self" }), { as: "self", name: "Danilo S.", role: "host" });
  assert.deepEqual(de({ as: "self", name: "outro nome" }), { as: "self", name: "Danilo S.", role: "host" }, "em Meu nome, o nome mandado pelo navegador nunca vale");
  assert.deepEqual(de({ as: "team" }, "co_host"), { as: "team", name: null, role: "co_host" });
  assert.deepEqual(de({ as: "custom", name: "  Equipe   Bunker 707 " }, "team"), { as: "custom", name: "Equipe Bunker 707", role: "team" });
  assert.equal(de({ as: "custom", name: "A" }), null, "curto demais");
  assert.equal(de({ as: "custom", name: "x".repeat(41) }), null, "longo demais");
  assert.equal(de({ as: "custom" }), null);
  assert.equal(de({ as: "self" }, "student").role, "team", "um papel que nao e da equipe nunca assina como Apresentador");
  assert.equal(author.answerAuthorCustomName("Equipe Bunker 707"), "Equipe Bunker 707");
  assert.equal(author.ANSWER_AUTHOR_MIGRATION, "202611150001");
});

test("o que fica no banco e o que e lido: a versao 1; a coluna vazia, de outra forma ou sem nome vira 'sem assinatura' (a sala mostra Equipe)", () => {
  const gravado = author.answerAuthorToRow({ as: "self", name: "Danilo S.", role: "host" });
  assert.deepEqual(gravado, { as: "self", name: "Danilo S.", role: "host", v: 1 });
  assert.deepEqual(author.parseAnswerAuthor(gravado), { as: "self", name: "Danilo S.", role: "host" });
  assert.deepEqual(author.parseAnswerAuthor({ as: "team", name: "ignorado", role: "co_host", v: 1 }), { as: "team", name: null, role: "co_host" });
  for (const ruim of [null, undefined, "self", [], { as: "self", name: "X", role: "host" }, { as: "self", name: "X", role: "host", v: 2 }, { as: "dono", name: "X", v: 1 }, { as: "custom", name: "  ", v: 1 }, { as: "self", v: 1 }]) {
    assert.equal(author.parseAnswerAuthor(ruim), null, JSON.stringify(ruim));
  }
  assert.equal(author.parseAnswerAuthor({ as: "self", name: "X", role: "aluno", v: 1 }).role, "team", "um papel desconhecido vira Equipe");
  // As linhas: a coluna nova e opcional (o banco sem a 202611150001 nao a tem) e nunca entra nas listas de sempre.
  assert.doesNotMatch(rows.QUESTION_COLUMNS, /answer_author/);
  assert.doesNotMatch(rows.QUESTION_REPLY_COLUMNS, /author_as/);
  assert.equal(rows.QUESTION_COLUMNS_V9, `${rows.QUESTION_COLUMNS}, answer_author`);
  assert.equal(rows.QUESTION_REPLY_COLUMNS_V9, `${rows.QUESTION_REPLY_COLUMNS}, author_as`);
  const linha = { anonymous: false, answer_text: "Pode", answered_at: null, answered_by: EQUIPE, answered_live: false, body: "Posso?", created_at: "2026-11-12T20:00:00.000Z", deleted_at: null, deleted_reason: null, display_name: "Ana M.", id: QUESTION, message_id: null, offset_ms: 0, session_id: "s", status: "answered", updated_at: "2026-11-12T20:00:00.000Z", upvotes: 0, user_id: ALUNA };
  assert.equal(rows.questionFromRow(linha).answerAuthor, null, "sem a coluna: sem assinatura");
  assert.deepEqual(rows.questionFromRow({ ...linha, answer_author: gravado }).answerAuthor, { as: "self", name: "Danilo S.", role: "host" });
  const resposta = { anonymous: false, body: "Sim", created_at: "2026-11-12T20:01:00.000Z", deleted_at: null, deleted_by: null, deleted_reason: null, display_name: "Danilo S.", id: "r1", question_id: QUESTION, role: "host", session_id: "s", user_id: EQUIPE };
  assert.equal(rows.questionReplyFromRow(resposta).authorAs, null);
  assert.equal(rows.questionReplyFromRow({ ...resposta, author_as: "team" }).authorAs, "team");
  assert.equal(rows.questionReplyFromRow({ ...resposta, author_as: "dono" }).authorAs, null, "um valor desconhecido: como antes");
});

test("o pedido do console: a escolha e opcional (a pagina de antes); Outro nome sem um nome valido e erro no campo", () => {
  const responder = (extra) => schemas.answerQuestionSchema.safeParse({ answerText: "Pode", questionId: QUESTION, ...extra });
  assert.equal(responder({}).success, true);
  assert.equal(responder({}).data.author, undefined, "sem a escolha, quem chama usa o padrao de sempre");
  assert.deepEqual(responder({ author: { as: "custom", name: " Equipe Bunker 707 " } }).data.author, { as: "custom", name: "Equipe Bunker 707" });
  assert.equal(responder({ author: { as: "self" } }).success, true);
  const semNome = responder({ author: { as: "custom", name: "A" } });
  assert.equal(semNome.success, false);
  assert.equal(semNome.error.issues[0].message, schemas.CHAT_MESSAGES.authorName);
  assert.equal(schemas.CHAT_MESSAGES.authorName, "Escreva o nome que aparece na resposta (de 2 a 40 caracteres).");
  assert.equal(responder({ author: { as: "todos" } }).success, false);
  assert.equal(schemas.replyQuestionSchema.safeParse({ author: { as: "team" }, body: "Sim", questionId: QUESTION }).success, true);
  assert.equal(schemas.replyQuestionSchema.safeParse({ author: { as: "custom", name: "" }, body: "Sim", questionId: QUESTION }).success, false);
});

const pergunta = (extra = {}) => ({
  anonymous: false,
  answerAuthor: null,
  answerText: "Pode",
  answeredAt: "2026-11-12T20:02:00.000Z",
  answeredBy: EQUIPE,
  answeredLive: false,
  body: "Posso fazer?",
  createdAt: "2026-11-12T20:00:00.000Z",
  displayName: "Ana M.",
  id: QUESTION,
  messageId: null,
  offsetMs: 0,
  sessionId: "s",
  simulated: false,
  status: "answered",
  upvotes: 0,
  userId: ALUNA,
  ...extra
});
const resposta = (extra = {}) => ({ anonymous: false, authorAs: null, body: "E pode sim.", createdAt: "2026-11-12T20:03:00.000Z", displayName: "Danilo S.", id: "r1", questionId: QUESTION, role: "host", sessionId: "s", userId: EQUIPE, ...extra });

test("o que a turma recebe: com Meu nome, o nome, o papel e a foto; com Outro nome, so o nome; com Equipe (e a resposta de antes), nada de quem escreveu", () => {
  const aluno = (question, foto = FOTO) => rules.toStudentQuestion(question, ALUNA, false, null, [], foto);
  assert.deepEqual(aluno(pergunta({ answerAuthor: { as: "self", name: "Danilo S.", role: "host" } })).answerAuthor, { as: "self", avatarUrl: FOTO, name: "Danilo S.", role: "host" });
  assert.deepEqual(aluno(pergunta({ answerAuthor: { as: "custom", name: "Equipe Bunker 707", role: "host" } })).answerAuthor, { as: "custom", avatarUrl: null, name: "Equipe Bunker 707", role: null }, "sem a foto e sem o papel de quem escreveu");
  assert.equal(aluno(pergunta({ answerAuthor: { as: "team", name: null, role: "host" } })).answerAuthor, null);
  assert.equal(aluno(pergunta()).answerAuthor, null, "a resposta de antes da rodada v9");
  assert.equal(aluno(pergunta({ answerAuthor: { as: "self", name: "Danilo S.", role: "host" }, answerText: null })).answerAuthor, null, "respondida so ao vivo: nao ha resposta escrita para assinar");

  // O fio: a resposta da equipe com Equipe ou Outro nome nunca leva o nome nem a foto de quem escreveu.
  const comoSempre = rules.toStudentReply(resposta(), ALUNA, FOTO);
  assert.deepEqual([comoSempre.displayName, comoSempre.avatarUrl, "authorAs" in comoSempre], ["Danilo S.", FOTO, false], "sem a escolha, o HTML de antes");
  assert.deepEqual(rules.toStudentReply(resposta({ authorAs: "self" }), ALUNA, FOTO).avatarUrl, FOTO);
  const comoEquipe = rules.toStudentReply(resposta({ authorAs: "team" }), EQUIPE, FOTO);
  assert.deepEqual([comoEquipe.authorAs, comoEquipe.displayName, comoEquipe.avatarUrl, comoEquipe.mine], ["team", "", null, false]);
  assert.doesNotMatch(JSON.stringify(comoEquipe), /Danilo|foto\.webp/, "nada de quem escreveu sai do servidor");
  const outroNome = rules.toStudentReply(resposta({ authorAs: "custom", displayName: "Equipe Bunker 707" }), ALUNA, FOTO);
  assert.deepEqual([outroNome.authorAs, outroNome.displayName, outroNome.avatarUrl], ["custom", "Equipe Bunker 707", null]);
  // A resposta do aluno nunca muda, mesmo com a coluna preenchida por engano.
  const doAluno = rules.toStudentReply(resposta({ authorAs: "team", displayName: "Ana M.", role: "student", userId: ALUNA }), ALUNA, FOTO);
  assert.deepEqual([doAluno.displayName, doAluno.avatarUrl, doAluno.mine, "authorAs" in doAluno], ["Ana M.", FOTO, true, false]);
});

const naSala = (question) =>
  render(questionsModule.RoomQuestionItem, { look: "comment", onVote: () => undefined, question: { ...question, avatarUrl: null, canReply: false, mine: false, replies: question.replies ?? [], voted: false }, serverNowMs: Date.parse("2026-11-12T20:05:00.000Z"), threadOpen: true });
const doAluno = (answerAuthor, replies = []) => ({ ...rules.toStudentQuestion(pergunta({ answerAuthor }), "outro", false, null, replies, FOTO) });

test("a aba Perguntas da sala: a resposta assinada com Meu nome mostra a foto, o nome e o selo do papel; Outro nome, o nome com o icone da equipe; Equipe, so o selo, como antes", () => {
  const resp = (html) => html.slice(html.indexOf("data-room-answer"));
  const comNome = resp(naSala(doAluno({ as: "self", name: "Danilo S.", role: "host" })));
  assert.match(comNome, /<img alt=""[^>]*src="[^"]*foto\.webp[^"]*"/, "a foto de quem respondeu");
  assert.match(textOf(comNome), /> Danilo S\. Apresentador há 3 minutos /, "o nome e o selo do papel");
  assert.match(comNome, /<span class="sr-only">Danilo S\., Apresentador[^<]*<\/span>/, "o leitor de tela ouve quem respondeu");

  const outro = resp(naSala(doAluno({ as: "custom", name: "Equipe Bunker 707", role: "host" })));
  assert.doesNotMatch(outro, /<img /, "sem foto");
  assert.match(outro, /lucide-users-round/, "o icone da equipe");
  assert.match(textOf(outro), /Equipe Bunker 707/);
  assert.doesNotMatch(textOf(outro), /Apresentador|Danilo/, "nem o papel nem o nome de quem escreveu");

  const equipe = resp(naSala(doAluno({ as: "team", name: null, role: "host" })));
  assert.equal(equipe, resp(naSala(doAluno(null))), "Equipe e a resposta de antes desenham o mesmo");
  assert.match(textOf(equipe), /> Equipe há 3 minutos Equipe, há 3 minutos: Pode/, "so o selo Equipe");
  assert.doesNotMatch(equipe, /<img /);

  // O fio: a resposta com Equipe mostra so o selo; com Outro nome, o nome.
  const fio = naSala(doAluno(null, [rules.toStudentReply(resposta({ authorAs: "team" }), "outro", FOTO), rules.toStudentReply(resposta({ authorAs: "custom", displayName: "Equipe Bunker 707", id: "r2" }), "outro", FOTO), rules.toStudentReply(resposta({ id: "r3" }), "outro", FOTO)]));
  const [, r1, r2, r3] = fio.split("data-room-reply=");
  assert.doesNotMatch(r1, /Danilo|<img /);
  assert.match(textOf(`<x ${r1}`), /Equipe/);
  assert.match(textOf(`<x ${r2}`), /Equipe Bunker 707/);
  assert.doesNotMatch(r2, /Danilo|<img |Apresentador/);
  assert.match(r3, /foto\.webp/, "sem a escolha, a foto e o nome de quem escreveu, como sempre");
  assert.match(textOf(`<x ${r3}`), /Danilo S\. Apresentador/);
});

test("a escolha lembrada no navegador: o que nao e uma escolha valida volta ao padrao (Meu nome)", () => {
  assert.deepEqual(prefs.storedAnswerAuthor(null), { as: "self", name: null });
  assert.deepEqual(prefs.storedAnswerAuthor("nao e json"), { as: "self", name: null });
  assert.deepEqual(prefs.storedAnswerAuthor(JSON.stringify({ as: "team", name: null })), { as: "team", name: null });
  assert.deepEqual(prefs.storedAnswerAuthor(JSON.stringify({ as: "custom", name: "Equipe Bunker 707" })), { as: "custom", name: "Equipe Bunker 707" });
  assert.deepEqual(prefs.storedAnswerAuthor(JSON.stringify({ as: "dono" })), { as: "self", name: null });
  assert.equal(author.ANSWER_AUTHOR_STORAGE_KEY, "bunker707:webinar-console-responder-como");
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
    onStatus: () => undefined,
    questions: [pergunta({ answerText: null, answeredAt: null, answeredBy: null, status: "open" })],
    ...extra
  });

test("o console: 'Responder como' no alto das Perguntas com as tres opcoes; Outro nome abre o campo do nome e, sem um nome valido, as respostas ficam desligadas; sem poder agir ou sem a escolha, nada", () => {
  const html = painel();
  assert.match(html, /data-console-answer-author="self"/);
  assert.match(textOf(html), new RegExp(`^${COPY.authorAs} ${COPY.authorAs} Meu nome \\(Danilo S\\.\\) Equipe Outro nome ${COPY.authorHints.self.replace(/[.]/g, "\\.")}`));
  assert.match(html, /<option[^>]*value="self"[^>]*selected=""/);
  assert.doesNotMatch(html, /data-console-answer-author-name/, "o campo do nome so com Outro nome");
  assert.ok(html.indexOf("data-console-answer-author") < html.indexOf("data-console-questions="), "antes da lista");

  const semNome = painel({ author: { as: "custom", name: "" }, questions: [pergunta({ answerText: null, answeredAt: null, answeredBy: null, status: "open" }), pergunta({ id: "22222222-2222-4222-8222-222222222222" })] });
  assert.match(semNome, /<input[^>]*aria-invalid="true"[^>]*data-console-answer-author-name=""[^>]*maxLength="40"[^>]*placeholder="Equipe Bunker 707"/);
  assert.match(textOf(semNome), /Escreva o nome que aparece na resposta \(de 2 a 40 caracteres\) para responder\./);
  assert.deepEqual(consoleQuestions.answerAuthorReady({ as: "custom", name: "" }), null);
  assert.deepEqual(consoleQuestions.answerAuthorReady({ as: "custom", name: " Equipe  Bunker 707 " }), { as: "custom", name: "Equipe Bunker 707" });
  assert.deepEqual(consoleQuestions.answerAuthorReady({ as: "team", name: "sobra" }), { as: "team", name: null });

  const comNome = painel({ author: { as: "custom", name: "Equipe Bunker 707" } });
  assert.match(comNome, /value="Equipe Bunker 707"/);
  assert.doesNotMatch(comNome, /aria-invalid/);
  assert.match(textOf(comNome), new RegExp(COPY.authorHints.custom.replace(/[.]/g, "\\.")));

  assert.doesNotMatch(painel({ canAct: false }), /data-console-answer-author=/, "sem poder agir, sem o seletor");
  assert.doesNotMatch(painel({ author: null, onAuthor: null }), /data-console-answer-author=/, "quem nao passa a escolha fica como antes");
});

test("o console mostra a resposta como a turma ve: Meu nome com a foto, o nome e o selo; Outro nome so com o nome; Equipe (e a de antes) so com o icone; o fio do mesmo jeito", () => {
  const de = (question) => {
    const html = painel({ questions: [question] });
    return html.slice(html.indexOf("data-console-answer="), html.indexOf("data-console-reply-open") > 0 ? html.indexOf("data-console-reply-open") : undefined);
  };
  const comNome = de(pergunta({ answerAuthor: { as: "self", name: "Danilo S.", role: "co_host" }, answerAuthorAvatarUrl: FOTO }));
  assert.match(comNome, /data-console-answer-as="self"/);
  assert.match(comNome, /foto\.webp/);
  assert.match(textOf(`<x ${comNome}`), /Danilo S\. Co-apresentador Pode/);
  const outro = de(pergunta({ answerAuthor: { as: "custom", name: "Equipe Bunker 707", role: "host" } }));
  assert.match(outro, /data-console-answer-as="custom"/);
  assert.match(textOf(`<x ${outro}`), /Equipe Bunker 707 Pode/);
  assert.doesNotMatch(outro, /<img |Apresentador/);
  const equipe = de(pergunta({ answerAuthor: { as: "team", name: null, role: "host" } }));
  assert.match(equipe, /data-console-answer-as="team"/);
  assert.match(de(pergunta()), /data-console-answer-as="team"/, "a resposta de antes: Equipe");
  assert.doesNotMatch(equipe, /<img /);
  // O fio.
  const fio = painel({ questions: [pergunta({ replies: [resposta({ authorAs: "team", avatarUrl: null }), resposta({ authorAs: "custom", avatarUrl: null, displayName: "Equipe Bunker 707", id: "r2" }), resposta({ avatarUrl: FOTO, id: "r3" })] })] });
  const [, r1, r2, r3] = fio.split("data-console-reply=");
  assert.match(r1, /^"r1" data-reply-author-as="team"/);
  assert.match(textOf(`<x ${r1.slice(0, r1.indexOf("</li>"))}`), /Equipe E pode sim\./);
  assert.doesNotMatch(r1.slice(0, r1.indexOf("</li>")), /Danilo|<img /);
  assert.match(textOf(`<x ${r2.slice(0, r2.indexOf("</li>"))}`), /Equipe Bunker 707 E pode sim\./);
  assert.match(textOf(`<x ${r3.slice(0, r3.indexOf("</li>"))}`), /Danilo S\. Apresentador E pode sim\./);
  assert.match(r3, /foto\.webp/);
});
