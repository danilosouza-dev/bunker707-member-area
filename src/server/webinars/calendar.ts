// Calendario do Webinario (docs/30 §1.2, "Adicionar ao calendario"): o arquivo .ics que a nossa rota serve
// (GET /api/webinars/[id]/calendar?token=) e os links de "criar compromisso" do Google Agenda e do Outlook na
// web. O compromisso leva titulo, data e hora, duracao, o endereco da pagina do Webinario e "Entre pela area
// de membros"; o alarme de 15 min e o do aparelho do aluno. Modulo puro, sem imports e sem "server-only":
// tests/webinarios-calendario.test.mjs carrega direto pelo Node.

export const CALENDAR_DESCRIPTION = "Entre pela área de membros";
export const CALENDAR_ALARM_MINUTES = 15;
export const CALENDAR_TIME_ZONE = "America/Sao_Paulo";
export const CALENDAR_PRODUCT_ID = "-//Bunker707//Webinarios//PT";

/** RFC 5545: cada linha tem no maximo 75 octetos (sem o CRLF); o resto continua numa linha com espaco na frente. */
const ICS_LINE_OCTETS = 75;

export type CalendarEvent = {
  /** Texto extra abaixo de "Entre pela area de membros" (ex.: a descricao do webinario). */
  description?: string | null;
  durationMinutes: number;
  startsAt: string | number | Date;
  title: string;
  /** Endereco completo (https://...) da pagina do Webinario: vai como URL, LOCATION e no texto. */
  url: string;
};

export type IcsInput = CalendarEvent & {
  /** Hora de geracao (DTSTAMP). Padrao: agora. */
  now?: string | number | Date;
  organizer?: { email: string; name?: string | null } | null;
  /** Estavel por webinario e sessao: baixar de novo atualiza o mesmo compromisso. */
  uid: string;
};

function toMs(value: string | number | Date): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  return typeof value === "number" ? value : new Date(value).getTime();
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** "20261105T230000Z": data e hora em UTC, como o RFC pede para DTSTART/DTEND com Z. */
export function icsDateTime(value: string | number | Date): string {
  const ms = toMs(value);
  if (!Number.isFinite(ms)) {
    throw new Error("Data invalida para o calendario.");
  }
  const date = new Date(ms);
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/** Escapa o texto de SUMMARY/DESCRIPTION/LOCATION (RFC 5545 §3.3.11): barra, ponto e virgula, virgula e quebra de linha. */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

const encoder = new TextEncoder();

function octetsOf(text: string) {
  return encoder.encode(text).length;
}

/** Dobra uma linha em pedacos de ate 75 octetos (a continuacao comeca com um espaco), sem partir um caractere. */
export function foldIcsLine(line: string): string {
  const pieces: string[] = [];
  let current = "";
  let currentOctets = 0;

  for (const character of line) {
    const size = octetsOf(character);
    const limit = pieces.length === 0 ? ICS_LINE_OCTETS : ICS_LINE_OCTETS - 1;
    if (currentOctets + size > limit) {
      pieces.push(current);
      current = "";
      currentOctets = 0;
    }
    current += character;
    currentOctets += size;
  }
  pieces.push(current);

  return pieces.map((piece, index) => (index === 0 ? piece : ` ${piece}`)).join("\r\n");
}

function eventDescription(event: CalendarEvent) {
  const extra = event.description?.trim();
  return [CALENDAR_DESCRIPTION, event.url, extra].filter(Boolean).join("\n");
}

function eventEndMs(event: CalendarEvent) {
  const minutes = Number.isFinite(event.durationMinutes) && event.durationMinutes > 0 ? event.durationMinutes : 60;
  return toMs(event.startsAt) + minutes * 60_000;
}

/** O arquivo .ics completo (VCALENDAR com um VEVENT e o alarme de 15 min), com CRLF em toda linha. */
export function buildIcs(input: IcsInput): string {
  const start = icsDateTime(input.startsAt);
  const end = icsDateTime(eventEndMs(input));
  const stamp = icsDateTime(input.now ?? Date.now());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${CALENDAR_PRODUCT_ID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(input.uid)}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
    `DESCRIPTION:${escapeIcsText(eventDescription(input))}`,
    `LOCATION:${escapeIcsText(input.url)}`,
    `URL:${input.url}`
  ];

  if (input.organizer?.email) {
    const name = input.organizer.name?.trim();
    lines.push(`ORGANIZER${name ? `;CN=${escapeIcsText(name)}` : ""}:mailto:${input.organizer.email}`);
  }

  lines.push(
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText(input.title)}`,
    `TRIGGER:-PT${CALENDAR_ALARM_MINUTES}M`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  );

  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

/** Link "criar compromisso" do Google Agenda, ja preenchido (datas em UTC com o fuso de Sao Paulo informado). */
export function googleCalendarUrl(event: CalendarEvent): string {
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", event.title);
  url.searchParams.set("dates", `${icsDateTime(event.startsAt)}/${icsDateTime(eventEndMs(event))}`);
  url.searchParams.set("details", eventDescription(event));
  url.searchParams.set("location", event.url);
  url.searchParams.set("ctz", CALENDAR_TIME_ZONE);
  return url.toString();
}

/** Link equivalente do Outlook na web (compose com rru=addevent), com as horas em ISO 8601 UTC. */
export function outlookCalendarUrl(event: CalendarEvent): string {
  const url = new URL("https://outlook.live.com/calendar/0/deeplink/compose");
  url.searchParams.set("path", "/calendar/action/compose");
  url.searchParams.set("rru", "addevent");
  url.searchParams.set("subject", event.title);
  url.searchParams.set("startdt", new Date(toMs(event.startsAt)).toISOString());
  url.searchParams.set("enddt", new Date(eventEndMs(event)).toISOString());
  url.searchParams.set("body", eventDescription(event));
  url.searchParams.set("location", event.url);
  url.searchParams.set("allday", "false");
  return url.toString();
}

/** Nome do arquivo baixado: "<slug>.ics" (so letras, numeros e hifen). */
export function calendarFileName(slug: string): string {
  const safe = slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safe || "webinario"}.ics`;
}
