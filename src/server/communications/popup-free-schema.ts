// Schema zod do design Livre do pop-up (docs/27 §9): o mesmo valida o editor no navegador do admin, a Server
// Action ao salvar e a leitura do banco (parsePopupFreeDesign: invalido = null, e o Livre invalido nao aparece
// para o aluno). Tudo estrito: chave a mais recusa em qualquer nivel (inclusive `url` num arquivo). Cores so
// #RRGGBB/#RRGGBBAA, numeros com limite, listas fechadas, arquivos so pelo caminho nos nossos buckets. Modulo
// puro (imports relativos): os testes carregam pelo Node. O cartao do aluno NAO importa este arquivo.

import { z } from "zod";
import {
  HEX_COLOR_PATTERN,
  POPUP_VIDEO_MIME_TYPES,
  POPUP_VIDEO_PATH_PATTERN
} from "./popup-design-model";
import { fontRefSchema, intIn, linkHrefSchema, numberIn, POPUP_DESIGN_MESSAGES, weightSchema } from "./popup-design-schema";
import {
  canonicalPopupFreeDesign,
  FREE_DESIGN_LIMITS,
  FREE_ICON_NAMES,
  FREE_ID_PATTERN,
  freeCloseVisibilityProblem,
  jsonbBytesUpperBound,
  uploadedFontIdsOfFree,
  usedFreeAssetIds,
  type FreeAsset,
  type FreeFillPaint,
  type FreeId,
  type FreeNode,
  type FreeTextPaint,
  type PopupFreeDesign,
  type PopupFreeDesignInput
} from "./popup-free-model";
import { FREE_IMAGE_PATH_PATTERN } from "./popup-free-render";

const L = FREE_DESIGN_LIMITS;

/** Frases do design Livre no portugues do produtor (o editor mostra no campo; a chave leva ao elemento). */
export const POPUP_FREE_MESSAGES = {
  audio: "Envie o áudio ou tire o elemento Áudio.",
  audioDuplicate: "O design só pode ter um elemento Áudio.",
  audioMissing: "Falta o elemento Áudio no design.",
  bothDesigns: "Escolha um design só.",
  buttonAction: "Escolha o que o botão faz.",
  buttons: `Use até ${L.buttons} botões além do principal.`,
  childrenPerBox: `Use até ${L.childrenPerBox} elementos dentro de uma caixa.`,
  closeVisible: "O X precisa aparecer bem: use uma cor que contraste com o fundo dele.",
  color: POPUP_DESIGN_MESSAGES.color,
  cta: POPUP_DESIGN_MESSAGES.buttonWithoutCta,
  ctaDuplicate: "O design só pode ter um botão principal.",
  ctaMissing: "Falta o botão principal no design.",
  depth: "Uma caixa pode ter outra dentro, mas não mais que isso.",
  design: "Monte o design de novo: algo nele não vale.",
  effects: `Use desfoque em até ${L.effects} elementos (deixa o celular lento).`,
  empty: "Adicione pelo menos um elemento.",
  fadeOrder: "O fim do esmaecer precisa ficar depois do começo.",
  font: POPUP_DESIGN_MESSAGES.font,
  freeNodes: `Use até ${L.freeNodes} elementos soltos.`,
  freeOnlyRoot: "Só elementos fora de caixas podem ficar soltos.",
  headings: `Use até ${L.headings} títulos.`,
  hover: "Escolha as cores ao passar o mouse.",
  hoverGradient: "Com o texto em degradê, a cor ao passar o mouse não muda o texto. Tire esta cor ou use uma cor sólida no texto.",
  href: "Escolha para onde o botão leva.",
  icon: "Escolha um ícone da lista.",
  icons: `Use até ${L.icons} ícones.`,
  image: "Envie a imagem de novo.",
  imageMissing: "Escolha a imagem deste elemento.",
  imageNodes: `Use até ${L.imageNodes} elementos Imagem.`,
  images: `Use até ${L.imageAssets} imagens diferentes por pop-up.`,
  imageUploadBytes: "A imagem ficou grande demais. Use uma menor.",
  imageUploadFormat: "Envie a imagem como WebP.",
  imageUploadSides: "A imagem precisa ter de 16 a 1.600 px de cada lado.",
  label: "Escreva o texto.",
  lineEmpty: "Escreva algo nesta linha.",
  links: "Falta o elemento dos links (Lembrar depois e Não mostrar de novo).",
  mark: "Escolha a cor do marca-texto.",
  mobilePlace: "No celular, o elemento fica como no computador: solto continua solto e na sequência continua na sequência.",
  linksDuplicate: "O design só pode ter um elemento dos links.",
  nodeType: "Escolha o tipo do elemento.",
  nodes: `Use até ${L.nodes} elementos.`,
  paint: "Escolha uma cor ou um degradê.",
  place: "Escolha onde o elemento fica.",
  poster: "A capa do vídeo precisa ser uma imagem deste pop-up.",
  range: "Use um número dentro do limite.",
  size: "O design ficou grande demais. Tire alguns elementos ou partes de texto.",
  snooze: POPUP_DESIGN_MESSAGES.snoozeButtonOff,
  spanEmpty: "Escreva o texto desta parte.",
  stops: "Use de 2 a 5 cores no degradê.",
  stroke: "Escolha a cor e a espessura do contorno.",
  strokeGradient: "Com o texto em degradê, o contorno cobre a cor. Use uma cor sólida.",
  textTotal: "Os textos passaram de 1.200 letras. Encurte um pouco.",
  tooManyFonts: POPUP_DESIGN_MESSAGES.tooManyFonts,
  video: "Envie o vídeo de novo.",
  videoDuplicate: "Use um vídeo só por pop-up.",
  videoMissing: "Envie o vídeo ou tire o elemento Vídeo."
} as const;

