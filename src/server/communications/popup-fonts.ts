import "server-only";

// Fontes enviadas e enderecos do Storage do design do pop-up (docs/26). O navegador nunca le
// communication_fonts: o servidor resolve as fontes de cada pop-up (familia bf_..., endereco publico do
// bucket communication-fonts, peso e estilo) e manda junto com o pop-up (show, resumo, previa e relatorio).
// - loadPopupFontFaces: por id, sem olhar deleted_at (pop-up gravado nunca perde a fonte; o arquivo fica);
// - listPopupFontLibrary: a biblioteca do editor (so as nao excluidas, por nome);
// - assertPopupDesignFonts: salvar e publicar so com fontes que existem na biblioteca (400 no campo);
// - withOwnStorageUrls: o endereco do video sempre recalculado a partir do caminho (nunca o que veio do
//   navegador), entao so aponta para o nosso bucket.
// Envio, renomear e excluir fontes e o envio do video moram em popup-design-actions.ts e nas rotas do admin.

import { assertNoDbError, NoticeFieldError, type CommunicationsDb } from "./db";
import {
  POPUP_FONT_FAMILY_PATTERN,
  POPUP_FONT_FORMATS,
  POPUP_FONT_PATH_PATTERN,
  POPUP_FONT_STYLES,
  POPUP_FONTS_BUCKET,
  POPUP_VIDEO_BUCKET,
  type PopupDesign,
  type PopupFontFace,
  type PopupFontFormat,
  type PopupFontOption,
  type PopupFontStyle
} from "./popup-design-model";

export const POPUP_FONT_COLUMNS = "id,name,family_key,file_path,format,weight,style,size_bytes,created_by,created_at,deleted_at";

export type PopupFontRow = {
  created_at: string;
  created_by: string | null;
  deleted_at: string | null;
  family_key: string;
  file_path: string;
  format: string;
  id: string;
  name: string;
  size_bytes: number;
  style: string;
  weight: number;
};

export const POPUP_FONT_MISSING_MESSAGE = "Esta fonte não está mais na biblioteca. Escolha outra.";

/** Endereco publico de um objeto dos buckets do design (o cliente de servico so monta o texto). */
export function popupStoragePublicUrl(db: CommunicationsDb, bucket: typeof POPUP_FONTS_BUCKET | typeof POPUP_VIDEO_BUCKET, objectPath: string) {
  return db.storage.from(bucket).getPublicUrl(objectPath).data.publicUrl;
}

/** A linha vira o que o FontFace do aluno precisa; linha fora do formato = null (nunca vai ao navegador). */
export function fontRowToFace(db: CommunicationsDb, row: PopupFontRow): PopupFontFace | null {
  if (
    !POPUP_FONT_FAMILY_PATTERN.test(row.family_key) ||
    !POPUP_FONT_PATH_PATTERN.test(row.file_path) ||
    !(POPUP_FONT_FORMATS as readonly string[]).includes(row.format) ||
    !(POPUP_FONT_STYLES as readonly string[]).includes(row.style)
  ) {
    return null;
  }

  return {
    family: row.family_key,
    format: row.format as PopupFontFormat,
    id: row.id,
    style: row.style as PopupFontStyle,
    url: popupStoragePublicUrl(db, POPUP_FONTS_BUCKET, row.file_path),
    weight: Math.min(900, Math.max(100, Math.round(row.weight / 100) * 100))
  };
}

/** Fontes pelos ids (uma consulta; excluidas tambem valem para o que ja foi gravado). */
export async function loadPopupFontFaces(db: CommunicationsDb, ids: readonly string[]): Promise<PopupFontFace[]> {
  const unique = [...new Set(ids.map((id) => id.toLowerCase()))].sort();

  if (unique.length === 0) {
    return [];
  }

  const { data, error } = await db.from("communication_fonts").select(POPUP_FONT_COLUMNS).in("id", unique);
  assertNoDbError(error, "Comunicacao: fontes do pop-up");

  return ((data ?? []) as PopupFontRow[]).map((row) => fontRowToFace(db, row)).filter((face): face is PopupFontFace => face !== null);
}

/** A biblioteca do editor: as fontes nao excluidas, por nome. */
export async function listPopupFontLibrary(db: CommunicationsDb): Promise<PopupFontOption[]> {
  const { data, error } = await db
    .from("communication_fonts")
    .select(POPUP_FONT_COLUMNS)
    .is("deleted_at", null)
    .order("name", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(200);
  assertNoDbError(error, "Comunicacao: biblioteca de fontes");

  return ((data ?? []) as PopupFontRow[]).flatMap((row) => {
    const face = fontRowToFace(db, row);

    return face ? [{ ...face, createdAt: row.created_at, name: row.name, sizeBytes: row.size_bytes }] : [];
  });
}

/** Salvar ou publicar um design so com fontes da biblioteca (nao excluidas): senao 400 em design.fonts. */
export async function assertPopupDesignFonts(db: CommunicationsDb, design: PopupDesign | null | undefined) {
  const ids = design?.fonts ?? [];

  if (ids.length === 0) {
    return;
  }

  const { data, error } = await db.from("communication_fonts").select("id").in("id", ids).is("deleted_at", null);
  assertNoDbError(error, "Comunicacao: fontes do pop-up");

  const found = new Set(((data ?? []) as { id: string }[]).map((row) => row.id.toLowerCase()));

  if (ids.some((id) => !found.has(id))) {
    throw new NoticeFieldError("design.fonts", POPUP_FONT_MISSING_MESSAGE);
  }
}

/** O design com o endereco do video recalculado do caminho (sempre o nosso bucket publico). */
export function withOwnStorageUrls<T extends PopupDesign | null | undefined>(db: CommunicationsDb, design: T): T {
  if (!design?.media.video) {
    return design;
  }

  return {
    ...design,
    media: { ...design.media, video: { ...design.media.video, url: popupStoragePublicUrl(db, POPUP_VIDEO_BUCKET, design.media.video.path) } }
  };
}
