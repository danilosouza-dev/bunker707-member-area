import type { ReleaseRuleConfig } from "@/lib/platform-types";

export type ReleaseRuleNotice = {
  detail: string;
  isLocked: boolean;
  title: string;
};

function formatDelay(releaseRule: ReleaseRuleConfig) {
  const delayValue = releaseRule.delayValue?.trim();
  const delayUnit = releaseRule.delayUnit ?? "dias";

  if (!delayValue) {
    return `apos a inscricao`;
  }

  return `${delayValue} ${delayUnit} apos a inscricao`;
}

function formatFixedDate(value?: string) {
  if (!value) {
    return "na data agendada";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

export function getReleaseRuleNotice(
  releaseRule?: ReleaseRuleConfig,
  entityLabel = "conteudo"
): ReleaseRuleNotice | null {
  if (!releaseRule || releaseRule.mode === "immediate") {
    return null;
  }

  if (releaseRule.mode === "fixed_date") {
    if (releaseRule.fixedDate) {
      const date = new Date(releaseRule.fixedDate);

      if (!Number.isNaN(date.getTime()) && date.getTime() <= Date.now()) {
        return null;
      }
    }

    return {
      detail: `Disponivel em ${formatFixedDate(releaseRule.fixedDate)}.`,
      isLocked: true,
      title: `Este ${entityLabel} sera liberado`
    };
  }

  if (releaseRule.mode === "after_enrollment" || releaseRule.mode === "after_purchase") {
    const delayValue = Number(releaseRule.delayValue ?? 0);

    if (!Number.isNaN(delayValue) && delayValue <= 0) {
      return null;
    }

    return {
      detail: `Disponivel ${formatDelay(releaseRule)}.`,
      isLocked: true,
      title: `Este ${entityLabel} sera liberado`
    };
  }

  if (releaseRule.mode === "after_previous_lesson") {
    return {
      detail: "Disponivel depois que a etapa anterior for concluida.",
      isLocked: true,
      title: `Este ${entityLabel} ainda esta bloqueado`
    };
  }

  return {
    detail: releaseRule.requirement || "Disponivel depois que a atividade obrigatoria for concluida.",
    isLocked: true,
    title: `Este ${entityLabel} ainda esta bloqueado`
  };
}
