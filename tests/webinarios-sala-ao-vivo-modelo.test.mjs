import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// A sala ao vivo, a parte pura da fase 3 (docs/30 §5.3, §5.4 e §8.1): o papel pelo admin (nunca pelo navegador),
// o nome da sala, o token HS256 com validade curta e as claims combinadas, e a assinatura do webhook do gravador.

const token = await import("../src/server/webinars/jitsi-token.ts");
const recorder = await import("../src/server/webinars/recorder-signature.ts");

const WEBINAR = "bbbbbbbb-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-11-05T22:55:00.000Z");
const ENDS = Date.parse("2026-11-06T00:00:00.000Z");
const SECRET = "s".repeat(48);
const presenters = [
  { canModerateRoom: false, role: "co_host", userId: "co" },
  { canModerateRoom: true, role: "team", userId: "mod" },
  { canModerateRoom: false, role: "team", userId: "team" }
];

test("o papel vem do admin: host, co-apresentador (modera), Equipe (modera so se marcada), aluno; validade do convite", () => {
  const base = { hostUserId: "host", nowMs: NOW, presenters, staff: false };
  assert.deepEqual(token.roomRoleFor({ ...base, userId: "host" }), { features: { recording: true, screenSharing: true }, moderator: true, role: "host" });
  assert.deepEqual(token.roomRoleFor({ ...base, userId: "co" }), { features: { recording: false, screenSharing: true }, moderator: true, role: "co_host" });
  assert.deepEqual(token.roomRoleFor({ ...base, userId: "mod" }), { features: { recording: false, screenSharing: false }, moderator: true, role: "team" });
  assert.deepEqual(token.roomRoleFor({ ...base, userId: "team" }), { features: { recording: false, screenSharing: false }, moderator: false, role: "team" });
  assert.deepEqual(token.roomRoleFor({ ...base, staff: true, userId: "someone" }), { features: { recording: false, screenSharing: false }, moderator: false, role: "team" }, "messaging.write sem marca: Equipe sem moderar");
  assert.deepEqual(token.roomRoleFor({ ...base, userId: "aluna" }), { features: { recording: false, screenSharing: false }, moderator: false, role: "student" });
  const expired = new Map([["co", "2026-11-01T00:00:00.000Z"]]);
  assert.equal(token.roomRoleFor({ ...base, userId: "co", validUntilByUser: expired }).role, "student", "convite vencido vira aluno");
  assert.equal(token.roomRoleFor({ ...base, hostUserId: null, userId: "host" }).role, "student");
});

test("o nome da sala: w-<webinario>-<16 letras>, nunca adivinhavel, reconhecido pela conferencia", () => {
  const name = token.newRoomName(WEBINAR);
  assert.match(name, /^w-bbbbbbbb-0000-4000-8000-000000000001-[a-z2-9]{16}$/);
  assert.ok(token.isRoomName(name));
  assert.notEqual(token.newRoomName(WEBINAR), name);
  assert.ok(!token.isRoomName("*"));
  assert.ok(!token.isRoomName(`w-${WEBINAR}-ABC`));
  const fixed = token.newRoomName(WEBINAR, () => Buffer.alloc(16, 7));
  assert.equal(fixed, `w-${WEBINAR}-${"h".repeat(16)}`, "aleatorio injetavel para teste");
});

