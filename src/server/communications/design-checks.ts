import "server-only";

// Conferencias de arquivo do design do pop-up ao salvar (aviso ou modelo; docs/26, docs/27 e docs/28 D16), tiradas
// de actions.ts. Um caminho que nenhum design conhecido usa passa pela conferencia do Storage; os conhecidos (a
// linha gravada, os modelos de onde o aviso veio, o aviso de onde o modelo veio e os modelos aplicados) nunca sao
// conferidos de novo. Nada aqui apaga arquivo: o recusado recebe 400 no campo e fica para a limpeza de 30 dias.
//
// O fim do envio do video (finishPopupVideoUpload) e o unico lugar que pede para apagar o recusado, e so o envio
// novo de verdade: criado ha menos de 1 hora e que nenhum aviso ou modelo nao excluido cita (mayRemoveRefusedVideo).
// O caminho de um "Tentar de novo" ou de uma chamada repetida pode ja estar num modelo.

import { CommunicationError, NoticeFieldError, type CommunicationsDb } from "./db";
import { isMissingTemplatesTable } from "./media-cleanup";
import { popupCardImagePathOf, type PopupDesign } from "./popup-design-model";
import { storedPopupDesignAssetPaths } from "./popup-design-router";
import { POPUP_DESIGN_MESSAGES } from "./popup-design-schema";
import { withOwnStorageUrls } from "./popup-fonts";
import { assertPopupFreeAssets } from "./popup-free-assets";
import type { PopupFreeDesign } from "./popup-free-model";
import { inspectPopupCardImage, inspectPopupVideo } from "./popup-media";
import { TEMPLATES_TABLE } from "./template-model";

const HOUR_MS = 3_600_000;

function knownPaths(known: readonly unknown[]): Set<string> {
  return new Set(known.flatMap((design) => storedPopupDesignAssetPaths(design)));
}

/**
 * O video so entra no design conferido pelo servidor: um caminho que nenhum design conhecido usa passa de novo pela
 * conferencia do envio (existe, ate 15 MB, os primeiros bytes e o tipo gravado batem). Sem isso, um objeto enviado
 * pelo endereco assinado sem passar por finishPopupVideoUpload seria aceito. O recusado NAO e apagado (docs/28 D16).
 */
async function checkCustomVideo(db: CommunicationsDb, design: PopupDesign, paths: Set<string>) {
  const video = design.media.video;

  if (!video || paths.has(video.path)) {
    return;
  }

  try {
    await inspectPopupVideo(db, video.path);
  } catch (error) {
    if (error instanceof CommunicationError) {
      throw new NoticeFieldError("design.media.video", error.message);
    }

    throw error;
  }
}

/**
 * A imagem do fundo do cartao so entra conferida: o schema ja garantiu o caminho do nosso bucket de imagens
 * (communications/images/<24 hex>.webp, qualquer origem no endereco: o servidor troca pela nossa); um caminho que
 * nenhum design conhecido usa precisa existir no Storage como WebP (400 em design.card.background.url).
 */
async function checkCustomCardImage(db: CommunicationsDb, design: PopupDesign, paths: Set<string>) {
  const background = design.card.background;

  if (background.kind !== "image") {
    return;
  }

  const path = popupCardImagePathOf(background.url);

  if (path && paths.has(path)) {
    return;
  }

  try {
    if (!path) {
      throw new CommunicationError(POPUP_DESIGN_MESSAGES.cardImage, 400);
    }

    await inspectPopupCardImage(db, path);
  } catch (error) {
    if (error instanceof CommunicationError) {
      throw new NoticeFieldError("design.card.background.url", error.message);
    }

    throw error;
  }
}

/** Personalizado: video e imagem do fundo conferidos se nenhum `known` os cita; devolve withOwnStorageUrls(design). Erros: "design.media.video", "design.card.background.url". */
export async function checkCustomDesignFiles(db: CommunicationsDb, design: PopupDesign, known: readonly unknown[]): Promise<PopupDesign> {
  const paths = knownPaths(known);

  await checkCustomVideo(db, design, paths);
  await checkCustomCardImage(db, design, paths);

  return withOwnStorageUrls(db, design);
}

/** Livre: assertPopupFreeAssets com a lista. Erros: "freeDesign.assets.<id>". */
export async function checkFreeDesignFiles(db: CommunicationsDb, design: PopupFreeDesign, known: readonly unknown[]): Promise<PopupFreeDesign> {
  return assertPopupFreeAssets(db, design, known);
}

/** Atalho pelo modo. */
export async function checkDesignFiles(db: CommunicationsDb, design: PopupDesign | PopupFreeDesign, known: readonly unknown[]): Promise<PopupDesign | PopupFreeDesign> {
  return (design as { mode?: unknown }).mode === "free"
    ? checkFreeDesignFiles(db, design as PopupFreeDesign, known)
    : checkCustomDesignFiles(db, design as PopupDesign, known);
}

type CountResult = { count: number | null; error: { code?: string | null; message: string } | null };

function countOf(result: CountResult, context: string, templates: boolean): number {
  if (result.error) {
    if (templates && isMissingTemplatesTable(result.error)) {
      return 0;
    }

    throw new Error(`Comunicacao: ${context}: ${result.error.message}`);
  }

  return result.count ?? 0;
}

/**
 * Algum aviso ou modelo nao excluido cita o caminho? campaigns.popup_design contem { media: { video: { path } } } ou
 * { assets: [{ path }] }; communication_templates.payload contem { design: { media: { video: { path } } } } ou
 * { design: { assets: [{ path }] } }. Tabela de modelos ausente (42P01/PGRST205 citando communication_templates) =
 * nenhum modelo; qualquer outro erro lanca (e nada e apagado).
 */
export async function videoPathInUse(db: CommunicationsDb, path: string): Promise<boolean> {
  const campaigns = (filter: Record<string, unknown>) =>
    db.from("campaigns").select("id", { count: "exact", head: true }).contains("popup_design", filter).is("deleted_at", null);
  const templates = (filter: Record<string, unknown>) =>
    db.from(TEMPLATES_TABLE).select("id", { count: "exact", head: true }).contains("payload", { design: filter }).is("deleted_at", null);
  const [customNotice, freeNotice, customTemplate, freeTemplate] = (await Promise.all([
    campaigns({ media: { video: { path } } }),
    campaigns({ assets: [{ path }] }),
    templates({ media: { video: { path } } }),
    templates({ assets: [{ path }] })
  ])) as CountResult[];

  return (
    countOf(customNotice, "avisos com o video", false) +
      countOf(freeNotice, "avisos Livres com o video", false) +
      countOf(customTemplate, "modelos com o video", true) +
      countOf(freeTemplate, "modelos Livres com o video", true) >
    0
  );
}

/** O fim do envio so apaga o envio novo de verdade: createdAt ha menos de 1 hora e !videoPathInUse. createdAt null = nao apaga. */
export async function mayRemoveRefusedVideo(db: CommunicationsDb, path: string, createdAt: string | null, now: Date): Promise<boolean> {
  const created = createdAt ? Date.parse(createdAt) : Number.NaN;

  if (!Number.isFinite(created) || now.getTime() - created >= HOUR_MS) {
    return false;
  }

  return !(await videoPathInUse(db, path));
}
