"use client";

import { Mic, MicOff, Video, VideoOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { consoleRowFocusAfter } from "@/server/webinars/console-v2-model";
import { LIVE_CONSOLE_COPY, handRows, roomRows, type LiveConsolePerson } from "@/server/webinars/live-console-model";
import { CONSOLE_PANE_CARD } from "./console-layout-model";
import { LiveParticipants, type PersonAction } from "./live-participants";
import type { LiveRoomHandle } from "./live-room-panel";

// A aba Pessoas do console de quem apresenta (docs/31 V2-14 e V2-15, "como no Zoom"), de cima para baixo: as acoes de
// todos (Silenciar todos, o muteEveryone de audio; Fechar todas as câmeras, o de video; e o "Câmeras livres", a
// moderacao de video desligada, com o estado em aria-pressed pelo que o motor diz: o moderationStatusChanged de video e
// o isModerationOn na entrada, nunca o clique), o microfone sozinho (docs/31 caminho A: o botao com aria-pressed pelo
// que foi gravado, so para quem apresenta, com a frase de baixo; sem teto de alunos falando desde 11/11/2026, D84), a Sala
// de espera com Admitir por pessoa e Admitir todos (answerKnockingParticipant), quem esta na sala (LiveParticipants:
// "Na sala · 3", o microfone, a camera, o Compartilhando e o ⋯ de cada um, e os removidos, silenciados e banidos com
// Desfazer) e o rodape "3 na sala · 2 com a mão levantada". Cada botao so aparece para o papel que pode
// (liveControlsFor) e so liga com o console dentro da sala. O Silenciar todos tambem silencia o co-apresentador e a
// Equipe no palco: o motor so deixa de fora o proprio console (docs/31 V2-A40). O "Câmeras livres" ligado fica no
// estilo de ativo da sala (o fundo do botao ativo, com 3:1 ou mais nos dois temas), alem do aria-pressed. O Admitir leva
// o foco ao Admitir da pessoa seguinte (consoleRowFocusAfter) e, sem ninguem, ao titulo Sala de espera, como o Admitir
// todos: o botao sai da tela e o foco nao cai no comeco da pagina.

const copy = WEBINAR_COPY.consoleAoVivo;
const pessoas = WEBINAR_COPY.consoleV2.pessoas;
/** O titulo da Sala de espera (recebe o foco quando o ultimo Admitir sai). */
const LOBBY_TITLE_ID = "console-live-lobby-title";
/** A frase do microfone sozinho (todos podem falar; a equipe silencia), ligada ao botao. */
const MIC_SELF_HINT_ID = "console-live-mic-self-hint";
/** O "Câmeras livres" ligado: o estilo do botao ativo da sala, com contraste nos dois temas (WCAG 1.4.11). */
const PRESSED = "border-room-active-bg bg-room-active-bg text-room-active-fg hover:bg-room-active-bg/85";

type ConsolePeopleTabProps = {
  busyKey: string | null;
  canPublish: boolean;
  handle: LiveRoomHandle;
  onAction: (person: LiveConsolePerson | null, participantId: string | null, action: PersonAction) => void;
  /** O microfone sozinho (setSelfUnmute: grava, depois o console manda a sala). */
  onSelfUnmute: (allowed: boolean) => void;
  people: readonly LiveConsolePerson[];
};

export function ConsolePeopleTab({ busyKey, canPublish, handle, onAction, onSelfUnmute, people }: ConsolePeopleTabProps) {
  const { controls, joined, room } = handle;
  const knocking = room.knocking;
  const inRoom = roomRows(room, people).length;
  const hands = handRows(room, people).length;

  /** O foco antes de a linha sair: o Admitir da pessoa que fica no lugar ou, sem ninguem, o titulo da Sala de espera. */
  function focusAfterAdmit(id: string | null) {
    const next = id ? consoleRowFocusAfter({ id, ids: knocking.map((person) => person.id), move: "remove" }) : null;
    const button = next ? document.querySelector<HTMLButtonElement>(`[data-live-knocking="${CSS.escape(next)}"] button:not(:disabled)`) : null;
    (button ?? document.getElementById(LOBBY_TITLE_ID))?.focus();
  }

  function admit(id: string) {
    if (handle.command("answerKnockingParticipant", id, true)) {
      focusAfterAdmit(id);
      handle.dispatch({ id, type: "admit" });
    }
  }

  function admitAll() {
    for (const person of knocking) {
      handle.command("answerKnockingParticipant", person.id, true);
    }
    focusAfterAdmit(null);
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
                className={cn("px-3", handle.camerasAllowed && PRESSED)}
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
        <div className="flex min-w-0 flex-col items-start gap-1" data-live-mic-self="">
          <Button
            aria-describedby={MIC_SELF_HINT_ID}
            aria-pressed={handle.selfUnmute}
            className={cn("px-3", handle.selfUnmute && PRESSED)}
            disabled={!joined}
            onClick={() => onSelfUnmute(!handle.selfUnmute)}
            type="button"
            variant="secondary"
          >
            <Mic aria-hidden="true" className="size-4" />
            {LIVE_CONSOLE_COPY.microfoneSozinho}
          </Button>
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]" id={MIC_SELF_HINT_ID}>
            {LIVE_CONSOLE_COPY.microfoneSozinhoTexto}
          </p>
        </div>
      ) : null}

      {controls.admit ? (
        <section aria-labelledby={LOBBY_TITLE_ID} className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2" data-live-lobby="">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" id={LOBBY_TITLE_ID} tabIndex={-1}>
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
