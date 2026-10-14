import "server-only";

// Grava a atividade real do aluno (student_daily_activity) depois que o progresso da aula foi
// confirmado no banco. Chamado pelo platform-store; falha aqui so vira log (nunca derruba o progresso).

import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { hasActivity, type ActivityDelta } from "./activity-delta";

export async function recordStudentActivity(input: { contentId: string; delta: ActivityDelta; userId: string }) {
  if (!hasActivity(input.delta)) {
    return;
  }

  try {
    const { error } = await getSupabaseAdminClient().rpc("record_student_activity", {
      p_completed: input.delta.completed,
      p_content_id: input.contentId,
      p_seconds: input.delta.seconds,
      p_user_id: input.userId
    });

    if (error) {
      console.error(`[atividade] nao gravada para ${input.userId}: ${error.message}`);
    }
  } catch (error) {
    console.error(`[atividade] nao gravada para ${input.userId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
