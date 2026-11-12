"use client";

import { ChevronDown, EyeOff, LayoutGrid, PanelBottom, PanelRight, RefreshCw } from "lucide-react";
import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { ROOM_THUMBS, type RoomThumbs, type RoomView } from "@/lib/webinar-room-prefs";
import { menuOpenKey } from "./room-layout-model";
import { RoomMenu } from "./room-menu";
import { ROOM_FOCUS } from "./room-ui";

// A Visão do vídeo da Live ao vivo (docs/31 V2-16), na zona da direita da barra, antes de Configurações, so a partir de
// lg (no celular o video fica sempre no Palco, e a coluna some pela largura do iframe, V2-A5): entre lg e xl um circulo
// de 48 px so com o icone, como os outros da barra; a partir de xl a pilula de 44 px com o icone, o nome e a seta. O
// nome acessivel diz o que o video mostra AGORA ("Visão do vídeo: Palco", o ultimo tileViewChanged do motor), nunca a
// escolha guardada: a equipe pode mudar a visao de todos. O menu "Visão do vídeo" tem as duas opcoes (menuitemradio, a
// marcada com aria-checked): Palco e Grade, que a sala manda por comando (setTileView), sem remontar o iframe.
// Desligado antes de entrar na sala. Quem diz se o menu esta aberto e a sala (open e onOpenChange): abrir fecha Reagir e
// Configurações (nunca dois abertos juntos), e o menu desligado fecha de vez (na volta a sala ele nao reabre sozinho).
// O menu e o RoomMenu da sala no estilo do YouTube (room-menu.tsx), um grupo so com as duas opcoes: aberto, o foco vai
// para a opcao marcada; as setas andam, Home e End vao as pontas, o Esc fecha (sem sair da sala) e devolve o foco ao
// botao, como a escolha e o clique no proprio botao (no WebKit o clique nao foca o botao, e o foco ficaria na opcao que
// some, caindo no body); o Tab, um toque fora, um clique no video (o foco que entra no iframe tira o foco da pagina) e
// o foco que sai para outro controle da sala fecham. No botao, a seta para baixo, o Enter e o Espaco abrem
// (menuOpenKey), e a seta para cima tambem (o menu abre por cima dele). O menu abre por cima do palco (z-40, acima da
// enquete do palco, z-30). As cores vem dos tokens do tema da sala (V2-11). Nenhuma frase escrita aqui.
// No console do Apresentador (docs/31 V2-14, `forAll`), o mesmo menu e o "Palco para todos ▾": o botao diz o que o
// video mostra para todos ("Palco para todos" ou "Grade para todos"; o seguir a visao, sempre ligado, leva o
// setTileView dele a todos), e as opcoes continuam Palco e Grade.

// As miniaturas (rodada v9, pedido do produtor de 12/11/2026; docs/30 D91): um segundo grupo no mesmo menu,
// "Miniaturas", com Lateral, Embaixo e Esconder (menuitemradio; a marcada e a escolha guardada da pessoa, nunca a de
// todos). Lateral e Esconder valem na hora (a sala manda o comando). Embaixo pede o video carregado de novo: com o
// microfone e a camera da pessoa desligados, a pagina recarrega o video sozinha e o menu nao mostra nada; com algo dela
// no ar (`thumbsWait` "manual"), o grupo avisa que recarregar desliga o microfone e a camera e oferece o item
// "Recarregar o vídeo agora" (`onReloadVideo`); com a sala trancada ("locked"), a frase diz que vale na proxima entrada
// (docs/30 D96). No console de quem apresenta, com o Esconder marcado, a frase diz que elas saem tambem da gravacao
// (`thumbsNote`). Sem `onThumbs` (os dubles antigos), o grupo nao aparece.

/** O menu da visao (o aria-controls do botao). */
export const ROOM_VIEW_MENU_ID = "room-view-menu";

const VIEWS: readonly RoomView[] = ["stage", "grid"];
const VIEW_ICONS = { grid: LayoutGrid, stage: PanelRight } as const;
const THUMBS_ICONS = { bottom: PanelBottom, hidden: EyeOff, side: PanelRight } as const;

function viewName(view: RoomView): string {
  const copy = WEBINAR_COPY.salaV2.visao;
  return view === "grid" ? copy.grade : copy.palco;
}

export type RoomViewMenuProps = {
  /** Fora da sala (antes de entrar, reconectando, o "ver como"): sem iframe, nada a mudar. */
  disabled: boolean;
  /** O console do Apresentador: a escolha vale para todos (o botao diz "Palco para todos" ou "Grade para todos"). */
  forAll?: boolean;
  onChoose: (view: RoomView) => void;
  /** Abrir (o botao, as setas no botao) ou fechar (a escolha, o Esc, o Tab, um toque fora, o clique no video). */
  onOpenChange: (open: boolean) => void;
  /** O menu aberto, pela sala (desligado, ele nunca aparece). */
  open: boolean;
  /** "Recarregar o vídeo agora" (so com `thumbsWait` "manual"); sem ele, so a frase. */
  onReloadVideo?: () => void;
  /** Escolher onde as miniaturas ficam; sem ele, o grupo Miniaturas nao aparece. */
  onThumbs?: (thumbs: RoomThumbs) => void;
  /** O que o motor mostra agora (o botao e a opcao marcada dizem isto). */
  shown: RoomView;
  /** A escolha guardada das miniaturas (Lateral por padrao). */
  thumbs?: RoomThumbs;
  /** Uma frase a mais no grupo (o console de quem apresenta com o Esconder); a da espera vem antes. */
  thumbsNote?: string | null;
  /**
   * A troca entre Lateral e Embaixo que espera o video carregar de novo e nao sai sozinha: "manual" (algo da pessoa
   * no ar) ou "locked" (a sala trancada). Nula sem espera.
   */
  thumbsWait?: "locked" | "manual" | null;
};

