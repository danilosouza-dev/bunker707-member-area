// Para onde o foco do teclado volta nas entradas Na tela e Roteiro do console (revisao de 11/11/2026, achado 6): o
// formulario que abre no lugar da lista recebe o foco no titulo (tabIndex -1); ao fechar (Voltar, Cancelar, depois de
// enviar ou salvar), o foco volta ao botao que abriu; e depois de Tirar da tela, Desafixar e Excluir, ao botao que ficou,
// ou ao titulo da secao quando o botao saiu da tela junto do item. Como o unpinFromBlock do console-chat, o foco so e
// movido quando ninguem o levou para outro lugar (o foco no body ou num elemento que saiu da pagina). Sem React e sem
// imports: tests/webinarios-na-tela-console-tela.test.mjs carrega direto pelo Node.

/** O que procurar: o botao que abriu (um seletor) e o titulo da secao (o id, com tabIndex -1). */
export type ConsoleFocusAsk = { heading: string; opener: string | null };

type FocusableLike = { disabled?: boolean; focus: () => void; isConnected?: boolean };
type RootLike = { getElementById?: (id: string) => unknown; querySelector: (selector: string) => unknown };

/** O alvo: o botao que abriu, se ainda esta na pagina e ligado; senao o titulo da secao; senao nenhum. */
export function consoleFocusTarget<T extends FocusableLike>(root: RootLike | null | undefined, ask: ConsoleFocusAsk): T | null {
  if (!root) {
    return null;
  }
  const opener = ask.opener ? (root.querySelector(ask.opener) as T | null) : null;
  if (opener && opener.isConnected !== false && !opener.disabled) {
    return opener;
  }
  const heading = (root.getElementById ? root.getElementById(ask.heading) : root.querySelector(`#${ask.heading}`)) as T | null;
  return heading && heading.isConnected !== false ? heading : null;
}

/** O foco esta solto: no body, em lugar nenhum ou num elemento que saiu da pagina (o botao que sumiu com o item). */
export function consoleFocusIsLoose(active: { isConnected?: boolean } | null | undefined, body: unknown): boolean {
  return !active || active === body || active.isConnected === false;
}

/** Move o foco para o alvo do pedido, so com o foco solto (quem levou o foco para outro lugar fica onde esta). */
export function returnConsoleFocus(ask: ConsoleFocusAsk): void {
  if (typeof document === "undefined" || !consoleFocusIsLoose(document.activeElement, document.body)) {
    return;
  }
  consoleFocusTarget<HTMLElement>(document, ask)?.focus();
}
