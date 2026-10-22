"use client";

import { SmilePlus } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { REACTION_EMOJI, REACTION_IDS, REACTION_LABELS, type ReactionId } from "@/server/communications/interactions-model";
import { nextReaction } from "./notifications-model";

// Reacao do aluno numa notificacao (docs/24 §1.4), como no WhatsApp: seis emoji fixos, uma por aluno,
// que ele troca ou tira; ele ve so a propria (os numeros ficam no relatorio da equipe). Sem reacao, um
// botao redondo com o rosto; com reacao, a pilula com o emoji. Esc fecha so o seletor: o Esc do painel
// passa reto pelo escopo local (useEscapeToClose) e o daqui para no proprio seletor, antes do document
// (a IA Diretor e o popover escutam la). So desenha: quem grava e o painel.
//
// Ajustes da v3a: o gatilho (ou a pilula) fica no fim da linha dos botoes do cartao (Acessar, ou
// Aceitar/Recusar) ou, sem ela, no fim da linha de quem envia; o seletor abre numa linha logo abaixo
// (seis botoes de 40 px cabem nos 267 px da coluna a 375 px). Por isso o estado fica num hook
// (useReactionPicker) e o cartao desenha o gatilho e o seletor cada um no seu lugar.

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

export type ReactionPicker = {
  /** Fecha o seletor; `focusTrigger` devolve o foco ao gatilho (teclado ou escolha). */
  close: (focusTrigger: boolean) => void;
  open: boolean;
  /** Escolheu um emoji: troca, ou tira quando era o que ja estava. */
  pick: (id: ReactionId) => void;
  pickerId: string;
  /** Guarda o botao de cada emoji (o foco entra na reacao atual, ou em Gostei). */
  setOption: (id: ReactionId, node: HTMLButtonElement | null) => void;
  /** Ref do seletor (o Esc e o toque fora sao ouvidos nele). */
  setPicker: (node: HTMLDivElement | null) => void;
  /** Ref do gatilho (o foco volta para ele; o toque nele nao conta como fora). */
  setTrigger: (node: HTMLButtonElement | null) => void;
  /** Toque no gatilho: abre, ou fecha quando ja esta aberto. */
  toggle: () => void;
};

/** Estado do seletor de reacoes do cartao: foco, Esc so dele e o toque fora (o gatilho nao conta como fora). */
export function useReactionPicker({ onReact, value }: { onReact?: (next: ReactionId | null) => void; value: ReactionId | null }): ReactionPicker {
  const [open, setOpen] = useState(false);
  const pickerId = useId();
  // Elementos em estado (nao em ref): o gatilho e o seletor sao desenhados pelo cartao, cada um num lugar.
  const [picker, setPicker] = useState<HTMLDivElement | null>(null);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const optionRefs = useRef(new Map<ReactionId, HTMLButtonElement>());
  const focusOptionRef = useRef<ReactionId>("like");
  const focusTriggerRef = useRef(false);

  function openPicker() {
    focusOptionRef.current = value ?? "like";
    setOpen(true);
  }

  function close(focusTrigger: boolean) {
    focusTriggerRef.current = focusTrigger;
    setOpen(false);
  }

  // Abriu: foco na reacao atual (ou em Gostei). Fechou pelo teclado ou escolhendo: foco de volta no
  // gatilho (o botao ou a pilula, que pode ter acabado de trocar).
  useEffect(() => {
    if (open) {
      optionRefs.current.get(focusOptionRef.current)?.focus();
      return;
    }

    if (focusTriggerRef.current) {
      focusTriggerRef.current = false;
      trigger?.focus();
    }
  }, [open, trigger]);

  // Esc no seletor: fecha so ele. Ouvido no proprio elemento (o React e o popover escutam no document,
  // e o stopPropagation aqui impede os dois). Tocar fora fecha sem mexer no foco; o Tab nao fecha.
  useEffect(() => {
    if (!open || !picker) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.isComposing) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      focusTriggerRef.current = true;
      setOpen(false);
    }

    // O gatilho nao conta como fora: tocar nele com o seletor aberto fecha pelo proprio clique (toggle).
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !picker?.contains(event.target) && !trigger?.contains(event.target)) {
        focusTriggerRef.current = false;
        setOpen(false);
      }
    }

    picker.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      picker.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [open, picker, trigger]);

  function pick(id: ReactionId) {
    onReact?.(nextReaction(value, id));
    close(true);
  }

  function setOption(id: ReactionId, node: HTMLButtonElement | null) {
    if (node) {
      optionRefs.current.set(id, node);
    } else {
      optionRefs.current.delete(id);
    }
  }

  function toggle() {
    if (open) {
      close(true);
    } else {
      openPicker();
    }
  }

  return { close, open, pick, pickerId, setOption, setPicker, setTrigger, toggle };
}

