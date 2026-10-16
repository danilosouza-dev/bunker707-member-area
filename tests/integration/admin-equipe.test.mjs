import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Admin: quem entra, quem escreve e a Equipe (docs/18 §3.2), contra o banco LOCAL de verdade: guardas
// de pagina e de rota, Server Actions da Equipe (adicionar, mudar funcao, tirar) e a trava do banco que
// nunca deixa a escola sem dono.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const guards = await import("../../src/server/auth/guards.ts");
const permissions = await import("../../src/server/auth/permissions.ts");
const teamActions = await import("../../src/server/team/actions.ts");
const teamQueries = await import("../../src/server/team/queries.ts");
const { loadAdminAccess } = await import("../../src/server/auth/admin-access.ts");

const aluna = usuarioDeTeste(contas.aluna);
const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const professor = usuarioDeTeste(contas.professor);
const NOVA_PESSOA = { email: "nova.pessoa@bunker707.test", nome: "Nova Pessoa" };

async function apagarNovaPessoa() {
  const { users } = unwrap(await db.auth.admin.listUsers({ page: 1, perPage: 1000 }), "Lendo contas");
  const existing = users.find((user) => user.email === NOVA_PESSOA.email);

  if (existing) {
    unwrap(await db.from("admin_roles").delete().eq("user_id", existing.id), "Tirando a pessoa de teste da equipe");
    unwrap(await db.auth.admin.deleteUser(existing.id), "Apagando a conta de teste");
  }
}

before(apagarNovaPessoa);
after(apagarNovaPessoa);

/* ------------------------------------------------------------------ Guardas */

test("quem nao e da equipe nao entra no admin: a pagina manda para a home; a rota responde 403", async () => {
  actAs(aluna);
  await assert.rejects(guards.requirePageAdmin(), /redirect:\//);

  const api = await guards.requireApiAdmin();
  assert.equal(api.response?.status, 403);

  actAs(null);
  await assert.rejects(guards.requirePageAdmin(), /redirect:\/login/);
  assert.equal((await guards.requireApiAdmin()).response?.status, 401);
});

test("produtor entra como dono; analista entra, mas pagina de uma permissao que ele nao tem volta para a area dele", async () => {
  actAs(produtor);
  const dono = await guards.requirePageAdmin();
  assert.equal(dono.role, "owner");
  const equipe = await permissions.requirePageRole("settings.team", "/admin/configuracoes");
  assert.equal(equipe.user.id, contas.produtor.id);

  actAs(analista);
  const leitura = await guards.requirePageAdmin();
  assert.equal(leitura.role, "analyst");
  await assert.rejects(permissions.requirePageRole("settings.team", "/admin/configuracoes"), /redirect:\/admin\/configuracoes/);

  const rota = await guards.requireApiAdmin({ roles: ["owner"] });
  assert.equal(rota.response?.status, 403);
  const rotaPorAcao = await permissions.requireApiRole("settings.team");
  assert.equal(rotaPorAcao.response?.status, 403);
});

/* ----------------------------------------------------------- Equipe: escritas */

test("analista e professor recebem 403 em qualquer escrita da Equipe; aluno tambem", async () => {
  for (const [nome, user] of [["analista", analista], ["professor", professor], ["aluna", aluna]]) {
    actAs(user);
    const result = await teamActions.addTeamMember({ email: NOVA_PESSOA.email, fullName: NOVA_PESSOA.nome, functions: ["support"] });
    assert.equal(result.ok, false, `${nome} nao adiciona`);
    assert.equal(result.status, 403, `${nome}: status 403`);
  }

  actAs(null);
  const semSessao = await teamActions.addTeamMember({ email: NOVA_PESSOA.email, fullName: NOVA_PESSOA.nome, functions: ["support"] });
  assert.equal(semSessao.status, 401);
});

test("dono adiciona uma pessoa como Suporte: a conta nasce no Auth local, entra na lista e ja abre o admin", async () => {
  actAs(produtor);
  const result = await teamActions.addTeamMember({ email: NOVA_PESSOA.email, fullName: NOVA_PESSOA.nome, functions: ["support"] });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.existingAccount, false);

  const members = await teamQueries.listTeamMembers();
  const nova = members.find((member) => member.email === NOVA_PESSOA.email);
  assert.ok(nova, "a pessoa aparece na lista da Equipe");
  assert.equal(nova.fullName, NOVA_PESSOA.nome);
  assert.equal(nova.role, "support");

  const access = await loadAdminAccess(result.data.userId);
  assert.equal(access?.role, "support");
  actAs({ ...usuarioDeTeste({ ...NOVA_PESSOA, id: result.data.userId }) });
  assert.equal((await guards.requirePageAdmin()).role, "support", "a pessoa nova entra no admin na hora");
});

test("pedido invalido vira 400 com o campo: sem funcao nenhuma, e-mail errado", async () => {
  actAs(produtor);
  const semFuncao = await teamActions.addTeamMember({ email: "outra@bunker707.test", fullName: "Outra", functions: [] });
  assert.equal(semFuncao.status, 400);
  assert.ok(semFuncao.fieldErrors?.functions, "aponta o campo das funcoes");

  const emailErrado = await teamActions.addTeamMember({ email: "nao-e-email", functions: ["support"] });
  assert.equal(emailErrado.status, 400);
  assert.ok(emailErrado.fieldErrors?.email);
});

test("dono troca a funcao da pessoa para Analista e depois a tira da equipe; a conta continua, sem admin", async () => {
  actAs(produtor);
  const antes = (await teamQueries.listTeamMembers()).find((member) => member.email === NOVA_PESSOA.email);
  assert.ok(antes);

  const troca = await teamActions.updateTeamMember({ functions: ["analyst"], userId: antes.userId });
  assert.equal(troca.ok, true, JSON.stringify(troca));
  assert.equal((await loadAdminAccess(antes.userId))?.role, "analyst");

  const remocao = await teamActions.removeTeamMember({ userId: antes.userId });
  assert.equal(remocao.ok, true, JSON.stringify(remocao));
  assert.equal(await loadAdminAccess(antes.userId), null, "sem admin");
  assert.ok(!(await teamQueries.listTeamMembers()).some((member) => member.userId === antes.userId), "saiu da lista");
  const { users } = unwrap(await db.auth.admin.listUsers({ page: 1, perPage: 1000 }), "Lendo contas");
  assert.ok(users.some((user) => user.email === NOVA_PESSOA.email), "a conta continua existindo");

  const deNovo = await teamActions.removeTeamMember({ userId: antes.userId });
  assert.equal(deNovo.status, 404, "tirar quem ja saiu");
});

test("ninguem mexe na propria linha; e o banco nunca deixa a escola sem dono", async () => {
  actAs(produtor);
  const proprio = await teamActions.removeTeamMember({ userId: contas.produtor.id });
  assert.equal(proprio.status, 409);
  assert.match(proprio.error ?? "", /voc[eê]/i);

  // A trava do banco (gatilho last_owner) vale mesmo para quem escreve direto com a chave de servico.
  const direto = await db.from("admin_roles").delete().eq("user_id", contas.produtor.id);
  assert.ok(direto.error, "o banco recusa");
  assert.match(direto.error.message, /last_owner/);
  assert.equal((await loadAdminAccess(contas.produtor.id))?.role, "owner", "o dono continua");

  const rebaixado = await db.from("admin_roles").update({ role: "analyst" }).eq("user_id", contas.produtor.id);
  assert.match(rebaixado.error?.message ?? "", /last_owner/, "rebaixar o ultimo dono tambem e recusado");
});
