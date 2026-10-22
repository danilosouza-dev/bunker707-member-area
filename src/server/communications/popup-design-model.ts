// Design do pop-up (Comunicacao, "Design do pop-up": docs/26): o pop-up "Personalizado" que a equipe monta
// no editor (midia com video ou imagem que some num degrade, selo, titulo de 1 a 4 linhas com cor ou degrade
// em cada uma, texto, botoes com estilo livre, fontes enviadas) e o aluno ve com texto de verdade. "Padrão" =
// campaigns.popup_design nulo (o visual de antes, sem mudar nada). A notificacao do sino nunca tem design.
//
// Modulo puro e SEM zod (o desenho do aluno importa daqui e entra so no pedaco da janela do pop-up, que nao
// pode levar o zod junto): tipos, limites, fontes prontas, modelos para comecar, forma canonica, contraste
// (WCAG AA), a escala do cartao (container query) e os valores CSS montados a partir de cores e numeros ja
// validados. O schema zod (salvar e ler) mora em popup-design-schema.ts. Nada aqui aceita CSS ou HTML do
// produtor: so cores #RRGGBB/#RRGGBBAA, numeros com limite e escolhas de lista.
//
// Tamanhos: todo numero em px (fonte, respiro, cantos, espaco entre blocos, espacador, altura do botao) vale
// para o cartao na largura escolhida (P 360, M 440, G 520). Num cartao mais estreito (celular), tudo encolhe
// na mesma proporcao pelas unidades cqw do proprio cartao, com um piso de leitura (fonte nunca abaixo de 12 px;
// botao M/G nunca abaixo de 44 px de altura). A previa do admin usa o mesmo cartao, entao encolhe igual.

import { isSafeHeroCtaHref } from "../member-area/home-hero-links";

export const POPUP_DESIGN_VERSION = 1 as const;

/** Cor: #RRGGBB ou #RRGGBBAA (a forma canonica e minuscula). */
export const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export type HexColor = string;

/* ------------------------------------------------------------------------------------------------
 * Limites e listas
 * ---------------------------------------------------------------------------------------------- */

export const POPUP_CARD_WIDTHS = { L: 520, M: 440, S: 360 } as const;
export type PopupCardWidth = keyof typeof POPUP_CARD_WIDTHS;
export const POPUP_CARD_WIDTH_KEYS = ["S", "M", "L"] as const satisfies readonly PopupCardWidth[];

export const POPUP_DESIGN_LIMITS = {
  angle: { max: 360, min: 0 },
  badgeText: 32,
  blocks: 12,
  borderWidth: { max: 4, min: 0 },
  button2Label: 30,
  buttonRadius: { max: 999, min: 0 },
  cardPadding: { max: 48, min: 12 },
  cardRadius: { max: 40, min: 0 },
  fadeHeight: { max: 100, min: 10 },
  fontSize: { max: 96, min: 10 },
  gap: { max: 48, min: 0 },
  headingLine: 60,
  headingLines: 4,
  letterSpacing: { max: 0.5, min: -0.1 },
  lineHeight: { max: 2, min: 0.8 },
  overlap: { max: 60, min: 0 },
  spacer: { max: 96, min: 4 },
  text: 300,
  /** Fontes enviadas diferentes num mesmo design (cada uma e um download do aluno). */
  uploadedFonts: 4
} as const;

/** Piso de leitura da fonte no celular (px reais). */
export const POPUP_DESIGN_MIN_FONT_PX = 12;
/** Piso da altura do botao no celular (px reais): 44 px de toque nos tamanhos M e G. */
export const POPUP_DESIGN_MIN_BUTTON_PX = 44;

export const POPUP_FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type PopupFontWeight = (typeof POPUP_FONT_WEIGHTS)[number];

export const POPUP_MEDIA_KINDS = ["none", "image", "video"] as const;
export type PopupMediaKind = (typeof POPUP_MEDIA_KINDS)[number];
export const POPUP_MEDIA_ASPECTS = ["16:9", "4:3", "1:1"] as const;
export type PopupMediaAspect = (typeof POPUP_MEDIA_ASPECTS)[number];
/** Altura da midia sobre a largura do cartao. */
export const POPUP_MEDIA_RATIOS: Record<PopupMediaAspect, number> = { "16:9": 9 / 16, "1:1": 1, "4:3": 3 / 4 };
export const POPUP_MEDIA_POSITIONS = ["top", "center", "bottom"] as const;
export type PopupMediaPosition = (typeof POPUP_MEDIA_POSITIONS)[number];

export const POPUP_TEXT_PLACEMENTS = ["below", "over-top", "over-middle", "over-bottom"] as const;
export type PopupTextPlacement = (typeof POPUP_TEXT_PLACEMENTS)[number];
export const POPUP_ALIGNS = ["left", "center", "right"] as const;
export type PopupAlign = (typeof POPUP_ALIGNS)[number];
export const POPUP_TEXT_ALIGNS = ["inherit", ...POPUP_ALIGNS] as const;
export type PopupTextAlign = (typeof POPUP_TEXT_ALIGNS)[number];

export const POPUP_CARD_SHADOWS = ["none", "soft", "strong"] as const;
export type PopupCardShadow = (typeof POPUP_CARD_SHADOWS)[number];
export const POPUP_BUTTON_SIZES = ["S", "M", "L"] as const;
export type PopupButtonSize = (typeof POPUP_BUTTON_SIZES)[number];
export const POPUP_BUTTON_WIDTHS = ["fit", "full"] as const;
export type PopupButtonWidth = (typeof POPUP_BUTTON_WIDTHS)[number];

