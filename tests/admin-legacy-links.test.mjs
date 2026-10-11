import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// "Ver aluno" da Comunidade leva para a lista de alunos do admin antigo ja filtrada, enquanto Alunos
// v2 nao existe; o admin antigo le ?tela=alunos&busca= e abre direto nessa lista.

const links = await import("../src/lib/admin-legacy-links.ts");
const hrefs = await import("../src/components/admin/v2/community/hrefs.ts");

test("o link de Ver aluno abre a lista de alunos do admin antigo com o nome na busca", () => {
  const href = hrefs.studentSearchHref("  Helena Prado ");
  const url = new URL(href, "https://bunker707.test");

  assert.equal(url.pathname, "/admin/legado");
  assert.deepEqual(links.readLegacyAdminParams(Object.fromEntries(url.searchParams)), {
    initialStudentQuery: "Helena Prado",
    initialView: "students"
  });
});

test("o admin antigo so muda a tela inicial quando o endereco pede a lista de alunos", () => {
  assert.deepEqual(links.readLegacyAdminParams(undefined), {});
  assert.deepEqual(links.readLegacyAdminParams({}), {});
  assert.deepEqual(links.readLegacyAdminParams({ busca: "Ana" }), {}, "busca sozinha nao troca a tela");
  assert.deepEqual(links.readLegacyAdminParams({ tela: "catalogo", busca: "Ana" }), {});
  assert.deepEqual(links.readLegacyAdminParams({ tela: "alunos" }), { initialView: "students" });
  assert.deepEqual(links.readLegacyAdminParams({ tela: ["alunos", "x"], busca: ["Ana", "Bia"] }), {
    initialStudentQuery: "Ana",
    initialView: "students"
  });
  assert.equal(links.readLegacyAdminParams({ tela: "alunos", busca: "x".repeat(500) }).initialStudentQuery.length, 120);
  assert.equal(links.legacyStudentSearchHref("   "), "/admin/legado?tela=alunos");
});
