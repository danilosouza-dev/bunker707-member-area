import "server-only";

import { isAdminAction, isAdminRole, parseStoredPermissions } from "@/server/auth/roles";
import { listProductOptions } from "@/server/catalog/queries";
import type { ProductOption } from "@/server/catalog/types";
import { isPendingMigrationError } from "@/server/db/pending-migration";
import { memberAccessOf, sortTeamMembers, type TeamCustomFunction, type TeamMember } from "./model";
import {
  fetchTeamFunctionRow,
  fetchTeamFunctionRows,
  fetchTeamProfiles,
  fetchTeamRoleRow,
  fetchTeamRoleRows,
  teamDb,
  type TeamFunctionRow,
  type TeamProfileRow,
  type TeamRoleRow
} from "./store";

// Leituras da tela de Equipe (Configuracoes > Equipe). Quem chama ja passou por
// requirePageRole("settings.team").

function toMember(row: TeamRoleRow, profile: TeamProfileRow | undefined): TeamMember | null {
  if (!isAdminRole(row.role)) {
    return null;
  }

  const email = profile?.email?.trim() ?? "";

  return {
    ...memberAccessOf(row.role, row.permissions),
    avatarUrl: profile?.avatar_url ?? null,
    createdAt: row.created_at,
    email,
    fullName: profile?.full_name?.trim() || email.split("@")[0] || "Sem nome",
    lastSignInAt: profile?.last_sign_in_at ?? null,
    role: row.role,
    updatedAt: row.updated_at,
    userId: row.user_id
  };
}

function toFunction(row: TeamFunctionRow, memberCount?: number): TeamCustomFunction {
  const actions = (row.actions ?? []).filter(isAdminAction);

  return {
    actions,
    description: row.description?.trim() ?? "",
    id: row.id,
    ...(memberCount === undefined ? {} : { memberCount }),
    name: row.name,
    scopedActions: (row.scoped_actions ?? []).filter((action) => isAdminAction(action) && actions.includes(action)) as TeamCustomFunction["scopedActions"],
    updatedAt: row.updated_at
  };
}

export async function listTeamMembers(): Promise<TeamMember[]> {
  const db = teamDb();
  const rows = await fetchTeamRoleRows(db);
  const profiles = await fetchTeamProfiles(
    db,
    rows.map((row) => row.user_id)
  );

  return sortTeamMembers(rows.flatMap((row) => toMember(row, profiles.get(row.user_id)) ?? []));
}

export async function getTeamMember(userId: string): Promise<TeamMember | null> {
  const db = teamDb();
  const row = await fetchTeamRoleRow(db, userId);

  if (!row) {
    return null;
  }

  const profiles = await fetchTeamProfiles(db, [userId]);

  return toMember(row, profiles.get(userId));
}

/**
 * Funcoes personalizadas com quantas pessoas tem cada uma. Sem a migracao 202610170001 ainda, a lista
 * vem vazia (a tela de pessoas segue funcionando so com as funcoes prontas).
 */
export async function listTeamFunctions(): Promise<{ functions: TeamCustomFunction[]; ready: boolean }> {
  const db = teamDb();
  let rows: TeamFunctionRow[];

  try {
    rows = await fetchTeamFunctionRows(db);
  } catch (error) {
    if (isPendingMigrationError(error)) {
      return { functions: [], ready: false };
    }

    throw error;
  }

  const counts = new Map<string, number>();

  for (const member of await fetchTeamRoleRows(db)) {
    for (const ref of parseStoredPermissions(member.permissions).functions) {
      counts.set(ref, (counts.get(ref) ?? 0) + 1);
    }
  }

  return { functions: rows.map((row) => toFunction(row, counts.get(row.id) ?? 0)), ready: true };
}

export async function getTeamFunction(id: string): Promise<TeamCustomFunction | null> {
  const row = await fetchTeamFunctionRow(teamDb(), id);

  return row ? toFunction(row) : null;
}

/** Cursos que podem ser escolhidos para uma pessoa: tudo que tem modulos e aulas (formacao junta cursos, nao tem aula propria). */
export async function listTeamCourseOptions(): Promise<ProductOption[]> {
  const options = await listProductOptions();

  return options.filter((option) => option.format !== "formacao");
}
