"use server";

// Server Actions dos Modelos da Comunicacao (docs/28 §4.4): salvar (editor do aviso, card Design, editor Livre e modo
// modelo), salvar a partir do aviso gravado (menu ⋯ da lista e do relatorio), renomear, duplicar, excluir e a leitura
// de "Meus modelos" (card Design e editor Livre). Todas pedem messaging.write (quem cria avisos), pelo runAdminAction:
// a analista recebe 403 e quem esta sem sessao, 401.
//
// - limite de 200 modelos nao excluidos da escola, conferido antes de criar (422);
// - concorrencia otimista por updated_at (409 "mudou em outra tela"); o tipo e o modo do Design nunca mudam (400);
// - quem envia (notificacao e seguintes) na equipe (400 no campo), fontes na biblioteca (400), arquivos do design
//   conferidos sem nunca apagar, com os conhecidos do proprio modelo, do aviso e dos modelos de onde ele veio (D16);
// - o payload final passa no schema estrito (templatePayloadSchema) e no teto de 768 KB (400 tooBig);
// - auditoria so com ids encontrados no banco, codigos e contagens, nunca o nome do modelo (D21);
// - nenhuma acao chama revalidatePath (D28): a lista atualiza com router.refresh, o editor nao atualiza nada.

import { goalOfStopLine, stopLineOfGoal, type SavedFollowUp } from "@/components/admin/v2/communication/follow-ups-view-model";
import type { ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { recordAudit } from "@/server/audit/log";
import { isSameVersion } from "./campaign-model";
import { assertNoDbError, communicationsDb, CommunicationError, NoticeFieldError, type CommunicationsDb } from "./db";
import { checkDesignFiles } from "./design-checks";
import type { FollowUpDraft } from "./flow-schemas";
import { isMissingTemplatesTable } from "./media-cleanup";
import type { PopupDesign, PopupFontFace } from "./popup-design-model";
import { parseStoredPopupDesign } from "./popup-design-router";
import { assertPopupDesignFonts, loadPopupFontFaces } from "./popup-fonts";
import type { PopupFreeDesign } from "./popup-free-model";
import { loadNoticeFollowUpDrafts, noticeDraftOfRow } from "./queries";
import { fetchCampaign, NOTICE_MISSING_MESSAGE } from "./store";
import { assertTemplateSenders } from "./team-checks";
import {
  duplicateTemplateName,
  loadDesignTemplatesSchema,
  parseTemplatePayload,
  renameTemplateSchema,
  saveTemplateFromNoticeSchema,
  saveTemplateSchema,
  TEMPLATE_LIMITS,
  TEMPLATE_MESSAGES,
  templateDesignModeOf,
  templateIdInputSchema,
  templatePayloadOfDesign,
  templatePayloadOfDraft,
  templatePayloadSchema,
  TEMPLATES_TABLE,
  type SaveTemplateInput,
  type TemplateDesignMode,
  type TemplateDesignSupport,
  type TemplateFollowUps,
  type TemplateInclude,
  type TemplateKind,
  type TemplatePayload
} from "./template-model";
import {
  countTemplates,
  fetchTemplate,
  fetchTemplatesByIds,
  insertTemplate,
  softDeleteTemplate,
  TEMPLATE_COLUMNS,
  updateTemplate,
  type TemplateRow
} from "./template-store";

export type SavedTemplate = { designMode: TemplateDesignMode | null; id: string; kind: TemplateKind; name: string; notes: string[]; updatedAt: string };
export type DesignTemplateOption = {
  design: PopupDesign | PopupFreeDesign;
  id: string;
  mode: TemplateDesignMode;
  name: string;
  support: TemplateDesignSupport;
  updatedAt: string;
};

const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------------------------------------
 * Apoio
 * ---------------------------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function assertRoom(db: CommunicationsDb) {
  if ((await countTemplates(db)) >= TEMPLATE_LIMITS.maxTemplates) {
    throw new CommunicationError(TEMPLATE_MESSAGES.limit, 422);
  }
}

function assertVersion(row: TemplateRow, expectedUpdatedAt: string | undefined) {
  if (expectedUpdatedAt && !isSameVersion(expectedUpdatedAt, row.updated_at)) {
    throw new CommunicationError(TEMPLATE_MESSAGES.changed, 409);
  }
}

function designOf(payload: TemplatePayload): PopupDesign | PopupFreeDesign | null {
  return payload.kind === "inbox" ? null : payload.design;
}

function isFree(design: PopupDesign | PopupFreeDesign) {
  return (design as { mode?: unknown }).mode === "free";
}

function countFollowUps(items: readonly FollowUpDraft[]): number {
  return items.reduce((sum, item) => sum + 1 + countFollowUps(item.children), 0);
}

/** Os designs ja conferidos (D16 b) e os ids encontrados (so eles vao para a auditoria). */
type KnownDesigns = { designs: unknown[]; sourceCampaignId: string | null; sourceTemplateIds: string[] };

/**
 * Passo 5: os designs conhecidos. O design gravado do proprio modelo (no update); o popup_design do aviso de onde o
 * modelo veio (nao excluido ou excluido ha menos de 29 dias); o payload.design dos modelos aplicados (idem).
 */
async function knownDesigns(
  db: CommunicationsDb,
  input: { current: TemplateRow | null; now: Date; sourceNoticeId: string | null | undefined; sourceTemplateIds: readonly string[] }
): Promise<KnownDesigns> {
  const since = new Date(input.now.getTime() - TEMPLATE_LIMITS.deletedKnownDays * DAY_MS);
  const designs: unknown[] = [];
  let sourceCampaignId: string | null = null;

  if (input.current && isRecord(input.current.payload)) {
    designs.push(input.current.payload.design ?? null);
  }

  if (input.sourceNoticeId) {
    const { data, error } = await db.from("campaigns").select("id,popup_design,deleted_at").eq("id", input.sourceNoticeId).limit(1);
    assertNoDbError(error, "Comunicacao: aviso de onde o modelo veio");

    const notice = ((data ?? []) as { deleted_at: string | null; id: string; popup_design: unknown }[])[0];
    const deletedAt = notice?.deleted_at ? Date.parse(notice.deleted_at) : null;

    if (notice && (deletedAt === null || (Number.isFinite(deletedAt) && deletedAt > since.getTime()))) {
      designs.push(notice.popup_design);
      sourceCampaignId = notice.id;
    }
  }

  const templates = await fetchTemplatesByIds(db, input.sourceTemplateIds, { includeDeletedSince: since });

  for (const template of templates) {
    designs.push(isRecord(template.payload) ? (template.payload.design ?? null) : null);
  }

  return { designs, sourceCampaignId, sourceTemplateIds: templates.map((template) => template.id) };
}

/** Passos 3 a 8: equipe, fontes, arquivos (so no saveTemplate), schema, gravar e auditoria. */
async function finishSave(input: {
  /** false no menu ⋯: os caminhos vem da linha gravada do aviso (D16 b). */
  checkFiles: boolean;
  current: TemplateRow | null;
  db: CommunicationsDb;
  expectedUpdatedAt?: string;
  known: KnownDesigns | null;
  name: string;
  notes: string[];
  origin: string;
  payload: TemplatePayload;
  userId: string;
}): Promise<SavedTemplate> {
  const { current, db } = input;
  let payload = input.payload;
  const design = designOf(payload);

  // 3. Quem envia (notificacao e seguintes) na equipe.
  await assertTemplateSenders(db, payload);

  // 4. Fontes na biblioteca.
  if (design) {
    await assertPopupDesignFonts(db, design, isFree(design) ? "freeDesign.fonts" : "design.fonts");
  }

  // 5. Arquivos conferidos (nunca apaga): URLs recalculadas (Personalizado) e medidas das imagens (Livre).
  if (design && input.checkFiles && input.known) {
    const checked = await checkDesignFiles(db, design, input.known.designs);
    payload = payload.kind === "design" ? { ...payload, design: checked } : payload.kind === "popup" ? { ...payload, design: checked } : payload;
  }

  // 6. O payload final no schema estrito; acima do teto, tooBig.
  const parsed = templatePayloadSchema.safeParse(payload);

  if (!parsed.success) {
    const tooBig = parsed.error.issues.some((issue) => issue.message === TEMPLATE_MESSAGES.tooBig);

    throw new CommunicationError(tooBig ? TEMPLATE_MESSAGES.tooBig : (parsed.error.issues[0]?.message ?? TEMPLATE_MESSAGES.unreadable), 400);
  }

  const stored = parsed.data;
  const designMode = templateDesignModeOf(stored);

  // 7. Grava.
  const row = current
    ? await updateTemplate(db, current.id, { design_mode: designMode, name: input.name, payload: stored, updated_by: input.userId }, { expectedUpdatedAt: input.expectedUpdatedAt })
    : await insertTemplate(db, { created_by: input.userId, design_mode: designMode, kind: stored.kind, name: input.name, payload: stored, updated_by: input.userId });

  // 8. Auditoria: so ids encontrados, codigos e contagens (nunca o nome).
  await recordAudit(db, {
    action: "communication.template_saved",
    actorId: input.userId,
    entityId: row.id,
    entityType: "communication_template",
    metadata: {
      created: !current,
      design_mode: designMode,
      follow_ups: stored.kind === "inbox" && stored.followUps ? countFollowUps(stored.followUps.items) : 0,
      kind: stored.kind,
      origin: input.origin,
      source_campaign_id: input.known?.sourceCampaignId ?? null,
      source_template_ids: input.known?.sourceTemplateIds ?? [],
      with_audience: stored.kind !== "design" && stored.audience !== null,
      with_content: stored.kind !== "design" && stored.content !== null
    }
  });

  return { designMode, id: row.id, kind: row.kind, name: row.name, notes: input.notes, updatedAt: row.updated_at };
}

/** SavedFollowUp (o cartao gravado) -> FollowUpDraft: sem o campaignId, em todos os niveis. */
function draftsOfSaved(items: readonly SavedFollowUp[]): FollowUpDraft[] {
  return items.map((item) => ({ children: draftsOfSaved(item.children), content: item.content, id: item.id, when: item.when, who: item.who }));
}

/* ------------------------------------------------------------------------------------------------
 * Acoes
 * ---------------------------------------------------------------------------------------------- */

/** [messaging.write] Cria (sem id) ou atualiza (com id + expectedUpdatedAt). Editor do aviso (dialogo), card Design, editor Livre e modo modelo. */
export async function saveTemplate(input: SaveTemplateInput): Promise<ActionResult<SavedTemplate>> {
  return runAdminAction("messaging.write", saveTemplateSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const now = new Date();
    const requestKind: TemplateKind = data.body.source === "design" ? "design" : data.body.draft.kind;
    let current: TemplateRow | null = null;

    // 1. Versao, tipo e limite.
    if (data.id) {
      current = await fetchTemplate(db, data.id);

      if (!current) {
        throw new CommunicationError(TEMPLATE_MESSAGES.missing, 404);
      }

      assertVersion(current, data.expectedUpdatedAt);

      if (current.kind !== requestKind) {
        throw new NoticeFieldError("kind", TEMPLATE_MESSAGES.kindFixed);
      }
    } else {
      await assertRoom(db);
    }

    // 2. O payload.
    let notes: string[] = [];
    let payload: TemplatePayload;

    if (data.body.source === "notice") {
      const built = templatePayloadOfDraft({ draft: data.body.draft, followUps: data.body.followUps, include: data.body.include });
      notes = built.notes;
      payload = built.payload;
    } else {
      payload = templatePayloadOfDesign({ design: data.body.design, freeDesign: data.body.freeDesign, support: data.body.support });
    }

    // O modo do Design nao muda (D1).
    if (current && current.kind === "design" && templateDesignModeOf(payload) !== current.design_mode) {
      throw new NoticeFieldError("kind", TEMPLATE_MESSAGES.kindFixed);
    }

    const known = designOf(payload)
      ? await knownDesigns(db, { current, now, sourceNoticeId: data.sourceNoticeId, sourceTemplateIds: data.sourceTemplateIds })
      : null;

    return finishSave({
      checkFiles: true,
      current,
      db,
      expectedUpdatedAt: data.expectedUpdatedAt,
      known,
      name: data.name,
      notes,
      origin: data.origin,
      payload,
      userId: user.id
    });
  });
}