const M = POPUP_FREE_MESSAGES;

/** Objeto estrito: chave a mais recusa com a frase do design (nunca a frase em ingles do zod). */
function strict<T extends z.core.$ZodLooseShape>(shape: T, message: string = M.design) {
  return z.strictObject(shape, { error: (issue) => (issue.code === "unrecognized_keys" ? M.design : issue.code === "invalid_type" ? message : undefined) });
}

/* ------------------------------------------------------------------------------------------------
 * Pecas
 * ---------------------------------------------------------------------------------------------- */

const bool = z.boolean({ error: M.design });
const hex = z.string({ error: M.color }).regex(HEX_COLOR_PATTERN, M.color);
const id = z.string({ error: M.design }).regex(FREE_ID_PATTERN, M.design);
const pct = intIn(L.percent);

/**
 * Listas de tamanho fixo (lados, cantos, ponto de foco) como `z.array(...).length(n)`, sem `z.tuple` de proposito:
 * o zod e um pedaco compartilhado com o JS inicial do Inicio, e o build inclui ali toda classe do zod usada em
 * qualquer tela do app; o ZodTuple custava ~0,9 KB gzip a mais para todo aluno (docs/27 §7). Mesma validacao,
 * mesmos caminhos de erro ("focus.0") e mesmas frases.
 */
function pairOf(item: z.ZodType<number>, message: string) {
  return z.array(item, { error: message }).length(2, message) as unknown as z.ZodType<[number, number]>;
}

function quadOf(item: z.ZodType<number>, message: string) {
  return z.array(item, { error: message }).length(4, message) as unknown as z.ZodType<[number, number, number, number]>;
}

const focus = pairOf(pct, "Use de 0 a 100.");

const stops = z.array(strict({ at: pct, color: hex }), { error: M.stops }).min(L.stops.min, M.stops).max(L.stops.max, M.stops);
const solid = strict({ color: hex, kind: z.literal("solid") });
const linear = strict({ angle: intIn(L.angle).optional(), kind: z.literal("linear"), stops });
const radial = strict({
  extent: z.enum(["closest-side", "farthest-corner"], { error: M.paint }).optional(),
  kind: z.literal("radial"),
  shape: z.enum(["circle", "ellipse"], { error: M.paint }).optional(),
  stops,
  x: pct,
  y: pct
});
const textPaint = z.discriminatedUnion("kind", [solid, linear, radial], { error: M.paint });
const imagePaint = strict({ asset: id, fit: z.enum(["contain", "cover", "tile"], { error: M.paint }).optional(), focus: focus.optional(), kind: z.literal("image") });
const fillPaint = z.discriminatedUnion("kind", [solid, linear, radial, imagePaint], { error: M.paint });
const fills = z.array(fillPaint, { error: M.paint }).max(L.fills, `Use até ${L.fills} camadas de fundo.`);

const sidesOf = (bounds: { max: number; min: number }) =>
  z.union([intIn(bounds), pairOf(intIn(bounds), `Use de ${bounds.min} a ${bounds.max}.`), quadOf(intIn(bounds), `Use de ${bounds.min} a ${bounds.max}.`)], {
    error: `Use de ${bounds.min} a ${bounds.max}.`
  });
const lineStyle = z.enum(["dashed", "dotted", "solid"], { error: "Escolha o tipo da linha." });
const border = strict({ color: hex, style: lineStyle.optional(), width: intIn(L.borderWidth) });
const shadow = strict({
  blur: intIn(L.shadowBlur),
  color: hex,
  inset: bool.optional(),
  spread: intIn(L.shadowSpread),
  x: intIn(L.shadowOffset),
  y: intIn(L.shadowOffset)
});
const shadows = z.array(shadow, { error: M.design }).max(L.shadows, `Use até ${L.shadows} sombras.`);
const fade = strict({ end: pct, side: z.enum(["bottom", "left", "right", "top"], { error: "Escolha para onde o elemento some." }), start: pct })
  .refine((value) => value.end >= value.start + 5, { message: M.fadeOrder, path: ["end"] });
