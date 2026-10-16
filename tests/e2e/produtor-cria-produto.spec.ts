import type { Locator } from "@playwright/test";
import { apagarProdutos, bloquearRedeExterna, definirCapa, expect, test } from "./fixtures";

// Admin: Produtos no navegador (docs/17 §1.6.2 e docs/18 §3.2): o produtor cria um produto, monta dois
// modulos e tres aulas pela arvore (Enter cria e abre a proxima), publica com o checklist, e a aluna
// passa a ver o produto a venda na home.

const TITULO = "Produto E2E: Agentes na prática";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await apagarProdutos("Produto E2E");
});

test.afterAll(async () => {
  await apagarProdutos("Produto E2E");
});

/** Preenche um campo controlado pelo React e confere o valor (no WebKit a hidratacao pode apagar o que foi digitado cedo). */
async function preencher(campo: Locator, valor: string) {
  await campo.fill(valor);

  try {
    await expect(campo).toHaveValue(valor, { timeout: 2_000 });
  } catch {
    await campo.fill(valor);
    await expect(campo).toHaveValue(valor);
  }
}

test.describe("produtor", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("cria o produto, monta 2 modulos e 3 aulas pela arvore e publica", async ({ page }) => {
    await page.goto("/admin/produtos/novo");
    await page.waitForLoadState("networkidle");
    await preencher(page.getByPlaceholder(/^Ex\.:/), TITULO);
    await page.getByRole("button", { name: "Criar produto" }).click();

    await expect(page).toHaveURL(/\/admin\/produtos\/course-produto-e2e/);
    await expect(page.getByText("Este produto ainda não tem aulas.")).toBeVisible();

    // Modulo 1 com duas aulas: Enter cria o modulo e abre a primeira aula; Enter na aula cria e abre outra.
    await page.getByRole("button", { name: "Adicionar módulo" }).first().click();
    const modulo = page.getByPlaceholder("Nome do módulo, ex.: Fundamentos");
    await modulo.fill("Módulo E2E 1");
    await modulo.press("Enter");
    const aula = page.getByPlaceholder("Nome da aula ou link do vídeo");
    await expect(aula).toBeVisible();
    await aula.fill("Aula E2E 1");
    await aula.press("Enter");
    await expect(page.getByText("Aula E2E 1")).toBeVisible();
    await aula.fill("Aula E2E 2");
    await aula.press("Enter");
    await expect(page.getByText("Aula E2E 2")).toBeVisible();
    await page.keyboard.press("Escape");

    // Modulo 2 com uma aula.
    await page.getByRole("button", { name: "Adicionar módulo" }).first().click();
    await modulo.fill("Módulo E2E 2");
    await modulo.press("Enter");
    await expect(aula).toBeVisible();
    await aula.fill("Aula E2E 3");
    await aula.press("Enter");
    await expect(page.getByText("Aula E2E 3")).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.getByRole("list", { name: "Aulas do módulo 1" }).getByText("Aula E2E 1")).toBeVisible();
    await expect(page.getByRole("list", { name: "Aulas do módulo 1" }).getByText("Aula E2E 2")).toBeVisible();
    await expect(page.getByRole("list", { name: "Aulas do módulo 2" }).getByText("Aula E2E 3")).toBeVisible();

    // Capa por arranjo (ver definirCapa), depois publicar pelo checklist.
    await definirCapa(TITULO);
    await page.reload();
    await page.getByRole("button", { exact: true, name: "Publicar" }).click();
    await expect(page.getByText(`Publicar “${TITULO}”`)).toBeVisible();
    await page.getByRole("button", { name: "Publicar agora" }).click();
    await expect(page.getByRole("button", { name: /Situação: Publicado/ })).toBeVisible();
  });

  test("a aluna passa a ver o produto novo a venda na home, bloqueado", async ({ baseURL, browser }) => {
    const context = await browser.newContext({ baseURL, storageState: "tests/e2e/.auth/aluna.json" });
    await bloquearRedeExterna(context);
    const page = await context.newPage();

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: "Produtos a venda" })).toBeVisible();
    const card = page.getByRole("link", { name: `Abrir ${TITULO}` });
    await expect(card).toBeVisible();
    await expect(card.getByText("Conteudo bloqueado")).toBeVisible();

    await context.close();
  });
});
