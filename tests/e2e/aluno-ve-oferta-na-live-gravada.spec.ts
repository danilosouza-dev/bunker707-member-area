import type { BrowserContext, Page } from "@playwright/test";
import {
  OFERTA_DE_TESTE,
  cliquesDaOfertaNoBanco,
  contaDeTeste,
  eventosDeWebinario,
  expect,
  paginaFalsaPlayerJs,
  seedOfertaDeTeste,
  test,
  zerarHistoricoDeWebinarios
} from "./fixtures";
import { LIVE_GRAVADA_NO_AR_DE_TESTE, limparWebinarios, seedEscolaDeTeste, seedLiveGravadaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { createLocalAdminClient } from "../support/local-db.mjs";
import { WEBINAR_COPY } from "../../src/lib/webinar-copy";
import { OFFER_LIMITS } from "../../src/server/webinars/model";
import { offerVariantFor } from "../../src/server/webinars/offer-model";

// A Oferta na Live gravada (docs/30 §1.6 "Oferta", §5.1, §6.6, M7; docs/18 §3.1; fase 4b): a aluna entra na sala da
// Live gravada no ar 90 s depois do inicio; o card da oferta nao esta na tela antes do minuto marcado (2:00 do video) e
// aparece nele, com a variante dela (a mesma conta de webinar_offer_variant: offerVariantFor) e o titulo, o selo e o
// preco daquela variante; "Quero participar" abre o checkout em outra aba com ?b7=<codigo do clique>, e o clique fica
// gravado (webinar_offer_clicks com o mesmo codigo e a variante; webinar_offer_clicked no historico); ao voltar (a
// pagina recarregada e a sala aberta de novo pela pagina da live), o card mostra a mesma variante. O checkout e um
// endereco .test servido aqui por uma pagina falsa: o navegador nunca sai da maquina.

const { slug, titulo } = LIVE_GRAVADA_NO_AR_DE_TESTE;
const ORIGEM_DA_BUNNY = "https://iframe.mediadelivery.net";
const SALA = new RegExp(`/webinarios/${slug}/sala\\?sessao=`);
const OFERTA = WEBINAR_COPY.oferta.aluno;
const COMECOU_HA_MS = 90_000;
const MOSTRA_EM_MS = 120_000;

let horaMarcada = 0;
let variantes: { enabled: boolean; label: "A" | "B" | "C" | "D"; weight: number }[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = createLocalAdminClient();
  await seedEscolaDeTeste(db);
  await limparWebinarios(db);
  await zerarHistoricoDeWebinarios();
  const { scheduledAt } = await seedLiveGravadaDeTeste(db, { comecouHa: COMECOU_HA_MS });
  horaMarcada = Date.parse(scheduledAt);
  ({ variantes } = await seedOfertaDeTeste(db, { mostraEm: MOSTRA_EM_MS }));
});

test.afterAll(async () => {
  await limparWebinarios(createLocalAdminClient());
  await zerarHistoricoDeWebinarios();
});

