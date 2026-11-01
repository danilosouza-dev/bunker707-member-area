"use client";

import { Mic, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { RoomElapsed } from "./room-header";

// Os selos do palco (docs/31 V2-4), por cima do video, no lugar dos selos do cabecalho: em cima a esquerda, o selo do
// momento ("Ao vivo · 00:42:10" em vermelho na Live ao vivo; na gravada, a regra D10 do docs/30 §1.6: "Ao vivo" so com
// a decisao da equipe, senao "Sessão das 20:00" com o tempo; "Replay" no Replay; na Live ao vivo antes de comecar, com
// a sala aberta, "Aguardando o apresentador", como dizia o cabecalho antes do V2) e, ao lado, "Gravando" enquanto o
// gravador grava; embaixo a esquerda, "{nome} · Apresentador"; embaixo a direita, "Assistente" com o Assistente de IA
// ligado, so a partir de lg (no celular o canto e do Modo cinema) e sempre antes da coluna de miniaturas do iframe
// (--room-video-right, room-layout-model.ts). Pilulas de 32 px (26 px abaixo de lg); no celular o "Ao vivo" fica so com
// o tempo (a frase inteira no title e para o leitor de tela). Nada aqui recebe o toque: o video por baixo continua
// clicavel. O "Ao vivo" e o "Gravando" sao iguais nos dois temas (sobre o video); o apresentador e o Assistente usam os
// tokens --room-on-video-* (docs/31 V2-11). Os data-testid room-on-air e live-recording sao os de antes, no palco.

/** O selo de cima a esquerda: o momento da sala. */
export type RoomStageTopLeft =
  /** A Live ao vivo no ar: a frase inteira ("Ao vivo · 00:42:10") e a curta ("00:42:10"), montadas pela sala. */
  | { kind: "on_air"; label: string; short: string }
  /** A Live gravada com o "Ao vivo" ligado pela equipe (D10): o tempo anda sozinho pelo offset. */
  | { getOffsetMs?: () => number; kind: "recorded_on_air" }
  /** A Live gravada sem o "Ao vivo": "Sessão das 20:00" e, com a sessao no ar, o tempo. */
  | { getOffsetMs?: () => number; kind: "session"; timeLabel: string }
  | { kind: "replay" }
  /** A Live ao vivo antes do "Começar para todos", com a sala aberta: "Aguardando o apresentador", neutro sobre o video. */
  | { kind: "waiting" };

export type RoomStageBadgesProps = {
  /** O Assistente de IA ligado na sessao (o estado lido pela sala, useRoomAssistant). */
  assistantOn: boolean;
  /** Quem apresenta (a pagina sabe); nulo, o selo de baixo a esquerda sai. */
  presenterName: string | null;
  /** O gravador gravando (a Live ao vivo). */
  recording: boolean;
  topLeft: RoomStageTopLeft | null;
};

const PILL =
  "pointer-events-none inline-flex h-[26px] max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-[9px] text-[11px] leading-none lg:h-8 lg:gap-2 lg:px-3 lg:text-xs [&_svg]:size-3.5 [&_svg]:shrink-0";
const DOT = "inline-block size-1.5 shrink-0 rounded-full lg:size-2";
/** Sobre o video e igual nos dois temas: o "Gravando", a "Sessão das 20:00" e o "Replay". */
const ON_VIDEO = "bg-black/60 font-semibold text-white";
/** O apresentador e o Assistente: os tokens do tema (no claro, a pilula branca). */
const ON_VIDEO_THEMED = "bg-room-on-video-bg font-semibold text-room-on-video-fg";
const ON_AIR = "bg-[var(--accent)] font-bold tabular-nums text-white";

function TopLeft({ topLeft }: { topLeft: RoomStageTopLeft }) {
  const copy = WEBINAR_COPY.sala;
  switch (topLeft.kind) {
    case "on_air":
      return (
        <span className={cn(PILL, ON_AIR)} data-testid="room-on-air" title={topLeft.label}>
          <span aria-hidden="true" className={cn(DOT, "bg-white")} />
          <span className="hidden sm:inline">{topLeft.label}</span>
          <span aria-hidden="true" className="sm:hidden">
            {topLeft.short}
          </span>
          <span className="sr-only sm:hidden">{topLeft.label}</span>
        </span>
      );
    case "recorded_on_air":
      return (
        <span className={cn(PILL, ON_AIR)} data-testid="room-on-air">
          <span aria-hidden="true" className={cn(DOT, "bg-white")} />
          <span className="max-sm:sr-only">{copy.aoVivo} · </span>
          <RoomElapsed getOffsetMs={topLeft.getOffsetMs} />
        </span>
      );
    case "session":
      return (
        <span className={cn(PILL, ON_VIDEO)}>
          {copy.sessaoDas(topLeft.timeLabel)}
          {topLeft.getOffsetMs ? (
            <>
              {" · "}
              <RoomElapsed getOffsetMs={topLeft.getOffsetMs} />
            </>
          ) : null}
        </span>
      );
    case "replay":
      return <span className={cn(PILL, ON_VIDEO)}>{WEBINAR_COPY.aluno.selo.replay}</span>;
    case "waiting":
      return (
        <span className={cn(PILL, ON_VIDEO)} data-room-badge="waiting">
          {WEBINAR_COPY.aluno.aguardando}
        </span>
      );
  }
}

export function RoomStageBadges({ assistantOn, presenterName, recording, topLeft }: RoomStageBadgesProps) {
  const gravando = WEBINAR_COPY.aoVivo.gravando;
  const presenter = presenterName?.trim() ?? "";

  return (
    <>
      {topLeft || recording ? (
        <div className="pointer-events-none absolute left-2 top-2 z-20 flex max-w-[calc(100%-1rem)] items-center gap-1.5 lg:left-4 lg:top-4 lg:max-w-[calc(100%-2rem)] lg:gap-2" data-room-badges="top">
          {topLeft ? <TopLeft topLeft={topLeft} /> : null}
          {recording ? (
            <span className={cn(PILL, ON_VIDEO)} data-testid="live-recording" title={gravando}>
              <span aria-hidden="true" className={cn(DOT, "bg-[var(--accent)] motion-safe:animate-pulse")} />
              {gravando}
            </span>
          ) : null}
        </div>
      ) : null}
      {presenter ? (
        <span className={cn(PILL, ON_VIDEO_THEMED, "absolute bottom-2 left-2 z-20 max-w-[calc(100%-3.5rem)] lg:bottom-4 lg:left-4")} data-room-badge="presenter">
          <Mic aria-hidden="true" />
          <span className="min-w-0 truncate">{WEBINAR_COPY.salaV2.selos.apresentador(presenter)}</span>
        </span>
      ) : null}
      {assistantOn ? (
        <span className={cn(PILL, ON_VIDEO_THEMED, "absolute bottom-4 right-[calc(var(--room-video-right)+16px)] z-20 hidden lg:inline-flex")} data-room-badge="assistant">
          <Sparkles aria-hidden="true" />
          {WEBINAR_COPY.sala.selos.assistente}
        </span>
      ) : null}
    </>
  );
}
