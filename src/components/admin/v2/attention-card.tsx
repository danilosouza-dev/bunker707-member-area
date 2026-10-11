import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { formatKpiValue } from "./format";
import { AdminLinkButton } from "./link-button";
import { isAdminV2Href } from "./nav";
import { adminCard, adminTransition } from "./styles";

export type AttentionTone = "critical" | "warning" | "neutral";

type AttentionCardProps = {
  action: { href: string; label: string };
  className?: string;
  count: number;
  /** Rotulo de prioridade ao lado do numero: "Passou de 24 h", "Próximos 7 dias", "Catálogo". */
  priorityLabel: string;
  /** Frase do cartao: "perguntas de alunos sem resposta há mais de 24 h". */
  text: string;
  tone?: AttentionTone;
};

type AttentionRowProps = AttentionCardProps & {
  /** Frase curta da linha do celular: "perguntas sem resposta há +24 h". */
  shortText: string;
};

const toneDotClasses: Record<AttentionTone, string> = {
  critical: "bg-[var(--error)]",
  neutral: "bg-[var(--text-tertiary)]",
  warning: "bg-[var(--warning)]"
};

function actionLabel({ action, count, priorityLabel, text }: AttentionCardProps) {
  return `${action.label}: ${formatKpiValue(count)} ${text} (${priorityLabel})`;
}

/**
 * Cartao de "Precisa de atenção hoje" (prototipo aprovado): numero grande e, na mesma linha a direita,
 * o ponto e o rotulo de prioridade; a frase; um unico botao pequeno. So existe quando a regra pode ser
 * calculada e o numero e maior que zero; nunca aparece "em branco".
 */
export function AttentionCard(props: AttentionCardProps) {
  const { action, className, count, priorityLabel, text, tone = "warning" } = props;
  const numberId = useId();
  const textId = useId();

  return (
    <article
      aria-labelledby={`${numberId} ${textId}`}
      className={cn(adminCard, "flex min-w-0 flex-col gap-2.5 p-4", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <p
          className="text-[32px] leading-none font-semibold tracking-[-0.02em] text-[var(--text-primary)] tabular-nums"
          id={numberId}
        >
          {formatKpiValue(count)}
        </p>
        <p className="inline-flex min-w-0 items-center gap-1.5 text-xs leading-4 font-medium text-[var(--text-secondary)]">
          <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", toneDotClasses[tone])} />
          <span className="truncate">{priorityLabel}</span>
        </p>
      </div>
      <p className="flex-1 text-sm leading-[21px] text-pretty text-[var(--text-secondary)]" id={textId}>
        {text}
      </p>
      <AdminLinkButton
        aria-label={actionLabel(props)}
        className="h-7 self-start px-2.5 text-[13px]"
        href={action.href}
        variant="secondary"
      >
        {action.label}
      </AdminLinkButton>
    </article>
  );
}

/**
 * O mesmo alerta no celular (< 768 px): uma linha de 56 px dentro de um card unico (ponto, numero, frase
 * curta e seta). A linha inteira e o link.
 */
export function AttentionRow(props: AttentionRowProps) {
  const { action, className, count, shortText, text, tone = "warning" } = props;

  return (
    <li className={cn("border-t border-[var(--border-subtle)] first:border-t-0", className)}>
      <Link
        aria-label={actionLabel(props)}
        className={cn(
          "flex min-h-14 items-center gap-3 pr-3 pl-4 text-[var(--text-tertiary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)] focus-visible:outline-offset-[-2px]!",
          adminTransition
        )}
        data-navigation-feedback={isAdminV2Href(action.href) ? "false" : undefined}
        href={action.href}
      >
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", toneDotClasses[tone])} />
        <span className="min-w-7 text-xl leading-6 font-semibold tracking-[-0.01em] text-[var(--text-primary)] tabular-nums">
          {formatKpiValue(count)}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm leading-5 text-[var(--text-secondary)]" title={text}>
          {shortText}
        </span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
      </Link>
    </li>
  );
}
