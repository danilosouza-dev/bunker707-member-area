// Comunicacao > Fluxos no admin (docs/23 §2.4 a §2.10): enderecos e filtros da lista, situacao de cada
// fluxo e as acoes que ela permite, as frases do construtor (quem entra, quando, cartoes, revisao, limites),
// a arvore editada no navegador (inserir e remover passos, manter um caminho da condicao), os textos das
// confirmacoes e dos toasts e os numeros do relatorio. Modulo puro (sem React, imports relativos, sem
// enums): tests/comunicacao-fluxos-tela.test.mjs carrega direto pelo Node e as telas usam as mesmas regras.

import {
  describeAudience,
  isAudienceGroup,
  messageRefKey,
  normalizeAudience,
  type AudienceDefinition,
  type AudienceNames,
  type AudienceNode,
  type AudienceRule
} from "../../../../../server/communications/audience-model";
import { publishDecision, type CampaignStatus, type NoticePermissions } from "../../../../../server/communications/campaign-model";
import {
  FLOW_LIMITS,
  validateFlowGoal,
  validateFlowTree,
  type FlowBranch,
  type FlowEndedReason,
  type FlowEntryMode,
  type FlowIssue,
  type FlowMessageMeta,
  type FlowOrigin,
  type FlowStatus
} from "../../../../../server/communications/flow-model";
import { flowTreeOfDraft, type FlowDraft, type FlowNodeDraft, type FlowNoticeContent } from "../../../../../server/communications/flow-schemas";
import { describeValidity, VALIDITY_LIMITS, type FlowValidity } from "../../../../../server/communications/message-meta";
import { pageKeyOfHref } from "../../../../../server/member-area/page-visit-model";
import { shouldClampNotificationBody } from "../../../../member/notifications/notifications-model";
import { audienceErrorsFrom, formatInteger, formatPercent, formatStudentCount, ratio, type AudienceFlowContext, type AudienceFlowMessageChoice } from "../notices-view-model";

/* ------------------------------------------------------------------------------------------------
 * Enderecos e filtros
 * ---------------------------------------------------------------------------------------------- */

export const FLOWS_HREF = "/admin/comunicacao/fluxos";
export const NEW_FLOW_HREF = `${FLOWS_HREF}/novo`;
export const FLOW_FILTER_PARAM = "situacao";
export const FLOW_PAGE_PARAM = "pagina";
export const FLOW_EDIT_PARAM = "editar";
export const FLOW_STEP_PARAM = "passo";
export const FLOWS_PAGE_SIZE = 20;

type ParamValue = string | string[] | undefined | null;

function firstParam(value: ParamValue) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Construtor (rascunho) ou relatorio do fluxo; `edit` abre as alteracoes de um fluxo no ar; `step` seleciona o passo. */
export function flowHref(id: string, options: { edit?: boolean; step?: string | null } = {}) {
  const params = new URLSearchParams();

  if (options.edit) {
    params.set(FLOW_EDIT_PARAM, "1");
  }

  if (options.step) {
    params.set(FLOW_STEP_PARAM, options.step);
  }

  const base = `${FLOWS_HREF}/${encodeURIComponent(id)}`;
  const query = params.toString();

  return query ? `${base}?${query}` : base;
}

/** O aviso de origem (fluxo das notificacoes seguintes). */
export function sourceNoticeHref(campaignId: string) {
  return `/admin/comunicacao/avisos/${encodeURIComponent(campaignId)}`;
}

/** Passo da tela (?passo=) so quando e um uuid. */
export function parseFlowStepParam(value: ParamValue) {
  const text = firstParam(value);

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ? text.toLowerCase() : null;
}

export type FlowFilter = "active" | "drafts" | "ended";

const FILTER_PARAM_VALUES: Record<FlowFilter, string> = { active: "ativos", drafts: "rascunhos", ended: "encerrados" };

export const FLOW_FILTERS: readonly { filter: FlowFilter | undefined; label: string }[] = [
  { filter: undefined, label: "Todos" },
  { filter: "active", label: "Ativos" },
  { filter: "drafts", label: "Rascunhos" },
  { filter: "ended", label: "Encerrados" }
];

export function parseFlowFilterParam(value: ParamValue): FlowFilter | undefined {
  const text = firstParam(value).toLowerCase();

  return (Object.keys(FILTER_PARAM_VALUES) as FlowFilter[]).find((filter) => FILTER_PARAM_VALUES[filter] === text);
}

/** Pagina da lista (?pagina=); invalido volta para 1. */
export function parseFlowsPage(value: ParamValue) {
  const page = Number(firstParam(value));

  return Number.isInteger(page) && page > 1 && page <= 10_000 ? page : 1;
}

function copyParams(current: Record<string, ParamValue>, skip: readonly string[]) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(current)) {
    if (skip.includes(key)) {
      continue;
    }

    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === "string") {
        params.append(key, item);
      }
    }
  }

  return params;
}

/** Link de uma pilula (?situacao=), com o periodo da barra junto e sem a pagina. */
export function flowsFilterHref(current: Record<string, ParamValue>, filter: FlowFilter | undefined) {
  const params = copyParams(current, [FLOW_FILTER_PARAM, FLOW_PAGE_PARAM]);

  if (filter) {
    params.set(FLOW_FILTER_PARAM, FILTER_PARAM_VALUES[filter]);
  }

  const query = params.toString();

  return query ? `${FLOWS_HREF}?${query}` : FLOWS_HREF;
}

/** ?pagina= depois da ultima pagina: a ultima com fluxos (ou a primeira), com os outros filtros (regra da v1). */
export function flowsPageFallbackHref(input: { itemCount: number; page: number; pageSize: number; searchParams: Record<string, ParamValue>; total: number }) {
  if (input.page <= 1 || input.itemCount > 0) {
    return null;
  }

  const lastPage = Math.max(1, Math.ceil(Math.max(0, input.total) / Math.max(1, input.pageSize)));

  if (lastPage >= input.page) {
    return null;
  }

  const params = copyParams(input.searchParams, [FLOW_PAGE_PARAM]);

  if (lastPage > 1) {
    params.set(FLOW_PAGE_PARAM, String(lastPage));
  }

  const query = params.toString();

  return query ? `${FLOWS_HREF}?${query}` : FLOWS_HREF;
}

export const FLOW_EMPTY_COPY: Record<"all" | FlowFilter, { description: string; title: string }> = {
  active: { description: "Ative um rascunho ou crie um fluxo novo.", title: "Nenhum fluxo ativo" },
  all: { description: "Monte uma sequência de notificações que segue o que cada aluno faz.", title: "Nenhum fluxo ainda" },
  drafts: { description: "Crie um fluxo a partir de um modelo.", title: "Nenhum rascunho" },
  ended: { description: "Os fluxos encerrados ou concluídos aparecem aqui.", title: "Nenhum fluxo encerrado" }
};

/* ------------------------------------------------------------------------------------------------
 * Situacao
 * ---------------------------------------------------------------------------------------------- */

export type FlowSituation = "active" | "draft" | "ended" | "finished" | "paused" | "pending_approval" | "waiting_notice";

export const FLOW_SITUATION_LABELS: Record<FlowSituation, string> = {
  active: "Ativo",
  draft: "Rascunho",
  ended: "Encerrado",
  finished: "Concluído",
  paused: "Pausado",
  pending_approval: "Aguardando aprovação",
  waiting_notice: "Esperando a notificação"
};

export type FlowSituationTone = "error" | "muted" | "neutral" | "success" | "warning";

export type FlowSituationInput = {
  endedReason: FlowEndedReason | null;
  origin: FlowOrigin;
  /** Situacao do aviso de origem (so no fluxo de aviso). */
  sourceStatus?: CampaignStatus | null;
  status: FlowStatus;
};

/**
 * Encerrado pelo job quando nao sobrou nada = Concluído. O fluxo de um aviso agendado, enviando ou
 * aguardando aprovacao esta "Esperando a notificação" (ele so comeca quando ela sai).
 */
export function flowSituationOf(input: FlowSituationInput): FlowSituation {
  if (input.status === "ended") {
    return input.endedReason === "finished" ? "finished" : "ended";
  }

  if (input.origin === "notice" && input.status !== "paused" && (input.sourceStatus === "scheduled" || input.sourceStatus === "sending" || input.sourceStatus === "pending_approval")) {
    return "waiting_notice";
  }

  return input.status;
}

