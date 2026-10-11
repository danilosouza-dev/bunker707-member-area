import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Erro persistente (docs/17 §2.7: "erro em banner persistente, nunca toast"). Fica ate a proxima
// tentativa dar certo; `action` costuma ser "Tentar de novo" ou "Recarregar".

type ErrorBannerProps = {
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: string;
};

export function ErrorBanner({ action, children, className, title }: ErrorBannerProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--error-border)] bg-[var(--error-bg)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
      role="alert"
    >
      <div className="flex min-w-0 items-start gap-2">
        <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--error)]" />
        <div className="min-w-0 text-sm leading-5 text-[var(--text-primary)]">
          {title ? <p className="font-medium">{title}</p> : null}
          <div className={cn(title && "text-[var(--text-secondary)]")}>{children}</div>
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
