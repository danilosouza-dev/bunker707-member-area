"use server";

// Server Actions da lista "Pessoas que comentam" (pedido do produtor de 11/11/2026; docs/30 §2.2, §2.4, §5.2 e D75):
// criar, editar e remover uma pessoa do webinario, do card Roteiro do editor e da entrada Roteiro do console (a mesma
// lista). A mesma permissao e o mesmo cuidado das acoes do roteiro (script-actions.ts): runWebinarAction (o modulo dos
// Webinarios na licenca, classe conteudo) com messaging.write, o webinario arquivado so de leitura, so a Live gravada e a Live ao vivo, recordAudit so com ids e
// contagens (nunca o nome digitado) e a revalidacao da pagina do webinario e do console. Editar troca a copia (o nome, o
// papel e a foto) de todos os itens do roteiro da pessoa; remover deixa os itens com a copia, fora da lista. Banco sem
// a 202611140001: 409 com a frase da migracao (persona-writes.ts). A foto vai pelo uploadPersonaPhoto de sempre
// (script-actions.ts), que devolve so o caminho.

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { recordAudit } from "@/server/audit/log";
import { deletePersonaSchema, savePersonaSchema, type SavePersonaInput } from "./chat-schemas";
import { WebinarError, webinarsDb } from "./db";
import type { WebinarPersona } from "./persona-model";
import { fetchPersonaRow } from "./persona-store";
import { removePersonaRow, savePersonaRow, withPersonaTable } from "./persona-writes";
import { runWebinarAction } from "./run-webinar-action";
import { assertWebinarNotArchived, requireWebinarRow } from "./store";

const LIST_PATH = "/admin/comunicacao/webinarios";
const ONLY_SCRIPT_WEBINARS = "A lista de pessoas que comentam é da Live gravada e da Live ao vivo.";
const PERSONA_GONE = "Essa pessoa não está mais na lista.";

export type SavedPersona = { created: boolean; items: number; persona: WebinarPersona };
export type RemovedPersona = { id: string; items: number };

function revalidateWebinar(id: string) {
  revalidatePath(`${LIST_PATH}/${id}`);
  revalidatePath(`${LIST_PATH}/${id}/sala`);
}

/** O webinario cuja lista se grava: a Live gravada ou a Live ao vivo, nunca arquivado. */
async function requirePersonaWebinar(id: string) {
  const row = await requireWebinarRow(webinarsDb(), id);
  assertWebinarNotArchived(row);
  if (row.kind !== "simulated" && row.kind !== "live") {
    throw new WebinarError(ONLY_SCRIPT_WEBINARS, 409);
  }
  return row;
}

/**
 * [messaging.write] Cria (sem `id`) ou edita uma pessoa da lista: Nome (1 a 60, unico no webinario sem caixa nem
 * espacos: o repetido volta no campo Nome), Foto (opcional, o caminho do uploadPersonaPhoto) e Aparece como. Na edicao,
 * a copia nova vai para todos os itens do roteiro da pessoa (`items`: quantos mudaram). Auditoria
 * `webinar.persona_saved`.
 */
export async function savePersona(input: SavePersonaInput): Promise<ActionResult<SavedPersona>> {
  return runWebinarAction("messaging.write", "conteudo", savePersonaSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const webinar = await requirePersonaWebinar(data.webinarId);
    const saved = await savePersonaRow(db, { avatarPath: data.avatarPath, id: data.id, name: data.name, role: data.role, userId: user.id, webinarId: webinar.id });

    await recordAudit(db, {
      action: "webinar.persona_saved",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { created: saved.created, items: saved.items, persona_id: saved.persona.id, role: saved.persona.role, with_photo: Boolean(saved.persona.avatarPath) }
    });
    revalidateWebinar(webinar.id);

    return saved;
  });
}

/**
 * [messaging.write] Tira a pessoa da lista: os itens do roteiro dela ficam com o nome e a foto de agora, sem a ligacao
 * (`items`: quantos eram, o numero que a confirmacao mostrou). O que a turma ja viu nao muda. Auditoria
 * `webinar.persona_removed`.
 */
export async function deletePersona(input: { id: string }): Promise<ActionResult<RemovedPersona>> {
  return runWebinarAction("messaging.write", "conteudo", deletePersonaSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const row = await withPersonaTable(() => fetchPersonaRow(db, data.id));

    if (!row) {
      throw new WebinarError(PERSONA_GONE, 404);
    }

    // O arquivado fica so de leitura, como o resto do roteiro.
    await requirePersonaWebinar(row.webinar_id);
    const removed = await removePersonaRow(db, row.id);

    if (!removed) {
      throw new WebinarError(PERSONA_GONE, 404);
    }

    await recordAudit(db, {
      action: "webinar.persona_removed",
      actorId: user.id,
      entityId: removed.persona.webinarId,
      entityType: "webinar",
      metadata: { items: removed.items, persona_id: removed.persona.id }
    });
    revalidateWebinar(removed.persona.webinarId);

    return { id: removed.persona.id, items: removed.items };
  });
}
