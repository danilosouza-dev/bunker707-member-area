"use client";

import { CalendarClock, EllipsisVertical, KeyRound, Mail, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { updateStudentAccess } from "@/server/students/actions";
import type { StudentAccessItem } from "@/server/students/model";
import type { AccessAction } from "@/server/students/schemas";
import { ErrorBanner } from "../error-banner";
import { AdminField, adminInputClass, fieldDescribedBy } from "../form";
import { ProductDialog } from "../products/dialog-frame";
import { adminToast } from "../toast";
import type { PickerProduct } from "./product-picker";
import {
  DeleteStudentDialog,
  EditStudentDialog,
  GrantAccessDialog,
  SendAccessEmailDialog,
  type StudentSummary
} from "./student-dialogs";

// Acoes do perfil do aluno: "Liberar acesso" e o menu "…" no cabecalho; o menu de cada acesso na
// aba Acessos. Mesmo gatilho e mesmo menu de Configurações (kit.tsx): superficie 3, itens de 36 px.

const menuTrigger = cn(
  "grid size-10 shrink-0 place-items-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface-1)] text-[var(--text-secondary)]",
  "hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)] data-popup-open:bg-[var(--surface-2)] data-popup-open:text-[var(--text-primary)]",
  "transition-colors duration-150 ease-[var(--ease-admin)] motion-reduce:transition-none"
);
const rowMenuTrigger = cn(
  "grid size-8 shrink-0 place-items-center rounded-lg text-[var(--text-secondary)] pointer-coarse:size-11",
  "hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)] data-popup-open:bg-[var(--surface-2)] data-popup-open:text-[var(--text-primary)]"
);
const menuContent = "w-60 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-1 text-[var(--text-primary)] ring-0";
const menuItem = "h-9 gap-2 rounded-md px-2 text-sm text-[var(--text-primary)] data-highlighted:bg-[var(--press-overlay)]";
const menuItemDestructive = "h-9 gap-2 rounded-md px-2 text-sm text-[var(--error)] data-highlighted:bg-[var(--error-bg)]";

/* ------------------------------------------------------------------------------------------------
 * Cabecalho
 * ---------------------------------------------------------------------------------------------- */

type StudentHeaderActionsProps = {
  alreadyGranted: readonly string[];
  canAccess: boolean;
  canDelete: boolean;
  products: readonly PickerProduct[];
  student: StudentSummary;
  /** Hoje ("AAAA-MM-DD"), calculado no servidor. */
  today: string;
};

type HeaderDialog = "grant" | "email" | "edit" | "delete" | null;

export function StudentHeaderActions({ alreadyGranted, canAccess, canDelete, products, student, today }: StudentHeaderActionsProps) {
  const [dialog, setDialog] = useState<HeaderDialog>(null);

  if (!canAccess && !canDelete) {
    return null;
  }

  return (
    <>
      {canAccess ? (
        <Button className="gap-1.5 px-4" onClick={() => setDialog("grant")} type="button">
          <Plus aria-hidden="true" className="size-4" />
          Liberar acesso
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Mais ações" className={menuTrigger}>
          <EllipsisVertical aria-hidden="true" className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={menuContent} sideOffset={6}>
          {canAccess ? (
            <>
              <DropdownMenuItem className={menuItem} disabled={!student.hasAccount} onClick={() => setDialog("email")}>
                <Mail aria-hidden="true" className="size-4 text-[var(--text-secondary)]" />
                Enviar e-mail de acesso
              </DropdownMenuItem>
              <DropdownMenuItem className={menuItem} onClick={() => setDialog("edit")}>
                <Pencil aria-hidden="true" className="size-4 text-[var(--text-secondary)]" />
                Editar dados
              </DropdownMenuItem>
            </>
          ) : null}
          {canAccess && canDelete ? <DropdownMenuSeparator className="bg-[var(--border-subtle)]" /> : null}
          {canDelete ? (
            <DropdownMenuItem className={menuItemDestructive} onClick={() => setDialog("delete")} variant="destructive">
              <Trash2 aria-hidden="true" className="size-4" />
              Excluir aluno
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <GrantAccessDialog
        alreadyGranted={alreadyGranted}
        onOpenChange={(open) => setDialog(open ? "grant" : null)}
        open={dialog === "grant"}
        products={products}
        student={student}
        today={today}
      />
      <SendAccessEmailDialog onOpenChange={(open) => setDialog(open ? "email" : null)} open={dialog === "email"} student={student} />
      <EditStudentDialog onOpenChange={(open) => setDialog(open ? "edit" : null)} open={dialog === "edit"} student={student} />
      <DeleteStudentDialog onOpenChange={(open) => setDialog(open ? "delete" : null)} open={dialog === "delete"} student={student} />
    </>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Linha da aba Acessos
 * ---------------------------------------------------------------------------------------------- */

type AccessRowActionsProps = {
  access: StudentAccessItem;
  today: string;
  userId: string;
};

const ACTION_TOASTS: Record<AccessAction, string> = {
  extend_30: "Acesso estendido por 30 dias",
  extend_90: "Acesso estendido por 90 dias",
  reactivate: "Acesso reativado",
  remove_end: "Acesso sem prazo",
  revoke: "Acesso revogado",
  set_end: "Data de término alterada",
  suspend: "Acesso suspenso"
};

export function AccessRowActions({ access, today, userId }: AccessRowActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateDialog, setDateDialog] = useState(false);
  const [endsAt, setEndsAt] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const open = access.state === "active" || access.state === "expiring" || access.state === "scheduled";
  const productTitle = access.product?.title ?? "produto";

  async function run(action: AccessAction, date?: string) {
    setPending(true);
    const result = await updateStudentAccess({ action, endsAt: date || null, entitlementId: access.id, userId });
    setPending(false);

    if (!result.ok) {
      if (action === "set_end") {
        setDateError(result.fieldErrors?.endsAt?.[0] ?? result.error);
      } else {
        setError(result.error);
      }

      return false;
    }

    adminToast.success(ACTION_TOASTS[action]);
    router.refresh();

    return true;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={`Ações do acesso a ${productTitle}`} className={rowMenuTrigger} disabled={pending}>
          <EllipsisVertical aria-hidden="true" className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={menuContent} sideOffset={6}>
          {open ? (
            <>
              <DropdownMenuItem className={menuItem} onClick={() => void run("extend_30")}>
                <CalendarClock aria-hidden="true" className="size-4 text-[var(--text-secondary)]" />
                Estender 30 dias
              </DropdownMenuItem>
              <DropdownMenuItem className={menuItem} onClick={() => void run("extend_90")}>
                <CalendarClock aria-hidden="true" className="size-4 text-[var(--text-secondary)]" />
                Estender 90 dias
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem className={menuItem} onClick={() => void run("reactivate")}>
              <KeyRound aria-hidden="true" className="size-4 text-[var(--text-secondary)]" />
              Reativar
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className={menuItem}
            onClick={() => {
              setEndsAt(access.endsAt ? access.endsAt.slice(0, 10) : "");
              setDateError(null);
              setDateDialog(true);
            }}
          >
            <CalendarClock aria-hidden="true" className="size-4 text-[var(--text-secondary)]" />
            Mudar data de término…
          </DropdownMenuItem>
          {access.endsAt ? (
            <DropdownMenuItem className={menuItem} onClick={() => void run("remove_end")}>
              <CalendarClock aria-hidden="true" className="size-4 text-[var(--text-secondary)]" />
              Deixar sem prazo
            </DropdownMenuItem>
          ) : null}
          {open ? (
            <>
              <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
              <DropdownMenuItem className={menuItem} onClick={() => void run("suspend")}>
                Suspender
              </DropdownMenuItem>
              <DropdownMenuItem className={menuItemDestructive} onClick={() => void run("revoke")} variant="destructive">
                Revogar acesso
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ProductDialog
        description={`Novo término do acesso a ${productTitle}. O acesso volta a valer se estava suspenso, revogado ou expirado.`}
        footer={
          <>
            <Button className="px-4" disabled={pending} onClick={() => setDateDialog(false)} type="button" variant="ghost">
              Cancelar
            </Button>
            <Button
              className="px-4"
              disabled={pending}
              onClick={() => {
                void run("set_end", endsAt).then((ok) => {
                  if (ok) {
                    setDateDialog(false);
                  }
                });
              }}
              type="button"
            >
              {pending ? "Salvando…" : "Salvar data"}
            </Button>
          </>
        }
        onOpenChange={(next) => {
          if (!pending) {
            setDateDialog(next);
          }
        }}
        open={dateDialog}
        title="Mudar data de término"
      >
        <AdminField error={dateError} id={`prazo-${access.id}`} label="Acesso até">
          <Input
            aria-describedby={fieldDescribedBy(`prazo-${access.id}`, { error: dateError })}
            aria-invalid={dateError ? true : undefined}
            className={cn(adminInputClass, "max-w-[220px] [color-scheme:dark]")}
            disabled={pending}
            id={`prazo-${access.id}`}
            min={today}
            onChange={(event) => {
              setEndsAt(event.target.value);
              setDateError(null);
            }}
            type="date"
            value={endsAt}
          />
        </AdminField>
      </ProductDialog>

      <ProductDialog
        footer={
          <Button className="px-4" onClick={() => setError(null)} type="button" variant="secondary">
            Fechar
          </Button>
        }
        onOpenChange={(next) => {
          if (!next) {
            setError(null);
          }
        }}
        open={Boolean(error)}
        title="Não foi possível alterar o acesso"
      >
        {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      </ProductDialog>
    </>
  );
}
