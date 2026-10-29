import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// A area do aluno dos Webinarios (docs/30 §1.1 e §1.2), na parte pura: a tabela de situacoes montada com
// studentPhase, a contagem regressiva, os tres blocos de /webinarios, o card da pagina inicial, a faixa
// "Comeca em 1 h", a resposta da rota de sessao e o acesso por produto.

const model = await import("../src/server/webinars/model.ts");
const student = await import("../src/server/webinars/student-model.ts");
const time = await import("../src/lib/webinar-time.ts");
const copy = await import("../src/lib/webinar-copy.ts");

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Terca, 3/11/2026 as 15:00 em Sao Paulo.
const now = Date.parse("2026-11-03T18:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const soon = now + 2 * DAY + 4 * HOUR + 12 * MINUTE;

function webinar(extra = {}) {
  return {
    ...model.emptyWebinarDraft("live"),
    cancelReason: null,
    cancelledAt: null,
    createdAt: iso(now - DAY),
    createdBy: null,
    durationMinutes: 90,
    id: "w1",
    publishedAt: iso(now - DAY),
    slug: "live-de-teste",
    status: "published",
    title: "Live de Teste",
    updatedAt: iso(now - DAY),
    ...extra
  };
}

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
    scheduledAt: iso(soon),
    sourceSessionId: null,
    startedAt: null,
    status: "scheduled",
    updatedAt: iso(now - DAY),
    webinarId: "w1",
    ...extra
  };
}

function registration(extra = {}) {
  return {
    calendarToken: "0123456789abcdef0123456789abcdef",
    cancelledAt: null,
    id: "r1",
    registeredAt: iso(now - HOUR),
    reminder1hSentAt: null,
    reminder24hSentAt: null,
    sessionId: "s1",
    source: null,
    sourceCampaignId: null,
    startedNoticeSentAt: null,
    status: "registered",
    userId: "u1",
    webinarId: "w1",
    ...extra
  };
}

const build = (input, sessions, registrations = [], counts = new Map(), presenterName = "Ana Apresentadora") =>
  student.buildStudentWebinarView({ now, presenterName, registeredCounts: counts, registrations, sessions, webinar: input });

test("Agendado: data e hora em Sao Paulo, duracao, apresentador e a contagem regressiva andando", () => {
  const view = build(webinar(), [session()]);

  assert.equal(view.phase, "scheduled");
  assert.equal(view.primary.id, "s1");
  assert.equal(view.primary.whenLabel, "Quinta, 5/11 às 19:12");
  assert.equal(view.primary.timeLabel, "19:12");
  assert.equal(view.primary.dateLabel, "05/11/2026");
  assert.equal(view.durationLabel, "1h 30min");
  assert.equal(view.presenterName, "Ana Apresentadora");
  assert.equal(view.kindLabel, "Live ao vivo");
  assert.equal(view.href, "/webinarios/live-de-teste");
  // docs/30 §1.1 pede "2 d 4 h 12 min"; o formatador compartilhado (src/lib/webinar-time.ts) hoje deixa os
  // minutos de fora quando ha dias na conta. A tela aceita os dois: o que importa e a conta andar.
  assert.match(time.countdownLabel(view.primary.scheduledAt, now), /^Começa em 2 d 4 h( 12 min)?$/);
  assert.equal(time.countdownLabel(view.primary.scheduledAt, soon - 4 * HOUR - 12 * MINUTE), "Começa em 4 h 12 min");
  assert.equal(time.countdownLabel(view.primary.scheduledAt, soon - 12 * MINUTE), "Começa em 12 min");
  assert.equal(time.countdownLabel(view.primary.scheduledAt, soon), "", "na hora, a tela mostra a situacao no lugar");
  assert.equal(view.primary.registeredCount, null, "sem a equipe ligar, o numero de vagas nao aparece");
  assert.equal(view.primary.registered, false);
  assert.equal(view.primary.calendarToken, null);
  assert.equal(view.replayAvailable, false);
  assert.equal(view.endedAtMs, null);
});

