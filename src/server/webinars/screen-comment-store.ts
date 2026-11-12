// A tabela do comentario na tela (202611150001: webinar_screen_comments), pela service role, no desenho de
// screen-store.ts. Quem monta o cartao da sala e screen-queries.ts; as acoes do console ficam em screen-actions.ts.
//
// Banco sem a migracao: toda LEITURA devolve vazio (a sala e o console seguem como antes, sem comentario na tela); toda
// ESCRITA sobe o PendingMigrationError, e a acao responde com o aviso da migracao pendente (WEBINARS_V9_MIGRATION).

import "server-only";

import { isPendingMigrationError } from "../db/pending-migration";
import { assertNoDbError, type WebinarsDb } from "./db";
import { touchSessionRow } from "./store";
import { SCREEN_COMMENT_HIDDEN_REASONS, SCREEN_COMMENT_SOURCES, type ScreenCommentDisplay, type ScreenCommentHiddenReason, type ScreenCommentSource } from "./screen-comment-model";

export const SCREEN_COMMENT_COLUMNS = "id, session_id, source, message_id, question_id, shown_at, shown_offset_ms, shown_by, hidden_at, hidden_offset_ms, hidden_by, hidden_reason, created_at";

export type ScreenCommentRow = {
  created_at: string;
  hidden_at: string | null;
  hidden_by: string | null;
  hidden_offset_ms: number | null;
  hidden_reason: string | null;
  id: string;
  message_id: string | null;
  question_id: string | null;
  session_id: string;
  shown_at: string;
  shown_by: string | null;
  shown_offset_ms: number | null;
  source: string;
};

export type ScreenCommentInsert = Pick<ScreenCommentRow, "message_id" | "question_id" | "session_id" | "shown_at" | "shown_by" | "shown_offset_ms"> & { source: ScreenCommentSource };

export type ScreenCommentHide = { hidden_at: string; hidden_by: string | null; hidden_offset_ms: number | null; hidden_reason: ScreenCommentHiddenReason };

/** A exibicao; nula para uma origem que este app nao conhece ou sem o id da origem. */
export function screenCommentFromRow(row: ScreenCommentRow): ScreenCommentDisplay | null {
  const source = (SCREEN_COMMENT_SOURCES as readonly string[]).includes(row.source) ? (row.source as ScreenCommentSource) : null;
  if (!source || (source === "chat" ? !row.message_id : !row.question_id)) {
    return null;
  }
  return {
    hiddenAt: row.hidden_at,
    hiddenReason: (SCREEN_COMMENT_HIDDEN_REASONS as readonly string[]).includes(row.hidden_reason ?? "") ? (row.hidden_reason as ScreenCommentHiddenReason) : null,
    id: row.id,
    messageId: row.message_id,
    questionId: row.question_id,
    sessionId: row.session_id,
    shownAt: row.shown_at,
    shownBy: row.shown_by,
    shownOffsetMs: row.shown_offset_ms,
    source
  };
}

/**
 * O comentario que esta na tela numa sessao, SEM a troca por vazio: sem a migracao sobe o PendingMigrationError (as
 * acoes que vao gravar leem por aqui e respondem com o aviso antes de qualquer escrita).
 */
export async function readActiveScreenCommentRow(db: WebinarsDb, sessionId: string): Promise<ScreenCommentRow | null> {
  // No maximo uma linha (o indice unico parcial), lida como lista, como as exibicoes ativas (screen-store.ts).
  const { data, error } = await db.from("webinar_screen_comments").select(SCREEN_COMMENT_COLUMNS).eq("session_id", sessionId).is("hidden_at", null);
  assertNoDbError(error, "Webinarios: Na tela, o comentario que esta na tela");
  return ((data ?? []) as ScreenCommentRow[])[0] ?? null;
}

/** O comentario que esta na tela numa sessao (no maximo um, o indice unico parcial); nulo sem ele ou sem a migracao. */
export async function fetchActiveScreenCommentRow(db: WebinarsDb, sessionId: string): Promise<ScreenCommentRow | null> {
  try {
    return await readActiveScreenCommentRow(db, sessionId);
  } catch (failure) {
    if (isPendingMigrationError(failure)) {
      return null;
    }
    throw failure;
  }
}

/** Tira da tela o comentario ativo de uma sessao (so o mostrado ate o instante do `hide`, como as exibicoes); devolve os que sairam. */
export async function hideActiveScreenCommentRows(db: WebinarsDb, sessionId: string, hide: ScreenCommentHide): Promise<ScreenCommentRow[]> {
  const { data, error } = await db.from("webinar_screen_comments").update(hide).eq("session_id", sessionId).is("hidden_at", null).lte("shown_at", hide.hidden_at).select(SCREEN_COMMENT_COLUMNS);
  assertNoDbError(error, "Webinarios: Na tela, tirar o comentario da tela");
  return (data ?? []) as ScreenCommentRow[];
}

/**
 * Poe um comentario na tela no lugar do que estava (um por sessao): tira o ativo (motivo `replaced`) e grava o novo.
 * Dois cliques juntos podem gravar o do outro no meio: o indice unico parcial recusa (23505) e a rotina tenta UMA vez
 * mais, com o relogio de agora. Nulo quando a segunda tentativa tambem esbarrou (quem chama responde 409).
 */
