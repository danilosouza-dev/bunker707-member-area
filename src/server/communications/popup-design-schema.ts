// Schema zod do design do pop-up (docs/26), versao 1: o mesmo valida o editor no navegador do admin, a
// Server Action ao salvar e a leitura do banco (parsePopupDesign: invalido ou de outra versao = Padrão). Tudo
// .strict(): chave a mais recusa. Cores so #RRGGBB/#RRGGBBAA, numeros com limite, textos com teto, escolhas
// de lista; o endereco do video so do nosso bucket. Modulo puro (sem "server-only", imports relativos):
// tests/popup-design-modelo.test.mjs carrega direto pelo Node. O desenho do aluno NAO importa este arquivo
// (o zod ficaria no pedaco da janela do pop-up): os tipos e o resto moram em popup-design-model.ts.

import { z } from "zod";
import { describeHeroCtaHrefProblem, isSafeHeroCtaHref } from "../member-area/home-hero-links";
import {
  canonicalPopupDesign,
  HEX_COLOR_PATTERN,
  isOwnStorageUrl,
  POPUP_ALIGNS,
  POPUP_BLOCK_ID_PATTERN,
  POPUP_BUILTIN_FONT_KEYS,
  POPUP_BUTTON_SIZES,
  POPUP_BUTTON_WIDTHS,
  POPUP_CARD_SHADOWS,
  POPUP_CARD_WIDTH_KEYS,
  POPUP_DESIGN_LIMITS as LIMITS,
  POPUP_DESIGN_VERSION,
  POPUP_FONT_WEIGHTS,
  POPUP_MEDIA_ASPECTS,
  POPUP_MEDIA_KINDS,
  POPUP_MEDIA_POSITIONS,
  POPUP_SINGLE_BLOCKS,
  POPUP_TEXT_ALIGNS,
  POPUP_TEXT_PLACEMENTS,
  POPUP_VIDEO_BUCKET,
  POPUP_VIDEO_MIME_TYPES,
  POPUP_VIDEO_PATH_PATTERN,
  uploadedFontIdsOf,
  type PopupBlock,
  type PopupDesign
} from "./popup-design-model";

/** Mensagens do design no portugues do produtor (o editor mostra no campo; a chave do zod leva ao foco). */
export const POPUP_DESIGN_MESSAGES = {
  audioBlockWithoutAudio: "Envie o áudio ou tire o bloco Áudio.",
  audioWithoutBlock: "Falta o bloco Áudio no design.",
  blockKind: "Escolha o tipo do bloco.",
  blocksEmpty: "Adicione pelo menos um bloco.",
  buttonWithoutCta: "Escreva o texto do botão e escolha para onde ele leva.",
  color: "Use uma cor no formato #RRGGBB.",
  ctaWithoutButton: "Falta o bloco do botão principal no design.",
  design: "Monte o design de novo: algo nele não vale.",
  duplicateBlock: "Este bloco já existe no design.",
  font: "Escolha uma fonte da lista.",
  imageForMedia: "Envie a imagem do topo ou escolha “Sem mídia”.",
  imageForVideo: "Envie também uma imagem: ela aparece enquanto o vídeo carrega e para quem prefere menos movimento.",
  paint: "Escolha uma cor ou um degradê.",
  snoozeButtonOff: "Este botão usa o “Lembrar depois”, que está desligado neste pop-up.",
  tooManyFonts: `Use até ${LIMITS.uploadedFonts} fontes enviadas no mesmo pop-up.`,
  video: "Envie o vídeo de novo.",
  videoMissing: "Envie o vídeo ou escolha outra mídia."
} as const;

const range = (min: number, max: number) => `Use de ${String(min).replace(".", ",")} a ${String(max).replace(".", ",")}.`;

function intIn(bounds: { max: number; min: number }) {
  const message = range(bounds.min, bounds.max);

  return z.number({ error: message }).int(message).min(bounds.min, message).max(bounds.max, message);
}

function numberIn(bounds: { max: number; min: number }) {
  const message = range(bounds.min, bounds.max);

  return z.number({ error: message }).min(bounds.min, message).max(bounds.max, message);
}

