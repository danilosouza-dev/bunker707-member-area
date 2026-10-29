import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// A Sala no navegador, a parte pura (docs/30 §1.6, §6.6, §8.3 e §9; docs/18 §2.2): a trava do player (esperar
// antes do zero, recolocar so acima de 2 s, encerrar no fim), a fase pelo relogio corrigido, a janela do chat
// (a primeira ao entrar, a seguinte 30 s antes do fim da atual, recomeca num salto), a fusao das mensagens sem
// repetir e a revelacao pelo segundo do player, o estado de presenca, o compositor (modo do chat, modo lento,
// aceite), as bolhas das reacoes e os enderecos. Mais as regras puras do servidor que as rotas repetem
// (room-rules.ts: quando se pode escrever, o offset gravado, a enquete e a pergunta do aluno, o cursor) e os
// limites na memoria (room-limits.ts: rajada 5/60 s, perguntas 2/min, modo lento), com o relogio por parametro.

const client = await import("../src/lib/webinar-room-client.ts");
const rules = await import("../src/server/webinars/room-rules.ts");
const limits = await import("../src/server/webinars/room-limits.ts");
const { ROOM_RULES } = await import("../src/server/webinars/model.ts");

const MIN = 60_000;
const T0 = Date.parse("2026-11-05T23:00:00.000Z");
const msg = (id, offsetMs, extra = {}) => ({ body: id, displayName: "Ana M.", id, kind: "message", mine: false, offsetMs, pending: false, pinned: false, replyToId: null, role: "student", ...extra });

test("a trava do player: espera antes do zero, nada dentro de 2 s, recoloca acima de 2 s, encerra no fim; sem leitura nao recoloca", () => {
  assert.deepEqual(client.lockDecision({ currentSeconds: 0, durationSeconds: 3600, targetSeconds: -5 }), { action: "wait" });
  assert.deepEqual(client.lockDecision({ currentSeconds: 100, durationSeconds: 3600, targetSeconds: 101.5 }), { action: "none" });
  assert.deepEqual(client.lockDecision({ currentSeconds: 100, durationSeconds: 3600, targetSeconds: 102.5 }), { action: "seek", to: 102.5 });
  assert.deepEqual(client.lockDecision({ currentSeconds: 110, durationSeconds: 3600, targetSeconds: 100 }), { action: "seek", to: 100 }, "adiantou (pulou): volta");
  assert.deepEqual(client.lockDecision({ currentSeconds: null, durationSeconds: 3600, targetSeconds: 100 }), { action: "none" });
  assert.deepEqual(client.lockDecision({ currentSeconds: 3599, durationSeconds: 3600, targetSeconds: 3600 }), { action: "ended" });
  assert.deepEqual(client.lockDecision({ currentSeconds: 0, durationSeconds: 3600, targetSeconds: Number.NaN }), { action: "wait" });
});

test("o relogio corrigido: o alvo pelo skew e a fase (espera, no ar, encerrada pelo tempo ou pela equipe)", () => {
  // O aparelho esta 5 s atrasado (skew = +5000): 90 s depois do zero no servidor.
  assert.equal(client.targetOffsetMs({ deviceNowMs: T0 + 85_000, skewMs: 5000, zeroMs: T0 }), 90_000);
  const base = { durationMs: 60 * MIN, ended: false, skewMs: 0, zeroMs: T0 };
  assert.equal(client.roomPhaseAt({ ...base, deviceNowMs: T0 - 1 }), "waiting");
  assert.equal(client.roomPhaseAt({ ...base, deviceNowMs: T0 }), "live");
  assert.equal(client.roomPhaseAt({ ...base, deviceNowMs: T0 + 60 * MIN }), "ended");
  assert.equal(client.roomPhaseAt({ ...base, deviceNowMs: T0 + MIN, ended: true }), "ended", "encerrada pela equipe vence o relogio");
  assert.equal(client.clockSkewMs({ requestSentAtMs: 1000, responseReceivedAtMs: 1400, serverTimeMs: 6200 }), 5000);
});

