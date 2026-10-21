import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

// Sino do aluno na Comunicacao v2 (docs/23; docs/18 §3) contra o banco LOCAL de verdade: quanto tempo cada
// notificacao fica no sino (expires_at: some da lista, dos numeros, do "Marcar todas" e do "abriu o
// sino"; clique, resposta e audio nela sao 404), o "abriu" de verdade (opened_at: o cartao abre,
// "Marcar todas" nao), quem envia resolvido na leitura (quem sai da equipe vira a escola), o icone ao
// lado do titulo, o audio ouvido (48 trechos somados por OU, 44 = ouvido) pela rota nova e a folga de
// 15 s das linhas de fluxo no "abriu o sino". As rotas do aluno sao chamadas como funcao.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/communications/actions.ts");
const { emptyNoticeDraft } = await import("../../src/server/communications/schemas.ts");
const notificationsRoute = await import("../../src/app/api/notifications/route.ts");
const summaryRoute = await import("../../src/app/api/notifications/summary/route.ts");
const readRoute = await import("../../src/app/api/notifications/read/route.ts");
const clickRoute = await import("../../src/app/api/notifications/[id]/click/route.ts");
const responseRoute = await import("../../src/app/api/notifications/[id]/response/route.ts");
const audioRoute = await import("../../src/app/api/notifications/[id]/audio/route.ts");

const { curso } = ESCOLA_DE_TESTE;
const aluna = usuarioDeTeste(contas.aluna);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);
const produtor = usuarioDeTeste(contas.produtor);

// Pessoa da equipe usada como "Quem envia" (sai da equipe no meio do teste).
const REMETENTE = { email: "remetente.sino@bunker707.test", nome: "Prof. Carlos Lima" };

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
const NADA = "0".repeat(48);
const TUDO = "1".repeat(48);
const trechos = (inicio, fim) => Array.from({ length: 48 }, (_, index) => (index >= inicio && index < fim ? "1" : "0")).join("");

const quemTemOCurso = { kind: "rules", root: { items: [{ op: "has", productIds: [curso.id], type: "product" }], match: "all" } };
const AUDIO = { durationSeconds: 48, mimeType: "audio/mpeg", peaks: [], url: "https://midia.bunker707.test/avisos/audio-do-teste.mp3" };

function rascunho(extra = {}) {
  return { ...emptyNoticeDraft("inbox"), audience: quemTemOCurso, body: "Texto curto do aviso.", title: "Aviso do sino", ...extra };
}

async function criarRemetente() {
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let user = data?.users.find((item) => item.email === REMETENTE.email);

  if (!user) {
    user = unwrap(
      await db.auth.admin.createUser({ email: REMETENTE.email, email_confirm: true, password: SENHA_DE_TESTE, user_metadata: { full_name: REMETENTE.nome } }),
      "Criando o remetente"
    ).user;
  }

  unwrap(await db.from("admin_roles").upsert({ permissions: {}, role: "editor", user_id: user.id }, { onConflict: "user_id" }), "Pondo o remetente na equipe");
  unwrap(
    await db.from("profiles").upsert({ avatar_url: null, email: REMETENTE.email, full_name: REMETENTE.nome, id: user.id }, { onConflict: "id" }),
    "Perfil do remetente"
  );

  return usuarioDeTeste({ ...REMETENTE, id: user.id });
}

before(async () => {
  await limparComunicacao(db);
});

after(async () => {
  await limparComunicacao(db);
  await apagarContaDeTeste(db, REMETENTE.email);
});

/* ------------------------------------------------------------------------------------------------
 * Apoio: rotas do aluno chamadas como funcao
 * ---------------------------------------------------------------------------------------------- */

async function sino(user) {
  actAs(user);
  const response = await notificationsRoute.GET(new Request("http://localhost/api/notifications"));
  const body = await response.json();

  assert.equal(response.status, 200, JSON.stringify(body));

  return body.data;
}

async function resumo(user, query = "") {
  actAs(user);
  const response = await summaryRoute.GET(new Request(`http://localhost/api/notifications/summary${query}`));

  assert.equal(response.status, 200);

  return (await response.json()).data;
}

async function marcar(user, payload) {
  actAs(user);
  const response = await readRoute.POST(
    new Request("http://localhost/api/notifications/read", { body: JSON.stringify(payload), headers: { "content-type": "application/json" }, method: "POST" })
  );

  return { body: await response.json(), status: response.status };
}

