// CSV sem dependencia: leitura (RFC 4180: aspas, aspas duplicadas, quebras de linha dentro de aspas,
// separador "," ou ";" detectado pelo cabecalho) e escrita (separador ";" e BOM UTF-8, que e o que o
// Excel em portugues abre direto). Modulo puro: o navegador le o arquivo da importacao e o servidor
// escreve a exportacao com as mesmas regras; tests/csv.test.mjs cobre os dois lados.

export type CsvParseOptions = {
  /** Linhas de dados alem disso sao descartadas e `truncated` vira true. */
  maxRows?: number;
  /** Teto de celulas por linha (contra arquivos malformados). */
  maxColumns?: number;
};

export type CsvParseResult = {
  headers: string[];
  rows: string[][];
  separator: "," | ";";
  truncated: boolean;
};

const DEFAULT_MAX_ROWS = 2_000;
const DEFAULT_MAX_COLUMNS = 64;

function detectSeparator(text: string): "," | ";" {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semicolons = (firstLine.match(/;/g) ?? []).length;

  return semicolons > commas ? ";" : ",";
}

/** Le o texto inteiro. Primeira linha = cabecalho (sem BOM, sem espacos nas pontas). Linhas vazias sao ignoradas. */
export function parseCsv(input: string, options: CsvParseOptions = {}): CsvParseResult {
  const text = input.replace(/^﻿/, "");
  const separator = detectSeparator(text);
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const maxColumns = options.maxColumns ?? DEFAULT_MAX_COLUMNS;
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let truncated = false;

  const pushCell = () => {
    if (row.length < maxColumns) {
      row.push(cell);
    }

    cell = "";
  };
  const pushRow = () => {
    pushCell();

    if (row.some((value) => value.trim() !== "")) {
      if (records.length <= maxRows) {
        records.push(row);
      } else {
        truncated = true;
      }
    }

    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }

      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === separator) {
      pushCell();
    } else if (character === "\n") {
      pushRow();
    } else if (character !== "\r") {
      cell += character;
    }
  }

  if (cell !== "" || row.length > 0) {
    pushRow();
  }

  const [headerRow = [], ...rows] = records;
  const headers = headerRow.map((header) => header.trim());

  return { headers, rows: rows.slice(0, maxRows), separator, truncated: truncated || rows.length > maxRows };
}

/* ------------------------------------------------------------------------------------------------
 * Escrita
 * ---------------------------------------------------------------------------------------------- */

export type CsvCell = string | number | boolean | null | undefined;

/**
 * Celula segura: texto que comeca com = + - @ (ou tab/CR) ganha um apostrofo na frente, para a
 * planilha nao executar formula (injecao de CSV). Numeros e booleanos passam como estao.
 */
export function sanitizeCsvCell(value: CsvCell): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  if (typeof value === "boolean") {
    return value ? "sim" : "não";
  }

  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function quoteCsvCell(text: string, separator: string) {
  return /["\r\n]/.test(text) || text.includes(separator) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Monta o arquivo: BOM + cabecalho + linhas, separador ";" por padrao, quebra CRLF. */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvCell[])[], separator: "," | ";" = ";") {
  const lines = [headers, ...rows].map((row) => row.map((value) => quoteCsvCell(sanitizeCsvCell(value), separator)).join(separator));

  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Nome de arquivo seguro para Content-Disposition e para download no navegador. */
export function csvFileName(base: string, date: Date) {
  const stamp = date.toISOString().slice(0, 10);
  const safe = base.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();

  return `${safe || "export"}-${stamp}.csv`;
}
