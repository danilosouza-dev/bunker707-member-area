import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import {
  apagarContaDeTeste,
  ESCOLA_DE_TESTE,
  limparComunicacao,
  limparProgresso,
  SENHA_DE_TESTE,
  seedEscolaDeTeste,
  usuarioDeTeste
} from "../fixtures/escola-de-teste.mjs";

// Pop-ups da v3b-2 (docs/29 §8.3) contra o banco LOCAL de verdade: a hora marcada (o resumo leva o startsAt,
// o show antes da hora e 409 not_started, na hora abre), "No primeiro acesso" (a primeira vez na area e com
// estes produtos, a marca first_access_at, o reembolso que tira, as linhas de um app antigo que saem), a trava
// da troca de momento num pop-up que ja foi ao ar, o PublishedNotice.popup do toast (publicar e aprovar), "Ao
// concluir um curso" (a rota de progresso diz quando o curso fecha, uma vez so mesmo com dois pedidos ao mesmo
// tempo; o show confere no banco) e os Modelos com os momentos novos. O produtor publica pelas Server Actions;
// o aluno pede o resumo e o show pelas rotas, como o navegador.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/communications/actions.ts");
const templateActions = await import("../../src/server/communications/template-actions.ts");
const templateQueries = await import("../../src/server/communications/template-queries.ts");
const { emptyNoticeDraft } = await import("../../src/server/communications/schemas.ts");
const { fetchCampaign } = await import("../../src/server/communications/store.ts");
const { refreshPopupDeliveries } = await import("../../src/server/communications/dispatch.ts");
const { showPopup } = await import("../../src/server/communications/popups.ts");
const { FIRST_ACCESS_SWITCH_MESSAGE } = await import("../../src/server/communications/popup-first-access.ts");
const summaryRoute = await import("../../src/app/api/notifications/summary/route.ts");
const showRoute = await import("../../src/app/api/popups/[id]/show/route.ts");
const progressRoute = await import("../../src/app/api/progress/lessons/route.ts");

const { curso, cursoBloqueado, cursoLiberacao } = ESCOLA_DE_TESTE;
const aluna = usuarioDeTeste(contas.aluna);
const alunaExpirada = usuarioDeTeste(contas.alunaAcessoExpirado);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);
const produtor = usuarioDeTeste(contas.produtor);
const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const ACESSO = "teste-v3b2-momentos:";
const NOVA = { email: "nova.v3b2-momentos@bunker707.test", nome: "Aluna Nova v3b-2" };
const REDATORA = { email: "redatora.v3b2-momentos@bunker707.test", nome: "Redatora v3b-2" };

const BASE = emptyNoticeDraft("popup");
const quemTemOCurso = { kind: "rules", root: { items: [{ op: "has", productIds: [curso.id], type: "product" }], match: "all" } };
const SEM_LIMITE = { everyMinutes: null, maxPerDay: null, maxTotal: null, mode: "repeat", stopOn: "never" };

function popup({ popup: settings = {}, ...extra } = {}) {
  const frequency = settings.frequency ?? { mode: "once" };

  return {
    ...BASE,
    audience: { kind: "everyone" },
    body: "Boas-vindas à área.",
    title: "Pop-up v3b-2",
    ...extra,
    popup: { ...BASE.popup, ...settings, frequency },
    repeat: frequency.mode === "once" ? "once" : "until_action"
  };
}

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

