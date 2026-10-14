// Destaque da home do aluno (Area de membros > Destaque): o banner do topo da home, com imagem ou
// video, selo, titulo, descricao e um botao com link. Modulo puro (zod, sem "server-only"): o editor
// valida com os mesmos schemas da Server Action e os testes carregam direto pelo Node.
//
// Onde grava: public.platform_settings.hero (a mesma chave que a home ja lia e que a rota da Marca,
// PUT /api/admin/appearance, atualiza espalhando o que existe; por isso botao e capa do video
// sobrevivem a uma troca de logo). Formato gravado = HomeHeroConfig (src/lib/platform-types.ts):
// - `image`: a imagem (mediaType "image") ou o link do video (mediaType "video"), como sempre foi;
// - `poster`: capa do video (so com video);
// - `glowColor`: cor da luz de fundo atras do destaque (#rrggbb; ausente = automatica, a cor da imagem);
// - `cta`: { href, label, target } e `visibility.cta`;
// - texto escondido continua guardado (desligar "Mostrar título" nao apaga o titulo);
// - chaves que o editor nao conhece (ex.: `purpose`) sao preservadas.

import { z } from "zod";
import type { HomeHeroConfig } from "../../lib/platform-types";
import { describeVideoFileLinkProblem, videoFileLinkSchema } from "../../lib/video-file-link";
import {
  defaultCtaTarget,
  describeHeroCtaHrefProblem,
  isSafeHeroCtaHref,
  type HeroCtaTarget
} from "./home-hero-links";
import { memberAreaImageRefSchema, settingVersionSchema } from "./schemas";

export {
  HOME_PAGE_LINKS,
  defaultCtaTarget,
  describeCtaDestination,
  homePageLabel,
  isSafeHeroCtaHref,
  productHref,
  productIdFromHref,
  type HeroCtaDestination,
  type HeroCtaDestinationMode,
  type HeroCtaTarget
} from "./home-hero-links";

/** Imagem padrao do destaque (mesma do defaultHero de src/server/db/platform-store.ts). */
export const DEFAULT_HOME_HERO_IMAGE = "/hero/bunker-707-red-front-hero.png";

export const HERO_TEXT_LIMITS = { badge: 40, ctaLabel: 32, description: 240, title: 90 } as const;

const HERO_PURPOSES = new Set<HomeHeroConfig["purpose"]>(["school-brand", "editorial-highlight", "content-highlight"]);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/* ------------------------------------------------------------------------------------------------
 * Schemas
 * ---------------------------------------------------------------------------------------------- */

/** Destino do botao: caminho interno da area ou link https (vazio nao vale; ver heroCtaHrefFieldSchema). */
export const heroCtaHrefSchema: z.ZodType<string> = z.string({ error: "Escolha para onde o botão leva." }).trim().superRefine((value, context) => {
  const problem = describeHeroCtaHrefProblem(value);

  if (problem) {
    context.addIssue({ code: "custom", message: problem });
  }
});

/** Campo "para onde leva" do rascunho: vazio vale (botao ainda sem destino); preenchido, tem que servir. */
const heroCtaHrefFieldSchema = z.string().trim().superRefine((value, context) => {
  const problem = value ? describeHeroCtaHrefProblem(value) : null;

  if (problem) {
    context.addIssue({ code: "custom", message: problem });
  }
});

/** Motivo para um link de video nao servir; null quando serve (regra compartilhada em src/lib/video-file-link.ts). */
export const describeHeroVideoLinkProblem = describeVideoFileLinkProblem;

/** Link direto de video (https, terminando em .mp4, .webm ou .mov antes de ? ou #). */
export const heroVideoLinkSchema = videoFileLinkSchema;

/** Cor da luz de fundo: #rrggbb (o seletor de cor do navegador devolve assim). */
export const heroGlowColorSchema = z.string({ error: "Escolha uma cor válida." }).trim().regex(HEX_COLOR, "Escolha uma cor válida.");

