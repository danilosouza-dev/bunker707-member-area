"use client";

import { BookmarkPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PopupFontFace } from "@/server/communications/popup-design-model";
import type { PopupFreeDesign } from "@/server/communications/popup-free-model";
import { loadDesignTemplates, type DesignTemplateOption } from "@/server/communications/template-actions";
import type { TemplateDesignMode } from "@/server/communications/template-model";
import { TemplateNameDialog, type TemplateNameDialogProps } from "../templates/template-name-dialog";
import { FreeDesignThumb } from "../templates/template-thumbs";
import { designTemplatesPickerState, nextDesignTemplatesLoad, type DesignTemplatesEvent, type DesignTemplatesLoad } from "../popup-design/popup-design-editor-model";
import { FREE_EDITOR_COPY } from "./free-editor-model";
import { freeSmallButton } from "./free-fields";

// Aba "Modelos" do editor Livre (docs/28 §5.9): primeiro "Salvar este design como modelo" (o dialogo do nome, por
// cima do editor, como o colar; grava o design do historico atual sem salvar o aviso) e depois "Meus modelos", os
// designs Livres que a equipe guardou, lidos quando a aba abre pela primeira vez (o editor guarda o que leu: trocar de
// aba nao pede de novo). "Usar este modelo" troca o design de uma vez (um passo no historico; Ctrl + Z desfaz).

const copy = FREE_EDITOR_COPY.templates;

/** So os modelos Livres entram aqui (a leitura ja vem filtrada pelo modo; isto so estreita o tipo). */
export type FreeTemplateItem = DesignTemplateOption & { design: PopupFreeDesign };

export function isFreeTemplateItem(item: DesignTemplateOption): item is FreeTemplateItem {
  return "mode" in item.design && item.design.mode === "free";
}

/**
 * "Meus modelos" de um modo, lido sob demanda (docs/28 D24): `open` pede so na primeira vez (a lista ja lida fica),
 * `retry` pede de novo depois de um erro e `reset` descarta o que foi lido (depois de salvar um design como modelo),
 * para ler de novo na proxima abertura. Uma resposta que chega depois de um reset e ignorada. O card Design (um por
 * modo) e a aba Modelos do editor Livre usam.
 */
export function useDesignTemplatesLoad(mode: TemplateDesignMode) {
  const [load, setLoad] = useState<DesignTemplatesLoad<DesignTemplateOption>>({ status: "idle" });
  const [fonts, setFonts] = useState<PopupFontFace[]>([]);
  const loadRef = useRef(load);
  const requestRef = useRef(0);

  const dispatch = useCallback((event: DesignTemplatesEvent<DesignTemplateOption>) => {
    const next = nextDesignTemplatesLoad(loadRef.current, event);

    loadRef.current = next;
    setLoad(next);

    return next;
  }, []);

  const request = useCallback(
    (event: "open" | "retry") => {
      const before = loadRef.current;
      const next = dispatch({ kind: event });

      if (next === before || next.status !== "loading") {
        return;
      }

      const id = requestRef.current + 1;

      requestRef.current = id;
      void loadDesignTemplates({ mode })
        .then((result) => {
          if (requestRef.current !== id) {
            return;
          }

          if (result.ok) {
            setFonts(result.data.fonts);
            dispatch({ items: result.data.items, kind: "loaded", total: result.data.total });
          } else {
            dispatch({ kind: "failed" });
          }
        })
        .catch(() => {
          if (requestRef.current === id) {
            dispatch({ kind: "failed" });
          }
        });
    },
    [dispatch, mode]
  );

  const open = useCallback(() => request("open"), [request]);
  const retry = useCallback(() => request("retry"), [request]);
  const reset = useCallback(() => {
    requestRef.current += 1;
    dispatch({ kind: "reset" });
  }, [dispatch]);

  return { fonts, load, open, reset, retry };
}

