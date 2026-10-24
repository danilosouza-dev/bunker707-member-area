import type { Locator, Page } from "@playwright/test";
import { popupStarterDesign } from "../../src/server/communications/popup-design-model";
import { bloquearRedeExterna, estadoDoPopUpDaAluna, eventosDoPopUp, expect, idDoAviso, reabrirPopUpParaAluna, test, zerarComunicacao } from "./fixtures";
import { publicarPopUpComDesign } from "./popup-design-fixtures";
import { designVideoNoTopo, prepararMidiaDoLivre, publicarPopUpLivre, type MidiaDoLivre } from "./popup-livre-fixtures";

// Pop-up Livre no navegador da aluna (docs/27; spec §7.3; docs/18 §3.1): o modelo "Vídeo no topo com degradê"
// com o video e a capa de teste. O nome do dialogo e o texto do titulo do design; o texto e de verdade
// (selecionavel); o selo fica por cima da parte do video que some; o <video> toca mudo; com menos movimento nenhum
// <video> e so a capa; no celular (375 px) o cartao tem 343 px, sem rolagem para o lado, e tudo encolhe na mesma
// proporcao (conferido so no que fica acima de qualquer texto, numa amostra com a fonte enviada e textos de 16 px
// ou mais); o Tab segue as Camadas e o X vem por ultimo; uma forma por cima do botao nao impede o clique (e o
// clique conta); o Esc fecha; "Não mostrar de novo" some com dismiss false; Padrão e Personalizado continuam
// iguais. Com E2E_SHOTS_DIR, guarda as fotos de 1440 e 375 px nessa pasta (conferencia visual).

const TITULO = "Pop-up E2E: Livre com vídeo";
const NOME = /experimente grátis nova aula ao vivo/i;
const SHOTS = process.env.E2E_SHOTS_DIR;
const enderecoDoApp = `http://127.0.0.1:${process.env.E2E_PORT ?? "3100"}`;

let midia: MidiaDoLivre;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  await zerarComunicacao();
  midia = await prepararMidiaDoLivre();
  await publicarPopUpLivre(browser, { design: designVideoNoTopo(midia), titulo: TITULO });
});

test.afterAll(zerarComunicacao);

async function abrirPopUp(page: Page, nome: RegExp | string = NOME) {
  await page.goto("/");
  const popUp = page.getByRole("dialog", { name: nome });
  await expect(popUp).toBeVisible();
  await expect(popUp.locator("[data-popup-free]")).toBeVisible();
  return popUp;
}

type Caixa = { height: number; width: number; x: number; y: number };

async function caixaDe(locator: Locator): Promise<Caixa> {
  const box = await locator.boundingBox();
  expect(box, "elemento desenhado").not.toBeNull();
  return box as Caixa;
}

/** A caixa relativa ao canto de cima a esquerda da prancheta. */
async function relativa(locator: Locator, prancheta: Locator): Promise<Caixa> {
  const [box, base] = await Promise.all([caixaDe(locator), caixaDe(prancheta)]);
  return { height: box.height, width: box.width, x: box.x - base.x, y: box.y - base.y };
}

