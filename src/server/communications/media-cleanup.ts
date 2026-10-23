import "server-only";

// Limpeza automatica dos arquivos da Comunicacao sem uso (docs/22 §4.6; migracao 202610240001). Uma rodada:
// 1. le as marcas (communication_media_orphans; sem a tabela, termina sem erro: migracao pendente);
// 2. lista os nossos lugares no Storage (media-refs.ts: videos, fontes, audios, imagens do aviso e do Livre);
// 3. junta tudo que esta em uso: avisos, pop-ups e passos de fluxo nao excluidos (imagem, audio, design
//    Personalizado ou Livre), fontes da biblioteca (e a excluida que um aviso ou modelo ainda cita), modelos
//    (loadTemplateMediaUse) e notificacoes de tipo que guarda arquivo (nenhum hoje);
// 4. planeja (media-cleanup-model.ts), marca o que ficou sem uso, desmarca o que voltou a ser usado;
// 5. para os vencidos (30 dias sem uso, ate 500): junta o uso DE NOVO, reserva a marca de forma atomica (apaga a
//    linha so se ela ainda e antiga) e so entao apaga do Storage. Falha no Storage devolve a marca.
// Idempotente e retomavel: repetir a rodada nao muda nada que a anterior ja fez. Registra so contagens.

import { assertNoDbError, chunksOf, isMissingCommunicationSchema, type CommunicationsDb } from "./db";
import {
  CAMPAIGN_MEDIA_COLUMNS,
  campaignMediaRefs,
  COMMUNICATION_MEDIA_LOCATIONS,
  designFontIds,
  fontFileRefs,
  mediaKey,
  mediaLocationOf,
  NOTIFICATION_KINDS_WITH_MEDIA,
  notificationMediaRefs,
  type FontFileRow,
  type MediaLocation,
  type MediaRef,
  type TemplateMediaUse
} from "./media-refs";
import {
  groupByBucket,
  MEDIA_CLEANUP_RULES,
  mediaLocationKey,
  orphanDueCutoff,
  planMediaCleanup,
  type ListedMedia,
  type OrphanMark
} from "./media-cleanup-model";

export const MEDIA_ORPHANS_TABLE = "communication_media_orphans";

const CAMPAIGN_PAGE = 200;
const ROW_PAGE = 1_000;
const WRITE_CHUNK = 500;
/** Caminhos por filtro `in` (vao na URL) e por chamada de remocao ao Storage. */
const PATH_CHUNK = 100;

export type MediaCleanupResult = {
  /** Vencidos que voltaram a ser usados entre o plano e a remocao (desmarcados, nada apagado). */
  rescued: number;
  deleted: number;
  /** Rodada completa: nao parou no tempo e nada vencido ficou para depois (falha no Storage tenta de novo amanha). */
  done: boolean;
  failed: number;
  /** Algum lugar passou do teto de itens listados (o resto do lugar fica para quando o teto subir). */
  incomplete: number;
  listed: number;
  marked: number;
  ms: number;
  pendingMigration: boolean;
  recent: number;
  referenced: number;
  remaining: number;
  unmarked: number;
  waiting: number;
};

function emptyResult(): MediaCleanupResult {
  return {
    deleted: 0,
    done: false,
    failed: 0,
    incomplete: 0,
    listed: 0,
    marked: 0,
    ms: 0,
    pendingMigration: false,
    recent: 0,
    referenced: 0,
    remaining: 0,
    rescued: 0,
    unmarked: 0,
    waiting: 0
  };
}

/* ------------------------------------------------------------------------------------------------
 * O que esta em uso
 * ---------------------------------------------------------------------------------------------- */

/**
 * Modelos de pop-up (ainda nao existem): quando a tabela de modelos chegar, ler aqui cada modelo nao excluido e
 * devolver `templateMediaUse(modelo)` (media-refs.ts). O que um modelo usa nunca sai do Storage, e a fonte
 * excluida que um modelo cita tambem fica.
 */