/** [messaging.write] Menu ⋯ da lista e do relatorio: a versao gravada do aviso (sempre cria). */
export async function saveTemplateFromNotice(input: { include: TemplateInclude; name: string; noticeId: string }): Promise<ActionResult<SavedTemplate>> {
  return runAdminAction("messaging.write", saveTemplateFromNoticeSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();

    // 1. Limite (a mesma regra das outras criacoes).
    await assertRoom(db);

    // 2. O aviso nao excluido; passo de fluxo muda pelo fluxo.
    const row = await fetchCampaign(db, data.noticeId);

    if (!row) {
      throw new CommunicationError(NOTICE_MISSING_MESSAGE, 404);
    }

    if (row.flow_id) {
      throw new CommunicationError(TEMPLATE_MESSAGES.flowStep, 409);
    }

    // 3. Design gravado que nao passa no schema (a leitura daria Padrao em silencio): recusa (D30).
    if (row.kind === "popup" && row.popup_design !== null) {
      const stored = parseStoredPopupDesign(row.popup_design);

      if (!stored.design && !stored.freeDesign) {
        throw new CommunicationError(TEMPLATE_MESSAGES.designUnreadable, 409);
      }
    }

    // 4. O rascunho da linha e as seguintes (quando a chave vem ligada).
    const draft = noticeDraftOfRow(row);
    const notes: string[] = [];
    let followUps: TemplateFollowUps | null = null;

    if (data.include.followUps && row.kind === "inbox") {
      const loaded = await loadNoticeFollowUpDrafts(db, row);

      if (loaded && loaded.items === null) {
        notes.push(TEMPLATE_MESSAGES.noteBuilderOnly);
      } else if (loaded && loaded.items && loaded.items.length > 0) {
        const stop = stopLineOfGoal(loaded.goal);

        if (stop.kind === "other") {
          notes.push(TEMPLATE_MESSAGES.noteOtherGoal);
        }

        followUps = { entryId: loaded.entryId, goal: stop.kind === "other" ? null : goalOfStopLine(stop), items: draftsOfSaved(loaded.items) };
      }
    }

    const built = templatePayloadOfDraft({ draft, followUps, include: data.include });

    // 5. Sem a conferencia de arquivos: os caminhos vem da linha gravada (D16 b).
    return finishSave({
      checkFiles: false,
      current: null,
      db,
      known: { designs: [], sourceCampaignId: row.id, sourceTemplateIds: [] },
      name: data.name,
      notes: [...notes, ...built.notes],
      origin: "notice_menu",
      payload: built.payload,
      userId: user.id
    });
  });
}