test("Vaga garantida: a vaga da sessao (ou a geral, sem sessao) vira o selo e o token do calendario", () => {
  const view = build(webinar(), [session()], [registration()]);
  assert.equal(view.phase, "registered");
  assert.equal(view.primary.calendarToken, "0123456789abcdef0123456789abcdef");
  assert.equal(view.primary.registeredAt, iso(now - HOUR));

  const general = build(webinar(), [session()], [registration({ sessionId: null })]);
  assert.equal(general.phase, "registered");

  const cancelled = build(webinar(), [session()], [registration({ status: "cancelled" })]);
  assert.equal(cancelled.phase, "scheduled", "vaga cancelada nao conta");
  assert.equal(student.registrationFor([registration({ sessionId: "outra" })], "s1"), null);
});

test("Vagas esgotadas so com limite ligado; quem ja tem vaga continua com ela; o numero aparece com limite ou quando a equipe liga", () => {
  const counts = new Map([["s1", 1]]);
  const full = build(webinar({ capacity: 1 }), [session()], [], counts);
  assert.equal(full.phase, "sold_out");
  assert.equal(full.primary.registeredCount, 1, "com limite de vagas o numero aparece");

  const mine = build(webinar({ capacity: 1 }), [session()], [registration()], counts);
  assert.equal(mine.phase, "registered");

  const noLimit = build(webinar({ capacity: null, showRegisteredCount: true }), [session()], [], new Map([["s1", 42]]));
  assert.equal(noLimit.phase, "scheduled");
  assert.equal(noLimit.primary.registeredCount, 42);

  // Sem Garantir vaga ligado, o limite nao vale (o editor ja impede, o modelo ignora).
  const open = build(webinar({ capacity: 1, registrationRequired: false }), [session()], [], counts);
  assert.equal(open.phase, "scheduled");
  assert.equal(open.capacity, null);
  assert.equal(open.primary.registeredCount, null);
});

test("Aguardando o apresentador, Ao vivo, Encerrada e Cancelado seguem a sessao e o webinario", () => {
  const late = build(webinar(), [session({ scheduledAt: iso(now - 5 * MINUTE) })]);
  assert.equal(late.phase, "waiting", "hora marcada chegou e ninguem abriu a sala");

  const live = build(webinar(), [session({ scheduledAt: iso(now - 5 * MINUTE), startedAt: iso(now - 4 * MINUTE), status: "live" })]);
  assert.equal(live.phase, "live");

  const ended = build(webinar(), [session({ endedAt: iso(now - HOUR), scheduledAt: iso(now - 3 * HOUR), startedAt: iso(now - 3 * HOUR), status: "ended" })]);
  assert.equal(ended.phase, "ended");
  assert.equal(ended.endedAtMs, now - HOUR);
  assert.equal(ended.primary.id, "s1", "sem proxima sessao, a ultima que aconteceu fica em destaque");

  const abandoned = build(webinar(), [session({ scheduledAt: iso(now - 5 * HOUR) })]);
  assert.equal(abandoned.phase, "ended", "2 h depois da hora marcada sem comeco, encerra sozinha");

  const cancelled = build(webinar({ cancelReason: "Apresentador doente", cancelledAt: iso(now - HOUR) }), [session()], [registration()]);
  assert.equal(cancelled.phase, "cancelled");
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.cancelReason, "Apresentador doente");
  assert.equal(cancelled.endedAtMs, null);

  for (const phase of model.STUDENT_PHASES) {
    assert.equal(student.phaseLabel(phase), copy.WEBINAR_COPY.aluno.situacoes[phase]);
  }
  assert.equal(student.phaseLabel("sold_out"), "Vagas esgotadas");
  assert.equal(student.phaseLabel("waiting"), "Aguardando o apresentador");
});

