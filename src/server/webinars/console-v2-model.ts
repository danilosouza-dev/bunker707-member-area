// O console V2 de quem apresenta (docs/31 V2-12 a V2-15, fase 2 do redesign), a parte pura: o rotulo de cada sessao
// no seletor do topo, o selo dos presentes com o pico, os botoes de situacao do topo pela espécie e pela situacao da
// sessao, o palco da live (V2-4 e V2-A5): o selo do momento, o de quem esta no video grande e quem decide a coluna de
// miniaturas, a barra de quem apresenta (V2-14): os botoes de cada papel e o circulo Gravar, e o painel com abas
// (V2-15): as abas, as entradas do ⋯ e os numeros das abas. Sem React e com imports relativos:
// tests/webinarios-console-v2-modelo.test.mjs carrega direto pelo Node.
// Cada fatia da fase 2 acrescenta aqui as regras da tela dela.

import { liveElapsedLabel, liveOnAirLabel, stageOwnerId } from "../../components/member/webinars/room/live-room-model";
import type { ConsoleBarItem } from "../../components/member/webinars/room/room-layout-model";
import type { RoomStageTopLeft } from "../../components/member/webinars/room/room-stage-badges";
import type { ConsoleScreenShareMode } from "../../lib/jitsi-room-config";
import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { formatWebinarDayMonthTime } from "../../lib/webinar-time";
import { canEndSession, canOpenSession, consoleClockLabel, consoleClockMs, consolePhaseOf, questionAwaitsTeam, type ConsolePhase } from "./console-model";
import { liveSessionButtons, type ConsoleRoomRole, type LiveControls, type LiveRoomState, type RecorderCard } from "./live-console-model";
import type { SessionKind, SessionStatus, WebinarKind, WebinarQuestion, WebinarSession } from "./model";

const copy = WEBINAR_COPY.consoleV2;

/**
 * O rotulo de uma sessao no seletor do topo (V2-13): "Sessão de 30/10 às 20:00 · no ar", sem o ano e com a situacao
 * gravada em minuscula (a mesma regra de antes: a situacao do banco, nao o relogio); o Replay so com a hora,
 * "Replay · 30/10 às 20:00".
 */
export function consoleSessionOptionLabel(session: { kind: SessionKind; scheduledAt: string; status: SessionStatus }): string {
  const when = formatWebinarDayMonthTime(session.scheduledAt);
  return session.kind === "replay" ? copy.replayDe(when) : copy.sessaoDe(when, copy.fases[session.status]);
}

/**
 * O selo dos presentes (V2-13; no topo da gravada e do Replay, e no palco da live): "12 presentes ·
 * pico 14". Os presentes vem do retrato de 5 s e o pico do relatorio em cache de 60 s (console-presence-model.ts), entao
 * o pico mostrado e o maior dos dois: sem isso o selo poderia dizer "12 presentes · pico 10". Sem pico (o Replay, antes
 * de comecar ou sem a leitura), so "12 presentes".
 */
export function consolePresenceBadge(input: { peak: number | null; presentNow: number }): string {
  const present = Number.isFinite(input.presentNow) ? Math.max(0, Math.round(input.presentNow)) : 0;
  if (input.peak === null || !Number.isFinite(input.peak)) {
    return copy.presentes(present);
  }
  return copy.presentesComPico(present, Math.max(Math.round(input.peak), present));
}

/** Os botoes de situacao do topo do console, na ordem em que aparecem. */
export const CONSOLE_TOP_ACTIONS = ["open_room", "start", "lock", "end_live", "open_session", "end_session", "report"] as const;
export type ConsoleTopActionId = (typeof CONSOLE_TOP_ACTIONS)[number];
export type ConsoleTopAction = { enabled: boolean; id: ConsoleTopActionId };

export type ConsoleTopActionsInput = {
  /** messaging.publish: abrir e encerrar a sessao gravada. */
  canPublish: boolean;
  /** O que o papel de quem esta no console pode na live (liveControlsFor): o Trancar e os botoes da sessao. */
  controls: { lock: boolean; session: boolean; sessionEnabled: boolean };
  kind: SessionKind;
  /** A fase do topo (consolePhaseOf): o relatorio so com ela encerrada. */
  phase: ConsolePhase;
  status: SessionStatus;
};