test("a janela do chat: a primeira ao entrar, a seguinte 30 s antes do fim (a cada 90 s), nenhuma no meio, recomeca no salto e quando o player passou da janela", () => {
  const first = client.chatWindowToFetch({ current: null, playerOffsetMs: 10 * MIN });
  assert.deepEqual(first, client.initialChatWindow(10 * MIN));
  assert.deepEqual(first, { fromMs: 5 * MIN, toMs: 12 * MIN });
  assert.equal(client.chatWindowToFetch({ current: first, playerOffsetMs: 10 * MIN + 30_000 }), null, "no meio da janela nada");
  assert.deepEqual(client.chatWindowToFetch({ current: first, playerOffsetMs: 12 * MIN - client.WINDOW_LEAD_MS }), client.nextChatWindow(first), "30 s antes do fim pede a seguinte");
  assert.equal(client.WINDOW_LEAD_MS, 30_000);
  assert.deepEqual(client.chatWindowToFetch({ current: first, playerOffsetMs: 20 * MIN }), client.seekChatWindow(20 * MIN), "passou da janela (aba congelada): recomeca");
  assert.deepEqual(client.chatWindowToFetch({ current: first, playerOffsetMs: 3 * MIN, seeked: true }), client.seekChatWindow(3 * MIN), "o replay pulou");
});

test("mensagens: a mesma id entra uma vez (a aprovada substitui a pendente), em ordem de offset; reveladas pelo segundo do player, as minhas na hora", () => {
  const merged = client.mergeMessages([msg("a", 10_000), msg("b", 20_000, { pending: true, mine: true })], [msg("b", 20_000, { mine: true }), msg("c", 5_000)]);
  assert.deepEqual(
    merged.map((message) => [message.id, message.pending]),
    [
      ["c", false],
      ["a", false],
      ["b", false]
    ]
  );
  assert.deepEqual(client.revealedMessages(merged, 12_000).map((message) => message.id), ["c", "a", "b"], "b e minha: aparece na hora, mesmo com offset a frente");
  assert.deepEqual(client.revealedMessages(merged.map((message) => ({ ...message, mine: false })), 12_000).map((message) => message.id), ["c", "a"], "de outro aluno, so quando o player chega la");
  const mine = msg("m", 90_000, { mine: true });
  assert.deepEqual(client.revealedMessages([...merged, mine], 12_000).map((message) => message.id), ["c", "a", "b", "m"]);
  assert.equal(client.newMessageCount(new Set(["c"]), client.revealedMessages(merged, 60_000)), 2);
});

test("presenca e compositor: o estado do sinal; desligado, so a equipe, modo lento com a contagem, aceite na primeira, encerrada", () => {
  assert.equal(client.presenceStateOf({ bridge: "confirmed", playing: true, visible: false }), "hidden");
  assert.equal(client.presenceStateOf({ bridge: "confirmed", playing: true, visible: true }), "playing");
  assert.equal(client.presenceStateOf({ bridge: "pending", playing: false, visible: true }), "buffering");
  assert.equal(client.presenceStateOf({ bridge: "confirmed", playing: false, visible: true }), "paused");

  const base = { chatMode: "open", consented: true, nowMs: T0, phase: "live", slowUntilMs: null };
  assert.deepEqual(client.composerState(base), { disabled: false, reason: null, waitSeconds: 0 });
  assert.deepEqual(client.composerState({ ...base, chatMode: "off" }), { disabled: true, reason: "chat_off", waitSeconds: 0 });
  assert.deepEqual(client.composerState({ ...base, chatMode: "team_only" }), { disabled: true, reason: "team_only", waitSeconds: 0 });
  assert.deepEqual(client.composerState({ ...base, slowUntilMs: T0 + 12_400 }), { disabled: true, reason: "slow_mode", waitSeconds: 13 });
  assert.deepEqual(client.composerState({ ...base, consented: false }), { disabled: false, reason: "consent", waitSeconds: 0 }, "escreve, e o aceite aparece ao enviar");
  assert.deepEqual(client.composerState({ ...base, phase: "ended" }), { disabled: true, reason: "ended", waitSeconds: 0 });
  assert.deepEqual(client.composerState({ ...base, phase: "replay" }), { disabled: false, reason: null, waitSeconds: 0 });
  assert.deepEqual(client.initialChatCursor("2026-11-05T23:00:00.000Z"), { after: null, since: "2026-11-05T23:00:00.000Z" });
});