export function flowSituationTone(situation: FlowSituation): FlowSituationTone {
  switch (situation) {
    case "active":
      return "success";
    case "paused":
    case "pending_approval":
      return "warning";
    case "ended":
    case "finished":
      return "muted";
    default:
      return "neutral";
  }
}

/** Pilula da lista em que a situacao aparece: ativos = no ar, pausado, aguardando aprovacao ou esperando a notificacao. */
export function flowFilterOfSituation(situation: FlowSituation): FlowFilter {
  if (situation === "draft") {
    return "drafts";
  }

  return situation === "ended" || situation === "finished" ? "ended" : "active";
}

/* ------------------------------------------------------------------------------------------------
 * Acoes
 * ---------------------------------------------------------------------------------------------- */

export type FlowAction = "activate" | "approve" | "delete" | "duplicate" | "edit" | "end" | "open_notice" | "pause" | "reject" | "resume";
export type FlowPermissions = NoticePermissions;
export type FlowActionInput = {
  origin: FlowOrigin;
  /** Situacao do aviso de origem (so no fluxo de aviso). */
  sourceStatus?: CampaignStatus | null;
  status: FlowStatus;
};

function isLive(status: FlowStatus) {
  return status === "active" || status === "paused";
}

/**
 * Fluxo de aviso cuja notificacao esta agendada ou aguardando aprovacao: ele segue a notificacao (as
 * seguintes mudam nela, que volta a rascunho junto com o fluxo; a aprovacao cobre o que foi revisado).
 * Aqui so "Abrir a notificação": nada de editar, pausar, retomar ou encerrar (o servidor recusa com 409).
 */
export function isNoticeFlowWaiting(flow: Pick<FlowActionInput, "origin" | "sourceStatus">) {
  return flow.origin === "notice" && (flow.sourceStatus === "scheduled" || flow.sourceStatus === "pending_approval");
}

/**
 * O que a pessoa pode fazer agora (o servidor confere de novo). Mudar um fluxo no ar vale como publicar
 * (messaging.publish). Duplicar e Excluir o fluxo de um aviso sao do aviso; ele ganha "Abrir a notificação".
 */
export function availableFlowActions(flow: FlowActionInput, permissions: FlowPermissions): FlowAction[] {
  const actions: FlowAction[] = [];
  const builder = flow.origin === "builder";
  const live = isLive(flow.status);

  if (isNoticeFlowWaiting(flow)) {
    return ["open_notice"];
  }

  if (permissions.canWrite && (flow.status === "draft" || flow.status === "pending_approval" || (live && permissions.canPublish))) {
    actions.push("edit");
  }

  if (builder && flow.status === "draft" && permissions.canWrite) {
    actions.push("activate");
  }

  if (builder && flow.status === "pending_approval" && permissions.canPublishLarge) {
    actions.push("approve", "reject");
  }

  if (flow.status === "active" && permissions.canPublish) {
    actions.push("pause");
  }

  if (flow.status === "paused" && permissions.canPublish) {
    actions.push("resume");
  }

  if (live && permissions.canPublish) {
    actions.push("end");
  }

  if (builder && permissions.canWrite) {
    actions.push("duplicate");
  }

  if (builder && permissions.canWrite && (flow.status === "draft" || flow.status === "pending_approval" || flow.status === "ended")) {
    actions.push("delete");
  }

  if (!builder) {
    actions.push("open_notice");
  }

  return actions;
}

export const FLOW_ACTION_LABELS: Record<FlowAction, string> = {
  activate: "Ativar fluxo",
  approve: "Aprovar e ativar",
  delete: "Excluir",
  duplicate: "Duplicar",
  edit: "Editar",
  end: "Encerrar",
  open_notice: "Abrir a notificação",
  pause: "Pausar",
  reject: "Recusar",
  resume: "Retomar"
};

const MENU_ORDER: readonly FlowAction[] = ["edit", "pause", "resume", "open_notice", "duplicate", "end", "delete"];
const DESTRUCTIVE: ReadonlySet<FlowAction> = new Set(["delete", "end"]);

export type FlowMenuEntry = { action: FlowAction; destructive: boolean; label: string; separated: boolean };

/** Menu "…" na ordem da tela; Encerrar e Excluir no fim, depois de uma linha. Ativar, aprovar e recusar ficam nos botoes. */
export function flowMenuEntries(actions: readonly FlowAction[], exclude: readonly FlowAction[] = []): FlowMenuEntry[] {
  const entries = MENU_ORDER.filter((action) => actions.includes(action) && !exclude.includes(action));
  const firstDestructive = entries.findIndex((action) => DESTRUCTIVE.has(action));

  return entries.map((action, index) => ({
    action,
    destructive: DESTRUCTIVE.has(action),
    label: FLOW_ACTION_LABELS[action],
    separated: index === firstDestructive && index > 0
  }));
}

/** Pausar, encerrar, excluir, ativar, aprovar e recusar perguntam antes (nunca window.confirm). */
export function flowActionNeedsConfirm(action: FlowAction) {
  return action === "activate" || action === "approve" || action === "delete" || action === "end" || action === "pause" || action === "reject";
}

export type FlowConfirmCopy = { confirmLabel: string; description: string; destructive: boolean; title: string };

/** Quantos entram ao ativar, pelo jeito de entrar (docs/23 §2.6). */
export function activationDescription(mode: FlowEntryMode, count: number | null) {
  if (mode === "new_only") {
    return "Ninguém entra agora: só quem passar a se encaixar daqui em diante.";
  }

  const who = count === null ? "Os alunos do segmento entram agora." : count === 1 ? "1 aluno entra agora." : `${formatStudentCount(count)} entram agora.`;

  return mode === "current_and_new"
    ? `${who} Os primeiros passos começam em até 1 minuto e quem entrar no segmento depois entra em até 15 minutos.`
    : `${who} Os primeiros passos começam em até 1 minuto.`;
}

export function flowActionConfirm(action: FlowAction, flow: { entryCount: number | null; entryMode: FlowEntryMode; name: string }): FlowConfirmCopy {
  switch (action) {
    case "activate":
      return { confirmLabel: "Ativar", description: activationDescription(flow.entryMode, flow.entryCount), destructive: false, title: "Ativar o fluxo?" };
    case "approve":
      return { confirmLabel: "Aprovar e ativar", description: activationDescription(flow.entryMode, flow.entryCount), destructive: false, title: "Aprovar e ativar o fluxo?" };
    case "reject":
      return { confirmLabel: "Recusar", description: "O fluxo volta a rascunho e quem pediu pode ajustar e pedir de novo.", destructive: false, title: "Recusar o pedido?" };
    case "pause":
      return {
        confirmLabel: "Pausar",
        description: "Ninguém entra e nada sai enquanto estiver pausado. As esperas continuam contando: ao retomar, o que venceu sai na hora, respeitando o limite diário.",
        destructive: false,
        title: "Pausar o fluxo?"
      };
    case "end":
      return {
        confirmLabel: "Encerrar",
        description: "Ninguém mais entra e nada mais sai. As notificações já enviadas continuam no sino. Não dá para desfazer.",
        destructive: true,
        title: "Encerrar o fluxo?"
      };
    case "delete":
      return { confirmLabel: "Excluir", description: "Some da lista. As notificações já enviadas continuam no sino.", destructive: true, title: "Excluir o fluxo?" };
    default:
      return { confirmLabel: "Confirmar", description: "", destructive: false, title: FLOW_ACTION_LABELS[action] };
  }
}

export const FLOW_TOASTS = {
  activated: "Fluxo ativo. Os primeiros passos começam em até 1 minuto.",
  applied: "Alterações aplicadas.",
  approvalRequested: "Fluxo enviado para aprovação.",
  deleted: "Fluxo excluído.",
  duplicated: "Fluxo duplicado.",
  ended: "Fluxo encerrado.",
  paused: "Fluxo pausado. Nada sai até você retomar.",
  rejected: "Pedido recusado. O fluxo voltou a rascunho.",
  resumed: "Fluxo retomado.",
  saved: "Rascunho salvo.",
  testSent: "Teste enviado para o seu sino.",
  withdrawn: "Notificação retirada do sino."
} as const;

/* ------------------------------------------------------------------------------------------------
 * Barra do construtor
 * ---------------------------------------------------------------------------------------------- */

export type BuilderPrimary = "activate" | "apply" | "request_approval" | "save";

