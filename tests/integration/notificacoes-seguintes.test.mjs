import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, limparComunicacao, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// "Depois desta notificação" (Comunicacao v2, docs/23 §2.2 e §6.2) contra o banco LOCAL: as notificacoes
// seguintes gravadas pelo editor (saveNoticeFollowUps), o fluxo do aviso acompanhando o aviso (publicar,
// cancelar o agendamento, retirar do sino, duplicar, excluir), a contagem ao vivo (previewFollowUpAudience)
// e o motor de verdade (processFlows, como o job "comunicacao" chama) com o tempo simulado pelo `now`
// (sempre no futuro: a linha do sino grava created_at = greatest(now, relogio)). Quem recebe: quem tem
// acesso a um curso de teste que este arquivo libera so para a aluna e o aluno sem acesso (e para o
// professor, que e da equipe e nunca recebe).

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/communications/actions.ts");
const { emptyNoticeDraft } = await import("../../src/server/communications/schemas.ts");
const { getNoticeDetail, listNotices } = await import("../../src/server/communications/queries.ts");
const { processFlows } = await import("../../src/server/communications/flow-engine.ts");
const { createFactsLoader } = await import("../../src/server/communications/facts-loader.ts");
const { markAllSeen, markRead } = await import("../../src/server/communications/inbox.ts");
const { settleSenderNotices } = await import("../../src/server/communications/sender-notices.ts");

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const PRODUTO = ESCOLA_DE_TESTE.cursoBloqueado.id;
const OUTRO_PRODUTO = "teste-seguintes-objetivo";
const ACESSO = "teste-seguintes:";
const aluna = contas.aluna;
const aluno = contas.alunoSemAcesso;
const professor = contas.professor;
const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const quemTemOProduto = { kind: "rules", root: { items: [{ op: "has", productIds: [PRODUTO], type: "product" }], match: "all" } };
const TEXTO_LONGO = `${"Hoje tem aula nova na área, com material de apoio e exercícios para praticar. ".repeat(3)}Abra para ver tudo.`;

async function liberar(userId, productId = PRODUTO) {
  unwrap(
    await db.from("entitlements").insert({
      ends_at: null,
      source_event_id: `${ACESSO}${productId}:${userId}:${randomUUID()}`,
      source_provider: "manual",
      starts_at: "2026-01-01T12:00:00.000Z",
      status: "active",
      target_id: productId,
      target_type: "standalone_course",
      user_id: userId
    }),
    "Liberando acesso de teste"
  );
}

async function limpar() {
  await limparComunicacao(db);
  unwrap(await db.from("entitlements").delete().like("source_event_id", `${ACESSO}%`), "Apagando acessos de teste");
  unwrap(await db.from("email_outbox").delete().eq("kind", "sent_as").in("user_id", [aluna.id, aluno.id, professor.id, produtor.id]), "Apagando os e-mails");
}

before(limpar);
after(limpar);
beforeEach(async () => {
  await limpar();
  await liberar(aluna.id);
  await liberar(aluno.id);
  await liberar(professor.id);
});

/* ------------------------------------------------------------------------------------------------
 * Apoio
 * ---------------------------------------------------------------------------------------------- */

const conteudo = (title, extra = {}) => ({ audio: null, body: "", cta: null, icon: null, image: null, response: null, sender: null, title, validity: { mode: "default" }, ...extra });
const regras = (...items) => ({ kind: "rules", root: { items, match: "all" } });
const fez = (action, nodeId, negate = false) => ({ action, negate, ref: { kind: "node", nodeId }, type: "message" });

/** Uma seguinte como o cartao manda (o "Para quem" ja em regras). */
function seguinte(title, { anchor = "sent", children = [], content = {}, id = randomUUID(), minutes = 1_440, who = { kind: "everyone" } } = {}) {
  return { children, content: conteudo(title, content), id, when: { anchor, minutes }, who };
}

function rascunho(extra = {}) {
  return { ...emptyNoticeDraft("inbox"), audience: quemTemOProduto, body: TEXTO_LONGO, title: "Aula nova no ar", ...extra };
}

