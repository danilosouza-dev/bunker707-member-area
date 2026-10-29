"use server";

// A Server Action da traducao no console da equipe (docs/30 §1.6, fase 4f): "Refazer tradução" numa mensagem do chat
// (da turma, da equipe ou do roteiro) apaga as traducoes guardadas daquele texto em todos os idiomas, pela chave
// (translationSourceHash do corpo). A primeira traducao guardada vale para sempre (insertTranslations ignora a
// repetida) e o mesmo texto se repete em toda sessao (o roteiro, a linha mestre): sem isto, uma traducao errada ou
// envenenada nao teria como sair. A proxima leitura da sala traduz de novo. messaging.write; a auditoria leva so a
// contagem e os ids, nunca o texto. Banco sem a 202610290009: 409 com a frase da migracao.

import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { runAdminAction } from "@/server/actions/run-action";
import { recordAudit } from "@/server/audit/log";
import { isPendingMigrationError } from "@/server/db/pending-migration";
import { fetchChatMessageRow } from "./chat-store";
import { WEBINARS_TRANSLATION_MIGRATION, WebinarError, isMissingWebinarSchema, webinarsDb } from "./db";
import { translationSourceHash } from "./text-hash";
import { deleteTranslationsByHash } from "./translation-store";

const COPY = WEBINAR_COPY.traducao.console;

const clearMessageTranslationsSchema = z.object({ messageId: z.uuid({ error: COPY.mensagemNaoExiste }) });

export type ClearedTranslations = { removed: number };

/** [messaging.write] "Refazer tradução": apaga as traducoes guardadas do texto da mensagem (todos os idiomas). */
export async function clearMessageTranslations(input: { messageId: string }): Promise<ActionResult<ClearedTranslations>> {
  return runAdminAction("messaging.write", clearMessageTranslationsSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const message = await fetchChatMessageRow(db, data.messageId);
    if (!message) {
      throw new WebinarError(COPY.mensagemNaoExiste, 404);
    }
    let removed = 0;
    try {
      removed = await deleteTranslationsByHash(db, translationSourceHash(message.body));
    } catch (error) {
      if (isPendingMigrationError(error) || isMissingWebinarSchema(error)) {
        throw new WebinarError(COPY.precisaMigracao(WEBINARS_TRANSLATION_MIGRATION), 409);
      }
      throw error;
    }
    await recordAudit(db, {
      action: "webinar.translation_cleared",
      actorId: user.id,
      count: removed,
      entityId: message.webinar_id,
      entityType: "webinar",
      metadata: { message_id: message.id, session_id: message.session_id, source: message.source }
    });
    return { removed };
  });
}
