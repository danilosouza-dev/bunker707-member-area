import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { after, before, beforeEach } from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import { apiInternaFalsa, CREDENCIAL_DE_TESTE } from "./support/emissor-interno-falso.mjs";
import { bancoEmMemoria } from "./support/vendas-banco-em-memoria.mjs";

// A venda do Bunker Members que vira Licenca (docs/32 §11.10), de ponta a ponta sem o Supabase local: o webhook da
// Hotmart de verdade (a rota, o adaptador, a regra de acesso de sempre e o passo da Licenca), sobre o banco em memoria
// (tests/support/vendas-banco-em-memoria.mjs), com a API interna do Emissor configurada de verdade (EMISSOR_INTERNO_URL e
// EMISSOR_INTERNO_CREDENCIAL) apontando para a API falsa por HTTP (tests/support/emissor-interno-falso.mjs, que responde
// pelo simulador do produto). Aqui:
// - so a venda de um produto marcado como Bunker Members (ou de um pacote que o inclui) entra na fila; o acesso nasce como
//   sempre, e a tarefa `licencas-vendas` envia ao Emissor com a conta do comprador, lida na hora;
// - a mesma venda nunca entra duas vezes (o reenvio, o fim da garantia, o Reprocessar), e o Emissor e idempotente;
// - o Emissor fora do ar so atrasa (espera crescente, e a rodada para na primeira falha); a credencial errada espera meia
//   hora; o produto que o Emissor nao conhece fica tentando, com o erro, ate o produtor cadastrar o codigo; o que tentar
//   de novo nao resolve fica parado;
// - reembolso e chargeback viram o desfazer; a venda que nunca chegou ao Emissor sai dispensada junto, sem pedido; a que
//   ficou em duvida recebe o desfazer, e sai dispensada quando ele e aceito;
// - sem a configuracao, nada le nem grava nas tabelas novas; sem a migracao, a venda passa como antes.

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/server/db/supabase/client") {
      const fonte = `
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return true; }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(fonte)}` };
    }

    return nextResolve(specifier, context);
  }
});

const route = await import("../src/app/api/webhooks/hotmart/route.ts");
const { hashSalesSecret } = await import("../src/server/payments/secret.ts");
const { reprocessWebhookEvent } = await import("../src/server/payments/webhook-handler.ts");
const { licenseSalesJob } = await import("../src/server/jobs/license-sales-job.ts");
const { runLicenseRequestsRound } = await import("../src/server/licensing/interno/requests-tick.ts");
const { getSellerFeatures } = await import("../src/server/licensing/interno/seller.ts");
const { createInternalEmissorSimulator } = await import("../src/server/licensing/interno/simulator.ts");
const { createHttpInternalEmissor } = await import("../src/server/licensing/interno/http-client.ts");
const store = await import("../src/server/licensing/interno/requests-store.ts");

const TOKEN = "hottok-licencas-0123456789abcdef";
const SITE = "https://membros.escola.test";
const ONTEM = "2026-11-10T12:00:00.000Z";

// O mapa de produtos do Emissor (o simulador o le por referencia: o teste "cadastra" o codigo mexendo nele).
const MAPA = { 8001: "licenca_anual", 8003: "licenca_anual", 8004: "licenca_vitalicia" };
let simulador;
let falso;

before(async () => {
  simulador = createInternalEmissorSimulator({ products: MAPA });
  falso = await apiInternaFalsa({ simulador });
});

after(async () => {
  await falso.fechar();
});

function configurar() {
  process.env.EMISSOR_INTERNO_URL = falso.endereco;
  process.env.EMISSOR_INTERNO_CREDENCIAL = CREDENCIAL_DE_TESTE;
}

function desconfigurar() {
  delete process.env.EMISSOR_INTERNO_URL;
  delete process.env.EMISSOR_INTERNO_CREDENCIAL;
  delete process.env.EMISSOR_INTERNO_SIMULADOR;
}

beforeEach(() => {
  delete process.env.BUNKER_LICENSING_MODE;
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  configurar();
  falso.proximas.length = 0;
  falso.pedidos.length = 0;
});