/** #rrggbb valido (minusculo) ou null. */
function hexColor(value: unknown) {
  return typeof value === "string" && HEX_COLOR.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function textSchema(max: number) {
  return z.string({ error: "Texto inválido." }).trim().max(max, `Use no máximo ${max} caracteres.`);
}

export const homeHeroDraftSchema = z
  .object({
    badge: textSchema(HERO_TEXT_LIMITS.badge),
    ctaHref: heroCtaHrefFieldSchema,
    ctaLabel: textSchema(HERO_TEXT_LIMITS.ctaLabel),
    ctaTarget: z.enum(["same_tab", "new_tab"], { error: "Escolha onde o link abre." }),
    description: textSchema(HERO_TEXT_LIMITS.description),
    enabled: z.boolean(),
    glowColor: heroGlowColorSchema.nullable(),
    image: memberAreaImageRefSchema.nullable(),
    mediaType: z.enum(["image", "video"], { error: "Escolha imagem ou vídeo." }),
    poster: memberAreaImageRefSchema.nullable(),
    showBadge: z.boolean(),
    showCta: z.boolean(),
    showDescription: z.boolean(),
    showTitle: z.boolean(),
    title: textSchema(HERO_TEXT_LIMITS.title),
    videoUrl: heroVideoLinkSchema.nullable()
  })
  .superRefine((draft, context) => {
    // Desligado, nada aparece para o aluno: so formato e seguranca dos campos valem.
    if (!draft.enabled) {
      return;
    }

    const issue = (path: string, message: string) => context.addIssue({ code: "custom", message, path: [path] });

    if (draft.mediaType === "image" && !draft.image) {
      issue("image", "Escolha a imagem do destaque ou use a imagem padrão.");
    }

    if (draft.mediaType === "video") {
      if (!draft.videoUrl) {
        issue("videoUrl", "Cole o link do vídeo.");
      }

      if (!draft.poster) {
        issue("poster", "Escolha a capa do vídeo.");
      }
    }

    if (draft.showBadge && !draft.badge) {
      issue("badge", "Escreva o selo ou desligue “Mostrar”.");
    }

    if (draft.showTitle && !draft.title) {
      issue("title", "Escreva o título ou desligue “Mostrar”.");
    }

    if (draft.showDescription && !draft.description) {
      issue("description", "Escreva a descrição ou desligue “Mostrar”.");
    }

    if (draft.showCta && !draft.ctaLabel) {
      issue("ctaLabel", "Escreva o texto do botão.");
    }

    if (draft.showCta && !draft.ctaHref) {
      issue("ctaHref", "Escolha para onde o botão leva.");
    }
  });

export type HomeHeroDraft = z.output<typeof homeHeroDraftSchema>;
export type HomeHeroDraftField = keyof HomeHeroDraft;

export const saveHomeHeroSchema = z.object({
  expectedUpdatedAt: settingVersionSchema,
  hero: homeHeroDraftSchema
});

export type SaveHomeHeroInput = z.input<typeof saveHomeHeroSchema>;

/** Rascunho igual ao destaque de hoje sem configuracao: imagem padrao, textos e botao escondidos. */
export const DEFAULT_HOME_HERO_DRAFT: HomeHeroDraft = Object.freeze({
  badge: "",
  ctaHref: "",
  ctaLabel: "",
  ctaTarget: "same_tab",
  description: "",
  enabled: true,
  glowColor: null,
  image: DEFAULT_HOME_HERO_IMAGE,
  mediaType: "image",
  poster: null,
  showBadge: false,
  showCta: false,
  showDescription: false,
  showTitle: false,
  title: "",
  videoUrl: null
});

/** O que a home desenha quando nao ha nada gravado (= defaultHero do platform-store). */
export const DEFAULT_HOME_HERO_CONFIG: HomeHeroConfig = Object.freeze({
  enabled: true,
  image: DEFAULT_HOME_HERO_IMAGE,
  mediaType: "image",
  purpose: "school-brand",
  visibility: Object.freeze({ badge: false, description: false, title: false })
}) as HomeHeroConfig;

/* ------------------------------------------------------------------------------------------------
 * Validacao para a tela (ao sair do campo e ao publicar)
 * ---------------------------------------------------------------------------------------------- */

export type HomeHeroDraftErrors = Partial<Record<HomeHeroDraftField, string>>;

/** Primeiro erro de cada campo do rascunho; objeto vazio quando esta tudo certo. */
export function validateHomeHeroDraft(draft: HomeHeroDraft): HomeHeroDraftErrors {
  const result = homeHeroDraftSchema.safeParse(draft);

  if (result.success) {
    return {};
  }

  const errors: HomeHeroDraftErrors = {};

  for (const issue of result.error.issues) {
    const field = issue.path[0];

    if (typeof field === "string" && field in DEFAULT_HOME_HERO_DRAFT && !errors[field as HomeHeroDraftField]) {
      errors[field as HomeHeroDraftField] = issue.message;
    }
  }

  return errors;
}

/** fieldErrors da Server Action ("hero.poster") para o campo do rascunho ("poster"). */
export function heroFieldErrorsFrom(fieldErrors: Record<string, string[]> | undefined): HomeHeroDraftErrors {
  const errors: HomeHeroDraftErrors = {};

  for (const [path, messages] of Object.entries(fieldErrors ?? {})) {
    const field = path.startsWith("hero.") ? path.slice("hero.".length).split(".")[0] : null;

    if (field && field in DEFAULT_HOME_HERO_DRAFT && messages[0] && !errors[field as HomeHeroDraftField]) {
      errors[field as HomeHeroDraftField] = messages[0];
    }
  }

  return errors;
}

/* ------------------------------------------------------------------------------------------------
 * Gravado <-> rascunho
 * ---------------------------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function flag(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function looksLikeVideo(value: string) {
  return /\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(value);
}

function mediaTypeOf(raw: Record<string, unknown>, source: string): HomeHeroConfig["mediaType"] {
  if (raw.mediaType === "video") {
    return "video";
  }

  if (raw.mediaType === "image") {
    return "image";
  }

  return looksLikeVideo(source) ? "video" : "image";
}

/**
 * Remove o que nao vale para o modo escolhido antes de gravar: com imagem nao ha link de video nem
 * capa; com video, `image` e o proprio link. "Mostrar" sem texto vira desligado (nao ha o que
 * mostrar) e "Abrir em" volta ao padrao quando o botao nao tem nada.
 */
export function normalizeHeroDraft(draft: HomeHeroDraft): HomeHeroDraft {
  const video = draft.mediaType === "video";
  const hasCta = Boolean(draft.ctaHref || draft.ctaLabel);

  return {
    ...draft,
    ctaTarget: hasCta ? draft.ctaTarget : "same_tab",
    glowColor: hexColor(draft.glowColor),
    image: video ? null : draft.image,
    poster: video ? draft.poster : null,
    showBadge: draft.showBadge && Boolean(draft.badge),
    showCta: draft.showCta && Boolean(draft.ctaLabel) && Boolean(draft.ctaHref),
    showDescription: draft.showDescription && Boolean(draft.description),
    showTitle: draft.showTitle && Boolean(draft.title),
    videoUrl: video ? draft.videoUrl : null
  };
}

/**
 * Rascunho a partir do que esta gravado (inclusive pelo admin antigo). Tolerante: valores estranhos
 * aparecem como estao e a validacao aponta o campo; o que nao e texto vira vazio. Mesma regra de
 * visibilidade da home: "Mostrar" sem escolha gravada = mostrar quando ha texto.
 */
export function heroDraftFromStored(raw: unknown): HomeHeroDraft {
  if (!isRecord(raw)) {
    return { ...DEFAULT_HOME_HERO_DRAFT };
  }

  const source = text(raw.image);
  const mediaType = mediaTypeOf(raw, source);
  const visibility = isRecord(raw.visibility) ? raw.visibility : {};
  const badge = text(raw.badge);
  const title = text(raw.title);
  const description = text(raw.description);
  const cta = isRecord(raw.cta) ? raw.cta : null;
  const ctaHref = cta ? text(cta.href) : "";
  const ctaLabel = cta ? text(cta.label) : "";
  const ctaTarget: HeroCtaTarget =
    cta && (cta.target === "same_tab" || cta.target === "new_tab") ? cta.target : defaultCtaTarget(ctaHref);
  const shown = (key: string, fallback: boolean) => flag(visibility[key]) ?? fallback;

  return {
    badge,
    ctaHref,
    ctaLabel,
    ctaTarget,
    description,
    enabled: raw.enabled !== false,
    glowColor: hexColor(raw.glowColor),
    image: mediaType === "image" && source ? source : null,
    mediaType,
    poster: mediaType === "video" && text(raw.poster) ? text(raw.poster) : null,
    showBadge: shown("badge", Boolean(badge)) && Boolean(badge),
    showCta: shown("cta", Boolean(cta)) && Boolean(ctaLabel) && Boolean(ctaHref),
    showDescription: shown("description", Boolean(description)) && Boolean(description),
    showTitle: shown("title", Boolean(title)) && Boolean(title),
    title,
    videoUrl: mediaType === "video" && source ? source : null
  };
}

/**
 * O que vai para platform_settings.hero: o rascunho (ja validado) sobre o que estava gravado,
 * preservando as chaves que o editor nao conhece (`purpose`, chaves futuras, extras de `visibility`).
 */
export function buildStoredHero(raw: unknown, draft: HomeHeroDraft): HomeHeroConfig {
  const next = normalizeHeroDraft(draft);
  const base: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};
  const baseVisibility = isRecord(base.visibility) ? base.visibility : {};
  const purpose = HERO_PURPOSES.has(base.purpose as HomeHeroConfig["purpose"]) ? base.purpose : "school-brand";
  const stored: Record<string, unknown> = {
    ...base,
    badge: next.badge,
    description: next.description,
    enabled: next.enabled,
    image: next.mediaType === "video" ? (next.videoUrl ?? "") : (next.image ?? ""),
    mediaType: next.mediaType,
    purpose,
    title: next.title,
    visibility: {
      ...baseVisibility,
      badge: next.showBadge,
      cta: next.showCta,
      description: next.showDescription,
      title: next.showTitle
    }
  };

  if (next.mediaType === "video" && next.poster) {
    stored.poster = next.poster;
  } else {
    delete stored.poster;
  }

  if (next.glowColor) {
    stored.glowColor = next.glowColor;
  } else {
    delete stored.glowColor;
  }

  if (next.ctaHref || next.ctaLabel) {
    stored.cta = { href: next.ctaHref, label: next.ctaLabel, target: next.ctaTarget };
  } else {
    delete stored.cta;
  }

  return stored as HomeHeroConfig;
}

