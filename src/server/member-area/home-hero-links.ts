// Links do botao do destaque da home (Area de membros > Destaque). Modulo puro e sem dependencias:
// a home do aluno (HeroSection) confere o link na hora de desenhar com estas funcoes, e o editor e a
// Server Action validam com o mesmo criterio (home-hero-model.ts). O que o admin antigo ou um SQL
// manual gravar tambem passa por aqui antes de virar <a href>.
//
// Aceito: caminho interno da area ("/", "/minhas-compras", "/conteudo/{id}"...) ou link https.
// Recusado: "//host" e "/\host" (viram outro site), "/api/..." (nao e pagina), javascript:, http:,
// mailto: e qualquer texto com espaco.

export type HeroCtaTarget = "same_tab" | "new_tab";

/** Teto do caminho interno; link https segue o teto geral de 2.048 caracteres. */
export const HERO_CTA_INTERNAL_MAX = 512;
export const HERO_CTA_EXTERNAL_MAX = 2_048;

/** Paginas da area do aluno oferecidas em "Página da área". */
export const HOME_PAGE_LINKS = [
  { href: "/", label: "Início" },
  { href: "/minhas-compras", label: "Minhas compras" },
  { href: "/favoritos", label: "Favoritos" }
] as const;

const INTERNAL_PATH = /^\/(?![/\\])[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]*$/;
const API_PATH = /^\/api(?:[/?#]|$)/i;
const PRODUCT_PATH = /^\/conteudo\/([A-Za-z0-9_-]{1,240})\/?$/;

/** Endereco de um produto na area do aluno. */
export function productHref(productId: string) {
  return `/conteudo/${productId}`;
}

/** Id do produto quando o link e exatamente a pagina de um produto; senao null. */
export function productIdFromHref(href: string) {
  return PRODUCT_PATH.exec(href.trim())?.[1] ?? null;
}

export function isInternalHeroPath(value: string) {
  return (
    value.length <= HERO_CTA_INTERNAL_MAX &&
    INTERNAL_PATH.test(value) &&
    !API_PATH.test(value)
  );
}

export function isExternalHeroLink(value: string) {
  if (value.length > HERO_CTA_EXTERNAL_MAX || /\s/.test(value)) {
    return false;
  }

  try {
    const url = new URL(value);

    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Link que pode virar o botao do destaque (sem aparar: o que foi gravado tem que valer como esta). */
export function isSafeHeroCtaHref(value: unknown): value is string {
  if (typeof value !== "string" || !value || /\s/.test(value)) {
    return false;
  }

  return value.startsWith("/") ? isInternalHeroPath(value) : isExternalHeroLink(value);
}

/**
 * Motivo, no vocabulario do produtor, para um link nao servir de destino do botao; null quando serve.
 * Vazio tambem e problema aqui: quem aceita vazio (botao desligado) confere antes.
 */
export function describeHeroCtaHrefProblem(raw: string): string | null {
  const value = raw.trim();

  if (!value) {
    return "Escolha para onde o botão leva.";
  }

  if (/\s/.test(value)) {
    return "O link não pode ter espaços.";
  }

  if (value.startsWith("/")) {
    if (value.startsWith("//") || value.startsWith("/\\")) {
      return "Use um endereço da área (começando com /) ou um link que comece com https://.";
    }

    if (value.length > HERO_CTA_INTERNAL_MAX) {
      return "Endereço longo demais.";
    }

    if (API_PATH.test(value)) {
      return "Esse endereço não é uma página da área do aluno.";
    }

    return INTERNAL_PATH.test(value) ? null : "Esse endereço tem caracteres que não valem num link.";
  }

  if (value.length > HERO_CTA_EXTERNAL_MAX) {
    return "Link longo demais.";
  }

  return isExternalHeroLink(value) ? null : "Use um link que comece com https://.";
}

/** Padrao de "Abrir em": pagina da area na mesma aba, site de fora em nova aba. */
export function defaultCtaTarget(href: string): HeroCtaTarget {
  return href.trim().startsWith("/") || !href.trim() ? "same_tab" : "new_tab";
}

export type HeroCtaDestinationMode = "product" | "page" | "external";

export type HeroCtaDestination =
  | { mode: "product"; productId: string | null }
  | { mode: "page"; href: string }
  | { mode: "external"; href: string };

/**
 * "Para onde leva" deduzido do endereco gravado, para reabrir o editor no modo certo:
 * /conteudo/{id} -> Um produto; caminho interno -> Página da área; o resto -> Link externo.
 * Vazio abre em "Um produto" (o uso mais comum do botao).
 */
export function describeCtaDestination(href: string): HeroCtaDestination {
  const value = href.trim();

  if (!value) {
    return { mode: "product", productId: null };
  }

  const productId = productIdFromHref(value);

  if (productId) {
    return { mode: "product", productId };
  }

  if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) {
    return { href: value, mode: "page" };
  }

  return { href: value, mode: "external" };
}

/** Nome da pagina da area (ou o proprio caminho, quando nao e uma das paginas conhecidas). */
export function homePageLabel(href: string) {
  return HOME_PAGE_LINKS.find((page) => page.href === href)?.label ?? href;
}
