// Editor Livre do pop-up (docs/27; spec §4.6 e §4.7), pacote I: as pecas puras do painel da direita. As frases
// do painel (palavra por palavra da spec), as opcoes de cada campo, a area de texto com "Outro estilo na seleção"
// (applyFreeTextEdit, splitFreeSpanAtSelection, applyFreeSpanStyle e as fichas das partes), as camadas de fundo,
// as paradas do degradê, os lados, as sombras com os atalhos, a largura do pop-up com a reescala, os pesos de cada
// fonte, a conta da imagem (lado ate 1.600 px e as qualidades ate caber) e o mapa chave -> aba/campo
// (freeInspectorTargetOf).
//
// Modulo puro, imports relativos (tests/popup-livre-painel-modelo.test.mjs carrega direto pelo Node). Tudo aqui e
// texto do produtor em portugues, sem palavra fora do vocabulario (testado).

import {
  FREE_ARTBOARD_WIDTH_PRESETS,
  FREE_DESIGN_LIMITS,
  findFreeNode,
  freeNodeIdOfKey,
  nextFreeId,
  rescaleFreeDesign,
  updateFreeNode,
  usedFreeAssetIds,
  walkFreeNodes,
  type FreeAsset,
  type FreeBorder,
  type FreeArtboard,
  type FreeBox,
  type FreeClose,
  type FreeIconName,
  type FreeImageAsset,
  type FreeColorStop,
  type FreeFade,
  type FreeFillPaint,
  type FreeId,
  type FreeLine,
  type FreeNode,
  type FreeNodeType,
  type FreeShadow,
  type FreeSides,
  type FreeSpan,
  type FreeSpanStyle,
  type FreeTextPaint,
  type FreeTextStyle,
  type PopupFreeDesign
} from "../../../../../server/communications/popup-free-model";
import { freeTextDefaultsOf, type FreeResolvedTextStyle } from "../../../../../server/communications/popup-free-render";
import { POPUP_FREE_MESSAGES } from "../../../../../server/communications/popup-free-schema";
import { HEX_COLOR_PATTERN, POPUP_BUILTIN_FONTS, type HexColor, type PopupFontOption, type PopupFontRef, type PopupFontWeight, type PopupVideoMimeType } from "../../../../../server/communications/popup-design-model";
import { rangeMessage, weightAfterFontChange, weightOptionsFor } from "../popup-design/popup-design-editor-model";
import { POPUP_EDITOR_COPY, snoozeSwitchDescription } from "../popup-editor-model";

const L = FREE_DESIGN_LIMITS;
const M = POPUP_FREE_MESSAGES;

type Option<Value extends string> = { label: string; value: Value };

/* ------------------------------------------------------------------------------------------------
 * Frases do painel (spec §4.6 e §4.7, palavra por palavra)
 * ---------------------------------------------------------------------------------------------- */

export const FREE_INSPECTOR_COPY = {
  header: {
    duplicate: "Duplicar",
    label: "Painel do elemento",
    popup: "Pop-up",
    popupHint: "Nada selecionado: aqui fica o pop-up inteiro.",
    remove: "Excluir"
  },
  tabs: { advanced: "Avançado", content: "Conteúdo", label: "Partes do painel do elemento", style: "Estilo" },
  busy: "Espere o arquivo terminar de enviar.",
  imageFailed: "Não foi possível enviar a imagem. Tente de novo.",
  text: {
    label: "Texto",
    hint: "Cada linha aqui é uma linha no pop-up.",
    letters: (count: number) => `Letras usadas: ${formatInt(count)} de ${formatInt(L.textTotal)}`,
    lines: (max: number) => `Use até ${max} linhas.`,
    parts: "Partes com estilo próprio",
    partsEmpty: "Nenhuma parte com estilo próprio. Selecione palavras na área de texto e clique em Outro estilo na seleção.",
    selectFirst: "Selecione palavras na área de texto primeiro.",
    styleSelection: "Outro estilo na seleção"
  },
  span: {
    close: "Fechar",
    decoration: "Linha no texto",
    font: "Fonte",
    italic: "Itálico",
    letterSpacing: "Espaço entre letras",
    paint: "Cor do texto",
    reset: "Voltar ao estilo do elemento",
    size: "Tamanho",
    title: "Estilo da parte",
    uppercase: "Maiúsculas",
    weight: "Peso"
  },
  badge: { icon: "Ícone", label: "Texto do selo", noIcon: "Sem ícone" },
  button: {
    action: "O que o botão faz",
    clickNote: "O clique neste botão conta como o clique do pop-up.",
    destination: "Para onde leva",
    externalHint: "Uma página fora da área do aluno, como a de vendas ou um formulário.",
    icon: "Ícone",
    iconSide: "Lado do ícone",
    label: "Texto do botão",
    link: "Link",
    page: "Página",
    product: "Produto",
    productEmpty: "Nenhum produto ainda. Crie um em Produtos.",
    productsFailed: "Não foi possível carregar a lista de produtos agora. Recarregue a página para escolher um produto.",
    target: "Onde abre"
  },
  image: {
    alt: "Descrição da imagem",
    altHint: "Ajuda quem usa leitor de tela.",
    choose: "Escolha uma imagem deste pop-up",
    decorative: "Imagem só de enfeite (o leitor de tela pula)",
    fit: "Como preenche",
    focus: "Ponto de foco",
    focusX: "Ponto de foco: X",
    focusY: "Ponto de foco: Y",
    hint: "JPG, PNG ou WebP. O editor deixa leve sozinho; transparência funciona.",
    label: "Imagem",
    none: "Nenhuma imagem escolhida.",
    replace: "Trocar imagem",
    reuse: "Usar uma imagem deste pop-up",
    send: "Enviar imagem",
    sending: "Enviando a imagem…",
    thumb: (width: number, height: number) => `Imagem de ${formatInt(width)} × ${formatInt(height)} px`
  },
  video: {
    done: "Vídeo enviado.",
    hint: "MP4 (H.264) ou WEBM, até 15 MB. Toca sem som, em repetição. Quem prefere menos movimento vê só a capa.",
    label: "Vídeo",
    none: "Nenhum vídeo enviado.",
    poster: "Capa do vídeo",
    posterHint: "Opcional. No envio, o editor tira um quadro do vídeo para a capa; se não der, o vídeo segue sem capa.",
    posterNone: "Sem capa.",
    posterRemove: "Tirar a capa",
    posterSend: "Enviar capa",
    replace: "Trocar vídeo",
    send: "Enviar vídeo",
    sending: (percent: number) => `Enviando o vídeo… ${percent}%`
  },
  icon: { color: "Cor", grid: "Ícone", size: "Tamanho", stroke: "Espessura do traço" },
  divider: { color: "Cor", style: "Tipo", thickness: "Espessura" },
  spacer: { size: "Tamanho" },
  shape: { shape: "Formato" },
  box: {
    align: "Alinhar",
    dir: "Direção",
    gap: "Espaço entre os elementos",
    justify: "Distribuir",
    wrap: "Quebrar linha"
  },
  links: {
    closedNote: "O aluno continua fechando pelo X.",
    dismiss: "Mostrar “Não mostrar de novo”",
    gap: "Espaço entre os links",
    /** A mesma chave do card "Quantas vezes e como fecha" (docs/27 §13.7): o mesmo nome, a mesma regra. */
    snooze: POPUP_EDITOR_COPY.frequency.snoozeLabel,
    snoozeOff: "Sem “Lembrar depois”, o pop-up volta só pela regra de “Quantas vezes”."
  },
  audio: { note: "O player do áudio do aviso aparece aqui. Para trocar o áudio, use o campo Áudio." },
  style: {
    text: "Texto",
    align: "Alinhamento",
    decoration: "Linha no texto",
    font: "Fonte",
    italic: "Itálico",
    letterSpacing: "Espaço entre letras",
    lineHeight: "Altura da linha",
    paint: "Cor do texto",
    shadow: "Sombra do texto",
    shadowBlur: "Desfoque",
    shadowColor: "Cor",
    shadowX: "Horizontal",
    shadowY: "Vertical",
    size: "Tamanho",
    uppercase: "Maiúsculas",
    weight: "Peso"
  },
  fill: {
    add: "Camada de fundo",
    addLabel: "Acrescentar camada de fundo",
    angle: "Ângulo",
    center: "Centro",
    centerX: "Centro: X",
    centerY: "Centro: Y",
    color: "Cor",
    empty: "Sem fundo.",
    extent: "Até",
    fit: "Como preenche",
    focus: "Ponto de foco",
    focusX: "Ponto de foco: X",
    focusY: "Ponto de foco: Y",
    image: "Imagem",
    kind: "Tipo da camada",
    layer: (index: number, kind: string) => `Camada ${index + 1}: ${kind}`,
    moveDown: "Descer",
    moveUp: "Subir",
    remove: "Tirar",
    shape: "Formato",
    stopAdd: "Cor",
    stopAddLabel: "Acrescentar cor ao degradê",
    stopColor: (index: number) => `Cor ${index + 1}`,
    stopPosition: (index: number) => `Posição da cor ${index + 1}`,
    stopRemove: (index: number) => `Tirar a cor ${index + 1}`,
    title: "Fundo",
    topFirst: "A de cima primeiro."
  },
  border: { color: "Cor", style: "Tipo", title: "Borda", width: "Espessura" },
  radius: {
    corners: ["Em cima à esquerda", "Em cima à direita", "Embaixo à direita", "Embaixo à esquerda"] as const,
    each: "Cada canto",
    pill: "Pílula",
    same: "Todos iguais",
    title: "Cantos",
    value: "Cantos"
  },
  shadows: {
    add: "Sombra",
    addLabel: "Acrescentar sombra",
    blur: "Desfoque",
    bottomEdge: "Borda de baixo",
    color: "Cor",
    glow: "Brilho",
    inset: "Por dentro",
    item: (index: number) => `Sombra ${index + 1}`,
    remove: "Tirar",
    spread: "Expansão",
    title: "Sombras",
    x: "Horizontal",
    y: "Vertical"
  },
  effects: {
    backdropBlur: "Desfoque do que está atrás",
    blur: "Desfoque",
    clip: "Cortar o que passar da borda",
    fade: "Esmaecer",
    fadeEnd: "Some de vez em",
    fadeSide: "Some para",
    fadeStart: "Começa a sumir em",
    opacity: "Opacidade",
    title: "Efeitos"
  },
  advanced: {
    align: "Alinhar no pop-up",
    alignBottom: "Alinhar embaixo",
    alignCenter: "Alinhar ao centro",
    alignLeft: "Alinhar à esquerda",
    alignMiddle: "Alinhar no meio",
    alignRight: "Alinhar à direita",
    alignTop: "Alinhar em cima",
    auto: "Automática",
    backward: "Enviar para trás",
    flowAlign: "Alinhar nesta caixa",
    forward: "Trazer para frente",
    free: "Solta",
    freeHint: "Solta: você escolhe o lugar. Só fora de caixas.",
    height: "Altura",
    hide: "Esconder do pop-up",
    layer: "Camada",
    layerNote: "Quem vem depois nas Camadas fica por cima; aqui você muda isso.",
    lock: "Travar no editor",
    margin: "Margem",
    marginHint: "Use negativo para passar por cima do elemento vizinho.",
    measured: (height: number) => `Agora com ${formatInt(height)} px.`,
    more: "Mostrar e travar",
    name: "Nome na lista de camadas",
    padding: "Respiro interno",
    position: "Posição",
    rotate: "Girar",
    sequence: "Na sequência",
    sides: ["Em cima", "Direita", "Embaixo", "Esquerda"] as const,
    sidesSame: "Todos iguais",
    width: "Largura",
    x: "X",
    y: "Y"
  },
  popup: {
    adjust: "Ajustar os elementos à nova largura",
    align: "Alinhar",
    closeBackground: "Fundo do X",
    closeBorder: "Borda do X",
    closeColor: "Cor do X",
    closeInset: "Distância do canto",
    closeNote: "O X fica sempre por cima e sempre funciona.",
    closeSide: "Lado",
    closeSize: "Tamanho",
    closeTitle: "Botão de fechar (X)",
    flowTitle: "Elementos na sequência",
    fonts: "Fontes",
    gap: "Espaço entre os elementos",
    justify: "Na altura",
    minHeight: "Altura mínima",
    minHeightHint: "O pop-up cresce se o conteúdo precisar.",
    minHeightPx: "Altura mínima em px",
    padding: "Respiro interno",
    shadow: "Sombra",
    width: "Largura no computador",
    widthNote: "No celular, o pop-up inteiro encolhe junto, igual.",
    widthOther: "Largura em px"
  },
  units: { degrees: "°", percent: "%", px: "px" }
} as const;

