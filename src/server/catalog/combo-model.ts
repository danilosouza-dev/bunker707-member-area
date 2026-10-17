// Pacotes (antigos combos; docs/17 §1.6.8). Modulo puro, sem React e sem "server-only": o servidor
// (./combos.ts) usa para mapear as linhas do banco, a tela usa para rotular e montar
// o formulario, e tests/admin-combos.test.mjs carrega direto pelo Node.

import type { ComboListItem, ProductOption } from "./types";
import {
  formatFromKind,
  resolveProductAccent,
  situationFromPublicationStatus
} from "./model";

/* ------------------------------------------------------------------------------------------------
 * Linhas lidas do banco (colunas explicitas)
 * ---------------------------------------------------------------------------------------------- */

export type ComboRow = {
  cohort_name: string | null;
  description: string | null;
  id: string;
  name: string;
  status: string | null;
  updated_at: string | null;
};

export type ComboItemRow = { combo_id: string; product_id: string; sort_order: number | null };

export type ComboProductRow = {
  id: string;
  image: string | null;
  kind?: string | null;
  publication_status?: string | null;
  title: string;
};

export type ComboAccentRow = { accent: unknown; content_id: string };

/** Linha de sales_product_links de um pacote (so o provedor pedido). */
export type ComboSalesLinkRow = { combo_id: string | null; external_product_id: string };

/* ------------------------------------------------------------------------------------------------
 * Situacao do pacote
 * ---------------------------------------------------------------------------------------------- */

export const COMBO_STATUSES = ["draft", "active", "paused"] as const;
export type ComboStatus = (typeof COMBO_STATUSES)[number];

export const COMBO_STATUS_LABELS: Record<ComboStatus, string> = {
  active: "Ativo",
  draft: "Rascunho",
  paused: "Pausado"
};

/** Efeito de cada situacao, em uma frase (aparece abaixo das pilulas). */
export const COMBO_STATUS_HINTS: Record<ComboStatus, string> = {
  active: "Vendas deste pacote liberam todos os produtos dele.",
  draft: "Ainda em montagem: vendas deste pacote não liberam nada.",
  paused: "Vendas novas deste pacote não liberam nada até você reativar."
};

export function normalizeComboStatus(value: unknown): ComboStatus {
  return value === "active" || value === "paused" ? value : "draft";
}

export function comboStatusTone(status: ComboStatus): "success" | "warning" | "neutral" {
  return status === "active" ? "success" : status === "paused" ? "warning" : "neutral";
}

/** Turma padrao do banco (product_combos.cohort_name default 'Turma A'). */
export const DEFAULT_COHORT_NAME = "Turma A";

/** Produtos que podem entrar num pacote: os vendidos sozinhos (formacao, bootcamp, curso avulso). */
export const COMBO_PRODUCT_BUCKETS = ["formations", "bootcamps", "courses"] as const;

/* ------------------------------------------------------------------------------------------------
 * Mapeadores
 * ---------------------------------------------------------------------------------------------- */

/**
 * Linhas de product_combos + product_combo_items + content_items -> lista da tela. Produto que nao
 * existe mais e ignorado; a ordem dos produtos segue sort_order; os pacotes mais recentes primeiro.
 */
export function mapComboRows(input: {
  accents: readonly ComboAccentRow[];
  combos: readonly ComboRow[];
  items: readonly ComboItemRow[];
  products: readonly ComboProductRow[];
  /** Codigos na Hotmart (sales_product_links com provider hotmart). Ausente = nenhum pacote ligado. */
  salesLinks?: readonly ComboSalesLinkRow[];
}): ComboListItem[] {
  const productsById = new Map(input.products.map((product) => [product.id, product]));
  const accentById = new Map(input.accents.map((row) => [row.content_id, row.accent]));
  const hotmartByCombo = new Map((input.salesLinks ?? []).flatMap((row) => (row.combo_id ? [[row.combo_id, row.external_product_id] as const] : [])));
  const itemsByCombo = new Map<string, ComboItemRow[]>();

  for (const item of input.items) {
    const list = itemsByCombo.get(item.combo_id) ?? [];
    list.push(item);
    itemsByCombo.set(item.combo_id, list);
  }

  return input.combos
    .map((combo): ComboListItem => {
      const items = (itemsByCombo.get(combo.id) ?? []).slice().sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0));

      return {
        cohortName: combo.cohort_name?.trim() || DEFAULT_COHORT_NAME,
        description: combo.description ?? "",
        hotmartProductId: hotmartByCombo.get(combo.id) ?? null,
        id: combo.id,
        name: combo.name,
        products: items.flatMap((item) => {
          const product = productsById.get(item.product_id);

          return product
            ? [
                {
                  accent: resolveProductAccent(product.id, accentById.get(product.id)),
                  coverUrl: product.image?.trim() ? product.image.trim() : null,
                  id: product.id,
                  title: product.title
                }
              ]
            : [];
        }),
        status: normalizeComboStatus(combo.status),
        updatedAt: combo.updated_at ?? ""
      };
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name, "pt-BR"));
}