/** Medidas do botao no tamanho do cartao: altura, fonte e respiro dos lados. */
export const POPUP_BUTTON_METRICS: Record<PopupButtonSize, { fontSize: number; height: number; paddingX: number }> = {
  L: { fontSize: 17, height: 52, paddingX: 24 },
  M: { fontSize: 15, height: 44, paddingX: 20 },
  S: { fontSize: 14, height: 36, paddingX: 16 }
};

/** Medidas do selo no tamanho do cartao (a fonte vem do estilo do selo). */
export const POPUP_BADGE_PADDING = { x: 12, y: 5 } as const;

export const POPUP_BLOCK_TYPES = ["badge", "heading", "text", "button", "button2", "audio", "spacer"] as const;
export type PopupBlockType = (typeof POPUP_BLOCK_TYPES)[number];
/** Blocos que aparecem no maximo uma vez. */
export const POPUP_SINGLE_BLOCKS = ["button", "button2", "audio"] as const satisfies readonly PopupBlockType[];
export const POPUP_BLOCK_ID_PATTERN = /^[a-z0-9]{1,12}$/;

export const POPUP_BUTTON2_ACTIONS = ["close", "snooze", "link"] as const;
export type PopupButton2ActionKind = (typeof POPUP_BUTTON2_ACTIONS)[number];

/* ------------------------------------------------------------------------------------------------
 * Fontes
 * ---------------------------------------------------------------------------------------------- */

const SYSTEM_SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Fontes prontas: as do app (Inter e Exo 2 pelo next/font do layout raiz, variaveis no <body>) e pilhas do
 * sistema. Nada e baixado do Google na hora (privacidade): quem quiser outra fonte baixa o arquivo e envia.
 * `weights`: os pesos que existem de verdade (Exo 2 so 500 a 700 no layout); fora deles o navegador imita.
 */
export const POPUP_BUILTIN_FONTS = {
  condensed: {
    label: "Condensada",
    stack: '"Arial Narrow", "Roboto Condensed", "Sofia Sans Condensed", sans-serif-condensed, Impact, sans-serif',
    stretch: "condensed",
    weights: POPUP_FONT_WEIGHTS
  },
  exo2: { label: "Exo 2", stack: `var(--font-exo-2), ${SYSTEM_SANS}`, stretch: "normal", weights: [500, 600, 700] },
  inter: { label: "Inter", stack: `var(--font-inter), ${SYSTEM_SANS}`, stretch: "normal", weights: POPUP_FONT_WEIGHTS },
  mono: { label: "Monoespaçada", stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace', stretch: "normal", weights: [400, 700] },
  serif: { label: "Serifada", stack: 'Georgia, "Times New Roman", Times, serif', stretch: "normal", weights: [400, 700] },
  system: { label: "Do sistema", stack: SYSTEM_SANS, stretch: "normal", weights: POPUP_FONT_WEIGHTS }
} as const satisfies Record<string, { label: string; stack: string; stretch: "condensed" | "normal"; weights: readonly PopupFontWeight[] }>;
export type PopupBuiltinFont = keyof typeof POPUP_BUILTIN_FONTS;
export const POPUP_BUILTIN_FONT_KEYS = ["inter", "exo2", "system", "condensed", "serif", "mono"] as const satisfies readonly PopupBuiltinFont[];

/** Formato do arquivo da fonte enviada (o nome do format() do CSS). */
export const POPUP_FONT_FORMATS = ["woff2", "woff", "truetype", "opentype"] as const;
export type PopupFontFormat = (typeof POPUP_FONT_FORMATS)[number];
export const POPUP_FONT_STYLES = ["normal", "italic"] as const;
export type PopupFontStyle = (typeof POPUP_FONT_STYLES)[number];
/** Nome da familia de uma fonte enviada (communication_fonts.family_key): nunca o nome do produtor. */
export const POPUP_FONT_FAMILY_PATTERN = /^bf_[a-f0-9]{12}$/;

export const POPUP_FONT_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  /** Fontes na biblioteca (nao excluidas). */
  maxLibrary: 40,
  name: 60
} as const;

/** Fonte enviada, resolvida no servidor (o navegador nunca le a tabela): o que o FontFace precisa. */
export type PopupFontFace = {
  family: string;
  format: PopupFontFormat;
  id: string;
  style: PopupFontStyle;
  url: string;
  weight: number;
};

/** Uma fonte da biblioteca (seletor e dialogo de envio do editor). */
export type PopupFontOption = PopupFontFace & { createdAt: string; name: string; sizeBytes: number };

export type PopupFontRef = { key: PopupBuiltinFont; kind: "builtin" } | { id: string; kind: "uploaded" };

/* ------------------------------------------------------------------------------------------------
 * Storage (videos e fontes ficam no Supabase Storage, nunca no servidor do app)
 * ---------------------------------------------------------------------------------------------- */

export const POPUP_VIDEO_BUCKET = "communication-popup-video";
export const POPUP_FONTS_BUCKET = "communication-fonts";
export const POPUP_VIDEO_MIME_TYPES = ["video/mp4", "video/webm"] as const;
export type PopupVideoMimeType = (typeof POPUP_VIDEO_MIME_TYPES)[number];
export const POPUP_VIDEO_LIMITS = { maxBytes: 15 * 1024 * 1024 } as const;
/** Caminho do video no bucket: videos/<uuid>.<mp4|webm>. */
export const POPUP_VIDEO_PATH_PATTERN = /^videos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:mp4|webm)$/;
/** Caminho da fonte no bucket: fonts/<24 hex do sha256>.<woff2|woff|ttf|otf>. */
export const POPUP_FONT_PATH_PATTERN = /^fonts\/[a-f0-9]{24}\.(?:woff2|woff|ttf|otf)$/;

/**
 * Envio do video direto do navegador ao Storage (o arquivo nunca passa pelo servidor do app nem pelo limite
 * de corpo das Server Actions): startPopupVideoUpload devolve o endereco assinado; o navegador envia; e
 * finishPopupVideoUpload confere tamanho e primeiros bytes e devolve o PopupVideo (ou apaga o objeto).
 */
