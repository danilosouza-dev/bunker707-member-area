import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { beforeEach } from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import "./support/transpile-tsx.mjs";
import { assinarLicenca, licencaBase, novaChaveDeEmissao, novaRaiz } from "./support/licenca-de-teste.mjs";
import { bancoEmMemoria } from "./support/vendas-banco-em-memoria.mjs";

// A venda guardada (docs/32 §2.2 e §11.3), de ponta a ponta sem o Supabase local: o webhook da Hotmart de verdade (a rota,
// o adaptador, a regra de acesso e a fila de e-mail), sobre um banco em memoria (tests/support/vendas-banco-em-memoria.mjs),
// com a situacao da licenca do pedido trocada por licencas assinadas pelo duble do Emissor e avaliadas pelo Verificador de
// verdade (computeLicenseState). Aqui:
// - no modo "enforce", a compra que chega com a matricula barrada (Escola congelada, copia nunca ativada, Aviso de endereco
//   diferente, licenca que nao pode ser lida) fica guardada: 200 para a plataforma, nenhuma conta, nenhum acesso, nenhum
//   e-mail para quem comprou, um e-mail por episodio para o dono e os administradores;
// - o que a pessoa ja tinha renova na hora (inclusive o acesso fechado); na compra com os dois, so o novo fica guardado;
// - o Admin limitado nao barra a matricula: a venda passa;
// - o reembolso descarta a venda guardada (nunca libera), e o reenvio do mesmo evento nao guarda duas vezes;
// - a tarefa do tick libera em ordem quando a licenca volta, com as boas-vindas e o e-mail de compra de sempre, e duas
//   rodadas ao mesmo tempo liberam uma vez so; a licenca ainda barrando nao libera nada;
// - o banco sem a migracao 202611110002 nunca libera acesso novo: a venda fica com erro;
// - a ultima trava em grantResolvedProducts e a faixa da Licenca com a contagem;
// - o modo "off": exatamente como antes, sem tocar em held_sales.

const licencaDoPedido = (globalThis.__vendasGuardadasLicenca ??= { situacao: null });

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
        export async function getCurrentLicenseState() { return globalThis.__vendasGuardadasLicenca.situacao; }
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

const { computeLicenseState, EMPTY_LICENSE_SNAPSHOT } = await import("../src/server/licensing/state.ts");
const route = await import("../src/app/api/webhooks/hotmart/route.ts");
const { hashSalesSecret } = await import("../src/server/payments/secret.ts");
const { runHeldSalesRound } = await import("../src/server/payments/held-sales-release.ts");
const { reprocessWebhookEvent } = await import("../src/server/payments/webhook-handler.ts");
const { heldSalesJob } = await import("../src/server/jobs/held-sales-job.ts");
const { forgetHeldSalesNoticeMemory } = await import("../src/server/payments/held-sales-notice.ts");
const model = await import("../src/server/payments/held-sales-model.ts");
const { saleOutcomeChip } = await import("../src/server/payments/model.ts");
const { grantProductAccess } = await import("../src/server/students/access.ts");
const { getHeldSalesOverview, countHeldSalesForBanner } = await import("../src/server/payments/held-sales-queries.ts");
const { renderHeldSalesEmail } = await import("../src/server/email/templates/held-sales.ts");
const { licenseBannerOf } = await import("../src/server/licensing/copy.ts");
const { LicenseBanner } = await import("../src/components/admin/v2/license/license-banner.tsx");
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");

/* ------------------------------------------------------------------------------------------------
 * A escola de teste e as situacoes da licenca
 * ---------------------------------------------------------------------------------------------- */

const TOKEN = "hottok-guardada-0123456789abcdef";
const SITE = "https://alunos.escola.test";
const AGORA = new Date("2026-11-11T12:00:00.000Z");
const ONTEM = "2026-11-10T12:00:00.000Z";
const raiz = novaRaiz("raiz-2026");
const emissao = novaChaveDeEmissao(raiz);
const passo = (degree, reason) => ({ degree, from: ONTEM, reason });

/** A situacao de uma Instalacao conferida hoje, com a licenca dada (e o endereco configurado). */
function situacao(sobrescrever = {}, endereco = "alunos.escola.test") {
  return computeLicenseState({
    configuredHost: endereco,
    mode: "enforce",
    roots: [raiz.confiavel],
    snapshot: {
      ...EMPTY_LICENSE_SNAPSHOT,
      everActivated: true,
      lastCheckIn: { emissorTime: AGORA, localTime: AGORA },
      lastSeenAt: AGORA,
      token: assinarLicenca(emissao, licencaBase(sobrescrever))
    },
    systemNow: AGORA
  });
}

const SITUACOES = {
  admin_limitado: situacao({ statusSteps: [passo("admin_limitado", "pagamento_desfeito")] }),
  em_dia: situacao(),
  endereco_diferente: situacao({}, "outra.escola.test"),
  escola_congelada: situacao({ statusSteps: [passo("escola_congelada", "pagamento_desfeito")] }),
  nao_ativada: computeLicenseState({ configuredHost: "alunos.escola.test", mode: "enforce", roots: [raiz.confiavel], snapshot: EMPTY_LICENSE_SNAPSHOT, systemNow: AGORA })
};

