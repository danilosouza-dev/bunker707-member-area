import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";

// Relatorio do pop-up, v3b-2 (docs/29 §2.6 e §4.6; spec §7.3 R): as linhas de communication_popup_report lidas sem
// confiar no formato (readPopupReportRows), os quatro numeros e os quatro blocos (buildPopupReport): onde
// apareceu (com "Por produto": os 10 com mais vezes, "Outros produtos" e "Produto removido"), em que momento, como
// fecharam (com "Sem registro", nunca negativo) e quantas vezes cada aluno viu; percentuais sem base e nunca acima
// de 100 %; os textos da tabela 6.5 palavra por palavra (o rodape sem data, critica 14) e a tela desenhada
// (barras com o numero escrito ao lado e a barra fora do leitor de tela, tabelas com <caption> e <th scope="col">,
// cartoes <dl> abaixo de 768 px, o alternador como botao de acao sem aria-pressed e 44 px no toque, os estados sem
// numero e o esqueleto). Os .tsx sao
// transpilados aqui pelo TypeScript (so JSX -> JS), como em tests/comunicacao-modelos-tela.test.mjs.

const root = new URL("../", import.meta.url);
const srcUrl = new URL("src/", root).href;
const require = createRequire(new URL("package.json", root));
const ts = require("typescript");

