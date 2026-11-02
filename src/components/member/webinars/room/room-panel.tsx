"use client";

import { X } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { RoomMessage } from "@/lib/webinar-room-client";
import { panelUnreadCount, panelUnreadMark, panelUnreadSeen, tabScrollLeft, type PanelUnreadMark, type RoomKind, type RoomPanelTab } from "./room-layout-model";
import { RoomTooltip } from "./room-tooltip";
import { ROOM_FOCUS, RoomIconButton } from "./room-ui";

// O painel da sala (docs/31 V2-7 e V2-8; a sala no estilo do YouTube), o mesmo na Live ao vivo, na gravada e no Replay
// (desenho normal). A partir de lg o painel inteiro e o cartao do YouTube: o aside com o fundo --room-panel, o contorno
// de 1 px e o raio 12 fixo (sem seguir Marca, V2-11), com a largura da grade do YouTube (clamp de 320 a 514 px, 27,5 %
// da janela) e SEM overflow-hidden (o X fica a 2 px do contorno e o anel de foco dele sairia cortado; um filho que pinte
// fundo encostado na borda arredonda a si mesmo). Em cima, o cabecalho de 56 px: o h2 "room-panel-title" com o nome da aba e, quando a sala passa, o
// numero (Participantes, Enquetes) e a acao da aba (`titleAction`), e o X "Fechar o painel" sem fundo, com a dica no
// lugar do title. As abas viram o trilho a direita (room-rail.tsx), irmao deste aside; a linha das abas fica so abaixo
// de lg. Abaixo de lg o painel fica embaixo da barra: as abas em pilula no topo (44 px, abas de 34 px), sem o X (o balao
// da barra, logo acima, abre e fecha) e a aba escolhida num cartao com os cantos de Marca › Estilo
// (--member-cover-radius), como antes. Fechado, o aside fica escondido (hidden) e montado: o rascunho, o aceite e a aba
// continuam; trocar de aba desmonta a de antes. As abas saem da regra unica panelTabsFor (room-layout-model.ts).
// Cada aba da linha tem a largura do rotulo inteiro (nunca reticencias: "Participantes" nao cabia nos 85 px de um terco
// da linha) e cresce para encher a linha; quando as quatro nao cabem, a linha rola de lado, sem barra, e a aba escolhida
// entra inteira na vista (tabScrollLeft). Abaixo de lg deitado o painel fica ao lado do palco, com 288 px (roomSkeleton).
// O contador de mensagens novas do balao e do Chat do trilho (useRoomPanelUnread) conta o que chegou enquanto o Chat
// nao esta na tela (o painel fechado ou aberto noutra aba). Cores pelos tokens do tema da sala; o acento so no ponto da
// aba Enquetes com enquete aberta.
// A linha das abas e o RoomTabList, que o painel com abas do console de quem apresenta (docs/31 V2-15) tambem usa, com
// outras abas, os numeros no nome ("Perguntas 3") e os ids pelo `idPrefix`; o HTML da linha e o de antes.

export type RoomPanelProps = {
  /** O conteudo da aba escolhida. */
  children: ReactNode;
  /** As classes do esqueleto (roomSkeleton): o painel ocupa a coluna no celular, ou nao (Modo cinema, fechado). */
  className?: string;
  /** Sem a barra (a live ou a sessao encerrada) o painel fica sempre na tela: sem o X. */
  closable: boolean;
  /** As classes do cartao da aba (no Modo cinema o chat fica menor). */
  contentClassName?: string;
  /** O primeiro foco da sala fica na aba Chat abaixo de lg (firstFocusTarget, com o painel na tela). */
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
  /** A acao da aba abaixo de lg, na linha das abas e fora da lista que rola (o "Filtrar e ordenar" das Perguntas). */
  tabAction?: ReactNode;
  tabs: readonly RoomPanelTab[];
  /** A acao da aba no cabecalho, antes do X (o ordenar das Perguntas, o ⋮ do Chat). */
  titleAction?: ReactNode;
  /** O numero ao lado do nome da aba no cabecalho (Participantes, Enquetes); nulo, nenhum. */
  titleCount?: number | null;
};

