"use server";

// Server Actions da Comunidade (docs/17 §1.9). Toda acao passa por runAdminAction (papel + zod +
// ActionResult) e termina com refresh() de next/cache: comentarios nao fazem parte do cache do
// catalogo, entao nunca chamam invalidateCatalog. Escritas granulares: uma linha por vez.

import { refresh } from "next/cache";
import type { User } from "@supabase/supabase-js";
import type { ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { getUserDisplayName } from "@/server/auth/session";
import { normalizeCommentForModeration, validateLessonCommentBody } from "@/server/comments/comment-validation";
import { scheduleCommentReplyNotification } from "@/server/communications/comment-notifications";
import { assertNoDbError, communityDb, CommunityError, loadLessonPathResolver } from "./db";
import { COMMENT_COLUMNS, toCommentListItem, toQuickReply, type CommentRow, type QuickReplyRow } from "./mappers";
import { QUICK_REPLY_LIMIT } from "./model";
import {
  deleteQuickReplySchema,
  moderateCommentSchema,
  moderateCommentsSchema,
  quickReplySchema,
  replyToCommentSchema,
  resolveCommentSchema
} from "./schemas";
import type {
  BulkModerationResult,
  CommentListItem,
  DeleteQuickReplyInput,
  ModerateCommentInput,
  ModerateCommentsInput,
  QuickReply,
  QuickReplyInput,
  ReplyToCommentInput,
  ResolveCommentInput
} from "./types";

const DUPLICATE_REPLY_WINDOW_MS = 30_000;
const BULK_CONCURRENCY = 5;

function usernameFor(user: User, name: string) {
  const source = user.email?.split("@")[0] || name;
  const normalized = normalizeCommentForModeration(source).replace(/\s+/g, ".");

  return normalized || "professor";
}

/** Traduz os erros da RPC moderate_lesson_comment para o produtor. */
function moderationError(error: { message: string }) {
  if (/nao encontrado/i.test(error.message)) {
    return new CommunityError("Este comentário não existe mais.", 404);
  }

  if (/permissao administrativa/i.test(error.message)) {
    return new CommunityError("Seu papel na equipe não permite esta ação.", 403);
  }

  return null;
}

async function callModerationRpc(input: { actorId: string; commentId: string; note?: string; status: "approved" | "hidden" | "spam" }) {
  const result = await communityDb().rpc("moderate_lesson_comment", {
    p_actor_id: input.actorId,
    p_comment_id: input.commentId,
    p_note: input.note?.trim() || null,
    p_status: input.status
  });

  if (result.error) {
    throw moderationError(result.error) ?? new Error(`Comunidade: moderar comentario: ${result.error.message}`);
  }
}

/* ================================================================================================
 * Responder e resolver
 * ============================================================================================== */

/** [community.reply] Responde como professor na propria linha da fila; por padrao tira da fila. */
export async function replyToComment(
  input: ReplyToCommentInput
): Promise<ActionResult<{ questionId: string; reply: CommentListItem }>> {
  return runAdminAction("community.reply", replyToCommentSchema, input, async ({ input: data, user }) => {
    const db = communityDb();
    const validated = validateLessonCommentBody(data.body);

    if (validated.error) {
      throw new CommunityError("Escreva a resposta (até 2.000 caracteres).", 400);
    }

    const parentResult = await db
      .from("lesson_comments")
      .select("id,content_id,lesson_id,parent_comment_id,status")
      .eq("id", data.commentId)
      .is("deleted_at", null)
      .maybeSingle();
    assertNoDbError(parentResult.error, "Comunidade: comentario respondido");

    const parent = parentResult.data as Pick<CommentRow, "content_id" | "id" | "lesson_id" | "parent_comment_id" | "status"> | null;

    if (!parent) {
      throw new CommunityError("Este comentário não existe mais.", 404);
    }

    if (parent.parent_comment_id) {
      throw new CommunityError("Só dá para responder ao comentário principal da conversa.", 409);
    }

    if (parent.status !== "approved") {
      throw new CommunityError("Este comentário não está visível para os alunos. Restaure-o antes de responder.", 409);
    }

    const duplicateResult = await db
      .from("lesson_comments")
      .select("id")
      .eq("parent_comment_id", parent.id)
      .eq("author_id", user.id)
      .eq("body", validated.value)
      .is("deleted_at", null)
      .gte("created_at", new Date(Date.now() - DUPLICATE_REPLY_WINDOW_MS).toISOString())
      .limit(1)
      .maybeSingle();
    assertNoDbError(duplicateResult.error, "Comunidade: resposta duplicada");

    if (duplicateResult.data) {
      throw new CommunityError("Esta resposta já foi publicada.", 409);
    }

    const profileResult = await db.from("profiles").select("full_name,avatar_url").eq("id", user.id).maybeSingle();
    assertNoDbError(profileResult.error, "Comunidade: perfil do professor");

    const profile = profileResult.data as { avatar_url: string | null; full_name: string | null } | null;
    const authorName = profile?.full_name?.trim() || getUserDisplayName(user).fullName;
    const insertResult = await db
      .from("lesson_comments")
      .insert({
        author_avatar_url: profile?.avatar_url ?? null,
        author_id: user.id,
        author_name: authorName,
        author_role: "producer",
        author_username: usernameFor(user, authorName),
        body: validated.value,
        content_id: parent.content_id,
        lesson_id: parent.lesson_id,
        parent_comment_id: parent.id,
        status: "approved"
      })
      .select(COMMENT_COLUMNS)
      .single();
    assertNoDbError(insertResult.error, "Comunidade: publicar resposta");

    if (data.resolve) {
      const resolveResult = await db
        .from("lesson_comments")
        .update({ resolved_at: new Date().toISOString(), resolved_by: user.id })
        .eq("id", parent.id)
        .is("resolved_at", null);
      assertNoDbError(resolveResult.error, "Comunidade: resolver pergunta respondida");
    }

    const resolvePath = await loadLessonPathResolver([{ contentId: parent.content_id, lessonId: parent.lesson_id }]);
    const row = insertResult.data as CommentRow;

    // "Professor respondeu seu comentário" no sino do aluno (depois da resposta, melhor esforco).
    scheduleCommentReplyNotification({
      actorId: user.id,
      body: row.body,
      contentId: parent.content_id,
      lessonId: parent.lesson_id,
      parentCommentId: parent.id,
      replyId: row.id
    });

    refresh();

    return {
      questionId: parent.id,
      reply: toCommentListItem(row, {
        answered: false,
        parentAuthorName: null,
        path: resolvePath(row.content_id, row.lesson_id),
        reactionCount: 0,
        reportCount: 0
      })
    };
  }, { target: (data) => ({ commentIds: [data.commentId] }) });
}

/** [community.reply] Resolver = atendido sem responder (sai da fila). resolved=false desfaz. */
export async function resolveComment(input: ResolveCommentInput): Promise<ActionResult<{ commentId: string; resolved: boolean }>> {
  return runAdminAction("community.reply", resolveCommentSchema, input, async ({ input: data, user }) => {
    const result = await communityDb()
      .from("lesson_comments")
      .update(data.resolved ? { resolved_at: new Date().toISOString(), resolved_by: user.id } : { resolved_at: null, resolved_by: null })
      .eq("id", data.commentId)
      .is("parent_comment_id", null)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    assertNoDbError(result.error, "Comunidade: resolver pergunta");

    if (!result.data) {
      throw new CommunityError("Este comentário não existe mais.", 404);
    }

    refresh();

    return { commentId: data.commentId, resolved: data.resolved };
  }, { target: (data) => ({ commentIds: [data.commentId] }) });
}

/* ================================================================================================
 * Moderacao
 * ============================================================================================== */

/** [community.moderate] Manter visivel/aprovar, ocultar ou marcar spam (RPC com historico). */
export async function moderateComment(
  input: ModerateCommentInput
): Promise<ActionResult<{ commentId: string; status: "approved" | "hidden" | "spam" }>> {
  return runAdminAction("community.moderate", moderateCommentSchema, input, async ({ input: data, user }) => {
    await callModerationRpc({ actorId: user.id, commentId: data.commentId, note: data.note, status: data.status });
    refresh();

    return { commentId: data.commentId, status: data.status };
  }, { target: (data) => ({ commentIds: [data.commentId] }) });
}

/** [community.moderate] Mesma moderacao para varios comentarios (ate 50), um por vez na RPC. */
export async function moderateComments(input: ModerateCommentsInput): Promise<ActionResult<BulkModerationResult>> {
  return runAdminAction("community.moderate", moderateCommentsSchema, input, async ({ input: data, user }) => {
    const updated: string[] = [];
    const failed: string[] = [];
    const queue = [...data.commentIds];

    async function worker() {
      for (let commentId = queue.shift(); commentId; commentId = queue.shift()) {
        try {
          await callModerationRpc({ actorId: user.id, commentId, note: data.note, status: data.status });
          updated.push(commentId);
        } catch (error) {
          if (error instanceof CommunityError && error.status === 403) {
            throw error;
          }

          console.error("[community:moderateComments]", commentId, error);
          failed.push(commentId);
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, queue.length) }, () => worker()));

    if (updated.length > 0) {
      refresh();
    }

    return { failed, status: data.status, updated };
  }, { target: (data) => ({ commentIds: data.commentIds }) });
}