function textOf(max: number, empty: string) {
  return z.string({ error: empty }).trim().min(1, empty).max(max, `Use até ${max} caracteres.`);
}

const hexColor = z.string({ error: POPUP_DESIGN_MESSAGES.color }).regex(HEX_COLOR_PATTERN, POPUP_DESIGN_MESSAGES.color);

const paintSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ color: hexColor, kind: z.literal("solid") }),
    z.strictObject({ angle: intIn(LIMITS.angle), from: hexColor, kind: z.literal("gradient"), to: hexColor })
  ],
  { error: POPUP_DESIGN_MESSAGES.paint }
);

const borderSchema = z.strictObject({ color: hexColor, width: intIn(LIMITS.borderWidth) });

const fontRefSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ key: z.enum(POPUP_BUILTIN_FONT_KEYS, { error: POPUP_DESIGN_MESSAGES.font }), kind: z.literal("builtin") }),
    z.strictObject({ id: z.uuid({ error: POPUP_DESIGN_MESSAGES.font }), kind: z.literal("uploaded") })
  ],
  { error: POPUP_DESIGN_MESSAGES.font }
);

const weightSchema = z.union(
  POPUP_FONT_WEIGHTS.map((weight) => z.literal(weight)),
  { error: "Escolha um peso da lista." }
);

const textStyleSchema = z.strictObject({
  align: z.enum(POPUP_TEXT_ALIGNS, { error: "Escolha o alinhamento." }),
  font: fontRefSchema,
  letterSpacing: numberIn(LIMITS.letterSpacing),
  lineHeight: numberIn(LIMITS.lineHeight),
  paint: paintSchema,
  size: intIn(LIMITS.fontSize),
  uppercase: z.boolean(),
  weight: weightSchema
});

const buttonStyleSchema = z.strictObject({
  background: paintSchema,
  border: borderSchema,
  font: fontRefSchema,
  glow: hexColor.nullable(),
  letterSpacing: numberIn(LIMITS.letterSpacing),
  radius: intIn(LIMITS.buttonRadius),
  size: z.enum(POPUP_BUTTON_SIZES, { error: "Escolha o tamanho do botão." }),
  textColor: hexColor,
  uppercase: z.boolean(),
  weight: weightSchema,
  width: z.enum(POPUP_BUTTON_WIDTHS, { error: "Escolha a largura do botão." })
});

const blockIdSchema = z.string({ error: POPUP_DESIGN_MESSAGES.design }).regex(POPUP_BLOCK_ID_PATTERN, POPUP_DESIGN_MESSAGES.design);

/** Link do segundo botao: a mesma regra do botao principal (pagina da area, produto ou https). */
const linkHrefSchema = z
  .string({ error: "Escolha para onde o botão leva." })
  .trim()
  .superRefine((value, context) => {
    const problem = describeHeroCtaHrefProblem(value);

    if (problem || !isSafeHeroCtaHref(value)) {
      context.addIssue({ code: "custom", message: problem ?? "Escolha para onde o botão leva." });
    }
  });

const button2ActionSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("close") }),
    z.strictObject({ kind: z.literal("snooze") }),
    z.strictObject({ href: linkHrefSchema, kind: z.literal("link"), target: z.enum(["same_tab", "new_tab"], { error: "Escolha onde o link abre." }) })
  ],
  { error: "Escolha o que o botão faz." }
);

const blockSchema = z.discriminatedUnion(
  "type",
  [
    z.strictObject({
      background: paintSchema,
      border: borderSchema,
      id: blockIdSchema,
      radius: intIn(LIMITS.buttonRadius),
      style: textStyleSchema,
      text: textOf(LIMITS.badgeText, "Escreva o texto do selo."),
      type: z.literal("badge")
    }),
    z.strictObject({
      id: blockIdSchema,
      lines: z
        .array(
          z.strictObject({
            paint: paintSchema.nullable(),
            size: intIn(LIMITS.fontSize).nullable(),
            text: textOf(LIMITS.headingLine, "Escreva o texto da linha.")
          })
        )
        .min(1, "Escreva pelo menos uma linha.")
        .max(LIMITS.headingLines, `Use até ${LIMITS.headingLines} linhas.`),
      style: textStyleSchema,
      type: z.literal("heading")
    }),
    z.strictObject({ id: blockIdSchema, style: textStyleSchema, text: textOf(LIMITS.text, "Escreva o texto."), type: z.literal("text") }),
    z.strictObject({ id: blockIdSchema, style: buttonStyleSchema, type: z.literal("button") }),
    z.strictObject({
      action: button2ActionSchema,
      id: blockIdSchema,
      label: textOf(LIMITS.button2Label, "Escreva o texto do botão."),
      style: buttonStyleSchema,
      type: z.literal("button2")
    }),
    z.strictObject({ id: blockIdSchema, type: z.literal("audio") }),
    z.strictObject({ height: intIn(LIMITS.spacer), id: blockIdSchema, type: z.literal("spacer") })
  ],
  { error: POPUP_DESIGN_MESSAGES.blockKind }
);

