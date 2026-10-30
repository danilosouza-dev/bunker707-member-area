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

test("ao virar moderador, o apresentador liga a moderacao de audio e de tela compartilhada; a de video so sem camera de aluno; seguir a visao so o Apresentador", () => {
  assert.deepEqual(model.presenterSetupCommands({ allowStudentCamera: true, role: "host" }), [
    ["toggleModeration", true, "audio"],
    ["toggleModeration", true, "desktop"],
    ["setFollowMe", true]
  ]);
  assert.deepEqual(model.presenterSetupCommands({ allowStudentCamera: false, role: "co_host" }), [
    ["toggleModeration", true, "audio"],
    ["toggleModeration", true, "desktop"],
    ["toggleModeration", true, "video"]
  ]);
  assert.deepEqual(model.presenterSetupCommands({ allowStudentCamera: true, role: "team" }), [], "a Equipe nao comanda a sala");
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