/* ------------------------------------------------------------------------------------------------
 * Home do aluno
 * ---------------------------------------------------------------------------------------------- */

/**
 * Imagem ou video que a home consegue desenhar: https/http (o legado aceitava http), caminho do
 * proprio site ou imagem embutida antiga (data:image). Nada de javascript:, //host ou texto solto.
 */
function isDrawableMedia(value: string, kind: "image" | "video") {
  if (!value || /\s/.test(value)) {
    return false;
  }

  if (/^https?:\/\/[^/]/i.test(value)) {
    return true;
  }

  if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) {
    return true;
  }

  return kind === "image" && /^data:image\//i.test(value);
}

/**
 * O destaque que a home desenha a partir do que esta gravado: normaliza tipos, descarta botao com
 * link inseguro ou sem texto e capa de video invalida. Hero do legado (sem botao) sai igual.
 * Lixo (nao objeto) vira o padrao.
 */
export function resolveHomeHero(raw: unknown): HomeHeroConfig {
  if (!isRecord(raw)) {
    return {
      ...DEFAULT_HOME_HERO_CONFIG,
      visibility: { ...DEFAULT_HOME_HERO_CONFIG.visibility }
    };
  }

  const source = text(raw.image);
  const mediaType = mediaTypeOf(raw, source);
  const image = isDrawableMedia(source, mediaType) ? source : "";
  const hero: HomeHeroConfig = {
    image,
    mediaType,
    purpose: HERO_PURPOSES.has(raw.purpose as HomeHeroConfig["purpose"]) ? (raw.purpose as HomeHeroConfig["purpose"]) : "school-brand"
  };

  if (typeof raw.enabled === "boolean") {
    hero.enabled = raw.enabled;
  }

  const glowColor = hexColor(raw.glowColor);

  if (glowColor) {
    hero.glowColor = glowColor;
  }

  for (const key of ["badge", "title", "description"] as const) {
    const value = raw[key];

    if (typeof value === "string") {
      hero[key] = value;
    }
  }

  if (isRecord(raw.visibility)) {
    const visibility: NonNullable<HomeHeroConfig["visibility"]> = {};

    for (const key of ["badge", "cta", "description", "title"] as const) {
      const value = flag(raw.visibility[key]);

      if (value !== undefined) {
        visibility[key] = value;
      }
    }

    hero.visibility = visibility;
  }

  const poster = text(raw.poster);

  if (mediaType === "video" && isDrawableMedia(poster, "image")) {
    hero.poster = poster;
  }

  if (isRecord(raw.cta)) {
    const href = typeof raw.cta.href === "string" ? raw.cta.href.trim() : "";
    const label = text(raw.cta.label).slice(0, 80);

    if (label && isSafeHeroCtaHref(href)) {
      hero.cta = {
        href,
        label,
        target: raw.cta.target === "new_tab" || raw.cta.target === "same_tab" ? raw.cta.target : defaultCtaTarget(href)
      };
    }
  }

  return hero;
}

