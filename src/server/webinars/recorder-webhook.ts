// O webhook do gravador por hora (docs/30 §5.3, §6.4 passos 4, 10 e 11, §6.7, §8.2 e D17), sem o Next: a rota
// (src/app/api/webhooks/recorder) le o corpo cru e os cabecalhos e chama handleRecorderWebhook; o GET assinado do
// jibri-down chama handleRecorderStatusRequest. Ordem do POST:
//   1. assinatura (HMAC-SHA256 de "<timestamp>.<corpo>", 5 min; sem segredo configurado tambem) -> 401, nada gravado;
//   2. JSON + recorderWebhookBodySchema (o finalize.sh manda null nos campos que nao tem: null e "" valem ausente) -> 400;
//   3. sessao inexistente -> o pedido fica em webinar_recording_events com session_id nulo e `ignored`; 202 ignored;
//   4. o pedido bruto em webinar_recording_events (unico por sessao + estado + arquivo + maquina: machine_requested_at e
//      a hora do pedido da maquina no ready / unavailable / gone, 202610290003; o `ready` da segunda maquina da mesma
//      sessao e uma linha nova, com o corpo e a hora dele): repetido -> 200 duplicate sem refazer nada. Tres excecoes:
//      o pedido que falhou antes (500) e processado de novo (o workflow repete e a chave unica segura a linha); o que
//      ficou `pending` (o processo caiu no meio: deploy, tempo esgotado, o banco fora ate na hora de marcar `failed`)
//      e retomado depois de 60 s, numa troca so (claimStalePendingRecordingEvent: duas repeticoes juntas, uma processa);
//      antes disso responde 409 pending e o finalize.sh repete mais tarde; e o estado de maquina sem arquivo que chega
//      de novo da mesma maquina vale quando a transicao ainda cabe;
//   5. sessao que nao e Live ao vivo, ou sala diferente da room_name -> `ignored` com o motivo;
//   6. recorderTransition(atual, estado): nulo (velho ou fora de ordem) -> `ignored`; senao updateRecorderStatus com a
//      situacao esperada (nulo = outro pedido mudou antes: `ignored`). ready / unavailable sem recorder_requested_at
//      gravam a hora (maquina pedida a mao pelo workflow); gone zera o "Gravar" na fila;
//   7. uploaded: a gravacao da sessao (source jibri, provider bunny) inserida ou atualizada com recordingPatchFor
//      (processing, ids da Bunny, duracao, tamanho, sha256 minusculo, arquivo); o job webinar-recordings consulta a
//      Bunny ate `ready` e cria o replay. upload_failed: a gravacao `failed` com o motivo e um e-mail pela fila para o
//      Apresentador (sem ele, quem criou o webinario), uma vez por sessao + estado + arquivo;
//   8. o pedido marcado processed / ignored / failed. Falha inesperada: `failed` e 500 (o workflow repete).
// A ancora (recording_anchor_at) nunca vem daqui: e da acao do Apresentador (webinar_mark_recording_anchor). Nada do
// corpo vai para o log, so ids.

import "server-only";

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { describeError } from "../communications/db";
import { isPendingMigrationError } from "../db/pending-migration";
import { enqueueEmail } from "../email/outbox";
import { idempotencyKeyOf, type EmailKind } from "../email/outbox-rules";
import { renderWebinarRecordingFailedEmail } from "../email/templates/webinar-recording-failed";
import { resolveEmailSiteOrigin } from "../email/transactional";
import { fetchProfilesByIds } from "../students/store";
import { assertNoDbError, isMissingWebinarSchema, WEBINARS_MIGRATION, type WebinarsDb } from "./db";
import { webinarConsoleHref } from "./editor-model";
import { recorderWebhookBodySchema, type RecorderWebhookInput } from "./live-schemas";
import { claimStalePendingRecordingEvent, fetchSessionRecordingRow, insertRecordingEvent, markRecordingEventProcessed, updateRecorderStatus, type SessionLivePatch } from "./live-store";
import { recorderTransition, recordingPatchFor, type RecorderStatus, type RecordingPatch } from "./recorder-model";
import { verifyRecorderSignature } from "./recorder-signature";
import { RECORDING_COLUMNS, recorderStatusOf, type RecordingRow, type SessionRow } from "./rows";
import { fetchSessionRow, fetchWebinarRow } from "./store";

