import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Numeros do topo das paginas (Minhas compras, Minha jornada). So numeros reais do aluno; quando nao
// ha dado, nao mostre o numero (nada de "0%" fingindo progresso medio).

export function MemberStat({
  hint,
  icon: Icon,
  label,
  value
}: {
  hint?: ReactNode;
  icon?: LucideIcon;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-[12px] border border-white/[0.08] bg-[#181818] px-4 py-3.5">
      {Icon ? (
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-white/[0.07] text-zinc-200">
          <Icon className="size-[18px]" strokeWidth={2} />
        </span>
      ) : null}
      <div className="min-w-0">
        <p className="text-xl font-black leading-none tabular-nums text-white sm:text-2xl">{value}</p>
        <p className="mt-1 text-xs font-medium leading-4 text-zinc-400">{label}</p>
        {hint ? <p className="mt-0.5 truncate text-[11px] text-zinc-500">{hint}</p> : null}
      </div>
    </div>
  );
}

export function MemberStatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>{children}</div>;
}
