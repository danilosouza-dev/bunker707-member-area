// Arquivos da Comunicacao no Storage e quem usa cada um (docs/22 §4.6, limpeza automatica dos arquivos sem uso).
// Modulo puro (servidor e editor; sem zod, sem "server-only", imports relativos): os lugares onde a Comunicacao
// guarda arquivos e UMA funcao por tipo de conteudo que devolve os arquivos que ele usa. As mesmas funcoes servem
// ao salvar (storedPopupDesignAssetPaths no popup-design-router.ts: arquivo que a linha gravada ou um modelo ja usa
// nunca e conferido de novo) e ao job da limpeza (media-cleanup.ts: arquivo usado nunca e apagado).
//
// A leitura e de proposito larga e sem validar a fundo: qualquer texto que aponte para um arquivo do nosso Storage
// (endereco publico de qualquer origem, porque a origem muda entre nuvem e Hetzner, ou o caminho num campo de
// caminho) conta como uso. Errar para o lado de guardar custa espaco; errar para o outro lado quebra um pop-up.
// Campo novo de arquivo no design entra aqui junto: a guarda tests/comunicacao-limpeza-de-arquivos.guard.test.mjs
// falha quando o schema ou os tipos ganham um campo de arquivo que estas funcoes nao leem.

import {
  POPUP_CARD_IMAGE_BUCKET,
  POPUP_CARD_IMAGE_PATH_PATTERN,
  POPUP_FONT_PATH_PATTERN,
  POPUP_FONTS_BUCKET,
  POPUP_VIDEO_BUCKET,
  POPUP_VIDEO_PATH_PATTERN
} from "./popup-design-model";

/** Um arquivo no Storage: bucket e caminho dentro dele. */
export type MediaRef = { bucket: string; path: string };

/** Chave unica de um arquivo (bucket/caminho), para conjuntos e comparacoes. */
export function mediaKey(ref: MediaRef): string {
  return `${ref.bucket}/${ref.path}`;
}

/* ------------------------------------------------------------------------------------------------
 * Lugares da Comunicacao no Storage (so estes sao listados e limpos; o resto do bucket nunca e tocado)
 * ---------------------------------------------------------------------------------------------- */

/** Audio dos avisos (migracao 202610200001; envio em media.ts). */
export const NOTICE_AUDIO_BUCKET = "communication-audio";
/** campaigns/<24 hex do sha256>.<extensao> (persistNoticeAudio). */
export const NOTICE_AUDIO_PATH_PATTERN = /^campaigns\/[a-f0-9]{24}\.(?:aac|m4a|mp3|ogg|wav|webm)$/;
/** Imagens no bucket de imagens do app (o mesmo das capas). */
export const COMMUNICATION_IMAGE_BUCKET = POPUP_CARD_IMAGE_BUCKET;
/** Imagem do aviso, tambem fundo do cartao do Personalizado e imagem reaproveitada no Livre (uploadNoticeImage). */
export const NOTICE_IMAGE_PATH_PATTERN = POPUP_CARD_IMAGE_PATH_PATTERN;
/** Imagem enviada no editor Livre (uploadPopupFreeImage). */
export const FREE_UPLOAD_IMAGE_PATH_PATTERN = /^communications\/free\/[a-f0-9]{24}\.webp$/;

/**
 * Um lugar: o bucket, a pasta listada e o padrao do nome. Objeto da pasta que nao casa com o padrao nunca e
 * marcado nem apagado (arquivo que nao fomos nos que criamos fica onde esta).
 */
export type MediaLocation = { bucket: string; pattern: RegExp; prefix: string };

export const COMMUNICATION_MEDIA_LOCATIONS: readonly MediaLocation[] = [
  { bucket: POPUP_VIDEO_BUCKET, pattern: POPUP_VIDEO_PATH_PATTERN, prefix: "videos" },
  { bucket: POPUP_FONTS_BUCKET, pattern: POPUP_FONT_PATH_PATTERN, prefix: "fonts" },
  { bucket: NOTICE_AUDIO_BUCKET, pattern: NOTICE_AUDIO_PATH_PATTERN, prefix: "campaigns" },
  { bucket: COMMUNICATION_IMAGE_BUCKET, pattern: NOTICE_IMAGE_PATH_PATTERN, prefix: "communications/images" },
  { bucket: COMMUNICATION_IMAGE_BUCKET, pattern: FREE_UPLOAD_IMAGE_PATH_PATTERN, prefix: "communications/free" }
];

