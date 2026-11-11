import type { BrowserContext, Locator, Page } from "@playwright/test";
import { abrirComoProdutor, eventosDeWebinario, expect, paginaFalsaPlayerJs, test, zerarHistoricoDeWebinarios } from "./fixtures";
import { LIVE_GRAVADA_NO_AR_DE_TESTE, NA_TELA_DE_TESTE, limparWebinarios, seedEscolaDeTeste, seedLiveGravadaDeTeste, seedNaTelaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient } from "../support/local-db.mjs";
import { WEBINAR_COPY } from "../../src/lib/webinar-copy";

// A Na tela na Live gravada (docs/30 §1.6, §2.4 e §9; docs/31 §12; especificacao de 10/11/2026, R3, R4, §3.2 a §3.7 e
// §9), com dois contextos: o produtor no console da sessao no ar e a aluna na sala.
// - O produtor abre a entrada Na tela no ⋯, cria um Novo banner que o aluno nao pode fechar (titulo, texto, botao,
//   link, Embaixo, a esquerda) e clica em Mostrar agora; a aluna, no palco largo (1280 px, depois do Ativar som), ve o
//   cartao em ate 8 s, sem o X, com o botao abrindo o link em outra aba (target _blank e rel noopener noreferrer
//   nofollow); o clique fica gravado (webinar_screen_clicked, pelo sendBeacon) e o "viu" tambem; ela ainda escreve no
//   chat e chega ao Sair so com o teclado. Tirar da tela tira em ate 8 s.
// - O QR Code pronto (o da escola de teste) entra pelo Mostrar dos Prontos: o desenho (svg com role img e o nome do
//   dominio) e o Abrir o link com o mesmo endereco.
// - No celular em pe (375 x 740, a Sala Live vertical 9:16), o banner que nao pode fechar e o QR Code viram as linhas
//   compactas da doca: o banner sem X, o QR Code com o X, e nenhuma linha cobre o campo de escrever nem o Sair.
// A faixa abaixo do palco a 375 px e a camada por cima do iframe do motor ficam na Live ao vivo
// (aluno-assiste-live-ao-vivo.spec.ts), que nao tem o desenho vertical.

const { id: webinarId, sessaoId, slug, titulo } = LIVE_GRAVADA_NO_AR_DE_TESTE;
const ORIGEM_DA_BUNNY = "https://iframe.mediadelivery.net";
const SALA = new RegExp(`/webinarios/${slug}/sala\\?sessao=`);
const CONSOLE = `/admin/comunicacao/webinarios/${webinarId}/sala?sessao=${sessaoId}`;
const naTela = WEBINAR_COPY.naTela;
const BANNER = { botao: "Garantir a vaga", link: "https://turma.bunker707.test/inscricao", texto: "Só hoje, durante a live.", titulo: "Inscrições abertas" };
const QR = NA_TELA_DE_TESTE.qr;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = createLocalAdminClient();
  await seedEscolaDeTeste(db);
  await limparWebinarios(db);
  await zerarHistoricoDeWebinarios();
  await seedLiveGravadaDeTeste(db, { comecouHa: 90_000 });
  // O banner e o QR Code prontos da escola de teste, ainda fora da tela.
  await seedNaTelaDeTeste(db);
});

test.afterAll(async () => {
  await limparWebinarios(createLocalAdminClient());
  await zerarHistoricoDeWebinarios();
});

/** Os links .test do banner e do QR Code respondem uma pagina vazia (depois do corte da rede de fora). */
async function linksFalsos(context: BrowserContext) {
  for (const origem of ["https://turma.bunker707.test", "https://material.bunker707.test"]) {
    await context.route(`${origem}/**`, (route) => route.fulfill({ body: "<!doctype html><title>Pagina de teste</title><p>Pagina de teste</p>", contentType: "text/html" }));
  }
}

async function entrarNaSala(page: Page) {
  await paginaFalsaPlayerJs(page, ORIGEM_DA_BUNNY);
  await page.goto(`/webinarios/${slug}`);
  await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();
  await page.getByRole("link", { exact: true, name: WEBINAR_COPY.aluno.entrar }).click();
  await expect(page).toHaveURL(SALA);
  const sala = page.getByRole("dialog", { name: titulo });
  await expect(sala).toBeVisible();
  return sala;
}

/** O console da sessao com a entrada Na tela escolhida no ⋯ (a secao dela, ja na tela). */
async function abrirNaTela(page: Page) {
  await page.goto(CONSOLE);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1, name: "Console da sessão" })).toBeVisible();
  const entrada = WEBINAR_COPY.consoleV2.entradas.tela;
  await page.locator("[data-console-more-trigger]").click();
  await page.getByRole("menuitemradio", { exact: true, name: entrada }).click();
  const secao = page.locator("section[data-console-more]").and(page.getByRole("group", { exact: true, name: entrada }));
  await expect(secao).toBeVisible();
  return secao;
}

