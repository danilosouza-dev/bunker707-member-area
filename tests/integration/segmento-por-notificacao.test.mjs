import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { apagarContaDeTeste, limparComunicacao, SENHA_DE_TESTE, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Segmento comum com "o que fez com uma notificacao" (Comunicacao v2, docs/23 §7) contra o banco LOCAL:
// "não ouviram até o fim o áudio da notificação X" conta so quem recebeu X e nao terminou o audio, e a
// conta e a mesma em todo lugar que avalia o segmento: a previa do editor, a publicacao (sem 422), o
// envio agendado que o tick faz, o recalculo de 15 minutos do pop-up e a entrada de um fluxo ("Quem
// entra"). Sem os avisos citados lidos, a regra nunca combina (negada ou nao). O tick (envio agendado e
// recalculo do pop-up) usa o carregador por chave de facts-loader.ts e a entrada do fluxo, flow-engine.ts.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/communications/actions.ts");
const { emptyNoticeDraft } = await import("../../src/server/communications/schemas.ts");
const { getNoticeDetail, loadAudienceNames, loadAudienceNoticeOptions, loadNoticeEditorOptions } = await import("../../src/server/communications/queries.ts");
const { loadAudienceFacts, loadAudienceFactsFor, loadMessageFacts } = await import("../../src/server/communications/audience-facts.ts");
const { resolveAudienceUserIds } = await import("../../src/server/communications/audience.ts");
const { processCommunications } = await import("../../src/server/communications/dispatch.ts");
const { createFactsLoader } = await import("../../src/server/communications/facts-loader.ts");
const { processFlows } = await import("../../src/server/communications/flow-engine.ts");

const aluna = usuarioDeTeste(contas.aluna);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);
const alunaAcessoExpirado = usuarioDeTeste(contas.alunaAcessoExpirado);
const produtor = usuarioDeTeste(contas.produtor);
const equipe = [contas.produtor.id, contas.professor.id, contas.analista.id];
const HORA = 60 * 60 * 1000;
const TITULO_X = "Aula gravada: ouça o recado";
// Mais uma aluna, que recebe X e nao faz nada: continua no segmento em todo recalculo.
const OUTRA_ALUNA = { email: "aluna.recado@bunker707.test", nome: "Aluna do Recado" };

async function criarOutraAluna() {
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let user = data?.users.find((item) => item.email === OUTRA_ALUNA.email);

  if (!user) {
    user = unwrap(
      await db.auth.admin.createUser({ email: OUTRA_ALUNA.email, email_confirm: true, password: SENHA_DE_TESTE, user_metadata: { full_name: OUTRA_ALUNA.nome } }),
      "Criando a outra aluna"
    ).user;
  }

  unwrap(await db.from("profiles").upsert({ email: OUTRA_ALUNA.email, full_name: OUTRA_ALUNA.nome, id: user.id }, { onConflict: "id" }), "Perfil da outra aluna");

  return user.id;
}

function rascunho(extra = {}) {
  return { ...emptyNoticeDraft("inbox"), audience: { kind: "everyone" }, body: "Um recado rápido sobre a aula de hoje.", title: "Recado", ...extra };
}

async function salvarEPublicar(draft) {
  actAs(produtor);
  const salvo = await actions.saveNoticeDraft({ draft });
  assert.equal(salvo.ok, true, JSON.stringify(salvo));
  const publicado = await actions.publishNotice({ expectedUpdatedAt: salvo.data.updatedAt, id: salvo.data.id });
  assert.equal(publicado.ok, true, JSON.stringify(publicado));

  return publicado.data;
}

async function destinatarios(campaignId) {
  const linhas = unwrap(await db.from("notifications").select("user_id").eq("campaign_id", campaignId).eq("is_test", false), "Lendo o sino do aviso");

  return linhas.map((linha) => linha.user_id).sort();
}

/** Marca o que a pessoa fez com a linha do sino (as datas respeitam a ordem que o banco exige). */
async function marcarAudio(campaignId, userId, { completed }) {
  const at = new Date(Date.now() - HORA).toISOString();

  unwrap(
    await db
      .from("notifications")
      .update({ audio_completed_at: completed ? at : null, audio_started_at: at, opened_at: at, read_at: at, seen_at: at })
      .eq("campaign_id", campaignId)
      .eq("user_id", userId),
    "Marcando o audio"
  );
}

let avisoX = null;
let segmento = null;
let esperado = [];
let outraAluna = null;

async function limparTudo() {
  await limparComunicacao(db);
}