/**
 * Os botoes de situacao do topo (V2-13 e a decisao "Botões de situação" do plano da fase 2), na ordem de
 * CONSOLE_TOP_ACTIONS. Na live, a matriz de liveSessionButtons: agendada, Abrir a sala, Começar para todos e Trancar;
 * na espera, Começar para todos, Trancar e Encerrar live; no ar, Trancar e Encerrar live. Abrir a sala, Começar para
 * todos e Encerrar live so para quem comanda a sessao (o Apresentador e a Equipe) e desligados sem messaging.publish.
 * O Trancar so para quem apresenta e nunca na encerrada nem na cancelada (o servidor recusa); fica na agendada (a
 * Sessão de prática: quem apresenta tranca antes de abrir). Na gravada, Abrir sessão e Encerrar sessão so com
 * messaging.publish e pela situacao; o Replay nunca abre nem encerra. Ver relatório com a fase encerrada.
 */
export function consoleTopActionsFor(input: ConsoleTopActionsInput): ConsoleTopAction[] {
  const actions: ConsoleTopAction[] = [];
  if (input.kind === "live") {
    const buttons = liveSessionButtons(input.status);
    const session = input.controls.session;
    const enabled = input.controls.sessionEnabled;
    if (session && buttons.open) {
      actions.push({ enabled, id: "open_room" });
    }
    if (session && buttons.start) {
      actions.push({ enabled, id: "start" });
    }
    if (input.controls.lock && input.status !== "ended" && input.status !== "cancelled") {
      actions.push({ enabled: true, id: "lock" });
    }
    if (session && buttons.end) {
      actions.push({ enabled, id: "end_live" });
    }
  } else if (input.kind === "simulated" && input.canPublish) {
    if (canOpenSession(input.status)) {
      actions.push({ enabled: true, id: "open_session" });
    }
    if (canEndSession(input.status)) {
      actions.push({ enabled: true, id: "end_session" });
    }
  }
  if (input.phase === "ended") {
    actions.push({ enabled: true, id: "report" });
  }
  return actions;
}

/* ------------------------------------------------------------------------------------------------
 * O palco da live no console (V2-4, V2-13 e V2-A5)
 * ---------------------------------------------------------------------------------------------- */

/** O selo de cima a esquerda do palco do console: o "Ao vivo" da sala ou a frase do momento, neutra sobre o video. */
export type ConsoleStageTopLeft = Extract<RoomStageTopLeft, { kind: "label" } | { kind: "on_air" }>;

/**
 * O selo de cima a esquerda do palco (V2-4 e V2-13): no ar (a fase pelo relogio do servidor) e com o inicio de verdade,
 * "Ao vivo · 00:42:10" pelo liveOnAirLabel, como a sala do aluno; fora do ar, a frase do momento do console
 * (consoleClockLabel: "Começa em 4:59", "Durou 1:00:00"); sem frase (a sessao cancelada, a espera depois da hora sem o
 * inicio), nada. `nowMs` e a hora do aparelho e `skewMs` a diferenca para o servidor (servidor menos aparelho).
 */
export function consoleStageTopLeft(input: {
  durationMs: number;
  nowMs: number;
  session: Pick<WebinarSession, "endedAt" | "kind" | "recordingAnchorAt" | "scheduledAt" | "startedAt" | "status">;
  skewMs: number;
}): ConsoleStageTopLeft | null {
  const serverNow = input.nowMs + input.skewMs;
  const phase = consolePhaseOf(input.session, input.durationMs, serverNow);
  const startedAt = input.session.startedAt;
  if (phase === "live" && startedAt && Number.isFinite(Date.parse(startedAt))) {
    return { kind: "on_air", label: liveOnAirLabel(startedAt, input.nowMs, input.skewMs), short: liveElapsedLabel(startedAt, input.nowMs, input.skewMs) };
  }
  const label = consoleClockLabel(consoleClockMs(input.session, input.durationMs, serverNow), phase);
  return label ? { kind: "label", label } : null;
}

/** O selo de baixo a esquerda do palco: quem esta no video grande e o papel. */
export type ConsoleStageBadge = { name: string; role: string };

