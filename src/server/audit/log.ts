import "server-only";

import type { getSupabaseAdminClient } from "@/server/db/supabase/client";

// Registro de auditoria do admin (docs/17 §2.3, tabela admin_audit_log, migracao 202610150001):
// acesso de alunos, exportacao, importacao, exclusao e mudancas na equipe. O servidor so insere e le;
// ninguem altera nem apaga o rastro.

type AuditDb = ReturnType<typeof getSupabaseAdminClient>;

export type AuditInsert = {
  action: string;
  actorId: string | null;
  count?: number | null;
  entityId?: string | null;
  entityType?: string | null;
  /** So ids e contagens; nunca nome, e-mail (exceto a prova da exclusao) ou texto digitado. */
  metadata?: Record<string, unknown>;
};

/** Grava uma linha (append-only). Falha vira log: a acao ja aconteceu. */
export async function recordAudit(db: AuditDb, entry: AuditInsert) {
  const { error } = await db.from("admin_audit_log").insert({
    action: entry.action,
    actor_id: entry.actorId,
    count: entry.count ?? null,
    entity_id: entry.entityId ?? null,
    entity_type: entry.entityType ?? null,
    metadata: entry.metadata ?? {}
  });

  if (error) {
    console.error(`[auditoria] ${entry.action} nao gravada: ${error.message}`);
  }
}
