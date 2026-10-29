import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Schemas zod dos Webinarios (docs/30 §2.2, §5.1 e §5.2; docs/18 §2.2): o rascunho salva sem exigir nada, cada
// recusa cai no campo com a frase do produtor, publishProblems lista o que falta por tipo, e os corpos das rotas
// do aluno. Modulos puros carregados direto pelo Node.

const model = await import("../src/server/webinars/model.ts");
const schemas = await import("../src/server/webinars/schemas.ts");

const HOUR = 3_600_000;
const now = Date.parse("2026-10-28T15:00:00.000Z");
const iso = (time) => new Date(time).toISOString();
const UUID_A = "0b7f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b";
const UUID_B = "1c8f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b";
const UUID_C = "2d9f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b";

function liveDraft(extra = {}) {
  return { ...model.emptyWebinarDraft("live"), hostUserId: UUID_A, scheduledAt: iso(now + 48 * HOUR), title: "Como montar seu primeiro agente", ...extra };
}

function simulatedDraft(extra = {}) {
  return {
    ...model.emptyWebinarDraft("simulated"),
    recordingVideoUrl: "https://iframe.mediadelivery.net/embed/1/abc",
    sessions: [{ scheduledAt: iso(now + 24 * HOUR) }, { scheduledAt: iso(now + 48 * HOUR) }],
    title: "Aula gravada",
    ...extra
  };
}

/** O primeiro problema de um caminho ("sessions.1.scheduledAt"). */
function issueAt(result, path) {
  assert.equal(result.success, false, `esperava recusa em ${path}`);
  const issue = result.error.issues.find((item) => item.path.join(".") === path);
  assert.ok(issue, `nenhum problema em ${path}: ${result.error.issues.map((item) => item.path.join(".")).join(", ")}`);
  return issue.message;
}

test("rascunho vazio passa no schema: salvar nunca exige titulo, data nem apresentador", () => {
  for (const kind of model.WEBINAR_KINDS) {
    const parsed = schemas.webinarDraftSchema.safeParse(model.emptyWebinarDraft(kind));
    assert.equal(parsed.success, true, `${kind}: ${JSON.stringify(parsed.error?.issues)}`);
  }

  const live = schemas.webinarDraftSchema.safeParse(liveDraft());
  assert.equal(live.success, true);
  assert.equal(live.data.title, "Como montar seu primeiro agente");
  assert.equal(live.data.coverUrl, null, "capa vazia vira nulo");

  const trimmed = schemas.webinarDraftSchema.safeParse(liveDraft({ coverUrl: "  https://cdn.exemplo.com/capa.webp  ", description: "  texto  " }));
  assert.equal(trimmed.success, true);
  assert.equal(trimmed.data.coverUrl, "https://cdn.exemplo.com/capa.webp");
  assert.equal(trimmed.data.description, "texto");
});

test("cada recusa cai no campo, com a frase do produtor", () => {
  const parse = (draft) => schemas.webinarDraftSchema.safeParse(draft);
  const messages = schemas.WEBINAR_MESSAGES;

  assert.equal(issueAt(parse(liveDraft({ title: "a".repeat(121) })), "title"), messages.titleTooLong);
  assert.equal(issueAt(parse(liveDraft({ durationMinutes: 10 })), "durationMinutes"), messages.duration);
  assert.equal(issueAt(parse(liveDraft({ durationMinutes: 481 })), "durationMinutes"), messages.duration);
  assert.equal(issueAt(parse(liveDraft({ capacity: 0 })), "capacity"), messages.capacity);
  assert.equal(issueAt(parse(liveDraft({ capacity: 10, registrationRequired: false })), "capacity"), messages.capacityNeedsRegistration);
  assert.equal(issueAt(parse(liveDraft({ accessMode: "product" })), "productId"), messages.accessProduct);
  assert.equal(issueAt(parse(liveDraft({ accessMode: "either" })), "productId"), messages.accessProduct);
  assert.equal(issueAt(parse(liveDraft({ coverUrl: "http://cdn.exemplo.com/capa.webp" })), "coverUrl"), messages.coverUrl);
  assert.equal(issueAt(parse(simulatedDraft({ recordingVideoUrl: "http://iframe.mediadelivery.net/embed/1/abc" })), "recordingVideoUrl"), messages.recordingUrl);
  assert.equal(issueAt(parse(liveDraft({ replayDaysOnHome: 61 })), "replayDaysOnHome"), messages.replayDays);
  assert.equal(issueAt(parse(liveDraft({ reminderTexts: { ...model.emptyReminderTexts(), h24: "x".repeat(601) } })), "reminderTexts.h24"), messages.reminderText);
  assert.equal(issueAt(parse(liveDraft({ hostUserId: "nao-e-uuid" })), "hostUserId"), messages.hostRequired);

  const duplicated = parse(
    liveDraft({
      presenters: [
        { canModerateRoom: false, role: "co_host", userId: UUID_B },
        { canModerateRoom: true, role: "team", userId: UUID_B }
      ]
    })
  );
  assert.equal(issueAt(duplicated, "presenters.1.userId"), messages.duplicatePresenter);

  const coHosts = Array.from({ length: 6 }, (_, index) => ({ canModerateRoom: false, role: "co_host", userId: `${index}c8f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b` }));
  assert.equal(issueAt(parse(liveDraft({ presenters: coHosts })), "presenters"), messages.tooManyCoHosts);

  const sameTime = parse(simulatedDraft({ sessions: [{ scheduledAt: iso(now + HOUR) }, { scheduledAt: iso(now + HOUR) }] }));
  assert.equal(issueAt(sameTime, "sessions.1.scheduledAt"), messages.sessionsUnique);

  const tooMany = parse(simulatedDraft({ sessions: Array.from({ length: 61 }, (_, index) => ({ scheduledAt: iso(now + (index + 1) * HOUR) })) }));
  assert.equal(issueAt(tooMany, "sessions"), messages.sessionsTooMany);

  // Data incompleta ("" enquanto a pessoa preenche) e a frase de data e hora.
  assert.equal(issueAt(parse(liveDraft({ scheduledAt: "" })), "scheduledAt"), messages.dateTime);
  assert.equal(issueAt(parse(simulatedDraft({ sessions: [{ scheduledAt: "" }] })), "sessions.0.scheduledAt"), messages.dateTime);
});