/** Grava o aviso e as seguintes como o editor faz (saveNoticeDraft e logo saveNoticeFollowUps); publica se pedir. */
async function avisoComSeguintes({ draft = {}, followUps, goal = null, publish = true }) {
  actAs(produtor);
  const salvo = await actions.saveNoticeDraft({ draft: rascunho(draft) });
  assert.equal(salvo.ok, true, JSON.stringify(salvo));

  const seguintes = await actions.saveNoticeFollowUps({ expectedNoticeUpdatedAt: salvo.data.updatedAt, followUps, goal, noticeId: salvo.data.id });
  assert.equal(seguintes.ok, true, JSON.stringify(seguintes));

  if (!publish) {
    return { flowId: seguintes.data.flowId, id: salvo.data.id, saved: seguintes.data, updatedAt: salvo.data.updatedAt };
  }

  const publicado = await actions.publishNotice({ expectedUpdatedAt: salvo.data.updatedAt, id: salvo.data.id });
  assert.equal(publicado.ok, true, JSON.stringify(publicado));

  return { flowId: seguintes.data.flowId, id: salvo.data.id, published: publicado.data, saved: seguintes.data, updatedAt: publicado.data.updatedAt };
}

function tick(now) {
  const date = new Date(now);
  return processFlows({ budgetMs: 25_000, db, facts: createFactsLoader(db, date), now: date, signal: new AbortController().signal });
}

/** Proxima faixa de 15 minutos depois de `ms` (o fim automatico e a varredura so rodam nela). */
function faixaDepois(ms) {
  return Math.ceil(ms / (15 * MIN)) * 15 * MIN + 5_000;
}

async function fluxo(id) {
  return unwrap(await db.from("communication_flows").select("*").eq("id", id).single(), "Lendo o fluxo");
}

async function linhasDoPasso(nodeId) {
  return unwrap(await db.from("notifications").select("user_id,expires_at,campaign_id").eq("flow_node_id", nodeId).eq("is_test", false), "Lendo o sino do passo");
}

async function quemRecebeu(nodeId) {
  return (await linhasDoPasso(nodeId)).map((row) => row.user_id).sort();
}

async function linhaDoAviso(campaignId, userId) {
  return unwrap(await db.from("notifications").select("id,expires_at").eq("campaign_id", campaignId).eq("user_id", userId).eq("is_test", false).single(), "Lendo a linha do aviso");
}

async function tarefas(flowId) {
  return unwrap(await db.from("communication_flow_tasks").select("node_id,user_id,status,result").eq("flow_id", flowId), "Lendo as tarefas");
}

const alunos = () => [aluna.id, aluno.id].sort();

/* ------------------------------------------------------------------------------------------------
 * Envio, abertura e "Marcar todas"
 * ---------------------------------------------------------------------------------------------- */

test("'1 dia depois, não abriu': entra só depois do envio, sai só para quem não abriu, uma vez; 'Marcar todas' não é abrir", async () => {
  const entrada = randomUUID();
  const s1 = randomUUID();
  const aviso = await avisoComSeguintes({ followUps: [seguinte("Você viu a aula nova?", { id: s1, who: regras(fez("opened", entrada, true)) })] });
  const now = Date.now();

  assert.equal(aviso.published.situation, "sent");
  assert.equal((await fluxo(aviso.flowId)).status, "active", "publicar ativa o fluxo do aviso");
  assert.equal(aviso.saved.entryNodeId, entrada, "a entrada nova usa o id que o navegador ja citava nas regras");

  // Envio grande ainda "sending": ninguem entra.
  unwrap(await db.from("campaigns").update({ status: "sending" }).eq("id", aviso.id), "Aviso enviando");
  await tick(now + MIN);
  assert.deepEqual(await tarefas(aviso.flowId), [], "espera o envio terminar");
  unwrap(await db.from("campaigns").update({ status: "sent" }).eq("id", aviso.id), "Aviso enviado");

  await tick(now + 2 * MIN);
  const entraram = (await tarefas(aviso.flowId)).map((task) => task.user_id).sort();
  assert.deepEqual(entraram, alunos(), "a equipe nunca entra");

  // A aluna abre o cartao; o aluno so toca em "Marcar todas como lidas".
  const daAluna = await linhaDoAviso(aviso.id, aluna.id);
  await markRead(aluna.id, [daAluna.id]);
  await markRead(aluno.id, "all");

  await tick(now + 20 * HORA);
  assert.deepEqual(await quemRecebeu(s1), [], "ainda nao e hora");

  await tick(now + 25 * HORA);
  assert.deepEqual(await quemRecebeu(s1), [aluno.id], "so quem nao abriu");

  await tick(now + 26 * HORA);
  assert.deepEqual(await quemRecebeu(s1), [aluno.id], "uma vez so");
});

test("'viu no sino, mas não abriu' pula quem nunca abriu o sino", async () => {
  const entrada = randomUUID();
  const s1 = randomUUID();
  await avisoComSeguintes({ followUps: [seguinte("Deu uma olhada?", { id: s1, minutes: 120, who: regras(fez("seen", entrada), fez("opened", entrada, true)) })] });
  const now = Date.now();

  await markAllSeen(aluna.id);
  await tick(now + MIN);
  await tick(now + 3 * HORA);

  assert.deepEqual(await quemRecebeu(s1), [aluna.id], "o aluno nem abriu o sino");
});

