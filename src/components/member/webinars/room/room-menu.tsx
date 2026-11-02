"use client";

import { Check, type LucideIcon } from "lucide-react";
import { Fragment, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { menuKeyStep } from "./room-layout-model";

// O menu da sala no estilo do YouTube (docs/31, a sala no estilo do YouTube; o menu do topo do YouTube): a caixa em
// --room-menu com raio 12, a sombra do menu e 8 px em cima e embaixo; as opcoes de 40 px (44 abaixo de lg, o toque),
// 14/20 peso 400, com o fundo tonal no ponteiro e na escolhida, e o contorno de 2 px da cor do texto por dentro no foco
// do teclado. A escolhida (menuitemradio com aria-checked) leva o Check de 20 na frente, para o estado nao depender so
// do fundo; o icone da opcao e de 24. Grupos com nome (role="group" com o aria-label e o rotulo 12/18 em cima)
// separados pelo traco de 1 px. A caixa fica no HTML fechada (hidden), com as opcoes, e quem diz se esta aberta e quem
// mostra o botao (open e onClose).
// A mecanica e a que a Visão do vídeo tinha (room-view-menu.tsx): aberto, o foco vai a opcao escolhida (ou a
// primeira); as setas andam com volta, Home e End vao as pontas (menuKeyStep); o Esc fecha so o menu (nunca chega a
// sala, que perguntaria se quer sair) e devolve o foco ao botao; o Tab, um toque fora do botao e do menu, um clique no
// video (o foco que entra no iframe do motor tira o foco da pagina) e o foco que sai para outro controle fecham. A
// escolha devolve o foco ao botao antes de fechar (no WebKit o toque nao foca o botao, e o foco ficaria na opcao que
// some, caindo no body). So tokens --room-*; nenhuma frase escrita aqui.

export type RoomMenuItem = {
  checked?: boolean;
  /** Atributos data-* da opcao (o data-room-view da Visão do vídeo). */
  data?: Partial<Record<`data-${string}`, string>>;
  /** Desligada: continua na lista e recebe o foco (aria-disabled), mas a escolha nao faz nada. */
  disabled?: boolean;
  icon?: LucideIcon;
  key: string;
  /** O nome da opcao, o texto que aparece. */
  label: string;
  onSelect: () => void;
  /** Uma escolha entre as opcoes do grupo (menuitemradio com aria-checked); sem isso, uma acao (menuitem). */
  radio?: boolean;
};

export type RoomMenuGroup = { items: RoomMenuItem[]; label?: string };

export type RoomMenuProps = {
  /** O lado do botao em que a caixa se alinha. */
  align: "center" | "end" | "start";
  groups: RoomMenuGroup[];
  /** O id da caixa (o aria-controls do botao). */
  id: string;
  /** O nome do menu (o aria-label da caixa). */
  label: string;
  /** Fechar: `refocus` diz que o foco ja voltou ao botao (a escolha e o Esc); o Tab, o toque fora e o video, nao. */
  onClose: (refocus: boolean) => void;
  open: boolean;
  /** Acima do botao (a barra) ou abaixo (o cabecalho do painel). */
  placement: "above" | "below";
  /** O botao que abre o menu: o foco volta a ele, e o toque nele nao conta como fora. */
  triggerRef: RefObject<HTMLElement | null>;
};

const MENU_PLACEMENT = { above: "bottom-full mb-2", below: "top-full mt-2" } as const;
const MENU_ALIGN = { center: "left-1/2 -translate-x-1/2", end: "right-0", start: "left-0" } as const;
const MENU_ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"]';

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return [...(menu?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR) ?? [])];
}