const STUBS = {
  "next/link": `import { createElement } from "react";
export default function Link({ prefetch, scroll, ...props }) { return createElement("a", props); }`
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
const report = await import("../src/server/communications/popup-report-model.ts");
const display = await import("../src/server/communications/popup-display-model.ts");
const { PopupReportBlocks, PopupReportSection, PopupReportSkeleton } = await import("../src/components/admin/v2/communication/popup-report-section.tsx");

const PROIBIDAS = ["campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "automação", "lembrete", "layout", "template", "home"];

function semPalavrasProibidas(texto) {
  for (const palavra of PROIBIDAS) {
    assert.ok(!texto.toLocaleLowerCase("pt-BR").includes(palavra), `"${texto}" usa "${palavra}"`);
  }
}

const linha = (metric, item, total, students) => ({ item, metric, students, total });

/** Um pop-up visto por 80 alunos, 120 vezes, como a funcao devolveria. */
function linhasDeExemplo(extra = []) {
  return [
    linha("viewers", "", 120, 80),
    linha("max", "", 9, 80),
    linha("median", "", 1, 80),
    linha("times", "1", 60, 60),
    linha("times", "2", 20, 10),
    linha("times", "3-5", 22, 6),
    linha("times", "6-10", 9, 1),
    linha("times", "11+", 0, 0),
    linha("opened", "", 100, 70),
    linha("opened_kind", "saved", 40, 30),
    linha("opened_kind", "home", 40, 35),
    linha("opened_kind", "lesson", 15, 10),
    linha("opened_kind", "other", 5, 5),
    linha("opened_kind", "profile", 0, 0),
    linha("opened_product", "formacao-ia", 12, 8),
    linha("opened_product", "curso-x", 3, 2),
    linha("opened_trigger", "page_load", 80, 60),
    linha("opened_trigger", "course_completed", 15, 10),
    linha("opened_trigger", "other", 5, 3),
    linha("outcomes", "", 90, 65),
    linha("outcome", "clicked", 30, 25),
    linha("outcome", "closed_x", 20, 18),
    linha("outcome", "closed_esc", 10, 9),
    linha("outcome", "closed_unknown", 30, 20),
    ...extra
  ];
}

const NOMES = { "curso-x": "Curso X", "formacao-ia": "Formação IA" };

/* ------------------------------------------------------------------------------------------------
 * Leitura das linhas
 * ---------------------------------------------------------------------------------------------- */

test("readPopupReportRows: métrica desconhecida, item fora da lista, número inválido e bigint em texto", () => {
  const lidas = report.readPopupReportRows([
    linha("viewers", "", "120", "80"),
    linha("opened_kind", "saved", 4, 3),
    linha("opened_kind", "javascript:alert(1)", 9, 9),
    linha("opened_kind", "", 9, 9),
    linha("opened_trigger", "at_start", 1, 1),
    linha("opened_trigger", "first_login", 2, 2),
    linha("opened_product", "curso-a", 2, 1),
    linha("opened_product", "curso a", 2, 1),
    linha("outcome", "closed_page", 1, 1),
    linha("outcome", "closed_other", 1, 1),
    linha("times", "3-5", 7, 2),
    linha("times", "4", 7, 2),
    linha("impressions", "", 1, 1),
    linha("opened", "x", 1, 1),
    linha("max", "", -1, 1),
    linha("median", "", Number.POSITIVE_INFINITY, 1),
    linha("outcomes", "", "muitos", 1),
    linha("outcomes", "", 3, null),
    { item: "", metric: "opened" },
    null,
    "viewers",
    [],
    linha("viewers", "", 999, 999)
  ]);

  assert.deepEqual(lidas, [
    linha("viewers", "", 120, 80),
    linha("opened_kind", "saved", 4, 3),
    linha("opened_trigger", "first_login", 2, 2),
    linha("opened_product", "curso-a", 2, 1),
    linha("outcome", "closed_page", 1, 1),
    linha("times", "3-5", 7, 2)
  ]);
  assert.deepEqual(report.readPopupReportRows("nao e lista"), []);
  assert.deepEqual([...report.POPUP_REPORT_METRICS].sort(), ["max", "median", "opened", "opened_kind", "opened_product", "opened_trigger", "outcome", "outcomes", "times", "viewers"]);
});

test("os momentos e os jeitos de fechar que a tela conhece são os do servidor (mais other)", () => {
  for (const trigger of [...display.POPUP_TRIGGERS, "other"]) {
    assert.equal(report.readPopupReportRows([linha("opened_trigger", trigger, 1, 1)]).length, 1, trigger);
  }

  for (const via of display.POPUP_CLOSE_VIAS) {
    assert.equal(report.readPopupReportRows([linha("outcome", `closed_${via}`, 1, 1)]).length, 1, via);
  }

  assert.equal(report.readPopupReportRows([linha("outcome", "closed_unknown", 1, 1)]).length, 1);
});

/* ------------------------------------------------------------------------------------------------
 * As contas
 * ---------------------------------------------------------------------------------------------- */

test("KPIs: vezes, alunos, mais de uma vez (sobre quem viu) e o máximo com a média de uma casa e a metade", () => {
  const view = report.buildPopupReport(linhasDeExemplo(), NOMES);

  assert.equal(view.empty, false);
  assert.deepEqual(view.kpis, [
    { definition: "somando todos os alunos", id: "times", label: "Vezes que apareceu", value: 120 },
    { definition: "pelo menos 1 vez", id: "viewers", label: "Alunos que viram", value: 80 },
    { definition: "21,3% de quem viu", id: "repeat", label: "Viram mais de uma vez", value: 17 },
    { definition: "em média 1,5 vezes por aluno; metade viu até 1", id: "max", label: "No máximo, para um aluno", value: 9 }
  ]);

  const uma = report.buildPopupReport([linha("viewers", "", 7, 3), linha("max", "", 3, 3), linha("median", "", 2, 3), linha("times", "2", 4, 2), linha("times", "3-5", 3, 1)], {});
  assert.equal(uma.kpis[3].definition, "em média 2,3 vezes por aluno; metade viu até 2");
  assert.equal(uma.kpis[2].definition, "100% de quem viu");
});

test("Onde apareceu: em ordem de vezes, empate pela ordem do menu, Outra página e nenhuma linha com 0", () => {
  const view = report.buildPopupReport(linhasDeExemplo(), NOMES);

  assert.deepEqual(
    view.pages.map((bar) => [bar.label, bar.total, bar.students, bar.percent, bar.summary]),
    [
      ["Início", 40, 35, 40, "40 vezes · 35 alunos"],
      ["Favoritos", 40, 30, 40, "40 vezes · 30 alunos"],
      ["Páginas de aula", 15, 10, 15, "15 vezes · 10 alunos"],
      ["Outra página", 5, 5, 5, "5 vezes · 5 alunos"]
    ]
  );
  assert.ok(!view.pages.some((bar) => bar.id === "profile"), "linha com 0 nao aparece");

  const todas = report.buildPopupReport(
    [linha("viewers", "", 11, 1), linha("opened", "", 11, 1), ...["support", "profile", "continue", "journey", "materials", "saved", "purchases", "lesson", "content", "home", "other"].map((kind) => linha("opened_kind", kind, 1, 1))],
    {}
  );
  assert.deepEqual(
    todas.pages.map((bar) => bar.label),
    ["Início", "Página do produto", "Páginas de aula", "Minhas compras", "Favoritos", "Materiais", "Minha jornada", "Continue assistindo", "Perfil", "Suporte", "Outra página"],
    "empate: a ordem do menu"
  );
  assert.equal(report.buildPopupReport([linha("viewers", "", 1, 1), linha("opened_kind", "saved", 1, 1), linha("opened", "", 1, 1)], {}).pages[0].summary, "1 vez · 1 aluno", "singular");
});

test("Em que momento: ordem fixa, com Outro momento; Como fecharam: ordem fixa, Fecharam (sem detalhe) e Sem registro", () => {
  const view = report.buildPopupReport(linhasDeExemplo(), NOMES);

  assert.deepEqual(
    view.triggers.map((bar) => [bar.label, bar.total, bar.percent]),
    [
      ["Ao abrir a página", 80, 80],
      ["Ao concluir um curso", 15, 15],
      ["Outro momento", 5, 5]
    ]
  );
  assert.deepEqual(
    view.outcomes.map((bar) => [bar.label, bar.total, bar.percent, bar.summary]),
    [
      ["Clicaram no botão", 30, 30, "30 vezes · 25 alunos"],
      ["Fecharam no X", 20, 20, "20 vezes · 18 alunos"],
      ["Fecharam no Esc", 10, 10, "10 vezes · 9 alunos"],
      ["Fecharam (sem detalhe)", 30, 30, "30 vezes · 20 alunos"],
      ["Sem registro", 10, 10, "10 vezes"]
    ]
  );

  const todos = report.buildPopupReport(
    [
      linha("viewers", "", 9, 1),
      linha("opened", "", 9, 1),
      linha("outcomes", "", 9, 1),
      ...["dismissed", "snoozed", "closed_page", "closed_outside", "closed_esc", "closed_x", "clicked", "closed_unknown"].map((item) => linha("outcome", item, 1, 1)),
      ...["other", "course_completed", "first_login", "lesson_completed", "page_load"].map((item) => linha("opened_trigger", item, 1, 1))
    ],
    {}
  );
  assert.deepEqual(
    todos.outcomes.map((bar) => bar.label),
    ["Clicaram no botão", "Fecharam no X", "Fecharam no Esc", "Fecharam clicando fora", "Saíram da página com ele aberto", "Lembrar depois", "Não mostrar de novo", "Fecharam (sem detalhe)"],
    "sem Sem registro: todo aberto tem resultado"
  );
  assert.deepEqual(todos.triggers.map((bar) => bar.label), ["Ao abrir a página", "Ao concluir uma aula", "No primeiro acesso", "Ao concluir um curso", "Outro momento"]);

  // Mais resultados do que aberturas (historico forjado antes da politica nova): nunca negativo, nunca acima de 100 %.
  const forjado = report.buildPopupReport([linha("viewers", "", 2, 1), linha("opened", "", 2, 1), linha("outcomes", "", 5, 1), linha("outcome", "clicked", 5, 1)], {});
  assert.ok(!forjado.outcomes.some((bar) => bar.id === "none"));
  assert.equal(forjado.outcomes[0].percent, 100);
});

test("Quantas vezes cada aluno viu: as faixas das linhas por aluno, sobre quem viu; faixa sem aluno não aparece", () => {
  const view = report.buildPopupReport(linhasDeExemplo(), NOMES);

  assert.deepEqual(
    view.times.map((bar) => [bar.label, bar.students, bar.percent, bar.summary]),
    [
      ["1 vez", 60, 75, "60 alunos"],
      ["2 vezes", 10, 12.5, "10 alunos"],
      ["3 a 5 vezes", 6, 7.5, "6 alunos"],
      ["6 a 10 vezes", 1, 1.3, "1 aluno"]
    ]
  );
  assert.equal(report.buildPopupReport([linha("viewers", "", 30, 2), linha("times", "11+", 30, 2)], {}).times[0].label, "11 vezes ou mais");
});

test("Por produto: os 10 com mais vezes pelo nome, Produto removido, Outros produtos com as vezes somadas e alunos —", () => {
  const produtos = Array.from({ length: 12 }, (_, index) => linha("opened_product", `p-${String(index).padStart(2, "0")}`, 100 - index, 10));
  const view = report.buildPopupReport([linha("viewers", "", 1_000, 50), linha("opened", "", 1_000, 50), ...produtos], { "p-00": "Formação IA", "p-01": "  " });

  assert.equal(view.products.length, 11);
  assert.deepEqual(view.products[0], { id: "p-00", label: "Formação IA", students: 10, total: 100 });
  assert.equal(view.products[1].label, "Produto removido", "nome em branco");
  assert.equal(view.products[2].label, "Produto removido", "sem nome");
  assert.deepEqual(view.products[10], { id: "other", label: "Outros produtos", students: null, total: 90 + 89 });
  assert.deepEqual(report.popupReportProductIds(report.readPopupReportRows(produtos)), produtos.slice(0, 10).map((row) => row.item), "so os nomes que a tela mostra");

  assert.deepEqual(report.buildPopupReport(linhasDeExemplo(), NOMES).products, [
    { id: "formacao-ia", label: "Formação IA", students: 8, total: 12 },
    { id: "curso-x", label: "Curso X", students: 2, total: 3 }
  ]);
  assert.equal(report.popupReportCount(null), "—");
  assert.equal(report.popupReportCount(1_200), "1.200");
});

test("percentuais: base 0 é null e nada escrito; vazio quando ninguém viu", () => {
  const semHistorico = report.buildPopupReport([linha("viewers", "", 3, 2), linha("opened_kind", "saved", 2, 1), linha("times", "1", 1, 1)], {});

  assert.equal(semHistorico.pages[0].percent, null, "sem aberturas no historico");
  assert.equal(report.popupReportPercentText(null, "das vezes"), "");
  assert.equal(report.popupReportPercentText(12.5, "das vezes"), "12,5% das vezes");

  const vazio = report.buildPopupReport(report.readPopupReportRows([linha("max", "", 0, 0), linha("median", "", 0, 0), linha("viewers", "", 0, 0)]), {});
  assert.equal(vazio.empty, true);
  assert.deepEqual([vazio.pages, vazio.triggers, vazio.outcomes, vazio.times, vazio.products], [[], [], [], [], []]);
  assert.equal(vazio.kpis[2].definition, "de quem viu");
  assert.equal(vazio.kpis[3].definition, "em média 0,0 vezes por aluno; metade viu até 0");
  assert.equal(report.buildPopupReport([], {}).empty, true, "sem linha nenhuma");
});

/* ------------------------------------------------------------------------------------------------
 * Textos
 * ---------------------------------------------------------------------------------------------- */

test("textos da tabela 6.5, palavra por palavra; o rodapé sem data e o histórico numa chave própria", () => {
  const copy = report.POPUP_REPORT_COPY;

  assert.equal(copy.title, "Como o pop-up foi visto");
  assert.equal(copy.description, "Desde a publicação. Atualiza a cada minuto.");
  assert.deepEqual(copy.toggle, { chart: "Ver como gráfico", table: "Ver como tabela" });
  assert.deepEqual(copy.sections, {
    outcomes: "Como fecharam",
    pages: "Onde apareceu",
    products: "Por produto",
    times: "Quantas vezes cada aluno viu",
    triggers: "Em que momento"
  });
  assert.equal(copy.productRemoved, "Produto removido");
  assert.equal(copy.productsOther, "Outros produtos");
  assert.deepEqual([copy.table.product, copy.table.total, copy.table.students], ["Produto", "Vezes", "Alunos"]);
  assert.deepEqual([copy.table.pages, copy.table.triggers, copy.table.outcomes, copy.table.times], ["Página", "Momento", "Como fecharam", "Quantas vezes"]);
  assert.deepEqual([copy.table.pagesPercent, copy.table.outcomesPercent, copy.table.timesPercent], ["% das vezes", "% das vezes que apareceu", "% de quem viu"]);
  assert.deepEqual(copy.percentOf, { outcomes: "das vezes que apareceu", pages: "das vezes", times: "de quem viu", triggers: "das vezes" });
  assert.equal(
    copy.footnote,
    "“Onde apareceu”, “Em que momento” e “Como fecharam” contam cada vez que o pop-up apareceu, pelo histórico (até 100 vezes por aluno por dia). “Vezes que apareceu” e “Quantas vezes cada aluno viu” vêm da conta de cada aluno e são exatas. “Sem registro”: vezes em que o aluno saiu sem o navegador conseguir avisar. A equipe não entra nos números."
  );
  assert.equal(copy.footnoteHistory, "Nas vezes mais antigas, o histórico não guardava a página nem o jeito de fechar: elas aparecem como Início e “Fecharam (sem detalhe)”.");
  assert.equal(report.buildPopupReport(linhasDeExemplo(), NOMES).footnote, `${copy.footnote} ${copy.footnoteHistory}`);
  assert.doesNotMatch(`${copy.footnote} ${copy.footnoteHistory}`, /\d{2}\/\d{2}\/\d{4}/, "sem data (critica 14)");
  assert.equal(copy.empty, "Ninguém viu este pop-up ainda. Os números aparecem aqui quando os alunos começarem a ver.");
  assert.equal(copy.pendingMigration, "Os detalhes de onde e como os alunos fecharam aparecem depois da atualização do banco.");
  assert.equal(copy.failure, "Não foi possível carregar estes números agora. Recarregue a página.");
  assert.equal(copy.loadingAria, "Carregando os números do pop-up");
});

test("vocabulário: todos os textos do relatório (inclusive home e trigger)", () => {
  const folhas = (value) => (typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(folhas) : []);
  const view = report.buildPopupReport(linhasDeExemplo(), NOMES);
  const textos = [
    ...folhas(report.POPUP_REPORT_COPY),
    ...view.kpis.flatMap((kpi) => [kpi.label, kpi.definition]),
    ...[...view.pages, ...view.triggers, ...view.outcomes, ...view.times].flatMap((bar) => [bar.label, bar.summary])
  ];

  assert.ok(textos.length > 60, `achou os textos (${textos.length})`);
  textos.forEach(semPalavrasProibidas);
});

/* ------------------------------------------------------------------------------------------------
 * A tela desenhada
 * ---------------------------------------------------------------------------------------------- */

test("a tela: quatro números, as barras com o número escrito ao lado (a barra fora do leitor de tela) e Por produto em tabela", () => {
  const view = report.buildPopupReport(linhasDeExemplo(), NOMES);
  const html = renderToStaticMarkup(createElement(PopupReportSection, { result: { status: "ok", view } }));

  assert.match(html, /<h2[^>]*id="aviso-relatorio-popup"[^>]*>Como o pop-up foi visto<\/h2>/);
  assert.match(html, /aria-labelledby="aviso-relatorio-popup"/);
  assert.ok(html.includes("Desde a publicação. Atualiza a cada minuto."));
  // O alternador e um botao de acao: o texto diz o que o clique faz, sem aria-pressed (o leitor de tela nao
  // anuncia "Ver como gráfico, pressionado" com as tabelas na tela); 44 px no toque.
  const alternador = /<button[^>]*>[^<]*(?:<svg[^>]*>.*?<\/svg>)?Ver como tabela<\/button>/.exec(html)?.[0];
  assert.ok(alternador, "o botao Ver como tabela");
  assert.doesNotMatch(alternador, /aria-pressed/, "sem aria-pressed");
  assert.match(alternador, /class="[^"]*pointer-coarse:h-11[^"]*"/, "44 px no toque");
  assert.doesNotMatch(html, /Ver como gráfico/, "no modo grafico so o texto da acao de ir para a tabela");
  for (const label of ["Vezes que apareceu", "Alunos que viram", "Viram mais de uma vez", "No máximo, para um aluno"]) {
    assert.ok(html.includes(label), label);
  }
  for (const title of ["Onde apareceu", "Em que momento", "Como fecharam", "Quantas vezes cada aluno viu"]) {
    assert.match(html, new RegExp(`<h3[^>]*>${title}</h3>`), title);
  }
  assert.ok(html.includes("40 vezes · 35 alunos · 40% das vezes"));
  assert.ok(html.includes("10 vezes · 10% das vezes que apareceu"), "Sem registro: so as vezes");
  assert.ok(html.includes("60 alunos · 75% de quem viu"));
  assert.match(html, /<div aria-hidden="true" class="[^"]*rounded-full[^"]*"><div class="[^"]*" style="width:40%"><\/div><\/div>/);
  assert.doesNotMatch(html, /<svg[^>]*class="[^"]*recharts/, "nada de pizza ou rosca");

  // Por produto: sempre tabela, com <caption> e <th scope="col">; no celular, cartoes <dl>.
  assert.match(html, /<caption class="sr-only">Por produto<\/caption>/);
  assert.match(html, /<th class="[^"]*" scope="col">Produto<\/th><th class="[^"]*" scope="col">Vezes<\/th><th class="[^"]*" scope="col">Alunos<\/th>/);
  assert.match(html, /<ul aria-label="Por produto" class="[^"]*md:hidden">/);
  assert.match(html, /<dl[^>]*>.*Formação IA.*<\/dl>/);
  assert.ok(html.includes(view.footnote));
});

test("modo tabela: os quatro blocos viram tabelas de uma vez, com as colunas da spec e cartões no celular", () => {
  const view = report.buildPopupReport(linhasDeExemplo(), NOMES);
  const html = renderToStaticMarkup(createElement(PopupReportBlocks, { table: true, view }));

  for (const [caption, first, percent] of [
    ["Onde apareceu", "Página", "% das vezes"],
    ["Em que momento", "Momento", "% das vezes"],
    ["Como fecharam", "Como fecharam", "% das vezes que apareceu"],
    ["Quantas vezes cada aluno viu", "Quantas vezes", "% de quem viu"]
  ]) {
    assert.match(html, new RegExp(`<caption class="sr-only">${caption}</caption>`), caption);
    assert.match(
      html,
      new RegExp(`<caption class="sr-only">${caption}</caption><thead><tr><th[^>]*scope="col">${first}</th><th[^>]*scope="col">Vezes</th><th[^>]*scope="col">${percent}</th><th[^>]*scope="col">Alunos</th>`),
      `${caption}: colunas`
    );
    assert.match(html, new RegExp(`<ul aria-label="${caption}" class="[^"]*md:hidden">`), `${caption}: cartoes no celular`);
  }
  assert.doesNotMatch(html, /aria-hidden="true" class="h-2/, "sem barras no modo tabela");
  assert.match(html, /<td[^>]*>Sem registro<\/td><td[^>]*>10<\/td><td[^>]*>10%<\/td><td[^>]*>—<\/td>/, "Sem registro sem alunos");
  assert.match(html, /<table class="hidden w-full[^"]*md:table">/, "a tabela so a partir de 768 px");
});

test("estados sem números: migração pendente, falha, ninguém viu; o esqueleto com aria-busy", () => {
  const copy = report.POPUP_REPORT_COPY;
  const desenhar = (result) => renderToStaticMarkup(createElement(PopupReportSection, { result }));

  const pendente = desenhar({ status: "pending_migration" });
  assert.ok(pendente.includes(copy.pendingMigration) && pendente.includes(copy.title));
  assert.doesNotMatch(pendente, /Ver como (tabela|gráfico)/, "sem numeros, sem alternador");

  assert.ok(desenhar({ status: "error" }).includes(copy.failure));

  const vazio = desenhar({ status: "ok", view: report.buildPopupReport([linha("viewers", "", 0, 0)], {}) });
  assert.ok(vazio.includes(copy.empty));
  assert.doesNotMatch(vazio, /Vezes que apareceu/);

  const esqueleto = renderToStaticMarkup(createElement(PopupReportSkeleton));
  assert.match(esqueleto, /aria-busy="true" aria-label="Carregando os números do pop-up"/);
  assert.equal((esqueleto.match(/role="group"/g) ?? []).length, 4, "quatro KpiTile vazios");
  assert.ok(esqueleto.includes(copy.title));
});
