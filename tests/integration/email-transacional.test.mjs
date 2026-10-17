import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { provedorDeEmailFalso } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, apagarContaDeTeste, seedEscolaDeTeste } from "../fixtures/escola-de-teste.mjs";

// E-mail transacional (docs/04, secao E-mail) contra o banco LOCAL de verdade e um provedor falso
// (tests/support/integration-email-provider.mjs): uma venda por webhook cria a conta e enfileira
// boas-vindas e o e-mail de compra, uma vez so; o admin so manda boas-vindas quando escolheu enviar algo;
// o job `email-outbox` do tick envia pelo provedor com a chave de idempotencia, respeita o limite
// diario, tenta de novo com espera e desiste na quinta falha; o webhook do Resend so aceita pedido
// assinado, nao reaplica o mesmo evento e marca bounce, reclamacao e entrega na linha. Nenhum e-mail sai.

const db = createLocalAdminClient();
await seedEscolaDeTeste(db);
const access = await import("../../src/server/students/access.ts");
const outbox = await import("../../src/server/email/outbox.ts");
const { EXPIRED_IN_QUEUE_ERROR, MAX_EMAIL_ATTEMPTS } = await import("../../src/server/email/outbox-rules.ts");
const { signSvixPayload } = await import("../../src/server/email/webhook-signature.ts");
const { runJobsTick } = await import("../../src/server/jobs/run-tick.ts");
const { jobRegistry } = await import("../../src/server/jobs/registry.ts");
const { EMAIL_OUTBOX_JOB_NAME } = await import("../../src/server/jobs/email-outbox-job.ts");
const webhookRoute = await import("../../src/app/api/webhooks/resend/route.ts");

const { curso, cursoLiberacao } = ESCOLA_DE_TESTE;
const COMPRADOR = { email: "comprador.webhook.email@bunker707.test", nome: "Comprador Webhook" };
const ADMIN_NONE = { email: "aluno.sem-envio.email@bunker707.test", nome: "Aluno Sem Envio" };
const ADMIN_TEMP = { email: "aluno.senha-temp.email@bunker707.test", nome: "Aluno Senha Temporária" };
const FILA = { email: "fila.email@bunker707.test" };
const TODOS_OS_EMAILS = [COMPRADOR.email, ADMIN_NONE.email, ADMIN_TEMP.email, FILA.email];
const REDIRECT_TO = "http://127.0.0.1:3100/auth/callback?next=%2Falterar-senha&provider=email";
const SEGREDO_DO_WEBHOOK = `whsec_${randomBytes(24).toString("base64")}`;
const envOriginal = { RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET };

async function limpar() {
  unwrap(await db.from("email_webhook_events").delete().like("event_id", "teste-%"), "Limpando eventos de teste");
  unwrap(await db.from("email_outbox").delete().in("to_email", TODOS_OS_EMAILS), "Limpando a fila de teste");

  for (const conta of [COMPRADOR, ADMIN_NONE, ADMIN_TEMP]) {
    await apagarContaDeTeste(db, conta.email);
  }
}

before(async () => {
  await limpar();
  provedorDeEmailFalso.zerar();
});

after(async () => {
  await limpar();
  provedorDeEmailFalso.zerar();
  process.env.RESEND_WEBHOOK_SECRET = envOriginal.RESEND_WEBHOOK_SECRET;
});

const estado = { compradorId: "", filaIds: [] };

async function filaDe(email) {
  return unwrap(
    await db.from("email_outbox").select(outbox.EMAIL_OUTBOX_COLUMNS).eq("to_email", email).order("created_at"),
    `Lendo a fila de ${email}`
  );
}

async function linha(id) {
  return unwrap(await db.from("email_outbox").select(outbox.EMAIL_OUTBOX_COLUMNS).eq("id", id).single(), "Lendo a linha da fila");
}

