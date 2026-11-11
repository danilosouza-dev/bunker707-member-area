// O desenho da sala do aluno V2 (docs/31 §1), a parte pura: a linha de baixo do titulo no cabecalho do computador, com
// os trechos da data (V2-3), a linha do celular (V2-18), o selo de quem assiste agora no palco (docs/31 §11.5), a
// margem que a coluna de miniaturas do iframe tira da direita do video, onde os selos de baixo (V2-4) e as pilulas do
// chat nao podem entrar, os botoes da barra da gravada e do Replay (V2-6),
// quando o painel aparece, o toque no balao (V2-7 e V2-8), o esqueleto da live, as abas do painel nas tres salas, o
// contador de mensagens novas do balao, o primeiro foco, quando as pilulas do chat ficam no palco (V2-7 e V2-8) e quando
// o card da Oferta tira do canto as pilulas e o selo do Assistente; na sala no estilo do YouTube, as teclas dos menus
// (RoomMenu), o tempo da dica (RoomTooltip) e o toque no trilho a direita (RoomRail). Sem "use client" e com imports relativos: os testes de modelo
// (tests/webinarios-sala-v2-modelo.test.mjs, tests/webinarios-sala-yt-modelo.test.mjs) carregam direto pelo Node. Nada aqui le o relogio nem a tela: tudo chega por
// parametro.
// A Na tela, as fixadas do aluno (especificacao de 10/11/2026, §3.1 e §3.6): quando a mensagem e a enquete fixadas
// aparecem, qual e a enquete fixada na lista do aluno (e as outras, para a aba Enquetes e o card "deixou para depois"),
// quando as pilulas do palco e as linhas da faixa aparecem com o painel fechado, o que a pilula da enquete faz, o texto
// de uma linha da pilula, a dica do corte de 3 (ou 2) linhas antes da medida, o aviso "A equipe fixou uma mensagem."
// so na chegada de uma fixada nova com o painel fechado e o botao de enquete do chat da sala vertical.

import { FILMSTRIP_COLUMN_WIDTH } from "../../../../lib/jitsi-room-config";
import { WEBINAR_COPY } from "../../../../lib/webinar-copy";
import { newMessageCount, type RoomMessage } from "../../../../lib/webinar-room-client";
import { formatWebinarDayLong, saoPauloTime } from "../../../../lib/webinar-time";
import type { DeferredPolls } from "../../../../lib/webinar-room-prefs";
import type { StudentPoll } from "../../../../server/webinars/room-rules";
import { resumePoll, stagePollFor } from "./room-poll-model";
import type { RoomSnack } from "./room-snackbar-model";
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

/** O selo de quem assiste agora no palco: o numero que a tela mostra ("1.234") e a frase inteira ("1.234 assistindo agora"). */
export type RoomPresentBadge = { count: string; label: string };

/**
 * O selo de quem assiste agora, ao lado do selo do momento no palco (decisao do produtor de 10/11/2026, docs/31 §11.5:
 * o numero saiu da linha de baixo do titulo): o numero inteiro, nunca negativo, com o milhar como no Brasil, e a frase
 * inteira para o title e o leitor de tela. Nulo sem contador (o Replay e a sessao encerrada passam nulo): o selo sai.
 */
export function roomPresentBadge(presentNow: number | null): RoomPresentBadge | null {
  if (typeof presentNow !== "number" || !Number.isFinite(presentNow)) {
    return null;
  }
  const count = Math.max(0, Math.round(presentNow));
  return { count: count.toLocaleString("pt-BR"), label: WEBINAR_COPY.salaV2.cabecalho.assistindoAgora(count) };
}

/**
 * A linha do cabecalho abaixo de lg (V2-18): so "com Danilo Souza" (o numero de quem assiste fica no palco, ao lado do
 * selo do momento, roomPresentBadge). Sem apresentador, vazia: a linha sai.
 */
