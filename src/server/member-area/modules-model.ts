// Area de membros > Modulos (plano da rodada, frente MODULOS; docs/17 §1.6.8). Por produto: como abre
// (cards de modulos ou direto nas aulas), se os modulos aparecem numa fileira da home e quantos modulos
// ja tem capa propria. Modulo puro (sem "server-only", sem React, so imports de tipo por alias): as
// Server Actions usam para decidir o que gravar, as telas para rotular e
// tests/member-area-modules.test.mjs carrega direto pelo Node.
//
// Fonte de verdade da fileira de modulos na home = a Vitrine (platform_settings.homeSections): uma
// fileira `content_structure` com `sourceContentId` = produto. Gravar so o antigo
// content_page_settings.homeModuleSection nao teria efeito depois que a Vitrine e publicada (a home do
// aluno ignora a chave), entao o interruptor liga/desliga a fileira da Vitrine e a chave antiga vira
// so espelho para o admin legado.

import { z } from "zod";
import type { HomeSectionConfig } from "@/lib/platform-types";
import { catalogIdSchema } from "../catalog/schemas";
import { SECTION_TITLE_MAX, makeSectionId, normalizeSectionOrder, type StorefrontProduct } from "../storefront/model";

/* ------------------------------------------------------------------------------------------------
 * Tipos
 * ---------------------------------------------------------------------------------------------- */

export type CoursePresentationModeValue = "module_cards" | "lesson_playlist";

export type HomeModuleRowState = {
  /** on = aparece (ou vai aparecer) na home; off = desligada; unavailable = este produto nao pode ter fileira. */
  status: "on" | "off" | "unavailable";
  /** Por que nao da, ou por que nao aparece agora (ex.: "Aparece depois de publicar."). */
  note: string | null;
  /** Titulo da fileira (ou o nome do produto, se nunca ligada). */
  title: string;
  sectionId: string | null;
  /** Posicao 1..n entre as fileiras visiveis da Vitrine (so quando ligada). */
  position: number | null;
  /** Titulo da fileira visivel logo antes (null = primeira da home ou desligada). */
  afterTitle: string | null;
  /** false = a Vitrine nunca foi publicada (a home segue a ordem padrao). */
  vitrineConfigured: boolean;
};

/* ------------------------------------------------------------------------------------------------
 * Entradas das Server Actions
 * ---------------------------------------------------------------------------------------------- */

export const COURSE_PRESENTATION_MODES = ["module_cards", "lesson_playlist"] as const satisfies readonly CoursePresentationModeValue[];

export const setProductOpensAsSchema = z.object({
  mode: z.enum(COURSE_PRESENTATION_MODES, { error: "Escolha como o produto abre." }),
  productId: catalogIdSchema
});

export const homeModuleRowTitleSchema = z
  .string({ error: "Dê um título à fileira." })
  .trim()
  .min(1, "Dê um título à fileira.")
  .max(SECTION_TITLE_MAX, `Use no máximo ${SECTION_TITLE_MAX} caracteres.`);

export const setHomeModuleRowSchema = z.object({
  enabled: z.boolean({ error: "Diga se a fileira aparece ou não." }),
  productId: catalogIdSchema,
  title: homeModuleRowTitleSchema.optional()
});

export type SetProductOpensAsInput = z.input<typeof setProductOpensAsSchema>;
export type SetHomeModuleRowInput = z.input<typeof setHomeModuleRowSchema>;

/* ------------------------------------------------------------------------------------------------
 * Busca e pagina da tela (?busca=&pagina=)
 * ---------------------------------------------------------------------------------------------- */

export const MODULE_SETTINGS_PATH = "/admin/area-de-membros/modulos";
export const MODULE_SETTINGS_PAGE_SIZE = 25;

/** Formatos que tem modulos (tudo menos Formação, que abre nos cursos dela). */
export const MODULE_SETTINGS_KINDS = ["Curso", "Mentoria", "Bootcamp", "Produto", "Material", "Webinario"] as const;

export const moduleSettingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000).default(1).catch(1),
  q: z
    .string()
    .trim()
    .max(80)
    .optional()
    .catch(undefined)
    .transform((value) => value || undefined)
});

export type ModuleSettingsQuery = { page: number; q?: string };

type SearchParamsLike = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** searchParams da tela -> consulta valida; lixo vira o padrao (pagina 1, sem busca). */
export function parseModuleSettingsSearchParams(searchParams: SearchParamsLike): ModuleSettingsQuery {
  const parsed = moduleSettingsQuerySchema.parse({
    page: first(searchParams.pagina) || undefined,
    q: first(searchParams.busca) || undefined
  });

  return parsed.q ? { page: parsed.page, q: parsed.q } : { page: parsed.page };
}

