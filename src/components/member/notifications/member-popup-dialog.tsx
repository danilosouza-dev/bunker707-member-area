"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useId, useRef, type MouseEvent } from "react";
import { announceOverlay } from "@/lib/overlay-event";
import type { PopupItem } from "@/server/communications/notification-model";
import { MemberPopupCard } from "./member-popup";
import { useEscapeToClose } from "./notifications-client";

// Janela do pop-up da home (docs/22 §1.3; desenho em docs/12). Baixada so quando o servidor manda um
// pop-up (MemberPopupHost carrega com next/dynamic): quem nao tem pop-up nao baixa o Dialog, o cartao
// nem o player. Enquanto aberta, o video do destaque pausa: o <video> direto aqui; o do YouTube (iframe)
// pelo evento da window `bunker707:overlay` (src/lib/overlay-event.ts), que o proprio destaque escuta.

export type PopupOutcome = "clicked" | "closed" | "dismissed" | "snoozed";

export function MemberPopupDialog({
  onFinish,
  onNavigate,
  open,
  popup
}: {
  /** O aluno saiu do pop-up (o host registra o evento e fecha). */
  onFinish: (outcome: PopupOutcome) => void;
  /** Navegacao do AppShell (salva progresso e favoritos antes de trocar de pagina). */
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  open: boolean;
  popup: PopupItem;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();

  // Video tocando atras (o destaque da home) pausa enquanto o pop-up esta aberto e volta ao fechar.
  useEffect(() => {
    if (!open) {
      return;
    }

    const pausedByPopup = Array.from(document.querySelectorAll("video")).filter(
      (video) => !popupRef.current?.contains(video) && !video.paused
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

  useEscapeToClose(open, () => onFinish("closed"), (target) => Boolean(popupRef.current?.contains(target)));

  return (
    <Dialog.Root
      onOpenChange={(next) => {
        if (!next) {
          onFinish("closed");
        }
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-[2px] transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
        <Dialog.Viewport className="fixed inset-0 z-[201] grid place-items-center overflow-y-auto p-4">
          <Dialog.Popup
            aria-describedby={popup.body ? bodyId : undefined}
            aria-labelledby={titleId}
            aria-modal="true"
            className="outline-none transition-[opacity,transform] duration-200 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none"
            data-member-popup=""
            initialFocus={popupRef}
            ref={popupRef}
          >
            <MemberPopupCard
              bodyId={bodyId}
              onClose={() => onFinish("closed")}
              onCta={(event, link) => {
                onFinish("clicked");

                // Link de fora ou em nova aba: o navegador abre sozinho.
                if (link.internal && !link.newTab) {
                  onNavigate?.(event, link.href);
                }
              }}
              onDismiss={() => onFinish("dismissed")}
              onSnooze={() => onFinish("snoozed")}
              popup={popup}
              titleId={titleId}
            />
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
