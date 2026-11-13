// A foto de quem comenta no banco (adendo de 10/11/2026, R9; migracao 202611100002), pela service role. As colunas
// webinar_chat_script_items.persona_avatar_path e webinar_chat_messages.persona_avatar_path nao entram nas listas que
// o app sempre le (SCRIPT_ITEM_COLUMNS, CHAT_MESSAGE_COLUMNS, nem a funcao webinar_chat_window): sao lidas aqui, a parte,
// e o banco sem a migracao responde como "sem foto" (as leituras toleram; so as escritas novas da foto caem no aviso da
// migracao, em quem chama).
//
// - readScriptPersonaAvatars: as fotos dos itens de um webinario (o card Roteiro, o console, o tick da live, o salvar)
//   e, desde 11/11/2026, a pessoa de cada item (persona_id, da 202611140001), na mesma leitura; no banco sem a
//   202611140001 a leitura volta sem a pessoa (`linked` falso) e com a foto, e sem a 202611100002, sem nada;
// - readScriptItemPersonaAvatar: a foto de um item (o "Soltar agora" copia para a mensagem);
// - loadScriptedMessageAvatars: a foto das mensagens `scripted` pelo id (a sala, o console e a fixada). A foto de uma
//   mensagem nunca muda depois de gravada (a copia do item na hora em que entrou), entao a leitura fica na memoria do
//   processo (ate 20.000 mensagens; passou disso, a memoria e esvaziada) e a sala cheia, relendo a cada 5 s, faz uma
//   consulta por mensagem nova por processo. O banco sem a coluna fica lembrado por 60 s (nada de consulta que falha a
//   cada 5 s);
// - applyPersonaAvatarToName (10/11/2026): o "Usar esta foto em todos os comentários de {nome}" no servidor (o
//   console): os itens do webinario com o mesmo nome (samePersonaName) recebiam a foto. Saiu em 11/11/2026, com a caixa
//   da tela: a pessoa da lista virou a unidade (syncPersonaCopies, abaixo).
//
// As pessoas que comentam (pedido do produtor de 11/11/2026; docs/30 D75 a D78; migracao 202611140001):
// - listPersonas: a lista da escola (o editor, o console e as acoes de todo webinario; desde 13/11/2026, D117), pelo
//   nome, inteira em paginas de 1.000 (a revisao v8, achado 4); banco sem a tabela, `available` falso e a lista vazia
//   (o editor e o console seguem com o Nome digitado, como antes); fetchPersonasByIds: as que uma leitura de antes nao
//   trouxe;
// - fetchPersonaRow, insertPersonaRow, updatePersonaRow e deletePersonaRow: o CRUD; o nome repetido na escola (o indice
//   unico pelo name_key da 202611180001; antes dela, o do webinario) volta como `taken`, nunca como erro comum;
//   insertPersonaRows: varias de uma vez (a importacao do CSV), com o mesmo `taken` para o lote;
// - syncPersonaCopies: a copia da pessoa (nome, papel e foto) em todos os itens ligados a ela, de todos os roteiros, em
//   uma escrita;
// - countPersonaItems: quantos itens do roteiro usam a pessoa, em todos os webinarios;
// - o Duplicar nao copia mais a lista (copyPersonasToWebinar saiu em 13/11/2026, D117): a lista e da escola, e a copia
//   ja enxerga todas as pessoas;
// - loadScriptedQuestionAvatars: a foto da pergunta simulada pelo id (a copia gravada nela), com a mesma memoria do
//   processo das mensagens (a aba Perguntas relida a cada 15 s por toda a turma).

import "server-only";

import { isPendingMigrationError } from "../db/pending-migration";
import { assertNoDbError, isMissingWebinarSchema, type WebinarsDb } from "./db";
import { fetchAll } from "./store";
import { PERSONA_ROLES, type PersonaRole } from "./model";
import { isPersonaAvatarPath, type PersonaList, type WebinarPersona } from "./persona-model";

/**
 * As fotos e as pessoas dos itens lidas: `available` falso no banco sem a 202611100002 (nenhuma foto, e nenhuma foto pode
 * ser gravada); `linked` falso no banco sem a 202611140001 (nenhum item ligado a uma pessoa).
 */
export type PersonaAvatars = { available: boolean; linked: boolean; paths: Map<string, string | null>; personaIds: Map<string, string | null> };

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

function isUniqueViolation(error: { code?: string | null } | null) {
  return error?.code === "23505";
}

