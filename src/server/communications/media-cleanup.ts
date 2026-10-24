import "server-only";

// Limpeza automatica dos arquivos da Comunicacao sem uso (docs/22 §4.6; migracao 202610240001). Uma rodada:
// 1. le as marcas (communication_media_orphans; sem a tabela, termina sem erro: migracao pendente);
// 2. lista os nossos lugares no Storage (media-refs.ts: videos, fontes, audios, imagens do aviso e do Livre);
// 3. junta tudo que esta em uso: avisos, pop-ups e passos de fluxo nao excluidos (imagem, audio, design
//    Personalizado ou Livre), fontes da biblioteca (e a excluida que um aviso ou modelo ainda cita), os modelos
//    nao excluidos (loadTemplateMediaUse: o jsonb cru de communication_templates, docs/28 D17; so a tabela
//    ausente vale como "nenhum modelo", qualquer outro erro para a rodada sem marcar nem apagar nada) e
//    notificacoes de tipo que guarda arquivo (nenhum hoje);
// 4. planeja (media-cleanup-model.ts), marca o que ficou sem uso, desmarca o que voltou a ser usado;
// 5. para os vencidos (30 dias sem uso, ate 500): junta o uso DE NOVO, reserva a marca de forma atomica (grava
//    claimed_at so se ela ainda e antiga e livre), apaga do Storage e SO ENTAO tira a linha. Falha no Storage solta a
//    reserva (a marca fica, com a data antiga).
// Quem envia de novo o mesmo arquivo (forgetOrphanMark, ANTES de enviar) apaga a marca livre ou espera a linha
// reservada sair: um envio nunca acontece entre a reserva e a remocao, entao nada que o editor acabou de receber
// some (docs/22 §4.6). Reserva esquecida ha 15 min (rodada que caiu) e solta no comeco da rodada seguinte.
// Idempotente e retomavel: repetir a rodada nao muda nada que a anterior ja fez. Registra so contagens.

import { assertNoDbError, chunksOf, CommunicationError, isMissingCommunicationSchema, type CommunicationsDb } from "./db";
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
  templateMediaUse,
  type FontFileRow,
  type MediaLocation,
  type MediaRef,
  type TemplateMediaRow,
  type TemplateMediaUse
} from "./media-refs";
import {
  claimStaleCutoff,
  groupByBucket,
  MEDIA_CLEANUP_RULES,
  mediaLocationKey,
  orphanDueCutoff,
  orphanMarkUploadStep,
  planMediaCleanup,
  type ListedMedia,
  type OrphanMark
} from "./media-cleanup-model";

export const MEDIA_ORPHANS_TABLE = "communication_media_orphans";

/** O envio do mesmo arquivo chegou durante a remocao e ela nao terminou a tempo (409). */
export const MEDIA_BUSY_MESSAGE = "Este arquivo está saindo do armazenamento agora. Envie de novo em alguns minutos.";

const CAMPAIGN_PAGE = 200;
/** 20 por pagina: o payload pode ter ate 768 KB (docs/28 D14). */
const TEMPLATE_PAGE = 20;
/** A tabela dos modelos (template-model.TEMPLATES_TABLE; este modulo nao importa o modelo puro dos Modelos). */
const TEMPLATES_TABLE_NAME = "communication_templates";
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
  /** Reservas esquecidas (rodada que caiu entre reservar e terminar) soltas no comeco. */
  released: number;
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
    released: 0,
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
 * Tabela de modelos ausente (migracao 202610250001 pendente): 42P01 ou PGRST205 com a mensagem citando
 * communication_templates. So isso: coluna que falta (42703, PGRST204) ou falha de conexao nao e "nenhum modelo"
 * (num deploy a frente de uma migracao futura, a rodada marcaria os arquivos que so os modelos seguram).
 */
export function isMissingTemplatesTable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205") && (error.message ?? "").includes(TEMPLATES_TABLE_NAME));
}

/**
 * Modelos nao excluidos (docs/28 D17), por keyset, select "id,payload": o que cada um segura pelo jsonb cru
 * (templateMediaUse). isMissingTemplatesTable na primeira pagina -> [] (nenhum modelo foi gravado); numa pagina
 * seguinte, lanca como os outros. Qualquer outro erro lanca, inclusive
 * 42703 e PGRST204 (coluna) e falha de conexao: a rodada para sem marcar nem apagar nada. O que um modelo usa nunca
 * sai do Storage, e a fonte excluida que um modelo cita tambem fica.
 */
