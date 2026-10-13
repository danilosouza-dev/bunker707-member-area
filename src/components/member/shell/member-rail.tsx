"use client";

import { Menu } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Fragment, type MouseEvent, type RefObject } from "react";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { cn } from "@/lib/utils";
import { getMemberSidebarSections } from "./member-shell-model";
import { memberNavigationIcons } from "./member-navigation-icons";

// Trilho fixo de 80 px da area do aluno a partir de 768 px (referencia "sidebar do YouTube", sempre escuro):
// hamburguer, simbolo da marca e so os icones de cada destino, com o nome no title e para leitor de
// tela. O hamburguer abre a gaveta completa (MemberSidebar) por cima da pagina, com veu escuro; o
// trilho nunca muda de largura, entao o conteudo nunca e empurrado. Abaixo de 768 px nao ha trilho:
// o hamburguer do topo abre a mesma gaveta.

export const MEMBER_RAIL_SYMBOL_SRC = "/brand/icon-bunker.svg";

type MemberRailProps = {
  accessPreviewMode?: AccessPreviewMode;
  homeHref: string;
  /** Id da gaveta que o hamburguer abre. */
  menuId: string;
  menuOpen: boolean;
  /** Recebe o foco de volta quando a gaveta fecha (o AppShell escolhe o botao visivel). */
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  onOpenMenu: () => void;
  pathname: string;
};

export function MemberRail({
  accessPreviewMode,
  homeHref,
  menuButtonRef,
  menuId,
  menuOpen,
  onNavigate,
  onOpenMenu,
  pathname
}: MemberRailProps) {
  const sections = getMemberSidebarSections(pathname, accessPreviewMode);

  return (
    <aside
      aria-label="Menu recolhido"
      className="fixed inset-y-0 left-0 z-40 hidden w-[80px] flex-col items-center border-r border-white/[0.06] bg-[#0f0f0f] md:flex"
    >
      <div className="flex h-16 w-full shrink-0 items-center justify-center">
        <button
          aria-controls={menuId}
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          aria-label="Abrir menu"
          className="grid size-10 place-items-center rounded-full text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none"
          onClick={onOpenMenu}
          ref={menuButtonRef}
          title="Abrir menu"
          type="button"
        >
          <Menu aria-hidden="true" className="size-6" strokeWidth={1.5} />
        </button>
      </div>

      <Link
        aria-label="Ir para o início"
        className="grid size-12 shrink-0 place-items-center rounded-xl transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        href={homeHref}
        onClick={(event) => onNavigate(event, homeHref)}
        title="Início"
      >
        <Image alt="" className="size-7" height={35} priority src={MEMBER_RAIL_SYMBOL_SRC} unoptimized width={35} />
      </Link>

      <nav aria-label="Navegação da área do aluno (ícones)" className="mt-3 min-h-0 w-full flex-1 overflow-y-auto overscroll-contain px-4 pb-4 [scrollbar-width:none]">
        <ul className="flex flex-col items-center gap-1">
          {sections.map((section, sectionIndex) => (
            <Fragment key={section.id}>
              {sectionIndex > 0 ? <li aria-hidden="true" className="my-2 h-px w-14 bg-white/[0.08]" role="presentation" /> : null}
              {section.items.map((item) => {
                const Icon = memberNavigationIcons[item.key];

                return (
                  <li key={item.key}>
                    <Link
                      aria-current={item.active ? "page" : undefined}
                      className={cn(
                        "grid size-12 place-items-center rounded-xl outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80 motion-reduce:transition-none",
                        item.active ? "bg-white/[0.1] text-white" : "text-zinc-300 hover:bg-white/[0.06] hover:text-white"
                      )}
                      href={item.href}
                      onClick={(event) => onNavigate(event, item.href)}
                      title={item.label}
                    >
                      {/* Ativo: icone "preenchido" como na referencia (preenchimento leve, o traco continua). */}
                      <Icon
                        aria-hidden="true"
                        className="size-6"
                        fill={item.active ? "currentColor" : "none"}
                        fillOpacity={item.active ? 0.18 : undefined}
                        strokeWidth={1.5}
                      />
                      <span className="sr-only">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </Fragment>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
