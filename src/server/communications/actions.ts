"use server";

// Server Actions de Comunicacao > Avisos e pop-ups (docs/22 §3; docs/17 §1.8 e D4). Toda acao passa
// por runAdminAction (permissao + zod + ActionResult), confere a versao lida pela tela (updated_at ->
// 409) e grava na auditoria (admin_audit_log, so ids e contagens). Permissoes:
// - messaging.write: salvar rascunho, previa do segmento, publicar (ou pedir aprovacao), duplicar,
//   excluir, teste para mim, imagem;
// - messaging.publish: cancelar agendamento, pausar, retomar, encerrar, retirar; editar pop-up no ar;
// - messaging.publish_large: aprovar ou devolver o pedido de outra pessoa.
// Publicar: sem messaging.publish, ou acima de 500 alunos sem messaging.publish_large, o aviso fica
// "Aguardando aprovação" (publishDecision). Editar ou retomar pop-up no ar segue a mesma regra, mas
// sem pedido: quem nao pode publicar para aquele segmento recebe 403. Publicar e aprovar contam e
// gravam a mesma versao (updated_at da linha lida). A equipe nunca entra na contagem nem recebe aviso.
// Os 5 nomes da previa do segmento so vao para quem tem students.read_basic (a lista de Alunos).

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { isHttpsOrLoopbackUrl } from "@/lib/loopback-url";
import { runAdminAction } from "@/server/actions/run-action";
import { recordAudit } from "@/server/audit/log";
import { can, type AdminAccess } from "@/server/auth/roles";
import { checkProductImage, decodeWebpDataUrl } from "@/server/catalog/webp";
import { persistImageAsset } from "@/server/db/media-assets";
import { previewAudience, resolveAudienceUserIds, type AudienceSamplePerson } from "./audience";
import { loadAudienceFacts, type LoadedAudience } from "./audience-facts";
import { describeAudience, normalizeAudience, type AudienceDefinition } from "./audience-model";
import { invalidateLivePopups } from "./cache";
import {
  isEditableStatus,
  isSameVersion,
  publishDecision,
  situationOf,
  type CampaignSituation,
  type CampaignStatus
} from "./campaign-model";
import { communicationsDb, CommunicationError, NoticeFieldError, type CommunicationsDb } from "./db";
import { dispatchInboxCampaign, refreshPopupDeliveries } from "./dispatch";
import { loadAudienceNames } from "./queries";
import {
  noticeDraftSchema,
  noticeIdSchema,
  previewAudienceSchema,
  publishProblems,
  saveNoticeSchema,
  uploadNoticeImageSchema,
  type NoticeIdInput,
  type SaveNoticeInput
} from "./schemas";
import {
  audienceOfRow,
  deleteCampaignNotifications,
  draftToColumns,
  fetchCampaign,
  insertCampaign,
  NOTICE_CHANGED_MESSAGE,
  NOTICE_MISSING_MESSAGE,
  rowToDraft,
  softDeleteCampaign,
  updateCampaign,
  type CampaignPatch,
  type CampaignRow
} from "./store";

const LIST_PATH = "/admin/comunicacao/avisos";
const NOT_EDITABLE = "Este aviso não pode mais ser editado. Duplique para criar outro.";
const EMPTY_AUDIENCE = "Nenhum aluno está neste segmento agora.";
const LIVE_EDIT_NEEDS_PUBLISH = "Só quem pode publicar muda um pop-up no ar. Duplique para criar outro.";
const LIVE_EDIT_NEEDS_APPROVAL = "Para mudar um pop-up no ar para este segmento, peça a um dono ou administrador.";
const RESUME_NEEDS_APPROVAL = "Este pop-up passou de 500 alunos. Para retomar, peça a um dono ou administrador.";

export type SavedNotice = { id: string; status: CampaignStatus; updatedAt: string };
export type PublishedNotice = {
  audienceCount: number;
  id: string;
  /** Notificacao enviada agora: quantos alunos receberam. */
  recipients: number | null;
  situation: CampaignSituation;
  updatedAt: string;
};
export type NoticeStateChange = { id: string; situation: CampaignSituation; updatedAt: string };
export type AudiencePreview = { count: number; description: string; sample: AudienceSamplePerson[] };

