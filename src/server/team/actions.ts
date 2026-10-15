"use server";

// Server Actions de Equipe (docs/17 §2.3): so o dono (settings.team). Uma conta por e-mail: se a pessoa
// ja tem conta (um aluno, por exemplo), ela so ganha a funcao e entra no admin com a senha de sempre;
// se nao tem, a conta e criada, a funcao e gravada e so entao sai o e-mail para ela criar a senha.
// Toda mudanca vai para admin_audit_log.

import type { User } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { recordAudit } from "@/server/audit/log";
import { isAdminRole, parseStoredPermissions } from "@/server/auth/roles";
import { getAccessEmailRedirectTo } from "@/server/auth/site-origin";
import {
  createAccountWithoutEmail,
  findAccountByEmail,
  generateTemporaryPassword,
  getAccountById,
  isEmailExistsError,
  normalizeEmail,
  sendAccessEmail
} from "@/server/students/accounts";
import { storedPermissionsFor, teamAuditSnapshot, teamChangeError } from "./model";
import { addTeamMemberSchema, teamMemberIdSchema, updateTeamMemberSchema } from "./schemas";
import {
  TeamRuleError,
  countOwners,
  deleteTeamRole,
  ensureTeamProfile,
  fetchTeamRoleRow,
  insertTeamRole,
  teamDb,
  updateTeamRole,
  type TeamDb
} from "./store";

const TEAM_PATH = "/admin/configuracoes/equipe";

function revalidateTeam(userId?: string) {
  revalidatePath(TEAM_PATH);
  revalidatePath("/admin/configuracoes");

  if (userId) {
    revalidatePath(`${TEAM_PATH}/${userId}`);
  }
}

