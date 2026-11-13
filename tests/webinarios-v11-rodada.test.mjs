import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A rodada v11 dos webinarios (terceiro teste do produtor de 12/11/2026; docs/30 D98 a D102; docs/31 §16; docs/18 §2.2),
// sem banco e sem navegador:
// - curtir a resposta escrita e cada resposta do fio (D101): a contagem por alvo com a curtida de quem le, o toque que
//   muda a tela na hora, o pedido do aluno e o da equipe, o polegar na sala e no console;
// - o aviso de resposta nova nas perguntas do aluno (D100): o que conta como fala da equipe, quantas ele ainda nao viu,
//   quando a sala rele por conta propria, o numero no item Perguntas do trilho e o ponto na aba;
// - a mao levantada no palco do console com o desenho da area (D99): as maos que subiram desde a ultima leitura, o selo
//   do palco e a frase do aviso; a fila com a frase da ordem e o selo Proximo;
// - a opcao de nao mostrar aos alunos quantas pessoas estao na sala (D102): ligada por padrao, lida do webinario antigo,
//   aceita no rascunho de antes, e a sala sem numero em lugar nenhum.
// As acoes no banco em memoria ficam em tests/webinarios-roteiro-acoes.test.mjs; no banco de verdade, em
// tests/integration/webinarios-v11.test.mjs.

const likes = await import("../src/server/webinars/question-likes-model.ts");
const rules = await import("../src/server/webinars/room-rules.ts");
const schemas = await import("../src/server/webinars/chat-schemas.ts");
const news = await import("../src/components/member/webinars/room/room-question-news-model.ts");
const consoleV2 = await import("../src/server/webinars/console-v2-model.ts");
const model = await import("../src/server/webinars/model.ts");
const rows = await import("../src/server/webinars/rows.ts");
const webinarSchemas = await import("../src/server/webinars/schemas.ts");
const questionsModule = await import("../src/components/member/webinars/room/room-questions.tsx");
const railModule = await import("../src/components/member/webinars/room/room-rail.tsx");
const consoleQuestions = await import("../src/components/admin/v2/communication/webinars/session-console/console-questions.tsx");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const { WEBINAR_ADMIN_COPY } = await import("../src/server/webinars/editor-model.ts");

const render = (component, props) => renderToStaticMarkup(createElement(component, props)).replace(/<link rel="preload" as="image"[^>]*\/>/g, "");
const textOf = (markup) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const noop = () => undefined;
const EU = "00000000-0000-4000-8000-0000000000a1";
const OUTRA = "00000000-0000-4000-8000-0000000000a2";
const EQUIPE = "00000000-0000-4000-8000-0000000000e1";
const Q1 = "11111111-1111-4111-8111-111111111111";
const Q2 = "22222222-2222-4222-8222-222222222222";
const R1 = "33333333-3333-4333-8333-333333333331";
const R2 = "33333333-3333-4333-8333-333333333332";
const AGORA = Date.parse("2026-11-12T20:10:00.000Z");

/* ------------------------------------------------------------------------------------------------
 * As curtidas (D101)
 * ---------------------------------------------------------------------------------------------- */

test("a contagem: a resposta escrita (sem reply_id) e cada resposta do fio contam a parte; a curtida de quem le fica marcada; ninguem marcado sem quem le", () => {
  const linhas = [
    { question_id: Q1, reply_id: null, user_id: EU },
    { question_id: Q1, reply_id: null, user_id: OUTRA },
    { question_id: Q1, reply_id: R1, user_id: OUTRA },
    { question_id: Q1, reply_id: R2, user_id: EU },
    { question_id: Q1, reply_id: R2, user_id: OUTRA },
    { question_id: Q1, reply_id: R2, user_id: EQUIPE },
    { question_id: Q2, reply_id: null, user_id: EQUIPE }
  ];
  const minhas = likes.tallyQuestionLikes(linhas, EU);
  assert.deepEqual(minhas.answers.get(Q1), { liked: true, likes: 2 });
  assert.deepEqual(minhas.answers.get(Q2), { liked: false, likes: 1 });
  assert.deepEqual(minhas.replies.get(R1), { liked: false, likes: 1 });
  assert.deepEqual(minhas.replies.get(R2), { liked: true, likes: 3 });
  assert.equal(minhas.answers.get(R1), undefined, "a curtida de uma resposta do fio nunca conta na resposta escrita");
  const semQuemLe = likes.tallyQuestionLikes(linhas, null);
  assert.deepEqual(semQuemLe.replies.get(R2), { liked: false, likes: 3 });
  assert.deepEqual(likes.tallyQuestionLikes([], EU), { answers: new Map(), replies: new Map() });
  assert.deepEqual(likes.NO_LIKES, { liked: false, likes: 0 });
  assert.equal(likes.QUESTION_LIKES_MIGRATION, "202611170001");
});

