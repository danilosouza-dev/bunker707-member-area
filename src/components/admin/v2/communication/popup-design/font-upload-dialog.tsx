"use client";

import { Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { POPUP_FONT_LIMITS, POPUP_FONT_WEIGHTS, type PopupFontOption, type PopupFontStyle, type PopupFontWeight } from "@/server/communications/popup-design-model";
import { AdminField, adminInputClass } from "../../form";
import { DesignFieldError, DesignSelect, PillField } from "./design-controls";
import { FONT_STYLE_OPTIONS, FONT_WEIGHT_LABELS, POPUP_DESIGN_COPY, fontFileProblem, fontNameFromFile } from "./popup-design-editor-model";

// "Enviar fonte" (docs/26 §5.2): arquivo WOFF2, WOFF, TTF ou OTF de ate 2 MB, nome, peso e estilo. Vai pela rota
// POST /api/admin/communications/popup-fonts (multipart: o arquivo passa do limite das Server Actions); o servidor
// confere os primeiros bytes de novo. O mesmo arquivo enviado de novo devolve a mesma fonte (sem duplicar).

const copy = POPUP_DESIGN_COPY.fontDialog;
const ACCEPT = ".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf";

type FontUploadDialogProps = {
  onOpenChange: (open: boolean) => void;
  onUploaded: (font: PopupFontOption) => void;
  open: boolean;
};

async function sendFont(input: { file: File; name: string; style: PopupFontStyle; weight: PopupFontWeight }): Promise<PopupFontOption> {
  const form = new FormData();
  form.append("file", input.file);
  form.append("name", input.name.trim());
  form.append("weight", String(input.weight));
  form.append("style", input.style);

  let response: Response;

  try {
    response = await fetch("/api/admin/communications/popup-fonts", { body: form, credentials: "same-origin", method: "POST" });
  } catch {
    throw new Error(copy.failed);
  }

  const payload = (await response.json().catch(() => null)) as { data?: PopupFontOption; error?: string } | null;

  if (!response.ok || !payload?.data?.id) {
    throw new Error(payload?.error || copy.failed);
  }

  return payload.data;
}

export function FontUploadDialog({ onOpenChange, onUploaded, open }: FontUploadDialogProps) {
  const baseId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [weight, setWeight] = useState<PopupFontWeight>(400);
  const [style, setStyle] = useState<PopupFontStyle>("normal");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileId = `${baseId}-arquivo`;
  const nameId = `${baseId}-nome`;

  function reset() {
    setFile(null);
    setName("");
    setWeight(400);
    setStyle("normal");
    setError(null);
  }

  async function submit() {
    const problem = fontFileProblem(file);

    if (problem || !file) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const font = await sendFont({ file, name: name.trim() || fontNameFromFile(file.name), style, weight });
      onUploaded(font);
      reset();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        if (busy) {
          return;
        }

        if (!next) {
          reset();
        }

        onOpenChange(next);
      }}
      open={open}
    >
      <DialogContent className="max-w-md rounded-xl border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)]" showCloseButton={false}>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader className="gap-1 px-5 pt-5 pb-2">
            <DialogTitle className="text-base leading-6 font-semibold text-[var(--text-primary)]">{copy.title}</DialogTitle>
            <DialogDescription className="text-sm leading-5 text-[var(--text-secondary)]">{copy.description}</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <label className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" htmlFor={fileId}>
                {copy.file}
              </label>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Button className="h-10 gap-1.5 px-3" disabled={busy} onClick={() => fileInput.current?.click()} type="button" variant="secondary">
                  <Upload aria-hidden="true" className="size-4" />
                  {copy.chooseFile}
                </Button>
                <span className="min-w-0 truncate text-sm text-[var(--text-secondary)]">{file ? file.name : null}</span>
              </div>
              <input
                accept={ACCEPT}
                aria-describedby={error ? `${fileId}-error` : undefined}
                className="sr-only"
                disabled={busy}
                id={fileId}
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  event.target.value = "";
                  setFile(next);
                  setError(next ? fontFileProblem(next) : null);

                  if (next && !name.trim()) {
                    setName(fontNameFromFile(next.name));
                  }
                }}
                ref={fileInput}
                type="file"
              />
            </div>

            <AdminField id={nameId} label={copy.name}>
              <Input
                autoComplete="off"
                className={adminInputClass}
                disabled={busy}
                id={nameId}
                maxLength={POPUP_FONT_LIMITS.name}
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
            </AdminField>

            <DesignSelect
              disabled={busy}
              groups={[{ items: POPUP_FONT_WEIGHTS.map((item) => ({ label: FONT_WEIGHT_LABELS[item], value: `${item}` })) }]}
              id={`${baseId}-peso`}
              label={copy.weight}
              onChange={(next) => setWeight(Number(next) as PopupFontWeight)}
              value={`${weight}`}
            />

            <PillField disabled={busy} label={copy.style} name={`${baseId}-estilo`} onChange={setStyle} options={FONT_STYLE_OPTIONS} value={style} />

            <DesignFieldError id={`${fileId}-error`} message={error} />
          </div>
          <DialogFooter className="px-5 pt-3 pb-5">
            <Button className="px-4 text-[var(--text-secondary)] pointer-coarse:h-11" disabled={busy} onClick={() => onOpenChange(false)} type="button" variant="ghost">
              {copy.cancel}
            </Button>
            <Button className={cn("px-4 pointer-coarse:h-11")} disabled={busy} type="submit">
              {busy ? copy.sending : copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
