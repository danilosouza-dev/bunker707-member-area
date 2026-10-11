// Regras puras da fila "Precisam de resposta" no cliente (teclado J/K/R, rascunho com resposta
// rapida). Sem React: tests/community-queue.test.mjs carrega este arquivo direto.

/** Acrescenta o texto da resposta rapida ao rascunho (substitui se estiver vazio). */
export function insertQuickReply(draft: string, text: string) {
  return draft.trim() ? `${draft.replace(/\s+$/, "")}\n\n${text}` : text;
}

export type QueueKeyCommand = "next" | "previous" | "reply" | null;

/**
 * Atalhos da fila: J proxima, K anterior, R responde. Ignorados com modificador ou digitando
 * (campo, area de texto, select ou conteudo editavel).
 */
export function queueKeyCommand(event: {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  targetIsEditable: boolean;
}): QueueKeyCommand {
  if (event.altKey || event.ctrlKey || event.metaKey || event.targetIsEditable) {
    return null;
  }

  switch (event.key.toLowerCase()) {
    case "j":
      return "next";
    case "k":
      return "previous";
    case "r":
      return "reply";
    default:
      return null;
  }
}

/** Indice seguinte/anterior sem sair da lista; sem item ativo, comeca do primeiro. */
export function moveQueueIndex(current: number, length: number, direction: "next" | "previous") {
  if (length <= 0) {
    return -1;
  }

  if (current < 0 || current >= length) {
    return 0;
  }

  return direction === "next" ? Math.min(length - 1, current + 1) : Math.max(0, current - 1);
}

/** Depois de tirar um item da lista, quem recebe o foco: o seguinte, senao o anterior, senao ninguem. */
export function focusAfterRemoval(ids: readonly string[], removedId: string) {
  const index = ids.indexOf(removedId);

  if (index < 0) {
    return null;
  }

  return ids[index + 1] ?? ids[index - 1] ?? null;
}
