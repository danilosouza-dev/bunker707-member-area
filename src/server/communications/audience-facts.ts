import "server-only";

// Fatos de cada aluno para avaliar o segmento dos avisos (src/server/communications/audience-model.ts).
// Mesmas leituras e a mesma conta da lista de Alunos (src/server/students/queries.ts, buildStudentIndex):
// acessos abertos agora, aulas publicadas concluidas sobre o que o aluno pode estudar, ultimo estudo,
// ritmo e turmas; mais os comentarios por janela (RPC communication_comment_counts). A equipe
// (admin_roles) fica de fora aqui, antes de qualquer regra: nunca entra na contagem nem recebe aviso.
//
// Leitura unica por chamada (previa no editor, publicar, job do tick); a escala prevista e de centenas a
// poucos milhares de alunos, como a lista de Alunos (que avisa quando passar a hora de ir para uma RPC).

import { sanitizeProfileAvatarUrl } from "@/server/member-area/student-pages-model";
import { accessStateOf, isAccessOpen, paceOf } from "@/server/students/model";
import {
  fetchCohortMemberships,
  fetchEntitlements,
  fetchProfiles,
  fetchProgressRows,
  fetchPublishedLessonIndex,
  fetchStaffUserIds,
  type EntitlementRow,
  type ProgressRow
} from "@/server/students/store";
import {
  buildCommentRanks,
  type AudienceCommentCounts,
  type AudienceContext,
  type AudienceStudentFacts
} from "./audience-model";
import { isMissingCommunicationSchema, type CommunicationsDb } from "./db";

export type AudiencePerson = { avatarUrl: string | null; name: string };

export type LoadedAudience = {
  context: AudienceContext;
  facts: AudienceStudentFacts[];
  /** Nome e foto de cada aluno (amostra da previa no editor). */
  people: Map<string, AudiencePerson>;
};

const NO_NAME = "Sem nome";
const ZERO_COMMENTS: AudienceCommentCounts = { d7: 0, d30: 0, d90: 0, total: 0 };

type CommentCountRow = {
  author_id: string | null;
  comments_7d: number | string | null;
  comments_30d: number | string | null;
  comments_90d: number | string | null;
  comments_total: number | string | null;
};

const count = (value: number | string | null) => Number(value ?? 0) || 0;

/** Linhas por pedido: o teto do PostgREST (max_rows = 1000) tambem corta o resultado de RPC, sem erro. */
export const COMMENT_COUNTS_PAGE = 1_000;

/**
 * Comentarios por janela, uma linha por aluno que comentou, lidos em paginas de 1000 em ordem de autor
 * (sem paginar, quem passasse do teto contaria zero e o ranking sairia errado). Banco sem a migracao
 * 202610200001 conta zero para todo mundo.
 */
export async function fetchCommentCounts(db: CommunicationsDb): Promise<Map<string, AudienceCommentCounts>> {
  const counts = new Map<string, AudienceCommentCounts>();

  for (let from = 0; ; from += COMMENT_COUNTS_PAGE) {
    const { data, error } = await db
      .rpc("communication_comment_counts")
      .order("author_id")
      .range(from, from + COMMENT_COUNTS_PAGE - 1);

    if (error) {
      if (isMissingCommunicationSchema(error)) {
        console.error("[comunicacao] contagem de comentarios indisponivel (migracao 202610200001 pendente).");
        return new Map();
      }

      throw new Error(`Comunicacao: comentarios por aluno: ${error.message}`);
    }

    const rows = (data ?? []) as CommentCountRow[];

    for (const row of rows) {
      if (row.author_id) {
        counts.set(row.author_id, {
          d7: count(row.comments_7d),
          d30: count(row.comments_30d),
          d90: count(row.comments_90d),
          total: count(row.comments_total)
        });
      }
    }

    if (rows.length < COMMENT_COUNTS_PAGE) {
      return counts;
    }
  }
}

