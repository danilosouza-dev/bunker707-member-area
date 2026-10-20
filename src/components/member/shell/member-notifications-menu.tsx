"use client";

import { Popover } from "@base-ui/react/popover";
import { Bell } from "lucide-react";
import { useRef, useState, type MouseEvent } from "react";
import { NotificationsPanel } from "@/components/member/notifications/notifications-panel";
import { useEscapeToClose, useNotificationsSummary } from "@/components/member/notifications/notifications-client";
import { bellLabel, formatBadgeCount } from "@/components/member/notifications/notifications-model";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { cn } from "@/lib/utils";

// Sino do aluno no topo, entre a busca e a conta (docs/22 §5): o numero vermelho conta o que chegou
// desde a ultima abertura (nunca um numero inventado) e o painel mostra a caixa dos ultimos 90 dias:
// avisos da escola e respostas/mencoes nos comentarios. O painel vai em portal (o topo tem
// `overflow-hidden`) e so monta aberto; o numero vem de uma memoria fora do React que sobrevive a
// troca de pagina (notifications-client.ts).

export function MemberNotificationsMenu({
  accessPreviewMode,
  className,
  onNavigate,
  schoolLogoUrl,
  schoolName
}: {
  accessPreviewMode?: AccessPreviewMode;
  className?: string;
  /** Navegacao do AppShell (salva progresso e favoritos antes de trocar de pagina). */
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  schoolLogoUrl?: string | null;
  schoolName: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const { unseen } = useNotificationsSummary();
  const badge = formatBadgeCount(unseen);

  useEscapeToClose(
    open,
    () => {
      setOpen(false);
      triggerRef.current?.focus();
    },
    (target) => Boolean(popupRef.current?.contains(target) || triggerRef.current?.contains(target))
  );

  return (
    <Popover.Root onOpenChange={setOpen} open={open}>
      <Popover.Trigger
        aria-label={bellLabel(unseen)}
        className={cn(
          "relative grid size-10 shrink-0 place-items-center rounded-full text-white outline-none transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white data-popup-open:bg-white/10 motion-reduce:transition-none",
          className
        )}
        ref={triggerRef}
      >
        <Bell aria-hidden="true" className="size-5" />
        {badge ? (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--accent)] px-1 text-[11px] font-bold leading-none tabular-nums text-white ring-2 ring-[#141414]"
          >
            {badge}
          </span>
        ) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" className="z-50 outline-none" collisionPadding={12} side="bottom" sideOffset={10}>
          <Popover.Popup
            className="w-[min(25rem,calc(100vw-1.5rem))] origin-[var(--transform-origin)] overflow-hidden rounded-[14px] border border-white/10 bg-[#1b1b1b]/95 p-0 text-white shadow-[0_24px_70px_rgba(0,0,0,0.65)] outline-none backdrop-blur-xl transition-[opacity,transform] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none"
            // Foco no painel (o leitor anuncia "Notificações"); o Tab segue para os filtros e a lista.
            initialFocus={popupRef}
            ref={popupRef}
          >
            <NotificationsPanel
              accessPreviewMode={accessPreviewMode}
              onClose={() => setOpen(false)}
              onNavigate={onNavigate}
              schoolLogoUrl={schoolLogoUrl}
              schoolName={schoolName}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
