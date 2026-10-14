"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { createStudent } from "@/server/students/actions";
import {
  ACCESS_DELIVERY_LABELS,
  ACCESS_DELIVERY_METHODS,
  TEMPORARY_PASSWORD_MIN_LENGTH,
  type AccessDeliveryMethod,
  type CreatedStudentResult,
  type StudentCohort
} from "@/server/students/model";
import { studentEmailSchema, studentNameSchema, studentPhoneSchema } from "@/server/students/schemas";
import { ErrorBanner } from "../error-banner";
import { AdminField, PillGroup, adminInputClass, fieldDescribedBy } from "../form";
import { AdminLinkButton } from "../link-button";
import { CohortSelect, withCohort } from "./cohort-select";
import { useWarnBeforeUnload } from "../products/use-warn-before-unload";
import { studentListHref } from "./hrefs";
import { ProductPicker, type PickerProduct } from "./product-picker";
import { StudentCreatedPanel } from "./student-created-panel";

// Adicionar aluno em uma pagina (docs/17 §1.7.2): quem e, o que libera, como entrega. Uma conta
// por e-mail: se ja existir, atualiza nome/telefone, libera os produtos e entrega o acesso do jeito
// escolhido. Meta: nome, e-mail, marcar o produto e Adicionar.

type FieldName = "delivery" | "email" | "endsAt" | "fullName" | "phone" | "productIds" | "temporaryPassword";
type FieldErrors = Partial<Record<FieldName, string>>;

type NewStudentFormProps = {
  cohorts: readonly StudentCohort[];
  /** ?produto= ja marcado (veio da aba Alunos do produto). */
  preselectedProductId: string | null;
  products: readonly PickerProduct[];
  /** Hoje ("AAAA-MM-DD"), calculado no servidor: minimo do campo de data. */
  today: string;
};

const DELIVERY_HINTS: Record<AccessDeliveryMethod, string> = {
  invite:
    "O aluno recebe um e-mail com o link para criar a senha. Depende do envio de e-mail da plataforma estar configurado; sem ele, só a equipe recebe.",
  none: "A conta fica pronta, sem aviso. Depois, envie o e-mail de acesso pelo perfil do aluno.",
  temporary_password: "A senha aparece aqui, uma vez, para você mandar por WhatsApp ou e-mail. O aluno troca no primeiro login."
};

const deliveryOptions = ACCESS_DELIVERY_METHODS.map((method) => ({ label: ACCESS_DELIVERY_LABELS[method], value: method }));

function firstIssue(result: { error?: { issues: { message: string }[] } }) {
  return result.error?.issues[0]?.message ?? null;
}