const radius = z.union([intIn(L.radius), quadOf(intIn(L.radius), `Use de 0 a ${L.radius.max}.`)], { error: `Use de 0 a ${L.radius.max}.` });
const box = strict({
  backdropBlur: intIn(L.backdropBlur).optional(),
  blur: intIn(L.blur).optional(),
  border: border.optional(),
  clip: bool.optional(),
  fade: fade.optional(),
  fill: fills.optional(),
  opacity: intIn(L.opacity).optional(),
  padding: sidesOf(L.padding).optional(),
  radius: radius.optional(),
  shadows: shadows.optional()
});
const alignSchema = z.enum(["center", "end", "start", "stretch"], { error: "Escolha o alinhamento." });
const flowWidth = z.union([z.literal("fill"), z.literal("hug"), intIn(L.flowWidth)], { error: `Use de ${L.flowWidth.min} a ${L.flowWidth.max}.` });
const place = z.discriminatedUnion(
  "mode",
  [
    strict({
      align: alignSchema.optional(),
      height: intIn(L.flowHeight).optional(),
      margin: sidesOf(L.margin).optional(),
      mode: z.literal("flow"),
      width: flowWidth.optional(),
      z: intIn(L.z).optional()
    }),
    strict({
      h: intIn(L.h).optional(),
      mode: z.literal("free"),
      rotate: intIn(L.rotate).optional(),
      w: intIn(L.w),
      x: intIn(L.x),
      y: intIn(L.y),
      z: intIn(L.z).optional()
    })
  ],
  { error: M.place }
);

/** Contorno das letras (L6b): no elemento e na parte, nunca no celular. */
const textStroke = strict({ color: hex, width: intIn(L.textStroke) }, M.stroke);
/** Marca-texto (L6b): so na parte do Titulo e do Texto; respiro em um numero ou [vertical, horizontal]. */
const mark = strict(
  {
    color: hex,
    padding: z
      .union([intIn(L.markPadding), pairOf(intIn(L.markPadding), `Use de ${L.markPadding.min} a ${L.markPadding.max}.`)], {
        error: `Use de ${L.markPadding.min} a ${L.markPadding.max}.`
      })
      .optional(),
    radius: intIn(L.markRadius).optional()
  },
  M.mark
);

const textStyle = strict({
  align: z.enum(["center", "left", "right"], { error: "Escolha o alinhamento." }).optional(),
  decoration: z.enum(["line-through", "underline"], { error: "Escolha a linha no texto." }).optional(),
  font: fontRefSchema.optional(),
  italic: bool.optional(),
  letterSpacing: numberIn(L.letterSpacing).optional(),
  lineHeight: numberIn(L.lineHeight).optional(),
  paint: textPaint.optional(),
  shadow: strict({ blur: intIn(L.shadowBlur), color: hex, x: intIn(L.shadowOffset), y: intIn(L.shadowOffset) }).optional(),
  size: intIn(L.fontSize).optional(),
  stroke: textStroke.optional(),
  uppercase: bool.optional(),
  weight: weightSchema.optional()
});
// pick e extend de um objeto estrito continuam estritos no zod 4 (chave a mais na parte da a frase do design).
const span = strict({
  style: textStyle
    .pick({ decoration: true, font: true, italic: true, letterSpacing: true, paint: true, size: true, stroke: true, uppercase: true, weight: true })
    .extend({ mark: mark.optional() })
    .optional(),
  text: z.string({ error: M.spanEmpty }).min(1, M.spanEmpty).max(L.spanText, `Use até ${L.spanText} letras.`)
});
const line = z.array(span, { error: M.spanEmpty }).min(1, M.spanEmpty).max(L.spansPerLine, `Use até ${L.spansPerLine} partes por linha.`);
/**
 * Cores ao passar o mouse e no foco pelo teclado (L6c): so no Botao (o fundo de cor ou degrade, nunca imagem; a cor do
 * texto; a cor da borda) e nos Links (a cor). Nunca no celular: o objeto do celular e estrito e nao tem a chave.
 */
const buttonHover = strict({ borderColor: hex.optional(), color: hex.optional(), fill: textPaint.optional() }, M.hover);
const linksHover = strict({ color: hex.optional() }, M.hover);
const icon = z.enum(FREE_ICON_NAMES, { error: M.icon });
const common = {
  box: box.optional(),
  hidden: bool.optional(),
  id,
  locked: bool.optional(),
  name: z.string({ error: `Use até ${L.name} letras.` }).trim().max(L.name, `Use até ${L.name} letras.`).optional(),
  place: place.optional()
};
const label = z.string({ error: M.label }).trim().min(1, M.label).max(L.label, `Use até ${L.label} letras.`);
const buttonAction = z.discriminatedUnion(
  "kind",
  [
    strict({ kind: z.literal("cta") }),
    strict({ kind: z.literal("close") }),
    strict({ kind: z.literal("snooze") }),
    strict({ href: linkHrefSchema, kind: z.literal("link"), target: z.enum(["new_tab", "same_tab"], { error: "Escolha onde o link abre." }) })
  ],
  { error: M.buttonAction }
);

