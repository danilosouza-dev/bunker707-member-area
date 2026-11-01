import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// O console da equipe na Live ao vivo, a parte pura (docs/30 §1.4, §2.4, §2.9, §6.4, §6.5 e §6.7): as frases que ainda
// moram em live-console-model.ts passam pela PROIBIDAS_WEBINARIO; o mapa aluno -> participante pelo ultimo
// webinar_room_joined; o nome da sala; quem ve qual botao (Apresentador, co-apresentador, Equipe moderadora ou nao, quem
// publica); a sala de espera da Sessao de pratica, da tranca e da Sala de espera; o reducer da sala (quem esta, a fila
// de maos com Pular e Abaixar, a sala de espera, o palco, o destaque, a gravacao); o "Gravar" da fila uma vez por
// pedido; a ancora uma vez; o cartao Gravacao; os rotulos do silencio; e a previa do "Alinhar chat".

const model = await import("../src/server/webinars/live-console-model.ts");
const { PROIBIDAS_WEBINARIO, WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const { NO_BAN } = await import("../src/server/webinars/live-model.ts");
const { anonymousNumber } = await import("../src/server/webinars/room-model.ts");

const copy = WEBINAR_COPY.consoleAoVivo;
const NOW = Date.parse("2026-11-05T23:05:00.000Z");
const MIN = 60_000;
const WEBINAR = "aaaaaaaa-1111-4111-8111-111111111111";
const ANA = "cccccccc-3333-4333-8333-333333333333";
const BIA = "dddddddd-4444-4444-8444-444444444444";

function texts(value, into = []) {
  if (typeof value === "string") {
    into.push(value);
  } else if (typeof value === "function") {
    for (const args of [["Ana M."], [2], [1], [0]]) {
      try {
        texts(value(...args), into);
      } catch {
        // outra assinatura
      }
    }
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => texts(item, into));
  }
  return into;
}

function person(extra = {}) {
  return { ban: NO_BAN, displayName: "Ana M.", joinedAt: null, participantId: null, staff: false, userId: ANA, ...extra };
}

function recorder(extra = {}) {
  return { anchorAt: null, dispatchConfigured: true, driftMs: null, estimateMinutes: null, fileStartedAt: null, recordingRequestedAt: null, releaseRequestedAt: null, requestedAt: null, status: "none", ...extra };
}

const event = (state, name, payload, nowMs = NOW) => model.liveRoomReducer(state, { name, nowMs, payload, type: "event" });

test("frases provisorias do console ao vivo e as recusas das acoes passam pela PROIBIDAS_WEBINARIO e nunca citam o motor da sala", () => {
  const all = [...texts(model.LIVE_CONSOLE_COPY), ...texts(model.LIVE_ACTION_MESSAGES), ...model.MUTE_CHOICES.map((choice) => choice.label)];
  assert.ok(all.length > 30);
  for (const text of all) {
    const lower = text.toLocaleLowerCase("pt-BR");
    for (const palavra of PROIBIDAS_WEBINARIO) {
      assert.ok(!lower.includes(palavra), `"${text}" usa "${palavra}"`);
    }
  }
  assert.ok(all.some((text) => /[ãçéêíóú]/i.test(text)), "com acentos");
  assert.equal(model.LIVE_CONSOLE_COPY.acoes("Ana M."), "Mais ações para Ana M.");
  assert.deepEqual(
    model.MUTE_CHOICES.map((choice) => [choice.minutes, choice.label]),
    [
      [5, "Silenciar 5 min"],
      [15, "Silenciar 15 min"],
      [60, "Silenciar 60 min"],
      [null, "Silenciar até o fim"]
    ]
  );
});

test("mapa aluno -> participante: o webinar_room_joined mais novo de cada aluno vale; id fora do formato vira nulo", () => {
  const joins = model.latestRoomJoins([
    { created_at: "2026-11-05T23:00:00.000Z", metadata: { participant_id: "aaa111" }, user_id: ANA },
    { created_at: "2026-11-05T23:03:00.000Z", metadata: { participant_id: "bbb222" }, user_id: ANA },
    { created_at: "2026-11-05T23:01:00.000Z", metadata: { participant_id: "<script>" }, user_id: BIA },
    { created_at: "2026-11-05T23:02:00.000Z", metadata: null, user_id: null }
  ]);
  assert.deepEqual(joins.get(ANA), { joinedAt: "2026-11-05T23:03:00.000Z", participantId: "bbb222" });
  assert.deepEqual(joins.get(BIA), { joinedAt: "2026-11-05T23:01:00.000Z", participantId: null });
  assert.equal(joins.size, 2);
});

test("nome na sala: com o aceite, o modo escolhido; sem o aceite, primeiro nome + inicial ou Aluno {n} no card anonimo; a equipe pelo nome", () => {
  const base = { fullName: "Ana Maria Souza", roomDisplayName: "first_name_initial", userId: ANA, webinarId: WEBINAR };
  assert.equal(model.liveParticipantName({ ...base, consent: null }), "Ana S.");
  assert.equal(model.liveParticipantName({ ...base, consent: { displayMode: "nickname", nickname: "Aninha" } }), "Aninha");
  assert.equal(model.liveParticipantName({ ...base, consent: { displayMode: "anonymous", nickname: null } }), `Aluno ${anonymousNumber(ANA, WEBINAR)}`);
  assert.equal(model.liveParticipantName({ ...base, consent: null, roomDisplayName: "anonymous" }), `Aluno ${anonymousNumber(ANA, WEBINAR)}`);
  assert.equal(model.staffDisplayName("Produtor de Teste"), "Produtor T.");
  assert.equal(model.staffDisplayName(null), "Equipe");
  const sorted = model.sortLivePeople([person({ displayName: "Zeca", userId: BIA }), person({ ban: { ...NO_BAN, kicked: true }, displayName: "Bruno" }), person({ displayName: "Ana" })]);
  assert.deepEqual(
    sorted.map((item) => item.displayName),
    ["Bruno", "Ana", "Zeca"],
    "os barrados primeiro, depois por nome"
  );
});

