import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Listas fixas escritas no codigo (ex.: larguras de skeleton) nao podem usar o proprio valor como key
// quando ele se repete: o React avisa "two children with the same key" e pode pular itens.
// Caso real: [64, 88, 88, 92] com key={width} no carregamento de Produtos.

const srcDir = fileURLToPath(new URL("../src", import.meta.url));
const literalMap = /\[([^[\]]{1,200})\]\.map\(\((\w+)(?:,\s*\w+)?\)\s*=>/g;

async function listTsxFiles(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
}

test("nenhuma lista fixa usa como key um valor que se repete", async () => {
  const problems = [];

  for (const file of await listTsxFiles(srcDir)) {
    const source = await readFile(file, "utf8");

    for (const match of source.matchAll(literalMap)) {
      const items = match[1].split(",").map((item) => item.trim()).filter(Boolean);
      const variable = match[2];
      const body = source.slice(match.index + match[0].length, match.index + match[0].length + 400);

      if (new RegExp(`key=\\{${variable}\\}`).test(body) && new Set(items).size !== items.length) {
        const line = source.slice(0, match.index).split("\n").length;
        problems.push(`${path.relative(srcDir, file)}:${line} [${items.join(", ")}] key={${variable}}`);
      }
    }
  }

  assert.deepEqual(problems, []);
});