function formatInt(value: number) {
  return Math.round(value).toLocaleString("pt-BR");
}

/* ------------------------------------------------------------------------------------------------
 * Opcoes dos campos
 * ---------------------------------------------------------------------------------------------- */

export type FreeTextPaintKind = FreeTextPaint["kind"];
export type FreeFillPaintKind = FreeFillPaint["kind"];

export const FREE_TEXT_PAINT_OPTIONS: readonly Option<FreeTextPaintKind>[] = [
  { label: "Cor", value: "solid" },
  { label: "Degradê", value: "linear" },
  { label: "Degradê circular", value: "radial" }
];
/** Na parte do texto: Cor | Degradê. */
export const FREE_SPAN_PAINT_OPTIONS: readonly Option<"linear" | "solid">[] = [
  { label: "Cor", value: "solid" },
  { label: "Degradê", value: "linear" }
];
export const FREE_FILL_KIND_OPTIONS: readonly Option<FreeFillPaintKind>[] = [
  { label: "Cor", value: "solid" },
  { label: "Degradê", value: "linear" },
  { label: "Degradê circular", value: "radial" },
  { label: "Imagem", value: "image" }
];
export const FREE_TEXT_ALIGN_OPTIONS: readonly Option<"center" | "left" | "right">[] = [
  { label: "Esquerda", value: "left" },
  { label: "Centro", value: "center" },
  { label: "Direita", value: "right" }
];
export type FreeDecorationChoice = "line-through" | "none" | "underline";
export const FREE_DECORATION_OPTIONS: readonly Option<FreeDecorationChoice>[] = [
  { label: "Nenhuma", value: "none" },
  { label: "Sublinhado", value: "underline" },
  { label: "Riscado", value: "line-through" }
];
export const FREE_YES_NO_OPTIONS: readonly Option<"no" | "yes">[] = [
  { label: "Não", value: "no" },
  { label: "Sim", value: "yes" }
];
export const FREE_BUTTON_ACTION_OPTIONS: readonly Option<"close" | "link" | "snooze">[] = [
  { label: "Fechar", value: "close" },
  { label: "Lembrar depois", value: "snooze" },
  { label: "Abrir um link", value: "link" }
];
export const FREE_LINK_MODE_OPTIONS: readonly Option<"external" | "page" | "product">[] = [
  { label: "Um produto", value: "product" },
  { label: "Página da área", value: "page" },
  { label: "Link externo", value: "external" }
];
export const FREE_LINK_TARGET_OPTIONS: readonly Option<"new_tab" | "same_tab">[] = [
  { label: "Na mesma aba", value: "same_tab" },
  { label: "Em outra aba", value: "new_tab" }
];
export const FREE_ICON_SIDE_OPTIONS: readonly Option<"end" | "start">[] = [
  { label: "Antes do texto", value: "start" },
  { label: "Depois do texto", value: "end" }
];
export const FREE_IMAGE_FIT_OPTIONS: readonly Option<"contain" | "cover">[] = [
  { label: "Cobrir", value: "cover" },
  { label: "Caber inteira", value: "contain" }
];
export const FREE_FILL_IMAGE_FIT_OPTIONS: readonly Option<"contain" | "cover" | "tile">[] = [
  { label: "Cobrir", value: "cover" },
  { label: "Caber inteira", value: "contain" },
  { label: "Repetir", value: "tile" }
];
export const FREE_LINE_STYLE_OPTIONS: readonly Option<"dashed" | "dotted" | "solid">[] = [
  { label: "Contínua", value: "solid" },
  { label: "Tracejada", value: "dashed" },
  { label: "Pontilhada", value: "dotted" }
];
export const FREE_SHAPE_OPTIONS: readonly Option<"ellipse" | "rect">[] = [
  { label: "Retângulo", value: "rect" },
  { label: "Oval", value: "ellipse" }
];
export const FREE_BOX_DIR_OPTIONS: readonly Option<"column" | "row">[] = [
  { label: "Em coluna", value: "column" },
  { label: "Em linha", value: "row" }
];
export const FREE_BOX_ALIGN_OPTIONS: readonly Option<"center" | "end" | "start" | "stretch">[] = [
  { label: "Início", value: "start" },
  { label: "Centro", value: "center" },
  { label: "Fim", value: "end" },
  { label: "Esticar", value: "stretch" }
];
export const FREE_BOX_JUSTIFY_OPTIONS: readonly Option<"around" | "between" | "center" | "end" | "start">[] = [
  { label: "Início", value: "start" },
  { label: "Centro", value: "center" },
  { label: "Fim", value: "end" },
  { label: "Espalhado", value: "between" },
  { label: "Com folga nas pontas", value: "around" }
];
export const FREE_RADIAL_SHAPE_OPTIONS: readonly Option<"circle" | "ellipse">[] = [
  { label: "Círculo", value: "circle" },
  { label: "Oval", value: "ellipse" }
];
export const FREE_RADIAL_EXTENT_OPTIONS: readonly Option<"closest-side" | "farthest-corner">[] = [
  { label: "A borda mais perto", value: "closest-side" },
  { label: "O canto mais longe", value: "farthest-corner" }
];
export const FREE_FADE_SIDE_OPTIONS: readonly Option<FreeFade["side"]>[] = [
  { label: "Baixo", value: "bottom" },
  { label: "Cima", value: "top" },
  { label: "Esquerda", value: "left" },
  { label: "Direita", value: "right" }
];
export const FREE_POSITION_OPTIONS: readonly Option<"flow" | "free">[] = [
  { label: "Na sequência", value: "flow" },
  { label: "Solta", value: "free" }
];
export type FreeFlowWidthChoice = "fill" | "fixed" | "hug";
export const FREE_FLOW_WIDTH_OPTIONS: readonly Option<FreeFlowWidthChoice>[] = [
  { label: "Ocupa a linha", value: "fill" },
  { label: "Do tamanho do conteúdo", value: "hug" },
  { label: "Fixa", value: "fixed" }
];
export type FreeFlowHeightChoice = "auto" | "fixed";
/** Altura na sequencia: "Fixa" (midia, forma, linha, espaco) ou "Mínima" (com texto e caixa). */
export function freeFlowHeightOptions(textBearing: boolean): readonly Option<FreeFlowHeightChoice>[] {
  return [
    { label: "Automática", value: "auto" },
    { label: textBearing ? "Mínima" : "Fixa", value: "fixed" }
  ];
}
export type FreeFlowAlignChoice = "box" | "center" | "end" | "start" | "stretch";
export const FREE_FLOW_ALIGN_OPTIONS: readonly Option<FreeFlowAlignChoice>[] = [
  { label: "Como a caixa", value: "box" },
  { label: "Início", value: "start" },
  { label: "Centro", value: "center" },
  { label: "Fim", value: "end" },
  { label: "Esticar", value: "stretch" }
];
export type FreeWidthChoice = "G" | "GG" | "M" | "other" | "P";
export const FREE_WIDTH_OPTIONS: readonly Option<FreeWidthChoice>[] = [
  { label: `P (${FREE_ARTBOARD_WIDTH_PRESETS.P} px)`, value: "P" },
  { label: `M (${FREE_ARTBOARD_WIDTH_PRESETS.M} px)`, value: "M" },
  { label: `G (${FREE_ARTBOARD_WIDTH_PRESETS.G} px)`, value: "G" },
  { label: `GG (${FREE_ARTBOARD_WIDTH_PRESETS.GG} px)`, value: "GG" },
  { label: "Outra", value: "other" }
];
export const FREE_MIN_HEIGHT_OPTIONS: readonly Option<"auto" | "fixed">[] = [
  { label: "Automática", value: "auto" },
  { label: "Fixa", value: "fixed" }
];
export type FreeArtboardShadowChoice = "custom" | "none" | "soft" | "strong";
export const FREE_ARTBOARD_SHADOW_OPTIONS: readonly Option<FreeArtboardShadowChoice>[] = [
  { label: "Sem", value: "none" },
  { label: "Suave", value: "soft" },
  { label: "Forte", value: "strong" },
  { label: "Personalizada", value: "custom" }
];
export const FREE_ARTBOARD_ALIGN_OPTIONS: readonly Option<"center" | "end" | "start" | "stretch">[] = [
  { label: "Esquerda", value: "start" },
  { label: "Centro", value: "center" },
  { label: "Direita", value: "end" },
  { label: "Esticar", value: "stretch" }
];
export const FREE_ARTBOARD_JUSTIFY_OPTIONS: readonly Option<"between" | "center" | "end" | "start">[] = [
  { label: "Em cima", value: "start" },
  { label: "No meio", value: "center" },
  { label: "Embaixo", value: "end" },
  { label: "Espalhados", value: "between" }
];
export const FREE_CLOSE_SIZE_OPTIONS: readonly Option<"28" | "36" | "44">[] = [
  { label: "Pequeno", value: "28" },
  { label: "Médio", value: "36" },
  { label: "Grande", value: "44" }
];
export const FREE_CLOSE_SIDE_OPTIONS: readonly Option<"left" | "right">[] = [
  { label: "Direita", value: "right" },
  { label: "Esquerda", value: "left" }
];
export const FREE_ALIGN_EDGES = ["left", "center", "right", "top", "middle", "bottom"] as const;
export type FreeAlignEdge = (typeof FREE_ALIGN_EDGES)[number];
export const FREE_ALIGN_LABELS: Record<FreeAlignEdge, string> = {
  bottom: FREE_INSPECTOR_COPY.advanced.alignBottom,
  center: FREE_INSPECTOR_COPY.advanced.alignCenter,
  left: FREE_INSPECTOR_COPY.advanced.alignLeft,
  middle: FREE_INSPECTOR_COPY.advanced.alignMiddle,
  right: FREE_INSPECTOR_COPY.advanced.alignRight,
  top: FREE_INSPECTOR_COPY.advanced.alignTop
};

