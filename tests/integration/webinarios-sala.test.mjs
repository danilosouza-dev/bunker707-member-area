import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, LIVE_GRAVADA_NO_AR_DE_TESTE, limparWebinarios, seedEscolaDeTeste, seedLiveGravadaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// A Sala da Live gravada, fase 2a (docs/30 §1.6, §4.7, §5.1, §6.6, §8.3, §8.5 e §10.2; docs/18 §3) contra o banco
// LOCAL de verdade, com a migracao 202610290001 aplicada: a resposta da sessao traz os campos da sala (relogio
// autoritativo, fase, video da Bunny sem barra e no segundo atual, aceite); a primeira mensagem exige o aceite e,
// com ele, grava o aceite, o nome exibido e os registros do historico (sem o texto); a janela do chat (RPC
// webinar_chat_window) devolve a linha mestre deslocada pela ancora e a propria linha do aluno; a moderada so
// aparece para o autor; a rajada 5/60 s e a palavra bloqueada sao recusadas; o sinal de presenca cria o balde pelo
// offset do servidor e soma amostras no mesmo balde; "Remover minhas mensagens" apaga tudo e retira o aceite;
// quem nao pode ver recebe 404 em toda rota.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const sessionRoute = await import("../../src/app/api/webinars/[id]/session/route.ts");
const chatRoute = await import("../../src/app/api/webinars/[id]/chat/route.ts");
const heartbeatRoute = await import("../../src/app/api/webinars/[id]/heartbeat/route.ts");
const reactionsRoute = await import("../../src/app/api/webinars/[id]/reactions/route.ts");
const { resetRoomLimits } = await import("../../src/server/webinars/room-limits.ts");
const { CHAT_CONSENT_VERSION } = await import("../../src/server/webinars/model.ts");
const { firstNameInitial } = await import("../../src/server/webinars/room-model.ts");

const aluna = usuarioDeTeste(contas.aluna);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);
const pessoas = [aluna.id, alunoSemAcesso.id];
const { id: webinarId, mensagens, origemId, sessaoId, textos } = LIVE_GRAVADA_NO_AR_DE_TESTE;
const contexto = { params: Promise.resolve({ id: webinarId }) };
const MIN = 60_000;

async function limparRastros() {
  unwrap(await db.from("student_events").delete().in("user_id", pessoas).eq("entity_type", "webinar"), "Apagando o historico de webinario de teste");
}

before(async () => {
  await limparWebinarios(db);
  await limparRastros();
  await seedLiveGravadaDeTeste(db, { comecouHa: 90_000 });
  resetRoomLimits();
  heartbeatRoute.resetHeartbeatAccessCache();
});

after(async () => {
  actAs(null);
  await limparWebinarios(db);
  await limparRastros();
});

const pedido = (path, method = "GET", body) =>
  new Request(`http://localhost/api/webinars/${webinarId}/${path}`, body === undefined ? { method } : { body: JSON.stringify(body), headers: { "content-type": "application/json" }, method });
const json = async (response) => ({ body: await response.json(), status: response.status });

async function sessao(user, id = sessaoId) {
  actAs(user);
  return json(await sessionRoute.GET(pedido(`session?sessao=${id}`), contexto));
}

async function enviar(user, body) {
  actAs(user);
  return json(await chatRoute.POST(pedido("chat", "POST", { sessionId: sessaoId, ...body }), contexto));
}

async function janela(user, fromMs, toMs) {
  actAs(user);
  return json(await chatRoute.GET(pedido(`chat?sessao=${sessaoId}&from=${fromMs}&to=${toMs}`), contexto));
}

async function bater(user, body) {
  actAs(user);
  return json(await heartbeatRoute.POST(pedido("heartbeat", "POST", { sessionId: sessaoId, state: "playing", visible: true, ...body }), contexto));
}

async function eventos(userId) {
  return unwrap(await db.from("student_events").select("event_type,entity_id,metadata").eq("user_id", userId).eq("entity_type", "webinar").order("created_at"), "Lendo o historico");
}

async function acesso(accessMode, productId = null) {
  unwrap(await db.from("webinars").update({ access_mode: accessMode, product_id: productId }).eq("id", webinarId), "Mudando quem pode ver");
}

