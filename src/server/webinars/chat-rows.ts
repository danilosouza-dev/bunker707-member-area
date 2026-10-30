// As linhas da fase 2 no banco (202610290001) e a traducao para o modelo: chat, roteiro, transcricao, reacoes,
// enquetes, perguntas, aceite, presenca. Modulo puro (sem "server-only", imports relativos) para os testes
// carregarem os tradutores direto; quem le e grava e chat-store.ts.

import {
  CHAT_ROLES,
  CHAT_SOURCES,
  DISPLAY_NAME_MODES,
  MESSAGE_KINDS,
  PERSONA_ROLES,
  POLL_KINDS,
  POLL_STATUSES,
  PRESENCE_STATES,
  QUESTION_STATUSES,
  SCRIPT_STATUSES,
  SCRIPT_TRIGGERS,
  TRANSCRIPT_FORMATS,
  type Attendance,
  type ChatConsent,
  type ChatMessage,
  type ChatRole,
  type ChatSource,
  type DisplayNameMode,
  type MessageKind,
  type PersonaRole,
  type Poll,
  type PollAnswer,
  type PollKind,
  type PollOption,
  type PollStatus,
  type PresenceSample,
  type PresenceState,
  type QuestionStatus,
  type RecordingTranscript,
  type ScriptItem,
  type ScriptStatus,
  type ScriptTrigger,
  type WebinarQuestion,
  type WebinarTranscriptFormat
} from "./model";

