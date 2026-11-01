"use client";

import { Check, ChevronDown, LayoutGrid, PanelRight } from "lucide-react";
import { useEffect, useRef, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { RoomView } from "@/lib/webinar-room-prefs";
import { ROOM_FOCUS } from "./room-ui";

// A Visão do vídeo da Live ao vivo (docs/31 V2-16), na zona da direita da barra, antes de Configurações, so a partir de
// lg (no celular o video fica sempre no Palco, e a coluna some pela largura do iframe, V2-A5): entre lg e xl um circulo
// de 48 px so com o icone, como os outros da barra; a partir de xl a pilula de 44 px com o icone, o nome e a seta. O
// nome acessivel diz o que o video mostra AGORA ("Visão do vídeo: Palco", o ultimo tileViewChanged do motor), nunca a
// escolha guardada: a equipe pode mudar a visao de todos. O menu "Visão do vídeo" tem as duas opcoes (menuitemradio, a
// marcada com aria-checked): Palco e Grade, que a sala manda por comando (setTileView), sem remontar o iframe.
// Desligado antes de entrar na sala. Quem diz se o menu esta aberto e a sala (open e onOpenChange): abrir fecha Reagir e
// Configurações (nunca dois abertos juntos), e o menu desligado fecha de vez (na volta a sala ele nao reabre sozinho).
// Aberto, o foco vai para a opcao marcada; as setas andam, Home e End vao as pontas, o Esc fecha (sem sair da sala) e
// devolve o foco ao botao, como a escolha e o clique no proprio botao (no WebKit o clique nao foca o botao, e o foco
// ficaria na opcao que some, caindo no body); o Tab, um toque fora, um clique no video (o foco que entra no iframe tira
// o foco da pagina) e o foco que sai para outro controle da sala fecham. O menu abre por cima do palco (z-40, acima da
// enquete do palco, z-30). As cores vem dos tokens do tema da sala (V2-11). Nenhuma frase escrita aqui.

/** O menu da visao (o aria-controls do botao). */
export const ROOM_VIEW_MENU_ID = "room-view-menu";

const VIEWS: readonly RoomView[] = ["stage", "grid"];
const VIEW_ICONS = { grid: LayoutGrid, stage: PanelRight } as const;

function viewName(view: RoomView): string {
  const copy = WEBINAR_COPY.salaV2.visao;
  return view === "grid" ? copy.grade : copy.palco;
}

export type RoomViewMenuProps = {
  /** Fora da sala (antes de entrar, reconectando, o "ver como"): sem iframe, nada a mudar. */
  disabled: boolean;
  onChoose: (view: RoomView) => void;
  /** Abrir (o botao, as setas no botao) ou fechar (a escolha, o Esc, o Tab, um toque fora, o clique no video). */
  onOpenChange: (open: boolean) => void;
  /** O menu aberto, pela sala (desligado, ele nunca aparece). */
  open: boolean;
  /** O que o motor mostra agora (o botao e a opcao marcada dizem isto). */
  shown: RoomView;
};

export function RoomViewMenu({ disabled, onChoose, onOpenChange, open, shown }: RoomViewMenuProps) {
  const copy = WEBINAR_COPY.salaV2.visao;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuShown = open && !disabled;
  const Icon = VIEW_ICONS[shown];
  const label = copy.atual(viewName(shown));
  // O ultimo onOpenChange da sala (os ouvintes abaixo so mudam quando o menu abre ou fecha, para o foco nao voltar a
  // opcao marcada a cada pintura).
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });

  // Aberto: o foco na opcao marcada; um toque fora do botao e do menu fecha, e o clique no video tambem (o foco que
  // entra no iframe do motor tira o foco da pagina: o pointerdown dele nao chega a este document).
  useEffect(() => {
    if (!menuShown) {
      return;
    }
    const root = rootRef.current;
    root?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (root && !root.contains(event.target as Node)) {
        // O foco na opcao que vai sumir passa antes ao botao (no WebKit o toque num botao nao o foca, e o foco cairia
        // no body); no Chrome, o toque num controle leva o foco para ele logo depois.
        if (root.contains(document.activeElement)) {
          buttonRef.current?.focus();
        }
        onOpenChangeRef.current(false);
      }
    };
    const onWindowBlur = (event: FocusEvent) => {
      if (event.target === window) {
        onOpenChangeRef.current(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [menuShown]);

  /**
   * Fecha e devolve o foco ao botao (antes de o menu sumir: senao o foco cairia no body). Tambem no toque do proprio
   * botao com o menu aberto: no WebKit o clique nao foca o botao, e o foco ficaria na opcao que some.
   */
  function close() {
    buttonRef.current?.focus();
    onOpenChange(false);
  }

  /**
   * O foco saiu para outro controle da sala (um atalho, o Tab da trava): o menu fecha. Sem o destino (o WebKit, que tira
   * o foco da opcao no toque do proprio botao sem foca-lo), nada aqui: o toque fora e o clique no botao cuidam disso.
   */
  function onBlur(event: ReactFocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (menuShown && next instanceof Node && !event.currentTarget.contains(next)) {
      onOpenChange(false);
    }
  }

  function choose(view: RoomView) {
    onChoose(view);
    close();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && menuShown) {
      // So o menu fecha (com o foco no botao ou numa opcao): o Esc da sala, que pergunta antes de sair, nao recebe este.
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    const target = event.target as HTMLElement;
    if (target === buttonRef.current) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        onOpenChange(true);
      }
      return;
    }
    const items = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const index = items.indexOf(target);
    if (index < 0) {
      return;
    }
    const focusAt = (next: number) => items[(next + items.length) % items.length]?.focus();
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index - 1);
        return;
      case "Home":
        event.preventDefault();
        focusAt(0);
        return;
      case "End":
        event.preventDefault();
        focusAt(items.length - 1);
        return;
      case "Tab":
        onOpenChange(false);
        return;
    }
  }

  return (
    <div className="relative contents lg:block" data-room-view-menu="" onBlur={onBlur} onKeyDown={onKeyDown} ref={rootRef}>
      <button
        aria-controls={ROOM_VIEW_MENU_ID}
        aria-expanded={menuShown}
        aria-haspopup="menu"
        aria-label={label}
        className={cn(
          "hidden size-11 shrink-0 items-center justify-center gap-2 rounded-full border border-room-border-strong bg-room-surface text-[13px] font-semibold text-room-fg-strong transition-colors hover:bg-room-control-hover disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none lg:inline-flex lg:size-12 xl:h-11 xl:w-auto xl:rounded-[var(--member-button-radius)] xl:px-3.5 [&_svg]:shrink-0",
          ROOM_FOCUS
        )}
        data-room-bar-item="view"
        disabled={disabled}
        onClick={() => (menuShown ? close() : onOpenChange(true))}
        ref={buttonRef}
        title={label}
        type="button"
      >
        <Icon aria-hidden="true" className="size-[18px]" />
        <span className="hidden xl:inline">{viewName(shown)}</span>
        <ChevronDown aria-hidden="true" className="hidden size-3.5 xl:block" />
      </button>
      <div
        aria-label={copy.rotulo}
        className="absolute bottom-full right-0 z-40 mb-3 min-w-48 rounded-[12px] border border-room-border bg-room-surface p-1 shadow-[0_16px_40px_rgba(0,0,0,0.35)]"
        hidden={!menuShown}
        id={ROOM_VIEW_MENU_ID}
        role="menu"
      >
        {VIEWS.map((view) => {
          const ItemIcon = VIEW_ICONS[view];
          const checked = view === shown;
          return (
            <button
              aria-checked={checked}
              className={cn(
                "flex h-10 w-full items-center gap-2.5 rounded-[8px] px-3 text-left text-sm font-semibold text-room-fg hover:bg-room-control hover:text-room-fg-strong [&_svg]:shrink-0",
                ROOM_FOCUS
              )}
              data-room-view={view}
              key={view}
              onClick={() => choose(view)}
              role="menuitemradio"
              tabIndex={-1}
              type="button"
            >
              <ItemIcon aria-hidden="true" className="size-4" />
              <span className="flex-1">{viewName(view)}</span>
              {checked ? <Check aria-hidden="true" className="size-4" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
