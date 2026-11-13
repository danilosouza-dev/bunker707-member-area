import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import {
  HOUR,
  LIVE_SOURCE,
  MIN,
  OTHER_SESSION,
  RECORDING,
  REPLAY,
  SESSION,
  WEBINAR,
  bancoFalso,
  escola,
  iso,
  janelaDoChat
} from "./support/webinarios-sala-banco.mjs";

// As rotas da Sala (docs/30 §4.7, §5.1, §8.3 e §8.5; docs/18 §2.2), sem banco: um banco falso em memoria (tabelas
// como listas, filtros do PostgREST, chaves unicas das tabelas da 202610290001 e a RPC webinar_chat_window com a
// linha mestre deslocada pela ancora) e a sessao do aluno pelo teste. Aqui: 401 sem sessao, 400 sem id, 404 fora do
// acesso e sessao de outro webinario; a janela do chat (linha mestre + a pendente do proprio aluno) e a consulta de
// mensagens novas com o cursor; o aceite obrigatorio uma vez (409 consent_required, depois webinar_chat_consented
// e o nome exibido, sempre o primeiro nome com a inicial do sobrenome); sem anonimato e sem apelido (D64, 10/11/2026):
// o pedido de uma pagina antiga que ainda pede anonimo ou apelido e recusado com 400 e nada e gravado, o aceite antigo
// com apelido ou anonimo conta como sem aceite, e o card Sala antigo do webinario nao muda nada; offset do relogio do servidor na gravada e do corpo no replay; 409 chat_off /
// team_only / not_started / ended; rajada 5/60 s e modo lento 429 com Retry-After; palavra bloqueada 422; moderado
// grava approved = false e devolve pending; a pergunta pelo chat; Remover minhas mensagens (apaga tudo, retira o
// aceite, grava revoked); o sinal de presenca (balde do servidor, webinar_joined no primeiro, samples no mesmo
// balde, webinar_left no leave, o acesso em cache); reacoes 1/s e 20/min e as contagens; perguntas 2/min, a lista
// com mine/voted e a dispensada so para o autor, o voto que alterna; enquetes (uma resposta, 409 na segunda,
// encerrada 409, opcao invalida 400, resultado so compartilhado); e a resposta da sessao com os campos da sala. A
// moderacao por pessoa na Live gravada (a Na tela, R5): silenciado 409 muted no chat, na pergunta e no fio (reage e
// responde enquete), removido 409 banned em tudo e a sessao com join kicked e sem o video, o desfazer devolve a sala, e
// roomJoinFor com o kicked na gravada.

const sessao = (globalThis.__salaRotasSessao ??= { user: null });

/** O modulo de src/ que um import pede ("server/auth/guards"), pelo alias ou por caminho relativo. */
function moduloDeSrc(specifier, context) {
  if (specifier.startsWith("@/")) {
    return specifier.slice(2);
  }
  if (/^\.{1,2}\//.test(specifier) && context.parentURL) {
    const url = new URL(specifier, context.parentURL).href;
    const index = url.indexOf("/src/");
    return index === -1 ? null : url.slice(index + 5).replace(/\.tsx?$/, "");
  }
  return null;
}

const stub = (source) => ({ shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` });

// A sessao das rotas (requireApiUser / requireApiSessionUser) vem do teste; o cliente do banco (pedido pelo alias
// nas rotas e por caminho relativo em src/server/webinars/db.ts) e o banco falso de admin-action-stubs.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const modulo = moduloDeSrc(specifier, context);
    if (modulo === "server/auth/guards") {
      return stub(`
        export async function requireApiUser() {
          const user = globalThis.__salaRotasSessao.user;
          return user ? { response: null, user } : { response: Response.json({ error: "Sessao obrigatoria." }, { status: 401 }), user: null };
        }
        export const requireApiSessionUser = requireApiUser;`);
    }
    if (modulo === "server/db/supabase/client") {
      return stub(`
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return true; }`);
    }
    return nextResolve(specifier, context);
  }
});

const chatRoute = await import("../src/app/api/webinars/[id]/chat/route.ts");
const globalChatRoute = await import("../src/app/api/webinars/chat/route.ts");
const heartbeatRoute = await import("../src/app/api/webinars/[id]/heartbeat/route.ts");
const reactionsRoute = await import("../src/app/api/webinars/[id]/reactions/route.ts");
const questionsRoute = await import("../src/app/api/webinars/[id]/questions/route.ts");
const voteRoute = await import("../src/app/api/webinars/[id]/questions/[qid]/vote/route.ts");
const repliesRoute = await import("../src/app/api/webinars/[id]/questions/[qid]/replies/route.ts");
const pollsRoute = await import("../src/app/api/webinars/[id]/polls/route.ts");
const sessionRoute = await import("../src/app/api/webinars/[id]/session/route.ts");
const registerRoute = await import("../src/app/api/webinars/[id]/register/route.ts");
const { resetRoomLimits, takeReplyBurst } = await import("../src/server/webinars/room-limits.ts");
const { CHAT_CONSENT_VERSION } = await import("../src/server/webinars/model.ts");
const { CHAT_MESSAGES } = await import("../src/server/webinars/chat-schemas.ts");
const { clearAuthorPhotoCache } = await import("../src/server/webinars/author-photos.ts");
const { clearSharedPollCounts, roomJoinFor } = await import("../src/server/webinars/room-queries.ts");

let proximoAluno = 100;

/** Um aluno novo por teste: o teto global de escritas e por aluno e vive no modulo. */
function novoAluno() {
  proximoAluno += 1;
  const id = `55555555-5555-4555-8555-${String(proximoAluno).padStart(12, "0")}`;
  sessao.user = { id };
  return id;
}

function montar(options) {
  resetRoomLimits();
  heartbeatRoute.resetHeartbeatAccessCache();
  const db = bancoFalso({ rpc: { webinar_chat_window: janelaDoChat }, tables: escola(options) });
  actionStubs.db = db;
  const userId = novoAluno();
  db.tables.profiles.push({ avatar_url: null, created_at: iso(Date.now()), email: "ana@bunker707.test", full_name: "Ana Maria Souza", id: userId, last_sign_in_at: null, phone: null });
  return { db, userId };
}

const contexto = (id = WEBINAR) => ({ params: Promise.resolve({ id }) });
const pedido = (path, method = "GET", body, headers = {}) =>
  new Request(`http://localhost/api/webinars/${path}`, body === undefined ? { headers, method } : { body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers }, method });
const json = async (response) => ({ body: await response.json(), status: response.status });
const eventos = (db, type) => db.tables.student_events.filter((row) => row.event_type === type);

async function enviar(body, extra = {}) {
  return json(await chatRoute.POST(pedido(`${WEBINAR}/chat`, "POST", { sessionId: SESSION, ...body }), contexto(extra.webinarId ?? WEBINAR)));
}

const comAceite = { consent: true, consentVersion: CHAT_CONSENT_VERSION };

/* ------------------------------------------------------------------------------------------------
 * Guardas comuns
 * ---------------------------------------------------------------------------------------------- */

test("guardas: 401 sem sessao, 400 sem id, 404 fora do acesso e para sessao de outro webinario, 400 janela invalida", async () => {
  montar();
  sessao.user = null;
  assert.equal((await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&from=0&to=1000`), contexto())).status, 401);
  assert.equal((await heartbeatRoute.POST(pedido(`${WEBINAR}/heartbeat`, "POST", { offsetSeconds: 0, sessionId: SESSION }), contexto())).status, 401);
  novoAluno();
  assert.equal((await chatRoute.GET(pedido(`nao-e-id/chat?sessao=${SESSION}&from=0&to=1000`), contexto("nao-e-id"))).status, 400);
  const outra = await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${OTHER_SESSION}&from=0&to=1000`), contexto()));
  assert.equal(outra.status, 404, "sessao de outro webinario");
  const janela = await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&from=0&to=${16 * MIN}`), contexto());
  assert.equal(janela.status, 400, "mais de 15 min");
  assert.equal((await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}`), contexto())).status, 400, "nem janela nem cursor");

  // Quem pode so com o produto e nao tem acesso: 404 sem dizer se existe.
  const { db } = montar({ accessMode: "product" });
  const semAcesso = await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&from=0&to=1000`), contexto()));
  assert.equal(semAcesso.status, 404);
  assert.ok(db.calls.from.includes("entitlements"), "leu os acessos do aluno");
});

/* ------------------------------------------------------------------------------------------------
 * Chat
 * ---------------------------------------------------------------------------------------------- */

test("janela do chat: a linha mestre vem deslocada pela ancora (100 s na live = 95 s no video) e a pendente so para o autor; a consulta de mensagens novas devolve o cursor", async () => {
  const { db, userId } = montar();
  db.tables.webinar_chat_messages.push(
    { approved: false, author_user_id: userId, body: "minha pendente", created_at: iso(Date.now() - 1000), deleted_at: null, display_name: "Ana S.", id: "cccccccc-aaaa-4000-8000-000000000002", kind: "message", master: false, offset_ms: 96_000, pinned_at: null, reply_to_id: null, role: "student", script_item_id: null, session_id: SESSION, source: "audience", webinar_id: WEBINAR },
    { approved: false, author_user_id: "11111111-1111-4111-8111-111111111112", body: "pendente de outro", created_at: iso(Date.now() - 1000), deleted_at: null, display_name: "Zé", id: "cccccccc-aaaa-4000-8000-000000000003", kind: "message", master: false, offset_ms: 97_000, pinned_at: null, reply_to_id: null, role: "student", script_item_id: null, session_id: SESSION, source: "audience", webinar_id: WEBINAR }
  );
  const janela = await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&from=90000&to=120000`), contexto()));
  assert.equal(janela.status, 200, JSON.stringify(janela.body));
  assert.equal(janela.body.data.mode, "window");
  assert.deepEqual(
    janela.body.data.messages.map((message) => [message.displayName, message.offsetMs, message.pending, message.mine]),
    [
      ["Bia C.", 95_000, false, false],
      ["Ana S.", 96_000, true, true]
    ]
  );
  assert.equal(janela.body.data.messages[0].role, "student");
  assert.ok(!("source" in janela.body.data.messages[0]), "a origem fica so no banco");
  // Na gravada, nenhuma hora gravada (docs/31 V2-9): a da linha mestre diria quando foi a live de origem.
  assert.deepEqual(janela.body.data.messages.map((message) => message.sentAt), [null, null]);

  const desde = iso(Date.now() - 2000);
  const novas = await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&since=${encodeURIComponent(desde)}`), contexto()));
  assert.equal(novas.status, 200, JSON.stringify(novas.body));
  assert.equal(novas.body.data.mode, "recent");
  assert.deepEqual(novas.body.data.messages.map((message) => message.body), ["minha pendente"], "a pendente de outro aluno nao vem");
  assert.equal(novas.body.data.next.after, "cccccccc-aaaa-4000-8000-000000000002");
  const repetida = await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&since=${encodeURIComponent(novas.body.data.next.since)}&after=${novas.body.data.next.after}`), contexto()));
  assert.deepEqual(repetida.body.data.messages, [], "depois do cursor, nada de novo");
  assert.deepEqual(repetida.body.data.next, novas.body.data.next, "o cursor se mantem");
});

