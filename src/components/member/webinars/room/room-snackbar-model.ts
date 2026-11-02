// O aviso da sala no estilo do YouTube (o snackbar invertido; RoomSnackbar), a parte pura: um aviso de cada vez, o
// tempo que falta (parado com o ponteiro em cima ou o foco dentro, WCAG 2.2.1) e o lugar dele na tela. Sem React, sem
// "use client" e com imports relativos: tests/webinarios-sala-avisos-modelo.test.mjs carrega direto pelo Node. Nada
// aqui le o relogio nem a tela: tudo chega por parametro.

import { WEBINAR_COPY } from "../../../../lib/webinar-copy";

/**
 * Um aviso: `key` e o tipo (o mesmo tipo repetido so reinicia o tempo), `text` a frase inteira (o leitor de tela le
 * tudo, mesmo quando a caixa corta em duas linhas), `action` a pilula de texto opcional (o nome e a frase exata) e
 * `persistent` o aviso "enquanto durar", sem tempo (a troca de aparelho), que quem mostra trata fora daqui.
 */
export type RoomSnack = { action?: { key: string; label: string }; key: string; persistent?: boolean; text: string };

/** O mesmo conteudo (o tipo, a frase e a acao): o aviso repetido, que so reinicia o tempo. */
function sameSnack(a: RoomSnack, b: RoomSnack): boolean {
  return a.key === b.key && a.text === b.text && a.persistent === b.persistent && a.action?.key === b.action?.key && a.action?.label === b.action?.label;
}

/**
 * O aviso que fica na tela quando chega outro: um de cada vez. O novo troca o atual na hora (`restart` falso: ele
 * entra de novo, com o movimento); o mesmo tipo (`key`) so reinicia o tempo (`restart` verdadeiro), sem entrar de novo,
 * e continua o mesmo aviso quando nada nele mudou (a frase nova do mesmo tipo toma o lugar da antiga, no mesmo lugar).
 */
export function nextSnackbar(current: RoomSnack | null, incoming: RoomSnack): { restart: boolean; snack: RoomSnack } {
  if (current && current.key === incoming.key) {
    return { restart: true, snack: sameSnack(current, incoming) ? current : incoming };
  }
  return { restart: false, snack: incoming };
}

/**
 * O aviso "enquanto durar" (`persistent`, a troca de aparelho) que outro tomou o lugar (o "Pergunta enviada.", a
 * mensagem removida) volta quando a caixa fica vazia e ele ainda vale: devolve o aviso para mostrar de novo, ou nulo.
 * Os passageiros nunca voltam (quem os mostrou ja os tirou pelo onGone).
 */
export function snackToRestore(notice: RoomSnack | null, shown: RoomSnack | null): RoomSnack | null {
  return notice?.persistent === true && shown === null ? notice : null;
}

/**
 * Quanto falta para o aviso sumir: `durationMs` (os 6 s da sala) menos o tempo ja contado (`elapsedMs`, so o tempo
 * fora das pausas), nunca abaixo de 0 (0: some agora). Em pausa (o ponteiro em cima ou o foco dentro) nao some: null,
 * e o tempo volta a contar de onde parou quando a pausa acaba.
 */
export function snackbarRemainingMs(input: { durationMs: number; elapsedMs: number; paused: boolean }): number | null {
  if (input.paused) {
    return null;
  }
  return Math.max(0, input.durationMs - Math.max(0, input.elapsedMs));
}

/** O que segura o tempo do aviso, cada um no seu: o ponteiro em cima e o foco dentro. */
export type SnackbarHold = { focus: boolean; pointer: boolean };

/** Nada segurando: o tempo conta. */
export const SNACKBAR_HOLD_FREE: SnackbarHold = { focus: false, pointer: false };

/**
 * Um passo da pausa do aviso (WCAG 2.2.1): o tempo para com o ponteiro em cima OU o foco dentro, e so volta a contar
 * quando os dois saem. `change` e o que mudou (o ponteiro entrou ou saiu, o foco entrou ou saiu, ou o foco conferido na
 * tela depois que a caixa trocou ou saiu, levando junto o botao focado). `paused` e o novo valor so quando ele muda
 * (null: nada a dizer a quem mostra; o foco que anda do texto para a acao, ou o ponteiro que sai com o foco dentro).
 */
export function snackbarHoldStep(hold: SnackbarHold, change: Partial<SnackbarHold>): { hold: SnackbarHold; paused: boolean | null } {
  const next = { ...hold, ...change };
  const before = hold.focus || hold.pointer;
  const after = next.focus || next.pointer;
  return { hold: next, paused: before === after ? null : after };
}