/** Enfileira um e-mail de teste direto na fila (sem passar por Alunos) e devolve o id. */
async function enfileirar(sufixo, extra = {}) {
  const { id } = await outbox.enqueueEmail(db, {
    html: "<p>teste</p>",
    idempotencyKey: `teste:${sufixo}:${randomBytes(4).toString("hex")}`,
    kind: "welcome",
    subject: `Teste ${sufixo}`,
    text: "teste",
    to: FILA.email,
    userId: null,
    ...extra
  });
  estado.filaIds.push(id);

  return id;
}

async function processar(overrides = {}) {
  return outbox.processEmailOutbox({
    dailyLimit: 1000,
    db,
    from: "Teste <teste@bunker707.test>",
    pauseMs: 0,
    provider: { name: "fake", send: (message) => (provedorDeEmailFalso.enviados.push(message), provedorDeEmailFalso.responder(message)) },
    replyTo: null,
    ...overrides
  });
}

const vendaPorWebhook = (sourceEventId, productIds, extra = {}) => ({
  actorId: null,
  delivery: "none",
  email: COMPRADOR.email,
  endsAt: null,
  fullName: COMPRADOR.nome,
  phone: null,
  productIds,
  redirectTo: REDIRECT_TO,
  source: "webhook",
  sourceEventId,
  sourceProvider: "hotmart",
  ...extra
});

test("venda por webhook: a conta nasce e entram na fila as boas-vindas e o e-mail de compra, com os links do site", async () => {
  const result = await access.provisionStudentAccess(vendaPorWebhook("teste-venda-1", [curso.id]));
  estado.compradorId = result.id;
  assert.equal(result.existingAccount, false);

  const fila = await filaDe(COMPRADOR.email);
  assert.deepEqual(fila.map((row) => [row.kind, row.status]), [["welcome", "queued"], ["purchase", "queued"]]);

  const [boasVindas, compra] = fila;
  assert.equal(boasVindas.idempotency_key, `welcome:${result.id}`);
  assert.equal(boasVindas.user_id, result.id);
  assert.equal(boasVindas.subject, "Seu acesso à Bunker707 está pronto");
  assert.match(boasVindas.html, /Olá, Comprador!/);
  assert.match(boasVindas.html, /href="http:\/\/127\.0\.0\.1:3100\/login"/, "o link usa a origem do request que disparou");
  assert.match(boasVindas.text, /Esqueci minha senha/, "venda sem senha: ensina a criar a senha");
  assert.deepEqual(boasVindas.metadata, { password_hint: "none" });

  assert.equal(compra.idempotency_key, `purchase:hotmart:teste-venda-1:${result.id}`);
  assert.equal(compra.subject, `Seu acesso a ${curso.titulo} foi liberado`);
  assert.match(compra.html, new RegExp(`href="http://127\\.0\\.0\\.1:3100/conteudo/${curso.id}"`));
  assert.deepEqual(compra.metadata, { product_ids: [curso.id], source_event_id: "teste-venda-1", source_provider: "hotmart" });
});

test("o mesmo evento de venda processado de novo nao duplica nenhum e-mail", async () => {
  const result = await access.provisionStudentAccess(vendaPorWebhook("teste-venda-1", [curso.id]));

  assert.equal(result.existingAccount, true);
  assert.equal((await filaDe(COMPRADOR.email)).length, 2);
});

test("outra compra pelo webhook gera outro e-mail de compra; prazo a mais num acesso ja aberto nao gera", async () => {
  const outra = await access.grantProductAccess({
    actorId: null,
    endsAt: null,
    productIds: [cursoLiberacao.id],
    siteOrigin: "https://app.exemplo.test",
    source: "webhook",
    sourceEventId: "teste-venda-2",
    sourceProvider: "ticto",
    userId: estado.compradorId
  });
  assert.equal(outra.granted.length, 1);

  const fila = await filaDe(COMPRADOR.email);
  assert.equal(fila.length, 3);
  assert.equal(fila[2].idempotency_key, `purchase:ticto:teste-venda-2:${estado.compradorId}`);
  assert.match(fila[2].html, new RegExp(`href="https://app\\.exemplo\\.test/conteudo/${cursoLiberacao.id}"`), "o webhook pode informar a origem");
  assert.match(fila[2].subject, new RegExp(cursoLiberacao.titulo));

  await access.grantProductAccess({
    actorId: null,
    endsAt: "2099-12-31",
    productIds: [cursoLiberacao.id],
    source: "webhook",
    sourceEventId: "teste-venda-3",
    sourceProvider: "ticto",
    userId: estado.compradorId
  });
  assert.equal((await filaDe(COMPRADOR.email)).length, 3, "quem ja tinha o acesso aberto nao recebe aviso de compra");
});

