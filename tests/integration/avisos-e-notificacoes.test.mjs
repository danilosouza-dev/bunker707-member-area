import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { SupabaseClient } from "@supabase/supabase-js";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import {
  apagarContaDeTeste,
  ESCOLA_DE_TESTE,
  limparComentarios,
  limparComunicacao,
  SENHA_DE_TESTE,
  seedEscolaDeTeste,
  usuarioDeTeste
} from "../fixtures/escola-de-teste.mjs";

// Comunicacao v1 (docs/22; docs/18 §3) contra o banco LOCAL de verdade: o produtor cria e publica
// avisos pelas Server Actions, a aluna le o sino pelas rotas /api/notifications chamadas como funcao, o
// job do tick envia o que foi agendado, e respostas na aula viram "respondeu seu comentário" e
// "mencionou você". A equipe nunca recebe aviso nem entra na contagem; quem nao tem o produto do
// segmento tambem nao.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/communications/actions.ts");
const { emptyNoticeDraft } = await import("../../src/server/communications/schemas.ts");
const { getNoticeDetail, listNotices } = await import("../../src/server/communications/queries.ts");
const { listNotifications } = await import("../../src/server/communications/inbox.ts");
const { loadAudienceFacts } = await import("../../src/server/communications/audience-facts.ts");
const { resolveAudienceUserIds } = await import("../../src/server/communications/audience.ts");
const { processCommunications } = await import("../../src/server/communications/dispatch.ts");
const { settleCommentNotifications } = await import("../../src/server/communications/comment-notifications.ts");
const { runJobsTick } = await import("../../src/server/jobs/run-tick.ts");
const { jobRegistry } = await import("../../src/server/jobs/registry.ts");
const { COMMUNICATIONS_JOB_NAME } = await import("../../src/server/jobs/communications-job.ts");
const { moderateLessonComment } = await import("../../src/server/comments/comment-store.ts");
const { replyToComment } = await import("../../src/server/community/actions.ts");
const notificationsRoute = await import("../../src/app/api/notifications/route.ts");
const summaryRoute = await import("../../src/app/api/notifications/summary/route.ts");
const readRoute = await import("../../src/app/api/notifications/read/route.ts");
const clickRoute = await import("../../src/app/api/notifications/[id]/click/route.ts");
const responseRoute = await import("../../src/app/api/notifications/[id]/response/route.ts");
const lessonsRoute = await import("../../src/app/api/comments/lessons/[lessonId]/route.ts");
const audioRoute = await import("../../src/app/api/admin/communications/audio/route.ts");

const { curso } = ESCOLA_DE_TESTE;
const aula = curso.aulas.aula1;
const aluna = usuarioDeTeste(contas.aluna);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);
const alunaAcessoExpirado = usuarioDeTeste(contas.alunaAcessoExpirado);
const produtor = usuarioDeTeste(contas.produtor);
const professor = usuarioDeTeste(contas.professor);
const analista = usuarioDeTeste(contas.analista);
const equipe = [produtor, professor, analista];
const todasAsContas = Object.values(contas).map((conta) => conta.id);

// Pessoa da equipe com uma funcao personalizada que so cria avisos (messaging.write, sem publicar).
const REDATORA = { email: "redatora.comunicacao@bunker707.test", nome: "Redatora de Avisos" };

const quemTemOCurso = { kind: "rules", root: { items: [{ op: "has", productIds: [curso.id], type: "product" }], match: "all" } };
const linkDaAula = `/conteudo/${curso.id}/aulas/${curso.modulos.modulo1}?lessonId=${aula}`;

function rascunho(extra = {}) {
  return { ...emptyNoticeDraft("inbox"), audience: quemTemOCurso, body: "Traga suas dúvidas para a aula ao vivo.", title: "Aula ao vivo amanhã", ...extra };
}

async function criarRedatora() {
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let user = data?.users.find((item) => item.email === REDATORA.email);

  if (!user) {
    user = unwrap(
      await db.auth.admin.createUser({ email: REDATORA.email, email_confirm: true, password: SENHA_DE_TESTE, user_metadata: { full_name: REDATORA.nome } }),
      "Criando a redatora"
    ).user;
  }

  unwrap(
    await db.from("admin_roles").upsert({ permissions: { actions: ["messaging.write"] }, role: "custom", user_id: user.id }, { onConflict: "user_id" }),
    "Dando a funcao personalizada"
  );

  return usuarioDeTeste({ ...REDATORA, id: user.id });
}

async function limparTudo() {
  await limparComunicacao(db);
  await limparComentarios(db, todasAsContas);
}

before(limparTudo);
after(async () => {
  await limparTudo();
  await apagarContaDeTeste(db, REDATORA.email);
});

/* ------------------------------------------------------------------------------------------------
 * Apoio: rotas do aluno chamadas como funcao
 * ---------------------------------------------------------------------------------------------- */

async function sino(user, query = "") {
  actAs(user);
  const response = await notificationsRoute.GET(new Request(`http://localhost/api/notifications${query}`));
  const body = await response.json();

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);

  return body.data;
}

async function resumo(user) {
  actAs(user);
  const response = await summaryRoute.GET(new Request("http://localhost/api/notifications/summary"));

  assert.equal(response.status, 200);

  return (await response.json()).data;
}

function marcar(user, payload) {
  actAs(user);
  return readRoute.POST(
    new Request("http://localhost/api/notifications/read", { body: JSON.stringify(payload), headers: { "content-type": "application/json" }, method: "POST" })
  );
}

function clicar(user, id) {
  actAs(user);
  return clickRoute.POST(new Request(`http://localhost/api/notifications/${id}/click`, { method: "POST" }), { params: Promise.resolve({ id }) });
}

function responder(user, id, value) {
  actAs(user);
  return responseRoute.POST(
    new Request(`http://localhost/api/notifications/${id}/response`, {
      body: JSON.stringify({ response: value }),
      headers: { "content-type": "application/json" },
      method: "POST"
    }),
    { params: Promise.resolve({ id }) }
  );
}