async function clicar(user, id) {
  actAs(user);
  const response = await clickRoute.POST(new Request(`http://localhost/api/notifications/${id}/click`, { method: "POST" }), { params: Promise.resolve({ id }) });

  return response.status;
}

async function responder(user, id, value) {
  actAs(user);
  const response = await responseRoute.POST(
    new Request(`http://localhost/api/notifications/${id}/response`, {
      body: JSON.stringify({ response: value }),
      headers: { "content-type": "application/json" },
      method: "POST"
    }),
    { params: Promise.resolve({ id }) }
  );

  return { body: await response.json(), status: response.status };
}

/** Audio do aviso; `texto` manda como o beacon (JSON em text/plain). */
async function ouvir(user, id, payload, { texto = false, bruto } = {}) {
  actAs(user);
  const response = await audioRoute.POST(
    new Request(`http://localhost/api/notifications/${id}/audio`, {
      body: bruto ?? JSON.stringify(payload),
      headers: { "content-type": texto ? "text/plain;charset=UTF-8" : "application/json" },
      method: "POST"
    }),
    { params: Promise.resolve({ id }) }
  );

  return { body: await response.json(), status: response.status };
}

async function publicar(draft, user = produtor) {
  actAs(user);
  const salvo = await actions.saveNoticeDraft({ draft });
  assert.equal(salvo.ok, true, JSON.stringify(salvo));
  const publicado = await actions.publishNotice({ expectedUpdatedAt: salvo.data.updatedAt, id: salvo.data.id });
  assert.equal(publicado.ok, true, JSON.stringify(publicado));

  return publicado.data;
}

/** A linha da aluna (ou de outra pessoa) no sino de um aviso. */
async function linhaDe(campaignId, userId = aluna.id) {
  const [linha] = unwrap(
    await db
      .from("notifications")
      .select("id,created_at,expires_at,seen_at,read_at,opened_at,clicked_at,audio_started_at,audio_heard,audio_heard_percent,audio_completed_at")
      .eq("campaign_id", campaignId)
      .eq("user_id", userId),
    "Lendo a notificacao"
  );

  assert.ok(linha, `sem linha do aviso ${campaignId}`);

  return linha;
}

async function eventosDe(eventType, notificationId) {
  return unwrap(
    await db.from("student_events").select("event_type,entity_id,metadata").eq("event_type", eventType).eq("entity_id", notificationId),
    "Lendo eventos"
  );
}

const doAviso = (pagina, titulo) => pagina.items.find((item) => item.kind === "notice" && item.title === titulo);

/* ------------------------------------------------------------------------------------------------
 * O que o GET devolve
 * ---------------------------------------------------------------------------------------------- */

test("o sino devolve o icone, o fim no sino e o ouvido do audio; a escola nao tem quem envia; o pop-up traz o icone so quando tem", async () => {
  const publicado = await publicar(rascunho({ audio: AUDIO, icon: { color: "red", id: "promo" }, title: "Promoção com áudio" }));
  const semNada = await publicar(rascunho({ title: "Aviso sem ícone" }));

  const pagina = await sino(aluna);
  const item = doAviso(pagina, "Promoção com áudio");
  assert.ok(item, JSON.stringify(pagina));
  assert.deepEqual(item.icon, { color: "red", id: "promo" });
  assert.equal(item.actor, null, "a escola envia");
  assert.equal(item.openedAt, null);
  assert.deepEqual(item.audioProgress, { completed: false, heard: NADA, percent: 0 });
  // Sem escolha: 90 dias depois de chegar.
  const vida = Date.parse(item.expiresAt) - Date.parse(item.createdAt);
  assert.ok(Math.abs(vida - 90 * DIA) < MINUTO, `fica ${vida} ms`);

  const simples = doAviso(pagina, "Aviso sem ícone");
  assert.equal(simples.icon, null);
  assert.equal(simples.audioProgress, null, "sem audio, nada de ouvido");
  assert.ok(simples.expiresAt);

  assert.equal((await linhaDe(publicado.id)).opened_at, null);
  assert.ok(semNada.id);

  const comIcone = await publicar({ ...emptyNoticeDraft("popup"), audience: quemTemOCurso, icon: { color: "amber", id: "calendar" }, title: "Pop-up com ícone" });
  const popup = (await resumo(aluna, "?popup=1")).popup;
  assert.equal(popup?.id, comIcone.id, JSON.stringify(popup));
  assert.deepEqual(popup.icon, { color: "amber", id: "calendar" });

  // Sem icone, a chave nem vem (o resumo da v1 fica igual).
  unwrap(await db.from("campaigns").update({ icon: null, icon_color: null }).eq("id", comIcone.id), "Tirando o icone do pop-up");
  const semIcone = (await resumo(aluna, "?popup=1")).popup;
  assert.equal(semIcone?.id, comIcone.id);
  assert.equal(Object.hasOwn(semIcone, "icon"), false);
  unwrap(await db.from("campaigns").update({ deleted_at: new Date().toISOString() }).eq("id", comIcone.id), "Tirando o pop-up do ar");
});