type ScriptPersonaRow = { id: string; persona_avatar_path: string | null; persona_id?: string | null };

/** Os itens do webinario com as colunas pedidas, em paginas de 1.000 (o teto do PostgREST; o roteiro vai ate 5.000). */
async function readScriptPersonaRows(db: WebinarsDb, webinarId: string, columns: string): Promise<ScriptPersonaRow[]> {
  const rows: ScriptPersonaRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("webinar_chat_script_items").select(columns).eq("webinar_id", webinarId).order("id", { ascending: true }).range(from, from + 999);
    assertNoDbError(error, "Webinarios: fotos de quem comenta");
    const page = (data ?? []) as unknown as ScriptPersonaRow[];
    rows.push(...page);
    if (page.length < 1000) {
      return rows;
    }
  }
}

/**
 * As fotos e as pessoas dos itens do roteiro de um webinario, pelo id do item. Uma leitura com a pessoa (202611140001);
 * sem ela, de novo so com a foto (202611100002); sem as duas, nada.
 */
export async function readScriptPersonaAvatars(db: WebinarsDb, webinarId: string): Promise<PersonaAvatars> {
  const empty: PersonaAvatars = { available: false, linked: false, paths: new Map(), personaIds: new Map() };
  for (const [columns, linked] of [
    ["id, persona_avatar_path, persona_id", true],
    ["id, persona_avatar_path", false]
  ] as const) {
    try {
      const rows = await readScriptPersonaRows(db, webinarId, columns);
      const paths = new Map<string, string | null>();
      const personaIds = new Map<string, string | null>();
      for (const row of rows) {
        paths.set(row.id, isPersonaAvatarPath(row.persona_avatar_path) ? row.persona_avatar_path : null);
        personaIds.set(row.id, linked ? (row.persona_id ?? null) : null);
      }
      return { available: true, linked, paths, personaIds };
    } catch (error) {
      if (!isMissingColumn(error)) {
        throw error;
      }
    }
  }
  return empty;
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

/** A pessoa de um item (nula sem pessoa ou no banco sem a 202611140001). */
export async function readScriptItemPersonaId(db: WebinarsDb, itemId: string): Promise<string | null> {
  try {
    const { data, error } = await db.from("webinar_chat_script_items").select("persona_id").eq("id", itemId).maybeSingle();
    assertNoDbError(error, "Webinarios: pessoa do item");
    return (data as { persona_id: string | null } | null)?.persona_id ?? null;
  } catch (error) {
    if (isMissingColumn(error)) {
      return null;
    }
    throw error;
  }
}

/** Os itens com a foto e a pessoa de agora (o card e o console recebem o caminho e a pessoa junto do item). */
export function withPersonaAvatars<T extends { id: string }>(items: readonly T[], avatars: PersonaAvatars): (T & { personaAvatarPath: string | null; personaId: string | null })[] {
  return items.map((item) => ({ ...item, personaAvatarPath: avatars.paths.get(item.id) ?? null, personaId: avatars.personaIds.get(item.id) ?? null }));
}

/** Uma memoria de copias da foto por id (a mensagem e a pergunta simulada nunca mudam a foto depois de gravadas). */
function copiedAvatarMemory(table: "webinar_chat_messages" | "webinar_questions", context: string) {
  const cache = new Map<string, string | null>();
  let missingUntil = 0;

  return {
    clear() {
      cache.clear();
      missingUntil = 0;
    },
    async load(db: WebinarsDb, rowIds: readonly (string | null | undefined)[], nowMs: number): Promise<Map<string, string>> {
      const found = new Map<string, string>();
      const ids = Array.from(new Set(rowIds.filter((id): id is string => Boolean(id))));
      const missing: string[] = [];

      for (const id of ids) {
        if (cache.has(id)) {
          const path = cache.get(id);
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
          const { data, error } = await db.from(table).select("id, persona_avatar_path").in("id", chunk);
          assertNoDbError(error, context);
          for (const row of (data ?? []) as { id: string; persona_avatar_path: string | null }[]) {
            read.set(row.id, isPersonaAvatarPath(row.persona_avatar_path) ? row.persona_avatar_path : null);
          }
        }
        if (cache.size + missing.length > MESSAGE_CACHE_MAX) {
          cache.clear();
        }
        for (const id of missing) {
          const path = read.get(id) ?? null;
          // A linha que ainda nao apareceu na leitura (outro processo acabou de gravar) nao vira "sem foto" para sempre.
          if (read.has(id)) {
            cache.set(id, path);
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
  };
}

const messageAvatars = copiedAvatarMemory("webinar_chat_messages", "Webinarios: foto de quem comenta na mensagem");
const questionAvatars = copiedAvatarMemory("webinar_questions", "Webinarios: foto de quem comenta na pergunta simulada");

/** Esvazia a memoria (os testes). */
export function clearScriptedAvatarCache() {
  messageAvatars.clear();
  questionAvatars.clear();
}

/**
 * A foto das mensagens `scripted` pelo id (so as que tem). Nunca lanca: a foto e um detalhe, e na falha da leitura a
 * sala segue com as iniciais (o erro vai para o log).
 */
export async function loadScriptedMessageAvatars(db: WebinarsDb, messageIds: readonly (string | null | undefined)[], nowMs: number = Date.now()): Promise<Map<string, string>> {
  return messageAvatars.load(db, messageIds, nowMs);
}

/**
 * A foto das perguntas simuladas pelo id (so as que tem; a copia da pessoa gravada na pergunta, D77). Nunca lanca: no
 * banco sem a 202611140001 nao ha pergunta simulada, e a falha da leitura deixa as iniciais.
 */
export async function loadScriptedQuestionAvatars(db: WebinarsDb, questionIds: readonly (string | null | undefined)[], nowMs: number = Date.now()): Promise<Map<string, string>> {
  return questionAvatars.load(db, questionIds, nowMs);
}

/* ------------------------------------------------------------------------------------------------
 * As pessoas que comentam (202611140001)
 * ---------------------------------------------------------------------------------------------- */

export const PERSONA_COLUMNS = "id, webinar_id, name, role, avatar_path, created_at, updated_at";

export type PersonaRow = {
  avatar_path: string | null;
  created_at: string;
  id: string;
  name: string;
  role: string;
  updated_at: string;
  /** So a origem (D117): o webinario em que a pessoa foi criada; nula quando ele foi excluido. */
  webinar_id: string | null;
};

export function personaFromRow(row: PersonaRow): WebinarPersona {
  return {
    avatarPath: isPersonaAvatarPath(row.avatar_path) ? row.avatar_path : null,
    createdAt: row.created_at,
    id: row.id,
    name: row.name,
    // Um papel que este app nao conhece vira aluno, nunca equipe.
    role: (PERSONA_ROLES as readonly string[]).includes(row.role) ? (row.role as PersonaRole) : "student",
    updatedAt: row.updated_at,
    webinarId: row.webinar_id
  };
}

/**
 * A lista da escola pelo nome, inteira (D117: uma lista so, para todo webinario): em paginas de 1.000 numa ordem total
 * (o nome e o id), porque o PostgREST corta toda resposta em 1.000 linhas sem erro e a pessoa que nao viesse seria
 * tratada como inexistente (o Salvar roteiro soltaria itens e a edicao voltaria 404; correcao da revisao v8, achado 4).
 * Banco sem a 202611140001: `available` falso e vazia.
 */
export async function listPersonas(db: WebinarsDb): Promise<PersonaList> {
  try {
    const rows = await fetchAll<PersonaRow>(
      (from, to) => db.from("webinar_personas").select(PERSONA_COLUMNS).order("name", { ascending: true }).order("id", { ascending: true }).range(from, to),
      "Webinarios: pessoas que comentam"
    );
    return { available: true, personas: rows.map(personaFromRow) };
  } catch (error) {
    if (isMissingColumn(error)) {
      return { available: false, personas: [] };
    }
    throw error;
  }
}

/**
 * As pessoas da escola pelos ids (em pedacos de 200): as que a lista lida antes nao trouxe (a que entrou na lista
 * depois da leitura, por exemplo). Banco sem a tabela: PendingMigrationError.
 */
export async function fetchPersonasByIds(db: WebinarsDb, ids: readonly string[]): Promise<WebinarPersona[]> {
  const personas: WebinarPersona[] = [];
  for (const chunk of chunkIds([...new Set(ids)], CHUNK)) {
    const { data, error } = await db.from("webinar_personas").select(PERSONA_COLUMNS).in("id", chunk);
    assertNoDbError(error, "Webinarios: ler pessoas que comentam pelo id");
    personas.push(...((data ?? []) as PersonaRow[]).map(personaFromRow));
  }
  return personas;
}

/** Uma pessoa pelo id (nula quando nao existe). Banco sem a tabela: PendingMigrationError. */
export async function fetchPersonaRow(db: WebinarsDb, id: string): Promise<PersonaRow | null> {
  const { data, error } = await db.from("webinar_personas").select(PERSONA_COLUMNS).eq("id", id).maybeSingle();
  assertNoDbError(error, "Webinarios: ler pessoa que comenta");
  return (data as PersonaRow | null) ?? null;
}

/** Uma pessoa nova; `webinar_id` e a origem (o webinario em que a equipe a criou; D117). */
export type PersonaInsert = { avatar_path: string | null; created_by: string | null; name: string; role: PersonaRole; webinar_id: string | null };

/** Grava uma pessoa nova; o nome repetido na escola (o indice unico) volta como `taken`. */
export async function insertPersonaRow(db: WebinarsDb, row: PersonaInsert): Promise<{ row: PersonaRow } | { taken: true }> {
  const { data, error } = await db.from("webinar_personas").insert(row).select(PERSONA_COLUMNS).single();
  if (isUniqueViolation(error)) {
    return { taken: true };
  }
  assertNoDbError(error, "Webinarios: gravar pessoa que comenta");
  return { row: data as PersonaRow };
}

/**
 * Grava varias pessoas novas de uma vez (a importacao do CSV, correcao da revisao v8, achado 3). O indice unico do nome
 * (na escola, desde a 202611180001) recusa o lote inteiro quando um nome ja entrou (outra importacao ao mesmo tempo):
 * `taken`, e quem chama grava uma por vez e reaproveita a que ja estava.
 */
export async function insertPersonaRows(db: WebinarsDb, rows: readonly PersonaInsert[]): Promise<{ rows: PersonaRow[] } | { taken: true }> {
  if (rows.length === 0) {
    return { rows: [] };
  }
  const { data, error } = await db.from("webinar_personas").insert([...rows]).select(PERSONA_COLUMNS);
  if (isUniqueViolation(error)) {
    return { taken: true };
  }
  assertNoDbError(error, "Webinarios: gravar pessoas que comentam");
  return { rows: (data ?? []) as PersonaRow[] };
}

export type PersonaPatch = Partial<Pick<PersonaRow, "avatar_path" | "name" | "role">>;

/** Muda uma pessoa; nula quando ela nao existe mais, `taken` com o nome repetido. */
export async function updatePersonaRow(db: WebinarsDb, id: string, patch: PersonaPatch): Promise<{ row: PersonaRow | null } | { taken: true }> {
  const { data, error } = await db.from("webinar_personas").update(patch).eq("id", id).select(PERSONA_COLUMNS).maybeSingle();
  if (isUniqueViolation(error)) {
    return { taken: true };
  }
  assertNoDbError(error, "Webinarios: mudar pessoa que comenta");
  return { row: (data as PersonaRow | null) ?? null };
}

/** Tira a pessoa da lista (os itens ligados ficam com a copia e sem a pessoa: on delete set null). Devolve se tirou. */
export async function deletePersonaRow(db: WebinarsDb, id: string): Promise<boolean> {
  const { data, error } = await db.from("webinar_personas").delete().eq("id", id).select("id");
  assertNoDbError(error, "Webinarios: tirar pessoa que comenta");
  return (data ?? []).length > 0;
}

/**
 * A copia da pessoa (nome, papel e foto) em todos os itens do roteiro ligados a ela, de todos os webinarios (a lista e da
 * escola, D117). Devolve quantos itens mudaram.
 */
export async function syncPersonaCopies(db: WebinarsDb, persona: Pick<WebinarPersona, "avatarPath" | "id" | "name" | "role">): Promise<number> {
  const { data, error } = await db
    .from("webinar_chat_script_items")
    .update({ persona_avatar_path: persona.avatarPath, persona_name: persona.name, persona_role: persona.role })
    .eq("persona_id", persona.id)
    .select("id");
  assertNoDbError(error, "Webinarios: copia da pessoa nos itens do roteiro");
  return (data ?? []).length;
}

/** Quantos itens do roteiro usam a pessoa, em todos os webinarios. */
export async function countPersonaItems(db: WebinarsDb, personaId: string): Promise<number> {
  const { count, error } = await db.from("webinar_chat_script_items").select("id", { count: "exact", head: true }).eq("persona_id", personaId);
  assertNoDbError(error, "Webinarios: itens da pessoa que comenta");
  return count ?? 0;
}
