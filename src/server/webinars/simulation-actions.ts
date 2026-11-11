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

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { runWebinarAction } from "./run-webinar-action";
import { recordAudit } from "@/server/audit/log";
import { getUserDisplayName } from "@/server/auth/session";
import { isPendingMigrationError } from "@/server/db/pending-migration";
import { invalidateWebinars } from "./cache";
import { WEBINARS_OFFERS_MIGRATION, WEBINARS_SCREEN_MIGRATION, WebinarError, WebinarFieldError, isMissingWebinarSchema, webinarsDb } from "./db";
import type { SessionSimulation, WebinarSession } from "./model";
import { sessionFromRow } from "./rows";
import { clampSimulationAck, normalizeSimulationRules, simulationAckFlags, simulationAckFor, simulationAckMatches, simulationSessionStarted } from "./simulation-model";
import { SIMULATION_MESSAGES, saveSessionSimulationSchema, simulationNeedsAck } from "./simulation-schemas";
import { LiveSimulationPendingError, listSessionSimulations, saveSessionSimulationRows } from "./simulation-store";
import { fetchSessionRow, listSessionRows, requireWebinarRow } from "./store";

const LIST_PATH = "/admin/comunicacao/webinarios";
const COPY = WEBINAR_COPY.simulacao;

const webinarIdSchema = z.object({ webinarId: z.uuid({ error: SIMULATION_MESSAGES.invalid }) });

/** As regras de uma sessao como o card recebe (sem a semente: so o servidor calcula com ela). */
export type SessionSimulationView = Omit<SessionSimulation, "seed">;

export type SessionSimulationsData = { migration: string; pendingMigration: true } | { pendingMigration: false; simulations: SessionSimulationView[] };

export type SavedSessionSimulation = { deciderName: string; session: WebinarSession; simulation: SessionSimulationView };

export type SaveSessionSimulationInput = z.input<typeof saveSessionSimulationSchema>;

function viewOf(simulation: SessionSimulation): SessionSimulationView {
  return { countRule: simulation.countRule, joins: simulation.joins, saleNotices: simulation.saleNotices, sessionId: simulation.sessionId, summary: simulation.summary };
}

function isMissingSimulation(error: unknown) {
  return isPendingMigrationError(error) || isMissingWebinarSchema(error);
}

/**
 * [messaging.write] As regras das sessoes gravadas do webinario e, na Live ao vivo, da sessao da live (R7; nada da
 * semente, nunca o Replay); banco sem a 202610300003, o aviso.
 */
export async function loadSessionSimulations(input: { webinarId: string }): Promise<ActionResult<SessionSimulationsData>> {
  return runWebinarAction("messaging.write", "leitura", webinarIdSchema, input, async ({ input: data }) => {
    const db = webinarsDb();
    const webinar = await requireWebinarRow(db, data.webinarId);
    // A especie da sessao segue o tipo do webinario: a gravada no gravado, a da live no ao vivo (nunca o Replay).
    const sessionKind = webinar.kind === "live" ? "live" : "simulated";
    const sessions = (await listSessionRows(db, [webinar.id])).filter((row) => row.kind === sessionKind);
    try {
      const simulations = await listSessionSimulations(db, sessions.map((row) => row.id));
      return { pendingMigration: false as const, simulations: simulations.map(viewOf) };
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
  return runWebinarAction("messaging.publish", "conteudo", saveSessionSimulationSchema, input, async ({ input: data, user }) => {
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
        joins: rules.joins,
        saleNotices: rules.saleNotices,
        sessionId: row.id,
        showLiveBadge: rules.showLiveBadge
      });
    } catch (error) {
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

    return { deciderName: responsible, session: sessionFromRow(updated), simulation: viewOf(saved) };
  });
}
