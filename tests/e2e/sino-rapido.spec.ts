import type { Page } from "@playwright/test";
import { contarPedidos, enviarNotificacao, expect, test, zerarComunicacao } from "./fixtures";

// Sino rapido no navegador (docs/24 §7.3 e §7.4; docs/18 §3.1): a primeira pagina da lista sai na intencao,
// junto com o codigo do painel, e fica guardada na memoria do navegador. Conta os GET /api/notifications
// (nunca o resumo nem as escritas): passar o mouse e abrir = 1 pedido e nada de esqueleto; fechar e abrir em
// menos de 5 s = nenhum; abrir, esperar 6 s e fechar (Esc ou clique fora) = nenhum (o foco volta para o sino
// e nao e intencao); mouse no sino duas vezes num minuto = no maximo 1; reabrir com a pagina de 6 s e a rede
// lenta mostra a de antes na hora e a nova entra por cima; no celular, o pedido sai no toque, antes de o codigo
// do painel terminar de chegar. Sem polling: com o painel fechado, nada sai.

const PRIMEIRA = "Rápido E2E: a lista já estava aqui";
const NOVA = "Rápido E2E: chegou enquanto o sino estava fechado";
const LISTA = /^\/api\/notifications$/;
/** O mesmo caminho para o page.route (que recebe o endereco inteiro). */
const ehALista = (url: URL) => url.pathname === "/api/notifications";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await zerarComunicacao();
  await enviarNotificacao({ minutosAtras: 30, texto: "A primeira página do sino.", titulo: PRIMEIRA });
});

test.afterAll(zerarComunicacao);

function sinoDe(page: Page) {
  return page.getByRole("button", { name: /^Notificações/ });
}

function painelDe(page: Page) {
  return page.getByRole("dialog", { name: "Notificações" });
}

/**
 * Um ponto da tela fora do painel e de qualquer link, botao ou campo: clicar ali so fecha o painel (sem trocar
 * de pagina nem abrir nada).
 */
async function pontoInerte(page: Page) {
  const ponto = await page.evaluate(() => {
    const painel = document.querySelector('[role="dialog"]');

    for (let y = 120; y < window.innerHeight - 20; y += 40) {
      for (let x = 20; x < window.innerWidth - 20; x += 40) {
        const alvo = document.elementFromPoint(x, y);

        if (alvo && !painel?.contains(alvo) && !alvo.closest("a, button, input, select, textarea, [role='button'], [role='slider'], [tabindex]:not([tabindex='-1']), video, iframe")) {
          return { x, y };
        }
      }
    }

    return null;
  });

  if (!ponto) {
    throw new Error("Nenhum ponto livre na tela para clicar fora do painel.");
  }

  return ponto;
}