/** O lugar do arquivo (bucket igual e nome que casa com o padrao); null = fora dos nossos lugares. */
export function mediaLocationOf(ref: MediaRef, locations: readonly MediaLocation[] = COMMUNICATION_MEDIA_LOCATIONS): MediaLocation | null {
  return locations.find((location) => location.bucket === ref.bucket && location.pattern.test(ref.path)) ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * Enderecos e caminhos soltos
 * ---------------------------------------------------------------------------------------------- */

/** Trechos do endereco publico do Storage (objeto e imagem transformada) antes de <bucket>/<caminho>. */
const PUBLIC_STORAGE_MARKERS = ["/storage/v1/object/public/", "/storage/v1/render/image/public/"] as const;

/**
 * O arquivo de um endereco publico do Storage, de qualquer origem (a nuvem de teste e a Hetzner tem origens
 * diferentes e o banco guarda a de quando foi enviado). Sem query nem fragmento; null = nao e do Storage.
 */
export function storageRefOfUrl(value: unknown): MediaRef | null {
  if (typeof value !== "string" || value.length > 4_096) {
    return null;
  }

  let pathname: string;

  try {
    pathname = new URL(value.trim()).pathname;
  } catch {
    return null;
  }

  for (const marker of PUBLIC_STORAGE_MARKERS) {
    const index = pathname.indexOf(marker);

    if (index === -1) {
      continue;
    }

    const rest = pathname.slice(index + marker.length);
    const slash = rest.indexOf("/");

    if (slash <= 0 || slash === rest.length - 1) {
      return null;
    }

    try {
      return { bucket: decodeURIComponent(rest.slice(0, slash)), path: decodeURIComponent(rest.slice(slash + 1)) };
    } catch {
      return null;
    }
  }

  return null;
}

/** Um texto solto que e um dos nossos arquivos: endereco publico do Storage ou caminho de um dos nossos lugares. */
export function mediaRefOfText(value: string): MediaRef | null {
  const fromUrl = storageRefOfUrl(value);

  if (fromUrl) {
    return fromUrl;
  }

  const location = COMMUNICATION_MEDIA_LOCATIONS.find((candidate) => candidate.pattern.test(value));

  return location ? { bucket: location.bucket, path: value } : null;
}

/**
 * Todo texto de um JSON qualquer que aponte para um arquivo nosso (profundidade ate 24, ate 5.000 textos). Serve
 * ao que nao tem formato fixo (payload das notificacoes) e a guarda dos designs.
 */
export function mediaRefsInJson(value: unknown): MediaRef[] {
  const refs: MediaRef[] = [];
  let budget = 5_000;

  const visit = (item: unknown, depth: number) => {
    if (budget <= 0 || depth > 24) {
      return;
    }

    if (typeof item === "string") {
      budget -= 1;
      const ref = mediaRefOfText(item);

      if (ref) {
        refs.push(ref);
      }

      return;
    }

    if (Array.isArray(item)) {
      item.forEach((child) => visit(child, depth + 1));
      return;
    }

    if (item && typeof item === "object") {
      Object.values(item as Record<string, unknown>).forEach((child) => visit(child, depth + 1));
    }
  };

  visit(value, 0);

  return uniqueRefs(refs);
}

/** Sem repeticao, na ordem em que apareceram. */
export function uniqueRefs(refs: readonly MediaRef[]): MediaRef[] {
  const seen = new Map<string, MediaRef>();

  for (const ref of refs) {
    if (ref.bucket && ref.path && !seen.has(mediaKey(ref))) {
      seen.set(mediaKey(ref), { bucket: ref.bucket, path: ref.path });
    }
  }

  return [...seen.values()];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pathRef(bucket: string, value: unknown): MediaRef | null {
  return typeof value === "string" && value.trim() ? { bucket, path: value.trim() } : null;
}

/* ------------------------------------------------------------------------------------------------
 * Uma funcao por tipo de conteudo
 * ---------------------------------------------------------------------------------------------- */

/**
 * Design Personalizado (docs/26): o video da midia (caminho e endereco; fica guardado mesmo com a midia em
 * "imagem") e a imagem do fundo do cartao. A imagem da midia e a do aviso (campaigns.image_url).
 */
export function customDesignMediaRefs(value: unknown): MediaRef[] {
  if (!isObject(value)) {
    return [];
  }

  const refs: (MediaRef | null)[] = [];
  const media = isObject(value.media) ? value.media : null;
  const video = media && isObject(media.video) ? media.video : null;

  if (video) {
    refs.push(pathRef(POPUP_VIDEO_BUCKET, video.path), storageRefOfUrl(video.url));
  }

  const card = isObject(value.card) ? value.card : null;
  const background = card && isObject(card.background) ? card.background : null;

  if (background && background.kind === "image") {
    refs.push(storageRefOfUrl(background.url));
  }

  return uniqueRefs(refs.filter((ref): ref is MediaRef => ref !== null));
}

/**
 * Design Livre (docs/27): todo arquivo de `assets` (imagem no bucket de imagens, video no de videos), usado ou
 * nao pelos elementos. O design guarda so o caminho; a capa do video e uma imagem de `assets`.
 */
export function freeDesignMediaRefs(value: unknown): MediaRef[] {
  if (!isObject(value) || !Array.isArray(value.assets)) {
    return [];
  }

  const refs: MediaRef[] = [];

  for (const item of value.assets) {
    if (!isObject(item) || typeof item.path !== "string" || !item.path.trim()) {
      continue;
    }

    // Tipo desconhecido: os dois buckets (guardar a mais nunca quebra nada).
    const buckets = item.kind === "video" ? [POPUP_VIDEO_BUCKET] : item.kind === "image" ? [COMMUNICATION_IMAGE_BUCKET] : [POPUP_VIDEO_BUCKET, COMMUNICATION_IMAGE_BUCKET];

    for (const bucket of buckets) {
      refs.push({ bucket, path: item.path.trim() });
    }
  }

  return uniqueRefs(refs);
}

/** O que a coluna do design guarda: Livre (mode "free") ou Personalizado; nulo (Padrão) = nenhum arquivo. */
export function popupDesignMediaRefs(value: unknown): MediaRef[] {
  if (!isObject(value)) {
    return [];
  }

  return value.mode === "free" ? freeDesignMediaRefs(value) : customDesignMediaRefs(value);
}

/** Ids das fontes enviadas do design gravado (Livre e Personalizado guardam `fonts` na raiz), minusculos e ordenados. */
export function designFontIds(value: unknown): string[] {
  if (!isObject(value) || !Array.isArray(value.fonts)) {
    return [];
  }

  return [...new Set(value.fonts.filter((id): id is string => typeof id === "string").map((id) => id.toLowerCase()))].sort();
}

/** Colunas de campaigns que guardam arquivo (o resto e texto, regra ou numero; a guarda confere a lista). */
export const CAMPAIGN_MEDIA_COLUMNS = ["image_url", "audio_url", "popup_design"] as const;
export type CampaignMediaRow = { audio_url?: unknown; image_url?: unknown; popup_design?: unknown };

/**
 * Aviso, pop-up ou passo de fluxo (o conteudo de um passo e um aviso com flow_id): a imagem, o audio e o design.
 * Imagem de fora do nosso Storage nao conta (nao e nossa para apagar).
 */
export function campaignMediaRefs(row: CampaignMediaRow): MediaRef[] {
  return uniqueRefs(
    [storageRefOfUrl(row.image_url), storageRefOfUrl(row.audio_url), ...popupDesignMediaRefs(row.popup_design)].filter(
      (ref): ref is MediaRef => ref !== null
    )
  );
}

/**
 * Tipos de notificacao que nunca guardam arquivo: a de aviso aponta para o aviso (os arquivos contam pelo aviso,
 * e o sino so mostra aviso nao excluido); as de comentario guardam ids e o titulo da aula. Tipo novo entra numa
 * das duas listas (a guarda confere): se o payload dele puder ter arquivo, vai para a segunda, e o job le.
 */
export const NOTIFICATION_KINDS_WITHOUT_MEDIA = ["notice", "comment_reply", "comment_mention"] as const;
export const NOTIFICATION_KINDS_WITH_MEDIA: readonly string[] = [];

/** Arquivos citados no payload de uma notificacao (qualquer texto que aponte para um arquivo nosso). */
export function notificationMediaRefs(row: { payload?: unknown }): MediaRef[] {
  return mediaRefsInJson(row.payload);
}

/** Linha da biblioteca de fontes (communication_fonts). */
export type FontFileRow = { deleted_at: string | null; file_path: string; id: string };

/**
 * Arquivos das fontes em uso: toda fonte da biblioteca (nao excluida) e a excluida que um aviso nao excluido ou um
 * modelo ainda cita pelo id (pop-up gravado nunca perde a fonte). O mesmo arquivo pode estar numa linha excluida e
 * numa nova (o indice unico do caminho so vale para as nao excluidas).
 */
export function fontFileRefs(rows: readonly FontFileRow[], usedFontIds: Iterable<string>): MediaRef[] {
  const used = new Set([...usedFontIds].map((id) => id.toLowerCase()));

  return uniqueRefs(
    rows
      .filter((row) => typeof row.file_path === "string" && (!row.deleted_at || used.has(String(row.id).toLowerCase())))
      .map((row) => ({ bucket: POPUP_FONTS_BUCKET, path: row.file_path }))
  );
}

/**
 * O que um modelo segura (docs/28 D17; tabela communication_templates, lida por loadTemplateMediaUse em
 * media-cleanup.ts): os arquivos e as fontes do payload dele, lidos do jsonb CRU (nunca do parse: um modelo que
 * deixasse de passar no schema perderia os arquivos e continuaria na lista).
 */
export type TemplateMediaUse = { fontIds: string[]; refs: MediaRef[] };
export type TemplateMediaRow = { payload?: unknown };

function urlRef(value: unknown): MediaRef | null {
  return isObject(value) ? storageRefOfUrl(value.url) : null;
}

/** A imagem e o audio de um conteudo (o do modelo e o de cada seguinte). */
function contentMediaRefs(value: unknown): (MediaRef | null)[] {
  return isObject(value) ? [urlRef(value.image), urlRef(value.audio)] : [];
}

/**
 * Os campos de arquivo conhecidos do payload de um modelo: content.image.url, content.audio.url,
 * designSupport.image.url, o design (popupDesignMediaRefs) e, para cada seguinte em qualquer nivel,
 * items[].content.image.url e .audio.url. Nao dependem da varredura larga (que tem teto de textos).
 */
export function templateFieldMediaRefs(payload: unknown): MediaRef[] {
  if (!isObject(payload)) {
    return [];
  }

  const refs: (MediaRef | null)[] = [...contentMediaRefs(payload.content)];
  const support = isObject(payload.designSupport) ? payload.designSupport : null;

  if (support) {
    refs.push(urlRef(support.image));
  }

  refs.push(...popupDesignMediaRefs(payload.design));

  const followUps = isObject(payload.followUps) ? payload.followUps : null;
  const walk = (items: unknown, depth: number) => {
    if (!Array.isArray(items) || depth > 24) {
      return;
    }

    for (const item of items) {
      if (isObject(item)) {
        refs.push(...contentMediaRefs(item.content));
        walk(item.children, depth + 1);
      }
    }
  };

  walk(followUps?.items, 0);

  return uniqueRefs(refs.filter((ref): ref is MediaRef => ref !== null));
}

/**
 * O que um modelo segura: os campos conhecidos (templateFieldMediaRefs) unidos a varredura larga
 * mediaRefsInJson(payload) (que tem teto de 5.000 textos: os campos conhecidos nunca dependem dela).
 * fontIds = designFontIds(payload.design).
 */
export function templateMediaUse(template: TemplateMediaRow): TemplateMediaUse {
  const payload = isObject(template.payload) ? template.payload : null;

  if (!payload) {
    return { fontIds: [], refs: [] };
  }

  return { fontIds: designFontIds(payload.design), refs: uniqueRefs([...templateFieldMediaRefs(payload), ...mediaRefsInJson(payload)]) };
}
