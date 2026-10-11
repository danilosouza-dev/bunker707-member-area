// Mapeadores puros da Comunidade: linhas do banco/RPC -> DTOs de src/server/community/types.ts.
// Sem "server-only", sem React e sem aliases em imports de valor: tests/community-queue.test.mjs
// carrega este arquivo direto pelo Node. As consultas ficam em queries.ts.

import type { AdminBlockedWordRule, LessonCommentAuthorRole, LessonCommentStatus } from "@/lib/platform-types";
import { resolveProductAccent } from "../catalog/model";
import { COMMENT_STATUS_LABELS, hoursBetween, isOverdueQuestion, ratingBalance, type CommunityPeriod } from "./model";
import type {
  CommentListItem,
  CommunityAuthor,
  CommunityFilterOptions,
  CommunityLessonPath,
  CommunityStats,
  LessonCommunityRow,
  QueueItem,
  QuickReply,
  ReportHistoryEntry,
  TopCommenter
} from "./types";

/* ================================================================================================
 * Linhas
 * ============================================================================================== */

export type CommentRow = {
  author_avatar_url: string | null;
  author_id: string | null;
  author_name: string;
  author_role: LessonCommentAuthorRole;
  body: string;
  content_id: string;
  created_at: string;
  id: string;
  lesson_id: string;
  parent_comment_id: string | null;
  resolved_at: string | null;
  status: LessonCommentStatus;
};

export const COMMENT_COLUMNS =
  "id,content_id,lesson_id,parent_comment_id,author_id,author_name,author_avatar_url,author_role,body,status,resolved_at,created_at";

export type LessonRow = { id: string; module_id: string; title: string };
export type ModuleRow = { id: string; owner_id: string | null; title: string };
export type ProductRow = { id: string; title: string };
export type ProductSettingsRow = { content_id: string; settings: unknown };

export type CommunityStatsRow = {
  comments_in_window: number | string | null;
  median_response_hours: number | string | null;
  oldest_unanswered_at: string | null;
  open_reports: number | string | null;
  p90_response_hours: number | string | null;
  unanswered: number | string | null;
};

export type TopCommenterRow = {
  author_avatar_url: string | null;
  author_id: string | null;
  author_name: string | null;
  comments: number | string | null;
  reactions_received: number | string | null;
  replies_to_peers: number | string | null;
  score: number | string | null;
};

export type LessonRowsRpcRow = {
  comments: number | string | null;
  lesson_id: string;
  liked: number | string | null;
  loved: number | string | null;
  not_for_me: number | string | null;
  total_count: number | string | null;
  tutor_questions: number | string | null;
  unanswered: number | string | null;
};

export type FilterOptionRow = {
  formation_id: string | null;
  formation_title: string | null;
  lesson_id: string;
  lesson_title: string | null;
  product_id: string;
  product_title: string | null;
};

export type ReportRow = { comment_id: string; created_at: string; reason: string | null };

export type ModerationActionRow = {
  action: ReportHistoryEntry["action"];
  actor_id: string | null;
  comment_id: string;
  created_at: string;
  note: string | null;
};

export type QuickReplyRow = { body: string; id: string; title: string; updated_at: string };

export type BlockedWordRow = {
  active: boolean;
  created_at: string;
  id: string;
  message: string;
  updated_at: string;
  word: string;
};

/* ================================================================================================
 * Numeros e textos
 * ============================================================================================== */

/** bigint/numeric chegam do PostgREST como numero ou texto; lixo vira 0. */
export function toCount(value: unknown) {
  const number = typeof value === "string" ? Number(value) : value;

  return typeof number === "number" && Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

/** Numero opcional (mediana, p90): sem valor fica null, nunca 0 inventado. */
export function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = typeof value === "string" ? Number(value) : value;

  return typeof number === "number" && Number.isFinite(number) ? number : null;
}