before(async () => {
  await limparTudo();
  outraAluna = await criarOutraAluna();

  // X vai para todos os alunos; a aluna ouve ate o fim, o aluno sem acesso so comeca, e a linha da aluna
  // com o acesso expirado sai (ela "nao recebeu X").
  avisoX = await salvarEPublicar(rascunho({ title: TITULO_X }));
  unwrap(await db.from("notifications").delete().eq("campaign_id", avisoX.id).eq("user_id", alunaAcessoExpirado.id), "Tirando uma linha de X");
  await marcarAudio(avisoX.id, aluna.id, { completed: true });
  await marcarAudio(avisoX.id, alunoSemAcesso.id, { completed: false });

  segmento = {
    kind: "rules",
    root: { items: [{ action: "audio_completed", negate: true, ref: { campaignId: avisoX.id, kind: "campaign" }, type: "message" }], match: "all" }
  };
  esperado = (await destinatarios(avisoX.id)).filter((userId) => userId !== aluna.id);
});
after(async () => {
  await limparTudo();
  await apagarContaDeTeste(db, OUTRA_ALUNA.email);
});

test("'não ouviram até o fim o áudio da notificação X' conta só quem recebeu X e não terminou o áudio", async () => {
  assert.ok(esperado.includes(alunoSemAcesso.id), "comecou e nao terminou");
  assert.ok(esperado.includes(outraAluna), "recebeu e nao fez nada");
  assert.ok(!esperado.includes(aluna.id), "ouviu ate o fim");
  assert.ok(!esperado.includes(alunaAcessoExpirado.id), "nao recebeu X");

  const fatos = await loadAudienceFacts(db, new Date(), { messageCampaignIds: [avisoX.id] });
  assert.deepEqual(resolveAudienceUserIds(segmento, fatos), esperado);
  assert.ok(fatos.context.messageKeys.has(`campaign:${avisoX.id}`));

  for (const pessoa of equipe) {
    assert.ok(!resolveAudienceUserIds(segmento, fatos).includes(pessoa), "a equipe nunca entra");
  }

  const semOsAvisos = await loadAudienceFacts(db, new Date());
  assert.deepEqual(resolveAudienceUserIds(segmento, semOsAvisos), [], "sem as linhas de X lidas, a regra nunca combina");

  // Os mesmos fatos para alguns alunos (o lote do motor), com as linhas so deles.
  const alguns = await loadAudienceFactsFor(db, [aluna.id, alunoSemAcesso.id, alunaAcessoExpirado.id], new Date(), { messageCampaignIds: [avisoX.id] });
  assert.deepEqual(resolveAudienceUserIds(segmento, alguns), [alunoSemAcesso.id]);

  const linhas = await loadMessageFacts(db, [avisoX.id], { userIds: [aluna.id] });
  assert.deepEqual([...linhas.keys()], [aluna.id]);
  assert.ok(linhas.get(aluna.id)[`campaign:${avisoX.id}`].audioCompletedAt);
});

test("a prévia do editor e a publicação contam o mesmo segmento, e a frase traz o título de X", async () => {
  actAs(produtor);
  const previa = await actions.previewNoticeAudience({ audience: segmento });
  assert.equal(previa.ok, true, JSON.stringify(previa));
  assert.equal(previa.data.count, esperado.length);
  assert.equal(previa.data.description, `Alunos que não ouviram até o fim o áudio da notificação “${TITULO_X}”`);

  const nomes = await loadAudienceNames(db, [segmento]);
  assert.equal(nomes.messages[`campaign:${avisoX.id}`], TITULO_X);

  const publicado = await salvarEPublicar(rascunho({ audience: segmento, title: "Ainda não ouviu? Leva 2 minutos" }));
  assert.deepEqual(await destinatarios(publicado.id), esperado, "sai para quem a previa contou");
  assert.equal((await getNoticeDetail(publicado.id)).audienceDescription, `Alunos que não ouviram até o fim o áudio da notificação “${TITULO_X}”`);
});

