// "Oculto por enquanto" na area do aluno (docs/17 §1.3 e §1.6.2). Regras puras usadas pelo
// platform-store ao montar a home, Minhas compras e a pagina do produto; testadas em
// tests/storefront-hidden-listing.test.mjs sem banco.
//
// - Vitrine (Produtos a venda, Em breve, secoes padrao): so produtos listados.
// - Secoes escolhidas a mao, estruturas e modal: oculto aparece so para quem tem acesso.
// - Minhas compras: tudo o que o aluno tem acesso, oculto ou nao.
// - Pagina do produto: oculto sem acesso responde como inexistente.

import { canSeeProduct, isListedInStorefront } from "./model";

type ListableItem = { listing?: string | null };

/** Vitrine aberta a todos: remove os ocultos. */
export function onlyListedItems<T extends ListableItem>(items: readonly T[]): T[] {
  return items.filter((item) => isListedInStorefront(item));
}

/** Listas com curadoria (secao manual, estrutura, cursos da formacao no modal): oculto so com acesso. */
export function itemsVisibleTo<T extends ListableItem>(items: readonly T[], hasAccess: (item: T) => boolean): T[] {
  return items.filter((item) => canSeeProduct(item, hasAccess(item)));
}

/** "Disponível para comprar": sem acesso e listado (oculto nunca e oferecido). */
export function itemsAvailableForSale<T extends ListableItem>(items: readonly T[], hasAccess: (item: T) => boolean): T[] {
  return items.filter((item) => !hasAccess(item) && isListedInStorefront(item));
}

/** Minhas compras: com acesso, inclusive os ocultos. */
export function purchasedItems<T extends ListableItem>(items: readonly T[], hasAccess: (item: T) => boolean): T[] {
  return items.filter((item) => hasAccess(item));
}

/** Pagina do produto (/conteudo/[id]): false = responder como inexistente. */
export function canOpenProductPage(item: ListableItem, hasAccess: boolean) {
  return canSeeProduct(item, hasAccess);
}
