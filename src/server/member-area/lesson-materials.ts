import "server-only";

// Leitura dos materiais de apoio das aulas para o aluno (tabela lesson_materials, migracao 202610130001).
//
// Contrato: quem chama JA validou que o aluno pode abrir cada aula de `lessonIds` (sessao, acesso ao
// conteudo e liberacao da aula). Esta camada so aplica a regra extra de cada material e nunca devolve
// o endereco de um material bloqueado.
//
// Banco sem a migracao: devolve { available: false, materials: [] } e a interface mostra o estado
// vazio honesto, sem quebrar a pagina da aula.

import {
  sortStudentLessonMaterials,
  toStudentLessonMaterial,
  type LessonMaterialLearnerState,
  type LessonMaterialRow,
  type StudentLessonMaterial
} from "@/lib/lesson-materials";
import { redactSecrets } from "@/lib/env-value";
import { isMissingSchemaObjectError } from "@/server/db/pending-migration";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";

const LESSON_MATERIAL_COLUMNS =
  "id,lesson_id,title,description,file_url,file_type,file_size_bytes,unlock_rule,unlock_threshold,generated_by_ai,status,sort_order,created_at";

// IDs de aula sao texto livre; lotes pequenos mantem a URL do PostgREST curta.
const LESSON_ID_BATCH_SIZE = 150;

export type StudentLessonMaterialsResult = {
  /** false = banco sem a tabela (migracao pendente). */
  available: boolean;
  materials: StudentLessonMaterial[];
};

const lockedLearnerState: LessonMaterialLearnerState = { maxProgressPercent: 0, rated: false };

function uniqueLessonIds(lessonIds: readonly string[]) {
  return Array.from(new Set(lessonIds.map((lessonId) => lessonId.trim()).filter(Boolean)));
}

/**
 * Materiais publicados das aulas autorizadas, ja com a regra extra aplicada por aula.
 * `learnerByLessonId` vem do progresso do proprio aluno; aula sem estado conta como nada feito.
 */
export async function listStudentLessonMaterials({
  learnerByLessonId,
  lessonIds
}: {
  learnerByLessonId: ReadonlyMap<string, LessonMaterialLearnerState>;
  lessonIds: readonly string[];
}): Promise<StudentLessonMaterialsResult> {
  const ids = uniqueLessonIds(lessonIds);

  if (ids.length === 0) {
    return { available: true, materials: [] };
  }

  const supabase = getSupabaseAdminClient();
  const batches: string[][] = [];

  for (let start = 0; start < ids.length; start += LESSON_ID_BATCH_SIZE) {
    batches.push(ids.slice(start, start + LESSON_ID_BATCH_SIZE));
  }

  // Lotes em paralelo: um aluno com varias formacoes nao espera um lote terminar para pedir o proximo.
  const responses = await Promise.all(batches.map((batch) => (
    supabase
      .from("lesson_materials")
      .select(LESSON_MATERIAL_COLUMNS)
      .in("lesson_id", batch)
      .eq("status", "published")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
  )));
  const rows: LessonMaterialRow[] = [];

  for (const { data, error } of responses) {
    if (error) {
      if (isMissingSchemaObjectError(error)) {
        return { available: false, materials: [] };
      }

      throw new Error(`Nao foi possivel carregar os materiais das aulas: ${redactSecrets(error.message)}`);
    }

    rows.push(...((data ?? []) as LessonMaterialRow[]));
  }

  const materials = rows.flatMap((row) => {
    const material = toStudentLessonMaterial(row, learnerByLessonId.get(row.lesson_id) ?? lockedLearnerState);
    return material ? [material] : [];
  });

  return { available: true, materials: sortStudentLessonMaterials(materials) };
}