test("o toque muda a tela na hora: curtir soma um e marca; tirar a curtida desconta e desmarca, nunca abaixo de zero", () => {
  assert.deepEqual(likes.toggledLike({ liked: false, likes: 2 }), { liked: true, likes: 3 });
  assert.deepEqual(likes.toggledLike({ liked: true, likes: 3 }), { liked: false, likes: 2 });
  assert.deepEqual(likes.toggledLike({ liked: true, likes: 0 }), { liked: false, likes: 0 });
  assert.deepEqual(likes.toggledLike(null), { liked: true, likes: 1 });
  assert.deepEqual(likes.toggledLike({}), { liked: true, likes: 1 });
});

const pergunta = (extra = {}) => ({
  anonymous: false,
  answerAuthor: null,
  answerText: "Pode sim.",
  answeredAt: "2026-11-12T20:02:00.000Z",
  answeredLive: false,
  avatarUrl: null,
  body: "Posso fazer?",
  canReply: true,
  createdAt: "2026-11-12T20:00:00.000Z",
  displayName: "Ana M.",
  id: Q1,
  mine: true,
  replies: [],
  status: "answered",
  upvotes: 1,
  voted: false,
  ...extra
});
const resposta = (id, extra = {}) => ({ anonymous: false, avatarUrl: null, body: "De nada.", createdAt: "2026-11-12T20:05:00.000Z", displayName: "Danilo S.", id, mine: false, role: "host", ...extra });

test("o que o aluno recebe: as curtidas da resposta escrita e de cada resposta do fio; a pergunta sem resposta escrita nao tem curtida de resposta", () => {
  const contagem = likes.tallyQuestionLikes(
    [
      { question_id: Q1, reply_id: null, user_id: EU },
      { question_id: Q1, reply_id: R1, user_id: OUTRA }
    ],
    EU
  );
  const comFio = rules.withQuestionLikes(pergunta({ replies: [resposta(R1), resposta(R2)] }), contagem);
  assert.deepEqual([comFio.answerLiked, comFio.answerLikes], [true, 1]);
  assert.deepEqual(comFio.replies.map((item) => [item.id, item.liked, item.likes]), [[R1, false, 1], [R2, false, 0]]);
  // Respondida so ao vivo (sem texto): nada a curtir na resposta, mesmo com uma linha antiga no banco.
  const aoVivo = rules.withQuestionLikes(pergunta({ answerText: null, answeredLive: true }), contagem);
  assert.deepEqual([aoVivo.answerLiked, aoVivo.answerLikes], [false, 0]);
  // O resto da pergunta nao muda.
  assert.equal(comFio.upvotes, 1);
  assert.equal(comFio.body, "Posso fazer?");
});

test("os pedidos: o do aluno com a sessao e a resposta do fio opcional; o da equipe diz o alvo, e so a resposta do fio leva o id dela", () => {
  const SESSAO = "44444444-4444-4444-8444-444444444444";
  assert.equal(schemas.questionLikeBodySchema.safeParse({ sessionId: SESSAO }).success, true, "a resposta escrita");
  assert.equal(schemas.questionLikeBodySchema.safeParse({ replyId: null, sessionId: SESSAO }).success, true);
  assert.equal(schemas.questionLikeBodySchema.safeParse({ replyId: R1, sessionId: SESSAO }).success, true);
  assert.equal(schemas.questionLikeBodySchema.safeParse({ replyId: "abc", sessionId: SESSAO }).success, false);
  assert.equal(schemas.questionLikeBodySchema.safeParse({ replyId: R1 }).success, false, "sem a sessao, nada");

  const equipe = schemas.likeQuestionItemSchema;
  assert.equal(equipe.safeParse({ questionId: Q1, target: "question" }).success, true);
  assert.equal(equipe.safeParse({ questionId: Q1, target: "answer" }).success, true);
  assert.equal(equipe.safeParse({ questionId: Q1, replyId: R1, target: "reply" }).success, true);
  assert.equal(equipe.safeParse({ questionId: Q1, target: "reply" }).success, false, "a resposta do fio sem o id dela");
  assert.equal(equipe.safeParse({ questionId: Q1, replyId: R1, target: "answer" }).success, false, "a resposta escrita nao leva id de resposta do fio");
  assert.equal(equipe.safeParse({ questionId: Q1, target: "chat" }).success, false);
  assert.equal(equipe.safeParse({ questionId: "abc", target: "question" }).success, false);
});

