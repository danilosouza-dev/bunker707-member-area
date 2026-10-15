import "server-only";

import { isAdminRole, parseStoredPermissions } from "@/server/auth/roles";
import { listProductOptions } from "@/server/catalog/queries";
import type { ProductOption } from "@/server/catalog/types";
import { sortTeamMembers, type TeamMember } from "./model";
import { fetchTeamProfiles, fetchTeamRoleRow, fetchTeamRoleRows, teamDb, type TeamProfileRow, type TeamRoleRow } from "./store";

// Leituras da tela de Equipe (Configuracoes > Equipe). Quem chama ja passou por
// requirePageRole("settings.team").

function toMember(row: TeamRoleRow, profile: TeamProfileRow | undefined): TeamMember | null {
  if (!isAdminRole(row.role)) {
    return null;
  }

  const stored = parseStoredPermissions(row.permissions);
  const email = profile?.email?.trim() ?? "";

  return {
    actions: row.role === "custom" ? stored.actions : [],
    avatarUrl: profile?.avatar_url ?? null,
    createdAt: row.created_at,
    email,
    fullName: profile?.full_name?.trim() || email.split("@")[0] || "Sem nome",
    lastSignInAt: profile?.last_sign_in_at ?? null,
    productIds: row.role === "instructor" ? stored.productIds : [],
    role: row.role,
    updatedAt: row.updated_at,
    userId: row.user_id
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

/** Cursos que um Professor pode receber: tudo que tem modulos e aulas (formacao junta cursos, nao tem aula propria). */
export async function listTeamCourseOptions(): Promise<ProductOption[]> {
  const options = await listProductOptions();

  return options.filter((option) => option.format !== "formacao");
}
