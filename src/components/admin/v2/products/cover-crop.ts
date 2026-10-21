// Recorte de imagem no cliente (docs/17 §1.6.2 e §2.3): capa 2:3 (WebP ate 720×1080) e imagem de
// destaque 8:3 (WebP 1920×720), ate 150 KB; na Area de membros, imagem lateral do login 4:5
// (WebP 1200×1500) e imagem de fundo do login 16:9 (WebP 1920×1080), ate 250 KB. Modulo puro (sem
// React, sem DOM, sem imports): a geometria do recorte, os limites de zoom e a escolha da qualidade
// ficam aqui e sao testados em tests/admin-products-ui.test.mjs e tests/member-area-foundation.test.mjs;
// o desenho no canvas fica em image-crop-dialog.tsx. As mesmas medidas valem no servidor
// (IMAGE_UPLOAD_SPECS em src/server/catalog/webp.ts); o teste confere que as duas listas batem.

export type ImageSlot = "cover" | "hero" | "loginSide" | "loginBackground" | "notice";

export type CropSpec = {
  /** Nome no texto da tela ("capa", "imagem de destaque"). */
  label: string;
  /** Alvo de tamanho do arquivo final (a qualidade desce ate caber). */
  maxBytes: number;
  /** Teto do texto do data URL aceito pelo servidor para este slot. */
  maxDataUrlLength: number;
  /** Menor origem aceita. Tem a mesma proporcao da saida, entao o recorte base nunca fica abaixo dela. */
  minHeight: number;
  minWidth: number;
  /** Retrato: miniatura ao lado do texto. Paisagem: miniatura na largura toda. */
  orientation: "landscape" | "portrait";
  outputHeight: number;
  outputWidth: number;
  ratioLabel: string;
};

/** Alvo de tamanho do arquivo final (capa e imagem de destaque). */
export const MAX_IMAGE_BYTES = 150 * 1024;
/** Mesmo teto de texto do webpDataUrlSchema (src/server/catalog/schemas.ts). */
export const MAX_IMAGE_DATA_URL_LENGTH = 300_000;
/** Imagens grandes do login: alvo de 250 KB e teto de ~410 KB de arquivo (560 mil caracteres). */
export const MAX_LARGE_IMAGE_BYTES = 250 * 1024;
export const MAX_LARGE_IMAGE_DATA_URL_LENGTH = 560_000;

export const IMAGE_SPECS: Record<ImageSlot, CropSpec> = {
  cover: {
    label: "thumbnail do card",
    maxBytes: MAX_IMAGE_BYTES,
    maxDataUrlLength: MAX_IMAGE_DATA_URL_LENGTH,
    // 2:3 e a proporcao do card do aluno. Minimo baixo (pedido do produtor, 13/10/2026) para testar
    // capas pequenas; imagem menor que a saida sai no tamanho dela, sem ampliar (outputSizeFor).
    minHeight: 426,
    minWidth: 284,
    orientation: "portrait",
    outputHeight: 1080,
    outputWidth: 720,
    ratioLabel: "2:3"
  },
  hero: {
    label: "imagem de destaque",
    maxBytes: MAX_IMAGE_BYTES,
    maxDataUrlLength: MAX_IMAGE_DATA_URL_LENGTH,
    minHeight: 540,
    minWidth: 1440,
    orientation: "landscape",
    outputHeight: 720,
    outputWidth: 1920,
    ratioLabel: "8:3"
  },
  loginBackground: {
    label: "imagem de fundo",
    maxBytes: MAX_LARGE_IMAGE_BYTES,
    maxDataUrlLength: MAX_LARGE_IMAGE_DATA_URL_LENGTH,
    minHeight: 720,
    minWidth: 1280,
    orientation: "landscape",
    outputHeight: 1080,
    outputWidth: 1920,
    ratioLabel: "16:9"
  },
  loginSide: {
    label: "imagem lateral",
    maxBytes: MAX_LARGE_IMAGE_BYTES,
    maxDataUrlLength: MAX_LARGE_IMAGE_DATA_URL_LENGTH,
    minHeight: 1000,
    minWidth: 800,
    orientation: "portrait",
    outputHeight: 1500,
    outputWidth: 1200,
    ratioLabel: "4:5"
  },
  // Imagem dos avisos (Comunicacao: notificacao no sino e pop-up na home), 16:9 como a previa do aluno.
  notice: {
    label: "imagem do aviso",
    maxBytes: MAX_LARGE_IMAGE_BYTES,
    maxDataUrlLength: MAX_LARGE_IMAGE_DATA_URL_LENGTH,
    minHeight: 540,
    minWidth: 960,
    orientation: "landscape",
    outputHeight: 720,
    outputWidth: 1280,
    ratioLabel: "16:9"
  }
};

