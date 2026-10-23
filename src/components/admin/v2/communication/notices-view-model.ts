// Comunicacao > Avisos e pop-ups no admin (docs/22 §2; docs/17 §1.8): enderecos e filtros da lista,
// numeros das linhas e do relatorio, rotulos e confirmacoes das acoes, botao principal do editor, a
// previa montada a partir do rascunho, as pecas do construtor de segmento e as contas do audio
// (forma de onda, duracao, formato da gravacao). Modulo puro (sem React, imports relativos):
// tests/comunicacao-admin-modelo.test.mjs carrega direto pelo Node e as telas usam as mesmas regras.
// v2 (docs/23): as dicas de "Quem envia", o icone com a cor sugerida, as pilulas de "Fica no sino por",
// a previa com quem envia, o "Termina em" e o audio ouvido, e o funil com "Abriram" e o audio.
// v3b-1 (docs/25 §2.1, §2.3 e §2.4): o pop-up deixa de ser "da home" nos textos, o rascunho leva a
// configuracao do pop-up (`popup`), "Mostrar de novo" em qualquer "Quantas vezes" (textos por como para de
// aparecer), os toasts com o "até 1 minuto" e as linhas de aviso do pop-up no ar.
// Design do pop-up (docs/26): o rascunho do pop-up leva `design` (null = Padrão), a forma canonica compara o
// design canonico e a previa monta o PopupItem com o design e as fontes resolvidas. Livre (docs/27): a chave
// `freeDesign` ao lado (as duas sempre no pedido, no maximo uma nao nula), a forma canonica do Livre e a previa
// pelo freePreviewPopupItem (o mesmo item do palco do editor).

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
  APPROVAL_THRESHOLD,
  AUDIO_LIMITS,
  formatSaoPauloDateTime,
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
import {
  isPollClosed,
  notificationPollOf,
  POLL_LIMITS,
  pollPercent,
  REACTION_EMOJI,
  REACTION_IDS,
  REACTION_LABELS,
  type PollDefinition,
  type PollOption,
  type ReactionId
} from "../../../../server/communications/interactions-model";
import type { CtaDisplay, NotificationItem, PopupItem } from "../../../../server/communications/notification-model";
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
// v3b-1 (docs/25): onde, quando e quantas vezes o pop-up aparece, "Lembrar depois" e como fecha.
import {
  canonicalPopupSettings,
  canonicalPatterns,
  canonicalProductIds,
  isPageTrigger,
  repeatOfFrequency,
  sameFrequency,
  type PopupFrequency,
  type PopupSettings,
  type PopupStopOn,
  type PopupTrigger
} from "../../../../server/communications/popup-display-model";
import { canonicalPopupDesign, type PopupFontFace } from "../../../../server/communications/popup-design-model";
import { canonicalPopupFreeDesign, freePreviewPopupItem, type PopupFreeDesign } from "../../../../server/communications/popup-free-model";
import { popupSettingsOfDraft } from "./popup-editor-model";

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

/** Editor ou relatorio de um aviso (`edit` abre o editor de um pop-up no ar ou de uma notificacao enviada). */
export function noticeHref(id: string, options: { edit?: boolean } = {}) {
  const base = `${NOTICES_HREF}/${encodeURIComponent(id)}`;

  return options.edit ? `${base}?${NOTICE_EDIT_PARAM}=1` : base;
}

/**
 * "Editar" do menu (v3a, docs/24 §2.1): o que os alunos ja veem (pop-up no ar ou pausado, notificacao
 * enviada) abre o editor com ?editar=1 (sem ele, /avisos/[id] e o relatorio); o resto abre direto.
 */
export function noticeEditHref(notice: { id: string; kind: CampaignKind; status: CampaignStatus }) {
  return noticeHref(notice.id, { edit: isLiveNoticeStatus(notice.kind, notice.status) });
}

/**
 * /avisos/[id] abre o editor ou o relatorio? Rascunho, aguardando aprovacao e notificacao agendada abrem
 * no editor. Pop-up no ar ou pausado e notificacao enviada (v3a) abrem no relatorio; no editor so com
 * ?editar=1 e se a pessoa pode editar ("edit" nas acoes, a mesma regra do servidor: vale como publicar).
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

/**
 * Ordem no menu "…": o que mais se usa primeiro, o que tira do ar e exclui por ultimo. v3a: "Ver relatório"
 * abre o menu e "Mostrar de novo para quem já viu" fica com as acoes do pop-up no ar.
 */
const MENU_ORDER: readonly NoticeAction[] = [
  "view_report",
  "edit",
  "approve",
  "reject",
  "pause",
  "resume",
  "reshow",
  "send_test",
  "duplicate",
  "cancel_schedule",
  "end",
  "withdraw",
  "delete"
];

const DESTRUCTIVE_ACTIONS = new Set<NoticeAction>(["delete", "end", "withdraw"]);
const CONFIRMED_ACTIONS = new Set<NoticeAction>(["approve", "delete", "end", "reject", "reshow", "withdraw"]);

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

/** Quantos avisos e fluxos citam a notificacao nas regras (v3a: lista e detalhe trazem; so a enviada). */
export type NoticeCitationCounts = { flows: number; notices: number };

/**
 * v3a (docs/24 §2.1): a frase de aviso dos dialogos de Excluir e Retirar do sino quando outros avisos ou
 * fluxos citam a notificacao nas regras ("recebeu", "abriu"...): depois de sair, para eles ninguem recebeu.
 * Vazia quando ninguem cita (nao impede nada).
 */
export function citationsSentence(citations: NoticeCitationCounts | null | undefined, action: "delete" | "withdraw") {
  const notices = Math.max(0, Math.floor(citations?.notices ?? 0));
  const flows = Math.max(0, Math.floor(citations?.flows ?? 0));
  const total = notices + flows;

  if (total === 0) {
    return "";
  }

  const parts = [
    notices > 0 ? (notices === 1 ? "1 aviso" : `${formatInteger(notices)} avisos`) : null,
    flows > 0 ? (flows === 1 ? "1 fluxo" : `${formatInteger(flows)} fluxos`) : null
  ].filter((part): part is string => part !== null);

  return `Atenção: ${parts.join(" e ")} ${total === 1 ? "usa" : "usam"} esta notificação nas regras. Depois de ${
    action === "delete" ? "excluir" : "retirar"
  }, para ${total === 1 ? "ele" : "eles"} ninguém recebeu esta notificação.`;
}

/**
 * "dos 318 alunos que receberam", "do 1 aluno que recebeu" ou, sem o numero, "de quem recebeu" (Retirar do sino
 * e Excluir a enviada).
 */
function receivedPhrase(recipients: number | null | undefined) {
  if (typeof recipients !== "number" || recipients <= 0) {
    return "de quem recebeu";
  }

  return recipients === 1 ? "do 1 aluno que recebeu" : `dos ${formatStudentCount(recipients)} que receberam`;
}

function withSentence(text: string, sentence: string) {
  return sentence ? `${text} ${sentence}` : text;
}

/** Excluir (v3a, docs/24 §2.1): o texto pela situacao (o que acontece com quem ve ou vai ver). */
function deleteConfirm(notice: {
  citations?: NoticeCitationCounts | null;
  followUps?: { count: number; sent: number } | null;
  kind: CampaignKind;
  recipients?: number | null;
  situation?: CampaignSituation;
  title: string;
}): Omit<NoticeConfirmCopy, "title"> {
  if (notice.kind === "inbox" && notice.situation === "sent") {
    const followUps = notice.followUps && notice.followUps.count > 0 ? " As notificações seguintes deixam de sair." : "";

    return {
      confirmLabel: "Excluir notificação",
      description: withSentence(
        `A notificação some do sino ${receivedPhrase(notice.recipients)} e o aviso sai desta lista, com o relatório. Não dá para desfazer. Para tirar do sino e manter o relatório, use Retirar do sino.${followUps}`,
        citationsSentence(notice.citations, "delete")
      ),
      destructive: true
    };
  }

  if (notice.kind === "inbox" && notice.situation === "scheduled") {
    return { confirmLabel: "Excluir aviso", description: "O envio agendado é cancelado e o aviso sai desta lista. Não dá para desfazer.", destructive: true };
  }

  if (notice.kind === "popup" && notice.situation === "active") {
    return {
      confirmLabel: "Excluir pop-up",
      description: "O pop-up para de aparecer para todos os alunos agora e o aviso sai desta lista, com o relatório. Não dá para desfazer.",
      destructive: true
    };
  }

  if (notice.kind === "popup" && (notice.situation === "paused" || notice.situation === "scheduled")) {
    return {
      confirmLabel: "Excluir pop-up",
      description: "O pop-up não volta a aparecer e o aviso sai desta lista, com o relatório. Não dá para desfazer.",
      destructive: true
    };
  }

  return { confirmLabel: "Excluir aviso", description: "O aviso sai desta lista. Não dá para desfazer.", destructive: true };
}

