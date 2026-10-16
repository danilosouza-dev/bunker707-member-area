import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, limparProgresso, limparSessoesDeTv, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Modo TV com banco de verdade. A aluna inicia na aula (codigo de seis letras e QR code), a TV conecta
// com o codigo (que vale uma vez so) e recebe um token que no banco existe apenas como hash; o controle
// remoto manda comandos com revisao crescente; o heartbeat da TV grava o progresso da aula; encerrar
// derruba a TV. A sessao do aluno e um duble (actAs); a TV nao tem sessao, so o token no cabecalho.
// O video em si nao entra: o que depende do player tocando fica fora (docs/18 §3.1).

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const iniciar = await import("../../src/app/api/tv/sessions/route.ts");
const sessaoDoAluno = await import("../../src/app/api/tv/sessions/[sessionId]/route.ts");
const comandos = await import("../../src/app/api/tv/sessions/[sessionId]/commands/route.ts");
const conectar = await import("../../src/app/api/tv/connect/route.ts");
const receptor = await import("../../src/app/api/tv/receiver/[sessionId]/route.ts");
const { getLessonPageData } = await import("../../src/server/db/platform-store.ts");

const { curso } = ESCOLA_DE_TESTE;
const aluna = usuarioDeTeste(contas.aluna);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);
const SEM_CACHE = "private, no-store, max-age=0";
const TOKEN_ERRADO = "x".repeat(43);

const rota = (sessionId) => ({ params: Promise.resolve({ sessionId }) });

function pedido(body, { method = "POST", token, url = "http://127.0.0.1:3100/api/tv" } = {}) {
  return new Request(url, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    method
  });
}

async function iniciarModoTv(payload = { contentId: curso.id, lessonId: curso.aulas.aula1 }) {
  const response = await iniciar.POST(pedido(payload));
  return { body: await response.json(), response };
}

async function lerComoDono(sessionId) {
  const response = await sessaoDoAluno.GET(pedido(undefined, { method: "GET" }), rota(sessionId));
  return { body: await response.json(), response };
}

async function mandarComando(sessionId, command) {
  const response = await comandos.POST(pedido(command), rota(sessionId));
  return { body: await response.json(), response };
}

async function conectarTv(code) {
  const response = await conectar.POST(pedido({ code }));
  return { body: await response.json(), response };
}

async function lerNaTv(sessionId, token, query = "") {
  const url = `http://127.0.0.1:3100/api/tv/receiver/${sessionId}${query}`;
  const response = await receptor.GET(pedido(undefined, { method: "GET", token, url }), rota(sessionId));
  return { body: await response.json(), response };
}

async function baterCoracao(sessionId, token, estado) {
  const padrao = { appliedCommandRevision: 0, availablePlaybackRates: [1], playbackRate: 1, playbackState: "playing" };
  const response = await receptor.PUT(pedido({ ...padrao, ...estado }, { method: "PUT", token }), rota(sessionId));
  return { body: await response.json(), response };
}

const linhaNoBanco = async (id) => unwrap(await db.from("tv_sessions").select("*").eq("id", id).single(), "Lendo tv_sessions");

async function eventosDaSessao(id) {
  const rows = unwrap(
    await db.from("student_events").select("event_type,metadata,occurred_at").eq("entity_type", "tv_session").eq("entity_id", id).order("occurred_at"),
    "Lendo student_events"
  );

  return rows.map((row) => ({ metadata: row.metadata, type: row.event_type }));
}

let sessao;
let codigo;
let tokenDaTv;

before(async () => {
  await limparSessoesDeTv(db, [contas.aluna.id, contas.alunoSemAcesso.id]);
  await limparProgresso(db, [contas.aluna.id]);
});

test("sem sessao, iniciar o Modo TV responde 401, sem cache", async () => {
  actAs(null);
  const { response } = await iniciarModoTv();

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), SEM_CACHE);
});

test("aluno sem acesso ao curso recebe 403 e nenhuma sessao de TV e criada", async () => {
  actAs(alunoSemAcesso);
  const { response } = await iniciarModoTv();

  assert.equal(response.status, 403);
  const linhas = unwrap(await db.from("tv_sessions").select("id").eq("user_id", contas.alunoSemAcesso.id), "Lendo tv_sessions");
  assert.equal(linhas.length, 0);
});

test("pedido sem a aula responde 400", async () => {
  actAs(aluna);
  const { body, response } = await iniciarModoTv({ contentId: curso.id });

  assert.equal(response.status, 400);
  assert.equal(body.error, "Dados da sessao de TV invalidos.");
});

