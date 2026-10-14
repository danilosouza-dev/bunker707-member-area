import "server-only";

// Leituras das telas de Alunos (docs/17 §1.7). Lista, segmentos, perfil, seletor, exportacao e ciclo
// de vida.
//
// Um INDICE POR REQUISICAO (React.cache): perfis, equipe, acessos, progresso, aulas publicadas, turmas
// e top comentadores sao lidos uma vez e viram itens prontos; lista, contagens dos segmentos e
// exportacao filtram esses itens. Para a escala prevista (centenas a poucos milhares de alunos) isso
// e simples e rapido; acima de ~5 mil linhas lidas o log avisa e a leitura passa a ser uma RPC sem
// mudar as telas (o calculo esta separado em buildStudentIndex -> filterStudentItems).

import { cache } from "react";
import { coverUrlOf } from "@/server/catalog/mappers";
import { formatFromKind, resolveProductAccent } from "@/server/catalog/model";
import { listProductOptions } from "@/server/catalog/queries";
import { accountSummaryOf, getAccountById } from "./accounts";
import type { StudentExportRow } from "./export-model";
import {
  ACCESS_EXPIRING_DAYS,
  LIFECYCLE_WEEKS,
  NOT_STARTED_MAX_DAYS,
  NOT_STARTED_MIN_DAYS,
  accessStateOf,
  isAccessOpen,
  paceOf,
  sourceProviderLabel,
  type EntitlementTargetType,
  type LifecycleWeek,
  type StudentAccessItem,
  type StudentCohort,
  type StudentDetail,
  type StudentListItem,
  type StudentListPage,
  type StudentListParams,
  type StudentListQuery,
  type StudentOption,
  type StudentProductChip,
  type StudentProgressItem,
  type StudentSavedSegment,
  type StudentTimelineEvent
} from "./model";
import { normalizeStudentListParams, studentListParamsSchema } from "./schemas";
import {
  fetchApproximateActivityUntil,
  fetchApprovedCommentCounts,
  fetchCohortMemberships,
  fetchCohorts,
  fetchContentKinds,
  fetchEntitlements,
  fetchEvents,
  fetchLifecycleWeekMembers,
  fetchLifecycleWeeks,
  fetchProfile,
  fetchProfiles,
  fetchProgressRows,
  fetchPublishedLessonIndex,
  fetchSegments,
  fetchStaffUserIds,
  fetchTopCommenterIds,
  likeContains,
  studentsDb,
  type CohortMembershipRow,
  type EntitlementRow,
  type EventRow,
  type ProfileRow,
  type ProgressRow,
  type StudentsDb
} from "./store";

const NO_NAME = "Sem nome";
const OPTIONS_LIMIT = 20;
const DAY_MS = 86_400_000;
/** Acima disto, hora de levar o calculo para o banco (log de aviso). */
const INDEX_ROWS_WARNING = 5_000;
const INDEX_MS_WARNING = 300;

export const PLATFORM_ACCESS_CHIP: StudentProductChip = {
  accent: resolveProductAccent("platform"),
  coverUrl: null,
  format: "curso",
  id: "platform",
  title: "Acesso total"
};

/* ------------------------------------------------------------------------------------------------
 * Produtos (chips)
 * ---------------------------------------------------------------------------------------------- */

type ChipIndex = Map<string, StudentProductChip>;

/** Todos os produtos do catalogo + os ids pedidos que ficaram de fora (cursos incluidos, excluidos). */
async function buildChipIndex(db: StudentsDb, wantedIds: Iterable<string>): Promise<ChipIndex> {
  const options = await listProductOptions();
  const index: ChipIndex = new Map(
    options.map((option) => [
      option.id,
      { accent: option.accent, coverUrl: option.coverUrl, format: option.format, id: option.id, title: option.title }
    ])
  );
  const missing = Array.from(new Set(Array.from(wantedIds).filter((id) => id !== "platform" && !index.has(id))));

  for (const row of await fetchContentKinds(db, missing)) {
    index.set(row.id, {
      accent: resolveProductAccent(row.id),
      coverUrl: coverUrlOf(row.image),
      format: formatFromKind(row.kind) ?? "curso",
      id: row.id,
      title: row.title
    });
  }

  return index;
}

