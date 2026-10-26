// Design Livre do pop-up (docs/27): as dicas do painel Revisar (nao impedem salvar) e o medidor de tamanho.
// Puras: recebem o design e, quando precisam de geometria, os retangulos medidos no palco do editor (px da
// prancheta, mais a prancheta inteira em "@artboard"). Sem retangulos, as dicas de geometria nao aparecem.
// O contraste conta o contorno de 2 px ou mais e mede a parte com marca-texto contra ele (L6b).
// So o editor usa (o cartao do aluno nunca importa este arquivo).

import { contrastHintMessage, contrastRatio, isLargeText, type HexColor, type PopupFontRef } from "./popup-design-model";
import {
  canonicalPopupFreeDesign,
  FREE_DESIGN_LIMITS,
  freeMobileNodeOf,
  jsonbBytesUpperBound,
  type FreeBox,
  type FreeBoxLayout,
  type FreeFillPaint,
  type FreeId,
  type FreeLine,
  type FreeMark,
  type FreeNode,
  type FreeSides,
  type FreeTextPaint,
  type FreeTextStroke,
  type PopupFreeDesign
} from "./popup-free-model";
import {
  FREE_MIN_FONT_PX,
  freeHasSnoozeButton,
  freeHeadingText,
  freeTextStyleOf,
  resolveFreeArtboard,
  resolveFreeForDevice,
  type FreeResolvedTextStyle
} from "./popup-free-render";

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
  /** O ícone do Selo e do Botão desenha com a cor da letra; o contorno não chega nele (L6b, crítica C22). */
  iconHidden: "O ícone usa a cor da letra, não a do contorno, e fica difícil de ver. Use uma cor que apareça ou tire o ícone.",
  noPoster: "Sem capa: quem prefere menos movimento não vê o vídeo.",
  phoneScroll: "No celular, o aluno precisa rolar para ver tudo, e o X sobe junto.",
  phoneText: "No celular, este texto ocupa mais linhas que no desenho (o texto não fica abaixo de 12 px). Use letra maior ou dê mais largura.",
  phoneTextCut: "No celular, o texto deste botão fica cortado (o texto não fica abaixo de 12 px). Use letra maior ou dê mais largura.",
  phoneTextRow: "No celular, os elementos desta linha não cabem lado a lado (o texto não fica abaixo de 12 px). Use letra maior ou dê mais largura.",
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

/** Um fundo para medir o contraste: a cor de tras e a cor embaixo dela (com transparencia, ela vai por cima). */
type Backdrop = { color: HexColor; under: HexColor };

function rgbaOf(color: HexColor) {
  const hex = color.slice(1);

  return {
    a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    b: parseInt(hex.slice(4, 6), 16),
    g: parseInt(hex.slice(2, 4), 16),
    r: parseInt(hex.slice(0, 2), 16)
  };
}

/** `top` por cima de `bottom` (que fica sobre o preto do veu), sem transparencia: "#rrggbb". */
function flatten(top: HexColor, bottom: HexColor): HexColor {
  const front = rgbaOf(top);
  const back = rgbaOf(bottom);
  const channel = (upper: number, lower: number) =>
    Math.round(upper * front.a + lower * back.a * (1 - front.a))
      .toString(16)
      .padStart(2, "0");

  return `#${channel(front.r, back.r)}${channel(front.g, back.g)}${channel(front.b, back.b)}`;
}

/**
 * O contraste de uma letra: em cada fundo, a pior cor da pintura; com contorno de 2 px ou mais, o melhor entre a letra
 * e o contorno (o texto vazado se le pelo contorno; com 1 px, so a cor conta). O pior entre os fundos.
 */
function letterRatio(colors: readonly HexColor[], stroke: FreeTextStroke | undefined, backdrops: readonly Backdrop[]) {
  let worst = 21;

  for (const back of backdrops) {
    let ratio = Math.min(...colors.map((front) => contrastRatio(front, back.color, back.under)));

    if (stroke && stroke.width >= 2) {
      ratio = Math.max(ratio, contrastRatio(stroke.color, back.color, back.under));
    }

    worst = Math.min(worst, ratio);
  }

  return worst;
}

/**
 * O fundo de uma parte com marca-texto: a cor dele; com transparencia, por cima de cada cor do fundo de fora. null =
 * nao da para medir (marca-texto transparente sobre imagem, video ou sem fundo medido).
 */
