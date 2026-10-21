"use server";

// Server Actions de Comunicacao > Fluxos (docs/23 §2.5 a §2.9 e §6.2). Toda acao passa por runAdminAction
// (permissao + zod + ActionResult), confere a versao lida pela tela (updated_at -> 409) e grava na
// auditoria (admin_audit_log, so ids e contagens). Gravar a arvore e sempre saveFlowTree (flow-store.ts:
// versoes do conteudo, depois o RPC 7.5); a situacao, sempre o RPC 7.13; retirar um passo, o 7.14.
// Permissoes:
// - messaging.write: salvar rascunho, pedir ativacao, duplicar, excluir, teste para mim;
// - messaging.publish: ativar ate 500 alunos, pausar, retomar, encerrar, aplicar alteracoes num fluxo no
//   ar ate 500, retirar um passo do sino;
// - messaging.publish_large: ativar, retomar ou aplicar alteracoes acima de 500; aprovar ou recusar.
// A contagem e sempre a do segmento de entrada agora (em todos os modos; "so quem entrar a partir de agora"
// conta a populacao de hoje); no fluxo de um aviso, quem recebeu o aviso. Alteracao no ar nunca vira pedido
// de aprovacao (403). Depois de toda escrita, invalidateLivePopups: a tag "communications" tambem guarda as
// paginas acompanhadas pelos fluxos no ar.

