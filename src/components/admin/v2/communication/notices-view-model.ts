// Comunicacao > Avisos e pop-ups no admin (docs/22 §2; docs/17 §1.8): enderecos e filtros da lista,
// numeros das linhas e do relatorio, rotulos e confirmacoes das acoes, botao principal do editor, a
// previa montada a partir do rascunho, as pecas do construtor de segmento e as contas do audio
// (forma de onda, duracao, formato da gravacao). Modulo puro (sem React, imports relativos):
// tests/comunicacao-admin-modelo.test.mjs carrega direto pelo Node e as telas usam as mesmas regras.
// v2 (docs/23): as dicas de "Quem envia", o icone com a cor sugerida, as pilulas de "Fica no sino por",
// a previa com quem envia, o "Termina em" e o audio ouvido, e o funil com "Abriram" e o audio.

import {
  AUDIENCE_LIMITS,
  countAudienceRules,
  isAudienceGroup,
  MESSAGE_ACTIONS,
  messageRefKey,
  normalizeAudience,
  type AudienceDefinition,
  type AudienceGroup,
  type AudienceNames,
  type AudienceNode,
  type AudienceRule,
  type AudienceRuleType,
  type MessageAction,
  type MessageRef
} from "../../../../server/communications/audience-model";
import {
  AUDIO_LIMITS,
  isEditableStatus,
  isLiveNoticeStatus,
  isoToSaoPauloLocal,
  publishDecision,
  saoPauloLocalToIso,
  type CampaignKind,
  type CampaignSituation,
  type CampaignStatus,
  type NoticeAction,
  type NoticePermissions
} from "../../../../server/communications/campaign-model";
import { notificationPollOf } from "../../../../server/communications/interactions-model";
import type { NotificationItem, PopupItem } from "../../../../server/communications/notification-model";
import type { NoticeDraft } from "../../../../server/communications/schemas";
// v2 (docs/23): quem envia, icone ao lado do titulo e quanto tempo fica no sino.
import {
  computeExpiresAt,
  NOTICE_ICON_COLOR_LABELS,
  NOTICE_ICON_LABELS,
  NOTICE_ICON_SUGGESTED_COLOR,
  validityToColumns,
  VALIDITY_LIMITS,
  type FlowValidity,
  type NoticeIconId
} from "../../../../server/communications/message-meta";
import { AUDIO_HEARD_SLOTS } from "../../../../server/communications/notification-model";

/* ------------------------------------------------------------------------------------------------
 * Enderecos e filtros
 * ---------------------------------------------------------------------------------------------- */

export const NOTICES_HREF = "/admin/comunicacao/avisos";
export const NEW_NOTICE_HREF = `${NOTICES_HREF}/novo`;

/** ?tipo= da lista e do "Novo aviso": notificacao | popup. */
export const NOTICE_KIND_PARAM = "tipo";
export const NOTICE_PAGE_PARAM = "pagina";
export const NOTICE_EDIT_PARAM = "editar";

const KIND_PARAM_VALUES: Record<CampaignKind, string> = { inbox: "notificacao", popup: "popup" };

type ParamValue = string | string[] | undefined | null;

function firstParam(value: ParamValue) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export function parseNoticeKindParam(value: ParamValue): CampaignKind | undefined {
  const text = firstParam(value).toLowerCase();

  return text === KIND_PARAM_VALUES.inbox ? "inbox" : text === KIND_PARAM_VALUES.popup ? "popup" : undefined;
}

/** Pagina da lista (?pagina=); invalido volta para 1. */
export function parseNoticesPage(value: ParamValue) {
  const page = Number(firstParam(value));

  return Number.isInteger(page) && page > 1 && page <= 10_000 ? page : 1;
}

/**
 * ?pagina= depois da ultima pagina (endereco antigo ou digitado, ou avisos excluidos em outra tela):
 * o endereco da ultima pagina com avisos (ou da primeira, sem ?pagina=, quando nao ha nenhum), com os
 * outros filtros. Pagina que existe ou que ainda tem linhas: null (nada a corrigir).
 */
export function noticesPageFallbackHref(input: {
  itemCount: number;
  page: number;
  pageSize: number;
  searchParams: Record<string, ParamValue>;
  total: number;
}): string | null {
  if (input.page <= 1 || input.itemCount > 0) {
    return null;
  }

  const lastPage = Math.max(1, Math.ceil(Math.max(0, input.total) / Math.max(1, input.pageSize)));

  if (lastPage >= input.page) {
    return null;
  }

  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(input.searchParams)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === "string") {
        params.append(key, item);
      }
    }
  }

  if (lastPage > 1) {
    params.set(NOTICE_PAGE_PARAM, String(lastPage));
  } else {
    params.delete(NOTICE_PAGE_PARAM);
  }

  const query = params.toString();

  return query ? `${NOTICES_HREF}?${query}` : NOTICES_HREF;
}

/** Editor ou relatorio de um aviso (`edit` abre o editor de um pop-up no ar). */
export function noticeHref(id: string, options: { edit?: boolean } = {}) {
  const base = `${NOTICES_HREF}/${encodeURIComponent(id)}`;

  return options.edit ? `${base}?${NOTICE_EDIT_PARAM}=1` : base;
}

/**
 * /avisos/[id] abre o editor ou o relatorio? Rascunho, aguardando aprovacao e notificacao agendada abrem
 * no editor. Pop-up no ar ou pausado abre no relatorio; no editor so com ?editar=1 e se a pessoa pode
 * editar ("edit" nas acoes, a mesma regra do servidor: editar pop-up no ar pede messaging.publish).
 */
export function opensNoticeEditor(input: {
  actions: readonly NoticeAction[];
  kind: CampaignKind;
  situation: CampaignSituation;
  status: CampaignStatus;
  wantsEditor: boolean;
}) {
  if (!isEditableStatus(input.kind, input.status) || input.situation === "ended") {
    return false;
  }

  // v3a: a notificacao enviada (isEditableStatus) abre como o pop-up no ar: relatorio, e editor so com ?editar=1.
  return !isLiveNoticeStatus(input.kind, input.status) || (input.wantsEditor && input.actions.includes("edit"));
}

export function newNoticeHref(kind?: CampaignKind) {
  return kind === "popup" ? `${NEW_NOTICE_HREF}?${NOTICE_KIND_PARAM}=${KIND_PARAM_VALUES.popup}` : NEW_NOTICE_HREF;
}

export const NOTICE_KIND_FILTERS: readonly { kind: CampaignKind | undefined; label: string }[] = [
  { kind: undefined, label: "Todos" },
  { kind: "inbox", label: "Notificações" },
  { kind: "popup", label: "Pop-ups" }
];

/** Filtro da lista mantendo o periodo da barra superior; trocar de filtro volta para a pagina 1. */
export function noticesFilterHref(current: Record<string, ParamValue>, kind: CampaignKind | undefined) {
  const params = new URLSearchParams();
  const period = firstParam(current.periodo);

  if (period) {
    params.set("periodo", period);
  }

  if (kind) {
    params.set(NOTICE_KIND_PARAM, KIND_PARAM_VALUES[kind]);
  }

  const query = params.toString();

  return query ? `${NOTICES_HREF}?${query}` : NOTICES_HREF;
}

/* ------------------------------------------------------------------------------------------------
 * Numeros
 * ---------------------------------------------------------------------------------------------- */

const integerFormat = new Intl.NumberFormat("pt-BR");
const percentFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export function formatInteger(value: number) {
  return integerFormat.format(value);
}

/** "1 aluno", "318 alunos"; sem contagem, "—". */
export function formatStudentCount(count: number | null | undefined) {
  if (typeof count !== "number" || !Number.isFinite(count)) {
    return "—";
  }

  return count === 1 ? "1 aluno" : `${integerFormat.format(count)} alunos`;
}

/** Nomes de amostra do segmento: "Ana Souza, Bruno Lima e mais 316" ou "Ana e Bruno". */
export function describeSampleNames(names: readonly string[], total: number) {
  const list = names.map((name) => name.trim()).filter(Boolean);

  if (list.length === 0) {
    return "";
  }

  const rest = Math.max(0, total - list.length);

  if (rest > 0) {
    return `${list.join(", ")} e mais ${integerFormat.format(rest)}`;
  }

  return list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`;
}

/** Parte sobre o todo, 0..100 com uma casa; sem base, null. */
export function ratio(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

/** "8%", "12,5%"; sem valor, "—". */
export function formatPercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${percentFormat.format(value)}%` : "—";
}

/** Coluna Cliques: "12 · 8%" (so o numero quando ninguem viu ainda). */
export function formatClicks(clicked: number, rate: number | null) {
  return rate === null ? integerFormat.format(clicked) : `${integerFormat.format(clicked)} · ${formatPercent(rate)}`;
}

/** Rascunho, aguardando aprovacao e agendado nunca chegaram aos alunos: nao ha numero para mostrar. */
export function noticeNeverSent(situation: CampaignSituation) {
  return situation === "draft" || situation === "pending_approval" || situation === "scheduled";
}

