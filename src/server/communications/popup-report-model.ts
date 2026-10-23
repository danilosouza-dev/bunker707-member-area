// Relatorio do pop-up (v3b-2, docs/29 §6.5): as linhas de communication_popup_report (202610260001) viram os
// quatro numeros e os quatro blocos da pagina do pop-up ("Onde apareceu", "Em que momento", "Como fecharam" e
// "Quantas vezes cada aluno viu"). As linhas chegam sem confiar no formato (metrica numa lista fixa, item
// conferido por metrica, numeros finitos >= 0; o resto e ignorado). "Vezes que apareceu" e as faixas vem das
// linhas por aluno (exatas); os blocos de onde, momento e jeito de fechar vem do historico (base: as aberturas
// do historico). Cada linha da funcao e limitada sozinha pelas vezes de cada aluno: as partes podem somar mais
// que o total, entao nenhum percentual passa de 100 % e a tela nunca mostra "soma" das partes. Modulo puro
// (sem "server-only", imports relativos): queries.ts, a tela e tests/pop-ups-v3b2-relatorio.test.mjs usam as
// mesmas funcoes. Vocabulario fechado da equipe (docs/17 §1.3): o teste confere os textos.

import { formatPercent, ratio } from "../../components/admin/v2/communication/notices-view-model";
import { POPUP_PRODUCT_ID } from "./popup-display-model";

export const POPUP_REPORT_METRICS = ["max", "median", "opened", "opened_kind", "opened_product", "opened_trigger", "outcome", "outcomes", "times", "viewers"] as const;
export type PopupReportMetric = (typeof POPUP_REPORT_METRICS)[number];
export type PopupReportRow = { item: string; metric: PopupReportMetric; students: number; total: number };
/**
 * Uma barra (ou linha da tabela): `summary` = "120 vezes · 80 alunos" ("80 alunos" nas faixas, "12 vezes" no
 * "Sem registro"); `percent` = sobre a base do bloco, 0..100 (null sem base: nada escrito).
 */
export type PopupReportBar = { id: string; label: string; percent: number | null; students: number; summary: string; total: number };
export type PopupReportKpi = { definition: string; id: "max" | "repeat" | "times" | "viewers"; label: string; value: number };
/** Um produto de "Por produto"; `students` null na linha "Outros produtos" (um aluno pode estar em dois). */
export type PopupReportProduct = { id: string; label: string; students: number | null; total: number };
export type PopupReportView = {
  empty: boolean;
  footnote: string;
  kpis: PopupReportKpi[];
  outcomes: PopupReportBar[];
  pages: PopupReportBar[];
  products: PopupReportProduct[];
  times: PopupReportBar[];
  triggers: PopupReportBar[];
};

/* ------------------------------------------------------------------------------------------------
 * Textos (docs/29 §6.5)
 * ---------------------------------------------------------------------------------------------- */

/** Tipos de pagina na ordem do menu (o desempate de "Onde apareceu"). */
const PAGE_KINDS = ["home", "content", "lesson", "purchases", "saved", "materials", "journey", "continue", "profile", "support", "other"] as const;
type PageKind = (typeof PAGE_KINDS)[number];
const TRIGGER_ITEMS = ["page_load", "lesson_completed", "first_login", "course_completed", "other"] as const;
type TriggerItem = (typeof TRIGGER_ITEMS)[number];
/** Jeitos de fechar, na ordem da tela ("Sem registro" vem por ultimo, calculado). */
const OUTCOME_ITEMS = ["clicked", "closed_x", "closed_esc", "closed_outside", "closed_page", "snoozed", "dismissed", "closed_unknown"] as const;
type OutcomeItem = (typeof OUTCOME_ITEMS)[number];
const TIMES_ITEMS = ["1", "2", "3-5", "6-10", "11+"] as const;
type TimesItem = (typeof TIMES_ITEMS)[number];
/** Quantos produtos "Por produto" mostra pelo nome; o resto vira "Outros produtos". */
export const POPUP_REPORT_TOP_PRODUCTS = 10;