test("publishProblems por tipo: o que falta para publicar, na mesma lista da tela e da Server Action", () => {
  const messages = schemas.WEBINAR_MESSAGES;
  const paths = (draft) => schemas.publishProblems(draft, now).map((problem) => [problem.path, problem.message]);

  assert.deepEqual(paths(model.emptyWebinarDraft("live")), [
    ["title", messages.title],
    ["scheduledAt", messages.dateTime],
    ["hostUserId", messages.hostRequired]
  ]);
  assert.deepEqual(paths(liveDraft({ scheduledAt: iso(now - HOUR) })), [["scheduledAt", messages.pastDate]]);
  assert.deepEqual(paths(liveDraft({ scheduledAt: iso(now) })), [["scheduledAt", messages.pastDate]], "a hora de agora ja passou");
  assert.deepEqual(paths(liveDraft()), []);
  assert.deepEqual(paths(liveDraft({ accessMode: "product" })), [["productId", messages.accessProduct]]);

  assert.deepEqual(paths(model.emptyWebinarDraft("simulated")), [
    ["title", messages.title],
    ["recordingVideoUrl", messages.recordingRequired],
    ["sessions", messages.sessionsRequired]
  ]);
  assert.deepEqual(paths(simulatedDraft({ sessions: [{ scheduledAt: iso(now - 2 * HOUR) }] })), [["sessions", messages.pastDate]], "todas no passado");
  assert.deepEqual(paths(simulatedDraft({ sessions: [{ scheduledAt: iso(now - 2 * HOUR) }, { scheduledAt: iso(now + HOUR) }] })), [], "basta uma no futuro");
  assert.deepEqual(paths(simulatedDraft()), []);
  // A Live gravada nao exige apresentador nem hora marcada propria.
  assert.deepEqual(paths(simulatedDraft({ hostUserId: null, scheduledAt: null })), []);
});

test("schemas das acoes e das rotas: id, versao, motivo, hora marcada e a origem do link", () => {
  assert.equal(schemas.saveWebinarSchema.safeParse({ draft: liveDraft() }).success, true, "sem id = criar");
  assert.equal(schemas.saveWebinarSchema.safeParse({ draft: liveDraft(), expectedUpdatedAt: "2026-10-28T15:00:00.000Z", id: UUID_A }).success, true);
  assert.equal(schemas.saveWebinarSchema.safeParse({ draft: liveDraft(), id: "abc" }).success, false);

  assert.equal(schemas.webinarIdSchema.safeParse({ id: UUID_A }).success, true);
  assert.equal(schemas.webinarIdSchema.safeParse({ id: "abc" }).success, false);
  assert.equal(schemas.webinarIdSchema.safeParse({ expectedUpdatedAt: "ontem", id: UUID_A }).success, false, "versao precisa ser ISO");

  const cancel = schemas.cancelWebinarSchema.safeParse({ id: UUID_A });
  assert.equal(cancel.success, true);
  assert.equal(cancel.data.reason, "", "motivo vazio por padrao");
  assert.equal(schemas.cancelWebinarSchema.safeParse({ id: UUID_A, reason: "x".repeat(501) }).success, false);
  assert.equal(schemas.cancelWebinarSchema.safeParse({ id: UUID_A, reason: "  Apresentador doente  " }).data.reason, "Apresentador doente");

  assert.equal(schemas.rescheduleSessionSchema.safeParse({ scheduledAt: iso(now + HOUR), sessionId: UUID_B, webinarId: UUID_A }).success, true);
  assert.equal(schemas.rescheduleSessionSchema.safeParse({ scheduledAt: "amanha", sessionId: UUID_B, webinarId: UUID_A }).success, false);
  assert.equal(schemas.rescheduleSessionSchema.safeParse({ scheduledAt: iso(now + HOUR), sessionId: UUID_B }).success, false, "webinarId obrigatorio");

  assert.equal(schemas.registerBodySchema.safeParse({}).success, true, "corpo vazio = vaga geral");
  assert.equal(schemas.registerBodySchema.safeParse({ sessionId: UUID_C, source: "insta_bio-1" }).success, true);
  assert.equal(schemas.registerBodySchema.safeParse({ source: "utm bad!" }).success, false);
  assert.equal(schemas.registerBodySchema.safeParse({ source: "a".repeat(81) }).success, false);
  assert.equal(schemas.unregisterBodySchema.safeParse({ sessionId: null }).success, true);
});

test("isHttpsUrlText: so https (ou o loopback de teste), sem usuario e senha no endereco", () => {
  assert.equal(schemas.isHttpsUrlText("https://iframe.mediadelivery.net/embed/1/abc"), true);
  assert.equal(schemas.isHttpsUrlText("http://iframe.mediadelivery.net/embed/1/abc"), false);
  assert.equal(schemas.isHttpsUrlText("https://user:senha@cdn.exemplo.com/x"), false);
  assert.equal(schemas.isHttpsUrlText("javascript:alert(1)"), false);
  assert.equal(schemas.isHttpsUrlText("nao e endereco"), false);
});
