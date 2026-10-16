import assert from "node:assert/strict";
import test from "node:test";

// Clique num tempo citado pelo Tutor IA: o salto fica guardado ate o player da aula certa estar pronto
// e e consumido uma unica vez (puro, sem React).

const { consumePendingTutorSeek, queuePendingTutorSeek } = await import("../src/lib/tutor-seek-intent.ts");

test("o salto espera o player da aula certa, vale o ultimo pedido e e consumido uma vez so", () => {
  const store = { current: null };
  const applied = [];

  assert.equal(queuePendingTutorSeek(store, "lesson-a", Number.NaN), null, "tempo invalido nao entra");
  queuePendingTutorSeek(store, "lesson-a", 12);
  queuePendingTutorSeek(store, "lesson-a", 42);
  assert.equal(consumePendingTutorSeek(store, "lesson-b", (seconds) => applied.push(seconds)), null, "outra aula nao consome");
  assert.deepEqual(store.current, { lessonId: "lesson-a", seconds: 42 }, "fica o ultimo pedido");
  assert.equal(consumePendingTutorSeek(store, "lesson-a", (seconds) => applied.push(seconds)), 42);
  assert.deepEqual(applied, [42]);
  assert.equal(store.current, null);
  assert.equal(consumePendingTutorSeek(store, "lesson-a", (seconds) => applied.push(seconds)), null, "ja consumido");
});

test("tempo negativo vira zero e, se o player falhar, o salto continua guardado", () => {
  const store = { current: null };

  queuePendingTutorSeek(store, "lesson-a", -5);
  assert.throws(() => consumePendingTutorSeek(store, "lesson-a", () => {
    throw new Error("player not ready");
  }));
  assert.deepEqual(store.current, { lessonId: "lesson-a", seconds: 0 });
});
