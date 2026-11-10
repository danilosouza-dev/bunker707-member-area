"use client";

import { VenetianMask } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { RoomCommentAvatar } from "./room-comment";
import { composerExpandedStep, composerKey, composerLine, type ComposerEvent } from "./room-composer-model";
import { RoomPill } from "./room-pill";

// O campo "Adicione um comentário" do YouTube no chat e nas Perguntas da sala (docs/31, a sala no estilo do YouTube;
// spec §9): so da sala (a gaveta do vertical continua com o campo de antes). Fechado: a faixa com a linha de 1 px em
// cima, o avatar de 24 (as minhas iniciais; a mascara com a Anonima ligada; a pessoa antes do aceite) e o textarea sem
// caixa, de uma linha que cresce ate 100 px, com a linha de 1 px embaixo. Com o foco, a linha de 2 px no tom do texto
// cresce do centro; aberto com rascunho e sem o foco, a linha de 1 px mais forte. Aberto (o foco, ou o texto que ficou),
// embaixo: a dica, e o rodape com a Anonima (so nas Perguntas), o Cancelar e o envio azul (desligado com o campo vazio).
// O aberto e guardado por quem usa o campo (composerExpandedStep), nunca so o :focus-within. Abaixo de lg, a folga do
// iPhone e o texto de 16 px (o Safari da zoom no foco de um campo menor). So tokens --room-*; nenhuma frase aqui.

export type RoomCommentFieldProps = {
  /** A pilula Anonima no rodape (so nas Perguntas, quando a equipe deixou ligada). */
  allowAnonymous?: boolean;
  /** O id do textarea (o console leva o foco a ele depois de uma acao do chat). */
  id?: string;
  anonymous?: boolean;
  ariaLabel: string;
  /** De quem e o campo: o nome para as iniciais; sem nome (antes do aceite), a pessoa; `team`, o icone da equipe (o console). */
  avatar: { kind?: "person" | "team"; name: string | null };
  /** Enviando: o envio gira e fica desligado. */
  busy?: boolean;
  disabled?: boolean;
  expanded: boolean;
  /** A dica (a do Assistente), so com o campo aberto. */
  hint?: ReactNode;
  /** O que vem antes do avatar (o ⋯ do chat, so abaixo de lg, enquanto o celular nao muda). */
  leading?: ReactNode;
  maxLength: number;
  /** "enter": o Enter envia (o chat); "mod-enter": o Ctrl ou o ⌘ com o Enter envia (as Perguntas). */
  mode: "enter" | "mod-enter";
  onAnonymousChange?: (on: boolean) => void;
  /** O Cancelar: quem usa o campo limpa o rascunho (o campo fecha e tira o foco). */
  onCancel: () => void;
  onChange: (value: string) => void;
  onExpandedChange: (expanded: boolean) => void;
  /** A altura da faixa, sempre que muda (para o aviso da sala ficar acima dela). */
  onHeightChange?: (px: number) => void;
  onSubmit: () => void;
  placeholder: string;
  /** A regiao viva de hoje (os erros e os estados), embaixo de tudo, sempre na tela. */
  status?: ReactNode;
  submitLabel: string;
  value: string;
};

/** O teto do campo que cresce: cinco linhas, e depois ele rola. */
const MAX_HEIGHT = 100;