test("'3 h antes de vencer' sai 3 h antes do fim e some junto com a principal; depois do fim, não sai", async () => {
  const s1 = randomUUID();
  const aviso = await avisoComSeguintes({
    draft: { validity: { minutes: 1_440, mode: "duration" } },
    followUps: [seguinte("Faltam 3 horas", { anchor: "expires", content: { validity: { mode: "with_anchor" } }, id: s1, minutes: 180 })]
  });
  const now = Date.now();

  await tick(now + MIN);
  await tick(now + 20 * HORA);
  assert.deepEqual(await quemRecebeu(s1), []);

  await tick(now + 21 * HORA + 5 * MIN);
  const linhas = await linhasDoPasso(s1);
  assert.deepEqual(linhas.map((row) => row.user_id).sort(), alunos());

  for (const linha of linhas) {
    const principal = await linhaDoAviso(aviso.id, linha.user_id);
    assert.equal(Date.parse(linha.expires_at), Date.parse(principal.expires_at), "fica no sino ate a principal sumir");
  }

  // Outro aviso, mas o primeiro tick so depois do fim: a seguinte nao sai.
  const s2 = randomUUID();
  const tarde = await avisoComSeguintes({
    draft: { title: "Aviso curto", validity: { minutes: 1_440, mode: "duration" } },
    followUps: [seguinte("Tarde demais", { anchor: "expires", content: { validity: { mode: "with_anchor" } }, id: s2, minutes: 180 })]
  });
  await tick(Date.now() + 25 * HORA);
  assert.deepEqual(await quemRecebeu(s2), []);
  assert.ok((await tarefas(tarde.flowId)).every((task) => task.result === "expired"), "venceu o prazo");
});

test("seguinte da seguinte: sai para quem não abriu a anterior, contando do envio dela", async () => {
  const s1 = randomUUID();
  const s11 = randomUUID();
  await avisoComSeguintes({
    followUps: [
      seguinte("Primeira seguinte", {
        children: [seguinte("Segunda, para quem não abriu a primeira", { id: s11, minutes: 120, who: regras(fez("opened", s1, true)) })],
        content: { body: TEXTO_LONGO },
        id: s1
      })
    ]
  });
  const now = Date.now();

  await tick(now + MIN);
  await tick(now + 25 * HORA);
  assert.deepEqual(await quemRecebeu(s1), alunos());

  const [primeiraDaAluna] = unwrap(await db.from("notifications").select("id").eq("flow_node_id", s1).eq("user_id", aluna.id), "Seguinte da aluna");
  await markRead(aluna.id, [primeiraDaAluna.id]);

  await tick(now + 28 * HORA);
  assert.deepEqual(await quemRecebeu(s11), [aluno.id]);
});

/* ------------------------------------------------------------------------------------------------
 * Objetivo ("Parar ... para quem tiver acesso a") e "enviada em seu nome"
 * ---------------------------------------------------------------------------------------------- */

test("linha de parar: quem já tinha o produto não recebe nada; quem compra entre duas seguintes não recebe mais", async () => {
  await liberar(aluna.id, OUTRO_PRODUTO);
  const s1 = randomUUID();
  const s2 = randomUUID();
  const aviso = await avisoComSeguintes({
    followUps: [seguinte("Primeira", { id: s1 }), seguinte("Segunda", { id: s2, minutes: 2 * 1_440 })],
    goal: { productId: OUTRO_PRODUTO }
  });
  const now = Date.now();

  assert.deepEqual((await fluxo(aviso.flowId)).goal, { kind: "rules", root: { items: [{ op: "has", productIds: [OUTRO_PRODUTO], type: "product" }], match: "all" } });

  await tick(now + MIN);
  await tick(now + 25 * HORA);
  assert.deepEqual(await quemRecebeu(s1), [aluno.id], "a aluna ja tinha acesso");

  await liberar(aluno.id, OUTRO_PRODUTO);
  await tick(now + 49 * HORA);
  assert.deepEqual(await quemRecebeu(s2), [], "comprou entre as duas");
});

test("quem envia uma seguinte recebe o e-mail 'enviada em seu nome' uma vez, com a chave do aviso; quem publicou, nunca", async () => {
  const aviso = await avisoComSeguintes({
    draft: { sender: { userId: produtor.id } },
    followUps: [seguinte("Do professor", { content: { sender: { userId: professor.id } } })]
  });
  await settleSenderNotices();

  const emails = unwrap(await db.from("email_outbox").select("user_id,idempotency_key").eq("kind", "sent_as").in("user_id", [professor.id, produtor.id]), "Lendo os e-mails");
  assert.deepEqual(emails, [{ idempotency_key: `sent-as:campaign:${aviso.id}:${professor.id}`, user_id: professor.id }]);
});