/* ------------------------------------------------------------------------------------------------
 * Audio ouvido
 * ---------------------------------------------------------------------------------------------- */

test("audio: started marca vista, lida e aberta e devolve os contadores; progress soma por OU e so cresce; 44 trechos = ouvido com um evento", async () => {
  const publicado = await publicar(rascunho({ audio: AUDIO, title: "Recado em áudio" }));
  const linha = await linhaDe(publicado.id);
  const antes = await sino(aluna);

  const comecou = await ouvir(aluna, linha.id, { event: "started" });
  assert.equal(comecou.status, 200, JSON.stringify(comecou.body));
  assert.deepEqual(comecou.body.data.audioProgress, { completed: false, heard: NADA, percent: 0 });
  assert.equal(comecou.body.data.unread, antes.unread - 1, "a notificacao foi lida");
  assert.equal(typeof comecou.body.data.unseen, "number");

  const depois = await linhaDe(publicado.id);
  assert.ok(depois.seen_at && depois.read_at && depois.opened_at && depois.audio_started_at, JSON.stringify(depois));
  assert.equal(depois.audio_heard, NADA);
  assert.equal(depois.audio_completed_at, null);

  // De novo (outro aparelho): nada muda e nao ha segundo evento.
  assert.equal((await ouvir(aluna, linha.id, { event: "started" })).status, 200);
  assert.equal((await eventosDe("notification_audio_started", linha.id)).length, 1);
  assert.equal((await eventosDe("notification_audio_started", linha.id))[0].metadata.campaign_id, publicado.id);

  // Metade hoje (pelo beacon: JSON em text/plain)...
  const metade = await ouvir(aluna, linha.id, { event: "progress", heard: trechos(0, 20) }, { texto: true });
  assert.equal(metade.status, 200, JSON.stringify(metade.body));
  assert.deepEqual(metade.body.data, { audioProgress: { completed: false, heard: trechos(0, 20), percent: 41 } }, "progress nao devolve contadores");

  // ...e o resto amanha, em outro aparelho: soma por OU.
  const resto = await ouvir(aluna, linha.id, { event: "progress", heard: trechos(15, 30) });
  assert.deepEqual(resto.body.data.audioProgress, { completed: false, heard: trechos(0, 30), percent: 62 });

  // Uma mascara menor nunca apaga o que ja foi ouvido.
  const menor = await ouvir(aluna, linha.id, { event: "progress", heard: NADA });
  assert.deepEqual(menor.body.data.audioProgress, { completed: false, heard: trechos(0, 30), percent: 62 });

  const ouvido = await ouvir(aluna, linha.id, { event: "progress", heard: trechos(30, 44) });
  assert.deepEqual(ouvido.body.data.audioProgress, { completed: true, heard: trechos(0, 44), percent: 91 });
  const completo = await linhaDe(publicado.id);
  assert.ok(completo.audio_completed_at);
  assert.equal(completo.audio_heard_percent, 91);

  assert.equal((await ouvir(aluna, linha.id, { event: "progress", heard: TUDO })).body.data.audioProgress.percent, 100);
  const concluidos = await eventosDe("notification_audio_completed", linha.id);
  assert.equal(concluidos.length, 1, "um evento de ouvido ate o fim");
  assert.deepEqual(concluidos[0].metadata, { campaign_id: publicado.id });
  assert.equal((await linhaDe(publicado.id)).audio_completed_at, completo.audio_completed_at, "o fim nao muda");

  // O GET devolve o ouvido (sobrevive ao recarregar e a outro aparelho).
  const item = (await sino(aluna)).items.find((entry) => entry.id === linha.id);
  assert.deepEqual(item.audioProgress, { completed: true, heard: TUDO, percent: 100 });
  assert.ok(item.openedAt);
});

