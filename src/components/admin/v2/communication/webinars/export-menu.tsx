"use client";

import { ChevronDown, Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { panelExportMenuEntries, sessionExportMenuEntries } from "@/server/webinars/export-model";
import type { PanelFilters } from "@/server/webinars/export-schemas";
import type { WebinarExportReport } from "@/server/webinars/model";

// O botao Exportar (docs/30 §3.7) com o menu dos relatorios nos nomes do Zoom: no relatorio de uma sessao (os sete; a
// pagina tira a Simulacao fora da sessao gravada com `reports`) e no painel (Performance e Simulacao do periodo, com os
// filtros da aba; a Simulacao so em Lives gravadas). Os enderecos vem de export-model.ts (os mesmos que as rotas leem);
// cada item e um link de download comum (<a download>, nunca o Link do Next: a rota devolve um arquivo). O menu do Base
// UI ja traz o teclado (setas, Esc, foco de volta no botao); o botao e os itens tem 44 px no toque e abaixo de 768 px.
// Periodo invalido no painel: nada aparece.

export type WebinarExportMenuProps =
  | { reports?: readonly WebinarExportReport[]; scope: "session"; sessionId: string; webinarId: string }
  | { end: string; filters?: Partial<PanelFilters>; kind: "live" | "simulated"; scope: "panel"; searchParams?: Record<string, string>; start: string };

const COPY = WEBINAR_COPY.exportar;

const itemClass =
  "flex min-h-[34px] w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-[var(--text-primary)] pointer-coarse:min-h-11 max-md:min-h-11 focus:bg-[var(--press-overlay)] data-highlighted:bg-[var(--press-overlay)]";

export function WebinarExportMenu(props: WebinarExportMenuProps) {
  const entries =
    props.scope === "session"
      ? sessionExportMenuEntries({ reports: props.reports, sessionId: props.sessionId, webinarId: props.webinarId })
      : panelExportMenuEntries({ end: props.end, filters: props.filters, kind: props.kind, searchParams: props.searchParams, start: props.start });

  if (entries.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: "secondary" }), "gap-2 border-[var(--border-strong)] px-4 pointer-coarse:h-11 max-md:h-11")}
        data-slot="button"
      >
        <Download aria-hidden="true" className="size-4" />
        {COPY.botao}
        <ChevronDown aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-auto max-w-[min(22rem,calc(100vw-2rem))] min-w-60 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-1 text-[var(--text-primary)] shadow-[0_14px_36px_rgba(0,0,0,0.55)] ring-0"
        sideOffset={6}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2.5 pt-1.5 pb-0.5 text-xs font-medium text-[var(--text-tertiary)]">{COPY.menuRotulo}</DropdownMenuLabel>
          {entries.map((entry) => (
            <DropdownMenuItem className={itemClass} data-relatorio={entry.report} key={entry.report} render={<a download href={entry.href} />}>
              <span className="min-w-0 flex-1">{entry.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
