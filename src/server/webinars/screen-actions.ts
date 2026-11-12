"use server";

// Server Actions da "Na tela" (docs/30 §2.4 e §5.1; especificacao de 10/11/2026, R3, R4, §5.3 e §8): o banner e o QR
// Code que a equipe poe na frente da turma, pelo console da sessao. Todas por runWebinarAction("messaging.write"), com a
// classe de acao da licenca e a guarda do modulo (docs/32 §11.3 e §11.8), com a
// auditoria (quem e quando; nunca o texto nem o link) e a pagina do console revalidada. A mensagem e a enquete fixadas
// ficam em room-actions.ts (pinMessage, pinPoll, unpinPoll).
//
// - saveScreenItem: salva um banner ou um QR Code pronto no webinario (os itens servem para todas as sessoes). O zod
//   confere os campos e as regras entre eles (screen-schemas.screenItemInputSchema); a imagem nunca e um endereco: so o
//   caminho webinars/screen/<24 hex>.webp do nosso bucket content-assets, conferido no Storage (existe, foi gravada como
//   WebP, ate 200.000 bytes) com as medidas relidas do cabecalho (os primeiros 64 bytes, o mesmo jeito do Livre do
//   pop-up, popup-free-assets.inspectFreeImage); a imagem que o item ja tinha nao e conferida de novo. Sem nome, o
//   titulo, a legenda ou o dominio do link. Ate 20 nao arquivados por webinario. Editar um item que esta na tela e
//   permitido: a turma continua vendo a copia mostrada (o console oferece Mostrar de novo);
// - archiveScreenItem: arquiva (nunca apaga: as exibicoes e o relatorio continuam); recusado com 409 "Tire da tela
//   para excluir." enquanto o item esta na tela de uma sessao que ainda mostra (no ar ou na espera);
// - uploadScreenImage: recebe o WebP que o navegador ja reduziu (prepareFreeImage com 1.280 px e 200.000 bytes), confere
//   de novo o formato, o peso, os lados (16 a 1.280 px) e recusa o WebP animado (webpIsAnimated), grava pelo
//   persistImageAsset em content-assets/webinars/screen/<24 hex do sha256>.webp (o nome pelo conteudo: a mesma imagem
//   cai no mesmo caminho) e devolve so o caminho e as medidas, nunca um endereco;
// - showScreenItem: o item e do webinario da sessao e nao esta arquivado; a exibicao ativa do mesmo tipo sai como
//   `replaced` e a nova entra com a copia congelada (snapshot v1, conferida pelo zod) e o minuto da sessao pelo relogio
//   do servidor; o conflito do indice unico (dois cliques juntos) tenta mais uma vez (showScreenDisplayRow, a peca do
//   Fixar da enquete). O mesmo item ja na tela como esta nao grava nada (screenItemShowState "on");
// - hideScreenItem: tira da tela (`team`); o que ja tinha saido nao muda nada.
// Quem mexe no que a turma ve atualiza a linha da sessao POR ULTIMO (touchSessionRow): a consulta de 5 s da sala compara
// esse carimbo e nunca guarda um estado velho com um carimbo novo. No Replay e na sessao encerrada ou cancelada, 409;
// banco sem a 202611100002, 409 com o aviso da migracao antes de qualquer escrita.

