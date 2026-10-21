// Comunicacao v2 (docs/23 e docs/22): o que acompanha o conteudo de cada notificacao. Icone ao lado do
// titulo (catalogo de ids estaveis e cores da paleta), quanto tempo fica no sino (validade e o fim de cada
// linha), o aviso de "Termina em" e o icone da escola no circulo. Modulo puro: sem "server-only" e com
// imports relativos, para tests/comunicacao-v2-mensagem.test.mjs carregar direto pelo Node; o sino, o
// editor do admin, o envio e o motor dos fluxos usam as mesmas regras e frases.
//
// So os ids ficam no banco (campaigns.icon e icon_color, conferidos so no formato): o desenho de cada id
// mora em src/components/member/notifications/notice-icons.tsx e pode mudar sem migracao.

import { formatSaoPauloDateTime, INBOX_HISTORY_DAYS } from "./campaign-model";

/* ------------------------------------------------------------------------------------------------
 * Icone ao lado do titulo
 * ---------------------------------------------------------------------------------------------- */

export const NOTICE_ICON_IDS = [
  "promo",
  "gift",
  "calendar",
  "live",
  "lesson",
  "book",
  "graduation",
  "sparkles",
  "rocket",
  "flame",
  "trophy",
  "star",
  "clock",
  "mic",
  "megaphone",
  "alert"
] as const;
export type NoticeIconId = (typeof NOTICE_ICON_IDS)[number];

/** Paleta do icone (docs/12): vermelho da marca, laranja, amarelo de alerta, verde e branco. */
export const NOTICE_ICON_COLORS = ["white", "red", "orange", "amber", "green"] as const;
export type NoticeIconColor = (typeof NOTICE_ICON_COLORS)[number];

export const NOTICE_ICON_LABELS: Record<NoticeIconId, string> = {
  alert: "Importante",
  book: "Material",
  calendar: "Agenda",
  clock: "Prazo",
  flame: "Em alta",
  gift: "Presente",
  graduation: "Formação",
  lesson: "Aula nova",
  live: "Ao vivo",
  megaphone: "Aviso",
  mic: "Áudio",
  promo: "Promoção",
  rocket: "Lançamento",
  sparkles: "Novidade",
  star: "Destaque",
  trophy: "Conquista"
};

/** Cor ja marcada quando o produtor escolhe o icone (ele pode trocar). */
export const NOTICE_ICON_SUGGESTED_COLOR: Record<NoticeIconId, NoticeIconColor> = {
  alert: "amber",
  book: "white",
  calendar: "amber",
  clock: "amber",
  flame: "orange",
  gift: "green",
  graduation: "white",
  lesson: "white",
  live: "red",
  megaphone: "red",
  mic: "white",
  promo: "red",
  rocket: "orange",
  sparkles: "amber",
  star: "amber",
  trophy: "amber"
};

export const NOTICE_ICON_COLOR_LABELS: Record<NoticeIconColor, string> = {
  amber: "Amarelo",
  green: "Verde",
  orange: "Laranja",
  red: "Vermelho",
  white: "Branco"
};

export function isNoticeIconId(value: unknown): value is NoticeIconId {
  return typeof value === "string" && (NOTICE_ICON_IDS as readonly string[]).includes(value);
}

export function isNoticeIconColor(value: unknown): value is NoticeIconColor {
  return typeof value === "string" && (NOTICE_ICON_COLORS as readonly string[]).includes(value);
}

/** Icone gravado (campaigns.icon + icon_color) lido sem confiar: id ou cor fora do catalogo = sem icone. */
export function noticeIconOfColumns(icon: string | null | undefined, color: string | null | undefined): { color: NoticeIconColor; id: NoticeIconId } | null {
  return isNoticeIconId(icon) && isNoticeIconColor(color) ? { color, id: icon } : null;
}

/* ------------------------------------------------------------------------------------------------
 * Quanto tempo fica no sino ("Fica no sino por")
 * ---------------------------------------------------------------------------------------------- */

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** De 1 hora a 90 dias (a janela do sino, INBOX_HISTORY_DAYS); sem escolha = 90 dias. */
export const VALIDITY_LIMITS = {
  defaultMinutes: INBOX_HISTORY_DAYS * 1_440,
  maxMinutes: INBOX_HISTORY_DAYS * 1_440,
  minMinutes: 60,
  /** "Termina em" so aparece quando falta isto ou menos... */
  urgencyWindowMs: 24 * HOUR_MS,
  /** ...e a notificacao fica no sino por ate isto (o padrao de 90 dias nunca mostra). */
  urgencyMaxTotalMs: 30 * DAY_MS
} as const;

