// Design Livre do pop-up (docs/27): os 3 modelos para comecar, o elemento novo de cada tipo (o que o painel
// Elementos acrescenta) e a sincronia com o conteudo do aviso (audio e botao principal). Modulo puro, imports
// relativos; so o editor usa (o cartao do aluno nunca importa este arquivo). Textos neutros em portugues.

import { POPUP_VIDEO_PATH_PATTERN, type PopupVideoMimeType } from "./popup-design-model";
import {
  canonicalPopupFreeDesign,
  FREE_DESIGN_LIMITS,
  freeNodeCount,
  nextFreeId,
  type FreeAsset,
  type FreeId,
  type FreeNode,
  type FreeNodeType,
  type PopupFreeDesign,
  type PopupFreeDesignInput
} from "./popup-free-model";
import { FREE_IMAGE_PATH_PATTERN, resolveFreeArtboard } from "./popup-free-render";

/* ------------------------------------------------------------------------------------------------
 * Elementos novos
 * ---------------------------------------------------------------------------------------------- */

/** O que o painel Elementos oferece (Degradê e as duas Caixas viram forma e caixa no design). */
export const FREE_ELEMENT_KINDS = [
  "heading", "text", "badge", "cta", "button", "image", "video", "icon", "shape", "gradient", "divider", "spacer", "column", "row", "audio", "links"
] as const;
export type FreeElementKind = (typeof FREE_ELEMENT_KINDS)[number];

/** Prefixo do id de cada elemento novo (nextFreeId(design, prefixo) -> "titulo", "titulo2"...). */
export const FREE_ELEMENT_ID_PREFIX: Record<FreeElementKind, string> = {
  audio: "audio",
  badge: "selo",
  button: "botao",
  column: "caixa",
  cta: "principal",
  divider: "linha",
  gradient: "degrade",
  heading: "titulo",
  icon: "icone",
  image: "img",
  links: "links",
  row: "caixa",
  shape: "forma",
  spacer: "espaco",
  text: "texto",
  video: "video"
};

/** O cta que um modelo (ou o Botão principal novo) cria quando o aviso nao tem botao: o destino fica vazio. */
export const FREE_STARTER_CTA = { href: "", label: "Saiba mais", target: "same_tab" } as const;

export type FreeNewNodeContext = {
  /** O design onde o elemento entra (a cor do fundo do Degradê, a largura da prancheta). */
  design?: Pick<PopupFreeDesign, "artboard">;
  /** O centro do que se ve no palco (px da prancheta), para a Forma solta; sem = o centro da prancheta. */
  center?: { x: number; y: number };
};

function clearOf(color: string) {
  return `${color.slice(0, 7)}00`;
}