/* ------------------------------------------------------------------------------------------------
 * Apoio
 * ---------------------------------------------------------------------------------------------- */

function revalidateNotices(id?: string) {
  revalidatePath(LIST_PATH);

  if (id) {
    revalidatePath(`${LIST_PATH}/${id}`);
  }
}

async function requireCampaign(db: CommunicationsDb, id: string) {
  const row = await fetchCampaign(db, id);

  if (!row) {
    throw new CommunicationError(NOTICE_MISSING_MESSAGE, 404);
  }

  return row;
}

/** A tela leu outra versao (updated_at) do que esta no banco agora: 409 antes de contar ou gravar. */
function assertSameVersion(row: CampaignRow, expectedUpdatedAt: string | undefined) {
  if (expectedUpdatedAt && !isSameVersion(expectedUpdatedAt, row.updated_at)) {
    throw new CommunicationError(NOTICE_CHANGED_MESSAGE, 409);
  }
}

function canPublishTo(access: AdminAccess, audienceCount: number) {
  return (
    publishDecision({
      audienceCount,
      canPublish: can(access, "messaging.publish"),
      canPublishLarge: can(access, "messaging.publish_large")
    }) === "publish"
  );
}

function situationNow(row: CampaignRow, now: number) {
  return situationOf({ endsAt: row.ends_at, kind: row.kind, sendAt: row.send_at, startsAt: row.starts_at, status: row.status }, now);
}

function stateChange(row: CampaignRow, now: number): NoticeStateChange {
  return { id: row.id, situation: situationNow(row, now), updatedAt: row.updated_at };
}

/** JSON com chaves em ordem (o jsonb do banco devolve as chaves em outra ordem). */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value ?? null);
}

/** Regras do rascunho e as que so valem ao publicar (data no futuro); erro vira 400 com o campo. */
function assertPublishable(row: CampaignRow, now: number) {
  const parsed = noticeDraftSchema.safeParse(rowToDraft(row));

  if (!parsed.success) {
    throw parsed.error;
  }

  const [problem] = publishProblems(parsed.data, now);

  if (problem) {
    throw new NoticeFieldError(problem.path, problem.message);
  }
}

function countAudience(row: CampaignRow, loaded: LoadedAudience) {
  const count = resolveAudienceUserIds(audienceOfRow(row), loaded).length;

  if (count === 0) {
    throw new CommunicationError(EMPTY_AUDIENCE, 422);
  }

  return count;
}

/**
 * Coloca o aviso no ar: notificacao agendada fica `scheduled`; notificacao para agora e reservada
 * (`sending`) e enviada aqui mesmo; pop-up fica `active` e a lista de quem ve e montada na hora.
 * `approved`: quem aprovou o pedido, ou quem publica com messaging.publish_large; grava approved_at
 * (a notificacao agendada sai mesmo que o segmento passe de 500 ate a hora). Sem isso, approved_at
 * fica vazio e o envio confere o limite de novo.
 */
