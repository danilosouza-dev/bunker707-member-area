import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, limparComentarios, limparComunicacao, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Lixeira por notificacao (ajustes da v3a; migracao 202610220002, campaigns.allow_hide) contra o banco
// LOCAL: a pagina do sino leva allowHide em todo item (aviso pelo que a equipe escolheu, comentario
// sempre true); excluir um aviso com a lixeira desligada e 403 com a frase para o aluno, sem escrita nem
// evento; o "Desfazer" vale sempre (tambem num aviso que a equipe desligou depois de o aluno excluir).

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const listRoute = await import("../../src/app/api/notifications/route.ts");
const hideRoute = await import("../../src/app/api/notifications/[id]/hide/route.ts");

const { curso } = ESCOLA_DE_TESTE;
const aluna = usuarioDeTeste(contas.aluna);
const produtor = usuarioDeTeste(contas.produtor);
const professor = usuarioDeTeste(contas.professor);

const HORA = 3_600_000;
const DIA = 24 * HORA;
const iso = (offset = 0) => new Date(Date.now() + offset).toISOString();

async function limpar() {
  await limparComunicacao(db);
  await limparComentarios(db, [aluna.id, professor.id]);
  unwrap(await db.from("student_events").delete().eq("user_id", aluna.id).like("event_type", "notification_%"), "Limpando eventos do sino");
}

before(limpar);
after(limpar);

async function aviso(extra = {}) {
  const [row] = unwrap(
    await db
      .from("campaigns")
      .insert({ body: "Texto do aviso.", created_by: produtor.id, kind: "inbox", sent_at: iso(-HORA), status: "sent", title: "Aviso", ...extra })
      .select("*"),
    "Gravando o aviso"
  );
  return row;
}

async function linha(campanha, extra = {}) {
  const [row] = unwrap(
    await db
      .from("notifications")
      .insert({
        campaign_id: campanha?.id ?? null,
        created_at: iso(-30 * 60_000),
        dedupe_key: campanha ? `campaign:${campanha.id}` : `linha:${Math.random()}`,
        expires_at: iso(30 * DIA),
        kind: "notice",
        user_id: aluna.id,
        ...extra
      })
      .select("*"),
    "Gravando a linha do sino"
  );
  return row;
}

async function lerLinha(id) {
  return unwrap(await db.from("notifications").select("*").eq("id", id).single(), "Lendo a linha");
}

function esconder(id, hidden) {
  actAs(aluna);
  return hideRoute.POST(
    new Request(`http://localhost/api/notifications/${id}/hide`, {
      body: JSON.stringify({ hidden }),
      headers: { "content-type": "application/json" },
      method: "POST"
    }),
    { params: Promise.resolve({ id }) }
  );
}

async function sino() {
  actAs(aluna);
  const response = await listRoute.GET(new Request("http://localhost/api/notifications"));
  assert.equal(response.status, 200);
  return (await response.json()).data;
}

async function eventosOcultar(id) {
  return unwrap(
    await db.from("student_events").select("metadata").eq("user_id", aluna.id).eq("entity_id", id).eq("event_type", "notification_hidden"),
    "Lendo eventos"
  );
}

test("a pagina do sino leva allowHide: o aviso pelo que a equipe escolheu, o de antes pode, o comentario sempre", async () => {
  const travado = await linha(await aviso({ allow_hide: false, title: "Sem lixeira" }));
  const livre = await linha(await aviso({ title: "Com lixeira" }));

  const [pergunta] = unwrap(
    await db
      .from("lesson_comments")
      .insert({ author_id: aluna.id, author_name: "Aluna de Teste", author_role: "student", author_username: "aluna-teste", body: "Pergunta", content_id: curso.id, lesson_id: curso.aulas.aula1 })
      .select("id"),
    "Gravando a pergunta"
  );
  const [resposta] = unwrap(
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
        parent_comment_id: pergunta.id
      })
      .select("id"),
    "Gravando a resposta"
  );
  const comentario = await linha(null, {
    actor_id: professor.id,
    body: "Resposta do professor.",
    dedupe_key: `comment-reply:${resposta.id}`,
    href: `/conteudo/${curso.id}/aulas/${curso.modulos.modulo1}?lessonId=${curso.aulas.aula1}`,
    kind: "comment_reply",
    payload: { commentId: resposta.id, lessonTitle: "Aula 1", parentCommentId: pergunta.id }
  });

  const porId = new Map((await sino()).items.map((item) => [item.id, item]));
  assert.equal(porId.get(travado.id)?.allowHide, false);
  assert.equal(porId.get(livre.id)?.allowHide, true, "padrao da coluna: pode");
  assert.equal(porId.get(comentario.id)?.allowHide, true, "comentario sempre pode");

  await limpar();
});

test("excluir com a lixeira desligada e 403 com a frase para o aluno, sem escrita nem evento; com ela ligada, exclui", async () => {
  const campanha = await aviso({ allow_hide: false, title: "Sem lixeira" });
  const row = await linha(campanha);

  const recusado = await esconder(row.id, true);
  assert.equal(recusado.status, 403);
  assert.deepEqual(await recusado.json(), { error: "Esta notificação não pode ser excluída." });
  const intacta = await lerLinha(row.id);
  assert.equal(intacta.hidden_at, null);
  assert.equal(intacta.seen_at, null, "nem conta como vista");
  assert.equal(intacta.interaction_writes, 0);
  assert.deepEqual(await eventosOcultar(row.id), []);
  assert.ok((await sino()).items.some((item) => item.id === row.id), "continua no sino");

  // A equipe liga a lixeira de novo: excluir passa a valer.
  unwrap(await db.from("campaigns").update({ allow_hide: true }).eq("id", campanha.id), "Ligando a lixeira");
  const excluir = await esconder(row.id, true);
  assert.equal(excluir.status, 200);
  assert.ok((await lerLinha(row.id)).hidden_at);

  await limpar();
});

test("o Desfazer vale sempre: excluida antes de a equipe desligar a lixeira volta; excluir de novo o que ja saiu continua sucesso", async () => {
  const campanha = await aviso({ title: "Desligada depois" });
  const row = await linha(campanha);
  assert.equal((await esconder(row.id, true)).status, 200);

  unwrap(await db.from("campaigns").update({ allow_hide: false }).eq("id", campanha.id), "Desligando a lixeira");
  const repetir = await esconder(row.id, true);
  assert.equal(repetir.status, 200, "o que ja saiu do sino: sucesso sem escrita (a regra de antes)");
  assert.equal((await lerLinha(row.id)).interaction_writes, 1);

  const desfazer = await esconder(row.id, false);
  assert.equal(desfazer.status, 200, "Desfazer com a lixeira desligada");
  assert.equal((await lerLinha(row.id)).hidden_at, null);
  const item = (await sino()).items.find((entry) => entry.id === row.id);
  assert.equal(item?.allowHide, false, "voltou, agora sem o ⋯");
  assert.equal((await esconder(row.id, true)).status, 403, "e nao sai de novo");

  await limpar();
});