/** "Use de 10 a 160." (a mesma frase do zod do Personalizado e do Livre). */
export function freeRangeMessage(bounds: { max: number; min: number }): string {
  return rangeMessage(bounds.min, bounds.max);
}

/* ------------------------------------------------------------------------------------------------
 * Abas do painel
 * ---------------------------------------------------------------------------------------------- */

export type FreeInspectorTab = "advanced" | "content" | "popup" | "style";

/** A aba escolhida fica ao trocar de elemento do mesmo tipo; outro tipo volta para Conteúdo. */
export function freeTabAfterSelection(current: Exclude<FreeInspectorTab, "popup">, previousType: FreeNodeType | null, nextType: FreeNodeType | null): Exclude<FreeInspectorTab, "popup"> {
  return previousType !== null && previousType === nextType ? current : "content";
}

/* ------------------------------------------------------------------------------------------------
 * Comparacao estavel (chaves em ordem)
 * ---------------------------------------------------------------------------------------------- */

function stable(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stable).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;
}

function same(left: unknown, right: unknown) {
  return stable(left) === stable(right);
}

function lowerPaint(paint: FreeTextPaint): FreeTextPaint {
  if (paint.kind === "solid") {
    return { color: paint.color.toLowerCase(), kind: "solid" };
  }

  return { ...paint, stops: paint.stops.map((stop) => ({ at: stop.at, color: stop.color.toLowerCase() })) };
}

/* ------------------------------------------------------------------------------------------------
 * Area de texto: linhas <-> texto, editar mantendo os estilos, dividir pela selecao, estilo das partes
 * ---------------------------------------------------------------------------------------------- */

/** Um trecho de uma linha (offsets em unidades UTF-16, como `selectionStart` da area de texto). */
export type FreeTextRange = { end: number; line: number; start: number };

/** O texto da area: as partes juntas, linhas separadas por "\n". */
export function freeLinesText(lines: readonly FreeLine[]): string {
  return lines.map((line) => line.map((span) => span.text).join("")).join("\n");
}

/** Quantas letras (pontos de codigo, como o zod conta). */
export function freeTextLength(value: string): number {
  return [...value].length;
}

/** Linhas que o tipo aceita (Título 4, Texto 12). */
export function freeTextLineLimit(type: "heading" | "text"): number {
  return type === "heading" ? L.headingLines : L.textLines;
}

/** A frase do limite quando o texto passa das linhas do tipo; null = cabe. */
export function freeTextLinesProblem(type: "heading" | "text", text: string): string | null {
  const max = freeTextLineLimit(type);

  return text.split("\n").length > max ? FREE_INSPECTOR_COPY.text.lines(max) : null;
}

/** O estilo da parte sem o que ja e igual ao estilo do elemento (a parte so guarda o que muda). */
export function effectiveFreeSpanStyle(style: FreeSpanStyle | undefined, base: FreeResolvedTextStyle | undefined): FreeSpanStyle | undefined {
  if (!style) {
    return undefined;
  }

  const out: FreeSpanStyle = {};
  const differs = <K extends keyof FreeSpanStyle>(key: K, baseValue: unknown) => style[key] !== undefined && !same(style[key], baseValue);

  if (differs("decoration", base?.decoration)) out.decoration = style.decoration;
  if (style.font && (!base || !same(style.font, base.font))) out.font = style.font;
  if (style.italic !== undefined && style.italic !== (base?.italic === true)) out.italic = style.italic;
  if (style.letterSpacing !== undefined && (!base || Math.round(style.letterSpacing * 100) !== Math.round(base.letterSpacing * 100))) out.letterSpacing = style.letterSpacing;
  if (style.paint && (!base || !same(lowerPaint(style.paint), lowerPaint(base.paint)))) out.paint = style.paint;
  if (style.size !== undefined && (!base || style.size !== base.size)) out.size = style.size;
  if (style.uppercase !== undefined && style.uppercase !== (base?.uppercase === true)) out.uppercase = style.uppercase;
  if (style.weight !== undefined && (!base || style.weight !== base.weight)) out.weight = style.weight;

  return Object.keys(out).length > 0 ? out : undefined;
}

function spanOf(text: string, style: FreeSpanStyle | undefined): FreeSpan {
  return style ? { style, text } : { text };
}

/**
 * Partes com o estilo minimo, sem as vazias (uma linha vazia fica com uma parte vazia, que guarda o estilo para
 * o que for escrito nela) e vizinhas com o mesmo estilo juntas (sem passar do limite de letras de uma parte).
 * Devolve o mesmo objeto quando nada muda.
 */
export function normalizeFreeLines(lines: readonly FreeLine[], base?: FreeResolvedTextStyle): FreeLine[] {
  const next = lines.map((line) => {
    const out: FreeSpan[] = [];

    for (const span of line) {
      const style = effectiveFreeSpanStyle(span.style, base);

      if (span.text === "") {
        continue;
      }

      const previous = out[out.length - 1];

      if (previous && same(previous.style, style) && freeTextLength(previous.text) + freeTextLength(span.text) <= L.spanText) {
        out[out.length - 1] = spanOf(previous.text + span.text, style);
        continue;
      }

      out.push(spanOf(span.text, style));
    }

    if (out.length === 0) {
      const first = line[0];

      return [spanOf("", effectiveFreeSpanStyle(first?.style, base))];
    }

    return out;
  });

  return same(next, lines) ? (lines as FreeLine[]) : next;
}

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** Onde o texto mudou: [inicio, fim) no texto antigo e o que entrou no lugar (sem partir pares de surrogates). */
export function freeTextDiff(previous: string, next: string, caret?: number): { end: number; inserted: string; start: number } {
  const limit = Math.min(previous.length, next.length);
  let prefix = 0;

  while (prefix < limit && previous.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }

  let suffix = 0;

  while (suffix < limit && previous.charCodeAt(previous.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)) {
    suffix += 1;
  }

  // O cursor diz onde o texto novo termina (resolve "aa" -> "aaa": entrou no comeco ou no fim?).
  if (caret !== undefined && Number.isInteger(caret) && caret >= 0 && caret <= next.length) {
    suffix = Math.min(suffix, next.length - caret);
  }

  suffix = Math.min(suffix, limit);
  prefix = Math.min(prefix, limit - suffix);

  if (prefix > 0 && isHigh(previous.charCodeAt(prefix - 1))) {
    prefix -= 1;
  }

  if (suffix > 0 && isLow(previous.charCodeAt(previous.length - suffix)) && previous.length - suffix > prefix) {
    suffix -= 1;
  } else if (suffix > 0 && isLow(next.charCodeAt(next.length - suffix))) {
    suffix -= 1;
  }

  return { end: previous.length - suffix, inserted: next.slice(prefix, next.length - suffix), start: prefix };
}

type Run = { breakAfter: boolean; style: FreeSpanStyle | undefined; text: string };

/**
 * Edita a area de texto mantendo os estilos (spec §4.6): a parte que contem a mudanca cresce ou encolhe (o que
 * foi escrito por cima de uma selecao fica com o estilo do comeco dela; o que foi escrito no fim de uma parte
 * continua o estilo dela; no comeco da linha, o da primeira parte), `Enter` cria linha nova com o mesmo estilo,
 * partes que ficam vazias saem e duas vizinhas com o mesmo estilo se juntam. `caret` = o cursor depois da
 * mudanca (desfaz a duvida de "aa" -> "aaa").
 */
export function applyFreeTextEdit(lines: readonly FreeLine[], nextText: string, options: { base?: FreeResolvedTextStyle; caret?: number } = {}): FreeLine[] {
  const previous = freeLinesText(lines);

  if (previous === nextText) {
    return lines as FreeLine[];
  }

  const { end, inserted, start } = freeTextDiff(previous, nextText, options.caret);
  // Partes em ordem, com a posicao de cada uma no texto antigo; a quebra de linha ocupa 1 depois da ultima parte.
  const runs: (Run & { from: number; to: number })[] = [];
  let offset = 0;

  lines.forEach((line, lineIndex) => {
    const spans = line.length > 0 ? line : [{ text: "" }];

    spans.forEach((span, spanIndex) => {
      const from = offset;

      offset += span.text.length;
      runs.push({ breakAfter: spanIndex === spans.length - 1 && lineIndex < lines.length - 1, from, style: span.style, text: span.text, to: offset });
    });

    if (lineIndex < lines.length - 1) {
      offset += 1;
    }
  });

  if (runs.length === 0) {
    return normalizeFreeLines(
      nextText.split("\n").map((text) => [{ text }]),
      options.base
    );
  }

  // A parte que recebe o texto novo.
  let anchor = -1;

  if (end > start) {
    anchor = runs.findIndex((run) => start >= run.from && start < run.to);

    if (anchor === -1) {
      // A selecao comeca numa quebra de linha: a parte de antes dela.
      anchor = runs.findIndex((run) => run.breakAfter && run.to === start);
    }
  } else {
    const lineStart = start === 0 || previous[start - 1] === "\n";

    anchor = lineStart ? runs.findIndex((run) => run.from === start) : runs.findIndex((run) => run.from < start && start <= run.to);
  }

  if (anchor === -1) {
    anchor = runs.findIndex((run) => run.from <= start && start <= run.to);
  }

  if (anchor === -1) {
    anchor = runs.length - 1;
  }

  const pieces: Run[] = [];

  runs.forEach((run, index) => {
    const left = run.text.slice(0, Math.max(0, Math.min(run.text.length, start - run.from)));
    const right = run.text.slice(Math.max(0, Math.min(run.text.length, end - run.from)));
    const breakIndex = run.to; // posicao da quebra de linha depois desta parte
    const breakKept = run.breakAfter && !(breakIndex >= start && breakIndex < end);
    const text = index === anchor ? left + inserted + right : left + right;

    pieces.push({ breakAfter: breakKept, style: run.style, text });
  });

  // Monta as linhas de novo (o texto novo pode ter "\n": a linha se parte com o mesmo estilo).
  const out: FreeLine[] = [[]];

  for (const piece of pieces) {
    const parts = piece.text.split("\n");

    parts.forEach((part, index) => {
      if (index > 0) {
        out.push([]);
      }

      out[out.length - 1].push(spanOf(part, piece.style));
    });

    if (piece.breakAfter) {
      out.push([]);
    }
  }

  return normalizeFreeLines(
    out.map((line) => (line.length > 0 ? line : [{ text: "" }])),
    options.base
  );
}

/**
 * A area de texto do Título e do Texto (spec §4.6): cada linha da area e uma linha do elemento (`Enter` cria
 * linha nova) e o texto novo passa por applyFreeTextEdit. Passou das linhas do tipo (Título 4, Texto 12): nada
 * muda e volta a frase do limite (a area de texto continua com o texto de antes).
 */
