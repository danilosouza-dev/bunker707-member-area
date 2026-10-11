"use client";

import { Check } from "lucide-react";
import { useId, useRef, type KeyboardEvent } from "react";
import { LoginExperience } from "@/components/login-experience";
import type { LoginTemplateId } from "@/lib/login-config";
import { cn } from "@/lib/utils";
import {
  LOGIN_TEMPLATE_GALLERY,
  applyLoginTemplate,
  resolveLoginPageConfig,
  type LoginPageSettings
} from "@/server/member-area/login-model";
import { StatusChip } from "../../status-chip";
import { adminTransition } from "../../styles";
import { PreviewFrame } from "../preview-frame";

// Galeria de modelos do login: 4 cartoes com miniatura VIVA (o rascunho atual aplicado a cada modelo,
// desenhado pelo componente real do aluno). Grupo de radio (WAI-ARIA): Tab entra no escolhido, setas
// trocam e escolhem, Enter ou Espaco escolhem o que esta em foco.

type TemplateGalleryProps = {
  disabled: boolean;
  draft: LoginPageSettings;
  labelledBy: string;
  logoImage: string | null;
  onChange: (template: LoginTemplateId) => void;
  /** Modelo publicado agora (mostra "Em uso"). */
  publishedTemplate: LoginTemplateId;
};

export function TemplateGallery({ disabled, draft, labelledBy, logoImage, onChange, publishedTemplate }: TemplateGalleryProps) {
  const baseId = useId();
  const items = useRef<(HTMLDivElement | null)[]>([]);
  const selectedIndex = Math.max(
    0,
    LOGIN_TEMPLATE_GALLERY.findIndex((item) => item.id === draft.template)
  );

  function choose(index: number, focus: boolean) {
    const item = LOGIN_TEMPLATE_GALLERY[index];

    if (!item) {
      return;
    }

    if (!disabled) {
      onChange(item.id);
    }

    if (focus) {
      items.current[index]?.focus();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>, index: number) {
    const last = LOGIN_TEMPLATE_GALLERY.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      ArrowRight: index === last ? 0 : index + 1,
      ArrowUp: index === 0 ? last : index - 1,
      End: last,
      Home: 0
    };

    if (event.key in moves) {
      event.preventDefault();
      choose(moves[event.key], true);
      return;
    }

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      choose(index, false);
    }
  }

  return (
    <div aria-disabled={disabled || undefined} aria-labelledby={labelledBy} className="grid min-w-0 gap-3 sm:grid-cols-2" role="radiogroup">
      {LOGIN_TEMPLATE_GALLERY.map((item, index) => {
        const checked = index === selectedIndex;
        const nameId = `${baseId}-${item.id}-nome`;
        const descriptionId = `${baseId}-${item.id}-descricao`;
        const config = resolveLoginPageConfig(applyLoginTemplate(draft, item.id), { logoImage });

        return (
          <div
            aria-checked={checked}
            aria-describedby={descriptionId}
            aria-disabled={disabled || undefined}
            aria-labelledby={nameId}
            className={cn(
              "relative flex min-w-0 flex-col gap-3 rounded-lg border p-3 select-none",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]",
              checked
                ? "border-[var(--text-primary)] bg-[var(--surface-2)]"
                : "border-[var(--border-subtle)] bg-[var(--surface-1)] hover:border-[var(--border-strong)] hover:bg-[var(--hover-overlay)]",
              disabled ? "cursor-default" : "cursor-pointer",
              adminTransition
            )}
            key={item.id}
            onClick={() => choose(index, false)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            ref={(element) => {
              items.current[index] = element;
            }}
            role="radio"
            tabIndex={checked ? 0 : -1}
          >
            <PreviewFrame ariaLabel={`Miniatura do modelo ${item.name}`} className="[&_figcaption]:hidden" device="desktop">
              <LoginExperience authConfigured config={config} preview redirectTo="/" />
            </PreviewFrame>
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm leading-5 font-medium text-[var(--text-primary)]" id={nameId}>
                    {item.name}
                  </span>
                  {item.id === publishedTemplate ? <StatusChip tone="success">Em uso</StatusChip> : null}
                </span>
                <span className="text-xs leading-5 text-[var(--text-secondary)]" id={descriptionId}>
                  {item.description}
                </span>
              </div>
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border",
                  checked ? "border-transparent bg-[var(--text-primary)] text-[var(--surface-0)]" : "border-[var(--border-strong)]"
                )}
              >
                {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