test("janela do chat na gravada: nunca passa da janela a frente do relogio do servidor (o chat original de depois de agora fica para depois); no replay, ate onde o aluno pedir", async () => {
  const { db } = montar();
  // A sessao gravada esta no minuto 10 (600 s); a linha mestre do minuto 15 (900 s no video) ainda nao pode sair.
  db.tables.webinar_chat_messages.push({ approved: true, author_user_id: "11111111-1111-4111-8111-111111111111", body: "spoiler do minuto 15", created_at: iso(Date.now() - 30 * 24 * HOUR), deleted_at: null, display_name: "Bia C.", id: "cccccccc-aaaa-4000-8000-00000000000f", kind: "message", master: true, offset_ms: 905_000, pinned_at: null, reply_to_id: null, role: "student", script_item_id: null, session_id: LIVE_SOURCE, source: "original", webinar_id: WEBINAR });
  const adiante = await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&from=590000&to=1400000`), contexto()));
  assert.equal(adiante.status, 200, JSON.stringify(adiante.body));
  assert.deepEqual(adiante.body.data.messages.map((message) => message.body), [], "nada do minuto 15 agora");
  const ate = adiante.body.data.window.toMs;
  assert.ok(ate >= 600_000 + 120_000 && ate <= 600_000 + 120_000 + 15_000, `a janela devolvida para no relogio do servidor + 120 s (${ate})`);
  assert.equal(adiante.body.data.window.fromMs, 590_000);

  const depois = await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&from=880000&to=920000`), contexto()));
  assert.deepEqual(depois.body.data.messages, [], "pedida toda depois do limite, vazia");
  assert.deepEqual(depois.body.data.window, { fromMs: 880_000, toMs: 879_999 }, "a seguinte recomeca do mesmo ponto");

  const replay = await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${REPLAY}&from=880000&to=920000`), contexto()));
  assert.deepEqual(replay.body.data.messages.map((message) => message.body), ["spoiler do minuto 15"], "no replay o aluno pula pelo video");
  assert.equal(replay.body.data.messages[0].sentAt, null, "a linha mestre de 30 dias atras nao leva a data ao navegador");
  assert.deepEqual(replay.body.data.window, { fromMs: 880_000, toMs: 920_000 });
});

test("POST chat: a primeira exige o aceite (409 consent_required); com ele grava o aceite, o nome exibido (primeiro nome e inicial) e os registros; o offset e o do servidor", async () => {
  const { db, userId } = montar({ scheduledAt: Date.now() - 90_000 });
  const semAceite = await enviar({ body: "oi" });
  assert.equal(semAceite.status, 409);
  assert.equal(semAceite.body.reason, "consent_required");
  assert.equal(db.tables.webinar_chat_messages.filter((row) => row.author_user_id === userId).length, 0);

  const versaoErrada = await enviar({ body: "oi", consent: true, consentVersion: CHAT_CONSENT_VERSION + 1 });
  assert.equal(versaoErrada.status, 409);

  const primeira = await enviar({ body: "  oi, turma  ", offsetMs: 5, ...comAceite });
  assert.equal(primeira.status, 201, JSON.stringify(primeira.body));
  assert.equal(primeira.body.data.pending, false);
  assert.equal(primeira.body.data.message.displayName, "Ana S.", "primeiro nome e inicial");
  assert.equal(primeira.body.data.message.body, "oi, turma");
  assert.equal(primeira.body.data.message.mine, true);
  assert.ok(primeira.body.data.message.offsetMs >= 89_000 && primeira.body.data.message.offsetMs <= 95_000, `offset do servidor (${primeira.body.data.message.offsetMs}), nunca o 5 do corpo`);
  const linha = db.tables.webinar_chat_messages.find((row) => row.author_user_id === userId);
  assert.equal(linha.source, "audience");
  assert.equal(linha.master, false);
  assert.equal(linha.role, "student");
  assert.deepEqual(db.tables.webinar_chat_consents.map((row) => [row.user_id, row.consent_version, row.display_mode, row.nickname, row.revoked_at]), [[userId, CHAT_CONSENT_VERSION, "first_name_initial", null, null]]);
  assert.deepEqual(
    db.tables.student_events.map((row) => [row.event_type, row.entity_type, row.entity_id, row.metadata]),
    [
      // D64: o historico nao guarda mais a escolha de como aparecer (nao ha escolha).
      ["webinar_chat_consented", "webinar", SESSION, { consent_version: CHAT_CONSENT_VERSION }],
      ["webinar_chat_sent", "webinar", SESSION, { kind: "message", length: 9, message_id: linha.id, offset_ms: linha.offset_ms }]
    ]
  );
  assert.ok(!JSON.stringify(db.tables.student_events).includes("oi, turma"), "nunca o texto no historico");

  const segunda = await enviar({ body: "de novo, sem repetir o aceite" });
  assert.equal(segunda.status, 201);
  assert.equal(eventos(db, "webinar_chat_consented").length, 1, "o aceite nao se repete");
});

test("POST chat: a pergunta pelo chat abre a linha em webinar_questions com o nome do aluno e anonymous falso; os campos antigos inofensivos de uma pagina antiga passam e sao ignorados", async () => {
  const { db, userId } = montar();
  // A pagina antiga de quem tinha escolhido "Primeiro nome e inicial" manda displayMode e anonymous: false: nada muda.
  const primeira = await enviar({ anonymous: false, body: "oi", displayMode: "first_name_initial", ...comAceite });
  assert.equal(primeira.status, 201, JSON.stringify(primeira.body));
  assert.equal(primeira.body.data.message.displayName, "Ana S.");
  assert.deepEqual(db.tables.webinar_chat_consents.map((row) => [row.display_mode, row.nickname]), [["first_name_initial", null]]);
  const pergunta = await enviar({ body: "e quando sai o modulo 2?", kind: "question" });
  assert.equal(pergunta.status, 201, JSON.stringify(pergunta.body));
  assert.equal(pergunta.body.data.message.kind, "question");
  assert.equal(pergunta.body.data.message.displayName, "Ana S.");
  const linhaDaPergunta = db.tables.webinar_questions[0];
  assert.equal(linhaDaPergunta.message_id, pergunta.body.data.message.id);
  assert.equal(linhaDaPergunta.display_name, "Ana S.");
  assert.equal(linhaDaPergunta.anonymous, false);
  assert.equal(linhaDaPergunta.user_id, userId);
  // D64: o historico da pergunta nao leva mais a chave `anonymous`.
  assert.deepEqual(eventos(db, "webinar_question_sent")[0].metadata, { offset_ms: linhaDaPergunta.offset_ms, question_id: linhaDaPergunta.id });
  assert.ok(!db.tables.webinar_chat_messages.some((row) => /^Aluno \d{3}$/.test(row.display_name)), "nenhuma mensagem nova com Aluno {n}");
});

/** Os tres pedidos que uma pagina aberta com o codigo de antes de 10/11/2026 ainda pode mandar (D64). */
const PEDIDOS_ANTIGOS = [
  ["anonymous: true", { anonymous: true }],
  ["displayMode anonymous", { displayMode: "anonymous" }],
  ["displayMode nickname com o apelido", { displayMode: "nickname", nickname: "aninha" }]
];

/** Nada gravado pelo aluno: nem mensagem, nem pergunta, nem resposta, nem aceite, nem historico. */
function nadaGravado(db, userId, onde) {
  assert.equal(db.tables.webinar_chat_messages.filter((row) => row.author_user_id === userId).length, 0, `${onde}: nenhuma mensagem`);
  assert.equal(db.tables.webinar_questions.filter((row) => row.user_id === userId && row.status === "open").length, 0, `${onde}: nenhuma pergunta`);
  assert.equal(db.tables.webinar_question_replies.filter((row) => row.user_id === userId).length, 0, `${onde}: nenhuma resposta`);
  assert.equal(db.tables.webinar_chat_consents.filter((row) => row.user_id === userId).length, 0, `${onde}: nenhum aceite`);
  assert.equal(db.tables.student_events.filter((row) => row.user_id === userId).length, 0, `${onde}: nenhum registro no historico`);
}

test("D64, pagina antiga no chat: anonymous true, displayMode anonymous e apelido respondem 400 com a frase de atualizar a pagina; nada e gravado e a recusa nao gasta a rajada nem o modo lento", async () => {
  // Modo lento de 30 s: se a recusa segurasse a vez, a mensagem valida logo depois seria 429.
  const { db, userId } = montar({ slowMode: 30 });
  // Seis recusas (a rajada e de 5 por 60 s): se contassem, a valida seria 429.
  for (const rodada of [1, 2]) {
    for (const [nome, campos] of PEDIDOS_ANTIGOS) {
      const recusada = await enviar({ body: "quem sou eu?", ...campos, ...comAceite });
      assert.equal(recusada.status, 400, `${nome} (${rodada}): ${JSON.stringify(recusada.body)}`);
      assert.equal(recusada.body.error, CHAT_MESSAGES.identity);
      assert.match(recusada.body.error, /anônima ou com apelido não está mais disponível\. Atualize a página/);
      nadaGravado(db, userId, nome);
    }
  }
  // A pergunta pelo chat da pagina antiga tambem: nem a mensagem nem a linha em webinar_questions.
  const pergunta = await enviar({ anonymous: true, body: "e o modulo 2?", kind: "question", ...comAceite });
  assert.equal(pergunta.status, 400);
  nadaGravado(db, userId, "pergunta pelo chat");

  const valida = await enviar({ body: "agora com o meu nome", ...comAceite });
  assert.equal(valida.status, 201, `a recusa nao gastou a rajada nem o modo lento: ${JSON.stringify(valida.body)}`);
  assert.equal(valida.body.data.message.displayName, "Ana S.");
  assert.deepEqual(db.tables.webinar_chat_consents.map((row) => [row.user_id, row.display_mode, row.nickname]), [[userId, "first_name_initial", null]]);

  // Com o aceite ja em dia, a pagina antiga que insiste no anonimo continua recusada (nunca publica com o nome sem avisar).
  const { db: comAceiteEmDia, userId: outro } = montar();
  assert.equal((await enviar({ body: "oi", ...comAceite })).status, 201);
  const insistiu = await enviar({ anonymous: true, body: "isto era para ser anonimo" });
  assert.equal(insistiu.status, 400);
  assert.equal(insistiu.body.error, CHAT_MESSAGES.identity);
  assert.deepEqual(comAceiteEmDia.tables.webinar_chat_messages.filter((row) => row.author_user_id === outro).map((row) => row.body), ["oi"], "a mensagem pedida como anonima nao foi publicada");
});

test("D64, pagina antiga nas Perguntas e no fio: os tres pedidos respondem 400; nenhuma pergunta, resposta, aceite ou registro; as duas perguntas e a resposta validas de depois passam", async () => {
  const { db, userId } = montar();
  const perguntar = (body) => questionsRoute.POST(pedido(`${WEBINAR}/questions`, "POST", { sessionId: SESSION, ...body }), contexto());
  for (const [nome, campos] of PEDIDOS_ANTIGOS) {
    const recusada = await json(await perguntar({ body: "Vai ter certificado?", ...campos, ...comAceite }));
    assert.equal(recusada.status, 400, `${nome}: ${JSON.stringify(recusada.body)}`);
    assert.equal(recusada.body.error, CHAT_MESSAGES.identity);
    nadaGravado(db, userId, `pergunta, ${nome}`);
  }
  // O teto e de 2 perguntas por minuto: as tres recusas nao contaram.
  const primeira = await json(await perguntar({ body: "Vai ter certificado?", ...comAceite }));
  assert.equal(primeira.status, 201, JSON.stringify(primeira.body));
  assert.equal((await perguntar({ anonymous: false, body: "E a apostila?" })).status, 201, "a segunda do minuto ainda cabe");
  assert.deepEqual(db.tables.webinar_questions.map((row) => [row.anonymous, row.display_name]), [[false, "Ana S."], [false, "Ana S."]]);

  // O fio: a pergunta do aluno ja respondida pela equipe; a pagina antiga responde pedindo anonimo ou apelido.
  const { db: fio, userId: dono } = montar();
  const QUESTION = randomUUID();
  fio.tables.webinar_questions.push({ anonymous: false, answer_text: "Sim!", answered_at: iso(Date.now() - 1000), body: "Tem certificado?", created_at: iso(Date.now() - 5000), deleted_at: null, display_name: "Ana S.", id: QUESTION, offset_ms: 0, session_id: SESSION, status: "answered", upvotes: 0, user_id: dono });
  const responder = async (body) => json(await repliesRoute.POST(pedido(`${WEBINAR}/questions/${QUESTION}/replies`, "POST", { sessionId: SESSION, ...body }), { params: Promise.resolve({ id: WEBINAR, qid: QUESTION }) }));
  // Seis recusas (o fio aceita 5 respostas por 60 s): se contassem, a valida seria 429.
  for (const rodada of [1, 2]) {
    for (const [nome, campos] of PEDIDOS_ANTIGOS) {
      const recusada = await responder({ body: "obrigada", ...campos, ...comAceite });
      assert.equal(recusada.status, 400, `${nome} (${rodada}): ${JSON.stringify(recusada.body)}`);
      assert.equal(recusada.body.error, CHAT_MESSAGES.identity);
      assert.equal(fio.tables.webinar_question_replies.length, 0, `${nome}: nenhuma resposta`);
      assert.equal(fio.tables.webinar_chat_consents.length, 0, `${nome}: nenhum aceite`);
      assert.equal(fio.tables.student_events.length, 0, `${nome}: nenhum registro`);
    }
  }
  const valida = await responder({ body: "obrigada", ...comAceite });
  assert.equal(valida.status, 201, JSON.stringify(valida.body));
  assert.equal(valida.body.data.reply.displayName, "Ana S.");
  assert.equal(valida.body.data.reply.anonymous, false);
  assert.deepEqual(fio.tables.webinar_question_replies.map((row) => [row.anonymous, row.display_name, row.user_id]), [[false, "Ana S.", dono]]);
  assert.deepEqual(fio.tables.webinar_chat_consents.map((row) => [row.display_mode, row.nickname]), [["first_name_initial", null]]);
});

test("D64, o aceite antigo com anonimo ou apelido (na versao de agora) conta como sem aceite: a sessao diz consented false, as escritas pedem o aceite (409), a foto aparece para outro aluno assim mesmo (D115: a foto nao depende do aceite), e aceitar de novo grava first_name_initial sem apelido", async () => {
  // So a foto enviada pelo Perfil aparece na sala (avatars/{id}/arquivo, pela origem do nosso Supabase: roomPhotoUrl).
  const origemAntes = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto.supabase.co";
  try {
    for (const [modo, apelido, nomeAntigo] of [
      ["nickname", "aninha", "aninha"],
      ["anonymous", null, "Aninha das Antigas"]
    ]) {
      const { db, userId } = montar();
      const FOTO = `https://projeto.supabase.co/storage/v1/object/public/content-assets/avatars/${userId}/ana.webp`;
      db.tables.profiles.find((row) => row.id === userId).avatar_url = FOTO;
      db.tables.webinar_chat_consents.push({ consent_version: CHAT_CONSENT_VERSION, consented_at: iso(Date.now() - HOUR), created_at: iso(Date.now() - HOUR), display_mode: modo, nickname: apelido, revoked_at: null, updated_at: iso(Date.now() - HOUR), user_id: userId });
      // Uma mensagem de antes, com o nome gravado na epoca (nao e o "Aluno {n}", que nunca leva foto de qualquer jeito).
      const ANTIGA = randomUUID();
      db.tables.webinar_chat_messages.push({ approved: true, author_user_id: userId, body: "de antes", created_at: iso(Date.now() - 1000), deleted_at: null, display_name: nomeAntigo, id: ANTIGA, kind: "message", master: false, offset_ms: 96_000, pinned_at: null, reply_to_id: null, role: "student", script_item_id: null, session_id: SESSION, source: "audience", webinar_id: WEBINAR });
      const QUESTION = randomUUID();
      db.tables.webinar_questions.push({ anonymous: false, answer_text: "Sim!", answered_at: iso(Date.now() - 1000), body: "Tem certificado?", created_at: iso(Date.now() - 5000), deleted_at: null, display_name: nomeAntigo, id: QUESTION, offset_ms: 0, session_id: SESSION, status: "answered", upvotes: 0, user_id: userId });

      const sessaoAntes = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${SESSION}`), contexto()));
      assert.equal(sessaoAntes.body.data.me.consented, false, `${modo}: a sala mostra a caixa do aceite de novo`);
      // O nome do campo (D82) e o de verdade, nunca o apelido nem o nome guardado no aceite antigo.
      assert.equal(sessaoAntes.body.data.me.displayName, "Ana S.");
      assert.equal(sessaoAntes.body.data.me.avatarUrl, FOTO, `${modo}: a propria foto ao lado do campo, antes do aceite`);

      const semAceite = await enviar({ body: "oi" });
      assert.equal(semAceite.status, 409, `${modo}: ${JSON.stringify(semAceite.body)}`);
      assert.equal(semAceite.body.reason, "consent_required");
      const perguntaSemAceite = await json(await questionsRoute.POST(pedido(`${WEBINAR}/questions`, "POST", { body: "E a apostila?", sessionId: SESSION }), contexto()));
      assert.equal(perguntaSemAceite.status, 409);
      assert.equal(perguntaSemAceite.body.reason, "consent_required");
      const respostaSemAceite = await json(await repliesRoute.POST(pedido(`${WEBINAR}/questions/${QUESTION}/replies`, "POST", { body: "obrigada", sessionId: SESSION }), { params: Promise.resolve({ id: WEBINAR, qid: QUESTION }) }));
      assert.equal(respostaSemAceite.status, 409);
      assert.equal(respostaSemAceite.body.reason, "consent_required");
      assert.equal(db.tables.webinar_chat_messages.filter((row) => row.author_user_id === userId).length, 1, "so a mensagem de antes");
      assert.equal(db.tables.webinar_question_replies.length, 0);
      assert.equal(db.tables.webinar_chat_consents[0].display_mode, modo, "a linha antiga continua como estava ate o aluno aceitar de novo");

      // Outro aluno le o chat: a foto de quem tem o aceite antigo aparece (D115, 13/11/2026: a foto do Perfil nao depende do aceite).
      const autor = sessao.user;
      sessao.user = { id: `66666666-6666-4666-8666-${userId.slice(-12)}` };
      const ler = async (from, to) => (await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&from=${from}&to=${to}`), contexto()))).body.data.messages;
      const antes = (await ler(90_000, 120_000)).find((message) => message.id === ANTIGA);
      assert.equal(antes.displayName, nomeAntigo, "o que ja foi escrito aparece como foi gravado");
      assert.equal(antes.avatarUrl, FOTO, `${modo}: sem o aceite em dia, a foto do Perfil aparece para os outros alunos`);

      // O aluno aceita de novo (o texto de agora): o aceite passa a first_name_initial, sem apelido, e o nome e o dele.
      sessao.user = autor;
      const aceitou = await enviar({ body: "agora com o meu nome", ...comAceite });
      assert.equal(aceitou.status, 201, JSON.stringify(aceitou.body));
      assert.equal(aceitou.body.data.message.displayName, "Ana S.");
      assert.equal(aceitou.body.data.message.avatarUrl, FOTO);
      assert.deepEqual(db.tables.webinar_chat_consents.map((row) => [row.user_id, row.consent_version, row.display_mode, row.nickname, row.revoked_at]), [[userId, CHAT_CONSENT_VERSION, "first_name_initial", null, null]]);
      assert.deepEqual(eventos(db, "webinar_chat_consented").map((row) => row.metadata), [{ consent_version: CHAT_CONSENT_VERSION }]);
      const sessaoDepois = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${SESSION}`), contexto()));
      assert.equal(sessaoDepois.body.data.me.consented, true);
      assert.equal(sessaoDepois.body.data.me.displayName, "Ana S.");

      sessao.user = { id: `66666666-6666-4666-8666-${userId.slice(-12)}` };
      // A sessao comecou ha 10 min: a mensagem nova caiu perto dos 600 s do relogio do servidor.
      const nova = (await ler(aceitou.body.data.message.offsetMs - 10_000, aceitou.body.data.message.offsetMs + 10_000)).find((message) => message.id === aceitou.body.data.message.id);
      assert.equal(nova.avatarUrl, FOTO, `${modo}: com o aceite de agora, a mesma foto para os outros alunos`);
      sessao.user = autor;
    }
  } finally {
    if (origemAntes === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = origemAntes;
  }
});

test("D64, o card Sala antigo (room_settings com anonymousQuestions true e displayName anonymous) nao muda nada: a pergunta e a mensagem saem com Ana S., anonymous falso, e a sessao nao leva a chave", async () => {
  const { db, userId } = montar();
  db.tables.webinars.find((row) => row.id === WEBINAR).room_settings = { anonymousQuestions: true, chatMode: "open", displayName: "anonymous", questions: true };
  const pergunta = await json(await questionsRoute.POST(pedido(`${WEBINAR}/questions`, "POST", { body: "Vai ter certificado?", sessionId: SESSION, ...comAceite }), contexto()));
  assert.equal(pergunta.status, 201, JSON.stringify(pergunta.body));
  assert.equal(pergunta.body.data.question.displayName, "Ana S.");
  assert.equal(pergunta.body.data.question.anonymous, false);
  assert.deepEqual(db.tables.webinar_questions.map((row) => [row.anonymous, row.display_name, row.user_id]), [[false, "Ana S.", userId]]);
  assert.equal(db.tables.webinar_chat_consents[0].display_mode, "first_name_initial", "o aceite nao segue o card antigo");
  const mensagem = await enviar({ body: "oi" });
  assert.equal(mensagem.status, 201);
  assert.equal(mensagem.body.data.message.displayName, "Ana S.");
  const { data } = (await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${SESSION}`), contexto()))).body;
  assert.ok(!("anonymousQuestions" in data.session), "a sala nao recebe mais a opcao Anonima");
  assert.equal(data.me.displayName, "Ana S.");
  // O card "Sempre anonimo" tambem nao segura a pagina antiga: o pedido de anonima continua recusado.
  const antiga = await json(await questionsRoute.POST(pedido(`${WEBINAR}/questions`, "POST", { anonymous: true, body: "posso sem nome?", sessionId: SESSION }), contexto()));
  assert.equal(antiga.status, 400);
  assert.equal(antiga.body.error, CHAT_MESSAGES.identity);
  assert.equal(db.tables.webinar_questions.length, 1);
});

