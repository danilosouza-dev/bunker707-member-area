"use client";

import { FREE_IMAGE_LIMITS, type FreeImageLimits } from "@/server/communications/popup-free-model";
import { FREE_IMAGE_COPY_PROBLEMS, FREE_IMAGE_QUALITIES, freeImageFileProblem, freeImageTargetSize, pickFreeImageEncoding } from "./free-inspector-model";

// O preparo da imagem no navegador (docs/27 §5.2; spec §4.6), separado dos envios do editor Livre (free-assets.ts):
// abre o JPG/PNG/WebP, reduz o lado maior num canvas (a transparencia fica: o canvas comeca transparente e nada e
// pintado por baixo) e tenta as qualidades 0,86 -> 0,75 -> 0,6 ate caber no peso. Sem Server Action nem envio: quem
// chama envia pela acao dele. Os limites (o lado, o peso e as frases) sao os do Livre (1.600 px, 420.000 bytes) por
// padrao; o banner da Na tela dos webinarios (console-screen-form.tsx) passa 1.280 px e 200.000 bytes e carrega este
// modulo so quando a equipe escolhe uma imagem.

type Drawable = { close: () => void; height: number; source: CanvasImageSource; width: number };

/** Abre a imagem escolhida (createImageBitmap; senao um <img> com endereco local). */
async function openImage(file: Blob): Promise<Drawable> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);

      return { close: () => bitmap.close(), height: bitmap.height, source: bitmap, width: bitmap.width };
    } catch {
      // segue para o <img>
    }
  }

  const url = URL.createObjectURL(file);

  try {
    const image = new Image();

    image.decoding = "async";
    image.src = url;
    await image.decode();

    return { close: () => URL.revokeObjectURL(url), height: image.naturalHeight, source: image, width: image.naturalWidth };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(FREE_IMAGE_COPY_PROBLEMS.open);
  }
}

/** Desenha na medida final e tenta as qualidades ate caber; null = nenhuma coube (ou o navegador nao faz WebP). */
export function encodeWebp(source: CanvasImageSource, size: { height: number; width: number }, limits: FreeImageLimits = FREE_IMAGE_LIMITS): string | null {
  const canvas = document.createElement("canvas");

  canvas.width = size.width;
  canvas.height = size.height;

  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, size.width, size.height);
  context.drawImage(source, 0, 0, size.width, size.height);

  const attempts = FREE_IMAGE_QUALITIES.map((quality) => ({ dataUrl: canvas.toDataURL("image/webp", quality), quality }));
  const choice = pickFreeImageEncoding(attempts, limits);

  canvas.width = 0;
  canvas.height = 0;

  return choice?.dataUrl ?? null;
}

/**
 * O arquivo escolhido como data URL WebP pronto para enviar (ou lanca com a frase para a tela). `limits`: o lado, o peso
 * e as frases de quem chama (o banner da Na tela); sem eles, os do Livre.
 */
export async function prepareFreeImage(file: File, limits: FreeImageLimits = FREE_IMAGE_LIMITS): Promise<string> {
  const problem = freeImageFileProblem(file);

  if (problem) {
    throw new Error(problem);
  }

  const image = await openImage(file);

  try {
    const size = freeImageTargetSize({ height: image.height, width: image.width }, limits);

    if (!size) {
      throw new Error(limits.messages?.sides ?? FREE_IMAGE_COPY_PROBLEMS.sides);
    }

    const dataUrl = encodeWebp(image.source, size, limits);

    if (!dataUrl) {
      // O navegador devolveu PNG (sem WebP) ou nem a menor qualidade coube.
      const probe = document.createElement("canvas").toDataURL("image/webp", 0.5);

      throw new Error(probe.startsWith("data:image/webp") ? (limits.messages?.tooLarge ?? FREE_IMAGE_COPY_PROBLEMS.tooLarge) : FREE_IMAGE_COPY_PROBLEMS.webp);
    }

    return dataUrl;
  } finally {
    image.close();
  }
}