function chipFor(index: ChipIndex, targetType: EntitlementTargetType, targetId: string) {
  return targetType === "platform" ? PLATFORM_ACCESS_CHIP : (index.get(targetId) ?? null);
}

/* ------------------------------------------------------------------------------------------------
 * Estudo (progresso, ultimo estudo, ritmo)
 * ---------------------------------------------------------------------------------------------- */

type LessonIndex = Map<string, Set<string>>;

function isOpenRow(row: EntitlementRow, now: number) {
  return isAccessOpen(accessStateOf({ endsAt: row.ends_at, now, startsAt: row.starts_at, status: row.status }));
}

/** Ids de conteudo que o aluno pode estudar agora ("platform" abre tudo que tem aula). */
function openContentIds(openRows: EntitlementRow[], lessonIndex: LessonIndex) {
  if (openRows.some((row) => row.target_type === "platform")) {
    return Array.from(lessonIndex.keys());
  }

  return Array.from(new Set(openRows.map((row) => row.target_id)));
}

function completedIn(contentId: string, rows: ProgressRow[], lessonIndex: LessonIndex) {
  const published = lessonIndex.get(contentId);

  if (!published) {
    return 0;
  }

  const completed = new Set<string>();

  for (const row of rows) {
    if (row.content_id !== contentId) {
      continue;
    }

    for (const lessonId of row.completed_lesson_ids ?? []) {
      if (published.has(lessonId)) {
        completed.add(lessonId);
      }
    }
  }

  return completed.size;
}

function lastStudiedIn(rows: ProgressRow[], contentId?: string) {
  let latest: string | null = null;

  for (const row of rows) {
    if (contentId && row.content_id !== contentId) {
      continue;
    }

    if (!latest || row.updated_at > latest) {
      latest = row.updated_at;
    }
  }

  return latest;
}

function studyTotals(contentIds: string[], rows: ProgressRow[], lessonIndex: LessonIndex) {
  let completed = 0;
  let total = 0;

  for (const contentId of contentIds) {
    total += lessonIndex.get(contentId)?.size ?? 0;
    completed += completedIn(contentId, rows, lessonIndex);
  }

  return { completed, total };
}

function groupBy<Row>(rows: Row[], key: (row: Row) => string) {
  const groups = new Map<string, Row[]>();

  for (const row of rows) {
    const id = key(row);
    const group = groups.get(id);

    if (group) {
      group.push(row);
    } else {
      groups.set(id, [row]);
    }
  }

  return groups;
}

function displayName(profile: Pick<ProfileRow, "email" | "full_name">) {
  return profile.full_name?.trim() || NO_NAME;
}

