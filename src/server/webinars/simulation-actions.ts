"use server";

// Server Actions do card Simulacao do editor (docs/30 §2.2, §2.6, §4.3, §5.2, §8.6; D6, D10, D25): ler as regras das
// sessoes gravadas do webinario (loadSessionSimulations, messaging.write) e gravar a decisao de uma sessao de uma vez
// (saveSessionSimulation, messaging.publish): o selo "Ao vivo", o contador, as entradas e saidas e os avisos de venda,
// com a frase de §8.6 conferida no servidor (simulationAckSentenceV4 com a data de hoje em Sao Paulo, ou a de ontem
// para a tela aberta antes da meia-noite, e o nome de quem decide), quem decidiu (o usuario) e quando (agora, no
// servidor). Com algo simulado ligado, a caixa marcada e obrigatoria (o zod de simulation-schemas.ts e a frase). So a
// sessao gravada que ainda nao comecou: a live, o replay e a cancelada recusam com 409 (o banco tambem recusa a live,
// check webinar_sessions_simulation_not_live_v4), a que ja comecou (no ar ou com a hora marcada passada) nao muda no
// meio e a encerrada fica registrada como estava. A auditoria leva os
// valores (D10: numeros e booleanos; dos avisos de venda, so a contagem). A semente nunca sai daqui. Banco sem a
// 202610300003: a leitura devolve { pendingMigration } (o card volta ao selo da fase 2) e a escrita, 409 com a frase.
// Adendo de 10/11/2026 (R7): a sessao `live` tambem tem a Simulacao (o contador, as entradas e os avisos de venda; nunca
// o selo "Ao vivo", que e da gravada: ligado na live, erro no campo), com a frase da live (simulationAckSentenceLive) e o
// zero no started_at: na espera ainda muda; no ar ou encerrada, nao. O Replay recusa com 409. Banco sem a 202611100002
// (o check antigo webinar_sessions_simulation_not_live_v4 ainda la): a gravacao da live volta 409 com a frase da
// migracao; a gravada segue como antes.
// Os participantes simulados mudados a qualquer momento (docs/30 D79, pedido do produtor de 11/11/2026; reabre o D10 e
// o D74 so para o numero): saveSimulatedAudience [messaging.publish] muda o +N da gravada e da live antes, durante e
// depois do comeco, ate o Encerrar, pelo console ou pelo card (o card deixa de travar o numero; as entradas e os avisos
// de venda continuam travados no ar pelo saveSessionSimulation). Cada mudanca pede de novo a caixa com a frase dela (a
// da decisao com o numero novo, simulationAudienceAckFor; o Tirar grava a frase do +0 sem caixa), grava uma linha em
// webinar_simulation_changes (antes do comeco sem offset, trocando tambem a regra da sessao; no ar, o offset do relogio
// da Simulacao, e a sala chega no numero em 90 s) e depois a decisao na sessao (quem, quando e a frase), que muda o
// carimbo que a sala ja le na consulta de 5 s. Banco sem a 202611110002: 409 com a frase dela, antes de gravar.
// loadSessionSimulations leva tambem a vista do controle de cada sessao (o numero de agora e as mudancas com o nome).
// Correcao da revisao v8 (11/11/2026, achado 6): a vista leva a hora da decisao lida com as regras (`decidedAt`), o card
// a manda de volta (`expectedDecidedAt`) e o saveSessionSimulation recusa com 409 ("A simulação desta sessão mudou em
// outro lugar...") quando a sessao ja tem outra decisao, conferida na leitura e de novo na escrita (condicional): o card
// aberto antes de uma mudanca feita no console nunca grava o numero antigo por cima.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { runAdminAction } from "@/server/actions/run-action";
import { recordAudit } from "@/server/audit/log";
import { getUserDisplayName } from "@/server/auth/session";
import { isSameVersion } from "@/server/communications/campaign-model";
import { isPendingMigrationError } from "@/server/db/pending-migration";
import { invalidateWebinars } from "./cache";
import { WEBINARS_AUDIENCE_MIGRATION, WEBINARS_OFFERS_MIGRATION, WEBINARS_SCREEN_MIGRATION, WebinarError, WebinarFieldError, isMissingWebinarSchema, webinarsDb } from "./db";
import { SIMULATION_LIMITS, type SessionSimulation, type SimulationChangeRecord, type WebinarSession } from "./model";
import { sessionFromRow, type SessionRow } from "./rows";
import { simulationAudienceViewOf, type SimulationAudienceView } from "./simulation-audience-model";
import {
  clampSimulationAck,
  normalizeSimulationRules,
  simulationAckFlags,
  simulationAckFor,
  simulationAckMatches,
  simulationAudienceAckFor,
  simulationAudienceAckMatches,
  simulationAudienceExtraOf,
  simulationAudienceFlagsOf,
  simulationAudienceNeedsAck,
  simulationAudienceRule,
  simulationAudienceRuleAt,
  simulationClockMs,
  simulationSessionStarted
} from "./simulation-model";
import { SIMULATION_MESSAGES, saveSessionSimulationSchema, saveSimulatedAudienceSchema, simulationNeedsAck } from "./simulation-schemas";
import {
  LiveSimulationPendingError,
  SimulationChangedError,
  fetchSessionSimulation,
  insertSimulationChange,
  listSessionSimulations,
  listSimulationChanges,
  loadSimulationChangeNames,
  recordSimulationDecision,
  saveSessionSimulationRows,
  withCountChanges
} from "./simulation-store";
import { fetchSessionRow, listSessionRows, requireWebinarRow } from "./store";

