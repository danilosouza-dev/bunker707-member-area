import "server-only";

// Envio das notificacoes do sino e atualizacao do segmento dos pop-ups (docs/22 §4.2 e §4.3; docs/04, Jobs).
//
// Notificacao: o aviso so e enviado reservado em `sending` (publicar agora reserva na propria acao; o
// job reserva as agendadas). O envio grava uma linha pequena por aluno (aviso + aluno + dedupe_key
// `campaign:<id>`) em lotes de 500, no maximo DISPATCH_ROWS_PER_RUN por vez: um envio cortado pelo
// orcamento do tick continua no proximo, sem duplicar (dedupe_key unico por aluno). Decisao registrada
// em docs/09 e docs/04: envio em massa de e-mail/push fica fora do tick; estas linhas do sino sao
// minusculas, em lote e retomaveis. Tres falhas seguidas cancelam o envio com o erro gravado.
//
// Aprovacao (docs/17 D4; docs/22 §2.3): o limite de 500 alunos e conferido ao publicar e de novo na hora
// do envio. Notificacao agendada sem aprovacao (approved_at vazio: publicada por quem nao tem
// messaging.publish_large) cujo segmento passou de 500 ate a hora de sair volta para "Aguardando
// aprovação" em vez de ser enviada; aprovada, sai na hora.
//
// Pop-up: enquanto esta no ar, o job recalcula a cada 15 minutos quem esta no segmento (elegivel) e
// quem saiu (deixa de ver). Impressoes, cliques e "Nao mostrar de novo" nunca sao apagados. O segmento
// do pop-up no ar pode crescer alem de 500 sem nova aprovacao (decisao em docs/22 §2.3); editar ou
// retomar o pop-up confere o limite de novo.
//
// "No primeiro acesso" (v3b-2, docs/29 §4.2): no mesmo recalculo, so quem conta como aluno novo (no segmento e
// candidato, popup-first-access.ts) fica elegivel, com a marca first_access_at; quem ja tinha a marca continua
// enquanto estiver no segmento (em "estes produtos", com acesso aberto a um deles). Linha elegivel sem marca e
// sem ser candidato (a de um app sem esta regra) sai. Nenhuma leitura nova: os fatos do tick e as linhas de hoje.

