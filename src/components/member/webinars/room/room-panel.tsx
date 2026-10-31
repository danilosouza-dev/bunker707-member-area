"use client";

import { X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { RoomMessage } from "@/lib/webinar-room-client";
import { unreadCount, type RoomKind, type RoomPanelTab } from "./room-layout-model";
import { ROOM_FOCUS, RoomIconButton } from "./room-ui";

// O painel da sala (docs/31 V2-7 e V2-8), o mesmo na Live ao vivo, na gravada e no Replay (desenho normal): a partir
// de lg, uma coluna de 320 px com a linha das abas em pilula (a lista com recuo de 4 px; cada aba de 40 px, 13 px; a
// escolhida no fundo claro do tema) e o X redondo de 40 px "Fechar o painel" no fim da linha, e embaixo a aba escolhida
// num cartao com os cantos de Marca › Estilo (--member-cover-radius). Abaixo de lg o painel fica embaixo da barra: as
// abas em pilula no topo (44 px, abas de 34 px), sem o X (o balao da barra, logo acima, abre e fecha) e sem a aba de
// baixo que abria e fechava o painel. Fechado, o aside fica escondido (hidden) e montado: o rascunho, o aceite e a
// aba continuam; trocar de aba desmonta a de antes. As abas saem da regra unica panelTabsFor (room-layout-model.ts).
// O contador de mensagens novas do balao (useRoomPanelUnread) conta o que chegou desde que o painel fechou. Cores pelos
// tokens do tema da sala; o acento so no ponto da aba Enquetes com enquete aberta.

export type RoomPanelProps = {
  /** O conteudo da aba escolhida. */
  children: ReactNode;
  /** As classes do esqueleto (roomSkeleton): o painel ocupa a coluna no celular, ou nao (Modo cinema, fechado). */
  className?: string;
  /** Sem a barra (a live ou a sessao encerrada) o painel fica sempre na tela: sem o X. */
  closable: boolean;
  /** As classes do cartao da aba (no Modo cinema o chat fica menor). */
  contentClassName?: string;
  /** O primeiro foco da sala fica na aba Chat (firstFocusTarget, com o painel na tela). */
  firstFocus: boolean;
  id: string;
  /** O Replay chama o Chat de "Chat da live". */
  kind: RoomKind;
  onClose: () => void;
  onTab: (tab: RoomPanelTab) => void;
  /** O painel na tela (fechado, o aside fica hidden e montado). */
  open: boolean;
  /** Ha enquete aberta: o ponto na aba Enquetes. */
  pollOpen: boolean;
  tab: RoomPanelTab;
  tabs: readonly RoomPanelTab[];
};

function tabLabel(tab: RoomPanelTab, kind: RoomKind) {
  const abas = WEBINAR_COPY.sala.abas;
  switch (tab) {
    case "chat":
      return kind === "replay" ? abas.chatDaLive : abas.chat;
    case "perguntas":
      return abas.perguntas;
    case "participantes":
      return abas.participantes;
    case "enquetes":
      return abas.enquetes;
  }
}

export function RoomPanel({ children, className, closable, contentClassName, firstFocus, id, kind, onClose, onTab, open, pollOpen, tab, tabs }: RoomPanelProps) {
  const copy = WEBINAR_COPY.salaV2.painel;
  return (
    <aside className={cn(className, "gap-2 lg:w-80 lg:flex-none lg:gap-3", closable ? null : "pt-2 lg:pt-0")} data-testid="room-panel" hidden={!open} id={id}>
      <div className="flex shrink-0 items-center gap-2 px-2 lg:px-0">
        <div
          aria-label={copy.rotulo}
          className="flex h-11 min-w-0 flex-1 items-center gap-0.5 rounded-[calc(var(--member-button-radius)+4px)] border border-room-tabs-border bg-room-tabs p-1 lg:h-auto lg:gap-1"
          role="tablist"
        >
          {tabs.map((value) => (
            <button
              aria-controls={`room-tab-${value}`}
              aria-selected={tab === value}
              className={cn(
                "h-[34px] min-w-0 flex-1 truncate rounded-[var(--member-button-radius)] px-1.5 text-xs transition-colors motion-reduce:transition-none lg:h-10 lg:text-[13px]",
                ROOM_FOCUS,
                tab === value ? "bg-room-tab-on-bg font-bold text-room-tab-on-fg shadow-[var(--room-tab-on-shadow)]" : "font-semibold text-room-fg-muted hover:text-room-fg-strong"
              )}
              data-room-first-focus={firstFocus && value === "chat" ? "" : undefined}
              id={`room-tabbtn-${value}`}
              key={value}
              onClick={() => onTab(value)}
              role="tab"
              type="button"
            >
              {tabLabel(value, kind)}
              {value === "enquetes" && pollOpen ? <span aria-hidden="true" className="ml-1 inline-block size-1.5 rounded-full bg-[var(--accent)] align-middle" /> : null}
            </button>
          ))}
        </div>
        {closable ? (
          <RoomIconButton className="hidden lg:grid" label={copy.fechar} onClick={onClose} size={40} tone="outline">
            <X aria-hidden="true" />
          </RoomIconButton>
        ) : null}
      </div>

      <div
        aria-labelledby={`room-tabbtn-${tab}`}
        className={cn(
          "mx-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-[14px] border border-b-0 border-room-border bg-room-surface lg:mx-0 lg:rounded-[var(--member-cover-radius)] lg:border-b",
          contentClassName
        )}
        id={`room-tab-${tab}`}
        role="tabpanel"
      >
        {children}
      </div>
    </aside>
  );
}

/**
 * O contador do balao (V2-7 e V2-8): quantas mensagens de outras pessoas chegaram desde que o painel fechou. Ao fechar,
 * a sala guarda as mensagens que estavam na tela e o offset daquele instante (`offsetMs`); abrir zera. O painel que ja
 * monta fechado (a escolha guardada) conta a partir da montagem: a primeira leitura do chat que chega depois nao e nova.
 */
type PanelClosedAt = { ids: ReadonlySet<string>; offsetMs: number };

export function useRoomPanelUnread(input: { messages: readonly RoomMessage[]; offsetMs: number; panelShown: boolean }): number {
  const { messages, offsetMs, panelShown } = input;
  const closedAt = (): PanelClosedAt => ({ ids: new Set<string>(messages.map(({ id }) => id)), offsetMs });
  const [since, setSince] = useState<PanelClosedAt | null>(() => (panelShown ? null : closedAt()));
  const [wasShown, setWasShown] = useState(panelShown);
  if (wasShown !== panelShown) {
    setWasShown(panelShown);
    setSince(panelShown ? null : closedAt());
  }
  return panelShown || !since ? 0 : unreadCount(since.ids, messages, since.offsetMs);
}