export function roomMobileLine(presenterName: string | null): string {
  const presenter = presenterName?.trim();
  return presenter ? WEBINAR_COPY.salaV2.cabecalho.com(presenter) : "";
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
 * Um botao da barra da sala: Sair, Reagir, Levantar a mão, Câmera, Microfone, Som, Tela cheia (ou Modo cinema), a
 * Visão do vídeo (Palco ou Grade, so na live), Configurações e o balao que abre e fecha o painel do chat.
 */
export type RoomBarItem = "camera" | "fullscreen" | "hand" | "leave" | "mic" | "panel" | "react" | "settings" | "sound" | "view";

/**
 * Os botoes da barra de quem apresenta no console (docs/31 V2-14; consoleBarItemsFor, console-v2-model.ts), que usa a
 * mesma casca e os mesmos circulos da barra da sala: a Sala de espera, Microfone, Câmera, Compartilhar tela, Gravar,
 * Mãos, Lançar enquete, a visao para todos, Configurações e o painel.
 */
export type ConsoleBarItem = "camera" | "hands" | "lobby" | "mic" | "panel" | "poll" | "record" | "settings" | "share" | "view";

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
 * O toque num item do trilho a direita (a sala no estilo do YouTube, a partir de lg): com o painel fechado ou aberto
 * noutra aba, abre o painel naquela aba; no item da aba que esta na tela, fecha o painel, so quando ele pode fechar
 * (`closable`: com a barra na tela, roomPanelShown). Sem a barra (a sessao encerrada) o painel nunca fecha, e o toque
 * no item aberto nao faz nada. A sala calcula o `panelShown` (roomPanelShown) e passa a aba de agora.
 */
export function railStep(input: { closable: boolean; item: RoomPanelTab; panelShown: boolean; tab: RoomPanelTab }): { panelOpen: boolean; tab: RoomPanelTab } {
  if (!input.panelShown || input.tab !== input.item) {
    return { panelOpen: true, tab: input.item };
  }
  return { panelOpen: !input.closable, tab: input.tab };
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

/** A folga que a aba escolhida guarda da borda da linha quando ela rola (o recuo da lista, p-1). */
const TAB_SCROLL_PADDING_PX = 4;

/**
 * A rolagem da linha das abas do painel (V2-7) que deixa a aba escolhida inteira na vista: as quatro abas (com a enquete
 * aberta) nao cabem nos 320 px do painel e a linha rola de lado. `tabLeft` e a posicao da aba no conteudo da linha (ja
 * somada a rolagem de agora), `listWidth` a largura visivel. A aba que ja esta inteira na vista nao mexe na rolagem; a
 * que passa de um lado traz a linha ate ela, com a folga do recuo; nunca negativa.
 */
export function tabScrollLeft(input: { listWidth: number; scrollLeft: number; tabLeft: number; tabWidth: number }): number {
  const { listWidth, scrollLeft, tabLeft, tabWidth } = input;
  if (![listWidth, scrollLeft, tabLeft, tabWidth].every(Number.isFinite) || listWidth <= 0) {
    return Number.isFinite(scrollLeft) ? scrollLeft : 0;
  }
  const pad = TAB_SCROLL_PADDING_PX;
  if (tabLeft - pad < scrollLeft) {
    return Math.max(0, Math.round(tabLeft - pad));
  }
  if (tabLeft + tabWidth + pad > scrollLeft + listWidth) {
    return Math.max(0, Math.round(tabLeft + tabWidth + pad - listWidth));
  }
  return scrollLeft;
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
 * Onde o foco entra quando a sala abre abaixo de lg (o [data-room-first-focus]): na aba Chat com o painel na tela; com
 * ele fechado, no balao da barra, que o reabre (a aba escondida nao recebe foco). A partir de lg o Chat do trilho a
 * direita tem sempre a marca, e a sala foca o primeiro na tela (roomFocusTarget): la a aba e o balao estao escondidos.
 */
export function firstFocusTarget(input: { panelShown: boolean }): "panel-toggle" | "tab" {
  return input.panelShown ? "tab" : "panel-toggle";
}

/**
 * As ultimas mensagens em pilulas sobre o palco (V2-8): so no desenho normal (o vertical tem o chat dele por cima do
 * video), com o painel fechado e o palco de pe. Saem na frase de removido ou banido (`blocked`), com Configurações
 * no lugar do chat no celular (`settingsTakeover`: o palco fica com 96 px) e com o card da Oferta no palco, que e a
 * unica coisa clicavel da venda e tem a prioridade do canto. Um banner ou QR Code da Na tela na fileira de baixo ou na
 * do meio as tira so do palco de 640 px ou mais (screen/room-screen-model.screenPlacement e RoomWideHidden, so CSS): no
 * palco estreito e no baixo o item esta na faixa abaixo do video e elas continuam.
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

/** O que o Esc faz na sala (fora de um campo que o trate antes: o menu da visao, a enquete, a gaveta). */
export type RoomEscapeStep = "close_confirm" | "close_popovers" | "leave" | "poll_later" | "poll_seen";

/**
 * O Esc da sala fecha a camada de cima primeiro: a confirmacao de Sair; senao Reagir, Configurações ou o menu da Visão
 * do vídeo abertos; senao a enquete no meio do palco, como o "Responder depois" (ou o "Fechar" do resultado), com o foco
 * em qualquer lugar da sala: abaixo de lg a folha da enquete cobre a barra e o campo do chat, e o foco que ficou num
 * controle coberto nao teria outro jeito de aparecer (WCAG 2.4.11); so sem nada disso, a sala pergunta se quer sair.
 */
export function roomEscapeStep(input: { confirmLeave: boolean; popoverOpen: boolean; stagePoll: "answer" | "result" | null }): RoomEscapeStep {
  if (input.confirmLeave) {
    return "close_confirm";
  }
  if (input.popoverOpen) {
    return "close_popovers";
  }
  if (input.stagePoll === "answer") {
    return "poll_later";
  }
  if (input.stagePoll === "result") {
    return "poll_seen";
  }
  return "leave";
}

/**
 * A capa "Ativar som" sobre o player da gravada (V2-6): so na gravada (o Replay tem a barra da Bunny) e com o som
 * desligado. No desenho normal ela some depois do primeiro toque no som (a capa ou o Som da barra): silenciar pela
 * barra nao a traz de volta, porque o Som da barra liga de novo. Sem a barra (o vertical 9:16, que nao tem Som nenhum),
 * ela volta sempre que o som esta desligado: quem silenciou deitado e girou para em pe teria o video mudo sem saida.
 */
export function soundCoverShown(input: { barShown: boolean; kind: "replay" | "simulated"; muted: boolean; soundTouched: boolean }): boolean {
  return input.kind === "simulated" && input.muted && (!input.barShown || !input.soundTouched);
}

/**
 * O selo do Assistente embaixo a direita do palco da gravada (V2-4): com o Assistente ligado e os selos de baixo na
 * tela (o video no ar, sem a barra da Bunny do Replay), menos com o card da Oferta, que tem o canto. Um banner ou QR
 * Code da Na tela em "Embaixo, à direita" o tira so do palco de 640 px ou mais (screenPlacement e o
 * `assistantWideHidden` dos selos, so CSS).
 */
export function stageAssistantShown(input: { assistantEnabled: boolean; bottomBadges: boolean; offerShown: boolean }): boolean {
  return input.bottomBadges && input.assistantEnabled && !input.offerShown;
}

/** O que uma tecla faz dentro de um menu aberto da sala (RoomMenu): andar ate uma opcao, fechar ou nada. */
export type MenuKeyStep = { kind: "close"; refocus: boolean } | { index: number; kind: "move" } | { kind: "none" };

/**
 * As teclas dentro de um menu aberto da sala (o RoomMenu; o menu da WAI-ARIA): as setas andam com volta (da ultima
 * opcao para a primeira e ao contrario), Home e End vao as pontas, o Esc fecha e devolve o foco ao botao que abriu
 * (`refocus`), e o Tab fecha sem mexer no foco, que segue para o proximo controle. `index` e a opcao com o foco (fora
 * da lista, a seta para baixo vai a primeira e a para cima a ultima); sem opcoes, so o Esc e o Tab fazem alguma coisa.
 */
export function menuKeyStep(input: { count: number; index: number; key: string }): MenuKeyStep {
  const { count, key } = input;
  if (key === "Escape") {
    return { kind: "close", refocus: true };
  }
  if (key === "Tab") {
    return { kind: "close", refocus: false };
  }
  if (count <= 0) {
    return { kind: "none" };
  }
  const index = input.index >= 0 && input.index < count ? input.index : -1;
  switch (key) {
    case "ArrowDown":
      return { index: index < 0 ? 0 : (index + 1) % count, kind: "move" };
    case "ArrowUp":
      return { index: index < 0 ? count - 1 : (index - 1 + count) % count, kind: "move" };
    case "Home":
      return { index: 0, kind: "move" };
    case "End":
      return { index: count - 1, kind: "move" };
    default:
      return { kind: "none" };
  }
}

/** As teclas que abrem um menu com o foco no botao dele: a seta para baixo, o Enter e o Espaco. */
export function menuOpenKey(key: string): boolean {
  return key === "ArrowDown" || key === "Enter" || key === " ";
}

/** A dica da sala (RoomTooltip): escondida, esperando para aparecer, na tela, ou saindo (ainda na tela). */
export type TooltipState = "hidden" | "hiding" | "shown" | "showing";

/**
 * O que chega a dica: o ponteiro entra ou sai (`toTooltip`: ele foi para a propria dica; `focused`: o foco do teclado
 * continua no botao), o foco do teclado entra ou sai (`hovered`: o ponteiro continua em cima), o Esc, e o fim da espera
 * (`elapsed`, depois do tempo que tooltipStep devolveu).
 */
export type TooltipEvent =
  | { hovered?: boolean; kind: "blur" }
  | { kind: "elapsed" }
  | { kind: "enter" }
  | { kind: "escape" }
  | { kind: "focus" }
  | { focused?: boolean; kind: "leave"; toTooltip?: boolean };

/** Os tempos da dica do YouTube: aparece 150 ms depois do ponteiro ou do foco e some em 75 ms. */
export const TOOLTIP_DELAYS_MS = { hide: 75, show: 150 } as const;

/**
 * Um passo da dica da sala (o tooltip do YouTube; WCAG 1.4.13). O ponteiro ou o foco do teclado a chamam, e ela so
 * aparece depois de 150 ms (`showing` ainda nao esta na tela); so quando os dois saem ela fica 75 ms saindo, e quem
 * volta nesse tempo a mantem: o ponteiro que passa e sai nao a esconde com o foco do teclado ainda no botao, nem o foco
 * que sai com o ponteiro ainda em cima (WCAG 1.4.13, persistente). O ponteiro que vai do botao para a propria dica
 * tambem nao a esconde (da para ler um texto comprido).
 * O Esc a esconde na hora e so para ali (`stopped`: o Esc nao chega a sala, que perguntaria se quer sair) quando ela
 * estava na tela. `delayMs` e a espera ate o proximo `elapsed` (null: nenhuma).
 */
export function tooltipStep(state: TooltipState, event: TooltipEvent): { delayMs: number | null; state: TooltipState; stopped: boolean } {
  const next = tooltipNext(state, event);
  const delayMs = next === "showing" ? TOOLTIP_DELAYS_MS.show : next === "hiding" ? TOOLTIP_DELAYS_MS.hide : null;
  const stopped = event.kind === "escape" && (state === "shown" || state === "hiding");
  return { delayMs, state: next, stopped };
}

function tooltipNext(state: TooltipState, event: TooltipEvent): TooltipState {
  switch (event.kind) {
    case "enter":
    case "focus":
      return state === "hidden" ? "showing" : state === "hiding" ? "shown" : state;
    case "leave":
    case "blur":
      // O outro (o foco no botao, o ponteiro em cima ou sobre a propria dica) ainda a segura.
      if (event.kind === "leave" ? event.toTooltip || event.focused : event.hovered) {
        return state;
      }
      return state === "showing" ? "hidden" : state === "shown" ? "hiding" : state;
    case "escape":
      return "hidden";
    case "elapsed":
      return state === "showing" ? "shown" : state === "hiding" ? "hidden" : state;
  }
}

/* ------------------------------------------------------------------------------------------------
 * A Na tela: a mensagem e a enquete fixadas do aluno (especificacao de 10/11/2026, §3.1 e §3.6)
 * ---------------------------------------------------------------------------------------------- */

/**
 * As fixadas aparecem na Live ao vivo e na gravada, na espera e no ar (§3.6). No Replay (sem equipe), com a sessao
 * encerrada (ou o video da gravada no fim) e para quem foi removido, banido ou saiu do acesso, nao: a area, as pilulas,
 * as linhas da faixa e o aviso saem juntos.
 */
export function pinnedShownIn(input: { blocked: boolean; kind: RoomKind; phase: string }): boolean {
  return input.kind !== "replay" && input.phase !== "ended" && !input.blocked;
}

/**
 * A enquete fixada, como o aluno a tem (a lista da sala, useRoomPolls): a aberta ou a encerrada com o resultado
 * compartilhado. A que saiu da lista (encerrada sem compartilhar, que a equipe desafixa) ou que ainda nao chegou na
 * leitura das enquetes fica de fora: nada fixado aparece sem a enquete de verdade.
 */
export function pinnedPollFor(input: { pinnedPollId: string | null; polls: readonly StudentPoll[] }): StudentPoll | null {
  if (!input.pinnedPollId) {
    return null;
  }
  return input.polls.find((poll) => poll.id === input.pinnedPollId) ?? null;
}

/**
 * As enquetes sem a fixada: a aba Enquetes (o cartao fixado nao se repete, ele ja esta na area das fixadas, em toda aba)
 * e o card "você deixou para depois" (o "Responder depois" da enquete fixada manda para a area das fixadas).
 */
export function unpinnedPolls<T extends Pick<StudentPoll, "id">>(polls: readonly T[], pinnedPollId: string | null): T[] {
  return pinnedPollId ? polls.filter((poll) => poll.id !== pinnedPollId) : [...polls];
}

/**
 * As pilulas das fixadas no palco (a partir de 640 px de palco) e as linhas da faixa abaixo dele (o palco mais
 * estreito): so no desenho normal (o vertical tem a linha dele acima do chat), com o painel fechado (aberto, a area
 * das fixadas ja esta nele, em toda aba) e fora da frase de removido ou banido e de Configurações no lugar do chat no
 * celular (o palco fica com 96 px).
 */
export function pinnedPillsShown(input: { blocked: boolean; design: RoomDesign; panelShown: boolean; settingsTakeover: boolean }): boolean {
  return input.design === "normal" && !input.panelShown && !input.blocked && !input.settingsTakeover;
}

/**
 * O toque na pilula "Enquete fixada · {pergunta}" (e na linha dela na faixa): a enquete aberta que o aluno ainda nao
 * respondeu volta ao meio do palco (`stage`, como o Responder agora, deixada para depois ou nao); respondida ou
 * encerrada com o resultado, abre o painel, onde a area das fixadas a mostra (`panel`).
 */
export function pinnedPollPillStep(poll: Pick<StudentPoll, "myOptionIds" | "status">): "panel" | "stage" {
  return poll.status === "open" && poll.myOptionIds === null ? "stage" : "panel";
}

/**
 * O toque na pilula ou na linha da enquete fixada, com a sala inteira: o palco (`stage`, o Responder agora) so quando,
 * depois dele, ela e mesmo a enquete que o palco mostra (stagePollFor: a primeira aberta sem resposta que nao ficou para
 * depois). Com outra enquete sem resposta antes dela na lista, o palco mostraria a outra e o toque nao faria nada: abre
 * o painel, onde a area das fixadas a mostra (`panel`), como a respondida ou encerrada (pinnedPollPillStep).
 */
export function pinnedPollTapStep(input: { deferred: DeferredPolls; poll: StudentPoll; polls: readonly StudentPoll[]; seenResultIds: readonly string[] }): "panel" | "stage" {
  if (pinnedPollPillStep(input.poll) === "panel") {
    return "panel";
  }
  const next = stagePollFor({ deferredIds: resumePoll(input.deferred, input.poll.id).later, polls: input.polls, seenResultIds: input.seenResultIds });
  return next?.mode === "answer" && next.poll.id === input.poll.id ? "stage" : "panel";
}

/** O texto da mensagem fixada numa linha so (a pilula do palco): os espacos e as quebras viram um espaco. */
export function pinnedPillText(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

/** Quantos caracteres cabem numa linha da fixada, por baixo (o painel de 320 px e o vertical de 375 px). */
const PINNED_LINE_CHARS = 38;

/**
 * A dica do corte antes da medida (o HTML do servidor e a primeira pintura): o texto que pode passar de `lines` linhas
 * (mais quebras que linhas, ou mais letras do que cabem) ja mostra o "Mostrar tudo"; depois de montar, a sala mede o
 * corte de verdade e a dica sai (useClampToggle).
 */
export function pinnedClampHint(body: string, lines: number): boolean {
  const text = body.trim();
  return text.split("\n").length > lines || text.length > lines * PINNED_LINE_CHARS;
}

/**
 * O aviso da sala "A equipe fixou uma mensagem." (com Ver): so na chegada de uma fixada nova (o id muda para outro que
 * nao e nulo) com o painel fechado e as fixadas na tela (`shown`: o desenho normal, sem removido nem banido). A fixada
 * que ja estava quando a sala abriu (`before` indefinido, a primeira leitura) e a que sai (nulo) nao avisam; aberto, o
 * painel ja mostra a area das fixadas.
 */
export function pinnedNoticeShown(input: { after: string | null; before: string | null | undefined; panelShown: boolean; shown: boolean }): boolean {
  return input.before !== undefined && input.after !== null && input.after !== input.before && !input.panelShown && input.shown;
}

/** A acao "Ver" do aviso da fixada: abre o painel no Chat, com o foco na fixada. */
export const PINNED_SNACK_ACTION = "pinned_view";

/** O aviso da fixada nova (RoomSnackbar): a frase e a acao Ver. */
export function pinnedSnack(): RoomSnack {
  const aluno = WEBINAR_COPY.naTela.aluno;
  return { action: { key: PINNED_SNACK_ACTION, label: aluno.ver }, key: "pinned", text: aluno.avisoFixou };
}

/**
 * O botao de enquete do chat da sala vertical (§3.4): com a enquete fixada, "Enquete fixada: {pergunta}", que continua
 * la depois da resposta (e com o resultado compartilhado); sem ela, a primeira enquete aberta, como antes; sem
 * nenhuma, nada.
 */
export function verticalPollButton(input: { openPolls: readonly Pick<StudentPoll, "question">[]; pinnedPoll: Pick<StudentPoll, "question"> | null }): { label: string; pinned: boolean } | null {
  if (input.pinnedPoll) {
    return { label: WEBINAR_COPY.naTela.aluno.enqueteFixadaVertical(input.pinnedPoll.question), pinned: true };
  }
  const first = input.openPolls[0];
  return first ? { label: first.question, pinned: false } : null;
}
