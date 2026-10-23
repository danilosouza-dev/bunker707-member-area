"use client";

import { ChevronDown, Plus } from "lucide-react";
import Link from "next/link";
import type { JSX } from "react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { RecentTemplate } from "@/server/communications/template-queries";
import { AdminLinkButton } from "../../link-button";
import { NEW_NOTICE_HREF } from "../notices-view-model";
import { TEMPLATE_COPY, newNoticeMenu } from "./templates-view-model";

// "Novo aviso" com modelos (docs/28; spec §5.4, D23): sem nenhum modelo, o link de sempre para /avisos/novo (o
// filtro ?tipo da lista nao muda o link). Com modelos, um menu (molde do "Criar" do Hoje): "Começar em branco", os 5
// modelos mais recentes (de qualquer tipo, com o tipo a direita) e "Ver todos os modelos (n)". /avisos/novo continua
// abrindo o editor em branco, sem passo extra.

const itemClass =
  "flex min-h-[34px] w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-[var(--text-primary)] pointer-coarse:min-h-11 focus:bg-[var(--press-overlay)] data-highlighted:bg-[var(--press-overlay)]";

export function NewNoticeButton({ recent }: { recent: { items: RecentTemplate[]; total: number } }): JSX.Element {
  const entries = newNoticeMenu(recent);

  if (!entries) {
    return (
      <AdminLinkButton href={NEW_NOTICE_HREF}>
        <Plus aria-hidden="true" className="size-4" />
        {TEMPLATE_COPY.newNotice.label}
      </AdminLinkButton>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(buttonVariants({ variant: "default" }), "gap-2 px-4")} data-slot="button">
        <Plus aria-hidden="true" className="size-4" />
        {TEMPLATE_COPY.newNotice.label}
        <ChevronDown aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-auto max-w-[min(22rem,calc(100vw-2rem))] min-w-56 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-1 text-[var(--text-primary)] shadow-[0_14px_36px_rgba(0,0,0,0.55)] ring-0"
        sideOffset={6}
      >
        <DropdownMenuGroup>
          {entries.map((entry, index) => {
            if (entry.kind === "separator") {
              return <DropdownMenuSeparator className="bg-[var(--border-subtle)]" key={`separador-${index}`} />;
            }

            if (entry.kind === "label") {
              return (
                <DropdownMenuLabel className="px-2.5 pt-1.5 pb-0.5 text-xs font-medium text-[var(--text-tertiary)]" key={`rotulo-${index}`}>
                  {entry.label}
                </DropdownMenuLabel>
              );
            }

            return (
              <DropdownMenuItem className={itemClass} key={entry.href} render={<Link data-navigation-feedback="false" href={entry.href} />}>
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.meta ? <span className="ml-4 shrink-0 text-xs text-[var(--text-tertiary)]">{entry.meta}</span> : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
