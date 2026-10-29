import type { Page } from "@playwright/test";
import { expect, paginaFalsaPlayerJs, test } from "./fixtures";
import { LIVE_GRAVADA_NO_AR_DE_TESTE, limparWebinarios, seedEscolaDeTeste, seedLiveGravadaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient } from "../support/local-db.mjs";

// Webinarios, fase 2a (docs/30 §1.6, §6.6, §8.5, §9 e §10.2): a aluna entra na Live gravada 90 s depois do inicio
// pela pagina da live (Entrar), o player falso da Bunny (servido no endereco real pela pagina falsa) recebe
// setCurrentTime(~90) da trava, "Ativar som" liga o som, a linha mestre aparece no segundo certo (a de 100 s
// chega; a de 20 min nao), a mensagem nova aparece numa segunda aba pela consulta de 5 s depois do aceite
// (o texto de §8.5), Esc pede confirmacao e Sair volta para a pagina da live, e a 375 px tudo cabe.

const { slug, textos, titulo } = LIVE_GRAVADA_NO_AR_DE_TESTE;
const ORIGEM_DA_BUNNY = "https://iframe.mediadelivery.net";
const SALA = new RegExp(`/webinarios/${slug}/sala\\?sessao=`);

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = createLocalAdminClient();
  await seedEscolaDeTeste(db);
  await limparWebinarios(db);
  await seedLiveGravadaDeTeste(db, { comecouHa: 90_000 });
});

test.afterAll(async () => {
  await limparWebinarios(createLocalAdminClient());
});

function playerDaSala(page: Page) {
  return page.frameLocator("[data-room-stage] iframe");
}

async function entrarNaSala(page: Page) {
  await paginaFalsaPlayerJs(page, ORIGEM_DA_BUNNY);
  await page.goto(`/webinarios/${slug}`);
  await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();
  await page.getByRole("link", { exact: true, name: "Entrar" }).click();
  await expect(page).toHaveURL(SALA);
  const sala = page.getByRole("dialog", { name: titulo });
  await expect(sala).toBeVisible();
  return sala;
}