test("POST chat: a pergunta pelo chat aberto com um emoji na casa 500 corta por caractere (questionBodyOf), nunca no meio do emoji; a mensagem do chat fica inteira", async () => {
  const { db } = montar();
  // 601 unidades UTF-16: o emoji ocupa a 500a e a 501a. Cortado por unidade, sobraria a metade dele (o Postgres recusa).
  const corpo = `${"a".repeat(499)}😀${"b".repeat(100)}`;
  const pergunta = await enviar({ body: corpo, kind: "question", ...comAceite });
  assert.equal(pergunta.status, 201, JSON.stringify(pergunta.body));
  const linha = db.tables.webinar_questions.find((row) => row.message_id === pergunta.body.data.message.id);
  assert.ok(linha, "a pergunta abriu a linha em webinar_questions");
  assert.equal(Array.from(linha.body).length, 500, "500 caracteres");
  assert.ok(linha.body.endsWith("😀"), "o emoji inteiro no fim");
  assert.doesNotMatch(linha.body, /[\uD800-\uDBFF]$/, "sem metade de emoji no fim");
  assert.equal(db.tables.webinar_chat_messages.find((row) => row.id === pergunta.body.data.message.id).body, corpo, "a mensagem do chat com o texto todo");
});

test("POST chat: fora da hora e do modo (409 not_started / ended / chat_off / team_only); o replay sempre aceita e grava o offset do corpo", async () => {
  montar({ scheduledAt: Date.now() + HOUR });
  assert.equal((await enviar({ body: "cedo", ...comAceite })).body.reason, "not_started");
  montar({ scheduledAt: Date.now() - 2 * HOUR });
  assert.equal((await enviar({ body: "tarde", ...comAceite })).body.reason, "ended");
  montar({ status: "ended" });
  assert.equal((await enviar({ body: "encerrada pela equipe", ...comAceite })).body.reason, "ended");
  montar({ chatMode: "off" });
  const desligado = await enviar({ body: "x", ...comAceite });
  assert.equal(desligado.status, 409);
  assert.equal(desligado.body.reason, "chat_off");
  montar({ chatMode: "team_only" });
  assert.equal((await enviar({ body: "x", ...comAceite })).body.reason, "team_only");

  const { db } = montar();
  const replay = await json(await chatRoute.POST(pedido(`${WEBINAR}/chat`, "POST", { body: "no replay", offsetMs: 42_000, sessionId: REPLAY, ...comAceite }), contexto()));
  assert.equal(replay.status, 201, JSON.stringify(replay.body));
  assert.equal(replay.body.data.message.offsetMs, 42_000, "a posicao do player que veio no corpo");
  assert.equal(db.tables.webinar_chat_messages.at(-1).session_id, REPLAY);
});