/**
 * A nossa escola: o curso Bunker Members (marcado) ligado ao 8001, o Pacote vitalicio com o curso no 8004, um curso comum
 * no 8002 e o 8003, um codigo que o Emissor conhece ligado ao curso marcado por um pacote, so para a venda de duas linhas.
 */
function escola({ ausentes = [], marcados = ["curso-bm"] } = {}) {
  return bancoEmMemoria({
    ausentes,
    tabelas: {
      content_items: [
        { id: "curso-bm", image: null, kind: "Curso", title: "Bunker Members" },
        { id: "curso-a", image: null, kind: "Curso", title: "Curso A" }
      ],
      integration_settings: [{ provider: "hotmart", secret: hashSalesSecret(TOKEN), secret_status: "set", status: "configured" }],
      license_products: marcados.map((product_id) => ({ created_at: ONTEM, product_id })),
      product_combo_items: [
        { combo_id: "pacote-vitalicia", product_id: "curso-bm", sort_order: 0 },
        { combo_id: "pacote-vitalicia", product_id: "curso-a", sort_order: 1 }
      ],
      product_combos: [{ id: "pacote-vitalicia", name: "Bunker Members vitalícia", status: "active" }],
      profiles: [],
      sales_product_links: [
        { combo_id: null, external_product_id: "8001", product_id: "curso-bm", provider: "hotmart" },
        { combo_id: null, external_product_id: "8002", product_id: "curso-a", provider: "hotmart" },
        { combo_id: "pacote-vitalicia", external_product_id: "8004", product_id: null, provider: "hotmart" }
      ]
    }
  });
}

/** Payload ficticio do webhook 2.0 da Hotmart. */
function aviso({ email = "compradora@teste.test", evento = "PURCHASE_APPROVED", id, nome = "Compradora de Teste", produto = "8001", transacao }) {
  return {
    creation_date: Date.parse("2026-11-11T12:00:00.000Z"),
    data: {
      buyer: { email, name: nome },
      product: { id: Number(produto), name: `Produto ${produto}` },
      purchase: {
        approved_date: Date.parse("2026-11-11T12:00:00.000Z"),
        order_date: Date.parse("2026-11-11T11:59:00.000Z"),
        price: { currency_value: "BRL", value: 997 },
        status: "APPROVED",
        transaction: transacao,
        warranty_expire_date: Date.parse("2026-11-18T12:00:00.000Z")
      }
    },
    event: evento,
    id,
    version: "2.0.0"
  };
}

async function postar(corpo) {
  const resposta = await route.POST(
    new Request(`${SITE}/api/webhooks/hotmart`, {
      body: JSON.stringify(corpo),
      headers: { "content-type": "application/json", host: "membros.escola.test", "x-hotmart-hottok": TOKEN },
      method: "POST"
    })
  );

  return { corpo: await resposta.json(), status: resposta.status };
}

const pedidosNaFila = (db) => db.linhas("license_requests");
const contaDe = (db, email) => [...db.contas.values()].find((conta) => conta.email === email) ?? null;
const evento = (db, id) => db.linhas("webhook_events").find((linha) => linha.external_event_id === id);
const tocouLicencas = (db) => db.chamadas.some((chamada) => chamada.tabela === "license_products" || chamada.tabela === "license_requests");
const pedidosAoEmissor = (caminho) => falso.pedidos.filter((pedido) => pedido.caminho === caminho);
const contexto = (db) => ({ runId: "r", signal: new AbortController().signal, supabase: db, tickRunId: "t", tickStartedAt: new Date() });

async function rodada(db, extra = {}) {
  const vendedor = await getSellerFeatures();
  return runLicenseRequestsRound({ client: vendedor.client, db, ...extra });
}

/* ------------------------------------------------------------------------------------------------
 * A venda
 * ---------------------------------------------------------------------------------------------- */