export const POPUP_REPORT_COPY = {
  description: "Desde a publicação. Atualiza a cada minuto.",
  empty: "Ninguém viu este pop-up ainda. Os números aparecem aqui quando os alunos começarem a ver.",
  failure: "Não foi possível carregar estes números agora. Recarregue a página.",
  footnote:
    "“Onde apareceu”, “Em que momento” e “Como fecharam” contam cada vez que o pop-up apareceu, pelo histórico (até 100 vezes por aluno por dia). “Vezes que apareceu” e “Quantas vezes cada aluno viu” vêm da conta de cada aluno e são exatas. “Sem registro”: vezes em que o aluno saiu sem o navegador conseguir avisar. A equipe não entra nos números.",
  /** Chave propria: a retencao do historico (docs/29 §2.2, D2) troca so ela. */
  footnoteHistory: "Nas vezes mais antigas, o histórico não guardava a página nem o jeito de fechar: elas aparecem como Início e “Fecharam (sem detalhe)”.",
  kpis: {
    max: "No máximo, para um aluno",
    repeat: "Viram mais de uma vez",
    times: "Vezes que apareceu",
    viewers: "Alunos que viram"
  },
  kpiDefinitions: { times: "somando todos os alunos", viewers: "pelo menos 1 vez" },
  loadingAria: "Carregando os números do pop-up",
  outcomes: {
    clicked: "Clicaram no botão",
    closed_esc: "Fecharam no Esc",
    closed_outside: "Fecharam clicando fora",
    closed_page: "Saíram da página com ele aberto",
    closed_unknown: "Fecharam (sem detalhe)",
    closed_x: "Fecharam no X",
    dismissed: "Não mostrar de novo",
    none: "Sem registro",
    snoozed: "Lembrar depois"
  },
  pages: {
    content: "Página do produto",
    continue: "Continue assistindo",
    home: "Início",
    journey: "Minha jornada",
    lesson: "Páginas de aula",
    materials: "Materiais",
    other: "Outra página",
    profile: "Perfil",
    purchases: "Minhas compras",
    saved: "Favoritos",
    support: "Suporte"
  },
  pendingMigration: "Os detalhes de onde e como os alunos fecharam aparecem depois da atualização do banco.",
  /** Sufixo do percentual escrito ao lado de cada barra, por bloco. */
  percentOf: { outcomes: "das vezes que apareceu", pages: "das vezes", times: "de quem viu", triggers: "das vezes" },
  productRemoved: "Produto removido",
  productsOther: "Outros produtos",
  sections: {
    outcomes: "Como fecharam",
    pages: "Onde apareceu",
    products: "Por produto",
    times: "Quantas vezes cada aluno viu",
    triggers: "Em que momento"
  },
  /** Cabecalhos das tabelas (modo tabela e "Por produto"). */
  table: {
    outcomes: "Como fecharam",
    outcomesPercent: "% das vezes que apareceu",
    pages: "Página",
    pagesPercent: "% das vezes",
    product: "Produto",
    students: "Alunos",
    times: "Quantas vezes",
    timesPercent: "% de quem viu",
    total: "Vezes",
    triggers: "Momento",
    triggersPercent: "% das vezes"
  },
  times: { "1": "1 vez", "11+": "11 vezes ou mais", "2": "2 vezes", "3-5": "3 a 5 vezes", "6-10": "6 a 10 vezes" },
  title: "Como o pop-up foi visto",
  toggle: { chart: "Ver como gráfico", table: "Ver como tabela" },
  triggers: {
    course_completed: "Ao concluir um curso",
    first_login: "No primeiro acesso",
    lesson_completed: "Ao concluir uma aula",
    other: "Outro momento",
    page_load: "Ao abrir a página"
  }
} as const;

/* ------------------------------------------------------------------------------------------------
 * Leitura das linhas (sem confiar no formato)
 * ---------------------------------------------------------------------------------------------- */

function itemFits(metric: PopupReportMetric, item: string) {
  switch (metric) {
    case "opened_kind":
      return (PAGE_KINDS as readonly string[]).includes(item);
    case "opened_product":
      return POPUP_PRODUCT_ID.test(item);
    case "opened_trigger":
      return (TRIGGER_ITEMS as readonly string[]).includes(item);
    case "outcome":
      return (OUTCOME_ITEMS as readonly string[]).includes(item);
    case "times":
      return (TIMES_ITEMS as readonly string[]).includes(item);
    default:
      return item === "";
  }
}

