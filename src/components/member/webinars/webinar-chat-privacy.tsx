"use client";

import { MessageSquareOff } from "lucide-react";
import { useState } from "react";
import { MemberButton } from "@/components/member/ui/member-button";
import { MemberSurface } from "@/components/member/ui/member-surface";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { deleteMyChat, WebinarsRequestError } from "./room/room-api";

// Perfil › Privacidade › Chat das lives (docs/30 §8.5, D10): o aluno retira o aceite do chat e apaga, de uma vez,
// as mensagens, perguntas e respostas de enquete de todas as sessoes e replays (DELETE /api/webinars/chat). A
// confirmacao e inline (o lado do aluno nao tem dialogo global); o resultado fica em aria-live.

export function WebinarChatPrivacy({ readOnly = false }: { readOnly?: boolean }) {
  const copy = WEBINAR_COPY.privacidade;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: "error" | "ok" } | null>(null);

  async function remove() {
    setBusy(true);
    setStatus(null);
    try {
      const answer = await deleteMyChat(null);
      setConfirming(false);
      setStatus({ text: answer.removed > 0 ? copy.feito(answer.removed) : copy.nadaParaRemover, tone: "ok" });
    } catch (failure) {
      setStatus({ text: failure instanceof WebinarsRequestError ? failure.message : WEBINAR_COPY.sala.erroEnviar, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <MemberSurface className="flex flex-col gap-4 sm:flex-row sm:items-start" padding="md">
      <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-white/[0.07] text-zinc-200">
        <MessageSquareOff className="size-5" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-bold text-white">{copy.titulo}</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-400">{copy.texto}</p>
        {confirming ? (
          <div className="mt-3 rounded-[12px] border border-red-400/25 bg-red-500/10 p-3" role="alertdialog" aria-label={copy.confirmar}>
            <p className="text-sm font-bold text-white">{copy.confirmar}</p>
            <p className="mt-1 text-xs leading-5 text-zinc-300">{copy.confirmarTexto}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <MemberButton disabled={busy} onClick={() => void remove()} size="sm" variant="danger">
                {WEBINAR_COPY.sala.removerMinhasMensagens}
              </MemberButton>
              <MemberButton disabled={busy} onClick={() => setConfirming(false)} size="sm" variant="ghost">
                {WEBINAR_COPY.admin.cancelar}
              </MemberButton>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <MemberButton disabled={readOnly || busy} onClick={() => setConfirming(true)} variant="secondary">
              {WEBINAR_COPY.sala.removerMinhasMensagens}
            </MemberButton>
            {readOnly ? <p className="mt-2 text-xs text-zinc-500">{WEBINAR_COPY.aluno.previaSemGravar}</p> : null}
          </div>
        )}
        <p aria-live="polite" className={`mt-2 min-h-5 text-sm font-medium ${status?.tone === "error" ? "text-red-300" : "text-emerald-300"}`}>
          {status?.text ?? ""}
        </p>
      </div>
    </MemberSurface>
  );
}