test("a aluna inicia o Modo TV: codigo de seis caracteres, endereco da TV com o codigo e nada de token na resposta; evento registrado", async () => {
  actAs(aluna);
  const { body, response } = await iniciarModoTv({ contentId: curso.id, currentTimeSeconds: 42, durationSeconds: 600, lessonId: curso.aulas.aula1 });

  assert.equal(response.status, 201, body.error);
  assert.equal(response.headers.get("cache-control"), SEM_CACHE);
  sessao = body.data.session;
  codigo = sessao.pairingCode;
  assert.match(codigo, /^[A-HJ-NP-Z2-9]{6}$/, "codigo sem as letras e numeros que se confundem (I, O, 0, 1)");
  assert.equal(sessao.status, "pending");
  assert.equal(sessao.lessonId, curso.aulas.aula1);
  assert.equal(sessao.currentTimeSeconds, 42, "a TV comeca de onde a aluna parou");
  const tvUrl = new URL(body.data.tvUrl);
  assert.equal(tvUrl.pathname, "/tv");
  assert.equal(tvUrl.searchParams.get("code"), codigo, "o QR code leva o codigo no endereco");
  assert.doesNotMatch(JSON.stringify(body), /receiver_?token|token_hash/i, "a resposta da aluna nao traz o token da TV");

  const linha = await linhaNoBanco(sessao.id);
  assert.equal(linha.receiver_token_hash, null, "antes de a TV conectar nao existe token");
  const restante = Date.parse(linha.pairing_expires_at) - Date.now();
  assert.ok(restante > 9 * 60 * 1000 && restante <= 10 * 60 * 1000, `o codigo vale 10 minutos (faltam ${Math.round(restante / 1000)} s)`);
  assert.deepEqual((await eventosDaSessao(sessao.id)).map((event) => event.type), ["lesson_tv_session_created"]);
});

test("iniciar de novo encerra a sessao anterior: uma TV por aluno", async () => {
  actAs(aluna);
  const anterior = sessao.id;
  const { body, response } = await iniciarModoTv();

  assert.equal(response.status, 201, body.error);
  assert.notEqual(body.data.session.id, anterior);
  assert.equal((await linhaNoBanco(anterior)).status, "ended");
  sessao = body.data.session;
  codigo = sessao.pairingCode;
});

test("a sessao e so do dono: outro aluno recebe 404, sem sessao 401, a dona ve a TV aguardando", async () => {
  actAs(alunoSemAcesso);
  assert.equal((await lerComoDono(sessao.id)).response.status, 404);

  actAs(null);
  assert.equal((await lerComoDono(sessao.id)).response.status, 401);

  actAs(aluna);
  const { body, response } = await lerComoDono(sessao.id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), SEM_CACHE);
  assert.equal(body.data.session.status, "pending");
});

test("comando antes de a TV conectar e recusado (409) e nao conta revisao", async () => {
  actAs(aluna);
  const { body, response } = await mandarComando(sessao.id, { type: "play" });

  assert.equal(response.status, 409);
  assert.equal(body.error, "A TV nao esta conectada ou a sessao expirou.");
  assert.equal(Number((await linhaNoBanco(sessao.id)).command_revision), 0);
});

test("a TV conecta com o codigo, sem login: recebe o token e a aula; no banco so o hash do token; o codigo vale uma vez", async () => {
  actAs(null);
  const curto = await conectarTv("ab");
  assert.equal(curto.response.status, 400);
  assert.equal(curto.body.error, "Digite o codigo de seis caracteres.");

  const inexistente = await conectarTv("ZZZZZZ");
  assert.equal(inexistente.response.status, 404);
  assert.equal(inexistente.body.error, "Codigo invalido, expirado ou ja utilizado.");

  // Digitado como aparece na tela ("ABC 123", em minusculas): a rota normaliza.
  const { body, response } = await conectarTv(`${codigo.slice(0, 3).toLowerCase()} ${codigo.slice(3)}`);
  assert.equal(response.status, 200, body.error);
  assert.equal(response.headers.get("cache-control"), SEM_CACHE);
  tokenDaTv = body.data.receiverToken;
  assert.ok(typeof tokenDaTv === "string" && tokenDaTv.length >= 32, "token longo e aleatorio");
  assert.equal(body.data.session.status, "connected");
  assert.equal(body.data.lesson.title, "Aula 1: O que é um agente");
  assert.deepEqual(body.data.lesson.video, { assetId: "aqz-KE-bpKQ", provider: "youtube" });

  const linha = await linhaNoBanco(sessao.id);
  assert.equal(linha.status, "connected");
  assert.equal(linha.receiver_token_hash, createHash("sha256").update(tokenDaTv).digest("hex"), "no banco fica so o SHA-256 do token");
  assert.ok(linha.connected_at && linha.receiver_last_seen_at);

  const repetido = await conectarTv(codigo);
  assert.equal(repetido.response.status, 404, "o mesmo codigo nao conecta uma segunda TV");
  assert.deepEqual((await eventosDaSessao(sessao.id)).map((event) => event.type), ["lesson_tv_session_created", "lesson_tv_connected"]);
});

