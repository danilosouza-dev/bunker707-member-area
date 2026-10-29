// A sala ao vivo no navegador, a parte pura (docs/30 §5.4, §6.2, §6.3, §8.1, §8.4 e D26): o hostname do Jitsi
// proprio (nunca meet.jit.si), o endereco do external_api.js, o `allow` do iframe, o configOverwrite por papel
// (aluno sem chat, enquetes e reacoes do Jitsi, sempre mudo ao entrar, camera ate 360p e so com allow_student_camera;
// apresentador e co-apresentador com o palco em 720p ou 1080p e a tela a 30 ou 15 quadros), os sinais do IFrame API
// que a pagina escuta, a traducao de um sinal para o lote de POST .../room-events (so codigos, nunca texto: docs/30
// §5.1) e quando pedir outro token. Sem imports: o next.config.ts (Permissions-Policy), o hook
// src/components/webinars/use-jitsi-meet.ts, as telas e os testes (node --test) carregam este arquivo direto.
// Nenhuma frase de tela aqui (elas ficam em src/lib/webinar-copy.ts) e nada cita o Jitsi para o aluno (D2).

/** O hostname do Jitsi proprio quando WEBINAR_MEET_DOMAIN nao veio no build (so para a Permissions-Policy; A9). */
export const DEFAULT_MEET_DOMAIN = "meet.bunker707.com.br";

/** Os papeis da sala (o mesmo ROOM_ROLES de src/server/webinars/jitsi-token.ts, repetido para nao puxar node:crypto). */
export type LiveRoomRole = "co_host" | "host" | "student" | "team";

/** O que o card Qualidade e o card Sala decidem para o iframe (docs/30 §2.2 e D26). */
export type LiveEmbedSettings = { allowStudentCamera: boolean; screenFps: 15 | 30; stage: 720 | 1080 };

/** Teto da camera do aluno e da Equipe fora do palco (D26). */
export const STUDENT_CAMERA_MAX_HEIGHT = 360;
/** Cada um recebe no maximo o palco + 8 miniaturas (custom-config.js: channelLastN = 9). */
export const CHANNEL_LAST_N = 9;
/**
 * O que o iframe precisa para camera, microfone, tela, som, tela cheia e a escolha do alto-falante (docs/30 §6.3 e
 * §8.4): `speaker-selection` deixa o iframe trocar a saida de som (setAudioOutputDevice) nos navegadores que pedem
 * essa permissao; o padrao da pagina para ela ja e a propria origem, entao a Permissions-Policy nao muda.
 */
export const JITSI_IFRAME_ALLOW = "camera; microphone; display-capture; autoplay; fullscreen; speaker-selection";
/** Pede outro join-token este tanto antes do `exp` (docs/30 §5.4: a pagina faz isso sozinha). */
export const TOKEN_REFRESH_BEFORE_MS = 5 * 60_000;
/** Depois de quantas tentativas a sala mostra "Não conseguimos voltar. Tentar de novo" (docs/30 §1.3). */
export const RECONNECT_ATTEMPTS = 3;

const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const FOREIGN_MEET = /(^|\.)(jit\.si|8x8\.vc|jitsi\.net)$/;

/** O hostname do Jitsi proprio a partir do ambiente (WEBINAR_MEET_DOMAIN), em minusculas; invalido ou de terceiro = nulo. */
export function meetDomainOf(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!HOSTNAME.test(text) || FOREIGN_MEET.test(text)) {
    return null;
  }
  return text;
}

/** A origem exata do Jitsi proprio (Permissions-Policy, conferencia de mensagens). */
export function meetOrigin(domain: string): string {
  return `https://${domain}`;
}

/** O external_api.js sempre do nosso hostname, nunca de meet.jit.si (D2, D18). */
export function externalApiUrl(domain: string): string {
  return `${meetOrigin(domain)}/external_api.js`;
}