test("reacoes: as contagens viram bolhas (uma por reacao por rodada), as vencidas saem, o teto vira contador, reduced-motion encurta", () => {
  const first = client.nextReactionBubbles([], { clap: 2, like: 1 }, T0, { nextId: 1 });
  assert.deepEqual(
    first.bubbles.map((bubble) => [bubble.reaction, bubble.until - T0]),
    [
      ["clap", client.REACTION_BUBBLE_MS],
      ["like", client.REACTION_BUBBLE_MS],
      ["clap", client.REACTION_BUBBLE_MS]
    ]
  );
  assert.equal(first.nextId, 4);
  assert.equal(first.overflow, 0);
  const second = client.nextReactionBubbles(first.bubbles, { fire: 20 }, T0 + 1000, { nextId: first.nextId });
  assert.equal(second.bubbles.length, client.REACTION_BUBBLE_MAX, "o teto");
  assert.equal(second.overflow, 20 - (client.REACTION_BUBBLE_MAX - 3));
  const later = client.nextReactionBubbles(second.bubbles, {}, T0 + 5000, { nextId: second.nextId });
  assert.equal(later.bubbles.length, 0, "todas vencidas");
  const still = client.nextReactionBubbles([], { wow: 1 }, T0, { nextId: 1, reducedMotion: true });
  assert.equal(still.bubbles[0].until - T0, client.REACTION_STILL_MS);
});

test("enderecos: as rotas do aluno e o id do sinal de midia", () => {
  assert.equal(client.roomApiPath("w1", "chat", { from: 0, sessao: "s1", to: 120000 }), "/api/webinars/w1/chat?from=0&sessao=s1&to=120000");
  assert.equal(client.roomApiPath("w1", "heartbeat"), "/api/webinars/w1/heartbeat");
  assert.equal(client.roomApiPath("w 1", "reactions", { since: null }), "/api/webinars/w%201/reactions");
  assert.equal(client.questionVotePath("w1", "q1"), "/api/webinars/w1/questions/q1/vote");
  assert.equal(client.roomMediaLessonId("s1"), "webinar:s1");
});

/* ------------------------------------------------------------------------------------------------
 * As regras puras do servidor (room-rules.ts) e os limites na memoria (room-limits.ts)
 * ---------------------------------------------------------------------------------------------- */

const simulated = { chatMode: "open", chatSlowModeSeconds: null, kind: "simulated", lateJoinMinutes: null, recordingAnchorAt: null, scheduledAt: new Date(T0).toISOString(), startedAt: null, status: "scheduled" };
const HOUR = 60 * MIN;

test("quando o aluno escreve: da abertura da sala (15 min antes) ate o fim; depois da Entrada atrasada continua; modo do chat; replay sempre; live so em espera ou no ar", () => {
  assert.equal(rules.postingRefusal(simulated, HOUR, T0 - 16 * MIN), "not_started");
  assert.equal(rules.postingRefusal(simulated, HOUR, T0 - 14 * MIN), null, "sala de espera com chat");
  assert.equal(rules.postingRefusal(simulated, HOUR, T0 + 30 * MIN), null);
  assert.equal(rules.postingRefusal({ ...simulated, lateJoinMinutes: 10 }, HOUR, T0 + 30 * MIN), null, "quem ja entrou continua escrevendo");
  assert.equal(rules.postingRefusal(simulated, HOUR, T0 + HOUR), "ended");
  assert.equal(rules.postingRefusal({ ...simulated, status: "ended" }, HOUR, T0 + MIN), "ended");
  assert.equal(rules.postingRefusal({ ...simulated, status: "cancelled" }, HOUR, T0 + MIN), "ended");
  assert.equal(rules.postingRefusal({ ...simulated, chatMode: "off" }, HOUR, T0 + MIN), "chat_off");
  assert.equal(rules.postingRefusal({ ...simulated, chatMode: "team_only" }, HOUR, T0 + MIN), "team_only");
  assert.equal(rules.postingRefusal({ ...simulated, chatMode: "off" }, HOUR, T0 + MIN, "interaction"), null, "reacao e enquete nao dependem do modo do chat");
  assert.equal(rules.postingRefusal({ ...simulated, chatMode: "moderated" }, HOUR, T0 + MIN), null);
  assert.equal(rules.postingRefusal({ ...simulated, kind: "replay" }, HOUR, T0 - 10 * HOUR), null);
  assert.equal(rules.postingRefusal({ ...simulated, kind: "live", status: "scheduled" }, HOUR, T0 + MIN), "not_started");
  assert.equal(rules.postingRefusal({ ...simulated, kind: "live", status: "waiting" }, HOUR, T0 + MIN), null);
  assert.equal(rules.postingRefusal({ ...simulated, kind: "live", status: "ended" }, HOUR, T0 + MIN), "ended");
});

