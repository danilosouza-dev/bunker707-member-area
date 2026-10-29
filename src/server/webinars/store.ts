// Linhas dos Webinarios no banco (docs/30 §4): leituras e escritas de uma linha pela service role, no desenho
// de src/server/communications/store.ts. Quem monta telas e regras e queries.ts/actions.ts (admin),
// student-queries.ts/registrations.ts (aluno) e reminders.ts (tick); aqui so o acesso as tabelas.

import "server-only";

import { WEBINAR_CHANGED_MESSAGE, WEBINAR_MISSING_MESSAGE, WebinarError, assertNoDbError, type WebinarsDb } from "./db";
import {
  PRESENTER_COLUMNS,
  RECORDING_COLUMNS,
  REGISTRATION_COLUMNS,
  SESSION_COLUMNS,
  WEBINAR_COLUMNS,
  type PresenterRow,
  type RecordingRow,
  type RegistrationRow,
  type SessionRow,
  type WebinarRow
} from "./rows";

const PAGE = 1000;

/** Le todas as linhas de uma consulta, pagina a pagina (o PostgREST corta em 1000). */
async function fetchAll<T>(run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string | null; hint?: string | null } | null }>, context: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    assertNoDbError(error, context);
    const part = data ?? [];
    rows.push(...part);
    if (part.length < PAGE) {
      return rows;
    }
  }
}

