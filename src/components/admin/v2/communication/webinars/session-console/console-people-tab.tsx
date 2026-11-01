"use client";

import { MicOff, Video, VideoOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { LIVE_CONSOLE_COPY, handRows, roomRows, type LiveConsolePerson } from "@/server/webinars/live-console-model";
import { CONSOLE_PANE_CARD } from "./console-layout-model";
import { LiveParticipants, type PersonAction } from "./live-participants";
import type { LiveRoomHandle } from "./live-room-panel";

// A aba Pessoas do console de quem apresenta (docs/31 V2-14 e V2-15, "como no Zoom"), de cima para baixo: as acoes de
// todos (Silenciar todos, o muteEveryone de audio; Fechar todas as câmeras, o de video; e o "Câmeras livres", a
// moderacao de video desligada, com o estado em aria-pressed pelo que o motor diz: o moderationStatusChanged de video e
// o isModerationOn na entrada, nunca o clique), a caixa desligada e fixa do microfone que o aluno abre sozinho, a Sala
// de espera com Admitir por pessoa e Admitir todos (answerKnockingParticipant), quem esta na sala (LiveParticipants:
// "Na sala · 3", o microfone, a camera, o Compartilhando e o ⋯ de cada um, e os removidos, silenciados e banidos com
// Desfazer) e o rodape "3 na sala · 2 com a mão levantada". Cada botao so aparece para o papel que pode
// (liveControlsFor) e so liga com o console dentro da sala. O Silenciar todos tambem silencia o co-apresentador e a
// Equipe no palco: o motor so deixa de fora o proprio console (docs/31 V2-A40).

const copy = WEBINAR_COPY.consoleAoVivo;
const pessoas = WEBINAR_COPY.consoleV2.pessoas;

type ConsolePeopleTabProps = {
  busyKey: string | null;
  canPublish: boolean;
  handle: LiveRoomHandle;
  onAction: (person: LiveConsolePerson | null, participantId: string | null, action: PersonAction) => void;
  people: readonly LiveConsolePerson[];
};

export function ConsolePeopleTab({ busyKey, canPublish, handle, onAction, people }: ConsolePeopleTabProps) {
  const { controls, joined, room } = handle;
  const knocking = room.knocking;
  const inRoom = roomRows(room, people).length;
  const hands = handRows(room, people).length;

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
    <div className={CONSOLE_PANE_CARD} data-console-people="">
      {controls.muteAll || controls.cameras ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2" data-live-controls="">
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
                {pessoas.cameras}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

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

      <LiveParticipants busyKey={busyKey} canPublish={canPublish} handle={handle} onAction={onAction} people={people} />

      <p className="border-t border-[var(--border-subtle)] pt-3 text-xs leading-5 text-[var(--text-secondary)] tabular-nums" data-console-people-footer="">
        {pessoas.rodape(inRoom, hands)}
      </p>
    </div>
  );
}