import { revalidatePath } from "next/cache";
import { GENERIC_ACTION_ERROR, type ActionResult } from "@/lib/action-result";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { runWebinarAction } from "./run-webinar-action";
import { recordAudit } from "@/server/audit/log";
import { decodeWebpDataUrl, readWebpDimensions, webpIsAnimated } from "@/server/catalog/webp";
import { CommunicationError } from "@/server/communications/db";
import { baseMimeType, isStorageNotFound, readFirstBytes } from "@/server/communications/popup-media";
import { persistImageAsset } from "@/server/db/media-assets";
import { isPendingMigrationError } from "@/server/db/pending-migration";
import { invalidateWebinars } from "./cache";
import { canTeamActOn } from "./console-model";
import { WEBINARS_SCREEN_MIGRATION, WebinarError, WebinarFieldError, webinarsDb, type WebinarsDb } from "./db";
import { CHAT_LIMITS, type WebinarSession } from "./model";
import { sessionOffsetMs } from "./room-model";
import { sessionFromRow, type SessionRow, type WebinarRow } from "./rows";
import {
  SCREEN_IMAGE_BUCKET,
  SCREEN_IMAGE_FOLDER,
  SCREEN_IMAGE_PATH_PATTERN,
  SCREEN_LIMITS,
  screenItemDefaultName,
  screenItemShowState,
  snapshotOfItem,
  type ScreenItem,
  type ScreenKind,
  type ScreenLinkTarget,
  type ScreenPlace,
  type ScreenSize
} from "./screen-model";
import { screenDisplayFromRow, screenItemFromRow, screenItemWriteOf, type ScreenDisplayHide } from "./screen-rows";
import { hideScreenItemSchema, parseScreenSnapshot, screenItemIdSchema, screenItemInputSchema, showScreenItemSchema, uploadScreenImageSchema, type ScreenItemInput } from "./screen-schemas";
import {
  archiveScreenItemRow,
  countScreenItemRows,
  fetchScreenDisplayRow,
  fetchScreenItemRow,
  hideScreenDisplayRow,
  insertScreenItemRow,
  readActiveScreenDisplayRows,
  readActiveScreenDisplayRowsOfItem,
  showScreenDisplayRow,
  updateScreenItemRow
} from "./screen-store";
import { assertWebinarNotArchived, fetchSessionRow, listSessionRows, requireWebinarRow, touchSessionRow } from "./store";

const LIST_PATH = "/admin/comunicacao/webinarios";
const SESSION_MISSING_MESSAGE = "Essa sessão não existe mais.";
const ERROS = WEBINAR_COPY.naTela.erros;
/** O aviso da Na tela no banco sem a 202611100002. */
const SCREEN_MIGRATION_MESSAGE = WEBINAR_COPY.exportar.migracaoPendente(WEBINARS_SCREEN_MIGRATION);
/** Quantos bytes do comeco da imagem o servidor le para as medidas e a animacao (o cabecalho VP8X cabe em 30). */
const SCREEN_IMAGE_SNIFF_BYTES = 64;

export type SavedScreenItem = { created: boolean; item: ScreenItem };
export type ArchivedScreenItem = { archived: boolean; id: string };
export type UploadedScreenImage = { height: number; path: string; width: number };
/** O item mostrado (`changed` falso: ele ja estava na tela como esta, nada mudou). */
export type ShownScreenItem = { changed: boolean; displayId: string; itemId: string; kind: ScreenKind; replaced: number; sessionId: string };
/** A exibicao tirada (`hidden` falso: ela ja tinha saido). */
export type HiddenScreenItem = { displayId: string; hidden: boolean; sessionId: string };

/* ------------------------------------------------------------------------------------------------
 * Apoio
 * ---------------------------------------------------------------------------------------------- */

function revalidateConsole(webinarId: string) {
  revalidatePath(`${LIST_PATH}/${webinarId}/sala`);
}

/** O relatorio da sessao fica 60 s em cache pela tag "webinars" (report-queries.ts): o que muda o bloco Na tela invalida. */
function invalidateReport() {
  invalidateWebinars({ from: "action" });
}

/** Uma leitura ou escrita que esbarra no banco sem a 202611100002 vira 409 com a frase da migracao. */
async function withScreenTables<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isPendingMigrationError(error)) {
      throw new WebinarError(SCREEN_MIGRATION_MESSAGE, 409);
    }
    throw error;
  }
}

type LoadedSession = { row: SessionRow; session: WebinarSession; webinar: WebinarRow };

async function loadSession(db: WebinarsDb, sessionId: string): Promise<LoadedSession> {
  const row = await fetchSessionRow(db, sessionId);

  if (!row) {
    throw new WebinarError(SESSION_MISSING_MESSAGE, 404);
  }

  return { row, session: sessionFromRow(row), webinar: await requireWebinarRow(db, row.webinar_id) };
}

