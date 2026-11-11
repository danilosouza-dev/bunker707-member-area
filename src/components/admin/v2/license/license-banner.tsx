import { AlertTriangle, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { LicenseBannerModel } from "@/server/licensing/copy";
import { LICENSE_SCREEN_HREF } from "@/server/licensing/screen-result";
import { licenseButton } from "./styles";

// A faixa da Licenca na moldura do admin (docs/32 §2.2 e §11.3, "no molde do PendingMigrationNotice"): o que houve, o que
// vale agora, a data do proximo passo e, para o dono e os administradores, Renovar (o endereco que chega na licenca
// assinada), Verificar agora (um <form> com a Server Action) e Ver a Licenca. Montada so no servidor: nenhum JavaScript
// novo no navegador. Some no console da sessao de um webinario, a unica tela em tela cheia (sem a barra lateral
// #admin-sidebar), para nao cobrir a live. No modo "off" o layout nem a monta.

type LicenseBannerProps = {
  banner: LicenseBannerModel;
  /** Dono ou administrador: os botoes. As outras pessoas da equipe leem a faixa e avisam quem pode. */
  canManage: boolean;
  /** A Server Action do Verificar agora (src/server/licensing/actions.ts, checkLicenseNow). */
  checkNowAction: () => Promise<void>;
};

const toneClasses = {
  error: "border-[var(--error-border)] bg-[var(--error-bg)]",
  warning: "border-[var(--warning-border)] bg-[var(--warning-bg)]"
} as const;

const iconClasses = { error: "text-[var(--error)]", warning: "text-[var(--warning)]" } as const;

export function LicenseBanner({ banner, canManage, checkNowAction }: LicenseBannerProps) {
  const Icon = banner.tone === "error" ? ShieldAlert : AlertTriangle;

  return (
    <div
      className="mx-auto w-full max-w-[1440px] px-[clamp(16px,3vw,32px)] pt-4 [body:not(:has(#admin-sidebar))_&]:hidden"
      data-license-banner={banner.degree}
    >
      <section
        aria-label="Situação da Licença"
        className={cn("flex min-w-0 flex-col gap-3 rounded-lg border px-4 py-3 lg:flex-row lg:items-start lg:justify-between", toneClasses[banner.tone])}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", iconClasses[banner.tone])} />
          <div className="flex min-w-0 flex-col gap-1 text-sm leading-5">
            <p className="font-medium text-[var(--text-primary)]">{banner.title}</p>
            {banner.lines.map((line) => (
              <p className="text-[var(--text-secondary)]" key={line}>
                {line}
              </p>
            ))}
            {canManage ? null : <p className="text-[var(--text-secondary)]">Avise o dono ou um administrador da escola.</p>}
          </div>
        </div>
        {canManage ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {banner.needsActivation ? (
              <Link className={licenseButton} data-slot="button" href={LICENSE_SCREEN_HREF}>
                Ativar
              </Link>
            ) : (
              <>
                {banner.renewUrl ? (
                  <a className={licenseButton} data-slot="button" href={banner.renewUrl} rel="noopener noreferrer" target="_blank">
                    Renovar
                  </a>
                ) : null}
                <form action={checkNowAction}>
                  <button className={licenseButton} data-slot="button" type="submit">
                    Verificar agora
                  </button>
                </form>
                <Link className={licenseButton} data-slot="button" href={LICENSE_SCREEN_HREF}>
                  Ver a Licença
                </Link>
              </>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
