import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { apagarContaDeTeste, ESCOLA_DE_TESTE, limparComunicacao, SENHA_DE_TESTE, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Comunicacao v3a "Avisos: CRUD e edicao" (docs/24 §2.1–§2.4 e §4.7–§4.10) contra o banco LOCAL: editar a
// notificacao enviada (so o conteudo, para todos na hora, sem marcar como nova; os campos travados, as
// permissoes e a regra dos 500), Excluir em cada situacao, as regras que citam a notificacao (so avisam),
// "Mostrar de novo para quem já viu" no pop-up "Uma vez" (menu e editor), "Encerrar enquete" e Duplicar com
// enquete. O produtor age pelas Server Actions; os alunos leem o sino e o pop-up pelas rotas chamadas como
// funcao. Quem recebe: os tres alunos de teste, com um acesso a um curso de teste que este arquivo libera.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/communications/actions.ts");
const flowActions = await import("../../src/server/communications/flow-actions.ts");
const { emptyNoticeDraft } = await import("../../src/server/communications/schemas.ts");
const { getNoticeDetail, listNotices } = await import("../../src/server/communications/queries.ts");
const { processCommunications } = await import("../../src/server/communications/dispatch.ts");
const { processFlows } = await import("../../src/server/communications/flow-engine.ts");
const { createFactsLoader } = await import("../../src/server/communications/facts-loader.ts");
const { settleSenderNotices } = await import("../../src/server/communications/sender-notices.ts");
const notificationsRoute = await import("../../src/app/api/notifications/route.ts");
const summaryRoute = await import("../../src/app/api/notifications/summary/route.ts");
const pollRoute = await import("../../src/app/api/notifications/[id]/poll/route.ts");
const eventsRoute = await import("../../src/app/api/popups/[id]/events/route.ts");

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const PRODUTO = ESCOLA_DE_TESTE.cursoBloqueado.id;
const ACESSO = "teste-avisos-crud:";
const aluna = usuarioDeTeste(contas.aluna);
const aluno = usuarioDeTeste(contas.alunoSemAcesso);
const alunaExpirada = usuarioDeTeste(contas.alunaAcessoExpirado);
const produtor = usuarioDeTeste(contas.produtor);
const professor = contas.professor;
const TODAS = { canPublish: true, canPublishLarge: true, canWrite: true };
const PUBLICA = { canPublish: true, canPublishLarge: false, canWrite: true };
const SO_CRIA = { canPublish: false, canPublishLarge: false, canWrite: true };

// Equipe com funcoes de verdade: a editora publica (sem publish_large); a redatora so cria.
const EDITORA = { email: "editora.avisos-crud@bunker707.test", nome: "Editora de Avisos", permissions: {}, role: "editor" };
const REDATORA = { email: "redatora.avisos-crud@bunker707.test", nome: "Redatora de Avisos", permissions: { actions: ["messaging.write"] }, role: "custom" };
// Alunos em massa para passar de 500 no "Mostrar de novo": fora do dominio das contas de teste.
const MUITOS = { dominio: "muitos.bunker707.test", prefixo: "avisos-crud-", quantos: 501 };

const quemTemOProduto = { kind: "rules", root: { items: [{ op: "has", productIds: [PRODUTO], type: "product" }], match: "all" } };
const regras = (...items) => ({ kind: "rules", root: { items, match: "all" } });
const fez = (action, nodeId, negate = false) => ({ action, negate, ref: { kind: "node", nodeId }, type: "message" });
const recebeu = (campaignId) => ({ action: "received", negate: false, ref: { campaignId, kind: "campaign" }, type: "message" });
const conteudo = (title, extra = {}) => ({ audio: null, body: "", cta: null, icon: null, image: null, reactions: true, response: null, sender: null, title, validity: { mode: "default" }, ...extra });
const AUDIO = { durationSeconds: 48, mimeType: "audio/mpeg", peaks: [], url: "https://midia.bunker707.test/avisos/audio-do-teste.mp3" };
const ENQUETE = { closesAt: null, multiple: false, options: [{ id: "aaaa1111", label: "Sim" }, { id: "bbbb2222", label: "Não" }], question: "Vem na live?", showResults: true };

let editora;
let redatora;

async function criarEquipe(pessoa) {
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let user = data?.users.find((item) => item.email === pessoa.email);

  if (!user) {
    user = unwrap(
      await db.auth.admin.createUser({ email: pessoa.email, email_confirm: true, password: SENHA_DE_TESTE, user_metadata: { full_name: pessoa.nome } }),
      `Criando ${pessoa.nome}`
    ).user;
  }

  unwrap(await db.from("admin_roles").upsert({ permissions: pessoa.permissions, role: pessoa.role, user_id: user.id }, { onConflict: "user_id" }), "Dando a funcao");

  return usuarioDeTeste({ email: pessoa.email, id: user.id, nome: pessoa.nome });
}

/** psql no banco local (SUPABASE_DB_URL do .env.test.local): o Auth nao cria 501 contas num instante. */
function sql(statement) {
  const url = process.env.SUPABASE_DB_URL;
  assert.ok(url, "SUPABASE_DB_URL vem do .env.test.local (npm run db:start)");
  execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-c", statement], { stdio: ["ignore", "ignore", "inherit"] });
}

function apagarMuitosAlunos() {
  sql(`delete from auth.users where email like '${MUITOS.prefixo}%@${MUITOS.dominio}'`);
}

async function liberar(userId) {
  unwrap(
    await db.from("entitlements").insert({
      ends_at: null,
      source_event_id: `${ACESSO}${userId}:${randomUUID()}`,
      source_provider: "manual",
      starts_at: "2026-01-01T12:00:00.000Z",
      status: "active",
      target_id: PRODUTO,
      target_type: "standalone_course",
      user_id: userId
    }),
    "Liberando acesso de teste"
  );
}

async function limpar() {
  await limparComunicacao(db);
  unwrap(await db.from("entitlements").delete().like("source_event_id", `${ACESSO}%`), "Apagando acessos de teste");
  unwrap(await db.from("email_outbox").delete().eq("kind", "sent_as").in("user_id", [professor.id, produtor.id]), "Apagando os e-mails");
}

before(async () => {
  apagarMuitosAlunos();
  await limpar();
  editora = await criarEquipe(EDITORA);
  redatora = await criarEquipe(REDATORA);
});

after(async () => {
  await limpar();
  apagarMuitosAlunos();
  await apagarContaDeTeste(db, EDITORA.email);
  await apagarContaDeTeste(db, REDATORA.email);
});

beforeEach(async () => {
  await limpar();
  await liberar(aluna.id);
  await liberar(aluno.id);
  await liberar(alunaExpirada.id);
});

/* ------------------------------------------------------------------------------------------------
 * Apoio
 * ---------------------------------------------------------------------------------------------- */

const alunos = () => [aluna.id, aluno.id, alunaExpirada.id].sort();

function rascunho(extra = {}) {
  return { ...emptyNoticeDraft("inbox"), audience: quemTemOProduto, body: "Traga suas dúvidas para a live.", title: "Live de quinta", ...extra };
}

function popup(extra = {}) {
  return {
    ...emptyNoticeDraft("popup"),
    audience: quemTemOProduto,
    body: "A turma nova começa segunda.",
    cta: { href: `/conteudo/${PRODUTO}`, label: "Ver o curso", target: "same_tab" },
    title: "Turma nova",
    ...extra
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

/** Grava o aviso e as seguintes como o editor faz e publica. */
async function publicarComSeguintes(draft, followUps) {
  actAs(produtor);
  const salvo = ok(await actions.saveNoticeDraft({ draft }));
  const seguintes = ok(await actions.saveNoticeFollowUps({ expectedNoticeUpdatedAt: salvo.updatedAt, followUps, goal: null, noticeId: salvo.id }));
  const publicado = ok(await actions.publishNotice({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));

  return { ...publicado, entryNodeId: seguintes.entryNodeId, flowId: seguintes.flowId };
}

function seguinte(title, { content = {}, id = randomUUID(), minutes = 60, who = { kind: "everyone" } } = {}) {
  return { children: [], content: conteudo(title, content), id, when: { anchor: "sent", minutes }, who };
}

function tick(now) {
  const date = new Date(now);
  return processFlows({ budgetMs: 25_000, db, facts: createFactsLoader(db, date), now: date, signal: new AbortController().signal });
}

/** Salva a notificacao enviada como o editor faz: o rascunho lido do servidor com as mudancas por cima. */
async function editar(id, patch, { user = produtor, version } = {}) {
  actAs(produtor);
  const detalhe = await getNoticeDetail(id, { permissions: TODAS });
  actAs(user);

  return actions.saveNoticeDraft({ draft: { ...detalhe.draft, ...patch }, expectedUpdatedAt: version ?? detalhe.updatedAt, id });
}

async function sino(user) {
  actAs(user);
  const response = await notificationsRoute.GET(new Request("http://localhost/api/notifications"));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));

  return body.data.items;
}

async function itemDoSino(user, campaignTitle) {
  return (await sino(user)).find((item) => item.kind === "notice" && item.title === campaignTitle) ?? null;
}

async function popupDe(user) {
  actAs(user);
  const response = await summaryRoute.GET(new Request("http://localhost/api/notifications/summary?popup=1"));
  assert.equal(response.status, 200);

  return (await response.json()).data.popup;
}

async function evento(user, id, event) {
  actAs(user);
  const response = await eventsRoute.POST(
    new Request(`http://localhost/api/popups/${id}/events`, { body: JSON.stringify({ event }), headers: { "content-type": "text/plain;charset=UTF-8" }, method: "POST" }),
    { params: Promise.resolve({ id }) }
  );

  return { body: await response.json(), status: response.status };
}

async function votar(user, rowId, optionIds) {
  actAs(user);
  const response = await pollRoute.POST(
    new Request(`http://localhost/api/notifications/${rowId}/poll`, { body: JSON.stringify({ optionIds }), headers: { "content-type": "application/json" }, method: "POST" }),
    { params: Promise.resolve({ id: rowId }) }
  );

  return { body: await response.json(), status: response.status };
}

/** Passaram `horas` desde o ultimo pop-up visto (e do "Lembrar depois"): o teste volta o relogio das linhas. */
async function passaram(userId, horas) {
  const linhas = unwrap(await db.from("campaign_deliveries").select("campaign_id,first_seen_at,last_seen_at,snoozed_until").eq("user_id", userId), "Lendo os pop-ups");
  const antes = (valor) => (valor ? new Date(Date.parse(valor) - horas * HORA).toISOString() : null);

  for (const linha of linhas) {
    unwrap(
      await db
        .from("campaign_deliveries")
        .update({ first_seen_at: antes(linha.first_seen_at), last_seen_at: antes(linha.last_seen_at), snoozed_until: antes(linha.snoozed_until) })
        .eq("campaign_id", linha.campaign_id)
        .eq("user_id", userId),
      "Voltando o relogio"
    );
  }
}

async function entrega(campaignId, userId) {
  const [linha] = unwrap(
    await db
      .from("campaign_deliveries")
      .select("eligible,impressions,impressions_before_reshow,snooze_count,snoozes_before_reshow,reshown_at,clicked_at,dismissed_at")
      .eq("campaign_id", campaignId)
      .eq("user_id", userId),
    "Lendo o pop-up do aluno"
  );

  return linha ?? null;
}

async function mudarEntrega(campaignId, userId, patch) {
  unwrap(await db.from("campaign_deliveries").update(patch).eq("campaign_id", campaignId).eq("user_id", userId), "Mudando o pop-up do aluno");
}

async function linhasDoAviso(campaignId) {
  return unwrap(await db.from("notifications").select("id,user_id,read_at,seen_at").eq("campaign_id", campaignId).eq("is_test", false), "Lendo o sino do aviso");
}

async function quemRecebeuOPasso(nodeId) {
  return unwrap(await db.from("notifications").select("user_id").eq("flow_node_id", nodeId).eq("is_test", false), "Lendo o passo")
    .map((row) => row.user_id)
    .sort();
}

async function aviso(id) {
  return unwrap(await db.from("campaigns").select("*").eq("id", id).single(), "Lendo o aviso");
}

async function fluxo(id) {
  return unwrap(await db.from("communication_flows").select("*").eq("id", id).single(), "Lendo o fluxo");
}

async function auditoria(entityId, action) {
  return unwrap(await db.from("admin_audit_log").select("metadata,count").eq("entity_id", entityId).eq("action", action).order("occurred_at"), "Lendo a auditoria");
}

/* ------------------------------------------------------------------------------------------------
 * Editar a notificacao enviada (docs/24 §2.2 e §4.7)
 * ---------------------------------------------------------------------------------------------- */

test("editar a enviada: o aluno ve o titulo novo na hora, a leitura nao muda, nada volta a rascunho e a auditoria tem so os campos", async () => {
  const publicado = await publicar(rascunho({ reactions: true, title: "Live de quinta" }));
  assert.equal(publicado.situation, "sent");
  const [linha] = (await linhasDoAviso(publicado.id)).filter((row) => row.user_id === aluna.id);
  const lidaEm = new Date(Date.now() - HORA).toISOString();
  unwrap(await db.from("notifications").update({ read_at: lidaEm, seen_at: lidaEm }).eq("id", linha.id), "Marcando como lida");

  actAs(produtor);
  const antes = await getNoticeDetail(publicado.id, { permissions: TODAS });
  assert.deepEqual(antes.actions, ["view_report", "edit", "duplicate", "withdraw", "delete"]);
  assert.equal(antes.citations?.notices, 0);

  const salvo = ok(
    await editar(publicado.id, {
      body: "Traga suas dúvidas: vamos responder ao vivo.",
      cta: { display: "card", href: "/minhas-compras", label: "Ver minhas compras", target: "same_tab" },
      reactions: false,
      title: "Live de quinta (horário novo)"
    })
  );
  assert.equal(salvo.status, "sent");
  assert.equal(salvo.flowUpdatedAt, null);

  const item = await itemDoSino(aluna, "Live de quinta (horário novo)");
  assert.ok(item, "a aluna ve o titulo novo");
  assert.equal(item.body, "Traga suas dúvidas: vamos responder ao vivo.");
  assert.equal(Date.parse(item.readAt), Date.parse(lidaEm), "continua lida");
  assert.equal(item.reactions, null, "reacoes desligadas: sem o botao");
  assert.deepEqual(item.cta, { display: "card", href: "/minhas-compras", label: "Ver minhas compras", target: "same_tab" });
  assert.equal(await itemDoSino(aluna, "Live de quinta"), null, "nenhuma copia com o titulo velho");

  const linhaDepois = unwrap(await db.from("notifications").select("read_at,created_at").eq("id", linha.id).single(), "Linha depois");
  assert.equal(Date.parse(linhaDepois.read_at), Date.parse(lidaEm));

  const gravado = await aviso(publicado.id);
  assert.equal(gravado.status, "sent");
  assert.equal(gravado.edited_by, produtor.id);
  assert.ok(gravado.edited_at);
  assert.equal(gravado.requested_at, null);

  const [registro] = await auditoria(publicado.id, "communication.edited_after_send");
  assert.deepEqual(registro.metadata, {
    fields: ["title", "body", "cta_label", "cta_href", "cta_target", "cta_display", "allow_reactions"],
    kind: "inbox",
    recipients: 3
  });
  assert.doesNotMatch(JSON.stringify(registro.metadata), /horário novo|compras/, "so os nomes dos campos");

  const depois = await getNoticeDetail(publicado.id, { permissions: TODAS });
  assert.equal(depois.editedBy?.id, produtor.id);
  assert.ok(depois.editedAt);
});

test("enviada 'agora', com fim fixo no sino e com a enquete encerrada: o titulo muda; a versao velha recebe 409 antes de qualquer campo travado", async () => {
  // Enviada agora: send_at e o instante do envio (no passado) e mesmo assim salva.
  const agora = await publicar(rascunho({ title: "Enviada agora" }));
  ok(await editar(agora.id, { title: "Enviada agora (ajustada)" }));

  const ate = new Date(Date.now() + 3 * DIA).toISOString();
  const comFim = await publicar(rascunho({ title: "Com fim fixo", validity: { endsAt: ate, mode: "until" } }));
  ok(await editar(comFim.id, { title: "Com fim fixo (ajustada)" }));

  const enquete = await publicar(rascunho({ poll: ENQUETE, title: "Com enquete" }));
  actAs(produtor);
  const lida = await getNoticeDetail(enquete.id, { permissions: TODAS });
  ok(await actions.closeNoticePoll({ expectedUpdatedAt: lida.updatedAt, id: enquete.id }));

  // O editor aberto antes de "Encerrar enquete" (a enquete aberta no rascunho dele): 409, nao 400.
  actAs(produtor);
  const velha = await actions.saveNoticeDraft({ draft: { ...lida.draft, title: "Com enquete (editada)" }, expectedUpdatedAt: lida.updatedAt, id: enquete.id });
  assert.equal(velha.status, 409, JSON.stringify(velha));
  assert.match(velha.error, /mudou em outra tela/);

  const velhaComSegmento = await actions.saveNoticeDraft({ draft: { ...lida.draft, audience: { kind: "everyone" } }, expectedUpdatedAt: lida.updatedAt, id: enquete.id });
  assert.equal(velhaComSegmento.status, 409, "a versao primeiro");

  // Recarregado depois do encerramento: salva.
  ok(await editar(enquete.id, { title: "Com enquete (editada)" }));
  assert.ok(await itemDoSino(aluna, "Com enquete (editada)"));
});

test("campos travados depois do envio: 400 no campo com o motivo", async () => {
  const publicado = await publicar(rascunho({ audio: AUDIO, title: "Travada" }));
  const casos = [
    [{ audience: { kind: "everyone" } }, "audience", "O segmento não muda depois do envio."],
    [{ schedule: { mode: "at", sendAt: new Date(Date.now() + DIA).toISOString() } }, "schedule.sendAt", "O envio e o tempo no sino não mudam depois do envio."],
    [{ validity: { minutes: 4_320, mode: "duration" } }, "validity", "O envio e o tempo no sino não mudam depois do envio."],
    [{ audio: null }, "audio", "O áudio não muda depois do envio: quem já ouviu ficaria marcado como tendo ouvido o novo. Para trocar, duplique a notificação."],
    [{ response: { acceptLabel: "Vou", declineLabel: "Não vou" } }, "response", "Pedir uma resposta não muda depois do envio."],
    [{ poll: ENQUETE }, "poll", "A enquete não muda depois do envio."]
  ];

  for (const [patch, campo, motivo] of casos) {
    const recusado = await editar(publicado.id, patch);
    assert.equal(recusado.status, 400, `${campo}: ${JSON.stringify(recusado)}`);
    assert.deepEqual(recusado.fieldErrors?.[campo], [motivo], campo);
  }

  // O mesmo instante escrito de outro jeito nao e mudanca.
  actAs(produtor);
  const detalhe = await getNoticeDetail(publicado.id, { permissions: TODAS });
  const sendAt = detalhe.draft.schedule.mode === "at" ? detalhe.draft.schedule.sendAt : null;
  assert.ok(sendAt);
  ok(await editar(publicado.id, { schedule: { mode: "at", sendAt: new Date(sendAt).toISOString().replace("Z", "+00:00") }, title: "Travada (texto novo)" }));

  const gravado = await aviso(publicado.id);
  assert.equal(gravado.audio_url, AUDIO.url, "o audio fica");
  assert.equal(gravado.title, "Travada (texto novo)");
});

test("quem so cria avisos nao edita a enviada (403, sem Editar); acima de 500 so com publish_large (403, sem Editar); o dono passa", async () => {
  const publicado = await publicar(rascunho({ title: "Para muitos" }));

  actAs(redatora);
  assert.ok(!(await getNoticeDetail(publicado.id, { permissions: SO_CRIA })).actions.includes("edit"));
  const semPermissao = await editar(publicado.id, { title: "Mudou" }, { user: redatora });
  assert.equal(semPermissao.status, 403);
  assert.equal(semPermissao.error, "Só quem pode publicar muda uma notificação enviada. Duplique para criar outra.");

  actAs(editora);
  ok(await editar(publicado.id, { title: "Para muitos (editora)" }, { user: editora }));

  // A contagem do segmento passou de 500 (o maior entre quem recebeu e a contagem).
  unwrap(await db.from("campaigns").update({ audience_count: 501 }).eq("id", publicado.id), "Contagem acima de 500");
  const acima = await getNoticeDetail(publicado.id, { permissions: PUBLICA });
  assert.deepEqual(acima.actions, ["view_report", "duplicate", "withdraw", "delete"], "sem Editar para quem nao tem publish_large");
  const grande = await editar(publicado.id, { title: "Para muitos (de novo)" }, { user: editora });
  assert.equal(grande.status, 403);
  assert.equal(grande.error, "Para mudar uma notificação que já chegou a mais de 500 alunos, peça a um dono ou administrador.");

  assert.ok((await getNoticeDetail(publicado.id, { permissions: TODAS })).actions.includes("edit"));
  ok(await editar(publicado.id, { title: "Para muitos (dono)" }));
  assert.ok(await itemDoSino(aluno, "Para muitos (dono)"));
});

test("quem envia novo recebe um 'enviada em seu nome' so uma vez; editar outra vez nao manda de novo", async () => {
  const publicado = await publicar(rascunho({ title: "De quem" }));

  ok(await editar(publicado.id, { sender: { userId: professor.id } }));
  await settleSenderNotices();
  const emails = () => db.from("email_outbox").select("id").eq("kind", "sent_as").eq("user_id", professor.id);
  assert.equal(unwrap(await emails(), "E-mails").length, 1);

  ok(await editar(publicado.id, { title: "De quem (de novo)" }));
  await settleSenderNotices();
  assert.equal(unwrap(await emails(), "E-mails").length, 1);

  const perfil = unwrap(await db.from("profiles").select("full_name").eq("id", professor.id).single(), "Perfil do professor");
  const item = await itemDoSino(aluna, "De quem (de novo)");
  assert.equal(item.actor?.name, perfil.full_name?.trim() || "Equipe Bunker707", "a aluna ve quem envia agora");
});

/** As proximas 8h de Sao Paulo (11h UTC, sem horario de verao) depois de `ms` (FLOW_LIMITS.deferHourSaoPaulo). */
function proximas8hDeSaoPaulo(ms) {
  const dia = new Date(ms);
  const oito = Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), 11);

  return oito > ms ? oito : oito + 24 * HORA;
}