/** O nome da aba: o do cabecalho do painel, da linha das abas e do trilho ("Chat da live" so no Replay). */
export function tabLabel(tab: RoomPanelTab, kind: RoomKind) {
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

/** Uma aba da linha: o valor (que da os ids), o nome, o numero no nome ("Perguntas 3") e o ponto do acento. */
export type RoomTabListTab<T extends string = string> = { count?: number; dot?: boolean; label: string; value: T };

export type RoomTabListProps<T extends string = string> = {
  /** A aba que leva o data-room-first-focus (o primeiro foco da sala); nula sem ele. */
  firstFocusValue: T | null;
  /** O comeco dos ids: `${idPrefix}-tab-{valor}` no painel da aba e `${idPrefix}-tabbtn-{valor}` na aba ("room" na sala). */
  idPrefix: string;
  /** O nome da lista, para o leitor de tela. */
  label: string;
  onSelect: (value: T) => void;
  /** O painel na tela: so entao a linha rola ate a aba escolhida. */
  open: boolean;
  /** A aba escolhida; nula quando o painel mostra outra coisa (o ⋯ do console). */
  tab: T | null;
  tabs: readonly RoomTabListTab<T>[];
};

/**
 * A linha das abas em pilula (role tablist): cada aba com a largura do rotulo inteiro (nunca reticencias), crescendo
 * para encher a linha; quando nao cabem, a linha rola de lado sem barra e a aba escolhida entra inteira na vista
 * (tabScrollLeft) ao trocar de aba, ao mudar a lista e ao abrir.
 */
export function RoomTabList<T extends string>({ firstFocusValue, idPrefix, label, onSelect, open, tab, tabs }: RoomTabListProps<T>) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const tabsKey = tabs.map((item) => item.value).join(" ");

  // A aba escolhida inteira na vista quando a linha rola (as quatro abas): ao trocar de aba, ao mudar a lista e ao abrir.
  useLayoutEffect(() => {
    const list = listRef.current;
    const selected = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !selected || !open) {
      return;
    }
    const listBox = list.getBoundingClientRect();
    const tabBox = selected.getBoundingClientRect();
    const next = tabScrollLeft({
      listWidth: list.clientWidth,
      scrollLeft: list.scrollLeft,
      tabLeft: tabBox.left - listBox.left - list.clientLeft + list.scrollLeft,
      tabWidth: tabBox.width
    });
    if (next !== list.scrollLeft) {
      list.scrollLeft = next;
    }
  }, [open, tab, tabsKey]);

  return (
    <div
      aria-label={label}
      className="flex h-11 min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-[calc(var(--member-button-radius)+4px)] border border-room-tabs-border bg-room-tabs p-1 [scrollbar-width:none] lg:h-auto lg:gap-1 [&::-webkit-scrollbar]:hidden"
      ref={listRef}
      role="tablist"
    >
      {tabs.map(({ count, dot, label: name, value }) => (
        <button
          aria-controls={`${idPrefix}-tab-${value}`}
          aria-selected={tab === value}
          className={cn(
            "h-[34px] shrink-0 grow whitespace-nowrap rounded-[var(--member-button-radius)] px-1.5 text-xs transition-colors motion-reduce:transition-none lg:h-10 lg:text-[13px]",
            ROOM_FOCUS,
            tab === value ? "bg-room-tab-on-bg font-bold text-room-tab-on-fg shadow-[var(--room-tab-on-shadow)]" : "font-semibold text-room-fg-muted hover:text-room-fg-strong"
          )}
          data-room-first-focus={firstFocusValue === value ? "" : undefined}
          id={`${idPrefix}-tabbtn-${value}`}
          key={value}
          onClick={() => onSelect(value)}
          role="tab"
          type="button"
        >
          {count === undefined ? name : `${name} ${count}`}
          {dot ? <span aria-hidden="true" className="ml-1 inline-block size-1.5 rounded-full bg-room-accent align-middle" /> : null}
        </button>
      ))}
    </div>
  );
}