/** A Permissions-Policy das paginas da sala: camera, microfone e tela para a propria origem e o Jitsi proprio (I10). */
export function meetPermissionsAllowList(domain: string | null): string {
  return domain ? `(self "${meetOrigin(domain)}")` : "()";
}

/**
 * A barra do iframe por papel (docs/30 §6.3): o apresentador e o co-apresentador usam a do iframe (microfone, camera,
 * tela, mao, participantes, gravar so o host, seguranca, fundo, configuracoes e sair; a engrenagem abre so a aba de
 * aparelhos, liveInterfaceConfigOverwrite); aluno e Equipe usam so a nossa. Os controles de Zoom (silenciar todos,
 * fechar cameras, liberar, remover, trancar, destacar) sao botoes nossos que chamam executeCommand.
 */
export function toolbarButtonsFor(role: LiveRoomRole, settings: Pick<LiveEmbedSettings, "allowStudentCamera">): string[] {
  switch (role) {
    case "host":
      return ["microphone", "camera", "desktop", "raisehand", "participants-pane", "recording", "security", "select-background", "settings", "hangup"];
    case "co_host":
      return ["microphone", "camera", "desktop", "raisehand", "participants-pane", "security", "select-background", "settings", "hangup"];
    default:
      // Aluno e Equipe: a barra e a NOSSA (Reagir, Levantar a mão, Câmera, Microfone depois de liberado, Tela cheia,
      // Som, Configurações com os aparelhos depois do consentimento), que chama executeCommand e a api. Assim o primeiro clique na camera passa pelo aviso de gravacao (docs/30 §8.5,
      // D4) e o microfone pelo Falar / Agora não; a barra do iframe some. `allowStudentCamera` decide o NOSSO botao
      // (e o apresentador liga a moderacao de video no webinario sem camera de aluno).
      void settings;
      return [];
  }
}

/** A altura maxima do video que cada papel envia (D26): palco 720p/1080p, o resto 360p. */
export function sendHeightFor(role: LiveRoomRole, settings: Pick<LiveEmbedSettings, "stage">): number {
  return role === "host" || role === "co_host" ? settings.stage : STUDENT_CAMERA_MAX_HEIGHT;
}

/** Apresentador e co-apresentador: a barra do iframe, a engrenagem so com os aparelhos e a barra sempre visivel. */
function presents(role: LiveRoomRole | null | undefined): boolean {
  return role === "host" || role === "co_host";
}

/**
 * O configOverwrite do iframe (docs/30 §5.4, §6.3, §8.1 e D26). O chat, as enquetes e as reacoes do Jitsi ficam
 * sempre desligados (D5: sao os nossos); todo mundo entra mudo e com a camera fechada; o aluno nao tem menu sobre
 * ninguem nem silencia ninguem; o nome vem do token. `startSilent` nunca entra: ele corta o som que o aluno RECEBE.
 * A barra de quem apresenta fica sempre visivel (`toolbarConfig.alwaysVisible`): as setinhas de microfone e camera e a
 * engrenagem nao somem depois de alguns segundos.
 * Aluno e Equipe entram com `disableInitialGUM`: sem ele o Jitsi captura o microfone na entrada (so para as
 * estatisticas) e o navegador pede a permissao antes do aviso de gravacao e antes de o apresentador liberar (§1.3,
 * §8.5); o toggleAudio depois do Falar e o toggleVideo depois do aviso da camera pedem a permissao na hora certa. O
 * aluno bate sozinho na sala de espera (`lobby.autoKnock`): com a sala trancada ou a Sala de espera ligada, ele fica
 * na fila sem precisar achar o botao do iframe.
 */