/** A sessao aceita uma mudanca na tela: nunca no Replay nem na sessao encerrada ou cancelada (409 com a frase de cada caso). */
function assertScreenSession(session: WebinarSession) {
  if (session.kind === "replay") {
    throw new WebinarError(ERROS.replay, 409);
  }

  if (!canTeamActOn(session)) {
    throw new WebinarError(ERROS.sessaoFechada, 409);
  }
}

/** O offset do relogio do servidor dentro dos limites do banco; NaN vira nulo. */
function serverOffsetMs(session: WebinarSession, nowMs: number): number | null {
  const offset = sessionOffsetMs(session, nowMs);

  return Number.isFinite(offset) ? Math.max(CHAT_LIMITS.offsetMinMs, Math.min(CHAT_LIMITS.offsetMaxMs, Math.round(offset))) : null;
}

/** Quem tira da tela, quando e em que minuto da sessao, com o motivo. */
function screenHide(session: WebinarSession, userId: string, now: Date, reason: ScreenDisplayHide["hidden_reason"]): ScreenDisplayHide {
  return { hidden_at: now.toISOString(), hidden_by: userId, hidden_offset_ms: serverOffsetMs(session, now.getTime()), hidden_reason: reason };
}

/**
 * Confere a imagem do banner no nosso bucket: o caminho do padrao, o objeto existente, gravado como WebP, ate 200.000
 * bytes, e os primeiros 64 bytes (Range) com o cabecalho WebP de 16 a 1.280 px de lado, sem animacao. Devolve as medidas
 * lidas dos bytes (as do navegador nunca valem). Nada e apagado (a imagem pode ser de outro item).
 */
async function inspectScreenImage(db: WebinarsDb, path: string): Promise<{ height: number; width: number }> {
  if (!SCREEN_IMAGE_PATH_PATTERN.test(path)) {
    throw new WebinarFieldError("imagePath", ERROS.imagemSumiu);
  }

  const storage = db.storage.from(SCREEN_IMAGE_BUCKET);
  const info = await storage.info(path);

  if (info.error) {
    if (isStorageNotFound(info.error as { message?: string; status?: unknown; statusCode?: unknown })) {
      throw new WebinarFieldError("imagePath", ERROS.imagemSumiu);
    }

    throw new Error(`Webinarios: nao foi possivel ler a imagem da Na tela no Storage: ${info.error.message}`);
  }

  const details = info.data as { contentType?: unknown; metadata?: { mimetype?: unknown; size?: unknown } | null; size?: unknown };
  const sizeBytes = Number(details.size ?? details.metadata?.size ?? 0);

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || baseMimeType(details.contentType ?? details.metadata?.mimetype) !== "image/webp") {
    throw new WebinarFieldError("imagePath", ERROS.imagemFormato);
  }

  if (sizeBytes > SCREEN_LIMITS.imageBytes) {
    throw new WebinarFieldError("imagePath", ERROS.imagemPesada);
  }

  let head: Uint8Array;

  try {
    head = await readFirstBytes(storage.getPublicUrl(path).data.publicUrl, SCREEN_IMAGE_SNIFF_BYTES);
  } catch (error) {
    if (error instanceof CommunicationError) {
      throw new WebinarFieldError("imagePath", ERROS.imagemSumiu);
    }

    throw error;
  }

  return checkScreenImageBytes(head, "imagePath");
}

/** As medidas de um WebP do banner, ou o erro no campo: cabecalho WebP, de 16 a 1.280 px de lado, sem animacao. */
function checkScreenImageBytes(bytes: Uint8Array, field: string): { height: number; width: number } {
  const dimensions = readWebpDimensions(bytes);

  if (!dimensions) {
    throw new WebinarFieldError(field, ERROS.imagemFormato);
  }

  const { imageSideMax: max, imageSideMin: min } = SCREEN_LIMITS;

  if (dimensions.width < min || dimensions.width > max || dimensions.height < min || dimensions.height > max) {
    throw new WebinarFieldError(field, ERROS.imagemLado);
  }

  if (webpIsAnimated(bytes)) {
    throw new WebinarFieldError(field, ERROS.imagemAnimada);
  }

  return dimensions;
}

