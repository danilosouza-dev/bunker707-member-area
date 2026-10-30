import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";

// A Simulacao completa, a parte pura (docs/30 §1.6, §3.5, §4.3, §6.6, §8.6; D6, D10, M6; docs/18 §2.1): o contador
// (off / fixed / curve com a variacao sorteada pela semente a cada 15 s, nunca negativo), as entradas e saidas com os
// nomes genericos (nunca de aluno), os avisos de venda da janela, a janela do aluno (so a sessao gravada; replay e live
// devolvem enabled false; nunca a semente nem as regras), o resumo do fim igual ao que as janelas mostraram (teste de
// propriedade com a mesma sequencia de janelas da sala), a frase de §8.6 (hoje e ontem, nome e numeros conferidos) e
// as contas da sala (fusao, numero do instante, entrada de 8 s, aviso de 4 s, leitor de tela no maximo um por
// minuto). E a guarda D6/M6: os paineis, o relatorio, as exportacoes e a Comunicacao nunca importam simulation-model.

const model = await import("../src/server/webinars/simulation-model.ts");
const { SIMULATION_LIMITS } = await import("../src/server/webinars/model.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const { simulationNeedsAck } = await import("../src/server/webinars/simulation-schemas.ts");

const MIN = 60_000;
const STEP = SIMULATION_LIMITS.counterStepSeconds * 1000;
const WINDOW = SIMULATION_LIMITS.feedWindowSeconds * 1000;
const HOUR = 60 * MIN;
const NAMES = new Set(WEBINAR_COPY.simulacao.nomesGenericos);

const off = { base: 0, jitter: 0, mode: "off", peak: 0 };
const semEntradas = { enabled: false, everySeconds: 60, max: 30, names: "generic" };
const semAvisos = { enabled: false, items: [] };
const simulacao = (extra = {}) => ({ countRule: off, joins: semEntradas, saleNotices: semAvisos, seed: 12345, sessionId: "s", summary: null, ...extra });

/** Um gerador com semente so do teste (os sorteios das regras e das sementes do teste de propriedade). */
function sorteio(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4_294_967_296;
  };
}

