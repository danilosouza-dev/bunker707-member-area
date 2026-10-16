"use client";

import { Mail, UserMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { removeTeamMember, resendTeamInvite } from "@/server/team/actions";
import { ErrorBanner } from "../error-banner";
import { ProductDialog } from "../products/dialog-frame";
import { adminToast } from "../toast";
import { TEAM_PATH } from "./hrefs";

// Acoes de uma pessoa da equipe: reenviar o e-mail de acesso (quem nunca entrou) e tirar da equipe.
// Tirar da equipe nao apaga a conta: ela vira uma conta comum (de aluno) e perde o admin na hora.

export function ResendTeamInviteButton({ userId }: { userId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setPending(true);
    setError(null);
    const result = await resendTeamInvite({ userId });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    adminToast.success("E-mail de acesso enviado");
  }

  return (
    <div className="flex flex-col gap-2">
      <Button className="w-fit gap-1.5 px-3" disabled={pending} onClick={() => void resend()} type="button" variant="secondary">
        <Mail aria-hidden="true" className="size-4" />
        {pending ? "Enviando…" : "Reenviar convite"}
      </Button>
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
    </div>
  );
}

export function RemoveTeamMemberButton({ name, userId }: { name: string; userId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    const result = await removeTeamMember({ userId });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setOpen(false);
    adminToast.success(`${name} saiu da equipe`);
    router.push(TEAM_PATH);
    router.refresh();
  }

  return (
    <>
      <Button className="w-fit gap-1.5 px-3 text-[var(--error)]" onClick={() => setOpen(true)} type="button" variant="ghost">
        <UserMinus aria-hidden="true" className="size-4" />
        Tirar da equipe
      </Button>
      <ProductDialog
        description="A pessoa perde o acesso ao admin na hora. A conta continua: se ela comprou cursos, segue assistindo como aluno."
        footer={
          <>
            <Button className="px-4" disabled={pending} onClick={() => setOpen(false)} type="button" variant="ghost">
              Cancelar
            </Button>
            <Button className="px-4" disabled={pending} onClick={() => void remove()} type="button" variant="destructive">
              {pending ? "Tirando…" : "Tirar da equipe"}
            </Button>
          </>
        }
        onOpenChange={(next) => {
          if (!pending) {
            setOpen(next);
            setError(null);
          }
        }}
        open={open}
        title={`Tirar ${name} da equipe?`}
      >
        {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      </ProductDialog>
    </>
  );
}
