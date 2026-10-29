import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// A sala da Live gravada, a parte pura (docs/30 §1.6, §5.1, §6.5 e §6.6): o zero do video e o offset, as fases e
// a entrada, a janela do chat, o relogio do navegador e o alvo do player, os baldes de presenca (M1, M2), o nome
// exibido (D10) e o endereco do player da Bunny. Da sala ao vivo (fase 3, D16 e D19): os limites na memoria dos lotes
// de sinais do iframe (6 por minuto) e da entrada do join-token (uma a cada 90 s, com a marca da presenca).

const room = await import("../src/server/webinars/room-model.ts");
const limits = await import("../src/server/webinars/room-limits.ts");
const { ROOM_RULES } = await import("../src/server/webinars/model.ts");

const T0 = Date.parse("2026-11-05T23:00:00.000Z");
const MIN = 60_000;
const simulated = { kind: "simulated", lateJoinMinutes: null, recordingAnchorAt: null, scheduledAt: new Date(T0).toISOString(), startedAt: null, status: "scheduled" };

test("o zero do video: a hora marcada na gravada, a ancora (ou o inicio) na live, nenhum no replay", () => {
  assert.equal(room.sessionVideoZero(simulated), T0);
  assert.equal(room.sessionVideoZero({ ...simulated, kind: "live", recordingAnchorAt: new Date(T0 + 5_000).toISOString(), startedAt: new Date(T0).toISOString() }), T0 + 5_000);
  assert.equal(room.sessionVideoZero({ ...simulated, kind: "live", startedAt: new Date(T0 + 1_000).toISOString() }), T0 + 1_000);
  assert.ok(Number.isNaN(room.sessionVideoZero({ ...simulated, kind: "replay" })));
  assert.equal(room.sessionOffsetMs(simulated, T0 + 90_000), 90_000);
  assert.equal(room.sessionOffsetMs(simulated, T0 - 30_000), -30_000, "negativo na espera");
  assert.equal(room.sessionDurationMs(3600, 60), 3_600_000);
  assert.equal(room.sessionDurationMs(null, 45), 45 * MIN, "sem gravacao, a duracao prevista");
});

test("fases e entrada: espera ate 15 min antes, no ar ate o fim do video, Entrada atrasada fecha a porta", () => {
  const duration = 60 * MIN;
  assert.equal(room.simulatedPhase(simulated, duration, T0 - MIN), "waiting");
  assert.equal(room.simulatedPhase(simulated, duration, T0 + MIN), "live");
  assert.equal(room.simulatedPhase(simulated, duration, T0 + duration), "ended");
  assert.equal(room.simulatedPhase({ ...simulated, status: "ended" }, duration, T0 + MIN), "ended", "encerrada pela equipe");

  assert.deepEqual(room.canJoinSimulated(simulated, duration, T0 - 16 * MIN), { ok: false, reason: "not_started" });
  assert.deepEqual(room.canJoinSimulated(simulated, duration, T0 - 14 * MIN), { ok: true });
  assert.deepEqual(room.canJoinSimulated(simulated, duration, T0 + 30 * MIN), { ok: true });
  assert.deepEqual(room.canJoinSimulated(simulated, duration, T0 + 61 * MIN), { ok: false, reason: "ended" });
  assert.deepEqual(room.canJoinSimulated({ ...simulated, lateJoinMinutes: 10 }, duration, T0 + 11 * MIN), { ok: false, reason: "late" });
  assert.deepEqual(room.canJoinSimulated({ ...simulated, lateJoinMinutes: 10 }, duration, T0 + 9 * MIN), { ok: true });
  assert.deepEqual(room.canJoinSimulated({ ...simulated, status: "cancelled" }, duration, T0 + MIN), { ok: false, reason: "ended" });
});

test("a janela do chat: 5 min para tras e 2 min para a frente ao entrar; a seguinte emenda sem repetir; limites da rota", () => {
  const first = room.initialChatWindow(50 * MIN);
  assert.deepEqual(first, { fromMs: 45 * MIN, toMs: 52 * MIN });
  const next = room.nextChatWindow(first);
  assert.deepEqual(next, { fromMs: 52 * MIN + 1, toMs: 54 * MIN });
  assert.deepEqual(room.initialChatWindow(-86_400_000 + 1000).fromMs, -86_400_000, "nunca abaixo do piso");
  assert.ok(room.isValidChatWindow(first));
  assert.ok(!room.isValidChatWindow({ fromMs: 0, toMs: 16 * MIN }), "mais de 15 min nao");
  assert.ok(!room.isValidChatWindow({ fromMs: 10, toMs: 5 }));
  assert.ok(!room.isValidChatWindow({ fromMs: 0.5, toMs: 10 }), "so inteiros");
  const lines = [{ offsetMs: 10 }, { offsetMs: 20 }, { offsetMs: 30 }];
  assert.deepEqual(room.visibleMessages(lines, 20), [{ offsetMs: 10 }, { offsetMs: 20 }]);
});