/** Validade de uma notificacao: padrao (90 dias), por um tempo depois de chegar ou ate uma data. */
export type Validity = { mode: "default" } | { minutes: number; mode: "duration" } | { endsAt: string; mode: "until" };

/**
 * Conteudo de passo de fluxo: tambem "Ate a notificacao principal sumir" (sai do sino junto com a
 * notificacao de referencia de cada aluno). Nao e coluna do aviso: vira communication_flow_nodes.
 * expire_with_anchor e as colunas de validade do aviso ficam nulas (90 dias continua sendo o teto).
 */
export type FlowValidity = Validity | { mode: "with_anchor" };

export const DEFAULT_VALIDITY: Validity = { mode: "default" };

/** Opcoes rapidas do editor; 90 dias e o padrao (nada gravado). */
export const VALIDITY_PRESETS: readonly { days: number; label: string; validity: Validity }[] = [
  { days: 1, label: "1 dia", validity: { minutes: 1_440, mode: "duration" } },
  { days: 3, label: "3 dias", validity: { minutes: 4_320, mode: "duration" } },
  { days: 7, label: "7 dias", validity: { minutes: 10_080, mode: "duration" } },
  { days: 30, label: "30 dias", validity: { minutes: 43_200, mode: "duration" } },
  { days: 90, label: "90 dias", validity: { mode: "default" } }
];

/** Opcao rapida que corresponde a validade (90 dias = o padrao); outra escolha -> null ("Outro"). */
export function validityPresetDays(validity: FlowValidity): number | null {
  if (validity.mode === "default") {
    return INBOX_HISTORY_DAYS;
  }

  if (validity.mode !== "duration") {
    return null;
  }

  return VALIDITY_PRESETS.find((preset) => preset.validity.mode === "duration" && preset.validity.minutes === validity.minutes)?.days ?? null;
}

/** Validade -> colunas de campaigns (as duas nulas = 90 dias; "ate a principal sumir" tambem fica nulo). */
export function validityToColumns(validity: FlowValidity): { valid_until: string | null; validity_minutes: number | null } {
  switch (validity.mode) {
    case "duration":
      return { valid_until: null, validity_minutes: validity.minutes };
    case "until":
      return { valid_until: validity.endsAt, validity_minutes: null };
    default:
      return { valid_until: null, validity_minutes: null };
  }
}

/** Colunas de campaigns -> validade (linha sem nada = padrao). */
export function validityOfRow(row: { valid_until: string | null; validity_minutes: number | null }): Validity {
  if (row.valid_until) {
    return { endsAt: row.valid_until, mode: "until" };
  }

  if (typeof row.validity_minutes === "number" && row.validity_minutes > 0) {
    return { minutes: row.validity_minutes, mode: "duration" };
  }

  return DEFAULT_VALIDITY;
}

/** O que o fim de uma linha precisa saber do aviso (colunas validity_minutes e valid_until). */
export type ValiditySource = { validUntil: number | string | null; validityMinutes: number | null };

function timeOf(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string" || !value) {
    return null;
  }

  const time = Date.parse(value);

  return Number.isFinite(time) ? time : null;
}

/**
 * Fim da notificacao no sino de um aluno (notifications.expires_at), em ms:
 * min(ate a data, chegada + tempo escolhido (90 dias sem escolha), chegada + 90 dias, fim da notificacao
 * de referencia). `anchorExpiresAt` so vale para passo de fluxo "Ate a notificacao principal sumir".
 */
export function computeExpiresAt(source: ValiditySource, deliveredAt: number, anchorExpiresAt?: number | null): number {
  const limits = [deliveredAt + VALIDITY_LIMITS.maxMinutes * MINUTE_MS];
  const validUntil = timeOf(source.validUntil);

  if (typeof source.validityMinutes === "number" && Number.isFinite(source.validityMinutes) && source.validityMinutes > 0) {
    limits.push(deliveredAt + source.validityMinutes * MINUTE_MS);
  }

  if (validUntil !== null) {
    limits.push(validUntil);
  }

  if (typeof anchorExpiresAt === "number" && Number.isFinite(anchorExpiresAt)) {
    limits.push(anchorExpiresAt);
  }

  return Math.min(...limits);
}

