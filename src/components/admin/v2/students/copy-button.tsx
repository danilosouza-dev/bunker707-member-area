"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Copiar para a area de transferencia com confirmacao no proprio botao (2 s). Sem clipboard
// (navegador antigo ou pagina sem HTTPS), seleciona o texto do elemento indicado para copiar a mao.

type CopyButtonProps = {
  className?: string;
  label: string;
  /** Elemento com o texto, para selecionar quando o clipboard falhar. */
  selectTargetId?: string;
  text: string;
  variant?: "secondary" | "ghost";
};

export function CopyButton({ className, label, selectTargetId, text, variant = "secondary" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      const target = selectTargetId ? document.getElementById(selectTargetId) : null;

      if (target) {
        const range = document.createRange();
        range.selectNodeContents(target);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
    }
  }

  return (
    <Button
      aria-live="polite"
      className={cn("gap-1.5 px-3", variant === "secondary" && "border-[var(--border-strong)]", className)}
      onClick={() => void copy()}
      type="button"
      variant={variant}
    >
      {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
      {copied ? "Copiado" : label}
    </Button>
  );
}
