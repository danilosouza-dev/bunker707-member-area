import "server-only";

// Leituras dos Modelos da Comunicacao (docs/28 §4.3): a lista da aba Modelos, o detalhe, a preparacao do editor (o
// "Usar" e o "Novo aviso com modelo", com ids novos, e o modo modelo, com os ids gravados) e os recentes do menu do
// "Novo aviso". Chamadas pelas paginas do admin depois de requirePageArea("comunicacao") e da permissao
// messaging.write; banco sem a migracao 202610250001 -> PendingMigrationError (a pagina mostra o aviso da migracao).
// Nenhuma rota do aluno nem rota /api le estes modulos (tests/comunicacao-modelos.guard.test.mjs).

import { EVERYONE, type AudienceDefinition } from "./audience-model";
import { assertNoDbError, chunksOf, communicationsDb, type CommunicationsDb } from "./db";
import type { FollowUpDraft } from "./flow-schemas";
import type { PopupDesign, PopupFontFace } from "./popup-design-model";
import { loadPopupFontFaces } from "./popup-fonts";
import type { PopupFreeDesign } from "./popup-free-model";
import type { NoticeIconChoice } from "./schemas";
import { withSendersOnTeam } from "./team-checks";
import {
  designTemplateDraft,
  emptyTemplateStart,
  noticeStartOfTemplate,
  parseTemplatePayload,
  TEMPLATE_LIMITS,
  templateDesignModeOf,
  templateIncludeOf,
  templateSummary,
  templateTypeLabel,
  templateTypeOf,
  type NoticeStart,
  type TemplateDesignMode,
  type TemplateInclude,
  type TemplateKind,
  type TemplatePayload,
  type TemplateType
} from "./template-model";
import { fetchTemplate, fetchTemplatesByIds, listTemplateSummaries, type TemplateRow, type TemplateSummaryRow } from "./template-store";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TemplateFilter = "all" | TemplateType;
export type TemplatePerson = { id: string; name: string };
export type TemplateThumb =
  | { design: PopupDesign; kind: "custom" }
  | { design: PopupFreeDesign; kind: "free" }
  | { icon: NoticeIconChoice; kind: "inbox" }
  | { kind: "popup_default" };

export type TemplateListItem = {
  createdBy: TemplatePerson | null;
  designMode: TemplateDesignMode | null;
  id: string;
  kind: TemplateKind;
  name: string;
  /** false = payload que nao abre (so Renomear e Excluir). */
  readable: boolean;
  /** templateSummary. */
  summary: string;
  thumb: TemplateThumb | null;
  /** templateTypeLabel. */
  typeLabel: string;
  updatedAt: string;
};

export type TemplatesPage = {
  /** Fontes dos designs da pagina (miniaturas). */
  fonts: PopupFontFace[];
  items: TemplateListItem[];
  page: number;
  pageSize: number;
  /** Com filtro e busca. */
  total: number;
  /** Todos os nao excluidos (o "200"). */
  totalAll: number;
};

export type TemplateDetail = {
  createdBy: TemplatePerson | null;
  designMode: TemplateDesignMode | null;
  fonts: PopupFontFace[];
  id: string;
  kind: TemplateKind;
  name: string;
  /** parseTemplatePayload. */
  notes: string[];
  payload: TemplatePayload | null;
  updatedAt: string;
};

export type RecentTemplate = { id: string; kind: TemplateKind; name: string; typeLabel: string };

export type NoticeStartResult =
  | { audiences: AudienceDefinition[]; fonts: PopupFontFace[]; ok: true; start: NoticeStart }
  | { ok: false; reason: "missing" | "unreadable" };

/** Modo modelo do editor (/modelos/[id] e /modelos/novo). id null = modelo novo em branco do tipo. */
export type TemplateEditorInput = {
  designMode: TemplateDesignMode | null;
  id: string | null;
  /** As chaves do modelo (D31): templateIncludeOf(payload); modelo novo = tudo ligado; Design = ignorado. */
  include: TemplateInclude;
  kind: TemplateKind;
  name: string;
  /** parseTemplatePayload + senderGone / followUpSenderGone. */
  notes: string[];
  /** inbox/popup: o editor do aviso; design: designTemplateDraft. Os ids gravados ficam (D28). */
  start: NoticeStart;
  updatedAt: string | null;
};

