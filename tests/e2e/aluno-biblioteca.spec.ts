import { expect, test, zerarComentariosDeTeste, zerarProgressoDosAlunos } from "./fixtures";
import { ESCOLA_DE_TESTE } from "../fixtures/escola-de-teste.mjs";

// Passeio pela biblioteca do aluno no navegador (docs/18 §3.1): favoritar pelo card e ver em Favoritos,
// Minhas compras com o acesso, a aba Materiais da aula e a pagina Materiais, Minha jornada e Suporte.

const { curso } = ESCOLA_DE_TESTE;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await zerarProgressoDosAlunos();
  await zerarComentariosDeTeste();
});

test("favoritar o curso pelo card da home: aparece em Favoritos; remover la tira", async ({ page }) => {
  await page.goto("/");
  const salvar = page.getByRole("button", { name: `Salvar ${curso.titulo} nos favoritos` });
  const gravacao = page.waitForResponse((response) => response.url().includes("/api/saved-items") && response.request().method() === "PUT");
  await salvar.click();
  expect((await gravacao).status()).toBe(200);
  await expect(page.getByRole("button", { name: `Remover ${curso.titulo} dos favoritos` })).toBeVisible();

  await page.goto("/favoritos");
  await expect(page.getByRole("heading", { level: 2, name: "Conteúdos" })).toBeVisible();
  await expect(page.getByRole("link", { name: `Abrir ${curso.titulo}` })).toBeVisible();

  const remocao = page.waitForResponse((response) => response.url().includes("/api/saved-items") && response.request().method() === "PUT");
  await page.getByRole("button", { name: `Remover ${curso.titulo} dos favoritos` }).click();
  expect((await remocao).status()).toBe(200);
  await expect(page.getByRole("link", { name: `Abrir ${curso.titulo}` })).toHaveCount(0);
});

test("Minhas compras lista os dois cursos comprados com o acesso vitalicio", async ({ page }) => {
  await page.goto("/minhas-compras");
  await expect(page.getByRole("link", { name: `Abrir ${curso.titulo}` })).toBeVisible();
  await expect(page.getByRole("link", { name: `Abrir ${ESCOLA_DE_TESTE.cursoLiberacao.titulo}` })).toBeVisible();
  await expect(page.getByText("Acesso vitalício").first()).toBeVisible();
  await expect(page.getByRole("link", { name: `Abrir ${ESCOLA_DE_TESTE.cursoBloqueado.titulo}` })).toHaveCount(0);
});

test("Materiais: a aba da aula separa disponivel e para liberar; a pagina Materiais reune e leva a aula", async ({ page }) => {
  await page.goto(`/conteudo/${curso.id}/aulas/${curso.modulos.modulo1}?lessonId=${curso.aulas.aula1}`);
  await page.getByRole("tab", { name: /Materiais/ }).click();
  await expect(page.getByRole("heading", { name: "Disponíveis" })).toBeVisible();
  await expect(page.getByText("Apostila da aula 1")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Para liberar" })).toBeVisible();
  await expect(page.getByText("Checklist da aula 1")).toBeVisible();

  await page.goto("/materiais");
  await expect(page.getByText("Apostila da aula 1")).toBeVisible();
  await expect(page.getByText("Material em rascunho")).toHaveCount(0);
  await expect(page.getByText("Material da aula futura")).toHaveCount(0);
  await page.getByRole("link", { name: "Ir para a aula Aula 1: O que é um agente" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Aula 1: O que é um agente" })).toBeVisible();
});

test("Minha jornada e Suporte abrem com os numeros e as perguntas frequentes", async ({ page }) => {
  await page.goto("/minha-jornada");
  await expect(page.getByText("Aulas concluídas")).toBeVisible();
  await expect(page.getByText("Cursos em andamento")).toBeVisible();
  await expect(page.getByRole("link", { name: `Abrir ${curso.titulo}` })).toBeVisible();

  await page.goto("/suporte");
  await expect(page.getByRole("heading", { name: "Perguntas frequentes" })).toBeVisible();
});
