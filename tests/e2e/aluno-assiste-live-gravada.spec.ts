import type { Page } from "@playwright/test";
import { expect, paginaFalsaPlayerJs, test } from "./fixtures";
import { LIVE_GRAVADA_NO_AR_DE_TESTE, limparWebinarios, seedEscolaDeTeste, seedLiveGravadaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient } from "../support/local-db.mjs";
import { WEBINAR_COPY } from "../../src/lib/webinar-copy";
import { ROOM_THEME_KEY } from "../../src/lib/webinar-room-prefs";

// Webinarios, fase 2a (docs/30 §1.6, §6.6, §8.5, §9 e §10.2): a aluna entra na Live gravada 90 s depois do inicio
// pela pagina da live (Entrar), o player falso da Bunny (servido no endereco real pela pagina falsa) recebe
// setCurrentTime(~90) da trava, "Ativar som" liga o som, a linha mestre aparece no segundo certo (a de 100 s
// chega; a de 20 min nao), a mensagem nova aparece numa segunda aba pela consulta de 5 s depois do aceite
// (o texto de §8.5), Esc pede confirmacao e Sair volta para a pagina da live, e a 375 px tudo cabe. A IA Diretor fica
// na pagina da live e some na sala (o botao flutuante cobria o Enviar do chat), e o cabecalho da sala tem a logo da
// escola. Sem Minimizar e sem pilula (docs/31 V2-2): o topo do vertical tem so o Sair.
// Fase 4d (docs/30 §1.6 e §6.6): com o celular em pe (375 x 740) a sala abre na Sala Live vertical 9:16 (o video
// cobrindo a tela, o campo compacto embaixo, Reagir abrindo as reacoes, a gaveta com o Chat, Perguntas e Enquetes);
// deitado, volta ao desenho normal com as abas, sem trocar de sala. O tema claro guardado (docs/31 V2-12) so vale no
// desenho normal: o vertical fica sobre o video e e sempre escuro, e girar troca o tema junto com o desenho.

const { slug, textos, titulo } = LIVE_GRAVADA_NO_AR_DE_TESTE;
const ORIGEM_DA_BUNNY = "https://iframe.mediadelivery.net";
const SALA = new RegExp(`/webinarios/${slug}/sala\\?sessao=`);
/** O botao flutuante da IA Diretor (PlatformDirectorLauncher em src/components/app-shell.tsx). */
const IA_DIRETOR = "Abrir IA Diretor";

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
  // Na pagina da live a IA Diretor continua no canto.
  await expect(page.getByRole("button", { exact: true, name: IA_DIRETOR })).toBeVisible();
  await page.getByRole("link", { exact: true, name: "Entrar" }).click();
  await expect(page).toHaveURL(SALA);
  const sala = page.getByRole("dialog", { name: titulo });
  await expect(sala).toBeVisible();
  // Na sala o botao da IA Diretor nao existe (docs/30 §1.3).
  await expect(page.getByRole("button", { name: /IA Diretor/ })).toHaveCount(0);
  return sala;
}

