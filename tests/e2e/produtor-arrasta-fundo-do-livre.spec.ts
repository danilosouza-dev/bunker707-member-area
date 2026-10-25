import type { Locator } from "@playwright/test";
import type { FreeFillPaint, FreeNode } from "../../src/server/communications/popup-free-model";
import { expect, test, zerarComunicacao } from "./fixtures";
import {
  SESSAO_DO_PRODUTOR,
  TELA_DO_EDITOR,
  abrirEditorLivre,
  arrastar,
  caixaParada,
  camada,
  centroDe,
  designDoRascunhoLivre,
  focoDentro,
  gravarRascunhoLivre,
  lerDesignDoAviso,
  linhasDasCamadas,
  noPalco,
  prancheta
} from "./popup-livre-editor-fixtures";

// Livre: arrastar as camadas de fundo (docs/27 §13.9, L4a; docs/18 §3.1). Num rascunho com um Selo de três camadas
// (vermelho, verde e azul, nessa ordem) e a prancheta com duas, o produtor muda a cor da Camada 1 do Selo e logo
// arrasta a ficha da Camada 3 para cima da 1 na faixa "Ordem" do Estilo: o azul fica por cima, e o Ctrl + Z volta só
// a ordem (a cor nova fica; outro Ctrl + Z volta a cor). Pelo teclado, Alt + ↑ na ficha leva a camada para cima com o
// foco junto e a frase falada, sem mexer no Selo nas Camadas; Subir num cartão leva o foco ao Subir do lugar novo; o
// Esc no meio do arrastar não muda nada, não chega ao editor e deixa o foco no Estilo. Na prancheta (painel Pop-up),
// "+ Camada de fundo" cria a terceira camada e o foco vai para a ficha dela (o botão desliga); arrastar a ficha 2 para
// cima muda o fundo num passo só; soltar longe da faixa não muda nada nem deixa passo vazio. Com "Ver como: Celular",
// o palco desenha a mesma ordem, e "Salvar rascunho" grava a ordem do Selo e o fundo da prancheta, sem nada próprio do
// celular. O botão semeado é o Botão principal (o rascunho grava o botão do aviso, e o Revisar não pede nada).
// Funciona no WebKit: só mouse e teclado, o mouse sempre dentro da janela, a prancheta e a caixa parada antes de
// medir, o indicador esperado antes de soltar e o foco conferido com toBeFocused (no WebKit o clique não dá foco a
// botão).

const TITULO = "Pop-up E2E: o produtor arrasta as camadas de fundo do Livre";
const VERMELHO = "#ff0000";
const VERDE = "#00ff00";
const AZUL = "#0000ff";
const LARANJA = "#ffaa00";
const FUNDO_DE_CIMA = "#112233";
const FUNDO_DE_BAIXO = "#445566";

const solida = (color: string): FreeFillPaint => ({ color, kind: "solid" });
const PRANCHETA = { fill: [solida(FUNDO_DE_CIMA), solida(FUNDO_DE_BAIXO)] };

const CHILDREN: FreeNode[] = [
  { id: "titulo", lines: [[{ text: "Aula nova no ar" }]], textStyle: { size: 40 }, type: "heading" },
  { box: { fill: [solida(VERMELHO), solida(VERDE), solida(AZUL)], padding: [6, 12], radius: 999 }, id: "selo", label: "Novidade", type: "badge" },
  // O Botão principal (action cta): o rascunho grava o botão do aviso.
  {
    action: { kind: "cta" },
    box: { fill: [solida("#ffffff")], padding: [13, 24], radius: 999 },
    id: "botao",
    textStyle: { paint: { color: "#16181c", kind: "solid" }, size: 16 },
    type: "button"
  },
  { id: "links", type: "links" }
];

test.describe.configure({ mode: "serial" });
test.use({ storageState: SESSAO_DO_PRODUTOR, viewport: TELA_DO_EDITOR });

let avisoId = "";

