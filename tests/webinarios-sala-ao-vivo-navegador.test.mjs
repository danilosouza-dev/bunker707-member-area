import assert from "node:assert/strict";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// A sala ao vivo do aluno no navegador, a parte pura (docs/30 §1.3, §1.4, §1.7, §5.1, §6.3, §8.5 e §9; docs/18 §2.2):
// a fila dos sinais do iframe para POST .../room-events (lotes de ate 20 que cabem no corpo, o que toRoomEvent recusa
// nunca entra, 429 espera o Retry-After, a rede devolve o lote, 409 banned troca a sala), quando pedir outro token, a
// frase de cada recusa do join-token e de cada tela, as tentativas de voltar depois de uma queda, o relogio "Ao vivo ·
// 00:42:10" com relogio falso, a hora do silencio em Sao Paulo, o que os sinais do iframe mudam na nossa barra (a
// camera fechada pela equipe, o microfone liberado so do proprio participante e o recolhido pela equipe, a mao, quem esta
// no palco), os atalhos, o Modo cinema do iPhone, o sinal de midia que segura o pop-up e a decisao da pagina da Sala na
// live (a equipe abre a Sessao de pratica; o aluno ve a espera; cancelada e sem vaga recusam).

const model = await import("../src/components/member/webinars/room/live-room-model.ts");
const jitsi = await import("../src/lib/jitsi-room-config.ts");
const { PROIBIDAS_WEBINARIO, WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const queries = await import("../src/server/webinars/student-queries.ts");

const T0 = Date.parse("2026-11-05T23:00:00.000Z");
const SESSAO = "cccccccc-0000-4000-8000-000000000002";
const MIN = 60_000;
const at = (ms = T0) => new Date(ms).toISOString();
const live = (extra = {}) => ({ locked: false, meetConfigured: true, status: "live", ...extra });
const semBan = { banned: false, kicked: false, muted: false, mutedUntil: null };
const erro = (status, reason, message = "x") => Object.assign(new Error(message), { reason, status });

/* ------------------------------------------------------------------------------------------------
 * A fila dos sinais
 * ---------------------------------------------------------------------------------------------- */

test("a fila: o que toRoomEvent recusa nunca entra; a mao de outro aluno fica fora; o aceite da camera vai junto; o teto descarta os mais velhos", () => {
  const ownId = "abc123";
  const ctx = (extra = {}) => ({ nowIso: at(), ownId, ...extra });
  let fila = [];
  fila = model.queueRoomEvent(fila, jitsi.toRoomEvent("raiseHandUpdated", { handRaised: 1730000000, id: "outro" }, ctx()));
  assert.equal(fila.length, 0, "a mao de outro participante nao e do aluno");
  fila = model.queueRoomEvent(fila, jitsi.toRoomEvent("participantJoined", { displayName: "Bia C.", id: "x" }, ctx()));
  assert.equal(fila.length, 0, "entrada de outro participante nao vai ao servidor (nem o nome)");
  fila = model.queueRoomEvent(fila, jitsi.toRoomEvent("raiseHandUpdated", { handRaised: 1730000000, id: ownId }, ctx()));
  fila = model.queueRoomEvent(fila, jitsi.toRoomEvent("videoMuteStatusChanged", { muted: false }, ctx({ extra: { consented: true } })));
  fila = model.queueRoomEvent(fila, jitsi.toRoomEvent("errorOccurred", { error: { isFatal: true, message: "Jitsi caiu: texto livre", name: "conference.connectionError" } }, ctx()));
  assert.deepEqual(
    fila.map((item) => [item.name, item.data]),
    [
      ["raiseHandUpdated", { raised: true }],
      ["videoMuteStatusChanged", { consented: true, muted: false }],
      ["errorOccurred", { code: "conference.connectionError", fatal: true }]
    ]
  );
  assert.ok(!JSON.stringify(fila).includes("texto livre"), "so codigos, nunca texto");

  const cheia = Array.from({ length: 5 }, (_, index) => ({ at: at(T0 + index), name: "videoConferenceLeft" }));
  const depois = model.queueRoomEvent(cheia, { at: at(T0 + 99), name: "videoConferenceJoined" }, 5);
  assert.equal(depois.length, 5);
  assert.equal(depois[0].at, at(T0 + 1), "o mais velho saiu");
  assert.equal(depois[4].name, "videoConferenceJoined");
});

test("os lotes: ate 20 sinais e o corpo { sessionId, events } dentro do limite de bytes; o que sozinho nao cabe sai; fila vazia nao manda nada", () => {
  const fila = Array.from({ length: 45 }, (_, index) => ({ at: at(T0 + index * 1000), data: { muted: index % 2 === 0 }, name: "audioMuteStatusChanged" }));
  const primeiro = model.takeRoomEventBatch(fila, SESSAO);
  assert.equal(primeiro.batch.length, model.LIVE_ROOM_RULES.eventBatchMax);
  assert.equal(model.LIVE_ROOM_RULES.eventBatchMax, 20);
  assert.equal(primeiro.rest.length, 25);
  const corpo = JSON.parse(primeiro.body);
  assert.equal(corpo.sessionId, SESSAO);
  assert.deepEqual(corpo.events, primeiro.batch);
  assert.ok(new TextEncoder().encode(primeiro.body).length <= model.LIVE_ROOM_RULES.eventBatchBytes);
  assert.ok(model.LIVE_ROOM_RULES.eventBatchBytes < 4000, "cabe no limite de 4 KB das rotas da sala");

  const apertado = model.takeRoomEventBatch(fila, SESSAO, { maxBytes: 400 });
  assert.ok(apertado.batch.length > 0 && apertado.batch.length < 20, "o limite de bytes corta antes dos 20");
  assert.ok(new TextEncoder().encode(apertado.body).length <= 400);
  assert.equal(apertado.batch.length + apertado.rest.length, fila.length, "nada some: o resto fica para o proximo");

  const gigante = { at: at(), data: { code: "x".repeat(500) }, name: "errorOccurred" };
  const comGigante = model.takeRoomEventBatch([gigante, fila[0]], SESSAO, { maxBytes: 300 });
  assert.deepEqual(comGigante.batch, [fila[0]], "o sinal que sozinho nao cabe sai da fila");
  assert.deepEqual(comGigante.rest, []);

  assert.deepEqual(model.takeRoomEventBatch([], SESSAO), { batch: [], body: null, rest: [] });
  assert.equal(model.liveApiPath("w 1", "room-events"), "/api/webinars/w%201/room-events");
  assert.equal(model.liveApiPath("w1", "join-token"), "/api/webinars/w1/join-token");
});

test("a resposta do lote: 202 entregue; 429 devolve e espera o Retry-After (ou 60 s); rede e 5xx devolvem; outro 4xx descarta; 409 banned e ended trocam a sala", () => {
  assert.deepEqual(model.roomEventsOutcome({ nowMs: T0, retryAfterSeconds: null, status: 202 }), { blocked: null, pauseUntilMs: null, requeue: false });
  assert.deepEqual(model.roomEventsOutcome({ nowMs: T0, retryAfterSeconds: 12, status: 429 }), { blocked: null, pauseUntilMs: T0 + 12_000, requeue: true });
  assert.deepEqual(model.roomEventsOutcome({ nowMs: T0, retryAfterSeconds: null, status: 429 }), { blocked: null, pauseUntilMs: T0 + 60_000, requeue: true });
  assert.deepEqual(model.roomEventsOutcome({ nowMs: T0, retryAfterSeconds: null, status: null }), { blocked: null, pauseUntilMs: null, requeue: true });
  assert.deepEqual(model.roomEventsOutcome({ nowMs: T0, retryAfterSeconds: null, status: 503 }), { blocked: null, pauseUntilMs: null, requeue: true });
  assert.deepEqual(model.roomEventsOutcome({ nowMs: T0, retryAfterSeconds: null, status: 400 }), { blocked: null, pauseUntilMs: null, requeue: false });
  assert.deepEqual(model.roomEventsOutcome({ message: WEBINAR_COPY.aoVivo.banido, nowMs: T0, reason: "banned", retryAfterSeconds: null, status: 409 }), { blocked: "banned", pauseUntilMs: null, requeue: false });
  // O removido desta live recebe 409 banned com a frase do removido: a sala mostra "removido", nunca "banido de todas".
  assert.deepEqual(model.roomEventsOutcome({ message: WEBINAR_COPY.aoVivo.removido, nowMs: T0, reason: "banned", retryAfterSeconds: null, status: 409 }), { blocked: "kicked", pauseUntilMs: null, requeue: false });
  assert.deepEqual(model.roomEventsOutcome({ nowMs: T0, reason: "banned", retryAfterSeconds: null, status: 409 }), { blocked: "kicked", pauseUntilMs: null, requeue: false }, "sem a frase do banido, removido");
  assert.deepEqual(model.roomEventsOutcome({ nowMs: T0, reason: "ended", retryAfterSeconds: null, status: 409 }), { blocked: "ended", pauseUntilMs: null, requeue: false });
  assert.deepEqual(model.roomEventsOutcome({ nowMs: T0, reason: "not_started", retryAfterSeconds: null, status: 409 }), { blocked: null, pauseUntilMs: null, requeue: false });

  const lote = [{ at: at(T0), name: "videoConferenceJoined" }];
  const fila = [{ at: at(T0 + 1), name: "videoConferenceLeft" }];
  assert.deepEqual(model.requeueBatch(fila, lote), [...lote, ...fila], "o lote devolvido volta na frente, na ordem");
  assert.equal(model.requeueBatch(fila, lote, 1).length, 1, "sem passar do teto");
});

/* ------------------------------------------------------------------------------------------------
 * O token, as recusas e as telas
 * ---------------------------------------------------------------------------------------------- */

test("o token novo: 5 min antes do exp, nunca antes de 10 s; exp invalido tenta em 60 s", () => {
  const expiresAt = at(T0 + 60 * MIN);
  assert.equal(model.tokenRefreshInMs({ expiresAt }, T0), 55 * MIN);
  assert.equal(model.tokenRefreshInMs({ expiresAt: at(T0 + 4 * MIN) }, T0), 10_000);
  assert.equal(model.tokenRefreshInMs({ expiresAt: "nunca" }, T0), 60_000);
  assert.equal(jitsi.TOKEN_REFRESH_BEFORE_MS, 5 * MIN);
});

test("as recusas do join-token viram a frase do estado; o resto e 'Não foi possível abrir a sala'", () => {
  assert.equal(model.joinFailureOf(erro(409, "kicked")), "kicked");
  assert.equal(model.joinFailureOf(erro(409, "banned")), "banned");
  assert.equal(model.joinFailureOf(erro(409, "ended")), "ended");
  assert.equal(model.joinFailureOf(erro(409, "not_started")), "not_started");
  assert.equal(model.joinFailureOf(erro(503, "meet_unconfigured")), "meet_unconfigured");
  assert.equal(model.joinFailureOf(erro(500)), "error");
  assert.equal(model.joinFailureOf(erro(429)), "error");
  assert.equal(model.joinFailureOf(new TypeError("Failed to fetch")), "error");
  assert.equal(model.joinFailureOf(erro(409, "outra")), "error");

  const copy = WEBINAR_COPY;
  assert.equal(model.joinFailurePhrase("kicked"), copy.aoVivo.removido);
  assert.equal(model.joinFailurePhrase("banned"), copy.aoVivo.banido);
  assert.equal(model.joinFailurePhrase("ended"), copy.sala.encerradaReplay);
  assert.equal(model.joinFailurePhrase("ended", { hasReplay: true }), copy.sala.encerrada);
  assert.equal(model.joinFailurePhrase("meet_unconfigured"), copy.aoVivo.emBreve);
  assert.equal(model.joinFailurePhrase("not_started"), copy.aluno.aguardando);
  assert.equal(model.joinFailurePhrase("error"), copy.aoVivo.erroAbrir);
  assert.equal(copy.aoVivo.removido, "Você foi removido desta live.");
  assert.equal(copy.aoVivo.salaFechada, "A sala está cheia ou fechada. Fique aqui: avisamos quando abrir.");
});

test("quem sai do Quem pode no meio da live (D41): o 404 da renovacao do token troca a sala pela frase e desmonta o iframe, em vez de tentar de novo a cada 60 s", () => {
  // Live em Produto ou segmento com "Curso P ou ganhou acesso hoje", das 23:30 a 00:30: a aluna sem o P entrou pelo
  // "hoje". Depois da meia-noite, a renovacao do token responde 404 (requireWebinarAccess, com a frase do servidor).
  const foraDoAcesso = erro(404, undefined, WEBINAR_COPY.aluno.naoDisponivel);
  assert.equal(model.joinFailureOf(foraDoAcesso), "unavailable", "na entrada e na volta depois de uma queda, nunca 'Tentar de novo'");
  assert.deepEqual(model.tokenRefreshOutcome(foraDoAcesso), { action: "refuse", failure: "unavailable" });
  assert.deepEqual(model.tokenRefreshOutcome(erro(500)), { action: "retry", delayMs: model.LIVE_ROOM_RULES.tokenRetryMs }, "5xx: outra tentativa");
  assert.deepEqual(model.tokenRefreshOutcome(new TypeError("Failed to fetch")), { action: "retry", delayMs: 60_000 }, "sem rede: outra tentativa");
  assert.deepEqual(model.tokenRefreshOutcome(erro(429)), { action: "retry", delayMs: 60_000 });
  assert.deepEqual(model.tokenRefreshOutcome(erro(409, "kicked")), { action: "refuse", failure: "kicked" });

  // A tela: mesmo com a aluna dentro do iframe (inRoom), a sala inteira da lugar a frase (sem iframe, sem chat).
  const tela = model.liveRoomScreen({ ban: semBan, inRoom: true, live: live(), staff: false, unavailable: true });
  assert.equal(tela, "unavailable");
  assert.equal(model.screenBlocksRoom(tela), true);
  assert.deepEqual(model.liveScreenPhrase(tela, { hasReplay: false }), { text: null, title: "Esta live não está disponível para você." });
  assert.equal(model.joinFailurePhrase("unavailable"), WEBINAR_COPY.aluno.naoDisponivel);
  assert.equal(model.liveRoomScreen({ ban: { ...semBan, kicked: true }, inRoom: false, live: live({ status: "ended" }), staff: false, unavailable: true }), "unavailable", "o 404 vem antes do 409");
  assert.equal(model.liveRoomScreen({ ban: semBan, inRoom: true, live: live(), staff: false, unavailable: false }), "open");

  // Os sinais do iframe com 404 (o acesso guardado no servidor venceu): a sala troca tambem, e o lote nao volta.
  assert.deepEqual(model.roomEventsOutcome({ nowMs: T0, retryAfterSeconds: null, status: 404 }), { blocked: "unavailable", pauseUntilMs: null, requeue: false });
});

test("a tela da sala: banido e removido primeiro, depois encerrada, em breve, a equipe sempre aberta, o aluno espera ate a sala abrir, a tranca so barra quem chega", () => {
  const screen = (extra = {}) => model.liveRoomScreen({ ban: semBan, inRoom: false, live: live(), staff: false, ...extra });
  assert.equal(screen(), "open");
  assert.equal(screen({ ban: { ...semBan, banned: true, kicked: true } }), "banned");
  assert.equal(screen({ ban: { ...semBan, kicked: true } }), "kicked");
  assert.equal(screen({ ban: { ...semBan, kicked: true }, live: live({ status: "ended" }) }), "kicked", "removido vence a encerrada");
  assert.equal(screen({ live: live({ status: "ended" }) }), "ended");
  assert.equal(screen({ live: live({ status: "cancelled" }) }), "ended");
  assert.equal(screen({ live: live({ meetConfigured: false }) }), "unconfigured");
  assert.equal(screen({ unconfigured: true }), "unconfigured", "o 503 do join-token depois de a pagina abrir");
  assert.equal(screen({ live: live({ status: "scheduled" }) }), "waiting", "o aluno so entra na espera ou no ar");
  assert.equal(screen({ live: live({ status: "scheduled" }), staff: true }), "open", "a equipe abre a Sessao de pratica");
  assert.equal(screen({ live: live({ status: "waiting" }) }), "open");
  assert.equal(screen({ live: live({ locked: true }) }), "locked");
  assert.equal(screen({ inRoom: true, live: live({ locked: true }) }), "open", "quem ja entrou fica");
  assert.equal(screen({ live: live({ locked: true }), staff: true }), "open");

  assert.equal(model.screenBlocksRoom("kicked"), true);
  assert.equal(model.screenBlocksRoom("banned"), true);
  assert.equal(model.screenBlocksRoom("ended"), false, "encerrada: o chat fica para ler");
  assert.deepEqual(model.liveScreenPhrase("waiting", { hasReplay: false }), { text: WEBINAR_COPY.aluno.aguardandoTexto, title: "Aguardando o apresentador" });
  assert.equal(model.liveScreenPhrase("locked", { hasReplay: false }).title, WEBINAR_COPY.aoVivo.salaFechada);
  assert.equal(model.liveScreenPhrase("unconfigured", { hasReplay: false }).title, WEBINAR_COPY.aoVivo.emBreve);
  assert.equal(model.liveScreenPhrase("ended", { hasReplay: false }).title, "Essa live acabou. O replay fica pronto em algumas horas.");
  assert.equal(model.liveScreenPhrase("ended", { hasReplay: true }).title, "Essa live acabou.");
  assert.equal(model.liveScreenPhrase("open", { hasReplay: false }), null);

  assert.equal(model.livePhaseOf("live"), "live");
  assert.equal(model.livePhaseOf("waiting"), "waiting");
  assert.equal(model.livePhaseOf("scheduled"), "waiting");
  assert.equal(model.livePhaseOf("cancelled"), "ended");
  assert.equal(model.liveAcceptsWrites("waiting"), true);
  assert.equal(model.liveAcceptsWrites("live"), true);
  assert.equal(model.liveAcceptsWrites("scheduled"), false);
  assert.equal(model.liveAcceptsWrites("ended"), false);
  assert.equal(model.usesOurBar("student"), true);
  assert.equal(model.usesOurBar("team"), true);
  assert.equal(model.usesOurBar("host"), false, "host e co-apresentador usam a barra do iframe");
  assert.equal(model.usesOurBar("co_host"), false);
  assert.equal(model.usesOurBar(null), true);
});

test("as quedas: ate 3 tentativas (2 s, 4 s, 8 s) e depois 'Não conseguimos voltar'; a abertura que falha e o Sair nao reconectam", () => {
  assert.equal(jitsi.RECONNECT_ATTEMPTS, 3);
  assert.deepEqual(model.reconnectStep(0), { action: "retry", attempt: 1, delayMs: 2_000 });
  assert.deepEqual(model.reconnectStep(1), { action: "retry", attempt: 2, delayMs: 4_000 });
  assert.deepEqual(model.reconnectStep(2), { action: "retry", attempt: 3, delayMs: 8_000 });
  assert.deepEqual(model.reconnectStep(3), { action: "give_up" });
  assert.deepEqual(model.reconnectStep(Number.NaN), { action: "give_up" });
  assert.equal(model.dropKind({ everJoined: true, leaving: false }), "drop");
  assert.equal(model.dropKind({ everJoined: false, leaving: false }), "open_failed");
  assert.equal(model.dropKind({ everJoined: true, leaving: true }), "ignore");
  assert.equal(WEBINAR_COPY.aoVivo.naoConseguimosVoltar, "Não conseguimos voltar.");
  assert.equal(WEBINAR_COPY.sala.reconectando, "Reconectando…");
});

/* ------------------------------------------------------------------------------------------------
 * O relogio e o silencio
 * ---------------------------------------------------------------------------------------------- */

test("o relogio 'Ao vivo · hh:mm:ss' anda com o relogio falso, pelo inicio de verdade e o skew do servidor", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  const inicio = at(T0 - (42 * 60 + 10) * 1000);
  assert.equal(model.liveOnAirLabel(inicio, Date.now()), "Ao vivo · 00:42:10");
  t.mock.timers.tick(5_000);
  assert.equal(model.liveElapsedLabel(inicio, Date.now()), "00:42:15");
  t.mock.timers.tick(18 * MIN);
  assert.equal(model.liveElapsedLabel(inicio, Date.now()), "01:00:15", "passa da hora com dois digitos");
  assert.equal(model.liveElapsedLabel(inicio, Date.now(), -15_000), "01:00:00", "o aparelho adiantado 15 s: o servidor manda");
  assert.equal(model.liveElapsedLabel(at(Date.now() + MIN), Date.now()), "00:00:00", "antes do inicio, zero");
  assert.equal(model.liveElapsedLabel(null, Date.now()), "00:00:00");
  assert.equal(model.liveElapsedLabel("invalido", Date.now()), "00:00:00");
});

