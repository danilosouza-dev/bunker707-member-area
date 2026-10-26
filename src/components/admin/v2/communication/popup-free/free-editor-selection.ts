// Editor Livre do pop-up, L4b (docs/27 §13.10): a selecao de varios, pura e testavel. Quem esta escolhido (so ids
// vivos, sem repetidos, nunca uma caixa junto com algo dentro dela), por ou tirar, o intervalo das Camadas, o
// Ctrl + A, o Esc ao pai comum, a pilha do Alt + clique, e os comandos de varios, cada um num design novo so (o editor
// grava um passo por comando): mover junto (com o limite comum do grupo), alinhar entre si e no pop-up (cada um), os
// espacos iguais, duplicar (Links, Áudio e o que tem Vídeo ficam de fora), excluir (Links e Áudio ficam), esconder,
// travar e a camada. Mais as frases de varios (FREE_SELECTION_COPY) e o motivo de cada botao desligado do painel
// Varios (freeManyReasons).
//
// A selecao fica fora do design, do historico e da copia de recuperacao: nada aqui grava a selecao, so x e y que ja
// existem (em place ou em devices.mobile, como as setas de um elemento).
//
// Modulo puro, sem JSX nem janela, imports relativos (tests/popup-livre-selecao-modelo.test.mjs carrega direto pelo
// Node). Usa so o que free-editor-model.ts e free-editor-geometry.ts ja exportam; nenhum dos dois importa este.

import { findFreeNode, walkFreeNodes, type FreeAbsolutePlace, type FreeId, type FreeNode, type PopupFreeDesign } from "../../../../../server/communications/popup-free-model";
import type { FreeMeasuredRects } from "../../../../../server/communications/popup-free-checks";
import type { NoticeDraft } from "../../../../../server/communications/schemas";
import {
  duplicateFreeNode,
  freeArrowCoalesceKey,
  freeDuplicateProblem,
  freeMobileFreePlace,
  freeNodeTypeLabel,
  freeParentId,
  freeSelectionDescription,
  removeFreeNode,
  setFreeNodeFlag,
  setFreeNodeRect,
  shiftFreeNodeLayer,
  type FreeDevice
} from "./free-editor-model";
import { freeAlignDelta, freeBoundsOf, freeDistributeDeltas, freeGroupDelta, freeRectOfPlace, freeVisualRect, type FreeAlignEdge, type FreeRect } from "./free-editor-geometry";

/* ------------------------------------------------------------------------------------------------
 * Frases de varios (palavra por palavra do plano do L4b)
 * ---------------------------------------------------------------------------------------------- */

/** "1 elemento", "3 elementos". */
function elements(count: number): string {
  return count === 1 ? "1 elemento" : `${count} elementos`;
}

/** Concordancia do numero: "1 elemento duplicado", "3 elementos duplicados". */
function counted(count: number, one: string, many: string): string {
  return count === 1 ? `1 elemento ${one}` : `${count} elementos ${many}`;
}

const ALIGN_EDGE_LABELS: Record<FreeAlignEdge, string> = {
  bottom: "Alinhar embaixo",
  center: "Alinhar ao centro",
  left: "Alinhar à esquerda",
  middle: "Alinhar no meio",
  right: "Alinhar à direita",
  top: "Alinhar em cima"
};

const SCOPE_LABELS = { artboard: "no pop-up", selection: "entre si" } as const;

/** Onde o alinhar de varios mede: na prancheta (cada um) ou na caixa que envolve os escolhidos. */
export type FreeAlignScope = keyof typeof SCOPE_LABELS;

