import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Adicionar ao calendario (docs/30 §1.2): o .ics servido pela nossa rota e os links do Google Agenda e do
// Outlook. Modulo puro (src/server/webinars/calendar.ts), sem servico de fora.

const calendar = await import("../src/server/webinars/calendar.ts");

const event = {
  description: "Traga suas dúvidas; a sessão é ao vivo, com chat.",
  durationMinutes: 90,
  startsAt: "2026-11-05T23:00:00.000Z",
  title: "Live de Teste: Boas-vindas",
  url: "https://escola.exemplo.com.br/webinarios/live-de-teste"
};
const now = "2026-10-29T12:00:00.000Z";
const unfold = (ics) => ics.replace(/\r\n /g, "");

test("ics: um VEVENT com CRLF em toda linha, DTSTART/DTEND em UTC, UID estavel e o alarme de 15 min", () => {
  const ics = calendar.buildIcs({ ...event, now, uid: "webinar-abc-123@bunker707" });
  const lines = ics.split("\r\n");

  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.equal(lines.at(-2), "END:VCALENDAR");
  assert.equal(lines.at(-1), "", "termina com CRLF");
  assert.equal(ics.replace(/\r\n/g, "").includes("\n"), false, "nenhuma quebra de linha solta");
  assert.equal(ics.replace(/\r\n/g, "").includes("\r"), false);

  for (const expected of [
    "VERSION:2.0",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:webinar-abc-123@bunker707",
    "DTSTAMP:20261029T120000Z",
    "DTSTART:20261105T230000Z",
    "DTEND:20261106T003000Z",
    "SUMMARY:Live de Teste: Boas-vindas",
    `URL:${event.url}`,
    `LOCATION:${event.url}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-PT15M",
    "END:VALARM",
    "END:VEVENT"
  ]) {
    assert.ok(lines.includes(expected), expected);
  }

  const unfolded = unfold(ics);
  assert.match(unfolded, /DESCRIPTION:Entre pela área de membros\\n/, "o texto fixo vem primeiro");
  assert.ok(unfolded.includes(`\\n${event.url}`), "o endereco da pagina vai no texto");
  assert.ok(unfolded.includes("Traga suas dúvidas\\; a sessão é ao vivo\\, com chat."), "ponto e virgula e virgula escapados");

  // UID estavel: baixar de novo atualiza o mesmo compromisso.
  assert.equal(ics, calendar.buildIcs({ ...event, now, uid: "webinar-abc-123@bunker707" }));
  assert.notEqual(ics, calendar.buildIcs({ ...event, now, uid: "webinar-abc-999@bunker707" }));
});

test("ics: nenhuma linha passa de 75 octetos e o titulo longo continua inteiro depois de desdobrar", () => {
  const long = { ...event, title: "Título com acento ".repeat(12).trim() };
  const ics = calendar.buildIcs({ ...long, now, uid: "u@bunker707" });

  for (const line of ics.split("\r\n")) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75, `linha longa demais: ${line}`);
  }

  assert.ok(unfold(ics).includes(`SUMMARY:${long.title}`));
  assert.ok(ics.includes("\r\n "), "a linha longa foi dobrada com espaco na continuacao");
});

test("ics: organizador opcional e duracao invalida vira 60 min", () => {
  const ics = calendar.buildIcs({ ...event, durationMinutes: 0, now, organizer: { email: "equipe@escola.exemplo.com.br", name: "Equipe; Escola" }, uid: "u@bunker707" });
  const lines = ics.split("\r\n");

  assert.ok(lines.includes("ORGANIZER;CN=Equipe\\; Escola:mailto:equipe@escola.exemplo.com.br"));
  assert.ok(lines.includes("DTEND:20261106T000000Z"));
  assert.ok(!calendar.buildIcs({ ...event, now, uid: "u@bunker707" }).includes("ORGANIZER"));
});

test("dobra e escape seguem o RFC 5545 sem partir um caractere acentuado", () => {
  assert.equal(calendar.foldIcsLine("abc"), "abc");
  assert.equal(calendar.foldIcsLine("a".repeat(80)), `${"a".repeat(75)}\r\n ${"a".repeat(5)}`);

  // "á" ocupa 2 octetos: 37 cabem na primeira linha (74), o resto vai para a continuacao.
  const parts = calendar.foldIcsLine("á".repeat(40)).split("\r\n");
  assert.equal(parts[0], "á".repeat(37));
  assert.equal(parts[1], ` ${"á".repeat(3)}`);

  assert.equal(calendar.escapeIcsText("a;b,c\\d\ne\r\nf"), "a\\;b\\,c\\\\d\\ne\\nf");
  assert.equal(calendar.icsDateTime(Date.parse("2026-01-08T02:30:00.000Z")), "20260108T023000Z");
  assert.throws(() => calendar.icsDateTime("nao e data"));
});

test("Google Agenda e Outlook: links de criar compromisso ja preenchidos, com as horas em UTC", () => {
  const google = new URL(calendar.googleCalendarUrl(event));
  assert.equal(google.hostname, "calendar.google.com");
  assert.equal(google.searchParams.get("action"), "TEMPLATE");
  assert.equal(google.searchParams.get("text"), event.title);
  assert.equal(google.searchParams.get("dates"), "20261105T230000Z/20261106T003000Z");
  assert.equal(google.searchParams.get("ctz"), "America/Sao_Paulo");
  assert.equal(google.searchParams.get("location"), event.url);
  assert.match(google.searchParams.get("details"), /^Entre pela área de membros\n/);

  const outlook = new URL(calendar.outlookCalendarUrl(event));
  assert.equal(outlook.hostname, "outlook.live.com");
  assert.equal(outlook.searchParams.get("rru"), "addevent");
  assert.equal(outlook.searchParams.get("subject"), event.title);
  assert.equal(outlook.searchParams.get("startdt"), "2026-11-05T23:00:00.000Z");
  assert.equal(outlook.searchParams.get("enddt"), "2026-11-06T00:30:00.000Z");
  assert.equal(outlook.searchParams.get("location"), event.url);
  assert.match(outlook.searchParams.get("body"), /^Entre pela área de membros\n/);
});

test("nome do arquivo baixado vem do slug", () => {
  assert.equal(calendar.calendarFileName("live-de-teste"), "live-de-teste.ics");
  assert.equal(calendar.calendarFileName("Live Nova!"), "live-nova.ics");
  assert.equal(calendar.calendarFileName("!!!"), "webinario.ics");
});
