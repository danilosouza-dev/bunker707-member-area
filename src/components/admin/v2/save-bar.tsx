"use client";

import { useEffect, useEffectEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SaveBarProps = {
  className?: string;
  discardLabel?: string;
  /** Erro persistente do ultimo salvamento (nunca toast). */
  error?: string | null;
  message?: string;
  /** Sem ele a barra nao mostra "Descartar" (ex.: so ha ajuste automatico, nada para desfazer). */
  onDiscard?: () => void;
  onSave: () => void;
  /** Mostra a barra quando ha alteracoes nao salvas. */
  open: boolean;
  saveLabel?: string;
  saving?: boolean;
};

/**
 * Barra de salvar explicita dos formularios (docs/17 §2.7). Cmd/Ctrl+Enter salva.
 * O botao so fica indisponivel enquanto salva, nunca por validacao.
 */
export function SaveBar({
  className,
  discardLabel = "Descartar",
  error,
  message = "Alterações não salvas",
  onDiscard,
  onSave,
  open,
  saveLabel = "Salvar",
  saving = false
}: SaveBarProps) {
  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!open || saving || event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) {
      return;
    }

    event.preventDefault();
    onSave();
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      handleShortcut(event);
    }

    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!open) {
    return null;
  }

  return (
    <div
      aria-label="Alterações não salvas"
      className={cn(
        "sticky bottom-4 z-20 flex flex-col gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] px-4 py-3 shadow-[0_16px_40px_rgba(0,0,0,0.45)] sm:flex-row sm:items-center sm:justify-between",
        "animate-in fade-in slide-in-from-bottom-2 duration-200 ease-[var(--ease-admin)] motion-reduce:animate-none",
        className
      )}
      role="region"
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm leading-5 font-medium text-[var(--text-primary)]">
          <span aria-hidden="true" className="size-2 rounded-full bg-[var(--warning)]" />
          {message}
        </p>
        {error ? (
          <p className="mt-1 text-[13px] leading-5 text-[var(--error)]" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {onDiscard ? (
          <Button
            className="px-4 text-[var(--text-secondary)]"
            disabled={saving}
            onClick={onDiscard}
            type="button"
            variant="ghost"
          >
            {discardLabel}
          </Button>
        ) : null}
        <Button
          aria-keyshortcuts="Meta+Enter Control+Enter"
          className="px-4"
          disabled={saving}
          onClick={onSave}
          type="button"
        >
          {saving ? "Salvando…" : saveLabel}
        </Button>
      </div>
    </div>
  );
}
