"use server";

// Server Actions da Formação (docs/17 §1.6.9 e decisao 15 do plano). Curso incluido =
// commerce_scope 'included_content' + settings.parentFormationId, ordenado por sort_order.
// "Criar curso aqui" usa createProduct({ ..., parentFormationId }) de ./product-actions.ts.
// Cada escrita e uma RPC transacional (202610110012): commerce_scope, ordem e parentFormationId mudam
// juntos ou nada muda; o conjunto divergente ('stale_structure') vira 409.

import type { ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { invalidateCatalog } from "@/server/catalog/cache";
import { CatalogConflictError, CatalogNotFoundError, CatalogRuleError } from "./errors";
import { parentFormationIdOf, productFormatOf } from "./mappers";
import { bucketForProduct } from "./model";
import { loadFormationCourses } from "./queries";
import {
  COURSE_NOT_IN_FORMATION,
  FORMATION_INVALID,
  assertCourseCanJoinFormation,
  planFormationOrder,
  translateReorderError
} from "./rules";
import { formationCourseSchema, reorderFormationCoursesSchema } from "./schemas";
import {
  catalogDb,
  countActiveAccess,
  failOnError,
  fetchIncludedCourses,
  fetchProductRow,
  fetchProductSettings,
  type CatalogDb
} from "./store";
import type { FormationCourseInput, FormationCourseItem, ReorderFormationCoursesInput } from "./types";

async function requireFormation(formationId: string, db: CatalogDb) {
  const formation = await fetchProductRow(formationId, db);

  if (!formation) {
    throw new CatalogNotFoundError("Não encontramos esta formação. Ela pode ter sido excluída.");
  }

  if (productFormatOf(formation) !== "formacao") {
    throw new CatalogRuleError(FORMATION_INVALID);
  }

  return formation;
}

async function requireCourse(courseId: string, db: CatalogDb) {
  const course = await fetchProductRow(courseId, db);

  if (!course) {
    throw new CatalogNotFoundError("Não encontramos este curso. Ele pode ter sido excluído.");
  }

  const settings = await fetchProductSettings(course.id, db);
  const parentFormationId = course.commerce_scope === "included_content" ? parentFormationIdOf(settings) : null;

  return { course, parentFormationId };
}

const CONFLICT_ON_FORMATION = "Este curso mudou de formação há instantes. Recarregue para ver a versão atual.";

/** Erro das RPCs da formacao: 'stale_structure' vira 409 com a frase do caso; o resto, erro de banco. */
function failOnFormationError(error: { code?: string; message: string } | null, context: string, conflictMessage: string) {
  if (error && error.message.includes("stale_structure")) {
    throw new CatalogConflictError(conflictMessage);
  }

  failOnError(error, context);
}

/** [catalog.access] Curso existente (formato Curso, sem acessos ativos proprios) passa a fazer parte da formacao. */
export async function addCourseToFormation(input: FormationCourseInput): Promise<ActionResult<FormationCourseItem[]>> {
  return runAdminAction("catalog.access", formationCourseSchema, input, async ({ input: data }) => {
    const db = catalogDb();
    const formation = await requireFormation(data.formationId, db);
    const { course, parentFormationId } = await requireCourse(data.courseId, db);
    const verdict = assertCourseCanJoinFormation({
      activeAccessCount: await countActiveAccess(course.id, db),
      course: { format: productFormatOf(course), id: course.id, parentFormationId },
      formation: { format: productFormatOf(formation), id: formation.id }
    });

    if (verdict === "ok") {
      const { error } = await db.rpc("admin_add_course_to_formation", {
        p_bucket: bucketForProduct("curso", "included_content"),
        p_course_id: course.id,
        p_formation_id: formation.id
      });
      failOnFormationError(error, "Incluindo curso na formacao", CONFLICT_ON_FORMATION);
      invalidateCatalog({ from: "action" });
    }

    return loadFormationCourses(formation.id);
  });
}

/** [catalog.access] Tira da formacao sem apagar: vira curso avulso em Rascunho. */
export async function removeCourseFromFormation(input: FormationCourseInput): Promise<ActionResult<FormationCourseItem[]>> {
  return runAdminAction("catalog.access", formationCourseSchema, input, async ({ input: data }) => {
    const db = catalogDb();
    const formation = await requireFormation(data.formationId, db);
    const { course, parentFormationId } = await requireCourse(data.courseId, db);

    if (parentFormationId !== formation.id) {
      throw new CatalogConflictError(COURSE_NOT_IN_FORMATION);
    }

    const { error } = await db.rpc("admin_remove_course_from_formation", {
      p_bucket: bucketForProduct("curso", "sellable_product"),
      p_course_id: course.id,
      p_formation_id: formation.id
    });
    failOnFormationError(error, "Tirando curso da formacao", COURSE_NOT_IN_FORMATION);
    invalidateCatalog({ from: "action" });

    return loadFormationCourses(formation.id);
  });
}

/** [catalog.access] Nova ordem dos cursos dentro da formacao. */
export async function reorderFormationCourses(input: ReorderFormationCoursesInput): Promise<ActionResult<FormationCourseItem[]>> {
  return runAdminAction("catalog.access", reorderFormationCoursesSchema, input, async ({ input: data }) => {
    const db = catalogDb();
    const formation = await requireFormation(data.formationId, db);
    const { courses } = await fetchIncludedCourses(formation.id, db);
    // Confere antes (409 sem ida ao banco) e de novo dentro da RPC, com os cursos travados.
    planFormationOrder(courses.map((course) => course.id), data.orderedCourseIds);

    const { error } = await db.rpc("admin_reorder_formation_courses", {
      p_course_ids: data.orderedCourseIds,
      p_formation_id: formation.id
    });

    if (error) {
      const translated = translateReorderError(error);

      if (translated !== error) {
        throw translated;
      }

      failOnError(error, "Reordenando cursos da formacao");
    }

    invalidateCatalog({ from: "action" });

    return loadFormationCourses(formation.id);
  });
}