/** [messaging.write] Novo nome (1 a 80 caracteres); nunca mexe no payload. */
export async function renameTemplate(input: { expectedUpdatedAt: string; id: string; name: string }): Promise<ActionResult<{ id: string; name: string; updatedAt: string }>> {
  return runAdminAction("messaging.write", renameTemplateSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const row = await updateTemplate(db, data.id, { name: data.name, updated_by: user.id }, { expectedUpdatedAt: data.expectedUpdatedAt });

    await recordAudit(db, { action: "communication.template_renamed", actorId: user.id, entityId: row.id, entityType: "communication_template", metadata: {} });

    return { id: row.id, name: row.name, updatedAt: row.updated_at };
  });
}

/** [messaging.write] Copia com " (cópia)" no nome e o mesmo payload cru (partes que nao abrem ficam como estao). */
export async function duplicateTemplate(input: { expectedUpdatedAt?: string; id: string }): Promise<ActionResult<{ id: string; name: string; updatedAt: string }>> {
  return runAdminAction("messaging.write", templateIdInputSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();

    await assertRoom(db);

    const row = await fetchTemplate(db, data.id);

    if (!row) {
      throw new CommunicationError(TEMPLATE_MESSAGES.missing, 404);
    }

    assertVersion(row, data.expectedUpdatedAt);

    const copy = await insertTemplate(db, {
      created_by: user.id,
      design_mode: row.design_mode,
      kind: row.kind,
      name: duplicateTemplateName(row.name),
      payload: row.payload as TemplatePayload,
      updated_by: user.id
    });

    await recordAudit(db, {
      action: "communication.template_duplicated",
      actorId: user.id,
      entityId: copy.id,
      entityType: "communication_template",
      metadata: { kind: copy.kind, source_id: row.id }
    });

    return { id: copy.id, name: copy.name, updatedAt: copy.updated_at };
  });
}

