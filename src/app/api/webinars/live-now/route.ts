import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/guards";
import { noStore } from "@/server/communications/route-support";
import { jsonRouteError } from "@/server/http/route-errors";
import { isPendingMigrationError } from "@/server/db/pending-migration";
import { hasWebinarAccess, loadStudentAccessFacts } from "@/server/webinars/access";
import { assertNoDbError, isMissingWebinarSchema, webinarsDb, type WebinarsDb } from "@/server/webinars/db";
import { isJitSession } from "@/server/webinars/jit-model";
import { chooseLiveNow, EMPTY_LIVE_NOW, LIVE_NOW_LOOKAHEAD_MS, LIVE_NOW_LOOKBACK_MS, type LiveBannerEntry, type LiveNowData } from "@/server/webinars/live-banner";
import { liveRoomConfigured } from "@/server/webinars/live-model";
import type { Webinar, WebinarSession } from "@/server/webinars/model";
import { sessionDurationMs } from "@/server/webinars/room-model";
import { pickRecording } from "@/server/webinars/room-queries";
import { registrationFromRow, sessionFromRow, webinarFromRow, WEBINAR_COLUMNS, type RecordingRow, type WebinarRow } from "@/server/webinars/rows";
import { fetchRegistrationRows, listRecordingRows, listSessionRowsBetween } from "@/server/webinars/store";

// A faixa "Ao vivo agora" e "Comeca em 1 h: Entrar" do topo de todas as paginas da area (docs/30 §1.1, §1.5 e §2.7):
// GET devolve { data: { serverTime, live: [{ title, href, startedAt }], soon: { title, href, scheduledAt } | null } }.
// So o que o aluno pode ver (publicado, nao apagado e dentro do "Quem pode" de access.ts, como as paginas) e so com a
// vaga dele na "Comeca em"; nada do nome da sala, de token nem de outro aluno. A escolha (no ar > comeca em N min >
// nada, a gravada so com o selo, A16) fica em live-banner.ts; aqui so a leitura.
//
// A faixa pergunta a cada 60 s em toda pagina: as sessoes candidatas (marcadas de 24 h atras ate 60 min a frente,
// ainda nao encerradas) e os webinarios delas sao os mesmos para todos e ficam 15 s na memoria do processo; sem
// candidata (quase sempre) nada mais e lido. So com candidata: o acesso, as vagas do aluno e, na gravada com o selo,
// a duracao do video. Sessao obrigatoria (401); banco sem a migracao dos webinarios: faixa vazia, nunca erro. As
// sessoes do "Comeca quando voce entra" (fase 4e, `jit`) nunca sao candidatas: uma por horario o dia todo, e nenhuma
// e uma live no ar para todos.

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SHARED_CACHE_MS = 15_000;

type Candidates = { sessions: WebinarSession[]; webinars: Webinar[] };

let shared: { db: WebinarsDb; expiresAt: number; value: Candidates } | null = null;

/** Os webinarios publicados (nao apagados) das sessoes candidatas. */
async function readPublishedWebinars(db: WebinarsDb, ids: readonly string[]): Promise<Webinar[]> {
  const { data, error } = await db.from("webinars").select(WEBINAR_COLUMNS).in("id", [...ids]).eq("status", "published").is("deleted_at", null);
  assertNoDbError(error, "Webinarios: ler webinarios da faixa");
  return ((data ?? []) as WebinarRow[]).map((row) => webinarFromRow(row));
}

