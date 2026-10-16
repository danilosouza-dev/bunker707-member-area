"use client";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AdminAction, GrantMap } from "@/server/auth/roles";
import { addTeamMember, updateTeamMember, type TeamMemberAdded } from "@/server/team/actions";
import {
  functionDefinitions,
  functionGrantSources,
  functionGrantsOf,
  memberGrantsOf,
  needsCourses,
  withoutRedundantExtras,
  type TeamCustomFunction
} from "@/server/team/model";
import { teamEmailSchema } from "@/server/team/schemas";
import { ErrorBanner } from "../error-banner";
import { AdminField, adminInputClass, fieldDescribedBy } from "../form";
import { AdminLinkButton } from "../link-button";
import { useWarnBeforeUnload } from "../products/use-warn-before-unload";
import { ProductPicker, type PickerProduct } from "../students/product-picker";
import { adminTransition } from "../styles";
import { adminToast } from "../toast";
import { FunctionCards } from "./function-cards";
import { TEAM_PATH, teamMemberHref } from "./hrefs";
import { PermissionChecklist, PermissionSummary } from "./permission-checklist";

// Formulario de Equipe (docs/17 §2.3): quem e (so ao adicionar), as funcoes (uma ou mais, prontas ou
// personalizadas, ou Dono), os cursos quando alguma permissao vale so nos cursos, permissoes extras
// so desta pessoa e o resumo do que ela pode fazer. Extra que as funcoes ja dao igual nao conta nem e
// gravado (volta a aparecer se a funcao sair antes de salvar). O servidor confere tudo de novo (so o
// dono, nunca a propria funcao, sempre um dono).

type FieldName = "email" | "extraActions" | "fullName" | "functions" | "productIds";
type FieldErrors = Partial<Record<FieldName, string>>;

export type TeamMemberFormValues = {
  extraActions: AdminAction[];
  extraScopedActions: AdminAction[];
  functions: string[];
  owner: boolean;
  productIds: string[];
  updatedAt: string;
  userId: string;
};

type TeamMemberFormProps = {
  courses: readonly PickerProduct[];
  customFunctions: readonly TeamCustomFunction[];
  /** Ausente = adicionar pessoa. */
  member?: TeamMemberFormValues;
};

const OWNER_EXTRA = ["Mudar a equipe", "Chaves das plataformas de venda"];
const COURSES_LABEL = "Só nos cursos dela";

function firstIssue(result: { error?: { issues: { message: string }[] } }) {
  return result.error?.issues[0]?.message ?? null;
}

function extrasFrom(actions: readonly AdminAction[], scoped: readonly AdminAction[]): GrantMap {
  return new Map(actions.map((action) => [action, scoped.includes(action) ? "courses" : "school"]));
}

/** Retrato do que esta no formulario, para saber se mudou algo desde a ultima gravacao. */
function snapshotOf(state: { extras: GrantMap; functions: readonly string[]; owner: boolean; productIds: readonly string[] }) {
  return JSON.stringify({
    extras: [...state.extras].sort(([left], [right]) => left.localeCompare(right)),
    functions: [...state.functions].sort(),
    owner: state.owner,
    productIds: [...state.productIds].sort()
  });
}

