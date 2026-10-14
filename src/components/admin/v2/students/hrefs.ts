// Enderecos da area de Alunos do admin (docs/17 §1.7). Modulo puro (so tipos importados): os testes
// carregam direto pelo Node e os outros modulos do admin (busca, Comunidade, Hoje, Produtos) montam
// links para ca sem conhecer os parametros.
//
//   /admin/alunos                 lista (?busca=, ?produto=, ?ritmo=, ?pagina=)
//   /admin/alunos/novo            adicionar aluno (?produto= ja marca o produto a liberar)
//   /admin/alunos/<id>            perfil do aluno (?aba=acessos|progresso|historico)

import type { StudentPace } from "@/server/students/model";

export const STUDENT_LIST_PATH = "/admin/alunos";
export const NEW_STUDENT_PATH = "/admin/alunos/novo";
export const STUDENT_SEARCH_MAX_LENGTH = 120;

export type StudentListFilters = {
  page?: number;
  pace?: StudentPace;
  productId?: string;
  q?: string;
};

export type StudentProfileTab = "acessos" | "progresso" | "historico";

/**
 * Endereco da lista com os filtros atuais trocados por `patch`. Mudar filtro volta para a pagina 1;
 * so `patch.page` muda a pagina. Valores vazios saem do endereco.
 */
export function studentListHref(current: StudentListFilters = {}, patch: Partial<StudentListFilters> = {}) {
  const changesFilter = "pace" in patch || "productId" in patch || "q" in patch;
  const next: StudentListFilters = { ...current, ...patch };
  const page = "page" in patch ? patch.page : changesFilter ? undefined : current.page;
  const params = new URLSearchParams();
  const q = next.q?.trim().slice(0, STUDENT_SEARCH_MAX_LENGTH);

  if (next.productId) {
    params.set("produto", next.productId);
  }

  if (next.pace) {
    params.set("ritmo", next.pace);
  }

  if (q) {
    params.set("busca", q);
  }

  if (page && page > 1) {
    params.set("pagina", String(page));
  }

  const query = params.toString();

  return query ? `${STUDENT_LIST_PATH}?${query}` : STUDENT_LIST_PATH;
}

/** Lista de alunos filtrada por nome ou e-mail ("Ver aluno" na Comunidade, busca global). */
export function studentSearchHref(query: string) {
  return studentListHref({}, { q: query });
}

export function studentHref(userId: string, tab?: StudentProfileTab) {
  const base = `${STUDENT_LIST_PATH}/${encodeURIComponent(userId)}`;

  return tab && tab !== "acessos" ? `${base}?aba=${tab}` : base;
}

/** Adicionar aluno; com `productId`, o produto ja vem marcado em "Produtos a liberar". */
export function newStudentHref(productId?: string | null) {
  return productId ? `${NEW_STUDENT_PATH}?produto=${encodeURIComponent(productId)}` : NEW_STUDENT_PATH;
}

export function hasActiveStudentFilters(filters: StudentListFilters) {
  return Boolean(filters.pace || filters.productId || filters.q?.trim());
}
