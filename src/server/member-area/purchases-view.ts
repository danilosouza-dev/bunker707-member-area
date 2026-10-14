// Minhas compras: o recorte que a tela mostra, montado a partir da biblioteca do aluno
// (getMemberLibrary em src/server/db/platform-store.ts). Progresso e situacao sao do PROPRIO aluno
// (aulas concluidas/assistidas); nunca de content_items.progress/status, que sao colunas globais.
//
// Modulo puro (sem "server-only" e sem alias "@/") para os testes rodarem com node --test. A pagina
// chama buildPurchasesPageView com a biblioteca e passa so este resultado para o componente de cliente.

import { withAccessPreviewParam } from "../../lib/access-preview";
import { formatMemberCount, formatMemberDate, toMemberTimestamp } from "../../lib/member-format";
import {
  getMemberContentHref,
  getMemberPurchasedContents,
  indexMemberLibrary,
  memberContentKindLabels,
  memberProgressStatusLabels,
  summarizeMemberContentProgress,
  type MemberLibrary,
  type MemberLibraryAccess,
  type MemberProgressStatus
} from "../../lib/member-library";
import type { ContentItem, ContentKind } from "../../lib/platform-types";

export type PurchaseStatusFilter = "all" | MemberProgressStatus;

/** continue = aula em andamento; start = primeira aula; review = produto concluido; browse = ver cursos da formacao. */
export type PurchaseResumeKind = "browse" | "continue" | "review" | "start";

export type PurchaseProductView = {
  /** "Desde 01/01/2026 · Acesso vitalício" / "Desde 01/01/2026 · Acesso até 01/01/2027"; null sem acesso real conhecido. */
  accessLabel: string | null;
  /** Acesso termina em ate 30 dias. */
  accessEndsSoon: boolean;
  completedLessons: number;
  eyebrow: string;
  /** Pagina do produto (/conteudo/{id}), ja com o parametro de previa quando houver. */
  href: string;
  id: string;
  image: string;
  kind: ContentKind;
  kindLabel: string;
  lastWatchedAt: string | null;
  lockedLessons: number;
  percent: number;
  /** Produto inteiro ainda nao liberado pela regra de liberacao ("Liberação em 08/01/2026"). */
  releaseLabel: string | null;
  /** Nome acessivel da acao (ex.: "Continuar Curso de IA na aula Prompt base"). */
  resumeAriaLabel: string | null;
  resumeHref: string | null;
  resumeKind: PurchaseResumeKind | null;
  /** "Continuar: {aula}", "Começar", "Revisar" ou "Ver cursos". */
  resumeLabel: string | null;
  /** Aula de destino de "Continuar"/"Começar" (para a segunda linha da acao). */
  resumeLessonTitle: string | null;
  /** Texto para busca: minusculo e sem acento. */
  searchText: string;
  status: MemberProgressStatus;
  statusLabel: string;
  title: string;
  totalLessons: number;
};

export type PurchasesKindOption = {
  count: number;
  id: ContentKind;
  label: string;
};

export type PurchasesContinueTarget = {
  href: string;
  lessonTitle: string;
  productTitle: string;
};

export type PurchasesPageView = {
  /** Produto com aula em andamento mais recente: destino de "Continuar de onde parei". */
  continueTarget: PurchasesContinueTarget | null;
  /** Pagina inicial (com a previa, quando houver): proximo passo do estado vazio. */
  homeHref: string;
  /** Tipos presentes, na ordem fixa (Formações, Cursos, Bootcamps...). */
  kindOptions: PurchasesKindOption[];
  products: PurchaseProductView[];
  /** false na previa de layout sem aluno: sem numeros nem filtro por situacao. */
  showProgress: boolean;
  stats: {
    completed: number;
    completedLessons: number;
    inProgress: number;
    notStarted: number;
    products: number;
    totalLessons: number;
  };
};

const DAY_MS = 86_400_000;
const ACCESS_ENDS_SOON_DAYS = 30;

const kindOrder: ContentKind[] = ["Formacao", "Curso", "Bootcamp", "Mentoria", "Webinario", "Produto", "Material", "Aula"];

const kindPluralLabels: Record<ContentKind, string> = {
  Aula: "Aulas",
  Bootcamp: "Bootcamps",
  Curso: "Cursos",
  Formacao: "Formações",
  Material: "Materiais",
  Mentoria: "Mentorias",
  Produto: "Materiais",
  Webinario: "Gravações de live"
};