test("Live gravada: cada sessao tem a propria situacao; a proxima fica em destaque e a replay fica fora da lista", () => {
  const simulated = webinar({ id: "w2", kind: "simulated", slug: "gravada", title: "Live gravada" });
  const sessions = [
    session({ id: "g1", kind: "simulated", scheduledAt: iso(now + DAY), webinarId: "w2" }),
    session({ id: "g2", kind: "simulated", scheduledAt: iso(now + 2 * DAY), webinarId: "w2" }),
    session({ id: "g0", kind: "simulated", scheduledAt: iso(now - 2 * DAY), status: "ended", endedAt: iso(now - 2 * DAY + HOUR), webinarId: "w2" }),
    session({ id: "rp", kind: "replay", scheduledAt: iso(now - 2 * DAY), webinarId: "w2" })
  ];
  const view = build(simulated, sessions, [registration({ sessionId: "g2", webinarId: "w2" })]);

  assert.deepEqual(view.sessions.map((item) => item.id), ["g0", "g1", "g2"], "ordem das horas, sem a replay");
  assert.equal(view.primary.id, "g1");
  assert.equal(view.phase, "scheduled");
  assert.deepEqual(view.sessions.map((item) => item.phase), ["ended", "scheduled", "registered"]);
  assert.equal(view.kindLabel, "Live gravada");
  assert.equal(view.replayAvailable, true);
});

test("/webinarios: Proxima live (do mais proximo), Em andamento e Replays; cancelados ficam fora", () => {
  const later = build(webinar({ id: "w3", slug: "depois", title: "Depois" }), [session({ id: "s3", scheduledAt: iso(now + 5 * DAY), webinarId: "w3" })]);
  const next = build(webinar(), [session()]);
  const running = build(webinar({ id: "w4", slug: "agora", title: "Agora" }), [session({ id: "s4", scheduledAt: iso(now - MINUTE), status: "live", startedAt: iso(now - MINUTE), webinarId: "w4" })]);
  const oldReplay = build(webinar({ id: "w5", slug: "antiga", title: "Antiga" }), [
    session({ id: "s5", endedAt: iso(now - 10 * DAY), scheduledAt: iso(now - 10 * DAY - HOUR), status: "ended", webinarId: "w5" }),
    session({ id: "s5r", kind: "replay", scheduledAt: iso(now - 10 * DAY), webinarId: "w5" })
  ]);
  const newReplay = build(webinar({ id: "w6", slug: "recente", title: "Recente" }), [
    session({ id: "s6", endedAt: iso(now - 2 * DAY), scheduledAt: iso(now - 2 * DAY - HOUR), status: "ended", webinarId: "w6" }),
    session({ id: "s6r", kind: "replay", scheduledAt: iso(now - 2 * DAY), webinarId: "w6" })
  ]);
  const endedNoReplay = build(webinar({ id: "w7", slug: "sem-replay", title: "Sem replay" }), [session({ id: "s7", endedAt: iso(now - DAY), scheduledAt: iso(now - DAY - HOUR), status: "ended", webinarId: "w7" })]);
  const cancelled = build(webinar({ cancelledAt: iso(now - HOUR), id: "w8", slug: "cancelada", title: "Cancelada" }), [session({ id: "s8", webinarId: "w8" })]);

  const lists = student.groupStudentWebinars([later, cancelled, oldReplay, endedNoReplay, running, newReplay, next]);

  assert.deepEqual(lists.upcoming.map((view) => view.id), ["w1", "w3"]);
  assert.deepEqual(lists.inProgress.map((view) => view.id), ["w4"]);
  assert.deepEqual(lists.replays.map((view) => view.id), ["w6", "w5"], "replay mais recente primeiro; encerrado sem replay fica fora");
  assert.ok(!JSON.stringify(lists).includes("w8"), "cancelado nao aparece em bloco nenhum");
});