export async function loadTemplateMediaUse(db: CommunicationsDb): Promise<TemplateMediaUse[]> {
  const uses: TemplateMediaUse[] = [];
  let missing = false;

  await readByKeyset<TemplateMediaRow & { id: string }>(
    async (afterId, limit) => {
      const base = db.from(TEMPLATES_TABLE_NAME).select("id,payload").is("deleted_at", null);
      const result = await (afterId ? base.gt("id", afterId) : base).order("id").limit(limit);

      // So na primeira pagina: a tabela que some no meio da leitura nao e "nenhum modelo" (os ja lidos seguram
      // arquivos); o erro segue para o assertNoDbError e a rodada para sem marcar nem apagar.
      if (afterId === null && isMissingTemplatesTable(result.error)) {
        missing = true;
        return { data: [], error: null };
      }

      return result;
    },
    TEMPLATE_PAGE,
    "Comunicacao: arquivos em uso pelos modelos",
    (rows) => rows.forEach((row) => uses.push(templateMediaUse(row)))
  );

  return missing ? [] : uses;
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

/**
 * Solta as reservas esquecidas (claimStaleMinutes): uma rodada que caiu entre reservar e terminar. A linha volta
 * livre com a data antiga e esta rodada decide de novo (sumiu do Storage: sai; ainda la e sem uso: reserva de novo).
 */
async function releaseStaleClaims(db: CommunicationsDb): Promise<number> {
  const { data, error } = await db
    .from(MEDIA_ORPHANS_TABLE)
    .update({ claimed_at: null })
    .lt("claimed_at", claimStaleCutoff(new Date()).toISOString())
    .select("path");
  assertNoDbError(error, "Comunicacao: soltar reservas esquecidas da limpeza");

  return (data ?? []).length;
}

async function loadMarks(db: CommunicationsDb): Promise<OrphanMark[]> {
  const marks: OrphanMark[] = [];

  for (let from = 0; ; from += ROW_PAGE) {
    const { data, error } = await db
      .from(MEDIA_ORPHANS_TABLE)
      .select("bucket,path,first_orphan_at,claimed_at")
      .order("bucket")
      .order("path")
      .range(from, from + ROW_PAGE - 1);
    assertNoDbError(error, "Comunicacao: arquivos marcados sem uso");

    const rows = (data ?? []) as { bucket: string; claimed_at: string | null; first_orphan_at: string; path: string }[];
    rows.forEach((row) => marks.push({ bucket: row.bucket, claimedAt: row.claimed_at ?? null, firstOrphanAt: row.first_orphan_at, path: row.path }));

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

/** Desmarca (voltou a ser usado, sumiu, nao e nosso). So a linha livre: a reservada e da rodada que esta apagando. */
async function deleteMarks(db: CommunicationsDb, refs: readonly MediaRef[]) {
  for (const [bucket, group] of groupByBucket(refs)) {
    for (const part of chunksOf(group, PATH_CHUNK)) {
      const { error } = await db
        .from(MEDIA_ORPHANS_TABLE)
        .delete()
        .eq("bucket", bucket)
        .in("path", part.map((ref) => ref.path))
        .is("claimed_at", null);
      assertNoDbError(error, "Comunicacao: desmarcar arquivos");
    }
  }
}

/** Fim da reserva `claimToken`: a linha sai (apagou do Storage) ou volta livre com a data antiga (nao apagou). */
async function endClaims(db: CommunicationsDb, bucket: string, paths: readonly string[], claimToken: string, removed: boolean) {
  const table = db.from(MEDIA_ORPHANS_TABLE);
  const query = removed ? table.delete() : table.update({ claimed_at: null });
  const { error } = await query.eq("bucket", bucket).in("path", [...paths]).eq("claimed_at", claimToken);
  assertNoDbError(error, removed ? "Comunicacao: tirar as marcas dos arquivos apagados" : "Comunicacao: soltar a reserva dos arquivos");
}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Chamar ANTES de enviar um arquivo com nome pelo conteudo (audios, imagens e fontes: o mesmo arquivo cai no mesmo
 * caminho, e "ja existe" vale como enviado). Tira a marca da limpeza para o prazo de 30 dias recomecar e garante que
 * nenhuma remocao do mesmo caminho esteja em andamento quando o envio acontecer (docs/22 §4.6):
 * - marca livre: apaga (so se ainda livre). Depois disso a rodada nao tem o que reservar, e marca nova so vence em
 *   30 dias;
 * - marca reservada: a rodada esta apagando do Storage e so tira a linha depois. Espera a linha sair (ou voltar
 *   livre, quando a remocao falhou) e confere de novo; o envio que vem depois grava o arquivo outra vez. Passou de
 *   `uploadWaitMs`: 409 (MEDIA_BUSY_MESSAGE), nada enviado;
 * - reserva esquecida (15 min, rodada que caiu): apaga a mesma reserva lida;
 * - sem marca: segue.
 * Banco sem a migracao: segue (sem a tabela, a limpeza nao roda). Outro erro do banco falha o envio: sem conferir,
 * o arquivo podia sair logo depois de enviado.
 */
export async function forgetOrphanMark(
  db: CommunicationsDb,
  ref: MediaRef | null,
  options: { pollMs?: number; sleep?: (ms: number) => Promise<void>; waitMs?: number } = {}
): Promise<void> {
  if (!ref || !mediaLocationOf(ref)) {
    return;
  }

  const sleep = options.sleep ?? sleepFor;
  const pollMs = options.pollMs ?? MEDIA_CLEANUP_RULES.uploadPollMs;
  const deadline = Date.now() + (options.waitMs ?? MEDIA_CLEANUP_RULES.uploadWaitMs);
  /** Sem a tabela (ou a coluna): a limpeza nao roda, o envio segue. Outro erro: falha o envio. */
  const pendingMigrationOrThrow = (error: { code?: string | null; message: string }) => {
    if (isMissingCommunicationSchema(error)) {
      return true;
    }

    throw new Error(`Comunicacao: marca de arquivo sem uso nao conferida antes do envio: ${error.message}`);
  };

  for (;;) {
    const { data, error } = await db.from(MEDIA_ORPHANS_TABLE).select("claimed_at").eq("bucket", ref.bucket).eq("path", ref.path).limit(1);

    if (error && pendingMigrationOrThrow(error)) {
      return;
    }

    const rows = (data ?? []) as { claimed_at: string | null }[];
    const claimedAt = rows.length > 0 ? (rows[0].claimed_at ?? null) : null;
    const step = orphanMarkUploadStep(rows.length > 0 ? { claimedAt } : null, new Date());

    if (step === "proceed") {
      return;
    }

    if (step === "delete_free" || step === "take_stale") {
      const base = db.from(MEDIA_ORPHANS_TABLE).delete().eq("bucket", ref.bucket).eq("path", ref.path);
      const guarded = claimedAt === null ? base.is("claimed_at", null) : base.eq("claimed_at", claimedAt);
      const { data: gone, error: deleteError } = await guarded.select("path");

      if (deleteError && pendingMigrationOrThrow(deleteError)) {
        return;
      }

      if ((gone ?? []).length > 0) {
        return;
      }

      // A linha mudou entre as duas consultas (a rodada reservou agora): le de novo.
      continue;
    }

    if (Date.now() >= deadline) {
      throw new CommunicationError(MEDIA_BUSY_MESSAGE, 409);
    }

    await sleep(pollMs);
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
    result.released = await releaseStaleClaims(db);
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

      // Reserva atomica: so a linha ainda antiga e livre ganha claimed_at. Um envio do mesmo arquivo que chegou antes
      // apagou a linha livre (nada a reservar); um que chega depois ve a reserva e espera a linha sair.
      const claimedAt = Date.now();
      const claimToken = new Date(claimedAt).toISOString();
      const { data: claimedRows, error: claimError } = await db
        .from(MEDIA_ORPHANS_TABLE)
        .update({ claimed_at: claimToken })
        .eq("bucket", bucket)
        .in("path", part.map((row) => row.path))
        .lte("first_orphan_at", cutoff)
        .is("claimed_at", null)
        .select("path");
      assertNoDbError(claimError, "Comunicacao: reservar arquivos vencidos");

      const claimed = ((claimedRows ?? []) as { path: string }[]).map((row) => row.path);

      if (claimed.length === 0) {
        continue;
      }

      // So pede a remocao logo depois de reservar: a reserva vira esquecida (e pode ser tomada) muito depois disso.
      if (Date.now() - claimedAt > MEDIA_CLEANUP_RULES.claimRemoveWindowMs) {
        await endClaims(db, bucket, claimed, claimToken, false);
        result.remaining += claimed.length;
        continue;
      }

      const removal = await db.storage.from(bucket).remove(claimed);

      if (removal.error) {
        result.failed += claimed.length;
        console.error(`[comunicacao] limpeza de arquivos: ${claimed.length} arquivo(s) de ${bucket} nao sairam do Storage: ${removal.error.message}`);
        await endClaims(db, bucket, claimed, claimToken, false);
        continue;
      }

      // So agora a linha sai: quem esperava para enviar o mesmo arquivo grava de novo depois da remocao.
      await endClaims(db, bucket, claimed, claimToken, true);
      result.deleted += claimed.length;
    }
  }

  // Falha no Storage nao segura a rodada do dia: as marcas voltaram livres e saem amanha.
  return finish(!signal?.aborted && result.remaining === 0);
}
