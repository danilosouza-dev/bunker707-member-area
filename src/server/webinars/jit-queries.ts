// "Comeca quando voce entra" no servidor (fase 4e; docs/30 §1.2, §1.6, §2.2, A14, D10, D25 e D33): a entrada do
// aluno (enterJitSession, a rota POST /api/webinars/[id]/jit), as regras e o video que a pagina /webinarios precisa
// (loadJitContexts) e o que o card Sessoes do editor mostra (loadJitEditorData). As contas (o horario atual e o
// proximo, a janela de Sao Paulo, a Entrada atrasada) ficam em jit-model.ts; o acesso as linhas, em jit-store.ts.
//
// A entrada, na ordem: o webinario publicado que o aluno pode ver (404 fora do acesso, sem dizer se existe), o
// banimento de todos os webinarios (409 banned, D33), a Live gravada nao cancelada com o just-in-time ligado e o video
// base (409 off), o horario (o atual quando ainda aceita entrada, senao o proximo com a sala ja aberta; fora disso 409
// closed com a hora do proximo) e a sessao `jit` daquele horario: criada copiando a Simulacao das regras (com a decisao
// registrada) ou a que outro aluno ja criou (o indice unico e o 23505 de ensureJitSessionRow). A sessao nasce com o
// chat da sala, a Entrada atrasada das regras e o video base, como as sessoes marcadas (actions.ts). Nunca vaga.

import "server-only";

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import type { StudentEventInsert } from "../students/store";
import { replyAllDefaultFor, setSessionReplyAll } from "./assistant-store";
import { WebinarError, type WebinarsDb } from "./db";
import { jitDayRange, jitEntryChoice, nextJitSlot, type JitEntryChoice, type JitSessionSummary } from "./jit-model";
import { fetchJitSettings, listJitSessionRows, listJitSettings, ensureJitSessionRow } from "./jit-store";
import { fetchUserBan } from "./live-store";
import { toTime, type JitSettings, type SessionStatus, type Webinar } from "./model";

export type { JitSessionSummary } from "./jit-model";
import { loadStudentWebinarById } from "./registrations";
import { sessionDurationMs } from "./room-model";
import type { RecordingRow } from "./rows";
import { listRecordingRows } from "./store";
import { roomHref } from "./student-model";

const COPY = WEBINAR_COPY.jit;

/** Por que o aluno nao entra (409): banido de todos (D33), sem o just-in-time ou fora do horario (a sala ainda fechada). */
export type JitRefusal = "banned" | "closed" | "off";

export class JitRefusedError extends WebinarError {
  reason: JitRefusal;
  /** No `closed`: a hora do proximo horario (a pagina mostra a contagem). */
  scheduledAt: string | null;

  constructor(reason: JitRefusal, message: string, scheduledAt: string | null = null) {
    super(message, 409);
    this.name = "JitRefusedError";
    this.reason = reason;
    this.scheduledAt = scheduledAt;
  }
}

/**
 * O video da Live gravada que a sessao `jit` toca: a gravacao base (sem sessao, da Bunny) com o endereco do player ou
 * o video da biblioteca; sem ele, nada (a rota recusa: a sala nao teria o que tocar).
 */
export function jitBaseRecording(recordings: readonly RecordingRow[]): RecordingRow | null {
  const base = recordings.find((recording) => recording.session_id === null && recording.source === "bunny") ?? recordings.find((recording) => recording.session_id === null) ?? null;
  if (!base) {
    return null;
  }
  const hasVideo = Boolean(base.embed_url?.trim()) || Boolean(base.bunny_library_id && base.bunny_video_id);
  return hasVideo ? base : null;
}

export type JitEntered = {
  /** Esta chamada criou a sessao (o primeiro aluno do horario). */
  created: boolean;
  /** O historico (webinar_jit_entered), gravado depois da resposta. */
  events: StudentEventInsert[];
  roomHref: string;
  scheduledAt: string;
  sessionId: string;
  which: JitEntryChoice["which"];
};

