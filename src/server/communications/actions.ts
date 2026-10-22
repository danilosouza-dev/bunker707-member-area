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
//
// v2 (docs/23): "Quem envia" so aceita a equipe (conferido ao salvar, 400, e ao publicar ou aprovar,
// 422) e a pessoa escolhida recebe o e-mail "enviada em seu nome" quando a notificacao sai; o conteudo
// de um passo de fluxo so muda pelo fluxo (409 em toda acao daqui); toda contagem le as linhas dos
// avisos citados por regras "o que fez com a notificacao X"; o teste fica pelo menos 1 hora no sino.
//
// v3a (docs/24 §2 e §4.7–§4.10): a notificacao enviada muda o conteudo (messaging.publish; acima de 500
// alunos, messaging.publish_large), num caminho proprio que nunca volta a rascunho nem mexe nas seguintes;
// Excluir vale em toda situacao menos "Enviando" (agendado, enviado e pop-up no ar ou pausado pedem
// messaging.publish); "Mostrar de novo para quem já viu" no pop-up (menu e editor) e "Encerrar enquete". As
// regras que citam a notificacao so avisam (contagem na auditoria), nunca impedem.
//
// v3b-1 (docs/25 §2 e §5.4): o pop-up grava onde, quando e quantas vezes aparece, o "Lembrar depois" e como
// fecha (withPopupSettings completa o rascunho da v1/v3a a partir da linha gravada); "Mostrar de novo" vale
// em qualquer "Quantas vezes"; no maximo 50 pop-ups publicados ao mesmo tempo (publicar, aprovar e retomar
// recusam o 51o, 422); a auditoria do pop-up salvo ou publicado leva o momento, quantas paginas e o modo.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  followUpNumbers,
  followUpPaths,
  followUpsOfDrafts,
  foreignNodeRefs,
  remapEntryRefs,
  remapNodeRefs,
  stopGoalDefinition,
  stopLineOfGoal
} from "@/components/admin/v2/communication/follow-ups-view-model";
import type { ActionResult } from "@/lib/action-result";
import { isHttpsOrLoopbackUrl } from "@/lib/loopback-url";
import { runAdminAction } from "@/server/actions/run-action";
import { recordAudit } from "@/server/audit/log";
import { can, type AdminAccess } from "@/server/auth/roles";
import { checkProductImage, decodeWebpDataUrl } from "@/server/catalog/webp";
import { persistImageAsset } from "@/server/db/media-assets";
import { pageKeyOfHref, pageKeyOfTarget } from "@/server/member-area/page-visit-model";
import { previewAudience, resolveAudienceUserIds, type AudienceSamplePerson } from "./audience";
import { accessFactsOf, loadAudienceFacts, messageFactOf, openAccessRows, type AudienceEntitlementRow, type LoadedAudience } from "./audience-facts";
import {
  audienceFactNeeds,
  buildCommentRanks,
  collectMessageCampaignIds,
  describeAudience,
  evaluateAudience,
  isAudienceGroup,
  messageRefKey,
  normalizeAudience,
  type AudienceContext,
  type AudienceDefinition,
  type AudienceNode,
  type AudienceStudentFacts,
  type MessageFact
} from "./audience-model";
import { invalidateLivePopups } from "./cache";
import {
  APPROVAL_THRESHOLD,
  isEditableStatus,
  isSameVersion,
  noticeRecipients,
  publishDecision,
  situationOf,
  type CampaignSituation,
  type CampaignStatus
} from "./campaign-model";
import { assertNoDbError, communicationsDb, CommunicationError, NoticeFieldError, type CommunicationsDb } from "./db";
import { dispatchInboxCampaign, refreshPopupDeliveries } from "./dispatch";
import {
  entryOf,
  followUpsFromTree,
  treeFromFollowUps,
  validateFlowGoal,
  validateFlowTree,
  watchedPageKeysOf,
  type FlowMessageMeta,
  type FlowNode,
  type FlowStatus,
  type FlowTree
} from "./flow-model";
import { isPollClosed, parsePoll } from "./interactions-model";
import {
  previewFollowUpAudienceSchema,
  saveNoticeFollowUpsSchema,
  type FlowNoticeContent,
  type FollowUpDraft,
  type PreviewFollowUpAudienceInput,
  type SaveNoticeFollowUpsInput
} from "./flow-schemas";
import {
  changeFlowState,
  definitionOf,
  fetchFlowBatchFacts,
  FLOW_CHANGED_MESSAGE,
  FLOW_COLUMNS,
  flowContentColumns,
  lastSourceExpiry,
  messageMetaOfRow,
  saveFlowTree,
  type FlowRow,
  type FlowStateChange
} from "./flow-store";
import {
  defaultPopupSettings,
  frequencyOfColumns,
  popupSettingsOfRow,
  POPUP_V3B1_RULES,
  reconcilePopupFrequency,
  repeatOfFrequency,
  type PopupFrequency
} from "./popup-display-model";
import { followUpContentOf, loadAudienceNames, loadNoticeFlow, loadNoticeSenders, noticeDraftOfRow, type NoticeSenderOption } from "./queries";
import { notifySendersOnBehalf } from "./sender-notices";
import {
  deleteNoticeSchema,
  noticeDraftSchema,
  noticeIdSchema,
  previewAudienceSchema,
  publishProblems,
  saveNoticeSchema,
  sentNoticeLockedProblems,
  uploadNoticeImageSchema,
  withdrawNoticeSchema,
  type DeleteNoticeInput,
  type NoticeDraft,
  type NoticeIdInput,
  type SaveNoticeInput,
  type WithdrawNoticeInput
} from "./schemas";
import {
  audienceOfRow,
  countPublishedPopups,
  deleteCampaignNotifications,
  draftToColumns,
  fetchCampaign,
  fetchCampaignRecipientIds,
  fetchCampaignsByIds,
  fetchNoticeCitations,
  insertCampaign,
  NOTICE_CHANGED_MESSAGE,
  NOTICE_MISSING_MESSAGE,
  reshowPopupDeliveries,
  rowToDraft,
  SENT_EDITABLE_COLUMNS,
  softDeleteCampaign,
  updateCampaign,
  upsertTestNotification,
  type CampaignContentColumns,
  type CampaignPatch,
  type CampaignRow
} from "./store";

const LIST_PATH = "/admin/comunicacao/avisos";
const NOT_EDITABLE = "Este aviso não pode mais ser editado. Duplique para criar outro.";
const EMPTY_AUDIENCE = "Nenhum aluno está neste segmento agora.";
const LIVE_EDIT_NEEDS_PUBLISH = "Só quem pode publicar muda um pop-up no ar. Duplique para criar outro.";
const LIVE_EDIT_NEEDS_APPROVAL = "Para mudar um pop-up no ar para este segmento, peça a um dono ou administrador.";
const RESUME_NEEDS_APPROVAL = "Este pop-up passou de 500 alunos. Para retomar, peça a um dono ou administrador.";
const FLOW_MESSAGE = "Esta notificação faz parte de um fluxo. Abra o fluxo para mudar.";
const SENDER_NOT_ON_TEAM = "Escolha alguém da equipe.";
const HOUR_MS = 3_600_000;
// v3a (docs/24 §2.2–§2.4 e §4.7–§4.10)
const SENT_EDIT_NEEDS_PUBLISH = "Só quem pode publicar muda uma notificação enviada. Duplique para criar outra.";
const SENT_EDIT_NEEDS_APPROVAL = "Para mudar uma notificação que já chegou a mais de 500 alunos, peça a um dono ou administrador.";
const SENT_EDIT_FOLLOW_UP_HINT = "Mude a notificação seguinte no relatório antes de salvar.";
const DELETE_NEEDS_PUBLISH = "Só quem pode publicar exclui um aviso que os alunos veem ou que está agendado.";
const DELETE_WHILE_SENDING = "A notificação ainda está sendo enviada. Espere terminar para excluir.";
const POPUP_NOT_LIVE = "Este pop-up não está no ar.";
const RESHOW_NEEDS_APPROVAL = "Para mostrar de novo a mais de 500 alunos, peça a um dono ou administrador.";
const POLL_MISSING = "Esta notificação não tem enquete.";
const POLL_ALREADY_CLOSED = "A enquete já está encerrada.";
// v3b-1 (docs/25 §2.5 e D13)
const POPUPS_FULL_TO_PUBLISH = "Já há 50 pop-ups no ar ou agendados. Encerre um antes de publicar outro.";
const POPUPS_FULL_TO_RESUME = "Já há 50 pop-ups no ar ou agendados. Encerre um antes de retomar este.";

export type SavedNotice = {
  /**
   * A versao nova do fluxo das seguintes quando salvar o aviso tambem mudou o fluxo (agendado ou aguardando
   * aprovacao volta a rascunho junto); null = nao mudou. O editor manda esta para saveNoticeFollowUps.
   */
  flowUpdatedAt?: string | null;
  id: string;
  /** v3a: pop-up no ar salvo com "Mostrar de novo para quem já viu": quantos voltam a ver (o toast conta). */
  reshown?: number;
  status: CampaignStatus;
  updatedAt: string;
};
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

/** O aviso da tela; o conteudo de um passo de fluxo so muda pelo fluxo (409). */
async function requireCampaign(db: CommunicationsDb, id: string) {
  const row = await fetchCampaign(db, id);

  if (!row) {
    throw new CommunicationError(NOTICE_MISSING_MESSAGE, 404);
  }

  if (row.flow_id) {
    throw new CommunicationError(FLOW_MESSAGE, 409);
  }

  return row;
}

/**
 * Fatos dos alunos para contar este segmento, com as linhas dos avisos citados por regras "o que fez
 * com a notificacao X" (docs/23 §7): a previa, a publicacao e o envio contam igual.
 */
function loadFactsFor(db: CommunicationsDb, now: Date, definition: AudienceDefinition) {
  return loadAudienceFacts(db, now, { messageCampaignIds: collectMessageCampaignIds(definition) });
}

/** A pessoa escolhida em "Quem envia" esta na equipe agora (admin_roles)? E o nome dela, para a mensagem. */
async function senderState(db: CommunicationsDb, userId: string) {
  const [role, profile] = await Promise.all([
    db.from("admin_roles").select("user_id").eq("user_id", userId).maybeSingle(),
    db.from("profiles").select("full_name").eq("id", userId).maybeSingle()
  ]);

  if (role.error || profile.error) {
    throw new Error(`Comunicacao: quem envia: ${(role.error ?? profile.error)?.message}`);
  }

  return { name: (profile.data as { full_name: string | null } | null)?.full_name?.trim() || null, onTeam: Boolean(role.data) };
}

/** Salvar: so pessoas da equipe enviam em nome da escola (400 no campo "Quem envia"). */
async function assertSenderForSave(db: CommunicationsDb, draft: NoticeDraft) {
  if (draft.kind === "inbox" && draft.sender && !(await senderState(db, draft.sender.userId)).onTeam) {
    throw new NoticeFieldError("sender", SENDER_NOT_ON_TEAM);
  }
}

