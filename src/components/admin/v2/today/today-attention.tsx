import { Check } from "lucide-react";
import { AttentionCard, AttentionRow } from "../attention-card";
import { ErrorBanner } from "../error-banner";
import { AdminLinkButton } from "../link-button";
import { PendingMigrationNotice } from "../pending-migration-notice";
import { adminCard } from "../styles";
import type { TodayAttentionState } from "./today-model";
import { TodaySectionHeading } from "./today-section-heading";

export const TODAY_MIGRATION_LABEL = "202610120001";

type TodayAttentionProps = {
  retryHref: string;
  state: TodayAttentionState;
};

/** "Tudo em dia": so quando todas as regras foram calculadas e nenhuma tem numero. */
function AllGood({ checkedAt }: { checkedAt: string }) {
  return (
    <div className={`${adminCard} flex items-center gap-3.5 p-4`} role="status">
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-full border border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]"
      >
        <Check className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-sm leading-[21px] font-semibold text-[var(--text-primary)]">Tudo em dia. Nada precisa de você agora.</p>
        <p className="text-xs leading-[18px] font-medium text-[var(--text-tertiary)]">Última verificação às {checkedAt}</p>
      </div>
    </div>
  );
}

/**
 * Linha 1 do Hoje: "Precisa de atenção hoje". Ate quatro cartoes na mesma linha a partir de 1180 px,
 * dois por linha entre 768 e 1179 px e, no celular, uma lista de linhas de 56 px num card so.
 */
export function TodayAttention({ retryHref, state }: TodayAttentionProps) {
  return (
    <section aria-labelledby="hoje-atencao" className="flex min-w-0 flex-col gap-3">
      <TodaySectionHeading id="hoje-atencao" title="Precisa de atenção hoje" />

      {state.status === "error" ? (
        <ErrorBanner
          action={
            <AdminLinkButton className="h-7 px-2.5 text-[13px]" href={retryHref} variant="secondary">
              Tentar de novo
            </AdminLinkButton>
          }
        >
          Não foi possível verificar os alertas agora.
        </ErrorBanner>
      ) : (
        <>
          {state.cards.length > 0 ? (
            <>
              <div className="hidden grid-cols-2 gap-3 md:grid min-[1180px]:auto-cols-fr min-[1180px]:grid-flow-col min-[1180px]:grid-cols-none">
                {state.cards.map((card) => (
                  <AttentionCard
                    action={card.action}
                    count={card.count}
                    key={card.id}
                    priorityLabel={card.priorityLabel}
                    text={card.text}
                    tone={card.tone}
                  />
                ))}
              </div>
              <ul className={`${adminCard} overflow-hidden md:hidden`}>
                {state.cards.map((card) => (
                  <AttentionRow
                    action={card.action}
                    count={card.count}
                    key={card.id}
                    priorityLabel={card.priorityLabel}
                    shortText={card.shortText}
                    text={card.text}
                    tone={card.tone}
                  />
                ))}
              </ul>
            </>
          ) : state.complete ? (
            <AllGood checkedAt={state.checkedAt} />
          ) : null}
          {state.pendingMigration ? <PendingMigrationNotice migration={TODAY_MIGRATION_LABEL} size="compact" /> : null}
        </>
      )}
    </section>
  );
}