function markBackdrops(mark: FreeMark, outside: readonly Backdrop[] | null): Backdrop[] | null {
  if (mark.color.length === 7 || mark.color.slice(7).toLowerCase() === "ff") {
    return [{ color: mark.color, under: "#000000" }];
  }

  return outside ? outside.map((back) => ({ color: mark.color, under: flatten(back.color, back.under) })) : null;
}

/** A cor que o icone do Selo e do Botao usa: a da letra (degrade = a primeira parada), como no cartao. */
function iconColor(paint: FreeTextPaint): HexColor {
  return paint.kind === "solid" ? paint.color : ([...paint.stops].sort((a, b) => a.at - b.at)[0]?.color ?? "#ffffff");
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
export function popupFreeHints(design: PopupFreeDesign, input: { content?: FreePhoneTextContent; rects?: FreeMeasuredRects } = {}): FreeHint[] {
  const hints: FreeHint[] = [];
  const rects = input.rects;
  const artboard = resolveFreeArtboard(design);
  const width = artboard.width;
  const visible = visibleNodes(design);
  const media = visible.filter(({ node }) => node.type === "image" || node.type === "video");
  const add = (hint: FreeHint) => hints.push(hint);

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

    const base = chain.slice(1).map(fillBase).find((color): color is HexColor => Boolean(color)) ?? "#000000";
    const outside: Backdrop[] | null = backgrounds && backgrounds.length > 0 && !behindMedia ? backgrounds.map((color) => ({ color, under: base })) : null;
    const measure = (paint: FreeTextPaint, stroke: FreeTextStroke | undefined, size: number, weight: number, backdrops: readonly Backdrop[]) => {
      const colors = paintColors(paint);

      return colors ? { ratio: letterRatio(colors, stroke, backdrops), required: isLargeText(size, weight) ? 3 : 4.5 } : null;
    };
    const report = (result: ReturnType<typeof measure>, key: string) => {
      if (result && result.ratio < result.required) {
        add({ key, kind: "contrast", message: contrastHintMessage(result.ratio, result.required), nodeId: node.id });
      }
    };
    const element = outside ? measure(style.paint, style.stroke, style.size, style.weight, outside) : null;

    report(element, `${prefix}.textStyle.paint`);

    // O icone do Selo e do Botao desenha com a cor da letra, nunca com o contorno: com a letra vazada ele some.
    if (outside && element && element.ratio >= element.required && (node.type === "badge" || node.type === "button") && node.icon && letterRatio([iconColor(style.paint)], undefined, outside) < 3) {
      add({ key: `${prefix}.textStyle.paint`, kind: "contrast", message: POPUP_FREE_HINT_MESSAGES.iconHidden, nodeId: node.id });
    }

    if (node.type === "heading" || node.type === "text") {
      node.lines.forEach((line, lineIndex) =>
        line.forEach((span, spanIndex) => {
          const own = span.style;

          if (!own || (!own.paint && !own.stroke && !own.mark)) {
            return;
          }

          // So o contorno mudou (sem cor propria nem marca-texto) num elemento que ja tem a dica: nada a mais.
          if (!own.paint && !own.mark && element && element.ratio < element.required) {
            return;
          }

          // A parte com marca-texto e medida contra ele, mesmo sem cor propria (e com ele opaco, ate sobre imagem).
          const backdrops = own.mark ? markBackdrops(own.mark, outside) : outside;

          if (backdrops) {
            report(
              measure(own.paint ?? style.paint, own.stroke ?? style.stroke, own.size ?? style.size, own.weight ?? style.weight, backdrops),
              `${prefix}.lines.${lineIndex}.${spanIndex}.style.${own.paint ? "paint" : own.mark ? "mark" : "stroke"}`
            );
          }
        })
      );
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

  hints.push(...freePhoneTextHints(design, input.content));

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

/* ------------------------------------------------------------------------------------------------
 * Dica "texto no celular" (L1.1): so quando o piso de 12 px muda o encaixe do texto
 * ---------------------------------------------------------------------------------------------- */

/** O que a dica precisa do aviso: o texto do Botão principal e se o "Lembrar depois" pode aparecer nos Links. */
export type FreePhoneTextContent = { allowSnooze?: boolean; ctaLabel?: string | null };

/** O texto do Botão principal quando o aviso ainda nao tem (o dos modelos). */
const PHONE_CTA_LABEL = "Saiba mais";
const LINK_DISMISS = "Não mostrar de novo";
const LINK_SNOOZE = "Lembrar depois";

/**
 * O tamanho que o texto tem no celular, em px da prancheta (para comparar com o desenho): no celular tudo encolhe
 * na proporcao min(W, 343) / W, mas a fonte nunca fica abaixo de 12 px (nem acima do proprio tamanho). Igual ao
 * tamanho do desenho = o piso nao mexe neste texto.
 */
export function freePhoneEquivalentSize(size: number, width: number): number {
  const scale = Math.min(1, FREE_PHONE_CARD_PX / width);
  const phonePx = Math.max(Math.min(size, FREE_MIN_FONT_PX), size * scale);

  return phonePx / scale;
}

/**
 * Largura media de uma letra (em) para a estimativa: Inter normal ~0,5; mais peso, mais larga; maiusculas ~22 % mais;
 * Condensada mais estreita; Monoespacada 0,6. E uma estimativa (a dica avisa, nunca impede salvar).
 */
function letterEm(font: PopupFontRef, weight: number, uppercase: boolean): number {
  let em = 0.5 + Math.max(0, weight - 400) * 0.00012;

  if (font.kind === "builtin") {
    em = font.key === "mono" ? 0.6 : font.key === "condensed" ? em * 0.82 : font.key === "serif" ? em * 0.96 : em;
  }

  return uppercase ? em * 1.22 : em;
}

type TextRun = { em: number; letters: number; size: number };

/** Largura estimada (px da prancheta) de uma linha, com cada tamanho passado por `sizeOf` (o do desenho ou o do celular). */
function runsWidth(runs: readonly TextRun[], sizeOf: (size: number) => number): number {
  return runs.reduce((sum, run) => sum + run.letters * sizeOf(run.size) * run.em, 0);
}

function runOf(text: string, style: Pick<FreeResolvedTextStyle, "font" | "letterSpacing" | "size" | "uppercase" | "weight">): TextRun {
  return { em: letterEm(style.font, style.weight, Boolean(style.uppercase)) + style.letterSpacing, letters: [...text].length, size: style.size };
}

/** As partes de uma linha do Título ou do Texto, cada uma com o estilo dela por cima do estilo do elemento. */
function lineRuns(line: FreeLine, style: FreeResolvedTextStyle): TextRun[] {
  return line.map((span) =>
    runOf(span.text, {
      font: span.style?.font ?? style.font,
      letterSpacing: span.style?.letterSpacing ?? style.letterSpacing,
      size: span.style?.size ?? style.size,
      uppercase: span.style?.uppercase ?? style.uppercase,
      weight: span.style?.weight ?? style.weight
    })
  );
}

function sidesWidth(sides: FreeSides | undefined): number {
  if (sides === undefined) {
    return 0;
  }

  if (typeof sides === "number") {
    return sides * 2;
  }

  return sides.length === 2 ? sides[1] * 2 : sides[1] + sides[3];
}

/** Respiro dos lados mais a borda (o que a caixa tira da largura do texto). */
function boxInset(box: FreeBox | undefined): number {
  return sidesWidth(box?.padding) + (box?.border?.width ?? 0) * 2;
}

/** A largura do icone do selo ou do botao (1,15 em mais o espaco de 0,35 a 0,45 em). */
function iconRun(size: number): TextRun {
  return { em: 1.55, letters: 1, size };
}

type Fit = { key: string; kind: "cut" | "lines" | "row"; node: FreeNode };

/** Linhas que o texto ocupa numa largura (cada linha do texto quebra sozinha; no minimo 1 por linha). */
function wrappedLines(lines: readonly TextRun[][], available: number, sizeOf: (size: number) => number): number {
  return lines.reduce((sum, runs) => sum + Math.max(1, Math.ceil(runsWidth(runs, sizeOf) / Math.max(1, available) - 1e-9)), 0);
}

/**
 * As dicas "texto no celular" (docs/27 L1.1, decisao L18; com os valores do celular desde o L3): o piso de 12 px deixa o texto um pouco maior que a
 * proporcao no celular, e isso so importa quando muda o encaixe. Por elemento visivel com algum tamanho que o piso
 * aumenta, estimando a largura das letras: Título, Texto e Selo que passam a ocupar MAIS LINHAS na largura que tem;
 * Botão (uma linha so, com reticencias) cujo texto deixa de caber e fica cortado; Links que passam a quebrar; e uma
 * Caixa em linha cujos filhos, somados, deixam de caber lado a lado. Um texto curto que so cresce um pouco (o selo e
 * os links dos modelos) nao gera dica.
 */
export function freePhoneTextHints(desktop: PopupFreeDesign, content: FreePhoneTextContent = {}): FreeHint[] {
  // O celular com os valores proprios (devices.mobile): o "desenho" do celular e o design do celular.
  const design = resolveFreeForDevice(desktop, "mobile");
  const artboard = resolveFreeArtboard(design);
  const width = artboard.width;
  const designSize = (size: number) => size;
  const phoneSize = (size: number) => freePhoneEquivalentSize(size, width);
  const fits: Fit[] = [];
  const seen = new Set<FreeId>();
  const snoozeLink = content.allowSnooze !== false && !freeHasSnoozeButton(design);

  /**
   * A primeira chave de tamanho que o piso aumenta (do elemento ou de uma parte); null = o piso nao mexe neste texto.
   * O tamanho proprio do celular leva ao campo do celular.
   */
  const flooredKey = (node: FreeNode, style: FreeResolvedTextStyle): string | null => {
    if (phoneSize(style.size) > style.size + 1e-9) {
      return freeMobileNodeOf(desktop, node.id)?.textStyle?.size !== undefined
        ? `devices.mobile.nodes.${node.id}.textStyle.size`
        : `nodes.${node.id}.textStyle.size`;
    }

    if (node.type === "heading" || node.type === "text") {
      for (const [lineIndex, line] of node.lines.entries()) {
        for (const [spanIndex, span] of line.entries()) {
          if (span.style?.size !== undefined && phoneSize(span.style.size) > span.style.size + 1e-9) {
            return `nodes.${node.id}.lines.${lineIndex}.${spanIndex}.style.size`;
          }
        }
      }
    }

    return null;
  };

  /** As linhas do texto do elemento (Título e Texto: as linhas; Selo e Botão: uma; Links: cada link). */
  const linesOf = (node: FreeNode, style: FreeResolvedTextStyle): TextRun[][] => {
    switch (node.type) {
      case "heading":
      case "text":
        return node.lines.map((line) => lineRuns(line, style));
      case "badge":
        return [[...(node.icon ? [iconRun(style.size)] : []), runOf(node.label, style)]];
      case "button": {
        const label = node.action.kind === "cta" ? content.ctaLabel?.trim() || PHONE_CTA_LABEL : (node.label ?? "");

        return [[...(node.icon ? [iconRun(style.size)] : []), runOf(label, style)]];
      }
      case "links":
        return [...(node.dismiss !== false ? [LINK_DISMISS] : []), ...(snoozeLink ? [LINK_SNOOZE] : [])].map((text) => [runOf(text, style)]);
      default:
        return [];
    }
  };

  /**
   * Quanto o elemento ocupa numa Caixa em linha (px da prancheta, com margens): largura fixa, Espaço, Ícone e os
   * textos de uma linha so (Selo, Botão, Links) pelo texto estimado; Título, Texto e o resto encolhem e quebram.
   */
  const rowWidth = (node: FreeNode, sizeOf: (size: number) => number): number => {
    const place = node.place?.mode === "flow" ? node.place : undefined;
    const margins = sidesWidth(place?.margin);

    if (typeof place?.width === "number") {
      return place.width + margins;
    }

    if (node.type === "spacer") {
      return (node.size ?? 16) + margins;
    }

    if (node.type === "icon") {
      return (node.size ?? 24) + boxInset(node.box) + margins;
    }

    if (node.type === "badge" || node.type === "button" || node.type === "links") {
      const style = freeTextStyleOf(node);
      const lines = linesOf(node, style);
      const text =
        node.type === "links"
          ? lines.reduce((sum, runs) => sum + runsWidth(runs, sizeOf), 0) + (node.gap ?? 8) * Math.max(0, lines.length - 1)
          : runsWidth(lines[0] ?? [], sizeOf);

      return text + boxInset(node.box) + margins;
    }

    return margins;
  };

  /** Confere um elemento com texto numa largura que ele tem para o texto (px da prancheta, sem respiro e borda). */
  const check = (node: FreeNode, available: number) => {
    if (node.type !== "badge" && node.type !== "button" && node.type !== "heading" && node.type !== "text" && node.type !== "links") {
      return;
    }

    const style = freeTextStyleOf(node);
    const key = flooredKey(node, style);

    if (!key) {
      return;
    }

    const lines = linesOf(node, style);

    if (node.type === "button") {
      const before = runsWidth(lines[0] ?? [], designSize);
      const after = runsWidth(lines[0] ?? [], phoneSize);

      if (after > available + 0.5 && before <= available + 0.5) {
        fits.push({ key, kind: "cut", node });
      }

      return;
    }

    if (node.type === "links") {
      const gap = node.gap ?? 8;
      const total = (sizeOf: (size: number) => number) => lines.reduce((sum, runs) => sum + runsWidth(runs, sizeOf), 0) + gap * Math.max(0, lines.length - 1);

      if (total(phoneSize) > available + 0.5 && total(designSize) <= available + 0.5) {
        fits.push({ key, kind: "lines", node });
      }

      return;
    }

    if (wrappedLines(lines, available, phoneSize) > wrappedLines(lines, available, designSize)) {
      fits.push({ key, kind: "lines", node });
    }
  };

  /** Elemento solto ou na sequencia de uma coluna: a largura de fora e a que o texto tem dentro dela. */
  const outerWidth = (node: FreeNode, parentContent: number): number => {
    const place = node.place;

    if (place?.mode === "free") {
      return place.w;
    }

    if (place?.mode === "flow" && typeof place.width === "number") {
      return place.width;
    }

    return parentContent - sidesWidth(place?.mode === "flow" ? place.margin : undefined);
  };

  /** `layout` = a caixa de fora (sem = a prancheta, em coluna). */
  const walk = (nodes: readonly FreeNode[], parentContent: number, layout?: FreeBoxLayout) => {
    const visible = nodes.filter((node) => !node.hidden);
    const row = layout?.dir === "row";

    if (row) {
      // Caixa em linha: os filhos lado a lado deixam de caber no celular (quebram para baixo ou se apertam).
      const gap = (layout.gap ?? 0) * Math.max(0, visible.length - 1);
      const total = (sizeOf: (size: number) => number) => gap + visible.reduce((sum, node) => sum + rowWidth(node, sizeOf), 0);

      if (total(phoneSize) > parentContent + 0.5 && total(designSize) <= parentContent + 0.5) {
        for (const node of visible) {
          const key = node.type === "badge" || node.type === "button" || node.type === "links" ? flooredKey(node, freeTextStyleOf(node)) : null;

          if (key) {
            fits.push({ key, kind: "row", node });
            break;
          }
        }
      }
    }

    for (const node of visible) {
      const inner = Math.max(1, outerWidth(node, parentContent) - boxInset(node.box));

      if (node.type === "box") {
        walk(node.children, inner, node.layout ?? {});
      } else if (!row) {
        // Na linha vale a soma (acima): Título e Texto ali dividem o espaco com os vizinhos.
        check(node, inner);
      }
    }
  };

  walk(design.children, artboard.width - sidesWidth(artboard.padding));

  return fits
    .filter((fit) => (seen.has(fit.node.id) ? false : (seen.add(fit.node.id), true)))
    .map((fit) => ({
      key: fit.key,
      kind: "phone-text" as const,
      message: fit.kind === "cut" ? POPUP_FREE_HINT_MESSAGES.phoneTextCut : fit.kind === "row" ? POPUP_FREE_HINT_MESSAGES.phoneTextRow : POPUP_FREE_HINT_MESSAGES.phoneText,
      nodeId: fit.node.id
    }));
}

/** O medidor do topo do Revisar (0 a 100+, inteiro): a estimativa do jsonb sobre o teto de 30.000. */
export function freeDesignSizePercent(design: PopupFreeDesign): number {
  return Math.round((jsonbBytesUpperBound(canonicalPopupFreeDesign(design)) / FREE_DESIGN_LIMITS.jsonbBytes) * 100);
}

/** "Tamanho do design: 17 % do máximo." */
export function freeDesignSizeLabel(percent: number): string {
  return `Tamanho do design: ${percent} % do máximo.`;
}
