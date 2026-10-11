"use client";

import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// Classes compartilhadas das telas da Comunidade e o menu "..." das linhas.

export const menuContentClass =
  "w-60 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-1 text-[var(--text-primary)] ring-0";
export const menuItemClass =
  "h-9 gap-2 rounded-md px-2 text-sm text-[var(--text-primary)] focus:bg-[var(--surface-2)] [&_svg]:text-[var(--text-secondary)]";

/** Botao das acoes de linha: 32 px no desktop, 44 px de alvo no celular. */
export const rowButtonClass = "h-11! px-4 text-[13px] md:h-8! md:px-3";

/** Botao so de icone (menu "..."): 44 px no celular, 32 px no desktop. */
export const rowIconButtonClass =
  "size-11! min-w-11! text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)] md:size-8! md:min-w-8!";

export type RowMenuAction = {
  /** Abre outro endereco (nova aba quando `external`). */
  external?: boolean;
  href?: string;
  icon: LucideIcon;
  label: string;
  onSelect?: () => void;
  separatorBefore?: boolean;
};

type RowMenuProps = {
  actions: readonly RowMenuAction[];
  disabled?: boolean;
  /** Nome acessivel do botao, ex.: "Mais ações para o comentário de Ana". */
  label: string;
};

export function RowMenu({ actions, disabled = false, label }: RowMenuProps) {
  const router = useRouter();

  if (actions.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button aria-label={label} className={rowIconButtonClass} disabled={disabled} size="icon" type="button" variant="ghost" />}
      >
        <MoreHorizontal aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={menuContentClass}>
        {actions.map((action) => (
          <Fragment key={action.label}>
            {action.separatorBefore ? <DropdownMenuSeparator className="bg-[var(--border-subtle)]" /> : null}
            <DropdownMenuItem
              className={cn(menuItemClass)}
              onClick={() => {
                if (action.href) {
                  if (action.external) {
                    window.open(action.href, "_blank", "noopener,noreferrer");
                  } else {
                    router.push(action.href);
                  }

                  return;
                }

                action.onSelect?.();
              }}
            >
              <action.icon aria-hidden="true" className="size-4" />
              {action.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
