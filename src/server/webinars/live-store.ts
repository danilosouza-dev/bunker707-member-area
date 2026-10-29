// As tabelas e colunas da fase 3 no banco (202610290002), pela service role, no desenho de store.ts e chat-store.ts:
// o nome da sala, a situacao do gravador (sempre com a situacao esperada: duas chamadas juntas nao passam as duas),
// a ancora pela RPC webinar_mark_recording_anchor, os banimentos (sessao e todos os webinarios), o webhook bruto do
// gravador (idempotente pela chave unica) e as leituras do job das gravacoes. Quem monta regras e respostas e
// live-model.ts/recorder-model.ts (puros), as rotas da sala, o webhook, o job e as Server Actions do console; aqui so o
// acesso as linhas. Banco sem a 202610290002: o erro sobe como PendingMigrationError (assertNoDbError).

import "server-only";

import { WebinarError, assertNoDbError, type WebinarsDb } from "./db";
import { newRoomName } from "./jitsi-token";
import type { RecorderState } from "./live-schemas";
import type { RecorderStatus } from "./recorder-model";
import {
  RECORDING_COLUMNS,
  RECORDING_EVENT_COLUMNS,
  SESSION_BAN_COLUMNS,
  SESSION_COLUMNS,
  USER_BAN_COLUMNS,
  type RecordingEventRow,
  type RecordingEventStatus,
  type RecordingRow,
  type SessionBanRow,
  type SessionRow,
  type UserBanRow
} from "./rows";
import { fetchSessionRow } from "./store";

const SESSION_MISSING_MESSAGE = "Essa sessão não existe mais.";

/* ------------------------------------------------------------------------------------------------
 * A sala e o gravador na sessao
 * ---------------------------------------------------------------------------------------------- */

/**
 * O nome da sala da sessao `live`: o que ja existe, ou um novo gravado agora so se ainda estiver vazio (duas chamadas
 * juntas ficam com o mesmo nome: a segunda rele). Gerado ao publicar (actions.ts) e garantido aqui ao abrir a sala e
 * no join-token. Sessao que nao e `live`: erro 409 (a gravada e o replay nao tem sala).
 */
export async function ensureSessionRoomName(db: WebinarsDb, session: Pick<SessionRow, "id" | "kind" | "room_name" | "webinar_id">): Promise<string> {
  if (session.room_name) {
    return session.room_name;
  }
  if (session.kind !== "live") {
    throw new WebinarError("Só a Live ao vivo tem sala.", 409);
  }
  const { data, error } = await db
    .from("webinar_sessions")
    .update({ room_name: newRoomName(session.webinar_id) })
    .eq("id", session.id)
    .is("room_name", null)
    .select("room_name");
  assertNoDbError(error, "Webinarios: gerar o nome da sala");
  const written = ((data ?? []) as { room_name: string | null }[])[0]?.room_name;
  if (written) {
    return written;
  }
  const current = await fetchSessionRow(db, session.id);
  if (!current?.room_name) {
    throw new WebinarError(SESSION_MISSING_MESSAGE, 404);
  }
  return current.room_name;
}

export type SessionLivePatch = Partial<
  Pick<
    SessionRow,
    | "browser_recording_at"
    | "recorder_alerted_at"
    | "recorder_release_requested_at"
    | "recorder_requested_at"
    | "recorder_status"
    | "recording_id"
    | "recording_requested_at"
    | "room_locked"
    | "status"
  >
>;

/**
 * Muda a situacao do gravador (e o que vem junto) so se ela ainda for uma das esperadas: devolve a linha nova, ou nulo
 * quando outra chamada mudou antes (a transicao fica para quem chegou primeiro; o webhook marca o pedido como ignored).
 */