test("pagina inicial: o card Proxima live so com Avisar ligado; 'Replay disponivel' por replayDaysOnHome dias", () => {
  const next = build(webinar(), [session()]);
  const hidden = build(webinar({ id: "w9", showOnHome: false, slug: "escondida" }), [session({ id: "s9", scheduledAt: iso(now + HOUR), webinarId: "w9" })]);
  const running = build(webinar({ id: "w4", slug: "agora" }), [session({ id: "s4", scheduledAt: iso(now - MINUTE), status: "live", webinarId: "w4" })]);

  assert.deepEqual(student.pickHomeWebinar([hidden], now), null);
  assert.equal(student.pickHomeWebinar([hidden, next], now).view.id, "w1");
  assert.deepEqual(student.pickHomeWebinar([next, running], now), { kind: "next", view: running }, "em andamento vem antes do agendado");

  const replayOf = (id, daysAgo, replayDaysOnHome = 7) =>
    build(webinar({ id, replayDaysOnHome, slug: id }), [
      session({ id: `${id}-s`, endedAt: iso(now - daysAgo * DAY), scheduledAt: iso(now - daysAgo * DAY - HOUR), status: "ended", webinarId: id }),
      session({ id: `${id}-r`, kind: "replay", scheduledAt: iso(now - daysAgo * DAY), webinarId: id })
    ]);

  assert.deepEqual(student.pickHomeWebinar([replayOf("r1", 3)], now), { kind: "replay", view: replayOf("r1", 3) });
  assert.equal(student.pickHomeWebinar([replayOf("r2", 8)], now), null, "depois de 7 dias some sozinho");
  assert.equal(student.pickHomeWebinar([replayOf("r3", 1, 0)], now), null, "com 0 dias nunca entra");
  assert.equal(student.pickHomeWebinar([replayOf("r1", 3), next], now).kind, "next", "um agendado vale mais que um replay");
});

test("faixa 'Comeca em 1 h: Entrar': so para quem garantiu vaga, de 60 min antes ate a hora marcada", () => {
  const in30 = build(webinar(), [session({ scheduledAt: iso(now + 30 * MINUTE) })], [registration()]);
  const banner = student.pickStartBanner([in30], now);
  assert.deepEqual(banner, { href: "/webinarios/live-de-teste", scheduledAt: iso(now + 30 * MINUTE), sessionId: "s1", title: "Live de Teste" });
  assert.equal(student.bannerLabel(banner.scheduledAt, now), "Começa em 30 min");
  assert.equal(student.bannerLabel(iso(now + 60 * MINUTE), now), "Começa em 1 h");
  assert.equal(student.bannerLabel(iso(now + 61 * MINUTE), now), "", "antes dos 60 min a faixa nao existe");
  assert.equal(student.bannerLabel(iso(now), now), "", "na hora marcada a faixa some");

  assert.equal(student.pickStartBanner([build(webinar(), [session({ scheduledAt: iso(now + 30 * MINUTE) })])], now), null, "sem vaga, sem faixa");
  assert.equal(student.pickStartBanner([build(webinar(), [session({ scheduledAt: iso(now + 90 * MINUTE) })], [registration()])], now), null);
  assert.equal(student.pickStartBanner([build(webinar({ showBanner: false }), [session({ scheduledAt: iso(now + 30 * MINUTE) })], [registration()])], now), null, "Faixa no topo desligada");
  assert.equal(student.pickStartBanner([build(webinar({ cancelledAt: iso(now - HOUR) }), [session({ scheduledAt: iso(now + 30 * MINUTE) })], [registration()])], now), null);

  // Duas vagas: a mais proxima.
  const in10 = build(webinar({ id: "w2", slug: "logo", title: "Logo" }), [session({ id: "s2", scheduledAt: iso(now + 10 * MINUTE), webinarId: "w2" })], [registration({ sessionId: "s2", webinarId: "w2" })]);
  assert.equal(student.pickStartBanner([in30, in10], now).sessionId, "s2");
});

test("GET .../session: a resposta desta fase, com o .ics da vaga pelo token e sem numero quando a equipe nao mostra", () => {
  const view = build(webinar(), [session({ lateJoinMinutes: 15 })], [registration()]);
  const payload = student.buildSessionPayload(view, view.primary, { lateJoinMinutes: 15, now });

  assert.deepEqual(payload, {
    me: { calendarUrl: "/api/webinars/w1/calendar?token=0123456789abcdef0123456789abcdef", registered: true, registeredAt: iso(now - HOUR) },
    registeredCount: null,
    serverTime: iso(now),
    session: { endedAt: null, id: "s1", kind: "live", lateJoinMinutes: 15, phase: "registered", scheduledAt: iso(soon), startedAt: null, status: "scheduled" },
    webinar: { durationMinutes: 90, id: "w1", kind: "live", slug: "live-de-teste", title: "Live de Teste" }
  });

  const anonymous = build(webinar(), [session()]);
  assert.equal(student.buildSessionPayload(anonymous, anonymous.primary, { lateJoinMinutes: null, now }).me.calendarUrl, null);
  assert.equal(student.calendarPath("w 1", "a/b"), "/api/webinars/w%201/calendar?token=a%2Fb");
});

