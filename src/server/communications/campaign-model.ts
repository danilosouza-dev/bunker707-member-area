// Avisos da equipe (Comunicacao > Avisos e pop-ups, docs/22): tipos, limites fixos, situacao, acoes
// disponiveis, aprovacao acima de 500 alunos (docs/17 D4), agenda no fuso de Sao Paulo e a escolha do
// pop-up de cada aluno. Modulo puro: sem "server-only", imports relativos; os testes
// (tests/comunicacao-avisos-modelo.test.mjs) carregam direto pelo Node e o editor do admin usa as
// mesmas regras e frases.

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

/** Limites fixos do pop-up (docs/17 §1.8.1): aparecem no editor como texto, nunca como campo. */
export const POPUP_RULES = {
  delayMs: 3_000,
  maxSnoozes: 2,
  minHoursBetween: 24,
  perSession: 1,
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
  | "resume"
  | "send_test"
  | "withdraw";

export type NoticePermissions = { canPublish: boolean; canPublishLarge: boolean; canWrite: boolean };

/** Rascunho, aguardando aprovacao, notificacao agendada e pop-up publicado ou pausado podem ser editados. */
export function isEditableStatus(kind: CampaignKind, status: CampaignStatus) {
  if (status === "draft" || status === "pending_approval") {
    return true;
  }

  return kind === "inbox" ? status === "scheduled" : status === "active" || status === "paused";
}

/** O que a pessoa pode fazer com o aviso agora (o servidor confere de novo em cada acao). */
export function availableNoticeActions(campaign: CampaignTiming, now: number, permissions: NoticePermissions): NoticeAction[] {
  if (!permissions.canWrite) {
    return [];
  }

  const situation = situationOf(campaign, now);
  const actions: NoticeAction[] = [];
  const add = (action: NoticeAction, allowed = true) => {
    if (allowed) {
      actions.push(action);
    }
  };

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
      add("approve", permissions.canPublishLarge);
      add("reject", permissions.canPublishLarge);
      add("send_test", campaign.kind === "inbox");
      add("duplicate");
      add("delete");
      break;
    case "scheduled":
      add("edit");
      add("cancel_schedule", permissions.canPublish);
      add("send_test");
      add("duplicate");
      break;
    case "sending":
      add("duplicate");
      break;
    case "sent":
      add("withdraw", permissions.canPublish);
      add("duplicate");
      break;
    case "canceled":
      add("duplicate");
      add("delete");
      break;
    case "active":
      if (situation === "ended") {
        add("duplicate");
        add("delete");
        break;
      }

      add("edit");
      add("pause", permissions.canPublish);
      add("end", permissions.canPublish);
      add("duplicate");
      break;
    case "paused":
      add("edit");
      add("resume", permissions.canPublish);
      add("end", permissions.canPublish);
      add("duplicate");
      break;
    case "ended":
      add("duplicate");
      add("delete");
      break;
  }

  return actions;
}

/**
 * Publicar direto ou pedir aprovacao (docs/17 D4): sem "messaging.publish", sempre aprovacao; acima de
 * 500 alunos, so quem tem "messaging.publish_large" publica direto.
 */
export function publishDecision(input: { audienceCount: number; canPublish: boolean; canPublishLarge: boolean }): "needs_approval" | "publish" {
  if (!input.canPublish) {
    return "needs_approval";
  }

  return input.audienceCount > APPROVAL_THRESHOLD && !input.canPublishLarge ? "needs_approval" : "publish";
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
  kind: CampaignKind;
  repeat: PopupRepeat;
  schedule: { mode: "now" } | { mode: "at"; sendAt: string };
  window: { endsAt: string | null; startsAt: string | null };
};

/**
 * "Notificação para 318 alunos, enviada agora." / "Pop-up para 318 alunos, de 14/10/2026 às 09:00 a
 * 21/10/2026 às 23:59, no máximo 1 vez."
 */
export function describeNoticeReview(input: NoticeReviewInput) {
  const audience = audiencePhrase(input.audienceCount);

  if (input.kind === "inbox") {
    const when =
      input.schedule.mode === "at" && formatSaoPauloDateTime(input.schedule.sendAt)
        ? `agendada para ${formatSaoPauloDateTime(input.schedule.sendAt)}`
        : "enviada agora";

    return `Notificação ${audience}, ${when}.`;
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

  return `Pop-up ${audience}, ${period}, ${POPUP_REPEAT_LABELS[input.repeat]}.`;
}

/* ------------------------------------------------------------------------------------------------
 * Pop-up de cada aluno (docs/17 §1.8.1): no maximo 1 a cada 24 h; o limite de 1 por sessao fica no
 * navegador. "Uma vez" = some depois da primeira vez; "ate o aluno clicar" = volta no dia seguinte
 * enquanto ele nao clicar nem escolher "Nao mostrar de novo".
 * ---------------------------------------------------------------------------------------------- */

const HOUR_MS = 3_600_000;

export type LivePopup = { allowSnooze: boolean; id: string; repeat: PopupRepeat; startsAt: number };

export type PopupDeliveryState = {
  campaignId: string;
  clickedAt: number | null;
  dismissedAt: number | null;
  eligible: boolean;
  impressions: number;
  lastSeenAt: number | null;
  snoozeCount: number;
  snoozedUntil: number | null;
};

export function pickPopup(input: {
  deliveries: readonly PopupDeliveryState[];
  /** Ultima vez que o aluno viu qualquer pop-up. */
  lastAnyPopupSeenAt: number | null;
  live: readonly LivePopup[];
  now: number;
}): string | null {
  const { now } = input;
  const gap = POPUP_RULES.minHoursBetween * HOUR_MS;

  if (input.lastAnyPopupSeenAt !== null && now - input.lastAnyPopupSeenAt < gap) {
    return null;
  }

  const byCampaign = new Map(input.deliveries.map((delivery) => [delivery.campaignId, delivery] as const));
  const candidates = [...input.live].sort((left, right) => right.startsAt - left.startsAt || (left.id < right.id ? -1 : 1));

  for (const popup of candidates) {
    const delivery = byCampaign.get(popup.id);

    if (!delivery || !delivery.eligible || delivery.clickedAt !== null || delivery.dismissedAt !== null) {
      continue;
    }

    if (delivery.snoozedUntil !== null && delivery.snoozedUntil > now) {
      continue;
    }

    if (popup.repeat === "once" ? delivery.impressions > 0 : delivery.lastSeenAt !== null && now - delivery.lastSeenAt < gap) {
      continue;
    }

    return popup.id;
  }

  return null;
}

export const POPUP_EVENTS = ["impressed", "clicked", "closed", "dismissed", "snoozed"] as const;
export type PopupEvent = (typeof POPUP_EVENTS)[number];

export function canSnooze(state: Pick<PopupDeliveryState, "snoozeCount">, allowSnooze: boolean) {
  return allowSnooze && state.snoozeCount < POPUP_RULES.maxSnoozes;
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
 * historico. `snoozed` sem permissao ou depois de 2 vezes -> null (recusado).
 */
export function popupEventPatch(
  state: PopupDeliveryState,
  event: PopupEvent,
  input: { allowSnooze: boolean; now: number }
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
        snoozed_until: new Date(input.now + POPUP_RULES.snoozeHours * HOUR_MS).toISOString()
      };
  }

  return null;
}