test("o que cada papel ve: Apresentador tudo; co-apresentador sem Banir nem a situacao da sessao; Equipe moderadora silencia todos e remove; Equipe sem moderacao so a mesa", () => {
  assert.equal(model.consoleRoomRole({ currentUserId: ANA, hostUserId: ANA, tokenRole: null }), "host");
  assert.equal(model.consoleRoomRole({ currentUserId: BIA, hostUserId: ANA, tokenRole: undefined }), "team");
  assert.equal(model.consoleRoomRole({ currentUserId: ANA, hostUserId: ANA, tokenRole: "co_host" }), "co_host", "o token vence");
  assert.equal(model.consoleRoomRole({ currentUserId: ANA, hostUserId: null, tokenRole: "student" }), "team", "o console nunca e aluno");

  const host = model.liveControlsFor({ canPublish: true, moderator: true, role: "host" });
  assert.deepEqual(host, { admit: true, ban: true, banEnabled: true, cameras: true, chatMute: true, hands: true, kick: true, lock: true, muteAll: true, record: true, release: true, session: true, sessionEnabled: true, stage: true });

  const coHost = model.liveControlsFor({ canPublish: true, moderator: true, role: "co_host" });
  assert.equal(coHost.ban, false, "co-apresentador nao bane (§1.4)");
  assert.equal(coHost.session, false, "nem encerra a live");
  assert.equal(coHost.record, false, "so o Apresentador grava");
  assert.equal(coHost.release && coHost.cameras && coHost.lock && coHost.stage && coHost.admit, true);

  const teamModerator = model.liveControlsFor({ canPublish: false, moderator: true, role: "team" });
  assert.equal(teamModerator.muteAll && teamModerator.kick && teamModerator.hands && teamModerator.chatMute, true);
  assert.equal(teamModerator.release || teamModerator.cameras || teamModerator.lock || teamModerator.stage || teamModerator.record, false);
  assert.equal(teamModerator.ban, true, "o item Banir aparece");
  assert.equal(teamModerator.banEnabled, false, "mas so liga com messaging.publish");
  assert.equal(teamModerator.sessionEnabled, false);

  const team = model.liveControlsFor({ canPublish: true, moderator: false, role: "team" });
  assert.equal(team.muteAll || team.kick, false, "sem a caixa Pode remover e silenciar na sala");
  assert.equal(team.hands && team.chatMute && team.banEnabled && team.sessionEnabled, true);

  assert.deepEqual(model.liveSessionButtons("scheduled"), { end: false, open: true, start: true });
  assert.deepEqual(model.liveSessionButtons("waiting"), { end: true, open: false, start: true });
  assert.deepEqual(model.liveSessionButtons("live"), { end: true, open: false, start: false });
  assert.deepEqual(model.liveSessionButtons("ended"), { end: false, open: false, start: false });

  assert.equal(model.shouldEnterRoom({ meetConfigured: true, status: "waiting", testing: false }), true);
  assert.equal(model.shouldEnterRoom({ meetConfigured: true, status: "live", testing: false }), true);
  assert.equal(model.shouldEnterRoom({ meetConfigured: true, status: "scheduled", testing: false }), false, "agendada: so por Testar sala");
  assert.equal(model.shouldEnterRoom({ meetConfigured: true, status: "scheduled", testing: true }), true);
  assert.equal(model.shouldEnterRoom({ meetConfigured: false, status: "live", testing: true }), false, "sem a sala no ambiente");
  assert.equal(model.shouldEnterRoom({ meetConfigured: true, status: "ended", testing: true }), false);
});

test("sala de espera: ligada na Sessão de prática ate Começar para todos, com a sala trancada ou com a Sala de espera; a frase de cada caso", () => {
  const base = { practiceSession: true, roomLocked: false, waitingRoom: false };
  assert.equal(model.desiredLobby({ ...base, status: "waiting" }), true);
  assert.equal(model.desiredLobby({ ...base, status: "scheduled" }), true);
  assert.equal(model.desiredLobby({ ...base, status: "live" }), false, "Começar para todos desliga");
  assert.equal(model.desiredLobby({ ...base, practiceSession: false, status: "waiting" }), false);
  assert.equal(model.desiredLobby({ ...base, status: "live", waitingRoom: true }), true);
  assert.equal(model.desiredLobby({ ...base, roomLocked: true, status: "live" }), true);

  assert.equal(model.lobbyNotice({ lobby: true, roomLocked: true, status: "live" }), copy.salaTrancada);
  assert.equal(model.lobbyNotice({ lobby: true, roomLocked: false, status: "waiting" }), copy.sessaoDePratica);
  assert.equal(model.lobbyNotice({ lobby: false, roomLocked: false, status: "scheduled" }), copy.abrirSalaTexto);
  assert.equal(model.lobbyNotice({ lobby: true, roomLocked: false, status: "live" }), copy.salaDeEsperaLigada);
  assert.equal(model.lobbyNotice({ lobby: false, roomLocked: false, status: "live" }), null);
});

test("reducer da sala: quem entra e sai, o proprio console fora da lista, o papel de cada um, e o console moderador pelo proprio participantRoleChanged", () => {
  let state = event(model.EMPTY_ROOM, "participantJoined", { displayName: "Ana S.", id: "p-ana" });
  state = event(state, "videoConferenceJoined", { id: "p-eu" });
  assert.equal(state.selfId, "p-eu");
  assert.deepEqual(state.people, [{ id: "p-ana", name: "Ana S." }], "quem chegou antes do sinal de entrada fica");
  state = event(state, "participantJoined", { displayName: "Eu", id: "p-eu" });
  assert.equal(state.people.length, 1, "o proprio console nao entra na lista");
  state = model.liveRoomReducer(state, { people: [{ displayName: "Bia R.", participantId: "p-bia" }, { formattedDisplayName: "Ana S.", participantId: "p-ana" }, { participantId: "p-eu" }], type: "seed" });
  assert.deepEqual(
    state.people.map((item) => item.id),
    ["p-ana", "p-bia"]
  );
  state = event(state, "participantRoleChanged", { id: "p-bia", role: "moderator" });
  assert.equal(state.roles["p-bia"], "moderator");
  assert.equal(state.moderator, false);
  state = event(state, "participantRoleChanged", { id: "p-eu", role: "moderator" });
  assert.equal(state.moderator, true);
  state = event(state, "participantLeft", { id: "p-bia" });
  assert.deepEqual(
    state.people.map((item) => item.id),
    ["p-ana"]
  );
  assert.equal(state.roles["p-bia"], undefined);
  assert.equal(event(state, "participantJoined", { displayName: "x", id: "<b>" }), state, "id fora do formato e ignorado");
  assert.deepEqual(event(state, "videoConferenceLeft", {}), model.EMPTY_ROOM, "saiu da sala: tudo zera");
});

test("fila de maos: na ordem em que subiram, a do proprio console ignorada, Pular vai para o fim, Abaixar e Abaixar todas tiram, Liberar passa para quem fala e Silenciar tira", () => {
  let state = { ...model.EMPTY_ROOM, selfId: "p-eu" };
  state = event(state, "raiseHandUpdated", { handRaised: NOW + 2_000, id: "p-c" });
  state = event(state, "raiseHandUpdated", { handRaised: NOW + 1_000, id: "p-b" });
  state = event(state, "raiseHandUpdated", { handRaised: true, id: "p-a" }, NOW + 3_000);
  state = event(state, "raiseHandUpdated", { handRaised: NOW, id: "p-eu" });
  assert.deepEqual(
    state.hands.map((hand) => hand.id),
    ["p-b", "p-c", "p-a"]
  );
  assert.equal(event(state, "raiseHandUpdated", { handRaised: NOW + 5_000, id: "p-b" }).hands.length, 3, "a mesma mao nao entra duas vezes");

  state = model.liveRoomReducer(state, { id: "p-b", type: "skipHand" });
  assert.deepEqual(
    state.hands.map((hand) => hand.id),
    ["p-c", "p-a", "p-b"],
    "Pular"
  );
  state = event(state, "raiseHandUpdated", { handRaised: 0, id: "p-c" });
  assert.deepEqual(
    state.hands.map((hand) => hand.id),
    ["p-a", "p-b"],
    "o aluno abaixou"
  );
  state = model.liveRoomReducer(state, { id: "p-a", type: "release" });
  assert.deepEqual(state.speaking, ["p-a"]);
  assert.deepEqual(
    state.hands.map((hand) => hand.id),
    ["p-b"]
  );
  state = event(state, "moderationParticipantApproved", { id: "p-b", mediaType: "audio" });
  assert.deepEqual(state.speaking, ["p-a", "p-b"], "liberado por outro moderador");
  assert.equal(state.hands.length, 0);
  state = model.liveRoomReducer(state, { id: "p-a", type: "silence" });
  assert.deepEqual(state.speaking, ["p-b"]);
  state = event(event(state, "raiseHandUpdated", { handRaised: NOW, id: "p-x" }), "raiseHandUpdated", { handRaised: NOW + 1, id: "p-y" });
  assert.equal(model.liveRoomReducer(state, { id: "p-x", type: "lowerHand" }).hands.length, 1);
  assert.equal(model.liveRoomReducer(state, { type: "lowerAll" }).hands.length, 0);
  assert.equal(JSON.parse(model.lowerHandMessage()).type, model.LOWER_HAND_SIGNAL);
});