const EQUIPE = [
  { email: "dona@escola.test", id: "00000000-0000-4000-8000-0000000000d1", role: "owner" },
  { email: "admin@escola.test", id: "00000000-0000-4000-8000-0000000000a1", role: "admin" },
  { email: "editor@escola.test", id: "00000000-0000-4000-8000-0000000000e1", role: "editor" }
];

/** Um banco novo com a escola: dois cursos, um pacote com os dois, os codigos da Hotmart e a equipe. */
function escola({ ausentes = [] } = {}) {
  return bancoEmMemoria({
    ausentes,
    tabelas: {
      admin_roles: EQUIPE.map((pessoa) => ({ permissions: {}, role: pessoa.role, user_id: pessoa.id })),
      content_items: [
        { id: "curso-a", image: null, kind: "Curso", title: "Curso A" },
        { id: "curso-b", image: null, kind: "Curso", title: "Curso B" }
      ],
      integration_settings: [{ provider: "hotmart", secret: hashSalesSecret(TOKEN), secret_status: "set", status: "configured" }],
      product_combo_items: [
        { combo_id: "pacote-ab", product_id: "curso-a", sort_order: 0 },
        { combo_id: "pacote-ab", product_id: "curso-b", sort_order: 1 }
      ],
      product_combos: [{ id: "pacote-ab", name: "Pacote AB", status: "active" }],
      profiles: EQUIPE.map((pessoa) => ({ email: pessoa.email, full_name: pessoa.role, id: pessoa.id, phone: null })),
      sales_product_links: [
        { combo_id: null, external_product_id: "7001", product_id: "curso-a", provider: "hotmart" },
        { combo_id: null, external_product_id: "7003", product_id: "curso-b", provider: "hotmart" },
        { combo_id: "pacote-ab", external_product_id: "7002", product_id: null, provider: "hotmart" }
      ]
    },
    usuarios: EQUIPE.map((pessoa) => ({ created_at: ONTEM, email: pessoa.email, id: pessoa.id, last_sign_in_at: ONTEM, user_metadata: {} }))
  });
}