test("liberar acesso pela equipe nao manda e-mail de compra", async () => {
  await access.grantProductAccess({
    actorId: estado.compradorId,
    endsAt: null,
    productIds: [curso.id],
    source: "admin",
    sourceProvider: "manual",
    userId: estado.compradorId
  });

  assert.equal((await filaDe(COMPRADOR.email)).length, 3);
});

test("Adicionar aluno: 'Não enviar agora' nao enfileira nada; senha temporaria enfileira boas-vindas com a instrucao certa", async () => {
  const semEnvio = await access.provisionStudentAccess({
    actorId: estado.compradorId,
    delivery: "none",
    email: ADMIN_NONE.email,
    endsAt: null,
    fullName: ADMIN_NONE.nome,
    phone: null,
    productIds: [curso.id],
    redirectTo: REDIRECT_TO,
    source: "admin",
    sourceProvider: "manual"
  });
  assert.equal(semEnvio.existingAccount, false);
  assert.deepEqual(await filaDe(ADMIN_NONE.email), []);

  const comSenha = await access.provisionStudentAccess({
    actorId: estado.compradorId,
    delivery: "temporary_password",
    email: ADMIN_TEMP.email,
    endsAt: null,
    fullName: ADMIN_TEMP.nome,
    phone: null,
    productIds: [],
    redirectTo: REDIRECT_TO,
    source: "admin",
    sourceProvider: "manual"
  });
  assert.ok(comSenha.temporaryPassword);

  const fila = await filaDe(ADMIN_TEMP.email);
  assert.deepEqual(fila.map((row) => row.kind), ["welcome"]);
  assert.match(fila[0].text, /senha temporária/);
  assert.deepEqual(fila[0].metadata, { password_hint: "temporary_password" });
});

test("sem provedor configurado a fila espera: nada sai e as linhas continuam queued", async () => {
  provedorDeEmailFalso.ligado = false;
  const tick = await runJobsTick({ jobs: jobRegistry, supabase: db });
  provedorDeEmailFalso.ligado = true;

  assert.ok(tick.ran.includes(EMAIL_OUTBOX_JOB_NAME), JSON.stringify(tick));
  assert.deepEqual(tick.failed, []);
  assert.equal(provedorDeEmailFalso.enviados.length, 0);
  assert.ok((await filaDe(COMPRADOR.email)).every((row) => row.status === "queued"));
});

test("o job do tick envia a fila pelo provedor com a chave de idempotencia e marca sent com o id do provedor", async () => {
  provedorDeEmailFalso.responder = (message) => ({ ok: true, providerMessageId: `id-${message.idempotencyKey}` });
  const tick = await runJobsTick({ jobs: jobRegistry, supabase: db });

  assert.ok(tick.ran.includes(EMAIL_OUTBOX_JOB_NAME));
  assert.deepEqual(tick.failed, [], JSON.stringify(tick));
  const execucoes = unwrap(await db.from("job_runs").select("job,status").eq("metadata->>tick_run_id", tick.tickRunId), "Lendo job_runs");
  assert.deepEqual(execucoes.filter((row) => row.job === EMAIL_OUTBOX_JOB_NAME).map((row) => row.status), ["succeeded"]);

  const fila = [...(await filaDe(COMPRADOR.email)), ...(await filaDe(ADMIN_TEMP.email))];
  assert.equal(fila.length, 4);

  for (const row of fila) {
    assert.equal(row.status, "sent", row.subject);
    assert.equal(row.attempts, 1);
    assert.equal(row.provider, "fake");
    assert.equal(row.provider_message_id, `id-${row.idempotency_key}`);
    assert.ok(row.sent_at);
    const enviado = provedorDeEmailFalso.enviados.find((message) => message.idempotencyKey === row.idempotency_key);
    assert.ok(enviado, `o provedor recebeu ${row.idempotency_key}`);
    assert.equal(enviado.to, row.to_email);
    assert.equal(enviado.subject, row.subject);
    assert.equal(enviado.from, "Bunker707 <equipe@mail.bunker707.com.br>", "remetente padrao quando EMAIL_FROM esta vazio");
  }

  // Rodar de novo nao envia nada para essas contas: a fila delas ja saiu.
  const paraAsContas = () => provedorDeEmailFalso.enviados.filter((message) => TODOS_OS_EMAILS.includes(message.to)).length;
  const antes = paraAsContas();
  await runJobsTick({ jobs: jobRegistry, supabase: db });
  assert.equal(paraAsContas(), antes);
});

