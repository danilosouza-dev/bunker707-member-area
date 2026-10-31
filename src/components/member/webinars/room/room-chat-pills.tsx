import { MemberAvatar } from "@/components/member/ui/member-avatar";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { RoomMessage } from "@/lib/webinar-room-client";
import type { RoomKind } from "./room-layout-model";

// As ultimas mensagens do chat em pilulas sobre o palco, com o painel fechado (docs/31 V2-8), nas duas salas do
// desenho normal e tambem no computador, no lugar do chat por cima do palco que so o celular tinha: as 2 ultimas
// (overlayMessages), a mais nova embaixo, numa coluna de ate 380 px centrada entre a borda esquerda do video e a coluna
// de miniaturas do iframe (--room-video-right), a 56 px da base, acima da linha dos selos de baixo (V2-4); no Replay
// mais alto, acima da barra de controles da Bunny. Pilulas de 32 px em preto a 55 % com o avatar de 22 px (so as
// iniciais do nome de exibicao, docs/30 §8.5), o nome e o texto com reticencias. Iguais nos dois temas (ficam sobre o
// video). Nada aqui recebe o toque: o video e a barra da Bunny por baixo continuam clicaveis. O leitor de tela chama a
// lista pelo nome da aba do painel ("Chat da live" no Replay). Quando aparecem, a sala decide (chatPillsShown,
// room-layout-model.ts).

export function RoomChatPills({ kind, messages }: { kind: RoomKind; messages: readonly RoomMessage[] }) {
  if (messages.length === 0) {
    return null;
  }
  const replay = kind === "replay";
  return (
    <div
      className={cn("pointer-events-none absolute left-0 right-[var(--room-video-right)] z-20 flex justify-center px-3", replay ? "bottom-20" : "bottom-14")}
      data-testid="room-chat-pills"
    >
      <ol aria-label={replay ? WEBINAR_COPY.sala.abas.chatDaLive : WEBINAR_COPY.sala.abas.chat} aria-live="polite" className="flex w-full min-w-0 max-w-[380px] flex-col gap-1.5" role="log">
        {messages.map((message) => (
          <li className="flex h-8 min-w-0 items-center gap-2 rounded-full bg-black/55 pl-1.5 pr-3 text-xs text-white" key={message.id}>
            <MemberAvatar className="size-[22px] [&>span]:text-[9px]" name={message.displayName} size="xs" />
            <span className="max-w-[45%] shrink-0 truncate font-semibold">{message.displayName}</span>{" "}
            <span className="min-w-0 truncate">{message.body}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