/** Payload ficticio do webhook 2.0 da Hotmart. */
function compra({ email = "compradora@teste.test", evento = "PURCHASE_APPROVED", id, nome = "Compradora de Teste", produto = "7001", transacao }) {
  return {
    creation_date: Date.now(),
    data: {
      buyer: { email, name: nome },
      product: { id: Number(produto), name: `Produto ${produto}` },
      purchase: { approved_date: Date.now(), order_date: Date.now(), price: { currency_value: "BRL", value: 497 }, status: "APPROVED", transaction: transacao }
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

function rodada(db, extra = {}) {
  return runHeldSalesRound({
    configuredHost: () => SITE,
    db,
    mode: process.env.BUNKER_LICENSING_MODE === "enforce" ? "enforce" : "off",
    readLicense: async () => licencaDoPedido.situacao,
    ...extra
  });
}

const contaDe = (db, email) => [...db.contas.values()].find((conta) => conta.email === email) ?? null;
const acessosDe = (db, email) => {
  const conta = contaDe(db, email);
  return conta ? db.linhas("entitlements").filter((linha) => linha.user_id === conta.id) : [];
};
const emails = (db, kind) => db.linhas("email_outbox").filter((linha) => !kind || linha.kind === kind);
const evento = (db, id) => db.linhas("webhook_events").find((linha) => linha.external_event_id === id);
const guardadas = (db) => db.linhas("held_sales");
const tocouGuardadas = (db) => db.chamadas.some((chamada) => chamada.tabela === "held_sales");

beforeEach(() => {
  process.env.BUNKER_LICENSING_MODE = "enforce";
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  licencaDoPedido.situacao = SITUACOES.escola_congelada;
  forgetHeldSalesNoticeMemory();
});

/* ------------------------------------------------------------------------------------------------
 * Guardar
 * ---------------------------------------------------------------------------------------------- */

test("cada situação que barra a matrícula guarda a venda: 200, nenhuma conta, nenhum acesso, nenhum e-mail para quem comprou", async () => {
  const casos = [
    ["escola_congelada", SITUACOES.escola_congelada],
    ["nao_ativada", SITUACOES.nao_ativada],
    ["endereco_diferente", SITUACOES.endereco_diferente],
    ["leitura_falhou", null]
  ];

  for (const [motivo, estado] of casos) {
    const db = escola();
    actionStubs.db = db;
    licencaDoPedido.situacao = estado;
    forgetHeldSalesNoticeMemory();

    const resposta = await postar(compra({ id: `ev-${motivo}`, transacao: `HP-${motivo}` }));

    assert.equal(resposta.status, 200, `${motivo}: a plataforma recebe sucesso (quem responde erro e desligada)`);
    assert.equal(resposta.corpo.outcome, "held", motivo);
    assert.equal(contaDe(db, "compradora@teste.test"), null, `${motivo}: nenhuma conta nasce`);
    assert.equal(db.linhas("entitlements").length, 0, `${motivo}: nenhum acesso`);
    assert.deepEqual(emails(db).filter((linha) => linha.to_email === "compradora@teste.test"), [], `${motivo}: nada para quem comprou`);

    const [guardada] = guardadas(db);
    assert.equal(guardadas(db).length, 1);
    assert.equal(guardada.reason, motivo);
    assert.equal(guardada.status, "held");
    assert.deepEqual(guardada.product_ids, ["curso-a"]);
    assert.equal(guardada.transaction_id, `HP-${motivo}`);

    const linha = evento(db, `ev-${motivo}`);
    assert.equal(linha.outcome, "held");
    assert.equal(linha.processing_status, "processed", "a venda guardada nao e erro nem fica para Reprocessar");
    assert.match(linha.outcome_detail, /^Venda guardada \(/);
    assert.deepEqual(saleOutcomeChip({ outcome: linha.outcome, status: linha.processing_status }), { label: "Venda guardada", tone: "warning" });

    // O dono e o administrador recebem um e-mail; o editor nao.
    assert.deepEqual(
      emails(db, "held_sales").map((linha) => linha.to_email).sort(),
      ["admin@escola.test", "dona@escola.test"],
      `${motivo}: o e-mail da equipe`
    );
    assert.ok(emails(db, "held_sales").every((linha) => !linha.html.includes("compradora@teste.test")), "o e-mail da equipe nunca traz quem comprou");
  }
});

test("Admin limitado e Licença em dia não barram a matrícula: a venda libera o acesso na hora, sem guardar", async () => {
  for (const estado of [SITUACOES.admin_limitado, SITUACOES.em_dia]) {
    const db = escola();
    actionStubs.db = db;
    licencaDoPedido.situacao = estado;

    const resposta = await postar(compra({ id: "ev-livre", transacao: "HP-LIVRE" }));

    assert.equal(resposta.status, 200);
    assert.equal(resposta.corpo.outcome, "access_granted");
    assert.equal(acessosDe(db, "compradora@teste.test").length, 1);
    assert.equal(guardadas(db).length, 0);
    assert.equal(emails(db, "welcome").length, 1);
  }
});

test("o reenvio do mesmo evento não guarda duas vezes, e o episódio manda um e-mail só, mesmo com a segunda venda", async () => {
  const db = escola();
  actionStubs.db = db;

  const primeira = compra({ id: "ev-1", transacao: "HP-1" });
  assert.equal((await postar(primeira)).corpo.outcome, "held");
  const repetida = await postar(primeira);
  assert.equal(repetida.status, 200);
  assert.equal(repetida.corpo.duplicate, true);
  assert.equal(guardadas(db).length, 1);

  // A memoria do processo esquecida (outro processo, ou o mesmo reiniciado): a chave da fila segura o e-mail.
  forgetHeldSalesNoticeMemory();
  assert.equal((await postar(compra({ email: "outra@teste.test", id: "ev-2", nome: "Outra", transacao: "HP-2" }))).corpo.outcome, "held");
  assert.equal(guardadas(db).length, 2);
  assert.equal(emails(db, "held_sales").length, 2, "dono e administrador, uma vez por episodio");
  assert.ok(emails(db, "held_sales").every((linha) => linha.idempotency_key.startsWith("held-sales:escola_congelada:")));
});

test("outro aviso da mesma compra (a confirmação do fim da garantia) não guarda de novo, e a compra é liberada uma vez", async () => {
  const db = escola();
  actionStubs.db = db;

  await postar(compra({ id: "ev-aprovada", transacao: "HP-G" }));
  const confirmacao = await postar(compra({ evento: "PURCHASE_COMPLETE", id: "ev-fim-da-garantia", transacao: "HP-G" }));

  assert.equal(confirmacao.status, 200);
  assert.equal(confirmacao.corpo.outcome, "ignored");
  assert.match(evento(db, "ev-fim-da-garantia").outcome_detail, /já está guardada por outro aviso da mesma venda/);
  assert.equal(guardadas(db).length, 1, "a lista mostra uma venda so");

  licencaDoPedido.situacao = SITUACOES.em_dia;
  assert.equal((await rodada(db)).granted, 1);
  assert.equal(db.linhas("entitlements").length, 1);
  assert.equal(emails(db, "welcome").length, 1);
});

test("o e-mail do episódio pela tarefa do tick: só para venda guardada neste episódio, nunca para a de um episódio anterior", async () => {
  const db = escola();
  actionStubs.db = db;

  await postar(compra({ id: "ev-antiga", transacao: "HP-ANTIGA" }));
  // A venda ficou guardada num episodio anterior (antes de o degrau de agora comecar) e a fila do e-mail ficou vazia.
  guardadas(db)[0].held_at = "2026-11-01T12:00:00.000Z";
  db.linhas("email_outbox").length = 0;
  forgetHeldSalesNoticeMemory();

  const barrada = await rodada(db);
  assert.equal(barrada.blocked, true);
  assert.equal(emails(db, "held_sales").length, 0, "o episodio novo nao tem venda guardada: nenhum e-mail");

  // A venda deste episodio cujo e-mail nao saiu na hora (a fila falhou): a tarefa manda.
  guardadas(db)[0].held_at = "2026-11-10T13:00:00.000Z";
  await rodada(db);
  assert.equal(emails(db, "held_sales").length, 2);
});

test("quem já tinha o produto renova na hora, inclusive o acesso fechado; na compra com os dois, só o novo fica guardado", async () => {
  const db = escola();
  actionStubs.db = db;
  licencaDoPedido.situacao = SITUACOES.em_dia;

  // A aluna comprou o Curso A em dia; depois a escola congelou e ela foi reembolsada (acesso revogado).
  await postar(compra({ id: "ev-a", transacao: "HP-A" }));
  const aluna = contaDe(db, "compradora@teste.test");
  assert.ok(aluna);
  db.linhas("entitlements")[0].status = "revoked";
  licencaDoPedido.situacao = SITUACOES.escola_congelada;

  // Ela compra o Curso A de novo: retoma na hora, sem guardar.
  const retoma = await postar(compra({ id: "ev-a2", transacao: "HP-A2" }));
  assert.equal(retoma.corpo.outcome, "access_granted");
  assert.equal(guardadas(db).length, 0);
  assert.equal(acessosDe(db, "compradora@teste.test").find((linha) => linha.target_id === "curso-a").status, "active");

  // Ela compra o pacote com o Curso A (que tem) e o Curso B (que nao tem): o A renova, o B fica guardado.
  const pacote = await postar(compra({ id: "ev-ab", produto: "7002", transacao: "HP-AB" }));
  assert.equal(pacote.corpo.outcome, "access_granted");
  assert.deepEqual(acessosDe(db, "compradora@teste.test").map((linha) => linha.target_id), ["curso-a"]);
  assert.equal(guardadas(db).length, 1);
  assert.deepEqual(guardadas(db)[0].product_ids, ["curso-b"]);
  assert.match(evento(db, "ev-ab").outcome_detail, /1 produto ficou guardado \(Escola congelada\)/);

  // A Licenca volta: a tarefa libera so o Curso B, com o sufixo do produto e o e-mail de compra com chave propria.
  licencaDoPedido.situacao = SITUACOES.em_dia;
  const resultado = await rodada(db);
  assert.equal(resultado.granted, 1);
  const cursoB = acessosDe(db, "compradora@teste.test").find((linha) => linha.target_id === "curso-b");
  assert.equal(cursoB.status, "active");
  assert.equal(cursoB.source_event_id, "HP-AB:curso-b");
  assert.ok(emails(db, "purchase").some((linha) => linha.idempotency_key.endsWith(":venda-guardada")), "o e-mail da parte liberada depois");
  assert.equal(evento(db, "ev-ab").outcome, "access_granted");
  assert.match(evento(db, "ev-ab").outcome_detail, /^Venda guardada liberada em /);
  assert.equal(guardadas(db)[0].status, "granted");
});

/* ------------------------------------------------------------------------------------------------
 * Reembolso
 * ---------------------------------------------------------------------------------------------- */

test("o reembolso e o chargeback passam e descartam a venda guardada, que nunca é liberada", async () => {
  for (const evento_ of ["PURCHASE_REFUNDED", "PURCHASE_CHARGEBACK"]) {
    const db = escola();
    actionStubs.db = db;
    licencaDoPedido.situacao = SITUACOES.escola_congelada;

    await postar(compra({ id: "ev-compra", transacao: "HP-R" }));
    const reembolso = await postar(compra({ evento: evento_, id: "ev-reembolso", transacao: "HP-R" }));

    assert.equal(reembolso.status, 200, evento_);
    assert.equal(guardadas(db)[0].status, "discarded");
    assert.match(guardadas(db)[0].resolution, /^Venda guardada descartada: (reembolso|chargeback) registrado antes da liberação/);
    assert.equal(evento(db, "ev-compra").outcome, "ignored");
    assert.equal(evento(db, "ev-compra").processing_status, "processed", "a compra desfeita nao volta a ser reprocessavel");
    assert.match(evento(db, "ev-compra").outcome_detail, /^Venda guardada descartada/);
    assert.equal(evento(db, "ev-reembolso").outcome, "ignored");
    assert.equal(evento(db, "ev-reembolso").outcome_detail, "Venda guardada descartada: o acesso desta compra nunca foi liberado.");

    // A Licenca volta e a tarefa roda: nada a liberar.
    licencaDoPedido.situacao = SITUACOES.em_dia;
    const resultado = await rodada(db);
    assert.equal(resultado.pending, 0);
    assert.equal(contaDe(db, "compradora@teste.test"), null);
    assert.equal(db.linhas("entitlements").length, 0);
  }
});

test("a assinatura cancelada antes da liberação também descarta a venda guardada", async () => {
  const db = escola();
  actionStubs.db = db;
  const assinatura = compra({ id: "ev-assinatura", transacao: "HP-ASS" });
  assinatura.data.subscription = { plan: { name: "Mensal" }, status: "ACTIVE", subscriber: { code: "SUB-1" } };

  await postar(assinatura);
  assert.equal(guardadas(db)[0].subscription_code, "SUB-1");

  const cancelamento = await postar({
    creation_date: Date.now(),
    data: { cancellation_date: Date.now(), product: { id: 7001, name: "Produto 7001" }, subscriber: { code: "SUB-1", email: "compradora@teste.test", name: "Compradora" } },
    event: "SUBSCRIPTION_CANCELLATION",
    id: "ev-cancelamento",
    version: "2.0.0"
  });

  assert.equal(cancelamento.status, 200);
  assert.equal(guardadas(db)[0].status, "discarded");
  assert.match(guardadas(db)[0].resolution, /assinatura cancelada antes da liberação/);
  assert.equal(evento(db, "ev-cancelamento").outcome_detail, "Venda guardada descartada: o acesso desta compra nunca foi liberado.");
});

test("o reembolso que chega no meio da liberação: a compra com o reembolso gravado não libera nada", async () => {
  const db = escola();
  actionStubs.db = db;

  await postar(compra({ id: "ev-compra", transacao: "HP-M" }));
  // O reembolso ja gravado como evento (o processamento dele ainda nao rodou) quando a tarefa libera.
  db.linhas("webhook_events").push({
    ...db.linhas("webhook_events")[0],
    event_type: "PURCHASE_REFUNDED",
    external_event_id: "ev-reembolso-em-curso",
    id: "evento-reembolso",
    normalized_type: "refund",
    outcome: null,
    processing_status: "received"
  });
  licencaDoPedido.situacao = SITUACOES.em_dia;

  const resultado = await rodada(db);

  assert.equal(resultado.granted, 0);
  assert.equal(resultado.discarded, 1);
  assert.equal(contaDe(db, "compradora@teste.test"), null);
  assert.equal(guardadas(db)[0].status, "discarded");
  assert.match(guardadas(db)[0].resolution, /reembolso ou chargeback registrado/);
});

/* ------------------------------------------------------------------------------------------------
 * Liberar
 * ---------------------------------------------------------------------------------------------- */

test("a Licença de volta: a tarefa do tick libera em ordem, com as boas-vindas e o e-mail de compra, e o acesso conta da liberação", async () => {
  const db = escola();
  actionStubs.db = db;

  await postar(compra({ email: "primeira@teste.test", id: "ev-1", nome: "Primeira", transacao: "HP-1" }));
  await postar(compra({ email: "segunda@teste.test", id: "ev-2", nome: "Segunda", produto: "7002", transacao: "HP-2" }));
  guardadas(db)[0].held_at = "2026-11-10T09:00:00.000Z";
  guardadas(db)[1].held_at = "2026-11-10T10:00:00.000Z";

  // Ainda congelada: nada sai.
  const barrada = await rodada(db);
  assert.equal(barrada.blocked, true);
  assert.equal(barrada.pending, 2);
  assert.equal(db.linhas("entitlements").length, 0);

  licencaDoPedido.situacao = SITUACOES.em_dia;
  const antes = new Date().toISOString();
  const resultado = await rodada(db);

  assert.deepEqual({ discarded: resultado.discarded, failed: resultado.failed, granted: resultado.granted }, { discarded: 0, failed: 0, granted: 2 });
  const primeira = contaDe(db, "primeira@teste.test");
  const segunda = contaDe(db, "segunda@teste.test");
  assert.ok(primeira && segunda, "as contas nascem na liberacao");
  assert.ok(Date.parse(primeira.created_at) <= Date.parse(segunda.created_at), "na ordem em que chegaram");
  assert.deepEqual(acessosDe(db, "segunda@teste.test").map((linha) => linha.target_id).sort(), ["curso-a", "curso-b"]);
  assert.ok(db.linhas("entitlements").every((linha) => linha.starts_at >= antes && linha.ends_at === null), "o acesso conta do dia da liberacao");
  assert.deepEqual(emails(db, "welcome").map((linha) => linha.to_email).sort(), ["primeira@teste.test", "segunda@teste.test"]);
  assert.deepEqual(emails(db, "purchase").map((linha) => linha.to_email).sort(), ["primeira@teste.test", "segunda@teste.test"]);
  assert.ok(guardadas(db).every((linha) => linha.status === "granted" && linha.resolved_at && linha.claimed_at === null));
  assert.equal(evento(db, "ev-1").outcome, "access_granted");
  assert.equal(evento(db, "ev-1").user_id, primeira.id);
  assert.ok(db.linhas("sale_grants").length >= 3, "os vinculos da venda, para o reembolso de depois");

  // O reembolso depois da liberacao revoga como sempre.
  await postar(compra({ email: "primeira@teste.test", evento: "PURCHASE_REFUNDED", id: "ev-1-reembolso", transacao: "HP-1" }));
  assert.equal(acessosDe(db, "primeira@teste.test")[0].status, "revoked");

  // Rodar de novo nao faz nada.
  const de_novo = await rodada(db);
  assert.equal(de_novo.pending, 0);
});

test("duas rodadas ao mesmo tempo liberam a venda uma vez só", async () => {
  const db = escola();
  actionStubs.db = db;

  await postar(compra({ id: "ev-1", transacao: "HP-1" }));
  licencaDoPedido.situacao = SITUACOES.em_dia;

  const [uma, outra] = await Promise.all([rodada(db), rodada(db)]);

  assert.equal(uma.granted + outra.granted, 1);
  assert.equal(uma.contended + outra.contended, 1);
  assert.equal(uma.failed + outra.failed, 0);
  assert.equal(db.chamadas.filter((chamada) => chamada.op === "createUser").length, 1, "a conta nasce uma vez");
  assert.equal(db.linhas("student_events").filter((linha) => linha.event_type === "access_granted").length, 1, "a regra de acesso rodou uma vez so");
  assert.equal(db.linhas("entitlements").length, 1);
  assert.equal(emails(db, "welcome").length, 1);
  assert.equal(emails(db, "purchase").length, 1);
  assert.equal(guardadas(db)[0].status, "granted");
});

test("a reivindicação abandonada (a rodada morreu no meio) é retomada; a recente, não", async () => {
  const db = escola();
  actionStubs.db = db;

  await postar(compra({ id: "ev-1", transacao: "HP-1" }));
  licencaDoPedido.situacao = SITUACOES.em_dia;
  guardadas(db)[0].claimed_at = new Date().toISOString();

  assert.equal((await rodada(db)).contended, 1, "a reivindicacao de agora segura");
  assert.equal(db.linhas("entitlements").length, 0);

  guardadas(db)[0].claimed_at = new Date(Date.now() - model.HELD_SALE_CLAIM_STALE_MS - 1000).toISOString();
  assert.equal((await rodada(db)).granted, 1, "a abandonada e retomada");
});

test("a liberação que falha conta a tentativa, não segura as outras e, depois do teto, vira erro com Reprocessar", async () => {
  const db = escola();
  actionStubs.db = db;

  await postar(compra({ email: "quebrada@teste.test", id: "ev-quebrada", transacao: "HP-Q" }));
  await postar(compra({ email: "boa@teste.test", id: "ev-boa", nome: "Boa", transacao: "HP-B" }));
  guardadas(db)[0].held_at = "2026-11-10T09:00:00.000Z";
  guardadas(db)[1].held_at = "2026-11-10T10:00:00.000Z";
  licencaDoPedido.situacao = SITUACOES.em_dia;

  // O Auth recusa a primeira conta.
  const criar = db.auth.admin.createUser;
  db.auth.admin.createUser = async (pedido) => (pedido.email === "quebrada@teste.test" ? { data: { user: null }, error: { message: "Auth fora do ar", status: 500 } } : criar(pedido));

  const resultado = await rodada(db);
  assert.equal(resultado.failed, 1);
  assert.equal(resultado.granted, 1, "a seguinte nao espera a que falhou");
  const quebrada = guardadas(db).find((linha) => linha.transaction_id === "HP-Q");
  assert.equal(quebrada.status, "held");
  assert.equal(quebrada.attempts, 1);
  assert.match(quebrada.last_error, /Auth fora do ar/);
  assert.equal(quebrada.claimed_at, null);

  quebrada.attempts = model.HELD_SALE_MAX_ATTEMPTS - 1;
  await rodada(db);
  assert.equal(quebrada.status, "discarded");
  assert.match(quebrada.resolution, /falhou 10 vezes/);
  const linha = evento(db, "ev-quebrada");
  assert.equal(linha.outcome, "failed");
  assert.equal(linha.processing_status, "failed", "a venda vai para a lista com erro e o Reprocessar de sempre");
});

test("banco sem a migração 202611110002: a venda que precisa ficar guardada fica com erro e nada é liberado", async () => {
  const db = escola({ ausentes: ["held_sales"] });
  actionStubs.db = db;

  const resposta = await postar(compra({ id: "ev-sem-tabela", transacao: "HP-S" }));

  assert.equal(resposta.status, 500, "a plataforma reenvia");
  assert.equal(contaDe(db, "compradora@teste.test"), null);
  assert.equal(db.linhas("entitlements").length, 0);
  assert.equal(evento(db, "ev-sem-tabela").processing_status, "failed");
  assert.match(evento(db, "ev-sem-tabela").error_message, /migração 202611110002/);

  // A tarefa do tick sem a tabela termina sem erro.
  licencaDoPedido.situacao = SITUACOES.em_dia;
  assert.equal((await rodada(db)).missingMigration, true);

  // O reembolso continua passando.
  assert.equal((await postar(compra({ evento: "PURCHASE_REFUNDED", id: "ev-sem-tabela-reembolso", transacao: "HP-S" }))).status, 200);

  // Com a Licenca permitindo, a venda libera como sempre, mesmo sem a tabela.
  const emDia = await postar(compra({ email: "em-dia@teste.test", id: "ev-sem-tabela-em-dia", transacao: "HP-S2" }));
  assert.equal(emDia.corpo.outcome, "access_granted");
  assert.equal(acessosDe(db, "em-dia@teste.test").length, 1);
});

test("o Reprocessar de uma venda com a Licença barrando também guarda (e não libera)", async () => {
  const db = escola();
  actionStubs.db = db;
  // A venda chegou com o codigo ainda sem ligacao: ignorada, com Reprocessar.
  db.linhas("sales_product_links").splice(0, 1);
  await postar(compra({ id: "ev-reprocessar", transacao: "HP-RP" }));
  assert.equal(evento(db, "ev-reprocessar").processing_status, "ignored");

  // O dono liga o codigo e reprocessa com a escola congelada.
  db.linhas("sales_product_links").push({ combo_id: null, external_product_id: "7001", product_id: "curso-a", provider: "hotmart" });
  const resultado = await reprocessWebhookEvent(db, { id: evento(db, "ev-reprocessar").id, siteOrigin: SITE });

  assert.deepEqual({ ok: resultado.ok, outcome: resultado.outcome, processingStatus: resultado.processingStatus }, { ok: true, outcome: "held", processingStatus: "processed" });
  assert.equal(guardadas(db).length, 1);
  assert.equal(contaDe(db, "compradora@teste.test"), null);
});

test("a última trava em grantResolvedProducts: sem a matrícula, só passa o acesso que já existia", async () => {
  const db = escola();
  actionStubs.db = db;
  licencaDoPedido.situacao = SITUACOES.em_dia;
  await postar(compra({ id: "ev-a", transacao: "HP-A" }));
  const aluna = contaDe(db, "compradora@teste.test");

  licencaDoPedido.situacao = SITUACOES.escola_congelada;
  const base = { actorId: EQUIPE[0].id, endsAt: null, source: "admin", sourceProvider: "manual", userId: aluna.id };

  await assert.rejects(grantProductAccess({ ...base, productIds: ["curso-b"] }, db), (erro) => erro.name === "LicenseRestrictionError" && erro.status === 403);
  assert.equal(acessosDe(db, "compradora@teste.test").length, 1);

  const renovado = await grantProductAccess({ ...base, productIds: ["curso-a"] }, db);
  assert.equal(renovado.granted.length, 1, "a renovacao do que ja existia passa");
});

/* ------------------------------------------------------------------------------------------------
 * A tarefa do tick, a lista e a faixa
 * ---------------------------------------------------------------------------------------------- */

test("a tarefa vendas-guardadas do registro roda a rodada com o banco do tick", async () => {
  const db = escola();
  actionStubs.db = db;
  await postar(compra({ id: "ev-1", transacao: "HP-1" }));
  licencaDoPedido.situacao = SITUACOES.em_dia;

  await heldSalesJob.run({ runId: "r", signal: new AbortController().signal, supabase: db, tickRunId: "t", tickStartedAt: new Date() });

  assert.equal(heldSalesJob.name, "vendas-guardadas");
  assert.equal(guardadas(db)[0].status, "granted");
});

test("a lista das vendas guardadas: nome, e-mail, produtos e motivo; a faixa conta e leva à lista", async () => {
  const db = escola();
  actionStubs.db = db;
  await postar(compra({ email: "lista@teste.test", id: "ev-1", nome: "Pessoa da Lista", produto: "7002", transacao: "HP-1" }));

  const lista = await getHeldSalesOverview(db);
  assert.equal(lista.count, 1);
  assert.deepEqual(
    { ...lista.items[0], heldAt: undefined, id: undefined, receivedAt: undefined },
    {
      attempts: 0,
      buyerEmail: "lista@teste.test",
      buyerName: "Pessoa da Lista",
      heldAt: undefined,
      id: undefined,
      lastError: null,
      products: ["Curso A", "Curso B"],
      providerLabel: "Hotmart",
      reason: "escola_congelada",
      reasonTitle: "Escola congelada",
      receivedAt: undefined
    }
  );
  assert.equal(await countHeldSalesForBanner(db), 1);

  const faixa = model.withHeldSalesBanner(licenseBannerOf(SITUACOES.escola_congelada, { configuredHost: SITE }), 1, false);
  assert.equal(faixa.heldSales.count, 1);
  assert.match(faixa.heldSales.text, /^1 venda está guardada/);
  const desenho = renderToStaticMarkup(createElement(LicenseBanner, { banner: faixa, canManage: true, checkNowAction: async () => {} }));
  assert.match(desenho, /data-held-sales="1"/);
  assert.match(desenho, /href="\/admin\/configuracoes\/licenca#vendas-guardadas"/);

  // A Licenca em dia e venda ainda guardada: uma faixa so delas ate a tarefa terminar.
  const soDelas = model.withHeldSalesBanner(licenseBannerOf(SITUACOES.em_dia, { configuredHost: SITE }), 3, true);
  assert.equal(soDelas.title, "Vendas guardadas");
  assert.match(soDelas.heldSales.text, /^3 vendas guardadas estão sendo liberadas/);
  assert.equal(model.withHeldSalesBanner(null, 0, true), null, "sem venda guardada, nada muda");
});

test("o e-mail da equipe: o motivo, a liberação automática e o link da lista, sem quem comprou", () => {
  const email = renderHeldSalesEmail({ licenseScreenUrl: `${SITE}/admin/configuracoes/licenca#vendas-guardadas`, reasonLabel: "Escola congelada" });

  assert.equal(email.subject, "Uma venda ficou guardada");
  assert.match(email.text, /\(Escola congelada\)/);
  assert.match(email.text, /liberadas sozinhas, na ordem em que chegaram/);
  assert.match(email.text, /reembolsada ou contestada antes disso é descartada/);
  assert.match(email.html, /licenca#vendas-guardadas/);
  assert.doesNotMatch(email.text, /bloquead/i);
});

/* ------------------------------------------------------------------------------------------------
 * As regras puras
 * ---------------------------------------------------------------------------------------------- */

test("a decisão e o motivo vêm da classe matrícula, a mesma pergunta do admin", () => {
  assert.deepEqual(model.newAccessDecisionOf({ mode: "off" }), { allowed: true });
  assert.deepEqual(model.newAccessDecisionOf(SITUACOES.em_dia), { allowed: true });
  assert.deepEqual(model.newAccessDecisionOf(SITUACOES.admin_limitado), { allowed: true });
  assert.deepEqual(model.newAccessDecisionOf(SITUACOES.escola_congelada), { allowed: false, reason: "escola_congelada" });
  assert.deepEqual(model.newAccessDecisionOf(SITUACOES.nao_ativada), { allowed: false, reason: "nao_ativada" });
  assert.deepEqual(model.newAccessDecisionOf(SITUACOES.endereco_diferente), { allowed: false, reason: "endereco_diferente" });
  assert.deepEqual(model.newAccessDecisionOf(null), { allowed: false, reason: "leitura_falhou" });

  assert.deepEqual(model.splitHeldProducts(["a", "b", "c"], (id) => id === "b"), { held: ["a", "c"], now: ["b"] });
  assert.equal(model.heldSaleReasonLabel("codigo_de_uma_versao_nova"), model.HELD_SALE_REASON_LABELS.acesso_novo_barrado);

  // O episodio: o degrau e o dia em que comecou; a copia nunca ativada, um so; a leitura que falha, um por dia.
  const congelada = model.heldSalesEpisodeOf(SITUACOES.escola_congelada, AGORA);
  assert.equal(congelada.marker, "escola_congelada:2026-11-10");
  assert.equal(congelada.since.toISOString(), ONTEM);
  assert.deepEqual(model.heldSalesEpisodeOf(SITUACOES.nao_ativada, AGORA), { marker: "nao_ativada", since: null });
  const semLeitura = model.heldSalesEpisodeOf(null, AGORA);
  assert.equal(semLeitura.marker, "leitura_falhou:2026-11-11");
  assert.equal(semLeitura.since.toISOString(), "2026-11-11T03:00:00.000Z", "a meia-noite de Brasilia");
  assert.equal(model.heldInEpisode("2026-11-10T13:00:00.000Z", congelada), true);
  assert.equal(model.heldInEpisode("2026-11-09T13:00:00.000Z", congelada), false, "guardada num episodio anterior");
  assert.equal(model.heldInEpisode("2020-01-01T00:00:00.000Z", { since: null }), true);
  assert.equal(model.heldInEpisode(null, congelada), false);
});

/* ------------------------------------------------------------------------------------------------
 * O modo "off"
 * ---------------------------------------------------------------------------------------------- */

test("modo off: a venda libera como sempre, o reembolso revoga como sempre e nada toca em held_sales", async () => {
  delete process.env.BUNKER_LICENSING_MODE;
  // Mesmo uma situacao que barraria: no "off" a licenca nao manda (a situacao do pedido e so o modo).
  licencaDoPedido.situacao = { mode: "off" };
  const db = escola();
  actionStubs.db = db;

  const resposta = await postar(compra({ id: "ev-off", transacao: "HP-OFF" }));
  assert.equal(resposta.corpo.outcome, "access_granted");
  assert.equal(acessosDe(db, "compradora@teste.test").length, 1);

  await postar(compra({ evento: "PURCHASE_REFUNDED", id: "ev-off-reembolso", transacao: "HP-OFF" }));
  assert.equal(acessosDe(db, "compradora@teste.test")[0].status, "revoked");

  const antes = db.chamadas.length;
  assert.deepEqual(await rodada(db), { mode: "off" });
  await heldSalesJob.run({ runId: "r", signal: new AbortController().signal, supabase: db, tickRunId: "t", tickStartedAt: new Date() });
  assert.equal(db.chamadas.length, antes, "a tarefa do tick nem le o banco");
  assert.equal(await getHeldSalesOverview(db), null);
  assert.equal(await countHeldSalesForBanner(db), 0);
  assert.equal(tocouGuardadas(db), false, "nenhuma consulta a held_sales no modo off");
  assert.equal(emails(db, "held_sales").length, 0);
});
