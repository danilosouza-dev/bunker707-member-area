"use client";

import { ChartNoAxesColumn, MessageCircleQuestionMark, MessageSquareText, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { ROOM_PANEL_ID } from "./room-bar";
import type { RoomKind, RoomPanelTab } from "./room-layout-model";
import { tabLabel } from "./room-panel";
import { RoomCountBadge } from "./room-ui";

// O trilho a direita da sala no estilo do YouTube (docs/31; a especificacao §6), so a partir de lg e so no desenho
// normal (o vertical 9:16 nunca o monta): uma coluna de 48 px a 16 px da borda direita, com o topo junto com o do
// painel, irmao do aside do painel (que fica hidden fechado) e depois dele no DOM. Cada item e um botao so, de 48 x 64:
// o quadrado de 48 com raio 8 e o icone de 24, e o rotulo 10/16 colado embaixo (600 no item aberto), que pode passar
// 12 px para cada lado; 16 px ate o proximo. O item abre o painel naquela aba e, aberto, fecha (railStep, na sala); o
// estado vai em aria-expanded com o aria-controls do painel (nunca aria-pressed, o padrao do balao). O nome e o rotulo
// visivel; o Chat com mensagens novas de outras pessoas (enquanto o Chat nao esta na tela) leva o contador vermelho no
// canto e o nome "Chat, 3 mensagens novas", que comeca pelo rotulo (WCAG 2.5.3). O Enquetes com enquete aberta tem o
// ponto do acento. O Chat e sempre o primeiro foco da sala a partir de lg (roomFocusTarget escolhe o primeiro na tela).
// Sem dica nem title: o rotulo esta sempre na tela. O anel de foco envolve so o quadrado; o botao inteiro e o clique.
// Cores so pelos tokens --room-*.

const ICONS: Record<RoomPanelTab, LucideIcon> = {
  chat: MessageSquareText,
  enquetes: ChartNoAxesColumn,
  participantes: Users,
  perguntas: MessageCircleQuestionMark
};

export type RoomRailProps = {
  /** O tipo da sala (o rotulo e o nome da aba; o Chat se chama "Chat" tambem no Replay). */
  kind: RoomKind;
  /** O toque num item: a sala decide pelo railStep (abrir naquela aba ou fechar o painel). */
  onItem: (tab: RoomPanelTab) => void;
  /** O painel na tela (roomPanelShown): so entao um item fica aberto. */
  panelShown: boolean;
  /** Ha enquete aberta: o ponto no Enquetes. */
  pollOpen: boolean;
  /** A aba escolhida na sala. */
  tab: RoomPanelTab;
  /** Os itens, pela mesma regra das abas (panelTabsFor). */
  tabs: readonly RoomPanelTab[];
  /** As falas novas da equipe nas perguntas do aluno enquanto a aba Perguntas nao esta na tela (useRoomQuestionNews, D100). */
  questionsNew?: number;
  /** As mensagens novas de outras pessoas enquanto o Chat nao esta na tela (useRoomPanelUnread). */
  unread: number;
};

export function RoomRail({ kind, onItem, panelShown, pollOpen, questionsNew = 0, tab, tabs, unread }: RoomRailProps) {
  const copy = WEBINAR_COPY.salaV2;

  return (
    <nav aria-label={copy.painel.rotulo} className="hidden w-12 shrink-0 flex-col items-center gap-4 lg:ml-2 lg:flex">
      {tabs.map((item) => {
        const Icon = ICONS[item];
        const open = panelShown && tab === item;
        const label = item === "chat" ? WEBINAR_COPY.sala.abas.chat : tabLabel(item, kind);
        const count = item === "chat" && !open ? Math.max(0, Math.floor(unread)) : item === "perguntas" && !open ? Math.max(0, Math.floor(questionsNew)) : 0;
        const news = item === "perguntas" ? copy.perguntas.respostasNovas(count) : WEBINAR_COPY.sala.mensagensNovas(count);
        return (
          <button
            aria-controls={ROOM_PANEL_ID}
            aria-expanded={open}
            aria-label={count > 0 ? copy.trilho.comNovas(label, news) : undefined}
            className="group flex w-12 flex-col items-center outline-none"
            data-room-first-focus={item === "chat" ? "" : undefined}
            data-room-rail={item}
            id={`room-railbtn-${item}`}
            key={item}
            onClick={() => onItem(item)}
            type="button"
          >
            <span
              className={cn(
                "relative grid size-12 place-items-center rounded-[8px] text-room-icon group-hover:bg-room-control-hover group-active:shadow-[inset_0_0_0_999px_var(--room-press-overlay)] group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-room-focus",
                open ? "bg-room-control" : null
              )}
            >
              <Icon aria-hidden="true" className="size-6" strokeWidth={1.75} />
              {item === "chat" || item === "perguntas" ? <RoomCountBadge count={count} ring="bg" /> : null}
              {item === "enquetes" && pollOpen ? (
                <span aria-hidden="true" className="absolute right-1.5 top-1.5 size-2 rounded-full bg-room-accent shadow-[0_0_0_2px_var(--room-bg)]" />
              ) : null}
            </span>
            <span className={cn("-mx-3 block max-w-[72px] truncate text-center text-[10px] leading-4 text-room-fg", open ? "font-semibold" : null)}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
