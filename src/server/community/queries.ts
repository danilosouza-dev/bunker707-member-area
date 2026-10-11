import "server-only";

// Leituras da Comunidade (docs/17 §1.9). Contagens e ordenacao sempre por RPC SQL
// (supabase/migrations/202610110020_community_v1.sql); aqui so se le a pagina pedida pelos ids
// devolvidos e se monta o DTO com ./mappers. Nada de numero de exemplo: sem dado, o DTO traz 0 ou null
// e a tela mostra "—" ou o estado vazio.

import { COMMUNITY_STATS_WINDOW_DAYS, communitySince } from "./model";
import {
  buildFilterOptions,
  countByComment,
  isReportOpen,
  listWindowSince,
  pageOffset,
  summarizeReportReasons,
  toBlockedWordRule,
  toCommentListItem,
  toCommunityStats,
  toCount,
  toLessonCommunityRow,
  toQueueItem,
  toQuickReply,
  toReportHistory,
  toTopCommenter,
  COMMENT_COLUMNS,
  type BlockedWordRow,
  type CommentRow,
  type CommunityStatsRow,
  type FilterOptionRow,
  type LessonRowsRpcRow,
  type ModerationActionRow,
  type QuickReplyRow,
  type ReportRow,
  type TopCommenterRow
} from "./mappers";
import { COMMUNITY_PAGE_SIZE } from "./schemas";
import {
  assertNoDbError,
  communityDb,
  loadCommentsByIds,
  loadLessonPathResolver,
  loadProfileNames,
  loadReactionAndReportRows,
  selectByIds
} from "./db";
import type {
  CommentListPage,
  CommunityQuery,
  GetCommunityFilterOptions,
  GetCommunityRules,
  GetCommunityStats,
  ListComments,
  ListLessonCommunityRows,
  ListLessonCommunityRowsPage,
  ListQuickReplies,
  ListReports,
  ListReportsPage,
  ListTopCommenters,
  ListUnansweredQueue,
  QueueItem,
  ReportItem
} from "./types";

const LESSON_ROWS_PAGE_SIZE = 50;
const TOP_COMMENTERS_LIMIT = 20;

type PagedIdRow = { comment_id: string; total_count: number | string | null };

/** Total da lista mesmo quando a pagina pedida passou do fim (a RPC nao devolve linhas ai). */
async function totalFromFirstRow(rows: readonly PagedIdRow[], offset: number, rerun: () => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  if (rows.length > 0) {
    return toCount(rows[0].total_count);
  }

  if (offset === 0) {
    return 0;
  }

  const result = await rerun();
  assertNoDbError(result.error, "Comunidade: total da lista");

  const first = ((result.data ?? []) as PagedIdRow[])[0];

  return first ? toCount(first.total_count) : 0;
}

/* ================================================================================================
 * Numeros do topo
 * ============================================================================================== */

export const getCommunityStats: GetCommunityStats = async ({ product }) => {
  const result = await communityDb().rpc("community_stats", {
    p_content_id: product ?? null,
    p_window_days: COMMUNITY_STATS_WINDOW_DAYS
  });
  assertNoDbError(result.error, "Comunidade: numeros do topo");

  const row = (Array.isArray(result.data) ? result.data[0] : result.data) as CommunityStatsRow | null;

  return toCommunityStats(row, COMMUNITY_STATS_WINDOW_DAYS);
};

/* ================================================================================================
 * Precisam de resposta
 * ============================================================================================== */

