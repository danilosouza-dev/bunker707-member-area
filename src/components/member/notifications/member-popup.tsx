"use client";

import { ArrowRight, ExternalLink, X } from "lucide-react";
import Image from "next/image";
import type { MouseEvent } from "react";
import { memberButtonClassName } from "@/components/member/ui/member-button";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { cn } from "@/lib/utils";
import type { PopupItem } from "@/server/communications/notification-model";
import { NoticeAudioPlayer } from "./notice-audio-player";
import { NoticeTitleIcon } from "./notice-icons";
import { resolveNotificationLink, type NotificationLink } from "./notifications-model";
import { PopupDesignCard } from "./popup-design/popup-design-card";

// Pop-up do aluno (docs/22 §1.3; v3b-1 em docs/25): nas paginas, no momento e na frequencia que a equipe
// escolheu, um de cada vez, so quando nada mais esta aberto por cima e a aba esta visivel (na aula, nunca
// com o nosso player tocando). "Lembrar depois" (volta no tempo escolhido, ate 2 vezes, se o aviso
// permitir), "Não mostrar de novo" e fechar: no X, no Esc ou clicando fora, ou "Só no X" (o Esc continua
// fechando; um toque fora so faz o X pulsar). O X tem 36 px visiveis e 44 px de toque.
//
// Tres partes: MemberPopupCard (aqui) so desenha; a previa do admin usa o mesmo cartao com `preview`,
// dentro de moldura inert reduzida, por isso a largura usa `cqw` e o respiro interno responde ao
// proprio cartao, nunca a janela. MemberPopupHost (member-popup-host.tsx, em toda pagina do aluno) busca
// e decide a hora de mostrar; MemberPopupDialog (member-popup-dialog.tsx) e a janela, baixada so quando
// existe um pop-up para mostrar.
//
// O icone do aviso (docs/23) vai antes do titulo, dentro do <h2> (20 px, aria-hidden: o nome do dialogo
// continua sendo o titulo). O audio do pop-up nao guarda o ouvido (sem `listen`): e o player da v1.
//
// Design do pop-up (docs/26): com `popup.design` ("Personalizado"), o cartao e o PopupDesignCard
// (popup-design/), com as mesmas props; sem design ("Padrão"), exatamente o cartao de sempre.

export type MemberPopupCardProps = {
  accessPreviewMode?: AccessPreviewMode;
  /** id do texto (aria-describedby do dialogo). */
  bodyId?: string;
  /** "Só no X": o toque fora faz o X pulsar por 300 ms (nada sob prefers-reduced-motion). */
  nudgeClose?: boolean;
  onClose?: () => void;
  onCta?: (event: MouseEvent<HTMLAnchorElement>, link: NotificationLink) => void;
  onDismiss?: () => void;
  onSnooze?: () => void;
  /** Personalizado: false pausa o video (a janela fechando); padrao true. O Padrão nao tem video. */
  playing?: boolean;
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

export function MemberPopupCard({ playing, ...props }: MemberPopupCardProps) {
  const { design, fonts } = props.popup;

  return design ? <PopupDesignCard {...props} design={design} fonts={fonts} playing={playing} /> : <DefaultPopupCard {...props} />;
}

/** O cartao "Padrão" (o de sempre). */
function DefaultPopupCard({
  accessPreviewMode,
  bodyId,
  nudgeClose = false,
  onClose,
  onCta,
  onDismiss,
  onSnooze,
  popup,
  preview = false,
  titleId
}: Omit<MemberPopupCardProps, "playing">) {
  const image = popup.image?.url ? popup.image : null;
  const snoozeClassName = memberButtonClassName({ className: "-ml-3", size: "sm", variant: "ghost" });
  const dismissClassName = memberButtonClassName({ className: "-mr-3 ml-auto text-zinc-400", size: "sm", variant: "ghost" });
  // 36 px visiveis e 44 px de toque (a caixa invisivel do before: passa 4 px de cada lado). O pulso usa a
  // propriedade `scale` (Tailwind 4), por isso ela entra na transicao.
  const closeClassName = cn(
    "absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition-[background-color,scale] duration-150 hover:bg-black/75 motion-reduce:transition-none before:absolute before:-inset-1 before:rounded-full before:content-['']",
    nudgeClose && "motion-safe:scale-[1.12]",
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
            <NoticeTitleIcon icon={popup.icon} size="popup" />
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
