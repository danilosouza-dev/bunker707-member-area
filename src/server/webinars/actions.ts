"use server";

// Server Actions do admin dos Webinarios (docs/30 §5.2, fase 1a): salvar o rascunho, publicar, cancelar,
// duplicar, excluir o rascunho, mudar a hora marcada de uma sessao e enviar a capa. Todas passam por
// runAdminAction (messaging.write; publicar, cancelar e excluir pedem messaging.publish), gravam recordAudit so
// com ids e contagens (nunca nomes, e-mails nem texto digitado) e revalidam a lista e a pagina do webinario.
// Toda leitura e escrita vai pela service role (webinarsDb) com assertNoDbError no store.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { recordAudit } from "@/server/audit/log";
import { checkProductImage, decodeWebpDataUrl } from "@/server/catalog/webp";
import { isSameVersion } from "@/server/communications/campaign-model";
import { persistImageAsset } from "@/server/db/media-assets";
import { WEBINAR_CHANGED_MESSAGE, WebinarError, WebinarFieldError, webinarsDb, type WebinarsDb } from "./db";
import { webinarDraftOf } from "./editor-model";
import { WEBINAR_LIMITS, toTime, webinarSituation, webinarSlug, type WebinarDraft, type WebinarSituation, type WebinarStatus } from "./model";
import { queueWebinarCancelledNotices, queueWebinarRescheduledNotices } from "./notify";
import { baseRecordingOf, draftSessionsOf } from "./queries";
import { sessionFromRow, webinarFromRow, webinarRowPatch, type PresenterRow, type RecordingRow, type SessionRow, type WebinarRow } from "./rows";
import {
  WEBINAR_MESSAGES,
  cancelWebinarSchema,
  publishProblems,
  rescheduleSessionSchema,
  saveWebinarSchema,
  webinarDraftSchema,
  webinarIdSchema,
  type SaveWebinarInput
} from "./schemas";
import {
  countRegistrationsByWebinar,
  countSessionRegistrations,
  deleteSessionRows,
  fetchSessionRow,
  insertRecordingRow,
  insertSessionRows,
  insertWebinarRow,
  listPresenterRows,
  listRecordingRows,
  listSessionRows,
  replacePresenterRows,
  requireWebinarRow,
  softDeleteWebinarRow,
  updateRecordingRow,
  updateSessionRow,
  updateWebinarRow,
  type WebinarInsertRow
} from "./store";

const LIST_PATH = "/admin/comunicacao/webinarios";

/** Quantas vezes tentar outro sufixo quando o slug bate no unique (duas telas criando o mesmo titulo). */
const SLUG_ATTEMPTS = 6;

const CANCELLED_MESSAGE = "Esse webinário foi cancelado. Duplique para criar outro.";
const ALREADY_PUBLISHED_MESSAGE = "Esse webinário já foi publicado. Recarregue a página.";
const ONLY_PUBLISHED_CANCELS = "Só um webinário publicado é cancelado. Um rascunho é excluído.";
const ONLY_DRAFT_DELETES = "Só um rascunho é excluído. Cancele o webinário publicado.";
const KIND_LOCKED_MESSAGE = "O tipo não muda depois de publicar.";
const SESSION_MISSING_MESSAGE = "Essa sessão não existe mais.";
const SESSION_NOT_SCHEDULED_MESSAGE = "Só uma sessão que ainda não começou muda de hora.";

export type SavedWebinar = { id: string; slug: string; status: WebinarStatus; updatedAt: string };
export type PublishedWebinar = SavedWebinar & { publishedAt: string; situation: WebinarSituation };
export type CancelledWebinar = { id: string; registered: number; situation: "cancelled"; updatedAt: string };

const uploadCoverSchema = z.object({
  image: z.string().min(1, "Envie a imagem recortada (WebP).").max(600_000, "A imagem ficou grande demais. Recorte de novo."),
  slot: z.enum(["cover", "notice"]).default("cover")
});

