import type { LessonVideoConfig, LessonVideoProvider } from "@/lib/platform-types";

const videoProviders = new Set<LessonVideoProvider>([
  "bunny",
  "custom_url",
  "embed_code",
  "mux",
  "vimeo",
  "youtube"
]);

function decodeUrlAttribute(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#38;", "&")
    .replaceAll("&#x26;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

export function getSafeExternalMediaUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 4_096) {
    return null;
  }

  try {
    const url = new URL(decodeUrlAttribute(value.trim()));

    if (url.protocol !== "https:" || url.username || url.password) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function getSafeEmbedUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 16_384) {
    return null;
  }

  const trimmedValue = value.trim();
  const directUrl = getSafeExternalMediaUrl(trimmedValue);

  if (directUrl) {
    return directUrl;
  }

  const iframeTag = trimmedValue.match(/<iframe\b[^>]*>/i)?.[0];

  if (!iframeTag) {
    return null;
  }

  const sourceMatch = iframeTag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const source = sourceMatch?.[1] ?? sourceMatch?.[2] ?? sourceMatch?.[3];

  return getSafeExternalMediaUrl(source);
}

export function normalizeLessonVideoConfig(value: unknown): LessonVideoConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = value as Partial<Record<keyof LessonVideoConfig, unknown>>;

  if (typeof input.provider !== "string" || !videoProviders.has(input.provider as LessonVideoProvider)) {
    return null;
  }

  const provider = input.provider as LessonVideoProvider;
  const assetId = typeof input.assetId === "string" && input.assetId.trim().length <= 512
    ? input.assetId.trim()
    : undefined;
  const regularUrl = getSafeExternalMediaUrl(input.url) ?? undefined;

  if (provider === "embed_code") {
    const embedUrl = getSafeEmbedUrl(input.embedCode) ?? regularUrl;

    return embedUrl ? { provider, url: embedUrl } : null;
  }

  if (provider === "custom_url" && !regularUrl) {
    return null;
  }

  if (!assetId && !regularUrl) {
    return null;
  }

  return {
    ...(assetId ? { assetId } : {}),
    provider,
    ...(regularUrl ? { url: regularUrl } : {})
  };
}
