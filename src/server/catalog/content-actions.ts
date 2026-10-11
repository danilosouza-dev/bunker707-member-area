"use server";

// Server Actions da aba Conteúdo (docs/17 §1.6.3 e §1.6.4): modulos, aulas, exclusao com Desfazer,
// reordenar de uma vez e sugestoes do provedor de video. Escrita granular por linha (nunca a tabela
// inteira), status 'deleted' no lugar de apagar e invalidateCatalog depois de toda gravacao.

import type { ActionResult } from "@/lib/action-result";
import type { LessonVideoConfig } from "@/lib/platform-types";
import { detectLessonVideo } from "@/lib/video-detect";
import { normalizeLessonVideoConfig } from "@/lib/video-embed";
import { runAdminAction } from "@/server/actions/run-action";
import { invalidateCatalog } from "@/server/catalog/cache";
import { CatalogFieldError, CatalogNotFoundError, CatalogRuleError } from "./errors";
import {
  LESSON_COLUMNS,
  MODULE_COLUMNS,
  buildModuleTree,
  lessonThumbnailOf,
  mapLessonNode,
  mapModuleNode,
  productFormatOf,
  shouldRefreshLessonThumbnail,
  type LessonRow,
  type ModuleRow
} from "./mappers";
import {
  initialLessonStatus,
  makeCatalogId,
  releasePhraseToRule,
  situationFromPublicationStatus
} from "./model";
import {
  assertModuleCapacity,
  assertProductModuleCapacity,
  assertReorderPayload,
  clampTitle,
  fallbackLessonTitle,
  lessonCountLabel,
  moduleEyebrow,
  planLessonCreation,
  planModuleInsertion,
  restorableStatus,
  translateReorderError
} from "./rules";
import {
  createLessonsSchema,
  createModuleSchema,
  reorderContentSchema,
  restoreStructureSchema,
  setLessonsStatusSchema,
  softDeleteStructureSchema,
  updateLessonSchema,
  updateModuleSchema,
  videoPreviewSchema
} from "./schemas";
import {
  catalogDb,
  failOnError,
  fetchLessonRow,
  fetchLessonsFor,
  fetchModuleRow,
  fetchModulesFor,
  fetchProductStructure,
  refreshModuleMeta,
  requireProductRow,
  updateRowGuarded,
  type CatalogDb
} from "./store";
import type {
  ContentReordered,
  CreateLessonsInput,
  CreateModuleInput,
  LessonNode,
  LessonStatus,
  ModuleNode,
  ReorderContentInput,
  RestoreStructureInput,
  SetLessonsStatusInput,
  SoftDeleteStructureInput,
  StructureDeleted,
  UpdateLessonInput,
  UpdateModuleInput,
  VideoPreview,
  VideoPreviewInput
} from "./types";
import { EMPTY_VIDEO_METADATA, fetchVideoMetadata, fetchVideoMetadataBatch } from "./video-meta";

const MODULE_NOT_FOUND = "Não encontramos este módulo. Ele pode ter sido excluído.";
const LESSON_NOT_FOUND = "Não encontramos esta aula. Ela pode ter sido excluída.";

async function requireModule(moduleId: string, db: CatalogDb) {
  const found = await fetchModuleRow(moduleId, db);

  if (!found || !found.owner_id) {
    throw new CatalogNotFoundError(MODULE_NOT_FOUND);
  }

  return found as ModuleRow & { owner_id: string };
}

/** ModuleNode de um modulo com as aulas dele e a posicao no produto. */
async function moduleNodeFor(module: ModuleRow, db: CatalogDb): Promise<ModuleNode> {
  const siblings = module.owner_id ? await fetchModulesFor([module.owner_id], db) : [module];
  const ordered = buildModuleTree(siblings, []);
  const position = ordered.findIndex((node) => node.id === module.id) + 1;
  const lessons = await fetchLessonsFor([module.id], db);

  return mapModuleNode(module, position > 0 ? position : 1, lessons);
}

/** Posicao 1..n de uma aula dentro do modulo (aulas nao excluidas). */
async function lessonPosition(lesson: LessonRow, db: CatalogDb) {
  const lessons = await fetchLessonsFor([lesson.module_id], db);
  const index = lessons
    .slice()
    .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id))
    .findIndex((row) => row.id === lesson.id);

  return index >= 0 ? index + 1 : 1;
}

/* ------------------------------------------------------------------------------------------------
 * Módulos
 * ---------------------------------------------------------------------------------------------- */

