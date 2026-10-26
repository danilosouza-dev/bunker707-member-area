import type { Locator, Page } from "@playwright/test";
import type { FreeNode } from "../../src/server/communications/popup-free-model";
import { expect, test, zerarComunicacao } from "./fixtures";
import {
  SESSAO_DO_PRODUTOR,
  TELA_DO_EDITOR,
  abrirEditorLivre,
  botaoDaCamada,
  caixaParada,
  cliqueCom,
  daPrancheta,
  escolhidos,
  falado,
  gravarRascunhoLivre,
  lerDesignDoAviso,
  linhasDasCamadas,
  noPalco,
  pontoNaPrancheta,
  prancheta
} from "./popup-livre-editor-fixtures";

// Livre: alinhar e distribuir varios, o girado e o Alt + clique (docs/27 §13.10, L4b; docs/18 §3.1). Num rascunho com
// [Título, Caixa [Texto], quatro Formas soltas de larguras diferentes, uma Forma travada, duas Formas empilhadas com
// outra travada por cima, um Selo girado 90°, Links], o produtor escolhe as quatro Formas e a travada pelas Camadas
// (clique e Shift + clique). "Espaços iguais na horizontal" deixa os espaços iguais (a travada fica parada e a frase diz
// quantos ficaram), Ctrl + Z e Ctrl + Shift + Z sao um passo, e o gravado tem os espacos com no maximo 1 px de
// diferenca (Salvar rascunho com o editor aberto). Com "Ver como: Celular", "Espaços iguais na vertical" muda so o
// celular. "Alinhar em cima entre si" e "Alinhar ao centro no pop-up" (cada um no meio da prancheta). O Selo girado com
// "Alinhar à esquerda" fica com a borda que se ve em x 0. O Alt + clique no ponto das duas empilhadas pega a de baixo
// (nunca a travada de cima), com a frase "2 de 2", e o segundo volta a de cima. Uma Forma solta levada pelo ⋯ ›
// Colocar dentro da caixa continua desenhada (largura e altura guardadas). Salvar rascunho grava tudo. Funciona no
// WebKit: o mouse dentro da janela, o palco e o alvo parados antes de cada clique com tecla, a caixa parada antes de
// medir, o foco posto pelo teclado antes de cada tecla e o ⋯ pelo teclado (Shift + F10).

const TITULO = "Pop-up E2E: o produtor alinha e distribui no Livre";
const COR = { fill: [{ color: "#38bdf8", kind: "solid" as const }], radius: 6 };
const LARANJA = { fill: [{ color: "#f59e0b", kind: "solid" as const }], radius: 4 };
/** As quatro Formas que alinham e distribuem (larguras diferentes, todas com 40 de altura) e a travada. */
const FORMAS = {
  f1: { h: 40, w: 40, x: 20, y: 170 },
  f2: { h: 40, w: 80, x: 90, y: 300 },
  f3: { h: 40, w: 30, x: 200, y: 200 },
  f4: { h: 40, w: 100, x: 320, y: 380 }
} as const;
const TRAVADA = { h: 40, mode: "free" as const, w: 40, x: 150, y: 380 };
/** A largura de dentro da prancheta de 440 (o modelo "Em branco" tem 1 px de borda de cada lado). */
const DENTRO = 438;
const CHILDREN: FreeNode[] = [
  { id: "titulo", lines: [[{ text: "Aula nova no ar" }]], type: "heading" },
  { children: [{ id: "nota", lines: [[{ text: "Dentro da caixa" }]], type: "text" }], id: "caixa", layout: { dir: "column" }, type: "box" },
  { box: COR, id: "f1", name: "Forma 1", place: { mode: "free", ...FORMAS.f1 }, type: "shape" },
  { box: COR, id: "f2", name: "Forma 2", place: { mode: "free", ...FORMAS.f2 }, type: "shape" },
  { box: COR, id: "f3", name: "Forma 3", place: { mode: "free", ...FORMAS.f3 }, type: "shape" },
  { box: COR, id: "f4", name: "Forma 4", place: { mode: "free", ...FORMAS.f4 }, type: "shape" },
  { box: LARANJA, id: "ft", locked: true, name: "Travada", place: TRAVADA, type: "shape" },
  // As empilhadas: a de cima vem depois; a tampa travada fica por cima das duas.
  { box: COR, id: "sa", name: "Embaixo", place: { h: 60, mode: "free", w: 80, x: 40, y: 450 }, type: "shape" },
  { box: { fill: [{ color: "#a78bfa", kind: "solid" }], radius: 6 }, id: "sb", name: "Em cima", place: { h: 60, mode: "free", w: 80, x: 60, y: 460 }, type: "shape" },
  { box: LARANJA, id: "st", locked: true, name: "Tampa", place: { h: 30, mode: "free", w: 40, x: 70, y: 470 }, type: "shape" },
  { id: "selo", label: "Novidade", place: { mode: "free", rotate: 90, w: 100, x: 260, y: 470 }, type: "badge" },
  { id: "links", type: "links" }
];