import { revalidatePath } from "next/cache";
import { FLOWS_HREF, noticeOriginBanner, PUBLISH_ONLY_NOTE } from "@/components/admin/v2/communication/flows/flows-view-model";
import type { ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { recordAudit } from "@/server/audit/log";
import { can, type AdminAccess } from "@/server/auth/roles";
import { resolveAudienceUserIds } from "./audience";
import { loadAudienceFacts } from "./audience-facts";
import {
  collectMessageCampaignIds,
  EVERYONE,
  isAudienceGroup,
  normalizeAudience,
  type AudienceDefinition,
  type AudienceNode,
  type AudienceRule
} from "./audience-model";
import { invalidateLivePopups } from "./cache";
import { isSameVersion, publishDecision } from "./campaign-model";
import { assertNoDbError, communicationsDb, CommunicationError, describeError, NoticeFieldError, type CommunicationsDb } from "./db";
import { FLOW_LIMITS, validateFlowGoal, validateFlowTree, type FlowMessageMeta, type FlowStatus } from "./flow-model";
import { flowContentOfRow, flowDraftOf } from "./flow-queries";
import {
  flowIdInputSchema,
  flowMessageTestSchema,
  flowStateSchema,
  flowTreeOfDraft,
  saveFlowSchema,
  withdrawFlowMessageSchema,
  type FlowDraft,
  type FlowIdInput,
  type FlowMessageTestInput,
  type FlowNodeDraft,
  type FlowNoticeContent,
  type FlowStateInput,
  type SaveFlowInput,
  type WithdrawFlowMessageInput
} from "./flow-schemas";
import {
  changeFlowState,
  definitionOf,
  fetchFlowNodes,
  fetchFlowTree,
  FLOW_CHANGED_MESSAGE,
  FLOW_MISSING_MESSAGE,
  messageMetaOfRow,
  saveFlowTree,
  withdrawFlowStep,
  type FlowRow,
  type LoadedFlowTree
} from "./flow-store";
import { notifySendersOnBehalf } from "./sender-notices";
import { fetchCampaignsByIds, upsertTestNotification, type CampaignRow } from "./store";

const EMPTY_AUDIENCE = "Nenhum aluno está neste segmento agora.";
const LIVE_EDIT_NEEDS_APPROVAL = "Para mudar um fluxo ativo para este segmento, peça a um dono ou administrador.";
const RESUME_NEEDS_APPROVAL = "Este fluxo passou de 500 alunos. Para retomar, peça a um dono ou administrador.";
const TOO_MANY_ACTIVE = `Já há ${FLOW_LIMITS.activeFlows} fluxos ativos. Encerre um antes de ativar outro.`;
const END_BEFORE_DELETE = "Encerre o fluxo antes de excluir.";
const NOTICE_FLOW_OWNED = "Este fluxo é da notificação: duplique ou exclua a notificação.";
const SENDER_NOT_ON_TEAM = "Escolha alguém da equipe.";
/** As mesmas frases de saveNoticeFollowUps (actions.ts). */
const NOTICE_SAVE_FIRST = "Salve a notificação antes de mudar as notificações seguintes.";
const NOTICE_WITHDRAWN = "Esta notificação foi retirada do sino.";
const NAME_MAX = 80;
const COPY_SUFFIX = " (cópia)";
const HOUR_MS = 3_600_000;

export type SavedFlow = { id: string; nodeIds: Record<string, string>; status: FlowStatus; updatedAt: string };
export type FlowStateResult = { entryCount: number | null; id: string; situation: FlowStatus; updatedAt: string };

/* ------------------------------------------------------------------------------------------------
 * Apoio
 * ---------------------------------------------------------------------------------------------- */

function revalidateFlows(id?: string) {
  revalidatePath(FLOWS_HREF);

  if (id) {
    revalidatePath(`${FLOWS_HREF}/${id}`);
  }
}

function isLive(status: FlowStatus) {
  return status === "active" || status === "paused";
}

async function requireFlow(db: CommunicationsDb, id: string): Promise<LoadedFlowTree> {
  const loaded = await fetchFlowTree(db, id);

  if (!loaded) {
    throw new CommunicationError(FLOW_MISSING_MESSAGE, 404);
  }

  return loaded;
}

/** A tela leu outra versao do fluxo do que esta no banco agora: 409 antes de contar ou gravar. */
function assertSameVersion(flow: FlowRow, expectedUpdatedAt: string | undefined) {
  if (expectedUpdatedAt && !isSameVersion(expectedUpdatedAt, flow.updated_at)) {
    throw new CommunicationError(FLOW_CHANGED_MESSAGE, 409);
  }
}

function canPublishTo(access: AdminAccess, audienceCount: number) {
  return (
    publishDecision({ audienceCount, canPublish: can(access, "messaging.publish"), canPublishLarge: can(access, "messaging.publish_large") }) === "publish"
  );
}

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

function entryAudienceOf(flow: Pick<FlowRow, "entry_audience">) {
  return definitionOf(flow.entry_audience) ?? EVERYONE;
}

/** Quantos estao no segmento de entrada agora (com as linhas dos avisos citados por "o que fez com"). */
async function countEntry(db: CommunicationsDb, now: Date, audience: AudienceDefinition) {
  const loaded = await loadAudienceFacts(db, now, { messageCampaignIds: collectMessageCampaignIds(audience) });

  return resolveAudienceUserIds(audience, loaded).length;
}

/**
 * Fluxo de aviso: a contagem e a do aviso (a aprovacao do aviso cobre as seguintes). O maior dos dois: num
 * envio cortado pelo orcamento do tick (ainda "sending"), recipients_count e so o parcial.
 */
async function noticeRecipients(db: CommunicationsDb, flow: FlowRow) {
  if (!flow.source_campaign_id) {
    return 0;
  }

  const [row] = await fetchCampaignsByIds(db, [flow.source_campaign_id]);

  return Math.max(row?.recipients_count ?? 0, row?.audience_count ?? 0);
}

/**
 * O aviso de origem de um fluxo de aviso. Antes do envio (agendado ou aguardando aprovacao) as seguintes
 * so mudam pela notificacao (docs/23 §2.2: o editor salva o aviso, que volta a rascunho junto com o
 * fluxo, e a aprovacao cobre o que foi revisado): nada de gravar, pausar, retomar ou encerrar por aqui.
 */
async function noticeSourceOf(db: CommunicationsDb, flow: FlowRow) {
  const [source] = flow.source_campaign_id ? await fetchCampaignsByIds(db, [flow.source_campaign_id]) : [];

  return source && !source.deleted_at ? source : null;
}

/** Contagem para o limite de 500: entrada agora (construtor) ou quem recebeu o aviso. */
function countForApproval(db: CommunicationsDb, now: Date, flow: FlowRow) {
  return flow.origin === "notice" ? noticeRecipients(db, flow) : countEntry(db, now, entryAudienceOf(flow));
}

/** Quem esta na equipe agora (admin_roles) e o nome de cada um, para as mensagens. */
async function teamStates(db: CommunicationsDb, userIds: readonly string[]) {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  const states = new Map<string, { name: string | null; onTeam: boolean }>();

  if (ids.length === 0) {
    return states;
  }

  const [roles, profiles] = await Promise.all([
    db.from("admin_roles").select("user_id").in("user_id", ids),
    db.from("profiles").select("id,full_name").in("id", ids)
  ]);
  assertNoDbError(roles.error, "Comunicacao: equipe de quem envia");
  assertNoDbError(profiles.error, "Comunicacao: nomes de quem envia");

  const team = new Set(((roles.data ?? []) as { user_id: string }[]).map((row) => row.user_id));
  const names = new Map(((profiles.data ?? []) as { full_name: string | null; id: string }[]).map((row) => [row.id, row.full_name?.trim() || null]));

  for (const id of ids) {
    states.set(id, { name: names.get(id) ?? null, onTeam: team.has(id) });
  }

  return states;
}

/** Salvar: so pessoas da equipe enviam em nome da escola (400 no campo "Quem envia" do passo). */
async function assertSendersForSave(db: CommunicationsDb, draft: FlowDraft) {
  const senders = Object.entries(draft.messages).flatMap(([nodeId, content]) => (content.sender ? [[nodeId, content.sender.userId] as const] : []));
  const states = await teamStates(
    db,
    senders.map(([, userId]) => userId)
  );

  for (const [nodeId, userId] of senders) {
    if (!states.get(userId)?.onTeam) {
      throw new NoticeFieldError(`flow.messages.${nodeId}.sender`, SENDER_NOT_ON_TEAM);
    }
  }
}

/** Conteudo atual (a versao de cada passo de notificacao) de uma arvore gravada. */
async function currentVersions(db: CommunicationsDb, loaded: LoadedFlowTree) {
  const rows = await fetchCampaignsByIds(
    db,
    loaded.tree.nodes.filter((node) => node.kind === "message" && node.campaignId).map((node) => node.campaignId as string)
  );

  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Antes de ativar ou aprovar: a arvore e o objetivo pela mesma regra do construtor (o que bloqueia gravar
 * e o que bloqueia ativar, como "Escolha o produto."), e quem envia continua na equipe.
 */
async function assertActivatable(db: CommunicationsDb, loaded: LoadedFlowTree, campaigns: ReadonlyMap<string, CampaignRow>) {
  const metas: Record<string, FlowMessageMeta> = {};

  for (const node of loaded.tree.nodes) {
    const row = node.campaignId ? campaigns.get(node.campaignId) : undefined;

    if (node.kind === "message" && row) {
      metas[node.id] = messageMetaOfRow(row);
    }
  }

  const problem = [...validateFlowTree(loaded.tree, metas), ...validateFlowGoal(loaded.tree, definitionOf(loaded.flow.goal), metas)].find(
    (issue) => issue.level === "save" || issue.level === "activation"
  );

  if (problem) {
    throw new CommunicationError(problem.message, 422);
  }

  const senderIds = Array.from(campaigns.values(), (row) => row.sender_user_id).filter((id): id is string => Boolean(id));
  const states = await teamStates(db, senderIds);

  for (const id of senderIds) {
    const state = states.get(id);

    if (!state?.onTeam) {
      throw new CommunicationError(`${state?.name ?? "A pessoa escolhida"} não está mais na equipe. Escolha quem envia.`, 422);
    }
  }

  return senderIds;
}

/** No maximo 20 fluxos do construtor no ar (ativos ou pausados) ao mesmo tempo; os de aviso nao contam. */
async function assertActiveLimit(db: CommunicationsDb, flowId: string) {
  const { count, error } = await db
    .from("communication_flows")
    .select("id", { count: "exact", head: true })
    .eq("origin", "builder")
    .in("status", ["active", "paused"])
    .is("deleted_at", null)
    .neq("id", flowId);
  assertNoDbError(error, "Comunicacao: fluxos ativos");

  if ((count ?? 0) >= FLOW_LIMITS.activeFlows) {
    throw new CommunicationError(TOO_MANY_ACTIVE, 422);
  }
}

/** "Enviada em seu nome": o e-mail para cada pessoa da equipe usada como "Quem envia", uma vez por fluxo. */
async function notifyFlowSenders(db: CommunicationsDb, flow: FlowRow, senders: readonly string[], actorId: string, count: number) {
  // Melhor esforco: o fluxo ja esta no ar; uma falha aqui so vai para o log.
  await notifySendersOnBehalf(db, { actorId, count, flowId: flow.id, senders, title: flow.name }).catch((error: unknown) =>
    console.error(`[comunicacao] "enviada em seu nome" do fluxo ${flow.id} nao agendado: ${describeError(error)}`)
  );
}

/**
 * Ativar (ou aprovar, `approved`): confere a arvore, quem envia, o limite de 20 fluxos e quem entra agora;
 * depois o RPC 7.13 deixa o conteudo "sent" e o fluxo no ar na mesma transacao. Sem permissao para ativar
 * para essa contagem, o fluxo fica "Aguardando aprovação" (so quando nao e uma aprovacao).
 */
async function goLive(input: { access: AdminAccess; actorId: string; approved: boolean; db: CommunicationsDb; loaded: LoadedFlowTree; now: Date }) {
  const { db, loaded, now } = input;
  const flow = loaded.flow;
  const campaigns = await currentVersions(db, loaded);
  const senders = await assertActivatable(db, loaded, campaigns);
  const audience = entryAudienceOf(flow);
  const count = await countEntry(db, now, audience);

  if (flow.entry_mode === "current" && count === 0) {
    throw new CommunicationError(EMPTY_AUDIENCE, 422);
  }

  if (!input.approved && !canPublishTo(input.access, count)) {
    const pending = await changeFlowState(db, { actorId: input.actorId, entryCount: count, expectedUpdatedAt: flow.updated_at, flowId: flow.id, now, to: "pending_approval" });

    await recordAudit(db, {
      action: "communication.flow_approval_requested",
      actorId: input.actorId,
      count,
      entityId: flow.id,
      entityType: "communication_flow",
      metadata: { entry_mode: flow.entry_mode, sender_user_ids: senders }
    });

    return { count, flow: pending, senders };
  }

  await assertActiveLimit(db, flow.id);

  const active = await changeFlowState(db, {
    actorId: input.actorId,
    entryCount: count,
    expectedUpdatedAt: flow.updated_at,
    flowId: flow.id,
    now,
    reason: input.approved ? "approved" : null,
    to: "active"
  });

  invalidateLivePopups({ from: "action" });
  await notifyFlowSenders(db, active, senders, input.actorId, count);

  return { count, flow: active, senders };
}

/* ------------------------------------------------------------------------------------------------
 * Gravar
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.write] Cria ou grava o fluxo (a arvore inteira, na versao lida). Num fluxo no ar ou pausado
 * isto e "Aplicar alterações": vale como publicar (messaging.publish e, acima de 500 alunos, recontados se
 * "Quem entra" mudou, messaging.publish_large; senao 403, nunca pedido de aprovacao). Aguardando
 * aprovacao: gravar uma mudanca volta a rascunho e cancela o pedido (como o aviso).
 */
export async function saveFlow(input: SaveFlowInput): Promise<ActionResult<SavedFlow>> {
  return runAdminAction("messaging.write", saveFlowSchema, input, async ({ access, input: data, user }) => {
    const db = communicationsDb();
    const now = new Date();
    const draft = data.flow;
    const existing = data.id ? await requireFlow(db, data.id) : null;

    if (!existing && draft.origin !== "builder") {
      throw new CommunicationError("As notificações seguintes são criadas na própria notificação.", 422);
    }

    if (existing) {
      assertSameVersion(existing.flow, data.expectedUpdatedAt);
    }

    // Fluxo de aviso: so com a notificacao em rascunho (antes do envio) ou depois que ela saiu. Agendada ou
    // aguardando aprovacao, gravar aqui mudaria o que foi agendado ou revisado sem voltar o aviso a rascunho.
    if (existing?.flow.origin === "notice") {
      const source = await noticeSourceOf(db, existing.flow);

      if (!source || source.status === "canceled") {
        throw new CommunicationError(NOTICE_WITHDRAWN, 409);
      }

      if (!["draft", "sending", "sent"].includes(source.status)) {
        throw new CommunicationError(NOTICE_SAVE_FIRST, 409);
      }
    }

    await assertSendersForSave(db, draft);

    const live = existing ? isLive(existing.flow.status) : false;
    let liveCount = 0;

    if (existing && live) {
      if (!can(access, "messaging.publish")) {
        throw new CommunicationError(PUBLISH_ONLY_NOTE, 403);
      }

      const flow = existing.flow;
      const entryChanged = flow.origin === "builder" && stableJson(normalizeAudience(entryAudienceOf(flow))) !== stableJson(normalizeAudience(draft.entry.audience));
      liveCount = flow.origin === "notice" ? await noticeRecipients(db, flow) : entryChanged ? await countEntry(db, now, draft.entry.audience) : (flow.entry_count ?? 0);

      if (!canPublishTo(access, liveCount)) {
        throw new CommunicationError(LIVE_EDIT_NEEDS_APPROVAL, 403);
      }
    }

    const removedNodes = existing ? existing.nodes.filter((row) => !draft.nodes.some((node) => node.id === row.id)).length : 0;
    const result = await saveFlowTree(db, {
      actorId: user.id,
      contents: draft.messages,
      expectedUpdatedAt: existing ? (data.expectedUpdatedAt ?? existing.flow.updated_at) : null,
      flow: { entryAudience: draft.entry.audience, entryMode: draft.entry.mode, goal: draft.goal, name: draft.name, origin: existing?.flow.origin ?? "builder" },
      flowId: existing?.flow.id ?? null,
      now,
      tree: flowTreeOfDraft(draft).tree
    });
    let saved = result.flow;

    if (saved.status === "pending_approval") {
      saved = await changeFlowState(db, { actorId: user.id, expectedUpdatedAt: saved.updated_at, flowId: saved.id, now, to: "draft" });
    }

    invalidateLivePopups({ from: "action" });

    if (live) {
      await recordAudit(db, {
        action: "communication.flow_changes_applied",
        actorId: user.id,
        count: liveCount,
        entityId: saved.id,
        entityType: "communication_flow",
        metadata: { new_versions: result.newVersions.length, removed_nodes: removedNodes, revision: saved.revision, sender_user_ids: result.senderIds }
      });
      // Pessoa nova em "Quem envia" num fluxo no ar: o e-mail (a chave por fluxo e pessoa nao repete).
      await notifyFlowSenders(db, saved, result.senderIds, user.id, liveCount);
    } else {
      await recordAudit(db, {
        action: "communication.flow_saved",
        actorId: user.id,
        entityId: saved.id,
        entityType: "communication_flow",
        metadata: { created: !existing, origin: saved.origin, revision: saved.revision, sender_user_ids: result.senderIds, status: saved.status }
      });
    }

    revalidateFlows(saved.id);

    return { id: saved.id, nodeIds: result.nodeIds, status: saved.status, updatedAt: saved.updated_at };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Ativar, aprovar, pausar, retomar, encerrar
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.write] "Ativar fluxo" ou "Enviar para aprovação" (publishDecision com quem entra agora).
 * O fluxo de um aviso nao se ativa por aqui: ele comeca quando a notificacao sai.
 */
export async function activateFlow(input: FlowStateInput): Promise<ActionResult<FlowStateResult>> {
  return runAdminAction("messaging.write", flowStateSchema, input, async ({ access, input: data, user }) => {
    const db = communicationsDb();
    const now = new Date();
    const loaded = await requireFlow(db, data.id);
    const flow = loaded.flow;

    if (flow.origin === "notice") {
      const [source] = flow.source_campaign_id ? await fetchCampaignsByIds(db, [flow.source_campaign_id]) : [];
      throw new CommunicationError(noticeOriginBanner(source?.title ?? ""), 409);
    }

    if (flow.status !== "draft") {
      throw new CommunicationError(flow.status === "pending_approval" ? "Este fluxo já está aguardando aprovação." : FLOW_CHANGED_MESSAGE, 409);
    }

    assertSameVersion(flow, data.expectedUpdatedAt);

    const result = await goLive({ access, actorId: user.id, approved: false, db, loaded, now });

    if (result.flow.status === "active") {
      await recordAudit(db, {
        action: "communication.flow_activated",
        actorId: user.id,
        count: result.count,
        entityId: flow.id,
        entityType: "communication_flow",
        metadata: { entry_mode: flow.entry_mode, sender_user_ids: result.senders }
      });
    }

    revalidateFlows(flow.id);

    return { entryCount: result.count, id: flow.id, situation: result.flow.status, updatedAt: result.flow.updated_at };
  });
}

/** [messaging.publish_large] Aprova o pedido: ativa como se quem aprova tivesse ativado, recontando quem entra. */
export async function approveFlow(input: FlowStateInput): Promise<ActionResult<FlowStateResult>> {
  return runAdminAction("messaging.publish_large", flowStateSchema, input, async ({ access, input: data, user }) => {
    const db = communicationsDb();
    const now = new Date();
    const loaded = await requireFlow(db, data.id);
    const flow = loaded.flow;

    if (flow.status !== "pending_approval") {
      throw new CommunicationError("Este fluxo não está aguardando aprovação.", 409);
    }

    assertSameVersion(flow, data.expectedUpdatedAt);

    const result = await goLive({ access, actorId: user.id, approved: true, db, loaded, now });

    await recordAudit(db, {
      action: "communication.flow_approved",
      actorId: user.id,
      count: result.count,
      entityId: flow.id,
      entityType: "communication_flow",
      metadata: { requested_by: flow.requested_by, sender_user_ids: result.senders }
    });
    revalidateFlows(flow.id);

    return { entryCount: result.count, id: flow.id, situation: result.flow.status, updatedAt: result.flow.updated_at };
  });
}

/** [messaging.publish_large] Devolve o pedido: o fluxo volta a rascunho. */
export async function rejectFlow(input: FlowStateInput): Promise<ActionResult<FlowStateResult>> {
  return runAdminAction("messaging.publish_large", flowStateSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const loaded = await requireFlow(db, data.id);
    const flow = loaded.flow;

    if (flow.status !== "pending_approval") {
      throw new CommunicationError("Este fluxo não está aguardando aprovação.", 409);
    }

    assertSameVersion(flow, data.expectedUpdatedAt);

    const draft = await changeFlowState(db, { actorId: user.id, expectedUpdatedAt: flow.updated_at, flowId: flow.id, now: new Date(), to: "draft" });

    await recordAudit(db, { action: "communication.flow_rejected", actorId: user.id, entityId: flow.id, entityType: "communication_flow", metadata: { requested_by: flow.requested_by } });
    revalidateFlows(flow.id);

    return { entryCount: draft.entry_count, id: flow.id, situation: draft.status, updatedAt: draft.updated_at };
  });
}

/** Pausar, retomar e encerrar pelo RPC 7.13, na versao lida (espera o lote do motor que esta aplicando). */
async function changeLiveState(input: {
  access: AdminAccess;
  actorId: string;
  audit: "communication.flow_ended" | "communication.flow_paused" | "communication.flow_resumed";
  expectedUpdatedAt: string;
  from: readonly FlowStatus[];
  id: string;
  to: "active" | "ended" | "paused";
}): Promise<FlowStateResult> {
  const db = communicationsDb();
  const now = new Date();
  const loaded = await requireFlow(db, input.id);
  const flow = loaded.flow;

  if (!input.from.includes(flow.status)) {
    throw new CommunicationError(FLOW_CHANGED_MESSAGE, 409);
  }

  assertSameVersion(flow, input.expectedUpdatedAt);

  // Fluxo de aviso antes de a notificacao sair: ele segue a notificacao (cancelar o agendamento, recusar ou
  // salvar o aviso o voltam a rascunho). Pausar ou encerrar aqui deixaria os dois fora de sincronia.
  if (flow.origin === "notice") {
    const source = await noticeSourceOf(db, flow);

    if (!source || (source.status !== "sending" && source.status !== "sent")) {
      throw new CommunicationError(noticeOriginBanner(source?.title ?? ""), 409);
    }
  }

  let count: number | null = null;

  // Retomar acima de 500 so com messaging.publish_large (sem pedido de aprovacao; C13).
  if (input.to === "active") {
    count = await countForApproval(db, now, flow);

    if (!canPublishTo(input.access, count)) {
      throw new CommunicationError(RESUME_NEEDS_APPROVAL, 403);
    }
  }

  const changed = await changeFlowState(db, {
    actorId: input.actorId,
    entryCount: input.to === "active" && flow.origin === "builder" ? count : null,
    expectedUpdatedAt: flow.updated_at,
    flowId: flow.id,
    now,
    reason: input.to === "ended" ? "team" : null,
    to: input.to
  });

  invalidateLivePopups({ from: "action" });
  await recordAudit(db, { action: input.audit, actorId: input.actorId, count, entityId: flow.id, entityType: "communication_flow", metadata: { origin: flow.origin } });
  revalidateFlows(flow.id);

  return { entryCount: changed.entry_count, id: flow.id, situation: changed.status, updatedAt: changed.updated_at };
}

/** [messaging.publish] Pausa: ninguem entra e nada sai; as esperas continuam contando. */
export async function pauseFlow(input: FlowStateInput): Promise<ActionResult<FlowStateResult>> {
  return runAdminAction("messaging.publish", flowStateSchema, input, ({ access, input: data, user }) =>
    changeLiveState({ access, actorId: user.id, audit: "communication.flow_paused", expectedUpdatedAt: data.expectedUpdatedAt, from: ["active"], id: data.id, to: "paused" })
  );
}

/** [messaging.publish] Retoma (acima de 500 alunos agora, messaging.publish_large). */
export async function resumeFlow(input: FlowStateInput): Promise<ActionResult<FlowStateResult>> {
  return runAdminAction("messaging.publish", flowStateSchema, input, ({ access, input: data, user }) =>
    changeLiveState({ access, actorId: user.id, audit: "communication.flow_resumed", expectedUpdatedAt: data.expectedUpdatedAt, from: ["paused"], id: data.id, to: "active" })
  );
}

/** [messaging.publish] Encerra de vez: pendentes e reservadas canceladas, passagens encerradas. */
export async function endFlow(input: FlowStateInput): Promise<ActionResult<FlowStateResult>> {
  return runAdminAction("messaging.publish", flowStateSchema, input, ({ access, input: data, user }) =>
    changeLiveState({ access, actorId: user.id, audit: "communication.flow_ended", expectedUpdatedAt: data.expectedUpdatedAt, from: ["active", "paused"], id: data.id, to: "ended" })
  );
}

/* ------------------------------------------------------------------------------------------------
 * Duplicar e excluir
 * ---------------------------------------------------------------------------------------------- */

function remapRule(rule: AudienceRule, ids: ReadonlyMap<string, string>): AudienceRule {
  const mapId = (id: string) => ids.get(id) ?? id;

  switch (rule.type) {
    case "message":
      return rule.ref.kind === "node" ? { ...rule, ref: { kind: "node", nodeId: mapId(rule.ref.nodeId) } } : rule;
    case "page_visit":
      return {
        ...rule,
        page: rule.page.kind === "message_cta" ? { kind: "message_cta", nodeId: mapId(rule.page.nodeId) } : rule.page,
        since: rule.since.kind === "message" ? { kind: "message", nodeId: mapId(rule.since.nodeId) } : rule.since
      };
    case "access_gained":
      return { ...rule, since: rule.since.kind === "message" ? { kind: "message", nodeId: mapId(rule.since.nodeId) } : rule.since };
    default:
      return rule;
  }
}

function remapNode(node: AudienceNode, ids: ReadonlyMap<string, string>): AudienceNode {
  return isAudienceGroup(node) ? { ...node, items: node.items.map((item) => remapNode(item, ids)) } : remapRule(node, ids);
}

function remapDefinition<T extends AudienceDefinition | null>(definition: T, ids: ReadonlyMap<string, string>): T {
  return (definition && definition.kind === "rules" ? { ...definition, root: remapNode(definition.root, ids) } : definition) as T;
}

/**
 * A copia do rascunho: passos com ids novos, referencias de regras e de tempo remapeadas. Como no aviso,
 * "fica no sino ate uma data" que ja passou (ou a menos de 1 hora) volta para os 90 dias.
 */
function copyOfDraft(draft: FlowDraft, now: number): FlowDraft {
  const ids = new Map(draft.nodes.map((node) => [node.id, crypto.randomUUID()]));
  const mapId = (id: string | null) => (id ? (ids.get(id) ?? id) : null);
  const nodes = draft.nodes.map((node): FlowNodeDraft => {
    if (node.kind === "entry") {
      return { ...node, id: mapId(node.id) as string };
    }

    if (node.kind === "message") {
      return { ...node, anchorNodeId: mapId(node.anchorNodeId), filter: remapDefinition(node.filter, ids), id: mapId(node.id) as string, parentId: mapId(node.parentId) };
    }

    return { ...node, anchorNodeId: mapId(node.anchorNodeId), condition: remapDefinition(node.condition, ids), id: mapId(node.id) as string, parentId: mapId(node.parentId) };
  });
  const messages: Record<string, FlowNoticeContent> = {};

  for (const [nodeId, content] of Object.entries(draft.messages)) {
    const validity = content.validity.mode === "until" && !(Date.parse(content.validity.endsAt) > now + HOUR_MS) ? ({ mode: "default" } as const) : content.validity;
    messages[mapId(nodeId) as string] = { ...content, validity };
  }

  const name = draft.name.trim().slice(0, NAME_MAX - COPY_SUFFIX.length).trimEnd();

  return { ...draft, goal: remapDefinition(draft.goal, ids), messages, name: `${name}${COPY_SUFFIX}`, nodes };
}

/** [messaging.write] Novo rascunho "{nome} (cópia)" com os mesmos passos e conteudos (cada um com versao nova). */
export async function duplicateFlow(input: FlowIdInput): Promise<ActionResult<{ id: string; updatedAt: string }>> {
  return runAdminAction("messaging.write", flowIdInputSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const now = new Date();
    const loaded = await requireFlow(db, data.id);

    if (loaded.flow.origin === "notice") {
      throw new CommunicationError(NOTICE_FLOW_OWNED, 409);
    }

    const campaigns = await currentVersions(db, loaded);
    const copy = copyOfDraft(flowDraftOf(loaded.flow, loaded.nodes, campaigns).draft, now.getTime());
    const result = await saveFlowTree(db, {
      actorId: user.id,
      contents: copy.messages,
      flow: { entryAudience: copy.entry.audience, entryMode: copy.entry.mode, goal: copy.goal, name: copy.name, origin: "builder" },
      now,
      tree: flowTreeOfDraft(copy).tree
    });

    invalidateLivePopups({ from: "action" });
    await recordAudit(db, {
      action: "communication.flow_duplicated",
      actorId: user.id,
      entityId: result.flow.id,
      entityType: "communication_flow",
      metadata: { source_id: loaded.flow.id }
    });
    revalidateFlows();

    return { id: result.flow.id, updatedAt: result.flow.updated_at };
  });
}

/** [messaging.write] Exclui (some da lista): rascunho, aguardando aprovacao, encerrado ou concluido. */
export async function deleteFlow(input: FlowIdInput): Promise<ActionResult<{ id: string }>> {
  return runAdminAction("messaging.write", flowIdInputSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const loaded = await requireFlow(db, data.id);
    const flow = loaded.flow;

    if (flow.origin === "notice") {
      throw new CommunicationError(NOTICE_FLOW_OWNED, 409);
    }

    if (isLive(flow.status)) {
      throw new CommunicationError(END_BEFORE_DELETE, 409);
    }

    assertSameVersion(flow, data.expectedUpdatedAt);

    let query = db
      .from("communication_flows")
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id, updated_by: user.id })
      .eq("id", flow.id)
      .eq("status", flow.status)
      .is("deleted_at", null);

    if (data.expectedUpdatedAt) {
      query = query.eq("updated_at", flow.updated_at);
    }

    const { data: rows, error } = await query.select("id");
    assertNoDbError(error, "Comunicacao: excluir fluxo");

    if ((rows ?? []).length === 0) {
      throw new CommunicationError(FLOW_CHANGED_MESSAGE, 409);
    }

    invalidateLivePopups({ from: "action" });
    await recordAudit(db, { action: "communication.flow_deleted", actorId: user.id, entityId: flow.id, entityType: "communication_flow", metadata: { status: flow.status } });
    revalidateFlows();

    return { id: flow.id };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Retirar um passo do sino e teste para mim
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.publish] Retira um passo de notificacao do sino: o RPC 7.14 (fluxo travado) cancela todas as
 * versoes e quem esperava por ele e pelo que esta abaixo; depois as linhas saem do sino (como o
 * withdrawNotice da v1). Os testes da equipe ficam.
 */
export async function withdrawFlowMessage(input: WithdrawFlowMessageInput): Promise<ActionResult<{ removed: number }>> {
  return runAdminAction("messaging.publish", withdrawFlowMessageSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const now = new Date();

    await withdrawFlowStep(db, { actorId: user.id, expectedUpdatedAt: data.expectedUpdatedAt, flowId: data.id, nodeId: data.nodeId, now });

    const { count, error } = await db.from("notifications").delete({ count: "exact" }).eq("flow_node_id", data.nodeId).eq("is_test", false);
    assertNoDbError(error, "Comunicacao: retirar notificacoes do passo");

    const removed = count ?? 0;

    invalidateLivePopups({ from: "action" });
    await recordAudit(db, { action: "communication.flow_step_withdrawn", actorId: user.id, count: removed, entityId: data.id, entityType: "communication_flow", metadata: { node_id: data.nodeId } });
    revalidateFlows(data.id);

    return { removed };
  });
}

