// Importacao de alunos por CSV (docs/17 §1.7.2): regras puras que rodam no navegador (prévia) e cujos
// resultados o servidor revalida com importRowSchema. Deteccao de colunas pelo cabecalho, mapeamento
// de cada linha, resolucao de produtos por titulo (ambiguo = erro da linha) e o modelo para baixar.
//
// Termino do acesso (docs/17 §1.6.10, a migracao de alunos de outras plataformas): cada linha aceita a data
// de termino, ou "vitalício", por produto. Duas formas, que podem ser usadas juntas:
// - na celula de Produtos, depois do nome: "Formação Agentes = 31/12/2027 | Prompts do Zero = vitalício";
// - na coluna Término: vale para os produtos da linha que nao trazem o proprio termino.
// O que nao tem termino em nenhum dos dois segue o "Acesso até" escolhido na tela (em branco = nao vence).

import { toCsv } from "../../lib/csv";
import { IMPORT_MAX_ROWS } from "./model";
import { importRowSchema, type ImportRowInput } from "./schemas";

export const IMPORT_FIELDS = ["fullName", "email", "phone", "products", "cohort", "ends"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  cohort: "Turma",
  email: "E-mail",
  ends: "Término",
  fullName: "Nome",
  phone: "Telefone",
  products: "Produtos"
};

export const IMPORT_REQUIRED_FIELDS: readonly ImportField[] = ["fullName", "email"];

