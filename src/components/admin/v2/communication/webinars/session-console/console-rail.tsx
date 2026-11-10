"use client";

import { ChartNoAxesColumn, Clapperboard, Ellipsis, FileText, Hand, Headset, MessageCircleQuestionMark, MessageSquareText, ShoppingBag, Users, UsersRound, type LucideIcon } from "lucide-react";
import { RoomCountBadge } from "@/components/member/webinars/room/room-ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { CONSOLE_MORE_ENTRIES, type ConsoleMoreEntry, type ConsolePanelView, type ConsoleTab } from "@/server/webinars/console-v2-model";
import { adminMenuItem, adminMenuPopup } from "../../../styles";
import { CONSOLE_PANEL_ID } from "./console-layout-model";
import { useConsolePortal } from "./console-shell";

// O trilho a direita do console (docs/31 §10), o RoomRail da sala com as abas do console: so com palco (a live) e so a
// partir de lg, uma coluna de 48 px a 16 px da borda direita, depois do painel. Cada item e um botao de 48 x 64: o
// quadrado de 48 com raio 8 e o icone de 24, e o rotulo 10/16 embaixo (600 no item aberto). Chat, Perguntas (com o
// numero das abertas no contador vermelho), Mãos (com o das maos levantadas) e Pessoas abrem o painel naquela aba e,
// abertos, fecham o painel (consoleRailStep); o estado vai em aria-expanded com o aria-controls do painel. O ultimo
// item, Mais, abre o menu das outras entradas da sessao (consoleMoreEntriesFor) como opcoes de radio, no portal da raiz;
// com uma entrada na tela, o Mais fica aberto e o nome dele diz qual. O nome de cada item comeca pelo rotulo visivel
// (WCAG 2.5.3): "Perguntas, 3 abertas". Sem dica nem title: o rotulo esta sempre na tela. Cores so pelos tokens --room-*.

const copy = WEBINAR_COPY.consoleV2;

const TAB_ICONS: Record<ConsoleTab, LucideIcon> = {
  chat: MessageSquareText,
  maos: Hand,
  perguntas: MessageCircleQuestionMark,
  pessoas: Users
};

/** O icone de cada entrada do Mais, no menu. */
const ENTRY_ICONS: Record<ConsoleMoreEntry, LucideIcon> = {
  atendimento: Headset,
  enquetes: ChartNoAxesColumn,
  gravacao: Clapperboard,
  oferta: ShoppingBag,
  presenca: UsersRound,
  roteiro: FileText
};

/** O quadrado de 48 do item (o anel de foco envolve so ele; o botao inteiro e o clique). */
const SQUARE =
  "relative grid size-12 place-items-center rounded-[8px] text-room-icon group-hover:bg-room-control-hover group-active:shadow-[inset_0_0_0_999px_var(--room-press-overlay)] group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-room-focus";
const ITEM = "group flex w-12 flex-col items-center outline-none";

/**
 * O controle de uma aba (ou do Mais) que esta na tela: o item do trilho a partir de lg, com palco; a aba da linha (ou o
 * ⋯ do painel) abaixo de lg e sem palco. Quem leva o foco depois de uma acao (Mãos, Lançar enquete, o X do painel, a
 * fila da aba Mãos que esvaziou) usa este, para o foco nunca ir a um botao escondido e cair no comeco da pagina.
 */
export function visibleConsoleTabControl(doc: Document, view: ConsoleTab | "mais"): HTMLElement | null {
  const candidates = [doc.getElementById(`console-railbtn-${view}`), view === "mais" ? doc.querySelector<HTMLElement>("[data-console-more-trigger]") : doc.getElementById(`console-tabbtn-${view}`)];
  return candidates.find((element): element is HTMLElement => element instanceof HTMLElement && element.getClientRects().length > 0) ?? null;
}

export type ConsoleRailProps = {
  className: string;
  /** Os numeros das abas (consoleTabCounts): as perguntas abertas e as maos levantadas. */
  counts: { maos: number; perguntas: number };
  /** As entradas do Mais desta sessao (consoleMoreEntriesFor), na ordem. */
  entries: readonly ConsoleMoreEntry[];
  /** O toque num item: o console decide pelo consoleRailStep. */
  onItem: (view: ConsolePanelView) => void;
  /** O painel na tela: so entao um item fica aberto. */
  panelShown: boolean;
  /** As abas desta sessao (consoleTabsFor), na ordem. */
  tabs: readonly ConsoleTab[];
  /** O que o painel mostra (consolePanelViewOf). */
  view: ConsolePanelView;
};

export function ConsoleRail({ className, counts, entries, onItem, panelShown, tabs, view }: ConsoleRailProps) {
  const portal = useConsolePortal();
  const tab = "tab" in view ? view.tab : null;
  const chosen = "more" in view ? view.more : null;
  const moreOpen = panelShown && chosen !== null;

  return (
    <nav aria-label={copy.rotuloAbas} className={className} data-console-slot="rail">
      {tabs.map((item) => {
        const Icon = TAB_ICONS[item];
        const open = panelShown && tab === item;
        const count = item === "perguntas" ? counts.perguntas : item === "maos" ? counts.maos : 0;
        const label = copy.abas[item];
        return (
          <button
            aria-controls={CONSOLE_PANEL_ID}
            aria-expanded={open}
            aria-label={count > 0 ? copy.trilho.comNumero(label, item === "maos" ? copy.trilho.maos(count) : copy.trilho.abertas(count)) : undefined}
            className={ITEM}
            data-console-rail={item}
            id={`console-railbtn-${item}`}
            key={item}
            onClick={() => onItem({ tab: item })}
            type="button"
          >
            <span className={cn(SQUARE, open ? "bg-room-control" : null)}>
              <Icon aria-hidden="true" className="size-6" strokeWidth={1.75} />
              <RoomCountBadge count={count} ring="bg" />
            </span>
            <span className={cn("-mx-3 block max-w-[72px] truncate text-center text-[10px] leading-4 text-room-fg", open ? "font-semibold" : null)}>{label}</span>
          </button>
        );
      })}
      {entries.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={chosen ? copy.maisEscolhido(copy.entradas[chosen]) : copy.mais}
            className={ITEM}
            data-console-rail="mais"
            id="console-railbtn-mais"
          >
            <span className={cn(SQUARE, moreOpen ? "bg-room-control" : null)}>
              <Ellipsis aria-hidden="true" className="size-6" strokeWidth={1.75} />
            </span>
            <span className={cn("-mx-3 block max-w-[72px] truncate text-center text-[10px] leading-4 text-room-fg", moreOpen ? "font-semibold" : null)}>
              {moreOpen && chosen ? copy.entradas[chosen] : copy.trilho.mais}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={cn(adminMenuPopup, "w-60 bg-room-menu text-room-fg")} container={portal} side="left">
            <DropdownMenuRadioGroup
              aria-label={copy.mais}
              onValueChange={(value) => {
                const entry = CONSOLE_MORE_ENTRIES.find((item) => item === value);
                if (entry) {
                  onItem({ more: entry });
                }
              }}
              value={chosen ?? ""}
            >
              {entries.map((entry) => {
                const Icon = ENTRY_ICONS[entry];
                return (
                  <DropdownMenuRadioItem className={cn(adminMenuItem, "gap-3 pr-8")} closeOnClick data-console-more-item={entry} key={entry} value={entry}>
                    <Icon aria-hidden="true" className="size-5 text-room-icon" strokeWidth={1.75} />
                    {copy.entradas[entry]}
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