/** Vistos e Cliques de uma linha da lista; aviso que nunca saiu mostra "—" (sem dado, docs/17). */
export function noticeRowNumbers(item: { clickRate: number | null; situation: CampaignSituation; stats: { clicked: number; seen: number } }) {
  if (noticeNeverSent(item.situation)) {
    return { clicks: "—", seen: "—" };
  }

  return { clicks: formatClicks(item.stats.clicked, item.clickRate), seen: formatInteger(item.stats.seen) };
}

/* ------------------------------------------------------------------------------------------------
 * Acoes de cada aviso (lista, editor e relatorio)
 * ---------------------------------------------------------------------------------------------- */

export const NOTICE_ACTION_LABELS: Record<NoticeAction, string> = {
  approve: "Aprovar e publicar",
  cancel_schedule: "Cancelar agendamento",
  delete: "Excluir",
  duplicate: "Duplicar",
  edit: "Editar",
  end: "Encerrar",
  pause: "Pausar",
  publish: "Publicar",
  reject: "Recusar pedido",
  // v3a (docs/24 §2.1)
  reshow: "Mostrar de novo para quem já viu",
  resume: "Retomar",
  send_test: "Enviar teste para mim",
  view_report: "Ver relatório",
  withdraw: "Retirar do sino"
};

/** Ordem no menu "…": o que mais se usa primeiro, o que tira do ar e exclui por ultimo. */
const MENU_ORDER: readonly NoticeAction[] = [
  "edit",
  "approve",
  "reject",
  "pause",
  "resume",
  "send_test",
  "duplicate",
  "cancel_schedule",
  "end",
  "withdraw",
  "delete"
];

const DESTRUCTIVE_ACTIONS = new Set<NoticeAction>(["delete", "end", "withdraw"]);
const CONFIRMED_ACTIONS = new Set<NoticeAction>(["approve", "delete", "end", "reject", "withdraw"]);

export type NoticeMenuEntry = { action: NoticeAction; destructive: boolean; label: string; separated: boolean };

/**
 * Itens do menu "…" na ordem certa. "Publicar" fica no editor (precisa da revisao e da contagem);
 * `exclude` tira o que a tela ja mostra como botao.
 */
export function noticeMenuEntries(actions: readonly NoticeAction[], exclude: readonly NoticeAction[] = []): NoticeMenuEntry[] {
  const available = new Set(actions.filter((action) => action !== "publish" && !exclude.includes(action)));
  const ordered = MENU_ORDER.filter((action) => available.has(action));

  return ordered.map((action, index) => ({
    action,
    destructive: DESTRUCTIVE_ACTIONS.has(action),
    label: NOTICE_ACTION_LABELS[action],
    // Uma linha antes do primeiro item que tira do ar ou exclui.
    separated: index > 0 && DESTRUCTIVE_ACTIONS.has(action) && !DESTRUCTIVE_ACTIONS.has(ordered[index - 1])
  }));
}

export function noticeActionNeedsConfirm(action: NoticeAction) {
  return CONFIRMED_ACTIONS.has(action);
}

export type NoticeConfirmCopy = { confirmLabel: string; description: string; destructive: boolean; title: string };

/**
 * Textos do dialogo de confirmacao (nunca window.confirm). v2 (docs/23 §2.2): retirar uma notificacao com
 * seguintes (`followUps.count` > 0) avisa que elas deixam de sair; a caixa "Retirar também as notificações
 * seguintes que já saíram (n)" fica no dialogo (notice-row-menu.tsx).
 */
export function noticeActionConfirm(
  action: NoticeAction,
  notice: {
    audienceCount: number | null;
    followUps?: { count: number; sent: number } | null;
    kind: CampaignKind;
    recipients?: number | null;
    title: string;
  }
): NoticeConfirmCopy {
  const title = notice.title.trim() || "este aviso";

  switch (action) {
    case "approve":
      return {
        confirmLabel: "Aprovar e publicar",
        description:
          notice.kind === "inbox"
            ? `A notificação vai para o sino de ${formatStudentCount(notice.audienceCount)} (ou na data agendada). A contagem é refeita na hora de publicar.`
            : `O pop-up entra na home de ${formatStudentCount(notice.audienceCount)}. A contagem é refeita na hora de publicar.`,
        destructive: false,
        title: `Aprovar “${title}”?`
      };
    case "reject":
      return {
        confirmLabel: "Recusar pedido",
        description: "O aviso volta para rascunho. Quem pediu pode ajustar e pedir de novo.",
        destructive: false,
        title: "Recusar o pedido de aprovação?"
      };
    case "end":
      return {
        confirmLabel: "Encerrar pop-up",
        description: "O pop-up sai da home de todos os alunos agora e não volta. Para mostrar de novo, duplique.",
        destructive: true,
        title: `Encerrar “${title}”?`
      };
    case "withdraw":
      return {
        confirmLabel: "Retirar do sino",
        description: `A notificação some do sino ${
          typeof notice.recipients === "number" && notice.recipients > 0 ? `dos ${formatStudentCount(notice.recipients)} que receberam` : "de quem recebeu"
        }. Os números continuam no relatório.${notice.followUps && notice.followUps.count > 0 ? " As notificações seguintes deixam de sair." : ""}`,
        destructive: true,
        title: `Retirar “${title}” do sino?`
      };
    case "delete":
      return {
        confirmLabel: "Excluir aviso",
        description: "O aviso sai desta lista. Não dá para desfazer.",
        destructive: true,
        title: `Excluir “${title}”?`
      };
    default:
      return { confirmLabel: NOTICE_ACTION_LABELS[action], description: "", destructive: false, title: NOTICE_ACTION_LABELS[action] };
  }
}

/** Toast de sucesso de cada acao (erro nunca vai para toast). */
export const NOTICE_ACTION_TOASTS: Partial<Record<NoticeAction, string>> = {
  cancel_schedule: "Agendamento cancelado. O aviso voltou para rascunho.",
  delete: "Aviso excluído.",
  duplicate: "Aviso duplicado como rascunho.",
  end: "Pop-up encerrado.",
  pause: "Pop-up pausado.",
  reject: "Pedido recusado. O aviso voltou para rascunho.",
  resume: "Pop-up de volta no ar.",
  send_test: "Enviamos a notificação para o seu sino.",
  withdraw: "Notificação retirada do sino."
};

/** Toast depois de publicar ou aprovar, conforme o que o servidor decidiu. */
export function publishedNoticeToast(result: { audienceCount: number; recipients: number | null; situation: CampaignSituation }, kind: CampaignKind) {
  switch (result.situation) {
    case "pending_approval":
      return "Enviado para aprovação.";
    case "scheduled":
      return kind === "inbox" ? "Envio agendado." : "Pop-up publicado.";
    case "sent":
      return `Notificação enviada para ${formatStudentCount(result.recipients ?? result.audienceCount)}.`;
    case "sending":
      return "Enviando a notificação. Os números aparecem em instantes.";
    default:
      return kind === "popup" ? "Pop-up publicado." : "Aviso publicado.";
  }
}

/* ------------------------------------------------------------------------------------------------
 * Editor
 * ---------------------------------------------------------------------------------------------- */

export type PrimaryIntent = "approval" | "popup" | "schedule" | "send_now";

export const PRIMARY_INTENT_LABELS: Record<PrimaryIntent, string> = {
  approval: "Enviar para aprovação",
  popup: "Publicar pop-up",
  schedule: "Agendar envio",
  send_now: "Enviar agora"
};

/**
 * Botao principal do editor: o mesmo criterio do servidor (publishDecision), com a contagem ao vivo.
 * Sem contagem ainda, vale a ultima conhecida (0 = nao passa do limite). O servidor decide de novo.
 */
export function primaryIntentFor(input: {
  audienceCount: number | null;
  kind: CampaignKind;
  permissions: Pick<NoticePermissions, "canPublish" | "canPublishLarge">;
  scheduleMode: "at" | "now";
}): PrimaryIntent {
  const decision = publishDecision({
    audienceCount: input.audienceCount ?? 0,
    canPublish: input.permissions.canPublish,
    canPublishLarge: input.permissions.canPublishLarge
  });

  if (decision === "needs_approval") {
    return "approval";
  }

  if (input.kind === "popup") {
    return "popup";
  }

  return input.scheduleMode === "at" ? "schedule" : "send_now";
}

/**
 * Situacao gravada depois de publicar pelo editor: na notificacao, a que o servidor devolveu (agendado,
 * enviando, enviado ou aguardando aprovacao); no pop-up, aguardando aprovacao ou no ar ("Agendado" do
 * pop-up e so a janela que ainda nao comecou: a situacao gravada e "active").
 */
export function noticeStatusAfterPublish(kind: CampaignKind, situation: CampaignSituation): CampaignStatus {
  if (kind === "inbox" || situation === "pending_approval") {
    return situation;
  }

  return "active";
}

