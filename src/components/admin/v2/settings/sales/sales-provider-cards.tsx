import { salesProviderChip } from "@/server/payments/model";
import type { SalesProviderCard } from "@/server/payments/queries";
import { StatusChip } from "../../status-chip";
import { adminCard } from "../../styles";
import { ProviderConnectCard } from "./provider-connect-card";

// Cartoes de Configuracoes > Vendas: as plataformas com adaptador (Hotmart, Ticto) sao conectaveis; as
// outras (Kiwify) aparecem ao lado como "Em configuração", honestamente, ate a integracao existir
// (docs/17 §1.10: nunca "Configurada").

function PendingProviderCard({ card }: { card: SalesProviderCard }) {
  const chip = salesProviderChip({ status: card.status, supported: card.supported });

  return (
    <section aria-labelledby={`vendas-${card.provider}`} className={`${adminCard} flex min-w-0 flex-col gap-3 p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]" id={`vendas-${card.provider}`}>
          {card.label}
        </h2>
        <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
      </div>
      <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
        A integração com a {card.label} está sendo preparada. Quando estiver pronta, você conecta por aqui, do mesmo jeito da Hotmart e da Ticto. Até lá, quem compra
        pela {card.label} recebe o acesso à mão, em Alunos.
      </p>
    </section>
  );
}

export function SalesProviderCards({ now, providers }: { now: number; providers: readonly SalesProviderCard[] }) {
  const supported = providers.filter((card) => card.supported);
  const pending = providers.filter((card) => !card.supported);

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        {supported.map((card) => (
          <ProviderConnectCard card={card} key={card.provider} now={now} />
        ))}
      </div>
      {pending.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-6">
          {pending.map((card) => (
            <PendingProviderCard card={card} key={card.provider} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