/** Video do nosso bucket: caminho videos/<uuid>.<ext>, extensao igual ao tipo e endereco publico desse objeto. */
const videoSchema = z
  .strictObject({
    mimeType: z.enum(POPUP_VIDEO_MIME_TYPES, { error: POPUP_DESIGN_MESSAGES.video }),
    path: z.string({ error: POPUP_DESIGN_MESSAGES.video }).regex(POPUP_VIDEO_PATH_PATTERN, POPUP_DESIGN_MESSAGES.video),
    url: z.string({ error: POPUP_DESIGN_MESSAGES.video }).trim().max(2_048, POPUP_DESIGN_MESSAGES.video)
  })
  .superRefine((video, context) => {
    const extension = video.mimeType === "video/mp4" ? ".mp4" : ".webm";

    if (!video.path.endsWith(extension) || !isOwnStorageUrl(video.url, { bucket: POPUP_VIDEO_BUCKET, objectPath: video.path })) {
      context.addIssue({ code: "custom", message: POPUP_DESIGN_MESSAGES.video });
    }
  });

const designObjectSchema = z.strictObject(
  {
    blocks: z.array(blockSchema).min(1, POPUP_DESIGN_MESSAGES.blocksEmpty).max(LIMITS.blocks, `Use até ${LIMITS.blocks} blocos.`),
    card: z.strictObject({
      background: paintSchema,
      border: borderSchema,
      padding: intIn(LIMITS.cardPadding),
      radius: intIn(LIMITS.cardRadius),
      shadow: z.enum(POPUP_CARD_SHADOWS, { error: "Escolha a sombra." }),
      width: z.enum(POPUP_CARD_WIDTH_KEYS, { error: "Escolha a largura do cartão." })
    }),
    close: z.strictObject({ background: hexColor, color: hexColor }),
    // Derivado dos blocos (o transform recalcula); so confere o formato.
    fonts: z.array(z.uuid({ error: POPUP_DESIGN_MESSAGES.font })).max(LIMITS.blocks),
    links: z.strictObject({ color: hexColor }),
    media: z.strictObject({
      aspect: z.enum(POPUP_MEDIA_ASPECTS, { error: "Escolha o formato da mídia." }),
      fade: z.strictObject({ color: z.union([z.literal("auto"), hexColor]), enabled: z.boolean(), height: intIn(LIMITS.fadeHeight) }),
      kind: z.enum(POPUP_MEDIA_KINDS, { error: "Escolha a mídia." }),
      position: z.enum(POPUP_MEDIA_POSITIONS, { error: "Escolha o recorte da mídia." }),
      video: videoSchema.nullable()
    }),
    text: z.strictObject({
      align: z.enum(POPUP_ALIGNS, { error: "Escolha o alinhamento." }),
      gap: intIn(LIMITS.gap),
      overlap: intIn(LIMITS.overlap),
      placement: z.enum(POPUP_TEXT_PLACEMENTS, { error: "Escolha onde fica o texto." })
    }),
    version: z.literal(POPUP_DESIGN_VERSION, { error: POPUP_DESIGN_MESSAGES.design })
  },
  { error: POPUP_DESIGN_MESSAGES.design }
);

