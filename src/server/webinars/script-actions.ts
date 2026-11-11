"use server";

// Server Actions do Roteiro de chat (docs/30 §2.2 "Roteiro de chat", §5.2, §6.6 D6-b e D6-c; fase 2b): salvar os
// itens, importar e exportar o CSV de quatro colunas, a transcricao do video (normalizeManualTranscript, a mesma das
// aulas) e a resolucao das frases ao salvar, e "Soltar agora" no console. Todas passam por runAdminAction
// (messaging.write), gravam recordAudit so com ids e contagens (nunca o texto das mensagens) e revalidam a pagina
// do webinario e o console. Toda leitura e escrita vai pela service role (webinarsDb) com assertNoDbError no store.
//
// Adendo de 10/11/2026 (R8 e R9): o roteiro tambem na Live ao vivo (salvar, importar e exportar; "Quando o apresentador
// diz" recusado nela, que nao tem transcricao durante a transmissao; a transcricao e as frases continuam so da
// gravada), o "Novo comentário" do console (sendScriptedComment: "Enviar agora", a mensagem `scripted` sem item;
// saveScriptComment: "Guardar na lista", um item "Pelo botão da equipe" no fim do roteiro) e a foto de quem comenta
// (uploadPersonaPhoto: o WebP reduzido no navegador a 512 px e 100 KB, conferido de novo, sem animacao, gravado em
// content-assets/webinars/personas/<24 hex>.webp pelo mesmo persistImageAsset do banner da Na tela; so o caminho volta).
// O item guarda o caminho da foto e a mensagem solta guarda a copia (o "Soltar agora", o tick da live e o "Enviar
// agora"); o "Usar esta foto em todos os comentários de {nome}" aplica a foto aos itens com o mesmo nome. Banco sem a
// 202611100002: o roteiro segue sem foto e so gravar uma foto volta 409 com a frase da migracao.

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { csvFileName } from "@/lib/csv";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { runAdminAction } from "@/server/actions/run-action";
import { TranscriptError, normalizeManualTranscript } from "@/server/ai/transcripts";
import { recordAudit } from "@/server/audit/log";
import { decodeWebpDataUrl, readWebpDimensions, webpIsAnimated } from "@/server/catalog/webp";
import { persistImageAsset } from "@/server/db/media-assets";
import { isPendingMigrationError } from "@/server/db/pending-migration";
import { invalidateWebinars } from "./cache";
import { chatMessageFromRow, scriptItemFromRow, transcriptCuesOf } from "./chat-rows";
import {
  CHAT_MESSAGES,
  fireScriptItemSchema,
  importScriptCsvSchema,
  resolveScriptPhrasesSchema,
  saveScriptItemsSchema,
  saveTranscriptSchema,
  scriptCommentSchema,
  sessionIdInputSchema,
  uploadPersonaPhotoSchema,
  type SaveScriptItemsInput,
  type ScriptCommentInput
} from "./chat-schemas";
import {
  fetchScriptItemRow,
  fetchTranscriptRow,
  insertScriptItemRow,
  insertScriptedComment,
  insertScriptedMessage,
  listScriptItemRows,
  replaceScriptItemRows,
  updateScriptItemRow,
  upsertTranscriptRow,
  type ScriptItemUpsert
} from "./chat-store";
import { canTeamActOn } from "./console-model";
import { listAllSessionChatRows } from "./console-queries";
import { WEBINARS_SCREEN_MIGRATION, WebinarError, WebinarFieldError, isMissingWebinarSchema, webinarsDb, type WebinarsDb } from "./db";
import { CHAT_LIMITS, TRANSCRIPT_FORMATS, type ChatMessage, type ScriptItem, type ScriptItemDraft, type ScriptStatus, type WebinarTranscriptFormat } from "./model";
import { PERSONA_AVATAR_BUCKET, PERSONA_AVATAR_FOLDER, PERSONA_AVATAR_LIMITS, PERSONA_AVATAR_PATH_PATTERN } from "./persona-model";
import { applyPersonaAvatarToName, readScriptItemPersonaAvatar, readScriptPersonaAvatars, withPersonaAvatars, type PersonaAvatars } from "./persona-store";
import { baseRecordingOf, type TranscriptSummary } from "./queries";
import { sessionOffsetMs } from "./room-model";
import { sessionFromRow } from "./rows";
import { formatScriptCsv, parseScriptCsv, resolvedScriptItem, scriptOffsetOf, scriptSummary, type PhraseCue, type ScriptCsvError } from "./script-model";
import { assertWebinarNotArchived, fetchSessionRow, listRecordingRows, requireWebinarRow } from "./store";