test("sala de espera, palco, destaque, remover e gravacao pelo reducer", () => {
  let state = { ...model.EMPTY_ROOM, selfId: "p-eu" };
  state = event(state, "knockingParticipant", { participant: { id: "k-1", name: "Caio" } });
  state = event(state, "knockingParticipant", { participant: { id: "k-2", name: "Duda" } });
  state = event(state, "knockingParticipant", { participant: { id: "k-2", name: "Duda" } });
  assert.deepEqual(state.knocking, [
    { id: "k-1", name: "Caio" },
    { id: "k-2", name: "Duda" }
  ]);
  assert.deepEqual(model.liveRoomReducer(state, { id: "k-1", type: "admit" }).knocking, [{ id: "k-2", name: "Duda" }]);
  assert.deepEqual(model.liveRoomReducer(state, { type: "admitAll" }).knocking, []);
  state = event(state, "participantJoined", { displayName: "Caio", id: "k-1" });
  assert.deepEqual(
    state.knocking.map((item) => item.id),
    ["k-2"],
    "quem entrou sai da sala de espera"
  );

  state = event(state, "raiseHandUpdated", { handRaised: NOW, id: "k-1" });
  state = model.liveRoomReducer(state, { id: "k-1", on: true, type: "stage" });
  assert.deepEqual(state.stage, ["k-1"]);
  assert.equal(state.hands.length, 0, "convidado ao palco sai da fila");
  state = model.liveRoomReducer(state, { id: "k-1", type: "spotlight" });
  assert.equal(state.spotlight, "k-1");
  const off = model.liveRoomReducer(state, { id: "k-1", on: false, type: "stage" });
  assert.deepEqual([off.stage, off.spotlight], [[], null], "Tirar do palco tira o destaque");
  const kicked = model.liveRoomReducer(state, { id: "k-1", type: "kicked" });
  assert.deepEqual([kicked.people, kicked.stage, kicked.spotlight], [[], [], null]);

  state = event(state, "recordingStatusChanged", { mode: "file", on: true });
  assert.deepEqual(state.recording, { mode: "file", on: true });
  assert.deepEqual(event(state, "recordingStatusChanged", { mode: "file", on: false }).recording, { mode: "file", on: false });
});

test("linhas da mesa: o aluno do retrato pelo id do participante, a equipe pela moderacao, a fila com nomes e os barrados", () => {
  let state = { ...model.EMPTY_ROOM, selfId: "p-eu" };
  state = event(state, "participantJoined", { displayName: "Ana na sala", id: "p-ana" });
  state = event(state, "participantJoined", { displayName: "Professora", id: "p-prof" });
  state = event(state, "participantRoleChanged", { id: "p-prof", role: "moderator" });
  state = event(state, "raiseHandUpdated", { handRaised: NOW, id: "p-ana" });
  const people = [person({ participantId: "p-ana" }), person({ ban: { ...NO_BAN, muted: true, mutedUntil: "2026-11-05T23:20:00.000Z" }, displayName: "Bia R.", userId: BIA })];
  const rows = model.roomRows(state, people);
  assert.deepEqual(
    rows.map((row) => [row.id, row.name, row.staff, row.person?.userId ?? null]),
    [
      ["p-ana", "Ana M.", false, ANA],
      ["p-prof", "Professora", true, null]
    ]
  );
  assert.deepEqual(
    model.handRows(state, people).map((row) => [row.id, row.name]),
    [["p-ana", "Ana M."]]
  );
  assert.deepEqual(
    model.barredPeople(people).map((item) => item.userId),
    [BIA]
  );
});

test("rotulos do silencio e do banimento (hora de Sao Paulo)", () => {
  assert.deepEqual(model.banLabels(NO_BAN), []);
  assert.deepEqual(model.banLabels({ banned: true, kicked: true, muted: true, mutedUntil: "2026-11-05T23:20:00.000Z" }), [copy.banido, copy.removido, "Sem escrever até 20:20"]);
  assert.equal(model.muteLabel({ muted: true, mutedUntil: null }), copy.silenciadoAteOFim);
  assert.equal(model.muteLabel({ muted: false, mutedUntil: null }), null);
});

test("o Gravar da fila dispara sozinho uma vez por pedido, so no navegador do Apresentador, dentro da sala, com a maquina pronta e sem gravar", () => {
  const base = { firedFor: null, joined: true, recorderStatus: "ready", recording: false, recordingRequestedAt: "2026-11-05T23:00:00.000Z", role: "host" };
  assert.equal(model.shouldAutoStartRecording(base), true);
  assert.equal(model.shouldAutoStartRecording({ ...base, firedFor: base.recordingRequestedAt }), false, "uma vez por pedido");
  assert.equal(model.shouldAutoStartRecording({ ...base, firedFor: "2026-11-05T22:00:00.000Z" }), true, "um pedido novo dispara de novo");
  assert.equal(model.shouldAutoStartRecording({ ...base, recorderStatus: "preparing" }), false);
  assert.equal(model.shouldAutoStartRecording({ ...base, recordingRequestedAt: null }), false, "sem clique na fila");
  assert.equal(model.shouldAutoStartRecording({ ...base, role: "co_host" }), false);
  assert.equal(model.shouldAutoStartRecording({ ...base, joined: false }), false);
  assert.equal(model.shouldAutoStartRecording({ ...base, recording: true }), false);
});

test("a ancora sai uma vez, so do Apresentador, so com a gravacao ligada e sem ancora no retrato", () => {
  const base = { alreadyMarked: false, anchorAt: null, payload: { mode: "file", on: true }, role: "host" };
  assert.equal(model.shouldMarkAnchor(base), true);
  assert.equal(model.shouldMarkAnchor({ ...base, alreadyMarked: true }), false);
  assert.equal(model.shouldMarkAnchor({ ...base, anchorAt: "2026-11-05T23:00:00.000Z" }), false);
  assert.equal(model.shouldMarkAnchor({ ...base, payload: { on: false } }), false);
  assert.equal(model.shouldMarkAnchor({ ...base, role: "team" }), false);
});

