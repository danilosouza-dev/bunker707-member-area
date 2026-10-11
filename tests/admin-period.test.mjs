import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Modelo do periodo global do admin (src/components/admin/v2/period.ts, docs/17 §1.4):
// Hoje · 1d · 3d · 7d · 30d ou um intervalo do calendario, no endereco ?periodo=, sempre no fuso
// da escola (America/Sao_Paulo). period.ts importa "./filters" e "./format" sem extensao, entao o
// hook de resolucao entra antes e o modulo e carregado com import() dinamico.
await import("./support/resolve-extensionless-ts.mjs");
const period = await import("../src/components/admin/v2/period.ts");

const periodPath = fileURLToPath(new URL("../src/components/admin/v2/period.ts", import.meta.url));
const loaderUrl = new URL("./support/resolve-extensionless-ts.mjs", import.meta.url).href;
const periodUrl = new URL("../src/components/admin/v2/period.ts", import.meta.url).href;

// Domingo, 11/10/2026, 15:37:12,345 em Sao Paulo (UTC-3, sem horario de verao desde 2019).
const NOW = new Date("2026-10-11T18:37:12.345Z");
const iso = (date) => date.toISOString();
const resolve = (value, now = NOW) => period.resolveAdminPeriod(period.parseAdminPeriodParam(value, now), now);
const keys = (buckets) => buckets.map((bucket) => bucket.key);