test("o silencio no chat: ate a hora de Sao Paulo, ate o fim, vencido some; antes de a sala abrir o campo diz que ainda nao abriu", () => {
  const ate = at(Date.parse("2026-11-05T23:15:00.000Z"));
  assert.equal(model.mutedPhrase({ muted: true, mutedUntil: ate }, T0), "Você está sem escrever no chat até 20:15.");
  assert.equal(model.mutedPhrase({ muted: true, mutedUntil: null }, T0), WEBINAR_COPY.aoVivo.silenciadoAteOFim);
  assert.equal(model.mutedPhrase({ muted: true, mutedUntil: ate }, T0 + 16 * MIN), null, "venceu: o campo volta");
  assert.equal(model.mutedPhrase({ muted: false, mutedUntil: null }, T0), null);

  assert.equal(model.liveComposerNotice({ ban: { muted: false, mutedUntil: null }, nowMs: T0, status: "live" }), null);
  assert.equal(model.liveComposerNotice({ ban: { muted: false, mutedUntil: null }, nowMs: T0, status: "waiting" }), null, "na espera o chat aceita");
  assert.equal(model.liveComposerNotice({ ban: { muted: false, mutedUntil: null }, nowMs: T0, status: "scheduled" }), WEBINAR_COPY.sala.naoComecou);
  assert.equal(model.liveComposerNotice({ ban: { muted: true, mutedUntil: ate }, nowMs: T0, status: "live" }), "Você está sem escrever no chat até 20:15.");

  // A recusa local (409) antes de a sessao relida trazer a hora: "ate o fim"; banido pela frase do servidor.
  assert.deepEqual(model.mergeBan(semBan, { banned: false, kicked: false, muted: true }), { banned: false, kicked: false, muted: true, mutedUntil: null });
  assert.deepEqual(model.mergeBan({ ...semBan, muted: true, mutedUntil: ate }, { banned: false, kicked: false, muted: true }).mutedUntil, ate);
  assert.deepEqual(model.mergeBan(undefined, { banned: false, kicked: true, muted: false }), { banned: false, kicked: true, muted: false, mutedUntil: null });
  assert.equal(model.writeRefusalOf(erro(409, "banned", WEBINAR_COPY.aoVivo.banido)), "banned");
  assert.equal(model.writeRefusalOf(erro(409, "banned", WEBINAR_COPY.aoVivo.removido)), "kicked");
  assert.equal(model.writeRefusalOf(erro(409, "muted")), "muted");
  assert.equal(model.writeRefusalOf(erro(409, "ended")), "ended");
  assert.equal(model.writeRefusalOf(erro(409, "chat_off")), null);
  assert.equal(model.writeRefusalOf(erro(429)), null);
});