/** O elemento novo de cada tipo, com os valores iniciais (o painel Elementos acrescenta este). */
export function newFreeNode(kind: FreeElementKind | FreeNodeType, id: FreeId, context: FreeNewNodeContext = {}): FreeNode {
  const artboard = resolveFreeArtboard(context.design ?? {});

  switch (kind) {
    case "heading":
      return { id, lines: [[{ text: "Seu título aqui" }]], type: "heading" };
    case "text":
      return { id, lines: [[{ text: "Escreva aqui o texto do pop-up." }]], textStyle: { paint: { color: "#d4d4d8", kind: "solid" } }, type: "text" };
    case "badge":
      return { box: { fill: [{ color: "#ffffff1f", kind: "solid" }], padding: [4, 10], radius: 999 }, id, label: "Novidade", type: "badge" };
    case "cta":
      return { action: { kind: "cta" }, box: { fill: [{ color: "#e50914", kind: "solid" }], padding: [12, 24], radius: 999 }, id, type: "button" };
    case "button":
      return {
        action: { kind: "close" },
        box: { border: { color: "#ffffff40", width: 1 }, padding: [11, 22], radius: 999 },
        id,
        label: "Agora não",
        type: "button"
      };
    case "image":
      return { asset: null, id, type: "image" };
    case "video":
      return { asset: null, id, type: "video" };
    case "icon":
      return { icon: "sparkles", id, type: "icon" };
    case "shape": {
      const center = context.center ?? { x: artboard.width / 2, y: 140 };

      return {
        box: { fill: [{ color: "#ffffff26", kind: "solid" }], radius: 16 },
        id,
        place: { h: 120, mode: "free", w: 120, x: Math.round(center.x - 60), y: Math.round(center.y - 60) },
        type: "shape"
      };
    }
    case "gradient": {
      const base = artboard.fill[artboard.fill.length - 1];
      const color = base?.kind === "solid" ? base.color : base?.kind === "linear" || base?.kind === "radial" ? (base.stops[0]?.color ?? "#16181c") : "#16181c";

      return {
        box: { fill: [{ kind: "linear", stops: [{ at: 0, color: clearOf(color) }, { at: 100, color: color.slice(0, 7) }] }] },
        id,
        name: "Degradê",
        place: { h: 200, mode: "free", w: artboard.width, x: 0, y: 0, z: -1 },
        type: "shape"
      };
    }
    case "divider":
      return { id, type: "divider" };
    case "spacer":
      return { id, type: "spacer" };
    case "row":
      return { children: [], id, layout: { align: "center", dir: "row", gap: 8 }, type: "box" };
    case "column":
    case "box":
      return { children: [], id, layout: { gap: 8 }, type: "box" };
    case "audio":
      return { id, type: "audio" };
    case "links":
      return { id, type: "links" };
  }
}

/* ------------------------------------------------------------------------------------------------
 * Sincronia com o conteudo do aviso
 * ---------------------------------------------------------------------------------------------- */

function containsType(nodes: readonly FreeNode[], match: (node: FreeNode) => boolean): boolean {
  return nodes.some((node) => match(node) || (node.type === "box" && containsType(node.children, match)));
}

function withoutType(nodes: readonly FreeNode[], match: (node: FreeNode) => boolean): FreeNode[] {
  return nodes.filter((node) => !match(node)).map((node) => (node.type === "box" ? { ...node, children: withoutType(node.children, match) } : node));
}

/** Posicao na prancheta: antes do primeiro botao; sem botao, antes dos Links; sem nenhum, no fim. */
function insertBeforeButtons(nodes: readonly FreeNode[], node: FreeNode, includeButtons: boolean): FreeNode[] {
  const firstButton = includeButtons ? nodes.findIndex((item) => item.type === "button") : -1;
  const links = nodes.findIndex((item) => item.type === "links");
  const at = firstButton !== -1 ? firstButton : links !== -1 ? links : nodes.length;

  return [...nodes.slice(0, at), node, ...nodes.slice(at)];
}

const isAudio = (node: FreeNode) => node.type === "audio";
const isCta = (node: FreeNode) => node.type === "button" && node.action.kind === "cta";

/**
 * Deixa o design coerente com o conteudo do aviso: com audio, o Áudio existe (antes do primeiro botao da
 * prancheta, se faltava); sem audio, sai. Com botao, o Botão principal existe (antes dos Links, se faltava); sem
 * botao, sai. Devolve o mesmo objeto quando nada muda.
 */
export function syncFreeDesignWithContent(design: PopupFreeDesign, content: { hasAudio: boolean; hasCta: boolean }): PopupFreeDesign {
  let children = design.children;
  const hasAudioNode = containsType(children, isAudio);
  const hasCtaNode = containsType(children, isCta);

  if (!content.hasAudio && hasAudioNode) {
    children = withoutType(children, isAudio);
  } else if (content.hasAudio && !hasAudioNode && freeNodeCount({ children }) < FREE_DESIGN_LIMITS.nodes) {
    children = insertBeforeButtons(children, newFreeNode("audio", nextFreeId({ ...design, children }, "audio")), true);
  }

  if (!content.hasCta && hasCtaNode) {
    children = withoutType(children, isCta);
  } else if (content.hasCta && !hasCtaNode && freeNodeCount({ children }) < FREE_DESIGN_LIMITS.nodes) {
    children = insertBeforeButtons(children, newFreeNode("cta", nextFreeId({ ...design, children }, "principal")), false);
  }

  return children === design.children ? design : { ...design, children };
}

