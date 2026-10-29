import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, readLocalSupabaseConfig, unwrap } from "../support/local-db.mjs";
import {
  ambienteDaSalaAoVivo,
  LIVE_AO_VIVO_DE_TESTE,
  LIVE_GRAVADA_DE_TESTE,
  limparWebinarios,
  seedEscolaDeTeste,
  seedLiveAoVivoDeTeste,
  seedLiveGravadaEncerradaDeTeste,
  SENHA_DE_TESTE,
  usuarioDeTeste
} from "../fixtures/escola-de-teste.mjs";

// A sala da Live ao vivo, fase 3 (docs/30 §1.4, §4.2, §4.7, §5.1, §5.3, §5.4, §6.5, §8.1 e §8.2; docs/18 §3) contra o
// banco LOCAL de verdade, com as migracoes 202610290002 e 202610290003 aplicadas. O ambiente da sala (hostname, segredo do token,
// segredo do webhook e o duble do pedido ao GitHub) entra em process.env ANTES das rotas, com os valores so de teste
// de tests/fixtures/escola-de-teste.mjs (o .env.test.local deixa essas chaves vazias). Aqui:
// - POST .../join-token: 401 sem sessao, 404 fora do acesso, num webinario que nao existe e com a sessao pedida pelo
//   endereco de outro webinario de verdade (a Live gravada de teste, aberta para a aluna), 503 meet_unconfigured sem o
//   hostname, o aluno 409 not_started com a sala fechada e a equipe ja na Sessao de pratica, 200 com o token conferido
//   por verifyJitsiToken (room = room_name, sub = hostname, moderator pela matriz de §5.4: host e co-apresentador sim,
//   Equipe so com can_moderate_room, aluno nunca), removido 409 kicked e banido 409 banned (linhas de verdade em
//   webinar_session_bans e webinar_user_bans) e webinar_joined uma vez por abertura, so do aluno;
// - as escritas da sala: banido 409 banned, silenciado 409 muted no chat mas reage, e GET .../session com live e
//   me.ban;
// - POST .../room-events: 202 { accepted } e cada sinal vira student_events so com codigos; nome desconhecido e lote
//   grande 400;
// - POST /api/webhooks/recorder (recorderHeaders com o segredo de teste): sem assinatura ou com a errada 401 e nada
//   gravado, sessao desconhecida 202 ignored, `ready` e o repetido (200 duplicate), o corpo cru em
//   webinar_recording_events, `uploaded` cria webinar_recordings jibri em processing com o bunnyVideoId, e o GET
//   assinado do jibri-down;
// - a RPC webinar_mark_recording_anchor: uma vez, gravador em recording, o "Gravar" sai da fila, e o que veio antes
//   (chat, reacao, pergunta, resposta e abertura da enquete) fica com offset negativo pela ancora; a presenca da live
//   conta desde started_at, nunca pela ancora;
// - 202610290003: a escrita em voo durante a ancora fica no relogio da ancora (trigger) e a mensagem da live postada
//   pela rota nasce master e aparece no replay pela webinar_chat_window (D31);
// - GET /api/webhooks/room-guard (assinado com a chave derivada do segredo do token): o removido na sala dele e o banido
//   em todas, para o Prosody recusar o token antigo;
// - RLS: o aluno logado recebe 42501 na RPC e nas tres tabelas novas.

const ambiente = ambienteDaSalaAoVivo(process.env);
const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const { anonKey, url: supabaseUrl } = readLocalSupabaseConfig();
const joinTokenRoute = await import("../../src/app/api/webinars/[id]/join-token/route.ts");
const roomEventsRoute = await import("../../src/app/api/webinars/[id]/room-events/route.ts");
const sessionRoute = await import("../../src/app/api/webinars/[id]/session/route.ts");
const chatRoute = await import("../../src/app/api/webinars/[id]/chat/route.ts");
const reactionsRoute = await import("../../src/app/api/webinars/[id]/reactions/route.ts");
const heartbeatRoute = await import("../../src/app/api/webinars/[id]/heartbeat/route.ts");
const recorderRoute = await import("../../src/app/api/webhooks/recorder/route.ts");
const recorderStatusRoute = await import("../../src/app/api/webhooks/recorder/[sessionId]/route.ts");
const roomGuardRoute = await import("../../src/app/api/webhooks/room-guard/route.ts");
const { resetRoomLimits } = await import("../../src/server/webinars/room-limits.ts");
const { verifyJitsiToken } = await import("../../src/server/webinars/jitsi-token.ts");
const { recorderHeaders, roomGuardKey } = await import("../../src/server/webinars/recorder-signature.ts");
const { CHAT_CONSENT_VERSION } = await import("../../src/server/webinars/model.ts");