test("o modulo e puro: sem React, sem 'use client' e com o fuso da escola", async () => {
  const source = await readFile(periodPath, "utf8");

  assert.doesNotMatch(source, /from "react"/);
  assert.doesNotMatch(source, /^\s*["']use client["']/m, "sem a diretiva use client");
  assert.match(source, /ADMIN_TIME_ZONE/);
  assert.deepEqual([...period.ADMIN_PERIOD_PRESETS], ["hoje", "1d", "3d", "7d", "30d"]);
  assert.equal(period.DEFAULT_ADMIN_PERIOD_PRESET, "30d");
  assert.deepEqual(
    period.ADMIN_PERIOD_PRESET_OPTIONS.map((option) => [option.preset, option.label, option.shortLabel]),
    [
      ["hoje", "Hoje", "Hoje"],
      ["1d", "Últimas 24 horas", "1d"],
      ["3d", "Últimos 3 dias", "3d"],
      ["7d", "Últimos 7 dias", "7d"],
      ["30d", "Últimos 30 dias", "30d"]
    ]
  );
});

test("presets: leitura do endereco aceita caixa, espacos e valor repetido", () => {
  for (const preset of period.ADMIN_PERIOD_PRESETS) {
    assert.deepEqual(period.parseAdminPeriodParam(preset, NOW), { kind: "preset", preset });
  }

  assert.deepEqual(period.parseAdminPeriodParam(" 7D ", NOW), { kind: "preset", preset: "7d" });
  assert.deepEqual(period.parseAdminPeriodParam("HOJE", NOW), { kind: "preset", preset: "hoje" });
  assert.deepEqual(period.parseAdminPeriodParam(["3d", "30d"], NOW), { kind: "preset", preset: "3d" }, "vale o primeiro");
  assert.deepEqual(period.parseAdminPeriodParam(undefined, NOW), period.DEFAULT_ADMIN_PERIOD_VALUE);
  assert.deepEqual(period.parseAdminPeriodParam(null, NOW), period.DEFAULT_ADMIN_PERIOD_VALUE);
  assert.deepEqual(period.parseAdminPeriodParam([], NOW), period.DEFAULT_ADMIN_PERIOD_VALUE);
});

test("compatibilidade com os links antigos 7 | 30 | 90", () => {
  assert.deepEqual(period.parseAdminPeriodParam("7", NOW), { kind: "preset", preset: "7d" });
  assert.deepEqual(period.parseAdminPeriodParam("30", NOW), { kind: "preset", preset: "30d" });
  assert.deepEqual(period.parseAdminPeriodParam("90", NOW), { from: "2026-07-14", kind: "range", to: "2026-10-11" });

  const ninety = resolve("90");
  assert.equal(ninety.days, 90);
  assert.equal(ninety.param, "2026-07-14..2026-10-11");
  assert.equal(ninety.endsNow, true);
  assert.equal(ninety.granularity, "day");
  assert.equal(iso(ninety.end), iso(NOW));
  assert.equal(ninety.label, "14 de jul. a 11 de out. de 2026");
  assert.equal(ninety.comparisonLabel, "vs. 90 dias anteriores");
  assert.equal(period.listAdminPeriodBuckets(ninety).length, 90);
});

test("valores invalidos caem no padrao (30d) sem erro; a leitura estrita devolve null", () => {
  const invalid = [
    "",
    "   ",
    "15",
    "60",
    "0",
    "-7",
    "7dd",
    "d7",
    "abc",
    "2d",
    "90d",
    "2026-13-01",
    "2026-02-29",
    "2026-10-32",
    "26-10-01",
    "2026-10-01..",
    "..2026-10-01",
    "2026-10-01...2026-10-02",
    "2026-10-01..2026-10-02..2026-10-03",
    "2026-10-10..2026-10-01",
    "2019-12-31..2020-01-05",
    "2026-10-11..2026-10-12",
    "2025-01-01..2026-10-11",
    "2026-10-01/2026-10-10",
    "<script>"
  ];

  for (const value of invalid) {
    assert.equal(period.parseAdminPeriodParamStrict(value, NOW), null, `estrito: ${JSON.stringify(value)}`);
    assert.deepEqual(period.parseAdminPeriodParam(value, NOW), period.DEFAULT_ADMIN_PERIOD_VALUE, `padrao: ${JSON.stringify(value)}`);
  }

  assert.equal(period.parseAdminPeriodParamStrict(undefined, NOW), null, "ausente: estrito diz que nao ha periodo");
});

test("intervalos: um dia so, datas inclusivas e escrita canonica com ..", () => {
  assert.deepEqual(period.parseAdminPeriodParam("2026-10-05", NOW), { from: "2026-10-05", kind: "range", to: "2026-10-05" });
  assert.deepEqual(period.parseAdminPeriodParam("2026-10-01..2026-10-10", NOW), {
    from: "2026-10-01",
    kind: "range",
    to: "2026-10-10"
  });
  assert.equal(period.formatAdminPeriodParam({ from: "2026-10-05", kind: "range", to: "2026-10-05" }), "2026-10-05..2026-10-05");
  assert.equal(period.formatAdminPeriodParam({ kind: "preset", preset: "hoje" }), "hoje");
  assert.equal(
    period.isSameAdminPeriod({ from: "2026-10-01", kind: "range", to: "2026-10-10" }, period.parseAdminPeriodParam("2026-10-01..2026-10-10", NOW)),
    true
  );
  assert.equal(period.isSameAdminPeriod({ kind: "preset", preset: "7d" }, { kind: "preset", preset: "30d" }), false);
  assert.equal(period.isDefaultAdminPeriod({ kind: "preset", preset: "30d" }), true);
  assert.equal(period.isDefaultAdminPeriod({ from: "2026-09-12", kind: "range", to: "2026-10-11" }), false, "intervalo igual ao 30d nao e o padrao");
});

test("validacao do calendario: motivo e frase de cada problema", () => {
  const check = (from, to) => period.validateAdminPeriodRange(from, to, NOW);

  assert.deepEqual(check("2026-10-01", "2026-10-10"), {
    days: 10,
    ok: true,
    period: { from: "2026-10-01", kind: "range", to: "2026-10-10" }
  });
  assert.equal(check("2026-10-11", "2026-10-11").ok, true, "hoje pode ser a data final");
  assert.equal(check("2020-01-01", "2020-12-31").ok, true, "primeiro dia oferecido e ano bissexto inteiro");

  const cases = [
    [null, "2026-10-10", "invalid", "Escolha a data inicial e a final."],
    ["2026-10-01", undefined, "invalid", "Escolha a data inicial e a final."],
    ["2026-02-30", "2026-03-01", "invalid", "Escolha a data inicial e a final."],
    ["2026-10-10", "2026-10-01", "inverted", "A data final precisa ser igual ou depois da inicial."],
    ["2019-12-31", "2020-01-10", "before-min", "Escolha datas a partir de janeiro de 2020."],
    ["2026-10-01", "2026-10-12", "future", "Escolha datas até hoje."],
    ["2025-10-10", "2026-10-11", "too-long", "Escolha no máximo 366 dias."]
  ];

  for (const [from, to, reason, message] of cases) {
    assert.deepEqual(check(from, to), { message, ok: false, reason }, `${from}..${to}`);
  }

  assert.equal(check("2025-10-11", "2026-10-11").ok, true, "366 dias contando as pontas ainda cabe");
});

test("hoje: desde 00:00 de Sao Paulo ate agora, comparado com ontem ate a mesma hora", () => {
  const today = resolve("hoje");

  assert.equal(today.param, "hoje");
  assert.equal(today.isDefault, false);
  assert.equal(iso(today.start), "2026-10-11T03:00:00.000Z");
  assert.equal(iso(today.end), iso(NOW));
  assert.equal(today.from, "2026-10-11");
  assert.equal(today.to, "2026-10-11");
  assert.equal(today.days, 1);
  assert.equal(today.endsNow, true);
  assert.equal(today.granularity, "hour");
  assert.equal(today.label, "Hoje");
  assert.equal(today.shortLabel, "Hoje");
  assert.equal(today.inlineLabel, "hoje");
  assert.equal(today.accessibleLabel, "Hoje");
  assert.equal(today.comparisonLabel, "vs. ontem até a mesma hora");
  assert.equal(iso(today.previous.start), "2026-10-10T03:00:00.000Z");
  assert.equal(iso(today.previous.end), "2026-10-10T18:37:12.345Z");
  assert.equal(today.previous.from, "2026-10-10");
  assert.equal(today.previous.to, "2026-10-10");
  assert.equal(today.previousLabel, "10 de out. de 2026");

  const buckets = period.listAdminPeriodBuckets(today);
  const previous = period.listAdminPeriodBuckets(today, "previous");
  assert.equal(buckets.length, 16, "0h a 15h");
  assert.equal(previous.length, buckets.length, "o periodo anterior tem um ponto para cada ponto");
  assert.equal(buckets[0].key, "2026-10-11T00");
  assert.equal(buckets[0].label, "0h");
  assert.equal(iso(buckets[0].start), "2026-10-11T03:00:00.000Z");
  assert.equal(buckets.at(-1).key, "2026-10-11T15");
  assert.equal(buckets.at(-1).longLabel, "Domingo, 11 de outubro, 15h");
  assert.equal(previous[0].key, "2026-10-10T00");
  assert.equal(previous.at(-1).longLabel, "Sábado, 10 de outubro, 15h");
});

test("1d: as ultimas 24 horas corridas, por hora, comparadas com as 24 horas anteriores", () => {
  const day = resolve("1d");

  assert.equal(iso(day.start), "2026-10-10T18:37:12.345Z");
  assert.equal(iso(day.end), iso(NOW));
  assert.equal(day.from, "2026-10-10");
  assert.equal(day.to, "2026-10-11");
  assert.equal(day.days, 1);
  assert.equal(day.granularity, "hour");
  assert.equal(day.label, "Últimas 24 horas");
  assert.equal(day.shortLabel, "1d");
  assert.equal(day.inlineLabel, "nas últimas 24 horas");
  assert.equal(day.comparisonLabel, "vs. 24 horas anteriores");
  assert.equal(iso(day.previous.start), "2026-10-09T18:37:12.345Z");
  assert.equal(iso(day.previous.end), "2026-10-10T18:37:12.345Z");
  assert.equal(day.previousLabel, "9 a 10 de out. de 2026");

  const buckets = period.listAdminPeriodBuckets(day);
  assert.equal(buckets.length, 25, "a hora de inicio (15h de ontem) ate a hora em curso (15h de hoje)");
  assert.equal(buckets[0].label, "10/10 15h");
  assert.equal(buckets.at(-1).label, "11/10 15h");
  assert.equal(period.listAdminPeriodBuckets(day, "previous").length, 25);
});

test("3d, 7d e 30d: dias de calendario terminando hoje, periodo anterior cortado na mesma hora", () => {
  const three = resolve("3d");
  assert.equal(iso(three.start), "2026-10-09T03:00:00.000Z");
  assert.equal(three.from, "2026-10-09");
  assert.equal(three.days, 3);
  assert.equal(three.granularity, "hour", "ate 3 dias o grafico e por hora");
  assert.equal(period.listAdminPeriodBuckets(three).length, 64, "48 horas inteiras + 16 de hoje");
  assert.ok(period.listAdminPeriodBuckets(three).length <= 72);
  assert.equal(three.previous.from, "2026-10-06");
  assert.equal(three.previous.to, "2026-10-08");
  assert.equal(iso(three.previous.end), "2026-10-08T18:37:12.345Z");
  assert.equal(three.previousLabel, "6 a 8 de out. de 2026");

  const seven = resolve("7d");
  assert.equal(seven.from, "2026-10-05");
  assert.equal(seven.to, "2026-10-11");
  assert.equal(seven.granularity, "day");
  assert.equal(seven.label, "Últimos 7 dias");
  assert.equal(seven.inlineLabel, "nos últimos 7 dias");
  assert.equal(seven.comparisonLabel, "vs. 7 dias anteriores");
  assert.deepEqual(keys(period.listAdminPeriodBuckets(seven)), [
    "2026-10-05",
    "2026-10-06",
    "2026-10-07",
    "2026-10-08",
    "2026-10-09",
    "2026-10-10",
    "2026-10-11"
  ]);
  assert.equal(seven.previous.from, "2026-09-28");
  assert.equal(seven.previous.to, "2026-10-04");
  assert.equal(iso(seven.previous.start), "2026-09-28T03:00:00.000Z");
  assert.equal(iso(seven.previous.end), "2026-10-04T18:37:12.345Z");
  assert.equal(seven.previousLabel, "28 de set. a 4 de out. de 2026");
  assert.deepEqual(
    period.listAdminPeriodBuckets(seven, "previous").map((bucket) => bucket.label),
    ["28/09", "29/09", "30/09", "01/10", "02/10", "03/10", "04/10"],
    "virada de mes no eixo"
  );

  const thirty = resolve(undefined);
  assert.equal(thirty.param, "30d");
  assert.equal(thirty.isDefault, true);
  assert.equal(thirty.from, "2026-09-12");
  assert.equal(thirty.days, 30);
  assert.equal(period.listAdminPeriodBuckets(thirty).length, 30);
  assert.equal(thirty.previous.from, "2026-08-13");
  assert.equal(thirty.previous.to, "2026-09-11");
});

test("intervalo fechado no passado: de 00:00 da data inicial ate 24:00 da final", () => {
  const range = resolve("2026-10-01..2026-10-10");

  assert.equal(range.param, "2026-10-01..2026-10-10");
  assert.equal(iso(range.start), "2026-10-01T03:00:00.000Z");
  assert.equal(iso(range.end), "2026-10-11T03:00:00.000Z");
  assert.equal(range.endsNow, false);
  assert.equal(range.days, 10);
  assert.equal(range.granularity, "day");
  assert.equal(range.label, "1 a 10 de out. de 2026");
  assert.equal(range.shortLabel, "1–10 out.");
  assert.equal(range.inlineLabel, "de 1 a 10 de out. de 2026");
  assert.equal(range.accessibleLabel, "1 a 10 de outubro de 2026");
  assert.equal(range.comparisonLabel, "vs. 10 dias anteriores");
  assert.equal(range.previous.from, "2026-09-21");
  assert.equal(range.previous.to, "2026-09-30");
  assert.equal(iso(range.previous.start), "2026-09-21T03:00:00.000Z");
  assert.equal(iso(range.previous.end), "2026-10-01T03:00:00.000Z", "o anterior encosta no inicio do atual");
  assert.equal(range.previousLabel, "21 a 30 de set. de 2026");
  assert.equal(period.listAdminPeriodBuckets(range).at(-1).longLabel, "Sábado, 10 de outubro");

  const single = resolve("2026-10-05");
  assert.equal(single.days, 1);
  assert.equal(single.granularity, "hour");
  assert.equal(single.label, "5 de out. de 2026");
  assert.equal(single.shortLabel, "5 out.");
  assert.equal(single.inlineLabel, "em 5 de out. de 2026");
  assert.equal(single.comparisonLabel, "vs. dia anterior");
  assert.equal(iso(single.end), "2026-10-06T03:00:00.000Z");
  const hours = period.listAdminPeriodBuckets(single);
  assert.equal(hours.length, 24);
  assert.deepEqual([hours[0].label, hours.at(-1).label], ["0h", "23h"]);
  assert.equal(hours.at(-1).longLabel, "Segunda-feira, 5 de outubro, 23h");
  assert.equal(single.previousLabel, "4 de out. de 2026");

  const threeDays = resolve("2026-10-01..2026-10-03");
  assert.equal(threeDays.granularity, "hour");
  assert.equal(period.listAdminPeriodBuckets(threeDays).length, 72, "teto de 72 pontos por hora");
  assert.equal(resolve("2026-10-01..2026-10-04").granularity, "day", "4 dias ja e por dia");
});

test("intervalo que termina hoje vai ate agora e compara ate a mesma hora", () => {
  const range = resolve("2026-09-28..2026-10-11");

  assert.equal(range.endsNow, true);
  assert.equal(iso(range.end), iso(NOW));
  assert.equal(range.days, 14);
  assert.equal(range.shortLabel, "28 set.–11 out.");
  assert.equal(range.label, "28 de set. a 11 de out. de 2026");
  assert.equal(range.previous.from, "2026-09-14");
  assert.equal(range.previous.to, "2026-09-27");
  assert.equal(iso(range.previous.end), "2026-09-27T18:37:12.345Z");
  assert.equal(period.listAdminPeriodBuckets(range).length, 14);
  assert.equal(period.listAdminPeriodBuckets(range, "previous").length, 14);
});

test("fuso: o dia vira a meia-noite de Sao Paulo, nao a de Greenwich", () => {
  const lateEvening = new Date("2026-10-11T02:30:00.000Z"); // 23:30 de sabado, 10/10, em Sao Paulo
  const midnight = new Date("2026-10-11T03:00:00.000Z"); // 00:00 de domingo, 11/10

  assert.equal(period.getAdminToday(lateEvening), "2026-10-10");
  assert.equal(period.getAdminCivilDate(lateEvening), "2026-10-10");
  assert.equal(period.getAdminToday(midnight), "2026-10-11");
  assert.equal(iso(period.startOfAdminDay("2026-10-11")), "2026-10-11T03:00:00.000Z");
  assert.equal(period.getAdminBucketKey(lateEvening, "day"), "2026-10-10");
  assert.equal(period.getAdminBucketKey(lateEvening, "hour"), "2026-10-10T23");
  assert.equal(period.getAdminBucketKey(midnight, "hour"), "2026-10-11T00");

  const evening = resolve("hoje", lateEvening);
  assert.equal(iso(evening.start), "2026-10-10T03:00:00.000Z");
  assert.equal(period.listAdminPeriodBuckets(evening).length, 24);

  const atMidnight = resolve("hoje", midnight);
  assert.equal(iso(atMidnight.start), iso(midnight));
  assert.equal(iso(atMidnight.end), iso(midnight), "a meia-noite o periodo ainda nao tem duracao");
  assert.equal(period.listAdminPeriodBuckets(atMidnight).length, 1, "um ponto, a hora em curso");

  assert.equal(
    period.validateAdminPeriodRange("2026-10-11", "2026-10-11", lateEvening).reason,
    "future",
    "as 23:30 de sabado, domingo ainda e futuro"
  );
});

test("virada de mes e de ano nos rotulos e nos baldes", () => {
  const march = new Date("2026-03-01T15:00:00.000Z");
  const thirty = resolve("30d", march);
  assert.equal(thirty.from, "2026-01-31", "fevereiro de 2026 tem 28 dias");
  assert.equal(thirty.previous.from, "2026-01-01");
  assert.equal(thirty.previous.to, "2026-01-30");

  const newYear = resolve("2025-12-28..2026-01-03");
  assert.equal(newYear.label, "28 de dez. de 2025 a 3 de jan. de 2026");
  assert.equal(newYear.shortLabel, "28 dez. 2025–3 jan. 2026");
  assert.equal(newYear.previousLabel, "21 a 27 de dez. de 2025");
  const buckets = period.listAdminPeriodBuckets(newYear);
  assert.deepEqual(
    buckets.map((bucket) => bucket.label),
    ["28/12", "29/12", "30/12", "31/12", "01/01", "02/01", "03/01"]
  );
  assert.equal(buckets[0].longLabel, "Domingo, 28 de dezembro de 2025", "periodo entre anos escreve o ano na dica");
  assert.equal(buckets.at(-1).longLabel, "Sábado, 3 de janeiro de 2026");

  const lastYear = resolve("2025-10-01..2025-10-10");
  assert.equal(lastYear.shortLabel, "1–10 out. 2025", "ano diferente do atual aparece no botao");
  assert.equal(resolve("2025-11-28..2025-12-02").shortLabel, "28 nov.–2 dez. 2025");

  assert.equal(period.formatAdminDateRange("2026-09-28", "2026-10-04"), "28 de set. a 4 de out. de 2026");
  assert.equal(period.formatAdminDateRange("2026-10-05", "2026-10-05", { month: "long" }), "5 de outubro de 2026");
  assert.equal(period.formatAdminDayCount(1), "1 dia");
  assert.equal(period.formatAdminDayCount(10), "10 dias");
});

test("ano bissexto: 29 de fevereiro existe so quando deve", () => {
  assert.equal(period.isCivilDate("2024-02-29"), true);
  assert.equal(period.isCivilDate("2000-02-29"), true);
  assert.equal(period.isCivilDate("2026-02-29"), false);
  assert.equal(period.isCivilDate("2100-02-29"), false);
  assert.equal(period.isCivilDate("2026-04-31"), false);
  assert.equal(period.isCivilDate("0000-01-01"), false);
  assert.equal(period.isCivilDate(20261011), false);
  assert.equal(period.addCivilDays("2024-02-28", 1), "2024-02-29");
  assert.equal(period.addCivilDays("2024-02-29", 1), "2024-03-01");
  assert.equal(period.addCivilDays("2026-02-28", 1), "2026-03-01");
  assert.equal(period.addCivilDays("2026-01-01", -1), "2025-12-31");
  assert.equal(period.countCivilDays("2024-01-01", "2024-12-31"), 366);
  assert.equal(period.countCivilDays("2026-01-01", "2026-12-31"), 365);
  assert.equal(period.diffCivilDays("2026-10-10", "2026-10-01"), -9);
  assert.equal(period.addCivilMonths("2026-01-31", 1), "2026-02-01", "sempre o primeiro dia do mes");
  assert.equal(period.addCivilMonths("2026-01-15", -1), "2025-12-01");

  const leapWeek = resolve("7d", new Date("2024-03-02T15:00:00.000Z"));
  assert.deepEqual(keys(period.listAdminPeriodBuckets(leapWeek)), [
    "2024-02-25",
    "2024-02-26",
    "2024-02-27",
    "2024-02-28",
    "2024-02-29",
    "2024-03-01",
    "2024-03-02"
  ]);

  assert.equal(period.validateAdminPeriodRange("2024-01-01", "2024-12-31", NOW).ok, true, "ano bissexto inteiro: 366 dias");
  assert.equal(period.validateAdminPeriodRange("2023-01-01", "2024-01-01", NOW).ok, true, "365 + 1 = 366");
  assert.equal(period.validateAdminPeriodRange("2023-01-01", "2024-01-02", NOW).reason, "too-long");
  assert.equal(period.parseAdminPeriodParamStrict("2024-02-29", NOW)?.kind, "range");
  assert.equal(period.parseAdminPeriodParamStrict("2025-02-29", NOW), null);
});

test("endereco: troca o periodo mantendo ?produto= e os outros filtros, sem ?pagina=", () => {
  const range = { from: "2026-10-01", kind: "range", to: "2026-10-10" };

  assert.equal(
    period.buildAdminPeriodHref("/admin", "produto=abc&periodo=7&pagina=3", range),
    "/admin?produto=abc&periodo=2026-10-01..2026-10-10"
  );
  assert.equal(
    period.buildAdminPeriodHref("/admin", new URLSearchParams({ periodo: "7d", produto: "abc" }), period.DEFAULT_ADMIN_PERIOD_VALUE),
    "/admin?produto=abc",
    "o padrao some do endereco"
  );
  assert.equal(
    period.buildAdminPeriodHref("/admin", { aula: undefined, periodo: ["30d", "7d"], produto: "abc", tag: ["a", "b"] }, { kind: "preset", preset: "hoje" }),
    "/admin?produto=abc&tag=a&tag=b&periodo=hoje"
  );
  assert.equal(period.buildAdminPeriodHref("/admin/comunicacao", null, { kind: "preset", preset: "1d" }), "/admin/comunicacao?periodo=1d");
  assert.equal(period.buildAdminPeriodHref("/admin", undefined, period.DEFAULT_ADMIN_PERIOD_VALUE), "/admin");
  assert.equal(
    period.buildAdminPeriodHref("/admin/produtos/p1/desempenho", "periodo=2026-10-01..2026-10-10", { kind: "preset", preset: "3d" }),
    "/admin/produtos/p1/desempenho?periodo=3d"
  );

  // O mesmo valor sai de volta pela leitura (ida e volta pelo endereco).
  const href = period.buildAdminPeriodHref("/admin", "produto=abc", range);
  const params = new URL(href, "https://admin.test").searchParams;
  assert.equal(params.get("produto"), "abc");
  assert.deepEqual(period.parseAdminPeriodParam(params.get("periodo"), NOW), range);
});

test("readAdminPeriod le ?periodo= de URLSearchParams ou do searchParams das paginas", () => {
  assert.equal(period.readAdminPeriod(new URLSearchParams("periodo=7d&produto=x"), NOW).param, "7d");
  assert.equal(period.readAdminPeriod({ periodo: ["hoje", "30d"] }, NOW).param, "hoje");
  assert.equal(period.readAdminPeriod({ produto: "x" }, NOW).param, "30d");
  assert.equal(period.readAdminPeriod({ periodo: "lixo" }, NOW).param, "30d");
  assert.equal(period.readAdminPeriod({ periodo: "90" }, NOW).param, "2026-07-14..2026-10-11");
});

test("calendario: limites, mes inicial e atalhos validos", () => {
  assert.deepEqual(period.getAdminPeriodCalendarBounds(NOW), { maxDays: 366, min: "2020-01-01", today: "2026-10-11" });
  assert.equal(period.getAdminCalendarStartMonth("2026-10-10", 2), "2026-09-01", "dois meses terminando no mes da data final");
  assert.equal(period.getAdminCalendarStartMonth("2026-10-10", 1), "2026-10-01");
  assert.equal(period.getAdminCalendarStartMonth("2026-01-10", 2), "2025-12-01");
  assert.equal(period.getAdminCalendarStartMonth("2020-01-15", 2), "2020-01-01", "nunca antes de janeiro de 2020");
  assert.equal(period.getAdminCalendarStartMonth("2026-10-10", 0), "2026-10-01");

  const byId = (now) => Object.fromEntries(period.getAdminPeriodShortcuts(now).map((item) => [item.id, item]));
  const october = byId(NOW);
  assert.deepEqual(
    period.getAdminPeriodShortcuts(NOW).map((item) => item.label),
    ["Este mês", "Mês passado", "Últimos 90 dias", "Este ano"]
  );
  assert.deepEqual(october["este-mes"].period, { from: "2026-10-01", kind: "range", to: "2026-10-11" });
  assert.deepEqual(october["mes-passado"].period, { from: "2026-09-01", kind: "range", to: "2026-09-30" });
  assert.deepEqual(october["90-dias"].period, { from: "2026-07-14", kind: "range", to: "2026-10-11" });
  assert.deepEqual(october["este-ano"].period, { from: "2026-01-01", kind: "range", to: "2026-10-11" });

  assert.deepEqual(byId(new Date("2026-01-15T15:00:00.000Z"))["mes-passado"].period, {
    from: "2025-12-01",
    kind: "range",
    to: "2025-12-31"
  });
  assert.deepEqual(byId(new Date("2024-03-10T15:00:00.000Z"))["mes-passado"].period, {
    from: "2024-02-01",
    kind: "range",
    to: "2024-02-29"
  });

  for (const now of [NOW, new Date("2026-01-01T03:30:00.000Z"), new Date("2024-12-31T23:00:00.000Z")]) {
    for (const shortcut of period.getAdminPeriodShortcuts(now)) {
      assert.equal(
        period.validateAdminPeriodRange(shortcut.period.from, shortcut.period.to, now).ok,
        true,
        `${shortcut.id} em ${now.toISOString()}`
      );
    }
  }
});

test("ponte com o calendario: ida e volta da data sem depender do fuso da maquina", () => {
  for (const civil of ["2026-10-11", "2024-02-29", "2020-01-01", "2026-12-31"]) {
    const date = period.civilDateToPickerDate(civil);
    assert.equal(date.getHours(), 12, "meio-dia local, longe das viradas de dia");
    assert.equal(period.pickerDateToCivilDate(date), civil);
  }

  assert.equal(period.pickerDateToCivilDate(null), null);
  assert.equal(period.pickerDateToCivilDate(undefined), null);
  assert.equal(period.pickerDateToCivilDate(new Date(Number.NaN)), null);
});

test("servidor e navegador em fusos diferentes chegam aos mesmos limites e textos", () => {
  const script = `
    await import(${JSON.stringify(loaderUrl)});
    const p = await import(${JSON.stringify(periodUrl)});
    const now = new Date("2026-10-11T02:30:00.000Z");
    const out = {};
    for (const value of ["hoje", "1d", "3d", "7d", "30d", "2026-10-01..2026-10-10", "90"]) {
      const r = p.resolveAdminPeriod(p.parseAdminPeriodParam(value, now), now);
      out[value] = {
        buckets: p.listAdminPeriodBuckets(r).map((b) => [b.key, b.label, b.longLabel, b.start.toISOString()]),
        end: r.end.toISOString(),
        labels: [r.label, r.shortLabel, r.inlineLabel, r.comparisonLabel, r.previousLabel],
        previous: [r.previous.start.toISOString(), r.previous.end.toISOString()],
        start: r.start.toISOString()
      };
    }
    out.picker = ["2026-10-11", "2024-02-29"].map((c) => p.pickerDateToCivilDate(p.civilDateToPickerDate(c)));
    out.today = p.getAdminToday(now);
    process.stdout.write(JSON.stringify(out));
  `;
  const runIn = (timeZone) => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      env: { ...process.env, TZ: timeZone }
    });

    assert.equal(result.status, 0, `${timeZone}: ${result.stderr}`);
    return JSON.parse(result.stdout);
  };

  const saoPaulo = runIn("America/Sao_Paulo");
  assert.equal(saoPaulo.today, "2026-10-10");
  assert.deepEqual(saoPaulo.picker, ["2026-10-11", "2024-02-29"]);

  for (const timeZone of ["UTC", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Kiritimati"]) {
    assert.deepEqual(runIn(timeZone), saoPaulo, `mesmo resultado com a maquina em ${timeZone}`);
  }
});