test("a venda do Bunker Members libera o acesso como sempre e entra na fila; a tarefa a envia com a conta do comprador", async () => {
  const db = escola();
  actionStubs.db = db;

  const resposta = await postar(aviso({ id: "ev-1", transacao: "HP-1" }));

  assert.equal(resposta.status, 200);
  assert.equal(resposta.corpo.outcome, "access_granted");
  const conta = contaDe(db, "compradora@teste.test");
  assert.ok(conta, "a conta nasce pela regra de sempre");
  assert.equal(db.linhas("entitlements").filter((linha) => linha.user_id === conta.id && linha.target_id === "curso-bm").length, 1);
  assert.equal(db.linhas("email_outbox").filter((linha) => linha.kind === "welcome").length, 1, "o e-mail de boas-vindas com o login, como em qualquer curso");
  assert.match(evento(db, "ev-1").outcome_detail, /Licença do Bunker Members pedida ao Emissor \(fila\)\.$/);

  const [pedido] = pedidosNaFila(db);
  assert.equal(pedidosNaFila(db).length, 1);
  assert.equal(pedido.kind, "venda");
  assert.equal(pedido.status, "pendente");
  assert.equal(pedido.request_key, "venda:hotmart:HP-1:8001");
  assert.equal(pedido.user_id, conta.id);
  assert.equal(pedido.purchased_at, "2026-11-11T12:00:00.000Z");
  assert.equal(pedido.warranty_ends_at, "2026-11-18T12:00:00.000Z");
  assert.equal(pedido.webhook_event_id, evento(db, "ev-1").id);
  assert.doesNotMatch(JSON.stringify(pedido), /compradora@teste\.test|Compradora de Teste/, "nenhum dado pessoal na fila");
  assert.equal(pedidosAoEmissor("/interno/v1/vendas").length, 0, "o webhook so enfileira: quem fala com o Emissor e a tarefa");

  await licenseSalesJob.run(contexto(db));

  const [chegou] = pedidosAoEmissor("/interno/v1/vendas");
  assert.equal(chegou.credencialCerta, true);
  assert.equal(chegou.xPedido, pedido.id, "o X-Pedido e o id do item da fila");
  assert.deepEqual(chegou.corpo, {
    comprador: { areaUserId: conta.id, email: "compradora@teste.test", nome: "Compradora de Teste" },
    compradoEm: "2026-11-11T12:00:00.000Z",
    garantiaAte: "2026-11-18T12:00:00.000Z",
    plataforma: "hotmart",
    produto: "8001",
    transacao: "HP-1"
  });
  assert.equal(pedido.status, "enviado");
  assert.equal(pedido.attempts, 1);
  assert.match(pedido.resolution, /^Aplicada no Emissor \(lic_sim\d+\)\.$/);
  assert.ok(simulador.inspect().licenses.some((licenca) => licenca.owner === conta.id && licenca.kind === "anual"));
});

test("só vai ao Emissor a venda de produto marcado (ou de pacote que o inclui); o curso comum nunca", async () => {
  const db = escola();
  actionStubs.db = db;

  await postar(aviso({ id: "ev-curso", produto: "8002", transacao: "HP-CURSO" }));
  assert.equal(pedidosNaFila(db).length, 0, "o curso comum nao vira pedido");

  await postar(aviso({ email: "outra@teste.test", id: "ev-pacote", nome: "Outra", produto: "8004", transacao: "HP-PACOTE" }));
  assert.deepEqual(
    pedidosNaFila(db).map((linha) => linha.request_key),
    ["venda:hotmart:HP-PACOTE:8004"],
    "o pacote que inclui o curso marcado vai com o codigo do pacote (o Emissor sabe que e a vitalicia)"
  );

  await licenseSalesJob.run(contexto(db));
  const conta = contaDe(db, "outra@teste.test");
  assert.ok(simulador.inspect().licenses.some((licenca) => licenca.owner === conta.id && licenca.kind === "vitalicia"));

  // Sem produto marcado (o produtor desmarcou), nada entra.
  const semMarca = escola({ marcados: [] });
  actionStubs.db = semMarca;
  await postar(aviso({ id: "ev-desmarcado", transacao: "HP-DESMARCADO" }));
  assert.equal(pedidosNaFila(semMarca).length, 0);
});

