"use client";

import { Tabs } from "@base-ui/react/tabs";
import { Copy, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FreeHint, FreeMeasuredRects } from "@/server/communications/popup-free-checks";
import { findFreeNode, type FreeId, type FreeNodeType, type PopupFreeDesign } from "@/server/communications/popup-free-model";
import type { PopupFontOption } from "@/server/communications/popup-design-model";
import type { NoticeDraft } from "@/server/communications/schemas";
import { adminTransition } from "../../styles";
import { FreeArtboardSettings } from "./free-artboard-settings";
import type { FreeEditorContent } from "./free-editor";
import { freeDuplicateProblem, freeNodeTypeLabel, freeRemoveProblem } from "./free-editor-model";
import { focusFreeField, freeSmallButton, useLatest } from "./free-fields";
import { FreeInspectorAdvanced } from "./free-inspector-advanced";
import { FreeInspectorContent, type FreeSectionProps } from "./free-inspector-content";
import { FreeInspectorMobile } from "./free-inspector-mobile";
import { FREE_INSPECTOR_COPY, freeFocusTargetOf, freeTabAfterSelection, type FreeAlignEdge, type FreeInspectorTab, type FreeInspectorTarget } from "./free-inspector-model";
import { FreeInspectorStyle } from "./free-inspector-style";

// Editor Livre do pop-up (docs/27; spec §4.6, §4.7 e §9.6), pacote I: o painel da direita. Com um elemento
// escolhido: o tipo e o nome, Duplicar e Excluir, e as abas Conteúdo / Estilo / Avançado / Celular (a aba fica ao
// trocar de elemento do mesmo tipo; a Celular fica com qualquer um, e entrar nela liga o "Ver como: Celular"). Sem nada escolhido: o painel "Pop-up" (a prancheta e o X). Recebe pedidos de foco
// (erro do Revisar, elemento recem-adicionado, duplo clique no desenho): seleciona o elemento certo, abre a aba e
// poe o foco no campo. As mudancas vao para o editor com a chave de juntar passos (`<id>:<campo>`).

const C = FREE_INSPECTOR_COPY;

export type { FreeAlignEdge };
export type FreeEditorCommand =
  | { id: FreeId; kind: "backward" | "duplicate" | "forward" | "moveDown" | "moveUp" | "remove" | "toFree" | "toSequence" }
  | { edge: FreeAlignEdge; id: FreeId; kind: "align" }
  /** "Voltar tudo ao do computador" na aba Celular: a entrada do elemento sai (um passo no historico). */
  | { id: FreeId; kind: "mobileReset" }
  | { id: FreeId | null; kind: "select" };
/** O que pôr em foco no painel: `key` no formato das chaves de erro, sem "freeDesign."; `upload` = o botão Enviar imagem/vídeo do elemento. */
export type FreeFocusRequest = { intent?: "upload"; key: string };
export type FreeInspectorProps = {
  /** `content.onCtaChange` aqui já é o embrulhado pelo E (entra no histórico). */
  content: FreeEditorContent;
  design: PopupFreeDesign;
  /** O "Ver como" do editor. A aba Celular muda só o celular em qualquer aparelho; entrar nela liga o Celular. */
  device: "desktop" | "mobile";
  disabled: boolean;
  /** Erros com as chaves sem o prefixo "freeDesign." (nodes.<id>..., artboard..., close..., assets..., fonts, size). */
  errors: Readonly<Record<string, string>>;
  focusRequest: FreeFocusRequest | null;
  fonts: readonly PopupFontOption[];
  hints: readonly FreeHint[];
  onBusyChange: (reason: string | null) => void;
  onChange: (next: PopupFreeDesign, options?: { coalesceKey?: string }) => void;
  /** Texto e destino do Botão principal: entram no histórico { design, cta } com a coalesceKey. */
  onCtaChange: (cta: NoticeDraft["cta"], options?: { coalesceKey?: string }) => void;
  onCommand: (command: FreeEditorCommand) => void;
  /** Troca o "Ver como" (entrar na aba Celular liga o Celular). */
  onDeviceChange?: (device: "desktop" | "mobile") => void;
  onFocusHandled: () => void;
  onFontsChange: (fonts: PopupFontOption[]) => void;
  /** Retângulos medidos (px da prancheta), para o que o painel mostra (ex.: altura automática). */
  rects: FreeMeasuredRects;
  selectedId: FreeId | null;
};

