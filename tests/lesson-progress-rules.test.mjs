import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Regras do progresso da aula (src/lib/lesson-progress.ts), executadas: a lista de concluidas e a
// verdade; aula concluida nao volta a "em andamento" por heartbeat; "Continue assistindo" ignora aula
// concluida; o clique em Concluir e otimista e reversivel; props novas ressincronizam a conclusao.

const rules = await import("../src/lib/lesson-progress.ts");

const NOW = "2026-10-16T12:00:00.000Z";
const inProgress = (progressSeconds, progressPercent, extra = {}) => ({
  durationSeconds: 300,
  lastWatchedAt: "2026-10-16T11:00:00.000Z",
  maxProgressPercent: progressPercent,
  progressPercent,
  progressSeconds,
  status: "in_progress",
  ...extra
});
const completedState = {
  durationSeconds: 300,
  lastWatchedAt: "2026-10-16T11:00:00.000Z",
  maxProgressPercent: 100,
  progressPercent: 100,
  progressSeconds: 300,
  status: "completed"
};

test("status gravado: aula na lista de concluidas continua concluida mesmo com batida 'in_progress'", () => {
  assert.equal(rules.resolveLessonWatchStatus({ isInCompletedList: true, requestedStatus: "in_progress" }), "completed");
  assert.equal(rules.resolveLessonWatchStatus({ isInCompletedList: true, requestedStatus: undefined }), "completed");
  assert.equal(rules.resolveLessonWatchStatus({ isInCompletedList: false, requestedStatus: "completed" }), "completed", "fim do video conclui");
  assert.equal(rules.resolveLessonWatchStatus({ isInCompletedList: false, requestedStatus: "in_progress" }), "in_progress", "desmarcada volta a em andamento");
  assert.equal(rules.resolveLessonWatchStatus({ isInCompletedList: false, requestedStatus: undefined }), "in_progress");
});

test("Continue assistindo: so aula comecada, nao terminada e fora da lista de concluidas", () => {
  const completed = new Set(["a1"]);

  assert.equal(rules.isLessonResumable("a1", inProgress(120, 40), completed), false, "na lista: nao lista, mesmo com 40% gravado");
  assert.equal(rules.isLessonResumable("a2", inProgress(120, 40), completed), true);
  assert.equal(rules.isLessonResumable("a2", completedState, completed), false, "status concluido");
  assert.equal(rules.isLessonResumable("a2", inProgress(0, 0), completed), false, "nao comecou");
  assert.equal(rules.isLessonResumable("a2", inProgress(300, 100, { status: "in_progress" }), completed), false, "100%");
});

test("batida de progresso em aula concluida mantem 100% e 'completed', so a posicao avanca", () => {
  const next = rules.buildWatchProgressState({
    existing: completedState,
    isInCompletedList: true,
    now: NOW,
    progressPercent: 40,
    progressSeconds: 120.4,
    status: "in_progress"
  });

  assert.deepEqual(next, {
    durationSeconds: 300,
    lastWatchedAt: NOW,
    maxProgressPercent: 100,
    progressPercent: 100,
    progressSeconds: 120,
    status: "completed"
  });
});

test("batida de progresso em aula nao concluida: no maximo 99%, maximo assistido nunca cai, fim do video da 100%", () => {
  const heartbeat = rules.buildWatchProgressState({
    durationSeconds: 300.6,
    existing: inProgress(200, 67),
    isInCompletedList: false,
    now: NOW,
    progressPercent: 40,
    progressSeconds: 120,
    status: "in_progress"
  });

  assert.equal(heartbeat.status, "in_progress");
  assert.equal(heartbeat.progressPercent, 40, "rebobinou: o percentual atual regride");
  assert.equal(heartbeat.maxProgressPercent, 67, "o maximo assistido fica");
  assert.equal(heartbeat.durationSeconds, 301);

  const almostDone = rules.buildWatchProgressState({
    existing: undefined,
    isInCompletedList: false,
    now: NOW,
    progressPercent: 100,
    progressSeconds: 299,
    status: "in_progress"
  });
  assert.equal(almostDone.progressPercent, 99, "em andamento nunca mostra 100%");

  const started = rules.buildWatchProgressState({
    existing: undefined,
    isInCompletedList: false,
    now: NOW,
    progressPercent: 0,
    progressSeconds: 1,
    status: "in_progress"
  });
  assert.equal(started.progressPercent, 1, "comecou: pelo menos 1% para entrar em Continue assistindo");

  const ended = rules.buildWatchProgressState({
    existing: inProgress(200, 67, { resumeFrameUrl: "https://cdn.example/frame.jpg" }),
    isInCompletedList: false,
    now: NOW,
    progressPercent: 100,
    progressSeconds: 300,
    status: "completed"
  });
  assert.equal(ended.status, "completed");
  assert.equal(ended.progressPercent, 100);
  assert.equal(ended.maxProgressPercent, 100);
  assert.equal(ended.resumeFrameUrl, "https://cdn.example/frame.jpg", "o frame de retomada gravado nao se perde");

  const invalid = rules.buildWatchProgressState({
    existing: undefined,
    isInCompletedList: false,
    now: NOW,
    progressPercent: Number.NaN,
    progressSeconds: Number.NaN,
    status: "in_progress"
  });
  assert.deepEqual([invalid.progressPercent, invalid.progressSeconds], [0, 0], "numero invalido do player vira zero");
});