export type BuilderBar = {
  /** "Alterações não aplicadas" + Descartar + Aplicar alterações (fluxo no ar). */
  applyBar: boolean;
  menu: FlowAction[];
  /** "Abrir a notificação" (fluxo de aviso). */
  openNotice: boolean;
  primary: BuilderPrimary | null;
  /** Fluxo no ar para quem nao pode publicar: so leitura, com esta frase. */
  readOnly: string | null;
  /** "Salvar rascunho" ao lado do botao principal. */
  saveDraft: boolean;
};

export const PUBLISH_ONLY_NOTE = "Só quem pode publicar muda um fluxo no ar. Duplique para criar outro.";
/** Fluxo de aviso com a notificacao agendada ou aguardando aprovacao: so leitura, com esta frase. */
export const NOTICE_WAITING_NOTE = "A notificação ainda não saiu: as notificações seguintes mudam na própria notificação.";

/**
 * Botoes do topo (docs/23 §2.5 e §2.6). Rascunho: Salvar rascunho + Ativar fluxo (ou Enviar para
 * aprovacao, pela contagem de agora). No ar: Aplicar alterações e o menu. Fluxo de aviso antes de a
 * notificacao sair: com ela em rascunho, so Salvar e Abrir a notificação (quem ativa e a publicacao do
 * aviso); agendada ou aguardando aprovacao, so leitura (as seguintes mudam na notificacao).
 */
export function builderBarFor(input: {
  count: number | null;
  origin: FlowOrigin;
  permissions: FlowPermissions;
  saved: boolean;
  /** Situacao do aviso de origem (so no fluxo de aviso). */
  sourceStatus?: CampaignStatus | null;
  status: FlowStatus;
}): BuilderBar {
  const live = isLive(input.status);
  const actions = input.saved ? availableFlowActions({ origin: input.origin, sourceStatus: input.sourceStatus, status: input.status }, input.permissions) : [];
  const menu = actions.filter((action) => action !== "edit" && action !== "open_notice" && action !== "activate" && action !== "approve" && action !== "reject");

  if (input.saved && isNoticeFlowWaiting(input)) {
    return { applyBar: false, menu: [], openNotice: true, primary: null, readOnly: NOTICE_WAITING_NOTE, saveDraft: false };
  }

  if (live && !input.permissions.canPublish) {
    return { applyBar: false, menu: [], openNotice: input.origin === "notice", primary: null, readOnly: PUBLISH_ONLY_NOTE, saveDraft: false };
  }

  if (live) {
    return { applyBar: true, menu, openNotice: input.origin === "notice", primary: "apply", readOnly: null, saveDraft: false };
  }

  if (input.origin === "notice") {
    return { applyBar: false, menu: [], openNotice: true, primary: "save", readOnly: null, saveDraft: false };
  }

  if (input.status === "pending_approval") {
    return { applyBar: false, menu, openNotice: false, primary: null, readOnly: null, saveDraft: true };
  }

  const decision = publishDecision({
    audienceCount: input.count ?? 0,
    canPublish: input.permissions.canPublish,
    canPublishLarge: input.permissions.canPublishLarge
  });

  return { applyBar: false, menu, openNotice: false, primary: decision === "publish" ? "activate" : "request_approval", readOnly: null, saveDraft: true };
}

export const BUILDER_PRIMARY_LABELS: Record<BuilderPrimary, string> = {
  activate: "Ativar fluxo",
  apply: "Aplicar alterações",
  request_approval: "Enviar para aprovação",
  save: "Salvar"
};

/* ------------------------------------------------------------------------------------------------
 * Frases fixas do construtor
 * ---------------------------------------------------------------------------------------------- */

export const ENTRY_MODE_OPTIONS: readonly { help: string; label: string; value: FlowEntryMode }[] = [
  { help: "Entram todos de uma vez ao ativar.", label: "Quem está no segmento agora", value: "current" },
  { help: "Quem passar a se encaixar entra em até 15 minutos.", label: "Quem está agora e quem entrar depois", value: "current_and_new" },
  { help: "Quem já se encaixa ao ativar fica de fora. Bom para “ganhou acesso ao produto”.", label: "Só quem entrar no segmento a partir de agora", value: "new_only" }
];

export const ONCE_PER_FLOW_TEXT = "Cada aluno passa por este fluxo uma vez só.";
export const DAILY_LIMIT_TEXT =
  "Para não cansar o aluno: no máximo 3 notificações de fluxos e notificações seguintes por dia para cada aluno, com pelo menos 1 hora entre elas. Se passar do limite do dia, sai às 8h do dia seguinte; se o prazo dela acabar antes, não sai.";
export const ENTRY_DECIDED_MESSAGE = "Neste fluxo, quem entra foi decidido ao ativar. Duplique para mudar.";
export const ENTRY_MODE_LOCKED_MESSAGE = "O jeito de entrar não muda depois de ativar. Duplique para mudar.";
export const FLOW_NAME_HINT = "Só a equipe vê.";
export const FILTER_HINT =
  "Quem não combina não recebe esta notificação e para aqui neste caminho. Para continuar o fluxo com quem não combina, use uma Condição.";
export const WAIT_UNTIL_HINT = "Quem não chegar ao Sim nesse tempo segue pelo Não. Conferimos a cada 15 minutos.";
export const GOAL_INTRO = "O aluno sai do fluxo quando…";
export const GOAL_HINT = "Quem atingir o objetivo não recebe mais nada deste fluxo.";
export const LIVE_EDIT_BANNER =
  "Este fluxo está ativo. As alterações valem quando você aplicar: quem já passou de um passo não recebe de novo; passos novos valem para quem chegar até eles daqui em diante.";
export const LIVE_WAIT_NOTE = "Vale também para quem já está esperando, contando de quando cada um chegou.";
export const ANCHOR_LOCKED_NOTE = "Para mudar a referência de tempo, remova este passo e crie outro.";
export const PAGE_VISIT_LIVE_NOTE = "A visita só é registrada enquanto um fluxo no ar usa esta página: conta a partir de quando você aplicar.";
export const PENDING_APPROVAL_BANNER = "Aguardando aprovação de um dono ou administrador.";
export const PENDING_EDIT_NOTE = "Salvar uma mudança volta o fluxo para rascunho e cancela o pedido.";
export const UNAPPLIED_CHANGES = "Alterações não aplicadas";
export const BLANK_CANVAS_HINT = "Toque em + para adicionar a primeira notificação.";
export const BRANCH_END_TEXT = "Fim: nada mais para quem chega aqui.";
export const ADD_STEP_LABEL = "Adicionar passo aqui";
export const MOVED_TO_YES_TOAST = "O que vinha depois ficou no caminho Sim.";
export const MAX_STEPS_MESSAGE = `Use no máximo ${FLOW_LIMITS.maxNodes} passos (notificações e condições).`;
export const FLOW_CHANGED_TITLE = "Este fluxo mudou em outra tela";

export function noticeOriginBanner(title: string) {
  return `Este fluxo segue a notificação “${title.trim() || "Sem título"}”: ele começa quando ela sai.`;
}

/** Notificacao de um fluxo no ar que ja chegou a alguem: mudar cria uma versao. */
export function liveContentNote(received: number) {
  return received > 0 ? `Esta notificação já chegou a ${formatStudentCount(received)}. Mudar cria uma versão nova: quem já recebeu continua com a anterior.` : null;
}

/**
 * "Quem entra" depois de ativar: o jeito de entrar nunca muda; em "Quem está no segmento agora" as
 * regras tambem nao (ninguem entra depois). No fluxo de um aviso, quem entra e quem recebeu o aviso.
 */
export function entryLock(input: { live: boolean; mode: FlowEntryMode; origin: FlowOrigin }) {
  if (input.origin === "notice") {
    return { modeLocked: true, note: null, rulesLocked: true };
  }

  if (!input.live) {
    return { modeLocked: false, note: null, rulesLocked: false };
  }

  return input.mode === "current" ? { modeLocked: true, note: ENTRY_DECIDED_MESSAGE, rulesLocked: true } : { modeLocked: true, note: null, rulesLocked: false };
}

/* ------------------------------------------------------------------------------------------------
 * Tempo de cada passo ("Quando")
 * ---------------------------------------------------------------------------------------------- */

const DAY = 1_440;

/** "1 dia", "2 dias", "3 h", "45 min", "1 h 30 min", "1 dia e 3 h". */
export function formatWait(minutes: number) {
  const value = Math.max(0, Math.round(minutes));
  const days = Math.floor(value / DAY);
  const hours = Math.floor((value % DAY) / 60);
  const rest = value % 60;
  const parts = [days > 0 ? (days === 1 ? "1 dia" : `${days} dias`) : null, hours > 0 ? `${hours} h` : null, rest > 0 ? `${rest} min` : null].filter(Boolean);

  if (parts.length === 0) {
    return "0 min";
  }

  return days > 0 && parts.length > 1 ? `${parts[0]} e ${parts.slice(1).join(" ")}` : parts.join(" ");
}

