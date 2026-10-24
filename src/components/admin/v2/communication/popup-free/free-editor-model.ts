// Editor Livre do pop-up (docs/27; spec §4.2 a §4.10): as pecas puras da casca, do palco, dos Elementos e das
// Camadas. As frases do editor (palavra por palavra da spec), o catalogo de elementos com o motivo de cada botao
// desligado, onde um elemento novo entra, duplicar, excluir, subir/descer, colocar dentro e tirar da caixa,
// esconder, travar, renomear, camada (trazer para frente / enviar para tras), mover pelas setas, soltar e seguir a
// sequencia, alinhar no pop-up pelo retangulo medido, as linhas das Camadas, os erros do design (zod no navegador e
// as regras com o conteudo do aviso) e os itens do Revisar. O item de previa e o freePreviewPopupItem do pacote M.
//
// Modulo puro, imports relativos (tests/popup-livre-editor-modelo.test.mjs carrega direto pelo Node). Tudo aqui e
// texto do produtor em portugues, sem palavra fora do vocabulario (testado).

import {
  FREE_DESIGN_LIMITS,
  canonicalPopupFreeDesign,
  findFreeNode,
  freeNodeCount,
  freeNodeIdOfKey,
  nextFreeId,
  uploadedFontIdsOfFree,
  updateFreeNode,
  walkFreeNodes,
  type FreeAbsolutePlace,
  type FreeBoxNode,
  type FreeButtonNode,
  type FreeFlowPlace,
  type FreeId,
  type FreeNode,
  type FreeNodeType,
  type PopupFreeDesign
} from "../../../../../server/communications/popup-free-model";
import { POPUP_FREE_PASTE_MESSAGES, parseFreeDesignPaste, type FreePasteContext, type FreePasteResult } from "../../../../../server/communications/popup-free-paste";
import { freeHeadingText, resolveFreeArtboard } from "../../../../../server/communications/popup-free-render";
import { POPUP_FREE_MESSAGES, freeErrorKeys, popupFreeContentProblems, popupFreeDesignSchema } from "../../../../../server/communications/popup-free-schema";
import { FREE_ELEMENT_ID_PREFIX, FREE_STARTER_CTA, newFreeNode, type FreeElementKind } from "../../../../../server/communications/popup-free-starters";
import { FREE_NODE_TYPE_LABELS, freeNodeDisplayName, type FreeHint, type FreeMeasuredRects } from "../../../../../server/communications/popup-free-checks";
import type { PopupFontRef } from "../../../../../server/communications/popup-design-model";
import { noticeCtaProblems, type NoticeDraft } from "../../../../../server/communications/schemas";
import { TEMPLATE_MESSAGES, templateCtaSchema } from "../../../../../server/communications/template-model";
import { SENT_NOTICE_COPY } from "../notices-view-model";
import {
  alignFreeRect,
  freePlaceFromRect,
  freePlaceNumbers,
  freeSequenceIndexFor,
  nudgeFreePlace,
  type FreeAlignEdge,
  type FreeRect
} from "./free-editor-geometry";

const L = FREE_DESIGN_LIMITS;
const M = POPUP_FREE_MESSAGES;

/* ------------------------------------------------------------------------------------------------
 * Frases do editor (spec §4.2 a §4.10, palavra por palavra)
 * ---------------------------------------------------------------------------------------------- */

export const FREE_EDITOR_COPY = {
  announce: {
    downward: "Movido para baixo.",
    duplicated: "Elemento duplicado.",
    hidden: "Elemento escondido.",
    intoBox: "Colocado dentro da caixa.",
    locked: "Elemento travado.",
    outOfBox: "Tirado da caixa.",
    position: (x: number, y: number) => `X ${x}, Y ${y}.`,
    recovered: "Design recuperado. Ctrl + Z desfaz.",
    redone: "Refeito.",
    removed: "Elemento excluído. Ctrl + Z desfaz.",
    renamed: "Nome trocado.",
    shown: "Elemento mostrado.",
    size: (w: number, h: number) => `Largura ${w}, altura ${h}.`,
    toFree: "Agora está solto.",
    toSequence: "Agora segue a sequência.",
    undone: "Desfeito.",
    unlocked: "Elemento destravado.",
    upward: "Movido para cima.",
    layerForward: "Trazido para frente.",
    layerBackward: "Enviado para trás.",
    aligned: "Alinhado no pop-up."
  },
  bar: {
    done: "Concluir",
    doneLabel: "Concluir e voltar ao aviso",
    redo: "Refazer",
    review: "Revisar",
    reviewCount: (count: number) => `Revisar (${count} ${count === 1 ? "item" : "itens"})`,
    saveDraft: "Salvar rascunho",
    saving: "Salvando…",
    shortcuts: "Atalhos",
    title: "Editor Livre",
    undo: "Desfazer",
    viewAs: "Ver como",
    zoom: "Zoom",
    zoom100: "100 %",
    zoomFit: "Ajustar à tela"
  },
  canNotRemove: {
    audio: "Para tirar o áudio, tire o arquivo no campo Áudio do aviso.",
    links: "Os links ficam no desenho, mas cada um se tira em Conteúdo: desligue “Permitir Lembrar depois” ou “Mostrar Não mostrar de novo”."
  },
  devices: { desktop: "Computador", mobile: "Celular" },
  elements: {
    ctaExists: "O pop-up já tem o botão principal.",
    groupsLabel: "Elementos para acrescentar",
    linkButtonOnly: M.linkButtons,
    videoOnly: M.videoDuplicate
  },
  layers: {
    empty: "Nenhum elemento ainda.",
    hide: "Esconder",
    inside: (box: string) => `dentro de ${box}`,
    intoBox: "Colocar dentro da caixa…",
    listLabel: "Camadas do pop-up",
    lock: "Travar",
    menu: "Mais ações",
    moveDown: "Descer",
    moveUp: "Subir",
    noBox: "Nenhuma caixa pode receber este elemento.",
    outOfBox: "Tirar da caixa",
    remove: "Excluir",
    rename: "Renomear",
    renameLabel: "Nome na lista de camadas",
    renameSave: "Salvar nome",
    select: (label: string) => `Selecionar ${label}`,
    show: "Mostrar",
    tags: { free: "Solta", hidden: "Escondida", locked: "Travada" },
    unlock: "Destravar",
    warning: "Tem algo para revisar",
    duplicate: "Duplicar"
  },
  recovery: {
    discard: "Descartar",
    message: (time: string) => `Há um design deste pop-up que não foi salvo (${time}).`,
    recover: "Recuperar"
  },
  review: {
    back: "Voltar ao elemento",
    empty: "Tudo certo por aqui.",
    errors: "Para corrigir antes de salvar",
    hints: "Dicas",
    raise: "Aumentar a altura",
    sendFont: "Enviar fonte…",
    size: (percent: number) => `Tamanho do design: ${percent} % do máximo.`,
    title: "Revisar",
    popupName: "Pop-up",
    designName: "Design"
  },
  save: {
    closeAndReview: "Fechar o editor e revisar",
    failed: "Não deu para salvar agora. Tente de novo.",
    outside: (names: string) => `Há campos para revisar fora do editor: ${names}.`,
    saved: "Rascunho salvo.",
    waitUpload: "Espere o arquivo terminar de enviar."
  },
  shortcuts: [
    "Setas: mover 1 px",
    "Shift + setas: mover 10 px",
    "Alt + ↑ / ↓: subir ou descer na lista",
    "Delete: excluir",
    "Ctrl + D: duplicar",
    "Ctrl + Z: desfazer",
    "Ctrl + Shift + Z: refazer",
    "Esc: selecionar a caixa de fora (ou nada)",
    "[ e ]: enviar para trás / trazer para frente",
    "Shift ao redimensionar: manter a proporção",
    "Alt ao mover: sem guias",
    "Nas Camadas: E esconde, T trava, Shift + F10 abre o menu"
  ],
  stage: {
    label: "Área de desenho. Escolha um elemento nas Camadas e use as setas para mover.",
    nothing: "Nada selecionado.",
    resize: (handle: string) => `Mudar o tamanho (${handle})`,
    selected: (name: string, x: number, y: number) => `Selecionado: ${name}, X ${x}, Y ${y}.`
  },
  tabs: { elements: "Elementos", layers: "Camadas", templates: "Modelos" },
  /** A aba Modelos (docs/28 §5.9): "Salvar este design como modelo" e os designs Livres que a equipe guardou. */
  templates: {
    applied: "Modelo aplicado. Ctrl + Z desfaz.",
    capped: "Mostrando os 50 mais recentes.",
    dialogConfirm: "Salvar modelo",
    dialogDescription:
      "Fica em “Meus modelos” do design Livre e em Comunicação › Modelos. Os textos do design vão junto; o destino do botão fica em cada aviso.",
    dialogTitle: "Salvar design como modelo",
    empty: "Seus designs Livres salvos aparecem aqui. Use “Salvar este design como modelo”.",
    error: "Não foi possível carregar seus modelos agora.",
    listLabel: "Seus designs Livres salvos",
    loading: "Carregando seus modelos…",
    retry: "Tentar de novo",
    save: "Salvar este design como modelo",
    saved: "Design salvo em Meus modelos.",
    title: "Meus modelos",
    updated: (date: string) => `Atualizado em ${date}`,
    use: "Usar este modelo",
    useLabel: (name: string) => `Usar este modelo: ${name}`
  },
  toolbar: { duplicate: "Duplicar", label: "Ações do elemento", moveDown: "Descer", moveUp: "Subir", remove: "Excluir", toFree: "Soltar" },
  /** Copiar e colar o design (docs/27 L1.1). */
  transfer: {
    apply: "Usar este design",
    cancel: "Cancelar",
    clipboardBlocked: "O navegador não deixou ler a área de transferência. Cole no campo com Ctrl + V.",
    close: "Fechar",
    copied: "Design copiado.",
    copyDesign: "Copiar o design",
    copyInstructions: "Copiar as instruções para a IA",
    fromClipboard: "Colar da área de transferência",
    instructionsCopied: "Instruções copiadas. Cole na conversa com a IA junto com o design.",
    manualDescription: "Não deu para copiar sozinho. Selecione o texto abaixo e copie com Ctrl + C.",
    manualLabel: "Texto para copiar",
    manualTitle: "Copiar o texto",
    menu: "Copiar e colar",
    menuHint: "Para pedir a um Claude ou ChatGPT seu: copie as instruções e o design, cole lá, peça a mudança e traga o JSON de volta em Colar o design.",
    pasteDescription: "Cole o JSON do design, copiado de outro pop-up ou feito pela IA. O design de agora é trocado; Ctrl + Z desfaz.",
    pasteDesign: "Colar o design…",
    pasteLabel: "Design em JSON",
    pasteTitle: "Colar o design",
    pasted: "Design colado. Ctrl + Z desfaz."
  }
} as const;