export function NewStudentForm({ cohorts: initialCohorts, preselectedProductId, products, today }: NewStudentFormProps) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [productIds, setProductIds] = useState<string[]>(preselectedProductId ? [preselectedProductId] : []);
  const [endsAt, setEndsAt] = useState("");
  const [cohortId, setCohortId] = useState<string | null>(null);
  const [cohorts, setCohorts] = useState(initialCohorts);
  const [delivery, setDelivery] = useState<AccessDeliveryMethod>("invite");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreatedStudentResult | null>(null);
  const dirty = !result && Boolean(fullName.trim() || email.trim() || phone.trim() || endsAt || temporaryPassword);

  useWarnBeforeUnload(dirty);

  function setFieldError(field: FieldName, message: string | null) {
    setErrors((current) => {
      const next = { ...current };

      if (message) {
        next[field] = message;
      } else {
        delete next[field];
      }

      return next;
    });
  }

  function reset() {
    setFullName("");
    setEmail("");
    setPhone("");
    setProductIds(preselectedProductId ? [preselectedProductId] : []);
    setEndsAt("");
    setCohortId(null);
    setDelivery("invite");
    setTemporaryPassword("");
    setErrors({});
    setFormError(null);
    setResult(null);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();

    if (submitting) {
      return;
    }

    const nameCheck = studentNameSchema.safeParse(fullName);
    const emailCheck = studentEmailSchema.safeParse(email);

    if (!nameCheck.success || !emailCheck.success) {
      setFieldError("fullName", nameCheck.success ? null : firstIssue(nameCheck));
      setFieldError("email", emailCheck.success ? null : firstIssue(emailCheck));
      document.getElementById(nameCheck.success ? "aluno-email" : "aluno-nome")?.focus();
      return;
    }

    setSubmitting(true);
    setFormError(null);
    const response = await createStudent({
      cohortId: productIds.length > 0 ? cohortId : null,
      delivery,
      email: emailCheck.data,
      endsAt: endsAt || null,
      fullName: nameCheck.data,
      phone: phone.trim() || null,
      productIds,
      temporaryPassword: delivery === "temporary_password" ? temporaryPassword.trim() || null : null
    });
    setSubmitting(false);

    if (!response.ok) {
      const fieldErrors: FieldErrors = {};

      for (const field of ["delivery", "email", "endsAt", "fullName", "phone", "productIds", "temporaryPassword"] as const) {
        const message = response.fieldErrors?.[field]?.[0];

        if (message) {
          fieldErrors[field] = message;
        }
      }

      setErrors(fieldErrors);

      if (Object.keys(fieldErrors).length === 0) {
        setFormError(response.error);
      }

      return;
    }

    setResult(response.data);
  }

  if (result) {
    return <StudentCreatedPanel onAddAnother={reset} productCount={productIds.length} result={result} />;
  }

  const sectionTitle = "text-[15px] leading-5 font-semibold text-[var(--text-primary)]";

  return (
    <form
      className="flex w-full max-w-[640px] flex-col gap-8"
      noValidate
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void submit();
        }
      }}
      onSubmit={(event) => void submit(event)}
    >
      {formError ? <ErrorBanner>{formError}</ErrorBanner> : null}

      <section className="flex flex-col gap-4">
        <h2 className={sectionTitle}>Quem é o aluno</h2>
        <AdminField error={errors.fullName} id="aluno-nome" label="Nome">
          <Input
            aria-describedby={fieldDescribedBy("aluno-nome", { error: errors.fullName })}
            aria-invalid={errors.fullName ? true : undefined}
            autoComplete="off"
            autoFocus
            className={adminInputClass}
            disabled={submitting}
            id="aluno-nome"
            onBlur={() => setFieldError("fullName", fullName.trim() ? firstIssue(studentNameSchema.safeParse(fullName)) : null)}
            onChange={(event) => {
              setFullName(event.target.value);
              setFieldError("fullName", null);
            }}
            placeholder="Nome completo"
            value={fullName}
          />
        </AdminField>
        <AdminField
          error={errors.email}
          hint="Se já houver conta com este e-mail, ela é reaproveitada: nada é duplicado."
          id="aluno-email"
          label="E-mail"
        >
          <Input
            aria-describedby={fieldDescribedBy("aluno-email", { error: errors.email, hint: true })}
            aria-invalid={errors.email ? true : undefined}
            autoComplete="off"
            className={adminInputClass}
            disabled={submitting}
            id="aluno-email"
            inputMode="email"
            onBlur={() => setFieldError("email", email.trim() ? firstIssue(studentEmailSchema.safeParse(email)) : null)}
            onChange={(event) => {
              setEmail(event.target.value);
              setFieldError("email", null);
            }}
            placeholder="aluno@exemplo.com"
            type="email"
            value={email}
          />
        </AdminField>
        <AdminField error={errors.phone} id="aluno-telefone" label="Telefone" optional>
          <Input
            aria-describedby={fieldDescribedBy("aluno-telefone", { error: errors.phone })}
            aria-invalid={errors.phone ? true : undefined}
            autoComplete="off"
            className={adminInputClass}
            disabled={submitting}
            id="aluno-telefone"
            inputMode="tel"
            onBlur={() => setFieldError("phone", firstIssue(studentPhoneSchema.safeParse(phone)))}
            onChange={(event) => {
              setPhone(event.target.value);
              setFieldError("phone", null);
            }}
            placeholder="+55 11 99999-9999"
            type="tel"
            value={phone}
          />
        </AdminField>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className={sectionTitle}>Produtos a liberar</h2>
          <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">
            Pode deixar sem produto e liberar depois pelo perfil do aluno.
          </p>
        </div>
        <ProductPicker ariaLabel="Produtos a liberar" disabled={submitting} onChange={setProductIds} products={products} selected={productIds} />
        {errors.productIds ? <p className="text-[13px] text-[var(--error)]">{errors.productIds}</p> : null}
        {productIds.length > 0 ? (
          <AdminField hint="Vale para os produtos marcados acima." id="aluno-turma" label="Turma" optional>
            <CohortSelect
              cohorts={cohorts}
              disabled={submitting}
              id="aluno-turma"
              onChange={setCohortId}
              onCreated={(cohort) => setCohorts((current) => withCohort(current, cohort))}
              value={cohortId}
            />
          </AdminField>
        ) : null}
        <AdminField
          error={errors.endsAt}
          hint="Vale para os produtos marcados acima. Em branco, o acesso não vence."
          id="aluno-prazo"
          label="Acesso até"
          optional
        >
          <Input
            aria-describedby={fieldDescribedBy("aluno-prazo", { error: errors.endsAt, hint: true })}
            aria-invalid={errors.endsAt ? true : undefined}
            className={cn(adminInputClass, "max-w-[220px] [color-scheme:dark]")}
            disabled={submitting}
            id="aluno-prazo"
            min={today}
            onChange={(event) => {
              setEndsAt(event.target.value);
              setFieldError("endsAt", null);
            }}
            type="date"
            value={endsAt}
          />
        </AdminField>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className={sectionTitle}>Como entregar o acesso</h2>
        <PillGroup ariaLabel="Como entregar o acesso" disabled={submitting} name="aluno-entrega" onChange={setDelivery} options={deliveryOptions} value={delivery} />
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{DELIVERY_HINTS[delivery]}</p>
        {errors.delivery ? <p className="text-[13px] text-[var(--error)]">{errors.delivery}</p> : null}
        {delivery === "temporary_password" ? (
          <AdminField
            error={errors.temporaryPassword}
            hint={`Em branco, geramos uma senha segura. Se preferir a sua, use pelo menos ${TEMPORARY_PASSWORD_MIN_LENGTH} caracteres.`}
            id="aluno-senha"
            label="Senha temporária"
            optional
          >
            <Input
              aria-describedby={fieldDescribedBy("aluno-senha", { error: errors.temporaryPassword, hint: true })}
              aria-invalid={errors.temporaryPassword ? true : undefined}
              autoComplete="off"
              className={cn(adminInputClass, "max-w-[320px]")}
              disabled={submitting}
              id="aluno-senha"
              onChange={(event) => {
                setTemporaryPassword(event.target.value);
                setFieldError("temporaryPassword", null);
              }}
              type="text"
              value={temporaryPassword}
            />
          </AdminField>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-5">
        <Button className="px-4" disabled={submitting} type="submit">
          {submitting ? "Adicionando…" : productIds.length > 0 ? "Adicionar e liberar acesso" : "Adicionar aluno"}
        </Button>
        <AdminLinkButton href={studentListHref()} variant="ghost">
          Cancelar
        </AdminLinkButton>
      </div>
    </form>
  );
}
