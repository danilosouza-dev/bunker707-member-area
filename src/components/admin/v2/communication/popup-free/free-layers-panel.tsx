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
  TriangleAlert,
  Video,
  type LucideIcon
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
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
import type { FreeMoveTarget } from "./free-editor-geometry";
import {
  FREE_EDITOR_COPY,
  freeBoxTargets,
  freeDuplicateProblem,
  freeLayerKeyAction,
  freeLayerRows,
  freeNodeOf,
  freeRemoveProblem,
  type FreeLayerRow
} from "./free-editor-model";

// Camadas do editor Livre (spec §4.5): a lista em arvore na ordem do DOM (de cima para baixo = ordem de leitura),
// em <ul>/<li> aninhados (nao role="tree": as linhas tem botoes dentro). Foco itinerante: um so botao de selecao
// com tabIndex 0 por vez; Esconder, Travar e ⋯ de cada linha ficam com tabIndex -1 e sao alcancados por → / ←
// dentro da linha (com 32 linhas, o Tab passa pela lista uma vez so). Teclado: ↑/↓, →/←, Enter, Alt + ↑/↓, E, T,
// Shift + F10 (ou a tecla de menu), Delete, Ctrl + D, F2 (freeLayerKeyAction, testado).

const copy = FREE_EDITOR_COPY.layers;

export type FreeLayerCommand =
  | { id: FreeId; kind: "duplicate" | "moveDown" | "moveUp" | "outOfBox" | "remove" | "toggleHidden" | "toggleLocked" }
  | { boxId: FreeId; id: FreeId; kind: "intoBox" }
  | { id: FreeId; kind: "move"; target: FreeMoveTarget }
  | { id: FreeId; kind: "rename"; name: string };

export type FreeLayersPanelProps = {
  cta: NoticeDraft["cta"];
  design: PopupFreeDesign;
  /** O "Ver como": com Celular, o indicador do arrastar diz que a ordem muda tambem no computador. */
  device?: "desktop" | "mobile";
  disabled: boolean;
  flagged: ReadonlySet<FreeId>;
  onCommand: (command: FreeLayerCommand) => void;
  onSelect: (id: FreeId) => void;
  selectedId: FreeId | null;
};

const BUTTONS = 4;

