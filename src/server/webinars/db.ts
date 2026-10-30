// Acesso ao banco dos Webinarios (docs/30): o mesmo desenho de src/server/communications/db.ts. Tudo pela
// service role; o aluno nunca le nem grava as tabelas webinar_* direto (so pelas rotas e Server Actions).

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "../db/supabase/client";
import { isMissingSchemaObjectError, toDbError } from "../db/pending-migration";

export type WebinarsDb = SupabaseClient;

/**
 * A migracao que o aviso de migracao pendente manda aplicar (PendingMigrationNotice e a mensagem do tick): a mais nova
 * dos webinarios, que o app exige antes de abrir (aplicar ate ela inclui todas as de antes). A fase 1 foi a
 * 202610280001, a fase 2 a 202610290001, a fase 3 (sala ao vivo: room_name, gravador, banimentos, ancora) a
 * 202610290002 com os ajustes da revisao na 202610290003 (a maquina na chave do webhook do gravador, a gravacao no
 * navegador na sessao e o trigger do offset pela ancora). A 202610300001 ("Quem pode" por regras) traz
 * webinars.audience_restricts, que WEBINAR_COLUMNS le em toda leitura de webinario, e a fase 4 le
 * webinar_sessions.jit em toda leitura de sessao (SESSION_COLUMNS), da 202610300005: sem qualquer uma das duas, tudo
 * aqui cai no aviso de migracao pendente. As migracoes da fase 4 vem depois da 202610300001, em ordem e sem buraco
 * (202610300002 a 202610300007: 4a, 4b, 4c, 4e, 4f e os ajustes da revisao; a 4d, Sala Live vertical, nao tem dado
 * novo nem migracao), aplicadas na nuvem de teste antes do merge (docs/21 §9.10). A 202610300007 e a mais
 * nova: os numeros da revisao (quem viu a oferta congelado, a venda reembolsada fora) so saem com ela, entao o aviso a
 * aponta. Cada parte da fase 4 tem a propria constante abaixo, para o aviso de migracao pendente apontar a certa onde
 * so aquela parte falta.
 */
export const WEBINARS_MIGRATION = "202610300007";

/** 4a: webinar_panel (os paineis Lives ao vivo e Lives gravadas e os numeros da lista). */
export const WEBINARS_PANELS_MIGRATION = "202610300002";

/** 4b: a Oferta (webinar_offers*, webinar_offer_clicks), a receita (webhook_events.amount_cents), o follow-up e a Simulacao completa. */
export const WEBINARS_OFFERS_MIGRATION = "202610300003";

/** 4c: o Assistente de IA, os atendentes e o modo hibrido. */
export const WEBINARS_ASSISTANT_MIGRATION = "202610300004";

/** 4e: "Comeca quando voce entra" (webinars.jit_settings, webinar_sessions.jit, a turma do dia no chat). */
export const WEBINARS_JIT_MIGRATION = "202610300005";

/** 4f: a traducao do chat e do roteiro (webinar_viewer_prefs, webinar_text_translations). */
export const WEBINARS_TRANSLATION_MIGRATION = "202610300006";

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
