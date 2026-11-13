import "server-only";

// Publicar replay como aula (docs/30 §2.2 e §6.8; D108 a D114): o replay de um webinario vira uma aula, com o video da
// Bunny, no produto e no modulo escolhidos no card Publicar replay como aula (webinars.replay_lesson_target).
// - Sozinho (`auto`): quando o replay nasce (createReplayForSession: a sessao encerrou e a gravacao esta pronta), se o
//   card tem "Publicar sozinho quando o replay ficar pronto". Nunca derruba quem chamou: a falha vira log.
// - Pelo botao Publicar replay (`manual`, actions.ts): a qualquer hora depois do replay; recusa com a frase do motivo.
// Uma aula por webinario: o id e replayLessonIdFor(webinario). Ja existe: nada muda (a equipe pode ter editado). A
// excluida pela equipe so volta pelo botao, nunca sozinha. A aula nasce publicada, no fim do modulo; o modulo e o
// escolhido, senao o ultimo do produto, senao um modulo "Lives" criado na hora. Grava a auditoria e invalida o catalogo.

import { invalidateCatalog } from "@/server/catalog/cache";
import { recordAudit } from "../audit/log";
import { formatFromKind, makeCatalogId, MAX_LESSONS_PER_MODULE } from "../catalog/model";
import { lessonCountLabel, moduleEyebrow } from "../catalog/rules";
import { fetchModulesFor, fetchProductRow, refreshModuleMeta } from "../catalog/store";
import { assertNoDbError, type WebinarsDb } from "./db";
import {
  REPLAY_LESSON_MODULE_TITLE,
  pickReplayLessonModule,
  replayLessonDescription,
  replayLessonDuration,
  replayLessonIdFor,
  replayLessonTitle,
  replayLessonVideo,
  type ReplayLessonMode,
  type ReplayLessonOutcome
} from "./replay-lesson-model";
import { replayLessonTargetOfRow, type RecordingRow, type WebinarRow } from "./rows";
import { fetchWebinarRow, listRecordingRows, listSessionRows } from "./store";

type ExistingLesson = { id: string; module_id: string; status: string; title: string };

/** A gravacao que o replay do webinario toca (a da sessao `replay`), so quando esta pronta. */
async function replayRecordingOfWebinar(db: WebinarsDb, webinarId: string): Promise<RecordingRow | null> {
  const replay = (await listSessionRows(db, [webinarId])).find((session) => session.kind === "replay");

  if (!replay?.recording_id) {
    return null;
  }

  const recording = (await listRecordingRows(db, [webinarId])).find((row) => row.id === replay.recording_id);

  return recording && recording.status === "ready" ? recording : null;
}

/** Cria o modulo "Lives" no fim do produto que ainda nao tem modulo (as mesmas colunas do Criar modulo do admin). */
async function createLivesModule(db: WebinarsDb, product: { id: string; image: string | null; kind: string }, now: Date): Promise<string> {
  const id = makeCatalogId("module", REPLAY_LESSON_MODULE_TITLE, now.getTime());
  const { error } = await db.from("course_modules").insert({
    description: "",
    eyebrow: moduleEyebrow(1),
    id,
    image: product.image ?? "",
    meta: lessonCountLabel(0),
    owner_id: product.id,
    owner_kind: product.kind,
    progress: 0,
    release_rule: null,
    sort_order: 0,
    status: "published",
    title: REPLAY_LESSON_MODULE_TITLE
  });
  assertNoDbError(error, "Webinarios: criar o modulo das lives");

  return id;
}

/**
 * Publica o replay do webinario como aula. Devolve o que aconteceu; so lanca em erro de banco. `webinar` evita ler a
 * linha de novo quando quem chama ja a tem.
 */