/* ================================================================================================
 * Respostas rapidas
 * ============================================================================================== */

/** [community.reply] Cria (sem id) ou edita uma resposta rapida. */
export async function saveQuickReply(input: QuickReplyInput): Promise<ActionResult<QuickReply>> {
  return runAdminAction("community.reply", quickReplySchema, input, async ({ input: data, user }) => {
    const db = communityDb();

    if (data.id) {
      const result = await db
        .from("community_quick_replies")
        .update({ body: data.body, title: data.title, updated_by: user.id })
        .eq("id", data.id)
        .select("id,title,body,updated_at")
        .maybeSingle();
      assertNoDbError(result.error, "Comunidade: editar resposta rapida");

      if (!result.data) {
        throw new CommunityError("Esta resposta rápida não existe mais.", 404);
      }

      refresh();

      return toQuickReply(result.data as QuickReplyRow);
    }

    const countResult = await db.from("community_quick_replies").select("id", { count: "exact", head: true });
    assertNoDbError(countResult.error, "Comunidade: contar respostas rapidas");

    const count = countResult.count ?? 0;

    if (count >= QUICK_REPLY_LIMIT) {
      throw new CommunityError(`Você já tem ${QUICK_REPLY_LIMIT} respostas rápidas. Exclua uma antes de criar outra.`, 422);
    }

    const result = await db
      .from("community_quick_replies")
      .insert({ body: data.body, created_by: user.id, sort_order: count, title: data.title, updated_by: user.id })
      .select("id,title,body,updated_at")
      .single();
    assertNoDbError(result.error, "Comunidade: criar resposta rapida");

    refresh();

    return toQuickReply(result.data as QuickReplyRow);
  });
}

/** [community.reply] Exclui uma resposta rapida (a tela oferece "Desfazer" recriando o texto). */
export async function deleteQuickReply(input: DeleteQuickReplyInput): Promise<ActionResult<{ id: string }>> {
  return runAdminAction("community.reply", deleteQuickReplySchema, input, async ({ input: data }) => {
    const result = await communityDb().from("community_quick_replies").delete().eq("id", data.id).select("id").maybeSingle();
    assertNoDbError(result.error, "Comunidade: excluir resposta rapida");

    if (!result.data) {
      throw new CommunityError("Esta resposta rápida não existe mais.", 404);
    }

    refresh();

    return { id: data.id };
  });
}