/** "Helena Prado" -> "HP"; "ana" -> "A"; vazio -> "?". */
export function communityInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";

  return `${first}${last}`.toLocaleUpperCase("pt-BR") || "?";
}

export function toCommunityAuthor(row: { author_avatar_url: string | null; author_id: string | null; author_name: string | null }): CommunityAuthor {
  const name = row.author_name?.trim() || "Aluno";

  return {
    avatarUrl: row.author_avatar_url?.trim() || null,
    id: row.author_id,
    initials: communityInitials(name),
    name
  };
}

/** "Produto › Módulo › Aula", sem partes vazias. */
export function buildLessonPathLabel(parts: { lessonTitle: string; moduleTitle?: string | null; productTitle: string }) {
  return [parts.productTitle, parts.moduleTitle, parts.lessonTitle]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" › ");
}

/** Conta linhas por comment_id (reacoes, denuncias). */
export function countByComment(rows: readonly { comment_id: string }[]) {
  const counts = new Map<string, number>();

  for (const row of rows) {
    counts.set(row.comment_id, (counts.get(row.comment_id) ?? 0) + 1);
  }

  return counts;
}

/* ================================================================================================
 * Caminho da aula
 * ============================================================================================== */

export type LessonPathSources = {
  lessons: readonly LessonRow[];
  modules: readonly ModuleRow[];
  products: readonly ProductRow[];
  settings: readonly ProductSettingsRow[];
};

function readAccent(settings: unknown) {
  return settings && typeof settings === "object" ? (settings as { accent?: unknown }).accent : undefined;
}

/**
 * Monta um resolvedor (contentId, lessonId) -> CommunityLessonPath. O produto do caminho e o dono da
 * aula (modulo.owner_id): numa formacao, o curso incluido; sem dono, o produto do comentario.
 */
export function createLessonPathResolver(sources: LessonPathSources) {
  const lessons = new Map(sources.lessons.map((row) => [row.id, row]));
  const modules = new Map(sources.modules.map((row) => [row.id, row]));
  const products = new Map(sources.products.map((row) => [row.id, row]));
  const accents = new Map(sources.settings.map((row) => [row.content_id, readAccent(row.settings)]));

  return function resolve(contentId: string, lessonId: string): CommunityLessonPath {
    const lesson = lessons.get(lessonId);
    const courseModule = lesson ? modules.get(lesson.module_id) : undefined;
    const productId = courseModule?.owner_id || contentId;
    const productTitle = products.get(productId)?.title?.trim() || products.get(contentId)?.title?.trim() || "Produto removido";
    const lessonTitle = lesson?.title?.trim() || "Aula removida";
    const moduleTitle = courseModule?.title?.trim() || null;
    const moduleId = courseModule?.id ?? null;
    // Sem comentario de contexto (aba Aulas), a aula abre pelo produto dono.
    const studentContentId = contentId || productId;

    return {
      adminHref: productId
        ? `/admin/produtos/${encodeURIComponent(productId)}?aula=${encodeURIComponent(lessonId)}`
        : "/admin/produtos",
      contentId: studentContentId,
      label: buildLessonPathLabel({ lessonTitle, moduleTitle, productTitle }),
      lessonId,
      lessonTitle,
      moduleId,
      moduleTitle,
      productAccent: resolveProductAccent(productId, accents.get(productId)),
      productId,
      productTitle,
      studentHref:
        moduleId && studentContentId
          ? `/conteudo/${encodeURIComponent(studentContentId)}/aulas/${encodeURIComponent(moduleId)}?lessonId=${encodeURIComponent(lessonId)}`
          : null
    };
  };
}

export type LessonPathResolver = ReturnType<typeof createLessonPathResolver>;

/** Ids que precisam ser lidos para montar os caminhos (aulas, depois modulos e produtos). */
export function collectProductIds(contentIds: Iterable<string>, modules: readonly ModuleRow[]) {
  const ids = new Set<string>(contentIds);

  for (const courseModule of modules) {
    if (courseModule.owner_id) {
      ids.add(courseModule.owner_id);
    }
  }

  return Array.from(ids);
}

