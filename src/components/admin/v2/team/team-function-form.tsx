"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ADMIN_ROLE_LABELS, closeGrants, mergeGrants, type ActionScope, type AdminAction, type GrantMap } from "@/server/auth/roles";
import { createTeamFunction, deleteTeamFunction, updateTeamFunction } from "@/server/team/actions";
import { TEAM_PRESET_OPTIONS, presetSelection } from "@/server/team/model";
import { ErrorBanner } from "../error-banner";
import { AdminField, adminInputClass, fieldDescribedBy } from "../form";
import { AdminLinkButton } from "../link-button";
import { ProductDialog } from "../products/dialog-frame";
import { useWarnBeforeUnload } from "../products/use-warn-before-unload";
import { adminToast } from "../toast";
import { TEAM_FUNCTIONS_PATH } from "./hrefs";
import { PermissionChecklist } from "./permission-checklist";

// Funcao personalizada (docs/17 §2.3): nome, descricao e permissoes, montadas juntando funcoes prontas
// e marcando ou desmarcando o resto. Permissao por curso vale nos cursos escolhidos em cada pessoa.
// Mudar uma funcao muda todo mundo que a tem.

type FieldName = "actions" | "description" | "name";
type FieldErrors = Partial<Record<FieldName, string>>;

export type TeamFunctionFormValues = {
  actions: AdminAction[];
  description: string;
  id: string;
  memberCount: number;
  name: string;
  scopedActions: AdminAction[];
  updatedAt: string;
};

type TeamFunctionFormProps = {
  /** Ausente = nova funcao. */
  fn?: TeamFunctionFormValues;
  /** Nova funcao comecando de outra ("Duplicar e ajustar"). */
  initial?: { grants: [AdminAction, ActionScope][]; name: string };
};

const COURSES_LABEL = "Só nos cursos de cada pessoa";

function grantsOf(actions: readonly AdminAction[], scoped: readonly AdminAction[]): GrantMap {
  return new Map(actions.map((action) => [action, scoped.includes(action) ? "courses" : "school"]));
}

function snapshotOf(state: { description: string; grants: GrantMap; name: string }) {
  return JSON.stringify({ description: state.description.trim(), grants: [...state.grants].sort(([left], [right]) => left.localeCompare(right)), name: state.name.trim() });
}

