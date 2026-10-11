"use client";

import { ChevronRight, LoaderCircle, LogOut, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, type MouseEvent, type ReactNode, type RefObject } from "react";
import { MemberAvatar } from "@/components/member/ui/member-avatar";
import { withAccessPreviewParam, type AccessPreviewMode } from "@/lib/access-preview";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { MEMBER_ROUTES, isMemberNavigationItemActive } from "@/lib/member-navigation";
import { cn } from "@/lib/utils";
import { getMemberSidebarSections } from "./member-shell-model";
import { memberNavigationIcons } from "./member-navigation-icons";

// Barra lateral do aluno (menu hamburguer). Gaveta modal: abre focando o primeiro item, prende o foco
// enquanto aberta, fecha com Esc/X/fundo e devolve o foco ao botao do menu. Fechada fica `inert`
// (fora do teclado e do leitor de tela), nao so escondida.

type MemberSidebarProps = {
  accessPreviewMode?: AccessPreviewMode;
  homeHref: string;
  id: string;
  /** Logo da escola; texto quando vazio. */
  logoImage?: string | null;
  onClose: () => void;
  /** Navegacao que salva progresso e favoritos antes de trocar de pagina (AppShell). */
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  onSignOut: () => void;
  open: boolean;
  pathname: string;
  /** Bloco "Área do produtor" (so para quem pode usar a visualizacao como aluno). */
  producerPanel?: ReactNode;
  /** Botao do menu no topo: recebe o foco de volta ao fechar. */
  returnFocusRef: RefObject<HTMLElement | null>;
  signingOut: boolean;
  student: {
    fullName: string;
    name: string;
  };
};

