"use server";

// Server Actions do "Comeca quando voce entra" no card Sessoes do editor (fase 4e; docs/30 §1.6, §2.2, §2.6, §8.6, A14,
// D10 e D25): ler as regras e as sessoes que nasceram hoje (loadJitSettings, messaging.write) e gravar as regras de
// uma vez (saveJitSettings): ligar, a cada 15 / 30 / 60 min, a janela de horas de Sao Paulo, a Entrada atrasada e a
// Simulacao que cada sessao copia ao nascer. Regras:
// - messaging.write; com algo simulado ligado (o selo, o contador, as entradas ou os avisos de venda), messaging.publish
//   tambem (403 sem ela), como o card Simulacao;
// - so a Live gravada nao cancelada (409); ligar pede o video base (erro no campo `settings.enabled`);
// - a decisao da Simulacao (D10): com algo simulado ligado, a caixa marcada e a frase de §8.6 de hoje (ou de ontem,
//   para a tela aberta antes da meia-noite) com o nome de quem decide, conferidas no servidor; quem decidiu e quando
//   sao do servidor. As mesmas regras ja decididas, com a frase gravada de volta, guardam a decisao como estava (mudar so
//   a janela nao vira outra decisao). Tudo desligado grava a Simulacao vazia (nada simulado nas sessoes que nascem);
// - a auditoria leva os valores (numeros e booleanos; dos avisos de venda, so a contagem), nunca a frase nem textos;
// - a resposta leva a versao nova do webinario (updated_at muda com jit_settings): o editor segue com ela e o proximo
//   Salvar do rascunho nao vira "mudou em outra tela";
// - banco sem a 202610290008 (WEBINARS_JIT_MIGRATION): 409 com a frase da migracao, nunca o erro cru.
// As sessoes que ja nasceram nao mudam: cada uma guardou a decisao que valia quando nasceu.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { runAdminAction } from "@/server/actions/run-action";
import { recordAudit } from "@/server/audit/log";
import { requireRole } from "@/server/auth/permissions";
import { getUserDisplayName } from "@/server/auth/session";
import { invalidateWebinars } from "./cache";
import { isPendingMigrationError } from "@/server/db/pending-migration";
import { WEBINARS_JIT_MIGRATION, WebinarError, WebinarFieldError, isMissingWebinarSchema, webinarsDb } from "./db";
import { jitBaseRecording, loadJitEditorData, type JitSessionSummary } from "./jit-queries";
import { JIT_MESSAGES, saveJitSettingsSchema } from "./jit-schemas";
import { fetchJitSettings, saveJitSettings as saveJitSettingsRow } from "./jit-store";
import { defaultJitSettings, type JitSettings, type JitSimulationTemplate } from "./model";
import { webinarFromRow } from "./rows";
import { clampSimulationAck, normalizeSimulationAck, normalizeSimulationRules, simulationAckFlags, simulationAckMatches, type SimulationRules } from "./simulation-model";
import { simulationNeedsAck } from "./simulation-schemas";
import { listRecordingRows, requireWebinarRow } from "./store";

const LIST_PATH = "/admin/comunicacao/webinarios";
const COPY = WEBINAR_COPY.jit;

const webinarIdSchema = z.object({ webinarId: z.uuid({ error: JIT_MESSAGES.invalid }) });

export type SaveJitSettingsInput = z.input<typeof saveJitSettingsSchema>;

/**
 * O que o card recebe: as regras, as sessoes de hoje, a versao do webinario (updated_at) e, quando esta gravacao decidiu
 * a Simulacao, o nome de quem decidiu.
 */
export type JitSettingsData = { deciderName: string | null; sessionsToday: JitSessionSummary[]; settings: JitSettings; updatedAt: string };

const rulesKey = (rules: SimulationRules) => JSON.stringify(normalizeSimulationRules(rules));

/** O banco sem a 202610290008 vira a frase da migracao (409); o resto segue como veio. */
async function withJitSchema<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isPendingMigrationError(error) || isMissingWebinarSchema(error)) {
      throw new WebinarError(COPY.servidor.precisaMigracao(WEBINARS_JIT_MIGRATION), 409);
    }
    throw error;
  }
}

function rulesOf(template: Pick<JitSimulationTemplate, "countRule" | "joins" | "saleNotices" | "showLiveBadge">): SimulationRules {
  return normalizeSimulationRules({ countRule: template.countRule, joins: template.joins, saleNotices: template.saleNotices, showLiveBadge: template.showLiveBadge });
}

/** [messaging.write] As regras do "Comeca quando voce entra" e as sessoes que nasceram hoje (dia de Sao Paulo). */
export async function loadJitSettings(input: { webinarId: string }): Promise<ActionResult<JitSettingsData>> {
  return runAdminAction("messaging.write", webinarIdSchema, input, async ({ input: data }) =>
    withJitSchema(async () => {
      const db = webinarsDb();
      const row = await requireWebinarRow(db, data.webinarId);
      const loaded = await loadJitEditorData(db, data.webinarId, Date.now());
      return { deciderName: null, sessionsToday: loaded?.sessionsToday ?? [], settings: loaded?.settings ?? defaultJitSettings(), updatedAt: row.updated_at };
    })
  );
}

