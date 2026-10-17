import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import {
  ESCOLA_DE_TESTE,
  PACOTE_DE_TESTE,
  apagarContaDeTeste,
  desconectarVendas,
  garantirPacoteDeTeste,
  limparVendasDeTeste,
  seedEscolaDeTeste,
  usuarioDeTeste
} from "../fixtures/escola-de-teste.mjs";

// Vendas pela Hotmart (docs/04, secao Webhooks externos; docs/06, secao Vendas pela Hotmart) contra o
// banco LOCAL de verdade: sem plataforma conectada a rota recusa; o dono guarda o token (so o hash vai
// para o banco) e informa o codigo do produto no Acesso e venda; a compra aprovada (payload FICTICIO)
// cria a conta, libera o produto e deixa boas-vindas e compra na fila de e-mail, guardando so os campos
// permitidos; o mesmo evento de novo nao duplica; reembolso revoga SO o acesso que nasceu da compra;
// pacote libera e revoga todos, mesmo pausado; fim da garantia nao reabre acesso fechado; compra com
// reembolso registrado nao libera no reprocesso; evento preso em `received` e retomado; codigo repetido
// nao grava nada; falha fica guardada e "Precisa de atencao" dura ate o reprocesso; a exclusao do aluno
// anonimiza as vendas dele; desconectar volta a recusar. Nenhum e-mail sai.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const route = await import("../../src/app/api/webhooks/hotmart/route.ts");
const salesActions = await import("../../src/server/payments/actions.ts");
const salesQueries = await import("../../src/server/payments/queries.ts");
const { hashSalesSecret } = await import("../../src/server/payments/secret.ts");
const productActions = await import("../../src/server/catalog/product-actions.ts");
const comboActions = await import("../../src/server/catalog/combo-actions.ts");
const catalogQueries = await import("../../src/server/catalog/queries.ts");
const permissions = await import("../../src/server/auth/permissions.ts");
const studentQueries = await import("../../src/server/students/queries.ts");
const studentActions = await import("../../src/server/students/actions.ts");
const access = await import("../../src/server/students/access.ts");
const { accessEndDateToIso } = await import("../../src/server/students/model.ts");

const { curso, cursoBloqueado, cursoLiberacao } = ESCOLA_DE_TESTE;
const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const TOKEN = "hottok-integracao-0123456789abcdef";
const CODIGOS = { avulso: "7997", curso: "7001", foraDeOrdem: "7998", pacote: "7002", semLigacao: "7999" };
const COMPRADOR = { email: "comprador.hotmart@bunker707.test", nome: "Comprador da Hotmart" };
const COMPRADOR_PACOTE = { email: "comprador.pacote@bunker707.test", nome: "Comprador do Pacote" };
const ASSINANTE = { email: "assinante.hotmart@bunker707.test", nome: "Assinante da Hotmart" };
const COMPRADOR_ANTIGO = { email: "comprador.antigo@bunker707.test", nome: "Comprador Antes do Webhook" };
const REEMBOLSADO = { email: "reembolsado.hotmart@bunker707.test", nome: "Reembolsado Antes de Ligar" };
const PRESO = { email: "comprador.preso@bunker707.test", nome: "Comprador Preso" };
const AVULSO = { email: "comprador.avulso@bunker707.test", nome: "Comprador Avulso e Pacote" };
const RENOVACAO = { email: "assinante.renovacao@bunker707.test", nome: "Assinante com Renovação" };
const ORDEM = { email: "comprador.ordem@bunker707.test", nome: "Comprador na Ordem Inversa" };
const VITALICIO = { email: "assinante.vitalicio@bunker707.test", nome: "Assinante com Acesso Vitalício da Equipe" };
const COM_PRAZO = { email: "assinante.prazo@bunker707.test", nome: "Assinante com Prazo da Equipe" };
const EQUIPE = { email: "comprador.equipe@bunker707.test", nome: "Comprador que a Equipe Revogou" };
const SEGURANCA = { email: "comprador.seguranca@bunker707.test", nome: "Comprador da Rede de Segurança" };
const FALHA = { email: "comprador.falha@bunker707.test", nome: "Comprador com Falha no Meio" };
const FALHA_PRAZO = { email: "comprador.falha.prazo@bunker707.test", nome: "Comprador com Falha e Prazo" };
const PARCIAL = { email: "comprador.parcial@bunker707.test", nome: "Comprador de Pacote pela Metade" };
const SEM_COBRANCA = { email: "comprador.sem.cobranca@bunker707.test", nome: "Comprador sem Cobrança da Assinatura" };
const LEGADO = { email: "comprador.legado@bunker707.test", nome: "Comprador de Antes dos Vínculos" };
const COMPRADORES = [COMPRADOR, COMPRADOR_PACOTE, ASSINANTE, COMPRADOR_ANTIGO, REEMBOLSADO, PRESO, AVULSO, RENOVACAO, ORDEM, VITALICIO, COM_PRAZO, EQUIPE, SEGURANCA, FALHA, FALHA_PRAZO, PARCIAL, SEM_COBRANCA, LEGADO];
const PREFIXO = "teste-hotmart-";
const PACOTE_DUPLICADO = "Pacote de Teste: Código Repetido";

/** Payload ficticio de compra no formato do webhook 2.0 da Hotmart (com os campos que NAO podem ser guardados). */
function payload({ assinatura = null, email = COMPRADOR.email, event = "PURCHASE_APPROVED", id, nome = COMPRADOR.nome, produto = CODIGOS.curso, transaction = "HP-TESTE-0001" }) {
  return {
    creation_date: Date.now(),
    data: {
      ...(assinatura ? { subscription: { plan: { name: "Mensal" }, status: "ACTIVE", subscriber: { code: assinatura } } } : {}),
      affiliates: [{ name: "Afiliado Ficticio" }],
      buyer: {
        address: { city: "Cidade Ficticia", zipcode: "00000000" },
        checkout_phone: "11999990000",
        checkout_phone_code: "55",
        document: "00000000000",
        email,
        name: nome
      },
      commissions: [{ value: 10 }],
      producer: { name: "Produtor Ficticio" },
      product: { id: Number(produto), name: `Produto ${produto} na Hotmart` },
      purchase: { approved_date: Date.now(), order_date: Date.now(), status: event === "PURCHASE_APPROVED" ? "APPROVED" : "REFUNDED", transaction }
    },
    event,
    id: `${PREFIXO}${id}`,
    version: "2.0.0"
  };
}

/** Payload ficticio de assinatura cancelada (comprador em data.subscriber, sem compra). */
function cancelamento({ assinatura = "SUB-TESTE", email, id, nome, produto = CODIGOS.curso }) {
  return {
    creation_date: Date.now(),
    data: {
      cancellation_date: Date.now(),
      product: { id: Number(produto), name: `Produto ${produto} na Hotmart` },
      subscriber: { code: assinatura, email, name: nome },
      subscription: { plan: { name: "Mensal" }, status: "CANCELLED_BY_CUSTOMER" }
    },
    event: "SUBSCRIPTION_CANCELLATION",
    id: `${PREFIXO}${id}`,
    version: "2.0.0"
  };
}

function post(body, token = TOKEN) {
  const headers = { "content-type": "application/json", host: "127.0.0.1:3100" };

  if (token) {
    headers["x-hotmart-hottok"] = token;
  }

  return route.POST(new Request("http://127.0.0.1:3100/api/webhooks/hotmart", { body: JSON.stringify(body), headers, method: "POST" }));
}

async function postJson(body, token = TOKEN) {
  const response = await post(body, token);

  return { body: await response.json(), status: response.status };
}

const EVENT_COLUMNS = "id,external_event_id,event_type,processing_status,outcome,outcome_detail,error_message,product_id,combo_id,user_id,buyer_email,transaction_id,payload";

async function eventos() {
  return unwrap(await db.from("webhook_events").select(EVENT_COLUMNS).like("external_event_id", `${PREFIXO}%`).order("received_at"), "Lendo vendas recebidas");
}

async function evento(sufixo) {
  const linha = (await eventos()).find((row) => row.external_event_id === `${PREFIXO}${sufixo}`);
  assert.ok(linha, `evento ${sufixo} gravado`);

  return linha;
}

async function acessosDe(email) {
  const { users } = unwrap(await db.auth.admin.listUsers({ page: 1, perPage: 1000 }), "Lendo contas");
  const conta = users.find((user) => user.email === email);

  if (!conta) {
    return { acessos: [], conta: null };
  }

  const acessos = unwrap(
    await db.from("entitlements").select("id,target_id,status,source_provider,source_event_id,ends_at").eq("user_id", conta.id).order("target_id"),
    "Lendo acessos"
  );

  return { acessos, conta };
}

async function vinculosDe(transaction) {
  return unwrap(await db.from("sale_grants").select("transaction_id,subscription_code,product_id,opened,previous_ends_at,closed_by").eq("transaction_id", transaction).order("product_id"), "Lendo vínculos");
}