/** [catalog.write] */
export async function createModule(input: CreateModuleInput): Promise<ActionResult<ModuleNode>> {
  return runAdminAction("catalog.write", createModuleSchema, input, async ({ input: data }) => {
    const db = catalogDb();
    const product = await requireProductRow(data.productId, db);

    if (productFormatOf(product) === "formacao") {
      throw new CatalogRuleError("Uma formação é feita de cursos. Crie o curso aqui e adicione os módulos nele.");
    }

    const siblings = await fetchModulesFor([product.id], db);
    assertProductModuleCapacity(siblings.length);

    const id = makeCatalogId("module", data.title);
    const plan = planModuleInsertion(siblings, id, data.afterModuleId);
    const newSortOrder = plan.updates.find((update) => update.id === id)?.sort_order ?? siblings.length;
    const { data: inserted, error } = await db
      .from("course_modules")
      .insert({
        description: "",
        eyebrow: moduleEyebrow(plan.position),
        id,
        image: product.image ?? "",
        meta: lessonCountLabel(0),
        owner_id: product.id,
        owner_kind: product.kind,
        progress: 0,
        release_rule: null,
        sort_order: newSortOrder,
        status: "published",
        title: data.title
      })
      .select(MODULE_COLUMNS)
      .single();
    failOnError(error, "Criando modulo");

    await Promise.all(
      plan.updates
        .filter((update) => update.id !== id)
        .map((update) =>
          db
            .from("course_modules")
            .update({ sort_order: update.sort_order })
            .eq("id", update.id)
            .then(({ error: updateError }) => failOnError(updateError, "Reordenando modulos"))
        )
    );

    invalidateCatalog({ from: "action" });

    return mapModuleNode(inserted as ModuleRow, plan.position, []);
  });
}

/** [catalog.write] Nome inline e frase de liberacao. */
export async function updateModule(input: UpdateModuleInput): Promise<ActionResult<ModuleNode>> {
  return runAdminAction("catalog.write", updateModuleSchema, input, async ({ input: data }) => {
    const db = catalogDb();
    const patch: Record<string, unknown> = {};

    if (data.title !== undefined) {
      patch.title = data.title;
    }

    if (data.release !== undefined) {
      patch.release_rule = releasePhraseToRule(data.release);
    }

    const updated = await updateRowGuarded<ModuleRow>({
      columns: MODULE_COLUMNS,
      db,
      excludeDeleted: true,
      expectedUpdatedAt: data.expectedUpdatedAt,
      id: data.id,
      notFoundMessage: MODULE_NOT_FOUND,
      patch,
      table: "course_modules"
    });

    invalidateCatalog({ from: "action" });

    return moduleNodeFor(updated, db);
  });
}

/* ------------------------------------------------------------------------------------------------
 * Aulas
 * ---------------------------------------------------------------------------------------------- */

/** [catalog.write] Uma ou varias aulas (Enter ou colar varias linhas); `skipped` = linhas sem titulo nem video reconhecido. */
export async function createLessons(input: CreateLessonsInput): Promise<ActionResult<{ lessons: LessonNode[]; skipped: number }>> {
  return runAdminAction("catalog.write", createLessonsSchema, input, async ({ input: data }) => {
    const db = catalogDb();
    const target = await requireModule(data.moduleId, db);
    const product = await requireProductRow(target.owner_id, db);
    const plan = planLessonCreation(data.items);

    if (plan.lessons.length === 0) {
      return { lessons: [], skipped: plan.skipped };
    }

    const { data: existingData, error: existingError } = await db
      .from("lessons")
      .select("id,status,sort_order")
      .eq("module_id", target.id);
    failOnError(existingError, "Aulas do modulo");

    const existing = (existingData ?? []) as { id: string; sort_order: number; status: string }[];
    const activeCount = existing.filter((lesson) => lesson.status !== "deleted").length;
    assertModuleCapacity(activeCount, plan.lessons.length);

    // Sugestao do provedor so quando falta titulo (YouTube) ou para trazer a duracao (Vimeo).
    const metadata = await fetchVideoMetadataBatch(
      plan.lessons.map((lesson) => (lesson.video && (lesson.needsTitle || lesson.video.provider === "vimeo") ? lesson.video : null))
    );
    const status: LessonStatus = initialLessonStatus(situationFromPublicationStatus(product.publication_status));
    const baseSortOrder = existing.length ? Math.max(...existing.map((lesson) => lesson.sort_order)) + 1 : 0;
    const now = Date.now();
    const rows = plan.lessons.map((lesson, index) => {
      const suggestion = metadata[index] ?? EMPTY_VIDEO_METADATA;
      const title = lesson.title || clampTitle(suggestion.suggestedTitle ?? "") || fallbackLessonTitle(activeCount + index + 1);

      return {
        completed: false,
        description: "",
        duration: suggestion.durationLabel ?? "",
        id: makeCatalogId("lesson", title, now + index),
        image: lessonThumbnailOf(suggestion.thumbnailUrl, lesson.video),
        module_id: target.id,
        release_rule: null,
        sort_order: baseSortOrder + index,
        status,
        title,
        video_config: lesson.video
      };
    });
    const { data: inserted, error } = await db.from("lessons").insert(rows).select(LESSON_COLUMNS);
    failOnError(error, "Criando aulas");

    await refreshModuleMeta([target.id], db);
    invalidateCatalog({ from: "action" });

    const created = ((inserted ?? []) as LessonRow[])
      .slice()
      .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));

    return {
      lessons: created.map((lesson, index) => mapLessonNode(lesson, activeCount + index + 1)),
      skipped: plan.skipped
    };
  });
}