const LIST_PATH = "/admin/comunicacao/webinarios";

/** A transcricao e as frases ("Quando o apresentador diz") sao so da Live gravada; o roteiro existe nos dois tipos (R8). */
const ONLY_SIMULATED_MESSAGE = "A transcrição e as frases são só da Live gravada.";
const NO_RECORDING_MESSAGE = "Cole o endereço do vídeo da Bunny no card Dados e salve antes de enviar a transcrição.";
const RECORDING_MISMATCH_MESSAGE = "Esse vídeo não é deste webinário.";
const TRANSCRIPT_EMPTY_MESSAGE = "A transcrição está vazia ou não tem trechos válidos.";
const SESSION_MISSING_MESSAGE = "Essa sessão não existe mais.";
const SESSION_CLOSED_MESSAGE = "Essa sessão não aceita mais o roteiro.";
const ITEM_MISSING_MESSAGE = "Esse item do roteiro não existe mais.";
const ALREADY_FIRED_MESSAGE = "Esse item já entrou nesta sessão.";

export type ScriptSummary = ReturnType<typeof scriptSummary>;
export type SavedScript = { items: ScriptItem[]; summary: ScriptSummary };
export type ImportedScript = SavedScript & { errors: ScriptCsvError[]; imported: number; truncated: boolean };
export type ResolvedScript = SavedScript & { hasTranscript: boolean; ready: number; unresolved: number };
export type SavedTranscript = ResolvedScript & { transcript: TranscriptSummary };
export type ExportedCsv = { csv: string; fileName: string; rows: number };
export type UploadedPersonaPhoto = { height: number; path: string; width: number };
/** O comentario solto pelo "Enviar agora" e quantos itens com o mesmo nome ganharam a foto. */
export type SentScriptedComment = { message: ChatMessage; photoApplied: number };
/** O item guardado pelo "Guardar na lista" e quantos itens com o mesmo nome ganharam a foto (o novo incluido). */
export type SavedScriptComment = { item: ScriptItem; photoApplied: number };

const COMENTARIOS = WEBINAR_COPY.naTela.comentarios;
/** O aviso da foto de quem comenta no banco sem a 202611100002. */
const PERSONA_MIGRATION_MESSAGE = COMENTARIOS.erros.migracao(WEBINARS_SCREEN_MIGRATION);

/* ------------------------------------------------------------------------------------------------
 * Apoio
 * ---------------------------------------------------------------------------------------------- */

function revalidateWebinar(id: string) {
  revalidatePath(`${LIST_PATH}/${id}`);
  revalidatePath(`${LIST_PATH}/${id}/sala`);
}

type TranscriptContext = { cues: PhraseCue[]; id: string } | null;

/** A transcricao da gravacao base do webinario (as cues para "Quando o apresentador diz"), quando existe. */
async function loadTranscriptFor(db: WebinarsDb, webinarId: string): Promise<{ recordingId: string | null; transcript: TranscriptContext }> {
  const recording = baseRecordingOf(await listRecordingRows(db, [webinarId]));

  if (!recording) {
    return { recordingId: null, transcript: null };
  }

  const row = await fetchTranscriptRow(db, recording.id);

  return { recordingId: recording.id, transcript: row ? { cues: transcriptCuesOf(row.cues), id: row.id } : null };
}

/** O item gravado como rascunho editavel (o que a tela e a importacao reenviam). */
function draftOfItem(item: ScriptItem): ScriptItemDraft {
  return {
    body: item.body,
    id: item.id,
    kind: item.kind,
    offsetMs: item.offsetMs,
    personaAvatarPath: item.personaAvatarPath,
    personaName: item.personaName,
    personaRole: item.personaRole,
    phrase: item.phrase,
    phraseDelayMs: item.phraseDelayMs,
    status: item.status,
    triggerKind: item.triggerKind
  };
}

/**
 * O item como vai para o banco: a posicao e a situacao sao do servidor (pronto com minuto; frase achada ou nao
 * quando ha transcricao; desligado fica desligado), nunca da tela.
 */
