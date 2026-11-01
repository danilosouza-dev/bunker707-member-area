// O console da equipe na Live ao vivo, a parte pura (docs/30 §1.4, §2.4, §2.6, §2.9, §6.4, §6.5, §6.7 e §8.1; fase 3):
// o retrato da sala que a rota de 5 s devolve (gravador, gravacao, quem foi removido, silenciado ou banido e o mapa
// aluno -> participante da sala), quem ve qual botao (Apresentador, co-apresentador, Equipe moderadora ou nao; quem
// publica), o que a sala de espera deve estar fazendo, a fila de maos levantadas e quem esta na sala pelos sinais do
// iframe do console (um reducer so, com os papeis tambem pelo getRoomsInfo), o vigia da tela (quem compartilha sem
// poder, docs/31 §5.4), quando o "Gravar" da fila dispara sozinho e quando a ancora e marcada (uma vez), o cartao
// Gravacao, o ponto do video na previa do "Alinhar chat" e os rotulos do silencio. Sem "server-only", imports
// relativos: tests/webinarios-console-ao-vivo-modelo.test.mjs carrega direto pelo Node. Nada aqui le o relogio: tudo
// recebe `nowMs`. As frases vem de WEBINAR_COPY; as que ainda faltam la ficam em LIVE_CONSOLE_COPY (pedido no
// relatorio da frente), conferidas pela PROIBIDAS_WEBINARIO no teste.

import { LOWER_HAND_SIGNAL, RECORDING_SIGNAL } from "../../lib/jitsi-room-config";
import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { saoPauloTime } from "../../lib/webinar-time";
import { desiredLobby, MUTE_MINUTES_OPTIONS, type LiveBanState, type MuteMinutes } from "./live-model";
import type { DisplayNameMode, SessionStatus } from "./model";
import { RECORDER_LABELS, canReleaseRecorder, canRequestRecorder, recorderMachineAlive, recorderPrepareStale, recordButtonAction, type RecorderStatus } from "./recorder-model";
import { anonymousNumber, displayNameFor, firstNameInitial } from "./room-model";

const copy = WEBINAR_COPY.consoleAoVivo;

/* ------------------------------------------------------------------------------------------------
 * Frases do console ao vivo (WEBINAR_COPY.consoleAoVivo; o nome do objeto ficou para os componentes e testes)
 * ---------------------------------------------------------------------------------------------- */

export const LIVE_CONSOLE_COPY = {
  acoes: copy.acoes,
  ajuste: copy.ajuste,
  biblioteca: copy.biblioteca,
  desfazer: copy.desfazer,
  desligarGravador: copy.desligarGravador,
  duracaoMinutos: copy.duracaoMinutos,
  enderecoPlayer: copy.enderecoPlayer,
  equipe: WEBINAR_COPY.sala.selos.equipe,
  gravacao: copy.gravacao,
  gravacaoNoNavegador: copy.gravacaoNoNavegador,
  mensagemDoChat: copy.mensagemDoChat,
  microfoneLiberado: copy.microfoneLiberado,
  microfoneSozinho: copy.microfoneSozinho,
  microfoneSozinhoTexto: copy.microfoneSozinhoTexto,
  naSala: copy.naSala,
  noPalco: WEBINAR_COPY.aoVivo.noPalco,
  noVideo: copy.noVideo,
  removidosESilenciados: copy.removidosESilenciados,
  salaAoVivo: WEBINAR_COPY.admin.tipos.live,
  semGravacao: copy.semGravacao,
  soOApresentador: copy.soOApresentador,
  soQuemPublica: copy.soQuemPublica,
  video: copy.video,
  voce: copy.voce
} as const;

/** As recusas das Server Actions da sala (live-actions.ts), em frases de tela (WEBINAR_COPY.consoleAoVivo.recusas). */
export const LIVE_ACTION_MESSAGES = copy.recusas;

/* ------------------------------------------------------------------------------------------------
 * O retrato da live (o que a rota de 5 s acrescenta ao do console)
 * ---------------------------------------------------------------------------------------------- */

/** Um aluno (ou alguem da equipe que escreveu) que a mesa pode silenciar, remover ou banir. */
export type LiveConsolePerson = {
  ban: LiveBanState;
  /** O nome da sala e do chat (primeiro nome + inicial, apelido ou "Aluno {n}"), nunca o e-mail. */
  displayName: string;
  /** Quando entrou na sala pela ultima vez (o ultimo webinar_room_joined). */
  joinedAt: string | null;
  /** O id do participante no iframe pelo ultimo webinar_room_joined (nulo: nao entrou ainda). */
  participantId: string | null;
  /** Da equipe (admin_roles, o Apresentador ou um co-apresentador): nunca removido, silenciado nem banido. */
  staff: boolean;
  userId: string;
};

export type LiveConsoleRecording = {
  anchorOffsetMs: number;
  bunnyLibraryId: string | null;
  bunnyVideoId: string | null;
  durationSeconds: number | null;
  embedUrl: string | null;
  errorMessage: string | null;
  id: string;
  /** O player da Bunny (com o token quando a biblioteca pede) para a previa do "Alinhar chat"; so com a gravacao pronta. */
  previewUrl: string | null;
  source: string;
  status: string;
};

export type LiveConsoleRecorder = {
  /** recording_anchor_at: a hora (do servidor) em que a gravacao comecou. */
  anchorAt: string | null;
  /** O pedido automatico da maquina existe neste ambiente (GITHUB_INFRA_TOKEN, ou o duble fora da producao). */
  dispatchConfigured: boolean;
  /** Quanto o arquivo do gravador comecou depois da ancora (ms), pelo carimbo do nome do arquivo. */
  driftMs: number | null;
  /** "Preparando a gravacao, {n} min": nulo sem medida ("em alguns minutos") ou fora do preparo. */
  estimateMinutes: number | null;
  fileStartedAt: string | null;
  recordingRequestedAt: string | null;
  releaseRequestedAt: string | null;
  requestedAt: string | null;
  status: RecorderStatus;
};

export type LiveConsoleSnapshot = {
  /** A sala ao vivo existe neste ambiente (WEBINAR_MEET_DOMAIN + WEBINAR_JWT_SECRET). */
  meetConfigured: boolean;
  people: LiveConsolePerson[];
  recorder: LiveConsoleRecorder;
  recording: LiveConsoleRecording | null;
  roomLocked: boolean;
};