/* ------------------------------------------------------------------------------------------------
 * Modelos para comecar
 * ---------------------------------------------------------------------------------------------- */

export const FREE_DESIGN_STARTERS = [
  {
    description: "Vídeo em cima sumindo no fundo escuro, selo, título em duas cores e botão verde.",
    id: "video_top_fade",
    label: "Vídeo no topo com degradê"
  },
  { description: "Sem mídia: manchas de luz no fundo, título em degradê e botão largo.", id: "glow_text", label: "Só texto com brilho" },
  { description: "Só o fundo, um título, o botão e os links. Você coloca o resto.", id: "blank", label: "Em branco" }
] as const;
export type FreeStarterId = (typeof FREE_DESIGN_STARTERS)[number]["id"];

/** "Vídeo no topo com degradê" (a estrutura da referencia; cores conferidas contra ela). */
const VIDEO_TOP_FADE: PopupFreeDesignInput = {
  artboard: {
    align: "center",
    border: { color: "#ffffff1a", width: 1 },
    fill: [{ kind: "linear", stops: [{ at: 0, color: "#111216" }, { at: 55, color: "#16181d" }, { at: 100, color: "#262b34" }] }],
    gap: 0,
    padding: [168, 24, 20, 24],
    shadows: [{ blur: 80, color: "#000000b3", spread: 0, x: 0, y: 24 }]
  },
  assets: [],
  children: [
    {
      asset: null,
      box: { fade: { end: 100, side: "bottom", start: 40 } },
      id: "midia",
      name: "Vídeo do topo",
      place: { h: 248, mode: "free", w: 440, x: 0, y: 0 },
      type: "video"
    },
    {
      box: {
        border: { color: "#ff9ccf", width: 1 },
        fill: [{ kind: "linear", stops: [{ at: 0, color: "#e0007a" }, { at: 100, color: "#d1006f" }] }],
        padding: [4, 10],
        radius: 999,
        shadows: [{ blur: 0, color: "#ffffff59", inset: true, spread: 0, x: 0, y: 1 }]
      },
      icon: "gift",
      id: "selo",
      label: "Novidade",
      type: "badge"
    },
    {
      id: "titulo",
      lines: [[{ style: { paint: { color: "#e5ff1f", kind: "solid" } }, text: "Experimente grátis" }], [{ text: "Nova aula ao vivo" }]],
      place: { margin: [12, 0, 0, 0], mode: "flow" },
      textStyle: { align: "center", font: { key: "condensed", kind: "builtin" }, lineHeight: 0.95, size: 40, uppercase: true },
      type: "heading"
    },
    {
      id: "texto",
      lines: [[{ text: "Uma aula nova acabou de entrar na sua área. Assista agora e coloque em prática ainda hoje." }]],
      place: { margin: [12, 0, 0, 0], mode: "flow" },
      textStyle: { align: "center", paint: { color: "#a1a1aa", kind: "solid" } },
      type: "text"
    },
    {
      action: { kind: "cta" },
      box: {
        fill: [{ kind: "linear", stops: [{ at: 0, color: "#f0ff5c" }, { at: 100, color: "#d9f500" }] }],
        padding: [12, 22],
        radius: 10,
        shadows: [
          { blur: 0, color: "#9db300", spread: 0, x: 0, y: 3 },
          { blur: 0, color: "#ffffff80", inset: true, spread: 0, x: 0, y: 1 }
        ]
      },
      id: "botao",
      place: { margin: [24, 0, 0, 0], mode: "flow" },
      textStyle: { paint: { color: "#111216", kind: "solid" } },
      type: "button"
    },
    {
      id: "links",
      place: { margin: [12, 0, 0, 0], mode: "flow" },
      textStyle: { align: "center", paint: { color: "#a1a1aa", kind: "solid" } },
      type: "links"
    }
  ],
  close: { background: "#ffffff40", size: 28 },
  mode: "free",
  version: 1
};

