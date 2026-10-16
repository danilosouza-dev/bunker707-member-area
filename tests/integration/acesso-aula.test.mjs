import assert from "node:assert/strict";
import { test } from "node:test";
import "../support/integration-hooks.mjs";
import { createLocalAdminClient } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, seedEscolaDeTeste } from "../fixtures/escola-de-teste.mjs";

// Regra central de acesso a aula (src/server/access/lesson-access.ts) contra o banco LOCAL de verdade
// (docs/18 §1.5 item 2 e §3.1 "Curso, formacao e modulos"). E a mesma regra que progresso, comentarios,
// materiais, reacoes e Tutor reutilizam: quem pode abrir a aula, quem recebe 403 e quem recebe 404.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const { requireLessonAccess, requireLessonsAccess } = await import("../../src/server/access/lesson-access.ts");

const { curso, cursoBloqueado, cursoLiberacao } = ESCOLA_DE_TESTE;

/** Confere que a chamada e recusada com o status esperado e uma mensagem para o aluno. */
async function recusa(promise, status, trechoDaMensagem) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.name, "LessonAccessError", `erro esperado: LessonAccessError, veio ${error.name}: ${error.message}`);
    assert.equal(error.status, status, `status ${status}, veio ${error.status}: ${error.message}`);
    assert.match(error.message, trechoDaMensagem);
    return true;
  });
}

test("aluna com acesso abre a aula do curso comprado, como aluna, com o video da aula", async () => {
  const acesso = await requireLessonAccess({ contentId: curso.id, lessonId: curso.aulas.aula1, userId: contas.aluna.id });

  assert.equal(acesso.isAdmin, false);
  assert.equal(acesso.lessonId, curso.aulas.aula1);
  assert.equal(acesso.videoConfig?.provider, "youtube");
});

test("aluno sem compra recebe 403", async () => {
  await recusa(
    requireLessonAccess({ contentId: curso.id, lessonId: curso.aulas.aula1, userId: contas.alunoSemAcesso.id }),
    403,
    /nao tem acesso/
  );
});

test("acesso que terminou ontem nao abre mais a aula (403)", async () => {
  await recusa(
    requireLessonAccess({ contentId: curso.id, lessonId: curso.aulas.aula1, userId: contas.alunaAcessoExpirado.id }),
    403,
    /nao tem acesso/
  );
});

test("aula com data de liberacao no futuro: 403 mesmo com acesso; a aula liberada do mesmo curso abre", async () => {
  await recusa(
    requireLessonAccess({ contentId: cursoLiberacao.id, lessonId: cursoLiberacao.aulas.futura, userId: contas.aluna.id }),
    403,
    /nao estao liberadas/
  );

  const liberada = await requireLessonAccess({ contentId: cursoLiberacao.id, lessonId: cursoLiberacao.aulas.liberada, userId: contas.aluna.id });
  assert.equal(liberada.isAdmin, false);
});

test("aula em rascunho nao existe para o aluno (404)", async () => {
  await recusa(
    requireLessonAccess({ contentId: cursoLiberacao.id, lessonId: cursoLiberacao.aulas.rascunho, userId: contas.aluna.id }),
    404,
    /nao encontrada/
  );
});

test("aula que nao pertence ao curso informado e 404, mesmo com acesso ao curso", async () => {
  await recusa(
    requireLessonAccess({ contentId: curso.id, lessonId: cursoLiberacao.aulas.liberada, userId: contas.aluna.id }),
    404,
    /nao pertencem/
  );
});

test("varias aulas de uma vez: uma de outro curso derruba o pedido inteiro (404); sem aula, 400", async () => {
  await recusa(
    requireLessonsAccess({ contentId: curso.id, lessonIds: [curso.aulas.aula1, cursoBloqueado.aulas.aula1], userId: contas.aluna.id }),
    404,
    /nao pertencem/
  );
  await recusa(requireLessonsAccess({ contentId: curso.id, lessonIds: [" "], userId: contas.aluna.id }), 400, /obrigatoria/);

  const todas = await requireLessonsAccess({
    contentId: curso.id,
    lessonIds: [curso.aulas.aula1, curso.aulas.aula2, curso.aulas.aula3],
    userId: contas.aluna.id
  });
  assert.deepEqual(todas.lessonIds, [curso.aulas.aula1, curso.aulas.aula2, curso.aulas.aula3]);
});

test("produtor (dono) abre qualquer aula sem compra, inclusive a futura, como equipe", async () => {
  const bloqueado = await requireLessonAccess({ contentId: cursoBloqueado.id, lessonId: cursoBloqueado.aulas.aula1, userId: contas.produtor.id });
  assert.equal(bloqueado.isAdmin, true);

  const futura = await requireLessonAccess({ contentId: cursoLiberacao.id, lessonId: cursoLiberacao.aulas.futura, userId: contas.produtor.id });
  assert.equal(futura.isAdmin, true);
});

test("professor com alcance so num curso: abre esse curso como equipe e e tratado como aluno nos outros", async () => {
  const noAlcance = await requireLessonAccess({ contentId: curso.id, lessonId: curso.aulas.aula1, userId: contas.professor.id });
  assert.equal(noAlcance.isAdmin, true);

  await recusa(
    requireLessonAccess({ contentId: cursoBloqueado.id, lessonId: cursoBloqueado.aulas.aula1, userId: contas.professor.id }),
    403,
    /nao tem acesso/
  );
});

test("analista (so leitura na escola toda) abre a aula como equipe", async () => {
  const acesso = await requireLessonAccess({ contentId: cursoBloqueado.id, lessonId: cursoBloqueado.aulas.aula1, userId: contas.analista.id });
  assert.equal(acesso.isAdmin, true);
});
