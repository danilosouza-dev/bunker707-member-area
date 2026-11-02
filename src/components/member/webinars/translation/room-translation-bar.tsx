"use client";

import { Languages } from "lucide-react";
import { useId } from "react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { CHAT_LANGUAGES, type ChatLanguage } from "@/server/webinars/model";
import type { RoomTranslationState } from "../room/use-room-translation";

// A faixa da traducao em cima do chat da sala (docs/30 §1.6, fase 4f): o seletor compacto "Idioma do chat" (Como foi
// escrito, Português, English, Español; a mesma escolha de Perfil › Privacidade, gravada pelo mesmo PUT e valendo na
// hora, sem sair da sala), "Chat traduzido para English" com "Ver original" (a original a um toque; de novo, "Ver
// traducao") e "Traduzindo…" enquanto alguma mensagem mostrada espera o lote. So aparece com a traducao ligada para
// o aluno (ambiente e banco; nunca no "ver como"). A interface da sala segue em portugues; as legendas do video ficam
// de fora. Controles com 44 px de altura no celular (docs/30 §1.7). As cores vem dos tokens do tema da sala (docs/31
// V2-11): a faixa so aparece dentro do dialogo da sala, que leva o data-room-theme.

const ORIGINAL = "original";

type BarState = Pick<RoomTranslationState, "language" | "showOriginal" | "toggleOriginal" | "translated" | "translating"> &
  Partial<Pick<RoomTranslationState, "available" | "chooseError" | "chooseLanguage" | "choosing">>;

export function RoomTranslationBar({ className, state }: { className?: string; state: BarState }) {
  const copy = WEBINAR_COPY.traducao;
  const id = useId();
  const { language } = state;
  if (!state.available) {
    return null;
  }
  const active = Boolean(language) && (state.translated > 0 || state.translating || state.showOriginal);
  const name = language ? copy.idiomas[language] : null;

  return (
    <div className={cn("flex min-h-11 flex-wrap items-center justify-between gap-x-2 border-b border-room-border px-3 text-xs text-room-fg-subtle", className)} data-testid="room-translation">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <Languages aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />
        <span className="truncate">{active && name ? (state.showOriginal ? copy.chatOriginal : copy.chatTraduzido(name)) : copy.idiomaDaSala}</span>
        {active && state.translating && !state.showOriginal ? (
          <span aria-live="polite" className="shrink-0 text-room-fg-subtle">
            {copy.traduzindo}
          </span>
        ) : null}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1">
        {active && (state.translated > 0 || state.showOriginal) ? (
          <button
            aria-pressed={state.showOriginal}
            className="inline-flex min-h-11 shrink-0 items-center rounded-[8px] px-2 font-semibold text-room-fg hover:text-room-fg-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-room-focus"
            onClick={() => state.toggleOriginal?.()}
            type="button"
          >
            {state.showOriginal ? copy.verTraducao : copy.verOriginal}
          </button>
        ) : null}
        <label className="sr-only" htmlFor={`${id}-idioma`}>
          {copy.idiomaDaSala}
        </label>
        <select
          className="min-h-11 rounded-[8px] border border-room-input-border bg-transparent px-2 text-xs font-semibold text-room-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-room-focus disabled:opacity-60"
          data-room-translation-language=""
          disabled={state.choosing}
          id={`${id}-idioma`}
          onChange={(event) => {
            const value = event.currentTarget.value;
            void state.chooseLanguage?.(value === ORIGINAL ? null : (value as ChatLanguage));
          }}
          value={language ?? ORIGINAL}
        >
          <option className="bg-room-surface" value={ORIGINAL}>
            {copy.comoFoiEscrito}
          </option>
          {CHAT_LANGUAGES.map((option) => (
            <option className="bg-room-surface" key={option} lang={option} value={option}>
              {copy.idiomas[option]}
            </option>
          ))}
        </select>
      </span>
      {state.chooseError ? (
        <p aria-live="polite" className="w-full pb-2 text-xs font-medium text-room-warn-fg">
          {state.chooseError}
        </p>
      ) : null}
    </div>
  );
}