export function liveConfigOverwrite(role: LiveRoomRole, settings: LiveEmbedSettings): Record<string, unknown> {
  const height = sendHeightFor(role, settings);
  const student = role === "student";
  const audience = role === "student" || role === "team";
  return {
    ...(audience ? { disableInitialGUM: true } : {}),
    ...(student ? { lobby: { autoKnock: true } } : {}),
    breakoutRooms: { hideAddRoomButton: true, hideAutoAssignButton: true, hideJoinRoomButton: true },
    channelLastN: CHANNEL_LAST_N,
    constraints: { video: { height: { ideal: height, max: height, min: 180 } } },
    desktopSharingFrameRate: { max: settings.screenFps, min: 5 },
    disableChat: true,
    disableDeepLinking: true,
    disableInviteFunctions: true,
    disablePolls: true,
    disablePrivateChat: true,
    disableReactions: true,
    disableRemoteMute: student,
    // Sem o "Flip" no menu da propria miniatura para o aluno e a Equipe: o espelho so pelo nosso painel, que guarda a
    // escolha na pagina (o iframe guarda o localFlipX dele e a api nao deixa ler; MIRROR_STORAGE_KEY).
    ...(audience ? { disableLocalVideoFlip: true } : {}),
    disableSelfView: false,
    // Sem atalhos do iframe para o aluno e a Equipe: a camera e o microfone so pela nossa barra (o aviso de gravacao).
    disableShortcuts: audience,
    hideConferenceSubject: true,
    hideConferenceTimer: true,
    hideDisplayName: false,
    prejoinConfig: { enabled: false },
    prejoinPageEnabled: false,
    readOnlyName: true,
    remoteVideoMenu: { disableGrantModerator: true, disableKick: student || role === "team", disabled: student },
    resolution: height,
    startAudioOnly: false,
    startWithAudioMuted: true,
    startWithVideoMuted: true,
    ...(presents(role) ? { toolbarConfig: { alwaysVisible: true } } : {}),
    toolbarButtons: toolbarButtonsFor(role, settings)
  };
}

/**
 * O interfaceConfigOverwrite (so chaves da lista permitida do IFrame API; a marca sai pelo custom-interface_config.js).
 * Quem apresenta abre a engrenagem do iframe so na aba de aparelhos (`SETTINGS_SECTIONS: ['devices']`: sem as abas de
 * moderador, perfil e idioma, que o console ja decide). O aluno e a Equipe nao tem engrenagem (a barra deles e a nossa);
 * sem o papel (a chamada antiga), o mesmo do aluno.
 */
export function liveInterfaceConfigOverwrite(role?: LiveRoomRole | null): Record<string, unknown> {
  return {
    DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
    MOBILE_APP_PROMO: false,
    ...(presents(role) ? { SETTINGS_SECTIONS: ["devices"] } : {}),
    SHOW_CHROME_EXTENSION_BANNER: false
  };
}

/** Os sinais do IFrame API que a pagina escuta (docs/30 §6.3); os comandos ficam com quem comanda a sala. */
export const JITSI_LISTENED_EVENTS = [
  "videoConferenceJoined",
  "videoConferenceLeft",
  "participantJoined",
  "participantLeft",
  "participantRoleChanged",
  "raiseHandUpdated",
  "dominantSpeakerChanged",
  "audioMuteStatusChanged",
  "videoMuteStatusChanged",
  "moderationParticipantApproved",
  "recordingStatusChanged",
  "knockingParticipant",
  // O "Abaixar a mão" do console chega ao aluno por sendEndpointTextMessage (o IFrame API nao abaixa a mao de outro).
  "endpointTextMessageReceived",
  "errorOccurred",
  "readyToClose",
  // O painel Configurações (use-jitsi-devices.ts): a lista de aparelhos mudou (um fone entrou ou saiu) e o navegador
  // recusou o microfone ou a camera (o aviso na barra). Nenhum dos tres vai ao servidor (toRoomEvent devolve nulo).
  "deviceListChanged",
  "micError",
  "cameraError"
] as const;
export type JitsiListenedEvent = (typeof JITSI_LISTENED_EVENTS)[number];

/**
 * O sinal que o console manda (sendEndpointTextMessage, com o texto JSON { type }) para o aluno abaixar a propria mao:
 * o IFrame API nao tem comando para abaixar a mao de outro participante (docs/30 §1.4).
 */