/**
 * Os arquivos que este pop-up conhece para o "Colar o design" (docs/27 L1.1): os do design aberto, os de todo o
 * historico do editor (um arquivo enviado e depois tirado continua sendo deste aviso) e os dos designs extras
 * (o de quando o editor abriu). Um por caminho e tipo.
 */
export function freeKnownAssets(entries: readonly { design: Pick<PopupFreeDesign, "assets"> }[]): PopupFreeDesign["assets"] {
  const seen = new Set<string>();
  const out: PopupFreeDesign["assets"] = [];

  for (const entry of entries) {
    for (const asset of entry.design.assets) {
      const key = `${asset.kind}:${asset.path}`;

      if (!seen.has(key)) {
        seen.add(key);
        out.push(asset);
      }
    }
  }

  return out;
}

/** Nome falado de cada alca de redimensionar. */
export const FREE_HANDLE_LABELS = {
  e: "direita",
  n: "em cima",
  ne: "canto de cima à direita",
  nw: "canto de cima à esquerda",
  s: "embaixo",
  se: "canto de baixo à direita",
  sw: "canto de baixo à esquerda",
  w: "esquerda"
} as const;

/* ------------------------------------------------------------------------------------------------
 * Catalogo de Elementos (spec §4.3)
 * ---------------------------------------------------------------------------------------------- */

export type FreeCatalogKind = Exclude<FreeElementKind, "audio" | "links">;
export type FreeCatalogItem = { kind: FreeCatalogKind; label: string };
export type FreeCatalogGroup = { items: readonly FreeCatalogItem[]; label: string };

export const FREE_ELEMENT_GROUPS: readonly FreeCatalogGroup[] = [
  {
    items: [
      { kind: "heading", label: "Título" },
      { kind: "text", label: "Texto" },
      { kind: "badge", label: "Selo" }
    ],
    label: "Texto"
  },
  {
    items: [
      { kind: "cta", label: "Botão principal" },
      { kind: "button", label: "Botão" }
    ],
    label: "Botões"
  },
  {
    items: [
      { kind: "image", label: "Imagem" },
      { kind: "video", label: "Vídeo" },
      { kind: "icon", label: "Ícone" }
    ],
    label: "Mídia"
  },
  {
    items: [
      { kind: "shape", label: "Forma" },
      { kind: "gradient", label: "Degradê" },
      { kind: "divider", label: "Linha" },
      { kind: "spacer", label: "Espaço" }
    ],
    label: "Formas"
  },
  {
    items: [
      { kind: "column", label: "Caixa em coluna" },
      { kind: "row", label: "Caixa em linha" }
    ],
    label: "Estrutura"
  }
];

const ADDED: Record<FreeCatalogKind, string> = {
  badge: "Selo adicionado.",
  button: "Botão adicionado.",
  column: "Caixa em coluna adicionada.",
  cta: "Botão principal adicionado.",
  divider: "Linha adicionada.",
  gradient: "Degradê adicionado.",
  heading: "Título adicionado.",
  icon: "Ícone adicionado.",
  image: "Imagem adicionada.",
  row: "Caixa em linha adicionada.",
  shape: "Forma adicionada.",
  spacer: "Espaço adicionado.",
  text: "Texto adicionado.",
  video: "Vídeo adicionado."
};

export function freeAddedAnnouncement(kind: FreeCatalogKind): string {
  return ADDED[kind];
}

