"use client";

import { Minimize2, Radio, Users, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import { MemberChip } from "@/components/member/ui/member-chip";
import { usePlatformLogoImage, usePlatformSchoolIcon } from "@/components/platform-branding";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { offsetLabel } from "@/lib/webinar-room-client";
import { cn } from "@/lib/utils";
import { isDefaultSchoolIcon } from "@/server/communications/message-meta";

// O cabecalho da Sala (docs/30 §1.3 e §1.6): titulo, o selo "Ao vivo" com o tempo no ar so quando a equipe ligou
// na Simulacao da sessao (D10; senao "Sessao das 20:00" e o tempo decorrido), o numero real de presentes
// ("{n} assistindo"), Minimizar e Sair. No Replay: o selo Replay, sem contador. A 375 px fica menor, na mesma linha.
// Na Live ao vivo (fase 3): "Ao vivo · 00:42:10" pelo inicio de verdade (a sala monta a frase a cada segundo), na
// espera "Aguardando o apresentador", no fim "Encerrada", e o selo Gravando ao lado quando o gravador esta gravando.
// A sala cobre o cabecalho da area (onde a logo mora): a partir de lg (o ponto em que a sala vira computador, DESKTOP
// em live-room.tsx), a logo de Marca (ou "Bunker707" sem logo) e um traco; abaixo de lg, o Icone da escola de 24 px.
// Entre sm e lg o cabecalho ja tem o "{n} assistindo" e Minimizar/Sair com texto: os 125 px da logo cobririam os selos
// e zerariam o titulo (a 667 px, celular deitado). Sem link: sair da live passa pela confirmacao (askToLeave). Abaixo
// de sm o "Ao vivo · 00:42:10" vira o icone e "00:42:10" (a frase inteira no title e para o leitor de tela) e o
// Gravando vira so o ponto vermelho, para sobrar largura para o titulo antes de Minimizar e Sair.

export type RoomHeaderProps = {
  /** Fase 3: o selo a mais ao lado do titulo (Gravando). */
  badge?: ReactNode;
  /** Replay: o player e livre, sem relogio nem contador. Live: a sala ao vivo (fase 3). */
  kind: "live" | "replay" | "simulated";
  /** Live: "Ao vivo · 00:42:10", montado pela sala a cada segundo. */
  liveLabel?: string;
  /** Live: so o "00:42:10", a versao curta do celular. */
  liveTime?: string;
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

/** A marca no canto da sala: a logo (computador, a partir de lg) ou o Icone da escola (abaixo de lg), sem link. */
function RoomBrand() {
  const logoImage = usePlatformLogoImage();
  const schoolIcon = usePlatformSchoolIcon();

  return (
    <>
      <Image
        alt="Bunker707"
        className={cn("size-6 shrink-0 rounded-[6px] lg:hidden", isDefaultSchoolIcon(schoolIcon) ? "object-contain" : "object-cover")}
        data-room-brand="icon"
        height={24}
        src={schoolIcon}
        unoptimized={!canOptimizeImageSrc(schoolIcon)}
        width={24}
      />
      <div className="hidden shrink-0 items-center gap-3 lg:flex" data-room-brand="logo">
        {logoImage ? (
          <Image
            alt="Bunker707"
            className="h-auto max-h-8 w-[112px] shrink-0 object-contain object-left"
            height={35}
            src={logoImage}
            unoptimized={!canOptimizeImageSrc(logoImage)}
            width={306}
          />
        ) : (
          <span className="whitespace-nowrap text-sm font-black uppercase tracking-wide text-white">Bunker707</span>
        )}
        <span aria-hidden="true" className="h-5 w-px bg-white/15" />
      </div>
    </>
  );
}

export function RoomHeader({ badge, getOffsetMs, kind, liveLabel, liveTime, onLeave, onMinimize, phase, presentNow, showLiveBadge, timeLabel, title }: RoomHeaderProps) {
  const copy = WEBINAR_COPY.sala;
  const live = kind === "simulated" && phase === "live";

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 bg-[#111] px-3 sm:h-14 sm:gap-3 sm:px-4">
      <RoomBrand />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {kind === "live" ? (
          phase === "live" ? (
            <MemberChip icon={Radio} title={liveLabel} tone="accent">
              <span className="tabular-nums" data-testid="room-on-air">
                <span className="hidden sm:inline">{liveLabel}</span>
                <span aria-hidden="true" className="sm:hidden">
                  {liveTime ?? liveLabel}
                </span>
                <span className="sr-only sm:hidden">{liveLabel}</span>
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
