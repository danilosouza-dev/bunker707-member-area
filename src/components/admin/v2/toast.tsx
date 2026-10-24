"use client";

import { Toaster, toast } from "sonner";

// Toasts do admin (docs/17 §2.7): so para sucesso, 3 a 4 s, com "Desfazer" quando a acao tem volta
// (excluir aula ou modulo: 10 s), e o aviso neutro `info` quando nada precisou acontecer ("Nenhuma
// mudança para salvar."). Erro nunca vai para toast: fica em banner persistente na tela.
// O <AdminToaster /> ja esta montado uma vez em AdminShellV2; as telas so chamam adminToast.

export const ADMIN_TOAST_DURATION_MS = 3_500;
export const ADMIN_UNDO_DURATION_MS = 10_000;

type AdminToastOptions = {
  /** "Desfazer": o toast dura 10 s e chama onUndo uma vez. */
  onUndo?: () => void;
  undoLabel?: string;
};

export const adminToast = {
  success(message: string, options: AdminToastOptions = {}) {
    const { onUndo, undoLabel = "Desfazer" } = options;

    return toast.success(message, {
      action: onUndo ? { label: undoLabel, onClick: () => onUndo() } : undefined,
      duration: onUndo ? ADMIN_UNDO_DURATION_MS : ADMIN_TOAST_DURATION_MS
    });
  },
  /** Neutro, sem icone de sucesso: a acao nao tinha o que fazer. */
  info(message: string) {
    return toast(message, { duration: ADMIN_TOAST_DURATION_MS });
  },
  dismiss(id?: string | number) {
    toast.dismiss(id);
  }
};

export function AdminToaster() {
  return (
    <Toaster
      closeButton={false}
      position="bottom-right"
      theme="dark"
      toastOptions={{
        style: {
          background: "var(--surface-3)",
          border: "1px solid var(--border-strong)",
          borderRadius: "8px",
          color: "var(--text-primary)",
          fontSize: "14px"
        }
      }}
    />
  );
}
