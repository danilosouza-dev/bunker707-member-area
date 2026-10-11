import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AdminBreadcrumb, type AdminBreadcrumbItem } from "./breadcrumb";

type PageHeaderProps = {
  actions?: ReactNode;
  /** Migalha acima do H1, so nas telas internas ("Produtos / Novo produto"). */
  breadcrumb?: readonly AdminBreadcrumbItem[];
  className?: string;
  description?: ReactNode;
  title: ReactNode;
};

/**
 * Cabecalho de tela (prototipo aprovado): H1 24/600 e uma frase de apoio a 4 px; acoes a direita,
 * alinhadas embaixo, 8 px entre si. A linha quebra so quando titulo e acoes nao cabem lado a lado
 * (em 390 px o "Criar" do Hoje continua ao lado do titulo).
 */
export function PageHeader({ actions, breadcrumb, className, description, title }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {breadcrumb?.length ? <AdminBreadcrumb className="mb-2" items={breadcrumb} /> : null}
        <h1 className="text-2xl leading-[30px] font-semibold tracking-[-0.015em] text-[var(--text-primary)]">{title}</h1>
        {description ? <p className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