test("o token: HS256, iss = aud = app, sub = o hostname, room da sessao, nbf 60 s antes, exp = fim + 30 min (ou 6 h), moderador so por papel", () => {
  const room = token.newRoomName(WEBINAR, () => Buffer.alloc(16, 1));
  const host = token.signJitsiToken({
    appId: "bunker707",
    domain: "meet.bunker707.com.br",
    endsAtMs: ENDS,
    grant: token.roomRoleFor({ hostUserId: "host", nowMs: NOW, presenters, staff: false, userId: "host" }),
    nowMs: NOW,
    room,
    secret: SECRET,
    user: { avatarUrl: "https://cdn.example/a.png", id: "host", name: "Danilo S." }
  });
  assert.equal(host.split(".").length, 3);
  const claims = token.verifyJitsiToken(host, SECRET);
  assert.ok(claims);
  assert.equal(claims.iss, "bunker707");
  assert.equal(claims.aud, "bunker707");
  assert.equal(claims.sub, "meet.bunker707.com.br");
  assert.equal(claims.room, room);
  assert.equal(claims.nbf, Math.floor(NOW / 1000) - 60);
  assert.equal(claims.exp, Math.floor(ENDS / 1000) + 30 * 60, "fim previsto + 30 min");
  assert.deepEqual(claims.context.user, { avatar: "https://cdn.example/a.png", id: "host", moderator: true, affiliation: "owner", name: "Danilo S." });
  assert.deepEqual(claims.context.features, { livestreaming: false, "outbound-call": false, recording: true, "screen-sharing": true });
  assert.equal(token.verifyJitsiToken(host, "x".repeat(48)), null, "outro segredo nao confere");
  assert.equal(token.verifyJitsiToken(`${host}x`, SECRET), null);

  const student = token.verifyJitsiToken(
    token.signJitsiToken({
      appId: "bunker707",
      domain: "meet.bunker707.com.br",
      endsAtMs: NOW + 10 * 60 * 60 * 1000,
      grant: token.roomRoleFor({ hostUserId: "host", nowMs: NOW, presenters, staff: false, userId: "aluna" }),
      nowMs: NOW,
      room,
      secret: SECRET,
      user: { id: "aluna", name: "Ana M." }
    }),
    SECRET
  );
  assert.deepEqual(student.context, { user: { id: "aluna", name: "Ana M." } }, "aluno sem moderator e sem features");
  assert.equal(student.exp, Math.floor(NOW / 1000) + 6 * 60 * 60, "no maximo 6 h");
  assert.throws(() => token.signJitsiToken({ appId: "b", domain: "d", endsAtMs: ENDS, grant: { features: { recording: false, screenSharing: false }, moderator: false, role: "student" }, nowMs: NOW, room: "*", secret: SECRET, user: { id: "u", name: "n" } }), /Sala inválida/);
  assert.throws(() => token.signJitsiToken({ appId: "b", domain: "d", endsAtMs: ENDS, grant: { features: { recording: false, screenSharing: false }, moderator: false, role: "student" }, nowMs: NOW, room, secret: "curto", user: { id: "u", name: "n" } }), /Segredo/);
});

test("a assinatura do gravador: HMAC do timestamp.corpo, tolerancia de 5 min, tempo constante, cabecalhos prontos", () => {
  const secret = "r".repeat(40);
  const body = JSON.stringify({ sessionId: "s1", state: "uploaded" });
  const headers = recorder.recorderHeaders(secret, body, NOW);
  assert.equal(headers["x-bunker-timestamp"], String(Math.floor(NOW / 1000)));
  assert.match(headers["x-bunker-signature"], /^[0-9a-f]{64}$/);
  const verify = (overrides = {}) =>
    recorder.verifyRecorderSignature({ body, now: NOW, secret, signature: headers["x-bunker-signature"], timestamp: headers["x-bunker-timestamp"], ...overrides });
  assert.deepEqual(verify(), { ok: true });
  assert.deepEqual(verify({ now: NOW + 6 * 60 * 1000 }), { ok: false, reason: "stale_timestamp" });
  assert.deepEqual(verify({ now: NOW + 4 * 60 * 1000 }), { ok: true });
  assert.deepEqual(verify({ body: `${body} ` }), { ok: false, reason: "bad_signature" });
  assert.deepEqual(verify({ signature: "zz" }), { ok: false, reason: "bad_signature" });
  assert.deepEqual(verify({ signature: null }), { ok: false, reason: "missing_headers" });
  assert.deepEqual(verify({ timestamp: "ontem" }), { ok: false, reason: "bad_timestamp" });
  assert.deepEqual(verify({ secret: "curto" }), { ok: false, reason: "bad_secret" });
  assert.ok(!recorder.isRecorderSecretConfigured("tem espaco ".repeat(4)));
  assert.throws(() => recorder.signRecorderPayload("curto", 1, body), /Segredo/);
});

const live = await import("../src/server/webinars/live-schemas.ts");
const rec = await import("../src/server/webinars/recorder-model.ts");

