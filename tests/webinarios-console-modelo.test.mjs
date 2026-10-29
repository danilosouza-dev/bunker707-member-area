import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// O console da sessao e os cards da fase 2b, a parte pura (docs/30 §2.4, §6.6 D6-c, §8.6): a fase que a equipe ve
// pelo relogio, o que abre e encerra, a sessao que o console escolhe sozinho, a fila do roteiro com o que ja entrou,
// as contagens das enquetes, a ordem do quadro de perguntas, as acoes de cada mensagem e a frase da decisao do selo
// (a mesma no navegador e no servidor, com a data de ontem valendo na virada da meia-noite).

const console_ = await import("../src/server/webinars/console-model.ts");
const room = await import("../src/server/webinars/room-model.ts");

const T0 = Date.parse("2026-11-05T23:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DURATION = 60 * MIN;

function session(extra = {}) {
  return {
    chatMode: "open",
    chatSlowModeSeconds: null,
    createdAt: new Date(T0 - 7 * 24 * HOUR).toISOString(),
    endedAt: null,
    id: "s1",
    kind: "simulated",
    lateJoinMinutes: null,
    pinnedMessageId: null,
    presenceCurve: null,
    recordingAnchorAt: null,
    recordingId: null,
    scheduledAt: new Date(T0).toISOString(),
    scriptFiredAt: null,
    showLiveBadge: false,
    simulationAckText: null,
    simulationDecidedAt: null,
    simulationDecidedBy: null,
    sourceSessionId: null,
    startedAt: null,
    status: "scheduled",
    updatedAt: new Date(T0 - 7 * 24 * HOUR).toISOString(),
    webinarId: "w1",
    ...extra
  };
}

test("a fase pelo relogio: agendada ate 15 min antes, na espera, no ar ate o fim do video, encerrada; cancelada e replay pela situacao", () => {
  const simulated = session();
  assert.equal(console_.consolePhaseOf(simulated, DURATION, T0 - HOUR), "scheduled");
  assert.equal(console_.consolePhaseOf(simulated, DURATION, T0 - 10 * MIN), "waiting");
  assert.equal(console_.consolePhaseOf({ ...simulated, status: "live" }, DURATION, T0 + 5 * MIN), "live");
  assert.equal(console_.consolePhaseOf(simulated, DURATION, T0 + 5 * MIN), "live", "a hora chegou: o relogio manda, mesmo antes do tick abrir");
  assert.equal(console_.consolePhaseOf({ ...simulated, status: "live" }, DURATION, T0 + DURATION + MIN), "ended");
  assert.equal(console_.consolePhaseOf({ ...simulated, status: "ended" }, DURATION, T0 + MIN), "ended", "encerrada pela equipe");
  assert.equal(console_.consolePhaseOf({ ...simulated, status: "cancelled" }, DURATION, T0 + MIN), "cancelled");
  assert.equal(console_.consolePhaseOf({ ...simulated, kind: "replay", status: "live" }, DURATION, T0), "replay");
  assert.equal(console_.consolePhaseOf({ ...simulated, kind: "live", status: "waiting" }, DURATION, T0 + MIN), "waiting", "a live ao vivo segue a situacao gravada");
  assert.equal(console_.consolePhaseOf({ ...simulated, kind: "live" }, DURATION, T0 + 3 * HOUR), "scheduled");
  for (const phase of console_.CONSOLE_PHASES) {
    assert.ok(console_.consolePhaseLabel(phase).length > 0, phase);
    assert.ok(["error", "muted", "neutral", "success", "warning"].includes(console_.consolePhaseTone(phase)));
  }
});

test("abrir so agendada ou na espera; encerrar so na espera ou no ar; a equipe age enquanto nao acabou e nunca no replay", () => {
  assert.deepEqual(["scheduled", "waiting", "live", "ended", "cancelled"].map(console_.canOpenSession), [true, true, false, false, false]);
  assert.deepEqual(["scheduled", "waiting", "live", "ended", "cancelled"].map(console_.canEndSession), [false, true, true, false, false]);
  assert.equal(console_.canTeamActOn(session({ status: "scheduled" })), true, "a sala de espera tem chat");
  assert.equal(console_.canTeamActOn(session({ status: "live" })), true);
  assert.equal(console_.canTeamActOn(session({ status: "ended" })), false);
  assert.equal(console_.canTeamActOn(session({ status: "cancelled" })), false);
  assert.equal(console_.canTeamActOn(session({ kind: "replay", status: "live" })), false);
});

test("a sessao que o console abre: a pedida; senao a que roda; senao a proxima marcada; senao a ultima; nunca o replay sozinho", () => {
  const past = session({ id: "past", scheduledAt: new Date(T0 - 2 * 24 * HOUR).toISOString(), status: "ended" });
  const running = session({ id: "running", scheduledAt: new Date(T0 - 10 * MIN).toISOString(), status: "live" });
  const next = session({ id: "next", scheduledAt: new Date(T0 + 2 * HOUR).toISOString() });
  const later = session({ id: "later", scheduledAt: new Date(T0 + 24 * HOUR).toISOString() });
  const replay = session({ id: "replay", kind: "replay", status: "live" });
  const cancelled = session({ id: "cancelled", scheduledAt: new Date(T0 + HOUR).toISOString(), status: "cancelled" });

  assert.equal(console_.pickConsoleSession([past, running, next, later, replay], "later", T0)?.id, "later");
  assert.equal(console_.pickConsoleSession([past, running, next, later, replay], "nao-existe", T0)?.id, "running");
  assert.equal(console_.pickConsoleSession([past, later, next, replay, cancelled], null, T0)?.id, "next", "a mais perto, pulando a cancelada");
  assert.equal(console_.pickConsoleSession([past, replay], null, T0)?.id, "past");
  assert.equal(console_.pickConsoleSession([replay], null, T0)?.id, "replay", "so o replay: ele mesmo");
  assert.equal(console_.pickConsoleSession([], null, T0), null);
});

test("a fila do roteiro: na ordem do minuto, com o que entrou marcado, o que ja passou e os manuais pelo botao", () => {
  const item = (id, extra) => ({ body: "x", createdAt: "", generatedByAi: false, id, kind: "message", offsetMs: null, personaName: "Duda", personaRole: "student", phrase: null, phraseDelayMs: 0, position: 0, resolvedOffsetMs: null, resolvedTranscriptId: null, status: "ready", triggerKind: "at_offset", updatedAt: "", webinarId: "w1", ...extra });
  const items = [
    item("c", { offsetMs: 90_000, position: 2 }),
    item("a", { offsetMs: 10_000, position: 0 }),
    item("m", { position: 3, triggerKind: "manual" }),
    item("p", { position: 1, resolvedOffsetMs: 40_000, triggerKind: "on_phrase" }),
    item("d", { offsetMs: 5_000, position: 4, status: "disabled" })
  ];
  const queue = console_.scriptQueue(items, { a: "2026-11-05T23:00:10.000Z" }, 45_000);
  assert.deepEqual(queue.map((entry) => entry.id), ["d", "a", "p", "c", "m"]);
  assert.deepEqual(queue.map((entry) => [entry.fired, entry.passed]), [
    [false, true],
    [true, true],
    [false, true],
    [false, false],
    [false, false]
  ]);
  assert.equal(queue[1].firedAt, "2026-11-05T23:00:10.000Z");
  assert.equal(queue[4].dueOffsetMs, null, "o manual nao tem minuto");
  assert.deepEqual(console_.scriptQueueSummary(queue), { fired: 1, manual: 1, pending: 2 }, "a desligada nao conta");
  // O Map tambem serve; sem relogio (replay) nada "passou".
  assert.equal(console_.scriptQueue(items, new Map([["c", null]]), Number.NaN).find((entry) => entry.id === "c").fired, true);
  assert.equal(console_.scriptQueue(items, {}, Number.NaN).every((entry) => !entry.passed), true);
});

test("enquetes: respostas e por opcao (a multipla conta cada marcada), percentual; perguntas: abertas por voto, depois respondidas, dispensadas no fim", () => {
  const poll = { options: [{ id: "o1", label: "Sim", position: 0 }, { id: "o2", label: "Não", position: 1 }] };
  const counts = console_.countPollAnswers(poll, [{ optionIds: ["o1"] }, { optionIds: ["o1", "o2"] }, { optionIds: ["o2", "fora"] }]);
  assert.deepEqual(counts, { answers: 3, byOption: { o1: 2, o2: 2 } });
  assert.equal(console_.pollPercent(counts, "o1"), 67);
  assert.equal(console_.pollPercent({ answers: 0, byOption: {} }, "o1"), 0);

  const question = (id, status, upvotes, minute) => ({ createdAt: new Date(T0 + minute * MIN).toISOString(), id, status, upvotes });
  const board = console_.sortQuestionsForBoard([question("a", "answered", 9, 1), question("b", "open", 2, 3), question("c", "open", 5, 2), question("d", "dismissed", 7, 0), question("e", "open", 5, 1)]);
  assert.deepEqual(
    board.map((entry) => entry.id),
    ["e", "c", "b", "a", "d"]
  );
});

test("acoes de uma mensagem: liberar so a pendente, fixar so a liberada e nao fixada, promover so a da turma com aceite e ainda fora da linha mestre", () => {
  const message = (extra) => ({ approved: true, authorUserId: "u1", body: "oi", createdAt: "", displayName: "Ana M.", id: "m1", kind: "message", master: false, offsetMs: 0, pinnedAt: null, promotable: true, replyToId: null, role: "student", scriptItemId: null, sessionId: "s1", source: "audience", webinarId: "w1", ...extra });
  assert.deepEqual(console_.messageActions(message({}), null), { approve: false, delete: true, pin: true, promote: true, unpin: false });
  assert.deepEqual(console_.messageActions(message({ approved: false }), null), { approve: true, delete: true, pin: false, promote: false, unpin: false });
  assert.deepEqual(console_.messageActions(message({}), "m1"), { approve: false, delete: true, pin: false, promote: true, unpin: true });
  assert.equal(console_.messageActions(message({ promotable: false }), null).promote, false, "sem aceite nao promove");
  assert.equal(console_.messageActions(message({ master: true, source: "original" }), null).promote, false);
  assert.equal(console_.messageActions(message({ role: "team", source: "team" }), null).promote, false);
  assert.equal(console_.messageActions(message({ source: "scripted" }), null).promote, false);
});

test("quem pode escrever e o modo lento: as opcoes e a ida e volta das escolhas", () => {
  assert.deepEqual(console_.CHAT_MODE_OPTIONS.map((option) => option.value), ["open", "moderated", "team_only", "off"]);
  assert.deepEqual(console_.SLOW_MODE_CHOICES.map((option) => option.value), ["off", "10", "20", "30", "60"]);
  assert.equal(console_.slowModeFromChoice("off"), null);
  assert.equal(console_.slowModeFromChoice("30"), 30);
  assert.equal(console_.slowModeFromChoice("45"), null, "fora da lista vira desligado");
  assert.equal(console_.slowModeChoiceOf(60), "60");
  assert.equal(console_.slowModeChoiceOf(null), "off");
});

test("a frase da decisao (§8.6): hoje em Sao Paulo com o nome; confere com espacos e aspas normalizados; ontem vale; nome ou selo diferente nao", () => {
  const nowMs = Date.parse("2026-11-06T01:30:00.000Z"); // 22:30 de 05/11 em Sao Paulo
  const sentence = console_.consoleAckSentence({ badgeOn: true, nowMs, responsible: "Produtor de Teste" });
  assert.equal(sentence, room.simulationAckSentence({ badgeOn: true, date: "05/11/2026", numbersSimulated: false, responsible: "Produtor de Teste" }));
  assert.match(sentence, /^Decisão do produtor em 05\/11\/2026: /);
  assert.match(sentence, /fica ligado/);
  assert.match(sentence, /são reais/);
  assert.match(sentence, /Responsável: Produtor de Teste\.$/);

  assert.equal(console_.ackSentenceMatches({ ackText: sentence, badgeOn: true, nowMs, responsible: "Produtor de Teste" }), true);
  assert.equal(console_.ackSentenceMatches({ ackText: `  ${sentence.replace(/"/g, "“")}  `, badgeOn: true, nowMs, responsible: "Produtor de Teste" }), true, "aspas curvas e espacos");
  assert.equal(console_.ackSentenceMatches({ ackText: sentence, badgeOn: true, nowMs: nowMs + 24 * HOUR, responsible: "Produtor de Teste" }), true, "a frase de ontem vale na virada");
  assert.equal(console_.ackSentenceMatches({ ackText: sentence, badgeOn: true, nowMs: nowMs + 48 * HOUR, responsible: "Produtor de Teste" }), false, "anteontem nao");
  assert.equal(console_.ackSentenceMatches({ ackText: sentence, badgeOn: false, nowMs, responsible: "Produtor de Teste" }), false, "o selo da frase e outro");
  assert.equal(console_.ackSentenceMatches({ ackText: sentence, badgeOn: true, nowMs, responsible: "Outra Pessoa" }), false, "o nome e outro");
  assert.equal(console_.ackSentenceMatches({ ackText: "", badgeOn: true, nowMs, responsible: "Produtor de Teste" }), false);
  assert.equal(console_.ackSentenceMatches({ ackText: null, badgeOn: false, nowMs, responsible: "Produtor de Teste" }), false);
  assert.equal(console_.normalizeAckText(" a  “b”\n c "), 'a "b" c');
});

test("o relogio do console: o offset pelo skew e o rotulo por fase", () => {
  const simulated = session();
  assert.equal(console_.consoleOffsetMs(simulated, T0 + 1_000, 4_000), 5_000, "aparelho atrasado 4 s");
  assert.equal(console_.consoleClockLabel(-4 * MIN - 10_000, "waiting"), "Começa em 4:10");
  assert.equal(console_.consoleClockLabel(12 * MIN + 30_000, "live"), "No ar há 12:30");
  assert.equal(console_.consoleClockLabel(61 * MIN, "live"), "No ar há 1:01:00");
  assert.equal(console_.consoleClockLabel(60 * MIN, "ended"), "Durou 1:00:00");
  assert.equal(console_.consoleClockLabel(Number.NaN, "replay"), "");
  assert.equal(console_.consoleClockLabel(10, "cancelled"), "");
  assert.equal(console_.CONSOLE_POLL_MS, 5_000);
});
