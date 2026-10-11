// Regras puras da moderacao nas abas Comentarios e Denuncias: quais acoes cada situacao oferece,
// textos dos avisos, selecao em massa e como desfazer. Sem React: tests/community-queue.test.mjs
// carrega este arquivo direto.

export type ModerationStatus = "approved" | "hidden" | "spam";
export type CommentStatusValue = ModerationStatus | "pending";

export type RowModerationAction = {
  label: string;
  status: ModerationStatus;
};

/**
 * Ate duas acoes na propria linha (docs/17 §2.7): visivel -> Ocultar / Spam; aguardando -> Aprovar /
 * Ocultar; oculto ou spam -> Restaurar.
 */
export function rowModerationActions(status: CommentStatusValue): RowModerationAction[] {
  switch (status) {
    case "approved":
      return [
        { label: "Ocultar", status: "hidden" },
        { label: "Spam", status: "spam" }
      ];
    case "pending":
      return [
        { label: "Aprovar", status: "approved" },
        { label: "Ocultar", status: "hidden" }
      ];
    default:
      return [{ label: "Restaurar", status: "approved" }];
  }
}

const SINGULAR: Record<ModerationStatus, string> = {
  approved: "Comentário visível de novo",
  hidden: "Comentário ocultado",
  spam: "Comentário marcado como spam"
};

const PLURAL: Record<ModerationStatus, (count: string) => string> = {
  approved: (count) => `${count} comentários visíveis de novo`,
  hidden: (count) => `${count} comentários ocultados`,
  spam: (count) => `${count} comentários marcados como spam`
};

/** Texto do aviso de sucesso: "Comentário ocultado", "3 comentários ocultados". */
export function moderationToastMessage(status: ModerationStatus, count: number) {
  return count === 1 ? SINGULAR[status] : PLURAL[status](new Intl.NumberFormat("pt-BR").format(count));
}

/** Aviso quando parte da selecao nao mudou (excluida ou alterada no meio). */
export function bulkFailureMessage(failed: number) {
  if (failed <= 0) {
    return null;
  }

  return failed === 1
    ? "1 comentário não pôde ser alterado: ele foi excluído ou mudou há instantes. Recarregue a lista."
    : `${new Intl.NumberFormat("pt-BR").format(failed)} comentários não puderam ser alterados: foram excluídos ou mudaram há instantes. Recarregue a lista.`;
}

/**
 * "Desfazer" de uma moderacao: volta cada comentario para a situacao anterior, agrupando por situacao
 * (uma chamada por grupo). "Aguardando" nao volta (a moderacao so grava visivel, oculto ou spam).
 */
export function undoGroups(previous: ReadonlyMap<string, CommentStatusValue> | Record<string, CommentStatusValue>, changedIds: readonly string[]) {
  const lookup = previous instanceof Map ? previous : new Map(Object.entries(previous));
  const groups = new Map<ModerationStatus, string[]>();

  for (const id of changedIds) {
    const status = lookup.get(id);

    if (!status || status === "pending") {
      continue;
    }

    const list = groups.get(status) ?? [];
    list.push(id);
    groups.set(status, list);
  }

  return Array.from(groups.entries()).map(([status, ids]) => ({ ids, status }));
}

/** Marca ou desmarca um comentario na selecao (devolve um novo conjunto). */
export function toggleSelected(selected: ReadonlySet<string>, id: string) {
  const next = new Set(selected);

  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }

  return next;
}

/** "Selecionar todos" da pagina: se todos ja estao marcados, desmarca a pagina; senao, marca todos. */
export function toggleAllSelected(selected: ReadonlySet<string>, pageIds: readonly string[], limit: number) {
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const next = new Set(selected);

  if (allSelected) {
    for (const id of pageIds) {
      next.delete(id);
    }

    return next;
  }

  for (const id of pageIds) {
    if (next.size >= limit) {
      break;
    }

    next.add(id);
  }

  return next;
}

/** Estado do "Selecionar todos": marcado, parcial ou vazio. */
export function selectionState(selected: ReadonlySet<string>, pageIds: readonly string[]) {
  const count = pageIds.filter((id) => selected.has(id)).length;

  return count === 0 ? "none" : count === pageIds.length ? "all" : "some";
}

/** Mantem na selecao so os ids que continuam na pagina (depois de filtrar ou recarregar). */
export function pruneSelection(selected: ReadonlySet<string>, pageIds: readonly string[]) {
  const visible = new Set(pageIds);
  const next = new Set(Array.from(selected).filter((id) => visible.has(id)));

  return next.size === selected.size ? selected : next;
}
