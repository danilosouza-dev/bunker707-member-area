import type { Page } from "@playwright/test";
import { canonicalPopupDesign, newPopupBlock, popupStarterDesign, type PopupButton2Block } from "../../src/server/communications/popup-design-model";
import { estadoDoPopUpDaAluna, eventosDoPopUp, expect, idDoAviso, janelaParada, reabrirPopUpParaAluna, test, zerarComunicacao } from "./fixtures";
import { prepararMidiaDoDesign, publicarPopUpComDesign, type MidiaDoDesign } from "./popup-design-fixtures";

// Pop-up "Personalizado" no navegador da aluna (docs/26; docs/18 §3.1): o modelo "Mídia no topo com degradê"
// com o video de teste, o titulo na fonte enviada e um segundo botao "Agora não" (Fechar). O nome do dialogo e
// o texto do titulo do design (nao o nome do pop-up nas listas); o texto e de verdade (selecionavel); o
// <video> e mudo, em repeticao, inline, autoplay e com a capa; com menos movimento nada do video e baixado; o
// botao principal conta o clique e navega; o segundo botao fecha como o X; no celular (375 px) cabe sem
// rolagem para o lado, com fonte de pelo menos 12 px e botoes de 44 px; e o Padrão continua o cartao de
// sempre. Com E2E_SHOTS_DIR, guarda as fotos de 1440 e 375 px nessa pasta (conferencia visual).

const TITULO = "Pop-up E2E: design com vídeo";
const NOME_NO_DIALOGO = "Conteúdo novo Já disponível";
const PADRAO = "Pop-up E2E: cartão Padrão";
const TEXTO_PADRAO = "O cartão de sempre, sem design.";
const SHOTS = process.env.E2E_SHOTS_DIR;

let midia: MidiaDoDesign;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  await zerarComunicacao();
  midia = await prepararMidiaDoDesign();

  const modelo = popupStarterDesign("media_top_fade", { video: midia.video });
  const design = canonicalPopupDesign({
    ...modelo,
    blocks: [
      ...modelo.blocks.map((block) => (block.type === "heading" ? { ...block, style: { ...block.style, font: { id: midia.fonte.id, kind: "uploaded" as const } } } : block)),
      { ...(newPopupBlock("button2", "b8") as PopupButton2Block), label: "Agora não" }
    ]
  });

  await publicarPopUpComDesign(browser, { botao: { href: "/minhas-compras", label: "Saiba mais" }, design, imagem: midia.capa, titulo: TITULO });
});

test.afterAll(zerarComunicacao);

async function abrirPopUp(page: Page) {
  await page.goto("/");
  const popUp = page.getByRole("dialog", { name: NOME_NO_DIALOGO });
  await expect(popUp).toBeVisible();
  // As medidas so depois de a janela parar de crescer.
  await janelaParada(popUp);
  return popUp;
}