type TimingNode = { anchor: "expires" | "previous" | "sent"; anchorNodeId: string | null; offsetMinutes: number };

/** Etiqueta do conector acima do passo: "Logo depois", "Esperar 1 dia", "3 h antes de “X” vencer". */
export function timingChipLabel(node: TimingNode, titleOf: (nodeId: string) => string) {
  const title = node.anchorNodeId ? titleOf(node.anchorNodeId) : "";

  if (node.anchor === "expires") {
    return `${formatWait(node.offsetMinutes)} antes de “${title}” vencer`;
  }

  if (node.anchor === "sent") {
    return node.offsetMinutes > 0 ? `${formatWait(node.offsetMinutes)} depois do envio de “${title}”` : `Logo depois do envio de “${title}”`;
  }

  return node.offsetMinutes > 0 ? `Esperar ${formatWait(node.offsetMinutes)}` : "Logo depois";
}

export type TimingChoice = "after_send" | "before_expiry" | "now" | "wait";

export const TIMING_CHOICE_LABELS: Record<TimingChoice, string> = {
  after_send: "Depois do envio de",
  before_expiry: "Antes de uma notificação vencer",
  now: "Logo depois",
  wait: "Esperar"
};

export function timingChoiceOf(node: TimingNode): TimingChoice {
  if (node.anchor === "expires") {
    return "before_expiry";
  }

  if (node.anchor === "sent") {
    return "after_send";
  }

  return node.offsetMinutes > 0 ? "wait" : "now";
}

/** Nova escolha de "Quando": mantem a notificacao e os minutos que ainda fazem sentido. */
export function timingForChoice(choice: TimingChoice, node: TimingNode, above: readonly { nodeId: string }[]): TimingNode {
  const last = above.at(-1)?.nodeId ?? null;
  const anchorNodeId = node.anchorNodeId && above.some((item) => item.nodeId === node.anchorNodeId) ? node.anchorNodeId : last;

  switch (choice) {
    case "now":
      return { anchor: "previous", anchorNodeId: null, offsetMinutes: 0 };
    case "wait":
      return { anchor: "previous", anchorNodeId: null, offsetMinutes: node.anchor === "previous" && node.offsetMinutes > 0 ? node.offsetMinutes : DAY };
    case "before_expiry":
      return { anchor: "expires", anchorNodeId, offsetMinutes: node.anchor === "expires" ? node.offsetMinutes : 180 };
    default:
      return { anchor: "sent", anchorNodeId, offsetMinutes: node.anchor === "sent" ? node.offsetMinutes : DAY };
  }
}

/**
 * "Fica no sino por" quando o "Quando" muda: contar de antes de uma notificacao vencer com os 90 dias
 * intocados passa a "Até “X” sumir" (o padrao do lembrete); voltar a contar do passo anterior desfaz.
 */
export function validityAfterTiming(validity: FlowValidity, next: TimingNode["anchor"]): FlowValidity {
  if (next === "expires" && validity.mode === "default") {
    return { mode: "with_anchor" };
  }

  if (next === "previous" && validity.mode === "with_anchor") {
    return { mode: "default" };
  }

  return validity;
}

export type WaitUnit = "days" | "hours" | "minutes";

export const WAIT_UNIT_OPTIONS: readonly { label: string; value: WaitUnit }[] = [
  { label: "minutos", value: "minutes" },
  { label: "horas", value: "hours" },
  { label: "dias", value: "days" }
];

const UNIT_MINUTES: Record<WaitUnit, number> = { days: DAY, hours: 60, minutes: 1 };

/** Minutos -> o numero e a maior unidade exata ("1 dia", "3 horas", "45 minutos"). */
export function waitParts(minutes: number): { amount: number; unit: WaitUnit } {
  if (minutes > 0 && minutes % DAY === 0) {
    return { amount: minutes / DAY, unit: "days" };
  }

  if (minutes > 0 && minutes % 60 === 0) {
    return { amount: minutes / 60, unit: "hours" };
  }

  return { amount: minutes, unit: "minutes" };
}

/** Numero + unidade -> minutos; vazio ou invalido = NaN (o zod mostra a frase do limite). */
export function waitMinutes(amount: number, unit: WaitUnit) {
  return Number.isFinite(amount) ? Math.round(amount * UNIT_MINUTES[unit]) : Number.NaN;
}

/* ------------------------------------------------------------------------------------------------
 * Arvore no navegador
 * ---------------------------------------------------------------------------------------------- */

type DraftNode = FlowNodeDraft;
type MessageDraftNode = Extract<FlowNodeDraft, { kind: "message" }>;
type ConditionDraftNode = Extract<FlowNodeDraft, { kind: "condition" }>;

export function entryNodeOf(nodes: readonly DraftNode[]) {
  return nodes.find((node) => node.kind === "entry") ?? null;
}

/** Filhos de um passo (de um lado, na condicao), em ordem. */
export function childrenOfNode(nodes: readonly DraftNode[], parentId: string, branch: FlowBranch | null) {
  return nodes
    .filter((node) => node.parentId === parentId && node.branch === branch)
    .sort((left, right) => left.position - right.position || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/** O passo e tudo abaixo dele. */
export function subtreeIdsOf(nodes: readonly DraftNode[], nodeId: string) {
  const ids = new Set<string>([nodeId]);
  let grew = true;

  while (grew) {
    grew = false;

    for (const node of nodes) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        grew = true;
      }
    }
  }

  return ids;
}

/** Os passos acima (da entrada para baixo), sem o proprio. */
export function pathAbove(nodes: readonly DraftNode[], nodeId: string): DraftNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path: DraftNode[] = [];
  const seen = new Set<string>([nodeId]);
  let current = byId.get(nodeId);

  while (current?.parentId) {
    const parent = byId.get(current.parentId);

    if (!parent || seen.has(parent.id)) {
      break;
    }

    seen.add(parent.id);
    path.unshift(parent);
    current = parent;
  }

  return path;
}

/** Nivel da condicao: 1 = nenhuma condicao acima. Do 3o nivel para baixo os lados viram pilulas. */
export function conditionLevel(nodes: readonly DraftNode[], nodeId: string) {
  return pathAbove(nodes, nodeId).filter((node) => node.kind === "condition").length + 1;
}

export function usesSidePills(input: { level: number; narrow: boolean }) {
  return input.narrow || input.level >= 3;
}

export function sidePillLabel(side: FlowBranch, count: number | null | undefined) {
  const label = side === "yes" ? "Sim" : "Não";

  return typeof count === "number" && Number.isFinite(count) ? `${label} (${formatInteger(count)})` : label;
}

export function stepCounts(nodes: readonly Pick<DraftNode, "kind">[]) {
  return {
    conditions: nodes.filter((node) => node.kind === "condition").length,
    messages: nodes.filter((node) => node.kind === "message").length
  };
}

/** Conteudo vazio de uma notificacao nova (sem icone, a escola envia, 90 dias). */
export function newMessageContent(): FlowNoticeContent {
  return { audio: null, body: "", cta: null, icon: null, image: null, response: null, sender: null, title: "", validity: { mode: "default" } };
}

export type NewStepKind = "condition" | "message";

/**
 * Passo novo num conector (docs/23 §2.5): espera padrao "Esperar 1 dia" depois de uma notificacao e
 * "Logo depois" depois de Quem entra ou de uma condicao. Num rascunho, inserir no meio poe o que vinha
 * depois embaixo do passo novo (na condicao, no caminho Sim). Num fluxo no ar a ordem nao muda: o passo
 * novo entra ao lado, como outro caminho. A condicao nova comeca conferindo se abriu a notificacao logo
 * acima; se ela nao tem nada para abrir (texto curto, sem audio, botao ou resposta: V7), se viu; sem
 * notificacao acima, sem regra. Passou de 20 passos: null.
 */
