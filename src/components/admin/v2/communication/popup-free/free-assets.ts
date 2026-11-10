"use client";

import type { PopupVideoMimeType } from "@/server/communications/popup-design-model";
import { uploadPopupFreeImage } from "@/server/communications/popup-free-actions";
import { POPUP_DESIGN_COPY, videoDurationHint, videoFileProblem, videoMimeTypeOf } from "../popup-design/popup-design-editor-model";
import { readVideoDuration, uploadPopupVideo } from "../popup-design/video-upload";
import { encodeWebp, prepareFreeImage } from "./free-image-prepare";
import { FREE_IMAGE_COPY_PROBLEMS, freeImageTargetSize } from "./free-inspector-model";

// Envios do editor Livre (docs/27 §5.2; spec §4.6), pacote I. Imagem: o navegador abre o JPG/PNG/WebP, reduz o
// lado maior ate 1.600 px num canvas (a transparencia fica: o canvas comeca transparente e nada e pintado por
// baixo) e tenta as qualidades 0,86 -> 0,75 -> 0,6 ate caber em 420.000 bytes; vai pelo uploadPopupFreeImage,
// que confere de novo e devolve caminho e medidas do servidor. Video: o mesmo envio do Personalizado
// (video-upload.ts, direto ao Storage); a capa e um quadro do ARQUIVO LOCAL escolhido (nunca de um video que ja
// esta no Storage: precisaria de CORS no canvas), na proporcao do video, enviado como imagem; se o navegador nao
// abre o arquivo (WebM num Safari antigo), segue sem capa. O preparo da imagem (prepareFreeImage, que aceita outros
// limites: o banner da Na tela dos webinarios usa 1.280 px e 200.000 bytes) mora em free-image-prepare.ts, sem envio.

export type FreeUploadedImage = { height: number; path: string; width: number };

/** Envia um data URL WebP e devolve caminho e medidas lidas pelo servidor. */
export async function uploadFreeImageDataUrl(dataUrl: string): Promise<FreeUploadedImage> {
  const result = await uploadPopupFreeImage({ image: dataUrl }).catch(() => null);

  if (!result || !result.ok) {
    throw new Error(result ? (result.fieldErrors?.image?.[0] ?? result.error ?? FREE_IMAGE_COPY_PROBLEMS.failed) : FREE_IMAGE_COPY_PROBLEMS.failed);
  }

  const { height, path, width } = result.data.asset;

  return { height, path, width };
}

/** "Enviar imagem": prepara no navegador e envia. */
export async function uploadFreeImageFile(file: File): Promise<FreeUploadedImage> {
  return uploadFreeImageDataUrl(await prepareFreeImage(file));
}

/* ------------------------------------------------------------------------------------------------
 * Video e capa
 * ---------------------------------------------------------------------------------------------- */

function waitFor(element: HTMLMediaElement, event: "loadeddata" | "seeked", timeoutMs = 15_000) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, timeoutMs);
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("error"));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      element.removeEventListener(event, done);
      element.removeEventListener("error", fail);
    };

    element.addEventListener(event, done, { once: true });
    element.addEventListener("error", fail, { once: true });
  });
}

/** Um quadro do arquivo local (perto de 1 s), na proporcao do video, como WebP; null = nao deu. */
export async function captureFreeVideoPoster(file: Blob): Promise<string | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");

  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;

  try {
    await waitFor(video, "loadeddata");

    const time = Number.isFinite(video.duration) ? Math.min(1, video.duration / 2) : 0;

    if (time > 0) {
      video.currentTime = time;
      await waitFor(video, "seeked");
    }

    const size = freeImageTargetSize({ height: video.videoHeight, width: video.videoWidth });

    return size ? encodeWebp(video, size) : null;
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export type FreeUploadedVideo = { hint: string | null; poster: FreeUploadedImage | null; video: { mimeType: PopupVideoMimeType; path: string } };

/**
 * "Enviar vídeo": confere formato e tamanho, abre o arquivo no navegador (le a duracao), envia direto ao Storage
 * (a porcentagem vem por `onProgress`) e tira a capa do arquivo local. Lanca com a frase para a tela.
 */
export async function uploadFreeVideoFile(file: File, onProgress: (percent: number) => void): Promise<FreeUploadedVideo> {
  const problem = videoFileProblem(file);
  const mimeType = videoMimeTypeOf(file);

  if (problem || !mimeType) {
    throw new Error(problem ?? POPUP_DESIGN_COPY.video.format);
  }

  const localUrl = URL.createObjectURL(file);
  let duration: number | null;

  try {
    duration = await readVideoDuration(localUrl);
  } finally {
    URL.revokeObjectURL(localUrl);
  }

  if (duration === null) {
    throw new Error(POPUP_DESIGN_COPY.video.cannotPlay);
  }

  const uploaded = await uploadPopupVideo(file, mimeType, onProgress);
  const frame = await captureFreeVideoPoster(file);
  const poster = frame ? await uploadFreeImageDataUrl(frame).catch(() => null) : null;

  return { hint: videoDurationHint(duration), poster, video: { mimeType: uploaded.mimeType, path: uploaded.path } };
}