function comentar(user, body, extra = {}) {
  actAs(user);
  return lessonsRoute.POST(
    new Request(`http://localhost/api/comments/lessons/${aula}`, {
      body: JSON.stringify({ body, contentId: curso.id, ...extra }),
      headers: { "content-type": "application/json" },
      method: "POST"
    }),
    { params: Promise.resolve({ lessonId: aula }) }
  );
}

async function salvarEPublicar(user, draft) {
  actAs(user);
  const salvo = await actions.saveNoticeDraft({ draft });
  assert.equal(salvo.ok, true, JSON.stringify(salvo));
  const publicado = await actions.publishNotice({ expectedUpdatedAt: salvo.data.updatedAt, id: salvo.data.id });
  assert.equal(publicado.ok, true, JSON.stringify(publicado));

  return publicado.data;
}

async function linhasDoAviso(campaignId) {
  return unwrap(await db.from("notifications").select("id,user_id,is_test").eq("campaign_id", campaignId), "Lendo o sino do aviso");
}

const doAviso = (pagina, campaignId, titulo) => pagina.items.filter((item) => item.kind === "notice" && item.title === titulo && campaignId);

/* ------------------------------------------------------------------------------------------------
 * Permissoes, rascunho e segmento
 * ---------------------------------------------------------------------------------------------- */

test("analista recebe 403 em toda acao de aviso; sem sessao e 401", async () => {
  actAs(analista);
  assert.equal((await actions.saveNoticeDraft({ draft: rascunho() })).status, 403);
  assert.equal((await actions.previewNoticeAudience({ audience: quemTemOCurso })).status, 403);
  assert.equal((await actions.publishNotice({ id: randomUUID() })).status, 403);
  assert.equal((await actions.sendNoticeTestToMe({ id: randomUUID() })).status, 403);

  actAs(null);
  assert.equal((await actions.saveNoticeDraft({ draft: rascunho() })).status, 401);
});

test("rascunho invalido e recusado no campo: titulo longo, botao com javascript:, pop-up pedindo resposta", async () => {
  actAs(produtor);
  const longo = await actions.saveNoticeDraft({ draft: rascunho({ title: "x".repeat(81) }) });
  assert.equal(longo.status, 400);
  assert.deepEqual(longo.fieldErrors?.["draft.title"], ["Use até 80 caracteres."]);

  const botao = await actions.saveNoticeDraft({ draft: rascunho({ cta: { href: "javascript:alert(1)", label: "Abrir", target: "same_tab" } }) });
  assert.equal(botao.status, 400);
  assert.ok(botao.fieldErrors?.["draft.cta.href"], JSON.stringify(botao));

  const popup = await actions.saveNoticeDraft({
    draft: { ...emptyNoticeDraft("popup"), audience: quemTemOCurso, response: { acceptLabel: "Sim", declineLabel: "Não" }, title: "Oi" }
  });
  assert.equal(popup.status, 400);
  assert.ok(popup.fieldErrors?.["draft.response"]);
});

test("a contagem do segmento nunca inclui a equipe: o produto escolhe a aluna e deixa de fora quem nao tem acesso ou ja expirou", async () => {
  actAs(produtor);
  const previa = await actions.previewNoticeAudience({ audience: quemTemOCurso });
  assert.equal(previa.ok, true, JSON.stringify(previa));
  assert.equal(previa.data.description, `Alunos que têm acesso a ${curso.titulo}`);

  const fatos = await loadAudienceFacts(db, new Date());
  const ids = resolveAudienceUserIds(quemTemOCurso, fatos);
  assert.equal(previa.data.count, ids.length);
  assert.ok(ids.includes(aluna.id), "a aluna comprou o curso");
  assert.ok(!ids.includes(alunoSemAcesso.id), "quem nao comprou fica de fora");
  assert.ok(!ids.includes(alunaAcessoExpirado.id), "acesso que acabou ontem nao conta");

  const todos = resolveAudienceUserIds({ kind: "everyone" }, fatos);
  for (const pessoa of equipe) {
    assert.ok(!ids.includes(pessoa.id) && !todos.includes(pessoa.id), `${pessoa.email} e da equipe`);
  }
  assert.ok(todos.includes(alunoSemAcesso.id), "todos os alunos = toda conta que nao e da equipe");

  const vazio = await actions.previewNoticeAudience({ audience: { kind: "rules", root: { items: [{ paces: ["completed"], type: "pace" }, { op: "has", productIds: [curso.id], type: "product" }], match: "all" } } });
  assert.equal(vazio.ok, true);
  assert.ok(!vazio.data.sample.some((pessoa) => pessoa.id === aluna.id), "a aluna nao concluiu o curso");
});

/* ------------------------------------------------------------------------------------------------
 * Publicar agora e o sino da aluna
 * ---------------------------------------------------------------------------------------------- */

const estado = {};