/** A imagem que o item vai gravar: a que ele ja tinha (sem conferir de novo) ou a nova, conferida no Storage. */
async function screenImageOf(db: WebinarsDb, data: ScreenItemInput, current: ScreenItem | null): Promise<{ alt: string | null; height: number; path: string; width: number } | null> {
  if (!data.imagePath) {
    return null;
  }

  const size = current?.image && current.image.path === data.imagePath ? current.image : await inspectScreenImage(db, data.imagePath);

  return { alt: data.imageAlt, height: size.height, path: data.imagePath, width: size.width };
}

/* ------------------------------------------------------------------------------------------------
 * Os itens prontos do webinario
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.write] Salva um banner ou um QR Code pronto (novo, ou a edicao de um nao arquivado do mesmo tipo). Ate 20
 * por webinario (409). A imagem nova e conferida no Storage; sem nome, o titulo, a legenda ou o dominio do link.
 * Auditoria `webinar.screen_item_saved`.
 */
export async function saveScreenItem(input: {
  body?: string | null;
  buttonLabel?: string | null;
  closable?: boolean;
  id?: string | null;
  imageAlt?: string | null;
  imagePath?: string | null;
  kind: ScreenKind;
  linkTarget?: ScreenLinkTarget | null;
  linkUrl?: string | null;
  name?: string | null;
  place?: ScreenPlace | null;
  size?: ScreenSize;
  title?: string | null;
  webinarId: string;
}): Promise<ActionResult<SavedScreenItem>> {
  return runWebinarAction("messaging.write", "conteudo", screenItemInputSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const webinar = await requireWebinarRow(db, data.webinarId);

    assertWebinarNotArchived(webinar);

    let current: ScreenItem | null = null;

    if (data.id) {
      const row = await fetchScreenItemRow(db, data.id);
      current = row && row.webinar_id === webinar.id && !row.archived_at ? screenItemFromRow(row) : null;

      if (!current) {
        throw new WebinarError(ERROS.itemSumiu, 404);
      }

      if (current.kind !== data.kind) {
        throw new WebinarError(ERROS.invalido, 400);
      }
    } else if ((await withScreenTables(() => countScreenItemRows(db, webinar.id))) >= SCREEN_LIMITS.itemsPerWebinar) {
      throw new WebinarError(ERROS.limite(SCREEN_LIMITS.itemsPerWebinar), 409);
    }

    const image = await screenImageOf(db, data, current);
    const write = screenItemWriteOf({
      body: data.body,
      buttonLabel: data.buttonLabel,
      closable: data.closable,
      image,
      kind: data.kind,
      linkTarget: data.linkTarget,
      linkUrl: data.linkUrl,
      name: data.name ?? screenItemDefaultName(data),
      place: data.place,
      size: data.size,
      title: data.title
    });
    const editing = current;
    const saved = editing
      ? await withScreenTables(() => updateScreenItemRow(db, editing.id, write))
      : await withScreenTables(() => insertScreenItemRow(db, { ...write, created_by: user.id, webinar_id: webinar.id }));
    const item = saved ? screenItemFromRow(saved) : null;

    if (!item) {
      // Arquivado por outra pessoa entre a leitura e a escrita.
      throw new WebinarError(ERROS.itemSumiu, 404);
    }

    await recordAudit(db, {
      action: "webinar.screen_item_saved",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { created: current === null, image: item.image !== null, item_id: item.id, kind: item.kind }
    });
    revalidateConsole(webinar.id);

    return { created: current === null, item };
  });
}

/**
 * [messaging.write] Arquiva um item pronto (o Excluir do console). Recusado com 409 enquanto ele esta na tela de uma
 * sessao que ainda mostra; o ja arquivado nao muda nada. Auditoria `webinar.screen_item_archived`.
 */
