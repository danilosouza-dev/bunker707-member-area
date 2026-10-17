import type { Locator } from "@playwright/test";
import { apagarConta, expect, test } from "./fixtures";
import { ESCOLA_DE_TESTE, desconectarVendas, ligarProdutoNaPlataforma, limparVendasDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient } from "../support/local-db.mjs";

// Admin: Configuracoes > Vendas com a Ticto no navegador (docs/17 §1.10; docs/18 §3.2): o produtor abre a
// tela, ve o cartao da Ticto "Nao conectada" ao lado do da Hotmart, cola o token e salva; uma venda
// FICTICIA da Ticto (token no corpo) chega pelo endereco mostrado na tela e aparece na lista como
// "Acesso liberado", dizendo que veio da Ticto. Token errado nao entra.

const { cursoBloqueado } = ESCOLA_DE_TESTE;
const TOKEN = "token-ticto-navegador-0123456789abcdef";
const CODIGO = "8101";
const COMPRADOR = { email: "comprador.ticto.navegador@bunker707.test", nome: "Comprador da Ticto" };
const PREFIXO = "teste-navegador-ticto-";

async function preencher(campo: Locator, valor: string) {
  await campo.fill(valor);

  try {
    await expect(campo).toHaveValue(valor, { timeout: 2_000 });
  } catch {
    await campo.fill(valor);
    await expect(campo).toHaveValue(valor);
  }
}

/** Payload ficticio no formato do webhook 2.0 da Ticto; a transacao leva o prefixo para a limpeza achar. */
function vendaDaTicto(token: string, transacao: string) {
  return {
    customer: { email: COMPRADOR.email, name: COMPRADOR.nome, phone: { ddd: "11", ddi: "55", number: "999990000" } },
    item: { product_id: Number(CODIGO), product_name: "Produto do navegador na Ticto", refund_deadline: 7 },
    order: { hash: `${PREFIXO}pedido-${transacao}`, id: 1, order_date: "2026-10-17 09:59:00", transaction_hash: `${PREFIXO}${transacao}` },
    status: "authorized",
    status_date: "2026-10-17 10:00:00",
    token,
    transaction: { hash: `${PREFIXO}${transacao}` },
    version: "2.0"
  };
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
    await ligarProdutoNaPlataforma(createLocalAdminClient(), { codigo: CODIGO, plataforma: "ticto", produtoId: cursoBloqueado.id });
  });

  test.afterAll(limpar);

  test("abre Vendas: a Ticto aparece como conectavel ao lado da Hotmart; cola o token e a Ticto fica conectada", async ({ page }) => {
    await page.goto("/admin/configuracoes/vendas");
    await expect(page).toHaveURL(/\/admin\/configuracoes\/vendas$/);
    await expect(page.getByRole("heading", { level: 1, name: "Vendas" })).toBeVisible();

    const cartao = page.getByRole("region", { name: "Ticto" });
    await expect(cartao.getByText("Não conectada", { exact: true })).toBeVisible();
    await expect(page.getByText("Em configuração", { exact: true })).toHaveCount(1);
    await expect(cartao.getByLabel("Endereço para colar na Ticto")).toHaveValue(/\/api\/webhooks\/ticto$/);
    await expect(cartao.getByRole("list", { name: "Eventos para marcar na Ticto" }).getByText("Assinatura reativada", { exact: true })).toBeVisible();

    await page.waitForLoadState("networkidle");
    await preencher(cartao.getByLabel("Token da Ticto"), TOKEN);
    await cartao.getByRole("button", { name: "Salvar token" }).click();

    await expect(cartao.getByText("Conectada", { exact: true })).toBeVisible();
    await expect(cartao.getByText(/Token guardado em/)).toBeVisible();
    await expect(cartao.getByRole("button", { name: "Trocar token" })).toBeVisible();
    await expect(cartao.getByLabel("Token da Ticto")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Hotmart" }).getByText("Não conectada", { exact: true })).toBeVisible();
  });

  test("uma venda da Ticto chega pelo endereco da tela e aparece na lista como acesso liberado", async ({ page, request }) => {
    const endereco = await page
      .goto("/admin/configuracoes/vendas")
      .then(() => page.getByRole("region", { name: "Ticto" }).getByLabel("Endereço para colar na Ticto").inputValue());
    const response = await request.post(endereco, { data: vendaDaTicto(TOKEN, "compra-1") });
    expect(response.status(), await response.text()).toBe(200);

    await page.reload();
    const tabela = page.getByRole("table", { name: "Vendas recebidas das plataformas" });
    await expect(tabela.getByText("Compra aprovada", { exact: true })).toBeVisible();
    await expect(tabela.getByText("Ticto", { exact: true })).toBeVisible();
    await expect(tabela.getByText("c***@bunker707.test", { exact: true })).toBeVisible();
    await expect(tabela.getByText(cursoBloqueado.titulo, { exact: true })).toBeVisible();
    await expect(tabela.getByText("Acesso liberado", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reprocessar" })).toHaveCount(0);
  });

  test("uma venda da Ticto com token errado nao entra na lista", async ({ page, request }) => {
    const response = await request.post("/api/webhooks/ticto", { data: vendaDaTicto("token-errado-0123456789abcdef", "token-errado") });
    expect(response.status()).toBe(401);

    await page.goto("/admin/configuracoes/vendas");
    const tabela = page.getByRole("table", { name: "Vendas recebidas das plataformas" });
    await expect(tabela.getByText("Compra aprovada", { exact: true })).toHaveCount(1);
  });
});
