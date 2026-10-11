import { Database } from "lucide-react";
import { PENDING_MIGRATION_MESSAGE } from "@/server/db/pending-migration";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";

type PendingMigrationNoticeProps = {
  className?: string;
  /**
   * Numero da migracao que falta para esta parte da tela (ex.: "202610120001"). Com ele, o aviso fala
   * so da parte: "Esta parte precisa da atualização do banco (migração 202610120001)."
   */
  migration?: string;
  /** "default": estado vazio do tamanho da tela. "compact": faixa fina no lugar de uma secao; o resto da tela segue. */
  size?: "default" | "compact";
};

export function pendingMigrationPartMessage(migration: string) {
  return `Esta parte precisa da atualização do banco (migração ${migration}).`;
}

/**
 * Aviso no lugar dos dados quando o banco ainda nao recebeu as migracoes do admin v2.
 * Ver src/server/db/pending-migration.ts. Nao quebra a pagina nem o menu.
 */
export function PendingMigrationNotice({ className, migration, size = "default" }: PendingMigrationNoticeProps) {
  const title = migration ? pendingMigrationPartMessage(migration) : PENDING_MIGRATION_MESSAGE;

  if (size === "compact") {
    return (
      <div
        className={cn(
          "flex items-start gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3.5 py-2.5 text-[13px] leading-5 text-[var(--text-secondary)]",
          className
        )}
        role="status"
      >
        <Database aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--text-tertiary)]" strokeWidth={1.75} />
        <p className="min-w-0">
          {title} <span className="text-[var(--text-tertiary)]">Depois da atualização, recarregue esta página.</span>
        </p>
      </div>
    );
  }

  return (
    <EmptyState
      action={{ href: "/admin/legado", label: "Abrir o admin antigo" }}
      className={className}
      description="A área do aluno e o admin antigo continuam funcionando normalmente. Depois da atualização, recarregue esta página."
      icon={Database}
      title={title}
    />
  );
}
