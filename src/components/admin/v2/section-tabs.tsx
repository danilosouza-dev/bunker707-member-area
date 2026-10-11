"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { normalizeAdminPath } from "./nav";
import { adminTransition } from "./styles";

// Abas de secao (pagina do produto, Comunidade, Area de membros): links com endereco proprio e
// sublinhado de 2 px (docs/17 §2.7). Nunca misturar com pilulas de filtro na mesma linha.
// Medidas do prototipo aprovado: 40 px de altura, 4 px entre abas, sublinhado recuado 12 px dos lados
// (do comeco ao fim do texto) e contador em pilula de 20 px.

export type SectionTabItem = {
  /** Numero ao lado do rotulo (ex.: perguntas sem resposta). null/0 nao mostra. */
  count?: number | null;
  href: string;
  label: string;
  /**
   * true (padrao): ativa so no endereco exato. false: ativa tambem nos enderecos abaixo
   * (ex.: aba Conteudo continua ativa em /admin/produtos/x/aulas/y).
   */
  exact?: boolean;
};

type SectionTabsProps = {
  ariaLabel: string;
  className?: string;
  items: readonly SectionTabItem[];
  /** Parametros do endereco que seguem de uma aba para outra (ex.: ["produto", "periodo"]). */
  preserveParams?: readonly string[];
};

function isActive(pathname: string, item: SectionTabItem) {
  const href = normalizeAdminPath(item.href);

  return pathname === href || (item.exact === false && pathname.startsWith(`${href}/`));
}

export function SectionTabs({ ariaLabel, className, items, preserveParams = [] }: SectionTabsProps) {
  const pathname = normalizeAdminPath(usePathname());
  const searchParams = useSearchParams();
  const listRef = useRef<HTMLUListElement>(null);

  // No celular as abas rolam de lado (ex.: as cinco da Area de membros em 390 px). A aba ativa entra
  // inteira na faixa visivel, sem mexer na rolagem da pagina (so o scrollLeft da lista).
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[aria-current="page"]');

    if (!list || !active || list.scrollWidth <= list.clientWidth) {
      return;
    }

    const listBox = list.getBoundingClientRect();
    const itemBox = (active.parentElement ?? active).getBoundingClientRect();
    const start = itemBox.left - listBox.left + list.scrollLeft;
    const end = start + itemBox.width;

    if (start < list.scrollLeft) {
      list.scrollLeft = start;
    } else if (end > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = end - list.clientWidth;
    }
  }, [pathname]);
  const carried = new URLSearchParams();

  for (const key of preserveParams) {
    const value = searchParams.get(key);

    if (value) {
      carried.set(key, value);
    }
  }

  const query = carried.toString();
  const suffix = query ? `?${query}` : "";

  return (
    <nav aria-label={ariaLabel} className={cn("min-w-0 border-b border-[var(--border-subtle)]", className)}>
      <ul className="-mb-px flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" ref={listRef}>
        {items.map((item) => {
          const active = isActive(pathname, item);

          return (
            <li className="shrink-0" key={item.href}>
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-10 items-center gap-2 rounded-t-[6px] px-3 text-sm font-medium whitespace-nowrap outline-offset-[-2px]",
                  "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:content-['']",
                  adminTransition,
                  active
                    ? "text-[var(--text-primary)] after:bg-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] after:bg-transparent hover:text-[var(--text-primary)]"
                )}
                data-navigation-feedback="false"
                href={`${item.href}${suffix}`}
              >
                {item.label}
                {item.count ? (
                  <span className="inline-grid h-5 min-w-5 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-3)] px-1.5 text-xs leading-none font-semibold text-[var(--text-primary)] tabular-nums">
                    {item.count > 99 ? "99+" : item.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
