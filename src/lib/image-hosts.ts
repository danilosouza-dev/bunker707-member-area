import type { NextConfig } from "next";

/**
 * Fonte única das origens remotas aceitas pelo otimizador do next/image
 * (AVIF/WebP redimensionado): Storage público do Supabase e thumbnails do
 * YouTube. next.config.ts publica `imageRemotePatterns` em `images.remotePatterns`
 * e os componentes consultam `canOptimizeImageSrc` no render, marcando qualquer
 * outra origem como `unoptimized`, porque o otimizador responderia 400 e a
 * imagem sumiria.
 *
 * next.config.ts importa este módulo por caminho relativo: mantenha-o sem
 * aliases (@/) e sem dependências de browser.
 */

export type ImageRemotePattern = Exclude<
  NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]>[number],
  URL
>;

const SUPABASE_STORAGE_PUBLIC_PATH = "/storage/v1/object/public/";
const YOUTUBE_THUMBNAIL_HOST = "i.ytimg.com";

function getConfiguredSupabaseUrl() {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");

    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function getSupabaseStorageImagePattern(): ImageRemotePattern {
  const pathname = `${SUPABASE_STORAGE_PUBLIC_PATH}**`;
  const configuredUrl = getConfiguredSupabaseUrl();

  if (configuredUrl) {
    return {
      hostname: configuredUrl.hostname,
      pathname,
      port: configuredUrl.port,
      protocol: "https",
      search: ""
    };
  }

  // Sem URL válida no ambiente: aceita qualquer projeto hospedado no Supabase.
  return { hostname: "**.supabase.co", pathname, port: "", protocol: "https", search: "" };
}

export const imageRemotePatterns: ImageRemotePattern[] = [
  getSupabaseStorageImagePattern(),
  { hostname: YOUTUBE_THUMBNAIL_HOST, pathname: "/**", port: "", protocol: "https", search: "" }
];

// Subconjunto da sintaxe de remotePatterns usado aqui: `**` aceita qualquer
// sequência (vários subdomínios ou segmentos) e `*` um único rótulo/segmento.
function globToRegExp(glob: string, separator: "." | "/") {
  const escapeRegExp = (part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const singleSegment = separator === "." ? "[^.]*" : "[^/]*";
  const source = glob
    .split("**")
    .map((chunk) => chunk.split("*").map(escapeRegExp).join(singleSegment))
    .join(".*");

  return new RegExp(`^${source}$`);
}

const compiledRemotePatterns = imageRemotePatterns.map((pattern) => ({
  hostnameRe: globToRegExp(pattern.hostname, "."),
  pathnameRe: globToRegExp(pattern.pathname ?? "**", "/"),
  pattern
}));

function matchesRemotePattern(url: URL, entry: (typeof compiledRemotePatterns)[number]) {
  const { hostnameRe, pathnameRe, pattern } = entry;

  if (pattern.protocol !== undefined && `${pattern.protocol}:` !== url.protocol) {
    return false;
  }

  if (pattern.port !== undefined && pattern.port !== url.port) {
    return false;
  }

  if (pattern.search !== undefined && pattern.search !== url.search) {
    return false;
  }

  return hostnameRe.test(url.hostname) && pathnameRe.test(url.pathname);
}

function isSvgPath(pathname: string) {
  return pathname.toLowerCase().endsWith(".svg");
}

export function canOptimizeImageSrc(src: string | null | undefined) {
  const value = src?.trim();

  if (!value) {
    return false;
  }

  // Arquivos de /public. Query string exigiria images.localPatterns no Next 16.
  if (value.startsWith("/") && !value.startsWith("//")) {
    return !/[?#]/.test(value) && !isSvgPath(value);
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  // SVG nunca passa pelo otimizador (dangerouslyAllowSVG desligado); hash não
  // chega ao servidor e esconderia a origem real.
  if (url.hash || isSvgPath(url.pathname)) {
    return false;
  }

  return compiledRemotePatterns.some((entry) => matchesRemotePattern(url, entry));
}