test("1. a sessao traz os campos da sala: relogio autoritativo, fase no ar, entrada aberta, video da Bunny sem barra e no segundo atual, aceite ainda nao dado", async () => {
  assert.equal((await sessao(null)).status, 401);
  const { body, status } = await sessao(aluna);
  assert.equal(status, 200, JSON.stringify(body));
  const { data } = body;
  assert.equal(data.session.kind, "simulated");
  assert.equal(data.session.roomPhase, "live");
  assert.deepEqual(data.session.join, { ok: true });
  assert.ok(data.session.offsetMs >= 85_000 && data.session.offsetMs <= 150_000, `offset do servidor (${data.session.offsetMs})`);
  assert.equal(data.session.durationMs, 3_600_000);
  assert.equal(data.session.chatMode, "open");
  assert.equal(data.session.showLiveBadge, true);
  assert.equal(data.me.consented, false);
  assert.equal(data.presentNow, 0);
  assert.equal(data.webinar.replaySessionId, null, "a sessao replay e criada pelo tick quando a primeira encerra");
  const video = new URL(data.video.embedUrl);
  assert.equal(video.origin + video.pathname, LIVE_GRAVADA_NO_AR_DE_TESTE.videoUrl);
  assert.equal(video.searchParams.get("controls"), "false");
  assert.equal(video.searchParams.get("autoplay"), "true");
  assert.equal(video.searchParams.get("muted"), "true");
  assert.ok(Number(video.searchParams.get("t")) >= 85);
  assert.equal(typeof data.serverTime, "string");
});

test("2. a primeira mensagem exige o aceite; com ele grava o aceite, o nome exibido (primeiro nome + inicial) e o historico sem o texto; o offset e o do servidor", async () => {
  const semAceite = await enviar(aluna, { body: "oi" });
  assert.equal(semAceite.status, 409, JSON.stringify(semAceite.body));
  assert.equal(semAceite.body.reason, "consent_required");

  const primeira = await enviar(aluna, { body: "oi, turma", consent: true, consentVersion: CHAT_CONSENT_VERSION, offsetMs: 7 });
  assert.equal(primeira.status, 201, JSON.stringify(primeira.body));
  const esperado = firstNameInitial(ESCOLA_DE_TESTE.contas.aluna.nome);
  assert.equal(primeira.body.data.message.displayName, esperado);
  assert.equal(primeira.body.data.pending, false);
  assert.ok(primeira.body.data.message.offsetMs >= 85_000, `nunca o 7 do navegador (${primeira.body.data.message.offsetMs})`);

  const aceite = unwrap(await db.from("webinar_chat_consents").select("consent_version,display_mode,revoked_at").eq("user_id", aluna.id).maybeSingle(), "Lendo o aceite");
  assert.deepEqual(aceite, { consent_version: CHAT_CONSENT_VERSION, display_mode: "first_name_initial", revoked_at: null });

  const historico = await eventos(aluna.id);
  assert.deepEqual(historico.map((linha) => [linha.event_type, linha.entity_id]), [["webinar_chat_consented", sessaoId], ["webinar_chat_sent", sessaoId]]);
  assert.deepEqual(historico[0].metadata, { consent_version: CHAT_CONSENT_VERSION, display: "first_name_initial" });
  assert.equal(historico[1].metadata.message_id, primeira.body.data.message.id);
  assert.ok(!JSON.stringify(historico).includes("oi, turma"), "nunca o texto no historico");

  const depois = await sessao(aluna);
  assert.deepEqual([depois.body.data.me.consented, depois.body.data.me.displayMode, depois.body.data.me.displayName], [true, "first_name_initial", esperado]);
});