const LIST_PATH = "/admin/comunicacao/webinarios";
const COPY = WEBINAR_COPY.simulacao;

const webinarIdSchema = z.object({ webinarId: z.uuid({ error: SIMULATION_MESSAGES.invalid }) });

/**
 * As regras de uma sessao como o card recebe (sem a semente: so o servidor calcula com ela; sem as mudancas cruas), com
 * a vista do controle dos participantes simulados (D79: o numero de agora e as mudancas com o nome).
 */
export type SessionSimulationView = Omit<SessionSimulation, "countChanges" | "seed"> & {
  audience?: SimulationAudienceView;
  /**
   * A hora da decisao gravada junto com estas regras (nula: sem decisao). O card manda de volta ao salvar, e o servidor
   * recusa com 409 quando a sessao ja tem outra (a revisao v8, achado 6). Ausente nos dubles antigos.
   */
  decidedAt?: string | null;
};

export type SessionSimulationsData = { migration: string; pendingMigration: true } | { pendingMigration: false; simulations: SessionSimulationView[] };

export type SavedSessionSimulation = { deciderName: string; session: WebinarSession; simulation: SessionSimulationView };

export type SaveSessionSimulationInput = z.input<typeof saveSessionSimulationSchema>;

export type SaveSimulatedAudienceInput = z.input<typeof saveSimulatedAudienceSchema>;

export type SavedSimulatedAudience = { audience: SimulationAudienceView; deciderName: string; session: WebinarSession };

function viewOf(simulation: SessionSimulation, decidedAt: string | null, audience?: SimulationAudienceView): SessionSimulationView {
  return { audience, countRule: simulation.countRule, decidedAt, joins: simulation.joins, saleNotices: simulation.saleNotices, sessionId: simulation.sessionId, summary: simulation.summary };
}

/** A mesma decisao: as duas sem decisao, ou a mesma hora (o PostgREST escreve "+00:00", o toISOString "Z"). */
function sameDecision(current: string | null, expected: string | null): boolean {
  if (current === null || expected === null) {
    return current === expected;
  }
  return isSameVersion(current, expected);
}

