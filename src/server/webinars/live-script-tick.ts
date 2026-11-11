import "server-only";

// O roteiro da Live ao vivo pelo relogio (adendo de 10/11/2026, R8; docs/31 §5.2): a cada minuto, nas sessoes `live` no
// ar (com o started_at do "Começar para todos"), os itens "Num minuto da live" prontos cujo minuto venceu e que ainda nao
// entraram nesta sessao viram mensagens `scripted` da sessao (nunca da linha mestre), com o nome, o papel e a foto de
// quem comenta (a copia do item agora). Nunca antes do "Começar para todos" (webinar_open_session nao solta o roteiro da
// live ao abrir; a 202611100002) e no maximo 5 min atrasado (persona-model.liveScriptDue: o tick que ficou fora do ar;
// mais que isso fica para o "Soltar agora"). A mensagem nasce com created_at de agora e o offset do relogio do chat da
// live (a ancora da gravacao, ou o inicio), como o "Soltar agora": a turma recebe pela consulta de 5 s, ate 1 min depois
// do minuto marcado. O mesmo item na mesma sessao entra uma vez so (a chave unica session_id + script_item_id): o tick
// e o "Soltar agora" ao mesmo tempo nunca repetem. Uma consulta de sessoes por tick (as live no ar com started_at nas
// ultimas 24 h); por sessao, o roteiro, o que ja entrou e as fotos. Uma falha numa sessao vira log e o lote segue; o fim
// do orcamento do tick (signal) para. Banco sem as tabelas do roteiro: registra e devolve zeros. Quem chama e o job das
// sessoes (src/server/jobs/webinar-sessions-job.ts).

import { isPendingMigrationError } from "../db/pending-migration";
import { scriptItemFromRow } from "./chat-rows";
import { insertScriptedMessage, listFiredScriptItemIds, listScriptItemRows } from "./chat-store";
import { assertNoDbError, isMissingWebinarSchema, WEBINARS_MIGRATION, type WebinarsDb } from "./db";
import { CHAT_LIMITS } from "./model";
import { liveScriptDue } from "./persona-model";
import { readScriptPersonaAvatars } from "./persona-store";
import { sessionOffsetMs } from "./room-model";
import { SESSION_COLUMNS, sessionFromRow, type SessionRow } from "./rows";

/** As lives no ar com started_at ate 24 h atras entram (nenhuma live dura mais que isso). */
export const LIVE_SCRIPT_LOOKBACK_MS = 24 * 60 * 60_000;

export type LiveScriptResult = {
  /** Sessoes em que a conta deu erro (log; o lote seguiu). */
  failed: number;
  /** Banco sem o roteiro: nada feito, o tick continua verde. */
  pendingMigration: boolean;
  /** Mensagens do roteiro soltas neste tick. */
  released: number;
  /** Lives no ar lidas. */
  sessions: number;
  /** Itens que outro caminho (o "Soltar agora", outro tick) soltou antes. */
  skipped: number;
};

export const EMPTY_LIVE_SCRIPT_RESULT: LiveScriptResult = { failed: 0, pendingMigration: false, released: 0, sessions: 0, skipped: 0 };

/** As sessoes `live` no ar com o started_at desde `sinceIso`. */
export async function listLiveSessionsOnAir(db: WebinarsDb, input: { sinceIso: string }): Promise<SessionRow[]> {
  const { data, error } = await db
    .from("webinar_sessions")
    .select(SESSION_COLUMNS)
    .eq("kind", "live")
    .eq("status", "live")
    .not("started_at", "is", null)
    .gte("started_at", input.sinceIso)
    .order("started_at", { ascending: true });
  assertNoDbError(error, "Webinarios: lives no ar para o roteiro");
  return (data ?? []) as SessionRow[];
}

/** Solta o que venceu numa live no ar; devolve quantas entraram e quantas outro caminho ja tinha soltado. */
async function releaseSession(db: WebinarsDb, row: SessionRow, now: Date): Promise<{ released: number; skipped: number }> {
  const session = sessionFromRow(row);
  const items = (await listScriptItemRows(db, session.webinarId)).map(scriptItemFromRow);
  if (items.length === 0) {
    return { released: 0, skipped: 0 };
  }
  const due = liveScriptDue({ fired: await listFiredScriptItemIds(db, session.id), items, nowMs: now.getTime(), startedAt: session.startedAt });
  if (due.length === 0) {
    return { released: 0, skipped: 0 };
  }
  const avatars = await readScriptPersonaAvatars(db, session.webinarId);
  const offset = sessionOffsetMs(session, now.getTime());
  const offsetMs = Number.isFinite(offset) ? Math.max(CHAT_LIMITS.offsetMinMs, Math.min(CHAT_LIMITS.offsetMaxMs, Math.round(offset))) : 0;
  let released = 0;
  let skipped = 0;
  for (const item of due) {
    const avatar = avatars.paths.get(item.id) ?? null;
    const inserted = await insertScriptedMessage(db, {
      approved: true,
      author_user_id: null,
      body: item.body,
      display_name: item.personaName,
      kind: item.kind,
      master: false,
      offset_ms: offsetMs,
      ...(avatar ? { persona_avatar_path: avatar } : {}),
      role: item.personaRole,
      script_item_id: item.id,
      session_id: session.id,
      source: "scripted",
      webinar_id: session.webinarId
    });
    if (inserted) {
      released += 1;
    } else {
      skipped += 1;
    }
  }
  return { released, skipped };
}

/** Um tick do roteiro da Live ao vivo. `now` e `signal` vem do tick; nos testes, o relogio falso. */
export async function runLiveScriptTick(input: { db: WebinarsDb; now?: Date; signal?: AbortSignal }): Promise<LiveScriptResult> {
  const { db, signal } = input;
  const now = input.now ?? new Date();
  const result: LiveScriptResult = { ...EMPTY_LIVE_SCRIPT_RESULT };

  if (signal?.aborted) {
    return result;
  }

  try {
    const rows = await listLiveSessionsOnAir(db, { sinceIso: new Date(now.getTime() - LIVE_SCRIPT_LOOKBACK_MS).toISOString() });
    result.sessions = rows.length;
    for (const row of rows) {
      if (signal?.aborted) {
        break;
      }
      try {
        const done = await releaseSession(db, row, now);
        result.released += done.released;
        result.skipped += done.skipped;
      } catch (error) {
        if (isPendingMigrationError(error) || isMissingWebinarSchema(error)) {
          throw error;
        }
        result.failed += 1;
        console.error(`[webinarios] roteiro da live ${row.id} nao solto: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    if (isPendingMigrationError(error) || isMissingWebinarSchema(error)) {
      result.pendingMigration = true;
      console.info(`[webinarios] tabelas do roteiro ausentes (migracao ${WEBINARS_MIGRATION} pendente); nada a soltar na live.`);
      return result;
    }
    throw error;
  }

  return result;
}
