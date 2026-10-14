import { Check } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

// Anel de progresso dos cards de produto da home (cursos, formacoes etc.): aparece no hover, no canto de
// cima do card, e se preenche ate a porcentagem. De proposito e diferente da barra horizontal dos cards
// de modulo, para o aluno nao confundir produto com modulo. Concluido vira um anel verde com um check.
// O preenchimento e CSS (globals.css, .progress-ring-value) a partir das variaveis --ring-* daqui.

type ProgressRingProps = {
  className?: string;
  /** Diametro em px. */
  size?: number;
  strokeWidth?: number;
  /** 0 a 100. */
  value: number;
};

export function ProgressRing({ className, size = 44, strokeWidth = 3.5, value }: ProgressRingProps) {
  const percent = Math.round(Math.min(Math.max(value, 0), 100));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const done = percent >= 100;
  const center = size / 2;

  return (
    <div
      aria-label={done ? "Concluído" : `${percent}% concluído`}
      className={cn(
        "progress-ring relative grid place-items-center rounded-full bg-black/55 text-white shadow-[0_10px_24px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-[2px]",
        className
      )}
      role="img"
      style={{ "--ring-circumference": circumference, "--ring-offset": circumference * (1 - percent / 100), height: size, width: size } as CSSProperties}
    >
      <svg aria-hidden="true" className="absolute inset-0 -rotate-90" height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
        <circle cx={center} cy={center} fill="none" r={radius} stroke="rgba(255, 255, 255, 0.18)" strokeWidth={strokeWidth} />
        <circle
          className={cn("progress-ring-value", done ? "stroke-emerald-400" : "stroke-[var(--accent)]")}
          cx={center}
          cy={center}
          fill="none"
          r={radius}
          strokeDasharray={circumference}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
        />
      </svg>
      {done ? (
        <Check aria-hidden="true" className="size-4 text-emerald-400" strokeWidth={3} />
      ) : (
        <span className="text-[11px] font-black leading-none tabular-nums">{percent}%</span>
      )}
    </div>
  );
}
