// Regras de escrita de Produtos (fase 1, decisoes 4, 10, 14 e 15 do plano). Modulo puro: as Server
// Actions chamam estas funcoes antes de gravar e tests/catalog-server.test.mjs prova cada regra sem banco.

import type { LessonVideoConfig } from "@/lib/platform-types";
import { detectLessonVideo, looksLikeVideoLink } from "../../lib/video-detect";
import { normalizeLessonVideoConfig } from "../../lib/video-embed";
import { CatalogConflictError, CatalogRuleError } from "./errors";
import {
  MAX_LESSONS_PER_MODULE,
  MAX_MODULES_PER_PRODUCT,
  MAX_STRUCTURE_LESSONS_PER_MODULE,
  MAX_STRUCTURE_MODULES,
  PRODUCT_FORMAT_LABELS,
  audienceToColumns,
  deriveLegacyContentStatus,
  deriveLegacyPurchaseLabel,
  type ProductAudience,
  type ProductFormat
} from "./model";

/* ------------------------------------------------------------------------------------------------
 * Rotulos legados
 * ---------------------------------------------------------------------------------------------- */

/** course_modules.meta e content_items.lessons_label: "1 aula", "3 aulas" (mesmo texto do legado). */
export function lessonCountLabel(count: number) {
  return `${count} ${count === 1 ? "aula" : "aulas"}`;
}

/** Eyebrow de modulo novo: "Módulo 03". */
export function moduleEyebrow(position: number) {
  return `Módulo ${String(position).padStart(2, "0")}`;
}

/** Titulo de aula sem titulo nem sugestao do provedor: "Aula N" (posicao no modulo). */
export function fallbackLessonTitle(position: number) {
  return `Aula ${position}`;
}

/** Titulos longos do provedor cabem no limite da arvore (120). */
export function clampTitle(value: string, max = 120) {
  const title = value.replace(/\s+/g, " ").trim();

  return title.length > max ? `${title.slice(0, max - 1).trimEnd()}…` : title;
}

/* ------------------------------------------------------------------------------------------------
 * Quem pode ver + colunas legadas derivadas (decisoes 2 e 3)
 * ---------------------------------------------------------------------------------------------- */

export type AccessColumns = {
  access_model: "closed" | "free";
  is_locked: boolean;
  listing: "hidden" | "listed";
  purchase_label: string | null;
  status: "Bloqueado" | "Liberado";
};

/** Colunas gravadas para "Quem pode ver" + link + texto proprio do botao. Nunca grava "Em breve". */
export function accessColumnsFor(input: {
  audience: ProductAudience;
  purchaseLabel?: string | null;
  purchaseUrl?: string | null;
}): AccessColumns {
  const columns = audienceToColumns(input.audience);

  return {
    access_model: columns.access_model,
    is_locked: columns.is_locked,
    listing: columns.listing,
    purchase_label: deriveLegacyPurchaseLabel(input),
    status: deriveLegacyContentStatus(input.audience) === "Liberado" ? "Liberado" : "Bloqueado"
  };
}

/* ------------------------------------------------------------------------------------------------
 * Formato (decisao 4)
 * ---------------------------------------------------------------------------------------------- */

export const FORMAT_LOCKED_BY_STUDENTS = "Este produto já tem alunos; o formato não pode mudar.";
export const FORMAT_LOCKED_FORMATION = "Formação não troca de formato. Crie um produto novo para isso.";
export const FORMAT_LOCKED_INCLUDED = "Curso dentro de uma formação continua sendo curso.";

/**
 * Trocar formato na aba Detalhes: so sem acessos ativos e nunca de/para Formacao (o tipo do acesso
 * gravado depende do formato). Curso incluido em formacao nao troca. Mesmo formato = nada a fazer.
 */
export function assertFormatChange(input: {
  activeAccessCount: number;
  current: ProductFormat;
  isIncludedCourse: boolean;
  next: ProductFormat;
}) {
  if (input.current === input.next) {
    return false;
  }

  if (input.current === "formacao" || input.next === "formacao") {
    throw new CatalogConflictError(FORMAT_LOCKED_FORMATION);
  }

  if (input.isIncludedCourse) {
    throw new CatalogConflictError(FORMAT_LOCKED_INCLUDED);
  }

  if (input.activeAccessCount > 0) {
    throw new CatalogConflictError(FORMAT_LOCKED_BY_STUDENTS);
  }

  return true;
}

/** Eyebrow/rotulo de acesso que eram so o nome do formato acompanham a troca; texto proprio fica. */
export function relabelForFormat(current: string | null | undefined, from: ProductFormat, fromKind: string, to: ProductFormat) {
  const value = current?.trim() ?? "";

  if (!value || value === PRODUCT_FORMAT_LABELS[from] || value === fromKind) {
    return PRODUCT_FORMAT_LABELS[to];
  }

  return value;
}

