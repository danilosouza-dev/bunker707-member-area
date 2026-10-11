"use client";

import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { CommunityStats } from "@/server/community/types";
import { EMPTY_VALUE } from "../format";
import { buildCommunityStatCells } from "./stats-model";

// Quatro numeros do topo da Comunidade numa faixa unica (prototipo aprovado, shot 13): rotulo
// 13/500, numero 24/600 tabular, linha de apoio 12/500. Formula ao passar o mouse (docs/17 §1.11).
// Duas colunas abaixo de 1024 px. Sem dado, "—"; nunca um numero de exemplo.

export function CommunityStatStrip({ className, stats }: { className?: string; stats: CommunityStats }) {
  const cells = buildCommunityStatCells(stats);

  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--border-subtle)] lg:grid-cols-4",
        className
      )}
      role="list"
    >
      {cells.map((cell) => (
        <div
          aria-label={`${cell.label}: ${cell.value}, ${cell.sub}`}
          className="flex min-w-0 flex-col gap-0.5 bg-[var(--surface-1)] px-4 py-3.5"
          key={cell.label}
          role="listitem"
        >
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-secondary)]">
            <span className="truncate">{cell.label}</span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    aria-label={`Como calculamos: ${cell.label}`}
                    className="grid size-5 shrink-0 place-items-center rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                    type="button"
                  />
                }
              >
                <Info aria-hidden="true" className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent className="max-w-72 text-left leading-5" side="bottom">
                {cell.formula}
              </TooltipContent>
            </Tooltip>
          </span>
          <span
            aria-hidden="true"
            className={cn(
              "text-2xl leading-8 font-semibold tracking-[-0.015em] tabular-nums",
              cell.value === EMPTY_VALUE ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]"
            )}
          >
            {cell.value}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              "text-xs leading-5 font-medium lg:truncate",
              cell.subTone === "warning" ? "text-[var(--warning)]" : "text-[var(--text-tertiary)]"
            )}
          >
            {cell.sub}
          </span>
        </div>
      ))}
    </div>
  );
}
