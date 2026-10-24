import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, limparComentarios, limparComunicacao, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Sino da v3a (docs/24 §4.2 a §4.6 e §4.14) contra o banco LOCAL: a regra do que aparece no sino fica num
// lugar so (communication_visible_notifications) e a lista, os dois numeros, "abriu o sino", "Marcar
// todas" e cada rota de uma linha concordam exatamente no mesmo conjunto; a paginacao pela pagina numa
// ida so; "Excluir notificação" e "Desfazer"; reacoes; mudar a resposta; a enquete (votar, mudar, tirar,
// encerrada, contagem sem os testes da equipe, resultado so para quem pode ver); o contador de escritas da
// linha e o teto de 20 eventos. As linhas sao gravadas direto no banco (o envio tem os testes dele).

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const { listNotifications, markAllSeen, markRead } = await import("../../src/server/communications/inbox.ts");
const { upsertTestNotification } = await import("../../src/server/communications/store.ts");
const listRoute = await import("../../src/app/api/notifications/route.ts");
const summaryRoute = await import("../../src/app/api/notifications/summary/route.ts");
const clickRoute = await import("../../src/app/api/notifications/[id]/click/route.ts");
const responseRoute = await import("../../src/app/api/notifications/[id]/response/route.ts");
const reactionRoute = await import("../../src/app/api/notifications/[id]/reaction/route.ts");
const pollRoute = await import("../../src/app/api/notifications/[id]/poll/route.ts");
const hideRoute = await import("../../src/app/api/notifications/[id]/hide/route.ts");

const { curso } = ESCOLA_DE_TESTE;
const aluna = usuarioDeTeste(contas.aluna);
// Cada parte usa um aluno (o limite de 30 escritas por minuto e por aluno e vive no processo).
const outroAluno = usuarioDeTeste(contas.alunoSemAcesso);
const terceiraAluna = usuarioDeTeste(contas.alunaAcessoExpirado);
const produtor = usuarioDeTeste(contas.produtor);
const professor = usuarioDeTeste(contas.professor);

const HORA = 3_600_000;
const DIA = 24 * HORA;
const agora = () => Date.now();
const iso = (offset = 0) => new Date(agora() + offset).toISOString();

const ENQUETE = {
  closesAt: null,
  multiple: false,
  options: [
    { id: "a1", label: "Sábado" },
    { id: "b2", label: "Domingo" },
    { id: "c3", label: "Tanto faz" }
  ],
  question: "Qual dia da live?",
  showResults: true
};

async function limpar() {
  await limparComunicacao(db);
  await limparComentarios(db, [aluna.id, professor.id]);
  unwrap(await db.from("student_events").delete().in("user_id", [aluna.id, outroAluno.id, terceiraAluna.id]).like("event_type", "notification_%"), "Limpando eventos do sino");
}

before(limpar);
after(limpar);

async function aviso(extra = {}) {
  const [row] = unwrap(
    await db
      .from("campaigns")
      .insert({ body: "Traga suas dúvidas.", created_by: produtor.id, kind: "inbox", sent_at: iso(-HORA), status: "sent", title: "Aviso do sino v3", ...extra })
      .select("*"),
    "Gravando o aviso"
  );
  return row;
}

async function linha(user, campanha, extra = {}) {
  const [row] = unwrap(
    await db
      .from("notifications")
      .insert({
        campaign_id: campanha?.id ?? null,
        created_at: iso(-30 * 60_000),
        dedupe_key: campanha ? `campaign:${campanha.id}` : `linha:${Math.random()}`,
        expires_at: iso(30 * DIA),
        kind: "notice",
        user_id: user.id,
        ...extra
      })
      .select("*"),
    "Gravando a linha do sino"
  );
  return row;
}

