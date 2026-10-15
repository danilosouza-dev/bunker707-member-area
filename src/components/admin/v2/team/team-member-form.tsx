"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ADMIN_ROLE_LABELS, type AdminAction, type AdminRole } from "@/server/auth/roles";
import { addTeamMember, updateTeamMember, type TeamMemberAdded } from "@/server/team/actions";
import { actionsOfRole } from "@/server/team/model";
import { teamEmailSchema } from "@/server/team/schemas";
import { ErrorBanner } from "../error-banner";
import { AdminField, adminInputClass, fieldDescribedBy } from "../form";
import { AdminLinkButton } from "../link-button";
import { useWarnBeforeUnload } from "../products/use-warn-before-unload";
import { ProductPicker, type PickerProduct } from "../students/product-picker";
import { adminToast } from "../toast";
import { TEAM_PATH, teamMemberHref } from "./hrefs";
import { PermissionChecklist, PermissionSummary } from "./permission-checklist";
import { RoleCards } from "./role-cards";

// Formulario de Equipe (docs/17 §2.3): quem e (so ao adicionar), a funcao e, conforme a funcao, os
// cursos (Professor) ou as permissoes (Personalizado). As funcoes prontas mostram o que a pessoa pode
// fazer. O servidor confere tudo de novo (so o dono, nunca a propria funcao, sempre um dono).

type FieldName = "actions" | "email" | "fullName" | "productIds" | "role";
type FieldErrors = Partial<Record<FieldName, string>>;

export type TeamMemberFormValues = {
  actions: AdminAction[];
  productIds: string[];
  role: AdminRole;
  updatedAt: string;
  userId: string;
};

type TeamMemberFormProps = {
  courses: readonly PickerProduct[];
  /** Ausente = adicionar pessoa. */
  member?: TeamMemberFormValues;
};

const OWNER_EXTRA = ["Mudar a equipe", "Chaves das plataformas de venda"];

function firstIssue(result: { error?: { issues: { message: string }[] } }) {
  return result.error?.issues[0]?.message ?? null;
}

function sameList(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && [...left].sort().join("|") === [...right].sort().join("|");
}

function AddedPanel({ email, onAddAnother, result, role }: { email: string; onAddAnother: () => void; result: TeamMemberAdded; role: AdminRole }) {
  const message = result.emailFailed
    ? "O e-mail para criar a senha não saiu agora. Abra a pessoa e use “Reenviar convite” daqui a pouco."
    : result.emailSent
      ? "Ela recebe um e-mail para criar a senha. Depois de entrar, o admin aparece com o que essa função permite."
      : "Ela já tinha conta: entra com o e-mail e a senha de sempre, e o admin aparece com o que essa função permite.";

  return (
    <div className="flex w-full max-w-[640px] flex-col gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-5">
      <div>
        <h2 className="text-[15px] leading-5 font-semibold text-[var(--text-primary)]">Pessoa adicionada à equipe</h2>
        <p className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">
          <span className="text-[var(--text-primary)]">{email}</span> agora é {ADMIN_ROLE_LABELS[role]}. {message}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <AdminLinkButton href={teamMemberHref(result.userId)} variant="secondary">
          Ver a pessoa
        </AdminLinkButton>
        <Button className="px-4" onClick={onAddAnother} type="button" variant="ghost">
          Adicionar outra pessoa
        </Button>
        <AdminLinkButton href={TEAM_PATH} variant="ghost">
          Voltar para a equipe
        </AdminLinkButton>
      </div>
    </div>
  );
}

