"use client";

import { countdownLabel } from "@/lib/webinar-time";
import { useTickingNow } from "./use-ticking-now";

// "Comeca em 2 d 4 h 12 min" (docs/30 §1.1), andando no navegador. Quando a hora chega, mostra `fallback`
// (ex.: "Aguardando o apresentador"), porque a pagina so muda de situacao ao recarregar.
export function WebinarCountdown({
  className,
  fallback = "",
  serverNow,
  targetIso
}: {
  className?: string;
  fallback?: string;
  /** A hora do servidor quando a pagina foi montada (o primeiro desenho do navegador e igual ao do servidor). */
  serverNow: number;
  targetIso: string;
}) {
  const now = useTickingNow(serverNow);
  const label = countdownLabel(targetIso, now);

  return <span className={className}>{label || fallback}</span>;
}
