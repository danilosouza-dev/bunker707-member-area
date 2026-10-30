import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";
import { sessaoRow, webinarRow } from "./support/webinarios-banco-falso.mjs";

// Os paineis "Lives ao vivo" e "Lives gravadas" desenhados (docs/30 §3.1 a §3.3 e §3.5; docs/18 §1.1): os dez
// cartoes (4 por linha, 2 abaixo de 768 px), os filtros da aba, a curva com o seletor Live/Sessao e os pontos de
// queda, os graficos com "Ver como tabela" (e a tabela com <caption> e <th scope="col">, que vira cartoes <dl> no
// celular), a tabela de sessoes com o link Relatorio e o selo do "Começa quando você entra", o bloco Simulacao por
// ultimo com a frase e o fundo diferente, os vazios ("Sem lives ao vivo ainda", "Sem dados no período", "Limpar
// filtros"), o aviso da migracao e as classes de 375 px. Os .tsx sao transpilados aqui (so JSX -> JS); next/link e
// next/navigation viram stubs e as leituras do servidor (panel-queries, db) viram modulos falsos.

// O recharts carrega antes do hook de load: com um hook `load` registrado, o Node 22 nao liga o ESM dele ("request for
// 'redux' is from a module not been linked"); ja carregado, os .tsx recebem o mesmo modulo do cache.
await import("recharts");

const root = new URL("../", import.meta.url);
const srcUrl = new URL("src/", root).href;
const require = createRequire(new URL("package.json", root));
const ts = require("typescript");

const STUBS = {
  "next/link": `import { createElement } from "react";
export default function Link({ prefetch, scroll, ...props }) { return createElement("a", props); }`,
  "next/navigation": `export function useRouter() { return { back() {}, push() {}, refresh() {}, replace() {} }; }
export function usePathname() { return "/admin/comunicacao/webinarios"; }
export function useSearchParams() { return new URLSearchParams(); }
export function redirect(href) { throw new Error("redirect " + href); }
export function notFound() { throw new Error("notFound"); }`,
  "@/server/webinars/panel-queries": `export async function getWebinarPanel() { return { status: "error" }; }
export async function getPanelPresence() { return { status: "empty" }; }`,
  "@/server/webinars/report-queries": `export async function getWebinarReport() { return { status: "error" }; }`,
  "@/server/webinars/db": `export const WEBINARS_MIGRATION = "202610300007";
export const WEBINARS_PANELS_MIGRATION = "202610300002";
export const WEBINARS_OFFERS_MIGRATION = "202610300003";`
};

