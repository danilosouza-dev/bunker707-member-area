"use client";

import { Radio, Users } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { RoomButton } from "./room-ui";
import { trapRoomFocus } from "./webinar-room";

// Os avisos e pedacos pequenos da sala ao vivo (docs/30 §1.3, §1.4, §1.7, §8.5 e §9; fase 3): os dois avisos de
// gravacao de §8.5, palavra por palavra (a camera, no primeiro clique, com o consumo e Ligar câmera / Agora não; o
// microfone, quando o apresentador libera, com Falar / Agora não), cada um um dialogo de verdade (role="dialog",
// aria-modal, o foco preso nos dois botoes: no Ligar câmera, que o proprio clique abriu; no Agora não do microfone,
// que abre sozinho; o foco volta a quem o tinha ao fechar; Esc = Agora não, sem fechar a sala); a aba
// Participantes (quem esta no palco e o numero de alunos, nunca a lista de alunos; tambem na gravada, com o numero do
// cabecalho). Redesign V2, F2 (docs/31 V2-11): o cartao dos avisos e a aba Participantes usam os tokens do tema da
// sala. F3 (V2-4): o selo Gravando saiu do cabecalho para o palco (room-stage-badges.tsx). F5 (V2-8): o chat por cima
// do palco virou as pilulas das duas salas (room-chat-pills.tsx).

type ConsentDialogProps = {
  cancelLabel: string;
  confirmLabel: string;
  heading?: string;
  /**
   * Onde o foco entra ao abrir: `confirm` no aviso que o proprio clique abriu (a camera); `cancel` no que abre sozinho
   * (o microfone liberado pelo apresentador: quem estava digitando no chat nao liga o microfone com o Enter ou o Espaco
   * seguinte sem ler o aviso de gravacao).
   */
  initialFocus: "cancel" | "confirm";
  onCancel: () => void;
  onConfirm: () => void;
  testId: string;
  texts: readonly string[];
};

/** O elemento que tinha o foco antes do aviso volta a ter ao fechar, se ainda estiver na pagina e puder receber foco. */
export function focusBackTarget(previous: Element | null, doc: Pick<Document, "body" | "contains"> | null): HTMLElement | null {
  if (!previous || !doc || previous === doc.body || !doc.contains(previous)) {
    return null;
  }
  const element = previous as HTMLElement;
  if (typeof element.focus !== "function" || (element as HTMLButtonElement).disabled === true) {
    return null;
  }
  return element;
}

function ConsentDialog({ cancelLabel, confirmLabel, heading, initialFocus, onCancel, onConfirm, testId, texts }: ConsentDialogProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // Guarda quem tinha o foco (o campo do chat, o botao Câmera) e devolve ao fechar: o foco nunca cai no body, fora do
    // dialogo da sala.
    const previous = document.activeElement;
    (initialFocus === "cancel" ? cancelRef : confirmRef).current?.focus();
    return () => {
      focusBackTarget(previous, document)?.focus();
    };
  }, [initialFocus]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      // So o aviso fecha (Agora não): a sala continua aberta.
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key === "Tab") {
      event.stopPropagation();
      trapRoomFocus(event, rootRef.current);
    }
  }

  return (
    <div className="absolute inset-0 z-[70] grid place-items-center bg-black/70 p-4">
      <div
        aria-describedby={`${id}-text`}
        aria-labelledby={heading ? `${id}-heading` : `${id}-text`}
        aria-modal="true"
        className="w-full max-w-md rounded-[16px] border border-room-border-strong bg-room-surface p-5 shadow-[0_18px_48px_rgba(0,0,0,0.6)]"
        data-testid={testId}
        onKeyDown={handleKeyDown}
        ref={rootRef}
        role="dialog"
      >
        {heading ? (
          <p className="text-base font-bold text-room-fg-strong" id={`${id}-heading`}>
            {heading}
          </p>
        ) : null}
        <div className={heading ? "mt-2 space-y-2" : "space-y-2"} id={`${id}-text`}>
          {texts.map((text) => (
            <p className="text-sm leading-6 text-room-fg" key={text}>
              {text}
            </p>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <RoomButton className="min-h-11" onClick={onConfirm} ref={confirmRef} size="lg" variant="primary">
            {confirmLabel}
          </RoomButton>
          <RoomButton className="min-h-11" onClick={onCancel} ref={cancelRef} size="lg" variant="secondary">
            {cancelLabel}
          </RoomButton>
        </div>
      </div>
    </div>
  );
}

/** O primeiro clique em Câmera (docs/30 §8.5 e D4): o aviso de gravacao e o consumo; so Ligar câmera liga. */
export function LiveCameraDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const copy = WEBINAR_COPY.aoVivo;
  return (
    <ConsentDialog
      cancelLabel={copy.agoraNao}
      confirmLabel={copy.ligarCamera}
      initialFocus="confirm"
      onCancel={onCancel}
      onConfirm={onConfirm}
      testId="live-camera-dialog"
      texts={[copy.avisoCamera, copy.avisoCameraConsumo]}
    />
  );
}

/** O apresentador liberou o microfone (docs/30 §1.3 e §8.5): o aviso de gravacao; so Falar liga. */
export function LiveMicDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const copy = WEBINAR_COPY.aoVivo;
  return (
    <ConsentDialog
      cancelLabel={copy.agoraNao}
      confirmLabel={copy.falar}
      heading={copy.microfoneLiberado}
      initialFocus="cancel"
      onCancel={onCancel}
      onConfirm={onConfirm}
      testId="live-mic-dialog"
      texts={[copy.avisoMicrofone]}
    />
  );
}

/**
 * A aba Participantes (docs/30 §1.3): quem esta no palco e quantos alunos estao na sala, nunca a lista dos alunos. Sem
 * numero (`students` nulo: a sessao encerrada, quando o cabecalho tambem tira o "{n} assistindo"), so o palco.
 */
export function LiveParticipantsTab({ stage, students }: { stage: readonly string[]; students: number | null }) {
  const copy = WEBINAR_COPY.aoVivo;
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3" data-testid="live-participants">
      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-room-fg-subtle">{copy.noPalco}</h2>
        {stage.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {stage.map((name) => (
              <li className="flex items-center gap-2 text-sm font-semibold text-room-fg-strong" key={name}>
                <Radio aria-hidden="true" className="size-3.5 text-[var(--accent)]" />
                {name}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      {students === null ? null : (
        <p className="flex items-center gap-2 text-sm text-room-fg">
          <Users aria-hidden="true" className="size-4" />
          {copy.alunosNaSala(Math.max(0, students))}
        </p>
      )}
    </div>
  );
}
