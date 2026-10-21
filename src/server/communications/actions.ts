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
  isEditableStatus,
  isSameVersion,
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
  type FlowStatus
} from "./flow-model";
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
import { followUpContentOf, loadAudienceNames, loadNoticeFlow, loadNoticeSenders, type NoticeSenderOption } from "./queries";
import { notifySendersOnBehalf } from "./sender-notices";
import {
  noticeDraftSchema,
  noticeIdSchema,
  previewAudienceSchema,
  publishProblems,
  saveNoticeSchema,
  uploadNoticeImageSchema,
  withdrawNoticeSchema,
  type NoticeDraft,
  type NoticeIdInput,
  type SaveNoticeInput,
  type WithdrawNoticeInput
} from "./schemas";
import {
  audienceOfRow,
  deleteCampaignNotifications,
  draftToColumns,
  fetchCampaign,
  fetchCampaignRecipientIds,
  fetchCampaignsByIds,
  insertCampaign,
  NOTICE_CHANGED_MESSAGE,
  NOTICE_MISSING_MESSAGE,
  rowToDraft,
  softDeleteCampaign,
  updateCampaign,
  upsertTestNotification,
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

export type SavedNotice = {
  /**
   * A versao nova do fluxo das seguintes quando salvar o aviso tambem mudou o fluxo (agendado ou aguardando
   * aprovacao volta a rascunho junto); null = nao mudou. O editor manda esta para saveNoticeFollowUps.
   */
  flowUpdatedAt?: string | null;
  id: string;
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

/**
 * Quantos receberam ou vao receber a notificacao (a regra dos 500 das seguintes, docs/23 §2.9). O maior dos
 * dois: num envio cortado pelo orcamento do tick (ainda "sending"), recipients_count e so o parcial.
 */
function noticeRecipientsOf(row: CampaignRow) {
  return Math.max(row.recipients_count ?? 0, row.audience_count ?? 0);
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
 * situacao atual esta em `from`; nada a fazer = devolve o fluxo como esta (ou null sem fluxo).
 */
async function moveNoticeFlow(
  db: CommunicationsDb,
  noticeId: string,
  input: { actorId: string | null; entryCount?: number | null; from: readonly FlowStatus[]; now: Date; reason?: string | null; to: FlowStateChange["to"] }
): Promise<FlowRow | null> {
  const flow = await noticeFlowRow(db, noticeId);

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

/**
 * Publicar ou aprovar: as seguintes gravadas estao boas para sair (a arvore, 400 "A notificação seguinte 1
 * tem um problema: ..."), e quem envia cada uma ainda esta na equipe (422). Devolve o fluxo e quem envia;
 * null = o aviso nao tem seguintes.
 */
async function followUpsForPublish(db: CommunicationsDb, row: CampaignRow): Promise<{ flow: FlowRow; senders: string[] } | null> {
  if (row.kind !== "inbox") {
    return null;
  }

  const loaded = await loadNoticeFlow(db, row.id);
  const messageNodes = loaded?.tree.nodes.filter((node) => node.kind === "message") ?? [];

  if (!loaded || messageNodes.length === 0) {
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

  const goal = definitionOf(loaded.flow.goal);
  const [issue] = [...validateFlowTree(loaded.tree, metas), ...validateFlowGoal(loaded.tree, goal, metas)].filter((item) => item.level !== "warning");

  if (issue) {
    const drawn = followUpsFromTree(loaded.tree);
    const numbers = drawn ? followUpNumbers(drawn) : new Map(messageNodes.map((node, index) => [node.id, String(index + 1)]));
    const number = issue.nodeId ? numbers.get(issue.nodeId) : undefined;
    const path = followUpIssuePath(issue.nodeId && drawn ? followUpPaths(drawn).get(issue.nodeId) : undefined, issue.field);

    throw new NoticeFieldError(path, number ? `A notificação seguinte ${number} tem um problema: ${issue.message.replace(/\.$/, "")}.` : issue.message);
  }

  const senders = Array.from(new Set(Array.from(versions.values(), (version) => version.sender_user_id).filter((id): id is string => Boolean(id))));

  for (const userId of senders) {
    const state = await senderState(db, userId);

    if (!state.onTeam) {
      throw new CommunicationError(`${state.name ?? "A pessoa escolhida"} não está mais na equipe. Escolha quem envia.`, 422);
    }
  }

  // Paginas acompanhadas com o botao do aviso de agora: trocar o botao depois de gravar as seguintes (ou
  // seguintes feitas so no construtor) nao re-grava o fluxo, e a visita a pagina nova nunca seria gravada
  // ("não visitou a página do botão" valeria para todos).
  const watched = watchedPageKeysOf(loaded.tree, goal, metas, row.cta_href);
  const saved = [...(loaded.flow.watched_page_keys ?? [])].sort();

  if (JSON.stringify([...watched].sort()) !== JSON.stringify(saved)) {
    const { data, error } = await db
      .from("communication_flows")
      .update({ watched_page_keys: watched })
      .eq("id", loaded.flow.id)
      .is("deleted_at", null)
      .select(FLOW_COLUMNS)
      .maybeSingle();
    assertNoDbError(error, "Comunicacao: paginas acompanhadas das seguintes");

    return { flow: (data as FlowRow | null) ?? loaded.flow, senders };
  }

  return { flow: loaded.flow, senders };
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
 * [messaging.write] Cria ou atualiza o aviso. Agendado ou aguardando aprovacao volta a rascunho;
 * pop-up no ar ou pausado continua como esta (e recalcula quem ve se o segmento mudou). Mudar o pop-up
 * no ar vale como publicar: precisa de messaging.publish e, acima de 500 alunos (o segmento novo, ou a
 * contagem gravada quando o segmento nao mudou), de messaging.publish_large; senao, 403.
 */
export async function saveNoticeDraft(input: SaveNoticeInput): Promise<ActionResult<SavedNotice>> {
  return runAdminAction("messaging.write", saveNoticeSchema, input, async ({ access, input: data, user }) => {
    const db = communicationsDb();
    const columns = draftToColumns(data.draft);

    await assertSenderForSave(db, data.draft);

    if (!data.id) {
      const created = await insertCampaign(db, { ...columns, created_by: user.id, status: "draft", updated_by: user.id });

      await recordAudit(db, {
        action: "communication.saved",
        actorId: user.id,
        entityId: created.id,
        entityType: "campaign",
        metadata: { created: true, kind: created.kind, sender_user_id: created.sender_user_id }
      });
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
        loaded = await loadFactsFor(db, now, columns.audience);
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
      metadata: { audience_changed: audienceChanged, from_status: current.status, kind: saved.kind, sender_user_id: saved.sender_user_id, to_status: saved.status }
    });
    revalidateNotices(saved.id);

    return { flowUpdatedAt, id: saved.id, status: saved.status, updatedAt: saved.updated_at };
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
        metadata: { kind: row.kind, sender_user_id: row.sender_user_id }
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
        situation: published.situation
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
        situation: published.situation
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
    loaded = await loadFactsFor(db, now, audienceOfRow(row));

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

/**
 * [messaging.publish] Retira a notificacao enviada: some do sino dos alunos (fica como cancelada). v2: as
 * seguintes deixam de sair (o fluxo do aviso termina, source_withdrawn) e, com `alsoFollowUps` (padrao),
 * as que ja sairam tambem somem do sino.
 */
export async function withdrawNotice(input: WithdrawNoticeInput): Promise<ActionResult<NoticeStateChange & { removed: number }>> {
  return runAdminAction("messaging.publish", withdrawNoticeSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const now = new Date();
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
    // As seguintes param antes de qualquer linha sair: pendentes e reservadas canceladas (7.13).
    const flow = await moveNoticeFlow(db, row.id, { actorId: user.id, from: ["active", "paused"], now, reason: "source_withdrawn", to: "ended" });
    let followUpsRemoved = 0;

    if (flow && data.alsoFollowUps) {
      const canceled = await db.from("campaigns").update({ status: "canceled", updated_by: user.id }).eq("flow_id", flow.id).in("status", ["draft", "sent"]);
      assertNoDbError(canceled.error, "Comunicacao: retirar as seguintes");

      const deleted = await db.from("notifications").delete({ count: "exact" }).eq("flow_id", flow.id).eq("is_test", false);
      assertNoDbError(deleted.error, "Comunicacao: tirar as seguintes do sino");
      followUpsRemoved = deleted.count ?? 0;
    }

    const removed = await deleteCampaignNotifications(db, row.id);

    if (flow) {
      invalidateLivePopups({ from: "action" });
    }

    await recordAudit(db, {
      action: "communication.withdrawn",
      actorId: user.id,
      count: removed,
      entityId: row.id,
      entityType: "campaign",
      metadata: { also_follow_ups: Boolean(flow) && data.alsoFollowUps, follow_ups_removed: followUpsRemoved, kind: row.kind }
    });
    revalidateNotices(row.id);

    return { ...stateChange(updated, now.getTime()), removed };
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
    const draft = rowToDraft(row);

    if (draft.schedule.mode === "at" && Date.parse(draft.schedule.sendAt) <= now) {
      draft.schedule = { mode: "now" };
    }

    if (draft.window.endsAt && Date.parse(draft.window.endsAt) <= now) {
      draft.window = { endsAt: null, startsAt: null };
    }

    if (draft.validity.mode === "until" && !(Date.parse(draft.validity.endsAt) > now + HOUR_MS)) {
      draft.validity = { mode: "default" };
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

    // v2: as seguintes saem junto (no ar ou pausado, encerradas antes: source_deleted).
    const flow = row.kind === "inbox" ? await noticeFlowRow(db, row.id) : null;

    if (flow) {
      await removeNoticeFlow(db, flow, { actorId: user.id, now, reason: "source_deleted" });
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

    if (sent && !canPublishTo(access, noticeRecipientsOf(notice))) {
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
      flow = await changeFlowState(db, { actorId: user.id, entryCount: noticeRecipientsOf(notice), expectedUpdatedAt: flow.updated_at, flowId: flow.id, now, to: "active" });
    }

    invalidateLivePopups({ from: "action" });

    // No ar, quem passou a enviar agora recebe o e-mail "enviada em seu nome" (uma vez por fluxo).
    const newSenders = sent ? saved.senderIds.filter((id) => !previousSenders.has(id)) : [];

    if (newSenders.length > 0) {
      await notifySendersOnBehalf(db, { actorId: user.id, count: noticeRecipientsOf(notice), flowId: flow.id, senders: newSenders, title: flow.name }).catch((error: unknown) =>
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