const boxLayout = strict({
  align: alignSchema.optional(),
  dir: z.enum(["column", "row"], { error: "Escolha a direção." }).optional(),
  gap: intIn(L.gap).optional(),
  justify: z.enum(["around", "between", "center", "end", "start"], { error: "Escolha como distribuir." }).optional(),
  wrap: bool.optional()
});

const boxNode = strict({
  ...common,
  get children() {
    return z.array(freeNodeSchema, { error: M.design }).max(L.childrenPerBox, M.childrenPerBox);
  },
  layout: boxLayout.optional(),
  type: z.literal("box")
});

export const freeNodeSchema: z.ZodType<FreeNode> = z.discriminatedUnion(
  "type",
  [
    strict({ ...common, lines: z.array(line, { error: M.lineEmpty }).min(1, M.lineEmpty).max(L.headingLines, `Use até ${L.headingLines} linhas.`), textStyle: textStyle.optional(), type: z.literal("heading") }),
    strict({ ...common, lines: z.array(line, { error: M.lineEmpty }).min(1, M.lineEmpty).max(L.textLines, `Use até ${L.textLines} linhas.`), textStyle: textStyle.optional(), type: z.literal("text") }),
    strict({ ...common, icon: icon.optional(), label, textStyle: textStyle.optional(), type: z.literal("badge") }),
    strict({
      ...common,
      action: buttonAction,
      hover: buttonHover.optional(),
      icon: strict({ name: icon, side: z.enum(["end", "start"], { error: "Escolha o lado do ícone." }).optional() }).optional(),
      label: label.optional(),
      textStyle: textStyle.optional(),
      type: z.literal("button")
    }),
    strict({
      ...common,
      alt: z.string({ error: `Use até ${L.alt} letras.` }).trim().max(L.alt, `Use até ${L.alt} letras.`).optional(),
      asset: id.nullable(),
      fit: z.enum(["contain", "cover"], { error: "Escolha como a imagem preenche." }).optional(),
      focus: focus.optional(),
      type: z.literal("image")
    }),
    strict({ ...common, asset: id.nullable(), fit: z.enum(["contain", "cover"], { error: "Escolha como o vídeo preenche." }).optional(), focus: focus.optional(), type: z.literal("video") }),
    strict({ ...common, color: hex.optional(), icon, size: intIn(L.iconSize).optional(), stroke: numberIn(L.iconStroke).optional(), type: z.literal("icon") }),
    strict({ ...common, color: hex.optional(), style: lineStyle.optional(), thickness: intIn(L.dividerThickness).optional(), type: z.literal("divider") }),
    strict({ ...common, size: intIn(L.spacer).optional(), type: z.literal("spacer") }),
    strict({ ...common, shape: z.enum(["ellipse", "rect"], { error: "Escolha o formato." }).optional(), type: z.literal("shape") }),
    strict({ ...common, type: z.literal("audio") }),
    strict({ ...common, dismiss: bool.optional(), gap: intIn(L.gap).optional(), hover: linksHover.optional(), textStyle: textStyle.optional(), type: z.literal("links") }),
    boxNode
  ],
  { error: M.nodeType }
);

const asset = z.discriminatedUnion(
  "kind",
  [
    strict({ height: intIn(L.imageSide), id, kind: z.literal("image"), path: z.string({ error: M.image }).regex(FREE_IMAGE_PATH_PATTERN, M.image), width: intIn(L.imageSide) }),
    strict({
      id,
      kind: z.literal("video"),
      mimeType: z.enum(POPUP_VIDEO_MIME_TYPES, { error: M.video }),
      path: z.string({ error: M.video }).regex(POPUP_VIDEO_PATH_PATTERN, M.video),
      poster: id.optional()
    })
  ],
  { error: M.design }
);

/*
 * Celular (docs/27 §9.10): por elemento, so os campos que tem versao do celular, com os limites do computador. A
 * posicao tem o modo do computador (conferido nas regras entre partes) e nunca camada nem girar; `size` com o limite
 * do Espaço (o do Ícone e o tipo de cada campo sao conferidos nas regras entre partes, que sabem o tipo).
 */
