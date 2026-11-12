import type { LicenseRequestsOverview } from "@/server/licensing/interno/admin-queries";
import type { LicenseRequestListItem } from "@/server/licensing/interno/requests-view";
import { StatusChip } from "../../status-chip";
import { SectionCard } from "../kit";
import { LicenseRequestButtons } from "./license-request-buttons";

// "Licenças do Bunker Members" em Configuracoes > Vendas (docs/32 §11.10): a fila dos pedidos ao Emissor, com a situacao,
// a tentativa e o erro de cada um, e os ultimos que sairam. Montada no servidor; so os botoes de cada pedido sao do
// navegador. So existe na nossa escola, com a API interna do Emissor configurada (no produto vendido a pagina nem a monta).

export const LICENSE_REQUESTS_ANCHOR = "licencas-bunker-members";

const DESCRIPTION =
  "A venda paga de um produto marcado como Bunker Members vira um pedido ao Emissor, e o reembolso e o chargeback viram o desfazer. Com o Emissor fora do ar, o pedido espera aqui e é reenviado sozinho.";

function RequestRow({ item }: { item: LicenseRequestListItem }) {
  return (
    <li className="flex min-w-0 flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm leading-5 font-medium text-[var(--text-primary)]">{item.title}</span>
          <StatusChip tone={item.tone}>{item.statusLabel}</StatusChip>
        </span>
        <span className="truncate text-[13px] leading-5 text-[var(--text-secondary)]">{item.subtitle}</span>
        <span className="text-xs leading-4 text-[var(--text-tertiary)] tabular-nums">
          {[item.createdAt ? `Entrou em ${item.createdAt}` : null, item.attempts > 0 ? `${item.attempts === 1 ? "1 tentativa" : `${item.attempts} tentativas`}` : null, item.nextAttempt ? `próxima em ${item.nextAttempt}` : null]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {item.error ? <span className="text-xs leading-4 text-[var(--error)]">{item.error}</span> : null}
        {item.resolution ? <span className="text-xs leading-4 text-[var(--text-secondary)]">{item.resolution}</span> : null}
      </div>
      {item.canRetry || item.canDismiss ? <LicenseRequestButtons canDismiss={item.canDismiss} canRetry={item.canRetry} id={item.id} /> : null}
    </li>
  );
}

export function LicenseRequestsCard({ overview }: { overview: LicenseRequestsOverview }) {
  const description = overview.simulator ? `${DESCRIPTION} Neste ambiente os pedidos vão para o simulador, não para o Emissor.` : DESCRIPTION;

  if (overview.missingMigration) {
    return (
      <div id={LICENSE_REQUESTS_ANCHOR}>
        <SectionCard description={description} title="Licenças do Bunker Members">
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
            O banco ainda não tem a migração 202611130001. Até ela rodar, nenhuma venda vira Licença: as vendas passam como antes, e as que precisarem viram Licença pelo Painel de licenças.
          </p>
        </SectionCard>
      </div>
    );
  }

  const waiting = overview.open.length;

  return (
    <div id={LICENSE_REQUESTS_ANCHOR}>
      <SectionCard bodyClassName="p-0" description={description} meta={waiting === 0 ? "nada na fila" : waiting === 1 ? "1 na fila" : `${waiting} na fila`} title="Licenças do Bunker Members">
        {waiting > 0 ? (
          <ul aria-label="Pedidos ao Emissor que ainda não saíram" className="flex flex-col divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
            {overview.open.map((item) => (
              <RequestRow item={item} key={item.id} />
            ))}
          </ul>
        ) : (
          <p className="border-t border-[var(--border-subtle)] px-4 py-3 text-[13px] leading-5 text-[var(--text-secondary)]">Nenhum pedido esperando.</p>
        )}
        {overview.recent.length > 0 ? (
          <details className="border-t border-[var(--border-subtle)]">
            <summary className="cursor-pointer px-4 py-3 text-[13px] leading-5 font-medium text-[var(--text-secondary)]">Últimos que saíram</summary>
            <ul aria-label="Últimos pedidos ao Emissor" className="flex flex-col divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
              {overview.recent.map((item) => (
                <RequestRow item={item} key={item.id} />
              ))}
            </ul>
          </details>
        ) : null}
      </SectionCard>
    </div>
  );
}