export async function loadTemplateMediaUse(db: CommunicationsDb): Promise<TemplateMediaUse[]> {
  void db;

  return [];
}

/** Paginas por id (chave crescente): linhas que entram ou saem durante a leitura nao deslocam as outras. */
async function readByKeyset<T extends { id: string }>(
  read: (afterId: string | null, limit: number) => PromiseLike<{ data: unknown; error: { code?: string | null; message: string } | null }>,
  limit: number,
  context: string,
  onPage: (rows: T[]) => void
) {
  let afterId: string | null = null;

  for (;;) {
    const { data, error } = await read(afterId, limit);
    assertNoDbError(error, context);

    const rows = (data ?? []) as T[];
    onPage(rows);

    if (rows.length < limit) {
      return;
    }

    afterId = rows[rows.length - 1].id;
  }
}

/** Chaves (mediaKey) de todo arquivo em uso agora. */
export async function loadReferencedMedia(db: CommunicationsDb): Promise<Set<string>> {
  const keys = new Set<string>();
  const usedFontIds = new Set<string>();
  const add = (refs: readonly MediaRef[]) => refs.forEach((ref) => keys.add(mediaKey(ref)));

  // Avisos, pop-ups e passos de fluxo (o conteudo de um passo e um aviso com flow_id) nao excluidos.
  await readByKeyset<{ audio_url: unknown; id: string; image_url: unknown; popup_design: unknown }>(
    (afterId, limit) => {
      const base = db.from("campaigns").select(["id", ...CAMPAIGN_MEDIA_COLUMNS].join(",")).is("deleted_at", null);
      return (afterId ? base.gt("id", afterId) : base).order("id").limit(limit);
    },
    CAMPAIGN_PAGE,
    "Comunicacao: arquivos em uso pelos avisos",
    (rows) => {
      for (const row of rows) {
        add(campaignMediaRefs(row));
        designFontIds(row.popup_design).forEach((id) => usedFontIds.add(id));
      }
    }
  );

  for (const use of await loadTemplateMediaUse(db)) {
    add(use.refs);
    use.fontIds.forEach((id) => usedFontIds.add(id.toLowerCase()));
  }

  const fonts: FontFileRow[] = [];

  await readByKeyset<FontFileRow>(
    (afterId, limit) => {
      const base = db.from("communication_fonts").select("id,file_path,deleted_at");
      return (afterId ? base.gt("id", afterId) : base).order("id").limit(limit);
    },
    ROW_PAGE,
    "Comunicacao: arquivos das fontes",
    (rows) => fonts.push(...rows)
  );
  add(fontFileRefs(fonts, usedFontIds));

  // Notificacoes: so os tipos que podem guardar arquivo no payload (nenhum hoje; a de aviso conta pelo aviso).
  if (NOTIFICATION_KINDS_WITH_MEDIA.length > 0) {
    await readByKeyset<{ id: string; payload: unknown }>(
      (afterId, limit) => {
        const base = db.from("notifications").select("id,payload").in("kind", [...NOTIFICATION_KINDS_WITH_MEDIA]);
        return (afterId ? base.gt("id", afterId) : base).order("id").limit(limit);
      },
      ROW_PAGE,
      "Comunicacao: arquivos das notificacoes",
      (rows) => rows.forEach((row) => add(notificationMediaRefs(row)))
    );
  }

  return keys;
}

/* ------------------------------------------------------------------------------------------------
 * Storage e marcas
 * ---------------------------------------------------------------------------------------------- */

type StorageEntry = { created_at?: string | null; id?: string | null; name: string };