export async function archiveScreenItem(input: { id: string }): Promise<ActionResult<ArchivedScreenItem>> {
  return runWebinarAction("messaging.write", "conteudo", screenItemIdSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const row = await fetchScreenItemRow(db, data.id);

    if (!row) {
      throw new WebinarError(ERROS.itemSumiu, 404);
    }

    if (row.archived_at) {
      return { archived: false, id: row.id };
    }

    const webinar = await requireWebinarRow(db, row.webinar_id);

    assertWebinarNotArchived(webinar);

    // Na tela de uma sessao que ainda mostra (no ar ou na espera): a turma ve a copia, mas o item sai so depois de tirar.
    const [active, sessions] = await Promise.all([withScreenTables(() => readActiveScreenDisplayRowsOfItem(db, row.id)), listSessionRows(db, [webinar.id])]);
    const showing = new Set(sessions.filter((session) => canTeamActOn(sessionFromRow(session))).map((session) => session.id));

    if (active.some((display) => showing.has(display.session_id))) {
      throw new WebinarError(ERROS.tireDaTela, 409);
    }

    const archived = await withScreenTables(() => archiveScreenItemRow(db, row.id, new Date().toISOString()));

    if (!archived) {
      return { archived: false, id: row.id };
    }

    await recordAudit(db, {
      action: "webinar.screen_item_archived",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { item_id: row.id, kind: row.kind }
    });
    revalidateConsole(webinar.id);

    return { archived: true, id: row.id };
  });
}

/**
 * [messaging.write] Grava a imagem do banner (o WebP que o navegador reduziu) em content-assets/webinars/screen e
 * devolve o caminho e as medidas lidas pelo servidor, nunca um endereco. Recusa (400 no campo `image`) o que nao e WebP,
 * mais de 200.000 bytes, lado fora de 16 a 1.280 px e WebP animado. Auditoria `webinar.screen_image_uploaded`.
 */