test.describe("computador (1440 px)", () => {
  test.use({ viewport: { height: 900, width: 1440 } });

  test("nome = título do design, texto selecionável, selo sobre o vídeo que some, vídeo mudo tocando", async ({ page }) => {
    const popUp = await abrirPopUp(page);

    await expect(popUp.getByRole("heading", { level: 2, name: NOME })).toBeVisible();
    await expect(popUp.getByText(TITULO)).toHaveCount(0);
    expect(await popUp.getAttribute("aria-describedby")).toBeTruthy();

    // Texto de verdade: selecionavel e nao uma imagem.
    const texto = popUp.getByText("Uma aula nova acabou de entrar na sua área.", { exact: false });
    await expect(texto).toBeVisible();
    expect(await texto.evaluate((element) => getComputedStyle(element).userSelect)).not.toBe("none");
    const selecionado = await texto.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      return window.getSelection()?.toString() ?? "";
    });
    expect(selecionado).toContain("Uma aula nova acabou de entrar");

    // O video: mudo, em repeticao, inline, autoplay, com a capa, do nosso bucket, tocando.
    const video = popUp.locator("video");
    await expect(video).toHaveCount(1);
    expect(
      await video.evaluate((element: HTMLVideoElement) => ({
        autoplay: element.autoplay,
        controls: element.controls,
        loop: element.loop,
        muted: element.muted,
        playsInline: element.playsInline,
        poster: element.poster,
        source: element.querySelector("source")?.src ?? null
      }))
    ).toEqual({ autoplay: true, controls: false, loop: true, muted: true, playsInline: true, poster: midia.capa.url, source: midia.video.url });
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime > 0 && !element.paused && element.muted)).toBe(true);

    // O selo fica por cima da parte do video que esta sumindo (degrade de 40 % a 100 %).
    const prancheta = popUp.locator("[data-free-artboard]");
    const midiaCaixa = await relativa(popUp.locator('[data-free-id="midia"]'), prancheta);
    const selo = popUp.locator('[data-free-id="selo"]');
    const seloCaixa = await relativa(selo, prancheta);
    expect(seloCaixa.y).toBeGreaterThan(midiaCaixa.y + midiaCaixa.height * 0.4);
    expect(seloCaixa.y + seloCaixa.height).toBeLessThan(midiaCaixa.y + midiaCaixa.height);
    expect(
      await selo.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return Boolean(top && element.contains(top));
      }),
      "o selo e o que se ve (e se toca) no meio dele, nao o video"
    ).toBe(true);

    // O X: 28 px visiveis, 44 px de toque, por cima de tudo.
    const fechar = popUp.getByRole("button", { exact: true, name: "Fechar" });
    const xCaixa = await caixaDe(fechar);
    expect([Math.round(xCaixa.width), Math.round(xCaixa.height)]).toEqual([28, 28]);
    expect(await fechar.evaluate((element) => getComputedStyle(element, "::before").minHeight)).toBe("44px");

    if (SHOTS) {
      await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe("loaded");
      await page.screenshot({ path: `${SHOTS}/aluno-livre-video-1440.png` });
    }

    // Tab na ordem das Camadas (botao principal, os links) e o X por ultimo.
    const nomes: string[] = [];

    for (let index = 0; index < 4; index += 1) {
      await page.keyboard.press("Tab");
      nomes.push(await page.evaluate(() => (document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? "").trim()));
    }

    expect(nomes).toEqual(["Saiba mais", "Lembrar depois", "Não mostrar de novo", "Fechar"]);

    // O Esc fecha (e diz como fechou).
    await page.keyboard.press("Escape");
    await expect(popUp).toHaveCount(0);
    const id = await idDoAviso(TITULO);
    await expect.poll(async () => (await eventosDoPopUp(id)).map((evento) => evento.event_type).at(-1)).toBe("message_closed");
    expect((await eventosDoPopUp(id)).at(-1)?.metadata).toMatchObject({ via: "esc" });
  });

  test("o botão principal conta o clique e leva ao destino", async ({ page }) => {
    await reabrirPopUpParaAluna(TITULO);
    const popUp = await abrirPopUp(page);

    await popUp.getByRole("link", { name: "Saiba mais" }).click();
    await expect(page).toHaveURL(/\/minhas-compras$/);
    await expect.poll(async () => (await estadoDoPopUpDaAluna(TITULO))?.clickedAt ?? null).not.toBeNull();
  });
});

