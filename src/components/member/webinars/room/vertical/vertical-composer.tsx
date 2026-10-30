"use client";

import { MessageSquare, MessageSquareOff, MessagesSquare, SendHorizontal, SmilePlus } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { composerState } from "@/lib/webinar-room-client";
import { CHAT_CONSENT_VERSION, CHAT_LIMITS, type ChatMode, type DisplayNameMode, type Reaction, type SimulatedPhase } from "@/server/webinars/model";
import type { ChatPostBody } from "../room-api";
import { RoomConsentBox } from "../room-chat";
import { RoomReactionBar } from "../room-reactions";
import { verticalComposerHint } from "./vertical-model";

// O rodape da Sala Live vertical (docs/30 §1.6, §8.5 e §9): o campo compacto ("Comente…") com Enviar, Abrir/Fechar o
// chat, Reagir (abre a barra das seis reacoes) e a gaveta de Perguntas e enquetes, todos com 44 px. O envio e o mesmo
// do chat da sala (onSend, que chama chat.send da sala): na primeira mensagem sem o aceite abre o MESMO aceite do chat
// (RoomConsentBox, o texto de §8.5, "Entendi e quero participar" e "Participar como anonimo"); o modo lento, o chat
// desligado, so a equipe e a sessao encerrada aparecem como na sala normal. O campo usa 16 px (o iPhone nao amplia a
// pagina ao tocar). No "ver como" da equipe o campo fica desligado com a frase de sempre.

export type VerticalComposerProps = {
  chatMode: ChatMode;
  chatOpen: boolean;
  consented: boolean;
  defaultDisplayMode: DisplayNameMode;
  /** O id da gaveta (aria-controls do botao). */
  drawerId: string;
  drawerOpen: boolean;
  nowMs: number;
  onOpenDrawer: () => void;
  onReact: (reaction: Reaction) => void;
  onSend: (body: Omit<ChatPostBody, "sessionId">) => Promise<{ pending: boolean }>;
  onToggleChat: () => void;
  phase: SimulatedPhase | "replay";
  reactionsDisabled: boolean;
  readOnly: boolean;
  slowUntilMs: number | null;
};

export function VerticalComposer(props: VerticalComposerProps) {
  const { chatMode, chatOpen, consented, defaultDisplayMode, drawerId, drawerOpen, nowMs, onOpenDrawer, onReact, onSend, onToggleChat, phase, reactionsDisabled, readOnly, slowUntilMs } = props;
  const copy = WEBINAR_COPY.sala;
  const vcopy = WEBINAR_COPY.vertical;
  const reactionsId = useId();
  const [draft, setDraft] = useState("");
  const [consentOpen, setConsentOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const state = composerState({ chatMode, consented, nowMs, phase, slowUntilMs });
  const hint = verticalComposerHint(state, phase);
  const line = status ?? (readOnly ? WEBINAR_COPY.aluno.previaSemGravar : hint);

  async function deliver(extra: Partial<ChatPostBody> = {}) {
    const text = draft.trim();
    if (!text || readOnly) {
      return;
    }
    setSending(true);
    setStatus(null);
    try {
      const answer = await onSend({ body: text, kind: "message", ...extra });
      setDraft("");
      setConsentOpen(false);
      setStatus(answer.pending ? copy.aguardandoEquipe : null);
    } catch (failure) {
      setStatus(failure instanceof Error ? failure.message : copy.erroEnviar);
    } finally {
      setSending(false);
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (state.disabled || readOnly || !draft.trim()) {
      return;
    }
    if (!consented) {
      setConsentOpen(true);
      return;
    }
    void deliver();
  }

  return (
    <div className="pointer-events-auto flex min-w-0 flex-col gap-2" data-room-vertical-composer="">
      {consentOpen && !consented && chatOpen ? (
        <div className="max-h-[45dvh] overflow-y-auto overscroll-contain rounded-[14px] border border-white/10 [text-shadow:none]">
          <RoomConsentBox
            busy={sending}
            defaultDisplayMode={defaultDisplayMode}
            onAccept={(choice) =>
              void deliver({
                anonymous: choice.displayMode === "anonymous",
                consent: true,
                consentVersion: CHAT_CONSENT_VERSION,
                displayMode: choice.displayMode,
                ...(choice.displayMode === "nickname" ? { nickname: choice.nickname } : {})
              })
            }
            onCancel={() => setConsentOpen(false)}
          />
        </div>
      ) : null}

      {reactionsOpen ? (
        <div className="w-fit max-w-full self-end rounded-full bg-black/55 backdrop-blur-sm" id={reactionsId}>
          <RoomReactionBar disabled={reactionsDisabled} onReact={onReact} />
        </div>
      ) : null}

      <p aria-live="polite" className={cn("min-w-0 px-1 text-xs", line ? (status && status !== copy.aguardandoEquipe ? "text-amber-200" : "text-zinc-200") : "sr-only")}>
        {line}
      </p>

      <form className="flex min-w-0 items-center gap-1.5" onSubmit={submit}>
        <button
          aria-label={chatOpen ? vcopy.fecharChat : vcopy.abrirChat}
          className={iconButtonClassName}
          data-room-first-focus=""
          onClick={onToggleChat}
          title={chatOpen ? vcopy.fecharChat : vcopy.abrirChat}
          type="button"
        >
          {chatOpen ? <MessageSquareOff aria-hidden="true" className="size-5" /> : <MessageSquare aria-hidden="true" className="size-5" />}
        </button>
        {chatOpen ? (
          <>
            <input
              aria-label={copy.escreva}
              autoComplete="off"
              className="h-11 min-w-0 flex-1 rounded-full border border-white/20 bg-black/45 px-4 text-base text-white outline-none backdrop-blur-sm placeholder:text-white/65 focus-visible:border-white/60 disabled:opacity-50"
              disabled={state.disabled || readOnly}
              enterKeyHint="send"
              maxLength={CHAT_LIMITS.body}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={hint || vcopy.escreva}
              type="text"
              value={draft}
            />
            <button aria-label={copy.enviar} className={cn(iconButtonClassName, "bg-white text-black hover:bg-zinc-200")} disabled={state.disabled || readOnly || sending || !draft.trim()} type="submit">
              <SendHorizontal aria-hidden="true" className="size-5" />
            </button>
          </>
        ) : (
          <span aria-hidden="true" className="min-w-0 flex-1" />
        )}
        <button
          aria-controls={reactionsOpen ? reactionsId : undefined}
          aria-expanded={reactionsOpen}
          aria-label={copy.reagir}
          className={iconButtonClassName}
          onClick={() => setReactionsOpen((open) => !open)}
          title={copy.reagir}
          type="button"
        >
          <SmilePlus aria-hidden="true" className="size-5" />
        </button>
        <button
          aria-controls={drawerOpen ? drawerId : undefined}
          aria-expanded={drawerOpen}
          aria-label={vcopy.gaveta}
          className={iconButtonClassName}
          data-room-drawer-toggle=""
          onClick={onOpenDrawer}
          title={vcopy.gaveta}
          type="button"
        >
          <MessagesSquare aria-hidden="true" className="size-5" />
        </button>
      </form>
    </div>
  );
}

const iconButtonClassName =
  "grid size-11 shrink-0 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-40 motion-reduce:transition-none";
