"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { deleteStudent, grantStudentAccess, sendStudentAccessEmail, updateStudentProfile } from "@/server/students/actions";
import { studentNameSchema, studentPhoneSchema } from "@/server/students/schemas";
import { ErrorBanner } from "../error-banner";
import { AdminField, adminInputClass, fieldDescribedBy } from "../form";
import { ProductDialog } from "../products/dialog-frame";
import { adminToast } from "../toast";
import { studentListHref } from "./hrefs";
import { ProductPicker, type PickerProduct } from "./product-picker";

// Dialogos do perfil do aluno (docs/17 §1.7.3): liberar acesso, enviar e-mail de acesso, editar
// dados e excluir. Erro fica em banner dentro do dialogo; sucesso vira toast e a pagina recarrega
// os dados (router.refresh) para a tabela refletir o banco, nunca um estado local inventado.

export type StudentSummary = {
  email: string;
  fullName: string;
  hasAccount: boolean;
  id: string;
  phone: string | null;
};

type DialogProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  student: StudentSummary;
};

function firstIssue(result: { error?: { issues: { message: string }[] } }) {
  return result.error?.issues[0]?.message ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * Liberar acesso
 * ---------------------------------------------------------------------------------------------- */

type GrantAccessDialogProps = DialogProps & {
  alreadyGranted: readonly string[];
  products: readonly PickerProduct[];
  /** Hoje ("AAAA-MM-DD"), calculado no servidor: minimo do campo de data. */
  today: string;
};

export function GrantAccessDialog({ alreadyGranted, onOpenChange, open, products, student, today }: GrantAccessDialogProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const granted = new Set(alreadyGranted);

  function handleOpenChange(next: boolean) {
    if (pending) {
      return;
    }

    if (!next) {
      setSelected([]);
      setEndsAt("");
      setError(null);
    }

    onOpenChange(next);
  }

  async function submit() {
    if (selected.length === 0) {
      setError("Marque pelo menos um produto.");
      return;
    }

    setPending(true);
    setError(null);
    const result = await grantStudentAccess({ endsAt: endsAt || null, productIds: selected, userId: student.id });
    setPending(false);

    if (!result.ok) {
      setError(result.fieldErrors?.productIds?.[0] ?? result.fieldErrors?.endsAt?.[0] ?? result.error);
      return;
    }

    adminToast.success(result.data.granted === 1 ? "Acesso liberado" : `${result.data.granted} acessos liberados`);
    handleOpenChange(false);
    router.refresh();
  }

  return (
    <ProductDialog
      className="max-w-[560px]"
      description={`Produtos que ${student.fullName} passa a ver na área de membros. Quem já tem acesso recebe o novo prazo.`}
      footer={
        <>
          <Button className="px-4" disabled={pending} onClick={() => handleOpenChange(false)} type="button" variant="ghost">
            Cancelar
          </Button>
          <Button className="px-4" disabled={pending} onClick={() => void submit()} type="button">
            {pending ? "Liberando…" : "Liberar acesso"}
          </Button>
        </>
      }
      onOpenChange={handleOpenChange}
      open={open}
      title="Liberar acesso"
    >
      <div className="flex flex-col gap-4">
        {error ? <ErrorBanner>{error}</ErrorBanner> : null}
        <ProductPicker alreadyGranted={granted} ariaLabel="Produtos a liberar" disabled={pending} onChange={setSelected} products={products} selected={selected} />
        <AdminField hint="Em branco, o acesso não vence." id="liberar-prazo" label="Acesso até" optional>
          <Input
            aria-describedby={fieldDescribedBy("liberar-prazo", { hint: true })}
            className={cn(adminInputClass, "max-w-[220px] [color-scheme:dark]")}
            disabled={pending}
            id="liberar-prazo"
            min={today}
            onChange={(event) => setEndsAt(event.target.value)}
            type="date"
            value={endsAt}
          />
        </AdminField>
      </div>
    </ProductDialog>
  );
}

/* ------------------------------------------------------------------------------------------------
 * E-mail de acesso (convite de novo / redefinir senha)
 * ---------------------------------------------------------------------------------------------- */

export function SendAccessEmailDialog({ onOpenChange, open, student }: DialogProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function handleOpenChange(next: boolean) {
    if (pending) {
      return;
    }

    if (!next) {
      setError(null);
    }

    onOpenChange(next);
  }

  async function submit() {
    setPending(true);
    setError(null);
    const result = await sendStudentAccessEmail({ userId: student.id });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    adminToast.success(`E-mail enviado para ${result.data.email}`);
    handleOpenChange(false);
    router.refresh();
  }

  return (
    <ProductDialog
      description={`${student.email} recebe um link para criar ou redefinir a senha. Serve como convite de novo e como “esqueci a senha”.`}
      footer={
        <>
          <Button className="px-4" disabled={pending} onClick={() => handleOpenChange(false)} type="button" variant="ghost">
            Cancelar
          </Button>
          <Button className="px-4" disabled={pending} onClick={() => void submit()} type="button">
            {pending ? "Enviando…" : "Enviar e-mail"}
          </Button>
        </>
      }
      onOpenChange={handleOpenChange}
      open={open}
      title="Enviar e-mail de acesso?"
    >
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
    </ProductDialog>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Editar dados
 * ---------------------------------------------------------------------------------------------- */

export function EditStudentDialog({ onOpenChange, open, student }: DialogProps) {
  const router = useRouter();
  const [fullName, setFullName] = useState(student.fullName);
  const [phone, setPhone] = useState(student.phone ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function handleOpenChange(next: boolean) {
    if (pending) {
      return;
    }

    if (next) {
      setFullName(student.fullName);
      setPhone(student.phone ?? "");
      setNameError(null);
      setPhoneError(null);
      setError(null);
    }

    onOpenChange(next);
  }

  async function submit() {
    const nameCheck = studentNameSchema.safeParse(fullName);
    const phoneCheck = studentPhoneSchema.safeParse(phone);

    if (!nameCheck.success || !phoneCheck.success) {
      setNameError(nameCheck.success ? null : firstIssue(nameCheck));
      setPhoneError(phoneCheck.success ? null : firstIssue(phoneCheck));
      return;
    }

    setPending(true);
    setError(null);
    const result = await updateStudentProfile({ fullName: nameCheck.data, phone: phoneCheck.data, userId: student.id });
    setPending(false);

    if (!result.ok) {
      setNameError(result.fieldErrors?.fullName?.[0] ?? null);
      setPhoneError(result.fieldErrors?.phone?.[0] ?? null);

      if (!result.fieldErrors) {
        setError(result.error);
      }

      return;
    }

    adminToast.success("Dados atualizados");
    handleOpenChange(false);
    router.refresh();
  }

  return (
    <ProductDialog
      description="O e-mail de login não muda por aqui."
      footer={
        <>
          <Button className="px-4" disabled={pending} onClick={() => handleOpenChange(false)} type="button" variant="ghost">
            Cancelar
          </Button>
          <Button className="px-4" disabled={pending} form="editar-aluno" type="submit">
            {pending ? "Salvando…" : "Salvar"}
          </Button>
        </>
      }
      onOpenChange={handleOpenChange}
      open={open}
      title="Editar dados do aluno"
    >
      <form
        className="flex flex-col gap-4"
        id="editar-aluno"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {error ? <ErrorBanner>{error}</ErrorBanner> : null}
        <AdminField error={nameError} id="editar-aluno-nome" label="Nome">
          <Input
            aria-describedby={fieldDescribedBy("editar-aluno-nome", { error: nameError })}
            aria-invalid={nameError ? true : undefined}
            autoComplete="off"
            className={adminInputClass}
            disabled={pending}
            id="editar-aluno-nome"
            onChange={(event) => {
              setFullName(event.target.value);
              setNameError(null);
            }}
            value={fullName}
          />
        </AdminField>
        <AdminField error={phoneError} id="editar-aluno-telefone" label="Telefone" optional>
          <Input
            aria-describedby={fieldDescribedBy("editar-aluno-telefone", { error: phoneError })}
            aria-invalid={phoneError ? true : undefined}
            autoComplete="off"
            className={adminInputClass}
            disabled={pending}
            id="editar-aluno-telefone"
            inputMode="tel"
            onChange={(event) => {
              setPhone(event.target.value);
              setPhoneError(null);
            }}
            type="tel"
            value={phone}
          />
        </AdminField>
      </form>
    </ProductDialog>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Excluir aluno
 * ---------------------------------------------------------------------------------------------- */

export function DeleteStudentDialog({ onOpenChange, open, student }: DialogProps) {
  const router = useRouter();
  const [confirmEmail, setConfirmEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fieldId = "excluir-aluno-email";

  function handleOpenChange(next: boolean) {
    if (pending) {
      return;
    }

    if (!next) {
      setConfirmEmail("");
      setFieldError(null);
      setError(null);
    }

    onOpenChange(next);
  }

  async function submit() {
    if (confirmEmail.trim().toLowerCase() !== student.email) {
      setFieldError(`Digite ${student.email} para confirmar.`);
      return;
    }

    setPending(true);
    setError(null);
    const result = await deleteStudent({ confirmEmail: confirmEmail.trim(), userId: student.id });
    setPending(false);

    if (!result.ok) {
      if (result.fieldErrors?.confirmEmail?.[0]) {
        setFieldError(result.fieldErrors.confirmEmail[0]);
      } else {
        setError(result.error);
      }

      return;
    }

    adminToast.success("Aluno excluído");
    onOpenChange(false);
    router.push(studentListHref());
    router.refresh();
  }

  return (
    <ProductDialog
      description="A conta, os acessos, o progresso, o histórico e a foto são apagados. Comentários ficam sem autor. Isto não pode ser desfeito. Para só tirar o acesso, revogue na aba Acessos."
      footer={
        <>
          <Button className="px-4" disabled={pending} onClick={() => handleOpenChange(false)} type="button" variant="ghost">
            Manter
          </Button>
          <Button className="px-4" disabled={pending} onClick={() => void submit()} type="button" variant="destructive">
            {pending ? "Excluindo…" : "Excluir aluno"}
          </Button>
        </>
      }
      onOpenChange={handleOpenChange}
      open={open}
      title={`Excluir ${student.fullName}?`}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {error ? <ErrorBanner>{error}</ErrorBanner> : null}
        <AdminField error={fieldError} id={fieldId} label={<>Digite <strong className="font-semibold">{student.email}</strong> para confirmar</>}>
          <Input
            aria-describedby={fieldDescribedBy(fieldId, { error: fieldError })}
            aria-invalid={fieldError ? true : undefined}
            autoComplete="off"
            className={adminInputClass}
            disabled={pending}
            id={fieldId}
            inputMode="email"
            onChange={(event) => {
              setConfirmEmail(event.target.value);
              setFieldError(null);
            }}
            value={confirmEmail}
          />
        </AdminField>
      </form>
    </ProductDialog>
  );
}