test("a mesma venda nunca entra duas vezes: o reenvio, o fim da garantia e o Reprocessar; e o Emissor não cria outra Licença", async () => {
  const db = escola();
  actionStubs.db = db;
  const licencasAntes = simulador.inspect().licenses.length;

  await postar(aviso({ id: "ev-idem", transacao: "HP-IDEM" }));
  assert.equal((await postar(aviso({ id: "ev-idem", transacao: "HP-IDEM" }))).corpo.duplicate, true);
  await postar(aviso({ evento: "PURCHASE_COMPLETE", id: "ev-idem-garantia", transacao: "HP-IDEM" }));
  await reprocessWebhookEvent(db, { id: evento(db, "ev-idem-garantia").id, siteOrigin: SITE }).catch(() => null);

  assert.equal(pedidosNaFila(db).length, 1);
  assert.match(evento(db, "ev-idem-garantia").outcome_detail ?? "", /Licença do Bunker Members já estava pedida\.|^Fim da garantia/);

  await licenseSalesJob.run(contexto(db));
  // A linha volta para a fila (uma resposta perdida no caminho): o Emissor devolve a mesma Licenca.
  Object.assign(pedidosNaFila(db)[0], { next_attempt_at: new Date(0).toISOString(), sent_at: null, status: "pendente" });
  await licenseSalesJob.run(contexto(db));

  assert.equal(pedidosAoEmissor("/interno/v1/vendas").length, 2);
  assert.match(pedidosNaFila(db)[0].resolution, /^Já estava aplicada no Emissor/);
  assert.equal(simulador.inspect().licenses.length, licencasAntes + 1, "uma Licenca so");
});

/* ------------------------------------------------------------------------------------------------
 * O Emissor fora do ar, a credencial errada, o produto desconhecido e o pedido parado
 * ---------------------------------------------------------------------------------------------- */

test("Emissor fora do ar: a venda espera e volta sozinha, com espera crescente; a rodada para na primeira falha", async () => {
  const db = escola();
  actionStubs.db = db;
  await postar(aviso({ id: "ev-f1", transacao: "HP-F1" }));
  await postar(aviso({ email: "segunda@teste.test", id: "ev-f2", nome: "Segunda", transacao: "HP-F2" }));
  const [primeira, segunda] = pedidosNaFila(db);
  const agora = new Date();

  falso.proximas.push({ status: 503, texto: "" });
  const fora = await rodada(db, { now: () => agora });

  assert.deepEqual([fora.sent, fora.failed, fora.interrupted], [0, 1, true]);
  assert.equal(primeira.status, "pendente");
  assert.equal(primeira.attempts, 1);
  assert.equal(primeira.last_error_code, "indisponivel");
  assert.match(primeira.last_error, /O Emissor está com problema agora/);
  assert.equal(primeira.maybe_delivered, true, "o 503 deixa a duvida");
  assert.equal(Date.parse(primeira.next_attempt_at) - agora.getTime(), 60_000, "a primeira espera: 1 minuto");
  assert.equal(segunda.attempts, 0, "a rodada parou: a segunda nem saiu");

  // Sem resposta (tempo esgotado): a que esta na vez antes (a segunda, que nunca saiu) fica para depois, e a rodada para.
  const lento = createHttpInternalEmissor({ baseUrl: `${falso.endereco}/interno/v1`, credential: CREDENCIAL_DE_TESTE, timeoutMs: 100 });
  falso.proximas.push({ caminho: "/interno/v1/vendas", nuncaResponder: true });
  const depois = new Date(agora.getTime() + 61_000);
  const semResposta = await runLicenseRequestsRound({ client: lento, db, now: () => depois });
  assert.deepEqual([semResposta.failed, semResposta.interrupted], [1, true]);
  assert.deepEqual([segunda.attempts, segunda.last_error_code, segunda.maybe_delivered], [1, "sem_resposta", true]);
  assert.equal(primeira.attempts, 1, "a rodada parou antes dela");

  // A segunda falha da mesma linha espera mais: 5 minutos.
  falso.proximas.push({ status: 503, texto: "" });
  const maisTarde = new Date(agora.getTime() + 62_000);
  await rodada(db, { now: () => maisTarde });
  assert.equal(primeira.attempts, 2);
  assert.equal(Date.parse(primeira.next_attempt_at) - maisTarde.getTime(), 5 * 60_000, "a segunda espera: 5 minutos");
  assert.equal(segunda.attempts, 1, "a segunda ainda esta na espera dela");

  // O Emissor volta: as duas saem.
  const volta = await rodada(db, { now: () => new Date(agora.getTime() + 10 * 60_000) });
  assert.equal(volta.sent, 2);
  assert.deepEqual([primeira.status, segunda.status], ["enviado", "enviado"]);
});

