"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useId, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { announceOverlay } from "@/lib/overlay-event";
import type { PopupItem } from "@/server/communications/notification-model";
import type { PopupCloseVia } from "@/server/communications/popup-display-model";
import { MemberPopupCard } from "./member-popup";
import { useEscapeToClose } from "./notifications-client";
import { popupDialogAria } from "./popup-design/popup-design-styles";
import { loadedPopupFreeCard } from "./popup-free/popup-free-load";
import { closeViaOf } from "./popup-host-model";

// Janela do pop-up (docs/22 §1.3; v3b-1 em docs/25; desenho em docs/12). Baixada antes de o host pedir o
// POST /show (MemberPopupHost carrega com next/dynamic so quando algo foi armado): quem nao tem pop-up nao
// baixa o Dialog, o cartao nem o player. Enquanto aberta, o video do destaque pausa: o <video> direto aqui;
// o do YouTube (iframe) pelo evento da window `bunker707:overlay` (src/lib/overlay-event.ts), que o proprio
// destaque escuta. O video do player da aula nunca e pausado nem retomado (o host so abre com ele parado).
//
// "Só no X" (`popup.close === "x_only"`): o toque fora nao fecha (disablePointerDismissal), so faz o X
// pulsar; o X e o Esc fecham (o Esc fica para quem usa teclado ou leitor de tela, padrao WAI-ARIA).
//
// Design do pop-up (docs/26): no "Personalizado", o nome do dialogo e o texto do titulo do design (o <h2>,
// aria-labelledby); sem bloco Título, o titulo do aviso (aria-label). A descricao e o primeiro bloco Texto. O
// segundo botao usa as saidas de sempre: Fechar = o X, Lembrar depois = o link, link = o clique do botao. O
// video do design pausa quando a janela comeca a fechar (`playing`).
// Design Livre (docs/27): o nome e o texto do primeiro titulo visivel do design (ou o titulo do aviso) e a
// descricao o primeiro texto visivel (popupFreeDialogAria, de popup-free-render.ts, lido do pedaco do cartao Livre,
// que o host ja baixou antes de abrir: popup-free-render.ts nao entra no pedaco da janela). Exportada aqui a porta
// do pedaco, para o host baixar o cartao Livre so pela janela (o pedaco do cartao nao repete o que a janela ja tem).

export type PopupOutcome = "clicked" | "closed" | "dismissed" | "snoozed";

export { loadPopupFreeCard } from "./popup-free/popup-free-load";

/** Nome e descricao do dialogo do Livre, do pedaco do cartao ja baixado; sem ele, o titulo do aviso (o do design). */
const freeDialogAria = (popup: PopupItem, ids: { bodyId: string; titleId: string }) =>
  loadedPopupFreeCard()?.popupFreeDialogAria(popup, ids) ?? { "aria-label": popup.title };

/** Quanto tempo o X pulsa depois de um toque fora em "Só no X". */
const NUDGE_MS = 300;

export function MemberPopupDialog({
  onFinish,
  onNavigate,
  open,
  popup
}: {
  /** O aluno saiu do pop-up (o host registra o evento e fecha); `via` diz como fechou. */
  onFinish: (outcome: PopupOutcome, via?: PopupCloseVia) => void;
  /** Navegacao do AppShell (salva progresso e favoritos antes de trocar de pagina). */
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  open: boolean;
  popup: PopupItem;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const xOnly = popup.close === "x_only";
  const aria = popup.freeDesign ? freeDialogAria(popup, { bodyId, titleId }) : popupDialogAria(popup, { bodyId, titleId });
  const [nudgeClose, setNudgeClose] = useState(false);
  const nudgeTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (nudgeTimerRef.current !== null) {
        window.clearTimeout(nudgeTimerRef.current);
      }
    },
    []
  );

  /** "Só no X": um toque no veu (fora do cartao) faz o X pulsar. */
  function handleVeilPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!xOnly || !(event.target instanceof Node) || popupRef.current?.contains(event.target)) {
      return;
    }

    if (nudgeTimerRef.current !== null) {
      window.clearTimeout(nudgeTimerRef.current);
    }

    setNudgeClose(true);
    nudgeTimerRef.current = window.setTimeout(() => {
      nudgeTimerRef.current = null;
      setNudgeClose(false);
    }, NUDGE_MS);
  }

  // Video tocando atras (o destaque da home) pausa enquanto o pop-up esta aberto e volta ao fechar. O do
  // palco da aula fica de fora: o pop-up nunca pausa nem retoma a aula.
  useEffect(() => {
    if (!open) {
      return;
    }

    const pausedByPopup = Array.from(document.querySelectorAll("video")).filter(
      (video) => !popupRef.current?.contains(video) && !video.closest("[data-lesson-player-stage]") && !video.paused
    );

    pausedByPopup.forEach((video) => video.pause());
    announceOverlay(true);

    return () => {
      announceOverlay(false);
      pausedByPopup.forEach((video) => {
        if (video.isConnected) {
          void video.play().catch(() => undefined);
        }
      });
    };
  }, [open]);

  useEscapeToClose(open, () => onFinish("closed", "esc"), (target) => Boolean(popupRef.current?.contains(target)));

  return (
    <Dialog.Root
      disablePointerDismissal={xOnly}
      onOpenChange={(next, details) => {
        if (!next) {
          onFinish("closed", closeViaOf(details?.reason));
        }
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-[2px] transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
        <Dialog.Viewport className="fixed inset-0 z-[201] grid place-items-center overflow-y-auto p-4" onPointerDown={handleVeilPointerDown}>
          <Dialog.Popup
            {...aria}
            aria-modal="true"
            className="outline-none transition-[opacity,transform] duration-200 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none"
            data-member-popup=""
            initialFocus={popupRef}
            ref={popupRef}
          >
            <MemberPopupCard
              bodyId={bodyId}
              nudgeClose={nudgeClose}
              onClose={() => onFinish("closed", "x")}
              onCta={(event, link) => {
                onFinish("clicked");

                // Link de fora ou em nova aba: o navegador abre sozinho.
                if (link.internal && !link.newTab) {
                  onNavigate?.(event, link.href);
                }
              }}
              onDismiss={() => onFinish("dismissed")}
              onSnooze={() => onFinish("snoozed")}
              playing={open}
              popup={popup}
              titleId={titleId}
            />
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