export function getPurchaseKindPluralLabel(kind: ContentKind) {
  return kindPluralLabels[kind] ?? "Outros";
}

/** Minusculo e sem acento, para "formacao" achar "Formação". */
export function normalizeMemberSearchText(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Texto do acesso do aluno a um produto. So acesso real (compra/liberacao registrada) ganha texto;
 * gratuito, previa do produtor e acesso sem data conhecida ficam sem texto (nada inventado).
 */
export function getPurchaseAccessLabel(access: MemberLibraryAccess, now: number = Date.now()) {
  if (access.kind !== "entitlement" || (!access.startsAt && !access.endsAt)) {
    return { endsSoon: false, label: null };
  }

  const since = access.startsAt ? formatMemberDate(access.startsAt) : "";
  const until = access.endsAt ? formatMemberDate(access.endsAt) : "";
  const endsAt = toMemberTimestamp(access.endsAt);
  const untilLabel = until ? `Acesso até ${until}` : "Acesso vitalício";

  return {
    endsSoon: endsAt !== null && endsAt >= now && endsAt - now <= ACCESS_ENDS_SOON_DAYS * DAY_MS,
    label: since ? `Desde ${since} · ${untilLabel}` : untilLabel
  };
}

function getResume(
  kind: ContentKind,
  title: string,
  status: MemberProgressStatus,
  contentHref: string,
  resume: { href: string; lessonTitle: string } | null
): Pick<PurchaseProductView, "resumeAriaLabel" | "resumeHref" | "resumeKind" | "resumeLabel" | "resumeLessonTitle"> {
  if (status === "completed") {
    return { resumeAriaLabel: `Revisar ${title}`, resumeHref: contentHref, resumeKind: "review", resumeLabel: "Revisar", resumeLessonTitle: null };
  }

  if (status === "in_progress" && resume) {
    return {
      resumeAriaLabel: `Continuar ${title} na aula ${resume.lessonTitle}`,
      resumeHref: resume.href,
      resumeKind: "continue",
      resumeLabel: `Continuar: ${resume.lessonTitle}`,
      resumeLessonTitle: resume.lessonTitle
    };
  }

  if (status === "not_started" && kind === "Formacao") {
    return { resumeAriaLabel: `Ver os cursos de ${title}`, resumeHref: contentHref, resumeKind: "browse", resumeLabel: "Ver cursos", resumeLessonTitle: null };
  }

  if (status === "not_started" && resume) {
    return {
      resumeAriaLabel: `Começar ${title} pela aula ${resume.lessonTitle}`,
      resumeHref: resume.href,
      resumeKind: "start",
      resumeLabel: "Começar",
      resumeLessonTitle: resume.lessonTitle
    };
  }

  // Em andamento ou nao iniciado sem aula liberada para abrir agora (tudo aguardando liberacao).
  return { resumeAriaLabel: null, resumeHref: null, resumeKind: null, resumeLabel: null, resumeLessonTitle: null };
}

function sortByLastActivity<T extends { lastWatchedAt: string | null }>(items: T[]) {
  return items
    .map((item, index) => ({ index, item, time: toMemberTimestamp(item.lastWatchedAt) }))
    .sort((left, right) => {
      if (left.time !== null && right.time !== null) return right.time - left.time || left.index - right.index;
      if (left.time !== null) return -1;
      if (right.time !== null) return 1;
      return left.index - right.index;
    })
    .map(({ item }) => item);
}

function getKindOptions(products: Array<{ kind: ContentKind }>): PurchasesKindOption[] {
  const counts = new Map<ContentKind, number>();

  for (const product of products) {
    counts.set(product.kind, (counts.get(product.kind) ?? 0) + 1);
  }

  return kindOrder
    .filter((kind) => counts.has(kind))
    .map((kind) => ({ count: counts.get(kind) ?? 0, id: kind, label: getPurchaseKindPluralLabel(kind) }));
}

function getStats(products: PurchaseProductView[]): PurchasesPageView["stats"] {
  return {
    completed: products.filter((product) => product.status === "completed").length,
    completedLessons: products.reduce((total, product) => total + product.completedLessons, 0),
    inProgress: products.filter((product) => product.status === "in_progress").length,
    notStarted: products.filter((product) => product.status === "not_started").length,
    products: products.length,
    totalLessons: products.reduce((total, product) => total + product.totalLessons, 0)
  };
}

/**
 * Produtos de Minhas compras com o progresso do aluno. Ordem: ultima atividade primeiro; depois os
 * ainda nao assistidos, na ordem do produtor. Cursos internos de formacao nao viram produto separado
 * (somam no progresso da formacao).
 */
export function buildPurchasesPageView(library: MemberLibrary, options: { now?: number } = {}): PurchasesPageView {
  const now = options.now ?? Date.now();
  const contentsById = indexMemberLibrary(library);

  const products = getMemberPurchasedContents(library).map((content): PurchaseProductView => {
    const summary = summarizeMemberContentProgress(content, contentsById, library.accessPreviewMode);
    const access = getPurchaseAccessLabel(content.access, now);
    const kindLabel = memberContentKindLabels[content.kind] ?? content.kind;
    const statusLabel = memberProgressStatusLabels[summary.status];

    return {
      accessEndsSoon: access.endsSoon,
      accessLabel: access.label,
      completedLessons: summary.completedLessons,
      eyebrow: content.eyebrow,
      href: content.href,
      id: content.id,
      image: content.image,
      kind: content.kind,
      kindLabel,
      lastWatchedAt: summary.lastWatchedAt,
      lockedLessons: summary.lockedLessons,
      percent: summary.percent,
      releaseLabel: content.isReleaseLocked ? content.releaseLabel ?? "Aguardando liberação" : null,
      ...getResume(
        content.kind,
        content.title,
        summary.status,
        content.href,
        summary.resume ? { href: summary.resume.href, lessonTitle: summary.resume.lesson.title } : null
      ),
      searchText: normalizeMemberSearchText([content.title, content.eyebrow, kindLabel, statusLabel].join(" ")),
      status: summary.status,
      statusLabel,
      title: content.title,
      totalLessons: summary.totalLessons
    };
  });

  const sorted = sortByLastActivity(products);
  const continueProduct = sorted.find((product) => product.resumeKind === "continue" && product.resumeHref);

  return {
    continueTarget: continueProduct?.resumeHref
      ? {
          href: continueProduct.resumeHref,
          lessonTitle: continueProduct.resumeLessonTitle ?? "",
          productTitle: continueProduct.title
        }
      : null,
    homeHref: withAccessPreviewParam("/", library.accessPreviewMode),
    kindOptions: getKindOptions(sorted),
    products: sorted,
    showProgress: true,
    stats: getStats(sorted)
  };
}

/**
 * Previa de layout sem aluno (purchases-experience sem a visao do servidor), que so tem os itens do
 * catalogo: sem progresso, sem acesso e sem acao (nada inventado).
 */
export function buildPurchasesPreviewView(items: ContentItem[]): PurchasesPageView {
  const products = items.map((item): PurchaseProductView => {
    const kindLabel = memberContentKindLabels[item.kind] ?? item.kind;

    return {
      accessEndsSoon: false,
      accessLabel: null,
      completedLessons: 0,
      eyebrow: item.eyebrow,
      href: getMemberContentHref(item.id),
      id: item.id,
      image: item.image,
      kind: item.kind,
      kindLabel,
      lastWatchedAt: null,
      lockedLessons: 0,
      percent: 0,
      releaseLabel: null,
      resumeAriaLabel: null,
      resumeHref: null,
      resumeKind: null,
      resumeLabel: null,
      resumeLessonTitle: null,
      searchText: normalizeMemberSearchText([item.title, item.eyebrow, kindLabel].join(" ")),
      status: "not_started",
      statusLabel: memberProgressStatusLabels.not_started,
      title: item.title,
      totalLessons: 0
    };
  });

  return {
    continueTarget: null,
    homeHref: "/",
    kindOptions: getKindOptions(products),
    products,
    showProgress: false,
    stats: getStats(products)
  };
}

/** "12 de 40 aulas", "40 aulas" (nao iniciado) ou "Aulas em breve" (produto sem aula publicada). */
export function getPurchaseLessonsMeta(product: Pick<PurchaseProductView, "completedLessons" | "status" | "totalLessons">) {
  if (product.totalLessons === 0) {
    return "Aulas em breve";
  }

  if (product.status === "not_started") {
    return formatMemberCount(product.totalLessons, "aula");
  }

  return `${product.completedLessons.toLocaleString("pt-BR")} de ${formatMemberCount(product.totalLessons, "aula")}`;
}