/* ------------------------------------------------------------------------------------------------
 * A camera, o microfone e a nossa barra
 * ---------------------------------------------------------------------------------------------- */

test("a camera: o primeiro ligar pede o aviso, depois direto; desligar e direto; sem a permissao, bloqueada; o iframe que nao responde avisa", () => {
  assert.equal(model.cameraClick({ allowStudentCamera: true, consented: false, videoOn: false }), "ask");
  assert.equal(model.cameraClick({ allowStudentCamera: true, consented: true, videoOn: false }), "toggle");
  assert.equal(model.cameraClick({ allowStudentCamera: true, consented: true, videoOn: true }), "toggle");
  assert.equal(model.cameraClick({ allowStudentCamera: false, consented: false, videoOn: false }), "blocked");
  assert.equal(model.cameraClick({ allowStudentCamera: false, consented: true, videoOn: true }), "toggle", "fechar sempre pode");

  const pedido = model.expectVideoToggle(model.INITIAL_LIVE_SIGNALS);
  assert.deepEqual(model.cameraRequestUnanswered(pedido).notice, "camera_blocked");
  const ligou = model.applyLiveSignal(pedido, { name: "videoMuteStatusChanged", ownId: "eu", payload: { muted: false } });
  assert.equal(ligou.videoOn, true);
  assert.equal(ligou.notice, null, "foi o proprio aluno");
  assert.equal(model.cameraRequestUnanswered(ligou), ligou, "respondeu: nada a avisar");
  const fechada = model.applyLiveSignal(ligou, { name: "videoMuteStatusChanged", ownId: "eu", payload: { muted: true } });
  assert.equal(fechada.videoOn, false);
  assert.equal(fechada.notice, "camera_closed", "a equipe fechou a camera");
  assert.equal(model.liveNoticePhrase("camera_closed"), WEBINAR_COPY.aoVivo.cameraFechadaPelaEquipe);
  assert.equal(model.liveNoticePhrase("camera_blocked"), WEBINAR_COPY.aoVivo.cameraBloqueada);
  const desligou = model.applyLiveSignal(model.expectVideoToggle(ligou), { name: "videoMuteStatusChanged", ownId: "eu", payload: { muted: true } });
  assert.equal(desligou.notice, null, "o proprio aluno desligou");
});