test.describe("menos movimento", () => {
  test.use({ reducedMotion: "reduce", viewport: { height: 900, width: 1440 } });

  test("nenhum <video>, só a capa, e nada do vídeo é baixado", async ({ page }) => {
    await reabrirPopUpParaAluna(TITULO);
    const pedidosDoVideo: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/communication-popup-video/")) {
        pedidosDoVideo.push(request.url());
      }
    });

    const popUp = await abrirPopUp(page);

    await expect(popUp.locator('[data-free-id="midia"][data-free-media="poster"] img')).toBeVisible();
    await expect(popUp.locator("video")).toHaveCount(0);
    expect(pedidosDoVideo).toEqual([]);

    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/aluno-livre-capa-1440.png` });
    }

    await popUp.getByRole("button", { exact: true, name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);
  });
});

test.describe("celular (375 px)", () => {
  test.use({ viewport: { height: 812, width: 375 } });

  test("o mesmo desenho menor: cartão de 343 px, sem rolagem lateral, texto de 12 px ou mais e 44 px de toque", async ({ page }) => {
    await reabrirPopUpParaAluna(TITULO);
    const popUp = await abrirPopUp(page);
    const cartao = popUp.locator("[data-popup-free]");
    const caixa = await caixaDe(cartao);

    expect(Math.round(caixa.width)).toBe(343);
    expect(caixa.x).toBeGreaterThanOrEqual(0);
    expect(caixa.x + caixa.width).toBeLessThanOrEqual(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

    const menorFonte = await cartao.evaluate((element) =>
      Math.min(
        ...[...element.querySelectorAll("*")]
          .filter((node) => [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()))
          .map((node) => parseFloat(getComputedStyle(node).fontSize))
      )
    );
    expect(menorFonte).toBeGreaterThanOrEqual(12);

    for (const alvo of [popUp.getByRole("link", { name: "Saiba mais" }), popUp.getByRole("button", { exact: true, name: "Fechar" }), popUp.getByRole("button", { exact: true, name: "Não mostrar de novo" })]) {
      expect(await alvo.evaluate((element) => getComputedStyle(element, "::before").minHeight)).toBe("44px");
    }

    await expect.poll(() => popUp.locator("video").evaluate((element: HTMLVideoElement) => element.currentTime > 0)).toBe(true);

    if (SHOTS) {
      await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe("loaded");
      await page.screenshot({ path: `${SHOTS}/aluno-livre-video-375.png` });
    }

    await popUp.getByRole("button", { exact: true, name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);
  });
});

test.describe("proporção no celular", () => {
  const AMOSTRA = "Pop-up E2E: Livre proporção";

  test.beforeAll(async ({ browser }) => {
    await zerarComunicacao();
    // zerarComunicacao apaga a linha da fonte na biblioteca: prepara de novo (os arquivos ficam).
    midia = await prepararMidiaDoLivre();
    await publicarPopUpLivre(browser, { design: designVideoNoTopo(midia, { comFonte: true, seloTamanho: 16, textoTamanho: 16 }), titulo: AMOSTRA });
  });

  test("o que fica acima de qualquer texto encolhe na proporção 343/440", async ({ browser }) => {
    const medir = async (width: number) => {
      const contexto = await browser.newContext({
        baseURL: enderecoDoApp,
        locale: "pt-BR",
        storageState: "tests/e2e/.auth/aluna.json",
        timezoneId: "America/Sao_Paulo",
        viewport: { height: 900, width }
      });
      await bloquearRedeExterna(contexto);

      try {
        const page = await contexto.newPage();
        await reabrirPopUpParaAluna(AMOSTRA);
        const popUp = await abrirPopUp(page);
        await expect(popUp.locator("[data-popup-free][data-fonts-ready]")).toHaveCount(1);
        await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe("loaded");
        const prancheta = popUp.locator("[data-free-artboard]");

        return {
          cartao: await caixaDe(popUp.locator("[data-popup-free]")),
          midia: await relativa(popUp.locator('[data-free-id="midia"]'), prancheta),
          selo: await relativa(popUp.locator('[data-free-id="selo"]'), prancheta)
        };
      } finally {
        await contexto.close();
      }
    };

    const grande = await medir(1440);
    const pequeno = await medir(375);
    const escala = 343 / 440;

    expect(Math.round(grande.cartao.width)).toBe(440);
    expect(Math.round(pequeno.cartao.width)).toBe(343);

    // So o que fica acima de qualquer texto: o video inteiro e o topo do selo (o respiro de cima da prancheta). A
    // largura de um texto muda um pouco com o arredondamento das letras em tamanhos pequenos, entao nao entra.
    const medidas = [
      ["midia", "x"],
      ["midia", "y"],
      ["midia", "width"],
      ["midia", "height"],
      ["selo", "y"]
    ] as const;

    for (const [parte, lado] of medidas) {
      const esperado = grande[parte][lado] * escala;
      const tolerancia = Math.max(1, Math.abs(esperado) * 0.02);
      expect(Math.abs(pequeno[parte][lado] - esperado), `${parte}.${lado}: ${pequeno[parte][lado]} x ${esperado}`).toBeLessThanOrEqual(tolerancia);
    }
  });
});

test.describe("forma por cima do botão", () => {
  const COM_FORMA = "Pop-up E2E: Livre forma por cima";

  test.use({ viewport: { height: 900, width: 1440 } });

  test.beforeAll(async ({ browser }) => {
    await zerarComunicacao();
    await publicarPopUpLivre(browser, {
      design: designVideoNoTopo(midia, {
        extra: [{ box: { fill: [{ color: "#ff00ff59", kind: "solid" }] }, id: "veu", name: "Forma por cima", place: { h: 200, mode: "free", w: 440, x: 0, y: 360, z: 10 }, type: "shape" }]
      }),
      titulo: COM_FORMA
    });
  });

  test("a forma decorativa não impede o clique no botão e o clique conta", async ({ page }) => {
    const popUp = await abrirPopUp(page);
    const botao = popUp.getByRole("link", { name: "Saiba mais" });
    const forma = await caixaDe(popUp.locator('[data-free-id="veu"]'));
    const caixa = await caixaDe(botao);
    const centro = { x: caixa.x + caixa.width / 2, y: caixa.y + caixa.height / 2 };

    expect(centro.y > forma.y && centro.y < forma.y + forma.height, "a forma cobre o botao").toBe(true);
    await page.mouse.click(centro.x, centro.y);
    await expect(page).toHaveURL(/\/minhas-compras$/);
    await expect.poll(async () => (await estadoDoPopUpDaAluna(COM_FORMA))?.clickedAt ?? null).not.toBeNull();
  });
});

test.describe("sem Não mostrar de novo", () => {
  const SEM_DISMISS = "Pop-up E2E: Livre sem dismiss";

  test.use({ viewport: { height: 900, width: 1440 } });

  test.beforeAll(async ({ browser }) => {
    await zerarComunicacao();
    await publicarPopUpLivre(browser, { design: designVideoNoTopo(midia, { links: { dismiss: false } }), titulo: SEM_DISMISS });
  });

  test("“Não mostrar de novo” some com dismiss false e o X continua fechando", async ({ page }) => {
    const popUp = await abrirPopUp(page);

    await expect(popUp.getByRole("button", { exact: true, name: "Lembrar depois" })).toBeVisible();
    await expect(popUp.getByText("Não mostrar de novo")).toHaveCount(0);
    await popUp.getByRole("button", { exact: true, name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);
  });
});

test.describe("Padrão e Personalizado", () => {
  test.use({ viewport: { height: 900, width: 1440 } });

  test("continuam os cartões de sempre, sem o cartão Livre", async ({ browser, page }) => {
    await zerarComunicacao();
    await publicarPopUpComDesign(browser, { botao: { href: "/minhas-compras", label: "Saiba mais" }, design: popupStarterDesign("text_only"), titulo: "Pop-up E2E: Personalizado ao lado do Livre" });
    await page.goto("/");
    const personalizado = page.getByRole("dialog");
    await expect(personalizado.locator("[data-popup-design]")).toBeVisible();
    await expect(personalizado.locator("[data-popup-free]")).toHaveCount(0);
    await personalizado.getByRole("button", { exact: true, name: "Fechar" }).click();
    await expect(personalizado).toHaveCount(0);

    await zerarComunicacao();
    await publicarPopUpComDesign(browser, { design: null, texto: "O cartão de sempre.", titulo: "Pop-up E2E: Padrão ao lado do Livre" });
    await page.goto("/");
    const padrao = page.getByRole("dialog", { name: "Pop-up E2E: Padrão ao lado do Livre" });
    await expect(padrao).toBeVisible();
    await expect(padrao.locator("[data-popup-design], [data-popup-free]")).toHaveCount(0);
    await expect(padrao.locator("div.relative.overflow-hidden.rounded-\\[16px\\].bg-\\[\\#181818\\]")).toHaveCount(1);
  });
});