export const listUnansweredQueue: ListUnansweredQueue = async (query) => {
  const db = communityDb();
  const pageSize = COMMUNITY_PAGE_SIZE;
  const offset = pageOffset(query.page, pageSize);
  const params = {
    p_content_id: query.product ?? null,
    p_lesson_id: query.lesson ?? null,
    p_since: listWindowSince(query.period)
  };
  const result = await db.rpc("community_unanswered", { ...params, p_limit: pageSize, p_offset: offset });
  assertNoDbError(result.error, "Comunidade: fila");

  const idRows = (result.data ?? []) as PagedIdRow[];
  const total = await totalFromFirstRow(idRows, offset, () =>
    db.rpc("community_unanswered", { ...params, p_limit: 1, p_offset: 0 })
  );
  const ids = idRows.map((row) => row.comment_id);

  if (ids.length === 0) {
    return { items: [], page: query.page, pageSize, query, total };
  }

  const [questions, replies, counts] = await Promise.all([
    loadCommentsByIds(ids),
    selectByIds<CommentRow>("lesson_comments", COMMENT_COLUMNS, "parent_comment_id", ids, "Comunidade: respostas de colegas"),
    loadReactionAndReportRows(ids)
  ]);
  const resolvePath = await loadLessonPathResolver(questions.map((row) => ({ contentId: row.content_id, lessonId: row.lesson_id })));
  const reactionCounts = countByComment(counts.reactions);
  const reportCounts = countByComment(counts.reports);
  const repliesByParent = new Map<string, CommentRow[]>();

  for (const reply of replies) {
    // So respostas visiveis de colegas (a pergunta esta na fila: nao ha resposta do professor).
    if (reply.status !== "approved" || !reply.parent_comment_id) {
      continue;
    }

    const list = repliesByParent.get(reply.parent_comment_id) ?? [];
    list.push(reply);
    repliesByParent.set(reply.parent_comment_id, list);
  }

  const now = new Date();
  const items: QueueItem[] = questions.map((row) =>
    toQueueItem(row, {
      now,
      path: resolvePath(row.content_id, row.lesson_id),
      reactionCount: reactionCounts.get(row.id) ?? 0,
      replies: (repliesByParent.get(row.id) ?? []).sort((left, right) => left.created_at.localeCompare(right.created_at)),
      reportCount: reportCounts.get(row.id) ?? 0
    })
  );

  return { items, page: query.page, pageSize, query, total };
};

/* ================================================================================================
 * Comentarios
 * ============================================================================================== */

export const listComments: ListComments = async (query) => {
  const db = communityDb();
  const pageSize = COMMUNITY_PAGE_SIZE;
  const offset = pageOffset(query.page, pageSize);
  const params = {
    p_answered: query.answered === "sim" ? true : query.answered === "nao" ? false : null,
    p_content_id: query.product ?? null,
    p_lesson_id: query.lesson ?? null,
    p_search: query.q ?? null,
    p_since: query.period.since,
    p_status: query.status ?? null
  };
  const result = await db.rpc("community_comment_list", { ...params, p_limit: pageSize, p_offset: offset });
  assertNoDbError(result.error, "Comunidade: comentarios");

  const idRows = (result.data ?? []) as (PagedIdRow & { answered: boolean | null })[];
  const total = await totalFromFirstRow(idRows, offset, () =>
    db.rpc("community_comment_list", { ...params, p_limit: 1, p_offset: 0 })
  );

  if (idRows.length === 0) {
    return { items: [], page: query.page, pageSize, query, total } satisfies CommentListPage;
  }

  const ids = idRows.map((row) => row.comment_id);
  const answeredById = new Map(idRows.map((row) => [row.comment_id, Boolean(row.answered)]));
  const [rows, counts] = await Promise.all([loadCommentsByIds(ids), loadReactionAndReportRows(ids)]);
  const parentIds = rows.map((row) => row.parent_comment_id).filter((id): id is string => Boolean(id));
  const [parents, resolvePath] = await Promise.all([
    selectByIds<{ author_name: string; id: string }>("lesson_comments", "id,author_name", "id", parentIds, "Comunidade: comentario original"),
    loadLessonPathResolver(rows.map((row) => ({ contentId: row.content_id, lessonId: row.lesson_id })))
  ]);
  const parentNames = new Map(parents.map((row) => [row.id, row.author_name]));
  const reactionCounts = countByComment(counts.reactions);
  const reportCounts = countByComment(counts.reports);

  return {
    items: rows.map((row) =>
      toCommentListItem(row, {
        answered: answeredById.get(row.id) ?? false,
        parentAuthorName: row.parent_comment_id ? (parentNames.get(row.parent_comment_id) ?? null) : null,
        path: resolvePath(row.content_id, row.lesson_id),
        reactionCount: reactionCounts.get(row.id) ?? 0,
        reportCount: reportCounts.get(row.id) ?? 0
      })
    ),
    page: query.page,
    pageSize,
    query,
    total
  };
};