/** Acesso dado pela equipe (conta criada se preciso), com ou sem prazo ("AAAA-MM-DD"), como em Alunos > Liberar acesso. */
async function acessoDaEquipe({ email, nome, prazo = null, produtoId = curso.id }) {
  return access.provisionStudentAccess({
    actorId: contas.produtor.id,
    delivery: "none",
    email,
    endsAt: prazo,
    fullName: nome,
    phone: null,
    productIds: [produtoId],
    redirectTo: "http://127.0.0.1:3100/auth/callback",
    siteOrigin: "http://127.0.0.1:3100",
    source: "admin",
    sourceProvider: "manual"
  });
}

/** Deixa um evento como uma falha no meio do processamento deixaria: `failed`, sem trava, pronto para Reprocessar. */
async function simularFalha(sufixo) {
  const linha = await evento(sufixo);
  unwrap(
    await db.from("webhook_events").update({ error_message: "falha simulada", outcome: "failed", processing_started_at: null, processing_status: "failed" }).eq("id", linha.id),
    "Simulando falha no meio"
  );

  return linha.id;
}

async function filaDe(email) {
  return unwrap(await db.from("email_outbox").select("kind,status,idempotency_key,html").eq("to_email", email).order("created_at"), "Lendo a fila de e-mail");
}

async function integracao() {
  return unwrap(await db.from("integration_settings").select("status,secret_status,secret,last_sync_at,last_error,webhook_url").eq("provider", "hotmart").single(), "Lendo a Hotmart");
}

async function ligarCodigo(productId, codigo) {
  const current = await catalogQueries.getProductAccess(productId);
  const result = await productActions.updateProductAccess({ expectedUpdatedAt: current.header.updatedAt, hotmartProductId: codigo, id: productId });
  assert.equal(result.ok, true, JSON.stringify(result));
}

async function limpar() {
  await desconectarVendas(db);
  await limparVendasDeTeste(db, { codigos: Object.values(CODIGOS), prefixoDoEvento: PREFIXO });
  unwrap(await db.from("product_combos").delete().eq("name", PACOTE_DUPLICADO), "Apagando pacote duplicado de teste");
  unwrap(await db.from("email_outbox").delete().in("to_email", COMPRADORES.map((conta) => conta.email)), "Limpando a fila de e-mail de teste");
  unwrap(await db.from("entitlements").delete().eq("source_event_id", "HP-OUTRA-0001"), "Limpando acesso de outra origem");
  unwrap(await db.from("entitlements").delete().eq("user_id", contas.alunoSemAcesso.id), "Limpando acessos do aluno sem acesso");
  unwrap(await db.from("entitlements").update({ ends_at: null, source_event_id: "escola-de-teste:aluna:curso-agentes", source_provider: "manual", status: "active" }).eq("user_id", contas.aluna.id).eq("target_id", curso.id), "Devolvendo o acesso da aluna");

  for (const conta of COMPRADORES) {
    await apagarContaDeTeste(db, conta.email);
  }
}

before(limpar);
after(limpar);

/* ------------------------------------------------------------ Conectar */

test("sem a Hotmart conectada, o webhook responde 503 e nao grava nada", async () => {
  const response = await post(payload({ id: "sem-conexao" }));

  assert.equal(response.status, 503);
  assert.equal((await eventos()).length, 0);
});

test("so o dono guarda o token: analista recebe 403; no banco fica so o hash e a tela recebe so a data", async () => {
  actAs(analista);
  const recusa = await salesActions.saveSalesSecret({ provider: "hotmart", secret: TOKEN });
  assert.equal(recusa.ok, false);
  assert.equal(recusa.status, 403);
  await assert.rejects(permissions.requirePageRole("settings.sales", "/admin/configuracoes"), /redirect:\/admin\/configuracoes/);

  actAs(produtor);
  const curto = await salesActions.saveSalesSecret({ provider: "hotmart", secret: "curto" });
  assert.equal(curto.status, 400);
  assert.ok(curto.fieldErrors?.secret, "token curto aponta o campo");

  const result = await salesActions.saveSalesSecret({ provider: "hotmart", secret: TOKEN });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.webhookUrl, "http://127.0.0.1:3100/api/webhooks/hotmart");

  const row = await integracao();
  assert.equal(row.status, "configured");
  assert.equal(row.secret_status, "set");
  assert.equal(row.secret, hashSalesSecret(TOKEN), "o banco guarda o SHA-256 do token");
  assert.notEqual(row.secret, TOKEN, "o token em si nunca vai para o banco");

  const data = await salesQueries.getSalesSettingsData();
  const hotmart = data.providers.find((card) => card.provider === "hotmart");
  assert.equal(hotmart.status, "configured");
  assert.ok(hotmart.secretUpdatedAt, "a tela recebe a data em que o token foi guardado");
  assert.equal("secret" in hotmart, false, "a tela nunca recebe o token nem o hash");
  assert.match(hotmart.originWarning ?? "", /NEXT_PUBLIC_SITE_URL não está definida/, "sem a variavel, a tela avisa que o endereco e o da pagina");
  assert.deepEqual(data.providers.filter((card) => !card.supported).map((card) => card.provider), ["ticto", "kiwify"]);
});

test("token errado ou ausente responde 401 e nao grava o evento; mandar o hash tambem nao vale", async () => {
  assert.equal((await post(payload({ id: "token-errado" }), "outro-token-errado-0123456789")).status, 401);
  assert.equal((await post(payload({ id: "sem-token" }), null)).status, 401);
  assert.equal((await post(payload({ id: "hash-como-token" }), hashSalesSecret(TOKEN))).status, 401);
  assert.equal((await eventos()).length, 0);
});

/* ------------------------------------------------------------ Codigo do produto */

test("codigo da Hotmart no Acesso e venda; codigo repetido e recusado no campo ANTES de gravar a linha do produto (o proximo Salvar nao cai em 409)", async () => {
  actAs(produtor);
  const access = await catalogQueries.getProductAccess(curso.id);
  assert.equal(access.hotmartProductId, null);

  const saved = await productActions.updateProductAccess({ expectedUpdatedAt: access.header.updatedAt, hotmartProductId: CODIGOS.curso, id: curso.id });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal((await catalogQueries.getProductAccess(curso.id)).hotmartProductId, CODIGOS.curso);

  const outro = await catalogQueries.getProductAccess(cursoBloqueado.id);
  const repetido = await productActions.updateProductAccess({ expectedUpdatedAt: outro.header.updatedAt, hotmartProductId: CODIGOS.curso, id: cursoBloqueado.id, purchaseLabel: "Quero" });
  assert.equal(repetido.ok, false);
  assert.equal(repetido.status, 400);
  assert.match(repetido.fieldErrors?.hotmartProductId?.[0] ?? "", /já está ligado/);

  const depois = await catalogQueries.getProductAccess(cursoBloqueado.id);
  assert.equal(depois.header.updatedAt, outro.header.updatedAt, "nada da linha do produto foi gravado");
  assert.equal(depois.purchaseLabel, outro.purchaseLabel);

  // Corrigir o codigo e salvar de novo com a mesma versao funciona (sem "versao velha").
  const corrigido = await productActions.updateProductAccess({ expectedUpdatedAt: outro.header.updatedAt, hotmartProductId: "", id: cursoBloqueado.id, purchaseLabel: "Quero" });
  assert.equal(corrigido.ok, true, JSON.stringify(corrigido));
});

test("pacote novo com codigo da Hotmart ja usado e recusado no campo e NAO e criado", async () => {
  actAs(produtor);
  const contarPacotes = async () => {
    const { count, error } = await db.from("product_combos").select("id", { count: "exact", head: true });
    assert.equal(error, null, error?.message);

    return count ?? 0;
  };
  const antes = await contarPacotes();
  const result = await comboActions.saveCombo({ hotmartProductId: CODIGOS.curso, name: PACOTE_DUPLICADO, productIds: [cursoLiberacao.id], status: "active" });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.fieldErrors?.hotmartProductId?.[0] ?? "", /já está ligado/);
  assert.equal(await contarPacotes(), antes, "nenhum pacote novo");
  assert.equal(unwrap(await db.from("product_combos").select("id").eq("name", PACOTE_DUPLICADO), "Pacote duplicado").length, 0);
});

/* ------------------------------------------------------------ Compra aprovada */

