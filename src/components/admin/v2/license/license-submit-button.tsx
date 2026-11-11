"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

// O botao de envio dos formularios da tela Licenca: enquanto a Server Action roda (a ativacao fala com o Emissor duas
// vezes e pode levar alguns segundos), fica desligado e diz o que esta acontecendo. So a tela Licenca o usa; a faixa do
// admin fica sem JavaScript novo.

type LicenseSubmitButtonProps = {
  children: ReactNode;
  className: string;
  pendingLabel: string;
};

export function LicenseSubmitButton({ children, className, pendingLabel }: LicenseSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button aria-busy={pending || undefined} className={className} data-slot="button" disabled={pending} type="submit">
      {pending ? pendingLabel : children}
    </button>
  );
}
