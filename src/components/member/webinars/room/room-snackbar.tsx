"use client";

import type { FocusEvent as ReactFocusEvent } from "react";
import { RoomPill } from "./room-pill";
import type { RoomSnack, SnackbarPlacement } from "./room-snackbar-model";

// O aviso da sala no estilo do YouTube (docs/31, a sala no estilo do YouTube; o snackbar do YouTube): a caixa
// invertida (clara no tema escuro, escura no claro) de raio 8, de 288 a 448 px a partir de lg (abaixo, a largura que o
// lugar da), com 48 px de altura minima; o texto 14/20 em ate 2 linhas (o leitor de tela le a frase inteira) e, quando
// ha, a acao em pilula M de texto na cor da acao do aviso, com o nome exato da frase. Nada de icone, barra lateral ou X.
// O anel de 1 px e a sombra (--room-snackbar-shadow) separam a caixa do video, que pode ter qualquer cor. Entra subindo
// do pe com a opacidade (0,5 s, sem movimento com prefers-reduced-motion); o mesmo tipo de aviso fica no lugar.
// A regiao (role="status", polida, atomica) fica sempre montada, vazia sem aviso, para o leitor de tela ouvir o que
// chega. O tempo, um de cada vez e o lugar sao do modelo (room-snackbar-model.ts) e de quem mostra: a classe do lugar
// vem de fora (className), e a peca so desenha; o ponteiro em cima e o foco dentro pausam o tempo (onPauseChange). O
// aviso nao toma o foco. So tokens --room-*; nenhuma frase escrita aqui.

export type RoomSnackbarProps = {
  /** A classe do lugar (no palco, preso ao pe da tela, acima do campo ou no pe do painel), de quem mostra o aviso. */
  className?: string;
  /** A acao do aviso (a `key` dela). */
  onAction?: (key: string) => void;
  /** O ponteiro em cima ou o foco dentro (true) e a saida deles (false): o tempo para e volta a contar. */
  onPauseChange?: (paused: boolean) => void;
  placement: SnackbarPlacement;
  snack: RoomSnack | null;
};

export function RoomSnackbar({ className, onAction, onPauseChange, placement, snack }: RoomSnackbarProps) {
  /** O foco que sai para fora do aviso (o que vai para a acao dele continua dentro). */
  function onBlur(event: ReactFocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      onPauseChange?.(false);
    }
  }

  const action = snack?.action;
  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className={className}
      data-room-snackbar={placement}
      onBlur={onBlur}
      onFocus={() => onPauseChange?.(true)}
      onPointerEnter={() => onPauseChange?.(true)}
      onPointerLeave={() => onPauseChange?.(false)}
      role="status"
    >
      {snack ? (
        <div
          className="flex min-h-12 w-full max-w-[448px] items-center rounded-[8px] bg-room-snackbar-bg text-room-snackbar-fg shadow-[var(--room-snackbar-shadow)] motion-safe:animate-[room-snack-in_0.5s_ease] lg:min-w-[288px]"
          key={snack.key}
        >
          {/* A margem (e nao o recuo) em volta do texto, como no YouTube: o corte das 2 linhas vale na borda do recuo, e
              com recuo a terceira linha apareceria embaixo. */}
          <p className="mx-3 my-2 line-clamp-2 min-w-0 flex-1 text-sm font-normal leading-5" data-testid="live-notice">
            {snack.text}
          </p>
          {action ? (
            <RoomPill
              // A pilula de texto no aviso invertido: a cor da acao, o hover dela, o pressionado e o anel do foco do
              // lado invertido (o anel e o pressionado da sala sumiriam na caixa clara do tema escuro).
              className="mr-3 text-room-snackbar-action hover:bg-room-snackbar-action-hover active:shadow-[inset_0_0_0_999px_var(--room-press-inverse)] focus-visible:outline-room-snackbar-fg"
              label={action.label}
              onClick={() => onAction?.(action.key)}
              tone="text"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
