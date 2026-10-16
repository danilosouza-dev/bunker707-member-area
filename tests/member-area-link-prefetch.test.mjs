import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Bug de 16/10/2026: a mesma aula aparecia "Concluída" entrando pelo card do módulo e "Concluir" entrando
// por "Continue assistindo". O servidor estava certo nos dois caminhos; o card do módulo usava
// <Link prefetch> (prefetch cheio), e o Next 16 guarda a página dinâmica inteira por até 5 min no
// navegador, mostrando conclusão velha ao clicar. Páginas por aluno (aula, progresso) nunca podem ser
// abertas por Link com prefetch cheio; o padrão (auto) só aquece a rota e pede os dados no clique.
const componentsWithLessonLinks = [
  "../src/components/content-row.tsx",
  "../src/components/content-structure-section.tsx",
  "../src/components/featured-structure-home-section.tsx",
  "../src/components/content-details-modal.tsx"
];

test("links para a página da aula não usam prefetch cheio", async () => {
  for (const relativePath of componentsWithLessonLinks) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");

    assert.match(source, /<Link/, `${relativePath} deveria ter um <Link> para a aula`);
    assert.doesNotMatch(source, /^\s*prefetch\s*$/m, `${relativePath}: <Link prefetch> guarda a página por aluno por 5 min`);
    assert.doesNotMatch(source, /prefetch=\{true\}/, `${relativePath}: <Link prefetch={true}> guarda a página por aluno por 5 min`);
  }
});
