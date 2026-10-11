import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Estado vazio honesto: diz o que falta e qual o proximo passo real (nunca dado inventado).
// Ex.: "Você ainda não começou nenhuma aula" + botao "Ver minhas compras".

export function MemberEmptyState({
  action,
  className,
  description,
  icon: Icon,
  size = "default",
  title
}: {
  /** Botoes/links do proximo passo (use MemberButtonLink). */
  action?: ReactNode;
  className?: string;
  description?: ReactNode;
  icon: LucideIcon;
  /** "compact" para dentro de abas e paineis (ex.: aba Materiais da aula). */
  size?: "compact" | "default";
  title: ReactNode;
}) {
  const compact = size === "compact";

  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-[12px] border border-dashed border-white/[0.12] bg-white/[0.02] text-center",
        compact ? "px-5 py-8" : "px-6 py-12 sm:py-16",
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid place-items-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-300",
          compact ? "size-11" : "size-14"
        )}
      >
        <Icon className={compact ? "size-5" : "size-6"} strokeWidth={1.9} />
      </span>
      <h2 className={cn("font-bold text-white", compact ? "mt-4 text-[15px]" : "mt-5 text-lg")}>{title}</h2>
      {description ? (
        <p className={cn("mx-auto max-w-md text-zinc-400", compact ? "mt-1.5 text-[13px] leading-5" : "mt-2 text-sm leading-6")}>
          {description}
        </p>
      ) : null}
      {action ? <div className={cn("flex flex-wrap items-center justify-center gap-2", compact ? "mt-4" : "mt-6")}>{action}</div> : null}
    </div>
  );
}