test("compra aprovada cria a conta, libera o curso e deixa boas-vindas e compra na fila; o payload guardado fica so com os campos permitidos; produto sem codigo e ignorado com o motivo", async () => {
  const { body, status } = await postJson(payload({ id: "compra-1" }));
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.outcome, "access_granted");

  const { acessos, conta } = await acessosDe(COMPRADOR.email);
  assert.ok(conta, "a conta nasceu no Auth local");
  assert.deepEqual(
    acessos.map((row) => ({ source_event_id: row.source_event_id, source_provider: row.source_provider, status: row.status, target_id: row.target_id })),
    [{ source_event_id: "HP-TESTE-0001", source_provider: "hotmart", status: "active", target_id: curso.id }]
  );

  const perfil = unwrap(await db.from("profiles").select("full_name,phone").eq("id", conta.id).single(), "Lendo o perfil");
  assert.deepEqual(perfil, { full_name: COMPRADOR.nome, phone: "+55 11999990000" });

  const fila = await filaDe(COMPRADOR.email);
  assert.deepEqual(fila.map((row) => [row.kind, row.status]), [["welcome", "queued"], ["purchase", "queued"]]);
  assert.equal(fila[1].idempotency_key, `purchase:hotmart:HP-TESTE-0001:${conta.id}`);
  assert.match(fila[1].html, new RegExp(`/conteudo/${curso.id}`));

  const linha = await evento("compra-1");
  assert.equal(linha.processing_status, "processed");
  assert.equal(linha.outcome, "access_granted");
  assert.equal(linha.product_id, curso.id);
  assert.equal(linha.user_id, conta.id);
  assert.equal(linha.buyer_email, COMPRADOR.email);
  assert.equal(linha.transaction_id, "HP-TESTE-0001");
  assert.deepEqual(Object.keys(linha.payload.data).sort(), ["buyer", "product", "purchase"], "so os blocos permitidos ficam guardados");
  assert.deepEqual(linha.payload.data.buyer, { checkout_phone: "11999990000", checkout_phone_code: "55", email: COMPRADOR.email, name: COMPRADOR.nome });
  assert.equal(JSON.stringify(linha.payload).includes("00000000000"), false, "documento e endereco nunca sao gravados");

  const row = await integracao();
  assert.ok(row.last_sync_at, "a plataforma registra a ultima venda");
  assert.equal(row.status, "configured");

  const detail = await studentQueries.getStudentDetail(conta.id);
  assert.equal(detail.accesses[0].sourceProvider, "hotmart");
  assert.ok(detail.timeline.some((item) => /Conta criada pela venda \(Hotmart\)/.test(item.text)), "o historico mostra a origem Hotmart");

  const data = await salesQueries.getSalesSettingsData();
  const item = data.events.find((candidate) => candidate.id === linha.id);
  assert.equal(item.buyerEmailMasked, "c***@bunker707.test", "a tela recebe o e-mail ja mascarado");
  assert.equal("buyerEmail" in item, false);

  const ignorado = await postJson(payload({ id: "sem-ligacao", produto: CODIGOS.semLigacao, transaction: "HP-TESTE-0009" }));
  assert.equal(ignorado.status, 200);
  assert.equal(ignorado.body.outcome, "ignored");
  const semLigacao = await evento("sem-ligacao");
  assert.equal(semLigacao.processing_status, "ignored");
  assert.match(semLigacao.outcome_detail, /7999 \(Produto 7999 na Hotmart\) da Hotmart não está ligado/);
  assert.equal((await acessosDe(COMPRADOR.email)).acessos.length, 1, "nada foi liberado para o produto sem codigo");
});

test("o mesmo evento entregue de novo responde 200 sem reprocessar: um acesso, dois e-mails, uma linha", async () => {
  const { body, status } = await postJson(payload({ id: "compra-1" }));
  assert.equal(status, 200);
  assert.deepEqual(body, { duplicate: true, ok: true });

  assert.equal((await acessosDe(COMPRADOR.email)).acessos.length, 1);
  assert.equal((await filaDe(COMPRADOR.email)).length, 2);
  assert.equal((await eventos()).filter((row) => row.external_event_id === `${PREFIXO}compra-1`).length, 1);
});

/* ------------------------------------------------------------ Reembolso */

test("reembolso revoga o acesso que nasceu da compra; reembolso repetido nao muda nada", async () => {
  const { body, status } = await postJson(payload({ event: "PURCHASE_REFUNDED", id: "reembolso-1" }));
  assert.equal(status, 200);
  assert.equal(body.outcome, "access_revoked");

  const { acessos } = await acessosDe(COMPRADOR.email);
  assert.deepEqual(acessos.map((row) => [row.target_id, row.status]), [[curso.id, "revoked"]]);
  assert.equal((await evento("reembolso-1")).outcome, "access_revoked");

  const repetido = await postJson(payload({ event: "PURCHASE_REFUNDED", id: "reembolso-2", transaction: "HP-TESTE-0001" }));
  assert.equal(repetido.body.outcome, "ignored", "revogar de novo nao muda nada");
  assert.match((await evento("reembolso-2")).outcome_detail, /já estava fechado/);
});

test("compra, reembolso e cancelamento com o e-mail de quem ja tinha acesso pela equipe nao tiram esse acesso", async () => {
  const lerAluna = async () => unwrap(await db.from("entitlements").select("status,source_provider,ends_at").eq("user_id", contas.aluna.id).eq("target_id", curso.id).single(), "Acesso da aluna");
  assert.deepEqual(await lerAluna(), { ends_at: null, source_provider: "manual", status: "active" });

  // Alguem compra (assinatura) com o e-mail da aluna: o acesso aberto dela continua da equipe; a venda so fica registrada como vinculo.
  const compra = await postJson(payload({ assinatura: "SUB-ABUSO", email: contas.aluna.email, id: "abuso-compra", nome: contas.aluna.nome, transaction: "HP-OUTRA-0001" }));
  assert.equal(compra.body.outcome, "access_granted");
  assert.deepEqual(await lerAluna(), { ends_at: null, source_provider: "manual", status: "active" }, "a origem continua a equipe");
  assert.deepEqual((await vinculosDe("HP-OUTRA-0001")).map((row) => [row.opened, row.previous_ends_at, row.subscription_code]), [[false, null, "SUB-ABUSO"]], "a venda so estendeu um acesso que ja estava aberto");

  const reembolso = await postJson(payload({ email: contas.aluna.email, event: "PURCHASE_REFUNDED", id: "abuso-reembolso", nome: contas.aluna.nome, transaction: "HP-OUTRA-0001" }));
  assert.equal(reembolso.body.outcome, "ignored");
  assert.match((await evento("abuso-reembolso")).outcome_detail, /outra origem/);
  assert.deepEqual(await lerAluna(), { ends_at: null, source_provider: "manual", status: "active" }, "o acesso dado pela equipe continua");

  const cancelada = await postJson(cancelamento({ assinatura: "SUB-ABUSO", email: contas.aluna.email, id: "abuso-cancelamento", nome: contas.aluna.nome }));
  assert.equal(cancelada.body.outcome, "ignored", JSON.stringify(cancelada.body));
  assert.deepEqual(await lerAluna(), { ends_at: null, source_provider: "manual", status: "active" }, "cancelar a assinatura alheia nao suspende o acesso da aluna");
});

test("acesso da equipe com prazo: a compra libera sem prazo e o reembolso devolve o prazo que havia", async () => {
  actAs(produtor);
  const prazo = "2099-06-30T12:00:00.000Z";
  const concedido = await access.grantProductAccess({ actorId: contas.produtor.id, endsAt: prazo, productIds: [curso.id], source: "admin", sourceProvider: "manual", userId: contas.alunoSemAcesso.id });
  assert.equal(concedido.granted.length, 1);

  const compra = await postJson(payload({ email: contas.alunoSemAcesso.email, id: "prazo-compra", nome: contas.alunoSemAcesso.nome, transaction: "HP-PRAZO-0001" }));
  assert.equal(compra.body.outcome, "access_granted");
  const semPrazo = (await acessosDe(contas.alunoSemAcesso.email)).acessos[0];
  assert.equal(semPrazo.ends_at, null, "quem pagou fica sem prazo");
  assert.equal(semPrazo.source_provider, "manual", "a origem continua a equipe");
  assert.deepEqual((await vinculosDe("HP-PRAZO-0001")).map((row) => [row.opened, new Date(row.previous_ends_at).toISOString()]), [[false, prazo]]);

  const reembolso = await postJson(payload({ email: contas.alunoSemAcesso.email, event: "PURCHASE_REFUNDED", id: "prazo-reembolso", nome: contas.alunoSemAcesso.nome, transaction: "HP-PRAZO-0001" }));
  assert.equal(reembolso.body.outcome, "access_restored", JSON.stringify(reembolso.body));
  const devolvido = (await acessosDe(contas.alunoSemAcesso.email)).acessos[0];
  assert.deepEqual([devolvido.status, new Date(devolvido.ends_at).toISOString()], ["active", prazo], "o prazo da equipe volta; o acesso continua");
  assert.match((await evento("prazo-reembolso")).outcome_detail, /prazo anterior devolvido/);
});

