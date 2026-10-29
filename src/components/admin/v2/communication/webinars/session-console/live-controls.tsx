"use client";

import { Lock, LockOpen, MicOff, Video, VideoOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { LIVE_CONSOLE_COPY } from "@/server/webinars/live-console-model";
import type { LiveRoomHandle } from "./live-room-panel";

// Os controles da sala ao redor do palco (docs/30 §1.4 e §2.9): Silenciar todos (muteEveryone de audio), Fechar todas
// as cameras (muteEveryone de video), Permitir cameras dos alunos (toggleModeration de video), Trancar / Destrancar a
// sala (room_locked no servidor + toggleLobby), a Sala de espera com Admitir / Admitir todos (answerKnockingParticipant)
// e a opcao "Permitir que o aluno abra o microfone sozinho", visivel e desligada (fixa assim na v1). Cada botao so
// aparece para o papel que pode (live-console-model.liveControlsFor) e so liga com o console dentro da sala.

const copy = WEBINAR_COPY.consoleAoVivo;

type LiveControlsProps = {
  busyKey: string | null;
  canWrite: boolean;
  handle: LiveRoomHandle;
  onLock: (locked: boolean) => void;
  roomLocked: boolean;
};

export function LiveControls({ busyKey, canWrite, handle, onLock, roomLocked }: LiveControlsProps) {
  const { controls, joined, room } = handle;
  const knocking = room.knocking;

  function admit(id: string) {
    if (handle.command("answerKnockingParticipant", id, true)) {
      handle.dispatch({ id, type: "admit" });
    }
  }

  function admitAll() {
    for (const person of knocking) {
      handle.command("answerKnockingParticipant", person.id, true);
    }
    handle.dispatch({ type: "admitAll" });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4" data-live-controls="">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {controls.muteAll ? (
          <Button className="px-3" disabled={!joined} onClick={() => handle.command("muteEveryone", "audio")} type="button" variant="secondary">
            <MicOff aria-hidden="true" className="size-4" />
            {copy.silenciarTodos}
          </Button>
        ) : null}
        {controls.cameras ? (
          <>
            <Button className="px-3" disabled={!joined} onClick={() => handle.command("muteEveryone", "video")} type="button" variant="secondary">
              <VideoOff aria-hidden="true" className="size-4" />
              {copy.fecharCameras}
            </Button>
            <Button
              aria-pressed={handle.camerasAllowed}
              className={cn("px-3", handle.camerasAllowed && "border-[var(--border-strong)]")}
              disabled={!joined}
              onClick={() => handle.setCamerasAllowed(!handle.camerasAllowed)}
              type="button"
              variant="secondary"
            >
              <Video aria-hidden="true" className="size-4" />
              {copy.permitirCameras}
            </Button>
          </>
        ) : null}
        {controls.lock ? (
          <Button
            aria-pressed={roomLocked}
            className="px-3"
            disabled={!canWrite || busyKey === "live:lock"}
            onClick={() => onLock(!roomLocked)}
            type="button"
            variant="secondary"
          >
            {roomLocked ? <LockOpen aria-hidden="true" className="size-4" /> : <Lock aria-hidden="true" className="size-4" />}
            {roomLocked ? copy.destrancar : copy.trancar}
          </Button>
        ) : null}
      </div>

      {controls.release ? (
        <label className="flex min-w-0 items-start gap-2 text-[13px] leading-5 text-[var(--text-secondary)]">
          <input checked={false} className="mt-0.5 size-4 shrink-0" disabled readOnly type="checkbox" />
          <span className="flex min-w-0 flex-col">
            <span className="text-[var(--text-primary)]">{LIVE_CONSOLE_COPY.microfoneSozinho}</span>
            <span>{LIVE_CONSOLE_COPY.microfoneSozinhoTexto}</span>
          </span>
        </label>
      ) : null}

      {controls.admit ? (
        <section aria-labelledby="console-live-lobby-title" className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2" data-live-lobby="">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" id="console-live-lobby-title">
              {copy.salaDeEspera}
            </h3>
            {knocking.length > 0 ? (
              <Button className="h-8! px-2 text-[13px]" disabled={!joined} onClick={admitAll} type="button" variant="secondary">
                {copy.admitirTodos}
              </Button>
            ) : null}
          </div>
          <p aria-live="polite" className="text-xs leading-5 text-[var(--text-tertiary)]">
            {knocking.length > 0 ? copy.esperando(knocking.length) : copy.ninguemEsperando}
          </p>
          {knocking.length > 0 ? (
            <ul className="flex min-w-0 flex-col gap-1">
              {knocking.map((person) => (
                <li className="flex min-w-0 items-center justify-between gap-2" data-live-knocking={person.id} key={person.id}>
                  <span className="truncate text-sm leading-5 text-[var(--text-primary)]">{person.name || LIVE_CONSOLE_COPY.equipe}</span>
                  <Button aria-label={`${copy.admitir}: ${person.name}`} className="h-8! px-2 text-[13px]" disabled={!joined} onClick={() => admit(person.id)} type="button" variant="secondary">
                    {copy.admitir}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
