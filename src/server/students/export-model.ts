// Exportacao CSV da lista de alunos (docs/17 §1.7.4). Modulo puro: monta cabecalho e linhas a partir
// dos itens ja calculados; o Server Action so chama toCsv. Colunas exatamente as da especificacao,
// sem documento nem endereco (nao existem no modelo novo) e sem a equipe.

import type { CsvCell } from "../../lib/csv";
import { STUDENT_PACE_LABELS, type StudentListItem } from "./model";

export type StudentExportRow = StudentListItem & {
  /** Comentarios aprovados nos ultimos 28 dias. */
  comments28d: number;
  phone: string | null;
  /** "Produto: 3 de 12 aulas" por produto com acesso. */
  progressByProduct: string[];
};

export const STUDENT_EXPORT_HEADERS = [
  "Nome",
  "E-mail",
  "Telefone",
  "Produtos",
  "Turmas",
  "Ritmo",
  "Entrou em",
  "Último estudo",
  "Progresso por produto",
  "Aulas concluídas",
  "Aulas publicadas",
  "Comentários (28 dias)"
] as const;

function shortDate(iso: string | null) {
  if (!iso) {
    return "";
  }

  const date = new Date(iso);

  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo", year: "numeric" }).format(date);
}

export function studentExportRowToCells(row: StudentExportRow): CsvCell[] {
  return [
    row.fullName,
    row.email,
    row.phone ?? "",
    row.products.map((product) => product.title).join(" | "),
    row.cohorts.map((membership) => `${membership.cohortName} (${row.products.find((product) => product.id === membership.productId)?.title ?? membership.productId})`).join(" | "),
    STUDENT_PACE_LABELS[row.pace],
    shortDate(row.createdAt),
    shortDate(row.lastStudiedAt),
    row.progressByProduct.join(" | "),
    row.completedLessons,
    row.totalLessons,
    row.comments28d
  ];
}
