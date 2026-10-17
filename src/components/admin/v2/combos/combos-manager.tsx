"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionFailure } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { deleteCombo, saveCombo } from "@/server/catalog/combo-actions";
import { PRODUCT_FORMAT_LABELS, PRODUCT_SITUATION_LABELS } from "@/server/catalog/model";
import { comboSchema } from "@/server/catalog/schemas";
import type { ComboListItem, ProductOption } from "@/server/catalog/types";
import type { DataTableColumn } from "../data-table";
import { ErrorBanner } from "../error-banner";
import { AdminField, PillGroup, adminInputClass, adminTextareaClass, fieldDescribedBy } from "../form";
import { PageHeader } from "../page-header";
import { ProductThumb } from "../product-thumb";
import { ConfirmDialog, ResponsiveTable, RowMenu } from "../settings/kit";
import { AdminSheet, AdminSheetSection } from "../sheet";
import { StatusChip } from "../status-chip";
import { adminCard } from "../styles";
import { adminToast } from "../toast";
import { ProductPicker, type ProductPickerItem } from "../storefront/product-picker";
import {
  COMBO_STATUSES,
  COMBO_STATUS_HINTS,
  COMBO_STATUS_LABELS,
  DEFAULT_COHORT_NAME,
  comboStatusTone,
  comboToForm,
  formToComboInput,
  formatRelativeDate,
  isComboFormDirty,
  summarizeComboProducts,
  type ComboFormState
} from "@/server/catalog/combo-model";

// Pacotes (docs/17 §1.6.8): varios produtos vendidos juntos. Tabela no desktop, cartoes abaixo de
// 768 px; criar e editar num painel que sobrepoe a pagina; excluir pede confirmacao (nao ha desfazer).

const SALE_PHRASE = "Quando a venda deste pacote chegar da Hotmart/Ticto, liberamos todos os produtos de uma vez.";
const FORM_ID = "pacote-form";

type CombosManagerProps = {
  canEdit: boolean;
  cohorts: string[];
  combos: ComboListItem[];
  products: ProductOption[];
};

type FieldErrors = Partial<Record<keyof ComboFormState, string>>;

type EditorState = { combo: ComboListItem | null; session: number };

const statusOptions = COMBO_STATUSES.map((status) => ({ label: COMBO_STATUS_LABELS[status], value: status }));

function toPickerItem(product: ProductOption): ProductPickerItem {
  return {
    accent: product.accent,
    coverUrl: product.coverUrl,
    detail: PRODUCT_FORMAT_LABELS[product.format],
    flags: product.situation === "published" ? [] : [{ label: PRODUCT_SITUATION_LABELS[product.situation], tone: "muted" }],
    id: product.id,
    title: product.title
  };
}

function fieldErrorsFrom(failure: ActionFailure): FieldErrors {
  const pick = (key: string) => failure.fieldErrors?.[key]?.[0];

  return {
    cohortName: pick("cohortName"),
    description: pick("description"),
    hotmartProductId: pick("hotmartProductId"),
    name: pick("name"),
    productIds: pick("productIds") ?? pick("productIds.0")
  };
}

function ProductStack({ combo }: { combo: ComboListItem }) {
  const { extra, visible } = summarizeComboProducts(combo.products);

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className="flex shrink-0 gap-1">
        {visible.map((product) => (
          <ProductThumb accent={product.accent} coverUrl={product.coverUrl} key={product.id} size="xs" title={product.title} />
        ))}
        {extra > 0 ? (
          <span className="grid size-7 shrink-0 place-items-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[11px] font-medium text-[var(--text-secondary)] tabular-nums">
            +{extra}
          </span>
        ) : null}
      </span>
      <span className="truncate text-[13px] text-[var(--text-secondary)] tabular-nums">
        {combo.products.length === 1 ? "1 produto" : `${combo.products.length} produtos`}
      </span>
    </span>
  );
}