export function TeamMemberForm({ courses, member }: TeamMemberFormProps) {
  const router = useRouter();
  const editing = Boolean(member);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<AdminRole>(member?.role ?? "instructor");
  const [actions, setActions] = useState<AdminAction[]>(member?.role === "custom" ? member.actions : []);
  const [productIds, setProductIds] = useState<string[]>(member?.productIds ?? []);
  const [updatedAt, setUpdatedAt] = useState(member?.updatedAt);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [added, setAdded] = useState<{ email: string; result: TeamMemberAdded; role: AdminRole } | null>(null);
  const [saved, setSaved] = useState(member ? { actions: member.actions, productIds: member.productIds, role: member.role } : null);

  const dirty = editing
    ? Boolean(saved && (saved.role !== role || !sameList(saved.productIds, productIds) || !sameList(saved.actions, actions)))
    : !added && Boolean(email.trim() || fullName.trim());

  useWarnBeforeUnload(dirty);

  function clearError(field: FieldName) {
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function chooseRole(next: AdminRole) {
    // Personalizado comeca com o que a funcao anterior podia (o dono so ajusta).
    if (next === "custom" && role !== "custom" && actions.length === 0) {
      setActions(actionsOfRole(role));
    }

    setRole(next);
    clearError("role");
    clearError("actions");
    clearError("productIds");
  }

  function reset() {
    setEmail("");
    setFullName("");
    setRole("instructor");
    setActions([]);
    setProductIds([]);
    setErrors({});
    setFormError(null);
    setAdded(null);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();

    if (submitting) {
      return;
    }

    if (!editing) {
      const emailCheck = teamEmailSchema.safeParse(email);

      if (!emailCheck.success) {
        setErrors({ email: firstIssue(emailCheck) ?? "E-mail inválido." });
        document.getElementById("equipe-email")?.focus();
        return;
      }
    }

    setSubmitting(true);
    setFormError(null);
    const payload = { actions: role === "custom" ? actions : [], productIds: role === "instructor" ? productIds : [], role };
    const response = member
      ? await updateTeamMember({ ...payload, expectedUpdatedAt: updatedAt, userId: member.userId })
      : await addTeamMember({ ...payload, email, fullName });
    setSubmitting(false);

    if (!response.ok) {
      const fieldErrors: FieldErrors = {};

      for (const field of ["actions", "email", "fullName", "productIds", "role"] as const) {
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

    if (member) {
      setUpdatedAt((response.data as { updatedAt: string }).updatedAt);
      setSaved({ actions: payload.actions, productIds: payload.productIds, role });
      adminToast.success("Função atualizada");
      router.refresh();
      return;
    }

    setAdded({ email: email.trim().toLowerCase(), result: response.data as TeamMemberAdded, role });
    router.refresh();
  }

  if (added) {
    return <AddedPanel email={added.email} onAddAnother={reset} result={added.result} role={added.role} />;
  }

  const sectionTitle = "text-[15px] leading-5 font-semibold text-[var(--text-primary)]";
  const becomingOwner = role === "owner" && member?.role !== "owner";

  return (
    <form
      className="flex w-full max-w-[720px] flex-col gap-8"
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

      {editing ? null : (
        <section className="flex flex-col gap-4">
          <h2 className={sectionTitle}>Quem é</h2>
          <AdminField
            error={errors.email}
            hint="Se a pessoa já tem conta (de aluno, por exemplo), ela só ganha a função. Se não tem, recebe um e-mail para criar a senha."
            id="equipe-email"
            label="E-mail"
          >
            <Input
              aria-describedby={fieldDescribedBy("equipe-email", { error: errors.email, hint: true })}
              aria-invalid={errors.email ? true : undefined}
              autoComplete="off"
              autoFocus
              className={adminInputClass}
              disabled={submitting}
              id="equipe-email"
              inputMode="email"
              onChange={(event) => {
                setEmail(event.target.value);
                clearError("email");
              }}
              placeholder="pessoa@exemplo.com"
              type="email"
              value={email}
            />
          </AdminField>
          <AdminField error={errors.fullName} hint="Usado só se a conta for nova." id="equipe-nome" label="Nome" optional>
            <Input
              aria-describedby={fieldDescribedBy("equipe-nome", { error: errors.fullName, hint: true })}
              aria-invalid={errors.fullName ? true : undefined}
              autoComplete="off"
              className={adminInputClass}
              disabled={submitting}
              id="equipe-nome"
              onChange={(event) => {
                setFullName(event.target.value);
                clearError("fullName");
              }}
              placeholder="Nome completo"
              value={fullName}
            />
          </AdminField>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <div>
          <h2 className={sectionTitle}>Função</h2>
          <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">
            Cada pessoa tem uma função. Ela só vê no admin as áreas que a função permite.
          </p>
        </div>
        <RoleCards disabled={submitting} name="equipe-funcao" onChange={chooseRole} value={role} />
        {errors.role ? <p className="text-[13px] text-[var(--error)]">{errors.role}</p> : null}
        {becomingOwner ? (
          <p className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2.5 text-[13px] leading-5 text-[var(--warning)]">
            Dono pode tudo, inclusive mudar a equipe e tirar outras pessoas, você também. Dê só para sócios de confiança.
          </p>
        ) : null}
      </section>

      {role === "instructor" ? (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className={sectionTitle}>Cursos do professor</h2>
            <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">
              Ele monta módulos e aulas e responde a comunidade só destes cursos. Não cria produto, não mexe em preço nem em quem pode ver.
            </p>
          </div>
          <ProductPicker
            ariaLabel="Cursos do professor"
            disabled={submitting}
            onChange={(next) => {
              setProductIds(next);
              clearError("productIds");
            }}
            products={courses}
            selected={productIds}
          />
          {errors.productIds ? <p className="text-[13px] text-[var(--error)]">{errors.productIds}</p> : null}
        </section>
      ) : role === "custom" ? (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className={sectionTitle}>O que a pessoa pode fazer</h2>
            <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">
              Marque só o necessário. Mudar a equipe e as chaves de venda ficam sempre com o dono.
            </p>
          </div>
          <PermissionChecklist
            disabled={submitting}
            onChange={(next) => {
              setActions(next);
              clearError("actions");
            }}
            selected={actions}
          />
          {errors.actions ? <p className="text-[13px] text-[var(--error)]">{errors.actions}</p> : null}
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          <h2 className={sectionTitle}>O que a função {ADMIN_ROLE_LABELS[role]} permite</h2>
          <PermissionSummary actions={actionsOfRole(role)} extra={role === "owner" ? OWNER_EXTRA : []} />
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-5">
        <Button className="px-4" disabled={submitting} type="submit">
          {submitting ? "Salvando…" : editing ? "Salvar função" : "Adicionar à equipe"}
        </Button>
        <AdminLinkButton href={TEAM_PATH} variant="ghost">
          {editing ? "Voltar" : "Cancelar"}
        </AdminLinkButton>
      </div>
    </form>
  );
}
