import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Modelo puro dos Webinarios (docs/30 §1.2, §2.3 e §2.7; docs/18 §2.2): a situacao da lista, a fase do aluno,
// Garantir vaga, a regra dos lembretes 24 h e 1 h (inclusive o caso dos 50 min e o do mesmo dia), o slug e as
// contas de tempo. Relogio falso por parametro (`now`).

const model = await import("../src/server/webinars/model.ts");
const time = await import("../src/lib/webinar-time.ts");

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// 28/10/2026 12:00 em Sao Paulo (15:00 UTC).
const now = Date.parse("2026-10-28T15:00:00.000Z");
const iso = (value) => new Date(value).toISOString();

function session(extra = {}) {
  return {
    chatMode: "open",
    chatSlowModeSeconds: null,
    createdAt: iso(now - DAY),
    endedAt: null,
    id: "s1",
    kind: "live",
    lateJoinMinutes: null,
    recordingAnchorAt: null,
    recordingId: null,
    scheduledAt: iso(now + DAY),
    sourceSessionId: null,
    startedAt: null,
    status: "scheduled",
    updatedAt: iso(now - DAY),
    webinarId: "w1",
    ...extra
  };
}

const published = { cancelledAt: null, durationMinutes: 60, status: "published" };

test("situacao da lista (§2.3): rascunho, agendado, em andamento, encerrado e cancelado", () => {
  assert.equal(model.webinarSituation({ ...published, status: "draft" }, [], now), "draft");
  assert.equal(model.webinarSituation({ ...published, cancelledAt: iso(now) }, [session()], now), "cancelled", "cancelado vale acima de tudo");
  assert.equal(model.webinarSituation({ ...published, status: "archived" }, [], now), "ended");
  assert.equal(model.webinarSituation(published, [], now), "scheduled", "publicado sem sessao ainda: agendado");
  assert.equal(model.webinarSituation(published, [session()], now), "scheduled");
  assert.equal(model.webinarSituation(published, [session({ status: "waiting" })], now), "in_progress");
  assert.equal(model.webinarSituation(published, [session({ status: "live" })], now), "in_progress");
  assert.equal(model.webinarSituation(published, [session({ endedAt: iso(now - HOUR), status: "ended" })], now), "ended");
  // Hora marcada ha 4 h sem ninguem comecar: 60 min + 2 h de folga ja passaram -> encerrado.
  assert.equal(model.webinarSituation(published, [session({ scheduledAt: iso(now - 4 * HOUR) })], now), "ended");
  assert.equal(model.webinarSituation(published, [session({ scheduledAt: iso(now - 2 * HOUR) })], now), "scheduled", "ainda dentro da folga");
  // Uma sessao encerrada e outra marcada: agendado; o replay e as canceladas nao contam.
  assert.equal(model.webinarSituation(published, [session({ endedAt: iso(now - DAY), status: "ended" }), session({ id: "s2", scheduledAt: iso(now + 2 * DAY) })], now), "scheduled");
  assert.equal(model.webinarSituation(published, [session({ kind: "replay", status: "live" }), session({ id: "s2", status: "cancelled" })], now), "scheduled");
});

test("fase do aluno (§1.2) e Garantir vaga: marcada, vaga garantida, esgotado, aguardando, ao vivo, encerrada, cancelada", () => {
  const base = { capacity: null, cancelled: false, durationMinutes: 60, now, registered: false, registeredCount: 0, registrationRequired: true, session: session() };

  assert.equal(model.studentPhase(base), "scheduled");
  assert.equal(model.studentPhase({ ...base, registered: true }), "registered");
  assert.equal(model.studentPhase({ ...base, capacity: 2, registeredCount: 2 }), "sold_out");
  assert.equal(model.studentPhase({ ...base, capacity: 2, registeredCount: 2, registrationRequired: false }), "scheduled", "sem Garantir vaga nao ha esgotado");
  assert.equal(model.studentPhase({ ...base, session: session({ scheduledAt: iso(now - 5 * MINUTE) }) }), "waiting", "hora chegou e ninguem abriu a sala");
  assert.equal(model.studentPhase({ ...base, session: session({ status: "waiting" }) }), "waiting");
  assert.equal(model.studentPhase({ ...base, session: session({ status: "live" }) }), "live");
  assert.equal(model.studentPhase({ ...base, session: session({ status: "ended" }) }), "ended");
  assert.equal(model.studentPhase({ ...base, session: session({ scheduledAt: iso(now - 4 * HOUR) }) }), "ended", "passou da folga de 2 h");
  assert.equal(model.studentPhase({ ...base, session: null }), "ended");
  assert.equal(model.studentPhase({ ...base, cancelled: true }), "cancelled");
  assert.equal(model.studentPhase({ ...base, session: session({ status: "cancelled" }) }), "cancelled");

  const register = (extra = {}) => model.canRegister({ capacity: null, durationMinutes: 60, now, registeredCount: 0, session: session(), ...extra });
  assert.deepEqual(register(), { ok: true });
  assert.deepEqual(register({ session: session({ status: "cancelled" }) }), { ok: false, reason: "cancelled" });
  assert.deepEqual(register({ session: session({ status: "ended" }) }), { ok: false, reason: "ended" });
  assert.deepEqual(register({ session: session({ scheduledAt: iso(now - 61 * MINUTE) }) }), { ok: false, reason: "ended" }, "depois do fim previsto");
  assert.deepEqual(register({ session: session({ scheduledAt: iso(now - 10 * MINUTE) }) }), { ok: true }, "quem chega atrasado ainda garante");
  assert.deepEqual(register({ capacity: 3, registeredCount: 3 }), { ok: false, reason: "sold_out" });
});

