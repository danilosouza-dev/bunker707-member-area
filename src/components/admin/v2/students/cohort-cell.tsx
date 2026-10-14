"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { setStudentCohort } from "@/server/students/actions";
import type { StudentCohort } from "@/server/students/model";
import { ErrorBanner } from "../error-banner";
import { AdminField } from "../form";
import { ProductDialog } from "../products/dialog-frame";
import { adminToast } from "../toast";
import { CohortSelect, withCohort } from "./cohort-select";

// Celula "Turma" na aba Acessos do perfil: mostra a turma e abre "Mudar turma…" (so para acesso aberto).

type CohortCellProps = {
  canEdit: boolean;
  cohort: StudentCohort | null;
  cohorts: readonly StudentCohort[];
  productId: string;
  productTitle: string;
  userId: string;
};

export function CohortCell({ canEdit, cohort, cohorts: initialCohorts, productId, productTitle, userId }: CohortCellProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string | null>(cohort?.id ?? null);
  const [cohorts, setCohorts] = useState(initialCohorts);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    setError(null);
    const result = await setStudentCohort({ cohortId: value, productId, userId });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    adminToast.success(value ? "Turma alterada" : "Aluno tirado da turma");
    setOpen(false);
    router.refresh();
  }

  if (!canEdit) {
    return <span className={cohort ? undefined : "text-[var(--text-tertiary)]"}>{cohort?.name ?? "—"}</span>;
  }

  return (
    <>
      <button
        className="max-w-full truncate rounded px-1 text-left hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]"
        onClick={() => {
          setValue(cohort?.id ?? null);
          setOpen(true);
        }}
        title="Mudar turma"
        type="button"
      >
        {cohort?.name ?? <span className="text-[var(--text-tertiary)]">Sem turma</span>}
      </button>
      <ProductDialog
        description={`Turma do aluno em ${productTitle}.`}
        footer={
          <>
            <Button className="px-4" disabled={pending} onClick={() => setOpen(false)} type="button" variant="ghost">
              Cancelar
            </Button>
            <Button className="px-4" disabled={pending} onClick={() => void save()} type="button">
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </>
        }
        onOpenChange={(next) => {
          if (!pending) {
            setOpen(next);
          }
        }}
        open={open}
        title="Mudar turma"
      >
        <div className="flex flex-col gap-3">
          {error ? <ErrorBanner>{error}</ErrorBanner> : null}
          <AdminField id={`turma-${productId}`} label="Turma">
            <CohortSelect
              cohorts={cohorts}
              disabled={pending}
              id={`turma-${productId}`}
              onChange={setValue}
              onCreated={(created) => setCohorts((current) => withCohort(current, created))}
              value={value}
            />
          </AdminField>
        </div>
      </ProductDialog>
    </>
  );
}