/* ------------------------------------------------------------------------------------------------
 * Arvore: achar, tirar, pôr
 * ---------------------------------------------------------------------------------------------- */

type Located = { depth: number; index: number; node: FreeNode; parent: FreeBoxNode | null };

function locate(design: Pick<PopupFreeDesign, "children">, id: FreeId): Located | null {
  return findFreeNode(design, id) as Located | null;
}

function childrenOf(design: PopupFreeDesign, parentId: FreeId | null): readonly FreeNode[] {
  if (parentId === null) {
    return design.children;
  }

  const found = locate(design, parentId);

  return found?.node.type === "box" ? found.node.children : [];
}

function withChildren(design: PopupFreeDesign, parentId: FreeId | null, children: FreeNode[]): PopupFreeDesign {
  if (parentId === null) {
    return { ...design, children };
  }

  return updateFreeNode(design, parentId, (node) => (node.type === "box" ? { ...node, children } : node));
}

function detach(design: PopupFreeDesign, id: FreeId): { design: PopupFreeDesign; index: number; node: FreeNode; parentId: FreeId | null } | null {
  const found = locate(design, id);

  if (!found) {
    return null;
  }

  const parentId = found.parent?.id ?? null;
  const siblings = childrenOf(design, parentId).filter((node) => node.id !== id);

  return { design: withChildren(design, parentId, siblings), index: found.index, node: found.node, parentId };
}

function insertNode(design: PopupFreeDesign, parentId: FreeId | null, index: number, node: FreeNode): PopupFreeDesign {
  const siblings = [...childrenOf(design, parentId)];
  const at = Math.max(0, Math.min(index, siblings.length));

  siblings.splice(at, 0, node);

  return withChildren(design, parentId, siblings);
}

/** Quantos niveis de caixa o elemento leva (0 = nao e caixa; 1 = caixa sem caixa dentro; 2 = caixa com caixa). */
function boxHeight(node: FreeNode): number {
  if (node.type !== "box") {
    return 0;
  }

  return 1 + node.children.reduce((max, child) => Math.max(max, boxHeight(child)), 0);
}

function contains(node: FreeNode, match: (item: FreeNode) => boolean): boolean {
  return match(node) || (node.type === "box" && node.children.some((child) => contains(child, match)));
}

const isCta = (node: FreeNode): node is FreeButtonNode => node.type === "button" && node.action.kind === "cta";
const isLinkButton = (node: FreeNode) => node.type === "button" && node.action.kind === "link";

export function freeCtaNode(design: Pick<PopupFreeDesign, "children">): FreeButtonNode | null {
  let found: FreeButtonNode | null = null;

  walkFreeNodes(design.children, (node) => {
    if (!found && isCta(node)) {
      found = node;
    }
  });

  return found;
}

