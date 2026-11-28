import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, apagarContaDeTeste, desconectarVendas, limparVendasDeTeste, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Prazo de acesso por curso e "todas as formacoes" (docs/05; docs/17 §1.6.10; migracao 202611280001) contra o banco
// LOCAL de verdade: o produtor grava o pacote com o prazo de cada curso e o item "todas as formacoes" (a funcao
// admin_save_combo_v2 no Postgres) e o prazo do codigo de venda de um produto; a compra aprovada (payload FICTICIO da
// Hotmart) da a cada curso o termino dele; a compra repetida soma e o reembolso devolve o termino de antes (com as datas
// indo e voltando do banco); a formacao publicada depois entra para quem tem a concessao aberta; o reembolso fecha tudo
// o que a compra abriu. Nenhum e-mail sai.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const route = await import("../../src/app/api/webhooks/hotmart/route.ts");
const salesActions = await import("../../src/server/payments/actions.ts");
const productActions = await import("../../src/server/catalog/product-actions.ts");
const comboActions = await import("../../src/server/catalog/combo-actions.ts");
const combos = await import("../../src/server/catalog/combos.ts");
const catalogQueries = await import("../../src/server/catalog/queries.ts");
const { materializeAllFormations } = await import("../../src/server/payments/all-formations.ts");
const term = await import("../../src/server/access/access-term.ts");

const { curso, cursoBloqueado, cursoLiberacao } = ESCOLA_DE_TESTE;
const produtor = usuarioDeTeste(contas.produtor);
const TOKEN = "hottok-prazo-integracao-0123456789";
const CODIGOS = { curso: "7801", pacote: "7802" };
const PREFIXO = "teste-prazo-";
const PACOTE = "Pacote de Teste: Prazo por Curso";
const FORMACAO = { id: "teste-prazo-formacao-publicada", titulo: "Formação de Teste: Prazo (publicada)" };
const FORMACAO_NOVA = { id: "teste-prazo-formacao-nova", titulo: "Formação de Teste: Prazo (nova)" };
const COMPRADORA = { email: "compradora.prazo@bunker707.test", nome: "Compradora com Prazo" };
const REPETIDA = { email: "compradora.repetida@bunker707.test", nome: "Compradora que Compra de Novo" };
const ANO = { amount: 1, unit: "years" };
const DOIS_ANOS = { amount: 2, unit: "years" };
const SEIS_MESES = { amount: 6, unit: "months" };
const instante = (value) => (value === null ? null : new Date(value).toISOString());

function formacao({ id, titulo }, publicationStatus) {
  return {
    access_label: null,
    access_model: "closed",
    bucket: "formations",
    commerce_scope: "sellable_product",
    description: "Formacao ficticia dos testes de prazo de acesso.",
    eyebrow: "Formação",
    id,
    image: "/hero/bunker-ai-hero.png",
    is_locked: false,
    kind: "Formacao",
    lessons_label: "0 aulas",
    listing: "listed",
    progress: 0,
    publication_status: publicationStatus,
    purchase_label: "Comprar",
    purchase_url: "https://exemplo.test/comprar/formacao",
    sort_order: 90,
    status: "Bloqueado",
    title: titulo
  };
}

/** Payload ficticio de compra no formato do webhook 2.0 da Hotmart. */
function payload({ aprovadaEm = Date.now() - 60_000, email, event = "PURCHASE_APPROVED", id, nome, produto, transaction }) {
  return {
    creation_date: Date.now(),
    data: {
      buyer: { email, name: nome },
      product: { id: Number(produto), name: `Produto ${produto} na Hotmart` },
      purchase: { approved_date: aprovadaEm, order_date: aprovadaEm, price: { currency_value: "BRL", value: 997 }, status: event === "PURCHASE_APPROVED" ? "APPROVED" : "REFUNDED", transaction }
    },
    event,
    id: `${PREFIXO}${id}`,
    version: "2.0.0"
  };
}

async function postJson(body) {
  const response = await route.POST(
    new Request("http://127.0.0.1:3100/api/webhooks/hotmart", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", host: "127.0.0.1:3100", "x-hotmart-hottok": TOKEN },
      method: "POST"
    })
  );

  return { body: await response.json(), status: response.status };
}