/** A vista do controle de uma sessao agora (o relogio da Simulacao dela). */
function audienceViewOf(input: {
  names: Record<string, string>;
  nowMs: number;
  pendingMigration: boolean;
  records: readonly SimulationChangeRecord[];
  row: Pick<SessionRow, "kind" | "scheduled_at" | "show_live_badge" | "started_at">;
  simulation: SessionSimulation;
}): SimulationAudienceView {
  const { row, simulation } = input;
  return simulationAudienceViewOf({
    flags: simulationAudienceFlagsOf({ joins: simulation.joins, saleNotices: simulation.saleNotices, showLiveBadge: row.show_live_badge === true }),
    names: input.names,
    offsetMs: simulationClockMs({ kind: row.kind as WebinarSession["kind"], scheduledAt: row.scheduled_at, startedAt: row.started_at }, input.nowMs),
    pendingMigration: input.pendingMigration,
    records: input.records.filter((record) => record.sessionId === simulation.sessionId),
    simulation
  });
}

/** Le as mudancas sem cair no aviso: sem a tabela (banco sem a 202611110002), nenhuma e `pending`. */
async function changesOrPending(db: ReturnType<typeof webinarsDb>, sessionIds: readonly string[]): Promise<{ pending: boolean; records: SimulationChangeRecord[] }> {
  try {
    return { pending: false, records: await listSimulationChanges(db, sessionIds) };
  } catch (error) {
    if (isMissingSimulation(error)) {
      return { pending: true, records: [] };
    }
    throw error;
  }
}

function isMissingSimulation(error: unknown) {
  return isPendingMigrationError(error) || isMissingWebinarSchema(error);
}

/**
 * [messaging.write] As regras das sessoes gravadas do webinario e, na Live ao vivo, da sessao da live (R7; nada da
 * semente, nunca o Replay); banco sem a 202610300003, o aviso.
 */
export async function loadSessionSimulations(input: { webinarId: string }): Promise<ActionResult<SessionSimulationsData>> {
  return runAdminAction("messaging.write", webinarIdSchema, input, async ({ input: data }) => {
    const db = webinarsDb();
    const webinar = await requireWebinarRow(db, data.webinarId);
    // A especie da sessao segue o tipo do webinario: a gravada no gravado, a da live no ao vivo (nunca o Replay).
    const sessionKind = webinar.kind === "live" ? "live" : "simulated";
    const sessions = (await listSessionRows(db, [webinar.id])).filter((row) => row.kind === sessionKind);
    try {
      const simulations = await listSessionSimulations(db, sessions.map((row) => row.id));
      // A vista do controle dos participantes simulados (D79) de cada sessao, com o nome de quem mudou.
      const changes = await changesOrPending(db, sessions.map((row) => row.id));
      const names = await loadSimulationChangeNames(db, changes.records);
      const nowMs = Date.now();
      const rows = new Map(sessions.map((row) => [row.id, row]));
      return {
        pendingMigration: false as const,
        simulations: simulations.map((simulation) => {
          const row = rows.get(simulation.sessionId);
          return viewOf(
            simulation,
            row?.simulation_decided_at ?? null,
            row ? audienceViewOf({ names, nowMs, pendingMigration: changes.pending, records: changes.records, row, simulation }) : undefined
          );
        })
      };
    } catch (error) {
      if (isMissingSimulation(error)) {
        return { migration: WEBINARS_OFFERS_MIGRATION, pendingMigration: true as const };
      }
      throw error;
    }
  });
}

/**
 * [messaging.publish] Grava a Simulacao de uma sessao gravada (ou da Live ao vivo, R7): o selo, as regras e a decisao
 * (D10). Com algo simulado ligado, a frase marcada precisa ser a que o servidor monta hoje com o nome de quem decide (a
 * da live na live; senao, erro no campo `acknowledged`); tudo desligado grava a frase de tudo desligado. As regras
 * gravadas sao as normalizadas (avisos ligados sem nenhum item contam como desligados): a frase confere com o que fica
 * no banco. Na live o selo nunca liga (erro no campo `showLiveBadge`).
 */