async function goLive(input: {
  actorId: string;
  approved: boolean;
  count: number;
  db: CommunicationsDb;
  expectedStatuses: readonly CampaignStatus[];
  loaded: LoadedAudience;
  now: Date;
  row: CampaignRow;
}): Promise<PublishedNotice> {
  const { db, now, row } = input;
  const nowIso = now.toISOString();
  // Sempre a versao contada (a linha lida): um segmento salvo depois da contagem da 409.
  const guard = { expectedStatuses: input.expectedStatuses, expectedUpdatedAt: row.updated_at };
  const common: CampaignPatch = {
    approved_at: input.approved ? nowIso : null,
    approved_by: input.approved ? input.actorId : null,
    audience_count: input.count,
    audience_counted_at: nowIso,
    dispatch_attempts: 0,
    last_error: null,
    updated_by: input.actorId
  };

  if (row.kind === "inbox") {
    if (row.send_at && Date.parse(row.send_at) > now.getTime()) {
      const scheduled = await updateCampaign(db, row.id, { ...common, status: "scheduled" }, guard);

      return { audienceCount: input.count, id: row.id, recipients: null, situation: "scheduled", updatedAt: scheduled.updated_at };
    }

    const claimed = await updateCampaign(db, row.id, { ...common, dispatch_started_at: nowIso, send_at: nowIso, status: "sending" }, guard);
    const result = await dispatchInboxCampaign({ campaign: claimed, db, loaded: input.loaded, now });
    const latest = (await fetchCampaign(db, row.id)) ?? claimed;

    return { audienceCount: input.count, id: row.id, recipients: result.recipients, situation: result.status, updatedAt: latest.updated_at };
  }

  const active = await updateCampaign(db, row.id, { ...common, sent_at: row.sent_at ?? nowIso, status: "active" }, guard);

  try {
    await refreshPopupDeliveries({ campaign: active, db, loaded: input.loaded, now });
  } catch (error) {
    // O pop-up ja esta no ar; sem a lista recalculada (audience_refreshed_at vazio), o job do proximo
    // minuto monta quem ve.
    console.error(`[comunicacao] pop-up ${row.id} publicado sem a lista de quem ve: ${error instanceof Error ? error.message : String(error)}`);
  }

  invalidateLivePopups({ from: "action" });

  const latest = (await fetchCampaign(db, row.id)) ?? active;

  return { audienceCount: input.count, id: row.id, recipients: null, situation: situationNow(latest, now.getTime()), updatedAt: latest.updated_at };
}

/* ------------------------------------------------------------------------------------------------
 * Rascunho, previa e publicacao
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.write] Cria ou atualiza o aviso. Agendado ou aguardando aprovacao volta a rascunho;
 * pop-up no ar ou pausado continua como esta (e recalcula quem ve se o segmento mudou). Mudar o pop-up
 * no ar vale como publicar: precisa de messaging.publish e, acima de 500 alunos (o segmento novo, ou a
 * contagem gravada quando o segmento nao mudou), de messaging.publish_large; senao, 403.
 */
export async function saveNoticeDraft(input: SaveNoticeInput): Promise<ActionResult<SavedNotice>> {
  return runAdminAction("messaging.write", saveNoticeSchema, input, async ({ access, input: data, user }) => {
    const db = communicationsDb();
    const columns = draftToColumns(data.draft);

    if (!data.id) {
      const created = await insertCampaign(db, { ...columns, created_by: user.id, status: "draft", updated_by: user.id });

      await recordAudit(db, { action: "communication.saved", actorId: user.id, entityId: created.id, entityType: "campaign", metadata: { created: true, kind: created.kind } });
      revalidateNotices();

      return { id: created.id, status: created.status, updatedAt: created.updated_at };
    }

    const current = await requireCampaign(db, data.id);

    if (!isEditableStatus(current.kind, current.status)) {
      throw new CommunicationError(NOT_EDITABLE, 409);
    }

    const live = current.kind === "popup" && (current.status === "active" || current.status === "paused");
    const audienceChanged = stableJson(normalizeAudience(audienceOfRow(current))) !== stableJson(columns.audience);
    const now = new Date();
    let loaded: LoadedAudience | undefined;

    if (live) {
      if (columns.kind !== current.kind) {
        throw new NoticeFieldError("kind", "O tipo não muda depois de publicado.");
      }

      const [problem] = publishProblems(data.draft, now.getTime());

      if (problem) {
        throw new NoticeFieldError(problem.path, problem.message);
      }

      if (!can(access, "messaging.publish")) {
        throw new CommunicationError(LIVE_EDIT_NEEDS_PUBLISH, 403);
      }

      if (audienceChanged) {
        loaded = await loadAudienceFacts(db, now);
      }

      const count = loaded ? resolveAudienceUserIds(columns.audience, loaded).length : (current.audience_count ?? 0);

      if (!canPublishTo(access, count)) {
        throw new CommunicationError(LIVE_EDIT_NEEDS_APPROVAL, 403);
      }
    }

    const patch: CampaignPatch = {
      ...columns,
      updated_by: user.id,
      ...(live ? {} : { requested_at: null, requested_by: null, status: "draft" as const })
    };
    let saved = await updateCampaign(db, current.id, patch, { expectedStatuses: [current.status], expectedUpdatedAt: data.expectedUpdatedAt });

    if (live) {
      if (audienceChanged) {
        await refreshPopupDeliveries({ campaign: saved, db, loaded, now });
        saved = (await fetchCampaign(db, saved.id)) ?? saved;
      }

      invalidateLivePopups({ from: "action" });
    }

    await recordAudit(db, {
      action: "communication.saved",
      actorId: user.id,
      entityId: saved.id,
      entityType: "campaign",
      metadata: { audience_changed: audienceChanged, from_status: current.status, kind: saved.kind, to_status: saved.status }
    });
    revalidateNotices(saved.id);

    return { id: saved.id, status: saved.status, updatedAt: saved.updated_at };
  });
}

