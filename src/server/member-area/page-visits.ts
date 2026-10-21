import "server-only";

// Visitas das paginas da area do aluno (Comunicacao v2, docs/23 §5.2): a ultima visita de cada aluno a
// cada pagina que um fluxo no ar (ou pausado) acompanha, para as regras "visitou a pagina" e "clicou em
// Comprar". Gravada no servidor pela pagina que ja renderizou (sem pedido extra nem ida ao Auth) e, para
// as duas acoes que nao sao navegacao (abrir os detalhes do produto e clicar em Comprar), pelo beacon
// POST /api/page-visits. Nada e gravado:
// - para pagina que nenhum fluxo acompanha (lista curta em cache, 60 s, tag "communications": toda
//   acao de fluxo chama invalidateLivePopups, que ja atualiza essa tag);
// - no "ver como" da equipe, para a equipe e num prefetch do Next (que para no loading.tsx; a conferencia
//   do cabecalho e so por garantia);
// - de novo para o mesmo aluno e pagina antes de 10 s (PAGE_VISIT_THROTTLE_MS; memoria do processo; um
//   servidor so): so absorve recarga e redirecionamento, porque o motor compara a hora exata.
// A gravacao roda depois da resposta (after() do Next); fora de um pedido, roda na hora e fica guardada
// para settlePageVisits() (testes de integracao, scripts). Falha vira log e nunca derruba a pagina.

import { headers } from "next/headers";
import { unstable_cache } from "next/cache";
import { after } from "next/server";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { getAdminAccessForUser } from "@/server/auth/session";
import { COMMUNICATIONS_TAG } from "@/server/communications/cache";
import { assertNoDbError, communicationsDb, describeError, isMissingCommunicationSchema } from "@/server/communications/db";
import { isPageKey, PAGE_VISIT_THROTTLE_MS } from "./page-visit-model";

export type TrackMemberPageVisitInput = {
  /** "Ver como" da equipe: nunca grava. */
  accessPreviewMode?: AccessPreviewMode;
  /** Relogio simulado dos testes de integracao; padrao, a hora atual. */
  now?: Date;
  /** Chave de page-visit-model.ts (pageKeyOfRoute, contentPageKey...); null = pagina nao acompanhada. */
  pageKey: string | null;
  userId: string;
};

export { PAGE_VISIT_THROTTLE_MS };
const THROTTLE_MAX_ENTRIES = 10_000;
// Fluxos ativos e pausados sao poucos; o limite so protege a consulta.
const WATCHED_FLOWS_LIMIT = 1_000;
const WATCHED_PAGE_KEYS_CACHE_KEY = ["communications-watched-page-keys"];

/** Chave "aluno|pagina" -> hora (ms) da ultima gravacao agendada. */
const lastWrites = new Map<string, number>();

/** Gravacoes que rodaram fora de um pedido do Next (testes de integracao, scripts). */
const pending = new Set<Promise<void>>();

async function loadWatchedPageKeys(): Promise<string[]> {
  const { data, error } = await communicationsDb()
    .from("communication_flows")
    .select("watched_page_keys")
    .in("status", ["active", "paused"])
    .is("deleted_at", null)
    .limit(WATCHED_FLOWS_LIMIT);

  if (error) {
    // Banco sem a migracao 202610200002: nenhum fluxo, nada para acompanhar.
    if (isMissingCommunicationSchema(error)) {
      return [];
    }

    assertNoDbError(error, "Paginas acompanhadas pelos fluxos");
  }

  const keys = new Set<string>();

  for (const row of (data ?? []) as { watched_page_keys: string[] | null }[]) {
    for (const key of row.watched_page_keys ?? []) {
      if (isPageKey(key)) {
        keys.add(key);
      }
    }
  }

  return [...keys].sort();
}

/** Paginas que algum fluxo ativo ou pausado acompanha (uniao de communication_flows.watched_page_keys). */
export const getWatchedPageKeys = unstable_cache(loadWatchedPageKeys, WATCHED_PAGE_KEYS_CACHE_KEY, {
  revalidate: 60,
  tags: [COMMUNICATIONS_TAG]
});