test("relogio e player: skew pela metade da ida e volta, alvo em segundos, recolocado so acima de 2 s", () => {
  assert.equal(room.clockSkewMs({ requestSentAtMs: 1000, responseReceivedAtMs: 1400, serverTimeMs: 6200 }), 5000);
  assert.equal(room.playerTargetSeconds({ deviceNowMs: T0 - 5000 + 125_000, skewMs: 5000, zeroMs: T0 }), 125);
  assert.ok(!room.needsResync(100, 101.5));
  assert.ok(room.needsResync(100, 102.5));
  assert.ok(room.needsResync(105, 100));
  assert.ok(!room.needsResync(Number.NaN, 100), "sem leitura, nada a fazer");
  assert.equal(ROOM_RULES.resyncToleranceSeconds, 2);
});

test("presenca: balde de 30 s, 95 % ate o fim, saida depois de 3 baldes sem sinal", () => {
  assert.equal(room.presenceBucket(0), 0);
  assert.equal(room.presenceBucket(29.9), 0);
  assert.equal(room.presenceBucket(30), 1);
  assert.equal(room.presenceBucket(-1), -1, "espera");
  assert.equal(room.bucketCount(3_600_000), 120);
  assert.equal(room.bucketCount(1), 1);
  assert.ok(room.reachedEnd(113, 3_600_000), "114 baldes de 120 = 95 %");
  assert.ok(!room.reachedEnd(112, 3_600_000));
  assert.ok(room.isStillPresent(10, 12));
  assert.ok(!room.isStillPresent(10, 13));
});

test("nome exibido (D10): primeiro nome e inicial, apelido, Aluno {n} estavel por aluno e webinario", () => {
  assert.equal(room.firstNameInitial("Ana Maria da Silva"), "Ana S.");
  assert.equal(room.firstNameInitial("Caio"), "Caio");
  assert.equal(room.firstNameInitial("  "), "Aluno");
  assert.equal(room.firstNameInitial("José de Souza"), "José S.");
  const n1 = room.anonymousNumber("u1", "w1");
  assert.equal(room.anonymousNumber("u1", "w1"), n1);
  assert.ok(n1 >= 100 && n1 <= 999);
  assert.notEqual(room.anonymousNumber("u1", "w2"), room.anonymousNumber("u1", "w1") === room.anonymousNumber("u1", "w2") ? -1 : room.anonymousNumber("u1", "w1"), "outro webinario, outro numero (quase sempre)");
  assert.equal(room.displayNameFor({ anonymousNumber: 123, fullName: "Ana Maria", mode: "anonymous", nickname: "aninha" }), "Aluno 123");
  assert.equal(room.displayNameFor({ anonymousNumber: 123, fullName: "Ana Maria", mode: "nickname", nickname: "  aninha  " }), "aninha");
  assert.equal(room.displayNameFor({ anonymousNumber: 123, fullName: "Ana Maria", mode: "nickname", nickname: "a" }), "Ana M.", "apelido curto demais cai no nome");
  assert.equal(room.displayNameFor({ anonymousNumber: 123, fullName: "Ana Maria", mode: "first_name_initial", nickname: null }), "Ana M.");
});

test("a mensagem para o aluno: scripted vai com o papel da persona, pendente so para o autor, fixada", () => {
  const base = {
    approved: true,
    authorUserId: "u1",
    body: "oi",
    createdAt: "2026-11-05T23:00:10.000Z",
    displayName: "Ana M.",
    id: "m1",
    kind: "message",
    master: false,
    offsetMs: 10_000,
    pinnedAt: null,
    replyToId: null,
    role: "student",
    scriptItemId: null,
    sessionId: "s1",
    source: "audience",
    webinarId: "w1"
  };
  assert.deepEqual(room.toStudentMessage(base, "u1"), { body: "oi", displayName: "Ana M.", id: "m1", kind: "message", mine: true, offsetMs: 10_000, pending: false, pinned: false, replyToId: null, role: "student" });
  const scripted = room.toStudentMessage({ ...base, authorUserId: null, role: "team", source: "scripted" }, "u1");
  assert.equal(scripted.role, "team");
  assert.equal(scripted.mine, false);
  assert.equal(room.toStudentMessage({ ...base, approved: false }, "u1").pending, true);
  assert.equal(room.toStudentMessage({ ...base, pinnedAt: "2026-11-05T23:01:00.000Z" }, null).pinned, true);
  assert.equal(room.toStudentMessage(base, null, 8_000).offsetMs, 8_000, "a linha mestre vem deslocada");
  assert.equal(room.offsetLabel(3_723_000), "1:02:03");
  assert.equal(room.offsetLabel(750_000), "12:30");
  assert.equal(room.offsetLabel(-30_000), "-0:30");
});

