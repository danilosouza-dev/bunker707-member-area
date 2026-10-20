import "server-only";

// Apoio das rotas do aluno do sino e dos pop-ups (src/app/api/notifications/**, src/app/api/popups/**):
// resposta sem cache (cada aluno ve so o proprio sino) e o historico em student_events, que e
// secundario: falha vira log e nunca muda a resposta.

import { recordEvents, studentsDb, type StudentEventInsert } from "@/server/students/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function noStore<Reply extends Response>(response: Reply): Reply {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Cookie");
  return response;
}

/** Historico do aluno (notification_read, message_impressed...): so ids no metadata. */
export async function recordCommunicationEvents(events: StudentEventInsert[]) {
  try {
    await recordEvents(studentsDb(), events);
  } catch (error) {
    console.error(`[notificacoes] ${events.length} evento(s) nao gravado(s): ${error instanceof Error ? error.message : String(error)}`);
  }
}
