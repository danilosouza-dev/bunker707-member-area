"use server";

// Server Actions do Roteiro de chat (docs/30 §2.2 "Roteiro de chat", §5.2, §6.6 D6-b e D6-c; fase 2b): salvar os
// itens, importar e exportar o CSV de quatro colunas, a transcricao do video (normalizeManualTranscript, a mesma das
// aulas) e a resolucao das frases ao salvar, e "Soltar agora" no console. Todas passam por runAdminAction
// (messaging.write), gravam recordAudit so com ids e contagens (nunca o texto das mensagens) e revalidam a pagina
// do webinario e o console. Toda leitura e escrita vai pela service role (webinarsDb) com assertNoDbError no store.

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { csvFileName } from "@/lib/csv";
import { runAdminAction } from "@/server/actions/run-action";
import { TranscriptError, normalizeManualTranscript } from "@/server/ai/transcripts";
import { recordAudit } from "@/server/audit/log";
import { invalidateWebinars } from "./cache";
import { chatMessageFromRow, scriptItemFromRow, transcriptCuesOf } from "./chat-rows";
import { CHAT_MESSAGES, fireScriptItemSchema, importScriptCsvSchema, resolveScriptPhrasesSchema, saveScriptItemsSchema, saveTranscriptSchema, sessionIdInputSchema, type SaveScriptItemsInput } from "./chat-schemas";
import { fetchScriptItemRow, fetchTranscriptRow, insertScriptedMessage, listScriptItemRows, replaceScriptItemRows, updateScriptItemRow, upsertTranscriptRow, type ScriptItemUpsert } from "./chat-store";
import { canTeamActOn } from "./console-model";
import { listAllSessionChatRows } from "./console-queries";
import { WebinarError, WebinarFieldError, webinarsDb, type WebinarsDb } from "./db";
import { CHAT_LIMITS, TRANSCRIPT_FORMATS, type ChatMessage, type ScriptItem, type ScriptItemDraft, type ScriptStatus, type WebinarTranscriptFormat } from "./model";
import { baseRecordingOf, type TranscriptSummary } from "./queries";
import { sessionOffsetMs } from "./room-model";
import { sessionFromRow } from "./rows";
import { formatScriptCsv, parseScriptCsv, resolvedScriptItem, scriptOffsetOf, scriptSummary, type PhraseCue, type ScriptCsvError } from "./script-model";
import { fetchSessionRow, listRecordingRows, requireWebinarRow } from "./store";

const LIST_PATH = "/admin/comunicacao/webinarios";

const ONLY_SIMULATED_MESSAGE = "O roteiro de chat é só da Live gravada.";
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

  if (row.kind !== "simulated") {
    throw new WebinarError(ONLY_SIMULATED_MESSAGE, 409);
  }

  return row;
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
    const row = await requireSimulatedWebinar(db, data.webinarId);
    const { transcript } = await loadTranscriptFor(db, row.id);
    // Um id de outro webinario nao e deste roteiro: entra como item novo (nunca um upsert la).
    const known = new Set((await listScriptItemRows(db, row.id)).map((item) => item.id));
    const upserts = data.items.map((item, position) => toUpsert(item, position, transcript, user.id, Boolean(item.id && known.has(item.id))));
    const items = (await replaceScriptItemRows(db, row.id, upserts)).map(scriptItemFromRow);
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
    const row = await requireSimulatedWebinar(db, data.webinarId);
    const parsed = parseScriptCsv(data.csv);
    const current = (await listScriptItemRows(db, row.id)).map(scriptItemFromRow);

    if (parsed.items.length === 0) {
      return { errors: parsed.errors, imported: 0, items: current, summary: scriptSummary(current), truncated: parsed.truncated };
    }

    const { transcript } = await loadTranscriptFor(db, row.id);
    const kept = data.replace ? [] : current;

    if (kept.length + parsed.items.length > CHAT_LIMITS.scriptItemsMax) {
      throw new WebinarError(CHAT_MESSAGES.tooManyItems, 422);
    }

    const upserts = [
      ...kept.map((item, position) => toUpsert(draftOfItem(item), position, transcript, user.id, true)),
      ...parsed.items.map((item, index) => toUpsert(item, kept.length + index, transcript, user.id, false))
    ];
    const items = (await replaceScriptItemRows(db, row.id, upserts)).map(scriptItemFromRow);
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
 * numa Live gravada. Mensagens apagadas e as do roteiro ficam de fora.
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
      .map((row) => ({ body: row.body, offsetMs: row.offset_ms, personaName: row.display_name, personaRole: (row.role === "team" || row.role === "host" ? "team" : "student") as "student" | "team" }));

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

    const inserted = await insertScriptedMessage(db, {
      approved: true,
      author_user_id: null,
      body: item.body,
      display_name: item.persona_name,
      kind: item.kind,
      master: false,
      offset_ms: Math.max(CHAT_LIMITS.offsetMinMs, Math.min(CHAT_LIMITS.offsetMaxMs, Math.round(offset))),
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