/** Aperta Tab ate o foco chegar num controle com o nome dado; devolve quantos Tabs foram (nulo: nao chegou). */
async function tabAte(page: Page, nome: string, maximo = 40): Promise<number | null> {
  for (let vez = 1; vez <= maximo; vez += 1) {
    await page.keyboard.press("Tab");
    const atual = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? (el.getAttribute("aria-label") ?? el.innerText ?? "").trim() : "";
    });
    if (atual === nome) {
      return vez;
    }
  }
  return null;
}

/** As caixas de dois elementos se cruzam? */
async function cruzam(a: Locator, b: Locator) {
  const [x, y] = await Promise.all([a.boundingBox(), b.boundingBox()]);
  expect(x, "a primeira caixa").not.toBeNull();
  expect(y, "a segunda caixa").not.toBeNull();
  return x!.x < y!.x + y!.width && y!.x < x!.x + x!.width && x!.y < y!.y + y!.height && y!.y < x!.y + x!.height;
}

test("o produtor cria um banner sem fechar e mostra; a aluna ve no palco largo sem X, clica (outra aba, clique gravado), ainda escreve e chega ao Sair pelo teclado; Tirar da tela tira; o QR Code pronto com o desenho e o Abrir o link", async ({ browser, context, page }) => {
  await linksFalsos(context);
  const sala = await entrarNaSala(page);
  await sala.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.ativarSom }).click();
  await expect(sala.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.ativarSom })).toHaveCount(0);

  const produtor = await abrirComoProdutor(browser);
  try {
    const console = produtor.pagina;
    const secao = await abrirNaTela(console);
    await expect(secao.getByText(naTela.console.agoraVazio)).toBeVisible();

    // Novo banner: o formulario no lugar da lista, com os avisos fixos.
    await secao.getByRole("button", { exact: true, name: naTela.console.novoBanner }).click();
    const formulario = secao.locator("form[data-console-screen-form='banner']");
    await expect(formulario).toBeVisible();
    await expect(formulario.getByText(naTela.formulario.avisoPrazo)).toBeVisible();
    await expect(formulario.getByText(naTela.formulario.avisoOferta)).toBeVisible();
    await formulario.getByLabel(naTela.formulario.titulo, { exact: true }).fill(BANNER.titulo);
    await formulario.getByLabel(naTela.formulario.texto, { exact: true }).fill(BANNER.texto);
    await formulario.getByLabel(naTela.formulario.textoDoBotao, { exact: true }).fill(BANNER.botao);
    await formulario.getByLabel(naTela.formulario.link, { exact: true }).fill(BANNER.link);
    await formulario.getByRole("radio", { exact: true, name: naTela.lugares.bottom_left }).check({ force: true });
    const fechar = formulario.getByRole("switch", { name: naTela.formulario.podeFechar });
    await expect(fechar).toHaveAttribute("aria-checked", "true");
    await fechar.click();
    await expect(fechar).toHaveAttribute("aria-checked", "false");
    await expect(formulario.getByText(naTela.formulario.semFecharDica)).toBeVisible();
    await formulario.getByRole("button", { exact: true, name: naTela.formulario.mostrarAgora }).click();
    await expect(console.getByText(naTela.console.avisos.naTela)).toBeVisible();
    const agora = secao.locator("[data-console-screen-now-item='banner']");
    await expect(agora).toContainText(naTela.exibicao.banner(BANNER.titulo));

    // A aluna ve em ate 8 s, no palco largo, sem o X.
    const cartao = sala.locator("[data-room-screen-card='banner']");
    await expect(cartao).toBeVisible({ timeout: 8_000 });
    await expect(cartao).toHaveAccessibleName(naTela.aluno.secaoBanner(BANNER.titulo));
    await expect(sala.locator(`[data-room-screen-cell='${"bottom_left"}'] [data-room-screen-card='banner']`)).toBeVisible();
    await expect(cartao.getByText(BANNER.texto)).toBeVisible();
    await expect(cartao.getByRole("button", { name: naTela.aluno.fecharBanner })).toHaveCount(0);
    await expect(sala.getByRole("button", { name: naTela.aluno.fecharBanner })).toHaveCount(0);
    // Nao modal: uma secao com nome, sem aria-modal, e o foco continua onde estava.
    expect(await cartao.getAttribute("aria-modal")).toBeNull();
    expect(await cartao.evaluate((el) => el.contains(document.activeElement))).toBe(false);
    const botao = cartao.getByRole("link", { exact: true, name: BANNER.botao });
    await expect(botao).toHaveAttribute("href", BANNER.link);
    await expect(botao).toHaveAttribute("target", "_blank");
    await expect(botao).toHaveAttribute("rel", "noopener noreferrer nofollow");

    // O clique abre a outra aba e fica gravado; o "viu" chega depois de 1 s na tela.
    const novaAba = context.waitForEvent("page");
    await botao.click();
    const aberta = await novaAba;
    await aberta.waitForURL(BANNER.link);
    await aberta.close();
    await expect.poll(async () => (await eventosDeWebinario("webinar_screen_clicked")).length, { timeout: 15_000 }).toBe(1);
    const [clique] = await eventosDeWebinario("webinar_screen_clicked");
    expect(clique.entity_id).toBe(sessaoId);
    expect(clique.metadata).toMatchObject({ form: "stage", kind: "banner", target: "button" });
    await expect.poll(async () => (await eventosDeWebinario("webinar_screen_shown")).length, { timeout: 15_000 }).toBe(1);

    // O banner nunca tira o chat nem o Sair: a aluna escreve e chega ao Sair so com o teclado.
    const campo = sala.getByRole("textbox", { name: "Escreva uma mensagem" });
    await expect(campo).toBeVisible();
    expect(await cruzam(cartao, campo), "o banner nao cobre o campo do chat").toBe(false);
    await campo.fill("estou vendo o banner");
    await campo.press("Enter");
    const aceite = sala.getByRole("group", { name: /Ao enviar mensagens neste chat/ });
    await aceite.getByRole("button", { exact: true, name: "Entendi e quero participar" }).click();
    await expect(sala.getByRole("log").getByText("estou vendo o banner")).toBeVisible();
    await botao.focus();
    expect(await tabAte(page, WEBINAR_COPY.sala.sair), "do banner ao Sair so com o Tab").not.toBeNull();

    // Tirar da tela: some em ate 8 s.
    await agora.getByRole("button", { exact: true, name: naTela.console.tirarDaTela }).click();
    await expect(console.getByText(naTela.console.avisos.saiu)).toBeVisible();
    await expect(sala.locator("[data-room-screen-card='banner']")).toHaveCount(0, { timeout: 8_000 });

    // O QR Code pronto: Mostrar nos Prontos.
    const pronto = secao.locator(`[data-console-screen-item='${QR.id}']`);
    await expect(pronto).toContainText(QR.name);
    await pronto.getByRole("button", { exact: true, name: naTela.console.mostrar }).click();
    const qr = sala.locator("[data-room-screen-card='qr']");
    await expect(qr).toBeVisible({ timeout: 8_000 });
    await expect(qr).toHaveAccessibleName(naTela.aluno.secaoQr(QR.title));
    await expect(qr.getByRole("img", { name: naTela.aluno.qrNome("material.bunker707.test") })).toBeVisible();
    await expect(qr.locator("svg[role='img']")).toHaveCount(1);
    const abrir = qr.getByRole("link", { exact: true, name: naTela.aluno.abrirOLink });
    await expect(abrir).toHaveAttribute("href", QR.linkUrl);
    await expect(abrir).toHaveAttribute("target", "_blank");
    // Este pode fechar: o X so para a aluna e so desta exibicao.
    await qr.getByRole("button", { name: naTela.aluno.fecharQr }).click();
    await expect(sala.locator("[data-room-screen-card='qr']")).toHaveCount(0);
    await expect.poll(async () => (await eventosDeWebinario("webinar_screen_closed")).length, { timeout: 15_000 }).toBe(1);
    await expect(secao.locator("[data-console-screen-now-item='qr']")).toBeVisible();
  } finally {
    await produtor.fechar();
  }
});

