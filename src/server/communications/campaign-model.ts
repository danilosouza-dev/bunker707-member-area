// Avisos da equipe (Comunicacao > Avisos e pop-ups, docs/22): tipos, limites fixos, situacao, acoes
// disponiveis, aprovacao acima de 500 alunos (docs/17 D4), agenda no fuso de Sao Paulo e o que cada
// evento do pop-up grava. Modulo puro: sem "server-only", imports relativos; os testes
// (tests/comunicacao-avisos-modelo.test.mjs) carregam direto pelo Node e o editor do admin usa as
// mesmas regras e frases.
// v3a (docs/24 §2.1 e §4.9): o menu com Ver relatorio, Editar a notificacao enviada, Excluir em toda
// situacao e "Mostrar de novo para quem ja viu" no pop-up "Uma vez" (a regra conta so o que veio depois).
// v3b-1 (docs/25): "Mostrar de novo" em qualquer "Quantas vezes", o "Lembrar depois" com o tempo do pop-up
// e a frase de revisao com onde, quando e quantas vezes. Quando e onde cada pop-up abre para cada aluno
// (paginas, momento e quantas vezes) mora em popup-display-model.ts.

export const CAMPAIGN_KINDS = ["inbox", "popup"] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];

export const CAMPAIGN_KIND_LABELS: Record<CampaignKind, string> = {
  inbox: "Notificação",
  popup: "Pop-up"
};

/** Limites de texto (docs/17 §1.8.2 para o pop-up; a notificacao do sino aceita um texto maior). */
export const NOTICE_LIMITS = {
  inbox: { body: 600, title: 80 },
  popup: { body: 240, title: 60 },
  ctaLabel: 30,
  imageAlt: 160,
  responseLabel: 24
} as const;

/** Acima disto, quem nao tem "messaging.publish_large" envia para aprovacao (docs/17 D4). */
export const APPROVAL_THRESHOLD = 500;

/**
 * "Lembrar depois" de cada pop-up (docs/17 §1.8.1): ate 2 vezes desde o ultimo "mostrar de novo"; volta
 * depois do "Volta em" do pop-up (v3b-1), 24 h sem o valor. Sem limite entre pop-ups (decisao do produtor,
 * docs/24 §10): a frequencia de cada um e escolhida pela equipe (popup-display-model.ts, docs/25).
 */
export const POPUP_RULES = {
  maxSnoozes: 2,
  snoozeHours: 24
} as const;

/** O sino mostra os ultimos 90 dias (docs/17 §1.8.1). */
export const INBOX_HISTORY_DAYS = 90;

export const AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
  "audio/wav",
  "audio/x-wav"
] as const;

export const AUDIO_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxSeconds: 300,
  /** Barras da forma de onda gravadas com o aviso. */
  peaks: 48
} as const;

