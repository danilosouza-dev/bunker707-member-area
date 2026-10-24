import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import {
  apagarContaDeTeste,
  ESCOLA_DE_TESTE,
  limparComunicacao,
  SENHA_DE_TESTE,
  seedEscolaDeTeste,
  usuarioDeTeste
} from "../fixtures/escola-de-teste.mjs";

// Pop-ups da home (docs/22 §1.3 e §4.3; docs/17 §1.8.1) contra o banco LOCAL de verdade: o produtor publica pelas
// Server Actions; a aluna pede o resumo do sino com ?popup=1 e registra os eventos pela rota (como o
// navegador faria, inclusive com o corpo em text/plain do sendBeacon). Limites fixos: no maximo 1 a cada
// 24 h; "Uma vez" some depois de visto (cada "Lembrar depois" vale mais uma vez); "Até o aluno clicar"
// volta no dia seguinte; "Lembrar depois" ate 2 vezes; "Não mostrar de novo" e para sempre (inclusive
// depois da retencao de 24 meses, enquanto o pop-up esta no ar). A equipe e quem esta fora do segmento
// nunca veem. Editar o pop-up no ar vale como publicar (docs/22 §2.3), e o recalculo do job nunca grava
// por cima de uma mudanca de segmento feita no meio dele.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/communications/actions.ts");
const { emptyNoticeDraft } = await import("../../src/server/communications/schemas.ts");
const { getNoticeDetail } = await import("../../src/server/communications/queries.ts");
const { processCommunications, refreshPopupDeliveries } = await import("../../src/server/communications/dispatch.ts");
const { CAMPAIGN_COLUMNS } = await import("../../src/server/communications/store.ts");
const summaryRoute = await import("../../src/app/api/notifications/summary/route.ts");
const eventsRoute = await import("../../src/app/api/popups/[id]/events/route.ts");

const { curso } = ESCOLA_DE_TESTE;
const aluna = usuarioDeTeste(contas.aluna);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);
const produtor = usuarioDeTeste(contas.produtor);
const professor = usuarioDeTeste(contas.professor);
const analista = usuarioDeTeste(contas.analista);
const HORA = 60 * 60 * 1000;
const ACESSO_TEMPORARIO = "teste-comunicacao:sem-acesso:curso-agentes";

const quemTemOCurso = { kind: "rules", root: { items: [{ op: "has", productIds: [curso.id], type: "product" }], match: "all" } };

// Equipe com funcoes personalizadas: uma so cria avisos; a outra tambem publica, mas nao para mais de 500.
const REDATORA = { acoes: ["messaging.write"], email: "redatora.popups@bunker707.test", nome: "Redatora de Pop-ups" };
const EDITORA = { acoes: ["messaging.write", "messaging.publish"], email: "editora.popups@bunker707.test", nome: "Editora de Pop-ups" };

async function criarEquipe(pessoa) {
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let user = data?.users.find((item) => item.email === pessoa.email);

  if (!user) {
    user = unwrap(
      await db.auth.admin.createUser({ email: pessoa.email, email_confirm: true, password: SENHA_DE_TESTE, user_metadata: { full_name: pessoa.nome } }),
      `Criando ${pessoa.nome}`
    ).user;
  }

  unwrap(
    await db.from("admin_roles").upsert({ permissions: { actions: pessoa.acoes }, role: "custom", user_id: user.id }, { onConflict: "user_id" }),
    "Dando a funcao personalizada"
  );

  return usuarioDeTeste({ email: pessoa.email, id: user.id, nome: pessoa.nome });
}

function popup(extra = {}) {
  return {
    ...emptyNoticeDraft("popup"),
    audience: quemTemOCurso,
    body: "A turma nova começa segunda.",
    cta: { href: `/conteudo/${curso.id}`, label: "Ver o curso", target: "same_tab" },
    title: "Turma nova",
    ...extra
  };
}

async function limparTudo() {
  await limparComunicacao(db);
  unwrap(await db.from("entitlements").delete().eq("source_event_id", ACESSO_TEMPORARIO), "Tirando o acesso temporario");
}