test.describe.configure({ mode: "serial" });
test.use({ storageState: SESSAO_DO_PRODUTOR, viewport: TELA_DO_EDITOR });

let avisoId = "";

test.beforeAll(async () => {
  await zerarComunicacao();
  avisoId = await gravarRascunhoLivre(TITULO, CHILDREN, { artboard: { minHeight: 600 } });
});

test.afterAll(zerarComunicacao);

/** O canto de cima a esquerda (a caixa que se ve) do elemento no palco, em px da prancheta. */
async function lugar(editor: Locator, id: string) {
  const caixa = await caixaParada(noPalco(editor, id));
  const ponto = await daPrancheta(editor, { x: caixa.x, y: caixa.y });

  return { x: Math.round(ponto.x), y: Math.round(ponto.y) };
}

/** A largura de dentro da prancheta no palco (px da prancheta: no Computador, 1 px de layout por px). */
async function larguraDeDentro(editor: Locator) {
  return prancheta(editor).evaluate((element) => (element as HTMLElement).clientWidth);
}

/** O lugar das quatro Formas e da travada. */
async function lugares(editor: Locator) {
  return { f1: await lugar(editor, "f1"), f2: await lugar(editor, "f2"), f3: await lugar(editor, "f3"), f4: await lugar(editor, "f4"), ft: await lugar(editor, "ft") };
}