/* ================================================================================================
 * Denuncias
 * ============================================================================================== */

type ReportedRpcRow = PagedIdRow & {
  is_open: boolean | null;
  last_reported_at: string | null;
  report_count: number | string | null;
};

export const listReportsPage: ListReportsPage = async (query: CommunityQuery) => {
  const db = communityDb();
  const pageSize = COMMUNITY_PAGE_SIZE;
  const offset = pageOffset(query.page, pageSize);
  const params = {
    p_content_id: query.product ?? null,
    p_lesson_id: query.lesson ?? null,
    p_since: listWindowSince(query.period)
  };
  const result = await db.rpc("community_reported_comments", { ...params, p_limit: pageSize, p_offset: offset });
  assertNoDbError(result.error, "Comunidade: denuncias");

  const idRows = (result.data ?? []) as ReportedRpcRow[];
  const total = await totalFromFirstRow(idRows, offset, () =>
    db.rpc("community_reported_comments", { ...params, p_limit: 1, p_offset: 0 })
  );

  if (idRows.length === 0) {
    return { items: [], page: query.page, pageSize, query, total };
  }

  const ids = idRows.map((row) => row.comment_id);
  const [rows, counts, reports, actions] = await Promise.all([
    loadCommentsByIds(ids),
    loadReactionAndReportRows(ids),
    selectByIds<ReportRow>("lesson_comment_reports", "comment_id,reason,created_at", "comment_id", ids, "Comunidade: motivos"),
    selectByIds<ModerationActionRow>(
      "lesson_comment_moderation_actions",
      "comment_id,actor_id,action,note,created_at",
      "comment_id",
      ids,
      "Comunidade: historico de moderacao"
    )
  ]);
  const parentIds = rows.map((row) => row.parent_comment_id).filter((id): id is string => Boolean(id));
  const actorIds = actions.map((action) => action.actor_id).filter((id): id is string => Boolean(id));
  const [parents, actorNames, resolvePath] = await Promise.all([
    selectByIds<{ author_name: string; id: string }>("lesson_comments", "id,author_name", "id", parentIds, "Comunidade: comentario original"),
    loadProfileNames(actorIds),
    loadLessonPathResolver(rows.map((row) => ({ contentId: row.content_id, lessonId: row.lesson_id })))
  ]);
  const parentNames = new Map(parents.map((row) => [row.id, row.author_name]));
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const reactionCounts = countByComment(counts.reactions);
  const items: ReportItem[] = [];

  for (const idRow of idRows) {
    const row = rowsById.get(idRow.comment_id);

    if (!row) {
      continue;
    }

    const commentReports = reports.filter((report) => report.comment_id === row.id);
    const commentActions = actions.filter((action) => action.comment_id === row.id);
    const lastActionAt = commentActions.reduce<string | null>(
      (latest, action) => (!latest || action.created_at > latest ? action.created_at : latest),
      null
    );
    const lastReportedAt = idRow.last_reported_at ?? commentReports.reduce<string | null>(
      (latest, report) => (!latest || report.created_at > latest ? report.created_at : latest),
      null
    );

    items.push({
      comment: toCommentListItem(row, {
        answered: false,
        parentAuthorName: row.parent_comment_id ? (parentNames.get(row.parent_comment_id) ?? null) : null,
        path: resolvePath(row.content_id, row.lesson_id),
        reactionCount: reactionCounts.get(row.id) ?? 0,
        reportCount: commentReports.length
      }),
      history: toReportHistory(commentActions, actorNames),
      lastReportedAt: lastReportedAt ?? row.created_at,
      open: idRow.is_open ?? isReportOpen({ lastActionAt, lastReportedAt, status: row.status }),
      reasons: summarizeReportReasons(commentReports),
      reportCount: toCount(idRow.report_count) || commentReports.length
    });
  }

  return { items, page: query.page, pageSize, query, total };
};

