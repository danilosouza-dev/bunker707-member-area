"use client";

import { ChevronDown, MoreHorizontal, X } from "lucide-react";
import type { ReactNode } from "react";
import { RoomTabList } from "@/components/member/webinars/room/room-panel";
import { ROOM_FOCUS, RoomIconButton } from "@/components/member/webinars/room/room-ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { CONSOLE_MORE_ENTRIES, type ConsoleMoreEntry, type ConsolePanelView, type ConsoleTab } from "@/server/webinars/console-v2-model";
import { adminMenuItem, adminMenuPopup } from "../../../styles";
import { CONSOLE_PANEL_ID, CONSOLE_TAB_ID_PREFIX } from "./console-layout-model";
import { useConsolePortal } from "./console-shell";

// O painel do console de quem apresenta (docs/31 V2-15), a direita do palco (embaixo da barra abaixo de lg): a linha
// das abas da sala (RoomTabList, em pilula, que rola de lado quando nao cabe) com Chat, Perguntas, Mãos e Pessoas na
// live (Chat e Perguntas na gravada e no Replay), os numeros no proprio nome ("Perguntas 3", "Mãos 2"); depois dela, o
// ⋯ "Mais painéis", um botao de menu fora da lista das abas (um tab que abrisse seis paineis nao seria um tab), com as
// entradas da sessao (consoleMoreEntriesFor) como opcoes de radio; com uma escolhida, ele fica no estilo da aba ativa
// e diz o nome dela, e nenhuma aba fica escolhida. O conteudo de uma entrada e uma <section> com o nome dela, nao um
// tabpanel, e um grupo, nao uma regiao: o cartao de dentro (SectionCard) ja e a regiao com o titulo, e o leitor de tela
// nao lista "Enquetes" dentro de "Enquetes". O X "Fechar o painel" so a partir de lg e so na live (sem palco o painel nunca fecha). Tudo fica montado:
// a aba e a entrada que nao estao na tela ganham `hidden` (a batida de 30 s do Atendimento, o rascunho do chat e o HTML
// do servidor com tudo continuam). A aba e a entrada escolhidas ficam so na memoria da pagina (SessionConsole); o
// painel aberto ou fechado, na chave do console. O corpo rola por dentro a partir de lg e e `relative` (os rotulos so
// para o leitor de tela rolam com ele). O menu abre no portal da raiz do console, no tema dela. Nenhuma frase escrita
// aqui.

const copy = WEBINAR_COPY.consoleV2;

export type ConsolePanelProps = {
  /** As classes do esqueleto (consoleSkeleton: a largura por faixa e o `hidden` fechado). */
  className: string;
  /** Com palco (a live), o X a partir de lg; sem palco, o painel nunca fecha. */
  closable: boolean;
  /** Os numeros das abas (consoleTabCounts): as perguntas abertas e as maos levantadas. */
  counts: { maos: number; perguntas: number };
  /** As entradas do ⋯ desta sessao (consoleMoreEntriesFor), na ordem. */
  entries: readonly ConsoleMoreEntry[];
  /** O conteudo de cada entrada do ⋯. */
  more: Partial<Record<ConsoleMoreEntry, ReactNode>>;
  onClose: () => void;
  onView: (view: ConsolePanelView) => void;
  /** O painel na tela (fechado, o aside fica hidden e montado). */
  open: boolean;
  /** O conteudo de cada aba. */
  panes: Partial<Record<ConsoleTab, ReactNode>>;
  /** As abas desta sessao (consoleTabsFor), na ordem. */
  tabs: readonly ConsoleTab[];
  /** O que o painel mostra (consolePanelViewOf: a aba ou a entrada, que existe nesta sessao). */
  view: ConsolePanelView;
};

