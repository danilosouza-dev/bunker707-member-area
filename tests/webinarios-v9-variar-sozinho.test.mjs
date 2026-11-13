import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/transpile-tsx.mjs";

// "Variar sozinho" dos participantes simulados (rodada v9, pedido do produtor de 12/11/2026; docs/30 D90; docs/18
// §2.2), a parte pura e a tela, sem banco:
// - a hora de cada mudanca sai da semente e do indice, com a distancia entre duas seguidas sempre entre o minimo e o
//   maximo de segundos; varyIndexAt acha a ultima que ja caiu;
// - o numero fica dentro da faixa do exemplo ("Com +300 e 5%, o número fica entre 285 e 315."), para mais e para
//   menos, so para mais ou so para menos; igual para a mesma semente, parado entre duas mudancas; sem a variacao, o
//   numero fixo de sempre; nenhum Math.random nem relogio no modelo;
// - a janela da sala leva o ponto de cada mudanca (alem dos de 15 s), e o numero que a sala mostra em qualquer segundo
//   e o do modelo; a mudanca no ar passa pela rampa de 90 s; o resumo do fim (D80) e o maior numero dos mesmos pontos;
// - a regra gravada e lida (so no numero fixo maior que zero, com os numeros dentro dos limites); os schemas;
// - o formulario: os erros de cada campo, a frase de exemplo, o Aplicar com o campo do numero vazio (vale o numero de
//   agora), "igual" so com o mesmo numero e a mesma variacao; o card do editor antes do comeco;
// - a tela: a caixa, os campos, o exemplo e a variacao de agora debaixo do numero; o valor da mudanca no relatorio.

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const model = await import("../src/server/webinars/simulation-model.ts");
const base = await import("../src/server/webinars/model.ts");
const rows = await import("../src/server/webinars/rows.ts");
const audience = await import("../src/server/webinars/simulation-audience-model.ts");
const schemas = await import("../src/server/webinars/simulation-schemas.ts");
const card = await import("../src/components/admin/v2/communication/webinars/simulation/simulation-card-model.ts");
const report = await import("../src/server/webinars/report-page-model.ts");
const { SimulationVaryFields } = await import("../src/components/admin/v2/communication/webinars/simulation/simulation-vary-fields.tsx");
const { SimulationAudienceControl } = await import("../src/components/admin/v2/communication/webinars/simulation/simulation-audience-control.tsx");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const COPY = WEBINAR_COPY.simulacao.plateia;
const MIN = 60_000;
const HORA = 60 * MIN;
const VARIA = { direction: "both", everyMaxSeconds: 60, everyMinSeconds: 20, percent: 5 };
const fixa = (extra, vary) => model.simulationAudienceRule(extra, vary);
const textOf = (markup) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
const SEMENTES = [1, 7, 4242, 987654321];

test("a hora de cada mudanca: a distancia entre duas seguidas fica entre o minimo e o maximo; varyIndexAt acha a ultima que ja caiu", () => {
  for (const vary of [VARIA, { ...VARIA, everyMaxSeconds: 20 }, { ...VARIA, everyMaxSeconds: 600, everyMinSeconds: 5 }, { ...VARIA, everyMaxSeconds: 7, everyMinSeconds: 5 }]) {
    for (const seed of SEMENTES) {
      let previous = model.varyChangeAtMs(vary, seed, 0);
      for (let index = 1; index < 400; index += 1) {
        const at = model.varyChangeAtMs(vary, seed, index);
        const gap = at - previous;
        // A hora e arredondada ao milissegundo: 1 ms de folga de cada lado.
        assert.ok(gap >= vary.everyMinSeconds * 1000 - 1 && gap <= vary.everyMaxSeconds * 1000 + 1, `${JSON.stringify(vary)} semente ${seed}, mudanca ${index}: ${gap} ms`);
        previous = at;
      }
      for (const offset of [0, 1, 4_999, 20_000, 59_999, 61_234, 10 * MIN, HORA + 17, 3 * HORA]) {
        const index = model.varyIndexAt(vary, seed, offset);
        assert.ok(model.varyChangeAtMs(vary, seed, index) <= offset, "a mudanca achada ja caiu");
        assert.ok(model.varyChangeAtMs(vary, seed, index + 1) > offset, "a seguinte ainda nao");
      }
    }
  }
  // O mesmo intervalo dos dois lados: a grade exata.
  assert.deepEqual([0, 1, 2, 3].map((index) => model.varyChangeAtMs({ ...VARIA, everyMaxSeconds: 30, everyMinSeconds: 30 }, 9, index)), [0, 30_000, 60_000, 90_000]);
});

