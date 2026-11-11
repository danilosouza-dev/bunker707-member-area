import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { limparWebinarios, seedEscolaDeTeste, seedWebinarioDeTeste, usuarioDeTeste, WEBINARIO_DE_TESTE } from "../fixtures/escola-de-teste.mjs";

// Arquivar, Desarquivar e Excluir o arquivado (docs/30 §2.3; decisao do produtor de 10/11/2026, no modelo do Demio),
// contra o Supabase local: so o encerrado ou o cancelado se arquiva; o arquivado sai da lista sem filtro (fica no
// filtro Arquivado) e da area do aluno (a pagina so abre para o publicado), e nada se apaga; Desarquivar volta como
// era; o arquivado so e excluido sem dados de aluno (a inscricao da equipe nao conta, a da aluna conta), e o excluido
// sai da lista e do editor; quem nao publica recebe 403; o arquivado nao se salva.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/webinars/actions.ts");
const { getWebinarEditorData, listWebinarsForAdmin } = await import("../../src/server/webinars/queries.ts");
const { getStudentWebinar } = await import("../../src/server/webinars/student-queries.ts");

const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const aluna = usuarioDeTeste(contas.aluna);
const webinarId = WEBINARIO_DE_TESTE.id;
const sessaoId = WEBINARIO_DE_TESTE.sessaoId;
const periodo = { end: new Date(Date.now() + 30 * 86_400_000), start: new Date(Date.now() - 30 * 86_400_000) };

/** O resultado de uma acao que deu certo (senao o teste diz o erro). */
function ok(result) {
  assert.equal(result.ok, true, result.ok ? "" : `${result.status}: ${result.error}`);
  return result.data;
}

async function linha() {
  return unwrap(await db.from("webinars").select("status, deleted_at, updated_at").eq("id", webinarId).single(), "Lendo o webinario");
}

async function encerrarSessao() {
  const fim = new Date(Date.now() - 60 * 60_000).toISOString();
  unwrap(await db.from("webinar_sessions").update({ ended_at: fim, started_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString(), status: "ended" }).eq("id", sessaoId), "Encerrando a sessao de teste");
}

async function lista(situation = null) {
  actAs(produtor);
  return (await listWebinarsForAdmin({ filters: { situation }, period: periodo })).items.filter((item) => item.id === webinarId);
}

async function vaga(user) {
  unwrap(await db.from("webinar_registrations").insert({ session_id: sessaoId, source: "page", status: "registered", user_id: user.id, webinar_id: webinarId }), "Gravando uma vaga");
}

before(async () => {
  await limparWebinarios(db);
  await seedWebinarioDeTeste(db);
});

after(async () => {
  actAs(null);
  await limparWebinarios(db);
});

test("1. so o encerrado ou o cancelado se arquiva; quem nao publica recebe 403", async () => {
  actAs(produtor);
  const agendado = await actions.archiveWebinar({ id: webinarId });
  assert.deepEqual([agendado.ok, agendado.status], [false, 409], "o agendado nao se arquiva");
  assert.equal((await linha()).status, "published");

  await encerrarSessao();
  actAs(analista);
  const semPublicar = await actions.archiveWebinar({ id: webinarId });
  assert.deepEqual([semPublicar.ok, semPublicar.status], [false, 403]);
  assert.equal((await linha()).status, "published");
});

test("2. arquivar: sai da lista sem filtro e da area do aluno; fica no filtro Arquivado; nada se apaga; o arquivado nao se salva", async () => {
  await vaga(aluna);
  actAs(produtor);
  const arquivado = ok(await actions.archiveWebinar({ id: webinarId }));
  assert.equal(arquivado.situation, "archived");
  assert.equal((await linha()).status, "archived");

  assert.deepEqual(await lista(), [], "sem filtro, o arquivado fica de fora");
  const noFiltro = await lista("archived");
  assert.equal(noFiltro.length, 1);
  assert.equal(noFiltro[0].situation, "archived");
  assert.equal(noFiltro[0].deletable, false, "com a vaga da aluna, o Excluir nao aparece");
  assert.equal(noFiltro[0].registeredCount, 1, "a vaga continua");

  assert.equal(await getStudentWebinar(aluna.id, WEBINARIO_DE_TESTE.slug), null, "a pagina do aluno fecha");

  const editor = await getWebinarEditorData(webinarId);
  assert.equal(editor.situation, "archived");
  assert.equal(editor.deletable, false);

  // Com dados de aluno, o Excluir e recusado pelo servidor mesmo que alguem o chame.
  const excluir = await actions.deleteWebinar({ id: webinarId });
  assert.deepEqual([excluir.ok, excluir.status], [false, 409]);
  assert.equal((await linha()).deleted_at, null);
});

test("3. desarquivar: volta como era (encerrado), na lista e na area do aluno", async () => {
  actAs(produtor);
  const volta = ok(await actions.unarchiveWebinar({ id: webinarId }));
  assert.equal(volta.situation, "ended");
  assert.equal((await linha()).status, "published");
  const item = await lista();
  assert.equal(item.length, 1);
  assert.equal(item[0].situation, "ended");
  assert.notEqual(await getStudentWebinar(aluna.id, WEBINARIO_DE_TESTE.slug), null, "a pagina do aluno abre de novo");
  const deNovo = await actions.unarchiveWebinar({ id: webinarId });
  assert.deepEqual([deNovo.ok, deNovo.status], [false, 409], "o que nao esta arquivado nao se desarquiva");
});

test("4. o arquivado so com a equipe (a vaga do produtor nao conta) pode ser excluido, e sai da lista e do editor", async () => {
  unwrap(await db.from("webinar_registrations").delete().eq("webinar_id", webinarId).eq("user_id", aluna.id), "Tirando a vaga da aluna");
  await vaga(produtor);
  // Mais de 500 amostras de presenca, todas da equipe (o produtor e a analista estao em admin_roles): a quantidade de
  // linhas nunca decide; o banco filtra a equipe pelo not.in (webinarDataAuthors).
  const amostras = [produtor, analista].flatMap((pessoa) => Array.from({ length: 255 }, (_, bucket) => ({ bucket, session_id: sessaoId, state: "playing", user_id: pessoa.id })));
  unwrap(await db.from("webinar_presence_samples").insert(amostras), "Gravando a presenca da equipe");
  actAs(produtor);
  ok(await actions.archiveWebinar({ id: webinarId }));

  const noFiltro = await lista("archived");
  assert.equal(noFiltro[0].deletable, true, "so a equipe deixou dados, mesmo com 510 amostras de presenca");

  const salvar = await actions.saveWebinarDraft({ draft: (await getWebinarEditorData(webinarId)).draft, expectedUpdatedAt: (await linha()).updated_at, id: webinarId });
  assert.deepEqual([salvar.ok, salvar.status], [false, 409], "o arquivado nao se salva");

  ok(await actions.deleteWebinar({ id: webinarId }));
  assert.notEqual((await linha()).deleted_at, null);
  assert.deepEqual(await lista("archived"), []);
  assert.equal(await getWebinarEditorData(webinarId), null);
});
