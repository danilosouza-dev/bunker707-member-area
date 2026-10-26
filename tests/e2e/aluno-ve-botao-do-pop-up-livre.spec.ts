import type { Locator, Page } from "@playwright/test";
import type { PopupFreeDesignInput } from "../../src/server/communications/popup-free-model";
import { bloquearRedeExterna, expect, janelaParada, reabrirPopUpParaAluna, test, zerarComunicacao } from "./fixtures";
import { prepararMidiaDoLivre, publicarPopUpLivre, type MidiaDoLivre } from "./popup-livre-fixtures";

// Livre: as cores do Botão e dos Links ao passar o mouse, no navegador da aluna (docs/27 §13.11.3, L6c; docs/18
// §3.1). O pop-up e o exemplo "Cores ao passar o mouse" do §9.9 (o Botão principal escurece num degrade, o "Agora
// não" de borda fina fica branco com o texto escuro, os Links ficam brancos) mais um botao "Ver compras" com a capa
// de teste em Repetir por cima de um azul e um degrade ao passar o mouse (critica C6). A 1440 px: com o mouse em
// cima, cada um troca so as cores escolhidas (sem o brilho de 110 %) e volta ao sair; nos Links, so o link sob o
// mouse muda; o fundo ao passar o mouse e um degrade so, sem os ladrilhos da imagem (tamanho, lugar e repeticao
// fixos); o Tab mostra exatamente as mesmas cores, com o anel de foco por cima. Cor e borda mudam em 150 ms; com
// menos movimento, nada de transicao. No toque nada fica preso (critica C24): as regras de passar o mouse do Livre so
// existem dentro de @media (hover: hover), lidas das folhas de estilo nos dois navegadores; no Chromium com toque
// (isMobile e hasTouch, conferido antes que ele responde (hover: none)), depois de tocar o botao e um link (o
// navegador marca :hover, o clique e parado antes do app) nenhuma cor muda. As medidas so depois de a janela parar
// de crescer (janelaParada). Funciona no WebKit: o mouse sempre dentro da janela e as cores lidas com expect.poll.

const TITULO = "Pop-up E2E: o aluno vê as cores do botão do Livre";
/** O nome do pop-up para a aluna: o texto do Título do design. */
const NOME = "Aula ao vivo hoje às 20h";
const enderecoDoApp = `http://127.0.0.1:${process.env.E2E_PORT ?? "3100"}`;

/** As cores do design (e como o navegador as calcula). */
const VERMELHO = { hex: "#e50914", rgb: "rgb(229, 9, 20)" } as const;
const VERMELHO_ESCURO = { hex: "#b20710", rgb: "rgb(178, 7, 16)" } as const;
const CINZA_DOS_LINKS = { hex: "#a1a1aa", rgb: "rgb(161, 161, 170)" } as const;
const BRANCO = "rgb(255, 255, 255)";
const ESCURO = "rgb(17, 17, 17)";
const AZUL = "#1d4ed8";
/** O anel de foco do cartao (L6a): so a sombra de 4 px por dentro, escura. */
const ANEL = /^(?:inset )?rgba\(0, 0, 0, 0\.7\d*\) 0px 0px 0px 4px(?: inset)?$/;

/** O exemplo "Cores ao passar o mouse" do docs/27 §9.9, com o botao de imagem em Repetir antes dos Links. */
function designComCores(midia: MidiaDoLivre): PopupFreeDesignInput {
  return {
    assets: [{ height: midia.capa.height, id: "capa", kind: "image", path: midia.capa.path, width: midia.capa.width }],
    children: [
      { id: "titulo", lines: [[{ text: NOME }]], type: "heading" },
      { id: "texto", lines: [[{ text: "Traga suas dúvidas sobre o módulo 3." }]], textStyle: { paint: { color: "#d4d4d8", kind: "solid" } }, type: "text" },
      {
        children: [
          {
            action: { kind: "cta" },
            box: { fill: [{ color: VERMELHO.hex, kind: "solid" }], padding: [12, 24], radius: 999 },
            hover: { fill: { angle: 90, kind: "linear", stops: [{ at: 0, color: VERMELHO.hex }, { at: 100, color: VERMELHO_ESCURO.hex }] } },
            id: "botao",
            type: "button"
          },
          {
            action: { kind: "close" },
            box: { border: { color: "#ffffff40", width: 1 }, padding: [11, 20], radius: 999 },
            hover: { borderColor: "#ffffff", color: "#111111", fill: { color: "#ffffff", kind: "solid" } },
            id: "agoranao",
            label: "Agora não",
            type: "button"
          }
        ],
        id: "acoes",
        layout: { dir: "row", gap: 8, wrap: true },
        type: "box"
      },
      {
        action: { href: "/minhas-compras", kind: "link", target: "same_tab" },
        box: { fill: [{ asset: "capa", fit: "tile", kind: "image" }, { color: AZUL, kind: "solid" }], padding: [11, 20], radius: 999 },
        hover: { fill: { angle: 90, kind: "linear", stops: [{ at: 0, color: "#c084fc" }, { at: 100, color: "#22d3ee" }] } },
        id: "ladrilho",
        label: "Ver compras",
        type: "button"
      },
      { hover: { color: "#ffffff" }, id: "links", textStyle: { paint: { color: CINZA_DOS_LINKS.hex, kind: "solid" } }, type: "links" }
    ],
    fonts: [],
    mode: "free",
    version: 1
  };
}