/** Linha de content_items -> opcao do seletor de produtos do pacote. Formato desconhecido fica de fora. */
export function mapComboProductOptions(products: readonly ComboProductRow[], accents: readonly ComboAccentRow[]): ProductOption[] {
  const accentById = new Map(accents.map((row) => [row.content_id, row.accent]));

  return products
    .flatMap((product): ProductOption[] => {
      const format = formatFromKind(product.kind);

      return format
        ? [
            {
              accent: resolveProductAccent(product.id, accentById.get(product.id)),
              coverUrl: product.image?.trim() ? product.image.trim() : null,
              format,
              id: product.id,
              situation: situationFromPublicationStatus(product.publication_status),
              title: product.title
            }
          ]
        : [];
    })
    .sort((left, right) => left.title.localeCompare(right.title, "pt-BR"));
}

/* ------------------------------------------------------------------------------------------------
 * Formulario
 * ---------------------------------------------------------------------------------------------- */

export type ComboFormState = {
  cohortName: string;
  description: string;
  /** Codigo do pacote na Hotmart; "" = sem ligacao. */
  hotmartProductId: string;
  name: string;
  productIds: string[];
  status: ComboStatus;
};

export function comboToForm(combo?: ComboListItem | null): ComboFormState {
  return combo
    ? {
        cohortName: combo.cohortName === DEFAULT_COHORT_NAME ? "" : combo.cohortName,
        description: combo.description,
        hotmartProductId: combo.hotmartProductId ?? "",
        name: combo.name,
        productIds: combo.products.map((product) => product.id),
        status: combo.status
      }
    : { cohortName: "", description: "", hotmartProductId: "", name: "", productIds: [], status: "draft" };
}

/** Entrada de saveCombo (comboSchema): turma vazia vira a turma padrao no servidor. */
export function formToComboInput(form: ComboFormState, id?: string) {
  return {
    cohortName: form.cohortName.trim(),
    description: form.description.trim(),
    hotmartProductId: form.hotmartProductId.trim(),
    ...(id ? { id } : {}),
    name: form.name.trim(),
    productIds: Array.from(new Set(form.productIds)),
    status: form.status
  };
}

export function isComboFormDirty(left: ComboFormState, right: ComboFormState) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

/** Primeiras capas da linha da tabela e quantos produtos ficaram de fora. */
export function summarizeComboProducts<Product>(products: readonly Product[], max = 3) {
  return { extra: Math.max(0, products.length - max), visible: products.slice(0, max) };
}

/* ------------------------------------------------------------------------------------------------
 * Datas
 * ---------------------------------------------------------------------------------------------- */

const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });

/** "há 5 min", "há 3 h", "ontem", "há 4 dias", "há 2 semanas"; acima de 8 semanas, a data. Sem data: "—". */
export function formatRelativeDate(value: string | null | undefined, now: Date = new Date()) {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "—";
  }

  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);

  if (minutes < 1) {
    return "agora há pouco";
  }

  if (minutes < 60) {
    return `há ${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `há ${hours} h`;
  }

  const days = Math.floor(hours / 24);

  if (days === 1) {
    return "ontem";
  }

  if (days < 14) {
    return `há ${days} dias`;
  }

  const weeks = Math.floor(days / 7);

  return weeks <= 8 ? `há ${weeks} semanas` : shortDateFormatter.format(date);
}