test("audio: outra pessoa, aviso sem audio e id invalido nao passam; corpo invalido e 400; sem sessao e 401", async () => {
  const comAudio = await publicar(rascunho({ audio: AUDIO, title: "Áudio de outra pessoa" }));
  const semAudio = await publicar(rascunho({ title: "Aviso sem áudio" }));
  const linha = await linhaDe(comAudio.id);
  const semAudioLinha = await linhaDe(semAudio.id);

  const deOutra = await ouvir(alunoSemAcesso, linha.id, { event: "started" });
  assert.equal(deOutra.status, 404);
  assert.equal(deOutra.body.error, "Notificacao nao encontrada.");
  assert.equal((await ouvir(aluna, semAudioLinha.id, { event: "started" })).status, 404, "aviso sem audio");
  assert.equal((await ouvir(aluna, randomUUID(), { event: "started" })).status, 404);
  assert.equal((await linhaDe(semAudio.id)).opened_at, null, "nada gravado");

  const idInvalido = await ouvir(aluna, "123", { event: "started" });
  assert.equal(idInvalido.status, 400);
  assert.equal(idInvalido.body.error, "Notificacao invalida.");

  for (const corpo of [{ event: "tocou" }, { event: "progress" }, { event: "progress", heard: "1".repeat(47) }, { event: "progress", heard: "2".repeat(48) }, []]) {
    const recusado = await ouvir(aluna, linha.id, corpo);
    assert.equal(recusado.status, 400, JSON.stringify(corpo));
    assert.equal(recusado.body.error, "Evento invalido.");
  }

  assert.deepEqual(await ouvir(aluna, linha.id, null, { bruto: "nao e json" }), { body: { error: "Evento invalido." }, status: 400 });
  assert.equal((await ouvir(aluna, linha.id, null, { bruto: JSON.stringify({ event: "progress", heard: NADA, sobra: "x".repeat(3_000) }) })).status, 413);

  actAs(null);
  const semSessao = await audioRoute.POST(
    new Request(`http://localhost/api/notifications/${linha.id}/audio`, { body: JSON.stringify({ event: "started" }), method: "POST" }),
    { params: Promise.resolve({ id: linha.id }) }
  );
  assert.equal(semSessao.status, 401);
  assert.match(semSessao.headers.get("cache-control") ?? "", /no-store/);
  assert.equal((await linhaDe(comAudio.id)).audio_started_at, null);
});

/* ------------------------------------------------------------------------------------------------
 * "Abriu" de verdade
 * ---------------------------------------------------------------------------------------------- */

test("Marcar todas e abrir o sino nao contam como aberta; o cartao (ids), o clique e a resposta abrem, tambem num cartao ja lido", async () => {
  const cartao = await publicar(rascunho({ title: "Aviso para abrir" }));
  const botao = await publicar(rascunho({ cta: { href: `/conteudo/${curso.id}`, label: "Ver o curso", target: "same_tab" }, title: "Aviso com botão" }));
  const pergunta = await publicar(rascunho({ response: { acceptLabel: "Quero", declineLabel: "Agora não" }, title: "Aviso com pergunta" }));

  const pagina = await sino(aluna);
  assert.equal((await marcar(aluna, { asOf: pagina.asOf, seen: true })).status, 200);
  const todas = await marcar(aluna, { all: true, asOf: pagina.asOf });
  assert.equal(todas.status, 200);
  assert.equal(todas.body.data.unread, 0);

  for (const id of [cartao.id, botao.id, pergunta.id]) {
    const linha = await linhaDe(id);
    assert.ok(linha.seen_at && linha.read_at, "lida");
    assert.equal(linha.opened_at, null, "Marcar todas nao abre");
  }

  const doCartao = await linhaDe(cartao.id);
  const porId = await marcar(aluna, { ids: [doCartao.id] });
  assert.equal(porId.status, 200);
  const aberta = await linhaDe(cartao.id);
  assert.ok(aberta.opened_at, "o cartao abre mesmo ja lido");
  assert.equal(aberta.read_at, doCartao.read_at, "a leitura nao muda");

  // De novo nao muda a hora.
  await marcar(aluna, { ids: [doCartao.id] });
  assert.equal((await linhaDe(cartao.id)).opened_at, aberta.opened_at);

  const doBotao = await linhaDe(botao.id);
  assert.equal(await clicar(aluna, doBotao.id), 200);
  const clicada = await linhaDe(botao.id);
  assert.ok(clicada.opened_at && clicada.clicked_at);

  const daPergunta = await linhaDe(pergunta.id);
  assert.equal((await responder(aluna, daPergunta.id, "accepted")).status, 200);
  assert.ok((await linhaDe(pergunta.id)).opened_at, "responder abre");

  const lista = await sino(aluna);
  assert.ok(lista.items.find((item) => item.id === doCartao.id).openedAt);
});

