import "server-only";

import type { User } from "@supabase/supabase-js";
import type {
  AdminBlockedWordRule,
  AdminCommentStatus,
  AdminModerationItem,
  LessonCommentAuthorRole,
  LessonCommentReaction,
  LessonCommentRecord,
  LessonCommentStatus,
  ReleaseRuleConfig
} from "@/lib/platform-types";
import { getReleaseRuleNotice } from "@/lib/release-rules";
import { getUserDisplayName } from "@/server/auth/session";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import {
  containsBlockedTerm,
  lessonCommentBurstLimit,
  lessonCommentBurstWindowMs,
  normalizeCommentForModeration,
  validateLessonCommentBody
} from "@/server/comments/comment-validation";

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdminClient>;

type LessonCommentRow = {
  analysis_status: AdminModerationItem["analysisStatus"];
  author_avatar_url: string | null;
  author_id: string | null;
  author_name: string;
  author_role: LessonCommentAuthorRole;
  author_username: string;
  body: string;
  content_id: string;
  created_at: string;
  deleted_at: string | null;
  id: string;
  lesson_id: string;
  moderation_note: string | null;
  parent_comment_id: string | null;
  status: LessonCommentStatus;
  updated_at: string;
};

type CommentReactionRow = {
  comment_id: string;
  reaction: LessonCommentReaction;
  user_id: string;
};

type CommentReportRow = {
  comment_id: string;
  reporter_id: string;
};

type BlockedWordRow = {
  active: boolean;
  created_at: string;
  id: string;
  message: string;
  updated_at: string;
  word: string;
};

type LessonAccessContext = {
  contentId: string;
  isAdmin: boolean;
  lessonId: string;
};

const commentReactionValues = new Set<LessonCommentReaction>([
  "like",
  "fire",
  "insight",
  "love",
  "clap",
  "laugh",
  "wow",
  "rocket",
  "eyes",
  "check"
]);

const commentStatusValues = new Set<AdminCommentStatus>([
  "approved",
  "hidden",
  "spam"
]);

export class LessonCommentStoreError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "LessonCommentStoreError";
    this.status = status;
  }
}