test("a sala: o polegar com o numero na resposta escrita e em cada resposta do fio, cheio na que e minha; sem o onLike (o ver como, a gaveta do vertical), nenhum polegar no fio", () => {
  const lista = (extra = {}) =>
    render(questionsModule.RoomQuestionList, {
      emptyPhrase: "vazio",
      footerFor: () => null,
      onLike: noop,
      onVote: noop,
      questions: [pergunta({ answerLiked: true, answerLikes: 4, replies: [resposta(R1, { liked: false, likes: 0 }), resposta(R2, { liked: true, likes: 12, mine: true, role: "student" })] })],
      reply: null,
      serverNowMs: AGORA,
      ...extra
    });
  const html = lista();
  // Tres polegares do fio (a resposta e as duas respostas do fio), alem do da pergunta.
  const alvos = [...html.matchAll(/aria-pressed="(true|false)"[^>]*data-room-like="([^"]+)"|data-room-like="([^"]+)"[^>]*aria-pressed="(true|false)"/g)].map((match) => [match[2] ?? match[3], match[1] ?? match[4]]);
  assert.deepEqual(alvos, [["answer", "true"], [R1, "false"], [R2, "true"]]);
  // O numero ao lado de cada um, e o total para o leitor de tela.
  const fio = html.slice(html.indexOf('data-room-like="answer"'));
  assert.match(fio, /<span aria-hidden="true" class="[^"]*tabular-nums[^"]*">4<\/span><span class="sr-only">4 curtidas<\/span>/);
  assert.match(fio, /<span class="sr-only">0 curtidas<\/span>/);
  assert.match(fio, /<span aria-hidden="true" class="[^"]*">12<\/span><span class="sr-only">12 curtidas<\/span>/);
  // O polegar da resposta vem antes do que mais houver na linha de acoes dela (o Falar com a equipe).
  const comRodape = lista({ footerFor: () => createElement("span", { "data-teste-rodape": "" }, "Falar com a equipe") });
  assert.ok(comRodape.indexOf('data-room-like="answer"') < comRodape.indexOf("data-teste-rodape"));

  // Sem o onLike: o fio so de leitura, sem polegar; o da pergunta continua.
  const semCurtir = lista({ onLike: undefined });
  assert.doesNotMatch(semCurtir, /data-room-like/);
  assert.match(semCurtir, /aria-pressed="false"/, "o polegar da pergunta");
  // A aba so passa o curtir fora do ver como.
  const aba = fonte("src/components/member/webinars/room/room-questions.tsx");
  assert.match(aba, /onLike=\{readOnly \? undefined : \(item, replyId\) => void like\(item, replyId\)\}/);
  assert.match(aba, /setQuestions\(\(previous\) => previous\.map\(apply\(toggledLike\(before\)\)\)\);/, "a tela muda antes de o servidor responder");
  assert.match(aba, /\} catch \(failure\) \{\s*setQuestions\(\(previous\) => previous\.map\(apply\(before\)\)\);/, "a recusa desfaz");
});

const perguntaDoConsole = (extra = {}) => ({
  anonymous: false,
  answerAuthor: null,
  answerLiked: false,
  answerLikes: 2,
  answerText: "Pode",
  answeredAt: "2026-11-12T20:02:00.000Z",
  answeredBy: EQUIPE,
  answeredLive: false,
  body: "Posso fazer?",
  createdAt: "2026-11-12T20:00:00.000Z",
  displayName: "Ana M.",
  id: Q1,
  messageId: null,
  offsetMs: 0,
  replies: [
    { anonymous: false, authorAs: null, body: "Obrigada", createdAt: "2026-11-12T20:03:00.000Z", displayName: "Ana M.", id: R1, liked: true, likes: 1, questionId: Q1, role: "student", sessionId: "s", userId: EU },
    { anonymous: false, authorAs: null, body: "De nada", createdAt: "2026-11-12T20:04:00.000Z", displayName: "Danilo S.", id: R2, liked: false, likes: 0, questionId: Q1, role: "host", sessionId: "s", userId: EQUIPE }
  ],
  sessionId: "s",
  simulated: false,
  status: "answered",
  threadSeenAt: null,
  upvotes: 5,
  userId: EU,
  voted: true,
  ...extra
});
const painel = (extra = {}) =>
  render(consoleQuestions.ConsoleQuestions, {
    author: { as: "self", name: null },
    busyKey: null,
    canAct: true,
    currentUserName: "Danilo S.",
    onAnswer: async () => true,
    onAuthor: noop,
    onLike: noop,
    onReply: async () => true,
    onStatus: noop,
    questions: [perguntaDoConsole()],
    ...extra
  });