test("cartao Gravação: Preparar, a frase da reserva, Gravar com a maquina pronta, a fila com a estimativa, gravando, sem gravador hoje e Desligar o gravador", () => {
  const none = model.recorderCard({ recorder: recorder(), recordingOn: false, status: "live" });
  assert.deepEqual([none.action, none.label, none.note, none.fallback], ["prepare", "Não preparado", copy.gravacaoNaoPreparada, false]);
  const noDispatch = model.recorderCard({ recorder: recorder({ dispatchConfigured: false }), recordingOn: false, status: "live" });
  assert.deepEqual([noDispatch.note, noDispatch.fallback], [copy.disparoAusente, true], "sem o pedido automatico: a reserva");
  const preparing = model.recorderCard({ recorder: recorder({ estimateMinutes: 4, status: "preparing" }), recordingOn: false, status: "live" });
  assert.deepEqual([preparing.action, preparing.note], ["record", "Preparando a gravação, 4 min"]);
  const queued = model.recorderCard({ recorder: recorder({ recordingRequestedAt: "2026-11-05T23:00:00.000Z", status: "preparing" }), recordingOn: false, status: "live" });
  assert.equal(queued.action, "queued");
  assert.equal(queued.note, `${copy.preparandoGravacaoSemMedida}. ${copy.gravarNaFila}`);
  const ready = model.recorderCard({ recorder: recorder({ status: "ready" }), recordingOn: false, status: "live" });
  assert.deepEqual([ready.action, ready.note], ["record", copy.gravacaoPronta]);
  assert.equal(model.recorderCard({ recorder: recorder({ status: "ready" }), recordingOn: false, status: "scheduled" }).action, "none", "so grava na espera ou no ar");
  assert.equal(model.recorderCard({ recorder: recorder({ status: "ready" }), recordingOn: true, status: "live" }).label, "Gravando", "o iframe avisou antes do webhook");
  assert.equal(model.recorderCard({ recorder: recorder({ status: "recording" }), recordingOn: false, status: "live" }).action, "recording");
  assert.equal(model.recorderCard({ recorder: recorder({ status: "uploading" }), recordingOn: false, status: "ended" }).action, "none");
  const unavailable = model.recorderCard({ recorder: recorder({ status: "unavailable" }), recordingOn: false, status: "live" });
  assert.deepEqual([unavailable.note, unavailable.fallback], [copy.semGravadorHoje, true]);
  assert.equal(model.recorderCard({ recorder: recorder({ status: "uploaded" }), recordingOn: false, status: "ended" }).action, "release");
  assert.equal(model.recorderCard({ recorder: recorder({ status: "upload_failed" }), recordingOn: false, status: "ended" }).action, "none", "upload_failed so com FORCAR pela equipe tecnica");
});

test("maquina ligada ha, a ancora com os segundos e a diferenca para o arquivo", () => {
  assert.equal(model.machineAge({ nowMs: NOW, requestedAt: new Date(NOW - 65 * MIN).toISOString(), status: "recording" }), "Máquina ligada há 1 h 05 min");
  assert.equal(model.machineAge({ nowMs: NOW, requestedAt: new Date(NOW - 7 * MIN).toISOString(), status: "preparing" }), "Máquina ligada há 7 min");
  assert.equal(model.machineAge({ nowMs: NOW, requestedAt: new Date(NOW - 7 * MIN).toISOString(), status: "gone" }), null, "maquina apagada");
  assert.equal(model.anchorLabel("2026-11-05T23:03:15.400Z"), "A gravação começou às 20:03:15");
  assert.equal(model.anchorLabel(null), null);
  assert.equal(model.driftLabel(4_600), "O arquivo começou 5 s depois do clique");
  assert.equal(model.driftLabel(null), null);
});

test("Alinhar chat: o ajuste em segundos dentro de 1 h, o segundo do video da mensagem e o player no ponto", () => {
  assert.equal(model.clampAlignSeconds(4.6), 5);
  assert.equal(model.clampAlignSeconds(99_999), 3600);
  assert.equal(model.clampAlignSeconds(Number.NaN), 0);
  assert.deepEqual([...model.ALIGN_STEPS], [-5, -1, 1, 5]);
  assert.equal(model.alignPreviewSeconds(90_000, 0), 90);
  assert.equal(model.alignPreviewSeconds(90_000, 4_000), 86, "posição no vídeo = offset_ms − anchor_offset_ms");
  assert.equal(model.alignPreviewSeconds(2_000, 4_000), 0, "nunca antes do zero");
  const url = new URL(model.previewAt("https://iframe.mediadelivery.net/embed/1/abc?token=x&expires=9", 86));
  assert.deepEqual([url.searchParams.get("t"), url.searchParams.get("token"), url.searchParams.get("autoplay")], ["86", "x", "false"]);
  assert.equal(new URL(model.previewAt("https://iframe.mediadelivery.net/embed/1/abc?t=5", 0)).searchParams.get("t"), null);
});

test("mapa aluno -> participante: o mesmo id em duas contas nao liga nenhuma (o aluno que manda o id de outro nao ganha o quadro dele nem tira o outro da sala)", () => {
  const joins = model.latestRoomJoins([
    { created_at: "2026-11-05T23:00:00.000Z", metadata: { participant_id: "p-bia" }, user_id: BIA },
    { created_at: "2026-11-05T23:01:00.000Z", metadata: { participant_id: "p-bia" }, user_id: ANA }
  ]);
  assert.equal(joins.get(BIA).participantId, null);
  assert.equal(joins.get(ANA).participantId, null);
  const people = [person({ participantId: joins.get(ANA).participantId }), person({ displayName: "Bia R.", participantId: joins.get(BIA).participantId, userId: BIA })];
  let state = { ...model.EMPTY_ROOM, selfId: "p-eu" };
  state = event(state, "participantJoined", { displayName: "Bia R.", id: "p-bia" });
  const [row] = model.roomRows(state, people);
  assert.equal(row.person, null, "o quadro de B nao vira o aluno A: nenhum Remover/Banir manda kickParticipant para B");
  assert.equal(row.name, "Bia R.");
});

test("ao virar moderador, o apresentador liga a moderacao de audio; a de video so sem camera de aluno; seguir a visao so o Apresentador", () => {
  assert.deepEqual(model.presenterSetupCommands({ allowStudentCamera: true, role: "host" }), [
    ["toggleModeration", true, "audio"],
    ["setFollowMe", true]
  ]);
  assert.deepEqual(model.presenterSetupCommands({ allowStudentCamera: false, role: "co_host" }), [
    ["toggleModeration", true, "audio"],
    ["toggleModeration", true, "video"]
  ]);
  assert.deepEqual(model.presenterSetupCommands({ allowStudentCamera: true, role: "team" }), [], "a Equipe nao comanda a sala");
});

