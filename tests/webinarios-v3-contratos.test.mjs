import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Os contratos da fase 3 que mais de uma frente usa (docs/30 §5.1, §5.4, §6.3, §6.5, §6.7, §8.1 e D26), sem banco:
// o ambiente do token, o estado do aluno pelos banimentos, quem recebe token e quando, o relogio da presenca na live,
// o que um sinal do iframe vira em student_events (so codigos), o configOverwrite por papel, o gravador (botao Gravar,
// aviso de 6 h, estimativa do preparo) e o pedido ao workflow do GitHub (e o duble).

const live = await import("../src/server/webinars/live-model.ts");
const embed = await import("../src/lib/jitsi-room-config.ts");
const rec = await import("../src/server/webinars/recorder-model.ts");
const dispatch = await import("../src/server/webinars/recorder-dispatch.ts");
const rows = await import("../src/server/webinars/rows.ts");
const schemas = await import("../src/server/webinars/live-schemas.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const NOW = Date.parse("2026-11-05T23:00:00.000Z");
const SESSION = "bbbbbbbb-0000-4000-8000-000000000002";
const SECRET = "s".repeat(48);
const iso = (ms) => new Date(ms).toISOString();

test("o ambiente do token: hostname proprio (nunca meet.jit.si), segredo de 32+, app id padrao bunker707; faltando, em breve", () => {
  assert.deepEqual(live.liveTokenEnv({ WEBINAR_JWT_SECRET: SECRET, WEBINAR_MEET_DOMAIN: "https://Meet.Bunker707.com.br/" }), {
    appId: "bunker707",
    domain: "meet.bunker707.com.br",
    secret: SECRET
  });
  assert.equal(live.liveTokenEnv({ WEBINAR_JWT_SECRET: SECRET }), null, "sem hostname");
  assert.equal(live.liveTokenEnv({ WEBINAR_JWT_SECRET: "curto", WEBINAR_MEET_DOMAIN: "meet.exemplo.com" }), null, "segredo curto");
  assert.equal(live.liveTokenEnv({ WEBINAR_JWT_SECRET: SECRET, WEBINAR_MEET_DOMAIN: "meet.jit.si" }), null, "nunca o servidor publico");
  assert.equal(live.liveTokenEnv({ WEBINAR_JWT_APP_ID: "outra app", WEBINAR_JWT_SECRET: SECRET, WEBINAR_MEET_DOMAIN: "meet.exemplo.com" }), null);
  assert.equal(live.liveRoomConfigured({}), false);
  assert.equal(embed.meetDomainOf("8x8.vc"), null);
  assert.equal(embed.meetDomainOf("localhost"), null);
  assert.equal(embed.externalApiUrl("meet.exemplo.com"), "https://meet.exemplo.com/external_api.js");
  assert.equal(embed.meetPermissionsAllowList("meet.exemplo.com"), '(self "https://meet.exemplo.com")');
  assert.equal(embed.meetPermissionsAllowList(null), "()");
});

test("banimentos: removido, banido e silenciado (prazo e ate o fim); o que cada um recusa", () => {
  const vazio = live.liveBanState({ nowMs: NOW, sessionBans: [], userBan: null });
  assert.deepEqual(vazio, live.NO_BAN);
  const silenciado = live.liveBanState({ nowMs: NOW, sessionBans: [{ kind: "muted", until_at: iso(NOW + 5 * 60_000) }], userBan: null });
  assert.deepEqual(silenciado, { banned: false, kicked: false, muted: true, mutedUntil: iso(NOW + 5 * 60_000) });
  const vencido = live.liveBanState({ nowMs: NOW, sessionBans: [{ kind: "muted", until_at: iso(NOW - 1) }], userBan: null });
  assert.equal(vencido.muted, false, "o silencio vencido sai pela hora");
  const ateOFim = live.liveBanState({ nowMs: NOW, sessionBans: [{ kind: "muted", until_at: null }], userBan: null });
  assert.deepEqual(ateOFim, { banned: false, kicked: false, muted: true, mutedUntil: null });
  const removido = live.liveBanState({ nowMs: NOW, sessionBans: [{ kind: "kicked", until_at: null }], userBan: null });
  assert.equal(removido.kicked, true);
  assert.equal(live.liveBanState({ nowMs: NOW, sessionBans: [], userBan: { user_id: "u" } }).banned, true);

  assert.equal(live.liveWriteRefusal(silenciado, "chat"), "muted");
  assert.equal(live.liveWriteRefusal(silenciado, "interaction"), null, "silenciado ainda reage e vota");
  assert.equal(live.liveWriteRefusal(removido, "interaction"), "banned");
  assert.equal(live.liveWriteRefusal(vazio, "chat"), null);
  assert.equal(live.muteUntilIso(15, NOW), iso(NOW + 15 * 60_000));
  assert.equal(live.muteUntilIso(null, NOW), null);
  assert.deepEqual([...live.MUTE_MINUTES_OPTIONS], [...schemas.MUTE_MINUTES]);
});

test("quem recebe token: so a sessao live; a equipe tambem na sessao de pratica; o aluno so na espera ou no ar e nunca removido ou banido", () => {
  const ban = live.NO_BAN;
  const sessao = (status, kind = "live") => ({ kind, status });
  assert.equal(live.liveJoinRefusal({ ban, role: "student", session: sessao("live", "simulated") }), "not_live");
  assert.equal(live.liveJoinRefusal({ ban, role: "host", session: sessao("scheduled") }), null, "Sessao de pratica");
  assert.equal(live.liveJoinRefusal({ ban, role: "team", session: sessao("scheduled") }), null);
  assert.equal(live.liveJoinRefusal({ ban, role: "student", session: sessao("scheduled") }), "not_started");
  assert.equal(live.liveJoinRefusal({ ban, role: "student", session: sessao("waiting") }), null);
  assert.equal(live.liveJoinRefusal({ ban, role: "student", session: sessao("live") }), null);
  assert.equal(live.liveJoinRefusal({ ban, role: "co_host", session: sessao("ended") }), "ended");
  assert.equal(live.liveJoinRefusal({ ban, role: "student", session: sessao("cancelled") }), "ended");
  assert.equal(live.liveJoinRefusal({ ban: { ...ban, kicked: true }, role: "student", session: sessao("live") }), "kicked");
  assert.equal(live.liveJoinRefusal({ ban: { ...ban, banned: true }, role: "student", session: sessao("live") }), "banned");
  assert.equal(live.liveJoinRefusal({ ban: { ...ban, banned: true }, role: "host", session: sessao("live") }), null, "a equipe nunca e barrada");

  const marcada = "2026-11-05T23:00:00.000Z";
  assert.equal(live.liveSessionEndsAtMs({ scheduledAt: marcada, startedAt: null }, 60), NOW + 60 * 60_000);
  assert.equal(live.liveSessionEndsAtMs({ scheduledAt: marcada, startedAt: iso(NOW + 10 * 60_000) }, 60), NOW + 70 * 60_000, "comecou atrasada");
});

test("o relogio da presenca na live conta desde o inicio, nunca pela ancora; o chat usa a ancora", () => {
  const sessao = { kind: "live", recordingAnchorAt: iso(NOW + 5 * 60_000), scheduledAt: iso(NOW - 60_000), startedAt: iso(NOW) };
  assert.equal(live.presenceOffsetMs(sessao, NOW + 10 * 60_000), 10 * 60_000);
  // A sala de espera depois da hora marcada (host abriu as 19:55, comecou as 20:10): o balde fica negativo, nunca os
  // baldes 0, 1, 2... que o inicio vai usar (webinar_close_session soma so `bucket >= 0`).
  assert.equal(live.presenceOffsetMs({ ...sessao, startedAt: null }, NOW), -1000, "na espera depois da hora marcada: balde -1");
  assert.equal(live.presenceOffsetMs({ ...sessao, startedAt: null }, NOW + 9 * 60_000), -1000, "esperando 10 min depois da hora: continua -1");
  assert.equal(live.presenceOffsetMs({ ...sessao, scheduledAt: iso(NOW + 5 * 60_000), startedAt: null }, NOW), -5 * 60_000, "antes da hora marcada: a contagem regressiva");
  assert.ok(Math.floor(live.presenceOffsetMs({ ...sessao, startedAt: null }, NOW + 9 * 60_000) / 30_000) < 0);
  const gravada = { kind: "simulated", recordingAnchorAt: null, scheduledAt: iso(NOW), startedAt: iso(NOW) };
  assert.equal(live.presenceOffsetMs(gravada, NOW + 1000), 1000);
});

test("sinais do iframe: o lote do navegador so com codigos e o que cada um vira em student_events", () => {
  const at = iso(NOW);
  assert.deepEqual(embed.toRoomEvent("videoConferenceJoined", { displayName: "Ana S.", id: "a1b2c3d4", roomName: "w-x" }, { nowIso: at, ownId: null }), {
    at,
    data: { participantId: "a1b2c3d4" },
    name: "videoConferenceJoined"
  });
  assert.equal(embed.toRoomEvent("raiseHandUpdated", { handRaised: 123, id: "outro" }, { nowIso: at, ownId: "a1b2c3d4" }), null, "a mao dos outros nao vai");
  assert.deepEqual(embed.toRoomEvent("raiseHandUpdated", { handRaised: 123, id: "a1b2c3d4" }, { nowIso: at, ownId: "a1b2c3d4" }).data, { raised: true });
  assert.deepEqual(embed.toRoomEvent("videoMuteStatusChanged", { muted: false }, { extra: { consented: true }, nowIso: at, ownId: "x" }).data, { consented: true, muted: false });
  const erro = embed.toRoomEvent("errorOccurred", { error: { isFatal: true, message: "texto livre do erro", name: "conference.connectionError.notAllowed" } }, { nowIso: at, ownId: null });
  assert.deepEqual(erro.data, { code: "conference.connectionError.notAllowed", fatal: true });
  assert.ok(!JSON.stringify(erro).includes("texto livre"), "nunca o texto");
  assert.equal(embed.toRoomEvent("incomingMessage", { message: "oi" }, { nowIso: at, ownId: null }), null);

  // Tudo o que o navegador manda passa no schema do lote (docs/30 §5.1).
  const lote = ["videoConferenceJoined", "videoConferenceLeft", "audioMuteStatusChanged", "recordingStatusChanged"].map((name) => embed.toRoomEvent(name, { id: "a1", muted: true, on: true }, { nowIso: at, ownId: "a1" }));
  assert.ok(schemas.roomEventsBodySchema.safeParse({ events: lote, sessionId: SESSION }).success);

  assert.deepEqual(live.roomEventRecord({ at, data: { participantId: "a1b2" }, name: "videoConferenceJoined" }, -1000), {
    eventType: "webinar_room_joined",
    metadata: { at, offset_ms: -1000, participant_id: "a1b2" }
  });
  assert.deepEqual(live.roomEventRecord({ at, data: { consented: true, muted: false }, name: "videoMuteStatusChanged" }, 5000).metadata, { at, consented: true, offset_ms: 5000, on: true });
  assert.deepEqual(live.roomEventRecord({ at, data: { muted: true }, name: "audioMuteStatusChanged" }, 0), { eventType: "webinar_mic_toggled", metadata: { at, offset_ms: 0, on: false } });
  assert.equal(live.roomEventRecord({ at, data: { on: true }, name: "recordingStatusChanged" }, 0), null, "a ancora vem da acao do apresentador");
  assert.equal(live.roomEventRecord({ at, data: {}, name: "raiseHandUpdated" }, 0), null, "sem o campo combinado: descartado");
  assert.equal(live.roomEventRecord({ at, data: { code: "nao vale espaco" }, name: "errorOccurred" }, 0).metadata.code, "unknown");
  assert.deepEqual(Object.keys(live.ROOM_EVENT_TYPES).sort(), [...schemas.ROOM_EVENT_NAMES].sort());
});

test("configOverwrite por papel (D26): aluno sem chat/enquete/reacao do Jitsi, mudo, 360p, camera so com a permissao; host com o palco e a tela", () => {
  const settings = { allowStudentCamera: true, screenFps: 30, stage: 1080 };
  const aluno = embed.liveConfigOverwrite("student", settings);
  assert.equal(aluno.disableChat, true);
  assert.equal(aluno.disablePolls, true);
  assert.equal(aluno.disableReactions, true);
  assert.equal(aluno.startWithAudioMuted, true);
  assert.equal(aluno.startWithVideoMuted, true);
  assert.equal(aluno.startSilent, undefined, "startSilent cortaria o som que o aluno recebe");
  assert.equal(aluno.readOnlyName, true);
  assert.deepEqual(aluno.constraints, { video: { height: { ideal: 360, max: 360, min: 180 } } });
  assert.deepEqual(aluno.toolbarButtons, [], "a barra do aluno e a nossa: a camera passa pelo aviso de gravacao (D4)");
  assert.equal(aluno.disableShortcuts, true, "nem pelo atalho do teclado");
  assert.equal(aluno.remoteVideoMenu.disabled, true);
  assert.equal(aluno.disableRemoteMute, true);
  assert.deepEqual(embed.liveConfigOverwrite("team", settings).toolbarButtons, []);
  assert.equal(embed.liveConfigOverwrite("host", settings).disableShortcuts, false);
  // O microfone so existe quando o apresentador libera (§1.3, §8.5): aluno e Equipe sem a captura inicial do Jitsi (o
  // pedido de permissao sai so no Falar ou no aviso da camera); host e co-apresentador precisam dele ao entrar.
  assert.equal(aluno.disableInitialGUM, true, "o aluno nao recebe o pedido do microfone ao entrar");
  assert.equal(embed.liveConfigOverwrite("team", settings).disableInitialGUM, true);
  assert.equal(embed.liveConfigOverwrite("host", settings).disableInitialGUM, undefined);
  assert.equal(embed.liveConfigOverwrite("co_host", settings).disableInitialGUM, undefined);
  // Com a sala trancada ou a Sala de espera ligada, o aluno bate sozinho (sem achar o botao do iframe).
  assert.deepEqual(aluno.lobby, { autoKnock: true });
  assert.equal(embed.liveConfigOverwrite("host", settings).lobby, undefined);

  const host = embed.liveConfigOverwrite("host", settings);
  assert.deepEqual(host.constraints.video.height, { ideal: 1080, max: 1080, min: 180 });
  assert.deepEqual(host.desktopSharingFrameRate, { max: 30, min: 5 });
  // A engrenagem (so a aba de aparelhos) e o fundo na barra de quem apresenta, que fica sempre visivel (as setinhas de
  // microfone e camera nao somem); o aluno continua sem barra nenhuma.
  assert.deepEqual(host.toolbarButtons, ["microphone", "camera", "desktop", "raisehand", "participants-pane", "recording", "security", "select-background", "settings", "hangup"]);
  assert.deepEqual(host.toolbarConfig, { alwaysVisible: true });
  assert.equal(aluno.toolbarConfig, undefined);
  const coHost = embed.liveConfigOverwrite("co_host", settings);
  assert.deepEqual(coHost.toolbarButtons, ["microphone", "camera", "desktop", "raisehand", "participants-pane", "security", "select-background", "settings", "hangup"], "o co-apresentador: o mesmo do host sem gravar");
  assert.deepEqual(coHost.toolbarConfig, { alwaysVisible: true });
  assert.equal(embed.liveConfigOverwrite("team", settings).toolbarConfig, undefined, "a Equipe segue o aluno: sem a barra do iframe");
  for (const role of ["student", "team"]) {
    const semBarra = embed.liveConfigOverwrite(role, settings);
    assert.ok(!semBarra.toolbarButtons.includes("settings") && !semBarra.toolbarButtons.includes("select-background"), `${role}: sem engrenagem nem fundo do iframe`);
    assert.equal(embed.liveInterfaceConfigOverwrite(role).SETTINGS_SECTIONS, undefined, `${role}: sem engrenagem`);
  }
  assert.ok(!embed.liveConfigOverwrite("co_host", settings).toolbarButtons.includes("recording"), "so o host grava");
  assert.equal(embed.liveConfigOverwrite("co_host", { ...settings, screenFps: 15, stage: 720 }).desktopSharingFrameRate.max, 15);
  assert.equal(embed.liveConfigOverwrite("team", settings).constraints.video.height.max, 360);
  assert.equal(embed.liveConfigOverwrite("host", settings).disableChat, true, "o chat e sempre o nosso (D5)");
  assert.ok(!JSON.stringify(embed.liveInterfaceConfigOverwrite()).toLowerCase().includes("jitsi"));
  assert.ok(!JSON.stringify(embed.liveInterfaceConfigOverwrite("host")).toLowerCase().includes("jitsi"));
  assert.equal(embed.liveInterfaceConfigOverwrite().SETTINGS_SECTIONS, undefined, "sem o papel, sem engrenagem");
  assert.deepEqual(embed.liveInterfaceConfigOverwrite("host").SETTINGS_SECTIONS, ["devices"], "a engrenagem do host so com os aparelhos");
  assert.deepEqual(embed.liveInterfaceConfigOverwrite("co_host").SETTINGS_SECTIONS, ["devices"]);
  // O visual da V2 (docs/31 §3) entra para todos os papeis; so a engrenagem muda por papel.
  assert.deepEqual(
    Object.keys(embed.liveInterfaceConfigOverwrite("host")).sort(),
    [
      "CONNECTION_INDICATOR_DISABLED",
      "DEFAULT_BACKGROUND",
      "DISABLE_JOIN_LEAVE_NOTIFICATIONS",
      "FILM_STRIP_MAX_HEIGHT",
      "LOCAL_THUMBNAIL_RATIO",
      "REMOTE_THUMBNAIL_RATIO",
      "SETTINGS_SECTIONS",
      "SHOW_CHROME_EXTENSION_BANNER",
      "VERTICAL_FILMSTRIP",
      "VIDEO_LAYOUT_FIT"
    ],
    "o resto do interfaceConfig igual para todos"
  );
  const semPapel = { ...embed.liveInterfaceConfigOverwrite("host") };
  delete semPapel.SETTINGS_SECTIONS;
  assert.deepEqual(embed.liveInterfaceConfigOverwrite("student"), semPapel, "o aluno recebe o mesmo visual, sem a engrenagem");
  assert.equal(embed.JITSI_IFRAME_ALLOW, "camera; microphone; display-capture; autoplay; fullscreen; speaker-selection");
  assert.deepEqual(live.liveEmbedSettings({ allowStudentCamera: false, quality: { screenFps: 15, stage: 720 } }), { allowStudentCamera: false, screenFps: 15, stage: 720 });

  assert.equal(embed.tokenRefreshDelayMs(iso(NOW + 60 * 60_000), NOW), 55 * 60_000, "5 min antes do exp");
  assert.equal(embed.tokenRefreshDelayMs(iso(NOW + 60_000), NOW), 10_000, "nunca antes de 10 s");
});

test("o gravador: Gravar pela situacao, quem pode pedir e devolver a maquina, aviso de 6 h, estimativa do preparo e as frases do card", () => {
  assert.equal(rec.recordButtonAction("ready"), "start");
  assert.equal(rec.recordButtonAction("preparing"), "queue");
  assert.equal(rec.recordButtonAction("recording"), "recording");
  assert.equal(rec.recordButtonAction("none"), "unavailable");
  assert.equal(rec.recordButtonAction("unavailable"), "unavailable");
  assert.ok(rec.canRequestRecorder("none") && rec.canRequestRecorder("unavailable") && rec.canRequestRecorder("gone"));
  assert.ok(!rec.canRequestRecorder("preparing") && !rec.canRequestRecorder("recording"));
  // O preparo vencido (o jibri-up so avisa no ready e no unavailable; nas outras falhas a sessao ficaria em preparing).
  const prazo = rec.RECORDER_RULES.prepareTimeoutMinutes * 60_000;
  assert.equal(rec.recorderPrepareStale({ nowMs: NOW, requestedAt: iso(NOW - prazo + 1000), status: "preparing" }), false);
  assert.equal(rec.recorderPrepareStale({ nowMs: NOW, requestedAt: iso(NOW - prazo - 1000), status: "preparing" }), true);
  assert.equal(rec.recorderPrepareStale({ nowMs: NOW, requestedAt: null, status: "preparing" }), true, "sem a hora do pedido: vencido");
  assert.equal(rec.recorderPrepareStale({ nowMs: NOW, requestedAt: iso(NOW - prazo - 1000), status: "ready" }), false);
  assert.ok(rec.canRequestRecorder("preparing", { stale: true }), "Preparar de novo depois do prazo");
  assert.equal(rec.recordButtonAction("preparing", { stale: true }), "unavailable", "o vencido nao entra na fila: a reserva");
  assert.ok(rec.canReleaseRecorder("uploaded") && rec.canReleaseRecorder("ready"));
  assert.ok(!rec.canReleaseRecorder("recording") && !rec.canReleaseRecorder("upload_failed"), "nunca perder um MP4 (I6)");
  assert.ok(rec.canReleaseRecorder("upload_failed", true), "FORCAR=1 com a confirmacao do produtor");
  assert.ok(!rec.canReleaseRecorder("gone", true));

  const seisHoras = 6 * 60 * 60_000;
  assert.equal(rec.recorderOverdue({ nowMs: NOW, requestedAt: iso(NOW - seisHoras - 1), status: "uploaded" }), true);
  assert.equal(rec.recorderOverdue({ nowMs: NOW, requestedAt: iso(NOW - seisHoras + 1), status: "recording" }), false);
  assert.equal(rec.recorderOverdue({ nowMs: NOW, requestedAt: iso(NOW - seisHoras - 1), status: "gone" }), false, "maquina apagada nao avisa");

  const subidas = [8, 10, 12].map((min) => min * 60_000);
  assert.equal(rec.prepareEstimateMinutes({ nowMs: NOW, pastDurationsMs: subidas, requestedAt: iso(NOW - 4 * 60_000) }), 6, "mediana 10 min, 4 ja passaram");
  assert.equal(rec.prepareEstimateMinutes({ nowMs: NOW, pastDurationsMs: subidas, requestedAt: iso(NOW - 30 * 60_000) }), 1, "nunca abaixo de 1 min");
  assert.equal(rec.prepareEstimateMinutes({ nowMs: NOW, pastDurationsMs: [], requestedAt: iso(NOW) }), null, "sem medida: em alguns minutos");
  assert.equal(rec.RECORDER_RULES.prepareLeadMinutes, 30);
  assert.equal(rec.RECORDER_LABELS.uploaded, "Pronto na Bunny");
  assert.equal(rec.RECORDER_LABELS.unavailable, "Sem gravador hoje");
  assert.deepEqual(Object.keys(rec.RECORDER_LABELS).sort(), [...rec.RECORDER_STATUSES].sort());
  assert.equal(WEBINAR_COPY.consoleAoVivo.preparandoGravacao(4), "Preparando a gravação, 4 min");
});

test("o pedido ao workflow: jibri-up e jibri-down pela API do GitHub, so com o token; o duble anota; sem token, o motivo", async () => {
  const pedido = dispatch.recorderDispatchRequest({ sessionId: SESSION, step: "jibri-up", token: "ghp_" + "x".repeat(36) });
  assert.equal(pedido.url, "https://api.github.com/repos/danilosouza-dev/bunker707-member-area/actions/workflows/infra.yml/dispatches");
  assert.deepEqual(JSON.parse(pedido.body), { inputs: { etapa: "jibri-up", opcoes: `CONFIRMADO=sim SESSAO=${SESSION}` }, ref: "main" });
  assert.equal(pedido.headers.authorization, `Bearer ghp_${"x".repeat(36)}`);
  assert.equal(dispatch.recorderStepOptions("jibri-down", SESSION, { force: true }), `CONFIRMADO=sim SESSAO=${SESSION} FORCAR=1`);
  assert.equal(dispatch.recorderStepOptions("jibri-up", SESSION, { force: true }), `CONFIRMADO=sim SESSAO=${SESSION}`, "FORCAR so na devolucao");

  const chamadas = [];
  const github = dispatch.recorderDispatcherFrom({ GITHUB_INFRA_TOKEN: "github_pat_" + "a".repeat(40) }, async (url, init) => {
    chamadas.push({ body: JSON.parse(init.body), url });
    return { ok: true, status: 204 };
  });
  assert.equal(github.kind, "github");
  assert.deepEqual(await github.request(SESSION), { ok: true, step: "jibri-up" });
  assert.deepEqual(await github.release(SESSION, { force: true }), { ok: true, step: "jibri-down" });
  assert.equal(chamadas[1].body.inputs.opcoes, `CONFIRMADO=sim SESSAO=${SESSION} FORCAR=1`);
  assert.deepEqual(await github.request("../etc"), { ok: false, reason: "invalid_session", step: "jibri-up" });

  const falha = dispatch.recorderDispatcherFrom({ GITHUB_INFRA_TOKEN: "github_pat_" + "a".repeat(40) }, async () => ({ ok: false, status: 403 }));
  assert.deepEqual(await falha.request(SESSION), { ok: false, reason: "github_error", status: 403, step: "jibri-up" });
  const caiu = dispatch.recorderDispatcherFrom({ GITHUB_INFRA_TOKEN: "github_pat_" + "a".repeat(40) }, async () => {
    throw new Error("rede");
  });
  assert.deepEqual(await caiu.release(SESSION), { ok: false, reason: "github_error", step: "jibri-down" });

  assert.equal(dispatch.recorderDispatcherFrom({}), null, "sem token: a reserva");
  assert.equal(dispatch.recorderDispatcherFrom({ GITHUB_INFRA_TOKEN: "curto" }), null);
  assert.deepEqual(dispatch.notConfigured("jibri-up"), { ok: false, reason: "not_configured", step: "jibri-up" });
  assert.equal(dispatch.recorderDispatcherFrom({ NODE_ENV: "production", WEBINAR_RECORDER_DISPATCH: "fake" }), null, "o duble nunca na producao");
  const duble = dispatch.recorderDispatcherFrom({ NODE_ENV: "test", WEBINAR_RECORDER_DISPATCH: "fake" });
  assert.equal(duble.kind, "fake");
  await duble.request(SESSION);
  assert.deepEqual(dispatch.fakeRecorderDispatches().at(-1), { force: false, sessionId: SESSION, step: "jibri-up" });
});

test("as linhas da sessao: as colunas da fase 3 com padroes seguros quando o duble antigo nao as tem", () => {
  const base = {
    chat_mode: "open",
    chat_slow_mode_seconds: null,
    created_at: iso(NOW),
    ended_at: null,
    id: SESSION,
    kind: "live",
    late_join_minutes: null,
    pinned_message_id: null,
    presence_curve: null,
    recording_anchor_at: null,
    recording_id: null,
    scheduled_at: iso(NOW),
    script_fired_at: null,
    show_live_badge: false,
    simulation_ack_text: null,
    simulation_decided_at: null,
    simulation_decided_by: null,
    source_session_id: null,
    started_at: null,
    status: "scheduled",
    updated_at: iso(NOW),
    webinar_id: "bbbbbbbb-0000-4000-8000-000000000001"
  };
  const antiga = rows.sessionFromRow(base);
  assert.equal(antiga.recorderStatus, "none");
  assert.equal(antiga.roomLocked, false);
  assert.equal(antiga.roomName, null);
  const nova = rows.sessionFromRow({ ...base, recorder_requested_at: iso(NOW), recorder_status: "preparing", recording_requested_at: iso(NOW), room_locked: true, room_name: "w-x" });
  assert.equal(nova.recorderStatus, "preparing");
  assert.equal(nova.roomLocked, true);
  assert.equal(nova.recordingRequestedAt, iso(NOW));
  assert.equal(rows.recorderStatusOf("qualquer"), "none");
  for (const column of ["room_name", "recorder_status", "recorder_requested_at", "recorder_release_requested_at", "recorder_alerted_at", "recording_requested_at", "room_locked"]) {
    assert.ok(rows.SESSION_COLUMNS.includes(column), column);
  }
  assert.ok(rows.RECORDING_COLUMNS.includes("checked_at") && rows.RECORDING_COLUMNS.includes("purged_at"));
  assert.deepEqual(live.liveRoomInfoOf({ ...nova, recorderStatus: "recording", startedAt: iso(NOW), status: "live" }, true), {
    lobby: true,
    locked: true,
    meetConfigured: true,
    practice: false,
    recording: true,
    startedAt: iso(NOW),
    status: "live"
  });
  // A sala de espera e a Sessao de pratica que o aluno le (a mesma regra do console, desiredLobby).
  const pratica = live.liveRoomInfoOf({ ...nova, roomLocked: false, startedAt: null, status: "waiting" }, true, { practiceSession: true, waitingRoom: false });
  assert.deepEqual([pratica.lobby, pratica.practice], [true, true]);
  const noAr = live.liveRoomInfoOf({ ...nova, roomLocked: false, startedAt: iso(NOW), status: "live" }, true, { practiceSession: true, waitingRoom: false });
  assert.deepEqual([noAr.lobby, noAr.practice], [false, false], "Comecar para todos desliga as duas");
  assert.equal(live.liveRoomInfoOf({ ...nova, roomLocked: false, startedAt: iso(NOW), status: "live" }, true, { practiceSession: false, waitingRoom: true }).lobby, true, "Sala de espera do webinario");
  assert.equal(live.liveJoinRefusal({ ban: live.NO_BAN, practiceSession: true, role: "student", session: { kind: "live", status: "waiting" } }), "not_started", "na Sessao de pratica o aluno espera fora");
  assert.equal(live.liveJoinRefusal({ ban: live.NO_BAN, practiceSession: true, role: "co_host", session: { kind: "live", status: "waiting" } }), null, "a equipe entra");
  assert.equal(live.liveJoinRefusal({ ban: live.NO_BAN, practiceSession: false, role: "student", session: { kind: "live", status: "waiting" } }), null, "sem Sessao de pratica, a espera e de todos");
  assert.equal(live.liveJoinRefusal({ ban: live.NO_BAN, practiceSession: true, role: "student", session: { kind: "live", status: "live" } }), null);
});

test("os schemas novos das acoes: banir, desfazer, trancar e devolver a maquina", () => {
  assert.ok(schemas.banUserSchema.safeParse({ reason: "spam", sessionId: SESSION, userId: SESSION }).success);
  assert.ok(!schemas.banUserSchema.safeParse({ reason: "x".repeat(201), sessionId: SESSION, userId: SESSION }).success);
  assert.ok(schemas.unbanUserSchema.safeParse({ userId: SESSION }).success);
  assert.ok(schemas.roomLockSchema.safeParse({ locked: true, sessionId: SESSION }).success);
  assert.ok(!schemas.roomLockSchema.safeParse({ sessionId: SESSION }).success);
  assert.ok(schemas.releaseRecorderSchema.safeParse({ force: true, sessionId: SESSION }).success);
});

test("o selo Gravando do aluno vale tambem para a gravacao no navegador do Apresentador (a reserva de D3 nao avisa os outros navegadores)", () => {
  const base = { recorderStatus: "none", roomLocked: false, startedAt: iso(NOW), status: "live" };
  assert.equal(live.liveRoomInfoOf(base, true).recording, false);
  assert.equal(live.liveRoomInfoOf({ ...base, browserRecordingAt: iso(NOW) }, true).recording, true, "Gravar no navegador ligado");
  assert.equal(live.liveRoomInfoOf({ ...base, recorderStatus: "recording" }, true).recording, true, "o gravador");
  assert.ok(rows.SESSION_COLUMNS.includes("browser_recording_at"));
  const linha = { chat_mode: "open", chat_slow_mode_seconds: null, created_at: iso(NOW), ended_at: null, id: SESSION, kind: "live", late_join_minutes: null, pinned_message_id: null, presence_curve: null, recording_anchor_at: null, recording_id: null, scheduled_at: iso(NOW), script_fired_at: null, show_live_badge: false, simulation_ack_text: null, simulation_decided_at: null, simulation_decided_by: null, source_session_id: null, started_at: null, status: "live", updated_at: iso(NOW), webinar_id: SESSION };
  assert.equal(rows.sessionFromRow({ ...linha, browser_recording_at: iso(NOW) }).browserRecordingAt, iso(NOW));
  assert.equal(rows.sessionFromRow(linha).browserRecordingAt, null, "o duble antigo sem a coluna");
  assert.equal(embed.RECORDING_SIGNAL, "bunker707:recording");
  assert.deepEqual(schemas.browserRecordingSchema.parse({ on: true, sessionId: SESSION }), { on: true, sessionId: SESSION });
});
