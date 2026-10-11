"use server";

// Palavras bloqueadas (aba Regras). Mesma tabela e mesma normalizacao do bloqueio na publicacao do
// aluno (src/server/comments/comment-store.ts), com escrita de uma linha por vez e mensagens com
// acento. O admin antigo continua usando as rotas /api/admin/moderation/blocked-words.

import { refresh } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import type { AdminBlockedWordRule } from "@/lib/platform-types";
import { runAdminAction } from "@/server/actions/run-action";
import { normalizeCommentForModeration } from "@/server/comments/comment-validation";
import { assertNoDbError, communityDb, CommunityError } from "./db";
import { toBlockedWordRule, type BlockedWordRow } from "./mappers";
import { blockedWordSchema, deleteBlockedWordSchema, toggleBlockedWordSchema } from "./schemas";
import type { BlockedWordInput, DeleteBlockedWordInput, ToggleBlockedWordInput } from "./types";

const DEFAULT_BLOCKED_MESSAGE = "Alguma palavra usada está contra as regras da comunidade.";
const BLOCKED_WORD_COLUMNS = "id,word,message,active,created_at,updated_at";

/** [community.moderate] Acrescenta uma palavra ou termo (ativo). Duplicado -> 409. */
export async function createBlockedWord(input: BlockedWordInput): Promise<ActionResult<AdminBlockedWordRule>> {
  return runAdminAction("community.moderate", blockedWordSchema, input, async ({ input: data, user }) => {
    const word = data.word.trim();
    const normalizedWord = normalizeCommentForModeration(word);

    if (!word || !normalizedWord) {
      throw new CommunityError("Informe uma palavra ou termo válido de até 120 caracteres.", 400);
    }

    const result = await communityDb()
      .from("lesson_comment_blocked_words")
      .insert({
        active: true,
        created_by: user.id,
        message: data.message?.trim() || DEFAULT_BLOCKED_MESSAGE,
        normalized_word: normalizedWord,
        updated_by: user.id,
        word
      })
      .select(BLOCKED_WORD_COLUMNS)
      .single();

    if (result.error?.code === "23505") {
      throw new CommunityError("Esta palavra ou termo já está cadastrado.", 409);
    }

    assertNoDbError(result.error, "Comunidade: adicionar palavra bloqueada");
    refresh();

    return toBlockedWordRule(result.data as BlockedWordRow);
  });
}

/** [community.moderate] Liga ou desliga uma palavra sem apagar. */
export async function toggleBlockedWord(input: ToggleBlockedWordInput): Promise<ActionResult<AdminBlockedWordRule>> {
  return runAdminAction("community.moderate", toggleBlockedWordSchema, input, async ({ input: data, user }) => {
    const result = await communityDb()
      .from("lesson_comment_blocked_words")
      .update({ active: data.active, updated_by: user.id })
      .eq("id", data.id)
      .select(BLOCKED_WORD_COLUMNS)
      .maybeSingle();
    assertNoDbError(result.error, "Comunidade: atualizar palavra bloqueada");

    if (!result.data) {
      throw new CommunityError("Palavra bloqueada não encontrada.", 404);
    }

    refresh();

    return toBlockedWordRule(result.data as BlockedWordRow);
  });
}

/** [community.moderate] Exclui; a tela oferece "Desfazer" recriando a mesma palavra. */
export async function deleteBlockedWord(input: DeleteBlockedWordInput): Promise<ActionResult<{ id: string }>> {
  return runAdminAction("community.moderate", deleteBlockedWordSchema, input, async ({ input: data }) => {
    const result = await communityDb()
      .from("lesson_comment_blocked_words")
      .delete()
      .eq("id", data.id)
      .select("id")
      .maybeSingle();
    assertNoDbError(result.error, "Comunidade: excluir palavra bloqueada");

    if (!result.data) {
      throw new CommunityError("Palavra bloqueada não encontrada.", 404);
    }

    refresh();

    return { id: data.id };
  });
}
