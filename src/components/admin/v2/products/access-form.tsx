"use client";

import { ArrowRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PRODUCT_AUDIENCES, PRODUCT_AUDIENCE_LABELS } from "@/server/catalog/model";
import { updateProductAccess } from "@/server/catalog/product-actions";
import { purchaseUrlSchema, updateProductAccessSchema } from "@/server/catalog/schemas";
import type { ProductAccess } from "@/server/catalog/types";
import { ErrorBanner } from "../error-banner";
import { AdminField, PillGroup, adminInputClass, fieldDescribedBy } from "../form";
import { ReleasePhraseField } from "../release-phrase-field";
import { SaveBar } from "../save-bar";
import { StatusChip } from "../status-chip";
import { adminTransition } from "../styles";
import { adminToast } from "../toast";
import { FieldLegend } from "./form-section";
import {
  AUDIENCE_HINTS,
  COMBO_STATUS_LABELS,
  PURCHASE_TARGET_OPTIONS,
  accessDraftFrom,
  buildAccessPatch,
  describeStudentCount,
  firstErrorsByField,
  firstServerFieldErrors,
  isEmptyPatch,
  maxStudentsProblem,
  rebaseDraft,
  showsPurchaseFields,
  type AccessDraft
} from "./product-forms";
import { useProductWorkspace } from "./product-workspace";
import { useWarnBeforeUnload } from "./use-warn-before-unload";

// Aba Acesso e venda (docs/17 §1.6.5) na disposicao do prototipo aprovado: uma coluna de 640 px, sem
// titulos de bloco, 24 px entre os campos: quem pode ver, link e texto do botao de compra (e como o
// link abre), liberacao padrao das aulas, pacotes que incluem o produto e turmas (so leitura, em
// chips) e o limite de alunos (campo de 200 px). Os campos editaveis salvam juntos pela SaveBar.
// "Próximo passo" do prototipo ainda nao existe e nao aparece.

type SaveFailure = { message: string; status: number };

const comboTone = { active: "success", draft: "neutral", paused: "muted" } as const;

/** Chip simples do prototipo (`.chip`): 22 px, raio 6, fundo branco a 6 %, borda sutil, 12/500. */
const plainChip =
  "inline-flex h-[22px] max-w-full min-w-0 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-white/[0.06] px-2 text-xs leading-none font-medium whitespace-nowrap text-[var(--text-primary)]";

