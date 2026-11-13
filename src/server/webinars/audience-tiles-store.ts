import "server-only";

import { isPendingMigrationError } from "@/server/db/pending-migration";
import { NO_AUDIENCE_TILES, audienceTilesPossible, audienceTilesRoster, type AudienceTilesFeed } from "./audience-tiles-model";
import { isMissingWebinarSchema, type WebinarsDb } from "./db";
import type { WebinarSession } from "./model";
import { listPersonas } from "./persona-store";
import { screenStorageOrigin } from "./screen-queries";
import { simulationDecisionRecorded } from "./simulation-model";
import { fetchSessionSimulationFeed } from "./simulation-store";

// Os participantes simulados nas miniaturas da live (docs/30 D117): a lista de uma sessao, lida do banco. Uma leitura
// da linha da sessao (as regras, a decisao e a situacao de agora, como a rota da Simulacao) e uma da lista de pessoas
// que comentam; a conta e de audience-tiles-model.ts. A turma inteira pede a lista ao entrar e a cada mudanca da
// decisao: a resposta fica 30 s na memoria do processo por sessao (a pessoa criada ou a foto trocada no console chega
// em ate 30 s). So a Live ao vivo: a Live gravada nao tem o motor de video.

/** Quanto a lista de uma sessao vale na memoria do processo. */
export const AUDIENCE_TILES_CACHE_MS = 30_000;
const CACHE_MAX = 200;

type Entry = { expiresAt: number; feed: AudienceTilesFeed };
const memory = new Map<string, Entry>();

/** So para os testes: a memoria do processo zerada. */
export function resetAudienceTilesCache() {
  memory.clear();
}

/**
 * A lista dos simulados da sessao, ou desligado com a lista vazia: sessao que nao e a Live ao vivo, cancelada ou
 * encerrada, sem a decisao registrada (§8.6), sem participantes simulados possiveis, sem a linha, ou banco sem as
 * colunas da Simulacao. Banco sem a lista de pessoas (202611140001): so os nomes genericos.
 */
export async function loadAudienceTiles(db: WebinarsDb, input: { session: Pick<WebinarSession, "id" | "kind">; webinarId: string }, nowMs: number = Date.now()): Promise<AudienceTilesFeed> {
  if (input.session.kind !== "live") {
    return NO_AUDIENCE_TILES;
  }
  const cached = memory.get(input.session.id);
  if (cached && cached.expiresAt > nowMs) {
    return cached.feed;
  }

  let fresh: Awaited<ReturnType<typeof fetchSessionSimulationFeed>>;
  try {
    fresh = await fetchSessionSimulationFeed(db, input.session.id);
  } catch (error) {
    if (isPendingMigrationError(error) || isMissingWebinarSchema(error)) {
      return NO_AUDIENCE_TILES;
    }
    throw error;
  }

  let feed = NO_AUDIENCE_TILES;
  if (fresh && fresh.state.status !== "cancelled" && fresh.state.status !== "ended" && simulationDecisionRecorded(fresh.state) && audienceTilesPossible(fresh.simulation)) {
    const { personas } = await listPersonas(db, input.webinarId);
    feed = { enabled: true, people: audienceTilesRoster({ origin: screenStorageOrigin(), personas, seed: fresh.simulation.seed }) };
  }

  memory.delete(input.session.id);
  while (memory.size >= CACHE_MAX) {
    const oldest = memory.keys().next();
    if (oldest.done) {
      break;
    }
    memory.delete(oldest.value);
  }
  memory.set(input.session.id, { expiresAt: nowMs + AUDIENCE_TILES_CACHE_MS, feed });
  return feed;
}
