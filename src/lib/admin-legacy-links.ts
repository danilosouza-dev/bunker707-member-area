// Links do admin novo para telas que ainda so existem no admin antigo (/admin/legado).
// O admin antigo nao tem endereco por tela; ?tela=alunos&busca=Nome abre a lista de alunos com a busca
// preenchida. Enquanto Alunos v2 nao existir, "Ver aluno" (Comunidade) leva para la.
// Modulo puro: tests/admin-legacy-links.test.mjs carrega direto pelo Node.

import type { AdminView } from "./platform-types";

export const LEGACY_ADMIN_HREF = "/admin/legado";
const MAX_SEARCH_LENGTH = 120;

/** Lista de alunos do admin antigo filtrada pelo nome (ou e-mail). */
export function legacyStudentSearchHref(name: string) {
  const search = name.trim().slice(0, MAX_SEARCH_LENGTH);

  if (!search) {
    return `${LEGACY_ADMIN_HREF}?tela=alunos`;
  }

  return `${LEGACY_ADMIN_HREF}?${new URLSearchParams({ tela: "alunos", busca: search }).toString()}`;
}

type SearchParamValue = string | string[] | undefined;

function firstValue(value: SearchParamValue) {
  return Array.isArray(value) ? value[0] : value;
}

/** ?tela= e ?busca= do admin antigo -> tela inicial e busca de alunos. Valor desconhecido = tela padrao. */
export function readLegacyAdminParams(params: Record<string, SearchParamValue> | undefined): {
  initialStudentQuery?: string;
  initialView?: AdminView;
} {
  if (firstValue(params?.tela) !== "alunos") {
    return {};
  }

  const search = firstValue(params?.busca)?.trim().slice(0, MAX_SEARCH_LENGTH);

  return search ? { initialStudentQuery: search, initialView: "students" } : { initialView: "students" };
}
