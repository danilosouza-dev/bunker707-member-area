import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test, { beforeEach } from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import "./support/transpile-tsx.mjs";
import { bancoEmMemoria } from "./support/vendas-banco-em-memoria.mjs";

// Prazo de acesso por curso e "todas as formacoes" (docs/05; docs/17 §1.6.10), de ponta a ponta sem o Supabase local:
// o webhook da Hotmart de verdade (a rota, o adaptador, a regra de acesso e a fila de e-mail) sobre um banco em memoria
// (tests/support/vendas-banco-em-memoria.mjs). Aqui:
// - a venda do pacote da a cada curso o prazo do item dele; o produto sozinho, o prazo do codigo de venda;
// - compra repetida soma ao termino de quem ainda tem acesso; quem venceu conta da compra; "para sempre" vence;
// - o reembolso da compra que somou devolve o termino de antes, tambem quando a reembolsada e a mais antiga;
// - a mesma compra processada de novo nao soma duas vezes;
// - "todas as formacoes": as formacoes publicadas entram com o prazo do item e a turma do pacote fica na concessao; a
//   formacao publicada depois entra sozinha, com o mesmo termino; mentoria e curso avulso ficam de fora; o reembolso
//   tira o que ela abriu sem tirar o que o aluno tem por outra compra, e depois dele nada novo entra;
// - o curso vencido fecha so ele: o catalogo que o servidor autoriza continua com os outros cursos;
// - a importacao de alunos grava o termino de cada produto (data, vitalicio ou o "Acesso até" do lote).

/** O modulo de src/ que um import pede, pelo alias ou por caminho relativo. */
function moduloDeSrc(specifier, context) {
  if (specifier.startsWith("@/")) {
    return specifier.slice(2);
  }

  if (/^\.{1,2}\//.test(specifier) && context.parentURL) {
    const url = new URL(specifier, context.parentURL).href;
    const index = url.indexOf("/src/");
    return index === -1 ? null : url.slice(index + 5).replace(/\.tsx?$/, "");
  }

  return null;
}

