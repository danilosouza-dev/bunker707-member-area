"use client";

import { Menu } from "@base-ui/react/menu";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// O "⋯" do cartao do sino (ajustes da v3a, docs/24): no canto de cima, a direita, abre um menu pequeno com
// "Excluir notificação" (o unico item por enquanto). A lixeira saiu da linha de baixo, onde gastava uma
// linha inteira e era facil de tocar sem querer. No computador (ponteiro fino) o "⋯" aparece com o mouse
// sobre o cartao, com o foco dentro dele e com o menu aberto (so a opacidade muda: continua no Tab); no
// toque (ponteiro grosso) fica sempre a mostra. Sem o "⋯" quando a equipe nao deixa excluir.
//
// Menu do Base UI (o mesmo primitivo do popover do sino) sem modo modal: a pagina e o painel continuam
// como estao. O menu vai em portal dentro do portal do painel (o toque nele nao fecha o painel). Esc
// fecha so o menu: ouvido no proprio menu, antes do document (o popover do sino e a IA Diretor fecham
// com qualquer Esc la), e o foco volta para o "⋯". Excluir troca o cartao pela linha do Desfazer: o menu
// nao devolve o foco (o painel leva o foco para o Desfazer).

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

/** Visivel no toque; no computador, com o mouse no cartao (`group/card`), o foco dentro dele ou o menu aberto. */
const revealClassName =
  "transition-opacity duration-150 motion-reduce:transition-none pointer-fine:opacity-0 pointer-fine:group-hover/card:opacity-100 pointer-fine:group-focus-within/card:opacity-100 pointer-fine:focus-visible:opacity-100 pointer-fine:data-popup-open:opacity-100";

// Sem `relative` aqui: o lugar (CARD_MENU_POSITION, `absolute`) vem junto e o twMerge ficaria com o ultimo,
// pondo o "⋯" no fluxo da grade do cartao (uma linha a mais, na coluna do circulo). O `absolute` ja segura
// o ::after da area de toque.
const buttonClassName =
  "pointer-events-auto grid size-8 place-items-center rounded-full text-zinc-400 outline-none transition-colors after:absolute after:-inset-1 hover:bg-white/[0.08] hover:text-white data-popup-open:bg-white/[0.08] data-popup-open:text-white motion-reduce:transition-none";

/** Lugar do "⋯": canto de cima a direita, acima do link decorativo do cartao (o titulo reserva o espaco). */
export const CARD_MENU_POSITION = "absolute right-2 top-2 z-[2]";

export function NotificationCardMenu({
  label,
  onHide,
  preview = false
}: {
  /** Nome do "⋯" com o titulo do cartao (cardActionLabels). */
  label: string;
  onHide?: () => void;
  /** Previa do admin: o "⋯" parado e sempre a mostra (mostra que o aluno pode excluir). */
  preview?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [popup, setPopup] = useState<HTMLDivElement | null>(null);
  /** Excluiu: o cartao sai da tela e o painel leva o foco para o Desfazer (o menu nao devolve o foco). */
  const hidingRef = useRef(false);

  // Esc no menu: fecha so ele. Ouvido no proprio elemento: o popover do sino e a IA Diretor escutam no
  // document e fechariam junto.
  useEffect(() => {
    if (!open || !popup) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.isComposing) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }

    popup.addEventListener("keydown", handleKeyDown);
    return () => popup.removeEventListener("keydown", handleKeyDown);
  }, [open, popup]);

  if (preview) {
    return (
      <span aria-hidden="true" className={cn(CARD_MENU_POSITION, buttonClassName, "pointer-events-none")} data-card-more="">
        <MoreHorizontal className="size-4" />
      </span>
    );
  }

  return (
    <Menu.Root modal={false} onOpenChange={setOpen} open={open}>
      <Menu.Trigger aria-label={label} className={cn(CARD_MENU_POSITION, buttonClassName, revealClassName, focusRing)} data-card-more="">
        <MoreHorizontal aria-hidden="true" className="size-4" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" className="z-[191] outline-none" collisionPadding={8} side="bottom" sideOffset={4}>
          <Menu.Popup
            className="min-w-[13rem] origin-[var(--transform-origin)] rounded-[10px] border border-white/10 bg-[#262626] p-1 text-white shadow-[0_16px_40px_rgba(0,0,0,0.55)] outline-none transition-[opacity,transform] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none"
            data-escape-scope="local"
            finalFocus={() => !hidingRef.current}
            ref={setPopup}
          >
            <Menu.Item
              className="flex min-h-10 cursor-pointer select-none items-center gap-2.5 rounded-[6px] px-3 text-sm font-medium text-zinc-100 outline-none data-highlighted:bg-white/10"
              data-card-hide=""
              onClick={() => {
                hidingRef.current = true;
                onHide?.();
              }}
            >
              <Trash2 aria-hidden="true" className="size-4 text-zinc-300" />
              Excluir notificação
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