/* ------------------------------------------------------------------------------------------------
 * Quanto tempo fica no sino
 * ---------------------------------------------------------------------------------------------- */

test("notificacao vencida sai da lista, do numero, das nao lidas, do Marcar todas e do abriu o sino; clique, resposta e audio nela sao 404", async () => {
  const publicado = await publicar(
    rascunho({
      audio: AUDIO,
      cta: { href: `/conteudo/${curso.id}`, label: "Ver o curso", target: "same_tab" },
      response: { acceptLabel: "Quero", declineLabel: "Agora não" },
      title: "Oferta que vence"
    })
  );
  const linha = await linhaDe(publicado.id);
  const antes = await sino(aluna);
  assert.ok(antes.items.some((item) => item.id === linha.id));
  const numeroAntes = (await resumo(aluna)).unseen;

  // Chegou ha 2 dias e venceu ha 1 hora (expires_at > created_at continua valendo).
  const agora = Date.now();
  unwrap(
    await db
      .from("notifications")
      .update({ created_at: new Date(agora - 2 * DIA).toISOString(), expires_at: new Date(agora - HORA).toISOString() })
      .eq("id", linha.id),
    "Vencendo a notificacao"
  );

  const depois = await sino(aluna);
  assert.ok(!depois.items.some((item) => item.id === linha.id), "saiu da lista");
  assert.equal(depois.unread, antes.unread - 1, "saiu das nao lidas");
  assert.equal((await resumo(aluna)).unseen, numeroAntes - 1, "saiu do numero do sino");

  assert.equal((await marcar(aluna, { asOf: depois.asOf, seen: true })).status, 200);
  assert.equal((await marcar(aluna, { all: true, asOf: depois.asOf })).status, 200);
  assert.equal((await marcar(aluna, { all: true })).status, 200);
  assert.equal((await marcar(aluna, { ids: [linha.id] })).status, 200);
  const intacta = await linhaDe(publicado.id);
  assert.deepEqual(
    { opened_at: intacta.opened_at, read_at: intacta.read_at, seen_at: intacta.seen_at },
    { opened_at: null, read_at: null, seen_at: null },
    "nada marca uma notificacao que ja saiu do sino"
  );

  assert.equal(await clicar(aluna, linha.id), 404);
  const resposta = await responder(aluna, linha.id, "accepted");
  assert.equal(resposta.status, 404);
  assert.equal(resposta.body.error, "Notificacao nao encontrada.");
  assert.equal((await ouvir(aluna, linha.id, { event: "started" })).status, 404);
  assert.equal((await linhaDe(publicado.id)).clicked_at, null);
});

test("notificacao de comentario gravada sem fim ganha 90 dias pelo gatilho", async () => {
  const criada = "2026-10-01T12:00:00.000Z";
  const [linha] = unwrap(
    await db
      .from("notifications")
      .insert({
        body: "Boa pergunta!",
        created_at: criada,
        dedupe_key: `comment-reply:${randomUUID()}`,
        kind: "comment_reply",
        payload: {},
        user_id: aluna.id
      })
      .select("id,created_at,expires_at"),
    "Gravando a notificacao de comentario"
  );

  try {
    assert.equal(Date.parse(linha.expires_at) - Date.parse(linha.created_at), 90 * DIA);
  } finally {
    unwrap(await db.from("notifications").delete().eq("id", linha.id), "Apagando a notificacao de comentario");
  }
});

