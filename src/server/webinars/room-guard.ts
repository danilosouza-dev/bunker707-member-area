// A lista de barrados da sala ao vivo que o Prosody do Jitsi proprio busca (docs/30 §1.4 e §8.1; seguranca-01): o
// Remover da sala e o Banir gravam webinar_session_bans / webinar_user_bans, mas o token que o navegador do aluno ja
// tem (ate 15 min) e o nome da sala continuam valendo no Jitsi, que so confere o token na entrada. O modulo
// infra/jitsi/prosody/plugins/mod_bunker_room_guard.lua busca esta lista a cada poucos segundos (GET assinado, sem
// corpo: o HMAC-SHA256 de "<timestamp>." com roomGuardKey(WEBINAR_JWT_SECRET), nos mesmos cabecalhos do webhook do
// gravador) e recusa na entrada da sala (muc-occupant-pre-join) a conta barrada, pela conta do token
// (context.user.id), nunca pelo JID. A resposta: { rooms: { "<sala>": ["<conta removida>"] }, banned: ["<conta
// banida>"] } so das sessoes `live` na espera ou no ar (os removidos e os banidos de todos). Sem o ambiente da sala
// (hostname + segredo do token): 503. Nada do aluno alem do id.

import "server-only";

import { describeError } from "../communications/db";
import { isPendingMigrationError } from "../db/pending-migration";
import { assertNoDbError, isMissingWebinarSchema, type WebinarsDb } from "./db";
import { liveTokenEnv } from "./live-model";
import { roomGuardKey, verifyRecorderSignature } from "./recorder-signature";

export type RoomGuardReply = { body: Record<string, unknown>; status: number };

/** O teto de linhas lidas por consulta (uma live grande tem dezenas de removidos, nunca milhares). */
export const ROOM_GUARD_LIMIT = 5000;

export const ROOM_GUARD_ERRORS = {
  failed: "Não foi possível ler a lista da sala.",
  pending: "Banco sem a atualização das lives ao vivo.",
  signature: "Assinatura inválida.",
  unconfigured: "A sala ao vivo não está configurada neste ambiente."
} as const;

/** A lista: as contas removidas de cada sala aberta (espera ou no ar) e as banidas de todos os webinarios. */
export async function roomGuardList(db: WebinarsDb): Promise<{ banned: string[]; rooms: Record<string, string[]> }> {
  const sessions = await db
    .from("webinar_sessions")
    .select("id, room_name")
    .eq("kind", "live")
    .in("status", ["waiting", "live"])
    .not("room_name", "is", null)
    .limit(200);
  assertNoDbError(sessions.error, "Webinarios: ler as salas abertas");
  const open = ((sessions.data ?? []) as { id: string; room_name: string | null }[]).filter((row): row is { id: string; room_name: string } => Boolean(row.room_name));
  const roomBySession = new Map(open.map((row) => [row.id, row.room_name]));
  const rooms: Record<string, string[]> = Object.fromEntries(open.map((row) => [row.room_name, [] as string[]]));

  if (open.length > 0) {
    const kicked = await db.from("webinar_session_bans").select("session_id, user_id").eq("kind", "kicked").in("session_id", open.map((row) => row.id)).limit(ROOM_GUARD_LIMIT);
    assertNoDbError(kicked.error, "Webinarios: ler os removidos das salas abertas");
    for (const row of (kicked.data ?? []) as { session_id: string; user_id: string }[]) {
      const room = roomBySession.get(row.session_id);
      if (room && !rooms[room].includes(row.user_id)) {
        rooms[room].push(row.user_id);
      }
    }
  }

  const banned = await db.from("webinar_user_bans").select("user_id").limit(ROOM_GUARD_LIMIT);
  assertNoDbError(banned.error, "Webinarios: ler os banidos");
  return { banned: ((banned.data ?? []) as { user_id: string }[]).map((row) => row.user_id), rooms };
}

/** GET /api/webhooks/room-guard sem o Next: o ambiente (503), a assinatura (401) e a lista (200). */
export async function handleRoomGuardRequest(input: {
  db: WebinarsDb;
  env?: Record<string, string | undefined>;
  now: Date;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
}): Promise<RoomGuardReply> {
  const env = liveTokenEnv(input.env ?? process.env);

  if (!env) {
    return { body: { error: ROOM_GUARD_ERRORS.unconfigured }, status: 503 };
  }

  const verification = verifyRecorderSignature({ body: "", now: input.now.getTime(), secret: roomGuardKey(env.secret), signature: input.signature, timestamp: input.timestamp });

  if (!verification.ok) {
    console.warn(`[webinarios] lista da sala recusada: ${verification.reason}.`);
    return { body: { error: ROOM_GUARD_ERRORS.signature }, status: 401 };
  }

  try {
    const list = await roomGuardList(input.db);
    return { body: { at: input.now.toISOString(), ...list }, status: 200 };
  } catch (error) {
    if (isPendingMigrationError(error) || isMissingWebinarSchema(error)) {
      return { body: { error: ROOM_GUARD_ERRORS.pending }, status: 503 };
    }
    console.error(`[webinarios] lista da sala falhou: ${describeError(error)}`);
    return { body: { error: ROOM_GUARD_ERRORS.failed }, status: 500 };
  }
}