test("o console: a equipe curte a pergunta, a resposta escrita e cada resposta do fio; o nome do botao diz o total; sem poder agir ou sem a acao, os votos ficam como texto e o fio sem polegar", () => {
  const html = painel();
  const botoes = [...html.matchAll(/<button aria-label="([^"]+)" aria-pressed="(true|false)" class="[^"]*" data-console-like="([^"]+)" type="button">/g)].map((match) => [match[3], match[2], match[1]]);
  assert.deepEqual(botoes, [
    ["question", "true", "Tirar a curtida, 5 curtidas"],
    ["answer", "false", "Curtir, 2 curtidas"],
    [R1, "true", "Tirar a curtida, 1 curtida"],
    [R2, "false", "Curtir, 0 curtidas"]
  ]);
  assert.doesNotMatch(textOf(html), /5 votos/, "o numero da pergunta agora e o do polegar");

  for (const extra of [{ canAct: false }, { onLike: null }, { onLike: undefined }]) {
    const semCurtir = painel(extra);
    assert.doesNotMatch(semCurtir, /data-console-like/, JSON.stringify(Object.keys(extra)));
    assert.match(textOf(semCurtir), /5 votos/);
  }
  // Ocupada (a acao em curso nesta pergunta), os polegares desligam.
  assert.equal((painel({ busyKey: `question:${Q1}` }).match(/data-console-like="[^"]+" disabled=""/g) ?? []).length, 4);

  // O console liga o polegar a acao pelo run, com a chave ocupada da pergunta, e a rota de 5 s manda quem pede.
  const tela = fonte("src/components/admin/v2/communication/webinars/session-console/session-console.tsx");
  assert.match(tela, /onLike=\{canAct \? \(like: ConsoleLikeInput\) => void run\(`question:\$\{like\.questionId\}`, \(\) => likeQuestionItem\(like\)\) : null\}/);
  assert.match(fonte("src/app/api/admin/webinars/[id]/console/route.ts"), /getConsoleSnapshot\(id, sessionId, new Date\(\), auth\.user\?\.id \?\? null\)/);
  // A acao passa pelo runWebinarAction com a permissao de quem atende (nunca runAdminAction direto).
  const acoes = fonte("src/server/webinars/room-actions.ts");
  const corpo = acoes.slice(acoes.indexOf("export async function likeQuestionItem("), acoes.indexOf("export async function likeQuestionItem(") + 2400);
  assert.match(corpo, /return runWebinarAction\("messaging\.write", "atendimento", likeQuestionItemSchema, input,/);
  assert.doesNotMatch(corpo, /runAdminAction/);
});

/* ------------------------------------------------------------------------------------------------
 * O aviso de resposta nova nas perguntas do aluno (D100)
 * ---------------------------------------------------------------------------------------------- */

const minha = (extra = {}) => ({ answerText: "Pode", answeredAt: "2026-11-12T20:02:00.000Z", answeredLive: false, id: Q1, mine: true, replies: [], status: "answered", ...extra });

test("o que conta como fala da equipe na minha pergunta: a resposta (escrita ou ao vivo) e cada resposta do fio que nao e minha; a pergunta de outro aluno nunca", () => {
  assert.deepEqual(news.questionNewsMarks([minha()]), [`${Q1}:a:2026-11-12T20:02:00.000Z`]);
  assert.deepEqual(news.questionNewsMarks([minha({ answerText: null, answeredLive: true })]), [`${Q1}:a:2026-11-12T20:02:00.000Z`], "respondida ao vivo tambem avisa");
  assert.deepEqual(news.questionNewsMarks([minha({ answerText: null, answeredAt: null, status: "open" })]), [], "a aberta ainda nao tem fala da equipe");
  assert.deepEqual(
    news.questionNewsMarks([minha({ replies: [{ id: R1, mine: true }, { id: R2, mine: false }] })]),
    [`${Q1}:a:2026-11-12T20:02:00.000Z`, `${Q1}:r:${R2}`],
    "a minha resposta no fio nao e novidade para mim"
  );
  assert.deepEqual(news.questionNewsMarks([minha({ id: Q2, mine: false, replies: [{ id: R2, mine: false }] })]), [], "a pergunta de outro aluno");
  // Responder de novo depois do Reabrir e outra marca (a hora muda).
  assert.notDeepEqual(news.questionNewsMarks([minha({ answeredAt: "2026-11-12T20:09:00.000Z" })]), news.questionNewsMarks([minha()]));
  assert.equal(news.hasOwnQuestion([minha({ mine: false })]), false);
  assert.equal(news.hasOwnQuestion([minha({ mine: false }), minha({ id: Q2, status: "open" })]), true);
});

test("quantas eu ainda nao vi: a primeira leitura e a aba Perguntas na tela veem tudo; com a aba fora da tela, a fala nova conta ate eu abrir", () => {
  const primeira = news.questionNewsMarks([minha()]);
  assert.equal(news.questionNewsCount(null, primeira), 0, "antes da primeira leitura nada e novo");
  let vistas = news.questionNewsSeen(null, primeira, false);
  assert.equal(news.questionNewsCount(vistas, primeira), 0, "o que ja estava la quando a sala abriu nao avisa");

  // A equipe escreve no fio com a aba fora da tela: uma fala nova.
  const depois = news.questionNewsMarks([minha({ replies: [{ id: R2, mine: false }] })]);
  const semVer = news.questionNewsSeen(vistas, depois, false);
  assert.equal(semVer, vistas, "fora da tela, o visto nao anda");
  assert.equal(news.questionNewsCount(semVer, depois), 1);
  // Mais uma fala: duas.
  const maisUma = news.questionNewsMarks([minha({ replies: [{ id: R2, mine: false }, { id: "outra", mine: false }] })]);
  assert.equal(news.questionNewsCount(semVer, maisUma), 2);

  // A aba Perguntas na tela ve tudo: zera.
  vistas = news.questionNewsSeen(semVer, maisUma, true);
  assert.equal(news.questionNewsCount(vistas, maisUma), 0);
  assert.equal(news.questionNewsSeen(vistas, maisUma, true), vistas, "nada mudou: o mesmo conjunto (a sala nao redesenha)");
  // A resposta apagada pela equipe some da lista e nao vira novidade.
  assert.equal(news.questionNewsCount(vistas, primeira), 0);
});

test("a sala so rele as perguntas por conta propria com a aba fora da tela e, depois da primeira leitura, para quem ja perguntou", () => {
  const le = (parte) => news.questionNewsPolls({ enabled: true, loaded: true, own: true, tabMounted: false, ...parte });
  assert.equal(le({}), true);
  assert.equal(le({ tabMounted: true }), false, "a aba montada ja le e entrega a lista");
  assert.equal(le({ own: false }), false, "quem nao perguntou nada nao rele");
  assert.equal(le({ loaded: false, own: false }), true, "a primeira leitura, uma por aluno, descobre");
  assert.equal(le({ enabled: false }), false, "o ver como, a sala fora do ar");
  assert.ok(news.QUESTION_NEWS_REFRESH_MS >= 15_000, "nunca mais rapido que a propria aba");

  // As duas salas ligam o aviso do mesmo jeito: o numero no trilho e no painel, a lista da aba e o Ver que abre a aba.
  for (const arquivo of ["live-room.tsx", "webinar-room.tsx"]) {
    const sala = fonte(`src/components/member/webinars/room/${arquivo}`);
    assert.match(sala, /const questionNews = useRoomQuestionNews\(\{/, arquivo);
    assert.match(sala, /questionsNew=\{questionNews\.count\}/, arquivo);
    assert.match(sala, /onQuestions=\{questionNews\.ingest\}/, arquivo);
    assert.match(sala, /if \(key === QUESTION_NEWS_SNACK_ACTION\) \{[\s\S]*?setTab\("perguntas"\);\s*setPanelOpen\(true\);/, arquivo);
    assert.match(sala, /if \(questionNewsCount > before\) \{\s*snackbarApi\.show\(\{ action: \{ key: QUESTION_NEWS_SNACK_ACTION, label: WEBINAR_COPY\.salaV2\.perguntas\.verResposta \}, key: "question_news", text: WEBINAR_COPY\.salaV2\.perguntas\.respostaNova \}\);/, arquivo);
  }
  assert.deepEqual(
    [WEBINAR_COPY.salaV2.perguntas.respostaNova, WEBINAR_COPY.salaV2.perguntas.verResposta, WEBINAR_COPY.salaV2.perguntas.respostasNovas(1), WEBINAR_COPY.salaV2.perguntas.respostasNovas(3)],
    ["Responderam a sua pergunta.", "Ver", "1 resposta nova", "3 respostas novas"]
  );
});

test("o trilho: o item Perguntas com o numero das respostas novas e o nome 'Perguntas, 2 respostas novas'; aberto na aba, ou sem novidade, nada", () => {
  const trilho = (extra = {}) => render(railModule.RoomRail, { kind: "live", onItem: noop, panelShown: false, pollOpen: false, questionsNew: 2, tab: "chat", tabs: ["chat", "perguntas", "participantes"], unread: 0, ...extra });
  const item = (html) => html.slice(html.indexOf('data-room-rail="perguntas"') - 200, html.indexOf('data-room-rail="participantes"'));
  const comNovas = item(trilho());
  assert.match(comNovas, /aria-label="Perguntas, 2 respostas novas"/);
  assert.match(comNovas, /data-room-unread="">2<\/span>/);
  // O Chat continua com o contador dele, sem misturar.
  const dois = trilho({ unread: 3 });
  assert.match(dois, /aria-label="Chat, 3 mensagens novas"/);
  assert.equal((dois.match(/data-room-unread=""/g) ?? []).length, 2);
  // Com a aba Perguntas na tela, ou sem resposta nova, o item fica como sempre.
  for (const extra of [{ panelShown: true, tab: "perguntas" }, { questionsNew: 0 }, { questionsNew: undefined }]) {
    const semNovas = item(trilho(extra));
    assert.doesNotMatch(semNovas, /data-room-unread|respostas novas|resposta nova/, JSON.stringify(extra));
  }
  // Abaixo de lg (sem trilho), o ponto na aba Perguntas do painel enquanto ela nao e a escolhida.
  assert.match(fonte("src/components/member/webinars/room/room-panel.tsx"), /dot: \(value === "enquetes" && pollOpen\) \|\| \(value === "perguntas" && questionsNew > 0 && tab !== "perguntas"\)/);
});

/* ------------------------------------------------------------------------------------------------
 * A mao levantada no palco do console e a fila (D99)
 * ---------------------------------------------------------------------------------------------- */

test("as maos que subiram desde a ultima leitura: so as novas, na ordem da fila; a que mudou de lugar ou continua levantada nao avisa de novo", () => {
  assert.deepEqual(consoleV2.newRaisedHands([], ["a"]), ["a"]);
  assert.deepEqual(consoleV2.newRaisedHands(["a"], ["a", "b", "c"]), ["b", "c"]);
  assert.deepEqual(consoleV2.newRaisedHands(["a", "b"], ["b", "a"]), [], "o Pular so muda a ordem");
  assert.deepEqual(consoleV2.newRaisedHands(["a", "b"], ["b"]), [], "a mao que abaixou");
  assert.deepEqual(consoleV2.newRaisedHands(["a"], []), []);
  // Abaixou e levantou de novo depois de uma leitura sem ela: avisa de novo.
  assert.deepEqual(consoleV2.newRaisedHands([], ["a"]), ["a"]);
});

test("o selo do palco, o aviso e a fila, com o desenho da area: as frases e as ligacoes (o motor nao desenha o selo amarelo nem o cartao dele)", () => {
  const copy = WEBINAR_COPY.consoleV2.filaDeMaos;
  assert.deepEqual([copy.selo(1), copy.selo(3)], ["1 mão levantada. Abrir a fila.", "3 mãos levantadas. Abrir a fila."]);
  assert.deepEqual([copy.levantou("Ana M.", 1), copy.levantou("Caio F.", 3)], ["Ana M. levantou a mão.", "Caio F. levantou a mão. 3 na fila."]);
  assert.deepEqual([copy.verFila, copy.ordem, copy.proximo], ["Ver fila", "Na ordem de quem levantou primeiro.", "Próximo"]);

  // O selo no palco: so dentro da sala e com mao levantada; o toque abre a aba Mãos.
  const palco = fonte("src/components/admin/v2/communication/webinars/session-console/console-stage.tsx");
  assert.match(palco, /const handsShown = joined && handsCount > 0 && Boolean\(onHands\);/);
  assert.match(palco, /aria-label=\{WEBINAR_COPY\.consoleV2\.filaDeMaos\.selo\(handsCount\)\}[\s\S]*?data-console-hands-open="stage"\s*onClick=\{onHands\}/);
  assert.match(palco, /<RoomStagePill className="tabular-nums" data-room-badge="hands">\s*<Hand aria-hidden="true" \/>\s*\{handsCount\}/);
  const tela = fonte("src/components/admin/v2/communication/webinars/session-console/session-console.tsx");
  assert.match(tela, /handsCount=\{counts\.maos\}/);
  assert.match(tela, /onHands=\{\(\) => openPanel\(\{ tab: "maos" \}\)\}/);
  // O aviso: um por vez (o mesmo id), com Ver fila, e nada com a aba Mãos na tela.
  assert.match(tela, /const fresh = newRaisedHands\(handsSeenRef\.current, ids\);\s*handsSeenRef\.current = ids;\s*const last = fresh\.at\(-1\);\s*if \(!last \|\| shown\) \{\s*return;/);
  assert.match(tela, /adminToast\.notice\(WEBINAR_COPY\.consoleV2\.filaDeMaos\.levantou\(name, ids\.length\), \{\s*action: \{ label: WEBINAR_COPY\.consoleV2\.filaDeMaos\.verFila, onClick: onFila \},\s*durationMs: 6_000,\s*id: "console-hand-raised"/);
  // O aviso neutro com acao existe no admin, e o mesmo id troca no lugar.
  assert.match(fonte("src/components/admin/v2/toast.tsx"), /notice\(message: string, options: \{ action\?: \{ label: string; onClick: \(\) => void \}; durationMs\?: number; id\?: string \} = \{\}\) \{\s*return toast\(message, \{ action: options\.action, duration: options\.durationMs \?\? ADMIN_TOAST_DURATION_MS, id: options\.id \}\);/);
  // No console a acao do aviso e texto na cor da acao do aviso da sala (nunca a caixa do botao da biblioteca).
  assert.match(fonte("src/components/admin/v2/toast.tsx"), /actionButtonStyle: inConsole \? \{ background: "transparent", color: "var\(--room-snackbar-action\)"/);
  // A fila diz a ordem e marca o primeiro, quando ha mais de um.
  const fila = fonte("src/components/admin/v2/communication/webinars/session-console/live-hands.tsx");
  assert.match(fila, /\{hands\.length > 0 \? <p[^>]*>\{WEBINAR_COPY\.consoleV2\.filaDeMaos\.ordem\}<\/p> : null\}/);
  assert.match(fila, /\{index === 0 && hands\.length > 1 \? \(\s*<span[^>]*data-live-hand-next="">\s*\{WEBINAR_COPY\.consoleV2\.filaDeMaos\.proximo\}/);
  // O motor continua sem o aviso da mao e sem o selo dele no console (os nossos tomam o lugar).
  const config = fonte("src/lib/jitsi-room-config.ts");
  assert.match(config, /export const CONSOLE_DISABLED_NOTIFICATIONS: readonly string\[\] = \["notify\.raisedHand"\];/);
});

/* ------------------------------------------------------------------------------------------------
 * Mostrar quantas pessoas estao na sala (D102)
 * ---------------------------------------------------------------------------------------------- */

test("a opcao: ligada por padrao; o webinario de antes (sem a chave) le ligado; o rascunho de antes passa e sai ligado; desligada fica desligada", () => {
  assert.equal(model.defaultRoomSettings().showPresentCount, true);
  assert.equal(rows.roomSettingsOfRow({}).showPresentCount, true, "o webinario de antes");
  assert.equal(rows.roomSettingsOfRow({ showPresentCount: false }).showPresentCount, false);
  assert.equal(rows.roomSettingsOfRow({ showPresentCount: "nao" }).showPresentCount, true, "um valor que nao e booleano vale o padrao");
  assert.equal(rows.roomSettingsOfRow(null).showPresentCount, true);

  const base = model.defaultRoomSettings();
  const semChave = { ...base };
  delete semChave.showPresentCount;
  const antigo = webinarSchemas.roomSettingsSchema.safeParse(semChave);
  assert.equal(antigo.success, true, "o editor aberto com o codigo de antes ainda salva");
  assert.equal(antigo.data.showPresentCount, true);
  assert.equal(webinarSchemas.roomSettingsSchema.safeParse({ ...base, showPresentCount: false }).data.showPresentCount, false);
  assert.equal(webinarSchemas.roomSettingsSchema.safeParse({ ...base, showPresentCount: "sim" }).success, false);

  assert.deepEqual(
    [findCopy("showPresentCount"), findCopy("showPresentCountHint")],
    ["Mostrar quantas pessoas estão na sala", "Desligado, os alunos não veem o número de pessoas na sala. Você continua vendo no console."]
  );
});

/** A frase do editor pelo nome da chave, onde quer que ela more em WEBINAR_ADMIN_COPY. */
function findCopy(key, node = WEBINAR_ADMIN_COPY) {
  if (!node || typeof node !== "object") {
    return undefined;
  }
  if (typeof node[key] === "string") {
    return node[key];
  }
  for (const value of Object.values(node)) {
    const found = findCopy(key, value);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

test("desligada, o numero nao sai do servidor nem aparece na sala: o retrato e o sinal de 15 s vao zerados, e o palco, a aba e o titulo ficam sem numero nas duas salas e no vertical", () => {
  // O servidor: a contagem nem e lida.
  const consultas = fonte("src/server/webinars/room-queries.ts");
  assert.match(consultas, /const showPresentCount = webinar\.roomSettings\.showPresentCount;/);
  assert.match(consultas, /\(simulated \|\| live\) && showPresentCount \? listPresentUserIds\(/);
  assert.match(consultas, /presentHidden: !showPresentCount,\s*presentNow: showPresentCount \? presentIds\.length : 0,/);
  const escritas = fonte("src/server/webinars/room-writes.ts");
  assert.match(escritas, /const presentNow = session\.kind === "replay" \|\| context\.showPresentCount === false \? 0 : \(await listPresentUserIds\(/);
  // Desde a rodada v12 (D107) o sinal rele a chave a parte (15 s por webinario) e diz na resposta se o numero esta escondido.
  const sinal = fonte("src/app/api/webinars/[id]/heartbeat/route.ts");
  assert.match(sinal, /const showPresentCount = await loadPresentCountShown\(guarded\.webinarId, room\.webinar\.roomSettings\.showPresentCount, now\);/);
  assert.match(sinal, /presentHidden: !showPresentCount, presentNow: result\.presentNow,/);

  // A sala ao vivo: um numero so (o selo do palco, a aba Participantes e o titulo dela), nulo quando escondido.
  const aoVivo = fonte("src/components/member/webinars/room/live-room.tsx");
  assert.match(aoVivo, /const presentHidden = heartbeatHidden \?\? session\.presentHidden === true;/);
  assert.match(aoVivo, /const presentShown = phase === "ended" \|\| presentHidden \? null : simulation\.displayCount\(presentNow, simulationOffsetMs\);/);
  // A gravada: o mesmo numero em todo lugar, e o vertical sem o "{n} assistindo".
  const gravada = fonte("src/components/member/webinars/room/webinar-room.tsx");
  assert.match(gravada, /const presentShown = momentBadge\.showCount && !presentHidden \? shownCount : null;/);
  assert.match(gravada, /students=\{presentShown\}/);
  assert.match(gravada, /tab === "participantes" \? presentShown :/);
  assert.match(gravada, /presentNow=\{presentHidden \? null : shownCount\}/);
  assert.match(fonte("src/components/member/webinars/room/vertical/vertical-top-bar.tsx"), /\{badge\.showCount && presentNow !== null \? \(/);
  // O card Sala do editor tem a chave.
  const cards = fonte("src/components/admin/v2/communication/webinars/webinar-editor-cards.tsx");
  assert.match(cards, /checked=\{room\.showPresentCount\}[\s\S]*?id="webinar-room-showPresentCount"[\s\S]*?onCheckedChange=\{\(showPresentCount\) => setRoom\(\{ showPresentCount \}\)\}/);
});

/* ------------------------------------------------------------------------------------------------
 * A janela "A live foi encerrada" (D104)
 * ---------------------------------------------------------------------------------------------- */

test("a live acaba com o aluno na sala: a janela da area avisa, com o desenho do Sair da sala e o OK em foco; quem abre a pagina de uma live que ja acabou nao ve janela", async () => {
  const ended = await import("../src/components/member/webinars/room/room-ended-dialog.tsx");
  // So a passagem de "no ar" para "encerrada" com a pagina aberta abre a janela.
  assert.equal(ended.endedDialogOpens("live", "ended"), true);
  for (const [antes, agora] of [["ended", "ended"], ["waiting", "ended"], ["live", "live"], ["waiting", "live"], ["ended", "live"]]) {
    assert.equal(ended.endedDialogOpens(antes, agora), false, `${antes} -> ${agora}`);
  }

  const copy = WEBINAR_COPY.salaV2.encerrada;
  assert.deepEqual([copy.titulo, copy.texto, copy.ok], ["A live foi encerrada", "Obrigado por participar. Você já pode sair da sala.", "OK"]);
  const html = render(ended.RoomEndedDialog, { onClose: noop });
  assert.match(html, /<div aria-describedby="[^"]+" aria-labelledby="[^"]+" aria-modal="true" class="[^"]*" data-room-confirm="" data-room-ended-dialog="" role="alertdialog">/);
  assert.match(html, /<h2[^>]*>A live foi encerrada<\/h2>/);
  assert.match(html, /<p[^>]*>Obrigado por participar\. Você já pode sair da sala\.<\/p>/);
  assert.match(html, /<button[^>]*data-room-first-focus="true"[^>]*>OK<\/button>|<button[^>]*data-room-first-focus=""[^>]*>OK<\/button>/, "o foco entra no OK");
  assert.equal((html.match(/<button/g) ?? []).length, 1, "um botao so: nada a decidir");
  // As cores sao as da sala (os tokens --room-*), nunca o azul do motor.
  assert.match(html, /bg-room-menu/);
  assert.doesNotMatch(html, /#[0-9a-f]{6}|blue/i);

  // A sala ao vivo liga a janela: abre na virada da fase, o Esc e o OK so a fecham, o Tab fica preso nela, e o motor
  // continua sem o dialogo dele.
  const sala = fonte("src/components/member/webinars/room/live-room.tsx");
  assert.match(sala, /if \(phaseSeen !== phase\) \{\s*setPhaseSeen\(phase\);\s*if \(endedDialogOpens\(phaseSeen, phase\)\) \{\s*setEndedNotice\(true\);/);
  assert.match(sala, /if \(endedNotice && !confirmLeave\) \{\s*setEndedNotice\(false\);\s*return;\s*\}/, "o Esc so fecha a janela");
  assert.match(sala, /\{endedNotice && !confirmLeave \? <RoomEndedDialog onClose=\{\(\) => setEndedNotice\(false\)\} \/> : null\}/);
  assert.match(sala, /useRoomConfirmFocus\(rootRef, endedNotice && !confirmLeave\);/);
  assert.match(sala, /trapRoomFocus\(event, confirmLeave \|\| endedNotice \?/);
  assert.match(fonte("src/lib/jitsi-room-config.ts"), /notifyOnConferenceDestruction: false,/);
});
