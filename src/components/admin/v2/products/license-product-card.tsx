"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setProductLicenseSale } from "@/server/licensing/interno/admin-actions";
import { AdminSwitch, SectionCard } from "../settings/kit";
import { adminToast } from "../toast";

// O cartao "Bunker Members" da aba Acesso e venda (docs/32 §11.10): o dono marca o produto cuja venda vira Licenca (o
// curso do Bunker Members e os produtos de Ano adicional e de modulo dele). So existe na nossa escola, com a API interna
// do Emissor configurada; a pagina so o monta para o dono. O que cada codigo da plataforma e (anual, vitalicia, Ano
// adicional, modulo) fica no Painel de licencas, nunca aqui.

const DESCRIPTION =
  "A venda paga deste produto, ou de um pacote que o inclui, vira um pedido de Licença ao Emissor; o reembolso e o chargeback desfazem. O acesso do aluno continua sendo liberado como sempre.";
const SWITCH_EFFECT =
  "O que cada código da Hotmart ou da Ticto é (Licença anual, vitalícia, Ano adicional ou módulo) você cadastra no Painel de licenças. Desligado, as vendas deste produto não vão ao Emissor.";

export function LicenseProductCard({ enabled: initial, missingMigration, productId, simulator }: { enabled: boolean; missingMigration: boolean; productId: string; simulator: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: boolean) {
    if (pending) {
      return;
    }

    setPending(true);
    setError(null);
    const result = await setProductLicenseSale({ enabled: next, productId });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setEnabled(result.data.enabled);
    adminToast.success(result.data.enabled ? "Produto marcado como Bunker Members" : "Produto desmarcado do Bunker Members");
    router.refresh();
  }

  return (
    <SectionCard
      className="max-w-[640px]"
      description={simulator ? `${DESCRIPTION} Neste ambiente as Licenças vão para o simulador, não para o Emissor.` : DESCRIPTION}
      title="Bunker Members"
    >
      {missingMigration ? (
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]">O banco ainda não tem a migração 202611130001. Rode a migração para marcar produtos.</p>
      ) : (
        <AdminSwitch checked={enabled} description={SWITCH_EFFECT} label="A venda deste produto vira Licença" onCheckedChange={(next) => void change(next)} pending={pending} />
      )}
      {error ? (
        <p className="mt-2 text-[13px] leading-5 text-[var(--error)]" role="alert">
          {error}
        </p>
      ) : null}
    </SectionCard>
  );
}
