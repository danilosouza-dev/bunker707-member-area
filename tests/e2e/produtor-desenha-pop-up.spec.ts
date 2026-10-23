import type { Locator, Page } from "@playwright/test";
import { pngQuadrado } from "../support/imagem-de-teste.mjs";
import { designDoPopUpNoBanco, estadoDoPopUpDaAluna, eventosDoPopUp, expect, reabrirPopUpParaAluna, test, zerarComunicacao, type DesignDoPopUpNoBanco } from "./fixtures";

// "Design do pop-up" de ponta a ponta (docs/26 §8; docs/18 §3.1): o produtor abre um pop-up novo, escolhe
// Personalizado e o modelo "Mídia no topo com degradê", envia o video de teste (um quadro dele vira a capa) e a
// fonte de teste, troca as duas linhas do titulo com duas cores, usa a fonte no titulo, estiliza o botao
// principal (degrade, cor do texto, ocupa a linha) e ve a previa do celular e do computador mudar; publica. A
// aluna abre o Início e ve o pop-up: o titulo e texto de verdade (selecionavel, nao imagem), na fonte enviada; o
// <video> e mudo, em repeticao, com a capa; o clique no botao conta como antes; em 375 px nao rola para o lado;
// com menos movimento nao ha <video>. Com E2E_SHOTS_DIR, guarda as fotos do editor e do pop-up nessa pasta.
// O pedido do produtor depois da primeira versao (docs/26 §1.3): ele sobe o escuro do degradê ("Começa a
// escurecer em" 35 %, "Fica totalmente escuro em" 70 %) e o titulo fica na parte escura, na previa e no pop-up
// da aluna (a mascara da midia e conferida parada a parada); e escolhe Cartão > Fundo > Imagem (a imagem embaixo,
// com o escuro por cima), que aparece atras do texto nos dois lugares.

const TITULO = "Pop-up E2E: o produtor desenha";
const LINHA_1 = "Aprenda IA";
const LINHA_2 = "Do zero ao agente";
const NOME_NO_DIALOGO = `${LINHA_1} ${LINHA_2}`;
const COR_1 = { hex: "#38bdf8", rgb: "rgb(56, 189, 248)" };
const COR_2 = { hex: "#f472b6", rgb: "rgb(244, 114, 182)" };
const BOTAO = "Quero assistir";
const FONTE = "Fonte do produtor E2E";
const SESSAO_DO_PRODUTOR = "tests/e2e/.auth/produtor.json";
const FIXTURES = "tests/fixtures/popup-design";
const SHOTS = process.env.E2E_SHOTS_DIR;
/** O escuro subido pelo produtor (% da altura da midia, do topo). */
const ESCURO = { comeca: 35, total: 70 };
const IMAGEM_DO_FUNDO = /url\("[^"]+\/storage\/v1\/object\/public\/content-assets\/communications\/images\/[a-f0-9]{24}\.webp"\)/;
const SEM_MEDIDA_COM_IMAGEM = "Com imagem no fundo não dá para medir o contraste. Confira na prévia se os textos ficam fáceis de ler.";

test.describe.configure({ mode: "serial" });

test.beforeAll(zerarComunicacao);
test.afterAll(zerarComunicacao);

/** Clica numa pilula (PillGroup) pelo `name` do grupo e o valor. */
async function escolherPilula(escopo: Locator, nome: string, valor: string) {
  await escopo.locator(`label:has(input[name="${nome}"][value="${valor}"])`).click();
  await expect(escopo.locator(`input[name="${nome}"][value="${valor}"]`)).toBeChecked();
}

/** O primeiro fundo desenhado subindo do elemento (o texto do botao fica num span dentro do botao). */
async function fundoDe(elemento: Locator) {
  return elemento.evaluate((node) => {
    for (let atual: Element | null = node; atual; atual = atual.parentElement) {
      const fundo = getComputedStyle(atual).backgroundImage;

      if (fundo && fundo !== "none") {
        return fundo;
      }
    }

    return "none";
  });
}

/**
 * O degradê "Igual ao fundo do cartão" e a mascara da midia: ate onde ela e opaca, de onde ela some de vez e
 * quanto da midia ainda aparece no topo do titulo (0 = o titulo fica so no escuro do cartao).
 */
