"use client";

import { LoaderCircle, LogOut } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { MemberAvatar } from "@/components/member/ui/member-avatar";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { cn } from "@/lib/utils";
import { getMemberAccountMenuLinks } from "./member-shell-model";
import { memberNavigationIcons } from "./member-navigation-icons";

// Menu da conta no topo (avatar): Perfil, Minhas compras, Suporte e Sair. Fecha ao clicar fora, com
// Esc (o foco volta ao avatar) ou quando o foco sai do menu. Setas para cima/baixo percorrem os itens.
//
// O topo do app tem `overflow-hidden` (degrade + fundo que entra com a rolagem); por isso o painel e
// `fixed`, ancorado no canto direito logo abaixo da barra de 64 px.

type MemberAccountMenuProps = {
  accessPreviewMode?: AccessPreviewMode;
  className?: string;
  /** Navegacao que salva progresso e favoritos antes de trocar de pagina (AppShell). */
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  onSignOut: () => void;
  pathname: string;
  signingOut: boolean;
  student: {
    avatarUrl?: string | null;
    fullName: string;
    name: string;
  };
};

export function MemberAccountMenu({
  accessPreviewMode,
  className,
  onNavigate,
  onSignOut,
  pathname,
  signingOut,
  student
}: MemberAccountMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const links = getMemberAccountMenuLinks(pathname, accessPreviewMode);
  const displayName = student.fullName || student.name;

  function getItems() {
    return Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-member-account-item]") ?? []).filter(
      (item) => !item.hasAttribute("disabled")
    );
  }

  function closeMenu(restoreFocus: boolean) {
    setOpen(false);

    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }

  // Clique ou toque fora fecha sem roubar o foco de onde a pessoa clicou.
  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) {
        return;
      }

      setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  // Ao abrir, o foco vai para o primeiro item (no mouse o anel de foco nao aparece).
  useEffect(() => {
    if (!open) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>("[data-member-account-item]")?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && open) {
      // Nao deixa o Esc chegar na IA Diretor aberta ao lado.
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
      return;
    }

    if (!open) {
      if (event.key === "ArrowDown" && event.target === triggerRef.current) {
        event.preventDefault();
        setOpen(true);
      }

      return;
    }

    const items = getItems();

    if (items.length === 0) {
      return;
    }

    event.preventDefault();
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    let nextIndex = 0;

    if (event.key === "End") {
      nextIndex = items.length - 1;
    } else if (event.key === "ArrowDown") {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    } else if (event.key === "ArrowUp") {
      nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    }

    items[nextIndex]?.focus();
  }

  return (
    <div
      className={cn("relative shrink-0", className)}
      onBlur={(event) => {
        // Tab para fora do menu fecha (sem puxar o foco de volta). Saindo, o menu fica aberto com "Saindo...".
        if (open && !signingOut && !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) {
          setOpen(false);
        }
      }}
      onKeyDown={handleKeyDown}
      ref={rootRef}
    >
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-label={`Menu da conta de ${displayName}`}
        className={cn(
          // So o avatar (como no YouTube): o nome aparece dentro do painel.
          "grid size-10 place-items-center rounded-full transition-colors duration-150 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
          open ? "bg-white/10" : "bg-black/10"
        )}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <MemberAvatar imageSrc={student.avatarUrl} name={displayName} size="sm" />
      </button>

      {open ? (
        <div
          aria-label="Sua conta"
          className="fixed right-4 top-[60px] z-50 w-[min(17.5rem,calc(100vw-2rem))] origin-top-right rounded-[14px] border border-white/10 bg-[#1b1b1b]/95 p-1.5 shadow-[0_24px_70px_rgba(0,0,0,0.65)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none sm:right-6"
          id={menuId}
          role="region"
        >
          <div className="flex items-center gap-3 px-2.5 pb-3 pt-2.5">
            <MemberAvatar imageSrc={student.avatarUrl} name={displayName} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{displayName}</p>
              <p className="mt-0.5 text-xs font-medium text-zinc-400">Sua conta</p>
            </div>
          </div>

          <div aria-hidden="true" className="mx-1 h-px bg-white/[0.08]" />

          <ul className="py-1">
            {links.map((link) => {
              const Icon = memberNavigationIcons[link.key];

              return (
                <li key={link.key}>
                  <Link
                    aria-current={link.active ? "page" : undefined}
                    className={cn(
                      "flex h-10 items-center gap-3 rounded-[9px] px-2.5 text-sm font-medium outline-none transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/40",
                      link.active ? "text-white" : "text-zinc-200"
                    )}
                    data-member-account-item
                    href={link.href}
                    onClick={(event) => {
                      setOpen(false);
                      onNavigate(event, link.href);
                    }}
                  >
                    <Icon
                      aria-hidden="true"
                      className={cn("size-[18px] shrink-0", link.active ? "text-[var(--accent)]" : "text-zinc-400")}
                      strokeWidth={2}
                    />
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div aria-hidden="true" className="mx-1 h-px bg-white/[0.08]" />

          <div className="pt-1">
            <button
              className="flex h-10 w-full items-center gap-3 rounded-[9px] px-2.5 text-left text-sm font-medium text-zinc-200 outline-none transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/40 disabled:cursor-wait disabled:opacity-70"
              data-member-account-item
              disabled={signingOut}
              onClick={onSignOut}
              type="button"
            >
              {signingOut ? (
                <LoaderCircle aria-hidden="true" className="size-[18px] shrink-0 animate-spin text-zinc-400 motion-reduce:animate-none" />
              ) : (
                <LogOut aria-hidden="true" className="size-[18px] shrink-0 text-zinc-400" strokeWidth={2} />
              )}
              {signingOut ? "Saindo..." : "Sair"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
