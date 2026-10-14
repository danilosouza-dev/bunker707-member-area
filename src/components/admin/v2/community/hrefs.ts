// Enderecos da Comunidade no admin novo. Modulo puro (sem React): as paginas do servidor, os filtros
// no cliente e tests/community-queue.test.mjs usam as mesmas funcoes.

import { studentSearchHref as studentListSearchHref } from "../students/hrefs";

export const COMMUNITY_BASE_HREF = "/admin/comunidade";

export const COMMUNITY_TAB_HREFS = {
  aulas: `${COMMUNITY_BASE_HREF}/aulas`,
  comentarios: `${COMMUNITY_BASE_HREF}/comentarios`,
  denuncias: `${COMMUNITY_BASE_HREF}/denuncias`,
  fila: COMMUNITY_BASE_HREF,
  regras: `${COMMUNITY_BASE_HREF}/regras`,
  top: `${COMMUNITY_BASE_HREF}/top`
} as const;

/** Parametros que seguem de uma aba para outra (filtros globais + aula). */
export const COMMUNITY_CARRIED_PARAMS = ["produto", "aula", "periodo"] as const;

export type SearchParamsRecord = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function toSearchParams(source: SearchParamsRecord | URLSearchParams) {
  if (source instanceof URLSearchParams) {
    return new URLSearchParams(source.toString());
  }

  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(source)) {
    const text = firstValue(value);

    if (text) {
      params.set(key, text);
    }
  }

  return params;
}

/**
 * Endereco com os filtros atuais e as trocas pedidas (null/"" apaga). Qualquer troca que nao seja
 * de pagina volta para a pagina 1, para nunca cair numa pagina vazia de outro filtro.
 */
export function communityHref(
  pathname: string,
  current: SearchParamsRecord | URLSearchParams,
  patch: Record<string, string | number | null | undefined>
) {
  const params = toSearchParams(current);
  const keys = Object.keys(patch);

  for (const key of keys) {
    const value = patch[key];

    if (value === null || value === undefined || value === "") {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
  }

  if (keys.some((key) => key !== "pagina")) {
    params.delete("pagina");
  }

  if (params.get("pagina") === "1") {
    params.delete("pagina");
  }

  const query = params.toString();

  return query ? `${pathname}?${query}` : pathname;
}

/** Algum filtro da tela esta ligado (para oferecer "Limpar filtros" no vazio). */
export function hasActiveFilters(current: SearchParamsRecord | URLSearchParams, keys: readonly string[]) {
  const params = toSearchParams(current);

  return keys.some((key) => Boolean(params.get(key)));
}

/** Endereco sem filtros nem pagina, preservando so o periodo global quando existir. */
export function clearFiltersHref(pathname: string, current: SearchParamsRecord | URLSearchParams) {
  const params = toSearchParams(current);
  const period = params.get("periodo");

  return period ? `${pathname}?periodo=${encodeURIComponent(period)}` : pathname;
}

/** "Ver aluno": lista de Alunos filtrada pelo nome. */
export function studentSearchHref(name: string) {
  return studentListSearchHref(name);
}

/** "1–20 de 54" e se ha pagina anterior/proxima. */
export function describePageRange(page: number, pageSize: number, total: number) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), lastPage);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);

  return {
    from,
    hasNext: current < lastPage,
    hasPrevious: current > 1,
    label: total === 0 ? "0 de 0" : `${from}–${to} de ${new Intl.NumberFormat("pt-BR").format(total)}`,
    lastPage,
    page: current,
    to
  };
}

/** Plural simples em pt-BR: "1 reação", "2 reações". */
export function plural(count: number, singular: string, pluralForm: string) {
  return `${new Intl.NumberFormat("pt-BR").format(count)} ${count === 1 ? singular : pluralForm}`;
}

const fullDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo"
});

/** "10/10/2026, 14:32" no fuso da escola (title das datas relativas). */
export function formatFullDate(iso: string) {
  const date = new Date(iso);

  return Number.isFinite(date.getTime()) ? fullDateFormatter.format(date) : "";
}