/** Regras entre partes do design: ids unicos, blocos de uma vez so, ate 4 fontes enviadas e o video. */
function addDesignIssues(design: { blocks: readonly PopupBlock[]; media: { kind: string; video: unknown } }, context: z.RefinementCtx) {
  const ids = new Set<string>();
  const singles = new Set<string>();

  design.blocks.forEach((block, index) => {
    if (ids.has(block.id)) {
      context.addIssue({ code: "custom", message: POPUP_DESIGN_MESSAGES.design, path: ["blocks", index, "id"] });
    }

    ids.add(block.id);

    if ((POPUP_SINGLE_BLOCKS as readonly string[]).includes(block.type)) {
      if (singles.has(block.type)) {
        context.addIssue({ code: "custom", message: POPUP_DESIGN_MESSAGES.duplicateBlock, path: ["blocks", index] });
      }

      singles.add(block.type);
    }
  });

  if (uploadedFontIdsOf(design.blocks).length > LIMITS.uploadedFonts) {
    context.addIssue({ code: "custom", message: POPUP_DESIGN_MESSAGES.tooManyFonts, path: ["fonts"] });
  }

  if (design.media.kind === "video" && !design.media.video) {
    context.addIssue({ code: "custom", message: POPUP_DESIGN_MESSAGES.videoMissing, path: ["media", "video"] });
  }
}

/**
 * Design do pop-up (versao 1), validado e na forma canonica (popup-design-model.canonicalPopupDesign: `fonts`
 * recalculado, cores minusculas, textos aparados).
 */
export const popupDesignSchema: z.ZodType<PopupDesign> = designObjectSchema
  .superRefine((design, context) => addDesignIssues(design as unknown as PopupDesign, context))
  .transform((design) => canonicalPopupDesign(design as unknown as PopupDesign));

/** Leitura do banco: design valido da versao 1, ou null (Padrão) para nulo, invalido ou de outra versao. */
export function parsePopupDesign(value: unknown): PopupDesign | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = popupDesignSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

export type PopupDesignContent = {
  allowSnooze: boolean;
  audio: unknown;
  cta: unknown;
  image: unknown;
};

/**
 * O design e o conteudo do aviso andam juntos (o rascunho do pop-up confere ao salvar e ao publicar): o botao
 * principal existe se e so se ha `cta`; o bloco Áudio se e so se ha audio; imagem no topo ou capa do video
 * pedem a imagem do aviso; o segundo botao "Lembrar depois" pede o "Lembrar depois" ligado.
 */
export function popupDesignContentProblems(design: PopupDesign, content: PopupDesignContent): { message: string; path: (number | string)[] }[] {
  const problems: { message: string; path: (number | string)[] }[] = [];
  const buttonIndex = design.blocks.findIndex((block) => block.type === "button");
  const audioIndex = design.blocks.findIndex((block) => block.type === "audio");
  const snoozeIndex = design.blocks.findIndex((block) => block.type === "button2" && block.action.kind === "snooze");

  if (content.cta && buttonIndex === -1) {
    problems.push({ message: POPUP_DESIGN_MESSAGES.ctaWithoutButton, path: ["design", "blocks"] });
  }

  if (!content.cta && buttonIndex !== -1) {
    problems.push({ message: POPUP_DESIGN_MESSAGES.buttonWithoutCta, path: ["cta", "label"] });
  }

  if (content.audio && audioIndex === -1) {
    problems.push({ message: POPUP_DESIGN_MESSAGES.audioWithoutBlock, path: ["design", "blocks"] });
  }

  if (!content.audio && audioIndex !== -1) {
    problems.push({ message: POPUP_DESIGN_MESSAGES.audioBlockWithoutAudio, path: ["audio"] });
  }

  if (design.media.kind === "image" && !content.image) {
    problems.push({ message: POPUP_DESIGN_MESSAGES.imageForMedia, path: ["image"] });
  }

  if (design.media.kind === "video" && !content.image) {
    problems.push({ message: POPUP_DESIGN_MESSAGES.imageForVideo, path: ["image"] });
  }

  if (snoozeIndex !== -1 && !content.allowSnooze) {
    problems.push({ message: POPUP_DESIGN_MESSAGES.snoozeButtonOff, path: ["design", "blocks", snoozeIndex, "action"] });
  }

  return problems;
}