export async function publishReplayLesson(
  db: WebinarsDb,
  input: { actorId?: string | null; mode: ReplayLessonMode; now: Date; webinar?: WebinarRow | null; webinarId: string }
): Promise<ReplayLessonOutcome> {
  const webinar = input.webinar ?? (await fetchWebinarRow(db, input.webinarId));
  const target = webinar ? replayLessonTargetOfRow(webinar.replay_lesson_target) : null;

  if (!webinar || !target) {
    return { reason: "no_target", status: "skipped" };
  }

  if (input.mode === "auto" && !target.autoPublish) {
    return { reason: "auto_off", status: "skipped" };
  }

  const lessonId = replayLessonIdFor(webinar.id);
  const { data: existingData, error: existingError } = await db.from("lessons").select("id,module_id,status,title").eq("id", lessonId).maybeSingle();
  assertNoDbError(existingError, "Webinarios: ler a aula do replay");
  const existing = (existingData ?? null) as ExistingLesson | null;

  if (existing && existing.status !== "deleted") {
    return { lessonId, status: "exists", title: existing.title };
  }

  // A aula excluida pela equipe so volta pelo botao.
  if (existing && input.mode === "auto") {
    return { reason: "removed", status: "skipped" };
  }

  const recording = await replayRecordingOfWebinar(db, webinar.id);

  if (!recording) {
    return { reason: "no_replay", status: "skipped" };
  }

  const video = replayLessonVideo(recording);

  if (!video) {
    return { reason: "no_video", status: "skipped" };
  }

  const product = await fetchProductRow(target.productId, db);

  if (!product) {
    return { reason: "product_missing", status: "skipped" };
  }

  if (formatFromKind(product.kind) === "formacao") {
    return { reason: "formation", status: "skipped" };
  }

  const choice = pickReplayLessonModule(await fetchModulesFor([product.id], db), target.moduleId);

  if (choice.kind === "missing") {
    return { reason: "module_missing", status: "skipped" };
  }

  const moduleCreated = choice.kind === "create";
  const moduleId = choice.kind === "create" ? await createLivesModule(db, product, input.now) : choice.id;
  const { data: siblingData, error: siblingError } = await db.from("lessons").select("id,sort_order,status").eq("module_id", moduleId);
  assertNoDbError(siblingError, "Webinarios: ler as aulas do modulo");
  const siblings = ((siblingData ?? []) as { id: string; sort_order: number; status: string }[]).filter((lesson) => lesson.id !== lessonId);

  if (siblings.filter((lesson) => lesson.status !== "deleted").length >= MAX_LESSONS_PER_MODULE) {
    return { reason: "module_full", status: "skipped" };
  }

  const title = replayLessonTitle(target, webinar.title);
  const fields = {
    description: replayLessonDescription(webinar.description),
    duration: replayLessonDuration(recording.duration_seconds),
    module_id: moduleId,
    sort_order: siblings.length ? Math.max(...siblings.map((lesson) => lesson.sort_order)) + 1 : 0,
    status: "published",
    title,
    video_config: video
  };

  if (existing) {
    const { error } = await db.from("lessons").update({ ...fields, deleted_at: null, deleted_by: null }).eq("id", lessonId).eq("status", "deleted");
    assertNoDbError(error, "Webinarios: devolver a aula do replay");
  } else {
    const { error } = await db.from("lessons").insert({ ...fields, completed: false, id: lessonId, image: null, release_rule: null });

    // Dois pedidos ao mesmo tempo (o tick e o botao): a chave primaria deixa um so criar; o outro ve a aula pronta.
    if (error?.code === "23505") {
      return { lessonId, status: "exists", title };
    }

    assertNoDbError(error, "Webinarios: criar a aula do replay");
  }

  await refreshModuleMeta(existing && existing.module_id !== moduleId ? [moduleId, existing.module_id] : [moduleId], db);
  await recordAudit(db, {
    action: "webinar.replay_lesson_published",
    actorId: input.actorId ?? null,
    entityId: webinar.id,
    entityType: "webinar",
    metadata: { lesson_id: lessonId, mode: input.mode, module_created: moduleCreated, module_id: moduleId, product_id: product.id, recording_id: recording.id, restored: existing !== null }
  });
  // No botao (Server Action) o produtor le o que acabou de gravar; no tick e no fim da live, o catalogo se refaz atras.
  invalidateCatalog({ from: input.mode === "manual" ? "action" : "route" });

  return { lessonId, moduleCreated, moduleId, productId: product.id, restored: existing !== null, status: "published", title };
}

/**
 * O automatico: chamado quando o replay do webinario acaba de nascer. Nunca lanca (o fim da live, o Enviar gravação e
 * o tick das gravacoes nao podem falhar por causa da aula): a falha vira log e a equipe usa o botao Publicar replay.
 */
export async function autoPublishReplayLesson(db: WebinarsDb, webinarId: string, now: Date): Promise<ReplayLessonOutcome | null> {
  try {
    const outcome = await publishReplayLesson(db, { mode: "auto", now, webinarId });

    if (outcome.status === "published") {
      console.info(`[webinarios] o replay do webinario ${webinarId} virou a aula ${outcome.lessonId} (modulo ${outcome.moduleId}).`);
    } else if (outcome.status === "skipped" && outcome.reason !== "no_target" && outcome.reason !== "auto_off") {
      console.warn(`[webinarios] o replay do webinario ${webinarId} nao virou aula sozinho: ${outcome.reason}.`);
    }

    return outcome;
  } catch (error) {
    console.error(`[webinarios] o replay do webinario ${webinarId} nao virou aula sozinho:`, error);

    return null;
  }
}