const mobilePlace = z.discriminatedUnion(
  "mode",
  [
    strict({ align: alignSchema.optional(), height: intIn(L.flowHeight).optional(), margin: sidesOf(L.margin).optional(), mode: z.literal("flow"), width: flowWidth.optional() }),
    strict({ h: intIn(L.h).optional(), mode: z.literal("free"), w: intIn(L.w).optional(), x: intIn(L.x).optional(), y: intIn(L.y).optional() })
  ],
  { error: M.place }
);
const mobileNode = strict({
  box: strict({ padding: sidesOf(L.padding).optional(), radius: radius.optional() }).optional(),
  gap: intIn(L.gap).optional(),
  hidden: bool.optional(),
  layout: boxLayout.optional(),
  place: mobilePlace.optional(),
  size: intIn(L.spacer).optional(),
  textStyle: textStyle.pick({ align: true, letterSpacing: true, lineHeight: true, size: true }).optional()
});
const devices = strict({
  mobile: strict({
    artboard: strict({ gap: intIn(L.gap).optional(), minHeight: intIn(L.minHeight).optional(), padding: sidesOf(L.padding).optional() }).optional(),
    nodes: z.record(id, mobileNode, { error: M.design }).optional()
  }).optional()
});

const designObject = strict(
  {
    artboard: strict({
        align: alignSchema.optional(),
        border: border.optional(),
        fill: z.array(fillPaint, { error: M.paint }).min(1, M.paint).max(L.fills, `Use até ${L.fills} camadas de fundo.`).optional(),
        gap: intIn(L.gap).optional(),
        justify: z.enum(["between", "center", "end", "start"], { error: "Escolha a posição na altura." }).optional(),
        minHeight: intIn(L.minHeight).optional(),
        padding: sidesOf(L.padding).optional(),
        radius: intIn(L.artboardRadius).optional(),
        shadows: shadows.optional(),
        width: intIn(L.artboardWidth).optional()
      })
      .optional(),
    assets: z.array(asset, { error: M.design }).max(L.imageAssets + L.videos, M.images).optional(),
    children: z.array(freeNodeSchema, { error: M.empty }).min(1, M.empty).max(L.nodes, M.nodes),
    close: strict({
        background: hex.optional(),
        border: border.optional(),
        color: hex.optional(),
        inset: intIn(L.closeInset).optional(),
        side: z.enum(["left", "right"], { error: "Escolha o lado do X." }).optional(),
        size: z.union([z.literal(28), z.literal(36), z.literal(44)], { error: "Escolha o tamanho do X." }).optional()
      })
      .optional(),
    devices: devices.optional(),
    // Derivado (a forma canonica recalcula); so confere o formato.
    fonts: z.array(z.uuid({ error: M.font }), { error: M.font }).max(L.nodes, M.font).optional(),
    mode: z.literal("free", { error: M.design }),
    version: z.literal(1, { error: M.design })
  },
  M.design
);

/* ------------------------------------------------------------------------------------------------
 * Regras entre partes (ids, profundidade, contagens, arquivos, fontes, tamanho, X visivel)
 * ---------------------------------------------------------------------------------------------- */

type Path = (number | string)[];

function textLength(value: string) {
  return [...value].length;
}