async function publicar(draft, user = produtor) {
  actAs(user);
  const salvo = ok(await actions.saveNoticeDraft({ draft }));
  return ok(await actions.publishNotice({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));
}

async function recalcular(id) {
  const campaign = await fetchCampaign(db, id);
  return refreshPopupDeliveries({ campaign, db });
}

async function resumoDe(user, page) {
  actAs(user);
  const response = await summaryRoute.GET(new Request(`http://localhost/api/notifications/summary?page=${encodeURIComponent(page)}`));
  assert.equal(response.status, 200);
  return (await response.json()).data.popups;
}

async function mostrar(user, id, page, trigger = "page_load") {
  actAs(user);
  const response = await showRoute.POST(
    new Request(`http://localhost/api/popups/${id}/show`, { body: JSON.stringify({ page, trigger }), headers: { "content-type": "application/json" }, method: "POST" }),
    { params: Promise.resolve({ id }) }
  );
  return { body: await response.json(), status: response.status };
}

async function linhaDe(campaignId, userId) {
  return unwrap(
    await db.from("campaign_deliveries").select("eligible,first_access_at,impressions").eq("campaign_id", campaignId).eq("user_id", userId).maybeSingle(),
    "Lendo a linha do pop-up"
  );
}

async function entrouEm(userId, quando) {
  unwrap(await db.from("profiles").update({ last_sign_in_at: quando }).eq("id", userId), "Gravando o ultimo login");
}

async function liberar(userId, targetId, targetType = "standalone_course") {
  const agora = new Date().toISOString();
  return unwrap(
    await db
      .from("entitlements")
      .insert({ ends_at: null, source_event_id: `${ACESSO}${randomUUID()}`, source_provider: "manual", starts_at: agora, status: "active", target_id: targetId, target_type: targetType, user_id: userId })
      .select("id")
      .single(),
    "Liberando acesso de teste"
  ).id;
}

/** Conta nova de verdade (criada agora): a de um teste anterior sai antes, com as linhas dela. */
async function criarConta(pessoa) {
  await apagarContaDeTeste(db, pessoa.email);
  const { user } = unwrap(
    await db.auth.admin.createUser({ email: pessoa.email, email_confirm: true, password: SENHA_DE_TESTE, user_metadata: { full_name: pessoa.nome } }),
    `Criando ${pessoa.nome}`
  );
  return usuarioDeTeste({ ...pessoa, id: user.id });
}

let loginsDeAntes = [];

async function limpar() {
  await limparComunicacao(db);
  unwrap(await db.from("entitlements").delete().like("source_event_id", `${ACESSO}%`), "Apagando acessos de teste");
}

before(async () => {
  loginsDeAntes = unwrap(
    await db.from("profiles").select("id,last_sign_in_at").in("id", [aluna.id, alunaExpirada.id, alunoSemAcesso.id]),
    "Lendo os logins de antes"
  );
  await limpar();
  await apagarContaDeTeste(db, NOVA.email);
  await apagarContaDeTeste(db, REDATORA.email);
  await limparProgresso(db, [aluna.id, produtor.id]);
});

beforeEach(async () => {
  await limpar();
  // Contas antigas que ja entraram na area (o primeiro acesso nao vale para elas, a nao ser que o teste mude).
  for (const conta of [aluna, alunaExpirada, alunoSemAcesso]) {
    await entrouEm(conta.id, new Date(Date.now() - 30 * DIA).toISOString());
  }
});

after(async () => {
  await limpar();
  await apagarContaDeTeste(db, NOVA.email);
  await apagarContaDeTeste(db, REDATORA.email);
  await limparProgresso(db, [aluna.id, produtor.id]);

  for (const linha of loginsDeAntes) {
    await entrouEm(linha.id, linha.last_sign_in_at);
  }
});

/* ------------------------------------------------------------------------------------------------
 * 1. Hora marcada
 * ---------------------------------------------------------------------------------------------- */

test("hora marcada: o resumo traz o agendado com startsAt; o show antes e 409 not_started; na hora abre; fora do segmento 404", async () => {
  const comeca = new Date(Date.now() + HORA);
  comeca.setUTCMilliseconds(0);
  const publicado = await publicar(popup({ audience: quemTemOCurso, popup: { pages: ["saved"] }, title: "Live às 20h", window: { endsAt: null, startsAt: comeca.toISOString() } }));

  assert.deepEqual(publicado.popup, { startsInFuture: true, trigger: "page_load" }, "o toast sabe que comeca depois");
  assert.equal((await linhaDe(publicado.id, aluna.id)).eligible, true, "as linhas existem antes do inicio");

  const plano = await resumoDe(aluna, "saved");
  assert.deepEqual(plano.pages, ["saved"]);
  const [item] = plano.plan;
  assert.equal(item.id, publicado.id);
  assert.equal(Date.parse(item.startsAt), comeca.getTime());
  assert.equal(Date.parse(item.notBefore), comeca.getTime());

  const antes = await mostrar(aluna, publicado.id, "saved");
  assert.equal(antes.status, 409);
  assert.equal(antes.body.reason, "not_started");
  assert.equal(Date.parse(antes.body.nextAt), comeca.getTime());
  assert.equal((await linhaDe(publicado.id, aluna.id)).impressions, 0, "nada gravado antes da hora");

  const naHora = await showPopup(aluna.id, publicado.id, { page: "saved", trigger: "page_load" }, comeca.getTime() + 3_000);
  assert.equal(naHora.popup.title, "Live às 20h");
  assert.equal((await linhaDe(publicado.id, aluna.id)).impressions, 1);

  const fora = await mostrar(alunoSemAcesso, publicado.id, "saved");
  assert.equal(fora.status, 404, "quem nao esta no segmento nao fica sabendo");
});

/* ------------------------------------------------------------------------------------------------
 * 2. Primeiro acesso: a primeira vez na area
 * ---------------------------------------------------------------------------------------------- */

test("primeiro acesso, area: conta antiga que ja entrou fica de fora; conta nova e conta que nunca entrou ganham a linha com a marca", async () => {
  await entrouEm(alunoSemAcesso.id, null);
  const publicado = await publicar(popup({ popup: { pages: ["home"], trigger: "first_login" }, title: "Boas-vindas" }));

  assert.deepEqual(publicado.popup, { startsInFuture: false, trigger: "first_login" });
  assert.equal(await linhaDe(publicado.id, aluna.id), null, "a aluna antiga que ja entrou nao tem linha");
  const nuncaEntrou = await linhaDe(publicado.id, alunoSemAcesso.id);
  assert.equal(nuncaEntrou.eligible, true);
  assert.notEqual(nuncaEntrou.first_access_at, null, "marcada pelo recalculo novo");

  const nova = await criarConta(NOVA);
  await entrouEm(nova.id, new Date().toISOString());
  await recalcular(publicado.id);
  const daNova = await linhaDe(publicado.id, nova.id);
  assert.equal(daNova.eligible, true, "conta criada depois da publicacao, mesmo ja tendo entrado");
  assert.notEqual(daNova.first_access_at, null);

  const plano = await resumoDe(nova, "home");
  assert.deepEqual(plano.plan.map((entry) => [entry.id, entry.trigger]), [[publicado.id, "first_login"]]);
  const aberto = await mostrar(nova, publicado.id, "home", "first_login");
  assert.equal(aberto.status, 200, JSON.stringify(aberto.body));
  assert.equal((await resumoDe(aluna, "home")).plan.length, 0, "a aluna antiga nao recebe");

  // Quem nunca tinha entrado entra agora: continua elegivel (D8), mesmo nao sendo mais candidato.
  await entrouEm(alunoSemAcesso.id, new Date().toISOString());
  await recalcular(publicado.id);
  assert.equal((await linhaDe(publicado.id, alunoSemAcesso.id)).eligible, true);
});

/* ------------------------------------------------------------------------------------------------
 * 3. Primeiro acesso: a primeira vez com estes produtos
 * ---------------------------------------------------------------------------------------------- */

test("primeiro acesso, produtos: acesso novo conta; acesso antigo a outro produto nao; a plataforma conta; o reembolso tira", async () => {
  const publicado = await publicar(popup({ popup: { accessProducts: [cursoBloqueado.id], pages: ["any"], trigger: "first_login" }, title: "Boas-vindas ao produto" }));
  const linhaGravada = unwrap(await db.from("campaigns").select("popup_access_products,popup_trigger").eq("id", publicado.id).single(), "Lendo o pop-up");
  assert.deepEqual(linhaGravada, { popup_access_products: [cursoBloqueado.id], popup_trigger: "first_login" });
  assert.equal(await linhaDe(publicado.id, aluna.id), null, "acesso antigo a outro produto (e ja entrou) nao conta");

  const acesso = await liberar(aluna.id, cursoBloqueado.id);
  await liberar(alunoSemAcesso.id, "platform", "platform");
  await recalcular(publicado.id);

  const daAluna = await linhaDe(publicado.id, aluna.id);
  assert.equal(daAluna.eligible, true, "acesso novo ao produto, mesmo ja usando a area");
  assert.notEqual(daAluna.first_access_at, null);
  assert.equal((await linhaDe(publicado.id, alunoSemAcesso.id)).eligible, true, "a plataforma inteira vale para qualquer lista");
  assert.equal(await linhaDe(publicado.id, alunaExpirada.id), null);

  // Reembolso (o acesso deixa de estar ativo): a linha sai no recalculo seguinte, mesmo marcada.
  unwrap(await db.from("entitlements").update({ status: "revoked" }).eq("id", acesso), "Reembolsando");
  await recalcular(publicado.id);
  assert.equal((await linhaDe(publicado.id, aluna.id)).eligible, false);
  assert.equal((await linhaDe(publicado.id, alunoSemAcesso.id)).eligible, true, "quem tem a plataforma fica");
});

/* ------------------------------------------------------------------------------------------------
 * 3a. Linhas de um app antigo
 * ---------------------------------------------------------------------------------------------- */

test("linhas de um app antigo (elegiveis sem a marca) saem no recalculo; a conta nova e a marcada que ja entrou ficam", async () => {
  await entrouEm(alunoSemAcesso.id, null);
  const publicado = await publicar(popup({ popup: { pages: ["home"], trigger: "first_login" }, title: "Boas-vindas" }));
  assert.notEqual((await linhaDe(publicado.id, alunoSemAcesso.id)).first_access_at, null);
  await entrouEm(alunoSemAcesso.id, new Date().toISOString());

  // O app de antes le first_login como page_load e habilita o segmento inteiro, sem a marca.
  unwrap(
    await db.from("campaign_deliveries").upsert(
      [aluna.id, alunaExpirada.id].map((userId) => ({ campaign_id: publicado.id, eligible: true, user_id: userId })),
      { onConflict: "campaign_id,user_id" }
    ),
    "Gravando linhas como o app antigo"
  );
  const nova = await criarConta(NOVA);

  const changes = await recalcular(publicado.id);

  assert.equal((await linhaDe(publicado.id, aluna.id)).eligible, false);
  assert.equal((await linhaDe(publicado.id, alunaExpirada.id)).eligible, false);
  assert.equal((await linhaDe(publicado.id, nova.id)).eligible, true);
  assert.notEqual((await linhaDe(publicado.id, nova.id)).first_access_at, null);
  assert.equal((await linhaDe(publicado.id, alunoSemAcesso.id)).eligible, true, "marcada que ja entrou continua");
  assert.equal(changes.removed, 2);
  const contagem = unwrap(await db.from("campaigns").select("audience_count").eq("id", publicado.id).single(), "Lendo a contagem").audience_count;
  assert.equal(contagem, changes.audienceCount);
});

/* ------------------------------------------------------------------------------------------------
 * 4. Trava da troca de momento e o PublishedNotice.popup
 * ---------------------------------------------------------------------------------------------- */

test("num pop-up que ja foi ao ar, trocar de ou para 'No primeiro acesso' e 400 em popup.trigger; o rascunho troca a vontade", async () => {
  const draft = popup({ popup: { pages: ["home"] }, title: "No ar" });
  const publicado = await publicar(draft);

  actAs(produtor);
  const troca = await actions.saveNoticeDraft({ draft: { ...draft, popup: { ...draft.popup, trigger: "first_login" } }, expectedUpdatedAt: publicado.updatedAt, id: publicado.id });
  assert.equal(troca.ok, false);
  assert.equal(troca.status, 400);
  assert.deepEqual(troca.fieldErrors?.["popup.trigger"], [FIRST_ACCESS_SWITCH_MESSAGE]);
  assert.equal(unwrap(await db.from("campaigns").select("popup_trigger").eq("id", publicado.id).single(), "Lendo").popup_trigger, "page_load", "nada gravado");

  const mesma = await actions.saveNoticeDraft({ draft: { ...draft, title: "No ar, editado" }, expectedUpdatedAt: publicado.updatedAt, id: publicado.id });
  assert.equal(mesma.ok, true, JSON.stringify(mesma));

  const primeiro = await publicar(popup({ popup: { pages: ["home"], trigger: "first_login" }, title: "Primeiro no ar" }));
  actAs(produtor);
  const volta = await actions.saveNoticeDraft({ draft: popup({ popup: { pages: ["home"] }, title: "Primeiro no ar" }), expectedUpdatedAt: primeiro.updatedAt, id: primeiro.id });
  assert.deepEqual(volta.fieldErrors?.["popup.trigger"], [FIRST_ACCESS_SWITCH_MESSAGE], "sair do primeiro acesso tambem");

  const rascunho = ok(await actions.saveNoticeDraft({ draft: popup({ popup: { pages: ["home"] } }) }));
  const trocado = ok(
    await actions.saveNoticeDraft({ draft: popup({ popup: { accessProducts: [curso.id], pages: ["home"], trigger: "first_login" } }), expectedUpdatedAt: rascunho.updatedAt, id: rascunho.id })
  );
  const gravado = unwrap(await db.from("campaigns").select("popup_access_products,popup_trigger").eq("id", trocado.id).single(), "Lendo");
  assert.deepEqual(gravado, { popup_access_products: [curso.id], popup_trigger: "first_login" });
});

test("'No primeiro acesso' no ar: mudar so os produtos ou o Comeca apaga a hora do ultimo recalculo (o job do minuto seguinte refaz); so o titulo nao", async () => {
  const draft = popup({ popup: { accessProducts: [curso.id], pages: ["home"], trigger: "first_login" }, title: "Boas-vindas ao curso" });
  const publicado = await publicar(draft);
  const marca = async () => unwrap(await db.from("campaigns").select("audience_refreshed_at").eq("id", publicado.id).single(), "Lendo a hora do recalculo").audience_refreshed_at;
  assert.notEqual(await marca(), null, "publicar recalcula na hora e grava a hora");

  actAs(produtor);
  const titulo = ok(await actions.saveNoticeDraft({ draft: { ...draft, title: "Boas-vindas, editado" }, expectedUpdatedAt: publicado.updatedAt, id: publicado.id }));
  assert.notEqual(await marca(), null, "so o titulo: nada a refazer");

  const produtos = ok(
    await actions.saveNoticeDraft({
      draft: { ...draft, popup: { ...draft.popup, accessProducts: [curso.id, cursoBloqueado.id] }, title: "Boas-vindas, editado" },
      expectedUpdatedAt: titulo.updatedAt,
      id: publicado.id
    })
  );
  assert.equal(await marca(), null, "so os produtos: a hora some e o job do minuto seguinte refaz");
  assert.deepEqual(
    unwrap(await db.from("campaigns").select("popup_access_products,status").eq("id", publicado.id).single(), "Lendo o pop-up"),
    { popup_access_products: [curso.id, cursoBloqueado.id].sort(), status: "active" }
  );

  // O recalculo (o do job) grava a hora de novo; mudar so o Comeca apaga outra vez.
  await recalcular(publicado.id);
  assert.notEqual(await marca(), null, "o recalculo gravou a hora");

  const comeca = new Date(Date.now() + HORA).toISOString();
  ok(
    await actions.saveNoticeDraft({
      draft: { ...draft, popup: { ...draft.popup, accessProducts: [curso.id, cursoBloqueado.id] }, title: "Boas-vindas, editado", window: { endsAt: null, startsAt: comeca } },
      expectedUpdatedAt: produtos.updatedAt,
      id: publicado.id
    })
  );
  assert.equal(await marca(), null, "so o Comeca: a hora some outra vez");
});

test("PublishedNotice.popup: aprovar devolve o mesmo que publicar; notificacao e pedido de aprovacao vao sem a chave", async () => {
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const redatoraId =
    data?.users.find((item) => item.email === REDATORA.email)?.id ??
    unwrap(
      await db.auth.admin.createUser({ email: REDATORA.email, email_confirm: true, password: SENHA_DE_TESTE, user_metadata: { full_name: REDATORA.nome } }),
      "Criando a redatora"
    ).user.id;
  unwrap(await db.from("admin_roles").upsert({ permissions: { actions: ["messaging.write"] }, role: "custom", user_id: redatoraId }, { onConflict: "user_id" }), "Dando a funcao");
  const redatora = usuarioDeTeste({ ...REDATORA, id: redatoraId });

  const comeca = new Date(Date.now() + 2 * HORA).toISOString();
  actAs(redatora);
  const salvo = ok(await actions.saveNoticeDraft({ draft: popup({ popup: { pages: ["home"] }, window: { endsAt: null, startsAt: comeca } }) }));
  const pedido = ok(await actions.publishNotice({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));
  assert.equal(pedido.situation, "pending_approval");
  assert.equal("popup" in pedido, false);

  actAs(produtor);
  const aprovado = ok(await actions.approveNotice({ expectedUpdatedAt: pedido.updatedAt, id: pedido.id }));
  assert.deepEqual(aprovado.popup, { startsInFuture: true, trigger: "page_load" });

  const notificacao = ok(await actions.saveNoticeDraft({ draft: { ...emptyNoticeDraft("inbox"), audience: quemTemOCurso, title: "Só no sino" } }));
  const enviada = ok(await actions.publishNotice({ expectedUpdatedAt: notificacao.updatedAt, id: notificacao.id }));
  assert.equal("popup" in enviada, false);
});

/* ------------------------------------------------------------------------------------------------
 * 5. Curso concluido
 * ---------------------------------------------------------------------------------------------- */

async function concluir(user, completedLessonIds, { lessonId = completedLessonIds.at(-1), status = "completed" } = {}) {
  actAs(user);
  const response = await progressRoute.PUT(
    new Request("http://localhost/api/progress/lessons", {
      body: JSON.stringify({ completedLessonIds, contentId: curso.id, lessonId, status }),
      headers: { "content-type": "application/json" },
      method: "PUT"
    })
  );
  assert.equal(response.status, 200);
  return response.json();
}

const TODAS = [curso.aulas.aula1, curso.aulas.aula2, curso.aulas.aula3];

test("curso concluido: a resposta leva courseCompleted so no pedido que fecha o curso; de novo nao; desmarcar e concluir de novo sim; a equipe nunca", async () => {
  await limparProgresso(db, [aluna.id, produtor.id]);

  assert.equal((await concluir(aluna, [curso.aulas.aula1])).courseCompleted, undefined);
  assert.equal((await concluir(aluna, [curso.aulas.aula1, curso.aulas.aula2])).courseCompleted, undefined);
  const fechou = await concluir(aluna, TODAS);
  assert.equal(fechou.courseCompleted, true);
  assert.deepEqual([...fechou.data.completedLessonIds].sort(), [...TODAS].sort());
  assert.equal((await concluir(aluna, TODAS)).courseCompleted, undefined, "ja estava completo");

  const desmarcou = await concluir(aluna, [curso.aulas.aula1, curso.aulas.aula2], { lessonId: curso.aulas.aula3, status: "in_progress" });
  assert.equal(desmarcou.data.completedLessonIds.includes(curso.aulas.aula3), false, "desmarcou");
  assert.equal(desmarcou.courseCompleted, undefined);
  assert.equal((await concluir(aluna, TODAS)).courseCompleted, true, "cada virada para 100 % e uma nova chance");

  assert.equal((await concluir(produtor, TODAS)).courseCompleted, undefined, "a equipe nunca");
});

test("curso concluido: dois pedidos ao mesmo tempo que fecham o curso dao exatamente um courseCompleted", async () => {
  await limparProgresso(db, [aluna.id]);
  await concluir(aluna, [curso.aulas.aula1, curso.aulas.aula2]);

  const respostas = await Promise.all([concluir(aluna, TODAS), concluir(aluna, TODAS)]);

  assert.equal(respostas.filter((body) => body.courseCompleted === true).length, 1);
});

test("show de 'Ao concluir um curso': curso completo no banco = 200 com o momento no historico; curso incompleto = 409 trigger", async () => {
  await limparProgresso(db, [aluna.id]);
  await concluir(aluna, TODAS);
  const publicado = await publicar(popup({ popup: { frequency: SEM_LIMITE, pages: ["lesson:*"], trigger: "course_completed" }, title: "Parabéns" }));

  const incompleto = await mostrar(aluna, publicado.id, `lesson:${cursoLiberacao.id}`, "course_completed");
  assert.equal(incompleto.status, 409);
  assert.deepEqual(incompleto.body, { error: "Pop-up fora da vez.", nextAt: null, reason: "trigger" });
  assert.equal((await linhaDe(publicado.id, aluna.id)).impressions, 0);

  const completo = await mostrar(aluna, publicado.id, `lesson:${curso.id}`, "course_completed");
  assert.equal(completo.status, 200, JSON.stringify(completo.body));
  const eventos = unwrap(
    await db.from("student_events").select("metadata").eq("user_id", aluna.id).eq("entity_id", publicado.id).eq("event_type", "message_impressed"),
    "Lendo o historico"
  );
  assert.deepEqual(eventos.map((row) => row.metadata), [{ campaign_id: publicado.id, page: `lesson:${curso.id}`, trigger: "course_completed" }]);
});

/* ------------------------------------------------------------------------------------------------
 * 6. Modelos
 * ---------------------------------------------------------------------------------------------- */

test("modelos: pop-up 'No primeiro acesso' com produtos e 'Ao concluir um curso' salvam, leem igual, abrem no editor e publicam", async () => {
  const TUDO = { audience: true, content: true, followUps: true };
  actAs(produtor);
  const primeiro = ok(
    await templateActions.saveTemplate({
      body: { draft: popup({ popup: { accessProducts: [cursoBloqueado.id, curso.id], pages: ["home"], trigger: "first_login" } }), followUps: null, include: TUDO, source: "notice" },
      name: "Boas-vindas v3b-2",
      origin: "notice_editor"
    })
  );
  const curso_ = ok(
    await templateActions.saveTemplate({
      body: { draft: popup({ popup: { pages: ["lesson:*"], trigger: "course_completed" } }), followUps: null, include: TUDO, source: "notice" },
      name: "Parabéns v3b-2",
      origin: "notice_editor"
    })
  );

  const detalhe = await templateQueries.getTemplateDetail(primeiro.id);
  assert.equal(detalhe.payload.version, 1);
  assert.equal(detalhe.payload.settings.popup.trigger, "first_login");
  assert.deepEqual(detalhe.payload.settings.popup.accessProducts, [curso.id, cursoBloqueado.id].sort());
  assert.equal((await templateQueries.getTemplateDetail(curso_.id)).payload.settings.popup.trigger, "course_completed");

  const inicio = await templateQueries.prepareNoticeStart(primeiro.id);
  assert.equal(inicio.ok, true);
  assert.equal(inicio.start.draft.popup.trigger, "first_login");
  assert.deepEqual(inicio.start.draft.window, { endsAt: null, startsAt: null }, "a janela nunca vem do modelo");

  const publicado = await publicar({ ...inicio.start.draft, title: "Boas-vindas do modelo" });
  assert.deepEqual(publicado.popup, { startsInFuture: false, trigger: "first_login" });
  const gravado = unwrap(await db.from("campaigns").select("popup_access_products,popup_trigger").eq("id", publicado.id).single(), "Lendo");
  assert.deepEqual(gravado, { popup_access_products: [curso.id, cursoBloqueado.id].sort(), popup_trigger: "first_login" });
});
