// As linhas da "Na tela" no banco (202611100002: webinar_screen_items, webinar_screen_displays e webinar_screen_report)
// e a traducao para o modelo. Arquivo proprio (rows.ts e chat-rows.ts nao mudam). Modulo puro (sem "server-only",
// imports relativos) para os testes carregarem os tradutores direto; quem le e grava e screen-store.ts.
//
// A copia congelada de cada exibicao (snapshot) passa pelo zod tambem na leitura: a que nao passa vira null e nada e
// desenhado (screen-model.studentScreenItem). Um tipo, posicao ou tamanho que este app nao conhece (um app mais novo
// gravou) nunca quebra a leitura: o item ou a exibicao de tipo desconhecido fica de fora; posicao e tamanho voltam ao
// padrao.

import {
  SCREEN_DEFAULT_PLACE,
  SCREEN_DEFAULT_SIZE,
  SCREEN_DISPLAY_KINDS,
  SCREEN_HIDDEN_REASONS,
  SCREEN_KINDS,
  SCREEN_PLACES,
  SCREEN_SIZES,
  type ScreenDisplay,
  type ScreenDisplayKind,
  type ScreenHiddenReason,
  type ScreenItem,
  type ScreenKind,
  type ScreenPlace,
  type ScreenSize
} from "./screen-model";
import { parseScreenSnapshot } from "./screen-schemas";

function oneOf<T extends string>(values: readonly T[], value: unknown): T | null {
  return (values as readonly unknown[]).includes(value) ? (value as T) : null;
}

/* ------------------------------------------------------------------------------------------------
 * webinar_screen_items
 * ---------------------------------------------------------------------------------------------- */

export const SCREEN_ITEM_COLUMNS =
  "id, webinar_id, kind, name, title, body, button_label, link_url, image_path, image_width, image_height, image_alt, place, size, closable, created_by, created_at, updated_at, archived_at";

export type ScreenItemRow = {
  archived_at: string | null;
  body: string | null;
  button_label: string | null;
  closable: boolean;
  created_at: string;
  created_by: string | null;
  id: string;
  image_alt: string | null;
  image_height: number | null;
  image_path: string | null;
  image_width: number | null;
  kind: string;
  link_url: string | null;
  name: string;
  place: string;
  size: string;
  title: string | null;
  updated_at: string;
  webinar_id: string;
};

/** O item pronto; null para um tipo que este app nao conhece. */
export function screenItemFromRow(row: ScreenItemRow): ScreenItem | null {
  const kind = oneOf<ScreenKind>(SCREEN_KINDS, row.kind);

  if (!kind) {
    return null;
  }

  const image =
    row.image_path && row.image_width !== null && row.image_height !== null ? { alt: row.image_alt, height: row.image_height, path: row.image_path, width: row.image_width } : null;

  return {
    archivedAt: row.archived_at,
    body: row.body,
    buttonLabel: row.button_label,
    closable: row.closable !== false,
    createdAt: row.created_at,
    id: row.id,
    image,
    kind,
    linkUrl: row.link_url,
    name: row.name,
    place: oneOf<ScreenPlace>(SCREEN_PLACES, row.place) ?? SCREEN_DEFAULT_PLACE[kind],
    size: oneOf<ScreenSize>(SCREEN_SIZES, row.size) ?? SCREEN_DEFAULT_SIZE,
    title: row.title,
    updatedAt: row.updated_at,
    webinarId: row.webinar_id
  };
}

/** O que salvar grava (o id e as datas o banco cria; updated_at o gatilho mantem). */
export type ScreenItemWrite = {
  body: string | null;
  button_label: string | null;
  closable: boolean;
  image_alt: string | null;
  image_height: number | null;
  image_path: string | null;
  image_width: number | null;
  kind: ScreenKind;
  link_url: string | null;
  name: string;
  place: ScreenPlace;
  size: ScreenSize;
  title: string | null;
};