async function comentario(extra = {}) {
  const [row] = unwrap(
    await db
      .from("lesson_comments")
      .insert({
        author_id: professor.id,
        author_name: "Professor de Teste",
        author_role: "producer",
        author_username: "professor-teste",
        body: "Resposta do professor.",
        content_id: curso.id,
        lesson_id: curso.aulas.aula1,
        ...extra
      })
      .select("id"),
    "Gravando o comentario"
  );
  return row;
}

async function respostaNoSino(reply, parentId, extra = {}) {
  return linha(aluna, null, {
    actor_id: professor.id,
    body: "Resposta do professor.",
    dedupe_key: `comment-reply:${reply.id}`,
    href: `/conteudo/${curso.id}/aulas/${curso.modulos.modulo1}?lessonId=${curso.aulas.aula1}`,
    kind: "comment_reply",
    payload: { commentId: reply.id, lessonTitle: "Aula 1", ...(parentId ? { parentCommentId: parentId } : {}) },
    ...extra
  });
}

async function lerLinha(id) {
  return unwrap(await db.from("notifications").select("*").eq("id", id).single(), "Lendo a linha");
}

function post(route, user, id, body) {
  actAs(user);
  return route.POST(
    new Request(`http://localhost/api/notifications/${id}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST"
    }),
    { params: Promise.resolve({ id }) }
  );
}

async function sino(user, query = "") {
  actAs(user);
  const response = await listRoute.GET(new Request(`http://localhost/api/notifications${query}`));
  assert.equal(response.status, 200);
  return (await response.json()).data;
}

async function eventosDa(user, id, tipo) {
  return unwrap(
    await db.from("student_events").select("event_type,entity_id,metadata").eq("user_id", user.id).eq("entity_id", id).eq("event_type", tipo).order("created_at"),
    "Lendo eventos"
  );
}

const ids = (rows) => rows.map((row) => row.id).sort();

test("a regra do que aparece e uma so: lista, numeros, abriu o sino, Marcar todas e as rotas de uma linha concordam", async () => {
  const enviado = await aviso({ title: "Enviado" });
  const emEnvio = await aviso({ sent_at: null, status: "sending", title: "Em envio" });
  const excluidoPelaEquipe = await aviso({ deleted_at: iso(-60_000), title: "Excluido pela equipe" });
  const rascunho = await aviso({ sent_at: null, status: "draft", title: "Teste da equipe" });

  const pergunta = await comentario({ author_id: aluna.id, author_name: "Aluna de Teste", author_role: "student", author_username: "aluna-teste", body: "Pergunta" });
  const escondida = await comentario({ author_id: aluna.id, author_name: "Aluna de Teste", author_role: "student", author_username: "aluna-teste", body: "Outra", status: "hidden" });
  const aprovada = await comentario({ parent_comment_id: pergunta.id });
  const pendente = await comentario({ parent_comment_id: pergunta.id, status: "pending" });
  const apagada = await comentario({ deleted_at: iso(-60_000), parent_comment_id: pergunta.id });
  const sobPaiEscondido = await comentario({ parent_comment_id: escondida.id });
  const semPai = await comentario({ parent_comment_id: pergunta.id });

  const linhas = {
    apagada: await respostaNoSino(apagada, pergunta.id),
    aprovada: await respostaNoSino(aprovada, pergunta.id),
    emEnvio: await linha(aluna, emEnvio),
    excluidaPelaAluna: await linha(aluna, await aviso({ title: "Excluida pela aluna" }), { hidden_at: iso(-60_000) }),
    excluidoPelaEquipe: await linha(aluna, excluidoPelaEquipe),
    enviado: await linha(aluna, enviado),
    pendente: await respostaNoSino(pendente, pergunta.id),
    semPai: await respostaNoSino(semPai, null),
    sobPaiEscondido: await respostaNoSino(sobPaiEscondido, escondida.id),
    teste: await linha(aluna, rascunho, { dedupe_key: `campaign-test:${rascunho.id}`, is_test: true }),
    vencida: await linha(aluna, await aviso({ title: "Vencida" }), { created_at: iso(-2 * DIA), expires_at: iso(-DIA) }),
    velha: await linha(aluna, await aviso({ title: "Velha" }), { created_at: iso(-91 * DIA), expires_at: iso(30 * DIA) })
  };
  const aparecem = [linhas.enviado.id, linhas.teste.id, linhas.aprovada.id, linhas.semPai.id].sort();
  const todas = Object.values(linhas).map((row) => row.id);

  // Lista (todas e "Não lidas") e os dois numeros.
  const pagina = await sino(aluna);
  assert.deepEqual(ids(pagina.items), aparecem);
  assert.deepEqual(ids((await sino(aluna, "?filter=unread")).items), aparecem);
  assert.deepEqual({ unread: pagina.unread, unseen: pagina.unseen }, { unread: 4, unseen: 4 });
  actAs(aluna);
  assert.deepEqual((await (await summaryRoute.GET(new Request("http://localhost/api/notifications/summary"))).json()).data, { popup: null, unseen: 4 });

  // "Abriu o sino": so as que aparecem ficam vistas.
  await markAllSeen(aluna.id);
  const vistas = unwrap(await db.from("notifications").select("id").in("id", todas).not("seen_at", "is", null), "Lendo vistas");
  assert.deepEqual(ids(vistas), aparecem);

  // "Marcar todas": so as que aparecem ficam lidas.
  unwrap(await db.from("notifications").update({ read_at: null, seen_at: null }).in("id", todas), "Voltando a novas");
  await markRead(aluna.id, "all");
  const lidas = unwrap(await db.from("notifications").select("id").in("id", todas).not("read_at", "is", null), "Lendo lidas");
  assert.deepEqual(ids(lidas), aparecem);
  assert.deepEqual(ids(unwrap(await db.from("notifications").select("id").in("id", todas).not("opened_at", "is", null), "Lendo abertas")), [], "Marcar todas nunca abre");

  // Cada rota de uma linha (o clique, sem exigir nada da linha): 200 so nas que aparecem; o resto 404.
  for (const [nome, row] of Object.entries(linhas)) {
    const status = (await post(clickRoute, aluna, row.id)).status;
    assert.equal(status, aparecem.includes(row.id) ? 200 : 404, nome);
  }

  // Outra pessoa nunca alcanca a linha da aluna.
  assert.equal((await post(clickRoute, outroAluno, linhas.enviado.id)).status, 404);
  assert.equal((await post(hideRoute, outroAluno, linhas.enviado.id, { hidden: true })).status, 404);

  await limpar();
});

test("paginacao numa ida so: 45 linhas com excluidas no meio e duas no mesmo instante, sem repetir nem pular", async () => {
  const campanha = await aviso({ title: "Varias linhas" });
  const base = agora() - 2 * HORA;
  const linhas = [];

  for (let n = 0; n < 56; n += 1) {
    // Duas linhas com o mesmo created_at (n = 20 e 21); uma excluida a cada 5.
    const createdAt = new Date(base + (n === 21 ? 20 : n) * 60_000).toISOString();
    linhas.push({
      campaign_id: campanha.id,
      created_at: createdAt,
      dedupe_key: `paginacao:${n}`,
      expires_at: iso(30 * DIA),
      hidden_at: n % 5 === 4 ? iso(-60_000) : null,
      kind: "notice",
      read_at: n % 2 === 0 ? iso(-60_000) : null,
      seen_at: n % 2 === 0 ? iso(-60_000) : null,
      user_id: outroAluno.id
    });
  }

  const gravadas = unwrap(await db.from("notifications").insert(linhas).select("id,created_at,hidden_at,read_at"), "Gravando 56 linhas");
  const visiveis = gravadas.filter((row) => !row.hidden_at);
  assert.equal(visiveis.length, 45, "45 aparecem, 11 excluidas no meio");

  const ordem = (rows) =>
    [...rows].sort((a, b) => (Date.parse(b.created_at) - Date.parse(a.created_at)) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)).map((row) => row.id);

  for (const [filter, esperado] of [
    [undefined, ordem(visiveis)],
    ["unread", ordem(visiveis.filter((row) => !row.read_at))]
  ]) {
    const vistos = [];
    let cursor = null;
    let paginas = 0;

    do {
      const pagina = await listNotifications({ cursor, filter, limit: 7, userId: outroAluno.id });
      vistos.push(...pagina.items.map((item) => item.id));
      cursor = pagina.nextCursor;
      paginas += 1;
      assert.ok(paginas < 20);
    } while (cursor);

    assert.deepEqual(vistos, esperado, `filtro ${filter ?? "all"}`);
    assert.equal(new Set(vistos).size, vistos.length, "sem repetir");
  }

  const primeira = await listNotifications({ userId: outroAluno.id });
  assert.equal(primeira.items.length, 20);
  assert.equal(primeira.unread, visiveis.filter((row) => !row.read_at).length);

  await limpar();
});

test("Excluir notificação e Desfazer: some da lista e dos numeros so para a aluna, repetir nao escreve, o teste reenviado volta", async () => {
  const campanha = await aviso({ title: "Para excluir" });
  const row = await linha(aluna, campanha);
  const antes = await sino(aluna);
  assert.deepEqual({ unread: antes.unread, unseen: antes.unseen }, { unread: 1, unseen: 1 });

  const excluir = await post(hideRoute, aluna, row.id, { hidden: true });
  assert.equal(excluir.status, 200);
  assert.deepEqual((await excluir.json()).data, { unread: 0, unseen: 0 });
  const excluida = await lerLinha(row.id);
  assert.ok(excluida.hidden_at);
  assert.ok(excluida.seen_at, "excluir conta como vista");
  assert.equal(excluida.read_at, null, "e so vista");
  assert.equal(excluida.interaction_writes, 1);
  assert.deepEqual((await sino(aluna)).items, []);

  const repetir = await post(hideRoute, aluna, row.id, { hidden: true });
  assert.equal(repetir.status, 200, "excluir o que ja saiu e sucesso");
  assert.equal((await lerLinha(row.id)).interaction_writes, 1, "sem escrita");
  assert.equal((await post(hideRoute, outroAluno, row.id, { hidden: false })).status, 404, "outra pessoa nao desfaz");
  assert.equal((await post(clickRoute, aluna, row.id)).status, 404, "excluida nao recebe clique");

  const desfazer = await post(hideRoute, aluna, row.id, { hidden: false });
  assert.deepEqual((await desfazer.json()).data, { unread: 1, unseen: 0 }, "volta vista e ainda nao lida");
  assert.deepEqual(ids((await sino(aluna)).items), [row.id]);
  assert.equal((await post(hideRoute, aluna, row.id, { hidden: false })).status, 200, "desfazer o que esta no sino e sucesso");

  const eventos = await eventosDa(aluna, row.id, "notification_hidden");
  assert.deepEqual(
    eventos.map((evento) => evento.metadata),
    [
      { campaign_id: campanha.id, hidden: true },
      { campaign_id: campanha.id, hidden: false }
    ],
    "um evento por mudanca, so ids"
  );

  // Comentario tambem sai do sino.
  const pergunta = await comentario({ author_id: aluna.id, author_name: "Aluna de Teste", author_role: "student", author_username: "aluna-teste", body: "Pergunta" });
  const resposta = await respostaNoSino(await comentario({ parent_comment_id: pergunta.id }), pergunta.id);
  assert.equal((await post(hideRoute, aluna, resposta.id, { hidden: true })).status, 200);
  assert.deepEqual((await eventosDa(aluna, resposta.id, "notification_hidden"))[0].metadata, { campaign_id: null, hidden: true });

  // "Enviar teste para mim" de novo traz o teste excluido de volta.
  const rascunho = await aviso({ sent_at: null, status: "draft", title: "Teste excluido" });
  const teste = await linha(aluna, rascunho, { dedupe_key: `campaign-test:${rascunho.id}`, is_test: true });
  assert.equal((await post(hideRoute, aluna, teste.id, { hidden: true })).status, 200);
  assert.ok(!(await sino(aluna)).items.some((item) => item.id === teste.id));
  await upsertTestNotification(db, rascunho, aluna.id, agora());
  assert.ok((await sino(aluna)).items.some((item) => item.id === teste.id), "o teste volta");
  assert.equal((await lerLinha(teste.id)).interaction_writes, 0);

  await limpar();
});

test("reacoes: aviso sem 'Permitir reações' e 409; reagir, trocar e tirar, a abertura conta e um evento por mudanca", async () => {
  const semReacoes = await linha(aluna, await aviso({ title: "Sem reacoes" }));
  const naoAceita = await post(reactionRoute, aluna, semReacoes.id, { reaction: "love" });
  assert.equal(naoAceita.status, 409);
  assert.equal((await naoAceita.json()).error, "Esta notificação não aceita reações.");

  const campanha = await aviso({ allow_reactions: true, title: "Com reacoes" });
  const row = await linha(aluna, campanha);
  assert.deepEqual((await sino(aluna)).items.find((item) => item.id === row.id).reactions, { value: null });

  const reagiu = await post(reactionRoute, aluna, row.id, { reaction: "love" });
  assert.equal(reagiu.status, 200);
  assert.deepEqual((await reagiu.json()).data, { reaction: "love" });
  const depois = await lerLinha(row.id);
  assert.equal(depois.reaction, "love");
  assert.ok(depois.reacted_at && depois.opened_at && depois.read_at && depois.seen_at, "reagir e uma interacao de verdade");
  assert.deepEqual((await sino(aluna)).items.find((item) => item.id === row.id).reactions, { value: "love" });

  assert.equal((await post(reactionRoute, aluna, row.id, { reaction: "love" })).status, 200, "a mesma reacao");
  assert.deepEqual((await (await post(reactionRoute, aluna, row.id, { reaction: "like" })).json()).data, { reaction: "like" });
  assert.deepEqual((await (await post(reactionRoute, aluna, row.id, { reaction: null })).json()).data, { reaction: null });

  const final = await lerLinha(row.id);
  assert.equal(final.reaction, null);
  assert.equal(final.reacted_at, null);
  assert.equal(final.interaction_writes, 3, "tres mudancas; a repetida nao conta");
  assert.deepEqual(
    (await eventosDa(aluna, row.id, "notification_reacted")).map((evento) => evento.metadata.reaction),
    ["love", "like", null]
  );
  assert.equal((await post(reactionRoute, aluna, row.id, { reaction: "raiva" })).status, 400);

  await limpar();
});

test("mudar a resposta: changed, response_changes, responded_at da primeira e o relatorio conta a resposta de agora", async () => {
  const campanha = await aviso({ accept_label: "Quero", decline_label: "Agora não", response_mode: "accept_decline", title: "Convite" });
  const row = await linha(aluna, campanha);

  const aceitou = await post(responseRoute, aluna, row.id, { response: "accepted" });
  assert.deepEqual((await aceitou.json()).data, { changed: false, response: "accepted" });
  const primeira = await lerLinha(row.id);
  assert.ok(primeira.responded_at && primeira.opened_at);
  assert.equal(primeira.response_changes, 0);
  assert.equal(primeira.response_changed_at, null);

  const mesma = await post(responseRoute, aluna, row.id, { response: "accepted" });
  assert.deepEqual((await mesma.json()).data, { changed: false, response: "accepted" });

  const recusou = await post(responseRoute, aluna, row.id, { response: "declined" });
  assert.equal(recusou.status, 200);
  assert.deepEqual((await recusou.json()).data, { changed: true, response: "declined" });
  const mudou = await lerLinha(row.id);
  assert.equal(mudou.response, "declined");
  assert.equal(mudou.response_changes, 1);
  assert.ok(mudou.response_changed_at);
  assert.equal(mudou.responded_at, primeira.responded_at, "responded_at fica o da primeira");
  assert.equal(mudou.interaction_writes, 2);

  const [stats] = unwrap(await db.rpc("communication_campaign_stats", { p_campaign_ids: [campanha.id] }), "Lendo os numeros");
  assert.deepEqual({ accepted: Number(stats.accepted), declined: Number(stats.declined) }, { accepted: 0, declined: 1 });
  assert.equal((await sino(aluna)).items.find((item) => item.id === row.id).response.value, "declined");

  assert.deepEqual(
    (await eventosDa(aluna, row.id, "notification_responded")).map((evento) => evento.metadata),
    [
      { campaign_id: campanha.id, changed: false, response: "accepted" },
      { campaign_id: campanha.id, changed: true, response: "declined" }
    ]
  );

  await limpar();
});

test("enquete: votar, mudar e tirar; varias respostas; opcao que nao existe 400; encerrada 409; a contagem sem os testes da equipe", async () => {
  const campanha = await aviso({ poll: ENQUETE, title: "Enquete da live" });
  const voto = await linha(outroAluno, campanha);
  // Outros votos: a aluna (c3) e um teste da equipe (a1), que a contagem ignora.
  await linha(aluna, campanha, { opened_at: iso(-60_000), poll_choice: ["c3"], poll_voted_at: iso(-60_000), read_at: iso(-60_000), seen_at: iso(-60_000) });
  await linha(produtor, campanha, { dedupe_key: `campaign-test:${campanha.id}`, is_test: true, poll_choice: ["a1"], poll_voted_at: iso(-60_000) });

  // A pagina de quem nao votou numa enquete aberta nao traz contagem.
  const { data: paginaCrua } = await db.rpc("communication_inbox_page", {
    p_cursor_created_at: null,
    p_cursor_id: null,
    p_filter: "all",
    p_limit: 20,
    p_now: iso(),
    p_user_id: outroAluno.id
  });
  assert.equal(paginaCrua.items.find((item) => item.id === voto.id).poll_tally, null);
  const antes = (await sino(outroAluno)).items.find((item) => item.id === voto.id).poll;
  assert.deepEqual({ choice: antes.choice, closed: antes.closed, results: antes.results }, { choice: [], closed: false, results: null });

  const votou = await post(pollRoute, outroAluno, voto.id, { optionIds: ["a1"] });
  assert.equal(votou.status, 200);
  const enquete = (await votou.json()).data.poll;
  assert.deepEqual(enquete.choice, ["a1"]);
  assert.deepEqual(enquete.results, { counts: { a1: 1, b2: 0, c3: 1 }, voters: 2 }, "sem o teste da equipe");
  const linhaVotou = await lerLinha(voto.id);
  assert.ok(linhaVotou.poll_voted_at && linhaVotou.opened_at && linhaVotou.read_at, "votar e uma interacao");
  assert.deepEqual((await sino(outroAluno)).items.find((item) => item.id === voto.id).poll.results, { counts: { a1: 1, b2: 0, c3: 1 }, voters: 2 });

  const mudou = (await (await post(pollRoute, outroAluno, voto.id, { optionIds: ["b2"] })).json()).data.poll;
  assert.deepEqual(mudou.results, { counts: { a1: 0, b2: 1, c3: 1 }, voters: 2 });
  assert.equal((await lerLinha(voto.id)).poll_changes, 1);

  const erro = async (resposta) => [resposta.status, (await resposta.json()).error];
  assert.deepEqual(await erro(await post(pollRoute, outroAluno, voto.id, { optionIds: ["zz9"] })), [400, "Voto invalido."]);
  assert.deepEqual(await erro(await post(pollRoute, outroAluno, voto.id, { optionIds: ["a1", "b2"] })), [400, "Voto invalido."], "uma resposta so");

  const tirou = (await (await post(pollRoute, outroAluno, voto.id, { optionIds: [] })).json()).data.poll;
  assert.deepEqual({ choice: tirou.choice, results: tirou.results }, { choice: [], results: null });
  const semVoto = await lerLinha(voto.id);
  assert.equal(semVoto.poll_choice, null);
  assert.equal(semVoto.poll_voted_at, null);
  assert.deepEqual(
    (await eventosDa(outroAluno, voto.id, "notification_voted")).map((evento) => evento.metadata),
    [
      { campaign_id: campanha.id, option_ids: ["a1"] },
      { campaign_id: campanha.id, option_ids: ["b2"] },
      { campaign_id: campanha.id, option_ids: [] }
    ]
  );

  // Varias respostas: o voto e o conjunto, em ordem de id.
  const varias = await linha(outroAluno, await aviso({ poll: { ...ENQUETE, multiple: true }, title: "Varias" }));
  assert.deepEqual((await (await post(pollRoute, outroAluno, varias.id, { optionIds: ["c3", "a1"] })).json()).data.poll.choice, ["a1", "c3"]);
  assert.deepEqual((await lerLinha(varias.id)).poll_choice, ["a1", "c3"]);

  // Sem "Mostrar o resultado": o voto vale e o resultado nunca vem.
  const fechada = await linha(outroAluno, await aviso({ poll: { ...ENQUETE, showResults: false }, title: "Sem resultado" }));
  assert.equal((await (await post(pollRoute, outroAluno, fechada.id, { optionIds: ["a1"] })).json()).data.poll.results, null);
  assert.equal((await sino(outroAluno)).items.find((item) => item.id === fechada.id).poll.results, null);

  // Encerrada pela data: 409 para votar, e quem nao votou ve o resultado.
  const encerrada = await aviso({ poll: { ...ENQUETE, closesAt: new Date(agora() - 60_000).toISOString() }, title: "Encerrada" });
  const naoVotou = await linha(outroAluno, encerrada);
  await linha(aluna, encerrada, { opened_at: iso(-HORA), poll_choice: ["b2"], poll_voted_at: iso(-HORA), read_at: iso(-HORA), seen_at: iso(-HORA) });
  assert.deepEqual(await erro(await post(pollRoute, outroAluno, naoVotou.id, { optionIds: ["a1"] })), [409, "A enquete foi encerrada."]);
  const vista = (await sino(outroAluno)).items.find((item) => item.id === naoVotou.id).poll;
  assert.deepEqual({ choice: vista.choice, closed: vista.closed, results: vista.results }, { choice: [], closed: true, results: { counts: { a1: 0, b2: 1, c3: 0 }, voters: 1 } });

  // Aviso sem enquete: 404.
  const semEnquete = await linha(outroAluno, await aviso({ title: "Sem enquete" }));
  assert.equal((await post(pollRoute, outroAluno, semEnquete.id, { optionIds: ["a1"] })).status, 404);

  await limpar();
});

test("contador de escritas da linha: toda mudanca conta; a 21a mudanca da mesma linha ainda escreve, mas sem evento", async () => {
  const row = await linha(terceiraAluna, await aviso({ allow_reactions: true, title: "Muitas reacoes" }));

  for (let n = 0; n < 21; n += 1) {
    const resposta = await post(reactionRoute, terceiraAluna, row.id, { reaction: n % 2 === 0 ? "fire" : "clap" });
    assert.equal(resposta.status, 200, `mudanca ${n + 1}`);
  }

  const final = await lerLinha(row.id);
  assert.equal(final.interaction_writes, 21);
  assert.equal(final.reaction, "fire", "a linha guarda o estado final");
  assert.equal((await eventosDa(terceiraAluna, row.id, "notification_reacted")).length, 20, "os eventos param em 20");

  await limpar();
});
