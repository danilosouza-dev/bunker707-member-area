"use client";

import { BarChart3, ChevronDown, ChevronUp, MessageSquareMore, Pin } from "lucide-react";
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { RoomMessage } from "@/lib/webinar-room-client";
import { RoomMessageItem } from "../room-chat";
import { pinnedClampHint } from "../room-layout-model";
import { useClampToggle } from "../screen/room-pinned";
import { RoomTeamText } from "../screen/room-team-text";
import { verticalChatAnnouncement, verticalChatTail } from "./vertical-model";

// O chat por cima do video na Sala Live vertical (docs/30 §1.6, §1.7 e §9): as ultimas mensagens (as que a sala mostra,
// ja passadas pela traducao), com os mesmos selos Equipe / Apresentador / Assistente e a pendente "Aguardando a equipe";
// a fixada numa linha; a entrada simulada ("Ana M. entrou") logo abaixo; a enquete aberta num botao que abre a gaveta;
// "Ver mais mensagens" abre o chat inteiro na gaveta. A lista e role="log"; o leitor de tela ouve pela regiao polite:
// uma mensagem nova e lida com o prefixo do papel, em rajada so "N mensagens novas"; o que ja estava na tela quando o
// chat abriu (girar o aparelho, fechar a gaveta) nao e lido de novo. O texto tem sombra sobre o degrade da doca.
// A Na tela (especificacao de 10/11/2026, §3.4): a fixada continua na linha de 2 linhas acima do chat, agora com o link
// da equipe clicavel (RoomTeamText) e o toque para Mostrar tudo (no texto, fora do link, ou no botao de 44 px com
// aria-expanded, que so aparece quando o corte esconde alguma coisa: useClampToggle). Com a enquete fixada, o botao de
// enquete diz "Enquete fixada: {pergunta}" e continua la depois da resposta (verticalPollButton, room-layout-model.ts);
// sem ela, a primeira enquete aberta, como antes. A gaveta mostra a area das fixadas no topo (vertical-drawer.tsx).

export type VerticalChatProps = {
  /** A frase de quando o chat nao carregou (no lugar da lista vazia). */
  error: string | null;
  /** A linha "Ana M. entrou" (RoomSimulationJoins layout="vertical"). */
  joins: ReactNode;
  messages: readonly RoomMessage[];
  onMore: () => void;
  onOpenPoll: () => void;
  pinned: RoomMessage | null;
  /**
   * O botao de enquete (abre a gaveta em Enquetes; verticalPollButton): a enquete fixada ("Enquete fixada: {pergunta}",
   * que fica depois da resposta) ou a primeira enquete aberta; nulo, nenhum botao.
   */
  pollButton: { label: string; pinned: boolean } | null;
  replay: boolean;
};

/**
 * A fixada na linha de 2 linhas acima do chat: o nome e o texto, com o link da equipe clicavel. Quando o corte esconde
 * alguma coisa, o toque no texto (fora do link) e o botao de 44 px abrem e fecham o texto inteiro (que rola por dentro
 * acima de 30 % da tela). O corte fica na margem, nunca no recuo (com recuo a terceira linha apareceria embaixo).
 */
function VerticalPinned({ message }: { message: RoomMessage }) {
  const copy = WEBINAR_COPY.sala;
  const naTela = WEBINAR_COPY.naTela.aluno;
  const id = useId();
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const clamp = useClampToggle(textRef, { hint: pinnedClampHint(`${message.displayName} ${message.body}`, 2), resetKey: `${message.id}:${message.body}` });

  function onTextClick(event: MouseEvent<HTMLParagraphElement>) {
    if (clamp.clampable && !(event.target instanceof Element && event.target.closest("a"))) {
      clamp.toggle();
    }
  }

  return (
    <div className="pointer-events-auto flex min-w-0 items-start gap-1.5 rounded-[12px] bg-black/55 pl-3 pr-0.5 text-[13px] leading-5 text-zinc-100" data-testid="room-pinned">
      <Pin aria-hidden="true" className="mt-2.5 size-3.5 shrink-0 text-zinc-300" />
      <p className={cn("my-2 min-w-0 flex-1 break-words", clamp.expanded ? "max-h-[30dvh] overflow-y-auto" : "line-clamp-2")} id={`${id}-t`} onClick={onTextClick} ref={textRef}>
        <span className="sr-only">{copy.fixada}: </span>
        <span className="font-bold text-white">{message.displayName}</span> <RoomTeamText message={message} />
      </p>
      {clamp.clampable ? (
        <button
          aria-controls={`${id}-t`}
          aria-expanded={clamp.expanded}
          aria-label={clamp.expanded ? naTela.mostrarMenos : naTela.mostrarTudo}
          className="grid size-11 shrink-0 place-items-center rounded-full text-zinc-200 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
          data-room-pinned-more=""
          onClick={clamp.toggle}
          type="button"
        >
          {clamp.expanded ? <ChevronUp aria-hidden="true" className="size-4" /> : <ChevronDown aria-hidden="true" className="size-4" />}
        </button>
      ) : null}
    </div>
  );
}

export function VerticalChat({ error, joins, messages, onMore, onOpenPoll, pinned, pollButton, replay }: VerticalChatProps) {
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
      {pinned ? <VerticalPinned key={pinned.id} message={pinned} /> : null}

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

      {pollButton || hidden > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {pollButton ? (
            <button
              className="pointer-events-auto flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-full border border-white/20 bg-black/55 px-3 text-left text-sm font-semibold text-white backdrop-blur-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              onClick={onOpenPoll}
              type="button"
            >
              <BarChart3 aria-hidden="true" className="size-4 shrink-0 text-[var(--accent)]" />
              {pollButton.pinned ? null : <span className="sr-only">{copy.abas.enquetes}: </span>}
              <span className="truncate">{pollButton.label}</span>
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