/* ------------------------------------------------------------------------------------------------
 * Apoio
 * ---------------------------------------------------------------------------------------------- */

function revalidateWebinars(id?: string) {
  revalidatePath(LIST_PATH);

  if (id) {
    revalidatePath(`${LIST_PATH}/${id}`);
  }
}

function assertSameVersion(row: WebinarRow, expectedUpdatedAt: string | undefined) {
  if (expectedUpdatedAt && !isSameVersion(row.updated_at, expectedUpdatedAt)) {
    throw new WebinarError(WEBINAR_CHANGED_MESSAGE, 409);
  }
}

type Bundle = { presenters: PresenterRow[]; recordings: RecordingRow[]; row: WebinarRow; sessions: SessionRow[] };

async function loadBundle(db: WebinarsDb, id: string): Promise<Bundle> {
  const row = await requireWebinarRow(db, id);
  const [presenters, recordings, sessions] = await Promise.all([listPresenterRows(db, [row.id]), listRecordingRows(db, [row.id]), listSessionRows(db, [row.id])]);

  return { presenters, recordings, row, sessions };
}

/** O rascunho como esta gravado (a linha, os apresentadores, o video base e as sessoes da Live gravada). */
function draftOfBundle(bundle: Bundle): WebinarDraft {
  const webinar = webinarFromRow(bundle.row, bundle.presenters, baseRecordingOf(bundle.recordings));

  return { ...webinarDraftOf(webinar), sessions: draftSessionsOf(bundle.sessions.map(sessionFromRow)) };
}

function presenterRowsOf(draft: WebinarDraft) {
  return draft.presenters.map((presenter) => ({
    can_moderate_room: presenter.role === "team" && presenter.canModerateRoom,
    role: presenter.role,
    user_id: presenter.userId
  }));
}

function isSlugConflict(error: unknown) {
  return error instanceof Error && /webinars_slug_key|duplicate key|23505/i.test(error.message);
}

/** Os slugs ja usados com esta base (inclusive de webinarios excluidos: o unique vale para todos). */
async function usedSlugs(db: WebinarsDb, base: string): Promise<Set<string>> {
  const { data, error } = await db.from("webinars").select("slug").like("slug", `${base}%`).limit(1_000);

  if (error) {
    // Sem a lista, o insert decide (e tenta outro sufixo se bater).
    return new Set();
  }

  return new Set(((data ?? []) as { slug: string }[]).map((row) => row.slug));
}

/** O primeiro slug livre para o titulo ("meu-titulo", "meu-titulo-2", ...). `keep` e o slug atual, que continua valendo. */
async function freeSlug(db: WebinarsDb, title: string, keep: string | null = null, skip: ReadonlySet<string> = new Set()) {
  const base = webinarSlug(title);
  const taken = await usedSlugs(db, base);

  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const candidate = webinarSlug(title, suffix);

    if (candidate === keep || (!taken.has(candidate) && !skip.has(candidate))) {
      return candidate;
    }
  }

  return `${base}-${Date.now().toString(36)}`;
}

/** Insere com o slug livre; se outra tela ganhou o mesmo slug no meio, tenta o sufixo seguinte. */
async function insertWithFreeSlug(db: WebinarsDb, row: Omit<WebinarInsertRow, "slug">, title: string): Promise<WebinarRow> {
  const tried = new Set<string>();

  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
    const slug = await freeSlug(db, title, null, tried);
    tried.add(slug);

    try {
      return await insertWebinarRow(db, { ...row, slug });
    } catch (error) {
      if (!isSlugConflict(error) || attempt === SLUG_ATTEMPTS - 1) {
        throw error;
      }
    }
  }

  throw new WebinarError("Não foi possível criar o endereço do webinário. Tente de novo.", 409);
}

