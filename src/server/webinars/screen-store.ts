// As tabelas da "Na tela" no banco (202611100002: webinar_screen_items, webinar_screen_displays e a funcao
// webinar_screen_report), pela service role, no desenho de chat-store.ts. Quem monta o estado da sala e as regras e
// screen-queries.ts (as leituras com a memoria do processo) e as acoes do console; aqui so o acesso as linhas.
//
// Banco sem a migracao: toda LEITURA devolve vazio (o padrao de chat-store.listQuestionReplyRows), entao a sala e o
// console seguem como antes; toda ESCRITA sobe o PendingMigrationError (assertNoDbError), e a acao responde com o aviso
// de migracao pendente (WEBINARS_SCREEN_MIGRATION). Nenhuma leitura daqui entra nas leituras de sempre da sessao.

import "server-only";

import { isPendingMigrationError } from "../db/pending-migration";
import { assertNoDbError, type WebinarsDb } from "./db";
import {
  SCREEN_DISPLAY_COLUMNS,
  SCREEN_ITEM_COLUMNS,
  type ScreenDisplayHide,
  type ScreenDisplayInsert,
  type ScreenDisplayRow,
  type ScreenItemRow,
  type ScreenItemWrite,
  type ScreenReportRow
} from "./screen-rows";
import type { ScreenDisplayKind } from "./screen-model";
import { fetchAll } from "./store";

/** Uma leitura que vira vazio quando a tabela (ou a funcao) ainda nao existe. */
async function emptyWithoutMigration<T>(read: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await read();
  } catch (failure) {
    if (isPendingMigrationError(failure)) {
      return empty;
    }
    throw failure;
  }
}

/* ------------------------------------------------------------------------------------------------
 * webinar_screen_items
 * ---------------------------------------------------------------------------------------------- */

/** Os itens prontos nao arquivados de um webinario, do mais antigo ao mais novo (indice webinar_screen_items_webinar_idx). */
export async function listScreenItemRows(db: WebinarsDb, webinarId: string): Promise<ScreenItemRow[]> {
  return emptyWithoutMigration(
    () =>
      fetchAll<ScreenItemRow>(
        (from, to) =>
          db
            .from("webinar_screen_items")
            .select(SCREEN_ITEM_COLUMNS)
            .eq("webinar_id", webinarId)
            .is("archived_at", null)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        "Webinarios: Na tela, itens prontos"
      ),
    []
  );
}

/** Um item pronto pelo id (arquivado tambem: quem chama decide); nulo sem a linha ou sem a migracao. */
export async function fetchScreenItemRow(db: WebinarsDb, id: string): Promise<ScreenItemRow | null> {
  return emptyWithoutMigration(async () => {
    const { data, error } = await db.from("webinar_screen_items").select(SCREEN_ITEM_COLUMNS).eq("id", id).maybeSingle();
    assertNoDbError(error, "Webinarios: Na tela, ler item");
    return (data as ScreenItemRow | null) ?? null;
  }, null);
}

/** Quantos itens prontos nao arquivados o webinario tem (o limite de 20). */
export async function countScreenItemRows(db: WebinarsDb, webinarId: string): Promise<number> {
  const { count, error } = await db.from("webinar_screen_items").select("id", { count: "exact", head: true }).eq("webinar_id", webinarId).is("archived_at", null);
  assertNoDbError(error, "Webinarios: Na tela, contar itens");
  return count ?? 0;
}

export async function insertScreenItemRow(db: WebinarsDb, row: ScreenItemWrite & { created_by: string | null; webinar_id: string }): Promise<ScreenItemRow> {
  const { data, error } = await db.from("webinar_screen_items").insert(row).select(SCREEN_ITEM_COLUMNS).single();
  assertNoDbError(error, "Webinarios: Na tela, gravar item");
  return data as ScreenItemRow;
}

/** Edita um item que ainda nao foi arquivado; nulo quando ele sumiu ou foi arquivado. */
export async function updateScreenItemRow(db: WebinarsDb, id: string, patch: ScreenItemWrite): Promise<ScreenItemRow | null> {
  const { data, error } = await db.from("webinar_screen_items").update(patch).eq("id", id).is("archived_at", null).select(SCREEN_ITEM_COLUMNS).maybeSingle();
  assertNoDbError(error, "Webinarios: Na tela, editar item");
  return (data as ScreenItemRow | null) ?? null;
}

