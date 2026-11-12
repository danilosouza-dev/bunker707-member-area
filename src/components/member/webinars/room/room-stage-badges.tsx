"use client";

import { Mic, Sparkles, Users } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { RoomElapsed } from "./room-header";
import type { RoomPresentBadge } from "./room-layout-model";
import { RoomWideHidden } from "./screen/room-wide-hidden";

// Os selos do palco (docs/31 V2-4), por cima do video, no lugar dos selos do cabecalho: em cima a esquerda, o selo do
// momento ("Ao vivo · 00:42:10" em vermelho na Live ao vivo; na gravada, a regra D10 do docs/30 §1.6: "Ao vivo" so com
// a decisao da equipe, senao "Sessão das 20:00" com o tempo; "Replay" no Replay; na Live ao vivo antes de comecar, com
// a sala aberta, "Aguardando o apresentador", como dizia o cabecalho antes do V2), ao lado dele o selo de quem assiste
// agora (o icone de pessoas e o numero, "1.234"; a frase inteira, "1.234 assistindo agora", no title e para o leitor de
// tela; docs/31 §11.5: o numero saiu da linha do titulo e some no Replay e com a sessao encerrada) e, por ultimo,
// "Gravando" enquanto o gravador grava; embaixo a esquerda, "{nome} · Apresentador"; embaixo a direita, "Assistente" com o Assistente de IA
// ligado, so a partir de lg (no celular o canto e do Modo cinema) e sempre antes da coluna de miniaturas do iframe
// (--room-video-right, room-layout-model.ts). Pilulas de 32 px (26 px abaixo de lg); no celular o "Ao vivo" fica so com
// o tempo (a frase inteira no title e para o leitor de tela). Nada aqui recebe o toque: o video por baixo continua
// clicavel. O "Ao vivo" e o "Gravando" sao iguais nos dois temas (sobre o video); o apresentador e o Assistente usam os
// tokens --room-on-video-* (docs/31 V2-11). Os data-testid room-on-air, room-present e live-recording sao os de antes,
// no palco.
// O console de quem apresenta (docs/31 V2-13) usa as mesmas pecas e passa o que so ele tem: o selo do momento fora do ar
// (`label`, neutro como o "waiting"), o papel do selo de baixo ("Você · Co-apresentador") e o canto de cima a direita
// (os presentes com o pico, antes da coluna de miniaturas). A sala nao passa nada disso, e o HTML dela fica igual.
// A Na tela (especificacao de 10/11/2026, §3.2): com um banner ou QR Code em "Embaixo, à direita", o selo do Assistente
// sai do palco largo (`assistantWideHidden`, so CSS: no palco estreito o item esta na faixa e o selo fica).

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
  | { kind: "waiting" }
  /** O console fora do ar: a frase do momento ("Começa em 4:59", "Durou 1:00:00"), neutra sobre o video como a espera. */
  | { kind: "label"; label: string };

export type RoomStageBadgesProps = {
  /** O Assistente de IA ligado na sessao (o estado lido pela sala, useRoomAssistant). */
  assistantOn: boolean;
  /** Um item da Na tela em "Embaixo, à direita": o selo do Assistente sai do palco de 640 px ou mais. */
  assistantWideHidden?: boolean;
  /** Quem assiste agora (roomPresentBadge), ao lado do selo do momento; nulo ou ausente (o console), o selo sai. */
  present?: RoomPresentBadge | null;
  /** Quem apresenta (a pagina sabe); nulo, o selo de baixo a esquerda sai. */
  presenterName: string | null;
  /** O papel no selo de baixo a esquerda (o console: "Co-apresentador"); sem ele, "Apresentador", como na sala. */
  presenterRole?: string;
  /** O gravador gravando (a Live ao vivo). */
  recording: boolean;
  topLeft: RoomStageTopLeft | null;
  /**
   * O canto de cima a direita (o console: os presentes com o pico), sempre antes da coluna de miniaturas do iframe, na
   * mesma linha e na mesma distancia da borda dos selos da esquerda; a partir de sm (no celular ele cairia sobre o selo
   * do momento, e o console mostra os presentes no topo).
   */
  topRight?: ReactNode;
};