test("produto comprado sozinho e depois num pacote: o reembolso do pacote revoga so o que o pacote abriu", async () => {
  actAs(produtor);
  await garantirPacoteDeTeste(db, CODIGOS.pacote);
  await ligarCodigo(cursoLiberacao.id, CODIGOS.avulso);

  const avulsa = await postJson(payload({ email: AVULSO.email, id: "avulso-compra", nome: AVULSO.nome, produto: CODIGOS.avulso, transaction: "HP-AVULSO-0001" }));
  assert.equal(avulsa.body.outcome, "access_granted");
  const pacote = await postJson(payload({ email: AVULSO.email, id: "avulso-pacote", nome: AVULSO.nome, produto: CODIGOS.pacote, transaction: "HP-AVULSO-0002" }));
  assert.equal(pacote.body.outcome, "access_granted");
  assert.deepEqual(
    (await vinculosDe("HP-AVULSO-0002")).map((row) => [row.product_id, row.opened]),
    [[cursoBloqueado.id, true], [cursoLiberacao.id, false]],
    "o pacote abriu um produto e so estendeu o outro"
  );

  const reembolso = await postJson(payload({ email: AVULSO.email, event: "PURCHASE_REFUNDED", id: "avulso-reembolso-pacote", nome: AVULSO.nome, produto: CODIGOS.pacote, transaction: "HP-AVULSO-0002" }));
  assert.equal(reembolso.body.outcome, "access_revoked");
  assert.deepEqual(
    (await acessosDe(AVULSO.email)).acessos.map((row) => [row.target_id, row.status]),
    [[cursoBloqueado.id, "revoked"], [cursoLiberacao.id, "active"]],
    "o produto pago a parte continua"
  );
  assert.match((await evento("avulso-reembolso-pacote")).outcome_detail, /1 produto mantido \(outra compra paga sustenta o acesso\)/);

  // Depois, o reembolso da compra avulsa: nada mais sustenta o produto; fecha.
  const reembolsoAvulsa = await postJson(payload({ email: AVULSO.email, event: "PURCHASE_REFUNDED", id: "avulso-reembolso-avulsa", nome: AVULSO.nome, produto: CODIGOS.avulso, transaction: "HP-AVULSO-0001" }));
  assert.equal(reembolsoAvulsa.body.outcome, "access_revoked", JSON.stringify(reembolsoAvulsa.body));
  assert.deepEqual((await acessosDe(AVULSO.email)).acessos.map((row) => row.status), ["revoked", "revoked"]);
});

test("a ordem inversa da o mesmo resultado: reembolso da avulsa primeiro (o pacote sustenta), depois o do pacote fecha os dois", async () => {
  const avulsa = await postJson(payload({ email: ORDEM.email, id: "ordem-avulsa", nome: ORDEM.nome, produto: CODIGOS.avulso, transaction: "HP-ORDEM-0001" }));
  assert.equal(avulsa.body.outcome, "access_granted");
  const pacote = await postJson(payload({ email: ORDEM.email, id: "ordem-pacote", nome: ORDEM.nome, produto: CODIGOS.pacote, transaction: "HP-ORDEM-0002" }));
  assert.equal(pacote.body.outcome, "access_granted");

  const primeiro = await postJson(payload({ email: ORDEM.email, event: "PURCHASE_REFUNDED", id: "ordem-reembolso-avulsa", nome: ORDEM.nome, produto: CODIGOS.avulso, transaction: "HP-ORDEM-0001" }));
  assert.equal(primeiro.body.outcome, "ignored", JSON.stringify(primeiro.body));
  assert.match((await evento("ordem-reembolso-avulsa")).outcome_detail, /outra compra paga sustenta o acesso/);
  assert.deepEqual((await acessosDe(ORDEM.email)).acessos.map((row) => row.status), ["active", "active"], "o pacote ainda paga o produto");

  const segundo = await postJson(payload({ email: ORDEM.email, event: "PURCHASE_REFUNDED", id: "ordem-reembolso-pacote", nome: ORDEM.nome, produto: CODIGOS.pacote, transaction: "HP-ORDEM-0002" }));
  assert.equal(segundo.body.outcome, "access_revoked", JSON.stringify(segundo.body));
  assert.match((await evento("ordem-reembolso-pacote")).outcome_detail, /acesso revogado em 2 produtos/);
  assert.deepEqual((await acessosDe(ORDEM.email)).acessos.map((row) => row.status), ["revoked", "revoked"], "a avulsa ja reembolsada nao sustenta mais");
});

test("assinatura: a renovacao chega como compra nova e o chargeback dela revoga, mesmo com o acesso nascido na primeira cobranca", async () => {
  const primeira = await postJson(payload({ assinatura: "SUB-RENOVA", email: RENOVACAO.email, id: "renovacao-1", nome: RENOVACAO.nome, transaction: "HP-RENOVA-0001" }));
  assert.equal(primeira.body.outcome, "access_granted");
  const segunda = await postJson(payload({ assinatura: "SUB-RENOVA", email: RENOVACAO.email, id: "renovacao-2", nome: RENOVACAO.nome, transaction: "HP-RENOVA-0002" }));
  assert.equal(segunda.body.outcome, "access_granted");
  const [acesso] = (await acessosDe(RENOVACAO.email)).acessos;
  assert.deepEqual([acesso.status, acesso.source_event_id], ["active", "HP-RENOVA-0001"], "o acesso continua da primeira cobranca");
  assert.deepEqual((await vinculosDe("HP-RENOVA-0002")).map((row) => [row.opened, row.subscription_code]), [[false, "SUB-RENOVA"]]);

  const chargeback = await postJson(payload({ assinatura: "SUB-RENOVA", email: RENOVACAO.email, event: "PURCHASE_CHARGEBACK", id: "renovacao-chargeback", nome: RENOVACAO.nome, transaction: "HP-RENOVA-0002" }));
  assert.equal(chargeback.body.outcome, "access_revoked", JSON.stringify(chargeback.body));
  assert.equal((await acessosDe(RENOVACAO.email)).acessos[0].status, "revoked", "cobrancas da mesma assinatura nao sustentam o acesso umas das outras");
});

test("assinatura que so estendeu um acesso da equipe: reembolso da renovacao e cancelamento mantem o vitalicio e devolvem o prazo", async () => {
  // Acesso vitalicio dado pela equipe; duas cobrancas da assinatura S so o estenderam (nenhuma o abriu).
  await acessoDaEquipe({ email: VITALICIO.email, nome: VITALICIO.nome });
  assert.equal((await postJson(payload({ assinatura: "SUB-VITALICIO", email: VITALICIO.email, id: "vitalicio-1", nome: VITALICIO.nome, transaction: "HP-VITALICIO-0001" }))).body.outcome, "access_granted");
  assert.equal((await postJson(payload({ assinatura: "SUB-VITALICIO", email: VITALICIO.email, id: "vitalicio-2", nome: VITALICIO.nome, transaction: "HP-VITALICIO-0002" }))).body.outcome, "access_granted");
  assert.deepEqual((await vinculosDe("HP-VITALICIO-0001")).map((row) => row.opened), [false]);

  const reembolso = await postJson(payload({ assinatura: "SUB-VITALICIO", email: VITALICIO.email, event: "PURCHASE_REFUNDED", id: "vitalicio-reembolso", nome: VITALICIO.nome, transaction: "HP-VITALICIO-0002" }));
  assert.equal(reembolso.body.outcome, "ignored", JSON.stringify(reembolso.body));
  assert.match((await evento("vitalicio-reembolso")).outcome_detail, /outra origem/);
  const cancelada = await postJson(cancelamento({ assinatura: "SUB-VITALICIO", email: VITALICIO.email, id: "vitalicio-cancelamento", nome: VITALICIO.nome }));
  assert.equal(cancelada.body.outcome, "ignored", JSON.stringify(cancelada.body));
  const [vitalicio] = (await acessosDe(VITALICIO.email)).acessos;
  assert.deepEqual([vitalicio.status, vitalicio.ends_at, vitalicio.source_provider], ["active", null, "manual"], "a renovacao reembolsada nao e 'renovacao' de um acesso que nenhuma cobranca abriu");

  // Acesso da equipe COM prazo: a primeira cobranca guardou o prazo; o cancelamento o devolve.
  const prazo = accessEndDateToIso("2099-03-31");
  await acessoDaEquipe({ email: COM_PRAZO.email, nome: COM_PRAZO.nome, prazo: "2099-03-31" });
  assert.equal((await postJson(payload({ assinatura: "SUB-PRAZO", email: COM_PRAZO.email, id: "prazo-assinatura-1", nome: COM_PRAZO.nome, transaction: "HP-PRAZOASS-0001" }))).body.outcome, "access_granted");
  assert.equal((await postJson(payload({ assinatura: "SUB-PRAZO", email: COM_PRAZO.email, id: "prazo-assinatura-2", nome: COM_PRAZO.nome, transaction: "HP-PRAZOASS-0002" }))).body.outcome, "access_granted");
  assert.equal((await acessosDe(COM_PRAZO.email)).acessos[0].ends_at, null, "quem paga fica sem prazo");

  const canceladaComPrazo = await postJson(cancelamento({ assinatura: "SUB-PRAZO", email: COM_PRAZO.email, id: "prazo-assinatura-cancelamento", nome: COM_PRAZO.nome }));
  assert.equal(canceladaComPrazo.body.outcome, "access_restored", JSON.stringify(canceladaComPrazo.body));
  const devolvido = (await acessosDe(COM_PRAZO.email)).acessos[0];
  assert.deepEqual([devolvido.status, new Date(devolvido.ends_at).toISOString()], ["active", prazo], "o prazo da equipe volta, uma vez so, mesmo com duas cobrancas");
  assert.deepEqual((await vinculosDe("HP-PRAZOASS-0001")).map((row) => row.closed_by), ["subscription_canceled"]);
  assert.deepEqual((await vinculosDe("HP-PRAZOASS-0002")).map((row) => row.closed_by), ["subscription_canceled"]);
});

