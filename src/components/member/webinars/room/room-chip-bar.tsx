"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { ROOM_FOCUS } from "./room-ui";

// Os chips da sala no estilo do YouTube (docs/31, a sala no estilo do YouTube): os filtros das Perguntas no painel e,
// abaixo de lg, as abas da folha. So da sala do aluno: o console continua com as abas em pilula (RoomTabList). O chip
// tem 32 px, raio 8, 14/20 peso 500 e recuo de 12; o escolhido e o branco do YouTube (--room-active-bg), os outros o
// tonal (--room-control), com o hover tonal do botao (o YouTube nao tem regra de hover no chip: inferido). A troca de
// fundo e instantanea, como na pilula, e o pressionado e a mesma sombra por dentro. Como filtro (`toggle`), o estado vai
// em aria-pressed, com um so ligado; como aba (`tab`), em role="tab" com aria-selected.

const CHIP_BASE = cn(
  "inline-flex h-8 shrink-0 select-none items-center justify-center whitespace-nowrap rounded-[8px] px-3 text-sm font-medium leading-5 active:shadow-[inset_0_0_0_999px_var(--room-press-overlay)] disabled:bg-room-control disabled:text-room-fg-disabled disabled:shadow-none disabled:hover:bg-room-control",
  ROOM_FOCUS
);

/** Um chip: o escolhido em branco, os outros no tonal. */
export function RoomChip({
  as = "toggle",
  className,
  selected,
  touch44 = false,
  type = "button",
  ...props
}: Omit<ComponentProps<"button">, "aria-pressed" | "aria-selected" | "role"> & {
  /** Filtro (aria-pressed) ou aba (role="tab" e aria-selected). */
  as?: "tab" | "toggle";
  selected: boolean;
  /** A area de toque de 44 px abaixo de lg (o chip tem 32). */
  touch44?: boolean;
}) {
  return (
    <button
      {...props}
      aria-pressed={as === "toggle" ? selected : undefined}
      aria-selected={as === "tab" ? selected : undefined}
      className={cn(
        CHIP_BASE,
        selected ? "bg-room-active-bg text-room-active-fg hover:bg-room-active-hover" : "bg-room-control text-room-fg hover:bg-room-control-hover",
        touch44 ? "relative after:absolute after:-inset-1.5 lg:after:hidden" : undefined,
        className
      )}
      role={as === "tab" ? "tab" : undefined}
      type={type}
    />
  );
}