test("seguintes: tirar o destino que uma delas usa da 422; destino novo atualiza as paginas acompanhadas; o fluxo continua no ar e as pendentes saem", async () => {
  const entrada = randomUUID();
  const s1 = randomUUID();
  const usaODestino = await publicarComSeguintes(rascunho({ cta: { href: "/minhas-compras", label: "Ver", target: "same_tab" }, title: "Com destino" }), [
    seguinte("Quem não foi", { id: s1, minutes: 60, who: regras(fez("clicked", entrada, true)) })
  ]);
  assert.equal(usaODestino.entryNodeId, entrada);
  assert.equal((await fluxo(usaODestino.flowId)).status, "active");

  const semDestino = await editar(usaODestino.id, { cta: null });
  assert.equal(semDestino.status, 422, JSON.stringify(semDestino));
  assert.match(semDestino.error, /^A notificação seguinte 1 tem um problema: .+ Mude a notificação seguinte no relatório antes de salvar\.$/);
  assert.equal((await aviso(usaODestino.id)).cta_href, "/minhas-compras", "nada gravado");

  // Seguinte que olha a pagina do destino: trocar o destino muda as paginas que o fluxo acompanha.
  const s2 = randomUUID();
  const entrada2 = randomUUID();
  const olhaAPagina = await publicarComSeguintes(rascunho({ cta: { href: "/minhas-compras", label: "Ver", target: "same_tab" }, title: "Olha a página" }), [
    seguinte("Não visitou", {
      id: s2,
      who: regras({ negate: true, page: { kind: "message_cta", nodeId: entrada2 }, since: { kind: "message", nodeId: entrada2 }, type: "page_visit" })
    })
  ]);
  assert.ok((await fluxo(olhaAPagina.flowId)).watched_page_keys.includes("purchases"));

  ok(await editar(olhaAPagina.id, { cta: { href: `/conteudo/${PRODUTO}`, label: "Ver o curso", target: "same_tab" } }));
  const depois = await fluxo(olhaAPagina.flowId);
  assert.ok(depois.watched_page_keys.includes(`content:${PRODUTO}`), JSON.stringify(depois.watched_page_keys));
  assert.equal(depois.status, "active", "o fluxo das seguintes continua no ar");

  // Editar so o titulo da principal nao mexe no fluxo; as pendentes continuam e saem na hora delas.
  ok(await editar(usaODestino.id, { title: "Com destino (ajustada)" }));
  assert.equal((await fluxo(usaODestino.flowId)).status, "active");
  const now = Date.now();
  await tick(now + MIN);
  await tick(now + 2 * HORA);
  // As duas seguintes (s1 e s2) vencem juntas para os mesmos alunos: o motor manda uma e empurra a outra
  // 1 h (FLOW_LIMITS.minGapMinutes), em ordem que nao e fixa; o tick de +4 h manda a que ficou. Se o
  // empurrao passa da meia-noite de Sao Paulo, o motor guarda a que ficou para as 8h do dia (nunca de
  // madrugada): o tick das 8h a manda. Sem ele o teste falhava rodando entre 21h e meia-noite.
  await tick(now + 4 * HORA);
  await tick(proximas8hDeSaoPaulo(now + 3 * HORA) + MIN);
  assert.deepEqual(await quemRecebeuOPasso(s2), alunos(), "a seguinte do aviso com destino novo sai (ninguem visitou a pagina nova)");
  const tarefas = unwrap(await db.from("communication_flow_tasks").select("status").eq("flow_id", usaODestino.flowId), "Tarefas");
  assert.equal(tarefas.length, 3, "os tres entraram no fluxo do aviso editado");
  assert.ok(tarefas.every((tarefa) => tarefa.status !== "canceled"), JSON.stringify(tarefas));
});