test("os schemas da sala ao vivo: join-token, sinais do iframe em lote de 20 com nomes fixos, o webhook do gravador, banir e alinhar", () => {
  const sid = "bbbbbbbb-0000-4000-8000-000000000002";
  assert.ok(live.joinTokenBodySchema.safeParse({ sessionId: sid }).success);
  assert.ok(!live.joinTokenBodySchema.safeParse({ sessionId: "x" }).success);
  const batch = { events: [{ at: "2026-11-05T23:00:00.000Z", data: { muted: true, id: "p1" }, name: "audioMuteStatusChanged" }], sessionId: sid };
  assert.ok(live.roomEventsBodySchema.safeParse(batch).success);
  assert.ok(!live.roomEventsBodySchema.safeParse({ ...batch, events: [{ ...batch.events[0], name: "incomingMessage" }] }).success, "texto do chat nunca vem por aqui");
  assert.ok(!live.roomEventsBodySchema.safeParse({ ...batch, events: Array.from({ length: 21 }, () => batch.events[0]) }).success);
  assert.ok(live.recorderWebhookBodySchema.safeParse({ sessionId: sid, state: "ready" }).success);
  assert.ok(live.recorderWebhookBodySchema.safeParse({ bunnyLibraryId: "1", bunnyVideoId: "v", durationSeconds: 7200, fileName: "w_2026-11-05-23-00-05.mp4", sessionId: sid, sha256: "a".repeat(64), sizeBytes: 10, startedAt: "2026-11-05-23-00-05", state: "uploaded" }).success);
  assert.ok(!live.recorderWebhookBodySchema.safeParse({ sessionId: sid, state: "ready", sha256: "zz" }).success);
  assert.ok(live.banStudentSchema.safeParse({ kind: "muted", minutes: 15, sessionId: sid, userId: sid }).success);
  assert.ok(!live.banStudentSchema.safeParse({ kind: "kicked", minutes: 15, sessionId: sid, userId: sid }).success, "remover nao tem prazo");
  assert.ok(!live.banStudentSchema.safeParse({ kind: "muted", minutes: 7, sessionId: sid, userId: sid }).success);
  assert.ok(live.attachRecordingSchema.safeParse({ embedUrl: "https://iframe.mediadelivery.net/embed/1/abc", sessionId: sid }).success);
  assert.ok(!live.attachRecordingSchema.safeParse({ sessionId: sid }).success);
  assert.ok(live.alignChatSchema.safeParse({ anchorOffsetMs: -2500, recordingId: sid }).success);
  assert.ok(!live.alignChatSchema.safeParse({ anchorOffsetMs: 3_600_001, recordingId: sid }).success);
});

test("o gravador: a maquina de estados, o carimbo do arquivo, a diferenca para a ancora e o que grava na gravacao", () => {
  assert.equal(rec.recorderTransition("none", "ready"), "ready");
  assert.equal(rec.recorderTransition("ready", "recording"), "recording");
  assert.equal(rec.recorderTransition("recording", "uploaded"), "uploaded");
  assert.equal(rec.recorderTransition("recording", "upload_failed"), "upload_failed");
  assert.equal(rec.recorderTransition("uploaded", "gone"), "gone");
  assert.equal(rec.recorderTransition("gone", "gone"), null, "repeticao e ignorada");
  assert.equal(rec.recorderTransition("uploaded", "ready"), null, "fora de ordem e ignorado");
  assert.equal(rec.recorderTransition("none", "unavailable"), "unavailable");
  assert.equal(rec.recorderTransition("unavailable", "ready"), "ready", "a segunda tentativa de maquina");
  assert.ok(rec.recorderMachineAlive("recording"));
  assert.ok(!rec.recorderMachineAlive("gone"));
  assert.ok(!rec.recorderMachineAlive("none"));
  assert.equal(rec.parseJibriStartedAt("w-abc_2026-11-05-23-00-05.mp4"), "2026-11-05T23:00:05.000Z");
  assert.equal(rec.parseJibriStartedAt("2026-11-05-23-00-05"), "2026-11-05T23:00:05.000Z");
  assert.equal(rec.parseJibriStartedAt("2026-11-05T23:00:05.000Z"), "2026-11-05T23:00:05.000Z");
  assert.equal(rec.parseJibriStartedAt("ontem"), null);
  assert.equal(rec.anchorDriftMs("2026-11-05T23:00:00.000Z", "2026-11-05T23:00:05.000Z"), 5000, "o Jibri entrou 5 s depois do clique");
  assert.equal(rec.anchorDriftMs(null, "2026-11-05T23:00:05.000Z"), null);
  assert.deepEqual(rec.recordingPatchFor({ bunnyLibraryId: "1", bunnyVideoId: "v", durationSeconds: 7200, fileName: "f.mp4", sha256: "A".repeat(64), sizeBytes: 9, state: "uploaded" }), {
    bunny_library_id: "1",
    bunny_video_id: "v",
    duration_seconds: 7200,
    error_message: null,
    file_name: "f.mp4",
    sha256: "a".repeat(64),
    size_bytes: 9,
    status: "processing"
  });
  assert.deepEqual(rec.recordingPatchFor({ fileName: "f.mp4", state: "upload_failed" }), { error_message: "Envio para a Bunny falhou.", file_name: "f.mp4", status: "failed" });
  assert.equal(rec.recordingPatchFor({ state: "ready" }), null);
  assert.equal(rec.RECORDER_LABELS.recording, "Gravando");
});