/** A home pronta e sem nenhum pedido da lista ainda (o resumo vem sozinho; a lista, so na intencao). */
async function abrirHome(page: Page) {
  await page.goto("/");
  await expect(sinoDe(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
}

test("passar o mouse e abrir: 1 pedido e sem esqueleto; fechar e abrir em menos de 5 s não pede de novo", async ({ page }) => {
  await abrirHome(page);
  const pedidos = contarPedidos(page, LISTA);
  const sino = sinoDe(page);
  const painel = painelDe(page);

  await sino.hover();
  await page.waitForTimeout(300);
  await expect.poll(() => pedidos.total).toBe(1);
  await sino.click();
  await page.waitForTimeout(100);
  // A pagina buscada na intencao abre na hora: a lista ja esta la e nenhum esqueleto aparece.
  expect(await painel.getByRole("article", { name: PRIMEIRA }).isVisible()).toBe(true);
  expect(await painel.getByText("Carregando notificações").count()).toBe(0);
  expect(pedidos.total).toBe(1);

  // Fechar e abrir de novo logo depois: a mesma pagina, sem pedido.
  await page.keyboard.press("Escape");
  await expect(painel).toHaveCount(0);
  await sino.click();
  await expect(painel.getByRole("article", { name: PRIMEIRA })).toBeVisible();
  await page.waitForTimeout(500);
  expect(pedidos.total).toBe(1);
});

test("abrir, esperar 6 s e fechar com Esc ou clicando fora não pede nada; o foco volta para o sino", async ({ page }) => {
  await abrirHome(page);
  const pedidos = contarPedidos(page, LISTA);
  const sino = sinoDe(page);
  const painel = painelDe(page);

  await sino.click();
  await expect(painel.getByRole("article", { name: PRIMEIRA })).toBeVisible();
  expect(pedidos.total).toBe(1);
  await page.waitForTimeout(6_000);

  await page.keyboard.press("Escape");
  await expect(painel).toHaveCount(0);
  await expect(sino).toBeFocused();
  await page.waitForTimeout(2_000);
  expect(pedidos.total).toBe(1);

  // Reabrir com a pagina de mais de 5 s: mostra a guardada e atualiza por tras (1 pedido a mais).
  await sino.click();
  await expect(painel.getByRole("article", { name: PRIMEIRA })).toBeVisible();
  await expect.poll(() => pedidos.total).toBe(2);
  await page.waitForTimeout(6_000);

  // Fechar clicando fora (longe do sino, do painel e de qualquer link).
  const fora = await pontoInerte(page);
  await page.mouse.click(fora.x, fora.y);
  await expect(painel).toHaveCount(0);
  await page.waitForTimeout(2_000);
  expect(pedidos.total).toBe(2);
});

test("mouse no sino duas vezes em menos de 1 minuto, com o painel fechado: no máximo 1 pedido", async ({ page }) => {
  await abrirHome(page);
  const pedidos = contarPedidos(page, LISTA);
  const sino = sinoDe(page);

  const fora = await pontoInerte(page);

  await sino.hover();
  await page.waitForTimeout(400);
  await page.mouse.move(fora.x, fora.y);
  await page.waitForTimeout(1_500);
  await sino.hover();
  await page.waitForTimeout(400);
  await page.mouse.move(fora.x, fora.y);
  await page.waitForTimeout(1_000);

  expect(pedidos.total).toBeLessThanOrEqual(1);
  await expect(painelDe(page)).toHaveCount(0);
});

test("reabrir com a página de 6 s e a rede lenta: a lista de antes aparece na hora e a nova entra por cima", async ({ page }) => {
  await abrirHome(page);
  const sino = sinoDe(page);
  const painel = painelDe(page);

  await sino.click();
  await expect(painel.getByRole("article", { name: PRIMEIRA })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(painel).toHaveCount(0);

  // Chega uma notificacao nova com o sino fechado (sem polling: o navegador nao sabe dela).
  await enviarNotificacao({ minutosAtras: 1, texto: "Ela entra no topo quando a lista atualiza.", titulo: NOVA });
  await page.waitForTimeout(6_000);
  await page.route(ehALista, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.continue();
  });

  await sino.click();
  // A pagina guardada aparece antes de qualquer resposta (a rede esta 2 s atrasada).
  await expect(painel.getByRole("article", { name: PRIMEIRA })).toBeVisible({ timeout: 200 });
  expect(await painel.getByText("Carregando notificações").count()).toBe(0);
  expect(await painel.getByRole("article", { name: NOVA }).count()).toBe(0);
  // A resposta chega e a nova entra no topo da lista.
  await expect(painel.getByRole("article", { name: NOVA })).toBeVisible({ timeout: 5_000 });
  const ordem = await painel.getByRole("article").evaluateAll((artigos) =>
    artigos.map((artigo) => document.getElementById(artigo.getAttribute("aria-labelledby") ?? "")?.textContent?.trim() ?? "")
  );
  expect(ordem.slice(0, 2)).toEqual([NOVA, PRIMEIRA]);
  await page.unroute(ehALista);
});

test.describe("no celular", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { height: 812, width: 375 } });

  test("tocar no sino: o pedido da lista sai antes de o código do painel terminar de chegar", async ({ page }) => {
    await abrirHome(page);
    const pedidos = contarPedidos(page, LISTA);
    const codigo: { fim: number; url: string }[] = [];

    // So os pedaços de JavaScript pedidos depois da home pronta: o do painel (e os dele), 500 ms atrasados.
    await page.route(/\/_next\/static\/chunks\/.+\.js$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });
    page.on("requestfinished", (request) => {
      if (/\/_next\/static\/chunks\/.+\.js$/.test(new URL(request.url()).pathname)) {
        codigo.push({ fim: Date.now(), url: request.url() });
      }
    });

    await sinoDe(page).tap();
    const painel = painelDe(page);
    await expect(painel.getByRole("article", { name: PRIMEIRA })).toBeVisible();

    expect(pedidos.total).toBe(1);
    expect(codigo.length).toBeGreaterThan(0);
    expect(pedidos.inicios[0]).toBeLessThanOrEqual(Math.max(...codigo.map((pedaco) => pedaco.fim)));
    await page.unroute(/\/_next\/static\/chunks\/.+\.js$/);
  });
});