/** Mesma regra da home (src/app/page.tsx): o destaque aparece ligado e com imagem ou video. */
export function isHeroVisible(hero: Pick<HomeHeroConfig, "enabled" | "image">) {
  return hero.enabled !== false && Boolean(hero.image);
}

/**
 * Destaque da previa: o rascunho como a home vai desenhar depois de publicar. `pending` traz as
 * imagens recem-recortadas que ainda estao subindo (data URL), para a previa mudar na hora.
 */
export function previewHeroFromDraft(
  draft: HomeHeroDraft,
  pending: Partial<Record<"image" | "poster", string>> = {}
): HomeHeroConfig {
  const withPending: HomeHeroDraft = {
    ...draft,
    image: pending.image ?? draft.image,
    poster: pending.poster ?? draft.poster
  };

  return resolveHomeHero(buildStoredHero(undefined, withPending));
}

const HERO_DRAFT_FIELDS = Object.keys(DEFAULT_HOME_HERO_DRAFT) as HomeHeroDraftField[];

export function isHeroDraftEqual(left: HomeHeroDraft, right: HomeHeroDraft) {
  return HERO_DRAFT_FIELDS.every((key) => left[key] === right[key]);
}

/**
 * Chegou uma versao nova do servidor (Recarregar depois de um 409): o que o produtor mudou no rascunho
 * (campo diferente do que estava publicado quando a tela abriu) continua; o resto segue o servidor.
 */
