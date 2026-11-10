// As regras puras do campo "Adicione um comentário" da sala no estilo do YouTube (docs/31; spec §9.2 e §9.3): quando
// o campo fica aberto (o rodape com o Cancelar e o envio), qual linha ele mostra embaixo e o que cada Enter
// faz no chat e nas Perguntas; e as teclas do campo de responder do fio (replyFieldKey). Sem "use client" e sem
// imports: os testes de modelo carregam este arquivo direto no Node.

export type ComposerEvent = { draft: string; type: "blur" | "cancel" | "focus" | "sent" };

/**
 * O campo aberto e um estado guardado, nunca so o :focus-within: o clique no Enviar tira o foco do campo antes do
 * click, e o rodape sumiria antes de o envio chegar. O foco abre; o Cancelar e o envio fecham; o blur so fecha sem
 * rascunho (com texto, o campo continua aberto sem o foco).
 */
export function composerExpandedStep(state: boolean, event: ComposerEvent): boolean {
  switch (event.type) {
    case "focus":
      return true;
    case "cancel":
    case "sent":
      return false;
    case "blur":
      return state && event.draft.length > 0;
  }
}

/**
 * A linha embaixo do campo: com o foco, a de 2 px no tom do texto ("focus"); aberto, com rascunho e sem o foco, a de
 * 1 px mais forte ("draft", o contorno do campo que perdeu o placeholder); senao, a de 1 px do campo vazio ("idle").
 */
export function composerLine(input: { draft: string; expanded: boolean; focused: boolean }): "draft" | "focus" | "idle" {
  if (input.focused) {
    return "focus";
  }
  return input.expanded && input.draft.length > 0 ? "draft" : "idle";
}

/**
 * O que a tecla faz: no chat ("enter"), o Enter envia e o Shift+Enter quebra a linha; nas Perguntas ("mod-enter"), o
 * Enter quebra a linha e o Ctrl ou o ⌘ com o Enter envia. Durante a composicao de um IME (o acento, o japones), nunca
 * envia: o Enter confirma o texto. Outras teclas, nada. Com o envio em andamento ou o campo desligado (`blocked`), a
 * tecla de envio fica parada ("hold": nem envia de novo, nem quebra a linha), para o mesmo texto nao ir duas vezes.
 */
export function composerKey(input: {
  blocked?: boolean;
  composing: boolean;
  ctrl: boolean;
  key: string;
  meta: boolean;
  mode: "enter" | "mod-enter";
  shift: boolean;
}): "hold" | "newline" | "submit" | null {
  if (input.key !== "Enter" || input.composing) {
    return null;
  }
  const action = input.mode === "enter" ? (input.shift ? "newline" : "submit") : input.ctrl || input.meta ? "submit" : "newline";
  return action === "submit" && input.blocked ? "hold" : action;
}

/**
 * As teclas do campo de responder do fio (RoomReplyField, docs/30 §1.3): o Esc cancela com o foco em qualquer parte do
 * campo (o texto, o Cancelar ou o Responder), e nunca chega a sala, que perguntaria se quer sair; o Ctrl ou o ⌘ com o
 * Enter envia, so com o foco no texto (nos botoes, o Enter e o clique deles).
 */
export function replyFieldKey(input: { ctrl: boolean; inText: boolean; key: string; meta: boolean }): "cancel" | "submit" | null {
  if (input.key === "Escape") {
    return "cancel";
  }
  return input.inText && input.key === "Enter" && (input.ctrl || input.meta) ? "submit" : null;
}
