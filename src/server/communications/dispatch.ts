import "server-only";

// Envio das notificacoes do sino e atualizacao do segmento dos pop-ups (docs/22 §5; docs/04, Jobs).
//
// Notificacao: o aviso so e enviado reservado em `sending` (publicar agora reserva na propria acao; o
// job reserva as agendadas). O envio grava uma linha pequena por aluno (aviso + aluno + dedupe_key
// `campaign:<id>`) em lotes de 500, no maximo DISPATCH_ROWS_PER_RUN por vez: um envio cortado pelo
// orcamento do tick continua no proximo, sem duplicar (dedupe_key unico por aluno). Decisao registrada
// em docs/09 e docs/04: envio em massa de e-mail/push fica fora do tick; estas linhas do sino sao
// minusculas, em lote e retomaveis. Tres falhas seguidas cancelam o envio com o erro gravado.
//
// Pop-up: enquanto esta no ar, o job recalcula a cada 15 minutos quem esta no segmento (elegivel) e
// quem saiu (deixa de ver). Impressoes, cliques e "Nao mostrar de novo" nunca sao apagados.

import { resolveAudienceUserIds } from "./audience";
import { loadAudienceFacts, type LoadedAudience } from "./audience-facts";
import { describeError, isMissingCommunicationSchema, type CommunicationsDb } from "./db";
import {
  audienceOfRow,
  claimDueInbox,
  countCampaignRecipients,
  fetchCampaignRecipientIds,
  fetchDeliveryEligibility,
  fetchPopupsToRefresh,
  insertNotificationRows,
  setDeliveryEligibility,
  updateCampaign,
  upsertDeliveries,
  type CampaignRow
} from "./store";

export const DISPATCH_ROWS_PER_RUN = 20_000;
export const MAX_DISPATCH_ATTEMPTS = 3;
export const INBOX_PER_TICK = 3;
export const POPUPS_PER_TICK = 5;
export const POPUP_REFRESH_EVERY_MS = 15 * 60 * 1000;

type LoadedInput = LoadedAudience | Promise<LoadedAudience> | undefined;

export type DispatchResult = { recipients: number; status: "canceled" | "sending" | "sent" };

/**
 * Envia uma notificacao ja reservada (status `sending`). Devolve a situacao no fim: `sent` (todos
 * gravados), `sending` (parou no meio: orcamento do tick, teto da rodada ou falha que sera tentada de
 * novo) ou `canceled` (terceira falha).
 */
export async function dispatchInboxCampaign(input: {
  campaign: CampaignRow;
  db: CommunicationsDb;
  loaded?: LoadedInput;
  now?: Date;
  signal?: AbortSignal;
}): Promise<DispatchResult> {
  const { campaign, db } = input;
  const now = input.now ?? new Date();

  if (campaign.kind !== "inbox" || campaign.status !== "sending") {
    throw new Error(`Comunicacao: aviso ${campaign.id} nao esta reservado para envio.`);
  }

  try {
    const loaded = (await input.loaded) ?? (await loadAudienceFacts(db, now));
    const audienceIds = resolveAudienceUserIds(audienceOfRow(campaign), loaded);
    // Envio retomado (tick cortado, falha anterior): so grava quem ainda nao recebeu.
    const already = await fetchCampaignRecipientIds(db, campaign.id);
    const pending = audienceIds.filter((userId) => !already.has(userId));
    const batch = pending.slice(0, DISPATCH_ROWS_PER_RUN);

    await insertNotificationRows(
      db,
      batch.map((userId) => ({ campaign_id: campaign.id, dedupe_key: `campaign:${campaign.id}`, kind: "notice", user_id: userId })),
      input.signal
    );

    const recipients = await countCampaignRecipients(db, campaign.id);
    const finished = pending.length <= DISPATCH_ROWS_PER_RUN && !input.signal?.aborted && recipients >= already.size + batch.length;

    if (!finished) {
      // Libera a reserva: o proximo tick retoma de onde parou (sem esperar a reserva vencer).
      await updateCampaign(
        db,
        campaign.id,
        { audience_count: audienceIds.length, audience_counted_at: now.toISOString(), dispatch_started_at: null, recipients_count: recipients },
        { expectedStatuses: ["sending"] }
      ).catch((error: unknown) => console.error(`[comunicacao] envio ${campaign.id} nao liberado: ${describeError(error)}`));

      return { recipients, status: "sending" };
    }

    await updateCampaign(
      db,
      campaign.id,
      {
        audience_count: audienceIds.length,
        audience_counted_at: now.toISOString(),
        last_error: null,
        recipients_count: recipients,
        send_at: campaign.send_at ?? now.toISOString(),
        sent_at: now.toISOString(),
        status: "sent"
      },
      { expectedStatuses: ["sending"] }
    );

    return { recipients, status: "sent" };
  } catch (error) {
    const attempts = campaign.dispatch_attempts + 1;
    const giveUp = attempts >= MAX_DISPATCH_ATTEMPTS;
    const message = describeError(error);

    console.error(`[comunicacao] envio do aviso ${campaign.id} falhou (tentativa ${attempts}): ${message}`);

    await updateCampaign(
      db,
      campaign.id,
      { dispatch_attempts: attempts, dispatch_started_at: null, last_error: message, ...(giveUp ? { status: "canceled" as const } : {}) },
      { expectedStatuses: ["sending"] }
    ).catch((updateError: unknown) => console.error(`[comunicacao] falha do envio ${campaign.id} nao gravada: ${describeError(updateError)}`));

    return { recipients: campaign.recipients_count ?? 0, status: giveUp ? "canceled" : "sending" };
  }
}

