"use client";

import { Hand, Mic, MicOff, SkipForward } from "lucide-react";
import type { MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { consoleRowFocusAfter } from "@/server/webinars/console-v2-model";
import { LIVE_CONSOLE_COPY, handRows, lowerHandMessage, roomRows, type LiveConsolePerson } from "@/server/webinars/live-console-model";
import { CONSOLE_PANE_CARD, CONSOLE_TAB_ID_PREFIX } from "./console-layout-model";
import type { LiveRoomHandle } from "./live-room-panel";

// A aba Mãos do console (docs/30 §1.4 e §2.4; docs/31 V2-15): a fila na ordem em que as maos subiram (raiseHandUpdated
// do iframe do console), Liberar (askToUnmute: o aluno aceita com um clique; com a moderacao de audio, isso tambem o
// aprova), Abaixar a mao (o IFrame API nao abaixa a mao de outro: o console manda ao aluno o sinal LOWER_HAND_SIGNAL
// pelo sendEndpointTextMessage e tira da fila), Pular (vai para o fim), Abaixar todas as maos (o mesmo sinal uma vez so,
// para todos, com o destino vazio: cada aluno so abaixa a propria mao levantada, lowerHandRequested), e quem esta com o
// microfone liberado com Silenciar (muteRemoteParticipant + rejectParticipant de audio). Liberar e Silenciar sao do
// Apresentador e do co-apresentador; abaixar e pular, de toda a Equipe. O numero da aba e o do circulo Mãos da barra.
// O foco nunca cai no comeco da pagina quando a linha do botao sai ou vai para o fim (WCAG 2.4.3; consoleRowFocusAfter):
// antes da troca ele vai ao botao da mesma posicao na linha que fica no lugar (ou na ultima); com a lista vazia, a aba
// Mãos do painel.

const copy = WEBINAR_COPY.consoleAoVivo;

type LiveHandsProps = {
  handle: LiveRoomHandle;
  people: readonly LiveConsolePerson[];
};

export function LiveHands({ handle, people }: LiveHandsProps) {
  const { controls, joined, room } = handle;
  const hands = handRows(room, people);
  const names = new Map(roomRows(room, people).map((row) => [row.id, row.name]));

  /**
   * Antes de a linha sair (ou ir para o fim): o foco vai ao botao da mesma posicao na linha que fica no lugar
   * (consoleRowFocusAfter), entre as linhas `rows` da lista; sem linha, a aba Mãos do painel. So o clique que tinha o
   * foco (o teclado, ou o mouse no botao) muda o foco.
   */
  function focusAfter(event: MouseEvent<HTMLButtonElement>, input: { id: string | null; ids: readonly string[]; move: "end" | "remove"; rows: string }) {
    const button = event.currentTarget;
    if (button.ownerDocument.activeElement !== button) {
      return;
    }
    const row = button.closest(`[${input.rows}]`);
    const position = row ? Array.from(row.querySelectorAll("button")).indexOf(button) : 0;
    const next = input.id ? consoleRowFocusAfter({ id: input.id, ids: input.ids, move: input.move }) : null;
    const nextRow = next ? button.ownerDocument.querySelector(`[${input.rows}="${CSS.escape(next)}"]`) : null;
    const buttons = nextRow ? Array.from(nextRow.querySelectorAll<HTMLButtonElement>("button")).filter((item) => !item.disabled) : [];
    const target = buttons[Math.min(Math.max(0, position), buttons.length - 1)] ?? button.ownerDocument.getElementById(`${CONSOLE_TAB_ID_PREFIX}-tabbtn-maos`);
    target?.focus();
  }

  const handIds = hands.map((hand) => hand.id);

  function release(event: MouseEvent<HTMLButtonElement>, id: string) {
    if (handle.command("askToUnmute", id)) {
      focusAfter(event, { id, ids: handIds, move: "remove", rows: "data-live-hand" });
      handle.dispatch({ id, type: "release" });
    }
  }

  function silence(event: MouseEvent<HTMLButtonElement>, id: string) {
    handle.command("muteRemoteParticipant", id, "audio");
    handle.command("rejectParticipant", id, "audio");
    focusAfter(event, { id, ids: room.speaking, move: "remove", rows: "data-live-speaker" });
    handle.dispatch({ id, type: "silence" });
  }

  function lower(event: MouseEvent<HTMLButtonElement>, id: string) {
    handle.command("sendEndpointTextMessage", id, lowerHandMessage());
    focusAfter(event, { id, ids: handIds, move: "remove", rows: "data-live-hand" });
    handle.dispatch({ id, type: "lowerHand" });
  }

  function skip(event: MouseEvent<HTMLButtonElement>, id: string) {
    focusAfter(event, { id, ids: handIds, move: "end", rows: "data-live-hand" });
    handle.dispatch({ id, type: "skipHand" });
  }

  function lowerAll(event: MouseEvent<HTMLButtonElement>) {
    // Um sinal so, para todos (o destino vazio): o aluno so age com a propria mao levantada.
    handle.command("sendEndpointTextMessage", "", lowerHandMessage());
    focusAfter(event, { id: null, ids: [], move: "remove", rows: "data-live-hand" });
    handle.dispatch({ type: "lowerAll" });
  }

  return (
    <div className={CONSOLE_PANE_CARD} data-live-hands="">
      {controls.hands && hands.length > 0 ? (
        <div className="flex min-w-0 justify-end">
          <Button className="h-8! px-2 text-[13px]" disabled={!joined} onClick={(event) => lowerAll(event)} type="button" variant="secondary">
            {copy.abaixarTodas}
          </Button>
        </div>
      ) : null}
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
                  <Button aria-label={`${copy.liberar}: ${hand.name}`} className="h-8! px-2 text-[13px]" disabled={!joined} onClick={(event) => release(event, hand.id)} type="button" variant="secondary">
                    <Mic aria-hidden="true" className="size-4" />
                    {copy.liberar}
                  </Button>
                ) : null}
                {controls.hands ? (
                  <>
                    <Button aria-label={`${copy.abaixarMao}: ${hand.name}`} className="h-8! px-2 text-[13px] text-[var(--text-secondary)]" disabled={!joined} onClick={(event) => lower(event, hand.id)} type="button" variant="ghost">
                      {copy.abaixarMao}
                    </Button>
                    <Button aria-label={`${copy.pular}: ${hand.name}`} className="h-8! px-2 text-[13px] text-[var(--text-secondary)]" disabled={!joined || hands.length < 2} onClick={(event) => skip(event, hand.id)} type="button" variant="ghost">
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
                  <Button aria-label={`${copy.silenciar}: ${names.get(id) ?? ""}`} className="h-8! px-2 text-[13px]" disabled={!joined} onClick={(event) => silence(event, id)} type="button" variant="secondary">
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
  );
}