export async function uploadScreenImage(input: { image: string }): Promise<ActionResult<UploadedScreenImage>> {
  return runWebinarAction("messaging.write", "conteudo", uploadScreenImageSchema, input, async ({ input: data, user }) => {
    const bytes = decodeWebpDataUrl(data.image);

    if (!bytes || bytes.length === 0) {
      throw new WebinarFieldError("image", ERROS.imagemFormato);
    }

    if (bytes.length > SCREEN_LIMITS.imageBytes) {
      throw new WebinarFieldError("image", ERROS.imagemPesada);
    }

    const dimensions = checkScreenImageBytes(bytes, "image");
    const url = (await persistImageAsset(data.image, SCREEN_IMAGE_FOLDER)).trim();
    const marker = `/storage/v1/object/public/${SCREEN_IMAGE_BUCKET}/`;
    const index = url.indexOf(marker);
    const path = index === -1 ? "" : url.slice(index + marker.length).split(/[?#]/)[0];

    if (!SCREEN_IMAGE_PATH_PATTERN.test(path)) {
      throw new Error("Webinarios: a imagem da Na tela nao foi enviada ao armazenamento.");
    }

    await recordAudit(webinarsDb(), {
      action: "webinar.screen_image_uploaded",
      actorId: user.id,
      entityId: null,
      entityType: "webinar",
      metadata: { height: dimensions.height, path, size_bytes: bytes.length, width: dimensions.width }
    });

    return { height: dimensions.height, path, width: dimensions.width };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Mostrar e tirar da tela numa sessao
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.write] Mostra um item pronto na sessao: o do mesmo tipo que estava sai (`replaced`) e a copia congelada
 * entra; o mesmo item ja na tela como esta nao grava nada. Replay, sessao encerrada ou cancelada: 409. Item arquivado
 * ou de outro webinario: 404. O carimbo da sessao muda por ultimo; auditoria `webinar.screen_shown`.
 */
export async function showScreenItem(input: { itemId: string; sessionId: string }): Promise<ActionResult<ShownScreenItem>> {
  return runWebinarAction("messaging.write", "atendimento", showScreenItemSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const { session, webinar } = await loadSession(db, data.sessionId);

    assertScreenSession(session);

    // O que esta na tela antes de gravar: sem a migracao, o aviso e nada nasce.
    const active = (await withScreenTables(() => readActiveScreenDisplayRows(db, session.id))).map(screenDisplayFromRow).filter((display) => display !== null);
    const row = await fetchScreenItemRow(db, data.itemId);
    const item = row && row.webinar_id === webinar.id && !row.archived_at ? screenItemFromRow(row) : null;

    if (!item) {
      throw new WebinarError(ERROS.itemSumiu, 404);
    }

    const current = active.find((display) => display.kind === item.kind);

    if (current && screenItemShowState(item, active) === "on") {
      return { changed: false, displayId: current.id, itemId: item.id, kind: item.kind, replaced: 0, sessionId: session.id };
    }

    const snapshot = parseScreenSnapshot(item.kind, snapshotOfItem(item));

    if (!snapshot) {
      throw new WebinarError(ERROS.invalido, 409);
    }

    const shown = await withScreenTables(() =>
      showScreenDisplayRow(
        db,
        {
          item_id: item.id,
          kind: item.kind,
          poll_id: null,
          session_id: session.id,
          shown_at: now.toISOString(),
          shown_by: user.id,
          shown_offset_ms: serverOffsetMs(session, now.getTime()),
          snapshot
        },
        screenHide(session, user.id, now, "replaced")
      )
    );

    if (!shown) {
      throw new WebinarError(GENERIC_ACTION_ERROR, 409);
    }

    // O carimbo por ultimo: a sala ve o item novo em ate cerca de 5 s.
    await touchSessionRow(db, session.id);
    await recordAudit(db, {
      action: "webinar.screen_shown",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { display_id: shown.row.id, item_id: item.id, kind: item.kind, replaced: shown.replaced.length, session_id: session.id }
    });
    revalidateConsole(webinar.id);
    invalidateReport();

    return { changed: true, displayId: shown.row.id, itemId: item.id, kind: item.kind, replaced: shown.replaced.length, sessionId: session.id };
  });
}

/**
 * [messaging.write] Tira da tela um banner ou um QR Code (motivo `team`); o que ja tinha saido nao muda nada. A enquete
 * fixada sai pelo Desafixar (unpinPoll). Replay, sessao encerrada ou cancelada: 409. O carimbo da sessao muda por
 * ultimo; auditoria `webinar.screen_hidden`.
 */
export async function hideScreenItem(input: { displayId: string }): Promise<ActionResult<HiddenScreenItem>> {
  return runWebinarAction("messaging.write", "atendimento", hideScreenItemSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const display = await fetchScreenDisplayRow(db, data.displayId);

    if (!display) {
      throw new WebinarError(ERROS.exibicaoSumiu, 404);
    }

    if (display.kind !== "banner" && display.kind !== "qr") {
      throw new WebinarError(ERROS.invalido, 400);
    }

    const { session, webinar } = await loadSession(db, display.session_id);

    assertScreenSession(session);

    // Nunca antes do shown_at da exibicao (o check _window_v7): o relogio de outra instancia pode estar adiantado.
    const hiddenAt = new Date(Math.max(now.getTime(), Date.parse(display.shown_at) || 0));
    const hidden = display.hidden_at ? null : await withScreenTables(() => hideScreenDisplayRow(db, display.id, screenHide(session, user.id, hiddenAt, "team")));

    if (!hidden) {
      return { displayId: display.id, hidden: false, sessionId: session.id };
    }

    await touchSessionRow(db, session.id);
    await recordAudit(db, {
      action: "webinar.screen_hidden",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { display_id: hidden.id, item_id: hidden.item_id, kind: hidden.kind, session_id: session.id }
    });
    revalidateConsole(webinar.id);
    invalidateReport();

    return { displayId: hidden.id, hidden: true, sessionId: session.id };
  });
}