/* ------------------------------------------------------------------------------------------------
 * Excluir (docs/24 §2.3 e §4.8)
 * ---------------------------------------------------------------------------------------------- */

test("excluir: rascunho por quem so cria; agendado so com publish (e o tick nunca envia); enviando e 409", async () => {
  actAs(redatora);
  const rascunhoSalvo = ok(await actions.saveNoticeDraft({ draft: rascunho({ title: "Rascunho para excluir" }) }));
  assert.deepEqual(ok(await actions.deleteNotice({ expectedUpdatedAt: rascunhoSalvo.updatedAt, id: rascunhoSalvo.id })), { id: rascunhoSalvo.id, removed: 0 });
  assert.equal(await getNoticeDetail(rascunhoSalvo.id), null);

  const sendAt = new Date(Date.now() + DIA).toISOString();
  const agendado = await publicar(rascunho({ schedule: { mode: "at", sendAt }, title: "Agendado para excluir" }));
  assert.equal(agendado.situation, "scheduled");

  actAs(redatora);
  const semPermissao = await actions.deleteNotice({ id: agendado.id });
  assert.equal(semPermissao.status, 403);
  assert.equal(semPermissao.error, "Só quem pode publicar exclui um aviso que os alunos veem ou que está agendado.");

  actAs(produtor);
  ok(await actions.deleteNotice({ expectedUpdatedAt: agendado.updatedAt, id: agendado.id }));
  // Mesmo vencido, o tick so reserva aviso nao excluido.
  unwrap(await db.from("campaigns").update({ send_at: new Date(Date.now() - MIN).toISOString() }).eq("id", agendado.id), "Vencendo o agendado");
  await processCommunications({ db });
  assert.deepEqual(await linhasDoAviso(agendado.id), [], "nunca sai");
  assert.equal((await aviso(agendado.id)).status, "scheduled");

  const enviando = await publicar(rascunho({ schedule: { mode: "at", sendAt }, title: "Enviando agora" }));
  unwrap(await db.from("campaigns").update({ dispatch_started_at: new Date().toISOString(), status: "sending" }).eq("id", enviando.id), "Enviando");
  actAs(produtor);
  const segurado = await actions.deleteNotice({ id: enviando.id });
  assert.equal(segurado.status, 409);
  assert.equal(segurado.error, "A notificação ainda está sendo enviada. Espere terminar para excluir.");
  assert.ok(!(await getNoticeDetail(enviando.id, { permissions: TODAS })).actions.includes("delete"));
});