test("POST chat: rajada 5/60 s (a 6a e 429 com Retry-After), modo lento 429, palavra bloqueada 422, moderado grava approved = false e devolve pending", async () => {
  montar();
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await enviar({ body: `m${i}`, ...comAceite })).status, 201, `mensagem ${i + 1}`);
  }
  const sexta = await chatRoute.POST(pedido(`${WEBINAR}/chat`, "POST", { body: "m6", sessionId: SESSION }), contexto());
  assert.equal(sexta.status, 429);
  assert.match(sexta.headers.get("Retry-After") ?? "", /^\d+$/);

  montar({ slowMode: 20 });
  assert.equal((await enviar({ body: "primeira", ...comAceite })).status, 201);
  const lenta = await chatRoute.POST(pedido(`${WEBINAR}/chat`, "POST", { body: "segunda", sessionId: SESSION }), contexto());
  assert.equal(lenta.status, 429);
  const espera = Number(lenta.headers.get("Retry-After"));
  assert.ok(espera >= 1 && espera <= 20, `Retry-After do modo lento (${espera})`);
  assert.match((await lenta.json()).error, /enviar de novo em \d+ s/);

  const { db } = montar();
  const bloqueada = await enviar({ body: "isso é um PALAVRÃO feio", ...comAceite });
  assert.equal(bloqueada.status, 422);
  assert.equal(bloqueada.body.error, "Sem isso aqui.");
  assert.equal(db.tables.webinar_chat_messages.filter((row) => row.source === "audience").length, 0, "recusada antes de gravar");

  const { db: moderado, userId } = montar({ chatMode: "moderated" });
  const pendente = await enviar({ body: "espera a equipe", ...comAceite });
  assert.equal(pendente.status, 201);
  assert.equal(pendente.body.data.pending, true);
  assert.equal(pendente.body.data.message.pending, true);
  assert.equal(moderado.tables.webinar_chat_messages.find((row) => row.author_user_id === userId).approved, false);
  const perguntaPendente = await enviar({ body: "e o certificado?", kind: "question" });
  assert.equal(perguntaPendente.status, 201);
  assert.equal(moderado.tables.webinar_questions.length, 0, "a pergunta pendente so entra na aba quando a equipe libera");
  assert.equal(eventos(moderado, "webinar_question_sent").length, 0);
});

test("POST chat: dois pedidos juntos no modo lento passam um so; a mensagem recusada (palavra bloqueada) devolve a vez", async () => {
  montar({ slowMode: 20 });
  const juntos = await Promise.all([enviar({ body: "um", ...comAceite }), enviar({ body: "dois", ...comAceite })]);
  assert.deepEqual(juntos.map((item) => item.status).sort(), [201, 429], "o modo lento reserva a vez antes de qualquer espera");

  const { db } = montar({ slowMode: 20 });
  assert.equal((await enviar({ body: "isso é um palavrão", ...comAceite })).status, 422);
  const depois = await enviar({ body: "agora sim" });
  assert.equal(depois.status, 201, "a recusada nao conta para o modo lento");
  assert.equal(db.tables.webinar_chat_messages.filter((row) => row.source === "audience").length, 1);
});

test("DELETE chat { all: true }: apaga (soft, consent_revoked) mensagens, perguntas e respostas de enquete de todas as sessoes, retira o aceite e grava revoked; a rota sem id faz o mesmo", async () => {
  const { db, userId } = montar();
  assert.equal((await enviar({ body: "a", ...comAceite })).status, 201);
  assert.equal((await json(await chatRoute.POST(pedido(`${WEBINAR}/chat`, "POST", { body: "b", sessionId: REPLAY }), contexto()))).status, 201);
  db.tables.webinar_questions.push({ anonymous: false, body: "?", created_at: iso(Date.now()), deleted_at: null, display_name: "Ana S.", id: randomUUID(), offset_ms: 0, session_id: SESSION, status: "open", upvotes: 0, user_id: userId });
  db.tables.webinar_poll_answers.push({ created_at: iso(Date.now()), deleted_at: null, id: randomUUID(), offset_ms: 0, option_ids: [randomUUID()], poll_id: randomUUID(), session_id: SESSION, user_id: userId });

  const semCorpo = await chatRoute.DELETE(pedido(`${WEBINAR}/chat`, "DELETE", { all: false }), contexto());
  assert.equal(semCorpo.status, 400);

  const removido = await json(await chatRoute.DELETE(pedido(`${WEBINAR}/chat`, "DELETE", { all: true }), contexto()));
  assert.equal(removido.status, 200, JSON.stringify(removido.body));
  assert.equal(removido.body.data.removed, 4);
  assert.ok(db.tables.webinar_chat_messages.filter((row) => row.author_user_id === userId).every((row) => row.deleted_at && row.deleted_reason === "consent_revoked"));
  assert.equal(db.tables.webinar_chat_messages.find((row) => row.master).deleted_at, null, "a linha mestre de outro aluno fica");
  assert.ok(db.tables.webinar_questions[0].deleted_at);
  assert.ok(db.tables.webinar_poll_answers[0].deleted_at);
  assert.ok(db.tables.webinar_chat_consents[0].revoked_at, "o aceite retirado");
  assert.deepEqual(eventos(db, "webinar_chat_consented").at(-1).metadata, { consent_version: CHAT_CONSENT_VERSION, revoked: true });

  // Depois de revogar, a proxima mensagem pede o aceite de novo.
  assert.equal((await enviar({ body: "de volta" })).body.reason, "consent_required");

  const deNovo = await json(await globalChatRoute.DELETE(pedido("chat", "DELETE", { all: true })));
  assert.equal(deNovo.status, 200);
  assert.equal(deNovo.body.data.removed, 0, "nada mais a remover");
  sessao.user = null;
  assert.equal((await globalChatRoute.DELETE(pedido("chat", "DELETE", { all: true }))).status, 401);
});

/* ------------------------------------------------------------------------------------------------
 * Presenca
 * ---------------------------------------------------------------------------------------------- */