test("a equipe que revoga ou reabre um acesso fecha os vinculos das vendas (admin): a compra nova e que manda, e o que a equipe reabriu fica", async () => {
  const compra = await postJson(payload({ email: EQUIPE.email, id: "equipe-compra-0", nome: EQUIPE.nome, transaction: "HP-EQUIPE-0000" }));
  assert.equal(compra.body.outcome, "access_granted");
  const { acessos, conta } = await acessosDe(EQUIPE.email);

  // A equipe revoga: o vinculo da compra fecha por admin.
  await access.applyAccessAction({ action: "revoke", actorId: contas.produtor.id, entitlementId: acessos[0].id, source: "admin", sourceProvider: "manual", userId: conta.id });
  assert.deepEqual((await vinculosDe("HP-EQUIPE-0000")).map((row) => row.closed_by), ["admin"]);

  // Compra nova reabre; o reembolso DELA revoga (a compra antiga, fechada pela equipe, nao sustenta nada).
  const nova = await postJson(payload({ email: EQUIPE.email, id: "equipe-compra-1", nome: EQUIPE.nome, transaction: "HP-EQUIPE-0001" }));
  assert.equal(nova.body.outcome, "access_granted");
  assert.deepEqual((await vinculosDe("HP-EQUIPE-0001")).map((row) => row.opened), [true]);
  const reembolso = await postJson(payload({ email: EQUIPE.email, event: "PURCHASE_REFUNDED", id: "equipe-reembolso-1", nome: EQUIPE.nome, transaction: "HP-EQUIPE-0001" }));
  assert.equal(reembolso.body.outcome, "access_revoked", JSON.stringify(reembolso.body));
  assert.equal((await acessosDe(EQUIPE.email)).acessos[0].status, "revoked");

  // A equipe reabre em Alunos > Liberar acesso: todos os vinculos (ate os ja fechados por reembolso) passam a admin...
  await access.grantProductAccess({ actorId: contas.produtor.id, endsAt: null, productIds: [curso.id], source: "admin", sourceProvider: "manual", userId: conta.id });
  assert.equal((await acessosDe(EQUIPE.email)).acessos[0].status, "active");
  assert.deepEqual((await vinculosDe("HP-EQUIPE-0001")).map((row) => row.closed_by), ["admin"]);

  // ...e um chargeback da compra reembolsada nao tira o que a equipe reabriu.
  const chargeback = await postJson(payload({ email: EQUIPE.email, event: "PURCHASE_CHARGEBACK", id: "equipe-chargeback-1", nome: EQUIPE.nome, transaction: "HP-EQUIPE-0001" }));
  assert.equal(chargeback.body.outcome, "ignored", JSON.stringify(chargeback.body));
  assert.match((await evento("equipe-chargeback-1")).outcome_detail, /a equipe já decidiu/);
  assert.equal((await acessosDe(EQUIPE.email)).acessos[0].status, "active");
});

test("vinculo ja fechado por uma tentativa que falhou antes de agir: o reembolso (ou o reprocesso) ainda revoga", async () => {
  const compra = await postJson(payload({ email: SEGURANCA.email, id: "seguranca-compra", nome: SEGURANCA.nome, transaction: "HP-SEGURANCA-0001" }));
  assert.equal(compra.body.outcome, "access_granted");
  // O que a versao antiga deixava: vinculo fechado, acesso ainda aberto.
  unwrap(await db.from("sale_grants").update({ closed_at: new Date().toISOString(), closed_by: "refund" }).eq("transaction_id", "HP-SEGURANCA-0001"), "Fechando o vínculo antes de agir");

  const reembolso = await postJson(payload({ email: SEGURANCA.email, event: "PURCHASE_REFUNDED", id: "seguranca-reembolso", nome: SEGURANCA.nome, transaction: "HP-SEGURANCA-0001" }));
  assert.equal(reembolso.body.outcome, "access_revoked", JSON.stringify(reembolso.body));
  assert.equal((await acessosDe(SEGURANCA.email)).acessos[0].status, "revoked");
});

test("venda de antes dos vinculos (so source_event_id) que depois ganhou vinculo de outra compra: com a outra ja reembolsada, o reembolso da antiga ainda revoga", async () => {
  assert.equal((await postJson(payload({ email: LEGADO.email, id: "legado-compra", nome: LEGADO.nome, transaction: "HP-LEGADO-0001" }))).body.outcome, "access_granted");
  unwrap(await db.from("sale_grants").delete().eq("transaction_id", "HP-LEGADO-0001"), "Simulando venda de antes da tabela de vínculos");
  // Outra compra do mesmo produto so estende o acesso (vinculo opened = false) e e reembolsada: o acesso continua, a venda antiga paga.
  assert.equal((await postJson(payload({ email: LEGADO.email, id: "legado-compra-2", nome: LEGADO.nome, transaction: "HP-LEGADO-0002" }))).body.outcome, "access_granted");
  assert.deepEqual((await vinculosDe("HP-LEGADO-0002")).map((row) => row.opened), [false]);
  const reembolsoNova = await postJson(payload({ email: LEGADO.email, event: "PURCHASE_REFUNDED", id: "legado-reembolso-2", nome: LEGADO.nome, transaction: "HP-LEGADO-0002" }));
  assert.equal(reembolsoNova.body.outcome, "ignored", JSON.stringify(reembolsoNova.body));
  assert.equal((await acessosDe(LEGADO.email)).acessos[0].status, "active");

  const reembolsoAntiga = await postJson(payload({ email: LEGADO.email, event: "PURCHASE_REFUNDED", id: "legado-reembolso-1", nome: LEGADO.nome, transaction: "HP-LEGADO-0001" }));
  assert.equal(reembolsoAntiga.body.outcome, "access_revoked", JSON.stringify(reembolsoAntiga.body));
  assert.equal((await acessosDe(LEGADO.email)).acessos[0].status, "revoked");
});