/** O pai de um elemento (Esc seleciona a caixa de fora; na prancheta, nada). */
export function freeParentId(design: Pick<PopupFreeDesign, "children">, id: FreeId | null): FreeId | null {
  if (!id) {
    return null;
  }

  return locate(design, id)?.parent?.id ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * Contagens: o que ainda cabe (o mesmo limite do schema, para o botao desligar antes)
 * ---------------------------------------------------------------------------------------------- */

type Counts = { audio: number; buttons: number; cta: number; free: number; headings: number; icons: number; images: number; links: number; linkButtons: number; nodes: number; videos: number };

function countNodes(nodes: readonly FreeNode[], counts: Counts = { audio: 0, buttons: 0, cta: 0, free: 0, headings: 0, icons: 0, images: 0, linkButtons: 0, links: 0, nodes: 0, videos: 0 }): Counts {
  walkFreeNodes(nodes, (node) => {
    counts.nodes += 1;

    if (node.place?.mode === "free") counts.free += 1;
    if (node.type === "heading") counts.headings += 1;
    if (node.type === "image") counts.images += 1;
    if (node.type === "video") counts.videos += 1;
    if (node.type === "icon") counts.icons += 1;
    if (node.type === "links") counts.links += 1;
    if (node.type === "audio") counts.audio += 1;

    if (node.type === "button") {
      if (node.action.kind === "cta") {
        counts.cta += 1;
      } else {
        counts.buttons += 1;

        if (node.action.kind === "link") {
          counts.linkButtons += 1;
        }
      }
    }
  });

  return counts;
}

/** A frase do primeiro limite que os elementos novos passariam (null = cabe). */
export function freeAddProblem(design: Pick<PopupFreeDesign, "children">, added: readonly FreeNode[]): string | null {
  const counts = countNodes(added, countNodes(design.children));

  if (counts.nodes > L.nodes) return M.nodes;
  if (counts.cta > 1) return M.ctaDuplicate;
  if (counts.linkButtons > L.linkButtons) return M.linkButtons;
  if (counts.buttons > L.buttons) return M.buttons;
  if (counts.headings > L.headings) return M.headings;
  if (counts.images > L.imageNodes) return M.imageNodes;
  if (counts.videos > L.videos) return M.videoDuplicate;
  if (counts.icons > L.icons) return M.icons;
  if (counts.links > 1) return M.linksDuplicate;
  if (counts.audio > 1) return M.audioDuplicate;
  if (counts.free > L.freeNodes) return M.freeNodes;

  return null;
}

/** Por que o botao do painel Elementos esta desligado (null = ligado). */
export function freeElementDisabledReason(design: PopupFreeDesign, kind: FreeCatalogKind): string | null {
  if (freeNodeCount(design) >= L.nodes) {
    return M.nodes;
  }

  if (kind === "cta" && freeCtaNode(design)) {
    return FREE_EDITOR_COPY.elements.ctaExists;
  }

  return freeAddProblem(design, [newFreeNode(kind, "novo", { design })]);
}

/* ------------------------------------------------------------------------------------------------
 * Acrescentar (spec §4.3: onde entra)
 * ---------------------------------------------------------------------------------------------- */

function beforeLinks(design: PopupFreeDesign): { index: number; parentId: FreeId | null } {
  const links = design.children.findIndex((node) => node.type === "links");

  return { index: links === -1 ? design.children.length : links, parentId: null };
}

/**
 * Onde um elemento novo entra: com uma caixa selecionada, no fim dela; com um elemento da sequencia selecionado,
 * logo depois dele (na mesma caixa); sem selecao, com um solto selecionado ou com um elemento solto novo, no fim
 * da prancheta, antes dos Links. Quando a caixa esta cheia (20) ou a caixa nova passaria da profundidade, sobe um
 * nivel (logo depois da caixa).
 */
export function freeInsertionPoint(design: PopupFreeDesign, selectedId: FreeId | null, node: FreeNode): { index: number; parentId: FreeId | null } {
  if (node.place?.mode === "free" || !selectedId) {
    return beforeLinks(design);
  }

  const found = locate(design, selectedId);

  if (!found || found.node.place?.mode === "free") {
    return beforeLinks(design);
  }

  const candidates: { containerDepth: number; index: number; parentId: FreeId | null }[] = [];

  if (found.node.type === "box") {
    candidates.push({ containerDepth: found.depth, index: found.node.children.length, parentId: found.node.id });
  }

  let current: Located | null = found;

  while (current) {
    candidates.push({ containerDepth: current.depth - 1, index: current.index + 1, parentId: current.parent?.id ?? null });
    current = current.parent ? locate(design, current.parent.id) : null;
  }

  const height = boxHeight(node);

  for (const candidate of candidates) {
    if (candidate.parentId !== null && childrenOf(design, candidate.parentId).length >= L.childrenPerBox) {
      continue;
    }

    if (candidate.containerDepth + height > L.boxDepth) {
      continue;
    }

    return { index: candidate.index, parentId: candidate.parentId };
  }

  return beforeLinks(design);
}

export type FreeAddResult = { design: PopupFreeDesign; id: FreeId; kind: FreeCatalogKind; node: FreeNode } | { reason: string };

/**
 * Acrescenta um elemento do painel Elementos. O Botão principal pede o `cta` do aviso (quem chama cria "Saiba mais"
 * com o destino vazio quando falta). Devolve a frase do limite quando nao cabe.
 */
export function addFreeElement(design: PopupFreeDesign, kind: FreeCatalogKind, options: { center?: { x: number; y: number }; selectedId?: FreeId | null } = {}): FreeAddResult {
  const reason = freeElementDisabledReason(design, kind);

  if (reason) {
    return { reason };
  }

  const id = nextFreeId(design, FREE_ELEMENT_ID_PREFIX[kind]);
  const node = newFreeNode(kind, id, { center: options.center, design });
  const point = freeInsertionPoint(design, options.selectedId ?? null, node);

  return { design: insertNode(design, point.parentId, point.index, node), id, kind, node };
}

/** O cta do Botão principal novo (sem botao no aviso: "Saiba mais" com o destino vazio). */
export function freeCtaForNewButton(cta: NoticeDraft["cta"]): NonNullable<NoticeDraft["cta"]> {
  return cta ?? { ...FREE_STARTER_CTA };
}

/** O que o painel da direita deve focar depois de acrescentar (Imagem e Video: o botao de enviar). */
export function freeFocusAfterAdd(node: FreeNode): { intent?: "upload"; key: string } {
  if (node.type === "image" || node.type === "video") {
    return { intent: "upload", key: `nodes.${node.id}.asset` };
  }

  return { key: `nodes.${node.id}` };
}

/* ------------------------------------------------------------------------------------------------
 * Duplicar, excluir
 * ---------------------------------------------------------------------------------------------- */

const TYPE_PREFIX: Record<FreeNodeType, string> = {
  audio: "audio",
  badge: "selo",
  box: "caixa",
  button: "botao",
  divider: "linha",
  heading: "titulo",
  icon: "icone",
  image: "img",
  links: "links",
  shape: "forma",
  spacer: "espaco",
  text: "texto",
  video: "video"
};

function cloneWithIds(node: FreeNode, take: (prefix: string) => FreeId, cta: NoticeDraft["cta"]): FreeNode {
  const id = take(TYPE_PREFIX[node.type]);

  if (node.type === "box") {
    return { ...node, children: node.children.map((child) => cloneWithIds(child, take, cta)), id };
  }

  if (isCta(node)) {
    const { label: unusedLabel, ...rest } = node;

    void unusedLabel;

    return {
      ...rest,
      action: { href: cta?.href.trim() ?? "", kind: "link", target: cta?.target ?? "same_tab" },
      id,
      label: (cta?.label.trim() || FREE_STARTER_CTA.label).slice(0, L.label)
    };
  }

  return { ...node, id };
}

/** Por que nao da para duplicar (null = da). */
export function freeDuplicateProblem(design: PopupFreeDesign, id: FreeId): string | null {
  const found = locate(design, id);

  if (!found) {
    return M.design;
  }

  const node = found.node;

  if (contains(node, (item) => item.type === "links")) return M.linksDuplicate;
  if (contains(node, (item) => item.type === "audio")) return M.audioDuplicate;
  if (contains(node, (item) => item.type === "video")) return M.videoDuplicate;

  if (found.parent && found.parent.children.length >= L.childrenPerBox) {
    return M.childrenPerBox;
  }

  // A copia conta como vai entrar (o Botão principal vira um "Abrir um link").
  return freeAddProblem(design, [cloneWithIds(node, (prefix) => prefix, null)]);
}

/**
 * Duplica logo depois do original (ids novos em tudo). O Botão principal duplicado vira um botao "Abrir um link"
 * com o mesmo texto e destino (so se ainda nao ha um). Um solto duplicado anda 16 px para baixo e para a direita.
 */
export function duplicateFreeNode(design: PopupFreeDesign, id: FreeId, cta: NoticeDraft["cta"]): { design: PopupFreeDesign; id: FreeId } | { reason: string } {
  const problem = freeDuplicateProblem(design, id);

  if (problem) {
    return { reason: problem };
  }

  const found = locate(design, id) as Located;
  const added: FreeNode[] = [];
  const take = (prefix: string) => {
    const next = nextFreeId({ ...design, children: [...design.children, ...added] }, prefix);

    added.push({ id: next, type: "spacer" });

    return next;
  };
  let copy = cloneWithIds(found.node, take, cta);

  if (copy.place?.mode === "free") {
    const moved = freePlaceNumbers({ x: copy.place.x + 16, y: copy.place.y + 16 });

    copy = { ...copy, place: { ...copy.place, x: moved.x ?? copy.place.x, y: moved.y ?? copy.place.y } };
  }

  const next = insertNode(design, found.parent?.id ?? null, found.index + 1, copy);

  return { design: next, id: copy.id };
}

/** Por que nao da para excluir (Links e Áudio ficam sempre). */
export function freeRemoveProblem(design: PopupFreeDesign, id: FreeId): string | null {
  const found = locate(design, id);

  if (!found) {
    return M.design;
  }

  if (contains(found.node, (item) => item.type === "links")) {
    return FREE_EDITOR_COPY.canNotRemove.links;
  }

  if (contains(found.node, (item) => item.type === "audio")) {
    return FREE_EDITOR_COPY.canNotRemove.audio;
  }

  return null;
}

/** Exclui. Tirar o Botão principal tira o botao do aviso (`ctaRemoved`). */
export function removeFreeNode(design: PopupFreeDesign, id: FreeId): { ctaRemoved: boolean; design: PopupFreeDesign } | { reason: string } {
  const problem = freeRemoveProblem(design, id);

  if (problem) {
    return { reason: problem };
  }

  const detached = detach(design, id);

  if (!detached) {
    return { reason: M.design };
  }

  return { ctaRemoved: contains(detached.node, isCta), design: detached.design };
}

/* ------------------------------------------------------------------------------------------------
 * Subir, descer, caixas
 * ---------------------------------------------------------------------------------------------- */

/** Sobe (-1) ou desce (+1) entre os irmaos; no limite da lista, null. */
export function moveFreeNodeInList(design: PopupFreeDesign, id: FreeId, direction: -1 | 1): PopupFreeDesign | null {
  const found = locate(design, id);

  if (!found) {
    return null;
  }

  const parentId = found.parent?.id ?? null;
  const siblings = [...childrenOf(design, parentId)];
  const target = found.index + direction;

  if (target < 0 || target >= siblings.length) {
    return null;
  }

  [siblings[found.index], siblings[target]] = [siblings[target], siblings[found.index]];

  return withChildren(design, parentId, siblings);
}

function flowPlaceOf(node: FreeNode): FreeNode {
  if (node.place?.mode !== "free") {
    return node;
  }

  const z = node.place.z;

  return { ...node, place: z ? { mode: "flow", z } : undefined };
}

/** As caixas que podem receber o elemento (nao ele mesmo, nao uma caixa de dentro dele, nao a caixa onde ja esta). */
export function freeBoxTargets(design: PopupFreeDesign, id: FreeId): { id: FreeId; label: string }[] {
  const found = locate(design, id);

  if (!found) {
    return [];
  }

  const height = boxHeight(found.node);
  const targets: { id: FreeId; label: string }[] = [];

  walkFreeNodes(design.children, (node, info) => {
    if (node.type !== "box" || node.id === id || node.id === found.parent?.id) {
      return;
    }

    if (contains(found.node, (item) => item.id === node.id)) {
      return;
    }

    if (node.children.length >= L.childrenPerBox || info.depth + height > L.boxDepth) {
      return;
    }

    targets.push({ id: node.id, label: freeLayerLabel(node, null) });
  });

  return targets;
}

/** Coloca no fim da caixa. Um solto vira sequencia sozinho (`becameFlow`). */
export function moveFreeNodeIntoBox(design: PopupFreeDesign, id: FreeId, boxId: FreeId): { becameFlow: boolean; design: PopupFreeDesign } | null {
  if (!freeBoxTargets(design, id).some((target) => target.id === boxId)) {
    return null;
  }

  const detached = detach(design, id);

  if (!detached) {
    return null;
  }

  const becameFlow = detached.node.place?.mode === "free";
  const box = locate(detached.design, boxId);

  if (!box || box.node.type !== "box") {
    return null;
  }

  return { becameFlow, design: insertNode(detached.design, boxId, box.node.children.length, flowPlaceOf(detached.node)) };
}

/** Tira da caixa: entra logo depois dela, na caixa de fora (ou na prancheta). */
export function moveFreeNodeOutOfBox(design: PopupFreeDesign, id: FreeId): PopupFreeDesign | null {
  const found = locate(design, id);

  if (!found?.parent) {
    return null;
  }

  const parent = locate(design, found.parent.id) as Located;
  const detached = detach(design, id) as NonNullable<ReturnType<typeof detach>>;

  return insertNode(detached.design, parent.parent?.id ?? null, parent.index + 1, detached.node);
}

/* ------------------------------------------------------------------------------------------------
 * Esconder, travar, nome, camada
 * ---------------------------------------------------------------------------------------------- */

export function setFreeNodeFlag(design: PopupFreeDesign, id: FreeId, flag: "hidden" | "locked", value: boolean): PopupFreeDesign {
  return updateFreeNode(design, id, (node) => {
    if (Boolean(node[flag]) === value) {
      return node;
    }

    const next = { ...node };

    if (value) {
      next[flag] = true;
    } else {
      delete next[flag];
    }

    return next;
  });
}

export function renameFreeNode(design: PopupFreeDesign, id: FreeId, name: string): PopupFreeDesign {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, L.name);

  return updateFreeNode(design, id, (node) => {
    if ((node.name ?? "") === clean) {
      return node;
    }

    const next = { ...node };

    if (clean) {
      next.name = clean;
    } else {
      delete next.name;
    }

    return next;
  });
}