test("3. a janela do chat (RPC): a linha mestre deslocada pela ancora (105 s na live = 100 s no video) e a linha do aluno; a moderada so para o autor; a consulta de novas e o cursor", async () => {
  const { body, status } = await janela(aluna, 0, 15 * MIN - 1);
  assert.equal(status, 200, JSON.stringify(body));
  const porTexto = Object.fromEntries(body.data.messages.map((message) => [message.body, message]));
  assert.equal(porTexto[textos.cedo].offsetMs, 100_000, "deslocada pela ancora de 5 s");
  assert.equal(porTexto[textos.cedo].role, "student");
  assert.equal(porTexto[textos.cedo].mine, false);
  assert.ok(!("source" in porTexto[textos.cedo]), "a origem fica so no banco");
  assert.equal(porTexto["oi, turma"].mine, true);
  assert.ok(!(textos.tarde in porTexto), "aos 20 min: fora da janela de 15 min");
  assert.equal(porTexto[textos.cedo].id, mensagens.cedo);

  // Chat moderado: a pendente do aluno so aparece para ele.
  unwrap(await db.from("webinar_sessions").update({ chat_mode: "moderated" }).eq("id", sessaoId), "Ligando a moderacao");
  const pendente = await enviar(aluna, { body: "espera a equipe" });
  assert.equal(pendente.status, 201, JSON.stringify(pendente.body));
  assert.equal(pendente.body.data.pending, true);
  const minha = await janela(aluna, 0, 15 * MIN - 1);
  assert.ok(minha.body.data.messages.some((message) => message.body === "espera a equipe" && message.pending));
  const deOutro = await janela(alunoSemAcesso, 0, 15 * MIN - 1);
  assert.equal(deOutro.status, 200, "aberto para todos, o outro aluno tambem le");
  assert.ok(!deOutro.body.data.messages.some((message) => message.body === "espera a equipe"), "a pendente nao vaza");
  unwrap(await db.from("webinar_sessions").update({ chat_mode: "open" }).eq("id", sessaoId), "Desligando a moderacao");

  actAs(aluna);
  const desde = new Date(Date.now() - 5 * MIN).toISOString();
  const novas = await json(await chatRoute.GET(pedido(`chat?sessao=${sessaoId}&since=${encodeURIComponent(desde)}`), contexto));
  assert.equal(novas.status, 200, JSON.stringify(novas.body));
  assert.deepEqual(novas.body.data.messages.map((message) => message.body), ["oi, turma", "espera a equipe"]);
  assert.equal(typeof novas.body.data.next.after, "string");
  const repetida = await json(await chatRoute.GET(pedido(`chat?sessao=${sessaoId}&since=${encodeURIComponent(novas.body.data.next.since)}&after=${novas.body.data.next.after}`), contexto));
  assert.deepEqual(repetida.body.data.messages, [], "depois do cursor, nada");
});

test("4. rajada 5/60 s (a 6a e 429 com Retry-After), palavra bloqueada 422 e a reacao 1 por segundo", async () => {
  resetRoomLimits();
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await enviar(aluna, { body: `rajada ${i}` })).status, 201);
  }
  actAs(aluna);
  const sexta = await chatRoute.POST(pedido("chat", "POST", { body: "rajada 6", sessionId: sessaoId }), contexto);
  assert.equal(sexta.status, 429);
  assert.match(sexta.headers.get("Retry-After") ?? "", /^\d+$/);
  resetRoomLimits();

  // normalized_word e obrigatoria e unica (a mesma normalizacao de normalizeCommentForModeration).
  const regra = unwrap(
    await db
      .from("lesson_comment_blocked_words")
      .upsert({ active: true, message: "Sem isso na live.", normalized_word: "teste proibida", word: "teste-proibida" }, { onConflict: "normalized_word" })
      .select("id")
      .single(),
    "Palavra bloqueada de teste"
  );
  const bloqueada = await enviar(aluna, { body: "uma teste-proibida aqui" });
  unwrap(await db.from("lesson_comment_blocked_words").delete().eq("id", regra.id), "Apagando a palavra bloqueada de teste");
  assert.equal(bloqueada.status, 422, JSON.stringify(bloqueada.body));
  assert.equal(bloqueada.body.error, "Sem isso na live.");

  actAs(aluna);
  const reacao = await json(await reactionsRoute.POST(pedido("reactions", "POST", { reaction: "clap", sessionId: sessaoId }), contexto));
  assert.equal(reacao.status, 201, JSON.stringify(reacao.body));
  const seguida = await reactionsRoute.POST(pedido("reactions", "POST", { reaction: "fire", sessionId: sessaoId }), contexto);
  assert.equal(seguida.status, 429);
  assert.equal(seguida.headers.get("Retry-After"), "1");
  const contagens = await json(await reactionsRoute.GET(pedido(`reactions?sessao=${sessaoId}`), contexto));
  assert.equal(contagens.body.data.counts.clap, 1);
  assert.ok((await eventos(aluna.id)).some((linha) => linha.event_type === "webinar_reaction_sent" && linha.metadata.reaction === "clap"));
});