/** O checkout de mentira: qualquer endereco de OFERTA_DE_TESTE.checkoutOrigem responde uma pagina vazia (depois do corte da rede). */
async function checkoutFalso(context: BrowserContext) {
  await context.route(`${OFERTA_DE_TESTE.checkoutOrigem}/**`, (route) =>
    route.fulfill({ body: "<!doctype html><title>Checkout de teste</title><p>Checkout de teste</p>", contentType: "text/html" })
  );
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

async function varianteDaAluna() {
  const aluna = await contaDeTeste("aluna");
  const label = offerVariantFor({ offerId: OFERTA_DE_TESTE.id, userId: aluna.id, variants: variantes })?.label;
  const variante = OFERTA_DE_TESTE.variantes.find((item) => item.label === label);
  expect(variante, "a aluna cai numa das variantes ligadas").toBeTruthy();
  return variante!;
}

test("o card aparece no minuto marcado com a variante da aluna, e Quero participar abre o checkout em outra aba com ?b7= e grava o clique", async ({ context, page }) => {
  await checkoutFalso(context);
  const variante = await varianteDaAluna();
  const sala = await entrarNaSala(page);
  await sala.getByRole("button", { exact: true, name: WEBINAR_COPY.sala.ativarSom }).click();
  const card = sala.locator("[data-room-offer-card]");

  // Antes de 2:00 do video o card nao esta na tela (so confere se ainda falta tempo de verdade).
  if (Date.now() < horaMarcada + MOSTRA_EM_MS - 5000) {
    await expect(card).toHaveCount(0);
  }

  await expect(card).toBeVisible({ timeout: 60_000 });
  expect(Date.now()).toBeGreaterThanOrEqual(horaMarcada + MOSTRA_EM_MS - 2000);
  await expect(card).toHaveAttribute("data-offer-variant", variante.label);
  await expect(card.getByRole("heading", { name: variante.headline })).toBeVisible();
  if (variante.badge) {
    await expect(card.getByText(variante.badge, { exact: true })).toBeVisible();
  }
  if (variante.priceLabel) {
    await expect(card.getByText(OFERTA.por(variante.priceLabel), { exact: true })).toBeVisible();
  }

  const quero = card.getByRole("button", { exact: true, name: OFERTA.quero });
  await expect(quero).toBeVisible();
  const caixa = await quero.boundingBox();
  expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(44);

  const novaAba = context.waitForEvent("page");
  await quero.click();
  const checkout = await novaAba;
  const parametro = OFFER_LIMITS.clickTokenParam;
  await checkout.waitForURL(new RegExp(`^${OFERTA_DE_TESTE.checkoutOrigem.replace(/\./g, "\\.")}/.*[?&]${parametro}=`));
  const endereco = new URL(checkout.url());
  expect(`${endereco.origin}${endereco.pathname}`).toBe(variante.checkoutUrl.split("?")[0]);
  const codigo = endereco.searchParams.get(parametro);
  expect(codigo).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  // O link do checkout da variante continua com os parametros dela.
  expect(endereco.searchParams.get("plano")).toBe(new URL(variante.checkoutUrl).searchParams.get("plano"));
  await checkout.close();

  await expect.poll(async () => (await cliquesDaOfertaNoBanco("aluna")).length).toBe(1);
  const [clique] = await cliquesDaOfertaNoBanco("aluna");
  expect(clique.click_token).toBe(codigo);
  expect(clique.variant_label).toBe(variante.label);
  expect(clique.converted_sale_grant_id).toBeNull();
  expect(clique.offset_ms).toBeGreaterThanOrEqual(MOSTRA_EM_MS - 2000);

  await expect.poll(async () => (await eventosDeWebinario("webinar_offer_clicked")).length).toBe(1);
  const [evento] = await eventosDeWebinario("webinar_offer_clicked");
  expect(evento.metadata).toMatchObject({ offer_id: OFERTA_DE_TESTE.id, variant: variante.label });
  expect(evento.entity_id).toBe(LIVE_GRAVADA_NO_AR_DE_TESTE.sessaoId);
});

test("ao voltar (a página recarregada e a sala aberta de novo) o card mostra a mesma variante", async ({ page }) => {
  const variante = await varianteDaAluna();
  const sala = await entrarNaSala(page);
  const card = sala.locator("[data-room-offer-card]");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toHaveAttribute("data-offer-variant", variante.label);
  await expect(card.getByRole("heading", { name: variante.headline })).toBeVisible();

  await page.reload();
  const deNovo = page.getByRole("dialog", { name: titulo }).locator("[data-room-offer-card]");
  await expect(deNovo).toBeVisible({ timeout: 30_000 });
  await expect(deNovo).toHaveAttribute("data-offer-variant", variante.label);

  // Fechar esconde o card nesta janela; a outra variante nunca aparece.
  await deNovo.getByRole("button", { name: OFERTA.fecharOferta }).click();
  await expect(page.getByRole("dialog", { name: titulo }).locator("[data-room-offer-card]")).toHaveCount(0);
  for (const outra of OFERTA_DE_TESTE.variantes.filter((item) => item.label !== variante.label)) {
    await expect(page.getByText(outra.headline, { exact: true })).toHaveCount(0);
  }
});

test("no celular baixo em pé (375x548) a pílula abre o card com o Fechar dentro da tela e abaixo de Minimizar e Sair", async ({ page }) => {
  await page.setViewportSize({ height: 548, width: 375 });
  const sala = await entrarNaSala(page);
  const pilula = sala.locator("[data-room-offer-pill]");
  await expect(pilula).toBeVisible({ timeout: 30_000 });
  await pilula.click();
  const fechar = sala.locator("[data-room-offer-close]");
  await expect(fechar).toBeVisible();
  const caixa = await fechar.boundingBox();
  const topo = await sala.locator("[data-room-vertical-top]").boundingBox();
  expect(caixa).not.toBeNull();
  expect(topo).not.toBeNull();
  expect(caixa!.y).toBeGreaterThanOrEqual(0);
  expect(caixa!.y + caixa!.height).toBeLessThanOrEqual(548);
  expect(caixa!.y).toBeGreaterThanOrEqual(topo!.y + topo!.height);
  await fechar.click();
  await expect(sala.locator("[data-room-offer-panel]")).toHaveCount(0);
});
