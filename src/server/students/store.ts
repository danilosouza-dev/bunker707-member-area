import "server-only";

// Acesso ao banco de Alunos: leituras com colunas explicitas e escritas de UMA linha por vez
// (docs/13). Tabelas: profiles (nome, telefone, foto), admin_roles (equipe), entitlements (acessos),
// lesson_progress (estudo), course_modules/lessons (total de aulas por produto) e student_events
// (historico). Sempre com a chave de servico, so a partir de Server Actions e paginas do admin que
// ja passaram por requireRole/requirePageAdmin.

import { isMissingSchemaObjectError, toDbError } from "@/server/db/pending-migration";
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

export const PROFILE_COLUMNS = "id,email,full_name,phone,avatar_url,created_at,last_sign_in_at";

export type ProfileRow = {
  avatar_url: string | null;
  created_at: string;
  email: string | null;
  full_name: string | null;
  id: string;
  last_sign_in_at: string | null;
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

type CountOption = { count: "exact" } | undefined;
type PageResult = { count?: number | null; data: unknown; error: DbError };

/**
 * Le todas as linhas em paginas de 1000 (limite do PostgREST): a primeira pagina pede o total e as
 * demais vem em paralelo. Teto para nao estourar memoria; acima dele a tela avisa (nunca corta em
 * silencio) e e hora de levar o calculo para uma RPC.
 */
async function fetchAll<Row>(
  context: string,
  page: (from: number, to: number, count: CountOption) => PromiseLike<PageResult>
): Promise<Row[]> {
  const first = await page(0, PAGE_SIZE - 1, { count: "exact" });
  failOnError(first.error, context);
  const rows = (first.data ?? []) as Row[];
  const total = typeof first.count === "number" ? first.count : rows.length;

  if (total > MAX_ROWS) {
    throw new Error(`${context}: mais de ${MAX_ROWS} linhas; a lista precisa ser calculada no banco.`);
  }

  if (total <= rows.length) {
    return rows;
  }

  const starts: number[] = [];

  for (let from = PAGE_SIZE; from < total; from += PAGE_SIZE) {
    starts.push(from);
  }

  const pages = await Promise.all(starts.map((from) => page(from, from + PAGE_SIZE - 1, undefined)));

  for (const result of pages) {
    failOnError(result.error, context);
    rows.push(...((result.data ?? []) as Row[]));
  }

  return rows;
}

export function fetchProfiles(db: StudentsDb) {
  return fetchAll<ProfileRow>("Alunos", (from, to, count) =>
    db.from("profiles").select(PROFILE_COLUMNS, count).order("created_at", { ascending: false }).order("id").range(from, to)
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

/** A conta e da equipe (admin_roles)? Senha, convite e dados da equipe nao mudam por Alunos. */
export async function isStaffUser(db: StudentsDb, userId: string): Promise<boolean> {
  const { data, error } = await db.from("admin_roles").select("user_id").eq("user_id", userId).maybeSingle();
  failOnError(error, "Equipe");

  return Boolean(data);
}

export async function fetchStaffUserIds(db: StudentsDb): Promise<Set<string>> {
  const { data, error } = await db.from("admin_roles").select("user_id");
  failOnError(error, "Equipe");

  return new Set(((data ?? []) as { user_id: string }[]).map((row) => row.user_id));
}

export function fetchEntitlements(db: StudentsDb, filter: { targetId?: string; userId?: string; userIds?: string[] } = {}) {
  return fetchAll<EntitlementRow>("Acessos", (from, to, count) => {
    let query = db.from("entitlements").select(ENTITLEMENT_COLUMNS, count).order("created_at", { ascending: false }).order("id");

    if (filter.userId) {
      query = query.eq("user_id", filter.userId);
    }

    if (filter.userIds) {
      query = query.in("user_id", filter.userIds);
    }

    if (filter.targetId) {
      query = query.eq("target_id", filter.targetId);
    }

    return query.range(from, to);
  });
}

export async function fetchEntitlementsByIds(db: StudentsDb, entitlementIds: readonly string[]): Promise<EntitlementRow[]> {
  if (entitlementIds.length === 0) {
    return [];
  }

  const { data, error } = await db.from("entitlements").select(ENTITLEMENT_COLUMNS).in("id", [...entitlementIds]);
  failOnError(error, "Acessos");

  return (data ?? []) as EntitlementRow[];
}

/**
 * A equipe mexeu num acesso (revogou, suspendeu, reativou ou reabriu): TODOS os vinculos de venda dele
 * (sale_grants, migracao 202610170008) passam a closed_by = admin e deixam de mandar nos reembolsos, os
 * abertos e tambem os que uma venda ja tinha fechado (senao o reembolso repetido de uma compra antiga
 * fecharia o que a equipe acabou de reabrir). Banco sem a tabela nao impede a acao da equipe.
 */
export async function closeSaleGrantsByTeam(db: StudentsDb, entitlementIds: readonly string[]) {
  if (entitlementIds.length === 0) {
    return;
  }

  const ids = [...entitlementIds];
  const [open, closed] = await Promise.all([
    db.from("sale_grants").update({ closed_at: new Date().toISOString(), closed_by: "admin" }).in("entitlement_id", ids).is("closed_at", null),
    db.from("sale_grants").update({ closed_by: "admin" }).in("entitlement_id", ids).not("closed_at", "is", null).neq("closed_by", "admin")
  ]);

  for (const { error } of [open, closed]) {
    if (error && !isMissingSchemaObjectError(error)) {
      console.error(`[alunos] vinculos de venda nao fechados pela equipe: ${error.message}`);
    }
  }
}

export async function fetchEntitlement(db: StudentsDb, entitlementId: string): Promise<EntitlementRow | null> {
  const { data, error } = await db.from("entitlements").select(ENTITLEMENT_COLUMNS).eq("id", entitlementId).maybeSingle();
  failOnError(error, "Acesso");

  return (data ?? null) as EntitlementRow | null;
}

export function fetchProgressRows(db: StudentsDb, userId?: string) {
  return fetchAll<ProgressRow>("Progresso dos alunos", (from, to, count) => {
    let query = db.from("lesson_progress").select("user_id,content_id,completed_lesson_ids,updated_at", count).order("id");

    if (userId) {
      query = query.eq("user_id", userId);
    }

    return query.range(from, to);
  });
}

/** Aulas publicadas (em modulos publicados) por produto: Map<contentId, Set<lessonId>>. */
export async function fetchPublishedLessonIndex(db: StudentsDb): Promise<Map<string, Set<string>>> {
  const [modules, lessons] = await Promise.all([
    fetchAll<{ id: string; owner_id: string }>("Módulos", (from, to, count) =>
      db.from("course_modules").select("id,owner_id", count).eq("status", "published").order("id").range(from, to)
    ),
    fetchAll<{ id: string; module_id: string }>("Aulas", (from, to, count) =>
      db.from("lessons").select("id,module_id", count).eq("status", "published").order("id").range(from, to)
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
  patch: Partial<Pick<EntitlementRow, "ends_at" | "source_event_id" | "source_provider" | "starts_at" | "status">>
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

/* ------------------------------------------------------------------------------------------------
 * Entrega 2: turmas, segmentos, auditoria, atividade e consultas de apoio
 * ---------------------------------------------------------------------------------------------- */

export type CohortRow = { id: string; name: string };
export type CohortMembershipRow = { cohort_id: string; product_id: string; user_id: string };
export type SegmentRow = { created_at: string; id: string; name: string; params: Record<string, unknown> | null };
export type LifecycleWeekRow = {
  inactive_count: number;
  new_count: number;
  recovered_count: number;
  retained_count: number;
  week_start: string;
};

export async function fetchCohorts(db: StudentsDb): Promise<CohortRow[]> {
  const { data, error } = await db.from("cohorts").select("id,name").order("name", { ascending: true });
  failOnError(error, "Turmas");

  return (data ?? []) as CohortRow[];
}

export async function insertCohort(db: StudentsDb, name: string): Promise<CohortRow> {
  const { data, error } = await db.from("cohorts").insert({ name }).select("id,name").single();
  failOnError(error, "Criar turma");

  return data as CohortRow;
}

export function fetchCohortMemberships(db: StudentsDb, filter: { productId?: string; userIds?: string[] } = {}) {
  return fetchAll<CohortMembershipRow>("Turmas dos alunos", (from, to, count) => {
    let query = db.from("cohort_memberships").select("user_id,product_id,cohort_id", count).order("id");

    if (filter.productId) {
      query = query.eq("product_id", filter.productId);
    }

    if (filter.userIds) {
      query = query.in("user_id", filter.userIds);
    }

    return query.range(from, to);
  });
}

export async function upsertCohortMembership(
  db: StudentsDb,
  membership: { actorId: string | null; cohortId: string; productId: string; userId: string }
) {
  const { error } = await db
    .from("cohort_memberships")
    .upsert(
      { cohort_id: membership.cohortId, created_by: membership.actorId, product_id: membership.productId, user_id: membership.userId },
      { onConflict: "user_id,product_id" }
    );
  failOnError(error, "Turma do aluno");
}

export async function deleteCohortMembership(db: StudentsDb, userId: string, productId: string) {
  const { error } = await db.from("cohort_memberships").delete().eq("user_id", userId).eq("product_id", productId);
  failOnError(error, "Tirar da turma");
}

export async function fetchSegments(db: StudentsDb): Promise<SegmentRow[]> {
  const { data, error } = await db.from("student_segments").select("id,name,params,created_at").order("name", { ascending: true });
  failOnError(error, "Segmentos salvos");

  return (data ?? []) as SegmentRow[];
}

export async function insertSegment(
  db: StudentsDb,
  segment: { actorId: string; name: string; params: Record<string, unknown> }
): Promise<SegmentRow> {
  const { data, error } = await db
    .from("student_segments")
    .insert({ created_by: segment.actorId, name: segment.name, params: segment.params })
    .select("id,name,params,created_at")
    .single();
  failOnError(error, "Salvar segmento");

  return data as SegmentRow;
}

export async function deleteSegment(db: StudentsDb, segmentId: string) {
  const { error } = await db.from("student_segments").delete().eq("id", segmentId);
  failOnError(error, "Excluir segmento");
}

// Auditoria mora em src/server/audit/log.ts (tambem usada pela Equipe).
export { recordAudit, type AuditInsert } from "@/server/audit/log";

/** Linhas importadas por esta pessoa na ultima hora (teto no servidor). */
export async function countImportedLastHour(db: StudentsDb, actorId: string) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("admin_audit_log")
    .select("count")
    .eq("actor_id", actorId)
    .eq("action", "students.import_batch")
    .gte("occurred_at", since)
    .limit(1000);
  failOnError(error, "Importações da última hora");

  return ((data ?? []) as { count: number | null }[]).reduce((sum, row) => sum + (row.count ?? 0), 0);
}

export async function fetchLifecycleWeeks(db: StudentsDb, weeks: number): Promise<LifecycleWeekRow[]> {
  const { data, error } = await db.rpc("admin_lifecycle_weeks", { p_weeks: weeks });
  failOnError(error, "Ciclo de vida");

  return (data ?? []) as LifecycleWeekRow[];
}

export async function fetchLifecycleWeekMembers(db: StudentsDb, weekStart: string, group: string): Promise<Set<string>> {
  const { data, error } = await db.rpc("admin_lifecycle_week_members", { p_group: group, p_week_start: weekStart });
  failOnError(error, "Alunos da semana");

  return new Set(((data ?? []) as { user_id: string }[]).map((row) => row.user_id));
}

const TOP_COMMENTERS_WINDOW_DAYS = 28;
/** Teto da propria RPC community_top_commenters. */
const TOP_COMMENTERS_LIMIT = 100;

/** Mesma regua de Comunidade › Top alunos (community_top_commenters, 28 dias). */
export async function fetchTopCommenterIds(db: StudentsDb): Promise<Set<string>> {
  const since = new Date(Date.now() - TOP_COMMENTERS_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await db.rpc("community_top_commenters", { p_content_id: null, p_limit: TOP_COMMENTERS_LIMIT, p_since: since });
  failOnError(error, "Top comentadores");

  return new Set(((data ?? []) as { author_id: string | null }[]).map((row) => row.author_id).filter((id): id is string => Boolean(id)));
}

/** Comentarios aprovados por autor nos ultimos 28 dias (coluna do CSV). */
export async function fetchApprovedCommentCounts(db: StudentsDb): Promise<Map<string, number>> {
  const since = new Date(Date.now() - TOP_COMMENTERS_WINDOW_DAYS * 86_400_000).toISOString();
  const rows = await fetchAll<{ author_id: string | null }>("Comentários recentes", (from, to, count) =>
    db
      .from("lesson_comments")
      .select("author_id", count)
      .eq("status", "approved")
      .eq("author_role", "student")
      .is("deleted_at", null)
      .gte("created_at", since)
      .order("id")
      .range(from, to)
  );
  const counts = new Map<string, number>();

  for (const row of rows) {
    if (row.author_id) {
      counts.set(row.author_id, (counts.get(row.author_id) ?? 0) + 1);
    }
  }

  return counts;
}

export async function fetchProfilesByIds(db: StudentsDb, userIds: string[]): Promise<ProfileRow[]> {
  if (userIds.length === 0) {
    return [];
  }

  const { data, error } = await db.from("profiles").select(PROFILE_COLUMNS).in("id", userIds);
  failOnError(error, "Alunos selecionados");

  return (data ?? []) as ProfileRow[];
}

export async function fetchProfilesByEmails(db: StudentsDb, emails: string[]): Promise<ProfileRow[]> {
  if (emails.length === 0) {
    return [];
  }

  const { data, error } = await db.from("profiles").select(PROFILE_COLUMNS).in("email", emails);
  failOnError(error, "Alunos por e-mail");

  return (data ?? []) as ProfileRow[];
}

/** Preenche so o que esta vazio no perfil (importacao de conta que ja existia). */
export async function fillProfileGaps(db: StudentsDb, current: ProfileRow, patch: { fullName: string | null; phone: string | null }) {
  const next: { full_name?: string; phone?: string } = {};

  if (!current.full_name?.trim() && patch.fullName?.trim()) {
    next.full_name = patch.fullName.trim();
  }

  if (!current.phone?.trim() && patch.phone?.trim()) {
    next.phone = patch.phone.trim();
  }

  if (Object.keys(next).length === 0) {
    return false;
  }

  const { error } = await db.from("profiles").update(next).eq("id", current.id);
  failOnError(error, "Perfil do aluno");

  return true;
}

/** Varios eventos de uma vez (acoes em massa): uma ida ao banco. */
export async function recordEvents(db: StudentsDb, events: StudentEventInsert[]) {
  if (events.length === 0) {
    return;
  }

  const { error } = await db.from("student_events").insert(
    events.map((event) => ({
      entity_id: event.entity_id ?? null,
      entity_type: event.entity_type ?? null,
      event_type: event.event_type,
      metadata: event.metadata ?? {},
      user_id: event.user_id
    }))
  );

  if (error) {
    console.error(`[alunos] ${events.length} eventos nao gravados: ${error.message}`);
  }
}

/** Ultimo dia com atividade aproximada (backfill); null quando tudo ja e exato. */
export async function fetchApproximateActivityUntil(db: StudentsDb): Promise<string | null> {
  const { data, error } = await db.from("student_daily_activity").select("day").eq("approximate", true).order("day", { ascending: false }).limit(1);
  failOnError(error, "Atividade aproximada");

  return ((data ?? []) as { day: string }[])[0]?.day ?? null;
}
