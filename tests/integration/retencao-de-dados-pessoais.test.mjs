import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, readLocalSupabaseConfig, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, SENHA_DE_TESTE, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Retencao de dados pessoais por idade (docs/06, secao LGPD; migracao 202610170004) contra o banco LOCAL
// de verdade: `public.prune_personal_data()` anonimiza vendas recebidas com mais de 12 meses e e-mails da
// fila com mais de 90 dias (enviados) ou 180 dias (falhas, bounces e o que ficou na fila), apaga os eventos
// brutos do Resend com mais de 90 dias, deixa o recente inteiro, nao muda nada na segunda rodada e so o
// servidor pode chama-la. A tela de Vendas continua listando a venda anonimizada, sem e-mail e sem
// Reprocessar. Nenhum e-mail sai e nenhum webhook e chamado: as linhas antigas sao gravadas pelo teste.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const salesQueries = await import("../../src/server/payments/queries.ts");
const salesActions = await import("../../src/server/payments/actions.ts");
const salesStore = await import("../../src/server/payments/store.ts");
const outbox = await import("../../src/server/email/outbox.ts");

const produtor = usuarioDeTeste(contas.produtor);
const PREFIXO = "teste-retencao-";
const CHAVE = "teste-retencao:";
const DIA_MS = 24 * 60 * 60 * 1000;
const haDias = (dias) => new Date(Date.now() - dias * DIA_MS).toISOString();
const SEM_TITULOS = { combos: new Map(), products: new Map() };

/** Venda recebida FICTICIA, gravada direto na tabela com a data que o teste quiser. */
async function gravarVenda({ sufixo, diasAtras, status = "processed", outcome = "access_granted" }) {
  const email = `${sufixo}@bunker707.test`;
  const row = unwrap(
    await db
      .from("webhook_events")
      .insert({
        buyer_email: email,
        error_message: status === "failed" ? "Falha fictícia ao processar" : null,
        event_type: "PURCHASE_APPROVED",
        external_event_id: `${PREFIXO}${sufixo}`,
        external_product_id: "7001",
        external_product_name: "Produto fictício na Hotmart",
        normalized_type: "purchase_approved",
        outcome,
        outcome_detail: "1 produto liberado; conta nova.",
        payload: { data: { buyer: { email, name: "Comprador Fictício" }, product: { id: 7001 } }, event: "PURCHASE_APPROVED" },
        processed_at: haDias(diasAtras),
        processing_status: status,
        provider: "hotmart",
        received_at: haDias(diasAtras),
        signature_valid: true
      })
      .select("id")
      .single(),
    `Gravando venda de teste ${sufixo}`
  );

  return row.id;
}

/** Linha da fila de e-mail FICTICIA, gravada direto com a data de criacao que o teste quiser. */
async function gravarEmail({ sufixo, diasAtras, status, extra = {} }) {
  const row = unwrap(
    await db
      .from("email_outbox")
      .insert({
        created_at: haDias(diasAtras),
        html: `<p>Olá, ${sufixo}</p>`,
        idempotency_key: `${CHAVE}${sufixo}:${randomBytes(4).toString("hex")}`,
        kind: "welcome",
        last_error: status === "failed" ? "Falha fictícia do provedor" : null,
        metadata: { password_hint: "none" },
        sent_at: status === "sent" ? haDias(diasAtras) : null,
        status,
        subject: "Assunto de teste",
        text: `Olá, ${sufixo}`,
        to_email: `${sufixo}@bunker707.test`,
        ...extra
      })
      .select("id")
      .single(),
    `Gravando e-mail de teste ${sufixo}`
  );

  return row.id;
}

async function gravarEventoDoResend({ sufixo, diasAtras }) {
  unwrap(
    await db.from("email_webhook_events").insert({
      event_id: `${PREFIXO}${sufixo}`,
      event_type: "email.delivered",
      payload: { data: { to: [`${sufixo}@bunker707.test`] }, type: "email.delivered" },
      provider: "resend",
      received_at: haDias(diasAtras)
    }),
    `Gravando evento do Resend ${sufixo}`
  );
}

