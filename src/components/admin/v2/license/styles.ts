import { cn } from "@/lib/utils";
import { adminTransition } from "../styles";

// Classes da faixa e da tela Licenca, montadas so no servidor (sem o primitivo de botao do navegador): o tamanho e o
// raio vem da regra unica de [data-slot="button"] do admin (src/app/globals.css); aqui so cor, borda e respiro.

const buttonBase = cn(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm leading-5 font-medium whitespace-nowrap",
  "disabled:cursor-progress disabled:opacity-60",
  adminTransition
);

/** Botao secundario (Verificar agora, Ver a Licenca, Renovar). */
export const licenseButton = cn(buttonBase, "border-[var(--border-strong)] bg-transparent text-[var(--text-primary)] hover:bg-[var(--hover-overlay)]");

/** Botao principal (Ativar, Carregar licenca). */
export const licensePrimaryButton = cn(buttonBase, "border-transparent bg-[var(--text-primary)] text-[var(--surface-0)] hover:opacity-90");

/** Botao de desfazer (Desativar). */
export const licenseDangerButton = cn(buttonBase, "border-[var(--error-border)] bg-[var(--error-bg)] text-[var(--error)] hover:opacity-90");

/** Campo de 40 px sobre a superficie 2 (o mesmo desenho de adminInputClass, sem importar o modulo do navegador). */
export const licenseInput = cn(
  "h-10 w-full min-w-0 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 text-sm text-[var(--text-primary)]",
  "placeholder:text-[var(--text-tertiary)] outline-none focus-visible:border-[var(--text-secondary)]",
  adminTransition
);

export const licenseTextarea = cn(
  "min-h-24 w-full min-w-0 resize-y rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2.5 font-mono text-xs leading-5 text-[var(--text-primary)]",
  "placeholder:text-[var(--text-tertiary)] outline-none focus-visible:border-[var(--text-secondary)]",
  adminTransition
);