test("a dona ve a TV conectada; a TV le a sessao com o token (sem token ou com token errado, 401)", async () => {
  actAs(aluna);
  assert.equal((await lerComoDono(sessao.id)).body.data.session.status, "connected");

  actAs(null);
  const semToken = await lerNaTv(sessao.id, "");
  assert.equal(semToken.response.status, 401);
  assert.equal(semToken.body.error, "Token da TV obrigatorio.");

  const tokenErrado = await lerNaTv(sessao.id, TOKEN_ERRADO);
  assert.equal(tokenErrado.response.status, 401);
  assert.equal(tokenErrado.body.error, "Sessao de TV invalida.");

  const { body, response } = await lerNaTv(sessao.id, tokenDaTv);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), SEM_CACHE);
  assert.equal(body.data.session.status, "connected");
  assert.equal(body.data.lesson, undefined, "sem includeLesson a aula nao vem");

  const comAula = await lerNaTv(sessao.id, tokenDaTv, "?includeLesson=1");
  assert.equal(comAula.body.data.lesson.title, "Aula 1: O que é um agente");
});

test("controle remoto: play, pular 10 s, velocidade 1,5x e sincronizar, cada um com revisao maior; a TV le o ultimo; eventos com o tipo", async () => {
  actAs(aluna);
  const play = await mandarComando(sessao.id, { type: "play" });
  assert.equal(play.response.status, 200, play.body.error);
  assert.equal(play.body.data.session.commandRevision, 1);
  assert.deepEqual(play.body.data.session.lastCommand, { type: "play" });

  const pular = await mandarComando(sessao.id, { seconds: 10, type: "seek_relative" });
  assert.equal(pular.body.data.session.commandRevision, 2);

  const velocidade = await mandarComando(sessao.id, { playbackRate: 1.5, type: "set_playback_rate" });
  assert.equal(velocidade.body.data.session.commandRevision, 3);

  const sincronizar = { captionsEnabled: true, currentTimeSeconds: 42, muted: false, playbackRate: 1.5, quality: "auto", shouldPlay: true, type: "sync_player", volume: 80 };
  const sync = await mandarComando(sessao.id, sincronizar);
  assert.equal(sync.response.status, 200, sync.body.error);
  assert.equal(sync.body.data.session.commandRevision, 4);
  assert.deepEqual(sync.body.data.session.lastCommand, sincronizar);

  actAs(null);
  const naTv = await lerNaTv(sessao.id, tokenDaTv);
  assert.equal(naTv.body.data.session.commandRevision, 4);
  assert.equal(naTv.body.data.session.lastCommand.type, "sync_player");
  assert.equal(naTv.body.data.session.receiverCommandRevision, 0, "a TV ainda nao confirmou nenhum comando");

  const eventos = (await eventosDaSessao(sessao.id)).filter((event) => event.type === "lesson_tv_command_sent");
  assert.deepEqual(eventos.map((event) => event.metadata.command_type), ["play", "seek_relative", "set_playback_rate", "sync_player"]);
});

test("comando invalido e recusado (400) sem mudar a revisao; outro aluno nao controla a TV (409)", async () => {
  actAs(aluna);
  const invalidos = [
    { seconds: 5, type: "seek_relative" },
    { playbackRate: 3, type: "set_playback_rate" },
    { type: "fullscreen" },
    { captionsEnabled: true, currentTimeSeconds: 42, muted: false, playbackRate: 1, quality: "auto", shouldPlay: true, type: "sync_player", volume: 101 }
  ];

  for (const command of invalidos) {
    const { body, response } = await mandarComando(sessao.id, command);
    assert.equal(response.status, 400, `${command.type} deveria ser recusado`);
    assert.equal(body.error, "Comando de TV invalido.");
  }

  actAs(alunoSemAcesso);
  assert.equal((await mandarComando(sessao.id, { type: "play" })).response.status, 409);
  assert.equal(Number((await linhaNoBanco(sessao.id)).command_revision), 4);
});