/* ================================================================================================
 * DTOs
 * ============================================================================================== */

export function toQueueItem(
  row: CommentRow,
  context: {
    now?: Date;
    path: CommunityLessonPath;
    reactionCount: number;
    replies: readonly CommentRow[];
    reportCount: number;
  }
): QueueItem {
  return {
    author: toCommunityAuthor(row),
    body: row.body,
    createdAt: row.created_at,
    id: row.id,
    isOverdue: isOverdueQuestion(row.created_at, context.now),
    path: context.path,
    reactionCount: context.reactionCount,
    reportCount: context.reportCount,
    studentReplies: context.replies.map((reply) => ({
      author: toCommunityAuthor(reply),
      body: reply.body,
      createdAt: reply.created_at,
      id: reply.id
    }))
  };
}

export function toCommentListItem(
  row: CommentRow,
  context: {
    answered: boolean;
    parentAuthorName: string | null;
    path: CommunityLessonPath;
    reactionCount: number;
    reportCount: number;
  }
): CommentListItem {
  return {
    answered: row.parent_comment_id ? false : context.answered,
    author: toCommunityAuthor(row),
    authorRole: row.author_role,
    body: row.body,
    createdAt: row.created_at,
    id: row.id,
    kind: row.parent_comment_id ? "reply" : "comment",
    parentAuthorName: row.parent_comment_id ? context.parentAuthorName?.trim() || "Comentário original" : null,
    path: context.path,
    reactionCount: context.reactionCount,
    reportCount: context.reportCount,
    resolved: Boolean(row.resolved_at),
    status: row.status,
    statusLabel: COMMENT_STATUS_LABELS[row.status] ?? row.status
  };
}

export function toCommunityStats(row: CommunityStatsRow | null | undefined, windowDays: number, now: Date = new Date()): CommunityStats {
  const oldest = row?.oldest_unanswered_at ?? null;

  return {
    commentsInWindow: toCount(row?.comments_in_window),
    medianResponseHours: toNullableNumber(row?.median_response_hours),
    oldestUnansweredHours: oldest ? hoursBetween(oldest, now) : null,
    openReports: toCount(row?.open_reports),
    p90ResponseHours: toNullableNumber(row?.p90_response_hours),
    unanswered: toCount(row?.unanswered),
    windowDays
  };
}

/**
 * Denuncia aberta = comentario visivel com denuncia mais nova que a ultima acao de moderacao
 * (mesma regra da view community_report_state).
 */
export function isReportOpen(input: { lastActionAt: string | null; lastReportedAt: string | null; status: LessonCommentStatus }) {
  if (input.status !== "approved" || !input.lastReportedAt) {
    return false;
  }

  const reported = new Date(input.lastReportedAt).getTime();
  const acted = input.lastActionAt ? new Date(input.lastActionAt).getTime() : Number.NEGATIVE_INFINITY;

  return Number.isFinite(reported) && reported > acted;
}

/** Motivos distintos com contagem: ["Spam (2)", "Ofensivo", "Sem motivo informado"]. */
export function summarizeReportReasons(reports: readonly Pick<ReportRow, "reason">[]) {
  const counts = new Map<string, number>();

  for (const report of reports) {
    const reason = report.reason?.trim().replace(/\s+/g, " ") || "Sem motivo informado";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "pt-BR"))
    .map(([reason, count]) => (count > 1 ? `${reason} (${count})` : reason));
}

export function toReportHistory(actions: readonly ModerationActionRow[], actorNames: ReadonlyMap<string, string>): ReportHistoryEntry[] {
  return [...actions]
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .map((action) => ({
      action: action.action,
      actorName: action.actor_id ? (actorNames.get(action.actor_id) ?? null) : null,
      createdAt: action.created_at,
      note: action.note?.trim() || null
    }));
}