export const NOTHING_TO_SAVE_MESSAGE = "Nenhuma mudança para salvar.";

/** Salvar uma mudanca volta agendado e aguardando aprovacao para rascunho: a frase que conta isso. */
export function draftSaveSideEffect(previousStatus: CampaignStatus | null | undefined) {
  if (previousStatus === "scheduled") {
    return "O envio agendado foi cancelado: agende de novo.";
  }

  if (previousStatus === "pending_approval") {
    return "O pedido de aprovação foi cancelado.";
  }

  return null;
}

/** Toast de "Salvar rascunho" (ou "Salvar alterações" no pop-up no ar), pela situacao antes de salvar. */
export function savedNoticeToast(kind: CampaignKind, previousStatus: CampaignStatus | null | undefined) {
  if (isLivePopupStatus(kind, previousStatus)) {
    return previousStatus === "paused" ? "Pop-up salvo. Ele continua pausado." : "Pop-up atualizado. Quem já fechou não vê de novo.";
  }

  const sideEffect = draftSaveSideEffect(previousStatus);

  return sideEffect ? `Rascunho salvo. ${sideEffect}` : "Rascunho salvo.";
}

/** Toast de "Enviar teste para mim"; se o teste salvou uma mudanca antes, conta o que isso desfez. */
export function testSentToast(savedChange: boolean, previousStatus: CampaignStatus | null | undefined) {
  const sideEffect = savedChange ? draftSaveSideEffect(previousStatus) : null;

  return sideEffect ? `Enviamos a notificação para o seu sino. ${sideEffect}` : "Enviamos a notificação para o seu sino.";
}

/** Titulo do banner de erro do editor: o que ficou gravado e o que nao saiu. */
export function noticeFailureTitle(input: { savedDraft: boolean; status: number; step: "approve" | "publish" | "save" | "test" }) {
  if (input.status === 409) {
    return "Este aviso mudou em outra tela";
  }

  switch (input.step) {
    case "approve":
      return "Há mudanças sem salvar";
    case "publish":
      return input.savedDraft ? "O rascunho foi salvo, mas o aviso não saiu" : "O aviso não foi salvo";
    case "test":
      return input.savedDraft ? "O rascunho foi salvo, mas o teste não saiu" : "O teste não saiu";
    default:
      return "O aviso não foi salvo";
  }
}

/** Pop-up publicado (no ar, agendado pela janela ou pausado): editar salva sem sair do ar. */
export function isLivePopupStatus(kind: CampaignKind, status: CampaignStatus | null | undefined) {
  return kind === "popup" && (status === "active" || status === "paused");
}

/** Tipo travado depois de publicado (notificacao agendada ou enviada, pop-up no ar ou pausado). */
export function isNoticeKindLocked(status: CampaignStatus | null | undefined) {
  return status === "scheduled" || status === "sent" || status === "active" || status === "paused";
}

/**
 * O que vai para o servidor: so os campos do tipo escolhido. O editor guarda o resto (trocar de tipo e
 * voltar nao perde a janela do pop-up nem a resposta, a enquete e as reacoes da notificacao), mas nada
 * disso e validado nem gravado no outro tipo. O pop-up abre o destino pelo botao (v3a).
 */
export function noticeDraftForKind(draft: NoticeDraft): NoticeDraft {
  if (draft.kind === "inbox") {
    return { ...draft, allowSnooze: true, repeat: "once", window: { endsAt: null, startsAt: null } };
  }

  return {
    ...draft,
    cta: draft.cta ? { ...draft.cta, display: "button" } : null,
    poll: null,
    reactions: false,
    response: null,
    schedule: { mode: "now" },
    sender: null,
    validity: { mode: "default" }
  };
}

function isoOrRaw(value: string) {
  const time = Date.parse(value);

  return Number.isFinite(time) ? new Date(time).toISOString() : value;
}

/**
 * Forma canonica do rascunho, igual ao que o servidor grava (textos aparados, segmento normalizado,
 * datas em ISO, campos que nao valem para o tipo zerados): base do "tem mudanca nao salva".
 */
export function canonicalNoticeDraft(draft: NoticeDraft): NoticeDraft {
  const inbox = draft.kind === "inbox";

  return {
    allowSnooze: inbox ? true : draft.allowSnooze,
    audience: normalizeAudience(draft.audience),
    audio: draft.audio ? { ...draft.audio, peaks: [...draft.audio.peaks] } : null,
    body: draft.body.trim(),
    cta: draft.cta
      ? { display: inbox ? (draft.cta.display ?? "button") : "button", href: draft.cta.href.trim(), label: draft.cta.label.trim(), target: draft.cta.target }
      : null,
    icon: draft.icon ? { color: draft.icon.color, id: draft.icon.id } : null,
    image: draft.image ? { alt: draft.image.alt.trim(), url: draft.image.url.trim() } : null,
    kind: draft.kind,
    // v3a: enquete com textos aparados e o fim em ISO (como pollSchema grava); reacoes so na notificacao.
    poll:
      inbox && draft.poll
        ? {
            closesAt: draft.poll.closesAt === null ? null : isoOrRaw(draft.poll.closesAt),
            multiple: draft.poll.multiple,
            options: draft.poll.options.map((option) => ({ id: option.id, label: option.label.trim() })),
            question: draft.poll.question.trim(),
            showResults: draft.poll.showResults
          }
        : null,
    reactions: inbox ? (draft.reactions ?? false) : false,
    repeat: inbox ? "once" : draft.repeat,
    response: inbox && draft.response ? { acceptLabel: draft.response.acceptLabel.trim(), declineLabel: draft.response.declineLabel.trim() } : null,
    schedule: inbox && draft.schedule.mode === "at" ? { mode: "at", sendAt: isoOrRaw(draft.schedule.sendAt) } : { mode: "now" },
    sender: inbox && draft.sender ? { userId: draft.sender.userId } : null,
    title: draft.title.trim(),
    validity: !inbox
      ? { mode: "default" }
      : draft.validity.mode === "until"
        ? { endsAt: isoOrRaw(draft.validity.endsAt), mode: "until" }
        : draft.validity.mode === "duration"
          ? { minutes: draft.validity.minutes, mode: "duration" }
          : { mode: "default" },
    window: inbox
      ? { endsAt: null, startsAt: null }
      : {
          endsAt: draft.window.endsAt === null ? null : isoOrRaw(draft.window.endsAt),
          startsAt: draft.window.startsAt === null ? null : isoOrRaw(draft.window.startsAt)
        }
  };
}

/** JSON com as chaves em ordem (comparacao estavel). */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value ?? null);
}

export function isSameNoticeDraft(left: NoticeDraft, right: NoticeDraft) {
  return stableJson(canonicalNoticeDraft(left)) === stableJson(canonicalNoticeDraft(right));
}

/**
 * "Recarregar" depois de um 409: o que o produtor mudou aqui fica; o que ele nao mexeu segue a versao
 * nova do banco (campo a campo do rascunho: titulo, texto, imagem, segmento...).
 */
export function rebaseNoticeDraft(base: NoticeDraft, local: NoticeDraft, server: NoticeDraft): NoticeDraft {
  const result = { ...local } as Record<keyof NoticeDraft, unknown>;
  const canonicalBase = canonicalNoticeDraft(base);
  const canonicalLocal = canonicalNoticeDraft(local);

  for (const key of Object.keys(server) as (keyof NoticeDraft)[]) {
    if (stableJson(canonicalBase[key]) === stableJson(canonicalLocal[key])) {
      result[key] = server[key];
    }
  }

  return result as NoticeDraft;
}

export type NoticeFieldErrors = Record<string, string>;

/** Problemas do zod (ou fieldErrors da Server Action) -> primeira mensagem de cada campo ("cta.href"). */
export function noticeErrorsFrom(issues: readonly { message: string; path: readonly PropertyKey[] }[]): NoticeFieldErrors {
  const errors: NoticeFieldErrors = {};

  for (const issue of issues) {
    const key = issue.path.map(String).join(".");

    if (!(key in errors)) {
      errors[key] = issue.message;
    }
  }

  return errors;
}

/** fieldErrors da ActionResult ({ "cta.href": ["..."] }) no mesmo formato. */
export function noticeErrorsFromAction(fieldErrors: Record<string, string[] | undefined> | undefined): NoticeFieldErrors {
  const errors: NoticeFieldErrors = {};

  for (const [key, messages] of Object.entries(fieldErrors ?? {})) {
    const message = messages?.[0];

    if (message) {
      errors[key.startsWith("draft.") ? key.slice("draft.".length) : key] = message;
    }
  }

  return errors;
}

/**
 * Erros do segmento por regra: "audience.root.items.1.items.0.percent" -> chave "1.0" (posicao da
 * regra dentro dos grupos). Erro do segmento inteiro fica na chave "".
 */