/** Conta nova sem e-mail (o e-mail sai depois de gravar a funcao). Conta sem perfil: acha pela lista do Auth. */
async function createAccount(db: TeamDb, email: string, fullName: string | null): Promise<User> {
  try {
    return await createAccountWithoutEmail(db, { email, fullName });
  } catch (error) {
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

export type TeamMemberAdded = {
  /** O e-mail de acesso devia sair e nao saiu (limite de envio): use "Reenviar convite" depois. */
  emailFailed: boolean;
  /** Saiu o e-mail para a pessoa criar a senha (conta nova ou conta que nunca entrou). */
  emailSent: boolean;
  /** A pessoa ja tinha conta. */
  existingAccount: boolean;
  userId: string;
};

/** [settings.team] Adiciona alguem a equipe com uma funcao. */
export async function addTeamMember(raw: unknown): Promise<ActionResult<TeamMemberAdded>> {
  return runAdminAction("settings.team", addTeamMemberSchema, raw, async ({ input, user }) => {
    const db = teamDb();
    const email = normalizeEmail(input.email);
    const fullName = input.fullName.trim() || null;
    const existing = await findAccountByEmail(db, email, { scanAuth: true });
    const account = existing ?? (await createAccount(db, email, fullName));

    await ensureTeamProfile(db, { email, fullName, id: account.id });

    // Conta nova, ou conta que nunca entrou (aluno criado sem envio ou com senha temporaria): ela recebe
    // o e-mail para criar a senha. Quem ja entrou alguma vez usa a senha de sempre e nao recebe nada.
    const needsEmail = !existing || !existing.last_sign_in_at;

    // Conta existente que nunca entrou pode ter uma senha temporaria criada por outra pessoa (Alunos):
    // troca por uma aleatoria antes de virar equipe, para so quem recebe o e-mail conseguir entrar.
    if (existing && needsEmail) {
      const { error } = await db.auth.admin.updateUserById(existing.id, { password: generateTemporaryPassword(32) });

      if (error) {
        throw new Error(`Equipe: nao foi possivel trocar a senha antiga (${error.message}).`);
      }
    }

    const permissions = storedPermissionsFor(input.role, input);
    await insertTeamRole(db, { permissions, role: input.role, userId: account.id });

    // Auditoria logo depois de dar a funcao: o registro existe mesmo se o e-mail falhar.
    await recordAudit(db, {
      action: "team.member_added",
      actorId: user.id,
      entityId: account.id,
      entityType: "team_member",
      metadata: { ...teamAuditSnapshot(input.role, permissions), emailPlanned: needsEmail, existingAccount: Boolean(existing) }
    });
    revalidateTeam(account.id);

    let emailFailed = false;

    if (needsEmail) {
      try {
        await sendAccessEmail(db, account, { fullName, redirectTo: await getAccessEmailRedirectTo() });
      } catch (error) {
        // A funcao ja foi dada: qualquer falha de envio vira aviso ("Reenviar convite"), nunca erro.
        console.error("[equipe] e-mail de acesso nao saiu", error instanceof Error ? error.message : error);
        emailFailed = true;
      }
    }

    return { emailFailed, emailSent: needsEmail && !emailFailed, existingAccount: Boolean(existing), userId: account.id };
  });
}

/** [settings.team] Muda a funcao, os cursos (Professor) ou as permissoes (Personalizado). */
export async function updateTeamMember(raw: unknown): Promise<ActionResult<{ updatedAt: string }>> {
  return runAdminAction("settings.team", updateTeamMemberSchema, raw, async ({ input, user }) => {
    const db = teamDb();
    const current = await fetchTeamRoleRow(db, input.userId);

    if (!current) {
      throw new TeamRuleError(404, "Essa pessoa não está mais na equipe.");
    }

    const from = isAdminRole(current.role) ? current.role : null;
    const refusal = teamChangeError({
      actorId: user.id,
      change: { from, kind: "update", to: input.role },
      ownerCount: from === "owner" ? await countOwners(db) : Number.POSITIVE_INFINITY,
      targetId: input.userId
    });

    if (refusal) {
      throw new TeamRuleError(409, refusal);
    }

    const permissions = storedPermissionsFor(input.role, input);
    const updated = await updateTeamRole(db, { expectedUpdatedAt: input.expectedUpdatedAt, permissions, role: input.role, userId: input.userId });

    await recordAudit(db, {
      action: "team.member_updated",
      actorId: user.id,
      entityId: input.userId,
      entityType: "team_member",
      metadata: {
        from: teamAuditSnapshot(current.role, parseStoredPermissions(current.permissions)),
        to: teamAuditSnapshot(input.role, permissions)
      }
    });
    revalidateTeam(input.userId);

    return { updatedAt: updated.updated_at };
  });
}

/** [settings.team] Tira a pessoa da equipe. A conta continua (vira uma conta comum, de aluno). */
export async function removeTeamMember(raw: unknown): Promise<ActionResult<{ userId: string }>> {
  return runAdminAction("settings.team", teamMemberIdSchema, raw, async ({ input, user }) => {
    const db = teamDb();
    const current = await fetchTeamRoleRow(db, input.userId);

    if (!current) {
      throw new TeamRuleError(404, "Essa pessoa não está mais na equipe.");
    }

    const from = isAdminRole(current.role) ? current.role : null;
    const refusal = teamChangeError({
      actorId: user.id,
      change: { from, kind: "remove" },
      ownerCount: from === "owner" ? await countOwners(db) : Number.POSITIVE_INFINITY,
      targetId: input.userId
    });

    if (refusal) {
      throw new TeamRuleError(409, refusal);
    }

    await deleteTeamRole(db, input.userId);
    await recordAudit(db, {
      action: "team.member_removed",
      actorId: user.id,
      entityId: input.userId,
      entityType: "team_member",
      metadata: teamAuditSnapshot(current.role, parseStoredPermissions(current.permissions))
    });
    revalidateTeam(input.userId);

    return { userId: input.userId };
  });
}

/**
 * [settings.team] Manda de novo o e-mail para criar a senha, so para quem ainda nao entrou: o link
 * pede uma senha nova, e quem ja entra usa "Esqueci minha senha" no login se precisar.
 */
export async function resendTeamInvite(raw: unknown): Promise<ActionResult<{ userId: string }>> {
  return runAdminAction("settings.team", teamMemberIdSchema, raw, async ({ input, user }) => {
    const db = teamDb();
    const current = await fetchTeamRoleRow(db, input.userId);

    if (!current) {
      throw new TeamRuleError(404, "Essa pessoa não está mais na equipe.");
    }

    const account = await getAccountById(db, input.userId);

    if (!account) {
      throw new TeamRuleError(404, "A conta desta pessoa não existe mais.");
    }

    if (account.last_sign_in_at) {
      throw new TeamRuleError(409, "Essa pessoa já entrou no admin. Se esqueceu a senha, ela usa “Esqueci minha senha” na tela de entrar.");
    }

    const fullName = typeof account.user_metadata?.full_name === "string" ? account.user_metadata.full_name : null;

    await sendAccessEmail(db, account, { fullName, redirectTo: await getAccessEmailRedirectTo() });
    await recordAudit(db, { action: "team.invite_resent", actorId: user.id, entityId: input.userId, entityType: "team_member" });

    return { userId: input.userId };
  });
}
