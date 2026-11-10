// Sair do console com a sala no ar (docs/31 §10). A sala ao vivo mora na pagina do console (o iframe do useJitsiMeet
// dentro do palco): trocar de pagina na mesma aba desmonta o console, o iframe sai junto e quem apresenta sai da sala.
// Para quem assiste, o video dele para ("congela") ate o servidor da sala dar a saida por encerrada, e so volta quando
// ele abre o console de novo. A regra: com quem esta no console dentro da sala, toda saida da pagina pede confirmacao
// (a janela de console-leave-dialog.tsx), com a nova aba como saida sem cair; o Sair confirmado sai da sala primeiro
// (hangup, para quem assiste ver a saida na hora, e nao o video parado) e so entao troca de pagina. Modulo puro (so
// texto e numeros): tests/webinarios-console-sair-modelo.test.mjs carrega direto.

/** De onde veio o pedido de sair: um link (a seta, Ver relatorio), o Voltar do navegador ou o seletor de sessoes. */
export type ConsoleLeaveKind = "back" | "link" | "session";

/** O pedido de sair que espera a resposta da janela: para onde ia e por onde. */
export type ConsoleLeaveTarget = { href: string; kind: ConsoleLeaveKind };

/** Quanto o Sair confirmado espera a sala dar a saida (o videoConferenceLeft) antes de trocar de pagina de todo jeito. */
export const CONSOLE_LEAVE_WAIT_MS = 1_500;

/** A saida pede confirmacao so com o console dentro da sala (o videoConferenceJoined do proprio iframe). */
export function consoleLeaveGuarded(input: { joined: boolean }): boolean {
  return input.joined;
}

export type ConsoleLinkClick = {
  /** O botao do mouse (0 = o principal). */
  button: number;
  /** O endereco da pagina agora (location.href). */
  currentHref: string;
  /** O link baixa um arquivo (o atributo download). */
  download: boolean;
  /** O href do link como esta no HTML; nulo sem href. */
  href: string | null;
  /** Com Ctrl, ⌘, Shift ou Alt o navegador abre em outra aba ou janela (ou baixa): a sala fica. */
  modified: boolean;
  /** O target do link (_blank abre em outra aba). */
  target: string | null;
};

/**
 * O clique num link sai da pagina do console nesta aba? Devolve o endereco inteiro para a confirmacao, ou nulo quando
 * o clique deixa a sala onde esta: outro botao do mouse, com tecla, `target` que nao e a propria aba, `download`, um
 * esquema que nao troca de pagina (mailto:, tel:, javascript:), so a ancora da mesma pagina ou o mesmo endereco.
 * Um link de outra origem na mesma aba tambem sai (a pagina inteira troca).
 */
export function consoleLinkLeave(click: ConsoleLinkClick): string | null {
  if (click.href === null || click.button !== 0 || click.modified || click.download) {
    return null;
  }
  const target = click.target?.trim().toLowerCase() ?? "";
  if (target !== "" && target !== "_self") {
    return null;
  }
  let next: URL;
  let current: URL;
  try {
    current = new URL(click.currentHref);
    next = new URL(click.href, current);
  } catch {
    return null;
  }
  if (next.protocol !== "http:" && next.protocol !== "https:") {
    return null;
  }
  if (next.origin === current.origin && next.pathname === current.pathname && next.search === current.search) {
    return null;
  }
  return next.href;
}
