import "server-only";

// Acesso a tabela communication_templates (Modelos da Comunicacao, docs/28; migracao 202610250001): linhas, colunas e
// a guarda de versao (a mesma de updateCampaign: 0 linhas -> 404 quando o modelo nao existe mais, 409 quando mudou).
// Toda leitura passa por assertNoDbError (tabela que nao existe vira PendingMigrationError: a tela mostra o aviso da
// migracao). A limpeza dos arquivos tem a regra dela, mais estreita (media-cleanup.loadTemplateMediaUse).

import { assertNoDbError, CommunicationError, type CommunicationsDb } from "./db";
import { TEMPLATE_MESSAGES, TEMPLATES_TABLE, type TemplateDesignMode, type TemplateKind, type TemplatePayload } from "./template-model";

export const TEMPLATE_COLUMNS = "id,kind,design_mode,name,payload,created_by,updated_by,created_at,updated_at,deleted_at";
export const TEMPLATE_SUMMARY_COLUMNS = "id,kind,design_mode,name,created_by,updated_at";

/** Teto da leitura dos resumos (o limite e 200 nao excluidos; duas gravacoes juntas podem passar de 200 por um). */
const SUMMARIES_MAX = 500;

export type TemplateRow = {
  created_at: string;
  created_by: string | null;
  deleted_at: string | null;
  design_mode: TemplateDesignMode | null;
  id: string;
  kind: TemplateKind;
  name: string;
  payload: unknown;
  updated_at: string;
  updated_by: string | null;
};
export type TemplateSummaryRow = Pick<TemplateRow, "created_by" | "design_mode" | "id" | "kind" | "name" | "updated_at">;

/** O modelo nao excluido; null se nao existe ou foi excluido. */
export async function fetchTemplate(db: CommunicationsDb, id: string): Promise<TemplateRow | null> {
  const { data, error } = await db.from(TEMPLATES_TABLE).select(TEMPLATE_COLUMNS).eq("id", id).is("deleted_at", null).limit(1);
  assertNoDbError(error, "Comunicacao: modelo");

  return ((data ?? []) as TemplateRow[])[0] ?? null;
}

/** Sem options: so os nao excluidos. includeDeletedSince: tambem os excluidos depois dessa data (D16 b: now - 29 dias). */
export async function fetchTemplatesByIds(db: CommunicationsDb, ids: readonly string[], options: { includeDeletedSince?: Date } = {}): Promise<TemplateRow[]> {
  const unique = [...new Set(ids.map((id) => id.toLowerCase()))];

  if (unique.length === 0) {
    return [];
  }

  const { data, error } = await db.from(TEMPLATES_TABLE).select(TEMPLATE_COLUMNS).in("id", unique);
  assertNoDbError(error, "Comunicacao: modelos");

  const since = options.includeDeletedSince?.getTime() ?? null;

  return ((data ?? []) as TemplateRow[]).filter((row) => {
    if (!row.deleted_at) {
      return true;
    }

    const deletedAt = Date.parse(row.deleted_at);

    return since !== null && Number.isFinite(deletedAt) && deletedAt > since;
  });
}

/** Os resumos (sem payload) dos nao excluidos, mais recentes primeiro (ate 500). */
export async function listTemplateSummaries(db: CommunicationsDb): Promise<TemplateSummaryRow[]> {
  const { data, error } = await db
    .from(TEMPLATES_TABLE)
    .select(TEMPLATE_SUMMARY_COLUMNS)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(SUMMARIES_MAX);
  assertNoDbError(error, "Comunicacao: lista de modelos");

  return (data ?? []) as TemplateSummaryRow[];
}

/** Quantos modelos nao excluidos (o limite de 200 e da escola inteira). */
export async function countTemplates(db: CommunicationsDb): Promise<number> {
  const { count, error } = await db.from(TEMPLATES_TABLE).select("id", { count: "exact", head: true }).is("deleted_at", null);
  assertNoDbError(error, "Comunicacao: quantos modelos");

  return count ?? 0;
}

export async function insertTemplate(
  db: CommunicationsDb,
  row: { created_by: string; design_mode: TemplateDesignMode | null; kind: TemplateKind; name: string; payload: TemplatePayload; updated_by: string }
): Promise<TemplateRow> {
  const { data, error } = await db.from(TEMPLATES_TABLE).insert(row).select(TEMPLATE_COLUMNS).single();
  assertNoDbError(error, "Comunicacao: criar modelo");

  return data as TemplateRow;
}

type TemplatePatch = Partial<Pick<TemplateRow, "deleted_at" | "design_mode" | "name" | "payload">> & { deleted_by?: string | null; updated_by: string };

async function writeTemplate(db: CommunicationsDb, id: string, patch: TemplatePatch, guard: { expectedUpdatedAt?: string | null }): Promise<TemplateRow> {
  let query = db.from(TEMPLATES_TABLE).update(patch).eq("id", id).is("deleted_at", null);

  if (guard.expectedUpdatedAt) {
    query = query.eq("updated_at", guard.expectedUpdatedAt);
  }

  const { data, error } = await query.select(TEMPLATE_COLUMNS);
  assertNoDbError(error, "Comunicacao: gravar modelo");

  const rows = (data ?? []) as TemplateRow[];

  if (rows.length === 1) {
    return rows[0];
  }

  const current = await fetchTemplate(db, id);

  throw new CommunicationError(current ? TEMPLATE_MESSAGES.changed : TEMPLATE_MESSAGES.missing, current ? 409 : 404);
}

/** A mesma guarda de updateCampaign: .eq("id").is("deleted_at", null) [.eq("updated_at", expected)]; 0 linhas -> 404 (missing) ou 409 (changed). */
export async function updateTemplate(
  db: CommunicationsDb,
  id: string,
  patch: Partial<Pick<TemplateRow, "design_mode" | "name" | "payload">> & { updated_by: string },
  guard: { expectedUpdatedAt?: string | null }
): Promise<TemplateRow> {
  return writeTemplate(db, id, patch, guard);
}

/** Exclusao logica (deleted_at e deleted_by), com a mesma guarda de versao. */
export async function softDeleteTemplate(db: CommunicationsDb, id: string, input: { actorId: string; expectedUpdatedAt?: string | null; now: Date }): Promise<TemplateRow> {
  return writeTemplate(
    db,
    id,
    { deleted_at: input.now.toISOString(), deleted_by: input.actorId, updated_by: input.actorId },
    { expectedUpdatedAt: input.expectedUpdatedAt }
  );
}
