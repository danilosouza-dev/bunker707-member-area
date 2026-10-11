// Filtros globais do admin (docs/17 §1.4): periodo e produto vivem no endereco da pagina.
// Modulo sem "use client" para que paginas do servidor leiam os mesmos parametros.

// O periodo (?periodo=hoje|1d|3d|7d|30d ou intervalo do calendario) e lido e montado so por
// period.ts; aqui ficam o nome do parametro e o filtro Produto.

export const ADMIN_PERIOD_PARAM = "periodo";
export const ADMIN_PRODUCT_PARAM = "produto";
/** Opcao do filtro Produto da barra superior. `accent`: cor do produto (hex), para o ponto ao lado do nome. */
export type AdminFilterProduct = { accent?: string | null; id: string; label: string };

type SearchParamValue = string | string[] | null | undefined;

function firstValue(value: SearchParamValue) {
  return Array.isArray(value) ? value[0] : value;
}

/** Aceita apenas identificadores simples; qualquer outra coisa vira "todos os produtos". */
export function parseAdminProduct(value: SearchParamValue) {
  const candidate = firstValue(value)?.trim() ?? "";

  return /^[A-Za-z0-9_-]{1,80}$/.test(candidate) ? candidate : null;
}

/**
 * Endereco da mesma tela com outro produto no filtro (null = todos), mantendo os demais parametros.
 * Trocar o produto volta para a primeira pagina (?pagina= sai), como os outros filtros.
 */
export function buildAdminProductFilterHref(pathname: string, current: { toString(): string } | string, productId: string | null) {
  const params = new URLSearchParams(current.toString());
  const id = parseAdminProduct(productId);

  params.delete("pagina");

  if (id) {
    params.set(ADMIN_PRODUCT_PARAM, id);
  } else {
    params.delete(ADMIN_PRODUCT_PARAM);
  }

  const query = params.toString();

  return query ? `${pathname}?${query}` : pathname;
}