/** Camada: `]` traz para frente (+1), `[` envia para tras (-1), de -10 a 10. */
export function shiftFreeNodeLayer(design: PopupFreeDesign, id: FreeId, delta: number): PopupFreeDesign {
  return updateFreeNode(design, id, (node) => {
    const current = node.place?.z ?? 0;
    const z = Math.max(L.z.min, Math.min(L.z.max, current + delta));

    if (z === current) {
      return node;
    }

    if (node.place?.mode === "free") {
      const place: FreeAbsolutePlace = { ...node.place, z };

      if (!z) {
        delete place.z;
      }

      return { ...node, place };
    }

    const place: FreeFlowPlace = { ...(node.place ?? { mode: "flow" as const }), z };

    if (!z) {
      delete place.z;
    }

    return { ...node, place: Object.keys(place).length === 1 ? undefined : place };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Posicao solta: setas, arrastar, alinhar, soltar, seguir a sequencia
 * ---------------------------------------------------------------------------------------------- */

/** Setas: so solto e nao travado; devolve o mesmo design quando nao mexe. */
export function nudgeFreeNode(design: PopupFreeDesign, id: FreeId, dx: number, dy: number): PopupFreeDesign {
  return updateFreeNode(design, id, (node) => {
    if (node.locked || node.place?.mode !== "free") {
      return node;
    }

    const place = nudgeFreePlace(node.place, dx, dy);

    return place.x === node.place.x && place.y === node.place.y ? node : { ...node, place };
  });
}

/** Grava X/Y/largura/altura de um solto (fim de um arrastar, redimensionar ou alinhar). */
export function setFreeNodeRect(design: PopupFreeDesign, id: FreeId, rect: Partial<FreeRect>): PopupFreeDesign {
  return updateFreeNode(design, id, (node) => {
    if (node.place?.mode !== "free") {
      return node;
    }

    const numbers = freePlaceNumbers(rect);
    const place: FreeAbsolutePlace = { ...node.place, ...numbers };

    if (place.x === node.place.x && place.y === node.place.y && place.w === node.place.w && place.h === node.place.h) {
      return node;
    }

    return { ...node, place };
  });
}

/** Alinhar no pop-up (comando `align` do painel): a conta com o retangulo medido. */
export function alignFreeNode(design: PopupFreeDesign, id: FreeId, edge: FreeAlignEdge, rects: FreeMeasuredRects): PopupFreeDesign {
  const found = locate(design, id);
  const artboard = rects["@artboard"];

  if (!found || found.node.place?.mode !== "free" || found.node.locked || !artboard) {
    return design;
  }

  const place = found.node.place;
  const measured = rects[id];
  const rect: FreeRect = { h: place.h ?? measured?.h ?? 0, w: place.w, x: place.x, y: place.y };

  return setFreeNodeRect(design, id, alignFreeRect(rect, edge, artboard));
}

/**
 * "Soltar": vira solto no mesmo lugar (pelo retangulo medido) e vai para a prancheta, logo depois da caixa de fora
 * onde estava (a ordem das Camadas fica perto da de antes).
 */
export function freeNodeToFree(design: PopupFreeDesign, id: FreeId, rects: FreeMeasuredRects): PopupFreeDesign | null {
  const found = locate(design, id);
  const rect = rects[id];

  if (!found || found.node.place?.mode === "free" || !rect) {
    return null;
  }

  const place = freePlaceFromRect(found.node.type, rect, found.node.place?.z);
  let rootIndex = found.index;
  let ancestor: Located | null = found;

  while (ancestor?.parent) {
    ancestor = locate(design, ancestor.parent.id);
    rootIndex = ancestor?.index ?? rootIndex;
  }

  const detached = detach(design, id) as NonNullable<ReturnType<typeof detach>>;
  const node = { ...detached.node, place } as FreeNode;

  return insertNode(detached.design, null, found.parent ? rootIndex + 1 : found.index, node);
}

/**
 * "Seguir a sequencia": volta para a prancheta, na posicao da sequencia logo abaixo do topo dele (pela ordem dos
 * retangulos medidos).
 */
export function freeNodeToSequence(design: PopupFreeDesign, id: FreeId, rects: FreeMeasuredRects): PopupFreeDesign | null {
  const found = locate(design, id);

  if (!found || found.node.place?.mode !== "free" || found.parent) {
    return null;
  }

  const top = rects[id]?.y ?? found.node.place.y;
  const detached = detach(design, id) as NonNullable<ReturnType<typeof detach>>;
  const flow = detached.design.children
    .map((node, index) => ({ index, node }))
    .filter(({ node }) => node.place?.mode !== "free" && !node.hidden)
    .map(({ index, node }) => ({ index, rect: rects[node.id] }));
  const index = freeSequenceIndexFor(top, flow, detached.design.children.length);

  return insertNode(detached.design, null, index, flowPlaceOf(detached.node));
}

/* ------------------------------------------------------------------------------------------------
 * Camadas: as linhas
 * ---------------------------------------------------------------------------------------------- */

/** O nome do tipo na lista (Botão principal, Caixa em linha...). */
export function freeNodeTypeLabel(node: FreeNode): string {
  if (isCta(node)) {
    return "Botão principal";
  }

  if (node.type === "box") {
    return node.layout?.dir === "row" ? "Caixa em linha" : "Caixa em coluna";
  }

  return FREE_NODE_TYPE_LABELS[node.type];
}

function snippet(text: string, max = 32) {
  const flat = text.replace(/\s+/g, " ").trim();

  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function snippetOf(node: FreeNode, cta: NoticeDraft["cta"]): string {
  switch (node.type) {
    case "heading":
    case "text":
      return snippet(freeHeadingText(node));
    case "badge":
      return snippet(node.label);
    case "button":
      return snippet(node.action.kind === "cta" ? (cta?.label ?? "") : (node.label ?? ""));
    default:
      return "";
  }
}

/** Nome da linha: o nome dado, ou o tipo + o comeco do texto ("Título · Experimente grátis"). */
export function freeLayerLabel(node: FreeNode, cta: NoticeDraft["cta"]): string {
  if (node.name?.trim()) {
    return node.name.trim();
  }

  const text = snippetOf(node, cta);

  return text ? `${freeNodeTypeLabel(node)} · ${text}` : freeNodeTypeLabel(node);
}

/** Nome acessivel do botao principal da linha ("Selecionar Título: Experimente grátis dentro de Caixa em linha"). */
function layerSelectLabel(node: FreeNode, cta: NoticeDraft["cta"], parent: FreeBoxNode | null): string {
  const base = node.name?.trim() ? node.name.trim() : snippetOf(node, cta) ? `${freeNodeTypeLabel(node)}: ${snippetOf(node, cta)}` : freeNodeTypeLabel(node);
  const inside = parent ? ` ${FREE_EDITOR_COPY.layers.inside(freeLayerLabel(parent, cta))}` : "";

  return FREE_EDITOR_COPY.layers.select(`${base}${inside}`);
}

export type FreeLayerRow = {
  depth: number;
  free: boolean;
  hidden: boolean;
  id: FreeId;
  /** Posicao entre os irmaos (Subir/Descer desligam nas pontas). */
  index: number;
  inBox: boolean;
  label: string;
  locked: boolean;
  parentId: FreeId | null;
  selectLabel: string;
  siblings: number;
  type: FreeNodeType;
  warning: boolean;
};

/** As linhas das Camadas na ordem do DOM (de cima para baixo = ordem de leitura). */
export function freeLayerRows(design: PopupFreeDesign, cta: NoticeDraft["cta"], flagged: ReadonlySet<FreeId> = new Set()): FreeLayerRow[] {
  const rows: FreeLayerRow[] = [];

  walkFreeNodes(design.children, (node, info) => {
    rows.push({
      depth: info.depth,
      free: node.place?.mode === "free",
      hidden: Boolean(node.hidden),
      id: node.id,
      inBox: Boolean(info.parent),
      index: info.index,
      label: freeLayerLabel(node, cta),
      locked: Boolean(node.locked),
      parentId: info.parent?.id ?? null,
      selectLabel: layerSelectLabel(node, cta, info.parent),
      siblings: info.parent ? info.parent.children.length : design.children.length,
      type: node.type,
      warning: flagged.has(node.id)
    });
  });

  return rows;
}

/** "Selecionado: Título, X 24, Y 120." (o retangulo medido; solto: a posicao do design). */
export function freeSelectionDescription(design: PopupFreeDesign, selectedId: FreeId | null, rects: FreeMeasuredRects): string {
  const found = selectedId ? locate(design, selectedId) : null;

  if (!found) {
    return FREE_EDITOR_COPY.stage.nothing;
  }

  const place = found.node.place;
  const rect = rects[found.node.id];
  const x = place?.mode === "free" ? place.x : Math.round(rect?.x ?? 0);
  const y = place?.mode === "free" ? place.y : Math.round(rect?.y ?? 0);
  const name = found.node.name?.trim() || freeNodeTypeLabel(found.node);

  return FREE_EDITOR_COPY.stage.selected(name, x, y);
}

/* ------------------------------------------------------------------------------------------------
 * Erros do design (navegador) e itens do Revisar
 * ---------------------------------------------------------------------------------------------- */

/** "freeDesign" -> "design"; "freeDesign.nodes.x" -> "nodes.x"; o resto fica (cta.label, audio). */
export function stripFreeDesignPrefix(key: string): string {
  if (key === "freeDesign") {
    return "design";
  }

  return key.startsWith("freeDesign.") ? key.slice("freeDesign.".length) : key;
}

/** O botao do aviso pela regra do modelo (templateCtaSchema), com as chaves do rascunho ("cta.href", "cta.label"). */
function templateCtaProblems(cta: unknown): { message: string; path: string[] }[] {
  if (cta === null || cta === undefined) {
    return [];
  }

  const parsed = templateCtaSchema.safeParse(cta);

  return parsed.success ? [] : parsed.error.issues.map((issue) => ({ message: issue.message, path: ["cta", ...issue.path.map(String)] }));
}

function safeCanonical(design: PopupFreeDesign): PopupFreeDesign {
  try {
    return canonicalPopupFreeDesign(design);
  } catch {
    return design;
  }
}

/**
 * Os erros do design no navegador: o zod do Livre (as mesmas frases do servidor), as regras com o conteudo do
 * aviso e o botao do aviso que o Livre edita no Botão principal (o mesmo zod do rascunho: o "Saiba mais" de um
 * modelo, sem destino, aparece aqui como no salvar e no card). Chaves sem o prefixo "freeDesign." (nodes.<id>...,
 * artboard..., close..., assets..., fonts, size, design), mais "cta.label"/"cta.href" (o Botão principal) e "audio"
 * (o elemento Áudio). Num modelo (`ctaOptional`), o botao segue a regra do modelo (docs/28 D8): texto e destino podem
 * ficar vazios, preenchidos seguem a mesma regra do aviso.
 */
export function freeEditorErrors(
  design: PopupFreeDesign,
  content: { allowSnooze: boolean; audio: unknown; cta: unknown; ctaOptional?: boolean }
): Record<string, string> {
  const raw: Record<string, string> = {};
  const parsed = popupFreeDesignSchema.safeParse(design);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = ["freeDesign", ...issue.path.map(String)].join(".");

      if (!(key in raw)) {
        raw[key] = issue.message;
      }
    }
  }

  const ctaProblems = content.ctaOptional ? templateCtaProblems(content.cta) : noticeCtaProblems(content.cta);

  for (const problem of [...popupFreeContentProblems(parsed.success ? parsed.data : safeCanonical(design), content), ...ctaProblems]) {
    const key = problem.path.join(".");

    if (!(key in raw)) {
      raw[key] = problem.message;
    }
  }

  return freeEditorErrorKeys(design, raw);
}

/** Erros com o prefixo (servidor, zod) no formato do editor. */
export function freeEditorErrorKeys(design: PopupFreeDesign, errors: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, message] of Object.entries(freeErrorKeys(design, { ...errors }))) {
    const clean = stripFreeDesignPrefix(key);

    if (!(clean in out)) {
      out[clean] = message;
    }
  }

  return out;
}

