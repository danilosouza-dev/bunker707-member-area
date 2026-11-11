import { AlertTriangle, CheckCircle2, ExternalLink, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { LicenseResultMessage } from "@/server/licensing/copy";
import type { LicenseScreenNotice } from "@/server/licensing/screen-result";
import type { LicenseScreenTone, LicenseScreenView } from "@/server/licensing/screen-view";
import { adminCard } from "../styles";
import { LicenseSubmitButton } from "./license-submit-button";
import { licenseButton, licenseDangerButton, licenseInput, licensePrimaryButton, licenseTextarea } from "./styles";

// A tela Licenca (docs/32 §2.4, Configuracoes > Licenca; so no produto vendido, modo "enforce", e so para o dono e os
// administradores): a situacao em palavras simples, "Licenciado para", o tipo e a validade, o endereco, o ultimo contato
// com o Emissor, os modulos e a versao; e as acoes, cada uma um <form> com a Server Action dela
// (src/server/licensing/actions.ts): Verificar agora, Ativar com a Chave de ativacao, a licenca por arquivo e Desativar,
// com a confirmacao e a consequencia escritas. Montada no servidor; so o botao de envio e do navegador (o "Ativando…").

export type LicenseScreenActions = {
  activate: (formData: FormData) => Promise<void>;
  checkNow: () => Promise<void>;
  deactivate: (formData: FormData) => Promise<void>;
  uploadFile: (formData: FormData) => Promise<void>;
};

type LicenseScreenProps = {
  actions: LicenseScreenActions;
  notice: LicenseScreenNotice | null;
  view: LicenseScreenView;
};

const EMPTY = "—";

const chipTone: Record<LicenseScreenTone, string> = {
  error: "bg-[var(--error)]",
  neutral: "bg-[var(--text-secondary)]",
  success: "bg-[var(--success)]",
  warning: "bg-[var(--warning)]"
};

const messageTone = {
  error: { box: "border-[var(--error-border)] bg-[var(--error-bg)]", icon: ShieldAlert, iconClass: "text-[var(--error)]" },
  success: { box: "border-[var(--success-border)] bg-[var(--success-bg)]", icon: CheckCircle2, iconClass: "text-[var(--success)]" },
  warning: { box: "border-[var(--warning-border)] bg-[var(--warning-bg)]", icon: AlertTriangle, iconClass: "text-[var(--warning)]" }
} as const;

function ResultMessage({ message }: { message: LicenseResultMessage }) {
  const tone = messageTone[message.tone];
  const Icon = tone.icon;

  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm leading-5 text-[var(--text-primary)]", tone.box)} role={message.tone === "error" ? "alert" : "status"}>
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", tone.iconClass)} />
      <p className="min-w-0">{message.text}</p>
    </div>
  );
}

function Card({ children, className, title }: { children: ReactNode; className?: string; title: string }) {
  return (
    <section aria-label={title} className={cn(adminCard, "flex w-full max-w-[880px] min-w-0 flex-col gap-4 px-5 py-4", className)}>
      <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]">{title}</h2>
      {children}
    </section>
  );
}

/** Uma secao que abre e fecha sem JavaScript (<details>). */
function Fold({ children, open = false, summary }: { children: ReactNode; open?: boolean; summary: string }) {
  return (
    <details className="group flex flex-col" open={open}>
      <summary className="cursor-pointer list-none text-sm leading-5 font-medium text-[var(--text-primary)] marker:hidden">
        <span aria-hidden="true" className="mr-1.5 inline-block text-[var(--text-tertiary)] transition-transform group-open:rotate-90">
          ›
        </span>
        {summary}
      </summary>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </details>
  );
}

