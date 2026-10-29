// O follow-up das lives (docs/30 §1.6 e §4.7, D49): o que as acoes do follow-up da regra "Participação em lives" da
// Comunicacao (viu o replay, viu o card de compra, saiu antes dele, clicou e nao comprou, comprou pelo card) leem do
// banco: o que cada aluno fez em cada live citada (RPC webinar_follow_up_facts da migracao 202610290005: tira a equipe
// e nunca le a Simulacao). Quem le e o carregador da Comunicacao (loadAudienceWebinarFacts em audience-facts.ts e o do
// tick em facts-loader.ts), uma vez por tick para cada live; a avaliacao e audience-model.ts. A vaga e a presenca da
// mesma regra vem de communication_webinar_facts (audience-facts.ts), nunca daqui.
//
// Live apagada (ou que nao existe) nao e lida: a regra que a cita nunca combina, negada ou nao. Banco sem a
// 202610290005: nenhuma live e lida (a mesma regra), com um log; o resto do segmento segue. A RPC devolve uma linha por
// aluno e live e o PostgREST corta qualquer resposta em 1000 linhas (RPC tambem): a leitura e paginada em ordem
// (webinar_id, user_id), como fetchWebinarFollowUpFacts (offer-store.ts), e aqui filtra antes as lives apagadas e
// devolve o formato da Comunicacao.

import "server-only";

import type { WebinarFollowUpFact } from "../communications/audience-model";
import { isPendingMigrationError } from "../db/pending-migration";
import { assertNoDbError, isMissingWebinarSchema, WEBINARS_OFFERS_MIGRATION, type WebinarsDb } from "./db";
import { followUpFactsFromRow, type FollowUpFactsRow } from "./rows";
import { fetchAll } from "./store";

/** Ids por leitura de webinars (o filtro `in` vai na URL). */
const IDS_CHUNK = 150;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** userId -> { id da live: o que o aluno fez nela }; `loadedIds` = as lives lidas (as outras nunca combinam). */
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

/** As lives (nao apagadas) entre estes ids. */
async function existingWebinars(db: WebinarsDb, ids: readonly string[]) {
  const found = new Set<string>();

  for (const part of chunks(ids, IDS_CHUNK)) {
    const { data, error } = await db.from("webinars").select("id").in("id", part).is("deleted_at", null);
    assertNoDbError(error, "Webinarios: lives das regras do segmento");

    for (const row of (data ?? []) as { id: string }[]) {
      found.add(row.id);
    }
  }

  return found;
}

/**
 * O follow-up destas lives, por aluno (com `userIds`, so destes alunos). Live apagada fica fora de `loadedIds`; banco
 * sem a migracao 202610290005 (ou sem webinarios) devolve nada lido.
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
      console.error(`[comunicacao] follow-up das lives sem fatos (migracao ${WEBINARS_OFFERS_MIGRATION} pendente): as acoes dele nao combinam com ninguem por enquanto.`);

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

    const fact = followUpFactsFromRow(row);
    const own: WebinarFollowUpFact = {
      clicked: fact.clicked,
      leftBeforeOffer: fact.leftBeforeOffer,
      offerSeen: fact.offerSeen,
      purchased: fact.purchased,
      watchedReplay: fact.watchedReplay
    };
    byUser.set(fact.userId, { ...byUser.get(fact.userId), [fact.webinarId]: own });
  }

  return { byUser, loadedIds };
}