/** O papel do proprio console no selo: o Apresentador, o co-apresentador ou a Equipe. */
function ownRoleLabel(role: ConsoleRoomRole): string {
  if (role === "host") {
    return WEBINAR_COPY.sala.selos.apresentador;
  }
  return role === "co_host" ? WEBINAR_COPY.sala.selos.coApresentador : WEBINAR_COPY.sala.selos.equipe;
}

/**
 * O selo de baixo a esquerda do palco do console (V2-4 e V2-13): so dentro da sala e no Palco (na Grade nao ha video
 * grande) e com o motor tendo dito quem esta no video grande (onStageId; a tela compartilhada `<id>-v1` vale pelo
 * dono, stageOwnerId). O proprio console ali: "Você" e o papel dele ("Você · Apresentador", "Você · Co-apresentador").
 * Outro moderador ali (o papel de cada um pelo participantRoleChanged e pelo getRoomsInfo): o selo que o aluno ve, o
 * nome do apresentador da pagina com "Apresentador" para qualquer moderador (V2-A25), tambem no console do proprio
 * Apresentador com o co-apresentador no video grande. Nunca o nome da sala com "Apresentador": o co-apresentador ou a
 * Equipe ali sairiam com o papel de quem apresenta. Sem o nome da pagina, sem papel conhecido ou com um aluno no video
 * grande: nada (nunca um nome por palpite), como a sala do aluno (presenterBadgeFor).
 */
export function consoleStageBadgeFor(input: {
  joined: boolean;
  presenterName: string | null;
  role: ConsoleRoomRole;
  room: Pick<LiveRoomState, "onStageId" | "roles" | "selfId" | "viewShown">;
}): ConsoleStageBadge | null {
  const { room } = input;
  if (!input.joined || room.viewShown === "grid" || room.onStageId === null) {
    return null;
  }
  const owner = stageOwnerId(room.onStageId);
  if (room.selfId !== null && owner === room.selfId) {
    return { name: WEBINAR_COPY.consoleAoVivo.voce, role: ownRoleLabel(input.role) };
  }
  if (!Object.hasOwn(room.roles, owner) || room.roles[owner] !== "moderator") {
    return null;
  }
  const name = input.presenterName?.trim();
  return name ? { name, role: WEBINAR_COPY.sala.selos.apresentador } : null;
}

/**
 * Quem decide a coluna de miniaturas do iframe no console (docs/31 V2-A5): o Apresentador deixa com o motor ("engine")
 * e nunca manda toggleFilmStrip pela propria largura, porque o seguir a visao, que so ele liga, levaria essa escolha
 * local a todos e ao gravador; o co-apresentador e a Equipe seguem a largura do iframe ("width"), como o aluno
 * (columnWanted e filmstripStep).
 */
export function consoleColumnPolicy(role: ConsoleRoomRole): "engine" | "width" {
  return role === "host" ? "engine" : "width";
}

/* ------------------------------------------------------------------------------------------------
 * A barra de quem apresenta (V2-14)
 * ---------------------------------------------------------------------------------------------- */

/** O que a zona da esquerda da barra mostra: quem bate na sala de espera (com Admitir todos) ou a frase da sala. */
export type ConsoleBarLobby = { count: number; kind: "knocking" } | { kind: "notice"; text: string };

/** As tres zonas da barra de quem apresenta, na ordem da tela, e o que a Sala de espera mostra. */
export type ConsoleBarItems = { center: ConsoleBarItem[]; left: ConsoleBarItem[]; lobby: ConsoleBarLobby | null; right: ConsoleBarItem[] };

/**
 * A barra de quem apresenta (V2-14), pelo papel do console na sala. A esquerda, a Sala de espera: "Sala de espera · 2"
 * com Admitir todos quando alguem bate e o papel admite (controls.admit); sem ninguem batendo, a frase da sala
 * (lobbyNotice: a Sessão de prática, a sala trancada, a Sala de espera ligada) numa pilula quieta; sem nada, a zona fica
 * vazia. No centro, para o Apresentador: Microfone, Câmera, Compartilhar tela, Gravar, Mãos e Lançar enquete; o
 * co-apresentador sem Gravar; a Equipe so Mãos e Lançar enquete (sem midia, como antes do V2). Mãos e Lançar enquete
 * abrem o painel (a aba Mãos e o ⋯ › Enquetes). O Compartilhar tela so com o nosso circulo valendo no navegador
 * (consoleScreenShareMode "ours"; no outro, o botao de tela do proprio motor fica no video, V2-A39). A direita, a visao
 * (para todos no Apresentador), Configurações (so quem apresenta, com a sala neste ambiente) e o painel.
 */
