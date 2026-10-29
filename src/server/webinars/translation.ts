// A traducao do chat e do roteiro no servidor (docs/30 §1.6, fase 4f): o idioma do aluno (GET/PUT
// /api/webinars/preferences) e as traducoes da sala (GET /api/webinars/[id]/translations). A sala manda os ids das
// mensagens que esta mostrando; aqui so passa o que o aluno pode ver nesta sessao (o recorte de webinar_chat_window:
// a sessao, a linha mestre e a turma do dia na jit, nao apagadas, aprovadas ou dele; o resto e ignorado sem dizer
// se existe), as guardadas voltam (fetchTranslations pela chave translationSourceHash do corpo), as do mesmo idioma
// passam como foram escritas e as que faltam ficam pendentes e entram num lote que roda DEPOIS da resposta (after()
// do Next pela afterReply de room-route.ts; fora de um pedido, na hora) com o teto TRANSLATION_LIMITS.timeoutMs. Cada
// texto e traduzido uma vez por idioma: a chave fica bloqueada na memoria do processo enquanto o lote roda (outro
// aluno pedindo a mesma recebe "pendente") e por TRANSLATION_RETRY_MS depois de uma falha; o banco tambem guarda uma
// vez so (insertTranslations ignora a repetida). O lote nunca lanca: a falha vira log. Limite de pedidos por aluno
// por minuto na memoria. Sem WEBINAR_TRANSLATION_ENABLED=on ou sem a 202610290009, { enabled: false } e o chat como
// foi escrito. LGPD: a traducao guarda so o texto (por hash), nunca quem escreveu; "Remover minhas mensagens" apaga a
// mensagem e a traducao fica sem ligacao com ninguem.

import "server-only";

import { isPendingMigrationError } from "../db/pending-migration";
import type { StudentEventInsert } from "../students/store";
import { assertNoDbError, webinarsDb, type WebinarsDb } from "./db";
import { TRANSLATION_LIMITS, type ChatLanguage, type WebinarSession } from "./model";
import { afterReply } from "./room-route";
import { translationSourceHash } from "./text-hash";
import {
  TRANSLATIONS_OFF,
  TRANSLATION_REQUESTS_PER_MINUTE,
  TRANSLATION_RETRY_MS,
  VIEWER_PREFS_OFF,
  isChatLanguage,
  messageVisibleInSession,
  needsSiblingSessions,
  planTranslations,
  translationGroupOf,
  translationInsertsOf,
  type TranslatableMessageRow,
  type TranslationJob,
  type TranslationsReply,
  type ViewerPrefsReply
} from "./translation-model";
import { gatewayTranslationProvider, TranslationProviderError, type TranslationProvider } from "./translation-provider";
import { fetchTranslations, fetchViewerPrefs, insertTranslations, saveViewerPrefs } from "./translation-store";
import { webinarTranslationEnabled } from "./v4-env";

type Env = Record<string, string | undefined>;

/** O que o teste (ou um script) troca: o banco, o relogio, o ambiente, o provedor, o agendador e o teto de tempo. */
export type TranslationDeps = {
  db?: WebinarsDb;
  env?: Env;
  now?: () => number;
  provider?: TranslationProvider;
  /** Onde o lote roda (padrao: depois da resposta, afterReply). */
  schedule?: (task: () => Promise<void>) => Promise<void>;
  timeoutMs?: number;
};

/* ------------------------------------------------------------------------------------------------
 * A memoria do processo: as chaves sendo traduzidas e o limite por aluno
 * ---------------------------------------------------------------------------------------------- */

const MAX_TRACKED = 20_000;
const blockedUntil = new Map<string, number>();
const requestTimes = new Map<string, number[]>();

function remember<T>(map: Map<string, T>, key: string, value: T) {
  map.delete(key);
  while (map.size >= MAX_TRACKED) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    map.delete(oldest);
  }
  map.set(key, value);
}

const blockKey = (hash: string, language: ChatLanguage) => `${language}:${hash}`;

function isBlocked(hash: string, language: ChatLanguage, nowMs: number): boolean {
  const key = blockKey(hash, language);
  const until = blockedUntil.get(key);
  if (until === undefined) {
    return false;
  }
  if (until <= nowMs) {
    blockedUntil.delete(key);
    return false;
  }
  return true;
}

function block(jobs: readonly TranslationJob[], language: ChatLanguage, untilMs: number) {
  for (const job of jobs) {
    remember(blockedUntil, blockKey(job.hash, language), untilMs);
  }
}

function release(hashes: Iterable<string>, language: ChatLanguage) {
  for (const hash of hashes) {
    blockedUntil.delete(blockKey(hash, language));
  }
}