function toUpsert(item: ScriptItemDraft, position: number, transcript: TranscriptContext, createdBy: string, keepId: boolean): ScriptItemUpsert {
  let status: ScriptStatus = item.status === "disabled" ? "disabled" : "ready";
  let resolvedOffsetMs: number | null = null;
  let resolvedTranscriptId: string | null = null;

  if (item.triggerKind === "on_phrase" && status !== "disabled") {
    if (transcript) {
      const resolved = resolvedScriptItem({ ...item, status: "draft" }, transcript.cues);
      status = resolved.status;
      resolvedOffsetMs = resolved.resolvedOffsetMs;
      resolvedTranscriptId = resolved.resolvedOffsetMs != null ? transcript.id : null;
    } else {
      status = "unresolved";
    }
  }

  const base: ScriptItemUpsert = {
    body: item.body,
    kind: item.kind,
    offset_ms: item.triggerKind === "at_offset" ? item.offsetMs : null,
    persona_name: item.personaName,
    persona_role: item.personaRole,
    phrase: item.triggerKind === "on_phrase" ? item.phrase : null,
    phrase_delay_ms: item.triggerKind === "on_phrase" ? item.phraseDelayMs : 0,
    position,
    resolved_offset_ms: resolvedOffsetMs,
    resolved_transcript_id: resolvedTranscriptId,
    status,
    trigger_kind: item.triggerKind,
    webinar_id: ""
  };

  // Uma chamada de upsert exige as mesmas chaves em todas as linhas: os ids ficam num grupo, os novos (com quem criou) noutro.
  return keepId && item.id ? { ...base, id: item.id } : { ...base, created_by: createdBy, generated_by_ai: false };
}

/**
 * A foto de quem comenta na linha que vai para o banco (R9): so com a coluna no banco (e entao em todas as linhas: um
 * upsert exige as mesmas chaves); ausente no rascunho, a do item fica como estava.
 */
function withAvatarColumn(upsert: ScriptItemUpsert, item: ScriptItemDraft, avatars: PersonaAvatars): ScriptItemUpsert {
  if (!avatars.available) {
    return upsert;
  }
  const kept = item.id ? (avatars.paths.get(item.id) ?? null) : null;
  return { ...upsert, persona_avatar_path: item.personaAvatarPath !== undefined ? item.personaAvatarPath : kept };
}

/** Confere de novo as frases dos itens on_phrase (ao salvar a transcricao ou pelo botao). */
async function resolveItems(db: WebinarsDb, webinarId: string, transcript: TranscriptContext): Promise<{ items: ScriptItem[]; ready: number; unresolved: number }> {
  const rows = await listScriptItemRows(db, webinarId);
  let ready = 0;
  let unresolved = 0;

  for (const row of rows) {
    if (row.trigger_kind !== "on_phrase" || row.status === "disabled") {
      continue;
    }

    const item = scriptItemFromRow(row);
    const next = transcript ? resolvedScriptItem({ ...item, status: "draft" }, transcript.cues) : { resolvedOffsetMs: null, status: "unresolved" as const };
    const transcriptId = next.resolvedOffsetMs != null && transcript ? transcript.id : null;

    if (next.status === "ready") {
      ready += 1;
    } else {
      unresolved += 1;
    }

    if (next.status !== row.status || next.resolvedOffsetMs !== row.resolved_offset_ms || transcriptId !== row.resolved_transcript_id) {
      await updateScriptItemRow(db, row.id, { resolved_offset_ms: next.resolvedOffsetMs, resolved_transcript_id: transcriptId, status: next.status });
    }
  }

  const items = (await listScriptItemRows(db, webinarId)).map(scriptItemFromRow);

  return { items, ready, unresolved };
}

async function requireSimulatedWebinar(db: WebinarsDb, id: string) {
  const row = await requireWebinarRow(db, id);
  // So as escritas do roteiro e da transcricao passam por aqui: o arquivado fica so de leitura (as exportacoes seguem).
  assertWebinarNotArchived(row);

  if (row.kind !== "simulated") {
    throw new WebinarError(ONLY_SIMULATED_MESSAGE, 409);
  }

  return row;
}

/**
 * O webinario cujo roteiro se grava: a Live gravada e, desde o adendo de 10/11/2026 (R8), a Live ao vivo. A transcricao
 * e as frases continuam so da gravada (requireSimulatedWebinar). O arquivado fica so de leitura.
 */
async function requireScriptWebinar(db: WebinarsDb, id: string) {
  const row = await requireWebinarRow(db, id);
  assertWebinarNotArchived(row);

  if (row.kind !== "simulated" && row.kind !== "live") {
    throw new WebinarError(ONLY_SIMULATED_MESSAGE, 409);
  }

  return row;
}

/** O roteiro gravado com a foto de quem comenta de cada item (banco sem a coluna: sem foto). */
async function scriptItemsWithAvatars(db: WebinarsDb, webinarId: string, rows?: Awaited<ReturnType<typeof listScriptItemRows>>): Promise<ScriptItem[]> {
  const [items, avatars] = await Promise.all([rows ? Promise.resolve(rows) : listScriptItemRows(db, webinarId), readScriptPersonaAvatars(db, webinarId)]);
  return withPersonaAvatars(items.map(scriptItemFromRow), avatars);
}