const LAYER_ICONS: Record<Exclude<FreeNode["type"], "box" | "button">, LucideIcon> = {
  audio: AudioLines,
  badge: Tag,
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
 * Etiqueta da linha (Solta, Escondida, Travada e Celular, quando o elemento tem valores proprios do celular): 12 px,
 * nunca menos (docs/17); a linha quebra quando nao cabem lado a lado.
 */
function Tag2({ children }: { children: ReactNode }) {
  return <span className="shrink-0 rounded-sm bg-[var(--surface-3)] px-1 text-[12px] leading-4 text-[var(--text-secondary)]">{children}</span>;
}

export function FreeLayersPanel({ cta, design, disabled, flagged, onCommand, onSelect, selectedId }: FreeLayersPanelProps) {
  const rows = freeLayerRows(design, cta, flagged);
  const listRef = useRef<HTMLUListElement>(null);
  const [focusedId, setFocusedId] = useState<FreeId | null>(null);
  const [menuFor, setMenuFor] = useState<FreeId | null>(null);
  const [renaming, setRenaming] = useState<{ id: FreeId; value: string } | null>(null);
  const pendingFocus = useRef<{ button: number; id: FreeId } | null>(null);
  const rowIds = rows.map((row) => row.id);
  // O botao com tabIndex 0: o que tem o foco, senao o selecionado, senao o primeiro.
  const tabId = focusedId && rowIds.includes(focusedId) ? focusedId : selectedId && rowIds.includes(selectedId) ? selectedId : (rowIds[0] ?? null);

  // A selecao feita no desenho leva o lugar do Tab junto (sem roubar o foco).
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

  function run(command: FreeLayerCommand, keepFocus = true) {
    if (disabled) {
      return;
    }

    if (keepFocus) {
      pendingFocus.current = { button: 0, id: command.id };
    }

    onCommand(command);
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
      case "button":
        focusRow(row.id, action.index);
        break;
      case "select":
        onSelect(row.id);
        break;
      case "toggleHidden":
      case "toggleLocked":
      case "duplicate":
      case "remove":
      case "moveUp":
      case "moveDown":
        run({ id: row.id, kind: action.kind }, action.kind !== "remove");
        break;
      case "menu":
        setMenuFor(row.id);
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
    design,
    disabled,
    finishRename,
    menuFor,
    onButtonFocus: setFocusedId,
    onKey: onRowKeyDown,
    onSelect,
    renaming,
    rows,
    run,
    selectedId,
    setMenuFor,
    setRenameValue: (id, value) => setRenaming({ id, value }),
    startRename,
    tabId
  };

  if (rows.length === 0) {
    return <p className="p-3 text-[13px] text-[var(--text-secondary)]">{copy.empty}</p>;
  }

  return (
    <ul aria-label={copy.listLabel} className="m-0 flex min-w-0 list-none flex-col gap-0.5 p-2" ref={listRef}>
      <LayerLevel ctx={ctx} parentId={null} />
    </ul>
  );
}

type RowContext = {
  design: PopupFreeDesign;
  disabled: boolean;
  finishRename: (save: boolean) => void;
  menuFor: FreeId | null;
  onButtonFocus: (id: FreeId) => void;
  onKey: (event: KeyboardEvent<HTMLElement>, row: FreeLayerRow, button: number) => void;
  onSelect: (id: FreeId) => void;
  renaming: { id: FreeId; value: string } | null;
  rows: readonly FreeLayerRow[];
  run: (command: FreeLayerCommand, keepFocus?: boolean) => void;
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
  const selected = row.id === selectedId;
  const isTab = row.id === tabId;
  const removeProblem = freeRemoveProblem(design, row.id);
  const duplicateProblem = freeDuplicateProblem(design, row.id);
  const boxes = freeBoxTargets(design, row.id);
  const hasChildren = row.type === "box" && ctx.rows.some((item) => item.parentId === row.id);
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
          row.hidden && "opacity-60"
        )}
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
            aria-current={selected ? "true" : undefined}
            aria-describedby={row.free || row.hidden || row.locked || row.mobile ? `free-layer-tags-${row.id}` : undefined}
            aria-label={row.selectLabel}
            className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] leading-5 text-[var(--text-primary)]"
            data-free-layer-select=""
            onClick={() => ctx.onSelect(row.id)}
            type="button"
          >
            <LayerIcon node={node} />
            <span className="flex min-w-0 flex-1 flex-col py-0.5">
              <span className="min-w-0 truncate">{row.label}</span>
              {row.free || row.hidden || row.locked || row.mobile ? (
                <span className="flex min-w-0 flex-wrap gap-1" id={`free-layer-tags-${row.id}`}>
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
          <DropdownMenuContent align="end" className="w-60 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-1 text-[var(--text-primary)] ring-0" sideOffset={4}>
            <MenuEntry disabledReason={duplicateProblem} label={copy.duplicate} onSelect={() => run({ id: row.id, kind: "duplicate" })} />
            <MenuEntry disabledReason={row.index === 0 ? "" : null} label={copy.moveUp} onSelect={() => run({ id: row.id, kind: "moveUp" })} />
            <MenuEntry disabledReason={row.index >= row.siblings - 1 ? "" : null} label={copy.moveDown} onSelect={() => run({ id: row.id, kind: "moveDown" })} />
            {boxes.length > 0 ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="min-h-9 rounded-md px-2 py-1.5 text-sm leading-5 focus:bg-[var(--surface-2)]">{copy.intoBox}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-1 text-[var(--text-primary)] ring-0">
                  {boxes.map((box) => (
                    <MenuEntry key={box.id} label={box.label} onSelect={() => run({ boxId: box.id, id: row.id, kind: "intoBox" })} />
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : (
              <MenuEntry disabledReason={copy.noBox} label={copy.intoBox} onSelect={() => undefined} />
            )}
            <MenuEntry disabledReason={row.inBox ? null : ""} label={copy.outOfBox} onSelect={() => run({ id: row.id, kind: "outOfBox" })} />
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