test("ao virar moderador, nenhum papel manda a moderacao de tela: na tag o 'desktop' do toggleModeration liga de novo a de audio (docs/31 §5.4)", () => {
  for (const role of ["host", "co_host", "team"]) {
    for (const allowStudentCamera of [true, false]) {
      const commands = model.presenterSetupCommands({ allowStudentCamera, role });
      assert.ok(
        commands.every((command) => !command.includes("desktop")),
        `${role} com allowStudentCamera=${allowStudentCamera} nao manda nada com "desktop"`
      );
      assert.ok(
        commands.filter(([name, enabled, mediaType]) => name === "toggleModeration" && enabled === true && mediaType === "audio").length <= 1,
        `${role} com allowStudentCamera=${allowStudentCamera} liga a moderacao de audio no maximo uma vez`
      );
    }
  }
});

test("cartao Gravação: o preparo que nao respondeu em 25 min vale como sem gravador (Preparar de novo e a reserva), nunca Preparando 1 min para sempre", () => {
  const pedido = (minutos) => new Date(NOW - minutos * MIN).toISOString();
  const recente = model.recorderCard({ nowMs: NOW, recorder: recorder({ estimateMinutes: 1, requestedAt: pedido(20), status: "preparing" }), recordingOn: false, status: "live" });
  assert.deepEqual([recente.action, recente.fallback], ["record", false], "dentro do prazo: preparando");
  const vencido = model.recorderCard({ nowMs: NOW, recorder: recorder({ estimateMinutes: 1, recordingRequestedAt: pedido(10), requestedAt: pedido(26), status: "preparing" }), recordingOn: false, status: "live" });
  assert.deepEqual([vencido.action, vencido.fallback, vencido.note], ["prepare", true, copy.preparoSemResposta]);
  for (const palavra of PROIBIDAS_WEBINARIO) {
    assert.ok(!copy.preparoSemResposta.toLocaleLowerCase("pt-BR").includes(palavra));
  }
});

test("Gravar no navegador: so o Apresentador, so a gravacao local (a do gravador ja chega a todos); o sinal da sala com on/off", () => {
  assert.equal(model.browserRecordingChange({ payload: { mode: "local", on: true }, role: "host" }), true);
  assert.equal(model.browserRecordingChange({ payload: { mode: "local", on: false }, role: "host" }), false);
  assert.equal(model.browserRecordingChange({ payload: { mode: "file", on: true }, role: "host" }), null, "o gravador ja avisa todos");
  assert.equal(model.browserRecordingChange({ payload: { mode: "local", on: true }, role: "co_host" }), null);
  assert.deepEqual(JSON.parse(model.recordingSignalMessage(true)), { on: true, type: model.RECORDING_SIGNAL });
});

/* ------------------------------------------------------------------------------------------------
 * O palco do console (docs/31 V2-4 e V2-A5): o que o motor mostra e quem esta no video grande
 * ---------------------------------------------------------------------------------------------- */

test("reducer da sala: a visao (tileViewChanged), a coluna de miniaturas (filmstripDisplayChanged, visivel ao entrar) e quem esta no video grande (onStage); um iframe novo volta ao padrao do motor e a saida guarda a visao", () => {
  assert.deepEqual([model.EMPTY_ROOM.viewShown, model.EMPTY_ROOM.filmstripVisible, model.EMPTY_ROOM.onStageId], ["stage", true, null], "o motor comeca no Palco, com a coluna");
  let state = { ...model.EMPTY_ROOM, selfId: "e0e0e0e0" };
  state = event(state, "tileViewChanged", { enabled: true });
  assert.equal(state.viewShown, "grid");
  state = event(state, "tileViewChanged", { enabled: false });
  assert.equal(state.viewShown, "stage");
  assert.equal(event(state, "tileViewChanged", {}), state, "sem o booleano, nada muda");
  state = event(state, "filmstripDisplayChanged", { visible: false });
  assert.equal(state.filmstripVisible, false);
  assert.equal(event(state, "filmstripDisplayChanged", { visible: "nao" }), state);
  state = event(state, "filmstripDisplayChanged", { visible: true });
  assert.equal(state.filmstripVisible, true);

  // Quem esta no video grande: o id lido do IFrame API (a tela compartilhada `<id>-v1` tambem); fora do formato, ninguem.
  state = model.liveRoomReducer(state, { id: "c0c0c0c0", type: "onStage" });
  assert.equal(state.onStageId, "c0c0c0c0");
  assert.equal(model.liveRoomReducer(state, { id: "e0e0e0e0-v1", type: "onStage" }).onStageId, "e0e0e0e0-v1");
  assert.equal(model.liveRoomReducer(state, { id: "<b>", type: "onStage" }).onStageId, null);
  assert.equal(model.liveRoomReducer(state, { id: null, type: "onStage" }).onStageId, null);

  // Saiu da sala: tudo zera menos a visao e a coluna (o mesmo iframe pode voltar com o motor como estava).
  const grade = event(event(state, "tileViewChanged", { enabled: true }), "filmstripDisplayChanged", { visible: false });
  const saiu = event(grade, "videoConferenceLeft", {});
  assert.deepEqual(saiu, { ...model.EMPTY_ROOM, filmstripVisible: false, viewShown: "grid" });
  // O primeiro sinal de um iframe novo: o Palco com a coluna e ninguem lido no video grande; o resto fica.
  const novo = model.liveRoomReducer(grade, { type: "frame" });
  assert.deepEqual([novo.viewShown, novo.filmstripVisible, novo.onStageId], ["stage", true, null]);
  assert.equal(novo.selfId, grade.selfId);
});