export const FREE_SELECTION_COPY = {
  /** Depois do Ctrl + A e do intervalo das Camadas. */
  chosen: (count: number) => (count === 1 ? "1 elemento escolhido." : `${count} elementos escolhidos.`),
  /** Shift, Ctrl ou ⌘ + clique (e Ctrl + Enter nas Camadas). Sem ninguem depois de tirar: "Nada selecionado.". */
  toggledIn: (name: string, count: number) => `${name} entrou na seleção. ${elements(count)}.`,
  toggledOut: (name: string, count: number) => `${name} saiu da seleção. ${count === 0 ? "Nada selecionado" : elements(count)}.`,
  /** Alt + clique: o escolhido e onde ele esta na pilha do ponto. */
  stack: (name: string, index: number, total: number) => `Selecionado: ${name} (${index} de ${total} neste ponto).`,
  /** A descricao do palco com varios: ate 5 nomes e depois " e mais N". */
  description: (names: readonly string[]) => {
    const shown = names.slice(0, 5).join(", ");
    const more = names.length > 5 ? ` e mais ${names.length - 5}` : "";

    return `Selecionados: ${elements(names.length)} (${shown}${more}).`;
  },
  /** A etiqueta da caixa do grupo no desenho (12 px). */
  groupTag: (count: number) => elements(count),
  /** A etiqueta das outras linhas escolhidas nas Camadas (12 px, fora de FREE_EDITOR_COPY.layers.tags). */
  inSelection: "Na seleção",
  duplicated: (count: number, skipped: number) =>
    `${counted(count, "duplicado", "duplicados")}.${skipped > 0 ? " Os links, o áudio e o vídeo não se duplicam." : ""}`,
  removed: (count: number, kept: number) => `${counted(count, "excluído", "excluídos")}.${kept > 0 ? " Os links e o áudio ficam." : ""} Ctrl + Z desfaz.`,
  hidden: (count: number) => `${counted(count, "escondido", "escondidos")}.`,
  shown: (count: number) => `${counted(count, "mostrado", "mostrados")}.`,
  locked: (count: number) => `${counted(count, "travado", "travados")}.`,
  unlocked: (count: number) => `${counted(count, "destravado", "destravados")}.`,
  layerForward: "Trazidos para frente.",
  layerBackward: "Enviados para trás.",
  /** Setas com varios, depois de parar de apertar. */
  position: (x: number, y: number) => `Seleção em X ${x}, Y ${y}.`,
  /** Os comandos que so valem com um elemento (Alt + ↑/↓ no palco, Soltar, Renomear, editar texto...). */
  onlyOne: "Escolha um elemento só.",
  alignedSelection: "Alinhados entre si.",
  alignedArtboard: "Alinhados no pop-up.",
  spacedX: "Espaços iguais na horizontal.",
  spacedY: "Espaços iguais na vertical.",
  /** Quem ficou parado no alinhar e no distribuir. */
  stayed: (count: number) =>
    count === 1 ? "1 ficou no lugar (travado, na sequência ou escondido)." : `${count} ficaram no lugar (travados, na sequência ou escondidos).`,
  /** A frase do alinhar ou do distribuir com quem ficou parado no fim. */
  afterMove: (phrase: string, skipped: number) => (skipped > 0 ? `${phrase} ${FREE_SELECTION_COPY.stayed(skipped)}` : phrase),
  /** Os rotulos de onde o alinhar mede. */
  scopes: SCOPE_LABELS,
  /** O nome acessivel de cada botao de alinhar de varios ("Alinhar à esquerda entre si", "Alinhar ao centro no pop-up"). */
  alignLabel: (edge: FreeAlignEdge, scope: FreeAlignScope) => `${ALIGN_EDGE_LABELS[edge]} ${SCOPE_LABELS[scope]}`,
  /** O painel da direita com 2 ou mais escolhidos. */
  panel: {
    title: (count: number) => counted(count, "selecionado", "selecionados"),
    hint: "Para mudar textos, cores e tamanhos, escolha um elemento só.",
    listLabel: "Na seleção",
    selectOnly: (name: string) => `Escolher só ${name}`,
    duplicate: "Duplicar",
    remove: "Excluir",
    hide: "Esconder",
    show: "Mostrar",
    lock: "Travar",
    unlock: "Destravar",
    forward: "Trazer para frente",
    backward: "Enviar para trás",
    alignSelection: "Alinhar entre si",
    alignArtboard: "Alinhar no pop-up",
    distribute: "Distribuir os espaços",
    distributeX: "Espaços iguais na horizontal",
    distributeY: "Espaços iguais na vertical",
    mobileNote: "Com Ver como: Celular, alinhar e distribuir mudam só o celular."
  },
  /** O motivo escrito embaixo de cada grupo desligado do painel Varios. */
  reasons: {
    alignSelection: "Para alinhar entre si, escolha 2 ou mais elementos soltos.",
    alignArtboard: "Para alinhar no pop-up, escolha um elemento solto.",
    distribute: "Para distribuir os espaços, escolha 3 ou mais elementos soltos.",
    sequence: "Na sequência, quem alinha e distribui é a caixa.",
    locked: "Elementos travados não mudam de lugar."
  }
} as const;