/** Uma linha de webinar_room_joined (student_events) como a consulta devolve. */
export type RoomJoinedRow = { created_at: string; metadata: unknown; user_id: string | null };

const PARTICIPANT_ID = /^[0-9a-z-]{1,40}$/i;

/**
 * O participante mais novo de cada aluno nesta sessao (o ultimo webinar_room_joined com metadata.participant_id). O id
 * vem do navegador: quando o mesmo id aparece para duas contas (um aluno mandou o id de outro, que ele ve pelo iframe),
 * nenhuma das duas fica ligada a ele, e o console nao remove nem silencia ninguem por esse quadro (o servidor ja
 * descarta o id repetido ao gravar, live-room.recordRoomEvents; isto cobre as linhas de antes e a corrida).
 */
export function latestRoomJoins(rows: readonly RoomJoinedRow[]): Map<string, { joinedAt: string; participantId: string | null }> {
  const latest = new Map<string, { joinedAt: string; participantId: string | null }>();
  for (const row of rows) {
    if (!row.user_id) {
      continue;
    }
    const metadata = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
    const raw = metadata.participant_id;
    const participantId = typeof raw === "string" && PARTICIPANT_ID.test(raw) ? raw : null;
    const current = latest.get(row.user_id);
    if (!current || Date.parse(row.created_at) > Date.parse(current.joinedAt)) {
      latest.set(row.user_id, { joinedAt: row.created_at, participantId });
    }
  }
  const owners = new Map<string, number>();
  for (const entry of latest.values()) {
    if (entry.participantId) {
      owners.set(entry.participantId, (owners.get(entry.participantId) ?? 0) + 1);
    }
  }
  for (const [userId, entry] of latest) {
    if (entry.participantId && (owners.get(entry.participantId) ?? 0) > 1) {
      latest.set(userId, { ...entry, participantId: null });
    }
  }
  return latest;
}

/**
 * O nome que a sala mostra para o aluno (o mesmo do token, live-room.liveTokenName): com o aceite do chat, o modo que
 * ele escolheu; sem o aceite, primeiro nome + inicial, ou "Aluno {n}" quando o card Sala manda sempre anonimo.
 */
export function liveParticipantName(input: {
  consent: { displayMode: string | null; nickname: string | null } | null;
  fullName: string | null;
  roomDisplayName: DisplayNameMode;
  userId: string;
  webinarId: string;
}): string {
  const number = anonymousNumber(input.userId, input.webinarId);
  const chosen = input.consent?.displayMode;
  if (input.consent && (chosen === "anonymous" || chosen === "nickname" || chosen === "first_name_initial")) {
    return displayNameFor({ anonymousNumber: number, fullName: input.fullName, mode: chosen, nickname: input.consent.nickname });
  }
  if (input.consent) {
    return displayNameFor({ anonymousNumber: number, fullName: input.fullName, mode: input.roomDisplayName, nickname: input.consent.nickname });
  }
  const mode = input.roomDisplayName === "anonymous" ? "anonymous" : "first_name_initial";
  return displayNameFor({ anonymousNumber: number, fullName: input.fullName, mode, nickname: null });
}

/** O nome da equipe na lista (primeiro nome + inicial; "Equipe" sem nome). */
export function staffDisplayName(fullName: string | null): string {
  return fullName?.trim() ? firstNameInitial(fullName) : LIVE_CONSOLE_COPY.equipe;
}

/** A lista da mesa: quem esta na sala, quem foi barrado e quem escreveu, os barrados primeiro, depois por nome. */
export function sortLivePeople<T extends Pick<LiveConsolePerson, "ban" | "displayName">>(people: readonly T[]): T[] {
  const barred = (person: T) => (person.ban.banned || person.ban.kicked || person.ban.muted ? 0 : 1);
  return [...people].sort((a, b) => barred(a) - barred(b) || a.displayName.localeCompare(b.displayName, "pt-BR"));
}

/* ------------------------------------------------------------------------------------------------
 * Quem ve o que (docs/30 §1.4 "Quem faz o que", §2.6, §2.9 e §5.4)
 * ---------------------------------------------------------------------------------------------- */

export type ConsoleRoomRole = "co_host" | "host" | "team";

/**
 * O papel do console na sala: o que o join-token devolveu (decidido no servidor); antes dele (ou sem a sala neste
 * ambiente), o Apresentador do card Dados e "host" e o resto "team". Aluno nunca abre o console.
 */
export function consoleRoomRole(input: { currentUserId: string; hostUserId: string | null; tokenRole: string | null | undefined }): ConsoleRoomRole {
  if (input.tokenRole === "host" || input.tokenRole === "co_host" || input.tokenRole === "team") {
    return input.tokenRole;
  }
  return input.hostUserId !== null && input.hostUserId === input.currentUserId ? "host" : "team";
}

export type LiveControls = {
  /** Sala de espera: Admitir / Admitir todos. */
  admit: boolean;
  /** Banir de todos os webinarios: aparece para quem nao e co-apresentador; so liga com messaging.publish. */
  ban: boolean;
  banEnabled: boolean;
  /** Fechar camera, Fechar todas as cameras, Permitir cameras dos alunos. */
  cameras: boolean;
  /** Silenciar no chat 5/15/60/ate o fim e Desfazer: toda a Equipe (messaging.write). */
  chatMute: boolean;
  /** Abaixar a mao, Abaixar todas as maos, Pular: toda a Equipe. */
  hands: boolean;
  /** Remover da sala: Apresentador, co-apresentador e Equipe moderadora. */
  kick: boolean;
  /** Trancar / Destrancar a sala. */
  lock: boolean;
  /** Silenciar todos: Apresentador, co-apresentador e Equipe moderadora. */
  muteAll: boolean;
  /** Gravar / Parar gravacao / Gravar no navegador: so o Apresentador (o token dele tem a gravacao). */
  record: boolean;
  /** Liberar (pedir para abrir o microfone) e Silenciar quem esta falando. */
  release: boolean;
  /** Abrir a sala, Comecar para todos, Encerrar live, Preparar gravacao, Enviar gravacao: o Apresentador ou a Equipe que publica (nunca o co-apresentador, §1.4). */
  session: boolean;
  sessionEnabled: boolean;
  /** Destacar / Tirar destaque, Convidar ao palco / Tirar do palco. */
  stage: boolean;
};

