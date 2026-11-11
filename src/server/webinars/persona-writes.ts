import "server-only";

// As escritas das pessoas que comentam e da pergunta simulada (pedido do produtor de 11/11/2026; docs/30 D75 a D78;
// migracao 202611110001), que as Server Actions do roteiro (script-actions.ts), as da lista (persona-actions.ts) e o
// tick da live (live-script-tick.ts) dividem. Tudo pela service role, com as conferencias do servidor (o nome unico no
// webinario antes do indice unico do banco, a pessoa do mesmo webinario) e as frases da migracao pendente:
// - commentPersona: a pessoa de um comentario do console. Com `personaId`, a da lista (a copia dela: o nome, o papel e
//   a foto); sem ela, a pessoa nova, que entra na lista (D76: "a nova entra na lista ao enviar ou guardar"). No banco
//   sem a 202611110001 nao ha lista: o comentario segue com o Nome, o papel e a foto enviados, como antes, sem pessoa;
// - savePersonaRow e removePersonaRow: o CRUD da lista. Editar troca a copia de todos os itens do roteiro ligados a
//   pessoa (syncPersonaCopies; o que a turma ja viu nao muda: a mensagem e a pergunta guardam a copia); remover deixa
//   os itens com a copia e sem a pessoa (a ligacao sai antes, e o on delete set null do banco garante);
// - openScriptedQuestion: a pergunta simulada que o item Pergunta do roteiro abre quando entra (o "Soltar agora" e o
//   tick da live), ligada a mensagem do item (message_id), com o minuto e a copia da pessoa da mensagem. Nunca lanca:
//   a mensagem ja entrou, e uma falha so vai para o log.

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { isPendingMigrationError } from "../db/pending-migration";
import { insertScriptedQuestionRow, type ScriptedQuestionInsert } from "./chat-store";
import type { ChatMessageRow } from "./chat-rows";
import { WEBINARS_PERSONAS_MIGRATION, WebinarError, WebinarFieldError, assertNoDbError, isMissingWebinarSchema, type WebinarsDb } from "./db";
import { CHAT_LIMITS, type PersonaRole } from "./model";
import { personaCleanName, personaNameTaken, type WebinarPersona } from "./persona-model";
import {
  deletePersonaRow,
  insertPersonaRow,
  listPersonas,
  personaFromRow,
  syncPersonaCopies,
  updatePersonaRow,
  countPersonaItems,
  fetchPersonaRow
} from "./persona-store";

const PESSOAS = WEBINAR_COPY.pessoas;

/** O aviso da lista no banco sem a 202611110001. */
export const PERSONAS_MIGRATION_MESSAGE = PESSOAS.erros.migracao(WEBINARS_PERSONAS_MIGRATION);
/** O aviso da pergunta simulada no banco sem a 202611110001. */
export const SCRIPTED_QUESTION_MIGRATION_MESSAGE = PESSOAS.erros.perguntaMigracao(WEBINARS_PERSONAS_MIGRATION);
const PERSONA_MISSING_MESSAGE = PESSOAS.erros.sumiu;

function isMissing(error: unknown) {
  return isPendingMigrationError(error) || isMissingWebinarSchema(error);
}

/** Uma escrita da lista que esbarra no banco sem a 202611110001 vira 409 com a frase da migracao. */
export async function withPersonaTable<T>(work: () => Promise<T>, message: string = PERSONAS_MIGRATION_MESSAGE): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isMissing(error)) {
      throw new WebinarError(message, 409);
    }
    throw error;
  }
}

/** A pessoa de um comentario: o id na lista (nulo sem lista) e a copia que vai na mensagem, no item ou na pergunta. */
export type CommentPersona = { avatarPath: string | null; id: string | null; name: string; role: PersonaRole };

/**
 * A pessoa de um comentario do console (D76). Com `personaId`, a da lista deste webinario (a que sumiu ou e de outro
 * webinario: erro no campo); sem ela, a nova pessoa (o nome repetido: erro no campo Nome), que entra na lista. No banco
 * sem a lista, a copia enviada, sem pessoa (`listed` nulo e `id` nulo). `created`: a pessoa entrou na lista agora;
 * `listed`: a pessoa da lista (a escolhida ou a nova).
 */
export async function commentPersona(
  db: WebinarsDb,
  input: { avatarPath: string | null; name: string; personaId: string | null; role: PersonaRole; userId: string; webinarId: string }
): Promise<{ created: boolean; listed: WebinarPersona | null; persona: CommentPersona }> {
  if (input.personaId) {
    const row = await withPersonaTable(() => fetchPersonaRow(db, input.personaId as string));
    if (!row || row.webinar_id !== input.webinarId) {
      throw new WebinarFieldError("personaId", PERSONA_MISSING_MESSAGE);
    }
    const listed = personaFromRow(row);
    return { created: false, listed, persona: { avatarPath: listed.avatarPath, id: listed.id, name: listed.name, role: listed.role } };
  }

  const name = Array.from(personaCleanName(input.name)).slice(0, CHAT_LIMITS.personaName).join("");
  const list = await listPersonas(db, input.webinarId);
  if (!list.available) {
    return { created: false, listed: null, persona: { avatarPath: input.avatarPath, id: null, name, role: input.role } };
  }
  if (personaNameTaken(list.personas, name)) {
    throw new WebinarFieldError("personaName", PESSOAS.erros.nomeRepetido);
  }
  const inserted = await withPersonaTable(() => insertPersonaRow(db, { avatar_path: input.avatarPath, created_by: input.userId, name, role: input.role, webinar_id: input.webinarId }));
  if ("taken" in inserted) {
    throw new WebinarFieldError("personaName", PESSOAS.erros.nomeRepetido);
  }
  const listed = personaFromRow(inserted.row);
  return { created: true, listed, persona: { avatarPath: listed.avatarPath, id: listed.id, name: listed.name, role: listed.role } };
}

