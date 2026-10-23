// Design Livre do pop-up (docs/27): as dicas do painel Revisar (nao impedem salvar) e o medidor de tamanho.
// Puras: recebem o design e, quando precisam de geometria, os retangulos medidos no palco do editor (px da
// prancheta, mais a prancheta inteira em "@artboard"). Sem retangulos, as dicas de geometria nao aparecem.
// So o editor usa (o cartao do aluno nunca importa este arquivo).

import { contrastHintMessage, contrastRatio, isLargeText, type HexColor } from "./popup-design-model";
import {
  canonicalPopupFreeDesign,
  FREE_DESIGN_LIMITS,
  jsonbBytesUpperBound,
  type FreeFillPaint,
  type FreeId,
  type FreeNode,
  type FreeTextPaint,
  type PopupFreeDesign
} from "./popup-free-model";
import { FREE_MIN_FONT_PX, freeHeadingText, freeTextStyleOf, resolveFreeArtboard } from "./popup-free-render";

export type FreeHint = {
  /** Mesmo formato das chaves de erro, sem "freeDesign.". */
  key: string;
  kind: "contrast" | "cover" | "cut" | "font-device" | "no-poster" | "phone-scroll" | "phone-text" | "reading-order" | "small-text";
  message: string;
  nodeId: FreeId | null;
};

/** `"@artboard"` = a prancheta inteira (a altura medida). */
export type FreeMeasuredRects = Readonly<Record<FreeId | "@artboard", { h: number; w: number; x: number; y: number }>>;

type Rect = { h: number; w: number; x: number; y: number };

/** Largura do cartao num celular de 375 px (a previa Celular e o aluno tipico). */
export const FREE_PHONE_CARD_PX = 343;

export const POPUP_FREE_HINT_MESSAGES = {
  cover: (name: string, button: string) => `“${name}” está por cima do “${button}” e pode atrapalhar o clique.`,
  cut: (name: string) => `“${name}” está cortado no fim do pop-up.`,
  fontDevice: "Esta fonte muda de aparelho para aparelho. Para ficar igual para todos, envie a fonte.",
  noPoster: "Sem capa: quem prefere menos movimento não vê o vídeo.",
  phoneScroll: "No celular, o aluno precisa rolar para ver tudo, e o X sobe junto.",
  phoneText: (count: number) =>
    `No celular, ${count} ${count === 1 ? "texto fica" : "textos ficam"} um pouco ${count === 1 ? "maior" : "maiores"} que no desenho (mínimo de 12 px para ler bem).`,
  readingOrder: (after: string, before: string) => `O leitor de tela lê “${after}” depois de “${before}”, mas na tela ele aparece antes. Mude a ordem nas Camadas.`,
  smallText: "Texto abaixo de 12 px fica difícil de ler."
} as const;

/** Nome de cada tipo (Camadas, Revisar). */
export const FREE_NODE_TYPE_LABELS: Record<FreeNode["type"], string> = {
  audio: "Áudio",
  badge: "Selo",
  box: "Caixa",
  button: "Botão",
  divider: "Linha",
  heading: "Título",
  icon: "Ícone",
  image: "Imagem",
  links: "Links",
  shape: "Forma",
  spacer: "Espaço",
  text: "Texto",
  video: "Vídeo"
};

function short(text: string, max = 40) {
  const flat = text.replace(/\s+/g, " ").trim();

  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** O que a dica mostra de um elemento: o texto dele (titulo, texto, selo, botao), o nome na camada ou o tipo. */
export function freeNodeDisplayName(node: FreeNode): string {
  if (node.type === "heading" || node.type === "text") {
    const text = short(freeHeadingText(node));

    if (text) {
      return text;
    }
  }

  if (node.type === "badge" && node.label.trim()) {
    return short(node.label);
  }

  if (node.type === "button") {
    if (node.action.kind === "cta") {
      return node.name?.trim() || "Botão principal";
    }

    if (node.label?.trim()) {
      return short(node.label);
    }
  }

  return node.name?.trim() || FREE_NODE_TYPE_LABELS[node.type];
}

const BUILTIN_FONTS_THAT_CHANGE = new Set(["condensed", "mono", "serif"]);

function paintColors(paint: FreeTextPaint | FreeFillPaint): HexColor[] | null {
  if (paint.kind === "solid") {
    return [paint.color];
  }

  if (paint.kind === "linear" || paint.kind === "radial") {
    return paint.stops.map((stop) => stop.color);
  }

  return null;
}

/** Cores de um fundo (todas as camadas); null = tem imagem (nao da para medir); [] = sem fundo. */
function fillColors(fill: readonly FreeFillPaint[] | undefined): HexColor[] | null {
  const colors: HexColor[] = [];

  for (const paint of fill ?? []) {
    const own = paintColors(paint);

    if (!own) {
      return null;
    }

    colors.push(...own);
  }

  return colors;
}

/** A cor de base de um fundo: a camada de baixo (solida = a cor; degrade = a primeira parada). */
function fillBase(fill: readonly FreeFillPaint[]): HexColor | null {
  const bottom = fill[fill.length - 1];

  if (!bottom) {
    return null;
  }

  return bottom.kind === "solid" ? bottom.color : bottom.kind === "image" ? null : ([...bottom.stops].sort((a, b) => a.at - b.at)[0]?.color ?? null);
}

function worstRatio(foregrounds: readonly HexColor[], backgrounds: readonly HexColor[], base: HexColor) {
  let worst = 21;

  for (const front of foregrounds) {
    for (const back of backgrounds) {
      worst = Math.min(worst, contrastRatio(front, back, base));
    }
  }

  return worst;
}

function overlapArea(left: Rect, right: Rect) {
  const width = Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x);
  const height = Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y);

  return width > 0 && height > 0 ? width * height : 0;
}