test("clique em Concluir: lista com a aula, 100% no fim do video e so aulas do curso no payload", () => {
  const toggle = rules.buildCompletionToggle({
    allLessonIds: new Set(["a1", "a2"]),
    completedLessonIds: new Set(["a2", "fantasma"]),
    durationSeconds: 300,
    existing: inProgress(120, 40),
    lessonId: "a1",
    now: NOW
  });

  assert.equal(toggle.willComplete, true);
  assert.deepEqual([...toggle.completedLessonIds].sort(), ["a1", "a2", "fantasma"]);
  assert.deepEqual(toggle.payloadCompletedLessonIds, ["a1", "a2"], "ordenado e sem aula que nao e do curso");
  assert.deepEqual(toggle.watchState, {
    durationSeconds: 300,
    lastWatchedAt: NOW,
    maxProgressPercent: 100,
    progressPercent: 100,
    progressSeconds: 300,
    status: "completed"
  });
});

test("clique em Concluída (desmarcar): volta a em andamento na posicao real, nunca em 100%", () => {
  const toggle = rules.buildCompletionToggle({
    allLessonIds: new Set(["a1", "a2"]),
    completedLessonIds: new Set(["a1", "a2"]),
    existing: { ...completedState, progressSeconds: 90 },
    lessonId: "a1",
    now: NOW
  });

  assert.equal(toggle.willComplete, false);
  assert.deepEqual([...toggle.completedLessonIds], ["a2"]);
  assert.deepEqual(toggle.payloadCompletedLessonIds, ["a2"]);
  assert.equal(toggle.watchState.status, "in_progress");
  assert.equal(toggle.watchState.progressPercent, 30, "90 s de 300 s: o percentual vem da posicao, nao dos 100% gravados");
  assert.equal(toggle.watchState.progressSeconds, 90);
  assert.equal(toggle.watchState.maxProgressPercent, 100, "o maximo assistido continua liberando a avaliacao");

  const atTheEnd = rules.buildCompletionToggle({
    allLessonIds: new Set(["a1"]),
    completedLessonIds: new Set(["a1"]),
    existing: completedState,
    lessonId: "a1",
    now: NOW
  });
  assert.equal(atTheEnd.watchState.progressPercent, 99, "no fim do video, em andamento fica em 99%");

  const noDuration = rules.buildCompletionToggle({
    allLessonIds: new Set(["a1"]),
    completedLessonIds: new Set(["a1"]),
    existing: undefined,
    lessonId: "a1",
    now: NOW
  });
  assert.deepEqual([noDuration.watchState.progressPercent, noDuration.watchState.progressSeconds], [0, 0]);
});

test("gravacao falhou: reverter devolve exatamente o que a tela mostrava antes do clique", () => {
  const completedBefore = new Set(["a2"]);
  const statesBefore = { a1: inProgress(120, 40), a2: completedState };
  const toggle = rules.buildCompletionToggle({
    allLessonIds: new Set(["a1", "a2"]),
    completedLessonIds: completedBefore,
    durationSeconds: 300,
    existing: statesBefore.a1,
    lessonId: "a1",
    now: NOW
  });
  const snapshot = { wasCompleted: completedBefore.has("a1"), watchState: statesBefore.a1 };

  // Otimista: verde na hora.
  const optimisticStates = rules.withLessonWatchState(statesBefore, "a1", toggle.watchState);
  assert.equal(toggle.completedLessonIds.has("a1"), true);
  assert.equal(optimisticStates.a1.status, "completed");

  // PUT falhou: volta.
  const revertedIds = rules.withLessonCompletion(toggle.completedLessonIds, "a1", snapshot.wasCompleted);
  const revertedStates = rules.withLessonWatchState(optimisticStates, "a1", snapshot.watchState);
  assert.deepEqual([...revertedIds], [...completedBefore]);
  assert.deepEqual(revertedStates, statesBefore);

  // Aula que nao tinha estado nenhum antes: reverter remove a chave.
  const fromNothing = rules.withLessonWatchState({ a1: toggle.watchState }, "a1", undefined);
  assert.deepEqual(fromNothing, {});

  // Sem mudanca, a mesma referencia (nao re-renderiza a toa).
  assert.equal(rules.withLessonCompletion(completedBefore, "a2", true), completedBefore);
  assert.equal(rules.withLessonWatchState(statesBefore, "a1", statesBefore.a1), statesBefore);
});

test("props novas: a conclusao local passa a ser a do servidor, menos aulas com gravacao em andamento", () => {
  const modules = [
    { lessons: [{ completed: true, id: "a1" }, { completed: false, id: "a2" }] },
    { lessons: [{ id: "b1" }, { completed: true, id: "b2" }] }
  ];
  assert.deepEqual(rules.getCompletedLessonIdsFromModules(modules), ["a1", "b2"]);

  const local = new Set(["a1", "b2"]);
  assert.equal(rules.reconcileCompletedLessonIds(local, ["b2", "a1"]), local, "igual: mesma referencia");

  const afterRefresh = rules.reconcileCompletedLessonIds(local, ["a1", "a2"]);
  assert.deepEqual([...afterRefresh].sort(), ["a1", "a2"], "servidor concluiu a2 e desmarcou b2");

  // a2 acabou de ser clicada (PUT em andamento) e o servidor ainda nao sabe; b2 foi desmarcada e o PUT
  // tambem esta em andamento: as duas ficam como a tela mostra ate o PUT responder.
  const pending = rules.reconcileCompletedLessonIds(new Set(["a1", "a2"]), ["a1", "b2"], ["a2", "b2"]);
  assert.deepEqual([...pending].sort(), ["a1", "a2"]);
});
