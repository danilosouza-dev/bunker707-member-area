"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TEMPLATE_LIMITS, templateNameSchema } from "@/server/communications/template-model";
import { ErrorBanner } from "../../error-banner";
import { AdminField, adminInputClass, fieldDescribedBy } from "../../form";
import { TEMPLATE_COPY, nameCounter, templateFailureCopy } from "./templates-view-model";

// Dialogo do nome de um modelo (docs/28; spec §5.2 e §6.2): "Renomear modelo" na lista e, na frente E, "Salvar
// design como modelo" (card Design e aba Modelos do editor Livre). Um campo "Nome do modelo" com o contador
// "{n}/80", focado com o texto selecionado ao abrir; Enter salva e Esc fecha (menos durante o salvar). O erro do
// nome fica embaixo do campo; o resto, num banner dentro do dialogo. Por cima do editor Livre, o portal do Base UI
// abre depois do editor (o mesmo padrao do PasteDialog) e o foco volta ao botao que abriu.

export type TemplateNameDialogProps = {
  confirmLabel: string;
  defaultName: string;
  description?: string;
  /**
   * Para onde o foco vai ao fechar (o mesmo `finalFocus` do Base UI). Sem ele, volta ao botao que abriu; a lista
   * passa o "…" da linha (o menu ja fechou quando o dialogo abre).
   */
  finalFocus?: () => HTMLElement | null;
  onOpenChange: (open: boolean) => void;
  /** Grava; erro de nome fica no campo, o resto no banner do dialogo. */
  onSubmit: (name: string) => Promise<{ ok: true } | { fieldError?: string; message: string; ok: false; status: number }>;
  open: boolean;
  title: string;
};

export function TemplateNameDialog({ confirmLabel, defaultName, description, finalFocus, onOpenChange, onSubmit, open, title }: TemplateNameDialogProps) {
  const baseId = useId();
  const fieldId = `${baseId}-nome`;
  const field = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ message: string; status: number } | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  const failureCopy = failure ? templateFailureCopy(failure) : null;
  const counter = nameCounter(name);

  // Cada abertura comeca do nome sugerido, sem erro (ajuste no proprio desenho, sem efeito).
  if (open !== wasOpen) {
    setWasOpen(open);

    if (open) {
      setName(defaultName);
      setFieldError(null);
      setFailure(null);
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busy) {
      return;
    }

    // O nome vazio ou longo nem vai ao servidor (a mesma regra e a mesma frase de la).
    const checked = templateNameSchema.safeParse(name);

    if (!checked.success) {
      setFieldError(checked.error.issues[0]?.message ?? TEMPLATE_COPY.nameDialog.label);
      field.current?.focus();
      return;
    }

    setBusy(true);
    setFieldError(null);
    setFailure(null);

    try {
      const result = await onSubmit(checked.data);

      if (result.ok) {
        onOpenChange(false);
        return;
      }

      if (result.fieldError) {
        setFieldError(result.fieldError);
        field.current?.focus();
      } else {
        setFailure({ message: result.message, status: result.status });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog onOpenChange={(next) => (!next && !busy ? onOpenChange(false) : undefined)} open={open}>
      <DialogContent
        className="max-w-md rounded-xl border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)]"
        data-template-name-dialog=""
        finalFocus={finalFocus ? () => finalFocus() ?? true : undefined}
        initialFocus={() => {
          // Foco no campo com o texto selecionado (digitar troca o nome inteiro).
          field.current?.select();

          return field.current;
        }}
        showCloseButton={false}
      >
        <form className="flex min-h-0 flex-col" noValidate onSubmit={(event) => void submit(event)}>
          <DialogHeader className="gap-1 px-5 pt-5 pb-2">
            <DialogTitle className="text-base leading-6 font-semibold text-[var(--text-primary)]">{title}</DialogTitle>
            {description ? <DialogDescription className="text-sm leading-5 text-[var(--text-secondary)]">{description}</DialogDescription> : null}
          </DialogHeader>
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 py-3">
            <AdminField error={fieldError} hint={counter} id={fieldId} label={TEMPLATE_COPY.nameDialog.label}>
              <input
                aria-describedby={fieldDescribedBy(fieldId, { error: fieldError, hint: fieldError ? null : counter })}
                aria-invalid={fieldError ? true : undefined}
                autoComplete="off"
                className={adminInputClass}
                id={fieldId}
                maxLength={TEMPLATE_LIMITS.name}
                onChange={(event) => {
                  setName(event.target.value);
                  setFieldError(null);
                }}
                ref={field}
                required
                value={name}
              />
            </AdminField>
            {failureCopy ? <ErrorBanner title={failureCopy.title}>{failureCopy.message}</ErrorBanner> : null}
          </div>
          <DialogFooter className="px-5 pt-3 pb-5">
            <Button className="px-4 text-[var(--text-secondary)]" disabled={busy} onClick={() => onOpenChange(false)} type="button" variant="ghost">
              {TEMPLATE_COPY.nameDialog.cancel}
            </Button>
            <Button className="px-4" disabled={busy} type="submit">
              {busy ? TEMPLATE_COPY.nameDialog.saving : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
