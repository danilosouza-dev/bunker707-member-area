import "server-only";

// Servico de acesso do aluno: criar/achar a conta, entregar o acesso (convite, senha temporaria ou
// nada) e liberar produtos. E a MESMA rotina para o admin (Adicionar aluno, Liberar acesso) e para
// as vendas que chegarem por webhook (Hotmart, Ticto, Kiwify...): so muda `source`/`sourceProvider`.
// Nao conhece HTTP nem React; quem chama ja validou a entrada e a permissao.

import type { User } from "@supabase/supabase-js";
import {
  EmailRateLimitError,
  createAccountWithPassword,
  createAccountWithoutEmail,
  findAccountByEmail,
  generateTemporaryPassword,
  getAccountById,
  inviteAccount,
  isEmailExistsError,
  normalizeEmail,
  sendAccessEmail,
  setTemporaryPassword
} from "./accounts";
import {
  accessEndDateToIso,
  accessStateOf,
  extendAccessIso,
  isAccessOpen,
  nextAccessEndOnGrant,
  targetTypeForContentKind,
  type AccessDeliveryMethod,
  type BulkItemResult,
  type CreatedStudentResult,
  type EntitlementSnapshot,
  type ImportDeliveryMethod
} from "./model";
import type { AccessAction, BulkActionInput, ImportRowInput } from "./schemas";
import {
  deleteCohortMembership,
  fetchContentKinds,
  fetchEntitlement,
  fetchEntitlements,
  fetchProfileByEmail,
  fetchStaffUserIds,
  fillProfileGaps,
  findEntitlementForTarget,
  insertEntitlement,
  recordEvent,
  recordEvents,
  studentsDb,
  updateEntitlement,
  upsertCohortMembership,
  upsertProfile,
  type ContentKindRow,
  type EntitlementRow,
  type StudentEventInsert,
  type StudentsDb
} from "./store";

export type AccessSource = "admin" | "webhook";

export class StudentAccessError extends Error {
  readonly status: 404 | 409 | 422 | 429;

