import type { Page } from "@playwright/test";
import { ESCOLA_DE_TESTE } from "../fixtures/escola-de-teste.mjs";
import { adiantarFluxo, expect, rodarTick, test, zerarComunicacao } from "./fixtures";

// Construtor de fluxos no navegador (docs/23 §2.4 a §2.8 e §8.3; docs/18 §3.1): o produtor parte do modelo
// "Para quem não abriu", troca o titulo da primeira notificacao, escolhe o produto do botao e ativa. Tick
// (matricula e envia o primeiro passo) -> a aluna abre o sino sem abrir o cartao -> adiantarFluxo -> tick
// (decide a Condição) -> o relatorio mostra Sim e Não. A 375 px: o cartao da lista com Pausar e Retomar, a
// folha de tela cheia de um passo e as pilulas Sim | Não da Condição.

const FLUXO = "Para quem não abriu";
const PRIMEIRA = "Fluxo E2E: novidade na área";
const SEGUNDA = "Você viu a novidade?";
const FIM_DO_CAMINHO = "Fim: nada mais para quem chega aqui.";

test.describe.configure({ mode: "serial" });

let enderecoDoFluxo = "";

test.beforeAll(zerarComunicacao);
test.afterAll(zerarComunicacao);

/** Aluno que nunca abriu o sino: o resumo diz quantas chegaram desde a ultima vez. */
async function novasNoSino(page: Page) {
  const resposta = await page.request.get("/api/notifications/summary");
  const { data } = (await resposta.json()) as { data: { unseen: number } };

  return data.unseen;
}

test.describe("produtor", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("parte do modelo Para quem não abriu, ajusta a primeira notificação e ativa", async ({ page }) => {
    await page.goto("/admin/comunicacao/fluxos/novo");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: new RegExp(`^${FLUXO}`) }).click();

    // O desenho: Quem entra -> Notificação -> Condição (Sim: outra notificação; Não: fim).
    const passos = page.getByRole("region", { name: "Passos do fluxo" });
    await expect(passos.getByRole("button", { name: /^Quem entra: / })).toBeVisible();
    await passos.getByRole("button", { exact: true, name: "Notificação: Novidade na área" }).click();

    // No computador, o passo abre no painel da direita.
    const painel = page.getByRole("complementary", { name: "Notificação" });
    await expect(painel).toBeVisible();
    await painel.getByLabel("Título", { exact: true }).fill(PRIMEIRA);
    await painel.getByRole("group", { name: "Produto", exact: true }).getByText(ESCOLA_DE_TESTE.cursoBloqueado.titulo).click();
    await expect(painel.getByRole("radio", { name: new RegExp(ESCOLA_DE_TESTE.cursoBloqueado.titulo) })).toBeChecked();
    await expect(passos.getByRole("button", { exact: true, name: `Notificação: ${PRIMEIRA}` })).toBeVisible();
    await expect(passos.getByRole("button", { name: /^Condição: / })).toBeVisible();
    await expect(passos.getByRole("button", { exact: true, name: `Notificação: ${SEGUNDA}` })).toBeVisible();

    await page.getByRole("button", { exact: true, name: "Ativar fluxo" }).click();
    const confirmacao = page.getByRole("alertdialog", { name: "Ativar o fluxo?" }).or(page.getByRole("dialog", { name: "Ativar o fluxo?" }));
    await expect(confirmacao).toBeVisible();
    await confirmacao.getByRole("button", { exact: true, name: "Ativar" }).click();
    await expect(page.getByText("Fluxo ativo. Os primeiros passos começam em até 1 minuto.")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/comunicacao\/fluxos\/[0-9a-f-]{36}$/);
    enderecoDoFluxo = new URL(page.url()).pathname;
  });
});

test.describe("o fluxo anda", () => {
  test("tick envia o primeiro passo; a aluna abre o sino sem abrir o cartão; adiantarFluxo e tick decidem a Condição", async ({ browser }) => {
    await rodarTick();

    const contexto = await browser.newContext({ storageState: "tests/e2e/.auth/aluna.json" });
    const pagina = await contexto.newPage();
    await pagina.goto("/");
    await pagina.getByRole("button", { exact: true, name: "Notificações, 1 nova" }).click();
    const painel = pagina.getByRole("dialog", { name: "Notificações" });
    await expect(painel.getByRole("article", { name: PRIMEIRA })).toBeVisible();
    // Abrir o sino conta como "viu"; o cartao fica sem abrir.
    await expect.poll(async () => novasNoSino(pagina)).toBe(0);
    await pagina.keyboard.press("Escape");
    await expect(painel).toHaveCount(0);
    await contexto.close();

    const flowId = enderecoDoFluxo.split("/").pop() ?? "";
    expect(await adiantarFluxo(flowId)).toBeGreaterThan(0);
    await rodarTick();
  });
});