/** Endereco da tela com a busca e a pagina; mudar a busca volta para a pagina 1. */
export function buildModuleSettingsHref(current: { page?: number; q?: string }, patch: { page?: number; q?: string } = {}) {
  const q = ("q" in patch ? patch.q : current.q)?.trim();
  const page = "page" in patch ? patch.page : "q" in patch ? undefined : current.page;
  const params = new URLSearchParams();

  if (q) {
    params.set("busca", q);
  }

  if (page && page > 1) {
    params.set("pagina", String(page));
  }

  const query = params.toString();

  return query ? `${MODULE_SETTINGS_PATH}?${query}` : MODULE_SETTINGS_PATH;
}

/* ------------------------------------------------------------------------------------------------
 * Fileira de modulos na home
 * ---------------------------------------------------------------------------------------------- */

/** 422: o produto nao pode ter fileira de modulos (curso de formacao, "em breve", formacao). */
export class HomeModuleRowRuleError extends Error {
  status = 422 as const;

  constructor(message: string) {
    super(message);
    this.name = "HomeModuleRowRuleError";
  }
}

export const HOME_ROW_NOTES = {
  archived: "Produto arquivado: a fileira não aparece.",
  draft: "Aparece depois de publicar.",
  formation: "A formação aparece na home com os cursos dela. Monte essa fileira na Vitrine.",
  hidden: "Produto oculto: a fileira só aparece para quem já tem acesso.",
  included: "Curso dentro de uma formação aparece pela formação.",
  noModules: "Sem módulos publicados: a fileira aparece quando houver.",
  upcoming: "Produto em breve: a fileira pode ser ligada depois do lançamento."
} as const;

function isModuleRowFor(section: HomeSectionConfig, productId: string) {
  return (
    section.sectionType === "content_structure" &&
    section.contentSource === "selected_content_structure" &&
    section.sourceContentId === productId
  );
}

/** Fileiras de modulos deste produto, na ordem da Vitrine. */
export function findModuleRows(sections: readonly HomeSectionConfig[], productId: string) {
  return normalizeSectionOrder(sections).filter((section) => isModuleRowFor(section, productId));
}

/** A fileira que representa o produto: a primeira visivel, senao a primeira. */
function primaryModuleRow(sections: readonly HomeSectionConfig[], productId: string) {
  const rows = findModuleRows(sections, productId);

  return rows.find((section) => section.isActive) ?? rows[0] ?? null;
}

/** Motivo para o produto nao poder ter fileira; null = pode. */
export function homeModuleRowBlocker(product: Pick<StorefrontProduct, "kind" | "sellable" | "upcoming"> | undefined): string | null {
  if (!product) {
    return HOME_ROW_NOTES.included;
  }

  if (product.kind === "Formacao") {
    return HOME_ROW_NOTES.formation;
  }

  if (product.upcoming) {
    return HOME_ROW_NOTES.upcoming;
  }

  return product.sellable ? null : HOME_ROW_NOTES.included;
}

function attentionNote(product: StorefrontProduct) {
  if (product.situation === "draft") {
    return HOME_ROW_NOTES.draft;
  }

  if (product.situation === "archived") {
    return HOME_ROW_NOTES.archived;
  }

  if (!product.listed) {
    return HOME_ROW_NOTES.hidden;
  }

  return product.modulesCount > 0 ? null : HOME_ROW_NOTES.noModules;
}

/**
 * Estado do interruptor "Fileira na home" de um produto. `sections` = as fileiras gravadas ou, com a
 * Vitrine nunca publicada, a ordem padrao (buildDefaultSections, que ja traz a fileira dos produtos
 * com homeModuleSection ligado).
 */
export function computeHomeModuleRowState(
  product: StorefrontProduct | undefined,
  sections: readonly HomeSectionConfig[],
  vitrineConfigured: boolean
): HomeModuleRowState {
  const blocker = homeModuleRowBlocker(product);

  if (!product || blocker) {
    return {
      afterTitle: null,
      note: blocker,
      position: null,
      sectionId: null,
      status: "unavailable",
      title: product?.title ?? "",
      vitrineConfigured
    };
  }

  const ordered = normalizeSectionOrder(sections);
  const row = primaryModuleRow(ordered, product.id);

  if (!row) {
    return {
      afterTitle: null,
      note: attentionNote(product),
      position: null,
      sectionId: null,
      status: "off",
      title: product.title,
      vitrineConfigured
    };
  }

  if (!row.isActive) {
    return {
      afterTitle: null,
      note: attentionNote(product),
      position: null,
      sectionId: row.id,
      status: "off",
      title: row.title,
      vitrineConfigured
    };
  }

  const visible = ordered.filter((section) => section.isActive);
  const index = visible.findIndex((section) => section.id === row.id);

  return {
    afterTitle: index > 0 ? visible[index - 1].title : null,
    note: attentionNote(product),
    position: index + 1,
    sectionId: row.id,
    status: "on",
    title: row.title,
    vitrineConfigured
  };
}