/** As sessoes que podem estar no ar ou comecar em ate 60 min, com os webinarios delas que tem a faixa ligada. */
async function readCandidates(db: WebinarsDb, nowMs: number): Promise<Candidates> {
  if (shared && shared.db === db && shared.expiresAt > nowMs) {
    return shared.value;
  }
  const rows = await listSessionRowsBetween(db, {
    from: new Date(nowMs - LIVE_NOW_LOOKBACK_MS).toISOString(),
    statuses: ["scheduled", "waiting", "live"],
    to: new Date(nowMs + LIVE_NOW_LOOKAHEAD_MS).toISOString()
  });
  const sessions = rows.map(sessionFromRow).filter((session) => session.kind !== "replay" && !isJitSession(session));
  const ids = Array.from(new Set(sessions.map((session) => session.webinarId)));
  const webinars = ids.length > 0 ? (await readPublishedWebinars(db, ids)).filter((webinar) => webinar.showBanner && !webinar.cancelledAt) : [];
  const kept = new Set(webinars.map((webinar) => webinar.id));
  const value = { sessions: sessions.filter((session) => kept.has(session.webinarId)), webinars };
  shared = { db, expiresAt: nowMs + SHARED_CACHE_MS, value };
  return value;
}

/** A duracao do video de cada sessao gravada com o selo (a gravacao que a sala toca, como room-queries.ts). */
async function readDurations(db: WebinarsDb, webinars: readonly Webinar[], sessions: readonly WebinarSession[]): Promise<Map<string, number>> {
  const durations = new Map<string, number>();
  const badged = sessions.filter((session) => session.kind === "simulated" && session.showLiveBadge);
  if (badged.length === 0) {
    return durations;
  }
  const recordings = await listRecordingRows(db, Array.from(new Set(badged.map((session) => session.webinarId))));
  const byWebinar = new Map<string, RecordingRow[]>();
  for (const recording of recordings) {
    byWebinar.set(recording.webinar_id, [...(byWebinar.get(recording.webinar_id) ?? []), recording]);
  }
  for (const session of badged) {
    const webinar = webinars.find((item) => item.id === session.webinarId);
    if (webinar) {
      const recording = pickRecording(byWebinar.get(session.webinarId) ?? [], session);
      durations.set(session.id, sessionDurationMs(recording?.duration_seconds, webinar.durationMinutes));
    }
  }
  return durations;
}

async function readLiveNow(db: WebinarsDb, userId: string, nowMs: number): Promise<Omit<LiveNowData, "serverTime">> {
  const candidates = await readCandidates(db, nowMs);
  if (candidates.webinars.length === 0) {
    return EMPTY_LIVE_NOW;
  }
  const facts = await loadStudentAccessFacts(db, userId, candidates.webinars, nowMs);
  const webinars = candidates.webinars.filter((webinar) => hasWebinarAccess(facts, webinar));
  if (webinars.length === 0) {
    return EMPTY_LIVE_NOW;
  }
  const ids = webinars.map((webinar) => webinar.id);
  const sessions = candidates.sessions.filter((session) => ids.includes(session.webinarId));
  const [registrationRows, durations] = await Promise.all([fetchRegistrationRows(db, { userId, webinarIds: ids }), readDurations(db, webinars, sessions)]);
  const registrations = registrationRows.map(registrationFromRow);
  const entries: LiveBannerEntry[] = webinars.map((webinar) => ({
    durationMsBySession: durations,
    registrations: registrations.filter((registration) => registration.webinarId === webinar.id),
    sessions: sessions.filter((session) => session.webinarId === webinar.id),
    webinar
  }));
  return chooseLiveNow({ entries, meetConfigured: liveRoomConfigured(process.env), nowMs });
}

export async function GET() {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) {
    return noStore(auth.response!);
  }

  const nowMs = Date.now();
  const serverTime = new Date(nowMs).toISOString();

  try {
    const choice = await readLiveNow(webinarsDb(), auth.user.id, nowMs);
    const data: LiveNowData = { live: choice.live, serverTime, soon: choice.soon };
    return noStore(NextResponse.json({ data }));
  } catch (error) {
    if (isMissingWebinarSchema(error) || isPendingMigrationError(error)) {
      const data: LiveNowData = { ...EMPTY_LIVE_NOW, serverTime };
      return noStore(NextResponse.json({ data }));
    }
    return noStore(jsonRouteError(error, "Não foi possível ler as lives no ar."));
  }
}