/** Uma escrita da foto que esbarra no banco sem a 202611100002 vira 409 com a frase da migracao. */
async function withPersonaColumn<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isPendingMigrationError(error) || isMissingWebinarSchema(error)) {
      throw new WebinarError(PERSONA_MIGRATION_MESSAGE, 409);
    }
    throw error;
  }
}

/* ------------------------------------------------------------------------------------------------
 * O roteiro
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.write] Grava o roteiro inteiro (os itens enviados ficam, os de fora saem): a posicao e a ordem da
 * lista; os itens "Quando o apresentador diz" sao resolvidos agora, com a transcricao da gravacao (D6-b).
 */
export async function saveScriptItems(input: SaveScriptItemsInput): Promise<ActionResult<SavedScript>> {
  return runAdminAction("messaging.write", saveScriptItemsSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const row = await requireScriptWebinar(db, data.webinarId);
    const live = row.kind === "live";

    // Na Live ao vivo (R8) nao ha transcricao durante a transmissao: "Quando o apresentador diz" nao entra.
    const phraseIndex = live ? data.items.findIndex((item) => item.triggerKind === "on_phrase") : -1;
    if (phraseIndex !== -1) {
      throw new WebinarFieldError(`items.${phraseIndex}.triggerKind`, COMENTARIOS.erros.fraseNaLive);
    }

    const { transcript } = live ? { transcript: null } : await loadTranscriptFor(db, row.id);
    // Um id de outro webinario nao e deste roteiro: entra como item novo (nunca um upsert la).
    const known = new Set((await listScriptItemRows(db, row.id)).map((item) => item.id));
    const avatars = await readScriptPersonaAvatars(db, row.id);
    if (!avatars.available && data.items.some((item) => item.personaAvatarPath)) {
      throw new WebinarError(PERSONA_MIGRATION_MESSAGE, 409);
    }
    const upserts = data.items.map((item, position) => withAvatarColumn(toUpsert(item, position, transcript, user.id, Boolean(item.id && known.has(item.id))), item, avatars));
    const items = await scriptItemsWithAvatars(db, row.id, await replaceScriptItemRows(db, row.id, upserts));
    const summary = scriptSummary(items);

    await recordAudit(db, {
      action: "webinar.script_saved",
      actorId: user.id,
      count: items.length,
      entityId: row.id,
      entityType: "webinar",
      metadata: { ...summary, items: items.length, with_transcript: transcript !== null }
    });
    revalidateWebinar(row.id);

    return { items, summary };
  });
}

/**
 * [messaging.write] Importa o CSV de quatro colunas (Tempo;Nome;Papel;Mensagem; ate 5 000 linhas e 1 MB): as linhas
 * boas entram como "Num minuto do vídeo" prontas, no fim do roteiro ou no lugar dele; as ruins voltam com o numero
 * da linha e nao entram.
 */
export async function importScriptCsv(input: { csv: string; replace?: boolean; webinarId: string }): Promise<ActionResult<ImportedScript>> {
  return runAdminAction("messaging.write", importScriptCsvSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    // R8: a Live ao vivo tambem importa (as linhas entram "Num minuto da live"; a foto dos itens que ficam nao muda).
    const row = await requireScriptWebinar(db, data.webinarId);
    const parsed = parseScriptCsv(data.csv);
    const current = await scriptItemsWithAvatars(db, row.id);

    if (parsed.items.length === 0) {
      return { errors: parsed.errors, imported: 0, items: current, summary: scriptSummary(current), truncated: parsed.truncated };
    }

    const { transcript } = row.kind === "live" ? { transcript: null } : await loadTranscriptFor(db, row.id);
    const kept = data.replace ? [] : current;

    if (kept.length + parsed.items.length > CHAT_LIMITS.scriptItemsMax) {
      throw new WebinarError(CHAT_MESSAGES.tooManyItems, 422);
    }

    const upserts = [
      ...kept.map((item, position) => toUpsert(draftOfItem(item), position, transcript, user.id, true)),
      ...parsed.items.map((item, index) => toUpsert(item, kept.length + index, transcript, user.id, false))
    ];
    // Sem a coluna da foto no upsert: a dos itens que ficam continua a mesma no banco.
    const items = await scriptItemsWithAvatars(db, row.id, await replaceScriptItemRows(db, row.id, upserts));
    const summary = scriptSummary(items);

    await recordAudit(db, {
      action: "webinar.script_imported",
      actorId: user.id,
      count: parsed.items.length,
      entityId: row.id,
      entityType: "webinar",
      metadata: { errors: parsed.errors.length, imported: parsed.items.length, items: items.length, replace: data.replace, truncated: parsed.truncated }
    });
    revalidateWebinar(row.id);

    return { errors: parsed.errors, imported: parsed.items.length, items, summary, truncated: parsed.truncated };
  });
}