test("credencial errada: a rodada para e a fila espera meia hora (o Emissor bloqueia o IP depois de 20 erradas)", async () => {
  const db = escola();
  actionStubs.db = db;
  await postar(aviso({ id: "ev-c1", transacao: "HP-C1" }));
  await postar(aviso({ email: "c2@teste.test", id: "ev-c2", nome: "C2", transacao: "HP-C2" }));
  process.env.EMISSOR_INTERNO_CREDENCIAL = "bki_credencial-errada-0123456789abcdefghijklmnop";
  const agora = new Date();

  const resultado = await rodada(db, { now: () => agora });

  assert.deepEqual([resultado.failed, resultado.interrupted, resultado.errors], [1, true, ["credencial_invalida"]]);
  const [primeira, segunda] = pedidosNaFila(db);
  assert.equal(Date.parse(primeira.next_attempt_at) - agora.getTime(), 30 * 60_000);
  assert.equal(primeira.maybe_delivered, false, "a credencial recusada prova que nada foi gravado");
  assert.match(primeira.last_error, /EMISSOR_INTERNO_CREDENCIAL/);
  assert.equal(segunda.attempts, 0);
  assert.equal(pedidosAoEmissor("/interno/v1/vendas").length, 1, "um pedido so com a credencial errada");
});

test("produto que o Emissor não conhece: fica na fila com o erro, tenta de novo e sai quando o produtor cadastra o código", async () => {
  const db = escola();
  actionStubs.db = db;
  db.linhas("sales_product_links").push({ combo_id: null, external_product_id: "8009", product_id: "curso-bm", provider: "hotmart" });
  db.linhas("sales_product_links").splice(db.linhas("sales_product_links").findIndex((link) => link.external_product_id === "8001"), 1);
  await postar(aviso({ id: "ev-desconhecido", produto: "8009", transacao: "HP-D" }));
  const [pedido] = pedidosNaFila(db);
  let agora = new Date();

  for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
    const resultado = await rodada(db, { now: () => agora });
    assert.deepEqual([resultado.failed, resultado.interrupted], [1, false], `tentativa ${tentativa}: segue a rodada`);
    assert.equal(pedido.status, "pendente");
    assert.equal(pedido.last_error_code, "produto_desconhecido");
    assert.match(pedido.last_error, /Cadastre o código no Painel de licenças/);
    agora = new Date(Date.parse(pedido.next_attempt_at) + 1000);
  }

  assert.equal(pedido.maybe_delivered, false, "o 422 prova que o Emissor nao aplicou");
  MAPA[8009] = "licenca_anual";

  const cadastrado = await rodada(db, { now: () => agora });
  assert.equal(cadastrado.sent, 1);
  assert.equal(pedido.status, "enviado");
  assert.equal(pedido.attempts, 4);
});

