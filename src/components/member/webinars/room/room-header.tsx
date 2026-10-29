"use client";

import { Minimize2, Radio, Users, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { MemberChip } from "@/components/member/ui/member-chip";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { offsetLabel } from "@/lib/webinar-room-client";
import { cn } from "@/lib/utils";

// O cabecalho da Sala (docs/30 §1.3 e §1.6): titulo, o selo "Ao vivo" com o tempo no ar so quando a equipe ligou
// na Simulacao da sessao (D10; senao "Sessao das 20:00" e o tempo decorrido), o numero real de presentes
// ("{n} assistindo"), Minimizar e Sair. No Replay: o selo Replay, sem contador. A 375 px fica menor, na mesma linha.
// Na Live ao vivo (fase 3): "Ao vivo · 00:42:10" pelo inicio de verdade (a sala monta a frase a cada segundo), na
// espera "Aguardando o apresentador", no fim "Encerrada", e o selo Gravando ao lado quando o gravador esta gravando.

export type RoomHeaderProps = {
  /** Fase 3: o selo a mais ao lado do titulo (Gravando). */
  badge?: ReactNode;
  /** Replay: o player e livre, sem relogio nem contador. Live: a sala ao vivo (fase 3). */
  kind: "live" | "replay" | "simulated";
  /** Live: "Ao vivo · 00:42:10", montado pela sala a cada segundo. */
  liveLabel?: string;
  onLeave: () => void;
  onMinimize: () => void;
  /** O offset atual em ms (o tempo no ar), lido a cada segundo. */
  getOffsetMs?: () => number;
  phase: "ended" | "live" | "waiting";
  presentNow: number;
  showLiveBadge: boolean;
  timeLabel: string;
  title: string;
};

/** "00:42:10" andando a cada segundo, sem redesenhar a sala inteira. */
export function RoomElapsed({ getOffsetMs }: { getOffsetMs?: () => number }) {
  const [label, setLabel] = useState(() => (getOffsetMs ? offsetLabel(Math.max(0, getOffsetMs())) : ""));

  useEffect(() => {
    if (!getOffsetMs) {
      return;
    }
    const tick = () => setLabel(offsetLabel(Math.max(0, getOffsetMs())));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [getOffsetMs]);

  return <span className="tabular-nums">{label}</span>;
}

export function RoomHeader({ badge, getOffsetMs, kind, liveLabel, onLeave, onMinimize, phase, presentNow, showLiveBadge, timeLabel, title }: RoomHeaderProps) {
  const copy = WEBINAR_COPY.sala;
  const live = kind === "simulated" && phase === "live";

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 bg-[#111] px-3 sm:h-14 sm:gap-3 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {kind === "live" ? (
          phase === "live" ? (
            <MemberChip icon={Radio} tone="accent">
              <span className="tabular-nums" data-testid="room-on-air">
                {liveLabel}
              </span>
            </MemberChip>
          ) : (
            <MemberChip tone={phase === "ended" ? "muted" : "neutral"}>{phase === "ended" ? WEBINAR_COPY.aluno.situacoes.ended : WEBINAR_COPY.aluno.aguardando}</MemberChip>
          )
        ) : kind === "replay" ? (
          <MemberChip tone="solid">{WEBINAR_COPY.aluno.selo.replay}</MemberChip>
        ) : live && showLiveBadge ? (
          <MemberChip icon={Radio} tone="accent">
            <span className="hidden sm:inline">{copy.aoVivo} · </span>
            <span className="sm:hidden">{copy.aoVivo} </span>
            <RoomElapsed getOffsetMs={getOffsetMs} />
          </MemberChip>
        ) : (
          <MemberChip tone="neutral">
            <span className="hidden sm:inline">{copy.sessaoDas(timeLabel)}</span>
            <span className="sm:hidden">{timeLabel}</span>
            {live ? (
              <>
                {" · "}
                <RoomElapsed getOffsetMs={getOffsetMs} />
              </>
            ) : null}
          </MemberChip>
        )}
        {badge}
        <h1 className="min-w-0 truncate text-sm font-bold text-white sm:text-base">{title}</h1>
      </div>
      {kind !== "replay" && phase !== "ended" ? (
        <p className="hidden shrink-0 items-center gap-1.5 text-xs font-semibold text-zinc-300 sm:flex" data-testid="room-present">
          <Users aria-hidden="true" className="size-3.5" />
          {copy.assistindo(presentNow)}
        </p>
      ) : null}
      <div className="flex shrink-0 items-center gap-1">
        <button
          aria-label={copy.minimizar}
          className={cn(headerButtonClassName)}
          onClick={onMinimize}
          title={copy.minimizar}
          type="button"
        >
          <Minimize2 aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">{copy.minimizar}</span>
        </button>
        <button aria-label={copy.sair} className={cn(headerButtonClassName)} onClick={onLeave} title={copy.sair} type="button">
          <X aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">{copy.sair}</span>
        </button>
      </div>
    </header>
  );
}

const headerButtonClassName =
  "inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-zinc-200 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none sm:px-3 sm:text-sm";