test("o player da Bunny: le o embed, monta o endereco com autoplay sem som, posicao e token; a frase da decisao (§8.6)", () => {
  assert.deepEqual(room.parseBunnyEmbed("https://iframe.mediadelivery.net/embed/12345/abcdef12-3456-7890-abcd-ef1234567890?autoplay=true"), {
    libraryId: "12345",
    videoId: "abcdef12-3456-7890-abcd-ef1234567890"
  });
  assert.deepEqual(room.parseBunnyEmbed("https://player.mediadelivery.net/play/12345/abcdef12-3456-7890-abcd-ef1234567890"), {
    libraryId: "12345",
    videoId: "abcdef12-3456-7890-abcd-ef1234567890"
  });
  assert.equal(room.parseBunnyEmbed("https://evil.example/embed/1/abcdef12"), null);
  assert.equal(room.parseBunnyEmbed("http://iframe.mediadelivery.net/embed/1/abcdef12-3456-7890-abcd-ef1234567890"), null, "so https");
  const url = new URL(room.bunnyEmbedUrl({ libraryId: "1", videoId: "abc" }, { expires: 1700000000, showControls: false, startSeconds: 125.7, token: "t0k" }));
  assert.equal(url.origin + url.pathname, "https://iframe.mediadelivery.net/embed/1/abc");
  assert.equal(url.searchParams.get("autoplay"), "true");
  assert.equal(url.searchParams.get("muted"), "true");
  assert.equal(url.searchParams.get("controls"), "false");
  assert.equal(url.searchParams.get("t"), "125");
  assert.equal(url.searchParams.get("token"), "t0k");
  assert.equal(url.searchParams.get("expires"), "1700000000");
  const replay = new URL(room.bunnyEmbedUrl({ libraryId: "1", videoId: "abc" }, { autoplay: false, muted: false }));
  assert.equal(replay.searchParams.get("autoplay"), "false");
  assert.equal(replay.searchParams.get("controls"), null);
  assert.equal(room.bunnyEmbedTokenInput("chave", "abc", 1700000000.9), "chaveabc1700000000");
  const sentence = room.simulationAckSentence({ badgeOn: true, date: "05/11/2026", numbersSimulated: false, responsible: "Danilo" });
  assert.match(sentence, /^Decisão do produtor em 05\/11\/2026: nesta sessão gravada, dentro da área de membros, o selo "Ao vivo" fica ligado e os números de plateia são reais\./);
  assert.match(sentence, /Responsável: Danilo\.$/);
});

test("sala ao vivo: 6 lotes de sinais por minuto por aluno e sessao; uma entrada a cada 90 s; a abertura vista pela presenca vale 90 s e se consome", () => {
  limits.resetRoomLimits();
  for (let i = 0; i < limits.ROOM_EVENT_BATCHES_PER_MINUTE; i += 1) {
    assert.equal(limits.takeRoomEventBatch("ana", "s1", T0 + i * 1000).ok, true, `lote ${i + 1}`);
  }
  const setimo = limits.takeRoomEventBatch("ana", "s1", T0 + 10_000);
  assert.deepEqual(setimo, { ok: false, retryAfterSeconds: 50 }, "volta quando o primeiro lote sai da janela");
  assert.equal(limits.takeRoomEventBatch("ana", "s2", T0 + 10_000).ok, true, "outra sessao, outra conta");
  assert.equal(limits.takeRoomEventBatch("bia", "s1", T0 + 10_000).ok, true, "outro aluno, outra conta");
  assert.equal(limits.takeRoomEventBatch("ana", "s1", T0 + 60_000).ok, true, "um minuto depois do primeiro");

  assert.equal(limits.LIVE_JOIN_WINDOW_MS, ROOM_RULES.leaveAfterBuckets * ROOM_RULES.bucketSeconds * 1000);
  assert.equal(limits.LIVE_JOIN_WINDOW_MS, 90_000);
  assert.equal(limits.takeLiveJoinRecord("ana", "s1", T0), true, "a primeira entrada");
  assert.equal(limits.takeLiveJoinRecord("ana", "s1", T0 + 89_000), false, "o token renovado nao e entrada");
  assert.equal(limits.takeLiveJoinRecord("ana", "s1", T0 + 90_000), true, "depois de 90 s, sim");

  limits.markLiveOpening("ana", "s1", T0);
  assert.equal(limits.consumeLiveOpening("ana", "s1", T0 + 5000), true);
  assert.equal(limits.consumeLiveOpening("ana", "s1", T0 + 6000), false, "consumida");
  limits.markLiveOpening("ana", "s1", T0);
  assert.equal(limits.consumeLiveOpening("ana", "s1", T0 + 91_000), false, "vencida");

  limits.markLiveOpening("ana", "s1", T0);
  limits.resetRoomLimits();
  assert.equal(limits.consumeLiveOpening("ana", "s1", T0 + 1000), false, "resetRoomLimits zera tudo");
  assert.equal(limits.takeRoomEventBatch("ana", "s1", T0 + 10_000).ok, true);
});