/**
 * Cria ou edita uma pessoa da lista (D75): o nome unico no webinario (a conferencia aqui e o indice unico do banco), a
 * foto so da nossa pasta (o schema) e, na edicao, a copia nova em todos os itens do roteiro dela. Devolve a pessoa,
 * se e nova e quantos itens mudaram.
 */
export async function savePersonaRow(
  db: WebinarsDb,
  input: { avatarPath: string | null; id: string | null; name: string; role: PersonaRole; userId: string; webinarId: string }
): Promise<{ created: boolean; items: number; persona: WebinarPersona }> {
  const list = await listPersonas(db, input.webinarId);
  if (!list.available) {
    throw new WebinarError(PERSONAS_MIGRATION_MESSAGE, 409);
  }
  const current = input.id ? list.personas.find((persona) => persona.id === input.id) : null;
  if (input.id && !current) {
    throw new WebinarError(PERSONA_MISSING_MESSAGE, 404);
  }
  if (personaNameTaken(list.personas, input.name, input.id)) {
    throw new WebinarFieldError("name", PESSOAS.erros.nomeRepetido);
  }

  if (!current) {
    const inserted = await withPersonaTable(() => insertPersonaRow(db, { avatar_path: input.avatarPath, created_by: input.userId, name: input.name, role: input.role, webinar_id: input.webinarId }));
    if ("taken" in inserted) {
      throw new WebinarFieldError("name", PESSOAS.erros.nomeRepetido);
    }
    return { created: true, items: 0, persona: personaFromRow(inserted.row) };
  }

  const updated = await withPersonaTable(() => updatePersonaRow(db, current.id, { avatar_path: input.avatarPath, name: input.name, role: input.role }));
  if ("taken" in updated) {
    throw new WebinarFieldError("name", PESSOAS.erros.nomeRepetido);
  }
  if (!updated.row) {
    throw new WebinarError(PERSONA_MISSING_MESSAGE, 404);
  }
  const persona = personaFromRow(updated.row);
  // A pessoa e a unidade: a copia dela vai para todos os itens do roteiro ligados a ela.
  const items = await syncPersonaCopies(db, persona);
  return { created: false, items, persona };
}

/**
 * Tira a pessoa da lista (D75): os itens do roteiro dela perdem a ligacao e ficam com a copia (o nome e a foto de agora).
 * Devolve a pessoa tirada e quantos itens a usavam; nula quando ela nao existe mais.
 */
export async function removePersonaRow(db: WebinarsDb, id: string): Promise<{ items: number; persona: WebinarPersona } | null> {
  const row = await withPersonaTable(() => fetchPersonaRow(db, id));
  if (!row) {
    return null;
  }
  const items = await countPersonaItems(db, row.id);
  // A ligacao sai antes (o on delete set null do banco faz o mesmo; aqui fica explicito e conferivel).
  const unlinked = await db.from("webinar_chat_script_items").update({ persona_id: null }).eq("persona_id", row.id).select("id");
  assertNoDbError(unlinked.error, "Webinarios: soltar os itens da pessoa");
  await deletePersonaRow(db, row.id);
  return { items, persona: personaFromRow(row) };
}

/**
 * A pergunta simulada que o item Pergunta abre quando entra na sessao (D77): ligada a mensagem do item, com o minuto
 * dela e a copia da pessoa. Nunca lanca (a mensagem do item ja entrou): a falha vai para o log. Devolve a pergunta
 * gravada (nula quando a mensagem ja tinha a pergunta, ou na falha).
 */
export async function openScriptedQuestion(
  db: WebinarsDb,
  input: { avatarPath: string | null; message: Pick<ChatMessageRow, "body" | "display_name" | "id" | "offset_ms" | "role" | "session_id">; personaId: string | null }
): Promise<Awaited<ReturnType<typeof insertScriptedQuestionRow>>> {
  const row: ScriptedQuestionInsert = {
    body: Array.from(input.message.body).slice(0, CHAT_LIMITS.question).join(""),
    display_name: input.message.display_name,
    message_id: input.message.id,
    offset_ms: input.message.offset_ms,
    persona_avatar_path: input.avatarPath,
    persona_id: input.personaId,
    persona_role: input.message.role === "team" ? "team" : "student",
    session_id: input.message.session_id
  };
  try {
    return await insertScriptedQuestionRow(db, row);
  } catch (error) {
    console.error(`[webinarios] pergunta simulada do item nao aberta (mensagem ${input.message.id}): ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
