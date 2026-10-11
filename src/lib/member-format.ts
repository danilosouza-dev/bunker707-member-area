// Formatacao de datas, tempos e contagens da area do aluno (pt-BR, fuso de Sao Paulo).
//
// Modulo puro, sem imports: roda no servidor, no navegador e nos testes (node --test). Quem esta em
// src/lib importa por caminho relativo ("./member-format") para os testes nao dependerem do alias "@/".
//
// Regra: toda data mostrada ao aluno sai daqui, para a lista de aulas, o aviso sobre o video, Minhas
// compras e Perfil mostrarem o mesmo dia para o mesmo instante.

export const MEMBER_TIME_ZONE = "America/Sao_Paulo";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: MEMBER_TIME_ZONE,
  year: "numeric"
});

const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  timeZone: MEMBER_TIME_ZONE
});

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: MEMBER_TIME_ZONE,
  year: "numeric"
});

const relativeFormatter = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

/** Instante valido em milissegundos, ou null (texto vazio, data invalida, tipo errado). */
export function toMemberTimestamp(value: Date | number | string | null | undefined): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/** "08/01/2026" no fuso de Sao Paulo. Valor invalido devolve "". */
export function formatMemberDate(value: Date | number | string | null | undefined) {
  const timestamp = toMemberTimestamp(value);
  return timestamp === null ? "" : dateFormatter.format(timestamp);
}

/** "14:30" no fuso de Sao Paulo. Valor invalido devolve "". */
export function formatMemberTime(value: Date | number | string | null | undefined) {
  const timestamp = toMemberTimestamp(value);
  return timestamp === null ? "" : timeFormatter.format(timestamp);
}

/** "08/01/2026 às 14:30" no fuso de Sao Paulo. Valor invalido devolve "". */
export function formatMemberDateTime(value: Date | number | string | null | undefined) {
  const timestamp = toMemberTimestamp(value);
  return timestamp === null ? "" : `${dateFormatter.format(timestamp)} às ${timeFormatter.format(timestamp)}`;
}

/** Dia civil em Sao Paulo ("2026-01-08"), para comparar "hoje" e "amanha" sem depender do fuso da maquina. */
export function getMemberDayKey(value: Date | number | string | null | undefined) {
  const timestamp = toMemberTimestamp(value);
  return timestamp === null ? "" : dayKeyFormatter.format(timestamp);
}

/** Diferenca em dias civis (Sao Paulo) entre dois instantes: 0 = mesmo dia, 1 = dia seguinte. */
export function getMemberDayDifference(from: Date | number | string, to: Date | number | string) {
  const fromKey = getMemberDayKey(from);
  const toKey = getMemberDayKey(to);

  if (!fromKey || !toKey) {
    return null;
  }

  const fromUtc = Date.UTC(Number(fromKey.slice(0, 4)), Number(fromKey.slice(5, 7)) - 1, Number(fromKey.slice(8, 10)));
  const toUtc = Date.UTC(Number(toKey.slice(0, 4)), Number(toKey.slice(5, 7)) - 1, Number(toKey.slice(8, 10)));

  return Math.round((toUtc - fromUtc) / 86_400_000);
}

/** "agora", "há 5 minutos", "ontem", "há 3 meses"... Valor invalido devolve "". */
export function formatMemberRelativeTime(value: Date | number | string | null | undefined, now: number = Date.now()) {
  const timestamp = toMemberTimestamp(value);

  if (timestamp === null) {
    return "";
  }

  const diffSeconds = Math.round((timestamp - now) / 1000);

  if (Math.abs(diffSeconds) < 45) {
    return "agora";
  }

  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) return relativeFormatter.format(diffMinutes, "minute");

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return relativeFormatter.format(diffHours, "hour");

  const diffDays = getMemberDayDifference(now, timestamp) ?? Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) return relativeFormatter.format(diffDays, "day");

  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) return relativeFormatter.format(diffMonths, "month");

  return relativeFormatter.format(Math.round(diffMonths / 12), "year");
}

/** Segundos em "1h 05min", "12min" ou "45s". Negativo/invalido devolve "". */
export function formatMemberDuration(totalSeconds: number | null | undefined) {
  if (typeof totalSeconds !== "number" || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "";
  }

  const seconds = Math.round(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}min`;
  }

  if (minutes > 0) {
    return `${minutes}min`;
  }

  return `${seconds}s`;
}

/** Tempo restante de um video: "faltam 12min". Sem duracao conhecida devolve "". */
export function formatMemberRemaining(progressSeconds: number, durationSeconds?: number | null) {
  if (!durationSeconds || durationSeconds <= 0) {
    return "";
  }

  const remaining = Math.max(durationSeconds - Math.max(progressSeconds, 0), 0);
  const label = formatMemberDuration(remaining < 60 ? 60 : remaining);

  return label ? `faltam ${label}` : "";
}

/** "1 aula", "3 aulas". O plural padrao acrescenta "s". */
export function formatMemberCount(count: number, singular: string, plural = `${singular}s`) {
  const safeCount = Number.isFinite(count) ? Math.max(Math.trunc(count), 0) : 0;
  return `${safeCount.toLocaleString("pt-BR")} ${safeCount === 1 ? singular : plural}`;
}

/** Percentual inteiro entre 0 e 100. */
export function clampMemberPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(Math.round(value), 0), 100);
}
