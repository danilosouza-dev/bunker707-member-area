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
// Os participantes simulados mudados a qualquer momento (docs/30 D79, 11/11/2026) pegam a mesma carona: toda mudanca
// regrava a decisao da Simulacao na linha da sessao (o carimbo muda), e o estado leva `simulationKey` (o resumo da hora
// da decisao, sem consulta a mais: a sessao ja esta lida); a sala pede a janela da Simulacao de novo so quando ele muda.
// As metricas do aluno (especificacao de 10/11/2026, §5.5 e §7; a rota POST .../screen-events): cada evento (viu,
// clicou, fechou) so vale para uma exibicao de banner ou QR Code daquela sessao. Os ids das exibicoes de cada sessao
// ficam 30 s na memoria do processo (ate 500 sessoes); um id que a memoria nao conhece rele as exibicoes no maximo uma
// vez a cada 5 s por sessao e, continuando desconhecido, e descartado em silencio (o lote de outra sessao, um id
// inventado). A linha de student_events leva entity_type 'webinar', entity_id = a sessao e o metadata { display_id,
// item_id, kind, form, target, offset_ms }, com o offset do relogio do servidor (o mesmo do chat). Um aluno em laco nao
// infla os numeros (revisao de 11/11/2026, S2): uma memoria limitada do processo por (aluno, exibicao) descarta o "viu"
// e o "fechou" repetidos e deixa no maximo um clique a cada 3 s e 20 por exibicao; o "fechou" de um item que nao fecha
// (pela copia mostrada) e qualquer evento de uma exibicao que saiu da tela ha mais de 60 s ficam de fora (a saida vem
// da mesma leitura das exibicoes, que fica ate 30 s na memoria).
// O relatorio da sessao (§7): todas as exibicoes da sessao e os numeros de webinar_screen_report (alunos distintos, a
// equipe de fora), as duas leituras vazias sem a migracao; quem monta as linhas do bloco e report-page-model.ts.

import "server-only";

import { cleanEnvValue } from "../../lib/env-value";
import type { StudentEventInsert } from "../students/store";
import { loadAuthorPhotos } from "./author-photos";
import { personaAvatarUrl } from "./persona-model";
import { loadScriptedMessageAvatars, loadScriptedQuestionAvatars } from "./persona-store";
import { chatMessageFromRow, questionFromRow } from "./chat-rows";
import { CHAT_MESSAGES } from "./chat-schemas";
import { fetchChatMessageRow, fetchPinnedMessageRow, fetchQuestionRow } from "./chat-store";
import { WebinarError, type WebinarsDb } from "./db";
import type { ChatMessage, WebinarSession } from "./model";
import { authorPhotoUrl, sessionOffsetMs, toStudentMessage } from "./room-model";
import { questionVisibleAt } from "./room-rules";
import { messageBelongsToSession, screenCommentOfMessage, screenCommentOfQuestion, type StudentScreenComment } from "./screen-comment-model";
import { fetchActiveScreenCommentRow, screenCommentFromRow } from "./screen-comment-store";
import {
  SCREEN_EVENT_TYPES,
  SCREEN_KINDS,
  emptyScreenState,
  pollsKeyOf,
  screenShowsIn,
  simulationKeyOf,
  studentScreenItem,
  type ScreenDisplay,
  type ScreenKind,
  type StudentScreenItem,
  type StudentScreenState
} from "./screen-model";
import { screenDisplayFromRow, screenStatsFromRows, type ScreenStats } from "./screen-rows";
import { parseScreenSnapshot, type ScreenEventsBody } from "./screen-schemas";
import { fetchScreenReportRows, listActiveScreenDisplayRows, listSessionPollKeyRows, listSessionScreenDisplayRows } from "./screen-store";

/** Quanto o estado de uma sessao vale na memoria do processo (com o mesmo carimbo). */
export const SCREEN_STATE_TTL_MS = 30_000;
/** Quantas sessoes a memoria guarda; passou disso, a mais antiga sai. */
export const SCREEN_STATE_CACHE_MAX = 500;