export function RoomCommentField({
  allowAnonymous = false,
  anonymous = false,
  ariaLabel,
  avatar,
  busy = false,
  disabled = false,
  expanded,
  hint = null,
  id,
  leading = null,
  maxLength,
  mode,
  onAnonymousChange,
  onCancel,
  onChange,
  onExpandedChange,
  onHeightChange,
  onSubmit,
  placeholder,
  status = null,
  submitLabel,
  value
}: RoomCommentFieldProps) {
  const sala = WEBINAR_COPY.sala;
  const [focused, setFocused] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const stripRef = useRef<HTMLFormElement | null>(null);
  const line = composerLine({ draft: value, expanded, focused });
  const anonymousOn = allowAnonymous && anonymous;

  // O campo cresce com o texto ate o teto e depois rola.
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) {
      return;
    }
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!onHeightChange || !strip || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => onHeightChange(strip.offsetHeight));
    observer.observe(strip);
    return () => {
      observer.disconnect();
      // A faixa saiu (a frase no lugar do campo, a aba fechada): o aviso nao fica mais acima dela.
      onHeightChange(0);
    };
  }, [onHeightChange]);

  function step(type: ComposerEvent["type"], draft = value) {
    const next = composerExpandedStep(expanded, { draft, type });
    if (next !== expanded) {
      onExpandedChange(next);
    }
  }

  /** O foco saiu da faixa (o Tab que passa pelo rodape continua no campo: o rodape nao some no caminho). */
  function handleBlur(event: FocusEvent<HTMLFormElement>) {
    if (event.relatedTarget instanceof Node && stripRef.current?.contains(event.relatedTarget)) {
      return;
    }
    step("blur");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const action = composerKey({
      blocked: busy || disabled,
      composing: event.nativeEvent.isComposing,
      ctrl: event.ctrlKey,
      key: event.key,
      meta: event.metaKey,
      mode,
      shift: event.shiftKey
    });
    if (action === "submit" || action === "hold") {
      event.preventDefault();
    }
    if (action === "submit") {
      onSubmit();
    }
  }

  function cancel() {
    onCancel();
    step("cancel", "");
    areaRef.current?.blur();
    // O Cancelar some com o rodape: o foco nao fica num botao que saiu da tela.
    if (document.activeElement instanceof HTMLElement && stripRef.current?.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy && !disabled) {
      onSubmit();
    }
  }

  return (
    <form className="shrink-0 border-t border-room-panel-border p-4 max-lg:pb-[max(16px,calc(env(safe-area-inset-bottom)+8px))]" onBlur={handleBlur} onSubmit={submit} ref={stripRef}>
      <div className="mr-4 flex items-start">
        {leading}
        <RoomCommentAvatar kind={anonymousOn ? "anonymous" : (avatar.kind ?? "person")} name={avatar.name ?? undefined} />
        <div className="ml-3 min-w-0 flex-1">
          <div className={cn("relative border-b", line === "draft" ? "border-room-field-line-draft" : "border-room-field-line")}>
            <textarea
              aria-label={ariaLabel}
              className="block w-full resize-none bg-transparent pb-1 text-base leading-[22px] text-room-fg outline-none placeholder:text-room-fg-subtle disabled:text-room-fg-disabled lg:text-sm lg:leading-5"
              disabled={disabled}
              id={id}
              maxLength={maxLength}
              onBlur={() => setFocused(false)}
              onChange={(event) => {
                onChange(event.target.value);
                // Digitar no campo com o foco (depois de um envio pelo Enter) abre de novo o rodape.
                step("focus", event.target.value);
              }}
              onFocus={() => {
                setFocused(true);
                step("focus");
              }}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              ref={areaRef}
              rows={1}
              style={{ maxHeight: MAX_HEIGHT }}
              value={value}
            />
            {/* A linha do foco: 2 px no tom do texto, que cresce do centro; a altura nao pula (cobre a de 1 px). */}
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-x-0 -bottom-px h-0.5 bg-room-fg transition-transform duration-[250ms] motion-reduce:transition-none",
                line === "focus" ? "scale-x-100" : "scale-x-0"
              )}
            />
          </div>
          {expanded ? (
            <>
              {hint ? <div className="mt-1.5 text-xs leading-[18px] text-room-fg-subtle">{hint}</div> : null}
              {/* O clique no rodape nao tira o foco do campo (no Safari o botao nem pega o foco): o rodape fica ate o click. */}
              <div className="mt-2 flex flex-wrap items-center gap-2" onMouseDown={(event) => event.preventDefault()}>
                {allowAnonymous ? (
                  <RoomPill aria-pressed={anonymousOn} icon={VenetianMask} iconFilled={anonymousOn} label={sala.anonima} onClick={() => onAnonymousChange?.(!anonymousOn)} size="s" tone="tonal" />
                ) : null}
                <div className="ml-auto flex items-center gap-2">
                  <RoomPill label={WEBINAR_COPY.admin.cancelar} onClick={cancel} tone="text" />
                  <RoomPill busy={busy} disabled={disabled || busy || !value.trim()} label={submitLabel} tone="cta" type="submit" />
                </div>
              </div>
            </>
          ) : null}
          {status ? <div className="text-xs leading-[18px]">{status}</div> : null}
        </div>
      </div>
    </form>
  );
}

/**
 * A frase que toma o lugar do campo (o silenciado, a sala que nao abriu, a live que acabou): 14/20 no tom de aviso, com
 * a mesma faixa e a mesma folga do iPhone do campo. O `leading` e o ⋯ do chat, so abaixo de lg.
 */
export function RoomCommentFieldNotice({ children, leading = null, testId }: { children: ReactNode; leading?: ReactNode; testId: string }) {
  return (
    <div className="flex shrink-0 items-center border-t border-room-panel-border p-4 max-lg:pb-[max(16px,calc(env(safe-area-inset-bottom)+8px))]">
      {leading}
      <p className="min-w-0 flex-1 text-sm leading-5 text-room-warn-fg" data-testid={testId} role="status">
        {children}
      </p>
    </div>
  );
}