/**
 * Tamanho final do arquivo: o da saida do slot ou, quando o recorte tem menos pixels que ela, o do
 * proprio recorte na mesma proporcao. Nunca amplia (ampliar so borra).
 */
export function outputSizeFor(rect: { width: number }, spec: Pick<CropSpec, "outputHeight" | "outputWidth">) {
  const scale = Math.min(1, rect.width / spec.outputWidth);

  return {
    height: Math.max(1, Math.round(spec.outputHeight * scale)),
    width: Math.max(1, Math.round(spec.outputWidth * scale))
  };
}

/** Proporcao CSS (aspect-ratio) da saida, ex.: "720 / 1080". */
export function aspectRatioOf(spec: Pick<CropSpec, "outputHeight" | "outputWidth">) {
  return `${spec.outputWidth} / ${spec.outputHeight}`;
}
/** Arquivo de origem: acima disso o navegador sofre para decodificar e nao ganha nada. */
export const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024;
/** Qualidade inicial 0,82, reduzindo ate caber em 150 KB. */
export const WEBP_QUALITY_STEPS = [0.82, 0.76, 0.7, 0.64, 0.58, 0.52, 0.46] as const;
/** Zoom maximo mesmo em imagens enormes (mais que isso vira um recorte de detalhe sem sentido). */
export const MAX_ZOOM_CAP = 4;

export type SourceSize = { height: number; width: number };
export type CropState = { centerX: number; centerY: number; zoom: number };
export type CropRect = { height: number; width: number; x: number; y: number };

function formatPixels(width: number, height: number) {
  return `${Math.round(width)}×${Math.round(height)} px`;
}

/** Frase de recusa para origem pequena demais; null quando serve. */
export function describeSourceSizeProblem(source: SourceSize, spec: CropSpec) {
  if (!Number.isFinite(source.width) || !Number.isFinite(source.height) || source.width <= 0 || source.height <= 0) {
    return "Não conseguimos ler o tamanho desta imagem. Tente outro arquivo.";
  }

  if (source.width < spec.minWidth || source.height < spec.minHeight) {
    return `Esta imagem tem ${formatPixels(source.width, source.height)}. Use uma imagem a partir de ${formatPixels(spec.minWidth, spec.minHeight)}.`;
  }

  return null;
}

/** Maior retangulo na proporcao da saida que cabe na origem (zoom 1). */
export function baseCropSize(source: SourceSize, spec: CropSpec) {
  const ratio = spec.outputWidth / spec.outputHeight;

  if (source.width / source.height > ratio) {
    return { height: source.height, width: source.height * ratio };
  }

  return { height: source.width / ratio, width: source.width };
}