/** O teto do corpo (docs/30 §5.3): 64 KB, o mesmo do check de webinar_recording_events.payload. */
export const RECORDER_WEBHOOK_MAX_BYTES = 64 * 1024;
/** Acima disto o payload guardado e o corpo validado (com a marca), para caber no check de 64 KB do jsonb. */
const STORED_PAYLOAD_MAX_CHARS = 60_000;
/**
 * Um pedido `pending` mais velho que isto ficou para tras (a rota tem maxDuration de 30 s): a repeticao o retoma. O
 * finalize.sh repete em 5, 15, 30 e 60 s, entao a ultima tentativa (cerca de 110 s depois da primeira) ja o alcanca.
 */
export const RECORDER_PENDING_STALE_MS = 60_000;

/** O estado da maquina leva a hora do pedido dela na chave unica (cada maquina da mesma sessao tem a sua linha). */
function machineRequestedAtFor(state: RecorderWebhookInput["state"], session: SessionRow): string | null {
  return state === "ready" || state === "unavailable" || state === "gone" ? (session.recorder_requested_at ?? null) : null;
}

/**
 * O motivo de cada pedido ignorado, gravado em webinar_recording_events.error_message (o console mostra), pelas frases
 * de WEBINAR_COPY.gravacao; tests/webinarios-gravador-webhook.test.mjs passa estas frases pela PROIBIDAS_WEBINARIO.
 */
export const RECORDER_WEBHOOK_REASONS = {
  not_live: WEBINAR_COPY.gravacao.soLiveAoVivo,
  out_of_order: WEBINAR_COPY.gravacao.foraDeOrdem,
  race: WEBINAR_COPY.gravacao.corrida,
  room_mismatch: WEBINAR_COPY.gravacao.salaDiferente,
  unknown_session: WEBINAR_COPY.gravacao.sessaoDesconhecida
} as const;
export type RecorderIgnoredReason = keyof typeof RECORDER_WEBHOOK_REASONS;

/** As respostas do webhook (para a maquina e o workflow; nunca vao para a tela). */
export const RECORDER_WEBHOOK_ERRORS = {
  failed: "Não foi possível processar o pedido do gravador.",
  invalid: "Pedido inválido.",
  notFound: "Sessão não encontrada.",
  pending: "Banco sem a atualização das lives ao vivo.",
  signature: "Assinatura inválida."
} as const;

/** O tipo do e-mail na fila (outbox-rules.EMAIL_KINDS; a coluna email_outbox.kind aceita de 2 a 40 caracteres). */
export const RECORDING_FAILED_EMAIL_KIND: EmailKind = "webinar_recording_failed";

export type RecorderWebhookReply = { body: Record<string, unknown>; status: number };

type Mode = "new" | "redelivery" | "retry";
type Outcome = { kind: "processed"; recorderStatus: RecorderStatus } | { kind: "ignored"; reason: RecorderIgnoredReason; recorderStatus: RecorderStatus };

function isMissingWebinars(error: unknown) {
  return isPendingMigrationError(error) || isMissingWebinarSchema(error);
}

function reply(status: number, body: Record<string, unknown>): RecorderWebhookReply {
  return { body, status };
}

/** O finalize.sh manda `null` (e `""` no sha256 sem leitura) nos campos que nao tem: valem como ausentes. */
export function withoutEmptyFields(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, field]) => field !== null && !(typeof field === "string" && field.trim() === "")));
}

/** O corpo inteiro para auditoria; grande demais para o check de 64 KB do jsonb, so o que foi validado (com a marca). */
function storedPayload(json: unknown, data: RecorderWebhookInput): Record<string, unknown> {
  const raw = json as Record<string, unknown>;
  return JSON.stringify(raw).length > STORED_PAYLOAD_MAX_CHARS ? { ...data, payloadTruncated: true } : raw;
}

/** O que muda na sessao junto com a situacao do gravador. */
function sessionPatchFor(data: RecorderWebhookInput, session: SessionRow, nowIso: string): SessionLivePatch {
  if ((data.state === "ready" || data.state === "unavailable") && !session.recorder_requested_at) {
    return { recorder_requested_at: nowIso };
  }
  if (data.state === "gone") {
    return { recording_requested_at: null };
  }
  return {};
}

/** A gravacao do gravador desta sessao para este arquivo (a mais nova), se ja existe. */
async function fetchJibriRecordingRow(db: WebinarsDb, sessionId: string, fileName: string | null): Promise<RecordingRow | null> {
  let query = db.from("webinar_recordings").select(RECORDING_COLUMNS).eq("session_id", sessionId).eq("source", "jibri");
  query = fileName === null ? query.is("file_name", null) : query.eq("file_name", fileName);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(1);
  assertNoDbError(error, "Webinarios: ler a gravacao do gravador");
  return ((data ?? []) as RecordingRow[])[0] ?? null;
}