test("reprocesso depois de uma falha no meio: o vinculo nasce certo ('abriu'), o prazo guardado antes da liberacao vale, e o pacote pela metade fecha inteiro", async () => {
  actAs(produtor);

  // 1) Acesso novo liberado, vinculo nao gravado (a falha veio depois da liberacao): o reprocesso ve que o acesso e desta compra.
  assert.equal((await postJson(payload({ email: FALHA.email, id: "falha-compra", nome: FALHA.nome, transaction: "HP-FALHA-0001" }))).body.outcome, "access_granted");
  unwrap(await db.from("sale_grants").delete().eq("transaction_id", "HP-FALHA-0001"), "Apagando o vínculo que a falha não gravou");
  const falhaId = await simularFalha("falha-compra");
  const reprocesso = await salesActions.reprocessSalesEvent({ id: falhaId });
  assert.equal(reprocesso.ok, true, JSON.stringify(reprocesso));
  assert.equal(reprocesso.data.outcome, "access_granted");
  assert.deepEqual((await vinculosDe("HP-FALHA-0001")).map((row) => [row.opened, row.previous_ends_at]), [[true, null]], "a compra ABRIU o acesso, mesmo que ele ja existisse no reprocesso");
  assert.equal((await filaDe(FALHA.email)).length, 2, "o reprocesso nao manda o e-mail de compra de novo");
  const reembolso = await postJson(payload({ email: FALHA.email, event: "PURCHASE_REFUNDED", id: "falha-reembolso", nome: FALHA.nome, transaction: "HP-FALHA-0001" }));
  assert.equal(reembolso.body.outcome, "access_revoked", JSON.stringify(reembolso.body));

  // 2) Acesso da equipe com prazo: o vinculo e gravado ANTES da liberacao, entao a falha no meio nao perde o prazo.
  const prazo = accessEndDateToIso("2099-09-30");
  await acessoDaEquipe({ email: FALHA_PRAZO.email, nome: FALHA_PRAZO.nome, prazo: "2099-09-30" });
  assert.equal((await postJson(payload({ email: FALHA_PRAZO.email, id: "falha-prazo-compra", nome: FALHA_PRAZO.nome, transaction: "HP-FALHAPRAZO-0001" }))).body.outcome, "access_granted");
  const prazoId = await simularFalha("falha-prazo-compra");
  const reprocessoPrazo = await salesActions.reprocessSalesEvent({ id: prazoId });
  assert.equal(reprocessoPrazo.data.outcome, "access_granted", JSON.stringify(reprocessoPrazo));
  assert.deepEqual((await vinculosDe("HP-FALHAPRAZO-0001")).map((row) => [row.opened, new Date(row.previous_ends_at).toISOString()]), [[false, prazo]], "o vinculo da primeira tentativa, com o prazo, e o que fica");
  const reembolsoPrazo = await postJson(payload({ email: FALHA_PRAZO.email, event: "PURCHASE_REFUNDED", id: "falha-prazo-reembolso", nome: FALHA_PRAZO.nome, transaction: "HP-FALHAPRAZO-0001" }));
  assert.equal(reembolsoPrazo.body.outcome, "access_restored", JSON.stringify(reembolsoPrazo.body));
  assert.equal(new Date((await acessosDe(FALHA_PRAZO.email)).acessos[0].ends_at).toISOString(), prazo);

  // 3) Pacote pela metade: a falha veio depois de liberar A e antes de B (e sem vinculo). O reprocesso libera B e ve que A tambem e da compra.
  await garantirPacoteDeTeste(db, CODIGOS.pacote);
  unwrap(await db.from("product_combos").update({ status: "active" }).eq("id", PACOTE_DE_TESTE.id), "Reativando o pacote de teste");
  assert.equal((await postJson(payload({ email: PARCIAL.email, id: "parcial-compra", nome: PARCIAL.nome, produto: CODIGOS.pacote, transaction: "HP-PARCIAL-0001" }))).body.outcome, "access_granted");
  const { acessos: metade } = await acessosDe(PARCIAL.email);
  assert.equal(metade.length, 2);
  unwrap(await db.from("sale_grants").delete().eq("transaction_id", "HP-PARCIAL-0001"), "Apagando os vínculos");
  unwrap(await db.from("entitlements").delete().eq("id", metade.find((row) => row.target_id === cursoLiberacao.id).id), "Apagando o segundo produto, que a falha não liberou");
  const parcialId = await simularFalha("parcial-compra");
  const reprocessoParcial = await salesActions.reprocessSalesEvent({ id: parcialId });
  assert.equal(reprocessoParcial.data.outcome, "access_granted", JSON.stringify(reprocessoParcial));
  assert.deepEqual((await vinculosDe("HP-PARCIAL-0001")).map((row) => [row.product_id, row.opened]), [[cursoBloqueado.id, true], [cursoLiberacao.id, true]], "os dois produtos foram abertos pela compra");
  const reembolsoParcial = await postJson(payload({ email: PARCIAL.email, event: "PURCHASE_REFUNDED", id: "parcial-reembolso", nome: PARCIAL.nome, produto: CODIGOS.pacote, transaction: "HP-PARCIAL-0001" }));
  assert.equal(reembolsoParcial.body.outcome, "access_revoked", JSON.stringify(reembolsoParcial.body));
  assert.deepEqual((await acessosDe(PARCIAL.email)).acessos.map((row) => row.status), ["revoked", "revoked"]);
});

test("acesso fechado reaberto por uma venda passa a pertencer a venda: o reembolso dela fecha de novo", async () => {
  const { body } = await postJson(payload({ id: "compra-de-volta", transaction: "HP-TESTE-0002" }));
  assert.equal(body.outcome, "access_granted");
  const { acessos } = await acessosDe(COMPRADOR.email);
  assert.deepEqual(acessos.map((row) => [row.target_id, row.status, row.source_event_id]), [[curso.id, "active", "HP-TESTE-0002"]], "a linha antiga (reembolsada) passa a ser desta compra");
  assert.equal((await filaDe(COMPRADOR.email)).length, 3, "quem volta a ter acesso recebe o e-mail de compra");

  const antiga = await postJson(payload({ event: "PURCHASE_REFUNDED", id: "reembolso-antigo", transaction: "HP-TESTE-0001" }));
  assert.equal(antiga.body.outcome, "ignored", "o reembolso da compra antiga nao fecha o acesso da nova");
  assert.equal((await acessosDe(COMPRADOR.email)).acessos[0].status, "active");

  const nova = await postJson(payload({ event: "PURCHASE_CHARGEBACK", id: "chargeback-nova", transaction: "HP-TESTE-0002" }));
  assert.equal(nova.body.outcome, "access_revoked");
  assert.equal((await acessosDe(COMPRADOR.email)).acessos[0].status, "revoked");
});

/* ------------------------------------------------------------ Pacote */

test("pacote: a compra libera todos os produtos de uma vez (um e-mail so); pausado depois, o reembolso ainda revoga todos", async () => {
  await garantirPacoteDeTeste(db, CODIGOS.pacote);

  const compra = await postJson(payload({ email: COMPRADOR_PACOTE.email, id: "pacote-compra", nome: COMPRADOR_PACOTE.nome, produto: CODIGOS.pacote, transaction: "HP-PACOTE-0001" }));
  assert.equal(compra.status, 200, JSON.stringify(compra.body));
  assert.equal(compra.body.outcome, "access_granted");

  const { acessos, conta } = await acessosDe(COMPRADOR_PACOTE.email);
  assert.deepEqual(
    acessos.map((row) => [row.target_id, row.status, row.source_event_id]),
    [
      [cursoBloqueado.id, "active", `HP-PACOTE-0001:${cursoBloqueado.id}`],
      [cursoLiberacao.id, "active", `HP-PACOTE-0001:${cursoLiberacao.id}`]
    ],
    "cada produto do pacote tem o proprio id de origem"
  );

  const fila = await filaDe(COMPRADOR_PACOTE.email);
  assert.deepEqual(fila.map((row) => row.kind), ["welcome", "purchase"], "um e-mail de compra para o pacote inteiro");
  assert.match(fila[1].html, new RegExp(cursoLiberacao.titulo));
  assert.match(fila[1].html, new RegExp(cursoBloqueado.titulo));

  const linha = await evento("pacote-compra");
  assert.equal(linha.combo_id, PACOTE_DE_TESTE.id);
  assert.equal(linha.user_id, conta.id);
  assert.match(linha.outcome_detail, /2 produtos/);

  // Carrinho fechou: o produtor pausa o pacote. Reembolsos da garantia continuam valendo.
  unwrap(await db.from("product_combos").update({ status: "paused" }).eq("id", PACOTE_DE_TESTE.id), "Pausando o pacote de teste");

  const reembolso = await postJson(payload({ email: COMPRADOR_PACOTE.email, event: "PURCHASE_REFUNDED", id: "pacote-reembolso", produto: CODIGOS.pacote, transaction: "HP-PACOTE-0001" }));
  assert.equal(reembolso.body.outcome, "access_revoked");
  assert.deepEqual((await acessosDe(COMPRADOR_PACOTE.email)).acessos.map((row) => row.status), ["revoked", "revoked"], "o reembolso do pacote pausado tira todos os produtos");

  const chargeback = await postJson(payload({ email: COMPRADOR_PACOTE.email, event: "PURCHASE_CHARGEBACK", id: "pacote-chargeback", produto: CODIGOS.pacote, transaction: "HP-PACOTE-0001" }));
  assert.equal(chargeback.body.outcome, "ignored", "ja estava fechado");
});

test("pacote pausado: a compra chega, fica ignorada com o motivo e nao libera nada", async () => {
  const { body } = await postJson(payload({ email: COMPRADOR_PACOTE.email, id: "pacote-pausado", produto: CODIGOS.pacote, transaction: "HP-PACOTE-0002" }));
  assert.equal(body.outcome, "ignored");
  assert.match((await evento("pacote-pausado")).outcome_detail, /está pausado/);
  assert.deepEqual((await acessosDe(COMPRADOR_PACOTE.email)).acessos.map((row) => row.status), ["revoked", "revoked"]);
});

test("cancelamento com codigo de assinatura sem nenhuma cobranca registrada nao adivinha pelo produto: ignorado, o acesso pago a parte fica", async () => {
  const avulsa = await postJson(payload({ email: SEM_COBRANCA.email, id: "sem-cobranca-avulsa", nome: SEM_COBRANCA.nome, produto: CODIGOS.avulso, transaction: "HP-SEMCOBRANCA-0001" }));
  assert.equal(avulsa.body.outcome, "access_granted");

  const cancelada = await postJson(cancelamento({ assinatura: "SUB-DESCONHECIDA", email: SEM_COBRANCA.email, id: "sem-cobranca-cancelamento", nome: SEM_COBRANCA.nome, produto: CODIGOS.pacote }));
  assert.equal(cancelada.body.outcome, "ignored", JSON.stringify(cancelada.body));
  assert.match((await evento("sem-cobranca-cancelamento")).outcome_detail, /Nenhuma cobrança da assinatura SUB-DESCONHECIDA/);
  assert.deepEqual((await acessosDe(SEM_COBRANCA.email)).acessos.map((row) => [row.target_id, row.status]), [[cursoLiberacao.id, "active"]], "o produto do pacote cancelado que foi pago a parte continua");
});

