"use client";

import { useId } from "react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { RoomButton } from "./room-ui";

/**
 * A confirmacao de Sair da sala: uma janela no centro, sobre um veu que cobre a sala inteira (no lugar da faixa de
 * antes, abaixo do topo). O papel continua alertdialog com o nome "Sair da sala?" e o `data-room-confirm`: o foco entra
 * no Voltar e volta para quem a abriu (useRoomConfirmFocus), o Esc fecha pela regra da sala (roomEscapeStep) e o Tab fica
 * preso nos dois botoes (a sala passa o `[data-room-confirm]` ao trapRoomFocus enquanto ela esta aberta). O clique no veu
 * e o Voltar.
 */
export function RoomLeaveDialog({ onCancel, onLeave }: { onCancel: () => void; onLeave: () => void }) {
  const copy = WEBINAR_COPY.sala;
  const titleId = useId();
  const textId = useId();
  return (
    <div
      className="absolute inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
      data-room-confirm-backdrop=""
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        aria-describedby={textId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full max-w-[400px] rounded-xl border border-room-panel-border bg-room-menu p-6 text-room-fg shadow-[var(--room-menu-shadow)]"
        data-room-confirm=""
        role="alertdialog"
      >
        <h2 className="text-xl font-semibold leading-7 text-room-fg-strong" id={titleId}>
          {copy.sairConfirmar}
        </h2>
        <p className="mt-2 text-sm leading-5 text-room-fg-muted" id={textId}>
          {copy.sairConfirmarTexto}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <RoomButton data-room-first-focus onClick={onCancel} variant="secondary">
            {copy.voltar}
          </RoomButton>
          <RoomButton onClick={onLeave} variant="danger">
            {copy.sair}
          </RoomButton>
        </div>
      </div>
    </div>
  );
}
