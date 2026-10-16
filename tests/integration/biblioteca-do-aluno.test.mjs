import assert from "node:assert/strict";
import { before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, limparProgresso, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Biblioteca do aluno (docs/18 §3.1: Favoritos, Materiais, Minhas compras): rotas e leitores contra o
// banco LOCAL de verdade. So entra o que o aluno pode abrir; favorito e material seguem a mesma regra
// de acesso e de liberacao da aula.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const savedItemsRoute = await import("../../src/app/api/saved-items/route.ts");
const materialsRoute = await import("../../src/app/api/materials/lessons/[lessonId]/route.ts");
const { getFavoritesPageData, getMemberLibrary } = await import("../../src/server/db/platform-store.ts");
const { getMaterialsPageData } = await import("../../src/server/member-area/student-pages.ts");
const { buildPurchasesPageView } = await import("../../src/server/member-area/purchases-view.ts");

const { curso, cursoLiberacao } = ESCOLA_DE_TESTE;
const aluna = usuarioDeTeste(contas.aluna);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);
const alunaAcessoExpirado = usuarioDeTeste(contas.alunaAcessoExpirado);

function favoritar(user, payload) {
  actAs(user);
  return savedItemsRoute.PUT(new Request("http://localhost/api/saved-items", {
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
    method: "PUT"
  }));
}

function materiaisDaAula(user, lessonId, contentId = curso.id) {
  actAs(user);
  return materialsRoute.GET(
    new Request(`http://localhost/api/materials/lessons/${lessonId}?contentId=${contentId}`),
    { params: Promise.resolve({ lessonId }) }
  );
}

before(async () => {
  await limparProgresso(db, [contas.aluna.id, contas.alunoSemAcesso.id, contas.alunaAcessoExpirado.id]);
});

/* ---------------------------------------------------------------- Favoritos */

test("favoritos: sem sessao 401; pedido invalido 400", async () => {
  assert.equal((await favoritar(null, { saved: true, targetId: curso.id, targetType: "standalone_course" })).status, 401);
  assert.equal((await favoritar(aluna, { saved: true, targetId: curso.id, targetType: "coisa" })).status, 400);
  assert.equal((await favoritar(aluna, { saved: "sim", targetId: curso.id, targetType: "standalone_course" })).status, 400);
});

test("favoritar o curso e uma aula: aparecem em Favoritos; desfavoritar tira", async () => {
  assert.equal((await favoritar(aluna, { saved: true, targetId: curso.id, targetType: "standalone_course" })).status, 200);
  assert.equal((await favoritar(aluna, { saved: true, targetId: curso.aulas.aula2, targetType: "lesson" })).status, 200);

  let favoritos = await getFavoritesPageData(undefined, aluna);
  assert.deepEqual(favoritos.savedContentItems.map((item) => item.id), [curso.id]);
  assert.deepEqual(favoritos.savedLessonItems.map((item) => item.id), [curso.aulas.aula2]);
  assert.equal(favoritos.savedContentItems[0].isSaved, true);

  assert.equal((await favoritar(aluna, { saved: false, targetId: curso.id, targetType: "standalone_course" })).status, 200);
  favoritos = await getFavoritesPageData(undefined, aluna);
  assert.deepEqual(favoritos.savedContentItems, []);
  assert.deepEqual(favoritos.savedLessonItems.map((item) => item.id), [curso.aulas.aula2], "a aula continua");
});

test("favorito de algo que nao existe e recusado", async () => {
  const response = await favoritar(aluna, { saved: true, targetId: "nao-existe", targetType: "standalone_course" });
  assert.ok(response.status >= 400, `status ${response.status}`);
});

/* ---------------------------------------------------------------- Materiais */

test("materiais da aula: a apostila esta disponivel, o checklist espera 50% da aula e o rascunho nao aparece", async () => {
  const response = await materiaisDaAula(aluna, curso.aulas.aula1);
  assert.equal(response.status, 200);
  const { data } = await response.json();
  const materials = data.materials ?? data;
  const porTitulo = Object.fromEntries(materials.map((material) => [material.title, material]));

  assert.deepEqual(Object.keys(porTitulo).sort(), ["Apostila da aula 1", "Checklist da aula 1"]);
  assert.equal(porTitulo["Apostila da aula 1"].locked, false);
  assert.equal(porTitulo["Apostila da aula 1"].url, "https://exemplo.test/materiais/apostila-aula-1.pdf");
  assert.equal(porTitulo["Checklist da aula 1"].locked, true);
  assert.match(porTitulo["Checklist da aula 1"].lockMessage ?? "", /50/);
});

test("materiais so de aula que o aluno pode abrir: sem compra 403; aula com liberacao futura 403; sem conteudo 400", async () => {
  assert.equal((await materiaisDaAula(alunoSemAcesso, curso.aulas.aula1)).status, 403);
  assert.equal((await materiaisDaAula(aluna, cursoLiberacao.aulas.futura, cursoLiberacao.id)).status, 403);

  actAs(aluna);
  const semConteudo = await materialsRoute.GET(
    new Request(`http://localhost/api/materials/lessons/${curso.aulas.aula1}`),
    { params: Promise.resolve({ lessonId: curso.aulas.aula1 }) }
  );
  assert.equal(semConteudo.status, 400);
});

test("pagina Materiais: reune os materiais das aulas liberadas da aluna, com o bloqueado contado; quem nao comprou nao tem aulas", async () => {
  const pagina = await getMaterialsPageData(undefined, aluna);
  assert.equal(pagina.state, "ready");
  assert.equal(pagina.view.total, 2, "apostila e checklist; rascunho e material da aula futura ficam de fora");
  assert.equal(pagina.view.lockedCount, 1);
  const titulos = pagina.view.groups.flatMap((group) => group.lessons.flatMap((lesson) => lesson.materials.map((material) => material.title))).sort();
  assert.deepEqual(titulos, ["Apostila da aula 1", "Checklist da aula 1"]);
  assert.deepEqual(pagina.view.types.map((type) => type.id).sort(), ["document", "pdf"]);

  assert.equal((await getMaterialsPageData(undefined, alunoSemAcesso)).state, "no_lessons");
});

/* ------------------------------------------------------------ Minhas compras */

test("Minhas compras: os dois cursos comprados, com o acesso desde 01/01/2026 e vitalicio; acesso expirado nao lista nada", async () => {
  const view = buildPurchasesPageView(await getMemberLibrary(undefined, aluna));
  assert.deepEqual(view.products.map((product) => product.id).sort(), [curso.id, cursoLiberacao.id].sort());
  for (const product of view.products) {
    assert.equal(product.accessLabel, "Desde 01/01/2026 · Acesso vitalício");
    assert.equal(product.status, "not_started");
  }

  const expirada = buildPurchasesPageView(await getMemberLibrary(undefined, alunaAcessoExpirado));
  assert.deepEqual(expirada.products, []);
});