test("heartbeat: o balde pelo offset do servidor (nao o do corpo), webinar_joined no primeiro sinal com o aparelho, samples no mesmo balde, webinar_left no leave, o acesso em cache", async () => {
  const { db, userId } = montar({ scheduledAt: Date.now() - 95_000 });
  const bater = (body, headers) => heartbeatRoute.POST(pedido(`${WEBINAR}/heartbeat`, "POST", { sessionId: SESSION, state: "playing", visible: true, ...body }, headers), contexto());

  const primeiro = await json(await bater({ offsetSeconds: 5 }, { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" }));
  assert.equal(primeiro.status, 200, JSON.stringify(primeiro.body));
  assert.equal(primeiro.body.data.ended, false);
  assert.equal(primeiro.body.data.presentNow, 1);
  assert.ok(primeiro.body.data.offsetMs >= 94_000, "o offset do servidor");
  const amostra = db.tables.webinar_presence_samples[0];
  assert.equal(amostra.bucket, 3, "95 s = balde 3 (30 s cada), nunca o 5 s do corpo");
  assert.equal(amostra.user_id, userId);
  assert.deepEqual(eventos(db, "webinar_joined").map((row) => [row.entity_id, row.metadata]), [[SESSION, { device: "mobile", kind: "simulated" }]]);
  // O primeiro sinal le o webinario duas vezes: o acesso (guardado 10 min) e a chave do numero de pessoas, relida a
  // parte e guardada 15 s por webinario (docs/30 D107: a equipe a muda pelo console com a sessao no ar).
  const leiturasNoPrimeiro = db.calls.from.filter((name) => name === "webinars").length;
  assert.equal(leiturasNoPrimeiro, 2, "o acesso e a chave do numero de pessoas");
  assert.equal(primeiro.body.data.presentHidden, false, "o sinal diz se a equipe escondeu o numero");

  const segundo = await json(await bater({ offsetSeconds: 6 }));
  assert.equal(segundo.status, 200);
  assert.equal(db.tables.webinar_presence_samples.length, 1, "o mesmo balde");
  assert.equal(db.tables.webinar_presence_samples[0].samples, 2);
  assert.equal(eventos(db, "webinar_joined").length, 1, "nao e uma entrada nova");
  const leiturasDoWebinario = db.calls.from.filter((name) => name === "webinars").length;
  assert.equal(leiturasDoWebinario, leiturasNoPrimeiro, "o acesso foi conferido uma vez e a chave lida uma vez: o segundo sinal veio da memoria");

  const saida = await json(await bater({ leave: true, offsetSeconds: 7, state: "hidden", visible: false }));
  assert.equal(saida.status, 200);
  const left = eventos(db, "webinar_left");
  assert.equal(left.length, 1);
  assert.deepEqual(left[0].metadata, { kind: "simulated", reason: "closed", seconds_present: 30 });

  // Outro aluno: mais um presente; o replay grava webinar_replay_started no primeiro sinal.
  novoAluno();
  const outro = await json(await bater({ offsetSeconds: 0 }));
  assert.equal(outro.body.data.presentNow, 2);
  const replay = await json(await heartbeatRoute.POST(pedido(`${WEBINAR}/heartbeat`, "POST", { offsetSeconds: 1230, sessionId: REPLAY, state: "playing", visible: true }), contexto()));
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.data.offsetMs, null, "o replay nao tem relogio");
  assert.equal(db.tables.webinar_presence_samples.find((row) => row.session_id === REPLAY).bucket, 41, "1230 s = balde 41, pela posicao do player");
  assert.deepEqual(eventos(db, "webinar_replay_started").map((row) => row.metadata), [{ recording_id: RECORDING }]);

  const corpoRuim = await heartbeatRoute.POST(pedido(`${WEBINAR}/heartbeat`, "POST", { sessionId: SESSION }), contexto());
  assert.equal(corpoRuim.status, 400);
});

/* ------------------------------------------------------------------------------------------------
 * Reacoes, perguntas e enquetes
 * ---------------------------------------------------------------------------------------------- */

test("reacoes: 201 com o registro; a segunda no mesmo segundo e 429 (Retry-After 1); a 21a no minuto e 429 (60); as contagens dos ultimos 10 s", async () => {
  const { db, userId } = montar();
  const reagir = (reaction) => reactionsRoute.POST(pedido(`${WEBINAR}/reactions`, "POST", { reaction, sessionId: SESSION }), contexto());
  const primeira = await json(await reagir("clap"));
  assert.equal(primeira.status, 201, JSON.stringify(primeira.body));
  assert.equal(db.tables.webinar_reactions.length, 1);
  assert.deepEqual(eventos(db, "webinar_reaction_sent")[0].metadata, { offset_ms: db.tables.webinar_reactions[0].offset_ms, reaction: "clap" });

  const seguida = await reagir("fire");
  assert.equal(seguida.status, 429);
  assert.equal(seguida.headers.get("Retry-After"), "1");

  // 20 reacoes espalhadas no ultimo minuto (nenhuma no ultimo segundo), gravadas por outra instancia do app: a
  // memoria desta nao as viu (zerada), o banco segura a 21a.
  db.tables.webinar_reactions.length = 0;
  resetRoomLimits();
  // De 50 s a 2,5 s atras, a cada 2,5 s: 3 delas (17, 18 e 19) caem nos ultimos 10 s.
  for (let i = 0; i < 20; i += 1) {
    db.tables.webinar_reactions.push({ created_at: iso(Date.now() - 50_000 + i * 2500), id: randomUUID(), offset_ms: 0, reaction: "like", session_id: SESSION, user_id: userId });
  }
  const vigesimaPrimeira = await reagir("wow");
  assert.equal(vigesimaPrimeira.status, 429);
  assert.equal(vigesimaPrimeira.headers.get("Retry-After"), "60");

  db.tables.webinar_reactions.push({ created_at: iso(Date.now() - 3000), id: randomUUID(), offset_ms: 0, reaction: "love", session_id: SESSION, user_id: "11111111-1111-4111-8111-111111111111" });
  const contagens = await json(await reactionsRoute.GET(pedido(`${WEBINAR}/reactions?sessao=${SESSION}`), contexto()));
  assert.equal(contagens.status, 200);
  assert.equal(contagens.body.data.counts.love, 1);
  assert.ok(contagens.body.data.counts.like >= 2 && contagens.body.data.counts.like <= 4, `as dos ultimos 10 s (${contagens.body.data.counts.like})`);
  const invalida = await reactionsRoute.POST(pedido(`${WEBINAR}/reactions`, "POST", { reaction: "banana", sessionId: SESSION }), contexto());
  assert.equal(invalida.status, 400);

  // Duas reacoes no mesmo instante: a memoria reserva antes da contagem no banco, entao so uma passa.
  const { db: outra } = montar();
  const juntas = await Promise.all([reagir("clap"), reagir("fire")]);
  assert.deepEqual(juntas.map((response) => response.status).sort(), [201, 429]);
  assert.equal(outra.tables.webinar_reactions.length, 1);
});

test("perguntas: 201 com o nome do aluno e anonymous falso, a 3a no minuto e 429; a lista com mine e voted, a dispensada so para o autor, a ordem; o voto alterna e reconta", async () => {
  const { db, userId } = montar();
  const perguntar = (body) => questionsRoute.POST(pedido(`${WEBINAR}/questions`, "POST", { sessionId: SESSION, ...body }), contexto());
  // Sem o aceite do chat, nada com o nome do aluno (D10): 409 consent_required, nada gravado, a rajada nao conta.
  const semAceite = await json(await perguntar({ body: "Vai ter certificado?" }));
  assert.equal(semAceite.status, 409);
  assert.equal(semAceite.body.reason, "consent_required");
  assert.equal(db.tables.webinar_questions.length, 0);
  const primeira = await json(await perguntar({ body: "Vai ter certificado?", ...comAceite }));
  assert.equal(primeira.status, 201, JSON.stringify(primeira.body));
  assert.equal(primeira.body.data.question.displayName, "Ana S.", "a pergunta sai com o primeiro nome e a inicial (D64)");
  assert.equal(primeira.body.data.question.anonymous, false);
  assert.equal(primeira.body.data.question.mine, true);
  assert.equal(db.tables.webinar_questions[0].anonymous, false);
  assert.equal(db.tables.webinar_questions[0].display_name, "Ana S.");
  assert.deepEqual(eventos(db, "webinar_question_sent")[0].metadata, { offset_ms: db.tables.webinar_questions[0].offset_ms, question_id: db.tables.webinar_questions[0].id });
  assert.deepEqual([db.tables.webinar_chat_consents[0].display_mode, db.tables.webinar_chat_consents[0].nickname], ["first_name_initial", null]);
  assert.equal(eventos(db, "webinar_chat_consented").length, 1, "o aceite veio com a pergunta");
  const segunda = await json(await perguntar({ anonymous: false, body: "E a apostila?" }));
  assert.equal(segunda.status, 201);
  assert.equal(segunda.body.data.question.displayName, "Ana S.", "com o aceite, o nome como no chat");
  // As duas podem cair no mesmo milissegundo do banco falso: a primeira fica 2 s antes para a ordem "mais recentes".
  db.tables.webinar_questions.find((row) => row.body === "Vai ter certificado?").created_at = iso(Date.now() - 2000);
  assert.equal((await perguntar({ anonymous: false, body: "terceira" })).status, 429);

  const deOutro = "11111111-1111-4111-8111-111111111113";
  db.tables.webinar_questions.push(
    { anonymous: false, body: "respondida", created_at: iso(Date.now() - 5000), deleted_at: null, display_name: "Zé", id: randomUUID(), offset_ms: 0, session_id: SESSION, status: "answered", answer_text: "Sim!", answered_live: false, upvotes: 7, user_id: deOutro },
    { anonymous: false, body: "dispensada de outro", created_at: iso(Date.now() - 4000), deleted_at: null, display_name: "Zé", id: randomUUID(), offset_ms: 0, session_id: SESSION, status: "dismissed", upvotes: 0, user_id: deOutro }
  );
  const votadas = await json(await questionsRoute.GET(pedido(`${WEBINAR}/questions?sessao=${SESSION}&ordem=votadas`), contexto()));
  assert.equal(votadas.status, 200, JSON.stringify(votadas.body));
  assert.deepEqual(
    votadas.body.data.questions.map((question) => [question.body, question.status, question.mine, question.voted]),
    [
      ["respondida", "answered", false, false],
      ["Vai ter certificado?", "open", true, false],
      ["E a apostila?", "open", true, false]
    ],
    "a dispensada de outro aluno some"
  );
  assert.equal(votadas.body.data.questions[0].answerText, "Sim!");

  const alvo = votadas.body.data.questions[0].id;
  const votar = async () => json(await voteRoute.POST(pedido(`${WEBINAR}/questions/${alvo}/vote`, "POST", { sessionId: SESSION }), { params: Promise.resolve({ id: WEBINAR, qid: alvo }) }));
  const votou = await votar();
  assert.deepEqual(votou.body.data, { upvotes: 1, voted: true }, "recontado pelos votos de verdade");
  assert.deepEqual((await votar()).body.data, { upvotes: 0, voted: false });
  const lista = await json(await questionsRoute.GET(pedido(`${WEBINAR}/questions?sessao=${SESSION}&ordem=recentes`), contexto()));
  assert.equal(lista.body.data.questions[0].body, "E a apostila?", "mais recentes primeiro");
  const outraSessao = await voteRoute.POST(pedido(`${WEBINAR}/questions/${alvo}/vote`, "POST", { sessionId: REPLAY }), { params: Promise.resolve({ id: WEBINAR, qid: alvo }) });
  assert.equal(outraSessao.status, 404, "pergunta de outra sessao");
  const dispensada = db.tables.webinar_questions.find((row) => row.status === "dismissed").id;
  const naDispensada = await voteRoute.POST(pedido(`${WEBINAR}/questions/${dispensada}/vote`, "POST", { sessionId: SESSION }), { params: Promise.resolve({ id: WEBINAR, qid: dispensada }) });
  assert.equal(naDispensada.status, 404, "a dispensada de outro aluno nao aparece, nem para curtir");
  assert.equal(db.tables.webinar_question_votes.length, 0);
  assert.equal(db.tables.webinar_questions.filter((row) => row.user_id === userId).length, 2);

  // A pergunta anonima nao existe mais (D64): o pedido da pagina antiga e 400 e nunca grava com o nome sem avisar.
  const { db: semAnonimas } = montar();
  const desligada = await json(await perguntar({ anonymous: true, body: "posso sem nome?", ...comAceite }));
  assert.equal(desligada.status, 400);
  assert.equal(desligada.body.error, CHAT_MESSAGES.identity);
  assert.equal(semAnonimas.tables.webinar_questions.length, 0);
  assert.equal(semAnonimas.tables.webinar_chat_consents.length, 0);

  // Curtir fora da hora da sessao (a gravada acabou): 409 ended.
  const { db: encerrada } = montar({ scheduledAt: Date.now() - 2 * HOUR });
  const antiga = randomUUID();
  encerrada.tables.webinar_questions.push({ anonymous: false, body: "antiga", created_at: iso(Date.now() - HOUR), deleted_at: null, display_name: "Zé", id: antiga, offset_ms: 0, session_id: SESSION, status: "open", upvotes: 0, user_id: deOutro });
  const tarde = await json(await voteRoute.POST(pedido(`${WEBINAR}/questions/${antiga}/vote`, "POST", { sessionId: SESSION }), { params: Promise.resolve({ id: WEBINAR, qid: antiga }) }));
  assert.equal(tarde.status, 409);
  assert.equal(tarde.body.reason, "ended");
  assert.equal(encerrada.tables.webinar_question_votes.length, 0);
});

test("enquetes: a aberta com myOptionIds nulo; 201 na resposta; a segunda e 409; encerrada 409 poll_closed; opcao invalida 400; o resultado so compartilhado", async () => {
  const { db } = montar();
  const poll = (id, extra = {}) => ({ anonymous: false, closed_at: null, created_at: iso(Date.now()), created_by: null, id, kind: "single", open_offset_ms: 0, opened_at: iso(Date.now()), position: 0, question: "Gostou?", results_shared_at: null, session_id: SESSION, status: "open", template_poll_id: null, updated_at: iso(Date.now()), webinar_id: WEBINAR, ...extra });
  const ABERTA = "dddddddd-0000-4000-8000-000000000001";
  const FECHADA = "dddddddd-0000-4000-8000-000000000002";
  const MODELO = "dddddddd-0000-4000-8000-000000000003";
  const SIM = "dddddddd-0000-4000-8000-00000000000a";
  const NAO = "dddddddd-0000-4000-8000-00000000000b";
  db.tables.webinar_polls.push(poll(ABERTA), poll(FECHADA, { closed_at: iso(Date.now()), results_shared_at: iso(Date.now()), status: "closed" }), poll(MODELO, { session_id: null, status: "draft" }));
  db.tables.webinar_poll_options.push(
    { created_at: iso(Date.now()), id: SIM, label: "Sim", poll_id: ABERTA, position: 0 },
    { created_at: iso(Date.now()), id: NAO, label: "Não", poll_id: ABERTA, position: 1 },
    { created_at: iso(Date.now()), id: "dddddddd-0000-4000-8000-00000000000c", label: "A", poll_id: FECHADA, position: 0 }
  );
  db.tables.webinar_poll_answers.push({ created_at: iso(Date.now()), deleted_at: null, id: randomUUID(), offset_ms: 0, option_ids: ["dddddddd-0000-4000-8000-00000000000c"], poll_id: FECHADA, session_id: SESSION, user_id: "11111111-1111-4111-8111-111111111111" });

  // Outra pessoa ja respondeu a aberta: a lista do aluno nunca le essa resposta (so as dele e as contagens das compartilhadas).
  db.tables.webinar_poll_answers.push({ created_at: iso(Date.now()), deleted_at: null, id: randomUUID(), offset_ms: 0, option_ids: [SIM], poll_id: ABERTA, session_id: SESSION, user_id: "11111111-1111-4111-8111-111111111112" });
  clearSharedPollCounts();
  db.calls.reads.length = 0;

  const lista = await json(await pollsRoute.GET(pedido(`${WEBINAR}/polls?sessao=${SESSION}`), contexto()));
  assert.equal(lista.status, 200, JSON.stringify(lista.body));
  assert.deepEqual(
    lista.body.data.polls.map((item) => [item.id, item.status, item.myOptionIds, item.results]),
    [
      [ABERTA, "open", null, null],
      [FECHADA, "closed", null, { counts: { "dddddddd-0000-4000-8000-00000000000c": 1 }, total: 1 }]
    ],
    "o modelo fica de fora; a encerrada vem com o resultado compartilhado"
  );
  // As respostas lidas (especificacao "Na tela", §5.2): as do proprio aluno numa consulta so (pela sessao) e, so na
  // compartilhada, as contagens; nada da aberta.
  const respostasLidas = () => db.calls.reads.filter((read) => read.table === "webinar_poll_answers").map((read) => read.filters.filter(([op]) => op === "eq").map(([, column, value]) => `${column}=${value}`).join("&"));
  assert.deepEqual(respostasLidas(), [`session_id=${SESSION}&user_id=${sessao.user.id}`, `poll_id=${FECHADA}`]);
  // O segundo aluno: as contagens da compartilhada vem da memoria (60 s), so a resposta dele e lida.
  db.calls.reads.length = 0;
  const outroAluno = novoAluno();
  db.tables.profiles.push({ avatar_url: null, created_at: iso(Date.now()), email: "bia@bunker707.test", full_name: "Bia Costa", id: outroAluno, last_sign_in_at: null, phone: null });
  const listaDoOutro = await json(await pollsRoute.GET(pedido(`${WEBINAR}/polls?sessao=${SESSION}`), contexto()));
  assert.equal(listaDoOutro.status, 200);
  assert.deepEqual(listaDoOutro.body.data.polls.map((item) => item.results), [null, { counts: { "dddddddd-0000-4000-8000-00000000000c": 1 }, total: 1 }]);
  assert.deepEqual(respostasLidas(), [`session_id=${SESSION}&user_id=${outroAluno}`]);

  const responder = async (body) => json(await pollsRoute.POST(pedido(`${WEBINAR}/polls`, "POST", { sessionId: SESSION, ...body }), contexto()));
  const invalida = await responder({ optionIds: [randomUUID()], pollId: ABERTA });
  assert.equal(invalida.status, 400);
  const duas = await responder({ optionIds: [SIM, NAO], pollId: ABERTA });
  assert.equal(duas.status, 400, "resposta unica");
  const ok = await responder({ optionIds: [SIM], pollId: ABERTA });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.data.poll.myOptionIds, [SIM]);
  assert.ok(!("anonymous" in ok.body.data.poll) && lista.body.data.polls.every((item) => !("anonymous" in item)), "a enquete do aluno nao leva mais a marca de anonima (D64)");
  assert.equal(ok.body.data.poll.results, null, "sem resultado ate a equipe compartilhar");
  assert.deepEqual(eventos(db, "webinar_poll_answered")[0].metadata, { offset_ms: db.tables.webinar_poll_answers.at(-1).offset_ms, options: 1, poll_id: ABERTA });
  const repetida = await responder({ optionIds: [NAO], pollId: ABERTA });
  assert.equal(repetida.status, 409);
  const fechada = await responder({ optionIds: ["dddddddd-0000-4000-8000-00000000000c"], pollId: FECHADA });
  assert.equal(fechada.status, 409);
  assert.equal(fechada.body.reason, "poll_closed");
  const deOutraSessao = await responder({ optionIds: [SIM], pollId: ABERTA, sessionId: REPLAY });
  assert.equal(deOutraSessao.status, 404);
});

/* ------------------------------------------------------------------------------------------------
 * A sessao com os campos da sala
 * ---------------------------------------------------------------------------------------------- */

test("GET session: os campos da fase 2 (relogio, fase, entrada, modo do chat, selo, video da Bunny montado no servidor, fixada, enquetes, presentes, aceite, replay)", async () => {
  const { db, userId } = montar({ scheduledAt: Date.now() - 2 * MIN });
  db.tables.webinar_chat_messages.push({ approved: true, author_user_id: null, body: "link da apostila", created_at: iso(Date.now()), deleted_at: null, display_name: "Equipe", id: "cccccccc-aaaa-4000-8000-000000000009", kind: "message", master: false, offset_ms: 1000, pinned_at: iso(Date.now()), reply_to_id: null, role: "team", script_item_id: null, session_id: SESSION, source: "team", webinar_id: WEBINAR });
  db.tables.webinar_sessions.find((row) => row.id === SESSION).pinned_message_id = "cccccccc-aaaa-4000-8000-000000000009";
  db.tables.webinar_presence_samples.push({ bucket: 4, first_at: iso(Date.now()), last_at: iso(Date.now()), offset_seconds: 120, samples: 1, session_id: SESSION, state: "playing", user_id: "11111111-1111-4111-8111-111111111111" });

  const resposta = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${SESSION}`), contexto()));
  assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
  const { data } = resposta.body;
  assert.equal(data.session.id, SESSION);
  assert.equal(data.session.kind, "simulated");
  assert.equal(data.session.phase, "waiting", "a fase 1 continua (hora marcada chegou e a equipe nao abriu)");
  assert.equal(data.session.roomPhase, "live");
  assert.deepEqual(data.session.join, { ok: true });
  assert.ok(data.session.offsetMs >= 119_000 && data.session.offsetMs <= 125_000, `offset autoritativo (${data.session.offsetMs})`);
  assert.equal(data.session.durationMs, 3_600_000, "a duracao da gravacao");
  assert.equal(data.session.chatMode, "open");
  assert.equal(data.session.chatSlowModeSeconds, null);
  assert.equal(data.session.showLiveBadge, true);
  assert.equal(data.webinar.replaySessionId, REPLAY);
  assert.equal(data.presentNow, 1);
  const semBanimento = { banned: false, kicked: false, muted: false, mutedUntil: null };
  // Antes do aceite, o proprio nome ja vem (D82, 11/11/2026: as iniciais ao lado do campo, que so o aluno ve).
  assert.deepEqual(data.me, { avatarUrl: null, ban: semBanimento, calendarUrl: null, consented: false, displayName: "Ana S.", registered: false, registeredAt: null });
  assert.equal(data.live, null, "a gravada nao tem o bloco da sala ao vivo (fase 3)");
  assert.equal(data.pinned.body, "link da apostila");
  assert.equal(data.pinned.pinned, true);
  assert.deepEqual(data.polls, []);
  const video = new URL(data.video.embedUrl);
  assert.equal(data.video.provider, "bunny");
  assert.equal(video.origin + video.pathname, "https://iframe.mediadelivery.net/embed/12345/0b1c2d3e-aaaa-4bbb-8ccc-123456789abc");
  assert.equal(video.searchParams.get("autoplay"), "true");
  assert.equal(video.searchParams.get("muted"), "true");
  assert.equal(video.searchParams.get("controls"), "false", "sem barra na gravada");
  assert.ok(Number(video.searchParams.get("t")) >= 119, "entra no segundo atual");
  assert.equal(video.searchParams.get("token"), null, "sem BUNNY_EMBED_TOKEN_KEY nao ha token");

  // O replay: player livre (com barra, sem autoplay), sem relogio.
  const replay = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${REPLAY}`), contexto()));
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.data.session.kind, "replay");
  assert.equal(replay.body.data.session.offsetMs, null);
  assert.equal(replay.body.data.session.roomPhase, null);
  assert.deepEqual(replay.body.data.session.join, { ok: true });
  const livre = new URL(replay.body.data.video.embedUrl);
  assert.equal(livre.searchParams.get("controls"), null);
  assert.equal(livre.searchParams.get("autoplay"), "false");

  // Com o aceite gravado, `me` traz o nome do aluno (sempre o primeiro nome com a inicial; sem modo e sem apelido, D64).
  assert.equal((await enviar({ body: "oi", ...comAceite })).status, 201);
  const depois = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${SESSION}`), contexto()));
  assert.deepEqual(depois.body.data.me, { avatarUrl: null, ban: semBanimento, calendarUrl: null, consented: true, displayName: "Ana S.", registered: false, registeredAt: null });
  assert.equal(db.tables.webinar_chat_consents[0].user_id, userId);

  assert.ok(!("anonymousQuestions" in data.session), "a sala nao recebe mais a opcao Anonima das perguntas");

  // Antes de 15 min da hora, a sala nao abre (join) e o video (com o token da Bunny) nao sai; a sessao responde.
  montar({ scheduledAt: Date.now() + HOUR });
  const cedo = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${SESSION}`), contexto()));
  assert.deepEqual(cedo.body.data.session.join, { ok: false, reason: "not_started" });
  assert.equal(cedo.body.data.session.roomPhase, "waiting");
  assert.equal(cedo.body.data.video, null, "sem video fora da entrada");
  montar({ scheduledAt: Date.now() - 2 * HOUR });
  const tarde = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${SESSION}`), contexto()));
  assert.deepEqual(tarde.body.data.session.join, { ok: false, reason: "ended" });
  assert.equal(tarde.body.data.video, null, "nem depois do fim");

  // O replay que a equipe cancelou some: a sessao e as rotas da sala respondem 404.
  const { db: semReplay } = montar();
  semReplay.tables.webinar_sessions.find((row) => row.id === REPLAY).status = "cancelled";
  assert.equal((await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${REPLAY}`), contexto())).status, 404);
  assert.equal((await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${REPLAY}&from=0&to=1000`), contexto())).status, 404);
  assert.equal((await heartbeatRoute.POST(pedido(`${WEBINAR}/heartbeat`, "POST", { offsetSeconds: 0, sessionId: REPLAY }), contexto())).status, 404);
});

test("D82, a foto ou as iniciais de quem escreve: antes do aceite, `me` leva so os dados do proprio aluno (a foto do Perfil e o nome dele); nada de outro aluno, nem com ele no chat; a foto de fora continua nula", async () => {
  const origemAntes = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto.supabase.co";
  try {
    clearAuthorPhotoCache();
    const { db, userId } = montar({ scheduledAt: Date.now() - 2 * MIN });
    const foto = (id, arquivo) => `https://projeto.supabase.co/storage/v1/object/public/content-assets/avatars/${id}/${arquivo}`;
    const MINHA = foto(userId, "ana.webp");
    db.tables.profiles.find((row) => row.id === userId).avatar_url = MINHA;
    // Outra aluna, com foto, aceite em dia e uma mensagem no chat da sessao.
    const OUTRA = "66666666-6666-4666-8666-000000000082";
    const DELA = foto(OUTRA, "bia.webp");
    db.tables.profiles.push({ avatar_url: DELA, created_at: iso(Date.now()), email: "bia@bunker707.test", full_name: "Beatriz Lima", id: OUTRA, last_sign_in_at: null, phone: null });
    db.tables.webinar_chat_consents.push({ consent_version: CHAT_CONSENT_VERSION, consented_at: iso(Date.now() - HOUR), created_at: iso(Date.now() - HOUR), display_mode: "first_name_initial", nickname: null, revoked_at: null, updated_at: iso(Date.now() - HOUR), user_id: OUTRA });
    db.tables.webinar_chat_messages.push({ approved: true, author_user_id: OUTRA, body: "oi, turma", created_at: iso(Date.now()), deleted_at: null, display_name: "Beatriz L.", id: "cccccccc-aaaa-4000-8000-000000000082", kind: "message", master: false, offset_ms: 30_000, pinned_at: null, reply_to_id: null, role: "student", script_item_id: null, session_id: SESSION, source: "audience", webinar_id: WEBINAR });

    const { body, status } = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${SESSION}`), contexto()));
    assert.equal(status, 200, JSON.stringify(body));
    const semBanimento = { banned: false, kicked: false, muted: false, mutedUntil: null };
    assert.deepEqual(body.data.me, { avatarUrl: MINHA, ban: semBanimento, calendarUrl: null, consented: false, displayName: "Ana S.", registered: false, registeredAt: null });
    const me = JSON.stringify(body.data.me);
    for (const deOutra of [OUTRA, DELA, "Beatriz", "bia"]) {
      assert.ok(!me.includes(deOutra), `nada da outra aluna em me (${deOutra})`);
    }

    // So a foto do Google no perfil (um endereco de fora): sem foto, e o nome continua para as iniciais.
    clearAuthorPhotoCache();
    db.tables.profiles.find((row) => row.id === userId).avatar_url = "https://lh3.googleusercontent.com/a/teste=s96-c";
    const google = (await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${SESSION}`), contexto()))).body.data.me;
    assert.deepEqual([google.avatarUrl, google.displayName, google.consented], [null, "Ana S.", false]);
  } finally {
    if (origemAntes === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = origemAntes;
  }
});