/* ------------------------------------------------------------------------------------------------
 * Retirar, cancelar o agendamento, duplicar, excluir e trocar para pop-up
 * ---------------------------------------------------------------------------------------------- */

test("retirar do sino: as seguintes param; com a caixa, as que já saíram também somem; sem ela, ficam", async () => {
  const s1 = randomUUID();
  const s2 = randomUUID();
  const comCaixa = await avisoComSeguintes({ followUps: [seguinte("Já saiu", { id: s1, minutes: 60 }), seguinte("Ainda não", { id: s2, minutes: 3 * 1_440 })] });
  const now = Date.now();

  await tick(now + MIN);
  await tick(now + 2 * HORA);
  assert.deepEqual(await quemRecebeu(s1), alunos());

  actAs(produtor);
  const retirado = await actions.withdrawNotice({ expectedUpdatedAt: comCaixa.updatedAt, id: comCaixa.id });
  assert.equal(retirado.ok, true, JSON.stringify(retirado));

  const encerrado = await fluxo(comCaixa.flowId);
  assert.deepEqual([encerrado.status, encerrado.ended_reason], ["ended", "source_withdrawn"]);
  assert.deepEqual(await quemRecebeu(s1), [], "as que ja sairam somem (padrao)");
  assert.ok((await tarefas(comCaixa.flowId)).filter((task) => task.node_id === s2).every((task) => task.status === "canceled"));
  const versoes = unwrap(await db.from("campaigns").select("status").eq("flow_id", comCaixa.flowId), "Versoes");
  assert.ok(versoes.every((versao) => versao.status === "canceled"));

  await tick(now + 4 * DIA);
  assert.deepEqual(await quemRecebeu(s2), [], "nunca depois da principal retirada");

  const [auditoria] = unwrap(await db.from("admin_audit_log").select("metadata").eq("entity_id", comCaixa.id).eq("action", "communication.withdrawn"), "Auditoria");
  assert.equal(auditoria.metadata.follow_ups_removed, 2);

  // Sem a caixa: as que ja sairam ficam no sino.
  const s3 = randomUUID();
  const semCaixa = await avisoComSeguintes({ draft: { title: "Outro aviso" }, followUps: [seguinte("Fica", { id: s3, minutes: 60 })] });
  await tick(Date.now() + MIN);
  await tick(Date.now() + 2 * HORA);
  assert.deepEqual(await quemRecebeu(s3), alunos());

  actAs(produtor);
  const semAs = await actions.withdrawNotice({ alsoFollowUps: false, expectedUpdatedAt: semCaixa.updatedAt, id: semCaixa.id });
  assert.equal(semAs.ok, true, JSON.stringify(semAs));
  assert.deepEqual(await quemRecebeu(s3), alunos());
  assert.equal((await fluxo(semCaixa.flowId)).status, "ended");
});

test("agendar ativa o fluxo junto; cancelar o agendamento (ou salvar de novo) volta o fluxo e as versões para rascunho", async () => {
  const sendAt = new Date(Date.now() + 2 * DIA).toISOString();
  const aviso = await avisoComSeguintes({ draft: { schedule: { mode: "at", sendAt } }, followUps: [seguinte("Depois do agendado")] });

  assert.equal(aviso.published.situation, "scheduled");
  assert.equal((await fluxo(aviso.flowId)).status, "active", "esperando a notificacao");
  await tick(Date.now() + MIN);
  assert.deepEqual(await tarefas(aviso.flowId), [], "ninguem entra antes do envio");

  actAs(produtor);
  const cancelado = await actions.cancelScheduledNotice({ expectedUpdatedAt: aviso.updatedAt, id: aviso.id });
  assert.equal(cancelado.ok, true, JSON.stringify(cancelado));
  assert.equal((await fluxo(aviso.flowId)).status, "draft");
  const versoes = unwrap(await db.from("campaigns").select("status,sent_at").eq("flow_id", aviso.flowId), "Versoes");
  assert.deepEqual(versoes, [{ sent_at: null, status: "draft" }]);

  // Publicado de novo (agendado) e salvo de novo pelo editor: o fluxo volta junto.
  const republicado = await actions.publishNotice({ expectedUpdatedAt: cancelado.data.updatedAt, id: aviso.id });
  assert.equal(republicado.data.situation, "scheduled");
  assert.equal((await fluxo(aviso.flowId)).status, "active");
  const salvo = await actions.saveNoticeDraft({ draft: rascunho({ schedule: { mode: "at", sendAt }, title: "Aula nova no ar (ajustada)" }), expectedUpdatedAt: republicado.data.updatedAt, id: aviso.id });
  assert.equal(salvo.ok, true, JSON.stringify(salvo));
  assert.equal((await fluxo(aviso.flowId)).status, "draft");
});