/**
 * Onde o aviso fica: no palco (`stage`), preso ao pe da tela (`screen`), logo acima do campo da folha aberta (`sheet`)
 * ou no pe da coluna do painel ao lado (`side`). A classe de cada lugar e de quem mostra o aviso.
 */
export type SnackbarPlacement = "screen" | "sheet" | "side" | "stage";

/**
 * O lugar do aviso: a partir de lg, no palco (o canto de baixo a esquerda, acima do selo de quem apresenta). Abaixo de
 * lg, em pe, nunca sobre o video (o palco tem pouco mais de 200 px de altura): acima do campo com a folha aberta, ou
 * preso ao pe da tela com ela fechada. Deitado, no pe da coluna do painel quando ele esta ao lado; com o painel
 * fechado, no palco, que entao ocupa a tela.
 */
export function snackbarPlacement(input: { desktop: boolean; landscape: boolean; panelShown: boolean }): SnackbarPlacement {
  if (input.desktop) {
    return "stage";
  }
  if (input.landscape) {
    return input.panelShown ? "side" : "stage";
  }
  return input.panelShown ? "sheet" : "screen";
}

/* ------------------------------------------------------------------------------------------------
 * Os avisos do motor (notificationTriggered) e a gravacao que comecou
 * ---------------------------------------------------------------------------------------------- */

/** Os avisos do motor que viram aviso nosso: o microfone sem som (na sala e no console) e os dois da tela (so no console). */
export type EngineNoticeKey = "mic_no_signal" | "screen_denied" | "screen_failed";

/** A acao do aviso que abre o painel Configurações (o nome e o do botao da barra). */
export const SNACK_SETTINGS_ACTION = "settings";

/** O aviso nosso de cada aviso do motor que entra: a frase nossa (nunca o texto do motor) e, no microfone, a acao. */
export function engineSnack(key: EngineNoticeKey): RoomSnack & { key: EngineNoticeKey } {
  const avisos = WEBINAR_COPY.salaV2.avisos;
  switch (key) {
    case "mic_no_signal":
      return { action: { key: SNACK_SETTINGS_ACTION, label: WEBINAR_COPY.aoVivo.configuracoes }, key, text: avisos.semSomDoMicrofone };
    case "screen_denied":
      return { key, text: avisos.telaNegada };
    case "screen_failed":
      return { key, text: avisos.telaFalhou };
  }
}

function textField(payload: unknown, name: string): { ok: boolean; value: string | null } {
  if (!payload || typeof payload !== "object") {
    return { ok: false, value: null };
  }
  const value = (payload as Record<string, unknown>)[name];
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  return typeof value === "string" ? { ok: true, value } : { ok: false, value: null };
}

/**
 * O aviso nosso de um notificationTriggered do motor ({ title, description }, as chaves de traducao da tag fixada), ou
 * nulo. So a lista fechada entra: `toolbar.noAudioSignalTitle` (o microfone ligado sem som) com o microfone ligado, e as
 * duas da tela (`dialog.screenSharingFailedTitle` com a descricao da permissao negada ou da falha) so no console. O
 * `title` e a `description` precisam ser texto (ou faltar); o payload que traz nome ou texto de alguem (`name`, `text`)
 * e qualquer outra chave do motor dao nulo: nada do iframe chega a tela como frase.
 */
export function engineNoticeOf(payload: unknown, ctx: { audioOn: boolean; surface: "console" | "room" }): RoomSnack | null {
  const title = textField(payload, "title");
  const description = textField(payload, "description");
  if (!title.ok || !description.ok) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (record.name !== undefined || record.text !== undefined) {
    return null;
  }
  if (title.value === "toolbar.noAudioSignalTitle") {
    return ctx.audioOn ? engineSnack("mic_no_signal") : null;
  }
  if (title.value === "dialog.screenSharingFailedTitle" && ctx.surface === "console") {
    if (description.value === "dialog.screenSharingPermissionDeniedError") {
      return engineSnack("screen_denied");
    }
    if (description.value === "dialog.screenSharingFailed") {
      return engineSnack("screen_failed");
    }
  }
  return null;
}

/**
 * A gravacao que comecou com o aluno na sala ("Esta live começou a ser gravada."): so a virada de desligada para ligada
 * com ele dentro antes e depois (`joined`). Ja ligada na entrada nao avisa (o selo Gravando ja diz), nem desligar.
 */
export function shouldAnnounceRecording(prev: boolean, next: boolean, joined: boolean): boolean {
  return joined && !prev && next;
}
