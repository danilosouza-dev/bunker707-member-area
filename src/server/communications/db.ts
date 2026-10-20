import "server-only";

// Acesso ao banco da Comunicacao (avisos, sino do aluno e pop-ups; docs/22). Cliente de servico: as
// tabelas campaigns, notifications e campaign_deliveries nao tem politica para o navegador (migracao
// 202610200001); quem chama ja conferiu a sessao (rotas do aluno) ou a permissao (Server Actions do admin).

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchemaObjectError, toDbError } from "@/server/db/pending-migration";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";

export type CommunicationsDb = SupabaseClient;

export function communicationsDb(): CommunicationsDb {
  return getSupabaseAdminClient();
}

/** Erro de dominio com status HTTP; toActionError e jsonRouteError mostram esta mensagem. */
export class CommunicationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "CommunicationError";
    this.status = status;
  }
}

/**
 * Erro de um campo do editor (mesmo formato do zod): toActionError devolve 400 com fieldErrors[path].
 * Usado nas regras que so valem na hora de publicar (data no futuro).
 */
export class NoticeFieldError extends Error {
  issues: { message: string; path: string[] }[];

  constructor(path: string, message: string) {
    super(message);
    this.name = "ZodError";
    this.issues = [{ message, path: path.split(".") }];
  }
}

type DbError = { code?: string | null; hint?: string | null; message: string } | null;

/** Erro de banco: objeto inexistente vira PendingMigrationError (a tela mostra o aviso da migracao). */
export function assertNoDbError(error: DbError, context: string) {
  if (error) {
    throw toDbError(error, context);
  }
}

/** Banco sem a migracao 202610200001 (tabelas ou funcoes da Comunicacao ainda nao existem). */
export function isMissingCommunicationSchema(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: string | null; message?: string | null; name?: string };

  return candidate.name === "PendingMigrationError" || isMissingSchemaObjectError(candidate);
}

/** Divide uma lista em lotes (filtros `in` vao na URL; inserts grandes vao em partes). */
export function chunksOf<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

/** Mensagem curta de erro para gravar em last_error ou no log (sem segredos). */
export function describeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return message.slice(0, 2_000);
}
