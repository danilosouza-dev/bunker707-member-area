// Design Livre do pop-up (docs/27): os 4 modelos para comecar, o ponto de partida "Usar o design Personalizado"
// (freeFromCustomDesign, L1.1), o elemento novo de cada tipo (o que o painel Elementos acrescenta) e a sincronia com
// o conteudo do aviso (audio e botao principal). Modulo puro, imports relativos; so o editor usa (o cartao do aluno
// nunca importa este arquivo). Textos neutros em portugues.

import {
  POPUP_BADGE_PADDING,
  POPUP_BUTTON_METRICS,
  POPUP_CARD_WIDTHS,
  POPUP_MEDIA_RATIOS,
  POPUP_VIDEO_MIME_TYPES,
  POPUP_VIDEO_PATH_PATTERN,
  popupFadeSpan,
  type PopupAlign,
  type PopupButtonStyle,
  type PopupCardShadow,
  type PopupDesign,
  type PopupPaint,
  type PopupTextStyle,
  type PopupVideoMimeType
} from "./popup-design-model";
import {
  canonicalPopupFreeDesign,
  FREE_DESIGN_LIMITS,
  freeCloseVisibilityProblem,
  freeNodeCount,
  nextFreeId,
  withFreeMobileNodes,
  type FreeAbsolutePlace,
  type FreeAsset,
  type FreeBox,
  type FreeButtonNode,
  type FreeClose,
  type FreeFillPaint,
  type FreeId,
  type FreeNode,
  type FreeNodeType,
  type FreeShadow,
  type FreeTextPaint,
  type FreeTextStyle,
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
  /**
   * Um centro em px da prancheta: o da Forma solta (o que se ve no palco ou onde foi solta; sem = o centro da
   * prancheta) e a altura do Degradê arrastado do painel (o meio na altura do ponto; sem = no topo).
   */
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
        place: { h: 200, mode: "free", w: artboard.width, x: 0, y: context.center ? Math.max(0, Math.round(context.center.y - 100)) : 0, z: -1 },
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

/** Os ids dos elementos do tipo (dentro das caixas tambem). */
function idsOfType(nodes: readonly FreeNode[], match: (node: FreeNode) => boolean, into: FreeId[] = []): FreeId[] {
  for (const node of nodes) {
    if (match(node)) {
      into.push(node.id);
    }

    if (node.type === "box") {
      idsOfType(node.children, match, into);
    }
  }

  return into;
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
 * botao, sai. O que sai ou entra leva junto a entrada do celular (devices.mobile.nodes). Devolve o mesmo objeto
 * quando nada muda.
 */
export function syncFreeDesignWithContent(design: PopupFreeDesign, content: { hasAudio: boolean; hasCta: boolean }): PopupFreeDesign {
  let children = design.children;
  const hasAudioNode = containsType(children, isAudio);
  const hasCtaNode = containsType(children, isCta);
  // Ids que saem ou entram: a entrada do celular de cada um sai junto (o id volta igual, "audio" ou "principal", e
  // uma entrada velha grudaria no elemento novo).
  const touched: FreeId[] = [];

  if (!content.hasAudio && hasAudioNode) {
    touched.push(...idsOfType(children, isAudio));
    children = withoutType(children, isAudio);
  } else if (content.hasAudio && !hasAudioNode && freeNodeCount({ children }) < FREE_DESIGN_LIMITS.nodes) {
    const id = nextFreeId({ ...design, children }, "audio");

    touched.push(id);
    children = insertBeforeButtons(children, newFreeNode("audio", id), true);
  }

  if (!content.hasCta && hasCtaNode) {
    touched.push(...idsOfType(children, isCta));
    children = withoutType(children, isCta);
  } else if (content.hasCta && !hasCtaNode && freeNodeCount({ children }) < FREE_DESIGN_LIMITS.nodes) {
    const id = nextFreeId({ ...design, children }, "principal");

    touched.push(id);
    children = insertBeforeButtons(children, newFreeNode("cta", id), false);
  }

  if (children === design.children) {
    return design;
  }

  return withFreeMobileNodes({ ...design, children }, Object.fromEntries(touched.map((id) => [id, undefined])));
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
  { description: "Só o fundo, um título, o botão e os links. Você coloca o resto.", id: "blank", label: "Em branco" },
  {
    description: "Uma imagem sem fundo ao lado do texto, um selo inclinado por cima e dois botões.",
    id: "cutout_sticker",
    label: "Imagem recortada com selo"
  }
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

/**
 * "Imagem recortada com selo" (L1.1): a imagem sem fundo solta a direita (o produtor envia; comeca vazia), uma
 * mancha de luz atras dela, o selo inclinado por cima, o texto numa coluna a esquerda e os dois botoes lado a lado
 * (passam para a linha de baixo quando o texto do botao for longo). O selo tem largura para o texto de 12 px do
 * celular caber numa linha (a dica "texto no celular" fica quieta neste modelo), fica longe do X, e a imagem termina
 * acima da linha dos links.
 */
const CUTOUT_STICKER: PopupFreeDesignInput = {
  artboard: {
    align: "start",
    border: { color: "#ffffff1a", width: 1 },
    fill: [{ angle: 135, kind: "linear", stops: [{ at: 0, color: "#1e1b4b" }, { at: 100, color: "#0f172a" }] }],
    gap: 0,
    minHeight: 320,
    padding: [36, 32, 12, 32],
    radius: 28,
    shadows: [{ blur: 80, color: "#000000b3", spread: 0, x: 0, y: 24 }],
    width: 480
  },
  assets: [],
  children: [
    {
      box: {
        blur: 30,
        fill: [{ extent: "closest-side", kind: "radial", stops: [{ at: 0, color: "#8b5cf680" }, { at: 100, color: "#8b5cf600" }], x: 50, y: 50 }]
      },
      id: "brilho",
      name: "Brilho",
      place: { h: 280, mode: "free", w: 280, x: 250, y: -40, z: -1 },
      shape: "ellipse",
      type: "shape"
    },
    { asset: null, fit: "contain", id: "foto", name: "Imagem recortada", place: { h: 200, mode: "free", w: 170, x: 290, y: 50 }, type: "image" },
    {
      box: { fill: [{ color: "#facc15", kind: "solid" }], padding: [6, 12], radius: 8 },
      id: "selo",
      label: "Aula bônus",
      place: { mode: "free", rotate: -8, w: 128, x: 288, y: 34, z: 2 },
      textStyle: { align: "center", paint: { color: "#111111", kind: "solid" }, size: 14, weight: 800 },
      type: "badge"
    },
    {
      children: [
        {
          id: "titulo",
          lines: [
            [{ text: "Comece hoje" }],
            [{ style: { paint: { angle: 90, kind: "linear", stops: [{ at: 0, color: "#a78bfa" }, { at: 100, color: "#22d3ee" }] } }, text: "em 7 passos" }]
          ],
          textStyle: { lineHeight: 1.05, size: 34 },
          type: "heading"
        },
        {
          id: "texto",
          lines: [[{ text: "Um passo por dia, com exercícios curtos e uma aula ao vivo no fim." }]],
          textStyle: { lineHeight: 1.45, paint: { color: "#cbd5e1", kind: "solid" }, size: 17 },
          type: "text"
        },
        {
          children: [
            {
              action: { kind: "cta" },
              box: { fill: [{ color: "#ffffff", kind: "solid" }], padding: [12, 18], radius: 12 },
              id: "botao",
              textStyle: { paint: { color: "#0f172a", kind: "solid" }, size: 16 },
              type: "button"
            },
            {
              action: { kind: "close" },
              box: { border: { color: "#ffffff40", width: 1 }, padding: [11, 16], radius: 12 },
              id: "agoranao",
              label: "Agora não",
              textStyle: { size: 16, weight: 600 },
              type: "button"
            }
          ],
          id: "acoes",
          layout: { align: "center", dir: "row", gap: 8, wrap: true },
          place: { margin: [8, 0, 0, 0], mode: "flow" },
          type: "box"
        }
      ],
      id: "coluna",
      layout: { align: "start", gap: 12 },
      place: { mode: "flow", width: 256 },
      type: "box"
    },
    {
      id: "links",
      place: { margin: [12, 0, 0, 0], mode: "flow" },
      textStyle: { paint: { color: "#a5b4fc", kind: "solid" }, size: 14 },
      type: "links"
    }
  ],
  close: { background: "#00000066" },
  mode: "free",
  version: 1
};

const STARTERS: Record<FreeStarterId, PopupFreeDesignInput> = {
  blank: BLANK,
  cutout_sticker: CUTOUT_STICKER,
  glow_text: GLOW_TEXT,
  video_top_fade: VIDEO_TOP_FADE
};

/** O design do modelo na forma canonica (com o Botão principal; o Vídeo sem arquivo). */
export function freeStarterDesign(id: FreeStarterId): PopupFreeDesign {
  return canonicalPopupFreeDesign(structuredClone(STARTERS[id] ?? BLANK));
}

/** Uma imagem do nosso bucket com as medidas lidas no navegador (o servidor troca pelas do arquivo ao salvar). */
export type FreeMeasuredImage = { height: number; path: string; width: number };

/** Imagem do nosso bucket (o caminho do padrao) com medidas inteiras de 16 a 1.600 px. */
function isMeasuredImage(image: FreeMeasuredImage | null | undefined): image is FreeMeasuredImage {
  const side = FREE_DESIGN_LIMITS.imageSide;

  return Boolean(
    image &&
      FREE_IMAGE_PATH_PATTERN.test(image.path) &&
      Number.isInteger(image.width) &&
      Number.isInteger(image.height) &&
      image.width >= side.min &&
      image.width <= side.max &&
      image.height >= side.min &&
      image.height <= side.max
  );
}

/** Video do nosso bucket (videos/<uuid>.<mp4|webm>) com a extensao do tipo. */
function isOwnVideoFile(video: { mimeType: PopupVideoMimeType; path: string } | null | undefined): video is { mimeType: PopupVideoMimeType; path: string } {
  return Boolean(
    video &&
      (POPUP_VIDEO_MIME_TYPES as readonly string[]).includes(video.mimeType) &&
      POPUP_VIDEO_PATH_PATTERN.test(video.path) &&
      video.path.endsWith(video.mimeType === "video/mp4" ? ".mp4" : ".webm")
  );
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

  if (videoNode && isOwnVideoFile(video)) {
    const assets: FreeAsset[] = [];
    const poster = content.poster;
    const posterOk = isMeasuredImage(poster);

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

/* ------------------------------------------------------------------------------------------------
 * "Usar o design Personalizado" (L1.1; spec §5.3): o Personalizado de agora vira um Livre parecido
 * ---------------------------------------------------------------------------------------------- */

export type FreeFromCustomContent = {
  /** O audio do aviso (com audio, entra o elemento Áudio). */
  audio: unknown;
  /** A imagem do fundo do cartao (caminho e medidas lidas no navegador); sem = o fundo fica so na cor de apoio. */
  cardImage?: FreeMeasuredImage | null;
  /** O botao do aviso; sem botao, cria "Saiba mais" com o destino vazio (como os modelos). */
  cta: FreeStarterContent["cta"];
  /** O aviso tem imagem (mesmo sem medidas): a Imagem da midia entra vazia para a equipe enviar de novo. */
  hasImage?: boolean;
  /** A imagem do aviso no nosso bucket (caminho e medidas lidas no navegador): a Imagem da midia ou a capa do video. */
  image?: FreeMeasuredImage | null;
};

/** As sombras de cada preset do cartao do Personalizado (os mesmos valores do CSS dele). */
const CUSTOM_CARD_SHADOWS: Record<PopupCardShadow, FreeShadow[]> = {
  none: [],
  soft: [{ blur: 40, color: "#00000073", spread: 0, x: 0, y: 12 }],
  strong: [{ blur: 80, color: "#000000b3", spread: 0, x: 0, y: 24 }]
};

/** O X guarda 56 px no canto (o Personalizado afasta o primeiro bloco do X quando o texto comeca no topo). */
const CUSTOM_CLOSE_CLEARANCE = 56;

/** Os X que valem quando o do Personalizado nao contrasta o bastante para a regra do Livre (§9.6 regra 11). */
const SAFE_CLOSES: readonly Pick<FreeClose, "background" | "color">[] = [
  { background: "#00000099", color: "#ffffff" },
  { background: "#ffffffe6", color: "#111111" }
];

function freePaintOf(paint: PopupPaint): FreeTextPaint {
  return paint.kind === "solid"
    ? { color: paint.color, kind: "solid" }
    : { angle: paint.angle, kind: "linear", stops: [{ at: 0, color: paint.from }, { at: 100, color: paint.to }] };
}

function flexAlignOf(align: PopupAlign): "center" | "end" | "start" {
  return align === "left" ? "start" : align === "right" ? "end" : "center";
}

function alphaHexOf(fraction: number) {
  return Math.round(Math.min(1, Math.max(0, fraction)) * 255)
    .toString(16)
    .padStart(2, "0");
}

/**
 * A cor de apoio "clareada" para, debaixo do escuro da imagem (que no Livre cobre o cartao inteiro), aparecer como
 * no Personalizado (onde o escuro fica so sobre a imagem). Canal acima de 255 fica em 255.
 */
function undimmed(color: string, dim: number): string {
  const keep = 1 - dim / 100;

  if (keep <= 0) {
    return color;
  }

  const channel = (start: number) =>
    Math.min(255, Math.round(parseInt(color.slice(start, start + 2), 16) / keep))
      .toString(16)
      .padStart(2, "0");

  return `#${channel(1)}${channel(3)}${channel(5)}${color.slice(7)}`;
}

function textStyleOf(style: PopupTextStyle, zone: PopupAlign): FreeTextStyle {
  return {
    align: style.align === "inherit" ? zone : style.align,
    font: style.font,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    paint: freePaintOf(style.paint),
    size: style.size,
    uppercase: style.uppercase,
    weight: style.weight
  };
}

/** O botao do Personalizado: a mesma altura (respiro de cima e de baixo), o respiro dos lados, a fonte e o brilho. */
function buttonPartsOf(style: PopupButtonStyle): Pick<FreeButtonNode, "box" | "place" | "textStyle"> {
  const metrics = POPUP_BUTTON_METRICS[style.size];
  const border = style.border.width > 0 ? style.border.width : 0;
  const box: FreeBox = {
    fill: [freePaintOf(style.background)],
    padding: [Math.max(0, Math.round((metrics.height - 2 * border - metrics.fontSize * 1.2) / 2)), metrics.paddingX],
    radius: style.radius
  };

  if (border > 0) {
    box.border = { color: style.border.color, width: border };
  }

  if (style.glow) {
    box.shadows = [{ blur: 24, color: style.glow, spread: 0, x: 0, y: 0 }];
  }

  return {
    box,
    ...(style.width === "full" ? { place: { mode: "flow" as const, width: "fill" as const } } : {}),
    textStyle: {
      font: style.font,
      letterSpacing: style.letterSpacing,
      paint: { color: style.textColor, kind: "solid" },
      size: metrics.fontSize,
      uppercase: style.uppercase,
      weight: style.weight
    }
  };
}

/**
 * O comeco de `text` com ate `max` letras (pontos de codigo, como a conta do schema) e ate `units` unidades UTF-16
 * (o `max` do zod nos textos curtos). Nunca parte um emoji ao meio: a metade solta passa no zod, mas o jsonb do
 * banco recusa o texto e o salvar daria erro.
 */
function cutText(text: string, max: number, units = Number.POSITIVE_INFINITY): string {
  let kept = "";
  let count = 0;

  for (const letter of text) {
    if (count >= max || kept.length + letter.length > units) {
      break;
    }

    kept += letter;
    count += 1;
  }

  return kept;
}

type FreeSidesValue = number | [number, number] | [number, number, number, number];

/** Lados em quatro valores [cima, direita, baixo, esquerda]. */
function fourSidesOf(sides: FreeSidesValue | undefined): [number, number, number, number] {
  if (sides === undefined || typeof sides === "number") {
    const value = sides ?? 0;

    return [value, value, value, value];
  }

  return sides.length === 2 ? [sides[0], sides[1], sides[0], sides[1]] : [sides[0], sides[1], sides[2], sides[3]];
}

/** O elemento na sequencia com `extra` px a mais na margem de cima (o resto do alinhamento e da margem fica). */
function withTopMargin(node: FreeNode, extra: number): FreeNode {
  const flow = node.place?.mode === "flow" ? node.place : { mode: "flow" as const };
  const [top, right, bottom, left] = fourSidesOf(flow.margin);

  return { ...node, place: { ...flow, margin: [top + extra, right, bottom, left] } } as FreeNode;
}

/** Linhas de texto que valem no Livre (cada uma com uma letra que nao e espaco), no maximo `max`. */
function textLines(lines: readonly string[], max: number): string[] {
  const kept = lines.filter((line) => line.trim().length > 0);

  return kept.length <= max ? kept : [...kept.slice(0, max - 1), kept.slice(max - 1).join(" ")];
}

/**
 * Um Livre parecido com o Personalizado de agora (spec §5.3; "parecido, nao identico": o produtor ajusta). O
 * cartao vira a prancheta (largura P/M/G, fundo em camadas, borda, cantos, sombra do preset, respiro); a imagem do
 * fundo vira `[escuro, imagem, cor de apoio]` (a imagem cabendo na largura, presa em cima, no meio ou embaixo); a
 * midia vira um Vídeo ou uma Imagem solta no topo (0, 0, W, W x proporcao), com o esmaecer de (fim - comprimento) a
 * fim quando o degrade e "Igual ao fundo do cartão" ou uma Forma Degradê por cima na cor escolhida; "Abaixo da
 * mídia" com subir vira o respiro de cima (ate 200; o resto, a margem de cima do primeiro elemento na sequencia);
 * "Sobre a mídia" vira a altura minima da midia com o texto em cima, no
 * meio ou embaixo; os blocos viram elementos na mesma ordem (selo, titulo com uma parte por linha, texto com uma
 * linha por quebra, Botão principal, segundo botao, Áudio, Espaço), o alinhamento do grupo vira o da prancheta e o
 * espaco entre blocos o `gap`; o X e os links ("Não mostrar de novo" opcional) seguem. Video, capa, fontes e textos
 * sao reaproveitados (so caminhos do nosso Storage). Devolve o mesmo formato de applyFreeStarter.
 */
export function freeFromCustomDesign(
  custom: PopupDesign,
  content: FreeFromCustomContent
): { cta: NonNullable<FreeStarterContent["cta"]>; design: PopupFreeDesign } {
  const cta = content.cta ?? { ...FREE_STARTER_CTA };
  const width = POPUP_CARD_WIDTHS[custom.card.width] ?? POPUP_CARD_WIDTHS.M;
  const zone = custom.text.align;
  const padding = custom.card.padding;
  const children: FreeNode[] = [];
  const assets: FreeAsset[] = [];
  const taken = new Set<string>(["links"]);
  const take = (prefix: string) => {
    let id = prefix;
    let index = 2;

    while (taken.has(id)) {
      id = `${prefix}${index}`;
      index += 1;
    }

    taken.add(id);

    return id;
  };
  // O teto de 1.200 letras do Livre, contado como o schema conta (pontos de codigo, nunca meio emoji).
  let letters: number = FREE_DESIGN_LIMITS.textTotal;
  const spend = (text: string) => {
    const kept = cutText(text, Math.max(0, letters));

    letters -= [...kept].length;

    return kept;
  };

  // Midia: Vídeo (o do Personalizado, a imagem do aviso de capa) ou Imagem (a do aviso), solta no topo.
  const image = isMeasuredImage(content.image) ? content.image : null;
  const video = custom.media.kind === "video" && isOwnVideoFile(custom.media.video) ? custom.media.video : null;
  const hasMedia = custom.media.kind === "video" || (custom.media.kind === "image" && (image !== null || Boolean(content.hasImage)));
  const mediaHeight = hasMedia ? Math.round(width * POPUP_MEDIA_RATIOS[custom.media.aspect]) : 0;
  const over = hasMedia && custom.text.placement !== "below";

  if (hasMedia) {
    const place: FreeAbsolutePlace = { h: mediaHeight, mode: "free", w: width, x: 0, y: 0, ...(over ? { z: -1 } : {}) };
    const focus: [number, number] = [50, custom.media.position === "top" ? 0 : custom.media.position === "bottom" ? 100 : 50];
    const fade = custom.media.fade;
    const span = popupFadeSpan(fade);
    const box: FreeBox | undefined = fade.enabled && fade.color === "auto" ? { fade: { end: span.end, side: "bottom", start: span.start } } : undefined;

    if (image) {
      assets.push({ height: image.height, id: "capa", kind: "image", path: image.path, width: image.width });
    }

    if (custom.media.kind === "video") {
      if (video) {
        assets.push({ id: "video", kind: "video", mimeType: video.mimeType, path: video.path, ...(image ? { poster: "capa" } : {}) });
      }

      children.push({ asset: video ? "video" : null, box, focus, id: take("midia"), name: "Vídeo do topo", place, type: "video" });
    } else {
      children.push({ asset: image ? "capa" : null, box, focus, id: take("midia"), name: "Imagem do topo", place, type: "image" });
    }

    // Outra cor: uma Forma Degradê do tamanho da midia, por cima dela (as mesmas paradas suavizadas do Personalizado).
    if (fade.enabled && fade.color !== "auto") {
      const color = fade.color.slice(0, 7);
      const length = span.end - span.start;

      children.push({
        box: {
          fill: [
            {
              kind: "linear",
              stops: [
                { at: span.start, color: `${color}00` },
                { at: Math.round(span.start + 0.45 * length), color: `${color}59` },
                { at: Math.round(span.start + 0.75 * length), color: `${color}bf` },
                { at: span.end, color }
              ]
            }
          ]
        },
        id: take("degrade"),
        name: "Degradê",
        place: { ...place },
        type: "shape"
      });
    }
  }

  // Blocos, na mesma ordem.
  let headings = 0;
  let firstBlock = true;
  const clearance = !hasMedia || custom.text.placement === "over-top" ? Math.max(0, CUSTOM_CLOSE_CLEARANCE - padding) : 0;

  for (const block of custom.blocks) {
    let node: FreeNode | null = null;

    switch (block.type) {
      case "badge": {
        const label = spend(cutText(block.text.trim(), FREE_DESIGN_LIMITS.label, FREE_DESIGN_LIMITS.label));
        const align = flexAlignOf(block.style.align === "inherit" ? zone : block.style.align);
        // O texto do selo fica centralizado na pilula (como no Personalizado); o alinhamento vale para o selo.
        const style = textStyleOf(block.style, zone);
        delete style.align;

        if (label.trim()) {
          node = {
            box: {
              fill: [freePaintOf(block.background)],
              padding: [POPUP_BADGE_PADDING.y, POPUP_BADGE_PADDING.x],
              radius: block.radius,
              ...(block.border.width > 0 ? { border: { color: block.border.color, width: block.border.width } } : {})
            },
            id: take("selo"),
            label,
            ...(align !== flexAlignOf(zone) ? { place: { align, mode: "flow" as const } } : {}),
            textStyle: style,
            type: "badge"
          };
        }
        break;
      }
      case "heading": {
        const lines = block.lines
          .filter((line) => line.text.trim())
          .slice(0, FREE_DESIGN_LIMITS.headingLines)
          .map((line) => {
            const text = spend(line.text.trim());
            const style = { ...(line.paint ? { paint: freePaintOf(line.paint) } : {}), ...(line.size !== null ? { size: line.size } : {}) };

            return text.trim() ? [{ ...(Object.keys(style).length > 0 ? { style } : {}), text }] : null;
          })
          .filter((line) => line !== null);

        if (lines.length > 0) {
          // O Livre aceita ate 4 titulos: os seguintes viram Texto com o mesmo estilo.
          const asHeading = headings < FREE_DESIGN_LIMITS.headings;

          headings += asHeading ? 1 : 0;
          node = { id: take(asHeading ? "titulo" : "texto"), lines, textStyle: textStyleOf(block.style, zone), type: asHeading ? "heading" : "text" };
        }
        break;
      }
      case "text": {
        const lines = textLines(block.text.split("\n"), FREE_DESIGN_LIMITS.textLines)
          .map((line) => spend(line.trim()))
          .filter((line) => line.trim())
          .map((text) => [{ text }]);

        if (lines.length > 0) {
          node = { id: take("texto"), lines, textStyle: textStyleOf(block.style, zone), type: "text" };
        }
        break;
      }
      case "button": {
        node = { action: { kind: "cta" }, id: take("botao"), type: "button", ...buttonPartsOf(block.style) };
        break;
      }
      case "button2": {
        const label = spend(cutText(block.label.trim(), FREE_DESIGN_LIMITS.label, FREE_DESIGN_LIMITS.label));
        const action = block.action.kind === "link" ? { href: block.action.href, kind: "link" as const, target: block.action.target } : { kind: block.action.kind };

        if (label.trim()) {
          node = { action, id: take("botao"), label, type: "button", ...buttonPartsOf(block.style) };
        }
        break;
      }
      case "audio":
        node = { id: take("audio"), type: "audio" };
        break;
      case "spacer":
        node = { id: take("espaco"), size: block.height, type: "spacer" };
        break;
    }

    if (!node) {
      continue;
    }

    if (firstBlock && clearance > 0) {
      const flow = node.place?.mode === "flow" ? node.place : { mode: "flow" as const };

      node = { ...node, place: { ...flow, margin: zone === "center" ? [0, clearance, 0, clearance] : [0, clearance, 0, 0] } } as FreeNode;
    }

    firstBlock = false;
    children.push(node);
  }

  // Links: a cor e o "Não mostrar de novo" do Personalizado; o texto do link a mesma distancia do ultimo bloco.
  const showDismiss = custom.links.showDismiss !== false;
  const linksGap = Math.max(0, 18 - custom.text.gap);

  children.push({
    ...(showDismiss ? {} : { dismiss: false }),
    id: "links",
    ...(linksGap > 0 ? { place: { margin: [linksGap, 0, 0, 0], mode: "flow" as const } } : {}),
    textStyle: { align: zone, paint: { color: custom.links.color, kind: "solid" } },
    type: "links"
  });

  // Prancheta: o fundo (cor, degrade ou a imagem do fundo cabendo na largura), borda, cantos, sombra e respiro.
  const background = custom.card.background;
  let fill: FreeFillPaint[];

  if (background.kind === "image") {
    const cardImage = isMeasuredImage(content.cardImage) ? content.cardImage : null;

    if (cardImage) {
      // A mesma imagem da midia (mesmo caminho) e um arquivo so.
      const same = assets.find((asset) => asset.kind === "image" && asset.path === cardImage.path);
      const id = same ? same.id : "fundo";
      const layers: FreeFillPaint[] = [];

      if (!same) {
        assets.push({ height: cardImage.height, id, kind: "image", path: cardImage.path, width: cardImage.width });
      }

      if (background.dim > 0) {
        layers.push({ color: `#000000${alphaHexOf(background.dim / 100)}`, kind: "solid" });
      }

      layers.push({ asset: id, fit: "contain", focus: [50, background.position === "top" ? 0 : background.position === "bottom" ? 100 : 50], kind: "image" });
      layers.push({ color: background.dim > 0 ? undimmed(background.color, background.dim) : background.color, kind: "solid" });
      fill = layers;
    } else {
      fill = [{ color: background.color, kind: "solid" }];
    }
  } else {
    fill = [freePaintOf(background)];
  }

  // "Abaixo da midia": o texto comeca onde o Personalizado o poe, na altura exata da midia (largura x proporcao)
  // menos o quanto ele sobe, mais o respiro. O respiro de cima vai ate o teto do Livre (200); o que passa (ate 368:
  // midia 1:1 de 520 sem subir + 48) vira margem de cima do primeiro elemento na sequencia (ate 400), no mesmo y.
  const exactMediaHeight = width * POPUP_MEDIA_RATIOS[custom.media.aspect];
  const top = over || !hasMedia ? padding : Math.round(exactMediaHeight * (1 - custom.text.overlap / 100) + padding);
  const topPadding = Math.min(top, FREE_DESIGN_LIMITS.padding.max);

  if (top > topPadding) {
    const first = children.findIndex((node) => node.place?.mode !== "free");

    children[first] = withTopMargin(children[first], top - topPadding);
  }

  const artboard: NonNullable<PopupFreeDesign["artboard"]> = {
    align: flexAlignOf(zone),
    fill,
    gap: custom.text.gap,
    justify: !over ? "start" : custom.text.placement === "over-top" ? "start" : custom.text.placement === "over-middle" ? "center" : "end",
    minHeight: over ? mediaHeight : 0,
    padding: [topPadding, padding, showDismiss ? Math.round(padding / 2) + 14 : padding, padding],
    radius: custom.card.radius,
    width
  };

  if (custom.card.border.width > 0) {
    artboard.border = { color: custom.card.border.color, width: custom.card.border.width };
  }

  if (CUSTOM_CARD_SHADOWS[custom.card.shadow].length > 0) {
    artboard.shadows = CUSTOM_CARD_SHADOWS[custom.card.shadow].map((shadow) => ({ ...shadow }));
  }

  // O X: o do Personalizado, ou o primeiro que fica bem visivel no Livre (a regra do X vale no salvar).
  let close: Partial<FreeClose> = { background: custom.close.background, color: custom.close.color };

  for (const candidate of SAFE_CLOSES) {
    if (!freeCloseVisibilityProblem({ artboard, close })) {
      break;
    }

    close = { ...candidate };
  }

  const design = canonicalPopupFreeDesign({ artboard, assets, children, close, mode: "free", version: 1 });

  return { cta, design: syncFreeDesignWithContent(design, { hasAudio: Boolean(content.audio), hasCta: true }) };
}