/** O erro do salvar e do design (Revisar) ou de fora do editor (a faixa "Há campos para revisar fora do editor"). */
export function isFreeDesignErrorKey(key: string): boolean {
  return key === "freeDesign" || key.startsWith("freeDesign.") || key === "design" || key.startsWith("cta.") || key === "cta" || key === "audio";
}

const OUTSIDE_NAMES: readonly (readonly [string, string])[] = [
  ["title", "Nome do pop-up"],
  ["body", "Texto"],
  ["image", "Imagem"],
  ["icon", "Ícone"],
  ["audio", "Áudio"],
  ["sender", "Quem envia"],
  ["schedule", "Quando"],
  ["window", "Quando"],
  ["when", "Quando"],
  ["validity", "Validade"],
  ["who", "Para quem"],
  ["segment", "Para quem"],
  ["popup.pages", "Páginas"],
  ["popup.exclude", "Páginas"],
  ["popup.frequency", "Quantas vezes"],
  ["popup.close", "Como fechar"],
  ["popup.snoozeMinutes", "Lembrar depois"],
  ["popup", "Quando aparece"],
  ["goal", "Meta"],
  ["reshow", "Mostrar de novo"],
  ["followUps", "Notificações seguintes"],
  ["allowSnooze", "Lembrar depois"]
];