/** [messaging.write] Exclusao logica (deleted_at); nada no Storage (a limpeza cuida dos arquivos, D17). */
export async function deleteTemplate(input: { expectedUpdatedAt?: string; id: string }): Promise<ActionResult<{ id: string }>> {
  return runAdminAction("messaging.write", templateIdInputSchema, input, async ({ input: data, user }) => {
    const db = communicationsDb();
    const row = await softDeleteTemplate(db, data.id, { actorId: user.id, expectedUpdatedAt: data.expectedUpdatedAt, now: new Date() });

    await recordAudit(db, {
      action: "communication.template_deleted",
      actorId: user.id,
      entityId: row.id,
      entityType: "communication_template",
      metadata: { design_mode: row.design_mode, kind: row.kind }
    });

    return { id: row.id };
  });
}

/**
 * [messaging.write] Leitura para "Meus modelos" (card Design e editor Livre): os 50 mais recentes do modo, com as fontes
 * resolvidas. Sem a tabela (migracao 202610250001 pendente; a regra estreita de isMissingTemplatesTable), a lista vem
 * vazia: "Meus modelos" nao aparece e o card fica como antes. Qualquer outro erro lanca.
 */
export async function loadDesignTemplates(input: { mode: TemplateDesignMode }): Promise<ActionResult<{ fonts: PopupFontFace[]; items: DesignTemplateOption[]; total: number }>> {
  return runAdminAction("messaging.write", loadDesignTemplatesSchema, input, async ({ input: data }) => {
    const db = communicationsDb();
    const [list, counted] = await Promise.all([
      db
        .from(TEMPLATES_TABLE)
        .select(TEMPLATE_COLUMNS)
        .eq("kind", "design")
        .eq("design_mode", data.mode)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: true })
        .limit(TEMPLATE_LIMITS.pickerItems),
      db.from(TEMPLATES_TABLE).select("id", { count: "exact", head: true }).eq("kind", "design").eq("design_mode", data.mode).is("deleted_at", null)
    ]);

    if (isMissingTemplatesTable(list.error) || isMissingTemplatesTable(counted.error)) {
      return { fonts: [], items: [], total: 0 };
    }

    assertNoDbError(list.error, "Comunicacao: meus modelos de design");
    assertNoDbError(counted.error, "Comunicacao: quantos modelos de design");

    const items: DesignTemplateOption[] = [];

    for (const row of ((list.data ?? []) as TemplateRow[]).slice(0, TEMPLATE_LIMITS.pickerItems)) {
      const { payload } = parseTemplatePayload(row.kind, row.payload);

      if (payload?.kind === "design" && templateDesignModeOf(payload) === data.mode) {
        items.push({ design: payload.design, id: row.id, mode: data.mode, name: row.name, support: payload.designSupport, updatedAt: row.updated_at });
      }
    }

    const fontIds = [...new Set(items.flatMap((item) => item.design.fonts))];
    const fonts = fontIds.length > 0 ? await loadPopupFontFaces(db, fontIds) : [];

    return { fonts, items, total: counted.count ?? items.length };
  });
}