async function vendas() {
  return unwrap(
    await db
      .from("webhook_events")
      .select("id,external_event_id,payload,buyer_email,error_message,anonymized_at,processing_status,outcome,outcome_detail,external_product_name,received_at")
      .like("external_event_id", `${PREFIXO}%`)
      .order("external_event_id"),
    "Lendo vendas de teste"
  );
}

async function emails() {
  return unwrap(
    // A lista do job nao traz anonymized_at de proposito (funciona antes da 0004); aqui o teste pede a mais.
    await db.from("email_outbox").select(`${outbox.EMAIL_OUTBOX_COLUMNS},anonymized_at`).like("idempotency_key", `${CHAVE}%`).order("idempotency_key"),
    "Lendo e-mails de teste"
  );
}

async function eventosDoResend() {
  return unwrap(await db.from("email_webhook_events").select("event_id").like("event_id", `${PREFIXO}%`).order("event_id"), "Lendo eventos do Resend de teste");
}

async function podar() {
  return unwrap(await db.rpc("prune_personal_data"), "Rodando a retencao");
}

async function limpar() {
  unwrap(await db.from("webhook_events").delete().like("external_event_id", `${PREFIXO}%`), "Limpando vendas de teste");
  unwrap(await db.from("email_outbox").delete().like("idempotency_key", `${CHAVE}%`), "Limpando e-mails de teste");
  unwrap(await db.from("email_webhook_events").delete().like("event_id", `${PREFIXO}%`), "Limpando eventos do Resend de teste");
}

before(limpar);
after(limpar);

const ids = { vendaAntiga: "", vendaIgnoradaAntiga: "", vendaIgnoradaRecente: "" };

test("venda com mais de 12 meses perde payload, e-mail do comprador e erro; o resultado fica e a venda recente continua inteira", async () => {
  ids.vendaAntiga = await gravarVenda({ diasAtras: 370, sufixo: "venda-antiga" });
  await gravarVenda({ diasAtras: 370, outcome: "failed", status: "failed", sufixo: "venda-antiga-falha" });
  await gravarVenda({ diasAtras: 30, sufixo: "venda-recente" });

  const resultado = await podar();
  assert.ok(resultado.webhook_events >= 2, `a rotina devolve quantas vendas mudaram: ${JSON.stringify(resultado)}`);

  const porId = new Map((await vendas()).map((row) => [row.external_event_id, row]));
  const antiga = porId.get(`${PREFIXO}venda-antiga`);
  assert.ok(antiga.anonymized_at, "a venda antiga ganha a marca da retencao");
  assert.deepEqual(antiga.payload, {});
  assert.equal(antiga.buyer_email, null);
  assert.equal(antiga.error_message, null);
  assert.equal(antiga.processing_status, "processed", "o resultado do processamento fica");
  assert.equal(antiga.outcome, "access_granted");
  assert.equal(antiga.outcome_detail, "1 produto liberado; conta nova.");
  assert.equal(antiga.external_product_name, "Produto fictício na Hotmart", "o nome do produto nao e dado pessoal e fica");

  const antigaComFalha = porId.get(`${PREFIXO}venda-antiga-falha`);
  assert.ok(antigaComFalha.anonymized_at);
  assert.equal(antigaComFalha.error_message, null, "o erro guardado tambem sai");
  assert.equal(antigaComFalha.processing_status, "failed");

  const recente = porId.get(`${PREFIXO}venda-recente`);
  assert.equal(recente.anonymized_at, null, "a venda recente nao e tocada");
  assert.equal(recente.buyer_email, "venda-recente@bunker707.test");
  assert.equal(recente.payload.data.buyer.email, "venda-recente@bunker707.test");
});

