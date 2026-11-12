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
  /**
   * Um aviso neutro com uma acao que nao e desfazer (o console: "Ana M. levantou a mão." com Ver fila). O mesmo `id`
   * troca o aviso no lugar, sem empilhar.
   */
  notice(message: string, options: { action?: { label: string; onClick: () => void }; durationMs?: number; id?: string } = {}) {
    return toast(message, { action: options.action, duration: options.durationMs ?? ADMIN_TOAST_DURATION_MS, id: options.id });
  },
  dismiss(id?: string | number) {
    toast.dismiss(id);
  }
};

/** Onde os avisos abrem: no canto de baixo a direita (o admin) ou em cima, no meio, abaixo do topo (o console). */
type AdminToasterPlacement = "bottom-right" | "console";

/**
 * O tema dos avisos: escuro, como todo o admin. O console de quem apresenta monta o dele dentro da raiz com o tema
 * escolhido (docs/31 V2-12); as cores ja vem dos tokens, que a ponte do console redefine. No console os avisos abrem em
 * cima, no meio, logo abaixo do topo (a altura vem da variavel --console-toast-top da raiz): embaixo a direita eles
 * cobriam o campo e o Enviar do chat, presos no canto de baixo do painel. No console o aviso tem o desenho invertido do
 * aviso da sala (docs/31 §10).
 */
export function AdminToaster({ placement = "bottom-right", theme = "dark" }: { placement?: AdminToasterPlacement; theme?: "dark" | "light" }) {
  const inConsole = placement === "console";
  return (
    <Toaster
      closeButton={false}
      mobileOffset={inConsole ? { top: "var(--console-toast-top)" } : undefined}
      offset={inConsole ? { top: "var(--console-toast-top)" } : undefined}
      position={inConsole ? "top-center" : "bottom-right"}
      theme={theme}
      toastOptions={{
        // No console, a acao do aviso (Ver fila, Desfazer) e o texto na cor da acao do aviso da sala, sem a caixa do
        // botao da biblioteca (docs/30 D99).
        actionButtonStyle: inConsole ? { background: "transparent", color: "var(--room-snackbar-action)", fontSize: "14px", fontWeight: 600, padding: "0 4px" } : undefined,
        // No console, o aviso invertido da sala no estilo do YouTube (docs/31 §10, o RoomSnackbar): o fundo claro no
        // escuro e o escuro no claro, sem contorno, raio 8 e a sombra do aviso; no admin, o cartao de sempre.
        style: inConsole
          ? {
              background: "var(--room-snackbar-bg)",
              border: "none",
              borderRadius: "8px",
              boxShadow: "var(--room-snackbar-shadow)",
              color: "var(--room-snackbar-fg)",
              fontSize: "14px",
              lineHeight: "20px"
            }
          : {
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
