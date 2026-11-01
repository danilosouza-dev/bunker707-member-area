// Contas e textos de tempo dos Webinarios (docs/30 §1): contagem regressiva, "Quarta, 5/11 as 20:00" e a hora
// em Sao Paulo. Modulo puro (so Intl), carregado direto pelo Node nos testes. Toda data mostrada ao aluno sai
// daqui ou de src/lib/member-format.ts.

export const WEBINAR_TIME_ZONE = "America/Sao_Paulo";

export type CountdownParts = { days: number; hours: number; minutes: number; totalMinutes: number };

export function countdownParts(targetMs: number, nowMs: number): CountdownParts {
  const totalMinutes = Math.max(0, Math.floor((targetMs - nowMs) / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes - days * 24 * 60) / 60);
  const minutes = totalMinutes - days * 24 * 60 - hours * 60;
  return { days, hours, minutes, totalMinutes };
}

/** "2 d 4 h 12 min", "1 h 5 min", "12 min" ou "menos de 1 min"; vazio quando ja passou. */
export function formatCountdown(targetMs: number, nowMs: number): string {
  if (!Number.isFinite(targetMs) || targetMs <= nowMs) {
    return "";
  }
  const { days, hours, minutes, totalMinutes } = countdownParts(targetMs, nowMs);
  if (totalMinutes === 0) {
    return "menos de 1 min";
  }
  // "2 d 4 h 12 min" (docs/30 §1.2): so as partes que nao sao zero, sempre ate o minuto.
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days} d`);
  }
  if (hours > 0) {
    parts.push(`${hours} h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} min`);
  }
  return parts.join(" ");
}

/** "Começa em 2 d 4 h 12 min"; vazio quando ja passou (a tela decide o que mostrar). */
export function countdownLabel(targetIso: string, nowMs: number): string {
  const text = formatCountdown(new Date(targetIso).getTime(), nowMs);
  return text ? `Começa em ${text}` : "";
}

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

function saoPauloFields(date: Date) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: WEBINAR_TIME_ZONE,
    weekday: "short",
    year: "numeric"
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  // O dia da semana por indice evita a abreviacao do Intl ("qua.") e o ponto final.
  const weekdayIndex = new Date(
    Number(pick("year")),
    Number(pick("month")) - 1,
    Number(pick("day"))
  ).getDay();
  return {
    day: pick("day"),
    hour: pick("hour") === "24" ? "00" : pick("hour"),
    minute: pick("minute"),
    month: pick("month"),
    weekday: WEEKDAYS[weekdayIndex] ?? "",
    year: pick("year")
  };
}

/** "20:00" no horario de Sao Paulo. */
export function saoPauloTime(iso: string | null | undefined): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const fields = saoPauloFields(date);
  return `${fields.hour}:${fields.minute}`;
}

/** "Quarta, 5/11 às 20:00" (docs/30 §1.2). */
export function formatWebinarWhen(iso: string | null | undefined): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const fields = saoPauloFields(date);
  return `${fields.weekday}, ${Number(fields.day)}/${Number(fields.month)} às ${fields.hour}:${fields.minute}`;
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;

/** "Quinta, 30 de outubro" no horario de Sao Paulo (a linha da data no cabecalho da sala, docs/31 V2-3). */
export function formatWebinarDayLong(iso: string | null | undefined): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const fields = saoPauloFields(date);
  return `${fields.weekday}, ${Number(fields.day)} de ${MONTHS[Number(fields.month) - 1] ?? ""}`;
}

/** "05/11/2026" no horario de Sao Paulo (e-mails e lista do admin). */
export function saoPauloDate(iso: string | null | undefined): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const fields = saoPauloFields(date);
  return `${fields.day}/${fields.month}/${fields.year}`;
}

/** Dia (AAAA-MM-DD) em Sao Paulo, para saber se duas horas caem no mesmo dia. */
export function saoPauloDayKey(iso: string | number | Date): string {
  const date = iso instanceof Date ? iso : new Date(iso);
  const fields = saoPauloFields(date);
  return `${fields.year}-${fields.month}-${fields.day}`;
}

/** "(no seu horário: 21:00)" quando o aparelho esta em outro fuso; vazio quando e o mesmo horario. */
export function localTimeHint(iso: string, localTimeZone: string | undefined): string {
  if (!localTimeZone || localTimeZone === WEBINAR_TIME_ZONE) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  try {
    const local = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", hour12: false, minute: "2-digit", timeZone: localTimeZone }).format(date);
    const here = saoPauloTime(iso);
    return local && local !== here ? `(no seu horário: ${local})` : "";
  } catch {
    return "";
  }
}
