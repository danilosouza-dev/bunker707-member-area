import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, readLocalSupabaseConfig, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, apagarContaDeTeste, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Admin: Alunos (docs/18 §3.2) contra o banco e o Auth LOCAIS de verdade: adicionar aluno com senha
// temporaria e produto liberado, o aluno entrar com essa senha e abrir a aula, liberar mais produtos,
// estender, revogar e reativar o acesso, importar em lote e excluir a conta. Mesma rotina que os
// webhooks de venda vao usar (src/server/students/access.ts), so que chamada pelo admin.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/students/actions.ts");
const { requireLessonAccess } = await import("../../src/server/access/lesson-access.ts");
const { getHomePageData } = await import("../../src/server/db/platform-store.ts");

const { curso, cursoLiberacao } = ESCOLA_DE_TESTE;
const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const NOVO = { email: "aluno.novo.3i@bunker707.test", nome: "Aluno Novo 3i" };
const IMPORTADO = { email: "aluno.importado.3i@bunker707.test", nome: "Aluno Importado 3i" };

async function limpar() {
  await apagarContaDeTeste(db, NOVO.email);
  await apagarContaDeTeste(db, IMPORTADO.email);
}

before(limpar);
after(limpar);

const estado = { id: "", senhaTemporaria: "" };

async function acessosDoAluno(userId) {
  return unwrap(await db.from("entitlements").select("id,status,ends_at,target_id").eq("user_id", userId).order("created_at"), "Lendo acessos");
}

async function entrarComSenha(email, password) {
  const { createClient } = await import("@supabase/supabase-js");
  const { anonKey, url } = readLocalSupabaseConfig();
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return client.auth.signInWithPassword({ email, password });
}

test("analista nao adiciona aluno (403); sem sessao 401; pedido sem e-mail e 400 no campo", async () => {
  actAs(analista);
  assert.equal((await actions.createStudent({ delivery: "none", email: NOVO.email, fullName: NOVO.nome })).status, 403);
  actAs(null);
  assert.equal((await actions.createStudent({ delivery: "none", email: NOVO.email, fullName: NOVO.nome })).status, 401);
  actAs(produtor);
  const semEmail = await actions.createStudent({ delivery: "none", email: "", fullName: NOVO.nome });
  assert.equal(semEmail.status, 400);
  assert.ok(semEmail.fieldErrors?.email);
});

test("produtor adiciona um aluno com senha temporaria e o curso liberado: a conta nasce no Auth com acesso ativo", async () => {
  actAs(produtor);
  const result = await actions.createStudent({ delivery: "temporary_password", email: NOVO.email, fullName: NOVO.nome, productIds: [curso.id] });

  assert.equal(result.ok, true, JSON.stringify(result));
  estado.id = result.data.id;
  estado.senhaTemporaria = result.data.temporaryPassword ?? "";
  assert.equal(result.data.existingAccount, false);
  assert.deepEqual(result.data.grantedProductIds, [curso.id]);
  assert.ok(estado.senhaTemporaria.length >= 8, "veio uma senha temporaria");

  const acessos = await acessosDoAluno(estado.id);
  assert.deepEqual(acessos.map((row) => [row.target_id, row.status]), [[curso.id, "active"]]);
  const perfil = unwrap(await db.from("profiles").select("full_name,email").eq("id", estado.id).single(), "Lendo perfil");
  assert.equal(perfil.full_name, NOVO.nome);
});

test("o aluno novo entra com a senha temporaria, precisa trocar a senha, e ja abre a aula do curso liberado", async () => {
  const { data, error } = await entrarComSenha(NOVO.email, estado.senhaTemporaria);
  assert.equal(error, null, error?.message);
  assert.equal(data.user.id, estado.id);
  assert.equal(data.user.user_metadata.must_change_password, true, "senha temporaria pede troca");

  const acesso = await requireLessonAccess({ contentId: curso.id, lessonId: curso.aulas.aula1, userId: estado.id });
  assert.equal(acesso.isAdmin, false);

  const { homeRows } = await getHomePageData(undefined, usuarioDeTeste({ ...NOVO, id: estado.id }));
  const compras = homeRows.find((row) => row.title === "Minhas compras");
  assert.deepEqual(compras?.items.map((item) => item.id), [curso.id]);
});

test("adicionar de novo o mesmo e-mail nao duplica: a conta existente e atualizada e o acesso continua um so", async () => {
  actAs(produtor);
  const result = await actions.createStudent({ delivery: "none", email: NOVO.email.toUpperCase(), fullName: NOVO.nome, productIds: [curso.id] });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.existingAccount, true);
  assert.equal(result.data.id, estado.id);
  assert.equal((await acessosDoAluno(estado.id)).length, 1, "sem acesso duplicado");
});