/** [catalog.write] Painel da aula. */
export async function updateLesson(input: UpdateLessonInput): Promise<ActionResult<LessonNode>> {
  return runAdminAction("catalog.write", updateLessonSchema, input, async ({ input: data }) => {
    const db = catalogDb();
    const patch: Record<string, unknown> = {};

    if (data.title !== undefined) {
      patch.title = data.title;
    }

    if (data.description !== undefined) {
      patch.description = data.description;
    }

    if (data.durationLabel !== undefined) {
      patch.duration = data.durationLabel;
    }

    if (data.release !== undefined) {
      patch.release_rule = releasePhraseToRule(data.release);
    }

    if (data.status !== undefined) {
      patch.status = data.status;
    }

    if (data.videoInput !== undefined) {
      const raw = data.videoInput?.trim() ?? "";
      let config: LessonVideoConfig | null = null;

      if (raw) {
        const detection = detectLessonVideo(raw, { allowEmbedCode: data.allowEmbedCode });
        config = detection.ok ? normalizeLessonVideoConfig(detection.config) : null;

        if (!config) {
          throw new CatalogFieldError("videoInput", detection.ok ? "Não reconhecemos este link de vídeo." : detection.message);
        }
      }

      patch.video_config = config;

      // Miniatura que veio do provedor acompanha a troca de video; imagem propria (do admin antigo) fica.
      const current = await fetchLessonRow(data.id, db);
      const videoChanged = Boolean(current)
        && JSON.stringify(normalizeLessonVideoConfig(current?.video_config)) !== JSON.stringify(config);

      if (current && videoChanged && shouldRefreshLessonThumbnail(current.image)) {
        patch.image = lessonThumbnailOf(null, config)
          ?? (config?.provider === "vimeo" ? (await fetchVideoMetadata(config)).thumbnailUrl : null);
      }
    }

    const lesson = await updateRowGuarded<LessonRow>({
      columns: LESSON_COLUMNS,
      db,
      excludeDeleted: true,
      expectedUpdatedAt: data.expectedUpdatedAt,
      id: data.id,
      notFoundMessage: LESSON_NOT_FOUND,
      patch,
      table: "lessons"
    });

    invalidateCatalog({ from: "action" });

    return mapLessonNode(lesson, await lessonPosition(lesson, db));
  });
}

/** [catalog.write] Selecao multipla: Publicar / Despublicar. */
export async function setLessonsStatus(input: SetLessonsStatusInput): Promise<ActionResult<{ ids: string[]; status: LessonStatus }>> {
  return runAdminAction("catalog.write", setLessonsStatusSchema, input, async ({ input: data }) => {
    const { data: updated, error } = await catalogDb()
      .from("lessons")
      .update({ status: data.status })
      .in("id", [...new Set(data.ids)])
      .neq("status", "deleted")
      .select("id");
    failOnError(error, "Mudando situacao das aulas");

    invalidateCatalog({ from: "action" });

    return { ids: ((updated ?? []) as { id: string }[]).map((row) => row.id), status: data.status };
  });
}