test("o microfone: so a liberacao do proprio participante (mediaType audio) abre Falar / Agora não; Falar fica na barra; a equipe silencia e ele some", () => {
  const base = model.applyLiveSignal(model.INITIAL_LIVE_SIGNALS, { name: "videoConferenceJoined", ownId: "eu", payload: { id: "eu" } });
  assert.equal(model.isOwnMicApproval({ id: "eu", mediaType: "audio" }, "eu"), true);
  assert.equal(model.isOwnMicApproval({ id: "eu", mediaType: "video" }, "eu"), false);
  assert.equal(model.isOwnMicApproval({ id: "outro", mediaType: "audio" }, "eu"), false);
  assert.equal(model.isOwnMicApproval({ id: "eu", mediaType: "audio" }, null), false);

  const deOutro = model.applyLiveSignal(base, { name: "moderationParticipantApproved", ownId: "eu", payload: { id: "outro", mediaType: "audio" } });
  assert.equal(deOutro.micPrompt, false);
  const liberado = model.applyLiveSignal(base, { name: "moderationParticipantApproved", ownId: "eu", payload: { id: "eu", mediaType: "audio" } });
  assert.equal(liberado.micPrompt, true);
  assert.equal(liberado.micAllowed, false, "o microfone so aparece depois do Falar");
  assert.equal(model.declineMic(liberado).micPrompt, false);
  assert.equal(model.declineMic(liberado).micAllowed, false, "Agora não: nada liga");

  const falando = model.applyLiveSignal(model.acceptMic(liberado), { name: "audioMuteStatusChanged", ownId: "eu", payload: { muted: false } });
  assert.equal(falando.micAllowed, true);
  assert.equal(falando.audioOn, true);
  assert.equal(falando.notice, null);
  const pausou = model.applyLiveSignal(model.expectAudioToggle(falando), { name: "audioMuteStatusChanged", ownId: "eu", payload: { muted: true } });
  assert.equal(pausou.micAllowed, true, "o proprio aluno desligou: o botao fica");
  const silenciado = model.applyLiveSignal(falando, { name: "audioMuteStatusChanged", ownId: "eu", payload: { muted: true } });
  assert.equal(silenciado.micAllowed, false, "a equipe silenciou: o botao some");
  assert.equal(silenciado.notice, "mic_silenced");
  assert.equal(model.liveNoticePhrase("mic_silenced"), WEBINAR_COPY.aoVivo.microfoneSilenciado);

  const caiu = model.applyLiveSignal(falando, { name: "videoConferenceLeft", ownId: "eu", payload: {} });
  assert.equal(caiu.micAllowed, false, "quem volta entra com outro id, mudo");
});