/** A parte do estado que e igual para todos os alunos da sessao. */
type SharedScreen = {
  /** O comentario ou a pergunta na tela (docs/30 D89): igual para todos (o cartao nao diz "Você"). */
  comment: StudentScreenComment | null;
  items: StudentScreenItem[];
  pinned: { avatarUrl: string | null; message: ChatMessage } | null;
  pinnedPollId: string | null;
  pollsKey: string;
  /** O resumo da decisao da Simulacao (D79): a mesma linha da sessao, entao vale pelo mesmo carimbo. */
  simulationKey: string;
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

/**
 * O comentario ou a pergunta que esta na tela, lido da origem (docs/30 D89): a exibicao guarda so a referencia, entao a
 * mensagem apagada, a que voltou a esperar a equipe, a de outra sessao e a pergunta apagada ou dispensada nao aparecem
 * (nulo). A foto pela regra da turma (authorPhotoUrl, viewer "student": a da equipe sempre, a do aluno com o aceite em
 * dia, a da pessoa que comenta no roteiro). Uma leitura a mais so com algo na tela; sem a 202611150001, nada.
 */
export async function loadScreenComment(db: WebinarsDb, session: Pick<WebinarSession, "id" | "webinarId">, nowMs: number): Promise<StudentScreenComment | null> {
  const row = await fetchActiveScreenCommentRow(db, session.id);
  const display = row ? screenCommentFromRow(row) : null;

  if (!display) {
    return null;
  }

  if (display.source === "chat") {
    const messageRow = display.messageId ? await fetchChatMessageRow(db, display.messageId) : null;

    if (!messageRow || messageRow.deleted_at) {
      return null;
    }

    const message = chatMessageFromRow(messageRow);

    if (!messageBelongsToSession(message, session)) {
      return null;
    }

    const [photos, personas] = await Promise.all([
      loadAuthorPhotos(db, [message.authorUserId], nowMs),
      message.source === "scripted" ? loadScriptedMessageAvatars(db, [message.id], nowMs) : Promise.resolve(new Map<string, string>())
    ]);

    return screenCommentOfMessage(
      display,
      message,
      authorPhotoUrl({
        authorUserId: message.authorUserId,
        displayName: message.displayName,
        personaAvatarUrl: personaAvatarUrl(personas.get(message.id), screenStorageOrigin()),
        photo: message.authorUserId ? photos.get(message.authorUserId) : null,
        source: message.source,
        viewer: "student",
        webinarId: message.webinarId
      })
    );
  }

  const questionRow = display.questionId ? await fetchQuestionRow(db, display.questionId) : null;

  if (!questionRow || questionRow.deleted_at) {
    return null;
  }

  const question = questionFromRow(questionRow);

  if (question.sessionId !== session.id || !questionVisibleAt(question, nowMs)) {
    return null;
  }

  const [photos, personas] = await Promise.all([
    loadAuthorPhotos(db, [question.userId], nowMs),
    question.simulated ? loadScriptedQuestionAvatars(db, [question.id], nowMs) : Promise.resolve(new Map<string, string>())
  ]);
  const avatarUrl = question.simulated
    ? authorPhotoUrl({ authorUserId: null, displayName: question.displayName, personaAvatarUrl: personaAvatarUrl(personas.get(question.id), screenStorageOrigin()), photo: null, source: "scripted", viewer: "student", webinarId: session.webinarId })
    : authorPhotoUrl({
        anonymous: question.anonymous,
        authorUserId: question.userId,
        displayName: question.displayName,
        photo: question.userId ? photos.get(question.userId) : null,
        source: "audience",
        viewer: "student",
        webinarId: session.webinarId
      });

  return screenCommentOfQuestion(display, question, avatarUrl);
}

async function buildSharedScreen(db: WebinarsDb, session: WebinarSession, nowMs: number): Promise<SharedScreen> {
  const [displayRows, pinnedRow, pollRows, comment] = await Promise.all([
    listActiveScreenDisplayRows(db, session.id),
    fetchPinnedMessageRow(db, session.pinnedMessageId),
    listSessionPollKeyRows(db, session.id),
    loadScreenComment(db, session, nowMs)
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
    // A fixada do roteiro mostra a foto de quem comenta (R9), como no chat.
    const [photos, personas] = await Promise.all([
      loadAuthorPhotos(db, [message.authorUserId], nowMs),
      message.source === "scripted" ? loadScriptedMessageAvatars(db, [message.id], nowMs) : Promise.resolve(new Map<string, string>())
    ]);
    pinned = {
      avatarUrl: authorPhotoUrl({
        authorUserId: message.authorUserId,
        displayName: message.displayName,
        personaAvatarUrl: personaAvatarUrl(personas.get(message.id), screenStorageOrigin()),
        photo: message.authorUserId ? photos.get(message.authorUserId) : null,
        source: message.source,
        viewer: "student",
        webinarId: message.webinarId
      }),
      message
    };
  }

  return {
    comment,
    items,
    pinned,
    pinnedPollId: displays.find((display) => display.kind === "poll" && display.hiddenAt === null)?.pollId ?? null,
    pollsKey: pollsKeyOf(pollRows.map((row) => ({ id: row.id, resultsShared: row.results_shared_at !== null, status: row.status }))),
    simulationKey: simulationKeyOf(session.simulationDecidedAt),
    stamp: session.updatedAt
  };
}

/** O estado de um aluno a partir da parte comum: so o `mine` da fixada muda de aluno para aluno. */
function screenStateFor(shared: SharedScreen, viewerUserId: string, sessionKind: WebinarSession["kind"]): StudentScreenState {
  return {
    // So com algo na tela (sem a chave, o estado fica como antes: a sala trata a falta como sem comentario).
    ...(shared.comment ? { comment: shared.comment } : {}),
    items: shared.items,
    pinned: shared.pinned ? toStudentMessage(shared.pinned.message, viewerUserId, sessionKind, shared.pinned.message.offsetMs, shared.pinned.avatarUrl) : null,
    pinnedPollId: shared.pinnedPollId,
    pollsKey: shared.pollsKey,
    // So com a decisao registrada (sem ela, o estado fica como antes: a sala trata a falta como sem mudanca).
    ...(shared.simulationKey ? { simulationKey: shared.simulationKey } : {}),
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

/* ------------------------------------------------------------------------------------------------
 * Os numeros de cada exibicao para o console (Na tela agora: "312 viram · 41 clicaram · 9 fecharam")
 * ---------------------------------------------------------------------------------------------- */

/** Quanto os numeros de uma sessao valem na memoria do processo: o retrato de 5 s chama a funcao no maximo a cada 10 s. */
export const SCREEN_STATS_TTL_MS = 10_000;
const statsMemory = new Map<string, { at: number; value: Promise<Record<string, ScreenStats>> }>();

/** Esvazia a memoria dos numeros (os testes). */
export function clearScreenStatsCache() {
  statsMemory.clear();
}

/**
 * Os numeros por exibicao de uma sessao (webinar_screen_report: alunos distintos, a equipe de fora), guardados 10 s por
 * sessao. Sem a migracao, nenhum; a falha da leitura nao fica guardada.
 */
export async function loadScreenStats(db: WebinarsDb, sessionId: string, nowMs: number = Date.now()): Promise<Record<string, ScreenStats>> {
  const hit = statsMemory.get(sessionId);

  if (hit && nowMs - hit.at < SCREEN_STATS_TTL_MS) {
    return hit.value;
  }

  const value = fetchScreenReportRows(db, sessionId).then((rows) => Object.fromEntries(screenStatsFromRows(rows)));
  statsMemory.delete(sessionId);
  if (statsMemory.size >= SCREEN_STATE_CACHE_MAX) {
    const oldest = statsMemory.keys().next().value;
    if (oldest !== undefined) {
      statsMemory.delete(oldest);
    }
  }
  statsMemory.set(sessionId, { at: nowMs, value });
  value.catch(() => {
    if (statsMemory.get(sessionId)?.value === value) {
      statsMemory.delete(sessionId);
    }
  });
  return value;
}

/* ------------------------------------------------------------------------------------------------
 * As metricas do aluno: POST .../screen-events (§5.5)
 * ---------------------------------------------------------------------------------------------- */

/** Quanto os ids das exibicoes de uma sessao valem na memoria do processo. */
export const SCREEN_DISPLAY_IDS_TTL_MS = 30_000;
/** Um id desconhecido rele as exibicoes da sessao no maximo uma vez neste intervalo. */
export const SCREEN_DISPLAY_IDS_RETRY_MS = 5_000;

/**
 * O que a rota precisa de cada exibicao: o item e o tipo (so banner e QR Code medem), se a copia mostrada deixa o aluno
 * fechar e quando saiu da tela (nulo: na tela).
 */
export type ScreenDisplayKey = { closable: boolean; hiddenAtMs: number | null; itemId: string | null; kind: ScreenKind };

/** Os cliques de um aluno numa exibicao que contam: um a cada 3 s, ate 20. */
export const SCREEN_CLICK_GAP_MS = 3_000;
export const SCREEN_CLICKS_MAX = 20;
/** Quanto depois de sair da tela um evento da exibicao ainda conta (o fechar ou o clique que chegou atrasado). */
export const SCREEN_EVENT_AFTER_HIDE_MS = 60_000;
/** Quantos pares (aluno, exibicao) a memoria dos eventos guarda; passou disso, o mais antigo sai. */
export const SCREEN_EVENT_MEMORY_MAX = 50_000;

type ScreenEventSeen = { clicks: number; closed: boolean; lastClickAt: number; shown: boolean };

const eventsSeen = new Map<string, ScreenEventSeen>();

/**
 * O evento conta? "viu" e "fechou" uma vez por (aluno, exibicao) neste processo; o clique, um a cada 3 s e ate 20. A
 * memoria guarda o par como o mais novo (o mais antigo sai quando passa do teto).
 */
function screenEventCounts(userId: string, displayId: string, name: ScreenEventsBody["events"][number]["name"], nowMs: number): boolean {
  const memo = `${userId}:${displayId}`;
  const seen = eventsSeen.get(memo) ?? { clicks: 0, closed: false, lastClickAt: Number.NEGATIVE_INFINITY, shown: false };
  if (name === "shown") {
    if (seen.shown) {
      return false;
    }
    seen.shown = true;
  } else if (name === "closed") {
    if (seen.closed) {
      return false;
    }
    seen.closed = true;
  } else {
    if (seen.clicks >= SCREEN_CLICKS_MAX || nowMs - seen.lastClickAt < SCREEN_CLICK_GAP_MS) {
      return false;
    }
    seen.clicks += 1;
    seen.lastClickAt = nowMs;
  }
  eventsSeen.delete(memo);
  while (eventsSeen.size >= SCREEN_EVENT_MEMORY_MAX) {
    const oldest = eventsSeen.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    eventsSeen.delete(oldest);
  }
  eventsSeen.set(memo, seen);
  return true;
}

type DisplayIdsEntry = { at: number; value: Promise<Map<string, ScreenDisplayKey>> };

const displayIdsMemory = new Map<string, DisplayIdsEntry>();

/** Esvazia a memoria dos ids das exibicoes e a dos eventos ja contados (os testes). */
export function clearScreenDisplayIdsCache() {
  displayIdsMemory.clear();
  eventsSeen.clear();
}

async function readDisplayKeys(db: WebinarsDb, sessionId: string): Promise<Map<string, ScreenDisplayKey>> {
  const rows = await listSessionScreenDisplayRows(db, sessionId);
  const keys = new Map<string, ScreenDisplayKey>();
  for (const row of rows) {
    const kind = (SCREEN_KINDS as readonly string[]).includes(row.kind) ? (row.kind as ScreenKind) : null;
    if (kind) {
      const hiddenAtMs = row.hidden_at ? Date.parse(row.hidden_at) : Number.NaN;
      keys.set(row.id.toLowerCase(), {
        closable: parseScreenSnapshot(kind, row.snapshot)?.closable === true,
        hiddenAtMs: Number.isFinite(hiddenAtMs) ? hiddenAtMs : null,
        itemId: row.item_id,
        kind
      });
    }
  }
  return keys;
}

function freshDisplayKeys(db: WebinarsDb, sessionId: string, nowMs: number): DisplayIdsEntry {
  const entry: DisplayIdsEntry = { at: nowMs, value: readDisplayKeys(db, sessionId) };
  displayIdsMemory.delete(sessionId);
  while (displayIdsMemory.size >= SCREEN_STATE_CACHE_MAX) {
    const oldest = displayIdsMemory.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    displayIdsMemory.delete(oldest);
  }
  displayIdsMemory.set(sessionId, entry);
  entry.value.catch(() => {
    if (displayIdsMemory.get(sessionId) === entry) {
      displayIdsMemory.delete(sessionId);
    }
  });
  return entry;
}

/**
 * As exibicoes de banner e QR Code de uma sessao (id -> item e tipo): da memoria por 30 s; quando algum dos ids pedidos
 * (`wanted`) nao esta la, rele no maximo uma vez a cada 5 s por sessao (uma exibicao nova, mostrada depois da ultima
 * leitura). O que continua desconhecido fica de fora (quem chama descarta).
 */
export async function sessionScreenDisplayKeys(db: WebinarsDb, sessionId: string, wanted: readonly string[], nowMs: number = Date.now()): Promise<Map<string, ScreenDisplayKey>> {
  let entry = displayIdsMemory.get(sessionId);
  if (!entry || nowMs - entry.at >= SCREEN_DISPLAY_IDS_TTL_MS) {
    entry = freshDisplayKeys(db, sessionId, nowMs);
  }
  let keys = await entry.value;
  if (wanted.some((id) => !keys.has(id)) && nowMs - entry.at >= SCREEN_DISPLAY_IDS_RETRY_MS) {
    entry = freshDisplayKeys(db, sessionId, nowMs);
    keys = await entry.value;
  }
  return keys;
}

/**
 * As linhas de student_events de um lote de metricas da Na tela: so na Live ao vivo e na gravada (o Replay e 404: la
 * nada aparece na tela); cada evento so de uma exibicao de banner ou QR Code desta sessao, nunca de uma que saiu ha
 * mais de 60 s, o "fechou" so de um item que fecha, e sem os repetidos (screenEventCounts); o resto sai em silencio. O
 * offset e o do relogio do servidor (o do chat da sessao), nulo quando a sessao nao tem relogio.
 */
export async function screenEventRows(input: {
  db: WebinarsDb;
  events: ScreenEventsBody["events"];
  nowMs: number;
  session: Pick<WebinarSession, "id" | "kind" | "recordingAnchorAt" | "scheduledAt" | "startedAt">;
  userId: string;
}): Promise<StudentEventInsert[]> {
  const { db, events, nowMs, session, userId } = input;
  if (session.kind !== "live" && session.kind !== "simulated") {
    throw new WebinarError(CHAT_MESSAGES.session, 404);
  }
  const wanted = events.map((event) => event.displayId.toLowerCase());
  const keys = await sessionScreenDisplayKeys(db, session.id, wanted, nowMs);
  const offset = sessionOffsetMs(session, nowMs);
  const offsetMs = Number.isFinite(offset) ? Math.round(offset) : null;

  return events.flatMap((event, index) => {
    const displayId = wanted[index];
    const key = keys.get(displayId);
    if (!key || (key.hiddenAtMs !== null && nowMs - key.hiddenAtMs > SCREEN_EVENT_AFTER_HIDE_MS) || (event.name === "closed" && !key.closable)) {
      return [];
    }
    if (!screenEventCounts(userId, displayId, event.name, nowMs)) {
      return [];
    }
    return [
      {
        entity_id: session.id,
        entity_type: "webinar",
        event_type: SCREEN_EVENT_TYPES[event.name],
        metadata: { display_id: displayId, form: event.form, item_id: key.itemId, kind: key.kind, offset_ms: offsetMs, target: event.target ?? null },
        user_id: userId
      }
    ];
  });
}

/* ------------------------------------------------------------------------------------------------
 * O relatorio da sessao: o bloco "Na tela" (§7)
 * ---------------------------------------------------------------------------------------------- */

/** As exibicoes da sessao (na ordem em que entraram) e os numeros de cada uma (por id da exibicao). */
export type ScreenReportData = { displays: ScreenDisplay[]; stats: Record<string, ScreenStats> };

/**
 * O que o bloco "Na tela" do relatorio le: todas as exibicoes da sessao e os numeros de webinar_screen_report (as duas
 * leituras em paralelo; sem a migracao, as duas voltam vazias e o bloco nao aparece). Objetos simples: entra no cache
 * de 60 s do relatorio (report-queries.ts).
 */
export async function loadScreenReport(db: WebinarsDb, sessionId: string): Promise<ScreenReportData> {
  const [rows, reportRows] = await Promise.all([listSessionScreenDisplayRows(db, sessionId), fetchScreenReportRows(db, sessionId)]);
  return {
    displays: rows.map(screenDisplayFromRow).filter((display): display is ScreenDisplay => display !== null),
    stats: Object.fromEntries(screenStatsFromRows(reportRows))
  };
}
