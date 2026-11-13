import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// A sala da Live gravada, a parte pura (docs/30 §1.6, §5.1, §6.5 e §6.6): o zero do video e o offset, as fases e
// a entrada, a janela do chat, o relogio do navegador e o alvo do player, os baldes de presenca (M1, M2), o nome
// exibido (D10; desde 10/11/2026, D64, sempre o primeiro nome com a inicial, sem anonimo e sem apelido), o aceite em dia
// (versao e modo de agora) e o endereco do player da Bunny. Da sala ao vivo (fase 3, D16 e D19): os limites na memoria dos lotes
// de sinais do iframe (6 por minuto) e da entrada do join-token (uma a cada 90 s, com a marca da presenca).

const room = await import("../src/server/webinars/room-model.ts");
const limits = await import("../src/server/webinars/room-limits.ts");
const model = await import("../src/server/webinars/model.ts");
const { ROOM_RULES } = model;

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

test("nome exibido (D10 e D64): sempre o primeiro nome e a inicial do sobrenome, sem apelido e sem Aluno {n}; o numero do anonimo antigo continua estavel para as linhas de antes", () => {
  assert.equal(room.firstNameInitial("Ana Maria da Silva"), "Ana S.");
  assert.equal(room.firstNameInitial("Caio"), "Caio");
  assert.equal(room.firstNameInitial("  "), "Aluno");
  assert.equal(room.firstNameInitial("José de Souza"), "José S.");
  const n1 = room.anonymousNumber("u1", "w1");
  assert.equal(room.anonymousNumber("u1", "w1"), n1);
  assert.ok(n1 >= 100 && n1 <= 999);
  assert.notEqual(room.anonymousNumber("u1", "w2"), room.anonymousNumber("u1", "w1") === room.anonymousNumber("u1", "w2") ? -1 : room.anonymousNumber("u1", "w1"), "outro webinario, outro numero (quase sempre)");
  // D64 (10/11/2026): o nome nao depende de escolha nenhuma. Quem ainda chama com o modo e o apelido de antes (um
  // aceite antigo, o card Sala antigo) recebe o primeiro nome com a inicial do mesmo jeito.
  assert.equal(room.displayNameFor({ fullName: "Ana Maria" }), "Ana M.");
  assert.equal(room.displayNameFor({ anonymousNumber: 123, fullName: "Ana Maria", mode: "anonymous", nickname: "aninha" }), "Ana M.", "nunca Aluno {n}");
  assert.equal(room.displayNameFor({ anonymousNumber: 123, fullName: "Ana Maria", mode: "nickname", nickname: "  aninha  " }), "Ana M.", "nunca o apelido");
  assert.equal(room.displayNameFor({ fullName: null }), "Aluno", "o perfil sem nome");
  assert.equal(room.displayNameFor({ fullName: `${"a".repeat(120)} Silva` }).length, 80, "o teto do nome gravado");
  assert.deepEqual([...model.DISPLAY_NAME_MODES], ["first_name_initial"], "um modo so");
  assert.deepEqual([...model.LEGACY_DISPLAY_NAME_MODES], ["nickname", "anonymous"], "os antigos so para ler o que o banco ainda aceita");
  assert.equal(model.CHAT_LIMITS.nicknameMin, undefined, "o apelido nao tem mais limite no app");
});

test("o aceite em dia (D64): sem retirada, na versao de agora e com o modo de agora; o aceite antigo com apelido ou anonimo vale como sem aceite", () => {
  const emDia = { consent_version: model.CHAT_CONSENT_VERSION, display_mode: "first_name_initial", revoked_at: null };
  assert.equal(model.CHAT_CONSENT_VERSION, 2, "a versao continua 2 (so o texto mudou)");
  assert.equal(model.chatConsentIsCurrent(emDia), true);
  assert.equal(model.chatConsentIsCurrent({ ...emDia, display_mode: "anonymous" }), false, "o anonimo de antes");
  assert.equal(model.chatConsentIsCurrent({ ...emDia, display_mode: "nickname" }), false, "o apelido de antes");
  assert.equal(model.chatConsentIsCurrent({ ...emDia, display_mode: null }), false);
  assert.equal(model.chatConsentIsCurrent({ ...emDia, display_mode: "qualquer" }), false);
  assert.equal(model.chatConsentIsCurrent({ ...emDia, consent_version: 1 }), false, "a versao 1 (so o nome)");
  assert.equal(model.chatConsentIsCurrent({ ...emDia, revoked_at: "2026-11-10T12:00:00.000Z" }), false, "retirado");
  assert.equal(model.chatConsentIsCurrent(null), false);
  assert.equal(model.chatConsentIsCurrent(undefined), false);
});

