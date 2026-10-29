// Acesso ao banco dos Webinarios (docs/30): o mesmo desenho de src/server/communications/db.ts. Tudo pela
// service role; o aluno nunca le nem grava as tabelas webinar_* direto (so pelas rotas e Server Actions).

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "../db/supabase/client";
import { isMissingSchemaObjectError, toDbError } from "../db/pending-migration";

export type WebinarsDb = SupabaseClient;

/**
 * A migracao mais nova que o app exige (PendingMigrationNotice e a mensagem do tick): a fase 1 foi a 202610280001, a
 * fase 2 a 202610290001 e a fase 3 (sala ao vivo: room_name, gravador, banimentos, ancora) a 202610290002, com os
 * ajustes da revisao na 202610290003 (a maquina na chave do webhook do gravador, a gravacao no navegador na sessao e o
 * trigger do offset pela ancora). A 202610300001 ("Quem pode" por regras) traz webinars.audience_restricts, que
 * WEBINAR_COLUMNS le em toda leitura de webinario: sem ela, tudo aqui cai no aviso de migracao pendente.
 */
export const WEBINARS_MIGRATION = "202610300001";

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