test("lembretes (§2.7): 24 h e 1 h uma vez cada; o de 1 h nao sai com o de 24 h atrasado e mais de 50 min; mesmo dia e 'Hoje'", () => {
  const all = { email: true, h1: true, h24: true };
  const decide = (minutesLeft, extra = {}) => model.reminderDecision({ now, reminders: all, scheduledAt: iso(now + minutesLeft * MINUTE), sent1h: false, sent24h: false, ...extra });

  assert.equal(decide(30 * 60), null, "mais de 24 h: nada ainda");
  assert.deepEqual(decide(23 * 60), { markAlso: null, send: "24h", variant: "tomorrow" }, "faltam 23 h, amanha em Sao Paulo");
  assert.deepEqual(decide(8 * 60), { markAlso: null, send: "24h", variant: "today" }, "hoje 20:00 de Sao Paulo");
  assert.equal(decide(23 * 60, { sent24h: true }), null, "o de 24 h ja saiu e falta mais de 1 h");
  assert.deepEqual(decide(55, { sent24h: true }), { markAlso: null, send: "1h", variant: "one_hour" });
  // O tick atrasou e os dois estao pendentes: com mais de 50 min sai so o de 24 h ("Hoje às…"); com 50 min ou
  // menos sai so o de 1 h e o de 24 h e dado como feito.
  assert.deepEqual(decide(55), { markAlso: null, send: "24h", variant: "today" });
  assert.deepEqual(decide(50), { markAlso: "24h", send: "1h", variant: "one_hour" });
  assert.deepEqual(decide(10), { markAlso: "24h", send: "1h", variant: "one_hour" });
  assert.deepEqual(decide(10, { sent1h: true }), { markAlso: null, send: "24h", variant: "today" }, "so o de 24 h pendente");
  assert.equal(decide(10, { sent1h: true, sent24h: true }), null, "os dois ja sairam");
  assert.equal(decide(-5), null, "ja passou");
  assert.equal(decide(30, { reminders: { ...all, h1: false, h24: false } }), null, "lembretes desligados");
  assert.deepEqual(decide(30, { reminders: { ...all, h1: false } }), { markAlso: null, send: "24h", variant: "today" }, "so o de 24 h ligado");
  assert.deepEqual(decide(30, { reminders: { ...all, h24: false } }), { markAlso: null, send: "1h", variant: "one_hour" }, "so o de 1 h ligado");

  assert.equal(model.bannerWindow(iso(now + 30 * MINUTE), now), "soon");
  assert.equal(model.bannerWindow(iso(now + 90 * MINUTE), now), "none");
  assert.equal(model.bannerWindow(iso(now - MINUTE), now), "none");
});

test("proxima sessao: a primeira que ainda vai acontecer, sem replay, canceladas nem encerradas", () => {
  const sessions = [
    session({ id: "ended", endedAt: iso(now - DAY), scheduledAt: iso(now - 2 * DAY), status: "ended" }),
    session({ id: "later", scheduledAt: iso(now + 3 * DAY) }),
    session({ id: "cancelled", scheduledAt: iso(now + HOUR), status: "cancelled" }),
    session({ id: "replay", kind: "replay", scheduledAt: iso(now - DAY) }),
    session({ id: "next", scheduledAt: iso(now + DAY) })
  ];

  assert.equal(model.nextSession(sessions, 60, now)?.id, "next");
  assert.equal(model.nextSession(sessions, 60, now + 2 * DAY)?.id, "later");
  assert.equal(model.nextSession(sessions, 60, now + 10 * DAY), null);
  assert.equal(model.nextSession([session({ scheduledAt: iso(now - 2 * HOUR) })], 60, now)?.id, "s1", "dentro da folga ainda e a proxima");
  assert.equal(model.replaySession(sessions)?.id, "replay");
});

