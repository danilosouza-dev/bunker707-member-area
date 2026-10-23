// O atalho de salvar das telas que editam um aviso ou um modelo (docs/22 §2.2, docs/24 §2.2, docs/28 D32): Ctrl+Enter
// (⌘+Enter no Mac), ouvido no window. Ele nunca age com o foco num dialogo, num painel ou numa lista aberta por cima
// do editor ("Salvar como modelo", "Salvar design como modelo", "Enviar fonte", a notificacao seguinte, as
// confirmacoes, o menu de uma escolha): o teclado ali e daquela peca. Salvar o aviso por tras do "Salvar como modelo"
// gravava o que estava na tela (num pop-up no ar ou numa notificacao enviada, os alunos viam na hora) e o modelo nao
// era salvo, contra a D11 do docs/28. A lista de uma escolha (Select) e o menu abrem num portal proprio, fora do
// dialogo, por isso entram aqui tambem. Tambem nao age quando outro ouvinte ja tratou a tecla (defaultPrevented).
//
// Puro (sem React nem DOM real): o alvo so precisa de `closest`, o que deixa o teste unitario sem navegador.

export type SaveShortcutEvent = Pick<KeyboardEvent, "altKey" | "ctrlKey" | "defaultPrevented" | "key" | "metaKey" | "target">;

/** Onde o teclado e de outra peca: dialogos (o painel lateral tambem e um), a lista de uma escolha e os menus. */
export const SAVE_SHORTCUT_IGNORED_INSIDE = '[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]';

type ClosestTarget = { closest: (selector: string) => unknown };

function hasClosest(target: unknown): target is ClosestTarget {
  return typeof target === "object" && target !== null && typeof (target as { closest?: unknown }).closest === "function";
}

/** O alvo da tecla esta num dialogo, num painel, na lista de uma escolha ou num menu. */
export function keyTargetInsideOverlay(target: unknown) {
  return hasClosest(target) && Boolean(target.closest(SAVE_SHORTCUT_IGNORED_INSIDE));
}

/** Ctrl+Enter / ⌘+Enter (sem Alt) que o editor deve tratar como "salvar". */
export function isEditorSaveShortcut(event: SaveShortcutEvent) {
  if (event.defaultPrevented || event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.altKey) {
    return false;
  }

  return !keyTargetInsideOverlay(event.target);
}