type ElementTab = Exclude<FreeInspectorTab, "popup">;
type PendingFocus = { request: FreeFocusRequest; target: FreeInspectorTarget | null };

const tabClass = cn(
  "relative inline-flex h-9 min-w-0 flex-1 items-center justify-center rounded-md px-1.5 text-[13px] font-medium text-[var(--text-secondary)] outline-none",
  "hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus-ring)]",
  "data-[active]:bg-[var(--surface-3)] data-[active]:text-[var(--text-primary)] pointer-coarse:h-11",
  adminTransition
);

export function FreeInspector(props: FreeInspectorProps) {
  const { content, design, device, disabled, errors, focusRequest, fonts, hints, onBusyChange, onChange, onCommand, onCtaChange, onDeviceChange, onFocusHandled, onFontsChange, rects, selectedId } = props;
  const found = selectedId ? findFreeNode(design, selectedId) : null;
  const node = found?.node ?? null;
  const [tab, setTab] = useState<ElementTab>("content");
  const [shown, setShown] = useState<{ id: FreeId | null; type: FreeNodeType | null }>({ id: node?.id ?? null, type: node?.type ?? null });
  const [seenRequest, setSeenRequest] = useState<FreeFocusRequest | null>(null);
  const [pending, setPending] = useState<PendingFocus | null>(null);
  const designRef = useLatest(design);
  const latest = useCallback(() => designRef.current, [designRef]);
  const onFocusHandledRef = useLatest(onFocusHandled);
  const onCommandRef = useLatest(onCommand);

  // Pedido de foco novo: descobre o elemento, a aba e o campo (estado deste painel, decidido no render).
  if (focusRequest !== seenRequest) {
    setSeenRequest(focusRequest);

    if (focusRequest) {
      const target = freeFocusTargetOf(design, focusRequest);

      setPending({ request: focusRequest, target });

      if (target && target.tab !== "popup") {
        setTab(target.tab);
      }
    }
  }

  // Outro elemento escolhido: a aba fica no mesmo tipo; outro tipo volta para Conteúdo (menos quando um pedido de
  // foco ja escolheu a aba deste elemento).
  if ((node?.id ?? null) !== shown.id) {
    setShown({ id: node?.id ?? null, type: node?.type ?? null });

    if (!(pending?.target && pending.target.nodeId === (node?.id ?? null))) {
      setTab((current) => freeTabAfterSelection(current, shown.type, node?.type ?? null));
    }
  }

  // Leva o foco: primeiro seleciona o elemento do campo (se ainda nao), depois foca quando ele estiver na tela.
  useEffect(() => {
    if (!pending) {
      return;
    }

    const target = pending.target;

    if (target && target.nodeId !== selectedId) {
      onCommandRef.current({ id: target.nodeId, kind: "select" });
      return;
    }

    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        if (target) {
          focusFreeField(target.fieldId);
        }

        setPending(null);
        onFocusHandledRef.current();
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [onCommandRef, onFocusHandledRef, pending, selectedId, tab]);

  const change = useCallback(
    (next: PopupFreeDesign, field?: string) => {
      onChange(next, field ? { coalesceKey: `${selectedId ?? "@popup"}:${field}` } : undefined);
    },
    [onChange, selectedId]
  );

  if (!node) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-free-inspector="popup">
        <header className="flex min-w-0 flex-col gap-0.5 border-b border-[var(--border-subtle)] px-4 py-3">
          <h2 className="m-0 text-sm leading-6 font-semibold text-[var(--text-primary)]">{C.header.popup}</h2>
          <p className="m-0 text-xs leading-5 text-[var(--text-secondary)]">{C.header.popupHint}</p>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-8">
          <FreeArtboardSettings
            design={design}
            disabled={disabled}
            errors={errors}
            fonts={fonts}
            hints={hints}
            latest={latest}
            onBusyChange={onBusyChange}
            onChange={change}
            onFontsChange={onFontsChange}
            rects={rects}
          />
        </div>
      </div>
    );
  }

  const removeProblem = freeRemoveProblem(design, node.id);
  const duplicateProblem = freeDuplicateProblem(design, node.id);
  const sectionProps: FreeSectionProps = {
    content,
    design,
    disabled,
    errors,
    fonts,
    hints,
    latest,
    node,
    onBusyChange,
    onChange: change,
    onCtaChange,
    onFontsChange,
    rects
  };
  const typeLabel = freeNodeTypeLabel(node);
  const panelId = `livre-painel-${node.id}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-free-inspector={node.id}>
      <header className="flex min-w-0 flex-col gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="m-0 truncate text-sm leading-6 font-semibold text-[var(--text-primary)]">{typeLabel}</h2>
          {node.name ? <p className="m-0 truncate text-xs leading-5 text-[var(--text-secondary)]">{node.name}</p> : null}
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button
            className={freeSmallButton}
            disabled={disabled || duplicateProblem !== null}
            onClick={() => onCommand({ id: node.id, kind: "duplicate" })}
            title={duplicateProblem ?? undefined}
            type="button"
            variant="secondary"
          >
            <Copy aria-hidden="true" className="size-4" />
            {C.header.duplicate}
          </Button>
          <Button
            className={freeSmallButton}
            disabled={disabled || removeProblem !== null}
            onClick={() => onCommand({ id: node.id, kind: "remove" })}
            title={removeProblem ?? undefined}
            type="button"
            variant="secondary"
          >
            <Trash2 aria-hidden="true" className="size-4" />
            {C.header.remove}
          </Button>
        </div>
        {removeProblem || duplicateProblem ? <p className="m-0 text-xs leading-5 text-[var(--text-secondary)]">{removeProblem ?? duplicateProblem}</p> : null}
      </header>

      <Tabs.Root
        className="flex min-h-0 flex-1 flex-col"
        onValueChange={(value) => {
          // Entrar na aba Celular liga o "Ver como: Celular" (o que se ve e o que se edita).
          if (value === "mobile" && tab !== "mobile" && device !== "mobile") {
            onDeviceChange?.("mobile");
          }

          setTab(value as ElementTab);
        }}
        value={tab}
      >
        <Tabs.List aria-label={C.tabs.label} className="flex min-w-0 gap-1 border-b border-[var(--border-subtle)] px-3 py-2">
          <Tabs.Tab className={tabClass} value="content">
            {C.tabs.content}
          </Tabs.Tab>
          <Tabs.Tab className={tabClass} value="style">
            {C.tabs.style}
          </Tabs.Tab>
          <Tabs.Tab className={tabClass} value="advanced">
            {C.tabs.advanced}
          </Tabs.Tab>
          <Tabs.Tab className={tabClass} data-free-inspector-tab="mobile" value="mobile">
            {C.tabs.mobile}
          </Tabs.Tab>
        </Tabs.List>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-8" id={panelId}>
          <Tabs.Panel className="outline-none" value="content">
            {tab === "content" ? <FreeInspectorContent key={node.id} {...sectionProps} /> : null}
          </Tabs.Panel>
          <Tabs.Panel className="outline-none" value="style">
            {tab === "style" ? <FreeInspectorStyle key={node.id} {...sectionProps} /> : null}
          </Tabs.Panel>
          <Tabs.Panel className="outline-none" value="advanced">
            {tab === "advanced" ? <FreeInspectorAdvanced key={node.id} {...sectionProps} onCommand={onCommand} /> : null}
          </Tabs.Panel>
          <Tabs.Panel className="outline-none" value="mobile">
            {tab === "mobile" ? <FreeInspectorMobile key={node.id} {...sectionProps} onReset={(id) => onCommand({ id, kind: "mobileReset" })} /> : null}
          </Tabs.Panel>
        </div>
      </Tabs.Root>
    </div>
  );
}