/** Um pedido de traducao do aluno (janela de 60 s); acima do limite, em quantos segundos pode de novo. */
export function takeTranslationRequest(userId: string, nowMs: number = Date.now()): { ok: boolean; retryAfterSeconds: number } {
  const times = (requestTimes.get(userId) ?? []).filter((time) => nowMs - time < 60_000);
  if (times.length >= TRANSLATION_REQUESTS_PER_MINUTE) {
    const oldest = times[0] ?? nowMs;
    remember(requestTimes, userId, times);
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((60_000 - (nowMs - oldest)) / 1000)) };
  }
  times.push(nowMs);
  remember(requestTimes, userId, times);
  return { ok: true, retryAfterSeconds: 0 };
}

/** Zera as chaves bloqueadas e o limite por aluno (testes). */
export function resetTranslationState() {
  blockedUntil.clear();
  requestTimes.clear();
}

/* ------------------------------------------------------------------------------------------------
 * O idioma do aluno
 * ---------------------------------------------------------------------------------------------- */

/** GET /api/webinars/preferences: sem o env ou sem a 202610290009, desligado e como foi escrito. */
export async function readViewerPreferences(userId: string, deps: Pick<TranslationDeps, "db" | "env"> = {}): Promise<ViewerPrefsReply> {
  if (!webinarTranslationEnabled(deps.env)) {
    return VIEWER_PREFS_OFF;
  }
  try {
    const prefs = await fetchViewerPrefs(deps.db ?? webinarsDb(), userId);
    return { chatLanguage: prefs.chatLanguage, enabled: true };
  } catch (error) {
    if (isPendingMigrationError(error)) {
      return VIEWER_PREFS_OFF;
    }
    throw error;
  }
}

/**
 * PUT /api/webinars/preferences: grava o idioma (nulo = como foi escrito) e o historico webinar_chat_language_set.
 * Desligado ou sem a 202610290009: nada e gravado e a resposta diz desligado.
 */
export async function saveViewerPreferences(
  userId: string,
  chatLanguage: ChatLanguage | null,
  deps: Pick<TranslationDeps, "db" | "env"> = {}
): Promise<{ events: StudentEventInsert[]; reply: ViewerPrefsReply }> {
  if (!webinarTranslationEnabled(deps.env)) {
    return { events: [], reply: VIEWER_PREFS_OFF };
  }
  try {
    const prefs = await saveViewerPrefs(deps.db ?? webinarsDb(), { chatLanguage, userId });
    return {
      events: [{ entity_id: null, entity_type: "webinar", event_type: "webinar_chat_language_set", metadata: { language: prefs.chatLanguage }, user_id: userId }],
      reply: { chatLanguage: prefs.chatLanguage, enabled: true }
    };
  } catch (error) {
    if (isPendingMigrationError(error)) {
      return { events: [], reply: VIEWER_PREFS_OFF };
    }
    throw error;
  }
}

/* ------------------------------------------------------------------------------------------------
 * As traducoes da sala
 * ---------------------------------------------------------------------------------------------- */

const MESSAGE_COLUMNS = "id, webinar_id, session_id, author_user_id, body, approved, master, source, deleted_at, language";

async function fetchTranslatableRows(db: WebinarsDb, ids: readonly string[]): Promise<TranslatableMessageRow[]> {
  const unique = [...new Set(ids.map((id) => id.toLowerCase()))];
  if (unique.length === 0) {
    return [];
  }
  const { data, error } = await db.from("webinar_chat_messages").select(MESSAGE_COLUMNS).in("id", unique);
  assertNoDbError(error, "Webinarios: ler mensagens para traduzir");
  return (data ?? []) as TranslatableMessageRow[];
}

/**
 * As outras sessoes que as mensagens pedidas citam (so na sessao jit, para conferir a turma do dia): so as linhas
 * citadas e so as colunas da conta (uma sessao jit por horario acumula muitas linhas no webinario).
 */
async function siblingSessions(db: WebinarsDb, rows: readonly TranslatableMessageRow[], sessionId: string) {
  const ids = [...new Set(rows.filter((row) => row.session_id !== sessionId && !row.master).map((row) => row.session_id))];
  const { data, error } = await db.from("webinar_sessions").select("id, webinar_id, jit, scheduled_at").in("id", ids);
  assertNoDbError(error, "Webinarios: ler sessoes da turma do dia");
  const sessions = (data ?? []) as { id: string; jit: boolean | null; scheduled_at: string; webinar_id: string }[];
  return new Map(sessions.map((row) => [row.id, { jit: row.jit === true, scheduledAt: row.scheduled_at, webinarId: row.webinar_id }]));
}

