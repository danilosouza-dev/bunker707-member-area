"use client";

import { LogOut, Moon, Sun, Users } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { usePlatformLogoImage } from "@/components/platform-branding";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { offsetLabel } from "@/lib/webinar-room-client";
import type { RoomTheme } from "@/lib/webinar-room-prefs";
import { RoomButton, RoomIconButton } from "./room-ui";

// O cabecalho da Sala (docs/31 V2-3 e V2-18; docs/30 §1.3), o mesmo na Live ao vivo, na gravada e no Replay, sem fundo
// nem borda (a sala aparece por tras), 56 px. A partir de lg (o ponto em que a sala vira computador, DESKTOP em
// live-room.tsx): a logo de Marca (ou "Bunker707" sem logo, sem link: sair passa pela confirmacao, askToLeave), o
// titulo em 22/800 com reticencias e, embaixo, a linha da data ("Quinta, 30 de outubro · 20:00 · 60 min · com Danilo
// Souza", room-layout-model.ts); a direita, "{n} assistindo", um traco e o botao de tema. Abaixo de lg: o titulo em
// 15/800, a linha "com Danilo Souza · 128 assistindo", o tema a partir de sm (abaixo de sm o cabecalho nao tem largura,
// V2-18, e na live o tema fica na linha Tema do painel Configurações) e o Sair. Sem selos: "Ao vivo", "Gravando",
// "Sessão das 20:00", "Replay" e "Aguardando o apresentador" ficam no palco (V2-4, room-stage-badges.tsx). "{n}
// assistindo" (o numero real, ou o somado da Simulacao) some no Replay e com a sessao encerrada: a sala passa
// `presentNow` nulo. As cores vem dos tokens do tema da sala (docs/31 V2-11); o Sair fica no
// acento, a unica cor da marca fora do video (V2-11). Com a barra da sala na tela (V2-6, `leaveInBar`), o Sair do
// computador fica nela e o do cabecalho so aparece abaixo de lg; sem a barra (a live ou a sessao encerrada, fora do
// acesso), o do cabecalho fica em todas as larguras.

export type RoomHeaderProps = {
  /** A linha da data no computador, ja com os trechos juntos (roomDateLine); vazia, a linha sai. */
  dateLine: string;
  /** A barra da sala esta na tela com o Sair dela (a partir de lg): o Sair do cabecalho fica so abaixo de lg. */
  leaveInBar?: boolean;
  /** A linha do celular, ja com os trechos juntos (roomMobileLine); vazia, a linha sai. */
  mobileLine: string;
  onLeave: () => void;
  /** Troca o tema da sala (claro ou escuro), guardado no navegador da pessoa. */
  onToggleTheme: () => void;
  /** "{n} assistindo"; nulo no Replay e com a sessao encerrada. */
  presentNow: number | null;
  /** O tema da sala agora (o botao diz para qual vai). */
  theme: RoomTheme;
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

/** A marca no canto da sala, so a partir de lg: a logo de Marca (ou o nome, sem logo), sem link. */
function RoomBrand() {
  const logoImage = usePlatformLogoImage();

  return (
    <div className="hidden shrink-0 items-center lg:flex" data-room-brand="logo">
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
        <span className="whitespace-nowrap text-sm font-black uppercase tracking-wide text-room-fg-strong">Bunker707</span>
      )}
    </div>
  );
}

/** O botao de tema (docs/31 V2-12): redondo, 40 px; o nome diz para qual tema vai. */
export function RoomThemeButton({ className, onToggle, theme }: { className?: string; onToggle: () => void; theme: RoomTheme }) {
  const copy = WEBINAR_COPY.salaV2.tema;
  const light = theme === "light";
  return (
    <RoomIconButton className={className} label={light ? copy.escuro : copy.claro} onClick={onToggle} size={40}>
      {light ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
    </RoomIconButton>
  );
}

export function RoomHeader({ dateLine, leaveInBar = false, mobileLine, onLeave, onToggleTheme, presentNow, theme, title }: RoomHeaderProps) {
  const copy = WEBINAR_COPY.sala;

  return (
    <header className="flex h-14 shrink-0 items-center gap-2.5 pl-4 pr-2 sm:pr-4 lg:gap-7 lg:px-4">
      <RoomBrand />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 lg:gap-1">
        <h1 className="min-w-0 truncate text-[15px] font-extrabold leading-5 text-room-fg-strong lg:text-[22px] lg:leading-7">{title}</h1>
        {dateLine ? (
          <p className="hidden min-w-0 truncate text-xs font-medium text-room-fg-subtle lg:block" data-room-line="date">
            {dateLine}
          </p>
        ) : null}
        {mobileLine ? (
          <p className="min-w-0 truncate text-[11px] font-medium text-room-fg-subtle lg:hidden" data-testid="room-mobile-line">
            {mobileLine}
          </p>
        ) : null}
      </div>
      {presentNow !== null ? (
        <p className="hidden shrink-0 items-center gap-2 whitespace-nowrap text-[13px] font-semibold text-room-fg-muted lg:flex" data-testid="room-present">
          <Users aria-hidden="true" className="size-4" />
          {copy.assistindo(presentNow)}
        </p>
      ) : null}
      <span aria-hidden="true" className="hidden h-7 w-px shrink-0 bg-room-divider lg:block" />
      <RoomThemeButton className="hidden sm:grid" onToggle={onToggleTheme} theme={theme} />
      <RoomButton className={leaveInBar ? "lg:hidden" : undefined} onClick={onLeave} variant="accent">
        <LogOut aria-hidden="true" />
        {copy.sair}
      </RoomButton>
    </header>
  );
}