export function insertFlowStep(
  draft: FlowDraft,
  input: { branch: FlowBranch | null; id: string; kind: NewStepKind; live: boolean; parentId: string; source?: FlowSourceNotice | null }
): { draft: FlowDraft; movedToYes: boolean } | null {
  const parent = draft.nodes.find((node) => node.id === input.parentId);

  if (!parent || stepCounts(draft.nodes).messages + stepCounts(draft.nodes).conditions >= FLOW_LIMITS.maxNodes) {
    return null;
  }

  const branch = parent.kind === "condition" ? (input.branch ?? "yes") : null;
  const siblings = childrenOfNode(draft.nodes, parent.id, branch);
  const moves = !input.live && siblings.length > 0;
  const offsetMinutes = parent.kind === "message" ? DAY : 0;
  const position = moves ? (siblings[0]?.position ?? 0) : siblings.reduce((max, node) => Math.max(max, node.position + 1), 0);
  const above = [...pathAbove(draft.nodes, parent.id), parent].filter((node) => node.kind === "message" || (node.kind === "entry" && draft.origin === "notice"));
  const lastMessage = above.at(-1)?.id ?? null;
  // O que a notificacao de cima tem para abrir (a principal sem os dados dela: supoe que sim).
  const lastChoice = lastMessage ? choicesOf(draft, draft.nodes.filter((item) => item.id === lastMessage), input.source ?? null)[0] : undefined;
  const firstAction = lastChoice?.canOpen === false ? "seen" : "opened";
  const node: DraftNode =
    input.kind === "message"
      ? { anchor: "previous", anchorNodeId: null, branch, filter: null, id: input.id, kind: "message", offsetMinutes, parentId: parent.id, position }
      : {
          anchor: "previous",
          anchorNodeId: null,
          branch,
          condition: lastMessage
            ? { kind: "rules", root: { items: [{ action: firstAction, negate: false, ref: { kind: "node", nodeId: lastMessage }, type: "message" }], match: "all" } }
            : { kind: "rules", root: { items: [], match: "all" } },
          id: input.id,
          kind: "condition",
          maxWaitMinutes: null,
          offsetMinutes,
          parentId: parent.id,
          position,
          waitUntilTrue: false
        };
  const moved = new Set(moves ? siblings.map((sibling) => sibling.id) : []);
  const nodes: DraftNode[] = [];

  for (const current of draft.nodes) {
    nodes.push(moved.has(current.id) ? ({ ...current, branch: input.kind === "condition" ? "yes" : null, parentId: input.id } as DraftNode) : current);

    if (current.id === parent.id) {
      nodes.push(node);
    }
  }

  return {
    draft: { ...draft, messages: input.kind === "message" ? { ...draft.messages, [input.id]: newMessageContent() } : draft.messages, nodes },
    movedToYes: moves && input.kind === "condition"
  };
}

export type RemoveMode = "keep_no" | "keep_yes" | "subtree";

/**
 * Remover um passo: a notificacao leva o que esta abaixo dela; a condicao pode manter um caminho (ele sobe
 * um nivel, no lugar da condicao) ou levar tudo. O conteudo dos passos que saem sai junto.
 */
export function removeFlowStep(draft: FlowDraft, nodeId: string, mode: RemoveMode): FlowDraft {
  const target = draft.nodes.find((node) => node.id === nodeId);

  if (!target || target.kind === "entry") {
    return draft;
  }

  const kept = target.kind === "condition" && mode !== "subtree" ? (mode === "keep_yes" ? "yes" : "no") : null;
  const removed = new Set<string>([target.id]);

  for (const child of draft.nodes.filter((node) => node.parentId === target.id)) {
    if (kept && child.branch === kept) {
      continue;
    }

    subtreeIdsOf(draft.nodes, child.id).forEach((id) => removed.add(id));
  }

  const nodes = draft.nodes
    .filter((node) => !removed.has(node.id))
    .map((node) =>
      node.parentId === target.id ? ({ ...node, branch: target.branch, parentId: target.parentId, position: target.position } as DraftNode) : node
    );
  const messages = Object.fromEntries(Object.entries(draft.messages).filter(([id]) => !removed.has(id)));

  return { ...draft, messages, nodes };
}

export const CONDITION_REMOVE_OPTIONS: readonly { label: string; mode: RemoveMode }[] = [
  { label: "Manter o caminho “Sim”", mode: "keep_yes" },
  { label: "Manter o caminho “Não”", mode: "keep_no" },
  { label: "Remover tudo daqui para baixo", mode: "subtree" }
];

/** Confirmacao de "Remover passo"; `waiting` = alunos esperando por ele agora (fluxo no ar). */
export function removeStepCopy(kind: NewStepKind, title: string, waiting: number) {
  if (kind === "condition") {
    return {
      description: "Escolha o caminho que fica.",
      title: "Remover a condição?",
      waitingNote: waiting > 0 ? (waiting === 1 ? "1 aluno está esperando esta condição e para aqui." : `${formatStudentCount(waiting)} estão esperando esta condição e param aqui.`) : null
    };
  }

  return {
    description: "As notificações e condições abaixo dela saem junto.",
    title: `Remover “${title.trim() || "Sem título"}”?`,
    waitingNote:
      waiting > 0
        ? waiting === 1
          ? "1 aluno está esperando este passo. Ao remover, ele para aqui neste caminho. Quem já recebeu continua com ela no sino."
          : `${formatStudentCount(waiting)} estão esperando este passo. Ao remover, eles param aqui neste caminho. Quem já recebeu continua com ela no sino.`
        : null
  };
}

/** "Retirar do sino" de um passo de notificacao (relatorio). */
export function withdrawStepCopy(title: string, received: number): FlowConfirmCopy {
  const who = received === 1 ? "Some para o 1 aluno que recebeu" : `Some para os ${formatInteger(received)} alunos que receberam`;

  return {
    confirmLabel: "Retirar do sino",
    description: `${who} e não sai mais para ninguém. Quem estava esperando por ela para aqui neste caminho.`,
    destructive: true,
    title: `Retirar “${title.trim() || "Sem título"}” do sino?`
  };
}

/* ------------------------------------------------------------------------------------------------
 * Notificacoes, nomes e o contexto das regras
 * ---------------------------------------------------------------------------------------------- */

/** O aviso de origem (fluxo de aviso): a "notificação principal" na entrada. */
export type FlowSourceNotice = {
  body: string;
  ctaHref: string | null;
  hasAudio: boolean;
  hasResponse: boolean;
  id: string;
  title: string;
  validityMinutes: number | null;
  validUntil: string | null;
};

function lowerFirst(value: string) {
  return value ? value.charAt(0).toLocaleLowerCase("pt-BR") + value.slice(1) : value;
}

function titleOfContent(content: Pick<FlowNoticeContent, "title"> | undefined) {
  return content?.title.trim() || "Sem título";
}

/** Titulo de cada passo de notificacao (e da principal, no fluxo de aviso), para as frases. */
export function flowTitleOf(draft: Pick<FlowDraft, "messages" | "nodes" | "origin">, source: Pick<FlowSourceNotice, "title"> | null = null) {
  const entry = entryNodeOf(draft.nodes);

  return (nodeId: string) => (draft.origin === "notice" && entry?.id === nodeId ? source?.title.trim() || "a notificação principal" : titleOfContent(draft.messages[nodeId]));
}

/** Nomes da frase das regras com os titulos dos passos ("node:<id>"). */
export function flowAudienceNames(names: AudienceNames, draft: Pick<FlowDraft, "messages" | "nodes" | "origin">, source: Pick<FlowSourceNotice, "title"> | null = null): AudienceNames {
  const titleOf = flowTitleOf(draft, source);
  const messages: Record<string, string> = { ...names.messages };

  for (const node of draft.nodes) {
    if (node.kind === "message" || (node.kind === "entry" && draft.origin === "notice")) {
      messages[messageRefKey({ kind: "node", nodeId: node.id })] = titleOf(node.id);
    }
  }

  return { ...names, messages };
}

function choiceOfContent(nodeId: string, content: FlowNoticeContent): AudienceFlowMessageChoice {
  const hasAudio = Boolean(content.audio);
  const hasCta = Boolean(content.cta);
  const hasResponse = Boolean(content.response);

  return {
    canOpen: hasAudio || hasCta || hasResponse || shouldClampNotificationBody(content.body ?? ""),
    ctaPageKey: pageKeyOfHref(content.cta?.href ?? null),
    hasAudio,
    hasCta,
    hasResponse,
    nodeId,
    title: titleOfContent(content)
  };
}

function choiceOfSource(nodeId: string, source: FlowSourceNotice): AudienceFlowMessageChoice {
  const hasCta = Boolean(source.ctaHref);

  return {
    canOpen: source.hasAudio || hasCta || source.hasResponse || shouldClampNotificationBody(source.body),
    ctaPageKey: pageKeyOfHref(source.ctaHref),
    hasAudio: source.hasAudio,
    hasCta,
    hasResponse: source.hasResponse,
    nodeId,
    title: source.title.trim() || "Sem título"
  };
}

