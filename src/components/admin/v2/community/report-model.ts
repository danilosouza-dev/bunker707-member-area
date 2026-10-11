// Textos puros da aba Denuncias (historico e resolucao). Sem React: tests/community-queue.test.mjs
// carrega este arquivo direto.

import { formatWaitingTime } from "../../../../server/community/model";
import type { ReportHistoryEntry } from "../../../../server/community/types";

export const REPORT_HISTORY_LABELS: Record<ReportHistoryEntry["action"], string> = {
  approved: "Mantido visível",
  hidden: "Ocultado",
  marked_spam: "Marcado como spam",
  restored: "Restaurado"
};

const RESOLUTION_VERBS: Record<ReportHistoryEntry["action"], string> = {
  approved: "comentário mantido",
  hidden: "comentário ocultado",
  marked_spam: "comentário marcado como spam",
  restored: "comentário restaurado"
};

/**
 * "Resolvida: comentário ocultado por Danilo, há 2 h", a partir da acao mais recente do historico
 * (o historico chega do mais novo para o mais antigo). Sem historico, null.
 */
export function describeReportResolution(history: readonly ReportHistoryEntry[], now: Date = new Date()) {
  const latest = history[0];

  if (!latest) {
    return null;
  }

  const actor = latest.actorName ? ` por ${latest.actorName}` : "";

  return `Resolvida: ${RESOLUTION_VERBS[latest.action]}${actor}, ${formatWaitingTime(latest.createdAt, now)}`;
}