export function ProductAccessForm({ access }: { access: ProductAccess }) {
  const router = useRouter();
  const { applyHeader, capabilities, header } = useProductWorkspace();
  const readOnly = !capabilities.canEditAccess;
  const [source, setSource] = useState(access);
  const [baseline, setBaseline] = useState(() => accessDraftFrom(access));
  const [draft, setDraft] = useState(baseline);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [saving, setSaving] = useState(false);
  const patch = buildAccessPatch(baseline, draft);
  const dirty = !readOnly && !isEmptyPatch(patch);
  const hasFieldErrors = Object.keys(errors).length > 0;
  const showPurchase = showsPurchaseFields(draft.audience);

  if (source !== access) {
    const nextBaseline = accessDraftFrom(access);

    setSource(access);
    setBaseline(nextBaseline);
    setDraft(rebaseDraft(baseline, draft, nextBaseline));
    setFailure(null);
  }

  useWarnBeforeUnload(dirty);

  function update<Key extends keyof AccessDraft>(key: Key, value: AccessDraft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));

    if (errors[key]) {
      setErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  function setFieldError(key: keyof AccessDraft, message: string | null) {
    setErrors((current) => {
      const next = { ...current };

      if (message) {
        next[key] = message;
      } else {
        delete next[key];
      }

      return next;
    });
  }

  async function save() {
    if (saving || !dirty) {
      return;
    }

    const limitProblem = maxStudentsProblem(draft.maxStudents);

    if (limitProblem) {
      setFieldError("maxStudents", limitProblem);
      setFailure(null);
      return;
    }

    const input = { ...patch, expectedUpdatedAt: header.updatedAt, id: header.id };
    const parsed = updateProductAccessSchema.safeParse(input);

    if (!parsed.success) {
      setErrors(firstErrorsByField(parsed.error.issues));
      setFailure(null);
      return;
    }

    setSaving(true);
    setFailure(null);
    const result = await updateProductAccess(input);
    setSaving(false);

    if (!result.ok) {
      const fieldErrors = firstServerFieldErrors(result.fieldErrors);

      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors);
      } else {
        setFailure({ message: result.error, status: result.status });
      }

      return;
    }

    applyHeader(result.data.header);
    setBaseline(draft);
    setErrors({});
    adminToast.success("Acesso e venda salvos");
  }

  return (
    <div className="flex w-full max-w-[640px] min-w-0 flex-col gap-6">
      {failure?.status === 409 ? (
        <ErrorBanner
          action={
            <Button className="px-3" onClick={() => router.refresh()} type="button" variant="secondary">
              Recarregar
            </Button>
          }
        >
          {failure.message}
        </ErrorBanner>
      ) : null}

      <fieldset className="flex min-w-0 flex-col gap-2">
        <FieldLegend>Quem pode ver</FieldLegend>
        <PillGroup
          ariaLabel="Quem pode ver"
          disabled={readOnly}
          name="acesso-quem-pode-ver"
          onChange={(value) => update("audience", value)}
          options={PRODUCT_AUDIENCES.map((value) => ({ label: PRODUCT_AUDIENCE_LABELS[value], value }))}
          value={draft.audience}
        />
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{AUDIENCE_HINTS[draft.audience]}</p>
      </fieldset>

      {showPurchase ? (
        <>
          <AdminField error={errors.purchaseUrl} id="acesso-link-compra" label="Link de compra" optional>
            <Input
              aria-describedby={fieldDescribedBy("acesso-link-compra", { error: errors.purchaseUrl })}
              aria-invalid={errors.purchaseUrl ? true : undefined}
              autoComplete="off"
              className={adminInputClass}
              disabled={readOnly}
              id="acesso-link-compra"
              inputMode="url"
              onBlur={() => {
                const result = purchaseUrlSchema.safeParse(draft.purchaseUrl.trim());
                setFieldError("purchaseUrl", result.success ? null : (result.error.issues[0]?.message ?? "Link inválido."));
              }}
              onChange={(event) => update("purchaseUrl", event.target.value)}
              placeholder="https://pay.hotmart.com/seu-produto"
              type="url"
              value={draft.purchaseUrl}
            />
            {!draft.purchaseUrl.trim() && !errors.purchaseUrl ? (
              <p className="flex items-center gap-1.5 text-[13px] leading-5 text-[var(--warning)]">
                <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
                Sem link, o aluno verá “Em breve”.
              </p>
            ) : null}
          </AdminField>

          <AdminField
            error={errors.purchaseLabel}
            hint="Vazio usa “Comprar”."
            id="acesso-texto-botao"
            label="Texto do botão de compra"
            optional
          >
            <Input
              aria-describedby={fieldDescribedBy("acesso-texto-botao", { error: errors.purchaseLabel, hint: "Vazio usa “Comprar”." })}
              aria-invalid={errors.purchaseLabel ? true : undefined}
              autoComplete="off"
              className={adminInputClass}
              disabled={readOnly}
              id="acesso-texto-botao"
              maxLength={40}
              onChange={(event) => update("purchaseLabel", event.target.value)}
              placeholder="Comprar"
              value={draft.purchaseLabel}
            />
          </AdminField>

          <fieldset className="flex min-w-0 flex-col gap-2">
            <FieldLegend>Abrir o link de compra</FieldLegend>
            <PillGroup
              ariaLabel="Abrir o link de compra"
              disabled={readOnly}
              name="acesso-abrir-link"
              onChange={(value) => update("purchaseTarget", value)}
              options={PURCHASE_TARGET_OPTIONS}
              value={draft.purchaseTarget}
            />
          </fieldset>
        </>
      ) : null}

      <fieldset className="flex min-w-0 flex-col gap-2">
        <FieldLegend>Liberação padrão das aulas</FieldLegend>
        <ReleasePhraseField
          allowPreviousLesson={false}
          disabled={readOnly}
          entity="produto"
          error={errors.release}
          id="acesso-liberacao"
          onChange={(value) => update("release", value)}
          value={draft.release}
        />
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]">Cada módulo e cada aula pode ter regra própria na aba Conteúdo.</p>
      </fieldset>

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">Pacotes que incluem este produto</span>
          <Link
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]",
              adminTransition
            )}
            data-navigation-feedback="false"
            href="/admin/produtos/pacotes"
          >
            Ver pacotes
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </div>
        {access.combos.length > 0 ? (
          <ul aria-label="Pacotes que incluem este produto" className="flex min-w-0 flex-wrap gap-1.5">
            {access.combos.map((combo) => (
              <li className="min-w-0" key={combo.id}>
                <StatusChip tone={comboTone[combo.status]}>
                  {combo.name}
                  <span className="sr-only">, {COMBO_STATUS_LABELS[combo.status]}</span>
                </StatusChip>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">Nenhum pacote inclui este produto.</p>
        )}
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
          Quando a venda de um pacote chega da Hotmart ou da Ticto, liberamos todos os produtos dele de uma vez. Produto incluído
          depois não é liberado para quem já comprou o pacote.
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">Turmas</span>
        {access.cohorts.length > 0 ? (
          <ul aria-label="Turmas" className="flex min-w-0 flex-wrap gap-1.5">
            {access.cohorts.map((cohort) => (
              <li className={plainChip} key={cohort.name} title={`${cohort.name} · ${describeStudentCount(cohort.studentsCount)}`}>
                <span className="truncate">{cohort.name}</span>
                <span className="text-[var(--text-tertiary)] tabular-nums">· {describeStudentCount(cohort.studentsCount)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">Nenhuma turma ainda.</p>
        )}
      </div>

      <AdminField
        error={errors.maxStudents}
        hint="Número máximo de alunos com acesso. Vazio = sem limite."
        id="acesso-limite"
        label="Limite de alunos"
        optional
      >
        <Input
          aria-describedby={fieldDescribedBy("acesso-limite", {
            error: errors.maxStudents,
            hint: "Número máximo de alunos com acesso. Vazio = sem limite."
          })}
          aria-invalid={errors.maxStudents ? true : undefined}
          autoComplete="off"
          className={cn(adminInputClass, "w-[200px] max-w-full tabular-nums")}
          disabled={readOnly}
          id="acesso-limite"
          inputMode="numeric"
          onBlur={() => setFieldError("maxStudents", maxStudentsProblem(draft.maxStudents))}
          onChange={(event) => update("maxStudents", event.target.value)}
          placeholder="Sem limite"
          value={draft.maxStudents}
        />
      </AdminField>

      <SaveBar
        error={failure?.message ?? (hasFieldErrors ? "Revise os campos destacados." : null)}
        onDiscard={() => {
          setDraft(baseline);
          setErrors({});
          setFailure(null);
        }}
        onSave={() => void save()}
        open={dirty}
        saving={saving}
      />
    </div>
  );
}
