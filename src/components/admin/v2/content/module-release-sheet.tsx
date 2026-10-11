"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ActionFailure } from "@/lib/action-result";
import { describeReleasePhrase } from "@/server/catalog/model";
import { releasePhraseSchema } from "@/server/catalog/schemas";
import type { ReleasePhrase } from "@/server/catalog/types";
import { ErrorBanner } from "../error-banner";
import { ReleasePhraseField } from "../release-phrase-field";
import { AdminSheet, AdminSheetSection } from "../sheet";
import type { TreeModule } from "./tree-model";

// Liberacao do modulo (menu do modulo › "Liberação…", ou a frase na linha do modulo). Painel pequeno
// com a frase e a previa; salvar grava so a regra do modulo (updateModule).

type ModuleReleaseSheetProps = {
  module: TreeModule;
  onOpenChange: (open: boolean) => void;
  onSave: (moduleId: string, release: ReleasePhrase) => Promise<ActionFailure | null>;
  open: boolean;
  /** Capa do produto (28 x 40) a esquerda do titulo do painel. */
  media?: ReactNode;
  productTitle: string;
};

function sameRelease(left: ReleasePhrase, right: ReleasePhrase) {
  return describeReleasePhrase(left) === describeReleasePhrase(right);
}

export function ModuleReleaseSheet({ media, module, onOpenChange, onSave, open, productTitle }: ModuleReleaseSheetProps) {
  const [draft, setDraft] = useState<ReleasePhrase>(module.release);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = !sameRelease(draft, module.release);

  async function save() {
    const parsed = releasePhraseSchema.safeParse(draft);

    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Revise a liberação.");

      return;
    }

    if (!dirty) {
      onOpenChange(false);

      return;
    }

    setSaving(true);
    setFieldError(null);
    setFailure(null);
    const error = await onSave(module.id, parsed.data);
    setSaving(false);

    if (error) {
      const message = error.fieldErrors?.release?.[0];

      if (message) {
        setFieldError(message);
      } else {
        setFailure(error.error);
      }

      return;
    }

    onOpenChange(false);
  }

  return (
    <AdminSheet
      description={`Módulo ${module.position} · ${module.title}`}
      eyebrow={productTitle}
      media={media}
      footer={
        <>
          <p className="min-w-0 truncate text-[13px] leading-5 text-[var(--text-secondary)]">
            {dirty ? "Alterações não salvas" : module.releaseLabel}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button className="px-4" disabled={saving} onClick={() => onOpenChange(false)} type="button" variant="ghost">
              Cancelar
            </Button>
            <Button className="px-4" disabled={saving} onClick={() => void save()} type="button">
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title="Liberação do módulo"
    >
      {failure ? <ErrorBanner className="mt-4">{failure}</ErrorBanner> : null}
      <AdminSheetSection title="Quando o aluno vê este módulo">
        <ReleasePhraseField
          disabled={saving}
          entity="módulo"
          error={fieldError}
          id={`module-release-${module.id}`}
          onChange={(phrase) => {
            setDraft(phrase);
            setFieldError(null);
          }}
          value={draft}
        />
        <p className="text-[13px] leading-5 text-[var(--text-tertiary)]">
          Cada aula pode ter regra própria no painel da aula. O aluno vê a aula quando as duas regras liberam.
        </p>
      </AdminSheetSection>
    </AdminSheet>
  );
}
