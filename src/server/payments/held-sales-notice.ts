import "server-only";

// O e-mail da equipe quando uma venda fica guardada (docs/32 §2.2 e §11.3, "Avisos por e-mail"): para os donos e os
// administradores (os mesmos dos e-mails de degrau, src/server/licensing/degree-email.ts), pela fila email_outbox, um por
// episodio. O episodio e o degrau que barra o acesso novo e o dia em que ele comecou (heldSalesEpisodeOf); a chave da fila
// (`held-sales:<episodio>:<pessoa>`) garante um e-mail por pessoa por episodio mesmo com vendas ao mesmo tempo, processos
// diferentes ou o processo que reinicia. A memoria do processo so evita tocar na fila a cada venda e a cada minuto.
//
// Chamado por process-sale.ts quando uma venda passa a ficar guardada e pela tarefa do tick enquanto houver venda
// guardada com a licenca barrando (a segunda chance, se a fila falhou na hora). Nunca lanca para quem chama: a venda
// guardada e o que importa; a falha vai para o log.

import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueEmail } from "@/server/email/outbox";
import { idempotencyKeyOf } from "@/server/email/outbox-rules";
import { renderHeldSalesEmail } from "@/server/email/templates/held-sales";
import { listLicenseManagers } from "@/server/licensing/degree-email";
import { licenseScreenUrlOf } from "@/server/licensing/degree-notice";
import type { LicenseState } from "@/server/licensing/state";
import { heldSaleReasonLabel, heldSalesEpisodeOf } from "./held-sales-model";

/** O tipo do e-mail na fila (outbox-rules.EMAIL_KINDS). */
export const HELD_SALES_EMAIL_KIND = "held_sales";

/** O episodio ja avisado neste processo. */
const memory: { lastEpisode: string | null } = { lastEpisode: null };

export type HeldSalesNoticeResult = { episode: string; queued: number; skipped: "ja_avisado" | null };

/**
 * Enfileira o e-mail do episodio para cada dono e administrador, se este processo ainda nao o fez. A memoria so anda
 * depois de enfileirar para todos: a falha no meio deixa a proxima venda (ou a rodada do tick) tentar de novo, e a
 * chave da fila segura quem ja recebeu.
 */
export async function notifyHeldSalesEpisode(
  db: SupabaseClient,
  input: { configuredHost: string | null; now: Date; reason: string; state: LicenseState | null },
  notices: { lastEpisode: string | null } = memory
): Promise<HeldSalesNoticeResult> {
  const episode = heldSalesEpisodeOf(input.state, input.now).marker;

  if (notices.lastEpisode === episode) {
    return { episode, queued: 0, skipped: "ja_avisado" };
  }

  const screenUrl = licenseScreenUrlOf(input.configuredHost);
  const email = renderHeldSalesEmail({ licenseScreenUrl: screenUrl ? `${screenUrl}#vendas-guardadas` : null, reasonLabel: heldSaleReasonLabel(input.reason) });
  const recipients = await listLicenseManagers(db);
  const seen = new Set<string>();
  let queued = 0;

  for (const recipient of recipients) {
    const to = recipient.email.trim();
    const key = to.toLowerCase();

    if (!to || seen.has(key)) {
      continue;
    }

    seen.add(key);
    const result = await enqueueEmail(db, {
      html: email.html,
      idempotencyKey: idempotencyKeyOf("held-sales", episode, recipient.userId),
      kind: HELD_SALES_EMAIL_KIND,
      metadata: { episode, reason: input.reason },
      subject: email.subject,
      text: email.text,
      to,
      userId: recipient.userId
    });

    if (!result.duplicate) {
      queued += 1;
    }
  }

  notices.lastEpisode = episode;
  return { episode, queued, skipped: null };
}

/** A mesma coisa, sem lancar: a falha vai para o log (so o motivo, nunca o comprador). */
export async function notifyHeldSalesEpisodeSafely(db: SupabaseClient, input: Parameters<typeof notifyHeldSalesEpisode>[1]): Promise<void> {
  try {
    const result = await notifyHeldSalesEpisode(db, input);

    if (result.queued > 0) {
      console.info(`[vendas] venda guardada: e-mail para ${result.queued} pessoa(s) da equipe (episodio ${result.episode}).`);
    }
  } catch (error) {
    console.error(`[vendas] e-mail da venda guardada nao enfileirado: ${error instanceof Error ? error.message : "erro desconhecido"}`);
  }
}

/** Esquece o episodio avisado (os testes). */
export function forgetHeldSalesNoticeMemory(): void {
  memory.lastEpisode = null;
}