test("limite de vagas (A12): so quem garantiu a vaga entra; sem ela, as rotas da sala respondem 403 e a sessao diz no_seat sem o video; o replay nao pede vaga", async () => {
  const { db, userId } = montar();
  Object.assign(db.tables.webinars.find((row) => row.id === WEBINAR), { capacity: 50, registration_required: true });

  const semVaga = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${SESSION}`), contexto()));
  assert.equal(semVaga.status, 200, JSON.stringify(semVaga.body));
  assert.deepEqual(semVaga.body.data.session.join, { ok: false, reason: "no_seat" });
  assert.equal(semVaga.body.data.video, null);
  const chat = await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&from=0&to=1000`), contexto()));
  assert.equal(chat.status, 403);
  assert.match(chat.body.error, /só entra quem garantiu a vaga/);
  assert.equal((await enviar({ body: "oi", ...comAceite })).status, 403);
  assert.equal((await heartbeatRoute.POST(pedido(`${WEBINAR}/heartbeat`, "POST", { offsetSeconds: 0, sessionId: SESSION }), contexto())).status, 403);
  assert.equal(db.tables.webinar_presence_samples.length, 0);

  const replay = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${REPLAY}`), contexto()));
  assert.deepEqual(replay.body.data.session.join, { ok: true }, "o replay e de quem tem acesso");

  db.tables.webinar_registrations.push({ calendar_token: "tok", cancelled_at: null, created_at: iso(Date.now()), id: randomUUID(), registered_at: iso(Date.now() - HOUR), reminder_1h_sent_at: null, reminder_24h_sent_at: null, session_id: SESSION, source: null, source_campaign_id: null, started_notice_sent_at: null, status: "registered", updated_at: iso(Date.now()), user_id: userId, webinar_id: WEBINAR });
  heartbeatRoute.resetHeartbeatAccessCache();
  const comVaga = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${SESSION}`), contexto()));
  assert.deepEqual(comVaga.body.data.session.join, { ok: true });
  assert.ok(comVaga.body.data.video, "com a vaga, o video");
  assert.equal((await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&from=0&to=1000`), contexto())).status, 200);
  assert.equal((await enviar({ body: "oi", ...comAceite })).status, 201);
});

/* ------------------------------------------------------------------------------------------------
 * Cancelar minha vaga com as horas como o Postgres devolve
 * ---------------------------------------------------------------------------------------------- */

/** Como o PostgREST: timestamptz volta com "+00:00" (o toISOString escreve "Z"). */
function horasDoPostgres(db, table) {
  const from = db.from.bind(db);
  db.from = (name) => {
    const chain = from(name);
    if (name !== table) {
      return chain;
    }
    const then = chain.then;
    const pg = (row) => (row && typeof row === "object" ? Object.fromEntries(Object.entries(row).map(([key, value]) => [key, key.endsWith("_at") && typeof value === "string" ? value.replace(/Z$/, "+00:00") : value])) : row);
    chain.then = (resolve, reject) => then((result) => resolve({ ...result, data: Array.isArray(result.data) ? result.data.map(pg) : pg(result.data) }), reject);
    return chain;
  };
}

test("Cancelar minha vaga: com a hora no formato do Postgres (+00:00) a rota responde cancelled: true e grava o historico uma vez", async () => {
  const { db } = montar({ scheduledAt: Date.now() + 2 * HOUR });
  db.tables.webinars.find((row) => row.id === WEBINAR).registration_required = true;
  horasDoPostgres(db, "webinar_registrations");
  const vaga = (method) => registerRoute[method](pedido(`${WEBINAR}/register`, method, { sessionId: SESSION }), contexto());

  assert.equal((await vaga("POST")).status, 201);
  const cancelada = await json(await vaga("DELETE"));
  assert.equal(cancelada.status, 200, JSON.stringify(cancelada.body));
  assert.equal(cancelada.body.data.cancelled, true, "esta chamada cancelou");
  assert.equal(db.tables.webinar_registrations[0].status, "cancelled");
  assert.deepEqual(
    eventos(db, "webinar_registered").map((row) => row.metadata.cancelled ?? null),
    [null, true]
  );
  const deNovo = await json(await vaga("DELETE"));
  assert.equal(deNovo.body.data.cancelled, false, "repetir nao cancela de novo");
  assert.equal(eventos(db, "webinar_registered").length, 2);
});

test("fase 4e: a sessao do Comeca quando voce entra nunca tem vaga: POST /register com ela responde 404 e nada e gravado", async () => {
  const { db } = montar({ scheduledAt: Date.now() + 2 * HOUR });
  db.tables.webinars.find((row) => row.id === WEBINAR).registration_required = true;
  db.tables.webinar_sessions.find((row) => row.id === SESSION).jit = true;
  const resposta = await json(await registerRoute.POST(pedido(`${WEBINAR}/register`, "POST", { sessionId: SESSION }), contexto()));
  assert.equal(resposta.status, 404);
  assert.equal(db.tables.webinar_registrations.length, 0);
});

test("fase 4c: sem WEBINAR_ASSISTANT_ENABLED o chat e as perguntas seguem como antes; o 201 diz assistant: null e o GET /questions leva answerSource nulo", async () => {
  delete process.env.WEBINAR_ASSISTANT_ENABLED;
  const { db } = montar();
  const chamou = await enviar({ body: "@assistente quanto custa?", ...comAceite });
  assert.equal(chamou.status, 201, JSON.stringify(chamou.body));
  assert.equal(chamou.body.data.assistant, null, "sem o ambiente, o Assistente nem e agendado");
  assert.ok(!db.calls.from.includes("webinar_ai_requests"), "nenhuma leitura das tabelas do Assistente");

  const feita = await json(await questionsRoute.POST(pedido(`${WEBINAR}/questions`, "POST", { anonymous: false, body: "Tem certificado?", sessionId: SESSION }), contexto()));
  assert.equal(feita.status, 201, JSON.stringify(feita.body));
  assert.equal(feita.body.data.assistant, null);
  const lista = await json(await questionsRoute.GET(pedido(`${WEBINAR}/questions?sessao=${SESSION}`), contexto()));
  assert.deepEqual(lista.body.data.questions.map((question) => [question.body, question.answerSource, question.handoffRequested]), [["Tem certificado?", null, false]]);
  assert.ok(!db.calls.from.includes("webinar_ai_requests"));
});

/* ------------------------------------------------------------------------------------------------
 * O fio de uma pergunta (docs/30 §1.3 e D63): POST /questions/[qid]/replies
 * ---------------------------------------------------------------------------------------------- */

/** Uma pergunta respondida pela equipe na sessao (do aluno do teste, salvo outro dono). */
function perguntaRespondida(db, userId, extra = {}) {
  const id = randomUUID();
  db.tables.webinar_questions.push({ anonymous: false, answer_text: "Sim!", answered_at: iso(Date.now() - MIN), answered_by: null, answered_live: false, body: "Tem certificado?", created_at: iso(Date.now() - 2 * MIN), deleted_at: null, deleted_reason: null, display_name: "Ana S.", id, message_id: null, offset_ms: 0, session_id: SESSION, status: "answered", upvotes: 0, user_id: userId, ...extra });
  return id;
}

async function responderNoFio(qid, body = "Obrigada!", extra = {}) {
  return json(await repliesRoute.POST(pedido(`${WEBINAR}/questions/${qid}/replies`, "POST", { body, sessionId: SESSION, ...comAceite, ...extra }), { params: Promise.resolve({ id: WEBINAR, qid }) }));
}

/** O banco sem a 202611100001: webinar_question_replies responde como o postgrest-js responde a uma tabela que nao existe. */
function semATabelaDoFio(db) {
  const from = db.from.bind(db);
  db.from = (name) => {
    if (name !== "webinar_question_replies") {
      return from(name);
    }
    db.calls.from.push(name);
    let head = false;
    const chain = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            // HEAD: 404 sem corpo vira "sem erro e sem contagem"; GET e INSERT trazem o PGRST205.
            const result = head
              ? { count: null, data: null, error: null, status: 204 }
              : { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.webinar_question_replies' in the schema cache" } };
            return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
          }
          if (prop === "select") {
            return (_columns, options) => {
              if (options?.head) head = true;
              return chain;
            };
          }
          return () => chain;
        }
      }
    );
    return chain;
  };
}

test("banco sem a 202611100001: responder no fio falha antes do aceite e da rajada (o aceite fica, nada no historico, as 5 vezes da rajada ficam)", async () => {
  const { db, userId } = montar();
  semATabelaDoFio(db);
  const id = perguntaRespondida(db, userId);
  db.tables.webinar_chat_consents.push({ consent_version: 1, created_at: iso(Date.now() - HOUR), display_mode: "first_name_initial", nickname: null, revoked_at: null, updated_at: iso(Date.now() - HOUR), user_id: userId });

  const lista = await json(await questionsRoute.GET(pedido(`${WEBINAR}/questions?sessao=${SESSION}`), contexto()));
  assert.equal(lista.status, 200, JSON.stringify(lista.body));
  const minha = lista.body.data.questions.find((question) => question.id === id);
  assert.equal(minha.canReply, true, "o fio le vazio: o Responder continua");
  assert.deepEqual(minha.replies, []);

  const resposta = await responderNoFio(id);
  assert.equal(resposta.status, 500);
  assert.deepEqual(resposta.body, { error: "Não foi possível enviar a resposta." });
  assert.equal(db.tables.webinar_chat_consents[0].consent_version, 1, "o aceite antigo fica como estava");
  assert.equal(db.calls.writes.filter((write) => write.table === "webinar_chat_consents").length, 0);
  assert.equal(eventos(db, "webinar_chat_consented").length, 0);
  assert.deepEqual(
    Array.from({ length: 5 }, () => takeReplyBurst(userId, SESSION).ok),
    [true, true, true, true, true],
    "a falha nao gastou a rajada"
  );
});

test("o fio: a pergunta de outra sessao 404; a 6a resposta em 60 s 429 com Retry-After; palavra bloqueada 422; a 51a resposta 409 (o fio cheio); nada gravado nas recusadas", async () => {
  const { db, userId } = montar();
  const id = perguntaRespondida(db, userId);
  const deOutraSessao = perguntaRespondida(db, userId, { session_id: REPLAY });
  const fio = () => db.tables.webinar_question_replies ?? [];

  const outra = await responderNoFio(deOutraSessao);
  assert.equal(outra.status, 404, "a pergunta de outra sessao nao aparece nesta");
  assert.equal(fio().length, 0);

  for (let i = 0; i < 5; i += 1) {
    const enviada = await responderNoFio(id, `resposta ${i + 1}`);
    assert.equal(enviada.status, 201, JSON.stringify(enviada.body));
  }
  const sexta = await repliesRoute.POST(pedido(`${WEBINAR}/questions/${id}/replies`, "POST", { body: "a sexta", sessionId: SESSION }), { params: Promise.resolve({ id: WEBINAR, qid: id }) });
  assert.equal(sexta.status, 429);
  assert.match(sexta.headers.get("Retry-After") ?? "", /^\d+$/);
  assert.equal(fio().length, 5);
  assert.equal(eventos(db, "webinar_question_reply_sent").length, 5);

  // Palavra bloqueada: 422 com a frase da lista, antes de gravar.
  const { db: bloqueio, userId: aluna } = montar();
  const alvo = perguntaRespondida(bloqueio, aluna);
  const bloqueada = await responderNoFio(alvo, "isso é um PALAVRÃO feio");
  assert.equal(bloqueada.status, 422);
  assert.equal(bloqueada.body.error, "Sem isso aqui.");
  assert.equal((bloqueio.tables.webinar_question_replies ?? []).length, 0);

  // O fio com 50 respostas (o teto de QUESTION_REPLY_LIMITS.perQuestion): a 51a e 409, sem gravar.
  const { db: cheio, userId: dono } = montar();
  const conversa = perguntaRespondida(cheio, dono);
  cheio.tables.webinar_question_replies = Array.from({ length: 50 }, (_, index) => ({
    anonymous: false,
    body: `r${index}`,
    created_at: iso(Date.now() - (60 - index) * 1000),
    deleted_at: null,
    deleted_by: null,
    deleted_reason: null,
    display_name: index % 2 ? "Ana S." : "Equipe",
    id: randomUUID(),
    question_id: conversa,
    role: index % 2 ? "student" : "team",
    session_id: SESSION,
    user_id: index % 2 ? dono : null
  }));
  const cinquentaEUma = await responderNoFio(conversa, "mais uma");
  assert.equal(cinquentaEUma.status, 409);
  assert.equal(cinquentaEUma.body.error, "Esta conversa chegou ao limite de respostas.");
  assert.equal(cheio.tables.webinar_question_replies.length, 50);
});

test("o fio na live: silenciado no chat, removido da sala e banido de todos os webinarios respondem 409 com o motivo; nada entra no fio", async () => {
  /** A sessao do teste vira a live no ar (o banimento da sessao so vale na live). */
  const aoVivo = (db) => {
    db.tables.webinars.find((row) => row.id === WEBINAR).kind = "live";
    Object.assign(db.tables.webinar_sessions.find((row) => row.id === SESSION), { kind: "live", recording_id: null, source_session_id: null, started_at: iso(Date.now() - 5 * MIN), status: "live" });
    db.tables.webinar_session_bans ??= [];
    db.tables.webinar_user_bans ??= [];
  };
  const ban = (userId, kind) => ({ by_user_id: null, created_at: iso(Date.now()), kind, reason: null, session_id: SESSION, until_at: null, user_id: userId });

  const { db: livre, userId: semBan } = montar();
  aoVivo(livre);
  const certa = perguntaRespondida(livre, semBan);
  const passou = await responderNoFio(certa);
  assert.equal(passou.status, 201, `sem banimento, a resposta entra na live (${JSON.stringify(passou.body)})`);

  const { db: silencio, userId: silenciada } = montar();
  aoVivo(silencio);
  silencio.tables.webinar_session_bans.push(ban(silenciada, "muted"));
  const muda = await responderNoFio(perguntaRespondida(silencio, silenciada));
  assert.equal(muda.status, 409);
  assert.equal(muda.body.reason, "muted");
  assert.equal((silencio.tables.webinar_question_replies ?? []).length, 0);

  const { db: fora, userId: removida } = montar();
  aoVivo(fora);
  fora.tables.webinar_session_bans.push(ban(removida, "kicked"));
  const removidaDaSala = await responderNoFio(perguntaRespondida(fora, removida));
  assert.equal(removidaDaSala.status, 409);
  assert.equal(removidaDaSala.body.reason, "banned");
  assert.equal(removidaDaSala.body.error, "Você foi removido desta live.");
  assert.equal((fora.tables.webinar_question_replies ?? []).length, 0);

  const { db: barrado, userId: banida } = montar();
  aoVivo(barrado);
  barrado.tables.webinar_user_bans.push({ by_user_id: null, created_at: iso(Date.now()), reason: null, session_id: null, user_id: banida });
  const banidaDeTodos = await responderNoFio(perguntaRespondida(barrado, banida));
  assert.equal(banidaDeTodos.status, 409);
  assert.equal(banidaDeTodos.body.reason, "banned");
  assert.equal((barrado.tables.webinar_question_replies ?? []).length, 0);

  // Na Live gravada vale so o banido de todos (D33): o mesmo 409 banned.
  const { db: gravada, userId: banidaNaGravada } = montar();
  gravada.tables.webinar_user_bans = [{ by_user_id: null, created_at: iso(Date.now()), reason: null, session_id: null, user_id: banidaNaGravada }];
  const naGravada = await responderNoFio(perguntaRespondida(gravada, banidaNaGravada));
  assert.equal(naGravada.status, 409);
  assert.equal(naGravada.body.reason, "banned");
  assert.equal((gravada.tables.webinar_question_replies ?? []).length, 0);
});

test("roomJoinFor na Live gravada: o removido desta sessao fica de fora (kicked) antes da vaga e do relogio; o banido de todos (banned) vence; o silenciado entra; sem banimento, o relogio decide", () => {
  const T0 = Date.parse("2026-11-05T23:00:00.000Z");
  const gravada = { kind: "simulated", lateJoinMinutes: null, recordingAnchorAt: null, scheduledAt: new Date(T0).toISOString(), startedAt: null, status: "scheduled" };
  const contextoDa = (session) => ({ durationMs: 60 * MIN, session });
  const livre = { banned: false, kicked: false, muted: false, mutedUntil: null };
  const agora = T0 + 5 * MIN;

  assert.deepEqual(roomJoinFor(contextoDa(gravada), agora, { ban: livre }), { ok: true });
  assert.deepEqual(roomJoinFor(contextoDa(gravada), agora, { ban: { ...livre, muted: true } }), { ok: true }, "silenciado continua assistindo");
  assert.deepEqual(roomJoinFor(contextoDa(gravada), agora, { ban: { ...livre, kicked: true } }), { ok: false, reason: "kicked" });
  assert.deepEqual(roomJoinFor(contextoDa(gravada), agora, { ban: { ...livre, kicked: true }, seatMissing: true }), { ok: false, reason: "kicked" }, "removido antes da vaga");
  assert.deepEqual(roomJoinFor(contextoDa(gravada), T0 + 2 * 60 * MIN, { ban: { ...livre, kicked: true } }), { ok: false, reason: "kicked" }, "e antes do relogio");
  assert.deepEqual(roomJoinFor(contextoDa(gravada), agora, { ban: { ...livre, banned: true, kicked: true } }), { ok: false, reason: "banned" });
  assert.deepEqual(roomJoinFor(contextoDa(gravada), T0 + 2 * 60 * MIN, { ban: livre }), { ok: false, reason: "ended" });
  // No Replay o removido nao existe (so o banido de todos).
  assert.deepEqual(roomJoinFor(contextoDa({ ...gravada, kind: "replay" }), agora, { ban: { ...livre, kicked: true } }), { ok: true });
});

test("a moderacao por pessoa na Live gravada (a Na tela, R5): silenciado nao manda mensagem, pergunta nem resposta no fio (409 muted, a frase com a hora ou ate o fim), mas reage e responde enquete; removido nao escreve nada (409 banned) e a sessao diz kicked sem o video; desfeito, volta; o removido da live de origem continua livre", async () => {
  const ban = (userId, kind, extra = {}) => ({ by_user_id: null, created_at: iso(Date.now()), kind, reason: null, session_id: SESSION, until_at: null, user_id: userId, ...extra });
  const POLL = "cccccccc-bbbb-4000-8000-000000000001";
  const SIM = "cccccccc-bbbb-4000-8000-000000000002";
  const comEnquete = (db) => {
    db.tables.webinar_polls.push({ anonymous: false, closed_at: null, created_at: iso(Date.now()), created_by: null, id: POLL, kind: "single", open_offset_ms: 0, opened_at: iso(Date.now()), position: 0, question: "Gostou?", results_shared_at: null, session_id: SESSION, status: "open", template_poll_id: null, updated_at: iso(Date.now()), webinar_id: WEBINAR });
    db.tables.webinar_poll_options.push({ created_at: iso(Date.now()), id: SIM, label: "Sim", poll_id: POLL, position: 0 });
  };
  const pergunta = async () => json(await questionsRoute.POST(pedido(`${WEBINAR}/questions`, "POST", { body: "Tem certificado?", sessionId: SESSION, ...comAceite }), contexto()));
  const reagir = async () => json(await reactionsRoute.POST(pedido(`${WEBINAR}/reactions`, "POST", { reaction: "clap", sessionId: SESSION }), contexto()));
  const votar = async () => json(await pollsRoute.POST(pedido(`${WEBINAR}/polls`, "POST", { optionIds: [SIM], pollId: POLL, sessionId: SESSION }), contexto()));
  const lerSessao = async () => (await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${SESSION}`), contexto()))).body.data;

  // Silenciada ate o fim: o chat, a pergunta e o fio recusam; a reacao e a enquete passam; a sala continua.
  const { db: silencio, userId: silenciada } = montar({ scheduledAt: Date.now() - 2 * MIN });
  comEnquete(silencio);
  silencio.tables.webinar_session_bans = [ban(silenciada, "muted")];
  const qid = perguntaRespondida(silencio, silenciada);
  for (const resposta of [await enviar({ body: "oi", ...comAceite }), await pergunta(), await responderNoFio(qid)]) {
    assert.equal(resposta.status, 409, JSON.stringify(resposta.body));
    assert.deepEqual([resposta.body.reason, resposta.body.error], ["muted", "Você está sem escrever no chat até o fim desta live."]);
  }
  assert.equal((await reagir()).status, 201, "silenciado reage");
  assert.equal((await votar()).status, 201, "e responde a enquete");
  const comSilencio = await lerSessao();
  assert.deepEqual([comSilencio.me.ban.muted, comSilencio.me.ban.mutedUntil, comSilencio.session.join.ok], [true, null, true]);
  assert.ok(comSilencio.video, "continua assistindo");
  assert.equal(silencio.tables.webinar_chat_messages.filter((row) => row.session_id === SESSION).length, 0);

  // Silenciada por 15 min: a frase com a hora; vencido o prazo, escreve de novo.
  silencio.tables.webinar_session_bans = [ban(silenciada, "muted", { until_at: iso(Date.now() + 15 * MIN) })];
  const comHora = await enviar({ body: "oi", ...comAceite });
  assert.equal(comHora.status, 409);
  assert.match(comHora.body.error, /^Você está sem escrever no chat até \d{2}:\d{2}\.$/);
  silencio.tables.webinar_session_bans = [ban(silenciada, "muted", { until_at: iso(Date.now() - 1000) })];
  assert.equal((await enviar({ body: "voltei", ...comAceite })).status, 201, "o silencio venceu");

  // Removida: nada escreve (nem reage nem vota) e a sessao diz kicked, sem o video da Bunny.
  const { db: fora, userId: removida } = montar({ scheduledAt: Date.now() - 2 * MIN });
  comEnquete(fora);
  fora.tables.webinar_session_bans = [ban(removida, "kicked")];
  for (const resposta of [await enviar({ body: "oi", ...comAceite }), await pergunta(), await reagir(), await votar()]) {
    assert.equal(resposta.status, 409, JSON.stringify(resposta.body));
    assert.deepEqual([resposta.body.reason, resposta.body.error], ["banned", "Você foi removido desta live."]);
  }
  const semSala = await lerSessao();
  assert.deepEqual(semSala.session.join, { ok: false, reason: "kicked" });
  assert.equal(semSala.me.ban.kicked, true);
  assert.equal(semSala.video, null, "o video sai na proxima conferencia da sala");
  assert.equal(fora.tables.webinar_chat_messages.length + fora.tables.webinar_reactions.length + fora.tables.webinar_poll_answers.length, 1, "so a linha mestre da escola");

  // Desfeito (a equipe apagou a linha): a sala e a escrita voltam.
  fora.tables.webinar_session_bans = [];
  const devolta = await lerSessao();
  assert.deepEqual(devolta.session.join, { ok: true });
  assert.ok(devolta.video);
  assert.equal((await enviar({ body: "voltei", ...comAceite })).status, 201);

  // O removido da live de origem (outra sessao) continua livre nesta gravada.
  const { db: outra } = montar({ scheduledAt: Date.now() - 2 * MIN });
  outra.tables.webinar_session_bans = [ban(sessao.user.id, "kicked", { session_id: LIVE_SOURCE })];
  assert.equal((await enviar({ body: "oi", ...comAceite })).status, 201);
  assert.deepEqual((await lerSessao()).session.join, { ok: true });
});