/** Nomes de cabecalho reconhecidos (sem acento, minusculos). */
const HEADER_ALIASES: Record<ImportField, readonly string[]> = {
  cohort: ["turma", "classe", "cohort"],
  email: ["email", "e-mail", "mail"],
  ends: ["termino", "termino do acesso", "data de termino", "acesso ate", "fim do acesso", "validade", "vencimento", "expira em", "prazo"],
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
  /** `productTitles`: o titulo de cada produto; com termino na planilha, "Titulo (até 31/12/2027)" ou "Titulo (vitalício)". */
  | { index: number; ok: true; row: ImportRowInput; summary: { email: string; fullName: string; productTitles: string[]; cohortName: string | null } }
  | { index: number; ok: false; errors: string[]; raw: { email: string; fullName: string } };

function cell(cells: readonly string[], index: number | undefined) {
  return index === undefined ? "" : (cells[index] ?? "").trim();
}

function normalizeTitle(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const LIFETIME_WORDS = new Set(["vitalicio", "vitalicia", "para sempre", "sem prazo", "nao vence", "permanente", "lifetime"]);

/**
 * Termino escrito numa celula: "31/12/2027", "31-12-2027", "2027-12-31" ou "vitalício" (tambem "para sempre",
 * "sem prazo"). Devolve "AAAA-MM-DD", `null` (vitalicio) ou `undefined` quando o texto nao e um termino valido.
 */
export function parseAccessEndCell(value: string): string | null | undefined {
  const text = value.trim();

  if (LIFETIME_WORDS.has(normalizeHeader(text))) {
    return null;
  }

  const brazilian = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const [year, month, day] = brazilian ? [brazilian[3], brazilian[2], brazilian[1]] : iso ? [iso[1], iso[2], iso[3]] : ["", "", ""];

  if (!year) {
    return undefined;
  }

  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  // 31/02 e afins: o calendario "corrige" a data; aqui isso e erro.
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    return undefined;
  }

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** "31/12/2027" a partir de "2027-12-31". */
function formatEndDate(value: string) {
  const [year, month, day] = value.split("-");

  return `${day}/${month}/${year}`;
}

/** "(até 31/12/2027)" ou "(vitalício)". */
function describeEnd(end: string | null) {
  return end === null ? "vitalício" : `até ${formatEndDate(end)}`;
}

const INVALID_END_HINT = "use dd/mm/aaaa ou “vitalício”";

/**
 * Produtos de uma celula ("Prompts do Zero | Formação Agentes" ou ids), separados por | ; ou ,.
 * Titulo que casa com mais de um produto e erro (nunca escolha silenciosa); desconhecido e erro.
 * Cada produto pode trazer o proprio termino depois de "=": "Formação Agentes = 31/12/2027",
 * "Prompts do Zero = vitalício" (`ends`: id -> "AAAA-MM-DD" ou null; so os que trouxeram).
 */
export function resolveProductsCell(value: string, products: readonly ImportProductOption[]) {
  const ids: string[] = [];
  const titles: string[] = [];
  const errors: string[] = [];
  const ends: Record<string, string | null> = {};
  const parts = value.split(/[|;,]/).map((part) => part.trim()).filter(Boolean);

  for (const rawPart of parts) {
    const cut = rawPart.lastIndexOf("=");
    const part = cut > 0 ? rawPart.slice(0, cut).trim() : rawPart;
    const endText = cut > 0 ? rawPart.slice(cut + 1).trim() : "";
    const end = endText ? parseAccessEndCell(endText) : undefined;

    if (endText && end === undefined) {
      errors.push(`término “${endText}” de “${part}” inválido: ${INVALID_END_HINT}`);
    }

    const add = (product: ImportProductOption) => {
      if (!ids.includes(product.id)) {
        ids.push(product.id);
        titles.push(product.title);
      }

      if (end !== undefined) {
        ends[product.id] = end;
      }
    };
    const byId = products.find((product) => product.id === part);

    if (byId) {
      add(byId);
      continue;
    }

    const wanted = normalizeTitle(part);
    const matches = products.filter((product) => normalizeTitle(product.title) === wanted);

    if (matches.length === 1) {
      add(matches[0]);
    } else if (matches.length > 1) {
      errors.push(`“${part}” corresponde a mais de um produto: use o id`);
    } else {
      errors.push(`produto “${part}” não encontrado`);
    }
  }

  return { ends, errors, ids, titles };
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
    const endsCell = cell(cells, input.mapping.ends);
    const errors: string[] = [];
    const resolved = resolveProductsCell(productsCell, input.products);
    errors.push(...resolved.errors);

    // A coluna Término vale para os produtos da linha que nao trouxeram o proprio termino.
    const rowEnd = endsCell ? parseAccessEndCell(endsCell) : undefined;
    const productEndsAt: Record<string, string | null> = { ...resolved.ends };

    if (endsCell && rowEnd === undefined) {
      errors.push(`término “${endsCell}” inválido: ${INVALID_END_HINT}`);
    } else if (rowEnd !== undefined) {
      for (const id of resolved.ids) {
        if (!Object.hasOwn(productEndsAt, id)) {
          productEndsAt[id] = rowEnd;
        }
      }
    }

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

    const parsed = importRowSchema.safeParse({ cohortId, email, fullName, index, phone: phone || null, productEndsAt, productIds: resolved.ids });

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
      summary: {
        cohortName: cohortCell || null,
        email: parsed.data.email,
        fullName: parsed.data.fullName,
        productTitles: resolved.titles.map((title, position) => {
          const id = resolved.ids[position];

          return Object.hasOwn(productEndsAt, id) ? `${title} (${describeEnd(productEndsAt[id])})` : title;
        })
      }
    };
  });
}

/** Modelo para baixar: cabecalhos reconhecidos e uma linha de exemplo. */
export function importTemplateCsv() {
  return toCsv(["Nome", "E-mail", "Telefone", "Produtos", "Turma", "Término"], [
    ["Ana Souza", "ana@exemplo.com", "+55 11 99999-0000", "Nome do produto | Outro produto", "Turma 1", "31/12/2027"],
    ["Bruno Lima", "bruno@exemplo.com", "", "Nome do produto = vitalício | Outro produto = 30/06/2027", "", ""]
  ]);
}

/** CSV com as linhas que falharam, para o produtor corrigir e importar de novo. */
export function importErrorsCsv(rows: readonly { email: string; errors: readonly string[]; fullName: string; index: number }[]) {
  return toCsv(["Linha", "Nome", "E-mail", "Erro"], rows.map((row) => [row.index, row.fullName, row.email, row.errors.join("; ")]));
}
