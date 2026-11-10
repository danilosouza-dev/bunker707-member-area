"use client";

import { useEffect, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { RoomPill } from "./room-pill";

// O campo de responder dentro do fio de uma pergunta (docs/30 §1.3; decisao do produtor de 10/11/2026), o da resposta
// de um comentario do YouTube: o avatar de 24 de quem responde, o texto com a linha embaixo (a linha clareia com o
// foco) e, a direita, o Cancelar (texto) e o Responder (a pilula de envio, desligada com o campo vazio). Abre ja com o
// foco no texto; o Ctrl ou o ⌘ com o Enter envia; o Esc cancela e nao chega a sala (que perguntaria se quer sair). O
// erro e o estado ficam embaixo, numa regiao viva. Usado na sala (quem perguntou) e no console (a equipe). So tokens
// --room-*; as frases vem de quem chama.

/** O teto do campo que cresce: cinco linhas, e depois ele rola. */
const MAX_HEIGHT = 100;

export type RoomReplyFieldProps = {
  ariaLabel: string;
  /** O avatar de quem responde (RoomCommentAvatar). */
  avatar: ReactNode;
  busy?: boolean;
  disabled?: boolean;
  /** O id do textarea (para o rotulo de fora e os testes). */
  id?: string;
  maxLength: number;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  /** O erro ou o estado, lido por quem usa leitor de tela. */
  status?: string | null;
  submitLabel: string;
  value: string;
};

export function RoomReplyField({ ariaLabel, avatar, busy = false, disabled = false, id, maxLength, onCancel, onChange, onSubmit, placeholder, status = null, submitLabel, value }: RoomReplyFieldProps) {
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  // Abre com o foco no texto (quem clicou em Responder quer escrever).
  useEffect(() => {
    areaRef.current?.focus();
  }, []);

  // O campo cresce com o texto ate o teto.
  useEffect(() => {
    const area = areaRef.current;
    if (area) {
      area.style.height = "auto";
      area.style.height = `${Math.min(area.scrollHeight, MAX_HEIGHT)}px`;
    }
  }, [value]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!busy && !disabled && value.trim()) {
      onSubmit();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      submit();
    }
  }

  return (
    <form className="flex items-start" data-room-reply-field="" onSubmit={submit}>
      {avatar}
      <div className="ml-3 min-w-0 flex-1">
        <div className="border-b border-room-field-line focus-within:border-room-fg">
          <textarea
            aria-label={ariaLabel}
            className="block w-full resize-none bg-transparent pb-1 text-base leading-[22px] text-room-fg outline-none placeholder:text-room-fg-subtle disabled:text-room-fg-disabled lg:text-sm lg:leading-5"
            disabled={disabled || busy}
            id={id}
            maxLength={maxLength}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            ref={areaRef}
            rows={1}
            style={{ maxHeight: MAX_HEIGHT }}
            value={value}
          />
        </div>
        <div className="mt-2 flex items-center justify-end gap-2">
          <RoomPill label={WEBINAR_COPY.admin.cancelar} onClick={onCancel} size="s" tone="text" touch44 />
          <RoomPill busy={busy} disabled={disabled || busy || !value.trim()} label={submitLabel} size="s" tone="cta" touch44 type="submit" />
        </div>
        <p aria-live="polite" className="mt-1 text-xs leading-[18px] text-room-warn-fg empty:mt-0">
          {status ?? ""}
        </p>
      </div>
    </form>
  );
}
