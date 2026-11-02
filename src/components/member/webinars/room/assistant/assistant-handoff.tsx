"use client";

import { useState } from "react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { RoomPill } from "../room-pill";

// "Falar com a equipe" (docs/30 §1.6 e D24): aparece na resposta do Assistente ao proprio aluno (no chat e na aba
// Perguntas). Um clique marca o pedido; depois, a frase de pronto (e, sem ninguem atendendo agora, que a equipe
// responde depois pelo sino). A falha mostra a frase do servidor e deixa tentar de novo. No "ver como", desligado.
// Redesign V2, F2 (docs/31 V2-11): as cores vem dos tokens do tema da sala. No estilo do YouTube (spec §8.3), o botao e a
// pilula S de texto, sem icone, na linha de acoes do comentario.

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
    <div>
      <RoomPill data-testid="assistant-handoff" disabled={readOnly || state === "sending"} label={copy.falarComAEquipe} onClick={() => void request()} size="s" tone="text" />
      {error ? (
        <p className="mt-0.5 text-[11px] text-room-warn-fg" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
