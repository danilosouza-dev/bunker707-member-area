"use client";

import Image from "next/image";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import type { NotificationImage } from "@/server/communications/notification-model";
import { popupCardWidthPx, type PopupDesign } from "@/server/communications/popup-design-model";
import {
  POPUP_REDUCED_MOTION_QUERY,
  popupFadeCss,
  popupMediaBoxCss,
  popupMediaFillCss,
  prefersStillMedia,
  readMotionPreferences,
  type PopupMediaMode,
  type PopupMotion
} from "./popup-design-styles";

// Midia do pop-up "Personalizado" (docs/26): a imagem do aviso, ou o video mudo em repeticao (inline, sem
// controles, sem picture-in-picture) com a imagem de capa, e o degrade por cima ate o fundo do cartao.
//
// Menos movimento (prefers-reduced-motion) ou economia de dados (Save-Data): so a capa, e o <video> nem e
// montado, entao nada do video e baixado. A preferencia e lida antes de desenhar (useSyncExternalStore: na
// janela do aluno, so no navegador, ja vem certa no primeiro desenho); no servidor (previa do admin) a caixa
// fica vazia ate o navegador decidir. Mudou a preferencia com o pop-up aberto: troca na hora.
//
// `playing` false (a janela fechando) pausa; ao sair da tela o video solta o arquivo (sem src + load()).

type ConnectionLike = EventTarget & { saveData?: boolean };

function connectionOf(): ConnectionLike | undefined {
  return (navigator as Navigator & { connection?: ConnectionLike }).connection;
}

function subscribeMotion(onChange: () => void) {
  const query = typeof window.matchMedia === "function" ? window.matchMedia(POPUP_REDUCED_MOTION_QUERY) : null;
  const connection = connectionOf();

  query?.addEventListener?.("change", onChange);
  connection?.addEventListener?.("change", onChange);

  return () => {
    query?.removeEventListener?.("change", onChange);
    connection?.removeEventListener?.("change", onChange);
  };
}

function motionSnapshot(): PopupMotion {
  return prefersStillMedia(readMotionPreferences(window)) ? "still" : "motion";
}

function serverMotion(): PopupMotion {
  return "pending";
}

/** "motion" (pode tocar video), "still" (so a capa) ou "pending" (no servidor). */
export function usePopupMotion(): PopupMotion {
  return useSyncExternalStore(subscribeMotion, motionSnapshot, serverMotion);
}

/** Solta o arquivo do video que saiu da tela (o navegador para de baixar). */
function releaseVideo(video: HTMLVideoElement) {
  video.pause();
  video.querySelectorAll("source").forEach((source) => source.removeAttribute("src"));
  video.removeAttribute("src");
  video.load();
}

export type PopupDesignMediaProps = {
  design: PopupDesign;
  image: NotificationImage | null;
  mode: PopupMediaMode;
  /** "Sobre a midia": a caixa divide a celula do grid com o texto. */
  over: boolean;
  /** false pausa o video (a janela fechando). */
  playing: boolean;
};

export function PopupDesignMedia({ design, image, mode, over, playing }: PopupDesignMediaProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const video = design.media.video;
  // Trocar o video (editor do admin) monta outro <video>: o navegador nao recarrega quando so o <source> muda.
  const videoKey = mode === "video" && video ? video.url : null;

  useEffect(() => {
    const element = videoRef.current;

    if (!element) {
      return;
    }

    if (!playing) {
      element.pause();
      return;
    }

    // Mudo antes do play(): o navegador so deixa tocar sozinho sem som.
    element.defaultMuted = true;
    element.muted = true;
    void element.play().catch(() => undefined);
  }, [videoKey, playing]);

  useEffect(() => {
    const element = videoRef.current;

    if (!element) {
      return;
    }

    return () => {
      // So quando saiu da pagina de verdade (no modo estrito do React o efeito roda duas vezes no mesmo elemento).
      queueMicrotask(() => {
        if (!element.isConnected) {
          releaseVideo(element);
        }
      });
    };
  }, [videoKey]);

  if (mode === "none") {
    return null;
  }

  const fade = popupFadeCss(design);
  const cardWidth = popupCardWidthPx(design);
  const fill = popupMediaFillCss(design);

  return (
    <div data-popup-media={mode} style={popupMediaBoxCss(design, over)}>
      {videoKey && video ? (
        <video
          aria-hidden="true"
          autoPlay
          disablePictureInPicture
          disableRemotePlayback
          key={videoKey}
          loop
          muted
          playsInline
          poster={image?.url}
          preload="auto"
          ref={videoRef}
          style={fill}
          tabIndex={-1}
        >
          <source src={video.url} type={video.mimeType} />
        </video>
      ) : null}
      {mode === "image" && image ? (
        <Image
          alt={image.alt}
          fill
          sizes={`(max-width: ${cardWidth + 32}px) 100vw, ${cardWidth}px`}
          src={image.url}
          style={{ objectFit: fill.objectFit, objectPosition: fill.objectPosition }}
          unoptimized={!canOptimizeImageSrc(image.url)}
        />
      ) : null}
      {fade ? <div aria-hidden="true" data-popup-fade="" style={fade} /> : null}
    </div>
  );
}
