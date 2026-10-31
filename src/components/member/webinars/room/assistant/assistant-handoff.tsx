"use client";

import { Headset } from "lucide-react";
import { useState } from "react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { RoomButton } from "../room-ui";

// "Falar com a equipe" (docs/30 §1.6 e D24): aparece na resposta do Assistente ao proprio aluno (no chat e na aba
// Perguntas). Um clique marca o pedido; depois, a frase de pronto (e, sem ninguem atendendo agora, que a equipe
// responde depois pelo sino). A falha mostra a frase do servidor e deixa tentar de novo. No "ver como", desligado.
// Redesign V2, F2 (docs/31 V2-11): as cores vem dos tokens do tema da sala.

export type AssistantHandoffProps = {
  /** Ninguem da equipe atendendo agora: a frase de pronto diz que a resposta chega pelo sino. */
  attendantsOnline: number;
  /** O pedido ja estava feito (lido do servidor). */
  done?: boolean;
  onRequest: () => Promise<boolean>;
  readOnly?: boolean;
};

export function AssistantHandoff({ attendantsOnline, done = false, onRequest, readOnly = false }: AssistantHandoffProps) {
  const copy = WEBINAR_COPY.assistente.aluno;
  const [state, setState] = useState<"done" | "idle" | "sending">(done ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);

  if (state === "done" || done) {
    return (
      <p className="mt-1 text-[12px] leading-4 text-room-fg-subtle" data-testid="assistant-handoff-done" role="status">
        {copy.pedidoEnviado}
        {attendantsOnline === 0 ? ` ${copy.equipeRespondeDepois}` : ""}
      </p>
    );
  }

  async function request() {
    setState("sending");
    setError(null);
    try {
      setState((await onRequest()) ? "done" : "idle");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : copy.indisponivel);
      setState("idle");
    }
  }

  return (
    <div className="mt-1">
      <RoomButton className="h-8 px-2.5 text-[12px]" data-testid="assistant-handoff" disabled={readOnly || state === "sending"} onClick={() => void request()} size="sm" variant="ghost">
        <Headset aria-hidden="true" className="size-3.5" />
        {copy.falarComAEquipe}
      </RoomButton>
      {error ? (
        <p className="mt-0.5 text-[11px] text-room-warn-fg" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
