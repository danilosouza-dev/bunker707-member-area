"use client";

import { MoreHorizontal } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { DataTable, type DataTableColumn } from "../data-table";
import { EmptyState } from "../empty-state";
import { adminCard, adminTransition } from "../styles";

// Pecas pequenas das telas portadas para o admin novo (Configuracoes, Area de membros, Pacotes).
// Todas so com tokens do admin; nada de cor nomeada.

/* ------------------------------------------------------------------------------------------------
 * Chave liga/desliga com o efeito escrito (docs/17 §2.7: "switch com o efeito escrito")
 * ---------------------------------------------------------------------------------------------- */

type AdminSwitchProps = {
  checked: boolean;
  /** Efeito da chave em uma frase, ex.: "Quando desligado, o Tutor não usa este provedor." */
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
  label: ReactNode;
  onCheckedChange: (checked: boolean) => void;
  /**
   * Salvando: a chave fica esmaecida e ignora cliques, mas continua focavel (disabled nativo jogaria o
   * foco do teclado no body no meio da gravacao).
   */
  pending?: boolean;
};

export function AdminSwitch({ checked, description, disabled = false, id, label, onCheckedChange, pending = false }: AdminSwitchProps) {
  const autoId = useId();
  const switchId = id ?? autoId;

  return (
    <div className="flex min-h-11 items-start gap-3">
      <button
        aria-busy={pending || undefined}
        aria-checked={checked}
        aria-describedby={description ? `${switchId}-description` : undefined}
        aria-disabled={pending || undefined}
        aria-labelledby={`${switchId}-label`}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full border",
          adminTransition,
          checked ? "border-transparent bg-[var(--text-primary)]" : "border-[var(--border-strong)] bg-[var(--surface-2)]",
          disabled && "cursor-not-allowed opacity-60",
          pending && "cursor-progress opacity-60"
        )}
        disabled={disabled}
        id={switchId}
        onClick={() => {
          if (!pending) {
            onCheckedChange(!checked);
          }
        }}
        role="switch"
        type="button"
      >
        <span
          aria-hidden="true"
          className={cn(
            "block size-[18px] rounded-full transition-transform duration-150 ease-[var(--ease-admin)] motion-reduce:transition-none",
            checked ? "translate-x-[19px] bg-[var(--surface-0)]" : "translate-x-[2px] bg-[var(--text-secondary)]"
          )}
        />
      </button>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm leading-6 font-medium text-[var(--text-primary)]" id={`${switchId}-label`}>
          {label}
        </span>
        {description ? (
          <span className="text-[13px] leading-5 text-[var(--text-secondary)]" id={`${switchId}-description`}>
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Menu "…" de uma linha
 * ---------------------------------------------------------------------------------------------- */

export type RowMenuAction = {
  destructive?: boolean;
  disabled?: boolean;
  /** Linha separadora antes deste item. */
  separated?: boolean;
  icon?: ReactNode;
  label: string;
  onSelect: () => void;
};

export function RowMenu({ actions, label }: { actions: readonly RowMenuAction[]; label: string }) {
  if (actions.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg text-[var(--text-secondary)] pointer-coarse:size-11 hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)] data-popup-open:bg-[var(--surface-2)] data-popup-open:text-[var(--text-primary)]",
          adminTransition
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <MoreHorizontal aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-1 text-[var(--text-primary)] ring-0"
        sideOffset={6}
      >
        {actions.map((action) => (
          <RowMenuEntry action={action} key={action.label} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RowMenuEntry({ action }: { action: RowMenuAction }) {
  return (
    <>
      {action.separated ? <DropdownMenuSeparator className="bg-[var(--border-subtle)]" /> : null}
      <DropdownMenuItem
        className={cn(
          "h-9 gap-2 rounded-md px-2 text-sm",
          action.destructive
            ? "text-[var(--error)] focus:bg-[var(--error-bg)] focus:text-[var(--error)]"
            : "text-[var(--text-primary)] focus:bg-[var(--surface-2)] focus:text-[var(--text-primary)]"
        )}
        disabled={action.disabled}
        onClick={(event) => {
          event.stopPropagation();
          action.onSelect();
        }}
      >
        {action.icon ? (
          <span aria-hidden="true" className={cn("grid size-4 place-items-center", !action.destructive && "text-[var(--text-secondary)]")}>
            {action.icon}
          </span>
        ) : null}
        {action.label}
      </DropdownMenuItem>
    </>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Confirmacao destrutiva (nunca window.confirm)
 * ---------------------------------------------------------------------------------------------- */

type ConfirmDialogProps = {
  busy?: boolean;
  cancelLabel?: string;
  children?: ReactNode;
  confirmLabel: string;
  description?: ReactNode;
  /** true pinta o botao de confirmar como acao destrutiva. */
  destructive?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: ReactNode;
};

export function ConfirmDialog({
  busy = false,
  cancelLabel = "Cancelar",
  children,
  confirmLabel,
  description,
  destructive = false,
  onConfirm,
  onOpenChange,
  open,
  title
}: ConfirmDialogProps) {
  return (
    <Dialog onOpenChange={(next) => (!busy ? onOpenChange(next) : undefined)} open={open}>
      <DialogContent
        className="max-w-md rounded-xl border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)]"
        showCloseButton={false}
      >
        <DialogHeader className="gap-1 px-5 pt-5 pb-2">
          <DialogTitle className="text-base leading-6 font-semibold text-[var(--text-primary)]">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="text-sm leading-5 text-[var(--text-secondary)]">{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        {children ? <div className="px-5 py-2">{children}</div> : null}
        <DialogFooter className="px-5 pt-3 pb-5">
          <Button className="px-4 text-[var(--text-secondary)]" disabled={busy} onClick={() => onOpenChange(false)} type="button" variant="ghost">
            {cancelLabel}
          </Button>
          <Button
            className={cn(
              "px-4",
              destructive &&
                "border-[var(--error-border)] bg-[var(--error-bg)] text-[var(--error)] hover:bg-[var(--error-bg)] hover:brightness-125"
            )}
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? "Aguarde…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Card com titulo proprio (nunca card dentro de card)
 * ---------------------------------------------------------------------------------------------- */

type SectionCardProps = {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Classe do corpo; padrao com respiro de 16 px (cards do prototipo). Use "p-0" para tabelas e listas. */
  bodyClassName?: string;
  description?: ReactNode;
  /** Texto curto ao lado do titulo, ex.: "últimos 30 dias". */
  meta?: ReactNode;
  title: ReactNode;
  titleId?: string;
};

export function SectionCard({ actions, bodyClassName, children, className, description, meta, title, titleId }: SectionCardProps) {
  const autoId = useId();
  const headingId = titleId ?? autoId;

  return (
    <section aria-labelledby={headingId} className={cn(adminCard, "flex min-w-0 flex-col", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-baseline gap-x-2 text-base leading-6 font-semibold text-[var(--text-primary)]" id={headingId}>
            {title}
            {meta ? <span className="text-xs leading-5 font-medium text-[var(--text-tertiary)]">{meta}</span> : null}
          </h2>
          {description ? <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:w-full">{actions}</div> : null}
      </header>
      <div className={cn("min-w-0 px-4 pt-4 pb-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Tabela no desktop, lista de cartoes abaixo de 768 px (sem useMediaQuery, para nao piscar)
 * ---------------------------------------------------------------------------------------------- */

type ResponsiveTableProps<Row> = {
  caption: string;
  className?: string;
  columns: readonly DataTableColumn<Row>[];
  emptyDescription?: string;
  emptyTitle?: string;
  /**
   * true: a tabela encosta nas bordas do card que a contem (sem borda propria nem cantos), para
   * nunca virar card dentro de card. Use com `SectionCard bodyClassName="p-0"`.
   */
  flush?: boolean;
  getRowKey: (row: Row) => string;
  renderCard: (row: Row) => ReactNode;
  rows: readonly Row[];
  /** Classe da tabela (ex.: "table-fixed" com larguras por coluna). */
  tableClassName?: string;
};

export function ResponsiveTable<Row>({
  caption,
  className,
  columns,
  emptyDescription,
  emptyTitle = "Nada por aqui ainda",
  flush = false,
  getRowKey,
  renderCard,
  rows,
  tableClassName
}: ResponsiveTableProps<Row>) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className={cn("hidden md:block", tableClassName)}>
        <DataTable
          caption={caption}
          className={flush ? "rounded-none border-x-0 border-b-0" : undefined}
          columns={columns}
          emptyDescription={emptyDescription}
          emptyTitle={emptyTitle}
          getRowKey={getRowKey}
          rows={rows}
        />
      </div>
      <div className="md:hidden">
        {rows.length === 0 ? (
          <EmptyState
            description={emptyDescription}
            headingLevel="h3"
            size="compact"
            title={emptyTitle}
            variant={flush ? "plain" : "card"}
          />
        ) : (
          <ul
            aria-label={caption}
            className={cn(
              "divide-y divide-[var(--border-subtle)] overflow-hidden",
              flush ? "border-t border-[var(--border-subtle)]" : adminCard
            )}
          >
            {rows.map((row) => (
              <li className="min-w-0 px-4 py-3" key={getRowKey(row)}>
                {renderCard(row)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