/**
 * Fim da linha de teste da equipe ("Enviar teste para mim"): nunca menos de 1 hora, para o teste de um
 * rascunho com "ate uma data" que ja passou continuar aparecendo (e o check expires_at > created_at).
 */
export function testSendExpiresAt(source: ValiditySource, now: number): number {
  return Math.max(computeExpiresAt(source, now), now + HOUR_MS);
}

/**
 * "Termina em 3 h" / "Termina em 40 min": so na notificacao da equipe ainda sem resposta, quando falta
 * 24 h ou menos e ela fica no sino por 30 dias ou menos. `now` e a hora do servidor da lista (asOf):
 * nada conta no navegador (C11).
 */
export function urgencyLabel(
  item: { createdAt: string; expiresAt: string | null; kind: string; response: { value: string | null } | null },
  now: number
): string | null {
  if (item.kind !== "notice" || item.response?.value) {
    return null;
  }

  const expiresAt = timeOf(item.expiresAt);
  const createdAt = timeOf(item.createdAt);

  if (expiresAt === null || createdAt === null) {
    return null;
  }

  const remaining = expiresAt - now;

  if (remaining <= 0 || remaining > VALIDITY_LIMITS.urgencyWindowMs || expiresAt - createdAt > VALIDITY_LIMITS.urgencyMaxTotalMs) {
    return null;
  }

  const minutes = Math.ceil(remaining / MINUTE_MS);

  return minutes >= 60 ? `Termina em ${Math.max(1, Math.floor(remaining / HOUR_MS))} h` : `Termina em ${Math.max(1, minutes)} min`;
}

/** "1 dia", "3 dias", "5 horas", "90 minutos". */
export function validityDurationLabel(minutes: number): string {
  const value = Math.max(0, Math.round(minutes));

  if (value > 0 && value % 1_440 === 0) {
    const days = value / 1_440;

    return days === 1 ? "1 dia" : `${days} dias`;
  }

  if (value > 0 && value % 60 === 0) {
    const hours = value / 60;

    return hours === 1 ? "1 hora" : `${hours} horas`;
  }

  return value === 1 ? "1 minuto" : `${value} minutos`;
}

/**
 * "fica 3 dias no sino" / "fica no sino até 21/10/2026 às 14:30" / "fica no sino até a principal sumir"
 * (frase de revisao e resumo do cartao; o editor poe a maiuscula quando abre a frase).
 */
export function describeValidity(validity: FlowValidity, options: { anchorLabel?: string } = {}): string {
  switch (validity.mode) {
    case "duration":
      return `fica ${validityDurationLabel(validity.minutes)} no sino`;
    case "until": {
      const when = formatSaoPauloDateTime(validity.endsAt);

      return when ? `fica no sino até ${when}` : `fica ${validityDurationLabel(VALIDITY_LIMITS.defaultMinutes)} no sino`;
    }
    case "with_anchor":
      return `fica no sino até ${options.anchorLabel?.trim() || "a principal"} sumir`;
    default:
      return `fica ${validityDurationLabel(VALIDITY_LIMITS.defaultMinutes)} no sino`;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Quem envia: a escola (icone da escola) ou uma pessoa da equipe
 * ---------------------------------------------------------------------------------------------- */

/** Simbolo Bunker 707 (quadrado, branco): o circulo da escola sem nada configurado em Marca. */
export const SCHOOL_DEFAULT_ICON = "/brand/icon-bunker.svg";

/** Nome de quem envia quando a pessoa da equipe nao tem nome no perfil (nunca o e-mail). */
export const SCHOOL_NAME_FALLBACK_TEAM = "Equipe Bunker707";

/** Icone da escola de Marca (branding.schoolIcon): ausente ou vazio = o simbolo padrao. */
export function normalizeSchoolIcon(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : SCHOOL_DEFAULT_ICON;
}

/** O simbolo padrao fica centralizado no circulo; uma imagem enviada preenche o circulo. */
export function isDefaultSchoolIcon(value: unknown) {
  return normalizeSchoolIcon(value) === SCHOOL_DEFAULT_ICON;
}