/**
 * Textos do dialogo de confirmacao (nunca window.confirm). v2 (docs/23 §2.2): retirar uma notificacao com
 * seguintes (`followUps.count` > 0) avisa que elas deixam de sair; a caixa "Retirar também as notificações
 * seguintes que já saíram (n)" fica no dialogo (notice-row-menu.tsx). v3a (docs/24 §2.1): Excluir pela
 * situacao (`situation`), a frase das regras que citam a notificacao (`citations`) e "Mostrar de novo".
 */
export function noticeActionConfirm(
  action: NoticeAction,
  notice: {
    audienceCount: number | null;
    citations?: NoticeCitationCounts | null;
    followUps?: { count: number; sent: number } | null;
    kind: CampaignKind;
    recipients?: number | null;
    situation?: CampaignSituation;
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
            : `O pop-up passa a aparecer para ${formatStudentCount(notice.audienceCount)}, nas páginas e no momento escolhidos. A contagem é refeita na hora de publicar.`,
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
        description: "O pop-up para de aparecer para todos os alunos agora e não volta. Para mostrar de novo, duplique.",
        destructive: true,
        title: `Encerrar “${title}”?`
      };
    case "withdraw":
      return {
        confirmLabel: "Retirar do sino",
        description: withSentence(
          `A notificação some do sino ${receivedPhrase(notice.recipients)}. Os números continuam no relatório.${
            notice.followUps && notice.followUps.count > 0 ? " As notificações seguintes deixam de sair." : ""
          }`,
          citationsSentence(notice.citations, "withdraw")
        ),
        destructive: true,
        title: `Retirar “${title}” do sino?`
      };
    case "delete":
      return { ...deleteConfirm(notice), title: `Excluir “${title}”?` };
    case "reshow":
      return {
        confirmLabel: "Mostrar de novo",
        // v3b-1: vale em qualquer "Quantas vezes" (quem clicou volta so nos pop-ups que param quando terminam).
        description:
          "O pop-up volta a contar como novo para quem já viu: a contagem de “Quantas vezes” começa de novo. Quem escolheu “Não mostrar de novo” continua como está, e quem clicou no botão também (menos nos pop-ups que só param quando terminam).",
        destructive: false,
        title: `Mostrar “${title}” de novo?`
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

/**
 * Toast de Excluir (v3a, docs/24 §2.1), pela situacao em que o aviso estava e quantas linhas sairam do sino
 * (`removed`, a resposta do servidor).
 */
export function deletedNoticeToast(input: { kind: CampaignKind; removed?: number | null; situation?: CampaignSituation }) {
  if (input.kind === "inbox" && input.situation === "sent") {
    return typeof input.removed === "number" && input.removed > 0 ? `Notificação excluída do sino de ${formatStudentCount(input.removed)}.` : "Notificação excluída.";
  }

  if (input.kind === "popup" && input.situation === "active") {
    return "Pop-up excluído. Ele não aparece mais para os alunos.";
  }

  if (input.kind === "popup" && (input.situation === "paused" || input.situation === "scheduled")) {
    return "Pop-up excluído.";
  }

  return NOTICE_ACTION_TOASTS.delete ?? "Aviso excluído.";
}

/** A caixa do dialogo de Excluir a notificacao enviada com seguintes que ja sairam (marcada a cada vez). */
export function deleteFollowUpsLabel(sent: number) {
  return `Excluir também as notificações seguintes que já saíram (${formatInteger(sent)})`;
}

/**
 * Toast de "Mostrar de novo para quem já viu" (v3a): quantos voltam a ver, ou por que ninguem. v3b-1: em
 * "Mais de uma vez" (`mode` "repeat", o NoticeListItem.popupMode) a contagem de "Quantas vezes" recomeca.
 */
export function reshownPopupToast(count: number, mode: "once" | "repeat" = "once") {
  if (count <= 0) {
    return "Ninguém precisava ver de novo: quem viu já clicou, escolheu “Não mostrar de novo” ou ainda vai ver.";
  }

  return mode === "repeat"
    ? `A contagem de “Quantas vezes” recomeçou para ${formatStudentCount(count)}.`
    : `O pop-up volta a aparecer para ${formatStudentCount(count)}.`;
}

/** v3b-1: quem ja esta com a area aberta guarda o pop-up por ate 1 minuto no navegador (docs/25 §5.6). */
const POPUP_DELAY_SUFFIX = "Para quem já está com a área aberta, pode levar até 1 minuto.";

/**
 * v3b-2 (docs/29 §6.4): o pop-up que foi ao ar, como o servidor devolve em PublishedNotice.popup (publicar e
 * aprovar): o Comeca no futuro e o momento. Sem a chave (notificacao, servidor de antes), o toast de antes.
 */
export type PublishedPopupInfo = { startsInFuture: boolean; trigger: PopupTrigger };

/** Toast depois de publicar ou aprovar, conforme o que o servidor decidiu. */
export function publishedNoticeToast(
  result: { audienceCount: number; popup?: PublishedPopupInfo; recipients: number | null; situation: CampaignSituation },
  kind: CampaignKind
) {
  const popup = kind === "popup" ? result.popup : undefined;

  // v3b-2: Comeca no futuro num momento de pagina (a hora marcada ao vivo, com a ressalva de quem ja esta com
  // a area aberta) e "No primeiro acesso" no ar agora.
  if (popup && result.situation !== "pending_approval") {
    if (popup.startsInFuture && isPageTrigger(popup.trigger)) {
      return "Pop-up publicado. Na hora marcada, ele aparece para quem abrir uma das páginas e para quem já estiver nelas. Para quem está com a área aberta agora, vale a partir da próxima página ou de quando voltar para a aba.";
    }

    if (!popup.startsInFuture && popup.trigger === "first_login" && result.situation === "active") {
      return "Pop-up publicado. Ele aparece para os alunos novos a partir de agora.";
    }
  }

  switch (result.situation) {
    case "pending_approval":
      return "Enviado para aprovação.";
    case "scheduled":
      return kind === "inbox" ? "Envio agendado." : "Pop-up publicado.";
    case "active":
      // v3b-1: o pop-up no ar agora chega na proxima pagina de cada aluno (ate 1 minuto numa aba aberta).
      return kind === "popup" ? "Pop-up publicado. Em até 1 minuto ele começa a aparecer para quem já está na área." : "Aviso publicado.";
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

/**
 * Toast de "Salvar rascunho" (ou "Salvar alterações" no pop-up no ar), pela situacao antes de salvar. v3a
 * (docs/24 §2.2 e §2.4): a notificacao enviada conta quantos ja veem a mudanca; o pop-up no ar diz o que
 * acontece com quem ja viu pela regra "Quantas vezes" salva (`repeat`) e quantos voltam a ver (`reshown`).
 * v3b-1 (docs/25 §2.4): `repeat` "until_action" e "Mais de uma vez" (vale na hora, contando o que cada aluno
 * ja viu); o pop-up no ar termina com o "até 1 minuto" de quem ja esta com a area aberta.
 */
export function savedNoticeToast(
  kind: CampaignKind,
  previousStatus: CampaignStatus | null | undefined,
  result: { recipients?: number | null; repeat?: NoticeDraft["repeat"]; reshown?: number | null } = {}
) {
  if (kind === "inbox" && previousStatus === "sent") {
    return typeof result.recipients === "number" && result.recipients > 0
      ? `Notificação atualizada no sino de ${formatStudentCount(result.recipients)}.`
      : "Notificação atualizada no sino.";
  }

  if (isLivePopupStatus(kind, previousStatus)) {
    const reshown = typeof result.reshown === "number" && result.reshown > 0 ? result.reshown : 0;
    const repeat = result.repeat === "until_action";

    if (previousStatus === "paused") {
      return reshown > 0 ? "Pop-up salvo. Ele continua pausado. Ao retomar, volta a aparecer para quem já tinha visto." : "Pop-up salvo. Ele continua pausado.";
    }

    if (reshown > 0) {
      const saw = `${formatStudentCount(reshown)} que já ${reshown === 1 ? "tinha" : "tinham"} visto`;

      return repeat
        ? `Pop-up atualizado. A contagem de “Quantas vezes” recomeçou para ${saw}. ${POPUP_DELAY_SUFFIX}`
        : `Pop-up atualizado. Ele volta a aparecer para ${saw}. ${POPUP_DELAY_SUFFIX}`;
    }

    return repeat
      ? `Pop-up atualizado. Vale na hora, contando as vezes que cada aluno já viu. ${POPUP_DELAY_SUFFIX}`
      : `Pop-up atualizado. Quem já viu não vê de novo. ${POPUP_DELAY_SUFFIX}`;
  }

  const sideEffect = draftSaveSideEffect(previousStatus);

  return sideEffect ? `Rascunho salvo. ${sideEffect}` : "Rascunho salvo.";
}

/* ------------------------------------------------------------------------------------------------
 * Editar o que os alunos ja veem (v3a, docs/24 §2.2 e §2.4): notificacao enviada e pop-up no ar
 * ---------------------------------------------------------------------------------------------- */

/** Banner do editor do pop-up no ar ou pausado. */
export function livePopupBanner(status: CampaignStatus | null | undefined) {
  return status === "paused"
    ? "Este pop-up está pausado. As mudanças valem quando ele voltar ao ar."
    : "Este pop-up está no ar. As mudanças valem assim que você salvar.";
}

/**
 * "Mostrar de novo para quem já viu" aparece no editor so do pop-up no ar ou pausado (v3b-1: em qualquer
 * "Quantas vezes"; na v3a era so em "Uma vez").
 */
export function showsReshowSwitch(input: { kind: CampaignKind; status: CampaignStatus | null | undefined }) {
  return isLivePopupStatus(input.kind, input.status);
}

export const RESHOW_SWITCH_LABEL = "Mostrar de novo para quem já viu";

/**
 * A descricao do switch, com quantos voltam a contar como novo agora (`detail.reshowable`); 0 = ninguem
 * precisa (o switch fica desligado e travado). Sem a contagem, a frase sem numero. v3b-1: pelo que faz o
 * pop-up parar (`stopOn`; null = Uma vez): em "Só quando o pop-up terminar" quem clicou tambem volta.
 */
export function reshowSwitchCopy(count: number | null | undefined, stopOn: PopupStopOn | null = null): { description: string; disabled: boolean } {
  const known = typeof count === "number" && Number.isFinite(count) && count >= 0;

  if (stopOn === "never") {
    const rest = "Quem escolheu “Não mostrar de novo” continua como está.";

    if (count === 0) {
      return { description: "Ninguém precisa ver de novo agora: quem viu escolheu “Não mostrar de novo” ou ainda vai ver.", disabled: true };
    }

    if (!known) {
      return { description: `Para quem já viu: a contagem de “Quantas vezes” recomeça. ${rest}`, disabled: false };
    }

    return {
      description:
        count === 1
          ? `Para 1 aluno que já viu: a contagem de “Quantas vezes” recomeça para ele. ${rest}`
          : `Para os ${formatStudentCount(count)} que já viram: a contagem de “Quantas vezes” recomeça para eles. ${rest}`,
      disabled: false
    };
  }

  const rest = "Quem clicou no botão ou escolheu “Não mostrar de novo” continua como está.";

  if (count === 0) {
    return { description: "Ninguém precisa ver de novo agora: quem viu já clicou, escolheu “Não mostrar de novo” ou ainda vai ver.", disabled: true };
  }

  if (!known) {
    return { description: `Para quem já viu e não clicou: o pop-up volta a contar como novo. ${rest}`, disabled: false };
  }

  return {
    description:
      count === 1
        ? `Para 1 aluno que já viu e não clicou: o pop-up volta a contar como novo para ele. ${rest}`
        : `Para os ${formatStudentCount(count)} que já viram e não clicaram: o pop-up volta a contar como novo para eles. ${rest}`,
    disabled: false
  };
}

/**
 * v3b-1: a linha embaixo de "Quantas vezes" do pop-up no ar ou pausado quando a escolha mudou do que esta
 * salvo (vale na hora, contando o que cada aluno ja viu). null = sem mudanca (ou pop-up que ainda nao saiu).
 */
export function popupFrequencyChangeHint(input: { saved: PopupFrequency | null | undefined; shown: PopupFrequency; status: CampaignStatus | null | undefined }) {
  if (!isLivePopupStatus("popup", input.status) || !input.saved || sameFrequency(input.saved, input.shown)) {
    return null;
  }

  return "Mudar “Quantas vezes” vale na hora para todos, contando as vezes que cada aluno já viu.";
}

type PopupPlacementSnapshot = { popup: Pick<PopupSettings, "accessProducts" | "exclude" | "pages" | "trigger">; window: NoticeDraft["window"] };

/**
 * v3b-1 (docs/25 §2.3): as linhas de aviso do card "Quando e onde aparece" no pop-up no ar ou pausado:
 * paginas, excecoes ou momento diferentes do salvo (quem ja viu continua contando como visto) e, no ar, o
 * "Começa" levado para o futuro (some para todos ate la). v3b-2 (docs/29 §6.1): os produtos do primeiro
 * acesso entram na comparacao e, quando so eles mudaram, a linha de quem ja contava como aluno novo.
 */
export function popupPlacementChangeNotes(input: { now: number; saved: PopupPlacementSnapshot; shown: PopupPlacementSnapshot; status: CampaignStatus | null | undefined }): string[] {
  if (!isLivePopupStatus("popup", input.status)) {
    return [];
  }

  const notes: string[] = [];
  const { saved, shown } = input;
  const samePatterns = (left: readonly string[], right: readonly string[]) => canonicalPatterns(left).join(" ") === canonicalPatterns(right).join(" ");
  const sameProducts = canonicalProductIds(saved.popup.accessProducts ?? []).join(" ") === canonicalProductIds(shown.popup.accessProducts ?? []).join(" ");
  const samePlace = saved.popup.trigger === shown.popup.trigger && samePatterns(saved.popup.pages, shown.popup.pages) && samePatterns(saved.popup.exclude, shown.popup.exclude);

  if (!samePlace || !sameProducts) {
    notes.push(
      "Mudar onde ou quando ele aparece vale na hora. Quem já viu continua contando como visto, também nas páginas novas. Para todos verem de novo, ligue “Mostrar de novo para quem já viu”."
    );
  }

  if (samePlace && !sameProducts && shown.popup.trigger === "first_login") {
    notes.push("Quem já contava como aluno novo continua contando enquanto tiver acesso a um dos produtos marcados. A mudança vale para quem chegar daqui para frente.");
  }

  const shownStart = shown.window.startsAt === null ? Number.NaN : Date.parse(shown.window.startsAt);
  const savedStart = saved.window.startsAt === null ? Number.NaN : Date.parse(saved.window.startsAt);

  if (input.status === "active" && Number.isFinite(shownStart) && shownStart > input.now && !(Number.isFinite(savedStart) && savedStart > input.now)) {
    notes.push(`Com o início no futuro, o pop-up deixa de aparecer para todos até ${formatSaoPauloDateTime(new Date(shownStart).toISOString())}.`);
  }

  return notes;
}

/** Notificacao enviada: o editor so muda o conteudo (sentNoticeLockedProblems no servidor). */
export function isSentNotice(kind: CampaignKind, status: CampaignStatus | null | undefined) {
  return kind === "inbox" && status === "sent";
}

/** "318 alunos" ou, sem o numero, "quem recebeu" (os textos do editor da notificacao enviada). */
function recipientsPhrase(recipients: number | null | undefined) {
  return typeof recipients === "number" && recipients > 0 ? formatStudentCount(recipients) : "quem recebeu";
}

export const SENT_NOTICE_COPY = {
  destinationNote:
    "As notificações seguintes que usam “visitou a página para onde a notificação leva” passam a olhar a página nova, contando a partir de agora.",
  followUps: "As notificações seguintes mudam no relatório.",
  followUpsLink: "Ir para o relatório",
  /** Motivo embaixo de cada campo que nao muda depois do envio (NoticeContentFields `lockedFields`). */
  locked: {
    audio: "O áudio não muda depois do envio: quem já ouviu ficaria marcado como tendo ouvido o novo. Para trocar, duplique a notificação.",
    poll: "A enquete não muda depois do envio. Para parar a votação, use Encerrar enquete no relatório.",
    responseMode: "Pedir uma resposta não muda depois do envio. Os textos dos botões podem mudar."
  },
  previewClean: "Assim os alunos veem agora.",
  previewDirty: "Mudanças não salvas: os alunos ainda veem a versão anterior.",
  save: "Salvar alterações",
  saveHint: "Ctrl+Enter (⌘+Enter no Mac) salva as alterações.",
  title: "Editar notificação enviada",
  viewReport: "Ver relatório"
} as const;

/** Banner do editor da notificacao enviada. */
export function sentNoticeBanner(recipients: number | null | undefined) {
  return `Esta notificação já está no sino de ${recipientsPhrase(recipients)}. O que você salvar aparece para todos na hora, sem avisar de novo e sem marcar como nova. Para avisar de novo, envie uma notificação nova.`;
}

/** Revisao do editor da notificacao enviada. */
export function sentNoticeReview(input: { recipients: number | null | undefined; sentAt: string | null | undefined }) {
  const when = formatSaoPauloDateTime(input.sentAt ?? null);

  return `Notificação enviada para ${recipientsPhrase(input.recipients)}${when ? ` em ${when}` : ""}. Salvar muda o que eles veem agora.`;
}

/** "Para quem" da notificacao enviada (so leitura). */
export function sentNoticeAudienceNote(recipients: number | null | undefined) {
  return `Já enviada para ${recipientsPhrase(recipients)}. O segmento não muda depois do envio.`;
}

/** "Quando" da notificacao enviada (so leitura): `validityLabel` = describeValidity ("fica 3 dias no sino"). */
export function sentNoticeWhenNote(input: { sentAt: string | null | undefined; validityLabel: string }) {
  const when = formatSaoPauloDateTime(input.sentAt ?? null);

  return `${when ? `Enviada em ${when} · ` : ""}${input.validityLabel}. Não muda depois do envio.`;
}

/**
 * As seguintes olham "a página para onde a notificação leva" da principal (`entryId`) em alguma regra? O
 * editor avisa que trocar o destino muda o que elas olham.
 */
export function usesNoticeDestinationPage(definitions: readonly AudienceDefinition[], entryId: string) {
  const visit = (node: AudienceNode): boolean => {
    if (isAudienceGroup(node)) {
      return node.items.some(visit);
    }

    return node.type === "page_visit" && node.page.kind === "message_cta" && node.page.nodeId === entryId;
  };

  return definitions.some((definition) => definition.kind === "rules" && visit(definition.root));
}

/**
 * A ultima linha dos Detalhes do relatorio quando nao ha Editar (docs/24 §2.2): na notificacao enviada, por
 * que (sem messaging.publish, ou acima de 500 sem messaging.publish_large); no resto, "não muda mais".
 */
export function noticeReportLastLine(input: {
  actions: readonly NoticeAction[];
  kind: CampaignKind;
  permissions: NoticePermissions;
  recipients: number | null | undefined;
  status: CampaignStatus;
}) {
  if (!input.permissions.canWrite || input.actions.includes("edit") || !input.actions.includes("duplicate")) {
    return null;
  }

  if (isSentNotice(input.kind, input.status)) {
    if (!input.permissions.canPublish) {
      return "Só quem pode publicar muda uma notificação enviada. Para mandar de novo, use Duplicar no menu.";
    }

    if ((input.recipients ?? 0) > APPROVAL_THRESHOLD && !input.permissions.canPublishLarge) {
      return "Esta notificação chegou a mais de 500 alunos: só um dono ou administrador muda depois do envio. Para mandar de novo, use Duplicar no menu.";
    }
  }

  return "Este aviso não muda mais. Para mandar de novo ou ajustar, use Duplicar no menu.";
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
 * disso e validado nem gravado no outro tipo. O pop-up abre o destino pelo botao (v3a) e nao tem lixeira
 * (allowHide, ajustes da v3a: o servidor grava true no pop-up). v3b-1: o pop-up leva a configuracao (`popup`,
 * o padrao quando o rascunho comecou como notificacao) e `repeat` coerente com ela; a notificacao vai sem a chave.
 */
export function noticeDraftForKind(draft: NoticeDraft): NoticeDraft {
  if (draft.kind === "inbox") {
    return { ...withoutPopupKey(draft), allowSnooze: true, repeat: "once", window: { endsAt: null, startsAt: null } };
  }

  const popup = popupSettingsOfDraft(draft);

  return {
    ...draft,
    allowHide: true,
    cta: draft.cta ? { ...draft.cta, display: "button" } : null,
    // Design do pop-up (docs/26): null = Padrão (o rascunho sem a chave tambem). Livre (docs/27): as duas chaves
    // sempre (uma aba antiga que so manda `design` troca o Livre gravado, spec §2.1).
    design: draft.design ?? null,
    freeDesign: draft.freeDesign ?? null,
    poll: null,
    popup,
    reactions: false,
    repeat: repeatOfFrequency(popup.frequency),
    response: null,
    schedule: { mode: "now" },
    sender: null,
    validity: { mode: "default" }
  };
}

/** O rascunho sem as chaves `popup`, `design` e `freeDesign` (a notificacao nunca leva; comparacoes canonicas ficam iguais). */
function withoutPopupKey(draft: NoticeDraft): NoticeDraft {
  if (!("popup" in draft) && !("design" in draft) && !("freeDesign" in draft)) {
    return draft;
  }

  const rest = { ...draft };
  delete rest.popup;
  delete rest.design;
  delete rest.freeDesign;

  return rest;
}

/** Livre na forma canonica (a do servidor); um design no meio da edicao que ela nao entende fica como esta. */
function safeCanonicalFreeDesign(design: PopupFreeDesign): PopupFreeDesign {
  try {
    return canonicalPopupFreeDesign(design);
  } catch {
    return design;
  }
}

function isoOrRaw(value: string) {
  const time = Date.parse(value);

  return Number.isFinite(time) ? new Date(time).toISOString() : value;
}

/**
 * Forma canonica do rascunho, igual ao que o servidor grava (textos aparados, segmento normalizado,
 * datas em ISO, campos que nao valem para o tipo zerados): base do "tem mudanca nao salva". v3b-1: o pop-up
 * com a configuracao canonica (padroes em ordem); a notificacao sem a chave `popup`.
 */
export function canonicalNoticeDraft(draft: NoticeDraft): NoticeDraft {
  const inbox = draft.kind === "inbox";

  return {
    // Design do pop-up (docs/26): o design canonico (null = Padrão); a notificacao sem a chave. Livre (docs/27):
    // o Livre canonico ao lado.
    ...(inbox
      ? {}
      : {
          design: draft.design ? canonicalPopupDesign(draft.design) : null,
          freeDesign: draft.freeDesign ? safeCanonicalFreeDesign(draft.freeDesign) : null,
          popup: canonicalPopupSettings(popupSettingsOfDraft(draft))
        }),
    // Ajustes da v3a: so o false desliga a lixeira do aluno (rascunho antigo sem a chave = pode excluir).
    allowHide: inbox ? draft.allowHide !== false : true,
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

/** O design do pop-up: Personalizado e Livre andam juntos no Recarregar (no maximo um nao nulo, docs/27 L17). */
const DESIGN_PAIR_KEYS = ["design", "freeDesign"] as const satisfies readonly (keyof NoticeDraft)[];

/**
 * "Recarregar" depois de um 409: o que o produtor mudou aqui fica; o que ele nao mexeu segue a versao
 * nova do banco (campo a campo do rascunho: titulo, texto, imagem, segmento...). O design do pop-up
 * (`design` + `freeDesign`) e um campo so: mexeu em um dos dois aqui, ficam os dois daqui; senao, os dois
 * do banco (nunca o Personalizado daqui com o Livre de outra tela).
 */
export function rebaseNoticeDraft(base: NoticeDraft, local: NoticeDraft, server: NoticeDraft): NoticeDraft {
  const result = { ...local } as Record<keyof NoticeDraft, unknown>;
  const canonicalBase = canonicalNoticeDraft(base);
  const canonicalLocal = canonicalNoticeDraft(local);
  const unchanged = (key: keyof NoticeDraft) => stableJson(canonicalBase[key]) === stableJson(canonicalLocal[key]);
  const isDesignKey = (key: keyof NoticeDraft) => (DESIGN_PAIR_KEYS as readonly string[]).includes(key);

  for (const key of Object.keys(server) as (keyof NoticeDraft)[]) {
    if (!isDesignKey(key) && unchanged(key)) {
      result[key] = server[key];
    }
  }

  if (DESIGN_PAIR_KEYS.some((key) => key in server) && DESIGN_PAIR_KEYS.every(unchanged)) {
    result.design = server.design ?? null;
    result.freeDesign = server.freeDesign ?? null;
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

/** Unidade do "Por um tempo" (ajustes da v3a: minutos tambem, a partir de 5 minutos; o teto continua 90 dias). */
export type ValidityUnit = "days" | "hours" | "minutes";

const VALIDITY_UNIT_MINUTES: Record<ValidityUnit, number> = { days: 1_440, hours: 60, minutes: 1 };

/** Pilulas da unidade, da menor para a maior: minutos, horas, dias. */
export const VALIDITY_UNIT_OPTIONS: readonly { label: string; value: ValidityUnit }[] = [
  { label: "minutos", value: "minutes" },
  { label: "horas", value: "hours" },
  { label: "dias", value: "days" }
];

/**
 * Minutos -> [numero] [minutos | horas | dias] do "Por um tempo": a maior unidade que fecha exato (1440 = 1
 * dia, 120 = 2 horas, 90 = 90 minutos). Numero invalido fica invalido, em horas.
 */
export function validityDurationParts(minutes: number): { amount: number; unit: ValidityUnit } {
  if (!Number.isFinite(minutes)) {
    return { amount: Number.NaN, unit: "hours" };
  }

  const value = Math.round(minutes);

  if (value > 0 && value % VALIDITY_UNIT_MINUTES.days === 0) {
    return { amount: value / VALIDITY_UNIT_MINUTES.days, unit: "days" };
  }

  if (value > 0 && value % VALIDITY_UNIT_MINUTES.hours === 0) {
    return { amount: value / VALIDITY_UNIT_MINUTES.hours, unit: "hours" };
  }

  return { amount: value, unit: "minutes" };
}

/**
 * [numero] [minutos | horas | dias] -> minutos. Os limites ficam com o zod (validitySchema): abaixo de 5
 * minutos "No mínimo 5 minutos.", acima de 90 dias "No máximo 90 dias."; numero invalido fica invalido.
 */
export function validityDurationMinutes(amount: number, unit: ValidityUnit) {
  return Number.isFinite(amount) ? Math.round(amount * VALIDITY_UNIT_MINUTES[unit]) : Number.NaN;
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
export type PreviewContent = Pick<NoticeDraft, "allowHide" | "audio" | "body" | "cta" | "icon" | "image" | "kind" | "poll" | "reactions" | "response" | "title"> & {
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
 * Ajustes da v3a: sem "Permitir que o aluno exclua do sino", o cartao sai sem o "⋯" de excluir.
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
    allowHide: draft.allowHide !== false,
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

/**
 * A previa tem a escolha Computador | Celular? O pop-up com design (Personalizado ou Livre) mostra o celular e o
 * computador juntos, sem a escolha; a notificacao e o pop-up Padrao tem a escolha. Uma regra so para o editor do aviso,
 * a pagina do modelo de Design (docs/28 §1.7) e a propria NoticePreview.
 */
export function previewHasDeviceChoice(draft: { design?: unknown; freeDesign?: unknown; kind: CampaignKind }): boolean {
  return !(draft.kind === "popup" && Boolean(draft.design || draft.freeDesign));
}

/**
 * Pop-up como o aluno ve na primeira vez (o icone so quando escolhido, como a API manda). v3b-1: "Só no X"
 * leva `close` (sem a chave = fecha no X, no Esc ou clicando fora, como o show manda). Design do pop-up
 * (docs/26): no Personalizado, `design` e as fontes que ele usa (`fonts`: a biblioteca do editor ou as do
 * relatorio; fonte que falta cai na pilha do sistema), como o show manda. Livre (docs/27): o item do
 * freePreviewPopupItem (o mesmo do palco do editor: titulo e texto do design, sem imagem nem icone).
 */
export function draftToPopupItem(
  draft: Pick<NoticeDraft, "allowSnooze" | "audio" | "body" | "cta" | "icon" | "image" | "title"> & Partial<Pick<NoticeDraft, "design" | "freeDesign" | "popup">>,
  input: { fonts?: readonly PopupFontFace[]; imageUrl?: string | null } = {}
): PopupItem {
  const imageUrl = input.imageUrl ?? draft.image?.url ?? null;
  const design = draft.design ?? null;

  if (draft.freeDesign) {
    return freePreviewPopupItem({
      allowSnooze: draft.allowSnooze,
      audio: draft.audio,
      close: draft.popup?.close === "x_only" ? "x_only" : "any",
      cta: draft.cta,
      design: draft.freeDesign,
      fonts: input.fonts ?? [],
      title: draft.title.trim() || PREVIEW_TITLE_PLACEHOLDER
    });
  }

  return {
    audio: draft.audio ? { ...draft.audio } : null,
    body: draft.body.trim(),
    canSnooze: draft.allowSnooze,
    ...(draft.popup?.close === "x_only" ? { close: "x_only" as const } : {}),
    ...(design
      ? {
          design,
          fonts: (input.fonts ?? [])
            .filter((face) => design.fonts.includes(face.id))
            .map((face) => ({ family: face.family, format: face.format, id: face.id, style: face.style, url: face.url, weight: face.weight }))
        }
      : {}),
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
  clicked: "foi para o destino",
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
  /** v3a: aceita reacoes (oferece "reagiu"). */
  allowsReactions: boolean;
  /**
   * Ha o que abrir ("Ver mais", audio, destino, resposta ou enquete)? Aviso curto so de texto aparece
   * inteiro no sino e nunca da "abriu" (docs/23 V7): sem "abriu" nem "interagiu" nas acoes.
   */
  canOpen: boolean;
  /** Pagina do destino (page-visit-model.ts); null = sem destino, externo ou nao acompanhado. */
  ctaPageKey: string | null;
  hasAudio: boolean;
  hasCta: boolean;
  /** v3a: tem enquete (oferece "votou na enquete"). */
  hasPoll: boolean;
  hasResponse: boolean;
  /** Chave dos fatos (messageRefKey): "campaign:<id>" ou "node:<id>". */
  key: string;
  label: string;
  /** v3a: as opcoes da enquete, na ordem (o segundo seletor de "votou na enquete"). */
  pollOptions: readonly PollOption[];
  ref: MessageRef;
  title: string;
};

/**
 * Aviso enviado que o segmento pode citar (queries.ts, loadAudienceNoticeOptions). Sem `canOpen` = tem o
 * que abrir; sem os campos da v3a = sem reacoes e sem enquete.
 */
export type AudienceNoticeChoice = {
  allowsReactions?: boolean;
  canOpen?: boolean;
  hasAudio: boolean;
  hasCta: boolean;
  hasPoll?: boolean;
  hasResponse: boolean;
  id: string;
  pollOptions?: readonly PollOption[];
  sentAt: string;
  title: string;
};

/** Notificacao de um passo acima, no fluxo (o construtor de fluxos e o editor das seguintes mandam). */
export type AudienceFlowMessageChoice = {
  allowsReactions?: boolean;
  canOpen?: boolean;
  ctaPageKey: string | null;
  hasAudio: boolean;
  hasCta: boolean;
  hasPoll?: boolean;
  hasResponse: boolean;
  nodeId: string;
  pollOptions?: readonly PollOption[];
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
            allowsReactions: message.allowsReactions === true,
            canOpen: message.canOpen !== false,
            ctaPageKey: message.ctaPageKey,
            hasAudio: message.hasAudio,
            hasCta: message.hasCta,
            hasPoll: message.hasPoll === true,
            hasResponse: message.hasResponse,
            key: messageRefKey(ref),
            label: title,
            pollOptions: message.pollOptions ?? [],
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
      allowsReactions: notice.allowsReactions === true,
      canOpen: notice.canOpen !== false,
      ctaPageKey: null,
      hasAudio: notice.hasAudio,
      hasCta: notice.hasCta,
      hasPoll: notice.hasPoll === true,
      hasResponse: notice.hasResponse,
      key: messageRefKey(ref),
      label: noticeChoiceLabel(notice),
      pollOptions: notice.pollOptions ?? [],
      ref,
      title: notice.title.trim() || "Sem título"
    };
  });
}

/**
 * Acoes que a notificacao escolhida tem: recebeu, viu e excluiu do sino sempre; abriu e interagiu quando ha
 * o que abrir (`canOpen`, padrao sim); audio, destino, resposta, reacoes e enquete so quando ela tem. A acao
 * ja escolhida fica na lista (notificacao removida ou mudada depois).
 */
export function messageActionsFor(
  option:
    | (Pick<AudienceMessageOption, "hasAudio" | "hasCta" | "hasResponse"> & { allowsReactions?: boolean; canOpen?: boolean; hasPoll?: boolean })
    | null,
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
      case "reacted":
        return option?.allowsReactions ?? false;
      case "voted":
        return option?.hasPoll ?? false;
      default:
        return true;
    }
  };

  return MESSAGE_ACTIONS.filter((action) => supported(action) || action === current);
}

/**
 * Titulos das notificacoes do seletor nos nomes da frase do segmento ("Alunos que não abriram a notificação
 * “X”"); v3a: tambem as opcoes das enquetes ("votaram em “Sábado” na enquete …").
 */
export function audienceNamesWithMessages(
  names: AudienceNames,
  options: readonly (Pick<AudienceMessageOption, "key" | "title"> & { pollOptions?: readonly PollOption[] })[]
): AudienceNames {
  if (options.length === 0) {
    return names;
  }

  const polls = options.filter((option) => (option.pollOptions?.length ?? 0) > 0);
  const messages = { ...names.messages, ...Object.fromEntries(options.map((option) => [option.key, option.title])) };

  if (polls.length === 0) {
    return { ...names, messages };
  }

  const pollOptions = {
    ...names.pollOptions,
    ...Object.fromEntries(polls.map((option) => [option.key, Object.fromEntries((option.pollOptions ?? []).map((item) => [item.id, item.label]))]))
  };

  return { ...names, messages, pollOptions };
}

/* v3a (docs/24 §2.7): o segundo seletor de "reagiu" e "votou na enquete". */

export const ANY_REACTION_LABEL = "com qualquer reação";
export const ANY_POLL_OPTION_LABEL = "em qualquer opção";
/** Opcao salva que saiu da enquete (a regra nao combina com ninguem ate escolher outra). */
export const MESSAGE_CHOICE_GONE_MESSAGE = "Escolha uma opção.";
const GONE_CHOICE_LABEL = "Opção removida";

export type MessageChoiceOption = { label: string; value: string | null };

/**
 * Opcoes do segundo seletor: "reagiu" -> qualquer reacao ou uma das seis; "votou na enquete" -> qualquer
 * opcao ou uma da enquete escolhida (a salva que saiu fica visivel como "Opção removida"). Outra acao: null
 * (sem segundo seletor).
 */
export function messageChoiceOptions(
  option: Pick<AudienceMessageOption, "pollOptions"> | null,
  action: MessageAction,
  current?: string
): MessageChoiceOption[] | null {
  if (action === "reacted") {
    return [{ label: ANY_REACTION_LABEL, value: null }, ...REACTION_IDS.map((id) => ({ label: `com ${REACTION_EMOJI[id]} ${REACTION_LABELS[id]}`, value: id }))];
  }

  if (action !== "voted") {
    return null;
  }

  const items: MessageChoiceOption[] = [
    { label: ANY_POLL_OPTION_LABEL, value: null },
    ...(option?.pollOptions ?? []).map((item) => ({ label: `em “${item.label.trim()}”`, value: item.id }))
  ];

  return current && !items.some((item) => item.value === current) ? [...items, { label: GONE_CHOICE_LABEL, value: current }] : items;
}

/** "Escolha uma opção." quando a opcao salva de "votou em …" nao esta mais na enquete da notificacao escolhida. */
export function messageChoiceProblem(option: Pick<AudienceMessageOption, "pollOptions"> | null, rule: Pick<Extract<AudienceRule, { type: "message" }>, "action" | "choice">) {
  if (rule.action !== "voted" || !rule.choice || !option) {
    return null;
  }

  return option.pollOptions.some((item) => item.id === rule.choice) ? null : MESSAGE_CHOICE_GONE_MESSAGE;
}

type MessageRule = Extract<AudienceRule, { type: "message" }>;

function withoutChoice(rule: MessageRule): MessageRule {
  return { action: rule.action, negate: rule.negate, ref: rule.ref, type: "message" };
}

/** Trocar a acao: a escolha (reacao ou opcao) sai. */
export function messageRuleWithAction(rule: MessageRule, action: MessageAction): MessageRule {
  return action === rule.action ? rule : { ...withoutChoice(rule), action };
}

/** Trocar a reacao ou a opcao (null = qualquer uma). */
export function messageRuleWithChoice(rule: MessageRule, choice: string | null): MessageRule {
  return choice ? { ...rule, choice } : withoutChoice(rule);
}

/**
 * Trocar a notificacao: a acao fica se a nova tiver (senao "abriu"); a reacao fica; a opcao da enquete so
 * fica se a nova enquete tiver o mesmo id.
 */
export function messageRuleWithOption(rule: MessageRule, option: AudienceMessageOption): MessageRule {
  const action = messageActionsFor(option).includes(rule.action) ? rule.action : "opened";
  const next: MessageRule = { ...withoutChoice(rule), action, ref: option.ref };
  const keep = action === rule.action && rule.choice && (action === "reacted" || option.pollOptions.some((item) => item.id === rule.choice));

  return keep ? { ...next, choice: rule.choice } : next;
}

/** Pagina da regra "Visitou uma página", na ordem do seletor. */
export const PAGE_TARGET_CHOICES = [
  { label: "a página para onde a notificação leva…", value: "message_cta" },
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

/** Trocar a pagina mantem o produto (pagina do produto <-> Comprar) e a notificacao do destino. */
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

/** Notificacoes que levam a uma pagina acompanhada ("a página para onde a notificação leva…"). */
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

/* ------------------------------------------------------------------------------------------------
 * Relatorio v3a (docs/24 §2.6): mudaram de resposta, excluiram do sino, reacoes e enquete. Os numeros
 * vem de communication_message_interactions (sem os testes da equipe); nunca nomes, nunca quem votou o que.
 * ---------------------------------------------------------------------------------------------- */

/** Um numero do relatorio pronto para o KpiTile. */
export type ReportTile = { definition: string; definitionShort: string; label: string; value: number };

/** Contagem que veio do banco: inteiro nao negativo (fora disso, 0). */
function reportCount(value: unknown) {
  const number = typeof value === "number" ? value : Number(value ?? 0);

  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function reportTile(label: string, value: number, percent: number | null, base: string): ReportTile {
  const definition = percent === null ? base : `${formatPercent(percent)} ${base}`;

  return { definition, definitionShort: definition, label, value };
}

/** Rodape do funil (v3a): reagir e votar sao interacoes de verdade (docs/24 T15). */
export const INTERACTIONS_OPEN_NOTE = "Reagir e votar também contam como abrir.";

/** Terceiro cartao de "Respostas": quem trocou de resposta pelo menos uma vez, sobre quem respondeu (resposta atual). */
export function responseChangedTile(stats: Pick<NoticeStatsInput, "accepted" | "declined">, responseChanged: number): ReportTile {
  const changed = reportCount(responseChanged);

  return reportTile("Mudaram de resposta", changed, ratio(changed, stats.accepted + stats.declined), "de quem respondeu");
}

/** "Excluíram do sino", ao lado de "Voltaram a estudar": so quando alguem excluiu; sobre quem recebeu. */
export function hiddenFromBellTile(hidden: number, recipients: number): ReportTile | null {
  const count = reportCount(hidden);

  return count > 0 ? reportTile("Excluíram do sino", count, ratio(count, recipients), "de quem recebeu") : null;
}

export const NO_REACTIONS_MESSAGE = "Ninguém reagiu ainda.";

export type ReactionReportTile = ReportTile & { id: ReactionId };

export type ReactionReport = {
  /** Ninguem reagiu ainda: a frase fica na secao, ao lado de "Reagiram". */
  emptyMessage: string | null;
  reacted: ReportTile;
  /** Um cartao por emoji com pelo menos uma reacao, na ordem do catalogo (a do seletor do aluno). */
  tiles: ReactionReportTile[];
};

/** A secao "Reações" aparece quando a notificacao permite reagir ou ja tem reacoes (desligar nao apaga as que existem). */
export function showsReactionReport(input: { allowsReactions: boolean | null | undefined; kind: CampaignKind; reacted: number }) {
  return input.kind === "inbox" && (input.allowsReactions === true || reportCount(input.reacted) > 0);
}

/** "Reagiram" sobre quem viu e cada emoji sobre o total de reacoes (cada aluno tem uma so). */
export function reactionReport(input: { reacted: number; reactions: Partial<Record<ReactionId, number>>; seen: number }): ReactionReport {
  const counts = REACTION_IDS.map((id) => ({ id, value: reportCount(input.reactions[id]) }));
  const total = counts.reduce((sum, item) => sum + item.value, 0);
  const reacted = reportCount(input.reacted);

  return {
    emptyMessage: total === 0 && reacted === 0 ? NO_REACTIONS_MESSAGE : null,
    reacted: reportTile("Reagiram", reacted, ratio(reacted, input.seen), "de quem viu"),
    tiles: counts
      .filter((item) => item.value > 0)
      .map((item) => ({ ...reportTile(`${REACTION_EMOJI[item.id]} ${REACTION_LABELS[item.id]}`, item.value, ratio(item.value, total), "das reações"), id: item.id }))
  };
}

/** "1 voto", "54 votos". */
export function formatVotes(count: number) {
  return count === 1 ? "1 voto" : `${formatInteger(reportCount(count))} votos`;
}

/** Opcao com voto que nao existe mais na enquete atual (passo de fluxo que mudou entre versoes). */
export const REMOVED_POLL_OPTION_LABEL = "Opção removida";

export type PollReportRow = {
  id: string;
  label: string;
  /** Parte de quem votou, 0..100 (com varias respostas, a soma passa de 100). */
  percent: number;
  removed: boolean;
  /** "42% · 54 votos". */
  summary: string;
  votes: number;
};

/**
 * Uma linha por opcao da enquete atual, na ordem dela, e depois os ids com voto que nao estao mais nela
 * ("Opção removida"; o relatorio do fluxo junta as versoes de um passo pelo id da opcao).
 */
export function pollReportRows(poll: Pick<PollDefinition, "options">, tally: { options: Record<string, number>; voters: number }): PollReportRow[] {
  const voters = reportCount(tally.voters);
  const known = new Set(poll.options.map((option) => option.id));
  const row = (id: string, label: string, removed: boolean): PollReportRow => {
    const votes = Object.hasOwn(tally.options, id) ? reportCount(tally.options[id]) : 0;
    const percent = pollPercent(votes, voters);

    return { id, label, percent, removed, summary: `${percent}% · ${formatVotes(votes)}`, votes };
  };
  const removed = Object.keys(tally.options)
    .filter((id) => !known.has(id) && reportCount(tally.options[id]) > 0)
    .sort()
    .map((id) => row(id, REMOVED_POLL_OPTION_LABEL, true));

  return [...poll.options.map((option) => row(option.id, option.label.trim(), false)), ...removed];
}

export type PollReportLines = {
  /** "Mudaram o voto 6". */
  changed: string;
  /** Com varias respostas, a nota das porcentagens; null com uma. */
  multiple: string | null;
  /** "Votaram 128 · 40% de quem viu". */
  voted: string;
};

export function pollReportLines(input: { changed: number; multiple: boolean; seen: number; voters: number }): PollReportLines {
  const voters = reportCount(input.voters);
  const percent = ratio(voters, input.seen);

  return {
    changed: `Mudaram o voto ${formatInteger(reportCount(input.changed))}`,
    multiple: input.multiple ? "Cada pessoa pode marcar mais de uma: as porcentagens somam mais de 100%." : null,
    voted: percent === null ? `Votaram ${formatInteger(voters)}` : `Votaram ${formatInteger(voters)} · ${formatPercent(percent)} de quem viu`
  };
}

/**
 * Situacao da enquete no relatorio: "Encerra em …", "Encerra quando a notificação sair do sino." ou
 * "Encerrada em ….". Notificacao retirada do sino sem data de fim: a enquete acabou junto com ela.
 */
export function pollStatusLine(poll: Pick<PollDefinition, "closesAt">, input: { now: number; status: CampaignStatus }): string {
  const closesAt = poll.closesAt ? Date.parse(poll.closesAt) : Number.NaN;

  if (Number.isFinite(closesAt) && closesAt <= input.now) {
    return `Encerrada em ${formatSaoPauloDateTime(poll.closesAt)}.`;
  }

  if (input.status === "canceled") {
    return "Encerrada: a notificação saiu do sino.";
  }

  return Number.isFinite(closesAt) ? `Encerra em ${formatSaoPauloDateTime(poll.closesAt)}` : "Encerra quando a notificação sair do sino.";
}

/**
 * "Encerrar enquete" (closeNoticePoll): quem publica, notificacao enviada (aviso; passo de fluxo nao, a
 * enquete dele acaba quando a notificacao sai do sino) e enquete ainda aberta.
 */
export function canCloseNoticePoll(input: {
  canPublish: boolean;
  flowNodeId?: string | null;
  kind: CampaignKind;
  now: number;
  poll: PollDefinition | null | undefined;
  status: CampaignStatus;
}) {
  return input.canPublish && input.kind === "inbox" && input.status === "sent" && !input.flowNodeId && !!input.poll && !isPollClosed(input.poll, input.now);
}

export const CLOSE_POLL_CONFIRM = {
  confirmLabel: "Encerrar enquete",
  description: "Ninguém mais vota. O resultado fica como está agora.",
  destructive: true,
  title: "Encerrar a enquete?"
} as const;

export const CLOSE_POLL_TOAST = "Enquete encerrada.";

/* ------------------------------------------------------------------------------------------------
 * Conteudo v3a no editor (docs/24 §2.5): "Para onde leva" (como o aluno chega la), "Interação"
 * (reacoes, resposta ou enquete), os campos da enquete e as pilulas "Enquete na prévia"
 * ---------------------------------------------------------------------------------------------- */

export const CTA_FIELD_COPY = {
  blockDescription: "Um produto, uma página da área ou um site.",
  blockTitle: "Para onde leva",
  /** Rotulo de cima das pilulas do destino (o titulo do bloco ja diz "Para onde leva"). */
  destinationLabel: "Destino",
  displayLabel: "Como o aluno chega lá",
  switchLabel: "Levar o aluno a algum lugar"
} as const;

export const CTA_DISPLAY_OPTIONS: readonly { label: string; value: CtaDisplay }[] = [
  { label: "Pelo botão", value: "button" },
  { label: "Pelo botão ou tocando na notificação", value: "button_and_card" },
  { label: "Só tocando na notificação", value: "card" }
];

const CTA_DISPLAY_DESCRIPTIONS: Record<CtaDisplay, string> = {
  button: "O aluno chega lá pelo botão.",
  button_and_card: "O aluno chega lá pelo botão ou tocando em qualquer parte da notificação.",
  card: "O aluno chega lá tocando na notificação. No pé dela aparece o texto que você escrever, com uma seta."
};

/** Como o aluno chega ao destino; pop-up e rascunho antigo sem `display` = pelo botao. */
export function ctaDisplayOf(kind: CampaignKind, cta: { display?: CtaDisplay } | null | undefined): CtaDisplay {
  return kind === "inbox" && cta?.display ? cta.display : "button";
}

/** Efeito da chave "Levar o aluno a algum lugar", pelo modo escolhido (pop-up: sempre o botao). */
export function ctaSwitchDescription(kind: CampaignKind, cta: { display?: CtaDisplay } | null | undefined) {
  if (kind === "popup") {
    return cta ? "O botão aparece embaixo do texto do pop-up." : "Sem botão, o pop-up só informa.";
  }

  return cta ? CTA_DISPLAY_DESCRIPTIONS[ctaDisplayOf(kind, cta)] : "Sem destino, a notificação só informa.";
}

/** O texto do destino: o do botao nos dois modos com botao; no "Só tocando", o que vai ao lado da seta. */
export function ctaTextFieldCopy(display: CtaDisplay): { hint?: string; label: string; placeholder: string } {
  return display === "card"
    ? { hint: "Aparece no pé da notificação, com uma seta: o aluno vê que pode tocar.", label: "Texto ao lado da seta", placeholder: "Ex.: Ver a aula nova" }
    : { label: "Texto do botão", placeholder: "Ex.: Assistir agora" };
}

/** Mensagem do zod para o texto vazio, sem falar de botao quando nao ha botao. */
export function ctaLabelError(display: CtaDisplay, error: string | undefined) {
  return display === "card" && error === "Escreva o texto do botão." ? "Escreva o texto." : error;
}

/** Nome do grupo de pilulas do destino (leitor de tela). */
export function ctaDestinationAriaLabel(display: CtaDisplay) {
  return display === "card" ? "Para onde a notificação leva" : "Para onde o botão leva";
}

const REACTION_EMOJI_LIST = REACTION_IDS.map((id) => REACTION_EMOJI[id]).join(" ");

export const NOTICE_INTERACTION_COPY = {
  // Ajustes da v3a (campaigns.allow_hide): muda tambem depois do envio.
  allowHideLabel: "Permitir que o aluno exclua do sino",
  allowHideOff: "Sem essa opção, a notificação fica no sino do aluno até o tempo dela acabar.",
  allowHideOn: "Mostra a opção de excluir na notificação. O aluno exclui só do sino dele; nos relatórios continua como recebida.",
  blockDescription: "O que o aluno pode fazer direto no sino.",
  blockTitle: "Interação",
  pollDisabledByResponse: "Desligue “Pedir uma resposta” para fazer uma enquete.",
  pollLabel: "Fazer uma enquete",
  pollOff: "Uma pergunta com opções, que o aluno responde no sino.",
  pollOn: "O aluno escolhe uma opção direto no sino.",
  reactionsLabel: "Permitir reações",
  reactionsOff: "Sem reações, a notificação não mostra o botão de reagir.",
  reactionsOn: `O aluno pode reagir com ${REACTION_EMOJI_LIST}. Ele vê só a própria reação; os números ficam no relatório.`,
  responseDisabledByPoll: "Desligue a enquete para pedir uma resposta.",
  responseLabel: "Pedir uma resposta (Aceitar ou Recusar)",
  responseOff: "Sem resposta, o aviso só informa.",
  responseOn: "Aparecem dois botões no aviso. As respostas ficam no relatório."
} as const;

export const POLL_FIELD_COPY = {
  addOption: "Adicionar opção",
  endAtDate: "Numa data e hora",
  endDateLabel: "Data e hora do fim",
  endHint: "Depois disso ninguém mais vota.",
  endLabel: "Encerra",
  endOnLeave: "Quando sair do sino",
  maxOptions: `Até ${POLL_LIMITS.maxOptions} opções.`,
  multipleLabel: "Permitir marcar mais de uma",
  multipleOff: "O aluno escolhe uma opção.",
  multipleOn: "O aluno pode marcar várias opções.",
  openWhileInBell: "A enquete fica aberta enquanto a notificação estiver no sino.",
  questionLabel: "Pergunta",
  questionPlaceholder: "Ex.: Qual horário é melhor para a aula ao vivo?",
  remove: "Remover",
  resultsLabel: "Mostrar o resultado para quem votar",
  resultsOff: "O aluno só vê que votou. O resultado fica no relatório.",
  resultsOn: "Depois de votar, o aluno vê as porcentagens. Quando a enquete encerrar, todos veem."
} as const;

/** "Opção 1" … "Opção 6". */
export function pollOptionFieldLabel(index: number) {
  return `Opção ${index + 1}`;
}

/** Nome do "Remover" de cada opcao depois da segunda: "Remover opção 3". */
export function removePollOptionLabel(index: number) {
  return `Remover opção ${index + 1}`;
}

function randomUuid() {
  const source = globalThis.crypto;

  if (source && typeof source.randomUUID === "function") {
    return source.randomUUID();
  }

  // Sem randomUUID (pagina fora de https): so precisa nao repetir dentro da mesma enquete.
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

/** Id de opcao novo: 8 hexadecimais minusculos, fixo enquanto o rascunho e editado (o voto guarda o id). */
export function newPollOptionId(randomUUID: () => string = randomUuid) {
  return randomUUID().replaceAll("-", "").slice(0, 8).toLowerCase();
}

/** Id que ainda nao existe na enquete (gerador repetido, por azar ou num teste: muda o fim ate ficar unico). */
function freshOptionId(taken: ReadonlySet<string>, newId: () => string) {
  let id = newId();

  for (let attempt = 0; taken.has(id) && attempt < 8; attempt += 1) {
    id = newId();
  }

  for (let suffix = 0; taken.has(id); suffix += 1) {
    id = `${id.slice(0, 6)}${suffix.toString(16).padStart(2, "0")}`;
  }

  return id;
}

/** Enquete nova ao ligar "Fazer uma enquete": duas opcoes vazias, uma resposta, resultado para quem votar, ate sair do sino. */
export function emptyPoll(newId: () => string = newPollOptionId): PollDefinition {
  const first = freshOptionId(new Set(), newId);
  const second = freshOptionId(new Set([first]), newId);

  return {
    closesAt: null,
    multiple: false,
    options: [
      { id: first, label: "" },
      { id: second, label: "" }
    ],
    question: "",
    showResults: true
  };
}

export function canAddPollOption(poll: Pick<PollDefinition, "options">) {
  return poll.options.length < POLL_LIMITS.maxOptions;
}

/** So as opcoes depois da segunda tem "Remover" (a enquete precisa de pelo menos duas). */
export function canRemovePollOption(index: number) {
  return Number.isInteger(index) && index >= POLL_LIMITS.minOptions;
}

/** "Adicionar opção": uma vazia no fim, com id novo; no limite, a enquete fica como esta. */
export function addPollOption(poll: PollDefinition, newId: () => string = newPollOptionId): PollDefinition {
  if (!canAddPollOption(poll)) {
    return poll;
  }

  const id = freshOptionId(new Set(poll.options.map((option) => option.id)), newId);

  return { ...poll, options: [...poll.options, { id, label: "" }] };
}

/** Tira a opcao; as outras mantem o id (e a ordem). */
export function removePollOption(poll: PollDefinition, index: number): PollDefinition {
  if (!canRemovePollOption(index) || index >= poll.options.length) {
    return poll;
  }

  return { ...poll, options: poll.options.filter((_, position) => position !== index) };
}

export function setPollOptionLabel(poll: PollDefinition, index: number, label: string): PollDefinition {
  return { ...poll, options: poll.options.map((option, position) => (position === index ? { ...option, label } : option)) };
}

export type PollEndMode = "at" | "leave";

export const POLL_END_OPTIONS: readonly { label: string; value: PollEndMode }[] = [
  { label: POLL_FIELD_COPY.endOnLeave, value: "leave" },
  { label: POLL_FIELD_COPY.endAtDate, value: "at" }
];

/** Sem data = quando sair do sino; com data (tambem a incompleta, "") = numa data e hora. */
export function pollEndMode(poll: Pick<PollDefinition, "closesAt">): PollEndMode {
  return poll.closesAt === null ? "leave" : "at";
}

/** Primeira data sugerida para o fim da enquete: 7 dias depois do envio (ou de hoje), as 23:59 de Sao Paulo. */
export function defaultPollClosesAt(sendAt: number, now: number) {
  return defaultWindowEnd(Number.isFinite(sendAt) ? new Date(sendAt).toISOString() : null, now);
}

/** Pilulas "Enquete na prévia" (so com enquete): antes do voto, ou com a primeira opcao como o voto do proprio aluno. */
export const PREVIEW_POLL_OPTIONS: readonly { label: string; value: PreviewPoll }[] = [
  { label: "Antes de votar", value: "before" },
  { label: "Depois de votar", value: "after" }
];

/** A previa mostra as pilulas quando o rascunho e uma notificacao com enquete. */
export function hasPreviewPoll(draft: Pick<PreviewContent, "kind" | "poll">) {
  return draft.kind === "inbox" && !!draft.poll;
}
