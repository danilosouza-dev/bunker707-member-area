import { ArrowRight, BookOpen, KeyRound, Server, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { memberButtonClassName } from "@/components/member/ui/member-button";
import { MemberPage, MemberPageHeader, MemberSection } from "@/components/member/ui/member-page";
import { MemberSurface } from "@/components/member/ui/member-surface";
import { cn } from "@/lib/utils";
import type { MyLicensesPage } from "@/server/licensing/interno/student";
import type { LicenseCardView, LicenseTone } from "@/server/licensing/interno/student-model";
import { LICENSE_TERMS_PARAGRAPHS, LICENSE_TERMS_TITLE, LICENSE_TERMS_VERSION } from "@/server/licensing/interno/terms";
import { HolderForm } from "./holder-form";
import { LicenseKeyActions } from "./license-key-actions";

// Minhas licencas (docs/32 §2.4): montada no servidor, so com duas ilhas do navegador (o formulario do titular e os botoes
// da Chave). Uma Licenca por area de membros comprada, com a situacao em portugues simples, a validade e o Renovar, a
// Instalacao (endereco e ultimo contato), os modulos e a Chave de ativacao. No primeiro acesso, o titular e o aceite dos
// termos vem antes das Licencas. A secao Instalacao guarda o lugar do download do pacote e do comando (peca seguinte).
// Com o servico de licencas fora do ar, a pagina diz isso, sem botoes, e mantem o link da aula.

const toneClassNames: Record<LicenseTone, string> = {
  error: "border-red-400/30 bg-red-500/10 text-red-200",
  neutral: "border-white/10 bg-white/[0.07] text-zinc-200",
  success: "border-emerald-400/25 bg-emerald-500/12 text-emerald-200",
  warning: "border-amber-400/25 bg-amber-500/10 text-amber-200"
};

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-[13px] leading-6 text-zinc-500 sm:w-36">{label}</dt>
      <dd className="min-w-0 break-words text-sm leading-6 text-zinc-200">{children}</dd>
    </div>
  );
}