function addFreeDesignIssues(design: PopupFreeDesignInput, context: z.RefinementCtx) {
  const issue = (message: string, path: Path) => context.addIssue({ code: "custom", message, path });
  const nodeIds = new Set<FreeId>();
  const byId = new Map<FreeId, FreeNode>();
  const assets = design.assets ?? [];
  const assetKinds = new Map<FreeId, FreeAsset["kind"]>();
  const counts = { audio: 0, buttons: 0, cta: 0, effects: 0, free: 0, headings: 0, icons: 0, imageNodes: 0, links: 0, nodes: 0, text: 0, videos: 0 };
  let textTotalReported = false;

  assets.forEach((item, index) => {
    if (assetKinds.has(item.id)) {
      issue(M.design, ["assets", index, "id"]);
    }

    assetKinds.set(item.id, item.kind);

    if (item.kind === "video") {
      const extension = item.mimeType === "video/mp4" ? ".mp4" : ".webm";

      if (!item.path.endsWith(extension)) {
        issue(M.video, ["assets", index, "path"]);
      }
    }
  });

  const checkAsset = (assetId: FreeId | null | undefined, kind: FreeAsset["kind"], path: Path) => {
    if (assetId && assetKinds.get(assetId) !== kind) {
      issue(kind === "image" ? M.image : M.video, path);
    }
  };
  const checkFill = (fill: readonly FreeFillPaint[] | undefined, path: Path) => {
    (fill ?? []).forEach((paint, index) => {
      if (paint.kind === "image") {
        checkAsset(paint.asset, "image", [...path, index, "asset"]);
      }
    });
  };
  const addText = (value: string, path: Path) => {
    counts.text += textLength(value);

    if (counts.text > L.textTotal && !textTotalReported) {
      textTotalReported = true;
      issue(M.textTotal, path);
    }
  };

  // O contorno nunca com a letra em degrade (L6b): o degrade e um fundo recortado pelas letras, e o contorno, pintado
  // por cima dele, cobre a cor (com 8 px a letra fica toda da cor do contorno). Vale no elemento e na parte, pela
  // pintura dela ou pela do elemento; a chave e a do contorno (ou a da cor da parte, quando o contorno vem do elemento).
  const checkStroke = (node: FreeNode, at: Path) => {
    if (node.type !== "badge" && node.type !== "button" && node.type !== "heading" && node.type !== "links" && node.type !== "text") {
      return;
    }

    const own = node.textStyle;
    const gradient = (paint: FreeTextPaint | undefined) => paint !== undefined && paint.kind !== "solid";

    if (own?.stroke && gradient(own.paint)) {
      issue(M.strokeGradient, [...at, "textStyle", "stroke"]);
    } else if (node.type === "heading" || node.type === "text") {
      node.lines.forEach((spans, lineIndex) =>
        spans.forEach((item, spanIndex) => {
          if ((item.style?.stroke ?? own?.stroke) && gradient(item.style?.paint ?? own?.paint)) {
            issue(M.strokeGradient, [...at, "lines", lineIndex, spanIndex, "style", item.style?.stroke ? "stroke" : "paint"]);
          }
        })
      );
    }
  };

  // A cor do texto ao passar o mouse so com a letra de cor solida (L6c): no Botao e nos Links em degrade, a letra e um
  // fundo recortado pelas letras e a cor nao aparece nela. A chave e a da cor ao passar o mouse; o fundo e a cor da
  // borda continuam valendo com o texto em degrade.
  const checkHover = (node: FreeNode, at: Path) => {
    if ((node.type === "button" || node.type === "links") && node.hover?.color !== undefined && node.textStyle?.paint && node.textStyle.paint.kind !== "solid") {
      issue(M.hoverGradient, [...at, "hover", "color"]);
    }
  };

  checkFill(design.artboard?.fill, ["artboard", "fill"]);

  const walk =(nodes: readonly FreeNode[], depth: number, path: Path) => {
    nodes.forEach((node, index) => {
      const at: Path = [...path, index];

      counts.nodes += 1;

      if (counts.nodes === L.nodes + 1) {
        issue(M.nodes, ["children"]);
      }

      if (nodeIds.has(node.id)) {
        issue(M.design, [...at, "id"]);
      }

      nodeIds.add(node.id);
      byId.set(node.id, node);

      if (node.place?.mode === "free") {
        if (depth > 1) {
          issue(M.freeOnlyRoot, [...at, "place"]);
        } else if (++counts.free > L.freeNodes) {
          issue(M.freeNodes, [...at, "place"]);
        }
      }

      if ((node.box?.blur ?? 0) > 0 || (node.box?.backdropBlur ?? 0) > 0) {
        if (++counts.effects > L.effects) {
          issue(M.effects, [...at, "box", (node.box?.blur ?? 0) > 0 ? "blur" : "backdropBlur"]);
        }
      }

      checkFill(node.box?.fill, [...at, "box", "fill"]);
      checkStroke(node, at);
      checkHover(node, at);

      switch (node.type) {
        case "heading":
        case "text":
          if (node.type === "heading" && ++counts.headings > L.headings) {
            issue(M.headings, at);
          }

          node.lines.forEach((spans, lineIndex) => {
            if (!spans.some((item) => item.text.trim().length > 0)) {
              issue(M.lineEmpty, [...at, "lines", lineIndex]);
            }

            spans.forEach((item, spanIndex) => addText(item.text, [...at, "lines", lineIndex, spanIndex, "text"]));
          });
          break;
        case "badge":
          addText(node.label, [...at, "label"]);
          break;
        case "button":
          if (node.action.kind === "cta") {
            if (++counts.cta > 1) {
              issue(M.ctaDuplicate, [...at, "action"]);
            }

            if (node.label !== undefined) {
              issue(M.design, [...at, "label"]);
            }
          } else {
            // Ate 3 alem do principal, em qualquer mistura de Fechar, Lembrar depois e Abrir um link (L4b).
            if (++counts.buttons > L.buttons) {
              issue(M.buttons, [...at, "action"]);
            }

            if (node.label === undefined) {
              issue(M.label, [...at, "label"]);
            } else {
              addText(node.label, [...at, "label"]);
            }
          }
          break;
        case "image":
          if (++counts.imageNodes > L.imageNodes) {
            issue(M.imageNodes, at);
          }

          checkAsset(node.asset, "image", [...at, "asset"]);
          break;
        case "video":
          if (++counts.videos > L.videos) {
            issue(M.videoDuplicate, at);
          }

          checkAsset(node.asset, "video", [...at, "asset"]);
          break;
        case "icon":
          if (++counts.icons > L.icons) {
            issue(M.icons, at);
          }
          break;
        case "audio":
          if (++counts.audio > 1) {
            issue(M.audioDuplicate, at);
          }
          break;
        case "links":
          if (++counts.links > 1) {
            issue(M.linksDuplicate, at);
          }
          break;
        case "box":
          if (depth > L.boxDepth) {
            issue(M.depth, at);
          } else {
            walk(node.children, depth + 1, [...at, "children"]);
          }
          break;
        default:
          break;
      }
    });
  };

  walk(design.children, 1, ["children"]);

  if (counts.links === 0) {
    issue(M.links, ["children"]);
  }

  addMobileIssues(design, byId, issue);

  // Arquivos: capa do video e uma imagem do design; contagem pelos arquivos usados (a forma canonica tira os outros).
  const used = usedFreeAssetIds(design);
  let images = 0;
  let videos = 0;

  assets.forEach((item, index) => {
    if (item.kind === "video" && item.poster && assetKinds.get(item.poster) !== "image") {
      issue(M.poster, ["assets", index, "poster"]);
    }

    if (!used.has(item.id)) {
      return;
    }

    if (item.kind === "image" && ++images > L.imageAssets) {
      issue(M.images, ["assets", index]);
    }

    if (item.kind === "video" && ++videos > L.videos) {
      issue(M.videoDuplicate, ["assets", index]);
    }
  });

  if (uploadedFontIdsOfFree(design).length > L.uploadedFonts) {
    issue(M.tooManyFonts, ["fonts"]);
  }

  if (freeCloseVisibilityProblem(design)) {
    issue(M.closeVisible, ["close", "color"]);
  }

  if (jsonbBytesUpperBound(canonicalPopupFreeDesign(design)) > L.jsonbBytes) {
    issue(M.size, ["size"]);
  }
}