export function freeTextAreaChange(
  type: "heading" | "text",
  lines: readonly FreeLine[],
  nextText: string,
  options: { base?: FreeResolvedTextStyle; caret?: number } = {}
): { lines: FreeLine[]; problem: string | null } {
  const text = nextText.replace(/\r\n?/g, "\n");
  const problem = freeTextLinesProblem(type, text);

  if (problem) {
    return { lines: lines as FreeLine[], problem };
  }

  return { lines: applyFreeTextEdit(lines, text, options), problem: null };
}

type GraphemeSegmenter = { segment: (input: string) => Iterable<{ index: number }> };

function graphemeBoundaries(text: string): Set<number> {
  const boundaries = new Set<number>([0, text.length]);
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: "grapheme" }) => GraphemeSegmenter }).Segmenter;

  if (Segmenter) {
    for (const { index } of new Segmenter("pt-BR", { granularity: "grapheme" }).segment(text)) {
      boundaries.add(index);
    }

    return boundaries;
  }

  for (let index = 1; index < text.length; index += 1) {
    if (!(isHigh(text.charCodeAt(index - 1)) && isLow(text.charCodeAt(index)))) {
      boundaries.add(index);
    }
  }

  return boundaries;
}

/** Puxa o comeco para tras e o fim para frente ate a borda de uma letra inteira (emoji, acento combinado). */
function snapToGraphemes(text: string, start: number, end: number): { end: number; start: number } {
  const boundaries = graphemeBoundaries(text);
  let from = Math.max(0, Math.min(start, text.length));
  let to = Math.max(0, Math.min(end, text.length));

  while (from > 0 && !boundaries.has(from)) {
    from -= 1;
  }

  while (to < text.length && !boundaries.has(to)) {
    to += 1;
  }

  return { end: to, start: from };
}

/** Parte as partes da linha nas posicoes pedidas (sem juntar nada; o estilo segue igual nos dois lados). */
function splitLineAt(line: FreeLine, positions: readonly number[]): FreeLine {
  const cuts = [...new Set(positions)].sort((left, right) => left - right);
  const out: FreeSpan[] = [];
  let offset = 0;

  for (const span of line) {
    const from = offset;
    const to = offset + span.text.length;
    let cursor = 0;

    for (const cut of cuts) {
      if (cut > from && cut < to) {
        out.push(spanOf(span.text.slice(cursor, cut - from), span.style));
        cursor = cut - from;
      }
    }

    out.push(spanOf(span.text.slice(cursor), span.style));
    offset = to;
  }

  return out;
}

/** Os trechos (por linha) de uma selecao da area de texto; vazio = nada selecionado (ou so quebras de linha). */
export function freeSelectionRanges(lines: readonly FreeLine[], selection: { end: number; start: number }): FreeTextRange[] {
  const text = freeLinesText(lines);
  const snapped = snapToGraphemes(text, Math.min(selection.start, selection.end), Math.max(selection.start, selection.end));
  const ranges: FreeTextRange[] = [];
  let offset = 0;

  lines.forEach((line, index) => {
    const length = line.reduce((sum, span) => sum + span.text.length, 0);
    const from = Math.max(snapped.start, offset);
    const to = Math.min(snapped.end, offset + length);

    if (to > from) {
      ranges.push({ end: to - offset, line: index, start: from - offset });
    }

    offset += length + 1;
  });

  return ranges;
}

/**
 * "Outro estilo na seleção" (spec §4.6): divide a parte em antes / selecao / depois em cada linha tocada pela
 * selecao. A parte do meio comeca com o estilo de onde ela estava (o do elemento, numa parte sem estilo proprio).
 * Nada e juntado aqui: o popover abre nos trechos devolvidos. null = selecao vazia.
 */
export function splitFreeSpanAtSelection(lines: readonly FreeLine[], selection: { end: number; start: number }): { lines: FreeLine[]; targets: FreeTextRange[] } | null {
  const targets = freeSelectionRanges(lines, selection);

  if (targets.length === 0) {
    return null;
  }

  return { lines: splitAtRanges(lines, targets), targets };
}

function splitAtRanges(lines: readonly FreeLine[], ranges: readonly FreeTextRange[]): FreeLine[] {
  return lines.map((line, index) => {
    const cuts = ranges.filter((range) => range.line === index).flatMap((range) => [range.start, range.end]);

    return cuts.length > 0 ? splitLineAt(line, cuts) : line;
  });
}

/** Um pedaco de estilo para as partes; uma chave com `undefined` tira o que a parte tinha. */
export type FreeSpanStylePatch = { [K in keyof FreeSpanStyle]?: FreeSpanStyle[K] | undefined };

function patchStyle(style: FreeSpanStyle | undefined, patch: FreeSpanStylePatch): FreeSpanStyle | undefined {
  const next: Record<string, unknown> = { ...style };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }

  return Object.keys(next).length > 0 ? (next as FreeSpanStyle) : undefined;
}

/**
 * Muda o estilo das partes dos trechos (o popover da parte). `null` = "Voltar ao estilo do elemento". Parte de
 * novo nas bordas dos trechos (a forma canonica pode ter juntado tudo enquanto o popover estava aberto) e junta
 * as vizinhas iguais no fim: os trechos continuam valendo (o texto nao muda).
 */
export function applyFreeSpanStyle(lines: readonly FreeLine[], targets: readonly FreeTextRange[], patch: FreeSpanStylePatch | null, base?: FreeResolvedTextStyle): FreeLine[] {
  const split = splitAtRanges(lines, targets);
  const styled = split.map((line, index) => {
    const ranges = targets.filter((range) => range.line === index);

    if (ranges.length === 0) {
      return line;
    }

    let offset = 0;

    return line.map((span) => {
      const from = offset;
      const to = offset + span.text.length;

      offset = to;

      const inside = span.text.length > 0 && ranges.some((range) => from >= range.start && to <= range.end);

      return inside ? spanOf(span.text, patch === null ? undefined : patchStyle(span.style, patch)) : span;
    });
  });

  return normalizeFreeLines(styled, base);
}

/** O estilo que o trecho mostra no popover: o do elemento com o da primeira parte do trecho por cima. */
export function freeRangeStyle(lines: readonly FreeLine[], target: FreeTextRange, base: FreeResolvedTextStyle): FreeResolvedTextStyle {
  const line = lines[target.line] ?? [];
  let offset = 0;

  for (const span of line) {
    const to = offset + span.text.length;

    if (to > target.start || (span.text.length === 0 && offset === target.start)) {
      return { ...base, ...(span.style ? Object.fromEntries(Object.entries(span.style).filter(([, value]) => value !== undefined)) : {}) } as FreeResolvedTextStyle;
    }

    offset = to;
  }

  return base;
}

/** O trecho ainda tem alguma parte com estilo proprio (senao o popover fecha depois de "Voltar ao estilo"). */
export function freeRangeHasOwnStyle(lines: readonly FreeLine[], targets: readonly FreeTextRange[], base?: FreeResolvedTextStyle): boolean {
  return targets.some((target) => {
    let offset = 0;

    return (lines[target.line] ?? []).some((span) => {
      const from = offset;

      offset += span.text.length;

      return from < target.end && offset > target.start && effectiveFreeSpanStyle(span.style, base) !== undefined;
    });
  });
}

export type FreeStyledPart = { label: string; range: FreeTextRange; style: FreeSpanStyle; text: string };

/** As fichas de "Partes com estilo próprio": cada parte com estilo, com o texto e o que muda nela. */
export function freeStyledParts(lines: readonly FreeLine[], base: FreeResolvedTextStyle | undefined, library: readonly Pick<PopupFontOption, "id" | "name">[] = []): FreeStyledPart[] {
  const parts: FreeStyledPart[] = [];

  lines.forEach((line, index) => {
    let offset = 0;

    for (const span of line) {
      const from = offset;

      offset += span.text.length;

      const style = effectiveFreeSpanStyle(span.style, base);

      if (style && span.text.trim()) {
        parts.push({
          label: `“${shortText(span.text, 28)}” · ${describeFreeSpanStyle(style, library)}`,
          range: { end: offset, line: index, start: from },
          style,
          text: span.text
        });
      }
    }
  });

  return parts;
}

function shortText(text: string, max: number) {
  const flat = text.replace(/\s+/g, " ").trim();
  const letters = [...flat];

  return letters.length <= max ? flat : `${letters.slice(0, max - 1).join("").trimEnd()}…`;
}

const WEIGHT_WORDS: Record<PopupFontWeight, string> = {
  100: "fina",
  200: "extra leve",
  300: "leve",
  400: "normal",
  500: "média",
  600: "seminegrito",
  700: "negrito",
  800: "extra negrito",
  900: "black"
};

/** O que muda numa parte, em poucas palavras ("verde, negrito"). */
export function describeFreeSpanStyle(style: FreeSpanStyle, library: readonly Pick<PopupFontOption, "id" | "name">[] = []): string {
  const words: string[] = [];

  if (style.paint) {
    words.push(style.paint.kind === "solid" ? freeColorName(style.paint.color) : style.paint.kind === "linear" ? "degradê" : "degradê circular");
  }

  if (style.weight !== undefined) {
    words.push(WEIGHT_WORDS[style.weight] ?? `${style.weight}`);
  }

  if (style.italic !== undefined) {
    words.push(style.italic ? "itálico" : "sem itálico");
  }

  if (style.size !== undefined) {
    words.push(`${style.size} px`);
  }

  if (style.font) {
    const font = style.font;

    words.push(font.kind === "builtin" ? (POPUP_BUILTIN_FONTS[font.key]?.label ?? "outra fonte") : (library.find((item) => item.id === font.id)?.name ?? "fonte enviada"));
  }

  if (style.uppercase !== undefined) {
    words.push(style.uppercase ? "maiúsculas" : "sem maiúsculas");
  }

  if (style.decoration) {
    words.push(style.decoration === "underline" ? "sublinhado" : "riscado");
  }

  if (style.letterSpacing !== undefined) {
    words.push("espaço entre letras");
  }

  return words.length > 0 ? words.join(", ") : "estilo do elemento";
}

function rgbOf(color: HexColor): { a: number; b: number; g: number; r: number } | null {
  const clean = color.trim().toLowerCase();

  if (!HEX_COLOR_PATTERN.test(clean)) {
    return null;
  }

  const hex = clean.slice(1);

  return {
    a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    b: parseInt(hex.slice(4, 6), 16),
    g: parseInt(hex.slice(2, 4), 16),
    r: parseInt(hex.slice(0, 2), 16)
  };
}