test("o microfone recolhido pela equipe (V2-19): o rejectParticipant de audio do proprio aluno tira o Microfone da barra mesmo desligado; o de outro e o de video nao mexem", () => {
  // O sinal e escutado, mas nunca vai ao servidor (o silencio da equipe ja vira linha pelo audioMuteStatusChanged).
  assert.ok(jitsi.JITSI_LISTENED_EVENTS.includes("moderationParticipantRejected"), "a sala escuta o sinal");
  assert.equal(jitsi.toRoomEvent("moderationParticipantRejected", { id: "eu", mediaType: "audio" }, { nowIso: at(), ownId: "eu" }), null, "nada vai ao servidor");

  const base = model.applyLiveSignal(model.INITIAL_LIVE_SIGNALS, { name: "videoConferenceJoined", ownId: "eu", payload: { id: "eu" } });
  const liberado = model.applyLiveSignal(base, { name: "moderationParticipantApproved", ownId: "eu", payload: { id: "eu", mediaType: "audio" } });
  const falando = model.applyLiveSignal(model.acceptMic(liberado), { name: "audioMuteStatusChanged", ownId: "eu", payload: { muted: false } });
  // O proprio aluno desligou pelo Microfone: o botao continua na barra, desligado (nenhum mudo da equipe vai chegar).
  const desligado = model.applyLiveSignal(model.expectAudioToggle(falando), { name: "audioMuteStatusChanged", ownId: "eu", payload: { muted: true } });
  assert.equal(desligado.micAllowed, true);
  assert.equal(desligado.audioOn, false);
  const barra = (estado) => model.liveBarItems({ allowStudentCamera: true, micAllowed: estado.micAllowed, showMedia: true }).center;
  assert.ok(barra(desligado).includes("mic"), "antes de recolher, o Microfone esta na barra");

  const recolhido = model.applyLiveSignal(desligado, { name: "moderationParticipantRejected", ownId: "eu", payload: { id: "eu", mediaType: "audio" } });
  assert.equal(recolhido.micAllowed, false, "a equipe recolheu: o botao some");
  assert.equal(recolhido.micPrompt, false);
  assert.equal(recolhido.expectAudio, false);
  assert.equal(recolhido.notice, "mic_silenced");
  assert.equal(model.liveNoticePhrase(recolhido.notice), WEBINAR_COPY.aoVivo.microfoneSilenciado);
  assert.ok(!barra(recolhido).includes("mic"), "o Microfone sai da barra");
  assert.deepEqual({ ...recolhido, micAllowed: true, notice: desligado.notice }, desligado, "so o microfone e o aviso mudam");

  // Com o Falar / Agora não aberto (liberado e ainda sem resposta), recolher fecha o aviso e o Microfone nunca aparece.
  const semResposta = model.applyLiveSignal(liberado, { name: "moderationParticipantRejected", ownId: "eu", payload: { id: "eu", mediaType: "audio" } });
  assert.equal(semResposta.micPrompt, false);
  assert.equal(semResposta.micAllowed, false);
  // O Falar ja pedido (o toque esperando o mudo do iframe) tambem acaba: o mudo que vier depois e da equipe.
  assert.equal(model.applyLiveSignal(model.acceptMic(liberado), { name: "moderationParticipantRejected", ownId: "eu", payload: { id: "eu", mediaType: "audio" } }).expectAudio, false);

  // O de outro participante, o de video, o sem id e o de antes de entrar (sem o proprio id) deixam o estado igual.
  assert.equal(model.applyLiveSignal(desligado, { name: "moderationParticipantRejected", ownId: "eu", payload: { id: "outro", mediaType: "audio" } }), desligado);
  assert.equal(model.applyLiveSignal(desligado, { name: "moderationParticipantRejected", ownId: "eu", payload: { id: "eu", mediaType: "video" } }), desligado);
  assert.equal(model.applyLiveSignal(desligado, { name: "moderationParticipantRejected", ownId: "eu", payload: { mediaType: "audio" } }), desligado);
  assert.equal(model.applyLiveSignal(desligado, { name: "moderationParticipantRejected", ownId: null, payload: { id: "eu", mediaType: "audio" } }), desligado);
});