/**
 * Os botoes de cada papel (docs/30 §1.4 e §2.9). `moderator` e o que a sala confirmou (participantRoleChanged do
 * proprio console): a Equipe so silencia todos e remove quando marcada como moderadora da sala no editor. Quem nao tem
 * messaging.publish ve os botoes de publicar desligados com a explicacao; o servidor confere de qualquer jeito.
 */
export function liveControlsFor(input: { canPublish: boolean; moderator: boolean; role: ConsoleRoomRole }): LiveControls {
  const presenter = input.role === "host" || input.role === "co_host";
  const roomModerator = presenter || input.moderator;
  const session = input.role === "host" || input.role === "team";
  return {
    admit: presenter,
    ban: input.role !== "co_host",
    banEnabled: input.role !== "co_host" && input.canPublish,
    cameras: presenter,
    chatMute: true,
    hands: true,
    kick: roomModerator,
    lock: presenter,
    muteAll: roomModerator,
    record: input.role === "host",
    release: presenter,
    session,
    sessionEnabled: session && input.canPublish,
    stage: presenter
  };
}

/**
 * O que o navegador do Apresentador (ou do co-apresentador) manda a sala ao virar moderador, na ordem: a moderacao de
 * audio (o aluno so fala depois de Liberar), a de video quando o webinario nao tem camera de aluno e, so o
 * Apresentador, seguir a visao dele. Nada de moderacao de tela: na tag fixada o 'toggle-moderation' do IFrame API so
 * distingue `video` e qualquer outro valor liga a de audio (modules/API/API.js), entao a de tela nao liga por aqui. A
 * tela e decidida pela liberacao (docs/31 §5.3). O vigia do console para a tela do cliente padrao, que obedece ao
 * pedido de mudo; um cliente modificado que ignora o pedido continua mandando a tela, porque sem a moderacao de tela o
 * servidor so repassa o pedido (video-menu/actions.any.ts; docs/30 §8.1).
 */
export function presenterSetupCommands(input: { allowStudentCamera: boolean; role: ConsoleRoomRole }): [string, ...unknown[]][] {
  if (input.role !== "host" && input.role !== "co_host") {
    return [];
  }
  const commands: [string, ...unknown[]][] = [["toggleModeration", true, "audio"]];
  if (!input.allowStudentCamera) {
    commands.push(["toggleModeration", true, "video"]);
  }
  if (input.role === "host") {
    commands.push(["setFollowMe", true]);
  }
  return commands;
}

/** Os botoes de situacao da live no topo: Abrir a sala (agendada), Comecar para todos (agendada ou na espera), Encerrar live (na espera ou no ar). */
export function liveSessionButtons(status: SessionStatus): { end: boolean; open: boolean; start: boolean } {
  return { end: status === "waiting" || status === "live", open: status === "scheduled", start: status === "scheduled" || status === "waiting" };
}

/** O console entra sozinho na sala com ela aberta (na espera ou no ar); agendada, so por "Testar sala" (Sessao de pratica). */
export function shouldEnterRoom(input: { meetConfigured: boolean; status: SessionStatus; testing: boolean }): boolean {
  if (!input.meetConfigured) {
    return false;
  }
  if (input.status === "waiting" || input.status === "live") {
    return true;
  }
  return input.status === "scheduled" && input.testing;
}

/** A sala de espera da sala (o comando toggleLobby): live-model.desiredLobby, a mesma regra que a sala do aluno le. */
export { desiredLobby };

/** A frase do estado da sala para a mesa. */
export function lobbyNotice(input: { lobby: boolean; roomLocked: boolean; status: SessionStatus }): string | null {
  if (input.roomLocked) {
    return copy.salaTrancada;
  }
  if (input.status === "scheduled" || input.status === "waiting") {
    return input.lobby ? copy.sessaoDePratica : copy.abrirSalaTexto;
  }
  return input.lobby ? copy.salaDeEsperaLigada : null;
}

/* ------------------------------------------------------------------------------------------------
 * A sala pelos sinais do iframe do console (quem esta, maos, sala de espera, palco, gravacao)
 * ---------------------------------------------------------------------------------------------- */

export type JitsiRole = "moderator" | "none" | "participant";

export type RoomPerson = { id: string; name: string };
export type RaisedHand = { id: string; raisedAt: number };
export type KnockingPerson = { id: string; name: string };

export type LiveRoomState = {
  /**
   * A coluna de miniaturas do iframe na tela (o ultimo filmstripDisplayChanged): visivel ao entrar, como o motor comeca.
   * O palco do console desconta a coluna nos selos de cima a direita (stageColumnShown) e, no co-apresentador e na
   * Equipe, decide o toggleFilmStrip pela largura (consoleColumnPolicy, docs/31 V2-A5).
   */
  filmstripVisible: boolean;
  hands: RaisedHand[];
  knocking: KnockingPerson[];
  /** O proprio console e moderador na sala (participantRoleChanged do proprio id). */
  moderator: boolean;
  /**
   * Quem esta no video grande (o largeVideoChanged chega sem dados: o console le o id do IFrame API, onStageParticipantOf,
   * e manda a acao `onStage`); a tela compartilhada vem como `<id>-v1`. Nulo: o motor ainda nao disse.
   */
  onStageId: string | null;
  people: RoomPerson[];
  recording: { mode: string | null; on: boolean };
  /**
   * O papel de cada um na sala: o participantRoleChanged (pode chegar antes ou depois do participantJoined) e o
   * getRoomsInfo (quem ja era moderador quando o console entrou nunca gera participantRoleChanged: applyConsoleRoomsInfo).
   */
  roles: Record<string, JitsiRole>;
  selfId: string | null;
  /** Quem compartilha a tela agora (contentSharingParticipantsChanged: os donos das faixas de tela nao mudas). */
  sharing: string[];
  /** Quem esta com o microfone liberado (Liberar), na ordem. */
  speaking: string[];
  spotlight: string | null;
  /** Quem foi convidado ao palco (microfone e camera liberados). */
  stage: string[];
  /** O que o motor mostra (o ultimo tileViewChanged): o Palco ou a Grade, a mudanca de quem apresenta ou o seguir a visao. */
  viewShown: "grid" | "stage";
};

