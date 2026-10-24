"use client";

import Image from "next/image";
import { useEffect, useRef, type CSSProperties, type Ref } from "react";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import type { FreeImageNode, FreeVideoNode, PopupFreeDesign } from "@/server/communications/popup-free-model";
import {
  FREE_MEDIA_BOX_CSS,
  FREE_MISSING_MEDIA_CSS,
  freeAssetSrc,
  freeImageSizes,
  freeMediaFillCss,
  freeVideoMode,
  type FreeMotion,
  type FreeStyleContext
} from "./popup-free-styles";

// Midia do pop-up Livre (docs/27; spec §3.3 e §3.5): Imagem (next/image com fill e `sizes` pela largura do
// elemento, como no Personalizado) e Video (o mesmo <video> mudo em repeticao do Personalizado). O endereco sai
// so de freeAssetUrl (origem conferida + bucket + caminho do padrao): caminho fora do padrao ou origem que nao
// confere = a imagem nao aparece; o video mostra o poster, ou so o fundo do elemento.
//
// Menos movimento ou economia de dados: o <video> nem e montado (nada e baixado); o poster entra como imagem.
// `playing` false (a janela fechando) pausa; ao sair da tela o video solta o arquivo (sem src + load()).
//
// Na previa do editor, Imagem ou Video sem arquivo viram um quadriculado com a frase do que falta; no aluno,
// uma Imagem sem arquivo nao aparece.

/** Solta o arquivo do video que saiu da tela (o navegador para de baixar). O mesmo do Personalizado. */
function releaseVideo(video: HTMLVideoElement) {
  video.pause();
  video.querySelectorAll("source").forEach((source) => source.removeAttribute("src"));
  video.removeAttribute("src");
  video.load();
}

type MediaProps<T> = {
  ctx: FreeStyleContext;
  design: Pick<PopupFreeDesign, "artboard">;
  /** Recebe o elemento do DOM com o data-free-id (so o editor). */
  elementRef?: Ref<HTMLDivElement>;
  node: T;
  /** Estilo da caixa e da posicao do elemento (popup-free-styles). */
  style: CSSProperties;
};

export function FreeImageView({ ctx, design, elementRef, node, style }: MediaProps<FreeImageNode>) {
  const src = freeAssetSrc(ctx, node.asset, "image");

  if (!src) {
    return ctx.preview ? (
      <div data-free-id={node.id} data-free-missing="" ref={elementRef} style={{ ...style, ...FREE_MISSING_MEDIA_CSS }}>
        Escolha a imagem
      </div>
    ) : null;
  }

  const fill = freeMediaFillCss(node);

  return (
    <div data-free-id={node.id} ref={elementRef} style={{ ...style, ...FREE_MEDIA_BOX_CSS }}>
      <Image
        alt={node.alt ?? ""}
        draggable={false}
        fill
        sizes={freeImageSizes(node, design)}
        src={src}
        style={{ objectFit: fill.objectFit, objectPosition: fill.objectPosition }}
        unoptimized={!canOptimizeImageSrc(src)}
      />
    </div>
  );
}

export function FreeVideoView({ ctx, design, elementRef, motion, node, playing, style }: MediaProps<FreeVideoNode> & { motion: FreeMotion; playing: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { mode, poster, src } = freeVideoMode(node, ctx, motion);
  // Trocar o video (editor) monta outro <video>: o navegador nao recarrega quando so o <source> muda.
  const videoKey = mode === "video" ? src : null;
  const mimeType = ctx.assets.find((asset) => asset.id === node.asset && asset.kind === "video");

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

  const fill = freeMediaFillCss(node);
  // Previa do editor sem arquivo que monte endereco: o quadriculado (no aluno, so o fundo do elemento).
  const missing = ctx.preview && !freeAssetSrc(ctx, node.asset, "video");

  return (
    <div
      data-free-id={node.id}
      data-free-media={mode}
      data-free-missing={missing ? "" : undefined}
      ref={elementRef}
      style={missing ? { ...style, ...FREE_MISSING_MEDIA_CSS } : { ...style, ...FREE_MEDIA_BOX_CSS }}
    >
      {missing ? "Envie o vídeo" : null}
      {videoKey && src ? (
        <video
          aria-hidden="true"
          autoPlay
          disablePictureInPicture
          disableRemotePlayback
          key={videoKey}
          loop
          muted
          playsInline
          poster={poster ?? undefined}
          preload="auto"
          ref={videoRef}
          style={fill}
          tabIndex={-1}
        >
          <source src={src} type={mimeType && mimeType.kind === "video" ? mimeType.mimeType : undefined} />
        </video>
      ) : null}
      {mode === "poster" && poster ? (
        <Image
          alt=""
          draggable={false}
          fill
          sizes={freeImageSizes(node, design)}
          src={poster}
          style={{ objectFit: fill.objectFit, objectPosition: fill.objectPosition }}
          unoptimized={!canOptimizeImageSrc(poster)}
        />
      ) : null}
    </div>
  );
}