/** Prefetch do Next (e prefetch do proprio navegador) nao e visita. */
function isPrefetchRequest(requestHeaders: Headers) {
  return Boolean(requestHeaders.get("next-router-prefetch")) || /prefetch/i.test(requestHeaders.get("sec-purpose") ?? requestHeaders.get("purpose") ?? "");
}

/** Reserva a gravacao; false quando a ultima do mesmo aluno e pagina e mais nova que PAGE_VISIT_THROTTLE_MS. */
function claimWriteSlot(userId: string, pageKey: string, nowMs: number) {
  const slot = `${userId}|${pageKey}`;
  const last = lastWrites.get(slot);

  if (last !== undefined && nowMs - last >= 0 && nowMs - last < PAGE_VISIT_THROTTLE_MS) {
    return false;
  }

  if (lastWrites.size >= THROTTLE_MAX_ENTRIES) {
    lastWrites.clear();
  }

  lastWrites.set(slot, nowMs);
  return true;
}

/**
 * Grava a visita: atualiza last_visited_at (so para frente) e, sem linha ainda, insere com a primeira e a
 * ultima visita na mesma hora. Nao e um upsert direto porque first_visited_at tem default now() do banco,
 * que e sempre um pouco depois da hora do app: o check last_visited_at >= first_visited_at recusaria a
 * primeira visita. Nunca lanca: erro vira log "[visitas] ...".
 */
async function writePageVisit(userId: string, pageKey: string, visitedAt: Date) {
  try {
    const db = communicationsDb();
    const visitedAtIso = visitedAt.toISOString();
    const updated = await db
      .from("member_page_visits")
      .update({ last_visited_at: visitedAtIso })
      .eq("user_id", userId)
      .eq("page_key", pageKey)
      .lt("last_visited_at", visitedAtIso)
      .select("user_id");

    if (updated.error) {
      throw new Error(updated.error.message);
    }

    if ((updated.data ?? []).length > 0) {
      return;
    }

    // Sem linha (primeira visita) ou com uma visita mais nova ja gravada: on conflict do nothing.
    const inserted = await db
      .from("member_page_visits")
      .upsert(
        { first_visited_at: visitedAtIso, last_visited_at: visitedAtIso, page_key: pageKey, user_id: userId },
        { ignoreDuplicates: true, onConflict: "user_id,page_key" }
      );

    if (inserted.error) {
      throw new Error(inserted.error.message);
    }
  } catch (error) {
    console.error(`[visitas] visita a ${pageKey} nao gravada: ${describeError(error)}`);
  }
}

/** Depois da resposta (after() do Next); fora de um pedido, roda na hora e fica guardada em `pending`. */
function schedulePageVisitWrite(task: () => Promise<void>) {
  try {
    after(task);
  } catch {
    const running = task().finally(() => pending.delete(running));
    pending.add(running);
  }
}

/**
 * Registra a visita do aluno a uma pagina da area (ou o clique em Comprar, pelo beacon). Chamada uma vez
 * por pagina, depois de o acesso e os dados resolverem e antes de qualquer redirect(). Nunca lanca e so
 * espera leituras em memoria ou em cache; a gravacao fica para depois da resposta.
 */
export async function trackMemberPageVisit(input: TrackMemberPageVisitInput): Promise<void> {
  const { accessPreviewMode, pageKey, userId } = input;

  if (!pageKey || accessPreviewMode || !userId || !isPageKey(pageKey)) {
    return;
  }

  try {
    if (isPrefetchRequest(await headers())) {
      return;
    }

    const watched = await getWatchedPageKeys();

    if (!watched.includes(pageKey)) {
      return;
    }

    // Memoizado por pedido: a pagina ja leu o papel da pessoa em getAppShellData.
    if (await getAdminAccessForUser(userId)) {
      return;
    }

    const visitedAt = input.now ?? new Date();

    if (!claimWriteSlot(userId, pageKey, visitedAt.getTime())) {
      return;
    }

    schedulePageVisitWrite(() => writePageVisit(userId, pageKey, visitedAt));
  } catch (error) {
    console.error(`[visitas] visita a ${pageKey} nao registrada: ${describeError(error)}`);
  }
}

/** Espera as gravacoes que rodaram fora de um pedido do Next (testes de integracao, scripts). */
export async function settlePageVisits() {
  await Promise.allSettled([...pending]);
}