test("teste para mim recalcula o fim e zera o audio; o teste de um rascunho com data que ja passou aparece por 1 hora", async () => {
  actAs(produtor);
  const salvo = await actions.saveNoticeDraft({ draft: rascunho({ audio: AUDIO, title: "Teste com fim", validity: { minutes: 1_440, mode: "duration" } }) });
  assert.equal(salvo.ok, true, JSON.stringify(salvo));

  assert.equal((await actions.sendNoticeTestToMe({ id: salvo.data.id })).ok, true);
  const primeira = await linhaDe(salvo.data.id, produtor.id);
  assert.ok(Math.abs(Date.parse(primeira.expires_at) - Date.parse(primeira.created_at) - DIA) < MINUTO, JSON.stringify(primeira));

  assert.equal((await ouvir(produtor, primeira.id, { event: "started" })).status, 200);
  assert.equal((await ouvir(produtor, primeira.id, { event: "progress", heard: TUDO })).body.data.audioProgress.completed, true);

  actAs(produtor);
  assert.equal((await actions.sendNoticeTestToMe({ id: salvo.data.id })).ok, true);
  const devolta = await linhaDe(salvo.data.id, produtor.id);
  assert.equal(devolta.id, primeira.id, "a mesma linha volta");
  assert.deepEqual(
    {
      audio_completed_at: devolta.audio_completed_at,
      audio_heard: devolta.audio_heard,
      audio_heard_percent: devolta.audio_heard_percent,
      audio_started_at: devolta.audio_started_at,
      opened_at: devolta.opened_at,
      read_at: devolta.read_at,
      seen_at: devolta.seen_at
    },
    { audio_completed_at: null, audio_heard: null, audio_heard_percent: null, audio_started_at: null, opened_at: null, read_at: null, seen_at: null }
  );
  assert.ok(Date.parse(devolta.created_at) >= Date.parse(primeira.created_at));
  assert.ok(Math.abs(Date.parse(devolta.expires_at) - Date.parse(devolta.created_at) - DIA) < MINUTO, "o fim e recalculado");

  // "Ate uma data" que ja passou: o teste ainda aparece por 1 hora (sem quebrar expires_at > created_at).
  const passado = await actions.saveNoticeDraft({
    draft: rascunho({ title: "Teste vencido", validity: { endsAt: new Date(Date.now() - DIA).toISOString(), mode: "until" } })
  });
  assert.equal(passado.ok, true, JSON.stringify(passado));
  const teste = await actions.sendNoticeTestToMe({ id: passado.data.id });
  assert.equal(teste.ok, true, JSON.stringify(teste));
  const vencido = await linhaDe(passado.data.id, produtor.id);
  assert.ok(Math.abs(Date.parse(vencido.expires_at) - Date.now() - HORA) < 5 * MINUTO, JSON.stringify(vencido));
  assert.ok(doAviso(await sino(produtor), "Teste vencido"), "aparece no sino de quem testou");
});

/* ------------------------------------------------------------------------------------------------
 * Quem envia
 * ---------------------------------------------------------------------------------------------- */

test("quem envia: a pessoa da equipe com foto e nome; sem foto, so o nome; sem nome, Equipe Bunker707; fora da equipe, a escola", async () => {
  const remetente = await criarRemetente();
  const foto = "https://midia.bunker707.test/fotos/carlos-lima.webp";
  unwrap(await db.from("profiles").update({ avatar_url: foto }).eq("id", remetente.id), "Pondo a foto do remetente");

  await publicar(rascunho({ sender: { userId: remetente.id }, title: "Recado do professor" }));
  const daEscola = await publicar(rascunho({ title: "Recado da escola" }));
  assert.ok(daEscola.id);

  const comFoto = doAviso(await sino(aluna), "Recado do professor");
  assert.deepEqual(comFoto.actor, { avatarUrl: foto, name: REMETENTE.nome });
  assert.equal(doAviso(await sino(aluna), "Recado da escola").actor, null);

  unwrap(await db.from("profiles").update({ avatar_url: null }).eq("id", remetente.id), "Tirando a foto");
  assert.deepEqual(doAviso(await sino(aluna), "Recado do professor").actor, { avatarUrl: null, name: REMETENTE.nome }, "sem foto: as iniciais");

  unwrap(await db.from("profiles").update({ full_name: null }).eq("id", remetente.id), "Tirando o nome");
  assert.deepEqual(doAviso(await sino(aluna), "Recado do professor").actor, { avatarUrl: null, name: "Equipe Bunker707" }, "nunca o e-mail");

  // Saiu da equipe: a mesma notificacao, ja entregue, passa a ser da escola na proxima leitura.
  unwrap(await db.from("admin_roles").delete().eq("user_id", remetente.id), "Tirando o remetente da equipe");
  assert.equal(doAviso(await sino(aluna), "Recado do professor").actor, null);
});

/* ------------------------------------------------------------------------------------------------
 * Linhas de fluxo: a folga de 15 s do "abriu o sino" e do "Marcar todas"
 * ---------------------------------------------------------------------------------------------- */

