"use client";

import { Eye, EyeOff, FolderInput, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Barra flutuante da selecao multipla de aulas (docs/17 §1.6.3): Publicar, Despublicar, Mover para…,
// Excluir. Fica no rodape da tela, centralizada; no celular ocupa a largura toda.

type BulkBarProps = {
  count: number;
  onClear: () => void;
  onDelete: () => void;
  onMove: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
};

const actionClass = "h-11! gap-1.5 px-3 md:h-9! text-[var(--text-primary)] hover:bg-[var(--hover-overlay)]";

export function BulkBar({ count, onClear, onDelete, onMove, onPublish, onUnpublish }: BulkBarProps) {
  if (count === 0) {
    return null;
  }

  return (
    <div
      aria-label="Ações nas aulas selecionadas"
      className={cn(
        "fixed inset-x-4 bottom-[calc(16px+env(safe-area-inset-bottom,0px))] z-40 flex flex-wrap items-center gap-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] py-2 pr-2 pl-4 shadow-[0_16px_40px_rgba(0,0,0,0.55)]",
        "md:inset-x-auto md:left-1/2 md:w-max md:max-w-[calc(100vw-32px)] md:flex-nowrap md:-translate-x-1/2",
        "animate-in fade-in slide-in-from-bottom-2 duration-200 ease-[var(--ease-admin)] motion-reduce:animate-none"
      )}
      role="toolbar"
    >
      <p className="mr-2 text-sm leading-5 font-semibold whitespace-nowrap text-[var(--text-primary)] tabular-nums" role="status">
        {count === 1 ? "1 aula selecionada" : `${count} aulas selecionadas`}
      </p>
      <Button className={actionClass} onClick={onPublish} type="button" variant="ghost">
        <Eye aria-hidden="true" />
        Publicar
      </Button>
      <Button className={actionClass} onClick={onUnpublish} type="button" variant="ghost">
        <EyeOff aria-hidden="true" />
        Despublicar
      </Button>
      <Button className={actionClass} onClick={onMove} type="button" variant="ghost">
        <FolderInput aria-hidden="true" />
        Mover para…
      </Button>
      <Button
        className={cn(actionClass, "text-[var(--error)] hover:bg-[var(--error-bg)] hover:text-[var(--error)]")}
        onClick={onDelete}
        type="button"
        variant="ghost"
      >
        <Trash2 aria-hidden="true" />
        Excluir
      </Button>
      <Button
        aria-label="Limpar seleção"
        className="ml-auto size-11! text-[var(--text-secondary)] md:size-9! hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)] md:ml-1"
        onClick={onClear}
        size="icon"
        type="button"
        variant="ghost"
      >
        <X aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}
