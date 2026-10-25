import type { Locator, Page } from "@playwright/test";
import type { FreeNode } from "../../src/server/communications/popup-free-model";
import { expect, test, zerarComunicacao } from "./fixtures";
import {
  SESSAO_DO_PRODUTOR,
  abrirEditorLivre,
  arrastar,
  botaoDaCamada,
  caixaParada,
  centroDe,
  daPrancheta,
  designDoRascunhoLivre,
  falado,
  gravarRascunhoLivre,
  lerDesignDoAviso,
  menuDoZoom,
  noPalco,
  pontoNaPrancheta,
  prancheta,
  rolagemDaArea,
  zoomMostrado
} from "./popup-livre-editor-fixtures";

// Livre: o zoom em passos (docs/27 §13.10, L4b; docs/18 §3.1), numa tela de 1280 x 800. Num rascunho alto (altura
// minima de 900 px, para o "Ajustar à tela" ficar abaixo de 75 %) com [Título, uma Forma solta, Links], o produtor usa
// o + da barra (de Ajustar a 75 %, 100 % e 150 %: a prancheta desenhada com 1,5 vez a largura), arrasta a Forma 30 px
// de tela a 150 % (o X do Avançado muda 20), aperta Ctrl + = no meio de um arrastar (o zoom nao muda) e Ctrl + − e Ctrl
// + = com o foco no palco (a frase "Zoom …"). O Ctrl + roda com o mouse parado mantem o ponto sob o ponteiro (2 px de
// folga). A 200 %, Ctrl + = diz que ja esta no maior, rolar ate o comeco mostra a borda esquerda da prancheta (a
// moldura nao corta) e segurar a Forma na borda de baixo rola a area sozinha (o Y gravado cresce). O menu volta a
// 150 % (o foco volta ao botao do menu) e ao "Ajustar à tela", com a escala dita na frase. Salvar rascunho mantem o
// zoom e o gravado so muda o lugar da Forma. Funciona no WebKit: o mouse dentro da janela, a prancheta e a Forma
// paradas antes de medir, o menu pelo teclado quando o foco e conferido, e o foco posto no palco antes de cada tecla.

const TITULO = "Pop-up E2E: o produtor usa o zoom no Livre";
const TELA = { height: 800, width: 1280 } as const;
const FORMA = { h: 60, mode: "free" as const, w: 60, x: 100, y: 300 };
const CHILDREN: FreeNode[] = [
  { id: "titulo", lines: [[{ text: "Aula nova no ar" }]], type: "heading" },
  { box: { fill: [{ color: "#38bdf8", kind: "solid" }], radius: 8 }, id: "forma", name: "Forma azul", place: FORMA, type: "shape" },
  { id: "links", type: "links" }
];
const EXTRA = { artboard: { minHeight: 900 } };

test.describe.configure({ mode: "serial" });
test.use({ storageState: SESSAO_DO_PRODUTOR, viewport: TELA });

let avisoId = "";

test.beforeAll(async () => {
  await zerarComunicacao();
  avisoId = await gravarRascunhoLivre(TITULO, CHILDREN, EXTRA);
});

test.afterAll(zerarComunicacao);

/** A escala desenhada: a largura da prancheta na tela pela largura dela no design (440). */
async function escala(editor: Locator) {
  return (await caixaParada(prancheta(editor))).width / 440;
}

/** Uma tecla com o foco no palco (o foco vem pelo teclado: no WebKit o clique nao da foco). */
async function noPalcoTecla(page: Page, editor: Locator, tecla: string) {
  await editor.locator("[data-free-stage]").focus();
  await expect(editor.locator("[data-free-stage]")).toBeFocused();
  await page.keyboard.press(tecla);
}

/** O numero de um campo do painel (aceita a virgula do pt-BR). */
async function numeroDe(campo: Locator) {
  return Number((await campo.inputValue()).replace(",", "."));
}