test("5. presenca: o balde pelo offset do servidor, webinar_joined no primeiro sinal, dois sinais no mesmo balde = 1 linha com 2 amostras, o leave grava webinar_left; o contador da sala", async () => {
  const primeiro = await bater(aluna, { offsetSeconds: 3 });
  assert.equal(primeiro.status, 200, JSON.stringify(primeiro.body));
  assert.equal(primeiro.body.data.presentNow, 1);
  assert.equal(primeiro.body.data.ended, false);
  const segundo = await bater(aluna, { offsetSeconds: 4 });
  assert.equal(segundo.status, 200);

  const amostras = unwrap(await db.from("webinar_presence_samples").select("bucket,samples,offset_seconds,state").eq("session_id", sessaoId).eq("user_id", aluna.id), "Lendo a presenca");
  assert.equal(amostras.length, 1, "dois sinais no mesmo balde de 30 s sao uma linha");
  assert.equal(amostras[0].samples, 2);
  assert.ok(amostras[0].offset_seconds >= 85, `o offset do servidor (${amostras[0].offset_seconds}), nunca os 3 s do navegador`);
  assert.equal(amostras[0].bucket, Math.floor(amostras[0].offset_seconds / 30));

  const joined = (await eventos(aluna.id)).filter((linha) => linha.event_type === "webinar_joined");
  assert.equal(joined.length, 1);
  assert.deepEqual(joined[0].metadata, { device: "desktop", kind: "simulated" });

  const saida = await bater(aluna, { leave: true, offsetSeconds: 5, state: "hidden", visible: false });
  assert.equal(saida.status, 200);
  const left = (await eventos(aluna.id)).filter((linha) => linha.event_type === "webinar_left");
  assert.equal(left.length, 1);
  assert.equal(left[0].metadata.reason, "closed");
  assert.equal(left[0].metadata.seconds_present, 30);

  const outro = await bater(alunoSemAcesso, { offsetSeconds: 0 });
  assert.equal(outro.body.data.presentNow, 2, "os dois nos ultimos 3 baldes");
  assert.equal((await sessao(aluna)).body.data.presentNow, 2);
});

test("6. Remover minhas mensagens: apaga (consent_revoked) o que o aluno escreveu, retira o aceite e grava revoked; a proxima mensagem pede o aceite de novo", async () => {
  actAs(aluna);
  const antes = unwrap(await db.from("webinar_chat_messages").select("id").eq("author_user_id", aluna.id).is("deleted_at", null), "Contando as mensagens");
  assert.ok(antes.length >= 6);
  const removido = await json(await chatRoute.DELETE(pedido("chat", "DELETE", { all: true }), contexto));
  assert.equal(removido.status, 200, JSON.stringify(removido.body));
  assert.equal(removido.body.data.removed, antes.length);

  const depois = unwrap(await db.from("webinar_chat_messages").select("deleted_at,deleted_reason").eq("author_user_id", aluna.id), "Lendo as mensagens");
  assert.ok(depois.every((row) => row.deleted_at && row.deleted_reason === "consent_revoked"));
  const mestre = unwrap(await db.from("webinar_chat_messages").select("deleted_at").eq("id", mensagens.cedo).single(), "Lendo a linha mestre");
  assert.equal(mestre.deleted_at, null, "a linha mestre de outra pessoa fica");
  const aceite = unwrap(await db.from("webinar_chat_consents").select("revoked_at").eq("user_id", aluna.id).single(), "Lendo o aceite");
  assert.ok(aceite.revoked_at);
  const revogado = (await eventos(aluna.id)).filter((linha) => linha.event_type === "webinar_chat_consented");
  assert.deepEqual(revogado.at(-1).metadata, { consent_version: CHAT_CONSENT_VERSION, revoked: true });

  const janelaDepois = await janela(aluna, 0, 15 * MIN - 1);
  assert.ok(!janelaDepois.body.data.messages.some((message) => message.mine), "nada do aluno reaparece");
  assert.equal((await enviar(aluna, { body: "de volta" })).body.reason, "consent_required");
});

test("7. quem nao pode ver recebe 404 em toda rota da sala, sem dizer se o webinario existe", async () => {
  await acesso("product", "produto-que-ninguem-tem");
  assert.equal((await sessao(alunoSemAcesso)).status, 404);
  assert.equal((await enviar(alunoSemAcesso, { body: "x", consent: true, consentVersion: CHAT_CONSENT_VERSION })).status, 404);
  assert.equal((await janela(alunoSemAcesso, 0, 1000)).status, 404);
  heartbeatRoute.resetHeartbeatAccessCache();
  assert.equal((await bater(alunoSemAcesso, { offsetSeconds: 0 })).status, 404);
  actAs(alunoSemAcesso);
  assert.equal((await reactionsRoute.POST(pedido("reactions", "POST", { reaction: "like", sessionId: sessaoId }), contexto)).status, 404);
  await acesso("everyone");
  assert.equal((await sessao(alunoSemAcesso)).status, 200, "aberto para todos de novo");
  // A sessao de outro webinario (a de origem e deste; um id que nao existe nao e): 404.
  assert.equal((await sessao(aluna, "bbbbbbbb-0000-4000-8000-0000000000ff")).status, 404);
  assert.equal((await sessao(aluna, origemId)).status, 200, "a live de origem e deste webinario");
});
