// Numeros do topo da Comunidade em texto (rotulo, valor, linha de apoio e formula). Modulo puro:
// a faixa de numeros (stat-strip.tsx) e tests/community-queue.test.mjs usam a mesma funcao.
// Sem dado, "—"; nunca um numero de exemplo.

import {
  RESPONSE_TARGET_MEDIAN_HOURS,
  UNANSWERED_ALERT_HOURS,
  formatAgeFromHours,
  formatResponseHours
} from "../../../../server/community/model";
import type { CommunityStats } from "../../../../server/community/types";
import { EMPTY_VALUE } from "../format";

export type CommunityStatCell = {
  formula: string;
  label: string;
  sub: string;
  subTone?: "warning";
  value: string;
};

const integer = new Intl.NumberFormat("pt-BR");

export function buildCommunityStatCells(stats: CommunityStats): CommunityStatCell[] {
  const oldest = stats.oldestUnansweredHours;
  const median = stats.medianResponseHours;
  const window = `${stats.windowDays} dias`;

  return [
    {
      formula:
        "Comentários principais de alunos, visíveis, sem resposta do professor e não resolvidos. Conta tudo o que está aberto, de qualquer data.",
      label: "Sem resposta",
      sub: stats.unanswered > 0 && oldest !== null ? `a mais antiga ${formatAgeFromHours(oldest)}` : "nenhuma esperando",
      subTone: stats.unanswered > 0 && oldest !== null && oldest > UNANSWERED_ALERT_HOURS ? "warning" : undefined,
      value: integer.format(stats.unanswered)
    },
    {
      formula: `Tempo entre a pergunta e a primeira resposta do professor, nas perguntas dos últimos ${window}. p90: os 10% mais lentos.`,
      label: "Resposta mediana",
      sub:
        median === null
          ? `sem respostas em ${window} · meta abaixo de ${RESPONSE_TARGET_MEDIAN_HOURS} h`
          : `p90 ${formatResponseHours(stats.p90ResponseHours)} · meta abaixo de ${RESPONSE_TARGET_MEDIAN_HOURS} h`,
      subTone: median !== null && median > RESPONSE_TARGET_MEDIAN_HOURS ? "warning" : undefined,
      value: median === null ? EMPTY_VALUE : formatResponseHours(median)
    },
    {
      formula: `Comentários e respostas de alunos nos últimos ${window}, sem os marcados como spam.`,
      label: "Comentários",
      sub: `últimos ${window}`,
      value: integer.format(stats.commentsInWindow)
    },
    {
      formula: "Comentários visíveis com denúncia mais nova que a última ação de moderação.",
      label: "Denúncias",
      sub: stats.openReports === 0 ? "nenhuma aberta" : stats.openReports === 1 ? "aberta" : "abertas",
      value: integer.format(stats.openReports)
    }
  ];
}
