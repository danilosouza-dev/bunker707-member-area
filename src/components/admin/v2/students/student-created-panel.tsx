"use client";

import { CircleCheck, Mail, KeyRound, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { temporaryPasswordMessage, type CreatedStudentResult } from "@/server/students/model";
import { AdminLinkButton } from "../link-button";
import { adminCard } from "../styles";
import { CopyButton } from "./copy-button";
import { studentHref, studentListHref } from "./hrefs";

// Confirmacao depois de Adicionar aluno (docs/17 §1.7.2): o que aconteceu e o proximo passo.
// Senha temporaria aparece UMA vez, aqui; nao fica gravada em lugar nenhum.

type StudentCreatedPanelProps = {
  onAddAnother: () => void;
  productCount: number;
  result: CreatedStudentResult;
};

function headline(result: CreatedStudentResult) {
  if (result.delivery === "invite") {
    return { Icon: Mail, title: `Convite enviado para ${result.email}` };
  }

  if (result.delivery === "temporary_password") {
    return { Icon: KeyRound, title: "Senha temporária criada" };
  }

  return { Icon: UserRoundCheck, title: result.existingAccount ? "Aluno atualizado" : "Aluno adicionado" };
}

export function StudentCreatedPanel({ onAddAnother, productCount, result }: StudentCreatedPanelProps) {
  const { Icon, title } = headline(result);
  const granted = result.grantedProductIds.length;
  const passwordId = "aluno-senha-temporaria";

  return (
    <section aria-live="polite" className={`${adminCard} flex w-full max-w-[640px] flex-col gap-5 p-5`}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--success-bg)] text-[var(--success)]">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg leading-7 font-semibold text-[var(--text-primary)]">{title}</h2>
          <p className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">
            {result.fullName} ({result.email}).{" "}
            {granted > 0
              ? `${granted === 1 ? "1 produto liberado" : `${granted} produtos liberados`}${granted < productCount ? " (os demais não existem mais)" : ""}.`
              : "Nenhum produto liberado ainda."}
            {result.existingAccount ? " A conta já existia: nome, telefone e acessos foram atualizados." : ""}
          </p>
        </div>
      </div>

      {result.delivery === "invite" ? (
        <p className="flex items-start gap-2 text-sm leading-5 text-[var(--text-secondary)]">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
          O aluno recebe um link para criar a senha. Se não chegar, use “Enviar e-mail de acesso” no perfil dele.
        </p>
      ) : null}

      {result.delivery === "temporary_password" && result.temporaryPassword ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-[var(--text-tertiary)]">Senha temporária</p>
              <p className="font-mono text-base font-semibold tracking-wide text-[var(--text-primary)] select-all" id={passwordId}>
                {result.temporaryPassword}
              </p>
            </div>
            <CopyButton label="Copiar senha" selectTargetId={passwordId} text={result.temporaryPassword} />
            <CopyButton
              label="Copiar mensagem"
              text={temporaryPasswordMessage({ email: result.email, fullName: result.fullName, password: result.temporaryPassword })}
              variant="ghost"
            />
          </div>
          <p className="text-[13px] leading-5 text-[var(--warning)]">
            Ela aparece só agora: envie por um canal de atendimento. O aluno troca a senha no primeiro login.
          </p>
        </div>
      ) : null}

      {result.delivery === "none" ? (
        <p className="text-sm leading-5 text-[var(--text-secondary)]">
          Nenhum e-mail foi enviado. Quando quiser, use “Enviar e-mail de acesso” no perfil do aluno.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <AdminLinkButton href={studentHref(result.id)}>Ver aluno</AdminLinkButton>
        <Button className="border-[var(--border-strong)] px-4" onClick={onAddAnother} type="button" variant="secondary">
          Adicionar outro
        </Button>
        <AdminLinkButton href={studentListHref()} variant="ghost">
          Voltar para Alunos
        </AdminLinkButton>
      </div>
    </section>
  );
}