export const REPORT_ACTION_LABELS: Record<ReportHistoryEntry["action"], string> = {
  approved: "Mantido visível",
  hidden: "Ocultado",
  marked_spam: "Marcado como spam",
  restored: "Restaurado"
};

export function toTopCommenter(row: TopCommenterRow): TopCommenter {
  const comments = toCount(row.comments);
  const repliesToPeers = toCount(row.replies_to_peers);
  const reactionsReceived = toCount(row.reactions_received);

  return {
    author: toCommunityAuthor(row),
    comments,
    reactionsReceived,
    repliesToPeers,
    score: row.score === null || row.score === undefined ? comments + repliesToPeers + reactionsReceived : toCount(row.score)
  };
}

export function toLessonCommunityRow(row: LessonRowsRpcRow, path: CommunityLessonPath): LessonCommunityRow {
  const notForMe = toCount(row.not_for_me);
  const liked = toCount(row.liked);
  const loved = toCount(row.loved);

  return {
    comments: toCount(row.comments),
    path,
    ratings: {
      balance: ratingBalance({ liked, loved, notForMe }),
      liked,
      loved,
      notForMe,
      total: notForMe + liked + loved
    },
    tutorQuestions: toCount(row.tutor_questions),
    unanswered: toCount(row.unanswered)
  };
}

export function toQuickReply(row: QuickReplyRow): QuickReply {
  return { body: row.body, id: row.id, title: row.title, updatedAt: row.updated_at };
}

export function toBlockedWordRule(row: BlockedWordRow): AdminBlockedWordRule {
  return {
    active: row.active,
    createdAt: row.created_at,
    id: row.id,
    message: row.message,
    updatedAt: row.updated_at,
    word: row.word
  };
}

/**
 * Opcoes dos filtros: produtos donos das aulas comentadas e as formacoes que os incluem; aulas
 * rotuladas "Aula · Produto" quando o mesmo nome aparece em mais de um produto.
 */
export function buildFilterOptions(rows: readonly FilterOptionRow[]): CommunityFilterOptions {
  const products = new Map<string, string>();
  const titleCounts = new Map<string, number>();

  for (const row of rows) {
    products.set(row.product_id, row.product_title?.trim() || "Produto sem nome");

    if (row.formation_id) {
      products.set(row.formation_id, row.formation_title?.trim() || "Formação sem nome");
    }

    const title = row.lesson_title?.trim() || "Aula sem nome";
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  }

  return {
    lessons: rows.map((row) => {
      const title = row.lesson_title?.trim() || "Aula sem nome";
      const productTitle = row.product_title?.trim() || "Produto sem nome";

      return {
        formationId: row.formation_id || null,
        id: row.lesson_id,
        label: (titleCounts.get(title) ?? 0) > 1 ? `${title} · ${productTitle}` : title,
        productId: row.product_id
      };
    }),
    products: Array.from(products.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((left, right) => left.label.localeCompare(right.label, "pt-BR"))
  };
}

/** Aulas do filtro para o produto escolhido (inclui as dos cursos de uma formacao). */
export function lessonsForProduct(options: CommunityFilterOptions["lessons"], productId: string | null | undefined) {
  if (!productId) {
    return [...options];
  }

  return options.filter((lesson) => lesson.productId === productId || lesson.formationId === productId);
}

/* ================================================================================================
 * Paginas
 * ============================================================================================== */

export function pageOffset(page: number, pageSize: number) {
  return Math.max(0, (Math.max(1, Math.trunc(page)) - 1) * pageSize);
}

/** Janela das listas de trabalho: com periodo explicito, a data de inicio; sem ele, null (tudo). */
export function listWindowSince(period: Pick<CommunityPeriod, "explicit" | "since">) {
  return period.explicit ? period.since : null;
}