async function contaDe(email) {
  const { users } = unwrap(await db.auth.admin.listUsers({ page: 1, perPage: 1000 }), "Lendo contas");

  return users.find((user) => user.email === email) ?? null;
}

async function acessosDe(email) {
  const conta = await contaDe(email);

  if (!conta) {
    return new Map();
  }

  const linhas = unwrap(await db.from("entitlements").select("id,target_id,target_type,status,ends_at").eq("user_id", conta.id), "Lendo acessos");

  return new Map(linhas.map((linha) => [linha.target_id, linha]));
}

async function pacoteDeTeste() {
  return (await combos.listCombos()).find((combo) => combo.name === PACOTE) ?? null;
}

async function limpar() {
  await desconectarVendas(db);
  await limparVendasDeTeste(db, { codigos: Object.values(CODIGOS), prefixoDoEvento: PREFIXO });

  for (const conta of [COMPRADORA, REPETIDA]) {
    await apagarContaDeTeste(db, conta.email);
  }

  unwrap(await db.from("product_combos").delete().eq("name", PACOTE), "Apagando o pacote de teste do prazo");
  unwrap(await db.from("content_items").delete().in("id", [FORMACAO.id, FORMACAO_NOVA.id]), "Apagando as formacoes de teste do prazo");
}

before(async () => {
  await limpar();
  unwrap(await db.from("content_items").upsert([formacao(FORMACAO, "published"), formacao(FORMACAO_NOVA, "draft")], { onConflict: "id" }), "Gravando as formacoes de teste do prazo");
  actAs(produtor);
  const conectado = await salesActions.saveSalesSecret({ provider: "hotmart", secret: TOKEN });
  assert.equal(conectado.ok, true, JSON.stringify(conectado));
});

after(limpar);

test("o produtor grava o pacote com o prazo de cada curso e todas as formações, e a tela lê de volta", async () => {
  actAs(produtor);

  const criado = await comboActions.saveCombo({
    allFormations: true,
    allFormationsTerm: DOIS_ANOS,
    cohortName: "Black 2026",
    hotmartProductId: CODIGOS.pacote,
    name: PACOTE,
    productIds: [cursoLiberacao.id, cursoBloqueado.id],
    productTerms: { [cursoBloqueado.id]: ANO },
    status: "active"
  });
  assert.equal(criado.ok, true, JSON.stringify(criado));
  assert.deepEqual(criado.data.products.map((product) => [product.id, product.accessTerm]), [[cursoLiberacao.id, null], [cursoBloqueado.id, ANO]]);
  assert.equal(criado.data.allFormations, true);
  assert.deepEqual(criado.data.allFormationsTerm, DOIS_ANOS);
  assert.equal(criado.data.cohortName, "Black 2026");

  const itens = unwrap(await db.from("product_combo_items").select("product_id,access_unit,access_amount,sort_order").eq("combo_id", criado.data.id).order("sort_order"), "Lendo os itens do pacote");
  assert.deepEqual(itens.map((item) => [item.product_id, item.access_unit, item.access_amount]), [[cursoLiberacao.id, null, null], [cursoBloqueado.id, "years", 1]]);

  // Editar: muda um prazo; o resto continua.
  const editado = await comboActions.saveCombo({
    allFormations: true,
    allFormationsTerm: DOIS_ANOS,
    cohortName: "Black 2026",
    id: criado.data.id,
    name: PACOTE,
    productIds: [cursoLiberacao.id, cursoBloqueado.id],
    productTerms: { [cursoBloqueado.id]: ANO, [cursoLiberacao.id]: null },
    status: "active"
  });
  assert.equal(editado.ok, true, JSON.stringify(editado));
  assert.equal((await pacoteDeTeste()).hotmartProductId, CODIGOS.pacote, "o codigo continua ligado");

  // Sem produto e sem "todas as formacoes" o pacote nao vale.
  const vazio = await comboActions.saveCombo({ id: criado.data.id, name: PACOTE, productIds: [] });
  assert.equal(vazio.ok, false);
  assert.ok(vazio.fieldErrors?.productIds);
});