/** O video da Live gravada: uma gravacao base (sem sessao, origem bunny) com o endereco do player colado pela equipe. */
async function syncBaseRecording(db: WebinarsDb, webinarId: string, url: string | null, recordings: readonly RecordingRow[]): Promise<RecordingRow | null> {
  const existing = baseRecordingOf(recordings);

  if (!url) {
    if (existing && existing.embed_url !== null) {
      await updateRecordingRow(db, existing.id, { embed_url: null });
    }

    return existing;
  }

  if (existing) {
    return existing.embed_url === url ? existing : ((await updateRecordingRow(db, existing.id, { embed_url: url, status: "ready" })) ?? existing);
  }

  return insertRecordingRow(db, { embed_url: url, provider: "bunny", session_id: null, source: "bunny", status: "ready", webinar_id: webinarId });
}

type SessionsSync = { created: number; kept: number; lateJoinUpdated: number; removed: number };

type WantedSession = { iso: string; lateJoinMinutes: number | null };

/**
 * As horas marcadas da Live gravada viram sessoes `simulated`: cria as novas, apaga as que sairam e ainda nao tem
 * vaga garantida, mantem as que tem vaga (e as que ja comecaram, acabaram ou foram canceladas). A Entrada atrasada
 * (late_join_minutes, fase 2) acompanha cada hora marcada: muda nas sessoes que ainda nao acabaram.
 */
async function syncSimulatedSessions(
  db: WebinarsDb,
  webinarId: string,
  draft: WebinarDraft,
  sessions: readonly SessionRow[],
  recordingId: string | null
): Promise<SessionsSync> {
  const wanted = new Map<number, WantedSession>();

  for (const session of draft.sessions) {
    const time = toTime(session.scheduledAt);

    if (Number.isFinite(time)) {
      wanted.set(time, { iso: new Date(time).toISOString(), lateJoinMinutes: session.lateJoinMinutes ?? null });
    }
  }

  const simulated = sessions.filter((session) => session.kind === "simulated");
  const existingTimes = new Set<number>();
  const removable: string[] = [];
  let kept = 0;
  let lateJoinUpdated = 0;

  for (const session of simulated) {
    const time = toTime(session.scheduled_at);
    const want = wanted.get(time);

    if (want || session.status !== "scheduled") {
      existingTimes.add(time);
      kept += 1;

      if (want && want.lateJoinMinutes !== session.late_join_minutes && session.status !== "ended" && session.status !== "cancelled") {
        await updateSessionRow(db, session.id, { late_join_minutes: want.lateJoinMinutes });
        lateJoinUpdated += 1;
      }

      continue;
    }

    const registered = await countSessionRegistrations(db, { id: session.id, webinar_id: webinarId });

    if (registered > 0) {
      existingTimes.add(time);
      kept += 1;
    } else {
      removable.push(session.id);
    }
  }

  await deleteSessionRows(db, removable);

  const toCreate = Array.from(wanted.entries())
    .filter(([time]) => !existingTimes.has(time))
    .map(([, want]) => ({
      chat_mode: draft.roomSettings.chatMode,
      chat_slow_mode_seconds: draft.roomSettings.slowModeSeconds,
      kind: "simulated",
      late_join_minutes: want.lateJoinMinutes,
      recording_id: recordingId,
      scheduled_at: want.iso,
      status: "scheduled",
      webinar_id: webinarId
    }));
  const created = await insertSessionRows(db, toCreate);

  // A gravacao base chegou depois das sessoes: as sessoes marcadas passam a apontar para ela.
  if (recordingId) {
    for (const session of simulated) {
      if (session.recording_id !== recordingId && !removable.includes(session.id)) {
        await updateSessionRow(db, session.id, { recording_id: recordingId });
      }
    }
  }

  return { created: created.length, kept, lateJoinUpdated, removed: removable.length };
}