/** Nome da cor em portugues (para as fichas): branco, preto, cinza, vermelho, laranja, amarelo, verde... */
export function freeColorName(color: HexColor): string {
  const rgb = rgbOf(color);

  if (!rgb) {
    return "cor";
  }

  if (rgb.a < 0.15) {
    return "transparente";
  }

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

  if (lightness >= 0.93) return "branco";
  if (lightness <= 0.08) return "preto";
  if (saturation < 0.15) return "cinza";

  let hue = 0;

  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);

  if (hue < 0) hue += 360;

  if (hue < 15 || hue >= 345) return "vermelho";
  if (hue < 45) return "laranja";
  if (hue < 64) return "amarelo";
  if (hue < 170) return "verde";
  if (hue < 200) return "azul-claro";
  if (hue < 255) return "azul";
  if (hue < 290) return "roxo";

  return "rosa";
}

/** Letras de todos os textos do design (partes, selos e botoes), como o zod conta o limite de 1.200. */
export function freeLetterCount(design: Pick<PopupFreeDesign, "children">): number {
  let count = 0;

  walkFreeNodes(design.children, (node) => {
    if (node.type === "heading" || node.type === "text") {
      for (const line of node.lines) {
        for (const span of line) {
          count += freeTextLength(span.text);
        }
      }
    } else if (node.type === "badge") {
      count += freeTextLength(node.label);
    } else if (node.type === "button" && node.action.kind !== "cta" && node.label) {
      count += freeTextLength(node.label);
    }
  });

  return count;
}

/* ------------------------------------------------------------------------------------------------
 * Pinturas: trocar de tipo, paradas do degradê, camadas de fundo
 * ---------------------------------------------------------------------------------------------- */

function opaque(color: HexColor): HexColor {
  return color.slice(0, 7).toLowerCase();
}

/** A cor de base de uma pintura (solida = a cor; degrade = a primeira parada; imagem = null). */
export function freePaintBaseColor(paint: FreeFillPaint | FreeTextPaint): HexColor | null {
  if (paint.kind === "solid") return paint.color;
  if (paint.kind === "linear" || paint.kind === "radial") return paint.stops[0]?.color ?? null;

  return null;
}

/** A cor de base de um fundo: a camada de baixo (a ultima da lista); sem fundo = null. */
export function freeFillBaseColor(fill: readonly FreeFillPaint[] | undefined): HexColor | null {
  for (let index = (fill?.length ?? 0) - 1; index >= 0; index -= 1) {
    const paint = fill![index];

    if (paint.kind === "solid") return paint.color;
    if (paint.kind === "linear" || paint.kind === "radial") return paint.stops[paint.stops.length - 1]?.color ?? null;
  }

  return null;
}

/** Duas paradas a partir de uma cor: a cor e ela mais escura. */
function stopsFrom(color: HexColor): FreeColorStop[] {
  return [
    { at: 0, color: opaque(color) },
    { at: 100, color: darkenFreeColor(color, 0.6) }
  ];
}

/** Troca o tipo da pintura de texto mantendo as cores. */
export function freeTextPaintOfKind(kind: FreeTextPaintKind, current: FreeTextPaint): FreeTextPaint {
  if (kind === current.kind) {
    return current;
  }

  const base = freePaintBaseColor(current) ?? "#ffffff";
  const stops = current.kind === "solid" ? stopsFrom(base) : current.stops;

  if (kind === "solid") return { color: base, kind: "solid" };
  if (kind === "linear") return { kind: "linear", stops };

  return { kind: "radial", stops, x: 50, y: 50 };
}

/** Troca o tipo de uma camada de fundo mantendo as cores (Imagem precisa de um arquivo). */
export function freeFillPaintOfKind(kind: FreeFillPaintKind, current: FreeFillPaint, imageAsset: FreeId | null): FreeFillPaint | null {
  if (kind === current.kind) {
    return current;
  }

  if (kind === "image") {
    return imageAsset ? { asset: imageAsset, kind: "image" } : null;
  }

  const base = freePaintBaseColor(current) ?? "#16181c";
  const stops = current.kind === "linear" || current.kind === "radial" ? current.stops : stopsFrom(base);

  if (kind === "solid") return { color: base, kind: "solid" };
  if (kind === "linear") return { kind: "linear", stops };

  return { kind: "radial", stops, x: 50, y: 50 };
}

/** Uma camada nova do tipo pedido (Imagem: so com um arquivo do design). */
export function newFreeFillLayer(kind: FreeFillPaintKind, baseColor: HexColor | null, imageAsset: FreeId | null = null): FreeFillPaint | null {
  const base = baseColor ?? "#16181c";

  if (kind === "image") return imageAsset ? { asset: imageAsset, kind: "image" } : null;
  if (kind === "solid") return { color: opaque(base), kind: "solid" };
  if (kind === "linear") return { kind: "linear", stops: [{ at: 0, color: `${opaque(base)}00` }, { at: 100, color: opaque(base) }] };

  return { extent: "closest-side", kind: "radial", shape: "circle", stops: [{ at: 0, color: `${opaque(base)}cc` }, { at: 100, color: `${opaque(base)}00` }], x: 50, y: 50 };
}

/** "+ Camada de fundo": a nova entra por cima (a primeira da lista); no maximo 3. */
export function addFreeFillLayer(fill: readonly FreeFillPaint[] | undefined, layer: FreeFillPaint): FreeFillPaint[] {
  const current = fill ?? [];

  return current.length >= L.fills ? [...current] : [layer, ...current];
}

/** Subir (-1) ou descer (+1) uma camada; fora da lista nao muda. */
export function moveFreeFillLayer(fill: readonly FreeFillPaint[], index: number, direction: -1 | 1): FreeFillPaint[] {
  const target = index + direction;

  if (index < 0 || index >= fill.length || target < 0 || target >= fill.length) {
    return [...fill];
  }

  const next = [...fill];

  [next[index], next[target]] = [next[target], next[index]];

  return next;
}

/** Tirar uma camada (a prancheta guarda pelo menos uma: `min` = 1). */
export function removeFreeFillLayer(fill: readonly FreeFillPaint[], index: number, min = 0): FreeFillPaint[] {
  if (fill.length <= min || index < 0 || index >= fill.length) {
    return [...fill];
  }

  return fill.filter((_, position) => position !== index);
}

function mix(left: number, right: number, amount: number) {
  return Math.round(left + (right - left) * amount);
}

function hexByte(value: number) {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}

/** A cor entre duas paradas (para a parada nova). */
export function interpolateFreeColor(left: HexColor, right: HexColor, amount: number): HexColor {
  const a = rgbOf(left);
  const b = rgbOf(right);

  if (!a || !b) {
    return opaque(left);
  }

  const alpha = Math.round((a.a + (b.a - a.a) * amount) * 255);
  const color = `#${hexByte(mix(a.r, b.r, amount))}${hexByte(mix(a.g, b.g, amount))}${hexByte(mix(a.b, b.b, amount))}`;

  return alpha >= 255 ? color : `${color}${hexByte(alpha)}`;
}

/** "+ Cor": a parada nova entra no meio do maior vao, com a cor do meio; no maximo 5. */
export function addFreeStop(stops: readonly FreeColorStop[]): FreeColorStop[] {
  if (stops.length >= L.stops.max) {
    return [...stops];
  }

  if (stops.length === 0) {
    return [{ at: 0, color: "#ffffff" }];
  }

  const order = stops.map((stop, index) => ({ index, stop })).sort((left, right) => left.stop.at - right.stop.at);
  let best = { after: order[0].index, at: Math.round(order[0].stop.at / 2), color: order[0].stop.color, gap: order[0].stop.at };

  for (let index = 0; index < order.length - 1; index += 1) {
    const left = order[index].stop;
    const right = order[index + 1].stop;
    const gap = right.at - left.at;

    if (gap > best.gap) {
      best = { after: order[index].index, at: Math.round((left.at + right.at) / 2), color: interpolateFreeColor(left.color, right.color, 0.5), gap };
    }
  }

  const last = order[order.length - 1].stop;

  if (100 - last.at > best.gap) {
    best = { after: order[order.length - 1].index, at: Math.round((last.at + 100) / 2), color: last.color, gap: 100 - last.at };
  }

  const next = [...stops];

  next.splice(best.after + 1, 0, { at: best.at, color: best.color });

  return next;
}

/** Tirar uma parada (o degradê guarda pelo menos 2). */
export function removeFreeStop(stops: readonly FreeColorStop[], index: number): FreeColorStop[] {
  if (stops.length <= L.stops.min || index < 0 || index >= stops.length) {
    return [...stops];
  }

  return stops.filter((_, position) => position !== index);
}

/** Muda a posicao (0 a 100 %, inteiro) ou a cor de uma parada (a ordem da lista fica: a forma canonica ordena). */
export function setFreeStop(stops: readonly FreeColorStop[], index: number, patch: Partial<FreeColorStop>): FreeColorStop[] {
  return stops.map((stop, position) => {
    if (position !== index) {
      return stop;
    }

    const at = patch.at === undefined ? stop.at : Math.max(L.percent.min, Math.min(L.percent.max, Math.round(patch.at)));
    const color = patch.color !== undefined && HEX_COLOR_PATTERN.test(patch.color) ? patch.color.toLowerCase() : stop.color;

    return { at, color };
  });
}

/** Faixa da previa do degradê (CSS so de valores validados: cores hex e posicoes inteiras). */
export function freeStopsPreview(stops: readonly FreeColorStop[]): string {
  const valid = stops.filter((stop) => HEX_COLOR_PATTERN.test(stop.color)).sort((left, right) => left.at - right.at);

  return valid.length > 0 ? `linear-gradient(90deg, ${valid.map((stop) => `${stop.color} ${Math.round(stop.at)}%`).join(", ")})` : "none";
}

/* ------------------------------------------------------------------------------------------------
 * Lados, cantos e sombras
 * ---------------------------------------------------------------------------------------------- */

export type FreeFour = [number, number, number, number];

/** [cima, direita, baixo, esquerda] de qualquer forma dos lados. */
export function freeSidesFour(sides: FreeSides | undefined): FreeFour {
  if (sides === undefined) return [0, 0, 0, 0];
  if (typeof sides === "number") return [sides, sides, sides, sides];
  if (sides.length === 2) return [sides[0], sides[1], sides[0], sides[1]];

  return [sides[0], sides[1], sides[2], sides[3]];
}

/** A forma mais curta: todos iguais = um numero; [v, h, v, h] = [v, h]. */
export function freeSidesFromFour(four: FreeFour): FreeSides {
  const [top, right, bottom, left] = four;

  if (top === right && right === bottom && bottom === left) return top;
  if (top === bottom && right === left) return [top, right];

  return [top, right, bottom, left];
}

/** Os quatro lados iguais (mostra "Todos iguais"). */
export function freeSidesUniform(sides: FreeSides | undefined): boolean {
  const [top, right, bottom, left] = freeSidesFour(sides);

  return top === right && right === bottom && bottom === left;
}

/** Muda um lado (0 cima, 1 direita, 2 baixo, 3 esquerda) e devolve a forma mais curta. */
export function setFreeSide(sides: FreeSides | undefined, index: 0 | 1 | 2 | 3, value: number): FreeSides {
  const four = freeSidesFour(sides);

  four[index] = value;

  return freeSidesFromFour(four);
}