test("a mao, o selo Gravando e o palco: so a mao do proprio; quem modera entra no palco, alunos nunca; o Som conhece todos", () => {
  let estado = model.applyLiveSignal(model.INITIAL_LIVE_SIGNALS, { name: "videoConferenceJoined", ownId: "eu", payload: { id: "eu" } });
  estado = model.toggleHandLocally(estado);
  assert.equal(estado.handRaised, true, "a barra muda na hora");
  estado = model.applyLiveSignal(estado, { name: "raiseHandUpdated", ownId: "eu", payload: { handRaised: 0, id: "outro" } });
  assert.equal(estado.handRaised, true, "a mao de outro nao mexe na minha");
  estado = model.applyLiveSignal(estado, { name: "raiseHandUpdated", ownId: "eu", payload: { handRaised: 0, id: "eu" } });
  assert.equal(estado.handRaised, false);

  assert.equal(model.isRecording(estado, { recording: true }), true, "antes do sinal, a sessao");
  estado = model.applyLiveSignal(estado, { name: "recordingStatusChanged", ownId: "eu", payload: { on: false } });
  assert.equal(model.isRecording(estado, { recording: true }), false, "o sinal do iframe vale");
  estado = model.applyLiveSignal(estado, { name: "recordingStatusChanged", ownId: "eu", payload: { on: true } });
  assert.equal(model.isRecording(estado, null), true);

  for (const [id, displayName] of [["h", "Danilo S."], ["a1", "Ana   M."], ["a2", "Bruno L."], ["co", "Carla P."]]) {
    estado = model.applyLiveSignal(estado, { name: "participantJoined", ownId: "eu", payload: { displayName, id } });
  }
  estado = model.applyLiveSignal(estado, { name: "participantRoleChanged", ownId: "eu", payload: { id: "h", role: "moderator" } });
  estado = model.applyLiveSignal(estado, { name: "participantRoleChanged", ownId: "eu", payload: { id: "co", role: "moderator" } });
  estado = model.applyLiveSignal(estado, { name: "participantRoleChanged", ownId: "eu", payload: { id: "eu", role: "moderator" } });
  assert.deepEqual(model.stageNames(estado.participants, "Danilo S."), ["Danilo S.", "Carla P."], "o apresentador uma vez e quem modera; nenhum aluno");
  assert.deepEqual(model.remoteParticipantIds(estado.participants).sort(), ["a1", "a2", "co", "h"]);
  estado = model.applyLiveSignal(estado, { name: "participantLeft", ownId: "eu", payload: { id: "co" } });
  assert.deepEqual(model.stageNames(estado.participants, null), ["Danilo S."]);
  assert.equal(estado.participants.names.a1, "Ana M.", "o nome do iframe chega limpo");
});

test("os atalhos R, M e E (nunca escrevendo, nunca com Ctrl/Alt/Cmd), o Modo cinema no iPhone e as ultimas mensagens por cima do palco", () => {
  assert.equal(model.liveShortcutOf({ key: "r", tagName: "BUTTON" }), "react");
  assert.equal(model.liveShortcutOf({ key: "M", tagName: "DIV" }), "hand");
  assert.equal(model.liveShortcutOf({ key: "e" }), "poll");
  assert.equal(model.liveShortcutOf({ key: "r", tagName: "TEXTAREA" }), null);
  assert.equal(model.liveShortcutOf({ key: "m", tagName: "input" }), null);
  assert.equal(model.liveShortcutOf({ editable: true, key: "e" }), null);
  assert.equal(model.liveShortcutOf({ ctrlKey: true, key: "r" }), null);
  assert.equal(model.liveShortcutOf({ key: "x" }), null);

  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  assert.equal(model.prefersCinemaMode({ fullscreenEnabled: true, userAgent: iphone }), true);
  assert.equal(model.prefersCinemaMode({ fullscreenEnabled: true, userAgent: "Mozilla/5.0 (Macintosh) Chrome/130" }), false);
  assert.equal(model.prefersCinemaMode({ fullscreenEnabled: false, userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130" }), true);

  // As pilulas do chat sobre o palco com o painel fechado (docs/31 V2-8): as 2 ultimas, tambem no computador.
  assert.deepEqual(model.overlayMessages([1, 2, 3, 4, 5]), [4, 5]);
  assert.deepEqual(model.overlayMessages([1]), [1]);
  assert.equal(model.LIVE_ROOM_RULES.overlayMessages, 2);
});

test("as frases da barra (LIVE_ROOM_COPY aponta para WEBINAR_COPY.aoVivo) passam pela PROIBIDAS_WEBINARIO e nao citam o motor de video", () => {
  const textos = Object.values(model.LIVE_ROOM_COPY);
  assert.equal(model.LIVE_ROOM_COPY.configuracoes, WEBINAR_COPY.aoVivo.configuracoes);
  assert.equal(model.LIVE_ROOM_COPY.barra, WEBINAR_COPY.aoVivo.barra);
  assert.ok(textos.length >= 5);
  for (const texto of textos) {
    const lower = texto.toLocaleLowerCase("pt-BR");
    for (const palavra of PROIBIDAS_WEBINARIO) {
      assert.ok(!lower.includes(palavra), `"${texto}" usa "${palavra}"`);
    }
  }
  assert.match(model.LIVE_ROOM_COPY.atalhoReagir, /^R:/);
  assert.match(model.LIVE_ROOM_COPY.atalhoMao, /^M:/);
  assert.match(model.LIVE_ROOM_COPY.atalhoEnquete, /^E:/);
});

/* ------------------------------------------------------------------------------------------------
 * O sinal de midia (nenhum pop-up com a sala ou a pilula no ar)
 * ---------------------------------------------------------------------------------------------- */

test("com a sala no ar o palco conta como player tocando (o pop-up espera); ao fechar, para", async () => {
  const palco = {
    getAttribute: (name) => ({ "data-lesson-id": `webinar:${SESSAO}`, "data-lesson-player-kind": "iframe", "data-lesson-player-stage": "" })[name] ?? null,
    querySelector: () => null
  };
  const antes = { document: globalThis.document, window: globalThis.window };
  globalThis.document = { activeElement: null, fullscreenElement: null, querySelector: (selector) => (selector === "[data-lesson-player-stage]" ? palco : null) };
  globalThis.window = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }) });
  try {
    const media = await import("../src/lib/lesson-media-signal.ts");
    const { roomMediaLessonId } = await import("../src/lib/webinar-room-client.ts");
    const sinais = [];
    window.addEventListener(media.LESSON_MEDIA_EVENT, (event) => sinais.push(media.readLessonMediaSignal(event)));
    media.resetLessonMedia();
    media.announceLiveRoomMedia({ lessonId: roomMediaLessonId(SESSAO), on: true });
    assert.equal(media.lessonMediaSnapshot().playing, true, "a sala no ar segura o pop-up");
    assert.equal(media.lessonMediaSnapshot().activeLessonId, `webinar:${SESSAO}`);
    media.announceLiveRoomMedia({ lessonId: roomMediaLessonId(SESSAO), on: false });
    assert.equal(media.lessonMediaSnapshot().playing, false);
    assert.deepEqual(
      sinais.map((sinal) => [sinal.kind, sinal.bridge, sinal.playing]),
      [
        ["embed", "confirmed", true],
        ["embed", "silent", false]
      ],
      "o host do pop-up ouve o mesmo evento da aula (waitLessonMediaStop acorda no fim)"
    );
  } finally {
    globalThis.document = antes.document;
    globalThis.window = antes.window;
  }
});