test("Entrar 90 s depois do inicio: a sala abre, o player falso recebe setCurrentTime(~90), Ativar som liga o som e o selo Ao vivo aparece com o contador", async ({ page }) => {
  const sala = await entrarNaSala(page);
  await expect(sala).toHaveAttribute("data-room-phase", "live");
  // O selo tem duas versoes (computador e celular): so uma fica visivel.
  await expect(sala.getByText(/^Ao vivo/).filter({ visible: true })).toBeVisible();
  await expect(sala.getByText(/1 assistindo/)).toBeVisible();
  // A sala cobre o topo da area: no computador, a logo da escola no cabecalho da sala, sem link.
  await expect(sala.getByRole("img", { name: "Bunker707" })).toBeVisible();
  await expect(sala.getByRole("link", { name: "Bunker707" })).toHaveCount(0);

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

test("a 375 px em pé: a Sala Live vertical cabe sem rolagem lateral, o vídeo cobre a largura, Reagir e as reações têm 44 px, o campo fica no rodapé e a gaveta abre o Chat; com o tema claro guardado, o vertical fica escuro; deitado, volta ao desenho normal no claro; o Sair do topo pede a confirmação e fecha a sala", async ({ page }) => {
  const sala = WEBINAR_COPY.sala;
  const vertical = WEBINAR_COPY.vertical;
  // A aluna escolheu o tema claro antes (guardado no navegador dela).
  await page.addInitScript((chave) => {
    try {
      window.localStorage.setItem(chave, "light");
    } catch {
      // Sem armazenamento, a sala fica no escuro e a conferencia abaixo falha com a causa.
    }
  }, ROOM_THEME_KEY);
  await page.setViewportSize({ height: 740, width: 375 });
  const dialogo = await entrarNaSala(page);
  await expect(dialogo).toHaveAttribute("data-room-design", "vertical");
  // O vertical 9:16 fica sobre o video: sempre escuro, mesmo com o claro guardado.
  await expect(dialogo).toHaveAttribute("data-room-theme", "dark");

  const larguras = await page.evaluate(() => ({ pagina: document.documentElement.scrollWidth, tela: window.innerWidth }));
  expect(larguras.pagina).toBeLessThanOrEqual(larguras.tela);

  const palco = await dialogo.locator("[data-room-stage]").boundingBox();
  expect(palco?.width).toBeGreaterThanOrEqual(360);

  // O rodape compacto: o campo (o mesmo nome do chat) e Reagir abrindo a fileira das seis reacoes, 44 px cada.
  await expect(dialogo.getByRole("textbox", { name: sala.escreva })).toBeInViewport();
  const reagir = dialogo.getByRole("button", { exact: true, name: sala.reagir });
  const caixaDoReagir = await reagir.boundingBox();
  expect(caixaDoReagir?.height).toBeGreaterThanOrEqual(44);
  await reagir.click();
  const palmas = dialogo.getByRole("button", { exact: true, name: "Palmas" });
  const caixa = await palmas.boundingBox();
  expect(caixa?.height).toBeGreaterThanOrEqual(44);
  expect(caixa?.width).toBeGreaterThanOrEqual(44);

  // A gaveta: o chat inteiro, Perguntas e Enquetes; Voltar para o video fecha.
  await dialogo.getByRole("button", { exact: true, name: vertical.gaveta }).click();
  const gaveta = dialogo.getByRole("region", { name: vertical.gavetaRotulo });
  await expect(gaveta.getByRole("tab", { name: sala.abas.chat })).toBeVisible();
  await gaveta.getByRole("button", { exact: true, name: vertical.voltarAoVideo }).click();
  await expect(gaveta).toHaveCount(0);

  // Sem Minimizar (docs/31 V2-2): nada encolhe a sala, e a pagina da live nao fica desenhada por baixo dela.
  await expect(dialogo.getByRole("button", { exact: true, name: "Minimizar" })).toHaveCount(0);
  await expect(page.getByTestId("room-pill")).toHaveCount(0);

  // Deitado (740 x 375): o desenho normal com as abas, na mesma sala.
  await page.setViewportSize({ height: 375, width: 740 });
  await expect(dialogo).toHaveAttribute("data-room-design", "normal");
  await expect(dialogo).toHaveAttribute("data-room-theme", "light");
  await expect(dialogo.getByRole("tab", { name: sala.abas.chat })).toBeVisible();

  // De volta a 375 px em pe: o topo tem so o Sair, com 44 px; ele pede a confirmacao (a sessao esta no ar) e o Sair
  // dela volta para a pagina da live, onde a IA Diretor reaparece.
  await page.setViewportSize({ height: 740, width: 375 });
  await expect(dialogo).toHaveAttribute("data-room-design", "vertical");
  await expect(dialogo).toHaveAttribute("data-room-theme", "dark");
  const sairDoTopo = dialogo.getByRole("button", { exact: true, name: sala.sair });
  await expect(sairDoTopo).toHaveCount(1);
  const caixaDoSair = await sairDoTopo.boundingBox();
  expect(caixaDoSair?.height).toBeGreaterThanOrEqual(44);
  expect(caixaDoSair?.width).toBeGreaterThanOrEqual(44);
  await sairDoTopo.click();
  const confirmacao = dialogo.getByRole("alertdialog", { name: sala.sairConfirmar });
  await expect(confirmacao).toBeVisible();
  await confirmacao.getByRole("button", { exact: true, name: sala.sair }).click();
  await expect(page).toHaveURL(`/webinarios/${slug}`);
  await expect(page.getByRole("dialog", { name: titulo })).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: IA_DIRETOR })).toBeVisible();
});
