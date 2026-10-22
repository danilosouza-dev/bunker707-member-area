"use client";

import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { FixedPageKey } from "@/server/member-area/page-visit-model";
import { POPUP_PAGE_KIND_LABELS } from "@/server/communications/popup-sentences";
import { PillGroup } from "../form";
import { ProductPicker, type ProductPickerItem } from "../storefront/product-picker";
import {
  POPUP_EDITOR_COPY,
  POPUP_FIXED_PAGES,
  checklistLineMode,
  checklistLineProducts,
  toggleChecklistLine,
  toggleChecklistPage,
  type PopupChecklist,
  type PopupChecklistKind,
  type PopupChecklistList
} from "./popup-editor-model";

// Lista de paginas do pop-up (v3b-1, docs/25 §2.3), a mesma em "Escolher páginas" e em "Nunca nestas
// páginas": Inicio, "Página do produto" e "Páginas de aula" (qualquer produto ou produtos escolhidos; nas
// excecoes, direto no seletor) e as paginas fixas na ordem do menu. Controlado: recebe a lista marcada
// (checklistOf, que tambem sabe das linhas esperando produto) e devolve a proxima; os padroes saem de
// patternsOfChecklist no card. O fieldset recebe o foco quando ha erro (FIELD_FOCUS do editor). A 375 px
// tudo fica numa coluna, cada linha com 44 px no toque.

type PopupPagesChecklistProps = {
  checklist: PopupChecklist;
  disabled: boolean;
  error?: string;
  /** "popup-paginas" ou "popup-excecoes": o fieldset, e os seletores "{id}-produtos" e "{id}-aulas". */
  id: string;
  legend: string;
  list: PopupChecklistList;
  onChange: (next: PopupChecklist) => void;
  products: readonly ProductPickerItem[];
  productsLoaded: boolean;
};

const checkboxClass =
  "mt-0.5 size-[18px] border-[var(--border-stronger)] bg-[var(--surface-1)] data-checked:border-[var(--text-primary)] data-checked:bg-[var(--text-primary)] data-checked:text-[var(--surface-0)] data-disabled:opacity-60 pointer-coarse:size-6";

const LINE_MODE_OPTIONS: Record<PopupChecklistKind, readonly { label: string; value: "any" | "some" }[]> = {
  content: [
    { label: "Qualquer produto", value: "any" },
    { label: "Só estes produtos", value: "some" }
  ],
  lesson: [
    { label: "Qualquer aula", value: "any" },
    { label: "Aulas destes produtos", value: "some" }
  ]
};

const LINE_MODE_ARIA: Record<PopupChecklistKind, string> = { content: "Quais produtos", lesson: "Quais aulas" };

function CheckRow({
  checked,
  children,
  description,
  disabled,
  id,
  label,
  onCheckedChange
}: {
  checked: boolean;
  children?: ReactNode;
  description?: string;
  disabled: boolean;
  id: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-lg px-1 py-1.5 pointer-coarse:min-h-11">
      <Checkbox checked={checked} className={checkboxClass} disabled={disabled} id={id} onCheckedChange={(next) => onCheckedChange(next === true)} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-w-0">
          <label className={cn("text-sm leading-5 font-medium text-[var(--text-primary)]", !disabled && "cursor-pointer")} htmlFor={id}>
            {label}
          </label>
          {description ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{description}</p> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export function PopupPagesChecklist({ checklist, disabled, error, id, legend, list, onChange, products, productsLoaded }: PopupPagesChecklistProps) {
  const copy = POPUP_EDITOR_COPY.placement;

  function productLine(kind: PopupChecklistKind) {
    const line = checklist[kind];
    const pickerId = `${id}-${kind === "content" ? "produtos" : "aulas"}`;
    const pending = line.checked && line.mode === "some" && line.products.length === 0;
    const showsPicker = line.checked && line.mode === "some";

    return (
      <CheckRow
        checked={line.checked}
        description={kind === "content" ? copy.contentDescription : copy.lessonDescription}
        disabled={disabled}
        id={`${id}-${kind}`}
        label={POPUP_PAGE_KIND_LABELS[kind]}
        onCheckedChange={(checked) => onChange(toggleChecklistLine(checklist, kind, checked, list))}
      >
        {line.checked && list === "pages" ? (
          <>
            {kind === "lesson" ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{copy.lessonHint}</p> : null}
            <PillGroup
              ariaLabel={LINE_MODE_ARIA[kind]}
              disabled={disabled}
              name={`${id}-${kind}-modo`}
              onChange={(mode) => onChange(checklistLineMode(checklist, kind, mode))}
              options={LINE_MODE_OPTIONS[kind]}
              value={line.mode}
            />
          </>
        ) : null}
        {line.checked && list === "exclude" && line.mode === "any" ? (
          // Excecao de um tipo inteiro (so por chamada direta): escolher um produto troca pelo produto.
          <p className="text-xs leading-5 text-[var(--text-secondary)]">{copy.wholeKindException[kind]}</p>
        ) : null}
        {line.checked && (showsPicker || list === "exclude") ? (
          productsLoaded ? (
            <ProductPicker
              disabled={disabled}
              emptyText={copy.productsEmpty}
              error={pending ? error : undefined}
              hint={copy.formationHint}
              id={pickerId}
              items={products}
              mode="multiple"
              onChange={(ids) => onChange(checklistLineProducts(checklist, kind, ids))}
              value={line.products}
            />
          ) : (
            <p className="text-[13px] leading-5 text-[var(--warning)]">{copy.productsUnavailable}</p>
          )
        ) : null}
        {line.checked && (showsPicker || list === "exclude") && productsLoaded ? (
          <p className="text-xs leading-5 text-[var(--text-secondary)]" id={`${pickerId}-hint`}>
            {copy.formationHint}
          </p>
        ) : null}
      </CheckRow>
    );
  }

  function fixedRow(key: FixedPageKey) {
    return (
      <CheckRow
        checked={checklist.fixed.includes(key)}
        disabled={disabled}
        id={`${id}-${key}`}
        key={key}
        label={POPUP_PAGE_KIND_LABELS[key]}
        onCheckedChange={(checked) => onChange(toggleChecklistPage(checklist, key, checked))}
      />
    );
  }

  return (
    <fieldset
      aria-describedby={error ? `${id}-error` : undefined}
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      id={id}
      tabIndex={-1}
    >
      <legend className="mb-1.5 px-1 text-[13px] leading-5 font-medium text-[var(--text-primary)]">{legend}</legend>
      {fixedRow("home")}
      {productLine("content")}
      {productLine("lesson")}
      {POPUP_FIXED_PAGES.filter((key) => key !== "home").map(fixedRow)}
      {error ? (
        <p className="mt-1 flex items-start gap-1.5 text-[13px] leading-5 text-[var(--error)]" id={`${id}-error`}>
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
