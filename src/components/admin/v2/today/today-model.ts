// Modelo da tela Hoje (docs/17 §1.5; prototipo aprovado, rodada "Layout do protótipo").
//
// Modulo puro (sem React, sem "server-only", so imports relativos ou de tipo) para o servidor, a
// apresentacao e tests/admin-today.test.mjs usarem as mesmas regras:
// - cartoes de "Precisa de atenção hoje": um cartao so existe quando a regra pode ser calculada e o numero
//   e maior que zero; ordem por urgencia; o produto escolhido na barra superior vale para todos;
// - titulo e frase de apoio da secao de numeros, que seguem o periodo da barra superior;
// - delta contra o periodo anterior (percentual ou em pontos; sem delta quando o anterior e zero);
// - serie do mini-grafico a partir das linhas do banco, com os mesmos baldes do periodo (buracos = 0);
// - itens do botao Criar (so destinos que existem; o resto aparece desativado como "Em breve");
// - linhas do card "Por produto".
// Nada aqui inventa numero: sem dado, null.

import { ADMIN_PERIOD_PARAM, ADMIN_PRODUCT_PARAM } from "../filters";
import { ADMIN_TIME_ZONE } from "../format";
import type { AdminPeriodPreset, ResolvedAdminPeriod } from "../period";
import type { AdminAction } from "@/server/auth/roles";
import type { ProductAccent } from "@/server/catalog/model";
import { newStudentHref, studentListHref } from "../students/hrefs";
import type { TodayDemoData } from "./today-demo";

/** Espaco que nao quebra: "24 h", "7 dias" ficam sempre na mesma linha. */
const NB = " ";

/* ------------------------------------------------------------------------------------------------
 * Cabecalho
 * ---------------------------------------------------------------------------------------------- */

/** "domingo, 11 de outubro", no fuso da escola (como no prototipo). */
export function formatTodayDate(now: Date, timeZone = ADMIN_TIME_ZONE) {
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone, weekday: "long" }).format(now);
}

/** "10:41": hora da leitura, para "Última verificação às 10:41". */
export function formatCheckTime(now: Date, timeZone = ADMIN_TIME_ZONE) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", hourCycle: "h23", minute: "2-digit", timeZone }).format(now);
}

/** Primeiro nome para a saudacao ("Bom dia, Danilo"). */
export function getFirstName(name: string) {
  return name.trim().split(/\s+/)[0] || name.trim();
}

/* ------------------------------------------------------------------------------------------------
 * Precisa de atencao hoje
 * ---------------------------------------------------------------------------------------------- */

export type AttentionTone = "critical" | "warning" | "neutral";
export type TodayAttentionId = "perguntas" | "acessos-expirando" | "produtos-sem-aula";

export type TodayAttentionCard = {
  action: { href: string; label: string };
  count: number;
  id: TodayAttentionId;
  /** Rotulo de prioridade ao lado do numero: "Passou de 24 h", "Próximos 7 dias", "Catálogo". */
  priorityLabel: string;
  /** Frase curta da linha do celular: "perguntas sem resposta há +24 h". */
  shortText: string;
  /** Frase do cartao: "perguntas de alunos sem resposta há mais de 24 h". */
  text: string;
  tone: AttentionTone;
};

export type TodayProductRef = { id: string; title: string };

export type TodayAttentionInput = {
  /** Acessos ativos que terminam nos proximos 7 dias (sem a equipe); null = nao calculavel agora. */
  expiringAccesses: number | null;
  /** Perguntas de alunos sem resposta do professor ha mais de 24 h; null = nao calculavel agora. */
  overdueQuestions: number | null;
  /** Produto escolhido na barra superior (?produto=), ou null para todos. */
  productId: string | null;
  /** Produtos publicados sem nenhuma aula publicada; null = nao calculavel agora. */
  productsWithoutLessons: readonly TodayProductRef[] | null;
};

/** No maximo quatro cartoes, todos na mesma linha a partir de 1180 px (prototipo). */
export const MAX_ATTENTION_CARDS = 4;

function positiveCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function withProduct(path: string, productId: string | null) {
  return productId ? `${path}?${new URLSearchParams({ [ADMIN_PRODUCT_PARAM]: productId }).toString()}` : path;
}

/**
 * Cartoes de atencao a partir dos numeros do banco, do mais urgente para o menos urgente:
 * perguntas atrasadas (vermelho), acessos terminando (ambar), catalogo (neutro).
 */