function choicesOf(draft: Pick<FlowDraft, "messages" | "nodes" | "origin">, nodes: readonly DraftNode[], source: FlowSourceNotice | null) {
  const choices: AudienceFlowMessageChoice[] = [];

  for (const node of nodes) {
    if (node.kind === "message" && draft.messages[node.id]) {
      choices.push(choiceOfContent(node.id, draft.messages[node.id]));
    } else if (node.kind === "entry" && draft.origin === "notice" && source) {
      choices.push(choiceOfSource(node.id, source));
    }
  }

  return choices;
}

/** As notificacoes acima do passo (de cima para baixo): o que "Só para quem…" e a condicao podem conferir. */
export function flowContextAbove(draft: Pick<FlowDraft, "messages" | "nodes" | "origin">, nodeId: string, source: FlowSourceNotice | null = null): AudienceFlowContext {
  return { messages: choicesOf(draft, pathAbove(draft.nodes, nodeId), source) };
}

/** Todas as notificacoes do fluxo (o Objetivo vale para o fluxo inteiro), na ordem da arvore. */
export function flowContextAll(draft: Pick<FlowDraft, "messages" | "nodes" | "origin">, source: FlowSourceNotice | null = null): AudienceFlowContext {
  return { messages: choicesOf(draft, preorder(draft.nodes), source) };
}

/** Pre-ordem a partir da entrada (pai antes do filho; Sim antes de Nao). */
export function preorder(nodes: readonly DraftNode[]): DraftNode[] {
  const entry = entryNodeOf(nodes);
  const ordered: DraftNode[] = [];
  const visit = (node: DraftNode) => {
    ordered.push(node);

    for (const side of node.kind === "condition" ? (["yes", "no"] as const) : [null]) {
      childrenOfNode(nodes, node.id, side).forEach(visit);
    }
  };

  if (entry) {
    visit(entry);
  }

  return ordered;
}

/** As notificacoes acima do passo, para o seletor de "Quando" (com o tempo no sino de cada uma). */
export function timingAnchorsAbove(draft: Pick<FlowDraft, "messages" | "nodes" | "origin">, nodeId: string, source: FlowSourceNotice | null = null) {
  const titleOf = flowTitleOf(draft, source);

  return pathAbove(draft.nodes, nodeId)
    .filter((node) => node.kind === "message" || (node.kind === "entry" && draft.origin === "notice"))
    .map((node) => ({ nodeId: node.id, title: titleOf(node.id) }));
}

/* ------------------------------------------------------------------------------------------------
 * Cartoes e frases
 * ---------------------------------------------------------------------------------------------- */

function capitalize(value: string) {
  return value ? value.charAt(0).toLocaleUpperCase("pt-BR") + value.slice(1) : value;
}

/** Linhas do cartao da notificacao: titulo, "Fica 3 dias no sino" e, com filtro, "Só para …". */
export function messageCardLines(input: { content: FlowNoticeContent | undefined; names: AudienceNames; node: Pick<MessageDraftNode, "anchorNodeId" | "filter">; titleOf: (nodeId: string) => string }) {
  const validity = input.content?.validity ?? { mode: "default" };
  const validityLine =
    validity.mode === "with_anchor"
      ? `Fica no sino até “${input.node.anchorNodeId ? input.titleOf(input.node.anchorNodeId) : "a principal"}” sumir`
      : capitalize(describeValidity(validity));

  return {
    filter: input.node.filter && input.node.filter.kind === "rules" ? `Só para ${lowerFirst(describeAudience(input.node.filter, input.names))}` : null,
    title: titleOfContent(input.content),
    validity: validityLine
  };
}

/** "Espera até ser Sim, por no máximo 2 dias" (condicao com a espera ligada). */
export function conditionWaitLine(node: Pick<ConditionDraftNode, "maxWaitMinutes" | "waitUntilTrue">) {
  return node.waitUntilTrue && typeof node.maxWaitMinutes === "number" && node.maxWaitMinutes > 0 ? `Espera até ser Sim, por no máximo ${formatWait(node.maxWaitMinutes)}` : null;
}

/** Frase do cartao "Quem entra": a do segmento, ou "Recebeu a notificação “X”" no fluxo de aviso. */
export function entrySentence(input: { audience: AudienceDefinition; names: AudienceNames; origin: FlowOrigin; sourceTitle?: string | null }) {
  return input.origin === "notice" ? `Recebeu a notificação “${input.sourceTitle?.trim() || "Sem título"}”` : describeAudience(input.audience, input.names);
}

/** "≈ 318 alunos agora" no cartao (sem contagem ainda, nada). */
export function entryCountLine(count: number | null | undefined) {
  return typeof count === "number" && Number.isFinite(count) ? `≈ ${formatStudentCount(count)} agora` : null;
}

/** Coluna "Quem entra" da lista: a frase e "≈ 318 alunos e quem entrar depois". */
export function entryListLines(input: { count: number | null; description: string; mode: FlowEntryMode; origin: FlowOrigin; sourceTitle?: string | null }) {
  if (input.origin === "notice") {
    return { detail: null, sentence: `Recebeu “${input.sourceTitle?.trim() || "Sem título"}”` };
  }

  const parts = [typeof input.count === "number" ? `≈ ${formatStudentCount(input.count)}` : null, input.mode === "current" ? null : "e quem entrar depois"].filter(Boolean);

  return { detail: parts.length > 0 ? parts.join(" ") : null, sentence: input.description };
}

function singleProductOf(definition: AudienceDefinition | null, op: "has" | "has_not") {
  if (!definition || definition.kind !== "rules" || definition.root.items.length !== 1) {
    return null;
  }

  const rule = definition.root.items[0];

  return !isAudienceGroup(rule) && rule.type === "product" && rule.op === op && rule.productIds.length === 1 ? rule.productIds[0] : null;
}

function countNoun(count: number, singular: string, plural: string) {
  return count === 1 ? `1 ${singular}` : `${formatInteger(count)} ${plural}`;
}

/**
 * Frase de revisao (topo do painel e confirmacao de ativar): "Fluxo para 318 alunos agora e quem entrar
 * depois, com 3 notificações e 1 condição. Sai quando o aluno tiver acesso a Formação IA."
 */
export function describeFlowReview(input: {
  count: number | null;
  goal: AudienceDefinition | null;
  mode: FlowEntryMode;
  names: AudienceNames;
  nodes: readonly Pick<DraftNode, "kind">[];
  origin: FlowOrigin;
  sourceTitle?: string | null;
}) {
  let who: string;

  if (input.origin === "notice") {
    who = `Fluxo para quem recebeu a notificação “${input.sourceTitle?.trim() || "Sem título"}”`;
  } else if (input.mode === "new_only") {
    who = "Fluxo para quem entrar no segmento a partir de agora";
  } else {
    const base = input.count === null ? "Fluxo para os alunos do segmento agora" : `Fluxo para ${formatStudentCount(input.count)} agora`;
    who = input.mode === "current_and_new" ? `${base} e quem entrar depois` : base;
  }

  const counts = stepCounts(input.nodes);
  const steps =
    counts.messages === 0
      ? ", ainda sem notificações."
      : `, com ${countNoun(counts.messages, "notificação", "notificações")}${counts.conditions > 0 ? ` e ${countNoun(counts.conditions, "condição", "condições")}` : ""}.`;
  const product = singleProductOf(input.goal, "has");
  const goal = input.goal ? (product ? ` Sai quando o aluno tiver acesso a ${input.names.products[product] ?? "um produto removido"}.` : " Sai quando o aluno atingir o objetivo.") : "";

  return `${who}${steps}${goal}`;
}

/* ------------------------------------------------------------------------------------------------
 * Objetivo: "Quem já tem acesso a Y entra e sai na hora"
 * ---------------------------------------------------------------------------------------------- */

function excludesProduct(node: AudienceNode, productId: string): boolean {
  return !isAudienceGroup(node) && node.type === "product" && node.op === "has_not" && node.productIds.includes(productId);
}

/**
 * Objetivo "têm acesso a Y" com um segmento que deixa entrar quem ja tem Y: o produto da sugestao, ou
 * null. So no fluxo do construtor (no de aviso, quem entra e quem recebeu a notificacao).
 */