/** O teto de tempo de cada lote, por cima do deadline do gateway (a reserva da conexao tambem conta). */
async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new TranslationProviderError("timeout", "timeout")), Math.max(1, timeoutMs));
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export type TranslationBatchOutcome = { errorCode: string | null; saved: number; translated: number };

/**
 * Traduz um lote e guarda (uma linha por texto e idioma). Nunca lanca: a falha (sem conexao, teto de tempo, saida
 * invalida, banco) vira log e as chaves esperam TRANSLATION_RETRY_MS; as traduzidas saem do bloqueio, as que o
 * provedor nao devolveu esperam tambem.
 */
export async function runTranslationBatch(jobs: readonly TranslationJob[], language: ChatLanguage, deps: TranslationDeps = {}): Promise<TranslationBatchOutcome> {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? TRANSLATION_LIMITS.timeoutMs;
  const provider = deps.provider ?? gatewayTranslationProvider;
  if (jobs.length === 0) {
    return { errorCode: null, saved: 0, translated: 0 };
  }
  try {
    const results = await withTimeout(
      provider.translate(
        jobs.map((job) => job.text),
        language,
        // Cada autor no proprio pedido (o isolamento do lote) e o limite mensal da IA pelo banco.
        { db: deps.db ?? webinarsDb(), deadlineAt: now() + timeoutMs, groups: jobs.map((job) => job.group) }
      ),
      timeoutMs
    );
    const rows = translationInsertsOf({ jobs, language, provider: provider.name, results });
    const saved = await insertTranslations(deps.db ?? webinarsDb(), rows);
    const done = new Set(rows.map((row) => row.sourceHash));
    release(done, language);
    block(
      jobs.filter((job) => !done.has(job.hash)),
      language,
      now() + TRANSLATION_RETRY_MS
    );
    return { errorCode: null, saved, translated: rows.length };
  } catch (error) {
    block(jobs, language, now() + TRANSLATION_RETRY_MS);
    const code = error instanceof TranslationProviderError ? error.code : isPendingMigrationError(error) ? "pending_migration" : "failed";
    console.error(`[webinarios] traducao de ${jobs.length} texto(s) para ${language} falhou (${code}): ${error instanceof Error ? error.message : String(error)}`);
    return { errorCode: code, saved: 0, translated: 0 };
  }
}

export type ReadRoomTranslationsInput = {
  /** A sessao ja conferida para o aluno (loadCachedRoomContext). */
  context: { session: Pick<WebinarSession, "id" | "jit" | "scheduledAt" | "sourceSessionId" | "webinarId"> };
  ids: readonly string[];
  language: ChatLanguage;
  userId: string;
};

/**
 * GET /api/webinars/[id]/translations: as guardadas das mensagens que o aluno pode ver nesta sessao, os ids ainda
 * pendentes e o lote das que faltam agendado (uma vez por chave). Desligado ou sem a 202610290009: { enabled: false }.
 */
export async function readRoomTranslations(input: ReadRoomTranslationsInput, deps: TranslationDeps = {}): Promise<TranslationsReply> {
  if (!webinarTranslationEnabled(deps.env)) {
    return TRANSLATIONS_OFF;
  }
  const db = deps.db ?? webinarsDb();
  const now = deps.now ?? Date.now;
  const { language, userId } = input;
  const session = input.context.session;

  try {
    const rows = await fetchTranslatableRows(db, input.ids);
    const sessions = needsSiblingSessions(rows, session) ? await siblingSessions(db, rows, session.id) : undefined;
    const visible = rows.filter((row) => messageVisibleInSession(row, { session, sessions, userId }));
    const planRows = visible.map((row) => ({ body: row.body, group: translationGroupOf(row), hash: translationSourceHash(row.body), id: row.id, language: isChatLanguage(row.language) ? row.language : null }));
    const stored = await fetchTranslations(db, { hashes: planRows.map((row) => row.hash), language });
    const nowMs = now();
    const plan = planTranslations({ isBlocked: (hash) => isBlocked(hash, language, nowMs), language, rows: planRows, stored });

    if (plan.toTranslate.length > 0) {
      const jobs = plan.toTranslate;
      // Bloqueada antes de agendar: outro aluno pedindo o mesmo texto agora recebe "pendente" sem outro lote.
      block(jobs, language, nowMs + (deps.timeoutMs ?? TRANSLATION_LIMITS.timeoutMs) * 2);
      const schedule = deps.schedule ?? afterReply;
      await schedule(async () => {
        await runTranslationBatch(jobs, language, deps);
      });
    }

    return { enabled: true, pending: plan.pending, translations: plan.translations };
  } catch (error) {
    if (isPendingMigrationError(error)) {
      return TRANSLATIONS_OFF;
    }
    throw error;
  }
}