export function CombosManager({ canEdit, cohorts, combos: initialCombos, products }: CombosManagerProps) {
  const [combos, setCombos] = useState(initialCombos);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [session, setSession] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<ComboListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickerItems = useMemo(() => products.map(toPickerItem), [products]);

  function openEditor(combo: ComboListItem | null) {
    const next = session + 1;
    setSession(next);
    setEditor({ combo, session: next });
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }

    setDeleting(true);
    const result = await deleteCombo({ id: deleteTarget.id });
    setDeleting(false);

    if (!result.ok) {
      setDeleteTarget(null);
      setError(result.error);
      return;
    }

    setCombos((current) => current.filter((combo) => combo.id !== result.data.id));
    setDeleteTarget(null);
    setEditor(null);
    setError(null);
    adminToast.success("Pacote excluído");
  }

  const columns: DataTableColumn<ComboListItem>[] = [
    {
      cell: (combo) => (
        <button
          className="flex w-full min-w-0 flex-col text-left"
          onClick={() => openEditor(combo)}
          type="button"
        >
          <span className="truncate font-medium text-[var(--text-primary)] hover:underline hover:underline-offset-4">{combo.name}</span>
          <span className="truncate text-xs text-[var(--text-secondary)]">{combo.description || "Sem descrição"}</span>
        </button>
      ),
      className: "max-w-0",
      header: "Pacote",
      id: "name"
    },
    { cell: (combo) => <ProductStack combo={combo} />, className: "max-w-0", header: "Produtos", headerClassName: "w-[248px]", id: "products" },
    {
      cell: (combo) => (
        <span className="block truncate text-[var(--text-secondary)]" title={combo.cohortName}>
          {combo.cohortName}
        </span>
      ),
      className: "max-w-0",
      header: "Turma",
      headerClassName: "w-[132px]",
      id: "cohort"
    },
    {
      cell: (combo) => <StatusChip tone={comboStatusTone(combo.status)}>{COMBO_STATUS_LABELS[combo.status]}</StatusChip>,
      header: "Situação",
      headerClassName: "w-[120px]",
      id: "status"
    },
    {
      cell: (combo) => <span className="whitespace-nowrap text-[var(--text-secondary)]">{formatRelativeDate(combo.updatedAt)}</span>,
      header: "Atualizado",
      headerClassName: "w-[132px]",
      id: "updated"
    },
    {
      cell: (combo) =>
        canEdit ? (
          <RowMenu
            actions={[
              { icon: <Pencil className="size-4" />, label: "Editar", onSelect: () => openEditor(combo) },
              { destructive: true, icon: <Trash2 className="size-4" />, label: "Excluir", onSelect: () => setDeleteTarget(combo), separated: true }
            ]}
            label={`Ações de ${combo.name}`}
          />
        ) : null,
      header: <span className="sr-only">Ações</span>,
      headerClassName: "w-14",
      id: "actions"
    }
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        actions={
          canEdit ? (
            <Button className="px-4" onClick={() => openEditor(null)} type="button">
              <Plus aria-hidden="true" className="size-4" />
              Novo pacote
            </Button>
          ) : null
        }
        description={`Vários produtos vendidos juntos. ${SALE_PHRASE}`}
        title="Pacotes"
      />

      {error ? (
        <ErrorBanner
          action={
            <Button className="px-3" onClick={() => setError(null)} type="button" variant="ghost">
              Fechar
            </Button>
          }
        >
          {error}
        </ErrorBanner>
      ) : null}

      {combos.length === 0 ? (
        <div className={cn(adminCard, "flex flex-col items-center gap-3 px-6 py-12 text-center md:py-16")}>
          <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]">Você ainda não tem pacotes.</h2>
          <p className="max-w-md text-sm leading-5 text-[var(--text-secondary)]">Junte produtos para vender como um só, com um link de venda.</p>
          {canEdit ? (
            <Button className="mt-1 px-4" onClick={() => openEditor(null)} type="button">
              <Plus aria-hidden="true" className="size-4" />
              Novo pacote
            </Button>
          ) : null}
        </div>
      ) : (
        <ResponsiveTable
          caption="Pacotes"
          className="[&_table]:table-fixed"
          columns={columns}
          getRowKey={(combo) => combo.id}
          renderCard={(combo) => (
            <div className="flex min-w-0 items-start gap-3">
              <button className="flex min-h-11 min-w-0 flex-1 flex-col gap-1 text-left" onClick={() => openEditor(combo)} type="button">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-[var(--text-primary)]">{combo.name}</span>
                  <StatusChip tone={comboStatusTone(combo.status)}>{COMBO_STATUS_LABELS[combo.status]}</StatusChip>
                </span>
                <ProductStack combo={combo} />
                <span className="text-xs text-[var(--text-secondary)]">
                  {combo.cohortName} · {formatRelativeDate(combo.updatedAt)}
                </span>
              </button>
              {canEdit ? (
                <RowMenu
                  actions={[{ destructive: true, icon: <Trash2 className="size-4" />, label: "Excluir", onSelect: () => setDeleteTarget(combo) }]}
                  label={`Ações de ${combo.name}`}
                />
              ) : null}
            </div>
          )}
          rows={combos}
        />
      )}

      <ComboSheet
        canEdit={canEdit}
        cohorts={cohorts}
        editor={editor}
        onClose={() => setEditor(null)}
        onDelete={(combo) => setDeleteTarget(combo)}
        onSaved={(saved, created) => {
          setCombos((current) => (created ? [saved, ...current] : current.map((combo) => (combo.id === saved.id ? saved : combo))));
          setEditor(null);
          setError(null);
          adminToast.success(created ? "Pacote criado" : "Pacote salvo");
        }}
        pickerItems={pickerItems}
      />

      <ConfirmDialog
        busy={deleting}
        confirmLabel="Excluir pacote"
        description="Vendas novas deste pacote deixam de liberar os produtos. Quem já comprou continua com acesso."
        destructive
        onConfirm={() => void confirmDelete()}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        open={deleteTarget !== null}
        title={deleteTarget ? `Excluir “${deleteTarget.name}”?` : "Excluir pacote?"}
      />
    </div>
  );
}

