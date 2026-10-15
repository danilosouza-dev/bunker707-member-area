import "server-only";

import { redirect } from "next/navigation";
import { canSeeAdminArea } from "@/components/admin/v2/nav";
import type { AdminAccess } from "@/server/auth/roles";
import type { CommunityFilterOptions, CommunityLessonPath } from "./types";

// Comunidade de quem tem acesso so a alguns cursos (Professor, docs/17 §2.3): um curso dele por vez,
// sempre no endereco (?produto=), para o filtro e a lista mostrarem a mesma coisa. As acoes (responder,
// moderar) conferem o curso de cada comentario no servidor (requireScope).

type SearchParams = Record<string, string | string[] | undefined>;

/** Produto que nao existe: professor ainda sem curso ve as listas vazias. */
const NO_COURSE = "sem-curso";

/**
 * Sem ?produto= ou com um curso de fora: volta para o mesmo endereco com o primeiro curso da pessoa
 * (sem ?aula=, que podia ser de outro curso). Devolve os parametros que a pagina deve ler.
 */
export function scopeCommunityParams(access: AdminAccess, pathname: string, params: SearchParams): SearchParams {
  const allowed = access.productIds;

  if (allowed === null) {
    return params;
  }

  const current = typeof params.produto === "string" ? params.produto : null;

  if (current && allowed.includes(current)) {
    return params;
  }

  if (allowed.length === 0) {
    return { ...params, aula: undefined, produto: NO_COURSE };
  }

  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (key === "produto" || key === "aula" || value === undefined) {
      continue;
    }

    for (const item of Array.isArray(value) ? value : [value]) {
      search.append(key, item);
    }
  }

  search.set("produto", allowed[0]);
  redirect(`${pathname}?${search.toString()}`);
}

/** Opcoes dos filtros Produto e Aula: so os cursos (e as aulas) da pessoa. */
export function scopeCommunityFilterOptions(access: AdminAccess, options: CommunityFilterOptions): CommunityFilterOptions {
  const allowed = access.productIds;

  if (allowed === null) {
    return options;
  }

  return {
    lessons: options.lessons.filter((lesson) => allowed.includes(lesson.productId)),
    products: options.products.filter((product) => allowed.includes(product.id))
  };
}

/** Sem a area Produtos (ex.: Suporte), o link "Abrir aula no admin" some: a pagina do produto nao abre para a pessoa. */
export function lessonPathFor(access: AdminAccess, path: CommunityLessonPath): CommunityLessonPath {
  return canSeeAdminArea(access, "produtos") ? path : { ...path, adminHref: null };
}

/** Filtros que contam como "lista filtrada" (o curso fixo do professor nao conta). */
export function communityFilterKeys(access: AdminAccess, keys: readonly string[]) {
  return access.productIds === null ? [...keys] : keys.filter((key) => key !== "produto");
}
