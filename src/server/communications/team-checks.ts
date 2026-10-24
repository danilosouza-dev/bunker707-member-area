import "server-only";

// "Quem envia esta na equipe?" para os Modelos (docs/28 D19): salvar um modelo recusa quem nao esta na equipe (400
// no campo, como o rascunho do aviso), e abrir um modelo (o "Usar" e o modo modelo do editor) troca quem saiu da
// equipe pela escola, em silencio no rascunho e com uma nota no topo do editor, na principal e nas seguintes. Fica
// fora de actions.ts porque um arquivo "use server" so exporta Server Actions.

import { followUpPaths } from "@/components/admin/v2/communication/follow-ups-view-model";
import { assertNoDbError, chunksOf, NoticeFieldError, type CommunicationsDb } from "./db";
import type { FollowUpDraft } from "./flow-schemas";
import { TEMPLATE_MESSAGES, type NoticeStart, type TemplatePayload } from "./template-model";

/** A mesma frase do rascunho do aviso (actions.ts). */
export const SENDER_NOT_ON_TEAM = "Escolha alguém da equipe.";

/** Nome de quem saiu da equipe quando o perfil nao tem nome. */
const UNNAMED = "sem nome";

/** Quem, entre `ids`, esta na equipe agora (admin_roles). */
export async function teamMemberIds(db: CommunicationsDb, ids: readonly string[]): Promise<Set<string>> {
  const team = new Set<string>();
  const unique = [...new Set(ids.filter(Boolean))];

  for (const part of chunksOf(unique, 150)) {
    const { data, error } = await db.from("admin_roles").select("user_id").in("user_id", part);
    assertNoDbError(error, "Comunicacao: equipe de quem envia");

    for (const row of (data ?? []) as { user_id: string }[]) {
      team.add(row.user_id);
    }
  }

  return team;
}

/** Quem envia cada seguinte (todos os niveis), pelo id do passo. */
function followUpSenders(items: readonly FollowUpDraft[], into: [string, string][] = []): [string, string][] {
  for (const item of items) {
    if (item.content.sender) {
      into.push([item.id, item.content.sender.userId]);
    }

    followUpSenders(item.children, into);
  }

  return into;
}

/**
 * Salvar o modelo (passo 3 de saveTemplate): quem envia a notificacao e cada seguinte esta na equipe. Senao, 400 em
 * "sender" ou em "followUps.<caminho>.content.sender" (o caminho do cartao), com a frase do rascunho do aviso.
 */
export async function assertTemplateSenders(db: CommunicationsDb, payload: TemplatePayload): Promise<void> {
  if (payload.kind !== "inbox") {
    return;
  }

  const main = payload.settings.sender?.userId ?? null;
  const items = payload.followUps?.items ?? [];
  const senders = followUpSenders(items);
  const ids = [...(main ? [main] : []), ...senders.map(([, userId]) => userId)];

  if (ids.length === 0) {
    return;
  }

  const team = await teamMemberIds(db, ids);

  if (main && !team.has(main)) {
    throw new NoticeFieldError("sender", SENDER_NOT_ON_TEAM);
  }

  const outside = senders.find(([, userId]) => !team.has(userId));

  if (outside) {
    throw new NoticeFieldError(`${followUpPaths(items).get(outside[0]) ?? "followUps"}.content.sender`, SENDER_NOT_ON_TEAM);
  }
}

async function profileName(db: CommunicationsDb, userId: string): Promise<string> {
  const { data, error } = await db.from("profiles").select("full_name").eq("id", userId).limit(1);
  assertNoDbError(error, "Comunicacao: nome de quem enviava");

  return ((data ?? []) as { full_name: string | null }[])[0]?.full_name?.trim() || UNNAMED;
}

/**
 * Abrir um modelo (prepareNoticeStart e prepareTemplateEditor): quem saiu da equipe vira a escola (sender null), na
 * notificacao principal e nas seguintes (todos os niveis), com senderGone(nome) e followUpSenderGone nas notas.
 * `names` (opcional): nomes ja conhecidos; sem o da pessoa, le o perfil.
 */
export async function withSendersOnTeam(db: CommunicationsDb, start: NoticeStart, names?: ReadonlyMap<string, string>): Promise<NoticeStart> {
  const main = start.draft.kind === "inbox" ? (start.draft.sender?.userId ?? null) : null;
  const senders = followUpSenders(start.followUps?.items ?? []);
  const ids = [...(main ? [main] : []), ...senders.map(([, userId]) => userId)];

  if (ids.length === 0) {
    return start;
  }

  const team = await teamMemberIds(db, ids);
  const notes = [...start.notes];
  let draft = start.draft;
  let followUps = start.followUps;

  if (main && !team.has(main)) {
    draft = { ...draft, sender: null };
    notes.push(TEMPLATE_MESSAGES.senderGone(names?.get(main) ?? (await profileName(db, main))));
  }

  if (followUps && senders.some(([, userId]) => !team.has(userId))) {
    const clean = (items: readonly FollowUpDraft[]): FollowUpDraft[] =>
      items.map((item) => ({
        ...item,
        children: clean(item.children),
        content: item.content.sender && !team.has(item.content.sender.userId) ? { ...item.content, sender: null } : item.content
      }));

    followUps = { ...followUps, items: clean(followUps.items) };
    notes.push(TEMPLATE_MESSAGES.followUpSenderGone);
  }

  return { ...start, draft, followUps, notes };
}