test.beforeAll(async () => {
  await zerarComunicacao();
  avisoId = await gravarRascunhoLivre(TITULO, CHILDREN, { artboard: PRANCHETA });
});

test.afterAll(zerarComunicacao);

/** O fundo desenhado (as camadas em background-image, a de cima primeiro). */
async function fundoDe(locator: Locator) {
  return locator.evaluate((element) => getComputedStyle(element).backgroundImage);
}

/** A camada de cima do fundo desenhado é esta cor sólida (rgb). */
function comecaPor(rgb: string) {
  return new RegExp(`^linear-gradient\\(rgb\\(${rgb.replaceAll(" ", "\\s?")}\\)`);
}

test("arrasta as camadas de fundo no Estilo e na prancheta: um passo, o foco junto e a mesma ordem no celular", async ({ page }) => {
  test.setTimeout(180_000);
  const editor = await abrirEditorLivre(page, avisoId);
  const status = editor.locator("[data-free-fill-status]");
  const ficha = (campo: string, indice: number) => editor.locator(`#${campo}-${indice}-ordem`);
  const faixa = editor.locator('ol[aria-label="Ordem das camadas de fundo"]');
  const corDoSelo = (indice: number) => editor.locator(`#livre-selo-fundo-${indice}-cor`);
  const corDaPrancheta = (indice: number) => editor.locator(`#livre-popup-fundo-${indice}-cor`);

  /** Arrasta a ficha `de` até um pouco abaixo do topo da ficha `para` (entra antes dela), com a linha antes de soltar. */
  async function arrastarFicha(campo: string, de: number, para: number) {
    await faixa.scrollIntoViewIfNeeded();
    const origem = centroDe(await caixaParada(ficha(campo, de)));
    const alvo = await caixaParada(ficha(campo, para));

    await arrastar(page, origem, { x: alvo.x + alvo.width / 2, y: alvo.y + 3 }, {
      antesDeSoltar: async () => {
        await expect(editor.locator("[data-free-fill-dragging]")).toHaveCount(1);
        await expect(editor.locator('[data-free-fill-drop="before"]')).toBeVisible();
      }
    });
    await expect(editor.locator("[data-free-fill-dragging]")).toHaveCount(0);
  }

  async function desfazer() {
    await editor.locator("[data-free-stage]").focus();
    await page.keyboard.press("Control+z");
  }

  await test.step("Estilo: muda a cor da Camada 1 e logo arrasta a ficha 3 para cima: o azul fica por cima", async () => {
    await camada(editor, "Selo").click();
    await editor.getByRole("tab", { exact: true, name: "Estilo" }).click();
    await expect(corDoSelo(0)).toHaveValue(VERMELHO);
    await expect(faixa.locator("[data-free-fill-grip]")).toHaveCount(3);
    await expect(ficha("livre-selo-fundo", 0)).toHaveAccessibleName("Mover Camada 1: Cor. Arraste ou use Alt e as setas.");

    await corDoSelo(0).fill(LARANJA);
    await expect.poll(() => fundoDe(noPalco(editor, "selo"))).toMatch(comecaPor("255, 170, 0"));
    await arrastarFicha("livre-selo-fundo", 2, 0);

    await expect(corDoSelo(0)).toHaveValue(AZUL);
    await expect(corDoSelo(1)).toHaveValue(LARANJA);
    await expect.poll(() => fundoDe(noPalco(editor, "selo"))).toMatch(comecaPor("0, 0, 255"));
    await expect(ficha("livre-selo-fundo", 0)).toBeFocused();
    await expect(status).toHaveText("Camada de fundo movida. Agora é a Camada 1: Cor.");
  });

  await test.step("Ctrl + Z volta só a ordem (a cor nova fica); outro Ctrl + Z volta a cor", async () => {
    await desfazer();
    await expect(corDoSelo(0)).toHaveValue(LARANJA);
    await expect(corDoSelo(2)).toHaveValue(AZUL);
    await page.keyboard.press("Control+z");
    await expect(corDoSelo(0)).toHaveValue(VERMELHO);
    await expect.poll(() => fundoDe(noPalco(editor, "selo"))).toMatch(comecaPor("255, 0, 0"));
  });

  await test.step("teclado: Alt + ↑ duas vezes na ficha 3 leva o azul para cima, com o foco junto, sem mexer nas Camadas", async () => {
    const linhas = await linhasDasCamadas(editor);

    await ficha("livre-selo-fundo", 2).focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect(ficha("livre-selo-fundo", 1)).toBeFocused();
    await expect(status).toHaveText("Camada de fundo movida. Agora é a Camada 2: Cor.");
    await page.keyboard.press("Alt+ArrowUp");
    await expect(ficha("livre-selo-fundo", 0)).toBeFocused();
    await expect(status).toHaveText("Camada de fundo movida. Agora é a Camada 1: Cor.");
    await expect(corDoSelo(0)).toHaveValue(AZUL);
    await expect(corDoSelo(1)).toHaveValue(VERMELHO);
    expect(await linhasDasCamadas(editor), "o Selo continua no mesmo lugar nas Camadas").toEqual(linhas);
  });

  await test.step("Subir no cartão 3: o foco vai para o Subir do lugar novo", async () => {
    await editor.locator("#livre-selo-fundo-2-subir").click();
    await expect(editor.locator("#livre-selo-fundo-1-subir")).toBeFocused();
    await expect(corDoSelo(1)).toHaveValue(VERDE);
    await expect(corDoSelo(2)).toHaveValue(VERMELHO);
  });

  await test.step("Esc no meio do arrastar: nada muda, o Selo continua selecionado e o foco fica no Estilo", async () => {
    await faixa.scrollIntoViewIfNeeded();
    const origem = centroDe(await caixaParada(ficha("livre-selo-fundo", 0)));
    const alvo = await caixaParada(ficha("livre-selo-fundo", 2));
    // O foco antes do gesto vem pelo teclado (no WebKit o clique não dá foco a botão).
    await ficha("livre-selo-fundo", 0).focus();
    await expect(ficha("livre-selo-fundo", 0)).toBeFocused();

    await page.mouse.move(origem.x, origem.y);
    await page.mouse.down();
    await page.mouse.move(alvo.x + alvo.width / 2, alvo.y + alvo.height - 3, { steps: 10 });
    await expect(editor.locator('[data-free-fill-drop="after"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(editor.locator("[data-free-fill-drop], [data-free-fill-dragging]")).toHaveCount(0);
    await page.mouse.up();
    await expect(corDoSelo(0)).toHaveValue(AZUL);
    await expect(corDoSelo(2)).toHaveValue(VERMELHO);
    await expect(editor.locator('[data-free-inspector="selo"]')).toBeVisible();
    // O Esc não mexe no foco: ele fica no painel Estilo (na ficha, no Chromium; no WebKit, no primeiro de fora da
    // ficha que recebe foco pelo clique, dentro do painel), nunca no body.
    expect(await focoDentro(editor.getByRole("tabpanel", { exact: true, name: "Estilo" }))).toBe(true);
  });

  await test.step("prancheta: + Camada cria a terceira (o foco vai para a ficha dela) e arrastar a ficha 2 para cima é um passo", async () => {
    await editor.locator("[data-free-stage]").focus();
    await page.keyboard.press("Escape");
    await expect(editor.getByText("Nada selecionado: aqui fica o pop-up inteiro.", { exact: true })).toBeVisible();

    const acrescentar = editor.locator("#livre-popup-fundo-acrescentar");
    await acrescentar.scrollIntoViewIfNeeded();
    await acrescentar.click();
    // A terceira camada desliga o "+ Camada": o foco vai para a ficha da camada nova (em cima), nunca para o vazio.
    await expect(ficha("livre-popup-fundo", 0)).toBeFocused();
    await expect(acrescentar).toBeDisabled();
    await expect(corDaPrancheta(0)).toHaveValue(FUNDO_DE_BAIXO);
    await expect(corDaPrancheta(1)).toHaveValue(FUNDO_DE_CIMA);

    await arrastarFicha("livre-popup-fundo", 1, 0);
    await expect(corDaPrancheta(0)).toHaveValue(FUNDO_DE_CIMA);
    await expect(ficha("livre-popup-fundo", 0)).toBeFocused();
    await expect.poll(() => fundoDe(prancheta(editor))).toMatch(comecaPor("17, 34, 51"));

    await desfazer();
    await expect(corDaPrancheta(0)).toHaveValue(FUNDO_DE_BAIXO);
    await expect(faixa.locator("[data-free-fill-grip]")).toHaveCount(3);
    await expect.poll(() => fundoDe(prancheta(editor))).toMatch(comecaPor("68, 85, 102"));
  });

  await test.step("soltar longe da faixa não muda nada nem deixa passo vazio", async () => {
    await faixa.scrollIntoViewIfNeeded();
    const origem = centroDe(await caixaParada(ficha("livre-popup-fundo", 2)));
    const lista = await caixaParada(faixa);

    // Longe da faixa (bem mais que 32 px à esquerda, ainda dentro da janela): sem linha, e soltar não muda nada.
    await arrastar(page, origem, { x: lista.x - 120, y: origem.y - 40 }, {
      antesDeSoltar: async () => {
        await expect(editor.locator("[data-free-fill-dragging]")).toHaveCount(1);
        await expect(editor.locator("[data-free-fill-drop]")).toHaveCount(0);
      }
    });
    await expect(editor.locator("[data-free-fill-dragging]")).toHaveCount(0);
    await expect(corDaPrancheta(0)).toHaveValue(FUNDO_DE_BAIXO);
    await expect(corDaPrancheta(2)).toHaveValue(FUNDO_DE_BAIXO);

    // Nenhum passo vazio: o Ctrl + Z seguinte desfaz o "+ Camada".
    await desfazer();
    await expect(faixa.locator("[data-free-fill-grip]")).toHaveCount(2);
    await expect(corDaPrancheta(0)).toHaveValue(FUNDO_DE_CIMA);
  });

  await test.step("Ver como: Celular desenha a mesma ordem no Selo e na prancheta", async () => {
    await editor.getByRole("button", { exact: true, name: "Celular" }).click();
    await expect(prancheta(editor)).toHaveJSProperty("offsetWidth", 343);
    await expect.poll(() => fundoDe(noPalco(editor, "selo"))).toMatch(comecaPor("0, 0, 255"));
    await expect.poll(() => fundoDe(prancheta(editor))).toMatch(comecaPor("17, 34, 51"));
  });

  await test.step("Salvar rascunho grava a ordem do Selo e o fundo da prancheta, sem nada próprio do celular", async () => {
    await editor.getByRole("button", { name: "Salvar rascunho" }).click();
    await expect(editor.getByText("Rascunho salvo.", { exact: true })).toHaveCount(1);

    const gravado = await lerDesignDoAviso(avisoId);
    const selo = gravado?.children.find((node) => node.id === "selo");

    // A ordem depois do Subir (o laranja foi desfeito): azul, verde e vermelho.
    expect(selo?.type === "badge" ? selo.box?.fill : null).toEqual([solida(AZUL), solida(VERDE), solida(VERMELHO)]);
    // O "+ Camada" da prancheta foi desfeito: as duas semeadas, na mesma ordem.
    expect(gravado?.artboard?.fill).toEqual(PRANCHETA.fill);
    // A ordem das camadas de fundo é uma só: "Ver como: Celular" não grava fundo no celular (devices como foi semeado).
    expect(gravado?.devices).toEqual(designDoRascunhoLivre(CHILDREN, { artboard: PRANCHETA }).design.devices);
  });
});