/* ------------------------------------------------------------------------------------------------
 * Excluir produto
 * ---------------------------------------------------------------------------------------------- */

function normalizeTitleForConfirmation(value: string) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
}

/** Confirmacao digitando o nome, sem diferenciar maiusculas nem espacos repetidos. */
export function titlesMatch(typed: string, title: string) {
  return normalizeTitleForConfirmation(typed) === normalizeTitleForConfirmation(title);
}

export const DELETE_CONFIRMATION_MISMATCH = "O nome digitado não confere. Digite o nome do produto para confirmar.";
export const DELETE_FORMATION_WITH_COURSES = "Remova ou exclua os cursos desta formação antes.";

export function assertCanDeleteProduct(input: {
  confirmTitle: string;
  format: ProductFormat;
  includedCourses: number;
  title: string;
}) {
  if (!titlesMatch(input.confirmTitle, input.title)) {
    throw new CatalogRuleError(DELETE_CONFIRMATION_MISMATCH);
  }

  if (input.format === "formacao" && input.includedCourses > 0) {
    throw new CatalogConflictError(DELETE_FORMATION_WITH_COURSES);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Formação (decisao 15)
 * ---------------------------------------------------------------------------------------------- */

export const FORMATION_ONLY_COURSES = "Só cursos entram numa formação.";
export const FORMATION_INVALID = "Escolha uma formação válida.";
export const COURSE_HAS_OWN_STUDENTS = "Este curso já tem alunos próprios; ele não pode entrar numa formação.";
export const COURSE_IN_OTHER_FORMATION = "Este curso já faz parte de outra formação.";
export const COURSE_NOT_IN_FORMATION = "Este curso não faz parte desta formação.";

/**
 * "Adicionar curso existente": so formato Curso, sem acessos ativos proprios e fora de outra formacao.
 * Devolve "already" quando o curso ja esta nesta formacao (nada a gravar).
 */
export function assertCourseCanJoinFormation(input: {
  activeAccessCount: number;
  course: { format: ProductFormat | null; id: string; parentFormationId: string | null };
  formation: { format: ProductFormat | null; id: string };
}): "already" | "ok" {
  if (input.formation.format !== "formacao" || input.formation.id === input.course.id) {
    throw new CatalogRuleError(FORMATION_INVALID);
  }

  if (input.course.format !== "curso") {
    throw new CatalogRuleError(FORMATION_ONLY_COURSES);
  }

  if (input.course.parentFormationId === input.formation.id) {
    return "already";
  }

  if (input.course.parentFormationId) {
    throw new CatalogConflictError(COURSE_IN_OTHER_FORMATION);
  }

  if (input.activeAccessCount > 0) {
    throw new CatalogConflictError(COURSE_HAS_OWN_STUDENTS);
  }

  return "ok";
}

/* ------------------------------------------------------------------------------------------------
 * Ordem
 * ---------------------------------------------------------------------------------------------- */

export const STALE_STRUCTURE_MESSAGE = "A ordem mudou em outro lugar há instantes. Recarregue para ver a versão atual.";

/** Erro da RPC admin_reorder_product_content: 'stale_structure' vira 409; o resto segue como esta. */
export function translateReorderError(error: unknown): unknown {
  const message = error && typeof error === "object" ? (error as { message?: unknown }).message : error;

  if (typeof message === "string" && message.includes("stale_structure")) {
    return new CatalogConflictError(STALE_STRUCTURE_MESSAGE);
  }

  return error;
}

/** Mesmo conjunto de ids, sem repeticao (a ordem pode ser outra). */
export function sameIdSet(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);

  return new Set(left).size === left.length && left.every((id) => rightSet.has(id));
}

/** Ordem completa da aba Conteudo: sem id repetido; o conjunto e conferido de novo dentro da RPC. */
export function assertReorderPayload(modules: readonly { id: string; lessonIds: readonly string[] }[]) {
  const moduleIds = modules.map((module) => module.id);
  const lessonIds = modules.flatMap((module) => module.lessonIds);

  if (new Set(moduleIds).size !== moduleIds.length || new Set(lessonIds).size !== lessonIds.length) {
    throw new CatalogConflictError(STALE_STRUCTURE_MESSAGE);
  }

  // Limite da estrutura existente (o mesmo da importacao), nao o de criacao: reordenar manda tudo.
  if (
    modules.length > MAX_STRUCTURE_MODULES ||
    modules.some((module) => module.lessonIds.length > MAX_STRUCTURE_LESSONS_PER_MODULE)
  ) {
    throw new CatalogRuleError(
      `Use no máximo ${MAX_STRUCTURE_MODULES} módulos e ${MAX_STRUCTURE_LESSONS_PER_MODULE} aulas por módulo.`
    );
  }
}

/** Reordenar cursos da formacao: conjunto identico ao atual, senao 409. */
export function planFormationOrder(currentIds: readonly string[], orderedIds: readonly string[]) {
  if (!sameIdSet(currentIds, orderedIds)) {
    throw new CatalogConflictError(STALE_STRUCTURE_MESSAGE);
  }

  return orderedIds.map((id, index) => ({ id, sort_order: index }));
}

/**
 * Inserir um modulo logo depois de `afterModuleId` (ou no fim): devolve a nova ordem completa e so as
 * linhas cujo sort_order muda (o modulo novo incluido).
 */
export function planModuleInsertion(
  existing: readonly { id: string; sort_order: number }[],
  newModuleId: string,
  afterModuleId?: string
) {
  const ordered = existing.slice().sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));
  const afterIndex = afterModuleId ? ordered.findIndex((module) => module.id === afterModuleId) : -1;
  const insertAt = afterIndex >= 0 ? afterIndex + 1 : ordered.length;
  const next = [...ordered.slice(0, insertAt), { id: newModuleId, sort_order: Number.NaN }, ...ordered.slice(insertAt)];
  const updates = next.flatMap((module, index) => (module.sort_order === index ? [] : [{ id: module.id, sort_order: index }]));

  return { position: insertAt + 1, updates };
}

