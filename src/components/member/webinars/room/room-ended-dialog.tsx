"use client";

import { useId } from "react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { RoomButton } from "./room-ui";

/**
 * A janela "A live foi encerrada" (rodada v11, pedido do produtor de 12/11/2026; docs/30 D104): quando a live acaba com
 * o aluno na sala, a pagina avisa numa janela no centro, com o desenho da area, no lugar do dialogo do motor de video
 * ("A chamada foi encerrada", que continua desligado, D97). O mesmo desenho do "Sair da sala?": alertdialog sobre o veu
 * que cobre a sala, com o `data-room-confirm` (o foco entra no OK e o Tab fica preso nela, useRoomConfirmFocus e
 * trapRoomFocus). O OK, o Esc e o clique no veu so fecham a janela: a tela de live encerrada fica atras dela.
 */
export function RoomEndedDialog({ onClose }: { onClose: () => void }) {
  const copy = WEBINAR_COPY.salaV2.encerrada;
  const titleId = useId();
  const textId = useId();
  return (
    <div
      className="absolute inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
      data-room-confirm-backdrop=""
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        aria-describedby={textId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full max-w-[400px] rounded-xl border border-room-panel-border bg-room-menu p-6 text-room-fg shadow-[var(--room-menu-shadow)]"
        data-room-confirm=""
        data-room-ended-dialog=""
        role="alertdialog"
      >
        <h2 className="text-xl font-semibold leading-7 text-room-fg-strong" id={titleId}>
          {copy.titulo}
        </h2>
        <p className="mt-2 text-sm leading-5 text-room-fg-muted" id={textId}>
          {copy.texto}
        </p>
        <div className="mt-6 flex justify-end">
          <RoomButton data-room-first-focus onClick={onClose} variant="primary">
            {copy.ok}
          </RoomButton>
        </div>
      </div>
    </div>
  );
}

/**
 * A janela abre quando a live acaba com a pagina aberta nela (a fase passa de "live" para "ended"); quem abre a pagina
 * de uma live que ja tinha acabado so ve a tela de encerrada, sem janela.
 */
export function endedDialogOpens(before: string, now: string): boolean {
  return before === "live" && now === "ended";
}