/**
 * [messaging.write] Contagem ao vivo do segmento: quantos alunos, 5 nomes e a frase "Alunos que ...".
 * Os nomes so vao para quem pode ver a lista de Alunos (students.read_basic); para os demais, a amostra
 * vem vazia (combinar regras e ler nomes revelaria progresso, estudo e acesso de alunos com nome).
 */
export async function previewNoticeAudience(input: { audience: AudienceDefinition }): Promise<ActionResult<AudiencePreview>> {
  return runAdminAction("messaging.write", previewAudienceSchema, input, async ({ access, input: data }) => {
    const db = communicationsDb();
    const definition = normalizeAudience(data.audience);
    const [loaded, names] = await Promise.all([loadAudienceFacts(db, new Date()), loadAudienceNames(db, [definition])]);
    const preview = previewAudience(definition, loaded);

    return {
      count: preview.count,
      description: describeAudience(definition, names),
      sample: can(access, "students.read_basic") ? preview.sample : []
    };
  });
}

/**
 * [messaging.write] Publica o rascunho na versao lida pela tela. Conta o segmento agora (0 alunos =
 * 422) e decide: publicar direto ou "Aguardando aprovação" (sem messaging.publish, ou acima de 500 sem
 * messaging.publish_large).
 */
export async function publishNotice(input: NoticeIdInput): Promise<ActionResult<PublishedNotice>> {
  return runAdminAction("messaging.write", noticeIdSchema, input, async ({ access, input: data, user }) => {
    const db = communicationsDb();
    const now = new Date();
    const row = await requireCampaign(db, data.id);

    if (row.status !== "draft") {
      throw new CommunicationError(
        row.status === "pending_approval" ? "Este aviso já está aguardando aprovação." : "Este aviso já foi publicado. Recarregue a página.",
        409
      );
    }

    assertSameVersion(row, data.expectedUpdatedAt);
    assertPublishable(row, now.getTime());

    const loaded = await loadAudienceFacts(db, now);
    const count = countAudience(row, loaded);

    if (!canPublishTo(access, count)) {
      const nowIso = now.toISOString();
      const pending = await updateCampaign(
        db,
        row.id,
        { audience_count: count, audience_counted_at: nowIso, requested_at: nowIso, requested_by: user.id, status: "pending_approval", updated_by: user.id },
        { expectedStatuses: ["draft"], expectedUpdatedAt: row.updated_at }
      );

      await recordAudit(db, { action: "communication.approval_requested", actorId: user.id, count, entityId: row.id, entityType: "campaign", metadata: { kind: row.kind } });
      revalidateNotices(row.id);

      return { audienceCount: count, id: row.id, recipients: null, situation: "pending_approval", updatedAt: pending.updated_at };
    }

    const published = await goLive({
      actorId: user.id,
      approved: can(access, "messaging.publish_large"),
      count,
      db,
      expectedStatuses: ["draft"],
      loaded,
      now,
      row
    });

    await recordAudit(db, {
      action: "communication.published",
      actorId: user.id,
      count,
      entityId: row.id,
      entityType: "campaign",
      metadata: { kind: row.kind, recipients: published.recipients, situation: published.situation }
    });
    revalidateNotices(row.id);

    return published;
  });
}

/**
 * [messaging.publish_large] Aprova o pedido: publica como se a pessoa que aprova tivesse publicado, na
 * versao que ela revisou (a mesma que e contada e gravada).
 */