test("liberar outro produto: entra; produto que nao existe e devolvido como faltante", async () => {
  actAs(produtor);
  const result = await actions.grantStudentAccess({ productIds: [cursoLiberacao.id, "produto-que-nao-existe"], userId: estado.id });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.granted, 1);
  assert.deepEqual(result.data.missingProductIds, ["produto-que-nao-existe"]);
  assert.deepEqual((await acessosDoAluno(estado.id)).map((row) => row.target_id).sort(), [curso.id, cursoLiberacao.id].sort());
});

test("estender 30 dias, marcar uma data, tirar a data, revogar (o aluno perde a aula) e reativar", async () => {
  actAs(produtor);
  const acesso = (await acessosDoAluno(estado.id)).find((row) => row.target_id === curso.id);
  const alunoNovo = { ...NOVO, id: estado.id };

  const estendido = await actions.updateStudentAccess({ action: "extend_30", entitlementId: acesso.id, userId: estado.id });
  assert.equal(estendido.ok, true, JSON.stringify(estendido));
  const dias = (Date.parse(estendido.data.endsAt) - Date.now()) / 86_400_000;
  assert.ok(dias > 29 && dias < 31, `termina em ~30 dias (${dias.toFixed(1)})`);

  const comData = await actions.updateStudentAccess({ action: "set_end", endsAt: "2099-12-31", entitlementId: acesso.id, userId: estado.id });
  assert.equal(comData.ok, true, JSON.stringify(comData));
  // A data escolhida vira o fim daquele dia no fuso da escola (Sao Paulo).
  assert.equal(new Date(comData.data.endsAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }), "31/12/2099");

  const semData = await actions.updateStudentAccess({ action: "remove_end", entitlementId: acesso.id, userId: estado.id });
  assert.equal(semData.data.endsAt, null, "vitalicio de novo");

  const revogado = await actions.updateStudentAccess({ action: "revoke", entitlementId: acesso.id, userId: estado.id });
  assert.equal(revogado.data.status, "revoked");
  await assert.rejects(requireLessonAccess({ contentId: curso.id, lessonId: curso.aulas.aula1, userId: estado.id }), /nao tem acesso/);
  const { homeRows } = await getHomePageData(undefined, usuarioDeTeste(alunoNovo));
  assert.ok(!(homeRows.find((row) => row.title === "Minhas compras")?.items ?? []).some((item) => item.id === curso.id), "revogado sai de Minhas compras");

  const reativado = await actions.updateStudentAccess({ action: "reactivate", entitlementId: acesso.id, userId: estado.id });
  assert.equal(reativado.data.status, "active");
  assert.equal((await requireLessonAccess({ contentId: curso.id, lessonId: curso.aulas.aula1, userId: estado.id })).isAdmin, false);

  const semData2 = await actions.updateStudentAccess({ action: "set_end", entitlementId: acesso.id, userId: estado.id });
  assert.equal(semData2.status, 400, "set_end sem data e recusado");
  const acessoDeOutro = await actions.updateStudentAccess({ action: "revoke", entitlementId: acesso.id, userId: contas.aluna.id });
  assert.equal(acessoDeOutro.status, 404, "acesso de outra pessoa nao e encontrado");
});

test("importar em lote: a conta nasce com o produto liberado", async () => {
  actAs(produtor);
  const result = await actions.importStudentsBatch({
    batchId: randomUUID(),
    delivery: "none",
    rows: [{ email: IMPORTADO.email, fullName: IMPORTADO.nome, index: 1, productIds: [curso.id] }]
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  const { users } = unwrap(await db.auth.admin.listUsers({ page: 1, perPage: 1000 }), "Lendo contas");
  const importado = users.find((user) => user.email === IMPORTADO.email);
  assert.ok(importado, "a conta importada existe");
  assert.deepEqual((await acessosDoAluno(importado.id)).map((row) => [row.target_id, row.status]), [[curso.id, "active"]]);
});

test("excluir o aluno exige o e-mail certo; apaga a conta e os acessos; analista nao exclui", async () => {
  actAs(analista);
  assert.equal((await actions.deleteStudent({ confirmEmail: NOVO.email, userId: estado.id })).status, 403);

  actAs(produtor);
  const emailErrado = await actions.deleteStudent({ confirmEmail: "outro@bunker707.test", userId: estado.id });
  assert.ok(emailErrado.status >= 400, `status ${emailErrado.status}`);

  const apagado = await actions.deleteStudent({ confirmEmail: NOVO.email, userId: estado.id });
  assert.equal(apagado.ok, true, JSON.stringify(apagado));
  const { users } = unwrap(await db.auth.admin.listUsers({ page: 1, perPage: 1000 }), "Lendo contas");
  assert.ok(!users.some((user) => user.id === estado.id), "a conta sumiu do Auth");
  assert.deepEqual(await acessosDoAluno(estado.id), []);
});