/** A linha a gravar a partir do item ja conferido (os campos do formulario, o nome final e as medidas relidas da imagem). */
export function screenItemWriteOf(input: {
  body: string | null;
  buttonLabel: string | null;
  closable: boolean;
  image: { alt: string | null; height: number; path: string; width: number } | null;
  kind: ScreenKind;
  linkUrl: string | null;
  name: string;
  place: ScreenPlace;
  size: ScreenSize;
  title: string | null;
}): ScreenItemWrite {
  return {
    body: input.kind === "qr" ? null : input.body,
    button_label: input.kind === "qr" ? null : input.buttonLabel,
    closable: input.closable,
    image_alt: input.image ? input.image.alt : null,
    image_height: input.image ? input.image.height : null,
    image_path: input.image ? input.image.path : null,
    image_width: input.image ? input.image.width : null,
    kind: input.kind,
    link_url: input.linkUrl,
    name: input.name,
    place: input.place,
    size: input.size,
    title: input.title
  };
}

/* ------------------------------------------------------------------------------------------------
 * webinar_screen_displays
 * ---------------------------------------------------------------------------------------------- */

export const SCREEN_DISPLAY_COLUMNS =
  "id, session_id, kind, item_id, poll_id, snapshot, shown_at, shown_offset_ms, shown_by, hidden_at, hidden_offset_ms, hidden_by, hidden_reason, created_at";

export type ScreenDisplayRow = {
  created_at: string;
  hidden_at: string | null;
  hidden_by: string | null;
  hidden_offset_ms: number | null;
  hidden_reason: string | null;
  id: string;
  item_id: string | null;
  kind: string;
  poll_id: string | null;
  session_id: string;
  shown_at: string;
  shown_by: string | null;
  shown_offset_ms: number | null;
  snapshot: unknown;
};

/** A exibicao, com a copia conferida pelo zod (invalida: snapshot null); null para um tipo que este app nao conhece. */
export function screenDisplayFromRow(row: ScreenDisplayRow): ScreenDisplay | null {
  const kind = oneOf<ScreenDisplayKind>(SCREEN_DISPLAY_KINDS, row.kind);

  if (!kind) {
    return null;
  }

  return {
    createdAt: row.created_at,
    hiddenAt: row.hidden_at,
    hiddenBy: row.hidden_by,
    hiddenOffsetMs: row.hidden_offset_ms,
    hiddenReason: oneOf<ScreenHiddenReason>(SCREEN_HIDDEN_REASONS, row.hidden_reason),
    id: row.id,
    itemId: row.item_id,
    kind,
    pollId: row.poll_id,
    sessionId: row.session_id,
    shownAt: row.shown_at,
    shownBy: row.shown_by,
    shownOffsetMs: row.shown_offset_ms,
    snapshot: parseScreenSnapshot(kind, row.snapshot)
  };
}

/** O que o Mostrar (e o Fixar da enquete) grava. */
export type ScreenDisplayInsert = {
  item_id: string | null;
  kind: ScreenDisplayKind;
  poll_id: string | null;
  session_id: string;
  shown_at: string;
  shown_by: string | null;
  shown_offset_ms: number | null;
  snapshot: Record<string, unknown>;
};

/** O que o Tirar da tela (e o trocar, e o encerrar a enquete) grava. */
export type ScreenDisplayHide = {
  hidden_at: string;
  hidden_by: string | null;
  hidden_offset_ms: number | null;
  hidden_reason: ScreenHiddenReason;
};

/* ------------------------------------------------------------------------------------------------
 * webinar_screen_report
 * ---------------------------------------------------------------------------------------------- */

/** Uma linha da funcao (os bigint chegam como numero ou texto, conforme o caminho). */
export type ScreenReportRow = {
  clickers: number | string | null;
  clicks: number | string | null;
  closed: number | string | null;
  display_id: string | null;
  shown: number | string | null;
};

/** Os numeros de uma exibicao: alunos distintos que viram, clicaram e fecharam, e o total de cliques. */
export type ScreenStats = { clickers: number; clicks: number; closed: number; shown: number };

export const EMPTY_SCREEN_STATS: ScreenStats = { clickers: 0, clicks: 0, closed: 0, shown: 0 };

const count = (value: number | string | null) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

/** As linhas da funcao por id da exibicao (a linha sem id fica de fora). */
export function screenStatsFromRows(rows: readonly ScreenReportRow[]): Map<string, ScreenStats> {
  const stats = new Map<string, ScreenStats>();

  for (const row of rows) {
    if (!row.display_id) {
      continue;
    }

    stats.set(row.display_id, { clickers: count(row.clickers), clicks: count(row.clicks), closed: count(row.closed), shown: count(row.shown) });
  }

  return stats;
}