test("o código de venda de um produto sozinho guarda o prazo, e a aba Acesso e venda lê de volta", async () => {
  actAs(produtor);
  const antes = await catalogQueries.getProductAccess(curso.id);
  assert.equal(antes.saleAccessTerm, null, "sem prazo escolhido e para sempre");

  const salvo = await productActions.updateProductAccess({ expectedUpdatedAt: antes.header.updatedAt, hotmartProductId: CODIGOS.curso, id: curso.id, saleAccessTerm: SEIS_MESES });
  assert.equal(salvo.ok, true, JSON.stringify(salvo));

  const depois = await catalogQueries.getProductAccess(curso.id);
  assert.equal(depois.hotmartProductId, CODIGOS.curso);
  assert.deepEqual(depois.saleAccessTerm, SEIS_MESES);

  const [ligacao] = unwrap(await db.from("sales_product_links").select("access_unit,access_amount").eq("provider", "hotmart").eq("product_id", curso.id), "Lendo o codigo de venda");
  assert.deepEqual([ligacao.access_unit, ligacao.access_amount], ["months", 6]);
});

test("a compra do pacote dá a cada curso o prazo dele, abre as formações publicadas e grava a concessão com a turma", async () => {
  const aprovadaEm = Date.now() - 60_000;
  const compra = await postJson(payload({ aprovadaEm, email: COMPRADORA.email, id: "pacote-compra", nome: COMPRADORA.nome, produto: CODIGOS.pacote, transaction: "HP-PRAZO-0001" }));

  assert.equal(compra.status, 200, JSON.stringify(compra.body));
  assert.equal(compra.body.outcome, "access_granted", JSON.stringify(compra.body));

  const acessos = await acessosDe(COMPRADORA.email);
  assert.equal(acessos.get(cursoLiberacao.id).ends_at, null, "Para sempre");
  assert.equal(instante(acessos.get(cursoBloqueado.id).ends_at), term.accessEndFromPurchase(aprovadaEm, ANO), "Por 1 ano, a partir da compra aprovada");
  assert.equal(instante(acessos.get(FORMACAO.id).ends_at), term.accessEndFromPurchase(aprovadaEm, DOIS_ANOS), "todas as formacoes por 2 anos");
  assert.equal(acessos.get(FORMACAO.id).target_type, "formation");
  assert.equal(acessos.has(FORMACAO_NOVA.id), false, "a formacao em rascunho ainda nao entra");
  assert.equal(acessos.has(curso.id), false, "curso fora do pacote nao entra por todas as formacoes");

  const conta = await contaDe(COMPRADORA.email);
  const [concessao] = unwrap(await db.from("all_formations_grants").select("status,ends_at,cohort_name,combo_id,transaction_id,formation_ids,term_unit,term_amount").eq("user_id", conta.id), "Lendo a concessao");
  assert.equal(concessao.status, "active");
  assert.equal(instante(concessao.ends_at), term.accessEndFromPurchase(aprovadaEm, DOIS_ANOS));
  assert.equal(concessao.cohort_name, "Black 2026");
  assert.equal(concessao.transaction_id, "HP-PRAZO-0001");
  assert.deepEqual([concessao.term_unit, concessao.term_amount], ["years", 2]);
  assert.ok(concessao.formation_ids.includes(FORMACAO.id));

  const vinculos = unwrap(await db.from("sale_grants").select("product_id,opened,term_unit,term_amount,purchased_at").eq("transaction_id", "HP-PRAZO-0001"), "Lendo os vinculos");
  const vinculo = (productId) => vinculos.find((linha) => linha.product_id === productId);
  assert.deepEqual([vinculo(cursoBloqueado.id).term_unit, vinculo(cursoBloqueado.id).term_amount], ["years", 1]);
  assert.deepEqual([vinculo(cursoLiberacao.id).term_unit, vinculo(cursoLiberacao.id).term_amount], [null, null]);
  assert.equal(instante(vinculo(FORMACAO.id).purchased_at), new Date(aprovadaEm).toISOString());
});