const C = FREE_SELECTION_COPY;

/* ------------------------------------------------------------------------------------------------
 * Quem esta escolhido
 * ---------------------------------------------------------------------------------------------- */

function nodeOf(design: Pick<PopupFreeDesign, "children">, id: FreeId): FreeNode | null {
  return findFreeNode(design, id)?.node ?? null;
}

function contains(node: FreeNode, match: (item: FreeNode) => boolean): boolean {
  return match(node) || (node.type === "box" && node.children.some((child) => contains(child, match)));
}

/** `ancestor` e uma caixa que tem `id` dentro dela (em qualquer nivel). */
function isInside(design: Pick<PopupFreeDesign, "children">, ancestor: FreeId, id: FreeId): boolean {
  const box = nodeOf(design, ancestor);

  return Boolean(box && box.type === "box" && box.id !== id && contains(box, (item) => item.id === id));
}

/** Os ids na ordem do documento (a das Camadas, de cima para baixo). */
function documentOrder(design: Pick<PopupFreeDesign, "children">, ids: readonly FreeId[]): FreeId[] {
  const wanted = new Set(ids);
  const out: FreeId[] = [];

  walkFreeNodes(design.children, (node) => {
    if (wanted.has(node.id)) {
      out.push(node.id);
    }
  });

  return out;
}

/** So os ids que tem elemento no design, sem repetidos, na ordem recebida (a da escolha; o ultimo e o principal). */
export function freeSelectionLive(design: Pick<PopupFreeDesign, "children">, ids: readonly FreeId[]): FreeId[] {
  const out: FreeId[] = [];

  for (const id of ids) {
    if (!out.includes(id) && nodeOf(design, id)) {
      out.push(id);
    }
  }

  return out;
}

/**
 * A selecao como o editor guarda: viva e nunca com uma caixa junto com algo dentro dela. Quando um e antepassado ou
 * descendente de outro, fica o que veio depois (o escolhido por ultimo).
 */
export function freeNormalizeSelection(design: Pick<PopupFreeDesign, "children">, ids: readonly FreeId[]): FreeId[] {
  const live = freeSelectionLive(design, ids);

  return live.filter((id, index) => !live.slice(index + 1).some((later) => isInside(design, id, later) || isInside(design, later, id)));
}

/** Shift, Ctrl ou ⌘ + clique: tira se ja esta; senao poe no fim (vira o principal) e normaliza. */
export function freeToggleInSelection(design: Pick<PopupFreeDesign, "children">, ids: readonly FreeId[], id: FreeId): { added: boolean; ids: FreeId[] } {
  const current = freeNormalizeSelection(design, ids);

  if (current.includes(id)) {
    return { added: false, ids: current.filter((item) => item !== id) };
  }

  if (!nodeOf(design, id)) {
    return { added: false, ids: current };
  }

  return { added: true, ids: freeNormalizeSelection(design, [...current, id]) };
}

/**
 * Shift + clique e Shift + ↑/↓ nas Camadas: os irmaos do mesmo pai entre a ancora e `id`, na ordem de children,
 * terminando em `id` (o principal). Sem ancora, ancora que nao existe mais ou com pais diferentes, null (quem chama
 * poe ou tira so `id`).
 */