test("linha de fluxo so conta como mostrada 15 s depois de gravada, ou quando o painel manda o id em shown", async () => {
  actAs(produtor);
  const salvo = await actions.saveNoticeDraft({ draft: rascunho({ title: "Passo do fluxo" }) });
  assert.equal(salvo.ok, true, JSON.stringify(salvo));

  const agora = Date.now();
  const [fluxo] = unwrap(
    await db
      .from("communication_flows")
      .insert({ created_by: produtor.id, ended_at: new Date(agora).toISOString(), ended_reason: "team", name: "Fluxo do teste do sino", status: "ended" })
      .select("id"),
    "Criando o fluxo"
  );
  const [entrada] = unwrap(await db.from("communication_flow_nodes").insert({ flow_id: fluxo.id, kind: "entry" }).select("id"), "Criando a entrada");
  const [passo] = unwrap(
    await db.from("communication_flow_nodes").insert({ campaign_id: salvo.data.id, flow_id: fluxo.id, kind: "message", parent_id: entrada.id }).select("id"),
    "Criando o passo"
  );
  // O sent_at da versao nao vale para a linha de fluxo (fica ate no futuro aqui): vale o created_at dela.
  unwrap(
    await db
      .from("campaigns")
      .update({ flow_id: fluxo.id, flow_node_id: passo.id, sent_at: new Date(agora + HORA).toISOString(), status: "sent" })
      .eq("id", salvo.data.id),
    "Ligando o conteudo ao passo"
  );

  const linhas = unwrap(
    await db
      .from("notifications")
      .insert([
        { campaign_id: salvo.data.id, created_at: new Date(agora - 3_000).toISOString(), dedupe_key: `flow:${passo.id}`, flow_id: fluxo.id, flow_node_id: passo.id, kind: "notice", user_id: aluna.id },
        { campaign_id: salvo.data.id, created_at: new Date(agora - MINUTO).toISOString(), dedupe_key: `flow:${passo.id}:antiga`, flow_id: fluxo.id, flow_node_id: passo.id, kind: "notice", user_id: aluna.id }
      ])
      .select("id,created_at"),
    "Gravando as linhas do fluxo"
  );
  const recente = linhas.find((linha) => Date.parse(linha.created_at) > agora - 10_000);
  const antiga = linhas.find((linha) => linha !== recente);
  const estado = async (id) => unwrap(await db.from("notifications").select("seen_at,read_at,opened_at").eq("id", id), "Lendo a linha")[0];

  const pagina = await sino(aluna);
  assert.deepEqual(
    pagina.items.filter((item) => item.title === "Passo do fluxo").map((item) => item.id).sort(),
    [antiga.id, recente.id].sort(),
    "as duas aparecem"
  );

  assert.equal((await marcar(aluna, { asOf: pagina.asOf, seen: true })).status, 200);
  assert.ok((await estado(antiga.id)).seen_at, "passou da folga: vista");
  assert.equal((await estado(recente.id)).seen_at, null, "dentro da folga e sem shown: continua nova");

  assert.equal((await marcar(aluna, { asOf: pagina.asOf, seen: true, shown: [recente.id.toUpperCase()] })).status, 200);
  assert.ok((await estado(recente.id)).seen_at, "o painel mostrou: vista");

  assert.equal((await marcar(aluna, { all: true, asOf: pagina.asOf })).status, 200);
  assert.ok((await estado(antiga.id)).read_at);
  assert.equal((await estado(recente.id)).read_at, null);

  assert.equal((await marcar(aluna, { all: true, asOf: pagina.asOf, shown: [recente.id] })).status, 200);
  const lida = await estado(recente.id);
  assert.ok(lida.read_at);
  assert.equal(lida.opened_at, null, "Marcar todas nao abre");

  const invalido = await marcar(aluna, { asOf: pagina.asOf, seen: true, shown: ["nao-e-id"] });
  assert.equal(invalido.status, 400);
  assert.equal(invalido.body.error, "Notificacao invalida.");
  assert.equal((await marcar(aluna, { all: true, shown: Array.from({ length: 51 }, () => randomUUID()) })).status, 400);
  assert.equal((await marcar(aluna, { all: true, shown: "x" })).status, 400);

  unwrap(await db.from("communication_flows").delete().eq("id", fluxo.id), "Apagando o fluxo do teste");
});