export function buildAttentionCards(input: TodayAttentionInput): TodayAttentionCard[] {
  const cards: TodayAttentionCard[] = [];
  const overdue = positiveCount(input.overdueQuestions);

  if (overdue > 0) {
    cards.push({
      action: { href: withProduct("/admin/comunidade", input.productId), label: "Responder" },
      count: overdue,
      id: "perguntas",
      priorityLabel: `Passou de 24${NB}h`,
      shortText: overdue === 1 ? `pergunta sem resposta há +24${NB}h` : `perguntas sem resposta há +24${NB}h`,
      text:
        overdue === 1
          ? `pergunta de aluno sem resposta há mais de 24${NB}h`
          : `perguntas de alunos sem resposta há mais de 24${NB}h`,
      tone: "critical"
    });
  }

  const expiring = positiveCount(input.expiringAccesses);

  if (expiring > 0) {
    cards.push({
      action: { href: studentListHref(), label: "Ver alunos" },
      count: expiring,
      id: "acessos-expirando",
      priorityLabel: `Próximos 7${NB}dias`,
      shortText: expiring === 1 ? `acesso termina em 7${NB}dias` : `acessos terminam em 7${NB}dias`,
      text: expiring === 1 ? `acesso termina nos próximos 7${NB}dias` : `acessos terminam nos próximos 7${NB}dias`,
      tone: "warning"
    });
  }

  const emptyProducts = (input.productsWithoutLessons ?? []).filter(
    (product) => !input.productId || product.id === input.productId
  );

  if (emptyProducts.length > 0) {
    const single = emptyProducts.length === 1;

    cards.push({
      action: {
        href: single ? `/admin/produtos/${encodeURIComponent(emptyProducts[0].id)}` : "/admin/produtos?situacao=published",
        label: "Corrigir"
      },
      count: emptyProducts.length,
      id: "produtos-sem-aula",
      priorityLabel: "Catálogo",
      shortText: single ? "produto publicado sem aulas" : "produtos publicados sem aulas",
      text: single ? "produto publicado sem nenhuma aula publicada" : "produtos publicados sem nenhuma aula publicada",
      tone: "neutral"
    });
  }

  return cards.slice(0, MAX_ATTENTION_CARDS);
}

/** "Tudo em dia" so pode aparecer quando todas as regras foram calculadas. */
export function isAttentionComplete(input: TodayAttentionInput) {
  return input.overdueQuestions !== null && input.expiringAccesses !== null && input.productsWithoutLessons !== null;
}

/* ------------------------------------------------------------------------------------------------
 * Secao de numeros
 * ---------------------------------------------------------------------------------------------- */

const PRESET_NUMBERS_HEADING: Record<AdminPeriodPreset, { meta: string; title: string }> = {
  "1d": { meta: "comparados às 24 horas anteriores", title: "Números das últimas 24 horas" },
  "30d": { meta: "comparados aos 30 dias anteriores", title: "Números dos últimos 30 dias" },
  "3d": { meta: "comparados aos 3 dias anteriores", title: "Números dos últimos 3 dias" },
  "7d": { meta: "comparados aos 7 dias anteriores", title: "Números dos últimos 7 dias" },
  hoje: { meta: "comparados com ontem até a mesma hora", title: "Números de hoje" }
};

/** Titulo (H2) e frase de apoio da secao de numeros, a partir do periodo da barra superior. */
export function getTodayNumbersHeading(resolved: ResolvedAdminPeriod): { meta: string; title: string } {
  if (resolved.period.kind === "preset") {
    return PRESET_NUMBERS_HEADING[resolved.period.preset];
  }

  return {
    meta: resolved.days === 1 ? "comparados ao dia anterior" : `comparados aos ${resolved.days} dias anteriores`,
    title: `Números de ${resolved.label}`
  };
}

/** Frase ao lado do titulo do grafico de atividade: um ponto por hora (ate 3 dias) ou por dia. */
export function getActivityMeta(resolved: ResolvedAdminPeriod) {
  return resolved.granularity === "hour" ? "por hora" : "por dia";
}

/** Frase ao lado do titulo "Por produto": o periodo em minusculas ("últimos 30 dias", "hoje"). */
export function getByProductMeta(resolved: ResolvedAdminPeriod) {
  return resolved.label.charAt(0).toLocaleLowerCase("pt-BR") + resolved.label.slice(1);
}

