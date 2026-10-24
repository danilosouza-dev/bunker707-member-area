"use client";

import { ArrowLeft, CircleCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PopupFontOption } from "@/server/communications/popup-design-model";
import { FontUploadDialog } from "../popup-design/font-upload-dialog";
import { FREE_EDITOR_COPY, type FreeReviewItem } from "./free-editor-model";

// Painel "Revisar" do editor Livre (spec §4.10): no topo, sempre, o medidor de tamanho (nao conta como
// problema); "Para corrigir antes de salvar" (zod no navegador, regras com o conteudo do aviso e os erros do ultimo
// salvar) e "Dicas" (nao impedem salvar). Clicar num item seleciona o elemento e pede ao painel da direita o foco
// no campo (focusRequest; o mapa chave -> aba/campo e do painel). "Aumentar a altura" e "Enviar fonte…" resolvem
// ali mesmo.

const copy = FREE_EDITOR_COPY.review;

export type FreeReviewPanelProps = {
  disabled: boolean;
  errors: readonly FreeReviewItem[];
  hints: readonly FreeReviewItem[];
  onBack: () => void;
  onFontUploaded: (font: PopupFontOption, item: FreeReviewItem) => void;
  onGoTo: (item: FreeReviewItem) => void;
  onRaise: (item: FreeReviewItem) => void;
  sizePercent: number;
};

function ItemList({ disabled, items, onFont, onGoTo, onRaise, tone }: {
  disabled: boolean;
  items: readonly FreeReviewItem[];
  onFont: (item: FreeReviewItem) => void;
  onGoTo: (item: FreeReviewItem) => void;
  onRaise: (item: FreeReviewItem) => void;
  tone: "error" | "hint";
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {items.map((item) => (
        <li
          className={cn(
            "flex min-w-0 flex-col gap-1.5 rounded-lg border p-2",
            tone === "error" ? "border-[var(--error-border)] bg-[var(--error-bg)]" : "border-[var(--border-subtle)] bg-[var(--surface-2)]"
          )}
          data-free-review-item={item.key}
          key={`${item.kind}:${item.key}`}
        >
          <button className="flex min-w-0 items-start gap-2 rounded-md text-left" onClick={() => onGoTo(item)} type="button">
            <TriangleAlert aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", tone === "error" ? "text-[var(--error)]" : "text-[var(--warning)]")} />
            <span className="min-w-0">
              <span className="block text-[12px] leading-4 font-semibold text-[var(--text-primary)]">{item.nodeName}</span>
              <span className="block text-[13px] leading-5 text-[var(--text-secondary)]">{item.message}</span>
            </span>
          </button>
          {item.action === "raise" ? (
            <Button className="self-start" disabled={disabled} onClick={() => onRaise(item)} size="sm" type="button" variant="outline">
              {copy.raise}
            </Button>
          ) : null}
          {item.action === "font" ? (
            <Button className="self-start" disabled={disabled} onClick={() => onFont(item)} size="sm" type="button" variant="outline">
              {copy.sendFont}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function FreeReviewPanel({ disabled, errors, hints, onBack, onFontUploaded, onGoTo, onRaise, sizePercent }: FreeReviewPanelProps) {
  const [fontFor, setFontFor] = useState<FreeReviewItem | null>(null);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3">
        <Button className="gap-1.5" data-free-review-back="" onClick={onBack} size="sm" type="button" variant="ghost">
          <ArrowLeft aria-hidden="true" className="size-4" />
          {copy.back}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        <h2 className="text-sm leading-5 font-semibold text-[var(--text-primary)]" data-free-review-title="" tabIndex={-1}>
          {copy.title}
        </h2>
        <div className="flex flex-col gap-1.5">
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.size(sizePercent)}</p>
          <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
            <div
              className={cn("h-full rounded-full", sizePercent > 100 ? "bg-[var(--error)]" : sizePercent > 85 ? "bg-[var(--warning)]" : "bg-[var(--series-2)]")}
              style={{ width: `${Math.min(100, Math.max(2, sizePercent))}%` }}
            />
          </div>
        </div>
        {errors.length === 0 && hints.length === 0 ? (
          <p className="flex items-center gap-2 text-[13px] leading-5 text-[var(--text-secondary)]">
            <CircleCheck aria-hidden="true" className="size-4 text-[var(--success)]" />
            {copy.empty}
          </p>
        ) : null}
        {errors.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-[12px] leading-4 font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">{copy.errors}</h3>
            <ItemList disabled={disabled} items={errors} onFont={setFontFor} onGoTo={onGoTo} onRaise={onRaise} tone="error" />
          </section>
        ) : null}
        {hints.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-[12px] leading-4 font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">{copy.hints}</h3>
            <ItemList disabled={disabled} items={hints} onFont={setFontFor} onGoTo={onGoTo} onRaise={onRaise} tone="hint" />
          </section>
        ) : null}
      </div>
      <FontUploadDialog
        onOpenChange={(open) => {
          if (!open) {
            setFontFor(null);
          }
        }}
        onUploaded={(font) => {
          if (fontFor) {
            onFontUploaded(font, fontFor);
          }

          setFontFor(null);
        }}
        open={fontFor !== null}
      />
    </div>
  );
}