type ComboSheetProps = {
  canEdit: boolean;
  cohorts: string[];
  editor: EditorState | null;
  onClose: () => void;
  onDelete: (combo: ComboListItem) => void;
  onSaved: (combo: ComboListItem, created: boolean) => void;
  pickerItems: ProductPickerItem[];
};

function ComboSheet({ canEdit, cohorts, editor, onClose, onDelete, onSaved, pickerItems }: ComboSheetProps) {
  const combo = editor?.combo ?? null;
  const [discardOpen, setDiscardOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seenSession, setSeenSession] = useState(editor?.session ?? 0);

  // Cada abertura do painel e um formulario novo: o "nao salvo" da vez anterior nao vale mais.
  if (editor && editor.session !== seenSession) {
    setSeenSession(editor.session);
    setDirty(false);
  }

  /** Fecha sem perguntar (Cancelar, Descartar, depois de salvar); o proximo formulario comeca limpo. */
  function close() {
    setDirty(false);
    onClose();
  }

  return (
    <>
      <AdminSheet
        description={SALE_PHRASE}
        eyebrow="Pacotes"
        footer={
          <>
            {combo && canEdit ? (
              <Button
                className="px-3 text-[var(--error)] hover:bg-[var(--error-bg)] hover:text-[var(--error)]"
                onClick={() => onDelete(combo)}
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" className="size-4" />
                Excluir pacote
              </Button>
            ) : (
              <span />
            )}
            <span className="flex items-center gap-2">
              <Button className="px-4 text-[var(--text-secondary)]" onClick={close} type="button" variant="ghost">
                {canEdit ? "Cancelar" : "Fechar"}
              </Button>
              {canEdit ? (
                <Button className="px-4" disabled={saving} form={FORM_ID} type="submit">
                  {saving ? "Salvando…" : combo ? "Salvar pacote" : "Criar pacote"}
                </Button>
              ) : null}
            </span>
          </>
        }
        onBeforeClose={() => {
          if (dirty && canEdit) {
            setDiscardOpen(true);
            return false;
          }

          return true;
        }}
        onOpenChange={(open) => {
          if (!open) {
            close();
          }
        }}
        open={editor !== null}
        title={combo ? combo.name : "Novo pacote"}
      >
        <ComboForm
          canEdit={canEdit}
          cohorts={cohorts}
          combo={combo}
          key={editor?.session ?? 0}
          onDirtyChange={setDirty}
          onSaved={onSaved}
          onSavingChange={setSaving}
          pickerItems={pickerItems}
        />
      </AdminSheet>

      <ConfirmDialog
        confirmLabel="Descartar"
        description="As mudanças neste pacote ainda não foram salvas."
        onConfirm={() => {
          setDiscardOpen(false);
          close();
        }}
        onOpenChange={setDiscardOpen}
        open={discardOpen}
        title="Descartar as alterações?"
      />
    </>
  );
}