test("publicar agora entrega so para quem tem o curso: a aluna ve no sino com o numero 1; equipe e aluno sem acesso nao recebem nada", async () => {
  const publicado = await salvarEPublicar(produtor, rascunho());
  estado.avisoId = publicado.id;

  assert.equal(publicado.situation, "sent");
  assert.ok(publicado.recipients >= 1);

  const pagina = await sino(aluna);
  const [item] = doAviso(pagina, publicado.id, "Aula ao vivo amanhã");
  assert.ok(item, JSON.stringify(pagina));
  assert.equal(item.body, "Traga suas dúvidas para a aula ao vivo.");
  assert.equal(item.actor, null, "aviso vem da escola");
  assert.equal(item.seenAt, null);
  assert.equal(item.readAt, null);
  assert.equal(pagina.unseen, 1);
  assert.equal(pagina.unread, 1);
  assert.deepEqual(await resumo(aluna), { popup: null, unseen: 1 });
  estado.notificacaoId = item.id;

  for (const pessoa of [alunoSemAcesso, alunaAcessoExpirado, ...equipe]) {
    const outra = await sino(pessoa);
    assert.equal(outra.items.length, 0, `${pessoa.email} nao recebe`);
    assert.equal(outra.unseen, 0);
  }

  const linhas = await linhasDoAviso(publicado.id);
  assert.ok(linhas.every((linha) => !equipe.some((pessoa) => pessoa.id === linha.user_id)));
  assert.equal(new Set(linhas.map((linha) => linha.user_id)).size, linhas.length, "uma linha por aluno");

  actAs(produtor);
  const detalhe = await getNoticeDetail(publicado.id);
  assert.equal(detalhe.situation, "sent");
  assert.equal(detalhe.stats.recipients, linhas.length);
  assert.equal(detalhe.recipientsCount, linhas.length);

  const auditoria = unwrap(
    await db.from("admin_audit_log").select("action,actor_id").eq("entity_id", publicado.id).eq("action", "communication.published"),
    "Lendo a auditoria"
  );
  assert.deepEqual(auditoria.map((linha) => linha.actor_id), [produtor.id]);
});

test("abrir o sino zera o numero e a notificacao continua nao lida; depois marcar uma e marcar todas", async () => {
  const vista = await marcar(aluna, { seen: true });
  assert.equal(vista.status, 200);
  assert.deepEqual((await vista.json()).data, { unread: 1, unseen: 0 });

  const depois = await sino(aluna);
  const item = depois.items.find((notificacao) => notificacao.id === estado.notificacaoId);
  assert.ok(item.seenAt, "vista");
  assert.equal(item.readAt, null, "a bolinha continua");

  const uma = await marcar(aluna, { ids: [estado.notificacaoId] });
  assert.deepEqual((await uma.json()).data, { unread: 0, unseen: 0 });

  unwrap(await db.from("notifications").update({ read_at: null }).eq("id", estado.notificacaoId), "Voltando a nao lida");
  const todas = await marcar(aluna, { all: true });
  assert.deepEqual((await todas.json()).data, { unread: 0, unseen: 0 });

  const eventos = unwrap(
    await db.from("student_events").select("event_type,entity_id").eq("user_id", aluna.id).eq("event_type", "notification_read"),
    "Lendo eventos"
  );
  assert.ok(eventos.some((evento) => evento.entity_id === estado.notificacaoId));

  assert.equal((await marcar(aluna, { ids: ["nao-e-id"] })).status, 400);
  assert.equal((await marcar(aluna, {})).status, 400);
  assert.equal((await sinoComStatus(aluna, "?filter=outro")).status, 400);
  assert.equal((await sinoComStatus(aluna, "?cursor=qualquer")).status, 400);
});

async function sinoComStatus(user, query) {
  actAs(user);
  return notificationsRoute.GET(new Request(`http://localhost/api/notifications${query}`));
}

test("clicar registra clicked_at; outra pessoa nao clica na notificacao da aluna (404) e id invalido e 400", async () => {
  unwrap(await db.from("notifications").update({ read_at: null, seen_at: null }).eq("id", estado.notificacaoId), "Voltando a nova");
  const clique = await clicar(aluna, estado.notificacaoId);
  assert.equal(clique.status, 200);
  assert.deepEqual((await clique.json()).data, { ok: true });

  const [linha] = unwrap(await db.from("notifications").select("seen_at,read_at,clicked_at").eq("id", estado.notificacaoId), "Lendo o clique");
  assert.ok(linha.clicked_at && linha.read_at && linha.seen_at, "clicar tambem conta como vista e lida");

  assert.equal((await clicar(alunoSemAcesso, estado.notificacaoId)).status, 404);
  assert.equal((await clicar(aluna, "123")).status, 400);
  actAs(null);
  assert.equal((await clickRoute.POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ id: estado.notificacaoId }) })).status, 401);

  actAs(produtor);
  const detalhe = await getNoticeDetail(estado.avisoId);
  assert.equal(detalhe.stats.clicked, 1);
  assert.ok(detalhe.stats.seen >= 1);
});

test("aviso com resposta: aceitar vale, a segunda resposta e 409 e aviso sem pedido de resposta e 404", async () => {
  const publicado = await salvarEPublicar(
    produtor,
    rascunho({ response: { acceptLabel: "Quero participar", declineLabel: "Agora não" }, title: "Convite: mentoria em grupo" })
  );
  const pagina = await sino(aluna);
  const item = pagina.items.find((notificacao) => notificacao.title === "Convite: mentoria em grupo");
  assert.deepEqual(item.response, { acceptLabel: "Quero participar", declineLabel: "Agora não", value: null });

  const aceite = await responder(aluna, item.id, "accepted");
  assert.equal(aceite.status, 200);
  assert.deepEqual((await aceite.json()).data, { response: "accepted" });

  const segunda = await responder(aluna, item.id, "declined");
  assert.equal(segunda.status, 409);
  assert.equal((await segunda.json()).error, "Você já respondeu.");

  const depois = await sino(aluna);
  assert.equal(depois.items.find((notificacao) => notificacao.id === item.id).response.value, "accepted");
  assert.equal((await responder(aluna, estado.notificacaoId, "accepted")).status, 404, "o primeiro aviso nao pede resposta");
  assert.equal((await responder(aluna, item.id, "talvez")).status, 400);

  actAs(produtor);
  const detalhe = await getNoticeDetail(publicado.id);
  assert.equal(detalhe.stats.accepted, 1);
  assert.equal(detalhe.stats.declined, 0);
});

/* ------------------------------------------------------------------------------------------------
 * Agendar, job do tick, cancelar e retirar
 * ---------------------------------------------------------------------------------------------- */