/** Numero finito >= 0; bigint pode vir como texto ("12"). Qualquer outra coisa: null (a linha sai). */
function countOf(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;

  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** Linhas do banco -> linhas do relatorio: metrica desconhecida, item fora da lista ou numero invalido saem. */
export function readPopupReportRows(rows: readonly unknown[]): PopupReportRow[] {
  const read: PopupReportRow[] = [];
  const seen = new Set<string>();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }

    const { item, metric, students, total } = row as Record<string, unknown>;

    if (typeof metric !== "string" || !(POPUP_REPORT_METRICS as readonly string[]).includes(metric) || typeof item !== "string") {
      continue;
    }

    const known = metric as PopupReportMetric;
    const totalCount = countOf(total);
    const studentCount = countOf(students);
    const key = `${known}\u0000${item}`;

    if (!itemFits(known, item) || totalCount === null || studentCount === null || seen.has(key)) {
      continue;
    }

    seen.add(key);
    read.push({ item, metric: known, students: studentCount, total: totalCount });
  }

  return read;
}

/* ------------------------------------------------------------------------------------------------
 * O relatorio
 * ---------------------------------------------------------------------------------------------- */

const integer = new Intl.NumberFormat("pt-BR");
const oneDecimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

function timesPhrase(value: number) {
  return value === 1 ? "1 vez" : `${integer.format(value)} vezes`;
}

function studentsPhrase(value: number) {
  return value === 1 ? "1 aluno" : `${integer.format(value)} alunos`;
}

/** Parte sobre a base, 0..100 com uma casa (nunca acima de 100); sem base, null. */
function percentOf(part: number, base: number) {
  const value = ratio(part, base);

  return value === null ? null : Math.min(100, value);
}

function rowsOf(rows: readonly PopupReportRow[], metric: PopupReportMetric) {
  return rows.filter((row) => row.metric === metric);
}

function rowOf(rows: readonly PopupReportRow[], metric: PopupReportMetric, item = "") {
  return rows.find((row) => row.metric === metric && row.item === item) ?? null;
}

function bar(id: string, label: string, row: Pick<PopupReportRow, "students" | "total">, base: number): PopupReportBar {
  return { id, label, percent: percentOf(row.total, base), students: row.students, summary: `${timesPhrase(row.total)} · ${studentsPhrase(row.students)}`, total: row.total };
}

/** Os produtos de "Por produto" pela ordem de vezes (empate pelo id): os 10 primeiros pelo nome. */
function productRowsInOrder(rows: readonly PopupReportRow[]) {
  return rowsOf(rows, "opened_product")
    .filter((row) => row.total > 0)
    .sort((left, right) => right.total - left.total || (left.item < right.item ? -1 : left.item > right.item ? 1 : 0));
}

/** Os ids dos produtos que "Por produto" mostra pelo nome (os 10 com mais vezes): uma leitura dos nomes. */
export function popupReportProductIds(rows: readonly PopupReportRow[]): string[] {
  return productRowsInOrder(rows)
    .slice(0, POPUP_REPORT_TOP_PRODUCTS)
    .map((row) => row.item);
}

function averageText(total: number, students: number) {
  return students > 0 ? oneDecimal.format(total / students) : oneDecimal.format(0);
}

