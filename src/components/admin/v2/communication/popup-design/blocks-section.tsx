"use client";

import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NoticeDraft } from "@/server/communications/schemas";
import type { PopupBlock, PopupContrastHint, PopupDesign } from "@/server/communications/popup-design-model";
import { BlockEditor, blockDomId, type BlockEditorContext } from "./block-editors";
import { ContrastHint, DesignFieldError, DesignSection } from "./design-controls";
import {
  BLOCK_TYPE_LABELS,
  POPUP_DESIGN_COPY,
  addBlock,
  addableBlockTypes,
  blockErrorKeys,
  blockName,
  blockSummary,
  canAddBlock,
  canRemoveBlock,
  moveBlock,
  removeBlock,
  replaceBlock,
  type AddableBlockType
} from "./popup-design-editor-model";

// Secao "Blocos" do design (docs/26 §7.2): a lista na ordem do pop-up (nome do tipo, resumo, Subir, Descer,
// Editar, Tirar), a edicao do bloco aberto logo embaixo dele e "Adicionar bloco". O bloco com erro abre sozinho
// (o foco do erro cai no campo). O Áudio entra e sai com o audio do aviso; tirar o Botão principal tira o botao.

const copy = POPUP_DESIGN_COPY.blocks;
const iconButton =
  "size-9 shrink-0 rounded-lg px-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)] pointer-coarse:size-11 disabled:opacity-40";

type BlocksSectionProps = {
  context: BlockEditorContext;
  design: PopupDesign;
  hints: readonly PopupContrastHint[];
  /** O design mais novo (uma fonte enviada no dialogo volta depois: o resto do design pode ter mudado). */
  latestDesign: () => PopupDesign | null;
  onChange: (patch: Partial<Pick<NoticeDraft, "cta" | "design">>) => void;
};

export function BlocksSection({ context, design, hints, latestDesign, onChange }: BlocksSectionProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const blocksError = context.errorFor("design.blocks");
  const full = !canAddBlock(design);
  const addable = addableBlockTypes(design);

  function update(index: number, block: PopupBlock) {
    const current = latestDesign() ?? design;

    if (current.blocks[index]?.id === block.id) {
      onChange({ design: replaceBlock(current, index, block) });
    }
  }

  function add(type: AddableBlockType) {
    const patch = addBlock({ audio: null, cta: context.cta, design }, type);

    if (!patch) {
      return;
    }

    const { index, ...rest } = patch;
    onChange(rest);
    setOpenId(patch.design.blocks[index]?.id ?? null);
  }

  return (
    <DesignSection id="popup-design-blocos" title={POPUP_DESIGN_COPY.sections.blocks}>
      <ol className="m-0 flex min-w-0 list-none flex-col gap-2 p-0">
        {design.blocks.map((block, index) => {
          const name = blockName(design, index);
          const hasError = blockErrorKeys(block, index).some((key) => context.errorFor(key));
          const open = openId === block.id || hasError;
          const blockHints = hints.filter((hint) => hint.key === `blocks.${index}` || hint.key.startsWith(`blocks.${index}.`));
          const removable = canRemoveBlock(design, index);
          const editorId = `${blockDomId(index)}-edicao`;

          return (
            <li
              className={cn(
                "flex min-w-0 scroll-mt-24 flex-col rounded-lg border bg-[var(--surface-1)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                hasError ? "border-[var(--error)]" : "border-[var(--border-subtle)]"
              )}
              id={blockDomId(index)}
              key={block.id}
              tabIndex={-1}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
                <div className="min-w-0 flex-1 basis-40">
                  <p className="text-sm leading-5 font-medium text-[var(--text-primary)]">{name}</p>
                  <p className="truncate text-[13px] leading-5 text-[var(--text-secondary)]">{blockSummary(block, context.cta)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    aria-label={`${copy.moveUp} o bloco ${name}`}
                    className={iconButton}
                    disabled={context.disabled || index === 0}
                    onClick={() => onChange({ design: moveBlock(design, index, -1) })}
                    title={copy.moveUp}
                    type="button"
                    variant="ghost"
                  >
                    <ChevronUp aria-hidden="true" className="size-4" />
                  </Button>
                  <Button
                    aria-label={`${copy.moveDown} o bloco ${name}`}
                    className={iconButton}
                    disabled={context.disabled || index === design.blocks.length - 1}
                    onClick={() => onChange({ design: moveBlock(design, index, 1) })}
                    title={copy.moveDown}
                    type="button"
                    variant="ghost"
                  >
                    <ChevronDown aria-hidden="true" className="size-4" />
                  </Button>
                  <Button
                    aria-controls={open ? editorId : undefined}
                    aria-expanded={open}
                    aria-label={`${copy.edit} o bloco ${name}`}
                    className={cn(iconButton, open && "bg-[var(--surface-3)] text-[var(--text-primary)]")}
                    disabled={hasError}
                    onClick={() => setOpenId(open ? null : block.id)}
                    title={copy.edit}
                    type="button"
                    variant="ghost"
                  >
                    <Pencil aria-hidden="true" className="size-4" />
                  </Button>
                  <Button
                    aria-label={`${copy.remove} o bloco ${name}`}
                    className={iconButton}
                    disabled={context.disabled || !removable}
                    onClick={() => {
                      const patch = removeBlock(design, index);

                      if (patch) {
                        onChange(patch);
                      }
                    }}
                    title={block.type === "audio" ? copy.audioFixed : copy.remove}
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              </div>
              {blockHints.length > 0 && !open ? (
                <div className="flex flex-col gap-1 px-3 pb-2">
                  {blockHints.slice(0, 1).map((hint) => (
                    <ContrastHint key={hint.key} message={hint.message} />
                  ))}
                </div>
              ) : null}
              {open ? (
                <div className="flex min-w-0 flex-col gap-4 border-t border-[var(--border-subtle)] px-3 pt-4 pb-4" id={editorId}>
                  {block.type !== "heading"
                    ? blockHints.map((hint) => <ContrastHint key={hint.key} message={hint.message} />)
                    : null}
                  <BlockEditor block={block} context={context} index={index} onChange={(next) => update(index, next)} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <DesignFieldError message={blocksError} />

      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{copy.add}</span>
        <div aria-label={copy.add} className="flex min-w-0 flex-wrap gap-2" role="group">
          {addable.map((type) => (
            <Button
              className="h-9 gap-1.5 rounded-full px-3 pointer-coarse:h-11"
              disabled={context.disabled || full}
              key={type}
              onClick={() => add(type)}
              type="button"
              variant="secondary"
            >
              <Plus aria-hidden="true" className="size-4" />
              {BLOCK_TYPE_LABELS[type]}
            </Button>
          ))}
        </div>
        {full ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{copy.limit}</p> : null}
      </div>
    </DesignSection>
  );
}