test.describe("computador (1440 px)", () => {
  test.use({ viewport: { height: 900, width: 1440 } });

  test("nome = título do design, texto selecionável, vídeo mudo em loop com capa e a fonte enviada", async ({ page }) => {
    const popUp = await abrirPopUp(page);

    await expect(popUp.getByRole("heading", { level: 2, name: NOME_NO_DIALOGO })).toBeVisible();
    await expect(popUp.getByText(TITULO)).toHaveCount(0);

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
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime > 0 && !element.paused)).toBe(true);

    // A fonte enviada: registrada (FontFace) e carregada; o titulo usa a familia bf_.
    await expect(page.locator("[data-popup-design][data-fonts-ready]")).toHaveCount(1);
    await expect
      .poll(() => page.evaluate((family) => [...document.fonts].some((face) => face.family.replace(/"/g, "") === family && face.status === "loaded"), midia.fonte.family))
      .toBe(true);
    expect(await popUp.getByRole("heading", { level: 2 }).evaluate((element) => getComputedStyle(element).fontFamily)).toContain(midia.fonte.family);

    const fechar = popUp.getByRole("button", { exact: true, name: "Fechar" });
    const caixa = await fechar.boundingBox();
    expect([Math.round(caixa?.width ?? 0), Math.round(caixa?.height ?? 0)]).toEqual([36, 36]);

    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/aluno-design-video-1440.png` });
    }

    // O botao principal conta o clique (como o CTA de sempre) e leva ao destino.
    await popUp.getByRole("link", { name: "Saiba mais" }).click();
    await expect(page).toHaveURL(/\/minhas-compras$/);
    await expect.poll(async () => (await estadoDoPopUpDaAluna(TITULO))?.clickedAt ?? null).not.toBeNull();
  });

  test("o segundo botão Fechar fecha como o X", async ({ page }) => {
    await reabrirPopUpParaAluna(TITULO);
    const id = await idDoAviso(TITULO);
    const popUp = await abrirPopUp(page);

    await popUp.getByRole("button", { exact: true, name: "Agora não" }).click();
    await expect(popUp).toHaveCount(0);
    await expect.poll(async () => (await eventosDoPopUp(id)).map((evento) => evento.event_type).at(-1)).toBe("message_closed");
    expect((await eventosDoPopUp(id)).at(-1)?.metadata).toMatchObject({ via: "x" });
    expect((await estadoDoPopUpDaAluna(TITULO))?.dismissedAt ?? null).toBeNull();
  });
});

test.describe("menos movimento", () => {
  test.use({ reducedMotion: "reduce", viewport: { height: 900, width: 1440 } });

  test("só a capa aparece e nada do vídeo é baixado", async ({ page }) => {
    await reabrirPopUpParaAluna(TITULO);
    const pedidosDoVideo: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/communication-popup-video/")) {
        pedidosDoVideo.push(request.url());
      }
    });

    const popUp = await abrirPopUp(page);

    await expect(popUp.locator("[data-popup-media='image'] img")).toBeVisible();
    await expect(popUp.locator("video")).toHaveCount(0);
    expect(pedidosDoVideo).toEqual([]);
    await popUp.getByRole("button", { exact: true, name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);
  });
});

test.describe("celular (375 px)", () => {
  test.use({ viewport: { height: 812, width: 375 } });

  test("cabe sem rolagem para o lado, fonte de pelo menos 12 px e botões de 44 px", async ({ page }) => {
    await reabrirPopUpParaAluna(TITULO);
    const popUp = await abrirPopUp(page);
    const cartao = popUp.locator("[data-popup-design]");

    await expect(popUp.locator("video")).toHaveCount(1);
    await expect.poll(() => popUp.locator("video").evaluate((element: HTMLVideoElement) => element.currentTime > 0)).toBe(true);

    const caixa = await cartao.boundingBox();
    expect(caixa?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((caixa?.x ?? 0) + (caixa?.width ?? 0)).toBeLessThanOrEqual(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

    const menorFonte = await cartao.evaluate((element) =>
      Math.min(
        ...[...element.querySelectorAll("*")]
          .filter((node) => [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()))
          .map((node) => parseFloat(getComputedStyle(node).fontSize))
      )
    );
    expect(menorFonte).toBeGreaterThanOrEqual(12);

    for (const nome of ["Saiba mais", "Agora não"]) {
      const botao = popUp.getByRole(nome === "Saiba mais" ? "link" : "button", { exact: true, name: nome });
      expect(Math.round((await botao.boundingBox())?.height ?? 0)).toBeGreaterThanOrEqual(44);
    }

    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/aluno-design-video-375.png` });
    }

    await popUp.getByRole("button", { exact: true, name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);
  });
});

test.describe("Padrão", () => {
  test("um pop-up sem design continua o cartão de sempre", async ({ browser, page }) => {
    await publicarPopUpComDesign(browser, { design: null, texto: TEXTO_PADRAO, titulo: PADRAO });
    await page.goto("/");

    const popUp = page.getByRole("dialog", { name: PADRAO });
    await expect(popUp).toBeVisible();
    await expect(popUp.getByRole("heading", { level: 2, name: PADRAO })).toBeVisible();
    await expect(popUp.getByText(TEXTO_PADRAO)).toBeVisible();
    await expect(popUp.locator("[data-popup-design]")).toHaveCount(0);
    await expect(popUp.locator("div.relative.overflow-hidden.rounded-\\[16px\\].bg-\\[\\#181818\\]")).toHaveCount(1);
    expect(await popUp.getAttribute("aria-describedby")).toBeTruthy();
  });
});
