import type { Locator, Page } from "@playwright/test";
import type { FreeNode } from "../../src/server/communications/popup-free-model";
import { expect, test, zerarComunicacao } from "./fixtures";
import {
  SESSAO_DO_PRODUTOR,
  TELA_DO_EDITOR,
  abrirEditorLivre,
  arrastar,
  botaoDaCamada,
  caixaParada,
  centroDe,
  designDoRascunhoLivre,
  falado,
  gravarRascunhoLivre,
  lerDesignDoAviso,
  linhasDasCamadas,
  type Ponto
} from "./popup-livre-editor-fixtures";

// Livre: arrastar nas Camadas (docs/27 §13.9, L4a; docs/18 §3.1). Num rascunho com [Título, Texto, Caixa em coluna
// [Selo, Botão principal], Links] (o Botão principal semeado com o botao do aviso, para o Revisar nao pedir nada), um
// clique que treme 6 px dentro da linha do Texto seleciona o Texto, como o clique parado. O produtor arrasta o Texto
// para o meio da linha da Caixa (entra no fim dela, um passo so no Ctrl + Z), o Selo para o quarto de cima do Título
// (sai da caixa e fica primeiro), a Caixa para a linha do Botão de dentro dela (a recusa aparece, nada muda e nao ha
// passo vazio), aperta Esc no meio de um arrastar (nada muda e a selecao fica), solta abaixo da ultima linha (o fim
// do pop-up) e arrasta a propria linha 6 px (nada aparece e a linha fica selecionada). Com uma linha em Renomear,
// arrastar outra linha ainda move (a foto do design e tirada depois do limiar). Com "Ver como: Celular", a etiqueta
// diz que a ordem muda tambem no computador. Pelo teclado, Shift + F10 › Tirar da caixa e › Colocar dentro da caixa
// deixam o foco na linha movida. Salvar grava a ordem nova. Funciona no WebKit: o mouse sempre dentro da janela, a
// prancheta e as linhas paradas antes de medir, o indicador antes de soltar, a frase falada antes do passo seguinte e
// o foco conferido com toBeFocused (no WebKit o clique nao da foco a botao).

const TITULO = "Pop-up E2E: o produtor arrasta nas Camadas do Livre";
const CHILDREN: FreeNode[] = [
  { id: "titulo", lines: [[{ text: "Aula nova no ar" }]], type: "heading" },
  { id: "texto", lines: [[{ text: "Veja o que mudou" }]], type: "text" },
  {
    children: [
      { id: "selo", label: "Novidade", type: "badge" },
      // O Botão principal: o rascunho grava o botao do aviso junto (gravarRascunhoLivre).
      { action: { kind: "cta" }, id: "botao", type: "button" }
    ],
    id: "caixa",
    layout: { dir: "column" },
    type: "box"
  },
  { id: "links", type: "links" }
];

test.describe.configure({ mode: "serial" });
test.use({ storageState: SESSAO_DO_PRODUTOR, viewport: TELA_DO_EDITOR });

let avisoId = "";

test.beforeAll(async () => {
  await zerarComunicacao();
  avisoId = await gravarRascunhoLivre(TITULO, CHILDREN);
});

test.afterAll(zerarComunicacao);

/** A ordem das Camadas: "id" na prancheta e "caixa/id" dentro de uma caixa. */
async function ordem(editor: Locator) {
  return (await linhasDasCamadas(editor)).map((linha) => (linha.pai ? `${linha.pai}/${linha.id}` : linha.id));
}

/** A div da linha das Camadas (o que o arrastar mede: sem os filhos de uma caixa). */
function linha(editor: Locator, id: string) {
  return editor.locator(`[data-free-layer-line="${id}"]`);
}

/** Um ponto da linha, na altura pedida (0 = topo, 1 = fundo), no meio da largura. */
async function naLinha(editor: Locator, id: string, altura: number): Promise<Ponto> {
  const caixa = await caixaParada(linha(editor, id));

  return { x: caixa.x + caixa.width / 2, y: caixa.y + caixa.height * altura };
}

/** O meio do botao de selecionar da linha (de onde o arrastar sai). */
async function pegar(editor: Locator, id: string): Promise<Ponto> {
  return centroDe(await caixaParada(botaoDaCamada(editor, id)));
}