export function freeSelectionRange(design: Pick<PopupFreeDesign, "children">, anchor: FreeId | null, id: FreeId): FreeId[] | null {
  const to = findFreeNode(design, id);
  const from = anchor ? findFreeNode(design, anchor) : null;

  if (!to || !from || (from.parent?.id ?? null) !== (to.parent?.id ?? null)) {
    return null;
  }

  const siblings = to.parent ? to.parent.children : design.children;
  const start = Math.min(from.index, to.index);
  const end = Math.max(from.index, to.index);
  const between = siblings.slice(start, end + 1).map((node) => node.id);

  return [...between.filter((item) => item !== id), id];
}

/**
 * Ctrl + A: os irmaos do principal (sem principal, os de primeiro nivel), sem os travados nem os escondidos no
 * aparelho do "Ver como" (quem chama passa o design do palco, ja resolvido para o aparelho). O principal fica sempre
 * (foi escolhido) e vai para o fim.
 */
export function freeSelectAllIds(stageDesign: Pick<PopupFreeDesign, "children">, principal: FreeId | null): FreeId[] {
  const found = principal ? findFreeNode(stageDesign, principal) : null;
  const siblings = found?.parent ? found.parent.children : stageDesign.children;
  const ids = siblings.filter((node) => !node.locked && !node.hidden && node.id !== found?.node.id).map((node) => node.id);

  return found ? [...ids, found.node.id] : ids;
}

/** Esc: com um, a caixa de fora (ou nada); com varios, o pai comum quando todos estao na mesma caixa; senao nada. */
export function freeSelectionEscape(design: Pick<PopupFreeDesign, "children">, ids: readonly FreeId[]): FreeId | null {
  const chosen = freeNormalizeSelection(design, ids);

  if (chosen.length === 0) {
    return null;
  }

  if (chosen.length === 1) {
    return freeParentId(design, chosen[0]);
  }

  const parents = new Set(chosen.map((id) => freeParentId(design, id)));

  return parents.size === 1 ? [...parents][0] : null;
}

/** O nome do escolhido nas frases: o nome dado, ou o tipo ("Forma", "Botão principal", "Caixa em linha"). */
export function freeSelectionName(design: Pick<PopupFreeDesign, "children">, id: FreeId): string {
  const node = nodeOf(design, id);

  return node ? node.name?.trim() || freeNodeTypeLabel(node) : "";
}

/* ------------------------------------------------------------------------------------------------
 * Alt + clique: a pilha do ponto
 * ---------------------------------------------------------------------------------------------- */

/** O que o desenho le de cada elemento devolvido por document.elementsFromPoint (um Element basta). */
export type FreeHitElement = { closest(selector: string): FreeHitElement | null; dataset: { freeId?: string } };

/**
 * A pilha de elementos do Livre num ponto, de cima para baixo (filhos antes da caixa), a partir de
 * document.elementsFromPoint: pula o que esta fora do cartao (`inside`), os controles do desenho
 * ([data-free-overlay-control]) e o X ([data-free-close]), leva cada um ao seu [data-free-id] e tira os repetidos.
 * Travados (sem ponteiro na previa) e escondidos (nao desenhados) ja nao vem. So o click do Alt + clique que nao
 * passou do limiar le a pilha (C2): o pointerdown com Alt mantem o de cima e arrasta sem guias.
 */
export function freeStackFromPoint(elements: readonly FreeHitElement[], inside: (element: FreeHitElement) => boolean): FreeId[] {
  const out: FreeId[] = [];

  for (const element of elements) {
    if (!inside(element) || element.closest("[data-free-overlay-control]") || element.closest("[data-free-close]")) {
      continue;
    }

    const id = element.closest("[data-free-id]")?.dataset.freeId;

    if (id && !out.includes(id)) {
      out.push(id);
    }
  }

  return out;
}

/**
 * O proximo da pilha no Alt + clique: com o escolhido na pilha, o de baixo dele (depois do ultimo, volta ao de cima);
 * fora dela, o segundo (o de baixo do de cima) ou o unico. `index` comeca em 1. Pilha vazia, null.
 */
export function freeNextInStack(stack: readonly FreeId[], current: FreeId | null): { id: FreeId; index: number; total: number } | null {
  if (stack.length === 0) {
    return null;
  }

  const at = current ? stack.indexOf(current) : -1;
  const index = at === -1 ? (stack.length > 1 ? 1 : 0) : (at + 1) % stack.length;

  return { id: stack[index], index: index + 1, total: stack.length };
}