test("o seletor da regra lista as notificações enviadas nos últimos 90 dias, mais recentes primeiro, sem rascunhos", async () => {
  actAs(produtor);
  const salvo = await actions.saveNoticeDraft({ draft: rascunho({ title: "Rascunho que não aparece" }) });
  assert.equal(salvo.ok, true, JSON.stringify(salvo));

  const opcoes = await loadAudienceNoticeOptions(db);
  const x = opcoes.find((opcao) => opcao.id === avisoX.id);

  assert.ok(x, "X foi enviada agora");
  assert.equal(x.title, TITULO_X);
  assert.deepEqual(
    { canOpen: x.canOpen, hasAudio: x.hasAudio, hasCta: x.hasCta, hasResponse: x.hasResponse },
    { canOpen: false, hasAudio: false, hasCta: false, hasResponse: false },
    "aviso curto so de texto: nada a abrir"
  );
  assert.ok(!opcoes.some((opcao) => opcao.id === salvo.data.id), "rascunho nao e notificacao enviada");
  assert.deepEqual(opcoes.map((opcao) => opcao.sentAt), [...opcoes.map((opcao) => opcao.sentAt)].sort().reverse());

  const daqui100Dias = Date.now() + 100 * 86_400_000;
  assert.ok(!(await loadAudienceNoticeOptions(db, daqui100Dias)).some((opcao) => opcao.id === avisoX.id), "mais de 90 dias: fora da lista");
});

test("o editor recebe as notificações do seletor e o título de X, também quando X saiu da lista dos 90 dias", async () => {
  actAs(produtor);
  const opcoes = await loadNoticeEditorOptions();
  const x = opcoes.notices.find((opcao) => opcao.id === avisoX.id);

  assert.ok(x, "X esta no seletor do Para quem");
  assert.equal(x.title, TITULO_X);

  // Aviso aberto que cita X, enviado ha mais de 90 dias: fora do seletor, mas a frase continua com o titulo.
  const [{ sent_at: enviadoEm }] = unwrap(await db.from("campaigns").select("sent_at").eq("id", avisoX.id), "Lendo o envio de X");
  unwrap(await db.from("campaigns").update({ sent_at: new Date(Date.now() - 100 * 86_400_000).toISOString() }).eq("id", avisoX.id), "Envelhecendo X");

  try {
    const doAviso = await loadNoticeEditorOptions({ audiences: [segmento] });
    assert.ok(!doAviso.notices.some((opcao) => opcao.id === avisoX.id), "mais de 90 dias: fora do seletor");
    assert.equal(doAviso.names.messages[`campaign:${avisoX.id}`], TITULO_X);
  } finally {
    unwrap(await db.from("campaigns").update({ sent_at: enviadoEm }).eq("id", avisoX.id), "Devolvendo o envio de X");
  }
});