export async function updateRecorderStatus(
  db: WebinarsDb,
  sessionId: string,
  input: { expected: readonly RecorderStatus[]; patch?: SessionLivePatch; to: RecorderStatus }
): Promise<SessionRow | null> {
  const { data, error } = await db
    .from("webinar_sessions")
    .update({ ...input.patch, recorder_status: input.to })
    .eq("id", sessionId)
    .eq("kind", "live")
    .in("recorder_status", [...input.expected])
    .select(SESSION_COLUMNS);
  assertNoDbError(error, "Webinarios: gravar a situacao do gravador");
  return ((data ?? []) as SessionRow[])[0] ?? null;
}

/** Grava colunas da fase 3 na sessao `live` (sala trancada, "Gravar" na fila, aviso de 6 h, devolucao pedida). */
export async function updateLiveSession(db: WebinarsDb, sessionId: string, patch: SessionLivePatch): Promise<SessionRow | null> {
  const { data, error } = await db.from("webinar_sessions").update(patch).eq("id", sessionId).eq("kind", "live").select(SESSION_COLUMNS);
  assertNoDbError(error, "Webinarios: gravar a sala ao vivo");
  return ((data ?? []) as SessionRow[])[0] ?? null;
}

export type AnchorOutcome = { anchor: string | null; changed: boolean; reason: "already" | "not_live" | null; rebased: number; recorderStatus: RecorderStatus };

/**
 * A ancora uma vez, pela hora do servidor (docs/30 §6.5): a RPC grava recording_anchor_at, poe o gravador em
 * `recording`, tira o "Gravar" da fila e recalcula pela ancora o offset do que a sessao ja tinha. Sessao inexistente: 404.
 */
export async function markRecordingAnchorRpc(db: WebinarsDb, sessionId: string, nowIso: string): Promise<AnchorOutcome> {
  const { data, error } = await db.rpc("webinar_mark_recording_anchor", { p_now: nowIso, p_session_id: sessionId });
  if (error?.code === "P0002") {
    throw new WebinarError(SESSION_MISSING_MESSAGE, 404);
  }
  assertNoDbError(error, "Webinarios: marcar a ancora da gravacao");
  const raw = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const reason = raw.reason === "already" || raw.reason === "not_live" ? raw.reason : null;
  return {
    anchor: typeof raw.anchor === "string" ? raw.anchor : null,
    changed: raw.changed === true,
    reason,
    rebased: Number(raw.rebased ?? 0) || 0,
    recorderStatus: (typeof raw.recorderStatus === "string" ? raw.recorderStatus : "none") as RecorderStatus
  };
}

/** As sessoes `live` por situacao do gravador (o job das gravacoes: pedir, avisar 6 h, devolver). */
export async function listLiveSessionsByRecorder(db: WebinarsDb, statuses: readonly RecorderStatus[]): Promise<SessionRow[]> {
  const { data, error } = await db
    .from("webinar_sessions")
    .select(SESSION_COLUMNS)
    .eq("kind", "live")
    .in("recorder_status", [...statuses])
    .order("scheduled_at", { ascending: true })
    .limit(200);
  assertNoDbError(error, "Webinarios: ler as sessoes pelo gravador");
  return (data ?? []) as SessionRow[];
}

/* ------------------------------------------------------------------------------------------------
 * Banimentos
 * ---------------------------------------------------------------------------------------------- */

/** As linhas do aluno nesta sessao (removido, silenciado) e o banimento de todos os webinarios. */
export async function fetchStudentBans(db: WebinarsDb, input: { sessionId: string; userId: string }): Promise<{ sessionBans: SessionBanRow[]; userBan: UserBanRow | null }> {
  const [session, user] = await Promise.all([
    db.from("webinar_session_bans").select(SESSION_BAN_COLUMNS).eq("session_id", input.sessionId).eq("user_id", input.userId),
    db.from("webinar_user_bans").select(USER_BAN_COLUMNS).eq("user_id", input.userId).maybeSingle()
  ]);
  assertNoDbError(session.error, "Webinarios: ler os banimentos da sessao");
  assertNoDbError(user.error, "Webinarios: ler o banimento do aluno");
  return { sessionBans: (session.data ?? []) as SessionBanRow[], userBan: (user.data as UserBanRow | null) ?? null };
}

