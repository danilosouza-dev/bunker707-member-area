import "server-only";

// Leituras das telas de Alunos (docs/17 §1.7). Lista, perfil e seletor de alunos.
//
// A lista monta ritmo, produtos e progresso em memoria a partir de profiles + entitlements +
// lesson_progress (+ aulas publicadas por produto). Para a escala prevista (centenas a poucos
// milhares de alunos) isso e simples e rapido o bastante; se a base crescer, o mesmo calculo vira
// uma funcao SQL com paginacao no banco sem mudar as telas.

import { coverUrlOf } from "@/server/catalog/mappers";
import { formatFromKind, resolveProductAccent } from "@/server/catalog/model";
import { listProductOptions } from "@/server/catalog/queries";
import { accountSummaryOf, getAccountById } from "./accounts";
import {
  accessStateOf,
  isAccessOpen,
  paceOf,
  sourceProviderLabel,
  type EntitlementTargetType,
  type StudentAccessItem,
  type StudentDetail,
  type StudentListItem,
  type StudentListPage,
  type StudentListQuery,
  type StudentOption,
  type StudentProductChip,
  type StudentProgressItem,
  type StudentTimelineEvent
} from "./model";
import {
  fetchContentKinds,
  fetchEntitlements,
  fetchEvents,
  fetchProfile,
  fetchProfiles,
  fetchProgressRows,
  fetchPublishedLessonIndex,
  fetchStaffUserIds,
  likeContains,
  studentsDb,
  type EntitlementRow,
  type EventRow,
  type ProfileRow,
  type ProgressRow,
  type StudentsDb
} from "./store";

const NO_NAME = "Sem nome";
const OPTIONS_LIMIT = 20;

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
 * Lista
 * ---------------------------------------------------------------------------------------------- */

export async function listStudents(query: StudentListQuery): Promise<StudentListPage> {
  const db = studentsDb();
  const now = Date.now();
  const [profiles, staff, entitlements, progressRows, lessonIndex] = await Promise.all([
    fetchProfiles(db),
    fetchStaffUserIds(db),
    fetchEntitlements(db),
    fetchProgressRows(db),
    fetchPublishedLessonIndex(db)
  ]);
  const openRows = entitlements.filter((row) => isOpenRow(row, now));
  const openByUser = groupBy(openRows, (row) => row.user_id);
  const progressByUser = groupBy(progressRows, (row) => row.user_id);
  const chipIndex = await buildChipIndex(db, openRows.map((row) => row.target_id));
  const search = query.q ? normalizeText(query.q) : "";

  const items = profiles.flatMap((profile): StudentListItem[] => {
    const email = profile.email?.trim().toLowerCase() ?? "";
    const fullName = displayName(profile);

    if (search && !normalizeText(fullName).includes(search) && !normalizeText(email).includes(search)) {
      return [];
    }

    const open = openByUser.get(profile.id) ?? [];
    const hasPlatform = open.some((row) => row.target_type === "platform");

    if (query.productId && !hasPlatform && !open.some((row) => row.target_id === query.productId)) {
      return [];
    }

    const rows = progressByUser.get(profile.id) ?? [];
    const contentIds = query.productId && !hasPlatform ? [query.productId] : openContentIds(open, lessonIndex);
    const totals = studyTotals(contentIds, rows, lessonIndex);
    const lastStudiedAt = lastStudiedIn(rows, query.productId);
    const pace = paceOf({ completedLessons: totals.completed, lastStudiedAt, now, totalLessons: totals.total });

    if (query.pace && pace !== query.pace) {
      return [];
    }

    const products = Array.from(new Map(open.map((row) => [row.target_type === "platform" ? "platform" : row.target_id, chipFor(chipIndex, row.target_type, row.target_id)])).values())
      .filter((chip): chip is StudentProductChip => Boolean(chip))
      .sort((left, right) => left.title.localeCompare(right.title, "pt-BR"));

    return [{
      avatarUrl: profile.avatar_url?.trim() || null,
      completedLessons: totals.completed,
      createdAt: profile.created_at,
      email,
      fullName,
      id: profile.id,
      isStaff: staff.has(profile.id),
      lastStudiedAt,
      pace,
      products,
      totalLessons: totals.total
    }];
  });

  const page = Math.max(1, query.page);
  const start = (page - 1) * query.pageSize;

  return {
    items: items.slice(start, start + query.pageSize),
    page,
    pageSize: query.pageSize,
    total: items.length
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
  access_revoked: (_meta, title) => `Acesso revogado: ${title ?? "produto"}`,
  access_suspended: (_meta, title) => `Acesso suspenso: ${title ?? "produto"}`,
  account_created: (meta) => (meta.source === "webhook" ? `Conta criada pela venda${providerSuffix(meta)}` : "Conta criada pela equipe"),
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
  const [profile, account, staff, entitlements, progressRows, lessonIndex, events] = await Promise.all([
    fetchProfile(db, userId),
    getAccountById(db, userId),
    fetchStaffUserIds(db),
    fetchEntitlements(db, { userId }),
    fetchProgressRows(db, userId),
    fetchPublishedLessonIndex(db),
    fetchEvents(db, userId)
  ]);

  if (!profile && !account) {
    return null;
  }

  const chipIndex = await buildChipIndex(db, entitlements.map((row) => row.target_id));
  const accountMetadata = (account?.user_metadata ?? {}) as { full_name?: unknown };
  const email = (profile?.email ?? account?.email ?? "").trim().toLowerCase();
  const fullName =
    profile?.full_name?.trim() || (typeof accountMetadata.full_name === "string" ? accountMetadata.full_name.trim() : "") || NO_NAME;

  const accesses = entitlements
    .map((row): StudentAccessItem => ({
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
