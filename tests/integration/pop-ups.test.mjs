import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, limparComunicacao, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Pop-ups da home (docs/22 §4; docs/17 §1.8.1) contra o banco LOCAL de verdade: o produtor publica pelas
// Server Actions; a aluna pede o resumo do sino com ?popup=1 e registra os eventos pela rota (como o
// navegador faria, inclusive com o corpo em text/plain do sendBeacon). Limites fixos: no maximo 1 a cada
// 24 h; "Uma vez" some depois de visto; "Até o aluno clicar" volta no dia seguinte; "Lembrar depois" ate
// 2 vezes; "Não mostrar de novo" e para sempre. A equipe e quem esta fora do segmento nunca veem.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/communications/actions.ts");
const { emptyNoticeDraft } = await import("../../src/server/communications/schemas.ts");
const { getNoticeDetail } = await import("../../src/server/communications/queries.ts");
const { processCommunications } = await import("../../src/server/communications/dispatch.ts");
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
after(limparTudo);

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