/** Uma tecla com o foco no palco (o foco vem pelo teclado: no WebKit o clique nao da foco). */
async function noPalcoTecla(page: Page, editor: Locator, tecla: string) {
  await editor.locator("[data-free-stage]").focus();
  await expect(editor.locator("[data-free-stage]")).toBeFocused();
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

/** Os espacos entre as Formas vizinhas na horizontal (da esquerda para a direita). */
function espacos(nos: { w: number; x: number }[]) {
  const ordem = [...nos].sort((a, b) => a.x - b.x);

  return ordem.slice(1).map((no, index) => no.x - (ordem[index].x + ordem[index].w));
}

test("alinha e distribui várias Formas, alinha o girado, Alt + clique na pilha e a Forma levada para a caixa", async ({ page }) => {
  test.setTimeout(180_000);

  const editor = await abrirEditorLivre(page, avisoId);
  const frase = falado(editor);
  const varios = editor.locator('[data-free-inspector="many"]');
  const ficou = "1 ficou no lugar (travado, na sequência ou escondido).";

  expect(await lugares(editor)).toEqual({
    f1: { x: 20, y: 170 },
    f2: { x: 90, y: 300 },
    f3: { x: 200, y: 200 },
    f4: { x: 320, y: 380 },
    ft: { x: TRAVADA.x, y: TRAVADA.y }
  });

  await test.step("pelas Camadas, clique na Forma 1 e Shift + clique na travada: cinco escolhidas", async () => {
    await botaoDaCamada(editor, "f1").click();
    await expect.poll(() => escolhidos(editor)).toEqual(["f1"]);
    await botaoDaCamada(editor, "ft").click({ modifiers: ["Shift"] });
    await expect(frase).toHaveText("5 elementos escolhidos.");
    // O intervalo na ordem das Camadas (L64: de cima para baixo, a Travada acima da Forma 4), o clicado no fim.
    await expect.poll(() => escolhidos(editor)).toEqual(["f4", "f3", "f2", "f1", "ft"]);
    await expect(varios.getByRole("heading", { exact: true, name: "5 elementos selecionados" })).toBeVisible();
  });

  await test.step("Espaços iguais na horizontal: espaços iguais, a travada parada; Ctrl + Z e Ctrl + Shift + Z são um passo", async () => {
    await varios.getByRole("button", { exact: true, name: "Espaços iguais na horizontal" }).click();
    await expect(frase).toHaveText(`Espaços iguais na horizontal. ${ficou}`);

    // A primeira e a ultima ficam; (400 - 250) / 3 = 50 px entre cada uma.
    const distribuido = { f1: { x: 20, y: 170 }, f2: { x: 110, y: 300 }, f3: { x: 240, y: 200 }, f4: { x: 320, y: 380 }, ft: { x: TRAVADA.x, y: TRAVADA.y } };
    expect(await lugares(editor)).toEqual(distribuido);

    await noPalcoTecla(page, editor, "Control+z");
    await expect(frase).toHaveText("Desfeito.");
    expect((await lugares(editor)).f2).toEqual({ x: 90, y: 300 });
    expect((await lugares(editor)).f3).toEqual({ x: 200, y: 200 });
    await page.keyboard.press("Control+Shift+z");
    await expect(frase).toHaveText("Refeito.");
    expect(await lugares(editor)).toEqual(distribuido);

    // O gravado: os espacos entre as vizinhas com no maximo 1 px de diferenca (o editor fica aberto).
    await editor.getByRole("button", { name: "Salvar rascunho" }).click();
    await expect(frase).toHaveText("Rascunho salvo.");
    const gravado = await lerDesignDoAviso(avisoId);
    const formas = (gravado?.children ?? []).flatMap((node) => (["f1", "f2", "f3", "f4"].includes(node.id) && node.place?.mode === "free" ? [node.place] : []));
    const vaos = espacos(formas);

    expect(formas).toHaveLength(4);
    expect(Math.max(...vaos) - Math.min(...vaos)).toBeLessThanOrEqual(1);
    expect(vaos.every((vao) => Math.abs(vao - 50) <= 1)).toBe(true);
  });

  await test.step("Ver como Celular e Espaços iguais na vertical: só o celular muda", async () => {
    await editor.getByRole("button", { exact: true, name: "Celular" }).click();
    await expect(frase).toHaveText("Editando o Celular.");
    await expect(varios.getByText("Com Ver como: Celular, alinhar e distribuir mudam só o celular.", { exact: true })).toBeVisible();

    await varios.getByRole("button", { exact: true, name: "Espaços iguais na vertical" }).click();
    await expect(frase).toHaveText(`Espaços iguais na vertical. ${ficou}`);
    // Pelo meio: Forma 1 (170), Forma 3, Forma 2 e Forma 4 (380); (250 - 160) / 3 = 30 px entre cada uma.
    const celular = await lugares(editor);
    expect([celular.f1.y, celular.f3.y, celular.f2.y, celular.f4.y]).toEqual([170, 240, 310, 380]);

    await editor.getByRole("button", { exact: true, name: "Computador" }).click();
    await expect(frase).toHaveText("Editando o Computador.");
    const computador = await lugares(editor);
    expect([computador.f1.y, computador.f3.y, computador.f2.y, computador.f4.y]).toEqual([170, 200, 300, 380]);
  });

  await test.step("Alinhar em cima entre si e Alinhar ao centro no pop-up: cada uma no meio, a travada parada", async () => {
    await varios.getByRole("button", { exact: true, name: "Alinhar em cima entre si" }).click();
    await expect(frase).toHaveText(`Alinhados entre si. ${ficou}`);
    const emCima = await lugares(editor);
    expect([emCima.f1.y, emCima.f2.y, emCima.f3.y, emCima.f4.y]).toEqual([170, 170, 170, 170]);
    expect(emCima.ft).toEqual({ x: TRAVADA.x, y: TRAVADA.y });

    await varios.getByRole("button", { exact: true, name: "Alinhar ao centro no pop-up" }).click();
    await expect(frase).toHaveText(`Alinhados no pop-up. ${ficou}`);
    // Cada uma no meio da prancheta: X = (largura de dentro - largura) / 2. A prancheta de 440 do modelo "Em branco"
    // tem 1 px de borda de cada lado: 438 por dentro.
    expect(await larguraDeDentro(editor)).toBe(DENTRO);
    expect(await lugares(editor)).toEqual({
      f1: { x: (DENTRO - 40) / 2, y: 170 },
      f2: { x: (DENTRO - 80) / 2, y: 170 },
      f3: { x: (DENTRO - 30) / 2, y: 170 },
      f4: { x: (DENTRO - 100) / 2, y: 170 },
      ft: { x: TRAVADA.x, y: TRAVADA.y }
    });
  });

  await test.step("o Selo girado 90° com Alinhar à esquerda: a borda que se vê fica em x 0", async () => {
    await botaoDaCamada(editor, "selo").click();
    await expect.poll(() => escolhidos(editor)).toEqual(["selo"]);
    await expect(varios).toHaveCount(0);
    expect((await lugar(editor, "selo")).x, "girado, o Selo comeca bem longe da borda").toBeGreaterThan(200);

    await editor.getByRole("tab", { exact: true, name: "Avançado" }).click();
    await editor.getByRole("button", { exact: true, name: "Alinhar à esquerda" }).click();
    await expect(frase).toHaveText("Alinhado no pop-up.");
    // A caixa que se ve (girada, mais alta que larga) encosta na borda esquerda da prancheta.
    const selo = await caixaParada(noPalco(editor, "selo"));
    expect(selo.height, "o Selo continua girado").toBeGreaterThan(selo.width);
    expect(Math.abs((await daPrancheta(editor, { x: selo.x, y: selo.y })).x)).toBeLessThanOrEqual(1);
  });

  await test.step("Alt + clique nas duas empilhadas: a de baixo (nunca a travada), 2 de 2; o segundo volta à de cima", async () => {
    // Um ponto dentro das duas Formas e da tampa travada por cima delas.
    const ponto = await pontoNaPrancheta(editor, 90, 485);

    await cliqueCom(page, ponto, ["Alt"]);
    await expect(frase).toHaveText("Selecionado: Embaixo (2 de 2 neste ponto).");
    await expect.poll(() => escolhidos(editor)).toEqual(["sa"]);

    await cliqueCom(page, ponto, ["Alt"]);
    await expect(frase).toHaveText("Selecionado: Em cima (1 de 2 neste ponto).");
    await expect.poll(() => escolhidos(editor)).toEqual(["sb"]);
  });

  await test.step("a Forma de baixo pelo ⋯ › Colocar dentro da caixa continua desenhada, com largura e altura", async () => {
    const linha = botaoDaCamada(editor, "sa");

    await linha.focus();
    await expect(linha).toBeFocused();
    await page.keyboard.press("Shift+F10");
    await irAoItem(page, "Colocar dentro da caixa…");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("menuitem", { exact: true, name: "Caixa em coluna" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(frase).toHaveText("Agora segue a sequência.");
    await expect(page.getByRole("menuitem")).toHaveCount(0);

    expect((await linhasDasCamadas(editor)).find((linhaDaCamada) => linhaDaCamada.id === "sa")?.pai).toBe("caixa");
    // Na sequencia, a Forma guarda o tamanho: a altura desenhada nao some.
    const forma = await caixaParada(noPalco(editor, "sa"));
    expect(forma.height).toBeGreaterThan(50);
    expect(forma.width).toBeGreaterThan(70);
  });

  await test.step("Salvar rascunho: o computador alinhado, o celular distribuído, o Selo girado e a Forma na caixa", async () => {
    await editor.getByRole("button", { name: "Salvar rascunho" }).click();
    await expect(frase).toHaveText("Rascunho salvo.");

    const gravado = await lerDesignDoAviso(avisoId);
    const porId = Object.fromEntries((gravado?.children ?? []).map((node) => [node.id, node]));
    const caixa = porId.caixa;

    expect(gravado?.children.map((node) => node.id)).toEqual(["titulo", "caixa", "f1", "f2", "f3", "f4", "ft", "sb", "st", "selo", "links"]);
    for (const id of ["f1", "f2", "f3", "f4"] as const) {
      expect(porId[id]?.place).toEqual({ h: 40, mode: "free", w: FORMAS[id].w, x: (DENTRO - FORMAS[id].w) / 2, y: 170 });
    }

    expect(porId.ft?.place).toEqual(TRAVADA);
    // O celular so com o Y das duas do meio (os espacos iguais na vertical); o resto segue o computador.
    expect(gravado?.devices?.mobile?.nodes).toEqual({ f2: { place: { mode: "free", y: 310 } }, f3: { place: { mode: "free", y: 240 } } });

    const selo = porId.selo;
    expect(selo?.place?.mode === "free" ? selo.place.rotate : null).toBe(90);
    expect(selo?.place?.mode === "free" ? selo.place.x : 0, "o X do girado fica antes da borda (a caixa que se ve comeca em 0)").toBeLessThan(0);

    expect(caixa?.type === "box" ? caixa.children.map((node) => node.id) : null).toEqual(["nota", "sa"]);
    const forma = caixa?.type === "box" ? caixa.children.find((node) => node.id === "sa") : undefined;
    expect(forma?.place).toEqual({ height: 60, mode: "flow", width: 80 });
  });
});
