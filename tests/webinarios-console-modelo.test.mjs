import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// O console da sessao e os cards da fase 2b, a parte pura (docs/30 §2.4, §6.6 D6-c, §8.6): a fase que a equipe ve
// pelo relogio, o que abre e encerra, a sessao que o console escolhe sozinho, a fila do roteiro com o que ja entrou,
// as contagens das enquetes, a ordem do quadro de perguntas, as acoes de cada mensagem e a frase da decisao do selo
// (a mesma no navegador e no servidor, com a data de ontem valendo na virada da meia-noite).

const console_ = await import("../src/server/webinars/console-model.ts");
const room = await import("../src/server/webinars/room-model.ts");
const { WEBINAR_ADMIN_COPY } = await import("../src/server/webinars/editor-model.ts");

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
  // Cada fase tem o nome do editor (WEBINAR_ADMIN_COPY.console.phases), que o card de sessoes e o JIT mostram.
  for (const phase of console_.CONSOLE_PHASES) {
    assert.ok(WEBINAR_ADMIN_COPY.console.phases[phase].length > 0, phase);
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

test("o fio no quadro (docs/30 §2.4): questionAwaitsTeam so na respondida em que o aluno escreveu por ultimo; ela sobe para junto das abertas", () => {
  const aluno = { role: "student" };
  const equipe = { role: "team" };
  assert.equal(console_.questionAwaitsTeam({ replies: [aluno], status: "answered" }), true);
  assert.equal(console_.questionAwaitsTeam({ replies: [aluno, equipe], status: "answered" }), false, "a equipe respondeu por ultimo");
  assert.equal(console_.questionAwaitsTeam({ replies: [], status: "answered" }), false);
  assert.equal(console_.questionAwaitsTeam({ status: "answered" }), false, "sem o fio (uma pergunta de antes)");
  assert.equal(console_.questionAwaitsTeam({ replies: [aluno], status: "open" }), false, "a aberta ja pede a equipe pelo proprio estado");
  assert.equal(console_.questionAwaitsTeam({ replies: [aluno], status: "dismissed" }), false);
  // A resposta de cima depois da ultima fala do aluno (o "Falar com a equipe" respondido pelo campo de cima, ou Reabrir
  // e responder de novo) tambem e a equipe respondendo.
  const em = (minute) => new Date(T0 + minute * MIN).toISOString();
  const alunoAs = (minute) => ({ createdAt: em(minute), role: "student" });
  assert.equal(console_.questionAwaitsTeam({ answeredAt: em(1), replies: [alunoAs(2)], status: "answered" }), true, "o aluno escreveu depois da resposta");
  assert.equal(console_.questionAwaitsTeam({ answeredAt: em(5), replies: [alunoAs(2)], status: "answered" }), false, "a equipe respondeu pelo campo de cima depois da ultima fala do aluno");
  assert.equal(console_.questionAwaitsTeam({ answeredAt: null, replies: [alunoAs(2)], status: "answered" }), true, "sem a hora da resposta, continua esperando");
  // A hora do app (milissegundos) contra a do banco (microssegundos, +00:00): compara o instante, nunca o texto.
  assert.equal(console_.questionAwaitsTeam({ answeredAt: "2026-11-05T23:05:00.000Z", replies: [{ createdAt: "2026-11-05T23:04:59.999123+00:00", role: "student" }], status: "answered" }), false);

  const question = (id, status, upvotes, minute, replies = []) => ({ createdAt: new Date(T0 + minute * MIN).toISOString(), id, replies, status, upvotes });
  const board = console_.sortQuestionsForBoard([
    question("respondida", "answered", 9, 1),
    question("esperando", "answered", 1, 5, [aluno]),
    question("aberta", "open", 4, 2),
    question("conversada", "answered", 8, 3, [aluno, equipe]),
    { ...question("de-cima", "answered", 3, 4, [alunoAs(2)]), answeredAt: em(5) },
    question("dispensada", "dismissed", 7, 0)
  ]);
  assert.deepEqual(
    board.map((entry) => entry.id),
    ["aberta", "esperando", "respondida", "conversada", "de-cima", "dispensada"],
    "o que pede a equipe primeiro (por votos), depois as respondidas e as dispensadas"
  );
});

test("o fio no console: o campo de outra pergunta nao fecha quando o envio da anterior termina, e a resposta enviada nao arma de novo antes do retrato (replyDraftAfterSent e whileSettling)", async () => {
  assert.equal(console_.replyDraftAfterSent({ draft: "oi", id: "q1" }, "q1"), null);
  const outra = { draft: "rascunho da q2", id: "q2" };
  assert.equal(console_.replyDraftAfterSent(outra, "q1"), outra, "o campo da q2, aberto no meio do envio da q1, fica");
  assert.equal(console_.replyDraftAfterSent(null, "q1"), null);

  let settling = [];
  const set = (update) => {
    settling = update(settling);
  };
  let calls = 0;
  let release;
  const work = () => {
    calls += 1;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const primeira = console_.whileSettling({ key: "reply:q1", set, settling, work });
  assert.deepEqual(settling, ["reply:q1"], "ocupado do clique ate o retrato");
  assert.equal(await console_.whileSettling({ key: "reply:q1", set, settling, work }), false, "o segundo clique no meio nao manda de novo");
  assert.equal(calls, 1);
  release(true);
  assert.equal(await primeira, true);
  assert.deepEqual(settling, []);
  assert.equal(await console_.whileSettling({ key: "delete:r1", set, settling, work: async () => false }), false);
  assert.deepEqual(settling, [], "a falha tambem solta a chave");
});

test("acoes de uma mensagem: liberar so a pendente, fixar so a liberada e nao fixada, promover so a da turma com aceite e ainda fora da linha mestre", () => {
  const message = (extra) => ({ approved: true, authorUserId: "u1", body: "oi", createdAt: "", displayName: "Ana M.", id: "m1", kind: "message", master: false, offsetMs: 0, pinnedAt: null, promotable: true, replyToId: null, role: "student", scriptItemId: null, sessionId: "s1", source: "audience", webinarId: "w1", ...extra });
  assert.deepEqual(console_.messageActions(message({}), null), { approve: false, delete: true, pin: true, promote: true, question: true, unpin: false });
  assert.deepEqual(console_.messageActions(message({ approved: false }), null), { approve: true, delete: true, pin: false, promote: false, question: true, unpin: false });
  assert.deepEqual(console_.messageActions(message({}), "m1"), { approve: false, delete: true, pin: false, promote: true, question: true, unpin: true });
  assert.equal(console_.messageActions(message({ promotable: false }), null).promote, false, "sem aceite nao promove");
  assert.equal(console_.messageActions(message({ master: true, source: "original" }), null).promote, false);
  assert.equal(console_.messageActions(message({ role: "team", source: "team" }), null).promote, false);
  assert.equal(console_.messageActions(message({ source: "scripted" }), null).promote, false);
});

test("Virar pergunta (docs/31 V2-15): so a mensagem comum de um aluno da turma, com autor e ainda sem pergunta; a pergunta pelo chat moderado, a equipe, o roteiro e o Assistente, nunca", () => {
  const message = (extra) => ({ approved: true, authorUserId: "u1", body: "oi", createdAt: "", displayName: "Ana M.", id: "m1", kind: "message", master: false, offsetMs: 0, pinnedAt: null, promotable: true, replyToId: null, role: "student", scriptItemId: null, sessionId: "s1", source: "audience", webinarId: "w1", ...extra });
  const question = (extra, options) => console_.messageActions(message(extra), null, options).question;
  assert.equal(question({}), true);
  assert.equal(question({ approved: false }), true, "a pendente tambem (o Virar pergunta libera junto)");
  assert.equal(question({}, { hasQuestion: false }), true);
  assert.equal(question({}, { hasQuestion: true }), false, "a que ja virou pergunta");
  assert.equal(question({ kind: "question" }), false, "a pergunta pelo chat moderado: o Liberar ja a abre");
  assert.equal(question({ approved: false, kind: "question" }), false);
  assert.equal(question({ kind: "answer" }), false);
  assert.equal(question({ authorUserId: null }), false, "sem autor nao ha pergunta (ela pede o aluno)");
  assert.equal(question({ role: "team", source: "team" }), false, "a equipe");
  assert.equal(question({ authorUserId: null, scriptItemId: "i1", source: "scripted" }), false, "o roteiro");
  assert.equal(question({ authorUserId: null, kind: "answer", role: "ai", source: "ai" }), false, "o Assistente");
  assert.equal(question({ master: true, source: "original" }), false, "a linha mestre de outra turma");

  // O console confere na tabela das perguntas so as que podem virar pergunta (o askedMessageIds do retrato), sem repetir.
  assert.equal(console_.turnsIntoQuestion(message({})), true);
  assert.equal(console_.turnsIntoQuestion(message({ kind: "question" })), false);
  assert.deepEqual(
    console_.askableMessageIds([
      message({ id: "m-aluno" }),
      message({ id: "m-pergunta", kind: "question" }),
      message({ id: "m-equipe", role: "team", source: "team" }),
      message({ authorUserId: null, id: "m-roteiro", source: "scripted" }),
      message({ id: "m-sem-autor", authorUserId: null }),
      message({ approved: false, id: "m-pendente" }),
      message({ id: "m-aluno" })
    ]),
    ["m-aluno", "m-pendente"]
  );
  assert.deepEqual(console_.askableMessageIds([]), []);
});

test("o foco depois de uma acao do chat do console (WCAG 2.4.3): o item que ficou, o botao da mesma posicao; o que saiu, o item que tomou o lugar dele; a parte vazia, o cabecalho ou a caixa", () => {
  const now = { log: ["l1", "l2", "l3"], pending: ["p1", "p3"] };
  // A acao falhou ou o item ficou (Fixar vira Desafixar; o Virar pergunta saiu e o Apagar tomou a posicao dele).
  assert.deepEqual(console_.consoleChatFocusAfter({ area: "log", id: "l2", index: 1, position: 1 }, now), { area: "log", id: "l2", position: 1 });
  assert.deepEqual(console_.consoleChatFocusAfter({ area: "queue", id: "p1", index: 0, position: 2 }, now), { area: "queue", id: "p1", position: 2 });
  // O Liberar ou o Recusar tirou o card do meio: o seguinte, que ficou no lugar dele, no primeiro botao (o Liberar).
  assert.deepEqual(console_.consoleChatFocusAfter({ area: "queue", id: "p2", index: 1, position: 0 }, now), { area: "queue", id: "p3", position: 0 });
  // O ultimo saiu: o anterior. O liberado vai para a lista, mas o foco continua na fila (moderar em sequencia).
  assert.deepEqual(console_.consoleChatFocusAfter({ area: "queue", id: "p4", index: 2, position: 1 }, now), { area: "queue", id: "p3", position: 0 });
  assert.deepEqual(console_.consoleChatFocusAfter({ area: "queue", id: "l1", index: 0, position: 0 }, { log: ["l1"], pending: ["p1"] }), { area: "queue", id: "p1", position: 0 });
  // O Apagar tirou o balao: o seguinte da lista.
  assert.deepEqual(console_.consoleChatFocusAfter({ area: "log", id: "l0", index: 0, position: 2 }, now), { area: "log", id: "l1", position: 0 });
  // A fila esvaziou: o cabecalho; a lista esvaziou: a caixa da equipe.
  assert.deepEqual(console_.consoleChatFocusAfter({ area: "queue", id: "p1", index: 0, position: 0 }, { log: ["l1", "p1"], pending: [] }), { area: "header" });
  assert.deepEqual(console_.consoleChatFocusAfter({ area: "log", id: "l1", index: 0, position: 0 }, { log: [], pending: ["p1"] }), { area: "composer" });
  // Sem a posicao do item (nao achado na hora do clique), o primeiro.
  assert.deepEqual(console_.consoleChatFocusAfter({ area: "log", id: "lx", index: -1, position: 0 }, now), { area: "log", id: "l1", position: 0 });
});

test("o chat do console em duas partes: as pendentes saem da lista, da mais velha para a mais nova (sem hora, depois, na ordem); a lista so com as liberadas, na ordem do retrato", () => {
  const at = (minute) => new Date(T0 + minute * MIN).toISOString();
  const messages = [
    { approved: true, createdAt: at(1), id: "a" },
    { approved: false, createdAt: at(5), id: "p-nova" },
    { approved: false, createdAt: "", id: "p-sem-hora" },
    { approved: true, createdAt: at(0), id: "b" },
    { approved: false, createdAt: at(2), id: "p-velha" },
    { approved: false, createdAt: at(2), id: "p-mesma-hora" },
    { approved: false, createdAt: "", id: "p-sem-hora-2" }
  ];
  const { log, pending } = console_.consoleChatQueue(messages);
  assert.deepEqual(log.map((message) => message.id), ["a", "b"], "a ordem do retrato, sem as pendentes");
  assert.deepEqual(pending.map((message) => message.id), ["p-velha", "p-mesma-hora", "p-nova", "p-sem-hora", "p-sem-hora-2"]);
  assert.deepEqual(console_.consoleChatQueue([]), { log: [], pending: [] });
});

test("a linha de baixo do balao no console (docs/31 V2-9): a hora da live pela hora gravada, a da gravada pela hora marcada mais o offset, nenhuma no Replay; o papel ou a origem, que so a equipe ve", () => {
  // T0 e 20:00 em Sao Paulo; a mensagem foi gravada as 20:42 e esta no minuto 1 do video.
  const message = (extra) => ({ createdAt: new Date(T0 + 42 * MIN).toISOString(), offsetMs: MIN, role: "student", source: "audience", ...extra });
  const meta = (kind, extra) => console_.consoleMessageMeta({ kind, message: message(extra), scheduledAt: new Date(T0).toISOString() });
  assert.deepEqual(meta("live", {}), { origin: null, role: null, time: "20:42" }, "na live, a hora gravada (o offset nao serve)");
  assert.deepEqual(meta("simulated", {}), { origin: null, role: null, time: "20:01" }, "na gravada, a hora marcada mais o offset");
  assert.deepEqual(meta("replay", {}), { origin: null, role: null, time: "" }, "no Replay, nenhuma hora");
  assert.equal(console_.consoleMessageMeta({ kind: "simulated", message: message({}), scheduledAt: "" }).time, "", "sem a hora marcada, nenhuma");
  assert.equal(meta("live", { createdAt: "" }).time, "");

  assert.equal(meta("live", { role: "host", source: "team" }).role, "Apresentador");
  assert.equal(meta("live", { role: "co_host", source: "team" }).role, "Co-apresentador", "o papel proprio do co-apresentador (V2-A12), o mesmo da sala");
  assert.equal(meta("live", { role: "team", source: "team" }).role, "Equipe");
  assert.equal(meta("live", { role: "ai", source: "ai" }).role, "Assistente");
  assert.equal(meta("live", { role: "guest" }).role, null, "o convidado sem papel, como na sala");
  // A origem: o roteiro e o chat original de outra turma; a turma de hoje e a equipe, nenhuma.
  assert.deepEqual(meta("simulated", { source: "scripted" }), { origin: "Roteiro", role: null, time: "20:01" });
  // "Papel ou origem": com a origem, o papel fica de fora (a persona do roteiro com o papel de quem apresenta diz Roteiro).
  assert.deepEqual(meta("simulated", { role: "team", source: "scripted" }), { origin: "Roteiro", role: null, time: "20:01" });
  assert.deepEqual(meta("simulated", { role: "host", source: "scripted" }), { origin: "Roteiro", role: null, time: "20:01" });
  assert.equal(meta("simulated", { source: "original" }).origin, "Chat original");
  assert.equal(meta("simulated", { role: "team", source: "team" }).origin, null);
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

// O topo como a tela monta: o relogio do aparelho mais o skew, o tempo da sessao e a fase.
function topLabel(target, deviceNowMs, skewMs = 0) {
  const nowMs = deviceNowMs + skewMs;
  return console_.consoleClockLabel(console_.consoleClockMs(target, DURATION, nowMs), console_.consolePhaseOf(target, DURATION, nowMs));
}

test("o topo da live ao vivo conta desde o Iniciar live e para no Encerrar live (5 s ou 3 h depois, Durou e o mesmo)", () => {
  const started = { kind: "live", startedAt: new Date(T0).toISOString(), status: "live" };
  assert.equal(topLabel(session(started), T0 + 5 * MIN - 4_000, 4_000), "No ar há 5:00", "no ar, com o aparelho atrasado 4 s");

  const ended = session({ ...started, endedAt: new Date(T0 + 42 * MIN).toISOString(), status: "ended" });
  assert.equal(topLabel(ended, T0 + 42 * MIN + 1_000, 4_000), "Durou 42:00", "5 s depois do Encerrar live");
  assert.equal(topLabel(ended, T0 + 42 * MIN + 3 * HOUR - 4_000, 4_000), "Durou 42:00", "3 h depois, com o console ainda aberto");

  const anchored = session({ ...started, recordingAnchorAt: new Date(T0 + 15 * MIN).toISOString() });
  assert.equal(topLabel(anchored, T0 + 20 * MIN), "No ar há 20:00", "a ancora da gravacao nao move o topo: conta desde o startedAt, como a sala do aluno e o relatorio");
  assert.equal(console_.consoleOffsetMs(anchored, T0 + 20 * MIN, 0), 5 * MIN, "o roteiro segue no relogio da ancora");
  assert.equal(topLabel({ ...anchored, endedAt: new Date(T0 + 42 * MIN).toISOString(), status: "ended" }, T0 + 2 * HOUR), "Durou 42:00");
});

test("o topo da live ao vivo antes de comecar: Começa em ate a hora; na espera depois da hora e encerrada direto da espera, vazio", () => {
  const scheduled = session({ kind: "live", status: "scheduled" });
  assert.equal(topLabel(scheduled, T0 - 10 * MIN), "Começa em 10:00");
  assert.equal(topLabel({ ...scheduled, status: "waiting" }, T0 + 3 * MIN), "", "na espera depois da hora, sem startedAt: nada a contar");

  const endedFromWaiting = session({ endedAt: new Date(T0 + 10 * MIN).toISOString(), kind: "live", status: "ended" });
  assert.ok(Number.isNaN(console_.consoleClockMs(endedFromWaiting, DURATION, T0 + 11 * MIN)));
  assert.equal(topLabel(endedFromWaiting, T0 + 11 * MIN), "", "nunca foi ao ar: sem Durou");
  assert.equal(topLabel(endedFromWaiting, T0 + 3 * HOUR), "");
  assert.equal(topLabel(session({ endedAt: new Date(T0 - 5 * MIN).toISOString(), kind: "live", status: "ended" }), T0 - MIN), "", "encerrada antes da hora: nem Começa em");
});

test("o topo da Live gravada: anda no ar, para no Encerrar e nunca passa da duracao do video (o tick que fecha horas depois)", () => {
  const live = session({ startedAt: new Date(T0).toISOString(), status: "live" });
  assert.equal(topLabel(live, T0 + 5 * MIN), "No ar há 5:00");
  assert.equal(topLabel(live, T0 + 6 * MIN), "No ar há 6:00", "aberta, anda");
  assert.equal(topLabel(session(), T0 - 4 * MIN - 10_000), "Começa em 4:10");

  const byButton = { ...live, endedAt: new Date(T0 + 20 * MIN).toISOString(), status: "ended" };
  assert.equal(topLabel(byButton, T0 + 20 * MIN + 5_000), "Durou 20:00", "encerrada pelo botao antes do fim do video");
  assert.equal(topLabel(byButton, T0 + 3 * HOUR), "Durou 20:00");

  const lateTick = { ...live, endedAt: new Date(T0 + 4 * HOUR).toISOString(), status: "ended" };
  assert.equal(topLabel(lateTick, T0 + 5 * HOUR), "Durou 1:00:00", "ended_at gravado horas depois do fim: limitado a duracao");
  assert.equal(topLabel(live, T0 + 2 * HOUR), "Durou 1:00:00", "o tick ainda nao fechou: a fase ja e encerrada e o topo nao passa da duracao");

  assert.equal(topLabel(session({ endedAt: new Date(T0 - 5 * MIN).toISOString(), status: "ended" }), T0 + HOUR), "", "encerrada antes da hora: nunca foi ao ar");
  assert.ok(Number.isNaN(console_.consoleClockMs(session({ kind: "replay", status: "live" }), DURATION, T0 + MIN)), "o replay nao tem relogio");
});

test("o offset do roteiro corta no encerramento: depois do Encerrar, a fila fica no minuto em que a sessao acabou", () => {
  const live = session({ startedAt: new Date(T0).toISOString(), status: "live" });
  assert.equal(console_.consoleOffsetMs(live, T0 + 30 * MIN, 0), 30 * MIN, "aberta, anda");
  const ended = { ...live, endedAt: new Date(T0 + 20 * MIN).toISOString(), status: "ended" };
  assert.equal(console_.consoleOffsetMs(ended, T0 + 3 * HOUR, 4_000), 20 * MIN);
  const anchored = session({ endedAt: new Date(T0 + 42 * MIN).toISOString(), kind: "live", recordingAnchorAt: new Date(T0 + 15 * MIN).toISOString(), startedAt: new Date(T0).toISOString(), status: "ended" });
  assert.equal(console_.consoleOffsetMs(anchored, T0 + 3 * HOUR, 0), 27 * MIN, "na live, pela ancora ate o Encerrar live");
  const late = { body: "x", createdAt: "", generatedByAi: false, id: "late", kind: "message", offsetMs: 25 * MIN, personaName: "Duda", personaRole: "student", phrase: null, phraseDelayMs: 0, position: 0, resolvedOffsetMs: null, resolvedTranscriptId: null, status: "ready", triggerKind: "at_offset", updatedAt: "", webinarId: "w1" };
  const queue = console_.scriptQueue([late], {}, console_.consoleOffsetMs(ended, T0 + 3 * HOUR, 0));
  assert.equal(queue[0].passed, false, "o item depois do fim nao conta como passado");
});

test("consoleComment (docs/31 §10): o comentario do YouTube do console com o nome (Você na minha), o selo do papel ou da origem, a hora do relogio com o instante e o que o leitor de tela ouve; o Assistente so com o selo; no Replay sem hora", () => {
  const live = { kind: "live", scheduledAt: "2026-11-05T23:00:00.000Z" };
  const message = (extra = {}) => ({ createdAt: "2026-11-05T23:42:00.000Z", displayName: "Ana M.", offsetMs: 0, role: "student", source: "audience", ...extra });

  const aluna = console_.consoleComment({ ...live, message: message(), mine: false });
  assert.deepEqual(aluna, { avatar: "person", name: "Ana M.", role: null, srAuthor: "Ana M., 20:42: ", time: { iso: "2026-11-05T23:42:00.000Z", label: "20:42", title: "20:42" } });

  const minha = console_.consoleComment({ ...live, message: message({ displayName: "Produtor T.", role: "host", source: "team" }), mine: true });
  assert.equal(minha.name, "Você");
  assert.equal(minha.role, "Apresentador");
  assert.equal(minha.srAuthor, "Você, Apresentador, 20:42: ");

  // O Assistente: o nome igual ao selo, so o selo (como na sala) e o avatar dele.
  const ia = console_.consoleComment({ ...live, message: message({ displayName: "Assistente", role: "ai", source: "ai" }), mine: false });
  assert.equal(ia.avatar, "assistant");
  assert.equal(ia.srAuthor, "Assistente, 20:42: ");

  // A origem que so a equipe ve fica no lugar do papel (a persona do roteiro com o papel de quem apresenta diz Roteiro).
  const gravada = { kind: "simulated", scheduledAt: "2026-11-05T23:00:00.000Z" };
  const roteiro = console_.consoleComment({ ...gravada, message: message({ displayName: "Duda", offsetMs: 60_000, role: "host", source: "scripted" }), mine: false });
  assert.equal(roteiro.role, WEBINAR_ADMIN_COPY.console.chat.sources.scripted);
  assert.deepEqual(roteiro.time, { iso: "2026-11-05T23:01:00.000Z", label: "20:01", title: "20:01" }, "a gravada: a hora marcada mais o offset");

  // No Replay, nenhuma hora (o payload nao traz o inicio da live original).
  const replay = console_.consoleComment({ kind: "replay", message: message(), mine: false, scheduledAt: "2026-11-05T23:00:00.000Z" });
  assert.equal(replay.time, null);
  assert.equal(replay.srAuthor, "Ana M.: ");
});