test("excluir a enviada: some de todo sino e da lista; as seguintes que ja sairam vao junto (padrao) ou ficam (sem a caixa); o fluxo sai", async () => {
  const s1 = randomUUID();
  const comCaixa = await publicarComSeguintes(rascunho({ title: "Enviada para excluir" }), [seguinte("Já saiu", { id: s1, minutes: 60 })]);
  const now = Date.now();
  await tick(now + MIN);
  await tick(now + 2 * HORA);
  assert.deepEqual(await quemRecebeuOPasso(s1), alunos());

  actAs(redatora);
  assert.equal((await actions.deleteNotice({ id: comCaixa.id })).status, 403, "so cria avisos");

  actAs(produtor);
  const excluido = ok(await actions.deleteNotice({ expectedUpdatedAt: (await getNoticeDetail(comCaixa.id)).updatedAt, id: comCaixa.id }));
  assert.deepEqual(excluido, { id: comCaixa.id, removed: 3 });
  assert.deepEqual(await linhasDoAviso(comCaixa.id), []);
  assert.deepEqual(await quemRecebeuOPasso(s1), [], "as seguintes que ja sairam tambem");
  assert.equal(await itemDoSino(aluna, "Enviada para excluir"), null);
  assert.equal(await getNoticeDetail(comCaixa.id), null);
  assert.ok(!(await listNotices({ page: 1, permissions: TODAS })).items.some((item) => item.id === comCaixa.id), "fora da lista");

  const encerrado = await fluxo(comCaixa.flowId);
  assert.deepEqual([encerrado.status, encerrado.ended_reason], ["ended", "source_deleted"]);
  assert.ok(encerrado.deleted_at, "o fluxo sai da lista");

  const [registro] = await auditoria(comCaixa.id, "communication.deleted");
  assert.deepEqual(registro.metadata, { cited_by_flows: 0, cited_by_notices: 0, follow_ups_removed: 3, kind: "inbox", removed: 3, status: "sent" });

  // Sem a caixa: as que ja sairam ficam no sino.
  const s2 = randomUUID();
  const semCaixa = await publicarComSeguintes(rascunho({ title: "Enviada sem a caixa" }), [seguinte("Fica", { id: s2, minutes: 60 })]);
  await tick(Date.now() + MIN);
  await tick(Date.now() + 2 * HORA);
  actAs(produtor);
  ok(await actions.deleteNotice({ alsoFollowUps: false, id: semCaixa.id }));
  assert.deepEqual(await quemRecebeuOPasso(s2), alunos());
  assert.deepEqual(await linhasDoAviso(semCaixa.id), []);
});

