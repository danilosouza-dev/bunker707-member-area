"use client";

import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Excluir do canto do cartao do sino (ajustes da v3a, docs/24 §10.3): um botao pequeno no canto de cima, a
// direita, que exclui na hora; o "Desfazer" da linha que fica no lugar do cartao traz de volta. A lixeira
// saiu da linha de baixo, onde gastava uma linha inteira e era facil de tocar sem querer. No computador
// (ponteiro fino) aparece com o mouse sobre o cartao ou com o foco dentro dele (so a opacidade muda:
// continua no Tab); no toque (ponteiro grosso) fica sempre a mostra. Sem ele quando a equipe nao deixa
// excluir.
//
// Antes era um "⋯" com um menu de um item so: um toque a mais, e o menu dentro do popover do sino perdia
// o foco no Safari (o Esc fechava o painel inteiro). Um botao direto resolve os dois.

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

/** Visivel no toque; no computador, com o mouse no cartao (`group/card`) ou o foco dentro dele. */
const revealClassName =
  "transition-opacity duration-150 motion-reduce:transition-none pointer-fine:opacity-0 pointer-fine:group-hover/card:opacity-100 pointer-fine:group-focus-within/card:opacity-100 pointer-fine:focus-visible:opacity-100";

// Sem `relative` aqui: o lugar (CARD_DELETE_POSITION, `absolute`) vem junto e o twMerge ficaria com o
// ultimo, pondo o botao no fluxo da grade do cartao. O `absolute` ja segura o ::after da area de toque.
const buttonClassName =
  "pointer-events-auto grid size-8 place-items-center rounded-full text-zinc-400 outline-none transition-colors after:absolute after:-inset-1 hover:bg-white/[0.08] hover:text-white motion-reduce:transition-none";

/** Lugar do botao: canto de cima a direita, acima do link decorativo do cartao (o titulo reserva o espaco). */
export const CARD_DELETE_POSITION = "absolute right-2 top-2 z-[2]";

export function NotificationCardDelete({
  label,
  onHide,
  preview = false
}: {
  /** Nome do botao com o titulo do cartao (cardActionLabels). */
  label: string;
  onHide?: () => void;
  /** Previa do admin: o botao parado e sempre a mostra (mostra que o aluno pode excluir). */
  preview?: boolean;
}) {
  if (preview) {
    return (
      <span aria-hidden="true" className={cn(CARD_DELETE_POSITION, buttonClassName, "pointer-events-none")} data-card-delete="">
        <Trash2 className="size-4" />
      </span>
    );
  }

  return (
    <button
      aria-label={label}
      className={cn(CARD_DELETE_POSITION, buttonClassName, revealClassName, focusRing)}
      data-card-delete=""
      onClick={onHide}
      title="Excluir notificação"
      type="button"
    >
      <Trash2 aria-hidden="true" className="size-4" />
    </button>
  );
}
