import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Molduras das telas que ainda estao sendo construidas (Webinarios e Promocoes em Comunicacao), na
// disposicao do prototipo aprovado: cabecalho, abas e numeros no lugar certo, todos vazios e honestos.
// Avisos e pop-ups ja e tela de verdade (docs/22): numeros do banco, "Novo aviso" e telas com loading.

const model = await import("../src/components/admin/v2/frames/communication-model.ts");
const period = await import("../src/components/admin/v2/period.ts");

const now = new Date("2026-10-11T13:00:00Z");
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
/** So o que vira interface: tira comentarios de bloco e de linha inteira. */
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const resolve = (value) => period.resolveAdminPeriod(period.parseAdminPeriodParam(value, now), now);

test("Comunicacao: tres abas com endereco proprio, frase do prototipo e fase so no atributo", () => {
  assert.deepEqual([...model.COMMUNICATION_TABS], ["avisos", "webinarios", "promocoes"]);
  assert.deepEqual(
    model.COMMUNICATION_TABS.map((tab) => [model.COMMUNICATION_TAB_META[tab].label, model.COMMUNICATION_TAB_META[tab].href]),
    [
      ["Avisos e pop-ups", "/admin/comunicacao/avisos"],
      ["Webinários", "/admin/comunicacao/webinarios"],
      ["Promoções", "/admin/comunicacao/promocoes"]
    ]
  );
  assert.equal(model.COMMUNICATION_HOME_HREF, "/admin/comunicacao/avisos");
  assert.deepEqual(
    model.COMMUNICATION_TABS.map((tab) => model.COMMUNICATION_TAB_META[tab].phase),
    [5, 5, 6]
  );

  for (const tab of model.COMMUNICATION_TABS) {
    const meta = model.COMMUNICATION_TAB_META[tab];
    assert.doesNotMatch(`${meta.description} ${meta.upcomingTitle}`, /fase|exemplo/i, tab);
  }
});

test("Comunicacao: os quatro numeros de cada aba seguem o periodo da barra superior", () => {
  const labels = (tab, value) => model.getCommunicationKpis(tab, resolve(value)).map((kpi) => kpi.label);

  assert.deepEqual(labels("avisos"), ["Avisos ativos", "Vistos em 30 dias", "Taxa de clique", "Voltaram a estudar"]);
  assert.deepEqual(labels("webinarios"), ["Próximos", "Inscritos", "Comparecimento", "Replays"]);
  assert.deepEqual(labels("promocoes"), ["Ativas", "Cliques no checkout", "Taxa de clique", "Terminam em 7 dias"]);

  assert.equal(labels("avisos", "hoje")[1], "Vistos hoje");
  assert.equal(labels("avisos", "1d")[1], "Vistos em 24 horas");
  assert.equal(labels("avisos", "3d")[1], "Vistos em 3 dias");
  assert.equal(labels("avisos", "7")[1], "Vistos em 7 dias", "link antigo 7");
  assert.equal(labels("avisos", "2026-10-01..2026-10-05")[1], "Vistos no período");
  assert.equal(labels("avisos", "90")[1], "Vistos no período", "link antigo 90 vira intervalo");

  assert.deepEqual(
    model.getCommunicationKpis("avisos", resolve("30d")).map((kpi) => kpi.format),
    ["number", "number", "percent", "number"]
  );
  assert.equal(model.getCommunicationKpis("webinarios", resolve("30d"))[2].format, "percent");

  // So os numeros de verdade (Avisos) dizem o que contam; as abas em construcao nao inventam definicao.
  for (const kpi of model.getCommunicationKpis("avisos", resolve("30d"))) {
    assert.ok(kpi.definition && kpi.definitionShort, kpi.label);
    assert.doesNotMatch(`${kpi.definition} ${kpi.definitionShort}`, /campanha|público|audiência|evento|oferta/i, kpi.label);
  }
  for (const tab of ["webinarios", "promocoes"]) {
    assert.ok(model.getCommunicationKpis(tab, resolve("30d")).every((kpi) => !kpi.definition), tab);
  }
});

test("Comunicacao: moldura sem numero inventado e sem botao que finge funcionar", async () => {
  const frame = await read("src/components/admin/v2/frames/communication-frame.tsx");
  const constructionTabs = ["webinarios", "promocoes"];
  const pages = await Promise.all(constructionTabs.map((tab) => read(`src/app/admin/(v2)/comunicacao/${tab}/page.tsx`)));
  const root = await read("src/app/admin/(v2)/comunicacao/page.tsx");

  assert.match(frame, /value=\{null\}/, "os numeros ficam em \"—\"");
  assert.match(frame, /UNDER_CONSTRUCTION_MESSAGE/);
  assert.match(frame, /preserveParams=\{\["periodo"\]\}/);
  assert.doesNotMatch(stripComments(frame), /Novo aviso|Novo webinário|Nova promoção/);

  pages.forEach((source, index) => {
    const tab = constructionTabs[index];
    assert.match(source, new RegExp(`tab="${tab}"`), tab);
    assert.match(source, new RegExp(`data-phase=\\{${model.COMMUNICATION_TAB_META[tab].phase}\\}`), tab);
    assert.match(source, /readAdminPeriod\(params, new Date\(\)\)/, tab);
  });

  assert.match(root, /redirect\(suffix \? `\$\{COMMUNICATION_HOME_HREF\}\?\$\{suffix\}` : COMMUNICATION_HOME_HREF\)/, "leva o periodo junto");
});

test("Comunicacao: Avisos e pop-ups e tela de verdade, com numeros do banco e loading em cada tela", async () => {
  const { existsSync } = await import("node:fs");
  const page = stripComments(await read("src/app/admin/(v2)/comunicacao/avisos/page.tsx"));
  const list = stripComments(await read("src/components/admin/v2/communication/notices-list-view.tsx"));

  // Sem moldura de construcao: os quatro numeros vem do communication_overview no periodo da barra.
  assert.doesNotMatch(page, /CommunicationFrame|data-phase/);
  assert.match(page, /readAdminPeriod\(params, new Date\(\)\)/);
  assert.match(page, /getCommunicationOverview\(\{ end: period\.end, start: period\.start \}\)/);
  assert.match(page, /listNotices\(/);
  assert.match(page, /<PendingMigrationNotice migration="202610200001" \/>/, "banco sem a migracao: aviso, nunca tela quebrada");
  assert.doesNotMatch(list, /value=\{null\}/, "numero de verdade, nao o \"—\" da moldura");
  assert.match(list, /overview\.activeNow, overview\.seen, overview\.clickRate, overview\.studied7d/);
  assert.match(list, /canWrite \? \(\s*<AdminLinkButton href=\{NEW_NOTICE_HREF\}>/, "Novo aviso so para quem cria avisos");
  assert.match(list, /<CommunicationTabs \/>/, "mesmas abas das outras telas de Comunicacao");

  for (const route of ["avisos", "avisos/novo", "avisos/[id]"]) {
    for (const file of ["page.tsx", "loading.tsx"]) {
      assert.ok(existsSync(new URL(`../src/app/admin/(v2)/comunicacao/${route}/${file}`, import.meta.url)), `${route}/${file}`);
    }
  }
});