test("excluir o pop-up no ar ou pausado: sai da home na hora e da lista; so com publish", async () => {
  const noAr = await publicar(popup({ title: "Pop-up para excluir" }));
  assert.equal((await popupDe(aluna))?.id, noAr.id);

  actAs(redatora);
  assert.equal((await actions.deleteNotice({ id: noAr.id })).status, 403);

  actAs(produtor);
  ok(await actions.deleteNotice({ id: noAr.id }));
  assert.equal(await popupDe(aluna), null, "saiu da home");
  assert.equal(await getNoticeDetail(noAr.id), null);
  const gravado = await aviso(noAr.id);
  assert.equal(gravado.status, "ended");
  assert.ok(gravado.deleted_at && gravado.ends_at);

  const pausado = await publicar(popup({ title: "Pop-up pausado para excluir" }));
  actAs(produtor);
  ok(await actions.pauseNotice({ id: pausado.id }));
  ok(await actions.deleteNotice({ id: pausado.id }));
  assert.equal((await aviso(pausado.id)).status, "ended");
  assert.ok(!(await listNotices({ page: 1, permissions: TODAS })).items.some((item) => [noAr.id, pausado.id].includes(item.id)));
});

test("sem limite entre pop-ups (docs/24 §10.8): quem acabou de ver um pop-up ve o proximo; o mesmo 'Até o aluno clicar' so volta 24 h depois", async () => {
  const primeiro = await publicar(popup({ repeat: "until_action", title: "Primeiro pop-up do dia" }));
  assert.equal((await popupDe(aluna))?.id, primeiro.id);
  assert.equal((await evento(aluna, primeiro.id, "impressed")).status, 200);
  assert.equal((await evento(aluna, primeiro.id, "closed")).status, 200);

  const segundo = await publicar(popup({ title: "Segundo pop-up do dia" }));
  assert.equal((await popupDe(aluna))?.id, segundo.id, "viu outro pop-up agora e mesmo assim ve este");
  assert.equal((await evento(aluna, segundo.id, "impressed")).status, 200);

  actAs(produtor);
  ok(await actions.deleteNotice({ id: segundo.id }));
  assert.notEqual((await popupDe(aluna))?.id, primeiro.id, "o primeiro (Até o aluno clicar) espera 24 h depois de visto");
  await passaram(aluna.id, 25);
  const depois = await popupDe(aluna);
  assert.ok(depois, "depois de 24 h ha pop-up de novo");

  actAs(produtor);
  ok(await actions.deleteNotice({ id: primeiro.id }));
});

