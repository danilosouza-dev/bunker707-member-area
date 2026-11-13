"use server";

// As Server Actions do replay que vira aula (docs/30 §2.2, §2.3 e §6.8; D108 a D114), no molde de actions.ts:
// - publishWebinarReplay: o Publicar replay do menu do webinario encerrado;
// - listReplayLessonModules: os modulos do produto para o seletor do destino;
// - getReplayLessonSetup e saveReplayLessonTarget: o cartao Publicar replay como aula do painel Gravação do console,
//   que le e grava so o destino (replay_lesson_target), sem o rascunho do editor.
// Todas passam por runWebinarAction (o modulo dos Webinarios na licenca). O que cria a aula e replay-lesson.ts; quem
// pode apontar para um produto e replay-lesson-access.ts.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { recordAudit } from "@/server/audit/log";
import { listProductOptions } from "@/server/catalog/queries";
import { catalogIdSchema } from "@/server/catalog/schemas";
import { fetchModulesFor } from "@/server/catalog/store";
import type { ProductOption } from "@/server/catalog/types";
import { WebinarError, webinarsDb } from "./db";
import type { ReplayLessonTarget } from "./model";
import { publishReplayLesson } from "./replay-lesson";
import { REPLAY_TARGET_FORBIDDEN, assertProductContent, assertReplayTargetAllowed, canEditProductContent } from "./replay-lesson-access";
import { REPLAY_LESSON_MESSAGES, replayLessonIdFor } from "./replay-lesson-model";
import { replayLessonTargetOfRow } from "./rows";
import { runWebinarAction } from "./run-webinar-action";
import { replayLessonTargetSchema, webinarIdSchema } from "./schemas";
import { assertWebinarNotArchived, requireWebinarRow, updateWebinarRow } from "./store";

const LIST_PATH = "/admin/comunicacao/webinarios";

const replayLessonModulesSchema = z.object({ productId: catalogIdSchema });
const replayLessonTargetInputSchema = z.object({ id: z.uuid({ error: "Webinário inválido." }), target: replayLessonTargetSchema.nullable() });