test("limite diario: so sai o que ainda cabe no dia (UTC); com o limite esgotado nada sai; no dia seguinte o resto vai", async () => {
  provedorDeEmailFalso.zerar();
  const enviadosHoje = await outbox.countEmailsSentSince(db, new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())));
  const primeiro = await enfileirar("limite-1");
  const segundo = await enfileirar("limite-2");

  const apertado = await processar({ dailyLimit: enviadosHoje + 1 });
  assert.equal(apertado.sent, 1);
  assert.equal(apertado.remainingToday, 0);
  assert.equal((await linha(primeiro)).status, "sent");
  assert.equal((await linha(segundo)).status, "queued", "o segundo espera o dia seguinte");

  const esgotado = await processar({ dailyLimit: enviadosHoje + 1 });
  assert.equal(esgotado.sent, 0);
  assert.equal(esgotado.queued >= 1, true);
  assert.equal(provedorDeEmailFalso.enviados.length, 1);

  const amanha = new Date(Date.now() + 24 * 60 * 60_000);
  const diaSeguinte = await processar({ dailyLimit: 1, now: amanha });
  assert.equal(diaSeguinte.sent, 1);
  assert.equal((await linha(segundo)).status, "sent");
});

test("erro passageiro: a linha volta para a fila com espera e conta a tentativa; antes da hora nao sai de novo", async () => {
  provedorDeEmailFalso.zerar();
  provedorDeEmailFalso.responder = () => ({ error: "HTTP 500: application_error", ok: false, outcome: "retry" });
  const id = await enfileirar("retry");
  const antes = Date.now();

  const result = await processar();
  assert.equal(result.retried, 1);
  const row = await linha(id);
  assert.equal(row.status, "queued");
  assert.equal(row.attempts, 1);
  assert.equal(row.last_error, "HTTP 500: application_error");
  assert.ok(Date.parse(row.next_attempt_at) >= antes + 59_000, "espera pelo menos 1 minuto");

  provedorDeEmailFalso.responder = () => ({ ok: true, providerMessageId: "nao-deveria" });
  await processar();
  assert.equal((await linha(id)).status, "queued", "ainda nao chegou a hora da nova tentativa");
  assert.equal(provedorDeEmailFalso.enviados.length, 1);

  // Quando chega a hora, sai, e a segunda tentativa fica registrada.
  const depois = await processar({ now: new Date(Date.parse(row.next_attempt_at) + 1_000) });
  assert.equal(depois.sent, 1);
  assert.deepEqual([(await linha(id)).status, (await linha(id)).attempts], ["sent", 2]);
});

test("erro definitivo vira failed na hora; na quinta falha passageira a linha tambem desiste", async () => {
  provedorDeEmailFalso.zerar();
  provedorDeEmailFalso.responder = () => ({ error: "HTTP 422: validation_error: Invalid `to`", ok: false, outcome: "fail" });
  const definitivo = await enfileirar("fail");
  await processar();
  assert.deepEqual([(await linha(definitivo)).status, (await linha(definitivo)).attempts], ["failed", 1]);
  assert.match((await linha(definitivo)).last_error, /validation_error/);

  const cansado = await enfileirar("dead-letter");
  unwrap(await db.from("email_outbox").update({ attempts: MAX_EMAIL_ATTEMPTS - 1 }).eq("id", cansado), "Simulando tentativas anteriores");
  provedorDeEmailFalso.responder = () => ({ error: "HTTP 500", ok: false, outcome: "retry" });
  await processar();
  assert.deepEqual([(await linha(cansado)).status, (await linha(cansado)).attempts], ["failed", MAX_EMAIL_ATTEMPTS]);
});