test("a tela de Vendas lista a venda anonimizada sem e-mail e sem Reprocessar; reprocessar responde 409 com o motivo", async () => {
  ids.vendaIgnoradaAntiga = await gravarVenda({ diasAtras: 400, outcome: "ignored", status: "ignored", sufixo: "ignorada-antiga" });
  ids.vendaIgnoradaRecente = await gravarVenda({ diasAtras: 0, outcome: "ignored", status: "ignored", sufixo: "ignorada-recente" });
  await podar();

  // A mesma consulta e o mesmo mapeamento da tela, sem o corte das 50 mais recentes (o banco local e compartilhado).
  const linhas = await salesStore.listWebhookEvents(db, { limit: 10000 });
  const antiga = salesQueries.toSalesEventListItem(linhas.find((row) => row.id === ids.vendaIgnoradaAntiga), SEM_TITULOS);
  assert.ok(antiga.anonymizedAt);
  assert.equal(antiga.buyerEmail, null);
  assert.equal(antiga.canReprocess, false, "sem payload nao ha o que reprocessar");
  assert.equal(antiga.outcome, "ignored");
  assert.equal(antiga.productTitle, "Produto fictício na Hotmart");

  const recente = salesQueries.toSalesEventListItem(linhas.find((row) => row.id === ids.vendaIgnoradaRecente), SEM_TITULOS);
  assert.equal(recente.anonymizedAt, null);
  assert.equal(recente.buyerEmail, "ignorada-recente@bunker707.test");
  assert.equal(recente.canReprocess, true, "a venda ignorada recente continua reprocessavel");

  // A tela inteira carrega com a linha anonimizada no meio das outras.
  const tela = await salesQueries.getSalesSettingsData();
  assert.ok(Array.isArray(tela.events) && tela.events.length > 0);

  for (const item of tela.events.filter((event) => event.anonymizedAt)) {
    assert.equal(item.buyerEmail, null, `venda anonimizada sem e-mail na tela: ${item.id}`);
    assert.equal(item.canReprocess, false, `venda anonimizada sem Reprocessar na tela: ${item.id}`);
  }

  actAs(produtor);
  const resultado = await salesActions.reprocessSalesEvent({ id: ids.vendaIgnoradaAntiga });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.status, 409);
  assert.match(resultado.error, /12 meses/);
  assert.equal((await vendas()).find((row) => row.id === ids.vendaIgnoradaAntiga).processing_status, "ignored", "a linha nao muda ao recusar");
});