test.describe.configure({ mode: "serial" });
test.use({ viewport: { height: 900, width: 1440 } });

test.beforeAll(async ({ browser }) => {
  await zerarComunicacao();
  const midia = await prepararMidiaDoLivre();
  await publicarPopUpLivre(browser, { design: designComCores(midia), titulo: TITULO });
});

test.afterAll(zerarComunicacao);

async function abrirPopUp(page: Page) {
  await page.goto("/");
  const popUp = page.getByRole("dialog", { name: NOME });
  await expect(popUp).toBeVisible();
  await expect(popUp.locator("[data-popup-free]")).toBeVisible();
  // As medidas so depois de a janela parar de crescer.
  await janelaParada(popUp);
  return popUp;
}

type Cores = {
  backgroundImage: string;
  backgroundPosition: string;
  backgroundRepeat: string;
  backgroundSize: string;
  borderTopColor: string;
  color: string;
  filter: string;
};

/** O que o navegador calcula agora no elemento: as cores, o fundo (com tamanho, lugar e repeticao) e o filtro. */
async function coresDe(locator: Locator): Promise<Cores> {
  return locator.evaluate((element) => {
    const css = getComputedStyle(element);

    return {
      backgroundImage: css.backgroundImage,
      backgroundPosition: css.backgroundPosition,
      backgroundRepeat: css.backgroundRepeat,
      backgroundSize: css.backgroundSize,
      borderTopColor: css.borderTopColor,
      color: css.color,
      filter: css.filter
    };
  });
}

/** Leva o mouse para um canto da janela, longe do pop-up (o WebKit perde o gesto fora da janela). */
async function mouseLonge(page: Page) {
  await page.mouse.move(8, 8);
}

type RegraDoLivre = { media: string | null; seletor: string };

/** As regras do CSS da pagina com data-free-hover no seletor, cada uma com a @media de fora (null = nenhuma). */
async function regrasDoPassarOMouse(page: Page): Promise<RegraDoLivre[]> {
  return page.evaluate(() => {
    const regras: { media: string | null; seletor: string }[] = [];
    const visitar = (lista: CSSRuleList, media: string | null) => {
      for (const regra of Array.from(lista)) {
        if (regra instanceof CSSMediaRule) {
          visitar(regra.cssRules, regra.media.mediaText);
        } else if (regra instanceof CSSStyleRule) {
          if (regra.selectorText.includes("data-free-hover")) {
            regras.push({ media, seletor: regra.selectorText });
          }
        } else if ("cssRules" in regra) {
          // @layer, @supports e afins: a @media de fora continua valendo.
          visitar((regra as CSSGroupingRule).cssRules, media);
        }
      }
    };

    for (const folha of Array.from(document.styleSheets)) {
      try {
        visitar(folha.cssRules, null);
      } catch {
        // Folha de outra origem: nao e nossa.
      }
    }

    return regras;
  });
}