export function consoleBarItemsFor(input: {
  controls: Pick<LiveControls, "admit">;
  knocking: number;
  lobbyNotice: string | null;
  meetConfigured: boolean;
  role: ConsoleRoomRole;
  screenShare: ConsoleScreenShareMode;
}): ConsoleBarItems {
  const knocking = Number.isFinite(input.knocking) ? Math.max(0, Math.floor(input.knocking)) : 0;
  const lobby: ConsoleBarLobby | null = input.controls.admit && knocking > 0 ? { count: knocking, kind: "knocking" } : input.lobbyNotice ? { kind: "notice", text: input.lobbyNotice } : null;
  const presenter = input.role === "host" || input.role === "co_host";
  const center: ConsoleBarItem[] = [];
  if (presenter) {
    center.push("mic", "camera");
    if (input.screenShare === "ours") {
      center.push("share");
    }
    if (input.role === "host") {
      center.push("record");
    }
  }
  center.push("hands", "poll");
  const right: ConsoleBarItem[] = ["view"];
  if (presenter && input.meetConfigured) {
    right.push("settings");
  }
  right.push("panel");
  return { center, left: lobby ? ["lobby"] : [], lobby, right };
}

/**
 * O circulo Gravar da barra: ligado (gravando), girando (na fila), se o clique vale, se o clique abre o ⋯ › Gravação do
 * painel (o preparo) e o title, que diz o porque.
 */
export type ConsoleRecordButton = { active: boolean; busy: boolean; enabled: boolean; opensPanel: boolean; title: string };

/**
 * O circulo Gravar da barra do Apresentador (V2-14), pelos estados do cartao Gravação (recorderCard): "record" grava
 * (o mesmo pedido de antes, requestRecording e o startRecording do arquivo), "recording" fica ligado e o clique para,
 * "queued" gira (o clique ja esta na fila e a gravacao comeca sozinha), "prepare" abre o ⋯ › Gravação do painel, onde
 * fica o Preparar (o title diz o porque, tambem fora da sala: o gravador se prepara antes da live), e o resto fica
 * desligado com o motivo no title. Fora da sala nada grava; sem messaging.publish o "record" fica desligado com a frase
 * de quem publica, e o "recording" para.
 */
export function consoleRecordButton(input: { canPublish: boolean; card: Pick<RecorderCard, "action" | "label" | "note">; joined: boolean; open: boolean }): ConsoleRecordButton {
  const live = WEBINAR_COPY.consoleAoVivo;
  const { card } = input;
  switch (card.action) {
    case "recording":
      return { active: true, busy: false, enabled: input.joined, opensPanel: false, title: live.pararGravacao };
    case "queued":
      return { active: false, busy: true, enabled: false, opensPanel: false, title: card.note ?? live.gravarNaFila };
    case "record":
      return { active: false, busy: false, enabled: input.joined && input.canPublish, opensPanel: false, title: input.canPublish ? live.gravar : live.soQuemPublica };
    case "prepare":
      return { active: false, busy: false, enabled: true, opensPanel: true, title: card.note ?? card.label };
    default:
      return { active: false, busy: false, enabled: false, opensPanel: false, title: input.open ? (card.note ?? card.label) : live.recusas.notRecording };
  }
}

/* ------------------------------------------------------------------------------------------------
 * O painel com abas (V2-15)
 * ---------------------------------------------------------------------------------------------- */

/** As abas do painel do console, na ordem da tela. */
export const CONSOLE_TABS = ["chat", "perguntas", "maos", "pessoas"] as const;
export type ConsoleTab = (typeof CONSOLE_TABS)[number];

/** As entradas do ⋯ do painel, na ordem do V2-15. */
export const CONSOLE_MORE_ENTRIES = ["enquetes", "roteiro", "oferta", "atendimento", "presenca", "gravacao"] as const;
export type ConsoleMoreEntry = (typeof CONSOLE_MORE_ENTRIES)[number];

