"use client";

import { Upload } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deletePopupFont, renamePopupFont } from "@/server/communications/popup-design-actions";
import { POPUP_FONT_LIMITS, type PopupFontOption } from "@/server/communications/popup-design-model";
import { adminInputClass } from "../../form";
import { ConfirmDialog } from "../../settings/kit";
import { adminToast } from "../../toast";
import { DesignFieldError, DesignSection } from "./design-controls";
import { POPUP_DESIGN_COPY, describeFontOption, sortedFontLibrary } from "./popup-design-editor-model";

// Secao "Fontes" do design (docs/26 §7.2): a biblioteca de fontes enviadas (nome, peso, estilo e tamanho), com
// Renomear e Excluir (o servidor recusa excluir fonte em uso num pop-up) e "Enviar fonte". Nada vem do Google
// na hora: quem quiser uma fonte de la baixa o arquivo e envia aqui.

const copy = POPUP_DESIGN_COPY.fonts;

type FontsSectionProps = {
  disabled: boolean;
  errorFor: (key: string) => string | undefined;
  fonts: readonly PopupFontOption[];
  onFontsChange: (fonts: PopupFontOption[]) => void;
  onRequestUpload: () => void;
};

function FontRow({ disabled, font, onDelete, onRenamed }: { disabled: boolean; font: PopupFontOption; onDelete: () => void; onRenamed: (font: PopupFontOption) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(font.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = `popup-design-fonte-${font.id}-nome`;

  async function save() {
    setBusy(true);
    setError(null);
    const result = await renamePopupFont({ id: font.id, name }).catch(() => null);
    setBusy(false);

    if (!result || !result.ok) {
      setError(result ? (result.fieldErrors?.name?.[0] ?? result.error) : POPUP_DESIGN_COPY.fontDialog.failed);
      return;
    }

    setEditing(false);
    onRenamed(result.data);
    adminToast.success(copy.renamed);
  }

  return (
    <li className="flex min-w-0 flex-col gap-2 border-t border-[var(--border-subtle)] py-3 first:border-t-0 first:pt-0">
      {editing ? (
        <form
          className="flex min-w-0 flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" htmlFor={inputId}>
            {copy.newName}
          </label>
          <Input
            aria-describedby={error ? `${inputId}-error` : undefined}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            autoFocus
            className={adminInputClass}
            disabled={busy}
            id={inputId}
            maxLength={POPUP_FONT_LIMITS.name}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
          <DesignFieldError id={`${inputId}-error`} message={error} />
          <div className="flex flex-wrap gap-2">
            <Button className="h-9 px-3 pointer-coarse:h-11" disabled={busy} type="submit" variant="secondary">
              {copy.save}
            </Button>
            <Button
              className="h-9 px-3 text-[var(--text-secondary)] pointer-coarse:h-11"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setName(font.name);
                setError(null);
              }}
              type="button"
              variant="ghost"
            >
              {copy.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <div className="min-w-0 flex-1 basis-40">
            <p className="truncate text-sm leading-5 font-medium text-[var(--text-primary)]">{font.name}</p>
            <p className="text-xs leading-5 text-[var(--text-secondary)] tabular-nums">{describeFontOption(font)}</p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button aria-label={`${copy.rename} ${font.name}`} className="h-9 px-3 pointer-coarse:h-11" disabled={disabled} onClick={() => setEditing(true)} type="button" variant="ghost">
              {copy.rename}
            </Button>
            <Button
              aria-label={`${copy.delete} ${font.name}`}
              className="h-9 px-3 text-[var(--error)] pointer-coarse:h-11"
              disabled={disabled}
              onClick={onDelete}
              type="button"
              variant="ghost"
            >
              {copy.delete}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

export function FontsSection({ disabled, errorFor, fonts, onFontsChange, onRequestUpload }: FontsSectionProps) {
  const [deleting, setDeleting] = useState<PopupFontOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    if (!deleting) {
      return;
    }

    setBusy(true);
    setError(null);
    const result = await deletePopupFont({ id: deleting.id }).catch(() => null);
    setBusy(false);
    setDeleting(null);

    if (!result || !result.ok) {
      setError(result ? result.error : POPUP_DESIGN_COPY.fontDialog.failed);
      return;
    }

    onFontsChange(fonts.filter((font) => font.id !== result.data.id));
    adminToast.success(copy.deleted);
  }

  return (
    <DesignSection id="popup-design-fontes" title={POPUP_DESIGN_COPY.sections.fonts}>
      {fonts.length === 0 ? (
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.empty}</p>
      ) : (
        <ul className="m-0 flex min-w-0 list-none flex-col p-0">
          {fonts.map((font) => (
            <FontRow
              disabled={disabled}
              font={font}
              key={font.id}
              onDelete={() => setDeleting(font)}
              onRenamed={(renamed) => onFontsChange(sortedFontLibrary([...fonts.filter((item) => item.id !== renamed.id), renamed]))}
            />
          ))}
        </ul>
      )}
      <DesignFieldError message={error ?? errorFor("design.fonts")} />
      <div className="flex min-w-0 flex-col gap-2">
        <div>
          <Button className="h-10 gap-1.5 px-3" disabled={disabled} onClick={onRequestUpload} type="button" variant="secondary">
            <Upload aria-hidden="true" className="size-4" />
            {copy.upload}
          </Button>
        </div>
        <p className="text-xs leading-5 text-[var(--text-secondary)]">{copy.hint}</p>
      </div>

      <ConfirmDialog
        busy={busy}
        cancelLabel={copy.deleteConfirm.cancel}
        confirmLabel={copy.deleteConfirm.confirm}
        description={copy.deleteConfirm.description}
        destructive
        onConfirm={() => void confirmDelete()}
        onOpenChange={(open) => (!open ? setDeleting(null) : undefined)}
        open={deleting !== null}
        title={copy.deleteConfirm.title}
      />
    </DesignSection>
  );
}