/** Cantos: [sup. esq., sup. dir., inf. dir., inf. esq.]. */
export function freeRadiusFour(radius: number | FreeFour | undefined): FreeFour {
  if (radius === undefined) return [0, 0, 0, 0];

  return typeof radius === "number" ? [radius, radius, radius, radius] : [radius[0], radius[1], radius[2], radius[3]];
}

export function freeRadiusFromFour(four: FreeFour): number | FreeFour {
  return four.every((value) => value === four[0]) ? four[0] : [...four];
}

/** A cor mais escura (a "Borda de baixo" do botao: a cor de baixo * 0,72). */
export function darkenFreeColor(color: HexColor, factor = 0.72): HexColor {
  const rgb = rgbOf(color);

  if (!rgb) {
    return "#000000";
  }

  return `#${hexByte(Math.round(rgb.r * factor))}${hexByte(Math.round(rgb.g * factor))}${hexByte(Math.round(rgb.b * factor))}`;
}

/** Atalho "Brilho": sombra sem deslocamento, na cor do fundo com 25 % (alfa 40). */
export function freeGlowShadow(fillColor: HexColor | null): FreeShadow {
  return { blur: 24, color: `${opaque(fillColor ?? "#ffffff")}40`, spread: 0, x: 0, y: 0 };
}

/** Atalho "Borda de baixo": sombra solida de 3 px, mais escura que o fundo. */
export function freeBottomEdgeShadow(fillColor: HexColor | null): FreeShadow {
  return { blur: 0, color: darkenFreeColor(fillColor ?? "#3f3f46"), spread: 0, x: 0, y: 3 };
}

/** "+ Sombra" e os atalhos: no maximo 2. */
export function addFreeShadow(shadows: readonly FreeShadow[] | undefined, shadow: FreeShadow): FreeShadow[] {
  const current = shadows ?? [];

  return current.length >= L.shadows ? [...current] : [...current, shadow];
}

export function newFreeShadow(): FreeShadow {
  return { blur: 16, color: "#00000066", spread: 0, x: 0, y: 4 };
}

/** As sombras da prancheta: Sem, Suave, Forte (a da referencia) ou Personalizada. */
export const FREE_ARTBOARD_SHADOW_PRESETS: Record<Exclude<FreeArtboardShadowChoice, "custom">, FreeShadow[]> = {
  none: [],
  soft: [{ blur: 40, color: "#00000066", spread: 0, x: 0, y: 12 }],
  strong: [{ blur: 80, color: "#000000b3", spread: 0, x: 0, y: 24 }]
};

export function freeArtboardShadowChoice(shadows: readonly FreeShadow[] | undefined): FreeArtboardShadowChoice {
  const current = shadows ?? [];

  for (const choice of ["none", "soft", "strong"] as const) {
    if (same(current.map((shadow) => ({ ...shadow, color: shadow.color.toLowerCase(), inset: shadow.inset || undefined })), FREE_ARTBOARD_SHADOW_PRESETS[choice])) {
      return choice;
    }
  }

  return "custom";
}

export function newFreeBorder(): FreeBorder {
  return { color: "#ffffff33", width: 1 };
}

/* ------------------------------------------------------------------------------------------------
 * Esmaecer
 * ---------------------------------------------------------------------------------------------- */

export const FREE_FADE_DEFAULT: FreeFade = { end: 100, side: "bottom", start: 40 };
const FADE_GAP = 5;

/** "Começa a sumir em": o fim acompanha para ficar pelo menos 5 % depois. */
export function withFreeFadeStart(fade: FreeFade, start: number): FreeFade {
  const clean = Math.max(0, Math.min(100 - FADE_GAP, Math.round(start)));

  return { ...fade, end: Math.max(fade.end, clean + FADE_GAP), start: clean };
}

/** "Some de vez em": o comeco acompanha para ficar pelo menos 5 % antes. */
export function withFreeFadeEnd(fade: FreeFade, end: number): FreeFade {
  const clean = Math.max(FADE_GAP, Math.min(100, Math.round(end)));

  return { ...fade, end: clean, start: Math.min(fade.start, clean - FADE_GAP) };
}

/* ------------------------------------------------------------------------------------------------
 * Pop-up: largura (com a reescala) e altura minima
 * ---------------------------------------------------------------------------------------------- */

export function freeWidthChoice(width: number): FreeWidthChoice {
  const match = (Object.entries(FREE_ARTBOARD_WIDTH_PRESETS) as [Exclude<FreeWidthChoice, "other">, number][]).find(([, value]) => value === width);

  return match ? match[0] : "other";
}

export function freeWidthOfChoice(choice: Exclude<FreeWidthChoice, "other">): number {
  return FREE_ARTBOARD_WIDTH_PRESETS[choice];
}

/**
 * Troca a largura do pop-up. Com "Ajustar os elementos à nova largura" ligada, tudo acompanha na mesma proporcao
 * (rescaleFreeDesign); desligada, so a largura muda. Fora de 280 a 720 fica no limite.
 */
export function withFreeArtboardWidth(design: PopupFreeDesign, width: number, rescale: boolean): PopupFreeDesign {
  const clean = Math.max(L.artboardWidth.min, Math.min(L.artboardWidth.max, Math.round(width)));
  const current = design.artboard?.width ?? 440;

  if (clean === current) {
    return design;
  }

  return rescale ? rescaleFreeDesign(design, clean) : { ...design, artboard: { ...design.artboard, width: clean } };
}

/* ------------------------------------------------------------------------------------------------
 * Botoes: "Abrir um link" so um, trocar o que o botao faz
 * ---------------------------------------------------------------------------------------------- */

/** Por que "Abrir um link" esta desligado neste botao (outro botao ja abre um link); null = pode. */
export function freeLinkActionDisabledReason(design: Pick<PopupFreeDesign, "children">, nodeId: FreeId): string | null {
  let other = false;

  walkFreeNodes(design.children, (node) => {
    if (node.id !== nodeId && node.type === "button" && node.action.kind === "link") {
      other = true;
    }
  });

  return other ? M.linkButtons : null;
}

/**
 * A frase debaixo de "Permitir “Lembrar depois”" em Links › Conteúdo (docs/27 §13.7): ligada, a mesma do card
 * ("Volta em 1 dia, até 2 vezes."); desligada, o que muda para o aluno.
 */
export function freeLinksSnoozeDescription(allowSnooze: boolean, snoozeMinutes: number): string {
  return allowSnooze ? snoozeSwitchDescription(snoozeMinutes) : FREE_INSPECTOR_COPY.links.snoozeOff;
}

/** O que o botao faz depois de trocar (link comeca sem destino, na mesma aba; o texto fica). */
export function freeButtonActionOf(kind: "close" | "link" | "snooze", current: FreeNode & { type: "button" }): FreeNode & { type: "button" } {
  if (current.action.kind === kind) {
    return current;
  }

  const action = kind === "link" ? { href: "", kind: "link" as const, target: "same_tab" as const } : { kind };

  return { ...current, action, label: current.label ?? "Agora não" };
}

/* ------------------------------------------------------------------------------------------------
 * Fontes: pesos de cada uma
 * ---------------------------------------------------------------------------------------------- */

/** Pesos que a fonte tem (Exo 2 so 500 a 700; Serifada e Monoespaçada 400 e 700; a enviada, todos). */
export function freeWeightOptions(font: PopupFontRef): Option<`${PopupFontWeight}`>[] {
  return weightOptionsFor(font);
}

/** O peso depois de trocar a fonte (o mesmo do Personalizado). */
export function freeWeightAfterFontChange(font: PopupFontRef, current: PopupFontWeight, library: readonly Pick<PopupFontOption, "id" | "weight">[]): PopupFontWeight {
  return weightAfterFontChange(font, current, library);
}

/* ------------------------------------------------------------------------------------------------
 * Imagem: reduzir ate 1.600 px e as qualidades ate caber em 420.000 bytes
 * ---------------------------------------------------------------------------------------------- */

/** Qualidades do WebP, nesta ordem, ate caber. */
export const FREE_IMAGE_QUALITIES = [0.86, 0.75, 0.6] as const;
/** Formatos aceitos no "Enviar imagem" (o editor converte em WebP). */
export const FREE_IMAGE_INPUT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** Arquivo de origem: ate 20 MB (o envio final e sempre ate 420.000 bytes). */
export const FREE_IMAGE_SOURCE_MAX_BYTES = 20 * 1024 * 1024;

/** Medidas finais: o lado maior vai ate 1.600 px (nunca aumenta); lado final abaixo de 16 px = null. */
export function freeImageTargetSize(source: { height: number; width: number }): { height: number; width: number } | null {
  const { height, width } = source;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const scale = Math.min(1, L.imageSide.max / Math.max(width, height));
  const target = { height: Math.round(height * scale), width: Math.round(width * scale) };

  return target.width < L.imageSide.min || target.height < L.imageSide.min ? null : target;
}

/** Bytes de um data URL em base64 (sem o prefixo). */
export function freeDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const body = comma === -1 ? "" : dataUrl.slice(comma + 1);
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;

  return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
}

/** A primeira qualidade que coube (WebP de verdade e ate 420.000 bytes); null = nenhuma coube. */
export function pickFreeImageEncoding(attempts: readonly { dataUrl: string; quality: number }[]): { bytes: number; dataUrl: string; quality: number } | null {
  for (const attempt of attempts) {
    if (!attempt.dataUrl.startsWith("data:image/webp;base64,")) {
      continue;
    }

    const bytes = freeDataUrlBytes(attempt.dataUrl);

    if (bytes > 0 && bytes <= L.imageBytes) {
      return { bytes, dataUrl: attempt.dataUrl, quality: attempt.quality };
    }
  }

  return null;
}

/** O que impede de enviar o arquivo escolhido (formato ou tamanho); null = pode tentar. */
export function freeImageFileProblem(file: { size: number; type: string }): string | null {
  if (!(FREE_IMAGE_INPUT_TYPES as readonly string[]).includes(file.type)) {
    return FREE_IMAGE_COPY_PROBLEMS.format;
  }

  if (file.size <= 0 || file.size > FREE_IMAGE_SOURCE_MAX_BYTES) {
    return FREE_IMAGE_COPY_PROBLEMS.source;
  }

  return null;
}

export const FREE_IMAGE_COPY_PROBLEMS = {
  failed: "Não foi possível enviar a imagem. Tente de novo.",
  format: "Envie uma imagem JPG, PNG ou WebP.",
  open: "Não foi possível abrir esta imagem. Tente outra.",
  sides: M.imageUploadSides,
  source: "A imagem passa de 20 MB. Use uma menor.",
  tooLarge: M.imageUploadBytes,
  webp: "Este navegador não consegue preparar a imagem. Tente outro navegador ou envie em WebP."
} as const;

/* ------------------------------------------------------------------------------------------------
 * Arquivos do design: as imagens que ja estao nele
 * ---------------------------------------------------------------------------------------------- */

/** As imagens do design (para "Usar uma imagem deste pop-up" e o fundo de imagem). */
export function freeImageAssets(design: Pick<PopupFreeDesign, "assets">): (FreeAsset & { kind: "image" })[] {
  return design.assets.filter((asset): asset is FreeAsset & { kind: "image" } => asset.kind === "image");
}