/* ------------------------------------------------------------------------------------------------
 * Mover junto
 * ---------------------------------------------------------------------------------------------- */

/** Um solto (so filhos da prancheta sao soltos) com a posicao do aparelho: no Celular, a do celular por cima. */
function placeOn(design: PopupFreeDesign, node: FreeNode, device: FreeDevice): FreeAbsolutePlace | null {
  if (node.place?.mode !== "free") {
    return null;
  }

  return device === "mobile" ? (freeMobileFreePlace(design, node.id) ?? node.place) : node.place;
}

/**
 * Quem anda junto: os filhos da prancheta soltos e nao travados, na ordem da selecao. Com `rects` (alinhar e
 * distribuir), tambem precisam estar medidos no aparelho do "Ver como" (sem retangulo = escondido nesse aparelho).
 * `skipped` conta os outros escolhidos (travados, na sequencia ou escondidos), para a frase.
 */
export function freeMovableIds(design: PopupFreeDesign, ids: readonly FreeId[], rects?: FreeMeasuredRects): { ids: FreeId[]; skipped: number } {
  const chosen = freeNormalizeSelection(design, ids);
  const movable = chosen.filter((id) => {
    const found = findFreeNode(design, id);

    return Boolean(found && !found.parent && found.node.place?.mode === "free" && !found.node.locked && (!rects || rects[id]));
  });

  return { ids: movable, skipped: chosen.length - movable.length };
}

/**
 * A chave de juntar passos (setas e camada). Um id com "place" e exatamente freeArrowCoalesceKey; varios, os ids
 * ordenados por virgula mais ":place" ou ":mobile.place" (cada aparelho volta num Ctrl + Z) ou ":place.z" (a camada e
 * uma so nos dois aparelhos).
 */
export function freeGroupCoalesceKey(ids: readonly FreeId[], device: FreeDevice, field: "place" | "z" = "place"): string {
  const sorted = [...new Set(ids)].sort();

  if (field === "z") {
    return `${sorted.join(",")}:place.z`;
  }

  return sorted.length === 1 ? freeArrowCoalesceKey(sorted[0], device) : `${sorted.join(",")}:${device === "mobile" ? "mobile.place" : "place"}`;
}

/**
 * Setas e arrastar com varios: todos os soltos nao travados andam o mesmo deslocamento inteiro, limitado pelo grupo
 * (freeGroupDelta: quem chega antes na borda segura os outros). Com o Celular, parte da posicao do celular e grava so
 * em devices.mobile (o igual ao computador sai sozinho). Nada mudado devolve o mesmo design.
 */
export function moveFreeNodesBy(design: PopupFreeDesign, ids: readonly FreeId[], dx: number, dy: number, device: FreeDevice): PopupFreeDesign {
  const items = freeMovableIds(design, ids).ids.flatMap((id) => {
    const node = nodeOf(design, id);
    const place = node ? placeOn(design, node, device) : null;

    return place ? [{ id, place }] : [];
  });
  const delta = freeGroupDelta(items.map((item) => item.place), dx, dy);

  if (delta.dx === 0 && delta.dy === 0) {
    return design;
  }

  return items.reduce((next, item) => setFreeNodeRect(next, item.id, { x: item.place.x + delta.dx, y: item.place.y + delta.dy }, device), design);
}

/** Onde o grupo esta no aparelho: o menor X e o menor Y dos que andam (para "Seleção em X, Y."). Sem nenhum, null. */
export function freeManyPosition(design: PopupFreeDesign, ids: readonly FreeId[], device: FreeDevice): { x: number; y: number } | null {
  const places = freeMovableIds(design, ids).ids.flatMap((id) => {
    const node = nodeOf(design, id);
    const place = node ? placeOn(design, node, device) : null;

    return place ? [place] : [];
  });

  if (places.length === 0) {
    return null;
  }

  return { x: Math.min(...places.map((place) => place.x)), y: Math.min(...places.map((place) => place.y)) };
}