type Visible = { ancestors: FreeFillPaint[][]; node: FreeNode; order: number };

/** Os elementos que o aluno ve, na ordem do DOM, com os fundos das caixas de fora (a mais perto primeiro). */
function visibleNodes(design: Pick<PopupFreeDesign, "children">): Visible[] {
  const out: Visible[] = [];
  const walk = (nodes: readonly FreeNode[], ancestors: FreeFillPaint[][]) => {
    for (const node of nodes) {
      if (node.hidden) {
        continue;
      }

      out.push({ ancestors, node, order: out.length });

      if (node.type === "box") {
        walk(node.children, node.box?.fill && node.box.fill.length > 0 ? [node.box.fill, ...ancestors] : ancestors);
      }
    }
  };

  walk(design.children, []);

  return out;
}

const TEXT_TYPES = new Set<FreeNode["type"]>(["badge", "button", "heading", "links", "text"]);

/**
 * As dicas do Revisar: contraste (quando da para saber o fundo), texto pequeno, texto que muda no celular,
 * ordem de leitura, texto por cima de botao, solto cortado no fim, pop-up alto no celular, fonte que muda de
 * aparelho e video sem capa. Cada uma leva ao elemento (nodeId) e ao campo (key).
 */
export function popupFreeHints(design: PopupFreeDesign, input: { rects?: FreeMeasuredRects } = {}): FreeHint[] {
  const hints: FreeHint[] = [];
  const rects = input.rects;
  const artboard = resolveFreeArtboard(design);
  const width = artboard.width;
  const visible = visibleNodes(design);
  const media = visible.filter(({ node }) => node.type === "image" || node.type === "video");
  const add = (hint: FreeHint) => hints.push(hint);
  let phoneTexts = 0;
  let phoneFirst: FreeNode | null = null;

  for (const { ancestors, node } of visible) {
    if (!TEXT_TYPES.has(node.type)) {
      continue;
    }

    const style = freeTextStyleOf(node);
    const prefix = `nodes.${node.id}`;

    // Contraste: contra o proprio fundo (selo, botao), as caixas de fora e a prancheta; imagem ou video atras = nao mede.
    const chain = [node.box?.fill ?? [], ...ancestors, artboard.fill].filter((fill) => fill.length > 0);
    const closest = chain[0];
    const backgrounds = closest ? fillColors(closest) : null;
    const behindMedia = rects?.[node.id] ? media.some((item) => rects[item.node.id] && overlapArea(rects[item.node.id], rects[node.id]) > 0) : false;

    if (backgrounds && backgrounds.length > 0 && !behindMedia) {
      const base = chain.slice(1).map(fillBase).find((color): color is HexColor => Boolean(color)) ?? "#000000";
      const check = (paint: FreeTextPaint, size: number, weight: number, key: string) => {
        const colors = paintColors(paint);

        if (!colors) {
          return;
        }

        const required = isLargeText(size, weight) ? 3 : 4.5;
        const ratio = worstRatio(colors, backgrounds, base);

        if (ratio < required) {
          add({ key, kind: "contrast", message: contrastHintMessage(ratio, required), nodeId: node.id });
        }
      };

      check(style.paint, style.size, style.weight, `${prefix}.textStyle.paint`);

      if (node.type === "heading" || node.type === "text") {
        node.lines.forEach((line, lineIndex) =>
          line.forEach((span, spanIndex) => {
            if (span.style?.paint) {
              check(span.style.paint, span.style.size ?? style.size, span.style.weight ?? style.weight, `${prefix}.lines.${lineIndex}.${spanIndex}.style.paint`);
            }
          })
        );
      }
    }

    // Tamanhos: o do elemento e o das partes.
    const sizes: { key: string; size: number }[] = [{ key: `${prefix}.textStyle.size`, size: style.size }];

    if (node.type === "heading" || node.type === "text") {
      node.lines.forEach((line, lineIndex) =>
        line.forEach((span, spanIndex) => {
          if (span.style?.size !== undefined) {
            sizes.push({ key: `${prefix}.lines.${lineIndex}.${spanIndex}.style.size`, size: span.style.size });
          }
        })
      );
    }

    const small = sizes.find((item) => item.size < FREE_MIN_FONT_PX);

    if (small) {
      add({ key: small.key, kind: "small-text", message: POPUP_FREE_HINT_MESSAGES.smallText, nodeId: node.id });
    }

    if (sizes.some((item) => (item.size * FREE_PHONE_CARD_PX) / width < 11.5)) {
      phoneTexts += 1;
      phoneFirst ??= node;
    }

    // Fonte pronta que muda de aparelho (Condensada, Serifada, Monoespacada).
    const fonts: { font: typeof style.font; key: string }[] = [{ font: style.font, key: `${prefix}.textStyle.font` }];

    if (node.type === "heading" || node.type === "text") {
      node.lines.forEach((line, lineIndex) =>
        line.forEach((span, spanIndex) => {
          if (span.style?.font) {
            fonts.push({ font: span.style.font, key: `${prefix}.lines.${lineIndex}.${spanIndex}.style.font` });
          }
        })
      );
    }

    const changing = fonts.find(({ font }) => font.kind === "builtin" && BUILTIN_FONTS_THAT_CHANGE.has(font.key));

    if (changing) {
      add({ key: changing.key, kind: "font-device", message: POPUP_FREE_HINT_MESSAGES.fontDevice, nodeId: node.id });
    }
  }

  if (phoneFirst && phoneTexts > 0) {
    add({ key: `nodes.${phoneFirst.id}.textStyle.size`, kind: "phone-text", message: POPUP_FREE_HINT_MESSAGES.phoneText(phoneTexts), nodeId: phoneFirst.id });
  }

  // Video com arquivo e sem capa.
  for (const { node } of visible) {
    if (node.type === "video" && node.asset) {
      const file = design.assets.find((item) => item.id === node.asset);

      if (file?.kind === "video" && !file.poster) {
        add({ key: `nodes.${node.id}.asset`, kind: "no-poster", message: POPUP_FREE_HINT_MESSAGES.noPoster, nodeId: node.id });
      }
    }
  }

  if (!rects) {
    return hints;
  }

  // Ordem de leitura: entre elementos com texto seguidos, o de depois mais de 8 px acima do de antes.
  const readable = visible.filter(({ node }) => (node.type === "heading" || node.type === "text" || node.type === "badge" || node.type === "button") && rects[node.id]);

  for (let index = 1; index < readable.length; index += 1) {
    const before = readable[index - 1].node;
    const after = readable[index].node;

    if (rects[after.id].y < rects[before.id].y - 8) {
      add({
        key: `nodes.${after.id}`,
        kind: "reading-order",
        message: POPUP_FREE_HINT_MESSAGES.readingOrder(freeNodeDisplayName(after), freeNodeDisplayName(before)),
        nodeId: after.id
      });
    }
  }

  // Texto (que recebe clique) por cima de botao ou dos Links, cobrindo 30 % ou mais.
  const layerOf = (item: Visible) => item.node.place?.z ?? 0;
  const above = (top: Visible, bottom: Visible) => layerOf(top) > layerOf(bottom) || (layerOf(top) === layerOf(bottom) && top.order > bottom.order);
  const targets = visible.filter(({ node }) => (node.type === "button" || node.type === "links") && rects[node.id]);

  for (const item of visible) {
    if ((item.node.type !== "heading" && item.node.type !== "text" && item.node.type !== "badge") || !rects[item.node.id]) {
      continue;
    }

    const covered = targets.find((target) => {
      const area = rects[target.node.id].w * rects[target.node.id].h;

      return area > 0 && above(item, target) && overlapArea(rects[item.node.id], rects[target.node.id]) / area >= 0.3;
    });

    if (covered) {
      add({
        key: `nodes.${item.node.id}.place`,
        kind: "cover",
        message: POPUP_FREE_HINT_MESSAGES.cover(freeNodeDisplayName(item.node), freeNodeDisplayName(covered.node)),
        nodeId: item.node.id
      });
    }
  }

  // Solto sem altura que passa do fim da prancheta medida.
  const board = rects["@artboard"];

  if (board) {
    for (const { node } of visible) {
      if (node.place?.mode === "free" && node.place.h === undefined && rects[node.id] && rects[node.id].y + rects[node.id].h > board.h + 0.5) {
        add({ key: `nodes.${node.id}.place.h`, kind: "cut", message: POPUP_FREE_HINT_MESSAGES.cut(freeNodeDisplayName(node)), nodeId: node.id });
      }
    }

    if ((board.h * FREE_PHONE_CARD_PX) / width > 600) {
      add({ key: "artboard.minHeight", kind: "phone-scroll", message: POPUP_FREE_HINT_MESSAGES.phoneScroll, nodeId: null });
    }
  }

  return hints;
}

/** O medidor do topo do Revisar (0 a 100+, inteiro): a estimativa do jsonb sobre o teto de 30.000. */
export function freeDesignSizePercent(design: PopupFreeDesign): number {
  return Math.round((jsonbBytesUpperBound(canonicalPopupFreeDesign(design)) / FREE_DESIGN_LIMITS.jsonbBytes) * 100);
}

/** "Tamanho do design: 17 % do máximo." */
export function freeDesignSizeLabel(percent: number): string {
  return `Tamanho do design: ${percent} % do máximo.`;
}
