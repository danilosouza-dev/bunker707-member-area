"use client";

import { Activity, ChartNoAxesColumn, CircleDot, Ellipsis, FileText, Hand, Headset, MessageCircleQuestionMark, MessageSquareText, PictureInPicture2, ShoppingBag, Users, type LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { RoomCountBadge } from "@/components/member/webinars/room/room-ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { consoleRailFit, type ConsoleMoreEntry, type ConsolePanelView, type ConsoleTab } from "@/server/webinars/console-v2-model";
import { adminMenuItem, adminMenuPopup } from "../../../styles";
import { CONSOLE_PANEL_ID } from "./console-layout-model";
import { useConsolePortal } from "./console-shell";

// O trilho a direita do console (docs/31 §10), o RoomRail da sala com as abas e as entradas do console: so com palco (a
// live) e so a partir de lg, uma coluna de 48 px a 16 px da borda direita, depois do painel. Cada item e um botao de
// 48 x 64: o quadrado de 48 com raio 8 e o icone de 24, e o rotulo 10/16 embaixo (600 no item aberto). Os itens sao as
// abas (Chat com o numero das mensagens novas de outras pessoas enquanto ele nao esta na tela, rodada v12, D106;
// Perguntas com o numero das abertas no contador vermelho, Mãos com o das maos levantadas, Pessoas) e
// depois as entradas da sessao (Na tela, Enquetes, Atendimento, Presença, Gravação; na gravada, Roteiro e Oferta), todos na tela
// quando a altura do trilho comporta (ajuste do produtor de 10/11/2026). Numa janela baixa, o trilho mede a propria
// altura (no navegador, antes de pintar e a cada mudanca) e o ultimo lugar vira o Mais, com o menu dos que nao couberam
// como opcoes de radio, no portal da raiz (consoleRailFit); com um desses na tela, o Mais fica aberto e o nome dele diz
// qual. O item abre o painel nele e, aberto, fecha o painel (consoleRailStep, no console); o estado vai em
// aria-expanded com o aria-controls do painel. O nome de cada item comeca pelo rotulo visivel (WCAG 2.5.3): "Perguntas,
// 3 abertas"; a Na tela leva no contador quantas coisas estao na frente da turma ("Na tela, 2 coisas na tela"). Sem
// dica nem title: o rotulo esta sempre na tela. Cores so pelos tokens --room-*.

const copy = WEBINAR_COPY.consoleV2;

const ICONS: Record<ConsoleMoreEntry | ConsoleTab, LucideIcon> = {
  atendimento: Headset,
  chat: MessageSquareText,
  enquetes: ChartNoAxesColumn,
  gravacao: CircleDot,
  maos: Hand,
  oferta: ShoppingBag,
  perguntas: MessageCircleQuestionMark,
  pessoas: Users,
  presenca: Activity,
  roteiro: FileText,
  tela: PictureInPicture2
};

/** O quadrado de 48 do item (o anel de foco envolve so ele; o botao inteiro e o clique). */
const SQUARE =
  "relative grid size-12 place-items-center rounded-[8px] text-room-icon group-hover:bg-room-control-hover group-active:shadow-[inset_0_0_0_999px_var(--room-press-overlay)] group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-room-focus";
const ITEM = "group flex w-12 shrink-0 flex-col items-center outline-none";
const LABEL = "-mx-3 block max-w-[72px] truncate text-center text-[10px] leading-4 text-room-fg";

/** Um item do trilho: a aba ou a entrada, pela chave (que da o id e o data-console-rail). */
type RailItem = { count: number; key: ConsoleMoreEntry | ConsoleTab; label: string; view: ConsolePanelView };

/** O numero do item para o leitor de tela: as mensagens novas, as maos levantadas, o que esta na tela (a Na tela) ou as perguntas abertas. */
function railCountLabel(key: ConsoleMoreEntry | ConsoleTab, count: number): string {
  if (key === "chat") {
    return copy.trilho.mensagensNovas(count);
  }
  return key === "maos" ? copy.trilho.maos(count) : key === "tela" ? WEBINAR_COPY.naTela.console.contador(count) : copy.trilho.abertas(count);
}

/** A chave do que o painel mostra (a aba ou a entrada). */
function viewKey(view: ConsolePanelView): ConsoleMoreEntry | ConsoleTab {
  return "tab" in view ? view.tab : view.more;
}

/**
 * O controle de uma aba ou entrada que esta na tela: o item do trilho a partir de lg, com palco (ou o Mais, quando o
 * item nao coube); a aba da linha ou o ⋯ do painel abaixo de lg e sem palco. Quem leva o foco depois de uma acao (Mãos,
 * Lançar enquete, o Gravar por preparar, o X do painel, a fila da aba Mãos que esvaziou) usa este, para o foco nunca ir
 * a um botao escondido e cair no comeco da pagina.
 */
export function visibleConsoleTabControl(doc: Document, key: ConsoleMoreEntry | ConsoleTab): HTMLElement | null {
  const isTab = key === "chat" || key === "perguntas" || key === "maos" || key === "pessoas";
  const candidates = [
    doc.getElementById(`console-railbtn-${key}`),
    doc.getElementById("console-railbtn-mais"),
    isTab ? doc.getElementById(`console-tabbtn-${key}`) : doc.querySelector<HTMLElement>("[data-console-more-trigger]")
  ];
  return candidates.find((element): element is HTMLElement => element instanceof HTMLElement && element.getClientRects().length > 0) ?? null;
}

export type ConsoleRailProps = {
  className: string;
  /**
   * Os numeros das abas (consoleTabCounts): as perguntas abertas e as maos levantadas; o que esta na tela (a Na tela);
   * e as mensagens novas do Chat enquanto ele nao esta na tela (consoleChatNewCount, D106).
   */
  counts: { chat?: number; maos: number; perguntas: number; tela?: number };
  /** As entradas desta sessao (consoleMoreEntriesFor), na ordem, depois das abas. */
  entries: readonly ConsoleMoreEntry[];
  /** A altura do trilho antes da medida (o teste de tela); sem ela, todos os itens ate o navegador medir. */
  initialAvailable?: number | null;
  /** O toque num item: o console decide pelo consoleRailStep. */
  onItem: (view: ConsolePanelView) => void;
  /** O painel na tela: so entao um item fica aberto. */
  panelShown: boolean;
  /** As abas desta sessao (consoleTabsFor), na ordem. */
  tabs: readonly ConsoleTab[];
  /** O que o painel mostra (consolePanelViewOf). */
  view: ConsolePanelView;
};

export function ConsoleRail({ className, counts, entries, initialAvailable = null, onItem, panelShown, tabs, view }: ConsoleRailProps) {
  const portal = useConsolePortal();
  const navRef = useRef<HTMLElement | null>(null);
  const [available, setAvailable] = useState<number | null>(initialAvailable);
  const current = viewKey(view);

  // A altura do trilho, antes de pintar e a cada mudanca (a janela, o zoom); escondido (abaixo de lg), sem medida.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) {
      return;
    }
    const measure = () => setAvailable(nav.clientHeight > 0 ? nav.clientHeight : null);
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  const items: RailItem[] = [
    ...tabs.map((tab) => ({ count: tab === "perguntas" ? counts.perguntas : tab === "maos" ? counts.maos : tab === "chat" ? (counts.chat ?? 0) : 0, key: tab, label: copy.abas[tab], view: { tab } })),
    ...entries.map((more) => ({ count: more === "tela" ? (counts.tela ?? 0) : 0, key: more, label: copy.entradas[more], view: { more } }))
  ];
  const fit = consoleRailFit({ available, count: items.length });
  const shown = items.slice(0, fit.visible);
  const rest = items.slice(fit.visible);
  const chosenInMore = rest.find((item) => item.key === current) ?? null;
  const moreOpen = panelShown && chosenInMore !== null;

  return (
    <nav aria-label={copy.rotuloAbas} className={className} data-console-slot="rail" ref={navRef}>
      {shown.map((item) => {
        const Icon = ICONS[item.key];
        const open = panelShown && current === item.key;
        return (
          <button
            aria-controls={CONSOLE_PANEL_ID}
            aria-expanded={open}
            aria-label={item.count > 0 ? copy.trilho.comNumero(item.label, railCountLabel(item.key, item.count)) : undefined}
            className={ITEM}
            data-console-rail={item.key}
            id={`console-railbtn-${item.key}`}
            key={item.key}
            onClick={() => onItem(item.view)}
            type="button"
          >
            <span className={cn(SQUARE, open ? "bg-room-control" : null)}>
              <Icon aria-hidden="true" className="size-6" strokeWidth={1.75} />
              <RoomCountBadge count={item.count} ring="bg" />
            </span>
            <span className={cn(LABEL, open ? "font-semibold" : null)}>{item.label}</span>
          </button>
        );
      })}
      {rest.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={chosenInMore ? copy.maisEscolhido(chosenInMore.label) : copy.mais}
            className={ITEM}
            data-console-rail="mais"
            id="console-railbtn-mais"
          >
            <span className={cn(SQUARE, moreOpen ? "bg-room-control" : null)}>
              <Ellipsis aria-hidden="true" className="size-6" strokeWidth={1.75} />
              <RoomCountBadge count={rest.reduce((sum, item) => sum + item.count, 0)} ring="bg" />
            </span>
            <span className={cn(LABEL, moreOpen ? "font-semibold" : null)}>{moreOpen && chosenInMore ? chosenInMore.label : copy.trilho.mais}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={cn(adminMenuPopup, "w-60 bg-room-menu text-room-fg")} container={portal} side="left">
            <DropdownMenuRadioGroup
              aria-label={copy.mais}
              onValueChange={(value) => {
                const item = rest.find((entry) => entry.key === value);
                if (item) {
                  onItem(item.view);
                }
              }}
              value={chosenInMore?.key ?? ""}
            >
              {rest.map((item) => {
                const Icon = ICONS[item.key];
                return (
                  <DropdownMenuRadioItem className={cn(adminMenuItem, "gap-3 pr-8")} closeOnClick data-console-more-item={item.key} key={item.key} value={item.key}>
                    <Icon aria-hidden="true" className="size-5 text-room-icon" strokeWidth={1.75} />
                    {item.count > 0 ? `${item.label} ${item.count}` : item.label}
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </nav>
  );
}
