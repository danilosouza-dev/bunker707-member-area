"use client";

import { Bookmark, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteStudentSegment, saveStudentSegment } from "@/server/students/actions";
import type { StudentListParams } from "@/server/students/model";
import { segmentNameSchema } from "@/server/students/schemas";
import { ErrorBanner } from "../error-banner";
import { AdminField, adminInputClass, fieldDescribedBy } from "../form";
import { ProductDialog } from "../products/dialog-frame";
import { adminToast } from "../toast";

// "Salvar como segmento" (quando ha filtro) e excluir um segmento salvo.

export function SaveSegmentButton({ params }: { params: StudentListParams }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    const check = segmentNameSchema.safeParse(name);

    if (!check.success) {
      setFieldError(check.error.issues[0]?.message ?? null);
      return;
    }

    setPending(true);
    setError(null);
    const result = await saveStudentSegment({ name: check.data, params });
    setPending(false);

    if (!result.ok) {
      if (result.fieldErrors?.name?.[0]) {
        setFieldError(result.fieldErrors.name[0]);
      } else {
        setError(result.error);
      }

      return;
    }

    adminToast.success(`Segmento “${result.data.name}” salvo`);
    setOpen(false);
    setName("");
    router.refresh();
  }

  return (
    <>
      <Button className="gap-1.5 px-3" onClick={() => setOpen(true)} type="button" variant="ghost">
        <Bookmark aria-hidden="true" className="size-4" />
        Salvar como segmento
      </Button>
      <ProductDialog
        description="Os filtros atuais ficam guardados com este nome, para toda a equipe."
        footer={
          <>
            <Button className="px-4" disabled={pending} onClick={() => setOpen(false)} type="button" variant="ghost">
              Cancelar
            </Button>
            <Button className="px-4" disabled={pending} form="salvar-segmento" type="submit">
              {pending ? "Salvando…" : "Salvar segmento"}
            </Button>
          </>
        }
        onOpenChange={(next) => {
          if (!pending) {
            setOpen(next);
          }
        }}
        open={open}
        title="Salvar como segmento"
      >
        <form
          className="flex flex-col gap-3"
          id="salvar-segmento"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {error ? <ErrorBanner>{error}</ErrorBanner> : null}
          <AdminField error={fieldError} id="segmento-nome" label="Nome">
            <Input
              aria-describedby={fieldDescribedBy("segmento-nome", { error: fieldError })}
              aria-invalid={fieldError ? true : undefined}
              autoComplete="off"
              autoFocus
              className={adminInputClass}
              disabled={pending}
              id="segmento-nome"
              onChange={(event) => {
                setName(event.target.value);
                setFieldError(null);
              }}
              placeholder="Ex.: Em risco no Bootcamp"
              value={name}
            />
          </AdminField>
        </form>
      </ProductDialog>
    </>
  );
}

export function DeleteSegmentButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function remove() {
    setPending(true);
    setError(null);
    const result = await deleteStudentSegment({ id });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    adminToast.success("Segmento excluído");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        aria-label={`Excluir segmento ${name}`}
        className="grid size-8 shrink-0 place-items-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--error)]"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Trash2 aria-hidden="true" className="size-4" />
      </button>
      <ProductDialog
        description="Só o atalho some; nenhum aluno é afetado."
        footer={
          <>
            <Button className="px-4" disabled={pending} onClick={() => setOpen(false)} type="button" variant="ghost">
              Manter
            </Button>
            <Button className="px-4" disabled={pending} onClick={() => void remove()} type="button" variant="destructive">
              {pending ? "Excluindo…" : "Excluir segmento"}
            </Button>
          </>
        }
        onOpenChange={(next) => {
          if (!pending) {
            setOpen(next);
          }
        }}
        open={open}
        title={`Excluir o segmento “${name}”?`}
      >
        {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      </ProductDialog>
    </>
  );
}
