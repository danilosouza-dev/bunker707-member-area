"use client";

import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HomeSectionConfig } from "@/lib/platform-types";
import { cn } from "@/lib/utils";
import {
  AUTOMATIC_SOURCES,
  SECTION_KIND_LABELS,
  SECTION_SUBTITLE_MAX,
  SECTION_TITLE_MAX,
  STRUCTURE_LAYOUT_OPTIONS,
  VISIBILITY_OPTIONS,
  availableAutomaticSources,
  changeDraftSource,
  emptySectionDraft,
  getAutomaticSource,
  sectionToDraft,
  validateSectionDraft,
  type AutomaticSource,
  type SectionDraft,
  type SectionDraftErrors,
  type SectionKind,
  type StorefrontProduct
} from "@/server/storefront/model";
import { AdminField, PillGroup, adminInputClass, adminTextareaClass, fieldDescribedBy } from "../form";
import { AdminSheet, AdminSheetSection } from "../sheet";
import { adminTransition } from "../styles";
import { ProductPicker, type ProductPickerItem } from "./product-picker";

// Painel de uma fileira da Vitrine (criar ou editar). Sobrepoe a pagina com scrim (AdminSheet).
// A mudanca vale para o rascunho da vitrine; o aluno so ve depois de "Publicar vitrine".

