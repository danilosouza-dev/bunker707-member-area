"use server";

// Server Actions de Equipe (docs/17 §2.3): so o dono (settings.team).
// Pessoas: uma conta por e-mail. Quem ja tem conta (um aluno, por exemplo) so ganha as funcoes e entra
// no admin com a senha de sempre; conta nova e criada, as funcoes sao gravadas e so entao sai o e-mail
// para criar a senha. Cada pessoa tem uma ou mais funcoes, prontas ou personalizadas, e pode ter
// permissoes extras so dela.
// Funcoes personalizadas: pacotes de permissoes com nome; mudar uma funcao muda todo mundo que a tem.
// Toda mudanca vai para admin_audit_log.

import type { User } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { recordAudit } from "@/server/audit/log";
import { readCustomFunctions } from "@/server/auth/admin-access";
import { isAdminRole, isCustomFunctionId, parseStoredPermissions, type CustomFunctionDefinition } from "@/server/auth/roles";
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
import {
  memberGrantsOf,
  needsCourses,
  storedFunctionGrants,
  storedMemberFor,
  teamAuditSnapshot,
  teamChangeError,
  teamFunctionAuditSnapshot,
  type TeamMemberAccessInput
} from "./model";
import {
  addTeamMemberSchema,
  createTeamFunctionSchema,
  teamFunctionIdSchema,
  teamMemberIdSchema,
  updateTeamFunctionSchema,
  updateTeamMemberSchema
} from "./schemas";
import {
  TeamFieldError,
  TeamRuleError,
  countMembersWithFunction,
  countOwners,
  deleteTeamFunctionRow,
  deleteTeamRole,
  ensureTeamProfile,
  fetchTeamFunctionRow,
  fetchTeamRoleRow,
  insertTeamFunction,
  insertTeamRole,
  teamDb,
  updateTeamFunctionRow,
  updateTeamRole,
  type TeamDb
} from "./store";

const TEAM_PATH = "/admin/configuracoes/equipe";

function revalidateTeam(userId?: string) {
  revalidatePath(TEAM_PATH);
  revalidatePath(`${TEAM_PATH}/funcoes`);
  revalidatePath("/admin/configuracoes");

  if (userId) {
    revalidatePath(`${TEAM_PATH}/${userId}`);
  }
}

/** Conta nova sem e-mail (o e-mail sai depois de gravar as funcoes). Conta sem perfil: acha pela lista do Auth. */
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

/** Funcoes personalizadas citadas: todas tem que existir (a tela pode ter ficado desatualizada). */
async function loadReferencedFunctions(db: TeamDb, refs: readonly string[]): Promise<Map<string, CustomFunctionDefinition>> {
  const ids = Array.from(new Set(refs.filter(isCustomFunctionId)));

  if (ids.length === 0) {
    return new Map();
  }

  const found = await readCustomFunctions(db, ids);

  if (found.size !== ids.length) {
    throw new TeamRuleError(422, "Uma das funções escolhidas não existe mais. Recarregue a página.");
  }

  return found;
}