export function audienceErrorsFrom(errors: NoticeFieldErrors): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, message] of Object.entries(errors)) {
    if (key !== "audience" && !key.startsWith("audience.")) {
      continue;
    }

    const parts = key.split(".").slice(1);
    const indexes: number[] = [];

    if (parts[0] === "root") {
      for (let index = 1; index + 1 < parts.length && parts[index] === "items"; index += 2) {
        const position = Number(parts[index + 1]);

        if (!Number.isInteger(position)) {
          break;
        }

        indexes.push(position);
      }
    }

    const nodeKey = audienceNodeKey(indexes);

    if (!(nodeKey in result)) {
      result[nodeKey] = message;
    }
  }

  return result;
}

const DAY_MS = 86_400_000;

function addDays(date: string, days: number) {
  const base = new Date(`${date}T12:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);

  return base.toISOString().slice(0, 10);
}

/** "Agendar": amanha as 09:00 de Sao Paulo. */
export function defaultSendAt(now: number) {
  const today = isoToSaoPauloLocal(new Date(now).toISOString())?.date ?? new Date(now).toISOString().slice(0, 10);

  return saoPauloLocalToIso(addDays(today, 1), "09:00") ?? new Date(now + DAY_MS).toISOString();
}

/** "Termina em uma data": 7 dias depois do inicio (ou de hoje), as 23:59 de Sao Paulo. */
export function defaultWindowEnd(startsAt: string | null, now: number) {
  const startTime = startsAt ? Date.parse(startsAt) : Number.NaN;
  const base = Number.isFinite(startTime) && startTime > now ? startTime : now;
  const day = isoToSaoPauloLocal(new Date(base).toISOString())?.date ?? new Date(base).toISOString().slice(0, 10);

  return saoPauloLocalToIso(addDays(day, 7), "23:59") ?? new Date(base + 7 * DAY_MS).toISOString();
}

/* ------------------------------------------------------------------------------------------------
 * Editor v2: quem envia, icone ao lado do titulo e quanto tempo fica no sino (docs/23)
 * ---------------------------------------------------------------------------------------------- */

/** Pessoa da equipe em "Quem envia" (o mesmo formato de NoticeEditorOptions.senders). */
export type NoticeSenderChoice = { avatarUrl: string | null; id: string; isMe: boolean; name: string; roleLabel: string };

/** Valor da escola no seletor "Quem envia" (o resto e o id da pessoa). */
export const SCHOOL_SENDER_VALUE = "escola";
export const PROFILE_PHOTO_HREF = "/perfil";
export const BRAND_HREF = "/admin/area-de-membros/marca";
const UNKNOWN_PUBLISHER = "Alguém da equipe";

export type NoticeSenderOption = { avatarUrl: string | null; isSchool: boolean; label: string; name: string; value: string };

/**
 * Opcoes de "Quem envia": a escola (padrao), "Eu (...)" e o resto da equipe em ordem alfabetica
 * ("Carlos Lima · Professor"). Quem ja estava gravado e saiu da equipe aparece no fim, para o seletor
 * mostrar o valor (a dica explica que sai como a escola).
 */
export function noticeSenderOptions(input: {
  saved?: { id: string; name: string } | null;
  schoolIconUrl: string | null;
  schoolName: string;
  senders: readonly NoticeSenderChoice[];
}): NoticeSenderOption[] {
  const me = input.senders.find((person) => person.isMe);
  const others = input.senders
    .filter((person) => !person.isMe)
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR") || left.id.localeCompare(right.id));
  const options: NoticeSenderOption[] = [
    { avatarUrl: input.schoolIconUrl, isSchool: true, label: `${input.schoolName} (a escola)`, name: input.schoolName, value: SCHOOL_SENDER_VALUE },
    ...(me ? [{ avatarUrl: me.avatarUrl, isSchool: false, label: `Eu (${me.name})`, name: me.name, value: me.id }] : []),
    ...others.map((person) => ({ avatarUrl: person.avatarUrl, isSchool: false, label: `${person.name} · ${person.roleLabel}`, name: person.name, value: person.id }))
  ];

  if (input.saved && !input.senders.some((person) => person.id === input.saved?.id)) {
    options.push({ avatarUrl: null, isSchool: false, label: `${input.saved.name} · fora da equipe`, name: input.saved.name, value: input.saved.id });
  }

  return options;
}

export type NoticeSenderHint = {
  link: { href: string; label: string; newTab: boolean } | null;
  text: string;
  tone: "neutral" | "warning";
  /** A dica pede a foto em Perfil: o editor rele a equipe quando a janela volta ao foco. */
  watchesProfile: boolean;
};

/**
 * A dica embaixo de "Quem envia", uma por vez (a primeira que vale): quem saiu da equipe; "Eu" sem
 * foto (com o link para Perfil); outra pessoa (o e-mail que ela recebe, e o pedido de foto se nao
 * tiver); a escola para quem mexe na Marca; e o padrao.
 */
export function noticeSenderHint(input: {
  canEditBrand: boolean;
  saved?: { id: string; name: string } | null;
  schoolName: string;
  sender: { userId: string } | null;
  senders: readonly NoticeSenderChoice[];
}): NoticeSenderHint {
  const hint = (text: string, extra: Partial<NoticeSenderHint> = {}): NoticeSenderHint => ({ link: null, text, tone: "neutral", watchesProfile: false, ...extra });
  const me = input.senders.find((person) => person.isMe);

  if (input.sender) {
    const userId = input.sender.userId;
    const person = input.senders.find((item) => item.id === userId);

    if (!person) {
      const name = input.saved?.id === userId ? input.saved.name : "A pessoa escolhida";

      return hint(`${name} não está mais na equipe: a notificação sai como ${input.schoolName}.`, { tone: "warning" });
    }

    if (person.isMe) {
      if (!person.avatarUrl) {
        return hint("Você ainda não tem foto: o aluno vê as suas iniciais.", {
          link: { href: PROFILE_PHOTO_HREF, label: "Colocar a minha foto em Perfil", newTab: true },
          watchesProfile: true
        });
      }
    } else {
      const email = `Quando sair, ${person.name} recebe um e-mail avisando: “${me?.name ?? UNKNOWN_PUBLISHER} enviou uma notificação em seu nome”.`;
      const photo = person.avatarUrl
        ? ""
        : ` ${person.name} ainda não tem foto: o aluno vê as iniciais. Peça para ${person.name} colocar a foto no Perfil da área de membros.`;

      return hint(`${email}${photo}`);
    }
  } else if (input.canEditBrand) {
    return hint("O círculo mostra o ícone da escola.", { link: { href: BRAND_HREF, label: "Trocar em Área de membros › Marca", newTab: true } });
  }

  return hint("O aluno vê a foto e o nome de quem envia. Só pessoas da equipe aparecem aqui.");
}

/** Quem envia na previa: a pessoa da equipe (nome e foto de agora) ou a escola (null). */
export function previewSender(sender: { userId: string } | null, senders: readonly NoticeSenderChoice[]) {
  const person = sender ? senders.find((item) => item.id === sender.userId) : undefined;

  return person ? { avatarUrl: person.avatarUrl, name: person.name } : null;
}

/** Escolher um icone ja marca a cor sugerida (o produtor pode trocar); "Sem ícone" = null. */
export function pickNoticeIcon(id: NoticeIconId | null): NoticeDraft["icon"] {
  return id ? { color: NOTICE_ICON_SUGGESTED_COLOR[id], id } : null;
}

/** "Ícone ao lado do título · Promoção" (a escolha sempre em texto, nunca so pelo desenho). */
export function noticeIconFieldLabel(icon: NoticeDraft["icon"]) {
  return `Ícone ao lado do título · ${icon ? NOTICE_ICON_LABELS[icon.id] : "Sem ícone"}`;
}

/** "Cor do ícone · Vermelho". */
export function noticeIconColorLabel(icon: NonNullable<NoticeDraft["icon"]>) {
  return `Cor do ícone · ${NOTICE_ICON_COLOR_LABELS[icon.color]}`;
}

/** Pilulas de "Fica no sino por": 1, 3, 7, 30 e 90 dias (padrao), "Outro" e, na seguinte, "Até a ... sumir". */
export type ValidityChoice = "1" | "3" | "7" | "30" | "90" | "anchor" | "other";

export const VALIDITY_CHOICE_OPTIONS: readonly { label: string; value: ValidityChoice }[] = [
  { label: "1 dia", value: "1" },
  { label: "3 dias", value: "3" },
  { label: "7 dias", value: "7" },
  { label: "30 dias", value: "30" },
  { label: "90 dias", value: "90" },
  { label: "Outro", value: "other" }
];

const PRESET_MINUTES: Record<"1" | "3" | "7" | "30", number> = { "1": 1_440, "3": 4_320, "7": 10_080, "30": 43_200 };

export function validityChoiceOf(validity: FlowValidity): ValidityChoice {
  switch (validity.mode) {
    case "default":
      return "90";
    case "with_anchor":
      return "anchor";
    case "duration": {
      const preset = (Object.keys(PRESET_MINUTES) as (keyof typeof PRESET_MINUTES)[]).find((key) => PRESET_MINUTES[key] === validity.minutes);

      return preset ?? "other";
    }
    default:
      return "other";
  }
}

/** "Outro" abre em "Por um tempo" com 2 dias (o produtor troca o numero e a unidade). */
export const DEFAULT_OTHER_VALIDITY: FlowValidity = { minutes: 2_880, mode: "duration" };

/** Validade de uma pilula; "Outro" mantem o que ja estava em "Outro". */
export function validityOfChoice(choice: ValidityChoice, current: FlowValidity): FlowValidity {
  switch (choice) {
    case "90":
      return { mode: "default" };
    case "anchor":
      return { mode: "with_anchor" };
    case "other":
      return validityChoiceOf(current) === "other" ? current : DEFAULT_OTHER_VALIDITY;
    default:
      return { minutes: PRESET_MINUTES[choice], mode: "duration" };
  }
}

export type ValidityUnit = "days" | "hours";

/** Minutos -> [numero] [horas | dias] do "Por um tempo" (dias quando fecha em dias). */
export function validityDurationParts(minutes: number): { amount: number; unit: ValidityUnit } {
  if (Number.isFinite(minutes) && minutes > 0 && minutes % 1_440 === 0) {
    return { amount: minutes / 1_440, unit: "days" };
  }

  return { amount: Number.isFinite(minutes) ? Math.round(minutes / 60) : Number.NaN, unit: "hours" };
}

/** [numero] [horas | dias] -> minutos (numero invalido fica invalido: o zod diz "Use de 1 hora a 90 dias."). */
export function validityDurationMinutes(amount: number, unit: ValidityUnit) {
  return Number.isFinite(amount) ? Math.round(amount * (unit === "days" ? 1_440 : 60)) : Number.NaN;
}

/**
 * "Quando faltar menos de 1 dia, o aluno vê “Termina em 3 h”": so quando a notificacao fica no sino por
 * 30 dias ou menos (o padrao de 90 dias nunca mostra). `sendAt` e a hora do envio (agora ou a agendada).
 */
export function showsUrgencyHint(validity: FlowValidity, sendAt: number) {
  if (validity.mode === "duration") {
    return Number.isFinite(validity.minutes) && validity.minutes * 60_000 <= VALIDITY_LIMITS.urgencyMaxTotalMs;
  }

  if (validity.mode === "until") {
    const end = Date.parse(validity.endsAt);

    return Number.isFinite(end) && Number.isFinite(sendAt) && end - sendAt <= VALIDITY_LIMITS.urgencyMaxTotalMs;
  }

  return false;
}

/* ------------------------------------------------------------------------------------------------
 * Previa (os componentes reais do aluno, montados a partir do rascunho)
 * ---------------------------------------------------------------------------------------------- */

/** Rascunho sem titulo: texto neutro no lugar, com cara de dica (nada de exemplo inventado). */
export const PREVIEW_TITLE_PLACEHOLDER = "Seu título aparece aqui";

function previewCta(cta: NoticeDraft["cta"]) {
  if (!cta || !cta.label.trim() || !cta.href.trim()) {
    return null;
  }

  return { href: cta.href.trim(), label: cta.label.trim(), target: cta.target };
}

/** O conteudo que a previa desenha: o do aviso ou o de uma notificacao seguinte (validade de fluxo). */
export type PreviewContent = Pick<NoticeDraft, "audio" | "body" | "cta" | "icon" | "image" | "kind" | "response" | "title"> & {
  validity?: FlowValidity;
};

/** Pilulas "Áudio na prévia": o player parado como nunca tocado ou como ouvido. */
export type PreviewListen = "heard" | "not_heard";

export const PREVIEW_LISTEN_OPTIONS: readonly { label: string; value: PreviewListen }[] = [
  { label: "Não ouvido", value: "not_heard" },
  { label: "Ouvido", value: "heard" }
];

/**
 * A notificacao chegou ha instantes: o cartao diz "agora" e uma de "1 dia" mostra "Termina em 23 h",
 * como o aluno ve logo depois do envio.
 */
export const PREVIEW_AGE_MS = 30_000;

/**
 * Fim no sino da notificacao da previa (o mesmo calculo do envio, contado de `createdAt`); pop-up e
 * "ate a principal sumir" sem a hora da principal: null (sem "Termina em").
 */
export function previewExpiresAt(content: Pick<PreviewContent, "kind" | "validity">, createdAt: string, anchorExpiresAt?: number | null): string | null {
  const created = Date.parse(createdAt);

  if (content.kind !== "inbox" || !Number.isFinite(created)) {
    return null;
  }

  const validity = content.validity ?? { mode: "default" };

  if (validity.mode === "with_anchor" && typeof anchorExpiresAt !== "number") {
    return null;
  }

  const columns = validityToColumns(validity);
  const expiresAt = computeExpiresAt({ validUntil: columns.valid_until, validityMinutes: columns.validity_minutes }, created, anchorExpiresAt);

  return Number.isFinite(expiresAt) && expiresAt > created ? new Date(expiresAt).toISOString() : null;
}

/** Pilulas "Enquete na prévia" (v3a): antes do voto, ou com a primeira opção como o voto do próprio aluno. */
export type PreviewPoll = "after" | "before";

/** Enquete da previa: so o voto do proprio aluno (1 voto, 100%), nunca numero inventado. */
function previewPollOf(draft: Pick<NoticeDraft, "kind" | "poll">, mode: PreviewPoll | undefined): NotificationItem["poll"] {
  const poll = draft.kind === "inbox" ? draft.poll : null;

  if (!poll || poll.options.length === 0) {
    return null;
  }

  const options = poll.options.map((option) => ({ id: option.id, label: option.label.trim() }));
  const first = options[0].id;
  const voted = mode === "after";

  return notificationPollOf(
    { ...poll, options, question: poll.question.trim() },
    { choice: voted ? [first] : [], closed: false, tally: voted ? { counts: { [first]: 1 }, voters: 1 } : null }
  );
}

/**
 * Notificacao do sino como o aluno recebe (nao lida, criada agora): de quem envia (a pessoa da equipe;
 * sem ela, a escola), com o icone, o fim no sino (o "Termina em") e o audio no estado das pilulas. v3a: como
 * o aluno chega ao destino, o botao de reagir (sem reacao) e a enquete antes ou depois do voto (`pollPreview`).
 */
export function draftToNotificationItem(
  draft: PreviewContent & Partial<Pick<NoticeDraft, "poll" | "reactions">>,
  input: {
    /** Fim da notificacao de referencia (seguinte "ate a principal sumir"). */
    anchorExpiresAt?: number | null;
    createdAt: string;
    imageUrl?: string | null;
    listen?: PreviewListen;
    pollPreview?: PreviewPoll;
    sender?: { avatarUrl: string | null; name: string } | null;
  }
): NotificationItem {
  const imageUrl = input.imageUrl ?? draft.image?.url ?? null;
  const heard = input.listen === "heard";
  const cta = previewCta(draft.cta);
  const inbox = draft.kind === "inbox";

  return {
    actor: inbox && input.sender ? { avatarUrl: input.sender.avatarUrl, name: input.sender.name } : null,
    audio: draft.audio ? { ...draft.audio } : null,
    audioProgress: draft.audio ? { completed: heard, heard: (heard ? "1" : "0").repeat(AUDIO_HEARD_SLOTS), percent: heard ? 100 : 0 } : null,
    body: draft.body.trim(),
    context: null,
    createdAt: input.createdAt,
    cta: cta ? { ...cta, display: inbox ? (draft.cta?.display ?? "button") : "button" } : null,
    expiresAt: previewExpiresAt(draft, input.createdAt, input.anchorExpiresAt),
    href: null,
    icon: draft.icon ? { color: draft.icon.color, id: draft.icon.id } : null,
    id: "previa",
    image: imageUrl ? { alt: draft.image?.alt.trim() ?? "", url: imageUrl } : null,
    kind: "notice",
    openedAt: null,
    poll: previewPollOf({ kind: draft.kind, poll: draft.poll ?? null }, input.pollPreview),
    reactions: inbox && draft.reactions ? { value: null } : null,
    readAt: null,
    response:
      inbox && draft.response
        ? {
            acceptLabel: draft.response.acceptLabel.trim() || "Aceitar",
            declineLabel: draft.response.declineLabel.trim() || "Recusar",
            value: null
          }
        : null,
    seenAt: null,
    title: draft.title.trim() || PREVIEW_TITLE_PLACEHOLDER
  };
}

/** Pop-up da home como o aluno ve na primeira vez (o icone so quando escolhido, como a API manda). */
export function draftToPopupItem(
  draft: Pick<NoticeDraft, "allowSnooze" | "audio" | "body" | "cta" | "icon" | "image" | "title">,
  input: { imageUrl?: string | null } = {}
): PopupItem {
  const imageUrl = input.imageUrl ?? draft.image?.url ?? null;

  return {
    audio: draft.audio ? { ...draft.audio } : null,
    body: draft.body.trim(),
    canSnooze: draft.allowSnooze,
    cta: previewCta(draft.cta),
    ...(draft.icon ? { icon: { color: draft.icon.color, id: draft.icon.id } } : {}),
    id: "previa",
    image: imageUrl ? { alt: draft.image?.alt.trim() ?? "", url: imageUrl } : null,
    title: draft.title.trim() || PREVIEW_TITLE_PLACEHOLDER
  };
}

/* ------------------------------------------------------------------------------------------------
 * Construtor de segmento
 * ---------------------------------------------------------------------------------------------- */

export const AUDIENCE_RULE_LABELS: Record<AudienceRuleType, string> = {
  access_age: "Tempo de acesso",
  access_ending: "Acesso terminando",
  cohort: "Turma",
  comments: "Comentários",
  last_study: "Último estudo",
  pace: "Ritmo",
  product: "Produto",
  progress: "Progresso nas aulas",
  sign_in: "Entrada na plataforma",
  // v2 (docs/23 §7)
  access_gained: "Ganhou acesso a um produto",
  message: "O que fez com uma notificação",
  page_visit: "Visitou uma página"
};

/** Ordem do seletor de tipo de regra (as regras que valem em todo lugar; a v2 vem em audienceRuleTypesFor). */
export const AUDIENCE_RULE_ORDER: readonly AudienceRuleType[] = [
  "product",
  "progress",
  "comments",
  "access_age",
  "access_ending",
  "last_study",
  "sign_in",
  "pace",
  "cohort"
];

/**
 * Onde o construtor esta: "segment" = segmento comum (Avisos, pop-ups, "Quem entra" de um fluxo);
 * "flow" = dentro de um fluxo (condicao, "So para quem...", Objetivo, "Para quem" da seguinte).
 */
export type AudienceBuilderMode = "flow" | "segment";

/**
 * Tipos no seletor: no segmento, os de sempre mais "O que fez com uma notificação" (um aviso enviado);
 * no fluxo, tambem "Visitou uma página" e "Ganhou acesso a um produto" (so ha dado dentro de um fluxo).
 */
export function audienceRuleTypesFor(mode: AudienceBuilderMode): readonly AudienceRuleType[] {
  return mode === "flow" ? [...AUDIENCE_RULE_ORDER, "message", "page_visit", "access_gained"] : [...AUDIENCE_RULE_ORDER, "message"];
}

/** O tipo vale neste modo? (uma regra salva de fluxo aberta no segmento aparece como invalida). */
export function isAudienceRuleTypeAllowed(type: AudienceRuleType, mode: AudienceBuilderMode) {
  return audienceRuleTypesFor(mode).includes(type);
}

/** Acao da regra "O que fez com uma notificação", na linha "[Fez | Não fez] [acao]". */
export const MESSAGE_ACTION_LABELS: Record<MessageAction, string> = {
  accepted: "aceitou",
  audio_completed: "ouviu o áudio até o fim",
  audio_started: "começou a ouvir o áudio",
  clicked: "clicou no botão",
  declined: "recusou",
  interacted: "interagiu",
  opened: "abriu",
  received: "recebeu",
  responded: "respondeu",
  seen: "viu no sino",
  // v3a (docs/24 §6)
  hidden: "excluiu do sino",
  reacted: "reagiu",
  voted: "votou na enquete"
};

/**
 * Notificacao que a regra pode citar: no segmento, um aviso enviado nos ultimos 90 dias; no fluxo, um
 * passo acima (ou o aviso de origem). O que ela tem decide as acoes oferecidas.
 */
export type AudienceMessageOption = {
  /**
   * Ha o que abrir ("Ver mais", audio, botao ou resposta)? Aviso curto so de texto aparece inteiro no
   * sino e nunca da "abriu" (docs/23 V7): sem "abriu" nem "interagiu" nas acoes.
   */
  canOpen: boolean;
  /** Pagina do botao (page-visit-model.ts); null = sem botao, externo ou nao acompanhado. */
  ctaPageKey: string | null;
  hasAudio: boolean;
  hasCta: boolean;
  hasResponse: boolean;
  /** Chave dos fatos (messageRefKey): "campaign:<id>" ou "node:<id>". */
  key: string;
  label: string;
  ref: MessageRef;
  title: string;
};

/** Aviso enviado que o segmento pode citar (queries.ts, loadAudienceNoticeOptions). Sem `canOpen` = tem o que abrir. */
export type AudienceNoticeChoice = { canOpen?: boolean; hasAudio: boolean; hasCta: boolean; hasResponse: boolean; id: string; sentAt: string; title: string };

/** Notificacao de um passo acima, no fluxo (o construtor de fluxos e o editor das seguintes mandam). */
export type AudienceFlowMessageChoice = {
  canOpen?: boolean;
  ctaPageKey: string | null;
  hasAudio: boolean;
  hasCta: boolean;
  hasResponse: boolean;
  nodeId: string;
  title: string;
};

export type AudienceFlowContext = { messages: readonly AudienceFlowMessageChoice[] };

export const NO_SENT_NOTICES_MESSAGE = "Nenhuma notificação enviada nos últimos 90 dias.";
export const NO_FLOW_MESSAGES_MESSAGE = "Nenhuma notificação antes deste passo.";
export const MESSAGE_RULE_SEGMENT_HINT = "Só conta quem recebeu a notificação.";

/** "Oferta especial! · 21/10" (dia e mes do envio, em Sao Paulo). */
export function noticeChoiceLabel(notice: Pick<AudienceNoticeChoice, "sentAt" | "title">) {
  const local = isoToSaoPauloLocal(notice.sentAt);
  const title = notice.title.trim() || "Sem título";

  return local ? `${title} · ${local.date.slice(8, 10)}/${local.date.slice(5, 7)}` : title;
}

/**
 * As notificacoes do seletor da regra. No segmento, os avisos enviados; no fluxo, primeiro os passos
 * acima (na ordem dada) e depois os avisos enviados, se vierem (um aviso de fora do fluxo tambem vale).
 */
export function audienceMessageOptions(
  mode: AudienceBuilderMode,
  input: { flowContext?: AudienceFlowContext | null; notices?: readonly AudienceNoticeChoice[] | null }
): AudienceMessageOption[] {
  const steps: AudienceMessageOption[] =
    mode === "flow"
      ? (input.flowContext?.messages ?? []).map((message) => {
          const ref: MessageRef = { kind: "node", nodeId: message.nodeId };
          const title = message.title.trim() || "Sem título";

          return {
            canOpen: message.canOpen !== false,
            ctaPageKey: message.ctaPageKey,
            hasAudio: message.hasAudio,
            hasCta: message.hasCta,
            hasResponse: message.hasResponse,
            key: messageRefKey(ref),
            label: title,
            ref,
            title
          };
        })
      : [];

  return [...steps, ...noticeMessageOptions(input.notices ?? [])];
}

function noticeMessageOptions(notices: readonly AudienceNoticeChoice[]): AudienceMessageOption[] {
  return notices.map((notice) => {
    const ref: MessageRef = { campaignId: notice.id, kind: "campaign" };

    return {
      canOpen: notice.canOpen !== false,
      ctaPageKey: null,
      hasAudio: notice.hasAudio,
      hasCta: notice.hasCta,
      hasResponse: notice.hasResponse,
      key: messageRefKey(ref),
      label: noticeChoiceLabel(notice),
      ref,
      title: notice.title.trim() || "Sem título"
    };
  });
}

/**
 * Acoes que a notificacao escolhida tem: recebeu e viu sempre; abriu e interagiu quando ha o que abrir
 * (`canOpen`, padrao sim); audio, botao e resposta so quando ela tem. A acao ja escolhida fica na lista
 * (notificacao removida ou mudada depois).
 */
export function messageActionsFor(
  option: (Pick<AudienceMessageOption, "hasAudio" | "hasCta" | "hasResponse"> & { canOpen?: boolean }) | null,
  current?: MessageAction
): MessageAction[] {
  const supported = (action: MessageAction) => {
    switch (action) {
      case "opened":
      case "interacted":
        return option?.canOpen !== false;
      case "audio_started":
      case "audio_completed":
        return option?.hasAudio ?? false;
      case "clicked":
        return option?.hasCta ?? false;
      case "accepted":
      case "declined":
      case "responded":
        return option?.hasResponse ?? false;
      // v3a (P0): reagiu, votou e excluiu do sino entram no seletor com o pacote de regras (docs/24 §2.7).
      case "hidden":
      case "reacted":
      case "voted":
        return false;
      default:
        return true;
    }
  };

  return MESSAGE_ACTIONS.filter((action) => supported(action) || action === current);
}

/** Titulos das notificacoes do seletor nos nomes da frase do segmento ("Alunos que não abriram a notificação “X”"). */
export function audienceNamesWithMessages(names: AudienceNames, options: readonly Pick<AudienceMessageOption, "key" | "title">[]): AudienceNames {
  if (options.length === 0) {
    return names;
  }

  return { ...names, messages: { ...names.messages, ...Object.fromEntries(options.map((option) => [option.key, option.title])) } };
}

/** Pagina da regra "Visitou uma página", na ordem do seletor. */
export const PAGE_TARGET_CHOICES = [
  { label: "a página do botão da notificação…", value: "message_cta" },
  { label: "a página de um produto", value: "content" },
  { label: "Comprar de um produto", value: "checkout" },
  { label: "Início", value: "fixed:home" },
  { label: "Minhas compras", value: "fixed:purchases" },
  { label: "Favoritos", value: "fixed:saved" },
  { label: "Materiais", value: "fixed:materials" },
  { label: "Minha jornada", value: "fixed:journey" },
  { label: "Continue assistindo", value: "fixed:continue" },
  { label: "Perfil", value: "fixed:profile" },
  { label: "Suporte", value: "fixed:support" }
] as const;

export type PageTargetChoice = (typeof PAGE_TARGET_CHOICES)[number]["value"];

type PageVisitRule = Extract<AudienceRule, { type: "page_visit" }>;

export function pageTargetChoiceOf(page: PageVisitRule["page"]): PageTargetChoice {
  return page.kind === "fixed" ? (`fixed:${page.key}` as PageTargetChoice) : page.kind;
}

/** Trocar a pagina mantem o produto (pagina do produto <-> Comprar) e a notificacao do botao. */
export function pageTargetOfChoice(choice: PageTargetChoice, previous: PageVisitRule["page"], options: readonly AudienceMessageOption[]): PageVisitRule["page"] {
  const productId = previous.kind === "content" || previous.kind === "checkout" ? previous.productId : "";

  switch (choice) {
    case "message_cta": {
      const first = pageButtonOptions(options)[0]?.ref;

      return { kind: "message_cta", nodeId: previous.kind === "message_cta" ? previous.nodeId : first?.kind === "node" ? first.nodeId : "" };
    }
    case "content":
    case "checkout":
      return { kind: choice, productId };
    default:
      return { key: choice.slice("fixed:".length) as Extract<PageVisitRule["page"], { kind: "fixed" }>["key"], kind: "fixed" };
  }
}

/** Notificacoes cujo botao leva a uma pagina acompanhada ("a página do botão da notificação…"). */
export function pageButtonOptions(options: readonly AudienceMessageOption[]) {
  return options.filter((option) => option.ref.kind === "node" && option.hasCta && option.ctaPageKey !== null);
}

export const FLOW_SINCE_CHOICES = [
  { label: "desde que entrou no fluxo", value: "entered" },
  { label: "depois de receber a notificação…", value: "message" }
] as const;

export const COMMENT_WINDOW_OPTIONS: readonly { label: string; value: "7" | "30" | "90" | "all" }[] = [
  { label: "nos últimos 7 dias", value: "7" },
  { label: "nos últimos 30 dias", value: "30" },
  { label: "nos últimos 90 dias", value: "90" },
  { label: "desde sempre", value: "all" }
];

export function commentWindowValue(days: 7 | 30 | 90 | null): "7" | "30" | "90" | "all" {
  return days === null ? "all" : (String(days) as "7" | "30" | "90");
}

export function commentWindowDays(value: string): 7 | 30 | 90 | null {
  return value === "7" ? 7 : value === "30" ? 30 : value === "90" ? 90 : null;
}

/**
 * Regra nova de cada tipo, com numeros que fazem sentido de cara. "O que fez com uma notificação" cita a
 * notificacao dada (sem ela, fica para escolher, como o produto); no fluxo cita um passo, no segmento um
 * aviso enviado.
 */
export function defaultAudienceRule(type: AudienceRuleType, input: { messageRef?: MessageRef | null; mode?: AudienceBuilderMode } = {}): AudienceRule {
  switch (type) {
    case "message":
      return {
        action: "opened",
        negate: false,
        ref: input.messageRef ?? (input.mode === "flow" ? { kind: "node", nodeId: "" } : { campaignId: "", kind: "campaign" }),
        type
      };
    case "page_visit":
      return { negate: false, page: { key: "home", kind: "fixed" }, since: { kind: "entered" }, type };
    case "access_gained":
      return { negate: false, productIds: [], since: { kind: "entered" }, type };
    case "product":
      return { op: "has", productIds: [], type };
    case "progress":
      return { op: "gte", percent: 50, productId: null, type };
    case "comments":
      return { count: 1, days: 30, op: "gte", type };
    case "access_age":
      return { days: 7, op: "lt", productId: null, type };
    case "access_ending":
      return { days: 30, productId: null, type };
    case "last_study":
      return { days: 14, op: "not_within", type };
    case "sign_in":
      return { days: 14, op: "not_within", type };
    case "pace":
      return { paces: ["at_risk"], type };
    case "cohort":
      return { cohortIds: [], type };
  }
}

/** "Escolher por regras" sem nada antes: comeca com uma regra de produto para escolher. */
export function starterAudience(): AudienceDefinition {
  return { kind: "rules", root: { items: [defaultAudienceRule("product")], match: "all" } };
}

/** Posicao de um item: [2] = terceiro item do grupo principal; [1, 0] = primeiro item do grupo 1. */
export type AudiencePath = readonly number[];

export function audienceNodeKey(path: AudiencePath) {
  return path.join(".");
}

function mapGroupAt(group: AudienceGroup, path: AudiencePath, update: (group: AudienceGroup) => AudienceGroup): AudienceGroup {
  if (path.length === 0) {
    return update(group);
  }

  const [head, ...rest] = path;
  const child = group.items[head];

  if (!child || !isAudienceGroup(child)) {
    return group;
  }

  return { ...group, items: group.items.map((item, index) => (index === head ? mapGroupAt(child, rest, update) : item)) };
}

/** Troca o item na posicao (regra ou grupo). */
export function replaceAudienceNode(root: AudienceGroup, path: AudiencePath, node: AudienceNode): AudienceGroup {
  if (path.length === 0) {
    return isAudienceGroup(node) ? node : root;
  }

  const parent = path.slice(0, -1);
  const position = path[path.length - 1];

  return mapGroupAt(root, parent, (group) => ({ ...group, items: group.items.map((item, index) => (index === position ? node : item)) }));
}

export function removeAudienceNode(root: AudienceGroup, path: AudiencePath): AudienceGroup {
  if (path.length === 0) {
    return root;
  }

  const parent = path.slice(0, -1);
  const position = path[path.length - 1];

  return mapGroupAt(root, parent, (group) => ({ ...group, items: group.items.filter((_, index) => index !== position) }));
}

/** Acrescenta no fim do grupo na posicao (vazio = grupo principal). */
export function appendAudienceNode(root: AudienceGroup, groupPath: AudiencePath, node: AudienceNode): AudienceGroup {
  return mapGroupAt(root, groupPath, (group) => ({ ...group, items: [...group.items, node] }));
}

function audienceGroupAt(root: AudienceGroup, path: AudiencePath): AudienceGroup | null {
  let group = root;

  for (const index of path) {
    const child = group.items[index];

    if (!child || !isAudienceGroup(child)) {
      return null;
    }

    group = child;
  }

  return group;
}

/**
 * Para onde vai o foco depois de remover a regra ou o grupo na posicao (o botao focado some junto):
 * o item anterior, o seguinte (que passa a ocupar a posicao), o grupo que ficou vazio ou null, que e o
 * botao "Adicionar regra". Devolve a chave do item (audienceNodeKey), calculada antes de remover.
 */
export function audienceFocusAfterRemoval(root: AudienceGroup, path: AudiencePath): string | null {
  if (path.length === 0) {
    return null;
  }

  const parentPath = path.slice(0, -1);
  const position = path[path.length - 1];
  const parent = audienceGroupAt(root, parentPath);

  if (!parent || position >= parent.items.length) {
    return null;
  }

  if (position > 0) {
    return audienceNodeKey([...parentPath, position - 1]);
  }

  if (parent.items.length > 1) {
    return audienceNodeKey([...parentPath, 0]);
  }

  return parentPath.length > 0 ? audienceNodeKey(parentPath) : null;
}

/** Nome do botao de lixeira da regra, com o tipo ("Remover regra: Produto"). */
export function removeAudienceRuleLabel(type: AudienceRuleType) {
  return `Remover regra: ${AUDIENCE_RULE_LABELS[type]}`;
}

/** Ainda cabe mais uma regra (no maximo 20 no segmento inteiro). */
export function canAddAudienceRule(definition: AudienceDefinition) {
  return countAudienceRules(definition) < AUDIENCE_LIMITS.maxRules;
}

/** Grupo novo dentro do principal (um nivel so), com o "ou" que costuma motivar o grupo. */
export function newAudienceGroup(): AudienceGroup {
  return { items: [defaultAudienceRule("pace")], match: "any" };
}

/* ------------------------------------------------------------------------------------------------
 * Audio (envio e gravacao no navegador)
 * ---------------------------------------------------------------------------------------------- */

/** Formatos de gravacao, na ordem de preferencia (Chrome e Firefox: webm/opus; Safari: mp4). */
export const RECORDER_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"] as const;

export const RECORDING_LIMIT_SECONDS = AUDIO_LIMITS.maxSeconds;

export const AUDIO_TOO_LONG_MESSAGE = "Use um áudio de até 5 minutos.";
export const AUDIO_TOO_BIG_MESSAGE = "O áudio deve ter no máximo 10 MB.";

/**
 * A gravacao para sozinha meio segundo antes do limite: o cronometro do navegador atrasa (aba em segundo
 * plano chega a 1 s) e o formato acrescenta alguns milissegundos no fim.
 */
export const RECORDING_AUTO_STOP_SECONDS = RECORDING_LIMIT_SECONDS - 0.5;

/** Passar do limite em ate 2 s e atraso da parada automatica: a gravacao fica, com a duracao no limite. */
const RECORDING_OVERSHOOT_SECONDS = 2;

/** Duracao da gravacao feita aqui (segundos inteiros, no maximo o limite); bem acima do limite, null. */
export function settleRecordedDuration(seconds: number): number | null {
  if (Number.isFinite(seconds) && seconds > RECORDING_LIMIT_SECONDS + RECORDING_OVERSHOOT_SECONDS) {
    return null;
  }

  return Math.min(audioDurationSeconds(seconds), RECORDING_LIMIT_SECONDS);
}

export const MIC_RELOAD_MESSAGE = "Para gravar, recarregue a página. Salve o rascunho antes.";

type PolicyReader = { allowsFeature?: (feature: string) => boolean } | null | undefined;

/** O que o navegador expoe da politica do documento (Chrome: featurePolicy; a API nova: permissionsPolicy). */
export type PolicyDocument = { featurePolicy?: PolicyReader; permissionsPolicy?: PolicyReader };

/**
 * O documento foi carregado com o microfone bloqueado pelo Permissions-Policy (veio da area do aluno
 * ou do login por troca de rota, sem recarregar): so recarregar em /admin libera. Navegador sem a API
 * (Firefox, Safari) ou erro na leitura: false (segue o pedido normal do microfone).
 */
export function isMicrophoneBlockedByPolicy(doc: PolicyDocument | null | undefined) {
  const policy = doc?.permissionsPolicy ?? doc?.featurePolicy;

  if (!policy || typeof policy.allowsFeature !== "function") {
    return false;
  }

  try {
    return policy.allowsFeature("microphone") === false;
  } catch {
    return false;
  }
}

export function pickRecorderMimeType(isTypeSupported: (type: string) => boolean): string | null {
  for (const type of RECORDER_MIME_TYPES) {
    try {
      if (isTypeSupported(type)) {
        return type;
      }
    } catch {
      // Navegador que lanca para tipo desconhecido: tenta o proximo.
    }
  }

  return null;
}

/** Extensao do arquivo enviado (o servidor confere pelos primeiros bytes). */
export function audioFileExtension(mimeType: string | null | undefined) {
  const type = (mimeType ?? "").toLowerCase().split(";")[0].trim();

  switch (type) {
    case "audio/mp4":
    case "audio/x-m4a":
    case "audio/aac":
      return "m4a";
    case "audio/mpeg":
      return "mp3";
    case "audio/ogg":
      return "ogg";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    default:
      return "webm";
  }
}

/** Duracao em segundos inteiros, para cima (o player mostra 0:58 para 57,3 s); no minimo 1. */
export function audioDurationSeconds(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 1;
  }

  // Tolerancia de arredondamento do decodificador (60,0004 s continua 1:00).
  return Math.max(1, Math.ceil(seconds - 0.01));
}

/** Tamanho e duracao fora do limite -> a frase do produtor; dentro, null. */
export function describeAudioProblem(input: { bytes?: number | null; seconds?: number | null }) {
  if (typeof input.bytes === "number" && input.bytes > AUDIO_LIMITS.maxBytes) {
    return AUDIO_TOO_BIG_MESSAGE;
  }

  if (typeof input.seconds === "number" && audioDurationSeconds(input.seconds) > AUDIO_LIMITS.maxSeconds) {
    return AUDIO_TOO_LONG_MESSAGE;
  }

  return null;
}

/**
 * Forma de onda gravada com o aviso: `bars` barras (padrao 48), cada uma o pico absoluto do seu trecho,
 * em 0..100 relativo ao trecho mais alto. Silencio inteiro -> tudo 0.
 */
export function computeAudioPeaks(samples: ArrayLike<number>, bars: number = AUDIO_LIMITS.peaks): number[] {
  const count = Math.max(1, Math.floor(bars));
  const length = samples.length;
  const raw: number[] = [];

  for (let bar = 0; bar < count; bar += 1) {
    const start = Math.floor((bar * length) / count);
    const end = Math.max(start + 1, Math.floor(((bar + 1) * length) / count));
    let peak = 0;

    for (let index = start; index < end && index < length; index += 1) {
      const value = Math.abs(samples[index] ?? 0);

      if (Number.isFinite(value) && value > peak) {
        peak = value;
      }
    }

    raw.push(peak);
  }

  const loudest = Math.max(0, ...raw);

  return raw.map((peak) => (loudest > 0 ? Math.min(100, Math.max(0, Math.round((peak / loudest) * 100))) : 0));
}

/** "0:05", "4:59", "5:00". */
export function formatAudioClock(seconds: number) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(total / 60);

  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------------------------------------
 * Relatorio
 * ---------------------------------------------------------------------------------------------- */

/** Acima disto, "fecharam sem clicar" vira alerta (docs/17 §2.11). */
export const HIGH_CLOSE_RATE = 40;

export type NoticeStatsInput = {
  accepted: number;
  clicked: number;
  closedWithoutClick: number;
  declined: number;
  dismissed: number;
  /** Abriram (v2, communication_campaign_engagement): so a notificacao do sino tem. */
  opened?: number;
  recipients: number;
  seen: number;
  snoozed: number;
  studied7d: number;
};

export type FunnelStep = {
  /** "de quem recebeu", "de quem viu". */
  base: string;
  id: "clicked" | "opened" | "recipients" | "seen" | "studied";
  label: string;
  percent: number | null;
  value: number;
};

/**
 * Para quem -> Viram -> Abriram (so notificacao) -> Clicaram -> Voltaram a estudar (7 dias). Abrir e a
 * interacao de verdade (cartao, "Ver mais", audio, botao, resposta); "Marcar todas" nao conta.
 */
export function noticeFunnel(stats: NoticeStatsInput, kind: CampaignKind): FunnelStep[] {
  const opened = stats.opened ?? 0;

  return [
    { base: kind === "inbox" ? "receberam no sino" : "podem ver o pop-up", id: "recipients", label: "Para quem", percent: null, value: stats.recipients },
    {
      base: kind === "inbox" ? "de quem recebeu" : "de quem pode ver",
      id: "seen",
      label: "Viram",
      percent: ratio(stats.seen, stats.recipients),
      value: stats.seen
    },
    ...(kind === "inbox" ? [{ base: "de quem viu", id: "opened" as const, label: "Abriram", percent: ratio(opened, stats.seen), value: opened }] : []),
    { base: "de quem viu", id: "clicked", label: "Clicaram", percent: ratio(stats.clicked, stats.seen), value: stats.clicked },
    { base: "de quem viu", id: "studied", label: "Voltaram a estudar (7 dias)", percent: ratio(stats.studied7d, stats.seen), value: stats.studied7d }
  ];
}

export type NoticeAudioStep = { base: string; id: "audio_completed" | "audio_started"; label: string; percent: number | null; value: number };

/** Notificacao com audio: "Começaram o áudio" e "Ouviram até o fim" (90 % ouvido), sobre quem abriu. */
export function noticeAudioSteps(engagement: { audioCompleted: number; audioStarted: number; opened: number }): NoticeAudioStep[] {
  return [
    { base: "de quem abriu", id: "audio_started", label: "Começaram o áudio", percent: ratio(engagement.audioStarted, engagement.opened), value: engagement.audioStarted },
    { base: "de quem abriu", id: "audio_completed", label: "Ouviram até o fim", percent: ratio(engagement.audioCompleted, engagement.opened), value: engagement.audioCompleted }
  ];
}

/** "Criada por Ana Souza · em nome de Carlos Lima" quando quem envia e uma pessoa; da escola, null. */
export function noticeAuthorLine(createdBy: { name: string } | null, sender: { name: string } | null) {
  return sender ? `Criada por ${createdBy?.name ?? "Equipe"} · em nome de ${sender.name}` : null;
}

/** "Fecharam sem clicar" sobre quem viu o pop-up. */
export function closedWithoutClickRate(stats: Pick<NoticeStatsInput, "closedWithoutClick" | "seen">) {
  return ratio(stats.closedWithoutClick, stats.seen);
}

export function isHighCloseRate(rate: number | null) {
  return rate !== null && rate > HIGH_CLOSE_RATE;
}