/** "Só texto com brilho": sem midia, duas manchas de luz soltas atras, titulo com uma parte em degrade. */
const GLOW_TEXT: PopupFreeDesignInput = {
  artboard: {
    align: "center",
    border: { color: "#ffffff14", width: 1 },
    fill: [{ color: "#0b0b12", kind: "solid" }],
    gap: 14,
    padding: [44, 28, 12, 28],
    shadows: [{ blur: 80, color: "#000000b3", spread: 0, x: 0, y: 24 }]
  },
  assets: [],
  children: [
    {
      box: { blur: 40, fill: [{ extent: "closest-side", kind: "radial", stops: [{ at: 0, color: "#7c3aed99" }, { at: 100, color: "#7c3aed00" }], x: 50, y: 50 }] },
      id: "luz1",
      name: "Luz roxa",
      place: { h: 280, mode: "free", w: 280, x: -90, y: -90, z: -1 },
      shape: "ellipse",
      type: "shape"
    },
    {
      box: { blur: 40, fill: [{ extent: "closest-side", kind: "radial", stops: [{ at: 0, color: "#06b6d480" }, { at: 100, color: "#06b6d400" }], x: 50, y: 50 }] },
      id: "luz2",
      name: "Luz azul",
      place: { h: 260, mode: "free", w: 260, x: 250, y: 140, z: -1 },
      shape: "ellipse",
      type: "shape"
    },
    {
      box: { border: { color: "#ffffff26", width: 1 }, fill: [{ color: "#ffffff14", kind: "solid" }], padding: [5, 12], radius: 999 },
      icon: "sparkles",
      id: "selo",
      label: "Ao vivo hoje",
      textStyle: { paint: { color: "#e9d5ff", kind: "solid" }, size: 13 },
      type: "badge"
    },
    {
      id: "titulo",
      lines: [
        [
          { text: "Sua próxima aula " },
          { style: { paint: { angle: 90, kind: "linear", stops: [{ at: 0, color: "#c084fc" }, { at: 100, color: "#22d3ee" }] } }, text: "começa às 20h" }
        ]
      ],
      textStyle: { align: "center", size: 32 },
      type: "heading"
    },
    {
      id: "texto",
      lines: [[{ text: "Entre alguns minutos antes para pegar um bom lugar e mandar as suas perguntas." }]],
      textStyle: { align: "center", paint: { color: "#d4d4d8", kind: "solid" }, size: 16 },
      type: "text"
    },
    {
      action: { kind: "cta" },
      box: {
        fill: [{ angle: 90, kind: "linear", stops: [{ at: 0, color: "#7c3aed" }, { at: 100, color: "#2563eb" }] }],
        padding: [14, 24],
        radius: 14,
        shadows: [{ blur: 32, color: "#7c3aed66", spread: 0, x: 0, y: 8 }]
      },
      id: "botao",
      place: { margin: [6, 0, 0, 0], mode: "flow", width: "fill" },
      textStyle: { size: 16 },
      type: "button"
    },
    { id: "links", textStyle: { paint: { color: "#a1a1aa", kind: "solid" }, size: 14 }, type: "links" }
  ],
  close: { background: "#ffffff14" },
  mode: "free",
  version: 1
};

