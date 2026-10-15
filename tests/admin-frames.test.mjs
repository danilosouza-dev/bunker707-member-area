import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Molduras das telas que ainda estao sendo construidas (Alunos e Comunicacao), na disposicao do
// prototipo aprovado: cabecalho, abas e numeros no lugar certo, todos vazios e honestos.

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
});

test("Comunicacao: moldura sem numero inventado e sem botao que finge funcionar", async () => {
  const frame = await read("src/components/admin/v2/frames/communication-frame.tsx");
  const pages = await Promise.all(model.COMMUNICATION_TABS.map((tab) => read(`src/app/admin/(v2)/comunicacao/${tab}/page.tsx`)));
  const root = await read("src/app/admin/(v2)/comunicacao/page.tsx");

  assert.match(frame, /value=\{null\}/, "os numeros ficam em \"—\"");
  assert.match(frame, /UNDER_CONSTRUCTION_MESSAGE/);
  assert.match(frame, /preserveParams=\{\["periodo"\]\}/);
  assert.doesNotMatch(stripComments(frame), /Novo aviso|Novo webinário|Nova promoção/);

  pages.forEach((source, index) => {
    const tab = model.COMMUNICATION_TABS[index];
    assert.match(source, new RegExp(`tab="${tab}"`), tab);
    assert.match(source, new RegExp(`data-phase=\\{${model.COMMUNICATION_TAB_META[tab].phase}\\}`), tab);
    assert.match(source, /readAdminPeriod\(params, new Date\(\)\)/, tab);
  });

  assert.match(root, /redirect\(suffix \? `\$\{COMMUNICATION_HOME_HREF\}\?\$\{suffix\}` : COMMUNICATION_HOME_HREF\)/, "leva o periodo junto");
});

