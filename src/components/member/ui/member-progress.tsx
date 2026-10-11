import { clampMemberPercent } from "@/lib/member-format";
import { cn } from "@/lib/utils";

// Barra de progresso fina (docs/12: trilho discreto, vermelho da marca; concluido em verde).

export function MemberProgressBar({
  className,
  label,
  size = "md",
  value
}: {
  className?: string;
  /** Nome acessivel, ex.: "Progresso de Curso de IA". */
  label: string;
  size?: "md" | "sm";
  value: number;
}) {
  const percent = clampMemberPercent(value);

  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
      className={cn("w-full overflow-hidden rounded-full bg-white/[0.14]", size === "sm" ? "h-1" : "h-1.5", className)}
      role="progressbar"
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none",
          percent >= 100 ? "bg-emerald-500" : "bg-[var(--accent)]"
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
