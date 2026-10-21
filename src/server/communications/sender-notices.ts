import "server-only";

// "Enviada em seu nome" (docs/23; docs/22 §1.1): quando a notificacao sai (publicada agora, agendada ou
// aprovada) ou o fluxo e ativado, cada pessoa da equipe escolhida em "Quem envia", menos quem publicou,
// recebe um e-mail pela fila (email_outbox, kind `sent_as`). O sino nao serve: a equipe entra direto no
// /admin. Uma vez por pessoa por aviso (ou por fluxo), pela chave de idempotencia.
//
// Melhor esforco: roda depois da resposta (after() do Next), nunca derruba a publicacao e qualquer falha
// vira log. O endereco vem do Auth (auth.admin.getUserById, a mesma fonte do e-mail de boas-vindas);
// conta sem e-mail nao recebe nada (fica no log). Metadados so com ids e contagens, nunca o texto.

import { after } from "next/server";
import { loadAdminAccess } from "@/server/auth/admin-access";
import { can } from "@/server/auth/roles";
import { getRequestOrigin } from "@/server/auth/site-origin";
import { enqueueEmail } from "@/server/email/outbox";
import { sentAsIdempotencyKey } from "@/server/email/outbox-rules";
import { renderSentAsEmail } from "@/server/email/templates/sent-as";
import { resolveEmailSiteOrigin } from "@/server/email/transactional";
import { describeError, type CommunicationsDb } from "./db";

export type SendersOnBehalfInput = {
  /** Quem publicou, aprovou ou ativou (nunca recebe o proprio e-mail). */
  actorId: string;
  campaignId?: string | null;
  /** Alunos que receberam (ou vao receber) a notificacao; no fluxo, nao aparece no texto. */
  count: number;
  flowId?: string | null;
  /** Quem envia em cada notificacao (o aviso e as seguintes); null = a escola. */
  senders: readonly (string | null | undefined)[];
  /** Titulo da notificacao ou nome do fluxo. */
  title: string;
};

/** Fora de um pedido do Next (scripts, testes de integracao) o trabalho roda na hora; fica guardado aqui. */
const pending = new Set<Promise<void>>();

async function publisherNameOf(db: CommunicationsDb, actorId: string) {
  const { data, error } = await db.from("profiles").select("full_name").eq("id", actorId).maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as { full_name: string | null } | null)?.full_name?.trim() || null;
}

async function notifyOne(db: CommunicationsDb, input: SendersOnBehalfInput & { origin: string; publisherName: string | null }, userId: string) {
  // So quem esta na equipe agora: quem saiu ja aparece como a escola no sino.
  const access = await loadAdminAccess(userId, db);

  if (!access) {
    return;
  }

  const { data, error } = await db.auth.admin.getUserById(userId);

  if (error) {
    throw new Error(error.message);
  }

  const email = data.user?.email?.trim();

  if (!email) {
    console.warn(`[comunicacao] ${userId} sem e-mail: "enviada em seu nome" nao enfileirado.`);
    return;
  }

  const flow = Boolean(input.flowId);
  const path = flow
    ? `/admin/comunicacao/fluxos/${encodeURIComponent(input.flowId ?? "")}`
    : `/admin/comunicacao/avisos/${encodeURIComponent(input.campaignId ?? "")}`;
  const rendered = renderSentAsEmail({
    count: input.count,
    link: can(access, "messaging.write") ? `${input.origin}${path}` : null,
    origin: flow ? "flow" : "notice",
    publisherName: input.publisherName,
    title: input.title
  });

  await enqueueEmail(db, {
    html: rendered.html,
    idempotencyKey: sentAsIdempotencyKey({ campaignId: input.campaignId, flowId: input.flowId, userId }),
    kind: "sent_as",
    metadata: flow ? { count: input.count, flow_id: input.flowId } : { campaign_id: input.campaignId, count: input.count },
    subject: rendered.subject,
    text: rendered.text,
    to: email,
    userId
  });
}

async function notifySenders(db: CommunicationsDb, input: SendersOnBehalfInput & { origin: string }) {
  const recipients = Array.from(new Set(input.senders.filter((id): id is string => Boolean(id) && id !== input.actorId)));

  if (recipients.length === 0) {
    return;
  }

  try {
    const publisherName = await publisherNameOf(db, input.actorId);

    for (const userId of recipients) {
      try {
        await notifyOne(db, { ...input, publisherName }, userId);
      } catch (error) {
        console.error(`[comunicacao] "enviada em seu nome" para ${userId} nao enfileirado: ${describeError(error)}`);
      }
    }
  } catch (error) {
    console.error(`[comunicacao] "enviada em seu nome" nao enfileirado: ${describeError(error)}`);
  }
}

/**
 * Agenda os e-mails para depois da resposta (after() do Next); fora de um pedido, roda na hora sem
 * esperar (settleSenderNotices espera nos testes). A origem dos links e lida antes, ainda no pedido.
 */
export async function notifySendersOnBehalf(db: CommunicationsDb, input: SendersOnBehalfInput) {
  if (!input.senders.some((id) => id && id !== input.actorId)) {
    return;
  }

  const origin = resolveEmailSiteOrigin(await getRequestOrigin().catch(() => null));
  const task = () => notifySenders(db, { ...input, origin });

  try {
    after(task);
  } catch {
    const running = task().finally(() => pending.delete(running));
    pending.add(running);
  }
}

/** Espera os e-mails que rodaram fora de um pedido do Next (testes de integracao). */
export async function settleSenderNotices() {
  await Promise.allSettled([...pending]);
}