test("com o mouse em cima, o Botão e os Links trocam só as cores escolhidas, e o Tab mostra as mesmas", async ({ page }) => {
  const popUp = await abrirPopUp(page);
  const botao = popUp.getByRole("link", { name: "Saiba mais" });
  const agoraNao = popUp.getByRole("button", { exact: true, name: "Agora não" });
  const ladrilho = popUp.getByRole("link", { name: "Ver compras" });
  const lembrar = popUp.getByRole("button", { exact: true, name: "Lembrar depois" });
  const naoMostrar = popUp.getByRole("button", { exact: true, name: "Não mostrar de novo" });
  /** As cores com o mouse em cima de cada um, para comparar com o Tab. */
  const comMouse = new Map<string, Cores>();

  await mouseLonge(page);

  await test.step("o Botão principal: o fundo vira o degradê escuro, sem o brilho, e volta ao sair", async () => {
    const parado = await coresDe(botao);

    expect(await botao.getAttribute("data-free-hover")).toBe("fill");
    expect(parado.backgroundImage).toContain(VERMELHO.rgb);
    expect(parado.backgroundImage).not.toContain(VERMELHO_ESCURO.rgb);
    // Cor e borda em 150 ms (a regra fixa do globals.css); o aperto de 1 px tambem.
    expect(await botao.evaluate((element) => getComputedStyle(element).transitionProperty)).toBe("color, border-color, translate");
    expect(await botao.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0.15s, 0.15s, 0.15s");

    await botao.hover();
    await expect.poll(async () => (await coresDe(botao)).backgroundImage).toContain(VERMELHO_ESCURO.rgb);
    const mouse = await coresDe(botao);

    expect(mouse.backgroundImage).toMatch(/^linear-gradient\(/);
    expect(mouse.backgroundImage).toContain(VERMELHO.rgb);
    expect(mouse.color, "a letra fica como estava (sem cor do texto ao passar o mouse)").toBe(parado.color);
    expect(mouse.filter, "com cores próprias, o botão não clareia").toBe("none");
    comMouse.set("botao", mouse);

    await mouseLonge(page);
    await expect.poll(() => coresDe(botao)).toEqual(parado);
  });

  await test.step("o “Agora não”: fundo branco, texto escuro e borda branca com o mouse em cima", async () => {
    const parado = await coresDe(agoraNao);

    expect(await agoraNao.getAttribute("data-free-hover")).toBe("color border fill");
    expect(parado.color).toBe(BRANCO);
    // #ffffff40 (o alfa 64/255: cada navegador escreve com as suas casas).
    expect(parado.borderTopColor).toMatch(/^rgba\(255, 255, 255, 0\.25\d*\)$/);

    await agoraNao.hover();
    await expect.poll(async () => (await coresDe(agoraNao)).color).toBe(ESCURO);
    await expect.poll(async () => (await coresDe(agoraNao)).borderTopColor).toBe(BRANCO);
    const mouse = await coresDe(agoraNao);

    expect(mouse.backgroundImage).toMatch(/^linear-gradient\(/);
    expect(mouse.backgroundImage).toContain(BRANCO);
    expect(mouse.filter).toBe("none");
    comMouse.set("agoranao", mouse);

    await mouseLonge(page);
    await expect.poll(() => coresDe(agoraNao)).toEqual(parado);
  });

  await test.step("o botão com a imagem em Repetir: o degradê ao passar o mouse sai inteiro, sem os ladrilhos (C6)", async () => {
    const parado = await coresDe(ladrilho);

    // Parado: a imagem repetida por cima do azul.
    expect(parado.backgroundImage).toMatch(/^url\(/);
    expect(parado.backgroundRepeat).toMatch(/^repeat\b/);

    await ladrilho.hover();
    await expect.poll(async () => (await coresDe(ladrilho)).backgroundImage).toMatch(/^linear-gradient\(/);
    const mouse = await coresDe(ladrilho);

    expect(mouse.backgroundImage).not.toContain("url(");
    expect(mouse.backgroundSize).toBe("100% 100%");
    expect(mouse.backgroundRepeat).toMatch(/^no-repeat(?: no-repeat)?$/);
    expect(mouse.backgroundPosition).toBe("50% 50%");
    comMouse.set("ladrilho", mouse);

    await mouseLonge(page);
    await expect.poll(() => coresDe(ladrilho)).toEqual(parado);
  });

  await test.step("os Links: só o link sob o mouse fica branco (e sublinhado); o outro continua cinza", async () => {
    const parado = await coresDe(lembrar);

    expect(parado.color).toBe(CINZA_DOS_LINKS.rgb);
    expect(await lembrar.getAttribute("data-free-hover")).toBe("color");

    await lembrar.hover();
    await expect.poll(async () => (await coresDe(lembrar)).color).toBe(BRANCO);
    expect(await lembrar.evaluate((element) => getComputedStyle(element).textDecorationLine)).toBe("underline");
    expect((await coresDe(naoMostrar)).color).toBe(CINZA_DOS_LINKS.rgb);
    comMouse.set("lembrar", await coresDe(lembrar));

    await mouseLonge(page);
    await expect.poll(async () => (await coresDe(lembrar)).color).toBe(CINZA_DOS_LINKS.rgb);
  });

  await test.step("o Tab mostra as mesmas cores do mouse, com o anel de foco por cima", async () => {
    const ordem = [
      ["botao", botao],
      ["agoranao", agoraNao],
      ["ladrilho", ladrilho],
      ["lembrar", lembrar]
    ] as const;

    for (const [nome, alvo] of ordem) {
      await page.keyboard.press("Tab");
      await expect(alvo).toBeFocused();
      await expect.poll(() => coresDe(alvo), `${nome} pelo teclado`).toEqual(comMouse.get(nome));
    }

    await page.keyboard.press("Tab");
    await expect(naoMostrar).toBeFocused();
    await expect.poll(async () => (await coresDe(naoMostrar)).color).toBe(BRANCO);
    // O anel de foco (L6a) continua: nada da regra das cores mexe na sombra.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(botao).toBeFocused();
    await expect.poll(() => botao.evaluate((element) => getComputedStyle(element).boxShadow)).toMatch(ANEL);
  });

  await popUp.getByRole("button", { exact: true, name: "Fechar" }).click();
  await expect(popUp).toHaveCount(0);
});

test.describe("menos movimento", () => {
  test.use({ reducedMotion: "reduce", viewport: { height: 900, width: 1440 } });

  test("as cores trocam na hora, sem transição", async ({ page }) => {
    await reabrirPopUpParaAluna(TITULO);
    const popUp = await abrirPopUp(page);
    const agoraNao = popUp.getByRole("button", { exact: true, name: "Agora não" });

    expect(await agoraNao.evaluate((element) => getComputedStyle(element).transitionProperty)).toBe("none");
    await mouseLonge(page);
    await agoraNao.hover();
    await expect.poll(async () => (await coresDe(agoraNao)).color).toBe(ESCURO);

    await popUp.getByRole("button", { exact: true, name: "Fechar" }).click();
    await expect(popUp).toHaveCount(0);
  });
});

test("no toque nada fica preso: as cores de passar o mouse só valem com mouse de verdade (C24)", async ({ browser, browserName, page }) => {
  await test.step("as regras de passar o mouse do Livre ficam só dentro de @media (hover: hover); as do foco, fora", async () => {
    await reabrirPopUpParaAluna(TITULO);
    await abrirPopUp(page);
    const regras = await regrasDoPassarOMouse(page);
    const doMouse = regras.filter((regra) => regra.seletor.includes(":hover"));
    const doFoco = regras.filter((regra) => regra.seletor.includes(":focus-visible"));

    // A cor, a borda e o fundo: tres regras de cada.
    expect(doMouse.length, JSON.stringify(regras)).toBeGreaterThanOrEqual(3);
    expect(doFoco.length, JSON.stringify(regras)).toBeGreaterThanOrEqual(3);

    for (const regra of doMouse) {
      expect(regra.media, regra.seletor).toMatch(/\(hover:\s*hover\)/);
    }

    for (const regra of doFoco) {
      expect(regra.media ?? "", regra.seletor).not.toMatch(/hover/);
    }
  });

  if (browserName === "chromium") {
    await test.step("Chromium com toque (isMobile e hasTouch): (hover: none), e depois do toque nenhuma cor muda", async () => {
      const contexto = await browser.newContext({
        baseURL: enderecoDoApp,
        hasTouch: true,
        isMobile: true,
        locale: "pt-BR",
        storageState: "tests/e2e/.auth/aluna.json",
        timezoneId: "America/Sao_Paulo",
        viewport: { height: 812, width: 375 }
      });
      await bloquearRedeExterna(contexto);

      try {
        const celular = await contexto.newPage();
        await reabrirPopUpParaAluna(TITULO);
        const popUp = await abrirPopUp(celular);
        const botao = popUp.getByRole("link", { name: "Saiba mais" });
        const lembrar = popUp.getByRole("button", { exact: true, name: "Lembrar depois" });

        // Sem isso o teste nao prova nada: so com hasTouch o navegador continua dizendo (hover: hover).
        expect(await celular.evaluate(() => ({ hover: matchMedia("(hover: hover)").matches, none: matchMedia("(hover: none)").matches }))).toEqual({ hover: false, none: true });

        // O toque chega ao botao como de verdade (o navegador marca :hover), mas o clique e parado antes do app: o
        // pop-up continua aberto para a leitura das cores.
        await celular.evaluate(() =>
          window.addEventListener(
            "click",
            (event) => {
              if (event.target instanceof Element && event.target.closest("[data-free-hover]")) {
                event.preventDefault();
                event.stopPropagation();
              }
            },
            { capture: true }
          )
        );

        for (const alvo of [botao, lembrar]) {
          const parado = await coresDe(alvo);

          await alvo.tap();
          // Passa da transicao de 150 ms: se alguma cor fosse mudar, ja teria mudado.
          await celular.waitForTimeout(400);
          expect(await alvo.evaluate((element) => element.matches(":hover")), "o toque deixa o :hover preso").toBe(true);
          expect(await coresDe(alvo)).toEqual(parado);
        }

        await expect(popUp).toBeVisible();
      } finally {
        await contexto.close();
      }
    });
  }
});
