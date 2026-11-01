"use client";

import { LoaderCircle, Radio, RefreshCw } from "lucide-react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { MemberButton, MemberButtonLink } from "@/components/member/ui/member-button";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { roomMediaLessonId } from "@/lib/webinar-room-client";
import { joinFailurePhrase, liveScreenPhrase, screenBlocksRoom, type LiveScreen } from "./live-room-model";
import type { LiveEntry } from "./use-live-room";

// O palco da Live ao vivo (docs/30 §1.3, §1.7, §6.3 e §9; fase 3): o lugar 16:9 do iframe (o useJitsiMeet monta o
// iframe dentro de [data-live-frame], que nunca sai do lugar; sem Minimizar, docs/31 V2-2) e,
// por cima, a frase de cada momento: Entrar na sala (o primeiro toque, que tambem libera o som no iPhone), "Abrindo a
// sala…", "Reconectando…" (o iframe por baixo), "Aguardando a equipe deixar você entrar…" (a sala de espera ligada), "Não conseguimos voltar." e "Não foi possível abrir a sala." com Tentar
// de novo, Aguardando o apresentador (com a contagem), a sala trancada, "em breve" (o ambiente sem a sala ao vivo),
// encerrada (com Assistir o replay quando ha) e, na sala inteira, removido, banido ou "Esta live não está disponível
// para você." (quem saiu do "Quem pode" no meio da live, D41). O palco leva os atributos do
// palco da aula (data-lesson-player-stage etc.): com o sinal de midia da sala (announceLiveRoomMedia) nenhum pop-up
// abre com a sala no ar. Nenhum texto daqui cita o motor de video (D2). Redesign V2, F4 (docs/31 V2-6 e V2-18): o
// palco fica na caixa do esqueleto da sala (roomSkeleton), com cantos de 16 px no computador; no celular a sala poe a
// Tela cheia (ou o Modo cinema) como filho, no canto de baixo a direita.

export type LiveStageProps = {
  children?: ReactNode;
  className?: string;
  /** "Começa em 4 min" (a sala ainda nao abriu e a hora marcada esta a frente); vazio, o texto da espera. */
  countdownLabel: string;
  coverUrl: string | null;
  entry: LiveEntry;
  /** Onde o iframe entra (o container do useJitsiMeet). */
  frameRef: RefObject<HTMLDivElement | null>;
  /** A sala de espera da sala esta ligada: entrando ou voltando, o palco diz que a equipe vai deixar entrar. */
  lobby?: boolean;
  onEnter: () => void;
  onRetry: () => void;
  /** "Ver como" da equipe: Entrar na sala fica desligado (nada e gravado). */
  readOnly: boolean;
  replayHref: string | null;
  screen: LiveScreen;
  sessionId: string;
  /** O palco inteiro (Tela cheia poe este elemento em tela cheia, com as reacoes por cima). */
  stageRef: RefObject<HTMLDivElement | null>;
  title: string;
  /**
   * Redesign V2, F3 (docs/31 V2-4): quanto a coluna de miniaturas do iframe ocupa a direita do video (px), na variavel
   * --room-video-right: os selos de baixo e as pilulas do chat param antes dela (room-layout-model.ts).
   */
  videoRightPx?: number;
};

function Cover({ children, coverUrl, tone = "default" }: { children?: ReactNode; coverUrl: string | null; tone?: "default" | "dim" }) {
  return (
    <div className={cn("absolute inset-0 z-10 grid place-items-center overflow-hidden", tone === "dim" ? "bg-black/70" : "bg-[#141414]")}>
      {coverUrl && tone === "default" ? (
        // eslint-disable-next-line @next/next/no-img-element -- capa decorativa, sem otimizacao (o palco e escuro e a capa fica atras do texto).
        <img alt="" aria-hidden="true" className="absolute inset-0 size-full object-cover opacity-30 blur-[2px]" src={coverUrl} />
      ) : null}
      <div className="relative z-10 flex max-w-md flex-col items-center gap-3 px-6 text-center">{children}</div>
    </div>
  );
}

/** O estado que o palco marca em data-room-stage (o e2e e o CSS leem). */
export function liveStageState(screen: LiveScreen, entry: LiveEntry): string {
  if (screen !== "open") {
    return screen;
  }
  return entry === "joined" ? "live" : entry;
}