export function RoomPanel({
  children,
  className,
  closable,
  contentClassName,
  firstFocus,
  id,
  kind,
  onClose,
  onTab,
  open,
  pollOpen,
  tab,
  tabAction,
  tabs,
  titleAction,
  titleCount = null
}: RoomPanelProps) {
  const copy = WEBINAR_COPY.salaV2.painel;

  return (
    <aside
      aria-labelledby="room-panel-title"
      className={cn(
        className,
        "gap-2 max-lg:landscape:w-72 max-lg:landscape:flex-none lg:w-[clamp(320px,27.5vw,514px)] lg:flex-none lg:gap-0 lg:rounded-[12px] lg:border lg:border-room-panel-border lg:bg-room-panel",
        closable ? null : "pt-2 lg:pt-0"
      )}
      data-testid="room-panel"
      hidden={!open}
      id={id}
    >
      {/* Abaixo de lg, a linha das abas (a partir de lg as abas sao o trilho). */}
      <div className="flex shrink-0 items-center gap-2 px-2 lg:hidden">
        <RoomTabList
          firstFocusValue={firstFocus ? "chat" : null}
          idPrefix="room"
          label={copy.rotulo}
          onSelect={onTab}
          open={open}
          tab={tab}
          tabs={tabs.map((value) => ({ dot: value === "enquetes" && pollOpen, label: tabLabel(value, kind), value }))}
        />
        {tabAction}
      </div>

      {/* A partir de lg, o cabecalho do YouTube: o nome da aba com o numero, a acao da aba e o X. */}
      <div className="hidden h-14 shrink-0 items-center py-1 pl-4 pr-0.5 lg:flex">
        <h2 className="my-2.5 mr-2 min-w-0 flex-1 truncate text-xl font-bold leading-7 text-room-fg" id="room-panel-title">
          {tabLabel(tab, kind)}
          {titleCount !== null ? <span className="ml-2 inline-block text-base font-normal leading-[22px] tabular-nums text-room-fg-subtle">{titleCount.toLocaleString("pt-BR")}</span> : null}
        </h2>
        {titleAction ? <div className="mr-2">{titleAction}</div> : null}
        {closable ? (
          <RoomTooltip label={copy.fechar} side="below">
            <RoomIconButton className="[&_svg]:size-6" label={copy.fechar} onClick={onClose} size={40} tone="ghost" withTitle={false}>
              <X aria-hidden="true" strokeWidth={1.75} />
            </RoomIconButton>
          </RoomTooltip>
        ) : null}
      </div>

      <div
        aria-labelledby={`room-tabbtn-${tab}`}
        className={cn(
          "mx-2 flex min-h-0 flex-1 flex-col rounded-t-[var(--member-cover-radius)] border border-b-0 border-room-border bg-room-surface max-lg:overflow-hidden lg:mx-0 lg:rounded-none lg:border-0 lg:bg-transparent",
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
 * O contador do balao e do Chat do trilho (V2-7 e V2-8; a sala no estilo do YouTube, V2-A56): quantas mensagens de
 * outras pessoas chegaram desde que o Chat saiu da tela (`chatShown`: o painel na tela E na aba Chat; o painel fechado
 * ou aberto noutra aba conta). Quando o Chat sai, a sala guarda a marca daquele instante (panelUnreadMark: os ids das
 * mensagens na tela e, fora da Live ao vivo, o offset); voltar ao Chat zera. O Chat que sai antes da primeira leitura
 * do chat (o painel ja monta fechado, a escolha guardada) toma essa leitura como vista (panelUnreadSeen).
 */
export function useRoomPanelUnread(input: { chatLoaded: boolean; chatShown: boolean; kind: RoomKind; messages: readonly RoomMessage[]; offsetMs: number }): number {
  const { chatLoaded, chatShown, kind, messages, offsetMs } = input;
  const markNow = () => panelUnreadMark({ chatLoaded, kind, messages, offsetMs });
  const [mark, setMark] = useState<PanelUnreadMark | null>(() => (chatShown ? null : markNow()));
  const [wasShown, setWasShown] = useState(chatShown);
  if (wasShown !== chatShown) {
    setWasShown(chatShown);
    setMark(chatShown ? null : markNow());
  } else if (mark) {
    const seen = panelUnreadSeen(mark, { chatLoaded, messages });
    if (seen !== mark) {
      setMark(seen);
    }
  }
  return chatShown || !mark ? 0 : panelUnreadCount(mark, messages);
}