function AddedPanel({ email, onAddAnother, result }: { email: string; onAddAnother: () => void; result: TeamMemberAdded }) {
  const message = result.emailFailed
    ? "O e-mail para criar a senha não saiu agora. Abra a pessoa e use “Reenviar convite” daqui a pouco."
    : result.emailSent
      ? "Ela recebe um e-mail para criar a senha. Depois de entrar, o admin aparece com o que as funções permitem."
      : "Ela já tinha conta: entra com o e-mail e a senha de sempre, e o admin aparece com o que as funções permitem.";

  return (
    <div className="flex w-full max-w-[720px] flex-col gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-5">
      <div>
        <h2 className="text-[15px] leading-5 font-semibold text-[var(--text-primary)]">Pessoa adicionada à equipe</h2>
        <p className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">
          <span className="text-[var(--text-primary)]">{email}</span> agora faz parte da equipe. {message}
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

export function TeamMemberForm({ courses, customFunctions, member }: TeamMemberFormProps) {
  const router = useRouter();
  const editing = Boolean(member);
  const definitions = useMemo(() => functionDefinitions(customFunctions), [customFunctions]);
  const names = useMemo(() => new Map(customFunctions.map((fn) => [fn.id, fn])), [customFunctions]);
  const [initialExtras] = useState<GrantMap>(() =>
    member
      ? withoutRedundantExtras(extrasFrom(member.extraActions, member.extraScopedActions), functionGrantsOf(member.functions, definitions))
      : new Map()
  );
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [owner, setOwner] = useState(member?.owner ?? false);
  const [functions, setFunctions] = useState<string[]>(member?.functions ?? []);
  const [extras, setExtras] = useState<GrantMap>(initialExtras);
  const [extrasOpen, setExtrasOpen] = useState(initialExtras.size > 0);
  const [productIds, setProductIds] = useState<string[]>(member?.productIds ?? []);
  const [updatedAt, setUpdatedAt] = useState(member?.updatedAt);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [added, setAdded] = useState<{ email: string; result: TeamMemberAdded } | null>(null);
  const [saved, setSaved] = useState(() =>
    member ? snapshotOf({ extras: initialExtras, functions: member.functions, owner: member.owner, productIds: member.productIds }) : null
  );

  const locked = useMemo(() => functionGrantSources(functions, definitions, names), [definitions, functions, names]);
  // O que a tela mostra como extra (e o que se grava): sem o que as funcoes marcadas ja dao igual.
  const visibleExtras = useMemo(() => withoutRedundantExtras(extras, functionGrantsOf(functions, definitions)), [definitions, extras, functions]);
  const extraActions = [...visibleExtras.keys()];
  const extraScopedActions = extraActions.filter((action) => visibleExtras.get(action) === "courses");
  const effective = memberGrantsOf({ extraActions, extraScopedActions, functions, owner }, definitions);
  const coursesNeeded = !owner && needsCourses(effective);
  const current = snapshotOf({ extras: visibleExtras, functions, owner, productIds });
  const dirty = editing ? saved !== current : !added && Boolean(email.trim() || fullName.trim() || functions.length || owner || visibleExtras.size);

  useWarnBeforeUnload(dirty);

  function clearError(field: FieldName) {
    setErrors((value) => {
      const next = { ...value };
      delete next[field];
      return next;
    });
  }

  function reset() {
    setEmail("");
    setFullName("");
    setOwner(false);
    setFunctions([]);
    setExtras(new Map());
    setExtrasOpen(false);
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
    const payload = {
      extraActions: owner ? [] : extraActions,
      extraScopedActions: owner ? [] : extraScopedActions,
      functions: owner ? [] : functions,
      owner,
      productIds: coursesNeeded ? productIds : []
    };
    const response = member
      ? await updateTeamMember({ ...payload, expectedUpdatedAt: updatedAt, userId: member.userId })
      : await addTeamMember({ ...payload, email, fullName });
    setSubmitting(false);

    if (!response.ok) {
      const fieldErrors: FieldErrors = {};

      for (const field of ["email", "extraActions", "fullName", "functions", "productIds"] as const) {
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
      setSaved(current);
      adminToast.success("Funções atualizadas");
      router.refresh();
      return;
    }

    setAdded({ email: email.trim().toLowerCase(), result: response.data as TeamMemberAdded });
    router.refresh();
  }

  if (added) {
    return <AddedPanel email={added.email} onAddAnother={reset} result={added.result} />;
  }

  const sectionTitle = "text-[15px] leading-5 font-semibold text-[var(--text-primary)]";
  const becomingOwner = owner && !member?.owner;

  return (
    <form
      className="flex w-full max-w-[760px] flex-col gap-8"
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
            hint="Se a pessoa já tem conta (de aluno, por exemplo), ela só ganha as funções. Se não tem, recebe um e-mail para criar a senha."
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
          <h2 className={sectionTitle}>Funções</h2>
          <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">
            Marque uma ou mais. As permissões se somam: se uma função vale para a escola toda e outra só nos cursos da pessoa, vale a escola toda.
          </p>
        </div>
        <FunctionCards
          customFunctions={customFunctions}
          disabled={submitting}
          onChange={(next) => {
            setOwner(next.owner);
            setFunctions(next.functions);
            clearError("functions");
          }}
          value={{ functions, owner }}
        />
        {errors.functions ? <p className="text-[13px] text-[var(--error)]">{errors.functions}</p> : null}
        {becomingOwner ? (
          <p className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2.5 text-[13px] leading-5 text-[var(--warning)]">
            Dono pode tudo, inclusive mudar a equipe e tirar outras pessoas, você também. Dê só para sócios de confiança.
          </p>
        ) : null}
      </section>

      {owner ? null : (
        <section className="flex flex-col gap-3">
          <button
            aria-controls="equipe-extras"
            aria-expanded={extrasOpen}
            className={cn("flex w-fit items-center gap-2 rounded-lg text-left", adminTransition)}
            onClick={() => setExtrasOpen((value) => !value)}
            type="button"
          >
            <span className={sectionTitle}>Permissões extras só desta pessoa</span>
            {visibleExtras.size > 0 ? (
              <span className="inline-grid h-5 min-w-5 place-items-center rounded-full border border-[var(--border-strong)] px-1.5 text-xs font-semibold text-[var(--text-primary)] tabular-nums">
                {visibleExtras.size}
              </span>
            ) : null}
            <ChevronDown aria-hidden="true" className={cn("size-4 text-[var(--text-tertiary)] transition-transform", extrasOpen && "rotate-180")} />
          </button>
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
            Para dar algo a mais sem criar uma função, como &quot;Criar cursos&quot; para um professor. O que já vem das funções aparece travado.
          </p>
          {extrasOpen ? (
            <div id="equipe-extras">
              <PermissionChecklist
                coursesLabel={COURSES_LABEL}
                disabled={submitting}
                locked={locked}
                onChange={(next) => {
                  setExtras(next);
                  clearError("extraActions");
                }}
                selected={visibleExtras}
              />
              {errors.extraActions ? <p className="mt-2 text-[13px] text-[var(--error)]">{errors.extraActions}</p> : null}
            </div>
          ) : null}
        </section>
      )}

      {coursesNeeded ? (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className={sectionTitle}>Cursos da pessoa</h2>
            <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">
              As permissões marcadas como &quot;só nos cursos dela&quot; valem só nestes. Curso que ela criar entra aqui sozinho.
            </p>
          </div>
          <ProductPicker
            ariaLabel="Cursos da pessoa"
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
      ) : null}

      <section className="flex flex-col gap-4">
        <h2 className={sectionTitle}>O que esta pessoa pode fazer</h2>
        <PermissionSummary coursesLabel={COURSES_LABEL} extra={owner ? OWNER_EXTRA : []} grants={effective} />
      </section>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-5">
        <Button className="px-4" disabled={submitting} type="submit">
          {submitting ? "Salvando…" : editing ? "Salvar" : "Adicionar à equipe"}
        </Button>
        <AdminLinkButton href={TEAM_PATH} variant="ghost">
          {editing ? "Voltar" : "Cancelar"}
        </AdminLinkButton>
      </div>
    </form>
  );
}