async function escuroDaMidia(escopo: Locator) {
  return escopo.evaluate((root) => {
    const media = root.querySelector("[data-popup-media]");
    const heading = root.querySelector("h2");

    if (!media || !heading) {
      return null;
    }

    const css = getComputedStyle(media);
    const mask = css.maskImage && css.maskImage !== "none" ? css.maskImage : css.webkitMaskImage;
    const stops = [...mask.matchAll(/rgba?\(([^)]+)\)\s+([\d.]+)%/g)].map(([, rgb, at]) => {
      const parts = rgb.split(",");
      return { alpha: parts.length === 4 ? Number(parts[3]) : 1, at: Number(at) };
    });
    const box = media.getBoundingClientRect();
    const top = ((heading.getBoundingClientRect().top - box.top) / box.height) * 100;
    // Quanto da midia aparece no topo do titulo: interpolado entre as paradas (depois da ultima, a ultima).
    let behind = stops.length ? stops[stops.length - 1].alpha : 1;

    for (let index = 1; index < stops.length; index += 1) {
      const [from, to] = [stops[index - 1], stops[index]];

      if (top <= to.at) {
        behind = top <= from.at ? from.alpha : from.alpha + ((to.alpha - from.alpha) * (top - from.at)) / (to.at - from.at);
        break;
      }
    }

    return {
      atrasDoTitulo: Math.round(behind * 100) / 100,
      opacaAte: Math.max(...stops.filter((stop) => stop.alpha === 1).map((stop) => stop.at)),
      someDesde: Math.min(...stops.filter((stop) => stop.alpha === 0).map((stop) => stop.at))
    };
  });
}

/** O fundo do cartao (o elemento com a cor, o degrade ou a imagem). */
async function fundoDoCartao(escopo: Locator) {
  return escopo.locator("[data-popup-design] > div").first().evaluate((element) => getComputedStyle(element).backgroundImage);
}

