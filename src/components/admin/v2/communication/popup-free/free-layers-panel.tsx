"use client";

import {
  AudioLines,
  Columns3,
  Eye,
  EyeOff,
  Heading,
  Image as ImageIcon,
  Link2,
  Lock,
  LockOpen,
  Minus,
  MoreHorizontal,
  MousePointerClick,
  MoveVertical,
  Pilcrow,
  RectangleHorizontal,
  Rows3,
  Sparkles,
  Square,
  Tag,
  Timer,
  TriangleAlert,
  Video,
  type LucideIcon
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { FreeId, FreeNode, PopupFreeDesign } from "@/server/communications/popup-free-model";
import type { NoticeDraft } from "@/server/communications/schemas";
import { adminTransition } from "../../styles";
import { FREE_LIST_DRAG_START_PX, freeLayerDropAt, type FreeLayerLine, type FreeLayerOver, type FreeMoveTarget, type FreePoint } from "./free-editor-geometry";
import {
  FREE_EDITOR_COPY,
  freeBoxTargets,
  freeDuplicateProblem,
  freeLayerDropTarget,
  freeLayerKeyAction,
  freeLayerRows,
  freeMoveProblem,
  freeNodeOf,
  freeOutOfBoxProblem,
  freeRemoveProblem,
  type FreeLayerRow
} from "./free-editor-model";
import { FREE_SELECTION_COPY } from "./free-editor-selection";
import { followFreePointer } from "./free-pointer-drag";

// Camadas do editor Livre (spec §4.5): a lista em arvore como no Figma e no Photoshop (docs/27 L64 e L66): o que esta
// em cima esta na frente. Em cada nivel, a ordem em que o desenho pinta, de cima para baixo (freeLayerRows: a camada
// maior e, na mesma camada, o ultimo de children em cima; sem camadas, children ao contrario; a caixa vem antes dos
// filhos dela). A ordem de leitura e de Tab do aluno continua a de children (sem camadas, aqui de baixo para cima).
// Em <ul>/<li> aninhados (nao role="tree": as linhas tem botoes dentro). Foco itinerante: um so botao de selecao com
// tabIndex 0 por vez; Esconder, Travar e ⋯ de cada linha ficam com tabIndex -1 e sao alcancados por → / ← dentro da
// linha (com 32 linhas, o Tab passa pela lista uma vez so). Teclado: ↑/↓,
// →/←, Enter, Alt + ↑/↓, E, T, Shift + F10 (ou a tecla de menu), Delete, Ctrl + D, F2 (freeLayerKeyAction, testado).
// ↑/↓ andam pela lista que se ve; Alt + ↑/↓ e o ⋯ Subir e Descer movem na lista que se ve (Subir = mais para a
// frente; o editor faz a conta em children e na camada com moveFreeNodeStep).
// Arrastar (L4a, docs/27 §13.9): so com o mouse, pelo botao de selecionar da linha, a partir de 4 px
// (followFreePointer; antes disso e um clique). O lugar sai das linhas medidas (freeLayerDropAt: acima = na frente,
// abaixo = atras, dentro de uma caixa = atras dos filhos dela, abaixo da ultima = o fundo do pop-up; o lugar em
// children sai de freeLayerDropTarget), nunca da posicao horizontal; fora do painel das Camadas nao ha lugar. A foto do design e tirada quando o arrastar comeca (um Renomear que termina no pointerdown ja entra nela) e
// o lugar e recalculado com o ponto do soltar e quando a lista rola. A propria linha e o mesmo lugar (nada aparece), e
// soltar no mesmo lugar seleciona a linha, como o clique que tremeu; um lugar recusado mostra o motivo e o cursor de
// proibido. Soltar leva a run({ kind: "move" }): um passo, o elemento selecionado e o foco na linha. Com "Ver como:
// Celular", a etiqueta diz que a ordem muda tambem no computador. Perto da borda de cima ou de baixo, a lista rola
// sozinha (autoScroll no tabpanel, L44).
// Escolher varios (L4b, docs/27 L36 e L37): Ctrl/⌘ + clique poe ou tira, Shift + clique pega o intervalo desde a
// ancora (o editor decide), Shift + ↑/↓ estende e Ctrl/⌘ + Enter poe ou tira pelo teclado. O arrastar da linha nao
// comeca com Shift, Ctrl, ⌘ ou Alt (o clique escolhe). As linhas escolhidas ficam marcadas; aria-current so no
// principal e a etiqueta "Na seleção" nas outras. E, T, Delete e Ctrl + D numa linha que esta numa selecao de 2 ou
// mais agem na selecao (selection: true); o olho, o cadeado, o ⋯ (Duplicar e Excluir inclusive), F2 e Alt + ↑/↓
// agem so na linha.

const copy = FREE_EDITOR_COPY.layers;

export type FreeLayerCommand =
  | {
      id: FreeId;
      kind: "duplicate" | "moveDown" | "moveUp" | "outOfBox" | "remove" | "toggleHidden" | "toggleLocked";
      /** A tecla da linha (E, T, Delete ou Ctrl + D) numa selecao de 2 ou mais: o editor age em todos os escolhidos. */
      selection?: true;
    }
  | { boxId: FreeId; id: FreeId; kind: "intoBox" }
  | { id: FreeId; kind: "move"; target: FreeMoveTarget }
  | { id: FreeId; kind: "rename"; name: string };

/** Como o clique (ou a tecla) escolhe a linha: so ela, por ou tirar (Ctrl/⌘) ou o intervalo desde a ancora (Shift). */
export type FreeLayerSelectHow = "only" | "range" | "toggle";

export type FreeLayersPanelProps = {
  cta: NoticeDraft["cta"];
  design: PopupFreeDesign;
  /** O "Ver como": com Celular, o indicador do arrastar diz que a ordem muda tambem no computador. */
  device?: "desktop" | "mobile";
  disabled: boolean;
  flagged: ReadonlySet<FreeId>;
  onCommand: (command: FreeLayerCommand) => void;
  /** Sem `how`, so a linha (como o Enter e o soltar no mesmo lugar). */
  onSelect: (id: FreeId, how?: FreeLayerSelectHow) => void;
  /** O principal (o ultimo escolhido): aria-current, o Tab e o foco que acompanha o desenho. */
  selectedId: FreeId | null;
  /** Todos os escolhidos, na ordem da escolha (o ultimo e o principal). Sem a prop: so o selectedId. */
  selectedIds?: readonly FreeId[];
};

const BUTTONS = 4;

/** As teclas da linha que agem na selecao de 2 ou mais (L37): E, T, Delete e Ctrl + D. Alt + ↑/↓ fica na linha. */
const SELECTION_KEY_KINDS: ReadonlySet<string> = new Set(["duplicate", "remove", "toggleHidden", "toggleLocked"]);

/**
 * O comando de uma tecla da linha: `selection: true` so com E, T, Delete ou Ctrl + D numa linha que esta numa selecao
 * de 2 ou mais (o editor age em todos, um passo so). Fora dela, com um escolhido so, ou com Alt + ↑/↓, so a linha. O
 * olho, o cadeado e o ⋯ nao passam por aqui: agem sempre so na linha (C17).
 */
export function freeLayerKeyCommand(
  kind: "duplicate" | "moveDown" | "moveUp" | "remove" | "toggleHidden" | "toggleLocked",
  id: FreeId,
  selectedIds: readonly FreeId[]
): FreeLayerCommand {
  return SELECTION_KEY_KINDS.has(kind) && selectedIds.length >= 2 && selectedIds.includes(id) ? { id, kind, selection: true } : { id, kind };
}

/** O clique na linha: Ctrl ou ⌘ poe ou tira (vale antes do Shift), Shift pega o intervalo, sem tecla so ela. */
export function freeLayerClickHow(event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): FreeLayerSelectHow {
  if (event.ctrlKey || event.metaKey) {
    return "toggle";
  }

  return event.shiftKey ? "range" : "only";
}

/** O arrastar da linha so comeca sem tecla: com Shift, Ctrl, ⌘ ou Alt o pointerdown e so o comeco de um clique. */
export function freeLayerDragAllowed(event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean {
  return !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

const LAYER_ICONS: Record<Exclude<FreeNode["type"], "box" | "button">, LucideIcon> = {
  audio: AudioLines,
  badge: Tag,
  countdown: Timer,
  divider: Minus,
  heading: Heading,
  icon: Sparkles,
  image: ImageIcon,
  links: Link2,
  shape: Square,
  spacer: MoveVertical,
  text: Pilcrow,
  video: Video
};

/** O icone do tipo na linha (mapa fixo; a caixa e o botao dependem da direcao e da acao). */
function LayerIcon({ node }: { node: FreeNode | null }) {
  const className = "size-3.5 shrink-0 text-[var(--text-secondary)]";

  if (!node) {
    return <Square aria-hidden="true" className={className} />;
  }

  if (node.type === "button") {
    return node.action.kind === "cta" ? <MousePointerClick aria-hidden="true" className={className} /> : <RectangleHorizontal aria-hidden="true" className={className} />;
  }

  if (node.type === "box") {
    return node.layout?.dir === "row" ? <Columns3 aria-hidden="true" className={className} /> : <Rows3 aria-hidden="true" className={className} />;
  }

  const Icon = LAYER_ICONS[node.type];

  return <Icon aria-hidden="true" className={className} />;
}

/**
 * Etiqueta da linha (Na seleção, Solta, Escondida, Travada e Celular, quando o elemento tem valores proprios do
 * celular): 12 px, nunca menos (docs/17); a linha quebra quando nao cabem lado a lado.
 */
function Tag2({ children }: { children: ReactNode }) {
  return <span className="shrink-0 rounded-sm bg-[var(--surface-3)] px-1 text-[12px] leading-4 text-[var(--text-secondary)]">{children}</span>;
}

/** Uma linha medida (px de tela): o que freeLayerDropAt le, mais o lado esquerdo e a largura para desenhar o indicador. */
type MeasuredLine = FreeLayerLine & { left: number; width: number };

/**
 * O indicador do arrastar, em px a partir do canto da lista: a linha de onde entra (recuada no nivel de destino) ou
 * o contorno da caixa no "dentro", e a etiqueta (o motivo da recusa ou, com o Celular, que a ordem muda tambem no
 * computador).
 */
type LayerDropView = {
  both: boolean;
  inside: { height: number; left: number; top: number; width: number } | null;
  labelTop: number;
  line: { left: number; top: number; width: number } | null;
  reason: string | null;
};

/** Um arrastar comecado (passou do limiar): a foto do design e o ultimo ponto, para recalcular quando a lista rola. */
type LayerGesture = { design: PopupFreeDesign; id: FreeId; panel: HTMLElement | null; point: FreePoint | null; stopScroll: () => void };

/** Onde o ponteiro solta agora: o lugar e o problema (null = da; "" = o mesmo lugar ou nada muda; texto = o motivo). */
type LayerDropAt = { problem: string | null; target: FreeMoveTarget | null; view: LayerDropView | null };

/** Altura reservada para a etiqueta do indicador (uma linha de 12 px com a borda). */
const DROP_LABEL_PX = 22;

/** As linhas das Camadas medidas agora, de cima para baixo (a div de cada linha, sem os filhos de uma caixa). */
function measureLayerLines(list: HTMLElement): MeasuredLine[] {
  return Array.from(list.querySelectorAll<HTMLElement>("[data-free-layer-line]"), (element) => {
    const rect = element.getBoundingClientRect();

    return {
      box: element.hasAttribute("data-free-layer-box"),
      height: rect.height,
      id: element.getAttribute("data-free-layer-line") ?? "",
      left: rect.left,
      top: rect.top,
      width: rect.width
    };
  });
}

export function FreeLayersPanel({ cta, design, device = "desktop", disabled, flagged, onCommand, onSelect, selectedId, selectedIds }: FreeLayersPanelProps) {
  const rows = freeLayerRows(design, cta, flagged);
  // Sem a lista (o editor de antes do L4b), so o principal esta escolhido.
  const chosen = selectedIds ?? (selectedId ? [selectedId] : []);
  const listRef = useRef<HTMLUListElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [focusedId, setFocusedId] = useState<FreeId | null>(null);
  const [menuFor, setMenuFor] = useState<FreeId | null>(null);
  const [renaming, setRenaming] = useState<{ id: FreeId; value: string } | null>(null);
  const [dragId, setDragId] = useState<FreeId | null>(null);
  const [dropView, setDropView] = useState<LayerDropView | null>(null);
  const pendingFocus = useRef<{ button: number; id: FreeId } | null>(null);
  // O elemento levado pelo ⋯ (Subir, Descer, Colocar dentro, Tirar): o foco volta ao botao 0 da linha dele.
  const menuMoved = useRef<FreeId | null>(null);
  // O de agora, para o arrastar (os ouvintes ficam na janela durante o gesto e nao veem a renderizacao nova).
  const latest = useRef({ design, device, disabled, onCommand, onSelect, rows });
  const gestureRef = useRef<LayerGesture | null>(null);
  const disposeDrag = useRef<(() => void) | null>(null);
  const dropKey = useRef("");
  const rowIds = rows.map((row) => row.id);
  // O botao com tabIndex 0: o que tem o foco, senao o selecionado (com varios, o principal), senao o primeiro.
  const tabId = focusedId && rowIds.includes(focusedId) ? focusedId : selectedId && rowIds.includes(selectedId) ? selectedId : (rowIds[0] ?? null);

  useLayoutEffect(() => {
    latest.current = { design, device, disabled, onCommand, onSelect, rows };
  });

  // Ao desmontar no meio de um arrastar: desliga o gesto e o ouvinte de rolagem.
  useEffect(
    () => () => {
      disposeDrag.current?.();
      gestureRef.current?.stopScroll();
    },
    []
  );

  // A selecao feita no desenho leva o lugar do Tab junto (sem roubar o foco): com varios, o do principal.
  useEffect(() => {
    if (selectedId && !listRef.current?.contains(document.activeElement)) {
      setFocusedId(selectedId);
    }
  }, [selectedId]);

  // Depois de subir, descer, entrar/sair de caixa ou renomear, o foco fica no mesmo elemento.
  useLayoutEffect(() => {
    const pending = pendingFocus.current;

    if (!pending || !listRef.current) {
      return;
    }

    const target = listRef.current.querySelector<HTMLElement>(`[data-free-layer-row="${pending.id}"] [data-free-layer-button="${pending.button}"]`);

    if (target) {
      pendingFocus.current = null;
      target.focus();
    }
  });

  function focusRow(id: FreeId, button = 0) {
    pendingFocus.current = { button, id };
    setFocusedId(id);

    const target = listRef.current?.querySelector<HTMLElement>(`[data-free-layer-row="${id}"] [data-free-layer-button="${button}"]`);

    if (target) {
      pendingFocus.current = null;
      target.focus();
    }
  }

  /**
   * Manda o comando ao editor, com o foco ficando na linha. Le o de agora (ligado ou nao, e o onCommand): o soltar do
   * arrastar chama isto de um ouvinte ligado no pointerdown, numa renderizacao anterior.
   */
  function run(command: FreeLayerCommand, keepFocus = true) {
    if (latest.current.disabled) {
      return;
    }

    if (keepFocus) {
      pendingFocus.current = { button: 0, id: command.id };
    }

    latest.current.onCommand(command);
  }

  /** Um item do ⋯ que muda o lugar do elemento: o ⋯ devolve o foco ao botao 0 da linha dele (finalFocus). */
  function runFromMenu(command: FreeLayerCommand) {
    menuMoved.current = command.id;
    run(command);
  }

  function openMenu(id: FreeId | null) {
    if (id !== null) {
      menuMoved.current = null;
    }

    setMenuFor(id);
  }

  /**
   * Para onde vai o foco quando o ⋯ fecha. Depois de mover, o botao 0 da linha movida (a linha pode ter mudado de <ul>
   * e o ⋯ que abriu, desmontado; se ela ainda nao esta no DOM, nada aqui: o pendingFocus da lista leva o foco).
   * Sem mover, o padrao (o ⋯) so quando o foco ainda esta no menu ou se perdeu: uma funcao aqui e "explicita" para o
   * Base UI, e devolver o padrao sempre tiraria o foco do campo do Renomear.
   */
  function menuFinalFocus(): boolean | HTMLElement {
    const id = menuMoved.current;

    menuMoved.current = null;

    if (id !== null) {
      return listRef.current?.querySelector<HTMLElement>(`[data-free-layer-row="${id}"] [data-free-layer-button="0"]`) ?? false;
    }

    const active = document.activeElement;

    return !active || active === document.body || Boolean(active.closest("[role='menu']"));
  }

  /** Troca o indicador so quando ele muda (a lista redesenha a cada troca). */
  function showLayerDrop(next: LayerDropView | null) {
    const key = next ? JSON.stringify(next) : "";

    if (key !== dropKey.current) {
      dropKey.current = key;
      setDropView(next);
    }
  }

  /**
   * O lugar de soltar neste ponto (px de tela), lido no design da foto e nas linhas medidas agora. Null fora do painel
   * das Camadas ou quando o design mudou desde o comeco (o soltar nao grava nada). A propria linha arrastada, em
   * qualquer zona, e o mesmo lugar: problema "", sem indicador.
   */
  function layerDropAt(client: FreePoint, gesture: LayerGesture): LayerDropAt | null {
    const list = listRef.current;
    const wrap = wrapRef.current;
    const area = (gesture.panel ?? wrap)?.getBoundingClientRect();

    if (!list || !wrap || !area || latest.current.design !== gesture.design) {
      return null;
    }

    if (client.x < area.left || client.x > area.right || client.y < area.top || client.y > area.bottom) {
      return null;
    }

    const lines = measureLayerLines(list);
    const over = freeLayerDropAt(lines, client.y);

    if (!over) {
      return null;
    }

    if ("id" in over && over.id === gesture.id) {
      return { problem: "", target: null, view: null };
    }

    const target = freeLayerDropTarget(gesture.design, over, gesture.id);

    if (!target) {
      return null;
    }

    const problem = freeMoveProblem(gesture.design, gesture.id, target);

    return { problem, target, view: problem === "" ? null : layerDropView(lines, over, target, problem, wrap.getBoundingClientRect()) };
  }

  /** O indicador de um lugar: a linha recuada no nivel do pai de destino, ou o contorno da caixa no "dentro". */
  function layerDropView(lines: readonly MeasuredLine[], over: FreeLayerOver, target: FreeMoveTarget, problem: string | null, wrap: DOMRect): LayerDropView {
    const first = lines[0];
    const last = lines[lines.length - 1];
    const lineOf = (id: FreeId) => lines.find((line) => line.id === id) ?? last;
    const reason = problem || null;
    const both = !reason && latest.current.device === "mobile";
    const label = (below: number, above: number) => (below + DROP_LABEL_PX <= wrap.height ? below : Math.max(0, above - DROP_LABEL_PX));

    if (!("bottom" in over) && over.edge === "inside") {
      const box = lineOf(over.id);
      const top = box.top - wrap.top;

      return {
        both,
        inside: { height: box.height, left: box.left - wrap.left, top, width: box.width },
        labelTop: label(top + box.height + 2, top - 2),
        line: null,
        reason
      };
    }

    // O vao entre duas linhas tem 2 px: a linha do indicador fica no meio dele.
    const y = ("bottom" in over ? last.top + last.height + 1 : over.edge === "above" ? lineOf(over.id).top - 1 : lineOf(over.id).top + lineOf(over.id).height + 1) - wrap.top;
    const parentDepth = target.parentId === null ? 0 : (latest.current.rows.find((row) => row.id === target.parentId)?.depth ?? 0);
    const left = first.left - wrap.left + 4 + parentDepth * 14;
    const right = first.left - wrap.left + first.width;

    return { both, inside: null, labelTop: label(y + 4, y - 4), line: { left, top: y, width: Math.max(0, right - left) }, reason };
  }

  function endLayerDrag() {
    gestureRef.current?.stopScroll();
    gestureRef.current = null;
    setDragId(null);
    showLayerDrop(null);
  }

  /**
   * O arrastar da linha (so o mouse, a partir de 4 px, e so sem tecla: com Shift, Ctrl, ⌘ ou Alt e um clique de
   * escolher). A foto do design e tirada no onStart, depois do limiar: um Renomear de outra linha termina no blur do
   * pointerdown e ja entra nela. O soltar recalcula o lugar com o ponto do pointerup (a lista pode ter rolado sem o
   * ponteiro andar) e leva a run({ kind: "move" }), com o foco na linha. No mesmo lugar, so seleciona (o click do botao
   * solto e engolido pelo ajudante); o Esc no meio nao seleciona nada. Perto da borda de cima ou de baixo do painel
   * das Camadas, a lista rola sozinha (autoScroll: o tabpanel que rola, o mesmo do ouvinte de rolagem).
   */
  function beginLayerDrag(event: ReactPointerEvent<HTMLButtonElement>, id: FreeId) {
    // Um gesto comecado segue ate o fim: o pointerdown de outro ponteiro (um toque com o mouse apertado) nao o desliga.
    if (disabled || gestureRef.current || !freeLayerDragAllowed(event)) {
      return;
    }

    disposeDrag.current?.();

    let gesture: LayerGesture | null = null;

    disposeDrag.current = followFreePointer(event, {
      autoScroll: () => gesture?.panel ?? null,
      onCancel: endLayerDrag,
      onDrop: (client) => {
        const current = gesture;
        const drop = current ? layerDropAt(client, current) : null;

        endLayerDrag();

        if (!current || !drop) {
          return;
        }

        // Soltar no mesmo lugar (a propria linha ou um vao que nao muda nada) e um clique que tremeu: seleciona, como o
        // clique faria. O click que vem depois do soltar e engolido pelo bloqueador do ajudante.
        if (drop.problem === "") {
          latest.current.onSelect(current.id);

          return;
        }

        if (!drop.target) {
          return;
        }

        // Com o motivo, o editor so fala a frase (nada muda); o foco fica na linha do mesmo jeito.
        run({ id: current.id, kind: "move", target: drop.target });
      },
      onMove: (client) => {
        if (!gesture) {
          return;
        }

        gesture.point = client;
        showLayerDrop(layerDropAt(client, gesture)?.view ?? null);
      },
      onStart: () => {
        const panel = listRef.current?.closest<HTMLElement>("[role='tabpanel']") ?? null;
        // A roda do mouse rola a lista sem mexer o ponteiro: o indicador acompanha.
        const onScroll = () => {
          if (gesture?.point && gestureRef.current === gesture) {
            showLayerDrop(layerDropAt(gesture.point, gesture)?.view ?? null);
          }
        };

        panel?.addEventListener("scroll", onScroll, { capture: true, passive: true });
        gesture = { design: latest.current.design, id, panel, point: null, stopScroll: () => panel?.removeEventListener("scroll", onScroll, { capture: true }) };
        gestureRef.current = gesture;
        setDragId(id);
      },
      threshold: FREE_LIST_DRAG_START_PX
    });
  }

  function onRowKeyDown(event: KeyboardEvent<HTMLElement>, row: FreeLayerRow, button: number) {
    const action = freeLayerKeyAction(event, { button, buttons: BUTTONS, row: rowIds.indexOf(row.id), rows: rowIds.length });

    if (!action) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    (event as unknown as { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();

    switch (action.kind) {
      case "row":
        focusRow(rowIds[action.index] ?? row.id);
        break;
      case "extend": {
        // Shift + ↑/↓: o foco vai a linha vizinha e o intervalo vai da ancora ate ela. Na ponta da lista, nada muda.
        const next = rowIds[action.index] ?? row.id;

        focusRow(next);

        if (next !== row.id) {
          onSelect(next, "range");
        }

        break;
      }
      case "button":
        focusRow(row.id, action.index);
        break;
      case "select":
        onSelect(row.id);
        break;
      case "toggleSelect":
        onSelect(row.id, "toggle");
        break;
      case "toggleHidden":
      case "toggleLocked":
      case "duplicate":
      case "remove":
      case "moveUp":
      case "moveDown":
        run(freeLayerKeyCommand(action.kind, row.id, chosen), action.kind !== "remove");
        break;
      case "menu":
        openMenu(row.id);
        break;
      case "rename":
        startRename(row);
        break;
    }
  }

  function startRename(row: FreeLayerRow) {
    if (disabled) {
      return;
    }

    setRenaming({ id: row.id, value: freeNodeOf(design, row.id)?.name ?? "" });
  }

  function finishRename(save: boolean) {
    if (!renaming) {
      return;
    }

    const { id, value } = renaming;

    setRenaming(null);
    pendingFocus.current = { button: 0, id };

    if (save) {
      onCommand({ id, kind: "rename", name: value });
    }
  }

  const ctx: RowContext = {
    beginDrag: beginLayerDrag,
    chosen: new Set(chosen),
    design,
    disabled,
    dragId,
    finishRename,
    menuFinalFocus,
    menuFor,
    onButtonFocus: setFocusedId,
    onKey: onRowKeyDown,
    onSelect,
    renaming,
    rows,
    run,
    runFromMenu,
    selectedId,
    setMenuFor: openMenu,
    setRenameValue: (id, value) => setRenaming({ id, value }),
    startRename,
    tabId
  };

  if (rows.length === 0) {
    return <p className="p-3 text-[13px] text-[var(--text-secondary)]">{copy.empty}</p>;
  }

  return (
    <div
      // O cursor: pointer de todo botao (globals.css, fora das camadas) so cede com o ! (os botoes da linha, inclusive o
      // que tem a captura do ponteiro durante o arrastar).
      className={cn("relative min-w-0", dragId && (dropView?.reason ? "cursor-not-allowed **:cursor-not-allowed!" : "cursor-grabbing **:cursor-grabbing!"))}
      data-free-layer-list=""
      ref={wrapRef}
    >
      <ul aria-label={copy.listLabel} className="m-0 flex min-w-0 list-none flex-col gap-0.5 p-2" ref={listRef}>
        <LayerLevel ctx={ctx} parentId={null} />
      </ul>
      {dropView?.line ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute h-0.5 -translate-y-1/2 rounded-full bg-[var(--focus-ring)]"
          data-free-layer-drop=""
          style={{ left: dropView.line.left, top: dropView.line.top, width: dropView.line.width }}
        />
      ) : null}
      {dropView?.inside ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-md ring-2 ring-[var(--focus-ring)] ring-inset"
          data-free-layer-drop-inside=""
          style={{ height: dropView.inside.height, left: dropView.inside.left, top: dropView.inside.top, width: dropView.inside.width }}
        />
      ) : null}
      {dropView && (dropView.reason || dropView.both) ? (
        <span aria-hidden="true" className="pointer-events-none absolute right-2 left-2 z-10 flex justify-end" style={{ top: dropView.labelTop }}>
          {dropView.reason ? (
            <span className="rounded-sm border border-[var(--border-strong)] bg-[var(--surface-3)] px-1.5 text-[12px] leading-[18px] font-medium text-[var(--text-primary)]" data-free-layer-drop-hint="">
              {dropView.reason}
            </span>
          ) : (
            <span className="rounded-sm border border-[var(--border-strong)] bg-[var(--surface-3)] px-1.5 text-[12px] leading-[18px] font-medium text-[var(--text-primary)]" data-free-layer-drop-both="">
              {FREE_EDITOR_COPY.drag.alsoDesktopTag}
            </span>
          )}
        </span>
      ) : null}
    </div>
  );
}

type RowContext = {
  beginDrag: (event: ReactPointerEvent<HTMLButtonElement>, id: FreeId) => void;
  /** Os escolhidos (o principal inclusive). */
  chosen: ReadonlySet<FreeId>;
  design: PopupFreeDesign;
  disabled: boolean;
  dragId: FreeId | null;
  finishRename: (save: boolean) => void;
  menuFinalFocus: () => boolean | HTMLElement;
  menuFor: FreeId | null;
  onButtonFocus: (id: FreeId) => void;
  onKey: (event: KeyboardEvent<HTMLElement>, row: FreeLayerRow, button: number) => void;
  onSelect: (id: FreeId, how?: FreeLayerSelectHow) => void;
  renaming: { id: FreeId; value: string } | null;
  rows: readonly FreeLayerRow[];
  run: (command: FreeLayerCommand, keepFocus?: boolean) => void;
  runFromMenu: (command: FreeLayerCommand) => void;
  /** O principal. */
  selectedId: FreeId | null;
  setMenuFor: (id: FreeId | null) => void;
  setRenameValue: (id: FreeId, value: string) => void;
  startRename: (row: FreeLayerRow) => void;
  tabId: FreeId | null;
};

function LayerLevel({ ctx, parentId }: { ctx: RowContext; parentId: FreeId | null }) {
  return ctx.rows.filter((row) => row.parentId === parentId).map((row) => <LayerItem ctx={ctx} key={row.id} row={row} />);
}

function LayerItem({ ctx, row }: { ctx: RowContext; row: FreeLayerRow }) {
  const { design, disabled, menuFor, renaming, run, selectedId, tabId } = ctx;
  const node = freeNodeOf(design, row.id);
  const principal = row.id === selectedId;
  // Escolhida: o mesmo fundo do principal. Com 2 ou mais, as outras escolhidas ganham a etiqueta "Na seleção".
  const selected = principal || ctx.chosen.has(row.id);
  const inSelection = selected && !principal && ctx.chosen.size >= 2;
  const tagged = inSelection || row.free || row.hidden || row.locked || row.mobile;
  const isTab = row.id === tabId;
  const removeProblem = freeRemoveProblem(design, row.id);
  const duplicateProblem = freeDuplicateProblem(design, row.id);
  const boxes = freeBoxTargets(design, row.id);
  const hasChildren = row.type === "box" && ctx.rows.some((item) => item.parentId === row.id);
  const dragging = ctx.dragId === row.id;
  const buttonProps = (index: number) => ({
    "data-free-layer-button": index,
    onFocus: () => ctx.onButtonFocus(row.id),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => ctx.onKey(event, row, index),
    tabIndex: index === 0 && isTab ? 0 : -1
  });
  return (
    <li className="min-w-0" data-free-layer-row={row.id} key={row.id}>
      <div
        className={cn(
          "group/row flex min-h-9 min-w-0 items-center gap-0.5 rounded-md pr-1",
          selected ? "bg-[var(--surface-3)] shadow-[inset_2px_0_0_var(--focus-ring)]" : "hover:bg-[var(--hover-overlay)]",
          row.hidden && "opacity-60",
          dragging && "opacity-50"
        )}
        data-free-layer-box={row.type === "box" ? "" : undefined}
        data-free-layer-dragging={dragging ? "" : undefined}
        data-free-layer-line={row.id}
        style={{ paddingLeft: 4 + (row.depth - 1) * 14 }}
      >
        {renaming?.id === row.id ? (
          <input
            aria-label={copy.renameLabel}
            autoFocus
            className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-primary)]"
            maxLength={40}
            onBlur={() => ctx.finishRename(true)}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => ctx.setRenameValue(row.id, event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();

              if (event.key === "Enter") {
                event.preventDefault();
                ctx.finishRename(true);
              } else if (event.key === "Escape") {
                event.preventDefault();
                ctx.finishRename(false);
              }
            }}
            value={renaming.value}
          />
        ) : (
          <button
            {...buttonProps(0)}
            aria-current={principal ? "true" : undefined}
            aria-describedby={tagged ? `free-layer-tags-${row.id}` : undefined}
            aria-label={row.selectLabel}
            className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] leading-5 text-[var(--text-primary)] select-none"
            data-free-layer-select=""
            onClick={(event) => ctx.onSelect(row.id, freeLayerClickHow(event))}
            onPointerDown={(event) => ctx.beginDrag(event, row.id)}
            type="button"
          >
            <LayerIcon node={node} />
            <span className="flex min-w-0 flex-1 flex-col py-0.5">
              <span className="min-w-0 truncate">{row.label}</span>
              {tagged ? (
                <span className="flex min-w-0 flex-wrap gap-1" id={`free-layer-tags-${row.id}`}>
                  {inSelection ? <Tag2>{FREE_SELECTION_COPY.inSelection}</Tag2> : null}
                  {row.free ? <Tag2>{copy.tags.free}</Tag2> : null}
                  {row.hidden ? <Tag2>{copy.tags.hidden}</Tag2> : null}
                  {row.locked ? <Tag2>{copy.tags.locked}</Tag2> : null}
                  {row.mobile ? <Tag2>{copy.tags.mobile}</Tag2> : null}
                </span>
              ) : null}
            </span>
            {row.warning ? (
              <span className="shrink-0 text-[var(--warning)]" title={copy.warning}>
                <TriangleAlert aria-hidden="true" className="size-3.5" />
                <span className="sr-only">{copy.warning}</span>
              </span>
            ) : null}
          </button>
        )}
        <button
          {...buttonProps(1)}
          aria-label={copy.hide}
          aria-pressed={row.hidden}
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--press-overlay)] hover:text-[var(--text-primary)]",
            adminTransition,
            !row.hidden && "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
          )}
          disabled={disabled}
          onClick={() => run({ id: row.id, kind: "toggleHidden" })}
          title={row.hidden ? copy.show : copy.hide}
          type="button"
        >
          {row.hidden ? <EyeOff aria-hidden="true" className="size-3.5" /> : <Eye aria-hidden="true" className="size-3.5" />}
        </button>
        <button
          {...buttonProps(2)}
          aria-label={copy.lock}
          aria-pressed={row.locked}
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--press-overlay)] hover:text-[var(--text-primary)]",
            adminTransition,
            !row.locked && "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
          )}
          disabled={disabled}
          onClick={() => run({ id: row.id, kind: "toggleLocked" })}
          title={row.locked ? copy.unlock : copy.lock}
          type="button"
        >
          {row.locked ? <Lock aria-hidden="true" className="size-3.5" /> : <LockOpen aria-hidden="true" className="size-3.5" />}
        </button>
        <DropdownMenu onOpenChange={(open) => ctx.setMenuFor(open ? row.id : null)} open={menuFor === row.id}>
          <DropdownMenuTrigger
            {...buttonProps(3)}
            aria-label={`${copy.menu}: ${row.label}`}
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--press-overlay)] hover:text-[var(--text-primary)] data-popup-open:bg-[var(--surface-2)]",
              adminTransition
            )}
            disabled={disabled}
          >
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-60 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-1 text-[var(--text-primary)] ring-0"
            finalFocus={ctx.menuFinalFocus}
            sideOffset={4}
          >
            {/* O ⋯ e da linha: Duplicar e Excluir agem so nela, mesmo com a linha numa selecao de varios (C17). */}
            <MenuEntry disabledReason={duplicateProblem} label={copy.duplicate} onSelect={() => run({ id: row.id, kind: "duplicate" })} />
            <MenuEntry disabledReason={row.index === 0 ? "" : null} label={copy.moveUp} onSelect={() => ctx.runFromMenu({ id: row.id, kind: "moveUp" })} />
            <MenuEntry disabledReason={row.index >= row.siblings - 1 ? "" : null} label={copy.moveDown} onSelect={() => ctx.runFromMenu({ id: row.id, kind: "moveDown" })} />
            {boxes.length > 0 ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="min-h-9 rounded-md px-2 py-1.5 text-sm leading-5 focus:bg-[var(--surface-2)]">{copy.intoBox}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-1 text-[var(--text-primary)] ring-0">
                  {boxes.map((box) => (
                    <MenuEntry key={box.id} label={box.label} onSelect={() => ctx.runFromMenu({ boxId: box.id, id: row.id, kind: "intoBox" })} />
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : (
              <MenuEntry disabledReason={copy.noBox} label={copy.intoBox} onSelect={() => undefined} />
            )}
            {/* Fora de caixa, desligado sem frase; com a caixa de fora cheia (20), desligado com a frase. */}
            <MenuEntry disabledReason={row.inBox ? freeOutOfBoxProblem(design, row.id) : ""} label={copy.outOfBox} onSelect={() => ctx.runFromMenu({ id: row.id, kind: "outOfBox" })} />
            <MenuEntry label={copy.rename} onSelect={() => ctx.startRename(row)} />
            <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
            <MenuEntry destructive disabledReason={removeProblem} label={copy.remove} onSelect={() => run({ id: row.id, kind: "remove" }, false)} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {hasChildren ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          <LayerLevel ctx={ctx} parentId={row.id} />
        </ul>
      ) : null}
    </li>
  );
}

/** Um item do ⋯. `disabledReason`: null = ligado; "" = desligado sem frase; texto = desligado com a frase embaixo. */
function MenuEntry({ destructive = false, disabledReason = null, label, onSelect }: { destructive?: boolean; disabledReason?: string | null; label: string; onSelect: () => void }) {
  const off = disabledReason !== null;

  return (
    <DropdownMenuItem
      className={cn(
        "min-h-9 flex-col items-start gap-0 rounded-md px-2 py-1.5 text-sm leading-5",
        destructive ? "text-[var(--error)] focus:bg-[var(--error-bg)] focus:text-[var(--error)]" : "text-[var(--text-primary)] focus:bg-[var(--surface-2)] focus:text-[var(--text-primary)]"
      )}
      disabled={off}
      onClick={() => {
        if (!off) {
          onSelect();
        }
      }}
    >
      <span>{label}</span>
      {disabledReason ? <span className="text-xs leading-4 text-[var(--text-secondary)]">{disabledReason}</span> : null}
    </DropdownMenuItem>
  );
}