/* ------------------------------------------------------------------------------------------------
 * Regras que citam a notificacao (docs/24 §0 T23)
 * ---------------------------------------------------------------------------------------------- */

test("regras que citam a notificacao: um pop-up no ar e um fluxo contam (o fluxo das seguintes dela nao); avisam, a auditoria conta e excluir continua", async () => {
  const citada = await publicarComSeguintes(rascunho({ title: "Citada" }), [seguinte("Seguinte dela")]);
  const naoCitada = await publicar(rascunho({ title: "Ninguém cita" }));

  await publicar(popup({ audience: regras(recebeu(citada.id)), title: "Pop-up de quem recebeu" }));
  actAs(produtor);
  const fluxoQueCita = ok(
    await flowActions.saveFlow({
      flow: {
        entry: { audience: regras(recebeu(citada.id)), mode: "current" },
        goal: null,
        messages: {},
        name: "Fluxo de quem recebeu",
        nodes: [{ branch: null, id: randomUUID(), kind: "entry", parentId: null, position: 0 }],
        origin: "builder"
      }
    })
  );
  assert.ok(fluxoQueCita.id);

  // O fluxo das seguintes da propria notificacao nunca conta (sai junto com ela).
  unwrap(await db.from("communication_flows").update({ goal: regras(recebeu(citada.id)) }).eq("id", citada.flowId), "O fluxo dela cita");

  const lista = await listNotices({ page: 1, permissions: TODAS });
  assert.deepEqual(lista.items.find((item) => item.id === citada.id)?.citations, { flows: 1, notices: 1 });
  assert.deepEqual(lista.items.find((item) => item.id === naoCitada.id)?.citations, { flows: 0, notices: 0 });
  assert.equal(lista.items.find((item) => item.title === "Pop-up de quem recebeu")?.citations, null, "so a notificacao enviada");
  assert.deepEqual((await getNoticeDetail(citada.id, { permissions: TODAS })).citations, { flows: 1, notices: 1 });

  actAs(produtor);
  ok(await actions.deleteNotice({ id: citada.id }));
  const [registro] = await auditoria(citada.id, "communication.deleted");
  assert.equal(registro.metadata.cited_by_notices, 1);
  assert.equal(registro.metadata.cited_by_flows, 1);

  // Retirar do sino tambem conta na auditoria.
  const outra = await publicar(rascunho({ title: "Citada e retirada" }));
  await publicar(popup({ audience: regras(recebeu(outra.id)), title: "Outro pop-up que cita" }));
  actAs(produtor);
  ok(await actions.withdrawNotice({ id: outra.id }));
  const [retirada] = await auditoria(outra.id, "communication.withdrawn");
  assert.equal(retirada.metadata.cited_by_notices, 1);
  assert.equal(retirada.metadata.cited_by_flows, 0);
});

/* ------------------------------------------------------------------------------------------------
 * "Mostrar de novo para quem já viu" (docs/24 §2.4 e §4.9)
 * ---------------------------------------------------------------------------------------------- */

test("mostrar de novo (menu), so em 'Uma vez': quem fechou ha 25 h nao ve antes, ve depois; quem clicou ou escolheu 'Não mostrar de novo' continua sem ver", async () => {
  const publicado = await publicar(popup({ repeat: "once", title: "Uma vez" }));

  // A aluna viu e fechou; o aluno clicou; a outra escolheu "Não mostrar de novo".
  assert.equal((await popupDe(aluna))?.id, publicado.id);
  assert.equal((await evento(aluna, publicado.id, "impressed")).status, 200);
  assert.equal((await evento(aluna, publicado.id, "closed")).status, 200);
  for (const [pessoa, final] of [[aluno, "clicked"], [alunaExpirada, "dismissed"]]) {
    assert.equal((await popupDe(pessoa))?.id, publicado.id);
    await evento(pessoa, publicado.id, "impressed");
    assert.equal((await evento(pessoa, publicado.id, final)).status, 200);
  }

  for (const pessoa of [aluna, aluno, alunaExpirada]) {
    await passaram(pessoa.id, 25);
  }

  assert.equal(await popupDe(aluna), null, "'Uma vez': quem ja viu nao ve de novo, mesmo 25 h depois");

  actAs(produtor);
  const detalhe = await getNoticeDetail(publicado.id, { permissions: TODAS });
  assert.equal(detalhe.reshowable, 1, "so a aluna (viu e nao clicou)");
  assert.ok(detalhe.actions.includes("reshow"));

  actAs(redatora);
  assert.equal((await actions.reshowPopup({ id: publicado.id })).status, 403, "so quem publica");

  actAs(produtor);
  assert.equal((await actions.reshowPopup({ expectedUpdatedAt: "2020-01-01T00:00:00.000Z", id: publicado.id })).status, 409, "versao velha");
  const mostrado = ok(await actions.reshowPopup({ expectedUpdatedAt: detalhe.updatedAt, id: publicado.id }));
  assert.deepEqual(mostrado, { reshown: 1, updatedAt: detalhe.updatedAt }, "o aviso nao muda");

  const linha = await entrega(publicado.id, aluna.id);
  assert.equal(linha.impressions_before_reshow, linha.impressions);
  assert.ok(linha.reshown_at);
  assert.equal((await entrega(publicado.id, aluno.id)).impressions_before_reshow, 0, "quem clicou nao muda");
  assert.equal((await entrega(publicado.id, alunaExpirada.id)).impressions_before_reshow, 0, "quem pediu para nao ver nao muda");

  assert.equal((await popupDe(aluna))?.id, publicado.id, "a aluna ve de novo");
  assert.equal(await popupDe(aluno), null);
  assert.equal(await popupDe(alunaExpirada), null);

  const [registro] = await auditoria(publicado.id, "communication.popup_reshown");
  assert.deepEqual(registro.metadata, { count: 1, via: "menu" });

  // Viu de novo agora e "Uma vez" a pula; mostrar de novo conta ela outra vez, na hora: sem limite entre
  // pop-ups (docs/24 §10).
  await evento(aluna, publicado.id, "impressed");
  assert.equal(await popupDe(aluna), null, "Uma vez: ja viu depois do ultimo mostrar de novo");
  actAs(produtor);
  assert.equal(ok(await actions.reshowPopup({ id: publicado.id })).reshown, 1);
  assert.equal((await popupDe(aluna))?.id, publicado.id, "volta na hora");
});