export async function saveSessionSimulation(input: SaveSessionSimulationInput): Promise<ActionResult<SavedSessionSimulation>> {
  return runAdminAction("messaging.publish", saveSessionSimulationSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const nowMs = now.getTime();
    const row = await fetchSessionRow(db, data.sessionId);

    if (!row) {
      throw new WebinarError(COPY.servidor.naoExiste, 404);
    }
    const live = row.kind === "live";
    if (row.kind === "replay") {
      throw new WebinarError(COPY.servidor.semReplay, 409);
    }
    if ((row.kind !== "simulated" && !live) || row.status === "cancelled") {
      throw new WebinarError(COPY.card.soLiveGravada, 409);
    }
    if (row.status === "ended") {
      throw new WebinarError(COPY.servidor.encerrada, 409);
    }
    // Com a sessao no ar (ou com a hora marcada ja passada: o zero da gravada e scheduled_at e o status pode atrasar
    // ate o tick), a regra nao muda: o resumo do fim recalcula com a regra gravada de 0 ao fim, e trocar no meio faria
    // o relatorio contar o que ninguem viu (ou nada do que viram) e apagaria a decisao que valia (§4.3, §8.6, D10). Na
    // live, o zero e o started_at (o "Começar para todos"): na espera ainda muda.
    if (simulationSessionStarted({ kind: row.kind as WebinarSession["kind"], scheduledAt: row.scheduled_at, startedAt: row.started_at, status: row.status as WebinarSession["status"] }, nowMs)) {
      throw new WebinarError(live ? COPY.servidor.liveComecou : COPY.servidor.comecou, 409);
    }
    if (live && data.showLiveBadge) {
      throw new WebinarFieldError("showLiveBadge", COPY.servidor.liveSemSelo);
    }
    // O card aberto antes de uma mudanca feita no console (ou noutra aba) nunca grava por cima dela (achado 6).
    const decidedNow = row.simulation_decided_at ?? null;
    if (data.expectedDecidedAt !== undefined && !sameDecision(decidedNow, data.expectedDecidedAt)) {
      throw new WebinarError(COPY.servidor.mudouEmOutroLugar, 409);
    }

    const webinar = await requireWebinarRow(db, row.webinar_id);
    const rules = normalizeSimulationRules({ countRule: data.countRule, joins: data.joins, saleNotices: data.saleNotices, showLiveBadge: data.showLiveBadge });
    const responsible = getUserDisplayName(user).fullName;
    const given = data.ackText?.trim() ?? "";
    const needsAck = simulationNeedsAck(rules);
    const matches = simulationAckMatches({ ackText: given, live, nowMs, responsible, rules });

    if (needsAck && (!data.acknowledged || !matches)) {
      throw new WebinarFieldError("acknowledged", COPY.servidor.fraseNaoBate);
    }

    const ackText = clampSimulationAck(matches ? given : simulationAckFor({ live, nowMs, responsible, rules }));
    let saved: SessionSimulation;
    try {
      saved = await saveSessionSimulationRows(db, {
        ackText,
        countRule: rules.countRule,
        decidedAt: now.toISOString(),
        decidedBy: user.id,
        // A decisao lida agora (o valor do banco, byte a byte): a escrita so passa se ninguem gravou no meio.
        expectedDecidedAt: data.expectedDecidedAt !== undefined ? decidedNow : undefined,
        joins: rules.joins,
        saleNotices: rules.saleNotices,
        sessionId: row.id,
        showLiveBadge: rules.showLiveBadge
      });
    } catch (error) {
      if (error instanceof SimulationChangedError) {
        throw new WebinarError(COPY.servidor.mudouEmOutroLugar, 409);
      }
      if (isMissingSimulation(error)) {
        throw new WebinarError(COPY.servidor.precisaMigracao(WEBINARS_OFFERS_MIGRATION), 409);
      }
      if (error instanceof LiveSimulationPendingError) {
        throw new WebinarError(COPY.servidor.precisaMigracaoLive(WEBINARS_SCREEN_MIGRATION), 409);
      }
      throw error;
    }

    const updated = await fetchSessionRow(db, row.id);
    if (!updated) {
      throw new WebinarError(COPY.servidor.naoExiste, 404);
    }

    const flags = simulationAckFlags(rules);
    await recordAudit(db, {
      action: "webinar.simulation_saved",
      actorId: user.id,
      count: rules.saleNotices.items.length,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: {
        acknowledged: data.acknowledged,
        count_base: rules.countRule.base,
        count_jitter: rules.countRule.jitter,
        count_mode: rules.countRule.mode,
        count_peak: rules.countRule.peak,
        decided_by: user.id,
        joins_enabled: rules.joins.enabled,
        joins_every_seconds: rules.joins.everySeconds,
        joins_max: rules.joins.max,
        numbers_simulated: flags.countSimulated || flags.joinsSimulated,
        sale_notices: rules.saleNotices.items.length,
        sale_notices_enabled: flags.saleNoticesSimulated,
        session_id: row.id,
        session_kind: row.kind,
        show_live_badge: rules.showLiveBadge
      }
    });
    revalidatePath(`${LIST_PATH}/${webinar.id}`);
    invalidateWebinars({ from: "action" });

    return { deciderName: responsible, session: sessionFromRow(updated), simulation: viewOf(saved, updated.simulation_decided_at ?? null) };
  });
}