/* ------------------------------------------------------------------------------------------------
 * Alinhar e distribuir
 * ---------------------------------------------------------------------------------------------- */

type MeasuredItem = { id: FreeId; place: FreeAbsolutePlace; rect: FreeRect };

/** Os que entram na conta, na ordem do documento, cada um com a caixa que se ve no aparelho (o girado pela volta). */
function measuredItems(design: PopupFreeDesign, ids: readonly FreeId[], rects: FreeMeasuredRects, device: FreeDevice): MeasuredItem[] {
  return documentOrder(design, freeMovableIds(design, ids, rects).ids).flatMap((id) => {
    const node = nodeOf(design, id);
    const place = node ? placeOn(design, node, device) : null;
    const measured = rects[id];

    return place && measured ? [{ id, place, rect: freeVisualRect(freeRectOfPlace(place, measured.h), place.rotate) }] : [];
  });
}

/**
 * Por que o alinhar ou o distribuir nao da (null = da): precisa de `need` soltos que andam. Nenhum solto escolhido:
 * a sequencia (quem alinha e a caixa). Soltos que se veem bastariam, mas algum esta travado: os travados. Senao, a
 * frase da contagem.
 */
function moveReason(design: PopupFreeDesign, ids: readonly FreeId[], rects: FreeMeasuredRects, need: number, phrase: string): string | null {
  const chosen = freeNormalizeSelection(design, ids);

  if (freeMovableIds(design, chosen, rects).ids.length >= need) {
    return null;
  }

  const free = chosen.map((id) => nodeOf(design, id)).filter((node): node is FreeNode => node?.place?.mode === "free");

  if (chosen.length > 0 && free.length === 0) {
    return C.reasons.sequence;
  }

  const shown = free.filter((node) => rects[node.id]);

  return shown.length >= need && shown.some((node) => node.locked) ? C.reasons.locked : phrase;
}

function alignReason(design: PopupFreeDesign, ids: readonly FreeId[], scope: FreeAlignScope, rects: FreeMeasuredRects): string | null {
  if (scope === "artboard") {
    return rects["@artboard"] ? moveReason(design, ids, rects, 1, C.reasons.alignArtboard) : C.reasons.alignArtboard;
  }

  return moveReason(design, ids, rects, 2, C.reasons.alignSelection);
}

export type FreeManyMoveResult = { design: PopupFreeDesign; moved: number; skipped: number } | { reason: string };

/** Grava so o eixo que muda de cada um (place.x + dx ou place.y + dy), com o aparelho; conta quem mudou de verdade. */
function applyDeltas(design: PopupFreeDesign, items: readonly MeasuredItem[], deltas: readonly { dx: number; dy: number }[], device: FreeDevice) {
  let next = design;
  let moved = 0;

  items.forEach((item, index) => {
    const { dx, dy } = deltas[index];

    if (dx === 0 && dy === 0) {
      return;
    }

    const after = setFreeNodeRect(next, item.id, dx !== 0 ? { x: item.place.x + dx } : { y: item.place.y + dy }, device);

    if (after !== next) {
      moved += 1;
      next = after;
    }
  });

  return { design: next, moved };
}

/**
 * Alinhar com varios. "selection" (2 ou mais soltos): pela caixa que envolve os que andam. "artboard" (1 ou mais):
 * cada um na prancheta (Título, Texto e Botão com "Alinhar ao centro" ficam todos centrados). A conta e pela caixa
 * que se ve (um girado alinha pela borda visivel), no aparelho do "Ver como" (no Celular grava so devices.mobile).
 * Travados, da sequencia e escondidos no aparelho ficam parados (`skipped`). Poucos devolve o motivo do painel.
 * Nada mudado devolve o mesmo design e moved 0.
 */
