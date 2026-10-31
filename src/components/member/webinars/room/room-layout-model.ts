// O desenho da sala do aluno V2 (docs/31 §1), a parte pura: os trechos da linha da data no cabecalho do computador
// (V2-3), a linha do celular (V2-18), a margem que a coluna de miniaturas do iframe tira da direita do video, onde os
// selos de baixo (V2-4) e as pilulas do chat nao podem entrar, os botoes da barra da gravada e do Replay (V2-6),
// quando o painel aparece, o toque no balao (V2-7 e V2-8), o esqueleto da live, as abas do painel nas tres salas, o
// contador de mensagens novas do balao, o primeiro foco, quando as pilulas do chat ficam no palco (V2-7 e V2-8) e quando
// o card da Oferta tira do canto as pilulas e o selo do Assistente. Sem "use client" e com imports relativos:
// tests/webinarios-sala-v2-modelo.test.mjs carrega direto pelo Node. Nada aqui le o relogio nem a tela: tudo chega por
// parametro.

import { FILMSTRIP_COLUMN_WIDTH } from "../../../../lib/jitsi-room-config";
import { WEBINAR_COPY } from "../../../../lib/webinar-copy";
import { newMessageCount, type RoomMessage } from "../../../../lib/webinar-room-client";
import { formatWebinarDayLong, saoPauloTime } from "../../../../lib/webinar-time";
import type { RoomDesign, RoomSkeletonState } from "./vertical/vertical-model";

/** O tipo da sala: a Live ao vivo, a Live gravada (simulated) ou o Replay livre. */
export type RoomKind = "live" | "replay" | "simulated";

/**
 * A linha da data do cabecalho do computador (V2-3), em trechos que a tela junta com " · ": "Quinta, 30 de outubro",
 * "20:00", "60 min" e "com Danilo Souza". No Replay sairam a data e a hora (o aluno assiste quando quer); a duracao
 * sem valor (zero ou menos) e o apresentador sem nome omitem o trecho deles.
 */
export function roomDateLine(input: { durationMinutes: number | null; kind: RoomKind; presenterName: string | null; scheduledAt: string | null }): string[] {
  const copy = WEBINAR_COPY.salaV2.cabecalho;
  const parts: string[] = [];
  if (input.kind !== "replay") {
    const day = formatWebinarDayLong(input.scheduledAt);
    const time = saoPauloTime(input.scheduledAt);
    if (day) {
      parts.push(day);
    }
    if (time) {
      parts.push(time);
    }
  }
  if (typeof input.durationMinutes === "number" && Number.isFinite(input.durationMinutes) && input.durationMinutes > 0) {
    parts.push(copy.duracao(Math.round(input.durationMinutes)));
  }
  const presenter = input.presenterName?.trim();
  if (presenter) {
    parts.push(copy.com(presenter));
  }
  return parts;
}

/**
 * A linha do cabecalho abaixo de lg (V2-18), em trechos: "com Danilo Souza" e "128 assistindo". Sem contador (o Replay
 * e a sessao encerrada passam nulo), so o apresentador; sem apresentador, so o contador.
 */
export function roomMobileLine(input: { presenterName: string | null; presentNow: number | null }): string[] {
  const parts: string[] = [];
  const presenter = input.presenterName?.trim();
  if (presenter) {
    parts.push(WEBINAR_COPY.salaV2.cabecalho.com(presenter));
  }
  if (typeof input.presentNow === "number" && Number.isFinite(input.presentNow)) {
    parts.push(WEBINAR_COPY.sala.assistindo(Math.max(0, Math.round(input.presentNow))));
  }
  return parts;
}

/**
 * O selo do momento em cima a esquerda do palco da Live ao vivo (V2-4): no ar, "Ao vivo" com o tempo; antes do
 * "Começar para todos", "Aguardando o apresentador" (o que o cabecalho dizia antes do V2), menos na capa da espera
 * (`screen` waiting: a Sessao de pratica ou a sessao que ainda nao abriu), que ja diz a mesma frase; encerrada, nada
 * (a capa diz que acabou).
 */