/** A sessao `live` da Live ao vivo que ainda vale (nao cancelada). */
function liveSessionOf(sessions: readonly SessionRow[]) {
  return sessions.find((session) => session.kind === "live" && session.status !== "cancelled") ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * Salvar o rascunho (insert ou update)
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.write] Grava o rascunho: a linha de webinars (webinarRowPatch), os apresentadores, o video base da
 * Live gravada e as sessoes. Num webinario publicado, o que os alunos veem muda na hora: as regras de publicar
 * valem no salvar (menos a data que ja passou e nao mudou), e a hora marcada nova da Live ao vivo avisa quem tinha
 * vaga (queueWebinarRescheduledNotices).
 */
export async function saveWebinarDraft(input: SaveWebinarInput): Promise<ActionResult<SavedWebinar>> {
  return runAdminAction("messaging.write", saveWebinarSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const draft = data.draft;
    const patch = webinarRowPatch(draft);

    if (!data.id) {
      const created = await insertWithFreeSlug(db, { ...patch, created_by: user.id, status: "draft" }, draft.title);
      await replacePresenterRows(db, created.id, presenterRowsOf(draft));
      let sessions: SessionsSync = { created: 0, kept: 0, lateJoinUpdated: 0, removed: 0 };

      if (draft.kind === "simulated") {
        const recording = await syncBaseRecording(db, created.id, draft.recordingVideoUrl, []);
        sessions = await syncSimulatedSessions(db, created.id, draft, [], recording?.id ?? null);
      }

      await recordAudit(db, {
        action: "webinar.saved",
        actorId: user.id,
        entityId: created.id,
        entityType: "webinar",
        metadata: { access_mode: created.access_mode, created: true, kind: created.kind, presenters: draft.presenters.length, sessions_created: sessions.created }
      });
      revalidateWebinars();

      return { id: created.id, slug: created.slug, status: created.status as WebinarStatus, updatedAt: created.updated_at };
    }

    const bundle = await loadBundle(db, data.id);
    const current = bundle.row;

    if (current.cancelled_at) {
      throw new WebinarError(CANCELLED_MESSAGE, 409);
    }

    assertSameVersion(current, data.expectedUpdatedAt);

    const published = current.status === "published";

    if (published && current.kind !== draft.kind) {
      throw new WebinarFieldError("kind", KIND_LOCKED_MESSAGE);
    }

    if (published) {
      const sameDate = draft.kind === "live" ? toTime(draft.scheduledAt) === toTime(current.scheduled_at) : true;
      const problems = publishProblems(draft, now.getTime()).filter((problem) => !(problem.message === WEBINAR_MESSAGES.pastDate && sameDate));

      if (problems[0]) {
        throw new WebinarFieldError(problems[0].path, problems[0].message);
      }
    }

    // O endereco (/webinarios/<slug>) nasce do titulo e so muda enquanto e rascunho nunca publicado.
    const titleChanged = draft.title.trim() !== current.title;
    const slug = !published && !current.published_at && titleChanged ? await freeSlug(db, draft.title, current.slug) : current.slug;
    // A versao ja foi conferida acima (isSameVersion); a guarda do update usa a versao lida agora, byte a byte.
    const saved = await updateWebinarRow(db, current.id, { ...patch, slug }, { expectedUpdatedAt: current.updated_at });
    await replacePresenterRows(db, saved.id, presenterRowsOf(draft));

    let sessions: SessionsSync = { created: 0, kept: 0, lateJoinUpdated: 0, removed: 0 };
    let rescheduled = false;

    if (draft.kind === "simulated") {
      const recording = await syncBaseRecording(db, saved.id, draft.recordingVideoUrl, bundle.recordings);
      sessions = await syncSimulatedSessions(db, saved.id, draft, bundle.sessions, recording?.id ?? null);
    } else {
      const live = liveSessionOf(bundle.sessions);

      if (live && live.status === "scheduled" && draft.scheduledAt && toTime(draft.scheduledAt) !== toTime(live.scheduled_at)) {
        const updated = await updateSessionRow(db, live.id, { scheduled_at: new Date(toTime(draft.scheduledAt)).toISOString() }, { expectedStatuses: ["scheduled"] });

        if (updated) {
          rescheduled = true;
          await queueWebinarRescheduledNotices(db, live.id, now);
        }
      }
    }

    await recordAudit(db, {
      action: "webinar.saved",
      actorId: user.id,
      entityId: saved.id,
      entityType: "webinar",
      metadata: {
        access_mode: saved.access_mode,
        created: false,
        kind: saved.kind,
        presenters: draft.presenters.length,
        rescheduled,
        sessions_created: sessions.created,
        sessions_late_join_updated: sessions.lateJoinUpdated,
        sessions_removed: sessions.removed,
        slug_changed: slug !== current.slug,
        status: saved.status
      }
    });
    revalidateWebinars(saved.id);

    return { id: saved.id, slug: saved.slug, status: saved.status as WebinarStatus, updatedAt: saved.updated_at };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Publicar, cancelar, duplicar, excluir
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.publish] Publica o rascunho: confere o rascunho inteiro (schema + publishProblems, o erro no campo),
 * marca published_at, cria a sessao `live` da Live ao vivo (se nao houver) ou garante as sessoes `simulated` da
 * Live gravada. O card na pagina inicial, a faixa e os lembretes passam a valer daqui.
 */
export async function publishWebinar(input: { expectedUpdatedAt?: string; id: string }): Promise<ActionResult<PublishedWebinar>> {
  return runAdminAction("messaging.publish", webinarIdSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const bundle = await loadBundle(db, data.id);
    const { row } = bundle;

    if (row.cancelled_at) {
      throw new WebinarError(CANCELLED_MESSAGE, 409);
    }

    if (row.status !== "draft") {
      throw new WebinarError(ALREADY_PUBLISHED_MESSAGE, 409);
    }

    assertSameVersion(row, data.expectedUpdatedAt);

    const parsed = webinarDraftSchema.safeParse(draftOfBundle(bundle));

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new WebinarFieldError(issue?.path.map(String).join(".") || "title", issue?.message ?? WEBINAR_MESSAGES.title);
    }

    const draft = parsed.data;
    const [problem] = publishProblems(draft, now.getTime());

    if (problem) {
      throw new WebinarFieldError(problem.path, problem.message);
    }

    const publishedAt = now.toISOString();
    const saved = await updateWebinarRow(db, row.id, { published_at: publishedAt, status: "published" }, { expectedStatuses: ["draft"], expectedUpdatedAt: row.updated_at });
    let sessionsCreated = 0;

    if (draft.kind === "live" && draft.scheduledAt) {
      const live = liveSessionOf(bundle.sessions);
      const scheduledAt = new Date(toTime(draft.scheduledAt)).toISOString();

      if (!live) {
        await insertSessionRows(db, [
          { chat_mode: draft.roomSettings.chatMode, chat_slow_mode_seconds: draft.roomSettings.slowModeSeconds, kind: "live", scheduled_at: scheduledAt, status: "scheduled", webinar_id: row.id }
        ]);
        sessionsCreated = 1;
      } else if (live.status === "scheduled" && toTime(live.scheduled_at) !== toTime(scheduledAt)) {
        await updateSessionRow(db, live.id, { scheduled_at: scheduledAt }, { expectedStatuses: ["scheduled"] });
      }
    } else if (draft.kind === "simulated") {
      const recording = baseRecordingOf(bundle.recordings);
      const sync = await syncSimulatedSessions(db, row.id, draft, bundle.sessions, recording?.id ?? null);
      sessionsCreated = sync.created;
    }

    await recordAudit(db, {
      action: "webinar.published",
      actorId: user.id,
      entityId: row.id,
      entityType: "webinar",
      metadata: {
        access_mode: saved.access_mode,
        capacity: saved.capacity,
        kind: saved.kind,
        registration_required: saved.registration_required,
        sessions_created: sessionsCreated
      }
    });
    revalidateWebinars(row.id);

    const sessions = (await listSessionRows(db, [row.id])).map(sessionFromRow);

    return {
      id: saved.id,
      publishedAt,
      situation: webinarSituation(webinarFromRow(saved), sessions, now.getTime()),
      slug: saved.slug,
      status: saved.status as WebinarStatus,
      updatedAt: saved.updated_at
    };
  });
}