export async function approveNotice(input: NoticeIdInput): Promise<ActionResult<PublishedNotice>> {
  return runAdminAction("messaging.publish_large", noticeIdSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const now = new Date();
    const row = await requireCampaign(db, data.id);

    if (row.status !== "pending_approval") {
      throw new CommunicationError("Este aviso não está aguardando aprovação.", 409);
    }

    assertSameVersion(row, data.expectedUpdatedAt);
    assertPublishable(row, now.getTime());

    const loaded = await loadAudienceFacts(db, now);
    const count = countAudience(row, loaded);
    const published = await goLive({
      actorId: user.id,
      approved: true,
      count,
      db,
      expectedStatuses: ["pending_approval"],
      loaded,
      now,
      row
    });

    await recordAudit(db, {
      action: "communication.approved",
      actorId: user.id,
      count,
      entityId: row.id,
      entityType: "campaign",
      metadata: { kind: row.kind, recipients: published.recipients, requested_by: row.requested_by, situation: published.situation }
    });
    revalidateNotices(row.id);

    return published;
  });
}

/** [messaging.publish_large] Devolve o pedido de aprovacao: o aviso volta a rascunho. */
export async function rejectNotice(input: NoticeIdInput): Promise<ActionResult<NoticeStateChange>> {
  return runAdminAction("messaging.publish_large", noticeIdSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const row = await requireCampaign(db, data.id);
    const updated = await updateCampaign(
      db,
      row.id,
      { requested_at: null, requested_by: null, status: "draft", updated_by: user.id },
      { expectedStatuses: ["pending_approval"], expectedUpdatedAt: data.expectedUpdatedAt }
    );

    await recordAudit(db, { action: "communication.rejected", actorId: user.id, entityId: row.id, entityType: "campaign", metadata: { kind: row.kind, requested_by: row.requested_by } });
    revalidateNotices(row.id);

    return stateChange(updated, Date.now());
  });
}

/* ------------------------------------------------------------------------------------------------
 * Agenda e pop-up no ar
 * ---------------------------------------------------------------------------------------------- */

/** [messaging.publish] Notificacao agendada volta a rascunho (nada foi enviado). */
export async function cancelScheduledNotice(input: NoticeIdInput): Promise<ActionResult<NoticeStateChange>> {
  return runAdminAction("messaging.publish", noticeIdSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const row = await requireCampaign(db, data.id);
    const updated = await updateCampaign(
      db,
      row.id,
      { status: "draft", updated_by: user.id },
      { expectedStatuses: ["scheduled"], expectedUpdatedAt: data.expectedUpdatedAt }
    );

    await recordAudit(db, { action: "communication.canceled", actorId: user.id, entityId: row.id, entityType: "campaign", metadata: { kind: row.kind } });
    revalidateNotices(row.id);

    return stateChange(updated, Date.now());
  });
}

/**
 * Pausar, retomar ou encerrar o pop-up, na versao lida. Retomar recoloca no ar para o segmento de agora:
 * acima de 500 alunos, so com messaging.publish_large (senao 403, sem pedido de aprovacao).
 */
async function changePopupStatus(input: {
  access: AdminAccess;
  actorId: string;
  audit: "communication.ended" | "communication.paused" | "communication.resumed";
  expectedUpdatedAt?: string;
  from: readonly CampaignStatus[];
  id: string;
  to: "active" | "ended" | "paused";
}) {
  const db = communicationsDb();
  const now = new Date();
  const row = await requireCampaign(db, input.id);

  if (row.kind !== "popup") {
    throw new CommunicationError("Esta ação vale só para pop-ups.", 422);
  }

  if (!input.from.includes(row.status)) {
    throw new CommunicationError(NOTICE_CHANGED_MESSAGE, 409);
  }

  assertSameVersion(row, input.expectedUpdatedAt);

  let loaded: LoadedAudience | undefined;

  if (input.to === "active") {
    loaded = await loadAudienceFacts(db, now);

    if (!canPublishTo(input.access, resolveAudienceUserIds(audienceOfRow(row), loaded).length)) {
      throw new CommunicationError(RESUME_NEEDS_APPROVAL, 403);
    }
  }

  const patch: CampaignPatch = { status: input.to, updated_by: input.actorId };

  if (input.to === "ended") {
    const endsAt = row.ends_at ? Date.parse(row.ends_at) : null;
    const startsAt = row.starts_at ? Date.parse(row.starts_at) : null;

    // Fim da janela = agora (sem ultrapassar o inicio de uma janela que ainda nem comecou).
    if ((endsAt === null || endsAt > now.getTime()) && (startsAt === null || startsAt < now.getTime())) {
      patch.ends_at = now.toISOString();
    }
  }

  let updated = await updateCampaign(db, row.id, patch, { expectedStatuses: input.from, expectedUpdatedAt: row.updated_at });

  if (input.to === "active") {
    await refreshPopupDeliveries({ campaign: updated, db, loaded, now });
    updated = (await fetchCampaign(db, updated.id)) ?? updated;
  }

  invalidateLivePopups({ from: "action" });
  await recordAudit(db, { action: input.audit, actorId: input.actorId, entityId: row.id, entityType: "campaign", metadata: { kind: row.kind } });
  revalidateNotices(row.id);

  return stateChange(updated, now.getTime());
}