export function alignFreeNodes(
  design: PopupFreeDesign,
  ids: readonly FreeId[],
  edge: FreeAlignEdge,
  scope: FreeAlignScope,
  rects: FreeMeasuredRects,
  device: FreeDevice
): FreeManyMoveResult {
  const reason = alignReason(design, ids, scope, rects);
  const artboard = rects["@artboard"];

  if (reason !== null) {
    return { reason };
  }

  const items = measuredItems(design, ids, rects, device);
  const frame = scope === "selection" ? freeBoundsOf(items.map((item) => item.rect)) : { h: artboard.h, w: artboard.w, x: 0, y: 0 };

  if (!frame) {
    return { reason: C.reasons.alignSelection };
  }

  const result = applyDeltas(design, items, items.map((item) => freeAlignDelta(item.rect, edge, frame)), device);

  return { ...result, skipped: freeNormalizeSelection(design, ids).length - items.length };
}

/**
 * Espacos iguais (3 ou mais soltos): o primeiro e o ultimo no eixo ficam parados e os do meio andam ate os espacos
 * ficarem iguais (ate 1 px de diferenca), pela caixa que se ve e no aparelho do "Ver como". No empate do meio, vale a
 * ordem das Camadas. Mesmo formato do alinhar.
 */
export function distributeFreeNodes(design: PopupFreeDesign, ids: readonly FreeId[], axis: "x" | "y", rects: FreeMeasuredRects, device: FreeDevice): FreeManyMoveResult {
  const reason = moveReason(design, ids, rects, 3, C.reasons.distribute);

  if (reason !== null) {
    return { reason };
  }

  const items = measuredItems(design, ids, rects, device);
  const deltas = freeDistributeDeltas(items.map((item) => item.rect), axis);
  const result = applyDeltas(design, items, deltas.map((delta) => (axis === "x" ? { dx: delta, dy: 0 } : { dx: 0, dy: delta })), device);

  return { ...result, skipped: freeNormalizeSelection(design, ids).length - items.length };
}

/* ------------------------------------------------------------------------------------------------
 * Duplicar e excluir
 * ---------------------------------------------------------------------------------------------- */

/** Os Links e o Áudio sao fixos e o Vídeo e um so por pop-up: quem contem um deles nunca se duplica (C7). */
function neverDuplicates(design: PopupFreeDesign, id: FreeId): boolean {
  const node = nodeOf(design, id);

  return Boolean(node && contains(node, (item) => item.type === "links" || item.type === "audio" || item.type === "video"));
}

/**
 * Duplicar varios num passo so. Quem contem Links, Áudio ou Vídeo fica de fora (`skipped`, com a frase); o resto,
 * na ordem do documento, pelo duplicateFreeNode de um elemento sobre o design que acumula, entao os limites (32
 * elementos, 24 soltos, 20 por caixa, 3 botoes alem do principal) contam o conjunto. Um que nao cabe recusa tudo com
 * o motivo dele (nada muda). Todos de fora devolvem a frase do primeiro (a de hoje). As copias voltam na ordem da
 * selecao (a copia do principal continua por ultimo).
 */
export function duplicateFreeNodes(
  design: PopupFreeDesign,
  ids: readonly FreeId[],
  cta: NoticeDraft["cta"]
): { design: PopupFreeDesign; ids: FreeId[]; skipped: number } | { reason: string } {
  const chosen = freeNormalizeSelection(design, ids);
  const skipped = chosen.filter((id) => neverDuplicates(design, id));

  if (chosen.length > 0 && skipped.length === chosen.length) {
    return { reason: freeDuplicateProblem(design, skipped[0]) ?? "" };
  }

  const copies = new Map<FreeId, FreeId>();
  let next = design;

  for (const id of documentOrder(design, chosen.filter((item) => !skipped.includes(item)))) {
    const result = duplicateFreeNode(next, id, cta);

    if ("reason" in result) {
      return { reason: result.reason };
    }

    next = result.design;
    copies.set(id, result.id);
  }

  return { design: next, ids: chosen.flatMap((id) => copies.get(id) ?? []), skipped: skipped.length };
}

/**
 * Excluir varios num passo so. Links e Áudio ficam (`kept`); o resto sai, com o que mudava no celular. `ctaRemoved`
 * quando o Botão principal saiu (o editor tira o botao do aviso). Nada removido devolve o motivo do primeiro.
 */