test("o que tentar de novo não resolve fica parado; Tentar agora devolve à fila e Dispensar tira", async () => {
  const db = escola();
  actionStubs.db = db;
  await postar(aviso({ id: "ev-p", transacao: "HP-P" }));
  const [pedido] = pedidosNaFila(db);

  falso.proximas.push({ corpo: { erro: "licenca_ambigua", licencas: [], mensagem: "Escolha." }, status: 422 });
  const resultado = await rodada(db);
  assert.deepEqual([resultado.stopped, resultado.failed], [1, 0]);
  assert.equal(pedido.status, "parado");
  assert.match(pedido.last_error, /Aplique pelo Painel de licenças \(Aplicar compra\)/);
  assert.equal((await rodada(db, { now: () => new Date(Date.now() + 86_400_000) })).sent, 0, "parado nao sai sozinho");

  assert.equal(await store.retryLicenseRequestNow(db, { id: pedido.id, now: new Date() }), true);
  assert.equal(pedido.status, "pendente");
  assert.equal((await rodada(db)).sent, 1);

  // Dispensar so vale para o que nao saiu.
  assert.equal(await store.dismissLicenseRequestByTeam(db, { id: pedido.id }), false);
  await postar(aviso({ email: "d@teste.test", id: "ev-p2", nome: "D", transacao: "HP-P2" }));
  const segundo = pedidosNaFila(db)[1];
  assert.equal(await store.dismissLicenseRequestByTeam(db, { id: segundo.id }), true);
  assert.equal(segundo.status, "dispensado");
  assert.equal(segundo.resolution, "Dispensado pela equipe.");

  // A conta do comprador que sumiu: parado, com a frase.
  await postar(aviso({ email: "e@teste.test", id: "ev-p3", nome: "E", transacao: "HP-P3" }));
  const terceiro = pedidosNaFila(db)[2];
  terceiro.user_id = null;
  await rodada(db);
  assert.deepEqual([terceiro.status, terceiro.last_error_code], ["parado", "sem_conta"]);
});

/* ------------------------------------------------------------------------------------------------
 * Reembolso e chargeback
 * ---------------------------------------------------------------------------------------------- */

test("reembolso depois da venda enviada: o desfazer vai ao Emissor e a Licença é revogada; o chargeback depois é outro pedido", async () => {
  const db = escola();
  actionStubs.db = db;
  await postar(aviso({ id: "ev-r", transacao: "HP-R" }));
  await licenseSalesJob.run(contexto(db));
  const conta = contaDe(db, "compradora@teste.test");

  const reembolso = await postar(aviso({ evento: "PURCHASE_REFUNDED", id: "ev-r-reembolso", transacao: "HP-R" }));
  assert.equal(reembolso.corpo.outcome, "access_revoked", "o acesso sai como sempre");
  assert.match(evento(db, "ev-r-reembolso").outcome_detail, /Licença do Bunker Members: reembolso pedido ao Emissor \(fila\)\.$/);

  const desfazer = pedidosNaFila(db).find((linha) => linha.kind === "desfazer");
  assert.equal(desfazer.request_key, "desfazer:reembolso:hotmart:HP-R:8001");
  assert.equal(desfazer.status, "pendente");

  await licenseSalesJob.run(contexto(db));
  const [chegou] = pedidosAoEmissor("/interno/v1/vendas/desfazer");
  assert.deepEqual(Object.keys(chegou.corpo).sort(), ["em", "motivo", "plataforma", "produto", "transacao"]);
  assert.equal(chegou.corpo.motivo, "reembolso");
  assert.equal(desfazer.status, "enviado");
  assert.match(desfazer.resolution, /^Desfeita no Emissor \(reembolso\)/);
  assert.ok(simulador.inspect().licenses.filter((licenca) => licenca.owner === conta.id).every((licenca) => licenca.status === "revogada"));

  await postar(aviso({ evento: "PURCHASE_CHARGEBACK", id: "ev-r-chargeback", transacao: "HP-R" }));
  assert.deepEqual(
    pedidosNaFila(db).filter((linha) => linha.kind === "desfazer").map((linha) => linha.reason),
    ["reembolso", "chargeback"]
  );
  await postar(aviso({ evento: "PURCHASE_CHARGEBACK", id: "ev-r-chargeback-2", transacao: "HP-R" }));
  assert.equal(pedidosNaFila(db).filter((linha) => linha.kind === "desfazer").length, 2, "o mesmo motivo nunca entra duas vezes");
});