/** [messaging.write] O roteiro em CSV, no formato que a importacao le de volta (os itens sem minuto ficam de fora). */
export async function exportScriptCsv(input: { webinarId: string }): Promise<ActionResult<ExportedCsv>> {
  return runAdminAction("messaging.write", resolveScriptPhrasesSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const row = await requireWebinarRow(db, data.webinarId);
    const items = (await listScriptItemRows(db, row.id)).map(scriptItemFromRow);
    const lines = items.filter((item) => item.status !== "disabled").map((item) => ({ body: item.body, offsetMs: scriptOffsetOf(item), personaName: item.personaName, personaRole: item.personaRole }));
    const rows = lines.filter((line) => line.offsetMs != null).length;

    await recordAudit(db, { action: "webinar.script_exported", actorId: user.id, count: rows, entityId: row.id, entityType: "webinar", metadata: { rows } });

    return { csv: formatScriptCsv(lines), fileName: csvFileName(`roteiro-${row.slug}`, new Date()), rows };
  });
}

/**
 * [messaging.write] O chat real de uma sessao (turma, chat original e equipe) no CSV do roteiro, para reaproveitar
 * numa Live gravada. Mensagens apagadas e as do roteiro ficam de fora. O Apresentador, o co-apresentador e a Equipe
 * viram a persona `team`; o resto, `student`.
 */
export async function exportSessionChatCsv(input: { sessionId: string }): Promise<ActionResult<ExportedCsv>> {
  return runAdminAction("messaging.write", sessionIdInputSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const session = await fetchSessionRow(db, data.sessionId);

    if (!session) {
      throw new WebinarError(SESSION_MISSING_MESSAGE, 404);
    }

    const webinar = await requireWebinarRow(db, session.webinar_id);
    const lines = (await listAllSessionChatRows(db, session.id))
      .filter((row) => row.approved && row.kind !== "system" && (row.source === "audience" || row.source === "original" || row.source === "team"))
      .map((row) => ({ body: row.body, offsetMs: row.offset_ms, personaName: row.display_name, personaRole: (row.role === "team" || row.role === "host" || row.role === "co_host" ? "team" : "student") as "student" | "team" }));

    await recordAudit(db, {
      action: "webinar.chat_exported",
      actorId: user.id,
      count: lines.length,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { rows: lines.length, session_id: session.id }
    });

    return { csv: formatScriptCsv(lines), fileName: csvFileName(`chat-${webinar.slug}`, new Date()), rows: lines.length };
  });
}

/* ------------------------------------------------------------------------------------------------
 * A transcricao e as frases (D6-b)
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.write] Grava a transcricao da gravacao base (VTT, SRT ou texto colado ou enviado; as cues no formato de
 * lesson_transcripts) e confere de novo as frases do roteiro.
 */
export async function saveTranscript(input: { format?: WebinarTranscriptFormat; language?: string; recordingId?: string; text: string; webinarId: string }): Promise<ActionResult<SavedTranscript>> {
  return runAdminAction("messaging.write", saveTranscriptSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const row = await requireSimulatedWebinar(db, data.webinarId);
    const recordings = await listRecordingRows(db, [row.id]);
    const recording = data.recordingId ? recordings.find((item) => item.id === data.recordingId) : baseRecordingOf(recordings);

    if (data.recordingId && !recording) {
      throw new WebinarError(RECORDING_MISMATCH_MESSAGE, 404);
    }

    if (!recording) {
      throw new WebinarError(NO_RECORDING_MESSAGE, 409);
    }

    if (data.format === "json3") {
      throw new WebinarFieldError("format", "Envie VTT, SRT ou texto.");
    }

    let normalized;

    try {
      normalized = normalizeManualTranscript({ format: data.format, language: data.language, source: "paste", text: data.text });
    } catch (error) {
      if (error instanceof TranscriptError) {
        throw new WebinarFieldError("text", TRANSCRIPT_EMPTY_MESSAGE);
      }

      throw error;
    }

    const saved = await upsertTranscriptRow(db, {
      checksum: normalized.checksum,
      created_by: user.id,
      cues: normalized.cues.map((cue) => ({ endSeconds: cue.endSeconds, startSeconds: cue.startSeconds, text: cue.text })),
      full_text: normalized.fullText,
      language: normalized.language,
      recording_id: recording.id,
      source_format: data.format
    });
    const resolved = await resolveItems(db, row.id, { cues: transcriptCuesOf(saved.cues), id: saved.id });
    const format = (TRANSCRIPT_FORMATS as readonly string[]).includes(saved.source_format) ? (saved.source_format as WebinarTranscriptFormat) : data.format;

    await recordAudit(db, {
      action: "webinar.transcript_saved",
      actorId: user.id,
      count: normalized.cues.length,
      entityId: row.id,
      entityType: "webinar",
      metadata: { cues: normalized.cues.length, format: data.format, recording_id: recording.id, resolved_ready: resolved.ready, resolved_unresolved: resolved.unresolved }
    });
    revalidateWebinar(row.id);

    return {
      hasTranscript: true,
      items: resolved.items,
      ready: resolved.ready,
      summary: scriptSummary(resolved.items),
      transcript: { cues: normalized.cues.length, format, language: saved.language, updatedAt: saved.updated_at },
      unresolved: resolved.unresolved
    };
  });
}