test("coluna de miniaturas pela largura no console do co-apresentador e da Equipe (docs/31 V2-A5): um toggleFilmStrip por vez, e a coluna que volta depois da resposta do motor (o seguir a visao, o atalho F) sai de novo", async () => {
  const { columnWanted } = await import("../src/components/member/webinars/room/live-room-model.ts");
  // O console como o useLiveRoom e o ConsoleStage o rodam: cada sinal passa pelo reducer e solta (ou nao) o pedido que
  // espera; a cada estado novo, a conta da coluna manda o toggleFilmStrip, que o motor responde com a coluna invertida.
  let state = { ...model.EMPTY_ROOM, selfId: "c0c0c0c0" };
  let pending = null;
  const sent = [];
  const signal = (name, payload = {}, newFrame = false) => {
    pending = model.consoleFilmstripPendingAfter({ name, newFrame, pending });
    state = event(state, name, payload);
  };
  // A 1280 px o painel deixa o iframe com cerca de 872 px, abaixo do que a coluna pede: o palco nao a quer.
  const sync = (frameWidth = 872) => {
    const step = { pending, visible: state.filmstripVisible, wanted: columnWanted({ frameWidth, view: state.viewShown }) };
    if (model.consoleFilmstripShouldToggle(step)) {
      sent.push(step.visible);
      pending = step.visible;
    }
  };

  signal("videoConferenceJoined", { id: "c0c0c0c0" }, true);
  sync();
  assert.deepEqual(sent, [true], "na entrada o motor mostra a coluna: um toggleFilmStrip");
  sync();
  sync(900);
  assert.deepEqual(sent, [true], "enquanto o motor nao responde, nenhum outro (dois seguidos deixariam a coluna como estava)");
  signal("participantJoined", { displayName: "Ana S.", id: "a1a1a1a1" });
  sync();
  assert.deepEqual(sent, [true], "outro sinal nao solta o pedido");

  signal("filmstripDisplayChanged", { visible: false });
  sync();
  assert.equal(pending, null, "a resposta do motor solta o pedido");
  assert.deepEqual(sent, [true], "a coluna ja saiu: nada a mandar");

  // A coluna volta por outra causa (o seguir a visao de quem apresenta, o F dentro do iframe): sai de novo.
  signal("filmstripDisplayChanged", { visible: true });
  sync();
  assert.deepEqual(sent, [true, true], "a coluna que voltou por cima do iframe estreito sai de novo");
  signal("filmstripDisplayChanged", { visible: false });

  // O painel fecha e o iframe cresce: a coluna volta, uma vez.
  sync(1400);
  sync(1400);
  assert.deepEqual(sent, [true, true, false]);
  signal("filmstripDisplayChanged", { visible: true });
  sync(1400);
  assert.deepEqual(sent, [true, true, false], "o palco quer a coluna e ela esta na tela");

  // Um iframe novo ou uma nova entrada soltam o pedido que esperava do anterior.
  assert.equal(model.consoleFilmstripPendingAfter({ name: "participantJoined", newFrame: true, pending: true }), null);
  assert.equal(model.consoleFilmstripPendingAfter({ name: "videoConferenceJoined", newFrame: false, pending: false }), null);
  assert.equal(model.consoleFilmstripPendingAfter({ name: "largeVideoChanged", newFrame: false, pending: false }), false);
});

/* ------------------------------------------------------------------------------------------------
 * O vigia da tela (docs/31 §5.4): quem compartilha, os papeis pelo getRoomsInfo e quem tem a tela parada
 * ---------------------------------------------------------------------------------------------- */

test("reducer da sala: quem compartilha a tela pelo contentSharingParticipantsChanged (so ids validos, sem repetir, ate 50); quem sai deixa de compartilhar", () => {
  let state = { ...model.EMPTY_ROOM, selfId: "p-eu" };
  assert.deepEqual(model.EMPTY_ROOM.sharing, [], "ninguem compartilha ao entrar");
  state = event(state, "participantJoined", { displayName: "Ana S.", id: "p-ana" });
  state = event(state, "contentSharingParticipantsChanged", { data: ["p-ana", "p-co", "p-ana", "<b>", 7, "p-eu"] });
  assert.deepEqual(state.sharing, ["p-ana", "p-co", "p-eu"], "o proprio console fica na lista (o vigia o pula)");
  assert.deepEqual(event(state, "contentSharingParticipantsChanged", { data: "p-ana" }).sharing, [], "payload fora do formato: ninguem");
  assert.deepEqual(event(state, "contentSharingParticipantsChanged", {}).sharing, []);
  const many = Array.from({ length: 60 }, (_, index) => `p-${index}`);
  assert.equal(event(state, "contentSharingParticipantsChanged", { data: many }).sharing.length, 50);

  state = event(state, "participantLeft", { id: "p-ana" });
  assert.deepEqual(state.sharing, ["p-co", "p-eu"], "quem saiu da sala deixa de compartilhar");
  assert.deepEqual(model.liveRoomReducer(state, { id: "p-co", type: "kicked" }).sharing, ["p-eu"]);
  state = event(state, "contentSharingParticipantsChanged", { data: [] });
  assert.deepEqual(state.sharing, [], "a lista nova troca a de antes");
  assert.deepEqual(event({ ...state, sharing: ["p-co"] }, "videoConferenceLeft", {}), model.EMPTY_ROOM, "saiu da sala: ninguem compartilha");
});

test("reducer da sala: o microfone e a camera de cada um pelo participantMuted (so audio e video, o proprio console fora) e pelo getRoomsInfo (quem ja estava); quem sai e quem e removido somem; as linhas da aba Pessoas leem daqui, sem sinal desligado", () => {
  let state = { ...model.EMPTY_ROOM, selfId: "p-eu" };
  assert.deepEqual(model.EMPTY_ROOM.media, {}, "ninguem com microfone ou camera ao entrar");
  state = event(state, "participantJoined", { displayName: "Ana S.", id: "p-ana" });
  state = event(state, "participantJoined", { displayName: "Bia R.", id: "p-bia" });
  // A faixa de microfone da Ana entra aberta; a camera dela, fechada. A tela vem do contentSharingParticipantsChanged.
  state = event(state, "participantMuted", { id: "p-ana", isMuted: false, mediaType: "audio" });
  state = event(state, "participantMuted", { id: "p-ana", isMuted: true, mediaType: "video" });
  assert.deepEqual(state.media, { "p-ana": { audio: true, video: false } });
  for (const [payload, motivo] of [
    [{ id: "p-ana", isMuted: false, mediaType: "desktop" }, "a tela nao entra em media"],
    [{ id: "p-eu", isMuted: false, mediaType: "audio" }, "o proprio console fica fora"],
    [{ id: "<b>", isMuted: false, mediaType: "audio" }, "id fora do formato"],
    [{ id: "p-ana", isMuted: "nao", mediaType: "audio" }, "isMuted sem booleano"],
    [{ id: "p-ana", mediaType: "video" }, "sem isMuted"],
    [{ id: "p-ana", isMuted: false, mediaType: "audio" }, "o mesmo estado de antes"]
  ]) {
    assert.equal(event(state, "participantMuted", payload), state, motivo);
  }
  // A camera abre depois; o microfone fecha.
  state = event(state, "participantMuted", { id: "p-ana", isMuted: false, mediaType: "video" });
  state = event(state, "participantMuted", { id: "p-ana", isMuted: true, mediaType: "audio" });
  assert.deepEqual(state.media["p-ana"], { audio: false, video: true });

  // Quem ja estava quando o console entrou: o getRoomsInfo traz o microfone e a camera (audioMuted e videoMuted); sem o
  // campo, o que o console ja sabia fica.
  state = model.liveRoomReducer(state, {
    info: {
      rooms: [
        {
          isMainRoom: true,
          participants: [
            { displayName: "Eu", id: "p-eu", role: "moderator" },
            { audioMuted: false, displayName: "Co T.", id: "p-co", role: "moderator", videoMuted: false },
            { audioMuted: true, displayName: "Bia R.", id: "p-bia", role: "participant", videoMuted: true },
            { displayName: "Ana S.", id: "p-ana", role: "participant" }
          ]
        }
      ]
    },
    type: "roomsInfo"
  });
  assert.deepEqual(state.media, { "p-ana": { audio: false, video: true }, "p-bia": { audio: false, video: false }, "p-co": { audio: true, video: true } });
  assert.ok(!Object.hasOwn(state.media, "p-eu"), "o proprio console fica fora tambem pelo getRoomsInfo");

  // As linhas da aba Pessoas: o microfone, a camera e quem compartilha a tela; sem sinal, desligados.
  state = event(state, "participantJoined", { displayName: "Caio", id: "p-caio" });
  state = event(state, "contentSharingParticipantsChanged", { data: ["p-co"] });
  assert.deepEqual(
    model.roomRows(state, []).map((row) => [row.id, row.audio, row.video, row.sharing]),
    [
      ["p-ana", false, true, false],
      ["p-bia", false, false, false],
      ["p-co", true, true, true],
      ["p-caio", false, false, false]
    ]
  );
  // O RoomPerson continua so com o id e o nome.
  assert.deepEqual(state.people[0], { id: "p-ana", name: "Ana S." });

  // Quem sai da sala e quem e removido somem de media; a saida do console zera tudo.
  state = event(state, "participantLeft", { id: "p-ana" });
  assert.ok(!Object.hasOwn(state.media, "p-ana"), "participantLeft limpa");
  state = model.liveRoomReducer(state, { id: "p-bia", type: "kicked" });
  assert.ok(!Object.hasOwn(state.media, "p-bia"), "o Remover limpa");
  assert.deepEqual(Object.keys(state.media), ["p-co"]);
  assert.deepEqual(event(state, "videoConferenceLeft", {}).media, {}, "saiu da sala: tudo zera");
});