function oneOf<T extends string | number>(values: readonly T[], value: unknown, fallback: T): T {
  return (values as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

export const CHAT_MESSAGE_COLUMNS =
  "id, webinar_id, session_id, offset_ms, author_user_id, display_name, role, source, body, kind, reply_to_id, script_item_id, master, approved, approved_by, approved_at, pinned_at, deleted_at, deleted_by, deleted_reason, created_at";

export type ChatMessageRow = {
  approved: boolean;
  approved_at: string | null;
  approved_by: string | null;
  author_user_id: string | null;
  body: string;
  created_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  deleted_reason: string | null;
  display_name: string;
  id: string;
  kind: string;
  master: boolean;
  offset_ms: number;
  pinned_at: string | null;
  reply_to_id: string | null;
  role: string;
  script_item_id: string | null;
  session_id: string;
  source: string;
  webinar_id: string;
};

export function chatMessageFromRow(row: ChatMessageRow): ChatMessage {
  return {
    approved: row.approved,
    authorUserId: row.author_user_id,
    body: row.body,
    createdAt: row.created_at,
    displayName: row.display_name,
    id: row.id,
    kind: oneOf<MessageKind>(MESSAGE_KINDS, row.kind, "message"),
    master: row.master,
    offsetMs: row.offset_ms,
    pinnedAt: row.pinned_at,
    replyToId: row.reply_to_id,
    role: oneOf<ChatRole>(CHAT_ROLES, row.role, "student"),
    scriptItemId: row.script_item_id,
    sessionId: row.session_id,
    source: oneOf<ChatSource>(CHAT_SOURCES, row.source, "audience"),
    webinarId: row.webinar_id
  };
}

/** O que webinar_chat_window devolve (sem webinar_id/session_id: a janela e de uma sessao so). */
export type ChatWindowRow = {
  approved: boolean;
  author_user_id: string | null;
  body: string;
  created_at: string;
  display_name: string;
  id: string;
  kind: string;
  master: boolean;
  offset_ms: number;
  pinned_at: string | null;
  reply_to_id: string | null;
  role: string;
  source: string;
};

export function chatMessageFromWindowRow(row: ChatWindowRow, sessionId: string, webinarId: string): ChatMessage {
  return chatMessageFromRow({ ...row, approved_at: null, approved_by: null, deleted_at: null, deleted_by: null, deleted_reason: null, script_item_id: null, session_id: sessionId, webinar_id: webinarId });
}

export const SCRIPT_ITEM_COLUMNS =
  "id, webinar_id, trigger_kind, offset_ms, phrase, phrase_delay_ms, resolved_offset_ms, resolved_transcript_id, persona_name, persona_role, body, kind, status, position, generated_by_ai, created_by, created_at, updated_at";

export type ScriptItemRow = {
  body: string;
  created_at: string;
  created_by: string | null;
  generated_by_ai: boolean;
  id: string;
  kind: string;
  offset_ms: number | null;
  persona_name: string;
  persona_role: string;
  phrase: string | null;
  phrase_delay_ms: number;
  position: number;
  resolved_offset_ms: number | null;
  resolved_transcript_id: string | null;
  status: string;
  trigger_kind: string;
  updated_at: string;
  webinar_id: string;
};

export function scriptItemFromRow(row: ScriptItemRow): ScriptItem {
  return {
    body: row.body,
    createdAt: row.created_at,
    generatedByAi: row.generated_by_ai,
    id: row.id,
    kind: row.kind === "question" ? "question" : "message",
    offsetMs: row.offset_ms,
    personaName: row.persona_name,
    personaRole: oneOf<PersonaRole>(PERSONA_ROLES, row.persona_role, "student"),
    phrase: row.phrase,
    phraseDelayMs: row.phrase_delay_ms ?? 0,
    position: row.position,
    resolvedOffsetMs: row.resolved_offset_ms,
    resolvedTranscriptId: row.resolved_transcript_id,
    status: oneOf<ScriptStatus>(SCRIPT_STATUSES, row.status, "draft"),
    triggerKind: oneOf<ScriptTrigger>(SCRIPT_TRIGGERS, row.trigger_kind, "at_offset"),
    updatedAt: row.updated_at,
    webinarId: row.webinar_id
  };
}

export const TRANSCRIPT_COLUMNS = "id, recording_id, language, source_format, cues, checksum, created_by, created_at, updated_at";

export type TranscriptRow = {
  checksum: string;
  created_at: string;
  created_by: string | null;
  cues: unknown;
  id: string;
  language: string;
  recording_id: string;
  source_format: string;
  updated_at: string;
};

/** As cues como lesson_transcripts guarda ({ startSeconds, endSeconds, text }); lixo e ignorado. */
export function transcriptCuesOf(value: unknown): RecordingTranscript["cues"] {
  if (!Array.isArray(value)) {
    return [];
  }
  const cues: RecordingTranscript["cues"] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const source = entry as Record<string, unknown>;
    const start = Number(source.startSeconds);
    const text = typeof source.text === "string" ? source.text : "";
    if (!Number.isFinite(start) || !text) {
      continue;
    }
    const end = Number(source.endSeconds);
    cues.push({ endSeconds: Number.isFinite(end) ? end : null, startSeconds: start, text });
  }
  return cues;
}

export function transcriptFromRow(row: TranscriptRow): RecordingTranscript {
  return {
    createdAt: row.created_at,
    cues: transcriptCuesOf(row.cues),
    id: row.id,
    language: row.language,
    recordingId: row.recording_id,
    sourceFormat: oneOf<WebinarTranscriptFormat>(TRANSCRIPT_FORMATS, row.source_format, "vtt")
  };
}

export const CONSENT_COLUMNS = "user_id, consent_version, display_mode, nickname, consented_at, revoked_at, created_at, updated_at";

export type ConsentRow = {
  consent_version: number;
  consented_at: string;
  created_at: string;
  display_mode: string;
  nickname: string | null;
  revoked_at: string | null;
  updated_at: string;
  user_id: string;
};

export function consentFromRow(row: ConsentRow): ChatConsent {
  return {
    consentVersion: row.consent_version,
    consentedAt: row.consented_at,
    displayMode: oneOf<DisplayNameMode>(DISPLAY_NAME_MODES, row.display_mode, "first_name_initial"),
    nickname: row.nickname,
    revokedAt: row.revoked_at,
    userId: row.user_id
  };
}

export const REACTION_COLUMNS = "id, session_id, user_id, offset_ms, reaction, created_at";

export type ReactionRow = { created_at: string; id: string; offset_ms: number; reaction: string; session_id: string; user_id: string };

export const POLL_COLUMNS =
  "id, webinar_id, session_id, template_poll_id, question, kind, anonymous, status, open_offset_ms, opened_at, closed_at, results_shared_at, position, created_by, created_at, updated_at";

export type PollRow = {
  anonymous: boolean;
  closed_at: string | null;
  created_at: string;
  created_by: string | null;
  id: string;
  kind: string;
  open_offset_ms: number | null;
  opened_at: string | null;
  position: number;
  question: string;
  results_shared_at: string | null;
  session_id: string | null;
  status: string;
  template_poll_id: string | null;
  updated_at: string;
  webinar_id: string;
};

export const POLL_OPTION_COLUMNS = "id, poll_id, label, position, created_at";

export type PollOptionRow = { created_at: string; id: string; label: string; poll_id: string; position: number };

export function pollFromRow(row: PollRow, options: readonly PollOptionRow[]): Poll {
  return {
    anonymous: row.anonymous,
    closedAt: row.closed_at,
    id: row.id,
    kind: oneOf<PollKind>(POLL_KINDS, row.kind, "single"),
    openOffsetMs: row.open_offset_ms,
    openedAt: row.opened_at,
    options: options
      .filter((option) => option.poll_id === row.id)
      .sort((a, b) => a.position - b.position)
      .map((option): PollOption => ({ id: option.id, label: option.label, position: option.position })),
    position: row.position,
    question: row.question,
    resultsSharedAt: row.results_shared_at,
    sessionId: row.session_id,
    status: oneOf<PollStatus>(POLL_STATUSES, row.status, "draft"),
    templatePollId: row.template_poll_id,
    webinarId: row.webinar_id
  };
}

export const POLL_ANSWER_COLUMNS = "id, poll_id, session_id, user_id, option_ids, offset_ms, deleted_at, created_at";

export type PollAnswerRow = {
  created_at: string;
  deleted_at: string | null;
  id: string;
  offset_ms: number;
  option_ids: string[];
  poll_id: string;
  session_id: string;
  user_id: string;
};

export function pollAnswerFromRow(row: PollAnswerRow): PollAnswer {
  return { createdAt: row.created_at, id: row.id, offsetMs: row.offset_ms, optionIds: row.option_ids ?? [], pollId: row.poll_id, sessionId: row.session_id, userId: row.user_id };
}

export const QUESTION_COLUMNS =
  "id, session_id, user_id, display_name, anonymous, body, message_id, status, upvotes, answered_by, answer_text, answered_live, answered_at, offset_ms, deleted_at, deleted_reason, created_at, updated_at";

export type QuestionRow = {
  anonymous: boolean;
  answer_text: string | null;
  answered_at: string | null;
  answered_by: string | null;
  answered_live: boolean;
  body: string;
  created_at: string;
  deleted_at: string | null;
  deleted_reason: string | null;
  display_name: string;
  id: string;
  message_id: string | null;
  offset_ms: number;
  session_id: string;
  status: string;
  updated_at: string;
  upvotes: number;
  user_id: string;
};

export function questionFromRow(row: QuestionRow): WebinarQuestion {
  return {
    anonymous: row.anonymous,
    answerText: row.answer_text,
    answeredAt: row.answered_at,
    answeredBy: row.answered_by,
    answeredLive: row.answered_live,
    body: row.body,
    createdAt: row.created_at,
    displayName: row.display_name,
    id: row.id,
    messageId: row.message_id,
    offsetMs: row.offset_ms,
    sessionId: row.session_id,
    status: oneOf<QuestionStatus>(QUESTION_STATUSES, row.status, "open"),
    upvotes: row.upvotes ?? 0,
    userId: row.user_id
  };
}

export const PRESENCE_COLUMNS = "session_id, user_id, bucket, state, offset_seconds, first_at, last_at, samples";

export type PresenceRow = {
  bucket: number;
  first_at: string;
  last_at: string;
  offset_seconds: number;
  samples: number;
  session_id: string;
  state: string;
  user_id: string;
};

export function presenceFromRow(row: PresenceRow): PresenceSample {
  return {
    bucket: row.bucket,
    firstAt: row.first_at,
    lastAt: row.last_at,
    offsetSeconds: row.offset_seconds,
    samples: row.samples,
    sessionId: row.session_id,
    state: oneOf<PresenceState>(PRESENCE_STATES, row.state, "playing"),
    userId: row.user_id
  };
}

export const ATTENDANCE_COLUMNS = "session_id, user_id, first_at, last_at, entries, seconds, max_bucket, reached_end";

export type AttendanceRow = {
  entries: number;
  first_at: string;
  last_at: string;
  max_bucket: number;
  reached_end: boolean;
  seconds: number;
  session_id: string;
  user_id: string;
};

export function attendanceFromRow(row: AttendanceRow): Attendance {
  return {
    entries: row.entries,
    firstAt: row.first_at,
    lastAt: row.last_at,
    maxBucket: row.max_bucket,
    reachedEnd: row.reached_end,
    seconds: row.seconds,
    sessionId: row.session_id,
    userId: row.user_id
  };
}

/** O que webinar_attendees devolve (a lista por aluno, base do CSV). */
export type AttendeeRow = {
  entries: number | null;
  first_at: string | null;
  last_at: string | null;
  messages: number | string;
  polls: number | string;
  questions: number | string;
  reached_end: boolean;
  reactions: number | string;
  registered: boolean;
  seconds: number | null;
  source: string | null;
  user_id: string;
};

export type Attendee = {
  entries: number;
  firstAt: string | null;
  lastAt: string | null;
  messages: number;
  polls: number;
  questions: number;
  reachedEnd: boolean;
  reactions: number;
  registered: boolean;
  seconds: number;
  source: string | null;
  userId: string;
};

export function attendeeFromRow(row: AttendeeRow): Attendee {
  const count = (value: unknown) => {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : 0;
  };
  return {
    entries: count(row.entries),
    firstAt: row.first_at,
    lastAt: row.last_at,
    messages: count(row.messages),
    polls: count(row.polls),
    questions: count(row.questions),
    reachedEnd: row.reached_end === true,
    reactions: count(row.reactions),
    registered: row.registered === true,
    seconds: count(row.seconds),
    source: row.source,
    userId: row.user_id
  };
}