test("limite do provedor (429): a linha volta sem contar tentativa, o lote para e o resto fica para o proximo tick", async () => {
  provedorDeEmailFalso.zerar();
  provedorDeEmailFalso.responder = () => ({ error: "HTTP 429: rate_limit_exceeded", ok: false, outcome: "throttle", retryAfterMs: 60_000 });
  const primeiro = await enfileirar("throttle-1");
  const segundo = await enfileirar("throttle-2");

  const result = await processar();
  assert.equal(result.throttled, true);
  assert.equal(result.sent, 0);
  assert.equal(provedorDeEmailFalso.enviados.length, 1, "parou no primeiro");
  assert.deepEqual([(await linha(primeiro)).status, (await linha(primeiro)).attempts], ["queued", 0]);
  assert.ok(Date.parse((await linha(primeiro)).next_attempt_at) > Date.now() + 30_000);
  const intocado = await linha(segundo);
  assert.equal(intocado.status, "queued");
  assert.equal(intocado.attempts, 0);
  assert.equal(intocado.last_error, null);

  provedorDeEmailFalso.responder = () => ({ ok: true, providerMessageId: "ok" });
  const proximo = await processar();
  assert.equal(proximo.sent, 1, "o segundo sai no tick seguinte; o primeiro espera a hora");
  assert.equal((await linha(segundo)).status, "sent");
});

test("e-mail parado na fila ha mais de 7 dias expira em vez de sair atrasado; o orcamento do tick interrompe o lote", async () => {
  provedorDeEmailFalso.zerar();
  const velho = await enfileirar("expirado");
  unwrap(await db.from("email_outbox").update({ created_at: new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString() }).eq("id", velho), "Envelhecendo a linha");
  const result = await processar();
  assert.equal(result.expired, 1);
  assert.deepEqual([(await linha(velho)).status, (await linha(velho)).last_error], ["failed", EXPIRED_IN_QUEUE_ERROR]);

  const semTempo = await enfileirar("sem-tempo");
  const controller = new AbortController();
  controller.abort();
  const interrompido = await processar({ signal: controller.signal });
  assert.equal(interrompido.stoppedByBudget, true);
  assert.equal((await linha(semTempo)).status, "queued");
  assert.equal(provedorDeEmailFalso.enviados.length, 0);
});

function pedidoDoWebhook({ assinar = true, id = `teste-${randomBytes(6).toString("hex")}`, payload, segredo = SEGREDO_DO_WEBHOOK, timestamp = Math.floor(Date.now() / 1000) }) {
  const body = JSON.stringify(payload);
  const headers = { "content-type": "application/json" };

  if (assinar) {
    Object.assign(headers, {
      "svix-id": id,
      "svix-signature": `v1,${signSvixPayload(segredo, id, timestamp, body)}`,
      "svix-timestamp": String(timestamp)
    });
  }

  return { id, request: new Request("http://127.0.0.1:3100/api/webhooks/resend", { body, headers, method: "POST" }) };
}

test("webhook do Resend: sem segredo configurado 503; sem assinatura ou com assinatura errada 401, e nada e gravado", async () => {
  const payload = { data: { email_id: "qualquer" }, type: "email.delivered" };
  delete process.env.RESEND_WEBHOOK_SECRET;
  assert.equal((await webhookRoute.POST(pedidoDoWebhook({ payload }).request)).status, 503);

  process.env.RESEND_WEBHOOK_SECRET = SEGREDO_DO_WEBHOOK;
  assert.equal((await webhookRoute.POST(pedidoDoWebhook({ assinar: false, payload }).request)).status, 401);
  assert.equal((await webhookRoute.POST(pedidoDoWebhook({ payload, segredo: `whsec_${randomBytes(24).toString("base64")}` }).request)).status, 401);
  assert.equal((await webhookRoute.POST(pedidoDoWebhook({ payload, timestamp: Math.floor(Date.now() / 1000) - 3_600 }).request)).status, 401, "replay de uma hora atras");
  assert.deepEqual(unwrap(await db.from("email_webhook_events").select("id").like("event_id", "teste-%"), "Eventos"), []);
});

