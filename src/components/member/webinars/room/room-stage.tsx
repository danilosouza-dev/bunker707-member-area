"use client";

import { Volume2 } from "lucide-react";
import type { ReactNode } from "react";
import { MemberButton, MemberButtonLink } from "@/components/member/ui/member-button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { roomMediaLessonId } from "@/lib/webinar-room-client";

// O palco da Sala (docs/30 §1.6, §6.6 e §9): o iframe da Bunny (sem barra na sessao gravada; com barra no replay),
// o botao "Ativar som" por cima ate o primeiro toque (o navegador bloqueia som automatico), a espera antes do
// zero com a capa e a contagem, a tela "Essa live acabou." com Assistir de novo quando ha replay e, sem player, "Esta
// live não está disponível para você." para quem saiu do "Quem pode" no meio da sessao (D41). O palco leva
// os mesmos atributos do palco da aula (data-lesson-player-stage etc.): o sinal de midia (lesson-media-signal)
// enxerga o player e o pop-up nunca abre com ele tocando. O iframe nunca desmonta ao girar o aparelho (o som continua).

export type RoomStageState = "ended" | "live" | "replay" | "unavailable" | "waiting";

export type RoomStageProps = {
  countdownLabel: string;
  coverUrl: string | null;
  embedUrl: string | null;
  /** Ref de funcao com estado: a ponte liga quando o iframe monta (como na aula). */
  iframeRef: (element: HTMLIFrameElement | null) => void;
  muted: boolean;
  onUnmute: () => void;
  replayHref: string | null;
  sessionId: string;
  state: RoomStageState;
  title: string;
};

function Cover({ children, coverUrl }: { children?: ReactNode; coverUrl: string | null }) {
  return (
    <div className="absolute inset-0 grid place-items-center overflow-hidden bg-[#141414]">
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- capa decorativa, sem otimizacao (o palco e escuro e a capa fica atras do texto).
        <img alt="" aria-hidden="true" className="absolute inset-0 size-full object-cover opacity-30 blur-[2px]" src={coverUrl} />
      ) : null}
      <div className="relative z-10 flex max-w-md flex-col items-center gap-3 px-6 text-center">{children}</div>
    </div>
  );
}

export function RoomStage({ countdownLabel, coverUrl, embedUrl, iframeRef, muted, onUnmute, replayHref, sessionId, state, title }: RoomStageProps) {
  const copy = WEBINAR_COPY.sala;
  const showPlayer = embedUrl !== null && (state === "live" || state === "replay");

  return (
    <div
      className="relative bg-black aspect-video w-full lg:aspect-auto lg:h-full"
      data-lesson-id={roomMediaLessonId(sessionId)}
      data-lesson-player-bridge={showPlayer ? "" : undefined}
      data-lesson-player-kind={showPlayer ? "iframe" : undefined}
      data-lesson-player-stage
      data-room-stage={state}
    >
      {showPlayer ? (
        <iframe
          allow={state === "replay" ? "autoplay; encrypted-media; fullscreen; picture-in-picture" : "autoplay; encrypted-media"}
          allowFullScreen={state === "replay"}
          className="absolute inset-0 size-full border-0"
          loading="eager"
          ref={iframeRef}
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-same-origin allow-scripts allow-forms allow-presentation"
          src={embedUrl}
          title={title}
        />
      ) : null}

      {showPlayer && state === "live" ? (
        // A capa transparente cobre o player travado: nada de barra, pausa ou salto pelo toque (docs/30 §6.6).
        <div aria-hidden="true" className="absolute inset-0" data-room-lock />
      ) : null}

      {showPlayer && muted ? (
        <div className="absolute inset-0 grid place-items-center bg-black/35">
          <MemberButton className="pointer-events-auto shadow-[0_12px_40px_rgba(0,0,0,0.6)]" onClick={onUnmute} size="lg" variant="primary">
            <Volume2 />
            {copy.ativarSom}
          </MemberButton>
        </div>
      ) : null}

      {!showPlayer && state === "waiting" ? (
        <Cover coverUrl={coverUrl}>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{WEBINAR_COPY.aluno.aguardando}</p>
          <p className="text-2xl font-black text-white sm:text-3xl" data-testid="room-countdown">
            {countdownLabel ? copy.comecaEm(countdownLabel) : WEBINAR_COPY.aluno.aguardandoTexto}
          </p>
        </Cover>
      ) : null}

      {!showPlayer && state === "live" ? (
        <Cover coverUrl={coverUrl}>
          <p className="text-sm font-semibold text-zinc-200">{copy.semVideo}</p>
        </Cover>
      ) : null}

      {!showPlayer && state === "replay" ? (
        <Cover coverUrl={coverUrl}>
          <p className="text-sm font-semibold text-zinc-200">{copy.semVideo}</p>
        </Cover>
      ) : null}

      {state === "unavailable" ? (
        <Cover coverUrl={null}>
          <p className="text-lg font-black text-white sm:text-2xl" data-testid="room-unavailable" role="alert">
            {WEBINAR_COPY.aluno.naoDisponivel}
          </p>
        </Cover>
      ) : null}

      {state === "ended" ? (
        <Cover coverUrl={coverUrl}>
          <p className="text-2xl font-black text-white sm:text-3xl">{replayHref ? copy.encerrada : copy.encerradaReplay}</p>
          {replayHref ? (
            <MemberButtonLink href={replayHref} size="lg" variant="primary">
              {copy.assistirDeNovo}
            </MemberButtonLink>
          ) : null}
        </Cover>
      ) : null}
    </div>
  );
}