export function goalAccessFix(input: { entry: AudienceDefinition; goal: AudienceDefinition | null; origin: FlowOrigin }): string | null {
  const productId = singleProductOf(input.goal, "has");

  if (!productId || input.origin !== "builder") {
    return null;
  }

  if (input.entry.kind === "rules" && input.entry.root.match === "all" && input.entry.root.items.some((item) => excludesProduct(item, productId))) {
    return null;
  }

  return productId;
}

export function goalAccessFixMessage(productName: string) {
  return `Quem já tem acesso a ${productName} entra e sai na hora. Adicionar “não têm acesso a ${productName}” ao segmento?`;
}

/**
 * Acrescenta "não têm acesso a Y" ao segmento de entrada (todas as regras). Um segmento com "Qualquer
 * regra" vira um grupo dentro de "Todas as regras"; com grupo dentro de grupo nao cabe (null).
 */
export function applyGoalAccessFix(entry: AudienceDefinition, productId: string): AudienceDefinition | null {
  const rule: AudienceRule = { op: "has_not", productIds: [productId], type: "product" };

  if (entry.kind === "everyone") {
    return { kind: "rules", root: { items: [rule], match: "all" } };
  }

  if (entry.root.match === "all") {
    return { kind: "rules", root: { ...entry.root, items: [...entry.root.items, rule] } };
  }

  if (entry.root.items.some((item) => isAudienceGroup(item))) {
    return null;
  }

  return { kind: "rules", root: { items: [{ items: entry.root.items, match: "any" }, rule], match: "all" } };
}

/* ------------------------------------------------------------------------------------------------
 * Conferencia e erros
 * ---------------------------------------------------------------------------------------------- */

/** O aviso de origem como validateFlowTree le (a entrada do fluxo de aviso). */
export function sourceMetaOf(source: FlowSourceNotice | null): FlowMessageMeta | null {
  return source
    ? {
        campaignId: source.id,
        ctaHref: source.ctaHref,
        hasAudio: source.hasAudio,
        hasCta: Boolean(source.ctaHref),
        hasResponse: source.hasResponse,
        title: source.title,
        validUntil: source.validUntil,
        validityMinutes: source.validityMinutes
      }
    : null;
}

/** Problemas da arvore e do objetivo, como o servidor confere (salvar, ativar ou so aviso). */
export function flowIssuesOf(draft: FlowDraft, source: FlowSourceNotice | null = null): FlowIssue[] {
  const { messages, tree } = flowTreeOfDraft(draft);
  const entry = entryNodeOf(draft.nodes);
  const meta = sourceMetaOf(source);

  if (meta && entry && draft.origin === "notice") {
    messages[entry.id] = meta;
  }

  return [...validateFlowTree(tree, messages), ...validateFlowGoal(tree, draft.goal, messages)];
}

export type FlowFieldErrors = Record<string, string>;

/**
 * Problemas do zod (ou fieldErrors da Server Action, com o prefixo "flow.") -> primeira mensagem de cada
 * campo, com os passos pelo id ("nodes.<id>.offsetMinutes", "messages.<id>.cta.href", "entry.audience…").
 */
export function flowErrorsFrom(issues: readonly { message: string; path: readonly PropertyKey[] }[], nodes: readonly { id: string }[]): FlowFieldErrors {
  const errors: FlowFieldErrors = {};

  for (const issue of issues) {
    const path = issue.path.map(String);

    if (path[0] === "flow") {
      path.shift();
    }

    if (path[0] === "nodes" && path.length > 1 && /^\d+$/.test(path[1])) {
      path[1] = nodes[Number(path[1])]?.id ?? path[1];
    }

    const key = path.join(".");

    if (!(key in errors)) {
      errors[key] = issue.message;
    }
  }

  return errors;
}

export function flowErrorsFromAction(fieldErrors: Record<string, string[] | undefined> | undefined, nodes: readonly { id: string }[]): FlowFieldErrors {
  return flowErrorsFrom(
    Object.entries(fieldErrors ?? {}).flatMap(([key, messages]) => (messages?.[0] ? [{ message: messages[0], path: key.split(".") }] : [])),
    nodes
  );
}

/** Os erros de um passo: do proprio passo (sem o prefixo) e do conteudo dele. */
export function stepErrors(errors: FlowFieldErrors, nodeId: string) {
  const node: Record<string, string> = {};
  const content: Record<string, string> = {};

  for (const [key, message] of Object.entries(errors)) {
    if (key === `nodes.${nodeId}` || key.startsWith(`nodes.${nodeId}.`)) {
      node[key.slice(`nodes.${nodeId}`.length + 1)] = message;
    } else if (key.startsWith(`messages.${nodeId}.`)) {
      content[key.slice(`messages.${nodeId}.`.length)] = message;
    }
  }

  return { content, node };
}

/** Os erros da configuracao do fluxo (nome, quem entra, objetivo, limite de passos). */
export function settingsErrors(errors: FlowFieldErrors) {
  return Object.fromEntries(Object.entries(errors).filter(([key]) => !key.startsWith("nodes.") && !key.startsWith("messages.")));
}

/**
 * Erros de um seletor de regras (quem entra "entry.audience", objetivo "goal", a condicao e o filtro de um
 * passo) no formato do AudienceBuilder: a regra pela posicao ("1.0"); "" = o seletor inteiro.
 */
export function ruleErrorsAt(errors: Record<string, string>, prefix: string) {
  const renamed: Record<string, string> = {};

  for (const [key, message] of Object.entries(errors)) {
    if (key === prefix || key.startsWith(`${prefix}.`)) {
      renamed[`audience${key.slice(prefix.length)}`] = message;
    }
  }

  return audienceErrorsFrom(renamed);
}

/** Onde esta o primeiro erro, na ordem da tela: a configuracao ("" = nenhum passo) ou um passo. */
export function firstErrorTarget(errors: FlowFieldErrors, nodes: readonly DraftNode[]): string | null {
  if (Object.keys(settingsErrors(errors)).some((key) => key !== "nodes")) {
    return "";
  }

  for (const node of preorder(nodes)) {
    const own = stepErrors(errors, node.id);

    if (Object.keys(own.node).length > 0 || Object.keys(own.content).length > 0) {
      return node.id;
    }
  }

  return "nodes" in errors ? "" : null;
}

/** Erros de ativar que o zod nao ve (produto a escolher, nenhuma notificacao), para mostrar no passo. */
export function activationErrors(issues: readonly FlowIssue[]): FlowFieldErrors {
  const errors: FlowFieldErrors = {};

  for (const issue of issues) {
    if (issue.level !== "activation") {
      continue;
    }

    const key = issue.nodeId ? ["nodes", issue.nodeId, issue.field].filter(Boolean).join(".") : (issue.field ?? "nodes");

    if (!(key in errors)) {
      errors[key] = issue.message;
    }
  }

  return errors;
}

/* ------------------------------------------------------------------------------------------------
 * Alteracoes em andamento
 * ---------------------------------------------------------------------------------------------- */

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

function canonicalDefinition(definition: AudienceDefinition | null) {
  return definition ? normalizeAudience(definition) : null;
}

/** O rascunho como o servidor grava (regras normalizadas, nome sem espacos nas pontas, passos por id). */
export function canonicalFlowDraft(draft: FlowDraft) {
  return {
    entry: { audience: canonicalDefinition(draft.entry.audience), mode: draft.entry.mode },
    goal: canonicalDefinition(draft.goal),
    messages: draft.messages,
    name: draft.name.trim(),
    nodes: [...draft.nodes]
      .map((node) =>
        node.kind === "message"
          ? { ...node, filter: canonicalDefinition(node.filter) }
          : node.kind === "condition"
            ? { ...node, condition: canonicalDefinition(node.condition), maxWaitMinutes: node.waitUntilTrue ? node.maxWaitMinutes : null }
            : node
      )
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    origin: draft.origin
  };
}

export function isSameFlowDraft(left: FlowDraft, right: FlowDraft) {
  return stableJson(canonicalFlowDraft(left)) === stableJson(canonicalFlowDraft(right));
}

/** As regras de "Quem entra" mudaram (fluxo no ar: recontar e, em "e quem entrar depois", confirmar). */
export function entryRulesChanged(saved: FlowDraft, draft: FlowDraft) {
  return stableJson(canonicalDefinition(saved.entry.audience)) !== stableJson(canonicalDefinition(draft.entry.audience));
}

/** Passos que existiam e sairam desta versao (Aplicar alterações conta na auditoria). */
export function removedStepIds(saved: FlowDraft, draft: FlowDraft) {
  const now = new Set(draft.nodes.map((node) => node.id));

  return saved.nodes.filter((node) => !now.has(node.id)).map((node) => node.id);
}