/** [messaging.publish] Pausa o pop-up no ar (some da home ate retomar). */
export async function pauseNotice(input: NoticeIdInput): Promise<ActionResult<NoticeStateChange>> {
  return runAdminAction("messaging.publish", noticeIdSchema, input, ({ access, input: data, user }) =>
    changePopupStatus({ access, actorId: user.id, audit: "communication.paused", expectedUpdatedAt: data.expectedUpdatedAt, from: ["active"], id: data.id, to: "paused" })
  );
}

/** [messaging.publish] Retoma o pop-up pausado (recalcula quem ve; acima de 500, messaging.publish_large). */
export async function resumeNotice(input: NoticeIdInput): Promise<ActionResult<NoticeStateChange>> {
  return runAdminAction("messaging.publish", noticeIdSchema, input, ({ access, input: data, user }) =>
    changePopupStatus({ access, actorId: user.id, audit: "communication.resumed", expectedUpdatedAt: data.expectedUpdatedAt, from: ["paused"], id: data.id, to: "active" })
  );
}

/** [messaging.publish] Encerra o pop-up de vez (no ar ou pausado). */
export async function endNotice(input: NoticeIdInput): Promise<ActionResult<NoticeStateChange>> {
  return runAdminAction("messaging.publish", noticeIdSchema, input, ({ access, input: data, user }) =>
    changePopupStatus({ access, actorId: user.id, audit: "communication.ended", expectedUpdatedAt: data.expectedUpdatedAt, from: ["active", "paused"], id: data.id, to: "ended" })
  );
}

