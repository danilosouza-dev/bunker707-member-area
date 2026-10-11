import Link from "next/link";
import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { isAdminV2Href } from "./nav";
import { adminTransition } from "./styles";

// Migalha das telas internas (prototipo aprovado): fica dentro da pagina, acima do H1, nunca na barra
// superior. "Produtos / Formação Agentes de IA", "Produtos / Novo produto", "Configurações / Tutor IA".
// 13/500; separador "/" em --text-tertiary; links em --text-secondary (sublinham no hover); a pagina
// atual em --text-secondary, cortada em 40 caracteres.

export type AdminBreadcrumbItem = { href?: string; label: string };

type AdminBreadcrumbProps = {
  className?: string;
  items: readonly AdminBreadcrumbItem[];
};

export function AdminBreadcrumb({ className, items }: AdminBreadcrumbProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Caminho" className={cn("min-w-0", className)}>
      <ol className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-tertiary)]">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <Fragment key={`${item.href ?? ""}:${item.label}`}>
              {index > 0 ? (
                <li aria-hidden="true" className="shrink-0">
                  /
                </li>
              ) : null}
              <li className="flex min-w-0 items-center">
                {item.href && !isLast ? (
                  <Link
                    className={cn(
                      "truncate rounded-[4px] text-[var(--text-secondary)] underline-offset-[3px] hover:text-[var(--text-primary)] hover:underline",
                      adminTransition
                    )}
                    data-navigation-feedback={isAdminV2Href(item.href) ? "false" : undefined}
                    href={item.href}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span aria-current={isLast ? "page" : undefined} className="max-w-[40ch] truncate text-[var(--text-secondary)]">
                    {item.label}
                  </span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
