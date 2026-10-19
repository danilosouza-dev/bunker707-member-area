// Tags e chaves de cache da Area de membros. Modulo puro (sem "server-only") para os testes provarem
// a escolha da API sem subir o Next. A invalidacao fica em ./cache.ts.
//
// - Login (/login): leitura em unstable_cache com MEMBER_AREA_LOGIN_TAG. O loader tambem leva a tag
//   do catalogo ("catalog"), porque a logo do login vem da Marca e a rota da Marca
//   (PUT /api/admin/appearance) ja invalida o catalogo.
// - Home do aluno (destaque e vitrine) e demais paginas de conteudo: o catalogo publicado e o
//   platform_settings vem do cache com a tag do catalogo (platform-store, desde 19/10/2026); toda
//   gravacao chama invalidateCatalog.

import { CATALOG_TAG } from "../catalog/cache-policy";

export const MEMBER_AREA_LOGIN_TAG = "member-area-login";

/** Chave do unstable_cache do login. Mude o sufixo quando o formato de LoginPageSettings mudar. */
export const LOGIN_PAGE_CACHE_KEY = ["member-area", "login-page", "v1"] as const;

/** Tags do loader do login: a propria e a do catalogo (logo da Marca). */
export const LOGIN_PAGE_CACHE_TAGS = [MEMBER_AREA_LOGIN_TAG, CATALOG_TAG] as const;

/** Rede de seguranca: mesmo sem invalidacao, o login relê a configuracao a cada hora. */
export const LOGIN_PAGE_REVALIDATE_SECONDS = 3_600;

export type MemberAreaCacheTarget = "home" | "login";
export type MemberAreaInvalidationSource = "action" | "route";

export type MemberAreaInvalidationPlan =
  | { api: "catalog"; from: MemberAreaInvalidationSource }
  | { api: "updateTag"; tag: typeof MEMBER_AREA_LOGIN_TAG }
  | { api: "revalidateTag"; profile: "max"; tag: typeof MEMBER_AREA_LOGIN_TAG };

/**
 * - "home" (destaque, vitrine, fileira de modulos, capa de modulo): delega para invalidateCatalog.
 * - "login": updateTag em Server Action (o produtor ve na hora o que gravou); revalidateTag(tag, "max")
 *   fora dela (updateTag lanca erro fora de Server Action no Next 16.4).
 */
export function planMemberAreaInvalidation(
  target: MemberAreaCacheTarget,
  from: MemberAreaInvalidationSource
): MemberAreaInvalidationPlan {
  if (from !== "action" && from !== "route") {
    throw new Error(`Origem de invalidacao desconhecida: ${String(from)}`);
  }

  if (target === "home") {
    return { api: "catalog", from };
  }

  if (target === "login") {
    return from === "action"
      ? { api: "updateTag", tag: MEMBER_AREA_LOGIN_TAG }
      : { api: "revalidateTag", profile: "max", tag: MEMBER_AREA_LOGIN_TAG };
  }

  throw new Error(`Alvo de invalidacao desconhecido: ${String(target)}`);
}