function groupBy<Row>(rows: readonly Row[], key: (row: Row) => string) {
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

function timeOf(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const time = Date.parse(value);

  return Number.isFinite(time) ? time : null;
}

/** Aulas publicadas concluidas por conteudo (so as que continuam publicadas contam). */
function completedByContentOf(rows: readonly ProgressRow[], lessonIndex: Map<string, Set<string>>) {
  const completed: Record<string, Set<string>> = {};

  for (const row of rows) {
    const published = lessonIndex.get(row.content_id);

    if (!published) {
      continue;
    }

    const set = (completed[row.content_id] ??= new Set<string>());

    for (const lessonId of row.completed_lesson_ids ?? []) {
      if (published.has(lessonId)) {
        set.add(lessonId);
      }
    }
  }

  return Object.fromEntries(Object.entries(completed).map(([contentId, set]) => [contentId, set.size]));
}

function lastStudiedOf(rows: readonly ProgressRow[]) {
  let latest: string | null = null;

  for (const row of rows) {
    if (!latest || row.updated_at > latest) {
      latest = row.updated_at;
    }
  }

  return latest;
}

/** Conteudos que o aluno pode estudar agora ("platform" abre tudo que tem aula), como em Alunos. */
function openContentIds(openRows: readonly EntitlementRow[], lessonIndex: Map<string, Set<string>>) {
  if (openRows.some((row) => row.target_type === "platform")) {
    return Array.from(lessonIndex.keys());
  }

  return Array.from(new Set(openRows.map((row) => row.target_id)));
}

export async function loadAudienceFacts(db: CommunicationsDb, now: Date | number = Date.now()): Promise<LoadedAudience> {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const [profiles, staff, entitlements, progressRows, lessonIndex, memberships, comments] = await Promise.all([
    fetchProfiles(db),
    fetchStaffUserIds(db),
    fetchEntitlements(db),
    fetchProgressRows(db),
    fetchPublishedLessonIndex(db),
    fetchCohortMemberships(db),
    fetchCommentCounts(db)
  ]);
  const openRows = entitlements.filter((row) =>
    isAccessOpen(accessStateOf({ endsAt: row.ends_at, now: nowMs, startsAt: row.starts_at, status: row.status }))
  );
  const openByUser = groupBy(openRows, (row) => row.user_id);
  const progressByUser = groupBy(progressRows, (row) => row.user_id);
  const membershipsByUser = groupBy(memberships, (row) => row.user_id);
  const facts: AudienceStudentFacts[] = [];
  const people = new Map<string, AudiencePerson>();

  for (const profile of profiles) {
    if (staff.has(profile.id)) {
      continue;
    }

    const open = openByUser.get(profile.id) ?? [];
    const rows = progressByUser.get(profile.id) ?? [];
    const contentIds = openContentIds(open, lessonIndex);
    const openProductIds = new Set(contentIds);
    const completedByContent = completedByContentOf(rows, lessonIndex);
    let completedLessons = 0;
    let totalLessons = 0;

    for (const contentId of contentIds) {
      totalLessons += lessonIndex.get(contentId)?.size ?? 0;
      completedLessons += completedByContent[contentId] ?? 0;
    }

    const lastStudiedAt = lastStudiedOf(rows);
    const accesses = open.flatMap((row) => {
      const startsAt = timeOf(row.starts_at);

      return startsAt === null
        ? []
        : [{ endsAt: timeOf(row.ends_at), productId: row.target_type === "platform" ? "platform" : row.target_id, startsAt }];
    });

    facts.push({
      accesses,
      cohortIds: Array.from(
        new Set((membershipsByUser.get(profile.id) ?? []).filter((row) => openProductIds.has(row.product_id)).map((row) => row.cohort_id))
      ),
      comments: comments.get(profile.id) ?? ZERO_COMMENTS,
      completedByContent,
      completedLessons,
      lastSignInAt: timeOf(profile.last_sign_in_at),
      lastStudiedAt: timeOf(lastStudiedAt),
      pace: paceOf({ completedLessons, lastStudiedAt, now: nowMs, totalLessons }),
      totalLessons,
      userId: profile.id
    });
    people.set(profile.id, { avatarUrl: sanitizeProfileAvatarUrl(profile.avatar_url), name: profile.full_name?.trim() || NO_NAME });
  }

  return {
    context: {
      commentRanks: buildCommentRanks(facts),
      lessonTotals: Object.fromEntries(Array.from(lessonIndex, ([contentId, lessons]) => [contentId, lessons.size])),
      now: nowMs
    },
    facts,
    people
  };
}