/* ------------------------------------------------------------ Fim da garantia */

test("fim da garantia (PURCHASE_COMPLETE) nao reabre acesso suspenso por cancelamento nem revogado pela equipe; libera so para quem nunca teve", async () => {
  const compra = await postJson(payload({ assinatura: "SUB-TESTE", email: ASSINANTE.email, id: "assinatura-compra", nome: ASSINANTE.nome, transaction: "HP-ASSINATURA-0001" }));
  assert.equal(compra.body.outcome, "access_granted");

  const cancelada = await postJson(cancelamento({ email: ASSINANTE.email, id: "assinatura-cancelada", nome: ASSINANTE.nome }));
  assert.equal(cancelada.body.outcome, "access_suspended", JSON.stringify(cancelada.body));
  assert.deepEqual((await acessosDe(ASSINANTE.email)).acessos.map((row) => row.status), ["suspended"]);

  const garantia = await postJson(payload({ email: ASSINANTE.email, event: "PURCHASE_COMPLETE", id: "assinatura-garantia", nome: ASSINANTE.nome, transaction: "HP-ASSINATURA-0001" }));
  assert.equal(garantia.body.outcome, "ignored");
  assert.match((await evento("assinatura-garantia")).outcome_detail, /não é reaberto/);
  assert.deepEqual((await acessosDe(ASSINANTE.email)).acessos.map((row) => row.status), ["suspended"], "continua suspenso");

  // Revogacao manual pela equipe dentro da garantia: o fim da garantia tambem nao devolve.
  const { acessos, conta } = await acessosDe(ASSINANTE.email);
  await access.applyAccessAction({ action: "revoke", actorId: contas.produtor.id, entitlementId: acessos[0].id, source: "admin", sourceProvider: "manual", userId: conta.id });
  const garantia2 = await postJson(payload({ email: ASSINANTE.email, event: "PURCHASE_COMPLETE", id: "assinatura-garantia-2", nome: ASSINANTE.nome, transaction: "HP-ASSINATURA-0001" }));
  assert.equal(garantia2.body.outcome, "ignored");
  assert.deepEqual((await acessosDe(ASSINANTE.email)).acessos.map((row) => row.status), ["revoked"], "continua revogado");

  // Venda feita antes de o webhook existir: o fim da garantia e o primeiro evento que chega e libera.
  const antiga = await postJson(payload({ email: COMPRADOR_ANTIGO.email, event: "PURCHASE_COMPLETE", id: "garantia-venda-antiga", nome: COMPRADOR_ANTIGO.nome, transaction: "HP-ANTIGA-0001" }));
  assert.equal(antiga.body.outcome, "access_granted");
  assert.deepEqual((await acessosDe(COMPRADOR_ANTIGO.email)).acessos.map((row) => [row.target_id, row.status]), [[curso.id, "active"]]);
});

/* ------------------------------------------------------------ Fora de ordem e reprocesso */

test("compra que ja tem reembolso registrado nao libera no reprocesso (eventos fora de ordem, codigo ligado depois)", async () => {
  const compra = await postJson(payload({ email: REEMBOLSADO.email, id: "fora-de-ordem-compra", nome: REEMBOLSADO.nome, produto: CODIGOS.foraDeOrdem, transaction: "HP-FORA-0001" }));
  assert.equal(compra.body.outcome, "ignored", "sem codigo ligado");
  const reembolso = await postJson(payload({ email: REEMBOLSADO.email, event: "PURCHASE_REFUNDED", id: "fora-de-ordem-reembolso", nome: REEMBOLSADO.nome, produto: CODIGOS.foraDeOrdem, transaction: "HP-FORA-0001" }));
  assert.equal(reembolso.body.outcome, "ignored", "sem conta ainda");

  actAs(produtor);
  await ligarCodigo(cursoLiberacao.id, CODIGOS.foraDeOrdem);
  const result = await salesActions.reprocessSalesEvent({ id: (await evento("fora-de-ordem-compra")).id });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.outcome, "ignored");
  assert.match(result.data.detail, /já tem reembolso ou chargeback registrado/);

  assert.equal((await acessosDe(REEMBOLSADO.email)).conta, null, "nenhuma conta foi criada");
  assert.equal((await filaDe(REEMBOLSADO.email)).length, 0, "nenhum e-mail saiu");
});

test("depois de ligar o codigo ao produto, Reprocessar libera a venda que estava ignorada; venda ja processada nao reprocessa", async () => {
  actAs(produtor);
  const ignorada = await evento("sem-ligacao");
  await ligarCodigo(cursoBloqueado.id, CODIGOS.semLigacao);

  const result = await salesActions.reprocessSalesEvent({ id: ignorada.id });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.ok, true);
  assert.equal(result.data.outcome, "access_granted");

  const { acessos } = await acessosDe(COMPRADOR.email);
  assert.deepEqual(
    acessos.map((row) => [row.target_id, row.status]),
    [[curso.id, "revoked"], [cursoBloqueado.id, "active"]]
  );
  const linha = await evento("sem-ligacao");
  assert.equal(linha.processing_status, "processed");
  assert.equal(linha.product_id, cursoBloqueado.id);

  const deNovo = await salesActions.reprocessSalesEvent({ id: ignorada.id });
  assert.equal(deNovo.status, 409, "venda ja processada nao reprocessa");
});

test("evento preso em 'received' (a funcao morreu depois de gravar): o reenvio da Hotmart retoma e a tela oferece Reprocessar", async () => {
  const antigo = new Date(Date.now() - 10 * 60_000).toISOString();
  const compra = payload({ email: PRESO.email, id: "preso-1", nome: PRESO.nome, transaction: "HP-PRESO-0001" });
  const outra = payload({ email: PRESO.email, id: "preso-2", nome: PRESO.nome, produto: CODIGOS.semLigacao, transaction: "HP-PRESO-0002" });

  for (const body of [compra, outra]) {
    unwrap(
      await db.from("webhook_events").insert({
        buyer_email: PRESO.email,
        event_type: "PURCHASE_APPROVED",
        external_event_id: body.id,
        external_product_id: String(body.data.product.id),
        normalized_type: "purchase_approved",
        payload: body,
        processing_started_at: antigo,
        processing_status: "received",
        provider: "hotmart",
        received_at: antigo,
        signature_valid: true,
        transaction_id: body.data.purchase.transaction
      }),
      "Gravando evento preso"
    );
  }

  // A tela lista as 50 vendas mais recentes (o preso de 10 minutos atras ja ficou atras das vendas desta suite): a linha dele, do jeito que a tela a monta, oferece Reprocessar.
  const presoId = (await evento("preso-1")).id;
  const linhaPresa = unwrap(await db.from("webhook_events").select("*").eq("id", presoId).single(), "Lendo o evento preso");
  assert.equal(salesQueries.toSalesEventListItem(linhaPresa, { combos: new Map(), products: new Map() }).canReprocess, true, "preso ha 10 minutos aparece com Reprocessar");

  // Reenvio do mesmo evento: em vez de "duplicate", a linha e retomada e processada.
  const reenvio = await postJson(compra);
  assert.equal(reenvio.status, 200, JSON.stringify(reenvio.body));
  assert.equal(reenvio.body.resumed, true);
  assert.equal(reenvio.body.outcome, "access_granted");
  assert.equal((await evento("preso-1")).processing_status, "processed");
  assert.deepEqual((await acessosDe(PRESO.email)).acessos.map((row) => [row.target_id, row.status]), [[curso.id, "active"]]);

  const deNovo = await postJson(compra);
  assert.deepEqual(deNovo.body, { duplicate: true, ok: true }, "processado, o reenvio volta a ser so duplicado");

  // Preso, mas recente demais para reivindicar (pode estar rodando): a plataforma precisa tentar de novo, nao dar como entregue.
  const recente = payload({ email: PRESO.email, id: "preso-recente", nome: PRESO.nome, transaction: "HP-PRESO-0003" });
  unwrap(
    await db.from("webhook_events").insert({
      buyer_email: PRESO.email,
      event_type: "PURCHASE_APPROVED",
      external_event_id: recente.id,
      external_product_id: String(recente.data.product.id),
      normalized_type: "purchase_approved",
      payload: recente,
      processing_started_at: new Date().toISOString(),
      processing_status: "received",
      provider: "hotmart",
      signature_valid: true,
      transaction_id: recente.data.purchase.transaction
    }),
    "Gravando evento recem-recebido"
  );
  const cedo = await postJson(recente);
  assert.equal(cedo.status, 409, JSON.stringify(cedo.body));
  assert.equal(cedo.body.processing, true);
  unwrap(await db.from("webhook_events").delete().eq("external_event_id", recente.id), "Apagando evento recem-recebido");

  // Pelo botao: o outro preso e reprocessado e libera o segundo produto.
  actAs(produtor);
  const result = await salesActions.reprocessSalesEvent({ id: (await evento("preso-2")).id });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.outcome, "access_granted");
  assert.equal((await acessosDe(PRESO.email)).acessos.length, 2);
});