function withExtension(base) {
  for (const candidate of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (existsSync(fileURLToPath(candidate))) {
      return candidate;
    }
  }

  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBS[specifier]) {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}` };
    }

    const parent = context.parentURL ?? "";

    if (specifier.startsWith("@/")) {
      const found = withExtension(new URL(specifier.slice(2), srcUrl).href);

      if (found) {
        return { shortCircuit: true, url: found };
      }
    }

    if (parent.startsWith(srcUrl) && /^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const found = withExtension(new URL(specifier, parent).href);

      if (found) {
        return { shortCircuit: true, url: found };
      }
    }

    if (parent.startsWith("data:")) {
      return nextResolve(specifier, { ...context, parentURL: new URL("package.json", root).href });
    }

    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(srcUrl) && url.endsWith(".tsx")) {
      const fileName = fileURLToPath(url);
      const { outputText } = ts.transpileModule(readFileSync(fileName, "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        fileName
      });

      return { format: "module", shortCircuit: true, source: outputText };
    }

    return nextLoad(url, context);
  }
});

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const model = await import("../src/server/webinars/panel-model.ts");
const panel = await import("../src/components/admin/v2/communication/webinars/panels/webinar-panel.tsx");
const charts = await import("../src/components/admin/v2/communication/webinars/panels/panel-charts.tsx");
const { PanelSessionsTable } = await import("../src/components/admin/v2/communication/webinars/panels/panel-table.tsx");

const html = (element) => renderToStaticMarkup(element);
const textOf = (markup) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const count = (markup, pattern) => (markup.match(pattern) ?? []).length;

const W_IA = "aaaaaaaa-0000-4000-8000-000000000001";
const W_GRAVADA = "aaaaaaaa-0000-4000-8000-000000000004";
const HOST = "bbbbbbbb-0000-4000-8000-000000000001";
const S1 = "cccccccc-0000-4000-8000-000000000001";
const S2 = "cccccccc-0000-4000-8000-000000000002";
const R1 = "dddddddd-0000-4000-8000-000000000001";
const R2 = "dddddddd-0000-4000-8000-000000000002";

const webinars = [
  webinarRow({ host_user_id: HOST, id: W_IA, kind: "live", product_id: "prod-ia", title: "Aula de IA" }),
  webinarRow({ host_user_id: HOST, id: W_GRAVADA, kind: "simulated", product_id: "prod-ia", title: "Live de agentes" })
];
const POINTS = Array.from({ length: 21 }, (_, index) => index * 5);
const row = (sessionId, metric, total, extra = {}) => ({ item: "", metric, sessionId, students: total, total, ...extra });
const retention = (sessionId, base) => POINTS.map((pct) => ({ item: String(pct), metric: "retention", sessionId, students: base, total: pct < 50 ? base : Math.ceil(base / 2) }));

function liveView(extra = {}) {
  const sessions = model.panelSessionsOf(
    [
      sessaoRow({ ended_at: "2026-10-11T00:00:00Z", id: S1, kind: "live", scheduled_at: "2026-10-10T23:00:00Z", status: "ended", webinar_id: W_IA }),
      sessaoRow({ ended_at: "2026-10-21T00:00:00Z", id: S2, kind: "live", scheduled_at: "2026-10-20T23:00:00Z", status: "ended", webinar_id: W_IA })
    ],
    webinars
  );
  const rows = [
    ...[S1, S2].flatMap((id) => [
      row(id, "duration", 3_600_000),
      row(id, "registered", 10),
      row(id, "present", 8),
      row(id, "attended_registered", 6),
      row(id, "watch_sum", 8 * 1_800),
      row(id, "reached_end", 4),
      row(id, "peak", 7, { item: "20" }),
      row(id, "messages", 5),
      row(id, "question", 2, { item: "answered" }),
      row(id, "replay_viewers", 2),
      ...retention(id, 8)
    ]),
    row(null, "unique_present", 12),
    row(null, "unique_reached_end", 6),
    row(null, "unique_replay_viewers", 3)
  ];

  return model.buildPanelView({
    everHadSessions: true,
    filters: model.emptyPanelFilters(),
    hostNames: { [HOST]: "Ana Equipe" },
    kind: "live",
    offers: null,
    previousRows: [],
    previousSelected: [],
    productNames: { "prod-ia": "Formação em IA" },
    rows,
    selected: sessions,
    sessionParam: null,
    sessions,
    simulations: null,
    window: { end: "2026-10-29T15:01:00.000Z", start: "2026-09-30T03:00:00.000Z" },
    ...extra
  });
}

function recordedView(extra = {}) {
  const sessions = model.panelSessionsOf(
    [
      sessaoRow({ ended_at: "2026-10-11T00:00:00Z", id: R1, scheduled_at: "2026-10-10T23:00:00Z", show_live_badge: true, status: "ended", webinar_id: W_GRAVADA }),
      sessaoRow({ ended_at: "2026-10-12T14:00:00Z", id: R2, jit: true, scheduled_at: "2026-10-12T13:00:00Z", status: "ended", webinar_id: W_GRAVADA })
    ],
    webinars
  );
  const rows = [
    ...[R1, R2].flatMap((id) => [
      row(id, "duration", 1_800_000),
      row(id, "present", 10),
      row(id, "visitors", 12),
      row(id, "watch_sum", 10 * 1_200),
      row(id, "reached_end", 5),
      row(id, "offer_seen", 8),
      row(id, "offer_clicks", 4),
      row(id, "offer_purchases", 2),
      row(id, "offer_variant", 8, { item: "A:seen" }),
      row(id, "offer_variant", 4, { item: "A:clicks" }),
      row(id, "offer_variant", 2, { item: "A:purchases" }),
      row(id, "offer_revenue", 39_400, { item: "BRL" }),
      ...retention(id, 10)
    ]),
    row(null, "unique_present", 18),
    row(null, "unique_visitors", 22),
    row(null, "unique_reached_end", 9),
    row(null, "unique_offer_seen", 14),
    row(null, "unique_clickers", 7),
    row(null, "unique_buyers", 4),
    { item: "max", metric: "sim_counter", sessionId: R1, students: 0, total: 900 },
    { item: "shown", metric: "sim_joins", sessionId: R1, students: 0, total: 30 }
  ];
  const offers = model.panelOfferFactsOf(
    [{ id: "offer", status: "active", variants: [{ enabled: true, label: "A" }], webinarId: W_GRAVADA }],
    [{ hide_offset_ms: 1_200_000, session_id: R1, show_offset_ms: 600_000, snapshot: null }]
  );

  return model.buildPanelView({
    everHadSessions: true,
    filters: model.emptyPanelFilters(),
    hostNames: {},
    kind: "simulated",
    offers,
    previousRows: [],
    previousSelected: [],
    productNames: { "prod-ia": "Formação em IA" },
    rows,
    selected: sessions,
    sessionParam: R1,
    sessions,
    simulations: [{ countRule: { base: 50, jitter: 0, mode: "fixed", peak: 0 }, joins: {}, saleNotices: {}, seed: 1, sessionId: R1, summary: null }],
    window: { end: "2026-10-29T15:01:00.000Z", start: "2026-09-30T03:00:00.000Z" },
    ...extra
  });
}

const presenceOk = (offerWindow = null) => ({
  chart: model.panelPresenceOf(
    { avgPresent: 3, curve: [{ b: 0, n: 5 }, { b: 1, n: 7 }, { b: 2, n: 3 }, { b: 3, n: 2 }], drops: [{ b: 2, n: 4 }], peak: { b: 1, n: 7 }, reachedEnd: 1, unique: 7, watchAvgSeconds: 60, watchMaxSeconds: 90 },
    { durationMs: 1_800_000, offerWindow }
  ),
  status: "ok"
});
const context = (kind) => ({ comparisonLabel: "vs. 30 dias anteriores", kind, periodLabel: "últimos 30 dias", periodo: "30d" });

test("Lives ao vivo: titulo, filtros (Situação e Apresentador), os dez cartoes e o Exportar no lugar", () => {
  const markup = html(createElement(panel.WebinarPanelContent, { context: context("live"), presence: presenceOk(), result: { status: "ok", view: liveView() } }));
  const text = textOf(markup);

  assert.match(text, /Lives ao vivo As lives ao vivo do período/);
  for (const label of ["Lives realizadas", "Vagas garantidas", "Presentes", "Comparecimento", "Pico de presentes", "Tempo médio assistido", "Viram até o fim", "Mensagens", "Perguntas respondidas", "Viram o replay"]) {
    assert.match(text, new RegExp(label), label);
  }
  assert.match(markup, /class="grid grid-cols-2 gap-3 md:grid-cols-4" data-panel-kpis=""/, "4 por linha, 2 abaixo de 768 px");
  assert.equal(count(markup, /role="group" aria-label="[^"]*"|aria-label="[^"]*" class="[^"]*@container/g) >= 10, true);
  assert.match(text, /Comparecimento: só webinários com Garantir vaga/);
  assert.match(markup, /aria-label="Situação"/);
  for (const pill of ["Realizadas", "Agendadas", "Canceladas"]) {
    assert.match(markup, new RegExp(`>${pill}</a>`), pill);
  }
  assert.match(text, /Realizadas Agendadas Canceladas/, "na ordem da especificacao");
  assert.doesNotMatch(markup, /aria-current="page"[^>]*>(Realizadas|Agendadas|Canceladas)</, "sem filtro, nenhuma marcada");
  assert.match(markup, /href="\/admin\/comunicacao\/webinarios\?aba=ao-vivo&amp;situacao=canceladas&amp;periodo=30d"/);
  const marked = html(
    createElement(panel.WebinarPanelContent, {
      context: context("live"),
      presence: presenceOk(),
      result: { status: "ok", view: liveView({ filters: { ...model.emptyPanelFilters(), situation: "realized" } }) }
    })
  );
  assert.match(marked, /aria-current="page"[^>]*href="\/admin\/comunicacao\/webinarios\?aba=ao-vivo&amp;periodo=30d"[^>]*>Realizadas</, "clicar na marcada tira o filtro");
  assert.match(marked, />Limpar filtros</);
  assert.match(markup, /<option value="" selected="">Todos os apresentadores<\/option><option value="bbbbbbbb-0000-4000-8000-000000000001">Ana Equipe<\/option>/);
  assert.match(markup, /<option value="" selected="">Todos os produtos<\/option><option value="prod-ia">Formação em IA<\/option>/);
  assert.doesNotMatch(text, /Simulação/, "o bloco Simulacao so na gravada");
  assert.doesNotMatch(text, /Inscrit/);
});

test("Lives ao vivo: a curva com o seletor Live e as quedas; os graficos com 'Ver como tabela'; a tabela com caption, cartoes e Relatorio", () => {
  const markup = html(createElement(panel.WebinarPanelContent, { context: context("live"), presence: presenceOk(), result: { status: "ok", view: liveView() } }));
  const text = textOf(markup);

  for (const title of ["Presença minuto a minuto", "Retenção média", "Vagas × Presentes × Replay", "Lives ao longo do tempo"]) {
    assert.match(text, new RegExp(title), title);
  }
  assert.equal(count(markup, />Ver como tabela</g), 4, "um alternador em cada grafico com dados");
  assert.match(text, /Pico de 7 presentes em 00:30/);
  assert.match(markup, /<span[^>]*>Live<\/span><select/);
  assert.match(markup, new RegExp(`<option value="${S2}" selected="">Aula de IA · 20/10/2026 às 20:00</option>`), "a mais recente por padrao");
  assert.match(text, /Pontos de queda 01:00 · 4/);
  assert.match(text, /presentes que tinham vaga|presentes em cada 5 % da duração ÷ alunos da sessão, na média das lives/);
  assert.doesNotMatch(markup, /Janela da oferta/, "a faixa da oferta e da gravada");

  assert.match(markup, /<caption class="[^"]*">Lives do período<\/caption>/);
  assert.equal(count(markup, /<th class="[^"]*" scope="col">/g) >= 13, true, "as 12 colunas e o Relatorio");
  assert.match(markup, /<ul aria-label="Lives do período" class="flex min-w-0 flex-col divide-y divide-\[var\(--border-subtle\)\] md:hidden"><li[^>]*><dl/);
  assert.match(markup, new RegExp(`href="/admin/comunicacao/webinarios/${W_IA}/relatorio\\?sessao=${S1}"`));
  assert.match(markup, /aria-label="Relatório de Aula de IA"/);
});

test("graficos em tabela: <caption>, <th scope=\"col\"> e cartoes <dl> no celular; o botao vira 'Ver como gráfico'", () => {
  const view = liveView();
  const retention = html(createElement(charts.RetentionChartCard, { chart: view.retention, initialMode: "table", kind: "live" }));
  assert.match(retention, /<caption class="sr-only">Retenção média<\/caption>/);
  assert.match(retention, /<th class="[^"]*" scope="col">% da duração<\/th>/);
  assert.match(retention, />Ver como gráfico</);
  assert.match(retention, /md:hidden"><li[^>]*><dl/);
  assert.match(textOf(retention), /50 % 50%/);

  const presence = html(createElement(charts.PresenceChartCard, { filters: model.emptyPanelFilters(), initialMode: "table", kind: "simulated", options: view.presence.options, periodo: null, result: presenceOk({ hideOffsetMs: null, showOffsetMs: 60_000, variants: [] }), selectedId: S1 }));
  assert.match(presence, /<caption class="sr-only">Presença minuto a minuto<\/caption>/);
  assert.match(textOf(presence), /00:00 7 01:00 3/);
  assert.match(presence, /<span[^>]*>Sessão<\/span><select/);

  const bars = html(createElement(charts.TripleBarsChartCard, { bars: view.tripleBars, initialMode: "table" }));
  assert.match(textOf(bars), /Aula de IA · 10\/10\/2026 às 20:00 10 8 2/);

  const empty = html(createElement(charts.TripleBarsChartCard, { bars: [] }));
  assert.match(textOf(empty), /Sem dados no período/);
  assert.doesNotMatch(empty, /Ver como tabela/, "sem dados, sem alternador");
});

test("Lives gravadas: horario e variante em barras horizontais, a faixa da oferta, o selo do Começa quando você entra e o bloco Simulacao por ultimo", () => {
  const view = recordedView();
  const markup = html(createElement(panel.WebinarPanelContent, { context: context("simulated"), presence: presenceOk(view.presence.offerWindow), result: { status: "ok", view } }));
  const text = textOf(markup);

  for (const label of ["Sessões realizadas", "Visitantes", "Participantes", "Viram a oferta", "Cliques na oferta", "Compras", "Conversão", "Receita"]) {
    assert.match(text, new RegExp(label), label);
  }
  assert.match(text, /Receita R\$\s788,00 pelas vendas com valor/, "a receita em reais (R$ 394,00 em cada sessao)");
  for (const title of ["Retenção média por webinário", "Por horário do dia", "Oferta por variante"]) {
    assert.match(text, new RegExp(title), title);
  }
  assert.match(text, /20h 20 participantes em 2 sessões|10h 10 participantes em 1 sessão/);
  assert.match(text, /Variante A 16 viram · 8 clicaram · 4 compraram · 25% de conversão/);
  assert.match(markup, /Janela da oferta/);
  assert.match(markup, /<a [^>]*href="[^"]*com-oferta=1[^"]*"[^>]*>Com oferta<\/a>/);
  assert.match(markup, />Variante A<\/a>/);
  assert.match(markup, /<option value="" selected="">Todos os webinários<\/option>/);
  assert.match(markup, /<option value="" selected="">Qualquer horário<\/option><option value="10">10h<\/option><option value="20">20h<\/option>/);
  assert.match(markup, /data-jit="">Começa quando você entra<\/span>/);
  assert.match(markup, /<caption class="[^"]*">Sessões do período<\/caption>/);
  assert.doesNotMatch(markup, /<div class="recharts-wrapper[^"]*"[^>]*><svg[^>]*class="recharts-surface"[^>]*><g class="recharts-pie/, "nada de pizza");

  const simulationAt = markup.indexOf('data-panel-simulation=""');
  assert.ok(simulationAt > markup.indexOf('data-panel-sessions=""'), "depois da tabela");
  assert.ok(simulationAt > markup.indexOf('data-panel-charts=""'));
  const tail = markup.slice(markup.indexOf(">", simulationAt) + 1);
  assert.doesNotMatch(tail, /data-panel-(kpis|charts|sessions|filters)/, "o bloco Simulacao e o ultimo");
  assert.match(markup, /border-dashed border-\[var\(--border-strong\)\] bg-\[var\(--surface-2\)\] p-4"[^>]*data-panel-simulation=""/, "fundo diferente");
  const simulation = textOf(tail);
  assert.match(simulation, /^Simulação Estes números são da simulação e não entram em nenhum outro número\./);
  assert.match(simulation, /Selo “Ao vivo” ligado em 1 de 2 sessões/);
  assert.match(simulation, /Regra do contador Real \+ 50/);
  assert.match(simulation, /Maior número do contador 900 Participantes de verdade: 18/);
  assert.match(simulation, /Entradas simuladas 30/);
});

test("vazios, migracao pendente e erro", () => {
  const never = textOf(html(createElement(panel.WebinarPanelContent, { context: context("live"), presence: { status: "empty" }, result: { status: "ok", view: liveView({ everHadSessions: false, selected: [], sessions: [] }) } })));
  assert.match(never, /Sem lives ao vivo ainda/);
  assert.doesNotMatch(never, /Lives realizadas|Ver como tabela|Lives do período/);

  const period = textOf(html(createElement(panel.WebinarPanelContent, { context: context("simulated"), presence: { status: "empty" }, result: { status: "ok", view: recordedView({ selected: [] }) } })));
  assert.match(period, /Sem sessões gravadas no período/);

  const filteredMarkup = html(
    createElement(panel.WebinarPanelContent, {
      context: context("live"),
      presence: { status: "empty" },
      result: { status: "ok", view: liveView({ filters: { ...model.emptyPanelFilters(), situation: "cancelled" }, selected: [] }) }
    })
  );
  assert.match(textOf(filteredMarkup), /Sem dados no período Nenhuma sessão do período combina com esses filtros\./);
  assert.match(filteredMarkup, /href="\/admin\/comunicacao\/webinarios\?aba=ao-vivo&amp;periodo=30d"[^>]*>Limpar filtros/);

  const pending = textOf(html(createElement(panel.WebinarPanelContent, { context: context("live"), presence: { status: "empty" }, result: { migration: "202610300002", status: "pending_migration" } })));
  assert.match(pending, /Esta tela precisa da atualização do banco \(migração 202610300002\)\./);
  assert.doesNotMatch(pending, /Lives realizadas/);

  const errorMarkup = html(createElement(panel.WebinarPanelContent, { context: context("live"), presence: { status: "empty" }, result: { status: "error" } }));
  const error = textOf(errorMarkup);
  assert.match(error, /Não foi possível carregar o painel agora\./);
  // A falha nunca se passa por "Sem dados no período" (ninguem veio) e oferece tentar de novo no mesmo endereco.
  assert.match(error, /Não foi possível carregar o painel/);
  assert.doesNotMatch(error, /Sem dados no período/);
  assert.match(errorMarkup, /href="\/admin\/comunicacao\/webinarios\?aba=ao-vivo&amp;periodo=30d"[^>]*>Tentar de novo/);
  const comFiltros = html(
    createElement(panel.WebinarPanelContent, {
      context: { ...context("simulated"), retryHref: "/admin/comunicacao/webinarios?aba=gravadas&situacao=ended&periodo=7d" },
      presence: { status: "empty" },
      result: { status: "error" }
    })
  );
  assert.match(comFiltros, /href="\/admin\/comunicacao\/webinarios\?aba=gravadas&amp;situacao=ended&amp;periodo=7d"[^>]*>Tentar de novo/);

  const noOffers = html(createElement(panel.WebinarPanelContent, { context: context("simulated"), presence: { status: "empty" }, result: { status: "ok", view: recordedView({ offers: null, simulations: null }) } }));
  assert.match(textOf(noOffers), /Esta parte precisa da atualização do banco \(migração 202610300003\)\./);
  assert.match(textOf(noOffers), /A oferta aparece depois da atualização do banco\./);
  assert.match(textOf(noOffers), /Escolha uma sessão que já aconteceu para ver a curva\./);
  assert.match(textOf(noOffers.slice(noOffers.indexOf('data-panel-simulation=""'))), /Maior número do contador —/);
});

test("375 px: grades de 2 colunas, tabela vira cartoes, filtros em largura cheia e nada fixo mais largo que a tela", () => {
  const markup = html(createElement(panel.WebinarPanelContent, { context: context("simulated"), presence: presenceOk(), result: { status: "ok", view: recordedView() } }));

  assert.match(markup, /hidden min-w-0 overflow-x-auto md:block/, "a tabela larga so a partir de 768 px");
  assert.match(markup, /md:hidden"><li/, "os cartoes no celular");
  assert.match(markup, /grid min-w-0 items-start gap-4 lg:grid-cols-2" data-panel-charts=""/, "graficos um por linha ate 1024 px");
  assert.match(markup, /class="[^"]*h-9 w-full[^"]*md:w-auto[^"]*"/, "os selects ocupam a largura no celular");
  for (const match of markup.matchAll(/(?:^|[\s"])((?:min-)?w-\[(\d+)px\])/g)) {
    assert.ok(Number(match[2]) <= 343, `largura fixa ${match[1]} cabe em 375 px`);
  }
});

test("a aba na pagina: um Suspense por bloco, skeletons na forma final e a leitura unica", () => {
  const source = readFileSync(new URL("../src/components/admin/v2/communication/webinars/panels/webinar-panel.tsx", import.meta.url), "utf8");

  assert.equal(count(source, /<Suspense fallback=/g), 5, "filtros e cartoes, curva, graficos, tabela e Simulacao");
  assert.equal(count(source, /getWebinarPanel\(/g), 1, "uma leitura do painel para todos os blocos");
  assert.match(source, /getPanelPresence\([\s\S]*?\{ now, report: getWebinarReport \}\)/, "a curva pela visao do relatorio (cache de 60 s)");
  assert.match(source, /<WebinarExportMenu end=\{view\.exportWindow\.end\} filters=\{view\.filters\} kind=\{view\.kind\} scope="panel" searchParams=\{view\.filterParams\} start=\{view\.exportWindow\.start\} \/>/);

  const page = readFileSync(new URL("../src/app/admin/(v2)/comunicacao/webinarios/page.tsx", import.meta.url), "utf8");
  assert.match(page, /requirePageArea\("comunicacao"\)/);
  assert.match(page, /<WebinarPanelTab kind=\{state\.tab === "ao-vivo" \? "live" : "simulated"\}/);
  assert.match(page, /getWebinarListNumbers\(period/);
});

test("PanelSessionsTable: 'Mostrando as N mais recentes' quando o recorte passa do limite", () => {
  const rows = Array.from({ length: 2 }, (_, index) => ({ id: `id-${index}`, jit: false, reportHref: "/x", title: "Aula", values: { live: "Aula" } }));
  const markup = textOf(html(createElement(PanelSessionsTable, { kind: "live", rows, total: 250 })));
  assert.match(markup, /Mostrando as 2 mais recentes de 250\./);
});
