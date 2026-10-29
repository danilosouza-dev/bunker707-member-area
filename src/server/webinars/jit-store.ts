// "Comeca quando voce entra" no banco (docs/30 §1.2, §1.6, §2.2, A14 e D25; migracao 202610290008), pela service
// role: as regras do webinario (webinars.jit_settings) e a sessao `jit` de cada horario, criada quando o primeiro aluno
// chega (o indice unico (webinar_id, scheduled_at) where jit garante uma por horario: no 23505, le a que ja existe).
// Quem calcula o proximo horario, a janela de horas de Sao Paulo e a espera e jit-model.ts, da frente do
// just-in-time; aqui so o acesso as linhas. Banco sem a 202610290008: PendingMigrationError (WEBINARS_JIT_MIGRATION).

import "server-only";

import { assertNoDbError, type WebinarsDb } from "./db";
import type { JitSettings } from "./model";
import { SESSION_COLUMNS, jitSettingsOfRow, jitSettingsToRow, simulationRulesToRow, type SessionRow } from "./rows";

const UNIQUE_VIOLATION = "23505";

export async function fetchJitSettings(db: WebinarsDb, webinarId: string): Promise<JitSettings | null> {
  const { data, error } = await db.from("webinars").select("id, jit_settings").eq("id", webinarId).is("deleted_at", null).maybeSingle();
  assertNoDbError(error, "Webinarios: ler comeca quando voce entra");
  const row = (data as { id: string; jit_settings: unknown } | null) ?? null;
  return row ? jitSettingsOfRow(row.jit_settings) : null;
}

/** As regras de varios webinarios (a pagina /webinarios e a faixa sabem quais tem "Comeca quando voce entra"). */
export async function listJitSettings(db: WebinarsDb, webinarIds: readonly string[]): Promise<Map<string, JitSettings>> {
  const result = new Map<string, JitSettings>();
  const ids = [...new Set(webinarIds)];
  if (ids.length === 0) {
    return result;
  }
  const { data, error } = await db.from("webinars").select("id, jit_settings").in("id", ids).is("deleted_at", null);
  assertNoDbError(error, "Webinarios: ler comeca quando voce entra");
  for (const row of (data ?? []) as { id: string; jit_settings: unknown }[]) {
    result.set(row.id, jitSettingsOfRow(row.jit_settings));
  }
  return result;
}

export async function saveJitSettings(db: WebinarsDb, input: { settings: JitSettings; webinarId: string }): Promise<JitSettings> {
  const { error } = await db.from("webinars").update({ jit_settings: jitSettingsToRow(input.settings) }).eq("id", input.webinarId);
  assertNoDbError(error, "Webinarios: gravar comeca quando voce entra");
  return jitSettingsOfRow(jitSettingsToRow(input.settings));
}

/** O que a sessao `jit` leva ao nascer: o horario, o video, o chat da sala e a Simulacao copiada das regras. */
export type JitSessionInsert = {
  chat_mode: string;
  chat_slow_mode_seconds: number | null;
  late_join_minutes: number | null;
  recording_id: string | null;
  scheduled_at: string;
  settings: JitSettings;
  source_session_id: string | null;
  webinar_id: string;
};

/**
 * A sessao `jit` daquele horario: cria se ainda nao existe (copiando a Simulacao das regras, com a decisao registrada,
 * D10) ou devolve a que outro aluno ja criou. Sempre `simulated`, `scheduled` (o tick abre na hora, como as outras).
 */
export async function ensureJitSessionRow(db: WebinarsDb, input: JitSessionInsert): Promise<{ created: boolean; row: SessionRow }> {
  const simulation = input.settings.simulation;
  const rules = simulation ? simulationRulesToRow(simulation) : { simulated_count_rule: null, simulated_joins: null, simulated_sale_notices: null };
  const insert = {
    ...rules,
    chat_mode: input.chat_mode,
    chat_slow_mode_seconds: input.chat_slow_mode_seconds,
    jit: true,
    kind: "simulated",
    late_join_minutes: input.late_join_minutes,
    recording_id: input.recording_id,
    scheduled_at: input.scheduled_at,
    show_live_badge: simulation?.showLiveBadge === true,
    simulation_ack_text: simulation?.ackText ?? null,
    simulation_decided_at: simulation?.decidedAt ?? null,
    simulation_decided_by: simulation?.decidedBy ?? null,
    source_session_id: input.source_session_id,
    status: "scheduled",
    webinar_id: input.webinar_id
  };
  const { data, error } = await db.from("webinar_sessions").insert(insert).select(SESSION_COLUMNS).single();
  if (error?.code === UNIQUE_VIOLATION) {
    const existing = await fetchJitSessionRow(db, { scheduledAt: input.scheduled_at, webinarId: input.webinar_id });
    if (existing) {
      return { created: false, row: existing };
    }
  }
  assertNoDbError(error, "Webinarios: criar sessao comeca quando voce entra");
  return { created: true, row: data as SessionRow };
}

export async function fetchJitSessionRow(db: WebinarsDb, input: { scheduledAt: string; webinarId: string }): Promise<SessionRow | null> {
  const { data, error } = await db
    .from("webinar_sessions")
    .select(SESSION_COLUMNS)
    .eq("webinar_id", input.webinarId)
    .eq("jit", true)
    .eq("scheduled_at", input.scheduledAt)
    .maybeSingle();
  assertNoDbError(error, "Webinarios: ler sessao comeca quando voce entra");
  return (data as SessionRow | null) ?? null;
}

/** As sessoes `jit` de um webinario numa janela de horas (o dia da turma, o relatorio e o painel). */
export async function listJitSessionRows(db: WebinarsDb, input: { fromIso: string; toIso: string; webinarId: string }): Promise<SessionRow[]> {
  const { data, error } = await db
    .from("webinar_sessions")
    .select(SESSION_COLUMNS)
    .eq("webinar_id", input.webinarId)
    .eq("jit", true)
    .gte("scheduled_at", input.fromIso)
    .lt("scheduled_at", input.toIso)
    .order("scheduled_at", { ascending: true });
  assertNoDbError(error, "Webinarios: ler sessoes comeca quando voce entra");
  return (data ?? []) as SessionRow[];
}