  constructor(status: 404 | 409 | 422 | 429, message: string) {
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
  /** Acoes em massa e importacao: quem ja tem acesso aberto nao muda ("ja tinha acesso"). */
  skipIfOpen?: boolean;
  userId: string;
};

export type GrantProductAccessResult = {
  /** Produtos em que o aluno ja tinha acesso aberto (so com skipIfOpen). */
  alreadyOpenProductIds: string[];
  granted: EntitlementRow[];
  /** Ids que nao existem mais no catalogo (ignorados). */
  missingProductIds: string[];
};

/**
 * Um acesso por (aluno, produto). Quem ja tem acesso aberto nunca e encurtado: fica com o maior prazo
 * (sem prazo vence data). Quem nao tem acesso aberto (revogado, suspenso, expirado ou nunca teve) passa
 * a ter, a partir de agora, com o prazo pedido.
 */
export async function grantProductAccess(input: GrantProductAccessInput, db: StudentsDb = studentsDb()): Promise<GrantProductAccessResult> {
  const uniqueIds = Array.from(new Set(input.productIds));
  const contents = await fetchContentKinds(db, uniqueIds);

  return grantResolvedProducts(input, contents, db);
}

/** Mesma rotina com os produtos ja resolvidos (acoes em massa resolvem uma vez por lote). */
export async function grantResolvedProducts(
  input: GrantProductAccessInput,
  contents: ContentKindRow[],
  db: StudentsDb
): Promise<GrantProductAccessResult> {
  const uniqueIds = Array.from(new Set(input.productIds));
  const contentById = new Map(contents.map((content) => [content.id, content] as const));
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const granted: EntitlementRow[] = [];
  const alreadyOpenProductIds: string[] = [];
  const events: StudentEventInsert[] = [];

  for (const productId of uniqueIds) {
    const content = contentById.get(productId);

    if (!content) {
      continue;
    }

    const targetType = targetTypeForContentKind(content.kind);
    const existing = await findEntitlementForTarget(db, input.userId, targetType, productId);
    const wasOpen = existing
      ? isAccessOpen(accessStateOf({ endsAt: existing.ends_at, now, startsAt: existing.starts_at, status: existing.status }))
      : false;

    if (wasOpen && input.skipIfOpen) {
      alreadyOpenProductIds.push(productId);
      continue;
    }

    let row: EntitlementRow;

    if (existing) {
      row = await updateEntitlement(db, existing.id, {
        ends_at: nextAccessEndOnGrant({ existingEndsAt: existing.ends_at, requestedEndsAt: input.endsAt, wasOpen }),
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
    events.push({
      entity_id: row.id,
      entity_type: "entitlement",
      event_type: "access_granted",
      metadata: eventMetadata(input, { ends_at: row.ends_at, product_id: productId, product_title: content.title }),
      user_id: input.userId
    });
  }

  await recordEvents(db, events);

  return { alreadyOpenProductIds, granted, missingProductIds: uniqueIds.filter((id) => !contentById.has(id)) };
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
      : await createOrRecover(db, email, () => createAccountWithPassword(db, { email, fullName: input.fullName, password }));

    return { existing: Boolean(current), temporaryPassword: password, user };
  }

  if (input.delivery === "invite") {
    if (current) {
      await sendAccessEmail(db, current, { fullName: input.fullName, redirectTo: input.redirectTo });
      return { existing: true, user: current };
    }

    return { existing: false, user: await createOrRecover(db, email, () => inviteAccount(db, { email, fullName: input.fullName, redirectTo: input.redirectTo })) };
  }

  return current
    ? { existing: true, user: current }
    : { existing: false, user: await createOrRecover(db, email, () => createAccountWithoutEmail(db, { email, fullName: input.fullName })) };
}

/** Conta sem perfil (criada fora do app): o Auth acusa que o e-mail existe; ai sim varremos a lista. */
async function createOrRecover(db: StudentsDb, email: string, create: () => Promise<User>): Promise<User> {
  try {
    return await create();
  } catch (error) {
    if (error instanceof EmailRateLimitError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);

    if (isEmailExistsError({ message })) {
      const recovered = await findAccountByEmail(db, email, { scanAuth: true });

      if (recovered) {
        return recovered;
      }
    }

    throw error;
  }
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


/* ------------------------------------------------------------------------------------------------
 * Importar CSV (docs/17 §1.7.2): uma linha por aluno. Conta que ja existe nao recebe convite de novo
 * e so ganha os campos vazios do perfil. Limite de e-mail (429) interrompe os envios do lote: as contas
 * seguem sendo criadas sem e-mail e a linha sai como "e-mail pendente".
 * ---------------------------------------------------------------------------------------------- */

export type ImportRowOutcome =
  | { emailSent: boolean; status: "created" | "existing"; userId: string }
  | { error: string; status: "failed" };

export async function importStudentRow(
  input: AccessContext & {
    contents: ContentKindRow[];
    delivery: ImportDeliveryMethod;
    endsAt: string | null;
    redirectTo: string;
    row: ImportRowInput;
    /** Depois do primeiro 429 do lote, as linhas seguintes nascem sem e-mail. */
    sendEmails: boolean;
    staffIds: Set<string>;
  },
  db: StudentsDb
): Promise<{ outcome: ImportRowOutcome; emailLimitHit: boolean }> {
  const email = normalizeEmail(input.row.email);
  const profile = await fetchProfileByEmail(db, email);

  if (profile && input.staffIds.has(profile.id)) {
    return { emailLimitHit: false, outcome: { error: "faz parte da equipe", status: "failed" } };
  }

  const knownIds = new Set(input.contents.map((content) => content.id));
  const missing = input.row.productIds.filter((id) => !knownIds.has(id));

  if (missing.length > 0) {
    return { emailLimitHit: false, outcome: { error: "produto não encontrado no catálogo", status: "failed" } };
  }

  let userId: string;
  let created = false;
  let emailSent = false;
  let emailLimitHit = false;

  if (profile) {
    userId = profile.id;
    await fillProfileGaps(db, profile, { fullName: input.row.fullName, phone: input.row.phone });
  } else {
    try {
      const account = await createOrRecover(db, email, () =>
        input.delivery === "invite" && input.sendEmails
          ? inviteAccount(db, { email, fullName: input.row.fullName, redirectTo: input.redirectTo })
          : createAccountWithoutEmail(db, { email, fullName: input.row.fullName })
      );
      userId = account.id;
      created = !account.last_sign_in_at && Date.now() - Date.parse(account.created_at) < 60_000;
      emailSent = created && input.delivery === "invite" && input.sendEmails;
    } catch (error) {
      if (error instanceof EmailRateLimitError) {
        // O e-mail e que falhou: cria a conta sem e-mail e avisa que o envio ficou pendente.
        emailLimitHit = true;
        const account = await createOrRecover(db, email, () => createAccountWithoutEmail(db, { email, fullName: input.row.fullName }));
        userId = account.id;
        created = true;
      } else {
        throw error;
      }
    }

    await upsertProfile(db, { email, fullName: input.row.fullName, id: userId, phone: input.row.phone });
  }

  if (created) {
    await recordEvent(db, {
      entity_id: userId,
      entity_type: "auth",
      event_type: "account_created",
      metadata: eventMetadata(input, { delivery: emailSent ? "invite" : "none", via: "import" }),
      user_id: userId
    });
  }

  if (emailSent) {
    await recordEvent(db, {
      entity_id: userId,
      entity_type: "auth",
      event_type: "access_email_sent",
      metadata: eventMetadata(input, { delivery: "invite", via: "import" }),
      user_id: userId
    });
  }

  if (input.row.productIds.length > 0) {
    await grantResolvedProducts(
      { ...input, endsAt: input.endsAt, productIds: input.row.productIds, skipIfOpen: true, userId },
      input.contents,
      db
    );
  }

  if (input.row.cohortId && input.row.productIds.length > 0) {
    for (const productId of input.row.productIds) {
      await upsertCohortMembership(db, { actorId: input.actorId, cohortId: input.row.cohortId, productId, userId });
    }
  }

  return { emailLimitHit, outcome: { emailSent, status: created ? "created" : "existing", userId } };
}

/* ------------------------------------------------------------------------------------------------
 * Acoes em massa (docs/17 §1.7.1): um lote de ate 25 alunos por chamada; a equipe e sempre recusada;
 * nunca para no primeiro erro; devolve o que aconteceu com cada aluno e o retrato anterior de cada
 * acesso alterado, para o Desfazer restaurar exatamente.
 * ---------------------------------------------------------------------------------------------- */

function snapshotOf(row: EntitlementRow): EntitlementSnapshot {
  return { endsAt: row.ends_at, id: row.id, startsAt: row.starts_at, status: row.status };
}

export async function runBulkBatch(
  input: AccessContext & { batch: BulkActionInput; redirectTo: string },
  db: StudentsDb = studentsDb()
): Promise<{ emailLimitHit: boolean; items: BulkItemResult[] }> {
  const { batch } = input;
  const staffIds = await fetchStaffUserIds(db);
  const userIds = Array.from(new Set(batch.userIds));
  const items: BulkItemResult[] = [];
  const now = Date.now();
  let emailLimitHit = false;

  const contents = batch.productId ? await fetchContentKinds(db, [batch.productId]) : [];
  const product = contents[0] ?? null;
  const targetRows = batch.productId ? await fetchEntitlements(db, { targetId: batch.productId, userIds }) : [];
  const openRowByUser = new Map<string, EntitlementRow>();

  for (const row of targetRows) {
    if (isAccessOpen(accessStateOf({ endsAt: row.ends_at, now, startsAt: row.starts_at, status: row.status })) && !openRowByUser.has(row.user_id)) {
      openRowByUser.set(row.user_id, row);
    }
  }

  const endsAtIso = accessEndDateToIso(batch.endsAt);

  for (const userId of userIds) {
    if (staffIds.has(userId)) {
      items.push({ reason: "staff", status: "skipped", userId });
      continue;
    }

    try {
      switch (batch.action) {
        case "grant": {
          if (!product) {
            items.push({ error: "produto não encontrado", status: "failed", userId });
            break;
          }

          const result = await grantResolvedProducts(
            { ...input, endsAt: endsAtIso, productIds: [product.id], skipIfOpen: true, userId },
            contents,
            db
          );

          if (result.alreadyOpenProductIds.length > 0) {
            items.push({ reason: "already_has_access", status: "skipped", userId });
          } else {
            items.push({ status: "done", userId });
          }

          break;
        }
        case "revoke":
        case "extend_30":
        case "extend_90":
        case "set_end": {
          const open = openRowByUser.get(userId);

          if (!open) {
            items.push({ reason: "no_access", status: "skipped", userId });
            break;
          }

          const before = snapshotOf(open);
          await applyAccessAction(
            { ...input, action: batch.action === "revoke" ? "revoke" : batch.action, endsAt: batch.endsAt, entitlementId: open.id, userId },
            db
          );
          items.push({ snapshot: before, status: "done", userId });
          break;
        }
        case "set_cohort": {
          if (!product) {
            items.push({ error: "produto não encontrado", status: "failed", userId });
            break;
          }

          if (!openRowByUser.has(userId)) {
            items.push({ reason: "no_access", status: "skipped", userId });
            break;
          }

          await setCohortMembership(db, { actorId: input.actorId, cohortId: batch.cohortId ?? null, productId: product.id, userId });
          items.push({ status: "done", userId });
          break;
        }
        case "resend_access_email": {
          if (emailLimitHit) {
            items.push({ reason: "email_limit", status: "skipped", userId });
            break;
          }

          const account = await getAccountById(db, userId);

          if (!account) {
            items.push({ reason: "no_account", status: "skipped", userId });
            break;
          }

          try {
            await sendAccessEmail(db, account, { fullName: null, redirectTo: input.redirectTo });
            await recordEvent(db, {
              entity_id: userId,
              entity_type: "auth",
              event_type: "access_email_sent",
              metadata: eventMetadata(input, { delivery: "invite", via: "bulk" }),
              user_id: userId
            });
            items.push({ status: "done", userId });
          } catch (error) {
            if (error instanceof EmailRateLimitError) {
              emailLimitHit = true;
              items.push({ reason: "email_limit", status: "skipped", userId });
            } else {
              throw error;
            }
          }

          break;
        }
      }
    } catch (error) {
      items.push({ error: error instanceof Error ? error.message : "erro inesperado", status: "failed", userId });
    }
  }

  return { emailLimitHit, items };
}

/** Desfazer de uma acao em massa: grava de volta exatamente o que cada acesso tinha. */
export async function restoreEntitlements(
  input: AccessContext & { snapshots: EntitlementSnapshot[] },
  db: StudentsDb = studentsDb()
) {
  let restored = 0;

  for (const snapshot of input.snapshots) {
    const current = await fetchEntitlement(db, snapshot.id);

    if (!current) {
      continue;
    }

    await updateEntitlement(db, snapshot.id, { ends_at: snapshot.endsAt, starts_at: snapshot.startsAt, status: snapshot.status });
    await recordEvent(db, {
      entity_id: snapshot.id,
      entity_type: "entitlement",
      event_type: "access_restored",
      metadata: eventMetadata(input, { ends_at: snapshot.endsAt, product_id: current.target_id, status: snapshot.status }),
      user_id: current.user_id
    });
    restored += 1;
  }

  return restored;
}

/* ------------------------------------------------------------------------------------------------
 * Turma do aluno num produto (null tira da turma).
 * ---------------------------------------------------------------------------------------------- */

export async function setCohortMembership(
  db: StudentsDb,
  input: { actorId: string | null; cohortId: string | null; productId: string; userId: string }
) {
  if (input.cohortId) {
    await upsertCohortMembership(db, { actorId: input.actorId, cohortId: input.cohortId, productId: input.productId, userId: input.userId });
  } else {
    await deleteCohortMembership(db, input.userId, input.productId);
  }
}
