"use client";

import { Hand, Mic, MicOff, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { LIVE_CONSOLE_COPY, handRows, lowerHandMessage, roomRows, type LiveConsolePerson } from "@/server/webinars/live-console-model";
import { SectionCard } from "../../../settings/kit";
import type { LiveRoomHandle } from "./live-room-panel";

// O painel Mao levantada (docs/30 §1.4 e §2.4): a fila na ordem em que as maos subiram (raiseHandUpdated do iframe do
// console), Liberar (askToUnmute: o aluno aceita com um clique; com a moderacao de audio, isso tambem o aprova), Abaixar
// a mao (o IFrame API nao abaixa a mao de outro: o console manda ao aluno o sinal LOWER_HAND_SIGNAL pelo
// sendEndpointTextMessage e tira da fila), Pular (vai para o fim), Abaixar todas as maos, e quem esta com o microfone
// liberado com Silenciar (muteRemoteParticipant + rejectParticipant de audio). Liberar e Silenciar sao do Apresentador
// e do co-apresentador; abaixar e pular, de toda a Equipe.

const copy = WEBINAR_COPY.consoleAoVivo;

type LiveHandsProps = {
  handle: LiveRoomHandle;
  people: readonly LiveConsolePerson[];
};

export function LiveHands({ handle, people }: LiveHandsProps) {
  const { controls, joined, room } = handle;
  const hands = handRows(room, people);
  const names = new Map(roomRows(room, people).map((row) => [row.id, row.name]));

  function release(id: string) {
    if (handle.command("askToUnmute", id)) {
      handle.dispatch({ id, type: "release" });
    }
  }

  function silence(id: string) {
    handle.command("muteRemoteParticipant", id, "audio");
    handle.command("rejectParticipant", id, "audio");
    handle.dispatch({ id, type: "silence" });
  }

  function lower(id: string) {
    handle.command("sendEndpointTextMessage", id, lowerHandMessage());
    handle.dispatch({ id, type: "lowerHand" });
  }

  function lowerAll() {
    for (const hand of room.hands) {
      handle.command("sendEndpointTextMessage", hand.id, lowerHandMessage());
    }
    handle.dispatch({ type: "lowerAll" });
  }

  return (
    <SectionCard
      actions={
        controls.hands && hands.length > 0 ? (
          <Button className="h-8! px-2 text-[13px]" disabled={!joined} onClick={lowerAll} type="button" variant="secondary">
            {copy.abaixarTodas}
          </Button>
        ) : null
      }
      title={copy.maoLevantada(hands.length)}
      titleId="console-live-hands-title"
    >
      <div className="flex min-w-0 flex-col gap-3" data-live-hands="">
        {hands.length === 0 ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.nenhumaMao}</p> : null}
        {hands.length > 0 ? (
          <ol className="flex min-w-0 flex-col gap-2">
            {hands.map((hand, index) => (
              <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2" data-live-hand={hand.id} key={hand.id}>
                <span className="flex min-w-0 items-center gap-2 text-sm leading-5 text-[var(--text-primary)]">
                  <span className="tabular-nums text-[var(--text-tertiary)]">{index + 1}.</span>
                  <Hand aria-hidden="true" className="size-4 shrink-0 text-[var(--warning)]" />
                  <span className="truncate">{hand.name}</span>
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-1">
                  {controls.release ? (
                    <Button aria-label={`${copy.liberar}: ${hand.name}`} className="h-8! px-2 text-[13px]" disabled={!joined} onClick={() => release(hand.id)} type="button" variant="secondary">
                      <Mic aria-hidden="true" className="size-4" />
                      {copy.liberar}
                    </Button>
                  ) : null}
                  {controls.hands ? (
                    <>
                      <Button aria-label={`${copy.abaixarMao}: ${hand.name}`} className="h-8! px-2 text-[13px] text-[var(--text-secondary)]" disabled={!joined} onClick={() => lower(hand.id)} type="button" variant="ghost">
                        {copy.abaixarMao}
                      </Button>
                      <Button aria-label={`${copy.pular}: ${hand.name}`} className="h-8! px-2 text-[13px] text-[var(--text-secondary)]" disabled={!joined || hands.length < 2} onClick={() => handle.dispatch({ id: hand.id, type: "skipHand" })} type="button" variant="ghost">
                        <SkipForward aria-hidden="true" className="size-4" />
                        {copy.pular}
                      </Button>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        ) : null}

        {room.speaking.length > 0 ? (
          <div className="flex min-w-0 flex-col gap-2" data-live-speaking="">
            <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{LIVE_CONSOLE_COPY.microfoneLiberado}</span>
            <ul className="flex min-w-0 flex-col gap-1">
              {room.speaking.map((id) => (
                <li className="flex min-w-0 items-center justify-between gap-2" data-live-speaker={id} key={id}>
                  <span className="truncate text-sm leading-5 text-[var(--text-primary)]">{names.get(id) ?? LIVE_CONSOLE_COPY.equipe}</span>
                  {controls.release ? (
                    <Button aria-label={`${copy.silenciar}: ${names.get(id) ?? ""}`} className="h-8! px-2 text-[13px]" disabled={!joined} onClick={() => silence(id)} type="button" variant="secondary">
                      <MicOff aria-hidden="true" className="size-4" />
                      {copy.silenciar}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