/* ------------------------------------------------------------ Falhas e atencao */

test("evento sem e-mail valido falha: 500, linha guardada com o motivo; 'Precisa de atencao' dura ate o reprocesso, mesmo com vendas certas no meio", async () => {
  const response = await post(payload({ email: "nao-e-um-email", id: "sem-email", transaction: "HP-TESTE-0100" }));
  assert.equal(response.status, 500);

  const linha = await evento("sem-email");
  assert.equal(linha.processing_status, "failed");
  assert.equal(linha.outcome, "failed");
  assert.match(linha.error_message, /sem um e-mail válido/);
  assert.equal(linha.product_id, curso.id, "a lista mostra o produto mesmo no erro");

  assert.equal((await integracao()).status, "needs_attention");

  const certa = await postJson(payload({ event: "PURCHASE_BILLET_PRINTED", id: "boleto-depois-do-erro", transaction: "HP-TESTE-0300" }));
  assert.equal(certa.status, 200);
  const aindaComErro = await integracao();
  assert.equal(aindaComErro.status, "needs_attention", "um evento certo depois nao esconde a venda com erro");
  assert.match(aindaComErro.last_error, /1 venda com erro ou presa aguardando reprocesso/);

  actAs(produtor);
  // Outro processamento acabou de comecar (segundo clique, outra aba, reenvio): o botao espera.
  unwrap(await db.from("webhook_events").update({ processing_started_at: new Date().toISOString() }).eq("id", linha.id), "Simulando reprocesso em andamento");
  const ocupado = await salesActions.reprocessSalesEvent({ id: linha.id });
  assert.equal(ocupado.status, 409, JSON.stringify(ocupado));
  assert.match(ocupado.error, /já está sendo processada/);
  unwrap(await db.from("webhook_events").update({ processing_started_at: new Date(Date.now() - 10 * 60_000).toISOString() }).eq("id", linha.id), "Liberando a trava");

  const result = await salesActions.reprocessSalesEvent({ id: linha.id });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.ok, false);
  assert.equal(result.data.processingStatus, "failed");

  const data = await salesQueries.getSalesSettingsData();
  const item = data.events.find((event) => event.id === linha.id);
  assert.equal(item.canReprocess, true);
  assert.equal(item.productTitle, curso.titulo, "a lista mostra o produto da escola ligado ao codigo");

  // O produtor tira o codigo do produto: o reprocesso vira "ignorado" e a plataforma volta a "Conectada".
  await ligarCodigo(curso.id, "");
  const ignorado = await salesActions.reprocessSalesEvent({ id: linha.id });
  assert.equal(ignorado.ok, true, JSON.stringify(ignorado));
  assert.equal(ignorado.data.processingStatus, "ignored");
  assert.equal((await integracao()).status, "configured", "sem vendas com erro, a situacao volta sozinha");
});

test("venda presa em 'received' sem ninguem para marcar: a tela e o hub mostram 'Precisa de atencao' ao vivo e gravam na plataforma", async () => {
  assert.equal((await integracao()).status, "configured");
  const antigo = new Date(Date.now() - 10 * 60_000).toISOString();
  const presa = payload({ email: PRESO.email, id: "presa-ao-vivo", nome: PRESO.nome, transaction: "HP-PRESO-0010" });
  unwrap(
    await db.from("webhook_events").insert({
      buyer_email: PRESO.email,
      event_type: "PURCHASE_APPROVED",
      external_event_id: presa.id,
      external_product_id: String(presa.data.product.id),
      normalized_type: "purchase_approved",
      payload: presa,
      processing_started_at: antigo,
      processing_status: "received",
      provider: "hotmart",
      received_at: antigo,
      signature_valid: true,
      transaction_id: presa.data.purchase.transaction
    }),
    "Gravando evento preso"
  );

  const data = await salesQueries.getSalesSettingsData();
  const hotmart = data.providers.find((card) => card.provider === "hotmart");
  assert.equal(hotmart.status, "needs_attention");
  assert.match(hotmart.lastError, /1 venda com erro ou presa aguardando reprocesso/);
  const gravada = await integracao();
  assert.equal(gravada.status, "needs_attention", "a linha da plataforma tambem fica marcada");
  assert.match(gravada.last_error, /presa/);
  assert.equal((await salesQueries.getSalesProviderStatuses())[0].status, "needs_attention", "o hub le a mesma situacao");

  // Resolvida (aqui: apagada), a tela nao volta sozinha; o proximo evento processado volta a 'Conectada'.
  unwrap(await db.from("webhook_events").delete().eq("external_event_id", presa.id), "Apagando evento preso");
  assert.equal((await postJson(payload({ event: "PURCHASE_BILLET_PRINTED", id: "boleto-depois-da-presa", transaction: "HP-TESTE-0301" }))).status, 200);
  assert.equal((await integracao()).status, "configured");
});

test("eventos que nao mudam acesso ficam guardados so com o envelope; JSON invalido e 400", async () => {
  const boleto = await evento("boleto-depois-do-erro");
  assert.equal(boleto.outcome, "ignored");
  assert.match(boleto.outcome_detail, /não muda o acesso/);
  assert.equal("data" in boleto.payload, false, "evento que nao muda acesso nao guarda dados do comprador");
  assert.equal(boleto.buyer_email, null, "nem o e-mail na coluna");
  assert.deepEqual(Object.keys(boleto.payload).sort(), ["creation_date", "event", "id", "version"]);

  const invalido = await route.POST(
    new Request("http://127.0.0.1:3100/api/webhooks/hotmart", { body: "{nao-e-json", headers: { "content-type": "application/json", "x-hotmart-hottok": TOKEN }, method: "POST" })
  );
  assert.equal(invalido.status, 400);
});

test("excluir o aluno anonimiza as vendas dele: e-mail some e o payload fica so com o envelope", async () => {
  actAs(produtor);
  const { conta } = await acessosDe(COMPRADOR.email);
  const result = await studentActions.deleteStudent({ confirmEmail: COMPRADOR.email, userId: conta.id });
  assert.equal(result.ok, true, JSON.stringify(result));

  const linhas = (await eventos()).filter((row) => ["compra-1", "reembolso-1", "compra-de-volta"].includes(row.external_event_id.slice(PREFIXO.length)));
  assert.equal(linhas.length, 3);

  for (const linha of linhas) {
    assert.equal(linha.buyer_email, null, `${linha.external_event_id}: sem e-mail`);
    assert.equal(linha.user_id, null, `${linha.external_event_id}: sem aluno`);
    assert.equal("data" in linha.payload, false, `${linha.external_event_id}: sem dados do comprador`);
    assert.equal(linha.payload.anonymized, true);
    assert.equal(linha.processing_status !== "received", true, "o historico do resultado fica");
  }

  assert.equal((await acessosDe(COMPRADOR.email)).conta, null);
});

test("Hoje: a origem dos acessos do periodo separa Hotmart de equipe", async () => {
  const { data, error } = await db.rpc("admin_access_origins", {
    p_content_id: null,
    p_end: new Date(Date.now() + 60_000).toISOString(),
    p_start: new Date(Date.now() - 3_600_000).toISOString()
  });
  assert.equal(error, null, error?.message);
  const hotmart = data.find((row) => row.source_provider === "hotmart");
  assert.ok(hotmart && Number(hotmart.total) >= 3, JSON.stringify(data));
});

test("token guardado em texto puro (formato antigo): o webhook responde 503 e o cartao pede para trocar o token", async () => {
  unwrap(await db.from("integration_settings").update({ secret: TOKEN }).eq("provider", "hotmart"), "Simulando token antigo");

  const response = await post(payload({ id: "token-antigo" }));
  assert.equal(response.status, 503);
  const row = await integracao();
  assert.equal(row.status, "needs_attention");
  assert.match(row.last_error, /formato antigo/);

  actAs(produtor);
  assert.equal((await salesActions.saveSalesSecret({ provider: "hotmart", secret: TOKEN })).ok, true);
  assert.equal((await integracao()).secret, hashSalesSecret(TOKEN));
});

test("desconectar apaga o hash do token e o webhook volta a responder 503", async () => {
  actAs(produtor);
  const result = await salesActions.disconnectSalesProvider({ provider: "hotmart" });
  assert.equal(result.ok, true);

  const row = await integracao();
  assert.equal(row.status, "not_configured");
  assert.equal(row.secret, null);
  assert.equal(row.secret_status, "missing");
  assert.equal((await post(payload({ id: "depois-de-desconectar" }))).status, 503);
});