/** A entrada do aluno no horario de agora (a rota POST /api/webinars/[id]/jit). */
export async function enterJitSession(input: { db: WebinarsDb; now: Date; userId: string; webinarId: string }): Promise<JitEntered> {
  const { db, userId } = input;
  const nowMs = input.now.getTime();
  const { webinar } = await loadStudentWebinarById(db, userId, input.webinarId, nowMs);

  if (await fetchUserBan(db, userId)) {
    throw new JitRefusedError("banned", WEBINAR_COPY.aoVivo.banido);
  }

  if (webinar.cancelledAt) {
    throw new JitRefusedError("off", COPY.servidor.cancelado);
  }

  if (webinar.kind !== "simulated") {
    throw new JitRefusedError("off", COPY.servidor.soLiveGravada);
  }

  const settings = await fetchJitSettings(db, webinar.id);

  if (!settings?.enabled) {
    throw new JitRefusedError("off", COPY.servidor.desligado);
  }

  const recording = jitBaseRecording(await listRecordingRows(db, [webinar.id]));

  if (!recording) {
    throw new JitRefusedError("off", COPY.servidor.desligado);
  }

  const durationMs = sessionDurationMs(recording.duration_seconds, webinar.durationMinutes);
  const info = nextJitSlot({ durationMs, nowMs, settings });
  const choice = jitEntryChoice(info);

  if (!choice) {
    throw new JitRefusedError("closed", COPY.servidor.foraDoHorario, info.next?.iso ?? null);
  }

  const { created, row } = await ensureJitSessionRow(db, {
    chat_mode: webinar.roomSettings.chatMode,
    chat_slow_mode_seconds: webinar.roomSettings.slowModeSeconds,
    late_join_minutes: settings.lateJoinMinutes,
    recording_id: recording.id,
    scheduled_at: choice.slot.iso,
    settings,
    source_session_id: null,
    webinar_id: webinar.id
  });

  // A sessao acabou de nascer: segue o "Responder tudo" padrao do Assistente (uma leitura so na criacao).
  if (created && (await replyAllDefaultFor(db, webinar.id))) {
    await setSessionReplyAll(db, { on: true, sessionId: row.id });
  }

  // A sessao daquele horario encerrada ou cancelada (a equipe encerrou antes da hora): o aluno espera o proximo.
  if (row.status === "ended" || row.status === "cancelled") {
    throw new JitRefusedError("closed", COPY.servidor.foraDoHorario, info.next?.iso ?? null);
  }

  return {
    created,
    events: [
      {
        entity_id: row.id,
        entity_type: "webinar",
        event_type: "webinar_jit_entered",
        metadata: { created, slot: choice.which, webinar_id: webinar.id },
        user_id: userId
      }
    ],
    roomHref: roomHref(webinar.slug, row.id),
    scheduledAt: new Date(toTime(row.scheduled_at)).toISOString(),
    sessionId: row.id,
    which: choice.which
  };
}

/** O que a pagina /webinarios precisa do just-in-time de cada webinario: as regras e a duracao do video. */
export type JitContext = { durationMs: number | null; settings: JitSettings };

/**
 * As regras dos webinarios gravados (uma leitura) e, so dos que tem o just-in-time ligado, a duracao do video base (uma
 * leitura das gravacoes). Os outros ficam fora do mapa.
 */
export async function loadJitContexts(db: WebinarsDb, webinars: readonly Pick<Webinar, "durationMinutes" | "id" | "kind">[]): Promise<Map<string, JitContext>> {
  const result = new Map<string, JitContext>();
  const simulated = webinars.filter((webinar) => webinar.kind === "simulated");
  if (simulated.length === 0) {
    return result;
  }
  const settings = await listJitSettings(db, simulated.map((webinar) => webinar.id));
  const enabled = simulated.filter((webinar) => settings.get(webinar.id)?.enabled === true);
  if (enabled.length === 0) {
    return result;
  }
  const recordings = await listRecordingRows(db, enabled.map((webinar) => webinar.id));
  for (const webinar of enabled) {
    const base = jitBaseRecording(recordings.filter((recording) => recording.webinar_id === webinar.id));
    result.set(webinar.id, { durationMs: base ? sessionDurationMs(base.duration_seconds, webinar.durationMinutes) : null, settings: settings.get(webinar.id)! });
  }
  return result;
}

export type JitEditorData = { sessionsToday: JitSessionSummary[]; settings: JitSettings };

/** As regras e as sessoes que nasceram hoje (dia de Sao Paulo) para o card Sessoes do editor. */
export async function loadJitEditorData(db: WebinarsDb, webinarId: string, nowMs: number): Promise<JitEditorData | null> {
  const settings = await fetchJitSettings(db, webinarId);
  if (!settings) {
    return null;
  }
  const rows = await listJitSessionRows(db, { ...jitDayRange(nowMs), webinarId });
  return {
    sessionsToday: rows.map((row) => ({ id: row.id, scheduledAt: new Date(toTime(row.scheduled_at)).toISOString(), status: row.status as SessionStatus })),
    settings
  };
}