/** "Em branco": so o fundo, um titulo, o botao e os links. */
const BLANK: PopupFreeDesignInput = {
  artboard: {
    border: { color: "#ffffff1a", width: 1 },
    gap: 14,
    padding: [28, 24, 12, 24],
    shadows: [{ blur: 80, color: "#000000b3", spread: 0, x: 0, y: 24 }]
  },
  assets: [],
  children: [
    { id: "titulo", lines: [[{ text: "Seu título aqui" }]], type: "heading" },
    {
      action: { kind: "cta" },
      box: { fill: [{ color: "#ffffff", kind: "solid" }], padding: [13, 24], radius: 999 },
      id: "botao",
      textStyle: { paint: { color: "#16181c", kind: "solid" }, size: 16 },
      type: "button"
    },
    { id: "links", textStyle: { paint: { color: "#a1a1aa", kind: "solid" }, size: 14 }, type: "links" }
  ],
  close: { background: "#ffffff14" },
  mode: "free",
  version: 1
};

const STARTERS: Record<FreeStarterId, PopupFreeDesignInput> = { blank: BLANK, glow_text: GLOW_TEXT, video_top_fade: VIDEO_TOP_FADE };

/** O design do modelo na forma canonica (com o Botão principal; o Vídeo sem arquivo). */
export function freeStarterDesign(id: FreeStarterId): PopupFreeDesign {
  return canonicalPopupFreeDesign(structuredClone(STARTERS[id] ?? BLANK));
}

export type FreeStarterContent = {
  /** O audio do aviso (com audio, entra o elemento Áudio). */
  audio: unknown;
  /** O botao do aviso; sem botao, o modelo cria "Saiba mais" com o destino vazio. */
  cta: { display?: "button" | "button_and_card" | "card"; href: string; label: string; target: "new_tab" | "same_tab" } | null;
  /** A imagem do aviso no nosso bucket (caminho e medidas lidas no navegador): vira a capa do video. */
  poster?: { height: number; path: string; width: number } | null;
  /** O video do Personalizado atual ou guardado: vira o arquivo do Vídeo. */
  video?: { mimeType: PopupVideoMimeType; path: string } | null;
};

/**
 * Aplica um modelo ao aviso (o card Design e o editor chamam): o design do modelo coerente com o conteudo
 * (Áudio se ha audio; o Botão principal sempre, criando o cta "Saiba mais" quando o aviso nao tem botao) e, no
 * modelo com Vídeo, o video do Personalizado como arquivo e a imagem do aviso como capa.
 */
export function applyFreeStarter(id: FreeStarterId, content: FreeStarterContent): { cta: NonNullable<FreeStarterContent["cta"]>; design: PopupFreeDesign } {
  const cta = content.cta ?? { ...FREE_STARTER_CTA };
  let design = freeStarterDesign(id);
  const video = content.video;
  const videoNode = design.children.find((node) => node.type === "video");

  if (videoNode && video && POPUP_VIDEO_PATH_PATTERN.test(video.path) && video.path.endsWith(video.mimeType === "video/mp4" ? ".mp4" : ".webm")) {
    const assets: FreeAsset[] = [];
    const poster = content.poster;
    const side = FREE_DESIGN_LIMITS.imageSide;
    const posterOk =
      poster &&
      FREE_IMAGE_PATH_PATTERN.test(poster.path) &&
      Number.isInteger(poster.width) &&
      Number.isInteger(poster.height) &&
      poster.width >= side.min &&
      poster.width <= side.max &&
      poster.height >= side.min &&
      poster.height <= side.max;

    if (posterOk) {
      assets.push({ height: poster.height, id: "capa", kind: "image", path: poster.path, width: poster.width });
    }

    assets.push({ id: "video", kind: "video", mimeType: video.mimeType, path: video.path, ...(posterOk ? { poster: "capa" } : {}) });
    design = canonicalPopupFreeDesign({
      ...design,
      assets,
      children: design.children.map((node) => (node === videoNode ? { ...node, asset: "video" } : node))
    });
  }

  return { cta, design: syncFreeDesignWithContent(design, { hasAudio: Boolean(content.audio), hasCta: true }) };
}
