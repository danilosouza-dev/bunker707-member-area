"use client";

import { Clapperboard, Code2, FileVideo, PlayCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import type { LessonVideoProvider } from "@/lib/platform-types";
import { cn } from "@/lib/utils";
import { adminTransition } from "../styles";

// Pecas pequenas da aba Conteudo: icone do provedor, chave liga/desliga, botao de icone das linhas e
// classes dos menus. So a aba Conteudo usa; ficam aqui para nao virar componente compartilhado cedo.

/** Botao de icone das linhas: 44 px no celular (alvo de toque), 32 px a partir de 768 px. */
export const rowIconButtonClass = cn(
  "inline-grid size-11 shrink-0 place-items-center rounded-lg text-[var(--text-secondary)] md:size-8",
  "hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)] data-popup-open:bg-[var(--surface-2)] data-popup-open:text-[var(--text-primary)]",
  "disabled:pointer-events-none disabled:opacity-40",
  adminTransition
);

/** Conteudo dos menus "…" (DropdownMenuContent). */
export const rowMenuContentClass =
  "w-56 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-1 text-[var(--text-primary)] ring-0";

export const rowMenuItemClass =
  "h-9 gap-2 rounded-md px-2 text-sm text-[var(--text-primary)] focus:bg-[var(--surface-2)] [&_svg]:text-[var(--text-secondary)]";

export const rowMenuDangerItemClass =
  "h-9 gap-2 rounded-md px-2 text-sm text-[var(--error)] focus:bg-[var(--error-bg)] focus:text-[var(--error)] [&_svg]:text-[var(--error)]";

/** Glifo do YouTube em uma cor so (o aviso do provedor diz que a logo aparece no player). */
function YouTubeGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <rect height="14" rx="4" stroke="currentColor" strokeWidth="1.8" width="20" x="2" y="5" />
      <path d="M10 9.2v5.6l4.8-2.8L10 9.2Z" fill="currentColor" />
    </svg>
  );
}

/** Icone do provedor de video ao lado do rotulo ("YouTube", "Bunny", "Link direto"...). */
export function VideoProviderIcon({ className, provider }: { className?: string; provider: LessonVideoProvider }) {
  const iconClass = cn("size-4 shrink-0", className);

  switch (provider) {
    case "youtube":
      return <YouTubeGlyph className={iconClass} />;
    case "embed_code":
      return <Code2 aria-hidden="true" className={iconClass} />;
    case "custom_url":
      return <FileVideo aria-hidden="true" className={iconClass} />;
    case "bunny":
    case "mux":
      return <Clapperboard aria-hidden="true" className={iconClass} />;
    default:
      return <PlayCircle aria-hidden="true" className={iconClass} />;
  }
}

type AdminSwitchProps = Omit<ComponentProps<"button">, "children" | "onChange" | "role" | "type"> & {
  checked: boolean;
  /** Texto principal ao lado da chave. */
  label: ReactNode;
  onCheckedChange: (checked: boolean) => void;
  /** Efeito escrito da chave (docs/17 §2.7: "switch com o efeito escrito"). */
  effect?: ReactNode;
};

/** Chave com o efeito escrito ao lado. Botao nativo com role="switch": Espaco e Enter alternam. */
export function AdminSwitch({ checked, className, disabled, effect, id, label, onCheckedChange, ...props }: AdminSwitchProps) {
  const labelId = id ? `${id}-label` : undefined;
  const effectId = id && effect ? `${id}-effect` : undefined;

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-3", className)}>
      <button
        {...props}
        aria-checked={checked}
        aria-describedby={effectId}
        aria-labelledby={labelId}
        className={cn(
          "relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border",
          checked ? "border-[var(--text-primary)] bg-[var(--text-primary)]" : "border-[var(--border-strong)] bg-[var(--surface-2)]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          adminTransition
        )}
        disabled={disabled}
        id={id}
        onClick={() => onCheckedChange(!checked)}
        role="switch"
        type="button"
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute size-[18px] rounded-full transition-transform duration-150 ease-[var(--ease-admin)] motion-reduce:transition-none",
            checked ? "translate-x-[18px] bg-[var(--surface-0)]" : "translate-x-[2px] bg-[var(--text-secondary)]"
          )}
        />
      </button>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm leading-5 font-medium text-[var(--text-primary)]" id={labelId}>
          {label}
        </span>
        {effect ? (
          <span className="truncate text-xs leading-4 text-[var(--text-secondary)]" id={effectId}>
            {effect}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/** Regiao invisivel que le em voz alta o que mudou na arvore (mover, criar, excluir). */
export function LiveAnnouncer({ message }: { message: string }) {
  return (
    <p aria-live="polite" className="sr-only" role="status">
      {message}
    </p>
  );
}

/** "3 aulas" / "1 aula". */
export function pluralize(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}