const focusableSelector =
  'a[href], button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function MemberSidebar({
  accessPreviewMode,
  homeHref,
  id,
  logoImage,
  onClose,
  onNavigate,
  onSignOut,
  open,
  pathname,
  producerPanel,
  returnFocusRef,
  signingOut,
  student
}: MemberSidebarProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const sections = getMemberSidebarSections(pathname, accessPreviewMode);
  const profileHref = withAccessPreviewParam(MEMBER_ROUTES.profile, accessPreviewMode);
  const profileActive = isMemberNavigationItemActive(MEMBER_ROUTES.profile, pathname);

  // Abrir foca o primeiro item; fechar devolve o foco ao botao do menu (se ele estava na gaveta).
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      const frame = window.requestAnimationFrame(() => {
        panelRef.current?.querySelector<HTMLElement>("[data-member-sidebar-item]")?.focus();
      });

      return () => window.cancelAnimationFrame(frame);
    }

    if (!wasOpenRef.current) {
      return;
    }

    wasOpenRef.current = false;
    const activeElement = document.activeElement;

    if (!activeElement || activeElement === document.body || panelRef.current?.contains(activeElement)) {
      returnFocusRef.current?.focus();
    }
  }, [open, returnFocusRef]);

  // Esc fecha; Tab e Shift+Tab circulam dentro da gaveta.
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      const panel = panelRef.current;

      if (event.key !== "Tab" || !panel) {
        return;
      }

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector));

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (!activeElement || !panel.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  // Trava a rolagem da pagina enquanto a gaveta esta aberta (sem pular a largura da barra de rolagem).
  useEffect(() => {
    if (!open) {
      return;
    }

    const { body, documentElement } = document;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;

    body.style.overflow = "hidden";

    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, [open]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50",
        // Abre visivel na hora (o foco ja pode entrar); ao fechar, some so depois do deslize.
        open ? "visible" : "pointer-events-none invisible transition-[visibility] duration-300 motion-reduce:transition-none"
      )}
      data-state={open ? "open" : "closed"}
      inert={!open}
    >
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-0 bg-black/70 backdrop-blur-[3px] transition-opacity duration-300 ease-out motion-reduce:transition-none",
          open ? "opacity-100" : "opacity-0"
        )}
        onClick={onClose}
      />

      <div
        aria-label="Menu"
        aria-modal="true"
        className={cn(
          "relative flex h-full w-[min(340px,88vw)] flex-col border-r border-white/[0.07] bg-[#101010] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-[28px_0_90px_rgba(0,0,0,0.55)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        id={id}
        ref={panelRef}
        role="dialog"
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-3 pl-5 pr-3">
          <Link
            aria-label="Ir para o início"
            className="inline-flex min-w-0 rounded-[6px] transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            href={homeHref}
            onClick={(event) => onNavigate(event, homeHref)}
          >
            {logoImage ? (
              <Image
                alt="Bunker707"
                className="h-auto max-h-10 w-[168px] object-contain object-left"
                height={35}
                src={logoImage}
                unoptimized={!canOptimizeImageSrc(logoImage)}
                width={306}
              />
            ) : (
              <span className="text-lg font-black uppercase text-white">Bunker707</span>
            )}
          </Link>
          <button
            aria-label="Fechar menu"
            className="grid size-10 shrink-0 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        {producerPanel ? <div className="shrink-0 px-3 pb-2 pt-1">{producerPanel}</div> : null}

        <nav aria-label="Navegação da área do aluno" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
          {sections.map((section) => {
            const sectionTitleId = `${id}-${section.id}`;

            return (
              <div className="mt-4 first:mt-2" key={section.id}>
                <p className="px-4 pb-1.5 text-xs font-semibold text-zinc-500" id={sectionTitleId}>
                  {section.label}
                </p>
                <ul aria-labelledby={sectionTitleId} className="space-y-0.5">
                  {section.items.map((item) => {
                    const Icon = memberNavigationIcons[item.key];

                    return (
                      <li key={item.key}>
                        <Link
                          aria-current={item.active ? "page" : undefined}
                          className={cn(
                            "group/item relative flex h-11 items-center gap-3 rounded-[10px] pl-4 pr-3 text-sm font-semibold outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80",
                            item.active ? "bg-white/[0.08] text-white" : "text-zinc-300 hover:bg-white/[0.05] hover:text-white"
                          )}
                          data-member-sidebar-item
                          href={item.href}
                          onClick={(event) => onNavigate(event, item.href)}
                        >
                          {item.active ? (
                            <span aria-hidden="true" className="absolute inset-y-2.5 left-0 w-[3px] rounded-full bg-[var(--accent)]" />
                          ) : null}
                          <Icon
                            aria-hidden="true"
                            className={cn(
                              "size-5 shrink-0 transition-colors",
                              item.active ? "text-[var(--accent)]" : "text-zinc-500 group-hover/item:text-zinc-200"
                            )}
                            strokeWidth={2}
                          />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-white/[0.07] p-3">
          <Link
            aria-current={profileActive ? "page" : undefined}
            className="group/account flex items-center gap-3 rounded-[12px] p-2.5 outline-none transition-colors hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80"
            href={profileHref}
            onClick={(event) => onNavigate(event, profileHref)}
          >
            <MemberAvatar name={student.fullName || student.name} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-white">{student.fullName || student.name}</span>
              <span className="mt-0.5 block text-xs font-medium text-zinc-400 transition-colors group-hover/account:text-zinc-200">
                Ver perfil
              </span>
            </span>
            <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-zinc-500 transition group-hover/account:translate-x-0.5 group-hover/account:text-zinc-200 motion-reduce:transition-none" />
          </Link>
          <button
            className="mt-1 flex h-11 w-full items-center gap-3 rounded-[10px] pl-4 pr-3 text-left text-sm font-semibold text-zinc-400 outline-none transition-colors hover:bg-white/[0.05] hover:text-white focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80 disabled:cursor-wait disabled:hover:bg-transparent"
            disabled={signingOut}
            onClick={onSignOut}
            type="button"
          >
            {signingOut ? (
              <LoaderCircle aria-hidden="true" className="size-5 shrink-0 animate-spin motion-reduce:animate-none" />
            ) : (
              <LogOut aria-hidden="true" className="size-5 shrink-0" strokeWidth={2} />
            )}
            {signingOut ? "Saindo..." : "Sair"}
          </button>
        </div>
      </div>
    </div>
  );
}