/** [messaging.publish] Retira a notificacao enviada: some do sino dos alunos (fica como cancelada). */
export async function withdrawNotice(input: NoticeIdInput): Promise<ActionResult<NoticeStateChange & { removed: number }>> {
  return runAdminAction("messaging.publish", noticeIdSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const row = await requireCampaign(db, data.id);

    if (row.kind !== "inbox") {
      throw new CommunicationError("Esta ação vale só para notificações.", 422);
    }

    // Primeiro a situacao (o sino ja esconde aviso que nao esta enviado), depois as linhas.
    const updated = await updateCampaign(
      db,
      row.id,
      { status: "canceled", updated_by: user.id },
      { expectedStatuses: ["sent"], expectedUpdatedAt: data.expectedUpdatedAt }
    );
    const removed = await deleteCampaignNotifications(db, row.id);

    await recordAudit(db, { action: "communication.withdrawn", actorId: user.id, count: removed, entityId: row.id, entityType: "campaign", metadata: { kind: row.kind } });
    revalidateNotices(row.id);

    return { ...stateChange(updated, Date.now()), removed };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Duplicar, excluir, teste e imagem
 * ---------------------------------------------------------------------------------------------- */

/** [messaging.write] Novo rascunho com o mesmo conteudo e segmento (data que ja passou fica para "agora"). */
export async function duplicateNotice(input: NoticeIdInput): Promise<ActionResult<{ id: string; updatedAt: string }>> {
  return runAdminAction("messaging.write", noticeIdSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const now = Date.now();
    const row = await requireCampaign(db, data.id);
    const draft = rowToDraft(row);

    if (draft.schedule.mode === "at" && Date.parse(draft.schedule.sendAt) <= now) {
      draft.schedule = { mode: "now" };
    }

    if (draft.window.endsAt && Date.parse(draft.window.endsAt) <= now) {
      draft.window = { endsAt: null, startsAt: null };
    }

    const created = await insertCampaign(db, { ...draftToColumns(draft), created_by: user.id, status: "draft", updated_by: user.id });

    await recordAudit(db, { action: "communication.duplicated", actorId: user.id, entityId: created.id, entityType: "campaign", metadata: { kind: created.kind, source_id: row.id } });
    revalidateNotices();

    return { id: created.id, updatedAt: created.updated_at };
  });
}

/** [messaging.write] Exclui rascunho, aviso aguardando aprovacao, cancelado ou encerrado. */
export async function deleteNotice(input: NoticeIdInput): Promise<ActionResult<{ id: string }>> {
  return runAdminAction("messaging.write", noticeIdSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const now = new Date();
    const row = await requireCampaign(db, data.id);
    const situation = situationNow(row, now.getTime());
    const deletable = ["draft", "pending_approval", "canceled", "ended"].includes(row.status) || (row.kind === "popup" && situation === "ended");

    if (!deletable) {
      throw new CommunicationError(
        row.kind === "popup" ? "Encerre o pop-up antes de excluir." : "Notificação enviada não é excluída: use Retirar para tirar do sino dos alunos.",
        409
      );
    }

    await softDeleteCampaign(db, row.id, { actorId: user.id, expectedStatuses: [row.status], expectedUpdatedAt: data.expectedUpdatedAt, now });

    if (row.kind === "popup") {
      invalidateLivePopups({ from: "action" });
    }

    await recordAudit(db, { action: "communication.deleted", actorId: user.id, entityId: row.id, entityType: "campaign", metadata: { kind: row.kind, status: row.status } });
    revalidateNotices();

    return { id: row.id };
  });
}

/**
 * [messaging.write] Manda a notificacao (como esta gravada) para o sino de quem pediu, marcada como
 * teste: nao conta nos numeros e nao muda o aviso. Repetir traz o teste de volta como nao lido.
 */
export async function sendNoticeTestToMe(input: NoticeIdInput): Promise<ActionResult<{ sent: true }>> {
  return runAdminAction("messaging.write", noticeIdSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const row = await requireCampaign(db, data.id);

    if (row.kind !== "inbox") {
      throw new CommunicationError("O teste vale só para notificações. Veja o pop-up na prévia.", 422);
    }

    const dedupeKey = `campaign-test:${row.id}`;
    const nowIso = new Date().toISOString();
    const existing = await db.from("notifications").select("id").eq("user_id", user.id).eq("dedupe_key", dedupeKey).maybeSingle();

    if (existing.error) {
      throw new Error(`Comunicacao: teste: ${existing.error.message}`);
    }

    const result = existing.data
      ? await db
          .from("notifications")
          .update({ clicked_at: null, created_at: nowIso, read_at: null, responded_at: null, response: null, seen_at: null })
          .eq("id", (existing.data as { id: string }).id)
      : await db.from("notifications").insert({ campaign_id: row.id, dedupe_key: dedupeKey, is_test: true, kind: "notice", user_id: user.id });

    if (result.error) {
      throw new Error(`Comunicacao: teste: ${result.error.message}`);
    }

    await recordAudit(db, { action: "communication.test_sent", actorId: user.id, entityId: row.id, entityType: "campaign", metadata: { kind: row.kind } });

    return { sent: true as const };
  });
}

/** [messaging.write] Imagem 16:9 do aviso (slot "notice"): confere o WebP, envia e devolve a URL. */
export async function uploadNoticeImage(input: { image: string }): Promise<ActionResult<{ url: string }>> {
  return runAdminAction("messaging.write", uploadNoticeImageSchema, input, async ({ input: data }) => {
    const check = checkProductImage("notice", decodeWebpDataUrl(data.image));

    if (!check.ok) {
      throw new NoticeFieldError("image", check.message);
    }

    const url = (await persistImageAsset(data.image, "communications/images")).trim();

    if (!isHttpsOrLoopbackUrl(new URL(url))) {
      throw new Error("Comunicacao: a imagem nao foi enviada ao armazenamento.");
    }

    return { url };
  });
}