test("o envio agendado que o tick faz conta o mesmo segmento", async () => {
  const agendado = await salvarEPublicar(
    rascunho({ audience: segmento, schedule: { mode: "at", sendAt: new Date(Date.now() + HORA).toISOString() }, title: "Agendado para quem não ouviu" })
  );
  assert.equal(agendado.situation, "scheduled");
  unwrap(await db.from("campaigns").update({ send_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", agendado.id), "Adiantando o envio");

  await processCommunications({ db });
  assert.deepEqual(await destinatarios(agendado.id), esperado);
  assert.equal((await getNoticeDetail(agendado.id)).situation, "sent");
});

test("o recálculo de 15 minutos do pop-up mantém elegível quem está no segmento e tira quem terminou o áudio", async () => {
  const popup = await salvarEPublicar({
    ...emptyNoticeDraft("popup"),
    audience: segmento,
    body: "O recado da aula está no sino.",
    title: "Ouça o recado da aula"
  });
  const elegiveis = async () =>
    unwrap(await db.from("campaign_deliveries").select("user_id").eq("campaign_id", popup.id).eq("eligible", true), "Lendo o pop-up")
      .map((linha) => linha.user_id)
      .sort();

  assert.deepEqual(await elegiveis(), esperado, "na publicacao");

  // O aluno sem acesso termina o audio de X; o recalculo seguinte tira o pop-up dele.
  await marcarAudio(avisoX.id, alunoSemAcesso.id, { completed: true });
  unwrap(await db.from("campaigns").update({ audience_refreshed_at: new Date(Date.now() - HORA).toISOString() }).eq("id", popup.id), "Envelhecendo o recalculo");

  try {
    const rodada = await processCommunications({ db });
    assert.ok(rodada.refreshed >= 1, JSON.stringify(rodada));
    const continuam = esperado.filter((userId) => userId !== alunoSemAcesso.id);
    assert.ok(continuam.includes(outraAluna));
    assert.deepEqual(await elegiveis(), continuam);
  } finally {
    await marcarAudio(avisoX.id, alunoSemAcesso.id, { completed: false });
  }
});

test("'Quem entra' de um fluxo com a regra faz entrar exatamente quem está no segmento", async () => {
  const [fluxo] = unwrap(
    await db
      .from("communication_flows")
      .insert({
        activated_at: new Date().toISOString(),
        created_by: produtor.id,
        entry_audience: segmento,
        entry_mode: "current",
        name: "Para quem não ouviu o recado",
        origin: "builder",
        status: "active"
      })
      .select("id"),
    "Criando o fluxo"
  );
  unwrap(await db.from("communication_flow_nodes").insert({ flow_id: fluxo.id, kind: "entry" }), "Criando a entrada do fluxo");

  const now = new Date();
  await processFlows({ budgetMs: 25_000, db, facts: createFactsLoader(db, now), now, signal: new AbortController().signal });

  const passagens = unwrap(await db.from("communication_flow_runs").select("user_id,status").eq("flow_id", fluxo.id), "Lendo quem entrou");
  assert.deepEqual(passagens.map((linha) => linha.user_id).sort(), esperado);
  assert.ok(passagens.every((linha) => linha.status === "active"));
});

/* ------------------------------------------------------------------------------------------------
 * v3a (docs/24 §6): "reagiu", "votou na enquete" e "excluiu do sino", com e sem a escolha
 * ---------------------------------------------------------------------------------------------- */

const TITULO_Y = "Horário da live";
const SABADO = "a1b2c3d4";
const DOMINGO = "e5f6a7b8";
let avisoY = null;
let recebeuY = [];

/** O que o aluno fez com a linha de Y (como as rotas do sino gravam: reagir e votar tambem abrem). */
async function interagir(userId, { hidden = false, pollChoice = null, reaction = null } = {}) {
  const at = new Date(Date.now() - HORA).toISOString();
  const opened = reaction !== null || pollChoice !== null;

  unwrap(
    await db
      .from("notifications")
      .update({
        hidden_at: hidden ? at : null,
        opened_at: opened ? at : null,
        poll_choice: pollChoice,
        poll_voted_at: pollChoice ? at : null,
        reacted_at: reaction ? at : null,
        reaction,
        read_at: opened ? at : null,
        seen_at: at
      })
      .eq("campaign_id", avisoY.id)
      .eq("user_id", userId),
    "Marcando a interacao com Y"
  );
}

/** Y: enquete (Sábado / Domingo) e reacoes; a aluna vota Sábado e reage ❤️, o aluno sem acesso vota Domingo, a outra aluna exclui do sino. */
async function prepararY() {
  if (avisoY) {
    return;
  }

  avisoY = await salvarEPublicar(
    rascunho({
      poll: { closesAt: null, multiple: false, options: [{ id: SABADO, label: "Sábado" }, { id: DOMINGO, label: "Domingo" }], question: "Qual dia é melhor?", showResults: true },
      reactions: true,
      title: TITULO_Y
    })
  );
  recebeuY = await destinatarios(avisoY.id);
  await interagir(aluna.id, { pollChoice: [SABADO], reaction: "love" });
  await interagir(alunoSemAcesso.id, { pollChoice: [DOMINGO] });
  await interagir(outraAluna, { hidden: true });
}

const regraY = (action, extra = {}) => ({ kind: "rules", root: { items: [{ action, negate: false, ref: { campaignId: avisoY.id, kind: "campaign" }, type: "message", ...extra }], match: "all" } });

test("v3a: 'não votaram', 'votaram em “Sábado”', 'reagiram com ❤️' e 'excluíram do sino' contam pelas linhas do sino, na prévia com a frase", async () => {
  await prepararY();
  assert.ok(recebeuY.includes(aluna.id) && recebeuY.includes(alunoSemAcesso.id) && recebeuY.includes(outraAluna));

  const casos = [
    [regraY("voted", { negate: true }), recebeuY.filter((userId) => userId !== aluna.id && userId !== alunoSemAcesso.id), `Alunos que não votaram na enquete da notificação “${TITULO_Y}”`],
    [regraY("voted", { choice: SABADO }), [aluna.id], `Alunos que votaram em “Sábado” na enquete da notificação “${TITULO_Y}”`],
    [regraY("reacted", { choice: "love" }), [aluna.id], `Alunos que reagiram com ❤️ à notificação “${TITULO_Y}”`],
    [regraY("hidden"), [outraAluna], `Alunos que excluíram do sino a notificação “${TITULO_Y}”`]
  ];
  const fatos = await loadAudienceFacts(db, new Date(), { messageCampaignIds: [avisoY.id] });

  actAs(produtor);

  for (const [definicao, quem, frase] of casos) {
    assert.deepEqual(resolveAudienceUserIds(definicao, fatos), [...quem].sort(), frase);

    const previa = await actions.previewNoticeAudience({ audience: definicao });
    assert.equal(previa.ok, true, JSON.stringify(previa));
    assert.equal(previa.data.count, quem.length, frase);
    assert.equal(previa.data.description, frase);
  }

  const nomes = await loadAudienceNames(db, [casos[1][0]]);
  assert.deepEqual(nomes.pollOptions[`campaign:${avisoY.id}`], { [DOMINGO]: "Domingo", [SABADO]: "Sábado" });

  const opcoes = await loadAudienceNoticeOptions(db);
  const y = opcoes.find((opcao) => opcao.id === avisoY.id);
  assert.deepEqual(
    { allowsReactions: y.allowsReactions, canOpen: y.canOpen, hasPoll: y.hasPoll, pollOptions: y.pollOptions },
    { allowsReactions: true, canOpen: true, hasPoll: true, pollOptions: [{ id: SABADO, label: "Sábado" }, { id: DOMINGO, label: "Domingo" }] },
    "enquete e algo para abrir"
  );
  assert.equal(opcoes.find((opcao) => opcao.id === avisoX.id).allowsReactions, true, "X e nova: reacoes ligadas");
});

test("v3a: a publicação e o envio agendado que o tick faz saem para os mesmos alunos", async () => {
  await prepararY();
  const naoVotaram = regraY("voted", { negate: true });
  const esperadoNaoVotaram = recebeuY.filter((userId) => userId !== aluna.id && userId !== alunoSemAcesso.id);

  const publicado = await salvarEPublicar(rascunho({ audience: naoVotaram, title: "Ainda dá tempo de votar" }));
  assert.deepEqual(await destinatarios(publicado.id), esperadoNaoVotaram);
  assert.equal((await getNoticeDetail(publicado.id)).audienceDescription, `Alunos que não votaram na enquete da notificação “${TITULO_Y}”`);

  const agendado = await salvarEPublicar(
    rascunho({ audience: regraY("voted", { choice: SABADO }), schedule: { mode: "at", sendAt: new Date(Date.now() + HORA).toISOString() }, title: "Sábado, então!" })
  );
  unwrap(await db.from("campaigns").update({ send_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", agendado.id), "Adiantando o envio");
  await processCommunications({ db });
  assert.deepEqual(await destinatarios(agendado.id), [aluna.id]);
});

test("v3a: o recálculo do pop-up segue 'excluíram do sino' (Desfazer tira) e a entrada do fluxo segue 'reagiram com ❤️'", async () => {
  await prepararY();
  const popup = await salvarEPublicar({ ...emptyNoticeDraft("popup"), audience: regraY("hidden"), body: "Quer ver de novo?", title: "A live é no sábado" });
  const elegiveis = async () =>
    unwrap(await db.from("campaign_deliveries").select("user_id").eq("campaign_id", popup.id).eq("eligible", true), "Lendo o pop-up")
      .map((linha) => linha.user_id)
      .sort();

  assert.deepEqual(await elegiveis(), [outraAluna]);

  // A outra aluna toca em Desfazer (hidden_at volta a null): o recalculo seguinte tira o pop-up dela.
  await interagir(outraAluna, {});
  unwrap(await db.from("campaigns").update({ audience_refreshed_at: new Date(Date.now() - HORA).toISOString() }).eq("id", popup.id), "Envelhecendo o recalculo");

  try {
    await processCommunications({ db });
    assert.deepEqual(await elegiveis(), []);
  } finally {
    await interagir(outraAluna, { hidden: true });
  }

  const [fluxo] = unwrap(
    await db
      .from("communication_flows")
      .insert({
        activated_at: new Date().toISOString(),
        created_by: produtor.id,
        entry_audience: regraY("reacted", { choice: "love" }),
        entry_mode: "current",
        name: "Para quem amou a live",
        origin: "builder",
        status: "active"
      })
      .select("id"),
    "Criando o fluxo"
  );
  unwrap(await db.from("communication_flow_nodes").insert({ flow_id: fluxo.id, kind: "entry" }), "Criando a entrada do fluxo");

  const now = new Date();
  await processFlows({ budgetMs: 25_000, db, facts: createFactsLoader(db, now), now, signal: new AbortController().signal });

  const passagens = unwrap(await db.from("communication_flow_runs").select("user_id").eq("flow_id", fluxo.id), "Lendo quem entrou");
  assert.deepEqual(passagens.map((linha) => linha.user_id), [aluna.id]);
});
