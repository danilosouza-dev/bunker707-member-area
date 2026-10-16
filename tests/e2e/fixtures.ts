import { test as base, expect } from "@playwright/test";
import { contasDeTeste, limparComentarios, limparProgresso } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient } from "../support/local-db.mjs";

// Base dos testes de ponta a ponta: o navegador so fala com a maquina. Qualquer pedido para fora
// (YouTube, PostHog, Sentry, fontes, CDNs) e cortado antes de sair. O player do YouTube continua
// desenhado na pagina; so o video nao carrega, e nenhum teste depende dele.
export const test = base.extend({
  context: async ({ context }, run) => {
    await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort("blockedbyclient"));
    await run(context);
  }
});

export { expect };

/**
 * Cada arquivo de teste comeca do zero: apaga progresso, favoritos e atividade das contas de aluno (a
 * escola de teste ja foi garantida pelo setup). Use em `test.beforeAll`, porque os arquivos compartilham
 * o banco local e a ordem em que rodam nao pode mudar o resultado. So le as contas, nunca as altera:
 * mexer na conta no Auth derruba o login guardado pelo setup.
 */
export async function zerarProgressoDosAlunos() {
  const db = createLocalAdminClient();
  const contas = await contasDeTeste(db);
  await limparProgresso(db, [contas.aluna.id, contas.alunoSemAcesso.id]);
}

/** Apaga os comentarios escritos por todas as contas de teste (alunos e equipe). */
export async function zerarComentariosDeTeste() {
  const db = createLocalAdminClient();
  const contas = await contasDeTeste(db);
  await limparComentarios(db, Object.values(contas).map((conta) => conta.id));
}
