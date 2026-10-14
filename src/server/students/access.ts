import "server-only";

// Servico de acesso do aluno: criar/achar a conta, entregar o acesso (convite, senha temporaria ou
// nada) e liberar produtos. E a MESMA rotina para o admin (Adicionar aluno, Liberar acesso) e para
// as vendas que chegarem por webhook (Hotmart, Ticto, Kiwify...): so muda `source`/`sourceProvider`.
// Nao conhece HTTP nem React; quem chama ja validou a entrada e a permissao.

import type { User } from "@supabase/supabase-js";
import {
  createAccountWithPassword,
  createAccountWithoutEmail,
  findAccountByEmail,
  generateTemporaryPassword,
  inviteAccount,
  normalizeEmail,
  sendAccessEmail,
  setTemporaryPassword
} from "./accounts";
import {
  accessEndDateToIso,
  accessStateOf,
  extendAccessIso,
  isAccessOpen,
  targetTypeForContentKind,
  type AccessDeliveryMethod,
  type CreatedStudentResult
} from "./model";
import type { AccessAction } from "./schemas";
import {
  fetchContentKinds,
  fetchEntitlement,
  findEntitlementForTarget,
  insertEntitlement,
  recordEvent,
  studentsDb,
  updateEntitlement,
  upsertProfile,
  type EntitlementRow,
  type StudentsDb
} from "./store";

export type AccessSource = "admin" | "webhook";

export class StudentAccessError extends Error {
  readonly status: 404 | 409 | 422;

  constructor(status: 404 | 409 | 422, message: string) {
    super(message);
    this.name = "StudentAccessError";
    this.status = status;
  }
}

type AccessContext = {
  /** Quem fez (membro da equipe) ou null quando veio de uma venda. */
  actorId: string | null;
  source: AccessSource;
  /** "manual" para a equipe; o nome da plataforma nas vendas. */
  sourceProvider: string;
  /** Id do evento da venda; a equipe nao tem. */
  sourceEventId?: string | null;
};

function eventMetadata(context: AccessContext, extra: Record<string, unknown> = {}) {
  return {
    actor_id: context.actorId,
    source: context.source,
    source_provider: context.sourceProvider,
    ...(context.sourceEventId ? { source_event_id: context.sourceEventId } : {}),
    ...extra
  };
}

/* ------------------------------------------------------------------------------------------------
 * Liberar produtos
 * ---------------------------------------------------------------------------------------------- */

export type GrantProductAccessInput = AccessContext & {
  /** ISO do fim do acesso; null = sem prazo. */
  endsAt: string | null;
  productIds: string[];
  userId: string;
};

export type GrantProductAccessResult = {
  granted: EntitlementRow[];
  /** Ids que nao existem mais no catalogo (ignorados). */
  missingProductIds: string[];
};

/**
 * Um acesso por (aluno, produto): se ja existe, volta a valer (status active, novo prazo); se nao,
 * nasce agora. Nunca cria duplicata nem encurta um acesso ao liberar de novo sem prazo.
 */
export async function grantProductAccess(input: GrantProductAccessInput, db: StudentsDb = studentsDb()): Promise<GrantProductAccessResult> {
  const uniqueIds = Array.from(new Set(input.productIds));
  const contents = await fetchContentKinds(db, uniqueIds);
  const contentById = new Map(contents.map((content) => [content.id, content] as const));
  const nowIso = new Date().toISOString();
  const granted: EntitlementRow[] = [];

  for (const productId of uniqueIds) {
    const content = contentById.get(productId);

    if (!content) {
      continue;
    }

    const targetType = targetTypeForContentKind(content.kind);
    const existing = await findEntitlementForTarget(db, input.userId, targetType, productId);
    let row: EntitlementRow;

    if (existing) {
      const wasOpen = isAccessOpen(accessStateOf({ endsAt: existing.ends_at, now: Date.now(), startsAt: existing.starts_at, status: existing.status }));
      row = await updateEntitlement(db, existing.id, {
        ends_at: input.endsAt,
        starts_at: wasOpen ? existing.starts_at : nowIso,
        status: "active"
      });
    } else {
      row = await insertEntitlement(db, {
        ends_at: input.endsAt,
        product_id: productId,
        source_event_id: input.sourceEventId ?? `admin:${productId}`,
        source_provider: input.sourceProvider,
        starts_at: nowIso,
        status: "active",
        target_id: productId,
        target_type: targetType,
        user_id: input.userId
      });
    }

    granted.push(row);
    await recordEvent(db, {
      entity_id: row.id,
      entity_type: "entitlement",
      event_type: "access_granted",
      metadata: eventMetadata(input, { ends_at: input.endsAt, product_id: productId, product_title: content.title }),
      user_id: input.userId
    });
  }

  return { granted, missingProductIds: uniqueIds.filter((id) => !contentById.has(id)) };
}

/* ------------------------------------------------------------------------------------------------
 * Adicionar aluno (conta + entrega + produtos)
 * ---------------------------------------------------------------------------------------------- */

export type ProvisionStudentAccessInput = AccessContext & {
  delivery: AccessDeliveryMethod;
  email: string;
  /** "AAAA-MM-DD" ou null (sem prazo). */
  endsAt: string | null | undefined;
  fullName: string;
  phone: string | null;
  productIds: string[];
  /** Link de retorno do e-mail de acesso (convite/redefinir senha). */
  redirectTo: string;
  /** Senha escolhida pela equipe; vazia = gerada aqui. So vale com delivery = temporary_password. */
  temporaryPassword?: string | null;
};