test("duplicar copia as seguintes (ids novos, regras e objetivo remapeados) e volta 'até uma data' que já passou para 90 dias", async () => {
  const s1 = randomUUID();
  const s11 = randomUUID();
  const ontem = new Date(Date.now() - DIA).toISOString();
  const aviso = await avisoComSeguintes({
    followUps: [
      seguinte("Primeira", {
        children: [seguinte("Filha", { id: s11, minutes: 120, who: regras(fez("opened", s1, true)) })],
        content: { body: TEXTO_LONGO, validity: { endsAt: ontem, mode: "until" } },
        id: s1
      })
    ],
    goal: { productId: OUTRO_PRODUTO },
    publish: false
  });

  actAs(produtor);
  const copia = await actions.duplicateNotice({ id: aviso.id });
  assert.equal(copia.ok, true, JSON.stringify(copia));

  const detalhe = await getNoticeDetail(copia.data.id, { permissions: { canPublish: true, canPublishLarge: true, canWrite: true } });
  const followUps = detalhe.followUps;

  assert.notEqual(followUps.flowId, aviso.flowId);
  assert.equal(followUps.items.length, 1);
  const [primeira] = followUps.items;
  assert.notEqual(primeira.id, s1);
  assert.equal(primeira.content.title, "Primeira");
  assert.deepEqual(primeira.content.validity, { mode: "default" }, "a data que ja passou volta para 90 dias");
  assert.equal(primeira.children[0].who.root.items[0].ref.nodeId, primeira.id, "a regra da filha aponta para a copia");
  assert.deepEqual(followUps.goal.root.items[0].productIds, [OUTRO_PRODUTO]);
  assert.equal(followUps.mode.kind, "edit");

  const original = await getNoticeDetail(aviso.id, { permissions: { canPublish: true, canPublishLarge: true, canWrite: true } });
  assert.equal(original.followUps.items[0].id, s1, "o original nao muda");
});

test("trocar para pop-up grava 'followUps: []' e tira o fluxo do rascunho; excluir o aviso tira o fluxo", async () => {
  const aviso = await avisoComSeguintes({ followUps: [seguinte("Vai sair")], publish: false });

  actAs(produtor);
  const vazio = await actions.saveNoticeFollowUps({ expectedNoticeUpdatedAt: aviso.updatedAt, followUps: [], goal: null, noticeId: aviso.id });
  assert.equal(vazio.ok, true, JSON.stringify(vazio));
  assert.deepEqual(vazio.data, { entryNodeId: null, flowId: null, flowUpdatedAt: null, nodeIds: {} });
  assert.ok((await fluxo(aviso.flowId)).deleted_at, "exclusao logica");
  assert.equal((await getNoticeDetail(aviso.id)).followUps.flowId, null);

  const outro = await avisoComSeguintes({ draft: { title: "Para excluir" }, followUps: [seguinte("Também sai")], publish: false });
  const excluido = await actions.deleteNotice({ expectedUpdatedAt: outro.updatedAt, id: outro.id });
  assert.equal(excluido.ok, true, JSON.stringify(excluido));
  assert.ok((await fluxo(outro.flowId)).deleted_at);
});

/* ------------------------------------------------------------------------------------------------
 * Depois do envio: acrescentar, contar e o fim
 * ---------------------------------------------------------------------------------------------- */