const MOBILE_TEXT_TYPES = new Set<FreeNode["type"]>(["badge", "button", "heading", "links", "text"]);

/**
 * Celular: ate 32 entradas; a posicao no modo do computador (sem `place` = na sequencia); `textStyle` so em
 * elemento com texto, `size` so no Espaço (0 a 400) e no Ícone (8 a 160), `gap` so nos Links e `layout` so na Caixa.
 * Ids que nao existem passam e a forma canonica tira (um colar com um elemento a menos nao vira erro). Chaves pelo
 * id ("devices.mobile.nodes.titulo.place.x"), sem indice.
 */
function addMobileIssues(design: PopupFreeDesignInput, byId: ReadonlyMap<FreeId, FreeNode>, issue: (message: string, path: Path) => void) {
  const nodes = design.devices?.mobile?.nodes ?? {};
  const entries = Object.entries(nodes);

  if (entries.length > L.nodes) {
    issue(M.nodes, ["devices", "mobile", "nodes"]);
  }

  for (const [nodeId, entry] of entries) {
    const node = byId.get(nodeId);

    if (!node) {
      continue;
    }

    const at: Path = ["devices", "mobile", "nodes", nodeId];

    if (entry.place && entry.place.mode !== (node.place?.mode ?? "flow")) {
      issue(M.mobilePlace, [...at, "place", "mode"]);
    }

    if (entry.textStyle && !MOBILE_TEXT_TYPES.has(node.type)) {
      issue(M.design, [...at, "textStyle"]);
    }

    if (entry.size !== undefined) {
      if (node.type === "icon") {
        const checked = intIn(L.iconSize).safeParse(entry.size);

        if (!checked.success) {
          issue(checked.error.issues[0]?.message ?? M.range, [...at, "size"]);
        }
      } else if (node.type !== "spacer") {
        issue(M.design, [...at, "size"]);
      }
    }

    if (entry.gap !== undefined && node.type !== "links") {
      issue(M.design, [...at, "gap"]);
    }

    if (entry.layout && node.type !== "box") {
      issue(M.design, [...at, "layout"]);
    }
  }
}

/** Design Livre validado e na forma canonica (popup-free-model.canonicalPopupFreeDesign). */
export const popupFreeDesignSchema: z.ZodType<PopupFreeDesign, PopupFreeDesignInput> = designObject
  .superRefine((value, context) => addFreeDesignIssues(value as PopupFreeDesignInput, context))
  .transform((value) => canonicalPopupFreeDesign(value as PopupFreeDesignInput)) as unknown as z.ZodType<PopupFreeDesign, PopupFreeDesignInput>;

/** Leitura do banco (e de uma copia colada): o Livre valido na forma canonica, ou null. */
export function parsePopupFreeDesign(value: unknown): PopupFreeDesign | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = popupFreeDesignSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

/* ------------------------------------------------------------------------------------------------
 * Regras com o conteudo do aviso
 * ---------------------------------------------------------------------------------------------- */

export type PopupFreeContent = { allowSnooze: boolean; audio: unknown; cta: unknown };

