import "server-only";

// Notificacoes automaticas de comentario (docs/22 §2): quem escreveu o comentario principal recebe
// "{Nome} respondeu seu comentário"; quem foi citado no comeco da resposta ("@ana.souza ...", formato que
// a tela da aula escreve ao responder a uma resposta) recebe "{Nome} mencionou você". A mencao so vale
// para quem ja escreveu naquela conversa (o @usuario nao e unico na escola) e so quando um unico autor
// tem aquele @usuario. Quem respondeu nunca recebe a propria notificacao.
//
// Melhor esforco: roda depois da resposta (after() do Next), nunca derruba a publicacao do comentario e
// qualquer falha vira log. As duas portas de entrada chamam scheduleCommentReplyNotification: a aula
// (createLessonComment) e a Comunidade do admin (replyToComment).

import { after } from "next/server";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { commentSnippet, lessonNotificationHref, parseLeadingMention } from "./notification-model";

export type CommentReplyNotificationInput = {
  actorId: string;
  body: string;
  contentId: string;
  lessonId: string;
  parentCommentId: string;
  replyId: string;
};

type ThreadComment = { author_id: string | null; author_username: string | null; id: string };

const LESSON_TITLE_MAX = 200;

/** Grava as notificacoes da resposta. Nunca lanca: erro vira log "[notificacoes] ...". */
export async function notifyCommentReply(input: CommentReplyNotificationInput): Promise<void> {
  try {
    const db = getSupabaseAdminClient();
    const [parentResult, repliesResult, lessonResult] = await Promise.all([
      db.from("lesson_comments").select("id,author_id,author_username").eq("id", input.parentCommentId).maybeSingle(),
      db
        .from("lesson_comments")
        .select("id,author_id,author_username")
        .eq("parent_comment_id", input.parentCommentId)
        .eq("status", "approved")
        .is("deleted_at", null)
        .limit(500),
      db.from("lessons").select("id,module_id,title").eq("id", input.lessonId).maybeSingle()
    ]);

    for (const result of [parentResult, repliesResult, lessonResult]) {
      if (result.error) {
        throw new Error(result.error.message);
      }
    }

    const parent = parentResult.data as ThreadComment | null;
    const lesson = lessonResult.data as { id: string; module_id: string; title: string | null } | null;

    if (!parent || !lesson) {
      return;
    }

    const recipients: { kind: "comment_mention" | "comment_reply"; userId: string }[] = [];

    if (parent.author_id && parent.author_id !== input.actorId) {
      recipients.push({ kind: "comment_reply", userId: parent.author_id });
    }

    const mention = parseLeadingMention(input.body);

    if (mention) {
      const thread = [parent, ...((repliesResult.data ?? []) as ThreadComment[])];
      const authors = new Set(
        thread
          .filter((comment) => comment.author_id && comment.author_username?.trim().toLocaleLowerCase("en-US") === mention)
          .map((comment) => comment.author_id as string)
      );
      const [mentioned] = authors;

      if (authors.size === 1 && mentioned !== input.actorId && mentioned !== parent.author_id) {
        recipients.push({ kind: "comment_mention", userId: mentioned });
      }
    }

    if (recipients.length === 0) {
      return;
    }

    const lessonTitle = lesson.title?.trim().slice(0, LESSON_TITLE_MAX) || null;
    const href = lessonNotificationHref({ contentId: input.contentId, lessonId: input.lessonId, moduleId: lesson.module_id });
    const body = commentSnippet(input.body);
    const { error } = await db.from("notifications").upsert(
      recipients.map((recipient) => ({
        actor_id: input.actorId,
        body,
        dedupe_key: `${recipient.kind === "comment_reply" ? "comment-reply" : "comment-mention"}:${input.replyId}`,
        href,
        kind: recipient.kind,
        payload: {
          commentId: input.replyId,
          contentId: input.contentId,
          lessonId: input.lessonId,
          lessonTitle,
          moduleId: lesson.module_id,
          parentCommentId: input.parentCommentId
        },
        title: null,
        user_id: recipient.userId
      })),
      { ignoreDuplicates: true, onConflict: "user_id,dedupe_key" }
    );

    if (error) {
      throw new Error(error.message);
    }
  } catch (error) {
    console.error(`[notificacoes] resposta ${input.replyId} sem notificacao: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Fora de um pedido do Next (scripts, testes de integracao) o trabalho roda na hora; fica guardado aqui. */
const pending = new Set<Promise<void>>();

/**
 * Agenda as notificacoes para depois da resposta HTTP (after() do Next); fora de um pedido, roda na
 * hora sem esperar. Mesmo padrao de scheduleStudentActivity em platform-store.
 */
export function scheduleCommentReplyNotification(input: CommentReplyNotificationInput) {
  const task = () => notifyCommentReply(input);

  try {
    after(task);
  } catch {
    const running = task().finally(() => pending.delete(running));
    pending.add(running);
  }
}

/** Espera as notificacoes que rodaram fora de um pedido do Next (testes de integracao). */
export async function settleCommentNotifications() {
  await Promise.allSettled([...pending]);
}