/** [catalog.write] Excluir aula(s) ou modulo(s) com "Desfazer" (status "deleted"). */
export async function softDeleteStructure(input: SoftDeleteStructureInput): Promise<ActionResult<StructureDeleted>> {
  return runAdminAction("catalog.write", softDeleteStructureSchema, input, async ({ input: data, user }) => {
    const db = catalogDb();
    const table = data.kind === "module" ? "course_modules" : "lessons";
    const columns = data.kind === "module" ? "id,status" : "id,status,module_id";
    const { data: currentData, error: currentError } = await db
      .from(table)
      .select(columns)
      .in("id", [...new Set(data.ids)])
      .neq("status", "deleted");
    failOnError(currentError, "Itens para excluir");

    const current = (currentData ?? []) as unknown as { id: string; module_id?: string; status: string }[];

    if (current.length === 0) {
      throw new CatalogNotFoundError(data.kind === "module" ? MODULE_NOT_FOUND : LESSON_NOT_FOUND);
    }

    const { error } = await db
      .from(table)
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id, status: "deleted" })
      .in("id", current.map((item) => item.id))
      .neq("status", "deleted");
    failOnError(error, "Excluindo");

    if (data.kind === "lesson") {
      await refreshModuleMeta(current.flatMap((item) => (item.module_id ? [item.module_id] : [])), db);
    }

    invalidateCatalog({ from: "action" });

    return {
      items: current.map((item) => ({ id: item.id, previousStatus: restorableStatus(item.status) })),
      kind: data.kind
    };
  });
}

/** [catalog.write] Desfazer a exclusao com o status devolvido por softDeleteStructure. */
export async function restoreStructure(input: RestoreStructureInput): Promise<ActionResult<{ ids: string[] }>> {
  return runAdminAction("catalog.write", restoreStructureSchema, input, async ({ input: data }) => {
    const db = catalogDb();
    const table = data.kind === "module" ? "course_modules" : "lessons";
    const restored: string[] = [];
    const moduleIds: string[] = [];

    for (const status of ["published", "draft"] as const) {
      const ids = [...new Set(data.items.filter((item) => item.previousStatus === status).map((item) => item.id))];

      if (ids.length === 0) {
        continue;
      }

      const { data: rows, error } = await db
        .from(table)
        .update({ deleted_at: null, deleted_by: null, status })
        .in("id", ids)
        .eq("status", "deleted")
        .select(data.kind === "module" ? "id" : "id,module_id");
      failOnError(error, "Desfazendo exclusao");

      for (const row of (rows ?? []) as unknown as { id: string; module_id?: string }[]) {
        restored.push(row.id);

        if (row.module_id) {
          moduleIds.push(row.module_id);
        }
      }
    }

    if (moduleIds.length > 0) {
      await refreshModuleMeta(moduleIds, db);
    }

    invalidateCatalog({ from: "action" });

    return { ids: restored };
  });
}

/** [catalog.write] Ordem completa de modulos e aulas, de uma vez (arrastar, Alt+setas, "Mover para"). */
export async function reorderContent(input: ReorderContentInput): Promise<ActionResult<ContentReordered>> {
  return runAdminAction("catalog.write", reorderContentSchema, input, async ({ input: data }) => {
    const db = catalogDb();
    await requireProductRow(data.productId, db);
    assertReorderPayload(data.modules);

    const { error } = await db.rpc("admin_reorder_product_content", {
      p_content_id: data.productId,
      p_modules: data.modules.map((module) => ({ id: module.id, lessonIds: module.lessonIds }))
    });

    if (error) {
      const translated = translateReorderError(error);

      if (translated !== error) {
        throw translated;
      }

      failOnError(error, "Reordenando conteudo");
    }

    invalidateCatalog({ from: "action" });

    const { lessons, modules } = await fetchProductStructure(data.productId, db);

    return { modules: buildModuleTree(modules, lessons) };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Vídeo
 * ---------------------------------------------------------------------------------------------- */

/** [catalog.write] Titulo, miniatura e duracao sugeridos pelo provedor (oEmbed), com o chip do provedor. */
export async function previewVideo(input: VideoPreviewInput): Promise<ActionResult<VideoPreview>> {
  return runAdminAction("catalog.write", videoPreviewSchema, input, async ({ input: data }) => {
    const detection = detectLessonVideo(data.videoInput, { allowEmbedCode: data.allowEmbedCode });

    if (!detection.ok) {
      return { detection, durationLabel: null, suggestedTitle: null, thumbnailUrl: null };
    }

    const config = normalizeLessonVideoConfig(detection.config);
    const metadata = config ? await fetchVideoMetadata(config) : EMPTY_VIDEO_METADATA;

    return {
      detection,
      durationLabel: metadata.durationLabel,
      suggestedTitle: metadata.suggestedTitle,
      thumbnailUrl: lessonThumbnailOf(metadata.thumbnailUrl, config)
    };
  });
}