function throwDatabaseError(error: { message: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

function isActiveAccessWindow(startsAt?: string | null, endsAt?: string | null) {
  const now = Date.now();
  const start = startsAt ? new Date(startsAt).getTime() : Number.NaN;
  const end = endsAt ? new Date(endsAt).getTime() : Number.NaN;

  return !(!Number.isNaN(start) && start > now) && !(!Number.isNaN(end) && end < now);
}

function getTargetTypeForContentKind(kind: string) {
  if (kind === "Formacao") return "formation";
  if (kind === "Mentoria") return "mentorship";
  if (kind === "Webinario") return "webinar";
  if (kind === "Produto") return "product";
  if (kind === "Bootcamp") return "bootcamp";
  return "standalone_course";
}

async function requireLessonAccess(
  supabase: SupabaseAdminClient,
  contentId: string,
  lessonId: string,
  userId: string
): Promise<LessonAccessContext> {
  const lessonResult = await supabase
    .from("lessons")
    .select("id,module_id,release_rule,status")
    .eq("id", lessonId)
    .maybeSingle();
  throwDatabaseError(lessonResult.error, "Nao foi possivel validar a aula");

  if (!lessonResult.data || lessonResult.data.status !== "published") {
    throw new LessonCommentStoreError("Aula nao encontrada.", 404);
  }

  const [moduleResult, contentResult, adminRoleResult] = await Promise.all([
    supabase
      .from("course_modules")
      .select("id,owner_id,release_rule,status")
      .eq("id", lessonResult.data.module_id)
      .maybeSingle(),
    supabase
      .from("content_items")
      .select("id,access_model,commerce_scope,is_locked,kind")
      .eq("id", contentId)
      .maybeSingle(),
    supabase
      .from("admin_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle()
  ]);

  throwDatabaseError(moduleResult.error, "Nao foi possivel validar o modulo");
  throwDatabaseError(contentResult.error, "Nao foi possivel validar o conteudo");
  throwDatabaseError(adminRoleResult.error, "Nao foi possivel validar o papel do usuario");

  if (
    !moduleResult.data ||
    moduleResult.data.status !== "published" ||
    moduleResult.data.owner_id !== contentId ||
    !contentResult.data
  ) {
    throw new LessonCommentStoreError("A aula nao pertence a este conteudo.", 404);
  }

  const content = contentResult.data;
  const isAdmin = Boolean(adminRoleResult.data);

  if (isAdmin) {
    return { contentId, isAdmin, lessonId };
  }

  const lessonReleaseNotice = getReleaseRuleNotice(
    lessonResult.data.release_rule as ReleaseRuleConfig | undefined,
    "aula"
  );
  const moduleReleaseNotice = getReleaseRuleNotice(
    moduleResult.data.release_rule as ReleaseRuleConfig | undefined,
    "modulo"
  );

  if (lessonReleaseNotice?.isLocked || moduleReleaseNotice?.isLocked) {
    throw new LessonCommentStoreError("Os comentarios ficam disponiveis quando a aula for liberada.", 403);
  }

  if (content.access_model === "free" || content.is_locked === false) {
    return { contentId, isAdmin, lessonId };
  }

  const entitlementResult = await supabase
    .from("entitlements")
    .select("target_id,target_type,starts_at,ends_at,status")
    .eq("user_id", userId)
    .eq("status", "active");
  throwDatabaseError(entitlementResult.error, "Nao foi possivel validar o acesso do aluno");

  const expectedTargetType = getTargetTypeForContentKind(content.kind);
  const hasEntitlement = (entitlementResult.data ?? []).some((entitlement) => {
    if (!isActiveAccessWindow(entitlement.starts_at, entitlement.ends_at)) {
      return false;
    }

    if (entitlement.target_type === "platform") {
      return entitlement.target_id === "platform" || entitlement.target_id === "*";
    }

    if (
      entitlement.target_type === expectedTargetType &&
      entitlement.target_id === contentId
    ) {
      return true;
    }

    return content.commerce_scope === "included_content" && entitlement.target_type === "formation";
  });

  if (!hasEntitlement) {
    throw new LessonCommentStoreError("Voce nao tem acesso aos comentarios desta aula.", 403);
  }

  return { contentId, isAdmin, lessonId };
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("pt-BR") ?? "")
    .join("") || "AL";
}

function getUsername(user: User, name: string) {
  const emailUsername = user.email?.split("@")[0] ?? "";
  const source = emailUsername || name;
  const normalized = normalizeCommentForModeration(source).replace(/\s+/g, ".");
  return normalized || getInitials(name).toLocaleLowerCase("pt-BR");
}

function blockedWordRowToRule(row: BlockedWordRow): AdminBlockedWordRule {
  return {
    active: row.active,
    createdAt: row.created_at,
    id: row.id,
    message: row.message,
    updatedAt: row.updated_at,
    word: row.word
  };
}

function buildLessonCommentRecords({
  currentUserId,
  reactions,
  reports,
  rows
}: {
  currentUserId: string;
  reactions: CommentReactionRow[];
  reports: CommentReportRow[];
  rows: LessonCommentRow[];
}) {
  const reactionCounts = new Map<string, Partial<Record<LessonCommentReaction, number>>>();
  const selectedReactions = new Map<string, LessonCommentReaction>();

  for (const reaction of reactions) {
    const counts = reactionCounts.get(reaction.comment_id) ?? {};
    counts[reaction.reaction] = (counts[reaction.reaction] ?? 0) + 1;
    reactionCounts.set(reaction.comment_id, counts);

    if (reaction.user_id === currentUserId) {
      selectedReactions.set(reaction.comment_id, reaction.reaction);
    }
  }

  const reportedCommentIds = new Set(
    reports
      .filter((report) => report.reporter_id === currentUserId)
      .map((report) => report.comment_id)
  );
  const records = new Map<string, LessonCommentRecord>();

  for (const row of rows) {
    records.set(row.id, {
      authorAvatarUrl: row.author_avatar_url ?? undefined,
      authorId: row.author_id ?? undefined,
      authorName: row.author_name,
      authorRole: row.author_role,
      authorUsername: row.author_username,
      body: row.body,
      contentId: row.content_id,
      createdAt: row.created_at,
      id: row.id,
      isOwn: row.author_id === currentUserId,
      lessonId: row.lesson_id,
      parentCommentId: row.parent_comment_id ?? undefined,
      reactions: reactionCounts.get(row.id) ?? {},
      replies: [],
      reportedByCurrentUser: reportedCommentIds.has(row.id),
      selectedReaction: selectedReactions.get(row.id),
      status: row.status,
      updatedAt: row.updated_at
    });
  }

  const rootRecords: LessonCommentRecord[] = [];

  for (const row of rows) {
    const record = records.get(row.id);

    if (!record) continue;

    if (row.parent_comment_id) {
      records.get(row.parent_comment_id)?.replies.push(record);
    } else {
      rootRecords.push(record);
    }
  }

  return rootRecords;
}

async function getCommentRowsForLesson(
  supabase: SupabaseAdminClient,
  contentId: string,
  lessonId: string,
  userId: string
) {
  const commentsResult = await supabase
    .from("lesson_comments")
    .select("id,content_id,lesson_id,parent_comment_id,author_id,author_name,author_username,author_avatar_url,author_role,body,status,moderation_note,analysis_status,deleted_at,created_at,updated_at")
    .eq("content_id", contentId)
    .eq("lesson_id", lessonId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  throwDatabaseError(commentsResult.error, "Nao foi possivel carregar os comentarios");

  return ((commentsResult.data ?? []) as LessonCommentRow[]).filter((row) => (
    row.status === "approved" || (row.status === "pending" && row.author_id === userId)
  ));
}

export async function listLessonComments({
  contentId,
  lessonId,
  userId
}: {
  contentId: string;
  lessonId: string;
  userId: string;
}) {
  const supabase = getSupabaseAdminClient();
  await requireLessonAccess(supabase, contentId, lessonId, userId);
  const rows = await getCommentRowsForLesson(supabase, contentId, lessonId, userId);
  const commentIds = rows.map((row) => row.id);

  if (commentIds.length === 0) {
    return [];
  }

  const [reactionsResult, reportsResult] = await Promise.all([
    supabase
      .from("lesson_comment_reactions")
      .select("comment_id,user_id,reaction")
      .in("comment_id", commentIds),
    supabase
      .from("lesson_comment_reports")
      .select("comment_id,reporter_id")
      .eq("reporter_id", userId)
      .in("comment_id", commentIds)
  ]);

  throwDatabaseError(reactionsResult.error, "Nao foi possivel carregar as reacoes");
  throwDatabaseError(reportsResult.error, "Nao foi possivel carregar as denuncias");

  return buildLessonCommentRecords({
    currentUserId: userId,
    reactions: (reactionsResult.data ?? []) as CommentReactionRow[],
    reports: (reportsResult.data ?? []) as CommentReportRow[],
    rows
  });
}

export async function createLessonComment({
  body: rawBody,
  contentId,
  lessonId,
  parentCommentId,
  user
}: {
  body: string;
  contentId: string;
  lessonId: string;
  parentCommentId?: string;
  user: User;
}) {
  const supabase = getSupabaseAdminClient();
  const access = await requireLessonAccess(supabase, contentId, lessonId, user.id);
  const validatedBody = validateLessonCommentBody(rawBody);

  if (validatedBody.error) {
    throw new LessonCommentStoreError(validatedBody.error, 400);
  }

  const blockedWordsResult = await supabase
    .from("lesson_comment_blocked_words")
    .select("message,word")
    .eq("active", true);
  throwDatabaseError(blockedWordsResult.error, "Nao foi possivel validar as regras de comentario");

  const matchedRule = (blockedWordsResult.data ?? []).find((rule) => (
    containsBlockedTerm(validatedBody.value, rule.word)
  ));

  if (matchedRule) {
    throw new LessonCommentStoreError(
      matchedRule.message || "Revise o comentario antes de enviar.",
      422
    );
  }

  const burstWindowStart = new Date(Date.now() - lessonCommentBurstWindowMs).toISOString();
  const burstResult = await supabase
    .from("lesson_comments")
    .select("id", { count: "exact", head: true })
    .eq("author_id", user.id)
    .gte("created_at", burstWindowStart);
  throwDatabaseError(burstResult.error, "Nao foi possivel validar o limite de comentarios");

  if ((burstResult.count ?? 0) >= lessonCommentBurstLimit) {
    throw new LessonCommentStoreError(
      "Voce enviou varios comentarios em pouco tempo. Aguarde um minuto e tente novamente.",
      429
    );
  }

  const duplicateWindowStart = new Date(Date.now() - 30_000).toISOString();
  const duplicateResult = await supabase
    .from("lesson_comments")
    .select("id")
    .eq("author_id", user.id)
    .eq("lesson_id", lessonId)
    .eq("body", validatedBody.value)
    .gte("created_at", duplicateWindowStart)
    .limit(1)
    .maybeSingle();
  throwDatabaseError(duplicateResult.error, "Nao foi possivel validar o comentario duplicado");

  if (duplicateResult.data) {
    throw new LessonCommentStoreError("Este comentario ja foi enviado.", 409);
  }

  if (parentCommentId) {
    const parentResult = await supabase
      .from("lesson_comments")
      .select("id,content_id,lesson_id,parent_comment_id,status")
      .eq("id", parentCommentId)
      .is("deleted_at", null)
      .maybeSingle();
    throwDatabaseError(parentResult.error, "Nao foi possivel validar o comentario respondido");

    if (
      !parentResult.data ||
      parentResult.data.content_id !== contentId ||
      parentResult.data.lesson_id !== lessonId ||
      parentResult.data.parent_comment_id ||
      parentResult.data.status !== "approved"
    ) {
      throw new LessonCommentStoreError("O comentario respondido nao esta mais disponivel.", 409);
    }
  }

  const profileResult = await supabase
    .from("profiles")
    .select("full_name,avatar_url")
    .eq("id", user.id)
    .maybeSingle();
  throwDatabaseError(profileResult.error, "Nao foi possivel carregar o perfil do aluno");

  const displayName = getUserDisplayName(user);
  const authorName = profileResult.data?.full_name?.trim() || displayName.fullName;
  const authorRole: LessonCommentAuthorRole = access.isAdmin ? "producer" : "student";
  const insertResult = await supabase
    .from("lesson_comments")
    .insert({
      author_avatar_url: profileResult.data?.avatar_url ?? null,
      author_id: user.id,
      author_name: authorName,
      author_role: authorRole,
      author_username: getUsername(user, authorName),
      body: validatedBody.value,
      content_id: contentId,
      lesson_id: lessonId,
      parent_comment_id: parentCommentId ?? null,
      status: "approved"
    })
    .select("id,content_id,lesson_id,parent_comment_id,author_id,author_name,author_username,author_avatar_url,author_role,body,status,moderation_note,analysis_status,deleted_at,created_at,updated_at")
    .single();
  throwDatabaseError(insertResult.error, "Nao foi possivel salvar o comentario");
  const row = insertResult.data as LessonCommentRow;

  return {
    authorAvatarUrl: row.author_avatar_url ?? undefined,
    authorId: row.author_id ?? undefined,
    authorName: row.author_name,
    authorRole: row.author_role,
    authorUsername: row.author_username,
    body: row.body,
    contentId: row.content_id,
    createdAt: row.created_at,
    id: row.id,
    isOwn: true,
    lessonId: row.lesson_id,
    parentCommentId: row.parent_comment_id ?? undefined,
    reactions: {},
    replies: [],
    reportedByCurrentUser: false,
    status: row.status,
    updatedAt: row.updated_at
  } satisfies LessonCommentRecord;
}

async function getAccessibleComment(
  supabase: SupabaseAdminClient,
  commentId: string,
  userId: string
) {
  const result = await supabase
    .from("lesson_comments")
    .select("id,content_id,lesson_id,author_id,status")
    .eq("id", commentId)
    .is("deleted_at", null)
    .maybeSingle();
  throwDatabaseError(result.error, "Nao foi possivel carregar o comentario");

  if (!result.data) {
    throw new LessonCommentStoreError("Comentario nao encontrado.", 404);
  }

  await requireLessonAccess(supabase, result.data.content_id, result.data.lesson_id, userId);

  if (result.data.status !== "approved" && !(result.data.status === "pending" && result.data.author_id === userId)) {
    throw new LessonCommentStoreError("Comentario nao encontrado.", 404);
  }

  return result.data;
}

export async function setLessonCommentReaction({
  commentId,
  reaction,
  userId
}: {
  commentId: string;
  reaction: LessonCommentReaction | null;
  userId: string;
}) {
  const supabase = getSupabaseAdminClient();
  await getAccessibleComment(supabase, commentId, userId);

  if (reaction !== null && !commentReactionValues.has(reaction)) {
    throw new LessonCommentStoreError("Reacao invalida.", 400);
  }

  const writeResult = reaction === null
    ? await supabase
      .from("lesson_comment_reactions")
      .delete()
      .eq("comment_id", commentId)
      .eq("user_id", userId)
    : await supabase
      .from("lesson_comment_reactions")
      .upsert({
        comment_id: commentId,
        reaction,
        user_id: userId
      }, { onConflict: "comment_id,user_id" });
  throwDatabaseError(writeResult.error, "Nao foi possivel salvar a reacao");

  return { commentId, reaction };
}

export async function reportLessonComment({
  commentId,
  reason,
  userId
}: {
  commentId: string;
  reason?: string;
  userId: string;
}) {
  const supabase = getSupabaseAdminClient();
  const comment = await getAccessibleComment(supabase, commentId, userId);

  if (comment.author_id === userId) {
    throw new LessonCommentStoreError("Voce nao pode denunciar o proprio comentario.", 400);
  }

  const result = await supabase
    .from("lesson_comment_reports")
    .upsert({
      comment_id: commentId,
      reason: reason?.trim().slice(0, 500) || null,
      reporter_id: userId
    }, {
      ignoreDuplicates: true,
      onConflict: "comment_id,reporter_id"
    });
  throwDatabaseError(result.error, "Nao foi possivel enviar a denuncia");

  return { commentId, reported: true };
}

export async function getAdminModerationData() {
  const supabase = getSupabaseAdminClient();
  const [commentsResult, reactionsResult, reportsResult, blockedWordsResult] = await Promise.all([
    supabase
      .from("lesson_comments")
      .select("id,content_id,lesson_id,parent_comment_id,author_id,author_name,author_username,author_avatar_url,author_role,body,status,moderation_note,analysis_status,deleted_at,created_at,updated_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("lesson_comment_reactions").select("comment_id,user_id,reaction"),
    supabase.from("lesson_comment_reports").select("comment_id,reporter_id"),
    supabase
      .from("lesson_comment_blocked_words")
      .select("id,word,message,active,created_at,updated_at")
      .order("created_at", { ascending: false })
  ]);

  throwDatabaseError(commentsResult.error, "Nao foi possivel carregar a fila de moderacao");
  throwDatabaseError(reactionsResult.error, "Nao foi possivel carregar as reacoes da moderacao");
  throwDatabaseError(reportsResult.error, "Nao foi possivel carregar as denuncias da moderacao");
  throwDatabaseError(blockedWordsResult.error, "Nao foi possivel carregar as palavras bloqueadas");

  const rows = (commentsResult.data ?? []) as LessonCommentRow[];
  const lessonIds = Array.from(new Set(rows.map((row) => row.lesson_id)));
  const contentIds = Array.from(new Set(rows.map((row) => row.content_id)));
  const [lessonsResult, contentResult] = await Promise.all([
    lessonIds.length > 0
      ? supabase.from("lessons").select("id,title").in("id", lessonIds)
      : Promise.resolve({ data: [], error: null }),
    contentIds.length > 0
      ? supabase.from("content_items").select("id,title").in("id", contentIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  throwDatabaseError(lessonsResult.error, "Nao foi possivel carregar os nomes das aulas");
  throwDatabaseError(contentResult.error, "Nao foi possivel carregar os nomes dos produtos");

  const lessonTitles = new Map((lessonsResult.data ?? []).map((lesson) => [lesson.id, lesson.title]));
  const productTitles = new Map((contentResult.data ?? []).map((content) => [content.id, content.title]));
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const reactionCounts = new Map<string, number>();
  const reportCounts = new Map<string, number>();

  for (const reaction of (reactionsResult.data ?? []) as CommentReactionRow[]) {
    reactionCounts.set(reaction.comment_id, (reactionCounts.get(reaction.comment_id) ?? 0) + 1);
  }

  for (const report of (reportsResult.data ?? []) as CommentReportRow[]) {
    reportCounts.set(report.comment_id, (reportCounts.get(report.comment_id) ?? 0) + 1);
  }

  const moderationItems: AdminModerationItem[] = rows.map((row) => ({
    analysisStatus: row.analysis_status,
    authorId: row.author_id ?? undefined,
    authorName: row.author_name,
    authorRole: row.author_role,
    body: row.body,
    createdAt: row.created_at,
    id: row.id,
    kind: row.parent_comment_id ? "reply" : "comment",
    lessonId: row.lesson_id,
    lessonTitle: lessonTitles.get(row.lesson_id) ?? "Aula removida",
    moderationNote: row.moderation_note ?? undefined,
    parentAuthorName: row.parent_comment_id
      ? rowsById.get(row.parent_comment_id)?.author_name ?? "Comentario original"
      : undefined,
    productId: row.content_id,
    productTitle: productTitles.get(row.content_id) ?? "Conteudo removido",
    reactionCount: reactionCounts.get(row.id) ?? 0,
    reportCount: reportCounts.get(row.id) ?? 0,
    status: row.status,
    updatedAt: row.updated_at
  }));

  return {
    blockedWordRules: ((blockedWordsResult.data ?? []) as BlockedWordRow[]).map(blockedWordRowToRule),
    moderationItems
  };
}

export async function moderateLessonComment({
  actorId,
  commentId,
  note,
  status
}: {
  actorId: string;
  commentId: string;
  note?: string;
  status: AdminCommentStatus;
}) {
  if (!commentStatusValues.has(status)) {
    throw new LessonCommentStoreError("Status de moderacao invalido.", 400);
  }

  const supabase = getSupabaseAdminClient();
  const result = await supabase.rpc("moderate_lesson_comment", {
    p_actor_id: actorId,
    p_comment_id: commentId,
    p_note: note?.trim().slice(0, 1000) || null,
    p_status: status
  });
  throwDatabaseError(result.error, "Nao foi possivel moderar o comentario");

  return getAdminModerationData();
}

function validateBlockedWordInput(word: string, message?: string) {
  const trimmedWord = word.trim();
  const normalizedWord = normalizeCommentForModeration(trimmedWord);
  const trimmedMessage = message?.trim() || "Alguma palavra usada esta contra as regras da comunidade.";

  if (!trimmedWord || !normalizedWord || trimmedWord.length > 120) {
    throw new LessonCommentStoreError("Informe uma palavra ou termo valido de ate 120 caracteres.", 400);
  }

  if (trimmedMessage.length > 500) {
    throw new LessonCommentStoreError("A mensagem pode ter no maximo 500 caracteres.", 400);
  }

  return { message: trimmedMessage, normalizedWord, word: trimmedWord };
}

export async function createBlockedWord({
  actorId,
  message,
  word
}: {
  actorId: string;
  message?: string;
  word: string;
}) {
  const value = validateBlockedWordInput(word, message);
  const supabase = getSupabaseAdminClient();
  const result = await supabase.from("lesson_comment_blocked_words").insert({
    active: true,
    created_by: actorId,
    message: value.message,
    normalized_word: value.normalizedWord,
    updated_by: actorId,
    word: value.word
  });

  if (result.error?.code === "23505") {
    throw new LessonCommentStoreError("Esta palavra ou termo ja esta cadastrado.", 409);
  }

  throwDatabaseError(result.error, "Nao foi possivel adicionar a palavra bloqueada");
  return getAdminModerationData();
}

export async function updateBlockedWord({
  active,
  actorId,
  id
}: {
  active: boolean;
  actorId: string;
  id: string;
}) {
  const supabase = getSupabaseAdminClient();
  const result = await supabase
    .from("lesson_comment_blocked_words")
    .update({ active, updated_by: actorId })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  throwDatabaseError(result.error, "Nao foi possivel atualizar a palavra bloqueada");

  if (!result.data) {
    throw new LessonCommentStoreError("Palavra bloqueada nao encontrada.", 404);
  }

  return getAdminModerationData();
}

export async function deleteBlockedWord(id: string) {
  const supabase = getSupabaseAdminClient();
  const result = await supabase
    .from("lesson_comment_blocked_words")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  throwDatabaseError(result.error, "Nao foi possivel excluir a palavra bloqueada");

  if (!result.data) {
    throw new LessonCommentStoreError("Palavra bloqueada nao encontrada.", 404);
  }

  return getAdminModerationData();
}