/* ------------------------------------------------------------------------------------------------
 * Chave de erro -> aba e campo (spec §9.6)
 * ---------------------------------------------------------------------------------------------- */

/** id do campo no painel: `livre-<id do elemento>-<campo>` ou `livre-popup-<campo>`. */
export function freeFieldId(nodeId: FreeId | null, field: string): string {
  return `livre-${nodeId ?? "popup"}-${field}`;
}

export type FreeInspectorTarget = { fieldId: string; nodeId: FreeId | null; tab: FreeInspectorTab };

const ARTBOARD_FIELDS: Record<string, string> = {
  align: "alinhar",
  border: "borda",
  fill: "fundo",
  gap: "espaco",
  justify: "na-altura",
  minHeight: "altura",
  padding: "respiro",
  radius: "cantos",
  shadows: "sombra",
  width: "largura"
};

const CLOSE_FIELDS: Record<string, string> = {
  background: "x-fundo",
  border: "x-borda",
  color: "x-cor",
  inset: "x-distancia",
  side: "x-lado",
  size: "x-tamanho"
};

const TEXT_STYLE_FIELDS: Record<string, string> = {
  align: "alinhamento",
  decoration: "linha-texto",
  font: "fonte",
  italic: "italico",
  letterSpacing: "espaco-letras",
  lineHeight: "altura-linha",
  paint: "cor-texto",
  shadow: "sombra-texto",
  size: "tamanho-texto",
  uppercase: "maiusculas",
  weight: "peso"
};

const BOX_STYLE_FIELDS: Record<string, string> = {
  backdropBlur: "desfoque-fundo",
  blur: "desfoque",
  border: "borda",
  clip: "cortar",
  fade: "esmaecer",
  fill: "fundo",
  opacity: "opacidade",
  radius: "cantos",
  shadows: "sombras"
};

/** O primeiro campo de Conteudo de cada tipo (a chave so do elemento, ex.: "nodes.titulo"). */
export function freeFirstContentField(node: FreeNode): string {
  switch (node.type) {
    case "heading":
    case "text":
      return "texto";
    case "badge":
      return "selo-texto";
    case "button":
      return node.action.kind === "cta" ? "botao-texto" : "acao";
    case "image":
    case "video":
      return "enviar";
    case "icon":
      return "icone";
    case "divider":
      return "espessura";
    case "spacer":
      return "tamanho";
    case "shape":
      return "formato";
    case "box":
      return "direcao";
    case "links":
      return "nao-mostrar";
    case "audio":
      return "audio";
  }
}

function nodeTarget(node: FreeNode, rest: string[]): FreeInspectorTarget {
  const id = node.id;
  const content = (field: string): FreeInspectorTarget => ({ fieldId: freeFieldId(id, field), nodeId: id, tab: "content" });
  const style = (field: string): FreeInspectorTarget => ({ fieldId: freeFieldId(id, field), nodeId: id, tab: "style" });
  const advanced = (field: string): FreeInspectorTarget => ({ fieldId: freeFieldId(id, field), nodeId: id, tab: "advanced" });
  const [head, second] = rest;

  switch (head) {
    case undefined:
    case "id":
    case "type":
    case "lines":
    case "children":
      return content(freeFirstContentField(node));
    case "label":
      return content(node.type === "badge" ? "selo-texto" : "botao-texto");
    case "icon":
      return node.type === "button" ? content(second === "side" ? "icone-lado" : "icone") : content("icone");
    case "action":
      return content(second === "href" ? "destino" : second === "target" ? "aba" : "acao");
    case "asset":
      return content("enviar");
    case "alt":
      return content("descricao");
    case "fit":
      return content("preenche");
    case "focus":
      return content(second === "1" ? "foco-y" : "foco-x");
    case "size":
    case "stroke":
    case "color":
    case "thickness":
    case "shape":
      return content({ color: "cor", shape: "formato", size: "tamanho", stroke: "traco", thickness: "espessura" }[head]);
    case "style":
      return content("tipo");
    case "layout":
      return content({ align: "alinhar", dir: "direcao", gap: "espaco", justify: "distribuir", wrap: "quebrar" }[second ?? "dir"] ?? "direcao");
    case "dismiss":
      return content("nao-mostrar");
    case "gap":
      return content("espaco");
    case "textStyle":
      return style(TEXT_STYLE_FIELDS[second ?? "font"] ?? "fonte");
    case "box":
      return second === "padding" ? advanced("respiro") : style(BOX_STYLE_FIELDS[second ?? "fill"] ?? "fundo");
    case "place": {
      const free = node.place?.mode === "free";

      switch (second) {
        case "x":
        case "y":
          return advanced(second);
        case "w":
          return advanced("largura");
        case "h":
          return advanced(free ? "altura" : "altura-tipo");
        case "rotate":
          return advanced("girar");
        case "width":
          return advanced("largura-tipo");
        case "height":
          return advanced("altura-tipo");
        case "align":
          return advanced("alinhar-caixa");
        case "margin":
          return advanced("margem");
        case "z":
          return advanced("camada");
        default:
          return advanced("posicao");
      }
    }
    case "hidden":
      return advanced("esconder");
    case "locked":
      return advanced("travar");
    case "name":
      return advanced("nome");
    default:
      return content(freeFirstContentField(node));
  }
}

function assetTarget(design: PopupFreeDesign, assetId: FreeId): FreeInspectorTarget | null {
  let found: FreeInspectorTarget | null = null;
  const poster = design.assets.find((asset) => asset.kind === "video" && asset.poster === assetId);

  if (design.artboard?.fill?.some((paint) => paint.kind === "image" && paint.asset === assetId)) {
    found = { fieldId: freeFieldId(null, "fundo"), nodeId: null, tab: "popup" };
  }

  walkFreeNodes(design.children, (node) => {
    if (found && found.nodeId !== null) {
      return;
    }

    if ((node.type === "image" || node.type === "video") && node.asset === assetId) {
      found = { fieldId: freeFieldId(node.id, "enviar"), nodeId: node.id, tab: "content" };
    } else if (node.type === "video" && poster && node.asset === poster.id) {
      found = { fieldId: freeFieldId(node.id, "capa"), nodeId: node.id, tab: "content" };
    } else if (!found && node.box?.fill?.some((paint) => paint.kind === "image" && paint.asset === assetId)) {
      found = { fieldId: freeFieldId(node.id, "fundo"), nodeId: node.id, tab: "style" };
    }
  });

  return found;
}

function firstNodeOf(design: PopupFreeDesign, match: (node: FreeNode) => boolean): FreeNode | null {
  let found: FreeNode | null = null;

  walkFreeNodes(design.children, (node) => {
    if (!found && match(node)) {
      found = node;
    }
  });

  return found;
}

/**
 * Para onde uma chave leva no painel (spec §9.6): a aba e o id do campo (e o elemento, que o painel seleciona se
 * ainda nao estiver). Aceita as chaves dos erros e das dicas, com ou sem "freeDesign.", mais "cta.label",
 * "cta.href" (o Botão principal) e "audio" (o elemento Áudio). null = a chave nao tem campo no painel ("design",
 * "size" ou um elemento que nao existe mais).
 */
export function freeInspectorTargetOf(design: PopupFreeDesign, key: string): FreeInspectorTarget | null {
  const clean = key === "freeDesign" ? "design" : key.startsWith("freeDesign.") ? key.slice("freeDesign.".length) : key;
  const [head, ...rest] = clean.split(".");

  switch (head) {
    case "nodes": {
      const [id, ...path] = rest;
      const found = id ? findFreeNode(design, id) : null;

      return found ? nodeTarget(found.node, path) : null;
    }
    case "artboard":
      return { fieldId: freeFieldId(null, ARTBOARD_FIELDS[rest[0] ?? "width"] ?? "largura"), nodeId: null, tab: "popup" };
    case "close":
      return { fieldId: freeFieldId(null, CLOSE_FIELDS[rest[0] ?? "color"] ?? "x-cor"), nodeId: null, tab: "popup" };
    case "fonts":
      return { fieldId: freeFieldId(null, "fontes"), nodeId: null, tab: "popup" };
    case "assets":
      return rest[0] ? assetTarget(design, rest[0]) : null;
    case "cta": {
      const cta = firstNodeOf(design, (node) => node.type === "button" && node.action.kind === "cta");

      if (!cta) {
        return null;
      }

      return { fieldId: freeFieldId(cta.id, rest[0] === "href" ? "botao-destino" : rest[0] === "target" ? "botao-aba" : "botao-texto"), nodeId: cta.id, tab: "content" };
    }
    case "audio": {
      const audio = firstNodeOf(design, (node) => node.type === "audio");

      return audio ? { fieldId: freeFieldId(audio.id, "audio"), nodeId: audio.id, tab: "content" } : null;
    }
    default:
      return null;
  }
}

/**
 * O pedido de foco que o painel recebe (spec §9.6, `FreeFocusRequest`): `intent: "upload"` leva ao botão Enviar
 * imagem/vídeo do elemento (Imagem ou Vídeo recém-adicionados; o seletor de arquivos nunca abre por código); o
 * resto, pela chave (freeInspectorTargetOf).
 */
export function freeFocusTargetOf(design: PopupFreeDesign, request: { intent?: "upload"; key: string }): FreeInspectorTarget | null {
  if (request.intent === "upload") {
    const id = freeNodeIdOfKey(request.key);
    const found = id ? findFreeNode(design, id) : null;

    if (found && (found.node.type === "image" || found.node.type === "video")) {
      return { fieldId: freeFieldId(found.node.id, "enviar"), nodeId: found.node.id, tab: "content" };
    }
  }

  return freeInspectorTargetOf(design, request.key);
}

/* ------------------------------------------------------------------------------------------------
 * Mudar um elemento: estilo do texto, caixa e arquivos
 * ---------------------------------------------------------------------------------------------- */

/** Um pedaco para um objeto do design; uma chave com `undefined` tira o campo. */
export type FreePatch<T> = { [K in keyof T]?: T[K] | undefined };

function patchObject<T extends object>(current: T | undefined, patch: FreePatch<T>): T | undefined {
  const next: Record<string, unknown> = { ...(current ?? {}) };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }

  return Object.keys(next).length > 0 ? (next as T) : undefined;
}

/** Muda o estilo do texto de um elemento com texto (Título, Texto, Selo, Botão, Links); os outros nao mudam. */
export function withFreeTextStyle(design: PopupFreeDesign, id: FreeId, patch: FreePatch<FreeTextStyle>): PopupFreeDesign {
  return updateFreeNode(design, id, (node) => {
    if (!("textStyle" in node) && node.type !== "heading" && node.type !== "text" && node.type !== "badge" && node.type !== "button" && node.type !== "links") {
      return node;
    }

    const current = (node as { textStyle?: FreeTextStyle }).textStyle;
    const textStyle = patchObject(current, patch);
    const { textStyle: unused, ...rest } = node as FreeNode & { textStyle?: FreeTextStyle };

    void unused;

    return (textStyle ? { ...rest, textStyle } : rest) as FreeNode;
  });
}

