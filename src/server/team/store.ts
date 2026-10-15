import "server-only";

import type { AdminRole, StoredAdminPermissions } from "@/server/auth/roles";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { toDbError } from "@/server/db/pending-migration";
import { LAST_OWNER_MESSAGE } from "./model";

// Escritas e leituras de admin_roles para a tela de Equipe (so o servidor, com service_role, depois
// de requireRole("settings.team")). Colunas explicitas; uma linha por escrita.

export type TeamDb = ReturnType<typeof getSupabaseAdminClient>;

export function teamDb(): TeamDb {
  return getSupabaseAdminClient();
}

export class TeamRuleError extends Error {
  readonly status: 404 | 409 | 422;

  constructor(status: 404 | 409 | 422, message: string) {
    super(message);
    this.name = "TeamRuleError";
    this.status = status;
  }
}

export const TEAM_MIGRATION_MESSAGE =
  "Falta aplicar a atualização do banco da Equipe (migração 202610160001) para usar Professor e Personalizado.";

export type TeamRoleRow = {
  created_at: string;
  permissions: unknown;
  role: string;
  updated_at: string;
  user_id: string;
};

export type TeamProfileRow = {
  avatar_url: string | null;
  email: string | null;
  full_name: string | null;
  id: string;
  last_sign_in_at: string | null;
};

const ROLE_COLUMNS = "user_id, role, permissions, created_at, updated_at";
const PROFILE_COLUMNS = "id, email, full_name, avatar_url, last_sign_in_at";
/** Equipe pequena; o teto so protege a tela de uma tabela inesperadamente grande. */
const TEAM_LIMIT = 500;

type DbError = { code?: string; hint?: string | null; message: string } | null;

function fail(error: DbError, context: string): never {
  throw toDbError(error ?? { message: "resposta vazia" }, context);
}

/** Erros que a tela explica: ultimo dono (gatilho), pessoa repetida, papel novo sem migracao. */
function translateWriteError(error: NonNullable<DbError>, context: string): never {
  if (error.message?.includes("last_owner")) {
    throw new TeamRuleError(409, LAST_OWNER_MESSAGE);
  }

  if (error.code === "23505") {
    throw new TeamRuleError(409, "Essa pessoa já está na equipe.");
  }

  if (error.code === "23514" && error.message?.includes("admin_roles_role_check")) {
    throw new TeamRuleError(422, TEAM_MIGRATION_MESSAGE);
  }

  fail(error, context);
}

export async function fetchTeamRoleRows(db: TeamDb): Promise<TeamRoleRow[]> {
  const { data, error } = await db.from("admin_roles").select(ROLE_COLUMNS).order("created_at", { ascending: true }).limit(TEAM_LIMIT);

  if (error) {
    fail(error, "Equipe");
  }

  return (data ?? []) as TeamRoleRow[];
}

export async function fetchTeamRoleRow(db: TeamDb, userId: string): Promise<TeamRoleRow | null> {
  const { data, error } = await db.from("admin_roles").select(ROLE_COLUMNS).eq("user_id", userId).maybeSingle();

  if (error) {
    fail(error, "Pessoa da equipe");
  }

  return (data ?? null) as TeamRoleRow | null;
}

export async function fetchTeamProfiles(db: TeamDb, userIds: readonly string[]): Promise<Map<string, TeamProfileRow>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const { data, error } = await db.from("profiles").select(PROFILE_COLUMNS).in("id", [...userIds]);

  if (error) {
    fail(error, "Perfis da equipe");
  }

  return new Map(((data ?? []) as TeamProfileRow[]).map((row) => [row.id, row]));
}

export async function countOwners(db: TeamDb): Promise<number> {
  const { count, error } = await db.from("admin_roles").select("user_id", { count: "exact", head: true }).eq("role", "owner");

  if (error) {
    fail(error, "Donos da escola");
  }

  return count ?? 0;
}

/** Perfil minimo de uma conta nova (quem ja tem perfil fica como esta: nome, telefone e foto). */
export async function ensureTeamProfile(db: TeamDb, profile: { email: string; fullName: string | null; id: string }) {
  const { error } = await db
    .from("profiles")
    .upsert({ email: profile.email, full_name: profile.fullName, id: profile.id }, { ignoreDuplicates: true, onConflict: "id" });

  if (error) {
    fail(error, "Perfil da pessoa da equipe");
  }
}

export async function insertTeamRole(db: TeamDb, input: { permissions: StoredAdminPermissions; role: AdminRole; userId: string }): Promise<TeamRoleRow> {
  const { data, error } = await db
    .from("admin_roles")
    .insert({ permissions: input.permissions, role: input.role, user_id: input.userId })
    .select(ROLE_COLUMNS)
    .single();

  if (error) {
    translateWriteError(error, "Adicionar à equipe");
  }

  return data as TeamRoleRow;
}

/** Gravacao condicional: com `expectedUpdatedAt`, so grava se ninguem mudou a linha antes. */
export async function updateTeamRole(
  db: TeamDb,
  input: { expectedUpdatedAt?: string; permissions: StoredAdminPermissions; role: AdminRole; userId: string }
): Promise<TeamRoleRow> {
  let query = db.from("admin_roles").update({ permissions: input.permissions, role: input.role }).eq("user_id", input.userId);

  if (input.expectedUpdatedAt) {
    query = query.eq("updated_at", input.expectedUpdatedAt);
  }

  const { data, error } = await query.select(ROLE_COLUMNS);

  if (error) {
    translateWriteError(error, "Mudar a função");
  }

  const row = ((data ?? []) as TeamRoleRow[])[0];

  if (!row) {
    const current = await fetchTeamRoleRow(db, input.userId);

    throw current
      ? new TeamRuleError(409, "Outra pessoa mudou esta função agora há pouco. Recarregue a página e tente de novo.")
      : new TeamRuleError(404, "Essa pessoa não está mais na equipe.");
  }

  return row;
}

export async function deleteTeamRole(db: TeamDb, userId: string) {
  const { data, error } = await db.from("admin_roles").delete().eq("user_id", userId).select("user_id");

  if (error) {
    translateWriteError(error, "Remover da equipe");
  }

  if (!data || data.length === 0) {
    throw new TeamRuleError(404, "Essa pessoa não está mais na equipe.");
  }
}