/** Produto novo entra no topo do seu grupo (mesmo comportamento do legado, que faz unshift). */
export function sortOrderAtTop(minSortOrder: number | null | undefined) {
  return typeof minSortOrder === "number" && Number.isFinite(minSortOrder) ? minSortOrder - 1 : 0;
}

/** Curso novo dentro da formacao entra no fim da lista dela. */
export function sortOrderAtEnd(maxSortOrder: number | null | undefined) {
  return typeof maxSortOrder === "number" && Number.isFinite(maxSortOrder) ? maxSortOrder + 1 : 0;
}

/* ------------------------------------------------------------------------------------------------
 * Aulas novas (Enter, colar varias linhas, colar um link no nome)
 * ---------------------------------------------------------------------------------------------- */

export type PlannedLesson = {
  /** O titulo veio vazio: o servidor tenta o titulo do provedor, senao "Aula N". */
  needsTitle: boolean;
  title: string;
  video: LessonVideoConfig | null;
};

/**
 * Cada linha vira uma aula; linha sem titulo e sem video reconhecido e pulada (`skipped`). Um link
 * colado no lugar do nome vira o video da aula. O provedor e sempre reconhecido de novo aqui, no
 * servidor, e o resultado passa por normalizeLessonVideoConfig antes de ser gravado.
 */
export function planLessonCreation(items: readonly { title?: string; videoInput?: string }[]) {
  const lessons: PlannedLesson[] = [];
  let skipped = 0;

  for (const item of items) {
    let title = (item.title ?? "").trim();
    let videoInput = (item.videoInput ?? "").trim();

    if (!videoInput && looksLikeVideoLink(title)) {
      videoInput = title;
      title = "";
    }

    const detection = videoInput ? detectLessonVideo(videoInput) : null;
    const video = detection?.ok ? normalizeLessonVideoConfig(detection.config) : null;

    if (!title && !video) {
      skipped += 1;
      continue;
    }

    lessons.push({ needsTitle: !title, title: title ? clampTitle(title) : "", video });
  }

  return { lessons, skipped };
}

export function assertModuleCapacity(existing: number, adding: number) {
  if (existing + adding > MAX_LESSONS_PER_MODULE) {
    const room = Math.max(0, MAX_LESSONS_PER_MODULE - existing);

    throw new CatalogRuleError(
      room === 0
        ? `Este módulo já tem ${MAX_LESSONS_PER_MODULE} aulas, o limite. Crie outro módulo.`
        : `Este módulo comporta mais ${room} ${room === 1 ? "aula" : "aulas"} (limite de ${MAX_LESSONS_PER_MODULE}).`
    );
  }
}

export function assertProductModuleCapacity(existing: number) {
  if (existing >= MAX_MODULES_PER_PRODUCT) {
    throw new CatalogRuleError(`Este produto já tem ${MAX_MODULES_PER_PRODUCT} módulos, o limite.`);
  }
}

/** Status anterior valido para desfazer uma exclusao (modulo antigo sem status conhecido volta publicado). */
export function restorableStatus(value: unknown): "draft" | "published" {
  return value === "draft" ? "draft" : "published";
}