export type FreeTemplatesPanelProps = {
  /** Um envio subindo (imagem, video): salvar espera. */
  busy: string | null;
  defaultName: string;
  disabled: boolean;
  fonts: readonly PopupFontFace[];
  load: DesignTemplatesLoad<DesignTemplateOption>;
  /** A aba abriu: pede a lista se ainda nao pediu. */
  onOpen: () => void;
  onRetry: () => void;
  onSave: TemplateNameDialogProps["onSubmit"];
  onUse: (item: FreeTemplateItem) => void;
};

export function FreeTemplatesPanel({ busy, defaultName, disabled, fonts, load, onOpen, onRetry, onSave, onUse }: FreeTemplatesPanelProps) {
  const [saving, setSaving] = useState(false);
  const view = designTemplatesPickerState(load, { copy });
  const items = view.section ? view.section.items.filter((entry) => isFreeTemplateItem(entry.item)) : [];

  useEffect(() => {
    onOpen();
  }, [onOpen]);

  return (
    <div className="flex min-w-0 flex-col gap-4 p-3" data-free-templates="">
      <Button
        aria-disabled={busy ? true : undefined}
        className={cn(freeSmallButton, "w-full justify-center", busy && "opacity-60")}
        data-free-template-save=""
        disabled={disabled}
        onClick={() => (busy ? undefined : setSaving(true))}
        title={busy ? FREE_EDITOR_COPY.save.waitUpload : undefined}
        type="button"
        variant="secondary"
      >
        <BookmarkPlus aria-hidden="true" className="size-4" />
        {copy.save}
      </Button>

      <section aria-labelledby="livre-meus-modelos-titulo" className="flex min-w-0 flex-col gap-2">
        <h3 className="text-xs leading-4 font-semibold tracking-wide text-[var(--text-tertiary)] uppercase" id="livre-meus-modelos-titulo">
          {copy.title}
        </h3>

        {view.loading ? (
          <div aria-busy="true" className="flex min-w-0 flex-col gap-2" role="status">
            <span className="sr-only">{view.loading.label}</span>
            {[0, 1].map((row) => (
              <span aria-hidden="true" className="block h-[184px] w-full animate-pulse rounded-lg bg-[var(--surface-2)]" key={row} />
            ))}
          </div>
        ) : null}

        {view.error ? (
          <div className="flex min-w-0 flex-col items-start gap-2" role="alert">
            <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{view.error.message}</p>
            <Button className={freeSmallButton} onClick={onRetry} type="button" variant="secondary">
              {view.error.retry}
            </Button>
          </div>
        ) : null}

        {load.status === "ready" && items.length === 0 ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.empty}</p> : null}

        {items.length > 0 ? (
          <ul aria-label={copy.listLabel} className="m-0 flex min-w-0 list-none flex-col gap-2 p-0">
            {items.map((entry) => (
              <li className="flex min-w-0 flex-col items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3" key={entry.item.id}>
                <FreeDesignThumb design={(entry.item as FreeTemplateItem).design} fonts={fonts} size="picker" />
                <div className="min-w-0">
                  <p className="truncate text-sm leading-5 font-medium text-[var(--text-primary)]">{entry.name}</p>
                  <p className="text-xs leading-5 text-[var(--text-secondary)]">{entry.updated}</p>
                </div>
                <Button
                  aria-label={entry.useLabel}
                  className={freeSmallButton}
                  disabled={disabled}
                  onClick={() => onUse(entry.item as FreeTemplateItem)}
                  type="button"
                  variant="secondary"
                >
                  {copy.use}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        {view.section?.note ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{view.section.note}</p> : null}
      </section>

      <TemplateNameDialog
        confirmLabel={copy.dialogConfirm}
        defaultName={defaultName}
        description={copy.dialogDescription}
        onOpenChange={setSaving}
        onSubmit={onSave}
        open={saving}
        title={copy.dialogTitle}
      />
    </div>
  );
}