/** Onde a fileira nova entra: antes de "Produtos à venda"; sem ela, depois de "Minhas compras"; senao no fim. */
function insertionIndex(ordered: readonly HomeSectionConfig[]) {
  const showcase = ordered.findIndex((section) => section.contentSource === "sellable_products");

  if (showcase >= 0) {
    return showcase;
  }

  const purchases = ordered.findIndex((section) => section.contentSource === "entitlement_products");

  return purchases >= 0 ? purchases + 1 : ordered.length;
}

function cleanTitle(value: string | undefined) {
  const title = value?.trim().slice(0, SECTION_TITLE_MAX).trim();

  return title ? title : undefined;
}

/**
 * Liga ou desliga a fileira de modulos do produto na lista da Vitrine (estado desejado, idempotente).
 * - Liga: reativa a fileira que ja existe (sem duplicar) ou cria uma ("compact", "Todos os alunos")
 *   antes de "Produtos à venda" (senao depois de "Minhas compras", senao no fim).
 * - Desliga: isActive = false em todas as fileiras do produto; titulo e posicao ficam.
 * - `title` (opcional) troca o titulo da fileira principal.
 * Produto que nao pode ter fileira: HomeModuleRowRuleError (422).
 */
export function applyHomeModuleRow(
  sections: readonly HomeSectionConfig[],
  product: StorefrontProduct,
  desired: { enabled: boolean; title?: string },
  now: number = Date.now()
): { changed: boolean; sectionId: string | null; sections: HomeSectionConfig[] } {
  const blocker = homeModuleRowBlocker(product);

  if (blocker) {
    throw new HomeModuleRowRuleError(blocker);
  }

  const ordered = normalizeSectionOrder(sections);
  const title = cleanTitle(desired.title);
  const primary = primaryModuleRow(ordered, product.id);
  let changed = false;

  if (desired.enabled && !primary) {
    const created: HomeSectionConfig = {
      contentSource: "selected_content_structure",
      id: makeSectionId(ordered, now),
      isActive: true,
      itemIds: [],
      layout: "compact",
      order: 0,
      sectionType: "content_structure",
      sourceContentId: product.id,
      title: title ?? (cleanTitle(product.title) || "Fileira de módulos"),
      visibility: "all"
    };
    const next = ordered.slice();
    next.splice(insertionIndex(ordered), 0, created);

    return { changed: true, sectionId: created.id, sections: next.map((section, order) => ({ ...section, order })) };
  }

  const next = ordered.map((section) => {
    if (!isModuleRowFor(section, product.id)) {
      return section;
    }

    const isPrimary = section.id === primary?.id;
    const isActive = desired.enabled ? (isPrimary ? true : section.isActive) : false;
    const nextTitle = isPrimary && title ? title : section.title;

    if (isActive === section.isActive && nextTitle === section.title) {
      return section;
    }

    changed = true;

    return { ...section, isActive, title: nextTitle };
  });

  return { changed, sectionId: primary?.id ?? null, sections: next };
}

/** Toast curto depois de mudar a fileira. */
export function describeHomeRowChange(previous: Pick<HomeModuleRowState, "status" | "title">, next: HomeModuleRowState) {
  if (next.status === "on" && previous.status !== "on") {
    return next.afterTitle ? `Fileira ligada: aparece na home depois de “${next.afterTitle}”` : "Fileira ligada: aparece no topo da home";
  }

  if (next.status === "off" && previous.status === "on") {
    return "Fileira desligada";
  }

  return previous.title !== next.title ? "Título da fileira salvo" : "Fileira salva";
}

/* ------------------------------------------------------------------------------------------------
 * Capas dos modulos
 * ---------------------------------------------------------------------------------------------- */

function trimmed(value: string | null | undefined) {
  return value?.trim() ?? "";
}

/**
 * O modulo usa a capa do produto? Sem capa propria (vazio) ou igual a do produto: sim. (O modulo
 * nasce com uma copia da capa do produto; "Usar a capa do produto" grava a capa atual dele.)
 */
export function moduleUsesProductCover(moduleImage: string | null | undefined, productImage: string | null | undefined) {
  const own = trimmed(moduleImage);

  return !own || own === trimmed(productImage);
}

/** Capa propria = nao vazia e diferente da capa do produto. */
export function countOwnModuleCovers(modules: readonly { image: string | null }[], productCover: string | null) {
  return modules.filter((module) => !moduleUsesProductCover(module.image, productCover)).length;
}

/** "3 de 5 com capa própria", "Nenhum módulo ainda". */
export function describeModuleCovers(withOwnCover: number, total: number) {
  if (total <= 0) {
    return "Nenhum módulo ainda";
  }

  return `${Math.min(Math.max(0, withOwnCover), total)} de ${total} com capa própria`;
}

/** O que gravar em course_modules.image para "Usar a capa do produto" (a coluna e not null). */
export function productCoverForModule(productImage: string | null | undefined) {
  return trimmed(productImage);
}