export const CAMPAIGN_STATUSES = [
  "draft",
  "pending_approval",
  "scheduled",
  "sending",
  "sent",
  "canceled",
  "active",
  "paused",
  "ended"
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

const INBOX_STATUSES = new Set<CampaignStatus>(["draft", "pending_approval", "scheduled", "sending", "sent", "canceled"]);
const POPUP_STATUSES = new Set<CampaignStatus>(["draft", "pending_approval", "active", "paused", "ended"]);

export function isCampaignStatusFor(kind: CampaignKind, status: CampaignStatus) {
  return (kind === "inbox" ? INBOX_STATUSES : POPUP_STATUSES).has(status);
}

/* ------------------------------------------------------------------------------------------------
 * Situacao (o que a equipe le na lista)
 * ---------------------------------------------------------------------------------------------- */

export type CampaignSituation = CampaignStatus;

export const SITUATION_LABELS: Record<CampaignSituation, string> = {
  active: "Ativo",
  canceled: "Cancelado",
  draft: "Rascunho",
  ended: "Encerrado",
  paused: "Pausado",
  pending_approval: "Aguardando aprovação",
  scheduled: "Agendado",
  sending: "Enviando",
  sent: "Enviado"
};

export type SituationTone = "error" | "muted" | "neutral" | "success" | "warning";

export type CampaignTiming = {
  endsAt: string | null;
  kind: CampaignKind;
  sendAt: string | null;
  startsAt: string | null;
  status: CampaignStatus;
};

function timeOf(value: string | null) {
  if (!value) {
    return null;
  }

  const time = Date.parse(value);

  return Number.isFinite(time) ? time : null;
}

/**
 * Pop-up publicado antes do inicio da janela aparece como "Agendado"; depois do fim, "Encerrado".
 * O resto e a situacao gravada.
 */
export function situationOf(campaign: CampaignTiming, now: number): CampaignSituation {
  if (campaign.kind === "popup" && campaign.status === "active") {
    const startsAt = timeOf(campaign.startsAt);
    const endsAt = timeOf(campaign.endsAt);

    if (endsAt !== null && endsAt <= now) {
      return "ended";
    }

    if (startsAt !== null && startsAt > now) {
      return "scheduled";
    }
  }

  return campaign.status;
}

/** Pop-up no ar agora (publicado e dentro da janela). */
export function isPopupLive(campaign: CampaignTiming, now: number) {
  return campaign.kind === "popup" && campaign.status === "active" && situationOf(campaign, now) === "active";
}

export function situationTone(situation: CampaignSituation): SituationTone {
  switch (situation) {
    case "active":
    case "sent":
      return "success";
    case "pending_approval":
    case "scheduled":
    case "sending":
      return "warning";
    case "paused":
      return "neutral";
    default:
      return "muted";
  }
}

/* ------------------------------------------------------------------------------------------------
 * Acoes disponiveis e aprovacao
 * ---------------------------------------------------------------------------------------------- */

export type NoticeAction =
  | "approve"
  | "cancel_schedule"
  | "delete"
  | "duplicate"
  | "edit"
  | "end"
  | "pause"
  | "publish"
  | "reject"
  | "reshow"
  | "resume"
  | "send_test"
  | "view_report"
  | "withdraw";

export type NoticePermissions = { canPublish: boolean; canPublishLarge: boolean; canWrite: boolean };

/**
 * Rascunho, aguardando aprovacao, notificacao agendada, notificacao enviada (v3a: so o conteudo, docs/24
 * §2.2) e pop-up publicado ou pausado podem ser editados.
 */
export function isEditableStatus(kind: CampaignKind, status: CampaignStatus) {
  if (status === "draft" || status === "pending_approval") {
    return true;
  }

  return kind === "inbox" ? status === "scheduled" || status === "sent" : status === "active" || status === "paused";
}

/** O que os alunos ja veem: pop-up publicado ou pausado, ou notificacao enviada (editar vale como publicar). */
export function isLiveNoticeStatus(kind: CampaignKind, status: CampaignStatus | null | undefined) {
  return kind === "popup" ? status === "active" || status === "paused" : status === "sent";
}

/**
 * Quantos alunos a notificacao alcancou (ou alcanca): o maior entre quem recebeu e a contagem do segmento.
 * A mesma conta no menu (Editar acima de 500) e nas Server Actions.
 */
export function noticeRecipients(row: { audience_count: number | null; recipients_count: number | null }) {
  return Math.max(row.recipients_count ?? 0, row.audience_count ?? 0);
}

/**
 * O que mais o menu precisa saber: quantos alunos a notificacao alcancou. `popupRepeat` continua aceito, mas
 * desde a v3b-1 nao muda nada ("Mostrar de novo" vale em qualquer "Quantas vezes").
 */
export type NoticeActionsExtra = { popupRepeat?: PopupRepeat | null; recipients?: number | null };

/**
 * Ordem do menu "…" (a mesma de MENU_ORDER em notices-view-model.ts; "Publicar" fica no editor, logo
 * depois de Editar).
 */
const ACTION_ORDER: readonly NoticeAction[] = [
  "view_report",
  "edit",
  "publish",
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

/**
 * O que a pessoa pode fazer com o aviso agora, na ordem do menu (o servidor confere de novo em cada acao).
 * Sem `extra` (chamadas antigas), Editar a notificacao enviada segue so "messaging.publish". "Mostrar de
 * novo" (v3b-1) aparece no pop-up no ar (dentro da janela) ou pausado, em qualquer "Quantas vezes".
 */
export function availableNoticeActions(
  campaign: CampaignTiming,
  now: number,
  permissions: NoticePermissions,
  extra: NoticeActionsExtra = {}
): NoticeAction[] {
  if (!permissions.canWrite) {
    return [];
  }

  const situation = situationOf(campaign, now);
  const allowed = new Set<NoticeAction>();
  const add = (action: NoticeAction, ok = true) => {
    if (ok) {
      allowed.add(action);
    }
  };
  const { canPublish, canPublishLarge } = permissions;

  switch (campaign.status) {
    case "draft":
      add("edit");
      add("publish");
      add("send_test", campaign.kind === "inbox");
      add("duplicate");
      add("delete");
      break;
    case "pending_approval":
      add("edit");
      add("approve", canPublishLarge);
      add("reject", canPublishLarge);
      add("send_test", campaign.kind === "inbox");
      add("duplicate");
      add("delete");
      break;
    case "scheduled":
      add("edit");
      add("send_test");
      add("duplicate");
      add("cancel_schedule", canPublish);
      add("delete", canPublish);
      break;
    case "sending":
      add("view_report");
      add("duplicate");
      break;
    case "sent": {
      // Editar a notificacao enviada vale como publicar; acima de 500 alunos, so com publish_large.
      const recipients = extra.recipients ?? null;

      add("view_report");
      add("edit", canPublish && (recipients === null || recipients <= APPROVAL_THRESHOLD || canPublishLarge));
      add("duplicate");
      add("withdraw", canPublish);
      add("delete", canPublish);
      break;
    }
    case "canceled":
      add("view_report");
      add("duplicate");
      add("delete");
      break;
    case "active":
      add("view_report");
      add("duplicate");

      if (situation === "ended") {
        add("delete");
        break;
      }

      // Editar o pop-up no ar muda o que os alunos veem agora: vale como publicar (docs/22 §2.3).
      add("edit", canPublish);
      add("pause", canPublish);
      add("reshow", canPublish && situation === "active");
      add("end", canPublish);
      add("delete", canPublish);
      break;
    case "paused":
      add("view_report");
      add("edit", canPublish);
      add("resume", canPublish);
      add("reshow", canPublish);
      add("duplicate");
      add("end", canPublish);
      add("delete", canPublish);
      break;
    case "ended":
      add("view_report");
      add("duplicate");
      add("delete");
      break;
  }

  return ACTION_ORDER.filter((action) => allowed.has(action));
}

/**
 * Publicar direto ou pedir aprovacao (docs/17 D4): sem "messaging.publish", sempre aprovacao; acima de
 * 500 alunos, so quem tem "messaging.publish_large" publica direto. Vale tambem para editar ou retomar
 * um pop-up no ar (sem a permissao, a acao e recusada em vez de virar pedido).
 */
export function publishDecision(input: { audienceCount: number; canPublish: boolean; canPublishLarge: boolean }): "needs_approval" | "publish" {
  if (!input.canPublish) {
    return "needs_approval";
  }

  return input.audienceCount > APPROVAL_THRESHOLD && !input.canPublishLarge ? "needs_approval" : "publish";
}

/** Instante em microssegundos de um timestamp ISO (o banco grava ate o microssegundo); invalido -> null. */
function versionMicros(value: string) {
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$/.exec(value.trim());

  if (!match) {
    return null;
  }

  const seconds = Date.parse(`${match[1]}${match[3]}`);

  if (!Number.isFinite(seconds)) {
    return null;
  }

  return seconds * 1000 + Number((match[2] ?? "").padEnd(6, "0").slice(0, 6));
}

/**
 * A versao lida pela tela (`updated_at`) e a mesma do banco? Compara o instante ate o microssegundo,
 * qualquer que seja o formato ("Z" ou "+00:00", com ou sem fracao).
 */
export function isSameVersion(left: string, right: string) {
  if (left === right) {
    return true;
  }

  const leftMicros = versionMicros(left);

  return leftMicros !== null && leftMicros === versionMicros(right);
}

/**
 * Pop-up no ar com recalculo anterior a este instante esta vencido. O relogio e alinhado em faixas de
 * `everyMs` (15 minutos): todos os pop-ups vencidos caem no mesmo tick e dividem uma leitura dos alunos,
 * em vez de cada um ter o proprio relogio.
 */
export function popupRefreshDueBefore(now: number, everyMs: number) {
  return Math.floor(now / everyMs) * everyMs;
}

/* ------------------------------------------------------------------------------------------------
 * Agenda no fuso de Sao Paulo (UTC-3 fixo, sem horario de verao, como o resto do sistema)
 * ---------------------------------------------------------------------------------------------- */

const SAO_PAULO_OFFSET = "-03:00";
const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000;
const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_INPUT = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "2026-10-21" + "14:30" (relogio de Sao Paulo) -> ISO em UTC; entrada invalida -> null. */
export function saoPauloLocalToIso(date: string, time: string): string | null {
  const dateMatch = DATE_INPUT.exec(date);

  if (!dateMatch || !TIME_INPUT.test(time)) {
    return null;
  }

  const parsed = new Date(`${date}T${time}:00.000${SAO_PAULO_OFFSET}`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  // 2026-02-31 vira 03/03 no Date: confere se o dia continua o mesmo.
  const local = new Date(parsed.getTime() - SAO_PAULO_OFFSET_MS);

  if (local.getUTCFullYear() !== Number(dateMatch[1]) || local.getUTCMonth() + 1 !== Number(dateMatch[2]) || local.getUTCDate() !== Number(dateMatch[3])) {
    return null;
  }

  return parsed.toISOString();
}

/** ISO -> { date: "2026-10-21", time: "14:30" } no relogio de Sao Paulo (para preencher os campos). */
export function isoToSaoPauloLocal(iso: string | null | undefined): { date: string; time: string } | null {
  const time = timeOf(iso ?? null);

  if (time === null) {
    return null;
  }

  const local = new Date(time - SAO_PAULO_OFFSET_MS).toISOString();

  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

/** "21/10/2026 às 14:30" no fuso de Sao Paulo; invalido -> "". */
export function formatSaoPauloDateTime(iso: string | null | undefined) {
  const local = isoToSaoPauloLocal(iso);

  if (!local) {
    return "";
  }

  const [year, month, day] = local.date.split("-");

  return `${day}/${month}/${year} às ${local.time}`;
}

/* ------------------------------------------------------------------------------------------------
 * Frase de revisao do editor
 * ---------------------------------------------------------------------------------------------- */

export type PopupRepeat = "once" | "until_action";

export const POPUP_REPEAT_LABELS: Record<PopupRepeat, string> = {
  once: "no máximo 1 vez",
  until_action: "até o aluno clicar (no máximo 1 vez por dia)"
};

function audiencePhrase(count: number | null) {
  if (count === null) {
    return "para os alunos do segmento";
  }

  return count === 1 ? "para 1 aluno" : `para ${new Intl.NumberFormat("pt-BR").format(count)} alunos`;
}

export type NoticeReviewInput = {
  audienceCount: number | null;
  /** Notificacoes seguintes (v2): quantas e o produto da linha "Parar ... para quem tiver acesso a". */
  followUps?: { count: number; stopProductName?: string | null } | null;
  kind: CampaignKind;
  /**
   * v3b-1: as partes do pop-up ja em frase (popupReviewParts de popup-sentences.ts): onde e quando (null = o
   * padrao, so no Inicio ao abrir) e quantas vezes; sem valor, a frase de `repeat` da v1.
   */
  popup?: { frequency: string; placement: string | null } | null;
  repeat: PopupRepeat;
  schedule: { mode: "now" } | { mode: "at"; sendAt: string };
  /**
   * Quanto tempo fica no sino, ja em frase ("fica 3 dias no sino", describeValidity de message-meta.ts,
   * que importa este modulo); sem valor, a frase da v1.
   */
  validity?: string | null;
  window: { endsAt: string | null; startsAt: string | null };
};

/** " Depois: 2 notificações seguintes, que param para quem tiver acesso a Formação IA." */
function followUpsPhrase(followUps: NoticeReviewInput["followUps"]) {
  const count = followUps ? Math.max(0, Math.floor(followUps.count)) : 0;

  if (!followUps || count === 0) {
    return "";
  }

  const label = count === 1 ? "1 notificação seguinte" : `${new Intl.NumberFormat("pt-BR").format(count)} notificações seguintes`;
  const product = followUps.stopProductName?.trim();

  return ` Depois: ${label}${product ? `, que param para quem tiver acesso a ${product}` : ""}.`;
}

/**
 * "Notificação para 318 alunos, enviada agora, fica 3 dias no sino. Depois: 2 notificações seguintes." /
 * "Pop-up para 318 alunos, de 14/10/2026 às 09:00 a 21/10/2026 às 23:59, no máximo 1 vez."
 */
export function describeNoticeReview(input: NoticeReviewInput) {
  const audience = audiencePhrase(input.audienceCount);

  if (input.kind === "inbox") {
    const when =
      input.schedule.mode === "at" && formatSaoPauloDateTime(input.schedule.sendAt)
        ? `agendada para ${formatSaoPauloDateTime(input.schedule.sendAt)}`
        : "enviada agora";
    const validity = input.validity?.trim();

    return `Notificação ${audience}, ${when}${validity ? `, ${validity}` : ""}.${followUpsPhrase(input.followUps)}`;
  }

  const start = formatSaoPauloDateTime(input.window.startsAt);
  const end = formatSaoPauloDateTime(input.window.endsAt);
  let period: string;

  if (start && end) {
    period = `de ${start} a ${end}`;
  } else if (start) {
    period = `a partir de ${start}, sem data para acabar`;
  } else if (end) {
    period = `a partir de agora até ${end}`;
  } else {
    period = "a partir de agora, sem data para acabar";
  }

  const placement = input.popup?.placement;

  return `Pop-up ${audience}${placement ? `, ${placement}` : ""}, ${period}, ${input.popup?.frequency ?? POPUP_REPEAT_LABELS[input.repeat]}.`;
}

/* ------------------------------------------------------------------------------------------------
 * Estado de cada aluno num pop-up (a linha de campaign_deliveries) e o que cada evento grava. Quando o
 * pop-up abre (paginas, momento e quantas vezes) e decidido em popup-display-model.ts (docs/25).
 * ---------------------------------------------------------------------------------------------- */

const MINUTE_MS = 60_000;

export type PopupDeliveryState = {
  campaignId: string;
  clickedAt: number | null;
  dismissedAt: number | null;
  eligible: boolean;
  impressions: number;
  lastSeenAt: number | null;
  snoozeCount: number;
  snoozedUntil: number | null;
  /** v3a: impressoes e "Lembrar depois" antes do ultimo "mostrar de novo" (a regra "Uma vez" conta so as de depois). */
  impressionsBeforeReshow?: number;
  snoozesBeforeReshow?: number;
};

export const POPUP_EVENTS = ["impressed", "clicked", "closed", "dismissed", "snoozed"] as const;
export type PopupEvent = (typeof POPUP_EVENTS)[number];

/** "Lembrar depois" ate 2 vezes, contadas desde o ultimo "mostrar de novo" (v3a). */
export function canSnooze(state: Pick<PopupDeliveryState, "snoozeCount" | "snoozesBeforeReshow">, allowSnooze: boolean) {
  return allowSnooze && state.snoozeCount - (state.snoozesBeforeReshow ?? 0) < POPUP_RULES.maxSnoozes;
}

/** Colunas de campaign_deliveries que mudam com o evento. */
export type PopupDeliveryPatch = {
  clicked_at?: string;
  dismissed_at?: string;
  first_seen_at?: string;
  impressions?: number;
  last_seen_at?: string;
  snooze_count?: number;
  snoozed_until?: string;
};

/**
 * O que gravar para o evento do aluno. `closed` (fechou no X, Esc ou fora) nao muda coluna: fica so no
 * historico. `snoozed` sem permissao ou depois de 2 vezes -> null (recusado); volta depois de `snoozeMinutes`
 * (v3b-1, o "Volta em" do pop-up), 24 h sem o valor. `impressed` fica para os testes da v1 (desde a v3b-1
 * a abertura e gravada pela RPC communication_record_popup_impression).
 */
export function popupEventPatch(
  state: PopupDeliveryState,
  event: PopupEvent,
  input: { allowSnooze: boolean; now: number; snoozeMinutes?: number }
): PopupDeliveryPatch | null {
  const nowIso = new Date(input.now).toISOString();

  switch (event) {
    case "impressed":
      return {
        impressions: state.impressions + 1,
        last_seen_at: nowIso,
        ...(state.lastSeenAt === null && state.impressions === 0 ? { first_seen_at: nowIso } : {})
      };
    case "clicked":
      return state.clickedAt === null ? { clicked_at: nowIso } : {};
    case "closed":
      return {};
    case "dismissed":
      return state.dismissedAt === null ? { dismissed_at: nowIso } : {};
    case "snoozed":
      if (!canSnooze(state, input.allowSnooze)) {
        return null;
      }

      return {
        snooze_count: state.snoozeCount + 1,
        snoozed_until: new Date(input.now + (input.snoozeMinutes ?? POPUP_RULES.snoozeHours * 60) * MINUTE_MS).toISOString()
      };
  }

  return null;
}