/** Muda a caixa (fundo, borda, cantos, sombras, efeitos, respiro) de um elemento. */
export function withFreeBox(design: PopupFreeDesign, id: FreeId, patch: FreePatch<FreeBox>): PopupFreeDesign {
  return updateFreeNode(design, id, (node) => {
    const box = patchObject(node.box, patch);
    const { box: unused, ...rest } = node;

    void unused;

    return (box ? { ...rest, box } : rest) as FreeNode;
  });
}

/** Muda campos do proprio elemento (texto do selo, icone, como preenche, nome...); `undefined` tira o campo. */
export function withFreeNodeFields(design: PopupFreeDesign, id: FreeId, patch: Record<string, unknown>): PopupFreeDesign {
  return updateFreeNode(design, id, (node) => patchObject(node as unknown as Record<string, unknown>, patch) as unknown as FreeNode);
}

/** Tira os arquivos que nenhum elemento usa (como a forma canonica; o schema aceita ate 7 na lista). */
export function pruneFreeAssets(design: PopupFreeDesign): PopupFreeDesign {
  const used = usedFreeAssetIds(design);
  const assets = design.assets.filter((asset) => used.has(asset.id));

  return assets.length === design.assets.length ? design : { ...design, assets };
}

/** Muda a prancheta (largura e reescala ficam em withFreeArtboardWidth); `undefined` volta ao padrao. */
export function withFreeArtboard(design: PopupFreeDesign, patch: FreePatch<FreeArtboard>): PopupFreeDesign {
  const artboard = patchObject(design.artboard, patch as FreePatch<Partial<FreeArtboard>>);
  const { artboard: unused, ...rest } = design;

  void unused;

  return artboard ? { ...rest, artboard } : (rest as PopupFreeDesign);
}

/** Muda o X; `undefined` volta ao padrao. */
export function withFreeClose(design: PopupFreeDesign, patch: FreePatch<FreeClose>): PopupFreeDesign {
  const close = patchObject(design.close, patch as FreePatch<Partial<FreeClose>>);
  const { close: unused, ...rest } = design;

  void unused;

  return close ? { ...rest, close } : (rest as PopupFreeDesign);
}

function hasImageAsset(design: PopupFreeDesign, id: FreeId) {
  return design.assets.some((asset) => asset.id === id && asset.kind === "image");
}

/** O arquivo de imagem do design com este caminho (para nao repetir o mesmo arquivo com dois ids). */
function imageAssetWithPath(design: PopupFreeDesign, path: string): FreeImageAsset | null {
  return (design.assets.find((asset) => asset.kind === "image" && asset.path === path) as FreeImageAsset | undefined) ?? null;
}

/**
 * Poe uma imagem enviada (caminho e medidas do servidor) no design e devolve o id dela. O mesmo caminho ja no
 * design reaproveita o id; senao um id novo ("img", "img2"...). O arquivo so fica se algo usar (a forma canonica
 * tira os sem uso), entao quem chama usa o id na mesma mudanca.
 */
export function withFreeImageAsset(design: PopupFreeDesign, image: { height: number; path: string; width: number }): { design: PopupFreeDesign; id: FreeId } {
  const existing = imageAssetWithPath(design, image.path);

  if (existing) {
    return { design, id: existing.id };
  }

  const id = nextFreeId(design, "img");

  return { design: { ...design, assets: [...design.assets, { height: image.height, id, kind: "image", path: image.path, width: image.width }] }, id };
}

/** Imagem de um elemento Imagem: o arquivo novo (ou um do design, pelo id) passa a ser o dele. */
export function withFreeNodeImage(design: PopupFreeDesign, nodeId: FreeId, image: { height: number; path: string; width: number } | FreeId): PopupFreeDesign {
  if (typeof image === "string" && !hasImageAsset(design, image)) {
    return design;
  }

  const placed = typeof image === "string" ? { design, id: image } : withFreeImageAsset(design, image);

  return pruneFreeAssets(updateFreeNode(placed.design, nodeId, (node) => (node.type === "image" ? { ...node, asset: placed.id } : node)));
}

/** Video de um elemento Video: um arquivo de video so por design (o anterior sai junto com a capa dele). */
export function withFreeNodeVideo(
  design: PopupFreeDesign,
  nodeId: FreeId,
  video: { mimeType: PopupVideoMimeType; path: string },
  poster: { height: number; path: string; width: number } | null = null
): PopupFreeDesign {
  const found = findFreeNode(design, nodeId);

  if (!found || found.node.type !== "video") {
    return design;
  }

  const previous = found.node.asset;
  const withoutOld: PopupFreeDesign = { ...design, assets: design.assets.filter((asset) => asset.id !== previous && asset.kind !== "video") };
  let next = withoutOld;
  let posterId: FreeId | undefined;

  if (poster) {
    const placed = withFreeImageAsset(next, poster);

    next = placed.design;
    posterId = placed.id;
  }

  const id = nextFreeId(next, "video");
  const asset = posterId ? { id, kind: "video" as const, mimeType: video.mimeType, path: video.path, poster: posterId } : { id, kind: "video" as const, mimeType: video.mimeType, path: video.path };

  next = { ...next, assets: [...next.assets, asset] };

  return pruneFreeAssets(updateFreeNode(next, nodeId, (node) => (node.type === "video" ? { ...node, asset: id } : node)));
}

/** Capa do video do elemento: a imagem enviada vira a capa; null = "Tirar a capa". */
export function withFreeVideoPoster(design: PopupFreeDesign, nodeId: FreeId, poster: { height: number; path: string; width: number } | null): PopupFreeDesign {
  const found = findFreeNode(design, nodeId);
  const videoId = found && found.node.type === "video" ? found.node.asset : null;

  if (!videoId || !design.assets.some((asset) => asset.id === videoId && asset.kind === "video")) {
    return design;
  }

  let next = design;
  let posterId: FreeId | undefined;

  if (poster) {
    const placed = withFreeImageAsset(next, poster);

    next = placed.design;
    posterId = placed.id;
  }

  return pruneFreeAssets({
    ...next,
    assets: next.assets.map((asset) => {
      if (asset.id !== videoId || asset.kind !== "video") {
        return asset;
      }

      const { poster: unused, ...rest } = asset;

      void unused;

      return posterId ? { ...rest, poster: posterId } : rest;
    })
  });
}

/**
 * Camada de imagem num fundo (da prancheta: `nodeId` null; de um elemento: o id): poe o arquivo (enviado ou ja
 * no design) e monta as camadas com o id dele a partir do fundo mais novo.
 */
export function withFreeFillImage(
  design: PopupFreeDesign,
  nodeId: FreeId | null,
  image: { height: number; path: string; width: number } | FreeId,
  build: (assetId: FreeId, current: readonly FreeFillPaint[]) => FreeFillPaint[]
): PopupFreeDesign {
  if (typeof image === "string" && !hasImageAsset(design, image)) {
    return design;
  }

  const placed = typeof image === "string" ? { design, id: image } : withFreeImageAsset(design, image);

  if (nodeId === null) {
    const current = placed.design.artboard?.fill ?? [];

    return pruneFreeAssets({ ...placed.design, artboard: { ...placed.design.artboard, fill: build(placed.id, current) } });
  }

  const found = findFreeNode(placed.design, nodeId);

  if (!found) {
    return design;
  }

  const fill = build(placed.id, found.node.box?.fill ?? []);

  return pruneFreeAssets(withFreeBox(placed.design, nodeId, { fill: fill.length > 0 ? fill : undefined }));
}

/** O arquivo de video do elemento e a capa dele (para a tela). */
export function freeVideoAssetOf(design: PopupFreeDesign, nodeId: FreeId): { poster: FreeImageAsset | null; video: (FreeAsset & { kind: "video" }) | null } {
  const found = findFreeNode(design, nodeId);
  const id = found && found.node.type === "video" ? found.node.asset : null;
  const video = (design.assets.find((asset) => asset.id === id && asset.kind === "video") as (FreeAsset & { kind: "video" }) | undefined) ?? null;
  const poster = video?.poster ? ((design.assets.find((asset) => asset.id === video.poster && asset.kind === "image") as FreeImageAsset | undefined) ?? null) : null;

  return { poster, video };
}

/** Nome de cada icone na grade (leitor de tela e dica). */
export const FREE_ICON_LABELS: Record<FreeIconName, string> = {
  "arrow-right": "Seta para a direita",
  bell: "Sino",
  "book-open": "Livro aberto",
  calendar: "Calendário",
  check: "Certo",
  "chevron-right": "Seta pequena",
  "circle-check": "Certo no círculo",
  clock: "Relógio",
  crown: "Coroa",
  flame: "Chama",
  gem: "Joia",
  gift: "Presente",
  "graduation-cap": "Capelo",
  heart: "Coração",
  "lock-open": "Cadeado aberto",
  megaphone: "Megafone",
  percent: "Porcentagem",
  play: "Tocar",
  rocket: "Foguete",
  sparkles: "Brilhos",
  star: "Estrela",
  tag: "Etiqueta",
  trophy: "Troféu",
  zap: "Raio"
};

/** O primeiro erro da chave ou de dentro dela ("nodes.titulo.lines" pega "nodes.titulo.lines.1.0.text"). */
export function freeErrorAt(errors: Readonly<Record<string, string>>, ...prefixes: string[]): string | undefined {
  for (const prefix of prefixes) {
    const clean = prefix.startsWith("freeDesign.") ? prefix.slice("freeDesign.".length) : prefix;

    for (const [key, message] of Object.entries(errors)) {
      const bare = key.startsWith("freeDesign.") ? key.slice("freeDesign.".length) : key;

      if (bare === clean || bare.startsWith(`${clean}.`)) {
        return message;
      }
    }
  }

  return undefined;
}

/** As dicas de um elemento (de um tipo, quando pedido). */
export function freeHintsOf<T extends { key: string; kind: string; nodeId: FreeId | null }>(hints: readonly T[], nodeId: FreeId | null, kinds?: readonly string[]): T[] {
  return hints.filter((hint) => hint.nodeId === nodeId && (!kinds || kinds.includes(hint.kind)));
}

/* ------------------------------------------------------------------------------------------------
 * Pequenas leituras usadas pelas telas
 * ---------------------------------------------------------------------------------------------- */

/** O estilo de texto resolvido de um tipo sem nada escolhido (padrao do tipo). */
export function freeTypeTextDefaults(type: FreeNodeType): FreeResolvedTextStyle {
  return { ...freeTextDefaultsOf(type) };
}

/** Um numero dentro do limite (inteiro por padrao). */
export function clampFree(value: number, bounds: { max: number; min: number }, integer = true): number {
  const clean = Math.max(bounds.min, Math.min(bounds.max, value));

  return integer ? Math.round(clean) : Math.round(clean * 100) / 100;
}

/** Tira as chaves indefinidas de um objeto (o design guarda so o que tem valor). */
export function compactFree<T extends Record<string, unknown>>(value: T): T | undefined {
  const out = Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;

  return Object.keys(out).length > 0 ? out : undefined;
}