export type PopupVideoUploadTicket = { path: string; signedUrl: string; token: string };

/** Caminho publico de um objeto do Storage (sem a origem). */
export function storagePublicPath(bucket: string, objectPath: string) {
  return `/storage/v1/object/public/${bucket}/${objectPath}`;
}

/**
 * O endereco aponta para o objeto `objectPath` do bucket publico `bucket` (https; http so no Supabase da
 * propria maquina) e, com `origin`, para a origem do nosso Supabase. Sem usuario/senha, query ou fragmento.
 */
export function isOwnStorageUrl(value: string, input: { bucket: string; objectPath: string; origin?: string | null }) {
  try {
    const url = new URL(value);
    const loopback = url.protocol === "http:" && /^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);

    if ((url.protocol !== "https:" && !loopback) || url.username || url.password || url.search || url.hash) {
      return false;
    }

    if (input.origin && url.origin !== input.origin) {
      return false;
    }

    return url.pathname === storagePublicPath(input.bucket, input.objectPath);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Tipos do design (versao 1)
 * ---------------------------------------------------------------------------------------------- */

export type PopupPaint = { color: HexColor; kind: "solid" } | { angle: number; from: HexColor; kind: "gradient"; to: HexColor };
export type PopupBorder = { color: HexColor; width: number };

export type PopupTextStyle = {
  /** inherit = o alinhamento da zona de texto. */
  align: PopupTextAlign;
  font: PopupFontRef;
  /** em (-0,1 a 0,5). */
  letterSpacing: number;
  /** Multiplicador (0,8 a 2). */
  lineHeight: number;
  paint: PopupPaint;
  /** px no tamanho do cartao (10 a 96). */
  size: number;
  uppercase: boolean;
  weight: PopupFontWeight;
};

export type PopupButtonStyle = {
  background: PopupPaint;
  border: PopupBorder;
  font: PopupFontRef;
  /** Brilho em volta (sombra colorida); null = sem. */
  glow: HexColor | null;
  letterSpacing: number;
  /** 0 a 999 px (999 = pilula). */
  radius: number;
  size: PopupButtonSize;
  textColor: HexColor;
  uppercase: boolean;
  weight: PopupFontWeight;
  width: PopupButtonWidth;
};

export type PopupHeadingLine = {
  /** null = a cor do estilo do titulo. */
  paint: PopupPaint | null;
  /** null = o tamanho do estilo do titulo. */
  size: number | null;
  text: string;
};

export type PopupBadgeBlock = { background: PopupPaint; border: PopupBorder; id: string; radius: number; style: PopupTextStyle; text: string; type: "badge" };
export type PopupHeadingBlock = { id: string; lines: PopupHeadingLine[]; style: PopupTextStyle; type: "heading" };
export type PopupTextBlock = { id: string; style: PopupTextStyle; text: string; type: "text" };
/** Botao principal: o texto e o destino sao o `cta` do aviso (mesma validacao e o mesmo clique contado). */
export type PopupButtonBlock = { id: string; style: PopupButtonStyle; type: "button" };
export type PopupButton2Action = { kind: "close" } | { kind: "snooze" } | { href: string; kind: "link"; target: "new_tab" | "same_tab" };
/** Segundo botao: Fechar, Lembrar depois ou abrir um link (o link conta como o clique, como o botao principal). */
export type PopupButton2Block = { action: PopupButton2Action; id: string; label: string; style: PopupButtonStyle; type: "button2" };
/** O player do audio do aviso (o audio continua no campo Áudio). */
export type PopupAudioBlock = { id: string; type: "audio" };
export type PopupSpacerBlock = { height: number; id: string; type: "spacer" };

export type PopupBlock = PopupAudioBlock | PopupBadgeBlock | PopupButton2Block | PopupButtonBlock | PopupHeadingBlock | PopupSpacerBlock | PopupTextBlock;

export type PopupVideo = { mimeType: PopupVideoMimeType; path: string; url: string };

export type PopupMedia = {
  aspect: PopupMediaAspect;
  /** Degrade da midia para o fundo do cartao: altura em % da midia e a cor ("auto" = o fundo do cartao). */
  fade: { color: HexColor | "auto"; enabled: boolean; height: number };
  /** image = a imagem do aviso; video = o video (a imagem do aviso e a capa dele). */
  kind: PopupMediaKind;
  /** Recorte da midia (object-position). */
  position: PopupMediaPosition;
  /** Fica guardado ao trocar para imagem; obrigatorio com kind "video". */
  video: PopupVideo | null;
};

export type PopupTextZone = {
  align: PopupAlign;
  /** px entre os blocos. */
  gap: number;
  /** "Abaixo": quanto o texto sobe por cima da midia (% da altura da midia). */
  overlap: number;
  placement: PopupTextPlacement;
};

export type PopupCardStyle = {
  background: PopupPaint;
  border: PopupBorder;
  padding: number;
  radius: number;
  shadow: PopupCardShadow;
  width: PopupCardWidth;
};

export type PopupDesign = {
  blocks: PopupBlock[];
  card: PopupCardStyle;
  /** O X: cor do icone e do fundo (36 px visiveis, 44 px de toque, nunca muda). */
  close: { background: HexColor; color: HexColor };
  /** Ids das fontes enviadas usadas (derivado: ordenado e sem repeticao; o servidor recalcula ao salvar). */
  fonts: string[];
  /** "Lembrar depois" e "Não mostrar de novo". */
  links: { color: HexColor };
  media: PopupMedia;
  text: PopupTextZone;
  version: typeof POPUP_DESIGN_VERSION;
};

/* ------------------------------------------------------------------------------------------------
 * Forma canonica
 * ---------------------------------------------------------------------------------------------- */

function round(value: number, digits: number) {
  const factor = 10 ** digits;

  return Math.round(value * factor) / factor;
}

function hex(value: HexColor) {
  return value.toLowerCase();
}

function canonicalPaint(paint: PopupPaint): PopupPaint {
  return paint.kind === "solid"
    ? { color: hex(paint.color), kind: "solid" }
    : { angle: Math.round(paint.angle), from: hex(paint.from), kind: "gradient", to: hex(paint.to) };
}

function canonicalFont(font: PopupFontRef): PopupFontRef {
  return font.kind === "builtin" ? { key: font.key, kind: "builtin" } : { id: font.id.toLowerCase(), kind: "uploaded" };
}

function canonicalBorder(border: PopupBorder): PopupBorder {
  return { color: hex(border.color), width: Math.round(border.width) };
}

function canonicalTextStyle(style: PopupTextStyle): PopupTextStyle {
  return {
    align: style.align,
    font: canonicalFont(style.font),
    letterSpacing: round(style.letterSpacing, 2),
    lineHeight: round(style.lineHeight, 2),
    paint: canonicalPaint(style.paint),
    size: Math.round(style.size),
    uppercase: style.uppercase,
    weight: style.weight
  };
}

function canonicalButtonStyle(style: PopupButtonStyle): PopupButtonStyle {
  return {
    background: canonicalPaint(style.background),
    border: canonicalBorder(style.border),
    font: canonicalFont(style.font),
    glow: style.glow === null ? null : hex(style.glow),
    letterSpacing: round(style.letterSpacing, 2),
    radius: Math.round(style.radius),
    size: style.size,
    textColor: hex(style.textColor),
    uppercase: style.uppercase,
    weight: style.weight,
    width: style.width
  };
}

function canonicalBlock(block: PopupBlock): PopupBlock {
  switch (block.type) {
    case "badge":
      return {
        background: canonicalPaint(block.background),
        border: canonicalBorder(block.border),
        id: block.id,
        radius: Math.round(block.radius),
        style: canonicalTextStyle(block.style),
        text: block.text.trim(),
        type: "badge"
      };
    case "heading":
      return {
        id: block.id,
        lines: block.lines.map((line) => ({
          paint: line.paint === null ? null : canonicalPaint(line.paint),
          size: line.size === null ? null : Math.round(line.size),
          text: line.text.trim()
        })),
        style: canonicalTextStyle(block.style),
        type: "heading"
      };
    case "text":
      return { id: block.id, style: canonicalTextStyle(block.style), text: block.text.trim(), type: "text" };
    case "button":
      return { id: block.id, style: canonicalButtonStyle(block.style), type: "button" };
    case "button2":
      return {
        action: block.action.kind === "link" ? { href: block.action.href.trim(), kind: "link", target: block.action.target } : { kind: block.action.kind },
        id: block.id,
        label: block.label.trim(),
        style: canonicalButtonStyle(block.style),
        type: "button2"
      };
    case "spacer":
      return { height: Math.round(block.height), id: block.id, type: "spacer" };
    case "audio":
      return { id: block.id, type: "audio" };
  }
}

function fontRefsOfBlock(block: PopupBlock): PopupFontRef[] {
  return block.type === "audio" || block.type === "spacer" ? [] : [block.style.font];
}

/** Ids das fontes enviadas usadas pelos blocos (ordenados, sem repeticao). */
export function uploadedFontIdsOf(blocks: readonly PopupBlock[]): string[] {
  const ids = new Set<string>();

  for (const block of blocks) {
    for (const font of fontRefsOfBlock(block)) {
      if (font.kind === "uploaded") {
        ids.add(font.id.toLowerCase());
      }
    }
  }

  return [...ids].sort();
}

/**
 * Forma canonica (o que o servidor grava e o editor compara para "mudancas nao salvas"): cores minusculas,
 * textos aparados, numeros arredondados e `fonts` recalculado a partir dos blocos.
 */
export function canonicalPopupDesign(design: PopupDesign): PopupDesign {
  const blocks = design.blocks.map(canonicalBlock);

  return {
    blocks,
    card: {
      background: canonicalPaint(design.card.background),
      border: canonicalBorder(design.card.border),
      padding: Math.round(design.card.padding),
      radius: Math.round(design.card.radius),
      shadow: design.card.shadow,
      width: design.card.width
    },
    close: { background: hex(design.close.background), color: hex(design.close.color) },
    fonts: uploadedFontIdsOf(blocks),
    links: { color: hex(design.links.color) },
    media: {
      aspect: design.media.aspect,
      fade: {
        color: design.media.fade.color === "auto" ? "auto" : hex(design.media.fade.color),
        enabled: design.media.fade.enabled,
        height: Math.round(design.media.fade.height)
      },
      kind: design.media.kind,
      position: design.media.position,
      video: design.media.video ? { mimeType: design.media.video.mimeType, path: design.media.video.path, url: design.media.video.url.trim() } : null
    },
    text: {
      align: design.text.align,
      gap: Math.round(design.text.gap),
      overlap: Math.round(design.text.overlap),
      placement: design.text.placement
    },
    version: POPUP_DESIGN_VERSION
  };
}

/* ------------------------------------------------------------------------------------------------
 * Blocos novos, modelos para comecar e sincronia com o conteudo do aviso
 * ---------------------------------------------------------------------------------------------- */

/** Id curto de bloco que ainda nao existe no design (b1, b2...). */
export function nextPopupBlockId(blocks: readonly Pick<PopupBlock, "id">[]): string {
  const taken = new Set(blocks.map((block) => block.id));
  let index = blocks.length + 1;

  while (taken.has(`b${index}`)) {
    index += 1;
  }

  return `b${index}`;
}

const solid = (color: HexColor): PopupPaint => ({ color, kind: "solid" });
const inter: PopupFontRef = { key: "inter", kind: "builtin" };

function textStyle(input: Partial<PopupTextStyle> & Pick<PopupTextStyle, "paint" | "size">): PopupTextStyle {
  return { align: "inherit", font: inter, letterSpacing: 0, lineHeight: 1.4, uppercase: false, weight: 400, ...input };
}

/** Estilo inicial do botao (o principal e o segundo comecam iguais ao modelo escolhido). */
export function defaultPopupButtonStyle(input: Partial<PopupButtonStyle> = {}): PopupButtonStyle {
  return {
    background: solid("#e50914"),
    border: { color: "#ffffff00", width: 0 },
    font: inter,
    glow: null,
    letterSpacing: 0,
    radius: 999,
    size: "L",
    textColor: "#ffffff",
    uppercase: false,
    weight: 700,
    width: "full",
    ...input
  };
}

/** Bloco novo de cada tipo (o editor acrescenta no fim; o design passa a ter o bloco com estes valores). */
export function newPopupBlock(type: PopupBlockType, id: string, base?: PopupDesign): PopupBlock {
  const button = base?.blocks.find((block): block is PopupButtonBlock => block.type === "button");

  switch (type) {
    case "badge":
      return {
        background: solid("#ffffff1f"),
        border: { color: "#ffffff00", width: 0 },
        id,
        radius: 999,
        style: textStyle({ letterSpacing: 0.04, lineHeight: 1.2, paint: solid("#ffffff"), size: 12, uppercase: true, weight: 700 }),
        text: "Novidade",
        type: "badge"
      };
    case "heading":
      return {
        id,
        lines: [{ paint: null, size: null, text: "Seu título aqui" }],
        style: textStyle({ lineHeight: 1.1, paint: solid("#ffffff"), size: 28, weight: 800 }),
        type: "heading"
      };
    case "text":
      return { id, style: textStyle({ lineHeight: 1.5, paint: solid("#d4d4d8"), size: 15 }), text: "Escreva aqui o texto do pop-up.", type: "text" };
    case "button":
      return { id, style: button?.style ?? defaultPopupButtonStyle(), type: "button" };
    case "button2":
      return {
        action: { kind: "close" },
        id,
        label: "Agora não",
        style: defaultPopupButtonStyle({ background: solid("#ffffff00"), border: { color: "#ffffff40", width: 1 }, size: "M" }),
        type: "button2"
      };
    case "audio":
      return { id, type: "audio" };
    case "spacer":
      return { height: 16, id, type: "spacer" };
  }
}

export const POPUP_DESIGN_STARTERS = [
  {
    description: "Vídeo ou imagem em cima, sumindo no fundo do cartão, com o texto logo abaixo.",
    id: "media_top_fade",
    label: "Mídia no topo com degradê"
  },
  { description: "Sem mídia: selo, título, texto e botão sobre um fundo em degradê.", id: "text_only", label: "Só texto" },
  { description: "A mídia ocupa o cartão e o texto fica por cima, na parte de baixo.", id: "media_overlay", label: "Texto sobre a mídia" }
] as const;
export type PopupDesignStarterId = (typeof POPUP_DESIGN_STARTERS)[number]["id"];

const STARTER_CLOSE = { background: "#00000099", color: "#ffffff" } as const;

/**
 * Design de um modelo para comecar (textos neutros em portugues; tudo editavel depois). O botao principal
 * vem incluido: o editor, ao escolher o modelo num pop-up sem botao, cria o `cta` com o texto "Saiba mais" e o
 * destino vazio (o produtor escolhe para onde leva). O bloco Áudio entra quando o aviso tem audio. Os modelos
 * com midia comecam com a imagem do aviso; `video` (o que ja estava no design) mantem o video escolhido.
 */
export function popupStarterDesign(id: PopupDesignStarterId, input: { hasAudio?: boolean; video?: PopupVideo | null } = {}): PopupDesign {
  const audio: PopupBlock[] = input.hasAudio ? [{ id: "b9", type: "audio" }] : [];
  const video = input.video ?? null;

  if (id === "text_only") {
    return canonicalPopupDesign({
      blocks: [
        {
          background: solid("#a78bfa33"),
          border: { color: "#a78bfa80", width: 1 },
          id: "b1",
          radius: 999,
          style: textStyle({ letterSpacing: 0.06, lineHeight: 1.2, paint: solid("#e9ddff"), size: 12, uppercase: true, weight: 700 }),
          text: "Novidade",
          type: "badge"
        },
        {
          id: "b2",
          lines: [{ paint: null, size: null, text: "Conteúdo novo na sua área" }],
          style: textStyle({ lineHeight: 1.15, paint: solid("#ffffff"), size: 30, weight: 800 }),
          type: "heading"
        },
        {
          id: "b3",
          style: textStyle({ lineHeight: 1.5, paint: solid("#d4d4d8"), size: 15 }),
          text: "Uma aula nova acabou de entrar. Assista agora e coloque em prática ainda hoje.",
          type: "text"
        },
        ...audio,
        { id: "b4", style: defaultPopupButtonStyle({ background: solid("#ffffff"), textColor: "#18181b" }), type: "button" }
      ],
      card: {
        background: { angle: 160, from: "#2a1a5e", kind: "gradient", to: "#0b0b12" },
        border: { color: "#ffffff1a", width: 1 },
        padding: 28,
        radius: 24,
        shadow: "strong",
        width: "M"
      },
      close: { background: "#ffffff14", color: "#ffffff" },
      fonts: [],
      links: { color: "#a1a1aa" },
      media: { aspect: "16:9", fade: { color: "auto", enabled: false, height: 60 }, kind: "none", position: "center", video },
      text: { align: "left", gap: 14, overlap: 0, placement: "below" },
      version: POPUP_DESIGN_VERSION
    });
  }

  if (id === "media_overlay") {
    return canonicalPopupDesign({
      blocks: [
        {
          id: "b2",
          lines: [{ paint: null, size: null, text: "Sua próxima aula já está aqui" }],
          style: textStyle({ lineHeight: 1.1, paint: solid("#ffffff"), size: 30, weight: 800 }),
          type: "heading"
        },
        {
          id: "b3",
          style: textStyle({ lineHeight: 1.5, paint: solid("#e4e4e7"), size: 15 }),
          text: "Continue de onde parou e termine o módulo esta semana.",
          type: "text"
        },
        ...audio,
        { id: "b4", style: defaultPopupButtonStyle({ background: solid("#ffffff"), textColor: "#18181b" }), type: "button" }
      ],
      card: { background: solid("#101014"), border: { color: "#ffffff1a", width: 1 }, padding: 24, radius: 24, shadow: "strong", width: "M" },
      close: STARTER_CLOSE,
      fonts: [],
      links: { color: "#a1a1aa" },
      media: { aspect: "4:3", fade: { color: "auto", enabled: true, height: 75 }, kind: video ? "video" : "image", position: "center", video },
      text: { align: "left", gap: 12, overlap: 0, placement: "over-bottom" },
      version: POPUP_DESIGN_VERSION
    });
  }

  // "Mídia no topo com degradê": a estrutura da referencia (midia em cima sumindo no fundo escuro, selo por
  // cima do degrade, titulo condensado em duas linhas de cores diferentes, texto cinza e botao pilula).
  return canonicalPopupDesign({
    blocks: [
      {
        background: solid("#ff4fa3"),
        border: { color: "#ffffff00", width: 0 },
        id: "b1",
        radius: 999,
        style: textStyle({ letterSpacing: 0.02, lineHeight: 1.2, paint: solid("#16181c"), size: 13, weight: 700 }),
        text: "Novidade",
        type: "badge"
      },
      {
        id: "b2",
        lines: [
          { paint: solid("#e0ff3a"), size: null, text: "Conteúdo novo" },
          { paint: null, size: null, text: "Já disponível" }
        ],
        style: textStyle({
          align: "inherit",
          font: { key: "condensed", kind: "builtin" },
          lineHeight: 0.95,
          paint: solid("#ffffff"),
          size: 40,
          uppercase: true,
          weight: 800
        }),
        type: "heading"
      },
      {
        id: "b3",
        style: textStyle({ lineHeight: 1.5, paint: solid("#a1a1aa"), size: 15 }),
        text: "Uma aula nova acabou de entrar na sua área. Assista agora e coloque em prática ainda hoje.",
        type: "text"
      },
      ...audio,
      { id: "b4", style: defaultPopupButtonStyle({ background: solid("#e0ff3a"), glow: "#e0ff3a40", size: "M", textColor: "#16181c", width: "fit" }), type: "button" }
    ],
    card: { background: solid("#16181c"), border: { color: "#ffffff1a", width: 1 }, padding: 24, radius: 24, shadow: "strong", width: "M" },
    close: STARTER_CLOSE,
    fonts: [],
    links: { color: "#a1a1aa" },
    // Subir 28 % com degrade de 65 %: o selo fica dentro do degrade e o titulo comeca onde a midia some (Z, docs/26).
    media: { aspect: "16:9", fade: { color: "auto", enabled: true, height: 65 }, kind: video ? "video" : "image", position: "center", video },
    text: { align: "center", gap: 12, overlap: 28, placement: "below" },
    version: POPUP_DESIGN_VERSION
  });
}

/**
 * Deixa os blocos coerentes com o conteudo do aviso: com botao (`cta`), o bloco do botao principal existe (no
 * fim, se faltava); sem botao, sai. Com audio, o bloco Áudio existe (antes do primeiro botao, se faltava); sem
 * audio, sai. O editor chama quando o botao ou o audio mudam no modo Personalizado.
 */
export function syncPopupDesignBlocks(design: PopupDesign, content: { hasAudio: boolean; hasCta: boolean }): PopupDesign {
  let blocks = design.blocks;
  const hasButton = blocks.some((block) => block.type === "button");
  const hasAudioBlock = blocks.some((block) => block.type === "audio");

  if (!content.hasCta && hasButton) {
    blocks = blocks.filter((block) => block.type !== "button");
  } else if (content.hasCta && !hasButton && blocks.length < POPUP_DESIGN_LIMITS.blocks) {
    blocks = [...blocks, newPopupBlock("button", nextPopupBlockId(blocks), design)];
  }

  if (!content.hasAudio && hasAudioBlock) {
    blocks = blocks.filter((block) => block.type !== "audio");
  } else if (content.hasAudio && !hasAudioBlock && blocks.length < POPUP_DESIGN_LIMITS.blocks) {
    const audio = newPopupBlock("audio", nextPopupBlockId(blocks));
    const firstButton = blocks.findIndex((block) => block.type === "button" || block.type === "button2");

    blocks = firstButton === -1 ? [...blocks, audio] : [...blocks.slice(0, firstButton), audio, ...blocks.slice(firstButton)];
  }

  return blocks === design.blocks ? design : { ...design, blocks, fonts: uploadedFontIdsOf(blocks) };
}

/* ------------------------------------------------------------------------------------------------
 * Leitura: nome acessivel e o que o aluno ve
 * ---------------------------------------------------------------------------------------------- */

/** O primeiro bloco de titulo (o <h2> e o nome do dialogo); null = sem titulo no design. */
export function popupDesignHeading(design: Pick<PopupDesign, "blocks">): PopupHeadingBlock | null {
  return design.blocks.find((block): block is PopupHeadingBlock => block.type === "heading") ?? null;
}

/** Texto do titulo (linhas juntas por espaco); vazio = sem titulo. */
export function popupDesignHeadingText(design: Pick<PopupDesign, "blocks">): string {
  const heading = popupDesignHeading(design);

  return heading ? heading.lines.map((line) => line.text.trim()).filter(Boolean).join(" ") : "";
}

/**
 * Nome do dialogo: o texto do titulo do design; sem titulo, o titulo do aviso (o nome do pop-up nas listas).
 * `labelledBy` = o dialogo usa aria-labelledby no <h2> do design; senao aria-label com `label`.
 */
export function popupDesignAccessibleName(design: Pick<PopupDesign, "blocks">, title: string): { label: string; labelledBy: boolean } {
  const heading = popupDesignHeadingText(design);

  return heading ? { label: heading, labelledBy: true } : { label: title.trim(), labelledBy: false };
}

/** O primeiro bloco de texto (aria-describedby do dialogo); null = sem texto. */
export function popupDesignDescription(design: Pick<PopupDesign, "blocks">): PopupTextBlock | null {
  return design.blocks.find((block): block is PopupTextBlock => block.type === "text") ?? null;
}

/** O segundo botao com link (conta como o clique do pop-up, como o botao principal). */
export function popupDesignLinkButton(design: Pick<PopupDesign, "blocks"> | null | undefined): PopupButton2Block | null {
  const block = design?.blocks.find((item): item is PopupButton2Block => item.type === "button2");

  return block && block.action.kind === "link" && isSafeHeroCtaHref(block.action.href) ? block : null;
}

/* ------------------------------------------------------------------------------------------------
 * Escala (container query) e valores CSS a partir de valores ja validados
 * ---------------------------------------------------------------------------------------------- */

export function popupCardWidthPx(design: Pick<PopupDesign, "card">): number {
  return POPUP_CARD_WIDTHS[design.card.width] ?? POPUP_CARD_WIDTHS.M;
}

/** Largura do cartao: a escolhida, ou a tela menos 2 rem (celular). Mesmo padrao do cartao Padrão. */
export function popupCardOuterWidth(design: Pick<PopupDesign, "card">): string {
  return `min(${popupCardWidthPx(design)}px, calc(100cqw - 2rem))`;
}

function cqw(px: number, cardWidth: number) {
  return `${round((px / cardWidth) * 100, 4)}cqw`;
}

/**
 * Um comprimento do design (px no tamanho do cartao) em unidades do proprio cartao: encolhe junto no celular.
 * Vale dentro do cartao (o elemento do cartao tem container-type: inline-size).
 */
export function scaledLength(px: number, cardWidth: number): string {
  return px === 0 ? "0px" : cqw(px, cardWidth);
}

/** Igual, com piso em px reais (nunca menor que `floor`, nem maior que o proprio valor). */
export function scaledLengthWithFloor(px: number, cardWidth: number, floor: number): string {
  return `max(${Math.min(px, floor)}px, ${cqw(px, cardWidth)})`;
}

/** Tamanho de fonte com o piso de leitura do celular. */
export function scaledFontSize(px: number, cardWidth: number): string {
  return scaledLengthWithFloor(px, cardWidth, POPUP_DESIGN_MIN_FONT_PX);
}

/** Altura do botao com o piso de toque (44 px nos tamanhos M e G; o P fica com os 36 dele). */
export function scaledButtonHeight(size: PopupButtonSize, cardWidth: number): string {
  return scaledLengthWithFloor(POPUP_BUTTON_METRICS[size].height, cardWidth, POPUP_DESIGN_MIN_BUTTON_PX);
}

/** Cor solida ou degrade linear em CSS (background / background-image). */
export function paintToCss(paint: PopupPaint): string {
  return paint.kind === "solid" ? paint.color : `linear-gradient(${paint.angle}deg, ${paint.from}, ${paint.to})`;
}

/** A primeira cor da pintura (a cor "auto" do degrade da midia e a base do contraste). */
export function paintBaseColor(paint: PopupPaint): HexColor {
  return paint.kind === "solid" ? paint.color : paint.from;
}

/** Cor final do degrade da midia ("auto" = o fundo do cartao). */
export function fadeColorOf(design: Pick<PopupDesign, "card" | "media">): HexColor {
  return design.media.fade.color === "auto" ? paintBaseColor(design.card.background) : design.media.fade.color;
}

/**
 * O degrade por cima da midia (de transparente ate a cor), so a altura escolhida. Paradas suavizadas (35 % da
 * cor na metade, 75 % aos tres quartos): a midia "some" sem a faixa dura que o degrade linear deixa no comeco.
 */
export function fadeGradientCss(design: Pick<PopupDesign, "card" | "media">): string {
  const color = fadeColorOf(design).slice(0, 7);

  return `linear-gradient(180deg, ${color}00 0%, ${color}59 45%, ${color}bf 75%, ${color} 100%)`;
}

/** Pilha de fontes de um texto: a fonte enviada (pela familia resolvida) ou a pronta, sempre com o sistema no fim. */
export function fontStackOf(font: PopupFontRef, faces: readonly Pick<PopupFontFace, "family" | "id">[] = []): string {
  if (font.kind === "builtin") {
    return (POPUP_BUILTIN_FONTS[font.key] ?? POPUP_BUILTIN_FONTS.inter).stack;
  }

  const face = faces.find((item) => item.id === font.id);

  return face && POPUP_FONT_FAMILY_PATTERN.test(face.family) ? `"${face.family}", ${SYSTEM_SANS}` : SYSTEM_SANS;
}

/** font-stretch da fonte (so a Condensada pede condensed). */
export function fontStretchOf(font: PopupFontRef): "condensed" | "normal" {
  return font.kind === "builtin" ? (POPUP_BUILTIN_FONTS[font.key]?.stretch ?? "normal") : "normal";
}

export const POPUP_CARD_SHADOW_CSS: Record<PopupCardShadow, string> = {
  none: "none",
  soft: "0 12px 40px rgba(0, 0, 0, 0.45)",
  strong: "0 24px 80px rgba(0, 0, 0, 0.7)"
};

/* ------------------------------------------------------------------------------------------------
 * Contraste (WCAG AA): dica que nao impede salvar
 * ---------------------------------------------------------------------------------------------- */

type Rgba = { a: number; b: number; g: number; r: number };

function parseHex(value: HexColor): Rgba {
  const text = value.replace("#", "");

  return {
    a: text.length === 8 ? parseInt(text.slice(6, 8), 16) / 255 : 1,
    b: parseInt(text.slice(4, 6), 16),
    g: parseInt(text.slice(2, 4), 16),
    r: parseInt(text.slice(0, 2), 16)
  };
}

function over(top: Rgba, base: Rgba): Rgba {
  const mix = (front: number, back: number) => front * top.a + back * (1 - top.a);

  return { a: 1, b: mix(top.b, base.b), g: mix(top.g, base.g), r: mix(top.r, base.r) };
}

function luminance(color: Rgba) {
  const channel = (value: number) => {
    const c = value / 255;

    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

const BLACK: Rgba = { a: 1, b: 0, g: 0, r: 0 };

/**
 * Razao de contraste entre o texto e o fundo (1 a 21). Cor com transparencia: o fundo vai sobre `base`
 * (padrao: preto, o veu da pagina) e o texto sobre o fundo.
 */
export function contrastRatio(foreground: HexColor, background: HexColor, base: HexColor = "#000000"): number {
  const back = over(parseHex(background), over(parseHex(base), BLACK));
  const front = over(parseHex(foreground), back);
  const [light, dark] = [luminance(front), luminance(back)].sort((left, right) => right - left);

  return (light + 0.05) / (dark + 0.05);
}

/** Texto grande pela WCAG: 24 px, ou 18,66 px em negrito (700+). */
export function isLargeText(size: number, weight: number) {
  return size >= 24 || (size >= 18.66 && weight >= 700);
}

export type PopupContrastHint = {
  /** Bloco do aviso (id) quando a dica e de um bloco; null = links ou X. */
  blockId: string | null;
  /** Onde a dica aparece: "blocks.2", "blocks.1.lines.0", "links" ou "close". */
  key: string;
  message: string;
  ratio: number;
  required: number;
};

function colorsOf(paint: PopupPaint): HexColor[] {
  return paint.kind === "solid" ? [paint.color] : [paint.from, paint.to];
}

function formatRatio(value: number) {
  return (Math.floor(value * 10) / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

export function contrastHintMessage(ratio: number, required: number) {
  return `Contraste baixo (${formatRatio(ratio)}:1). Para ler bem, use pelo menos ${formatRatio(required)}:1.`;
}

/** Cores atras do grupo de texto; null = sobre a midia sem degrade (nao da para medir). */
function textBackdrop(design: PopupDesign): HexColor[] | null {
  const card = colorsOf(design.card.background);

  if (design.media.kind === "none" || design.text.placement === "below") {
    return card;
  }

  return design.media.fade.enabled && design.text.placement === "over-bottom" ? [fadeColorOf(design)] : null;
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

/**
 * Dicas de contraste do design (WCAG AA: 4,5:1 no texto, 3:1 no texto grande e no X). Mede o texto contra o
 * fundo do cartao (ou o degrade quando o texto fica sobre a midia embaixo), o selo e os botoes contra o
 * proprio fundo. Texto sobre a midia sem degrade nao e medido. Nunca impede salvar.
 */
export function popupDesignContrastHints(design: PopupDesign): PopupContrastHint[] {
  const hints: PopupContrastHint[] = [];
  const backdrop = textBackdrop(design);
  const cardBase = paintBaseColor(design.card.background);
  const add = (key: string, blockId: string | null, ratio: number, required: number) => {
    if (ratio < required) {
      hints.push({ blockId, key, message: contrastHintMessage(ratio, required), ratio, required });
    }
  };

  design.blocks.forEach((block, index) => {
    const key = `blocks.${index}`;

    if (block.type === "badge") {
      add(key, block.id, worstRatio(colorsOf(block.style.paint), colorsOf(block.background), cardBase), isLargeText(block.style.size, block.style.weight) ? 3 : 4.5);
    } else if (block.type === "heading" && backdrop) {
      block.lines.forEach((line, lineIndex) => {
        const size = line.size ?? block.style.size;

        add(`${key}.lines.${lineIndex}`, block.id, worstRatio(colorsOf(line.paint ?? block.style.paint), backdrop, cardBase), isLargeText(size, block.style.weight) ? 3 : 4.5);
      });
    } else if (block.type === "text" && backdrop) {
      add(key, block.id, worstRatio(colorsOf(block.style.paint), backdrop, cardBase), isLargeText(block.style.size, block.style.weight) ? 3 : 4.5);
    } else if (block.type === "button" || block.type === "button2") {
      const style = block.style;
      const background = style.background.kind === "solid" && parseHex(style.background.color).a === 0 ? (backdrop ?? [cardBase]) : colorsOf(style.background);

      add(key, block.id, worstRatio([style.textColor], background, cardBase), isLargeText(POPUP_BUTTON_METRICS[style.size].fontSize, style.weight) ? 3 : 4.5);
    }
  });

  add("links", null, worstRatio([design.links.color], colorsOf(design.card.background), "#000000"), 4.5);
  add("close", null, contrastRatio(design.close.color, design.close.background, cardBase), 3);

  return hints;
}