/**
 * [messaging.publish] Cancela um webinario publicado com o motivo: as sessoes abertas viram `cancelled` e quem
 * tinha vaga recebe "Live cancelada" pelo sino e por e-mail (queueWebinarCancelledNotices, entrega 1c).
 */
export async function cancelWebinar(input: { expectedUpdatedAt?: string; id: string; reason?: string }): Promise<ActionResult<CancelledWebinar>> {
  return runAdminAction("messaging.publish", cancelWebinarSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const row = await requireWebinarRow(db, data.id);

    if (row.cancelled_at) {
      throw new WebinarError(CANCELLED_MESSAGE, 409);
    }

    if (row.status !== "published") {
      throw new WebinarError(ONLY_PUBLISHED_CANCELS, 409);
    }

    assertSameVersion(row, data.expectedUpdatedAt);

    const saved = await updateWebinarRow(
      db,
      row.id,
      { cancel_reason: data.reason.trim() ? data.reason.trim().slice(0, WEBINAR_LIMITS.cancelReason) : null, cancelled_at: now.toISOString() },
      { expectedStatuses: ["published"], expectedUpdatedAt: row.updated_at }
    );
    const sessions = await listSessionRows(db, [row.id]);
    let sessionsCancelled = 0;

    for (const session of sessions.filter((item) => item.status === "scheduled" || item.status === "waiting" || item.status === "live")) {
      const updated = await updateSessionRow(db, session.id, { status: "cancelled" }, { expectedStatuses: ["scheduled", "waiting", "live"] });

      if (updated) {
        sessionsCancelled += 1;
      }
    }

    const registered = (await countRegistrationsByWebinar(db, [row.id])).get(row.id) ?? 0;
    const notices = await queueWebinarCancelledNotices(db, row.id, now);

    await recordAudit(db, {
      action: "webinar.cancelled",
      actorId: user.id,
      count: registered,
      entityId: row.id,
      entityType: "webinar",
      metadata: { emails: notices.emails, kind: row.kind, notifications: notices.notifications, registered, sessions_cancelled: sessionsCancelled, with_reason: Boolean(saved.cancel_reason) }
    });
    revalidateWebinars(row.id);

    return { id: saved.id, registered, situation: "cancelled", updatedAt: saved.updated_at };
  });
}