const aluna = usuarioDeTeste(contas.aluna);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);
const produtor = usuarioDeTeste(contas.produtor);
const professor = usuarioDeTeste(contas.professor);
const analista = usuarioDeTeste(contas.analista);
const pessoas = [aluna.id, alunoSemAcesso.id, produtor.id, professor.id, analista.id];
const { id: webinarId, roomName, sessaoId } = LIVE_AO_VIVO_DE_TESTE;
const contexto = { params: Promise.resolve({ id: webinarId }) };
const SESSAO_DESCONHECIDA = "bbbbbbbb-0000-4000-8000-0000000000fe";
const OUTRO_WEBINARIO = "bbbbbbbb-0000-4000-8000-0000000000ff";
const VIDEO_DA_BUNNY = "teste-ao-vivo-0b1c2d3e-aaaa";

async function limparRastros() {
  unwrap(await db.from("student_events").delete().in("user_id", pessoas).eq("entity_type", "webinar"), "Apagando o historico de webinario de teste");
}

before(async () => {
  await limparWebinarios(db);
  await limparRastros();
  await seedLiveAoVivoDeTeste(db, { status: "scheduled" });
  // Um segundo webinario de verdade, aberto para a aluna: o "404 noutro webinario" vem da conferencia sessao x webinario.
  await seedLiveGravadaEncerradaDeTeste(db);
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

async function pedirToken(user, sessionId = sessaoId, ctx = contexto) {
  actAs(user);
  return json(await joinTokenRoute.POST(pedido("join-token", "POST", { sessionId }), ctx));
}

async function sinais(user, events) {
  actAs(user);
  return json(await roomEventsRoute.POST(pedido("room-events", "POST", { events, sessionId: sessaoId }), contexto));
}

async function sessao(user) {
  actAs(user);
  return json(await sessionRoute.GET(pedido(`session?sessao=${sessaoId}`), contexto));
}

async function eventos(userId) {
  return unwrap(
    await db.from("student_events").select("event_type,metadata").eq("user_id", userId).eq("entity_type", "webinar").eq("entity_id", sessaoId).order("created_at"),
    "Lendo o historico da live"
  );
}

async function situacao(status, extra = {}) {
  unwrap(await db.from("webinar_sessions").update({ status, ...extra }).eq("id", sessaoId), "Mudando a situacao da sessao");
}

/** O webhook do gravador como a maquina chama: o corpo cru assinado (ou com cabecalhos dados). */
async function webhook(corpo, headers) {
  const bruto = JSON.stringify(corpo);
  const response = await recorderRoute.POST(
    new Request("http://localhost/api/webhooks/recorder", { body: bruto, headers: headers ?? recorderHeaders(ambiente.WEBINAR_RECORDER_WEBHOOK_SECRET, bruto, Date.now()), method: "POST" })
  );
  return json(response);
}

async function pedidosDoGravador(sessionId = sessaoId) {
  return unwrap(
    await db.from("webinar_recording_events").select("state,room,file_name,payload,signature_valid,processing_status").eq("session_id", sessionId).order("received_at"),
    "Lendo os pedidos do gravador"
  );
}

function claimsDe(reply) {
  const claims = verifyJitsiToken(reply.jwt, ambiente.WEBINAR_JWT_SECRET);
  assert.ok(claims, "o token confere com o segredo do app (o mesmo JWT_APP_SECRET do Jitsi)");
  return claims;
}

test("1. join-token: 401 sem sessao, 404 fora do acesso e noutro webinario, 503 sem a sala ao vivo; com a sala fechada o aluno recebe 409 not_started e o co-apresentador entra na Sessao de pratica", async () => {
  assert.equal((await pedirToken(null)).status, 401);

  const fechada = await pedirToken(aluna);
  assert.equal(fechada.status, 409, JSON.stringify(fechada.body));
  assert.equal(fechada.body.reason, "not_started");

  const pratica = await pedirToken(professor);
  assert.equal(pratica.status, 200, JSON.stringify(pratica.body));
  assert.equal(pratica.body.data.role, "co_host");
  assert.equal(claimsDe(pratica.body.data).context.user.moderator, true);

  unwrap(await db.from("webinars").update({ access_mode: "product", product_id: "produto-que-ninguem-tem" }).eq("id", webinarId), "Fechando o acesso");
  assert.equal((await pedirToken(aluna)).status, 404, "fora do acesso: 404 sem dizer se existe");
  unwrap(await db.from("webinars").update({ access_mode: "everyone", product_id: null }).eq("id", webinarId), "Abrindo o acesso");

  const inexistente = await pedirToken(aluna, sessaoId, { params: Promise.resolve({ id: OUTRO_WEBINARIO }) });
  assert.equal(inexistente.status, 404, "webinario que nao existe");
  // O webinario existe e a aluna tem acesso (a sessao dele abre); a sessao pedida e a da live, de OUTRO webinario: 404.
  const outroContexto = { params: Promise.resolve({ id: LIVE_GRAVADA_DE_TESTE.id }) };
  actAs(aluna);
  const daOutra = await json(await sessionRoute.GET(new Request(`http://localhost/api/webinars/${LIVE_GRAVADA_DE_TESTE.id}/session?sessao=${LIVE_GRAVADA_DE_TESTE.sessaoId}`), outroContexto));
  assert.equal(daOutra.status, 200, `o outro webinario e acessivel: ${JSON.stringify(daOutra.body)}`);
  const outro = await pedirToken(aluna, sessaoId, outroContexto);
  assert.equal(outro.status, 404, "a sessao da live pedida pelo endereco de outro webinario");

  const dominio = process.env.WEBINAR_MEET_DOMAIN;
  delete process.env.WEBINAR_MEET_DOMAIN;
  try {
    const semSala = await pedirToken(produtor);
    assert.equal(semSala.status, 503, JSON.stringify(semSala.body));
    assert.equal(semSala.body.reason, "meet_unconfigured");
  } finally {
    process.env.WEBINAR_MEET_DOMAIN = dominio;
  }

  assert.deepEqual(await eventos(aluna.id), [], "nada de webinar_joined sem token");
});

test("2. join-token 200 com a sala aberta: o token confere, a sala e a room_name, o papel e o moderator pela matriz de §5.4 e webinar_joined uma vez, so do aluno", async () => {
  await situacao("waiting");
  resetRoomLimits();

  // A sala aberta na Sessao de pratica (o card Sala da live de teste a liga) e so da equipe: o aluno espera fora (D35).
  const pratica = await pedirToken(aluna);
  assert.equal(pratica.status, 409, JSON.stringify(pratica.body));
  assert.equal(pratica.body.reason, "not_started");
  await situacao("live", { started_at: new Date(Date.now() - 60_000).toISOString() });

  const primeiro = await pedirToken(aluna);
  assert.equal(primeiro.status, 200, JSON.stringify(primeiro.body));
  const reply = primeiro.body.data;
  assert.deepEqual(Object.keys(reply).sort(), ["domain", "expiresAt", "jwt", "refreshAt", "role", "room", "settings"]);
  assert.equal(reply.domain, ambiente.WEBINAR_MEET_DOMAIN);
  assert.equal(reply.room, roomName);
  assert.equal(reply.role, "student");
  assert.deepEqual(reply.settings, { allowStudentCamera: true, screenFps: 30, stage: 720 });
  assert.ok(Date.parse(reply.refreshAt) < Date.parse(reply.expiresAt), "pede outro token antes de vencer");

  const claims = claimsDe(reply);
  assert.equal(claims.room, roomName, "a sala so vai dentro do token");
  assert.equal(claims.sub, ambiente.WEBINAR_MEET_DOMAIN);
  assert.equal(claims.iss, "bunker707");
  assert.equal(claims.aud, "bunker707");
  assert.equal(claims.exp * 1000, Date.parse(reply.expiresAt));
  assert.ok(claims.nbf <= claims.iat - 60, "nbf = agora - 60 s");
  assert.ok(claims.exp - claims.iat <= 15 * 60, "nunca mais de 15 min (o token que fica no navegador do removido morre logo)");
  assert.equal(claims.context.user.id, aluna.id);
  assert.equal(claims.context.user.moderator, undefined, "o aluno nunca e moderador");
  assert.deepEqual(claims.context.features, { livestreaming: false, "outbound-call": false, recording: false, "screen-sharing": false }, "o aluno sem tela nem gravacao");
  assert.ok(!JSON.stringify(claims).includes(contas.aluna.email), "nunca o e-mail");

  const segundo = await pedirToken(aluna);
  assert.equal(segundo.status, 200, "renovar o token");
  const entradas = (await eventos(aluna.id)).filter((linha) => linha.event_type === "webinar_joined");
  assert.equal(entradas.length, 1, "webinar_joined uma vez por abertura");
  assert.equal(entradas[0].metadata.kind, "live");

  const host = await pedirToken(produtor);
  assert.equal(host.status, 200, JSON.stringify(host.body));
  assert.equal(host.body.data.role, "host");
  const hostClaims = claimsDe(host.body.data);
  assert.equal(hostClaims.context.user.moderator, true);
  assert.equal(hostClaims.context.user.affiliation, "owner");
  assert.equal(hostClaims.context.features.recording, true);
  assert.equal(hostClaims.context.features["screen-sharing"], true);

  const coHost = await pedirToken(professor);
  assert.equal(coHost.body.data.role, "co_host");
  const coHostClaims = claimsDe(coHost.body.data);
  assert.equal(coHostClaims.context.user.moderator, true);
  assert.equal(coHostClaims.context.features.recording, false, "so o Apresentador grava");

  const equipe = await pedirToken(analista);
  assert.equal(equipe.status, 200, JSON.stringify(equipe.body));
  assert.equal(equipe.body.data.role, "team");
  assert.equal(claimsDe(equipe.body.data).context.user.moderator, undefined, "Equipe sem can_moderate_room nao e moderadora");

  unwrap(await db.from("webinar_presenters").update({ can_moderate_room: true }).eq("webinar_id", webinarId).eq("user_id", analista.id), "Marcando a Equipe como moderadora");
  const moderadora = await pedirToken(analista);
  assert.equal(claimsDe(moderadora.body.data).context.user.moderator, true, "com Pode remover e silenciar na sala");
  unwrap(await db.from("webinar_presenters").update({ can_moderate_room: false }).eq("webinar_id", webinarId).eq("user_id", analista.id), "Desmarcando a Equipe");

  for (const pessoa of [produtor, professor, analista]) {
    assert.equal((await eventos(pessoa.id)).filter((linha) => linha.event_type === "webinar_joined").length, 0, "a equipe na sala nao e plateia");
  }
});

test("3. removido 409 kicked e banido 409 banned (linhas reais); silenciado nao escreve no chat (409 muted) mas reage; GET .../session traz live e me.ban", async () => {
  await situacao("live", { started_at: new Date(Date.now() - 5 * 60_000).toISOString() });
  resetRoomLimits();

  unwrap(await db.from("webinar_session_bans").insert({ by_user_id: produtor.id, kind: "kicked", session_id: sessaoId, user_id: aluna.id }), "Removendo a aluna");
  const removida = await pedirToken(aluna);
  assert.equal(removida.status, 409, JSON.stringify(removida.body));
  assert.equal(removida.body.reason, "kicked");
  const sinalRemovida = await sinais(aluna, [{ at: new Date().toISOString(), name: "videoConferenceJoined", data: { participantId: "aluna0001" } }]);
  assert.equal(sinalRemovida.status, 409);
  assert.equal(sinalRemovida.body.reason, "banned", "as escritas da sala dizem banned para quem foi removido");
  assert.equal((await sessao(aluna)).body.data.me.ban.kicked, true);
  unwrap(await db.from("webinar_session_bans").delete().eq("session_id", sessaoId).eq("user_id", aluna.id), "Desfazendo");

  unwrap(await db.from("webinar_user_bans").insert({ by_user_id: produtor.id, session_id: sessaoId, user_id: aluna.id }), "Banindo a aluna de todas");
  const banida = await pedirToken(aluna);
  assert.equal(banida.status, 409);
  assert.equal(banida.body.reason, "banned");
  actAs(aluna);
  const chatBanida = await json(await chatRoute.POST(pedido("chat", "POST", { body: "oi", consent: true, consentVersion: CHAT_CONSENT_VERSION, sessionId: sessaoId }), contexto));
  assert.equal(chatBanida.status, 409);
  assert.equal(chatBanida.body.reason, "banned");
  unwrap(await db.from("webinar_user_bans").delete().eq("user_id", aluna.id), "Desfazendo o banimento");

  const ate = new Date(Date.now() + 5 * 60_000).toISOString();
  unwrap(await db.from("webinar_session_bans").insert({ by_user_id: produtor.id, kind: "muted", session_id: sessaoId, until_at: ate, user_id: aluna.id }), "Silenciando a aluna");
  actAs(aluna);
  const silenciada = await json(await chatRoute.POST(pedido("chat", "POST", { body: "posso falar?", consent: true, consentVersion: CHAT_CONSENT_VERSION, sessionId: sessaoId }), contexto));
  assert.equal(silenciada.status, 409, JSON.stringify(silenciada.body));
  assert.equal(silenciada.body.reason, "muted");
  actAs(aluna);
  const reacao = await reactionsRoute.POST(pedido("reactions", "POST", { reaction: "clap", sessionId: sessaoId }), contexto);
  assert.equal(reacao.status, 201, "silenciado ainda reage");
  assert.equal((await pedirToken(aluna)).status, 200, "silenciado ainda assiste");

  const leitura = await sessao(aluna);
  assert.equal(leitura.status, 200, JSON.stringify(leitura.body));
  assert.deepEqual(leitura.body.data.me.ban, { banned: false, kicked: false, muted: true, mutedUntil: leitura.body.data.me.ban.mutedUntil });
  assert.equal(Date.parse(leitura.body.data.me.ban.mutedUntil), Date.parse(ate));
  const live = leitura.body.data.live;
  assert.deepEqual(Object.keys(live).sort(), ["lobby", "locked", "meetConfigured", "practice", "recording", "startedAt", "status"]);
  assert.deepEqual([live.lobby, live.locked, live.meetConfigured, live.practice, live.recording, live.status], [false, false, true, false, false, "live"]);
  assert.ok(!JSON.stringify(leitura.body).includes(roomName), "a sessao nunca leva o nome da sala");
  unwrap(await db.from("webinar_session_bans").delete().eq("session_id", sessaoId).eq("user_id", aluna.id), "Desfazendo o silencio");
});

test("3b. a lista de barrados do Prosody: o removido aparece na sala dele e o banido em todas (o token antigo nao abre a sala de novo); o Desfazer tira", async () => {
  await situacao("live", { started_at: new Date(Date.now() - 5 * 60_000).toISOString() });
  const lista = async (headers) => json(await roomGuardRoute.GET(new Request("http://localhost/api/webhooks/room-guard", { headers: headers ?? recorderHeaders(roomGuardKey(ambiente.WEBINAR_JWT_SECRET), "", Date.now()) })));
  assert.equal((await lista({})).status, 401, "sem a assinatura do Prosody");

  unwrap(await db.from("webinar_session_bans").insert({ by_user_id: produtor.id, kind: "kicked", session_id: sessaoId, user_id: aluna.id }), "Removendo a aluna");
  unwrap(await db.from("webinar_user_bans").insert({ by_user_id: produtor.id, session_id: sessaoId, user_id: alunoSemAcesso.id }), "Banindo o aluno");
  try {
    const barrados = await lista();
    assert.equal(barrados.status, 200, JSON.stringify(barrados.body));
    assert.deepEqual(barrados.body.rooms[roomName], [aluna.id], "a conta do token removida desta sala");
    assert.ok(barrados.body.banned.includes(alunoSemAcesso.id), "o banido de todas");
  } finally {
    unwrap(await db.from("webinar_session_bans").delete().eq("session_id", sessaoId).eq("user_id", aluna.id), "Desfazendo");
    unwrap(await db.from("webinar_user_bans").delete().eq("user_id", alunoSemAcesso.id), "Desfazendo o banimento");
  }
  const depois = await lista();
  assert.deepEqual(depois.body.rooms[roomName], [], "desfeito: entra de novo");
});

test("4. room-events: 202 { accepted } e cada sinal vira student_events so com codigos; recordingStatusChanged fica fora; nome desconhecido e lote de 21 sao 400", async () => {
  resetRoomLimits();
  const agora = new Date().toISOString();
  const resposta = await sinais(aluna, [
    { at: agora, data: { participantId: "aluna0001" }, name: "videoConferenceJoined" },
    { at: agora, data: { raised: true }, name: "raiseHandUpdated" },
    { at: agora, data: { muted: false }, name: "audioMuteStatusChanged" },
    { at: agora, data: { consented: true, muted: false }, name: "videoMuteStatusChanged" },
    { at: agora, data: { role: "participant" }, name: "participantRoleChanged" },
    { at: agora, data: { code: "conference.connectionError", fatal: false }, name: "errorOccurred" },
    { at: agora, data: { on: true }, name: "recordingStatusChanged" },
    { at: agora, name: "videoConferenceLeft" }
  ]);
  assert.equal(resposta.status, 202, JSON.stringify(resposta.body));
  assert.deepEqual(resposta.body.data, { accepted: 7 });

  const linhas = (await eventos(aluna.id)).filter((linha) => linha.event_type.startsWith("webinar_room") || ["webinar_hand_raised", "webinar_mic_toggled", "webinar_camera_toggled"].includes(linha.event_type));
  // As sete linhas saem num insert so (o mesmo created_at): a conferencia e pelo conjunto, nao pela ordem.
  assert.deepEqual(
    linhas.map((linha) => linha.event_type).sort(),
    ["webinar_camera_toggled", "webinar_hand_raised", "webinar_mic_toggled", "webinar_room_error", "webinar_room_joined", "webinar_room_left", "webinar_room_role"]
  );
  const porTipo = Object.fromEntries(linhas.map((linha) => [linha.event_type, linha.metadata]));
  assert.equal(porTipo.webinar_room_joined.participant_id, "aluna0001");
  assert.equal(porTipo.webinar_hand_raised.raised, true);
  assert.equal(porTipo.webinar_mic_toggled.on, true);
  assert.deepEqual([porTipo.webinar_camera_toggled.on, porTipo.webinar_camera_toggled.consented], [true, true]);
  assert.equal(porTipo.webinar_room_role.role, "participant");
  assert.deepEqual([porTipo.webinar_room_error.code, porTipo.webinar_room_error.fatal], ["conference.connectionError", false]);
  for (const linha of linhas) {
    assert.equal(typeof linha.metadata.offset_ms, "number", `${linha.event_type}: o offset do servidor`);
    assert.equal(linha.metadata.at, agora, `${linha.event_type}: a hora do aparelho so para conferencia`);
  }

  const desconhecido = await sinais(aluna, [{ at: agora, data: { text: "oi" }, name: "endpointTextMessageReceived" }]);
  assert.equal(desconhecido.status, 400, "so os nomes combinados; texto nunca");
  const grande = await sinais(aluna, Array.from({ length: 21 }, () => ({ at: agora, name: "videoConferenceLeft" })));
  assert.equal(grande.status, 400, "no maximo 20 sinais por lote");
  assert.equal((await sinais(null, [{ at: agora, name: "videoConferenceLeft" }])).status, 401);
});

test("5. webhook do gravador: sem assinatura ou com a errada 401 e nada gravado; sessao desconhecida 202 ignored; ready processado e o repetido 200 duplicate, com o corpo cru guardado", async () => {
  const pronto = { room: roomName, sessionId: sessaoId, state: "ready" };

  const semCabecalho = await webhook(pronto, { "content-type": "application/json" });
  assert.equal(semCabecalho.status, 401);
  const bruto = JSON.stringify(pronto);
  const errada = await webhook(pronto, recorderHeaders("segredo-de-outra-maquina-que-nao-e-o-do-app-0000", bruto, Date.now()));
  assert.equal(errada.status, 401);
  const velha = await webhook(pronto, recorderHeaders(ambiente.WEBINAR_RECORDER_WEBHOOK_SECRET, bruto, Date.now() - 6 * 60_000));
  assert.equal(velha.status, 401, "carimbo de 6 min atras");
  assert.deepEqual(await pedidosDoGravador(), [], "nada gravado sem assinatura valida");
  assert.equal((await db.from("webinar_sessions").select("recorder_status").eq("id", sessaoId).single()).data.recorder_status, "none");

  const desconhecida = await webhook({ sessionId: SESSAO_DESCONHECIDA, state: "ready" });
  assert.equal(desconhecida.status, 202, JSON.stringify(desconhecida.body));
  assert.equal(desconhecida.body.status, "ignored");
  const orfa = unwrap(await db.from("webinar_recording_events").select("session_id,processing_status,payload").is("session_id", null).eq("payload->>sessionId", SESSAO_DESCONHECIDA), "Lendo o pedido sem sessao");
  assert.equal(orfa.length, 1);
  assert.equal(orfa[0].processing_status, "ignored");

  const primeiro = await webhook(pronto);
  assert.equal(primeiro.status, 200, JSON.stringify(primeiro.body));
  assert.deepEqual([primeiro.body.status, primeiro.body.recorderStatus], ["processed", "ready"]);
  const linhas = await pedidosDoGravador();
  assert.equal(linhas.length, 1);
  assert.deepEqual(linhas[0].payload, pronto, "o corpo cru, para auditoria e reprocessamento");
  assert.deepEqual([linhas[0].state, linhas[0].room, linhas[0].signature_valid, linhas[0].processing_status], ["ready", roomName, true, "processed"]);

  const repetido = await webhook(pronto);
  assert.equal(repetido.status, 200);
  assert.equal(repetido.body.status, "duplicate");
  assert.equal((await pedidosDoGravador()).length, 1, "idempotente por sessao + estado + arquivo");
  const depois = unwrap(await db.from("webinar_sessions").select("recorder_status").eq("id", sessaoId).single(), "Lendo o gravador");
  assert.equal(depois.recorder_status, "ready");
});

test("6. webinar_mark_recording_anchor: grava a ancora uma vez, poe o gravador em recording, tira o Gravar da fila e recalcula pela ancora o que veio antes; a presenca da live conta desde started_at", async () => {
  const inicio = Date.now() - 5 * 60_000;
  unwrap(
    await db.from("webinar_sessions").update({ recording_anchor_at: null, recording_requested_at: new Date(Date.now() - 60_000).toISOString(), started_at: new Date(inicio).toISOString() }).eq("id", sessaoId),
    "Pondo o Gravar na fila"
  );
  const ancora = Date.now();
  const antes = (ms) => new Date(ancora - ms).toISOString();

  const mensagem = unwrap(
    await db
      .from("webinar_chat_messages")
      .insert({ author_user_id: aluna.id, body: "antes da gravacao", created_at: antes(120_000), display_name: "Aluna T.", master: true, offset_ms: 180_000, role: "student", session_id: sessaoId, source: "audience", webinar_id: webinarId })
      .select("id")
      .single(),
    "Gravando a mensagem de antes"
  );
  unwrap(await db.from("webinar_reactions").insert({ created_at: antes(60_000), offset_ms: 240_000, reaction: "fire", session_id: sessaoId, user_id: aluna.id }), "Gravando a reacao de antes");
  unwrap(
    await db.from("webinar_questions").insert({ body: "Vai ter replay?", created_at: antes(30_000), display_name: "Aluna T.", offset_ms: 270_000, session_id: sessaoId, user_id: aluna.id }),
    "Gravando a pergunta de antes"
  );
  const enquete = unwrap(
    await db.from("webinar_polls").insert({ opened_at: antes(90_000), open_offset_ms: 210_000, question: "Vem na proxima?", session_id: sessaoId, status: "open", webinar_id: webinarId }).select("id").single(),
    "Gravando a enquete aberta antes"
  );
  const opcao = unwrap(await db.from("webinar_poll_options").insert({ label: "Sim", poll_id: enquete.id }).select("id").single(), "Gravando a opcao");
  unwrap(
    await db.from("webinar_poll_answers").insert({ created_at: antes(10_000), offset_ms: 290_000, option_ids: [opcao.id], poll_id: enquete.id, session_id: sessaoId, user_id: aluna.id }),
    "Gravando a resposta de antes"
  );

  const marcada = await db.rpc("webinar_mark_recording_anchor", { p_now: new Date(ancora).toISOString(), p_session_id: sessaoId });
  assert.equal(marcada.error, null, JSON.stringify(marcada.error));
  assert.equal(marcada.data.changed, true);
  assert.equal(marcada.data.reason, null);
  assert.equal(marcada.data.recorderStatus, "recording");
  assert.equal(Date.parse(marcada.data.anchor), ancora);
  assert.ok(marcada.data.rebased >= 5, `recalculou as cinco tabelas (${marcada.data.rebased})`);

  const linha = unwrap(await db.from("webinar_sessions").select("recording_anchor_at,recorder_status,recording_requested_at").eq("id", sessaoId).single(), "Lendo a ancora");
  assert.equal(Date.parse(linha.recording_anchor_at), ancora, "a hora do servidor");
  assert.deepEqual([linha.recorder_status, linha.recording_requested_at], ["recording", null]);

  const offsets = async () => ({
    mensagem: unwrap(await db.from("webinar_chat_messages").select("offset_ms").eq("id", mensagem.id).single(), "mensagem").offset_ms,
    pergunta: unwrap(await db.from("webinar_questions").select("offset_ms").eq("session_id", sessaoId).single(), "pergunta").offset_ms,
    reacao: unwrap(await db.from("webinar_reactions").select("offset_ms").eq("session_id", sessaoId).eq("reaction", "fire").single(), "reacao").offset_ms,
    enquete: unwrap(await db.from("webinar_polls").select("open_offset_ms").eq("id", enquete.id).single(), "enquete").open_offset_ms,
    resposta: unwrap(await db.from("webinar_poll_answers").select("offset_ms").eq("poll_id", enquete.id).single(), "resposta").offset_ms
  });
  const recalculados = await offsets();
  assert.deepEqual(recalculados, { enquete: -90_000, mensagem: -120_000, pergunta: -30_000, reacao: -60_000, resposta: -10_000 }, "o que veio antes da gravacao fica antes do zero do video");

  const deNovo = await db.rpc("webinar_mark_recording_anchor", { p_now: new Date(ancora + 10_000).toISOString(), p_session_id: sessaoId });
  assert.equal(deNovo.error, null);
  assert.deepEqual([deNovo.data.changed, deNovo.data.reason, Date.parse(deNovo.data.anchor)], [false, "already", ancora], "uma vez so");
  assert.deepEqual(await offsets(), recalculados, "a segunda chamada nao mexe em nada");

  const naoExiste = await db.rpc("webinar_mark_recording_anchor", { p_now: new Date().toISOString(), p_session_id: SESSAO_DESCONHECIDA });
  assert.equal(naoExiste.error?.code, "P0002");

  // 202610290003: a escrita em voo (o offset contado desde o inicio, lido antes da ancora) que grava depois dela fica
  // no relogio da ancora (o trigger le recording_anchor_at e grava created_at - ancora).
  const emVoo = unwrap(
    await db
      .from("webinar_chat_messages")
      .insert({ author_user_id: aluna.id, body: "em voo", display_name: "Aluna T.", offset_ms: 300_000, role: "student", session_id: sessaoId, source: "audience", webinar_id: webinarId })
      .select("offset_ms, created_at")
      .single(),
    "Gravando a mensagem em voo"
  );
  assert.ok(Math.abs(emVoo.offset_ms - (Date.parse(emVoo.created_at) - ancora)) <= 1, `created_at - ancora, nunca os 5 min desde o inicio (${emVoo.offset_ms})`);

  const entradasAntes = (await eventos(aluna.id)).filter((evento) => evento.event_type === "webinar_joined").length;
  heartbeatRoute.resetHeartbeatAccessCache();
  actAs(aluna);
  const sinal = await json(await heartbeatRoute.POST(pedido("heartbeat", "POST", { offsetSeconds: 0, sessionId: sessaoId, state: "playing", visible: true }), contexto));
  assert.equal(sinal.status, 200, JSON.stringify(sinal.body));
  const amostra = unwrap(await db.from("webinar_presence_samples").select("bucket").eq("session_id", sessaoId).eq("user_id", aluna.id), "Lendo a presenca");
  assert.equal(amostra.length, 1);
  assert.ok(amostra[0].bucket >= 9, `a presenca conta desde started_at, ha 5 min (balde ${amostra[0].bucket}), nunca pela ancora de agora (balde 0)`);
  assert.equal((await eventos(aluna.id)).filter((evento) => evento.event_type === "webinar_joined").length, entradasAntes, "na live o webinar_joined vem do join-token, nao do sinal");
});

test("6b. D31: a mensagem que a aluna manda pela rota na live nasce na linha mestre e o replay a le pela webinar_chat_window (sem insert manual)", async () => {
  resetRoomLimits();
  actAs(aluna);
  const enviada = await json(await chatRoute.POST(pedido("chat", "POST", { body: "oi da live para o replay", consent: true, consentVersion: CHAT_CONSENT_VERSION, sessionId: sessaoId }), contexto));
  assert.equal(enviada.status, 201, JSON.stringify(enviada.body));
  const linha = unwrap(await db.from("webinar_chat_messages").select("id,master,approved,offset_ms").eq("id", enviada.body.data.message.id).single(), "Lendo a mensagem da live");
  assert.deepEqual([linha.master, linha.approved], [true, true], "o que e escrito na live nasce master");

  const replay = unwrap(
    await db.from("webinar_sessions").insert({ kind: "replay", scheduled_at: new Date().toISOString(), source_session_id: sessaoId, status: "live", webinar_id: webinarId }).select("id").single(),
    "Criando o replay da live"
  );
  try {
    const janela = await db.rpc("webinar_chat_window", { p_from_ms: -86_400_000, p_session_id: replay.id, p_to_ms: 172_800_000, p_user_id: null });
    assert.equal(janela.error, null, JSON.stringify(janela.error));
    const noReplay = (janela.data ?? []).find((row) => row.id === linha.id);
    assert.ok(noReplay, "o replay mostra o chat da live");
    assert.equal(noReplay.offset_ms, linha.offset_ms, "na posicao do video (sem gravacao ligada, ancora 0)");
  } finally {
    unwrap(await db.from("webinar_sessions").delete().eq("id", replay.id), "Apagando o replay de teste");
  }
});

test("7. webhook do gravador: uploaded cria a gravacao jibri em processing com os ids da Bunny e o sha256 minusculo; o GET assinado do jibri-down devolve as duas situacoes", async () => {
  const enviado = {
    bunnyLibraryId: "12345",
    bunnyVideoId: VIDEO_DA_BUNNY,
    durationSeconds: 3600,
    fileName: `${roomName}_2026-10-29-20-00-00.mp4`,
    room: roomName,
    sessionId: sessaoId,
    sha256: "AB".repeat(32),
    sizeBytes: 123_456_789,
    startedAt: "2026-10-29-20-00-00",
    state: "uploaded"
  };
  const resposta = await webhook(enviado);
  assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
  assert.deepEqual([resposta.body.status, resposta.body.recorderStatus], ["processed", "uploaded"]);

  const gravacao = unwrap(
    await db.from("webinar_recordings").select("source,provider,status,bunny_library_id,bunny_video_id,duration_seconds,size_bytes,sha256,file_name,webinar_id").eq("session_id", sessaoId),
    "Lendo a gravacao"
  );
  assert.equal(gravacao.length, 1);
  assert.deepEqual(gravacao[0], {
    bunny_library_id: "12345",
    bunny_video_id: VIDEO_DA_BUNNY,
    duration_seconds: 3600,
    file_name: enviado.fileName,
    provider: "bunny",
    sha256: "ab".repeat(32),
    size_bytes: 123_456_789,
    source: "jibri",
    status: "processing",
    webinar_id: webinarId
  });
  assert.equal((await webhook(enviado)).body.status, "duplicate", "o finalize.sh que repete nao cria outra gravacao");
  assert.equal(unwrap(await db.from("webinar_recordings").select("id").eq("session_id", sessaoId), "Contando").length, 1);

  const consulta = (headers) => recorderStatusRoute.GET(new Request(`http://localhost/api/webhooks/recorder/${sessaoId}`, { headers }), { params: Promise.resolve({ sessionId: sessaoId }) });
  assert.equal((await consulta({})).status, 401);
  const situacaoAtual = await json(await consulta(recorderHeaders(ambiente.WEBINAR_RECORDER_WEBHOOK_SECRET, "", Date.now())));
  assert.equal(situacaoAtual.status, 200, JSON.stringify(situacaoAtual.body));
  assert.deepEqual([situacaoAtual.body.recorderStatus, situacaoAtual.body.recordingStatus], ["uploaded", "processing"]);
});

test("8. RLS: o aluno logado recebe 42501 na RPC da ancora e nao le nem grava webinar_session_bans, webinar_user_bans e webinar_recording_events", async () => {
  const cliente = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  unwrap(await cliente.auth.signInWithPassword({ email: contas.aluna.email, password: SENHA_DE_TESTE }), "Entrando como a aluna");

  const rpc = await cliente.rpc("webinar_mark_recording_anchor", { p_now: new Date().toISOString(), p_session_id: sessaoId });
  assert.equal(rpc.error?.code, "42501", JSON.stringify(rpc.error));

  for (const tabela of ["webinar_session_bans", "webinar_user_bans", "webinar_recording_events"]) {
    const leitura = await cliente.from(tabela).select("*").limit(1);
    assert.equal(leitura.error?.code, "42501", `${tabela}: ${JSON.stringify(leitura.error)}`);
  }
  const gravar = await cliente.from("webinar_user_bans").insert({ user_id: alunoSemAcesso.id });
  assert.equal(gravar.error?.code, "42501", JSON.stringify(gravar.error));

  await cliente.auth.signOut();
  assert.equal(unwrap(await db.from("webinar_user_bans").select("user_id").eq("user_id", alunoSemAcesso.id), "Conferindo").length, 0, "nada gravado");
});