export const EMPTY_ROOM: LiveRoomState = {
  filmstripVisible: true,
  hands: [],
  knocking: [],
  moderator: false,
  onStageId: null,
  people: [],
  recording: { mode: null, on: false },
  roles: {},
  selfId: null,
  sharing: [],
  speaking: [],
  spotlight: null,
  stage: [],
  viewShown: "stage"
};

/** O getRoomsInfo do iframe (os papeis de quem ja estava na sala) no maximo uma vez neste intervalo, como a sala do aluno. */
export const CONSOLE_ROOM_RULES = { roomsInfoMs: 5_000 } as const;

/** O teto de ids lidos de um contentSharingParticipantsChanged (a sala nunca tem tantas telas ao mesmo tempo). */
const SHARING_LIMIT = 50;

export type LiveRoomAction =
  | { name: string; nowMs: number; payload: unknown; type: "event" }
  | { people: readonly unknown[]; type: "seed" }
  | { info: unknown; type: "roomsInfo" }
  | { id: string; type: "lowerHand" | "skipHand" | "release" | "silence" | "admit" | "kicked" }
  | { type: "lowerAll" | "admitAll" | "reset" }
  | { id: string; on: boolean; type: "stage" }
  | { id: string | null; type: "spotlight" }
  /** Quem esta no video grande, lido do IFrame API no largeVideoChanged (onStageParticipantOf). */
  | { id: string | null; type: "onStage" }
  /** O primeiro sinal de um iframe novo: o motor dele comeca no Palco, com a coluna e sem ninguem lido no video grande. */
  | { type: "frame" };

function field(payload: unknown, key: string): unknown {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : null;
}

function idOf(payload: unknown): string | null {
  const id = field(payload, "id") ?? field(payload, "participantId");
  return typeof id === "string" && PARTICIPANT_ID.test(id) ? id : null;
}

function roleOf(value: unknown): JitsiRole | null {
  return value === "moderator" || value === "participant" || value === "none" ? value : null;
}

/** A mao levantada do sinal: o raiseHandUpdated manda `handRaised` como a hora (ms) em que levantou, 0 ao abaixar. */
export function raisedAtOf(payload: unknown, nowMs: number): number | null {
  const raised = field(payload, "handRaised");
  if (raised === true) {
    return nowMs;
  }
  if (typeof raised === "number" && raised > 0) {
    return raised > 1e12 ? raised : nowMs;
  }
  return null;
}

function withoutId(state: LiveRoomState, id: string): LiveRoomState {
  const roles = { ...state.roles };
  delete roles[id];
  return {
    ...state,
    hands: state.hands.filter((hand) => hand.id !== id),
    knocking: state.knocking.filter((person) => person.id !== id),
    people: state.people.filter((person) => person.id !== id),
    roles,
    sharing: state.sharing.filter((other) => other !== id),
    speaking: state.speaking.filter((other) => other !== id),
    spotlight: state.spotlight === id ? null : state.spotlight,
    stage: state.stage.filter((other) => other !== id)
  };
}

function upsertPerson(people: readonly RoomPerson[], person: RoomPerson): RoomPerson[] {
  const index = people.findIndex((other) => other.id === person.id);
  if (index < 0) {
    return [...people, person];
  }
  const next = [...people];
  next[index] = { ...next[index], name: person.name || next[index].name };
  return next;
}

function insertHand(hands: readonly RaisedHand[], hand: RaisedHand): RaisedHand[] {
  if (hands.some((other) => other.id === hand.id)) {
    return [...hands];
  }
  const index = hands.findIndex((other) => other.raisedAt > hand.raisedAt);
  return index < 0 ? [...hands, hand] : [...hands.slice(0, index), hand, ...hands.slice(index)];
}

function onEvent(state: LiveRoomState, name: string, payload: unknown, nowMs: number): LiveRoomState {
  const id = idOf(payload);
  switch (name) {
    case "videoConferenceJoined":
      // Quem ja estava pode ter chegado (participantJoined) antes deste sinal: fica; so o proprio console sai da lista.
      return id ? { ...withoutId(state, id), selfId: id } : state;
    case "videoConferenceLeft":
    case "readyToClose":
      // A visao e a coluna ficam, como na sala do aluno: o mesmo iframe pode voltar sozinho, com o motor como estava
      // (fora do iframe o palco nao conta a coluna, stageColumnShown). Um iframe novo volta ao padrao pela acao `frame`.
      return { ...EMPTY_ROOM, filmstripVisible: state.filmstripVisible, viewShown: state.viewShown };
    case "participantJoined":
      if (!id || id === state.selfId) {
        return state;
      }
      return {
        ...state,
        knocking: state.knocking.filter((person) => person.id !== id),
        people: upsertPerson(state.people, { id, name: text(field(payload, "displayName")) ?? text(field(payload, "formattedDisplayName")) ?? "" })
      };
    case "participantLeft":
      return id ? withoutId(state, id) : state;
    case "participantRoleChanged": {
      const role = roleOf(field(payload, "role"));
      if (!id || !role) {
        return state;
      }
      if (id === state.selfId) {
        return { ...state, moderator: role === "moderator" };
      }
      return { ...state, roles: { ...state.roles, [id]: role } };
    }
    case "raiseHandUpdated": {
      if (!id || id === state.selfId) {
        return state;
      }
      const raisedAt = raisedAtOf(payload, nowMs);
      return raisedAt === null ? { ...state, hands: state.hands.filter((hand) => hand.id !== id) } : { ...state, hands: insertHand(state.hands, { id, raisedAt }) };
    }
    case "knockingParticipant": {
      const participant = field(payload, "participant") ?? payload;
      const knockId = idOf(participant);
      if (!knockId || state.knocking.some((person) => person.id === knockId)) {
        return state;
      }
      return { ...state, knocking: [...state.knocking, { id: knockId, name: text(field(participant, "name")) ?? text(field(participant, "displayName")) ?? "" }] };
    }
    case "moderationParticipantApproved": {
      const mediaType = field(payload, "mediaType");
      if (!id || id === state.selfId) {
        return state;
      }
      // A camera aprovada (o Convidar ao palco de outro console, ou o Permitir câmera do proprio motor): no palco.
      if (mediaType === "video") {
        return state.stage.includes(id) ? state : { ...state, hands: state.hands.filter((hand) => hand.id !== id), stage: [...state.stage, id] };
      }
      if (mediaType !== "audio" || state.speaking.includes(id)) {
        return state;
      }
      return { ...state, hands: state.hands.filter((hand) => hand.id !== id), speaking: [...state.speaking, id] };
    }
    case "moderationParticipantRejected": {
      // A equipe recolheu (o Silenciar, o Tirar do palco e o Silenciar todos de qualquer console, ou o motor): sem o
      // microfone, a pessoa sai de quem fala e do palco; sem a camera, so do palco.
      const mediaType = field(payload, "mediaType");
      if (!id || (mediaType !== "audio" && mediaType !== "video")) {
        return state;
      }
      const stage = state.stage.filter((other) => other !== id);
      const speaking = mediaType === "audio" ? state.speaking.filter((other) => other !== id) : state.speaking;
      return stage.length === state.stage.length && speaking.length === state.speaking.length ? state : { ...state, speaking, stage };
    }
    case "recordingStatusChanged": {
      const mode = text(field(payload, "mode"));
      return { ...state, recording: { mode, on: field(payload, "on") === true } };
    }
    case "contentSharingParticipantsChanged":
      return { ...state, sharing: sharingIdsOf(payload) };
    case "tileViewChanged": {
      const enabled = field(payload, "enabled");
      return typeof enabled === "boolean" ? { ...state, viewShown: enabled ? "grid" : "stage" } : state;
    }
    case "filmstripDisplayChanged": {
      const visible = field(payload, "visible");
      return typeof visible === "boolean" ? { ...state, filmstripVisible: visible } : state;
    }
    default:
      return state;
  }
}