test("o offset gravado: o relogio do servidor na gravada (o do corpo e ignorado), a posicao do player no replay, 0 sem nada", () => {
  assert.equal(rules.writeOffsetMs(simulated, T0 + 90_500, 5), 90_500);
  assert.equal(rules.writeOffsetMs({ ...simulated, kind: "replay" }, T0 + 90_500, 12_345), 12_345);
  assert.equal(rules.writeOffsetMs({ ...simulated, kind: "replay" }, T0, undefined), 0);
  assert.equal(rules.deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), "mobile");
  assert.equal(rules.deviceOf("Mozilla/5.0 (Macintosh; Intel Mac OS X)"), "desktop");
  assert.equal(rules.deviceOf(null), "desktop");
});

test("a enquete do aluno: modelo e rascunho ficam de fora, a encerrada so com resultado, a resposta dele, as contagens so quando compartilhadas; a resposta cabe", () => {
  const poll = { anonymous: false, closedAt: null, id: "p1", kind: "single", openOffsetMs: 0, openedAt: "x", options: [{ id: "o1", label: "Sim", position: 0 }, { id: "o2", label: "Não", position: 1 }], position: 0, question: "Gostou?", resultsSharedAt: null, sessionId: "s1", status: "open", templatePollId: null, webinarId: "w1" };
  const answers = [
    { createdAt: "x", id: "a1", offsetMs: 0, optionIds: ["o1"], pollId: "p1", sessionId: "s1", userId: "u1" },
    { createdAt: "x", id: "a2", offsetMs: 0, optionIds: ["o2"], pollId: "p1", sessionId: "s1", userId: "u2" }
  ];
  assert.equal(rules.toStudentPoll({ ...poll, sessionId: null }, [], "u1"), null, "o modelo");
  assert.equal(rules.toStudentPoll({ ...poll, status: "draft" }, [], "u1"), null);
  assert.equal(rules.toStudentPoll({ ...poll, status: "closed" }, answers, "u1"), null, "encerrada sem resultado some");
  const open = rules.toStudentPoll(poll, answers, "u1");
  assert.deepEqual(open.myOptionIds, ["o1"]);
  assert.equal(open.results, null);
  assert.equal(rules.toStudentPoll(poll, answers, "u3").myOptionIds, null);
  const shared = rules.toStudentPoll({ ...poll, resultsSharedAt: "x", status: "closed" }, answers, "u1");
  assert.deepEqual(shared.results, { counts: { o1: 1, o2: 1 }, total: 2 });
  assert.equal(shared.status, "closed");

  assert.equal(rules.pollAnswerProblem(poll, ["o1"]), null);
  assert.equal(rules.pollAnswerProblem(poll, ["o1", "o2"]), "too_many");
  assert.equal(rules.pollAnswerProblem({ ...poll, kind: "multiple" }, ["o1", "o2"]), null);
  assert.equal(rules.pollAnswerProblem(poll, ["o9"]), "invalid_options");
  assert.equal(rules.pollAnswerProblem({ ...poll, kind: "multiple" }, ["o1", "o1"]), "invalid_options", "repetida");
  assert.equal(rules.pollAnswerProblem({ ...poll, status: "closed" }, ["o1"]), "closed");
});