/**
 * Grava o resultado do envio na gravacao da sessao: atualiza a do mesmo arquivo que ainda nao esta pronta, ou insere
 * uma nova (source jibri, provider bunny, webinario da sessao). O unico (provider, bunny_video_id) que ja existe e a
 * mesma gravacao: nada a fazer.
 */
async function saveJibriRecording(db: WebinarsDb, session: SessionRow, patch: RecordingPatch): Promise<RecordingRow | null> {
  const fileName = patch.file_name ?? null;
  const existing = await fetchJibriRecordingRow(db, session.id, fileName);

  if (existing?.status === "ready") {
    return existing;
  }

  if (existing) {
    const { data, error } = await db
      .from("webinar_recordings")
      .update({ ...patch, checked_at: null })
      .eq("id", existing.id)
      .neq("status", "ready")
      .select(RECORDING_COLUMNS);
    assertNoDbError(error, "Webinarios: atualizar a gravacao do gravador");
    return ((data ?? []) as RecordingRow[])[0] ?? existing;
  }

  const { data, error } = await db
    .from("webinar_recordings")
    .insert({ ...patch, provider: "bunny", session_id: session.id, source: "jibri", webinar_id: session.webinar_id })
    .select(RECORDING_COLUMNS)
    .single();

  if (error?.code === "23505" && patch.bunny_video_id) {
    const same = await db.from("webinar_recordings").select(RECORDING_COLUMNS).eq("provider", "bunny").eq("bunny_video_id", patch.bunny_video_id).limit(1);
    assertNoDbError(same.error, "Webinarios: ler a gravacao repetida do gravador");
    return ((same.data ?? []) as RecordingRow[])[0] ?? null;
  }

  assertNoDbError(error, "Webinarios: gravar a gravacao do gravador");
  return data as RecordingRow;
}

/** Uma vez por sessao + estado + arquivo (o mesmo desenho da chave unica de webinar_recording_events). */
export function recordingFailedEmailKey(sessionId: string, fileName: string | null | undefined) {
  return idempotencyKeyOf("webinar", "recording_failed", sessionId, "upload_failed", fileName ?? "sem-arquivo");
}

/**
 * O e-mail "A gravação não subiu" pela fila: para o Apresentador (host_user_id) ou, sem e-mail dele, para quem criou
 * o webinario. Sem ninguem com e-mail: so o log (o console mostra a gravacao falha do mesmo jeito).
 */
async function queueRecordingFailedEmail(db: WebinarsDb, session: SessionRow, input: { error: string; fileName: string | null }): Promise<boolean> {
  const webinar = await fetchWebinarRow(db, session.webinar_id);

  if (!webinar) {
    return false;
  }

  const candidates = [...new Set([webinar.host_user_id, webinar.created_by].filter((id): id is string => Boolean(id)))];
  const profiles = candidates.length > 0 ? await fetchProfilesByIds(db, candidates) : [];
  const recipient = candidates
    .map((id) => ({ email: profiles.find((profile) => profile.id === id)?.email?.trim() ?? "", id }))
    .find((candidate) => candidate.email.length > 0);

  if (!recipient) {
    console.warn(`[webinarios] gravacao da sessao ${session.id} falhou e o webinario ${webinar.id} nao tem Apresentador nem autor com e-mail: aviso so no console.`);
    return false;
  }

  const rendered = renderWebinarRecordingFailedEmail({
    error: input.error,
    link: `${resolveEmailSiteOrigin(null)}${webinarConsoleHref(webinar.id)}`,
    title: webinar.title
  });
  const { duplicate } = await enqueueEmail(db, {
    html: rendered.html,
    idempotencyKey: recordingFailedEmailKey(session.id, input.fileName),
    kind: RECORDING_FAILED_EMAIL_KIND,
    metadata: { session_id: session.id, webinar_id: webinar.id },
    subject: rendered.subject,
    text: rendered.text,
    to: recipient.email,
    userId: recipient.id
  });

  return !duplicate;
}

