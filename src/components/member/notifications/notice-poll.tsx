"use client";

import { Circle, CircleCheck, Square, SquareCheck } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/utils";
import type { NotificationPoll } from "@/server/communications/notification-model";
import { pollPressChoice, pollView } from "./notifications-model";

// Enquete da notificacao (docs/24 §1.6), depois do audio e antes do botao. Botoes, nao radios: um grupo
// de radios que grava a cada seta votaria enquanto o aluno navega. Uma resposta: tocar vota, outra
// troca, a escolhida tira o voto; varias: cada toque marca ou desmarca e vai o conjunto inteiro (vazio
// tira o voto). Com o resultado visivel (a equipe deixou e o aluno votou, ou encerrou), a barra e a
// porcentagem de cada opcao; nunca nomes. So desenha: o voto otimista e a fila de envios sao do painel.

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

export function NoticePoll({
  busy = false,
  error,
  onVote,
  poll,
  preview = false
}: {
  /** Um voto em andamento (os toques seguem valendo: o painel manda o ultimo estado depois). */
  busy?: boolean;
  error?: string | null;
  onVote?: (optionIds: string[]) => void;
  poll: NotificationPoll;
  /** Previa do admin: desenha a enquete como veio (antes ou depois do voto), sem acao. */
  preview?: boolean;
}) {
  const view = pollView(poll);
  const footerId = useId();
  const optionClassName = cn(
    "pointer-events-auto relative flex min-h-11 w-full items-center gap-2 overflow-hidden rounded-[10px] border border-white/[0.12] bg-white/[0.04] px-3 py-2 text-left text-sm text-zinc-100 aria-pressed:border-white/40",
    !view.closed && !preview && "transition-colors hover:bg-white/[0.08] motion-reduce:transition-none",
    focusRing
  );

  return (
    <fieldset aria-busy={busy || undefined} aria-describedby={footerId} className="mt-3 min-w-0">
      <legend className="text-sm font-semibold leading-5 text-white [overflow-wrap:anywhere]">{poll.question}</legend>
      <div className="mt-2 flex flex-col gap-2">
        {view.options.map((option) => {
          const Icon = poll.multiple ? (option.chosen ? SquareCheck : Square) : option.chosen ? CircleCheck : Circle;
          const content = (
            <>
              {option.percent !== null ? (
                <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-white/[0.10]" style={{ width: `${option.percent}%` }} />
              ) : null}
              <Icon aria-hidden="true" className="relative size-4 shrink-0" />
              <span className="relative min-w-0 flex-1 [overflow-wrap:anywhere]">{option.label}</span>
              {option.percent !== null ? (
                <span aria-hidden="true" className="relative shrink-0 text-xs tabular-nums text-zinc-300">
                  {option.percent}%
                </span>
              ) : null}
            </>
          );

          if (preview) {
            return (
              <span className={cn(optionClassName, option.chosen && "border-white/40")} key={option.id}>
                {content}
              </span>
            );
          }

          return (
            <button
              aria-disabled={view.closed || undefined}
              aria-label={option.name}
              aria-pressed={option.chosen}
              className={optionClassName}
              key={option.id}
              onClick={() => {
                if (!view.closed) {
                  onVote?.(pollPressChoice(poll, option.id));
                }
              }}
              type="button"
            >
              {content}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs leading-4 text-zinc-400" id={footerId}>
        {view.footer}
      </p>
      {error ? (
        <p className="mt-1 text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