/* ------------------------------------------------------------------------------------------------
 * Relatorio
 * ---------------------------------------------------------------------------------------------- */

/** Numeros de um passo, como fetchFlowNodeStats devolve (communication_flow_node_stats). */
export type FlowStepStats = Record<
  | "accepted"
  | "audio_completed"
  | "audio_started"
  | "cap"
  | "clicked"
  | "declined"
  | "deferred_now"
  | "expired"
  | "failed"
  | "filtered"
  | "goal"
  | "no_count"
  | "opened"
  | "reached"
  | "received"
  | "removed"
  | "seen"
  | "sent"
  | "studied_7d"
  | "visited_cta"
  | "waiting"
  | "yes_count",
  number
>;

export type ReportLine = { help?: string; id: string; label: string; share: string | null; value: number | null };

/** "—" sem dado; senao o numero com separador de milhar. */
export function formatReportValue(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? formatInteger(value) : "—";
}

export const CAP_HELP = "Não saiu por causa do limite de 3 por dia (ou de 1 hora entre elas): o prazo acabou antes, ou ficou para depois 7 vezes.";

function share(part: number | null, whole: number | null) {
  return part === null || whole === null ? null : formatPercent(ratio(part, whole));
}

/**
 * Funil de uma notificacao do fluxo (docs/23 §2.8), cada passo com a parte do anterior: Chegaram ·
 * Esperando · Receberam · Viram no sino · Abriram · áudio · Clicaram · Visitaram · respostas · Voltaram a
 * estudar em 7 dias. Sem numeros (nunca ativado), "—".
 */
export function messageReportLines(stats: FlowStepStats | null, meta: { ctaTracked: boolean; hasAudio: boolean; hasCta: boolean; hasResponse: boolean }): ReportLine[] {
  const value = (key: keyof FlowStepStats) => (stats ? stats[key] : null);
  const lines: ReportLine[] = [
    { id: "reached", label: "Chegaram", share: null, value: value("reached") },
    { id: "waiting", label: "Esperando", share: null, value: value("waiting") },
    { id: "received", label: "Receberam", share: share(value("received"), value("reached")), value: value("received") },
    { id: "seen", label: "Viram no sino", share: share(value("seen"), value("received")), value: value("seen") },
    { id: "opened", label: "Abriram", share: share(value("opened"), value("seen")), value: value("opened") }
  ];

  if (meta.hasAudio) {
    lines.push(
      { id: "audio_started", label: "Começaram o áudio", share: share(value("audio_started"), value("opened")), value: value("audio_started") },
      { id: "audio_completed", label: "Ouviram até o fim", share: share(value("audio_completed"), value("audio_started")), value: value("audio_completed") }
    );
  }

  if (meta.hasCta) {
    lines.push({ id: "clicked", label: "Clicaram no botão", share: share(value("clicked"), value("opened")), value: value("clicked") });
  }

  if (meta.hasCta && meta.ctaTracked) {
    lines.push({ id: "visited_cta", label: "Visitaram a página do botão", share: share(value("visited_cta"), value("clicked")), value: value("visited_cta") });
  }

  if (meta.hasResponse) {
    lines.push(
      { id: "accepted", label: "Aceitaram", share: share(value("accepted"), value("opened")), value: value("accepted") },
      { id: "declined", label: "Recusaram", share: share(value("declined"), value("opened")), value: value("declined") }
    );
  }

  lines.push({ id: "studied_7d", label: "Voltaram a estudar em 7 dias", share: share(value("studied_7d"), value("seen")), value: value("studied_7d") });

  return lines;
}

/**
 * Rotulo do "removido" de 7.8, que junta passo removido, passo retirado do sino, fluxo encerrado e
 * notificacao principal retirada (nao so "passo removido": Encerrar e Retirar tambem caem aqui).
 */
export const REMOVED_REASON_LABEL = "passo removido, retirado ou fluxo encerrado";

/** "Não receberam 28" e os motivos: fora do filtro · atingiram o objetivo antes · venceu o prazo · limite do dia · passo removido... */
export function notReceivedLines(stats: FlowStepStats | null) {
  if (!stats) {
    return { deferred: null, parts: [], total: null };
  }

  const parts = [
    { id: "filtered", label: "fora do filtro", value: stats.filtered },
    { id: "goal", label: "atingiram o objetivo antes", value: stats.goal },
    { id: "expired", label: "venceu o prazo", value: stats.expired },
    { help: CAP_HELP, id: "cap", label: "limite do dia", value: stats.cap },
    { id: "removed", label: REMOVED_REASON_LABEL, value: stats.removed },
    ...(stats.failed > 0 ? [{ id: "failed", label: "falharam", value: stats.failed }] : [])
  ];

  return { deferred: stats.deferred_now, parts, total: parts.reduce((sum, part) => sum + part.value, 0) };
}

/** "fora do filtro 12 · atingiram o objetivo antes 6 · …" (so os motivos com alguem). */
export function describeNotReceived(parts: readonly { label: string; value: number }[]) {
  return parts
    .filter((part) => part.value > 0)
    .map((part) => `${part.label} ${formatInteger(part.value)}`)
    .join(" · ");
}

export function conditionReportLines(stats: FlowStepStats | null): ReportLine[] {
  const value = (key: keyof FlowStepStats) => (stats ? stats[key] : null);

  return [
    { id: "reached", label: "Chegaram", share: null, value: value("reached") },
    { id: "yes", label: "Sim", share: share(value("yes_count"), value("reached")), value: value("yes_count") },
    { id: "no", label: "Não", share: share(value("no_count"), value("reached")), value: value("no_count") },
    { id: "waiting", label: "Esperando", share: null, value: value("waiting") }
  ];
}

/** Numeros do fluxo, como fetchFlowStats devolve. */
export type FlowTotals = { active: number; done: number; ended: number; entered: number; goal: number; sent: number };

/** "Quem entra": Entraram (12 hoje) · No fluxo agora · Atingiram o objetivo · Terminaram; no de aviso, Receberam a notificação principal. */
export function entryReportLines(input: { enteredToday: number | null; hasGoal: boolean; origin: FlowOrigin; sourceRecipients: number | null; totals: FlowTotals | null }): ReportLine[] {
  const totals = input.totals;
  const lines: ReportLine[] = [];

  if (input.origin === "notice") {
    lines.push({ id: "source", label: "Receberam a notificação principal", share: null, value: input.sourceRecipients });
  }

  lines.push(
    {
      help: typeof input.enteredToday === "number" ? `${formatInteger(input.enteredToday)} hoje` : undefined,
      id: "entered",
      label: "Entraram",
      share: null,
      value: totals ? totals.entered : null
    },
    { id: "active", label: "No fluxo agora", share: null, value: totals ? totals.active : null },
    { id: "goal", label: "Atingiram o objetivo", share: null, value: totals && input.hasGoal ? totals.goal : null },
    { id: "done", label: "Terminaram", share: null, value: totals ? totals.done + totals.ended : null }
  );

  return lines;
}

/** So quando ha tarefa vencida ha mais de 10 minutos (communication_flow_stats.overdue). */
export function backlogLine(overdue: number | null | undefined) {
  return typeof overdue === "number" && overdue > 0 ? `Algumas notificações estão saindo com atraso (fila de ${formatInteger(overdue)}).` : null;
}

/** "Passo removido em 21/10" (dia e mes em Sao Paulo). */
export function removedStepLabel(removedAt: string) {
  const date = new Date(Date.parse(removedAt) - 3 * 3_600_000);

  return Number.isFinite(date.getTime())
    ? `Passo removido em ${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`
    : "Passo removido";
}

/** Numeros da linha da lista (rascunho e quem nunca entrou: "—"). */
export function flowRowNumbers(item: { hasGoal: boolean; totals: FlowTotals | null }) {
  const totals = item.totals;

  return {
    active: formatReportValue(totals?.active),
    entered: formatReportValue(totals?.entered),
    goal: item.hasGoal ? formatReportValue(totals?.goal) : "—",
    sent: formatReportValue(totals?.sent)
  };
}

/** Linha do cartao no celular: "No fluxo agora 140". */
export function inFlowNowLine(totals: FlowTotals | null) {
  return `No fluxo agora ${formatReportValue(totals?.active)}`;
}

/** Os dias de "Fica no sino por" padrao (para a frase de um conteudo sem validade). */
export const DEFAULT_VALIDITY_MINUTES = VALIDITY_LIMITS.defaultMinutes;
