// A foto de quem comenta no banco (adendo de 10/11/2026, R9; migracao 202611100002), pela service role. As colunas
// webinar_chat_script_items.persona_avatar_path e webinar_chat_messages.persona_avatar_path nao entram nas listas que
// o app sempre le (SCRIPT_ITEM_COLUMNS, CHAT_MESSAGE_COLUMNS, nem a funcao webinar_chat_window): sao lidas aqui, a parte,
// e o banco sem a migracao responde como "sem foto" (as leituras toleram; so as escritas novas da foto caem no aviso da
// migracao, em quem chama).
//
// - readScriptPersonaAvatars: as fotos dos itens de um webinario (o card Roteiro, o console, o tick da live, o salvar);
// - readScriptItemPersonaAvatar: a foto de um item (o "Soltar agora" copia para a mensagem);
// - loadScriptedMessageAvatars: a foto das mensagens `scripted` pelo id (a sala, o console e a fixada). A foto de uma
//   mensagem nunca muda depois de gravada (a copia do item na hora em que entrou), entao a leitura fica na memoria do
//   processo (ate 20.000 mensagens; passou disso, a memoria e esvaziada) e a sala cheia, relendo a cada 5 s, faz uma
//   consulta por mensagem nova por processo. O banco sem a coluna fica lembrado por 60 s (nada de consulta que falha a
//   cada 5 s);
// - applyPersonaAvatarToName: o "Usar esta foto em todos os comentários de {nome}" no servidor (o console): os itens do
//   webinario com o mesmo nome (samePersonaName) recebem a foto.

import "server-only";

import { isPendingMigrationError } from "../db/pending-migration";
import { assertNoDbError, isMissingWebinarSchema, type WebinarsDb } from "./db";
import { isPersonaAvatarPath, samePersonaName } from "./persona-model";

/** As fotos lidas: `available` falso no banco sem a 202611100002 (nenhuma foto, e nenhuma foto pode ser gravada). */
export type PersonaAvatars = { available: boolean; paths: Map<string, string | null> };

const CHUNK = 200;
/** Quantas mensagens a memoria guarda; passou disso, ela e esvaziada. */
const MESSAGE_CACHE_MAX = 20_000;
/** Quanto tempo o banco sem a coluna fica lembrado. */
export const PERSONA_MISSING_TTL_MS = 60_000;

function chunkIds(ids: readonly string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += size) {
    chunks.push(ids.slice(start, start + size));
  }
  return chunks;
}

function isMissingColumn(error: unknown) {
  return isPendingMigrationError(error) || isMissingWebinarSchema(error);
}

/** As fotos dos itens do roteiro de um webinario, pelo id do item. */
export async function readScriptPersonaAvatars(db: WebinarsDb, webinarId: string): Promise<PersonaAvatars> {
  try {
    const paths = new Map<string, string | null>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("webinar_chat_script_items").select("id, persona_avatar_path").eq("webinar_id", webinarId).order("id", { ascending: true }).range(from, from + 999);
      assertNoDbError(error, "Webinarios: fotos de quem comenta");
      const rows = (data ?? []) as { id: string; persona_avatar_path: string | null }[];
      for (const row of rows) {
        paths.set(row.id, isPersonaAvatarPath(row.persona_avatar_path) ? row.persona_avatar_path : null);
      }
      if (rows.length < 1000) {
        return { available: true, paths };
      }
    }
  } catch (error) {
    if (isMissingColumn(error)) {
      return { available: false, paths: new Map() };
    }
    throw error;
  }
}

/** A foto de um item (nula sem foto ou no banco sem a coluna). */
export async function readScriptItemPersonaAvatar(db: WebinarsDb, itemId: string): Promise<string | null> {
  try {
    const { data, error } = await db.from("webinar_chat_script_items").select("persona_avatar_path").eq("id", itemId).maybeSingle();
    assertNoDbError(error, "Webinarios: foto de quem comenta do item");
    const path = (data as { persona_avatar_path: string | null } | null)?.persona_avatar_path ?? null;
    return isPersonaAvatarPath(path) ? path : null;
  } catch (error) {
    if (isMissingColumn(error)) {
      return null;
    }
    throw error;
  }
}