const PILL =
  "pointer-events-none inline-flex h-[26px] max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-[9px] text-[11px] leading-none lg:h-8 lg:gap-2 lg:px-3 lg:text-xs [&_svg]:size-3.5 [&_svg]:shrink-0";
const DOT = "inline-block size-1.5 shrink-0 rounded-full lg:size-2";
/** Sobre o video e igual nos dois temas: o "Gravando", a "Sessão das 20:00" e o "Replay". */
const ON_VIDEO = "bg-black/60 font-semibold text-white";
/** O apresentador e o Assistente: os tokens do tema (no claro, a pilula branca). */
const ON_VIDEO_THEMED = "bg-room-on-video-bg font-semibold text-room-on-video-fg";
const ON_AIR = "bg-room-accent font-bold tabular-nums text-white";

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
    case "label":
      return (
        <span className={cn(PILL, ON_VIDEO, "tabular-nums")} data-room-badge="moment">
          {topLeft.label}
        </span>
      );
  }
}

/** Uma pilula sobre o video, igual nos dois temas (a do "Gravando"), para o que o console poe no canto de cima a direita. */
export function RoomStagePill({ children, className, ...props }: { children: ReactNode; className?: string; "data-room-badge"?: string; title?: string }) {
  return (
    <span className={cn(PILL, ON_VIDEO, className)} {...props}>
      {children}
    </span>
  );
}

export function RoomStageBadges({ assistantOn, assistantWideHidden = false, present = null, presenterName, presenterRole, recording, topLeft, topRight }: RoomStageBadgesProps) {
  const gravando = WEBINAR_COPY.aoVivo.gravando;
  const presenter = presenterName?.trim() ?? "";

  return (
    <>
      {topLeft || present || recording ? (
        <div className="pointer-events-none absolute left-2 top-2 z-20 flex max-w-[calc(100%-1rem)] items-center gap-1.5 lg:left-4 lg:top-4 lg:max-w-[calc(100%-2rem)] lg:gap-2" data-room-badges="top">
          {topLeft ? <TopLeft topLeft={topLeft} /> : null}
          {present ? (
            <span className={cn(PILL, ON_VIDEO, "tabular-nums")} data-testid="room-present" title={present.label}>
              <Users aria-hidden="true" />
              <span aria-hidden="true">{present.count}</span>
              <span className="sr-only">{present.label}</span>
            </span>
          ) : null}
          {recording ? (
            <span className={cn(PILL, ON_VIDEO)} data-testid="live-recording" title={gravando}>
              <span aria-hidden="true" className={cn(DOT, "bg-room-accent motion-safe:animate-pulse")} />
              {gravando}
            </span>
          ) : null}
        </div>
      ) : null}
      {presenter ? (
        <span className={cn(PILL, ON_VIDEO_THEMED, "absolute bottom-[calc(0.5rem+var(--room-video-bottom,0px))] left-2 z-20 max-w-[calc(100%-3.5rem)] lg:bottom-[calc(1rem+var(--room-video-bottom,0px))] lg:left-4")} data-room-badge="presenter">
          <Mic aria-hidden="true" />
          <span className="min-w-0 truncate">{presenterRole === undefined ? WEBINAR_COPY.salaV2.selos.apresentador(presenter) : WEBINAR_COPY.consoleV2.palco.selo(presenter, presenterRole)}</span>
        </span>
      ) : null}
      {topRight ? (
        <div
          className="pointer-events-none absolute right-[calc(var(--room-video-right)+8px)] top-2 z-20 hidden items-center gap-1.5 sm:flex lg:right-[calc(var(--room-video-right)+16px)] lg:top-4 lg:gap-2"
          data-room-badges="top-right"
        >
          {topRight}
        </div>
      ) : null}
      {assistantOn ? (
        <RoomWideHidden hidden={assistantWideHidden}>
          <span className={cn(PILL, ON_VIDEO_THEMED, "absolute bottom-[calc(1rem+var(--room-video-bottom,0px))] right-[calc(var(--room-video-right)+16px)] z-20 hidden lg:inline-flex")} data-room-badge="assistant">
            <Sparkles aria-hidden="true" />
            {WEBINAR_COPY.sala.selos.assistente}
          </span>
        </RoomWideHidden>
      ) : null}
    </>
  );
}