export function TeamFunctionForm({ fn, initial }: TeamFunctionFormProps) {
  const router = useRouter();
  const editing = Boolean(fn);
  const [name, setName] = useState(fn?.name ?? initial?.name ?? "");
  const [description, setDescription] = useState(fn?.description ?? "");
  const [grants, setGrants] = useState<GrantMap>(() => (fn ? grantsOf(fn.actions, fn.scopedActions) : new Map(initial?.grants ?? [])));
  const [updatedAt, setUpdatedAt] = useState(fn?.updatedAt);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(() => (fn ? snapshotOf({ description: fn.description, grants: grantsOf(fn.actions, fn.scopedActions), name: fn.name }) : null));
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const current = snapshotOf({ description, grants, name });
  const dirty = editing ? saved !== current : Boolean(name.trim() || description.trim() || grants.size);

  useWarnBeforeUnload(dirty && !submitting);

  function clearError(field: FieldName) {
    setErrors((value) => {
      const next = { ...value };
      delete next[field];
      return next;
    });
  }

  function addPreset(preset: (typeof TEAM_PRESET_OPTIONS)[number]) {
    setGrants((value) => closeGrants(mergeGrants(new Map(value), presetSelection(preset))));
    clearError("actions");
    adminToast.success(`Permissões de ${ADMIN_ROLE_LABELS[preset]} somadas`);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();

    if (submitting) {
      return;
    }

    setSubmitting(true);
    setFormError(null);
    const actions = [...grants.keys()];
    const payload = { actions, description, name, scopedActions: actions.filter((action) => grants.get(action) === "courses") };
    const response = fn ? await updateTeamFunction({ ...payload, expectedUpdatedAt: updatedAt, id: fn.id }) : await createTeamFunction(payload);
    setSubmitting(false);

    if (!response.ok) {
      const fieldErrors: FieldErrors = {};

      for (const field of ["actions", "description", "name"] as const) {
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

    if (fn) {
      setUpdatedAt(response.data.updatedAt);
      setSaved(current);
      adminToast.success("Função salva");
      router.refresh();
      return;
    }

    setSaved(current);
    adminToast.success("Função criada");
    router.push(TEAM_FUNCTIONS_PATH);
    router.refresh();
  }

  async function remove() {
    if (!fn) {
      return;
    }

    setDeleting(true);
    setDeleteError(null);
    const response = await deleteTeamFunction({ id: fn.id });
    setDeleting(false);

    if (!response.ok) {
      setDeleteError(response.error);
      return;
    }

    setDeleteOpen(false);
    adminToast.success(`Função "${fn.name}" excluída`);
    router.push(TEAM_FUNCTIONS_PATH);
    router.refresh();
  }

  const sectionTitle = "text-[15px] leading-5 font-semibold text-[var(--text-primary)]";
  const anyScoped = [...grants.values()].includes("courses");

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

      {fn ? (
        <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 text-sm leading-5 text-[var(--text-secondary)]">
          {fn.memberCount === 0
            ? "Ninguém tem esta função ainda."
            : `${fn.memberCount === 1 ? "1 pessoa tem" : `${fn.memberCount} pessoas têm`} esta função. Mudar aqui muda para todas elas na hora.`}
        </p>
      ) : null}

      <section className="flex flex-col gap-4">
        <AdminField error={errors.name} id="funcao-nome" label="Nome">
          <Input
            aria-describedby={fieldDescribedBy("funcao-nome", { error: errors.name })}
            aria-invalid={errors.name ? true : undefined}
            autoComplete="off"
            autoFocus={!editing}
            className={adminInputClass}
            disabled={submitting}
            id="funcao-nome"
            onChange={(event) => {
              setName(event.target.value);
              clearError("name");
            }}
            placeholder="Professor com criação"
            value={name}
          />
        </AdminField>
        <AdminField error={errors.description} hint="Aparece no cartão da função, na hora de escolher." id="funcao-descricao" label="Descrição" optional>
          <Input
            aria-describedby={fieldDescribedBy("funcao-descricao", { error: errors.description, hint: true })}
            aria-invalid={errors.description ? true : undefined}
            autoComplete="off"
            className={adminInputClass}
            disabled={submitting}
            id="funcao-descricao"
            onChange={(event) => {
              setDescription(event.target.value);
              clearError("description");
            }}
            placeholder="Monta e cria os próprios cursos e responde os alunos deles."
            value={description}
          />
        </AdminField>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className={sectionTitle}>Juntar funções prontas</h2>
          <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">Soma as permissões de uma função pronta. Depois marque ou desmarque o que quiser.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {TEAM_PRESET_OPTIONS.map((preset) => (
            <Button className="gap-1.5 px-3" disabled={submitting} key={preset} onClick={() => addPreset(preset)} type="button" variant="secondary">
              <Plus aria-hidden="true" className="size-4" />
              {ADMIN_ROLE_LABELS[preset]}
            </Button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className={sectionTitle}>O que quem tiver esta função pode fazer</h2>
          <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">
            Algumas permissões podem valer só nos cursos de cada pessoa: os cursos são escolhidos na pessoa. Mudar a equipe e as chaves de venda ficam sempre com o dono.
          </p>
        </div>
        <PermissionChecklist
          coursesLabel={COURSES_LABEL}
          disabled={submitting}
          onChange={(next) => {
            setGrants(next);
            clearError("actions");
          }}
          selected={grants}
        />
        {errors.actions ? <p className="text-[13px] text-[var(--error)]">{errors.actions}</p> : null}
        {anyScoped ? (
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">Quem receber esta função precisa ter pelo menos um curso escolhido na tela da pessoa.</p>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-5">
        <Button className="px-4" disabled={submitting} type="submit">
          {submitting ? "Salvando…" : editing ? "Salvar" : "Criar função"}
        </Button>
        <AdminLinkButton href={TEAM_FUNCTIONS_PATH} variant="ghost">
          {editing ? "Voltar" : "Cancelar"}
        </AdminLinkButton>
        {fn ? (
          <Button className="ml-auto gap-1.5 px-3 text-[var(--error)]" disabled={submitting} onClick={() => setDeleteOpen(true)} type="button" variant="ghost">
            <Trash2 aria-hidden="true" className="size-4" />
            Excluir função
          </Button>
        ) : null}
      </div>

      {fn ? (
        <ProductDialog
          description={
            fn.memberCount > 0
              ? "Antes, troque a função das pessoas que a têm. Uma função só sai quando ninguém mais a usa."
              : "Ninguém tem esta função. Ela sai da lista de funções; o registro da equipe guarda que ela existiu."
          }
          footer={
            <>
              <Button className="px-4" disabled={deleting} onClick={() => setDeleteOpen(false)} type="button" variant="ghost">
                Cancelar
              </Button>
              <Button className="px-4" disabled={deleting || fn.memberCount > 0} onClick={() => void remove()} type="button" variant="destructive">
                {deleting ? "Excluindo…" : "Excluir"}
              </Button>
            </>
          }
          onOpenChange={(next) => {
            if (!deleting) {
              setDeleteOpen(next);
              setDeleteError(null);
            }
          }}
          open={deleteOpen}
          title={`Excluir a função "${fn.name}"?`}
        >
          {deleteError ? <ErrorBanner>{deleteError}</ErrorBanner> : null}
        </ProductDialog>
      ) : null}
    </form>
  );
}