const stub = (source) => ({ shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` });

registerHooks({
  resolve(specifier, context, nextResolve) {
    const modulo = moduloDeSrc(specifier, context);

    if (modulo === "server/licensing/current-state") {
      return stub(`
        export async function getCurrentLicenseState() { return { mode: "off" }; }
        export const readCurrentLicenseState = getCurrentLicenseState;
        export function forgetLicenseStateMemory() {}`);
    }

    if (modulo === "server/db/supabase/client") {
      return stub(`
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return true; }`);
    }

    return nextResolve(specifier, context);
  }
});

const route = await import("../src/app/api/webhooks/hotmart/route.ts");
const { hashSalesSecret } = await import("../src/server/payments/secret.ts");
const { getPaymentAdapter } = await import("../src/server/payments/adapters.ts");
const { processSaleEvent } = await import("../src/server/payments/process-sale.ts");
const { materializeAllFormations } = await import("../src/server/payments/all-formations.ts");
const { allFormationsJob, ALL_FORMATIONS_JOB_NAME } = await import("../src/server/jobs/all-formations-job.ts");
const { importStudentRow, groupImportProductsByEnd } = await import("../src/server/students/access.ts");
const { resolveAuthorizedLearningCatalog } = await import("../src/server/access/learning-catalog.ts");
const term = await import("../src/server/access/access-term.ts");
const { AccessEndedNotice } = await import("../src/components/member/access-ended-notice.tsx");
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");

const TOKEN = "hottok-prazo-0123456789abcdef";
const SITE = "https://alunos.escola.test";
const ALUNA = "compradora@teste.test";
const ANO = { amount: 1, unit: "years" };
const DIA = 86_400_000;

/**
 * A escola: duas formacoes publicadas, uma em rascunho, uma mentoria, dois cursos; o pacote Black (curso A para
 * sempre, curso B por 1 ano), o pacote Tudo (todas as formacoes por 1 ano, turma Black 2026) e os codigos da Hotmart:
 * curso A sozinho (para sempre), curso B sozinho (1 ano), formacao A sozinha (6 meses), curso B vitalicio em pacote.
 */
function escola() {
  const produto = (id, kind, title, extra = {}) => ({ access_model: "closed", commerce_scope: "sellable_product", id, image: null, is_locked: true, kind, publication_status: "published", release_rule: null, sort_order: 0, title, ...extra });

  return bancoEmMemoria({
    tabelas: {
      content_items: [
        produto("formacao-a", "Formacao", "Formação A"),
        produto("formacao-b", "Formacao", "Formação B"),
        produto("formacao-nova", "Formacao", "Formação Nova", { publication_status: "draft" }),
        produto("mentoria-x", "Mentoria", "Mentoria X"),
        produto("curso-a", "Curso", "Curso A"),
        produto("curso-b", "Curso", "Curso B")
      ],
      integration_settings: [{ provider: "hotmart", secret: hashSalesSecret(TOKEN), secret_status: "set", status: "configured" }],
      product_combo_items: [
        { access_amount: null, access_unit: null, combo_id: "pacote-black", product_id: "curso-a", sort_order: 0 },
        { access_amount: 1, access_unit: "years", combo_id: "pacote-black", product_id: "curso-b", sort_order: 1 },
        { access_amount: null, access_unit: null, combo_id: "pacote-vitalicio", product_id: "curso-b", sort_order: 0 }
      ],
      product_combos: [
        { all_formations: false, all_formations_amount: null, all_formations_unit: null, cohort_name: "Black 2026", id: "pacote-black", name: "Black Friday", status: "active" },
        { all_formations: false, all_formations_amount: null, all_formations_unit: null, cohort_name: "Turma A", id: "pacote-vitalicio", name: "Curso B para sempre", status: "active" },
        { all_formations: true, all_formations_amount: 1, all_formations_unit: "years", cohort_name: "Black 2026", id: "pacote-tudo", name: "Acesso total", status: "active" }
      ],
      sales_product_links: [
        { access_amount: null, access_unit: null, combo_id: null, external_product_id: "7001", product_id: "curso-a", provider: "hotmart" },
        { access_amount: 1, access_unit: "years", combo_id: null, external_product_id: "8001", product_id: "curso-b", provider: "hotmart" },
        { access_amount: 6, access_unit: "months", combo_id: null, external_product_id: "9001", product_id: "formacao-a", provider: "hotmart" },
        { access_amount: null, access_unit: null, combo_id: "pacote-black", external_product_id: "7002", product_id: null, provider: "hotmart" },
        { access_amount: null, access_unit: null, combo_id: "pacote-vitalicio", external_product_id: "7009", product_id: null, provider: "hotmart" },
        { access_amount: null, access_unit: null, combo_id: "pacote-tudo", external_product_id: "7005", product_id: null, provider: "hotmart" }
      ]
    }
  });
}

/** Payload ficticio do webhook 2.0 da Hotmart. `aprovadaEm`: a data da compra aprovada (ms). */
function compra({ aprovadaEm = Date.now() - 60_000, email = ALUNA, evento = "PURCHASE_APPROVED", id, produto, transacao }) {
  return {
    creation_date: Date.now(),
    data: {
      buyer: { email, name: "Compradora de Teste" },
      product: { id: Number(produto), name: `Produto ${produto}` },
      purchase: { approved_date: aprovadaEm, order_date: aprovadaEm, price: { currency_value: "BRL", value: 497 }, status: "APPROVED", transaction: transacao }
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
      headers: { "content-type": "application/json", host: "alunos.escola.test", "x-hotmart-hottok": TOKEN },
      method: "POST"
    })
  );

  return { corpo: await resposta.json(), status: resposta.status };
}

const contaDe = (db, email = ALUNA) => [...db.contas.values()].find((conta) => conta.email === email) ?? null;
const acessoDe = (db, produto, email = ALUNA) => db.linhas("entitlements").find((linha) => linha.user_id === contaDe(db, email)?.id && linha.target_id === produto) ?? null;
const vinculosDe = (db, produto) => db.linhas("sale_grants").filter((linha) => linha.product_id === produto);
const evento = (db, id) => db.linhas("webhook_events").find((linha) => linha.external_event_id === id);
const doFimDoDia = (ms, prazo) => term.accessEndFromPurchase(ms, prazo);
const maisPrazo = (isoDate, prazo) => new Date(term.addAccessTerm(Date.parse(isoDate), prazo)).toISOString();

beforeEach(() => {
  delete process.env.BUNKER_LICENSING_MODE;
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  actionStubs.db = escola();
});

/* ------------------------------------------------------------------------------------------------
 * Prazo por item do pacote e no codigo de venda
 * ---------------------------------------------------------------------------------------------- */

test("a venda do pacote dá a cada curso o prazo do item dele: um para sempre, outro por 1 ano a partir da compra", async () => {
  const db = actionStubs.db;
  const aprovadaEm = Date.parse("2026-11-20T13:00:00.000Z");

  const resposta = await postar(compra({ aprovadaEm, id: "ev-black", produto: "7002", transacao: "HP-BLACK" }));

  assert.equal(resposta.status, 200);
  assert.equal(resposta.corpo.outcome, "access_granted");
  assert.equal(acessoDe(db, "curso-a").ends_at, null, "Para sempre");
  assert.equal(acessoDe(db, "curso-b").ends_at, "2027-11-21T02:59:59.999Z", "data da compra aprovada + 1 ano, ate o fim do dia 20/11/2027");
  assert.equal(acessoDe(db, "curso-a").status, "active");
  assert.equal(db.linhas("entitlements").length, 2, "so os dois cursos do pacote");

  // O vinculo da venda guarda o prazo e a data da compra de cada acesso (o reembolso refaz a conta com eles).
  const [vinculoA] = vinculosDe(db, "curso-a");
  const [vinculoB] = vinculosDe(db, "curso-b");
  assert.deepEqual([vinculoA.term_unit, vinculoA.term_amount, vinculoA.opened], [null, null, true]);
  assert.deepEqual([vinculoB.term_unit, vinculoB.term_amount, vinculoB.opened], ["years", 1, true]);
  assert.equal(vinculoB.purchased_at, "2026-11-20T13:00:00.000Z");
});

test("o produto vendido sozinho usa o prazo do código de venda; sem prazo no código, é para sempre como sempre foi", async () => {
  const db = actionStubs.db;
  const aprovadaEm = Date.now() - 60_000;

  assert.equal((await postar(compra({ aprovadaEm, id: "ev-b", produto: "8001", transacao: "HP-B" }))).corpo.outcome, "access_granted");
  assert.equal((await postar(compra({ aprovadaEm, id: "ev-a", produto: "7001", transacao: "HP-A" }))).corpo.outcome, "access_granted");

  assert.equal(acessoDe(db, "curso-b").ends_at, doFimDoDia(aprovadaEm, ANO));
  assert.equal(acessoDe(db, "curso-a").ends_at, null);
});

/* ------------------------------------------------------------------------------------------------
 * Compra repetida soma
 * ---------------------------------------------------------------------------------------------- */

test("compra repetida soma: quem ainda tem 3 meses e compra mais 1 ano fica com 1 ano e 3 meses", async () => {
  const db = actionStubs.db;

  await postar(compra({ id: "ev-1", produto: "8001", transacao: "HP-1" }));
  // Passou o tempo: restam 3 meses do primeiro ano.
  const restam3Meses = new Date(Date.now() + 90 * DIA).toISOString();
  acessoDe(db, "curso-b").ends_at = restam3Meses;

  const segunda = await postar(compra({ id: "ev-2", produto: "8001", transacao: "HP-2" }));

  assert.equal(segunda.corpo.outcome, "access_granted");
  assert.equal(acessoDe(db, "curso-b").ends_at, maisPrazo(restam3Meses, ANO), "o termino atual + o prazo comprado");
  assert.equal(db.linhas("entitlements").length, 1, "continua um acesso so por (aluno, produto)");

  const segundoVinculo = vinculosDe(db, "curso-b").find((linha) => linha.transaction_id === "HP-2");
  assert.equal(segundoVinculo.opened, false, "a segunda compra so somou");
  assert.equal(segundoVinculo.previous_ends_at, restam3Meses, "o termino de antes fica guardado para o reembolso");
});

test("quem já venceu conta a partir da compra, e o acesso volta a valer", async () => {
  const db = actionStubs.db;

  await postar(compra({ id: "ev-1", produto: "8001", transacao: "HP-1" }));
  acessoDe(db, "curso-b").ends_at = new Date(Date.now() - 10 * DIA).toISOString();

  const aprovadaEm = Date.now() - 60_000;
  await postar(compra({ aprovadaEm, id: "ev-2", produto: "8001", transacao: "HP-2" }));

  assert.equal(acessoDe(db, "curso-b").ends_at, doFimDoDia(aprovadaEm, ANO));
  assert.equal(acessoDe(db, "curso-b").status, "active");
  assert.equal(vinculosDe(db, "curso-b").find((linha) => linha.transaction_id === "HP-2").opened, true, "a compra abriu de novo o acesso vencido");
});

test("para sempre vence qualquer prazo, dos dois lados, e nenhuma compra encurta o que o aluno tem", async () => {
  const db = actionStubs.db;

  // Tem 1 ano e compra o pacote em que o curso e para sempre: fica para sempre.
  await postar(compra({ id: "ev-1", produto: "8001", transacao: "HP-1" }));
  assert.notEqual(acessoDe(db, "curso-b").ends_at, null);
  await postar(compra({ id: "ev-2", produto: "7009", transacao: "HP-2" }));
  assert.equal(acessoDe(db, "curso-b").ends_at, null);

  // Ja e para sempre e compra mais 1 ano: continua para sempre.
  await postar(compra({ id: "ev-3", produto: "8001", transacao: "HP-3" }));
  assert.equal(acessoDe(db, "curso-b").ends_at, null);

  // Outra aluna com termino longe: a compra de 1 ano so empurra para a frente.
  const longe = new Date(Date.now() + 900 * DIA).toISOString();
  await postar(compra({ email: "outra@teste.test", id: "ev-4", produto: "8001", transacao: "HP-4" }));
  acessoDe(db, "curso-b", "outra@teste.test").ends_at = longe;
  await postar(compra({ email: "outra@teste.test", id: "ev-5", produto: "8001", transacao: "HP-5" }));
  assert.ok(Date.parse(acessoDe(db, "curso-b", "outra@teste.test").ends_at) > Date.parse(longe));
});

test("a mesma compra processada de novo não soma duas vezes", async () => {
  const db = actionStubs.db;
  const aprovadaEm = Date.now() - 60_000;
  const payload = compra({ aprovadaEm, id: "ev-1", produto: "8001", transacao: "HP-1" });
  const adapter = getPaymentAdapter("hotmart");

  await postar(payload);
  const depoisDaPrimeira = acessoDe(db, "curso-b").ends_at;

  // O reenvio com o mesmo id e barrado pelo evento; o reprocesso (ou outro aviso da mesma compra) passa pela regra.
  assert.equal((await postar(payload)).corpo.duplicate, true);
  const de_novo = await processSaleEvent(db, { event: adapter.normalize(payload), siteOrigin: SITE, webhookEventId: null });

  assert.equal(de_novo.outcome, "access_granted");
  assert.equal(acessoDe(db, "curso-b").ends_at, depoisDaPrimeira, "o prazo conta uma vez");
  assert.equal(depoisDaPrimeira, doFimDoDia(aprovadaEm, ANO));
  assert.equal(vinculosDe(db, "curso-b").length, 1);
});

/* ------------------------------------------------------------------------------------------------
 * Reembolso da compra que somou
 * ---------------------------------------------------------------------------------------------- */

test("reembolso da compra que somou devolve o término de antes, e o aluno continua com o acesso da outra compra", async () => {
  const db = actionStubs.db;
  const primeiraEm = Date.now() - 2 * 3_600_000;

  await postar(compra({ aprovadaEm: primeiraEm, id: "ev-1", produto: "8001", transacao: "HP-1" }));
  const antes = acessoDe(db, "curso-b").ends_at;
  await postar(compra({ id: "ev-2", produto: "8001", transacao: "HP-2" }));
  assert.equal(acessoDe(db, "curso-b").ends_at, maisPrazo(antes, ANO));

  const reembolso = await postar(compra({ evento: "PURCHASE_REFUNDED", id: "ev-3", produto: "8001", transacao: "HP-2" }));

  assert.equal(reembolso.corpo.outcome, "access_restored");
  assert.equal(acessoDe(db, "curso-b").ends_at, antes, "o termino de antes da segunda compra");
  assert.equal(acessoDe(db, "curso-b").status, "active", "a primeira compra continua valendo");
  assert.match(evento(db, "ev-3").outcome_detail, /prazo anterior devolvido/);
});

test("duas compras somadas e a mais antiga reembolsada: sobra o prazo da segunda, contado da compra dela; reembolsada também, o acesso fecha", async () => {
  const db = actionStubs.db;
  const primeiraEm = Date.now() - 20 * DIA;
  const segundaEm = Date.now() - 5 * DIA;

  await postar(compra({ aprovadaEm: primeiraEm, id: "ev-1", produto: "8001", transacao: "HP-1" }));
  await postar(compra({ aprovadaEm: segundaEm, id: "ev-2", produto: "8001", transacao: "HP-2" }));
  assert.equal(acessoDe(db, "curso-b").ends_at, maisPrazo(doFimDoDia(primeiraEm, ANO), ANO), "dois anos a partir da primeira");

  const reembolsoDaAntiga = await postar(compra({ evento: "PURCHASE_REFUNDED", id: "ev-3", produto: "8001", transacao: "HP-1" }));

  assert.equal(reembolsoDaAntiga.corpo.outcome, "access_restored");
  assert.equal(acessoDe(db, "curso-b").ends_at, doFimDoDia(segundaEm, ANO), "como se a compra reembolsada nunca tivesse existido");
  assert.equal(acessoDe(db, "curso-b").status, "active");

  const reembolsoDaSegunda = await postar(compra({ evento: "PURCHASE_REFUNDED", id: "ev-4", produto: "8001", transacao: "HP-2" }));
  assert.equal(reembolsoDaSegunda.corpo.outcome, "access_revoked");
  assert.equal(acessoDe(db, "curso-b").status, "revoked");
});

test("chargeback do pacote: o curso que só o pacote abriu fecha; o que tinha somado prazo volta ao término de antes", async () => {
  const db = actionStubs.db;

  await postar(compra({ id: "ev-1", produto: "8001", transacao: "HP-1" }));
  const antes = acessoDe(db, "curso-b").ends_at;
  await postar(compra({ id: "ev-2", produto: "7002", transacao: "HP-BLACK" }));
  assert.equal(acessoDe(db, "curso-b").ends_at, maisPrazo(antes, ANO));
  assert.equal(acessoDe(db, "curso-a").ends_at, null);

  const chargeback = await postar(compra({ evento: "PURCHASE_CHARGEBACK", id: "ev-3", produto: "7002", transacao: "HP-BLACK" }));

  assert.equal(chargeback.corpo.outcome, "access_revoked");
  assert.equal(acessoDe(db, "curso-a").status, "revoked", "so o pacote abriu o curso A");
  assert.equal(acessoDe(db, "curso-b").status, "active", "o curso B continua pela compra dele");
  assert.equal(acessoDe(db, "curso-b").ends_at, antes);
});

/* ------------------------------------------------------------------------------------------------
 * Todas as formacoes
 * ---------------------------------------------------------------------------------------------- */

const concessoes = (db) => db.linhas("all_formations_grants");

test("todas as formações: as publicadas entram com o prazo do item; mentoria, curso avulso e rascunho ficam de fora; a turma do pacote fica na concessão", async () => {
  const db = actionStubs.db;
  const aprovadaEm = Date.now() - 60_000;

  const resposta = await postar(compra({ aprovadaEm, id: "ev-tudo", produto: "7005", transacao: "HP-TUDO" }));

  assert.equal(resposta.corpo.outcome, "access_granted");
  assert.deepEqual(db.linhas("entitlements").map((linha) => linha.target_id).sort(), ["formacao-a", "formacao-b"]);
  assert.equal(acessoDe(db, "formacao-a").ends_at, doFimDoDia(aprovadaEm, ANO));
  assert.equal(acessoDe(db, "formacao-b").ends_at, doFimDoDia(aprovadaEm, ANO));
  assert.equal(acessoDe(db, "formacao-a").target_type, "formation");
  assert.equal(acessoDe(db, "mentoria-x"), null, "mentoria nunca entra");
  assert.equal(acessoDe(db, "curso-a"), null, "curso avulso nunca entra");
  assert.equal(acessoDe(db, "formacao-nova"), null, "em rascunho ainda nao existe para o aluno");

  const [concessao] = concessoes(db);
  assert.equal(concessoes(db).length, 1);
  assert.equal(concessao.user_id, contaDe(db).id);
  assert.equal(concessao.ends_at, doFimDoDia(aprovadaEm, ANO));
  assert.equal(concessao.transaction_id, "HP-TUDO");
  assert.equal(concessao.combo_id, "pacote-tudo");
  assert.equal(concessao.cohort_name, "Black 2026");
  assert.equal(concessao.status, "active");
  assert.deepEqual([...concessao.formation_ids].sort(), ["formacao-a", "formacao-b"]);
  assert.match(evento(db, "ev-tudo").outcome_detail, /Todas as formações \(as de hoje e as que vierem\): até \d{2}\/\d{2}\/\d{4}\./);

  // O reenvio de outro aviso da mesma compra nao cria outra concessao.
  await processSaleEvent(db, { event: getPaymentAdapter("hotmart").normalize(compra({ aprovadaEm, id: "ev-tudo-2", produto: "7005", transacao: "HP-TUDO" })), siteOrigin: SITE, webhookEventId: null });
  assert.equal(concessoes(db).length, 1);
});

test("a formação publicada depois entra sozinha para quem tem todas as formações, com o mesmo término; mentoria nova fica de fora", async () => {
  const db = actionStubs.db;

  await postar(compra({ id: "ev-tudo", produto: "7005", transacao: "HP-TUDO" }));
  const termino = concessoes(db)[0].ends_at;
  const emailsAntes = db.linhas("email_outbox").length;

  // A escola publica uma formacao nova e uma mentoria nova.
  db.linhas("content_items").find((linha) => linha.id === "formacao-nova").publication_status = "published";
  db.linhas("content_items").push({ access_model: "closed", commerce_scope: "sellable_product", id: "mentoria-nova", image: null, kind: "Mentoria", publication_status: "published", title: "Mentoria Nova" });

  const rodada = await materializeAllFormations(db, { formationIds: ["formacao-nova"] });

  assert.deepEqual([rodada.granted, rodada.failed, rodada.pending], [1, 0, 0]);
  assert.equal(acessoDe(db, "formacao-nova").ends_at, termino, "o mesmo termino da concessao");
  assert.equal(acessoDe(db, "formacao-nova").status, "active");
  assert.equal(acessoDe(db, "mentoria-nova"), null);
  assert.equal(acessoDe(db, "mentoria-x"), null);
  assert.ok(concessoes(db)[0].formation_ids.includes("formacao-nova"));
  assert.equal(db.linhas("email_outbox").length, emailsAntes, "nao e compra nova: nenhum e-mail de compra");

  // O vinculo e da mesma compra: o reembolso dela tira a formacao nova tambem.
  const [vinculo] = vinculosDe(db, "formacao-nova");
  assert.deepEqual([vinculo.transaction_id, vinculo.opened, vinculo.term_unit, vinculo.term_amount], ["HP-TUDO", true, "years", 1]);

  // De novo (o tick logo depois da publicacao): nada muda.
  const repetida = await materializeAllFormations(db);
  assert.deepEqual([repetida.granted, repetida.failed, repetida.pending], [0, 0, 0]);
  assert.equal(db.linhas("entitlements").filter((linha) => linha.target_id === "formacao-nova").length, 1);
});

test("a tarefa do tick é a rede de segurança: dá a formação que faltou; quem já venceu ou nunca comprou não recebe", async () => {
  const db = actionStubs.db;

  await postar(compra({ id: "ev-tudo", produto: "7005", transacao: "HP-TUDO" }));
  await postar(compra({ email: "vencida@teste.test", id: "ev-vencida", produto: "7005", transacao: "HP-VENCIDA" }));
  await postar(compra({ email: "so-curso@teste.test", id: "ev-curso", produto: "8001", transacao: "HP-CURSO" }));
  // O acesso de uma delas a todas as formacoes ja acabou.
  concessoes(db).find((linha) => linha.transaction_id === "HP-VENCIDA").ends_at = new Date(Date.now() - DIA).toISOString();

  db.linhas("content_items").find((linha) => linha.id === "formacao-nova").publication_status = "published";

  assert.equal(allFormationsJob.name, ALL_FORMATIONS_JOB_NAME);
  assert.equal(ALL_FORMATIONS_JOB_NAME, "todas-as-formacoes");
  await allFormationsJob.run({ runId: "r1", signal: new AbortController().signal, supabase: db, tickRunId: "t1", tickStartedAt: new Date() });

  assert.ok(acessoDe(db, "formacao-nova"), "quem tem a concessao valendo recebe");
  assert.equal(acessoDe(db, "formacao-nova", "vencida@teste.test"), null, "a concessao vencida nao da formacao nova");
  assert.equal(acessoDe(db, "formacao-nova", "so-curso@teste.test"), null, "quem comprou outra coisa nao recebe");

  // Sem nenhuma concessao (a escola de hoje): uma consulta e nada mais.
  const vazio = escola();
  await allFormationsJob.run({ runId: "r2", signal: new AbortController().signal, supabase: vazio, tickRunId: "t2", tickStartedAt: new Date() });
  assert.deepEqual(vazio.chamadas.map((chamada) => `${chamada.op}:${chamada.tabela}`), ["select:all_formations_grants"]);

  // Banco sem a migracao: termina sem erro.
  const semMigracao = bancoEmMemoria({ ausentes: ["all_formations_grants"] });
  assert.equal((await materializeAllFormations(semMigracao)).missingMigration, true);
});

test("reembolso de todas as formações tira o que ela abriu, sem tirar o que o aluno tem por outra compra; depois dele, formação nova não entra", async () => {
  const db = actionStubs.db;

  // A aluna ja tinha a Formacao A, comprada sozinha por 6 meses.
  await postar(compra({ id: "ev-a", produto: "9001", transacao: "HP-A" }));
  const antes = acessoDe(db, "formacao-a").ends_at;

  await postar(compra({ id: "ev-tudo", produto: "7005", transacao: "HP-TUDO" }));
  assert.equal(acessoDe(db, "formacao-a").ends_at, maisPrazo(antes, ANO), "compra repetida soma tambem aqui");
  db.linhas("content_items").find((linha) => linha.id === "formacao-nova").publication_status = "published";
  await materializeAllFormations(db);
  assert.equal(acessoDe(db, "formacao-nova").status, "active");

  const reembolso = await postar(compra({ evento: "PURCHASE_REFUNDED", id: "ev-reembolso", produto: "7005", transacao: "HP-TUDO" }));

  assert.equal(reembolso.corpo.outcome, "access_revoked");
  assert.equal(acessoDe(db, "formacao-b").status, "revoked");
  assert.equal(acessoDe(db, "formacao-nova").status, "revoked", "a formacao que entrou depois sai junto");
  assert.equal(acessoDe(db, "formacao-a").status, "active", "a compra dela sozinha continua valendo");
  assert.equal(acessoDe(db, "formacao-a").ends_at, antes, "com o termino de antes");
  assert.equal(concessoes(db)[0].status, "closed");
  assert.equal(concessoes(db)[0].closed_by, "refund");
  assert.match(evento(db, "ev-reembolso").outcome_detail, /acesso a todas as formações desta compra foi encerrado/);

  // Mais uma formacao publicada depois do reembolso: nao entra.
  db.linhas("content_items").push({ access_model: "closed", commerce_scope: "sellable_product", id: "formacao-2027", image: null, kind: "Formacao", publication_status: "published", title: "Formação 2027" });
  const rodada = await materializeAllFormations(db);
  assert.equal(rodada.grants, 0);
  assert.equal(acessoDe(db, "formacao-2027"), null);
});

test("todas as formações comprada duas vezes soma, e a formação nova entra com o término somado", async () => {
  const db = actionStubs.db;
  const primeiraEm = Date.now() - 10 * DIA;

  await postar(compra({ aprovadaEm: primeiraEm, id: "ev-1", produto: "7005", transacao: "HP-T1" }));
  await postar(compra({ id: "ev-2", produto: "7005", transacao: "HP-T2" }));

  const doisAnos = maisPrazo(doFimDoDia(primeiraEm, ANO), ANO);
  assert.equal(acessoDe(db, "formacao-a").ends_at, doisAnos);
  assert.deepEqual(concessoes(db).map((linha) => linha.ends_at), [doisAnos, doisAnos], "o termino do aluno em todas as formacoes e um so");

  db.linhas("content_items").find((linha) => linha.id === "formacao-nova").publication_status = "published";
  await materializeAllFormations(db);
  assert.equal(acessoDe(db, "formacao-nova").ends_at, doisAnos);
});

test("ao publicar uma formação, a ação chama a rodada de todas as formações só para ela e nunca derruba a publicação", () => {
  const source = readFileSync(new URL("../src/server/catalog/product-actions.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export async function publishProduct("), source.indexOf("export async function setProductSituation("));

  assert.match(body, /if \(productFormatOf\(current\) === "formacao"\) \{\s*try \{\s*await materializeAllFormations\(db, \{ budgetMs: ALL_FORMATIONS_PUBLISH_BUDGET_MS, formationIds: \[row\.id\] \}\);\s*\} catch/);
  assert.ok(body.indexOf("materializeAllFormations(") > body.indexOf('patch: { publication_status: "published" }'), "depois de publicar");
});

/* ------------------------------------------------------------------------------------------------
 * Vencimento fecha so aquele curso
 * ---------------------------------------------------------------------------------------------- */

test("curso vencido fecha só ele: o servidor só autoriza as aulas dos cursos que ainda valem", async () => {
  const db = actionStubs.db;

  await postar(compra({ id: "ev-black", produto: "7002", transacao: "HP-BLACK" }));
  db.linhas("course_modules").push(
    { description: "", id: "mod-a", owner_id: "curso-a", release_rule: null, sort_order: 0, status: "published", title: "Módulo A" },
    { description: "", id: "mod-b", owner_id: "curso-b", release_rule: null, sort_order: 0, status: "published", title: "Módulo B" }
  );
  db.linhas("lessons").push(
    { description: "", duration: "10 min", id: "aula-a", module_id: "mod-a", release_rule: null, sort_order: 0, status: "published", title: "Aula A" },
    { description: "", duration: "10 min", id: "aula-b", module_id: "mod-b", release_rule: null, sort_order: 0, status: "published", title: "Aula B" }
  );
  const userId = contaDe(db).id;

  const antes = await resolveAuthorizedLearningCatalog(userId);
  assert.deepEqual(antes.contents.map((content) => content.id).sort(), ["curso-a", "curso-b"]);
  assert.deepEqual(antes.lessons.map((lesson) => lesson.id).sort(), ["aula-a", "aula-b"]);

  // O ano do curso B acabou ontem; o curso A (para sempre) continua.
  acessoDe(db, "curso-b").ends_at = new Date(Date.now() - DIA).toISOString();

  const depois = await resolveAuthorizedLearningCatalog(userId);
  assert.deepEqual(depois.contents.map((content) => content.id), ["curso-a"], "so o curso vencido sai");
  assert.deepEqual(depois.lessons.map((lesson) => lesson.id), ["aula-a"], "nenhuma aula do curso vencido e autorizada");
  assert.equal(acessoDe(db, "curso-b").status, "active", "o acesso nao e apagado nem revogado: so venceu");
});

test("o aviso do curso vencido: a frase com a data e o botão Comprar quando há link; sem link, só a frase", () => {
  const label = term.accessEndedLabel("2027-11-21T02:59:59.999Z");
  assert.equal(label, "Seu acesso terminou em 20/11/2027");

  const comLink = renderToStaticMarkup(createElement(AccessEndedNotice, { contentId: "curso-b", label, purchaseUrl: "https://pay.exemplo.test/curso-b" }));
  assert.match(comLink, /Seu acesso terminou em 20\/11\/2027/);
  assert.match(comLink, /<a [^>]*href="https:\/\/pay\.exemplo\.test\/curso-b"[^>]*>.*Comprar<\/a>/s);

  const comRotulo = renderToStaticMarkup(createElement(AccessEndedNotice, { contentId: "curso-b", label, purchaseLabel: "Renovar", purchaseTarget: "new_tab", purchaseUrl: "https://pay.exemplo.test/curso-b" }));
  assert.match(comRotulo, /target="_blank"/);
  assert.match(comRotulo, /Renovar<\/a>/);

  const semLink = renderToStaticMarkup(createElement(AccessEndedNotice, { contentId: "curso-b", label }));
  assert.match(semLink, /Seu acesso terminou em 20\/11\/2027/);
  assert.doesNotMatch(semLink, /<a /, "sem link de compra, fechado so com a frase");
});

test("o curso vencido usa o bloqueio que já existe: fechado (isLocked) com a frase, no cartão, nos detalhes, na página e na aula", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const store = read("src/server/db/platform-store.ts");

  // O servidor marca o item vencido so quando ele esta fechado por falta de acesso, e nunca na previa "ver como".
  assert.match(store, /const accessEndedAt = isPurchaseLocked && !accessPreviewMode \? getAccessEndedAt\(item, userAccessKeys\) : undefined;/);
  assert.match(store, /\.\.\.\(accessEndedAt \? \{ accessEndedAt, accessEndedLabel: accessEndedLabel\(accessEndedAt\) \} : \{\}\)/);
  // So o acesso que acabou pelo prazo conta: revogado e suspenso (reembolso, equipe) ficam de fora.
  assert.match(store, /if \(entitlement\.status !== "active" && entitlement\.status !== "expired"\) \{\s*return null;/);
  // Produto "Oculto por enquanto" continua aparecendo, fechado, para quem teve o acesso e venceu.
  assert.match(store, /canOpenProductPage\(item, hasOrHadPurchaseAccess\(item, accessPreviewMode, userAccessKeys\)\)/);
  assert.match(store, /const canSeeHidden = \(item: ContentItem\) => hasOrHadPurchaseAccess\(item, accessPreviewMode, userAccessKeys\);/);

  assert.match(read("src/components/content-card.tsx"), /item\.isLocked && item\.accessEndedLabel \? \(/);
  assert.match(read("src/components/content-details-modal.tsx"), /item\.accessEndedLabel \?\? "Acesso bloqueado"/);
  assert.match(read("src/app/conteudo/[id]/page.tsx"), /\{isLocked && item\.accessEndedLabel \? \(\s*<AccessEndedNotice/);
  // A aula nunca abre sem acesso; o curso vencido volta para a pagina dele, que explica e oferece a compra.
  assert.match(read("src/app/conteudo/[id]/aulas/[moduleId]/page.tsx"), /if \(lessonPageData\.item\.isLocked\) \{\s*redirect\(lessonPageData\.item\.accessEndedLabel \? `\/conteudo\/\$\{lessonPageData\.item\.id\}` : "\/"\);/);
});

/* ------------------------------------------------------------------------------------------------
 * Importacao de alunos com prazo
 * ---------------------------------------------------------------------------------------------- */

test("importação com prazo: cada produto fica com o término da planilha (data ou vitalício); sem ele, o Acesso até do lote", async () => {
  const db = actionStubs.db;
  const contents = db.linhas("content_items").map((linha) => ({ id: linha.id, image: null, kind: linha.kind, title: linha.title }));
  const lote = "2027-03-31T02:59:59.999Z";
  const row = {
    cohortId: null,
    email: "migrada@teste.test",
    fullName: "Aluna Migrada",
    index: 1,
    phone: null,
    productEndsAt: { "curso-a": null, "formacao-a": "2027-12-31" },
    productIds: ["curso-a", "formacao-a", "curso-b"]
  };

  assert.deepEqual(groupImportProductsByEnd(row, lote), [
    { endsAt: null, productIds: ["curso-a"] },
    { endsAt: "2028-01-01T02:59:59.999Z", productIds: ["formacao-a"] },
    { endsAt: lote, productIds: ["curso-b"] }
  ]);

  const resultado = await importStudentRow(
    { actorId: null, contents, delivery: "none", endsAt: lote, redirectTo: `${SITE}/auth/callback`, row, sendEmails: false, source: "admin", sourceProvider: "manual", staffIds: new Set() },
    db
  );

  assert.equal(resultado.outcome.status, "created");
  assert.equal(acessoDe(db, "curso-a", "migrada@teste.test").ends_at, null, "vitalicio na planilha");
  assert.equal(acessoDe(db, "formacao-a", "migrada@teste.test").ends_at, "2028-01-01T02:59:59.999Z", "ate o fim do dia 31/12/2027");
  assert.equal(acessoDe(db, "curso-b", "migrada@teste.test").ends_at, lote, "sem termino na planilha: o do lote");
  assert.ok(db.linhas("entitlements").every((linha) => linha.source_provider === "manual"));
});