before(limparTudo);
after(async () => {
  await limparTudo();
  await apagarContaDeTeste(db, REDATORA.email);
  await apagarContaDeTeste(db, EDITORA.email);
});

async function publicar(draft) {
  actAs(produtor);
  const salvo = await actions.saveNoticeDraft({ draft });
  assert.equal(salvo.ok, true, JSON.stringify(salvo));
  const publicado = await actions.publishNotice({ expectedUpdatedAt: salvo.data.updatedAt, id: salvo.data.id });
  assert.equal(publicado.ok, true, JSON.stringify(publicado));

  return publicado.data;
}

async function popupDe(user, query = "?popup=1") {
  actAs(user);
  const response = await summaryRoute.GET(new Request(`http://localhost/api/notifications/summary${query}`));
  assert.equal(response.status, 200);

  return (await response.json()).data.popup;
}

/** Evento como o navegador manda no sendBeacon: corpo JSON em text/plain. */
async function evento(user, id, event) {
  actAs(user);
  const response = await eventsRoute.POST(
    new Request(`http://localhost/api/popups/${id}/events`, {
      body: JSON.stringify({ event }),
      headers: { "content-type": "text/plain;charset=UTF-8" },
      method: "POST"
    }),
    { params: Promise.resolve({ id }) }
  );

  return { body: await response.json(), status: response.status };
}

async function entrega(campaignId, userId) {
  const [linha] = unwrap(
    await db
      .from("campaign_deliveries")
      .select("eligible,impressions,first_seen_at,last_seen_at,clicked_at,dismissed_at,snoozed_until,snooze_count")
      .eq("campaign_id", campaignId)
      .eq("user_id", userId),
    "Lendo o pop-up do aluno"
  );

  return linha ?? null;
}