/* ------------------------------------------------------------------------------------------------
 * A pagina da Sala: a live nao segue o relogio da gravada
 * ---------------------------------------------------------------------------------------------- */

test("a pagina da Sala na live: abre em qualquer situacao (a tela decide), recusa cancelada; sem a vaga, so a equipe entra; a gravada segue o relogio", () => {
  const sessao = (extra = {}) => ({
    session: { durationMs: 60 * MIN, join: { ok: true }, kind: "live", lateJoinMinutes: null, scheduledAt: at(T0 + 3 * 24 * 60 * MIN), startedAt: null, status: "scheduled", ...extra }
  });
  const decide = (payload, staff = false, now = T0) => queries.roomPageDecision(payload, { durationMs: 60 * MIN, now, staff });

  assert.deepEqual(decide(sessao({ join: { ok: false, reason: "not_started" } })), { ok: true }, "o aluno ve Aguardando o apresentador, mesmo dias antes");
  assert.deepEqual(decide(sessao(), true), { ok: true }, "a equipe abre a Sessao de pratica");
  assert.deepEqual(decide(sessao({ join: { ok: false, reason: "ended" }, status: "ended" })), { ok: true }, "encerrada: a sala mostra o fim e o replay");
  assert.deepEqual(decide(sessao({ join: { ok: false, reason: "kicked" }, status: "live" })), { ok: true }, "removido: a sala mostra a frase");
  assert.deepEqual(decide(sessao({ scheduledAt: at(T0 - 3 * 60 * MIN), startedAt: at(T0 - 3 * 60 * MIN), status: "live" })), { ok: true }, "a live que passou da duracao continua no ar");
  assert.deepEqual(decide(sessao({ status: "cancelled" })), { ok: false, reason: "cancelled" });
  assert.deepEqual(decide(sessao({ join: { ok: false, reason: "no_seat" }, status: "live" })), { ok: false, reason: "no_seat" });
  assert.deepEqual(decide(sessao({ join: { ok: false, reason: "no_seat" }, status: "live" }), true), { ok: true }, "a equipe passa sem vaga");

  const gravada = (extra = {}) => sessao({ kind: "simulated", scheduledAt: at(T0), status: "scheduled", ...extra });
  assert.deepEqual(decide(gravada(), false, T0 - 30 * MIN), { ok: false, reason: "not_started" }, "a gravada abre 15 min antes");
  assert.deepEqual(decide(gravada(), false, T0 + 5 * MIN), { ok: true });
  assert.deepEqual(decide(gravada({ lateJoinMinutes: 10 }), false, T0 + 20 * MIN), { ok: false, reason: "late" });
  assert.deepEqual(decide(gravada({ join: { ok: false, reason: "no_seat" } }), true, T0), { ok: false, reason: "no_seat" }, "na gravada a vaga vale para todos");
  assert.deepEqual(decide(sessao({ kind: "replay", status: "live" })), { ok: true });
  // O banido de todos os webinarios fica fora da Live gravada e do Replay (D33); na live a propria sala mostra a frase.
  assert.deepEqual(decide(gravada({ join: { ok: false, reason: "banned" } }), false, T0 + 5 * MIN), { ok: false, reason: "banned" });
  assert.deepEqual(decide(sessao({ join: { ok: false, reason: "banned" }, kind: "replay", status: "live" })), { ok: false, reason: "banned" });
  assert.deepEqual(decide(sessao({ join: { ok: false, reason: "banned" }, status: "live" })), { ok: true }, "a live mostra a frase na sala");
});

test("o relogio falso do node:test tambem anda com o token: o pedido seguinte cai 5 min antes do exp", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: T0 });
  const pedidos = [];
  const reply = { expiresAt: at(T0 + 30 * MIN) };
  setTimeout(() => pedidos.push(Date.now()), model.tokenRefreshInMs(reply, Date.now()));
  t.mock.timers.tick(24 * MIN);
  assert.deepEqual(pedidos, []);
  t.mock.timers.tick(MIN);
  assert.deepEqual(pedidos, [T0 + 25 * MIN]);
});

test("Abaixar a mão do console: o sinal LOWER_HAND_SIGNAL so abaixa a mao levantada, de qualquer remetente (quem ja moderava nunca gera participantRoleChanged)", () => {
  const texto = JSON.stringify({ type: jitsi.LOWER_HAND_SIGNAL });
  const comModerador = { handRaised: true, participants: { moderators: ["host-1"], names: {} } };
  const pedido = (sender, text = texto) => ({ eventData: { name: "endpoint-text-message", text }, senderInfo: { id: sender } });

  assert.ok(jitsi.JITSI_LISTENED_EVENTS.includes("endpointTextMessageReceived"), "a sala escuta o sinal");
  assert.equal(jitsi.toRoomEvent("endpointTextMessageReceived", pedido("host-1"), { nowIso: at(), ownId: "eu" }), null, "o sinal nunca vai para o servidor");
  assert.equal(model.lowerHandRequested(comModerador, pedido("host-1")), true);
  assert.equal(model.lowerHandRequested(comModerador, { data: pedido("host-1") }), true, "o payload dentro de { data } tambem vale");
  assert.equal(model.lowerHandRequested({ ...comModerador, handRaised: false }, pedido("host-1")), false, "com a mao abaixada nada muda");
  // Quem ja era moderador quando o aluno entrou nao gera participantRoleChanged (o caso normal): o sinal vale de qualquer
  // remetente, porque so abaixa a propria mao (que o aluno levanta de novo).
  const semModeradorConhecido = { handRaised: true, participants: { moderators: [], names: {} } };
  assert.equal(model.lowerHandRequested(semModeradorConhecido, pedido("host-que-ja-estava")), true, "o apresentador que entrou antes do aluno");
  assert.equal(model.lowerHandRequested(comModerador, pedido("host-1", "{nao e json")), false);
  assert.equal(model.lowerHandRequested(comModerador, pedido("host-1", JSON.stringify({ type: "outro" }))), false);
});