/**
 * Os ids de quem compartilha a tela no contentSharingParticipantsChanged ({ data: string[] }): so os ids no formato do
 * participante, sem repetir, ate SHARING_LIMIT. Payload fora do formato vira a lista vazia.
 */
export function sharingIdsOf(payload: unknown): string[] {
  const data = field(payload, "data");
  if (!Array.isArray(data)) {
    return [];
  }
  const ids: string[] = [];
  for (const raw of data) {
    if (ids.length >= SHARING_LIMIT) {
      break;
    }
    if (typeof raw === "string" && PARTICIPANT_ID.test(raw) && !ids.includes(raw)) {
      ids.push(raw);
    }
  }
  return ids;
}

/**
 * Os papeis pelo getRoomsInfo() do IFrame API ({ rooms: [{ isMainRoom, participants: [{ id, role, displayName }] }] }):
 * quem ja era moderador quando o console entrou so aparece ali (o participantJoined nao traz o papel, e o
 * participantRoleChanged so sai na troca). Le a sala principal (ou a primeira), grava o papel de cada um com id valido e
 * papel conhecido e poe em `people` quem ainda nao esta, com o nome. O proprio console fica fora: o papel dele continua
 * pelo participantRoleChanged, que sai para o papel local. Um participantRoleChanged depois da resposta vence, porque
 * chega depois (o iframe responde e avisa na ordem). Fora da sala (sem `selfId`: antes do videoConferenceJoined ou
 * depois da saida) a resposta nao muda nada: ela traz o proprio console, que sem o id viraria uma linha a mais e ficaria
 * depois de entrar de novo com outro id.
 */
export function applyConsoleRoomsInfo(state: LiveRoomState, info: unknown): LiveRoomState {
  if (state.selfId === null) {
    return state;
  }
  const rooms = field(info, "rooms");
  if (!Array.isArray(rooms)) {
    return state;
  }
  const main = rooms.find((room) => field(room, "isMainRoom") === true) ?? rooms[0];
  const participants = field(main, "participants");
  if (!Array.isArray(participants)) {
    return state;
  }
  let people = state.people;
  const roles = { ...state.roles };
  for (const participant of participants) {
    const id = field(participant, "id");
    if (typeof id !== "string" || !PARTICIPANT_ID.test(id) || id === state.selfId) {
      continue;
    }
    const role = roleOf(field(participant, "role"));
    if (role) {
      roles[id] = role;
    }
    if (!people.some((person) => person.id === id)) {
      people = [...people, { id, name: text(field(participant, "displayName")) ?? "" }];
    }
  }
  return { ...state, people, roles };
}

/** Quem tem papel conhecido de nao moderador na sala (participante ou sem papel); um id sem papel lido nunca entra. */
function knownNonModerator(roles: Readonly<Record<string, JitsiRole>>, id: string): boolean {
  const role = Object.hasOwn(roles, id) ? roles[id] : undefined;
  return role === "participant" || role === "none";
}

/**
 * O vigia da tela (docs/31 §5.4): quem o console de quem apresenta para com muteRemoteParticipant(id, 'desktop'). Sao
 * os ids de `sharing` que nao sao o proprio console, com papel CONHECIDO de nao moderador (`roles` "participant" ou
 * "none") e sem liberacao (`grants`, e `justGranted` para a liberacao que acabou de sair e o retrato ainda nao trouxe).
 * Um id sem papel nunca sai: quem ja era moderador quando o console entrou so tem o papel depois do getRoomsInfo, e
 * parar a tela dele seria parar a do proprio Apresentador. O vigia para o cliente padrao, que obedece ao pedido de mudo;
 * um cliente modificado que ignora o pedido continua mandando a tela (docs/31 §7).
 */
export function screenSharesToStop(input: {
  grants: readonly string[];
  justGranted: readonly string[];
  roles: Readonly<Record<string, JitsiRole>>;
  selfId: string | null;
  sharing: readonly string[];
}): string[] {
  return input.sharing.filter((id) => id !== input.selfId && knownNonModerator(input.roles, id) && !input.grants.includes(id) && !input.justGranted.includes(id));
}

/** O item do ⋮ da miniatura que o motor avisou (participantMenuButtonClick { key, participantId, preventExecution }). */
export type ParticipantMenuClick = { key: "ask-unmute" | "kick"; participantId: string };

