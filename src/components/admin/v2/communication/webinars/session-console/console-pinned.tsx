"use client";

import { Pin } from "lucide-react";
import { Fragment } from "react";
import { RoomPill } from "@/components/member/webinars/room/room-pill";
import { ROOM_FOCUS } from "@/components/member/webinars/room/room-ui";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { linkSegments } from "@/lib/webinar-links";
import type { ConsoleMessage } from "@/server/webinars/console-model";
import { messageHasLinks } from "@/server/webinars/room-model";

// A mensagem fixada no chat do console (a Na tela, docs/30 §2.4 e §8.3; especificacao de 10/11/2026, R1 e §6.2):
// - ConsoleTeamText: o texto de uma mensagem com os enderecos `https://` como link, so na mensagem escrita pela equipe
//   (a mesma regra do aluno, room-model.messageHasLinks: papel Apresentador, Co-apresentador ou Equipe vindo do console
//   ou do roteiro). Mensagem de aluno, persona de aluno do roteiro e o Assistente continuam texto. Cada link abre em outra
//   aba (target _blank, rel noopener noreferrer nofollow), o texto visivel e o proprio endereco e ate 5 por mensagem
//   (src/lib/webinar-links.ts, linkSegments);
// - ConsolePinned: o bloco "Fixada agora" acima da lista do chat, fora da rolagem, com o autor, o texto em ate 2 linhas
//   (com os links), ha quanto tempo esta fixada ("há 2 min", pelo pinned_at e o relogio do console) e o Desafixar (so
//   com a sessao aceitando a equipe, como os circulos da linha). Le a fixada do retrato pela chave (snapshot.pinned),
//   entao aparece tambem para uma mensagem mais velha que as 200 da lista. So tokens --room-*; nenhuma frase aqui.

const naTela = WEBINAR_COPY.naTela;

/** O link da mensagem da equipe: a cor de link da sala, sublinhado, o anel de foco da sala, quebrando em qualquer ponto. */
const LINK = cn("rounded-sm text-room-link underline underline-offset-2 [overflow-wrap:anywhere] hover:no-underline", ROOM_FOCUS);

/** O texto de uma mensagem do chat no console, com os links quando ela e da equipe (`links`). */
export function ConsoleTeamText({ links, text }: { links: boolean; text: string }) {
  return (
    <>
      {linkSegments(text, { links }).map((segment, index) =>
        segment.kind === "link" ? (
          <a className={LINK} data-console-link="" href={segment.href} key={index} rel="noopener noreferrer nofollow" target="_blank">
            {segment.text}
          </a>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        )
      )}
    </>
  );
}

/** O texto de uma mensagem do console: com os links so quando ela e da equipe (messageHasLinks). */
export function consoleMessageBody(message: Pick<ConsoleMessage, "body" | "role" | "source">) {
  return messageHasLinks(message) ? <ConsoleTeamText links text={message.body} /> : message.body;
}

/** Ha quantos minutos inteiros a mensagem esta fixada (nulo sem a hora). */
export function pinnedMinutes(pinnedAt: string | null, nowMs: number): number | null {
  const at = pinnedAt ? Date.parse(pinnedAt) : Number.NaN;
  return Number.isFinite(at) && Number.isFinite(nowMs) ? Math.max(0, Math.floor((nowMs - at) / 60_000)) : null;
}

type ConsolePinnedProps = {
  /** Uma acao desta mensagem em andamento: o Desafixar fica desligado. */
  busy: boolean;
  /** A sessao aceita a equipe (canTeamActOn): sem isso, o bloco so mostra (o console so leitura). */
  canAct: boolean;
  /** O nome do autor como a linha da lista mostra ("Você" na minha). */
  author: string;
  message: ConsoleMessage;
  /** A hora do servidor agora (o relogio do console, a cada segundo). */
  nowMs: number;
  onUnpin: () => void;
};

/** O bloco "Fixada agora" do chat do console, com o Desafixar. */
export function ConsolePinned({ author, busy, canAct, message, nowMs, onUnpin }: ConsolePinnedProps) {
  const minutes = pinnedMinutes(message.pinnedAt, nowMs);
  const titleId = `console-pinned-${message.id}`;

  return (
    <section
      aria-labelledby={titleId}
      className="mb-3 flex min-w-0 shrink-0 items-start gap-3 rounded-[12px] border border-room-border px-3 py-2.5 lg:mx-4"
      data-console-pinned={message.id}
    >
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-xs leading-[18px] text-room-fg-subtle">
          <Pin aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="font-medium text-room-fg" id={titleId}>
            {naTela.chat.fixadaAgora}
          </span>
          {minutes !== null && message.pinnedAt ? (
            <>
              <span aria-hidden="true">·</span>
              <time className="whitespace-nowrap" data-console-pinned-age="" dateTime={message.pinnedAt}>
                {naTela.haTempo(minutes)}
              </time>
            </>
          ) : null}
        </p>
        <p className="mt-0.5 truncate text-xs leading-[18px] font-medium text-room-fg" data-console-pinned-author="">
          {author}
        </p>
        <p className="line-clamp-2 text-sm leading-5 text-room-fg [overflow-wrap:anywhere]" data-console-pinned-body="">
          {consoleMessageBody(message)}
        </p>
      </div>
      {canAct ? <RoomPill className="mt-0.5" disabled={busy} label={naTela.chat.desafixar} onClick={onUnpin} size="s" tone="tonal" /> : null}
    </section>
  );
}