export const listReports: ListReports = async (query) => (await listReportsPage(query)).items;

/* ================================================================================================
 * Top alunos
 * ============================================================================================== */

export const listTopCommenters: ListTopCommenters = async (query) => {
  const result = await communityDb().rpc("community_top_commenters", {
    p_content_id: query.product ?? null,
    p_limit: TOP_COMMENTERS_LIMIT,
    p_since: communitySince(COMMUNITY_STATS_WINDOW_DAYS)
  });
  assertNoDbError(result.error, "Comunidade: top alunos");

  return ((result.data ?? []) as TopCommenterRow[]).map(toTopCommenter);
};

/* ================================================================================================
 * Aulas (duvidas e avaliacao)
 * ============================================================================================== */

export const listLessonCommunityRowsPage: ListLessonCommunityRowsPage = async (query) => {
  const db = communityDb();
  const pageSize = LESSON_ROWS_PAGE_SIZE;
  const offset = pageOffset(query.page, pageSize);
  const params = {
    p_content_id: query.product ?? null,
    p_since: query.period.since,
    p_sort: query.sort
  };
  const result = await db.rpc("community_lesson_rows", { ...params, p_limit: pageSize, p_offset: offset });
  assertNoDbError(result.error, "Comunidade: aulas");

  const rows = (result.data ?? []) as LessonRowsRpcRow[];
  let total = rows.length > 0 ? toCount(rows[0].total_count) : 0;

  if (rows.length === 0 && offset > 0) {
    const recount = await db.rpc("community_lesson_rows", { ...params, p_limit: 1, p_offset: 0 });
    assertNoDbError(recount.error, "Comunidade: total de aulas");
    total = toCount(((recount.data ?? []) as LessonRowsRpcRow[])[0]?.total_count);
  }

  if (rows.length === 0) {
    return { items: [], page: query.page, pageSize, query, total };
  }

  // A aba Aulas nao tem comentario de contexto: o produto do caminho e o dono da aula.
  const resolvePath = await loadLessonPathResolver(rows.map((row) => ({ contentId: "", lessonId: row.lesson_id })));

  return {
    items: rows.map((row) => toLessonCommunityRow(row, resolvePath("", row.lesson_id))),
    page: query.page,
    pageSize,
    query,
    total
  };
};

export const listLessonCommunityRows: ListLessonCommunityRows = async (query) =>
  (await listLessonCommunityRowsPage({ ...query, sort: "doubts" })).items;

/* ================================================================================================
 * Regras e filtros
 * ============================================================================================== */

export const listQuickReplies: ListQuickReplies = async () => {
  const result = await communityDb()
    .from("community_quick_replies")
    .select("id,title,body,updated_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(100);
  assertNoDbError(result.error, "Comunidade: respostas rapidas");

  return ((result.data ?? []) as QuickReplyRow[]).map(toQuickReply);
};

export const getCommunityRules: GetCommunityRules = async () => {
  const [blockedWords, quickReplies] = await Promise.all([
    communityDb()
      .from("lesson_comment_blocked_words")
      .select("id,word,message,active,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(500),
    listQuickReplies()
  ]);
  assertNoDbError(blockedWords.error, "Comunidade: palavras bloqueadas");

  return {
    blockedWords: ((blockedWords.data ?? []) as BlockedWordRow[]).map(toBlockedWordRule),
    quickReplies
  };
};

export const getCommunityFilterOptions: GetCommunityFilterOptions = async () => {
  const result = await communityDb().rpc("community_filter_options");
  assertNoDbError(result.error, "Comunidade: opcoes de filtro");

  return buildFilterOptions((result.data ?? []) as FilterOptionRow[]);
};