/** A lista e a pagina do webinario (o editor e o console leem o destino e a aula de novo). */
function revalidateWebinar(id: string) {
  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${id}`);
}

export type ReplayLessonPublished = {
  /** Falso quando o replay ja era uma aula (nada mudou). */
  created: boolean;
  lessonId: string;
  title: string;
};

/**
 * [messaging.publish, e catalog.content no produto de destino] Publicar replay (docs/30 §2.3 e §6.8): o replay do
 * webinario vira uma aula publicada no produto e no modulo do card Publicar replay como aula. Uma aula por webinario:
 * se ja existe, nada muda e a resposta diz qual e; a excluida pela equipe volta. Sem destino, sem replay pronto ou com
 * o destino invalido, recusa com a frase do motivo. O arquivado fica de leitura.
 */
export async function publishWebinarReplay(input: { expectedUpdatedAt?: string; id: string }): Promise<ActionResult<ReplayLessonPublished>> {
  return runWebinarAction("messaging.publish", "conteudo", webinarIdSchema, input, async ({ access, input: data, user }) => {
    const db = webinarsDb();
    const row = await requireWebinarRow(db, data.id);
    assertWebinarNotArchived(row);
    const target = replayLessonTargetOfRow(row.replay_lesson_target);

    if (!target) {
      throw new WebinarError(REPLAY_LESSON_MESSAGES.no_target, 422);
    }

    // A aula nasce dentro de um produto: quem publica o replay tambem precisa poder mexer no conteudo dele.
    await assertProductContent(access, target.productId);

    const outcome = await publishReplayLesson(db, { actorId: user.id, mode: "manual", now: new Date(), webinar: row, webinarId: row.id });

    if (outcome.status === "skipped") {
      throw new WebinarError(REPLAY_LESSON_MESSAGES[outcome.reason], outcome.reason === "no_replay" ? 409 : 422);
    }

    revalidateWebinar(row.id);

    return { created: outcome.status === "published", lessonId: outcome.lessonId, title: outcome.title };
  });
}

/**
 * [messaging.write, e catalog.content no produto] Os modulos do produto escolhido no card Publicar replay como aula, na
 * ordem do curso (sem os excluidos). So para quem mexe no conteudo do produto (a mesma regra do destino no Salvar,
 * D112): os outros recebem 403 e o card diz que nao leu os modulos. A formacao nao tem modulos proprios: lista vazia.
 */
export async function listReplayLessonModules(input: { productId: string }): Promise<ActionResult<{ modules: { id: string; title: string }[] }>> {
  return runWebinarAction("messaging.write", "conteudo", replayLessonModulesSchema, input, async ({ access, input: data }) => {
    if (!(await canEditProductContent(access, data.productId))) {
      throw new WebinarError(REPLAY_TARGET_FORBIDDEN, 403);
    }

    const modules = await fetchModulesFor([data.productId], webinarsDb());

    return { modules: modules.map((module) => ({ id: module.id, title: module.title })) };
  });
}

export type ReplayLessonSetup = {
  /** A aula deste webinario, se o replay ja virou aula (a excluida pela equipe nao conta). */
  lesson: { id: string; title: string } | null;
  products: ProductOption[];
  target: ReplayLessonTarget | null;
};

/**
 * [messaging.write] O card Publicar replay como aula do console (docs/30 §6.8, D114): o destino salvo no webinario, os
 * produtos para escolher e a aula que ja existe. O console le so quando o painel Gravação abre.
 */
export async function getReplayLessonSetup(input: { id: string }): Promise<ActionResult<ReplayLessonSetup>> {
  return runWebinarAction("messaging.write", "conteudo", webinarIdSchema, input, async ({ input: data }) => {
    const db = webinarsDb();
    const row = await requireWebinarRow(db, data.id);
    const [products, lessonResult] = await Promise.all([
      listProductOptions(),
      db.from("lessons").select("id,title,status").eq("id", replayLessonIdFor(row.id)).neq("status", "deleted").maybeSingle()
    ]);

    if (lessonResult.error) {
      throw new WebinarError("Não foi possível ler a aula do replay agora.", 500);
    }

    const lesson = (lessonResult.data ?? null) as { id: string; title: string } | null;

    return { lesson: lesson ? { id: lesson.id, title: lesson.title } : null, products, target: replayLessonTargetOfRow(row.replay_lesson_target) };
  });
}

/**
 * [messaging.write, e catalog.content no produto quando ele muda] O destino do replay pelo console (D114): grava so
 * `replay_lesson_target`, com a guarda do `updated_at` lido (o editor aberto noutra aba recebe o conflito, 409, no
 * proximo Salvar dele). E o mesmo destino do card do editor: vale para o proximo replay que nascer; a aula que ja existe
 * nao e mexida. `target` nulo desliga. O arquivado fica de leitura.
 */
export async function saveReplayLessonTarget(input: { id: string; target: ReplayLessonTarget | null }): Promise<ActionResult<{ target: ReplayLessonTarget | null }>> {
  return runWebinarAction("messaging.write", "conteudo", replayLessonTargetInputSchema, input, async ({ access, input: data, user }) => {
    const db = webinarsDb();
    const row = await requireWebinarRow(db, data.id);
    assertWebinarNotArchived(row);

    const current = replayLessonTargetOfRow(row.replay_lesson_target);
    const target = data.target ? { ...data.target, moduleId: data.target.moduleId?.trim() || null, title: data.target.title?.trim() || null } : null;
    await assertReplayTargetAllowed(access, target, current);
    await updateWebinarRow(db, row.id, { replay_lesson_target: target }, { expectedUpdatedAt: row.updated_at });

    await recordAudit(db, {
      action: "webinar.replay_lesson_target_saved",
      actorId: user.id,
      entityId: row.id,
      entityType: "webinar",
      metadata: { auto_publish: target?.autoPublish ?? null, module_id: target?.moduleId ?? null, product_id: target?.productId ?? null, source: "console" }
    });
    revalidateWebinar(row.id);

    return { target };
  });
}