test("e-mail enviado com mais de 90 dias perde destinatário, HTML, texto e erro; o recente e a falha com menos de 180 dias ficam", async () => {
  await gravarEmail({ diasAtras: 91, status: "sent", sufixo: "enviado-antigo" });
  await gravarEmail({ diasAtras: 10, status: "sent", sufixo: "enviado-recente" });
  await gravarEmail({ diasAtras: 100, status: "failed", sufixo: "falha-recente" });
  await gravarEmail({ diasAtras: 181, status: "failed", sufixo: "falha-antiga" });
  await gravarEmail({ diasAtras: 181, extra: { bounced_at: haDias(180), last_error: "Bounce fictício" }, status: "bounced", sufixo: "bounce-antigo" });
  await gravarEmail({ diasAtras: 181, status: "queued", sufixo: "fila-antiga" });

  const resultado = await podar();
  assert.ok(resultado.email_outbox >= 4, `a rotina devolve quantos e-mails mudaram: ${JSON.stringify(resultado)}`);

  const porSufixo = new Map((await emails()).map((row) => [row.idempotency_key.slice(CHAVE.length).split(":")[0], row]));

  const enviadoAntigo = porSufixo.get("enviado-antigo");
  assert.ok(enviadoAntigo.anonymized_at, "o e-mail enviado ha mais de 90 dias ganha a marca");
  assert.equal(enviadoAntigo.to_email, null);
  assert.equal(enviadoAntigo.html, null);
  assert.equal(enviadoAntigo.text, null);
  assert.equal(enviadoAntigo.last_error, null);
  assert.equal(enviadoAntigo.status, "sent", "o status fica");
  assert.ok(enviadoAntigo.sent_at, "a data de envio fica");
  assert.equal(enviadoAntigo.subject, "Assunto de teste", "o assunto nao leva o nome do aluno e fica");
  assert.deepEqual(enviadoAntigo.metadata, { password_hint: "none" }, "metadata so tem ids e rotulos e fica");
  assert.match(enviadoAntigo.idempotency_key, /^teste-retencao:enviado-antigo:/, "a chave de idempotencia fica");

  const enviadoRecente = porSufixo.get("enviado-recente");
  assert.equal(enviadoRecente.anonymized_at, null);
  assert.equal(enviadoRecente.to_email, "enviado-recente@bunker707.test");
  assert.equal(enviadoRecente.html, "<p>Olá, enviado-recente</p>");

  const falhaRecente = porSufixo.get("falha-recente");
  assert.equal(falhaRecente.anonymized_at, null, "falha com menos de 180 dias fica inteira para diagnostico");
  assert.equal(falhaRecente.last_error, "Falha fictícia do provedor");
  assert.equal(falhaRecente.to_email, "falha-recente@bunker707.test");

  const falhaAntiga = porSufixo.get("falha-antiga");
  assert.ok(falhaAntiga.anonymized_at);
  assert.equal(falhaAntiga.status, "failed");
  assert.equal(falhaAntiga.to_email, null);
  assert.equal(falhaAntiga.last_error, null);

  const bounceAntigo = porSufixo.get("bounce-antigo");
  assert.ok(bounceAntigo.anonymized_at);
  assert.equal(bounceAntigo.status, "bounced", "o bounce continua registrado");
  assert.ok(bounceAntigo.bounced_at);
  assert.equal(bounceAntigo.last_error, null);

  const filaAntiga = porSufixo.get("fila-antiga");
  assert.ok(filaAntiga.anonymized_at);
  assert.equal(filaAntiga.status, "failed", "o que ficou na fila por 180 dias nao sai mais");
  assert.match(filaAntiga.last_error, /retenção/);
  assert.equal(filaAntiga.to_email, null);
});

test("evento bruto do Resend com mais de 90 dias é apagado; o recente fica", async () => {
  await gravarEventoDoResend({ diasAtras: 91, sufixo: "resend-antigo" });
  await gravarEventoDoResend({ diasAtras: 10, sufixo: "resend-recente" });

  const resultado = await podar();
  assert.ok(resultado.email_webhook_events >= 1, JSON.stringify(resultado));
  assert.deepEqual((await eventosDoResend()).map((row) => row.event_id), [`${PREFIXO}resend-recente`]);
});

test("rodar de novo não muda nada: a marca da anonimização e as linhas recentes continuam iguais", async () => {
  const vendasAntes = await vendas();
  const emailsAntes = await emails();
  const eventosAntes = await eventosDoResend();
  assert.ok(vendasAntes.some((row) => row.anonymized_at) && vendasAntes.some((row) => !row.anonymized_at));

  await podar();

  assert.deepEqual(await vendas(), vendasAntes);
  assert.deepEqual(await emails(), emailsAntes);
  assert.deepEqual(await eventosDoResend(), eventosAntes);
});

test("visitante e aluna não conseguem chamar a rotina; só o servidor", async () => {
  const { anonKey, url } = readLocalSupabaseConfig();
  const visitante = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const comoVisitante = await visitante.rpc("prune_personal_data");
  assert.ok(comoVisitante.error, "anon nao executa a funcao");
  assert.match(comoVisitante.error.message, /permission denied/i);

  const aluna = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const login = await aluna.auth.signInWithPassword({ email: ESCOLA_DE_TESTE.contas.aluna.email, password: SENHA_DE_TESTE });
  assert.equal(login.error, null, "a aluna entra no Auth local");
  const comoAluna = await aluna.rpc("prune_personal_data");
  assert.ok(comoAluna.error, "authenticated nao executa a funcao");
  assert.match(comoAluna.error.message, /permission denied/i);
  await aluna.auth.signOut();
});