export async function fetchWebinarRow(db: WebinarsDb, id: string): Promise<WebinarRow | null> {
  const { data, error } = await db.from("webinars").select(WEBINAR_COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle();
  assertNoDbError(error, "Webinarios: ler webinario");
  return (data as WebinarRow | null) ?? null;
}

export async function fetchWebinarRowBySlug(db: WebinarsDb, slug: string): Promise<WebinarRow | null> {
  const { data, error } = await db.from("webinars").select(WEBINAR_COLUMNS).eq("slug", slug).is("deleted_at", null).maybeSingle();
  assertNoDbError(error, "Webinarios: ler webinario pelo endereco");
  return (data as WebinarRow | null) ?? null;
}

export async function requireWebinarRow(db: WebinarsDb, id: string): Promise<WebinarRow> {
  const row = await fetchWebinarRow(db, id);
  if (!row) {
    throw new WebinarError(WEBINAR_MISSING_MESSAGE, 404);
  }
  return row;
}

export type WebinarListFilter = {
  kind?: "live" | "simulated" | null;
  statuses?: readonly string[];
};

/** Todos os webinarios nao apagados (a lista do admin filtra e pagina em memoria: sao poucos). */
export async function listWebinarRows(db: WebinarsDb, filter: WebinarListFilter = {}): Promise<WebinarRow[]> {
  return fetchAll<WebinarRow>((from, to) => {
    let query = db.from("webinars").select(WEBINAR_COLUMNS).is("deleted_at", null);
    if (filter.kind) {
      query = query.eq("kind", filter.kind);
    }
    if (filter.statuses?.length) {
      query = query.in("status", [...filter.statuses]);
    }
    return query.order("created_at", { ascending: false }).range(from, to);
  }, "Webinarios: listar");
}

/** Os publicados (nao cancelados, nao apagados): a base do que o aluno pode ver. */
export async function listPublishedWebinarRows(db: WebinarsDb): Promise<WebinarRow[]> {
  return fetchAll<WebinarRow>(
    (from, to) => db.from("webinars").select(WEBINAR_COLUMNS).eq("status", "published").is("deleted_at", null).order("scheduled_at", { ascending: true }).range(from, to),
    "Webinarios: listar publicados"
  );
}

export type WebinarInsertRow = Omit<WebinarRow, "cancel_reason" | "cancelled_at" | "created_at" | "deleted_at" | "id" | "published_at" | "updated_at"> & {
  cancel_reason?: string | null;
  cancelled_at?: string | null;
  published_at?: string | null;
};

export async function insertWebinarRow(db: WebinarsDb, row: WebinarInsertRow): Promise<WebinarRow> {
  const { data, error } = await db.from("webinars").insert(row).select(WEBINAR_COLUMNS).single();
  assertNoDbError(error, "Webinarios: criar webinario");
  return data as WebinarRow;
}

export type WebinarRowPatch = Partial<Omit<WebinarRow, "created_at" | "id" | "updated_at">>;

/**
 * Atualiza uma linha com a guarda de versao (`updated_at` esperado) e, se pedido, de situacao. Nenhuma linha
 * atualizada: 404 se sumiu, 409 se mudou em outra tela.
 */
export async function updateWebinarRow(
  db: WebinarsDb,
  id: string,
  patch: WebinarRowPatch,
  guard: { expectedStatuses?: readonly string[]; expectedUpdatedAt?: string | null } = {}
): Promise<WebinarRow> {
  let query = db.from("webinars").update(patch).eq("id", id).is("deleted_at", null);
  if (guard.expectedUpdatedAt) {
    query = query.eq("updated_at", guard.expectedUpdatedAt);
  }
  if (guard.expectedStatuses?.length) {
    query = query.in("status", [...guard.expectedStatuses]);
  }
  const { data, error } = await query.select(WEBINAR_COLUMNS);
  assertNoDbError(error, "Webinarios: gravar webinario");
  const rows = (data ?? []) as WebinarRow[];
  if (rows.length === 1) {
    return rows[0]!;
  }
  const current = await fetchWebinarRow(db, id);
  throw new WebinarError(current ? WEBINAR_CHANGED_MESSAGE : WEBINAR_MISSING_MESSAGE, current ? 409 : 404);
}

export async function softDeleteWebinarRow(db: WebinarsDb, id: string, now: string): Promise<void> {
  const { error } = await db.from("webinars").update({ deleted_at: now }).eq("id", id).is("deleted_at", null);
  assertNoDbError(error, "Webinarios: excluir webinario");
}

export async function listSessionRows(db: WebinarsDb, webinarIds: readonly string[]): Promise<SessionRow[]> {
  if (webinarIds.length === 0) {
    return [];
  }
  return fetchAll<SessionRow>(
    (from, to) => db.from("webinar_sessions").select(SESSION_COLUMNS).in("webinar_id", [...webinarIds]).order("scheduled_at", { ascending: true }).range(from, to),
    "Webinarios: ler sessoes"
  );
}

export async function fetchSessionRow(db: WebinarsDb, id: string): Promise<SessionRow | null> {
  const { data, error } = await db.from("webinar_sessions").select(SESSION_COLUMNS).eq("id", id).maybeSingle();
  assertNoDbError(error, "Webinarios: ler sessao");
  return (data as SessionRow | null) ?? null;
}

/** Sessoes por situacao e janela de hora marcada (o tick dos lembretes e a lista "Em andamento"). */
export async function listSessionRowsBetween(
  db: WebinarsDb,
  input: { from: string; statuses: readonly string[]; to: string }
): Promise<SessionRow[]> {
  return fetchAll<SessionRow>(
    (from, to) =>
      db
        .from("webinar_sessions")
        .select(SESSION_COLUMNS)
        .in("status", [...input.statuses])
        .gte("scheduled_at", input.from)
        .lte("scheduled_at", input.to)
        .order("scheduled_at", { ascending: true })
        .range(from, to),
    "Webinarios: ler sessoes por hora"
  );
}

export type SessionInsertRow = {
  chat_mode?: string;
  chat_slow_mode_seconds?: number | null;
  kind: string;
  late_join_minutes?: number | null;
  recording_id?: string | null;
  /** Fase 3: a sala do Jitsi proprio, so na sessao `live` (gerada ao publicar, jitsi-token.newRoomName). */
  room_name?: string | null;
  scheduled_at: string;
  source_session_id?: string | null;
  status?: string;
  webinar_id: string;
};

export async function insertSessionRows(db: WebinarsDb, rows: readonly SessionInsertRow[]): Promise<SessionRow[]> {
  if (rows.length === 0) {
    return [];
  }
  const { data, error } = await db.from("webinar_sessions").insert([...rows]).select(SESSION_COLUMNS);
  assertNoDbError(error, "Webinarios: criar sessoes");
  return (data ?? []) as SessionRow[];
}

export type SessionRowPatch = Partial<Omit<SessionRow, "created_at" | "id" | "updated_at" | "webinar_id">>;

export async function updateSessionRow(db: WebinarsDb, id: string, patch: SessionRowPatch, guard: { expectedStatuses?: readonly string[] } = {}): Promise<SessionRow | null> {
  let query = db.from("webinar_sessions").update(patch).eq("id", id);
  if (guard.expectedStatuses?.length) {
    query = query.in("status", [...guard.expectedStatuses]);
  }
  const { data, error } = await query.select(SESSION_COLUMNS);
  assertNoDbError(error, "Webinarios: gravar sessao");
  const rows = (data ?? []) as SessionRow[];
  return rows[0] ?? null;
}

export async function deleteSessionRows(db: WebinarsDb, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const { error } = await db.from("webinar_sessions").delete().in("id", [...ids]);
  assertNoDbError(error, "Webinarios: apagar sessoes");
}

export async function listPresenterRows(db: WebinarsDb, webinarIds: readonly string[]): Promise<PresenterRow[]> {
  if (webinarIds.length === 0) {
    return [];
  }
  return fetchAll<PresenterRow>(
    (from, to) => db.from("webinar_presenters").select(PRESENTER_COLUMNS).in("webinar_id", [...webinarIds]).range(from, to),
    "Webinarios: ler apresentadores"
  );
}

/** Troca a lista inteira de apresentadores de um webinario. */
export async function replacePresenterRows(
  db: WebinarsDb,
  webinarId: string,
  rows: readonly { can_moderate_room: boolean; role: string; user_id: string }[]
): Promise<void> {
  const { error: deleteError } = await db.from("webinar_presenters").delete().eq("webinar_id", webinarId);
  assertNoDbError(deleteError, "Webinarios: limpar apresentadores");
  if (rows.length === 0) {
    return;
  }
  const { error } = await db.from("webinar_presenters").insert(rows.map((row) => ({ ...row, webinar_id: webinarId })));
  assertNoDbError(error, "Webinarios: gravar apresentadores");
}

export async function listRecordingRows(db: WebinarsDb, webinarIds: readonly string[]): Promise<RecordingRow[]> {
  if (webinarIds.length === 0) {
    return [];
  }
  return fetchAll<RecordingRow>(
    (from, to) => db.from("webinar_recordings").select(RECORDING_COLUMNS).in("webinar_id", [...webinarIds]).order("created_at", { ascending: false }).range(from, to),
    "Webinarios: ler gravacoes"
  );
}

export type RecordingInsertRow = {
  anchor_offset_ms?: number;
  bunny_library_id?: string | null;
  bunny_video_id?: string | null;
  duration_seconds?: number | null;
  embed_url?: string | null;
  file_name?: string | null;
  provider?: string;
  session_id?: string | null;
  source?: string;
  status?: string;
  webinar_id: string;
};

export async function insertRecordingRow(db: WebinarsDb, row: RecordingInsertRow): Promise<RecordingRow> {
  const { data, error } = await db.from("webinar_recordings").insert(row).select(RECORDING_COLUMNS).single();
  assertNoDbError(error, "Webinarios: gravar video");
  return data as RecordingRow;
}

export async function updateRecordingRow(db: WebinarsDb, id: string, patch: Partial<Omit<RecordingRow, "created_at" | "id" | "updated_at" | "webinar_id">>): Promise<RecordingRow | null> {
  const { data, error } = await db.from("webinar_recordings").update(patch).eq("id", id).select(RECORDING_COLUMNS);
  assertNoDbError(error, "Webinarios: atualizar video");
  const rows = (data ?? []) as RecordingRow[];
  return rows[0] ?? null;
}

export async function deleteRecordingRows(db: WebinarsDb, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const { error } = await db.from("webinar_recordings").delete().in("id", [...ids]);
  assertNoDbError(error, "Webinarios: apagar video");
}

/** A vaga de um aluno num webinario (sessao especifica ou a vaga geral, session_id nulo). */
export async function fetchRegistrationRows(db: WebinarsDb, input: { userId: string; webinarIds: readonly string[] }): Promise<RegistrationRow[]> {
  if (input.webinarIds.length === 0) {
    return [];
  }
  return fetchAll<RegistrationRow>(
    (from, to) => db.from("webinar_registrations").select(REGISTRATION_COLUMNS).eq("user_id", input.userId).in("webinar_id", [...input.webinarIds]).range(from, to),
    "Webinarios: ler vagas do aluno"
  );
}

export async function fetchRegistrationRowByToken(db: WebinarsDb, calendarToken: string): Promise<RegistrationRow | null> {
  const { data, error } = await db.from("webinar_registrations").select(REGISTRATION_COLUMNS).eq("calendar_token", calendarToken).maybeSingle();
  assertNoDbError(error, "Webinarios: ler vaga pelo token");
  return (data as RegistrationRow | null) ?? null;
}

/** As vagas garantidas de uma sessao (session_id igual, ou nulo = vale para a sessao unica do webinario). */
export async function listSessionRegistrationRows(db: WebinarsDb, session: { id: string; webinar_id: string }, statuses: readonly string[] = ["registered"]): Promise<RegistrationRow[]> {
  return fetchAll<RegistrationRow>(
    (from, to) =>
      db
        .from("webinar_registrations")
        .select(REGISTRATION_COLUMNS)
        .eq("webinar_id", session.webinar_id)
        .in("status", [...statuses])
        .or(`session_id.eq.${session.id},session_id.is.null`)
        .order("registered_at", { ascending: true })
        .range(from, to),
    "Webinarios: ler vagas da sessao"
  );
}

export async function countSessionRegistrations(db: WebinarsDb, session: { id: string; webinar_id: string }): Promise<number> {
  const { count, error } = await db
    .from("webinar_registrations")
    .select("id", { count: "exact", head: true })
    .eq("webinar_id", session.webinar_id)
    .eq("status", "registered")
    .or(`session_id.eq.${session.id},session_id.is.null`);
  assertNoDbError(error, "Webinarios: contar vagas");
  return count ?? 0;
}

/** Quantas vagas garantidas cada webinario tem (lista do admin e numeros do periodo). */
export async function countRegistrationsByWebinar(db: WebinarsDb, webinarIds: readonly string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (webinarIds.length === 0) {
    return counts;
  }
  const rows = await fetchAll<{ webinar_id: string }>(
    (from, to) => db.from("webinar_registrations").select("webinar_id").in("webinar_id", [...webinarIds]).eq("status", "registered").range(from, to),
    "Webinarios: contar vagas por webinario"
  );
  for (const row of rows) {
    counts.set(row.webinar_id, (counts.get(row.webinar_id) ?? 0) + 1);
  }
  return counts;
}

export type RegistrationUpsert = {
  session_id: string | null;
  source?: string | null;
  source_campaign_id?: string | null;
  user_id: string;
  webinar_id: string;
};

/**
 * Garantir vaga: uma linha por aluno e sessao (indice unico da 202610280001). Repetir devolve a linha que ja
 * existia (uma vaga cancelada volta a valer). `created` diz se a vaga e nova.
 */
export async function upsertRegistrationRow(db: WebinarsDb, input: RegistrationUpsert, now: string): Promise<{ created: boolean; row: RegistrationRow }> {
  const existing = await findRegistrationRow(db, input);
  if (existing) {
    if (existing.status === "registered") {
      return { created: false, row: existing };
    }
    const { data, error } = await db
      .from("webinar_registrations")
      .update({ cancelled_at: null, registered_at: now, reminder_1h_sent_at: null, reminder_24h_sent_at: null, source: input.source ?? existing.source, status: "registered" })
      .eq("id", existing.id)
      .select(REGISTRATION_COLUMNS)
      .single();
    assertNoDbError(error, "Webinarios: reativar vaga");
    return { created: true, row: data as RegistrationRow };
  }
  const { data, error } = await db
    .from("webinar_registrations")
    .insert({ registered_at: now, session_id: input.session_id, source: input.source ?? null, source_campaign_id: input.source_campaign_id ?? null, status: "registered", user_id: input.user_id, webinar_id: input.webinar_id })
    .select(REGISTRATION_COLUMNS)
    .single();
  if (error && error.code === "23505") {
    const again = await findRegistrationRow(db, input);
    if (again) {
      return { created: false, row: again };
    }
  }
  assertNoDbError(error, "Webinarios: garantir vaga");
  return { created: true, row: data as RegistrationRow };
}

async function findRegistrationRow(db: WebinarsDb, input: { session_id: string | null; user_id: string; webinar_id: string }): Promise<RegistrationRow | null> {
  let query = db.from("webinar_registrations").select(REGISTRATION_COLUMNS).eq("webinar_id", input.webinar_id).eq("user_id", input.user_id);
  query = input.session_id ? query.eq("session_id", input.session_id) : query.is("session_id", null);
  const { data, error } = await query.maybeSingle();
  assertNoDbError(error, "Webinarios: ler vaga");
  return (data as RegistrationRow | null) ?? null;
}

/**
 * Cancela a vaga ativa; `changed` diz se foi esta chamada que cancelou (a vaga ja cancelada volta como esta, com
 * changed false). A troca so vale para a linha ainda `registered`: duas chamadas juntas, uma muda.
 */
export async function cancelRegistrationRow(
  db: WebinarsDb,
  input: { session_id: string | null; user_id: string; webinar_id: string },
  now: string
): Promise<{ changed: boolean; row: RegistrationRow | null }> {
  const existing = await findRegistrationRow(db, input);
  if (!existing || existing.status !== "registered") {
    return { changed: false, row: existing };
  }
  const { data, error } = await db
    .from("webinar_registrations")
    .update({ cancelled_at: now, status: "cancelled" })
    .eq("id", existing.id)
    .eq("status", "registered")
    .select(REGISTRATION_COLUMNS)
    .maybeSingle();
  assertNoDbError(error, "Webinarios: cancelar vaga");
  return data ? { changed: true, row: data as RegistrationRow } : { changed: false, row: await findRegistrationRow(db, input) };
}

/**
 * Marca um lembrete como enviado so se ainda nao estava (a idempotencia do tick): devolve true quando esta
 * chamada foi a que marcou.
 */
export async function markRegistrationSent(
  db: WebinarsDb,
  registrationId: string,
  column: "cancelled_notice_sent_at" | "reminder_1h_sent_at" | "reminder_24h_sent_at" | "started_notice_sent_at",
  now: string
): Promise<boolean> {
  const { data, error } = await db.from("webinar_registrations").update({ [column]: now }).eq("id", registrationId).is(column, null).select("id");
  assertNoDbError(error, "Webinarios: marcar lembrete");
  return (data ?? []).length === 1;
}

export type WebinarReportRow = { item: string; metric: string; students: number; total: number };

function toNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export async function fetchWebinarReport(db: WebinarsDb, sessionId: string): Promise<WebinarReportRow[]> {
  const { data, error } = await db.rpc("webinar_report", { p_session_id: sessionId });
  assertNoDbError(error, "Webinarios: relatorio");
  return ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map((row) => ({
    item: typeof row.item === "string" ? row.item : String(row.item ?? ""),
    metric: typeof row.metric === "string" ? row.metric : String(row.metric ?? ""),
    students: toNumber(row.students),
    total: toNumber(row.total)
  }));
}