/** Publicar e aprovar (o aviso ainda nao saiu): quem saiu da equipe depois de salvo nao envia (422). */
async function assertSenderForPublish(db: CommunicationsDb, row: CampaignRow) {
  if (row.kind !== "inbox" || !row.sender_user_id) {
    return;
  }

  const state = await senderState(db, row.sender_user_id);

  if (!state.onTeam) {
    throw new CommunicationError(`${state.name ?? "A pessoa escolhida"} não está mais na equipe. Escolha quem envia.`, 422);
  }
}

/**
 * Notificacao que saiu ou vai sair (enviada, enviando ou agendada): avisa quem envia por e-mail (chave do
 * aviso). v2: quem envia alguma notificacao seguinte recebe o e-mail do fluxo (docs/23 §1.6: chave
 * sent-as:flow:<fluxo>:<pessoa>, com o nome do fluxo), nunca o do aviso, que diria que a pessoa mandou a
 * notificacao principal para todos com a foto dela. Quem envia as duas recebe so o do aviso.
 */
async function notifyNoticeSenders(
  db: CommunicationsDb,
  row: CampaignRow,
  published: PublishedNotice,
  actorId: string,
  followUps: { flow: FlowRow; senders: readonly string[] } | null = null
) {
  if (row.kind !== "inbox" || !["scheduled", "sending", "sent"].includes(published.situation)) {
    return;
  }

  const count = published.recipients ?? published.audienceCount;
  const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

  // Melhor esforco: o aviso ja saiu; uma falha aqui so vai para o log.
  await notifySendersOnBehalf(db, { actorId, campaignId: row.id, count, senders: [row.sender_user_id], title: row.title }).catch((error: unknown) =>
    console.error(`[comunicacao] "enviada em seu nome" de ${row.id} nao agendado: ${describe(error)}`)
  );

  const followUpSenders = (followUps?.senders ?? []).filter((id) => id !== row.sender_user_id);

  if (followUps && followUpSenders.length > 0) {
    await notifySendersOnBehalf(db, { actorId, count, flowId: followUps.flow.id, senders: followUpSenders, title: followUps.flow.name }).catch((error: unknown) =>
      console.error(`[comunicacao] "enviada em seu nome" do fluxo ${followUps.flow.id} nao agendado: ${describe(error)}`)
    );
  }
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

/**
 * Encerrar o pop-up (e excluir o que esta no ar): o fim da janela vira agora, sem ultrapassar o inicio de
 * uma janela que ainda nem comecou e sem mexer num fim que ja passou.
 */
function endingPatch(row: CampaignRow, now: Date): CampaignPatch {
  const endsAt = row.ends_at ? Date.parse(row.ends_at) : null;
  const startsAt = row.starts_at ? Date.parse(row.starts_at) : null;

  return (endsAt === null || endsAt > now.getTime()) && (startsAt === null || startsAt < now.getTime()) ? { ends_at: now.toISOString() } : {};
}

/** Quantos avisos e fluxos citam a notificacao nas regras (so a auditoria; nunca impede nada). */
async function citationsOf(db: CommunicationsDb, row: CampaignRow) {
  if (row.kind !== "inbox") {
    return { flows: 0, notices: 0 };
  }

  return (await fetchNoticeCitations(db, [row.id])).get(row.id) ?? { flows: 0, notices: 0 };
}

/**
 * "Mostrar de novo para quem já viu" (docs/24 §4.9; v3b-1, docs/25 §4.7: em qualquer "Quantas vezes"), antes de
 * gravar: quantos voltam a contar como novo (ainda no segmento, viram mais vezes do que adiaram, sem "Não
 * mostrar de novo" e sem clique, menos no pop-up que so para quando termina). Conta pela regra gravada: quando
 * o mesmo salvar muda o que faz parar, o toast usa a contagem aplicada depois. Acima de 500 sem
 * messaging.publish_large, 403; pop-up fora do ar, 409.
 */
async function countPopupReshow(db: CommunicationsDb, access: AdminAccess, campaignId: string, now: Date) {
  const counted = await reshowPopupDeliveries(db, { apply: false, campaignId, max: null, now });

  if (!counted) {
    throw new CommunicationError(POPUP_NOT_LIVE, 409);
  }

  if (counted.count > APPROVAL_THRESHOLD && !can(access, "messaging.publish_large")) {
    throw new CommunicationError(RESHOW_NEEDS_APPROVAL, 403);
  }

  return counted.count;
}

/**
 * Aplica o "mostrar de novo" (RPC communication_reshow_popup, com o teto de 500 de quem nao tem
 * messaging.publish_large). null = o pop-up saiu do ar (nem no ar nem pausado) entre a leitura e a gravacao
 * (409); refused = passou de 500 no meio (403). Devolve quantos voltam a contar como novo.
 */
async function applyPopupReshow(db: CommunicationsDb, access: AdminAccess, campaignId: string, now: Date) {
  const applied = await reshowPopupDeliveries(db, {
    apply: true,
    campaignId,
    max: can(access, "messaging.publish_large") ? null : APPROVAL_THRESHOLD,
    now
  });

  if (!applied) {
    throw new CommunicationError(POPUP_NOT_LIVE, 409);
  }

  if (applied.refused) {
    throw new CommunicationError(RESHOW_NEEDS_APPROVAL, 403);
  }

  return applied.reshown;
}

/**
 * v3b-1 (docs/25 §5.4): o rascunho que vai ser gravado, com a configuracao do pop-up completa. `popup` manda
 * quando vem; sem ele (rascunho da v1/v3a), a da linha gravada (ou o padrao). "Quantas vezes" fica coerente
 * com `repeat` (reconcilePopupFrequency: quem mudou so o `repeat` da v1 grava a regra da v1 dele). A regra da
 * v1 vinda so do `repeat` num pop-up sem botao ("Até o aluno clicar", que nunca parou por clique porque
 * ninguem clica) vira "Só quando o pop-up terminar", o mesmo para o aluno; escolher "Quando o aluno clica no
 * botão" sem botao continua recusado pelo zod (400 em popup.frequency.stopOn).
 */
function withPopupSettings(draft: NoticeDraft, stored: CampaignRow | null): NoticeDraft {
  if (draft.kind !== "popup") {
    return draft;
  }

  const row = stored?.kind === "popup" ? stored : null;
  const base = draft.popup ?? (row ? popupSettingsOfRow(row) : defaultPopupSettings());
  const reconciled = reconcilePopupFrequency({ frequency: draft.popup?.frequency, repeat: draft.repeat, stored: row ? frequencyOfColumns(row) : null });
  const fromRepeat = reconciled !== draft.popup?.frequency;
  const frequency: PopupFrequency =
    fromRepeat && !draft.cta && reconciled.mode === "repeat" && reconciled.stopOn === "click" ? { ...reconciled, stopOn: "never" } : reconciled;

  return { ...draft, popup: { ...base, frequency }, repeat: repeatOfFrequency(frequency) };
}

/** v3b-1: a auditoria do pop-up salvo ou publicado leva o momento, quantas paginas e o modo (so codigos e contagens). */
function popupAuditOf(row: CampaignRow) {
  if (row.kind !== "popup") {
    return {};
  }

  const settings = popupSettingsOfRow(row);

  return { popup_frequency: settings.frequency.mode, popup_pages: settings.pages.length, popup_trigger: settings.trigger };
}

/**
 * v3b-1 (docs/25 D13): no maximo 50 pop-ups publicados ao mesmo tempo (no ar ou agendados, nao excluidos e sem
 * fim no passado), este fora da conta: o 51o e recusado (422) ao publicar, aprovar e retomar. Nunca limita o
 * que o aluno ve.
 */
async function assertPopupRoom(db: CommunicationsDb, row: CampaignRow, now: Date, message: string) {
  if (row.kind !== "popup") {
    return;
  }

  if ((await countPublishedPopups(db, { excludeId: row.id, nowIso: now.toISOString() })) >= POPUP_V3B1_RULES.publishedMax) {
    throw new CommunicationError(message, 422);
  }
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

/**
 * Regras do rascunho e as que so valem ao publicar (data no futuro); erro vira 400 com o campo. v3b-1: o
 * rascunho da linha como o editor abre (noticeDraftOfRow: o "Até o aluno clicar" antigo sem botao nao e recusado).
 */
function assertPublishable(row: CampaignRow, now: number) {
  const parsed = noticeDraftSchema.safeParse(noticeDraftOfRow(row));

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
 * Notificacoes seguintes (v2, docs/23 §2.2 e §6.2): o fluxo do aviso (origin "notice") segue o aviso.
 * Publicar ou aprovar ativa o fluxo (ou o poe em aprovacao junto), cancelar o agendamento, devolver o
 * pedido ou salvar de novo o volta para rascunho, retirar do sino o encerra (source_withdrawn), excluir o
 * tira (source_deleted) e duplicar o copia. Toda mudanca de situacao passa pelo RPC 7.13; os passos so
 * mudam por saveFlowTree (RPC 7.5), nunca pelas acoes da v1 (requireCampaign recusa passo de fluxo).
 * ---------------------------------------------------------------------------------------------- */

const FOLLOW_UPS_INBOX_ONLY = "As notificações seguintes valem só para notificações no sino.";
const FOLLOW_UPS_WITHDRAWN = "Esta notificação foi retirada do sino.";
const FOLLOW_UPS_GONE = "Esta notificação já saiu do sino de todos.";
const FOLLOW_UPS_SAVE_NOTICE_FIRST = "Salve a notificação antes de mudar as notificações seguintes.";
const FOLLOW_UPS_BUILDER_ONLY = "Esta notificação tem passos que só aparecem no fluxo. Use Editar no fluxo.";
const FOLLOW_UPS_NEED_PUBLISH = "Só quem pode publicar muda as notificações seguintes depois do envio.";
const LIVE_FLOW_NEEDS_APPROVAL = "Para mudar um fluxo ativo para este segmento, peça a um dono ou administrador.";
const FOLLOW_UP_MISSING = "Esta notificação seguinte não existe mais. Recarregue a página.";
const FLOW_NAME_MAX = 80;

/** "Seguintes de “Oferta especial!”" (so a equipe ve; ate 80 caracteres). */
function noticeFlowName(title: string) {
  const clean = title.trim() || "Sem título";
  const name = `Seguintes de “${clean}”`;

  return name.length <= FLOW_NAME_MAX ? name : `Seguintes de “${clean.slice(0, FLOW_NAME_MAX - 16).trimEnd()}…”`;
}

/** O fluxo das seguintes do aviso, so a linha (sem os passos). */
async function noticeFlowRow(db: CommunicationsDb, noticeId: string): Promise<FlowRow | null> {
  const { data, error } = await db
    .from("communication_flows")
    .select(FLOW_COLUMNS)
    .eq("source_campaign_id", noticeId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  assertNoDbError(error, "Comunicacao: fluxo do aviso");

  return ((data ?? []) as FlowRow[])[0] ?? null;
}

/**
 * O fluxo do aviso acompanha a situacao do aviso (7.13 sem versao: quem manda e o aviso). So quando a
 * situacao atual esta em `from`; nada a fazer = devolve o fluxo como esta (ou null sem fluxo). `flow` = a
 * linha ja lida pela acao (null = sem fluxo); ausente, le agora.
 */
async function moveNoticeFlow(
  db: CommunicationsDb,
  noticeId: string,
  input: {
    actorId: string | null;
    entryCount?: number | null;
    flow?: FlowRow | null;
    from: readonly FlowStatus[];
    now: Date;
    reason?: string | null;
    to: FlowStateChange["to"];
  }
): Promise<FlowRow | null> {
  const flow = input.flow === undefined ? await noticeFlowRow(db, noticeId) : input.flow;

  if (!flow || !input.from.includes(flow.status)) {
    return flow;
  }

  return changeFlowState(db, {
    actorId: input.actorId,
    entryCount: input.entryCount ?? null,
    expectedUpdatedAt: null,
    flowId: flow.id,
    now: input.now,
    reason: input.reason ?? null,
    to: input.to
  });
}

/** Fluxo do aviso tirado da lista (exclusao logica); no ar ou pausado, encerrado antes com `reason`. */
async function removeNoticeFlow(db: CommunicationsDb, flow: FlowRow, input: { actorId: string; now: Date; reason: "source_deleted" | "source_withdrawn" | null }) {
  if (input.reason && (flow.status === "active" || flow.status === "paused")) {
    await changeFlowState(db, { actorId: input.actorId, expectedUpdatedAt: null, flowId: flow.id, now: input.now, reason: input.reason, to: "ended" });
  }

  const { error } = await db
    .from("communication_flows")
    .update({ deleted_at: input.now.toISOString(), deleted_by: input.actorId, updated_by: input.actorId })
    .eq("id", flow.id)
    .is("deleted_at", null);
  assertNoDbError(error, "Comunicacao: tirar o fluxo do aviso");
  invalidateLivePopups({ from: "action" });
}

/** Campo do passo (validateFlowTree) -> campo do cartao "Depois desta notificação". */
const FOLLOW_UP_ISSUE_FIELDS: Record<string, string> = { anchorNodeId: "when.anchor", filter: "who", offsetMinutes: "when.minutes" };

function followUpIssuePath(base: string | undefined, field: string | null) {
  if (!base) {
    return field === "goal" ? "goal" : "followUps";
  }

  return field && FOLLOW_UP_ISSUE_FIELDS[field] ? `${base}.${FOLLOW_UP_ISSUE_FIELDS[field]}` : base;
}

/** As seguintes conferidas contra o conteudo do aviso: o fluxo, quem envia e as paginas que ele acompanha. */
type CheckedFollowUps = { flow: FlowRow; senders: string[]; watched: string[] };

/** O fluxo das seguintes do aviso como esta gravado agora, com o conteudo atual de cada passo. */
type NoticeFollowUpState = {
  flow: FlowRow;
  goal: AudienceDefinition | null;
  messageNodes: FlowNode[];
  metas: Record<string, FlowMessageMeta>;
  tree: FlowTree;
  versions: Map<string, CampaignRow>;
};

/**
 * Le o fluxo das seguintes do aviso e a versao atual de cada passo; o meta da notificacao principal vem de
 * `row` (no editar depois do envio, o conteudo novo ainda nao gravado). null = o aviso nao tem seguintes, ou
 * o fluxo ja terminou (nada mais sai).
 */
async function loadNoticeFollowUps(db: CommunicationsDb, row: CampaignRow): Promise<NoticeFollowUpState | null> {
  if (row.kind !== "inbox") {
    return null;
  }

  const loaded = await loadNoticeFlow(db, row.id);
  const messageNodes = loaded?.tree.nodes.filter((node) => node.kind === "message") ?? [];

  if (!loaded || messageNodes.length === 0 || loaded.flow.status === "ended") {
    return null;
  }

  const versions = new Map((await fetchCampaignsByIds(db, messageNodes.map((node) => node.campaignId ?? "").filter(Boolean))).map((version) => [version.id, version]));
  const entry = entryOf(loaded.tree);
  const metas: Record<string, FlowMessageMeta> = entry ? { [entry.id]: messageMetaOfRow(row) } : {};

  for (const node of messageNodes) {
    const version = versions.get(node.campaignId ?? "");

    if (version) {
      metas[node.id] = messageMetaOfRow(version);
    }
  }

  return { flow: loaded.flow, goal: definitionOf(loaded.flow.goal), messageNodes, metas, tree: loaded.tree, versions };
}

/**
 * As seguintes gravadas estao boas para sair com o conteudo `row` do aviso (a arvore e o objetivo contra os
 * metas de agora, 400 "A notificação seguinte 1 tem um problema: ..."), e quem envia cada uma ainda esta na
 * equipe (422). Nao grava nada (v3a: o editar depois do envio confere antes de gravar o conteudo novo).
 * `checkSenders: false` (editar a notificacao enviada) nao confere quem envia as seguintes: corrigir um erro
 * de digitacao no aviso nao depende delas, e o sino ja mostra a escola quando quem envia saiu da equipe; a
 * conferencia fica onde as seguintes sao salvas (assertFollowUpSenders) e ao publicar ou aprovar.
 * null = o aviso nao tem seguintes, ou o fluxo ja terminou (nada mais sai).
 */
async function checkNoticeFollowUps(db: CommunicationsDb, row: CampaignRow, options: { checkSenders?: boolean } = {}): Promise<CheckedFollowUps | null> {
  const state = await loadNoticeFollowUps(db, row);

  if (!state) {
    return null;
  }

  const { flow, goal, messageNodes, metas, tree, versions } = state;
  const [issue] = [...validateFlowTree(tree, metas), ...validateFlowGoal(tree, goal, metas)].filter((item) => item.level !== "warning");

  if (issue) {
    const drawn = followUpsFromTree(tree);
    const numbers = drawn ? followUpNumbers(drawn) : new Map(messageNodes.map((node, index) => [node.id, String(index + 1)]));
    const number = issue.nodeId ? numbers.get(issue.nodeId) : undefined;
    const path = followUpIssuePath(issue.nodeId && drawn ? followUpPaths(drawn).get(issue.nodeId) : undefined, issue.field);

    throw new NoticeFieldError(path, number ? `A notificação seguinte ${number} tem um problema: ${issue.message.replace(/\.$/, "")}.` : issue.message);
  }

  const senders = Array.from(new Set(Array.from(versions.values(), (version) => version.sender_user_id).filter((id): id is string => Boolean(id))));

  if (options.checkSenders !== false) {
    const states = await Promise.all(senders.map((userId) => senderState(db, userId)));
    const gone = states.find((sender) => !sender.onTeam);

    if (gone) {
      throw new CommunicationError(`${gone.name ?? "A pessoa escolhida"} não está mais na equipe. Escolha quem envia.`, 422);
    }
  }

  return { flow, senders, watched: watchedPageKeysOf(tree, goal, metas, row.cta_href) };
}

function sameKeys(left: readonly string[] | null | undefined, right: readonly string[]) {
  return JSON.stringify([...(left ?? [])].sort()) === JSON.stringify([...right].sort());
}

/**
 * Paginas acompanhadas com o destino do aviso de agora: trocar o destino depois de gravar as seguintes (ou
 * seguintes feitas so no construtor) nao re-grava o fluxo, e a visita a pagina nova nunca seria gravada
 * ("não visitou a página do botão" valeria para todos). Devolve o fluxo e se as paginas mudaram.
 * Grava so na versao do fluxo lida (updated_at): uma seguinte salva no meio (communication_save_flow grava
 * outra arvore, talvez com "visitou a página X") nunca e sobrescrita por paginas de uma arvore antiga. Mudou
 * no meio: le a arvore de novo e recalcula uma vez com o conteudo `row` do aviso (o fluxo sumiu ou terminou
 * no meio = nada a gravar).
 */
async function syncNoticeWatchedPages(db: CommunicationsDb, checked: CheckedFollowUps, row: CampaignRow): Promise<{ changed: boolean; flow: FlowRow }> {
  let flow = checked.flow;
  let watched = checked.watched;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (sameKeys(flow.watched_page_keys, watched)) {
      return { changed: false, flow };
    }

    const { data, error } = await db
      .from("communication_flows")
      .update({ watched_page_keys: watched })
      .eq("id", flow.id)
      .eq("updated_at", flow.updated_at)
      .is("deleted_at", null)
      .select(FLOW_COLUMNS);
    assertNoDbError(error, "Comunicacao: paginas acompanhadas das seguintes");

    const [updated] = (data ?? []) as FlowRow[];

    if (updated) {
      return { changed: true, flow: updated };
    }

    if (attempt > 0) {
      break;
    }

    const again = await loadNoticeFollowUps(db, row);

    if (!again) {
      return { changed: false, flow };
    }

    flow = again.flow;
    watched = watchedPageKeysOf(again.tree, again.goal, again.metas, row.cta_href);
  }

  // Mudou duas vezes no meio: o aviso ja foi gravado; quem salvou por ultimo gravou as paginas da arvore dele.
  console.error(`[comunicacao] paginas acompanhadas do fluxo ${flow.id} nao gravadas: o fluxo mudou duas vezes no meio`);

  return { changed: false, flow };
}

/**
 * Publicar ou aprovar: as seguintes conferidas (checkNoticeFollowUps) e as paginas acompanhadas em dia.
 * Devolve o fluxo e quem envia; null = o aviso nao tem seguintes.
 */
async function followUpsForPublish(db: CommunicationsDb, row: CampaignRow): Promise<{ flow: FlowRow; senders: string[] } | null> {
  const checked = await checkNoticeFollowUps(db, row);

  if (!checked) {
    return null;
  }

  const { flow } = await syncNoticeWatchedPages(db, checked, row);

  return { flow, senders: checked.senders };
}

/**
 * Publicar direto: o fluxo do aviso vai para o ar antes do envio (o conteudo vira "sent" pelo 7.13), entao
 * nenhum aviso sai sem as seguintes. O motor so faz entrar depois que o aviso esta "sent" (7.3). Se o envio
 * falhar, o fluxo volta para rascunho.
 */
async function goLiveWithFollowUps(
  input: Parameters<typeof goLive>[0] & { followUps: { flow: FlowRow; senders: string[] } | null; reason: "approved" | null }
): Promise<PublishedNotice> {
  const { db, now } = input;
  const flow = input.followUps?.flow ?? null;
  const activate = flow !== null && (flow.status === "draft" || flow.status === "pending_approval");

  if (activate) {
    await changeFlowState(db, { actorId: input.actorId, entryCount: input.count, expectedUpdatedAt: null, flowId: flow.id, now, reason: input.reason, to: "active" });
  }

  try {
    return await goLive(input);
  } catch (error) {
    if (activate) {
      await changeFlowState(db, { actorId: input.actorId, expectedUpdatedAt: null, flowId: flow.id, now, to: "draft" }).catch((revertError: unknown) =>
        console.error(`[comunicacao] fluxo do aviso ${input.row.id} nao voltou a rascunho: ${revertError instanceof Error ? revertError.message : String(revertError)}`)
      );
    }

    throw error;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Rascunho, previa e publicacao
 * ---------------------------------------------------------------------------------------------- */

/**
 * v3a (docs/24 §4.7): a notificacao enviada muda so o conteudo que o aluno le (titulo, texto, imagem, icone,
 * quem envia, destino e como chega la, textos da resposta e reacoes), para todos na hora e sem avisar de
 * novo: a linha do sino aponta para o aviso. Caminho proprio, nunca o do pop-up no ar: publishProblems
 * recusaria todo envio que ja passou; nada volta a rascunho, o fluxo das seguintes nao se mexe e a lista de
 * quem recebeu nao e recalculada. Vale como publicar: sem messaging.publish, ou acima de 500 alunos sem
 * messaging.publish_large, 403 (nunca pedido de aprovacao).
 */
async function saveSentNotice(input: {
  access: AdminAccess;
  columns: CampaignContentColumns;
  current: CampaignRow;
  data: SaveNoticeInput;
  db: CommunicationsDb;
  userId: string;
}): Promise<SavedNotice> {
  const { access, columns, current, data, db, userId } = input;

  // A versao primeiro: o editor aberto antes de "Encerrar enquete" (ou de outra edicao) recebe o 409, nao o
  // 400 de uma enquete que ele nem mexeu.
  assertSameVersion(current, data.expectedUpdatedAt);

  if (columns.kind !== current.kind) {
    throw new NoticeFieldError("kind", "O tipo não muda depois de publicado.");
  }

  // Segmento, envio, tempo no sino, audio, ligar ou desligar a resposta e a enquete nao mudam (400 no campo).
  const [locked] = sentNoticeLockedProblems(rowToDraft(current), data.draft);

  if (locked) {
    throw new NoticeFieldError(locked.path, locked.message);
  }

  if (!can(access, "messaging.publish")) {
    throw new CommunicationError(SENT_EDIT_NEEDS_PUBLISH, 403);
  }

  const recipients = noticeRecipients(current);

  if (recipients > APPROVAL_THRESHOLD && !can(access, "messaging.publish_large")) {
    throw new CommunicationError(SENT_EDIT_NEEDS_APPROVAL, 403);
  }

  const content = Object.fromEntries(SENT_EDITABLE_COLUMNS.map((column) => [column, columns[column]])) as Pick<CampaignContentColumns, (typeof SENT_EDITABLE_COLUMNS)[number]>;
  const fields = SENT_EDITABLE_COLUMNS.filter((column) => (content[column] ?? null) !== (current[column] ?? null));
  let checked: CheckedFollowUps | null;

  // As seguintes ainda valem com o conteudo novo (ex.: "foi para o destino" sem destino): 422, mudar antes no
  // relatorio. Nada e gravado aqui. Quem envia as seguintes nao trava o aviso (ajustes da v3a): quem saiu da
  // equipe aparece como a escola no sino, e a conferencia fica onde as seguintes sao salvas.
  try {
    checked = await checkNoticeFollowUps(db, { ...current, ...content }, { checkSenders: false });
  } catch (error) {
    if (error instanceof NoticeFieldError) {
      throw new CommunicationError(`${error.message} ${SENT_EDIT_FOLLOW_UP_HINT}`, 422);
    }

    throw error;
  }

  const now = new Date();
  const saved = await updateCampaign(
    db,
    current.id,
    { ...content, edited_at: now.toISOString(), edited_by: userId, updated_by: userId },
    { expectedStatuses: ["sent"], expectedUpdatedAt: current.updated_at }
  );

  // Destino novo: as seguintes que olham "a página para onde a notificação leva" passam a olhar a nova (o
  // cache das visitas de pagina divide a tag com o dos pop-ups no ar). A versao nova do fluxo volta para o
  // editor (salvar as seguintes logo depois nao leva 409).
  const synced = checked ? await syncNoticeWatchedPages(db, checked, saved) : null;

  if (synced?.changed) {
    invalidateLivePopups({ from: "action" });
  }

  // Quem passou a enviar recebe o "enviada em seu nome" (a chave do aviso faz ser uma vez por pessoa).
  if (saved.sender_user_id && saved.sender_user_id !== current.sender_user_id) {
    await notifySendersOnBehalf(db, { actorId: userId, campaignId: saved.id, count: recipients, senders: [saved.sender_user_id], title: saved.title }).catch((error: unknown) =>
      console.error(`[comunicacao] "enviada em seu nome" de ${saved.id} nao agendado: ${error instanceof Error ? error.message : String(error)}`)
    );
  }

  await recordAudit(db, {
    action: "communication.edited_after_send",
    actorId: userId,
    count: recipients,
    entityId: saved.id,
    entityType: "campaign",
    metadata: { fields, kind: "inbox", recipients }
  });
  revalidateNotices(saved.id);

  return { flowUpdatedAt: synced?.changed ? synced.flow.updated_at : null, id: saved.id, status: "sent", updatedAt: saved.updated_at };
}

/**
 * [messaging.write] Cria ou atualiza o aviso. Agendado ou aguardando aprovacao volta a rascunho;
 * pop-up no ar ou pausado continua como esta (e recalcula quem ve se o segmento mudou). Mudar o pop-up
 * no ar vale como publicar: precisa de messaging.publish e, acima de 500 alunos (o segmento novo, ou a
 * contagem gravada quando o segmento nao mudou), de messaging.publish_large; senao, 403.
 * v3a: notificacao enviada muda so o conteudo (saveSentNotice); o pop-up no ar ou pausado pode salvar com
 * `reshow` ("Mostrar de novo para quem já viu", v3b-1 em qualquer "Quantas vezes": contado e conferido antes
 * de gravar, aplicado depois, com a regra nova ja gravada).
 * v3b-1: o pop-up grava a configuracao completa (withPopupSettings: o rascunho sem `popup` usa a da linha).
 */
export async function saveNoticeDraft(input: SaveNoticeInput): Promise<ActionResult<SavedNotice>> {
  return runAdminAction("messaging.write", saveNoticeSchema, input, async ({ access, input: data, user }) => {
    const db = communicationsDb();

    await assertSenderForSave(db, data.draft);

    if (!data.id) {
      const created = await insertCampaign(db, { ...draftToColumns(withPopupSettings(data.draft, null)), created_by: user.id, status: "draft", updated_by: user.id });

      await recordAudit(db, {
        action: "communication.saved",
        actorId: user.id,
        entityId: created.id,
        entityType: "campaign",
        metadata: { created: true, kind: created.kind, sender_user_id: created.sender_user_id, ...popupAuditOf(created) }
      });
      revalidateNotices();

      return { id: created.id, status: created.status, updatedAt: created.updated_at };
    }

    const current = await requireCampaign(db, data.id);
    const draft = withPopupSettings(data.draft, current);
    const columns = draftToColumns(draft);

    if (current.kind === "inbox" && current.status === "sent") {
      return saveSentNotice({ access, columns, current, data, db, userId: user.id });
    }

    if (!isEditableStatus(current.kind, current.status)) {
      throw new CommunicationError(NOT_EDITABLE, 409);
    }

    const live = current.kind === "popup" && (current.status === "active" || current.status === "paused");
    // "Mostrar de novo" so vale no pop-up no ar ou pausado; em outra situacao, o pedido e ignorado.
    const reshow = live && data.reshow === true;
    const audienceChanged = stableJson(normalizeAudience(audienceOfRow(current))) !== stableJson(columns.audience);
    const now = new Date();
    let loaded: LoadedAudience | undefined;

    if (live) {
      if (columns.kind !== current.kind) {
        throw new NoticeFieldError("kind", "O tipo não muda depois de publicado.");
      }

      const [problem] = publishProblems(draft, now.getTime());

      if (problem) {
        throw new NoticeFieldError(problem.path, problem.message);
      }

      // Mudar onde, quando, quantas vezes, o "Volta em" ou como fecha tambem e mudar o que os alunos veem.
      if (!can(access, "messaging.publish")) {
        throw new CommunicationError(LIVE_EDIT_NEEDS_PUBLISH, 403);
      }

      if (audienceChanged) {
        loaded = await loadFactsFor(db, now, columns.audience);
      }

      const count = loaded ? resolveAudienceUserIds(columns.audience, loaded).length : (current.audience_count ?? 0);

      if (!canPublishTo(access, count)) {
        throw new CommunicationError(LIVE_EDIT_NEEDS_APPROVAL, 403);
      }

      // Antes de gravar: acima de 500 sem messaging.publish_large, nada muda (403).
      if (reshow) {
        await countPopupReshow(db, access, current.id, now);
      }
    }

    const patch: CampaignPatch = {
      ...columns,
      updated_by: user.id,
      // v3a: a ultima edicao do pop-up no ar ou pausado aparece no relatorio ("Editado").
      ...(live ? { edited_at: now.toISOString(), edited_by: user.id } : { requested_at: null, requested_by: null, status: "draft" as const })
    };
    let saved = await updateCampaign(db, current.id, patch, { expectedStatuses: [current.status], expectedUpdatedAt: data.expectedUpdatedAt });
    let reshown: number | undefined;

    if (live) {
      if (audienceChanged) {
        await refreshPopupDeliveries({ campaign: saved, db, loaded, now });
        saved = (await fetchCampaign(db, saved.id)) ?? saved;
      }

      invalidateLivePopups({ from: "action" });

      // Depois de gravar ("Quantas vezes" ja gravado: no pop-up que so para quando termina, quem clicou conta)
      // e de recalcular quem ve: so quem ainda esta no segmento.
      if (reshow) {
        reshown = await applyPopupReshow(db, access, saved.id, now);
        await recordAudit(db, {
          action: "communication.popup_reshown",
          actorId: user.id,
          count: reshown,
          entityId: saved.id,
          entityType: "campaign",
          metadata: { count: reshown, via: "editor" }
        });
      }
    }

    // v2: agendado ou aguardando aprovacao voltou a rascunho; o fluxo das seguintes volta junto (nada saiu).
    // A versao nova do fluxo volta para o editor gravar as seguintes logo em seguida sem 409.
    let flowUpdatedAt: string | null = null;

    if (!live && current.status !== "draft") {
      const moved = await moveNoticeFlow(db, current.id, { actorId: user.id, from: ["active", "pending_approval"], now, to: "draft" });
      flowUpdatedAt = moved?.updated_at ?? null;
    }

    await recordAudit(db, {
      action: "communication.saved",
      actorId: user.id,
      entityId: saved.id,
      entityType: "campaign",
      metadata: {
        audience_changed: audienceChanged,
        from_status: current.status,
        kind: saved.kind,
        sender_user_id: saved.sender_user_id,
        to_status: saved.status,
        ...popupAuditOf(saved)
      }
    });
    revalidateNotices(saved.id);

    return { flowUpdatedAt, id: saved.id, ...(reshown === undefined ? {} : { reshown }), status: saved.status, updatedAt: saved.updated_at };
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
    const [loaded, names] = await Promise.all([loadFactsFor(db, new Date(), definition), loadAudienceNames(db, [definition])]);
    const preview = previewAudience(definition, loaded);

    return {
      count: preview.count,
      description: describeAudience(definition, names),
      sample: can(access, "students.read_basic") ? preview.sample : []
    };
  });
}

/**
 * [messaging.write] A equipe de "Quem envia" de novo (nome e foto): o editor rele quando a janela volta
 * ao foco depois de "Colocar a minha foto em Perfil", para a foto nova aparecer sem recarregar.
 */
export async function listNoticeSenders(): Promise<ActionResult<NoticeSenderOption[]>> {
  return runAdminAction("messaging.write", z.undefined().or(z.object({})), undefined, async ({ user }) => loadNoticeSenders(communicationsDb(), user.id));
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
    await assertSenderForPublish(db, row);
    // v3b-1: tambem antes do pedido de aprovacao (um pedido que nao caberia no ar nao fica esperando).
    await assertPopupRoom(db, row, now, POPUPS_FULL_TO_PUBLISH);
    const followUps = await followUpsForPublish(db, row);

    const loaded = await loadFactsFor(db, now, audienceOfRow(row));
    const count = countAudience(row, loaded);

    if (!canPublishTo(access, count)) {
      const nowIso = now.toISOString();
      const pending = await updateCampaign(
        db,
        row.id,
        { audience_count: count, audience_counted_at: nowIso, requested_at: nowIso, requested_by: user.id, status: "pending_approval", updated_by: user.id },
        { expectedStatuses: ["draft"], expectedUpdatedAt: row.updated_at }
      );

      // A aprovacao do aviso cobre as seguintes: o fluxo espera a aprovacao junto.
      if (followUps) {
        await moveNoticeFlow(db, row.id, { actorId: user.id, entryCount: count, from: ["draft"], now, to: "pending_approval" });
      }

      await recordAudit(db, {
        action: "communication.approval_requested",
        actorId: user.id,
        count,
        entityId: row.id,
        entityType: "campaign",
        metadata: { kind: row.kind, sender_user_id: row.sender_user_id, ...popupAuditOf(row) }
      });
      revalidateNotices(row.id);

      return { audienceCount: count, id: row.id, recipients: null, situation: "pending_approval", updatedAt: pending.updated_at };
    }

    const published = await goLiveWithFollowUps({
      actorId: user.id,
      approved: can(access, "messaging.publish_large"),
      count,
      db,
      expectedStatuses: ["draft"],
      followUps,
      loaded,
      now,
      reason: null,
      row
    });

    await recordAudit(db, {
      action: "communication.published",
      actorId: user.id,
      count,
      entityId: row.id,
      entityType: "campaign",
      metadata: {
        follow_ups_flow_id: followUps?.flow.id ?? null,
        kind: row.kind,
        recipients: published.recipients,
        sender_user_id: row.sender_user_id,
        situation: published.situation,
        ...popupAuditOf(row)
      }
    });
    await notifyNoticeSenders(db, row, published, user.id, followUps);
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
    await assertSenderForPublish(db, row);
    await assertPopupRoom(db, row, now, POPUPS_FULL_TO_PUBLISH);
    const followUps = await followUpsForPublish(db, row);

    const loaded = await loadFactsFor(db, now, audienceOfRow(row));
    const count = countAudience(row, loaded);
    // A aprovacao do aviso cobre as seguintes (docs/23 §2.9): o fluxo vai para o ar como aprovado.
    const published = await goLiveWithFollowUps({
      actorId: user.id,
      approved: true,
      count,
      db,
      expectedStatuses: ["pending_approval"],
      followUps,
      loaded,
      now,
      reason: "approved",
      row
    });

    await recordAudit(db, {
      action: "communication.approved",
      actorId: user.id,
      count,
      entityId: row.id,
      entityType: "campaign",
      metadata: {
        follow_ups_flow_id: followUps?.flow.id ?? null,
        kind: row.kind,
        recipients: published.recipients,
        requested_by: row.requested_by,
        sender_user_id: row.sender_user_id,
        situation: published.situation,
        ...popupAuditOf(row)
      }
    });
    await notifyNoticeSenders(db, row, published, user.id, followUps);
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

    // As seguintes voltam a rascunho junto (nada saiu).
    await moveNoticeFlow(db, row.id, { actorId: user.id, from: ["pending_approval", "active"], now: new Date(), to: "draft" });

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

    // O fluxo das seguintes esperava o envio (ninguem entrou): volta a rascunho junto.
    await moveNoticeFlow(db, row.id, { actorId: user.id, from: ["active", "pending_approval"], now: new Date(), to: "draft" });

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
    // v3b-1: o pausado nao conta entre os 50 publicados; retomar o 51o e recusado (422).
    await assertPopupRoom(db, row, now, POPUPS_FULL_TO_RESUME);
    loaded = await loadFactsFor(db, now, audienceOfRow(row));

    if (!canPublishTo(input.access, resolveAudienceUserIds(audienceOfRow(row), loaded).length)) {
      throw new CommunicationError(RESUME_NEEDS_APPROVAL, 403);
    }
  }

  // Encerrar: fim da janela = agora (sem ultrapassar o inicio de uma janela que ainda nem comecou).
  const patch: CampaignPatch = { status: input.to, updated_by: input.actorId, ...(input.to === "ended" ? endingPatch(row, now) : {}) };
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

/** Retirar as seguintes que ja sairam: os passos ficam cancelados e as linhas dos alunos saem do sino (o teste fica). */
async function withdrawFollowUpRows(db: CommunicationsDb, flowId: string, actorId: string): Promise<number> {
  const [canceled, deleted] = await Promise.all([
    db.from("campaigns").update({ status: "canceled", updated_by: actorId }).eq("flow_id", flowId).in("status", ["draft", "sent"]),
    db.from("notifications").delete({ count: "exact" }).eq("flow_id", flowId).eq("is_test", false)
  ]);
  assertNoDbError(canceled.error, "Comunicacao: retirar as seguintes");
  assertNoDbError(deleted.error, "Comunicacao: tirar as seguintes do sino");

  return deleted.count ?? 0;
}

/**
 * Tira a notificacao enviada do sino (Retirar do sino e Excluir, docs/24 §4.8): primeiro a situacao
 * ("canceled", na versao lida; o sino ja esconde aviso que nao esta enviado), depois as seguintes param antes
 * de qualquer linha sair (o fluxo do aviso termina com `flowReason`: pendentes e reservadas canceladas, 7.13)
 * e, com `alsoFollowUps`, as que ja sairam somem do sino; por fim as linhas dos alunos (o teste fica).
 * Ajustes da v3a (Excluir demorava): as leituras (o fluxo do aviso e as regras que citam a notificacao, para
 * a auditoria) vao junto com a primeira gravacao, e o que nao depende um do outro vai junto (Promise.all).
 */
async function withdrawSentNotice(
  db: CommunicationsDb,
  row: CampaignRow,
  input: { actorId: string; alsoFollowUps: boolean; expectedUpdatedAt?: string | null; flowReason: "source_deleted" | "source_withdrawn"; now: Date }
): Promise<{ citations: { flows: number; notices: number }; flow: FlowRow | null; followUpsRemoved: number; removed: number; updated: CampaignRow }> {
  const [updated, current, citations] = await Promise.all([
    updateCampaign(db, row.id, { status: "canceled", updated_by: input.actorId }, { expectedStatuses: ["sent"], expectedUpdatedAt: input.expectedUpdatedAt }),
    noticeFlowRow(db, row.id),
    citationsOf(db, row)
  ]);
  const flow = await moveNoticeFlow(db, row.id, { actorId: input.actorId, flow: current, from: ["active", "paused"], now: input.now, reason: input.flowReason, to: "ended" });
  const [followUpsRemoved, removed] = await Promise.all([
    flow && input.alsoFollowUps ? withdrawFollowUpRows(db, flow.id, input.actorId) : Promise.resolve(0),
    deleteCampaignNotifications(db, row.id)
  ]);

  if (flow) {
    invalidateLivePopups({ from: "action" });
  }

  return { citations, flow, followUpsRemoved, removed, updated };
}

/**
 * [messaging.publish] Retira a notificacao enviada: some do sino dos alunos (fica como cancelada). v2: as
 * seguintes deixam de sair (o fluxo do aviso termina, source_withdrawn) e, com `alsoFollowUps` (padrao),
 * as que ja sairam tambem somem do sino. v3a: a auditoria conta as regras que citam a notificacao.
 * Ajustes da v3a: sem revalidatePath (com ele, o servidor invalida o cache e desenha a pagina inteira de novo
 * na mesma resposta da acao); a tela fecha o dialogo, mostra o toast e so entao atualiza (router.refresh numa
 * transicao, useNoticeActions). O updateTag do fluxo encerrado continua (cache das visitas de pagina).
 */
export async function withdrawNotice(input: WithdrawNoticeInput): Promise<ActionResult<NoticeStateChange & { removed: number }>> {
  return runAdminAction("messaging.publish", withdrawNoticeSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const now = new Date();
    const row = await requireCampaign(db, data.id);

    if (row.kind !== "inbox") {
      throw new CommunicationError("Esta ação vale só para notificações.", 422);
    }

    const { citations, flow, followUpsRemoved, removed, updated } = await withdrawSentNotice(db, row, {
      actorId: user.id,
      alsoFollowUps: data.alsoFollowUps,
      expectedUpdatedAt: data.expectedUpdatedAt,
      flowReason: "source_withdrawn",
      now
    });

    await recordAudit(db, {
      action: "communication.withdrawn",
      actorId: user.id,
      count: removed,
      entityId: row.id,
      entityType: "campaign",
      metadata: {
        also_follow_ups: Boolean(flow) && data.alsoFollowUps,
        cited_by_flows: citations.flows,
        cited_by_notices: citations.notices,
        follow_ups_removed: followUpsRemoved,
        kind: row.kind
      }
    });

    return { ...stateChange(updated, now.getTime()), removed };
  });
}

/**
 * [messaging.publish] "Mostrar de novo para quem já viu" pelo menu (docs/24 §2.4 e §4.9): pop-up no ar ou
 * pausado, em qualquer "Quantas vezes" (v3b-1, docs/25 §4.7). Quem ainda esta no segmento, viu mais vezes do
 * que adiou e nao escolheu "Não mostrar de novo" nem clicou (quem clicou conta no pop-up que so para quando
 * termina) volta a contar como novo: a contagem de "Quantas vezes" recomeca. Acima de 500,
 * messaging.publish_large. O aviso nao muda (a versao devolvida e a mesma).
 */
export async function reshowPopup(input: NoticeIdInput): Promise<ActionResult<{ reshown: number; updatedAt: string }>> {
  return runAdminAction("messaging.publish", noticeIdSchema, input, async ({ access, input: data, user }) => {
    const db = communicationsDb();
    const now = new Date();
    const row = await requireCampaign(db, data.id);

    if (row.kind !== "popup") {
      throw new CommunicationError("Esta ação vale só para pop-ups.", 422);
    }

    if ((row.status !== "active" && row.status !== "paused") || situationNow(row, now.getTime()) === "ended") {
      throw new CommunicationError(POPUP_NOT_LIVE, 409);
    }

    assertSameVersion(row, data.expectedUpdatedAt);

    await countPopupReshow(db, access, row.id, now);
    const reshown = await applyPopupReshow(db, access, row.id, now);

    await recordAudit(db, {
      action: "communication.popup_reshown",
      actorId: user.id,
      count: reshown,
      entityId: row.id,
      entityType: "campaign",
      metadata: { count: reshown, via: "menu" }
    });
    revalidateNotices(row.id);

    return { reshown, updatedAt: row.updated_at };
  });
}

/**
 * [messaging.publish] "Encerrar enquete" no relatorio da notificacao enviada (docs/24 §4.10): o fim vira
 * agora (ISO canonico) e ninguem mais vota; o resultado fica como esta. So aviso: o passo de fluxo e recusado
 * por requireCampaign (a enquete dele termina quando a notificacao sai do sino).
 */
export async function closeNoticePoll(input: NoticeIdInput): Promise<ActionResult<NoticeStateChange>> {
  return runAdminAction("messaging.publish", noticeIdSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const now = new Date();
    const row = await requireCampaign(db, data.id);
    const poll = row.kind === "inbox" && row.status === "sent" ? parsePoll(row.poll) : null;

    if (!poll) {
      throw new CommunicationError(POLL_MISSING, 409);
    }

    if (isPollClosed(poll, now.getTime())) {
      throw new CommunicationError(POLL_ALREADY_CLOSED, 409);
    }

    assertSameVersion(row, data.expectedUpdatedAt);

    const nowIso = now.toISOString();
    const updated = await updateCampaign(
      db,
      row.id,
      { edited_at: nowIso, edited_by: user.id, poll: { ...poll, closesAt: nowIso }, updated_by: user.id },
      { expectedStatuses: ["sent"], expectedUpdatedAt: row.updated_at }
    );

    await recordAudit(db, { action: "communication.poll_closed", actorId: user.id, entityId: row.id, entityType: "campaign", metadata: {} });
    revalidateNotices(row.id);

    return stateChange(updated, now.getTime());
  });
}

/* ------------------------------------------------------------------------------------------------
 * Duplicar, excluir, teste e imagem
 * ---------------------------------------------------------------------------------------------- */

/**
 * Copia as seguintes do aviso para a copia (duplicar): passos com ids novos, conteudo como rascunho novo,
 * referencias de tempo, regras e a linha "Parar ..." remapeadas; "fica no sino ate uma data" que ja passou
 * (ou a menos de 1 hora) volta para 90 dias, como no aviso. Devolve quantas seguintes foram copiadas.
 */
async function duplicateNoticeFollowUps(db: CommunicationsDb, input: { actorId: string; notice: CampaignRow; now: number; sourceId: string }): Promise<number> {
  const loaded = await loadNoticeFlow(db, input.sourceId);
  const messageNodes = loaded?.tree.nodes.filter((node) => node.kind === "message") ?? [];

  if (!loaded || messageNodes.length === 0) {
    return 0;
  }

  const versions = new Map((await fetchCampaignsByIds(db, messageNodes.map((node) => node.campaignId ?? "").filter(Boolean))).map((version) => [version.id, version]));
  const ids = new Map(loaded.tree.nodes.map((node) => [node.id, crypto.randomUUID()]));
  const remap = (definition: AudienceDefinition | null) => (definition ? remapNodeRefs(definition, ids) : null);
  const nodes: FlowNode[] = loaded.tree.nodes.map((node) => ({
    ...node,
    anchorNodeId: node.anchorNodeId ? (ids.get(node.anchorNodeId) ?? null) : null,
    campaignId: null,
    condition: remap(node.condition),
    filter: remap(node.filter),
    id: ids.get(node.id) ?? node.id,
    parentId: node.parentId ? (ids.get(node.parentId) ?? null) : null
  }));
  const contents: Record<string, FlowNoticeContent> = {};

  for (const node of messageNodes) {
    const content = followUpContentOf(node, versions.get(node.campaignId ?? ""));

    if (content.validity.mode === "until" && !(Date.parse(content.validity.endsAt) > input.now + HOUR_MS)) {
      content.validity = { mode: "default" };
    }

    contents[ids.get(node.id) ?? node.id] = content;
  }

  await saveFlowTree(db, {
    actorId: input.actorId,
    contents,
    flow: { goal: remap(definitionOf(loaded.flow.goal)), name: noticeFlowName(input.notice.title), origin: "notice", sourceCampaignId: input.notice.id },
    now: new Date(input.now),
    tree: { nodes, origin: "notice" }
  });

  return messageNodes.length;
}

/**
 * [messaging.write] Novo rascunho com o mesmo conteudo e segmento (data que ja passou fica para "agora";
 * "fica no sino ate uma data" que ja passou, ou a menos de 1 hora, volta para os 90 dias).
 */
export async function duplicateNotice(input: NoticeIdInput): Promise<ActionResult<{ id: string; updatedAt: string }>> {
  return runAdminAction("messaging.write", noticeIdSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const now = Date.now();
    const row = await requireCampaign(db, data.id);
    // v3b-1: o pop-up leva toda a configuracao (onde, quando, quantas vezes, "Volta em", como fecha).
    const draft = noticeDraftOfRow(row);

    if (draft.schedule.mode === "at" && Date.parse(draft.schedule.sendAt) <= now) {
      draft.schedule = { mode: "now" };
    }

    if (draft.window.endsAt && Date.parse(draft.window.endsAt) <= now) {
      draft.window = { endsAt: null, startsAt: null };
    }

    if (draft.validity.mode === "until" && !(Date.parse(draft.validity.endsAt) > now + HOUR_MS)) {
      draft.validity = { mode: "default" };
    }

    // v3a: enquete com fim que ja passou (ou a menos de 1 hora) volta a "quando sair do sino"; o fim que fica
    // vai no ISO canonico (o check campaigns_poll_v3). Reacoes e "como o aluno chega la" vao junto.
    if (draft.poll?.closesAt) {
      const closesAt = Date.parse(draft.poll.closesAt);

      draft.poll = { ...draft.poll, closesAt: closesAt > now + HOUR_MS ? new Date(closesAt).toISOString() : null };
    }

    const created = await insertCampaign(db, { ...draftToColumns(draft), created_by: user.id, status: "draft", updated_by: user.id });
    const followUps = created.kind === "inbox" ? await duplicateNoticeFollowUps(db, { actorId: user.id, notice: created, now, sourceId: row.id }) : 0;

    await recordAudit(db, {
      action: "communication.duplicated",
      actorId: user.id,
      entityId: created.id,
      entityType: "campaign",
      metadata: { follow_ups: followUps, kind: created.kind, source_id: row.id }
    });
    revalidateNotices();

    return { id: created.id, updatedAt: created.updated_at };
  });
}

/**
 * [messaging.write] Exclui o aviso (docs/24 §2.3 e §4.8), em toda situacao menos "Enviando" (o envio segura a
 * linha: 409). Rascunho, aguardando aprovacao, cancelado e encerrado: so sai da lista (e o fluxo das seguintes
 * junto). O que os alunos veem ou vao ver pede messaging.publish (nunca a regra dos 500: tirar nunca alcanca
 * mais ninguem): agendado (o tick so reserva aviso nao excluido), enviado (sai de todo sino como Retirar do
 * sino, com as seguintes que ja sairam por padrao, e depois da lista) e pop-up no ar ou pausado (encerrado
 * agora e depois tirado da lista). Regras que citam a notificacao so avisam: a contagem vai para a auditoria.
 * Ajustes da v3a (o dialogo demorava a fechar): as leituras vao junto com a primeira gravacao, o que nao
 * depende um do outro vai junto (Promise.all), o fluxo ja lido nao e lido de novo (de ~11 idas ao banco em
 * serie para ~5 na enviada com seguintes), e nada de revalidatePath (com ele, o servidor invalida o cache e
 * desenha a pagina inteira de novo na mesma resposta; na pagina do aviso, a de um aviso que nao existe mais).
 * A tela fecha o dialogo e mostra o toast assim que a acao volta e entao atualiza a lista (router.refresh numa
 * transicao) ou volta para ela (onDeleted). O updateTag do pop-up e do fluxo continua (o cache deles).
 */
export async function deleteNotice(input: DeleteNoticeInput): Promise<ActionResult<{ id: string; removed: number }>> {
  return runAdminAction("messaging.write", deleteNoticeSchema, input, async ({ access, input: data, user }) => {
    const db = communicationsDb();
    const now = new Date();
    const row = await requireCampaign(db, data.id);

    assertSameVersion(row, data.expectedUpdatedAt);

    if (row.status === "sending") {
      throw new CommunicationError(DELETE_WHILE_SENDING, 409);
    }

    const situation = situationNow(row, now.getTime());
    // Pop-up publicado (no ar ou com a janela por comecar) ou pausado; o que ja passou do fim e "encerrado".
    const livePopup = row.kind === "popup" && (row.status === "paused" || (row.status === "active" && situation !== "ended"));

    if ((row.status === "scheduled" || row.status === "sent" || livePopup) && !can(access, "messaging.publish")) {
      throw new CommunicationError(DELETE_NEEDS_PUBLISH, 403);
    }

    const nowIso = now.toISOString();
    let citations = { flows: 0, notices: 0 };
    let removed = 0;
    let followUpsRemoved = 0;

    if (row.status === "sent") {
      const withdrawn = await withdrawSentNotice(db, row, {
        actorId: user.id,
        alsoFollowUps: data.alsoFollowUps,
        expectedUpdatedAt: row.updated_at,
        flowReason: "source_deleted",
        now
      });

      citations = withdrawn.citations;
      removed = withdrawn.removed;
      followUpsRemoved = withdrawn.followUpsRemoved;

      // O fluxo ja terminou (source_deleted) junto com a retirada: so sai da lista, junto com o aviso.
      await Promise.all([
        softDeleteCampaign(db, row.id, { actorId: user.id, expectedStatuses: ["canceled"], expectedUpdatedAt: withdrawn.updated.updated_at, now }),
        withdrawn.flow ? removeNoticeFlow(db, withdrawn.flow, { actorId: user.id, now, reason: null }) : Promise.resolve()
      ]);
    } else if (livePopup) {
      // Encerrado e tirado da lista numa gravacao so (o mesmo resultado das duas de antes).
      await updateCampaign(
        db,
        row.id,
        { ...endingPatch(row, now), deleted_at: nowIso, deleted_by: user.id, status: "ended", updated_by: user.id },
        { expectedStatuses: [row.status], expectedUpdatedAt: row.updated_at }
      );
      invalidateLivePopups({ from: "action" });
    } else {
      const [, flow, cited] = await Promise.all([
        softDeleteCampaign(db, row.id, { actorId: user.id, expectedStatuses: [row.status], expectedUpdatedAt: row.updated_at, now }),
        row.kind === "inbox" ? noticeFlowRow(db, row.id) : Promise.resolve(null),
        citationsOf(db, row)
      ]);

      citations = cited;

      // Pop-up fora do ar (rascunho, agendado, encerrado): a lista em cache so tem os no ar e a leitura ja
      // descarta os encerrados, entao nao ha o que invalidar (e a resposta nao volta com a pagina renderizada).

      // v2: as seguintes saem junto (no ar ou pausado, encerradas antes: source_deleted).
      if (flow) {
        await removeNoticeFlow(db, flow, { actorId: user.id, now, reason: "source_deleted" });
      }
    }

    await recordAudit(db, {
      action: "communication.deleted",
      actorId: user.id,
      entityId: row.id,
      entityType: "campaign",
      metadata: {
        cited_by_flows: citations.flows,
        cited_by_notices: citations.notices,
        follow_ups_removed: followUpsRemoved,
        kind: row.kind,
        removed,
        status: row.status
      }
    });

    return { id: row.id, removed };
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

    await upsertTestNotification(db, row, user.id, Date.now());
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

/* ------------------------------------------------------------------------------------------------
 * "Depois desta notificação": gravar as seguintes, contar ao vivo e o teste (v2, docs/23 §2.2 e §6.2)
 * ---------------------------------------------------------------------------------------------- */

export type SavedNoticeFollowUps = {
  /** Entrada do fluxo (a notificacao principal nas regras); null = o fluxo saiu (pop-up ou nenhuma seguinte). */
  entryNodeId: string | null;
  flowId: string | null;
  flowUpdatedAt: string | null;
  nodeIds: Record<string, string>;
};

export type FollowUpAudiencePreview = { qualified: number | null; recipients: number };

/** Conteudo de cada seguinte pelo id do passo (o que saveFlowTree grava como versao). */
function contentsOfDrafts(drafts: readonly FollowUpDraft[], into: Record<string, FlowNoticeContent> = {}) {
  for (const draft of drafts) {
    into[draft.id] = draft.content;
    contentsOfDrafts(draft.children, into);
  }

  return into;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Entrada de um fluxo de aviso novo: o id que o navegador ja usou nas regras para a notificacao principal
 * (o cartao continua igual depois de gravar), desde que nenhum passo tenha esse id; senao, um novo.
 */
async function newEntryId(db: CommunicationsDb, drafts: readonly FollowUpDraft[]) {
  const [candidate] = foreignNodeRefs(drafts).filter((ref) => UUID_PATTERN.test(ref));

  if (candidate) {
    const { data, error } = await db.from("communication_flow_nodes").select("id").eq("id", candidate).limit(1);
    assertNoDbError(error, "Comunicacao: entrada do fluxo do aviso");

    if ((data ?? []).length === 0) {
      return candidate;
    }
  }

  return crypto.randomUUID();
}

/**
 * Quem envia cada seguinte esta na equipe agora (400 no campo "Quem envia" da seguinte, como no aviso e no
 * construtor). Depois do envio a versao ja sai "sent": sem isto, um id qualquer iria para o sino.
 */
async function assertFollowUpSenders(db: CommunicationsDb, drafts: readonly FollowUpDraft[]) {
  const paths = followUpPaths(drafts);
  const senders = Object.entries(contentsOfDrafts(drafts)).flatMap(([nodeId, content]) => (content.sender ? [[nodeId, content.sender.userId] as const] : []));

  if (senders.length === 0) {
    return;
  }

  const { data, error } = await db.from("admin_roles").select("user_id").in("user_id", Array.from(new Set(senders.map(([, userId]) => userId))));
  assertNoDbError(error, "Comunicacao: equipe de quem envia as seguintes");

  const team = new Set(((data ?? []) as { user_id: string }[]).map((row) => row.user_id));
  const outside = senders.find(([, userId]) => !team.has(userId));

  if (outside) {
    throw new NoticeFieldError(`${paths.get(outside[0]) ?? "followUps"}.content.sender`, SENDER_NOT_ON_TEAM);
  }
}

/** A conferencia da arvore (a mesma de saveFlowTree), com o erro no campo do cartao ("followUps.0.when.minutes"). */
function assertFollowUpTree(input: { drafts: readonly FollowUpDraft[]; entryId: string; goal: AudienceDefinition | null; nodes: FlowNode[]; notice: CampaignRow }) {
  const metas: Record<string, FlowMessageMeta> = { [input.entryId]: messageMetaOfRow(input.notice) };

  for (const [nodeId, content] of Object.entries(contentsOfDrafts(input.drafts))) {
    metas[nodeId] = { ...messageMetaOfRow({ ...flowContentColumns(content), id: "" }), campaignId: "" };
  }

  const tree = { nodes: input.nodes, origin: "notice" as const };
  const [issue] = [...validateFlowTree(tree, metas), ...validateFlowGoal(tree, input.goal, metas)].filter((item) => item.level === "save");

  if (issue) {
    throw new NoticeFieldError(followUpIssuePath(issue.nodeId ? followUpPaths(input.drafts).get(issue.nodeId) : undefined, issue.field), issue.message);
  }
}

/**
 * [messaging.write; depois do envio messaging.publish e, acima de 500, messaging.publish_large] Grava as
 * notificacoes seguintes do aviso, logo depois de saveNoticeDraft (o editor mostra o banner de "salvo pela
 * metade" se falhar). Cria o fluxo do aviso no primeiro uso (origin "notice", rascunho enquanto o aviso e
 * rascunho) e grava pelo mesmo caminho do construtor (saveFlowTree, RPC 7.5). Depois do envio as mudancas
 * valem na hora ("Aplicar alterações"): um fluxo criado agora ja nasce no ar (7.13) e a seguinte nova de
 * primeiro nivel chega a todos que receberam o aviso, contando de quando cada um recebeu (7.3).
 * `followUps: []` num rascunho tira o fluxo (a troca para pop-up). Recusa aviso retirado do sino (409) e
 * aviso que ja saiu do sino de todos (409).
 */
export async function saveNoticeFollowUps(input: SaveNoticeFollowUpsInput): Promise<ActionResult<SavedNoticeFollowUps>> {
  return runAdminAction("messaging.write", saveNoticeFollowUpsSchema, input, async ({ access, input: data, user }) => {
    const db = communicationsDb();
    const now = new Date();
    const notice = await requireCampaign(db, data.noticeId);

    assertSameVersion(notice, data.expectedNoticeUpdatedAt);

    if (notice.kind !== "inbox" && data.followUps.length > 0) {
      throw new CommunicationError(FOLLOW_UPS_INBOX_ONLY, 422);
    }

    if (notice.status === "canceled") {
      throw new CommunicationError(FOLLOW_UPS_WITHDRAWN, 409);
    }

    const sent = notice.status === "sending" || notice.status === "sent";

    // Antes do envio, as seguintes mudam junto com o aviso salvo (que volta a rascunho).
    if (!sent && notice.status !== "draft") {
      throw new CommunicationError(FOLLOW_UPS_SAVE_NOTICE_FIRST, 409);
    }

    if (sent && !can(access, "messaging.publish")) {
      throw new CommunicationError(FOLLOW_UPS_NEED_PUBLISH, 403);
    }

    if (sent && !canPublishTo(access, noticeRecipients(notice))) {
      throw new CommunicationError(LIVE_FLOW_NEEDS_APPROVAL, 403);
    }

    const loaded = await loadNoticeFlow(db, notice.id);

    if (loaded?.flow.status === "ended") {
      throw new CommunicationError(loaded.flow.ended_reason === "finished" ? FOLLOW_UPS_GONE : FOLLOW_UPS_WITHDRAWN, 409);
    }

    // A versao do fluxo lida pela tela; null = a tela nao viu fluxo nenhum (outra tela criou um no meio:
    // gravar por cima tiraria as seguintes dela em silencio).
    const flowChanged =
      data.expectedFlowUpdatedAt === null
        ? loaded !== null
        : Boolean(data.expectedFlowUpdatedAt) && (!loaded || !isSameVersion(data.expectedFlowUpdatedAt as string, loaded.flow.updated_at));

    if (flowChanged) {
      throw new CommunicationError(FLOW_CHANGED_MESSAGE, 409);
    }

    // Rascunho sem seguintes (ou trocado para pop-up): o fluxo do aviso sai (nada foi enviado).
    if (data.followUps.length === 0 && !sent) {
      if (loaded) {
        await removeNoticeFlow(db, loaded.flow, { actorId: user.id, now, reason: null });
        await recordAudit(db, {
          action: "communication.follow_ups_saved",
          actorId: user.id,
          count: 0,
          entityId: notice.id,
          entityType: "campaign",
          metadata: { flow_id: loaded.flow.id, removed: true }
        });
        revalidateNotices(notice.id);
      }

      return { entryNodeId: null, flowId: null, flowUpdatedAt: null, nodeIds: {} };
    }

    // O construtor mudou o fluxo para algo que o cartao nao desenha: so pelo construtor.
    if (loaded && followUpsFromTree(loaded.tree) === null) {
      throw new CommunicationError(FOLLOW_UPS_BUILDER_ONLY, 409);
    }

    // Depois do envio sem fluxo ainda: so enquanto alguma linha do aviso continua no sino.
    if (sent && !loaded) {
      const last = await lastSourceExpiry(db, notice.id);

      if (last === null || last <= now.getTime()) {
        throw new CommunicationError(FOLLOW_UPS_GONE, 409);
      }
    }

    const entryId = (loaded ? entryOf(loaded.tree)?.id : null) ?? (await newEntryId(db, data.followUps));
    const drafts = remapEntryRefs(data.followUps, entryId);
    const nodes = treeFromFollowUps(entryId, followUpsOfDrafts(drafts));
    const savedGoal = loaded ? definitionOf(loaded.flow.goal) : null;
    // Objetivo mudado no construtor (nao e um "têm acesso a" so): o cartao nao mexe nele.
    const goal = data.goal ? stopGoalDefinition(data.goal.productId) : savedGoal && stopLineOfGoal(savedGoal).kind === "other" ? savedGoal : null;

    assertFollowUpTree({ drafts, entryId, goal, nodes, notice });
    await assertFollowUpSenders(db, drafts);

    const previousSenders = new Set<string>(notice.sender_user_id ? [notice.sender_user_id] : []);

    if (loaded && sent) {
      const versionIds = loaded.tree.nodes.map((node) => node.campaignId ?? "").filter(Boolean);

      for (const version of await fetchCampaignsByIds(db, versionIds)) {
        if (version.sender_user_id) {
          previousSenders.add(version.sender_user_id);
        }
      }
    }

    const saved = await saveFlowTree(db, {
      actorId: user.id,
      contents: contentsOfDrafts(drafts),
      expectedUpdatedAt: loaded ? (data.expectedFlowUpdatedAt ?? loaded.flow.updated_at) : null,
      flow: { goal, name: noticeFlowName(notice.title), origin: "notice", sourceCampaignId: notice.id },
      flowId: loaded?.flow.id ?? null,
      now,
      tree: { nodes, origin: "notice" }
    });
    let flow = saved.flow;

    // A primeira seguinte de uma notificacao que ja saiu: o fluxo nasce no ar (o conteudo vira "sent").
    if (sent && flow.status === "draft") {
      flow = await changeFlowState(db, { actorId: user.id, entryCount: noticeRecipients(notice), expectedUpdatedAt: flow.updated_at, flowId: flow.id, now, to: "active" });
    }

    invalidateLivePopups({ from: "action" });

    // No ar, quem passou a enviar agora recebe o e-mail "enviada em seu nome" (uma vez por fluxo).
    const newSenders = sent ? saved.senderIds.filter((id) => !previousSenders.has(id)) : [];

    if (newSenders.length > 0) {
      await notifySendersOnBehalf(db, { actorId: user.id, count: noticeRecipients(notice), flowId: flow.id, senders: newSenders, title: flow.name }).catch((error: unknown) =>
        console.error(`[comunicacao] "enviada em seu nome" do fluxo ${flow.id} nao agendado: ${error instanceof Error ? error.message : String(error)}`)
      );
    }

    await recordAudit(db, {
      action: "communication.follow_ups_saved",
      actorId: user.id,
      count: Object.keys(contentsOfDrafts(drafts)).length,
      entityId: notice.id,
      entityType: "campaign",
      metadata: {
        flow_id: flow.id,
        live: sent,
        new_versions: saved.newVersions.length,
        revision: flow.revision,
        sender_user_ids: saved.senderIds,
        stop_product: data.goal?.productId ?? null
      }
    });
    revalidateNotices(notice.id);

    return { entryNodeId: entryId, flowId: flow.id, flowUpdatedAt: flow.updated_at, nodeIds: saved.nodeIds };
  });
}

/** Quem recebeu a notificacao de um passo (seguinte), sem os testes. */
async function nodeRecipientIds(db: CommunicationsDb, nodeId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const page = 1_000;

  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from("notifications")
      .select("user_id")
      .eq("flow_node_id", nodeId)
      .eq("is_test", false)
      .order("user_id")
      .range(from, from + page - 1);
    assertNoDbError(error, "Comunicacao: quem recebeu a seguinte");

    const rows = (data ?? []) as { user_id: string }[];
    rows.forEach((row) => ids.add(row.user_id));

    if (rows.length < page) {
      return ids;
    }
  }
}

/** Passos citados pelas regras (notificacao, pagina do botao e "desde"). */
function nodeRefsOf(definition: AudienceDefinition): Set<string> {
  const refs = new Set<string>();
  const visit = (node: AudienceNode) => {
    if (isAudienceGroup(node)) {
      node.items.forEach(visit);
      return;
    }

    if (node.type === "message" && node.ref.kind === "node") {
      refs.add(node.ref.nodeId);
    } else if (node.type === "page_visit") {
      if (node.page.kind === "message_cta") {
        refs.add(node.page.nodeId);
      }

      if (node.since.kind === "message") {
        refs.add(node.since.nodeId);
      }
    } else if (node.type === "access_gained" && node.since.kind === "message") {
      refs.add(node.since.nodeId);
    }
  };

  if (definition.kind === "rules") {
    visit(definition.root);
  }

  return refs;
}

const FOLLOW_UP_PREVIEW_CHUNK = 1_000;
const ZERO_COMMENTS = { d7: 0, d30: 0, d90: 0, total: 0 };

/**
 * [messaging.write] Contagem ao vivo de uma seguinte (so numeros, nunca nomes): quem recebeu a notificacao
 * de cima (o aviso, `parentNodeId` null, ou a seguinte de cima) e combina agora com `filter`. Fatos do lote
 * (RPC 7.9) em pedacos de 1.000 alunos; os fatos completos (progresso, comentarios...) so uma vez, e so se
 * alguma regra pede. `qualified: null` enquanto a de cima nao saiu.
 */
export async function previewFollowUpAudience(input: PreviewFollowUpAudienceInput): Promise<ActionResult<FollowUpAudiencePreview>> {
  return runAdminAction("messaging.write", previewFollowUpAudienceSchema, input, async ({ input: data }) => {
    const db = communicationsDb();
    const now = new Date();
    const nowMs = now.getTime();
    const notice = await requireCampaign(db, data.noticeId);

    if (notice.kind !== "inbox" || (notice.status !== "sent" && notice.status !== "sending")) {
      return { qualified: null, recipients: 0 };
    }

    const loaded = await loadNoticeFlow(db, notice.id);
    const followUpNodes = new Map((loaded?.tree.nodes ?? []).filter((node) => node.kind === "message").map((node) => [node.id, node]));
    const entryId = loaded ? (entryOf(loaded.tree)?.id ?? null) : null;
    const parentIsNotice = data.parentNodeId === null || data.parentNodeId === entryId;

    // A seguinte de cima ainda nao foi gravada: ninguem a recebeu.
    if (!parentIsNotice && !followUpNodes.has(data.parentNodeId ?? "")) {
      return { qualified: null, recipients: 0 };
    }

    const recipients = parentIsNotice ? await fetchCampaignRecipientIds(db, notice.id) : await nodeRecipientIds(db, data.parentNodeId ?? "");

    if (recipients.size === 0) {
      return { qualified: null, recipients: 0 };
    }

    const filter = normalizeAudience(data.filter);
    const refs = nodeRefsOf(filter);
    // Toda referencia que nao e uma seguinte gravada e a notificacao principal (a entrada do fluxo).
    const noticeAliases = Array.from(refs).filter((ref) => !followUpNodes.has(ref));
    const versionIds = Array.from(refs, (ref) => followUpNodes.get(ref)?.campaignId ?? "").filter(Boolean);
    const versions = new Map((await fetchCampaignsByIds(db, versionIds)).map((version) => [version.id, version]));
    const ctaPageKeys: Record<string, string | null> = {};

    for (const ref of refs) {
      const node = followUpNodes.get(ref);

      ctaPageKeys[ref] = pageKeyOfHref(node ? (versions.get(node.campaignId ?? "")?.cta_href ?? null) : notice.cta_href);
    }

    const noticeKey = messageRefKey({ campaignId: notice.id, kind: "campaign" });
    const campaignIds = collectMessageCampaignIds(filter);
    const dedupeKeys = new Set<string>([`campaign:${notice.id}`, ...campaignIds.map((id) => `campaign:${id}`)]);
    const messageKeys = new Set<string>([noticeKey, ...campaignIds.map((campaignId) => messageRefKey({ campaignId, kind: "campaign" }))]);
    const pageKeys = new Set<string>();

    for (const ref of refs) {
      messageKeys.add(messageRefKey({ kind: "node", nodeId: ref }));

      if (followUpNodes.has(ref)) {
        dedupeKeys.add(`flow:${ref}`);
      }
    }

    const collectPages = (node: AudienceNode) => {
      if (isAudienceGroup(node)) {
        node.items.forEach(collectPages);
        return;
      }

      if (node.type === "page_visit") {
        const key = node.page.kind === "message_cta" ? ctaPageKeys[node.page.nodeId] : pageKeyOfTarget(node.page);

        if (key) {
          pageKeys.add(key);
        }
      }
    };

    if (filter.kind === "rules") {
      collectPages(filter.root);
    }

    // Progresso, comentarios, entrada, ritmo ou turma: os fatos completos, uma vez so.
    const needs = audienceFactNeeds([filter]);
    const full = needs.students ? await loadAudienceFacts(db, now) : null;
    const fullFacts = new Map((full?.facts ?? []).map((fact) => [fact.userId, fact]));
    const context: AudienceContext = {
      commentRanks: full?.context.commentRanks ?? buildCommentRanks([]),
      flow: { ctaPageKeys },
      lessonTotals: full?.context.lessonTotals ?? {},
      messageKeys,
      now: nowMs
    };
    let qualified = 0;
    let counted = 0;
    const userIds = Array.from(recipients).sort();

    for (let index = 0; index < userIds.length; index += FOLLOW_UP_PREVIEW_CHUNK) {
      const chunk = userIds.slice(index, index + FOLLOW_UP_PREVIEW_CHUNK);
      const batch = await fetchFlowBatchFacts(db, {
        dedupeKeys: Array.from(dedupeKeys).sort(),
        flowIds: loaded ? [loaded.flow.id] : [],
        pageKeys: Array.from(pageKeys).sort(),
        userIds: chunk
      });
      const staff = new Set(batch.staff);
      const accesses = new Map<string, AudienceEntitlementRow[]>();
      const messages = new Map<string, Record<string, MessageFact>>();
      const visits = new Map<string, Record<string, number>>();
      const entered = new Map(batch.runs.map((run) => [run.u, Date.parse(run.entered_at)]));

      for (const row of batch.accesses) {
        const list = accesses.get(row.u) ?? [];
        list.push({
          created_at: row.created_at,
          ends_at: row.ends_at,
          starts_at: row.starts_at,
          status: row.status as AudienceEntitlementRow["status"],
          target_id: row.target_id,
          target_type: row.target_type as AudienceEntitlementRow["target_type"],
          user_id: row.u
        });
        accesses.set(row.u, list);
      }

      for (const row of batch.messages) {
        if (row.live === false) {
          continue;
        }

        const fact = messageFactOf(row);
        const own = messages.get(row.u) ?? {};

        if (row.k.startsWith("flow:")) {
          own[messageRefKey({ kind: "node", nodeId: row.k.slice("flow:".length) })] = fact;
        } else {
          own[row.k] = fact;

          if (row.k === `campaign:${notice.id}`) {
            noticeAliases.forEach((alias) => (own[messageRefKey({ kind: "node", nodeId: alias })] = fact));
          }
        }

        messages.set(row.u, own);
      }

      for (const row of batch.visits) {
        const time = Date.parse(row.at);

        if (Number.isFinite(time)) {
          visits.set(row.u, { ...(visits.get(row.u) ?? {}), [row.k]: time });
        }
      }

      for (const userId of chunk) {
        if (staff.has(userId)) {
          continue;
        }

        const base: AudienceStudentFacts | undefined = full
          ? fullFacts.get(userId)
          : {
              accesses: accessFactsOf(openAccessRows(accesses.get(userId) ?? [], nowMs)),
              cohortIds: [],
              comments: ZERO_COMMENTS,
              completedByContent: {},
              completedLessons: 0,
              lastSignInAt: null,
              lastStudiedAt: null,
              pace: "never_started",
              totalLessons: 0,
              userId
            };

        if (!base) {
          continue;
        }

        const own = messages.get(userId) ?? {};
        // "desde que entrou": a passagem no fluxo; sem passagem ainda, quando recebeu o aviso.
        const enteredAt = entered.get(userId) ?? own[noticeKey]?.visibleAt ?? nowMs;
        const facts: AudienceStudentFacts = { ...base, flow: { enteredAt, pageVisits: visits.get(userId) ?? {} }, messages: own };

        counted += 1;

        if (evaluateAudience(filter, facts, context)) {
          qualified += 1;
        }
      }
    }

    return { qualified, recipients: counted };
  });
}

const followUpTestSchema = z.object({ nodeId: z.uuid({ error: "Passo inválido." }), noticeId: noticeIdSchema.shape.id });

/**
 * [messaging.write] "Enviar teste para mim" de uma notificacao seguinte (no cartao; o editor grava antes):
 * a versao atual do passo vai para o sino de quem pediu, como teste (fora dos numeros). O construtor de
 * fluxos tem o proprio (sendFlowMessageTest).
 */
export async function sendFollowUpTestToMe(input: { nodeId: string; noticeId: string }): Promise<ActionResult<{ sent: true }>> {
  return runAdminAction("messaging.write", followUpTestSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const notice = await requireCampaign(db, data.noticeId);
    const loaded = await loadNoticeFlow(db, notice.id);
    const node = loaded?.tree.nodes.find((item) => item.id === data.nodeId && item.kind === "message");
    const version = node?.campaignId ? await fetchCampaign(db, node.campaignId) : null;

    if (!loaded || !version) {
      throw new CommunicationError(FOLLOW_UP_MISSING, 404);
    }

    await upsertTestNotification(db, version, user.id, Date.now());
    await recordAudit(db, { action: "communication.test_sent", actorId: user.id, entityId: version.id, entityType: "campaign", metadata: { flow_id: loaded.flow.id, kind: "inbox", source_id: notice.id } });

    return { sent: true as const };
  });
}