export async function showScreenCommentRow(db: WebinarsDb, insert: ScreenCommentInsert, hide: ScreenCommentHide): Promise<{ replaced: ScreenCommentRow[]; row: ScreenCommentRow } | null> {
  const replaced: ScreenCommentRow[] = [];
  let attemptInsert = insert;
  let attemptHide = hide;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    replaced.push(...(await hideActiveScreenCommentRows(db, insert.session_id, attemptHide)));
    const { data, error } = await db.from("webinar_screen_comments").insert(attemptInsert).select(SCREEN_COMMENT_COLUMNS).single();

    if (error?.code !== "23505") {
      assertNoDbError(error, "Webinarios: Na tela, mostrar o comentario");
      return { replaced, row: data as ScreenCommentRow };
    }

    const at = new Date(Math.max(Date.now(), Date.parse(attemptHide.hidden_at))).toISOString();
    attemptHide = { ...attemptHide, hidden_at: at };
    attemptInsert = { ...attemptInsert, shown_at: at };
  }

  return null;
}

/**
 * Tira da tela, em qualquer sessao, os comentarios ativos dessas mensagens e perguntas (a equipe apagou a mensagem,
 * dispensou a pergunta): motivo `removed`. Devolve as sessoes que mudaram (quem chama muda o carimbo delas). Nunca
 * lanca sem a migracao: nao ha o que tirar.
 */
export async function hideScreenCommentsOfSources(db: WebinarsDb, input: { messageIds?: readonly string[]; questionIds?: readonly string[] }, hide: ScreenCommentHide): Promise<string[]> {
  const sessions = new Set<string>();
  try {
    for (const [column, ids] of [
      ["message_id", input.messageIds ?? []],
      ["question_id", input.questionIds ?? []]
    ] as const) {
      if (ids.length === 0) {
        continue;
      }
      const { data, error } = await db.from("webinar_screen_comments").update(hide).in(column, [...ids]).is("hidden_at", null).lte("shown_at", hide.hidden_at).select("session_id");
      assertNoDbError(error, "Webinarios: Na tela, tirar o comentario removido");
      for (const row of (data ?? []) as { session_id: string }[]) {
        sessions.add(row.session_id);
      }
    }
  } catch (failure) {
    if (!isPendingMigrationError(failure)) {
      throw failure;
    }
  }
  return [...sessions];
}

/** Quantas horas para tras o "Remover minhas mensagens" procura comentarios do aluno ainda na tela. */
const OWNER_LOOKBACK_MS = 24 * 3_600_000;

type OwnedCommentRow = { id: string; message: { author_user_id: string | null } | null; question: { user_id: string | null } | null; session_id: string };

/**
 * Tira da tela os comentarios e as perguntas de um aluno que ainda estao na frente de uma turma (o "Remover minhas
 * mensagens", a retirada do aceite, o banimento): os mostrados nas ultimas 24 h, com o dono lido da origem. Devolve as
 * sessoes que mudaram. Nunca lanca sem a migracao.
 */
export async function hideScreenCommentsOfUser(db: WebinarsDb, userId: string, hide: ScreenCommentHide): Promise<string[]> {
  try {
    const since = new Date(Date.parse(hide.hidden_at) - OWNER_LOOKBACK_MS).toISOString();
    const { data, error } = await db
      .from("webinar_screen_comments")
      .select("id, session_id, message:webinar_chat_messages(author_user_id), question:webinar_questions(user_id)")
      .is("hidden_at", null)
      .gte("shown_at", since)
      .limit(200);
    assertNoDbError(error, "Webinarios: Na tela, os comentarios do aluno na tela");
    const mine = ((data ?? []) as unknown as OwnedCommentRow[]).filter((row) => row.message?.author_user_id === userId || row.question?.user_id === userId);
    if (mine.length === 0) {
      return [];
    }
    const { error: failure } = await db
      .from("webinar_screen_comments")
      .update(hide)
      .in(
        "id",
        mine.map((row) => row.id)
      )
      .is("hidden_at", null);
    assertNoDbError(failure, "Webinarios: Na tela, tirar os comentarios do aluno");
    return [...new Set(mine.map((row) => row.session_id))];
  } catch (failure) {
    if (isPendingMigrationError(failure)) {
      return [];
    }
    throw failure;
  }
}

/**
 * A origem saiu (a equipe apagou a mensagem, dispensou a pergunta; o aluno removeu as mensagens dele ou foi banido): o
 * comentario sai da tela (motivo `removed`) e o carimbo de cada sessao muda, para a sala ver em ate cerca de 5 s em vez
 * de esperar a memoria de 30 s do estado. A leitura ja nao desenha a origem apagada: isto so adianta a saida. Nunca
 * lanca sem a migracao (nao ha o que tirar).
 */
export async function takeDownScreenComments(db: WebinarsDb, input: { messageIds?: readonly string[]; nowIso: string; questionIds?: readonly string[]; userId?: string }): Promise<number> {
  const hide: ScreenCommentHide = { hidden_at: input.nowIso, hidden_by: null, hidden_offset_ms: null, hidden_reason: "removed" };
  const sessions = new Set<string>(await hideScreenCommentsOfSources(db, input, hide));
  if (input.userId) {
    for (const sessionId of await hideScreenCommentsOfUser(db, input.userId, hide)) {
      sessions.add(sessionId);
    }
  }
  for (const sessionId of sessions) {
    await touchSessionRow(db, sessionId);
  }
  return sessions.size;
}