export const LOWER_HAND_SIGNAL = "bunker707:lower-hand";

/**
 * O sinal que o console do Apresentador manda a todos (sendEndpointTextMessage com o destino vazio, texto JSON
 * { type, on }) quando a reserva "Gravar no navegador" liga ou desliga: a gravacao local so avisa o navegador de quem
 * grava, e o selo Gravando do aluno precisa aparecer na hora (a sessao relida tambem traz, em ate 60 s).
 */
export const RECORDING_SIGNAL = "bunker707:recording";

/** Os nomes que POST .../room-events aceita (o mesmo ROOM_EVENT_NAMES de src/server/webinars/live-schemas.ts). */
export type RoomEventSignal =
  | "audioMuteStatusChanged"
  | "errorOccurred"
  | "participantRoleChanged"
  | "raiseHandUpdated"
  | "recordingStatusChanged"
  | "videoConferenceJoined"
  | "videoConferenceLeft"
  | "videoMuteStatusChanged";

export type RoomEventItem = { at: string; data?: Record<string, boolean | number | string | null>; name: RoomEventSignal };

const PARTICIPANT_ID = /^[0-9a-z-]{1,40}$/i;
const ERROR_CODE = /^[a-z0-9._-]{1,80}$/i;

function field(payload: unknown, key: string): unknown {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined;
}

function code(value: unknown): string | null {
  return typeof value === "string" && ERROR_CODE.test(value) ? value : null;
}

/**
 * Um sinal do iframe para o lote de POST .../room-events: so os codigos combinados (docs/30 §5.1), nunca nome, texto ou
 * mensagem de erro. A mao levantada e o papel valem so quando sao do proprio participante (`ownId`); o resto vira nulo.
 * `extra.consented` acompanha a primeira camera ligada (o aceite do aviso de gravacao, D4).
 */
export function toRoomEvent(name: string, payload: unknown, input: { extra?: { consented?: boolean }; nowIso: string; ownId: string | null }): RoomEventItem | null {
  const at = input.nowIso;
  const id = field(payload, "id");
  const mine = typeof id === "string" && input.ownId !== null && id === input.ownId;
  switch (name) {
    case "videoConferenceJoined": {
      const participantId = typeof id === "string" && PARTICIPANT_ID.test(id) ? id : null;
      return { at, data: { participantId }, name };
    }
    case "videoConferenceLeft":
      return { at, name };
    case "raiseHandUpdated":
      return mine ? { at, data: { raised: Boolean(field(payload, "handRaised")) }, name } : null;
    case "audioMuteStatusChanged":
      return { at, data: { muted: field(payload, "muted") === true }, name };
    case "videoMuteStatusChanged":
      return { at, data: { consented: input.extra?.consented === true, muted: field(payload, "muted") === true }, name };
    case "participantRoleChanged": {
      const role = field(payload, "role");
      return mine && (role === "moderator" || role === "participant" || role === "none") ? { at, data: { role }, name } : null;
    }
    case "recordingStatusChanged":
      return { at, data: { on: field(payload, "on") === true }, name };
    case "errorOccurred": {
      const error = field(payload, "error") ?? payload;
      return { at, data: { code: code(field(error, "name")) ?? code(field(error, "type")) ?? "unknown", fatal: field(error, "isFatal") === true }, name };
    }
    case "deviceListChanged":
    case "micError":
    case "cameraError":
      // So a tela usa (a lista do painel Configurações e o aviso na barra): o servidor nao aceita estes nomes.
      return null;
    default:
      return null;
  }
}

/** Quando pedir outro token (ms a partir de agora): 5 min antes do `exp`, nunca antes de 10 s. */
export function tokenRefreshDelayMs(expiresAtIso: string, nowMs: number): number {
  const exp = new Date(expiresAtIso).getTime();
  if (!Number.isFinite(exp)) {
    return 60_000;
  }
  return Math.max(10_000, exp - TOKEN_REFRESH_BEFORE_MS - nowMs);
}
