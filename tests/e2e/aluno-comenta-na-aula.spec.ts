import type { Page } from "@playwright/test";
import { expect, test, zerarComentariosDeTeste, zerarProgressoDosAlunos } from "./fixtures";
import { ESCOLA_DE_TESTE } from "../fixtures/escola-de-teste.mjs";

// Comentarios na pagina da aula (docs/18 §3.1 "Comentarios"), no navegador: publicar, responder e
// reagir, e tudo continuar la depois de recarregar (vem do banco, nao da memoria da tela).

const { curso } = ESCOLA_DE_TESTE;
const enderecoDaAula = `/conteudo/${curso.id}/aulas/${curso.modulos.modulo1}?lessonId=${curso.aulas.aula1}`;
const COMENTARIO = "Minha dúvida de teste: o agente precisa de memória?";
const RESPOSTA = "Respondendo a mim mesma: precisa, sim.";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await zerarProgressoDosAlunos();
  await zerarComentariosDeTeste();
});

/** Espera a rota de comentarios responder com o status esperado depois de uma acao. */
async function agirEEsperar(page: Page, acao: () => Promise<void>, status: number) {
  const resposta = page.waitForResponse((response) => response.url().includes("/api/comments/") && response.request().method() !== "GET");
  await acao();
  expect((await resposta).status()).toBe(status);
}

test("aula sem comentarios mostra o convite; a aluna publica e o comentario aparece com o nome dela", async ({ page }) => {
  await page.goto(enderecoDaAula);
  await expect(page.getByRole("heading", { level: 1, name: "Aula 1: O que é um agente" })).toBeVisible();
  await expect(page.getByText("Ainda nao ha comentarios nesta aula.")).toBeVisible();

  await page.locator("#lesson-comment").fill(COMENTARIO);
  await agirEEsperar(page, () => page.getByRole("button", { name: "Publicar comentário" }).click(), 201);

  await expect(page.getByText("Ainda nao ha comentarios nesta aula.")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 3, name: ESCOLA_DE_TESTE.contas.aluna.nome })).toBeVisible();
  await expect(page.getByText(COMENTARIO)).toBeVisible();
  // A caixa esvazia depois de publicar.
  await expect(page.locator("#lesson-comment")).toHaveValue("");
});

test("responder: a caixa vira resposta com a mencao, a resposta entra abaixo do comentario e tudo continua depois de recarregar", async ({ page }) => {
  await page.goto(enderecoDaAula);
  await expect(page.getByText(COMENTARIO)).toBeVisible();

  await page.getByRole("button", { exact: true, name: "Responder" }).first().click();
  await expect(page.getByText(/Respondendo a @\S+/)).toBeVisible();
  await expect(page.locator("#lesson-comment")).toHaveValue(/^@\S+ $/);

  await page.locator("#lesson-comment").fill(RESPOSTA);
  await agirEEsperar(page, () => page.getByRole("button", { name: "Enviar resposta" }).click(), 201);
  await expect(page.getByText(RESPOSTA)).toBeVisible();
  // A caixa volta ao normal.
  await expect(page.getByText(/Respondendo a @\S+/)).toHaveCount(0);

  await page.reload();
  await expect(page.getByText(COMENTARIO)).toBeVisible();
  await expect(page.getByText(RESPOSTA)).toBeVisible();
});

test("reagir ao comentario: abre o seletor, curte, e a reacao continua la depois de recarregar", async ({ page }) => {
  const autora = ESCOLA_DE_TESTE.contas.aluna.nome;
  await page.goto(enderecoDaAula);
  await expect(page.getByText(COMENTARIO)).toBeVisible();

  // As reacoes ficam num menu atras do botao "Reagir"; a curtida gravada vira um botao proprio no
  // comentario, marcado como escolhida (aria-pressed).
  await page.getByRole("button", { name: `Reagir ao comentario de ${autora}` }).first().click();
  await agirEEsperar(page, () => page.getByRole("menuitem", { name: `Curtir no comentario de ${autora}` }).click(), 200);
  const curtida = page.getByRole("button", { name: `Curtir no comentario de ${autora}` }).first();
  await expect(curtida).toBeVisible();
  await expect(curtida).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(page.getByText(COMENTARIO)).toBeVisible();
  await expect(page.getByRole("button", { name: `Curtir no comentario de ${autora}` }).first()).toHaveAttribute("aria-pressed", "true");
});

test("caixa de escrever: Cancelar resposta volta ao normal; Ctrl/Cmd + Enter publica", async ({ page }) => {
  await page.goto(enderecoDaAula);
  await expect(page.getByText(COMENTARIO)).toBeVisible();

  await page.getByRole("button", { exact: true, name: "Responder" }).first().click();
  await expect(page.getByText(/Respondendo a @\S+/)).toBeVisible();
  await page.getByRole("button", { name: "Cancelar resposta" }).click();
  await expect(page.getByText(/Respondendo a @\S+/)).toHaveCount(0);
  await expect(page.locator("#lesson-comment")).toHaveValue("");

  const ATALHO = "Publicado com o atalho do teclado.";
  await page.locator("#lesson-comment").fill(ATALHO);
  await agirEEsperar(page, () => page.locator("#lesson-comment").press("Control+Enter"), 201);
  await expect(page.getByText(ATALHO)).toBeVisible();
  await expect(page.locator("#lesson-comment")).toHaveValue("");
});
