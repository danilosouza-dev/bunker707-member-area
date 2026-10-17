"use server";

// Server Actions de Alunos (docs/17 §1.7). Esqueleto unico: runAdminAction confere o papel, valida
// com o schema e converte qualquer erro em ActionFailure. A logica fica em access.ts (compartilhada
// com os webhooks de venda) e nas escritas de store.ts.

import { revalidatePath } from "next/cache";
import { csvFileName, toCsv } from "@/lib/csv";
import type { ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { can } from "@/server/auth/roles";
import { getAccessEmailRedirectTo } from "@/server/auth/site-origin";
import { anonymizeWebhookEventsFor } from "@/server/payments/store";
import {
  StudentAccessError,
  applyAccessAction,
  grantProductAccess,
  importStudentRow,
  provisionStudentAccess,
  restoreEntitlements,
  runBulkBatch,
  setCohortMembership
} from "./access";
import { deleteAccount, getAccountById, normalizeEmail, sendAccessEmail, updateAccountName } from "./accounts";
import { STUDENT_EXPORT_HEADERS, studentExportRowToCells } from "./export-model";
import {
  IMPORT_HOURLY_LIMIT,
  accessEndDateToIso,
  type BulkBatchResult,
  type CreatedStudentResult,
  type ImportBatchResult,
  type ImportRowResult,
  type StudentCohort,
  type StudentOption,
  type StudentSavedSegment
} from "./model";
import { listStudentOptions, listStudentsForExport } from "./queries";
import {
  accessActionSchema,
  bulkActionSchema,
  createCohortSchema,
  createStudentSchema,
  deleteSegmentSchema,
  deleteStudentSchema,
  exportQuerySchema,
  grantAccessSchema,
  importBatchSchema,
  normalizeStudentListParams,
  restoreEntitlementsSchema,
  saveSegmentSchema,
  sendAccessEmailSchema,
  setStudentCohortSchema,
  studentOptionsQuerySchema,
  updateStudentProfileSchema
} from "./schemas";
import {
  countImportedLastHour,
  deleteProfile,
  deleteSegment,
  deleteStudentRows,
  fetchCohorts,
  fetchContentKinds,
  fetchProfile,
  fetchStaffUserIds,
  isStaffUser,
  insertCohort,
  insertSegment,
  recordAudit,
  recordEvent,
  removeAvatarFiles,
  studentsDb,
  updateProfile
} from "./store";

const MANUAL = { source: "admin" as const, sourceProvider: "manual" };

/** Lista, perfil, aba Alunos dos produtos e o Hoje (contadores) leem dados que acabaram de mudar. */
function revalidateStudents(userId?: string, productIds: readonly string[] = []) {
  revalidatePath("/admin/alunos");
  revalidatePath("/admin");

  if (userId) {
    revalidatePath(`/admin/alunos/${userId}`);
  }

  for (const productId of productIds) {
    revalidatePath(`/admin/produtos/${productId}/alunos`);
  }
}

async function requireStudent(userId: string) {
  const db = studentsDb();
  const [profile, account] = await Promise.all([fetchProfile(db, userId), getAccountById(db, userId)]);

  if (!profile && !account) {
    throw new StudentAccessError(404, "Esse aluno não existe mais.");
  }

  return { account, db, profile };
}

export async function createStudent(raw: unknown): Promise<ActionResult<CreatedStudentResult>> {
  return runAdminAction("students.access", createStudentSchema, raw, async ({ input, user }) => {
    const result = await provisionStudentAccess({
      ...MANUAL,
      actorId: user.id,
      delivery: input.delivery,
      email: input.email,
      endsAt: input.endsAt ?? null,
      fullName: input.fullName,
      phone: input.phone,
      productIds: input.productIds,
      redirectTo: await getAccessEmailRedirectTo(),
      rejectStaff: true,
      temporaryPassword: input.temporaryPassword
    });

    if (input.cohortId) {
      for (const productId of result.grantedProductIds) {
        await setCohortMembership(studentsDb(), { actorId: user.id, cohortId: input.cohortId, productId, userId: result.id });
      }
    }

    await recordAudit(studentsDb(), {
      action: "students.create",
      actorId: user.id,
      count: result.grantedProductIds.length,
      entityId: result.id,
      entityType: "student",
      metadata: { delivery: input.delivery, existing_account: result.existingAccount, product_ids: result.grantedProductIds }
    });
    revalidateStudents(result.id, result.grantedProductIds);

    return result;
  });
}

export async function grantStudentAccess(raw: unknown): Promise<ActionResult<{ granted: number; missingProductIds: string[] }>> {
  return runAdminAction("students.access", grantAccessSchema, raw, async ({ input, user }) => {
    const { db } = await requireStudent(input.userId);
    const result = await grantProductAccess(
      {
        ...MANUAL,
        actorId: user.id,
        endsAt: accessEndDateToIso(input.endsAt),
        productIds: input.productIds,
        userId: input.userId
      },
      db
    );

    await recordAudit(db, {
      action: "students.grant_access",
      actorId: user.id,
      count: result.granted.length,
      entityId: input.userId,
      entityType: "student",
      metadata: { ends_at: accessEndDateToIso(input.endsAt), product_ids: result.granted.map((row) => row.target_id) }
    });
    revalidateStudents(input.userId, input.productIds);

    return { granted: result.granted.length, missingProductIds: result.missingProductIds };
  });
}

export async function updateStudentAccess(raw: unknown): Promise<ActionResult<{ endsAt: string | null; status: string }>> {
  return runAdminAction("students.access", accessActionSchema, raw, async ({ input, user }) => {
    const row = await applyAccessAction({
      ...MANUAL,
      action: input.action,
      actorId: user.id,
      endsAt: input.endsAt,
      entitlementId: input.entitlementId,
      userId: input.userId
    });

    await recordAudit(studentsDb(), {
      action: `students.access_${input.action}`,
      actorId: user.id,
      entityId: row.id,
      entityType: "entitlement",
      metadata: { ends_at: row.ends_at, product_id: row.target_id, status: row.status, user_id: input.userId }
    });
    revalidateStudents(input.userId, [row.target_id]);

    return { endsAt: row.ends_at, status: row.status };
  });
}

/** Convite de novo ou "redefinir senha": o mesmo e-mail, com link para criar a senha. */
export async function sendStudentAccessEmail(raw: unknown): Promise<ActionResult<{ email: string }>> {
  return runAdminAction("students.access", sendAccessEmailSchema, raw, async ({ input, user }) => {
    const { account, db, profile } = await requireStudent(input.userId);

    if (!account) {
      throw new StudentAccessError(409, "Este aluno não tem conta de acesso. Adicione-o de novo pelo botão Adicionar aluno.");
    }

    // O e-mail de acesso pede senha nova: nunca para a equipe (o convite dela sai por Configuracoes > Equipe).
    if (await isStaffUser(db, account.id)) {
      throw new StudentAccessError(409, "Esta conta é da equipe. O convite de quem ainda não entrou sai por Configurações › Equipe; quem já entra usa “Esqueci minha senha”.");
    }

    await sendAccessEmail(db, account, { fullName: profile?.full_name ?? null, redirectTo: await getAccessEmailRedirectTo() });
    await recordEvent(db, {
      entity_id: account.id,
      entity_type: "auth",
      event_type: "access_email_sent",
      metadata: { actor_id: user.id, delivery: "invite", source: "admin" },
      user_id: account.id
    });

    await recordAudit(db, { action: "students.access_email", actorId: user.id, entityId: account.id, entityType: "student" });
    revalidateStudents(input.userId);

    return { email: normalizeEmail(account.email ?? "") };
  });
}

export async function updateStudentProfile(raw: unknown): Promise<ActionResult<{ fullName: string; phone: string | null }>> {
  return runAdminAction("students.access", updateStudentProfileSchema, raw, async ({ access, input, user }) => {
    const { account, db, profile } = await requireStudent(input.userId);

    // Nome da equipe so o dono muda (ninguem renomeia o dono para se passar por ele).
    if (!can(access, "settings.team") && (await isStaffUser(db, input.userId))) {
      throw new StudentAccessError(409, "Esta conta é da equipe. Só o dono muda os dados de quem é da equipe.");
    }

    // Sem "ver dados pessoais", o telefone nem chega a tela: fica o que ja estava gravado.
    const phone = can(access, "students.read_personal") ? input.phone : (profile?.phone ?? null);

    await updateProfile(db, input.userId, { full_name: input.fullName, phone });

    if (account) {
      await updateAccountName(db, account, input.fullName);
    }

    await recordEvent(db, {
      entity_id: input.userId,
      entity_type: "profile",
      event_type: "profile_updated",
      metadata: { actor_id: user.id, source: "admin" },
      user_id: input.userId
    });

    await recordAudit(db, { action: "students.profile_update", actorId: user.id, entityId: input.userId, entityType: "student" });
    revalidateStudents(input.userId);

    return { fullName: input.fullName, phone: can(access, "students.read_personal") ? phone : null };
  });
}

/**
 * Excluir aluno: conta, perfil, acessos, historico, progresso e foto somem. Nao vale para a equipe
 * (Configurações › Equipe cuida dos papeis) nem para a propria conta.
 */
export async function deleteStudent(raw: unknown): Promise<ActionResult<{ deleted: true }>> {
  return runAdminAction("students.delete", deleteStudentSchema, raw, async ({ input, user }) => {
    const { account, db, profile } = await requireStudent(input.userId);
    const email = normalizeEmail(profile?.email ?? account?.email ?? "");

    if (input.userId === user.id) {
      throw new StudentAccessError(422, "Você não pode excluir a sua própria conta por aqui.");
    }

    if ((await fetchStaffUserIds(db)).has(input.userId)) {
      throw new StudentAccessError(422, "Esta conta faz parte da equipe. Tire o papel dela antes de excluir.");
    }

    if (!email || email !== input.confirmEmail) {
      throw new StudentAccessError(422, "O e-mail digitado não confere com o do aluno.");
    }

    // Prova da exclusao (LGPD) ANTES do primeiro passo irreversivel: quem, quando e qual conta.
    await recordAudit(db, { action: "students.delete", actorId: user.id, entityId: input.userId, entityType: "student", metadata: { email } });
    await removeAvatarFiles(db, input.userId);
    await deleteStudentRows(db, input.userId);
    // Vendas recebidas do aluno (webhook_events) perdem e-mail e dados do comprador; o historico da venda fica.
    await anonymizeWebhookEventsFor(db, { email, userId: input.userId });

    if (account) {
      await deleteAccount(db, input.userId);
    }

    if (profile) {
      await deleteProfile(db, input.userId);
    }

    revalidateStudents(input.userId);

    return { deleted: true };
  });
}

export async function searchStudentOptions(raw: unknown): Promise<ActionResult<StudentOption[]>> {
  return runAdminAction("students.read_basic", studentOptionsQuerySchema, raw, async ({ input }) =>
    listStudentOptions({ productId: input.productId ?? null, q: input.q })
  );
}


/* ------------------------------------------------------------------------------------------------
 * Entrega 2: segmentos, turmas, acoes em massa, importacao e exportacao
 * ---------------------------------------------------------------------------------------------- */

export async function saveStudentSegment(raw: unknown): Promise<ActionResult<StudentSavedSegment>> {
  return runAdminAction("students.access", saveSegmentSchema, raw, async ({ input, user }) => {
    // Uma semana fixa do ciclo de vida nao e um segmento reutilizavel: sai ao salvar.
    const { group: _group, week: _week, ...reusable } = input.params;
    void _group;
    void _week;
    const params = normalizeStudentListParams(reusable);
    const row = await insertSegment(studentsDb(), { actorId: user.id, name: input.name, params }).catch((error: unknown) => {
      if (error instanceof Error && /duplicate key|student_segments_name_lower_idx/i.test(error.message)) {
        throw new StudentAccessError(409, "Já existe um segmento com esse nome.");
      }

      throw error;
    });

    revalidatePath("/admin/alunos");

    return { createdAt: row.created_at, id: row.id, name: row.name, params };
  });
}

export async function deleteStudentSegment(raw: unknown): Promise<ActionResult<{ deleted: true }>> {
  return runAdminAction("students.access", deleteSegmentSchema, raw, async ({ input }) => {
    await deleteSegment(studentsDb(), input.id);
    revalidatePath("/admin/alunos");

    return { deleted: true };
  });
}

export async function createCohort(raw: unknown): Promise<ActionResult<StudentCohort>> {
  return runAdminAction("students.access", createCohortSchema, raw, async ({ input }) => {
    const db = studentsDb();
    const existing = (await fetchCohorts(db)).find((cohort) => cohort.name.trim().toLocaleLowerCase("pt-BR") === input.name.toLocaleLowerCase("pt-BR"));

    if (existing) {
      return existing;
    }

    return insertCohort(db, input.name);
  });
}

export async function setStudentCohort(raw: unknown): Promise<ActionResult<{ cohortId: string | null }>> {
  return runAdminAction("students.access", setStudentCohortSchema, raw, async ({ input, user }) => {
    const { db } = await requireStudent(input.userId);
    await setCohortMembership(db, { actorId: user.id, cohortId: input.cohortId, productId: input.productId, userId: input.userId });
    await recordEvent(db, {
      entity_id: input.productId,
      entity_type: "cohort",
      event_type: "cohort_changed",
      metadata: { actor_id: user.id, cohort_id: input.cohortId, product_id: input.productId, source: "admin" },
      user_id: input.userId
    });
    revalidateStudents(input.userId, [input.productId]);

    return { cohortId: input.cohortId };
  });
}

/** Um lote (ate 25 alunos) de uma acao em massa; o cliente itera com barra de progresso (teto 200). */
export async function runBulkStudentAction(raw: unknown): Promise<ActionResult<BulkBatchResult>> {
  return runAdminAction("students.access", bulkActionSchema, raw, async ({ input, user }) => {
    const db = studentsDb();
    const result = await runBulkBatch(
      { ...MANUAL, actorId: user.id, batch: input, redirectTo: await getAccessEmailRedirectTo() },
      db
    );
    const done = result.items.filter((item) => item.status === "done").length;
    const skipped: Record<string, number> = {};

    for (const item of result.items) {
      if (item.status === "skipped") {
        skipped[item.reason] = (skipped[item.reason] ?? 0) + 1;
      }
    }

    await recordAudit(db, {
      action: `students.bulk_${input.action}`,
      actorId: user.id,
      count: done,
      entityId: input.batchId,
      entityType: "bulk_batch",
      metadata: {
        cohort_id: input.cohortId ?? null,
        ends_at: accessEndDateToIso(input.endsAt),
        failed: result.items.filter((item) => item.status === "failed").length,
        product_id: input.productId ?? null,
        requested: input.userIds.length,
        skipped
      }
    });
    revalidateStudents(undefined, input.productId ? [input.productId] : []);

    return { batchId: input.batchId, emailLimitHit: result.emailLimitHit, items: result.items };
  });
}

/** Desfazer de uma acao em massa: restaura exatamente o retrato anterior de cada acesso. */
export async function undoBulkStudentAction(raw: unknown): Promise<ActionResult<{ restored: number }>> {
  return runAdminAction("students.access", restoreEntitlementsSchema, raw, async ({ input, user }) => {
    const db = studentsDb();
    const restored = await restoreEntitlements({ ...MANUAL, actorId: user.id, snapshots: input.snapshots }, db);

    await recordAudit(db, {
      action: "students.bulk_undo",
      actorId: user.id,
      count: restored,
      entityId: input.batchId,
      entityType: "bulk_batch",
      metadata: { requested: input.snapshots.length }
    });
    revalidateStudents();

    return { restored };
  });
}

/** Um lote (ate 25 linhas) da importacao; o cliente envia os lotes em sequencia com progresso. */
export async function importStudentsBatch(raw: unknown): Promise<ActionResult<ImportBatchResult>> {
  return runAdminAction("students.access", importBatchSchema, raw, async ({ input, user }) => {
    const db = studentsDb();
    const importedLastHour = await countImportedLastHour(db, user.id);

    if (importedLastHour + input.rows.length > IMPORT_HOURLY_LIMIT) {
      throw new StudentAccessError(429, `Limite de ${IMPORT_HOURLY_LIMIT} alunos importados por hora. Tente de novo mais tarde.`);
    }

    const [staffIds, redirectTo] = await Promise.all([fetchStaffUserIds(db), getAccessEmailRedirectTo()]);
    const productIds = Array.from(new Set(input.rows.flatMap((row) => row.productIds)));
    const contents = await fetchContentKinds(db, productIds);
    const endsAt = accessEndDateToIso(input.endsAt);
    const rows: ImportRowResult[] = [];
    let sendEmails = input.delivery === "invite";
    let emailLimitHit = false;

    for (const row of input.rows) {
      try {
        const result = await importStudentRow(
          { ...MANUAL, actorId: user.id, contents, delivery: input.delivery, endsAt, redirectTo, row, sendEmails, staffIds },
          db
        );

        if (result.emailLimitHit) {
          emailLimitHit = true;
          sendEmails = false;
        }

        rows.push(result.outcome.status === "failed" ? { error: result.outcome.error, index: row.index, status: "failed" } : { ...result.outcome, index: row.index });
      } catch (error) {
        rows.push({ error: error instanceof Error ? error.message : "erro inesperado", index: row.index, status: "failed" });
      }
    }

    const created = rows.filter((row) => row.status === "created").length;
    const existing = rows.filter((row) => row.status === "existing").length;
    const failed = rows.filter((row) => row.status === "failed").length;

    await recordAudit(db, {
      action: "students.import_batch",
      actorId: user.id,
      count: input.rows.length,
      entityId: input.batchId,
      entityType: "import_batch",
      metadata: { created, delivery: input.delivery, email_limit_hit: emailLimitHit, existing, failed }
    });
    revalidateStudents();

    return { batchId: input.batchId, emailLimitHit, rows };
  });
}

/** CSV da lista (filtro atual ou selecao). O navegador baixa o texto; nada passa pelo endereco. */
export async function exportStudentsCsv(raw: unknown): Promise<ActionResult<{ csv: string; fileName: string; rows: number }>> {
  return runAdminAction("students.export", exportQuerySchema, raw, async ({ input, user }) => {
    const params = normalizeStudentListParams(input.params);
    const rows = await listStudentsForExport({ ids: input.ids, params });
    const csv = toCsv(STUDENT_EXPORT_HEADERS, rows.map(studentExportRowToCells));
    const { q, ...filtersWithoutSearch } = params;

    await recordAudit(studentsDb(), {
      action: "students.export",
      actorId: user.id,
      count: rows.length,
      entityType: "student_list",
      metadata: { filters: filtersWithoutSearch, ids_count: input.ids?.length ?? 0, search_used: Boolean(q) }
    });

    return { csv, fileName: csvFileName("alunos", new Date()), rows: rows.length };
  });
}