/** Passos 5 a 7 para uma sessao que existe. */
async function processEvent(db: WebinarsDb, input: { data: RecorderWebhookInput; mode: Mode; nowIso: string; session: SessionRow }): Promise<Outcome> {
  const { data, mode, nowIso, session } = input;
  const current = recorderStatusOf(session.recorder_status);

  if (session.kind !== "live") {
    return { kind: "ignored", reason: "not_live", recorderStatus: current };
  }

  if (data.room && data.room.toLowerCase() !== (session.room_name ?? "").toLowerCase()) {
    return { kind: "ignored", reason: "room_mismatch", recorderStatus: current };
  }

  const next = recorderTransition(current, data.state);
  // O pedido que falhou no meio (500) e repetido pelo workflow: a situacao pode ja ter mudado nele.
  const alreadyApplied = mode === "retry" && current === data.state;

  if (!next && !alreadyApplied) {
    return { kind: "ignored", reason: "out_of_order", recorderStatus: current };
  }

  let recorderStatus: RecorderStatus = current;

  if (next) {
    const updated = await updateRecorderStatus(db, session.id, { expected: [current], patch: sessionPatchFor(data, session, nowIso), to: next });

    if (!updated) {
      const fresh = await fetchSessionRow(db, session.id);
      return { kind: "ignored", reason: "race", recorderStatus: recorderStatusOf(fresh?.recorder_status) };
    }

    recorderStatus = next;
  }

  const patch = recordingPatchFor({
    bunnyLibraryId: data.bunnyLibraryId,
    bunnyVideoId: data.bunnyVideoId,
    durationSeconds: data.durationSeconds,
    error: data.error,
    fileName: data.fileName,
    sha256: data.sha256,
    sizeBytes: data.sizeBytes,
    state: data.state
  });

  if (patch) {
    await saveJibriRecording(db, session, patch);
  }

  if (data.state === "upload_failed" && patch) {
    await queueRecordingFailedEmail(db, session, { error: patch.error_message ?? data.error ?? "", fileName: data.fileName ?? null });
  }

  console.info(`[webinarios] gravador: sessao ${session.id} recebeu ${data.state} (${current} -> ${recorderStatus}).`);

  return { kind: "processed", recorderStatus };
}

/**
 * POST /api/webhooks/recorder sem o Next: `rawBody` e o texto exato que foi assinado; `secret` e
 * WEBINAR_RECORDER_WEBHOOK_SECRET. Devolve o status HTTP e o corpo da resposta.
 */
export async function handleRecorderWebhook(input: {
  db: WebinarsDb;
  now: Date;
  rawBody: string;
  secret: string | null | undefined;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
}): Promise<RecorderWebhookReply> {
  const { db, rawBody } = input;
  const nowIso = input.now.toISOString();
  const verification = verifyRecorderSignature({ body: rawBody, now: input.now.getTime(), secret: input.secret, signature: input.signature, timestamp: input.timestamp });

  if (!verification.ok) {
    if (verification.reason === "bad_secret") {
      console.error("[webinarios] WEBINAR_RECORDER_WEBHOOK_SECRET ausente ou invalido: webhook do gravador recusado.");
    } else {
      console.warn(`[webinarios] webhook do gravador recusado: ${verification.reason}.`);
    }
    return reply(401, { error: RECORDER_WEBHOOK_ERRORS.signature });
  }

  let json: unknown;

  try {
    json = JSON.parse(rawBody);
  } catch {
    return reply(400, { error: RECORDER_WEBHOOK_ERRORS.invalid });
  }

  const parsed = recorderWebhookBodySchema.safeParse(withoutEmptyFields(json));

  if (!parsed.success) {
    return reply(400, { error: RECORDER_WEBHOOK_ERRORS.invalid });
  }

  const data = { ...parsed.data, sessionId: parsed.data.sessionId.toLowerCase() };
  const event = { file_name: data.fileName ?? null, payload: storedPayload(json, data), room: data.room ?? null, signature_valid: true, state: data.state };
  let eventId: string | null = null;

  try {
    const session = await fetchSessionRow(db, data.sessionId);

    if (!session) {
      const { row } = await insertRecordingEvent(db, { ...event, machine_requested_at: null, session_id: null });
      await markRecordingEventProcessed(db, row.id, { error: RECORDER_WEBHOOK_REASONS.unknown_session, nowIso, status: "ignored" });
      console.info(`[webinarios] gravador: sessao ${data.sessionId} desconhecida; pedido ${row.id} guardado como ignored.`);
      return reply(202, { status: "ignored" });
    }

    const stored = await insertRecordingEvent(db, { ...event, machine_requested_at: machineRequestedAtFor(data.state, session), session_id: session.id });
    let mode: Mode = "new";

    if (stored.duplicate) {
      if (stored.row.processing_status === "pending") {
        // Ficou para tras (o processo caiu no meio): retoma uma vez so; ainda recente, o finalize.sh repete depois.
        const claimed = await claimStalePendingRecordingEvent(db, { id: stored.row.id, nowIso, staleBeforeIso: new Date(input.now.getTime() - RECORDER_PENDING_STALE_MS).toISOString() });
        if (!claimed) {
          return reply(409, { status: "pending" });
        }
        mode = "retry";
      } else if (stored.row.processing_status === "failed") {
        mode = "retry";
      } else if (data.fileName === undefined) {
        mode = "redelivery";
      } else {
        return reply(200, { status: "duplicate" });
      }
    }

    eventId = stored.row.id;
    const outcome = await processEvent(db, { data, mode, nowIso, session });

    if (outcome.kind === "ignored") {
      if (mode === "redelivery") {
        // O mesmo pedido de novo, sem nada a mudar: a linha guardada fica como estava.
        return reply(200, { status: "duplicate" });
      }
      await markRecordingEventProcessed(db, stored.row.id, { error: RECORDER_WEBHOOK_REASONS[outcome.reason], nowIso, status: "ignored" });
      return reply(200, { reason: outcome.reason, recorderStatus: outcome.recorderStatus, status: "ignored" });
    }

    await markRecordingEventProcessed(db, stored.row.id, { error: null, nowIso, status: "processed" });
    return reply(200, { recorderStatus: outcome.recorderStatus, status: "processed" });
  } catch (error) {
    if (isMissingWebinars(error)) {
      console.error(`[webinarios] webhook do gravador sem as tabelas das lives ao vivo (migracao ${WEBINARS_MIGRATION} pendente).`);
      return reply(503, { error: RECORDER_WEBHOOK_ERRORS.pending });
    }

    console.error(`[webinarios] webhook do gravador (sessao ${data.sessionId}, ${data.state}) falhou: ${describeError(error)}`);

    if (eventId) {
      await markRecordingEventProcessed(db, eventId, { error: describeError(error), nowIso, status: "failed" }).catch(() => undefined);
    }

    return reply(500, { error: RECORDER_WEBHOOK_ERRORS.failed, status: "failed" });
  }
}