/** Zoom maximo: o recorte nunca fica com menos pixels que a origem minima aceita. */
export function maxZoomFor(source: SourceSize, spec: CropSpec) {
  const base = baseCropSize(source, spec);
  const limit = Math.min(MAX_ZOOM_CAP, base.width / spec.minWidth);

  return Number.isFinite(limit) && limit > 1 ? limit : 1;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Corrige zoom e centro para o recorte ficar sempre dentro da imagem. */
export function clampCropState(source: SourceSize, spec: CropSpec, state: CropState): CropState {
  const zoom = clamp(Number.isFinite(state.zoom) ? state.zoom : 1, 1, maxZoomFor(source, spec));
  const base = baseCropSize(source, spec);
  const halfWidth = base.width / zoom / 2;
  const halfHeight = base.height / zoom / 2;

  return {
    centerX: clamp(Number.isFinite(state.centerX) ? state.centerX : source.width / 2, halfWidth, source.width - halfWidth),
    centerY: clamp(Number.isFinite(state.centerY) ? state.centerY : source.height / 2, halfHeight, source.height - halfHeight),
    zoom
  };
}

/** Recorte centralizado, sem zoom. */
export function initialCropState(source: SourceSize, spec: CropSpec): CropState {
  return clampCropState(source, spec, { centerX: source.width / 2, centerY: source.height / 2, zoom: 1 });
}

/** Retangulo de origem (em pixels da imagem) que vira a saida. */
export function cropRect(source: SourceSize, spec: CropSpec, state: CropState): CropRect {
  const safe = clampCropState(source, spec, state);
  const base = baseCropSize(source, spec);
  const width = base.width / safe.zoom;
  const height = base.height / safe.zoom;

  return { height, width, x: safe.centerX - width / 2, y: safe.centerY - height / 2 };
}

/** Arrastar: desloca o centro em pixels da imagem (arrastar a imagem para a direita move o recorte para a esquerda). */
export function panCrop(source: SourceSize, spec: CropSpec, state: CropState, deltaX: number, deltaY: number): CropState {
  return clampCropState(source, spec, { ...state, centerX: state.centerX + deltaX, centerY: state.centerY + deltaY });
}

/** Zoom mantendo o centro do recorte. */
export function zoomCrop(source: SourceSize, spec: CropSpec, state: CropState, zoom: number): CropState {
  return clampCropState(source, spec, { ...state, zoom });
}

/** Bytes do arquivo representado por um data URL base64. */
export function dataUrlByteLength(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;

  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

export function isWebpDataUrl(value: string) {
  return value.startsWith("data:image/webp;base64,");
}

export type EncodedImageChoice =
  | { dataUrl: string; ok: true }
  | { error: "unsupported" | "too_large"; ok: false };

export type EncodingLimits = Pick<CropSpec, "maxBytes" | "maxDataUrlLength">;

const DEFAULT_ENCODING_LIMITS: EncodingLimits = { maxBytes: MAX_IMAGE_BYTES, maxDataUrlLength: MAX_IMAGE_DATA_URL_LENGTH };

/**
 * Escolhe a primeira tentativa (da maior para a menor qualidade) que cabe no alvo (150 KB por
 * padrao; o slot pode pedir outro). Se nenhuma couber, aceita a menor que ainda passa no limite do
 * servidor. Navegador que nao gera WebP devolve PNG no lugar: isso vira "unsupported".
 */
export function chooseEncodedImage(attempts: readonly string[], limits: EncodingLimits = DEFAULT_ENCODING_LIMITS): EncodedImageChoice {
  if (attempts.length === 0 || attempts.some((attempt) => !isWebpDataUrl(attempt))) {
    return { error: "unsupported", ok: false };
  }

  const fitting = attempts.find((attempt) => dataUrlByteLength(attempt) <= limits.maxBytes);

  if (fitting) {
    return { dataUrl: fitting, ok: true };
  }

  const smallest = [...attempts].sort((left, right) => left.length - right.length)[0];

  return smallest.length <= limits.maxDataUrlLength ? { dataUrl: smallest, ok: true } : { error: "too_large", ok: false };
}

export function describeEncodingProblem(error: "unsupported" | "too_large") {
  return error === "unsupported"
    ? "Este navegador não gera imagens WebP. Use o Chrome, o Edge ou o Firefox para recortar, ou cole o link de uma imagem pronta."
    : "A imagem continuou grande demais mesmo comprimida. Tente outra imagem ou aumente o zoom.";
}

/** Frase de ajuda abaixo do campo de imagem. */
export function describeImageRequirement(spec: CropSpec) {
  return `Qualquer imagem a partir de ${spec.minWidth}×${spec.minHeight} px serve; de ${spec.outputWidth}×${spec.outputHeight} px para cima fica nítida em qualquer tela. Você ajusta o recorte ${spec.ratioLabel} em seguida.`;
}
