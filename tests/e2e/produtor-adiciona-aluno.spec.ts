import type { Locator } from "@playwright/test";
import { apagarConta, expect, test } from "./fixtures";
import { ESCOLA_DE_TESTE } from "../fixtures/escola-de-teste.mjs";

// Admin: Alunos no navegador (docs/17 §1.7.2 e docs/18 §3.2): o produtor adiciona um aluno com senha
// temporaria e o curso liberado; o aluno entra com essa senha, troca a senha e ja ve o curso na home.

const { curso } = ESCOLA_DE_TESTE;
const ALUNO = { email: "aluno.navegador.3i@bunker707.test", nome: "Aluno do Navegador 3i" };
const NOVA_SENHA = "nova-senha-do-aluno-2026";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await apagarConta(ALUNO.email);
});

test.afterAll(async () => {
  await apagarConta(ALUNO.email);
});

async function preencher(campo: Locator, valor: string) {
  await campo.fill(valor);

  try {
    await expect(campo).toHaveValue(valor, { timeout: 2_000 });
  } catch {
    await campo.fill(valor);
    await expect(campo).toHaveValue(valor);
  }
}

const senha = { temporaria: "" };

test.describe("produtor", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("adiciona o aluno com senha temporaria e o curso liberado; a tela mostra a senha e o perfil mostra o acesso", async ({ page }) => {
    await page.goto("/admin/alunos/novo");
    await page.waitForLoadState("networkidle");
    await preencher(page.getByPlaceholder("Nome completo"), ALUNO.nome);
    await preencher(page.getByPlaceholder("aluno@exemplo.com"), ALUNO.email);

    await page.getByRole("group", { name: "Produtos a liberar" }).getByText(curso.titulo, { exact: true }).click();
    // As formas de entrega sao pilulas (radio escondido dentro do label): clicar no texto marca.
    await page.getByRole("radiogroup", { name: "Como entregar o acesso" }).getByText("Senha temporária").click();
    await expect(page.getByRole("radio", { name: "Senha temporária" })).toBeChecked();
    await page.getByRole("button", { name: "Adicionar e liberar acesso" }).click();

    await expect(page.getByRole("heading", { name: "Senha temporária criada" })).toBeVisible();
    senha.temporaria = (await page.locator("p.select-all").innerText()).trim();
    expect(senha.temporaria.length).toBeGreaterThanOrEqual(8);

    await page.getByRole("link", { name: "Ver aluno" }).click();
    await expect(page).toHaveURL(/\/admin\/alunos\//);
    await expect(page.getByText(ALUNO.nome).first()).toBeVisible();
    await expect(page.getByText(curso.titulo, { exact: true }).first()).toBeVisible();
  });

});

test.describe("aluno novo", () => {
  // Comeca sem sessao: e o proprio aluno entrando pela primeira vez.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("entra com a senha temporaria, troca a senha e ve o curso liberado na home", async ({ page }) => {
    expect(senha.temporaria, "a senha temporaria veio do teste anterior").not.toBe("");

    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="email"]').fill(ALUNO.email);
    await page.locator('input[type="password"]').fill(senha.temporaria);
    await page.getByRole("button", { exact: true, name: "Entrar" }).click();

    // Senha temporaria pede uma nova senha antes de entrar.
    await expect(page).toHaveURL(/\/alterar-senha/);
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder("Minimo de 8 caracteres").fill(NOVA_SENHA);
    await page.getByPlaceholder("Repita a nova senha").fill(NOVA_SENHA);
    await page.getByRole("button", { name: "Salvar e entrar" }).click();

    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { level: 2, name: "Minhas compras" })).toBeVisible();
    const card = page.getByRole("link", { name: `Abrir ${curso.titulo}` });
    await expect(card).toBeVisible();
    await expect(card.getByRole("button", { name: "Acessar" })).toBeVisible();

    await page.goto(`/conteudo/${curso.id}/aulas/${curso.modulos.modulo1}`);
    await expect(page.getByRole("heading", { level: 1, name: "Aula 1: O que é um agente" })).toBeVisible();
  });
});