/** Lista um lugar inteiro (ate o teto), so os objetos que casam com o padrao. Bucket que nao existe = vazio. */
async function listLocation(db: CommunicationsDb, location: MediaLocation, signal?: AbortSignal): Promise<{ complete: boolean; objects: ListedMedia[] }> {
  const objects: ListedMedia[] = [];
  const pageSize = MEDIA_CLEANUP_RULES.listPageSize;

  for (let offset = 0; offset < MEDIA_CLEANUP_RULES.maxListedPerLocation; offset += pageSize) {
    if (signal?.aborted) {
      return { complete: false, objects };
    }

    const { data, error } = await db.storage.from(location.bucket).list(location.prefix, { limit: pageSize, offset, sortBy: { column: "name", order: "asc" } });

    if (error) {
      if (/bucket not found|not found/i.test(error.message) && offset === 0) {
        return { complete: true, objects };
      }

      throw new Error(`Comunicacao: nao foi possivel listar ${location.bucket}/${location.prefix}: ${error.message}`);
    }

    const entries = (data ?? []) as StorageEntry[];

    for (const entry of entries) {
      // Pasta (sem id) ou nome fora do padrao: nunca e nosso para julgar.
      const path = `${location.prefix}/${entry.name}`;

      if (entry.id && location.pattern.test(path)) {
        objects.push({ bucket: location.bucket, createdAt: entry.created_at ?? null, path });
      }
    }

    if (entries.length < pageSize) {
      return { complete: true, objects };
    }
  }

  return { complete: false, objects };
}

async function loadMarks(db: CommunicationsDb): Promise<OrphanMark[]> {
  const marks: OrphanMark[] = [];

  for (let from = 0; ; from += ROW_PAGE) {
    const { data, error } = await db
      .from(MEDIA_ORPHANS_TABLE)
      .select("bucket,path,first_orphan_at")
      .order("bucket")
      .order("path")
      .range(from, from + ROW_PAGE - 1);
    assertNoDbError(error, "Comunicacao: arquivos marcados sem uso");

    const rows = (data ?? []) as { bucket: string; first_orphan_at: string; path: string }[];
    rows.forEach((row) => marks.push({ bucket: row.bucket, firstOrphanAt: row.first_orphan_at, path: row.path }));

    if (rows.length < ROW_PAGE) {
      return marks;
    }
  }
}

async function insertMarks(db: CommunicationsDb, rows: readonly { bucket: string; first_orphan_at: string; path: string }[]) {
  for (const part of chunksOf(rows, WRITE_CHUNK)) {
    const { error } = await db.from(MEDIA_ORPHANS_TABLE).upsert(part, { ignoreDuplicates: true, onConflict: "bucket,path" });
    assertNoDbError(error, "Comunicacao: marcar arquivos sem uso");
  }
}

async function deleteMarks(db: CommunicationsDb, refs: readonly MediaRef[]) {
  for (const [bucket, group] of groupByBucket(refs)) {
    for (const part of chunksOf(group, PATH_CHUNK)) {
      const { error } = await db.from(MEDIA_ORPHANS_TABLE).delete().eq("bucket", bucket).in("path", part.map((ref) => ref.path));
      assertNoDbError(error, "Comunicacao: desmarcar arquivos");
    }
  }
}

/**
 * Esquece a marca de um arquivo enviado de novo (o nome dos audios, das imagens e das fontes vem do conteudo: o
 * mesmo arquivo cai no mesmo caminho). A proxima rodada marca de novo, com a hora dela, se ainda estiver sem uso:
 * os 30 dias recomecam e o arquivo nao some enquanto o aviso ainda nao foi salvo. Nunca falha o envio.
 */