test("a foto na sala (docs/30 §8.5, D62): so o arquivo enviado pelo Perfil, pela origem do nosso Supabase; um endereco de fora gravado no perfil vira iniciais no chat, na leitura e no proprio campo", async () => {
  const antes = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto.supabase.co";
  try {
    const { db, userId } = montar({ scheduledAt: Date.now() - 90_000 });
    const perfil = db.tables.profiles.find((row) => row.id === userId);
    perfil.avatar_url = "https://attacker.example/p.png";

    const enviada = await enviar({ body: "oi", ...comAceite });
    assert.equal(enviada.status, 201, JSON.stringify(enviada.body));
    assert.equal(enviada.body.data.message.avatarUrl, null, "a resposta do envio");
    const desde = encodeURIComponent(iso(Date.now() - 60_000));
    const lida = await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&since=${desde}`), contexto()));
    assert.equal(lida.status, 200, JSON.stringify(lida.body));
    assert.equal(lida.body.data.messages[0].avatarUrl, null, "a leitura do chat");
    const sessao_ = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${SESSION}`), contexto()));
    assert.equal(sessao_.body.data.me.avatarUrl, null, "o proprio campo de escrever");

    // A foto enviada pelo Perfil (avatars/{id}/arquivo no bucket): aparece, pela nossa origem.
    const propria = `https://projeto.supabase.co/storage/v1/object/public/content-assets/avatars/${userId}/aa11.webp`;
    perfil.avatar_url = propria;
    clearAuthorPhotoCache();
    const deNovo = await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&since=${desde}`), contexto()));
    assert.equal(deNovo.body.data.messages[0].avatarUrl, propria);
    assert.equal((await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${SESSION}`), contexto()))).body.data.me.avatarUrl, propria);
  } finally {
    if (antes === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = antes;
    clearAuthorPhotoCache();
  }
});