export function liveStageMoment(input: { phase: "ended" | "live" | "waiting"; screen: string }): "on_air" | "waiting" | null {
  if (input.phase === "live") {
    return "on_air";
  }
  return input.phase === "waiting" && input.screen !== "waiting" ? "waiting" : null;
}

/** O puxador da coluna de miniaturas do motor: 9 px sem toque e 21 px com toque (jitsi-room-config.ts). */
const FILMSTRIP_HANDLE_PX = { mouse: 9, touch: 21 } as const;

/**
 * Quanto a coluna de miniaturas do iframe ocupa a direita do palco (a variavel --room-video-right): a coluna de 213 px
 * mais o puxador (9 px, ou 21 px num aparelho com toque); sem a coluna, 0. O selo do Assistente e as pilulas do chat
 * descontam esse valor para nunca ficar por cima das miniaturas.
 */
export function stageVideoRightPx(input: { columnShown: boolean; touch?: boolean }): number {
  if (!input.columnShown) {
    return 0;
  }
  return FILMSTRIP_COLUMN_WIDTH + (input.touch ? FILMSTRIP_HANDLE_PX.touch : FILMSTRIP_HANDLE_PX.mouse);
}

/* ------------------------------------------------------------------------------------------------
 * A barra (V2-6) e o painel (V2-7 e V2-8)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Um botao da barra da sala: Sair, Reagir, Levantar a mão, Câmera, Microfone, Som, Tela cheia (ou Modo cinema),
 * Configurações e o balao que abre e fecha o painel do chat.
 */
export type RoomBarItem = "camera" | "fullscreen" | "hand" | "leave" | "mic" | "panel" | "react" | "settings" | "sound";

/** As tres zonas da barra, na ordem da tela: o Sair a esquerda, os circulos no centro, o resto a direita. */
export type RoomBarItems = { center: RoomBarItem[]; left: RoomBarItem[]; right: RoomBarItem[] };

/**
 * A barra da Live gravada e do Replay (V2-6, docs/31 §6: a mesma casca da live): o Sair; no centro Reagir, o Som so na
 * gravada (o player travado nao tem barra; o Replay tem a da Bunny) e a Tela cheia so com o navegador que deixa
 * (document.fullscreenEnabled); a direita, o balao do chat. Sem Configurações (nao ha aparelhos) e sem a visao do video.
 */
export function recordedBarItems(input: { fullscreenEnabled: boolean; kind: "replay" | "simulated" }): RoomBarItems {
  const center: RoomBarItem[] = ["react"];
  if (input.kind === "simulated") {
    center.push("sound");
  }
  if (input.fullscreenEnabled) {
    center.push("fullscreen");
  }
  return { center, left: ["leave"], right: ["panel"] };
}

/**
 * O painel do chat na tela (V2-7 e V2-8): o aluno o abre e fecha pelo balao da barra (guardado no navegador); no celular
 * o painel Configurações aberto toma o lugar dele (`settingsTakeover`). Sem a barra (a live ou a sessao encerrada) o
 * painel fica sempre na tela: o balao que o reabriria saiu junto, e o chat continua para ler.
 */
export function roomPanelShown(input: { barShown: boolean; panelOpen: boolean; settingsTakeover: boolean }): boolean {
  if (!input.barShown) {
    return true;
  }
  return input.panelOpen && !input.settingsTakeover;
}

/**
 * O toque no balao da barra (V2-7 e V2-8): abre e fecha o painel do chat (tambem no computador). No celular com
 * Configurações aberto (`settingsTakeover`), o chat esta escondido por ele: o balao fecha Configurações e mostra o chat,
 * nunca deixa os dois fechados.
 */