/**
 * O participantMenuButtonClick do motor como o console o le: so os dois itens que o console pediu para avisar
 * (CONSOLE_PARTICIPANT_MENU_BUTTONS, o Liberar e o Remover) e o id no formato do participante; o resto vira nulo.
 */
export function participantMenuClickOf(payload: unknown): ParticipantMenuClick | null {
  const key = field(payload, "key");
  const participantId = field(payload, "participantId");
  if ((key !== "ask-unmute" && key !== "kick") || typeof participantId !== "string" || !PARTICIPANT_ID.test(participantId)) {
    return null;
  }
  return { key, participantId };
}

/**
 * O Remover do ⋮ da miniatura do motor no console (docs/31 V2-14 e V2-A29; o motor so avisa, preventExecution):
 * - "staff": quem e da equipe (`staff`) ou modera a sala (o papel "moderator") nunca sai, como no nosso Remover;
 * - "ours": o aluno ligado a linha (`person`, pelo ultimo webinar_room_joined) sai pelo nosso Remover, que grava
 *   webinar_session_bans antes do kickParticipant (sem o registro ele voltaria com um token novo);
 * - "engine": sem o aluno ligado (ainda sem webinar_room_joined, ou o mesmo id para duas contas) e com o papel
 *   conhecido de participante, o kickParticipant do motor na hora: tirar ja quem atrapalha vale mais que esperar o
 *   retrato, e a tela avisa que a pessoa pode voltar;
 * - "unknown": sem o papel lido, nada sai (pode ser alguem que ja moderava quando o console entrou); o console le os
 *   papeis de novo (getRoomsInfo) e pede para tentar de novo.
 */
export function menuKickPlan(input: { person: LiveConsolePerson | null; role: JitsiRole | null | undefined; staff: boolean }): "engine" | "ours" | "staff" | "unknown" {
  if (input.staff || input.role === "moderator") {
    return "staff";
  }
  if (input.person) {
    return "ours";
  }
  return input.role === "participant" || input.role === "none" ? "engine" : "unknown";
}

/** Os ids de `sharing` sem papel lido (fora o proprio console): o console pede o getRoomsInfo para conhece-los. */
export function rolesToRead(input: { roles: Readonly<Record<string, JitsiRole>>; selfId: string | null; sharing: readonly string[] }): string[] {
  return input.sharing.filter((id) => id !== input.selfId && !Object.hasOwn(input.roles, id));
}

/** Um reducer so para tudo o que a mesa sabe da sala pelo iframe e pelos proprios cliques. */
export function liveRoomReducer(state: LiveRoomState, action: LiveRoomAction): LiveRoomState {
  switch (action.type) {
    case "event":
      return onEvent(state, action.name, action.payload, action.nowMs);
    case "roomsInfo":
      return applyConsoleRoomsInfo(state, action.info);
    case "seed": {
      let people = state.people;
      for (const raw of action.people) {
        const id = idOf(raw);
        if (id && id !== state.selfId) {
          people = upsertPerson(people, { id, name: text(field(raw, "displayName")) ?? text(field(raw, "formattedDisplayName")) ?? "" });
        }
      }
      return { ...state, people };
    }
    case "lowerHand":
      return { ...state, hands: state.hands.filter((hand) => hand.id !== action.id) };
    case "skipHand": {
      const hand = state.hands.find((other) => other.id === action.id);
      if (!hand) {
        return state;
      }
      // Pular: vai para o fim da fila (a hora vira a do ultimo + 1, para uma mao nova continuar entrando depois).
      const last = state.hands.reduce((max, other) => Math.max(max, other.raisedAt), 0);
      return { ...state, hands: [...state.hands.filter((other) => other.id !== action.id), { id: hand.id, raisedAt: last + 1 }] };
    }
    case "lowerAll":
      return { ...state, hands: [] };
    case "release":
      return { ...state, hands: state.hands.filter((hand) => hand.id !== action.id), speaking: state.speaking.includes(action.id) ? state.speaking : [...state.speaking, action.id] };
    case "silence":
      return { ...state, speaking: state.speaking.filter((id) => id !== action.id) };
    case "admit":
      return { ...state, knocking: state.knocking.filter((person) => person.id !== action.id) };
    case "admitAll":
      return { ...state, knocking: [] };
    case "kicked":
      return withoutId(state, action.id);
    case "stage":
      return action.on
        ? { ...state, hands: state.hands.filter((hand) => hand.id !== action.id), stage: state.stage.includes(action.id) ? state.stage : [...state.stage, action.id] }
        : { ...state, speaking: state.speaking.filter((id) => id !== action.id), spotlight: state.spotlight === action.id ? null : state.spotlight, stage: state.stage.filter((id) => id !== action.id) };
    case "spotlight":
      return { ...state, spotlight: action.id };
    case "onStage":
      return { ...state, onStageId: typeof action.id === "string" && PARTICIPANT_ID.test(action.id) ? action.id : null };
    case "frame":
      return { ...state, filmstripVisible: EMPTY_ROOM.filmstripVisible, onStageId: null, viewShown: EMPTY_ROOM.viewShown };
    case "reset":
      return EMPTY_ROOM;
    default:
      return state;
  }
}

/**
 * O toggleFilmStrip que espera a resposta do motor no console do co-apresentador e da Equipe (a coluna pela largura,
 * consoleColumnPolicy "width"): o `filmstripVisible` de quando ele saiu, ou nulo com nenhum esperando.
 */
export type ConsoleFilmstripPending = boolean | null;

/**
 * Manda o toggleFilmStrip agora? So quando o palco quer outra coisa que o motor mostra (`wanted` diferente de `visible`,
 * o filmstripStep da sala do aluno) e nenhum espera a resposta a este mesmo estado: o comando inverte a coluna, e dois
 * seguidos a deixariam como estava.
 */
export function consoleFilmstripShouldToggle(input: { pending: ConsoleFilmstripPending; visible: boolean; wanted: boolean }): boolean {
  return input.wanted !== input.visible && input.pending !== input.visible;
}