test("seguinte acrescentada depois do envio (na notificação que saiu sem nenhuma) chega a quem recebeu, contando de quando cada um recebeu; passagens terminadas reabrem", async () => {
  const aviso = await avisoComSeguintes({ followUps: [], publish: true });
  const now = Date.now();
  assert.equal(aviso.flowId, null);

  actAs(produtor);
  const s1 = randomUUID();
  const primeira = await actions.saveNoticeFollowUps({ expectedNoticeUpdatedAt: aviso.updatedAt, followUps: [seguinte("Uma hora depois", { id: s1, minutes: 60 })], goal: null, noticeId: aviso.id });
  assert.equal(primeira.ok, true, JSON.stringify(primeira));
  assert.equal((await fluxo(primeira.data.flowId)).status, "active", "nasce no ar");

  await tick(now + 2 * HORA);
  await tick(now + 2 * HORA + MIN);
  assert.deepEqual(await quemRecebeu(s1), alunos(), "o momento ja tinha passado: sai no proximo tick");
  const runs = unwrap(await db.from("communication_flow_runs").select("status").eq("flow_id", primeira.data.flowId), "Passagens");
  assert.ok(runs.every((run) => run.status === "done"));

  const s2 = randomUUID();
  const segunda = await actions.saveNoticeFollowUps({
    expectedFlowUpdatedAt: primeira.data.flowUpdatedAt,
    expectedNoticeUpdatedAt: aviso.updatedAt,
    followUps: [seguinte("Uma hora depois", { id: s1, minutes: 60 }), seguinte("Quatro horas depois", { id: s2, minutes: 240 })],
    goal: null,
    noticeId: aviso.id
  });
  assert.equal(segunda.ok, true, JSON.stringify(segunda));

  await tick(now + 3 * HORA);
  assert.deepEqual(await quemRecebeu(s2), [], "conta de quando cada um recebeu a principal");
  await tick(now + 5 * HORA);
  assert.deepEqual(await quemRecebeu(s2), alunos());
  assert.deepEqual(await quemRecebeu(s1), alunos(), "ninguem recebe a primeira duas vezes");

  // Versao vista pela tela: a outra tela que ainda tinha a versao anterior recebe 409.
  const velha = await actions.saveNoticeFollowUps({ expectedFlowUpdatedAt: primeira.data.flowUpdatedAt, expectedNoticeUpdatedAt: aviso.updatedAt, followUps: [], goal: null, noticeId: aviso.id });
  assert.equal(velha.status, 409);
});

test("contagem ao vivo: antes do envio não conta; depois, quem recebeu a de cima e combina agora", async () => {
  const entrada = randomUUID();
  const rascunhoSo = await avisoComSeguintes({ followUps: [], publish: false });

  actAs(produtor);
  const antes = await actions.previewFollowUpAudience({ filter: regras(fez("opened", entrada, true)), noticeId: rascunhoSo.id, parentNodeId: null });
  assert.deepEqual(antes.data, { qualified: null, recipients: 0 });

  const aviso = await avisoComSeguintes({ draft: { title: "Para contar" }, followUps: [] });
  const daAluna = await linhaDoAviso(aviso.id, aluna.id);
  await markRead(aluna.id, [daAluna.id]);

  actAs(produtor);
  const naoAbriu = await actions.previewFollowUpAudience({ filter: regras(fez("opened", entrada, true)), noticeId: aviso.id, parentNodeId: null });
  assert.deepEqual(naoAbriu.data, { qualified: 1, recipients: 2 });

  const todos = await actions.previewFollowUpAudience({ filter: { kind: "everyone" }, noticeId: aviso.id, parentNodeId: null });
  assert.deepEqual(todos.data, { qualified: 2, recipients: 2 });

  const comProduto = await actions.previewFollowUpAudience({ filter: regras({ op: "has_not", productIds: [PRODUTO], type: "product" }), noticeId: aviso.id, parentNodeId: null });
  assert.deepEqual(comProduto.data, { qualified: 0, recipients: 2 });

  const seguinteNaoSaiu = await actions.previewFollowUpAudience({ filter: { kind: "everyone" }, noticeId: aviso.id, parentNodeId: randomUUID() });
  assert.deepEqual(seguinteNaoSaiu.data, { qualified: null, recipients: 0 }, "a seguinte de cima ainda nao saiu");

  actAs(analista);
  assert.equal((await actions.previewFollowUpAudience({ filter: { kind: "everyone" }, noticeId: aviso.id, parentNodeId: null })).status, 403);
});

test("todas as linhas da principal saíram do sino: o fluxo termina e não aceita novas seguintes (409)", async () => {
  const aviso = await avisoComSeguintes({
    draft: { validity: { minutes: 60, mode: "duration" } },
    followUps: [seguinte("Últimos minutos", { anchor: "expires", content: { validity: { mode: "with_anchor" } }, minutes: 30 })]
  });
  const now = Date.now();

  await tick(now + MIN);
  await tick(now + 31 * MIN);
  await tick(faixaDepois(now + 2 * HORA));

  const concluido = await fluxo(aviso.flowId);
  assert.deepEqual([concluido.status, concluido.ended_reason], ["ended", "finished"]);

  actAs(produtor);
  const nova = await actions.saveNoticeFollowUps({ expectedNoticeUpdatedAt: aviso.updatedAt, followUps: [seguinte("Tarde")], goal: null, noticeId: aviso.id });
  assert.equal(nova.status, 409);
  assert.equal(nova.error, "Esta notificação já saiu do sino de todos.");

  const detalhe = await getNoticeDetail(aviso.id, { permissions: { canPublish: true, canPublishLarge: true, canWrite: true } });
  assert.deepEqual(detalhe.followUps.mode, { kind: "readonly", note: "Esta notificação já saiu do sino de todos: não dá para adicionar notificações seguintes.", reason: "finished" });

  // Sem fluxo nenhum e com as linhas ja fora do sino: tambem 409.
  const semSeguintes = await avisoComSeguintes({ draft: { title: "Velho" }, followUps: [] });
  unwrap(
    await db
      .from("notifications")
      .update({ created_at: new Date(Date.now() - 3 * HORA).toISOString(), expires_at: new Date(Date.now() - 2 * HORA).toISOString() })
      .eq("campaign_id", semSeguintes.id),
    "Envelhecendo as linhas"
  );
  actAs(produtor);
  assert.equal((await actions.saveNoticeFollowUps({ expectedNoticeUpdatedAt: semSeguintes.updatedAt, followUps: [seguinte("Tarde")], goal: null, noticeId: semSeguintes.id })).status, 409);
});