/** [messaging.write] Confere de novo as frases "Quando o apresentador diz" com a transcricao que existe hoje. */
export async function resolveScriptPhrases(input: { webinarId: string }): Promise<ActionResult<ResolvedScript>> {
  return runAdminAction("messaging.write", resolveScriptPhrasesSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const row = await requireSimulatedWebinar(db, data.webinarId);
    const { transcript } = await loadTranscriptFor(db, row.id);
    const resolved = await resolveItems(db, row.id, transcript);

    await recordAudit(db, {
      action: "webinar.script_resolved",
      actorId: user.id,
      entityId: row.id,
      entityType: "webinar",
      metadata: { ready: resolved.ready, unresolved: resolved.unresolved, with_transcript: transcript !== null }
    });
    revalidateWebinar(row.id);

    return { hasTranscript: transcript !== null, items: resolved.items, ready: resolved.ready, summary: scriptSummary(resolved.items), unresolved: resolved.unresolved };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Soltar agora (D6-c)
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.write] "Soltar agora": o item (manual ou nao) entra na sessao no minuto atual do relogio do servidor,
 * como mensagem `scripted` da persona. O mesmo item na mesma sessao entra uma vez so (chave unica): repetir da 409.
 */
export async function fireScriptItem(input: { itemId: string; sessionId: string }): Promise<ActionResult<{ message: ChatMessage }>> {
  return runAdminAction("messaging.write", fireScriptItemSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const row = await fetchSessionRow(db, data.sessionId);

    if (!row) {
      throw new WebinarError(SESSION_MISSING_MESSAGE, 404);
    }

    const session = sessionFromRow(row);
    const item = await fetchScriptItemRow(db, data.itemId);

    if (!item || item.webinar_id !== session.webinarId) {
      throw new WebinarError(ITEM_MISSING_MESSAGE, 404);
    }

    if (!canTeamActOn(session)) {
      throw new WebinarError(SESSION_CLOSED_MESSAGE, 409);
    }

    const offset = sessionOffsetMs(session, now.getTime());

    if (!Number.isFinite(offset)) {
      throw new WebinarError(SESSION_CLOSED_MESSAGE, 409);
    }

    // A foto de quem comenta vai com o nome e o texto (R9): a copia do item agora (sem foto, a chave fica de fora).
    const avatar = await readScriptItemPersonaAvatar(db, item.id);
    const inserted = await insertScriptedMessage(db, {
      approved: true,
      author_user_id: null,
      body: item.body,
      display_name: item.persona_name,
      kind: item.kind,
      master: false,
      offset_ms: clampOffset(offset),
      ...(avatar ? { persona_avatar_path: avatar } : {}),
      role: item.persona_role,
      script_item_id: item.id,
      session_id: session.id,
      source: "scripted",
      webinar_id: session.webinarId
    });

    if (!inserted) {
      throw new WebinarError(ALREADY_FIRED_MESSAGE, 409);
    }

    await recordAudit(db, {
      action: "webinar.script_fired",
      actorId: user.id,
      entityId: session.webinarId,
      entityType: "webinar",
      metadata: { item_id: item.id, offset_ms: inserted.offset_ms, session_id: session.id, trigger_kind: item.trigger_kind }
    });
    revalidatePath(`${LIST_PATH}/${session.webinarId}/sala`);
    // O relatorio conta o roteiro que entrou (sim_script): o cache de 60 s cai.
    invalidateWebinars({ from: "action" });

    return { message: chatMessageFromRow(inserted) };
  });
}

