// Comunicacao > Avisos e pop-ups no admin (docs/22 §2; docs/17 §1.8): enderecos e filtros da lista,
// numeros das linhas e do relatorio, rotulos e confirmacoes das acoes, botao principal do editor, a
// previa montada a partir do rascunho, as pecas do construtor de segmento e as contas do audio
// (forma de onda, duracao, formato da gravacao). Modulo puro (sem React, imports relativos):
// tests/comunicacao-admin-modelo.test.mjs carrega direto pelo Node e as telas usam as mesmas regras.

import {
  AUDIENCE_LIMITS,
  countAudienceRules,
  isAudienceGroup,
  normalizeAudience,
  type AudienceDefinition,
  type AudienceGroup,
  type AudienceNode,
  type AudienceRule,
  type AudienceRuleType
} from "../../../../server/communications/audience-model";
import {
  AUDIO_LIMITS,
  isEditableStatus,
  isoToSaoPauloLocal,
  publishDecision,
  saoPauloLocalToIso,
  type CampaignKind,
  type CampaignSituation,
  type CampaignStatus,
  type NoticeAction,
  type NoticePermissions
} from "../../../../server/communications/campaign-model";
import type { NotificationItem, PopupItem } from "../../../../server/communications/notification-model";
import type { NoticeDraft } from "../../../../server/communications/schemas";

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

  return !isLivePopupStatus(input.kind, input.status) || (input.wantsEditor && input.actions.includes("edit"));
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
  resume: "Retomar",
  send_test: "Enviar teste para mim",
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

/** Textos do dialogo de confirmacao (nunca window.confirm). */
export function noticeActionConfirm(
  action: NoticeAction,
  notice: { audienceCount: number | null; kind: CampaignKind; recipients?: number | null; title: string }
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
        }. Os números continuam no relatório.`,
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

/** Tipo travado depois de publicado (notificacao agendada, pop-up no ar ou pausado). */
export function isNoticeKindLocked(status: CampaignStatus | null | undefined) {
  return status === "scheduled" || status === "active" || status === "paused";
}

/**
 * O que vai para o servidor: so os campos do tipo escolhido. O editor guarda o resto (trocar de tipo e
 * voltar nao perde a janela do pop-up nem a resposta da notificacao), mas nada disso e validado nem
 * gravado no outro tipo.
 */
export function noticeDraftForKind(draft: NoticeDraft): NoticeDraft {
  if (draft.kind === "inbox") {
    return { ...draft, allowSnooze: true, repeat: "once", window: { endsAt: null, startsAt: null } };
  }

  return { ...draft, response: null, schedule: { mode: "now" } };
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
    cta: draft.cta ? { href: draft.cta.href.trim(), label: draft.cta.label.trim(), target: draft.cta.target } : null,
    image: draft.image ? { alt: draft.image.alt.trim(), url: draft.image.url.trim() } : null,
    kind: draft.kind,
    repeat: inbox ? "once" : draft.repeat,
    response: inbox && draft.response ? { acceptLabel: draft.response.acceptLabel.trim(), declineLabel: draft.response.declineLabel.trim() } : null,
    schedule: inbox && draft.schedule.mode === "at" ? { mode: "at", sendAt: isoOrRaw(draft.schedule.sendAt) } : { mode: "now" },
    title: draft.title.trim(),
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

/** Notificacao do sino como o aluno recebe (nao lida, da escola, criada agora). */
export function draftToNotificationItem(draft: NoticeDraft, input: { createdAt: string; imageUrl?: string | null }): NotificationItem {
  const imageUrl = input.imageUrl ?? draft.image?.url ?? null;

  return {
    actor: null,
    audio: draft.audio ? { ...draft.audio } : null,
    body: draft.body.trim(),
    context: null,
    createdAt: input.createdAt,
    cta: previewCta(draft.cta),
    href: null,
    id: "previa",
    image: imageUrl ? { alt: draft.image?.alt.trim() ?? "", url: imageUrl } : null,
    kind: "notice",
    readAt: null,
    response:
      draft.kind === "inbox" && draft.response
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

/** Pop-up da home como o aluno ve na primeira vez. */
export function draftToPopupItem(draft: NoticeDraft, input: { imageUrl?: string | null } = {}): PopupItem {
  const imageUrl = input.imageUrl ?? draft.image?.url ?? null;

  return {
    audio: draft.audio ? { ...draft.audio } : null,
    body: draft.body.trim(),
    canSnooze: draft.allowSnooze,
    cta: previewCta(draft.cta),
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
  sign_in: "Entrada na plataforma"
};

/** Ordem do seletor de tipo de regra. */
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

/** Regra nova de cada tipo, com numeros que fazem sentido de cara. */
export function defaultAudienceRule(type: AudienceRuleType): AudienceRule {
  switch (type) {
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
  recipients: number;
  seen: number;
  snoozed: number;
  studied7d: number;
};

export type FunnelStep = {
  /** "de quem recebeu", "de quem viu". */
  base: string;
  id: "clicked" | "recipients" | "seen" | "studied";
  label: string;
  percent: number | null;
  value: number;
};

/** Para quem -> Viram -> Clicaram -> Voltaram a estudar (7 dias), cada passo sobre o anterior. */
export function noticeFunnel(stats: NoticeStatsInput, kind: CampaignKind): FunnelStep[] {
  return [
    { base: kind === "inbox" ? "receberam no sino" : "podem ver o pop-up", id: "recipients", label: "Para quem", percent: null, value: stats.recipients },
    {
      base: kind === "inbox" ? "de quem recebeu" : "de quem pode ver",
      id: "seen",
      label: "Viram",
      percent: ratio(stats.seen, stats.recipients),
      value: stats.seen
    },
    { base: "de quem viu", id: "clicked", label: "Clicaram", percent: ratio(stats.clicked, stats.seen), value: stats.clicked },
    { base: "de quem viu", id: "studied", label: "Voltaram a estudar (7 dias)", percent: ratio(stats.studied7d, stats.seen), value: stats.studied7d }
  ];
}

/** "Fecharam sem clicar" sobre quem viu o pop-up. */
export function closedWithoutClickRate(stats: Pick<NoticeStatsInput, "closedWithoutClick" | "seen">) {
  return ratio(stats.closedWithoutClick, stats.seen);
}

export function isHighCloseRate(rate: number | null) {
  return rate !== null && rate > HIGH_CLOSE_RATE;
}