test("papeis pelo getRoomsInfo: quem veio na sala principal ganha o papel e entra na lista; o proprio console, id invalido e papel fora da lista ficam fora; um participantRoleChanged depois troca o papel", () => {
  let state = { ...model.EMPTY_ROOM, selfId: "p-eu" };
  state = event(state, "participantJoined", { displayName: "Ana S.", id: "p-ana" });
  const info = {
    rooms: [
      { id: "sala-de-apoio", isMainRoom: false, participants: [{ displayName: "Outra", id: "p-outra", role: "moderator" }] },
      {
        isMainRoom: true,
        participants: [
          { displayName: "Eu", id: "p-eu", role: "moderator" },
          { displayName: "Co T.", id: "p-co", role: "moderator" },
          { displayName: "Ana S.", id: "p-ana", role: "participant" },
          { displayName: "Sem papel", id: "p-sem", role: "owner" },
          { displayName: "<b>", id: "<b>", role: "participant" },
          null,
          { displayName: "Visitante", id: "p-vis", role: "none" }
        ]
      }
    ]
  };
  const next = model.liveRoomReducer(state, { info, type: "roomsInfo" });
  assert.deepEqual(next.roles, { "p-ana": "participant", "p-co": "moderator", "p-vis": "none" }, "so a sala principal, sem o proprio console, sem papel fora da lista");
  assert.equal(next.moderator, false, "o papel do proprio console continua pelo participantRoleChanged");
  assert.deepEqual(
    next.people.map((person) => [person.id, person.name]),
    [
      ["p-ana", "Ana S."],
      ["p-co", "Co T."],
      ["p-sem", "Sem papel"],
      ["p-vis", "Visitante"]
    ],
    "quem ainda nao estava entra com o nome; ninguem repete"
  );
  assert.equal(model.applyConsoleRoomsInfo(state, info).roles["p-co"], "moderator", "a mesma conta pela funcao pura");

  // Sem a sala principal marcada, a primeira; sem resposta, nada muda.
  const first = model.applyConsoleRoomsInfo(state, { rooms: [{ participants: [{ id: "p-co", role: "moderator" }] }] });
  assert.equal(first.roles["p-co"], "moderator");
  assert.equal(model.applyConsoleRoomsInfo(state, null), state);
  assert.equal(model.applyConsoleRoomsInfo(state, { rooms: "x" }), state);
  assert.equal(model.applyConsoleRoomsInfo(state, { rooms: [{ participants: null }] }), state);

  // O participantRoleChanged depois da resposta vence (o iframe responde e avisa na ordem).
  const demoted = event(next, "participantRoleChanged", { id: "p-co", role: "participant" });
  assert.equal(demoted.roles["p-co"], "participant");
  // E a resposta seguinte troca o papel de novo, pelo que o iframe sabe agora.
  assert.equal(model.applyConsoleRoomsInfo(demoted, info).roles["p-co"], "moderator");
});

test("papeis pelo getRoomsInfo: fora da sala (antes de entrar ou depois de sair) a resposta nao muda nada; a do iframe que saiu nao deixa o proprio console como linha depois de entrar de novo", () => {
  const answer = (id) => ({ rooms: [{ isMainRoom: true, participants: [{ displayName: "Produtor T.", id, role: "moderator" }, { displayName: "Aluna", id: "aluna01", role: "participant" }] }] });

  // Antes do videoConferenceJoined: sem o proprio id, nada entra.
  assert.equal(model.liveRoomReducer(model.EMPTY_ROOM, { info: answer("old1234"), type: "roomsInfo" }), model.EMPTY_ROOM);

  // Entrou, virou moderador, alguem entrou e o console saiu (hangup): a sala volta vazia.
  let state = event(model.EMPTY_ROOM, "videoConferenceJoined", { id: "old1234" });
  state = event(state, "participantRoleChanged", { id: "old1234", role: "moderator" });
  state = event(state, "participantJoined", { displayName: "Aluna", id: "aluna01" });
  state = event(state, "videoConferenceLeft", {});
  assert.equal(state.selfId, null);
  // A resposta que o iframe que saiu ainda manda (com o proprio console e quem estava) nao muda nada.
  const afterLeft = model.liveRoomReducer(state, { info: answer("old1234"), type: "roomsInfo" });
  assert.equal(afterLeft, state);
  // Entrou de novo com outro id: nenhuma linha do console de antes, nem de quem estava na sala de antes.
  state = event(afterLeft, "videoConferenceJoined", { id: "new5678" });
  assert.deepEqual(state.people, []);
  assert.deepEqual(state.roles, {});
  assert.deepEqual(model.roomRows(state, []), []);

  // Dentro da sala de novo, a resposta seguinte vale (o proprio id novo fica fora).
  state = model.liveRoomReducer(state, { info: answer("new5678"), type: "roomsInfo" });
  assert.deepEqual(
    model.roomRows(state, []).map((row) => [row.id, row.name, row.staff]),
    [["aluna01", "Aluna", false]]
  );
});