test("no celular em pe (375 x 740) o banner sem fechar e o QR Code viram as linhas da doca: o banner sem X, o QR Code com X, nenhuma cobre o campo nem o Sair", async ({ page }) => {
  await seedNaTelaDeTeste(createLocalAdminClient(), { mostrar: ["banner", "qr"] });
  await page.setViewportSize({ height: 740, width: 375 });
  const sala = await entrarNaSala(page);
  const doca = sala.locator("[data-room-screen-dock]");
  const banner = doca.locator("[data-room-screen-compact-row='banner']");
  const qr = doca.locator("[data-room-screen-compact-row='qr']");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(qr).toBeVisible();
  await expect(banner).toHaveAccessibleName(naTela.aluno.secaoBanner(NA_TELA_DE_TESTE.banner.title));
  await expect(banner.getByRole("button", { name: naTela.aluno.fecharBanner })).toHaveCount(0);
  await expect(banner.getByRole("link", { exact: true, name: NA_TELA_DE_TESTE.banner.buttonLabel! })).toHaveAttribute("href", NA_TELA_DE_TESTE.banner.linkUrl);
  await expect(qr.getByRole("button", { name: naTela.aluno.fecharQr })).toBeVisible();
  await expect(qr.getByRole("link", { exact: true, name: naTela.aluno.abrirOLink })).toHaveAttribute("href", QR.linkUrl);

  const campo = sala.getByRole("textbox", { name: "Escreva uma mensagem" }).filter({ visible: true });
  const sair = sala.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.sair }).filter({ visible: true });
  await expect(campo).toBeVisible();
  await expect(sair).toBeVisible();
  for (const linha of [banner, qr]) {
    expect(await cruzam(linha, campo), "a linha nao cobre o campo de escrever").toBe(false);
    expect(await cruzam(linha, sair), "a linha nao cobre o Sair").toBe(false);
  }
  const larguras = await page.evaluate(() => ({ pagina: document.documentElement.scrollWidth, tela: window.innerWidth }));
  expect(larguras.pagina).toBeLessThanOrEqual(larguras.tela);
});
