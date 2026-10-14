import "server-only";

// Acesso ao banco de Alunos: leituras com colunas explicitas e escritas de UMA linha por vez
// (docs/13). Tabelas: profiles (nome, telefone, foto), admin_roles (equipe), entitlements (acessos),
// lesson_progress (estudo), course_modules/lessons (total de aulas por produto) e student_events
// (historico). Sempre com a chave de servico, so a partir de Server Actions e paginas do admin que
// ja passaram por requireRole/requirePageAdmin.

import { toDbError } from "@/server/db/pending-migration";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import type { EntitlementStatus, EntitlementTargetType } from "./model";

export type StudentsDb = ReturnType<typeof getSupabaseAdminClient>;

export function studentsDb(): StudentsDb {
  return getSupabaseAdminClient();
}

type DbError = { code?: string; message: string } | null;

export function failOnError(error: DbError, context: string) {
  if (error) {
    throw toDbError(error, context);
  }
}

/** Escapa %, _ e \ para um ilike de "contem". */
export function likeContains(value: string) {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/* ------------------------------------------------------------------------------------------------
 * Linhas
 * ---------------------------------------------------------------------------------------------- */

export const PROFILE_COLUMNS = "id,email,full_name,phone,avatar_url,created_at";

export type ProfileRow = {
  avatar_url: string | null;
  created_at: string;
  email: string | null;
  full_name: string | null;
  id: string;
  phone: string | null;
};

export const ENTITLEMENT_COLUMNS =
  "id,user_id,source_provider,source_event_id,product_id,target_type,target_id,status,starts_at,ends_at,created_at,updated_at";

export type EntitlementRow = {
  created_at: string;
  ends_at: string | null;
  id: string;
  product_id: string | null;
  source_event_id: string | null;
  source_provider: string;
  starts_at: string;
  status: EntitlementStatus;
  target_id: string;
  target_type: EntitlementTargetType;
  updated_at: string;
  user_id: string;
};

export type ProgressRow = {
  completed_lesson_ids: string[] | null;
  content_id: string;
  updated_at: string;
  user_id: string;
};

export type EventRow = {
  entity_id: string | null;
  entity_type: string | null;
  event_type: string;
  id: string;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
};

export type ContentKindRow = { id: string; image: string | null; kind: string; title: string };

/* ------------------------------------------------------------------------------------------------
 * Leituras
 * ---------------------------------------------------------------------------------------------- */

const PAGE_SIZE = 1000;
const MAX_ROWS = 50_000;

/** Le todas as linhas em paginas de 1000 (limite do PostgREST), com teto para nao estourar memoria. */
async function fetchAll<Row>(
  context: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbError }>
): Promise<Row[]> {
  const rows: Row[] = [];

  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    failOnError(error, context);
    const chunk = (data ?? []) as Row[];
    rows.push(...chunk);

    if (chunk.length < PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

export function fetchProfiles(db: StudentsDb) {
  return fetchAll<ProfileRow>("Alunos", (from, to) =>
    db.from("profiles").select(PROFILE_COLUMNS).order("created_at", { ascending: false }).order("id").range(from, to)
  );
}

export async function fetchProfile(db: StudentsDb, userId: string): Promise<ProfileRow | null> {
  const { data, error } = await db.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle();
  failOnError(error, "Aluno");

  return (data ?? null) as ProfileRow | null;
}

export async function fetchProfileByEmail(db: StudentsDb, email: string): Promise<ProfileRow | null> {
  const { data, error } = await db
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
    .limit(1)
    .maybeSingle();
  failOnError(error, "Aluno por e-mail");

  return (data ?? null) as ProfileRow | null;
}

export async function fetchStaffUserIds(db: StudentsDb): Promise<Set<string>> {
  const { data, error } = await db.from("admin_roles").select("user_id");
  failOnError(error, "Equipe");

  return new Set(((data ?? []) as { user_id: string }[]).map((row) => row.user_id));
}

export function fetchEntitlements(db: StudentsDb, filter: { targetId?: string; userId?: string } = {}) {
  return fetchAll<EntitlementRow>("Acessos", (from, to) => {
    let query = db.from("entitlements").select(ENTITLEMENT_COLUMNS).order("created_at", { ascending: false }).order("id");

    if (filter.userId) {
      query = query.eq("user_id", filter.userId);
    }

    if (filter.targetId) {
      query = query.eq("target_id", filter.targetId);
    }

    return query.range(from, to);
  });
}

export async function fetchEntitlement(db: StudentsDb, entitlementId: string): Promise<EntitlementRow | null> {
  const { data, error } = await db.from("entitlements").select(ENTITLEMENT_COLUMNS).eq("id", entitlementId).maybeSingle();
  failOnError(error, "Acesso");

  return (data ?? null) as EntitlementRow | null;
}

export function fetchProgressRows(db: StudentsDb, userId?: string) {
  return fetchAll<ProgressRow>("Progresso dos alunos", (from, to) => {
    let query = db.from("lesson_progress").select("user_id,content_id,completed_lesson_ids,updated_at").order("id");

    if (userId) {
      query = query.eq("user_id", userId);
    }

    return query.range(from, to);
  });
}

/** Aulas publicadas (em modulos publicados) por produto: Map<contentId, Set<lessonId>>. */
export async function fetchPublishedLessonIndex(db: StudentsDb): Promise<Map<string, Set<string>>> {
  const [modules, lessons] = await Promise.all([
    fetchAll<{ id: string; owner_id: string }>("Módulos", (from, to) =>
      db.from("course_modules").select("id,owner_id").eq("status", "published").order("id").range(from, to)
    ),
    fetchAll<{ id: string; module_id: string }>("Aulas", (from, to) =>
      db.from("lessons").select("id,module_id").eq("status", "published").order("id").range(from, to)
    )
  ]);
  const ownerByModule = new Map(modules.map((module) => [module.id, module.owner_id] as const));
  const index = new Map<string, Set<string>>();

  for (const lesson of lessons) {
    const contentId = ownerByModule.get(lesson.module_id);

    if (!contentId) {
      continue;
    }

    const set = index.get(contentId) ?? new Set<string>();
    set.add(lesson.id);
    index.set(contentId, set);
  }

  return index;
}

export async function fetchContentKinds(db: StudentsDb, ids: string[]): Promise<ContentKindRow[]> {
  if (ids.length === 0) {
    return [];
  }

  const { data, error } = await db.from("content_items").select("id,title,kind,image").in("id", ids);
  failOnError(error, "Produtos do acesso");

  return (data ?? []) as ContentKindRow[];
}

export async function fetchEvents(db: StudentsDb, userId: string, limit = 100): Promise<EventRow[]> {
  const { data, error } = await db
    .from("student_events")
    .select("id,event_type,entity_type,entity_id,metadata,occurred_at")
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  failOnError(error, "Histórico do aluno");

  return (data ?? []) as EventRow[];
}

/* ------------------------------------------------------------------------------------------------
 * Escritas (uma linha por vez)
 * ---------------------------------------------------------------------------------------------- */

export async function upsertProfile(
  db: StudentsDb,
  profile: { email: string; fullName: string | null; id: string; phone: string | null }
) {
  // So as colunas enviadas mudam: a foto que o aluno subiu fica como esta.
  const { error } = await db
    .from("profiles")
    .upsert(
      { email: profile.email, full_name: profile.fullName, id: profile.id, phone: profile.phone },
      { onConflict: "id" }
    );
  failOnError(error, "Perfil do aluno");
}

export async function updateProfile(db: StudentsDb, userId: string, patch: { full_name?: string | null; phone?: string | null }) {
  const { error } = await db.from("profiles").update(patch).eq("id", userId);
  failOnError(error, "Perfil do aluno");
}

export async function findEntitlementForTarget(
  db: StudentsDb,
  userId: string,
  targetType: EntitlementTargetType,
  targetId: string
): Promise<EntitlementRow | null> {
  const { data, error } = await db
    .from("entitlements")
    .select(ENTITLEMENT_COLUMNS)
    .eq("user_id", userId)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  failOnError(error, "Acesso existente");

  return (data ?? null) as EntitlementRow | null;
}

export type EntitlementInsert = {
  ends_at: string | null;
  product_id: string | null;
  source_event_id: string | null;
  source_provider: string;
  starts_at: string;
  status: EntitlementStatus;
  target_id: string;
  target_type: EntitlementTargetType;
  user_id: string;
};

export async function insertEntitlement(db: StudentsDb, row: EntitlementInsert): Promise<EntitlementRow> {
  const { data, error } = await db.from("entitlements").insert(row).select(ENTITLEMENT_COLUMNS).single();
  failOnError(error, "Liberar acesso");

  return data as EntitlementRow;
}

export async function updateEntitlement(
  db: StudentsDb,
  entitlementId: string,
  patch: Partial<Pick<EntitlementRow, "ends_at" | "starts_at" | "status">>
): Promise<EntitlementRow> {
  const { data, error } = await db
    .from("entitlements")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", entitlementId)
    .select(ENTITLEMENT_COLUMNS)
    .single();
  failOnError(error, "Atualizar acesso");

  return data as EntitlementRow;
}

export type StudentEventInsert = {
  entity_id?: string | null;
  entity_type?: string | null;
  event_type: string;
  metadata?: Record<string, unknown>;
  user_id: string;
};

/** Historico e secundario: falha de gravacao vira log, nunca derruba a acao que ja deu certo. */
export async function recordEvent(db: StudentsDb, event: StudentEventInsert) {
  const { error } = await db.from("student_events").insert({
    entity_id: event.entity_id ?? null,
    entity_type: event.entity_type ?? null,
    event_type: event.event_type,
    metadata: event.metadata ?? {},
    user_id: event.user_id
  });

  if (error) {
    console.error(`[alunos] evento ${event.event_type} nao gravado: ${error.message}`);
  }
}

/** Linhas sem chave estrangeira para auth.users (user_id em texto): somem com o aluno. */
export async function deleteStudentRows(db: StudentsDb, userId: string) {
  for (const table of ["lesson_progress", "saved_items"] as const) {
    const { error } = await db.from(table).delete().eq("user_id", userId);
    failOnError(error, "Excluir dados do aluno");
  }
}

const AVATAR_BUCKET = "content-assets";

/** Fotos de perfil que o aluno subiu (avatars/<id>/...). Erro aqui so vira log. */
export async function removeAvatarFiles(db: StudentsDb, userId: string) {
  try {
    const folder = `avatars/${userId}`;
    const { data, error } = await db.storage.from(AVATAR_BUCKET).list(folder, { limit: 100 });

    if (error || !data?.length) {
      return;
    }

    await db.storage.from(AVATAR_BUCKET).remove(data.map((file) => `${folder}/${file.name}`));
  } catch (error) {
    console.error(`[alunos] foto de perfil nao removida: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Perfil orfao (conta ja apagada no painel): some junto na exclusao. */
export async function deleteProfile(db: StudentsDb, userId: string) {
  const { error } = await db.from("profiles").delete().eq("id", userId);
  failOnError(error, "Excluir perfil");
}