export function panelToggleStep(input: { panelShown: boolean; settingsTakeover: boolean }): { closeSettings: boolean; panelOpen: boolean } {
  if (input.settingsTakeover) {
    return { closeSettings: true, panelOpen: true };
  }
  return { closeSettings: false, panelOpen: !input.panelShown };
}

/**
 * O esqueleto da Live ao vivo (V2-6 a V2-8, roomSkeleton): o palco cresce com o painel do chat fora da tela (o balao,
 * ou Configurações no celular), no Modo cinema e na frase de removido ou banido. No celular com Configurações aberto
 * (`settingsTakeover`) o palco divide a coluna com o painel no fluxo e guarda no minimo 96 px (`stageMin`): quem
 * encolhe e o painel, que rola por dentro, e a barra continua na tela, tambem no celular deitado.
 */
export function liveSkeletonState(input: { blocked: boolean; cinema: boolean; panelShown: boolean; settingsTakeover: boolean }): RoomSkeletonState {
  const stageGrows = input.blocked || !input.panelShown || input.cinema;
  return { cinema: input.cinema, panelShown: input.panelShown, stageGrows, stageMin: stageGrows && input.settingsTakeover };
}

/* ------------------------------------------------------------------------------------------------
 * O painel (V2-7 e V2-8): as abas, o contador do balao, o primeiro foco e as pilulas do chat no palco
 * ---------------------------------------------------------------------------------------------- */

/** Uma aba do painel da sala: Chat (no Replay, "Chat da live"), Perguntas, Participantes e Enquetes. */
export type RoomPanelTab = "chat" | "enquetes" | "participantes" | "perguntas";

/**
 * As abas do painel (V2-7), a mesma regra nas tres salas: Chat, Perguntas e Participantes na live e na gravada; o
 * Replay sem Participantes (ninguem esta presente: o aluno assiste quando quer); Enquetes so com enquete aberta, ou
 * com a aba ja escolhida (a enquete que fecha com o aluno nela nao tira a aba de baixo dele). A enquete encerrada com
 * resultado nao abre a aba: o resultado compartilhado aparece no palco (V2-10).
 */
export function panelTabsFor(input: { kind: RoomKind; openPolls: number; tab: RoomPanelTab }): RoomPanelTab[] {
  const tabs: RoomPanelTab[] = ["chat", "perguntas"];
  if (input.kind !== "replay") {
    tabs.push("participantes");
  }
  if (input.openPolls > 0 || input.tab === "enquetes") {
    tabs.push("enquetes");
  }
  return tabs;
}

/**
 * Quem fica em "No palco" na aba Participantes da gravada (V2-7): quem apresenta, quando a pagina sabe o nome; nunca a
 * lista dos alunos (docs/30 §1.3).
 */
export function panelStageNames(presenterName: string | null): string[] {
  const presenter = presenterName?.trim();
  return presenter ? [presenter] : [];
}

/**
 * Quantas mensagens novas chegaram com o painel fechado (o contador do balao, V2-7 e V2-8): as que nao estavam na
 * tela quando o painel fechou (`seenIds`), sem as do proprio aluno. `afterOffsetMs` (so onde o zero do offset nunca
 * muda, panelUnreadMark) e o offset da sala quando o painel fechou: a mensagem mais antiga que ele ja era do chat e nao
 * conta como nova.
 */
export function unreadCount(seenIds: ReadonlySet<string>, messages: readonly RoomMessage[], afterOffsetMs: number | null = null): number {
  const others = messages.filter((message) => !message.mine && (afterOffsetMs === null || message.offsetMs > afterOffsetMs));
  return newMessageCount(seenIds, others);
}

/**
 * O que a sala guarda quando o painel fecha, para o contador do balao: os ids das mensagens que estavam na tela
 * (`seenIds`; nulo enquanto o chat nao fez a primeira leitura, panelUnreadSeen) e, na gravada e no Replay, o offset
 * daquele instante (`afterOffsetMs`). Na Live ao vivo o offset fica de fora: o zero dele anda (a hora marcada na
 * espera, o inicio quando a live comeca atrasada, a ancora da gravacao depois, que o servidor recalcula), e a mensagem
 * nova nasceria com um offset menor que o do fechar. La so os ids contam.
 */