export function rebaseHeroDraft(previousPublished: HomeHeroDraft, draft: HomeHeroDraft, nextPublished: HomeHeroDraft): HomeHeroDraft {
  const result: Record<HomeHeroDraftField, unknown> = { ...nextPublished };

  for (const key of HERO_DRAFT_FIELDS) {
    if (previousPublished[key] !== draft[key]) {
      result[key] = draft[key];
    }
  }

  return result as HomeHeroDraft;
}

/** Textos com a chave "Mostrar" ao lado. */
export const HERO_TEXT_SHOW_FIELDS = [
  ["badge", "showBadge"],
  ["title", "showTitle"],
  ["description", "showDescription"]
] as const satisfies readonly (readonly [HomeHeroDraftField, HomeHeroDraftField])[];

function isCtaComplete(draft: Pick<HomeHeroDraft, "ctaHref" | "ctaLabel">) {
  return Boolean(draft.ctaLabel.trim() && draft.ctaHref.trim());
}

/**
 * "Mostrar" liga sozinho quando o produtor escreve num campo que estava vazio (selo, titulo,
 * descricao) e o botao, quando texto e destino ficam completos. Sem isso, o texto digitado ficava
 * gravado escondido e a previa nao mudava. Desligar de proposito continua valendo: so liga na passagem
 * de vazio para preenchido, e nunca na mesma mudanca em que o produtor mexeu na chave.
 */
export function autoShowFilledFields(previous: HomeHeroDraft, next: HomeHeroDraft): HomeHeroDraft {
  let result = next;

  for (const [field, show] of HERO_TEXT_SHOW_FIELDS) {
    const wasEmpty = !String(previous[field]).trim();
    const nowFilled = Boolean(String(next[field]).trim());

    if (wasEmpty && nowFilled && !next[show] && previous[show] === next[show]) {
      result = { ...result, [show]: true };
    }
  }

  if (!isCtaComplete(previous) && isCtaComplete(next) && !next.showCta && previous.showCta === next.showCta) {
    result = { ...result, showCta: true };
  }

  return result;
}