/**
 * So o banimento de todos os webinarios (uma leitura pela chave): vale na Live gravada e no Replay tambem (docs/30
 * §1.4 e D33); removido e silenciado sao da sessao `live` e nao contam fora dela.
 */
export async function fetchUserBan(db: WebinarsDb, userId: string): Promise<UserBanRow | null> {
  const { data, error } = await db.from("webinar_user_bans").select(USER_BAN_COLUMNS).eq("user_id", userId).maybeSingle();
  assertNoDbError(error, "Webinarios: ler o banimento do aluno");
  return (data as UserBanRow | null) ?? null;
}

/** Todos os removidos e silenciados de uma sessao (o console; o silencio vencido sai pela hora em live-model). */
export async function listSessionBanRows(db: WebinarsDb, sessionId: string): Promise<SessionBanRow[]> {
  const { data, error } = await db.from("webinar_session_bans").select(SESSION_BAN_COLUMNS).eq("session_id", sessionId).order("created_at", { ascending: true });
  assertNoDbError(error, "Webinarios: ler os banimentos da sessao");
  return (data ?? []) as SessionBanRow[];
}

/** Os banidos de todos os webinarios entre estes alunos (o console marca quem ja esta banido). */
export async function listUserBanRows(db: WebinarsDb, userIds: readonly string[]): Promise<UserBanRow[]> {
  if (userIds.length === 0) {
    return [];
  }
  const { data, error } = await db.from("webinar_user_bans").select(USER_BAN_COLUMNS).in("user_id", [...userIds]);
  assertNoDbError(error, "Webinarios: ler os banidos");
  return (data ?? []) as UserBanRow[];
}

/** Remover da sala ou silenciar no chat: grava (ou troca o prazo e o motivo de) uma linha por sessao, aluno e tipo. */
export async function upsertSessionBan(db: WebinarsDb, row: Omit<SessionBanRow, "created_at">): Promise<SessionBanRow> {
  const { data, error } = await db.from("webinar_session_bans").upsert(row, { onConflict: "session_id,user_id,kind" }).select(SESSION_BAN_COLUMNS).single();
  assertNoDbError(error, "Webinarios: gravar o banimento da sessao");
  return data as SessionBanRow;
}

/** Desfaz o remover ou o silenciar naquela sessao; devolve se havia linha. */
export async function deleteSessionBan(db: WebinarsDb, input: { kind: SessionBanRow["kind"]; sessionId: string; userId: string }): Promise<boolean> {
  const { data, error } = await db
    .from("webinar_session_bans")
    .delete()
    .eq("session_id", input.sessionId)
    .eq("user_id", input.userId)
    .eq("kind", input.kind)
    .select("user_id");
  assertNoDbError(error, "Webinarios: desfazer o banimento da sessao");
  return (data ?? []).length > 0;
}

/** Banir de todos os webinarios (uma linha por aluno; banir de novo troca a sessao, quem e o motivo). */
export async function upsertUserBan(db: WebinarsDb, row: Omit<UserBanRow, "created_at">): Promise<UserBanRow> {
  const { data, error } = await db.from("webinar_user_bans").upsert(row, { onConflict: "user_id" }).select(USER_BAN_COLUMNS).single();
  assertNoDbError(error, "Webinarios: banir o aluno");
  return data as UserBanRow;
}

/** Desfazer o banimento (apaga a linha); devolve se havia. */
export async function deleteUserBan(db: WebinarsDb, userId: string): Promise<boolean> {
  const { data, error } = await db.from("webinar_user_bans").delete().eq("user_id", userId).select("user_id");
  assertNoDbError(error, "Webinarios: desfazer o banimento");
  return (data ?? []).length > 0;
}

/* ------------------------------------------------------------------------------------------------
 * O webhook do gravador, bruto
 * ---------------------------------------------------------------------------------------------- */

