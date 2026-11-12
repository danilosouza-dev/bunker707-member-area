"use client";

import { useEffect, useRef, useState } from "react";
import { MemberAvatar } from "@/components/member/ui/member-avatar";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { RoomMessage } from "@/lib/webinar-room-client";
import type { RoomKind } from "./room-layout-model";

// As ultimas mensagens do chat em pilulas sobre o palco, com o painel fechado (docs/31 V2-8), nas duas salas do
// desenho normal e tambem no computador, no lugar do chat por cima do palco que so o celular tinha: as 2 ultimas
// (overlayMessages), a mais nova embaixo, numa coluna de ate 380 px centrada entre a borda esquerda do video e a coluna
// de miniaturas do iframe (--room-video-right), a 56 px da base, acima da linha dos selos de baixo (V2-4); no Replay
// mais alto, acima da barra de controles da Bunny; com o aviso da sala no palco, sobem a altura dele e mais 8 px
// (--room-snackbar-offset, do palco). Pilulas de 32 px em preto a 55 % com o avatar de 22 px (a foto do perfil pela
// mesma regra do chat, docs/30 D62 e D82: a da equipe sempre, a do aluno com o aceite em dia, a da pessoa que comenta
// na mensagem do roteiro; sem foto, as iniciais do nome de exibicao), o nome e o texto com reticencias. Iguais nos
// dois temas (ficam sobre o video). Nada aqui recebe o toque: o video e a barra da Bunny por baixo continuam clicaveis.
// O leitor de tela chama a lista pelo nome da aba do painel ("Chat da live" no Replay). Quando aparecem, a sala decide
// (chatPillsShown, room-layout-model.ts).
//
// Cada pilula fica 8 s na tela e some sozinha (pedido do produtor em 12/11/2026, rodada v9 P2: antes ficavam ate a
// pessoa abrir o chat). A contagem comeca quando a mensagem entra na lista do navegador (`pillsStep`, com o relogio do
// navegador, lido so no efeito e no despertador, nunca ao desenhar); no HTML do servidor e na primeira pintura todas
// as mensagens recebidas aparecem e ganham a hora da montagem. A saida e so o sumico (a lista e aria-live: nada anima;
// com "reduzir movimento" nao ha diferenca).

/** Quanto tempo cada pilula fica no palco. */
export const CHAT_PILL_TTL_MS = 8_000;

/**
 * O passo das pilulas, puro: `seenAt` guarda a hora em que cada id entrou na lista (o id sem hora e novo e entra
 * agora). Devolve as horas a guardar (so dos ids de agora), os ids cujo tempo ja passou e em quantos ms o proximo sai
 * (nulo quando nenhum esta na tela).
 */
export function pillsStep(ids: readonly string[], seenAt: ReadonlyMap<string, number>, nowMs: number, ttlMs: number = CHAT_PILL_TTL_MS): { expired: string[]; seen: Map<string, number>; wakeInMs: number | null } {
  const seen = new Map<string, number>();
  const expired: string[] = [];
  let wakeInMs: number | null = null;
  for (const id of ids) {
    const at = seenAt.get(id) ?? nowMs;
    seen.set(id, at);
    const left = at + ttlMs - nowMs;
    if (left <= 0) {
      expired.push(id);
    } else if (wakeInMs === null || left < wakeInMs) {
      wakeInMs = left;
    }
  }
  return { expired, seen, wakeInMs };
}

/** Os ids que ja passaram dos 8 s: a hora de entrada de cada um fica guardada, e um despertador tira o mais velho. */
function useExpiredPills(messages: readonly RoomMessage[]): ReadonlySet<string> {
  const seenRef = useRef<Map<string, number>>(new Map());
  const [expired, setExpired] = useState<ReadonlySet<string>>(() => new Set());
  const key = messages.map((message) => message.id).join("\n");

  useEffect(() => {
    const ids = key === "" ? [] : key.split("\n");
    let timer: number | undefined;
    const arm = () => {
      const step = pillsStep(ids, seenRef.current, Date.now());
      seenRef.current = step.seen;
      if (step.wakeInMs !== null) {
        timer = window.setTimeout(wake, step.wakeInMs + 16);
      }
      return step;
    };
    const wake = () => {
      setExpired(new Set(arm().expired));
    };
    arm();
    return () => window.clearTimeout(timer);
  }, [key]);

  return expired;
}

export function RoomChatPills({ kind, messages }: { kind: RoomKind; messages: readonly RoomMessage[] }) {
  const expired = useExpiredPills(messages);
  const alive = messages.filter((message) => !expired.has(message.id));
  if (alive.length === 0) {
    return null;
  }
  const replay = kind === "replay";
  return (
    <div
      className={cn("pointer-events-none absolute left-0 right-[var(--room-video-right)] z-20 flex justify-center px-3", replay ? "bottom-[calc(5rem+var(--room-snackbar-offset,0px))]" : "bottom-[calc(3.5rem+var(--room-snackbar-offset,0px))]")}
      data-testid="room-chat-pills"
    >
      <ol aria-label={replay ? WEBINAR_COPY.sala.abas.chatDaLive : WEBINAR_COPY.sala.abas.chat} aria-live="polite" className="flex w-full min-w-0 max-w-[380px] flex-col gap-1.5" role="log">
        {alive.map((message) => (
          <li className="flex h-8 min-w-0 items-center gap-2 rounded-full bg-black/55 pl-1.5 pr-3 text-xs text-white" key={message.id}>
            <MemberAvatar className="size-[22px] [&>span]:text-[9px]" imageSrc={message.avatarUrl} name={message.displayName} size="xs" />
            <span className="max-w-[45%] shrink-0 truncate font-semibold">{message.displayName}</span>{" "}
            <span className="min-w-0 truncate">{message.body}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
