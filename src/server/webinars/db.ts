// Acesso ao banco dos Webinarios (docs/30): o mesmo desenho de src/server/communications/db.ts. Tudo pela
// service role; o aluno nunca le nem grava as tabelas webinar_* direto (so pelas rotas e Server Actions).

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "../db/supabase/client";
import { isMissingSchemaObjectError, toDbError } from "../db/pending-migration";

export type WebinarsDb = SupabaseClient;

/** A migracao que esta fase exige (PendingMigrationNotice e a mensagem do tick). */
export const WEBINARS_MIGRATION = "202610280001";

export function webinarsDb(): WebinarsDb {
  return getSupabaseAdminClient();
}

export class WebinarError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "WebinarError";
    this.status = status;
  }
}

/** Erro de um campo na hora de publicar (mesma forma de um ZodError: a tela mostra junto do campo). */
export class WebinarFieldError extends Error {
  issues: { message: string; path: string[] }[];

  constructor(path: string, message: string) {
    super(message);
    this.name = "ZodError";
    this.issues = [{ message, path: path.split(".") }];
  }
}

type DbError = { code?: string | null; details?: string | null; hint?: string | null; message: string } | null;

export function assertNoDbError(error: DbError, context: string): asserts error is null {
  if (error) {
    throw toDbError(error, context);
  }
}

export function isMissingWebinarSchema(error: unknown) {
  return isMissingSchemaObjectError(error as Parameters<typeof isMissingSchemaObjectError>[0]);
}

export const WEBINAR_MISSING_MESSAGE = "Esse webinário não existe mais.";
export const WEBINAR_CHANGED_MESSAGE = "Esse webinário mudou em outra tela. Recarregue a página e tente de novo.";
