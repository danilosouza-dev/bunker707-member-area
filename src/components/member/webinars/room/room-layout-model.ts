// O desenho da sala do aluno V2 (docs/31 §1), a parte pura: os trechos da linha da data no cabecalho do computador
// (V2-3), a linha do celular (V2-18), a margem que a coluna de miniaturas do iframe tira da direita do video, onde os
// selos de baixo (V2-4) e as pilulas do chat nao podem entrar, os botoes da barra da gravada e do Replay (V2-6),
// quando o painel aparece, o toque no balao (V2-7 e V2-8) e o esqueleto da live. Sem "use client" e com imports
// relativos: tests/webinarios-sala-v2-modelo.test.mjs carrega direto pelo Node. Nada aqui le o relogio nem a tela:
// tudo chega por parametro.

import { FILMSTRIP_COLUMN_WIDTH } from "../../../../lib/jitsi-room-config";
import { WEBINAR_COPY } from "../../../../lib/webinar-copy";
import { formatWebinarDayLong, saoPauloTime } from "../../../../lib/webinar-time";
import type { RoomSkeletonState } from "./vertical/vertical-model";

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
