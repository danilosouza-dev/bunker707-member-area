// Formatacao e tons da area de Alunos. Modulo puro (sem React): os testes carregam pelo Node.

import { ADMIN_TIME_ZONE } from "../format";
import type { StatusChipTone } from "../status-chip";
import type { AccessState, StudentPace } from "@/server/students/model";

const DAY_MS = 86_400_000;

const shortDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: ADMIN_TIME_ZONE, year: "numeric" });
const longDate = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: ADMIN_TIME_ZONE, year: "numeric" });
const dateTime = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "2-digit",
  timeZone: ADMIN_TIME_ZONE,
  year: "numeric"
});

function parse(iso: string | null | undefined) {
  if (!iso) {
    return null;
  }

  const date = new Date(iso);

  return Number.isNaN(date.getTime()) ? null : date;
}

/** "14/10/2026"; sem data, "—". */
export function formatShortDate(iso: string | null | undefined) {
  const date = parse(iso);

  return date ? shortDate.format(date) : "—";
}

/** "14 de outubro de 2026". */
export function formatLongDate(iso: string | null | undefined) {
  const date = parse(iso);

  return date ? longDate.format(date) : "—";
}

/** "14/10/2026 09:30". */
export function formatDateTime(iso: string | null | undefined) {
  const date = parse(iso);

  return date ? dateTime.format(date) : "—";
}

/** "hoje", "ontem", "há 3 dias", "há 2 semanas", "há 3 meses", "há 1 ano"; sem data, "Nunca". */
export function formatRelativeDate(iso: string | null | undefined, now: number, never = "Nunca") {
  const date = parse(iso);

  if (!date) {
    return never;
  }

  const days = Math.floor((now - date.getTime()) / DAY_MS);

  if (days <= 0) {
    return "hoje";
  }

  if (days === 1) {
    return "ontem";
  }

  if (days < 14) {
    return `há ${days} dias`;
  }

  if (days < 60) {
    return `há ${Math.floor(days / 7)} semanas`;
  }

  if (days < 365) {
    return `há ${Math.floor(days / 30)} meses`;
  }

  const years = Math.floor(days / 365);

  return years === 1 ? "há 1 ano" : `há ${years} anos`;
}

/** Dias inteiros ate a data (negativo se ja passou); null sem data. */
export function daysUntil(iso: string | null | undefined, now: number) {
  const date = parse(iso);

  return date ? Math.ceil((date.getTime() - now) / DAY_MS) : null;
}

/** "Sem prazo", "Termina em 12 dias", "Terminou há 3 dias", "Até 12/01/2027". */
export function describeAccessEnd(endsAt: string | null, now: number) {
  const days = daysUntil(endsAt, now);

  if (days === null) {
    return "Sem prazo";
  }

  if (days < 0) {
    return `Terminou ${formatRelativeDate(endsAt, now)}`;
  }

  if (days === 0) {
    return "Termina hoje";
  }

  if (days <= 30) {
    return days === 1 ? "Termina amanhã" : `Termina em ${days} dias`;
  }

  return `Até ${formatShortDate(endsAt)}`;
}

export function paceTone(pace: StudentPace): StatusChipTone {
  switch (pace) {
    case "studying":
      return "success";
    case "at_risk":
      return "warning";
    case "inactive":
      return "error";
    case "completed":
      return "neutral";
    default:
      return "muted";
  }
}

export function accessStateTone(state: AccessState): StatusChipTone {
  switch (state) {
    case "active":
      return "success";
    case "expiring":
    case "suspended":
      return "warning";
    case "revoked":
      return "error";
    case "scheduled":
      return "neutral";
    default:
      return "muted";
  }
}

/** Valor minimo do campo de data (hoje no fuso da escola), "AAAA-MM-DD". */
export function todayInputValue(now: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: ADMIN_TIME_ZONE, year: "numeric" }).format(new Date(now));

  return parts;
}
