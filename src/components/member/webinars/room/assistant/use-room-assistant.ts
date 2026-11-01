"use client";

// O Assistente na sala do aluno (docs/30 §1.6 e §6.6; fase 4c): le o estado (ligado, "Responder tudo" e quantos da
// equipe estao atendendo) ao abrir, a cada minuto com a aba visivel e ao voltar para a aba, e manda o "Falar com a
// equipe". Desligado (o "ver como" da equipe, sem webinario ou sessao), nao le nada e diz desligado. A falha de uma
// leitura mantem o ultimo estado (a proxima vem no minuto seguinte).

import { useCallback, useEffect, useState } from "react";
import { ASSISTANT_OFF, ASSISTANT_STATE_REFRESH_MS, type StudentAssistantState } from "@/server/webinars/assistant-model";
import type { AssistantTarget } from "@/server/webinars/model";
import { getAssistantState, postHandoff } from "./assistant-api";

export type RoomAssistant = {
  /** "Falar com a equipe" na propria mensagem ou pergunta; devolve se ficou pedido (ou ja estava). */
  handoff: (target: AssistantTarget, id: string) => Promise<boolean>;
  state: StudentAssistantState;
};

/**
 * O painel (o chat ou a aba Perguntas) le o Assistente sozinho so quando a sala nao passou o estado dela (docs/31
 * V2-4: a sala le uma vez e desce pela prop `assistant`) e fora do so leitura; com o estado da sala, a leitura propria
 * fica desligada e nao ha um segundo pedido por minuto. `enabled` e a aba que pode ler (a Perguntas desligada no "ver
 * como"); sem ele, so o so leitura decide.
 */
export function ownAssistantEnabled(input: { enabled?: boolean; readOnly: boolean; shared: RoomAssistant | null | undefined }): boolean {
  return !input.shared && input.enabled !== false && !input.readOnly;
}

export function useRoomAssistant(input: { enabled: boolean; sessionId?: string | null; webinarId?: string | null }): RoomAssistant {
  const { enabled, sessionId, webinarId } = input;
  const [state, setState] = useState<StudentAssistantState>(ASSISTANT_OFF);
  const active = Boolean(enabled && sessionId && webinarId);

  useEffect(() => {
    if (!active || !sessionId || !webinarId) {
      return;
    }
    let stopped = false;
    const controller = new AbortController();
    const load = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      try {
        const next = await getAssistantState(webinarId, sessionId, controller.signal);
        if (!stopped) {
          setState(next);
        }
      } catch {
        // A proxima leitura vem em 1 minuto.
      }
    };
    const first = window.setTimeout(() => void load(), 0);
    const id = window.setInterval(() => void load(), ASSISTANT_STATE_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void load();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(first);
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, sessionId, webinarId]);

  const handoff = useCallback(
    async (target: AssistantTarget, id: string) => {
      if (!active || !sessionId || !webinarId) {
        return false;
      }
      await postHandoff(webinarId, { id, sessionId, target });
      return true;
    },
    [active, sessionId, webinarId]
  );

  return { handoff, state: active ? state : ASSISTANT_OFF };
}
