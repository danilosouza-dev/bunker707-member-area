import assert from "node:assert/strict";
import { test } from "node:test";
import "../support/integration-hooks.mjs";
import { createLocalAdminClient } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, limparProgresso, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// O que cada aluno ve (docs/18 §1.5 item 3 e §3.1 Home / Curso): os leitores da home, da pagina do
// curso e da biblioteca so entregam o que o aluno pode abrir, contra o banco LOCAL de verdade. Regra do
// produto: "a plataforma mostra so o conteudo que o aluno tem acesso" (AGENTS.md).

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
await limparProgresso(db, [contas.aluna.id, contas.alunoSemAcesso.id, contas.alunaAcessoExpirado.id]);
const { getContentPageData, getHomePageData, getMemberLibrary, getPurchasesPageData } = await import("../../src/server/db/platform-store.ts");

const { curso, cursoBloqueado, cursoLiberacao } = ESCOLA_DE_TESTE;
const aluna = usuarioDeTeste(contas.aluna);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);
const alunaAcessoExpirado = usuarioDeTeste(contas.alunaAcessoExpirado);

function fileira(homeRows, title) {
  return homeRows.find((row) => row.title === title) ?? null;
}

const ids = (items) => items.map((item) => item.id).sort();

test("home da aluna: Minhas compras tem so os dois cursos comprados; Produtos a venda tem so o que falta comprar, bloqueado", async () => {
  const { homeRows } = await getHomePageData(undefined, aluna);

  const compras = fileira(homeRows, "Minhas compras");
  assert.ok(compras, "fileira Minhas compras existe");
  assert.deepEqual(ids(compras.items), [curso.id, cursoLiberacao.id].sort());
  for (const item of compras.items) {
    assert.equal(item.isLocked, undefined, `${item.id} comprado nao esta bloqueado`);
    assert.equal(item.accessLabel, "Comprado");
    assert.equal(item.status, "Liberado", "produto fechado comprado vira Liberado");
  }

  const venda = fileira(homeRows, "Produtos a venda");
  assert.ok(venda, "fileira Produtos a venda existe");
  assert.deepEqual(ids(venda.items), [cursoBloqueado.id]);
  assert.equal(venda.items[0].isLocked, true);
  assert.equal(venda.items[0].purchaseLabel, "Comprar");
  assert.equal(venda.items[0].status, "Bloqueado");

  assert.equal(fileira(homeRows, "Continue assistindo"), null, "sem aula comecada, a fileira nem aparece");
});

test("home do aluno sem compra: nada em Minhas compras e os tres cursos a venda, todos bloqueados", async () => {
  const { homeRows } = await getHomePageData(undefined, alunoSemAcesso);

  assert.equal(fileira(homeRows, "Minhas compras"), null, "fileira vazia nao aparece");
  const venda = fileira(homeRows, "Produtos a venda");
  assert.deepEqual(ids(venda.items), [curso.id, cursoBloqueado.id, cursoLiberacao.id].sort());
  assert.ok(venda.items.every((item) => item.isLocked === true));
});

test("acesso que terminou ontem: o curso sai de Minhas compras e volta para a venda", async () => {
  const { homeRows } = await getHomePageData(undefined, alunaAcessoExpirado);

  assert.equal(fileira(homeRows, "Minhas compras"), null);
  assert.ok(ids(fileira(homeRows, "Produtos a venda").items).includes(curso.id));
  assert.deepEqual((await getPurchasesPageData(undefined, alunaAcessoExpirado)).purchasedProducts, []);
});

test("Minhas compras (pagina) lista os mesmos produtos da fileira", async () => {
  const { purchasedProducts } = await getPurchasesPageData(undefined, aluna);

  assert.deepEqual(ids(purchasedProducts), [curso.id, cursoLiberacao.id].sort());
});

test("pagina do curso comprado: modulos com as aulas publicadas e sem video; curso a venda abre bloqueado, como pagina de compra", async () => {
  const comprado = await getContentPageData(curso.id, aluna);
  assert.ok(comprado, "a pagina abre");
  assert.equal(comprado.item.isLocked, undefined);
  assert.deepEqual(comprado.courseModules.map((courseModule) => courseModule.lessons.length), [2, 1]);
  assert.ok(
    comprado.courseModules.every((courseModule) => courseModule.lessons.every((lesson) => lesson.video === undefined)),
    "a pagina do curso nao entrega video de aula"
  );

  const bloqueado = await getContentPageData(cursoBloqueado.id, aluna);
  assert.ok(bloqueado, "produto a venda (listado) abre como pagina de compra");
  assert.equal(bloqueado.item.isLocked, true);
  assert.equal(bloqueado.item.purchaseUrl, "https://exemplo.test/comprar/bloqueado");
});

test("pagina do curso de liberacao: aula futura chega marcada com a data; a aula em rascunho nao existe", async () => {
  const page = await getContentPageData(cursoLiberacao.id, aluna);
  const [modulo] = page.courseModules;
  const lessonIds = modulo.lessons.map((lesson) => lesson.id);

  assert.deepEqual(lessonIds, [cursoLiberacao.aulas.liberada, cursoLiberacao.aulas.futura], "rascunho fica de fora");
  const futura = modulo.lessons.find((lesson) => lesson.id === cursoLiberacao.aulas.futura);
  assert.equal(futura.releaseState?.status, "scheduled");
  assert.match(futura.releaseState?.availableAt ?? "", /^2099-01-01/);
  const liberada = modulo.lessons.find((lesson) => lesson.id === cursoLiberacao.aulas.liberada);
  assert.notEqual(liberada.releaseState?.status, "scheduled", "aula liberada nao vem com data de liberacao");
});

test("biblioteca da aluna: dois cursos com acesso real e sem data de fim; aula futura bloqueada com a data", async () => {
  const library = await getMemberLibrary(undefined, aluna);

  assert.deepEqual(ids(library.contents), [curso.id, cursoLiberacao.id].sort());
  for (const content of library.contents) {
    assert.equal(content.access.kind, "entitlement");
    assert.equal(content.access.endsAt, null, "vitalicio");
    assert.equal(Date.parse(content.access.startsAt ?? ""), Date.parse("2026-01-01T00:00:00.000Z"), "acesso desde 01/01/2026");
  }

  const liberacao = library.contents.find((content) => content.id === cursoLiberacao.id);
  const aulas = liberacao.modules.flatMap((courseModule) => courseModule.lessons);
  assert.deepEqual(aulas.map((lesson) => lesson.id), [cursoLiberacao.aulas.liberada, cursoLiberacao.aulas.futura]);
  const futura = aulas.find((lesson) => lesson.id === cursoLiberacao.aulas.futura);
  assert.equal(futura.isReleaseLocked, true);
  assert.match(futura.releaseLabel ?? "", /01\/01\/2099/);
  assert.equal(aulas.find((lesson) => lesson.id === cursoLiberacao.aulas.liberada).isReleaseLocked, false);
});

test("biblioteca vazia para quem nao comprou ou cujo acesso terminou", async () => {
  assert.deepEqual((await getMemberLibrary(undefined, alunoSemAcesso)).contents, []);
  assert.deepEqual((await getMemberLibrary(undefined, alunaAcessoExpirado)).contents, []);
});