test("mostrar de novo: 'Lembrar depois' volta a valer duas vezes; conta so quem esta no segmento, viu e nao clicou nem tem um 'Lembrar depois' por ver", async () => {
  const publicado = await publicar(popup({ repeat: "once", title: "Lembrar de novo" }));

  // A aluna ja tinha usado os dois "Lembrar depois" (e visto tres vezes); o aluno viu uma vez e pediu para
  // lembrar (ainda vai ver); a outra viu e saiu do segmento.
  await mudarEntrega(publicado.id, aluna.id, { impressions: 3, last_seen_at: new Date(Date.now() - 30 * HORA).toISOString(), snooze_count: 2 });
  await mudarEntrega(publicado.id, aluno.id, { impressions: 1, last_seen_at: new Date(Date.now() - 30 * HORA).toISOString(), snooze_count: 1 });
  await mudarEntrega(publicado.id, alunaExpirada.id, { eligible: false, impressions: 1, last_seen_at: new Date(Date.now() - 30 * HORA).toISOString() });

  actAs(produtor);
  assert.equal((await getNoticeDetail(publicado.id, { permissions: TODAS })).reshowable, 1, "so a aluna");
  assert.equal(ok(await actions.reshowPopup({ id: publicado.id })).reshown, 1);
  const linha = await entrega(publicado.id, aluna.id);
  assert.deepEqual([linha.impressions_before_reshow, linha.snooze_count, linha.snoozes_before_reshow], [3, 1, 1], "o relatorio continua contando o 'Lembrar depois'");

  let visto = await popupDe(aluna);
  assert.equal(visto?.id, publicado.id);
  assert.equal(visto.canSnooze, true, "primeiro 'Lembrar depois' de novo");
  await evento(aluna, publicado.id, "impressed");
  assert.equal((await evento(aluna, publicado.id, "snoozed")).status, 200);
  await passaram(aluna.id, 25);

  visto = await popupDe(aluna);
  assert.equal(visto?.id, publicado.id);
  assert.equal(visto.canSnooze, true, "segundo");
  await evento(aluna, publicado.id, "impressed");
  assert.equal((await evento(aluna, publicado.id, "snoozed")).status, 200);
  await passaram(aluna.id, 25);

  visto = await popupDe(aluna);
  assert.equal(visto?.id, publicado.id);
  assert.equal(visto.canSnooze, false, "depois de dois, acabou");
});

