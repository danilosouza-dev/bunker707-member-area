import type { Locator } from "@playwright/test";
import { apagarConta, expect, test } from "./fixtures";
import { ESCOLA_DE_TESTE, desconectarVendas, ligarProdutoNaHotmart, limparVendasDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient } from "../support/local-db.mjs";

// Admin: Configuracoes > Vendas no navegador (docs/17 §1.10; docs/18 §3.2): o produtor abre a tela, ve a
// Hotmart e a Ticto "Nao conectada" e a Kiwify "Em configuracao", cola o token da Hotmart e salva; uma
// venda FICTICIA chega pelo endereco mostrado na tela e aparece na lista como "Acesso liberado". O
// analista nao chega na tela. A Ticto tem o proprio teste (produtor-conecta-ticto).

const { cursoBloqueado } = ESCOLA_DE_TESTE;
const TOKEN = "hottok-navegador-0123456789abcdef";
const CODIGO = "7101";
const COMPRADOR = { email: "comprador.navegador@bunker707.test", nome: "Comprador do Navegador" };
const PREFIXO = "teste-navegador-";

async function preencher(campo: Locator, valor: string) {
  await campo.fill(valor);

  try {
    await expect(campo).toHaveValue(valor, { timeout: 2_000 });
  } catch {
    await campo.fill(valor);
    await expect(campo).toHaveValue(valor);
  }
}

async function limpar() {
  const db = createLocalAdminClient();
  await desconectarVendas(db);
  await limparVendasDeTeste(db, { codigos: [CODIGO], prefixoDoEvento: PREFIXO });
  await apagarConta(COMPRADOR.email);
}

test.describe("produtor", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await limpar();
    await ligarProdutoNaHotmart(createLocalAdminClient(), { codigo: CODIGO, produtoId: cursoBloqueado.id });
  });

  test.afterAll(limpar);

  test("abre Vendas: Hotmart e Ticto nao conectadas, Kiwify em configuracao; cola o token e a Hotmart fica conectada", async ({ page }) => {
    await page.goto("/admin/configuracoes/vendas");
    await expect(page).toHaveURL(/\/admin\/configuracoes\/vendas$/);
    await expect(page.getByRole("heading", { level: 1, name: "Vendas" })).toBeVisible();
    await expect(page.getByText("Não conectada", { exact: true })).toHaveCount(2);
    await expect(page.getByText("Em configuração", { exact: true })).toHaveCount(1);
    await expect(page.getByLabel("Endereço para colar na Hotmart")).toHaveValue(/\/api\/webhooks\/hotmart$/);

    const cartao = page.getByRole("region", { name: "Hotmart" });
    await page.waitForLoadState("networkidle");
    await preencher(cartao.getByLabel("Token da Hotmart (Hottok)"), TOKEN);
    await cartao.getByRole("button", { name: "Salvar token" }).click();

    await expect(cartao.getByText("Conectada", { exact: true })).toBeVisible();
    await expect(cartao.getByText(/Token guardado em/)).toBeVisible();
    await expect(cartao.getByRole("button", { name: "Trocar token" })).toBeVisible();
    await expect(cartao.getByLabel("Token da Hotmart (Hottok)")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Ticto" }).getByText("Não conectada", { exact: true })).toBeVisible();
  });

  test("uma venda chega pelo endereco da tela e aparece na lista como acesso liberado", async ({ page, request }) => {
    const endereco = await page.goto("/admin/configuracoes/vendas").then(() => page.getByLabel("Endereço para colar na Hotmart").inputValue());
    const response = await request.post(endereco, {
      data: {
        creation_date: Date.now(),
        data: {
          buyer: { email: COMPRADOR.email, name: COMPRADOR.nome },
          product: { id: Number(CODIGO), name: "Produto do navegador" },
          purchase: { approved_date: Date.now(), status: "APPROVED", transaction: "HP-NAVEGADOR-0001" }
        },
        event: "PURCHASE_APPROVED",
        id: `${PREFIXO}compra-1`,
        version: "2.0.0"
      },
      headers: { "x-hotmart-hottok": TOKEN }
    });
    expect(response.status(), await response.text()).toBe(200);

    await page.reload();
    const tabela = page.getByRole("table", { name: "Vendas recebidas das plataformas" });
    await expect(tabela.getByText("Compra aprovada", { exact: true })).toBeVisible();
    await expect(tabela.getByText("c***@bunker707.test", { exact: true })).toBeVisible();
    await expect(tabela.getByText(cursoBloqueado.titulo, { exact: true })).toBeVisible();
    await expect(tabela.getByText("Acesso liberado", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reprocessar" })).toHaveCount(0);
  });

  test("uma venda com token errado nao entra na lista", async ({ page, request }) => {
    const response = await request.post("/api/webhooks/hotmart", {
      data: { data: {}, event: "PURCHASE_APPROVED", id: `${PREFIXO}token-errado`, version: "2.0.0" },
      headers: { "x-hotmart-hottok": "token-errado-0123456789abcdef" }
    });
    expect(response.status()).toBe(401);

    await page.goto("/admin/configuracoes/vendas");
    const tabela = page.getByRole("table", { name: "Vendas recebidas das plataformas" });
    await expect(tabela.getByText("Compra aprovada", { exact: true })).toHaveCount(1);
  });
});

test.describe("analista", () => {
  test.use({ storageState: "tests/e2e/.auth/analista.json" });

  test("nao chega em Vendas: volta para a area dele", async ({ page }) => {
    await page.goto("/admin/configuracoes/vendas").catch(() => undefined);
    await expect(page).not.toHaveURL(/\/vendas/);
    await expect(page).toHaveURL(/\/admin(\/configuracoes)?$/);
  });
});