test("vigia da tela: so quem compartilha com papel conhecido de nao moderador e sem liberacao tem a tela parada; o id sem papel (quem ja moderava quando o console entrou) espera o papel", () => {
  const base = { grants: [], justGranted: [], roles: {}, selfId: "p-eu", sharing: [] };
  const stop = (extra) => model.screenSharesToStop({ ...base, ...extra });

  assert.deepEqual(stop({ roles: { "p-ana": "participant" }, sharing: ["p-ana"] }), ["p-ana"], "a aluna com papel de participante");
  assert.deepEqual(stop({ roles: { "p-vis": "none" }, sharing: ["p-vis"] }), ["p-vis"], "sem papel na sala (none) tambem e parado");
  assert.deepEqual(stop({ roles: { "p-co": "moderator" }, sharing: ["p-co"] }), [], "o co-apresentador (moderador) continua");
  // O caso que o plano de antes quebrava: o Apresentador ja compartilhava quando o co-apresentador abriu o console, e
  // o papel dele so vem do getRoomsInfo. Sem papel lido, nunca e parado.
  assert.deepEqual(stop({ roles: {}, sharing: ["p-host"] }), [], "sem papel lido, o vigia espera");
  assert.deepEqual(stop({ roles: { "p-eu": "participant" }, sharing: ["p-eu"] }), [], "a tela do proprio console nunca");
  assert.deepEqual(stop({ grants: ["p-ana"], roles: { "p-ana": "participant" }, sharing: ["p-ana"] }), [], "a liberada continua");
  assert.deepEqual(stop({ justGranted: ["p-ana"], roles: { "p-ana": "participant" }, sharing: ["p-ana"] }), [], "a recem liberada continua");
  assert.deepEqual(stop({ roles: { "p-ana": "participant" }, sharing: [] }), [], "ninguem compartilhando: ninguem");
  assert.deepEqual(stop({ roles: Object.create({ "p-ana": "participant" }), sharing: ["p-ana"] }), [], "papel herdado do prototipo nao conta como papel lido");
  assert.deepEqual(
    stop({ roles: { "p-ana": "participant", "p-bia": "participant", "p-co": "moderator" }, sharing: ["p-co", "p-ana", "p-host", "p-bia", "p-eu"] }),
    ["p-ana", "p-bia"],
    "na ordem de quem compartilha"
  );

  // O reducer e o vigia juntos: o co-apresentador que ja estava compartilha antes de o papel chegar.
  let state = event({ ...model.EMPTY_ROOM, selfId: "p-eu" }, "participantJoined", { displayName: "Co T.", id: "p-co" });
  state = event(state, "contentSharingParticipantsChanged", { data: ["p-co"] });
  const watch = (room) => model.screenSharesToStop({ grants: [], justGranted: [], roles: room.roles, selfId: room.selfId, sharing: room.sharing });
  assert.deepEqual(watch(state), [], "antes do getRoomsInfo, nada");
  state = model.liveRoomReducer(state, { info: { rooms: [{ isMainRoom: true, participants: [{ id: "p-co", role: "moderator" }, { id: "p-ana", role: "participant" }] }] }, type: "roomsInfo" });
  assert.deepEqual(watch(state), [], "o papel de moderador lido: a tela dele continua");
  state = event(state, "contentSharingParticipantsChanged", { data: ["p-co", "p-ana"] });
  assert.deepEqual(watch(state), ["p-ana"], "a aluna que compartilha sem liberacao");
});

test("vigia da tela: o getRoomsInfo e pedido so por quem compartilha sem papel lido, nunca pelo proprio console", () => {
  assert.deepEqual(model.rolesToRead({ roles: { "p-ana": "participant", "p-co": "moderator" }, selfId: "p-eu", sharing: ["p-ana", "p-host", "p-eu", "p-co", "p-novo"] }), ["p-host", "p-novo"]);
  assert.deepEqual(model.rolesToRead({ roles: {}, selfId: "p-eu", sharing: [] }), []);
  assert.deepEqual(model.rolesToRead({ roles: {}, selfId: "p-eu", sharing: ["p-eu"] }), [], "a tela do proprio console nao pede nada");
  assert.deepEqual(model.rolesToRead({ roles: {}, selfId: "p-eu", sharing: ["constructor"] }), ["constructor"], "nome de propriedade do objeto nao conta como papel lido");
  assert.equal(model.CONSOLE_ROOM_RULES.roomsInfoMs, 5_000, "no maximo uma vez a cada 5 s, como a sala do aluno");
});

test("reducer da sala: a equipe recolhe pelo moderationParticipantRejected (de outro console ou do motor): sem o microfone a pessoa sai de quem fala e do palco, sem a camera so do palco; a camera aprovada poe no palco", () => {
  let state = { ...model.EMPTY_ROOM, selfId: "p-eu" };
  state = model.liveRoomReducer(state, { id: "p-a", type: "release" });
  state = model.liveRoomReducer(state, { id: "p-b", on: true, type: "stage" });
  state = model.liveRoomReducer(state, { id: "p-b", type: "release" });
  assert.deepEqual([state.speaking, state.stage], [["p-a", "p-b"], ["p-b"]]);

  const semMicrofone = event(state, "moderationParticipantRejected", { id: "p-b", mediaType: "audio" });
  assert.deepEqual([semMicrofone.speaking, semMicrofone.stage], [["p-a"], []], "o microfone recolhido tira de quem fala e do palco");
  const semCamera = event(state, "moderationParticipantRejected", { id: "p-b", mediaType: "video" });
  assert.deepEqual([semCamera.speaking, semCamera.stage], [["p-a", "p-b"], []], "a camera recolhida tira so do palco");
  assert.deepEqual(event(state, "moderationParticipantRejected", { id: "p-a", mediaType: "audio" }).speaking, ["p-b"]);
  assert.equal(event(state, "moderationParticipantRejected", { id: "p-x", mediaType: "audio" }), state, "quem nao estava em nada: nada muda");
  assert.equal(event(state, "moderationParticipantRejected", { id: "p-a", mediaType: "desktop" }), state, "outro tipo: nada muda");
  assert.equal(event(state, "moderationParticipantRejected", { mediaType: "audio" }), state, "sem id: nada muda");

  // A camera aprovada (o Convidar ao palco de outro console): no palco, uma vez, e fora da fila de maos.
  let comMao = event(state, "raiseHandUpdated", { handRaised: NOW, id: "p-c" });
  comMao = event(comMao, "moderationParticipantApproved", { id: "p-c", mediaType: "video" });
  assert.deepEqual([comMao.stage, comMao.hands], [["p-b", "p-c"], []]);
  assert.deepEqual(event(comMao, "moderationParticipantApproved", { id: "p-c", mediaType: "video" }).stage, ["p-b", "p-c"], "a mesma pessoa nao entra duas vezes");
  assert.deepEqual(event(comMao, "moderationParticipantApproved", { id: "p-c", mediaType: "video" }).speaking, ["p-a", "p-b"], "a camera nao libera o microfone");
  assert.equal(event(state, "moderationParticipantApproved", { id: "p-eu", mediaType: "video" }), state, "o proprio console nunca entra na lista");
});

test("o ⋮ da miniatura do motor: so o Liberar e o Remover que o console pediu para avisar, com o id no formato do participante", () => {
  assert.deepEqual(model.participantMenuClickOf({ key: "ask-unmute", participantId: "p-ana", preventExecution: true }), { key: "ask-unmute", participantId: "p-ana" });
  assert.deepEqual(model.participantMenuClickOf({ key: "kick", participantId: "p-ana" }), { key: "kick", participantId: "p-ana" });
  assert.equal(model.participantMenuClickOf({ key: "mute", participantId: "p-ana" }), null, "um item que o console nao pediu");
  assert.equal(model.participantMenuClickOf({ key: "kick", participantId: "<b>" }), null, "id fora do formato");
  assert.equal(model.participantMenuClickOf({ key: "kick" }), null);
  assert.equal(model.participantMenuClickOf(null), null);
});