test("mostrar de novo acima de 500 so com publish_large; 'Até o aluno clicar' nao tem a opcao (409)", async () => {
  const publicado = await publicar(popup({ repeat: "once", title: "Para muitos" }));
  sql(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
      '${MUITOS.prefixo}' || g || '@${MUITOS.dominio}', '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', 'Aluno em massa ' || g), now(), now()
    from generate_series(1, ${MUITOS.quantos}) g
    on conflict do nothing`);
  sql(`insert into public.campaign_deliveries (campaign_id, user_id, eligible, impressions, first_seen_at, last_seen_at)
    select '${publicado.id}', u.id, true, 1, now() - interval '30 hours', now() - interval '30 hours'
    from auth.users u where u.email like '${MUITOS.prefixo}%@${MUITOS.dominio}'
    on conflict (campaign_id, user_id) do update set impressions = 1, eligible = true`);

  actAs(produtor);
  assert.equal((await getNoticeDetail(publicado.id, { permissions: TODAS })).reshowable, 501);

  actAs(editora);
  const grande = await actions.reshowPopup({ id: publicado.id });
  assert.equal(grande.status, 403);
  assert.equal(grande.error, "Para mostrar de novo a mais de 500 alunos, peça a um dono ou administrador.");

  // Pelo editor, a contagem e conferida antes de gravar: nada muda.
  const lido = await getNoticeDetail(publicado.id, { permissions: PUBLICA });
  const pelaEdicao = await actions.saveNoticeDraft({ draft: { ...lido.draft, title: "Para muitos (editado)" }, expectedUpdatedAt: lido.updatedAt, id: publicado.id, reshow: true });
  assert.equal(pelaEdicao.status, 403);
  assert.equal(pelaEdicao.error, "Para mostrar de novo a mais de 500 alunos, peça a um dono ou administrador.");
  assert.equal((await aviso(publicado.id)).title, "Para muitos", "nada gravado");
  assert.equal(ok(await actions.saveNoticeDraft({ draft: { ...lido.draft, title: "Para muitos (editado)" }, expectedUpdatedAt: lido.updatedAt, id: publicado.id })).status, "active", "sem o switch, a editora salva");

  actAs(produtor);
  assert.equal(ok(await actions.reshowPopup({ id: publicado.id })).reshown, 501, "o dono passa");
  apagarMuitosAlunos();

  const ateClicar = await publicar(popup({ repeat: "until_action", title: "Até clicar" }));
  actAs(produtor);
  const detalhe = await getNoticeDetail(ateClicar.id, { permissions: TODAS });
  assert.ok(!detalhe.actions.includes("reshow"), "sem a opcao no menu");
  const recusado = await actions.reshowPopup({ id: ateClicar.id });
  assert.equal(recusado.status, 409);
  assert.equal(recusado.error, "Mostrar de novo vale para pop-ups em “Uma vez”. Em “Até o aluno clicar”, quem fechou já volta a ver 24 horas depois.");

  const naoPopup = await publicar(rascunho({ title: "Notificação" }));
  actAs(produtor);
  assert.equal((await actions.reshowPopup({ id: naoPopup.id })).status, 422);
});

test("mostrar de novo pelo editor: trocar 'Até o aluno clicar' para 'Uma vez' com o switch ligado salva e mostra de novo; com 'Até o aluno clicar' e 400 no campo", async () => {
  const publicado = await publicar(popup({ repeat: "until_action", title: "Pelo editor" }));
  await mudarEntrega(publicado.id, aluna.id, { impressions: 1, last_seen_at: new Date(Date.now() - 30 * HORA).toISOString() });

  actAs(produtor);
  const detalhe = await getNoticeDetail(publicado.id, { permissions: TODAS });
  assert.equal(detalhe.reshowable, 1, "contado pela regra 'Uma vez' mesmo em 'Até o aluno clicar'");

  const errado = await actions.saveNoticeDraft({ draft: detalhe.draft, expectedUpdatedAt: detalhe.updatedAt, id: publicado.id, reshow: true });
  assert.equal(errado.status, 400);
  assert.deepEqual(errado.fieldErrors?.reshow, ["Mostrar de novo vale para pop-ups em “Uma vez”. Em “Até o aluno clicar”, quem fechou já volta a ver 24 horas depois."]);

  const salvo = ok(await actions.saveNoticeDraft({ draft: { ...detalhe.draft, repeat: "once" }, expectedUpdatedAt: detalhe.updatedAt, id: publicado.id, reshow: true }));
  assert.equal(salvo.reshown, 1);
  assert.equal(salvo.status, "active");
  assert.equal((await aviso(publicado.id)).popup_repeat, "once");
  assert.equal((await entrega(publicado.id, aluna.id)).impressions_before_reshow, 1);
  assert.equal((await popupDe(aluna))?.id, publicado.id, "a aluna ve de novo");

  const [registro] = await auditoria(publicado.id, "communication.popup_reshown");
  assert.deepEqual(registro.metadata, { count: 1, via: "editor" });
  assert.ok((await aviso(publicado.id)).edited_at, "a edicao do pop-up no ar fica no relatorio");

  // Pausado em "Uma vez": o menu tambem mostra de novo (ninguem mais para mostrar: 0).
  actAs(produtor);
  ok(await actions.pauseNotice({ id: publicado.id }));
  assert.ok((await getNoticeDetail(publicado.id, { permissions: TODAS })).actions.includes("reshow"));
  assert.equal(ok(await actions.reshowPopup({ id: publicado.id })).reshown, 0);
});

/* ------------------------------------------------------------------------------------------------
 * Encerrar enquete e duplicar (docs/24 §4.10 e §5.2)
 * ---------------------------------------------------------------------------------------------- */

test("encerrar enquete: so quem publica; depois ninguem vota (409) e encerrar de novo e 409; sem enquete, 409", async () => {
  const publicado = await publicar(rascunho({ poll: ENQUETE, title: "Enquete da live" }));
  const item = await itemDoSino(aluna, "Enquete da live");
  assert.equal((await votar(aluna, item.id, ["aaaa1111"])).status, 200);

  actAs(redatora);
  assert.equal((await actions.closeNoticePoll({ id: publicado.id })).status, 403);

  actAs(produtor);
  const encerrada = ok(await actions.closeNoticePoll({ id: publicado.id }));
  assert.equal(encerrada.situation, "sent");
  const gravado = await aviso(publicado.id);
  assert.match(gravado.poll.closesAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "ISO canonico");
  assert.ok(gravado.edited_at);
  assert.equal((await auditoria(publicado.id, "communication.poll_closed")).length, 1);

  const depois = await votar(aluno, (await itemDoSino(aluno, "Enquete da live")).id, ["bbbb2222"]);
  assert.equal(depois.status, 409);

  actAs(produtor);
  const deNovo = await actions.closeNoticePoll({ id: publicado.id });
  assert.equal(deNovo.status, 409);
  assert.equal(deNovo.error, "A enquete já está encerrada.");

  const semEnquete = await publicar(rascunho({ title: "Sem enquete" }));
  actAs(produtor);
  const recusado = await actions.closeNoticePoll({ id: semEnquete.id });
  assert.equal(recusado.status, 409);
  assert.equal(recusado.error, "Esta notificação não tem enquete.");
});

test("duplicar: copia a enquete, as reacoes e como o aluno chega la; um fim que ja passou volta a 'quando sair do sino', um no futuro fica", async () => {
  const publicado = await publicar(
    rascunho({ cta: { display: "button_and_card", href: "/minhas-compras", label: "Ver", target: "same_tab" }, poll: ENQUETE, reactions: true, title: "Para duplicar" })
  );
  actAs(produtor);
  ok(await actions.closeNoticePoll({ id: publicado.id }));

  const copia = ok(await actions.duplicateNotice({ id: publicado.id }));
  const nova = await aviso(copia.id);
  assert.equal(nova.status, "draft");
  assert.equal(nova.allow_reactions, true);
  assert.equal(nova.cta_display, "button_and_card");
  assert.equal(nova.poll.question, ENQUETE.question);
  assert.equal(nova.poll.closesAt, null, "o fim que ja passou volta para 'quando sair do sino'");

  const fim = new Date(Date.now() + 3 * DIA);
  const rascunhoComFim = ok(await actions.saveNoticeDraft({ draft: rascunho({ poll: { ...ENQUETE, closesAt: fim.toISOString() }, title: "Fim no futuro" }) }));
  const copiaComFim = ok(await actions.duplicateNotice({ id: rascunhoComFim.id }));
  assert.equal((await aviso(copiaComFim.id)).poll.closesAt, fim.toISOString());

  const pertoDoFim = ok(
    await actions.saveNoticeDraft({ draft: rascunho({ poll: { ...ENQUETE, closesAt: new Date(Date.now() + 30 * MIN).toISOString() }, title: "Fim em 30 min" }) })
  );
  assert.equal((await aviso(ok(await actions.duplicateNotice({ id: pertoDoFim.id })).id)).poll.closesAt, null, "a menos de 1 hora tambem volta");
});
