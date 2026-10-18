import type { Locator, Page } from "@playwright/test";
import { apagarConta, expect, test } from "./fixtures";
import { ESCOLA_DE_TESTE } from "../fixtures/escola-de-teste.mjs";

// Admin no navegador (docs/18 §3.2 "Entrar como equipe" e "Equipe"): o aluno nao entra, o produtor
// abre o admin e cuida da Equipe (adiciona uma pessoa como Suporte e a tira), e o analista entra mas
// nao chega nas telas de escrita.

const { contas } = ESCOLA_DE_TESTE;
const NOVA_PESSOA = { email: "nova.pessoa.navegador@bunker707.test", nome: "Nova Pessoa do Navegador" };

/**
 * Preenche um campo controlado pelo React e confere o valor. No WebKit a pagina pode ainda estar
 * hidratando quando o teste digita, e o estado inicial (vazio) apaga o que foi digitado; nesse caso,
 * preenche de novo.
 */
async function preencher(campo: Locator, valor: string) {
  await campo.fill(valor);

  try {
    await expect(campo).toHaveValue(valor, { timeout: 2_000 });
  } catch {
    await campo.fill(valor);
    await expect(campo).toHaveValue(valor);
  }
}

async function adicionarSuporte(page: Page) {
  // O WebKit pode hidratar os campos controlados depois da primeira navegacao.
  await page.waitForLoadState("networkidle");
  await preencher(page.getByPlaceholder("pessoa@exemplo.com"), NOVA_PESSOA.email);
  await preencher(page.getByPlaceholder("Nome completo"), NOVA_PESSOA.nome);
  // A funcao e um cartao (label) com a caixa escondida: clicar no cartao marca a funcao.
  await page.locator("label", { hasText: "Suporte" }).first().click();
  await expect(page.getByRole("checkbox", { name: /Suporte/ })).toBeChecked();
  await page.getByRole("button", { name: "Adicionar à equipe" }).click();
  await expect(page.getByRole("heading", { name: "Pessoa adicionada à equipe" })).toBeVisible();
}

test.describe("aluno", () => {
  test("quem nao e da equipe nao entra no admin: volta para a home", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL("/");
  });
});

test.describe("produtor", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await apagarConta(NOVA_PESSOA.email);
  });

  test.afterAll(async () => {
    await apagarConta(NOVA_PESSOA.email);
  });

  test("abre o admin e a Equipe lista as pessoas com o botao de adicionar", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin$/);

    await page.goto("/admin/configuracoes/equipe");
    await expect(page).toHaveURL(/\/admin\/configuracoes\/equipe$/);
    // O nome de quem esta logado tambem aparece no menu da conta; na lista, basta o primeiro.
    for (const conta of [contas.produtor, contas.analista, contas.professor]) {
      await expect(page.getByText(conta.nome, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Adicionar pessoa" })).toBeVisible();
  });

  test("apos adicionar Suporte, navegar para a lista nao e interrompido pelo cadastro", async ({ page }) => {
    await page.goto("/admin/configuracoes/equipe/novo");
    await adicionarSuporte(page);

    // Regressao do WebKit: manter a navegacao completa, pois ela interrompia o refresh pendente
    // de /novo e o fallback do Next recarregava o cadastro em vez de abrir a lista.
    await page.goto("/admin/configuracoes/equipe");
    await expect(page).toHaveURL(/\/admin\/configuracoes\/equipe$/);
    await expect(page.getByText(NOVA_PESSOA.nome, { exact: true })).toBeVisible();
  });

  test("tira a pessoa da equipe: ela some da lista", async ({ page }) => {
    await page.goto("/admin/configuracoes/equipe");
    await page.getByText(NOVA_PESSOA.nome, { exact: true }).click();
    await expect(page.getByRole("heading", { name: NOVA_PESSOA.nome })).toBeVisible();

    await page.getByRole("button", { name: "Tirar da equipe" }).first().click();
    await expect(page.getByText(`Tirar ${NOVA_PESSOA.nome} da equipe?`)).toBeVisible();
    await page.getByRole("button", { name: "Tirar da equipe" }).last().click();

    await expect(page).toHaveURL(/\/admin\/configuracoes\/equipe$/);
    await expect(page.getByText(NOVA_PESSOA.nome, { exact: true })).toHaveCount(0);
  });

  test("apos adicionar Suporte, Voltar para a equipe abre a lista atualizada", async ({ page }) => {
    // A lista ja visitada deve refletir a nova gravacao tambem na navegacao interna.
    await page.goto("/admin/configuracoes/equipe");
    await expect(page.getByText(NOVA_PESSOA.nome, { exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Adicionar pessoa" }).click();
    await expect(page).toHaveURL(/\/admin\/configuracoes\/equipe\/novo$/);
    await adicionarSuporte(page);

    await page.getByRole("link", { name: "Voltar para a equipe" }).click();
    await expect(page).toHaveURL(/\/admin\/configuracoes\/equipe$/);
    await expect(page.getByText(NOVA_PESSOA.nome, { exact: true })).toBeVisible();
  });
});

test.describe("analista", () => {
  test.use({ storageState: "tests/e2e/.auth/analista.json" });

  test("entra no admin, mas as telas da Equipe (escrita) o mandam para a area dele, sem o botao de adicionar", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin/);

    // Equipe pede settings.team e manda para Configuracoes, que por sua vez nao e area do analista:
    // ele acaba na primeira area que enxerga. O que importa: nunca na Equipe. A segunda navegacao
    // pode ser interrompida pelo redirecionamento (o goto reclama), e por isso o erro e ignorado.
    await page.goto("/admin/configuracoes/equipe").catch(() => undefined);
    await expect(page).not.toHaveURL(/\/equipe/);
    await expect(page).toHaveURL(/\/admin(\/configuracoes)?$/);
    await expect(page.getByRole("link", { name: "Adicionar pessoa" })).toHaveCount(0);

    await page.goto("/admin/configuracoes/equipe/novo").catch(() => undefined);
    await expect(page).not.toHaveURL(/\/equipe/);
    await expect(page).toHaveURL(/\/admin(\/configuracoes)?$/);
  });
});