test.describe("relatório", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json" });

  test("mostra quantos foram para o Sim e quantos para o Não", async ({ page }) => {
    await page.goto(enderecoDoFluxo);
    const passos = page.getByRole("region", { name: "Passos do fluxo" });
    await expect(passos.getByText("Sim (1)", { exact: true })).toBeVisible();
    await expect(passos.getByText(/^Não \([1-9]\d*\)$/)).toBeVisible();
    await expect(passos.getByText(/^Sim 1 · Não [1-9]\d* · Esperando 0$/)).toBeVisible();
  });
});

test.describe("a 375 px", () => {
  test.use({ storageState: "tests/e2e/.auth/produtor.json", viewport: { height: 812, width: 375 } });

  test("o cartão da lista pausa e retoma; um passo abre em folha de tela cheia; a Condição troca de lado pelas pílulas", async ({ page }) => {
    await page.goto("/admin/comunicacao/fluxos");
    const cartao = page.getByRole("row").filter({ hasText: FLUXO });
    await expect(cartao).toHaveCount(1);
    const semRolagemLateral = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await semRolagemLateral();

    const pausar = cartao.getByRole("button", { exact: true, name: "Pausar" });
    await expect(pausar).toBeVisible();
    expect((await pausar.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await pausar.click();
    const confirmacao = page.getByRole("alertdialog", { name: "Pausar o fluxo?" }).or(page.getByRole("dialog", { name: "Pausar o fluxo?" }));
    await confirmacao.getByRole("button", { exact: true, name: "Pausar" }).click();
    await expect(page.getByText("Fluxo pausado. Nada sai até você retomar.")).toBeVisible();
    const retomar = cartao.getByRole("button", { exact: true, name: "Retomar" });
    await expect(retomar).toBeVisible();
    await expect(cartao.getByText("Pausado", { exact: true })).toBeVisible();

    await retomar.click();
    await expect(page.getByText("Fluxo retomado.")).toBeVisible();
    await expect(cartao.getByRole("button", { exact: true, name: "Pausar" })).toBeVisible();

    // Abrir o fluxo (o relatorio) e tocar num passo: folha de tela cheia com "Concluir".
    await cartao.getByText(FLUXO, { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${enderecoDoFluxo}$`));
    const passos = page.getByRole("region", { name: "Passos do fluxo" });
    await expect(passos.getByRole("button", { exact: true, name: `Notificação: ${PRIMEIRA}` })).toBeVisible();
    await semRolagemLateral();
    await passos.getByRole("button", { exact: true, name: `Notificação: ${PRIMEIRA}` }).click();
    const folha = page.getByRole("dialog", { name: "Notificação" });
    await expect(folha).toBeVisible();
    await expect.poll(async () => folha.boundingBox()).toEqual({ height: 812, width: 375, x: 0, y: 0 });
    await folha.getByRole("button", { exact: true, name: "Concluir" }).click();
    await expect(folha).toHaveCount(0);

    // Condição: abaixo de 1024 px, um lado por vez, escolhido pelas pilulas Sim | Não.
    const lados = passos.getByRole("group", { name: "Caminho da condição" });
    const sim = lados.getByRole("button", { name: /^Sim/ });
    const nao = lados.getByRole("button", { name: /^Não/ });
    await expect(sim).toHaveAttribute("aria-pressed", "true");
    await expect(sim).toHaveText("Sim (1)");
    await expect(passos.getByRole("button", { exact: true, name: `Notificação: ${SEGUNDA}` })).toBeVisible();

    await nao.click();
    await expect(nao).toHaveAttribute("aria-pressed", "true");
    await expect(sim).toHaveAttribute("aria-pressed", "false");
    await expect(passos.getByRole("button", { exact: true, name: `Notificação: ${SEGUNDA}` })).toHaveCount(0);
    await expect(passos.getByText(FIM_DO_CAMINHO)).toBeVisible();
  });
});