function isCount(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Variacao percentual contra o periodo anterior, com uma casa (12.5 = +12,5 %). Sem delta quando falta um
 * dos lados ou quando o anterior e zero (de 0 para 5 nao e "+∞ %").
 */
export function computePercentDelta(current: number | null | undefined, previous: number | null | undefined) {
  if (!isCount(current) || !isCount(previous) || previous <= 0) {
    return null;
  }

  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Variacao em pontos percentuais para numeros que ja sao percentuais (41 % contra 39 % = +2 pts). */
export function computePointsDelta(current: number | null | undefined, previous: number | null | undefined) {
  if (!isCount(current) || !isCount(previous)) {
    return null;
  }

  return Math.round((current - previous) * 10) / 10;
}

export type BucketRow = { bucket: string | null; total: number | string | null };

/**
 * Serie alinhada aos baldes do periodo (listAdminPeriodBuckets): um valor por balde, na ordem do tempo;
 * balde sem linha = 0; linha fora do periodo e ignorada; chave repetida soma.
 */
export function fillBucketSeries(buckets: readonly { key: string }[], rows: readonly BucketRow[]) {
  const totals = new Map<string, number>();

  for (const row of rows) {
    const total = Number(row.total);

    if (!row.bucket || !Number.isFinite(total)) {
      continue;
    }

    totals.set(row.bucket, (totals.get(row.bucket) ?? 0) + total);
  }

  return buckets.map((bucket) => totals.get(bucket.key) ?? 0);
}

export function sumSeries(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}

/* ------------------------------------------------------------------------------------------------
 * Botao Criar
 * ---------------------------------------------------------------------------------------------- */

export type TodayCreateItem = {
  /** null = ainda nao existe: aparece desativado. */
  href: string | null;
  id: string;
  label: string;
  /** Texto pequeno a direita: "admin antigo", "Em breve". */
  meta?: string;
  /** Quem pode usar o destino (a mesma tabela de papeis das acoes do servidor). */
  permission: AdminAction;
};

export const TODAY_CREATE_ITEMS: readonly TodayCreateItem[] = [
  { href: "/admin/produtos/novo", id: "produto", label: "Produto", permission: "catalog.create" },
  { href: "/admin/produtos/importar", id: "playlist", label: "Produto a partir de uma playlist", permission: "catalog.create" },
  { href: "/admin/produtos/pacotes", id: "pacote", label: "Pacote", permission: "catalog.access" },
  { href: newStudentHref(), id: "aluno", label: "Aluno", permission: "students.access" },
  { href: "/admin/comunicacao/avisos/novo", id: "aviso", label: "Aviso", permission: "messaging.write" },
  { href: "/admin/comunicacao/webinarios/novo", id: "webinario", label: "Webinário", permission: "messaging.write" },
  { href: null, id: "promocao", label: "Promoção", meta: "Em breve", permission: "messaging.write" }
];

/** Itens do Criar que o papel pode usar; sem nenhum destino ativo, o botao nem aparece. */
export function getTodayCreateItems(can: (action: AdminAction) => boolean): TodayCreateItem[] {
  const items = TODAY_CREATE_ITEMS.filter((item) => can(item.permission));

  return items.some((item) => item.href) ? items : [];
}

/* ------------------------------------------------------------------------------------------------
 * Por produto
 * ---------------------------------------------------------------------------------------------- */

export type TodayProductStat = {
  accent: ProductAccent;
  coverUrl: string | null;
  formatLabel: string;
  id: string;
  lessonsPublished: number;
  /** Alunos com acesso ativo agora. */
  studentsWithAccess: number;
  title: string;
};

export type TodayByProductRow = TodayProductStat & {
  /** Com um produto escolhido na barra superior: a linha dele destacada, as outras apagadas. */
  emphasis: "highlight" | "dim" | "none";
  href: string;
};

export const BY_PRODUCT_LIMIT = 6;

function byAccessThenTitle(left: TodayProductStat, right: TodayProductStat) {
  return right.studentsWithAccess - left.studentsWithAccess || left.title.localeCompare(right.title, "pt-BR");
}

/**
 * Produtos publicados com pelo menos uma aula publicada, os de mais alunos com acesso primeiro (ate 6).
 * Com um produto escolhido que ficaria fora dos 6, ele entra no lugar do ultimo, para a linha destacada
 * sempre aparecer.
 */
export function selectByProductRows(
  products: readonly TodayProductStat[],
  productId: string | null,
  options: { limit?: number; periodParam?: string | null } = {}
): TodayByProductRow[] {
  const limit = options.limit ?? BY_PRODUCT_LIMIT;
  // O Desempenho abre com o mesmo periodo da barra superior (o padrao some do endereco).
  const query = options.periodParam ? `?${new URLSearchParams({ [ADMIN_PERIOD_PARAM]: options.periodParam }).toString()}` : "";
  const eligible = products.filter((product) => product.lessonsPublished > 0).sort(byAccessThenTitle);
  let selected = eligible.slice(0, limit);
  const chosen = productId ? eligible.find((product) => product.id === productId) : undefined;

  if (chosen && !selected.includes(chosen)) {
    selected = [...selected.slice(0, Math.max(0, limit - 1)), chosen].sort(byAccessThenTitle);
  }

  return selected.map((product) => ({
    ...product,
    emphasis: !productId ? "none" : product.id === productId ? "highlight" : "dim",
    href: `/admin/produtos/${encodeURIComponent(product.id)}/desempenho${query}`
  }));
}

/** Produtos publicados que o aluno ainda nao consegue assistir (nenhuma aula publicada). */
export function listProductsWithoutLessons(products: readonly TodayProductStat[]): TodayProductRef[] {
  return products
    .filter((product) => product.lessonsPublished === 0)
    .map((product) => ({ id: product.id, title: product.title }));
}

/**
 * Mini-grafico com no maximo `maxPoints` pontos: series longas (um intervalo de meses, por dia) somam baldes
 * vizinhos, do comeco para o fim. O total nao muda.
 */
export function compressSeries(values: readonly number[], maxPoints = 60) {
  if (values.length <= maxPoints || maxPoints < 2) {
    return [...values];
  }

  const size = Math.ceil(values.length / maxPoints);
  const compressed: number[] = [];

  for (let index = 0; index < values.length; index += size) {
    compressed.push(sumSeries(values.slice(index, index + size)));
  }

  return compressed;
}

/* ------------------------------------------------------------------------------------------------
 * Estado de cada parte da tela (o servidor monta; a apresentacao so desenha)
 * ---------------------------------------------------------------------------------------------- */

export type TodayAttentionState =
  | {
      cards: TodayAttentionCard[];
      /** Hora da leitura ("10:41"), para "Última verificação às 10:41". */
      checkedAt: string;
      /** true quando todas as regras foram calculadas: so assim "Tudo em dia" pode aparecer. */
      complete: boolean;
      /** Alguma regra depende da migracao 202610120001, ainda nao aplicada. */
      pendingMigration: boolean;
      status: "ready";
    }
  | { status: "error" };

/** De onde vieram os acessos do periodo (Hotmart, equipe...), para o rodape do numero. */
export type TodayAccessOrigin = { provider: string; total: number };

export type TodayAccessKpiState =
  | { origins: TodayAccessOrigin[]; previousTotal: number; series: number[]; status: "ready"; total: number }
  | { status: "pending-migration" }
  | { status: "error" };

const ACCESS_ORIGIN_LABELS: Record<string, { long: string; short: string }> = {
  hotmart: { long: "pela Hotmart", short: "Hotmart" },
  kiwify: { long: "pela Kiwify", short: "Kiwify" },
  manual: { long: "pela equipe", short: "equipe" },
  ticto: { long: "pela Ticto", short: "Ticto" },
  tiktok: { long: "pelo TikTok", short: "TikTok" }
};

/**
 * Rodape de "Novos acessos" (docs/17 §1.5: a origem aparece ao passar o mouse): "3 pela Hotmart · 2 pela
 * equipe". Sem origem lida (migracao pendente ou nada no periodo), a frase padrao.
 */
export function describeAccessOrigins(origins: readonly TodayAccessOrigin[]): { definition: string; definitionShort: string } {
  const rows = origins.filter((origin) => isCount(origin.total) && origin.total > 0).sort((left, right) => right.total - left.total);

  if (rows.length === 0) {
    return { definition: "acessos liberados no período", definitionShort: "liberados no período" };
  }

  const part = (origin: TodayAccessOrigin, size: "long" | "short") => {
    const label = ACCESS_ORIGIN_LABELS[origin.provider] ?? { long: `por ${origin.provider}`, short: origin.provider };

    return `${formatCount(origin.total)} ${label[size]}`;
  };

  return {
    definition: rows.map((origin) => part(origin, "long")).join(" · "),
    definitionShort: rows.map((origin) => part(origin, "short")).join(" · ")
  };
}

function formatCount(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

export type TodayByProductState =
  | { rows: TodayByProductRow[]; status: "ready" }
  | { status: "pending-migration" }
  | { status: "error" };

export type TodayViewData = {
  activityMeta: string;
  attention: TodayAttentionState;
  byProduct: TodayByProductState;
  byProductMeta: string;
  /** Rodape de comparacao dos numeros: "vs. 30 dias anteriores". */
  comparisonLabel: string;
  /** Itens do botao Criar que o papel pode usar (vazio = sem botao). */
  createItems: TodayCreateItem[];
  dateLabel: string;
  /** So com ADMIN_DEMO_DATA=on no localhost: numeros simulados para conferir o layout. */
  demo?: TodayDemoData;
  /** "Bom dia, Danilo". */
  greeting: string;
  newAccesses: TodayAccessKpiState;
  numbers: { meta: string; title: string };
  /** Periodo por extenso para leitores de tela: "Últimos 30 dias", "1 a 10 de outubro de 2026". */
  periodAccessibleLabel: string;
  /** Endereco desta mesma tela (com ?periodo= e ?produto=), para "Tentar de novo". */
  retryHref: string;
};