/** Nomes dos campos de fora do editor com erro ("Nome do pop-up, Quando"). */
export function freeOutsideFieldNames(errors: Readonly<Record<string, string>>): string[] {
  const names: string[] = [];

  for (const key of Object.keys(errors)) {
    if (isFreeDesignErrorKey(key)) {
      continue;
    }

    const match = OUTSIDE_NAMES.find(([prefix]) => key === prefix || key.startsWith(`${prefix}.`));
    const name = match ? match[1] : "outros campos";

    if (!names.includes(name)) {
      names.push(name);
    }
  }

  return names;
}

/**
 * "Usar este modelo" na aba Modelos do editor Livre (docs/28 §5.9): o design do modelo entra como um colar (um passo
 * so no historico, sem confirmacao), com os arquivos do proprio modelo contados como deste pop-up (o servidor confere
 * de novo ao salvar, sabendo de onde vieram). Quando o botao principal nasce agora (o aviso nao tinha botao) e o
 * modelo guardou o texto dele, o botao ganha esse texto e a nota do colar ("…ganhou o texto “Saiba mais”…") vira a
 * do modelo (TEMPLATE_MESSAGES.applyCta).
 */
export function applyFreeTemplateDesign(item: { design: PopupFreeDesign; support: { ctaLabel: string | null } }, context: FreePasteContext): FreePasteResult {
  const result = parseFreeDesignPaste(JSON.stringify(item.design), { ...context, knownAssets: [...context.knownAssets, ...item.design.assets] });
  const label = item.support.ctaLabel?.trim() ?? "";

  if (!result.ok || context.content.cta || !result.cta || !label) {
    return result;
  }

  return {
    ...result,
    cta: { ...result.cta, label },
    notes: result.notes.map((note) => (note === POPUP_FREE_PASTE_MESSAGES.cta ? TEMPLATE_MESSAGES.applyCta(label) : note))
  };
}

/**
 * O botao de salvar do editor Livre (docs/27 L16): no pop-up no ar ou pausado (`savesInPlace`), o do editor do aviso
 * ("Salvar alterações": vale para os alunos na hora); no resto, "Salvar rascunho".
 */
export function freeSaveLabel(savesInPlace: boolean): string {
  return savesInPlace ? SENT_NOTICE_COPY.save : FREE_EDITOR_COPY.bar.saveDraft;
}

/** A frase depois de salvar: a do editor do aviso (no pop-up no ar, o que acontece com quem ja viu); sem ela, "Rascunho salvo.". */
export function freeSavedMessage(message: string | undefined): string {
  return message ?? FREE_EDITOR_COPY.save.saved;
}

/** O elemento de uma chave de erro ou dica (o Botão principal para "cta.*", o Áudio para "audio"). */
export function freeNodeIdForKey(design: PopupFreeDesign, key: string): FreeId | null {
  const direct = freeNodeIdOfKey(key);

  if (direct) {
    return locate(design, direct) ? direct : null;
  }

  if (key === "cta" || key.startsWith("cta.")) {
    return freeCtaNode(design)?.id ?? null;
  }

  if (key === "audio") {
    let audio: FreeId | null = null;

    walkFreeNodes(design.children, (node) => {
      if (!audio && node.type === "audio") {
        audio = node.id;
      }
    });

    return audio;
  }

  return null;
}

export type FreeReviewItem = {
  /** "raise" = o botao Aumentar a altura; "font" = Enviar fonte… */
  action: "font" | "raise" | null;
  key: string;
  kind: FreeHint["kind"] | "error";
  message: string;
  nodeId: FreeId | null;
  nodeName: string;
};

/** Os itens do Revisar: erros (impedem salvar) e dicas, cada um com o nome do elemento. */
export function freeReviewItems(
  design: PopupFreeDesign,
  errors: Readonly<Record<string, string>>,
  hints: readonly FreeHint[]
): { errors: FreeReviewItem[]; hints: FreeReviewItem[] } {
  const nameOf = (nodeId: FreeId | null, key: string) => {
    const node = nodeId ? locate(design, nodeId)?.node : null;

    if (node) {
      return freeNodeDisplayName(node);
    }

    return key === "design" || key === "size" || key === "fonts" ? FREE_EDITOR_COPY.review.designName : FREE_EDITOR_COPY.review.popupName;
  };

  return {
    errors: Object.entries(errors).map(([key, message]) => {
      const nodeId = freeNodeIdForKey(design, key);

      return { action: null, key, kind: "error" as const, message, nodeId, nodeName: nameOf(nodeId, key) };
    }),
    hints: hints.map((hint) => {
      const nodeId = hint.nodeId && locate(design, hint.nodeId) ? hint.nodeId : null;

      return {
        action: hint.kind === "cut" ? ("raise" as const) : hint.kind === "font-device" ? ("font" as const) : null,
        key: hint.key,
        kind: hint.kind,
        message: hint.message,
        nodeId,
        nodeName: nameOf(nodeId, hint.key)
      };
    })
  };
}

