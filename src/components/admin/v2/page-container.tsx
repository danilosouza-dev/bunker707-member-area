import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Area util de uma tela do admin, na medida do prototipo aprovado: ate 1440 px, respiro lateral
 * clamp(16px, 3vw, 32px) (o mesmo da barra superior, entao a busca alinha com o conteudo), 24 px em
 * cima e 112 px no fim. 32 px entre secoes (gap-8); telas de uma secao so usam `className="gap-6"`
 * para o cabecalho ficar a 24 px do conteudo.
 */
export function AdminPage({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("mx-auto flex w-full max-w-[1440px] flex-col gap-8 px-[clamp(16px,3vw,32px)] pt-6 pb-28", className)}
      {...props}
    />
  );
}