test("reembolso antes de a venda chegar ao Emissor: as duas saem dispensadas e nada vai ao Emissor", async () => {
  const db = escola();
  actionStubs.db = db;
  await postar(aviso({ id: "ev-a", transacao: "HP-A" }));
  await postar(aviso({ evento: "PURCHASE_REFUNDED", id: "ev-a-reembolso", transacao: "HP-A" }));

  const [venda, desfazer] = pedidosNaFila(db);
  assert.deepEqual([venda.status, venda.resolution], ["dispensado", "Desfeita antes de chegar ao Emissor: nada foi enviado."]);
  assert.deepEqual([desfazer.kind, desfazer.status, desfazer.resolution], ["desfazer", "dispensado", "A venda não chegou ao Emissor: nada a desfazer."]);
  assert.match(evento(db, "ev-a-reembolso").outcome_detail, /a venda ainda não tinha chegado ao Emissor; nada a desfazer\.$/);

  await licenseSalesJob.run(contexto(db));
  assert.equal(falso.pedidos.length, 0);

  // O mesmo vale para a venda parada por uma recusa que prova que o Emissor nao gravou.
  await postar(aviso({ email: "p@teste.test", id: "ev-b", nome: "P", transacao: "HP-B" }));
  falso.proximas.push({ corpo: { erro: "quantidade_invalida", mensagem: "x" }, status: 422 });
  await rodada(db);
  await postar(aviso({ email: "p@teste.test", evento: "PURCHASE_CHARGEBACK", id: "ev-b-cb", nome: "P", transacao: "HP-B" }));
  assert.deepEqual(
    pedidosNaFila(db).filter((linha) => linha.transaction_id === "HP-B").map((linha) => [linha.kind, linha.status]),
    [["venda", "dispensado"], ["desfazer", "dispensado"]]
  );
});

test("reembolso com a venda em dúvida (sem resposta): o desfazer vai já, o Emissor guarda a marca e a venda sai dispensada", async () => {
  const db = escola();
  actionStubs.db = db;
  await postar(aviso({ id: "ev-d", transacao: "HP-DUVIDA" }));
  falso.proximas.push({ status: 502, texto: "" });
  await rodada(db);
  const [venda] = pedidosNaFila(db);
  assert.deepEqual([venda.status, venda.maybe_delivered], ["pendente", true]);

  await postar(aviso({ evento: "PURCHASE_REFUNDED", id: "ev-d-reembolso", transacao: "HP-DUVIDA" }));
  const desfazer = pedidosNaFila(db).find((linha) => linha.kind === "desfazer");
  assert.equal(desfazer.status, "pendente", "a venda pode ter chegado: o Emissor precisa saber");

  const resultado = await rodada(db);
  assert.equal(resultado.sent, 1, "so o desfazer: a venda ainda esta na espera");
  assert.match(desfazer.resolution, /O Emissor ainda não tinha esta venda: guardou o reembolso/);
  assert.deepEqual([venda.status, venda.resolution], ["dispensado", "Desfeita: o Emissor recebeu o desfazer desta venda."]);
  assert.deepEqual(simulador.inspect().sales.find((venda) => venda.key === "hotmart:HP-DUVIDA:8001"), { key: "hotmart:HP-DUVIDA:8001", licenseIds: [], undone: "reembolso" });
});

/* ------------------------------------------------------------------------------------------------
 * O acesso igual, desligado e sem a migracao
 * ---------------------------------------------------------------------------------------------- */

test("o acesso não muda: a mesma venda dá o mesmo resultado com a API interna e sem ela", async () => {
  const comApi = escola();
  actionStubs.db = comApi;
  const com = await postar(aviso({ id: "ev-igual", transacao: "HP-IGUAL" }));

  desconfigurar();
  const semApi = escola();
  actionStubs.db = semApi;
  const sem = await postar(aviso({ id: "ev-igual", transacao: "HP-IGUAL" }));

  const VARIAM = new Set(["id", "user_id", "created_at", "starts_at", "updated_at"]);
  const acessos = (db) => db.linhas("entitlements").map((linha) => Object.fromEntries(Object.entries(linha).filter(([coluna]) => !VARIAM.has(coluna))));
  const emails = (db) => db.linhas("email_outbox").map((linha) => [linha.kind, linha.to_email]);

  assert.deepEqual([com.status, com.corpo.outcome], [sem.status, sem.corpo.outcome]);
  assert.deepEqual(acessos(comApi), acessos(semApi));
  assert.deepEqual(emails(comApi), emails(semApi));
  assert.equal(evento(comApi, "ev-igual").outcome_detail, `${evento(semApi, "ev-igual").outcome_detail} Licença do Bunker Members pedida ao Emissor (fila).`);
});