/**
 * Gatilho das reacoes, no fim da linha dos botoes ou da linha de quem envia: sem reacao, o rosto com o
 * "+"; com reacao, a pilula com o emoji (como no WhatsApp). Os dois abrem o mesmo seletor.
 */
export function NoticeReactionTrigger({
  className,
  labels,
  picker,
  preview = false,
  value
}: {
  className?: string;
  /** Nomes com o titulo do cartao (cardActionLabels). */
  labels: { react: string; reaction: string | null };
  picker: ReactionPicker;
  /** Previa do admin: o botao parado, sem seletor. */
  preview?: boolean;
  value: ReactionId | null;
}) {
  const { open, pickerId, setTrigger, toggle } = picker;
  const triggerClassName = cn(
    "pointer-events-auto relative inline-flex h-8 shrink-0 items-center justify-center rounded-full transition-colors after:absolute after:-inset-1 motion-reduce:transition-none",
    focusRing,
    className
  );

  if (value) {
    const pillClassName = cn(
      triggerClassName,
      // Pilula pequena (28 px, area de toque de 40 px), como a reacao no WhatsApp.
      "h-7 border border-white/15 bg-white/[0.08] px-2 after:-inset-1.5 hover:bg-white/[0.12]",
      open && "border-white/30 bg-white/[0.14]"
    );
    const emoji = (
      <span aria-hidden="true" className="text-[16px] leading-none">
        {REACTION_EMOJI[value]}
      </span>
    );

    return preview ? (
      <span className={pillClassName}>{emoji}</span>
    ) : (
      <button
        aria-controls={open ? pickerId : undefined}
        aria-expanded={open}
        aria-label={labels.reaction ?? labels.react}
        className={pillClassName}
        onClick={toggle}
        ref={setTrigger}
        type="button"
      >
        {emoji}
      </button>
    );
  }

  const buttonClassName = cn(
    triggerClassName,
    "size-8 text-zinc-400 hover:bg-white/[0.07] hover:text-white",
    open && "bg-white/[0.1] text-white"
  );
  const icon = <SmilePlus aria-hidden="true" className="size-4" />;

  return preview ? (
    <span aria-hidden="true" className={buttonClassName}>
      {icon}
    </span>
  ) : (
    <button
      aria-controls={open ? pickerId : undefined}
      aria-expanded={open}
      aria-label={labels.react}
      className={buttonClassName}
      onClick={toggle}
      ref={setTrigger}
      type="button"
    >
      {icon}
    </button>
  );
}

/** O seletor (seis emoji de 40 px numa linha, logo abaixo da linha do gatilho), so com ele aberto. */
export function NoticeReactionPicker({ picker, value }: { picker: ReactionPicker; value: ReactionId | null }): ReactNode {
  const { open, pick, pickerId, setOption, setPicker } = picker;

  if (!open) {
    return null;
  }

  return (
    <div
      aria-label="Escolha uma reação"
      className="pointer-events-auto mt-2 flex h-10 gap-1"
      data-escape-scope="local"
      id={pickerId}
      ref={setPicker}
      role="group"
    >
      {REACTION_IDS.map((id) => (
        <button
          aria-label={REACTION_LABELS[id]}
          aria-pressed={value === id}
          className={cn(
            "grid size-10 place-items-center rounded-full text-[22px] leading-none transition-colors hover:bg-white/10 motion-reduce:transition-none",
            value === id && "bg-white/15 ring-1 ring-white/40",
            focusRing
          )}
          key={id}
          onClick={() => pick(id)}
          ref={(node) => setOption(id, node)}
          type="button"
        >
          <span aria-hidden="true">{REACTION_EMOJI[id]}</span>
        </button>
      ))}
    </div>
  );
}
