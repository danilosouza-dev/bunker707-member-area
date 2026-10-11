"use client";

import { useId, useState } from "react";
import { LoginExperience } from "@/components/login-experience";
import type { LoginPageConfig } from "@/lib/login-config";
import { cn } from "@/lib/utils";
import { PillGroup } from "../../form";
import { PreviewFrame, type PreviewDevice } from "../preview-frame";

// Previa da pagina de entrar: o LoginExperience REAL do aluno em modo `preview` (nao le a sessao,
// nao envia nada) dentro da moldura de 1280 × 800 (computador) ou 390 × 844 (celular).
// A partir de 1440 px de janela as duas aparecem lado a lado; abaixo disso, pilulas trocam.

type LoginPreviewProps = {
  ariaLabel: string;
  className?: string;
  config: LoginPageConfig;
  device: PreviewDevice;
  maxWidth?: number;
};

export function LoginPreview({ ariaLabel, className, config, device, maxWidth }: LoginPreviewProps) {
  return (
    <PreviewFrame ariaLabel={ariaLabel} className={className} device={device} maxWidth={maxWidth}>
      <LoginExperience authConfigured config={config} preview redirectTo="/" />
    </PreviewFrame>
  );
}

const DEVICE_OPTIONS = [
  { label: "Computador", value: "desktop" },
  { label: "Celular", value: "mobile" }
] as const satisfies readonly { label: string; value: PreviewDevice }[];

export function LoginPreviewPanel({ className, config }: { className?: string; config: LoginPageConfig }) {
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const titleId = useId();
  const hintId = useId();

  return (
    <section aria-describedby={hintId} aria-labelledby={titleId} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <header className="flex min-h-9 flex-wrap items-center justify-between gap-3">
        <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]" id={titleId}>
          Prévia
        </h2>
        <PillGroup
          ariaLabel="Ver a prévia no"
          className="min-[1440px]:hidden"
          name="login-previa-aparelho"
          onChange={setDevice}
          options={DEVICE_OPTIONS}
          value={device}
        />
      </header>

      <div className="flex min-w-0 items-start gap-4">
        <LoginPreview
          ariaLabel="Prévia da página de entrar no computador"
          className={cn("min-w-0 flex-1", device !== "desktop" && "hidden min-[1440px]:flex")}
          config={config}
          device="desktop"
        />
        <div
          className={cn(
            "mx-auto w-full max-w-[260px] min-[1440px]:mx-0 min-[1440px]:w-[150px] min-[1440px]:max-w-none min-[1440px]:shrink-0",
            device !== "mobile" && "hidden min-[1440px]:block"
          )}
        >
          <LoginPreview ariaLabel="Prévia da página de entrar no celular" config={config} device="mobile" />
        </div>
      </div>

      <p className="text-xs leading-5 text-[var(--text-secondary)]" id={hintId}>
        Logado, você não vê a página de entrar. Para conferir de verdade, abra o endereço /login numa janela anônima.
      </p>
    </section>
  );
}