/** A situacao do gravador e da gravacao da sessao (o jibri-down confere antes de apagar a maquina); sem sessao, 404. */
export async function recorderStatusReply(input: { db: WebinarsDb; sessionId: string }): Promise<RecorderWebhookReply> {
  const session = await fetchSessionRow(input.db, input.sessionId);

  if (!session) {
    return reply(404, { error: RECORDER_WEBHOOK_ERRORS.notFound });
  }

  const recording = await fetchSessionRecordingRow(input.db, session.id);

  return reply(200, { recorderStatus: recorderStatusOf(session.recorder_status), recordingStatus: recording?.status ?? null });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/webhooks/recorder/[sessionId] sem o Next: a mesma assinatura do POST sobre o corpo vazio ("<timestamp>.")
 * (401), o id (400) e recorderStatusReply.
 */
export async function handleRecorderStatusRequest(input: {
  db: WebinarsDb;
  now: Date;
  secret: string | null | undefined;
  sessionId: string;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
}): Promise<RecorderWebhookReply> {
  const verification = verifyRecorderSignature({ body: "", now: input.now.getTime(), secret: input.secret, signature: input.signature, timestamp: input.timestamp });

  if (!verification.ok) {
    if (verification.reason === "bad_secret") {
      console.error("[webinarios] WEBINAR_RECORDER_WEBHOOK_SECRET ausente ou invalido: consulta do gravador recusada.");
    }
    return reply(401, { error: RECORDER_WEBHOOK_ERRORS.signature });
  }

  if (!UUID.test(input.sessionId)) {
    return reply(400, { error: RECORDER_WEBHOOK_ERRORS.invalid });
  }

  try {
    return await recorderStatusReply({ db: input.db, sessionId: input.sessionId.toLowerCase() });
  } catch (error) {
    if (isMissingWebinars(error)) {
      console.error(`[webinarios] consulta do gravador sem as tabelas das lives ao vivo (migracao ${WEBINARS_MIGRATION} pendente).`);
      return reply(503, { error: RECORDER_WEBHOOK_ERRORS.pending });
    }
    console.error(`[webinarios] consulta do gravador (sessao ${input.sessionId}) falhou: ${describeError(error)}`);
    return reply(500, { error: RECORDER_WEBHOOK_ERRORS.failed });
  }
}