/* ------------------------------------------------------------------------------------------------
 * Conferencias, lista e detalhe
 * ---------------------------------------------------------------------------------------------- */

test("publicar confere as seguintes de novo: o tempo no sino da principal mudou depois e a seguinte vira 400 com o número dela", async () => {
  const aviso = await avisoComSeguintes({ followUps: [seguinte("Dois dias antes de vencer", { anchor: "expires", minutes: 2 * 1_440 })], publish: false });

  // So o aviso muda (o cartao nao foi gravado de novo): agora ele fica 1 dia no sino.
  actAs(produtor);
  const curto = await actions.saveNoticeDraft({ draft: rascunho({ validity: { minutes: 1_440, mode: "duration" } }), expectedUpdatedAt: aviso.updatedAt, id: aviso.id });
  assert.equal(curto.ok, true, JSON.stringify(curto));

  const publicado = await actions.publishNotice({ expectedUpdatedAt: curto.data.updatedAt, id: aviso.id });
  assert.equal(publicado.status, 400);
  assert.equal(publicado.error, "A notificação seguinte 1 tem um problema: A notificação “Aula nova no ar” fica só 1 dia no sino. Escolha menos de 1 dia antes de vencer.");
  assert.deepEqual(Object.keys(publicado.fieldErrors), ["followUps.0.when.minutes"]);
  assert.equal((await fluxo(aviso.flowId)).status, "draft");
  assert.equal((await getNoticeDetail(aviso.id)).status, "draft", "nada saiu");
});

test("gravar confere a árvore (400 no campo), recusa pop-up com seguintes e quem não tem Comunicação", async () => {
  actAs(produtor);
  const salvo = await actions.saveNoticeDraft({ draft: rascunho({ validity: { minutes: 1_440, mode: "duration" } }) });
  const longe = await actions.saveNoticeFollowUps({
    expectedNoticeUpdatedAt: salvo.data.updatedAt,
    followUps: [seguinte("Antes de vencer demais", { anchor: "expires", minutes: 2 * 1_440 })],
    goal: null,
    noticeId: salvo.data.id
  });
  assert.equal(longe.status, 400);
  assert.deepEqual(longe.fieldErrors, { "followUps.0.when.minutes": ["A notificação “Aula nova no ar” fica só 1 dia no sino. Escolha menos de 1 dia antes de vencer."] });

  const pop = await actions.saveNoticeDraft({ draft: { ...emptyNoticeDraft("popup"), audience: quemTemOProduto, title: "Pop-up" } });
  const doPop = await actions.saveNoticeFollowUps({ expectedNoticeUpdatedAt: pop.data.updatedAt, followUps: [seguinte("Não vale")], goal: null, noticeId: pop.data.id });
  assert.equal(doPop.status, 422);

  actAs(analista);
  assert.equal((await actions.saveNoticeFollowUps({ expectedNoticeUpdatedAt: salvo.data.updatedAt, followUps: [], goal: null, noticeId: salvo.data.id })).status, 403);
});