/** Roda `fn` com Math.random proibido (a Simulacao nunca sorteia fora da semente). */
function semMathRandom(fn) {
  const original = Math.random;
  Math.random = () => {
    throw new Error("Math.random na Simulacao");
  };
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

/* ------------------------------------------------------------------------------------------------
 * O contador
 * ---------------------------------------------------------------------------------------------- */

test("contador: deterministico pela semente e pelo offset, sem Math.random; off 0; fixed a base (antes do zero tambem) e 0 do fim em diante", () => {
  const curve = { base: 30, jitter: 8, mode: "curve", peak: 200 };
  const valores = semMathRandom(() => Array.from({ length: 240 }, (_, step) => model.counterExtraAt(curve, 99, step * STEP, HOUR)));
  assert.deepEqual(valores, Array.from({ length: 240 }, (_, step) => model.counterExtraAt(curve, 99, step * STEP, HOUR)), "a mesma semente da o mesmo numero");
  const outra = Array.from({ length: 240 }, (_, step) => model.counterExtraAt(curve, 100, step * STEP, HOUR));
  assert.notDeepEqual(valores, outra, "outra semente, outra variacao");

  for (const offset of [-5 * MIN, 0, 7_000, 30 * MIN, HOUR - 1]) {
    assert.equal(model.counterExtraAt(off, 1, offset, HOUR), 0);
    assert.equal(model.counterExtraAt({ base: 75, jitter: 50, mode: "fixed", peak: 999 }, 1, offset, HOUR), 75, "o numero fixo nao varia");
  }
  assert.equal(model.counterExtraAt({ base: 75, jitter: 0, mode: "fixed", peak: 75 }, 1, HOUR, HOUR), 0, "do fim do video em diante, nada");
  assert.equal(model.counterExtraAt(curve, 99, 3 * STEP + 1, HOUR), model.counterExtraAt(curve, 99, 3 * STEP + STEP - 1, HOUR), "um numero por passo de 15 s");
  assert.equal(model.counterExtraAt(curve, 99, -2 * MIN, HOUR), model.counterExtraAt(curve, 99, 0, HOUR), "na espera vale o numero do zero");
});

test("contador em faixa: sobe de base ate peak nos primeiros 20 %, fica, desce de leve nos ultimos 10 %; a variacao fica no limite e nunca negativa", () => {
  const lisa = { base: 20, jitter: 0, mode: "curve", peak: 220 };
  const duracao = 100 * MIN;
  const at = (fraction) => model.counterExtraAt(lisa, 5, Math.floor((fraction * duracao) / STEP) * STEP, duracao);
  assert.equal(at(0), 20);
  assert.equal(at(0.2), 220);
  assert.equal(at(0.5), 220);
  assert.equal(at(0.89), 220);
  const fim = model.counterExtraAt(lisa, 5, duracao - 1, duracao);
  assert.ok(fim < 220 && fim >= 220 - 0.15 * 200, `desce de leve (${fim})`);
  const subida = Array.from({ length: Math.floor((0.2 * duracao) / STEP) }, (_, step) => model.counterExtraAt(lisa, 5, step * STEP, duracao));
  subida.forEach((value, index) => index > 0 && assert.ok(value >= subida[index - 1], "a subida nunca volta"));

  const comVariacao = { ...lisa, jitter: 15 };
  const variacoes = new Set();
  for (let step = 0; step * STEP < duracao; step += 1) {
    const valor = model.counterExtraAt(comVariacao, 77, step * STEP, duracao);
    const semVariacao = model.counterExtraAt(lisa, 77, step * STEP, duracao);
    assert.ok(Math.abs(valor - semVariacao) <= 15, `variacao limitada no passo ${step}`);
    variacoes.add(valor - semVariacao);
  }
  assert.ok(variacoes.size > 5, "a variacao muda de passo para passo");

  const pequena = { base: 0, jitter: 50, mode: "curve", peak: 3 };
  for (let step = 0; step < 400; step += 1) {
    assert.ok(model.counterExtraAt(pequena, 3, step * STEP, 400 * STEP) >= 0, "nunca negativo");
  }
  assert.equal(model.counterExtraAt({ base: 80, jitter: 0, mode: "curve", peak: 10 }, 1, 50 * MIN, duracao), 80, "maximo abaixo do minimo vale o minimo");
});

/* ------------------------------------------------------------------------------------------------
 * Entradas, saidas e avisos de venda
 * ---------------------------------------------------------------------------------------------- */

test("entradas: uma a cada everySeconds a partir de 0 ate max, so dentro do video, com nomes genericos (nunca repetidos em seguida); saidas so com nome de quem ja entrou", () => {
  const joins = { enabled: true, everySeconds: 30, max: 50, names: "generic" };
  const todos = semMathRandom(() => model.joinsBetween(joins, 2024, 0, HOUR - 1, HOUR));
  const entradas = todos.filter((event) => !event.left);
  const saidas = todos.filter((event) => event.left);
  assert.equal(entradas.length, 50, "ate o maximo");
  entradas.forEach((event, slot) => {
    assert.ok(event.atMs >= slot * 30_000 && event.atMs < slot * 30_000 + 15_000, `a entrada ${slot} cai na primeira metade do intervalo ${slot}`);
    assert.ok(NAMES.has(event.name), `${event.name} e um nome generico`);
    if (slot > 0) {
      assert.notEqual(event.name, entradas[slot - 1].name, "o mesmo nome nunca duas vezes seguidas");
    }
  });
  assert.equal(new Set(entradas.slice(0, 20).map((event) => event.name)).size, 20, "os 20 nomes antes de repetir");
  assert.ok(saidas.length > 0, "algumas saidas");
  for (const saida of saidas) {
    const slot = Math.floor(saida.atMs / 30_000);
    assert.ok(slot >= 3 && saida.atMs >= slot * 30_000 + 15_000, "a saida cai na segunda metade, a partir da 4a entrada");
    assert.ok(entradas.slice(0, slot).some((event) => event.name === saida.name), "sai quem entrou antes");
  }
  assert.deepEqual(todos.map((event) => event.atMs), [...todos.map((event) => event.atMs)].sort((a, b) => a - b), "em ordem");

  const curta = model.joinsBetween(joins, 2024, 0, 10 * MIN, 5 * MIN);
  assert.ok(curta.every((event) => event.atMs < 5 * MIN), "nada depois do fim do video");
  assert.equal(curta.filter((event) => !event.left).length, 10);

  const janela = model.joinsBetween(joins, 2024, 7 * MIN, 9 * MIN, HOUR);
  assert.deepEqual(janela, todos.filter((event) => event.atMs >= 7 * MIN && event.atMs <= 9 * MIN), "a janela e o mesmo recorte");
  assert.deepEqual(model.joinsBetween({ ...joins, enabled: false }, 2024, 0, HOUR, HOUR), []);
  assert.deepEqual(model.joinsBetween({ ...joins, max: 0 }, 2024, 0, HOUR, HOUR), []);
  assert.deepEqual(model.joinsBetween(joins, 2024, -5 * MIN, -1, HOUR), [], "a espera nao tem entradas");
  assert.notDeepEqual(model.joinsBetween(joins, 1, 0, HOUR, HOUR).map((event) => event.name), entradas.map((event) => event.name), "outra semente, outros nomes");
});

test("avisos de venda: so ligados, os da janela e dentro do video, na ordem do minuto e sem espacos nas pontas", () => {
  const notices = { enabled: true, items: [{ offsetMs: 20 * MIN, text: " Bia garantiu a vaga " }, { offsetMs: 5 * MIN, text: "Carlos garantiu a vaga" }, { offsetMs: 70 * MIN, text: "depois do fim" }] };
  assert.deepEqual(model.saleNoticesBetween(notices, 0, HOUR, HOUR), [
    { atMs: 5 * MIN, text: "Carlos garantiu a vaga" },
    { atMs: 20 * MIN, text: "Bia garantiu a vaga" }
  ]);
  assert.deepEqual(model.saleNoticesBetween(notices, 4 * MIN, 6 * MIN, HOUR), [{ atMs: 5 * MIN, text: "Carlos garantiu a vaga" }]);
  assert.deepEqual(model.saleNoticesBetween({ ...notices, enabled: false }, 0, HOUR, HOUR), [], "desligados por padrao: nada");
});

/* ------------------------------------------------------------------------------------------------
 * A janela do aluno e o resumo do fim
 * ---------------------------------------------------------------------------------------------- */

test("a janela do aluno: so a sessao gravada com algo ligado; replay, live, cancelada e sem regra devolvem enabled false e listas vazias; nunca a semente nem as regras", () => {
  const ligada = simulacao({ countRule: { base: 10, jitter: 2, mode: "curve", peak: 90 }, joins: { enabled: true, everySeconds: 20, max: 100, names: "generic" }, saleNotices: { enabled: true, items: [{ offsetMs: 61_000, text: "Ana garantiu" }] } });
  const feed = model.simulationFeed({ durationMs: HOUR, fromMs: 0, kind: "simulated", simulation: ligada, status: "live", toMs: WINDOW });
  assert.equal(feed.enabled, true);
  assert.deepEqual(Object.keys(feed).sort(), ["counter", "enabled", "from", "joins", "saleNotices", "to"]);
  assert.doesNotMatch(JSON.stringify(feed), /seed|12345|jitter|peak|everySeconds|"max"/, "nem semente nem regra");
  assert.deepEqual(feed.counter.map((point) => point.atMs), Array.from({ length: 9 }, (_, index) => index * STEP));
  assert.deepEqual(feed.saleNotices, [{ atMs: 61_000, text: "Ana garantiu" }]);
  assert.ok(feed.joins.length >= 6);

  for (const kind of ["replay", "live"]) {
    assert.deepEqual(model.simulationFeed({ durationMs: HOUR, fromMs: 0, kind, simulation: ligada, toMs: WINDOW }), { counter: [], enabled: false, from: 0, joins: [], saleNotices: [], to: WINDOW }, kind);
  }
  assert.equal(model.simulationFeed({ durationMs: HOUR, fromMs: 0, kind: "simulated", simulation: ligada, status: "cancelled", toMs: WINDOW }).enabled, false);
  assert.equal(model.simulationFeed({ durationMs: HOUR, fromMs: 0, kind: "simulated", simulation: simulacao(), toMs: WINDOW }).enabled, false, "so o selo nao muda nada na sala");
  assert.equal(model.simulationFeed({ durationMs: HOUR, fromMs: 0, kind: "simulated", simulation: null, toMs: WINDOW }).enabled, false);
  assert.equal(model.simulationFeed({ durationMs: HOUR, fromMs: 0, kind: "simulated", simulation: simulacao({ saleNotices: { enabled: true, items: [] } }), toMs: WINDOW }).enabled, false, "avisos sem item contam como desligados");
  const grande = model.simulationFeed({ durationMs: HOUR, fromMs: 0, kind: "simulated", simulation: ligada, toMs: 10 * MIN });
  assert.equal(grande.to, WINDOW, "nunca mais que 120 s por janela");
});

test("propriedade: o resumo congelado e exatamente o que as janelas da sala mostraram de 0 ao fim (entrando na espera, janela a janela como a sala)", () => {
  const rand = sorteio(31337);
  for (let round = 0; round < 40; round += 1) {
    const mode = ["off", "fixed", "curve"][Math.floor(rand() * 3)];
    const base = Math.floor(rand() * 300);
    const sim = simulacao({
      countRule: { base, jitter: Math.floor(rand() * 40), mode, peak: base + Math.floor(rand() * 500) },
      joins: { enabled: rand() < 0.8, everySeconds: 10 + Math.floor(rand() * 120), max: Math.floor(rand() * 200), names: "generic" },
      saleNotices: { enabled: rand() < 0.7, items: Array.from({ length: Math.floor(rand() * 12) }, (_, index) => ({ offsetMs: Math.floor(rand() * 2 * HOUR), text: `Aviso ${index}` })) },
      seed: Math.floor(rand() * 2_147_483_647)
    });
    const durationMs = 5 * MIN + Math.floor(rand() * 2 * HOUR);

    let current = null;
    let counterMax = 0;
    let joinsShown = 0;
    let saleNoticesShown = 0;
    // A sala entra 2 min antes da hora marcada e confere a janela a cada 5 s ate o fim do video.
    for (let offsetMs = -2 * MIN; offsetMs <= durationMs + WINDOW; offsetMs += model.SIMULATION_ROOM.checkEveryMs) {
      const next = model.simulationWindowToFetch({ current, offsetMs });
      if (!next) {
        continue;
      }
      if (current) {
        assert.ok(next.fromMs === current.toMs + 1, "a janela seguinte comeca onde a anterior parou");
      }
      assert.ok(next.toMs - next.fromMs <= WINDOW);
      current = next;
      const feed = model.simulationFeed({ durationMs, fromMs: next.fromMs, kind: "simulated", simulation: sim, toMs: next.toMs });
      for (const point of feed.counter) {
        counterMax = Math.max(counterMax, point.extra);
      }
      joinsShown += feed.joins.filter((event) => !event.left).length;
      saleNoticesShown += feed.saleNotices.length;
    }

    assert.deepEqual(model.simulationTotals(sim, durationMs), { counterMax, joinsShown, saleNoticesShown }, `rodada ${round} (${mode})`);
  }
});

test("Encerrar antecipado: o resumo e o maior numero que as janelas mostraram antes do fim, com a faixa do video inteiro (nunca espremida)", () => {
  // Video de 60 min, contador em faixa 10 -> 300 sem variacao; a equipe encerra aos 3 min.
  const sim = simulacao({ countRule: { base: 10, jitter: 0, mode: "curve", peak: 300 } });
  const endMs = 3 * MIN;
  let shownMax = 0;
  let current = null;
  // Durante a sessao o ended_at e nulo: a sala recebeu a faixa desenhada sobre os 60 min.
  for (let offsetMs = -MIN; offsetMs < endMs; offsetMs += model.SIMULATION_ROOM.checkEveryMs) {
    const next = model.simulationWindowToFetch({ current, offsetMs });
    if (!next) continue;
    current = next;
    for (const point of model.simulationFeed({ durationMs: HOUR, fromMs: next.fromMs, kind: "simulated", simulation: sim, toMs: next.toMs }).counter) {
      if (point.atMs < endMs) shownMax = Math.max(shownMax, point.extra);
    }
  }
  assert.ok(shownMax < 150, `a faixa ainda subia (${shownMax})`);
  const frozen = model.simulationTotals(sim, { endMs, videoMs: HOUR });
  assert.equal(frozen.counterMax, shownMax, "o congelado e o que a sala mostrou");
  assert.notEqual(model.simulationTotals(sim, endMs).counterMax, shownMax, "a conta antiga (faixa espremida em 3 min) chegava ao pico");

  // Depois do Encerrar, a rota manda a mesma forma e zera do fim em diante; entradas e avisos param no fim real.
  const depois = model.simulationFeed({
    durationMs: HOUR,
    endMs,
    fromMs: 2 * MIN,
    kind: "simulated",
    simulation: { ...sim, joins: { enabled: true, everySeconds: 10, max: 1000, names: "generic" }, saleNotices: { enabled: true, items: [{ offsetMs: 2.5 * MIN, text: "Ana comprou" }, { offsetMs: 3.5 * MIN, text: "Bia comprou" }] } },
    toMs: 4 * MIN
  });
  const at = (ms) => depois.counter.find((point) => point.atMs === ms)?.extra;
  assert.equal(at(2 * MIN), model.counterExtraAt(sim.countRule, sim.seed, 2 * MIN, HOUR), "a mesma forma do video");
  assert.equal(at(3 * MIN), 0);
  assert.ok(depois.joins.every((event) => event.atMs < endMs));
  assert.deepEqual(depois.saleNotices.map((notice) => notice.text), ["Ana comprou"]);
});

test("o fim da sessao: o Encerrar da equipe antes do fim do video corta o resumo; sem ended_at vale a duracao", () => {
  const scheduledAt = "2026-11-05T23:00:00.000Z";
  assert.equal(model.simulationEndOffsetMs({ endedAt: null, scheduledAt }, HOUR), HOUR);
  assert.equal(model.simulationEndOffsetMs({ endedAt: "2026-11-05T23:20:00+00:00", scheduledAt }, HOUR), 20 * MIN, "compara instantes (+00:00 e Z)");
  assert.equal(model.simulationEndOffsetMs({ endedAt: "2026-11-06T02:00:00.000Z", scheduledAt }, HOUR), HOUR, "nunca depois do fim do video");
  const sim = simulacao({ joins: { enabled: true, everySeconds: 60, max: 1000, names: "generic" } });
  assert.equal(model.simulationTotals(sim, 20 * MIN).joinsShown, 20);
  assert.deepEqual(model.simulationTotals(sim, 0), { counterMax: 0, joinsShown: 0, saleNoticesShown: 0 });
});

/* ------------------------------------------------------------------------------------------------
 * A frase de §8.6 e as regras normalizadas
 * ---------------------------------------------------------------------------------------------- */

test("a frase de §8.6: diz o selo, os numeros e os avisos; confere a de hoje e a de ontem com o nome; recusa outro nome ou outros numeros", () => {
  const nowMs = Date.parse("2026-11-05T23:05:00.000Z"); // 20:05 de 5/11 em Sao Paulo
  const regras = { countRule: { base: 30, jitter: 0, mode: "fixed", peak: 30 }, joins: semEntradas, saleNotices: { enabled: true, items: [{ offsetMs: MIN, text: "Ana garantiu" }] }, showLiveBadge: true };
  const frase = model.simulationAckFor({ nowMs, responsible: "Produtora de Teste", rules: regras });
  assert.equal(
    frase,
    'Decisão do produtor em 05/11/2026: nesta sessão gravada, dentro da área de membros, o selo "Ao vivo" fica ligado, os números de plateia são simulados e os avisos de venda são simulados. Fora da área de membros, esta sessão nunca é anunciada como ao vivo. Responsável: Produtora de Teste.'
  );
  assert.ok(model.simulationAckMatches({ ackText: `  ${frase.replace('"Ao vivo"', "“Ao vivo”")}  `, nowMs, responsible: "Produtora de Teste", rules: regras }), "aspas curvas e espacos");
  assert.ok(model.simulationAckMatches({ ackText: frase, nowMs: nowMs + 86_400_000, responsible: "Produtora de Teste", rules: regras }), "a tela aberta antes da meia-noite");
  assert.ok(!model.simulationAckMatches({ ackText: frase, nowMs: nowMs + 2 * 86_400_000, responsible: "Produtora de Teste", rules: regras }));
  assert.ok(!model.simulationAckMatches({ ackText: frase, nowMs, responsible: "Outra Pessoa", rules: regras }));
  assert.ok(!model.simulationAckMatches({ ackText: frase, nowMs, responsible: "Produtora de Teste", rules: { ...regras, countRule: off } }), "outros numeros, outra frase");
  assert.ok(!model.simulationAckMatches({ ackText: "", nowMs, responsible: "Produtora de Teste", rules: regras }));

  const tudoDesligado = model.simulationAckFor({ nowMs, responsible: "X", rules: { countRule: off, joins: semEntradas, saleNotices: semAvisos, showLiveBadge: false } });
  assert.match(tudoDesligado, /fica desligado, os números de plateia são reais e os avisos de venda não aparecem/);
  assert.ok(model.clampSimulationAck("x".repeat(900)).length <= 600);
});

test("as regras normalizadas: off e fixed sem o que nao usam, avisos sem item desligados, itens na ordem; a frase e a caixa contam igual", () => {
  const normal = model.normalizeSimulationRules({
    countRule: { base: 12, jitter: 9, mode: "fixed", peak: 99 },
    joins: { enabled: false, everySeconds: 15, max: 3, names: "generic" },
    saleNotices: { enabled: true, items: [] },
    showLiveBadge: false
  });
  assert.deepEqual(normal, { countRule: { base: 12, jitter: 0, mode: "fixed", peak: 12 }, joins: semEntradas, saleNotices: semAvisos, showLiveBadge: false });
  assert.deepEqual(model.simulationAckFlags(normal), { badgeOn: false, countSimulated: true, joinsSimulated: false, saleNoticesSimulated: false });
  assert.equal(simulationNeedsAck(normal), true);
  const ordenados = model.normalizeSimulationRules({ countRule: off, joins: semEntradas, saleNotices: { enabled: true, items: [{ offsetMs: 9, text: " b " }, { offsetMs: 3, text: "a" }] }, showLiveBadge: false });
  assert.deepEqual(ordenados.saleNotices.items, [{ offsetMs: 3, text: "a" }, { offsetMs: 9, text: "b" }]);
  assert.equal(simulationNeedsAck(model.normalizeSimulationRules({ countRule: off, joins: semEntradas, saleNotices: semAvisos, showLiveBadge: false })), false);
});

/* ------------------------------------------------------------------------------------------------
 * As contas da sala (navegador)
 * ---------------------------------------------------------------------------------------------- */

test("na sala: a janela a pedir (15 s antes ao entrar, a seguinte 30 s antes do fim, de novo do offset depois de um salto)", () => {
  assert.deepEqual(model.simulationWindowToFetch({ current: null, offsetMs: 60_000 }), { fromMs: 45_000, toMs: 165_000 });
  assert.equal(model.simulationWindowToFetch({ current: { fromMs: 45_000, toMs: 165_000 }, offsetMs: 100_000 }), null);
  assert.deepEqual(model.simulationWindowToFetch({ current: { fromMs: 45_000, toMs: 165_000 }, offsetMs: 135_000 }), { fromMs: 165_001, toMs: 285_001 });
  assert.deepEqual(model.simulationWindowToFetch({ current: { fromMs: 45_000, toMs: 165_000 }, offsetMs: 900_000 }), { fromMs: 885_000, toMs: 1_005_000 }, "a aba congelada recomeca do offset");
});

test("na sala: a fusao sem repetir, o numero do instante, a entrada por 8 s, o aviso por 4 s e o leitor de tela no maximo um aviso por minuto", () => {
  const feed1 = { counter: [{ atMs: 0, extra: 10 }, { atMs: STEP, extra: 12 }], enabled: true, from: 0, joins: [{ atMs: 5_000, name: "Ana M." }], saleNotices: [{ atMs: 20_000, text: "Carlos garantiu" }], to: WINDOW };
  const feed2 = { counter: [{ atMs: STEP, extra: 12 }, { atMs: 2 * STEP, extra: 15 }], enabled: true, from: WINDOW + 1, joins: [{ atMs: 5_000, name: "Ana M." }, { atMs: 40_000, left: true, name: "Ana M." }], saleNotices: [{ atMs: 50_000, text: "Bia garantiu" }, { atMs: 90_000, text: "Duda garantiu" }], to: 2 * WINDOW };
  const data = model.mergeSimulationFeed(model.mergeSimulationFeed(model.EMPTY_SIMULATION_ROOM, feed1, 0), feed2, 0);
  assert.equal(data.enabled, true);
  assert.deepEqual(data.counter.map((point) => point.atMs), [0, STEP, 2 * STEP]);
  assert.deepEqual(data.joins, [{ atMs: 5_000, name: "Ana M." }, { atMs: 40_000, left: true, name: "Ana M." }]);
  assert.equal(model.counterExtraFromPoints(data.counter, 20_000), 12);
  assert.equal(model.counterExtraFromPoints(data.counter, -3_000), 10, "antes do primeiro ponto, o primeiro");
  assert.equal(model.counterExtraFromPoints([], 1), null);

  assert.deepEqual(model.visibleJoin(data.joins, 9_000), { atMs: 5_000, name: "Ana M." });
  assert.equal(model.visibleJoin(data.joins, 13_000), null, "some depois de 8 s");
  assert.equal(model.visibleJoin(data.joins, 4_000), null, "antes do segundo dela, nada");
  assert.deepEqual(model.visibleSaleNotice(data.saleNotices, 23_999), { atMs: 20_000, text: "Carlos garantiu" });
  assert.equal(model.visibleSaleNotice(data.saleNotices, 24_000), null, "4 s na tela");
  assert.deepEqual(model.announcedSaleNotice(data.saleNotices, 60_000), { atMs: 20_000, text: "Carlos garantiu" }, "o de 50 s fica so na tela");
  assert.deepEqual(model.announcedSaleNotice(data.saleNotices, 95_000), { atMs: 90_000, text: "Duda garantiu" });

  const podado = model.mergeSimulationFeed(data, { ...feed2, counter: [{ atMs: 30 * STEP, extra: 40 }], joins: [], saleNotices: [] }, 30 * STEP + 5 * MIN);
  assert.deepEqual(podado.joins, [], "o que ficou 5 min para tras sai");
  assert.equal(model.counterExtraFromPoints(podado.counter, 30 * STEP + 5 * MIN), 40);
  assert.deepEqual(model.mergeSimulationFeed(data, { ...feed2, enabled: false }, 0), model.EMPTY_SIMULATION_ROOM, "desligada no meio: some tudo");
});

/* ------------------------------------------------------------------------------------------------
 * Guarda D6/M6
 * ---------------------------------------------------------------------------------------------- */

function arquivos(dir) {
  const root = fileURLToPath(new URL(`../${dir}`, import.meta.url));
  const found = [];
  const walk = (path) => {
    for (const name of readdirSync(path)) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx)$/.test(name)) {
        found.push(full);
      }
    }
  };
  walk(root);
  return found;
}

test("D6/M6: os paineis, o relatorio, as exportacoes, o follow-up e a Comunicacao nunca importam simulation-model (nenhum numero simulado vira metrica real)", () => {
  const webinars = arquivos("src/server/webinars").filter((file) => /\/(panel|report|export|follow-up)-[^/]+\.ts$/.test(file));
  assert.ok(webinars.length >= 4, "achou os arquivos dos paineis e do relatorio");
  const telas = [
    ...arquivos("src/components/admin/v2/communication/webinars/panels"),
    ...arquivos("src/components/admin/v2/communication/webinars/report"),
    ...arquivos("src/server/communications"),
    ...arquivos("src/app/api/admin/webinars")
  ];
  for (const file of [...webinars, ...telas]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /simulation-model/, `${file} nao le a Simulacao calculada`);
  }
  const source = readFileSync(fileURLToPath(new URL("../src/server/webinars/simulation-model.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(source, /server-only|Math\.random|Date\.now\(/, "modulo puro, sem sorteio fora da semente nem relogio");
});