export function removeFreeNodes(
  design: PopupFreeDesign,
  ids: readonly FreeId[]
): { ctaRemoved: boolean; design: PopupFreeDesign; kept: FreeId[]; removed: FreeId[] } | { reason: string } {
  const kept: FreeId[] = [];
  const removed: FreeId[] = [];
  let next = design;
  let ctaRemoved = false;
  let first: string | null = null;

  for (const id of freeNormalizeSelection(design, ids)) {
    const result = removeFreeNode(next, id);

    if ("reason" in result) {
      kept.push(id);
      first ??= result.reason;
      continue;
    }

    next = result.design;
    ctaRemoved ||= result.ctaRemoved;
    removed.push(id);
  }

  if (removed.length === 0 && first !== null) {
    return { reason: first };
  }

  return { ctaRemoved, design: next, kept, removed };
}

/* ------------------------------------------------------------------------------------------------
 * Esconder, travar, camada
 * ---------------------------------------------------------------------------------------------- */

/** Esconder ou travar com varios: se algum ainda nao tem a marca, todos ganham (true); senao, todos perdem (false). */
export function freeManyFlagNext(design: Pick<PopupFreeDesign, "children">, ids: readonly FreeId[], flag: "hidden" | "locked"): boolean {
  return freeNormalizeSelection(design, ids).some((id) => !nodeOf(design, id)?.[flag]);
}

/** Aplica a regra do freeManyFlagNext a todos; devolve o valor gravado (para a frase). */
export function setFreeNodesFlag(design: PopupFreeDesign, ids: readonly FreeId[], flag: "hidden" | "locked"): { design: PopupFreeDesign; value: boolean } {
  const value = freeManyFlagNext(design, ids, flag);

  return { design: freeNormalizeSelection(design, ids).reduce((next, id) => setFreeNodeFlag(next, id, flag, value), design), value };
}

/** Camada com varios: cada um ±1, de -10 a 10; quem esta no limite fica. Nada mudado devolve o mesmo design. */
export function shiftFreeNodesLayer(design: PopupFreeDesign, ids: readonly FreeId[], delta: 1 | -1): PopupFreeDesign {
  return freeNormalizeSelection(design, ids).reduce((next, id) => shiftFreeNodeLayer(next, id, delta), design);
}

/* ------------------------------------------------------------------------------------------------
 * Palco e painel Varios
 * ---------------------------------------------------------------------------------------------- */

/**
 * A descricao do palco: com um, a de hoje ("Selecionado: Título, X 24, Y 120."); com varios, "Selecionados: 3
 * elementos (Título, Forma, Texto)." com o nome dado ou o tipo, ate 5 nomes e depois " e mais N".
 */
export function freeManyDescription(design: PopupFreeDesign, ids: readonly FreeId[], rects: FreeMeasuredRects): string {
  const chosen = freeNormalizeSelection(design, ids);

  if (chosen.length <= 1) {
    return freeSelectionDescription(design, chosen[0] ?? null, rects);
  }

  return C.description(chosen.map((id) => freeSelectionName(design, id)));
}

/**
 * Por que cada grupo do painel Varios esta desligado (null = ligado): alinhar entre si (2 soltos), alinhar no pop-up
 * (1 solto), distribuir (3 soltos), duplicar (o primeiro limite do conjunto, ou so Links, Áudio e Vídeo) e excluir
 * (so quando nada pode sair).
 */
export function freeManyReasons(
  design: PopupFreeDesign,
  ids: readonly FreeId[],
  rects: FreeMeasuredRects
): { alignArtboard: string | null; alignSelection: string | null; distribute: string | null; duplicate: string | null; remove: string | null } {
  const duplicate = duplicateFreeNodes(design, ids, null);
  const remove = removeFreeNodes(design, ids);

  return {
    alignArtboard: alignReason(design, ids, "artboard", rects),
    alignSelection: alignReason(design, ids, "selection", rects),
    distribute: moveReason(design, ids, rects, 3, C.reasons.distribute),
    duplicate: "reason" in duplicate ? duplicate.reason : null,
    remove: "reason" in remove ? remove.reason : null
  };
}