export type RecordingEventInsert = {
  file_name: string | null;
  /** A hora do pedido da maquina (recorder_requested_at da sessao) no ready / unavailable / gone; nulo nos outros. */
  machine_requested_at: string | null;
  payload: Record<string, unknown>;
  room: string | null;
  session_id: string | null;
  signature_valid: boolean;
  state: RecorderState;
};

/**
 * Guarda a chamada do webhook inteira. A chave unica (sessao + estado + arquivo + maquina, 202610290003) segura a
 * repeticao: o pedido repetido devolve a linha que ja existia com `duplicate: true` (a rota responde 200 sem refazer
 * nada, salvo as excecoes de recorder-webhook.ts). O `ready` de outra maquina da mesma sessao e uma linha nova.
 */
export async function insertRecordingEvent(db: WebinarsDb, row: RecordingEventInsert): Promise<{ duplicate: boolean; row: RecordingEventRow }> {
  const { data, error } = await db.from("webinar_recording_events").insert(row).select(RECORDING_EVENT_COLUMNS).single();
  if (error?.code === "23505" && row.session_id) {
    let query = db.from("webinar_recording_events").select(RECORDING_EVENT_COLUMNS).eq("session_id", row.session_id).eq("state", row.state);
    query = row.file_name === null ? query.is("file_name", null) : query.eq("file_name", row.file_name);
    query = row.machine_requested_at === null ? query.is("machine_requested_at", null) : query.eq("machine_requested_at", row.machine_requested_at);
    const existing = await query.limit(1);
    assertNoDbError(existing.error, "Webinarios: ler o pedido repetido do gravador");
    const found = ((existing.data ?? []) as RecordingEventRow[])[0];
    if (found) {
      return { duplicate: true, row: found };
    }
  }
  assertNoDbError(error, "Webinarios: guardar o pedido do gravador");
  return { duplicate: false, row: data as RecordingEventRow };
}

/**
 * Toma de volta um pedido que ficou `pending` (o processo caiu no meio: deploy, tempo esgotado, o banco fora ate na hora
 * de marcar `failed`): so a linha ainda `pending` e recebida antes de `staleBeforeIso` e, numa troca so (o received_at
 * vira agora), so uma de duas repeticoes juntas fica com ela. Devolve a linha tomada ou nulo.
 */
export async function claimStalePendingRecordingEvent(db: WebinarsDb, input: { id: string; nowIso: string; staleBeforeIso: string }): Promise<RecordingEventRow | null> {
  const { data, error } = await db
    .from("webinar_recording_events")
    .update({ received_at: input.nowIso })
    .eq("id", input.id)
    .eq("processing_status", "pending")
    .lt("received_at", input.staleBeforeIso)
    .select(RECORDING_EVENT_COLUMNS);
  assertNoDbError(error, "Webinarios: retomar o pedido do gravador");
  return ((data ?? []) as RecordingEventRow[])[0] ?? null;
}

/** O resultado do processamento de um pedido do gravador (processed / ignored / failed, com a mensagem). */
export async function markRecordingEventProcessed(
  db: WebinarsDb,
  id: string,
  input: { error?: string | null; nowIso: string; status: Exclude<RecordingEventStatus, "pending"> }
): Promise<void> {
  const { error } = await db
    .from("webinar_recording_events")
    .update({ error_message: input.error ? input.error.slice(0, 2000) : null, processed_at: input.nowIso, processing_status: input.status })
    .eq("id", id);
  assertNoDbError(error, "Webinarios: marcar o pedido do gravador");
}

/** Os pedidos do gravador de uma sessao, do mais novo ao mais velho (o console e a conferencia da ancora). */
export async function listRecordingEventRows(db: WebinarsDb, sessionId: string, limit = 50): Promise<RecordingEventRow[]> {
  const { data, error } = await db
    .from("webinar_recording_events")
    .select(RECORDING_EVENT_COLUMNS)
    .eq("session_id", sessionId)
    .order("received_at", { ascending: false })
    .limit(limit);
  assertNoDbError(error, "Webinarios: ler os pedidos do gravador");
  return (data ?? []) as RecordingEventRow[];
}