/** Busca sem acento e sem maiusculas ("joao" acha "João"). */
function normalizeText(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/* ------------------------------------------------------------------------------------------------
 * Indice por requisicao
 * ---------------------------------------------------------------------------------------------- */

type StudentIndexEntry = {
  item: StudentListItem;
  /** Acessos abertos agora (para filtros de produto, prazo e "comprou e nao comecou"). */
  openRows: EntitlementRow[];
  phone: string | null;
  progressRows: ProgressRow[];
};

export type StudentIndex = {
  chipIndex: ChipIndex;
  cohorts: StudentCohort[];
  entries: StudentIndexEntry[];
  lessonIndex: LessonIndex;
  now: number;
  topCommenterIds: Set<string>;
};

/** Tudo que a lista precisa, lido uma vez por requisicao. */
export const buildStudentIndex = cache(async (): Promise<StudentIndex> => {
  const db = studentsDb();
  const started = Date.now();
  const now = started;
  const [profiles, staff, entitlements, progressRows, lessonIndex, cohorts, memberships, topCommenterIds] = await Promise.all([
    fetchProfiles(db),
    fetchStaffUserIds(db),
    fetchEntitlements(db),
    fetchProgressRows(db),
    fetchPublishedLessonIndex(db),
    fetchCohorts(db),
    fetchCohortMemberships(db),
    fetchTopCommenterIds(db).catch((error: unknown) => {
      console.error("[alunos] top comentadores indisponiveis:", error instanceof Error ? error.message : String(error));
      return new Set<string>();
    })
  ]);
  const openRows = entitlements.filter((row) => isOpenRow(row, now));
  const openByUser = groupBy(openRows, (row) => row.user_id);
  const progressByUser = groupBy(progressRows, (row) => row.user_id);
  const membershipsByUser = groupBy(memberships, (row) => row.user_id);
  const cohortById = new Map(cohorts.map((cohort) => [cohort.id, cohort] as const));
  const chipIndex = await buildChipIndex(db, openRows.map((row) => row.target_id));

  const entries = profiles.map((profile): StudentIndexEntry => {
    const open = openByUser.get(profile.id) ?? [];
    const rows = progressByUser.get(profile.id) ?? [];
    const contentIds = openContentIds(open, lessonIndex);
    const totals = studyTotals(contentIds, rows, lessonIndex);
    const lastStudiedAt = lastStudiedIn(rows);
    const openProductIds = new Set(contentIds);
    const products = Array.from(new Map(open.map((row) => [row.target_type === "platform" ? "platform" : row.target_id, chipFor(chipIndex, row.target_type, row.target_id)])).values())
      .filter((chip): chip is StudentProductChip => Boolean(chip))
      .sort((left, right) => left.title.localeCompare(right.title, "pt-BR"));
    const studentCohorts = (membershipsByUser.get(profile.id) ?? [])
      .filter((membership: CohortMembershipRow) => openProductIds.has(membership.product_id) && cohortById.has(membership.cohort_id))
      .map((membership) => ({ cohortId: membership.cohort_id, cohortName: cohortById.get(membership.cohort_id)!.name, productId: membership.product_id }))
      .sort((left, right) => left.cohortName.localeCompare(right.cohortName, "pt-BR"));

    return {
      item: {
        avatarUrl: profile.avatar_url?.trim() || null,
        cohorts: studentCohorts,
        completedLessons: totals.completed,
        createdAt: profile.created_at,
        email: profile.email?.trim().toLowerCase() ?? "",
        fullName: displayName(profile),
        id: profile.id,
        isStaff: staff.has(profile.id),
        lastSignInAt: profile.last_sign_in_at,
        lastStudiedAt,
        pace: paceOf({ completedLessons: totals.completed, lastStudiedAt, now, totalLessons: totals.total }),
        products,
        totalLessons: totals.total
      },
      openRows: open,
      phone: profile.phone?.trim() || null,
      progressRows: rows
    };
  });

  const rowsRead = profiles.length + entitlements.length + progressRows.length + memberships.length;
  const elapsed = Date.now() - started;

  if (rowsRead > INDEX_ROWS_WARNING || elapsed > INDEX_MS_WARNING) {
    console.warn(`[alunos] indice com ${rowsRead} linhas em ${elapsed} ms: hora de mover o calculo para uma RPC.`);
  }

  return { chipIndex, cohorts, entries, lessonIndex, now, topCommenterIds };
});

/* ------------------------------------------------------------------------------------------------
 * Filtros
 * ---------------------------------------------------------------------------------------------- */

type FilterContext = { lifecycleMembers?: Set<string> | null };

function matchesParams(entry: StudentIndexEntry, params: StudentListParams, index: StudentIndex, context: FilterContext) {
  const { item } = entry;
  const now = index.now;

  if (params.q) {
    const search = normalizeText(params.q);

    if (!normalizeText(item.fullName).includes(search) && !normalizeText(item.email).includes(search)) {
      return false;
    }
  }

  const hasPlatform = entry.openRows.some((row) => row.target_type === "platform");

  if (params.productId && !hasPlatform && !entry.openRows.some((row) => row.target_id === params.productId)) {
    return false;
  }

  if (params.cohortId && !item.cohorts.some((membership) => membership.cohortId === params.cohortId && (!params.productId || membership.productId === params.productId))) {
    return false;
  }

  if (params.expiring) {
    const expiring = entry.openRows.some((row) => {
      if (!row.ends_at || (params.productId && row.target_id !== params.productId)) {
        return false;
      }

      const remaining = Date.parse(row.ends_at) - now;

      return remaining > 0 && remaining <= ACCESS_EXPIRING_DAYS * DAY_MS;
    });

    if (!expiring) {
      return false;
    }
  }

  if (params.account === "never" && item.lastSignInAt) {
    return false;
  }

  if (params.notStarted) {
    const hasProgress = entry.progressRows.length > 0;
    const recentAccess = entry.openRows.some((row) => {
      const age = now - Date.parse(row.starts_at);

      return age >= NOT_STARTED_MIN_DAYS * DAY_MS && age <= NOT_STARTED_MAX_DAYS * DAY_MS;
    });

    if (hasProgress || !recentAccess) {
      return false;
    }
  }

  if (params.commenters === "top" && !index.topCommenterIds.has(item.id)) {
    return false;
  }

  if (params.week && params.group) {
    if (!context.lifecycleMembers || !context.lifecycleMembers.has(item.id)) {
      return false;
    }
  }

  return true;
}

/** Ritmo e o ultimo filtro: com produto escolhido, ritmo e progresso valem para aquele produto. */
function itemFor(entry: StudentIndexEntry, params: StudentListParams, index: StudentIndex): StudentListItem {
  if (!params.productId) {
    return entry.item;
  }

  const hasPlatform = entry.openRows.some((row) => row.target_type === "platform");
  const contentIds = hasPlatform ? openContentIds(entry.openRows, index.lessonIndex) : [params.productId];
  const totals = studyTotals(contentIds, entry.progressRows, index.lessonIndex);
  const lastStudiedAt = lastStudiedIn(entry.progressRows, hasPlatform ? undefined : params.productId);

  return {
    ...entry.item,
    completedLessons: totals.completed,
    lastStudiedAt,
    pace: paceOf({ completedLessons: totals.completed, lastStudiedAt, now: index.now, totalLessons: totals.total }),
    totalLessons: totals.total
  };
}

async function lifecycleMembersFor(params: StudentListParams): Promise<Set<string> | null> {
  if (!params.week || !params.group) {
    return null;
  }

  return fetchLifecycleWeekMembers(studentsDb(), params.week, params.group);
}

export function filterStudentItems(index: StudentIndex, params: StudentListParams, context: FilterContext = {}): StudentListItem[] {
  const items: StudentListItem[] = [];

  for (const entry of index.entries) {
    if (!matchesParams(entry, params, index, context)) {
      continue;
    }

    const item = itemFor(entry, params, index);

    if (params.pace && item.pace !== params.pace) {
      continue;
    }

    items.push(item);
  }

  return items;
}

/* ------------------------------------------------------------------------------------------------
 * Lista, segmentos, exportacao
 * ---------------------------------------------------------------------------------------------- */

export async function listStudents(query: StudentListQuery): Promise<StudentListPage> {
  const { page: rawPage, pageSize, ...params } = query;
  const [index, lifecycleMembers] = await Promise.all([buildStudentIndex(), lifecycleMembersFor(params)]);
  const items = filterStudentItems(index, params, { lifecycleMembers });
  const page = Math.max(1, rawPage);
  const start = (page - 1) * pageSize;

  return { items: items.slice(start, start + pageSize), page, pageSize, total: items.length };
}

export type StudentSegmentCount = { id: string; total: number };

/** Contagem de cada segmento (prontos e salvos) a partir do mesmo indice. */
export async function countStudentSegments(segments: readonly { id: string; params: StudentListParams }[]): Promise<StudentSegmentCount[]> {
  const index = await buildStudentIndex();

  return segments.map((segment) => ({ id: segment.id, total: filterStudentItems(index, segment.params).length }));
}

export async function listSavedSegments(): Promise<StudentSavedSegment[]> {
  const rows = await fetchSegments(studentsDb());

  return rows.map((row) => {
    const parsed = studentListParamsSchema.safeParse(row.params ?? {});

    return {
      createdAt: row.created_at,
      id: row.id,
      name: row.name,
      params: parsed.success ? normalizeStudentListParams(parsed.data) : {}
    };
  });
}

export async function listCohorts(): Promise<StudentCohort[]> {
  return fetchCohorts(studentsDb());
}

/** Linhas da exportacao (docs/17 §1.7.4): o filtro atual ou uma selecao de ids; a equipe fica de fora. */
export async function listStudentsForExport(input: { ids?: string[]; params: StudentListParams }): Promise<StudentExportRow[]> {
  const db = studentsDb();
  const [index, lifecycleMembers, commentCounts] = await Promise.all([
    buildStudentIndex(),
    lifecycleMembersFor(input.params),
    fetchApprovedCommentCounts(db)
  ]);
  const selected = input.ids ? new Set(input.ids) : null;
  const rows: StudentExportRow[] = [];

  for (const entry of index.entries) {
    if (entry.item.isStaff) {
      continue;
    }

    if (selected ? !selected.has(entry.item.id) : !matchesParams(entry, input.params, index, { lifecycleMembers })) {
      continue;
    }

    const item = itemFor(entry, selected ? {} : input.params, index);

    if (!selected && input.params.pace && item.pace !== input.params.pace) {
      continue;
    }

    const progressByProduct = item.products
      .filter((product) => product.id !== "platform")
      .map((product) => `${product.title}: ${completedIn(product.id, entry.progressRows, index.lessonIndex)} de ${index.lessonIndex.get(product.id)?.size ?? 0}`);

    rows.push({ ...item, comments28d: commentCounts.get(item.id) ?? 0, phone: entry.phone, progressByProduct });
  }

  return rows;
}

/* ------------------------------------------------------------------------------------------------
 * Ciclo de vida semanal (classificado no banco)
 * ---------------------------------------------------------------------------------------------- */

export type LifecycleSummary = { approximateUntil: string | null; weeks: LifecycleWeek[] };

export async function getLifecycleSummary(): Promise<LifecycleSummary> {
  const db = studentsDb();
  const [rows, approximateUntil] = await Promise.all([fetchLifecycleWeeks(db, LIFECYCLE_WEEKS), fetchApproximateActivityUntil(db)]);

  return {
    approximateUntil,
    weeks: rows.map((row) => ({
      inactiveCount: Number(row.inactive_count ?? 0),
      newCount: Number(row.new_count ?? 0),
      recoveredCount: Number(row.recovered_count ?? 0),
      retainedCount: Number(row.retained_count ?? 0),
      weekStart: row.week_start
    }))
  };
}

/* ------------------------------------------------------------------------------------------------
 * Perfil
 * ---------------------------------------------------------------------------------------------- */

const ACCESS_ORDER: Record<StudentAccessItem["state"], number> = {
  active: 0,
  expiring: 0,
  scheduled: 1,
  suspended: 2,
  expired: 3,
  revoked: 4
};

type EventText = (meta: Record<string, unknown>, productTitle: string | null) => string;

function providerSuffix(meta: Record<string, unknown>) {
  return meta.source === "webhook" && typeof meta.source_provider === "string"
    ? ` (${sourceProviderLabel(meta.source_provider)})`
    : "";
}

const EVENT_TEXTS: Record<string, EventText> = {
  access_email_sent: () => "E-mail de acesso enviado",
  access_extended: (_meta, title) => (title ? `Prazo do acesso a ${title} alterado` : "Prazo de um acesso alterado"),
  access_granted: (meta, title) => `Acesso liberado: ${title ?? "produto"}${providerSuffix(meta)}`,
  access_reactivated: (_meta, title) => `Acesso reativado: ${title ?? "produto"}`,
  access_restored: (_meta, title) => `Ação em massa desfeita: ${title ?? "produto"}`,
  access_revoked: (_meta, title) => `Acesso revogado: ${title ?? "produto"}`,
  access_suspended: (_meta, title) => `Acesso suspenso: ${title ?? "produto"}`,
  account_created: (meta) =>
    meta.source === "webhook" ? `Conta criada pela venda${providerSuffix(meta)}` : meta.via === "import" ? "Conta criada por importação" : "Conta criada pela equipe",
  cohort_changed: (_meta, title) => (title ? `Turma alterada em ${title}` : "Turma alterada"),
  password_changed: () => "Senha alterada",
  profile_updated: () => "Dados atualizados pela equipe",
  temporary_password_created: () => "Senha temporária criada pela equipe",
  user_signed_in: () => "Entrou na plataforma"
};

function eventText(event: EventRow, chipIndex: ChipIndex) {
  const meta = event.metadata ?? {};
  const productId = typeof meta.product_id === "string" ? meta.product_id : null;
  const title = productId
    ? (chipIndex.get(productId)?.title ?? (typeof meta.product_title === "string" ? meta.product_title : null))
    : null;
  const render = EVENT_TEXTS[event.event_type];

  return render ? render(meta, title) : event.event_type.replace(/_/g, " ");
}

export async function getStudentDetail(userId: string): Promise<StudentDetail | null> {
  const db = studentsDb();
  const now = Date.now();
  const [profile, account, staff, entitlements, progressRows, lessonIndex, events, memberships, cohorts] = await Promise.all([
    fetchProfile(db, userId),
    getAccountById(db, userId),
    fetchStaffUserIds(db),
    fetchEntitlements(db, { userId }),
    fetchProgressRows(db, userId),
    fetchPublishedLessonIndex(db),
    fetchEvents(db, userId),
    fetchCohortMemberships(db, { userIds: [userId] }),
    fetchCohorts(db)
  ]);

  if (!profile && !account) {
    return null;
  }

  const chipIndex = await buildChipIndex(db, entitlements.map((row) => row.target_id));
  const cohortById = new Map(cohorts.map((cohort) => [cohort.id, cohort] as const));
  const cohortByProduct = new Map(memberships.map((membership) => [membership.product_id, cohortById.get(membership.cohort_id) ?? null] as const));
  const accountMetadata = (account?.user_metadata ?? {}) as { full_name?: unknown };
  const email = (profile?.email ?? account?.email ?? "").trim().toLowerCase();
  const fullName =
    profile?.full_name?.trim() || (typeof accountMetadata.full_name === "string" ? accountMetadata.full_name.trim() : "") || NO_NAME;

  const accesses = entitlements
    .map((row): StudentAccessItem => ({
      cohort: cohortByProduct.get(row.target_id) ?? null,
      endsAt: row.ends_at,
      id: row.id,
      product: chipFor(chipIndex, row.target_type, row.target_id),
      sourceProvider: row.source_provider,
      startsAt: row.starts_at,
      state: accessStateOf({ endsAt: row.ends_at, now, startsAt: row.starts_at, status: row.status }),
      status: row.status,
      targetId: row.target_id,
      targetType: row.target_type
    }))
    .sort((left, right) => ACCESS_ORDER[left.state] - ACCESS_ORDER[right.state] || right.startsAt.localeCompare(left.startsAt));

  const openRows = entitlements.filter((row) => isOpenRow(row, now));
  const contentIds = openContentIds(openRows, lessonIndex);
  const progress = contentIds
    .flatMap((contentId): StudentProgressItem[] => {
      const chip = chipIndex.get(contentId);

      return chip
        ? [{
            completedLessons: completedIn(contentId, progressRows, lessonIndex),
            lastStudiedAt: lastStudiedIn(progressRows, contentId),
            product: chip,
            totalLessons: lessonIndex.get(contentId)?.size ?? 0
          }]
        : [];
    })
    .sort((left, right) => (right.lastStudiedAt ?? "").localeCompare(left.lastStudiedAt ?? "") || left.product.title.localeCompare(right.product.title, "pt-BR"));

  const totals = studyTotals(contentIds, progressRows, lessonIndex);
  const lastStudiedAt = lastStudiedIn(progressRows);
  const timeline: StudentTimelineEvent[] = events.map((event) => ({ at: event.occurred_at, id: event.id, text: eventText(event, chipIndex) }));
  const eventEntitlementIds = new Set(events.filter((event) => event.entity_type === "entitlement").map((event) => event.entity_id));

  for (const row of entitlements) {
    if (!eventEntitlementIds.has(row.id)) {
      const title = chipFor(chipIndex, row.target_type, row.target_id)?.title ?? "produto";
      timeline.push({ at: row.created_at, id: `entitlement:${row.id}`, text: `Acesso liberado: ${title} (${sourceProviderLabel(row.source_provider)})` });
    }
  }

  if (account) {
    timeline.push({ at: account.created_at, id: "account:created", text: "Conta criada" });
  }

  timeline.sort((left, right) => right.at.localeCompare(left.at));

  return {
    accesses,
    account: account ? accountSummaryOf(account) : null,
    avatarUrl: profile?.avatar_url?.trim() || null,
    createdAt: profile?.created_at ?? account?.created_at ?? new Date(now).toISOString(),
    email,
    fullName,
    id: userId,
    isStaff: staff.has(userId),
    lastStudiedAt,
    pace: paceOf({ completedLessons: totals.completed, lastStudiedAt, now, totalLessons: totals.total }),
    phone: profile?.phone?.trim() || null,
    progress,
    timeline
  };
}

/* ------------------------------------------------------------------------------------------------
 * Seletor "Liberar acesso para..." (aba Alunos do produto)
 * ---------------------------------------------------------------------------------------------- */

export async function listStudentOptions(input: { productId?: string | null; q: string }): Promise<StudentOption[]> {
  const db = studentsDb();
  const search = input.q.trim().replace(/[,()]/g, " ").trim();
  let query = db.from("profiles").select("id,email,full_name,avatar_url").order("full_name", { ascending: true }).limit(OPTIONS_LIMIT);

  if (search) {
    const pattern = likeContains(search.slice(0, 80));
    query = query.or(`full_name.ilike.${pattern},email.ilike.${pattern}`);
  }

  const [{ data, error }, accessRows] = await Promise.all([
    query,
    input.productId ? fetchEntitlements(db, { targetId: input.productId }) : Promise.resolve([] as EntitlementRow[])
  ]);

  if (error) {
    throw new Error(`Alunos para liberar acesso: ${error.message}`);
  }

  const now = Date.now();
  const withAccess = new Set(accessRows.filter((row) => isOpenRow(row, now)).map((row) => row.user_id));

  return ((data ?? []) as Pick<ProfileRow, "avatar_url" | "email" | "full_name" | "id">[]).map((row) => ({
    avatarUrl: row.avatar_url?.trim() || null,
    email: row.email?.trim().toLowerCase() ?? "",
    fullName: displayName(row),
    hasAccess: withAccess.has(row.id),
    id: row.id
  }));
}
