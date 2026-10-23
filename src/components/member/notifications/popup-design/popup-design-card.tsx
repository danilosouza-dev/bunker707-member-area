"use client";

import { X } from "lucide-react";
import type { MouseEvent } from "react";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { cn } from "@/lib/utils";
import type { PopupItem } from "@/server/communications/notification-model";
import { popupCardWidthPx, type PopupDesign, type PopupFontFace } from "@/server/communications/popup-design-model";
import type { NotificationLink } from "../notifications-model";
import { PopupDesignBlocks } from "./popup-design-blocks";
import { PopupDesignMedia, usePopupMotion } from "./popup-design-media";
import {
  isTextOverMedia,
  POPUP_OVER_STAGE_CSS,
  popupCardCss,
  popupCloseCss,
  popupFirstBlockClearance,
  popupFooterCss,
  popupFooterLinkCss,
  popupFooterLinks,
  popupHasFooter,
  popupMediaMode,
  popupOuterCss,
  popupTextGroupCss
} from "./popup-design-styles";
import { usePopupFontFaces } from "./popup-font-loader";

// Pop-up "Personalizado" do aluno (docs/26): midia (video mudo em loop ou imagem) que some num degrade, os blocos
// (selo, titulo, texto, botoes, audio, espacador) com texto de verdade, os links "Lembrar depois" / "Não mostrar
// de novo" e o X. O mesmo cartao no dialogo do aluno (member-popup-dialog.tsx, pelo MemberPopupCard) e na
// previa do admin (`preview`). Estilos so por objetos de estilo do React montados a partir do design validado
// (popup-design-styles.ts); nunca CSS ou HTML do produtor.
//
// Zonas: "Abaixo da midia" (o grupo vem depois da midia e sobe sobre ela pelo "Subir") ou "Sobre a midia" em
// cima / no meio / embaixo (midia e grupo na mesma celula do grid; a celula cresce se o texto for maior). Sem
// midia, vale como "Abaixo". O X tem 36 px visiveis e 44 px de toque, como no Padrão.

export type PopupDesignCardProps = {
  accessPreviewMode?: AccessPreviewMode;
  /** id do primeiro bloco de texto (aria-describedby do dialogo). */
  bodyId?: string;
  design: PopupDesign;
  /** Fontes enviadas resolvidas no servidor (PopupItem.fonts). */
  fonts?: readonly PopupFontFace[];
  /** "Só no X": o toque fora faz o X pulsar por 300 ms. */
  nudgeClose?: boolean;
  onClose?: () => void;
  /** Botao principal e segundo botao com link (os dois contam como o clique do pop-up). */
  onCta?: (event: MouseEvent<HTMLAnchorElement>, link: NotificationLink) => void;
  onDismiss?: () => void;
  onSnooze?: () => void;
  /** false pausa o video (a janela fechando); padrao true. */
  playing?: boolean;
  /** O conteudo do aviso: cta (texto e destino do botao principal), image (midia / capa), audio, canSnooze, title. */
  popup: PopupItem;
  /** Previa do admin: mesmo visual, sem links, audio parado e botoes sem acao. */
  preview?: boolean;
  /** id do <h2> do primeiro bloco de titulo (aria-labelledby do dialogo). */
  titleId?: string;
};

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
const NO_FACES: readonly PopupFontFace[] = [];

export function PopupDesignCard({
  accessPreviewMode,
  bodyId,
  design,
  fonts,
  nudgeClose = false,
  onClose,
  onCta,
  onDismiss,
  onSnooze,
  playing = true,
  popup,
  preview = false,
  titleId
}: PopupDesignCardProps) {
  const fontsReady = usePopupFontFaces(fonts);
  const motion = usePopupMotion();
  const image = popup.image?.url ? popup.image : null;
  const mode = popupMediaMode(design, { hasImage: Boolean(image), motion });
  const hasMedia = mode !== "none";
  const over = isTextOverMedia(design, hasMedia);
  const cardWidth = popupCardWidthPx(design);
  const links = popupFooterLinks(design, popup.canSnooze);
  // Sem "Não mostrar de novo" (a equipe tirou) e sem "Lembrar depois": nenhum rodape, o cartao termina no ultimo bloco.
  const hasFooter = popupHasFooter(links);
  const linkStyle = popupFooterLinkCss(design);
  const linkClassName = cn("rounded-full underline-offset-4 hover:underline", focusRing);
  // Mesmo X do Padrão (36 px visiveis, 44 px de toque pelo before:, pulso do "Só no X"); so as cores mudam.
  const closeClassName = cn(
    "absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full backdrop-blur transition-[filter,scale] duration-150 hover:brightness-125 motion-reduce:transition-none before:absolute before:-inset-1 before:rounded-full before:content-['']",
    nudgeClose && "motion-safe:scale-[1.12]",
    focusRing
  );

  const media = hasMedia ? <PopupDesignMedia design={design} image={image} mode={mode} over={over} playing={playing} /> : null;
  const group = (
    <div data-popup-text="" style={popupTextGroupCss(design, hasMedia, hasFooter)}>
      <PopupDesignBlocks
        accessPreviewMode={accessPreviewMode}
        bodyId={bodyId}
        cardWidth={cardWidth}
        design={design}
        faces={fonts ?? NO_FACES}
        firstBlockStyle={popupFirstBlockClearance(design, hasMedia)}
        onClose={onClose}
        onCta={onCta}
        onSnooze={onSnooze}
        popup={popup}
        preview={preview}
        titleId={titleId}
      />
    </div>
  );

  return (
    <div data-fonts-ready={fontsReady ? "" : undefined} data-popup-design="" style={popupOuterCss(design)}>
      <div style={popupCardCss(design)}>
        {over ? (
          <div style={POPUP_OVER_STAGE_CSS}>
            {media}
            {group}
          </div>
        ) : (
          <>
            {media}
            {group}
          </>
        )}
        {hasFooter ? (
          <div data-popup-footer="" style={popupFooterCss(design)}>
            {links.snooze ? (
              preview ? (
                <span style={linkStyle}>Lembrar depois</span>
              ) : (
                <button className={linkClassName} onClick={onSnooze} style={linkStyle} type="button">
                  Lembrar depois
                </button>
              )
            ) : null}
            {links.dismiss ? (
              preview ? (
                <span style={linkStyle}>Não mostrar de novo</span>
              ) : (
                <button className={linkClassName} onClick={onDismiss} style={linkStyle} type="button">
                  Não mostrar de novo
                </button>
              )
            ) : null}
          </div>
        ) : null}
      </div>
      {preview ? (
        <span aria-hidden="true" className={closeClassName} style={popupCloseCss(design)}>
          <X className="size-5" strokeWidth={2.4} />
        </span>
      ) : (
        <button aria-label="Fechar" className={closeClassName} onClick={onClose} style={popupCloseCss(design)} type="button">
          <X aria-hidden="true" className="size-5" strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}
