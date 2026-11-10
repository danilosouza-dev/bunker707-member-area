// O estado da "Na tela" para a sala (docs/30 §5.1; especificacao de 10/11/2026, §5.2): o que a turma ve na frente da
// sessao (a mensagem fixada, a enquete fixada, o banner e o QR Code) e o resumo das enquetes, pego na consulta de 5 s
// do chat (GET .../chat?tela=<carimbo>) e na leitura da sessao (GET .../session).
//
// O carimbo e webinar_sessions.updated_at, que o gatilho da sessao mantem e que a consulta do chat ja rele a cada pedido
// (loadRoomContext, sem memoria): quem mexe no que a turma ve grava o dado e DEPOIS atualiza a linha da sessao
// (store.touchSessionRow, ou a propria escrita da fixada). Assim:
// - carimbo igual ao do navegador: nada a mandar e nenhuma consulta a mais (quem decide e room-queries.readRecentChat);
// - carimbo diferente: o estado inteiro. A parte que nao depende do aluno fica na memoria do processo por sessao, com a
//   chave sessao + carimbo e validade de 30 s (ate 500 sessoes, a mais antiga sai): 1.000 alunos com o carimbo velho
//   custam 3 leituras pequenas por processo (as exibicoes ativas pelo indice unico, no maximo 3 linhas; a fixada pela
//   chave; id, situacao e resultado das enquetes), mais a foto do autor da fixada, que ja fica 60 s na memoria. Dois
//   pedidos juntos com a memoria fria esperam a mesma leitura. O `mine` da fixada e de cada aluno, sem consulta;
// - Replay, sessao encerrada ou cancelada: o estado vazio, sem consulta.

import "server-only";

import { cleanEnvValue } from "../../lib/env-value";
import { loadAuthorPhotos } from "./author-photos";
import { chatMessageFromRow } from "./chat-rows";
import { fetchPinnedMessageRow } from "./chat-store";
import type { WebinarsDb } from "./db";
import type { ChatMessage, WebinarSession } from "./model";
import { authorPhotoUrl, toStudentMessage } from "./room-model";
import { SCREEN_KINDS, emptyScreenState, pollsKeyOf, screenShowsIn, studentScreenItem, type StudentScreenItem, type StudentScreenState } from "./screen-model";
import { screenDisplayFromRow } from "./screen-rows";
import { listActiveScreenDisplayRows, listSessionPollKeyRows } from "./screen-store";

/** Quanto o estado de uma sessao vale na memoria do processo (com o mesmo carimbo). */
export const SCREEN_STATE_TTL_MS = 30_000;
/** Quantas sessoes a memoria guarda; passou disso, a mais antiga sai. */
export const SCREEN_STATE_CACHE_MAX = 500;

/** A parte do estado que e igual para todos os alunos da sessao. */
type SharedScreen = {
  items: StudentScreenItem[];
  pinned: { avatarUrl: string | null; message: ChatMessage } | null;
  pinnedPollId: string | null;
  pollsKey: string;
  stamp: string;
};

type Entry = { at: number; stamp: string; value: Promise<SharedScreen> };

const memory = new Map<string, Entry>();

/** Esvazia a memoria (os testes). */
export function clearScreenStateCache() {
  memory.clear();
}

/** A origem do nosso Supabase (a mesma de roomPhotoUrl): o endereco da imagem do banner e montado por ela. */
export function screenStorageOrigin(env: Record<string, string | undefined> = process.env): string | null {
  return cleanEnvValue(env.NEXT_PUBLIC_SUPABASE_URL) ?? cleanEnvValue(env.SUPABASE_URL) ?? null;
}

function remember(sessionId: string, entry: Entry) {
  memory.delete(sessionId);
  while (memory.size >= SCREEN_STATE_CACHE_MAX) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    memory.delete(oldest);
  }
  memory.set(sessionId, entry);
}

const KIND_ORDER = new Map<string, number>(SCREEN_KINDS.map((kind, index) => [kind, index]));

