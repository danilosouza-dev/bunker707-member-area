import type { Page } from "@playwright/test";
import { expect, test, zerarComentariosDeTeste, zerarFotoDosAlunos, zerarProgressoDosAlunos } from "./fixtures";
import { ESCOLA_DE_TESTE } from "../fixtures/escola-de-teste.mjs";
import { pngQuadrado } from "../support/imagem-de-teste.mjs";

// Foto do perfil no navegador (docs/18 §3.1 "Perfil e foto"), em Chromium e em WebKit, o motor do Safari,
// do iPhone e do iPad (onde a foto quebrou no #55: o canvas nao gera WebP e o app precisa cair para JPEG).
// Enviar, ver no cabecalho do perfil, no menu do topo, na caixa de comentar e no comentario; remover e
// voltar para as iniciais.

const { contas, curso } = ESCOLA_DE_TESTE;
const enderecoDaAula = `/conteudo/${curso.id}/aulas/${curso.modulos.modulo1}?lessonId=${curso.aulas.aula1}`;
const FOTO_NO_BUCKET = /content-assets\/avatars\//;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await zerarProgressoDosAlunos();
  await zerarComentariosDeTeste();
  await zerarFotoDosAlunos();
});

function menuDaConta(page: Page) {
  return page.getByRole("button", { name: `Menu da conta de ${contas.aluna.nome}` });
}

test("no perfil, escolher a imagem abre o recorte; salvar grava e a foto aparece no cabecalho e no menu do topo", async ({ page }) => {
  await page.goto("/perfil");
  await expect(menuDaConta(page).locator("img")).toHaveCount(0);

  const escolha = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Adicionar foto do perfil" }).click();
  await (await escolha).setFiles({ buffer: pngQuadrado(400), mimeType: "image/png", name: "foto-de-teste.png" });

  const recorte = page.getByRole("dialog");
  await expect(recorte).toBeVisible();
  const gravacao = page.waitForResponse((response) => response.url().includes("/api/profile/avatar") && response.request().method() === "PUT");
  await recorte.getByRole("button", { name: "Salvar foto" }).click();
  expect((await gravacao).status()).toBe(200);

  await expect(recorte).toBeHidden();
  await expect(page.getByRole("button", { name: "Alterar foto do perfil" })).toBeVisible();
  await expect(page.locator("img[src*='content-assets/avatars/']").first()).toBeVisible();
  await expect(menuDaConta(page).locator("img")).toHaveAttribute("src", FOTO_NO_BUCKET);
});

test("a foto aparece na caixa de comentar e no comentario publicado", async ({ page }) => {
  await page.goto(enderecoDaAula);
  await expect(menuDaConta(page).locator("img")).toHaveAttribute("src", FOTO_NO_BUCKET);

  const caixa = page.locator("form[aria-label='Novo comentário']");
  await expect(caixa.locator("img[src*='content-assets/avatars/']")).toBeVisible();

  await page.locator("#lesson-comment").fill("Comentário com foto de perfil.");
  const publicacao = page.waitForResponse((response) => response.url().includes("/api/comments/lessons/") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Publicar comentário" }).click();
  expect((await publicacao).status()).toBe(201);

  await expect(page.getByText("Comentário com foto de perfil.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Comentário com foto de perfil.")).toBeVisible();
  // Cabecalho do comentario: a foto da autora, vinda do banco.
  await expect(page.locator("img[src*='content-assets/avatars/']").nth(1)).toBeVisible();
});

test("remover a foto volta para as iniciais no perfil e no menu", async ({ page }) => {
  await page.goto("/perfil");
  await expect(menuDaConta(page).locator("img")).toHaveAttribute("src", FOTO_NO_BUCKET);

  const remocao = page.waitForResponse((response) => response.url().includes("/api/profile/avatar") && response.request().method() === "DELETE");
  await page.getByRole("button", { name: "Remover foto" }).click();
  expect((await remocao).status()).toBe(200);

  await expect(page.getByRole("button", { name: "Adicionar foto do perfil" })).toBeVisible();
  await expect(menuDaConta(page).locator("img")).toHaveCount(0);
  await expect(page.locator("img[src*='content-assets/avatars/']")).toHaveCount(0);
});
