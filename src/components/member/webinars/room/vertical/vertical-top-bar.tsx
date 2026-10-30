"use client";

import { Minimize2, Radio, Users, X } from "lucide-react";
import { MemberChip } from "@/components/member/ui/member-chip";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { RoomElapsed } from "../room-header";
import { verticalBadge } from "./vertical-model";

// O topo da Sala Live vertical (docs/30 §1.6, §6.6 e §9): por cima do video, num degrade para leitura, o selo pela
// mesma regra do cabecalho da sala (Ao vivo so com a decisao da equipe na Simulacao, D10; senao "Sessao das 20:00";
// Replay), o contador "{n} assistindo" (o numero que a sala ja somou: o real mais a parte simulada daquele instante),
// o titulo e os botoes Minimizar e Sair com 44 px. No replay, a dica de girar o celular (a barra do player fica
// inteira com o celular deitado). So os botoes recebem o toque; o resto deixa o toque passar para o video.

export type VerticalTopBarProps = {
  getOffsetMs: () => number;
  kind: "replay" | "simulated";
  onLeave: () => void;
  onMinimize: () => void;
  phase: "ended" | "live" | "waiting";
  /** O numero do contador ja somado (simulation.displayCount). */
  presentNow: number;
  showLiveBadge: boolean;
  timeLabel: string;
  title: string;
};

export function VerticalTopBar({ getOffsetMs, kind, onLeave, onMinimize, phase, presentNow, showLiveBadge, timeLabel, title }: VerticalTopBarProps) {
  const copy = WEBINAR_COPY.sala;
  const badge = verticalBadge({ kind, phase, showLiveBadge });

  return (
    <header
      className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start gap-2 bg-gradient-to-b from-black/75 via-black/35 to-transparent px-3 pb-8 pt-[max(0.5rem,env(safe-area-inset-top))] [text-shadow:0_1px_2px_rgba(0,0,0,0.75)]"
      data-room-vertical-top=""
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {badge.badge === "replay" ? (
            <MemberChip tone="solid">{WEBINAR_COPY.aluno.selo.replay}</MemberChip>
          ) : badge.badge === "live" ? (
            <MemberChip icon={Radio} tone="accent">
              <span data-room-vertical-badge="live">
                {copy.aoVivo} · <RoomElapsed getOffsetMs={getOffsetMs} />
              </span>
            </MemberChip>
          ) : (
            <MemberChip tone="neutral">
              <span data-room-vertical-badge="session">
                {copy.sessaoDas(timeLabel)}
                {badge.elapsed ? (
                  <>
                    {" · "}
                    <RoomElapsed getOffsetMs={getOffsetMs} />
                  </>
                ) : null}
              </span>
            </MemberChip>
          )}
          {badge.showCount ? (
            <p className="inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full bg-black/45 px-2 text-[11px] font-semibold text-white" data-testid="room-present">
              <Users aria-hidden="true" className="size-3" />
              <span className="tabular-nums">{copy.assistindo(presentNow)}</span>
            </p>
          ) : null}
        </div>
        <h1 className="min-w-0 truncate text-sm font-bold text-white">{title}</h1>
        {kind === "replay" ? <p className="text-[11px] leading-4 text-white/80">{WEBINAR_COPY.vertical.girar}</p> : null}
      </div>
      <div className="pointer-events-auto flex shrink-0 items-center gap-1">
        <button aria-label={copy.minimizar} className={topButtonClassName} onClick={onMinimize} title={copy.minimizar} type="button">
          <Minimize2 aria-hidden="true" className="size-5" />
        </button>
        <button aria-label={copy.sair} className={topButtonClassName} onClick={onLeave} title={copy.sair} type="button">
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>
    </header>
  );
}

const topButtonClassName =
  "grid size-11 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none";