async function buildSharedScreen(db: WebinarsDb, session: WebinarSession, nowMs: number): Promise<SharedScreen> {
  const [displayRows, pinnedRow, pollRows] = await Promise.all([
    listActiveScreenDisplayRows(db, session.id),
    fetchPinnedMessageRow(db, session.pinnedMessageId),
    listSessionPollKeyRows(db, session.id)
  ]);
  const origin = screenStorageOrigin();
  const displays = displayRows.map(screenDisplayFromRow).filter((display) => display !== null);
  const items = displays
    .map((display) => studentScreenItem(display, origin))
    .filter((item): item is StudentScreenItem => item !== null)
    .sort((a, b) => (KIND_ORDER.get(a.kind) ?? 0) - (KIND_ORDER.get(b.kind) ?? 0));
  const message = pinnedRow && pinnedRow.approved ? chatMessageFromRow(pinnedRow) : null;
  let pinned: SharedScreen["pinned"] = null;

  if (message) {
    const photos = await loadAuthorPhotos(db, [message.authorUserId], nowMs);
    pinned = {
      avatarUrl: authorPhotoUrl({
        authorUserId: message.authorUserId,
        displayName: message.displayName,
        photo: message.authorUserId ? photos.get(message.authorUserId) : null,
        source: message.source,
        viewer: "student",
        webinarId: message.webinarId
      }),
      message
    };
  }

  return {
    items,
    pinned,
    pinnedPollId: displays.find((display) => display.kind === "poll" && display.hiddenAt === null)?.pollId ?? null,
    pollsKey: pollsKeyOf(pollRows.map((row) => ({ id: row.id, resultsShared: row.results_shared_at !== null, status: row.status }))),
    stamp: session.updatedAt
  };
}

/** O estado de um aluno a partir da parte comum: so o `mine` da fixada muda de aluno para aluno. */
function screenStateFor(shared: SharedScreen, viewerUserId: string, sessionKind: WebinarSession["kind"]): StudentScreenState {
  return {
    items: shared.items,
    pinned: shared.pinned ? toStudentMessage(shared.pinned.message, viewerUserId, sessionKind, shared.pinned.message.offsetMs, shared.pinned.avatarUrl) : null,
    pinnedPollId: shared.pinnedPollId,
    pollsKey: shared.pollsKey,
    stamp: shared.stamp
  };
}

/**
 * O que a turma ve na frente da sessao agora, para `viewerUserId`. Vazio (sem consulta) no Replay e na sessao encerrada
 * ou cancelada. Senao, a parte comum vem da memoria quando o carimbo e o mesmo e tem menos de 30 s; a falha da leitura
 * nao fica guardada (o proximo pedido tenta de novo).
 */
export async function loadScreenState(db: WebinarsDb, session: WebinarSession, viewerUserId: string, nowMs: number = Date.now()): Promise<StudentScreenState> {
  if (!screenShowsIn(session)) {
    return emptyScreenState(session.updatedAt);
  }

  const hit = memory.get(session.id);
  let value: Promise<SharedScreen>;

  if (hit && hit.stamp === session.updatedAt && nowMs - hit.at < SCREEN_STATE_TTL_MS) {
    value = hit.value;
    // A sessao usada vai para o fim da fila (a mais antiga e a que sai).
    memory.delete(session.id);
    memory.set(session.id, hit);
  } else {
    value = buildSharedScreen(db, session, nowMs);
    remember(session.id, { at: nowMs, stamp: session.updatedAt, value });
    value.catch(() => {
      if (memory.get(session.id)?.value === value) {
        memory.delete(session.id);
      }
    });
  }

  return screenStateFor(await value, viewerUserId, session.kind);
}

/**
 * O estado para a consulta de 5 s do chat: nulo quando o navegador nao mandou o carimbo (a pagina aberta com o codigo
 * de antes), quando o carimbo e o mesmo (nenhuma consulta a mais) e no Replay; o estado inteiro quando mudou.
 */
export async function screenStateForChat(db: WebinarsDb, session: WebinarSession, viewerUserId: string, stamp: string | null | undefined, nowMs: number = Date.now()): Promise<StudentScreenState | null> {
  if (stamp === undefined || stamp === null || session.kind === "replay" || stamp === session.updatedAt) {
    return null;
  }

  return loadScreenState(db, session, viewerUserId, nowMs);
}