/**
 * O pedido que espera depois de um sinal do iframe, como na sala do aluno (use-live-room.ts): o filmstripDisplayChanged
 * (a resposta do motor, ou a coluna que mudou por outra causa, como o seguir a visao de quem apresenta ou o atalho F
 * dentro do iframe), a entrada (videoConferenceJoined) e o primeiro sinal de um iframe novo soltam o pedido, e a conta
 * da coluna pode mandar o proximo. Sem isso, a coluna que volta depois da resposta ficaria por cima do iframe estreito
 * enquanto ele vivesse. Os outros sinais deixam o pedido como esta.
 */
export function consoleFilmstripPendingAfter(input: { name: string; newFrame: boolean; pending: ConsoleFilmstripPending }): ConsoleFilmstripPending {
  return input.newFrame || input.name === "filmstripDisplayChanged" || input.name === "videoConferenceJoined" ? null : input.pending;
}

/** O sinal que o console manda (sendEndpointTextMessage) para o aluno abaixar a propria mao: o IFrame API nao abaixa a mao de outro. */
export { LOWER_HAND_SIGNAL, RECORDING_SIGNAL };

/**
 * A reserva "Gravar no navegador" ligou ou desligou (recordingStatusChanged com mode `local` no console do
 * Apresentador): `true` / `false` para gravar na sessao (setBrowserRecording) e avisar a sala (recordingSignalMessage);
 * nulo para a gravacao do gravador (mode `file`, que ja chega a todos) ou fora do Apresentador.
 */
export function browserRecordingChange(input: { payload: unknown; role: ConsoleRoomRole }): boolean | null {
  if (input.role !== "host" || field(input.payload, "mode") !== "local") {
    return null;
  }
  return field(input.payload, "on") === true;
}

/** O texto do sinal RECORDING_SIGNAL para todos (sendEndpointTextMessage com o destino vazio). */
export function recordingSignalMessage(on: boolean): string {
  return JSON.stringify({ on, type: RECORDING_SIGNAL });
}

export function lowerHandMessage(): string {
  return JSON.stringify({ type: LOWER_HAND_SIGNAL });
}

/* ------------------------------------------------------------------------------------------------
 * As linhas da mesa (sala + retrato)
 * ---------------------------------------------------------------------------------------------- */

export type RoomRow = {
  /** Da equipe: moderador na sala, o proprio console ou marcado no retrato. */
  staff: boolean;
  id: string;
  name: string;
  onStage: boolean;
  person: LiveConsolePerson | null;
  spotlight: boolean;
};

/** Quem esta na sala agora, com o aluno do retrato quando o id do participante bate (para remover, silenciar e banir). */
export function roomRows(state: LiveRoomState, people: readonly LiveConsolePerson[]): RoomRow[] {
  const byParticipant = new Map(people.filter((person) => person.participantId).map((person) => [person.participantId as string, person]));
  return state.people.map((entry) => {
    const person = byParticipant.get(entry.id) ?? null;
    return {
      id: entry.id,
      name: person?.displayName ?? (entry.name || LIVE_CONSOLE_COPY.equipe),
      onStage: state.stage.includes(entry.id),
      person,
      spotlight: state.spotlight === entry.id,
      staff: state.roles[entry.id] === "moderator" || person?.staff === true
    };
  });
}

/** A fila de maos com o nome de cada um (o da sala, ou o do aluno no retrato). */
export function handRows(state: LiveRoomState, people: readonly LiveConsolePerson[]): { id: string; name: string; person: LiveConsolePerson | null }[] {
  const rows = roomRows(state, people);
  return state.hands.map((hand) => {
    const row = rows.find((other) => other.id === hand.id);
    return { id: hand.id, name: row?.name ?? LIVE_CONSOLE_COPY.equipe, person: row?.person ?? null };
  });
}

/** Os barrados da sessao (removidos, silenciados, banidos), para Desfazer. */
export function barredPeople(people: readonly LiveConsolePerson[]): LiveConsolePerson[] {
  return sortLivePeople(people.filter((person) => person.ban.banned || person.ban.kicked || person.ban.muted));
}

/* ------------------------------------------------------------------------------------------------
 * Silencio no chat
 * ---------------------------------------------------------------------------------------------- */

export const MUTE_CHOICES: readonly { label: string; minutes: MuteMinutes | null }[] = [
  ...MUTE_MINUTES_OPTIONS.map((minutes) => ({ label: copy.silenciarNoChat[minutes], minutes })),
  { label: copy.silenciarNoChat.fim, minutes: null }
];

/** "Sem escrever ate 20:15" (Sao Paulo) ou "Sem escrever ate o fim"; nulo sem silencio. */
export function muteLabel(ban: Pick<LiveBanState, "muted" | "mutedUntil">): string | null {
  if (!ban.muted) {
    return null;
  }
  return ban.mutedUntil ? copy.silenciado(saoPauloTime(ban.mutedUntil)) : copy.silenciadoAteOFim;
}

/** O que a mesa mostra ao lado do nome: banido, removido, silenciado ate as HH:MM (Sao Paulo) ou ate o fim. */
export function banLabels(ban: LiveBanState): string[] {
  const labels: string[] = [];
  if (ban.banned) {
    labels.push(copy.banido);
  }
  if (ban.kicked) {
    labels.push(copy.removido);
  }
  const muted = muteLabel(ban);
  if (muted) {
    labels.push(muted);
  }
  return labels;
}

/* ------------------------------------------------------------------------------------------------
 * O gravador e a ancora (docs/30 §6.4 passo 7, §6.5 e §6.7)
 * ---------------------------------------------------------------------------------------------- */

/**
 * O "Gravar" que ficou na fila (recording_requested_at) dispara sozinho no navegador do Apresentador quando a maquina
 * fica pronta: uma vez por pedido (`firedFor` guarda o pedido ja disparado), com o console dentro da sala e sem
 * gravacao rodando.
 */
export function shouldAutoStartRecording(input: {
  firedFor: string | null;
  joined: boolean;
  recorderStatus: RecorderStatus;
  recording: boolean;
  recordingRequestedAt: string | null;
  role: ConsoleRoomRole;
}): boolean {
  return (
    input.role === "host" &&
    input.joined &&
    !input.recording &&
    input.recorderStatus === "ready" &&
    input.recordingRequestedAt !== null &&
    input.firedFor !== input.recordingRequestedAt
  );
}

/**
 * A ancora (markRecordingAnchor) sai do navegador do Apresentador quando o iframe dele avisa a gravacao ligada
 * (recordingStatusChanged on); uma vez por sessao, e nunca quando o retrato ja tem a ancora.
 */