/**
 * [messaging.write] Copia o webinario como rascunho, "Cópia de …": tudo menos data, vagas, chat e relatorio
 * (docs/30 §2.3). Os apresentadores e o video base da Live gravada vao junto.
 */
export async function duplicateWebinar(input: { expectedUpdatedAt?: string; id: string }): Promise<ActionResult<{ id: string; updatedAt: string }>> {
  return runAdminAction("messaging.write", webinarIdSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const bundle = await loadBundle(db, data.id);
    const source = draftOfBundle(bundle);
    const title = `Cópia de ${bundle.row.title}`.slice(0, WEBINAR_LIMITS.title);
    const draft: WebinarDraft = { ...source, scheduledAt: null, sessions: [], title };
    const created = await insertWithFreeSlug(db, { ...webinarRowPatch(draft), created_by: user.id, status: "draft" }, title);
    await replacePresenterRows(db, created.id, presenterRowsOf(draft));

    if (draft.kind === "simulated" && draft.recordingVideoUrl) {
      await syncBaseRecording(db, created.id, draft.recordingVideoUrl, []);
    }

    await recordAudit(db, {
      action: "webinar.duplicated",
      actorId: user.id,
      entityId: created.id,
      entityType: "webinar",
      metadata: { kind: created.kind, presenters: draft.presenters.length, source_id: bundle.row.id }
    });
    revalidateWebinars();

    return { id: created.id, updatedAt: created.updated_at };
  });
}