/** Arquiva (nunca apaga: as exibicoes guardam a copia e o relatorio continua). */
export async function archiveScreenItemRow(db: WebinarsDb, id: string, nowIso: string): Promise<ScreenItemRow | null> {
  const { data, error } = await db.from("webinar_screen_items").update({ archived_at: nowIso }).eq("id", id).is("archived_at", null).select(SCREEN_ITEM_COLUMNS).maybeSingle();
  assertNoDbError(error, "Webinarios: Na tela, arquivar item");
  return (data as ScreenItemRow | null) ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * webinar_screen_displays
 * ---------------------------------------------------------------------------------------------- */

/** O que esta na tela agora numa sessao: no maximo uma linha por tipo (o indice unico parcial), entao ate 3. */
export async function listActiveScreenDisplayRows(db: WebinarsDb, sessionId: string): Promise<ScreenDisplayRow[]> {
  return emptyWithoutMigration(async () => {
    const { data, error } = await db.from("webinar_screen_displays").select(SCREEN_DISPLAY_COLUMNS).eq("session_id", sessionId).is("hidden_at", null);
    assertNoDbError(error, "Webinarios: Na tela, o que esta na tela");
    return (data ?? []) as ScreenDisplayRow[];
  }, []);
}

/** Todas as exibicoes de uma sessao, na ordem em que entraram (o relatorio e as metricas). */
export async function listSessionScreenDisplayRows(db: WebinarsDb, sessionId: string): Promise<ScreenDisplayRow[]> {
  return emptyWithoutMigration(
    () =>
      fetchAll<ScreenDisplayRow>(
        (from, to) =>
          db
            .from("webinar_screen_displays")
            .select(SCREEN_DISPLAY_COLUMNS)
            .eq("session_id", sessionId)
            .order("shown_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        "Webinarios: Na tela, exibicoes da sessao"
      ),
    []
  );
}

/** Uma exibicao pelo id; nula sem a linha ou sem a migracao. */
export async function fetchScreenDisplayRow(db: WebinarsDb, id: string): Promise<ScreenDisplayRow | null> {
  return emptyWithoutMigration(async () => {
    const { data, error } = await db.from("webinar_screen_displays").select(SCREEN_DISPLAY_COLUMNS).eq("id", id).maybeSingle();
    assertNoDbError(error, "Webinarios: Na tela, ler exibicao");
    return (data as ScreenDisplayRow | null) ?? null;
  }, null);
}

/**
 * Grava uma exibicao. O indice unico parcial (uma ativa por tipo e sessao) faz o segundo de dois cliques juntos dar
 * 23505: devolve `conflict` para quem chama tentar de novo (esconder a ativa e inserir outra vez).
 */
export async function insertScreenDisplayRow(db: WebinarsDb, row: ScreenDisplayInsert): Promise<{ conflict: true } | { conflict: false; row: ScreenDisplayRow }> {
  const { data, error } = await db.from("webinar_screen_displays").insert(row).select(SCREEN_DISPLAY_COLUMNS).single();
  if (error?.code === "23505") {
    return { conflict: true };
  }
  assertNoDbError(error, "Webinarios: Na tela, mostrar");
  return { conflict: false, row: data as ScreenDisplayRow };
}

/** Tira da tela as exibicoes ativas de um tipo numa sessao (o trocar e o desafixar). Devolve as que sairam. */
export async function hideActiveScreenDisplayRows(db: WebinarsDb, input: { kind: ScreenDisplayKind; pollId?: string; sessionId: string }, hide: ScreenDisplayHide): Promise<ScreenDisplayRow[]> {
  let query = db.from("webinar_screen_displays").update(hide).eq("session_id", input.sessionId).eq("kind", input.kind).is("hidden_at", null);
  if (input.pollId) {
    query = query.eq("poll_id", input.pollId);
  }
  const { data, error } = await query.select(SCREEN_DISPLAY_COLUMNS);
  assertNoDbError(error, "Webinarios: Na tela, tirar da tela");
  return (data ?? []) as ScreenDisplayRow[];
}

/** Tira da tela uma exibicao pelo id (so se ainda esta na tela); nula quando ja tinha saido. */
export async function hideScreenDisplayRow(db: WebinarsDb, id: string, hide: ScreenDisplayHide): Promise<ScreenDisplayRow | null> {
  const { data, error } = await db.from("webinar_screen_displays").update(hide).eq("id", id).is("hidden_at", null).select(SCREEN_DISPLAY_COLUMNS).maybeSingle();
  assertNoDbError(error, "Webinarios: Na tela, tirar da tela");
  return (data as ScreenDisplayRow | null) ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * webinar_screen_report
 * ---------------------------------------------------------------------------------------------- */

/** Os numeros por exibicao de uma sessao (alunos distintos; a equipe fica de fora). Sem a migracao: nenhum. */
export async function fetchScreenReportRows(db: WebinarsDb, sessionId: string): Promise<ScreenReportRow[]> {
  return emptyWithoutMigration(async () => {
    const { data, error } = await db.rpc("webinar_screen_report", { p_session_id: sessionId });
    assertNoDbError(error, "Webinarios: Na tela, numeros");
    return (data ?? []) as ScreenReportRow[];
  }, []);
}

/* ------------------------------------------------------------------------------------------------
 * As enquetes da sessao, so o que muda o que a turma ve (o pollsKey)
 * ---------------------------------------------------------------------------------------------- */

export type SessionPollKeyRow = { id: string; results_shared_at: string | null; status: string };

/** Id, situacao e resultado compartilhado de cada enquete da sessao (nada de opcoes nem respostas). */
export async function listSessionPollKeyRows(db: WebinarsDb, sessionId: string): Promise<SessionPollKeyRow[]> {
  const { data, error } = await db.from("webinar_polls").select("id, status, results_shared_at").eq("session_id", sessionId);
  assertNoDbError(error, "Webinarios: Na tela, enquetes da sessao");
  return (data ?? []) as SessionPollKeyRow[];
}