type ComboFormProps = {
  canEdit: boolean;
  cohorts: string[];
  combo: ComboListItem | null;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (combo: ComboListItem, created: boolean) => void;
  onSavingChange: (saving: boolean) => void;
  pickerItems: ProductPickerItem[];
};

function ComboForm({ canEdit, cohorts, combo, onDirtyChange, onSaved, onSavingChange, pickerItems }: ComboFormProps) {
  const [baseline] = useState(() => comboToForm(combo));
  const [form, setForm] = useState<ComboFormState>(baseline);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const cohortListId = `${FORM_ID}-turmas`;
  const descriptionHint = `${form.description.length}/300`;
  const cohortHint = `Quem chega por este pacote entra nesta turma. Vazio: ${DEFAULT_COHORT_NAME}.`;
  const hotmartHint = "O número do produto em Hotmart › Produtos. Com ele, a venda aprovada libera todos os produtos do pacote; reembolso e chargeback tiram o acesso a todos.";
  const productsHint = "Só produtos vendidos sozinhos entram num pacote.";

  function update<Key extends keyof ComboFormState>(field: Key, value: ComboFormState[Key]) {
    const next = { ...form, [field]: value };
    setForm(next);
    onDirtyChange(isComboFormDirty(next, baseline));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function validateField(field: "cohortName" | "description" | "hotmartProductId" | "name") {
    const result = comboSchema.shape[field].safeParse(form[field]);
    setErrors((current) => ({ ...current, [field]: result.success ? undefined : result.error.issues[0]?.message }));
  }

  async function submit() {
    if (!canEdit) {
      return;
    }

    const parsed = comboSchema.safeParse(formToComboInput(form, combo?.id));

    if (!parsed.success) {
      const next: FieldErrors = {};

      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]) as keyof ComboFormState;
        next[key] ??= issue.message;
      }

      setErrors(next);
      return;
    }

    onSavingChange(true);
    setFormError(null);
    const result = await saveCombo(formToComboInput(form, combo?.id));
    onSavingChange(false);

    if (!result.ok) {
      setErrors(fieldErrorsFrom(result));
      setFormError(result.error);
      return;
    }

    onDirtyChange(false);
    onSaved(result.data, !combo);
  }

  return (
    <form
      className="flex flex-col"
      id={FORM_ID}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {formError ? <ErrorBanner className="mt-4">{formError}</ErrorBanner> : null}
      <fieldset className="contents" disabled={!canEdit}>
        <AdminSheetSection title="Pacote">
          <AdminField error={errors.name} id="pacote-nome" label="Nome">
            <Input
              aria-describedby={fieldDescribedBy("pacote-nome", { error: errors.name })}
              aria-invalid={errors.name ? true : undefined}
              autoFocus={!combo}
              className={adminInputClass}
              id="pacote-nome"
              maxLength={80}
              onBlur={() => validateField("name")}
              onChange={(event) => update("name", event.target.value)}
              placeholder="Ex.: Formação + Bootcamp"
              value={form.name}
            />
          </AdminField>
          <AdminField
            error={errors.description}
            hint={descriptionHint}
            id="pacote-descricao"
            label="Descrição"
            optional
          >
            <textarea
              aria-describedby={fieldDescribedBy("pacote-descricao", { error: errors.description, hint: descriptionHint })}
              aria-invalid={errors.description ? true : undefined}
              className={cn(adminTextareaClass, "min-h-20")}
              id="pacote-descricao"
              maxLength={300}
              onBlur={() => validateField("description")}
              onChange={(event) => update("description", event.target.value)}
              value={form.description}
            />
          </AdminField>
        </AdminSheetSection>

        <AdminSheetSection aside={form.productIds.length === 1 ? "1 escolhido" : `${form.productIds.length} escolhidos`} title="Produtos">
          <AdminField error={errors.productIds} hint={productsHint} id="pacote-produtos" label="Produtos do pacote">
            <ProductPicker
              emptyText="Nenhum produto à venda ainda."
              error={errors.productIds}
              hint={productsHint}
              id="pacote-produtos"
              items={pickerItems}
              mode="multiple"
              onChange={(ids) => update("productIds", ids)}
              value={form.productIds}
            />
          </AdminField>
        </AdminSheetSection>

        <AdminSheetSection title="Turma e situação">
          <AdminField
            error={errors.cohortName}
            hint={cohortHint}
            id="pacote-turma"
            label="Turma"
            optional
          >
            <Input
              aria-describedby={fieldDescribedBy("pacote-turma", { error: errors.cohortName, hint: cohortHint })}
              aria-invalid={errors.cohortName ? true : undefined}
              autoComplete="off"
              className={cn(adminInputClass, "max-w-80")}
              id="pacote-turma"
              list={cohortListId}
              maxLength={80}
              onBlur={() => validateField("cohortName")}
              onChange={(event) => update("cohortName", event.target.value)}
              placeholder={DEFAULT_COHORT_NAME}
              value={form.cohortName}
            />
          </AdminField>
          <datalist id={cohortListId}>
            {cohorts.map((cohort) => (
              <option key={cohort} value={cohort} />
            ))}
          </datalist>
          <AdminField error={errors.hotmartProductId} hint={hotmartHint} id="pacote-hotmart" label="Código do pacote na Hotmart" optional>
            <Input
              aria-describedby={fieldDescribedBy("pacote-hotmart", { error: errors.hotmartProductId, hint: hotmartHint })}
              aria-invalid={errors.hotmartProductId ? true : undefined}
              autoComplete="off"
              className={cn(adminInputClass, "max-w-80 tabular-nums")}
              id="pacote-hotmart"
              inputMode="numeric"
              maxLength={120}
              onBlur={() => validateField("hotmartProductId")}
              onChange={(event) => update("hotmartProductId", event.target.value)}
              placeholder="Ex.: 1234567"
              value={form.hotmartProductId}
            />
          </AdminField>
          <AdminField hint={COMBO_STATUS_HINTS[form.status]} id="pacote-situacao" label="Situação">
            <PillGroup
              ariaLabel="Situação do pacote"
              name="pacote-situacao"
              onChange={(value) => update("status", value)}
              options={statusOptions}
              value={form.status}
            />
          </AdminField>
          <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2.5 text-[13px] leading-5 text-[var(--text-secondary)]">
            Mudar os produtos vale para as próximas vendas: quem já comprou continua com o que recebeu.
          </p>
        </AdminSheetSection>
      </fieldset>
    </form>
  );
}