test("a mensagem para o aluno: scripted vai com o papel da persona, pendente so para o autor, fixada; a hora gravada so na live", () => {
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
  assert.deepEqual(room.toStudentMessage(base, "u1", "simulated"), { avatarUrl: null, body: "oi", displayName: "Ana M.", id: "m1", kind: "message", links: false, mine: true, offsetMs: 10_000, pending: false, pinned: false, replyToId: null, role: "student", sentAt: null });
  const scripted = room.toStudentMessage({ ...base, authorUserId: null, role: "team", source: "scripted" }, "u1", "simulated");
  assert.equal(scripted.role, "team");
  assert.equal(scripted.mine, false);
  // Link so na mensagem da equipe (especificacao "Na tela", §8.1): papel da equipe E origem console ou roteiro.
  assert.equal(scripted.links, true, "a fala de um personagem da equipe");
  for (const role of ["host", "co_host", "team"]) {
    assert.equal(room.toStudentMessage({ ...base, role, source: "team" }, "u1", "live").links, true, role);
  }
  assert.equal(room.toStudentMessage({ ...base, role: "student", source: "scripted" }, "u1", "simulated").links, false, "o personagem de aluno do roteiro");
  assert.equal(room.toStudentMessage({ ...base, role: "ai", source: "ai" }, "u1", "live").links, false, "o Assistente");
  assert.equal(room.toStudentMessage({ ...base, role: "team", source: "audience" }, "u1", "live").links, false, "papel de equipe numa linha da turma");
  assert.equal(room.toStudentMessage({ ...base, role: "team", source: "original" }, "u1", "simulated").links, false, "a linha mestre repetida");
  assert.equal(room.toStudentMessage({ ...base, approved: false }, "u1", "simulated").pending, true);
  assert.equal(room.toStudentMessage({ ...base, pinnedAt: "2026-11-05T23:01:00.000Z" }, null, "simulated").pinned, true);
  assert.equal(room.toStudentMessage(base, null, "simulated", 8_000).offsetMs, 8_000, "a linha mestre vem deslocada");
  // A hora em que o servidor gravou (docs/31 V2-9) so na live: na gravada e no Replay a linha mestre diria a data da
  // live de origem.
  assert.equal(room.toStudentMessage(base, "u1", "live").sentAt, "2026-11-05T23:00:10.000Z");
  // A foto de quem escreveu so entra quando quem monta a manda (authorPhotoUrl decide antes).
  assert.equal(room.toStudentMessage(base, "u1", "live", base.offsetMs, "https://exemplo.test/ana.jpg").avatarUrl, "https://exemplo.test/ana.jpg");
  assert.equal(room.toStudentMessage(base, "u1", "replay").sentAt, null);
  assert.equal(room.offsetLabel(3_723_000), "1:02:03");
  assert.equal(room.offsetLabel(750_000), "12:30");
  assert.equal(room.offsetLabel(-30_000), "-0:30");
});

test("a foto de quem escreveu (docs/30 §8.5; D115, 13/11/2026): quem enviou a foto pelo Perfil aparece com ela, sempre, para a turma e para a equipe, sem depender do aceite; as iniciais so sem foto; nunca no anonimo (legado: linhas de antes de 10/11/2026); o roteiro e o Assistente nunca", () => {
  const foto = "https://exemplo.test/ana.jpg";
  const comFoto = { avatarUrl: foto };
  const aluno = { authorUserId: "u1", displayName: "Ana M.", photo: comFoto, source: "audience", viewer: "student", webinarId: "w1" };
  assert.equal(room.authorPhotoUrl(aluno), foto, "o aluno com foto no Perfil, para os outros alunos, com ou sem o aceite do chat");
  assert.equal(room.authorPhotoUrl({ ...aluno, viewer: "team" }), foto, "a mesma foto para a equipe no console");
  assert.equal(room.authorPhotoUrl({ ...aluno, photo: { avatarUrl: null } }), null, "sem foto no perfil: as iniciais");
  assert.equal(room.authorPhotoUrl({ ...aluno, photo: undefined }), null);
  // O anonimo (legado: linhas de antes de 10/11/2026, D64; nada novo e gravado assim): pela pergunta Anonima ou pelo
  // nome gravado "Aluno {n}" de quem participava como anonimo; nem a equipe ve.
  const anonimo = room.anonymousDisplayName("u1", "w1");
  assert.match(anonimo, /^Aluno \d{3}$/);
  assert.equal(room.authorPhotoUrl({ ...aluno, displayName: anonimo }), null);
  assert.equal(room.authorPhotoUrl({ ...aluno, displayName: anonimo, viewer: "team" }), null);
  assert.equal(room.authorPhotoUrl({ ...aluno, anonymous: true }), null);
  assert.equal(room.authorPhotoUrl({ ...aluno, anonymous: true, viewer: "team" }), null);
  assert.equal(room.authorPhotoUrl({ ...aluno, displayName: room.anonymousDisplayName("u1", "outro") }), foto, "o numero e por webinario: o de outro nao esconde");
  // A equipe (quem apresenta a live) e a mensagem de aluno levada para as proximas turmas: a mesma foto.
  assert.equal(room.authorPhotoUrl({ ...aluno, source: "team" }), foto);
  assert.equal(room.authorPhotoUrl({ ...aluno, source: "original" }), foto);
  // O roteiro e o Assistente nao tem pessoa.
  assert.equal(room.authorPhotoUrl({ ...aluno, source: "scripted" }), null);
  assert.equal(room.authorPhotoUrl({ ...aluno, source: "ai" }), null);
  assert.equal(room.authorPhotoUrl({ ...aluno, authorUserId: null }), null);
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
