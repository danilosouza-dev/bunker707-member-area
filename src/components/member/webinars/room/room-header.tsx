"use client";

import { LogOut, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { DEFAULT_PLATFORM_LOGO, usePlatformLogoImage } from "@/components/platform-branding";
import { PlatformLogo } from "@/components/platform-logo";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { offsetLabel } from "@/lib/webinar-room-client";
import type { RoomTheme } from "@/lib/webinar-room-prefs";
import type { RoomMetaLine } from "./room-layout-model";
import { RoomPill } from "./room-pill";
import { RoomTooltip } from "./room-tooltip";
import { RoomIconButton } from "./room-ui";

// O cabecalho da Sala (docs/31 V2-3 e V2-18; docs/30 §1.3), o mesmo na Live ao vivo, na gravada e no Replay, sem fundo
// nem borda (a sala aparece por tras), no estilo do topo do YouTube: 56 px abaixo de lg e 64 px a partir de lg (o ponto
// em que a sala vira computador, DESKTOP em live-room.tsx), com a logo no mesmo lugar da do topo da area. A partir de
// lg: a logo da area, a mesma do topo (PlatformLogo; "Bunker707" sem logo; no tema claro a padrao em preto e a enviada
// como o nome em texto; sem link: sair passa pela confirmacao, askToLeave), o titulo em 20/28 peso 700 com reticencias
// e, embaixo, a linha que comeca pelo numero ("128 assistindo agora · Quinta, 30 de outubro · 20:00 · 60 min · com
// Danilo Souza", roomMetaLine) em 14/20 peso 500; a direita, o botao de tema redondo sem contorno, centrado sobre o
// trilho do painel (o lg:pr-5: o circulo de 40 sobre o trilho de 48, que fica a 16 da borda), com a dica no lugar do
// title, presa a borda direita do botao (centrada, ela sairia da janela). Abaixo de lg: o titulo em 15/20 peso 700, a
// linha "128 assistindo agora · com Danilo Souza" em 12/16, o Sair em pilula S vermelha, com o toque de 44 px, e o
// tema a partir de sm (abaixo de sm o cabecalho nao tem largura, V2-18, e na live o tema fica na linha Tema do painel
// Configurações). O Sair vem antes do tema, e o tema e sempre o ultimo: sem a barra (a partir de lg o Sair fica no
// topo), o tema continua sobre o trilho, e o fim da sessao nao troca os dois de lugar em nenhuma largura. Sem selos:
// "Ao vivo", "Gravando", "Sessão das 20:00", "Replay" e "Aguardando o apresentador" ficam no palco (V2-4,
// room-stage-badges.tsx). O numero de agora (o real, ou o somado da Simulacao) some no Replay e com a sessao encerrada:
// a sala passa `presentNow` nulo. As cores vem dos tokens do tema da sala (docs/31 V2-11); o Sair fica no acento, a
// unica cor da marca fora do video (V2-11). Com a barra da sala na tela (V2-6, `leaveInBar`), o Sair do computador fica
// nela e o do cabecalho so aparece abaixo de lg; sem a barra (a sessao encerrada ou fora do acesso, na live e na
// gravada), o do cabecalho fica em todas as larguras.

export type RoomHeaderProps = {
  /** A barra da sala esta na tela com o Sair dela (a partir de lg): o Sair do cabecalho fica so abaixo de lg. */
  leaveInBar?: boolean;
  /** A linha de baixo do titulo no computador (roomMetaLine): o numero de agora e os trechos da data; vazia, a linha sai. */
  metaLine: RoomMetaLine;
  /** A linha do celular, ja com os trechos juntos (roomMobileLine); vazia, a linha sai. */
  mobileLine: string;
  onLeave: () => void;
  /** Troca o tema da sala (claro ou escuro), guardado no navegador da pessoa. */
  onToggleTheme: () => void;
  /** Quantos assistem agora; nulo no Replay e com a sessao encerrada, e entao o numero sai da linha do computador. */
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

/**
 * A marca no canto da sala, so a partir de lg: a mesma logo do topo da area (PlatformLogo, as mesmas classes, a mesma
 * caixa e o mesmo arquivo), sem link e sem o menu, a 16 px da borda como o palco. No tema claro (opcao C, docs/31
 * V2-A58): a logo padrao, toda branca, fica preta (brightness-0); a enviada em Marca e uma so, feita para a area escura,
 * e vira o nome em texto, como no tom Claro do login (docs/12).
 */
function RoomBrand({ theme }: { theme: RoomTheme }) {
  const copy = WEBINAR_COPY.salaV2.cabecalho;
  const platformLogo = usePlatformLogoImage();
  const light = theme === "light";
  const src = light && platformLogo !== DEFAULT_PLATFORM_LOGO ? null : platformLogo;

  return (
    <div className="hidden shrink-0 items-center lg:flex" data-room-brand="logo">
      <PlatformLogo alt={copy.marca} className={light ? "brightness-0" : undefined} src={src} textClassName="text-room-fg-strong" />
    </div>
  );
}

/**
 * O botao de tema (docs/31 V2-12, no estilo do YouTube): redondo, 40 px, sem contorno e sem fundo, o icone de 24 e o
 * tonal so com o ponteiro; o nome diz para qual tema vai, e a dica (abaixo) mostra o nome no lugar do title. A dica fica
 * presa a borda direita do botao (`align="end"`): o botao e o ultimo do cabecalho, a 20 px da borda a partir de lg, e a
 * dica centrada ("Tema escuro" tem uns 89 px) sairia da janela. A classe vai no envoltorio da dica, para o botao
 * escondido nao deixar um vao vazio no cabecalho.
 */
export function RoomThemeButton({ className, onToggle, theme }: { className?: string; onToggle: () => void; theme: RoomTheme }) {
  const copy = WEBINAR_COPY.salaV2.tema;
  const light = theme === "light";
  const name = light ? copy.escuro : copy.claro;
  return (
    <RoomTooltip align="end" className={className} label={name} side="below">
      <RoomIconButton className="[&_svg]:size-6" label={name} onClick={onToggle} size={40} tone="ghost" withTitle={false}>
        {light ? <Moon aria-hidden="true" strokeWidth={1.75} /> : <Sun aria-hidden="true" strokeWidth={1.75} />}
      </RoomIconButton>
    </RoomTooltip>
  );
}

export function RoomHeader({ leaveInBar = false, metaLine, mobileLine, onLeave, onToggleTheme, presentNow, theme, title }: RoomHeaderProps) {
  const copy = WEBINAR_COPY.sala;
  const present = presentNow === null ? null : metaLine.present;
  const rest = metaLine.rest.join(" · ");

  return (
    <header className="flex h-14 shrink-0 items-center gap-2.5 pl-4 pr-2 sm:pr-4 lg:h-16 lg:gap-7 lg:pr-5">
      <RoomBrand theme={theme} />
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="min-w-0 truncate text-[15px] font-bold leading-5 text-room-fg-strong lg:text-xl lg:leading-7">{title}</h1>
        {present || rest ? (
          <p className="hidden min-w-0 truncate text-sm font-medium leading-5 text-room-fg-subtle lg:block" data-room-line="meta">
            {present ? (
              <>
                <span data-testid="room-present">{present}</span>
                {rest ? " · " : null}
              </>
            ) : null}
            {rest}
          </p>
        ) : null}
        {mobileLine ? (
          <p className="min-w-0 truncate text-xs font-medium leading-4 text-room-fg-subtle lg:hidden" data-testid="room-mobile-line">
            {mobileLine}
          </p>
        ) : null}
      </div>
      <RoomPill className={leaveInBar ? "lg:hidden" : undefined} icon={LogOut} label={copy.sair} onClick={onLeave} size="s" tone="red" touch44 />
      <RoomThemeButton className="hidden sm:inline-flex" onToggle={onToggleTheme} theme={theme} />
    </header>
  );
}
