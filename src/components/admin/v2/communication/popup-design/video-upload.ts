"use client";

import { finishPopupVideoUpload, startPopupVideoUpload } from "@/server/communications/popup-design-actions";
import type { PopupVideo, PopupVideoMimeType } from "@/server/communications/popup-design-model";
import { IMAGE_SPECS, WEBP_QUALITY_STEPS, chooseEncodedImage } from "../../products/cover-crop";
import { POPUP_DESIGN_COPY } from "./popup-design-editor-model";

// Envio do video do pop-up (docs/26 D12): o navegador pede o endereco assinado (startPopupVideoUpload), envia o
// arquivo direto ao Storage (nunca passa pelo servidor do app; o XHR da a porcentagem) e o servidor confere o
// tamanho e os primeiros bytes (finishPopupVideoUpload; invalido = apagado). Antes de enviar, o navegador abre o
// video (le a duracao e confere que toca) e, sem imagem no aviso, tira um quadro 16:9 para a capa.

const copy = POPUP_DESIGN_COPY.video;

function waitFor(element: HTMLMediaElement, event: "loadeddata" | "loadedmetadata" | "seeked", timeoutMs = 15_000) {
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

function hiddenVideo(url: string) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  return video;
}

/** Abre o video no navegador: duracao (s); null = o navegador nao toca este arquivo. */
export async function readVideoDuration(url: string): Promise<number | null> {
  const video = hiddenVideo(url);

  try {
    await waitFor(video, "loadedmetadata");
    return video.videoWidth > 0 && video.videoHeight > 0 ? video.duration : null;
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

/** Um quadro do video (perto de 1 s) recortado em 16:9 (1280×720) como WebP para a capa; null = nao deu. */
export async function captureVideoFrame(url: string): Promise<string | null> {
  const video = hiddenVideo(url);

  try {
    await waitFor(video, "loadeddata");
    const time = Number.isFinite(video.duration) ? Math.min(1, video.duration / 2) : 0;

    if (time > 0) {
      video.currentTime = time;
      await waitFor(video, "seeked");
    }

    const spec = IMAGE_SPECS.notice;
    const canvas = document.createElement("canvas");
    canvas.width = spec.outputWidth;
    canvas.height = spec.outputHeight;
    const context = canvas.getContext("2d");

    if (!context || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
    const width = video.videoWidth * scale;
    const height = video.videoHeight * scale;
    context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);

    const choice = chooseEncodedImage(
      WEBP_QUALITY_STEPS.map((quality) => canvas.toDataURL("image/webp", quality)),
      spec
    );

    return choice.ok ? choice.dataUrl : null;
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

function browserStorageHeaders(): Record<string, string> {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return key ? { apikey: key.trim() } : {};
}

/** PUT no endereco assinado (o mesmo formato do uploadToSignedUrl do supabase-js), com a porcentagem. */
function putToSignedUrl(signedUrl: string, file: File, onProgress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", file);

    request.open("PUT", signedUrl);
    request.setRequestHeader("x-upsert", "false");

    for (const [name, value] of Object.entries(browserStorageHeaders())) {
      request.setRequestHeader(name, value);
    }

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };
    request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(copy.failed)));
    request.onerror = () => reject(new Error(copy.failed));
    request.onabort = () => reject(new Error(copy.failed));
    request.send(form);
  });
}

function actionError(result: { error: string; fieldErrors?: Record<string, string[] | undefined> }) {
  const field = Object.values(result.fieldErrors ?? {}).find((messages) => messages?.[0])?.[0];
  return field ?? result.error ?? copy.failed;
}

/** Envia o video e devolve o PopupVideo conferido pelo servidor (ou lanca com a frase para a tela). */
export async function uploadPopupVideo(file: File, mimeType: PopupVideoMimeType, onProgress: (percent: number) => void): Promise<PopupVideo> {
  const ticket = await startPopupVideoUpload({ mimeType, sizeBytes: file.size }).catch(() => null);

  if (!ticket || !ticket.ok) {
    throw new Error(ticket ? actionError(ticket) : copy.failed);
  }

  onProgress(0);
  await putToSignedUrl(ticket.data.signedUrl, new File([file], file.name, { type: mimeType }), onProgress);
  onProgress(100);

  const finished = await finishPopupVideoUpload({ path: ticket.data.path }).catch(() => null);

  if (!finished || !finished.ok) {
    throw new Error(finished ? actionError(finished) : copy.failed);
  }

  return finished.data;
}
