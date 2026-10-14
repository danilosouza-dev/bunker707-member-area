"use server";

// Server Actions de Alunos (docs/17 §1.7). Esqueleto unico: runAdminAction confere o papel, valida
// com o schema e converte qualquer erro em ActionFailure. A logica fica em access.ts (compartilhada
// com os webhooks de venda) e nas escritas de store.ts.

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { getAccessEmailRedirectTo } from "@/server/auth/site-origin";
import { StudentAccessError, applyAccessAction, grantProductAccess, provisionStudentAccess } from "./access";
import { deleteAccount, getAccountById, normalizeEmail, sendAccessEmail, updateAccountName } from "./accounts";
import { accessEndDateToIso, type CreatedStudentResult, type StudentOption } from "./model";
import { listStudentOptions } from "./queries";
import {
  accessActionSchema,
  createStudentSchema,
  deleteStudentSchema,
  grantAccessSchema,
  sendAccessEmailSchema,
  studentOptionsQuerySchema,
  updateStudentProfileSchema
} from "./schemas";
import {
  deleteProfile,
  deleteStudentRows,
  fetchProfile,
  fetchStaffUserIds,
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
      temporaryPassword: input.temporaryPassword
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

    await sendAccessEmail(db, account, { fullName: profile?.full_name ?? null, redirectTo: await getAccessEmailRedirectTo() });
    await recordEvent(db, {
      entity_id: account.id,
      entity_type: "auth",
      event_type: "access_email_sent",
      metadata: { actor_id: user.id, delivery: "invite", source: "admin" },
      user_id: account.id
    });

    revalidateStudents(input.userId);

    return { email: normalizeEmail(account.email ?? "") };
  });
}

export async function updateStudentProfile(raw: unknown): Promise<ActionResult<{ fullName: string; phone: string | null }>> {
  return runAdminAction("students.access", updateStudentProfileSchema, raw, async ({ input, user }) => {
    const { account, db } = await requireStudent(input.userId);

    await updateProfile(db, input.userId, { full_name: input.fullName, phone: input.phone });

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

    revalidateStudents(input.userId);

    return { fullName: input.fullName, phone: input.phone };
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

    await removeAvatarFiles(db, input.userId);
    await deleteStudentRows(db, input.userId);

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
