import { formatHeldSaleDateTime } from "@/server/payments/held-sales-model";
import type { HeldSalesOverview } from "@/server/payments/held-sales-queries";
import { HELD_SALES_MIGRATION } from "@/server/payments/held-sales-store";
import { StatusChip } from "../../status-chip";
import { SectionCard } from "../kit";

// A lista "Vendas guardadas" (docs/32 §2.2 e §11.3): as compras que chegaram quando a Licenca nao permitia acesso novo,
// com nome, e-mail, data, o que ficou sem acesso e o motivo. Montada no servidor, sem JavaScript novo: aparece em
// Configuracoes > Vendas (o dono) e na tela Licenca (o dono e os administradores), so no produto vendido (modo
// "enforce"; no "off" a pagina nao a monta) e so quando ha venda guardada ou a migracao falta. Nenhum botao: a liberacao
// e automatica, e liberar uma venda a mao com a Licenca barrando seria o acesso novo que ela barra.

export const HELD_SALES_ANCHOR = "vendas-guardadas";

const DESCRIPTION =
  "Compras que chegaram quando a Licença não permitia acesso novo. Quem comprou ainda não tem o acesso. Elas são liberadas sozinhas, na ordem em que chegaram, com as boas-vindas de sempre, quando a Licença voltar a permitir; a compra reembolsada ou contestada antes disso é descartada.";

function countLabel(count: number) {
  return count === 1 ? "1 venda" : `${count} vendas`;
}

export function HeldSalesCard({ overview }: { overview: HeldSalesOverview }) {
  if (overview.missingMigration) {
    return (
      <div id={HELD_SALES_ANCHOR}>
        <SectionCard description={`O banco ainda não tem a migração ${HELD_SALES_MIGRATION}. Até ela rodar, a compra que chega com a Licença barrando o acesso novo fica com erro, sem liberar nada, e a plataforma reenvia.`} title="Vendas guardadas">
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">Nenhuma venda pode ficar guardada sem a migração.</p>
        </SectionCard>
      </div>
    );
  }

  if (overview.count === 0) {
    return null;
  }

  return (
    <div id={HELD_SALES_ANCHOR}>
      <SectionCard bodyClassName="p-0" description={DESCRIPTION} meta={countLabel(overview.count)} title="Vendas guardadas">
        <ul aria-label="Vendas guardadas" className="flex flex-col divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
          {overview.items.map((item) => (
            <li className="flex min-w-0 flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4" key={item.id}>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm leading-5 font-medium text-[var(--text-primary)]">{item.buyerName ?? item.buyerEmail ?? "Comprador sem nome"}</span>
                {item.buyerEmail ? <span className="truncate text-[13px] leading-5 text-[var(--text-secondary)]">{item.buyerEmail}</span> : null}
                <span className="text-[13px] leading-5 text-[var(--text-secondary)]">{item.products.join(", ")}</span>
                <span className="text-xs leading-4 text-[var(--text-tertiary)] tabular-nums">
                  {`Chegou pela ${item.providerLabel}${item.receivedAt ? ` em ${formatHeldSaleDateTime(item.receivedAt)}` : ""}; guardada em ${formatHeldSaleDateTime(item.heldAt)}.`}
                </span>
                {item.attempts > 0 ? (
                  <span className="text-xs leading-4 text-[var(--error)]">
                    {`A liberação falhou ${item.attempts === 1 ? "1 vez" : `${item.attempts} vezes`}${item.lastError ? `: ${item.lastError}` : "."}`}
                  </span>
                ) : null}
              </div>
              <span className="shrink-0">
                <StatusChip tone="warning">{item.reasonTitle}</StatusChip>
              </span>
            </li>
          ))}
        </ul>
        {overview.count > overview.items.length ? (
          <p className="border-t border-[var(--border-subtle)] px-4 py-3 text-xs leading-4 text-[var(--text-tertiary)]">
            {`Mostrando as ${overview.items.length} mais antigas de ${overview.count}. Elas são liberadas nesta ordem.`}
          </p>
        ) : null}
      </SectionCard>
    </div>
  );
}
