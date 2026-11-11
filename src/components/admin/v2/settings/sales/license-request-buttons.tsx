"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { dismissLicenseRequest, retryLicenseRequest } from "@/server/licensing/interno/admin-actions";
import { adminToast } from "../../toast";

// Os botoes de um pedido da fila de Licencas (Configuracoes > Vendas): "Tentar agora" devolve o pedido a vez da proxima
// rodada do tick; "Dispensar" o tira da fila sem ir ao Emissor (a equipe resolveu de outro jeito). O erro fica escrito
// ao lado (no admin, erro nunca vai para toast).

export function LicenseRequestButtons({ canDismiss, canRetry, id }: { canDismiss: boolean; canRetry: boolean; id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"retry" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "retry" | "dismiss") {
    if (busy) {
      return;
    }

    if (kind === "dismiss" && !window.confirm("Dispensar este pedido? Ele sai da fila e não vai mais ao Emissor.")) {
      return;
    }

    setBusy(kind);
    setError(null);
    const result = kind === "retry" ? await retryLicenseRequest({ id }) : await dismissLicenseRequest({ id });
    setBusy(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    adminToast.success(kind === "retry" ? "O pedido vai na próxima rodada (até 1 minuto)" : "Pedido dispensado");
    router.refresh();
  }

  return (
    <span className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
      <span className="flex flex-wrap gap-2">
        {canRetry ? (
          <Button className="h-8! px-3 text-[13px]" disabled={busy !== null} onClick={() => void run("retry")} type="button" variant="secondary">
            {busy === "retry" ? "Enviando…" : "Tentar agora"}
          </Button>
        ) : null}
        {canDismiss ? (
          <Button className="h-8! px-3 text-[13px]" disabled={busy !== null} onClick={() => void run("dismiss")} type="button" variant="ghost">
            {busy === "dismiss" ? "Dispensando…" : "Dispensar"}
          </Button>
        ) : null}
      </span>
      {error ? (
        <span className="text-xs leading-4 text-[var(--error)]" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