test("heartbeat da TV: estado invalido 400 e token errado 401; o valido grava posicao, velocidade e revisao aplicada, e o progresso da aula aparece para a aluna", async () => {
  actAs(null);
  const invalido = await baterCoracao(sessao.id, tokenDaTv, { currentTimeSeconds: 10, durationSeconds: 600, playbackRate: 3 });
  assert.equal(invalido.response.status, 400);
  assert.equal(invalido.body.error, "Estado de reproducao invalido.");
  assert.equal((await baterCoracao(sessao.id, TOKEN_ERRADO, { currentTimeSeconds: 10, durationSeconds: 600 })).response.status, 401);

  const { body, response } = await baterCoracao(sessao.id, tokenDaTv, {
    appliedCommandRevision: 4,
    availablePlaybackRates: [2, 1, 1.5],
    currentTimeSeconds: 30,
    durationSeconds: 600,
    playbackRate: 1.5,
    playbackState: "playing"
  });
  assert.equal(response.status, 200, body.error);
  const estado = body.data.session;
  assert.equal(estado.receiverCommandRevision, 4, "a TV confirmou o ultimo comando");
  assert.equal(estado.playbackRate, 1.5);
  assert.deepEqual(estado.availablePlaybackRates, [1, 1.5, 2]);
  assert.equal(estado.currentTimeSeconds, 30);
  assert.equal(estado.durationSeconds, 600);
  assert.equal(estado.playbackState, "playing");

  const page = await getLessonPageData(curso.id, curso.modulos.modulo1, aluna);
  assert.equal(page.initialLessonWatchStates[curso.aulas.aula1].progressPercent, 5, "30 s de 600 s");
  assert.equal(page.initialLessonWatchStates[curso.aulas.aula1].status, "in_progress");

  const exagerado = await baterCoracao(sessao.id, tokenDaTv, { appliedCommandRevision: 99, currentTimeSeconds: 31, durationSeconds: 600 });
  assert.equal(exagerado.body.data.session.receiverCommandRevision, 4, "a revisao confirmada nunca passa da ultima enviada");
});

test("a TV avisa que o video terminou: a aula fica concluida para a aluna", async () => {
  actAs(null);
  const { body, response } = await baterCoracao(sessao.id, tokenDaTv, { appliedCommandRevision: 4, currentTimeSeconds: 600, durationSeconds: 600, playbackState: "ended" });
  assert.equal(response.status, 200, body.error);
  assert.equal(body.data.session.playbackState, "ended");

  const page = await getLessonPageData(curso.id, curso.modulos.modulo1, aluna);
  assert.equal(page.initialLessonWatchStates[curso.aulas.aula1].status, "completed");
  assert.equal(page.selectedModule.lessons[0].completed, true);
  assert.equal(page.selectedModule.progress, 50, "1 de 2 aulas do modulo");
});

test("encerrar na aula derruba a TV: a TV le 'ended', o heartbeat e recusado (410), comandos tambem (409); evento registrado", async () => {
  actAs(aluna);
  const response = await sessaoDoAluno.DELETE(pedido(undefined, { method: "DELETE" }), rota(sessao.id));
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.data.session.status, "ended");
  assert.ok(body.data.session.endedAt);

  actAs(null);
  const naTv = await lerNaTv(sessao.id, tokenDaTv);
  assert.equal(naTv.response.status, 200);
  assert.equal(naTv.body.data.session.status, "ended");
  const coracao = await baterCoracao(sessao.id, tokenDaTv, { currentTimeSeconds: 10, durationSeconds: 600 });
  assert.equal(coracao.response.status, 410);
  assert.equal(coracao.body.error, "A sessao de TV foi encerrada.");

  actAs(aluna);
  assert.equal((await mandarComando(sessao.id, { type: "play" })).response.status, 409);

  const tipos = (await eventosDaSessao(sessao.id)).map((event) => event.type);
  assert.deepEqual(tipos, [
    "lesson_tv_session_created",
    "lesson_tv_connected",
    "lesson_tv_command_sent",
    "lesson_tv_command_sent",
    "lesson_tv_command_sent",
    "lesson_tv_command_sent",
    "lesson_tv_session_ended"
  ]);
});

test("codigo expirado nao conecta; sessao expirada derruba a TV conectada (410) e fica encerrada", async () => {
  const passado = new Date(Date.now() - 60_000).toISOString();

  actAs(aluna);
  const expirada = (await iniciarModoTv()).body.data.session;
  unwrap(await db.from("tv_sessions").update({ pairing_expires_at: passado }).eq("id", expirada.id), "Expirando o codigo");
  actAs(null);
  assert.equal((await conectarTv(expirada.pairingCode)).response.status, 404);

  actAs(aluna);
  const outra = (await iniciarModoTv()).body.data.session;
  actAs(null);
  const conexao = await conectarTv(outra.pairingCode);
  assert.equal(conexao.response.status, 200, conexao.body.error);
  unwrap(await db.from("tv_sessions").update({ expires_at: passado, pairing_expires_at: passado }).eq("id", outra.id), "Expirando a sessao");

  const { body, response } = await lerNaTv(outra.id, conexao.body.data.receiverToken);
  assert.equal(response.status, 410);
  assert.equal(body.error, "A sessao de TV expirou.");
  assert.equal((await linhaNoBanco(outra.id)).status, "ended");
});
