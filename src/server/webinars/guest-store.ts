import "server-only";

// As leituras e escritas do link aberto (docs/30 §14; migracao 202611190001): a tabela webinar_guests (quem entrou
// pelo link) e a marca profiles.is_guest. Tudo pela service role. Banco sem a migracao: a leitura do convidado da
// pessoa devolve nulo (ninguem e convidado; o app segue como antes) e as escritas lancam PendingMigrationError.

import { isPendingMigrationError, toDbError } from "../db/pending-migration";
import { isMissingWebinarSchema, type WebinarsDb } from "./db";

export const GUEST_COLUMNS = "id, webinar_id, user_id, full_name, email, phone, consent_text, consent_at, source, created_at";

export type GuestRow = {
  consent_at: string | null;
  consent_text: string | null;
  created_at: string;
  email: string | null;
  full_name: string | null;
  id: string;
  phone: string | null;
  source: string | null;
  user_id: string | null;
  webinar_id: string;
};

function missing(error: unknown) {
  return isPendingMigrationError(error) || isMissingWebinarSchema(error);
}

/** O webinario de que a pessoa e convidada (nulo para aluno e equipe, ou com o banco sem a migracao). */
export async function fetchGuestWebinarId(db: WebinarsDb, userId: string): Promise<string | null> {
  try {
    const { data, error } = await db.from("webinar_guests").select("webinar_id").eq("user_id", userId).maybeSingle();

    if (error) {
      throw toDbError(error, "Webinarios: convidado");
    }

    return (data as { webinar_id: string } | null)?.webinar_id ?? null;
  } catch (error) {
    if (missing(error)) {
      return null;
    }
    throw error;
  }
}

/** Quem destas pessoas e convidado do link aberto (os avisos de quem tem vaga deixam de fora; vazio sem a migracao). */
export async function fetchGuestUserIds(db: WebinarsDb, userIds: readonly string[]): Promise<Set<string>> {
  const guests = new Set<string>();

  for (let index = 0; index < userIds.length; index += 150) {
    const part = userIds.slice(index, index + 150);

    try {
      const { data, error } = await db.from("profiles").select("id").in("id", part).eq("is_guest", true);

      if (error) {
        throw toDbError(error, "Webinarios: convidados");
      }

      for (const row of (data ?? []) as { id: string }[]) {
        guests.add(row.id);
      }
    } catch (error) {
      if (missing(error)) {
        return guests;
      }
      throw error;
    }
  }

  return guests;
}

export type GuestInsert = {
  consentText: string | null;
  email: string | null;
  fullName: string | null;
  phone: string | null;
  source: string | null;
  userId: string;
  webinarId: string;
};

export async function insertGuestRow(db: WebinarsDb, input: GuestInsert, now: Date): Promise<void> {
  const { error } = await db.from("webinar_guests").insert({
    consent_at: input.consentText ? now.toISOString() : null,
    consent_text: input.consentText,
    email: input.email,
    full_name: input.fullName,
    phone: input.phone,
    source: input.source,
    user_id: input.userId,
    webinar_id: input.webinarId
  });

  if (error) {
    throw toDbError(error, "Webinarios: entrada pelo link");
  }
}

/**
 * O perfil do convidado: a marca, o nome do chat e o e-mail de contato (o que a pessoa deu, para os avisos da live com
 * o e-mail ligado no webinario; sem e-mail, nulo, e nenhum e-mail sai).
 */
export async function markGuestProfile(db: WebinarsDb, input: { email: string | null; fullName: string; phone: string | null; userId: string }): Promise<void> {
  const { error } = await db
    .from("profiles")
    .upsert({ email: input.email, full_name: input.fullName, id: input.userId, is_guest: true, phone: input.phone }, { onConflict: "id" });

  if (error) {
    throw toDbError(error, "Webinarios: perfil do convidado");
  }
}

/** Quantas pessoas entraram pelo link deste webinario (o teto de entradas). */
export async function countGuestRows(db: WebinarsDb, webinarId: string): Promise<number> {
  const { count, error } = await db.from("webinar_guests").select("id", { count: "exact", head: true }).eq("webinar_id", webinarId);

  if (error) {
    throw toDbError(error, "Webinarios: contagem do link");
  }

  return count ?? 0;
}

/** Quem entrou pelo link deste webinario, do mais novo ao mais antigo (a lista e o CSV da equipe). */
export async function listGuestRows(db: WebinarsDb, webinarId: string, limit = 20_000): Promise<GuestRow[]> {
  const rows: GuestRow[] = [];
  const page = 1000;

  for (let from = 0; from < limit; from += page) {
    const { data, error } = await db
      .from("webinar_guests")
      .select(GUEST_COLUMNS)
      .eq("webinar_id", webinarId)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, Math.min(from + page, limit) - 1);

    if (error) {
      throw toDbError(error, "Webinarios: lista do link");
    }

    const batch = (data ?? []) as GuestRow[];
    rows.push(...batch);

    if (batch.length < page) {
      break;
    }
  }

  return rows;
}