/**
 * Quanto as ultimas maquinas levaram do pedido ate o `ready` (ms), para a estimativa "Preparando a gravação, {n} min"
 * (recorder-model.prepareEstimateMinutes). Le os `ready` processados mais novos com a hora do pedido da propria maquina
 * (machine_requested_at, 202610290003): a segunda maquina da mesma sessao conta a sua subida; as linhas de antes da
 * coluna caem na hora do pedido guardada na sessao.
 */
export async function recentRecorderPrepareDurations(db: WebinarsDb, limit = 5): Promise<number[]> {
  const { data, error } = await db
    .from("webinar_recording_events")
    .select("session_id, received_at, machine_requested_at")
    .eq("state", "ready")
    .eq("processing_status", "processed")
    .not("session_id", "is", null)
    .order("received_at", { ascending: false })
    .limit(limit);
  assertNoDbError(error, "Webinarios: ler as subidas do gravador");
  const events = (data ?? []) as { machine_requested_at?: string | null; received_at: string; session_id: string }[];
  if (events.length === 0) {
    return [];
  }
  const missing = events.filter((event) => !event.machine_requested_at).map((event) => event.session_id);
  const requested = new Map<string, string | null>();
  if (missing.length > 0) {
    const sessions = await db.from("webinar_sessions").select("id, recorder_requested_at").in("id", missing);
    assertNoDbError(sessions.error, "Webinarios: ler os pedidos das maquinas");
    for (const row of (sessions.data ?? []) as { id: string; recorder_requested_at: string | null }[]) {
      requested.set(row.id, row.recorder_requested_at);
    }
  }
  return events
    .map((event) => {
      const at = event.machine_requested_at ?? requested.get(event.session_id);
      return at ? new Date(event.received_at).getTime() - new Date(at).getTime() : Number.NaN;
    })
    .filter((value) => Number.isFinite(value) && value > 0)
    .reverse();
}

/* ------------------------------------------------------------------------------------------------
 * As gravacoes (o job webinar-recordings e o "Enviar gravação")
 * ---------------------------------------------------------------------------------------------- */

/** As gravacoes ainda codificando na Bunny, as menos consultadas primeiro. */
export async function listProcessingRecordings(db: WebinarsDb, limit = 20): Promise<RecordingRow[]> {
  const { data, error } = await db
    .from("webinar_recordings")
    .select(RECORDING_COLUMNS)
    .eq("status", "processing")
    .order("checked_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  assertNoDbError(error, "Webinarios: ler as gravacoes em processamento");
  return (data ?? []) as RecordingRow[];
}

/**
 * As gravacoes do NOSSO gravador (source jibri) com a retencao vencida e ainda na Bunny (o job apaga la e marca
 * purged_at). A enviada ou ligada pela equipe (upload, bunny) nunca: o video pode ser uma aula da mesma biblioteca.
 */
export async function listRecordingsToPurge(db: WebinarsDb, nowIso: string, limit = 20): Promise<RecordingRow[]> {
  const { data, error } = await db
    .from("webinar_recordings")
    .select(RECORDING_COLUMNS)
    .eq("source", "jibri")
    .lte("purge_due_at", nowIso)
    .is("purged_at", null)
    .order("purge_due_at", { ascending: true })
    .limit(limit);
  assertNoDbError(error, "Webinarios: ler as gravacoes vencidas");
  return (data ?? []) as RecordingRow[];
}

/** A gravacao de uma sessao vinda do gravador (source jibri), a mais nova. */
export async function fetchSessionRecordingRow(db: WebinarsDb, sessionId: string): Promise<RecordingRow | null> {
  const { data, error } = await db
    .from("webinar_recordings")
    .select(RECORDING_COLUMNS)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1);
  assertNoDbError(error, "Webinarios: ler a gravacao da sessao");
  return ((data ?? []) as RecordingRow[])[0] ?? null;
}
