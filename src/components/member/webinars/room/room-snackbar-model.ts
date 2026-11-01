// O aviso da sala no estilo do YouTube (o snackbar invertido; RoomSnackbar), a parte pura: um aviso de cada vez, o
// tempo que falta (parado com o ponteiro em cima ou o foco dentro, WCAG 2.2.1) e o lugar dele na tela. Sem React, sem
// "use client" e com imports relativos: tests/webinarios-sala-avisos-modelo.test.mjs carrega direto pelo Node. Nada
// aqui le o relogio nem a tela: tudo chega por parametro.

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