test("agendar: nada chega antes da hora; o job do tick envia uma vez so, mesmo rodando de novo", async () => {
  const emUmaHora = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const agendado = await salvarEPublicar(produtor, rascunho({ schedule: { mode: "at", sendAt: emUmaHora }, title: "Lembrete agendado" }));
  assert.equal(agendado.situation, "scheduled");

  const jobDaComunicacao = jobRegistry.filter((job) => job.name === COMMUNICATIONS_JOB_NAME);
  assert.equal(jobDaComunicacao.length, 1, "o job esta no registro do tick");
  assert.deepEqual(jobRegistry.map((job) => job.name).slice(-2), ["email-outbox", COMMUNICATIONS_JOB_NAME], "depois da fila de e-mails");

  const cedo = await runJobsTick({ jobs: jobDaComunicacao, supabase: db });
  assert.deepEqual(cedo.failed, [], JSON.stringify(cedo));
  assert.equal((await linhasDoAviso(agendado.id)).length, 0, "antes da hora nada sai");
  assert.ok(!(await sino(aluna)).items.some((item) => item.title === "Lembrete agendado"));

  // A hora chegou (o teste adianta o relogio do aviso em vez de esperar).
  unwrap(await db.from("campaigns").update({ send_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", agendado.id), "Adiantando o envio");
  const tick = await runJobsTick({ jobs: jobDaComunicacao, supabase: db });
  assert.deepEqual(tick.failed, [], JSON.stringify(tick));
  assert.ok(tick.ran.includes(COMMUNICATIONS_JOB_NAME));
  const execucoes = unwrap(await db.from("job_runs").select("job,status").eq("metadata->>tick_run_id", tick.tickRunId), "Lendo job_runs");
  assert.deepEqual(execucoes.map((linha) => linha.status), ["succeeded"]);

  const linhas = await linhasDoAviso(agendado.id);
  assert.equal(linhas.filter((linha) => linha.user_id === aluna.id).length, 1);
  assert.ok((await sino(aluna)).items.some((item) => item.title === "Lembrete agendado"));

  await processCommunications({ db });
  await runJobsTick({ jobs: jobDaComunicacao, supabase: db });
  assert.equal((await linhasDoAviso(agendado.id)).length, linhas.length, "rodar de novo nao duplica");

  actAs(produtor);
  const detalhe = await getNoticeDetail(agendado.id);
  assert.equal(detalhe.situation, "sent");
  assert.ok(detalhe.sentAt);
});

test("envio cortado no meio (tick que caiu) e retomado pelo tick seguinte sem duplicar quem ja recebeu", async () => {
  const emUmaHora = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const agendado = await salvarEPublicar(produtor, rascunho({ schedule: { mode: "at", sendAt: emUmaHora }, title: "Envio retomado" }));

  // Estado de um tick que reservou o envio, gravou a aluna e caiu antes de terminar.
  const cincoMinutosAtras = new Date(Date.now() - 5 * 60_000).toISOString();
  unwrap(
    await db.from("campaigns").update({ dispatch_started_at: cincoMinutosAtras, send_at: cincoMinutosAtras, status: "sending" }).eq("id", agendado.id),
    "Simulando o envio parado"
  );
  unwrap(
    await db.from("notifications").insert({ campaign_id: agendado.id, dedupe_key: `campaign:${agendado.id}`, kind: "notice", user_id: aluna.id }),
    "Simulando a parte ja enviada"
  );

  const rodada = await processCommunications({ db });
  assert.ok(rodada.dispatched >= 1, JSON.stringify(rodada));

  const linhas = await linhasDoAviso(agendado.id);
  assert.equal(linhas.filter((linha) => linha.user_id === aluna.id).length, 1, "a aluna recebeu uma vez so");
  actAs(produtor);
  assert.equal((await getNoticeDetail(agendado.id)).situation, "sent");

  // Reserva recente (outro tick trabalhando agora) nao e tomada.
  const outro = await salvarEPublicar(produtor, rascunho({ schedule: { mode: "at", sendAt: emUmaHora }, title: "Reserva de outro tick" }));
  unwrap(
    await db.from("campaigns").update({ dispatch_started_at: new Date().toISOString(), send_at: cincoMinutosAtras, status: "sending" }).eq("id", outro.id),
    "Simulando outro tick"
  );
  await processCommunications({ db });
  assert.equal((await linhasDoAviso(outro.id)).length, 0);
  actAs(produtor);
  assert.equal((await getNoticeDetail(outro.id)).situation, "sending");
  unwrap(await db.from("campaigns").update({ status: "canceled" }).eq("id", outro.id), "Encerrando a simulacao");
});

test("cancelar o agendamento volta a rascunho e o job nao envia nada", async () => {
  const emDuasHoras = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const agendado = await salvarEPublicar(produtor, rascunho({ schedule: { mode: "at", sendAt: emDuasHoras }, title: "Agendado e cancelado" }));
  actAs(produtor);
  const detalhe = await getNoticeDetail(agendado.id);
  const cancelado = await actions.cancelScheduledNotice({ expectedUpdatedAt: detalhe.updatedAt, id: agendado.id });
  assert.equal(cancelado.ok, true, JSON.stringify(cancelado));
  assert.equal(cancelado.data.situation, "draft");

  const velho = await actions.cancelScheduledNotice({ id: agendado.id });
  assert.equal(velho.status, 409, "ja nao esta agendado");

  unwrap(await db.from("campaigns").update({ send_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", agendado.id), "Adiantando o envio");
  await processCommunications({ db });
  assert.equal((await linhasDoAviso(agendado.id)).length, 0);
});

test("retirar a notificacao enviada tira do sino da aluna e o aviso fica cancelado", async () => {
  actAs(produtor);
  const antes = await getNoticeDetail(estado.avisoId, { permissions: { canPublish: true, canPublishLarge: true, canWrite: true } });
  assert.ok(antes.actions.includes("withdraw"));
  assert.ok(!(await getNoticeDetail(estado.avisoId, { permissions: { canPublish: false, canPublishLarge: false, canWrite: true } })).actions.includes("withdraw"));

  const velha = await actions.withdrawNotice({ expectedUpdatedAt: "2020-01-01T00:00:00.000Z", id: estado.avisoId });
  assert.equal(velha.status, 409, "versao velha da tela");
  assert.equal(velha.error, "Este aviso mudou em outra tela há instantes. Recarregue a página para ver a versão atual.");

  const retirado = await actions.withdrawNotice({ expectedUpdatedAt: antes.updatedAt, id: estado.avisoId });
  assert.equal(retirado.ok, true, JSON.stringify(retirado));
  assert.equal(retirado.data.situation, "canceled");
  assert.ok(retirado.data.removed >= 1);
  assert.ok(!(await sino(aluna)).items.some((item) => item.id === estado.notificacaoId));
  assert.equal((await linhasDoAviso(estado.avisoId)).length, 0);
});

test("enviar teste para mim: so quem pediu recebe, marcado como teste, fora dos numeros; repetir traz de volta como nova", async () => {
  actAs(produtor);
  const salvo = await actions.saveNoticeDraft({ draft: rascunho({ title: "Teste do produtor" }) });
  assert.equal(salvo.ok, true);

  const teste = await actions.sendNoticeTestToMe({ id: salvo.data.id });
  assert.equal(teste.ok, true, JSON.stringify(teste));
  const meu = await sino(produtor);
  assert.ok(meu.items.some((item) => item.title === "Teste do produtor"));
  assert.equal(meu.unseen, 1);
  assert.ok(!(await sino(aluna)).items.some((item) => item.title === "Teste do produtor"), "rascunho nao chega a ninguem");

  await marcar(produtor, { seen: true });
  assert.equal((await resumo(produtor)).unseen, 0);
  actAs(produtor);
  await actions.sendNoticeTestToMe({ id: salvo.data.id });
  assert.equal((await resumo(produtor)).unseen, 1, "o teste repetido volta como novo");

  const linhas = await linhasDoAviso(salvo.data.id);
  assert.deepEqual(linhas.map((linha) => [linha.user_id, linha.is_test]), [[produtor.id, true]]);
  actAs(produtor);
  assert.equal((await getNoticeDetail(salvo.data.id)).stats.recipients, 0, "teste nao conta");

  const popup = await actions.saveNoticeDraft({ draft: { ...emptyNoticeDraft("popup"), audience: quemTemOCurso, title: "Pop-up sem teste" } });
  assert.equal((await actions.sendNoticeTestToMe({ id: popup.data.id })).status, 422);
});

test("duplicar cria outro rascunho com o mesmo conteudo; excluir tira da lista; aviso enviado nao se exclui", async () => {
  actAs(produtor);
  const salvo = await actions.saveNoticeDraft({ draft: rascunho({ title: "Para duplicar" }) });
  const copia = await actions.duplicateNotice({ id: salvo.data.id });
  assert.equal(copia.ok, true, JSON.stringify(copia));
  assert.notEqual(copia.data.id, salvo.data.id);
  const detalhe = await getNoticeDetail(copia.data.id);
  assert.equal(detalhe.title, "Para duplicar");
  assert.equal(detalhe.situation, "draft");
  assert.deepEqual(detalhe.draft.audience, quemTemOCurso);

  const excluido = await actions.deleteNotice({ id: copia.data.id });
  assert.equal(excluido.ok, true, JSON.stringify(excluido));
  assert.equal(await getNoticeDetail(copia.data.id), null);
  const lista = await listNotices({ page: 1 });
  assert.ok(!lista.items.some((item) => item.id === copia.data.id));
  assert.ok(lista.items.some((item) => item.id === salvo.data.id));

  // ?pagina= depois do fim: o PostgREST responde 416 (PGRST103); a lista vem vazia, sem derrubar a tela.
  const depoisDoFim = await listNotices({ page: 5_000 });
  assert.deepEqual(depoisDoFim.items, []);
  assert.equal(depoisDoFim.page, 5_000);
  assert.ok(Number.isInteger(depoisDoFim.total) && depoisDoFim.total >= 0);

  const enviado = await salvarEPublicar(produtor, rascunho({ title: "Enviado nao se exclui" }));
  actAs(produtor);
  assert.equal((await actions.deleteNotice({ id: enviado.id })).status, 409);
});

/* ------------------------------------------------------------------------------------------------
 * Aprovacao (docs/17 D4)
 * ---------------------------------------------------------------------------------------------- */

test("quem so cria avisos envia para aprovacao; o dono aprova e a aluna recebe; devolver volta a rascunho", async () => {
  const redatora = await criarRedatora();
  const pedido = await salvarEPublicar(redatora, rascunho({ title: "Pedido de aprovação" }));
  assert.equal(pedido.situation, "pending_approval");
  assert.ok(!(await sino(aluna)).items.some((item) => item.title === "Pedido de aprovação"), "nada sai antes da aprovacao");

  actAs(redatora);
  assert.equal((await actions.approveNotice({ id: pedido.id })).status, 403, "quem pediu nao aprova");
  assert.equal((await actions.cancelScheduledNotice({ id: pedido.id })).status, 403, "sem messaging.publish");

  actAs(produtor);
  const aprovado = await actions.approveNotice({ id: pedido.id });
  assert.equal(aprovado.ok, true, JSON.stringify(aprovado));
  assert.equal(aprovado.data.situation, "sent");
  assert.ok((await sino(aluna)).items.some((item) => item.title === "Pedido de aprovação"));

  const detalhe = await getNoticeDetail(pedido.id);
  assert.equal(detalhe.approvedBy?.id, produtor.id);
  assert.equal(detalhe.requestedBy?.id, redatora.id);
  assert.equal(detalhe.createdBy?.id, redatora.id);

  const outro = await salvarEPublicar(redatora, rascunho({ title: "Pedido devolvido" }));
  actAs(produtor);
  const devolvido = await actions.rejectNotice({ id: outro.id });
  assert.equal(devolvido.ok, true, JSON.stringify(devolvido));
  assert.equal(devolvido.data.situation, "draft");
});

/* ------------------------------------------------------------------------------------------------
 * Respostas e mencoes nos comentarios da aula
 * ---------------------------------------------------------------------------------------------- */

test("o professor responde o comentario da aluna na aula e ela recebe 'Professor de Teste respondeu seu comentário' com o link da aula", async () => {
  await marcar(aluna, { seen: true });
  const raiz = await comentar(aluna, "Como uso agentes com ferramentas?");
  assert.equal(raiz.status, 201);
  estado.raizId = (await raiz.json()).data.id;

  const resposta = await comentar(professor, "Comece pelo módulo 2, tem um exemplo pronto.", { parentCommentId: estado.raizId });
  assert.equal(resposta.status, 201);
  estado.respostaId = (await resposta.json()).data.id;
  await settleCommentNotifications();

  const pagina = await sino(aluna);
  const item = pagina.items.find((notificacao) => notificacao.kind === "comment_reply");
  assert.ok(item, JSON.stringify(pagina.items));
  assert.equal(item.title, "Professor de Teste respondeu seu comentário");
  assert.equal(item.body, "Comece pelo módulo 2, tem um exemplo pronto.");
  assert.equal(item.href, linkDaAula);
  assert.equal(item.actor?.name, "Professor de Teste");
  assert.equal(item.context, "Aula 1: O que é um agente");
  assert.equal(pagina.unseen, 1);
});

test("responder o proprio comentario nao gera notificacao; mencao no comeco da resposta avisa o outro autor da conversa", async () => {
  const propria = await comentar(aluna, "Complementando a minha pergunta: e com memória?", { parentCommentId: estado.raizId });
  assert.equal(propria.status, 201);
  const propriaId = (await propria.json()).data.id;
  await settleCommentNotifications();
  assert.equal(unwrap(await db.from("notifications").select("id").like("dedupe_key", `%:${propriaId}`), "Lendo").length, 0);

  const mencao = await comentar(aluna, "@professor.teste obrigada pela dica!", { parentCommentId: estado.raizId });
  assert.equal(mencao.status, 201);
  await settleCommentNotifications();

  const doProfessor = await sino(professor);
  const item = doProfessor.items.find((notificacao) => notificacao.kind === "comment_mention");
  assert.ok(item, JSON.stringify(doProfessor.items));
  assert.equal(item.title, "Aluna de Teste mencionou você");
  assert.equal(item.href, linkDaAula);
  assert.ok(!doProfessor.items.some((notificacao) => notificacao.kind === "comment_reply"), "o comentario principal e da aluna");
});

test("resposta pela Comunidade do admin tambem avisa a aluna", async () => {
  actAs(produtor);
  const resposta = await replyToComment({ body: "Também vale olhar a aula 3.", commentId: estado.raizId, resolve: false });
  assert.equal(resposta.ok, true, JSON.stringify(resposta));
  await settleCommentNotifications();

  const pagina = await sino(aluna);
  assert.ok(pagina.items.some((item) => item.kind === "comment_reply" && item.title === "Produtor de Teste respondeu seu comentário"));
});

test("resposta escondida pela moderacao some do sino e do numero", async () => {
  const antes = await sino(aluna);
  const daResposta = antes.items.find((item) => item.title === "Professor de Teste respondeu seu comentário");
  assert.ok(daResposta);

  await moderateLessonComment({ actorId: produtor.id, commentId: estado.respostaId, status: "hidden" });

  const depois = await sino(aluna);
  assert.ok(!depois.items.some((item) => item.id === daResposta.id));
  assert.equal(depois.unseen, antes.unseen - 1);
});

/* ------------------------------------------------------------------------------------------------
 * Paginacao
 * ---------------------------------------------------------------------------------------------- */

test("paginacao do sino: o cursor continua sem repetir nem pular, e 'Não lidas' traz so as nao lidas", async () => {
  const todas = await listNotifications({ limit: 50, userId: aluna.id });
  assert.ok(todas.items.length >= 3, `notificacoes da aluna: ${todas.items.length}`);

  const vistas = [];
  let cursor = null;

  do {
    const pagina = await listNotifications({ cursor, limit: 1, userId: aluna.id });
    vistas.push(...pagina.items.map((item) => item.id));
    cursor = pagina.nextCursor;
  } while (cursor);

  assert.deepEqual(vistas, todas.items.map((item) => item.id));

  const lida = todas.items[0];
  unwrap(await db.from("notifications").update({ read_at: new Date().toISOString(), seen_at: new Date().toISOString() }).eq("id", lida.id), "Lendo uma");
  const naoLidas = await sino(aluna, "?filter=unread");
  assert.ok(!naoLidas.items.some((item) => item.id === lida.id));
  assert.ok(naoLidas.items.every((item) => item.readAt === null));
});

/* ------------------------------------------------------------------------------------------------
 * Imagem e audio do aviso
 * ---------------------------------------------------------------------------------------------- */

/** Cabecalho WebP VP8X com o canvas pedido (o servidor so le o cabecalho para conferir a medida). */
function webpDataUrl(width, height) {
  const bytes = new Uint8Array(32);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0x38, 0x0a, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00], 0);
  bytes.set([(width - 1) & 0xff, ((width - 1) >> 8) & 0xff, ((width - 1) >> 16) & 0xff], 24);
  bytes.set([(height - 1) & 0xff, ((height - 1) >> 8) & 0xff, ((height - 1) >> 16) & 0xff], 27);

  return `data:image/webp;base64,${Buffer.from(bytes).toString("base64")}`;
}

/** Comeco de um WAV de verdade (RIFF....WAVEfmt ) seguido de silencio. */
function wav() {
  const bytes = Buffer.alloc(64);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(56, 4);
  bytes.write("WAVEfmt ", 8, "ascii");
  bytes.writeUInt32LE(16, 16);

  return bytes;
}

function enviarAudio(user, bytes, type, headers = {}) {
  actAs(user);
  const form = new FormData();
  form.append("file", new File([bytes], "aviso.wav", { type }));

  return audioRoute.POST(new Request("http://localhost/api/admin/communications/audio", { body: form, headers, method: "POST" }));
}

test("imagem do aviso: so WebP 16:9 de ate 1280x720 (a partir de 960 de largura) vai para o armazenamento", async () => {
  actAs(produtor);
  const enviada = await actions.uploadNoticeImage({ image: webpDataUrl(1280, 720) });
  assert.equal(enviada.ok, true, JSON.stringify(enviada));
  assert.match(enviada.data.url, /\/storage\/v1\/object\/public\/content-assets\/communications\/images\/[a-f0-9]{24}\.webp$/);

  const grande = await actions.uploadNoticeImage({ image: webpDataUrl(1920, 1080) });
  assert.equal(grande.status, 400);
  assert.match(grande.fieldErrors.image[0], /1280×720/);
  assert.equal((await actions.uploadNoticeImage({ image: webpDataUrl(800, 450) })).status, 400, "menor que 960 de largura");
  assert.equal((await actions.uploadNoticeImage({ image: "data:image/png;base64,iVBORw0KGgo=" })).status, 400);

  actAs(analista);
  assert.equal((await actions.uploadNoticeImage({ image: webpDataUrl(1280, 720) })).status, 403);

  const caminho = enviada.data.url.split("/content-assets/")[1];
  unwrap(await db.storage.from("content-assets").remove([caminho]), "Apagando a imagem de teste");
});

test("audio do aviso: o servidor confere o tipo pelos bytes, guarda no bucket publico e recusa o que nao e audio", async () => {
  assert.equal((await enviarAudio(analista, wav(), "audio/wav")).status, 403, "analista nao envia");
  actAs(null);
  assert.equal((await audioRoute.POST(new Request("http://localhost/api/admin/communications/audio", { method: "POST" }))).status, 401);

  const enviado = await enviarAudio(produtor, wav(), "audio/wav");
  const corpo = await enviado.json();
  assert.equal(enviado.status, 200, JSON.stringify(corpo));
  assert.equal(corpo.data.mimeType, "audio/wav");
  assert.match(corpo.data.url, /\/storage\/v1\/object\/public\/communication-audio\/campaigns\/[a-f0-9]{24}\.wav$/);
  assert.equal((await fetch(corpo.data.url)).status, 200, "o aluno toca o audio pelo endereco publico");

  const repetido = await enviarAudio(produtor, wav(), "");
  assert.equal(repetido.status, 200, "mesmo arquivo de novo (sem tipo informado) nao e erro");
  assert.equal((await repetido.json()).data.url, corpo.data.url);

  const falso = await enviarAudio(produtor, Buffer.from("isto nao e um audio de verdade"), "audio/mpeg");
  assert.equal(falso.status, 422);
  assert.equal((await falso.json()).error, "Use um arquivo de áudio MP3, M4A, OGG, WEBM ou WAV.");
  assert.equal((await enviarAudio(produtor, wav(), "audio/mpeg")).status, 422, "tipo informado diferente do conteudo");
  assert.equal((await enviarAudio(produtor, wav(), "audio/wav", { "content-length": String(12 * 1024 * 1024) })).status, 413);

  unwrap(await db.storage.from("communication-audio").remove([corpo.data.url.split("/communication-audio/")[1]]), "Apagando o audio de teste");
});

/* ------------------------------------------------------------------------------------------------
 * Versao conferida, nomes da previa e o que o sino marca
 * ---------------------------------------------------------------------------------------------- */

const MUDOU_EM_OUTRA_TELA = "Este aviso mudou em outra tela há instantes. Recarregue a página para ver a versão atual.";

test("publicar e aprovar valem para a versao que a tela leu: outra versao e 409 antes de contar, e nada sai", async () => {
  actAs(produtor);
  const salvo = await actions.saveNoticeDraft({ draft: rascunho({ title: "Versão conferida" }) });
  assert.equal(salvo.ok, true, JSON.stringify(salvo));

  const velha = await actions.publishNotice({ expectedUpdatedAt: "2020-01-01T00:00:00.000Z", id: salvo.data.id });
  assert.equal(velha.status, 409);
  assert.equal(velha.error, MUDOU_EM_OUTRA_TELA);
  assert.equal((await linhasDoAviso(salvo.data.id)).length, 0, "nada sai");
  assert.equal((await getNoticeDetail(salvo.data.id)).situation, "draft");

  // A mesma versao escrita com "Z" vale (o instante e comparado ate o microssegundo).
  const publicado = await actions.publishNotice({ expectedUpdatedAt: salvo.data.updatedAt.replace(/\+00:00$/, "Z"), id: salvo.data.id });
  assert.equal(publicado.ok, true, JSON.stringify(publicado));
  assert.equal(publicado.data.situation, "sent");

  // Quem publica com messaging.publish_large fica como aprovado no banco (o agendado nao volta para
  // aprovacao se o segmento crescer); o relatorio so mostra "Aprovado" quando houve pedido.
  const [linha] = unwrap(await db.from("campaigns").select("approved_at,approved_by,requested_at").eq("id", salvo.data.id), "Lendo a aprovacao");
  assert.equal(linha.approved_by, produtor.id);
  assert.ok(linha.approved_at);
  assert.equal(linha.requested_at, null);
  const detalhe = await getNoticeDetail(salvo.data.id);
  assert.equal(detalhe.approvedAt, null);
  assert.equal(detalhe.approvedBy, null);

  const redatora = await criarRedatora();
  const pedido = await salvarEPublicar(redatora, rascunho({ title: "Pedido revisado" }));
  assert.equal(pedido.situation, "pending_approval");
  const [semAprovacao] = unwrap(await db.from("campaigns").select("approved_at").eq("id", pedido.id), "Lendo o pedido");
  assert.equal(semAprovacao.approved_at, null, "pedido de aprovacao nao conta como aprovado");

  actAs(produtor);
  const aprovarVelha = await actions.approveNotice({ expectedUpdatedAt: "2020-01-01T00:00:00.000Z", id: pedido.id });
  assert.equal(aprovarVelha.status, 409, "quem aprova aprova a versao que revisou");
  assert.equal((await getNoticeDetail(pedido.id)).situation, "pending_approval");
  assert.ok(!(await sino(aluna)).items.some((item) => item.title === "Pedido revisado"));

  actAs(produtor);
  const aprovado = await actions.approveNotice({ expectedUpdatedAt: pedido.updatedAt, id: pedido.id });
  assert.equal(aprovado.ok, true, JSON.stringify(aprovado));
  assert.equal((await getNoticeDetail(pedido.id)).approvedBy?.id, produtor.id, "com pedido, o relatorio mostra quem aprovou");
});

test("publicar sem a versao da tela grava so a versao contada: segmento salvo no meio da contagem da 409 e nada sai", async () => {
  actAs(produtor);
  const salvo = await actions.saveNoticeDraft({ draft: rascunho({ title: "Segmento trocado no meio" }) });
  assert.equal(salvo.ok, true, JSON.stringify(salvo));

  // Outra tela salva "todos os alunos" enquanto o servidor conta o segmento (a contagem le os
  // comentarios por aluno pela RPC; o teste segura essa leitura ate a outra gravacao terminar).
  const rpcOriginal = SupabaseClient.prototype.rpc;
  let trocado = false;
  SupabaseClient.prototype.rpc = function (name, ...args) {
    const builder = rpcOriginal.call(this, name, ...args);

    if (name === "communication_comment_counts" && !trocado) {
      trocado = true;
      const then = builder.then.bind(builder);
      builder.then = (ok, fail) =>
        db.from("campaigns").update({ audience: { kind: "everyone" } }).eq("id", salvo.data.id).then(() => then(ok, fail), fail);
    }

    return builder;
  };

  try {
    const publicado = await actions.publishNotice({ id: salvo.data.id });
    assert.equal(publicado.status, 409, JSON.stringify(publicado));
    assert.equal(publicado.error, MUDOU_EM_OUTRA_TELA);
  } finally {
    SupabaseClient.prototype.rpc = rpcOriginal;
  }

  assert.ok(trocado, "a outra gravacao aconteceu durante a contagem");
  assert.equal((await linhasDoAviso(salvo.data.id)).length, 0, "ninguem recebe: nem o segmento contado, nem o novo");
  actAs(produtor);
  assert.equal((await getNoticeDetail(salvo.data.id)).situation, "draft");
});

test("previa do segmento: os 5 nomes so para quem ve a lista de Alunos; quem so cria avisos ve a contagem e a frase", async () => {
  actAs(produtor);
  const completa = await actions.previewNoticeAudience({ audience: quemTemOCurso });
  assert.equal(completa.ok, true, JSON.stringify(completa));
  assert.ok(completa.data.sample.length > 0 && completa.data.sample.every((pessoa) => pessoa.name), "o dono ve os nomes");

  const redatora = await criarRedatora();
  actAs(redatora);
  const semNomes = await actions.previewNoticeAudience({ audience: quemTemOCurso });
  assert.equal(semNomes.ok, true, JSON.stringify(semNomes));
  assert.equal(semNomes.data.count, completa.data.count);
  assert.equal(semNomes.data.description, completa.data.description);
  assert.deepEqual(semNomes.data.sample, [], "sem students.read_basic, nenhum nome de aluno");
});

test("abrir o sino e 'Marcar todas' so mexem no que aparece: aviso ainda sendo enviado continua novo para quando aparecer", async () => {
  await marcar(aluna, { all: true });

  // Aviso em envio (o sino ainda nao mostra), com a linha da aluna ja gravada.
  actAs(produtor);
  const emEnvio = await actions.saveNoticeDraft({ draft: rascunho({ title: "Ainda sendo enviado" }) });
  unwrap(
    await db.from("campaigns").update({ dispatch_started_at: new Date().toISOString(), status: "sending" }).eq("id", emEnvio.data.id),
    "Simulando o envio em andamento"
  );
  unwrap(
    await db.from("notifications").insert({ campaign_id: emEnvio.data.id, dedupe_key: `campaign:${emEnvio.data.id}`, kind: "notice", user_id: aluna.id }),
    "Gravando a linha da aluna"
  );
  await salvarEPublicar(produtor, rascunho({ title: "Já enviado" }));

  const linhaDe = async (campaignId) => {
    const [linha] = unwrap(
      await db.from("notifications").select("seen_at,read_at").eq("campaign_id", campaignId).eq("user_id", aluna.id),
      "Lendo a linha da aluna"
    );
    return linha;
  };

  const vista = await marcar(aluna, { seen: true });
  assert.equal(vista.status, 200);
  assert.equal((await linhaDe(emEnvio.data.id)).seen_at, null, "abrir o sino nao ve o que nao aparece");

  const todas = await marcar(aluna, { all: true });
  assert.deepEqual((await todas.json()).data, { unread: 0, unseen: 0 });
  assert.deepEqual(await linhaDe(emEnvio.data.id), { read_at: null, seen_at: null }, "'Marcar todas' tambem nao");

  // O envio termina: a notificacao aparece como nova, com o numero do sino.
  unwrap(await db.from("campaigns").update({ sent_at: new Date().toISOString(), status: "sent" }).eq("id", emEnvio.data.id), "Terminando o envio");
  assert.equal((await resumo(aluna)).unseen, 1);
  const item = (await sino(aluna)).items.find((notificacao) => notificacao.title === "Ainda sendo enviado");
  assert.ok(item && item.seenAt === null && item.readAt === null, JSON.stringify(item));
});