test("webhook assinado: bounce marca a linha enviada como bounced com o motivo; o mesmo evento de novo nao reaplica", async () => {
  process.env.RESEND_WEBHOOK_SECRET = SEGREDO_DO_WEBHOOK;
  const enviado = (await filaDe(COMPRADOR.email)).find((row) => row.kind === "welcome");
  assert.equal(enviado.status, "sent");
  const payload = {
    created_at: "2026-10-17T12:00:00.000Z",
    data: { bounce: { message: "Caixa postal cheia", subType: "General", type: "Permanent" }, email_id: enviado.provider_message_id, to: [COMPRADOR.email] },
    type: "email.bounced"
  };
  const { id, request } = pedidoDoWebhook({ payload });

  const response = await webhookRoute.POST(request);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { applied: true, ok: true, type: "email.bounced" });

  const row = await linha(enviado.id);
  assert.equal(row.status, "bounced");
  assert.equal(row.bounced_at, "2026-10-17T12:00:00+00:00");
  assert.equal(row.last_error, "Permanent/General: Caixa postal cheia");

  const eventos = unwrap(await db.from("email_webhook_events").select("event_id,event_type,provider_message_id,outbox_id,processed_at,payload").eq("event_id", id), "Eventos");
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].event_type, "email.bounced");
  assert.equal(eventos[0].outbox_id, enviado.id);
  assert.ok(eventos[0].processed_at);
  assert.deepEqual(eventos[0].payload, payload, "o payload bruto fica guardado");

  // Entregue de novo (mesmo svix-id): 200, nada muda, um evento so.
  const repetido = await webhookRoute.POST(pedidoDoWebhook({ id, payload: { ...payload, data: { ...payload.data, bounce: { message: "outro" } } } }).request);
  assert.deepEqual(await repetido.json(), { duplicate: true, ok: true });
  assert.equal((await linha(enviado.id)).last_error, "Permanent/General: Caixa postal cheia");
  assert.equal(unwrap(await db.from("email_webhook_events").select("id").eq("event_id", id), "Eventos").length, 1);
});

test("webhook assinado: entrega grava delivered_at e mantem sent; reclamacao vira complained; e-mail de fora da fila so e auditado", async () => {
  process.env.RESEND_WEBHOOK_SECRET = SEGREDO_DO_WEBHOOK;
  const [compra, outraCompra] = (await filaDe(COMPRADOR.email)).filter((row) => row.kind === "purchase");

  const entregue = await webhookRoute.POST(pedidoDoWebhook({ payload: { data: { email_id: compra.provider_message_id }, type: "email.delivered" } }).request);
  assert.equal((await entregue.json()).applied, true);
  assert.equal((await linha(compra.id)).status, "sent");
  assert.ok((await linha(compra.id)).delivered_at);

  const reclamacao = await webhookRoute.POST(pedidoDoWebhook({ payload: { data: { email_id: outraCompra.provider_message_id }, type: "email.complained" } }).request);
  assert.equal((await reclamacao.json()).applied, true);
  assert.equal((await linha(outraCompra.id)).status, "complained");

  const deFora = pedidoDoWebhook({ payload: { data: { email_id: "auth-do-supabase" }, type: "email.bounced" } });
  const response = await webhookRoute.POST(deFora.request);
  assert.deepEqual(await response.json(), { applied: false, ok: true, type: "email.bounced" });
  assert.equal(unwrap(await db.from("email_webhook_events").select("id").eq("event_id", deFora.id), "Eventos").length, 1, "fica para auditoria");

  assert.equal((await webhookRoute.POST(pedidoDoWebhook({ payload: { data: {} } }).request)).status, 400, "evento sem tipo");
});
