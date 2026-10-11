// Lista de produtos (/admin/produtos): filtros no endereco, paginacao e textos curtos.
// Modulo puro (so imports de tipo): tests/admin-products-ui.test.mjs carrega direto pelo Node.
// Os nomes dos parametros sao os que parseProductListSearchParams (src/server/catalog/schemas.ts) le.

import type { ProductFormat, ProductSituation } from "@/server/catalog/model";

export const PRODUCT_LIST_PATH = "/admin/produtos";

export type ProductListFilters = {
  format?: ProductFormat;
  page?: number;
  q?: string;
  situation?: ProductSituation;
};

/** Pilulas de Situação, na ordem da tela; `undefined` = Todos. */
export const SITUATION_FILTERS: readonly { label: string; value: ProductSituation | undefined }[] = [
  { label: "Todos", value: undefined },
  { label: "Rascunho", value: "draft" },
  { label: "Publicado", value: "published" },
  { label: "Arquivado", value: "archived" }
];

/**
 * Endereco da lista com os filtros atuais trocados por `patch`. Mudar filtro volta para a pagina 1;
 * so `patch.page` muda a pagina. Valores vazios saem do endereco.
 */
export function buildProductListHref(current: ProductListFilters, patch: Partial<ProductListFilters> = {}) {
  const changesFilter = "format" in patch || "q" in patch || "situation" in patch;
  const next: ProductListFilters = { ...current, ...patch };
  const page = "page" in patch ? patch.page : changesFilter ? undefined : current.page;
  const params = new URLSearchParams();
  const q = next.q?.trim();

  if (next.situation) {
    params.set("situacao", next.situation);
  }

  if (next.format) {
    params.set("formato", next.format);
  }

  if (q) {
    params.set("busca", q);
  }

  if (page && page > 1) {
    params.set("pagina", String(page));
  }

  const query = params.toString();

  return query ? `${PRODUCT_LIST_PATH}?${query}` : PRODUCT_LIST_PATH;
}

export function hasActiveProductFilters(filters: ProductListFilters) {
  return Boolean(filters.format || filters.situation || filters.q?.trim());
}

export function describeProductCount(count: number) {
  return count === 1 ? "1 produto" : `${new Intl.NumberFormat("pt-BR").format(count)} produtos`;
}

export function pageCount(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
}

/** "1–25 de 80"; "0 de 0" quando vazio. */
export function describePageRange(page: number, pageSize: number, total: number) {
  const formatter = new Intl.NumberFormat("pt-BR");

  if (total <= 0) {
    return "0 de 0";
  }

  const start = Math.min((Math.max(1, page) - 1) * pageSize + 1, total);
  const end = Math.min(start + pageSize - 1, total);

  return `${formatter.format(start)}–${formatter.format(end)} de ${formatter.format(total)}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(amount: number, singular: string, pluralForm: string) {
  return `${amount} ${amount === 1 ? singular : pluralForm}`;
}

/** "agora mesmo", "há 5 min", "há 1 hora", "ontem", "há 3 dias", "há 2 semanas", "há 4 meses", "há 1 ano". */
export function formatRelativeUpdated(iso: string | null | undefined, now: Date = new Date()) {
  const time = iso ? new Date(iso).getTime() : Number.NaN;

  if (!Number.isFinite(time)) {
    return "—";
  }

  const elapsed = now.getTime() - time;

  if (elapsed < MINUTE) {
    return "agora mesmo";
  }

  if (elapsed < HOUR) {
    return `há ${Math.floor(elapsed / MINUTE)} min`;
  }

  if (elapsed < DAY) {
    return `há ${plural(Math.floor(elapsed / HOUR), "hora", "horas")}`;
  }

  if (elapsed < 2 * DAY) {
    return "ontem";
  }

  const days = Math.floor(elapsed / DAY);

  if (days < 7) {
    return `há ${days} dias`;
  }

  if (days < 30) {
    return `há ${plural(Math.floor(days / 7), "semana", "semanas")}`;
  }

  if (days < 365) {
    return `há ${plural(Math.floor(days / 30), "mês", "meses")}`;
  }

  return `há ${plural(Math.floor(days / 365), "ano", "anos")}`;
}

/** Data completa para o title do "Atualizado": "10/10/2026 às 14:32". */
export function formatFullDateTime(iso: string | null | undefined) {
  const date = iso ? new Date(iso) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }

  const day = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo", year: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", hourCycle: "h23", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(date);

  return `${day} às ${time}`;
}

/**
 * Texto mostrado na busca. O campo e do produtor enquanto ele digita; quando o endereco muda por
 * fora (Limpar filtros, voltar do navegador), o campo segue o endereco.
 * `typed.base` = o `busca` do endereco no momento da ultima tecla.
 */
export function resolveSearchText(addressQuery: string, typed: { base: string; text: string }) {
  return addressQuery === typed.base || addressQuery === typed.text.trim() ? typed.text : addressQuery;
}