export function ConsolePanel({ className, closable, counts, entries, more, onClose, onView, open, panes, tabs, view }: ConsolePanelProps) {
  const tab = "tab" in view ? view.tab : null;
  const chosen = "more" in view ? view.more : null;

  return (
    <aside className={className} data-console-slot="panel" hidden={!open} id={CONSOLE_PANEL_ID}>
      <div className="flex shrink-0 items-center gap-2">
        <RoomTabList
          firstFocusValue={null}
          idPrefix={CONSOLE_TAB_ID_PREFIX}
          label={copy.rotuloAbas}
          onSelect={(value) => onView({ tab: value })}
          open={open}
          tab={tab}
          tabs={tabs.map((value) => ({ count: value === "perguntas" ? counts.perguntas : value === "maos" ? counts.maos : undefined, label: copy.abas[value], value }))}
        />
        <ConsoleMoreMenu chosen={chosen} entries={entries} onChoose={(entry) => onView({ more: entry })} />
        {closable ? (
          <RoomIconButton className="hidden lg:grid" label={copy.fecharPainel} onClick={onClose} size={40} tone="outline">
            <X aria-hidden="true" />
          </RoomIconButton>
        ) : null}
      </div>

      <div className="relative flex min-w-0 flex-col gap-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto" data-console-panel-body="">
        {tabs.map((value) => (
          <div
            aria-labelledby={`${CONSOLE_TAB_ID_PREFIX}-tabbtn-${value}`}
            className="flex min-w-0 flex-col gap-4"
            data-console-tab={value}
            hidden={tab !== value}
            id={`${CONSOLE_TAB_ID_PREFIX}-tab-${value}`}
            key={value}
            role="tabpanel"
          >
            {panes[value]}
          </div>
        ))}
        {entries.map((entry) => (
          <section aria-label={copy.entradas[entry]} className="flex min-w-0 flex-col gap-4" data-console-more={entry} hidden={chosen !== entry} key={entry} role="group">
            {more[entry]}
          </section>
        ))}
      </div>
    </aside>
  );
}

/**
 * O ⋯ do painel: sem entrada escolhida, o circulo "Mais painéis"; com uma, a pilula da aba ativa com o nome dela e a
 * seta. As opcoes sao radio (a escolhida marcada) e o menu volta o foco ao botao ao fechar.
 */
function ConsoleMoreMenu({ chosen, entries, onChoose }: { chosen: ConsoleMoreEntry | null; entries: readonly ConsoleMoreEntry[]; onChoose: (entry: ConsoleMoreEntry) => void }) {
  const portal = useConsolePortal();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={chosen ? copy.maisEscolhido(copy.entradas[chosen]) : copy.mais}
        className={cn(
          "inline-flex h-11 shrink-0 items-center justify-center gap-1 rounded-full whitespace-nowrap transition-colors motion-reduce:transition-none lg:h-10 [&_svg]:shrink-0",
          ROOM_FOCUS,
          chosen
            ? "bg-room-tab-on-bg px-3 text-xs font-bold text-room-tab-on-fg shadow-[var(--room-tab-on-shadow)] lg:text-[13px] [&_svg]:size-3.5"
            : "w-11 border border-room-tabs-border bg-room-tabs text-room-fg-muted hover:text-room-fg-strong lg:w-10 [&_svg]:size-4"
        )}
        data-console-more-trigger={chosen ?? ""}
      >
        {chosen ? (
          <>
            {copy.entradas[chosen]}
            <ChevronDown aria-hidden="true" />
          </>
        ) : (
          <MoreHorizontal aria-hidden="true" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn(adminMenuPopup, "w-56 bg-room-surface text-room-fg")} container={portal}>
        <DropdownMenuRadioGroup
          aria-label={copy.mais}
          onValueChange={(value) => {
            const entry = CONSOLE_MORE_ENTRIES.find((item) => item === value);
            if (entry) {
              onChoose(entry);
            }
          }}
          value={chosen ?? ""}
        >
          {entries.map((entry) => (
            <DropdownMenuRadioItem className={cn(adminMenuItem, "pr-8")} closeOnClick data-console-more-item={entry} key={entry} value={entry}>
              {copy.entradas[entry]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