/** Os elementos com erro ou dica (o ⚠ das Camadas). */
export function freeFlaggedNodeIds(design: PopupFreeDesign, errors: Readonly<Record<string, string>>, hints: readonly FreeHint[]): Set<FreeId> {
  const flagged = new Set<FreeId>();

  for (const key of Object.keys(errors)) {
    const id = freeNodeIdForKey(design, key);

    if (id) {
      flagged.add(id);
    }
  }

  for (const hint of hints) {
    if (hint.nodeId) {
      flagged.add(hint.nodeId);
    }
  }

  return flagged;
}

/** "Aumentar a altura": a Altura mínima da prancheta vai ate o fim do elemento cortado (retangulo medido). */
export function raiseFreeArtboardTo(design: PopupFreeDesign, id: FreeId, rects: FreeMeasuredRects): PopupFreeDesign {
  const rect = rects[id];

  if (!rect) {
    return design;
  }

  const bottom = Math.ceil(rect.y + rect.h);
  const minHeight = Math.max(L.minHeight.min, Math.min(L.minHeight.max, bottom));

  if (resolveFreeArtboard(design).minHeight >= minHeight) {
    return design;
  }

  return { ...design, artboard: { ...design.artboard, minHeight } };
}

/** Poe a fonte enviada no texto da dica (o estilo do elemento ou da parte). */
export function applyFreeFontAtKey(design: PopupFreeDesign, key: string, font: PopupFontRef): PopupFreeDesign {
  const id = freeNodeIdOfKey(key);
  const span = /\.lines\.(\d+)\.(\d+)\.style\.font$/.exec(key);

  if (!id) {
    return design;
  }

  return updateFreeNode(design, id, (node) => {
    if (span && (node.type === "heading" || node.type === "text")) {
      const line = Number(span[1]);
      const part = Number(span[2]);

      if (!node.lines[line]?.[part]) {
        return node;
      }

      return {
        ...node,
        lines: node.lines.map((items, lineIndex) =>
          lineIndex === line ? items.map((item, partIndex) => (partIndex === part ? { ...item, style: { ...item.style, font } } : item)) : items
        )
      };
    }

    if (node.type === "heading" || node.type === "text" || node.type === "badge" || node.type === "button" || node.type === "links") {
      return { ...node, textStyle: { ...node.textStyle, font } };
    }

    return node;
  });
}

/* ------------------------------------------------------------------------------------------------
 * Previa
 * ---------------------------------------------------------------------------------------------- */

/** O design do palco com as fontes enviadas recalculadas (o item de previa filtra as fontes por `fonts`). */
export function freeStageDesign(design: PopupFreeDesign): PopupFreeDesign {
  const fonts = uploadedFontIdsOfFree(design);

  return fonts.length === design.fonts.length && fonts.every((id, index) => id === design.fonts[index]) ? design : { ...design, fonts };
}

/** Um design so com os Links (o foco ao abrir vai para o palco, nao para as Camadas). */
export function freeOnlyLinks(design: PopupFreeDesign): boolean {
  return design.children.every((node) => node.type === "links");
}

/** O tipo de um elemento pelo id. */
export function freeNodeOf(design: Pick<PopupFreeDesign, "children">, id: FreeId | null): FreeNode | null {
  return id ? (locate(design, id)?.node ?? null) : null;
}

/** Elementos que se movem e redimensionam pelo desenho (soltos e nao travados). */
export function isFreeMovable(node: FreeNode | null): boolean {
  return Boolean(node && node.place?.mode === "free" && !node.locked);
}

/** Por que nao da para "Soltar" (null = da): o limite de soltos na prancheta. */
export function freeToFreeProblem(design: Pick<PopupFreeDesign, "children">, id: FreeId): string | null {
  const node = locate(design, id)?.node;

  if (!node || node.place?.mode === "free") {
    return "";
  }

  return design.children.filter((item) => item.place?.mode === "free").length >= L.freeNodes ? M.freeNodes : null;
}

/** Ja existe um botao "Abrir um link" (o Duplicar do Botão principal desliga). */
export function freeHasLinkButton(design: Pick<PopupFreeDesign, "children">): boolean {
  let found = false;

  walkFreeNodes(design.children, (node) => {
    found ||= isLinkButton(node);
  });

  return found;
}

/* ------------------------------------------------------------------------------------------------
 * Camadas pelo teclado (spec §4.5)
 * ---------------------------------------------------------------------------------------------- */

export type FreeLayerKeyAction =
  | { index: number; kind: "button" }
  | { index: number; kind: "row" }
  | { kind: "duplicate" | "menu" | "moveDown" | "moveUp" | "remove" | "rename" | "select" | "toggleHidden" | "toggleLocked" };

/**
 * O que uma tecla faz numa linha das Camadas: ↑/↓ andam pela lista, →/← pelos botoes da linha, Enter seleciona,
 * Alt + ↑/↓ sobem/descem o elemento, E esconde/mostra, T trava/destrava, Shift + F10 (ou a tecla de menu) abre o
 * ⋯, Delete exclui, Ctrl + D duplica, F2 renomeia. Null = a tecla segue o caminho normal.
 */
export function freeLayerKeyAction(
  event: { altKey: boolean; ctrlKey: boolean; key: string; metaKey: boolean; shiftKey: boolean },
  position: { button: number; buttons: number; row: number; rows: number }
): FreeLayerKeyAction | null {
  const plain = !event.altKey && !event.ctrlKey && !event.metaKey;

  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      return { kind: event.key === "ArrowUp" ? "moveUp" : "moveDown" };
    }

    if (!plain) {
      return null;
    }

    const row = event.key === "ArrowUp" ? Math.max(0, position.row - 1) : Math.min(position.rows - 1, position.row + 1);

    return { index: row, kind: "row" };
  }

  if (plain && (event.key === "Home" || event.key === "End")) {
    return { index: event.key === "Home" ? 0 : Math.max(0, position.rows - 1), kind: "row" };
  }

  if (plain && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
    const button = event.key === "ArrowRight" ? Math.min(position.buttons - 1, position.button + 1) : Math.max(0, position.button - 1);

    return { index: button, kind: "button" };
  }

  if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
    return { kind: "menu" };
  }

  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "d") {
    return { kind: "duplicate" };
  }

  if (!plain) {
    return null;
  }

  switch (event.key) {
    case "Enter":
      return position.button === 0 ? { kind: "select" } : null;
    case "e":
    case "E":
      return { kind: "toggleHidden" };
    case "t":
    case "T":
      return { kind: "toggleLocked" };
    case "Delete":
      return { kind: "remove" };
    case "F2":
      return { kind: "rename" };
    default:
      return null;
  }
}