async function ensureAccount(
  db: StudentsDb,
  input: ProvisionStudentAccessInput
): Promise<{ existing: boolean; temporaryPassword?: string; user: User }> {
  const email = normalizeEmail(input.email);
  const current = await findAccountByEmail(db, email);

  if (input.delivery === "temporary_password") {
    const password = input.temporaryPassword?.trim() || generateTemporaryPassword();
    const user = current
      ? await setTemporaryPassword(db, current, { fullName: input.fullName, password })
      : await createAccountWithPassword(db, { email, fullName: input.fullName, password });

    return { existing: Boolean(current), temporaryPassword: password, user };
  }

  if (input.delivery === "invite") {
    if (current) {
      await sendAccessEmail(db, current, { fullName: input.fullName, redirectTo: input.redirectTo });
      return { existing: true, user: current };
    }

    return { existing: false, user: await inviteAccount(db, { email, fullName: input.fullName, redirectTo: input.redirectTo }) };
  }

  return current
    ? { existing: true, user: current }
    : { existing: false, user: await createAccountWithoutEmail(db, { email, fullName: input.fullName }) };
}

export async function provisionStudentAccess(input: ProvisionStudentAccessInput, db: StudentsDb = studentsDb()): Promise<CreatedStudentResult> {
  const email = normalizeEmail(input.email);
  const { existing, temporaryPassword, user } = await ensureAccount(db, input);

  await upsertProfile(db, { email, fullName: input.fullName, id: user.id, phone: input.phone });

  if (!existing) {
    await recordEvent(db, {
      entity_id: user.id,
      entity_type: "auth",
      event_type: "account_created",
      metadata: eventMetadata(input, { delivery: input.delivery }),
      user_id: user.id
    });
  }

  if (input.delivery === "invite") {
    await recordEvent(db, {
      entity_id: user.id,
      entity_type: "auth",
      event_type: "access_email_sent",
      metadata: eventMetadata(input, { delivery: "invite" }),
      user_id: user.id
    });
  } else if (input.delivery === "temporary_password") {
    await recordEvent(db, {
      entity_id: user.id,
      entity_type: "auth",
      event_type: "temporary_password_created",
      metadata: eventMetadata(input, { delivery: "temporary_password" }),
      user_id: user.id
    });
  }

  const grant = await grantProductAccess(
    {
      actorId: input.actorId,
      endsAt: accessEndDateToIso(input.endsAt),
      productIds: input.productIds,
      source: input.source,
      sourceEventId: input.sourceEventId,
      sourceProvider: input.sourceProvider,
      userId: user.id
    },
    db
  );

  return {
    delivery: input.delivery,
    email,
    existingAccount: existing,
    fullName: input.fullName,
    grantedProductIds: grant.granted.map((row) => row.target_id),
    id: user.id,
    ...(temporaryPassword ? { temporaryPassword } : {})
  };
}

/* ------------------------------------------------------------------------------------------------
 * Estender, revogar, suspender, reativar
 * ---------------------------------------------------------------------------------------------- */

export type ApplyAccessActionInput = AccessContext & {
  action: AccessAction;
  /** "AAAA-MM-DD" quando action = set_end. */
  endsAt?: string | null;
  entitlementId: string;
  userId: string;
};

const EVENT_BY_ACTION: Record<AccessAction, string> = {
  extend_30: "access_extended",
  extend_90: "access_extended",
  reactivate: "access_reactivated",
  remove_end: "access_extended",
  revoke: "access_revoked",
  set_end: "access_extended",
  suspend: "access_suspended"
};

export async function applyAccessAction(input: ApplyAccessActionInput, db: StudentsDb = studentsDb()): Promise<EntitlementRow> {
  const current = await fetchEntitlement(db, input.entitlementId);

  if (!current || current.user_id !== input.userId) {
    throw new StudentAccessError(404, "Esse acesso não existe mais. Recarregue a página.");
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  let patch: Partial<Pick<EntitlementRow, "ends_at" | "starts_at" | "status">>;

  switch (input.action) {
    case "extend_30":
    case "extend_90":
      patch = { ends_at: extendAccessIso(current.ends_at, input.action === "extend_30" ? 30 : 90, now), status: "active" };
      break;
    case "set_end": {
      const endsAt = accessEndDateToIso(input.endsAt);

      if (!endsAt) {
        throw new StudentAccessError(422, "Escolha a nova data de término.");
      }

      patch = { ends_at: endsAt, status: "active" };
      break;
    }
    case "remove_end":
      patch = { ends_at: null, status: "active" };
      break;
    case "revoke":
      patch = { status: "revoked" };
      break;
    case "suspend":
      patch = { status: "suspended" };
      break;
    case "reactivate": {
      const endsAtPassed = current.ends_at ? Date.parse(current.ends_at) <= now : false;
      patch = { ends_at: endsAtPassed ? null : current.ends_at, starts_at: Date.parse(current.starts_at) > now ? current.starts_at : nowIso, status: "active" };
      break;
    }
  }

  // Voltar a valer (de revogado/suspenso/expirado) conta "desde" agora; acesso agendado segue agendado.
  if (patch.status === "active" && current.status !== "active" && !patch.starts_at && Date.parse(current.starts_at) <= now) {
    patch.starts_at = nowIso;
  }

  const row = await updateEntitlement(db, current.id, patch);

  await recordEvent(db, {
    entity_id: row.id,
    entity_type: "entitlement",
    event_type: EVENT_BY_ACTION[input.action],
    metadata: eventMetadata(input, { action: input.action, ends_at: row.ends_at, product_id: row.target_id }),
    user_id: input.userId
  });

  return row;
}