export function RoomMenu({ align, groups, id, label, onClose, open, placement, triggerRef }: RoomMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  // O ultimo onClose de quem mostra (os ouvintes abaixo so mudam quando o menu abre ou fecha, para o foco nao voltar a
  // opcao escolhida a cada pintura).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Aberto: o foco na opcao escolhida (ou na primeira); um toque fora do botao e do menu, o clique no video (o
  // pointerdown do iframe nao chega a este document, mas a janela perde o foco) e o foco que sai para outro controle
  // fecham.
  useEffect(() => {
    if (!open) {
      return;
    }
    const menu = menuRef.current;
    const items = menuItems(menu);
    (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
    const inside = (node: Node) => Boolean(menu?.contains(node) || triggerRef.current?.contains(node));
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && inside(event.target)) {
        return;
      }
      // O foco na opcao que vai sumir passa antes ao botao (no WebKit o toque num botao nao o foca, e o foco cairia no
      // body); no Chrome, o toque num controle leva o foco para ele logo depois.
      if (menu && document.activeElement && menu.contains(document.activeElement)) {
        triggerRef.current?.focus();
      }
      onCloseRef.current(false);
    };
    const onWindowBlur = (event: FocusEvent) => {
      if (event.target === window) {
        onCloseRef.current(false);
      }
    };
    // O foco saiu do menu e do botao para outro controle da sala (um atalho, o Tab da trava). Sem o destino (o WebKit,
    // que tira o foco da opcao no toque do proprio botao sem foca-lo), nada aqui: o toque fora e o botao cuidam disso.
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && !inside(next)) {
        onCloseRef.current(false);
      }
    };
    const trigger = triggerRef.current;
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("blur", onWindowBlur);
    menu?.addEventListener("focusout", onFocusOut);
    trigger?.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("blur", onWindowBlur);
      menu?.removeEventListener("focusout", onFocusOut);
      trigger?.removeEventListener("focusout", onFocusOut);
    };
  }, [open, triggerRef]);

  /** A escolha: a acao, o foco de volta ao botao (antes de o menu sumir) e o fechar. A desligada nao faz nada. */
  function select(item: RoomMenuItem) {
    if (item.disabled) {
      return;
    }
    item.onSelect();
    triggerRef.current?.focus();
    onClose(true);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = menuItems(menuRef.current);
    const step = menuKeyStep({ count: items.length, index: items.indexOf(event.target as HTMLElement), key: event.key });
    if (step.kind === "move") {
      event.preventDefault();
      items[step.index]?.focus();
      return;
    }
    if (step.kind === "close") {
      if (step.refocus) {
        // So o menu fecha: o Esc da sala, que pergunta antes de sair, nao recebe este.
        event.preventDefault();
        event.stopPropagation();
        triggerRef.current?.focus();
      }
      onClose(step.refocus);
    }
  }

  return (
    <div
      aria-label={label}
      className={cn(
        "absolute z-40 w-max min-w-32 max-w-[400px] rounded-[12px] bg-room-menu py-2 shadow-[var(--room-menu-shadow)]",
        MENU_PLACEMENT[placement],
        MENU_ALIGN[align]
      )}
      hidden={!open}
      id={id}
      onKeyDown={onKeyDown}
      ref={menuRef}
      role="menu"
    >
      {groups.map((group, index) => {
        const items = group.items.map((item) => <RoomMenuOption item={item} key={item.key} onSelect={select} />);
        return (
          <Fragment key={index}>
            {index > 0 ? <div className="my-2 h-px bg-room-divider" role="separator" /> : null}
            {group.label ? (
              <div aria-label={group.label} role="group">
                <div aria-hidden="true" className="px-4 py-1 text-xs leading-[18px] text-room-fg-subtle" role="presentation">
                  {group.label}
                </div>
                {items}
              </div>
            ) : (
              items
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

function RoomMenuOption({ item, onSelect }: { item: RoomMenuItem; onSelect: (item: RoomMenuItem) => void }) {
  const Icon = item.icon;
  const checked = Boolean(item.radio && item.checked);
  return (
    <button
      aria-checked={item.radio ? checked : undefined}
      aria-disabled={item.disabled || undefined}
      className={cn(
        "flex h-10 w-full items-center gap-4 pl-4 pr-9 text-left text-sm font-normal leading-5 text-room-fg hover:bg-room-control focus-visible:bg-room-control focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-current max-lg:h-11 [&_svg]:shrink-0",
        checked ? "bg-room-control" : undefined,
        item.disabled ? "text-room-fg-disabled hover:bg-transparent" : undefined
      )}
      {...item.data}
      onClick={() => onSelect(item)}
      role={item.radio ? "menuitemradio" : "menuitem"}
      tabIndex={-1}
      type="button"
    >
      {item.radio ? <span className="flex size-6 items-center justify-center">{checked ? <Check aria-hidden="true" className="size-5" strokeWidth={2} /> : null}</span> : null}
      {Icon ? <Icon aria-hidden="true" className="size-6" strokeWidth={1.75} /> : null}
      <span className="flex-1">{item.label}</span>
    </button>
  );
}
