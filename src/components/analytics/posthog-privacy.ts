// Saneamento dos eventos do PostHog antes do envio (`before_send`).
//
// Modulo puro (so imports de tipo, que o Node remove) para que
// tests/deployment-security.test.mjs possa importa-lo direto pelo Node.
import type { CaptureResult, Properties } from "posthog-js";

// Unicos parametros de URL que seguem para o PostHog; o resto (codigos de login, next=, filtros) e descartado.
const allowedQueryParams = new Set(["utm_source", "utm_medium", "utm_campaign"]);

// Chaves de link dentro de `$elements_chain`, a lista de elementos serializada pelo SDK:
// a.classe:attr__href="/x?code=1"href="/x?code=1"nth-child="1"... (aspas internas escapadas com \").
const elementsChainHrefPattern = /\b(attr__href|href)="((?:[^"\\]|\\.)*)"/g;

/**
 * Remove usuario, senha, fragmento e query (menos UTMs) de uma URL. Links que nao sao
 * http(s), como mailto: e tel:, ficam so com o esquema. URLs relativas perdem query e fragmento.
 */
export function sanitizeUrl(value: string) {
  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return url.protocol;
    }

    const keptParams = new URLSearchParams();

    url.searchParams.forEach((paramValue, paramName) => {
      if (allowedQueryParams.has(paramName)) {
        keptParams.append(paramName, paramValue);
      }
    });

    url.username = "";
    url.password = "";
    url.search = keptParams.toString();
    url.hash = "";

    return url.toString();
  } catch {
    return value.split(/[?#]/)[0];
  }
}

function sanitizeUrlProperties(properties: Properties | undefined) {
  if (!properties) {
    return;
  }

  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === "string" && /^https?:\/\//i.test(value)) {
      properties[key] = sanitizeUrl(value);
    }
  }
}

function sanitizeElements(elements: unknown) {
  if (!Array.isArray(elements)) {
    return;
  }

  for (const element of elements) {
    if (element && typeof element === "object" && typeof element.attr__href === "string") {
      element.attr__href = sanitizeUrl(element.attr__href);
    }
  }
}

function sanitizeElementsChain(chain: unknown) {
  if (typeof chain !== "string") {
    return chain;
  }

  return chain.replace(elementsChainHrefPattern, (_match, key: string, escapedValue: string) => {
    const sanitized = sanitizeUrl(escapedValue.replace(/\\"/g, '"'));

    return `${key}="${sanitized.replace(/"/g, '\\"')}"`;
  });
}

// Heatmaps agrupam os pontos pela URL da pagina, com query e fragmento.
function sanitizeHeatmapData(heatmapData: unknown) {
  if (!heatmapData || typeof heatmapData !== "object" || Array.isArray(heatmapData)) {
    return heatmapData;
  }

  const sanitized: Record<string, unknown[]> = {};

  for (const [url, points] of Object.entries(heatmapData)) {
    const key = sanitizeUrl(url);
    sanitized[key] = [...(sanitized[key] ?? []), ...(Array.isArray(points) ? points : [])];
  }

  return sanitized;
}

// $current_url, $referrer e $initial_* chegam com query e fragmento: convites do Supabase podem trazer
// #access_token=... e o callback traz ?code=...; nada disso pode ir para analytics. O autocapture
// tambem leva o href do link clicado em $elements e $elements_chain.
export function stripSensitiveUrlData(event: CaptureResult | null) {
  if (event) {
    sanitizeUrlProperties(event.properties);
    sanitizeUrlProperties(event.$set);
    sanitizeUrlProperties(event.$set_once);

    if (event.properties) {
      sanitizeElements(event.properties.$elements);

      if ("$elements_chain" in event.properties) {
        event.properties.$elements_chain = sanitizeElementsChain(event.properties.$elements_chain);
      }

      if ("$heatmap_data" in event.properties) {
        event.properties.$heatmap_data = sanitizeHeatmapData(event.properties.$heatmap_data);
      }
    }
  }

  return event;
}
