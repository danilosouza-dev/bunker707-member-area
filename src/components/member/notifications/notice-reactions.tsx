"use client";

import { SmilePlus } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { REACTION_EMOJI, REACTION_IDS, REACTION_LABELS, type ReactionId } from "@/server/communications/interactions-model";
import { nextReaction } from "./notifications-model";

// Reacao do aluno numa notificacao (docs/24 §1.4), como no WhatsApp: seis emoji fixos, uma por aluno,
// que ele troca ou tira; ele ve so a propria (os numeros ficam no relatorio da equipe). Sem reacao, um
// botao redondo com o rosto; com reacao, a pilula com o emoji. O seletor abre no lugar da linha de
// acoes inteira (a lixeira some enquanto ele esta aberto: seis botoes de 40 px cabem nos 267 px da
// coluna a 375 px so com a linha so para eles). Esc fecha so o seletor: o Esc do painel passa reto
// pelo escopo local (useEscapeToClose) e o daqui para no proprio seletor, antes do document (a IA
// Diretor e o popover escutam la). So desenha: quem grava e o painel.

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

export function NoticeReactions({
  error,
  labels,
  onReact,
  preview = false,
  trailing,
  value
}: {
  /** Erro da ultima escrita (role="alert", embaixo da linha). */
  error?: string | null;
  /** Nomes com o titulo do cartao (cardActionLabels). */
  labels: { react: string; reaction: string | null };
  onReact?: (next: ReactionId | null) => void;
  /** Previa do admin: o botao parado, sem seletor. */
  preview?: boolean;
  /** O resto da linha de acoes (a lixeira), que some com o seletor aberto. */
  trailing?: ReactNode;
  value: ReactionId | null;
}) {
  const [open, setOpen] = useState(false);
  const pickerId = useId();
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
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
  // gatilho (o botao ou a pilula, que acabou de voltar para a tela).
  useEffect(() => {
    if (open) {
      optionRefs.current.get(focusOptionRef.current)?.focus();
      return;
    }

    if (focusTriggerRef.current) {
      focusTriggerRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  // Esc no seletor: fecha so ele. Ouvido no proprio elemento (o React e o popover escutam no document,
  // e o stopPropagation aqui impede os dois). Tocar fora fecha sem mexer no foco; o Tab nao fecha.
  useEffect(() => {
    const picker = pickerRef.current;

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

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !picker?.contains(event.target)) {
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
  }, [open]);

  function pick(id: ReactionId) {
    onReact?.(nextReaction(value, id));
    close(true);
  }

  const triggerClassName = cn(
    "pointer-events-auto relative inline-flex h-8 items-center justify-center rounded-full transition-colors after:absolute after:-inset-1 motion-reduce:transition-none",
    focusRing
  );

  let trigger: ReactNode;

  if (value) {
    const pillClassName = cn(triggerClassName, "border border-white/15 bg-white/[0.08] px-2.5 hover:bg-white/[0.12]");
    const emoji = (
      <span aria-hidden="true" className="text-[18px] leading-none">
        {REACTION_EMOJI[value]}
      </span>
    );

    trigger = preview ? (
      <span className={pillClassName}>{emoji}</span>
    ) : (
      <button
        aria-controls={pickerId}
        aria-expanded={false}
        aria-label={labels.reaction ?? labels.react}
        className={pillClassName}
        onClick={openPicker}
        ref={triggerRef}
        type="button"
      >
        {emoji}
      </button>
    );
  } else {
    const buttonClassName = cn(triggerClassName, "size-8 text-zinc-400 hover:bg-white/[0.07] hover:text-white");
    const icon = <SmilePlus aria-hidden="true" className="size-4" />;

    trigger = preview ? (
      <span aria-hidden="true" className={buttonClassName}>
        {icon}
      </span>
    ) : (
      <button
        aria-controls={pickerId}
        aria-expanded={false}
        aria-label={labels.react}
        className={buttonClassName}
        onClick={openPicker}
        ref={triggerRef}
        type="button"
      >
        {icon}
      </button>
    );
  }

  return (
    <>
      <div className={cn("mt-2 flex items-center justify-between", open ? "h-10" : "min-h-8")}>
        {open ? (
          <div
            aria-label="Escolha uma reação"
            className="pointer-events-auto flex h-10 gap-1"
            data-escape-scope="local"
            id={pickerId}
            ref={pickerRef}
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
                ref={(node) => {
                  if (node) {
                    optionRefs.current.set(id, node);
                  } else {
                    optionRefs.current.delete(id);
                  }
                }}
                type="button"
              >
                <span aria-hidden="true">{REACTION_EMOJI[id]}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            {trigger}
            {trailing}
          </>
        )}
      </div>
      {error ? (
        <p className="mt-1 text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