/** [messaging.publish] Exclui um rascunho (soft delete). O publicado e cancelado, nunca excluido. */
export async function deleteWebinar(input: { expectedUpdatedAt?: string; id: string }): Promise<ActionResult<{ id: string }>> {
  return runAdminAction("messaging.publish", webinarIdSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const row = await requireWebinarRow(db, data.id);

    if (row.status !== "draft" || row.cancelled_at) {
      throw new WebinarError(ONLY_DRAFT_DELETES, 409);
    }

    assertSameVersion(row, data.expectedUpdatedAt);
    await softDeleteWebinarRow(db, row.id, now.toISOString());

    await recordAudit(db, {
      action: "webinar.deleted",
      actorId: user.id,
      entityId: row.id,
      entityType: "webinar",
      metadata: { kind: row.kind, status: row.status }
    });
    // So a lista: a pagina do rascunho excluido nao existe mais (a tela volta para a lista).
    revalidatePath(LIST_PATH);

    return { id: row.id };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Sessao e capa
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.write] Muda a hora marcada de uma sessao que ainda nao comecou; na Live ao vivo, webinars.scheduled_at
 * acompanha. Quem tinha vaga recebe "A live mudou para…" e os lembretes recomecam (entrega 1c).
 */
export async function rescheduleSession(input: { scheduledAt: string; sessionId: string; webinarId: string }): Promise<ActionResult<{ scheduledAt: string; sessionId: string; updatedAt: string }>> {
  return runAdminAction("messaging.write", rescheduleSessionSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const row = await requireWebinarRow(db, data.webinarId);
    const session = await fetchSessionRow(db, data.sessionId);

    if (!session || session.webinar_id !== row.id) {
      throw new WebinarError(SESSION_MISSING_MESSAGE, 404);
    }

    if (row.cancelled_at) {
      throw new WebinarError(CANCELLED_MESSAGE, 409);
    }

    if (session.status !== "scheduled") {
      throw new WebinarError(SESSION_NOT_SCHEDULED_MESSAGE, 409);
    }

    const scheduledAt = new Date(toTime(data.scheduledAt)).toISOString();

    if (toTime(scheduledAt) <= now.getTime()) {
      throw new WebinarFieldError("scheduledAt", WEBINAR_MESSAGES.pastDate);
    }

    const updated = await updateSessionRow(db, session.id, { scheduled_at: scheduledAt }, { expectedStatuses: ["scheduled"] });

    if (!updated) {
      throw new WebinarError(SESSION_NOT_SCHEDULED_MESSAGE, 409);
    }

    let updatedAt = row.updated_at;

    if (session.kind === "live") {
      updatedAt = (await updateWebinarRow(db, row.id, { scheduled_at: scheduledAt })).updated_at;
    }

    const notices = await queueWebinarRescheduledNotices(db, session.id, now);

    await recordAudit(db, {
      action: "webinar.rescheduled",
      actorId: user.id,
      entityId: row.id,
      entityType: "webinar",
      metadata: { emails: notices.emails, kind: session.kind, notifications: notices.notifications, session_id: session.id }
    });
    revalidateWebinars(row.id);

    return { scheduledAt, sessionId: session.id, updatedAt };
  });
}

/**
 * [messaging.write] Sobe a capa recortada (WebP; 2:3 como a capa de produto, ou 16:9) para o content-assets em
 * webinars/covers e devolve o endereco publico. O servidor le as medidas no cabecalho do WebP antes de enviar.
 */
export async function uploadWebinarCover(input: { image: string; slot?: "cover" | "notice" }): Promise<ActionResult<{ url: string }>> {
  return runAdminAction("messaging.write", uploadCoverSchema, input, async ({ input: data }) => {
    const check = checkProductImage(data.slot, decodeWebpDataUrl(data.image));

    if (!check.ok) {
      throw new WebinarFieldError("coverUrl", check.message);
    }

    const url = (await persistImageAsset(data.image, "webinars/covers")).trim();

    return { url };
  });
}
