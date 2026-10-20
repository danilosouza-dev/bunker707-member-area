"use client";

import { Popover } from "@base-ui/react/popover";
import { Bell, RotateCw } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, useState, type ComponentProps, type ComponentType, type MouseEvent } from "react";
import { useEscapeToClose, useNotificationsSummary } from "@/components/member/notifications/notifications-client";
import { bellLabel, formatBadgeCount } from "@/components/member/notifications/notifications-model";
import type { NotificationsPanel as NotificationsPanelComponent } from "@/components/member/notifications/notifications-panel";
import { MemberButton } from "@/components/member/ui/member-button";
import { MemberSkeletonBlock } from "@/components/member/ui/member-skeletons";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { cn } from "@/lib/utils";

// Sino do aluno no topo, entre a busca e a conta (docs/22 §1.1; desenho em docs/12): o numero vermelho conta o que chegou
// desde a ultima abertura (nunca um numero inventado) e o painel mostra a caixa dos ultimos 90 dias:
// avisos da escola e respostas/mencoes nos comentarios. O painel vai em portal (o topo tem
// `overflow-hidden`) e so monta aberto; o numero vem de uma memoria fora do React que sobrevive a
// troca de pagina (notifications-client.ts). O codigo do painel (lista, cartoes, player) so e baixado
// quando o aluno chega perto do sino (mouse em cima ou foco), como a IA Diretor; se o download falha
// (rede, ou deploy novo que trocou os arquivos), o erro fica dentro do painel e a pagina continua.
//
// O painel fica acima da IA Diretor aberta (z-180) e abaixo do pop-up da home (z-200), que espera o sino
// fechar.

const loadNotificationsPanel = () => import("@/components/member/notifications/notifications-panel");

function PanelLoading() {
  return (
    <div className="px-4 py-4">
      <p className="sr-only" role="status">
        Carregando notificações
      </p>
      <MemberSkeletonBlock className="h-4 w-28" />
      {["first", "second", "third"].map((row) => (
        <div className="grid grid-cols-[40px_minmax(0,1fr)] gap-3 pt-5" key={row}>
          <MemberSkeletonBlock className="size-10 rounded-full" />
          <span className="block space-y-2 pt-1">
            <MemberSkeletonBlock className="h-3.5 w-4/5" />
            <MemberSkeletonBlock className="h-3 w-3/5" />
          </span>
        </div>
      ))}
    </div>
  );
}

type NotificationsPanelProps = ComponentProps<typeof NotificationsPanelComponent>;

/** O painel nao baixou: o aviso fica no proprio painel (sem a tela de erro geral) e recarregar resolve. */
function PanelLoadFailed() {
  return (
    <div className="flex flex-col">
      <div className="flex min-h-[3.75rem] items-center px-4 pb-3 pt-4">
        <Popover.Title className="text-base font-semibold text-white">Notificações</Popover.Title>
      </div>
      <div className="mx-4 mb-4 flex flex-col items-start gap-3 rounded-[12px] border border-red-400/20 bg-red-500/[0.07] px-4 py-4" role="alert">
        <p className="text-sm font-medium text-red-100">Não foi possível abrir as notificações.</p>
        <MemberButton onClick={() => window.location.reload()} size="sm" variant="secondary">
          <RotateCw aria-hidden="true" />
          Recarregar a página
        </MemberButton>
      </div>
    </div>
  );
}

const NotificationsPanel = dynamic(
  () =>
    loadNotificationsPanel()
      .then((module) => module.NotificationsPanel)
      // Sem o catch, a falha do download subiria ate a tela de erro geral (global-error) e a pagina inteira sumiria.
      .catch((): ComponentType<NotificationsPanelProps> => PanelLoadFailed),
  {
    loading: () => <PanelLoading />,
    ssr: false
  }
);

/** Comeca a baixar o painel antes do clique (falha aqui nao importa: o clique tenta de novo). */
function preloadPanel() {
  void loadNotificationsPanel().catch(() => undefined);
}

export function MemberNotificationsMenu({
  accessPreviewMode,
  className,
  onNavigate,
  refreshSummaryOnMount = true,
  schoolLogoUrl,
  schoolName
}: {
  accessPreviewMode?: AccessPreviewMode;
  className?: string;
  /** Navegacao do AppShell (salva progresso e favoritos antes de trocar de pagina). */
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  /** false na home: o numero vem no pedido do pop-up (MemberPopupHost), um pedido so. */
  refreshSummaryOnMount?: boolean;
  schoolLogoUrl?: string | null;
  schoolName: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const { unseen } = useNotificationsSummary({ refreshOnMount: refreshSummaryOnMount });
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
        onFocus={preloadPanel}
        onPointerEnter={preloadPanel}
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
        <Popover.Positioner align="end" className="z-[190] outline-none" collisionPadding={12} side="bottom" sideOffset={10}>
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