/**
 * [messaging.write; com algo simulado ligado, messaging.publish] Grava as regras do "Comeca quando voce entra" (as
 * sessoes que nascerem depois copiam). Ver o comeco do arquivo.
 */
export async function saveJitSettings(input: SaveJitSettingsInput): Promise<ActionResult<JitSettingsData>> {
  return runAdminAction("messaging.write", saveJitSettingsSchema, input, async ({ input: data, user }) => withJitSchema(async () => {
    const db = webinarsDb();
    const now = new Date();
    const nowMs = now.getTime();
    const webinar = webinarFromRow(await requireWebinarRow(db, data.webinarId));

    if (webinar.kind !== "simulated") {
      throw new WebinarError(COPY.servidor.soLiveGravada, 409);
    }

    if (webinar.cancelledAt) {
      throw new WebinarError(COPY.servidor.cancelado, 409);
    }

    const wanted = data.settings;
    const rules = wanted.simulation ? rulesOf(wanted.simulation) : null;
    const simulated = rules !== null && simulationNeedsAck(rules);

    if (simulated) {
      // O selo e os numeros simulados sao decisao de quem publica (D10), como no card Simulacao.
      await requireRole("messaging.publish");
    }

    if (wanted.enabled && !jitBaseRecording(await listRecordingRows(db, [webinar.id]))) {
      throw new WebinarFieldError("settings.enabled", COPY.card.semVideo);
    }

    const current = (await fetchJitSettings(db, webinar.id)) ?? defaultJitSettings();
    let simulation: JitSimulationTemplate | null = null;
    let decided = false;
    let deciderName: string | null = null;

    if (rules && simulated && wanted.simulation) {
      const saved = current.simulation;
      const given = wanted.simulation.ackText?.trim() ?? "";
      const keeps =
        saved !== null &&
        saved.decidedAt !== null &&
        saved.ackText !== null &&
        rulesKey(rulesOf(saved)) === rulesKey(rules) &&
        given !== "" &&
        normalizeSimulationAck(given) === normalizeSimulationAck(saved.ackText);

      if (keeps) {
        simulation = saved;
      } else {
        const responsible = getUserDisplayName(user).fullName;

        if (!wanted.simulation.acknowledged || !simulationAckMatches({ ackText: given, nowMs, responsible, rules })) {
          throw new WebinarFieldError("settings.simulation.acknowledged", WEBINAR_COPY.simulacao.servidor.fraseNaoBate);
        }

        simulation = { ...rules, ackText: clampSimulationAck(given), decidedAt: now.toISOString(), decidedBy: user.id };
        decided = true;
        deciderName = responsible;
      }
    }

    const settings = await saveJitSettingsRow(db, {
      settings: {
        enabled: wanted.enabled,
        endHour: wanted.endHour,
        everyMinutes: wanted.everyMinutes,
        lateJoinMinutes: wanted.lateJoinMinutes,
        simulation,
        startHour: wanted.startHour
      },
      webinarId: webinar.id
    });
    const flags = simulation ? simulationAckFlags(rulesOf(simulation)) : null;

    await recordAudit(db, {
      action: "webinar.jit_saved",
      actorId: user.id,
      count: simulation?.saleNotices.items.length ?? 0,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: {
        count_base: simulation?.countRule.base ?? 0,
        count_jitter: simulation?.countRule.jitter ?? 0,
        count_mode: simulation?.countRule.mode ?? "off",
        count_peak: simulation?.countRule.peak ?? 0,
        decided,
        decided_by: simulation?.decidedBy ?? null,
        enabled: settings.enabled,
        end_hour: settings.endHour,
        every_minutes: settings.everyMinutes,
        joins_enabled: simulation?.joins.enabled ?? false,
        joins_every_seconds: simulation?.joins.everySeconds ?? null,
        joins_max: simulation?.joins.max ?? null,
        late_join_minutes: settings.lateJoinMinutes,
        numbers_simulated: flags ? flags.countSimulated || flags.joinsSimulated : false,
        sale_notices: simulation?.saleNotices.items.length ?? 0,
        sale_notices_enabled: flags?.saleNoticesSimulated ?? false,
        show_live_badge: simulation?.showLiveBadge ?? false,
        start_hour: settings.startHour,
        was_enabled: current.enabled
      }
    });
    revalidatePath(`${LIST_PATH}/${webinar.id}`);
    invalidateWebinars({ from: "action" });

    const [loaded, after] = await Promise.all([loadJitEditorData(db, webinar.id, nowMs), requireWebinarRow(db, webinar.id)]);

    return { deciderName, sessionsToday: loaded?.sessionsToday ?? [], settings, updatedAt: after.updated_at };
  }));
}