test("Entrar 90 s depois do inicio: a sala abre, o player falso recebe setCurrentTime(~90), Ativar som liga o som e o selo Ao vivo aparece com o contador", async ({ page }) => {
  const sala = await entrarNaSala(page);
  await expect(sala).toHaveAttribute("data-room-phase", "live");
  // O selo tem duas versoes (computador e celular): so uma fica visivel.
  await expect(sala.getByText(/^Ao vivo/).filter({ visible: true })).toBeVisible();
  await expect(sala.getByText(/1 assistindo/)).toBeVisible();

  const player = playerDaSala(page);
  await expect(player.locator("#estado")).toHaveText("pronto", { timeout: 20_000 });
  // A pagina falsa comeca do zero de proposito: a trava recoloca no segundo do servidor (90 s + o tempo de abrir).
  await expect
    .poll(async () => Number(await player.locator("#ultimo-salto").textContent()), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(85);
  expect(Number(await player.locator("#ultimo-salto").textContent())).toBeLessThanOrEqual(150);
  await expect(player.locator("#som")).toHaveText("mudo");

  await sala.getByRole("button", { exact: true, name: "Ativar som" }).click();
  await expect(player.locator("#som")).toHaveText("som");
  await expect(sala.getByRole("button", { exact: true, name: "Ativar som" })).toHaveCount(0);

  // A linha mestre reaparece no segundo certo: a de 100 s do video ja esta (ou chega) e a de 20 min nao.
  await expect(sala.getByText(textos.cedo)).toBeVisible({ timeout: 30_000 });
  await expect(sala.getByText(textos.tarde)).toHaveCount(0);
});

test("a mensagem nova: o aceite na primeira (o texto de §8.5), a mensagem aparece para a aluna e numa segunda aba pela consulta de 5 s", async ({ context, page }) => {
  const sala = await entrarNaSala(page);
  const segundaAba = await context.newPage();
  await paginaFalsaPlayerJs(segundaAba, ORIGEM_DA_BUNNY);
  await segundaAba.goto(page.url());
  const salaDois = segundaAba.getByRole("dialog", { name: titulo });
  await expect(salaDois).toBeVisible();

  const campo = sala.getByRole("textbox", { name: "Escreva uma mensagem" });
  await campo.fill("olá da aluna de teste");
  await campo.press("Enter");
  const aceite = sala.getByRole("group", { name: /Ao enviar mensagens neste chat/ });
  await expect(aceite).toBeVisible();
  await expect(aceite).toContainText("Você pode remover as suas mensagens a qualquer momento em Perfil › Privacidade.");

  const envio = page.waitForResponse((response) => response.url().includes("/api/webinars/") && response.url().endsWith("/chat") && response.request().method() === "POST");
  await aceite.getByRole("button", { exact: true, name: "Entendi e quero participar" }).click();
  expect((await envio).status()).toBe(201);
  await expect(sala.getByRole("log").getByText("olá da aluna de teste")).toBeVisible();
  await expect(sala.getByRole("group", { name: /Ao enviar mensagens neste chat/ })).toHaveCount(0);

  await expect(salaDois.getByRole("log").getByText("olá da aluna de teste")).toBeVisible({ timeout: 15_000 });
  await segundaAba.close();

  // A segunda mensagem nao pede o aceite de novo.
  await campo.fill("segunda mensagem");
  await campo.press("Enter");
  await expect(sala.getByRole("log").getByText("segunda mensagem")).toBeVisible();
  await expect(sala.getByRole("group", { name: /Ao enviar mensagens neste chat/ })).toHaveCount(0);
});

test("Esc pede confirmacao enquanto esta no ar; Sair volta para a pagina da live", async ({ page }) => {
  const sala = await entrarNaSala(page);
  await page.keyboard.press("Escape");
  const confirmacao = sala.getByRole("alertdialog", { name: "Sair da sala?" });
  await expect(confirmacao).toBeVisible();
  await confirmacao.getByRole("button", { exact: true, name: "Voltar" }).click();
  await expect(confirmacao).toHaveCount(0);

  await sala.getByRole("button", { exact: true, name: "Sair" }).first().click();
  await sala.getByRole("alertdialog", { name: "Sair da sala?" }).getByRole("button", { exact: true, name: "Sair" }).click();
  await expect(page).toHaveURL(`/webinarios/${slug}`);
  await expect(page.getByRole("dialog", { name: titulo })).toHaveCount(0);
});

test("a 375 px: a sala cabe sem rolagem lateral, o palco ocupa a largura, as reacoes tem 44 px e o campo fica no rodape", async ({ page }) => {
  await page.setViewportSize({ height: 740, width: 375 });
  const sala = await entrarNaSala(page);
  await expect(sala.getByRole("tab", { name: "Chat" })).toBeVisible();

  const larguras = await page.evaluate(() => ({ pagina: document.documentElement.scrollWidth, tela: window.innerWidth }));
  expect(larguras.pagina).toBeLessThanOrEqual(larguras.tela);

  const palco = await sala.locator("[data-room-stage]").boundingBox();
  expect(palco?.width).toBeGreaterThanOrEqual(360);

  const reagir = sala.getByRole("button", { exact: true, name: "Palmas" });
  const caixa = await reagir.boundingBox();
  expect(caixa?.height).toBeGreaterThanOrEqual(44);
  expect(caixa?.width).toBeGreaterThanOrEqual(44);

  await expect(sala.getByRole("textbox", { name: "Escreva uma mensagem" })).toBeInViewport();
  await sala.getByRole("button", { exact: true, name: "Minimizar" }).click();
  await expect(page.getByTestId("room-pill")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();
  await page.getByTestId("room-pill").getByRole("button", { exact: true, name: "Voltar" }).click();
  await expect(sala.getByRole("tab", { name: "Chat" })).toBeVisible();
});
