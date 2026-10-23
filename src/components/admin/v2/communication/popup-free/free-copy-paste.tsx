"use client";

import { Popover } from "@base-ui/react/popover";
import { ClipboardCopy, ClipboardPaste, Copy, Sparkles } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { adminTransition } from "../../styles";
import { FREE_EDITOR_COPY } from "./free-editor-model";

// "Copiar e colar" do editor Livre (docs/27 L1.1): um botao na barra de cima com "Copiar o design" (a forma
// canonica em JSON vai para a area de transferencia), "Colar o design…" (um dialogo com o campo do JSON e o botao
// de ler a area de transferencia; o editor valida e aplica num passo so do historico) e "Copiar as instrucoes para a
// IA" (o docs/27 §9, baixado so no clique). Quando o navegador nao deixa copiar, um dialogo mostra o texto
// selecionado para o Ctrl + C. Erros ficam no dialogo (nunca em toast).

const copy = FREE_EDITOR_COPY.transfer;

export type FreeCopyPasteProps = {
  /** Sem permissao para mudar: so copiar. */
  disabled: boolean;
  /** O texto de "Copiar o design" (a forma canonica em JSON). */
  designText: () => string;
  /** O texto das instrucoes para a IA (o pedaco e baixado so aqui). */
  loadInstructions: () => Promise<string>;
  /** Copiou (a frase do toast). */
  onCopied: (message: string) => void;
  /** Colar: os erros (o dialogo fica aberto) ou null (o design foi aplicado). */
  onPaste: (text: string) => readonly string[] | null;
};

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) {
      return false;
    }

    await navigator.clipboard.writeText(text);

    return true;
  } catch {
    return false;
  }
}

/** Baixa o pedaco das instrucoes antes do clique (abrir o menu ja comeca). */
function prefetchInstructions() {
  void import("./free-ai-instructions").catch(() => undefined);
}

export function FreeCopyPaste({ designText, disabled, loadInstructions, onCopied, onPaste }: FreeCopyPasteProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [manual, setManual] = useState<string | null>(null);

  async function copyText(load: () => string | Promise<string>, message: string) {
    setMenuOpen(false);

    const text = await load();

    if (await writeClipboard(text)) {
      onCopied(message);
    } else {
      setManual(text);
    }
  }

  return (
    <>
      <Popover.Root
        onOpenChange={(open) => {
          setMenuOpen(open);

          if (open) {
            prefetchInstructions();
          }
        }}
        open={menuOpen}
      >
        {/* So o icone ate 1.535 px (a barra de cima ja esta cheia); o nome aparece em telas bem largas. */}
        <Popover.Trigger
          aria-label={copy.menu}
          className={cn(
            "flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap text-[var(--text-primary)] hover:bg-[var(--hover-overlay)] data-popup-open:bg-[var(--surface-3)]",
            adminTransition
          )}
          data-free-transfer=""
          title={copy.menu}
        >
          <ClipboardCopy aria-hidden="true" className="size-4 shrink-0" />
          <span className="sr-only 2xl:not-sr-only">{copy.menu}</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner align="end" className="z-[60] outline-none" collisionPadding={8} sideOffset={6}>
            <Popover.Popup className="w-80 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-1.5 text-[var(--text-primary)] shadow-[0_14px_36px_rgba(0,0,0,0.55)] outline-none">
              <Popover.Title className="sr-only">{copy.menu}</Popover.Title>
              <div className="flex flex-col">
                <MenuButton icon={<Copy aria-hidden="true" className="size-4" />} label={copy.copyDesign} marker="copy" onClick={() => void copyText(designText, copy.copied)} />
                <MenuButton
                  disabled={disabled}
                  icon={<ClipboardPaste aria-hidden="true" className="size-4" />}
                  label={copy.pasteDesign}
                  marker="paste"
                  onClick={() => {
                    setMenuOpen(false);
                    setPasteOpen(true);
                  }}
                />
                <MenuButton
                  icon={<Sparkles aria-hidden="true" className="size-4" />}
                  label={copy.copyInstructions}
                  marker="instructions"
                  onClick={() => void copyText(loadInstructions, copy.instructionsCopied)}
                />
              </div>
              <p className="mt-1 border-t border-[var(--border-subtle)] px-2 pt-2 pb-1 text-xs leading-4 text-[var(--text-secondary)]">{copy.menuHint}</p>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      <PasteDialog onOpenChange={setPasteOpen} onPaste={onPaste} open={pasteOpen} />
      <ManualCopyDialog onClose={() => setManual(null)} text={manual} />
    </>
  );
}

