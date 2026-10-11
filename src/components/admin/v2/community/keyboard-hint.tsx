import { cn } from "@/lib/utils";

// Dica de teclado da fila ("J K navegam · R responde"), a direita dos filtros. So no desktop.

const kbdClass =
  "grid h-5 min-w-5 place-items-center rounded border border-[var(--border-strong)] bg-[var(--surface-2)] px-1 font-sans text-xs font-medium text-[var(--text-secondary)]";

export function QueueKeyboardHint({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-center gap-1.5 text-xs leading-5 font-medium whitespace-nowrap text-[var(--text-tertiary)]", className)}>
      <kbd className={kbdClass}>J</kbd>
      <kbd className={kbdClass}>K</kbd>
      <span>navegam ·</span>
      <kbd className={kbdClass}>R</kbd>
      <span>responde</span>
    </p>
  );
}