test("menu Periodo: 'Tudo' tira o parametro e, com 'Tudo' na tela, o padrao fica escrito", () => {
  const href = period.buildAdminPeriodMenuHref;
  const preset = (value) => ({ kind: "preset", preset: value });

  // Telas sem "Tudo" (Hoje, Desempenho, Comunicacao): igual ao buildAdminPeriodHref.
  assert.equal(href("/admin", "produto=p1&pagina=2", preset("7d")), "/admin?produto=p1&periodo=7d");
  assert.equal(href("/admin", "periodo=7d&produto=p1", preset("30d")), "/admin?produto=p1", "padrao some do endereco");
  assert.equal(
    href("/admin", new URLSearchParams("periodo=hoje"), { from: "2026-10-01", kind: "range", to: "2026-10-10" }),
    "/admin?periodo=2026-10-01..2026-10-10"
  );

  // Telas com "Tudo" (fila da Comunidade): sem ?periodo= = tudo.
  assert.equal(href("/admin/comunidade", "periodo=7d&produto=p1&pagina=4", null, true), "/admin/comunidade?produto=p1");
  assert.equal(href("/admin/comunidade", "", null, true), "/admin/comunidade");
  assert.equal(href("/admin/comunidade", "produto=p1", preset("30d"), true), "/admin/comunidade?produto=p1&periodo=30d");
  assert.equal(href("/admin/comunidade", "", preset("30d"), true), "/admin/comunidade?periodo=30d");
  assert.equal(href("/admin/comunidade", "", preset("hoje"), true), "/admin/comunidade?periodo=hoje");

  // E o que foi escrito e lido de volta como o mesmo periodo.
  assert.deepEqual(period.parseAdminPeriodParamStrict("30d", NOW), preset("30d"));
  assert.equal(period.parseAdminPeriodParamStrict(null, NOW), null);
});
