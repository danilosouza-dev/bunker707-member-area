"use client";

import { CalendarClock, Radio } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MemberButton } from "@/components/member/ui/member-button";
import { MemberSurface } from "@/components/member/ui/member-surface";
import { withAccessPreviewParam, type AccessPreviewMode } from "@/lib/access-preview";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { jitCanEnter, jitPageSentence, jitPageState } from "@/server/webinars/jit-model";
import { ROOM_OPENS_MINUTES_BEFORE } from "@/server/webinars/room-model";
import type { StudentJitView } from "@/server/webinars/student-model";
import { useTickingNow } from "../use-ticking-now";
import { JitRequestError, enterJitRoom } from "./jit-client";

// O "Comeca quando voce entra" na pagina do Webinario (fase 4e; docs/30 §1.2, §1.6 e §2.7): sem Garantir vaga, so
// Entrar. A frase de agora ("A próxima sessão começa em {n} min", "A sessão das {hora} já começou. Entre agora." ou
// fora do horario) anda a cada 15 s no navegador; o Entrar liga quando a sessao atual ainda aceita ou quando a sala do
// proximo horario ja abriu (15 min antes) e, no clique, pede a sessao (POST .../jit) e leva o aluno para a sala, que
// abre na espera como as outras sessoes gravadas. Uma vez por clique (o botao trava enquanto espera); a recusa do
// servidor (banido, fora do horario) aparece em uma frase. No "ver como" da equipe nada e gravado: o Entrar fica
// desligado.

export function JitEnter({
  accessPreviewMode,
  jit,
  readOnly,
  serverNow,
  webinarId
}: {
  accessPreviewMode?: AccessPreviewMode;
  jit: StudentJitView;
  /** "Ver como" da equipe: mostra, mas nao grava. */
  readOnly: boolean;
  serverNow: number;
  webinarId: string;
}) {
  const copy = WEBINAR_COPY.jit.aluno;
  const router = useRouter();
  const now = useTickingNow(serverNow);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = jitPageState({ durationMs: jit.durationMs, nowMs: now, settings: jit });
  const canEnter = jitCanEnter(state);

  async function enter() {
    if (busy || readOnly || !canEnter) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const answer = await enterJitRoom(webinarId, copy.erro);
      router.push(withAccessPreviewParam(answer.roomHref, accessPreviewMode));
    } catch (caught) {
      setError(caught instanceof JitRequestError ? caught.message : copy.erro);
      setBusy(false);
    }
  }

  return (
    <MemberSurface data-jit-enter={state.kind} variant="inset">
      <p className="flex items-center gap-2 text-lg font-bold text-white">
        <CalendarClock aria-hidden="true" className="size-5 shrink-0 text-[var(--accent)]" strokeWidth={2.2} />
        {/* Sem aria-live: a conta muda a cada minuto e o leitor de tela anunciaria cada um. */}
        <span>{jitPageSentence(state)}</span>
      </p>
      {state.kind === "next" && !state.roomOpen ? <p className="mt-1 text-sm leading-6 text-zinc-400">{copy.salaAbreAntes(ROOM_OPENS_MINUTES_BEFORE)}</p> : null}
      <p className="mt-1 text-sm leading-6 text-zinc-400">{copy.semVaga}</p>
      {state.kind !== "closed" ? (
        <div className="mt-3">
          <MemberButton aria-disabled={!canEnter || readOnly || busy ? "true" : undefined} disabled={!canEnter || readOnly || busy} onClick={() => void enter()} size="lg" variant="primary">
            <Radio />
            {busy ? copy.preparando : copy.entrar}
          </MemberButton>
        </div>
      ) : null}
      {readOnly ? <p className="mt-2 text-xs text-zinc-500">{WEBINAR_COPY.aluno.previaSemGravar}</p> : null}
      {error ? (
        <p className="mt-2 text-sm font-medium leading-6 text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </MemberSurface>
  );
}
