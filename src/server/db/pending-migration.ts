// Banco sem as migracoes do admin v2 (fase 1: 202610110010, 202610110011, 202610110012 e 202610110020).
//
// O deploy pode sair antes da migracao. A area do aluno e o admin legado nao dependem das colunas,
// tabelas e funcoes novas; as telas novas do admin dependem. Quando uma leitura delas esbarra em algo
// que ainda nao existe no banco, a camada de dados lanca PendingMigrationError e a pagina mostra
// <PendingMigrationNotice /> em vez de cair na tela de erro.
//
// Modulo puro (sem "server-only") para os testes rodarem com node --test.

import { INVALID_SUPABASE_KEY_MESSAGE, isInvalidSupabaseKeyError } from "./supabase-key-error";
import { redactSecrets } from "../../lib/env-value";

export const PENDING_MIGRATION_RANGE = "202610110010-202610170008";
export const PENDING_MIGRATION_MESSAGE = `Esta tela precisa da atualização do banco (migrações ${PENDING_MIGRATION_RANGE}).`;

/**
 * Codigos do Postgres e do PostgREST para "objeto ainda nao existe":
 * 42703 coluna, 42P01 tabela/view, 42883 funcao (assinatura), PGRST202 funcao fora do cache,
 * PGRST204 coluna fora do cache, PGRST205 tabela fora do cache.
 */
const MISSING_OBJECT_CODES = new Set(["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"]);

type DbErrorLike = { code?: string | null; message?: string | null } | null | undefined;

export function isMissingSchemaObjectError(error: DbErrorLike) {
  if (!error) {
    return false;
  }

  if (error.code && MISSING_OBJECT_CODES.has(error.code)) {
    return true;
  }

  const message = error.message ?? "";

  return (
    /\b(column|relation|function)\b[^\n]*\bdoes not exist\b/i.test(message) ||
    /Could not find the (function|table|column)\b/i.test(message)
  );
}

export class PendingMigrationError extends Error {
  readonly context: string;

  constructor(context: string, cause?: string) {
    super(`${context}: banco sem a migracao ${PENDING_MIGRATION_RANGE}${cause ? ` (${cause})` : ""}`);
    this.name = "PendingMigrationError";
    this.context = context;
  }
}

export function isPendingMigrationError(error: unknown): error is PendingMigrationError {
  return error instanceof PendingMigrationError || (error instanceof Error && error.name === "PendingMigrationError");
}

/** Converte o erro do banco: objeto inexistente vira PendingMigrationError; o resto, Error comum. */
export function toDbError(error: { code?: string | null; hint?: string | null; message: string }, context: string): Error {
  if (isInvalidSupabaseKeyError(error)) {
    return new Error(`${context}: ${INVALID_SUPABASE_KEY_MESSAGE}`);
  }

  if (isMissingSchemaObjectError(error)) {
    return new PendingMigrationError(context, redactSecrets(error.message));
  }

  return new Error(`${context}: ${redactSecrets(error.message)}`);
}

export type PendingMigrationResult<T> = { data: T; ok: true } | { ok: false; pendingMigration: true };

/**
 * Carrega os dados da pagina; se o banco ainda nao tem a migracao, devolve { ok: false } para a
 * pagina mostrar o aviso. Qualquer outro erro (inclusive notFound/redirect) segue adiante.
 */
export async function loadUnlessPendingMigration<T>(load: () => Promise<T>): Promise<PendingMigrationResult<T>> {
  try {
    return { data: await load(), ok: true };
  } catch (error) {
    if (isPendingMigrationError(error)) {
      console.error("[admin] Migracao pendente:", error.message);
      return { ok: false, pendingMigration: true };
    }

    throw error;
  }
}