/**
 * O design e o conteudo do aviso andam juntos (salvar e publicar; no navegador tambem): o botao principal
 * existe se e so se o aviso tem botao; o Áudio se e so se o aviso tem audio; botao "Lembrar depois" pede o
 * adiar ligado; Imagem e Video precisam do arquivo.
 */
export function popupFreeContentProblems(design: PopupFreeDesign, content: PopupFreeContent): { message: string; path: (number | string)[] }[] {
  const problems: { message: string; path: (number | string)[] }[] = [];
  let hasCta = false;
  let hasAudio = false;
  const nodes: FreeNode[] = [];
  const collect = (list: readonly FreeNode[]) => {
    for (const node of list) {
      nodes.push(node);

      if (node.type === "box") {
        collect(node.children);
      }
    }
  };

  collect(design.children);

  for (const node of nodes) {
    if (node.type === "button" && node.action.kind === "cta") {
      hasCta = true;
    }

    if (node.type === "audio") {
      hasAudio = true;
    }
  }

  if (content.cta && !hasCta) {
    problems.push({ message: M.ctaMissing, path: ["freeDesign"] });
  }

  if (!content.cta && hasCta) {
    problems.push({ message: M.cta, path: ["cta", "label"] });
  }

  if (content.audio && !hasAudio) {
    problems.push({ message: M.audioMissing, path: ["freeDesign"] });
  }

  if (!content.audio && hasAudio) {
    problems.push({ message: M.audio, path: ["audio"] });
  }

  for (const node of nodes) {
    if (node.type === "button" && node.action.kind === "snooze" && !content.allowSnooze) {
      problems.push({ message: M.snooze, path: ["freeDesign", "nodes", node.id, "action"] });
    }

    if (node.type === "image" && !node.asset) {
      problems.push({ message: M.imageMissing, path: ["freeDesign", "nodes", node.id, "asset"] });
    }

    if (node.type === "video" && !node.asset) {
      problems.push({ message: M.videoMissing, path: ["freeDesign", "nodes", node.id, "asset"] });
    }
  }

  return problems;
}

/* ------------------------------------------------------------------------------------------------
 * Chaves de erro: indices viram ids (estavel se a ordem mudar)
 * ---------------------------------------------------------------------------------------------- */

/**
 * "freeDesign.children.3.children.0.lines.0.1.text" -> "freeDesign.nodes.botao.lines.0.1.text";
 * "freeDesign.assets.1.path" -> "freeDesign.assets.capa"; a lista de elementos inteira -> "freeDesign". Chaves de
 * fora do design e as que ja estao no formato novo ficam como vieram.
 */
export function freeErrorKey(design: Pick<PopupFreeDesign, "assets" | "children"> | null | undefined, key: string): string {
  if (key !== "freeDesign" && !key.startsWith("freeDesign.")) {
    return key;
  }

  const parts = key.split(".").slice(1);

  if (parts[0] === "children") {
    let list: readonly FreeNode[] | undefined = design?.children;
    let node: FreeNode | undefined;
    let position = 0;

    while (list && parts[position] === "children" && /^\d+$/.test(parts[position + 1] ?? "")) {
      const next: FreeNode | undefined = list[Number(parts[position + 1])];

      if (!next) {
        break;
      }

      node = next;
      position += 2;
      list = next.type === "box" ? next.children : undefined;
    }

    if (!node || position === 0) {
      return "freeDesign";
    }

    const rest = parts.slice(position);

    return ["freeDesign", "nodes", node.id, ...rest].join(".");
  }

  if (parts[0] === "assets" && /^\d+$/.test(parts[1] ?? "")) {
    const item = design?.assets?.[Number(parts[1])];

    return item ? `freeDesign.assets.${item.id}` : "freeDesign";
  }

  return key;
}

export function freeErrorKeys(design: Pick<PopupFreeDesign, "assets" | "children"> | null | undefined, errors: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, message] of Object.entries(errors)) {
    const mapped = freeErrorKey(design, key);

    if (!(mapped in out)) {
      out[mapped] = message;
    }
  }

  return out;
}

/* ------------------------------------------------------------------------------------------------
 * JSON Schema (para o PR "Criar com IA")
 * ---------------------------------------------------------------------------------------------- */

/**
 * O objeto do design antes do superRefine e do transform: a base do JSON Schema da entrada (no zod 4 uma
 * transformacao nao se representa e o toJSONSchema do schema final da erro). O JSON Schema em si mora em
 * popup-free-json-schema.ts, que nenhuma tela importa: o `z.toJSONSchema` puxa para o pedaco do zod (que o Inicio
 * do aluno ja baixa) os conversores de todos os tipos, ~0,8 KB gzip a mais para todo aluno (docs/27 §7).
 */
export const popupFreeDesignInputSchema = designObject;
