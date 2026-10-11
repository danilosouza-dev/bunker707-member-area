import type { AdminRole } from "@/server/auth/session";

// Formatacao pt-BR do Admin Bunker707. Nada aqui inventa valor: sem dado, devolve "—".

export const ADMIN_TIME_ZONE = "America/Sao_Paulo";
export const EMPTY_VALUE = "—";

const integerFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const percentFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, style: "percent" });
const deltaFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  signDisplay: "exceptZero",
  style: "percent"
});

export type KpiValueFormat = "number" | "percent";

/** Formata o numero de um KPI. Percentuais chegam de 0 a 100. */
export function formatKpiValue(value: number | null | undefined, format: KpiValueFormat = "number") {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EMPTY_VALUE;
  }

  return format === "percent" ? percentFormatter.format(value / 100) : integerFormatter.format(value);
}

/** Variacao percentual contra o periodo anterior (12.5 => "+12,5%"). */
export function formatDelta(delta: number) {
  return deltaFormatter.format(delta / 100);
}

const magnitudeFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const NBSP = "\u00a0";

export type DeltaUnit = "percent" | "points";

/**
 * Tamanho da variacao, sem sinal (a seta mostra a direcao), como no prototipo: "12 %", "12,5 %",
 * "2 pts", "1 pt". Pontos sao para metricas que ja sao percentuais (Conclusao: 41 % -> 43 % = 2 pts).
 */
export function formatDeltaMagnitude(delta: number, unit: DeltaUnit = "percent") {
  const magnitude = Math.abs(delta);
  const text = magnitudeFormatter.format(magnitude);

  if (unit === "points") {
    return `${text}${NBSP}${magnitude === 1 ? "pt" : "pts"}`;
  }

  return `${text}${NBSP}%`;
}

const adminRoleLabels: Record<AdminRole, string> = {
  admin: "Administrador",
  analyst: "Analista",
  editor: "Editor",
  owner: "Dono",
  support: "Suporte"
};

export function formatAdminRole(role: AdminRole) {
  return adminRoleLabels[role];
}

export function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] ?? "").slice(0, 2);

  return initials.toUpperCase() || "?";
}

function getHourInTimeZone(date: Date, timeZone: string) {
  const hourPart = new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hourCycle: "h23", timeZone })
    .formatToParts(date)
    .find((part) => part.type === "hour");

  return Number(hourPart?.value ?? date.getHours());
}

/** "Bom dia" (5h-11h), "Boa tarde" (12h-17h) ou "Boa noite", no fuso da escola. */
export function getGreeting(date: Date, timeZone = ADMIN_TIME_ZONE) {
  const hour = getHourInTimeZone(date, timeZone);

  if (hour >= 5 && hour < 12) {
    return "Bom dia";
  }

  return hour >= 12 && hour < 18 ? "Boa tarde" : "Boa noite";
}

/** "Sábado, 10 de outubro de 2026". */
export function formatLongDate(date: Date, timeZone = ADMIN_TIME_ZONE) {
  const label = new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    timeZone,
    weekday: "long",
    year: "numeric"
  }).format(date);

  return label.charAt(0).toLocaleUpperCase("pt-BR") + label.slice(1);
}