type SectionSheetProps = {
  canEdit: boolean;
  /** null = criar; senao, a fileira em edicao. */
  editing: HomeSectionConfig | null;
  onApply: (draft: SectionDraft) => void;
  onDelete: (sectionId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  products: readonly StorefrontProduct[];
  sections: readonly HomeSectionConfig[];
};

function productFlags(product: StorefrontProduct): ProductPickerItem["flags"] {
  const flags: NonNullable<ProductPickerItem["flags"]> = [];

  if (product.situation !== "published") {
    flags.push({ label: product.situation === "draft" ? "Rascunho" : "Arquivado", tone: "muted" });
  }

  if (!product.listed) {
    flags.push({ label: "Oculto", tone: "warning" });
  }

  return flags;
}

function toPickerItem(product: StorefrontProduct): ProductPickerItem {
  return {
    accent: product.accent,
    coverUrl: product.coverUrl,
    detail: product.formatLabel,
    flags: productFlags(product),
    id: product.id,
    title: product.title
  };
}

const kindOptions: readonly { label: string; value: SectionKind }[] = [
  { label: SECTION_KIND_LABELS.automatic, value: "automatic" },
  { label: SECTION_KIND_LABELS.manual, value: "manual" },
  { label: SECTION_KIND_LABELS.structure, value: "structure" }
];

const kindHints: Record<SectionKind, string> = {
  automatic: "A lista se atualiza sozinha. Cada fileira automática aparece uma vez.",
  manual: "Você escolhe os produtos e a ordem em que aparecem.",
  structure: "Os módulos de um curso (ou os cursos de uma formação) numa fileira."
};

const FORM_ID = "vitrine-section-form";

/**
 * Um AdminSheet so (abre e fecha com animacao); o formulario dentro remonta a cada abertura
 * (`sessionKey`), com rascunho limpo para criar ou os valores atuais para editar.
 */
export function SectionSheet(props: SectionSheetProps & { sessionKey: number }) {
  const { canEdit, editing, onDelete, onOpenChange, open, sessionKey } = props;

  return (
    <AdminSheet
      description={canEdit ? "O aluno vê a mudança depois que você publicar a vitrine." : "Só leitura."}
      eyebrow="Vitrine"
      footer={
        <>
          {editing && canEdit ? (
            <Button
              className="px-3 text-[var(--error)] hover:bg-[var(--error-bg)] hover:text-[var(--error)]"
              onClick={() => onDelete(editing.id)}
              type="button"
              variant="ghost"
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Excluir fileira
            </Button>
          ) : (
            <span />
          )}
          <span className="flex items-center gap-2">
            <Button className="px-4 text-[var(--text-secondary)]" onClick={() => onOpenChange(false)} type="button" variant="ghost">
              {canEdit ? "Cancelar" : "Fechar"}
            </Button>
            {canEdit ? (
              <Button className="px-4" form={FORM_ID} type="submit">
                {editing ? "Aplicar" : "Adicionar fileira"}
              </Button>
            ) : null}
          </span>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title={editing ? editing.title || "Fileira" : "Nova fileira"}
    >
      <SectionForm key={sessionKey} {...props} />
    </AdminSheet>
  );
}

function SectionForm({ canEdit, editing, onApply, products, sections }: SectionSheetProps) {
  const creating = editing === null;
  const [draft, setDraft] = useState<SectionDraft>(() => (editing ? sectionToDraft(editing) : emptySectionDraft(sections)));
  const [errors, setErrors] = useState<SectionDraftErrors>({});
  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const pickerItems = useMemo(() => products.filter((product) => product.sellable).map(toPickerItem), [products]);
  const available = availableAutomaticSources(sections, editing?.id);
  const kinds = creating && available.length === 0 ? kindOptions.filter((option) => option.value !== "automatic") : kindOptions;
  const automatic = draft.kind === "automatic" ? getAutomaticSource(draft.source) : null;
  const titlePlaceholder =
    draft.kind === "automatic"
      ? automatic?.label
      : draft.kind === "structure"
        ? (productsById.get(draft.sourceContentId)?.title ?? "Nome do produto")
        : "Ex.: Comece por aqui";
  const subtitleHint = "Uma linha abaixo do título. Vazio, a fileira aparece só com o título.";
  const manualHint = "Aparecem na ordem em que você marca. Rascunho e oculto só aparecem para quem pode vê-los.";

  function update<Key extends keyof SectionDraft>(field: Key, value: SectionDraft[Key]) {
    setDraft((current) => ({ ...current, [field]: value }));

    if (field in errors) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  function changeKind(kind: SectionKind) {
    setDraft((current) => {
      if (kind === "automatic" && available[0]) {
        return { ...changeDraftSource(current, available[0].source), kind };
      }

      if (current.kind !== "automatic") {
        return { ...current, kind };
      }

      // Saindo da automatica: subtitulo e publico padrao dela nao valem para a fileira nova.
      const defaults = getAutomaticSource(current.source);

      return {
        ...current,
        kind,
        subtitle: current.subtitle === defaults.subtitle ? "" : current.subtitle,
        visibility: current.visibility === defaults.visibility ? "all" : current.visibility
      };
    });
    setErrors({});
  }

  function validateTitle() {
    const next = validateSectionDraft(draft, { productsById, sectionId: editing?.id, sections });
    setErrors((current) => ({ ...current, title: next.title }));
  }

  function submit() {
    const next = validateSectionDraft(draft, { productsById, sectionId: editing?.id, sections });

    if (Object.values(next).some(Boolean)) {
      setErrors(next);
      return;
    }

    onApply(draft);
  }

  return (
    <form
      className="flex flex-col"
      id={FORM_ID}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <fieldset className="contents" disabled={!canEdit}>
        {creating ? (
          <AdminSheetSection title="Tipo de fileira">
            <PillGroup ariaLabel="Tipo de fileira" name="vitrine-kind" onChange={changeKind} options={kinds} value={draft.kind} />
            <p className="-mt-2 text-xs leading-5 text-[var(--text-secondary)]">{kindHints[draft.kind]}</p>
          </AdminSheetSection>
        ) : null}

        {draft.kind === "automatic" ? (
          <AdminSheetSection title="O que a fileira mostra">
            {creating ? (
              <div aria-label="Fileira automática" className="flex flex-col gap-2" role="radiogroup">
                {AUTOMATIC_SOURCES.map((option) => {
                  const used = !available.some((entry) => entry.source === option.source);
                  const checked = draft.source === option.source;

                  return (
                    <label
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5",
                        "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-[var(--focus-ring)]",
                        checked
                          ? "border-[var(--border-strong)] bg-[var(--surface-2)]"
                          : "border-[var(--border-subtle)] hover:bg-[var(--hover-overlay)]",
                        used && "cursor-not-allowed opacity-50",
                        adminTransition
                      )}
                      key={option.source}
                    >
                      <input
                        checked={checked}
                        className="sr-only"
                        disabled={used}
                        name="vitrine-source"
                        onChange={() => {
                          setDraft((current) => changeDraftSource(current, option.source as AutomaticSource));
                          setErrors((current) => ({ ...current, source: undefined }));
                        }}
                        type="radio"
                        value={option.source}
                      />
                      <span
                        aria-hidden="true"
                        className={cn(
                          "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
                          checked ? "border-[var(--text-primary)]" : "border-[var(--border-strong)]"
                        )}
                      >
                        {checked ? <span className="size-2 rounded-full bg-[var(--text-primary)]" /> : null}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm leading-5 font-medium text-[var(--text-primary)]">{option.label}</span>
                        <span className="text-xs leading-5 text-[var(--text-secondary)]">
                          {used ? "Já está na vitrine." : option.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
                {errors.source ? <p className="text-[13px] leading-5 text-[var(--error)]">{errors.source}</p> : null}
              </div>
            ) : (
              <p className="text-sm leading-5 text-[var(--text-secondary)]">
                <span className="font-medium text-[var(--text-primary)]">{automatic?.label}.</span> {automatic?.description}
              </p>
            )}
          </AdminSheetSection>
        ) : null}

        {draft.kind === "structure" ? (
          <AdminSheetSection title="Produto da fileira">
            <AdminField error={errors.sourceContentId} id="vitrine-structure-product" label="Produto">
              <ProductPicker
                emptyText="Nenhum produto à venda ainda."
                error={errors.sourceContentId}
                id="vitrine-structure-product"
                items={pickerItems}
                mode="single"
                onChange={(ids) => update("sourceContentId", ids[0] ?? "")}
                value={draft.sourceContentId ? [draft.sourceContentId] : []}
              />
            </AdminField>
            <AdminField hint={STRUCTURE_LAYOUT_OPTIONS.find((option) => option.value === draft.layout)?.description} id="vitrine-layout" label="Apresentação">
              <PillGroup
                ariaLabel="Apresentação"
                name="vitrine-layout"
                onChange={(value) => update("layout", value)}
                options={STRUCTURE_LAYOUT_OPTIONS}
                value={draft.layout}
              />
            </AdminField>
          </AdminSheetSection>
        ) : null}

        {draft.kind === "manual" ? (
          <AdminSheetSection aside={draft.itemIds.length === 1 ? "1 escolhido" : `${draft.itemIds.length} escolhidos`} title="Produtos">
            <AdminField
              error={errors.itemIds}
              hint={manualHint}
              id="vitrine-manual-products"
              label="Escolha os produtos"
            >
              <ProductPicker
                emptyText="Nenhum produto à venda ainda."
                error={errors.itemIds}
                hint={manualHint}
                id="vitrine-manual-products"
                items={pickerItems}
                mode="multiple"
                onChange={(ids) => update("itemIds", ids)}
                value={draft.itemIds}
              />
            </AdminField>
          </AdminSheetSection>
        ) : null}

        <AdminSheetSection title="Texto e público">
          <AdminField
            error={errors.title}
            id="vitrine-title"
            label="Título"
            optional={draft.kind !== "manual"}
          >
            <Input
              aria-describedby={fieldDescribedBy("vitrine-title", { error: errors.title })}
              aria-invalid={errors.title ? true : undefined}
              className={adminInputClass}
              id="vitrine-title"
              maxLength={SECTION_TITLE_MAX}
              onBlur={validateTitle}
              onChange={(event) => update("title", event.target.value)}
              placeholder={titlePlaceholder}
              value={draft.title}
            />
          </AdminField>
          <AdminField hint={subtitleHint} id="vitrine-subtitle" label="Subtítulo" optional>
            <textarea
              aria-describedby={fieldDescribedBy("vitrine-subtitle", { hint: subtitleHint })}
              className={cn(adminTextareaClass, "min-h-20")}
              id="vitrine-subtitle"
              maxLength={SECTION_SUBTITLE_MAX}
              onChange={(event) => update("subtitle", event.target.value)}
              value={draft.subtitle}
            />
          </AdminField>
          <AdminField id="vitrine-visibility" label="Quem vê esta fileira">
            <PillGroup
              ariaLabel="Quem vê esta fileira"
              name="vitrine-visibility"
              onChange={(value) => update("visibility", value)}
              options={VISIBILITY_OPTIONS}
              value={draft.visibility}
            />
          </AdminField>
        </AdminSheetSection>
      </fieldset>
    </form>
  );
}
