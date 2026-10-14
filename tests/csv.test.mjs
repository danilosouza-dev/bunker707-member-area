import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// CSV puro usado pela importacao (leitura no navegador) e pela exportacao (escrita no servidor).

const csv = await import("../src/lib/csv.ts");

test("leitura: cabecalho, aspas, aspas duplicadas, quebra de linha dentro de aspas e CRLF", () => {
  const text = '﻿nome,email,obs\r\n"Souza, Ana",ana@x.com,"linha 1\nlinha 2"\r\nBruno,bruno@x.com,"disse ""oi"""\r\n\r\n';
  const parsed = csv.parseCsv(text);

  assert.equal(parsed.separator, ",");
  assert.deepEqual(parsed.headers, ["nome", "email", "obs"]);
  assert.deepEqual(parsed.rows, [
    ["Souza, Ana", "ana@x.com", "linha 1\nlinha 2"],
    ["Bruno", "bruno@x.com", 'disse "oi"']
  ]);
  assert.equal(parsed.truncated, false);
});

test("leitura: detecta ponto e virgula (Excel pt-BR), ignora linhas vazias e respeita o teto de linhas", () => {
  const parsed = csv.parseCsv("Nome ; E-mail\nAna;ana@x.com\n;\nBruno;bruno@x.com\nCarla;carla@x.com\n", { maxRows: 2 });

  assert.equal(parsed.separator, ";");
  assert.deepEqual(parsed.headers, ["Nome", "E-mail"]);
  assert.deepEqual(parsed.rows, [["Ana", "ana@x.com"], ["Bruno", "bruno@x.com"]]);
  assert.equal(parsed.truncated, true);
});

test("leitura: arquivo sem quebra final e teto de colunas", () => {
  const parsed = csv.parseCsv("a,b,c,d\n1,2,3,4", { maxColumns: 3 });

  assert.deepEqual(parsed.headers, ["a", "b", "c"]);
  assert.deepEqual(parsed.rows, [["1", "2", "3"]]);
});

test("escrita: BOM, ponto e virgula, aspas quando precisa e protecao contra formula", () => {
  const out = csv.toCsv(["Nome", "E-mail", "Obs"], [
    ["Ana; Souza", "ana@x.com", '=HYPERLINK("x")'],
    ["Bruno", null, "+55 11 9"],
    ["Carla", 3, true]
  ]);

  assert.ok(out.startsWith("﻿"));
  const lines = out.slice(1).split("\r\n");
  assert.equal(lines[0], "Nome;E-mail;Obs");
  assert.equal(lines[1], '"Ana; Souza";ana@x.com;"\'=HYPERLINK(""x"")"');
  assert.equal(lines[2], "Bruno;;'+55 11 9", "telefone com + ganha apostrofo (nao vira formula)");
  assert.equal(lines[3], "Carla;3;sim");
  assert.equal(lines.at(-1), "");
});

test("escrita: celulas com - @ e tab tambem sao neutralizadas; controle invisivel e removido", () => {
  assert.equal(csv.sanitizeCsvCell("-1+1"), "'-1+1");
  assert.equal(csv.sanitizeCsvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csv.sanitizeCsvCell("\tx"), "'\tx");
  assert.equal(csv.sanitizeCsvCell("ok\u0007"), "ok");
  assert.equal(csv.sanitizeCsvCell(Number.NaN), "");
});

test("nome do arquivo: sem acento, sem espaco, com a data", () => {
  assert.equal(csv.csvFileName("Alunos – Em risco", new Date("2026-10-15T12:00:00Z")), "alunos-em-risco-2026-10-15.csv");
  assert.equal(csv.csvFileName("", new Date("2026-10-15T12:00:00Z")), "export-2026-10-15.csv");
});
