import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Blocos das abas Detalhes, Acesso e venda e Importar: coluna unica de 640 px, um titulo 16/600 por
// bloco, uma frase de apoio e uma linha fina separando os blocos (sem card dentro de card).

type FormSectionProps = {
  /** Acao curta a direita do titulo (ex.: "Ver pacotes"). */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  title: ReactNode;
};

export function FormSection({ aside, children, className, description, title }: FormSectionProps) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-5 border-t border-[var(--border-subtle)] pt-6 first:border-t-0 first:pt-0", className)}>
      <header className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]">{title}</h2>
          {description ? <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">{description}</p> : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** Campo so de leitura no mesmo ritmo dos campos editaveis (rotulo 13/500, valor 14). */
export function ReadOnlyField({ children, hint, label }: { children: ReactNode; hint?: ReactNode; label: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{label}</span>
      <div className="min-w-0 text-sm leading-5 text-[var(--text-primary)]">{children}</div>
      {hint ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{hint}</p> : null}
    </div>
  );
}

/** Legenda de um grupo de pilulas, alinhada aos rotulos do AdminField. */
export function FieldLegend({ children, optional = false }: { children: ReactNode; optional?: boolean }) {
  return (
    <legend className="mb-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]">
      {children}
      {optional ? <span className="font-normal text-[var(--text-tertiary)]"> (opcional)</span> : null}
    </legend>
  );
}

/** Erro embaixo de um grupo de pilulas (o AdminField cobre os campos de texto). */
export function FieldError({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p className="text-[13px] leading-5 text-[var(--error)]" id={id} role="alert">
      {children}
    </p>
  );
}
