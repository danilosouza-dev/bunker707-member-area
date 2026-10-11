import "server-only";

// Contador do menu (Comunidade) e do alerta de Hoje: perguntas de alunos sem resposta ha mais de
// 24 h (docs/17 §1.11). Uma RPC de contagem, sem ler comentarios. A integracao chama dentro de
// try/catch e cai para "sem contador" se falhar.

import { assertNoDbError, communityDb } from "./db";
import { toCount } from "./mappers";
import { UNANSWERED_ALERT_HOURS } from "./model";
import type { CountOverdueQuestions } from "./types";

export const countOverdueQuestions: CountOverdueQuestions = async () => {
  const result = await communityDb().rpc("community_overdue_count", { p_hours: UNANSWERED_ALERT_HOURS });
  assertNoDbError(result.error, "Comunidade: perguntas atrasadas");

  return toCount(Array.isArray(result.data) ? result.data[0] : result.data);
};
