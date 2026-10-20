"use client";

import { Dialog } from "@base-ui/react/dialog";
import { ArrowRight, ExternalLink, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { memberButtonClassName } from "@/components/member/ui/member-button";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { cn } from "@/lib/utils";
import { POPUP_RULES } from "@/server/communications/campaign-model";
import type { PopupItem } from "@/server/communications/notification-model";
import { NoticeAudioPlayer } from "./notice-audio-player";
import { fetchSummary, postPopupEvent, setSummaryUnseen, useEscapeToClose } from "./notifications-client";
import {
  POPUP_SESSION_KEY,
  resolveNotificationLink,
  SUMMARY_TTL_MS,
  type NotificationLink
} from "./notifications-model";

// Pop-up da home do aluno (docs/22 §5; limites fixos em docs/17 §1.8.1): so na home (nunca na aula),
// no maximo um por sessao do navegador e um a cada 24 h (o servidor escolhe qual e quando), 3 s depois
// de abrir a pagina e so quando nada mais esta aberto por cima e a aba esta visivel. "Lembrar depois"
// (24 h, ate 2 vezes, se o aviso permitir), "Não mostrar de novo" e fechar (X, Esc ou fora).
//
// MemberPopupCard so desenha (a previa do admin usa o mesmo cartao com `preview`, dentro de moldura
// inert reduzida; por isso a largura usa `cqw` e o respiro interno responde ao proprio cartao, nunca a
// janela). MemberPopupHost busca, decide a hora de mostrar e registra o que o aluno fez.

export type MemberPopupCardProps = {
  accessPreviewMode?: AccessPreviewMode;
  /** id do texto (aria-describedby do dialogo). */
  bodyId?: string;
  onClose?: () => void;
  onCta?: (event: MouseEvent<HTMLAnchorElement>, link: NotificationLink) => void;
  onDismiss?: () => void;
  onSnooze?: () => void;
  popup: PopupItem;
  /** Previa do admin: mesmo visual, sem links, audio parado e botoes sem acao. */
  preview?: boolean;
  /** id do titulo (aria-labelledby do dialogo). */
  titleId?: string;
};

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

function PopupCta({
  accessPreviewMode,
  onCta,
  popup,
  preview
}: Pick<MemberPopupCardProps, "accessPreviewMode" | "onCta" | "popup" | "preview">) {
  const cta = popup.cta;
  const link = cta && cta.label.trim() ? resolveNotificationLink(cta.href, cta.target, accessPreviewMode) : null;

  if (!cta || !link) {
    return null;
  }

  const Icon = link.newTab ? ExternalLink : ArrowRight;
  const className = memberButtonClassName({ className: "w-full", size: "lg", variant: "primary" });
  const content = (
    <>
      <span className="min-w-0 truncate">{cta.label}</span>
      <Icon aria-hidden="true" strokeWidth={2.6} />
    </>
  );

  if (preview) {
    return <span className={className}>{content}</span>;
  }

  return (
    <a
      className={className}
      href={link.href}
      onClick={(event) => onCta?.(event, link)}
      {...(link.newTab ? { rel: "noopener noreferrer", target: "_blank" } : {})}
    >
      {content}
      {link.newTab ? <span className="sr-only"> (abre em nova aba)</span> : null}
    </a>
  );
}

export function MemberPopupCard({
  accessPreviewMode,
  bodyId,
  onClose,
  onCta,
  onDismiss,
  onSnooze,
  popup,
  preview = false,
  titleId
}: MemberPopupCardProps) {
  const image = popup.image?.url ? popup.image : null;
  const snoozeClassName = memberButtonClassName({ className: "-ml-3", size: "sm", variant: "ghost" });
  const dismissClassName = memberButtonClassName({ className: "-mr-3 ml-auto text-zinc-400", size: "sm", variant: "ghost" });
  const closeClassName = cn(
    "absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75 motion-reduce:transition-none",
    focusRing
  );

  return (
    <div className="relative w-[min(28rem,calc(100cqw-2rem))] overflow-hidden rounded-[16px] border border-white/10 bg-[#181818] text-white shadow-[0_24px_80px_rgba(0,0,0,0.7)]">
      <div className="@container">
        {image ? (
          <div className="relative aspect-video w-full bg-white/[0.04]">
            <Image
              alt={image.alt}
              className="object-cover"
              fill
              sizes="(max-width: 480px) 100vw, 448px"
              src={image.url}
              unoptimized={!canOptimizeImageSrc(image.url)}
            />
          </div>
        ) : null}
        <div className="p-5 @min-[26rem]:p-6">
          <h2 className={cn("text-xl font-bold leading-7 [overflow-wrap:anywhere]", !image && "pr-10")} id={titleId}>
            {popup.title}
          </h2>
          {popup.body ? (
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-zinc-300 [overflow-wrap:anywhere]" id={bodyId}>
              {popup.body}
            </p>
          ) : null}
          {popup.audio ? <NoticeAudioPlayer audio={popup.audio} className="mt-4" label="Áudio do aviso" preview={preview} /> : null}
          <div className="mt-5 flex flex-col gap-2">
            <PopupCta accessPreviewMode={accessPreviewMode} onCta={onCta} popup={popup} preview={preview} />
            <div className="flex items-center gap-2">
              {popup.canSnooze ? (
                preview ? (
                  <span className={snoozeClassName}>Lembrar depois</span>
                ) : (
                  <button className={snoozeClassName} onClick={onSnooze} type="button">
                    Lembrar depois
                  </button>
                )
              ) : null}
              {preview ? (
                <span className={dismissClassName}>Não mostrar de novo</span>
              ) : (
                <button className={dismissClassName} onClick={onDismiss} type="button">
                  Não mostrar de novo
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {preview ? (
        <span aria-hidden="true" className={closeClassName}>
          <X className="size-5" strokeWidth={2.4} />
        </span>
      ) : (
        <button aria-label="Fechar" className={closeClassName} onClick={onClose} type="button">
          <X aria-hidden="true" className="size-5" strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}

// --- Quando mostrar ------------------------------------------------------------------------------

/** O resumo com pop-up e buscado depois que a home assenta (nao disputa com a pagina). */
const POPUP_FETCH_DELAY_MS = 1_500;
/** Enquanto algo esta aberto por cima (ou a aba escondida), confere de novo a cada segundo. */
const POPUP_RETRY_MS = 1_000;

// Memoria da pagina (sobrevive a troca de pagina, nao ao recarregar): sem sessionStorage (aba
// anonima, bloqueio), vale ao menos ate recarregar; e sem pop-up na ultima conferencia, a volta para a
// home dentro de 1 minuto nao pergunta de novo.
let shownInThisPage = false;
let lastEmptyCheckAt: number | null = null;

function wasShownThisSession() {
  if (shownInThisPage) {
    return true;
  }

  try {
    return window.sessionStorage.getItem(POPUP_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberShown() {
  shownInThisPage = true;

  try {
    window.sessionStorage.setItem(POPUP_SESSION_KEY, "1");
  } catch {
    // Sem sessionStorage: fica a memoria da pagina.
  }
}

/** Outro dialogo, gaveta, painel ou modal aberto (ou a rolagem travada por um deles)? */
function hasBlockingLayer() {
  if (document.body.style.overflow === "hidden" || document.documentElement.style.overflow === "hidden") {
    return true;
  }

  return Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"], [role="dialog"], [role="alertdialog"]')).some(
    (element) => !element.closest("[inert], [hidden], [data-member-popup]") && element.getClientRects().length > 0
  );
}

type PopupOutcome = "clicked" | "closed" | "dismissed" | "snoozed";

export function MemberPopupHost({
  enabled,
  onNavigate
}: {
  /** So na home e fora do modo "ver como" do produtor (AppShell decide). */
  enabled: boolean;
  /** Navegacao do AppShell (salva progresso e favoritos antes de trocar de pagina). */
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
  const [popup, setPopup] = useState<PopupItem | null>(null);
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const outcomeRef = useRef<PopupOutcome | null>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    if (!enabled || wasShownThisSession() || (lastEmptyCheckAt !== null && Date.now() - lastEmptyCheckAt < SUMMARY_TTL_MS)) {
      return;
    }

    const controller = new AbortController();
    const mountedAt = Date.now();
    const timers = new Set<number>();

    function later(callback: () => void, delay: number) {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        callback();
      }, delay);
      timers.add(timer);
    }

    function tryShow(item: PopupItem) {
      if (controller.signal.aborted || wasShownThisSession()) {
        return;
      }

      if (document.visibilityState !== "visible" || hasBlockingLayer()) {
        later(() => tryShow(item), POPUP_RETRY_MS);
        return;
      }

      rememberShown();
      outcomeRef.current = null;
      setPopup(item);
      setOpen(true);
      postPopupEvent(item.id, "impressed");
    }

    later(() => {
      fetchSummary({ popup: true, signal: controller.signal })
        .then((summary) => {
          setSummaryUnseen(summary.unseen);

          if (!summary.popup) {
            lastEmptyCheckAt = Date.now();
            return;
          }

          const item = summary.popup;
          later(() => tryShow(item), Math.max(0, mountedAt + POPUP_RULES.delayMs - Date.now()));
        })
        .catch(() => undefined);
    }, POPUP_FETCH_DELAY_MS);

    return () => {
      controller.abort();
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, [enabled]);

  // Video tocando atras (o destaque da home) pausa enquanto o pop-up esta aberto e volta ao fechar.
  useEffect(() => {
    if (!open) {
      return;
    }

    const pausedByPopup = Array.from(document.querySelectorAll("video")).filter(
      (video) => !popupRef.current?.contains(video) && !video.paused
    );

    pausedByPopup.forEach((video) => video.pause());

    return () => {
      pausedByPopup.forEach((video) => {
        if (video.isConnected) {
          void video.play().catch(() => undefined);
        }
      });
    };
  }, [open]);

  function finish(outcome: PopupOutcome) {
    if (!popup || outcomeRef.current) {
      return;
    }

    outcomeRef.current = outcome;
    postPopupEvent(popup.id, outcome);
    setOpen(false);
  }

  useEscapeToClose(open, () => finish("closed"), (target) => Boolean(popupRef.current?.contains(target)));

  if (!popup) {
    return null;
  }

  return (
    <Dialog.Root
      onOpenChange={(next) => {
        if (!next) {
          finish("closed");
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
              onClose={() => finish("closed")}
              onCta={(event, link) => {
                finish("clicked");

                // Link de fora ou em nova aba: o navegador abre sozinho.
                if (link.internal && !link.newTab) {
                  onNavigate?.(event, link.href);
                }
              }}
              onDismiss={() => finish("dismissed")}
              onSnooze={() => finish("snoozed")}
              popup={popup}
              titleId={titleId}
            />
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