export function LiveStage(props: LiveStageProps) {
  const { children, className, countdownLabel, coverUrl, entry, frameRef, lobby = false, onEnter, onRetry, readOnly, replayHref, screen, sessionId, stageRef, title, videoRightPx = 0 } = props;
  const copy = WEBINAR_COPY.aoVivo;
  const phrase = liveScreenPhrase(screen, { hasReplay: replayHref !== null });
  const open = screen === "open";
  // Na sala de espera da sala (sala trancada, Sala de espera): o iframe bate sozinho e a equipe admite.
  const knocking = open && lobby && (entry === "joining" || entry === "reconnecting");

  return (
    <div
      aria-label={copy.palco}
      className={cn("relative bg-black", className)}
      data-lesson-id={roomMediaLessonId(sessionId)}
      data-lesson-player-kind="iframe"
      data-lesson-player-stage
      data-live-entry={entry}
      data-room-stage={liveStageState(screen, entry)}
      ref={stageRef}
      role="region"
      style={{ "--room-video-right": `${videoRightPx}px` } as CSSProperties}
    >
      {/* O iframe da sala entra aqui (nunca troca de lugar: abrir o painel ou girar so mudam classes). */}
      <div className="absolute inset-0 [&_iframe]:size-full [&_iframe]:border-0" data-live-frame ref={frameRef} />

      {open && entry === "idle" ? (
        <Cover coverUrl={coverUrl}>
          <Radio aria-hidden="true" className="size-6 text-[var(--accent)]" />
          <p className="text-lg font-black text-white sm:text-2xl">{title}</p>
          <MemberButton data-live-enter disabled={readOnly} onClick={onEnter} size="lg" variant="primary">
            {copy.entrarNaSala}
          </MemberButton>
          {readOnly ? <p className="text-xs text-zinc-400">{WEBINAR_COPY.aluno.previaSemGravar}</p> : null}
        </Cover>
      ) : null}

      {knocking ? (
        <Cover coverUrl={null} tone="dim">
          <p aria-live="polite" className="flex items-center gap-2 text-sm font-semibold text-zinc-100" data-live-knocking="" role="status">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
            {copy.aguardandoAdmissao}
          </p>
        </Cover>
      ) : null}

      {open && !knocking && (entry === "opening" || entry === "joining") ? (
        <Cover coverUrl={coverUrl} tone={entry === "joining" ? "dim" : "default"}>
          <p aria-live="polite" className="flex items-center gap-2 text-sm font-semibold text-zinc-100" role="status">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
            {copy.abrindo}
          </p>
        </Cover>
      ) : null}

      {open && !knocking && entry === "reconnecting" ? (
        <Cover coverUrl={null} tone="dim">
          <p aria-live="polite" className="flex items-center gap-2 text-sm font-semibold text-zinc-100" role="status">
            <RefreshCw aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
            {WEBINAR_COPY.sala.reconectando}
          </p>
        </Cover>
      ) : null}

      {open && (entry === "lost" || entry === "open_failed") ? (
        <Cover coverUrl={coverUrl}>
          <p className="text-base font-bold text-white sm:text-lg" role="alert">
            {entry === "lost" ? copy.naoConseguimosVoltar : joinFailurePhrase("error")}
          </p>
          <MemberButton onClick={onRetry} size="lg" variant="primary">
            {WEBINAR_COPY.sala.tentarDeNovo}
          </MemberButton>
        </Cover>
      ) : null}

      {phrase ? (
        <Cover coverUrl={screenBlocksRoom(screen) ? null : coverUrl}>
          {screen === "waiting" ? <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{phrase.title}</p> : null}
          <p className={cn("font-black text-white", screen === "waiting" ? "text-2xl sm:text-3xl" : "text-lg sm:text-2xl")} data-testid="live-stage-phrase" role={screenBlocksRoom(screen) ? "alert" : undefined}>
            {screen === "waiting" ? countdownLabel || phrase.text : phrase.title}
          </p>
          {screen === "ended" && replayHref ? (
            <MemberButtonLink href={replayHref} size="lg" variant="primary">
              {WEBINAR_COPY.aluno.assistirReplay}
            </MemberButtonLink>
          ) : null}
        </Cover>
      ) : null}

      {children}
    </div>
  );
}
