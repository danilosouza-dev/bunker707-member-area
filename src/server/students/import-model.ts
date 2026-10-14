// Importacao de alunos por CSV (docs/17 §1.7.2): regras puras que rodam no navegador (prévia) e cujos
// resultados o servidor revalida com importRowSchema. Deteccao de colunas pelo cabecalho, mapeamento
// de cada linha, resolucao de produtos por titulo (ambiguo = erro da linha) e o modelo para baixar.

import { toCsv } from "../../lib/csv";
import { IMPORT_MAX_ROWS } from "./model";
import { importRowSchema, type ImportRowInput } from "./schemas";

export const IMPORT_FIELDS = ["fullName", "email", "phone", "products", "cohort"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  cohort: "Turma",
  email: "E-mail",
  fullName: "Nome",
  phone: "Telefone",
  products: "Produtos"
};

export const IMPORT_REQUIRED_FIELDS: readonly ImportField[] = ["fullName", "email"];

/** Nomes de cabecalho reconhecidos (sem acento, minusculos). */
const HEADER_ALIASES: Record<ImportField, readonly string[]> = {
  cohort: ["turma", "classe", "cohort"],
  email: ["email", "e-mail", "mail"],
  fullName: ["nome", "nome completo", "aluno", "name", "full name"],
  phone: ["telefone", "celular", "whatsapp", "fone", "phone"],
  products: ["produto", "produtos", "curso", "cursos", "acesso", "acessos", "product", "products"]
};

export type ImportMapping = Partial<Record<ImportField, number>>;

function normalizeHeader(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Primeiro palpite do mapeamento: cada campo ganha a coluna cujo cabecalho casa com um apelido. */
export function detectImportMapping(headers: readonly string[]): ImportMapping {
  const mapping: ImportMapping = {};
  const normalized = headers.map(normalizeHeader);

  for (const field of IMPORT_FIELDS) {
    const index = normalized.findIndex((header) => HEADER_ALIASES[field].includes(header));

    if (index >= 0 && !Object.values(mapping).includes(index)) {
      mapping[field] = index;
    }
  }

  return mapping;
}

export function missingRequiredFields(mapping: ImportMapping) {
  return IMPORT_REQUIRED_FIELDS.filter((field) => mapping[field] === undefined);
}

export type ImportProductOption = { id: string; title: string };
export type ImportCohortOption = { id: string; name: string };

export type ImportPreviewRow =
  | { index: number; ok: true; row: ImportRowInput; summary: { email: string; fullName: string; productTitles: string[]; cohortName: string | null } }
  | { index: number; ok: false; errors: string[]; raw: { email: string; fullName: string } };

function cell(cells: readonly string[], index: number | undefined) {
  return index === undefined ? "" : (cells[index] ?? "").trim();
}

function normalizeTitle(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Produtos de uma celula ("Prompts do Zero | Formação Agentes" ou ids), separados por | ; ou ,.
 * Titulo que casa com mais de um produto e erro (nunca escolha silenciosa); desconhecido e erro.
 */
export function resolveProductsCell(value: string, products: readonly ImportProductOption[]) {
  const ids: string[] = [];
  const titles: string[] = [];
  const errors: string[] = [];
  const parts = value.split(/[|;,]/).map((part) => part.trim()).filter(Boolean);

  for (const part of parts) {
    const byId = products.find((product) => product.id === part);

    if (byId) {
      if (!ids.includes(byId.id)) {
        ids.push(byId.id);
        titles.push(byId.title);
      }

      continue;
    }

    const wanted = normalizeTitle(part);
    const matches = products.filter((product) => normalizeTitle(product.title) === wanted);

    if (matches.length === 1) {
      if (!ids.includes(matches[0].id)) {
        ids.push(matches[0].id);
        titles.push(matches[0].title);
      }
    } else if (matches.length > 1) {
      errors.push(`“${part}” corresponde a mais de um produto: use o id`);
    } else {
      errors.push(`produto “${part}” não encontrado`);
    }
  }

  return { errors, ids, titles };
}

/** Transforma as linhas do arquivo em entradas validadas (ou erros por linha) para a prévia. */
export function buildImportPreview(input: {
  cohorts: readonly ImportCohortOption[];
  mapping: ImportMapping;
  products: readonly ImportProductOption[];
  rows: readonly (readonly string[])[];
}): ImportPreviewRow[] {
  const seenEmails = new Map<string, number>();
  const cohortByName = new Map(input.cohorts.map((cohort) => [normalizeTitle(cohort.name), cohort] as const));

  return input.rows.slice(0, IMPORT_MAX_ROWS).map((cells, offset): ImportPreviewRow => {
    const index = offset + 1;
    const fullName = cell(cells, input.mapping.fullName);
    const email = cell(cells, input.mapping.email).toLowerCase();
    const phone = cell(cells, input.mapping.phone);
    const productsCell = cell(cells, input.mapping.products);
    const cohortCell = cell(cells, input.mapping.cohort);
    const errors: string[] = [];
    const resolved = resolveProductsCell(productsCell, input.products);
    errors.push(...resolved.errors);

    let cohortId: string | null = null;

    if (cohortCell) {
      const cohort = cohortByName.get(normalizeTitle(cohortCell));

      if (cohort) {
        cohortId = cohort.id;
      } else {
        errors.push(`turma “${cohortCell}” não existe: crie antes de importar`);
      }
    }

    const duplicateOf = seenEmails.get(email);

    if (email && duplicateOf !== undefined) {
      errors.push(`e-mail repetido na linha ${duplicateOf}`);
    } else if (email) {
      seenEmails.set(email, index);
    }

    const parsed = importRowSchema.safeParse({ cohortId, email, fullName, index, phone: phone || null, productIds: resolved.ids });

    if (!parsed.success) {
      errors.push(...parsed.error.issues.map((issue) => issue.message));
    }

    if (!parsed.success || errors.length > 0) {
      return { errors: Array.from(new Set(errors)), index, ok: false, raw: { email, fullName } };
    }

    return {
      index,
      ok: true,
      row: parsed.data,
      summary: { cohortName: cohortCell || null, email: parsed.data.email, fullName: parsed.data.fullName, productTitles: resolved.titles }
    };
  });
}

/** Modelo para baixar: cabecalhos reconhecidos e uma linha de exemplo. */
export function importTemplateCsv() {
  return toCsv(["Nome", "E-mail", "Telefone", "Produtos", "Turma"], [
    ["Ana Souza", "ana@exemplo.com", "+55 11 99999-0000", "Nome do produto | Outro produto", "Turma 1"]
  ]);
}

/** CSV com as linhas que falharam, para o produtor corrigir e importar de novo. */
export function importErrorsCsv(rows: readonly { email: string; errors: readonly string[]; fullName: string; index: number }[]) {
  return toCsv(["Linha", "Nome", "E-mail", "Erro"], rows.map((row) => [row.index, row.fullName, row.email, row.errors.join("; ")]));
}