export function buildPopupReport(rows: readonly PopupReportRow[], names: Readonly<Record<string, string>>): PopupReportView {
  const copy = POPUP_REPORT_COPY;
  const viewers = rowOf(rows, "viewers") ?? { students: 0, total: 0 };
  const opened = rowOf(rows, "opened")?.total ?? 0;
  const outcomesTotal = rowOf(rows, "outcomes")?.total ?? 0;
  const median = rowOf(rows, "median")?.total ?? 0;
  const max = rowOf(rows, "max")?.total ?? 0;
  const timesRows = new Map(rowsOf(rows, "times").map((row) => [row.item as TimesItem, row] as const));
  const repeat = TIMES_ITEMS.filter((item) => item !== "1").reduce((sum, item) => sum + (timesRows.get(item)?.students ?? 0), 0);
  const repeatPercent = percentOf(repeat, viewers.students);

  const kpis: PopupReportKpi[] = [
    { definition: copy.kpiDefinitions.times, id: "times", label: copy.kpis.times, value: viewers.total },
    { definition: copy.kpiDefinitions.viewers, id: "viewers", label: copy.kpis.viewers, value: viewers.students },
    { definition: repeatPercent === null ? "de quem viu" : `${formatPercent(repeatPercent)} de quem viu`, id: "repeat", label: copy.kpis.repeat, value: repeat },
    {
      definition: `em média ${averageText(viewers.total, viewers.students)} vezes por aluno; metade viu até ${integer.format(median)}`,
      id: "max",
      label: copy.kpis.max,
      value: max
    }
  ];

  // Onde apareceu: as paginas em ordem de vezes (empate pela ordem do menu); linha com 0 nao aparece.
  const kinds = new Map(rowsOf(rows, "opened_kind").map((row) => [row.item as PageKind, row] as const));
  const pages = PAGE_KINDS.map((kind, order) => ({ kind, order, row: kinds.get(kind) }))
    .filter((entry): entry is { kind: PageKind; order: number; row: PopupReportRow } => Boolean(entry.row && entry.row.total > 0))
    .sort((left, right) => right.row.total - left.row.total || left.order - right.order)
    .map((entry) => bar(entry.kind, copy.pages[entry.kind], entry.row, opened));

  // Em que momento: ordem fixa.
  const triggerRows = new Map(rowsOf(rows, "opened_trigger").map((row) => [row.item as TriggerItem, row] as const));
  const triggers = TRIGGER_ITEMS.flatMap((item) => {
    const row = triggerRows.get(item);

    return row && row.total > 0 ? [bar(item, copy.triggers[item], row, opened)] : [];
  });

  // Como fecharam: ordem fixa; "Sem registro" = aberturas do historico sem resultado (nunca negativo, sem alunos).
  const outcomeRows = new Map(rowsOf(rows, "outcome").map((row) => [row.item as OutcomeItem, row] as const));
  const outcomes = OUTCOME_ITEMS.flatMap((item) => {
    const row = outcomeRows.get(item);

    return row && row.total > 0 ? [bar(item, copy.outcomes[item], row, opened)] : [];
  });
  const unrecorded = Math.max(0, opened - outcomesTotal);

  if (unrecorded > 0) {
    outcomes.push({ id: "none", label: copy.outcomes.none, percent: percentOf(unrecorded, opened), students: 0, summary: timesPhrase(unrecorded), total: unrecorded });
  }

  // Quantas vezes cada aluno viu: as faixas das linhas por aluno, sobre quem viu.
  const times = TIMES_ITEMS.flatMap((item) => {
    const row = timesRows.get(item);

    return row && row.students > 0
      ? [{ id: item, label: copy.times[item], percent: percentOf(row.students, viewers.students), students: row.students, summary: studentsPhrase(row.students), total: row.total }]
      : [];
  });

  // Por produto: os 10 com mais vezes pelo nome; o resto somado em "Outros produtos".
  const ordered = productRowsInOrder(rows);
  const products: PopupReportProduct[] = ordered.slice(0, POPUP_REPORT_TOP_PRODUCTS).map((row) => {
    const name = names[row.item];

    return { id: row.item, label: typeof name === "string" && name.trim() ? name.trim() : copy.productRemoved, students: row.students, total: row.total };
  });
  const rest = ordered.slice(POPUP_REPORT_TOP_PRODUCTS);

  if (rest.length > 0) {
    products.push({ id: "other", label: copy.productsOther, students: null, total: rest.reduce((sum, row) => sum + row.total, 0) });
  }

  return {
    empty: viewers.students === 0 && viewers.total === 0,
    footnote: `${copy.footnote} ${copy.footnoteHistory}`,
    kpis,
    outcomes,
    pages,
    products,
    times,
    triggers
  };
}

/** "45% das vezes" ao lado da barra; sem base, nada. */
export function popupReportPercentText(percent: number | null, of: string) {
  return percent === null ? "" : `${formatPercent(percent)} ${of}`;
}

/** As vezes e os alunos escritos (as celulas da tabela); null = "—". */
export function popupReportCount(value: number | null) {
  return value === null ? "—" : integer.format(value);
}