export type PanelUnreadMark = { afterOffsetMs: number | null; seenIds: ReadonlySet<string> | null };

export function panelUnreadMark(input: { chatLoaded: boolean; kind: RoomKind; messages: readonly RoomMessage[]; offsetMs: number }): PanelUnreadMark {
  return {
    afterOffsetMs: input.kind === "live" ? null : input.offsetMs,
    seenIds: input.chatLoaded ? new Set(input.messages.map(({ id }) => id)) : null
  };
}

/**
 * O painel fechou antes da primeira leitura do chat (ele ja monta fechado, a escolha guardada): o que essa leitura
 * trouxe ja era do chat, entao vira o visto. Antes dela, e depois de a marca ter os ids, a marca fica como estava (a
 * mesma, para a tela nao repintar).
 */
export function panelUnreadSeen(mark: PanelUnreadMark, input: { chatLoaded: boolean; messages: readonly RoomMessage[] }): PanelUnreadMark {
  if (mark.seenIds !== null || !input.chatLoaded) {
    return mark;
  }
  return { ...mark, seenIds: new Set(input.messages.map(({ id }) => id)) };
}

/** O numero do balao pela marca do fechar: nada antes da primeira leitura do chat. */
export function panelUnreadCount(mark: PanelUnreadMark, messages: readonly RoomMessage[]): number {
  return mark.seenIds ? unreadCount(mark.seenIds, messages, mark.afterOffsetMs) : 0;
}

/**
 * Onde o foco entra quando a sala abre (o [data-room-first-focus]): na aba Chat com o painel na tela; com ele fechado,
 * no balao da barra, que o reabre (a aba escondida nao recebe foco).
 */
export function firstFocusTarget(input: { panelShown: boolean }): "panel-toggle" | "tab" {
  return input.panelShown ? "tab" : "panel-toggle";
}

/**
 * As ultimas mensagens em pilulas sobre o palco (V2-8): so no desenho normal (o vertical tem o chat dele por cima do
 * video), com o painel fechado e o palco de pe. Saem na frase de removido ou banido (`blocked`), com Configurações
 * no lugar do chat no celular (`settingsTakeover`: o palco fica com 96 px) e com o card da Oferta no palco, que e a
 * unica coisa clicavel da venda e tem a prioridade do canto.
 */
export function chatPillsShown(input: { blocked: boolean; design: RoomDesign; offerShown: boolean; panelShown: boolean; settingsTakeover: boolean }): boolean {
  return input.design === "normal" && !input.panelShown && !input.blocked && !input.settingsTakeover && !input.offerShown;
}

/**
 * O card da Oferta na tela (RoomOffer avisa a sala por onShownChange): ligado (a sessao no ar ou o Replay), com a
 * janela da oferta aberta e o desenho pronto, e nao fechado pelo aluno nesta janela (`closedKey`; a janela seguinte
 * mostra de novo). Enquanto ele esta la, as pilulas do chat (chatPillsShown) e o selo do Assistente
 * (stageAssistantShown) saem do canto.
 */
export function offerOnScreen(input: { closedKey: string | null; enabled: boolean; hasView: boolean; shown: boolean; windowKey: string | null }): boolean {
  return input.enabled && input.shown && input.hasView && input.windowKey !== null && input.windowKey !== input.closedKey;
}

/**
 * O selo do Assistente embaixo a direita do palco da gravada (V2-4): com o Assistente ligado e os selos de baixo na
 * tela (o video no ar, sem a barra da Bunny do Replay), menos com o card da Oferta, que tem o canto.
 */
export function stageAssistantShown(input: { assistantEnabled: boolean; bottomBadges: boolean; offerShown: boolean }): boolean {
  return input.bottomBadges && input.assistantEnabled && !input.offerShown;
}