import { recordAudit } from "@/server/audit/log";
import { resolveAudienceUserIds } from "./audience";
import { loadAudienceFacts, type LoadedAudience } from "./audience-facts";
import { audienceFactsRequest, type AudienceDefinition } from "./audience-model";
import { APPROVAL_THRESHOLD } from "./campaign-model";
import { CommunicationError, describeError, isMissingCommunicationSchema, type CommunicationsDb } from "./db";
import { createFactsLoader, type FactsLoader } from "./facts-loader";
import { changeFlowState } from "./flow-store";
import { computeExpiresAt } from "./message-meta";
import { popupSettingsOfRow } from "./popup-display-model";
import { firstAccessDeliveryChanges, firstAccessSince, hasOpenAccessToAny, isFirstAccessCandidate } from "./popup-first-access";
import {
  audienceOfRow,
  claimDueInbox,
  countCampaignRecipients,
  fetchCampaignRecipientIds,
  fetchDeliveryEligibility,
  fetchFirstAccessDeliveries,
  fetchPopupsToRefresh,
  insertNotificationRows,
  markFirstAccessDeliveries,
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

export type DispatchResult = { recipients: number; status: "canceled" | "pending_approval" | "sending" | "sent" };

/** "Ate uma data" que ja passou ou fica a menos disto da hora do envio: nada sai (a linha nem caberia). */
const MIN_VALIDITY_LEFT_MS = 60 * 60 * 1000;
export const EXPIRED_BEFORE_DISPATCH_MESSAGE = "A notificação venceria antes de chegar.";

/**
 * Fatos dos alunos para o segmento do aviso, com as linhas dos avisos citados por regras "o que fez com
 * a notificacao X" (docs/23 §7) e, com a regra "Participação em lives", as lives de cada aluno.
 */
function loadDispatchFacts(db: CommunicationsDb, now: Date, definition: AudienceDefinition) {
  return loadAudienceFacts(db, now, audienceFactsRequest(definition));
}

/**
 * Aviso cancelado pelo envio (venceria antes de chegar, terceira falha): as seguintes nunca vao sair. O
 * fluxo do aviso termina (source_withdrawn, como "Retirar"), em vez de ficar "Ativo" para sempre sem ninguem
 * para entrar. Melhor esforco: o aviso ja esta cancelado; uma falha aqui so vai para o log.
 */
async function endNoticeFlow(db: CommunicationsDb, campaignId: string, now: Date) {
  try {
    const { data, error } = await db
      .from("communication_flows")
      .select("id")
      .eq("source_campaign_id", campaignId)
      .in("status", ["active", "paused"])
      .is("deleted_at", null);

    if (error) {
      throw error;
    }

    for (const { id } of (data ?? []) as { id: string }[]) {
      await changeFlowState(db, { actorId: null, expectedUpdatedAt: null, flowId: id, now, reason: "source_withdrawn", to: "ended" });
    }
  } catch (error) {
    if (!isMissingCommunicationSchema(error)) {
      console.error(`[comunicacao] seguintes do aviso cancelado ${campaignId} nao encerradas: ${describeError(error)}`);
    }
  }
}

/**
 * Envia uma notificacao ja reservada (status `sending`). Devolve a situacao no fim: `sent` (todos
 * gravados), `sending` (parou no meio: orcamento do tick, teto da rodada ou falha que sera tentada de
 * novo), `pending_approval` (sem aprovacao e o segmento passou de 500 desde que foi agendada) ou
 * `canceled` (terceira falha, ou "ate uma data" que venceria antes de chegar).
 *
 * Cada linha leva o proprio fim no sino (expires_at = computeExpiresAt do aviso, contado da chegada).
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
    if (campaign.valid_until && Date.parse(campaign.valid_until) <= now.getTime() + MIN_VALIDITY_LEFT_MS) {
      await updateCampaign(
        db,
        campaign.id,
        { dispatch_started_at: null, last_error: EXPIRED_BEFORE_DISPATCH_MESSAGE, status: "canceled" },
        { expectedStatuses: ["sending"] }
      );
      await endNoticeFlow(db, campaign.id, now);

      return { recipients: campaign.recipients_count ?? 0, status: "canceled" };
    }

    const loaded = (await input.loaded) ?? (await loadDispatchFacts(db, now, audienceOfRow(campaign)));
    const audienceIds = resolveAudienceUserIds(audienceOfRow(campaign), loaded);

    if (!campaign.approved_at && audienceIds.length > APPROVAL_THRESHOLD) {
      return await holdForApproval({ audienceCount: audienceIds.length, campaign, db, now });
    }

    // Envio retomado (tick cortado, falha anterior): so grava quem ainda nao recebeu.
    const already = await fetchCampaignRecipientIds(db, campaign.id);
    const pending = audienceIds.filter((userId) => !already.has(userId));
    const batch = pending.slice(0, DISPATCH_ROWS_PER_RUN);
    // Chegada = agora (o banco grava created_at na hora do insert; com o tempo simulado dos testes no
    // passado, o relogio real, para o fim nunca ficar antes de created_at).
    const expiresAt = new Date(
      computeExpiresAt({ validUntil: campaign.valid_until, validityMinutes: campaign.validity_minutes }, Math.max(now.getTime(), Date.now()))
    ).toISOString();

    await insertNotificationRows(
      db,
      batch.map((userId) => ({ campaign_id: campaign.id, dedupe_key: `campaign:${campaign.id}`, expires_at: expiresAt, kind: "notice", user_id: userId })),
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
        // Hora real em que passa a aparecer no sino (o lote acima pode levar segundos): o "Marcar todas"
        // do painel aberto antes disso nao mexe neste aviso (inbox.ts, asOf).
        sent_at: new Date().toISOString(),
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

    const recorded = await updateCampaign(
      db,
      campaign.id,
      { dispatch_attempts: attempts, dispatch_started_at: null, last_error: message, ...(giveUp ? { status: "canceled" as const } : {}) },
      { expectedStatuses: ["sending"] }
    ).then(
      () => true,
      (updateError: unknown) => {
        console.error(`[comunicacao] falha do envio ${campaign.id} nao gravada: ${describeError(updateError)}`);
        return false;
      }
    );

    if (giveUp && recorded) {
      await endNoticeFlow(db, campaign.id, now);
    }

    return { recipients: campaign.recipients_count ?? 0, status: giveUp ? "canceled" : "sending" };
  }
}

/**
 * Notificacao sem aprovacao que passou de 500 alunos ate a hora do envio: nada sai; volta para
 * "Aguardando aprovação" pedida em nome de quem publicou (updated_by), sem data (aprovada, sai na hora).
 */
async function holdForApproval(input: { audienceCount: number; campaign: CampaignRow; db: CommunicationsDb; now: Date }): Promise<DispatchResult> {
  const { campaign, db } = input;
  const nowIso = input.now.toISOString();

  await updateCampaign(
    db,
    campaign.id,
    {
      audience_count: input.audienceCount,
      audience_counted_at: nowIso,
      dispatch_started_at: null,
      requested_at: nowIso,
      requested_by: campaign.updated_by,
      send_at: null,
      status: "pending_approval"
    },
    { expectedStatuses: ["sending"] }
  );
  await recordAudit(db, {
    action: "communication.approval_requested",
    actorId: campaign.updated_by,
    count: input.audienceCount,
    entityId: campaign.id,
    entityType: "campaign",
    metadata: { kind: campaign.kind, reason: "grew_after_schedule" }
  });

  return { recipients: campaign.recipients_count ?? 0, status: "pending_approval" };
}

/**
 * Recalcula quem ve o pop-up: quem entrou no segmento passa a elegivel (linha nova ou reativada), quem
 * saiu deixa de ser elegivel. Grava a contagem e a hora do recalculo no aviso, so se o aviso nao foi
 * editado no meio (senao a hora fica vazia e o job do minuto seguinte refaz com o segmento atual).
 * "No primeiro acesso" (v3b-2): so os alunos novos do segmento, com a marca (firstAccessDeliveryChanges).
 */
export async function refreshPopupDeliveries(input: {
  campaign: CampaignRow;
  db: CommunicationsDb;
  /** Carregador do tick (facts-loader.ts): le as linhas dos avisos citados pelo segmento uma vez por tick. */
  facts?: FactsLoader;
  loaded?: LoadedInput;
  now?: Date;
}): Promise<{ added: number; audienceCount: number; removed: number }> {
  const { campaign, db } = input;
  const now = input.now ?? new Date();
  const audience = audienceOfRow(campaign);
  // Regras "o que fez com a notificacao X" do segmento: as linhas de X entram nos fatos (docs/23 §7); com a regra
  // "Participação em lives", as lives de cada aluno (uma leitura por tick no carregador).
  const request = audienceFactsRequest(audience);
  const loaded =
    (await input.loaded) ?? (input.facts ? await input.facts.load(request.messageCampaignIds, request) : await loadAudienceFacts(db, now, request));
  const matching = new Set(resolveAudienceUserIds(audience, loaded));
  const settings = popupSettingsOfRow(campaign);
  let changes: { added: number; audienceCount: number; removed: number };

  if (settings.trigger === "first_login") {
    const since = firstAccessSince(campaign);
    const products = settings.accessProducts ?? [];
    const inSegment = loaded.facts.filter((facts) => matching.has(facts.userId));
    const candidates = new Set(inSegment.filter((facts) => isFirstAccessCandidate(facts, products, since)).map((facts) => facts.userId));
    const withAccess = products.length === 0 ? null : new Set(inSegment.filter((facts) => hasOpenAccessToAny(facts, products)).map((facts) => facts.userId));
    // A mesma leitura paginada de fetchDeliveryEligibility, com first_access_at: nenhuma ida a mais.
    const current = await fetchFirstAccessDeliveries(db, campaign.id);
    const { audienceCount, toDisable, toMark } = firstAccessDeliveryChanges({ audience: matching, candidates, current, withAccess });

    await markFirstAccessDeliveries(db, campaign.id, toMark, now.toISOString());
    await setDeliveryEligibility(db, campaign.id, toDisable, false);
    changes = { added: toMark.length, audienceCount, removed: toDisable.length };
  } else {
    // Os outros momentos: como antes (a marca do primeiro acesso, se houver, fica como estiver).
    const current = await fetchDeliveryEligibility(db, campaign.id);
    const toEnable = Array.from(matching).filter((userId) => current.get(userId) !== true);
    const toDisable = Array.from(current).filter(([userId, eligible]) => eligible && !matching.has(userId)).map(([userId]) => userId);

    await upsertDeliveries(db, campaign.id, toEnable);
    await setDeliveryEligibility(db, campaign.id, toDisable, false);
    changes = { added: toEnable.length, audienceCount: matching.size, removed: toDisable.length };
  }

  try {
    // updated_at so muda com edicao da equipe (o gatilho ignora a contagem e a hora do recalculo).
    await updateCampaign(
      db,
      campaign.id,
      { audience_count: changes.audienceCount, audience_counted_at: now.toISOString(), audience_refreshed_at: now.toISOString() },
      { expectedStatuses: [campaign.status], expectedUpdatedAt: campaign.updated_at }
    );
  } catch (error) {
    console.error(`[comunicacao] contagem do pop-up ${campaign.id} nao gravada: ${describeError(error)}`);

    if (error instanceof CommunicationError && error.status === 409) {
      // Editado (ou pausado) no meio: a lista acima pode ser do segmento antigo. Sem a hora do
      // recalculo, o job do minuto seguinte refaz com o que esta gravado agora.
      await updateCampaign(db, campaign.id, { audience_refreshed_at: null }).catch((clearError: unknown) =>
        console.error(`[comunicacao] recalculo do pop-up ${campaign.id} nao reaberto: ${describeError(clearError)}`)
      );
    }
  }

  return changes;
}

export type ProcessCommunicationsResult = {
  /** Notificacoes que passaram de 500 alunos sem aprovacao e voltaram para "Aguardando aprovação". */
  awaitingApproval: number;
  dispatched: number;
  failed: number;
  pendingMigration: boolean;
  refreshed: number;
  sending: number;
};

/**
 * Trabalho do job "comunicacao" no tick de minuto: (1) envia ate 3 notificacoes vencidas; (2) recalcula
 * ate 5 pop-ups no ar cujo segmento venceu (faixas de 15 minutos). Os fatos dos alunos sao lidos uma
 * vez por rodada e so se houver trabalho, pelo carregador do tick (`facts`, dividido com a fase dos fluxos;
 * sem ele, um proprio): cada envio e cada pop-up pedem as linhas dos avisos citados pelo proprio segmento.
 * Banco vazio ou sem a migracao: registra e volta sem erro. Recalculo que falha marca a hora mesmo assim:
 * tenta de novo na faixa seguinte, nao a cada minuto.
 */
export async function processCommunications(input: {
  db: CommunicationsDb;
  facts?: FactsLoader;
  now?: Date;
  signal?: AbortSignal;
}): Promise<ProcessCommunicationsResult> {
  const { db, signal } = input;
  const now = input.now ?? new Date();
  const result: ProcessCommunicationsResult = { awaitingApproval: 0, dispatched: 0, failed: 0, pendingMigration: false, refreshed: 0, sending: 0 };
  // Rejeicao guardada no carregador: falha de leitura dos fatos nunca vira rejeicao solta.
  const facts = input.facts ?? createFactsLoader(db, now);
  const loadedFor = (campaign: CampaignRow) => {
    const request = audienceFactsRequest(audienceOfRow(campaign));

    return facts.load(request.messageCampaignIds, request);
  };

  try {
    const claimed = await claimDueInbox(db, now, INBOX_PER_TICK);

    for (const campaign of claimed) {
      if (signal?.aborted) {
        break;
      }

      const outcome = await dispatchInboxCampaign({ campaign, db, loaded: loadedFor(campaign), now, signal });

      if (outcome.status === "sent") {
        result.dispatched += 1;
      } else if (outcome.status === "sending") {
        result.sending += 1;
      } else if (outcome.status === "pending_approval") {
        result.awaitingApproval += 1;
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
        await refreshPopupDeliveries({ campaign, db, loaded: loadedFor(campaign), now });
        result.refreshed += 1;
      } catch (error) {
        if (isMissingCommunicationSchema(error)) {
          throw error;
        }

        result.failed += 1;
        console.error(`[comunicacao] pop-up ${campaign.id} nao recalculado: ${describeError(error)}`);
        // Grava so a hora do recalculo (o gatilho nao a conta como edicao, entao quem esta com o editor
        // aberto nao recebe 409; last_error contaria): a proxima tentativa fica para a faixa seguinte.
        await updateCampaign(db, campaign.id, { audience_refreshed_at: now.toISOString() }, { expectedStatuses: [campaign.status] }).catch(
          () => undefined
        );
      }
    }
  } catch (error) {
    if (isMissingCommunicationSchema(error)) {
      result.pendingMigration = true;
      console.error("[comunicacao] tabelas da Comunicacao ausentes (migracao 202610200001 pendente ou 202610200002 pendente); nada a fazer.");
      return result;
    }

    throw error;
  }

  return result;
}