test("lista e detalhe: '+n seguintes', o que já saiu, a escolha rápida de volta e o modo do relatório; as versões são passos de fluxo (409 nas ações da v1)", async () => {
  const entrada = randomUUID();
  const s1 = randomUUID();
  const aviso = await avisoComSeguintes({
    followUps: [seguinte("Viu e não abriu", { id: s1, minutes: 60, who: regras(fez("seen", entrada), fez("opened", entrada, true)) }), seguinte("Todos", { minutes: 3 * 1_440 })]
  });
  await markAllSeen(aluna.id);
  await tick(Date.now() + MIN);
  await tick(Date.now() + 2 * HORA);

  const pagina = await listNotices({});
  const item = pagina.items.find((row) => row.id === aviso.id);
  assert.equal(item.followUpCount, 2);
  assert.equal(item.followUpsSent, 1);

  const detalhe = await getNoticeDetail(aviso.id, { permissions: { canPublish: true, canPublishLarge: true, canWrite: true } });
  assert.equal(detalhe.followUps.count, 2);
  assert.equal(detalhe.followUps.sent, 1);
  assert.deepEqual(detalhe.followUps.mode, { kind: "live" });
  assert.ok(detalhe.followUpOptions, "no ar: as opcoes do editor para a folha");
  assert.equal(detalhe.followUps.stats[s1].received, 1);
  assert.equal(detalhe.followUps.names.messages[`node:${detalhe.followUps.entryNodeId}`], "Aula nova no ar");

  const vm = await import("../../src/components/admin/v2/communication/follow-ups-view-model.ts");
  const principal = vm.followUpParentOf(detalhe.followUps.entryNodeId, "main", { ...detalhe.draft, validity: detalhe.draft.validity });
  assert.deepEqual(vm.followUpFormItemsOf(detalhe.followUps.items, principal).map((form) => form.choice), ["seen_not_opened", "everyone"]);

  const semPermissao = await getNoticeDetail(aviso.id, { permissions: { canPublish: false, canPublishLarge: false, canWrite: true } });
  assert.equal(semPermissao.followUps.mode.reason, "permission");
  assert.equal(semPermissao.followUpOptions, null);

  actAs(produtor);
  const [versao] = await linhasDoPasso(s1);
  assert.equal((await actions.duplicateNotice({ id: versao.campaign_id })).status, 409, "conteudo de passo so muda pelo fluxo");
});

test("fluxo mudado no construtor para algo que o cartão não desenha: só leitura com as frases; gravar pelo cartão é 409; trocar para pop-up tira o fluxo", async () => {
  const store = await import("../../src/server/communications/flow-store.ts");
  const aviso = await avisoComSeguintes({ followUps: [seguinte("Vai virar condição")], publish: false });
  const carregado = unwrap(await db.from("communication_flows").select("updated_at").eq("id", aviso.flowId).single(), "Fluxo");
  const entrada = aviso.saved.entryNodeId;
  const condicao = randomUUID();
  const sim = randomUUID();

  await store.saveFlowTree(db, {
    actorId: produtor.id,
    contents: { [sim]: conteudo("Para quem abriu") },
    expectedUpdatedAt: carregado.updated_at,
    flow: { goal: null, name: "Seguintes de “Aula nova no ar”", origin: "notice", sourceCampaignId: aviso.id },
    flowId: aviso.flowId,
    now: new Date(),
    tree: {
      nodes: [
        { anchor: "previous", anchorNodeId: null, branch: null, campaignId: null, condition: null, expireWithAnchor: false, filter: null, id: entrada, kind: "entry", maxWaitMinutes: null, offsetMinutes: 0, parentId: null, position: 0, waitUntilTrue: false },
        { anchor: "sent", anchorNodeId: entrada, branch: null, campaignId: null, condition: regras(fez("opened", entrada)), expireWithAnchor: false, filter: null, id: condicao, kind: "condition", maxWaitMinutes: null, offsetMinutes: 1_440, parentId: entrada, position: 0, waitUntilTrue: false },
        { anchor: "previous", anchorNodeId: null, branch: "yes", campaignId: null, condition: null, expireWithAnchor: false, filter: null, id: sim, kind: "message", maxWaitMinutes: null, offsetMinutes: 0, parentId: condicao, position: 0, waitUntilTrue: false }
      ],
      origin: "notice"
    }
  });

  const detalhe = await getNoticeDetail(aviso.id, { permissions: { canPublish: true, canPublishLarge: true, canWrite: true } });
  assert.equal(detalhe.followUps.items, null);
  assert.deepEqual(detalhe.followUps.mode, { kind: "readonly", note: "Esta notificação tem passos que só aparecem no fluxo.", reason: "builder" });
  assert.deepEqual(detalhe.followUps.lines, ["Condição: Alunos que abriram a notificação “Aula nova no ar”", "Notificação “Para quem abriu”"]);

  actAs(produtor);
  const pelaCarta = await actions.saveNoticeFollowUps({ expectedNoticeUpdatedAt: aviso.updatedAt, followUps: [seguinte("Outra")], goal: null, noticeId: aviso.id });
  assert.equal(pelaCarta.status, 409);

  const pop = await actions.saveNoticeFollowUps({ expectedNoticeUpdatedAt: aviso.updatedAt, followUps: [], goal: null, noticeId: aviso.id });
  assert.equal(pop.ok, true, JSON.stringify(pop));
  assert.ok((await fluxo(aviso.flowId)).deleted_at);
});