test("a pergunta do aluno: mine e voted; a dispensada so para o autor; o cursor das mensagens novas", () => {
  const question = { anonymous: false, answerText: null, answeredAt: null, answeredBy: null, answeredLive: false, body: "?", createdAt: "x", displayName: "Ana M.", id: "q1", messageId: null, offsetMs: 0, sessionId: "s1", status: "open", upvotes: 2, userId: "u1" };
  assert.equal(rules.toStudentQuestion(question, "u1", true).mine, true);
  assert.equal(rules.toStudentQuestion(question, "u2", false).voted, false);
  assert.equal(rules.toStudentQuestion({ ...question, status: "dismissed" }, "u2", false), null);
  assert.equal(rules.toStudentQuestion({ ...question, status: "dismissed" }, "u1", false).status, "dismissed");

  const rows = [{ created_at: "2026-11-05T23:00:01.000Z", id: "m1" }, { created_at: "2026-11-05T23:00:02.000Z", id: "m2" }];
  assert.deepEqual(rules.nextChatCursor(rows, null, "now"), { after: "m2", since: "2026-11-05T23:00:02.000Z" });
  assert.deepEqual(rules.nextChatCursor([], { after: "m2", since: "s" }, "now"), { after: "m2", since: "s" });
  assert.deepEqual(rules.nextChatCursor([], null, "2026-11-05T23:00:09.000Z"), { after: null, since: "2026-11-05T23:00:09.000Z" });
  assert.deepEqual(rules.countReactions([{ reaction: "like" }, { reaction: "like" }, { reaction: "x" }], ["like", "love"]), { like: 2, love: 0 });
  assert.deepEqual(rules.chatSentMetadata({ kind: "message", length: 3, messageId: "m", offsetMs: 10 }), { kind: "message", length: 3, message_id: "m", offset_ms: 10 });
  assert.deepEqual(rules.consentRevokedMetadata(1), { consent_version: 1, revoked: true });
});

test("limites na memoria: rajada 5 por 60 s por aluno e sessao (a 6a espera a janela), perguntas 2 por minuto, modo lento conta da ultima mensagem", () => {
  limits.resetRoomLimits();
  for (let i = 0; i < ROOM_RULES.chatBurst.max; i += 1) {
    assert.equal(limits.takeChatBurst("u1", "s1", T0 + i * 1000).ok, true, `mensagem ${i + 1}`);
  }
  const sixth = limits.takeChatBurst("u1", "s1", T0 + 10_000);
  assert.equal(sixth.ok, false);
  assert.equal(sixth.retryAfterSeconds, 50, "a janela abre quando a primeira sai (60 s depois dela)");
  assert.equal(limits.takeChatBurst("u1", "s2", T0 + 10_000).ok, true, "outra sessao, outra conta");
  assert.equal(limits.takeChatBurst("u2", "s1", T0 + 10_000).ok, true, "outro aluno");
  assert.equal(limits.takeChatBurst("u1", "s1", T0 + 60_001).ok, true, "a janela deslizou");

  assert.equal(limits.takeQuestionBurst("u1", "s1", T0).ok, true);
  assert.equal(limits.takeQuestionBurst("u1", "s1", T0 + 1).ok, true);
  assert.equal(limits.takeQuestionBurst("u1", "s1", T0 + 2).ok, false);

  assert.equal(limits.slowModeWaitSeconds("u1", "s1", 20, T0), 0, "antes da primeira mensagem nada");
  limits.markChatSent("u1", "s1", T0);
  assert.equal(limits.slowModeWaitSeconds("u1", "s1", 20, T0 + 5_000), 15);
  assert.equal(limits.slowModeWaitSeconds("u1", "s1", 20, T0 + 20_000), 0);
  assert.equal(limits.slowModeWaitSeconds("u1", "s1", null, T0 + 1), 0, "sem modo lento");
  limits.resetRoomLimits();
});