export type TemplateEditorResult =
  | { audiences: AudienceDefinition[]; fonts: PopupFontFace[]; ok: true; template: TemplateEditorInput }
  | { id: string; name: string; ok: false; reason: "unreadable" };

/* ------------------------------------------------------------------------------------------------
 * Apoio
 * ---------------------------------------------------------------------------------------------- */

/** Busca sem acento nem maiuscula ("lancamento" acha "Lançamento"). */
function searchKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

async function loadPeople(db: CommunicationsDb, ids: readonly (string | null)[]): Promise<Map<string, TemplatePerson>> {
  const people = new Map<string, TemplatePerson>();
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];

  for (const part of chunksOf(wanted, 150)) {
    const { data, error } = await db.from("profiles").select("id,full_name,email").in("id", part);
    assertNoDbError(error, "Comunicacao: quem criou os modelos");

    for (const row of (data ?? []) as { email: string | null; full_name: string | null; id: string }[]) {
      people.set(row.id, { id: row.id, name: row.full_name?.trim() || row.email?.split("@")[0] || "Equipe" });
    }
  }

  return people;
}

function designOf(payload: TemplatePayload | null): PopupDesign | PopupFreeDesign | null {
  return payload && payload.kind !== "inbox" ? payload.design : null;
}

function designFontIds(payloads: readonly (TemplatePayload | null)[]): string[] {
  return [...new Set(payloads.flatMap((payload) => designOf(payload)?.fonts ?? []))];
}

/** Fontes das miniaturas e da previa: uma leitura so; falha = a pilha do sistema (nunca derruba a tela). */
async function fontsFor(db: CommunicationsDb, payloads: readonly (TemplatePayload | null)[]): Promise<PopupFontFace[]> {
  const ids = designFontIds(payloads);

  if (ids.length === 0) {
    return [];
  }

  return loadPopupFontFaces(db, ids).catch((error: unknown) => {
    console.error("[admin/comunicacao] fontes dos modelos", error);
    return [] as PopupFontFace[];
  });
}

function thumbOf(payload: TemplatePayload | null): TemplateThumb | null {
  if (!payload) {
    return null;
  }

  if (payload.kind === "inbox") {
    return { icon: payload.settings.icon, kind: "inbox" };
  }

  if (!payload.design) {
    return { kind: "popup_default" };
  }

  return (payload.design as { mode?: unknown }).mode === "free"
    ? { design: payload.design as PopupFreeDesign, kind: "free" }
    : { design: payload.design as PopupDesign, kind: "custom" };
}

function filterMatches(row: TemplateSummaryRow, filter: TemplateFilter) {
  return filter === "all" || templateTypeOf(row.kind, row.design_mode) === filter;
}

/** Os "Para quem" do aviso e de cada seguinte (todos os niveis): dao nome as regras no editor. */
function audiencesOf(start: NoticeStart): AudienceDefinition[] {
  const audiences: AudienceDefinition[] = [start.draft.audience ?? EVERYONE];
  const walk = (items: readonly FollowUpDraft[]) => {
    for (const item of items) {
      audiences.push(item.who);
      walk(item.children);
    }
  };

  walk(start.followUps?.items ?? []);

  return audiences;
}

function startFonts(db: CommunicationsDb, start: NoticeStart) {
  const design = start.draft.freeDesign ?? start.draft.design ?? null;

  return design && design.fonts.length > 0
    ? loadPopupFontFaces(db, design.fonts).catch((error: unknown) => {
        console.error("[admin/comunicacao] fontes do modelo", error);
        return [] as PopupFontFace[];
      })
    : Promise.resolve([] as PopupFontFace[]);
}

/* ------------------------------------------------------------------------------------------------
 * Leituras
 * ---------------------------------------------------------------------------------------------- */

