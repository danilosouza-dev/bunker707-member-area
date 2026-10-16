import { test as base, expect, type BrowserContext } from "@playwright/test";
import { apagarContaDeTeste, apagarProdutosDeTeste, contasDeTeste, definirCapaDoProduto, limparComentarios, limparConfiguracoesDeTeste, limparFotoDoPerfil, limparProgresso, limparSessoesDeTv } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient } from "../support/local-db.mjs";

// Base dos testes de ponta a ponta: o navegador so fala com a maquina. Qualquer pedido para fora
// (YouTube, PostHog, Sentry, fontes, CDNs) e cortado antes de sair. O player do YouTube continua
// desenhado na pagina; so o video nao carrega, e nenhum teste depende dele.
/** Corta qualquer pedido do navegador que nao seja para a propria maquina. */
export async function bloquearRedeExterna(context: BrowserContext) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort("blockedbyclient"));
}

export const test = base.extend({
  context: async ({ context }, run) => {
    await bloquearRedeExterna(context);
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

/** Apaga as sessoes de TV (e os eventos delas) das contas de aluno. */
export async function zerarSessoesDeTv() {
  const db = createLocalAdminClient();
  const contas = await contasDeTeste(db);
  await limparSessoesDeTv(db, [contas.aluna.id, contas.alunoSemAcesso.id]);
}

/** Apaga os comentarios escritos por todas as contas de teste (alunos e equipe). */
export async function zerarComentariosDeTeste() {
  const db = createLocalAdminClient();
  const contas = await contasDeTeste(db);
  await limparComentarios(db, Object.values(contas).map((conta) => conta.id));
}

/** Tira a foto do perfil das contas de aluno (perfil, comentarios e bucket). */
export async function zerarFotoDosAlunos() {
  const db = createLocalAdminClient();
  const contas = await contasDeTeste(db);
  await limparFotoDoPerfil(db, [contas.aluna.id, contas.alunoSemAcesso.id]);
}

/** Apaga uma conta criada por um teste de navegador (sai da equipe e some do Auth local). */
export async function apagarConta(email: string) {
  await apagarContaDeTeste(createLocalAdminClient(), email);
}

/** Apaga os produtos criados por um teste de navegador (titulo com o prefixo), com modulos e aulas. */
export async function apagarProdutos(prefixoDoTitulo: string) {
  await apagarProdutosDeTeste(createLocalAdminClient(), prefixoDoTitulo);
}

/**
 * Capa do produto por arranjo: enviar a capa pela tela exige recorte em WebP (o WebKit nao gera) e
 * links externos sao cortados nos testes; a capa entra direto no banco, como um link https.
 */
export async function definirCapa(tituloDoProduto: string) {
  await definirCapaDoProduto(createLocalAdminClient(), tituloDoProduto);
}

/** Volta o destaque, as fileiras e a tela de entrar ao padrao (apaga o que um teste publicou). */
export async function zerarAreaDeMembros() {
  await limparConfiguracoesDeTeste(createLocalAdminClient(), ["hero", "homeSections", "loginPage"]);
}