/** O que o painel mostra: uma aba ou uma entrada do ⋯ (nunca as duas: com uma entrada, nenhuma aba fica escolhida). */
export type ConsolePanelView = { more: ConsoleMoreEntry } | { tab: ConsoleTab };

/**
 * As abas do painel (V2-15): na live, Chat, Perguntas, Mãos e Pessoas; na gravada e no Replay, so Chat e Perguntas
 * (ninguem levanta a mao nem esta numa sala de video).
 */
export function consoleTabsFor(input: { kind: SessionKind }): ConsoleTab[] {
  return input.kind === "live" ? [...CONSOLE_TABS] : ["chat", "perguntas"];
}

/**
 * O toque num item do trilho do console (docs/31 §10, o railStep da sala com as entradas do Mais): com o painel fora da
 * tela, ou noutra aba ou entrada, abre o painel nela; no item que ja esta na tela, fecha o painel (so com palco; sem
 * palco o painel e o corpo inteiro e nunca fecha). O estado do painel fica com o console.
 */
export function consoleRailStep(input: { closable: boolean; item: ConsolePanelView; panelShown: boolean; view: ConsolePanelView }): { panelOpen: boolean; view: ConsolePanelView } {
  const same = "tab" in input.item ? "tab" in input.view && input.view.tab === input.item.tab : "more" in input.view && input.view.more === input.item.more;
  if (!input.panelShown || !same) {
    return { panelOpen: true, view: input.item };
  }
  return { panelOpen: !input.closable, view: input.view };
}

/** A altura de um item do trilho do console (o quadrado de 48 e o rotulo de 16) e o vao entre dois (docs/31 §10). */
export const CONSOLE_RAIL_ITEM_PX = 64;
export const CONSOLE_RAIL_GAP_PX = 16;

/**
 * Quantos itens do trilho ficam na tela (docs/31 §10, ajuste de 10/11/2026): todos, quando a altura do trilho comporta
 * (as abas e as entradas da sessao, na ordem); senao, o ultimo lugar e do Mais, que leva os que nao couberam. Sem a
 * medida (o HTML do servidor, o trilho escondido abaixo de lg), todos. Sempre ao menos um lugar.
 */
export function consoleRailFit(input: { available: number | null; count: number }): { overflow: number; visible: number } {
  const count = Math.max(0, Math.floor(input.count));
  if (input.available === null || !Number.isFinite(input.available) || input.available <= 0) {
    return { overflow: 0, visible: count };
  }
  const slots = Math.max(1, Math.floor((input.available + CONSOLE_RAIL_GAP_PX) / (CONSOLE_RAIL_ITEM_PX + CONSOLE_RAIL_GAP_PX)));
  if (count <= slots) {
    return { overflow: 0, visible: count };
  }
  const visible = slots - 1;
  return { overflow: count - visible, visible };
}

/**
 * As entradas do ⋯ (V2-15), na ordem: Enquetes sempre; Roteiro no webinario gravado; Oferta fora da live; Atendimento
 * sempre; Presença com a leitura da presenca no retrato (nunca no Replay nem antes de comecar); Gravação so na live.
 */
export function consoleMoreEntriesFor(input: { hasPresence: boolean; kind: SessionKind; webinarKind: WebinarKind }): ConsoleMoreEntry[] {
  const entries: ConsoleMoreEntry[] = ["enquetes"];
  if (input.webinarKind === "simulated") {
    entries.push("roteiro");
  }
  if (input.kind !== "live") {
    entries.push("oferta");
  }
  entries.push("atendimento");
  if (input.hasPresence) {
    entries.push("presenca");
  }
  if (input.kind === "live") {
    entries.push("gravacao");
  }
  return entries;
}

/**
 * Os numeros das abas (V2-15 e V2-A37): "Perguntas 3" conta so as abertas (a fila que espera a equipe) e "Mãos 2" as
 * maos levantadas (a fila de handRows, o mesmo numero do circulo Mãos da barra). O Chat fica sem numero na aba (o
 * "{n} aguardando" vai no cabecalho dele) e Pessoas tambem.
 */
