// Follow-up por segmento (docs/30 §1.6 e §4.7, fase 4b): o que a regra "Webinário" da Comunicacao le do banco. O
// seletor do construtor (os webinarios publicados, mais recentes primeiro), os titulos citados na frase do segmento e
// os fatos de cada aluno em cada webinario citado (RPC webinar_follow_up_facts da migracao 202610290005: tira a
// equipe e nunca le a Simulacao). Quem le os fatos e o carregador da Comunicacao (audience-facts.ts e facts-loader.ts),
// uma vez por tick para cada webinario; a avaliacao e audience-model.ts.
//
// Webinario apagado (ou que nao existe) nao e lido: a regra que o cita nunca combina, negada ou nao (nao vira "todos
// que nao compareceram"). Banco sem a 202610290005: nenhum webinario e lido (a mesma regra), com um log; o resto do
// segmento segue. A RPC devolve uma linha por aluno e webinario e o PostgREST corta qualquer resposta em 1000 linhas
// (RPC tambem): a leitura e paginada em ordem (webinar_id, user_id), como fetchWebinarFollowUpFacts (offer-store.ts),
// e aqui filtra antes os webinarios apagados e devolve o formato da Comunicacao.

import "server-only";

import type { WebinarFollowUpFact } from "../communications/audience-model";
import { isPendingMigrationError } from "../db/pending-migration";
import { assertNoDbError, isMissingWebinarSchema, WEBINARS_OFFERS_MIGRATION, type WebinarsDb } from "./db";
import { followUpFactsFromRow, type FollowUpFactsRow } from "./rows";
import { fetchAll, listWebinarRows } from "./store";

/** Webinarios no seletor da regra (os mais recentes; o resto continua valendo pelo id numa regra salva). */
export const FOLLOW_UP_CHOICES_LIMIT = 200;

/** Ids por leitura de webinars (o filtro `in` vai na URL). */
const IDS_CHUNK = 150;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Um webinario do seletor da regra "Webinário" (o rotulo, com o dia, e notices-view-model.ts). */
export type WebinarFollowUpChoice = { id: string; scheduledAt: string | null; title: string };

/** userId -> { webinarId: o que o aluno fez nele }; `loadedIds` = os webinarios lidos (os outros nunca combinam). */
export type WebinarFollowUpRead = { byUser: Map<string, Record<string, WebinarFollowUpFact>>; loadedIds: string[] };

function uniqueIds(ids: readonly string[] | undefined) {
  return Array.from(new Set((ids ?? []).filter((id) => typeof id === "string" && UUID.test(id)))).sort();
}

function chunks<T>(items: readonly T[], size: number) {
  const parts: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    parts.push(items.slice(index, index + size));
  }

  return parts;
}

function isPendingFollowUpMigration(error: unknown) {
  return isPendingMigrationError(error) || isMissingWebinarSchema(error);
}

/**
 * O seletor da regra: os webinarios publicados ou encerrados (nunca rascunho nem apagado), do mais recente para o
 * mais antigo pela hora marcada (sem hora por ultimo), ate FOLLOW_UP_CHOICES_LIMIT.
 */
export async function listWebinarFollowUpChoices(db: WebinarsDb): Promise<WebinarFollowUpChoice[]> {
  const rows = await listWebinarRows(db, { statuses: ["published", "archived"] });
  const at = (value: string | null) => (value ? Date.parse(value) : Number.NEGATIVE_INFINITY);

  return rows
    .map((row) => ({ id: row.id, scheduledAt: row.scheduled_at, title: row.title.trim() }))
    .sort((left, right) => at(right.scheduledAt) - at(left.scheduledAt) || left.title.localeCompare(right.title, "pt-BR") || left.id.localeCompare(right.id))
    .slice(0, FOLLOW_UP_CHOICES_LIMIT);
}

/** Os webinarios (nao apagados) entre estes ids, com o titulo. */
async function existingWebinars(db: WebinarsDb, ids: readonly string[]) {
  const found = new Map<string, string>();

  for (const part of chunks(ids, IDS_CHUNK)) {
    const { data, error } = await db.from("webinars").select("id,title").in("id", part).is("deleted_at", null);
    assertNoDbError(error, "Webinarios: webinarios das regras do segmento");

    for (const row of (data ?? []) as { id: string; title: string | null }[]) {
      found.set(row.id, row.title?.trim() ?? "");
    }
  }

  return found;
}

/**
 * Titulos dos webinarios citados por regras "Webinário" (a frase do segmento). Apagado ou inexistente fica sem
 * titulo ("um webinário removido"); banco sem webinarios devolve {}.
 */
export async function loadWebinarFollowUpNames(db: WebinarsDb, webinarIds: readonly string[]): Promise<Record<string, string>> {
  const ids = uniqueIds(webinarIds);

  if (ids.length === 0) {
    return {};
  }

  try {
    return Object.fromEntries(Array.from(await existingWebinars(db, ids)).filter(([, title]) => title));
  } catch (error) {
    if (isPendingFollowUpMigration(error)) {
      return {};
    }

    throw error;
  }
}

/**
 * Os fatos do follow-up destes webinarios, por aluno (com `userIds`, so destes alunos). Webinario apagado fica fora
 * de `loadedIds`; banco sem a migracao 202610290005 (ou sem webinarios) devolve nada lido.
 */
export async function loadWebinarFollowUpFacts(db: WebinarsDb, webinarIds: readonly string[], options: { userIds?: readonly string[] } = {}): Promise<WebinarFollowUpRead> {
  const byUser = new Map<string, Record<string, WebinarFollowUpFact>>();
  const ids = uniqueIds(webinarIds);

  if (ids.length === 0 || options.userIds?.length === 0) {
    return { byUser, loadedIds: [] };
  }

  let rows: FollowUpFactsRow[];
  let loadedIds: string[];

  try {
    const existing = await existingWebinars(db, ids);
    loadedIds = ids.filter((id) => existing.has(id));

    if (loadedIds.length === 0) {
      return { byUser, loadedIds };
    }

    rows = await fetchAll<FollowUpFactsRow>(
      (from, to) => db.rpc("webinar_follow_up_facts", { p_webinar_ids: loadedIds }).order("webinar_id").order("user_id").range(from, to),
      "Webinarios: fatos do follow-up"
    );
  } catch (error) {
    if (isPendingFollowUpMigration(error)) {
      console.error(`[comunicacao] regra "Webinário" sem fatos (migracao ${WEBINARS_OFFERS_MIGRATION} pendente): ela nao combina com ninguem por enquanto.`);

      return { byUser: new Map(), loadedIds: [] };
    }

    throw error;
  }

  const wanted = options.userIds ? new Set(options.userIds) : null;
  const loaded = new Set(loadedIds);

  for (const row of rows) {
    if (!row.user_id || !loaded.has(row.webinar_id) || (wanted && !wanted.has(row.user_id))) {
      continue;
    }

    const { userId, webinarId, ...fact } = followUpFactsFromRow(row);
    byUser.set(userId, { ...byUser.get(userId), [webinarId]: fact });
  }

  return { byUser, loadedIds };
}