test.describe("produtor", () => {
  test.use({ storageState: SESSAO_DO_PRODUTOR, viewport: { height: 900, width: 1440 } });

  test("monta o pop-up no Personalizado, vê as prévias mudarem e publica", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/admin/comunicacao/avisos/novo?tipo=popup");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Título", { exact: true }).fill(TITULO);

    const design = page.getByRole("region", { exact: true, name: "Design" });
    await design.getByText("Personalizado", { exact: true }).click();
    await design.getByRole("button", { name: "Usar este modelo: Mídia no topo com degradê" }).click();

    // Video de teste: vai direto ao Storage; sem imagem no aviso, um quadro dele vira a capa.
    await design.getByRole("radiogroup", { name: "Mídia do pop-up" }).getByText("Vídeo", { exact: true }).click();
    await design.locator('input[type="file"][accept="video/mp4,video/webm"]').setInputFiles(`${FIXTURES}/video-de-teste.mp4`);
    await expect(design.getByText("Vídeo enviado", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(design.getByRole("button", { name: "Trocar imagem" })).toBeVisible({ timeout: 30_000 });

    // Fonte de teste na biblioteca (pela rota de envio), com um nome escolhido.
    await design.getByRole("button", { exact: true, name: "Enviar fonte" }).click();
    const dialogo = page.getByRole("dialog", { name: "Enviar fonte" });
    await dialogo.locator('input[type="file"]').setInputFiles(`${FIXTURES}/fonte-de-teste.woff2`);
    await dialogo.getByLabel("Nome", { exact: true }).fill(FONTE);
    await dialogo.getByRole("button", { exact: true, name: "Enviar" }).click();
    await expect(dialogo).toBeHidden({ timeout: 30_000 });
    await expect(design.getByText(FONTE, { exact: true }).first()).toBeVisible();

    // Titulo: as duas linhas com textos e cores proprias, na fonte enviada.
    await design.getByRole("button", { name: "Editar o bloco Título" }).click();
    await design.locator("#popup-design-bloco-1-linha-0").fill(LINHA_1);
    await design.locator("#popup-design-bloco-1-linha-1").fill(LINHA_2);
    await design.locator("#popup-design-bloco-1-linha-0-cor").fill(COR_1.hex);
    await escolherPilula(design, "popup-design-bloco-1-linha-1-cor-tipo", "solid");
    await design.locator("#popup-design-bloco-1-linha-1-cor").fill(COR_2.hex);
    await design.locator("#popup-design-bloco-1-estilo-fonte").click();
    await page.getByRole("option", { exact: true, name: FONTE }).click();
    await expect(design.locator("#popup-design-bloco-1-estilo-fonte")).toContainText(FONTE);

    // Botao principal: texto, destino (o mesmo campo do CTA) e estilo (degrade, cor do texto, ocupa a linha).
    await design.getByRole("button", { name: "Editar o bloco Botão principal" }).click();
    await design.locator("#aviso-botao-texto").fill(BOTAO);
    await design.getByRole("radiogroup", { name: "Para onde o botão leva" }).getByText("Página da área", { exact: true }).click();
    await design.getByRole("radiogroup", { name: "Página da área do aluno" }).getByText("Minhas compras", { exact: true }).click();
    await escolherPilula(design, "popup-design-bloco-3-estilo-fundo-tipo", "gradient");
    await design.locator("#popup-design-bloco-3-estilo-fundo-de").fill("#22d3ee");
    await design.locator("#popup-design-bloco-3-estilo-fundo-para").fill("#a78bfa");
    await design.locator("#popup-design-bloco-3-estilo-texto-cor").fill("#0b0b0f");
    await escolherPilula(design, "popup-design-bloco-3-estilo-largura", "full");

    // Sobe o escuro do degradê: o modelo escurece de 50 % a 92 % da mídia; o produtor quer o escuro mais alto.
    // "Parte da mídia que aparece" (o antigo "Recorte") é só o enquadramento, não o degradê.
    await expect(design.getByText("Muda só o enquadramento do vídeo ou da imagem, não o degradê.", { exact: true })).toBeVisible();
    const comeca = design.getByLabel("Começa a escurecer em", { exact: true });
    const total = design.getByLabel("Fica totalmente escuro em", { exact: true });
    await expect(comeca).toHaveValue("50");
    await expect(total).toHaveValue("92");
    await comeca.fill(String(ESCURO.comeca));
    await comeca.blur();
    await total.fill(String(ESCURO.total));
    await total.blur();
    await expect(comeca).toHaveValue(String(ESCURO.comeca));
    await expect(total).toHaveValue(String(ESCURO.total));

    // Cartão > Fundo > Imagem: a imagem sobe pelo envio da imagem do aviso (recorte 16:9) e fica embaixo.
    const cartao = design.getByRole("region", { exact: true, name: "Cartão" });
    await cartao.getByRole("radiogroup", { exact: true, name: "Fundo" }).getByText("Imagem", { exact: true }).click();
    await cartao.locator("#popup-design-cartao-fundo input[type='file'][accept='image/*']").setInputFiles({ buffer: pngQuadrado(1280), mimeType: "image/png", name: "fundo-de-teste.png" });
    await page.getByRole("dialog").getByRole("button", { exact: true, name: "Usar esta imagem" }).click();
    await expect(cartao.getByRole("button", { name: "Trocar imagem" })).toBeVisible({ timeout: 30_000 });
    await expect(cartao.locator("input[name='popup-design-cartao-imagem-parte'][value='bottom']")).toBeChecked();
    const escurecer = cartao.getByLabel("Escurecer a imagem", { exact: true });
    await escurecer.fill("30");
    await escurecer.blur();
    await expect(cartao.getByText(SEM_MEDIDA_COM_IMAGEM, { exact: true })).toBeVisible();

    // As duas previas (celular e computador) mostram o titulo novo nas cores escolhidas e o botao em degrade.
    const previa = page.getByRole("region", { exact: true, name: "Prévia" });
    for (const aparelho of ["celular", "computador"]) {
      const figura = previa.getByRole("figure", { name: `Prévia do pop-up no ${aparelho}` });
      await expect(figura).toBeVisible();
      const linha1 = figura.getByText(LINHA_1, { exact: true });
      const linha2 = figura.getByText(LINHA_2, { exact: true });
      await expect(linha1).toBeVisible();
      await expect(linha1).toHaveCSS("color", COR_1.rgb);
      await expect(linha2).toHaveCSS("color", COR_2.rgb);
      await expect(figura.getByText(BOTAO, { exact: true })).toBeVisible();
      await expect.poll(() => fundoDe(figura.getByText(BOTAO, { exact: true }))).toContain("linear-gradient");
      await expect.poll(() => figura.getByRole("heading", { level: 2 }).evaluate((element) => getComputedStyle(element).fontFamily)).toMatch(/bf_[a-f0-9]{12}/);

      // O escuro subiu: a midia e opaca ate 35 %, some de vez em 70 % e o titulo fica so no escuro.
      await expect.poll(() => escuroDaMidia(figura)).toMatchObject({ atrasDoTitulo: 0, opacaAte: ESCURO.comeca, someDesde: ESCURO.total });
      // A imagem do fundo (do nosso bucket) atras do texto, com o escuro por cima.
      await expect.poll(() => fundoDoCartao(figura), { timeout: 30_000 }).toMatch(IMAGEM_DO_FUNDO);
    }

    const celular = await previa.getByRole("figure", { name: "Prévia do pop-up no celular" }).locator("[data-popup-design]").boundingBox();
    const computador = await previa.getByRole("figure", { name: "Prévia do pop-up no computador" }).locator("[data-popup-design]").boundingBox();
    expect(celular?.width ?? 0).toBeLessThan(computador?.width ?? 0);

    if (SHOTS) {
      await design.screenshot({ path: `${SHOTS}/editor-design-1440.png` });
      await previa.screenshot({ path: `${SHOTS}/editor-previa-1440.png` });
      await page.setViewportSize({ height: 812, width: 375 });
      await design.screenshot({ path: `${SHOTS}/editor-design-375.png` });
      await previa.screenshot({ path: `${SHOTS}/editor-previa-375.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await page.setViewportSize({ height: 900, width: 1440 });
    }

    await page.getByRole("button", { exact: true, name: "Publicar pop-up" }).click();
    await expect(page.getByText(/^Pop-up publicado\./)).toBeVisible({ timeout: 30_000 });

    // O que ficou gravado: Personalizado com o video do nosso bucket, a capa e a fonte enviada no titulo.
    const gravado = await designDoPopUpNoBanco(TITULO);
    expect(gravado.design?.media.kind).toBe("video");
    expect(gravado.design?.media.video?.url).toMatch(/\/storage\/v1\/object\/public\/communication-popup-video\/videos\/[0-9a-f-]{36}\.mp4$/);
    expect(gravado.imagem).toMatch(/\/storage\/v1\/object\/public\/content-assets\//);
    expect(gravado.fontes.map((fonte) => fonte.name)).toEqual([FONTE]);
    expect(gravado.design?.media.fade).toEqual({ color: "auto", enabled: true, end: ESCURO.total, height: ESCURO.total - ESCURO.comeca });
    expect(gravado.design?.card.background).toMatchObject({ dim: 30, kind: "image", position: "bottom" });
    expect(gravado.design?.card.background.url).toMatch(
      /\/storage\/v1\/object\/public\/content-assets\/communications\/images\/[a-f0-9]{24}\.webp$/
    );
    const titulo = gravado.design?.blocks.find((block) => block.type === "heading") as { lines: { paint: { color: string } | null; text: string }[] };
    expect(titulo.lines).toEqual([
      { paint: { color: COR_1.hex, kind: "solid" }, size: null, text: LINHA_1 },
      { paint: { color: COR_2.hex, kind: "solid" }, size: null, text: LINHA_2 }
    ]);
  });
});

test.describe("aluna", () => {
  let gravado: DesignDoPopUpNoBanco;

  test.beforeAll(async () => {
    gravado = await designDoPopUpNoBanco(TITULO);
  });

  async function abrirPopUp(page: Page) {
    await page.goto("/");
    const popUp = page.getByRole("dialog", { name: NOME_NO_DIALOGO });
    await expect(popUp).toBeVisible();
    return popUp;
  }

  test.describe("computador (1440 px)", () => {
    test.use({ viewport: { height: 900, width: 1440 } });

    test("vê o título de verdade na fonte enviada, o vídeo mudo em loop com a capa, e o clique conta", async ({ page }) => {
      const popUp = await abrirPopUp(page);
      const titulo = popUp.getByRole("heading", { level: 2, name: NOME_NO_DIALOGO });
      await expect(titulo).toBeVisible();
      await expect(popUp.getByText(TITULO)).toHaveCount(0);

      // Texto de verdade: a selecao pega as duas linhas; nada de imagem, canvas ou svg no lugar do texto.
      const selecionado = await titulo.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
        return window.getSelection()?.toString() ?? "";
      });
      // O modelo usa "Tudo em maiúsculas" (text-transform): a selecao copia como aparece; o texto guardado e o digitado.
      expect(selecionado.replace(/\s+/g, " ").trim()).toBe(NOME_NO_DIALOGO.toLocaleUpperCase("pt-BR"));
      expect((await titulo.textContent())?.replace(/\s+/g, " ").trim()).toBe(NOME_NO_DIALOGO);
      expect(await titulo.evaluate((element) => element.querySelectorAll("img, svg, canvas, picture, video").length)).toBe(0);
      expect(await titulo.evaluate((element) => getComputedStyle(element).userSelect)).not.toBe("none");
      await expect(titulo.getByText(LINHA_1, { exact: true })).toHaveCSS("color", COR_1.rgb);
      await expect(titulo.getByText(LINHA_2, { exact: true })).toHaveCSS("color", COR_2.rgb);

      // A fonte enviada: registrada e carregada no navegador, e no font-family do titulo.
      const familia = gravado.fontes[0]?.family ?? "";
      expect(familia).toMatch(/^bf_[a-f0-9]{12}$/);
      await expect
        .poll(() => page.evaluate((nome) => [...document.fonts].some((face) => face.family.replace(/"/g, "") === nome && face.status === "loaded"), familia))
        .toBe(true);
      expect(await titulo.evaluate((element) => getComputedStyle(element).fontFamily)).toContain(familia);

      // O video: mudo, em repeticao, inline, autoplay, sem controles, com a capa (o quadro) e o arquivo do bucket.
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
      ).toEqual({ autoplay: true, controls: false, loop: true, muted: true, playsInline: true, poster: gravado.imagem, source: gravado.design?.media.video?.url ?? null });

      // O escuro subido e a imagem do fundo chegam iguais ao pop-up da aluna (o mesmo cartao da previa).
      await expect.poll(() => escuroDaMidia(popUp)).toMatchObject({ atrasDoTitulo: 0, opacaAte: ESCURO.comeca, someDesde: ESCURO.total });
      await expect.poll(() => fundoDoCartao(popUp)).toMatch(IMAGEM_DO_FUNDO);

      // O botao estilizado.
      const botao = popUp.getByRole("link", { name: BOTAO });
      await expect(botao).toBeVisible();
      expect(await fundoDe(botao)).toContain("linear-gradient");
      await expect(botao).toHaveCSS("color", "rgb(11, 11, 15)");

      if (SHOTS) {
        await page.screenshot({ path: `${SHOTS}/aluno-fonte-degrade-1440.png` });
      }

      // O clique conta como o CTA de sempre e leva ao destino.
      await botao.click();
      await expect(page).toHaveURL(/\/minhas-compras$/);
      await expect.poll(async () => (await estadoDoPopUpDaAluna(TITULO))?.clickedAt ?? null).not.toBeNull();
      await expect.poll(async () => (await eventosDoPopUp(gravado.id)).map((evento) => evento.event_type)).toContain("message_clicked");
    });
  });

  test.describe("celular (375 px)", () => {
    test.use({ viewport: { height: 812, width: 375 } });

    test("cabe na tela sem rolagem para o lado", async ({ page }) => {
      await reabrirPopUpParaAluna(TITULO);
      const popUp = await abrirPopUp(page);
      const cartao = popUp.locator("[data-popup-design]");
      await expect(popUp.locator("video")).toHaveCount(1);

      const caixa = await cartao.boundingBox();
      expect(caixa?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((caixa?.x ?? 0) + (caixa?.width ?? 0)).toBeLessThanOrEqual(375);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      expect(parseFloat(await popUp.getByRole("heading", { level: 2 }).evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12);
      expect(Math.round((await popUp.getByRole("link", { name: BOTAO }).boundingBox())?.height ?? 0)).toBeGreaterThanOrEqual(44);

      if (SHOTS) {
        await page.screenshot({ path: `${SHOTS}/aluno-fonte-degrade-375.png` });
      }

      await popUp.getByRole("button", { exact: true, name: "Fechar" }).click();
      await expect(popUp).toHaveCount(0);
    });
  });

  test.describe("menos movimento", () => {
    test.use({ reducedMotion: "reduce", viewport: { height: 900, width: 1440 } });

    test("nenhum <video>: só a capa, sem baixar o vídeo", async ({ page }) => {
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
      await expect(popUp.getByRole("heading", { level: 2, name: NOME_NO_DIALOGO })).toBeVisible();
      expect(pedidosDoVideo).toEqual([]);
    });
  });
});