test("o fio com mais de 1000 respostas na sessao (o teto de 1000 linhas do PostgREST): a resposta mais nova continua na lista do aluno", async () => {
  const { db, userId } = montar();
  const minha = perguntaRespondida(db, userId);
  const deOutro = "11111111-1111-4111-8111-111111111114";
  const outras = Array.from({ length: 25 }, () => perguntaRespondida(db, deOutro, { display_name: "Zé" }));
  const inicio = Date.now() - 2 * HOUR;
  const resposta = (index, extra) => ({
    anonymous: false,
    body: `r${index}`,
    created_at: iso(inicio + index * 1000),
    deleted_at: null,
    deleted_by: null,
    deleted_reason: null,
    display_name: "Equipe",
    id: randomUUID(),
    question_id: outras[index % outras.length],
    role: "team",
    session_id: SESSION,
    user_id: null,
    ...extra
  });
  db.tables.webinar_question_replies = [
    ...Array.from({ length: 1000 }, (_, index) => resposta(index)),
    resposta(1000, { body: "obrigada!", display_name: "Ana S.", question_id: minha, role: "student", user_id: userId })
  ];

  const lista = await json(await questionsRoute.GET(pedido(`${WEBINAR}/questions?sessao=${SESSION}&ordem=recentes`), contexto()));
  assert.equal(lista.status, 200, JSON.stringify(lista.body));
  const questions = lista.body.data.questions;
  assert.deepEqual(
    questions.find((question) => question.id === minha).replies.map((reply) => reply.body),
    ["obrigada!"],
    "a resposta 1001 nao some no corte"
  );
  assert.equal(
    questions.reduce((total, question) => total + question.replies.length, 0),
    1001
  );
});