/** "Real + 0": o contador ligado com o mesmo numero do "Só o real" (a sessao sem contador que ganha mudanca no ar). */
const REAL_PLUS_ZERO = { base: 0, jitter: 0, mode: "fixed", peak: 0 } as const;

/**
 * [messaging.publish] Os participantes simulados da sessao a partir de agora (D79): a gravada e a Live ao vivo, antes,
 * durante e depois do comeco, ate o Encerrar (encerrada, o Replay e a cancelada recusam com 409). Somar pede a caixa
 * com a frase da mudanca (a de hoje, com o numero novo e o nome de quem muda; senao, erro no campo `acknowledged`); o
 * Tirar (+0) grava a frase do +0 sem caixa. O mesmo numero de agora e recusado (nada mudaria). Antes do comeco a linha
 * fica sem offset e a regra da sessao passa a ser a nova (vale na hora: a espera da live nao tem relogio que ande); no
 * ar, a linha leva o offset do relogio da Simulacao e a sala sobe ou desce em 90 s. Depois, a decisao da sessao (quem,
 * quando, a frase), que muda o carimbo da sala. As entradas e os avisos de venda nao mudam aqui.
 */
export async function saveSimulatedAudience(input: SaveSimulatedAudienceInput): Promise<ActionResult<SavedSimulatedAudience>> {
  return runAdminAction("messaging.publish", saveSimulatedAudienceSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const nowMs = now.getTime();
    const row = await fetchSessionRow(db, data.sessionId);

    if (!row) {
      throw new WebinarError(COPY.servidor.naoExiste, 404);
    }
    const live = row.kind === "live";
    if (row.kind === "replay") {
      throw new WebinarError(COPY.servidor.semReplay, 409);
    }
    if ((row.kind !== "simulated" && !live) || row.status === "cancelled") {
      throw new WebinarError(COPY.card.soLiveGravada, 409);
    }
    if (row.status === "ended") {
      throw new WebinarError(COPY.servidor.plateiaEncerrada, 409);
    }

    let simulation: SessionSimulation | null;
    try {
      simulation = await fetchSessionSimulation(db, row.id);
    } catch (error) {
      if (isMissingSimulation(error)) {
        throw new WebinarError(COPY.servidor.precisaMigracao(WEBINARS_OFFERS_MIGRATION), 409);
      }
      throw error;
    }
    if (!simulation) {
      throw new WebinarError(COPY.servidor.naoExiste, 404);
    }
    // A tabela das mudancas antes de gravar qualquer coisa: sem ela, o aviso da 202611110002 e nada muda.
    let records: SimulationChangeRecord[];
    try {
      records = await listSimulationChanges(db, [row.id]);
    } catch (error) {
      if (isMissingSimulation(error)) {
        throw new WebinarError(COPY.servidor.precisaMigracaoPlateia(WEBINARS_AUDIENCE_MIGRATION), 409);
      }
      throw error;
    }
    if (records.length >= SIMULATION_LIMITS.countChangesMax) {
      throw new WebinarError(COPY.servidor.plateiaLimite(SIMULATION_LIMITS.countChangesMax), 409);
    }

    const session = sessionFromRow(row);
    const started = simulationSessionStarted(session, nowMs);
    const clockMs = simulationClockMs(session, nowMs);
    const rule = simulationAudienceRule(data.extra);
    if (simulationAudienceExtraOf(simulationAudienceRuleAt(simulation, started ? clockMs : Number.NaN)) === data.extra) {
      throw new WebinarFieldError("extra", COPY.servidor.plateiaIgual);
    }

    const flags = simulationAudienceFlagsOf({ joins: simulation.joins, saleNotices: simulation.saleNotices, showLiveBadge: row.show_live_badge === true });
    const responsible = getUserDisplayName(user).fullName;
    const given = data.ackText?.trim() ?? "";
    const matches = simulationAudienceAckMatches({ ackText: given, extra: data.extra, flags, live, nowMs, responsible });
    if (simulationAudienceNeedsAck(data.extra) && (!data.acknowledged || !matches)) {
      throw new WebinarFieldError("acknowledged", COPY.servidor.plateiaFraseNaoBate);
    }
    const ackText = clampSimulationAck(matches ? given : simulationAudienceAckFor({ extra: data.extra, flags, live, nowMs, responsible }));
    const atMs = started ? Math.max(0, Math.floor(clockMs)) : null;
    // Antes do comeco, a regra da sessao passa a ser a nova. No ar, a regra de antes do comeco nunca muda, menos o "Só o
    // real", que vira "Real + 0" (o mesmo numero) na primeira mudanca que soma: o resumo do fim e a janela da sala
    // reconhecem a sessao com contador.
    const countRule = !started ? rule : simulation.countRule.mode === "off" && rule.mode !== "off" ? { ...REAL_PLUS_ZERO } : undefined;

    let record: SimulationChangeRecord;
    try {
      record = await insertSimulationChange(db, { ackText, atMs, changedBy: user.id, rule, sessionId: row.id, source: data.source });
      await recordSimulationDecision(db, { ackText, countRule, decidedAt: now.toISOString(), decidedBy: user.id, sessionId: row.id });
    } catch (error) {
      if (isMissingSimulation(error)) {
        throw new WebinarError(COPY.servidor.precisaMigracaoPlateia(WEBINARS_AUDIENCE_MIGRATION), 409);
      }
      if (error instanceof LiveSimulationPendingError) {
        throw new WebinarError(COPY.servidor.precisaMigracaoLive(WEBINARS_SCREEN_MIGRATION), 409);
      }
      throw error;
    }

    const updated = await fetchSessionRow(db, row.id);
    if (!updated) {
      throw new WebinarError(COPY.servidor.naoExiste, 404);
    }

    await recordAudit(db, {
      action: "webinar.simulation_audience_changed",
      actorId: user.id,
      count: data.extra,
      entityId: row.webinar_id,
      entityType: "webinar",
      metadata: {
        acknowledged: data.acknowledged,
        at_offset_ms: atMs,
        before_start: !started,
        change_id: record.id,
        count_extra: data.extra,
        session_id: row.id,
        session_kind: row.kind,
        source: data.source
      }
    });
    revalidatePath(`${LIST_PATH}/${row.webinar_id}`);
    invalidateWebinars({ from: "action" });

    const all = [...records, record];
    const fresh = withCountChanges({ ...simulation, countRule: countRule ?? simulation.countRule }, all);
    const names = { ...(await loadSimulationChangeNames(db, records)), [user.id]: responsible };
    const audience = audienceViewOf({ names, nowMs, pendingMigration: false, records: all, row: updated, simulation: fresh });
    return { audience, deciderName: responsible, session: sessionFromRow(updated) };
  });
}