test("a formação publicada depois entra sozinha, com o mesmo término; o reembolso do pacote fecha tudo o que ele abriu", async () => {
  unwrap(await db.from("content_items").update({ publication_status: "published" }).eq("id", FORMACAO_NOVA.id), "Publicando a formacao nova");

  const rodada = await materializeAllFormations(db, { formationIds: [FORMACAO_NOVA.id] });
  assert.deepEqual([rodada.missingMigration, rodada.granted, rodada.failed], [false, 1, 0], JSON.stringify(rodada));

  const acessos = await acessosDe(COMPRADORA.email);
  assert.equal(instante(acessos.get(FORMACAO_NOVA.id).ends_at), instante(acessos.get(FORMACAO.id).ends_at), "o mesmo termino das outras formacoes");
  assert.equal((await materializeAllFormations(db)).granted, 0, "a rodada seguinte nao repete");

  const reembolso = await postJson(payload({ email: COMPRADORA.email, event: "PURCHASE_REFUNDED", id: "pacote-reembolso", nome: COMPRADORA.nome, produto: CODIGOS.pacote, transaction: "HP-PRAZO-0001" }));
  assert.equal(reembolso.body.outcome, "access_revoked", JSON.stringify(reembolso.body));

  const depois = await acessosDe(COMPRADORA.email);
  for (const id of [cursoLiberacao.id, cursoBloqueado.id, FORMACAO.id, FORMACAO_NOVA.id]) {
    assert.equal(depois.get(id).status, "revoked", id);
  }

  const conta = await contaDe(COMPRADORA.email);
  const [concessao] = unwrap(await db.from("all_formations_grants").select("status,closed_by").eq("user_id", conta.id), "Lendo a concessao fechada");
  assert.deepEqual([concessao.status, concessao.closed_by], ["closed", "refund"]);
});

test("compra repetida soma e o reembolso da segunda devolve o término de antes, com as datas indo e voltando do banco", async () => {
  const primeiraEm = Date.now() - 3 * 86_400_000;
  const segundaEm = Date.now() - 60_000;

  assert.equal((await postJson(payload({ aprovadaEm: primeiraEm, email: REPETIDA.email, id: "repetida-1", nome: REPETIDA.nome, produto: CODIGOS.curso, transaction: "HP-PRAZO-0002" }))).body.outcome, "access_granted");
  const umPrazo = term.accessEndFromPurchase(primeiraEm, SEIS_MESES);
  assert.equal(instante((await acessosDe(REPETIDA.email)).get(curso.id).ends_at), umPrazo);

  assert.equal((await postJson(payload({ aprovadaEm: segundaEm, email: REPETIDA.email, id: "repetida-2", nome: REPETIDA.nome, produto: CODIGOS.curso, transaction: "HP-PRAZO-0003" }))).body.outcome, "access_granted");
  const doisPrazos = new Date(term.addAccessTerm(Date.parse(umPrazo), SEIS_MESES)).toISOString();
  assert.equal(instante((await acessosDe(REPETIDA.email)).get(curso.id).ends_at), doisPrazos, "o termino atual + o prazo comprado");

  const reembolso = await postJson(payload({ email: REPETIDA.email, event: "PURCHASE_REFUNDED", id: "repetida-reembolso", nome: REPETIDA.nome, produto: CODIGOS.curso, transaction: "HP-PRAZO-0003" }));
  assert.equal(reembolso.body.outcome, "access_restored", JSON.stringify(reembolso.body));
  const acesso = (await acessosDe(REPETIDA.email)).get(curso.id);
  assert.equal(instante(acesso.ends_at), umPrazo, "o termino de antes da segunda compra");
  assert.equal(acesso.status, "active");

  // Tirar o prazo do codigo (voltar para "para sempre") nao mexe em quem ja comprou.
  actAs(produtor);
  const atual = await catalogQueries.getProductAccess(curso.id);
  const semPrazo = await productActions.updateProductAccess({ expectedUpdatedAt: atual.header.updatedAt, id: curso.id, saleAccessTerm: null });
  assert.equal(semPrazo.ok, true, JSON.stringify(semPrazo));
  assert.equal((await catalogQueries.getProductAccess(curso.id)).saleAccessTerm, null);
  assert.equal(instante((await acessosDe(REPETIDA.email)).get(curso.id).ends_at), umPrazo);
});
