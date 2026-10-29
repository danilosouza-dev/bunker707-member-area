"use client";

import { jitPageSentence, jitPageState } from "@/server/webinars/jit-clock";
import type { StudentJitView } from "@/server/webinars/student-model";
import { useTickingNow } from "../use-ticking-now";

// "A próxima sessão começa em {n} min" (docs/30 §2.7) andando no navegador a cada 15 s, com a mesma conta do servidor
// (jitPageState): a sessao das {hora} que ja comecou, o proximo horario ou fora do horario. No servidor e na
// hidratacao vale a hora da pagina (o primeiro desenho e igual ao do servidor).

export function JitCountdown({ className, jit, serverNow }: { className?: string; jit: StudentJitView; serverNow: number }) {
  const now = useTickingNow(serverNow);
  const state = jitPageState({ durationMs: jit.durationMs, nowMs: now, settings: jit });

  return (
    <span className={className} data-jit-countdown={state.kind}>
      {jitPageSentence(state)}
    </span>
  );
}
