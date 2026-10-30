"use client";

import { BarChart3, MessageSquareMore, Pin } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { RoomMessage } from "@/lib/webinar-room-client";
import { RoomMessageItem } from "../room-chat";
import { verticalChatAnnouncement, verticalChatTail } from "./vertical-model";

// O chat por cima do video na Sala Live vertical (docs/30 §1.6, §1.7 e §9): as ultimas mensagens (as que a sala mostra,
// ja passadas pela traducao), com os mesmos selos Equipe / Apresentador / Assistente e a pendente "Aguardando a equipe";
// a fixada numa linha; a entrada simulada ("Ana M. entrou") logo abaixo; a enquete aberta num botao que abre a gaveta;
// "Ver mais mensagens" abre o chat inteiro na gaveta. A lista e role="log"; o leitor de tela ouve pela regiao polite:
// uma mensagem nova e lida com o prefixo do papel, em rajada so "N mensagens novas"; o que ja estava na tela quando o
// chat abriu (girar o aparelho, fechar a gaveta) nao e lido de novo. O texto tem sombra sobre o degrade da doca.

export type VerticalChatProps = {
  /** A frase de quando o chat nao carregou (no lugar da lista vazia). */
  error: string | null;
  /** A linha "Ana M. entrou" (RoomSimulationJoins layout="vertical"). */
  joins: ReactNode;
  messages: readonly RoomMessage[];
  onMore: () => void;
  onOpenPoll: () => void;
  /** A pergunta da enquete aberta (o botao abre a gaveta em Enquetes). */
  openPollQuestion: string | null;
  pinned: RoomMessage | null;
  replay: boolean;
};

export function VerticalChat({ error, joins, messages, onMore, onOpenPoll, openPollQuestion, pinned, replay }: VerticalChatProps) {
  const copy = WEBINAR_COPY.sala;
  const vcopy = WEBINAR_COPY.vertical;
  const { hidden, tail } = verticalChatTail(messages);
  const [announce, setAnnounce] = useState("");
  const listRef = useRef<HTMLOListElement | null>(null);
  const stickRef = useRef(true);
  // O que ja esta na tela ao abrir nao e anunciado de novo (so o que chega depois).
  const [known] = useState(() => new Set(messages.map((message) => message.id)));

  useEffect(() => {
    const list = listRef.current;
    if (list && stickRef.current) {
      list.scrollTop = list.scrollHeight;
    }
    const fresh = messages.filter((message) => !known.has(message.id));
    if (fresh.length === 0) {
      return;
    }
    // A frase vai para a regiao polite no proximo quadro (sem setState sincrono no efeito). As que chegam antes dele
    // entram juntas na mesma frase (o quadro anterior e cancelado e as mensagens ainda nao contam como lidas).
    const id = window.requestAnimationFrame(() => {
      fresh.forEach((message) => known.add(message.id));
      setAnnounce(verticalChatAnnouncement(fresh));
    });
    return () => window.cancelAnimationFrame(id);
  }, [known, messages]);

  /** A lista so desce sozinha quando o aluno esta no fim (subiu para ler: fica onde esta). */
  function handleScroll() {
    const list = listRef.current;
    if (list) {
      stickRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 32;
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-1.5 [text-shadow:0_1px_2px_rgba(0,0,0,0.85)]" data-room-vertical-chat="">
      {pinned ? (
        <p className="pointer-events-auto flex min-w-0 items-start gap-1.5 rounded-[12px] bg-black/55 px-3 py-1.5 text-[13px] leading-5 text-zinc-100" data-testid="room-pinned">
          <Pin aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-zinc-300" />
          <span className="sr-only">{copy.fixada}: </span>
          <span className="line-clamp-2 min-w-0 break-words">
            <span className="font-bold text-white">{pinned.displayName}</span> {pinned.body}
          </span>
        </p>
      ) : null}

      <ol
        aria-label={replay ? copy.abas.chatDaLive : copy.abas.chat}
        aria-live="off"
        className="pointer-events-auto max-h-[32dvh] min-w-0 space-y-0.5 overflow-y-auto overscroll-contain [mask-image:linear-gradient(to_bottom,transparent,black_1.5rem)]"
        onScroll={handleScroll}
        ref={listRef}
        role="log"
        tabIndex={0}
      >
        {/* Por cima do video, a lista vazia fica vazia; so a falha ao carregar aparece. */}
        {tail.length === 0 && error ? <li className="px-2 py-1 text-sm text-amber-100">{error}</li> : null}
        {tail.map((message) => (
          <RoomMessageItem key={message.id} message={message} />
        ))}
      </ol>
      <p aria-live="polite" className="sr-only" data-room-vertical-announce="">
        {announce}
      </p>

      {joins}

      {openPollQuestion || hidden > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {openPollQuestion ? (
            <button
              className="pointer-events-auto flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-full border border-white/20 bg-black/55 px-3 text-left text-sm font-semibold text-white backdrop-blur-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              onClick={onOpenPoll}
              type="button"
            >
              <BarChart3 aria-hidden="true" className="size-4 shrink-0 text-[var(--accent)]" />
              <span className="sr-only">{copy.abas.enquetes}: </span>
              <span className="truncate">{openPollQuestion}</span>
            </button>
          ) : null}
          {hidden > 0 ? (
            <button
              className="pointer-events-auto inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-black/45 px-3 text-xs font-semibold text-white backdrop-blur-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              onClick={onMore}
              type="button"
            >
              <MessageSquareMore aria-hidden="true" className="size-4" />
              {vcopy.maisMensagens}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