export function consoleTabCounts(input: { hands: number; questions: readonly Pick<WebinarQuestion, "replies" | "status">[] }): { maos: number; perguntas: number } {
  const hands = Number.isFinite(input.hands) ? Math.max(0, Math.floor(input.hands)) : 0;
  // O numero das Perguntas: as abertas e as respondidas em que o aluno escreveu por ultimo no fio (o que pede a equipe).
  return { maos: hands, perguntas: input.questions.filter((question) => question.status === "open" || questionAwaitsTeam(question)).length };
}

/**
 * A vista que vale agora: a escolhida, se a aba ou a entrada ainda existe nesta sessao (a Presença some sem a leitura,
 * a troca de sessao muda as abas); senao, o Chat.
 */
export function consolePanelViewOf(input: { entries: readonly ConsoleMoreEntry[]; tabs: readonly ConsoleTab[]; view: ConsolePanelView }): ConsolePanelView {
  const { view } = input;
  if ("tab" in view) {
    return input.tabs.includes(view.tab) ? view : { tab: "chat" };
  }
  return input.entries.includes(view.more) ? view : { tab: "chat" };
}

/* ------------------------------------------------------------------------------------------------
 * A leitura do retrato (o Atualizar do topo, V2-13 e V2-A50)
 * ---------------------------------------------------------------------------------------------- */

/** O que a regiao viva do Atualizar diz, so para o leitor de tela (vazio: nada). */
export type ConsolePollNotice = "" | "atualizando" | "conectado" | "semResposta";
/** A leitura do retrato: o que a regiao viva diz e se a ultima leitura ficou sem resposta (a faixa visivel). */
export type ConsolePoll = { notice: ConsolePollNotice; offline: boolean };
/** Quem pediu a leitura: o clique no Atualizar ou o resto (o laco de 5 s, a volta a aba, o retrato depois de uma acao). */
export type ConsolePollOrigin = "auto" | "click";

export const CONSOLE_POLL_START: ConsolePoll = { notice: "", offline: false };

/**
 * Um passo da leitura do retrato (docs/31 V2-13 e V2-A50): a regiao viva so fala quando algo muda para quem ouve. O
 * "Atualizando…" so no clique no Atualizar (o laco de 5 s e o retrato depois de cada acao nao falam nada); o "Sem
 * resposta" so na passagem para sem resposta (as tentativas seguintes do laco ficam quietas, e o clique o repete); o
 * "Conectado de novo" na volta. O `offline` liga a faixa visivel abaixo do topo, ate a primeira leitura que responde. Sem
 * mudanca, devolve o mesmo objeto (nenhum desenho a mais).
 */
export function consolePollStep(poll: ConsolePoll, input: { origin: ConsolePollOrigin; step: "fail" | "ok" | "start" }): ConsolePoll {
  const click = input.origin === "click";
  switch (input.step) {
    case "start":
      return click && poll.notice !== "atualizando" ? { ...poll, notice: "atualizando" } : poll;
    case "ok":
      if (poll.offline) {
        return { notice: "conectado", offline: false };
      }
      return click && poll.notice !== "" ? { notice: "", offline: false } : poll;
    case "fail":
      return !poll.offline || (click && poll.notice !== "semResposta") ? { notice: "semResposta", offline: true } : poll;
    default:
      return poll;
  }
}

/* ------------------------------------------------------------------------------------------------
 * O foco quando a linha do botao sai da lista (Mãos e a Sala de espera, WCAG 2.4.3)
 * ---------------------------------------------------------------------------------------------- */

/**
 * A linha que recebe o foco quando a do botao clicado sai da lista (`move: "remove"`: Liberar, Abaixar a mão, Silenciar,
 * Admitir) ou vai para o fim (`"end"`: Pular), como o consoleChatFocusAfter do chat (docs/31 V2-15): a linha que fica na
 * mesma posicao depois da troca (a seguinte) ou, sem ela, a ultima. Nula com a lista vazia: quem chama leva o foco ao
 * cabecalho. Quem chama foca antes da troca, porque a linha escolhida ja esta na tela.
 */
export function consoleRowFocusAfter(input: { id: string; ids: readonly string[]; move: "end" | "remove" }): string | null {
  const index = input.ids.indexOf(input.id);
  const rest = input.ids.filter((id) => id !== input.id);
  const after = input.move === "end" && index >= 0 ? [...rest, input.id] : rest;
  if (after.length === 0) {
    return null;
  }
  return after[Math.min(Math.max(0, index), after.length - 1)] ?? null;
}
