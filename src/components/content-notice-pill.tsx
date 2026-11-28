import { cn } from "@/lib/utils";

// Selo de liberacao no canto do card de modulo, de curso e na linha da aula: o texto curto do aviso de liberacao
// ("Liberação em 08/01", "Hoje às 14:00" ou, na liberação sem data, "Em breve" / "Em gravação" / o texto da
// equipe; src/lib/release-rules.ts). Fica visivel sem passar o mouse; o texto mais longo quebra em duas linhas.
export function ContentNoticePill({
  className,
  clockDependent = false,
  label
}: {
  className?: string;
  /** O texto usa "hoje" (depende do relogio do navegador). */
  clockDependent?: boolean;
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit max-w-full items-start gap-1 rounded-[6px] border border-white/15 bg-black/65 px-1.5 py-1 text-[9px] font-bold uppercase leading-[1.25] tracking-normal text-white backdrop-blur-sm sm:gap-1.5 sm:px-2 sm:text-[11px]",
        className
      )}
      data-release-label
    >
      <span aria-hidden="true" className="mt-[0.3em] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-warm)]" />
      <span className="line-clamp-2 min-w-0 break-words" suppressHydrationWarning={clockDependent}>
        {label}
      </span>
    </span>
  );
}
