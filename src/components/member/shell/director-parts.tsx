import { Compass, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Pecas visuais da IA Diretor, usadas pelo lancador estatico do AppShell e pelo painel
// (platform-director-chat.tsx). Sem estado e sem dependencias pesadas: o lancador nao puxa o chat.

/** Marca da IA Diretor: bussola com uma pequena estrela de IA (o Tutor IA usa o chapeu de formatura). */
export function DirectorIcon({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`relative inline-grid place-items-center ${className}`}>
      <Compass className="h-full w-full" strokeWidth={1.9} />
      <Sparkles className="absolute -right-1 -top-1 h-2.5 w-2.5 text-[var(--accent)]" strokeWidth={2.2} />
    </span>
  );
}

const directorAvatarSizes = {
  lg: { box: "size-14", icon: "size-7" },
  md: { box: "size-9", icon: "size-[18px]" },
  sm: { box: "size-8", icon: "size-4" }
} as const;

/** Avatar da Diretora num circulo vermelho escuro; o ponto indica se ela esta disponivel agora. */
export function DirectorAvatar({
  size = "md",
  status
}: {
  size?: keyof typeof directorAvatarSizes;
  status?: "available" | "unavailable";
}) {
  const sizing = directorAvatarSizes[size];

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative grid shrink-0 place-items-center rounded-full bg-[#2a1113] text-white ring-1 ring-inset ring-[var(--accent)]/35",
        sizing.box
      )}
    >
      <DirectorIcon className={sizing.icon} />
      {status ? (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-[var(--panel)]",
            status === "available" ? "bg-emerald-500" : "bg-zinc-500"
          )}
        />
      ) : null}
    </span>
  );
}

/** Botao de icone do cabecalho do painel, com dica propria (nunca `title` nativo). */
export function DirectorHeaderAction({
  children,
  disabled = false,
  label,
  onClick,
  tooltip,
  tooltipAlign = "end"
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  tooltip: string;
  /** Lado em que a dica se alinha ao botao (no canto esquerdo do painel use "start"). */
  tooltipAlign?: "end" | "start";
}) {
  return (
    <span className="relative">
      <button
        aria-label={label}
        className="peer/action grid size-8 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        {children}
      </button>
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-[calc(100%+6px)] z-10 whitespace-nowrap rounded-[6px] bg-[#eeeeee] px-2.5 py-1.5 text-xs font-medium text-[#202020] opacity-0 shadow-lg transition-opacity duration-150 peer-hover/action:opacity-100 peer-focus-visible/action:opacity-100 max-sm:hidden",
          tooltipAlign === "start" ? "left-0" : "right-0"
        )}
      >
        {tooltip}
      </span>
    </span>
  );
}

/** Esqueleto da conversa enquanto o historico carrega (mesma forma das mensagens). */
export function DirectorConversationSkeleton() {
  return (
    <div className="space-y-7">
      <p className="sr-only" role="status">
        Carregando sua IA Diretor...
      </p>
      <span aria-hidden="true" className="ml-auto block h-10 w-3/5 rounded-[20px] rounded-br-[6px] bg-white/[0.06] motion-safe:animate-pulse" />
      <div aria-hidden="true" className="flex items-start gap-3">
        <span className="size-8 shrink-0 rounded-full bg-white/[0.06] motion-safe:animate-pulse" />
        <span className="flex-1 space-y-2.5 pt-1.5">
          <span className="block h-3 w-11/12 rounded-full bg-white/[0.06] motion-safe:animate-pulse" />
          <span className="block h-3 w-4/5 rounded-full bg-white/[0.06] motion-safe:animate-pulse" />
          <span className="block h-3 w-2/3 rounded-full bg-white/[0.06] motion-safe:animate-pulse" />
        </span>
      </div>
    </div>
  );
}
