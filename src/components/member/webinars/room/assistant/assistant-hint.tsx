"use client";

import { Sparkles } from "lucide-react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";

// A linha do Assistente sob o campo do chat e da aba Perguntas (docs/30 §1.6 e §6.6): "O Assistente esta
// respondendo..." logo depois de chamar, o aviso do limite do minuto, a dica "@assistente" com ele ligado e, sem ele e
// sem ninguem atendendo, que a equipe responde depois pelo sino. Nada quando nao ha o que dizer. A cor vem do token do
// tema da sala (docs/31 V2-11).

export type AssistantHintState = "call" | "limit" | "none" | "team_later" | "waiting";

export function assistantHintText(state: AssistantHintState): string | null {
  const copy = WEBINAR_COPY.assistente.aluno;
  switch (state) {
    case "waiting":
      return copy.respondendo;
    case "limit":
      return copy.limite;
    case "call":
      return copy.chamarAssistente;
    case "team_later":
      return copy.equipeRespondeDepois;
    default:
      return null;
  }
}

export function AssistantHint({ state }: { state: AssistantHintState }) {
  const text = assistantHintText(state);
  if (!text) {
    return null;
  }
  return (
    <p aria-live="polite" className="flex items-center gap-1.5 px-1 text-[11px] leading-4 text-room-fg-subtle" data-assistant-hint={state} data-testid="assistant-hint">
      {state === "waiting" || state === "call" ? <Sparkles aria-hidden="true" className="size-3 shrink-0" /> : null}
      <span>{text}</span>
    </p>
  );
}