test("Sessao de pratica e sala de espera: o aluno ve Aguardando o apresentador na pratica; com a sala de espera ligada a entrada espera a equipe sem o prazo de 30 s", () => {
  const tela = (extra, inRoom = false) => model.liveRoomScreen({ ban: semBan, inRoom, live: live(extra), staff: false });
  assert.equal(tela({ practice: true, status: "waiting" }), "waiting", "na Sessao de pratica, so a equipe na sala");
  assert.equal(tela({ practice: false, status: "waiting" }), "open");
  assert.equal(model.liveRoomScreen({ ban: semBan, inRoom: false, live: live({ practice: true, status: "waiting" }), staff: true }), "open", "a equipe entra");
  assert.equal(tela({ practice: false, status: "live" }), "open");

  const prazo = (extra) => model.joinTimeoutOutcome({ joined: false, leaving: false, lobby: false, sameMount: true, ...extra });
  assert.equal(prazo({}), "drop", "sem sala de espera: 30 s sem entrar e queda");
  assert.equal(prazo({ lobby: true }), "wait", "na sala de espera: espera a equipe admitir, sem queda nem tentativa gasta");
  assert.equal(prazo({ joined: true, lobby: true }), "ignore");
  assert.equal(prazo({ sameMount: false }), "ignore", "outra montagem");
  assert.equal(prazo({ leaving: true }), "ignore", "o aluno saiu");
});

test("a recusa local (409 muted / kicked) vale so ate a proxima leitura da sessao: o silencio vencido e o Desfazer liberam sem recarregar", () => {
  const recusa = T0;
  assert.equal(model.localBanStillValid({ refusedAtMs: recusa, serverTimeIso: at(T0 - 30_000), skewMs: 0 }), true, "a leitura e de antes da recusa: a recusa vale");
  assert.equal(model.localBanStillValid({ refusedAtMs: recusa, serverTimeIso: at(T0 + 500), skewMs: 0 }), false, "a leitura nova manda");
  assert.equal(model.localBanStillValid({ refusedAtMs: recusa, serverTimeIso: at(T0 + 500), skewMs: 2000 }), true, "pelo relogio do servidor (skew)");
  assert.equal(model.localBanStillValid({ refusedAtMs: null, serverTimeIso: at(T0), skewMs: 0 }), false);

  // Silenciado 5 min: o 409 muted antes da releitura; vencido o prazo, a sessao relida vem sem silencio.
  const depois = { banned: false, kicked: false, muted: false, mutedUntil: null };
  const local = { banned: false, kicked: false, muted: true };
  const valendo = model.localBanStillValid({ refusedAtMs: recusa, serverTimeIso: at(T0 + 5 * MIN), skewMs: 0 }) ? local : { banned: false, kicked: false, muted: false };
  const ban = model.mergeBan(depois, valendo);
  assert.equal(model.mutedPhrase(ban, T0 + 5 * MIN), null, "o campo do chat volta");

  // Desfazer: Removido: a sessao relida vem kicked = false, a sala volta a abrir.
  const removido = { banned: false, kicked: true, muted: false };
  const desfeito = model.localBanStillValid({ refusedAtMs: recusa, serverTimeIso: at(T0 + MIN), skewMs: 0 }) ? removido : { banned: false, kicked: false, muted: false };
  assert.equal(model.liveRoomScreen({ ban: model.mergeBan(depois, desfeito), inRoom: false, live: live(), staff: false }), "open");
});

test("a camera: o aceite vai no proximo sinal da camera mesmo depois do prazo; o prazo cobre o pedido do navegador; a camera que liga depois apaga o aviso", () => {
  // O aluno levou 6 s para responder ao pedido do navegador: o prazo de 5 s ja avisou, mas o aceite continua pendente.
  let pendente = true;
  const pedido = model.expectVideoToggle(model.INITIAL_LIVE_SIGNALS);
  const avisada = model.cameraRequestUnanswered(pedido);
  assert.equal(avisada.notice, "camera_blocked");
  let passo = model.consentForVideoSignal(pendente, "participantJoined");
  assert.deepEqual(passo, { consented: false, pending: true }, "outros sinais nao gastam o aceite");
  pendente = passo.pending;
  passo = model.consentForVideoSignal(pendente, "videoMuteStatusChanged");
  assert.deepEqual(passo, { consented: true, pending: false }, "videoMuteStatusChanged(muted:false) depois de 6 s: consented true");
  const ligou = model.applyLiveSignal(avisada, { name: "videoMuteStatusChanged", ownId: "eu", payload: { muted: false } });
  assert.deepEqual([ligou.videoOn, ligou.notice], [true, null], "sem o aviso de camera desligada");
  assert.deepEqual(model.consentForVideoSignal(true, "errorOccurred", { error: { name: "gum.permission_denied" } }), { consented: false, pending: false }, "a permissao negada encerra o aceite");
  assert.deepEqual(model.consentForVideoSignal(true, "errorOccurred", { error: { name: "conference.connectionError" } }), { consented: false, pending: true });
  assert.equal(model.cameraAnswerDelayMs("prompt"), 30_000, "com o pedido do navegador aberto, 30 s");
  assert.equal(model.cameraAnswerDelayMs("granted"), 5_000);
  assert.equal(model.cameraAnswerDelayMs(null), 5_000);
});

test("No palco: quem ja moderava quando o aluno entrou vem do getRoomsInfo (o participantJoined nao traz o papel); o proprio aluno e alunos ficam fora", () => {
  const info = {
    rooms: [
      { id: "sala-x", isMainRoom: false, participants: [{ displayName: "Outra", id: "x1", role: "moderator" }] },
      {
        isMainRoom: true,
        participants: [
          { displayName: "Produtor T.", id: "host-1", role: "moderator" },
          { displayName: "Ana M.", id: "aluna-2", role: "participant" },
          { displayName: "Eu", id: "eu", role: "moderator" }
        ]
      }
    ]
  };
  const state = model.applyRoomsInfo(model.INITIAL_LIVE_SIGNALS, info, "eu");
  assert.deepEqual(state.participants.moderators, ["host-1"]);
  assert.deepEqual(model.stageNames(state.participants, null), ["Produtor T."]);
  assert.equal(model.applyRoomsInfo(state, null, "eu"), state, "sem resposta, nada muda");
});

test("o selo Gravando com a gravacao no navegador: o sinal do console (so de quem modera) liga e desliga na hora", () => {
  const texto = (on) => JSON.stringify({ on, type: jitsi.RECORDING_SIGNAL });
  const pedido = (sender, text) => ({ eventData: { name: "endpoint-text-message", text }, senderInfo: { id: sender } });
  const comModerador = { participants: { moderators: ["host-1"], names: {} } };
  assert.equal(model.recordingSignalOf(comModerador, pedido("host-1", texto(true))), true);
  assert.equal(model.recordingSignalOf(comModerador, { data: pedido("host-1", texto(false)) }), false);
  assert.equal(model.recordingSignalOf(comModerador, pedido("aluno-2", texto(true))), null, "outro aluno nao liga o selo");
  assert.equal(model.recordingSignalOf(comModerador, pedido("host-1", JSON.stringify({ type: jitsi.LOWER_HAND_SIGNAL }))), null);
  assert.equal(model.isRecording({ recording: true }, { recording: false }), true, "o sinal vale antes da proxima leitura");
});