/** Le os resumos (sem payload), filtra por tipo e nome (minusculas, sem acento) em memoria, corta a pagina e so entao le o payload das <= 20 linhas da pagina. */
export async function listTemplates(input: { filter: TemplateFilter; page: number; search: string }): Promise<TemplatesPage> {
  const db = communicationsDb();
  const pageSize = TEMPLATE_LIMITS.listPageSize;
  const summaries = await listTemplateSummaries(db);
  const search = searchKey(input.search ?? "");
  const matching = summaries.filter((row) => filterMatches(row, input.filter) && (!search || searchKey(row.name).includes(search)));
  const lastPage = Math.max(1, Math.ceil(matching.length / pageSize));
  const page = Math.min(lastPage, Math.max(1, Math.floor(Number.isFinite(input.page) ? input.page : 1)));
  const slice = matching.slice((page - 1) * pageSize, page * pageSize);
  const [rows, people] = await Promise.all([
    fetchTemplatesByIds(
      db,
      slice.map((row) => row.id)
    ),
    loadPeople(
      db,
      slice.map((row) => row.created_by)
    )
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const items: TemplateListItem[] = [];
  const payloads: (TemplatePayload | null)[] = [];

  for (const summary of slice) {
    const row = byId.get(summary.id);

    // Excluido entre as duas leituras: some da pagina.
    if (!row) {
      continue;
    }

    const { payload } = parseTemplatePayload(row.kind, row.payload);
    payloads.push(payload);
    items.push({
      createdBy: row.created_by ? (people.get(row.created_by) ?? null) : null,
      designMode: row.design_mode,
      id: row.id,
      kind: row.kind,
      name: row.name,
      readable: payload !== null,
      summary: templateSummary(payload),
      thumb: thumbOf(payload),
      typeLabel: templateTypeLabel(row.kind, row.design_mode),
      updatedAt: row.updated_at
    });
  }

  return { fonts: await fontsFor(db, payloads), items, page, pageSize, total: matching.length, totalAll: summaries.length };
}

async function detailOf(db: CommunicationsDb, row: TemplateRow): Promise<TemplateDetail> {
  const parsed = parseTemplatePayload(row.kind, row.payload);
  const [people, fonts] = await Promise.all([loadPeople(db, [row.created_by]), fontsFor(db, [parsed.payload])]);

  return {
    createdBy: row.created_by ? (people.get(row.created_by) ?? null) : null,
    designMode: row.design_mode,
    fonts,
    id: row.id,
    kind: row.kind,
    name: row.name,
    notes: parsed.notes,
    payload: parsed.payload,
    updatedAt: row.updated_at
  };
}

/** uuid invalido, inexistente ou excluido -> null. */
export async function getTemplateDetail(id: string): Promise<TemplateDetail | null> {
  if (!UUID_PATTERN.test(id)) {
    return null;
  }

  const db = communicationsDb();
  const row = await fetchTemplate(db, id);

  return row ? detailOf(db, row) : null;
}

/** Menu do Novo aviso: so os resumos (sem payload). Um modelo que nao abre pode aparecer; ao escolher, o editor diz startUnreadable. */
export async function listRecentTemplates(limit: number = TEMPLATE_LIMITS.recentForNewNotice): Promise<{ items: RecentTemplate[]; total: number }> {
  const summaries = await listTemplateSummaries(communicationsDb());

  return {
    items: summaries.slice(0, Math.max(0, limit)).map((row) => ({ id: row.id, kind: row.kind, name: row.name, typeLabel: templateTypeLabel(row.kind, row.design_mode) })),
    total: summaries.length
  };
}

/**
 * "Usar" e "Novo aviso com modelo": detalhe + noticeStartOfTemplate COM ids novos (crypto.randomUUID) + withSendersOnTeam
 * (quem saiu da equipe vira a escola, com nota). missing = uuid invalido, inexistente ou excluido; unreadable = payload
 * null no parse. audiences = [start.draft.audience, o "who" de cada seguinte em todos os niveis]: e o que da nome as
 * regras em loadNoticeEditorOptions({ audiences }). O objetivo das seguintes e um produto e sai da lista de produtos.
 */
export async function prepareNoticeStart(templateId: string): Promise<NoticeStartResult> {
  if (!UUID_PATTERN.test(templateId)) {
    return { ok: false, reason: "missing" };
  }

  const db = communicationsDb();
  const row = await fetchTemplate(db, templateId);

  if (!row) {
    return { ok: false, reason: "missing" };
  }

  const parsed = parseTemplatePayload(row.kind, row.payload);

  if (!parsed.payload) {
    return { ok: false, reason: "unreadable" };
  }

  const fresh = noticeStartOfTemplate({ id: row.id, name: row.name, payload: parsed.payload }, { newId: () => crypto.randomUUID() });
  const start = await withSendersOnTeam(db, { ...fresh, notes: [...parsed.notes, ...fresh.notes] });

  return { audiences: audiencesOf(start), fonts: await startFonts(db, start), ok: true, start };
}

const ALL_KEYS: TemplateInclude = { audience: true, content: true, followUps: true };

/**
 * { id }: getTemplateDetail + noticeStartOfTemplate SEM newId (os ids gravados ficam, D28) + withSendersOnTeam (D19:
 * quem saiu da equipe vira a escola, na principal e nas seguintes, com senderGone / followUpSenderGone nas notas).
 * As notas sao so essas e as de leitura: as de aplicar o design (applyCta, applySnooze, applyNeedsImage) ficam para o
 * "Usar". Inexistente ou excluido -> null (not-found). Payload null -> { ok: false, reason: "unreadable" }.
 * { kind, mode }: inbox/popup -> emptyTemplateStart(kind); design com mode -> designTemplateDraft(null, mode, "");
 * design sem mode -> null (a pagina mostra a escolha do tipo).
 */
export async function prepareTemplateEditor(input: { id: string } | { kind: TemplateKind; mode?: TemplateDesignMode }): Promise<TemplateEditorResult | null> {
  if (!("id" in input)) {
    if (input.kind === "design") {
      if (!input.mode) {
        return null;
      }

      const start: NoticeStart = { draft: designTemplateDraft(null, input.mode, ""), followUps: null, notes: [], templateId: null, templateName: null };

      return {
        audiences: [EVERYONE],
        fonts: [],
        ok: true,
        template: { designMode: input.mode, id: null, include: { ...ALL_KEYS }, kind: "design", name: "", notes: [], start, updatedAt: null }
      };
    }

    const start = emptyTemplateStart(input.kind);

    return {
      audiences: [EVERYONE],
      fonts: [],
      ok: true,
      template: { designMode: null, id: null, include: { ...ALL_KEYS }, kind: input.kind, name: "", notes: [], start, updatedAt: null }
    };
  }

  if (!UUID_PATTERN.test(input.id)) {
    return null;
  }

  const db = communicationsDb();
  const row = await fetchTemplate(db, input.id);

  if (!row) {
    return null;
  }

  const detail = await detailOf(db, row);

  if (!detail.payload) {
    return { id: row.id, name: row.name, ok: false, reason: "unreadable" };
  }

  const payload = detail.payload;
  let start: NoticeStart;

  if (payload.kind === "design") {
    const mode = templateDesignModeOf(payload) ?? "custom";
    start = { draft: designTemplateDraft(payload, mode, row.name), followUps: null, notes: [...detail.notes], templateId: row.id, templateName: row.name };
  } else {
    // So as notas de leitura (mais as de quem envia, do withSendersOnTeam). As de aplicar o design (o texto que o
    // botao ganhou, o "Lembrar depois" ligado, a imagem que falta) sao do "Usar" (prepareNoticeStart): sem o conteudo,
    // o destino do botao nunca vai para o modelo, e a nota mandaria escolher algo que se perde.
    const opened = noticeStartOfTemplate({ id: row.id, name: row.name, payload }, {});
    start = await withSendersOnTeam(db, { ...opened, notes: [...detail.notes] });
  }

  return {
    audiences: audiencesOf(start),
    fonts: detail.fonts,
    ok: true,
    template: {
      designMode: row.design_mode,
      id: row.id,
      include: templateIncludeOf(payload),
      kind: row.kind,
      name: row.name,
      notes: start.notes,
      start,
      updatedAt: row.updated_at
    }
  };
}