/**
 * [messaging.write] Manda a versao atual do passo para o sino de quem pediu, como teste (nao conta nos
 * numeros e nao muda o fluxo). Repetir traz o teste de volta como novo; fica pelo menos 1 hora no sino.
 */
export async function sendFlowMessageTest(input: FlowMessageTestInput): Promise<ActionResult<{ sent: true }>> {
  return runAdminAction("messaging.write", flowMessageTestSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const rows = await fetchFlowNodes(db, [data.id]);
    const node = rows.find((row) => row.id === data.nodeId && row.kind === "message");
    const [campaign] = node?.campaign_id ? await fetchCampaignsByIds(db, [node.campaign_id]) : [];

    if (!node || !campaign || campaign.flow_id !== data.id || campaign.deleted_at) {
      throw new CommunicationError("Passo não encontrado.", 404);
    }

    // "Até a notificação principal sumir" nao tem a principal no teste: valem os 90 dias da versao.
    const content = flowContentOfRow(campaign, false);
    await upsertTestNotification(db, campaign, user.id, Date.now());

    await recordAudit(db, {
      action: "communication.test_sent",
      actorId: user.id,
      entityId: campaign.id,
      entityType: "campaign",
      metadata: { flow_id: data.id, kind: "inbox", node_id: node.id, sender_user_id: content.sender?.userId ?? null }
    });

    return { sent: true as const };
  });
}