test("o zoom em passos: botões, menu, Ctrl + = e −, Ctrl + roda, a moldura a 200 % e a rolagem sozinha", async ({ page }) => {
  test.setTimeout(180_000);

  const editor = await abrirEditorLivre(page, avisoId);
  const frase = falado(editor);
  const mais = editor.locator('[data-free-zoom="in"]');
  const menos = editor.locator('[data-free-zoom="out"]');
  const campoX = editor.locator("#livre-forma-x");
  const campoY = editor.locator("#livre-forma-y");
  const area = editor.locator('[data-free-zone="canvas"]');
  let ajustar = 0;

  await test.step("ao abrir, Ajustar à tela abaixo de 75 %; o + vai a 75 %, 100 % e 150 %", async () => {
    ajustar = Math.round((await escala(editor)) * 100);
    expect(ajustar, "a prancheta alta nao cabe inteira em 75 %").toBeGreaterThan(50);
    expect(ajustar).toBeLessThan(75);
    expect(await zoomMostrado(editor)).toBe(`${ajustar} %`);
    await expect(menuDoZoom(editor)).toHaveAccessibleName(`Zoom: Ajustar à tela (${ajustar} %)`);

    await mais.click();
    await expect(frase).toHaveText("Zoom 75 %.");
    expect(await zoomMostrado(editor)).toBe("75 %");
    await mais.click();
    await expect(frase).toHaveText("Zoom 100 %.");
    await mais.click();
    await expect(frase).toHaveText("Zoom 150 %.");
    expect(await zoomMostrado(editor)).toBe("150 %");
    await expect(menuDoZoom(editor)).toHaveAccessibleName("Zoom: 150 %");
    expect(await escala(editor)).toBeCloseTo(1.5, 2);
    await expect(menos).not.toHaveAttribute("aria-disabled", "true");
  });

  await test.step("a 150 %, arrastar a Forma 30 px de tela muda o X em 20 no Avançado", async () => {
    // Escolher nas Camadas leva a Forma para a vista.
    await botaoDaCamada(editor, "forma").click();
    await editor.getByRole("tab", { exact: true, name: "Avançado" }).click();
    await expect(campoX).toHaveValue(String(FORMA.x));

    const de = centroDe(await caixaParada(noPalco(editor, "forma")));
    await arrastar(page, de, { x: de.x + 30, y: de.y });
    await expect(campoX).toHaveValue(String(FORMA.x + 20));
    await expect(campoY).toHaveValue(String(FORMA.y));
  });

  await test.step("Ctrl + = no meio de um arrastar não muda o zoom (e o Esc cancela o arrastar)", async () => {
    const de = centroDe(await caixaParada(noPalco(editor, "forma")));

    await arrastar(page, de, { x: de.x + 20, y: de.y + 20 }, {
      antesDeSoltar: async () => {
        await page.keyboard.press("Control+Equal");
        expect(await zoomMostrado(editor)).toBe("150 %");
        await page.keyboard.press("Escape");
      }
    });

    expect(await zoomMostrado(editor)).toBe("150 %");
    expect(await escala(editor)).toBeCloseTo(1.5, 2);
    await expect(campoX).toHaveValue(String(FORMA.x + 20));
  });

  await test.step("Ctrl + − e Ctrl + = com o foco no palco dão zoom no desenho, com a frase", async () => {
    await noPalcoTecla(page, editor, "Control+Minus");
    await expect(frase).toHaveText("Zoom 100 %.");
    expect(await zoomMostrado(editor)).toBe("100 %");
    await page.keyboard.press("Control+Equal");
    await expect(frase).toHaveText("Zoom 150 %.");
    expect(await escala(editor)).toBeCloseTo(1.5, 2);
  });

  await test.step("Ctrl + roda com o mouse parado: 200 % e o mesmo ponto da prancheta fica sob o ponteiro", async () => {
    // O meio da Forma, levada para a vista pelas Camadas (a 150 % a area rola para os dois lados).
    await botaoDaCamada(editor, "forma").click();
    const ponteiro = centroDe(await caixaParada(noPalco(editor, "forma")));
    const quadro = await caixaParada(area);
    const naPrancheta = await daPrancheta(editor, ponteiro);

    expect(ponteiro.x > quadro.x && ponteiro.x < quadro.x + quadro.width && ponteiro.y > quadro.y && ponteiro.y < Math.min(quadro.y + quadro.height, TELA.height), "o ponteiro fica sobre a area de desenho").toBe(true);

    await page.mouse.move(ponteiro.x, ponteiro.y);
    await page.keyboard.down("Control");

    try {
      await page.mouse.wheel(0, -200);
    } finally {
      await page.keyboard.up("Control");
    }

    await expect.poll(() => zoomMostrado(editor)).toBe("200 %");
    expect(await escala(editor)).toBeCloseTo(2, 2);
    const depois = await pontoNaPrancheta(editor, naPrancheta.x, naPrancheta.y);
    expect(Math.abs(depois.x - ponteiro.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(depois.y - ponteiro.y)).toBeLessThanOrEqual(2);
  });

  await test.step("a 200 %, Ctrl + = diz que já está no maior; rolar até o começo mostra a borda esquerda", async () => {
    await noPalcoTecla(page, editor, "Control+Equal");
    await expect(frase).toHaveText("O zoom já está no maior.");
    await expect(mais).toHaveAttribute("aria-disabled", "true");
    expect(await zoomMostrado(editor)).toBe("200 %");

    await area.evaluate((element) => element.scrollTo({ left: 0, top: element.scrollTop }));
    await expect.poll(async () => (await rolagemDaArea(editor)).x).toBe(0);
    expect((await rolagemDaArea(editor)).maxX, "a 200 % a area rola na horizontal").toBeGreaterThan(0);
    const quadro = await caixaParada(area);
    const palco = await caixaParada(editor.locator("[data-free-stage]"));
    const borda = await caixaParada(prancheta(editor));
    // A moldura cresce com o palco: rolada ate o comeco, o palco comeca logo depois do respiro de 24 px da area (nada
    // fica escondido a esquerda, onde a rolagem nao alcanca), e a borda da prancheta aparece dentro dele.
    expect(Math.abs(palco.x - (quadro.x + 24))).toBeLessThanOrEqual(1);
    expect(borda.x).toBeGreaterThan(palco.x);
    expect(borda.x + borda.width).toBeGreaterThan(quadro.x);
  });

  await test.step("a 200 %, segurar a Forma na borda de baixo rola a área sozinha; soltar grava um Y maior", async () => {
    await botaoDaCamada(editor, "forma").click();
    const antes = await rolagemDaArea(editor);
    const quadro = await caixaParada(area);
    const de = centroDe(await caixaParada(noPalco(editor, "forma")));
    const naBorda = { x: de.x, y: Math.min(quadro.y + quadro.height, TELA.height) - 8 };

    await arrastar(page, de, naBorda, {
      antesDeSoltar: async () => {
        await expect.poll(async () => (await rolagemDaArea(editor)).y).toBeGreaterThan(antes.y + 40);
        // Fora da faixa da borda a rolagem para; a Forma para junto antes de soltar.
        await page.mouse.move(naBorda.x, naBorda.y - 120, { steps: 4 });
        await caixaParada(noPalco(editor, "forma"));
      }
    });

    await expect.poll(() => numeroDe(campoY)).toBeGreaterThan(FORMA.y + 40);
    await expect(campoX).toHaveValue(String(FORMA.x + 20));
  });

  await test.step("o menu volta a 150 % (o foco volta ao botão do menu) e ao Ajustar à tela, com a escala na frase", async () => {
    // Pelo teclado: o menu abre no botao, desce ate 150 % e fecha com o foco de volta no botao.
    await menuDoZoom(editor).focus();
    await page.keyboard.press("Enter");
    const passo150 = page.getByRole("menuitemradio", { exact: true, name: "150 %" });
    await expect(passo150).toBeVisible();

    for (let vez = 0; vez < 8 && !(await passo150.evaluate((element) => element === document.activeElement)); vez += 1) {
      await page.keyboard.press("ArrowDown");
    }

    await expect(passo150).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(frase).toHaveText("Zoom 150 %.");
    await expect(page.getByRole("menuitemradio")).toHaveCount(0);
    await expect(menuDoZoom(editor)).toBeFocused();
    expect(await zoomMostrado(editor)).toBe("150 %");

    // Pelo mouse: Ajustar à tela, com a escala nova na frase.
    await menuDoZoom(editor).click();
    await page.getByRole("menuitemradio", { exact: true, name: "Ajustar à tela" }).click();
    await expect(frase).toHaveText(`Zoom: ajustar à tela (${ajustar} %).`);
    await expect(page.getByRole("menuitemradio")).toHaveCount(0);
    expect(await zoomMostrado(editor)).toBe(`${ajustar} %`);
    await expect(menuDoZoom(editor)).toHaveAccessibleName(`Zoom: Ajustar à tela (${ajustar} %)`);
  });

  await test.step("Salvar rascunho mantém o zoom; o gravado só muda o lugar da Forma", async () => {
    const y = await numeroDe(campoY);

    await editor.getByRole("button", { name: "Salvar rascunho" }).click();
    await expect(frase).toHaveText("Rascunho salvo.");
    expect(await zoomMostrado(editor)).toBe(`${ajustar} %`);

    const gravado = await lerDesignDoAviso(avisoId);
    const semeado = designDoRascunhoLivre(CHILDREN, EXTRA).design;

    expect(gravado?.children.find((node) => node.id === "forma")?.place).toEqual({ ...FORMA, x: FORMA.x + 20, y });
    // O zoom fica fora do design: a prancheta e os outros elementos sao os semeados, e nenhuma chave fala de zoom.
    expect(gravado?.artboard).toEqual(semeado.artboard);
    expect(gravado?.children.filter((node) => node.id !== "forma")).toEqual(semeado.children.filter((node) => node.id !== "forma"));
    expect(JSON.stringify(gravado)).not.toMatch(/zoom/i);
  });
});