export function shouldMarkAnchor(input: { alreadyMarked: boolean; anchorAt: string | null; payload: unknown; role: ConsoleRoomRole }): boolean {
  return input.role === "host" && !input.alreadyMarked && input.anchorAt === null && field(input.payload, "on") === true;
}

export type RecorderCardAction = "prepare" | "queued" | "record" | "recording" | "release" | "none";

export type RecorderCard = {
  /** O botao principal do cartao. */
  action: RecorderCardAction;
  /** O rotulo da situacao (os nomes do card Gravacao). */
  label: string;
  /** A frase de apoio (preparando, pronta, sem gravador...). */
  note: string | null;
  /** Mostra a reserva: Gravar no navegador e Enviar gravacao (sem maquina hoje ou sem o pedido automatico). */
  fallback: boolean;
};

/**
 * O cartao Gravacao a partir do retrato e da sala (o que o Apresentador ve e pode fazer agora). O preparo vencido
 * (recorderPrepareStale: 25 min sem `ready` nem `unavailable`) vale como sem gravador: Preparar de novo e a reserva.
 */
export function recorderCard(input: { nowMs?: number; recorder: LiveConsoleRecorder; recordingOn: boolean; status: SessionStatus }): RecorderCard {
  const { recorder } = input;
  const stale = input.nowMs !== undefined && recorderPrepareStale({ nowMs: input.nowMs, requestedAt: recorder.requestedAt, status: recorder.status });
  const label = input.recordingOn && recorder.status !== "recording" ? copy.gravador.recording : RECORDER_LABELS[recorder.status];
  const open = input.status === "waiting" || input.status === "live";
  const preparingNote = recorder.estimateMinutes ? copy.preparandoGravacao(recorder.estimateMinutes) : copy.preparandoGravacaoSemMedida;

  if (input.recordingOn) {
    return { action: "recording", fallback: false, label, note: null };
  }
  if (input.status === "ended" || input.status === "cancelled") {
    return { action: canReleaseRecorder(recorder.status) ? "release" : "none", fallback: false, label, note: null };
  }
  if (stale) {
    return { action: "prepare", fallback: true, label, note: copy.preparoSemResposta };
  }
  if (recorder.status === "preparing") {
    return { action: recorder.recordingRequestedAt ? "queued" : open ? "record" : "none", fallback: false, label, note: recorder.recordingRequestedAt ? `${preparingNote}. ${copy.gravarNaFila}` : preparingNote };
  }
  if (recorder.status === "ready") {
    return { action: open ? "record" : "none", fallback: false, label, note: copy.gravacaoPronta };
  }
  if (recorder.status === "recording") {
    return { action: open ? "recording" : "none", fallback: false, label, note: null };
  }
  if (recordButtonAction(recorder.status) === "recording") {
    // `uploading`: a gravacao ja parou e o arquivo esta subindo; nada a fazer ate o `uploaded`.
    return { action: "none", fallback: false, label, note: null };
  }
  if (recorder.status === "unavailable") {
    return { action: canRequestRecorder(recorder.status) ? "prepare" : "none", fallback: true, label, note: copy.semGravadorHoje };
  }
  if (canRequestRecorder(recorder.status)) {
    return { action: "prepare", fallback: !recorder.dispatchConfigured, label, note: recorder.dispatchConfigured ? copy.gravacaoNaoPreparada : copy.disparoAusente };
  }
  return { action: "none", fallback: recorder.status === "upload_failed", label, note: null };
}

/** "Maquina ligada ha 1 h 05 min" enquanto a maquina existe (desde o pedido). */
export function machineAge(input: { nowMs: number; requestedAt: string | null; status: RecorderStatus }): string | null {
  if (!input.requestedAt || !recorderMachineAlive(input.status)) {
    return null;
  }
  const elapsed = input.nowMs - Date.parse(input.requestedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return null;
  }
  const minutes = Math.floor(elapsed / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return copy.maquinaHa(hours > 0 ? `${hours} h ${String(rest).padStart(2, "0")} min` : `${rest} min`);
}

/** "A gravacao comecou as 20:03:15" (Sao Paulo, com os segundos: e a conferencia da ancora). */
export function anchorLabel(anchorAt: string | null): string | null {
  if (!anchorAt) {
    return null;
  }
  const date = new Date(anchorAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return copy.ancora(`${saoPauloTime(anchorAt)}:${String(date.getUTCSeconds()).padStart(2, "0")}`);
}

/** "O arquivo comecou {s} s depois do clique" (arredondado; sem o carimbo do arquivo, nulo). */
export function driftLabel(driftMs: number | null): string | null {
  return driftMs === null || !Number.isFinite(driftMs) ? null : copy.diferencaArquivo(Math.round(driftMs / 1000));
}

/* ------------------------------------------------------------------------------------------------
 * Alinhar chat (docs/30 §6.5: posicao no video = offset_ms - anchor_offset_ms)
 * ---------------------------------------------------------------------------------------------- */

/** O ajuste de +/- segundos dentro do limite do banco (1 h para cada lado). */
export const ALIGN_LIMIT_SECONDS = 3600;
export const ALIGN_STEPS = [-5, -1, 1, 5] as const;

export function clampAlignSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) {
    return 0;
  }
  return Math.max(-ALIGN_LIMIT_SECONDS, Math.min(ALIGN_LIMIT_SECONDS, Math.round(seconds)));
}

/** O segundo do video em que a mensagem aparece com o ajuste (nunca antes do zero). */
export function alignPreviewSeconds(messageOffsetMs: number, anchorOffsetMs: number): number {
  return Math.max(0, Math.floor((messageOffsetMs - anchorOffsetMs) / 1000));
}

/** O player da previa no segundo pedido (o `t` do player da Bunny; o token, se houver, nao cobre o `t`). */
export function previewAt(previewUrl: string, seconds: number): string {
  try {
    const url = new URL(previewUrl);
    url.searchParams.set("autoplay", "false");
    if (seconds > 0) {
      url.searchParams.set("t", String(Math.floor(seconds)));
    } else {
      url.searchParams.delete("t");
    }
    return url.toString();
  } catch {
    return previewUrl;
  }
}