/** Passaram `horas` desde o ultimo pop-up visto (e do "Lembrar depois"): o teste volta o relogio das linhas. */
async function passaram(userId, horas) {
  const linhas = unwrap(
    await db.from("campaign_deliveries").select("campaign_id,first_seen_at,last_seen_at,snoozed_until").eq("user_id", userId),
    "Lendo os pop-ups do aluno"
  );
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

const estado = {};

test("pop-up publicado aparece no resumo da aluna; nao aparece para quem esta fora do segmento nem para a equipe; sem ?popup=1 nao vem", async () => {
  const publicado = await publicar(popup());
  estado.id = publicado.id;
  assert.equal(publicado.situation, "active");
  assert.ok(publicado.audienceCount >= 1);

  const visto = await popupDe(aluna);
  assert.deepEqual(visto, {
    audio: null,
    body: "A turma nova começa segunda.",
    canSnooze: true,
    cta: { href: `/conteudo/${curso.id}`, label: "Ver o curso", target: "same_tab" },
    id: publicado.id,
    image: null,
    title: "Turma nova"
  });
  assert.equal(await popupDe(aluna, ""), null, "o sino comum nao pede pop-up");

  for (const pessoa of [alunoSemAcesso, produtor, professor, analista]) {
    assert.equal(await popupDe(pessoa), null, `${pessoa.email} nao ve`);
  }

  const equipe = unwrap(
    await db.from("campaign_deliveries").select("user_id").eq("campaign_id", publicado.id).in("user_id", [produtor.id, professor.id, analista.id]),
    "Lendo a equipe"
  );
  assert.deepEqual(equipe, [], "a equipe nunca entra na lista de quem ve");
});

test("visto uma vez: some por 24 h; 'Uma vez' nao volta nem no dia seguinte; editado para 'Até o aluno clicar' volta depois de 24 h", async () => {
  const impressao = await evento(aluna, estado.id, "impressed");
  assert.equal(impressao.status, 200, JSON.stringify(impressao.body));
  const linha = await entrega(estado.id, aluna.id);
  assert.equal(linha.impressions, 1);
  assert.ok(linha.first_seen_at && linha.last_seen_at);

  assert.equal(await popupDe(aluna), null, "no maximo 1 pop-up a cada 24 h");
  await passaram(aluna.id, 25);
  assert.equal(await popupDe(aluna), null, "'Uma vez' ja foi visto");

  actAs(produtor);
  const detalhe = await getNoticeDetail(estado.id);
  const editado = await actions.saveNoticeDraft({ draft: { ...detalhe.draft, repeat: "until_action" }, expectedUpdatedAt: detalhe.updatedAt, id: estado.id });
  assert.equal(editado.ok, true, JSON.stringify(editado));
  assert.equal(editado.data.status, "active", "editar o pop-up no ar nao tira do ar");

  assert.equal((await popupDe(aluna))?.id, estado.id, "volta no dia seguinte enquanto a aluna nao clicar");
  await evento(aluna, estado.id, "impressed");
  assert.equal(await popupDe(aluna), null, "e some de novo por 24 h");
});

test("'Lembrar depois' duas vezes; a terceira e recusada (409) e o pop-up deixa de oferecer a opcao", async () => {
  await passaram(aluna.id, 25);
  assert.equal((await popupDe(aluna))?.canSnooze, true);

  assert.equal((await evento(aluna, estado.id, "snoozed")).status, 200);
  assert.equal(await popupDe(aluna), null, "lembrar depois = 24 h sem o pop-up");
  await passaram(aluna.id, 25);
  assert.equal((await popupDe(aluna))?.canSnooze, true, "ainda pode lembrar depois mais uma vez");

  assert.equal((await evento(aluna, estado.id, "snoozed")).status, 200);
  await passaram(aluna.id, 25);
  const depois = await popupDe(aluna);
  assert.equal(depois?.canSnooze, false, "depois de 2 vezes, so fechar ou clicar");

  const terceira = await evento(aluna, estado.id, "snoozed");
  assert.equal(terceira.status, 409);
  assert.equal(terceira.body.error, "Não dá para lembrar depois de novo.");
  assert.equal((await entrega(estado.id, aluna.id)).snooze_count, 2);
});

test("'Não mostrar de novo' e para sempre; evento invalido e 400; quem nao esta no segmento recebe 404", async () => {
  assert.equal((await evento(aluna, estado.id, "dismissed")).status, 200);
  await passaram(aluna.id, 72);
  assert.equal(await popupDe(aluna), null);
  assert.ok((await entrega(estado.id, aluna.id)).dismissed_at);

  assert.equal((await evento(aluna, estado.id, "talvez")).status, 400);
  assert.equal((await evento(aluna, "nao-e-id", "closed")).status, 400);
  assert.equal((await evento(alunoSemAcesso, estado.id, "impressed")).status, 404);

  const eventos = unwrap(
    await db.from("student_events").select("event_type").eq("user_id", aluna.id).eq("entity_id", estado.id),
    "Lendo eventos do pop-up"
  );
  const tipos = new Set(eventos.map((linha) => linha.event_type));
  for (const tipo of ["message_impressed", "message_snoozed", "message_dismissed"]) {
    assert.ok(tipos.has(tipo), tipo);
  }

  actAs(produtor);
  const detalhe = await getNoticeDetail(estado.id);
  assert.equal(detalhe.stats.dismissed, 1);
  assert.equal(detalhe.stats.snoozed, 1);
  assert.equal(detalhe.stats.seen, 1);
  assert.equal(detalhe.stats.closedWithoutClick, 1);
});

test("pausar tira da home, retomar volta e encerrar tira de vez (evento depois de encerrado e 404)", async () => {
  await limparComunicacao(db);
  const publicado = await publicar(popup({ title: "Pausa e encerra" }));
  assert.equal((await popupDe(aluna))?.id, publicado.id);

  actAs(produtor);
  const pausado = await actions.pauseNotice({ id: publicado.id });
  assert.equal(pausado.ok, true, JSON.stringify(pausado));
  assert.equal(pausado.data.situation, "paused");
  assert.equal(await popupDe(aluna), null);

  actAs(produtor);
  const retomado = await actions.resumeNotice({ expectedUpdatedAt: pausado.data.updatedAt, id: publicado.id });
  assert.equal(retomado.ok, true, JSON.stringify(retomado));
  assert.equal((await popupDe(aluna))?.id, publicado.id);

  actAs(produtor);
  const encerrado = await actions.endNotice({ id: publicado.id });
  assert.equal(encerrado.ok, true, JSON.stringify(encerrado));
  assert.equal(encerrado.data.situation, "ended");
  assert.equal(await popupDe(aluna), null);
  assert.equal((await evento(aluna, publicado.id, "clicked")).status, 404);

  actAs(produtor);
  const excluido = await actions.deleteNotice({ id: publicado.id });
  assert.equal(excluido.ok, true, "encerrado pode ser excluido");
});

test("janela no futuro: o pop-up publicado fica agendado e nao aparece antes de comecar", async () => {
  await limparComunicacao(db);
  const comeca = new Date(Date.now() + 2 * HORA).toISOString();
  const publicado = await publicar(popup({ title: "Começa depois", window: { endsAt: null, startsAt: comeca } }));
  assert.equal(publicado.situation, "scheduled");
  assert.ok(await entrega(publicado.id, aluna.id), "a lista de quem vai ver ja esta pronta");
  assert.equal(await popupDe(aluna), null);

  actAs(produtor);
  const fimNoPassado = await actions.saveNoticeDraft({
    draft: popup({ title: "Começa depois", window: { endsAt: new Date(Date.now() - HORA).toISOString(), startsAt: null } }),
    id: publicado.id
  });
  assert.equal(fimNoPassado.status, 400, "pop-up no ar nao recebe um fim que ja passou");
  assert.deepEqual(fimNoPassado.fieldErrors?.["window.endsAt"], ["Escolha um fim no futuro."]);
});

test("o job do tick recalcula o segmento do pop-up no ar: quem passou a ter o curso comeca a ver; quem perdeu o acesso deixa de ver", async () => {
  await limparComunicacao(db);
  const publicado = await publicar(popup({ title: "Para quem tem o curso" }));
  assert.equal(await popupDe(alunoSemAcesso), null);

  unwrap(
    await db.from("entitlements").insert({
      ends_at: null,
      source_event_id: ACESSO_TEMPORARIO,
      source_provider: "manual",
      starts_at: new Date(Date.now() - HORA).toISOString(),
      status: "active",
      target_id: curso.id,
      target_type: "standalone_course",
      user_id: alunoSemAcesso.id
    }),
    "Liberando o curso"
  );
  // Recalculo vencido (o job recalcula a cada 15 minutos).
  unwrap(await db.from("campaigns").update({ audience_refreshed_at: new Date(Date.now() - HORA).toISOString() }).eq("id", publicado.id), "Envelhecendo o recalculo");
  const versao = (await getNoticeDetail(publicado.id)).updatedAt;

  const rodada = await processCommunications({ db });
  assert.ok(rodada.refreshed >= 1, JSON.stringify(rodada));
  assert.equal((await entrega(publicado.id, alunoSemAcesso.id))?.eligible, true);
  assert.equal((await popupDe(alunoSemAcesso))?.id, publicado.id);
  assert.equal((await getNoticeDetail(publicado.id)).updatedAt, versao, "o recalculo nao muda a versao do editor");

  unwrap(await db.from("entitlements").delete().eq("source_event_id", ACESSO_TEMPORARIO), "Tirando o curso");
  unwrap(await db.from("campaigns").update({ audience_refreshed_at: new Date(Date.now() - HORA).toISOString() }).eq("id", publicado.id), "Envelhecendo o recalculo");
  await processCommunications({ db });
  assert.equal((await entrega(publicado.id, alunoSemAcesso.id))?.eligible, false);
  assert.equal(await popupDe(alunoSemAcesso), null);

  await processCommunications({ db });
  assert.equal((await entrega(publicado.id, alunoSemAcesso.id))?.eligible, false, "recalculo recente: nada muda ate vencer");
});

test("'Uma vez' com 'Lembrar depois': volta quando o lembrete vence e some depois de visto de novo", async () => {
  await limparComunicacao(db);
  const publicado = await publicar(popup({ title: "Uma vez com lembrete" }));
  assert.equal((await popupDe(aluna))?.id, publicado.id);

  await evento(aluna, publicado.id, "impressed");
  assert.equal((await evento(aluna, publicado.id, "snoozed")).status, 200);
  assert.equal(await popupDe(aluna), null, "lembrar depois = 24 h sem o pop-up");

  await passaram(aluna.id, 25);
  assert.equal((await popupDe(aluna))?.id, publicado.id, "o lembrete venceu: o 'Uma vez' volta");

  await evento(aluna, publicado.id, "impressed");
  await evento(aluna, publicado.id, "closed");
  await passaram(aluna.id, 25);
  assert.equal(await popupDe(aluna), null, "visto de novo e fechado sem lembrar: some");
});

test("editar o pop-up no ar vale como publicar: quem so cria avisos recebe 403; acima de 500 alunos, so dono ou administrador", async () => {
  await limparComunicacao(db);
  const publicado = await publicar(popup({ title: "Pop-up no ar" }));
  const redatora = await criarEquipe(REDATORA);
  const editora = await criarEquipe(EDITORA);
  actAs(produtor);
  const detalhe = await getNoticeDetail(publicado.id);
  const editar = (user, titulo, versao) => {
    actAs(user);
    return actions.saveNoticeDraft({ draft: { ...detalhe.draft, title: titulo }, expectedUpdatedAt: versao, id: publicado.id });
  };

  const daRedatora = await editar(redatora, "Pela redatora", detalhe.updatedAt);
  assert.equal(daRedatora.status, 403);
  assert.equal(daRedatora.error, "Só quem pode publicar muda um pop-up no ar. Duplique para criar outro.");

  const daEditora = await editar(editora, "Pela editora", detalhe.updatedAt);
  assert.equal(daEditora.ok, true, JSON.stringify(daEditora));
  assert.equal(daEditora.data.status, "active");

  // O segmento cresceu para 600 alunos desde a publicacao (o recalculo do job grava a contagem nova).
  unwrap(await db.from("campaigns").update({ audience_count: 600 }).eq("id", publicado.id), "Fazendo o segmento crescer");
  const acima = await editar(editora, "Para muitos", daEditora.data.updatedAt);
  assert.equal(acima.status, 403);
  assert.equal(acima.error, "Para mudar um pop-up no ar para este segmento, peça a um dono ou administrador.");

  const doDono = await editar(produtor, "Pelo dono", daEditora.data.updatedAt);
  assert.equal(doDono.ok, true, JSON.stringify(doDono));
  const [linha] = unwrap(await db.from("campaigns").select("title,status").eq("id", publicado.id), "Lendo o pop-up");
  assert.deepEqual(linha, { status: "active", title: "Pelo dono" });

  // O menu so oferece Editar no pop-up no ar para quem pode publicar.
  actAs(produtor);
  assert.ok(!(await getNoticeDetail(publicado.id, { permissions: { canPublish: false, canPublishLarge: false, canWrite: true } })).actions.includes("edit"));
  assert.ok((await getNoticeDetail(publicado.id, { permissions: { canPublish: true, canPublishLarge: false, canWrite: true } })).actions.includes("edit"));

  // Retomar recoloca no ar para o segmento de agora (aqui, poucos alunos): quem publica retoma.
  actAs(produtor);
  const pausado = await actions.pauseNotice({ id: publicado.id });
  assert.equal(pausado.ok, true, JSON.stringify(pausado));
  actAs(redatora);
  assert.equal((await actions.resumeNotice({ id: publicado.id })).status, 403);
  actAs(editora);
  const velha = await actions.resumeNotice({ expectedUpdatedAt: daEditora.data.updatedAt, id: publicado.id });
  assert.equal(velha.status, 409, "versao velha da tela");
  actAs(editora);
  const retomado = await actions.resumeNotice({ expectedUpdatedAt: pausado.data.updatedAt, id: publicado.id });
  assert.equal(retomado.ok, true, JSON.stringify(retomado));
  assert.equal(retomado.data.situation, "active");
});

test("recalculo do job que comecou antes de uma mudanca de segmento nao grava por cima: a hora fica vazia e o minuto seguinte acerta", async () => {
  await limparComunicacao(db);
  const publicado = await publicar(popup({ title: "Segmento muda no meio" }));
  // O job leu o pop-up aqui (segmento antigo)...
  const [lidaPeloJob] = unwrap(await db.from("campaigns").select(CAMPAIGN_COLUMNS).eq("id", publicado.id), "Lendo como o job");

  // ...e a equipe muda o segmento para todos os alunos antes de ele terminar.
  actAs(produtor);
  const detalhe = await getNoticeDetail(publicado.id);
  const mudou = await actions.saveNoticeDraft({ draft: { ...detalhe.draft, audience: { kind: "everyone" } }, expectedUpdatedAt: detalhe.updatedAt, id: publicado.id });
  assert.equal(mudou.ok, true, JSON.stringify(mudou));
  assert.equal((await entrega(publicado.id, alunoSemAcesso.id))?.eligible, true, "todos os alunos: quem nao tem o curso passa a ver");

  await refreshPopupDeliveries({ campaign: lidaPeloJob, db });
  const [depois] = unwrap(await db.from("campaigns").select("audience,audience_refreshed_at").eq("id", publicado.id), "Lendo o pop-up");
  assert.equal(depois.audience.kind, "everyone", "o segmento novo fica");
  assert.equal(depois.audience_refreshed_at, null, "sem hora do recalculo: o job do minuto seguinte refaz");

  await processCommunications({ db });
  assert.equal((await entrega(publicado.id, alunoSemAcesso.id))?.eligible, true, "o minuto seguinte refaz com o segmento atual");
  const [refeito] = unwrap(await db.from("campaigns").select("audience_refreshed_at").eq("id", publicado.id), "Lendo o pop-up");
  assert.ok(refeito.audience_refreshed_at);
});

test("retencao de 24 meses: o estado de quem ja viu um pop-up ainda no ar fica; o de pop-up encerrado sai", async () => {
  await limparComunicacao(db);
  const noAr = await publicar(popup({ title: "No ar há muito tempo" }));
  const encerrado = await publicar(popup({ title: "Encerrado há muito tempo" }));
  actAs(produtor);
  assert.equal((await actions.endNotice({ id: encerrado.id })).ok, true);

  // A aluna escolheu "Não mostrar de novo" ha 25 meses (a linha nao mudou desde entao).
  const ha25Meses = new Date(Date.now() - 25 * 31 * 24 * HORA).toISOString();

  for (const id of [noAr.id, encerrado.id]) {
    unwrap(await db.from("campaign_deliveries").delete().eq("campaign_id", id).eq("user_id", aluna.id), "Tirando a linha nova");
    unwrap(
      await db.from("campaign_deliveries").insert({
        campaign_id: id,
        created_at: ha25Meses,
        dismissed_at: ha25Meses,
        eligible: true,
        first_seen_at: ha25Meses,
        impressions: 1,
        last_seen_at: ha25Meses,
        updated_at: ha25Meses,
        user_id: aluna.id
      }),
      "Gravando a linha antiga"
    );
  }

  const resultado = unwrap(await db.rpc("prune_communication_history"), "Rodando a retencao");
  assert.ok(resultado.campaign_deliveries >= 1, JSON.stringify(resultado));
  assert.ok((await entrega(noAr.id, aluna.id))?.dismissed_at, "pop-up no ar guarda o 'Não mostrar de novo'");
  assert.equal(await entrega(encerrado.id, aluna.id), null, "pop-up encerrado: o estado antigo sai");

  await processCommunications({ db });
  assert.equal(await popupDe(aluna), null, "o recalculo nao recria a linha e o pop-up nao volta");
});

