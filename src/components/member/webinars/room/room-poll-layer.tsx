"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { StudentPoll } from "./room-api";
import { pollOptionPercent, type StagePoll } from "./room-poll-model";
import { usePollChoice, type PollAnswerHandler } from "./room-polls";
import { RoomButton } from "./room-ui";

// A enquete no meio do palco (docs/31 V2-10): quando a equipe lanca, ela abre centrada sobre o palco, escurecendo so o
// palco (o veu a 45 %, igual nos dois temas), mesmo com o painel do chat fechado; abaixo de lg o palco do celular nao
// comporta o dialogo, e ela vira uma folha presa embaixo da tela. O rotulo pelo tipo, a pergunta (h2), opcoes de 48
// px, "Responder depois" (recolhe para o card do chat; o Esc dentro dela faz o mesmo) e "Enviar resposta"; o resultado
// compartilhado no mesmo lugar, com as barras e "Fechar". E um role=dialog sem aria-modal (o resto da sala continua
// valendo): aberta sozinha, nao pega o foco e o leitor de tela ouve "Enquete aberta" pela regiao viva, que fica sempre
// montada (e diz "Resposta enviada" quando a enquete sai do palco pelo envio). O foco so entra quando o aluno pede
// (Responder agora, o atalho E). O card do chat ("Enquete aberta · você deixou para depois · Responder agora") tambem
// mora aqui. Qual enquete abre e o que fica guardado: room-poll-model.ts.

const LABEL = "text-[11px] font-bold uppercase tracking-[0.06em] text-room-fg-subtle";