/**
 * Recalcula quem ve o pop-up: quem entrou no segmento passa a elegivel (linha nova ou reativada), quem
 * saiu deixa de ser elegivel. Grava a contagem e a hora do recalculo no aviso.
 */
export async function refreshPopupDeliveries(input: {
  campaign: CampaignRow;
  db: CommunicationsDb;
  loaded?: LoadedInput;
  now?: Date;
}): Promise<{ added: number; audienceCount: number; removed: number }> {
  const { campaign, db } = input;
  const now = input.now ?? new Date();
  const loaded = (await input.loaded) ?? (await loadAudienceFacts(db, now));
  const matching = new Set(resolveAudienceUserIds(audienceOfRow(campaign), loaded));
  const current = await fetchDeliveryEligibility(db, campaign.id);
  const toEnable = Array.from(matching).filter((userId) => current.get(userId) !== true);
  const toDisable = Array.from(current).filter(([userId, eligible]) => eligible && !matching.has(userId)).map(([userId]) => userId);

  await upsertDeliveries(db, campaign.id, toEnable);
  await setDeliveryEligibility(db, campaign.id, toDisable, false);
  await updateCampaign(
    db,
    campaign.id,
    { audience_count: matching.size, audience_counted_at: now.toISOString(), audience_refreshed_at: now.toISOString() },
    { expectedStatuses: [campaign.status] }
  ).catch((error: unknown) => {
    // O aviso mudou no meio (pausado, encerrado, editado): o proximo recalculo acerta a contagem.
    console.error(`[comunicacao] contagem do pop-up ${campaign.id} nao gravada: ${describeError(error)}`);
  });

  return { added: toEnable.length, audienceCount: matching.size, removed: toDisable.length };
}

export type ProcessCommunicationsResult = {
  dispatched: number;
  failed: number;
  pendingMigration: boolean;
  refreshed: number;
  sending: number;
};

/**
 * Trabalho do job "comunicacao" no tick de minuto: (1) envia ate 3 notificacoes vencidas; (2) recalcula
 * ate 5 pop-ups no ar com segmento de mais de 15 minutos. Os fatos dos alunos sao lidos uma vez por
 * rodada e so se houver trabalho. Banco vazio ou sem a migracao: registra e volta sem erro.
 */
export async function processCommunications(input: { db: CommunicationsDb; now?: Date; signal?: AbortSignal }): Promise<ProcessCommunicationsResult> {
  const { db, signal } = input;
  const now = input.now ?? new Date();
  const result: ProcessCommunicationsResult = { dispatched: 0, failed: 0, pendingMigration: false, refreshed: 0, sending: 0 };
  let loadedPromise: Promise<LoadedAudience> | null = null;
  const loaded = () => (loadedPromise ??= loadAudienceFacts(db, now));

  // Sem tratamento aqui, uma falha de leitura dos fatos viraria rejeicao solta quando ninguem a espera.
  const guarded = () => {
    const promise = loaded();
    promise.catch(() => undefined);
    return promise;
  };

  try {
    const claimed = await claimDueInbox(db, now, INBOX_PER_TICK);

    for (const campaign of claimed) {
      if (signal?.aborted) {
        break;
      }

      const outcome = await dispatchInboxCampaign({ campaign, db, loaded: guarded(), now, signal });

      if (outcome.status === "sent") {
        result.dispatched += 1;
      } else if (outcome.status === "sending") {
        result.sending += 1;
      } else {
        result.failed += 1;
      }
    }

    if (signal?.aborted) {
      return result;
    }

    const popups = await fetchPopupsToRefresh(db, now, POPUP_REFRESH_EVERY_MS, POPUPS_PER_TICK);

    for (const campaign of popups) {
      if (signal?.aborted) {
        break;
      }

      try {
        await refreshPopupDeliveries({ campaign, db, loaded: guarded(), now });
        result.refreshed += 1;
      } catch (error) {
        if (isMissingCommunicationSchema(error)) {
          throw error;
        }

        result.failed += 1;
        console.error(`[comunicacao] pop-up ${campaign.id} nao recalculado: ${describeError(error)}`);
      }
    }
  } catch (error) {
    if (isMissingCommunicationSchema(error)) {
      result.pendingMigration = true;
      console.error("[comunicacao] tabelas da Comunicacao ausentes (migracao 202610200001 pendente); nada a fazer.");
      return result;
    }

    throw error;
  }

  return result;
}