test("desligado (sem a configuração, ou o simulador na produção): nada lê nem grava as tabelas novas, e a tarefa nem lê o banco", async () => {
  for (const ambiente of [{}, { EMISSOR_INTERNO_SIMULADOR: "on", NODE_ENV: "production" }, { EMISSOR_INTERNO_URL: "http://emissor.test" }]) {
    desconfigurar();
    const nodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, ambiente);
    const db = escola();
    actionStubs.db = db;

    try {
      const resposta = await postar(aviso({ id: "ev-off", transacao: "HP-OFF" }));
      await postar(aviso({ evento: "PURCHASE_REFUNDED", id: "ev-off-reembolso", transacao: "HP-OFF" }));
      assert.equal(resposta.corpo.outcome, "access_granted", JSON.stringify(ambiente));
      assert.equal(tocouLicencas(db), false, `${JSON.stringify(ambiente)}: nada lido nem gravado`);
      assert.doesNotMatch(evento(db, "ev-off").outcome_detail, /Licença/);

      const chamadasAntes = db.chamadas.length;
      await licenseSalesJob.run(contexto(db));
      assert.equal(db.chamadas.length, chamadasAntes, "a tarefa nao le o banco");
      assert.equal(falso.pedidos.length, 0);
    } finally {
      if (nodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = nodeEnv;
      }
    }
  }
});

test("o modo enforce sem a chave interna seller-pages: a cópia do comprador com a variável copiada continua sem nada de vendedor", async () => {
  process.env.BUNKER_LICENSING_MODE = "enforce";
  const db = escola();
  actionStubs.db = db;

  // A situacao da licenca nao pode ser lida aqui (sem license_state): fecha, e a chave interna nunca liga.
  const vendedor = await getSellerFeatures();
  assert.deepEqual([vendedor.enabled, vendedor.reason], [false, "sem_chave_interna"]);
  await licenseSalesJob.run(contexto(db));
  assert.equal(tocouLicencas(db), false);
});

test("banco sem a migração 202611130001: a venda passa como antes, sem erro, e a tarefa termina sem erro", async () => {
  const db = escola({ ausentes: ["license_products", "license_requests"] });
  actionStubs.db = db;

  const resposta = await postar(aviso({ id: "ev-sem-migracao", transacao: "HP-SM" }));
  assert.deepEqual([resposta.status, resposta.corpo.outcome], [200, "access_granted"]);
  assert.equal(evento(db, "ev-sem-migracao").processing_status, "processed");

  await licenseSalesJob.run(contexto(db));
});

test("erro do banco ao enfileirar: a venda fica com erro (Reprocessar), com o acesso já liberado; o Reprocessar enfileira", async () => {
  const db = escola();
  actionStubs.db = db;
  const from = db.from.bind(db);
  let falhar = true;
  db.from = (tabela) => {
    if (tabela === "license_requests" && falhar) {
      const quebrado = {
        insert: () => quebrado,
        select: () => quebrado,
        single: async () => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } })
      };
      return quebrado;
    }

    return from(tabela);
  };

  const resposta = await postar(aviso({ id: "ev-erro", transacao: "HP-ERRO" }));
  assert.equal(resposta.status, 500, "a plataforma sabe que algo falhou");
  const linha = evento(db, "ev-erro");
  assert.equal(linha.processing_status, "failed");
  assert.match(linha.error_message, /^O acesso foi liberado, mas o pedido da Licença do Bunker Members não entrou na fila \(.*\)\. Use Reprocessar\.$/);
  assert.equal(db.linhas("entitlements").length, 1, "o acesso ficou liberado");

  falhar = false;
  const reprocesso = await reprocessWebhookEvent(db, { id: linha.id, siteOrigin: SITE });
  assert.equal(reprocesso.ok, true);
  assert.equal(pedidosNaFila(db).length, 1);
  assert.equal(db.linhas("entitlements").length, 1, "o Reprocessar nao duplica o acesso");
});
