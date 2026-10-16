import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, apagarProdutosDeTeste, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Admin: Produtos (docs/18 §3.2) contra o banco LOCAL de verdade. Criar o produto, montar modulos e
// aulas, checklist e publicacao com versao (409 quando a tela esta velha), reordenar pela RPC atomica
// (409 quando a estrutura mudou), excluir com desfazer, arquivar e excluir. E o que a aluna passa a
// ver na home quando o produto e publicado.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const products = await import("../../src/server/catalog/product-actions.ts");
const content = await import("../../src/server/catalog/content-actions.ts");
const store = await import("../../src/server/catalog/store.ts");
const { STALE_STRUCTURE_MESSAGE } = await import("../../src/server/catalog/rules.ts");
const { getHomePageData } = await import("../../src/server/db/platform-store.ts");

const TITULO = "Produto de Teste 3h: Agentes";
const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const professor = usuarioDeTeste(contas.professor);
const aluna = usuarioDeTeste(contas.aluna);

before(() => apagarProdutosDeTeste(db, "Produto de Teste 3h"));
after(() => apagarProdutosDeTeste(db, "Produto de Teste 3h"));

const estado = { aulas: [], modulos: [], produtoId: "" };

async function versaoAtual() {
  return (await store.fetchProductRow(estado.produtoId)).updated_at;
}

async function idsNaVenda(user) {
  const { homeRows } = await getHomePageData(undefined, user);
  return (homeRows.find((row) => row.title === "Produtos a venda")?.items ?? []).map((item) => item.id);
}

test("analista nao cria produto (403); sem sessao, 401", async () => {
  actAs(analista);
  assert.equal((await products.createProduct({ title: TITULO })).status, 403);
  actAs(null);
  assert.equal((await products.createProduct({ title: TITULO })).status, 401);
});

test("produtor cria o produto: nasce como rascunho, curso a venda, sem capa e sem aulas", async () => {
  actAs(produtor);
  const result = await products.createProduct({ shortDescription: "Produto criado pelo teste de integração.", title: TITULO });

  assert.equal(result.ok, true, JSON.stringify(result));
  estado.produtoId = result.data.id;
  assert.match(estado.produtoId, /^course-produto-de-teste-3h/);

  const row = await store.fetchProductRow(estado.produtoId);
  assert.equal(row.publication_status, "draft");
  assert.equal(row.commerce_scope, "sellable_product");
  assert.equal(row.kind, "Curso");
  assert.equal(row.image, "");

  const checklist = await products.loadPublishChecklist({ id: estado.produtoId });
  assert.equal(checklist.data.canPublish, false, "sem capa e sem aula nao publica");
  assert.deepEqual(
    checklist.data.items.filter((item) => item.state === "blocker").map((item) => item.id).sort(),
    ["cover", "lessons"]
  );
});

test("professor com alcance em outro curso nao monta modulos neste (403, fora do alcance)", async () => {
  actAs(professor);
  const result = await content.createModule({ productId: estado.produtoId, title: "Módulo do professor" });
  assert.equal(result.status, 403);
});

test("produtor monta 2 modulos e 3 aulas: os modulos ganham posicao e contagem, as aulas nascem publicadas sem video", async () => {
  actAs(produtor);
  const m1 = await content.createModule({ productId: estado.produtoId, title: "Módulo A" });
  const m2 = await content.createModule({ productId: estado.produtoId, title: "Módulo B" });
  assert.equal(m1.ok && m2.ok, true, JSON.stringify([m1, m2]));
  estado.modulos = [m1.data.id, m2.data.id];
  assert.equal(m1.data.position, 1);
  assert.equal(m2.data.position, 2);

  const a12 = await content.createLessons({ items: [{ title: "Aula A1" }, { title: "Aula A2" }], moduleId: m1.data.id });
  const a3 = await content.createLessons({ items: [{ title: "Aula B1" }], moduleId: m2.data.id });
  assert.equal(a12.ok && a3.ok, true, JSON.stringify([a12, a3]));
  estado.aulas = [...a12.data.lessons.map((lesson) => lesson.id), ...a3.data.lessons.map((lesson) => lesson.id)];
  assert.equal(estado.aulas.length, 3);
  assert.ok(a12.data.lessons.every((lesson) => lesson.status === "published"), "em produto rascunho a aula nasce publicada");

  const { data: modulos } = await db.from("course_modules").select("id,meta").in("id", estado.modulos).order("sort_order");
  assert.deepEqual(modulos.map((module) => module.meta), ["2 aulas", "1 aula"], "contagem atualizada em cada modulo");
});

test("checklist: com capa e aulas pode publicar (video sem link vira so aviso)", async () => {
  actAs(produtor);
  const capa = await products.setProductImage({ id: estado.produtoId, image: "https://exemplo.test/capas/produto-3h.webp", slot: "cover" });
  assert.equal(capa.ok, true, JSON.stringify(capa));

  const checklist = (await products.loadPublishChecklist({ id: estado.produtoId })).data;
  assert.equal(checklist.canPublish, true);
  assert.equal(checklist.items.find((item) => item.id === "videos")?.state, "warning");
});