async function selecionado(editor: Locator) {
  return editor.locator("[data-free-selection]").getAttribute("data-free-selection");
}

/** Ctrl + Z (ou Ctrl + Shift + Z) com o foco no palco: depois de mover, a linha pode ter mudado de lugar na lista. */
async function noPalco(page: Page, editor: Locator, tecla: "Control+Shift+z" | "Control+z") {
  await editor.locator("[data-free-stage]").focus();
  await page.keyboard.press(tecla);
}

/** Com o ⋯ aberto pelo teclado, desce ate o item e confere que o foco esta nele. */
async function irAoItem(page: Page, nome: string) {
  const item = page.getByRole("menuitem", { exact: true, name: nome });

  await expect(item).toBeVisible();

  for (let vez = 0; vez < 10 && !(await item.evaluate((element) => element === document.activeElement)); vez += 1) {
    await page.keyboard.press("ArrowDown");
  }

  await expect(item).toBeFocused();
}

test("arrasta nas Camadas: entra e sai de caixa, recusa, Esc, fim do pop-up, Celular e o ⋯ pelo teclado", async ({ page }) => {
  test.setTimeout(180_000);
  const editor = await abrirEditorLivre(page, avisoId);
  const frase = falado(editor);
  const indicador = editor.locator("[data-free-layer-drop], [data-free-layer-drop-inside], [data-free-layer-drop-hint], [data-free-layer-drop-both]");

  await expect(editor.getByRole("tab", { exact: true, name: "Camadas" })).toHaveAttribute("aria-selected", "true");
  expect(await ordem(editor)).toEqual(["titulo", "texto", "caixa", "caixa/selo", "caixa/botao", "links"]);

  await test.step("um clique que treme 6 px dentro da linha do Texto seleciona o Texto, como o clique parado", async () => {
    await expect(editor.locator("[data-free-selection]")).toHaveCount(0);
    const antes = await frase.textContent();
    const de = await pegar(editor, "texto");

    await page.mouse.move(de.x, de.y);
    await page.mouse.down();
    await page.mouse.move(de.x + 2, de.y + 6, { steps: 4 });
    // Passou dos 4 px (o arrastar comecou), mas a propria linha e o mesmo lugar: nada aparece.
    await expect(editor.locator('[data-free-layer-dragging][data-free-layer-line="texto"]')).toHaveCount(1);
    await expect(indicador).toHaveCount(0);
    await page.mouse.up();
    await expect(editor.locator("[data-free-layer-dragging]")).toHaveCount(0);
    await expect(botaoDaCamada(editor, "texto")).toHaveAttribute("aria-current", "true");
    expect(await selecionado(editor)).toBe("texto");
    expect(await ordem(editor)).toEqual(["titulo", "texto", "caixa", "caixa/selo", "caixa/botao", "links"]);
    expect(await frase.textContent()).toBe(antes);
  });

  await test.step("o Texto no meio da linha da Caixa entra no fim dela, selecionado e com o foco na linha", async () => {
    await arrastar(page, await pegar(editor, "texto"), await naLinha(editor, "caixa", 0.5), {
      antesDeSoltar: () => expect(editor.locator("[data-free-layer-drop-inside]")).toBeVisible()
    });
    await expect.poll(() => ordem(editor)).toEqual(["titulo", "caixa", "caixa/selo", "caixa/botao", "caixa/texto", "links"]);
    await expect(frase).toContainText("Movido. Posição 3 de 3, dentro de Caixa em coluna.");
    await expect(botaoDaCamada(editor, "texto")).toBeFocused();
    expect(await selecionado(editor)).toBe("texto");
    await expect(indicador).toHaveCount(0);
  });

  await test.step("Ctrl + Z volta e Ctrl + Shift + Z refaz: o arrastar e um passo so", async () => {
    await noPalco(page, editor, "Control+z");
    await expect.poll(() => ordem(editor)).toEqual(["titulo", "texto", "caixa", "caixa/selo", "caixa/botao", "links"]);
    await noPalco(page, editor, "Control+Shift+z");
    await expect.poll(() => ordem(editor)).toEqual(["titulo", "caixa", "caixa/selo", "caixa/botao", "caixa/texto", "links"]);
  });

  await test.step("o Selo no quarto de cima do Título sai da caixa e fica primeiro no pop-up", async () => {
    await arrastar(page, await pegar(editor, "selo"), await naLinha(editor, "titulo", 0.125), {
      antesDeSoltar: () => expect(editor.locator("[data-free-layer-drop]")).toBeVisible()
    });
    await expect.poll(() => ordem(editor)).toEqual(["selo", "titulo", "caixa", "caixa/botao", "caixa/texto", "links"]);
    await expect(frase).toContainText("Movido. Posição 1 de 4, no pop-up.");
    await expect(botaoDaCamada(editor, "selo")).toBeFocused();
  });

  await test.step("a Caixa na linha do Botão de dentro dela: a recusa aparece, nada muda e nao ha passo vazio", async () => {
    await arrastar(page, await pegar(editor, "caixa"), await naLinha(editor, "botao", 0.5), {
      antesDeSoltar: () => expect(editor.locator("[data-free-layer-drop-hint]")).toHaveText("Uma caixa não entra dentro dela mesma.")
    });
    await expect(frase).toContainText("Uma caixa não entra dentro dela mesma.");
    expect(await ordem(editor)).toEqual(["selo", "titulo", "caixa", "caixa/botao", "caixa/texto", "links"]);
    await expect(indicador).toHaveCount(0);
    // O proximo Ctrl + Z desfaz o passo do Selo: a recusa nao gravou nada.
    await noPalco(page, editor, "Control+z");
    await expect.poll(() => ordem(editor)).toEqual(["titulo", "caixa", "caixa/selo", "caixa/botao", "caixa/texto", "links"]);
  });

  await test.step("Esc no meio de um arrastar: nada muda e a selecao continua (o Esc nao sobe para a caixa de fora)", async () => {
    expect(await selecionado(editor)).toBe("selo");
    const de = await pegar(editor, "texto");
    const para = await naLinha(editor, "botao", 0.125);

    await page.mouse.move(de.x, de.y);
    await page.mouse.down();
    await page.mouse.move(para.x, para.y, { steps: 10 });
    await expect(editor.locator("[data-free-layer-drop]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(indicador).toHaveCount(0);
    await page.mouse.up();
    await expect(editor.locator("[data-free-layer-dragging]")).toHaveCount(0);
    expect(await ordem(editor)).toEqual(["titulo", "caixa", "caixa/selo", "caixa/botao", "caixa/texto", "links"]);
    expect(await selecionado(editor)).toBe("selo");
  });

  await test.step("soltar abaixo da ultima linha leva ao fim do pop-up", async () => {
    await arrastar(page, await pegar(editor, "titulo"), await naLinha(editor, "links", 2), {
      antesDeSoltar: () => expect(editor.locator("[data-free-layer-drop]")).toBeVisible()
    });
    await expect.poll(() => ordem(editor)).toEqual(["caixa", "caixa/selo", "caixa/botao", "caixa/texto", "links", "titulo"]);
    await expect(frase).toContainText("Movido. Posição 3 de 3, no pop-up.");
  });

  await test.step("a propria linha da Caixa 6 px para baixo e o mesmo lugar: nada aparece, nada muda e a Caixa fica selecionada", async () => {
    const antes = await frase.textContent();
    const de = await pegar(editor, "caixa");

    await page.mouse.move(de.x, de.y);
    await page.mouse.down();
    await page.mouse.move(de.x, de.y + 6, { steps: 3 });
    // O arrastar comecou (a linha esmaece), mas a propria linha nao mostra indicador nem recusa.
    await expect(editor.locator('[data-free-layer-dragging][data-free-layer-line="caixa"]')).toHaveCount(1);
    await expect(indicador).toHaveCount(0);
    await page.mouse.up();
    await expect(editor.locator("[data-free-layer-dragging]")).toHaveCount(0);
    expect(await ordem(editor)).toEqual(["caixa", "caixa/selo", "caixa/botao", "caixa/texto", "links", "titulo"]);
    expect(await frase.textContent()).toBe(antes);
    // Soltar no mesmo lugar e o clique que tremeu: a Caixa fica selecionada (antes, o Título movido no passo de cima).
    await expect(botaoDaCamada(editor, "caixa")).toHaveAttribute("aria-current", "true");
    expect(await selecionado(editor)).toBe("caixa");
  });

  await test.step("com uma linha em Renomear, arrastar outra linha ainda move (e o nome fica)", async () => {
    await botaoDaCamada(editor, "links").focus();
    await page.keyboard.press("F2");
    const campo = editor.getByRole("textbox", { exact: true, name: "Nome na lista de camadas" });
    await expect(campo).toBeFocused();
    await page.keyboard.type("Rodapé");
    await arrastar(page, await pegar(editor, "titulo"), await naLinha(editor, "caixa", 0.125), {
      antesDeSoltar: () => expect(editor.locator("[data-free-layer-drop]")).toBeVisible()
    });
    await expect.poll(() => ordem(editor)).toEqual(["titulo", "caixa", "caixa/selo", "caixa/botao", "caixa/texto", "links"]);
    await expect(botaoDaCamada(editor, "links")).toContainText("Rodapé");
    await expect(campo).toHaveCount(0);
  });

  await test.step("Ver como Celular: a etiqueta diz que a ordem muda tambem no computador, e a frase tambem", async () => {
    const celular = editor.getByRole("button", { exact: true, name: "Celular" });
    const computador = editor.getByRole("button", { exact: true, name: "Computador" });

    await celular.click();
    await expect(celular).toHaveAttribute("aria-pressed", "true");
    await arrastar(page, await pegar(editor, "titulo"), await naLinha(editor, "links", 2), {
      antesDeSoltar: () => expect(editor.locator("[data-free-layer-drop-both]")).toHaveText("Muda também no computador")
    });
    await expect.poll(() => ordem(editor)).toEqual(["caixa", "caixa/selo", "caixa/botao", "caixa/texto", "links", "titulo"]);
    await expect(frase).toContainText("Movido. Posição 3 de 3, no pop-up. A ordem muda também no computador.");
    await computador.click();
    await expect(computador).toHaveAttribute("aria-pressed", "true");
  });

  await test.step("pelo teclado: Shift + F10 › Tirar da caixa e › Colocar dentro da caixa deixam o foco na linha do Texto", async () => {
    const texto = botaoDaCamada(editor, "texto");

    await texto.focus();
    await expect(texto).toBeFocused();
    await page.keyboard.press("Shift+F10");
    await irAoItem(page, "Tirar da caixa");
    await page.keyboard.press("Enter");
    await expect.poll(() => ordem(editor)).toEqual(["caixa", "caixa/selo", "caixa/botao", "texto", "links", "titulo"]);
    await expect(frase).toContainText("Tirado da caixa.");
    await expect(page.getByRole("menuitem")).toHaveCount(0);
    await expect(botaoDaCamada(editor, "texto")).toBeFocused();

    await page.keyboard.press("Shift+F10");
    await irAoItem(page, "Colocar dentro da caixa…");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("menuitem", { exact: true, name: "Caixa em coluna" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => ordem(editor)).toEqual(["caixa", "caixa/selo", "caixa/botao", "caixa/texto", "links", "titulo"]);
    await expect(frase).toContainText("Colocado dentro da caixa.");
    await expect(page.getByRole("menuitem")).toHaveCount(0);
    await expect(botaoDaCamada(editor, "texto")).toBeFocused();
  });

  await test.step("Salvar rascunho grava a ordem nova (e o nome dado nas Camadas)", async () => {
    await editor.getByRole("button", { name: "Salvar rascunho" }).click();
    await expect(editor.getByText("Rascunho salvo.", { exact: true })).toHaveCount(1);
    const gravado = await lerDesignDoAviso(avisoId);
    const ids = (nodes: readonly FreeNode[] = []): string[] => nodes.flatMap((node) => (node.type === "box" ? [node.id, ...ids(node.children).map((id) => `${node.id}/${id}`)] : [node.id]));

    expect(ids(gravado?.children)).toEqual(["caixa", "caixa/selo", "caixa/botao", "caixa/texto", "links", "titulo"]);
    expect(gravado?.children.find((node) => node.id === "links")?.name).toBe("Rodapé");
    // A ordem e uma so: arrastar com o Celular nao grava nada proprio do celular.
    expect(gravado?.devices).toEqual(designDoRascunhoLivre(CHILDREN).design.devices);
  });
});
