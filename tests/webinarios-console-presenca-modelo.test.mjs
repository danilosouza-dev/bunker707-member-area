import assert from "node:assert/strict";
import test from "node:test";

// O painel Presenca do console (docs/30 §2.4) pela visao do relatorio: a curva por minuto (o maior dos dois baldes de
// 30 s) so dos ultimos 30 minutos, o pico, as mensagens do ultimo minuto inteiro e a media da janela; o Replay e o
// antes de comecar ficam sem o painel. Modulo puro pelo Node.

const model = await import("../src/server/webinars/console-presence-model.ts");
const MIN = 60_000;

const vista = (curve, perMinute = [], peak = null) => ({
  chat: { hot: [], perMinute: perMinute.map(([minute, total]) => ({ minute, students: total, total })), students: 0, top: [], total: 0 },
  presence: { avgPresent: 0, curve: curve.map(([b, n]) => ({ b, n })), drops: [], peak, reachedEnd: 0, unique: 0, watchAvgSeconds: 0, watchMaxSeconds: 0 }
});

test("a curva: um ponto por minuto (o maior dos dois baldes), so os ultimos 30 minutos, minutos sem ninguem valem 0; a espera (balde negativo) fica fora", () => {
  const curve = Array.from({ length: 100 }, (_, b) => [b, b % 2 === 0 ? 10 : 12]);
  const presence = model.consolePresenceOf(vista([[-1, 50], ...curve]), 45 * MIN + 10_000);
  assert.equal(presence.minute, 45);
  assert.equal(presence.curve.length, model.CONSOLE_PRESENCE_MINUTES);
  assert.deepEqual(presence.curve[0], { minute: 16, present: 12 });
  assert.deepEqual(presence.curve.at(-1), { minute: 45, present: 12 });

  const buraco = model.consolePresenceOf(vista([[0, 3], [4, 5]]), 2 * MIN + 1);
  assert.deepEqual(buraco.curve, [{ minute: 0, present: 3 }, { minute: 1, present: 0 }, { minute: 2, present: 5 }]);
  assert.deepEqual(model.consolePresenceOf(vista([[-2, 9]]), 0).curve, [{ minute: 0, present: 0 }], "a espera nao entra no minuto 0");
});

test("o pico e as mensagens: o ultimo minuto inteiro (no primeiro minuto, o atual) e a media por minuto da janela", () => {
  const presence = model.consolePresenceOf(vista([[0, 1]], [[0, 3], [1, 5], [2, 1]], { b: 3, n: 14 }), 2 * MIN + 5_000);
  assert.deepEqual(presence.peak, { minute: 1, present: 14 });
  assert.equal(presence.messagesLastMinute, 5, "o minuto 1, o ultimo inteiro");
  assert.equal(presence.messagesPerMinuteAvg, 3, "9 mensagens em 3 minutos");

  const primeiro = model.consolePresenceOf(vista([], [[0, 2]], { b: 0, n: 0 }), 20_000);
  assert.equal(primeiro.messagesLastMinute, 2);
  assert.equal(primeiro.peak, null, "pico zero: ninguem");
});

test("quando o painel vale: Live ao vivo e sessao gravada ja comecadas; nunca o Replay nem antes de comecar", () => {
  assert.equal(model.consolePresenceApplies("live", 0), true);
  assert.equal(model.consolePresenceApplies("simulated", 5 * MIN), true);
  assert.equal(model.consolePresenceApplies("replay", 5 * MIN), false);
  assert.equal(model.consolePresenceApplies("simulated", -1), false);
  assert.equal(model.consolePresenceApplies("live", Number.NaN), false);
  assert.equal(model.consolePresenceMinuteLabel(7), "07:00");
  assert.equal(model.consolePresenceMinuteLabel(75), "1:15:00");
});