/** O offset dentro dos limites do banco. */
function clampOffset(offset: number): number {
  return Math.max(CHAT_LIMITS.offsetMinMs, Math.min(CHAT_LIMITS.offsetMaxMs, Math.round(offset)));
}

/* ------------------------------------------------------------------------------------------------
 * O "Novo comentário" do console e a foto de quem comenta (adendo de 10/11/2026, R8 e R9)
 * ---------------------------------------------------------------------------------------------- */

/** As medidas de um WebP da foto de quem comenta, ou o erro no campo: cabecalho WebP, de 16 a 512 px de lado, sem animacao. */
function checkPersonaPhotoBytes(bytes: Uint8Array): { height: number; width: number } {
  const dimensions = readWebpDimensions(bytes);

  if (!dimensions) {
    throw new WebinarFieldError("image", COMENTARIOS.erros.fotoFormato);
  }

  const { sideMax: max, sideMin: min } = PERSONA_AVATAR_LIMITS;

  if (dimensions.width < min || dimensions.width > max || dimensions.height < min || dimensions.height > max) {
    throw new WebinarFieldError("image", COMENTARIOS.erros.fotoLado);
  }

  if (webpIsAnimated(bytes)) {
    throw new WebinarFieldError("image", COMENTARIOS.erros.fotoAnimada);
  }

  return dimensions;
}

/**
 * [messaging.write] A foto de quem comenta (R9): recebe o WebP que o navegador ja reduziu (prepareFreeImage com 512 px e
 * 100.000 bytes), confere de novo o formato, o peso, os lados (16 a 512 px) e recusa a imagem animada, grava pelo
 * persistImageAsset em content-assets/webinars/personas/<24 hex do sha256>.webp (a mesma rota do banner da Na tela, com
 * a pasta propria) e devolve so o caminho e as medidas, nunca um endereco. Auditoria `webinar.persona_photo_uploaded`.
 */