function Detail({ label, children }: { children: ReactNode; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-[13px] leading-5 text-[var(--text-secondary)] sm:w-48">{label}</dt>
      <dd className="min-w-0 text-sm leading-5 break-words text-[var(--text-primary)]">{children}</dd>
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{children}</p>;
}

export function LicenseScreen({ actions, notice, view }: LicenseScreenProps) {
  const notActivated = view.degree === "nao_ativada";

  return (
    <div className="flex w-full flex-col gap-6" data-license-screen={view.degree}>
      {notice ? (
        <div className="flex w-full max-w-[880px] flex-col gap-2">
          <ResultMessage message={notice.result} />
          {notice.note ? <ResultMessage message={notice.note} /> : null}
        </div>
      ) : null}

      <Card title="Situação">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-[22px] items-center gap-1.5 rounded-[6px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.06)] px-2 text-xs leading-none font-medium text-[var(--text-primary)]">
            <span aria-hidden="true" className={cn("size-1.5 rounded-full", chipTone[view.tone])} />
            {view.degreeLabel}
          </span>
        </div>
        <div className="flex flex-col gap-1.5 text-sm leading-5">
          {view.reasons.map((reason) => (
            <p className="text-[var(--text-primary)]" key={reason}>
              {reason}
            </p>
          ))}
          <p className="text-[var(--text-secondary)]">{view.meaning}</p>
          {view.nextStep ? <p className="text-[var(--text-secondary)]">{view.nextStep}</p> : null}
          {view.observation ? <p className="text-[var(--text-secondary)]">{view.observation}</p> : null}
          {view.clockWrong ? (
            <p className="text-[var(--text-secondary)]">
              A hora deste servidor está mais de 48 horas diferente da hora do Emissor de licenças. Acerte o relógio (NTP); nada foi limitado por isso.
            </p>
          ) : null}
        </div>
        {notActivated ? null : (
          <div className="flex flex-wrap items-center gap-2">
            {view.canTalkToEmissor ? (
              <form action={actions.checkNow}>
                <LicenseSubmitButton className={licenseButton} pendingLabel="Verificando…">
                  Verificar agora
                </LicenseSubmitButton>
              </form>
            ) : null}
            {view.renewUrl ? (
              <a className={licenseButton} data-slot="button" href={view.renewUrl} rel="noopener noreferrer" target="_blank">
                Renovar
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </a>
            ) : null}
          </div>
        )}
        {view.lastFailure ? (
          <Hint>
            Última tentativa de conferência, em {view.lastFailure.at}: {view.lastFailure.message.text}
          </Hint>
        ) : null}
      </Card>

      <Card title="Dados da Licença">
        <dl className="flex flex-col gap-3">
          <Detail label="Licenciado para">{view.holder ?? EMPTY}</Detail>
          <Detail label="Tipo">
            {view.kind ?? EMPTY}
            {view.provisional ? <span className="text-[var(--text-secondary)]"> (com uma compra ainda na garantia)</span> : null}
          </Detail>
          <Detail label="Validade">{view.kind === "Vitalícia" ? "Sem data de fim" : (view.validUntil ?? EMPTY)}</Detail>
          <Detail label="Endereço">
            {view.licenseHost ?? EMPTY}
            {view.hostMismatch && view.configuredHost ? (
              <span className="block text-[var(--text-secondary)]">Esta escola está configurada em {view.configuredHost}.</span>
            ) : null}
          </Detail>
          <Detail label="Último contato">
            {view.delivery === "file" ? "Licença por arquivo, sem conferência pela internet" : (view.lastContact ?? EMPTY)}
          </Detail>
          <Detail label="Vale sem contato até">{view.validWithoutContactUntil ?? EMPTY}</Detail>
          <Detail label="Módulos">{view.modules.length > 0 ? view.modules.join(", ") : "Nenhum"}</Detail>
          <Detail label="Versão">{view.version}</Detail>
          {view.licenseId ? <Detail label="Número da Licença">{view.licenseId}</Detail> : null}
          {view.installationId ? <Detail label="Instalação">{view.installationId}</Detail> : null}
        </dl>
      </Card>

      <Card title="Ativar">
        <Fold open={notActivated} summary={notActivated ? "Ativar com a Chave de ativação" : "Ativar de novo com outra Chave de ativação"}>
          <Hint>
            A Chave de ativação é de uso único e liga esta escola, neste endereço, à Licença. Ativar de novo no mesmo endereço não gasta outra
            vaga. O Emissor de licenças confere a Chave e a vaga antes de gastar a Chave.
          </Hint>
          <form action={actions.activate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5" htmlFor="licenca-chave">
              <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">Chave de ativação</span>
              <input
                autoCapitalize="characters"
                autoComplete="off"
                className={cn(licenseInput, "font-mono")}
                id="licenca-chave"
                maxLength={120}
                name="chave"
                placeholder="BKA-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
                required
                spellCheck={false}
                type="text"
              />
            </label>
            <LicenseSubmitButton className={licensePrimaryButton} pendingLabel="Ativando…">
              Ativar
            </LicenseSubmitButton>
          </form>
        </Fold>
      </Card>

      <Card title="Licença por arquivo">
        <Fold open={notActivated} summary="Carregar a licença por arquivo">
          <Hint>
            Para o servidor que não consegue falar com o Emissor de licenças. A licença por arquivo é conferida aqui, com a assinatura gravada
            nesta versão, e vale pelo prazo dela, sem a conferência diária.
          </Hint>
          {/* Com a Server Action no action, o React manda o formulario em multipart (o arquivo vai junto) sozinho. */}
          <form action={actions.uploadFile} className="flex flex-col gap-3">
            <label className="flex min-w-0 flex-col gap-1.5" htmlFor="licenca-arquivo">
              <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">Arquivo da licença</span>
              <input
                accept=".txt,.lic,.bkl,text/plain"
                className="text-sm text-[var(--text-secondary)] file:mr-3 file:rounded-lg file:border file:border-[var(--border-strong)] file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--text-primary)]"
                id="licenca-arquivo"
                name="arquivo"
                type="file"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5" htmlFor="licenca-texto">
              <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">
                Ou cole o texto da licença <span className="font-normal text-[var(--text-tertiary)]">(opcional)</span>
              </span>
              <textarea autoComplete="off" className={licenseTextarea} id="licenca-texto" name="texto" placeholder="BKL1.…" spellCheck={false} />
            </label>
            <div>
              <LicenseSubmitButton className={licensePrimaryButton} pendingLabel="Conferindo…">
                Carregar licença
              </LicenseSubmitButton>
            </div>
          </form>
        </Fold>
      </Card>

      {view.canTalkToEmissor && !view.deactivated ? (
        <Card title="Desativar">
          <Fold summary="Desativar esta Instalação">
            <Hint>
              Desativar coloca esta escola, na hora, em Escola congelada: ninguém ganha acesso novo, e a equipe não cria nem publica nada novo.
              Quem já é aluno continua com tudo o que tem, e os dados ficam guardados. A vaga da Licença fica livre para ativar outra
              Instalação. Use ao trocar de servidor. Desativar, trocar de endereço e liberar vaga somam no limite de duas mudanças por ano;
              voltar a ativar esta Instalação depois é pelo suporte.
            </Hint>
            <form action={actions.deactivate} className="flex flex-col gap-3">
              <label className="flex items-start gap-2.5 text-sm leading-5 text-[var(--text-primary)]" htmlFor="licenca-confirmar">
                <input className="mt-0.5 size-4 shrink-0 accent-[var(--error)]" id="licenca-confirmar" name="confirmar" required type="checkbox" value="desativar" />
                Entendi: esta escola vai para Escola congelada agora, e a vaga da Licença fica livre.
              </label>
              <div>
                <LicenseSubmitButton className={licenseDangerButton} pendingLabel="Desativando…">
                  Desativar esta Instalação
                </LicenseSubmitButton>
              </div>
            </form>
          </Fold>
        </Card>
      ) : null}
    </div>
  );
}