test("slug e endereco: do titulo, sem acento, curto ganha '-live', repetido ganha sufixo, cabe no check do banco", () => {
  assert.equal(model.webinarSlug("Como montar seu primeiro agente"), "como-montar-seu-primeiro-agente");
  assert.equal(model.webinarSlug("Sessão de Perguntas & Respostas!"), "sessao-de-perguntas-respostas");
  assert.equal(model.webinarSlug("Como montar seu primeiro agente", 2), "como-montar-seu-primeiro-agente-2");
  assert.equal(model.webinarSlug("Como montar seu primeiro agente", 1), "como-montar-seu-primeiro-agente", "sufixo 1 e o proprio");
  assert.equal(model.webinarSlug(""), "webinario");
  assert.equal(model.webinarSlug("IA"), "ia-live");
  assert.equal(model.webinarSlug("!!!"), "webinario");

  const long = model.webinarSlug("a".repeat(100), 12);
  assert.ok(long.length <= model.WEBINAR_LIMITS.slugMax, long);
  assert.match(long, /^[a-z0-9][a-z0-9-]{2,63}$/);
  assert.equal(model.webinarHref("ia-live"), "/webinarios/ia-live");
});

test("contagem regressiva e datas em Sao Paulo: '2 d 4 h 12 min', '1 h 5 min', '12 min', 'menos de 1 min'", () => {
  assert.equal(time.formatCountdown(now + 2 * DAY + 4 * HOUR + 12 * MINUTE, now), "2 d 4 h 12 min");
  assert.equal(time.formatCountdown(now + HOUR + 5 * MINUTE, now), "1 h 5 min");
  assert.equal(time.formatCountdown(now + 12 * MINUTE, now), "12 min");
  assert.equal(time.formatCountdown(now + 30_000, now), "menos de 1 min");
  assert.equal(time.formatCountdown(now - MINUTE, now), "");
  assert.equal(time.countdownLabel(iso(now + 12 * MINUTE), now), "Começa em 12 min");
  assert.equal(time.countdownLabel(iso(now - MINUTE), now), "");

  // 05/11/2026 20:00 em Sao Paulo (23:00 UTC) e uma quinta-feira.
  assert.equal(time.formatWebinarWhen("2026-11-05T23:00:00.000Z"), "Quinta, 5/11 às 20:00");
  assert.equal(time.saoPauloTime("2026-11-05T23:00:00.000Z"), "20:00");
  assert.equal(time.saoPauloTime("2026-11-06T02:30:00.000Z"), "23:30");
  assert.equal(time.saoPauloDate("2026-11-06T02:30:00.000Z"), "05/11/2026", "ainda dia 5 em Sao Paulo");
  assert.equal(time.saoPauloDayKey("2026-11-06T02:30:00.000Z"), "2026-11-05");
  assert.equal(time.formatWebinarWhen(null), "");
  assert.equal(time.formatWebinarWhen("nao e data"), "");
  assert.equal(time.localTimeHint("2026-11-05T23:00:00.000Z", "America/Sao_Paulo"), "");
  assert.equal(time.localTimeHint("2026-11-05T23:00:00.000Z", "Europe/Lisbon"), "(no seu horário: 23:00)");
});

test("registro do historico (§4.7): so ids e codigos, com a origem cortada em 80", () => {
  assert.deepEqual(model.registrationEventMetadata({ sessionId: "s1", source: "x".repeat(100), webinarId: "w1" }), {
    campaign_id: null,
    session_id: "s1",
    source: "x".repeat(80),
    webinar_id: "w1"
  });
  assert.deepEqual(model.registrationEventMetadata({ campaignId: "c1", sessionId: null, webinarId: "w1" }), { campaign_id: "c1", session_id: null, source: null, webinar_id: "w1" });
  assert.equal(model.REMINDER_RULES.h1OnlyBelowMinutes, 50);
  assert.equal(model.REMINDER_RULES.autoEndMinutesAfter, 120);
});