export async function forgetOrphanMark(db: CommunicationsDb, ref: MediaRef | null) {
  if (!ref || !mediaLocationOf(ref)) {
    return;
  }

  try {
    const { error } = await db.from(MEDIA_ORPHANS_TABLE).delete().eq("bucket", ref.bucket).eq("path", ref.path);

    if (error && !isMissingCommunicationSchema(error)) {
      console.error(`[comunicacao] marca de arquivo sem uso nao apagada no envio: ${error.message}`);
    }
  } catch (error) {
    console.error("[comunicacao] marca de arquivo sem uso nao apagada no envio.", error instanceof Error ? error.message : error);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Rodada
 * ---------------------------------------------------------------------------------------------- */

/**
 * Uma rodada da limpeza. `now` so muda nos testes (simula a passagem do tempo); `maxDeletes` e `locations` tambem.
 */
export async function runMediaCleanup(input: {
  db: CommunicationsDb;
  locations?: readonly MediaLocation[];
  maxDeletes?: number;
  now?: Date;
  signal?: AbortSignal;
}): Promise<MediaCleanupResult> {
  const startedAt = Date.now();
  const { db, signal } = input;
  const now = input.now ?? new Date();
  const locations = input.locations ?? COMMUNICATION_MEDIA_LOCATIONS;
  const result = emptyResult();
  const finish = (done: boolean) => ({ ...result, done, ms: Date.now() - startedAt });

  let marks: OrphanMark[];

  try {
    marks = await loadMarks(db);
  } catch (error) {
    if (isMissingCommunicationSchema(error)) {
      return { ...finish(true), pendingMigration: true };
    }

    throw error;
  }

  const listed: ListedMedia[] = [];
  const completeLocations = new Set<string>();

  for (const location of locations) {
    const listing = await listLocation(db, location, signal);
    listed.push(...listing.objects);

    if (listing.complete) {
      completeLocations.add(mediaLocationKey(location));
    } else if (!signal?.aborted) {
      result.incomplete += 1;
    }
  }

  result.listed = listed.length;

  if (signal?.aborted) {
    return finish(false);
  }

  const referenced = await loadReferencedMedia(db);
  result.referenced = referenced.size;

  const plan = planMediaCleanup({ completeLocations, listed, locations, marked: marks, maxDeletes: input.maxDeletes, now, referenced });
  result.recent = plan.recent;
  result.waiting = plan.waiting;
  result.remaining = plan.remaining;

  await insertMarks(db, plan.mark.map((ref) => ({ bucket: ref.bucket, first_orphan_at: now.toISOString(), path: ref.path })));
  result.marked = plan.mark.length;
  await deleteMarks(db, plan.unmark);
  result.unmarked = plan.unmark.length;

  if (plan.due.length === 0) {
    return finish(!signal?.aborted && plan.remaining === 0);
  }

  // Antes de apagar: o uso de novo (um aviso salvo entre a primeira leitura e agora segura o arquivo).
  const fresh = await loadReferencedMedia(db);
  const rescued = plan.due.filter((row) => fresh.has(mediaKey(row)));
  const due = plan.due.filter((row) => !fresh.has(mediaKey(row)));

  await deleteMarks(db, rescued);
  result.rescued = rescued.length;

  const cutoff = orphanDueCutoff(now).toISOString();

  for (const [bucket, group] of groupByBucket(due)) {
    for (const part of chunksOf(group, PATH_CHUNK)) {
      if (signal?.aborted) {
        result.remaining += part.length;
        continue;
      }

      // Reserva atomica: so sai a linha que ainda e antiga (um envio de novo, que apaga a marca, ganha).
      const { data: claimedRows, error: claimError } = await db
        .from(MEDIA_ORPHANS_TABLE)
        .delete()
        .eq("bucket", bucket)
        .in("path", part.map((row) => row.path))
        .lte("first_orphan_at", cutoff)
        .select("bucket,path,first_orphan_at");
      assertNoDbError(claimError, "Comunicacao: reservar arquivos vencidos");

      const claimed = (claimedRows ?? []) as { bucket: string; first_orphan_at: string; path: string }[];

      if (claimed.length === 0) {
        continue;
      }

      const removal = await db.storage.from(bucket).remove(claimed.map((row) => row.path));

      if (removal.error) {
        result.failed += claimed.length;
        console.error(`[comunicacao] limpeza de arquivos: ${claimed.length} arquivo(s) de ${bucket} nao sairam do Storage: ${removal.error.message}`);
        await insertMarks(db, claimed);
        continue;
      }

      result.deleted += claimed.length;
    }
  }

  // Falha no Storage nao segura a rodada do dia: as marcas voltaram e saem amanha.
  return finish(!signal?.aborted && result.remaining === 0);
}
