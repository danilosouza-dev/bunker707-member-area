import { expect, test as setup } from "./fixtures";
import { ESCOLA_DE_TESTE, SENHA_DE_TESTE, limparProgresso, seedEscolaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient } from "../support/local-db.mjs";

// Garante a escola de teste no banco local, zera o progresso das contas de aluno e entra uma vez como
// a aluna; os testes dos projetos chromium e webkit comecam ja logados (storageState em
// playwright.config.ts). Antes de digitar, espera os scripts da tela de entrar carregarem: no WebKit
// a hidratacao do React chega depois e apaga o que foi digitado cedo demais (docs/18 §2.5).

setup("escola de teste pronta e aluna entra com e-mail e senha", async ({ page }) => {
  const db = createLocalAdminClient();
  const contas = await seedEscolaDeTeste(db);
  await limparProgresso(db, [contas.aluna.id, contas.alunoSemAcesso.id]);

  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="email"]').fill(ESCOLA_DE_TESTE.contas.aluna.email);
  await page.locator('input[type="password"]').fill(SENHA_DE_TESTE);
  await page.getByRole("button", { exact: true, name: "Entrar" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: `Abrir ${ESCOLA_DE_TESTE.curso.titulo}` })).toBeVisible();

  await page.context().storageState({ path: "tests/e2e/.auth/aluna.json" });
});

setup("aluno sem acesso entra com e-mail e senha", async ({ page }) => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="email"]').fill(ESCOLA_DE_TESTE.contas.alunoSemAcesso.email);
  await page.locator('input[type="password"]').fill(SENHA_DE_TESTE);
  await page.getByRole("button", { exact: true, name: "Entrar" }).click();

  await expect(page).toHaveURL("/");
  await page.context().storageState({ path: "tests/e2e/.auth/aluno-sem-acesso.json" });
});

// Equipe: depois de entrar, quem e da equipe cai no admin.
for (const [chave, arquivo] of [["produtor", "produtor"], ["analista", "analista"]] as const) {
  setup(`${chave} de teste entra e cai no admin`, async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
  await page.waitForLoadState("networkidle");
    await page.locator('input[type="email"]').fill(ESCOLA_DE_TESTE.contas[chave].email);
    await page.locator('input[type="password"]').fill(SENHA_DE_TESTE);
    await page.getByRole("button", { exact: true, name: "Entrar" }).click();

    await expect(page).toHaveURL(/\/admin/);
    await page.context().storageState({ path: `tests/e2e/.auth/${arquivo}.json` });
  });
}
