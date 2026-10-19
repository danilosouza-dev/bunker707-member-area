// Politica de cache do catalogo (docs/17 §2.3, "Cache do catalogo e a flag global"). Modulo puro para
// que tests/catalog-cache-policy.test.mjs prove a escolha da API sem subir o Next.

/** Tag unica do catalogo publicado (itens, modulos, aulas, settings de pagina, vitrine). */
export const CATALOG_TAG = "catalog";

/** Chave do unstable_cache. Mude o sufixo quando o formato de CatalogSnapshot mudar. */
export const CATALOG_CACHE_KEY = ["catalog-snapshot", "v1"] as const;

/**
 * De onde vem a invalidacao:
 * - "action": Server Action -> updateTag (o produtor le o que acabou de gravar, sem conteudo velho);
 * - "route": rota REST legada, job ou webhook -> revalidateTag(tag, "max") (stale-while-revalidate;
 *   updateTag lanca erro fora de Server Action no Next 16.4).
 */
export type CatalogInvalidationSource = "action" | "route";

export type CatalogInvalidationPlan =
  | { api: "updateTag"; tag: typeof CATALOG_TAG }
  | { api: "revalidateTag"; profile: "max"; tag: typeof CATALOG_TAG };

export function planCatalogInvalidation(source: CatalogInvalidationSource): CatalogInvalidationPlan {
  if (source === "action") {
    return { api: "updateTag", tag: CATALOG_TAG };
  }

  if (source === "route") {
    return { api: "revalidateTag", profile: "max", tag: CATALOG_TAG };
  }

  throw new Error(`Origem de invalidacao do catalogo desconhecida: ${String(source)}`);
}

/**
 * Leitura da area do aluno (platform-store): catalogo publicado e platform_settings, iguais para todos os
 * alunos, em unstable_cache com CATALOG_TAG. Mude o sufixo quando o formato das linhas mudar.
 */
export const MEMBER_CATALOG_CACHE_KEY = ["member-area", "published-rows", "v1"] as const;

/**
 * Rede de seguranca do cache da area do aluno: toda gravacao de catalogo, Vitrine, Destaque ou Marca ja
 * invalida pela tag; se alguma escapar, o aluno ve a mudanca em ate 60 s.
 */
export const MEMBER_CATALOG_REVALIDATE_SECONDS = 60;