function LicenseCard({ blocked, license }: { blocked: boolean; license: LicenseCardView }) {
  return (
    <MemberSurface as="article" aria-labelledby={`licenca-${license.id}`} className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-white" id={`licenca-${license.id}`}>
            {license.title}
          </h3>
          <p className="mt-0.5 font-mono text-xs text-zinc-500">{license.id}</p>
        </div>
        <span className={cn("inline-flex h-7 items-center rounded-full border px-3 text-xs font-semibold", toneClassNames[license.situation.tone])}>{license.situation.label}</span>
      </header>

      <p className="text-sm leading-6 text-zinc-300">{license.situation.text}</p>

      <dl className="flex flex-col gap-2">
        <Detail label="Validade">{license.validity}</Detail>
        <Detail label="Instalação">
          {license.installation ? (
            <>
              <span className="font-semibold text-white">{license.installation.address}</span>
              {license.installation.version ? <span className="text-zinc-500">{` · versão ${license.installation.version}`}</span> : null}
            </>
          ) : (
            "Ainda não instalada"
          )}
        </Detail>
        {license.installation ? <Detail label="Último contato">{license.installation.lastContact}</Detail> : null}
        <Detail label="Módulos">{license.modules.length > 0 ? license.modules.join(", ") : "Nenhum módulo"}</Detail>
        <Detail label="Chave de ativação">{license.key.text}</Detail>
      </dl>

      {license.blockedReason ? <p className="text-[13px] leading-5 text-zinc-500">{license.blockedReason}</p> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <LicenseKeyActions
          canGenerate={license.canGenerate}
          canReplace={license.canReplace}
          canRevoke={license.canRevoke}
          disabled={blocked}
          licenseId={license.id}
          replaceWarning={license.replaceWarning}
        />
        {license.renewUrl ? (
          <a className={memberButtonClassName({ size: "sm", variant: "accent" })} href={license.renewUrl} rel="noopener noreferrer">
            Renovar
            <ArrowRight aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </MemberSurface>
  );
}

export function LicensesView({ accountEmail, page }: { accountEmail: string; page: MyLicensesPage }) {
  const view = page.view;
  const needsHolder = Boolean(view && (view.needsHolder || view.needsTerms));
  const course = page.courses[0];

  return (
    <MemberPage width="narrow">
      <MemberPageHeader
        description="Cada Licença vale para uma área de membros, num endereço. Gere a chave de ativação quando for instalar; você pode trocar a chave quando quiser, e a anterior para de funcionar."
        eyebrow={{ icon: KeyRound, label: "Bunker Members" }}
        title="Minhas licenças"
      />

      <div className="grid gap-12 sm:gap-14">
        {page.simulator ? (
          <p className="rounded-[12px] border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-100">
            Ambiente de teste: estas licenças vêm do simulador, não do serviço de licenças de verdade, e as chaves daqui não ativam nada. Quem ainda não tinha nenhuma ganha uma Licença anual de teste, para ver a tela.
          </p>
        ) : null}

        {page.emissorError ? (
          <MemberSurface className="flex flex-col gap-3" role="status">
            <p className="flex items-center gap-2 text-base font-bold text-white">
              <TriangleAlert aria-hidden="true" className="size-5 text-amber-300" />
              Licenças indisponíveis agora
            </p>
            <p className="text-sm leading-6 text-zinc-300">{page.emissorError}</p>
          </MemberSurface>
        ) : null}

        {view && needsHolder ? (
          <MemberSection
            description={
              view.needsHolder
                ? "Antes da primeira chave, diga quem é o titular da Licença e aceite os termos de uso. É uma vez só."
                : "Os termos de uso da Licença mudaram. Leia e aceite a versão nova para gerar chaves."
            }
            id="titular"
            title={view.needsHolder ? "Titular da Licença" : "Termos atualizados"}
          >
            <MemberSurface>
              <HolderForm accountEmail={accountEmail} onlyTerms={!view.needsHolder} terms={{ paragraphs: LICENSE_TERMS_PARAGRAPHS, title: LICENSE_TERMS_TITLE, version: LICENSE_TERMS_VERSION }} />
            </MemberSurface>
          </MemberSection>
        ) : null}

        {view ? (
          <MemberSection count={view.licenses.length} id="licencas" title="Suas licenças">
            {view.licenses.length > 0 ? (
              <div className="grid gap-4">
                {view.licenses.map((license) => (
                  <LicenseCard blocked={needsHolder} key={license.id} license={license} />
                ))}
              </div>
            ) : (
              <MemberSurface>
                <p className="text-sm leading-6 text-zinc-300">
                  Sua compra ainda está chegando ao serviço de licenças. Costuma levar poucos minutos; recarregue a página daqui a pouco.
                </p>
              </MemberSurface>
            )}
          </MemberSection>
        ) : null}

        <MemberSection description="O pacote da versão e o comando de instalação vão aparecer aqui." id="instalacao" title="Instalação">
          <MemberSurface className="flex flex-col gap-4">
            <p className="flex items-start gap-3 text-sm leading-6 text-zinc-300">
              <Server aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-zinc-400" />
              Em breve, o download do pacote e o comando de instalação ficam neste lugar. Enquanto isso, siga a aula de instalação com a sua chave de ativação.
            </p>
            {course ? (
              <Link className={memberButtonClassName({ className: "self-start", size: "sm" })} href={course.href}>
                <BookOpen aria-hidden="true" />
                {`Abrir a aula: ${course.title}`}
              </Link>
            ) : null}
          </MemberSurface>
        </MemberSection>

        {view?.holder ? (
          <MemberSection id="titular-informado" title="Titular">
            <dl className="flex flex-col gap-2">
              <Detail label="Nome">{view.holder.name}</Detail>
              <Detail label="Documento">{view.holder.document}</Detail>
              {view.holder.email2 ? <Detail label="Segundo e-mail">{view.holder.email2}</Detail> : null}
              {view.holder.termsVersion ? (
                <Detail label="Termos aceitos">{`Versão ${view.holder.termsVersion}${view.holder.termsAcceptedAt ? ` em ${view.holder.termsAcceptedAt}` : ""}`}</Detail>
              ) : null}
            </dl>
            <p className="mt-3 text-[13px] leading-5 text-zinc-500">Para mudar o titular, fale com o suporte.</p>
          </MemberSection>
        ) : null}
      </div>
    </MemberPage>
  );
}