/** Os itens com a foto de agora (o card e o console recebem o caminho junto do item). */
export function withPersonaAvatars<T extends { id: string }>(items: readonly T[], avatars: PersonaAvatars): (T & { personaAvatarPath: string | null })[] {
  return items.map((item) => ({ ...item, personaAvatarPath: avatars.paths.get(item.id) ?? null }));
}

const messageCache = new Map<string, string | null>();
let missingUntil = 0;

/** Esvazia a memoria (os testes). */
export function clearScriptedAvatarCache() {
  messageCache.clear();
  missingUntil = 0;
}

/**
 * A foto das mensagens `scripted` pelo id (so as que tem). Nunca lanca: a foto e um detalhe, e na falha da leitura a
 * sala segue com as iniciais (o erro vai para o log).
 */
export async function loadScriptedMessageAvatars(db: WebinarsDb, messageIds: readonly (string | null | undefined)[], nowMs: number = Date.now()): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const ids = Array.from(new Set(messageIds.filter((id): id is string => Boolean(id))));
  const missing: string[] = [];

  for (const id of ids) {
    if (messageCache.has(id)) {
      const path = messageCache.get(id);
      if (path) {
        found.set(id, path);
      }
    } else {
      missing.push(id);
    }
  }

  if (missing.length === 0 || nowMs < missingUntil) {
    return found;
  }

  try {
    const read = new Map<string, string | null>();
    for (const chunk of chunkIds(missing, CHUNK)) {
      const { data, error } = await db.from("webinar_chat_messages").select("id, persona_avatar_path").in("id", chunk);
      assertNoDbError(error, "Webinarios: foto de quem comenta na mensagem");
      for (const row of (data ?? []) as { id: string; persona_avatar_path: string | null }[]) {
        read.set(row.id, isPersonaAvatarPath(row.persona_avatar_path) ? row.persona_avatar_path : null);
      }
    }
    if (messageCache.size + missing.length > MESSAGE_CACHE_MAX) {
      messageCache.clear();
    }
    for (const id of missing) {
      const path = read.get(id) ?? null;
      // A mensagem que ainda nao apareceu na leitura (outro processo acabou de gravar) nao vira "sem foto" para sempre.
      if (read.has(id)) {
        messageCache.set(id, path);
      }
      if (path) {
        found.set(id, path);
      }
    }
  } catch (error) {
    if (isMissingColumn(error)) {
      missingUntil = nowMs + PERSONA_MISSING_TTL_MS;
    } else {
      console.error(`[webinarios] fotos de quem comenta nao lidas: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return found;
}

/**
 * A foto em todos os itens do webinario com o mesmo nome (samePersonaName; nulo tira a foto). Le o roteiro inteiro em
 * paginas de 1.000 (o teto do PostgREST; o roteiro vai ate 5.000 itens). Devolve quantos itens mudaram. Banco sem a
 * coluna: PendingMigrationError (quem chama responde 409 com a frase da migracao).
 */
export async function applyPersonaAvatarToName(db: WebinarsDb, input: { name: string; path: string | null; webinarId: string }): Promise<number> {
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("webinar_chat_script_items").select("id, persona_name").eq("webinar_id", input.webinarId).order("id", { ascending: true }).range(from, from + 999);
    assertNoDbError(error, "Webinarios: itens com o mesmo nome");
    const rows = (data ?? []) as { id: string; persona_name: string }[];
    ids.push(...rows.filter((row) => samePersonaName(row.persona_name, input.name)).map((row) => row.id));
    if (rows.length < 1000) {
      break;
    }
  }
  let changed = 0;
  for (const chunk of chunkIds(ids, CHUNK)) {
    const update = await db.from("webinar_chat_script_items").update({ persona_avatar_path: input.path }).in("id", chunk).select("id");
    assertNoDbError(update.error, "Webinarios: foto de quem comenta nos itens com o mesmo nome");
    changed += (update.data ?? []).length;
  }
  return changed;
}