test("o numero fica dentro da faixa do exemplo, para o lado escolhido, parado entre duas mudancas e igual para a mesma semente", () => {
  assert.deepEqual(model.varyRange(300, VARIA), { max: 315, min: 285 }, "Com +300 e 5%, o número fica entre 285 e 315.");
  assert.deepEqual(model.varyRange(300, { ...VARIA, direction: "up" }), { max: 315, min: 300 });
  assert.deepEqual(model.varyRange(300, { ...VARIA, direction: "down" }), { max: 300, min: 285 });
  assert.deepEqual(model.varyRange(10, { ...VARIA, direction: "down", percent: 50 }), { max: 10, min: 5 });

  for (const direction of ["both", "up", "down"]) {
    const vary = { ...VARIA, direction };
    const rule = fixa(300, vary);
    const { max, min } = model.varyRange(300, vary);
    for (const seed of SEMENTES) {
      const seen = new Set();
      for (let offset = 0; offset < 2 * HORA; offset += 1000) {
        const value = model.counterExtraAt(rule, seed, offset, 2 * HORA);
        assert.ok(value >= min && value <= max, `${direction}, semente ${seed}, ${offset} ms: ${value}`);
        seen.add(value);
      }
      assert.ok(seen.size >= 8, `${direction}, semente ${seed}: o numero muda de verdade (${seen.size} valores)`);
      if (direction !== "up") {
        assert.ok([...seen].some((value) => value < 300), "desce abaixo do fixo");
      }
      if (direction !== "down") {
        assert.ok([...seen].some((value) => value > 300), "sobe acima do fixo");
      }
    }
  }

  // Parado entre duas mudancas, e o mesmo numero para a mesma semente (todos os alunos veem igual).
  const rule = fixa(300, VARIA);
  const first = model.varyChangeAtMs(VARIA, 4242, 5);
  const next = model.varyChangeAtMs(VARIA, 4242, 6);
  const value = model.counterExtraAt(rule, 4242, first, HORA);
  for (let offset = first; offset < next; offset += 500) {
    assert.equal(model.counterExtraAt(rule, 4242, offset, HORA), value);
  }
  assert.equal(model.counterExtraAt(rule, 4242, 10 * MIN, HORA), model.counterExtraAt(rule, 4242, 10 * MIN, HORA));
  const outra = Array.from({ length: 60 }, (_, index) => model.counterExtraAt(rule, 7, index * MIN, 2 * HORA));
  const esta = Array.from({ length: 60 }, (_, index) => model.counterExtraAt(rule, 4242, index * MIN, 2 * HORA));
  assert.notDeepEqual(outra, esta, "outra semente, outra sequencia");

  // Antes do zero vale o numero do zero; do fim do video em diante, 0 (a gravada); a live segura.
  assert.equal(model.counterExtraAt(rule, 4242, -5 * MIN, HORA), model.counterExtraAt(rule, 4242, 0, HORA));
  assert.equal(model.counterExtraAt(rule, 4242, HORA, HORA), 0);
  assert.ok(model.counterExtraAt(rule, 4242, HORA + MIN, HORA, true) >= 285);

  // Sem a variacao, o numero fixo de sempre.
  assert.equal(model.counterExtraAt(fixa(300), 4242, 10 * MIN, HORA), 300);
  assert.equal(model.counterExtraAt(fixa(300, null), 4242, 10 * MIN, HORA), 300);

  // Nada de sorteio fora da semente nem de relogio.
  const source = readFileSync(new URL("../src/server/webinars/simulation-model.ts", import.meta.url), "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(source, /Math\.random|Date\.now|new Date\(\)/);
});

test("a janela da sala leva o ponto de cada mudanca, e o numero mostrado em qualquer segundo e o do modelo", () => {
  const simulation = { countChanges: [], countRule: fixa(300, VARIA), joins: base.defaultSimulatedJoins(), saleNotices: base.defaultSimulatedSaleNotices(), seed: 4242, sessionId: "s", summary: null };
  const feed = model.simulationFeed({ durationMs: HORA, fromMs: 10 * MIN, kind: "simulated", simulation, toMs: 12 * MIN });
  const grid = feed.counter.filter((point) => point.atMs % 15_000 === 0);
  const extras = feed.counter.filter((point) => point.atMs % 15_000 !== 0);
  assert.equal(grid.length, 9, "os pontos de 15 s continuam");
  assert.ok(extras.length >= 2 && extras.length <= 6, `as mudancas da variacao em 2 min, a cada 20 a 60 s (${extras.length})`);
  assert.deepEqual(feed.counter.map((point) => point.atMs), [...feed.counter.map((point) => point.atMs)].sort((a, b) => a - b), "em ordem");
  assert.equal(new Set(feed.counter.map((point) => point.atMs)).size, feed.counter.length, "sem repetir");
  for (let offset = 10 * MIN; offset <= 12 * MIN; offset += 1000) {
    assert.equal(model.counterExtraFromPoints(feed.counter, offset), model.counterExtraAt(simulation.countRule, 4242, offset, HORA), `${offset} ms`);
  }
  // O numero do console agora (a janela de um ponto so) e o mesmo.
  assert.equal(model.simulationCounterNow({ durationMs: HORA, kind: "simulated", offsetMs: 11 * MIN + 7_000, simulation }), model.counterExtraAt(simulation.countRule, 4242, 11 * MIN + 7_000, HORA));
  // Nada da semente nem da regra vai para o aluno.
  assert.doesNotMatch(JSON.stringify(feed), /4242|percent|vary/);
});

test("a mudanca no ar com a variacao passa pela rampa de 90 s e depois fica na faixa; desligar a variacao volta ao numero parado", () => {
  const simulation = {
    countChanges: [
      { atMs: 10 * MIN + 4_000, rule: fixa(300, VARIA) },
      { atMs: 30 * MIN, rule: fixa(300) }
    ],
    countRule: fixa(100),
    seed: 4242
  };
  const timeline = model.countTimelineOf(simulation, HORA);
  assert.equal(model.timelineExtraAt(timeline, 10 * MIN), 100, "antes da mudanca, o numero de antes");
  let previous = 100;
  for (let offset = 10 * MIN + 15_000; offset <= 11 * MIN + 30_000; offset += 15_000) {
    const value = model.timelineExtraAt(timeline, offset);
    assert.ok(value >= previous - 15 && value <= 315, `a rampa sobe em direcao a faixa (${offset} ms: ${value})`);
    previous = value;
  }
  assert.ok(model.timelineExtraAt(timeline, 10 * MIN + 45_000) < 285, "no meio da rampa ainda nao chegou");
  for (let offset = 12 * MIN; offset < 30 * MIN; offset += 5_000) {
    const value = model.timelineExtraAt(timeline, offset);
    assert.ok(value >= 285 && value <= 315, `depois da rampa, na faixa (${offset} ms: ${value})`);
  }
  for (let offset = 32 * MIN; offset < 40 * MIN; offset += 5_000) {
    assert.equal(model.timelineExtraAt(timeline, offset), 300, "sem a variacao, parado no fixo");
  }
  // A regra que vale agora leva a variacao (o console mostra a frase dela).
  assert.deepEqual(model.simulationAudienceRuleAt(simulation, 20 * MIN).vary, VARIA);
  assert.equal(model.simulationAudienceRuleAt(simulation, 35 * MIN).vary, undefined);
});

test("o resumo do fim (D80) e o maior numero dos mesmos pontos que as janelas da sala mostraram, com a variacao", () => {
  for (const seed of SEMENTES) {
    const simulation = {
      countChanges: [
        { atMs: 5 * MIN + 3_000, rule: fixa(300, { ...VARIA, everyMaxSeconds: 12, everyMinSeconds: 5, percent: 20 }) },
        { atMs: 25 * MIN, rule: fixa(120, { ...VARIA, direction: "up" }) }
      ],
      countRule: fixa(50, VARIA),
      joins: base.defaultSimulatedJoins(),
      saleNotices: base.defaultSimulatedSaleNotices(),
      seed,
      sessionId: "s",
      summary: null
    };
    const endMs = 47 * MIN + 13_000;
    let shown = 0;
    let points = 0;
    for (let from = 0; from < endMs; from += 120_000) {
      const feed = model.simulationFeed({ durationMs: HORA, endMs, fromMs: from, kind: "simulated", simulation, toMs: from + 119_999 });
      for (const point of feed.counter) {
        if (point.atMs < endMs) {
          shown = Math.max(shown, point.extra);
          points += 1;
        }
      }
    }
    const totals = model.simulationTotals(simulation, { endMs, videoMs: HORA });
    assert.equal(totals.counterMax, shown, `semente ${seed}: o resumo e o que a sala mostrou`);
    assert.ok(totals.counterMax > 300 && totals.counterMax <= 360, `o pico entra no resumo (${totals.counterMax})`);
    assert.ok(points > 47 * 4, "as janelas levaram os pontos das mudancas alem dos de 15 s");
  }
});

test("a regra gravada e lida: a variacao so no numero fixo maior que zero e dentro dos limites", () => {
  const regra = fixa(300, VARIA);
  assert.deepEqual(regra, { base: 300, jitter: 0, mode: "fixed", peak: 300, vary: VARIA });
  const gravada = rows.simulatedCountRuleToRow(regra);
  assert.deepEqual(gravada, { base: 300, jitter: 0, mode: "fixed", peak: 300, vary: { direction: "both", every_max_seconds: 60, every_min_seconds: 20, percent: 5 } });
  assert.deepEqual(rows.simulatedCountRuleOfRow(gravada), regra, "ida e volta");
  assert.ok(JSON.stringify(gravada).length < 4096, "cabe no check do banco");

  // Sem a variacao, a linha de sempre (o app de antes le igual).
  assert.deepEqual(rows.simulatedCountRuleToRow(fixa(300)), { base: 300, jitter: 0, mode: "fixed", peak: 300 });
  assert.equal(rows.simulatedCountRuleToRow(fixa(0, VARIA)), null, "com o +0, Só o real");
  assert.equal(fixa(0, VARIA).vary, undefined);

  for (const [rotulo, vary] of [
    ["percentual 0", { ...VARIA, percent: 0 }],
    ["percentual 51", { ...VARIA, percent: 51 }],
    ["percentual quebrado", { ...VARIA, percent: 2.5 }],
    ["menos de 5 s", { ...VARIA, everyMinSeconds: 4 }],
    ["mais de 10 min", { ...VARIA, everyMaxSeconds: 601 }],
    ["o maximo menor que o minimo", { ...VARIA, everyMaxSeconds: 10 }],
    ["direcao desconhecida", { ...VARIA, direction: "lado" }]
  ]) {
    assert.equal(fixa(300, vary).vary, undefined, rotulo);
    assert.equal(rows.simulatedCountRuleOfRow({ base: 300, mode: "fixed", peak: 300, vary: { direction: vary.direction, every_max_seconds: vary.everyMaxSeconds, every_min_seconds: vary.everyMinSeconds, percent: vary.percent } }).vary, undefined, `${rotulo} na linha`);
  }
  // Na faixa que varia a variacao nao vale (ela ja tem a dela).
  assert.equal(rows.simulatedCountRuleOfRow({ base: 50, jitter: 3, mode: "curve", peak: 300, vary: gravada.vary }).vary, undefined);
  assert.equal(rows.simulatedCountRuleToRow({ base: 50, jitter: 3, mode: "curve", peak: 300, vary: VARIA }).vary, undefined);
  // A linha de antes (sem a chave) continua lida igual.
  assert.deepEqual(rows.simulatedCountRuleOfRow({ base: 300, jitter: 0, mode: "fixed", peak: 300 }), { base: 300, jitter: 0, mode: "fixed", peak: 300 });

  assert.equal(base.sameSimulatedCountVary(VARIA, { ...VARIA }), true);
  assert.equal(base.sameSimulatedCountVary(VARIA, { ...VARIA, percent: 6 }), false);
  assert.equal(base.sameSimulatedCountVary(null, undefined), true);
  assert.equal(base.sameSimulatedCountVary(VARIA, null), false);
});

test("os schemas: o pedido do console e as regras do card aceitam a variacao e recusam fora dos limites, com a frase em portugues", () => {
  const sessionId = "00000000-0000-4000-8000-000000000001";
  const aceito = schemas.saveSimulatedAudienceSchema.safeParse({ extra: 300, sessionId, vary: VARIA });
  assert.equal(aceito.success, true);
  assert.deepEqual(aceito.data.vary, VARIA);
  assert.equal(schemas.saveSimulatedAudienceSchema.safeParse({ extra: 300, sessionId }).success, true, "a pagina de antes, sem a chave");
  assert.equal(schemas.saveSimulatedAudienceSchema.safeParse({ extra: 300, sessionId, vary: null }).success, true);
  const mensagem = (vary) => schemas.saveSimulatedAudienceSchema.safeParse({ extra: 300, sessionId, vary }).error?.issues[0]?.message;
  assert.equal(mensagem({ ...VARIA, percent: 0 }), "Use de 1 a 50%.");
  assert.equal(mensagem({ ...VARIA, everyMinSeconds: 2 }), "Use de 5 a 600 segundos.");
  assert.equal(mensagem({ ...VARIA, everyMaxSeconds: 10 }), "O segundo número precisa ser maior ou igual ao primeiro.");
  assert.equal(schemas.saveSimulatedAudienceSchema.safeParse({ extra: 300, sessionId, vary: { ...VARIA, direction: "lado" } }).success, false);
  const regras = schemas.simulationRulesSchema.safeParse({ countRule: { base: 300, mode: "fixed", peak: 300, vary: VARIA } });
  assert.deepEqual(regras.data.countRule.vary, VARIA);
});

test("o formulario: os erros de cada campo, a frase de exemplo e o Aplicar com o campo do numero vazio", () => {
  const ligado = audience.audienceVaryFormOf(VARIA);
  assert.deepEqual(ligado, { direction: "both", everyMax: "60", everyMin: "20", on: true, percent: "5" });
  const desligado = audience.audienceVaryFormOf(null);
  assert.deepEqual(desligado, { direction: "both", everyMax: "60", everyMin: "20", on: false, percent: "5" }, "desligado, com o padrao pronto para ligar");
  assert.deepEqual(audience.audienceVaryOfForm(desligado), { errors: {}, valid: true, vary: null });
  assert.deepEqual(audience.audienceVaryOfForm(ligado), { errors: {}, valid: true, vary: VARIA });
  assert.deepEqual(audience.audienceVaryOfForm({ ...ligado, everyMax: "10", percent: "80" }).errors, { everyMax: "O segundo número precisa ser maior ou igual ao primeiro.", percent: "Use de 1 a 50%." });
  assert.deepEqual(audience.audienceVaryOfForm({ ...ligado, everyMin: "", everyMax: "abc" }).errors, { everyMax: "Use de 5 a 600 segundos.", everyMin: "Use de 5 a 600 segundos." });

  assert.equal(audience.audienceVaryExample(300, ligado), "Com +300 e 5%, o número fica entre 285 e 315. Muda a cada 20 a 60 s, em horas sorteadas.");
  assert.equal(audience.audienceVaryExample(300, { ...ligado, direction: "up" }), "Com +300 e 5%, o número fica entre 300 e 315. Muda a cada 20 a 60 s, em horas sorteadas.");
  assert.equal(audience.audienceVaryExample(1500, { ...ligado, direction: "down", everyMax: "30", everyMin: "30", percent: "10" }), "Com +1.500 e 10%, o número fica entre 1.350 e 1.500. Muda a cada 30 s.");
  assert.equal(audience.audienceVaryExample(null, ligado), COPY.variar.exemploSemNumero);
  assert.equal(audience.audienceVaryExample(300, desligado), null);
  assert.equal(audience.audienceVaryExample(300, { ...ligado, percent: "" }), null, "com erro, o erro ja aparece");
  assert.equal(audience.audienceVaryLabel(VARIA), "Varia sozinho até 5%, para mais e para menos, a cada 20 a 60 s.");
  assert.equal(audience.audienceVaryLabel(null), null);

  const estado = (extra) => audience.audienceFormState({ busy: false, canPublish: true, current: fixa(300), pendingMigration: false, phase: "on_air", text: "", ...extra });
  // Como antes: sem a variacao, o campo vazio nao aplica e o mesmo numero avisa.
  assert.deepEqual([estado({}).canApply, estado({}).applyExtra, estado({ text: "300" }).same, estado({ text: "300" }).canApply], [false, 300, true, false]);
  assert.deepEqual([estado({ text: "500" }).canApply, estado({ text: "500" }).vary], [true, null]);
  // Ligar a variacao no numero de agora, sem digitar de novo.
  const liga = estado({ vary: ligado });
  assert.deepEqual([liga.canApply, liga.applyExtra, liga.vary, liga.same], [true, 300, VARIA, false]);
  // O mesmo numero digitado com a variacao nova tambem aplica.
  assert.equal(estado({ text: "300", vary: ligado }).canApply, true);
  // Com erro nos campos, nao aplica.
  const comErro = estado({ text: "400", vary: { ...ligado, percent: "0" } });
  assert.deepEqual([comErro.canApply, comErro.varyErrors.percent], [false, "Use de 1 a 50%."]);
  // Ja variando: o mesmo de agora avisa; mudar o percentual aplica; desligar aplica (volta ao numero parado).
  const variando = (extra) => audience.audienceFormState({ busy: false, canPublish: true, current: fixa(300, VARIA), pendingMigration: false, phase: "on_air", text: "", vary: ligado, ...extra });
  assert.deepEqual([variando({}).canApply, variando({ text: "300" }).same], [false, true]);
  assert.equal(variando({ vary: { ...ligado, percent: "8" } }).canApply, true);
  const desliga = variando({ vary: desligado });
  assert.deepEqual([desliga.canApply, desliga.applyExtra, desliga.vary], [true, 300, null]);
  // Com o +0 a variacao nao vale.
  assert.deepEqual([variando({ text: "0" }).vary, variando({ text: "0" }).canApply], [null, true]);
  // Sem numero somado e com o campo vazio, nao ha o que variar.
  const semNumero = audience.audienceFormState({ busy: false, canPublish: true, current: base.defaultSimulatedCountRule(), pendingMigration: false, phase: "before", text: "", vary: ligado });
  assert.deepEqual([semNumero.canApply, semNumero.applyExtra], [false, null]);
  // Sessao encerrada, sem permissao ou sem a migracao: nunca.
  assert.equal(audience.audienceFormState({ busy: false, canPublish: true, current: fixa(300), pendingMigration: false, phase: "ended", text: "", vary: ligado }).canApply, false);
  assert.equal(audience.audienceFormState({ busy: false, canPublish: false, current: fixa(300), pendingMigration: false, phase: "on_air", text: "", vary: ligado }).canApply, false);

  assert.equal(audience.audienceChangeValue({ extra: 300, vary: VARIA }), "+300, varia até 5%");
  assert.equal(audience.audienceChangeValue({ extra: 300 }), "+300");
  assert.equal(audience.audienceChangeValue({ extra: 0, vary: VARIA }), "+0");
  assert.equal(audience.audienceChangeValue({ extra: null }), "—");
});

test("o card do editor antes do comeco: o numero fixo com a variacao vira a regra; os erros ficam junto dos campos", () => {
  const form = card.simulationFormOf({ countRule: fixa(300, VARIA), joins: base.defaultSimulatedJoins(), saleNotices: base.defaultSimulatedSaleNotices() }, false);
  assert.deepEqual(form.vary, { direction: "both", everyMax: "60", everyMin: "20", on: true, percent: "5" });
  assert.deepEqual(card.simulationRulesOfForm(form).rules.countRule, { base: 300, jitter: 0, mode: "fixed", peak: 300, vary: VARIA });
  assert.equal(card.simulationFormChanged(form, card.savedSimulationRules({ countRule: fixa(300, VARIA), joins: base.defaultSimulatedJoins(), saleNotices: base.defaultSimulatedSaleNotices() }, false)), false);
  assert.equal(card.simulationFormChanged({ ...form, vary: { ...form.vary, percent: "8" } }, card.savedSimulationRules({ countRule: fixa(300, VARIA), joins: base.defaultSimulatedJoins(), saleNotices: base.defaultSimulatedSaleNotices() }, false)), true, "mudar o percentual conta como mudanca");

  const comErro = card.simulationRulesOfForm({ ...form, vary: { ...form.vary, everyMin: "2", percent: "70" } });
  assert.equal(comErro.rules, null);
  assert.deepEqual(comErro.errors, { varyEveryMin: "Use de 5 a 600 segundos.", varyPercent: "Use de 1 a 50%." });
  // Desligada, com o +0 ou fora do numero fixo, a variacao nao entra (nem e conferida).
  assert.equal(card.simulationRulesOfForm({ ...form, vary: { ...form.vary, on: false } }).rules.countRule.vary, undefined);
  assert.equal(card.simulationRulesOfForm({ ...form, base: "0", vary: { ...form.vary, percent: "70" } }).rules.countRule.vary, undefined);
  assert.equal(card.simulationRulesOfForm({ ...form, countMode: "curve", peak: "400" }).rules.countRule.vary, undefined);
  // O formulario de antes (sem a chave) continua valendo.
  const antigo = { ...form };
  delete antigo.vary;
  assert.deepEqual(card.simulationRulesOfForm(antigo).rules.countRule, { base: 300, jitter: 0, mode: "fixed", peak: 300 });
});

test("a tela: a caixa Variar sozinho, os campos, o exemplo e a variacao de agora debaixo do numero", () => {
  const campos = (form, extra = {}) =>
    renderToStaticMarkup(createElement(SimulationVaryFields, { disabled: false, errors: {}, example: audience.audienceVaryExample(300, form), form, idBase: "teste", onChange() {}, ...extra }));
  const fechado = campos(audience.audienceVaryFormOf(null));
  assert.match(fechado, /data-simulation-vary="off"/);
  assert.match(textOf(fechado), /Variar sozinho/);
  assert.doesNotMatch(fechado, /data-simulation-vary-fields/, "desligada, so a caixa");
  assert.doesNotMatch(fechado, / checked=""/);

  const aberto = campos(audience.audienceVaryFormOf(VARIA));
  assert.match(aberto, /data-simulation-vary="on"/);
  assert.match(aberto, /<input[^>]*checked=""[^>]*id="teste-variar"|<input[^>]*id="teste-variar"[^>]*checked=""/);
  const texto = textOf(aberto);
  for (const frase of ["Varia até (%)", "Muda a cada (segundos)", "Para mais e para menos", "Só para mais", "Só para menos", "Com +300 e 5%, o número fica entre 285 e 315."]) {
    assert.ok(texto.includes(frase), frase);
  }
  // Uma linha por regra, o nome a esquerda e o campo a direita com a mesma largura (teste do produtor de 12/11/2026,
  // docs/30 D92: os tres campos lado a lado ficavam desalinhados no painel). Os dois numeros do "Muda a cada" ficam
  // num grupo com o nome dele, cada um com o rotulo proprio para o leitor de tela.
  assert.equal((aberto.match(/<div class="w-20[^"]*">\s*<input/g) ?? []).length, 3, "os tres campos com a mesma largura");
  assert.match(aberto, /role="group"/);
  assert.match(aberto, /<label class="sr-only" for="teste-variar-de">Muda a cada, de \(segundos\)<\/label>/);
  assert.match(aberto, /<label class="sr-only" for="teste-variar-ate">Muda a cada, até \(segundos\)<\/label>/);
  assert.match(aberto, /<label[^>]*for="teste-variar-percentual"[^>]*>Varia até \(%\)<\/label>/);
  assert.match(aberto, /id="teste-variar-percentual"[^>]*value="5"|value="5"[^>]*id="teste-variar-percentual"/);
  assert.equal((aberto.match(/type="radio"/g) ?? []).length, 3, "tres direcoes");
  assert.match(aberto, /aria-live="polite"[^>]*data-simulation-vary-example|data-simulation-vary-example=""[^>]*aria-live="polite"/);

  const comErro = campos(audience.audienceVaryFormOf(VARIA), { errors: { percent: "Use de 1 a 50%." }, example: null });
  assert.match(comErro, /aria-invalid="true"/);
  assert.ok(textOf(comErro).includes("Use de 1 a 50%."));
  assert.doesNotMatch(comErro, /data-simulation-vary-example/);

  // O controle inteiro: a variacao de agora debaixo do numero, a caixa ja ligada e a mudanca com "varia até 5%".
  const controle = renderToStaticMarkup(
    createElement(SimulationAudienceControl, {
      audience: {
        changes: [{ atMs: 12 * MIN, changedAt: "2026-11-12T23:30:00.000Z", changedByName: "Produtora de Teste", extra: 300, id: "c1", source: "console", vary: VARIA }],
        current: fixa(300, VARIA),
        flags: { badgeOn: false, joinsSimulated: false, saleNoticesSimulated: false },
        pendingMigration: false,
        rampEndsAtMs: null
      },
      busy: false,
      canPublish: true,
      idBase: "console",
      offsetMs: 20 * MIN,
      async onApply() {
        return true;
      },
      phase: "on_air"
    })
  );
  assert.match(controle, /data-simulation-audience-vary=""[^>]*>Varia sozinho até 5%, para mais e para menos, a cada 20 a 60 s\.</);
  assert.match(controle, /data-simulation-vary="on"/);
  assert.ok(textOf(controle).includes("12:00 · +300, varia até 5% · Produtora de Teste"));
  assert.match(controle, /data-simulation-audience-apply=""[^>]*disabled=""|disabled=""[^>]*data-simulation-audience-apply=""/, "nada mudou ainda: o Aplicar desligado");
  // Nenhuma frase da interface com a palavra proibida, e tudo com acento.
  assert.doesNotMatch(JSON.stringify(COPY.variar), /personagem/i);

  // Sem permissao, o numero e a variacao de agora aparecem; os campos nao.
  const semPermissao = renderToStaticMarkup(
    createElement(SimulationAudienceControl, {
      audience: { changes: [], current: fixa(300, VARIA), flags: { badgeOn: false, joinsSimulated: false, saleNoticesSimulated: false }, pendingMigration: false, rampEndsAtMs: null },
      busy: false,
      canPublish: false,
      idBase: "console",
      offsetMs: 20 * MIN,
      async onApply() {
        return true;
      },
      phase: "on_air"
    })
  );
  assert.match(semPermissao, /data-simulation-audience-vary/);
  assert.doesNotMatch(semPermissao, /data-simulation-vary=/);
});

test("o relatorio (D80): a mudanca com a variacao diz o percentual, o lado e o intervalo junto do numero", () => {
  assert.equal(report.simulationChangeValue({ extra: 300, vary: VARIA }), "+300, variando até 5% para mais e para menos, a cada 20 a 60 s");
  assert.equal(report.simulationChangeValue({ extra: 300, vary: { ...VARIA, direction: "up", everyMaxSeconds: 30, everyMinSeconds: 30 } }), "+300, variando até 5% só para mais, a cada 30 s");
  assert.equal(report.simulationChangeValue({ extra: 300 }), "+300");
  assert.equal(report.simulationChangeValue({ extra: 0, vary: VARIA }), "+0");
  assert.equal(report.simulationChangeValue({ extra: null }), "faixa que varia");
});