test("publicar com a versao velha da tela e recusado (409); com a versao certa publica, e a aluna passa a ver o produto a venda", async () => {
  actAs(produtor);
  assert.deepEqual((await idsNaVenda(aluna)).filter((id) => id === estado.produtoId), [], "rascunho nao aparece para o aluno");

  const velho = await products.publishProduct({ expectedUpdatedAt: "2020-01-01T00:00:00.000Z", id: estado.produtoId });
  assert.equal(velho.status, 409);

  const publicado = await products.publishProduct({ expectedUpdatedAt: await versaoAtual(), id: estado.produtoId });
  assert.equal(publicado.ok, true, JSON.stringify(publicado));
  assert.equal(publicado.data.published, true);
  assert.equal((await store.fetchProductRow(estado.produtoId)).publication_status, "published");

  const { homeRows } = await getHomePageData(undefined, aluna);
  const card = homeRows.find((row) => row.title === "Produtos a venda")?.items.find((item) => item.id === estado.produtoId);
  assert.ok(card, "o produto publicado entra em Produtos a venda");
  assert.equal(card.isLocked, true, "sem compra, bloqueado");
});

test("reordenar e uma RPC atomica: troca a ordem; payload que nao bate com a estrutura e 409 com a frase do produtor", async () => {
  actAs(produtor);
  const [m1, m2] = estado.modulos;
  const [a1, a2, b1] = estado.aulas;

  const trocado = await content.reorderContent({ modules: [{ id: m2, lessonIds: [b1] }, { id: m1, lessonIds: [a2, a1] }], productId: estado.produtoId });
  assert.equal(trocado.ok, true, JSON.stringify(trocado));
  assert.deepEqual(trocado.data.modules.map((module) => module.id), [m2, m1]);
  assert.deepEqual(trocado.data.modules[1].lessons.map((lesson) => lesson.id), [a2, a1]);

  const velho = await content.reorderContent({ modules: [{ id: m2, lessonIds: [b1] }, { id: m1, lessonIds: [a1] }], productId: estado.produtoId });
  assert.equal(velho.status, 409);
  assert.equal(velho.error, STALE_STRUCTURE_MESSAGE);
});

test("excluir uma aula e desfazer: a aula some da estrutura e volta com a situacao de antes", async () => {
  actAs(produtor);
  const b1 = estado.aulas[2];
  const statusDaAula = async () => (await db.from("lessons").select("status").eq("id", b1).single()).data?.status;
  const excluida = await content.softDeleteStructure({ ids: [b1], kind: "lesson" });
  assert.equal(excluida.ok, true, JSON.stringify(excluida));
  assert.equal(await statusDaAula(), "deleted");
  assert.equal(await store.fetchLessonRow(b1), null, "o catalogo nao enxerga mais a aula");

  const restaurada = await content.restoreStructure({ items: [{ id: b1, previousStatus: "published" }], kind: "lesson" });
  assert.equal(restaurada.ok, true, JSON.stringify(restaurada));
  assert.equal(await statusDaAula(), "published");
});

test("arquivar tira o produto da home da aluna; excluir exige o nome certo e leva modulos e aulas junto", async () => {
  actAs(produtor);
  const arquivado = await products.setProductSituation({ expectedUpdatedAt: await versaoAtual(), id: estado.produtoId, situation: "archived" });
  assert.equal(arquivado.ok, true, JSON.stringify(arquivado));
  assert.ok(!(await idsNaVenda(aluna)).includes(estado.produtoId), "arquivado some da home");

  const nomeErrado = await products.deleteProduct({ confirmTitle: "outro nome", id: estado.produtoId });
  assert.ok(nomeErrado.status >= 400 && nomeErrado.status < 500, `status ${nomeErrado.status}`);
  assert.ok(await store.fetchProductRow(estado.produtoId), "nada apagado");

  actAs(analista);
  assert.equal((await products.deleteProduct({ confirmTitle: TITULO, id: estado.produtoId })).status, 403);

  actAs(produtor);
  const apagado = await products.deleteProduct({ confirmTitle: TITULO, id: estado.produtoId });
  assert.equal(apagado.ok, true, JSON.stringify(apagado));
  assert.equal(await store.fetchProductRow(estado.produtoId), null);
  assert.deepEqual(await store.fetchModulesFor([estado.produtoId]), []);
  assert.equal(await store.fetchLessonRow(estado.aulas[0]), null);
});

test("a escola de teste continua como estava", async () => {
  const curso = await store.fetchProductRow(ESCOLA_DE_TESTE.curso.id);
  assert.equal(curso.publication_status, "published");
});