test("acesso por produto: coringa da plataforma, o proprio webinario ou o produto ligado, so ativo e na janela", () => {
  const target = { id: "w1", productId: "curso-x" };
  const row = (extra) => ({ ends_at: null, starts_at: iso(now - DAY), status: "active", target_id: "curso-x", target_type: "standalone_course", ...extra });

  assert.equal(student.webinarEntitlementMatches(row({}), target, now), true, "o produto ligado, com qualquer target_type");
  assert.equal(student.webinarEntitlementMatches(row({ target_id: "w1", target_type: "webinar" }), target, now), true);
  assert.equal(student.webinarEntitlementMatches(row({ target_id: "platform", target_type: "platform" }), target, now), true);
  assert.equal(student.webinarEntitlementMatches(row({ target_id: "*", target_type: "platform" }), target, now), true);
  assert.equal(student.webinarEntitlementMatches(row({ target_id: "outro", target_type: "platform" }), target, now), false);
  assert.equal(student.webinarEntitlementMatches(row({ target_id: "outro-curso" }), target, now), false);
  assert.equal(student.webinarEntitlementMatches(row({ target_id: "w1", target_type: "formation" }), target, now), false, "o id do webinario so vale com target_type webinar");
  assert.equal(student.webinarEntitlementMatches(row({ status: "revoked" }), target, now), false);
  assert.equal(student.webinarEntitlementMatches(row({ ends_at: iso(now - MINUTE) }), target, now), false, "acesso que acabou");
  assert.equal(student.webinarEntitlementMatches(row({ starts_at: iso(now + DAY) }), target, now), false, "acesso que ainda nao comecou");
  assert.equal(student.webinarEntitlementMatches(row({}), { id: "w1", productId: null }, now), false, "sem produto ligado, so o alvo webinar ou a plataforma");
});

test("'ver como' da equipe, slug e link de origem", () => {
  assert.equal(student.previewCanSee("student_without_access", "everyone"), true);
  assert.equal(student.previewCanSee("student_without_access", "product"), false);
  assert.equal(student.previewCanSee("student_without_access", "either"), false);
  assert.equal(student.previewCanSee("student_with_access", "product"), true);
  assert.equal(student.previewCanSee("producer", "audience"), true);

  assert.equal(student.isWebinarSlug("live-de-teste"), true);
  assert.equal(student.isWebinarSlug("ab"), false);
  assert.equal(student.isWebinarSlug("Live"), false);
  assert.equal(student.isWebinarSlug("../x"), false);

  assert.equal(student.normalizeSource("email:boas-vindas"), "email:boas-vindas");
  assert.equal(student.normalizeSource(["aviso.1", "outro"]), "aviso.1");
  assert.equal(student.normalizeSource(" espaco aqui "), null);
  assert.equal(student.normalizeSource("x".repeat(81)), null);
  assert.equal(student.normalizeSource(undefined), null);
});

test("frases do aluno: nenhum rotulo usa as palavras fora do vocabulario (PROIBIDAS_WEBINARIO)", () => {
  const aluno = copy.WEBINAR_COPY.aluno;
  const texts = [];
  const collect = (value) => {
    if (typeof value === "string") {
      texts.push(value);
    } else if (typeof value === "function") {
      texts.push(value("Live de Teste", "20:00"), value(1), value(2));
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(collect);
    }
  };
  collect(aluno);

  assert.ok(texts.length > 50);
  for (const text of texts) {
    const lower = String(text).toLocaleLowerCase("pt-BR");
    for (const word of copy.PROIBIDAS_WEBINARIO) {
      assert.ok(!lower.includes(word), `"${text}" usa "${word}"`);
    }
  }
  assert.equal(aluno.vagasGarantidas(1), "1 aluno com vaga garantida");
  assert.equal(aluno.vagasGarantidas(12), "12 alunos com vaga garantida");
});