function MenuButton({ disabled, icon, label, marker, onClick }: { disabled?: boolean; icon: ReactNode; label: string; marker: string; onClick: () => void }) {
  return (
    <button
      className={cn(
        "flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm leading-5 hover:bg-[var(--surface-2)] focus-visible:bg-[var(--surface-2)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        adminTransition
      )}
      data-free-transfer-action={marker}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function PasteDialog({ onOpenChange, onPaste, open }: { onOpenChange: (open: boolean) => void; onPaste: FreeCopyPasteProps["onPaste"]; open: boolean }) {
  const baseId = useId();
  const fieldId = `${baseId}-json`;
  const errorsId = `${baseId}-erros`;
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<readonly string[]>([]);
  const field = useRef<HTMLTextAreaElement>(null);

  /** Fechar limpa o campo (a proxima abertura comeca vazia). */
  function change(next: boolean) {
    if (!next) {
      setText("");
      setErrors([]);
    }

    onOpenChange(next);
  }

  async function fromClipboard() {
    try {
      const value = await navigator.clipboard.readText();

      setText(value);
      setErrors([]);
    } catch {
      setErrors([copy.clipboardBlocked]);
    }

    field.current?.focus();
  }

  function apply() {
    const result = onPaste(text);

    if (result) {
      setErrors(result);
      field.current?.focus();

      return;
    }

    change(false);
  }

  return (
    <Dialog onOpenChange={change} open={open}>
      <DialogContent
        className="max-w-xl rounded-xl border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)]"
        data-free-paste=""
        initialFocus={field}
        showCloseButton={false}
      >
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <DialogHeader className="gap-1 px-5 pt-5 pb-2">
            <DialogTitle className="text-base leading-6 font-semibold text-[var(--text-primary)]">{copy.pasteTitle}</DialogTitle>
            <DialogDescription className="text-sm leading-5 text-[var(--text-secondary)]">{copy.pasteDescription}</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 py-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <label className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" htmlFor={fieldId}>
                {copy.pasteLabel}
              </label>
              <textarea
                aria-describedby={errors.length > 0 ? errorsId : undefined}
                aria-invalid={errors.length > 0 || undefined}
                autoComplete="off"
                className="min-h-56 w-full resize-y rounded-lg border border-[var(--border-strong)] bg-[var(--surface-1)] px-3 py-2 font-mono text-xs leading-5 text-[var(--text-primary)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                id={fieldId}
                onChange={(event) => {
                  setText(event.target.value);
                  setErrors([]);
                }}
                ref={field}
                spellCheck={false}
                value={text}
              />
            </div>
            <div>
              <Button className="h-9 gap-1.5 px-3" onClick={() => void fromClipboard()} type="button" variant="secondary">
                <ClipboardPaste aria-hidden="true" className="size-4" />
                {copy.fromClipboard}
              </Button>
            </div>
            {errors.length > 0 ? (
              <div className="rounded-lg border border-[var(--error-border)] bg-[var(--error-bg)] px-3 py-2" data-free-paste-errors="" id={errorsId} role="alert">
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] leading-5 text-[var(--text-primary)]">
                  {errors.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <DialogFooter className="px-5 pt-3 pb-5">
            <Button className="px-4 text-[var(--text-secondary)]" onClick={() => change(false)} type="button" variant="ghost">
              {copy.cancel}
            </Button>
            <Button className="px-4" data-free-paste-apply="" type="submit">
              {copy.apply}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ManualCopyDialog({ onClose, text }: { onClose: () => void; text: string | null }) {
  const fieldId = useId();
  const field = useRef<HTMLTextAreaElement>(null);

  return (
    <Dialog onOpenChange={(open) => (!open ? onClose() : undefined)} open={text !== null}>
      <DialogContent className="max-w-xl rounded-xl border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)]" initialFocus={field} showCloseButton={false}>
        <DialogHeader className="gap-1 px-5 pt-5 pb-2">
          <DialogTitle className="text-base leading-6 font-semibold text-[var(--text-primary)]">{copy.manualTitle}</DialogTitle>
          <DialogDescription className="text-sm leading-5 text-[var(--text-secondary)]">{copy.manualDescription}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-1.5 px-5 py-3">
          <label className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" htmlFor={fieldId}>
            {copy.manualLabel}
          </label>
          <textarea
            className="min-h-56 w-full resize-y rounded-lg border border-[var(--border-strong)] bg-[var(--surface-1)] px-3 py-2 font-mono text-xs leading-5 text-[var(--text-primary)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            id={fieldId}
            onFocus={(event) => event.currentTarget.select()}
            readOnly
            ref={field}
            spellCheck={false}
            value={text ?? ""}
          />
        </div>
        <DialogFooter className="px-5 pt-3 pb-5">
          <Button className="px-4" onClick={onClose} type="button" variant="secondary">
            {copy.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
