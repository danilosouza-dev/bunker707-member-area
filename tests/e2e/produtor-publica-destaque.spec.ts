import { expect, test, zerarAreaDeMembros } from "./fixtures";

// Admin: Area de membros > Destaque no navegador (docs/17 §1.6.8 e docs/18 §3.2): o produtor escreve um
// titulo, liga "Mostrar titulo", publica, e a aluna ve o titulo novo no topo da home.

const TITULO = "Destaque E2E: a IA vira método";

test.describe.configure({ mode: "serial" });

test.beforeAll(zerarAreaDeMembros);
test.afterAll(zerarAreaDeMembros);

test.describe("produtor", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("escreve o titulo do destaque, liga Mostrar e publica", async ({ page }) => {
    await page.goto("/admin/area-de-membros/destaque");
    await page.waitForLoadState("networkidle");

    await page.getByLabel("Título", { exact: true }).fill(TITULO);
    await expect(page.getByLabel("Título", { exact: true })).toHaveValue(TITULO);
    const mostrar = page.getByRole("switch", { name: "Mostrar o título" });
    if ((await mostrar.getAttribute("aria-checked")) !== "true") {
      await mostrar.click();
    }
    await expect(mostrar).toHaveAttribute("aria-checked", "true");

    await page.getByRole("button", { name: "Publicar destaque" }).click();
    await expect(page.getByText("Destaque publicado. Os alunos já veem o novo topo da home.")).toBeVisible();
  });
});

test.describe("aluna", () => {
  test("ve o titulo novo no topo da home", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: TITULO })).toBeVisible();
  });
});