/** O nome do botao "para todos" do console: o que o video mostra para todos agora. */
function forAllName(view: RoomView): string {
  const copy = WEBINAR_COPY.consoleV2.visao;
  return view === "grid" ? copy.gradeParaTodos : copy.palcoParaTodos;
}

export function RoomViewMenu({ disabled, forAll = false, onChoose, onOpenChange, onReloadVideo, onThumbs, open, shown, thumbs = "side", thumbsNote = null, thumbsWait = null }: RoomViewMenuProps) {
  const copy = WEBINAR_COPY.salaV2.visao;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuShown = open && !disabled;
  const Icon = VIEW_ICONS[shown];
  const label = forAll ? forAllName(shown) : copy.atual(viewName(shown));

  /**
   * Fecha e devolve o foco ao botao (antes de o menu sumir: senao o foco cairia no body). Tambem no toque do proprio
   * botao com o menu aberto: no WebKit o clique nao foca o botao, e o foco ficaria na opcao que some.
   */
  function close() {
    buttonRef.current?.focus();
    onOpenChange(false);
  }

  /** No botao: o Esc com o menu aberto fecha so o menu; as teclas que abrem (e a seta para cima) abrem. */
  function onButtonKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && menuShown) {
      // So o menu fecha: o Esc da sala, que pergunta antes de sair, nao recebe este.
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!menuShown && (menuOpenKey(event.key) || event.key === "ArrowUp")) {
      // O Enter e o Espaco nao viram o clique (que fecharia o menu que acabou de abrir): o foco ja vai para a opcao.
      event.preventDefault();
      onOpenChange(true);
    }
  }

  return (
    <div className="relative contents lg:block" data-room-view-menu="">
      <button
        aria-controls={ROOM_VIEW_MENU_ID}
        aria-expanded={menuShown}
        aria-haspopup="menu"
        aria-label={label}
        className={cn(
          "hidden size-11 shrink-0 items-center justify-center gap-2 rounded-full border border-room-border-strong bg-room-surface text-[13px] font-semibold text-room-fg-strong transition-colors hover:bg-room-control-hover disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none lg:inline-flex lg:size-12 xl:h-11 xl:w-auto xl:rounded-[var(--member-button-radius)] xl:px-3.5 [&_svg]:shrink-0",
          ROOM_FOCUS
        )}
        data-room-bar-item="view"
        disabled={disabled}
        onClick={() => (menuShown ? close() : onOpenChange(true))}
        onKeyDown={onButtonKeyDown}
        ref={buttonRef}
        title={label}
        type="button"
      >
        <Icon aria-hidden="true" className="size-[18px]" />
        <span className="hidden xl:inline">{forAll ? label : viewName(shown)}</span>
        <ChevronDown aria-hidden="true" className="hidden size-3.5 xl:block" />
      </button>
      <RoomMenu
        align="end"
        groups={[
          {
            items: VIEWS.map((view) => ({
              checked: view === shown,
              data: { "data-room-view": view },
              icon: VIEW_ICONS[view],
              key: view,
              label: viewName(view),
              onSelect: () => onChoose(view),
              radio: true
            }))
          },
          ...(onThumbs
            ? [
                {
                  hint: thumbsWait === "manual" ? copy.miniaturas.esperaManual : thumbsWait === "locked" ? copy.miniaturas.esperaTrancada : thumbsNote,
                  items: [
                    ...ROOM_THUMBS.map((option) => ({
                      checked: option === thumbs,
                      data: { "data-room-thumbs": option } as const,
                      icon: THUMBS_ICONS[option],
                      key: `thumbs-${option}`,
                      label: copy.miniaturas.opcoes[option],
                      onSelect: () => onThumbs(option),
                      radio: true
                    })),
                    // Com algo da pessoa no ar, quem recarrega o video e ela, na hora que escolher.
                    ...(thumbsWait === "manual" && onReloadVideo
                      ? [{ data: { "data-room-thumbs-reload": "" } as const, icon: RefreshCw, key: "thumbs-reload", label: copy.miniaturas.recarregarAgora, onSelect: onReloadVideo }]
                      : [])
                  ],
                  label: copy.miniaturas.rotulo
                }
              ]
            : [])
        ]}
        id={ROOM_VIEW_MENU_ID}
        label={copy.rotulo}
        onClose={() => onOpenChange(false)}
        open={menuShown}
        placement="above"
        triggerRef={buttonRef}
      />
    </div>
  );
}