export async function uploadPersonaPhoto(input: { image: string }): Promise<ActionResult<UploadedPersonaPhoto>> {
  return runAdminAction("messaging.write", uploadPersonaPhotoSchema, input, async ({ input: data, user }) => {
    const bytes = decodeWebpDataUrl(data.image);

    if (!bytes || bytes.length === 0) {
      throw new WebinarFieldError("image", COMENTARIOS.erros.fotoFormato);
    }

    if (bytes.length > PERSONA_AVATAR_LIMITS.bytes) {
      throw new WebinarFieldError("image", COMENTARIOS.erros.fotoPesada);
    }

    const dimensions = checkPersonaPhotoBytes(bytes);
    const url = (await persistImageAsset(data.image, PERSONA_AVATAR_FOLDER)).trim();
    const marker = `/storage/v1/object/public/${PERSONA_AVATAR_BUCKET}/`;
    const index = url.indexOf(marker);
    const path = index === -1 ? "" : url.slice(index + marker.length).split(/[?#]/)[0];

    if (!PERSONA_AVATAR_PATH_PATTERN.test(path)) {
      throw new Error("Webinarios: a foto de quem comenta nao foi enviada ao armazenamento.");
    }

    await recordAudit(webinarsDb(), {
      action: "webinar.persona_photo_uploaded",
      actorId: user.id,
      entityId: null,
      entityType: "webinar",
      metadata: { height: dimensions.height, path, size_bytes: bytes.length, width: dimensions.width }
    });

    return { height: dimensions.height, path, width: dimensions.width };
  });
}

/** A foto nos itens com o mesmo nome, quando pedido (o "Usar esta foto em todos os comentários de {nome}"). */
async function applyPhotoToName(db: WebinarsDb, input: { apply: boolean; name: string; path: string | null; webinarId: string }): Promise<number> {
  if (!input.apply || !input.path) {
    return 0;
  }
  return withPersonaColumn(() => applyPersonaAvatarToName(db, { name: input.name, path: input.path, webinarId: input.webinarId }));
}

/**
 * [messaging.write] O "Enviar agora" do "Novo comentário" (R8): a mensagem `scripted` da sessao, sem item do roteiro,
 * com o nome, o papel (Aluno sem selo; Equipe com o selo Equipe) e a foto de quem comenta, no minuto do relogio do
 * servidor; chega a turma pela consulta de 5 s. Na live e na gravada (no ar ou na espera); o Replay e a sessao
 * encerrada ou cancelada recusam com 409. Com a foto e `applyToName`, a foto vai tambem para os itens do roteiro com o
 * mesmo nome. Auditoria `webinar.script_comment_sent` (sem o texto).
 */
export async function sendScriptedComment(input: ScriptCommentInput): Promise<ActionResult<SentScriptedComment>> {
  return runAdminAction("messaging.write", scriptCommentSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const row = await fetchSessionRow(db, data.sessionId);

    if (!row) {
      throw new WebinarError(SESSION_MISSING_MESSAGE, 404);
    }

    const session = sessionFromRow(row);

    if (session.kind === "replay") {
      throw new WebinarError(COMENTARIOS.erros.replay, 409);
    }

    if (!canTeamActOn(session)) {
      throw new WebinarError(COMENTARIOS.erros.sessaoFechada, 409);
    }

    const offset = sessionOffsetMs(session, now.getTime());

    if (!Number.isFinite(offset)) {
      throw new WebinarError(COMENTARIOS.erros.sessaoFechada, 409);
    }

    const inserted = await withPersonaColumn(() =>
      insertScriptedComment(db, {
        approved: true,
        author_user_id: null,
        body: data.body,
        display_name: data.personaName,
        kind: "message",
        master: false,
        offset_ms: clampOffset(offset),
        ...(data.personaAvatarPath ? { persona_avatar_path: data.personaAvatarPath } : {}),
        role: data.personaRole,
        session_id: session.id,
        webinar_id: session.webinarId
      })
    );
    const photoApplied = await applyPhotoToName(db, { apply: data.applyToName, name: data.personaName, path: data.personaAvatarPath, webinarId: session.webinarId });

    await recordAudit(db, {
      action: "webinar.script_comment_sent",
      actorId: user.id,
      entityId: session.webinarId,
      entityType: "webinar",
      metadata: { message_id: inserted.id, offset_ms: inserted.offset_ms, photo_applied: photoApplied, role: data.personaRole, session_id: session.id, with_photo: Boolean(data.personaAvatarPath) }
    });
    revalidatePath(`${LIST_PATH}/${session.webinarId}/sala`);
    invalidateWebinars({ from: "action" });

    return { message: chatMessageFromRow(inserted), photoApplied };
  });
}

/**
 * [messaging.write] O "Guardar na lista" do "Novo comentário" (R8): um item "Pelo botão da equipe", pronto, no fim do
 * roteiro do webinario da sessao (fica para o "Soltar agora" desta e das proximas sessoes), com a foto de quem comenta.
 * Ate 5.000 itens; o webinario arquivado fica so de leitura. Com a foto e `applyToName`, a foto vai tambem para os
 * outros itens com o mesmo nome. Auditoria `webinar.script_item_added` (sem o texto).
 */
export async function saveScriptComment(input: ScriptCommentInput): Promise<ActionResult<SavedScriptComment>> {
  return runAdminAction("messaging.write", scriptCommentSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const session = await fetchSessionRow(db, data.sessionId);

    if (!session) {
      throw new WebinarError(SESSION_MISSING_MESSAGE, 404);
    }

    const webinar = await requireScriptWebinar(db, session.webinar_id);
    const current = await listScriptItemRows(db, webinar.id);

    if (current.length >= CHAT_LIMITS.scriptItemsMax) {
      throw new WebinarError(COMENTARIOS.erros.limite, 422);
    }

    const position = current.reduce((max, item) => Math.max(max, item.position), -1) + 1;
    const saved = await withPersonaColumn(() =>
      insertScriptItemRow(db, {
        body: data.body,
        created_by: user.id,
        generated_by_ai: false,
        kind: "message",
        offset_ms: null,
        ...(data.personaAvatarPath ? { persona_avatar_path: data.personaAvatarPath } : {}),
        persona_name: data.personaName,
        persona_role: data.personaRole,
        phrase: null,
        phrase_delay_ms: 0,
        position,
        status: "ready",
        trigger_kind: "manual",
        webinar_id: webinar.id
      })
    );
    const photoApplied = await applyPhotoToName(db, { apply: data.applyToName, name: data.personaName, path: data.personaAvatarPath, webinarId: webinar.id });

    await recordAudit(db, {
      action: "webinar.script_item_added",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { item_id: saved.id, photo_applied: photoApplied, role: data.personaRole, session_id: session.id, with_photo: Boolean(data.personaAvatarPath) }
    });
    revalidateWebinar(webinar.id);

    return { item: { ...scriptItemFromRow(saved), personaAvatarPath: data.personaAvatarPath }, photoApplied };
  });
}
