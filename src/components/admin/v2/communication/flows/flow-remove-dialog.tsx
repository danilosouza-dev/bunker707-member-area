"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "../../settings/kit";
import { CONDITION_REMOVE_OPTIONS, removeStepCopy, type RemoveMode } from "./flows-view-model";

// "Remover passo" (docs/23 §2.5): a Notificação pergunta "Remover “X”?" (o que esta abaixo sai junto); a
// Condição pergunta qual caminho fica (Manter o caminho “Sim”, Manter o caminho “Não”, Remover tudo daqui
// para baixo, Cancelar). Num fluxo no ar com alunos esperando o passo, a frase diz quantos param ali.

export type RemoveTarget = { id: string; kind: "condition" | "message"; title: string; waiting: number };

type FlowRemoveDialogProps = {
  onCancel: () => void;
  onConfirm: (mode: RemoveMode) => void;
  target: RemoveTarget | null;
};

export function FlowRemoveDialog({ onCancel, onConfirm, target }: FlowRemoveDialogProps) {
  const copy = target ? removeStepCopy(target.kind, target.title, target.waiting) : null;

  if (target?.kind === "message" || !target) {
    return (
      <ConfirmDialog
        confirmLabel="Remover"
        description={copy ? [copy.description, copy.waitingNote].filter(Boolean).join(" ") : undefined}
        destructive
        onConfirm={() => onConfirm("subtree")}
        onOpenChange={(open) => {
          if (!open) {
            onCancel();
          }
        }}
        open={target !== null}
        title={copy?.title ?? ""}
      />
    );
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
      open
    >
      <DialogContent className="max-w-md rounded-xl border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)]" showCloseButton={false}>
        <DialogHeader className="gap-1 px-5 pt-5 pb-2">
          <DialogTitle className="text-base leading-6 font-semibold text-[var(--text-primary)]">{copy?.title}</DialogTitle>
          <DialogDescription className="text-sm leading-5 text-[var(--text-secondary)]">
            {copy?.description}
            {copy?.waitingNote ? ` ${copy.waitingNote}` : null}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 px-5 py-2">
          {CONDITION_REMOVE_OPTIONS.map((option) => (
            <Button
              className={
                option.mode === "subtree"
                  ? "h-11 justify-start border-[var(--error-border)] bg-[var(--error-bg)] px-4 text-[var(--error)] hover:bg-[var(--error-bg)] hover:brightness-125"
                  : "h-11 justify-start px-4"
              }
              key={option.mode}
              onClick={() => onConfirm(option.mode)}
              type="button"
              variant="secondary"
            >
              {option.label}
            </Button>
          ))}
        </div>
        <DialogFooter className="px-5 pt-1 pb-5">
          <Button className="px-4 text-[var(--text-secondary)]" onClick={onCancel} type="button" variant="ghost">
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