/** Acesso pedido, normalizado para gravar. Permissao por curso exige pelo menos um curso escolhido. */
function storedAccessFor(input: TeamMemberAccessInput, customFunctions: ReadonlyMap<string, CustomFunctionDefinition>) {
  if (!input.owner && needsCourses(memberGrantsOf(input, customFunctions)) && input.productIds.length === 0) {
    throw new TeamFieldError("productIds", "Escolha pelo menos um curso.");
  }

  return storedMemberFor(input, customFunctions);
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

/** [settings.team] Adiciona alguem a equipe com uma ou mais funcoes e, se quiser, permissoes extras. */
export async function addTeamMember(raw: unknown): Promise<ActionResult<TeamMemberAdded>> {
  return runAdminAction("settings.team", addTeamMemberSchema, raw, async ({ input, user }) => {
    const db = teamDb();
    const stored = storedAccessFor(input, await loadReferencedFunctions(db, input.functions));
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

    await insertTeamRole(db, { permissions: stored.permissions, role: stored.role, userId: account.id });

    // Auditoria logo depois de dar as funcoes: o registro existe mesmo se o e-mail falhar.
    await recordAudit(db, {
      action: "team.member_added",
      actorId: user.id,
      entityId: account.id,
      entityType: "team_member",
      metadata: { ...teamAuditSnapshot(stored.role, stored.permissions), emailPlanned: needsEmail, existingAccount: Boolean(existing) }
    });
    revalidateTeam(account.id);

    let emailFailed = false;

    if (needsEmail) {
      try {
        await sendAccessEmail(db, account, { fullName, redirectTo: await getAccessEmailRedirectTo() });
      } catch (error) {
        // As funcoes ja foram dadas: qualquer falha de envio vira aviso ("Reenviar convite"), nunca erro.
        console.error("[equipe] e-mail de acesso nao saiu", error instanceof Error ? error.message : error);
        emailFailed = true;
      }
    }

    return { emailFailed, emailSent: needsEmail && !emailFailed, existingAccount: Boolean(existing), userId: account.id };
  });
}

/** [settings.team] Muda funcoes, extras ou cursos de alguem. */
export async function updateTeamMember(raw: unknown): Promise<ActionResult<{ updatedAt: string }>> {
  return runAdminAction("settings.team", updateTeamMemberSchema, raw, async ({ input, user }) => {
    const db = teamDb();
    const current = await fetchTeamRoleRow(db, input.userId);

    if (!current) {
      throw new TeamRuleError(404, "Essa pessoa não está mais na equipe.");
    }

    const fromOwner = current.role === "owner";
    const refusal = teamChangeError({
      actorId: user.id,
      change: { fromOwner, kind: "update", toOwner: input.owner },
      ownerCount: fromOwner ? await countOwners(db) : Number.POSITIVE_INFINITY,
      targetId: input.userId
    });

    if (refusal) {
      throw new TeamRuleError(409, refusal);
    }

    const stored = storedAccessFor(input, await loadReferencedFunctions(db, input.functions));
    const updated = await updateTeamRole(db, { expectedUpdatedAt: input.expectedUpdatedAt, permissions: stored.permissions, role: stored.role, userId: input.userId });

    await recordAudit(db, {
      action: "team.member_updated",
      actorId: user.id,
      entityId: input.userId,
      entityType: "team_member",
      metadata: {
        from: teamAuditSnapshot(current.role, parseStoredPermissions(current.permissions)),
        to: teamAuditSnapshot(stored.role, stored.permissions)
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

    const fromOwner = current.role === "owner";
    const refusal = teamChangeError({
      actorId: user.id,
      change: { fromOwner, kind: "remove" },
      ownerCount: fromOwner ? await countOwners(db) : Number.POSITIVE_INFINITY,
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
      metadata: teamAuditSnapshot(isAdminRole(current.role) ? current.role : "desconhecido", parseStoredPermissions(current.permissions))
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

/* ------------------------------------------------------------------------------------------------
 * Funcoes personalizadas
 * ---------------------------------------------------------------------------------------------- */

/** [settings.team] Cria uma funcao com nome (pacote de permissoes, algumas podem valer so nos cursos). */
export async function createTeamFunction(raw: unknown): Promise<ActionResult<{ id: string; updatedAt: string }>> {
  return runAdminAction("settings.team", createTeamFunctionSchema, raw, async ({ input, user }) => {
    const db = teamDb();
    const grants = storedFunctionGrants(input.actions, input.scopedActions);
    const row = await insertTeamFunction(db, { ...grants, createdBy: user.id, description: input.description, name: input.name });

    await recordAudit(db, {
      action: "team.function_created",
      actorId: user.id,
      entityId: row.id,
      entityType: "team_function",
      metadata: teamFunctionAuditSnapshot({ ...grants, name: input.name })
    });
    revalidateTeam();

    return { id: row.id, updatedAt: row.updated_at };
  });
}

/** [settings.team] Muda uma funcao: vale para todo mundo que a tem, na proxima requisicao de cada um. */
export async function updateTeamFunction(raw: unknown): Promise<ActionResult<{ updatedAt: string }>> {
  return runAdminAction("settings.team", updateTeamFunctionSchema, raw, async ({ input, user }) => {
    const db = teamDb();
    const current = await fetchTeamFunctionRow(db, input.id);

    if (!current) {
      throw new TeamRuleError(404, "Essa função não existe mais.");
    }

    const grants = storedFunctionGrants(input.actions, input.scopedActions);
    const row = await updateTeamFunctionRow(db, {
      ...grants,
      description: input.description,
      expectedUpdatedAt: input.expectedUpdatedAt,
      id: input.id,
      name: input.name
    });

    await recordAudit(db, {
      action: "team.function_updated",
      actorId: user.id,
      entityId: input.id,
      entityType: "team_function",
      metadata: {
        from: { actions: current.actions ?? [], name: current.name, scopedActions: current.scoped_actions ?? [] },
        to: teamFunctionAuditSnapshot({ ...grants, name: input.name })
      }
    });
    revalidateTeam();

    return { updatedAt: row.updated_at };
  });
}

/** [settings.team] Exclui uma funcao que ninguem tem mais. */
export async function deleteTeamFunction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return runAdminAction("settings.team", teamFunctionIdSchema, raw, async ({ input, user }) => {
    const db = teamDb();
    const current = await fetchTeamFunctionRow(db, input.id);

    if (!current) {
      throw new TeamRuleError(404, "Essa função não existe mais.");
    }

    const members = await countMembersWithFunction(db, input.id);

    if (members > 0) {
      throw new TeamRuleError(409, `Essa função está com ${members === 1 ? "1 pessoa" : `${members} pessoas`}. Troque a função delas antes de excluir.`);
    }

    await deleteTeamFunctionRow(db, input.id);
    await recordAudit(db, {
      action: "team.function_deleted",
      actorId: user.id,
      entityId: input.id,
      entityType: "team_function",
      metadata: { actions: current.actions ?? [], name: current.name, scopedActions: current.scoped_actions ?? [] }
    });
    revalidateTeam();

    return { id: input.id };
  });
}