function RoomPollDialog({
  focusRequest,
  mode,
  onAnswer,
  onLater,
  onSeen,
  poll,
  readOnly
}: {
  focusRequest: number;
  mode: StagePoll["mode"];
  onAnswer: PollAnswerHandler;
  onLater: () => void;
  onSeen: () => void;
  poll: StudentPoll;
  readOnly: boolean;
}) {
  const copy = WEBINAR_COPY.salaV2.enquete;
  const id = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const { canSubmit, chosen, status, submit, toggle } = usePollChoice({ onAnswer, poll, readOnly });
  const result = mode === "result";
  const total = poll.results?.total ?? 0;

  // O aluno pediu a enquete (Responder agora, o atalho E): o foco vai para a primeira opcao (no "ver como", desligada,
  // para o primeiro botao). Aberta sozinha (focusRequest 0), o foco fica onde estava.
  useEffect(() => {
    if (focusRequest > 0) {
      dialogRef.current?.querySelector<HTMLElement>("input:not([disabled]), button:not([disabled])")?.focus();
    }
  }, [focusRequest]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      // O Esc aqui dentro vale como Responder depois (ou o Fechar do resultado), nunca como o Sair da sala.
      event.stopPropagation();
      if (result) {
        onSeen();
      } else {
        onLater();
      }
    }
  }

  return (
    <div
      aria-labelledby={`${id}-q`}
      className="flex w-full flex-col gap-4 bg-room-surface p-6 text-room-fg shadow-[0_24px_64px_rgba(0,0,0,0.35)] max-lg:max-h-[75dvh] max-lg:overflow-y-auto max-lg:rounded-t-[var(--member-cover-radius)] max-lg:border-t max-lg:border-room-border max-lg:pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:max-h-[calc(100%-2rem)] lg:w-[440px] lg:max-w-[calc(100%-2rem)] lg:overflow-y-auto lg:rounded-[var(--member-cover-radius)]"
      data-room-stage-poll={mode}
      onKeyDown={onKeyDown}
      ref={dialogRef}
      role="dialog"
    >
      <p className={LABEL}>{result ? copy.resultado : poll.kind === "single" ? copy.respostaUnica : copy.respostaMultipla}</p>
      <h2 className="text-lg font-extrabold leading-6 text-room-fg-strong" id={`${id}-q`}>
        {poll.question}
      </h2>

      {result ? (
        <ul className="flex flex-col gap-2">
          {poll.options.map((option) => {
            const percent = pollOptionPercent(poll, option.id);
            return (
              <li className="relative flex min-h-12 items-center gap-3 overflow-hidden rounded-[12px] border border-room-input-border px-3.5 py-2 text-sm" key={option.id}>
                <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-room-poll-bar" style={{ width: `${percent}%` }} />
                <span className="relative min-w-0 flex-1 font-medium text-room-fg">{option.label}</span>
                <span className="relative tabular-nums text-sm font-bold text-room-fg">{percent}%</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{poll.question}</legend>
          {poll.options.map((option) => {
            const selected = chosen.includes(option.id);
            return (
              <label
                className={cn(
                  "flex min-h-12 cursor-pointer items-center gap-3 rounded-[12px] px-3.5 py-2 text-sm text-room-fg",
                  selected ? "border-2 border-room-active-bg bg-room-control font-semibold" : "border border-room-input-border font-medium hover:bg-room-control"
                )}
                key={option.id}
              >
                <input
                  checked={selected}
                  className="size-[18px] shrink-0 accent-room-active-bg"
                  disabled={readOnly}
                  name={`${id}-opt`}
                  onChange={() => toggle(option.id)}
                  type={poll.kind === "single" ? "radio" : "checkbox"}
                  value={option.id}
                />
                <span className="min-w-0 flex-1">{option.label}</span>
              </label>
            );
          })}
        </fieldset>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {result ? (
          <>
            <p className="mr-auto text-xs text-room-fg-subtle">{copy.respostas(total)}</p>
            <RoomButton className="h-11 px-5" onClick={onSeen} size="sm" variant="primary">
              {copy.fechar}
            </RoomButton>
          </>
        ) : (
          <>
            <RoomButton className="h-11 px-4" onClick={onLater} size="sm" variant="ghost">
              {copy.responderDepois}
            </RoomButton>
            <RoomButton className="h-11 px-5" disabled={!canSubmit} onClick={() => void submit()} size="sm" variant="primary">
              {copy.enviarResposta}
            </RoomButton>
          </>
        )}
      </div>
      {result ? null : (
        // So a falha do envio: o "Resposta enviada" e dito pela regiao viva da camada, porque a enquete sai do palco.
        <p aria-live="polite" className="-mt-2 min-h-4 text-xs text-room-fg-subtle">
          {status === WEBINAR_COPY.sala.enquete.respondida ? "" : (status ?? "")}
        </p>
      )}
    </div>
  );
}

/**
 * A camada da enquete, filha do palco (o LiveStage da live; a caixa do palco da gravada no desenho normal). `stage`
 * nulo: so a regiao viva fica (sem veu). `focusRequest` maior que zero pede o foco na primeira opcao (o aluno pediu).
 */
export function RoomPollLayer({
  focusRequest = 0,
  onAnswer,
  onLater,
  onSeen,
  readOnly,
  stage
}: {
  focusRequest?: number;
  onAnswer: PollAnswerHandler;
  onLater: (pollId: string) => void;
  onSeen: (pollId: string) => void;
  readOnly: boolean;
  stage: StagePoll | null;
}) {
  const copy = WEBINAR_COPY.salaV2.enquete;
  const stageKey = stage ? `${stage.mode}:${stage.poll.id}` : null;
  // O que a regiao viva diz depois que a enquete sai do palco: "Resposta enviada" so quando saiu pelo envio.
  const [notice, setNotice] = useState("");
  const [shownKey, setShownKey] = useState(stageKey);
  if (shownKey !== stageKey) {
    setShownKey(stageKey);
    if (stageKey !== null) {
      setNotice("");
    }
  }
  const said = stage ? (stage.mode === "answer" ? copy.aberta : copy.resultado) : notice;

  async function answer(poll: StudentPoll, optionIds: string[]) {
    await onAnswer(poll, optionIds);
    setNotice(WEBINAR_COPY.sala.enquete.respondida);
  }

  return (
    <>
      <p aria-live="polite" className="sr-only" data-room-poll-said="">
        {said}
      </p>
      {stage ? (
        <div className="z-30 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 lg:absolute lg:inset-0 lg:grid lg:place-items-center lg:bg-black/45" data-room-poll-layer={stage.mode}>
          <RoomPollDialog
            focusRequest={focusRequest}
            key={stageKey}
            mode={stage.mode}
            onAnswer={answer}
            onLater={() => {
              setNotice("");
              onLater(stage.poll.id);
            }}
            onSeen={() => {
              setNotice("");
              onSeen(stage.poll.id);
            }}
            poll={stage.poll}
            readOnly={readOnly}
          />
        </div>
      ) : null}
    </>
  );
}

/**
 * O card do topo do chat com a enquete deixada para depois (V2-10): o rotulo, a pergunta e "Responder agora", que a
 * traz de volta ao palco (data-room-poll-resume: e para la que o foco volta quando a enquete sai do palco).
 */
export function RoomPollLaterCard({ onResume, poll }: { onResume: () => void; poll: StudentPoll }) {
  const copy = WEBINAR_COPY.salaV2.enquete;
  const id = useId();

  return (
    <section aria-labelledby={`${id}-t`} className="mx-3 mt-2 flex flex-col gap-2.5 rounded-[var(--member-cover-radius)] border border-room-border bg-room-surface-2 p-4" data-room-poll-later={poll.id}>
      <p className={LABEL} id={`${id}-t`}>
        {copy.deixouParaDepois}
      </p>
      <p className="text-[15px] font-bold leading-5 text-room-fg-strong">{poll.question}</p>
      <RoomButton className="self-start" data-room-poll-resume="" onClick={onResume} size="sm" variant="primary">
        {copy.responderAgora}
      </RoomButton>
    </section>
  );
}
